import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  API_ROUTE_POLICIES,
  GENERATED_SCHEMAS,
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_AUTHORITY_ROOT_VECTORS,
  PROVENANCE_V2_CANONICAL_JSON_CONTRACT,
  PROVENANCE_V2_COMPOSITE_ROOT_VECTORS,
  PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS,
  PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS,
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS,
  PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS,
  PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS,
  PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT,
  PROVENANCE_V2_FIELD_CORPUS,
  PROVENANCE_V2_FRAME_CONTRACT,
  PROVENANCE_V2_RAW_FIELD_MAPPING_CONTRACT,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
  PROVENANCE_V2_SEMANTIC_POLICY,
  PROVENANCE_V2_SUCCESSOR_MANIFEST_CONTRACT,
} from "@quant-clarity/contracts";

type JsonObject = Record<string, unknown>;

const generatedDirectory = resolve("contracts/generated");

function stripNestedSchemaIds(value: unknown, root = true): unknown {
  if (Array.isArray(value))
    return value.map((entry) => stripNestedSchemaIds(entry, false));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      key === "$id" && !root ? [] : [[key, stripNestedSchemaIds(entry, false)]],
    ),
  );
}

const generatedSchemas = Object.fromEntries(
  Object.entries(GENERATED_SCHEMAS).map(([name, schema]) => [
    name,
    stripNestedSchemaIds(schema),
  ]),
);

const apiSchemaNames = [
  "DatasetMetadata",
  "ErrorEnvelope",
  "MethodologyDetail",
  "ModelFamilyCollection",
  "ModelFamilyDetail",
  "ModelCollection",
  "ModelDetail",
  "VariantCollection",
  "VariantDetail",
  "ProviderCollection",
  "ProviderDetail",
  "OfferingCollection",
  "OfferingDetail",
  "PublicationId",
  "PriceCollection",
  "PriceDetail",
  "PrecisionObservationCollection",
  "PrecisionObservationDetail",
  "EvidenceSummaryCollection",
  "EvidenceSummaryDetail",
  "SearchCollection",
] as const;

const apiSchemas = Object.fromEntries(
  apiSchemaNames.map((name) => [name, generatedSchemas[name]]),
);

type CachePolicy =
  | "active-detail"
  | "collection"
  | "contract"
  | "error"
  | "metadata"
  | "methodology";

const cacheControlValue: Record<CachePolicy, string> = {
  "active-detail": "private, max-age=0, must-revalidate",
  collection: "private, no-store",
  contract: "private, no-store",
  error: "private, no-store",
  metadata: "private, no-store",
  methodology: "private, no-store",
};

const publicationPinParameter = {
  name: "X-QuantClarity-Publication",
  in: "header",
  required: false,
  description:
    "Optional exact publication snapshot. A cursor, when present, must encode the same publication.",
  schema: { $ref: "#/components/schemas/PublicationId" },
} as const;

const conditionalRequestParameter = {
  name: "If-None-Match",
  in: "header",
  required: false,
  description:
    "Optional cache validator for the exact selected publication representation.",
  schema: { type: "string", minLength: 1, maxLength: 256 },
} as const;

function withReadHeaders(parameters: readonly JsonObject[] = []) {
  return [publicationPinParameter, conditionalRequestParameter, ...parameters];
}

function responseHeaders(cachePolicy: CachePolicy) {
  return {
    "Access-Control-Allow-Origin": {
      description: "Public non-credentialed read access.",
      schema: { type: "string", const: "*" },
    },
    "Access-Control-Expose-Headers": {
      description:
        "Response headers readable by non-credentialed browser clients.",
      schema: {
        type: "string",
        const: "ETag, X-QuantClarity-Publication",
      },
    },
    "Cache-Control": {
      description: "Visitor-safe cache policy for this representation class.",
      schema: {
        type: "string",
        const: cacheControlValue[cachePolicy],
      },
    },
    "X-QuantClarity-Publication": {
      description: "Publication ID used for this response.",
      schema: { $ref: "#/components/schemas/PublicationId" },
    },
    ETag: {
      description: "Opaque validation tag for the publication representation.",
      schema: { type: "string" },
    },
    Vary: {
      description: "Only validated representation dimensions may appear.",
      schema: { type: "string" },
    },
  };
}

function jsonResponse(
  description: string,
  schema: string,
  cachePolicy: CachePolicy,
  example?: unknown,
) {
  return {
    description,
    headers: responseHeaders(cachePolicy),
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schema}` },
        ...(example === undefined ? {} : { example }),
      },
    },
  };
}

function notModifiedResponse(cachePolicy: CachePolicy) {
  return {
    description:
      "The selected publication representation matches If-None-Match; no response body is returned.",
    headers: responseHeaders(cachePolicy),
  };
}

function bodylessResponse(response: JsonObject): JsonObject {
  const bodyless = { ...response };
  delete bodyless.content;
  return bodyless;
}

function errorResponse(description: string, code: string, message: string) {
  return jsonResponse(description, "ErrorEnvelope", "error", {
    error: { code, message },
  });
}

const commonErrors = {
  "400": errorResponse(
    "Invalid or unsupported request parameter",
    "invalid_parameter",
    "The request contains an invalid parameter.",
  ),
  "405": {
    ...errorResponse(
      "The request method is not allowed",
      "method_not_allowed",
      "Only GET, HEAD, and OPTIONS are supported.",
    ),
    headers: {
      ...responseHeaders("error"),
      Allow: {
        description: "Methods supported by this read-only resource.",
        schema: { type: "string", const: "GET, HEAD, OPTIONS" },
      },
    },
  },
  "409": errorResponse(
    "The request's publication snapshot is no longer retained",
    "publication_expired",
    "The request's publication snapshot has expired; reload using the current publication.",
  ),
  "413": errorResponse(
    "The bounded query or response limit was exceeded",
    "query_too_large",
    "The bounded query or response limit was exceeded.",
  ),
  "429": {
    ...errorResponse(
      "The permissive abuse-protection limit was exceeded",
      "rate_limited",
      "Rate limit exceeded.",
    ),
    headers: {
      ...responseHeaders("error"),
      "Retry-After": {
        description: "Seconds before the client should retry.",
        schema: { type: "integer", minimum: 1 },
      },
    },
  },
  "503": errorResponse(
    "No safe publication or exact fallback is available",
    "publication_not_ready",
    "No safe publication is ready.",
  ),
};

const methodologySecurityHeaders = {
  "Content-Security-Policy": {
    schema: {
      type: "string",
      const:
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  },
  "Permissions-Policy": {
    schema: {
      type: "string",
      const:
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    },
  },
  "Referrer-Policy": {
    schema: { type: "string", const: "no-referrer" },
  },
  "X-Content-Type-Options": {
    schema: { type: "string", const: "nosniff" },
  },
  "X-Frame-Options": {
    schema: { type: "string", const: "DENY" },
  },
} as const;

function methodologyErrorHeaders(status: string): JsonObject {
  return {
    ...methodologySecurityHeaders,
    "Access-Control-Allow-Origin": {
      description: "Public non-credentialed read access.",
      schema: { type: "string", const: "*" },
    },
    "Access-Control-Expose-Headers": {
      description:
        "Response headers readable by non-credentialed browser clients.",
      schema: {
        type: "string",
        const: "ETag, X-QuantClarity-Publication",
      },
    },
    "Cache-Control": {
      description: "Visitor-safe no-store policy.",
      schema: { type: "string", const: "private, no-store" },
    },
    ...(status === "405"
      ? {
          Allow: {
            description: "Methods supported by this read-only resource.",
            schema: { type: "string", const: "GET, HEAD, OPTIONS" },
          },
        }
      : {}),
    ...(status === "409"
      ? {
          Vary: {
            description: "The exact publication pin controls this outcome.",
            schema: {
              type: "string",
              const: "X-QuantClarity-Publication",
            },
          },
          "X-QuantClarity-Publication": {
            description: "Current publication ID after an expired exact pin.",
            schema: { $ref: "#/components/schemas/PublicationId" },
          },
        }
      : {}),
    ...(status === "429"
      ? {
          "Retry-After": {
            description: "Seconds before the client should retry.",
            schema: { type: "integer", minimum: 1 },
          },
        }
      : {}),
  };
}

function methodologyErrorResponse(
  status: string,
  description: string,
  code: string,
  message: string,
  includePublicationNotReady = true,
): JsonObject {
  const mediaType: JsonObject = {
    schema: { $ref: "#/components/schemas/ErrorEnvelope" },
    example: { error: { code, message } },
  };
  if (status === "503") {
    delete mediaType.example;
    mediaType.examples = {
      ...(includePublicationNotReady
        ? {
            publicationNotReady: {
              value: {
                error: {
                  code: "publication_not_ready",
                  message: "No public dataset has been published yet.",
                },
              },
            },
          }
        : {}),
      methodologyUnavailable: {
        value: {
          error: {
            code: "temporarily_unavailable",
            message: "The methodology detail is temporarily unavailable.",
          },
        },
      },
      limiterUnavailable: {
        value: {
          error: {
            code: "temporarily_unavailable",
            message: "The request cannot be safely rate limited.",
          },
        },
      },
      serviceUnavailable: {
        value: {
          error: {
            code: "temporarily_unavailable",
            message: "The service is temporarily unavailable.",
          },
        },
      },
    };
  }
  return {
    description,
    headers: methodologyErrorHeaders(status),
    content: { "application/json": mediaType },
  };
}

const methodologyErrors = {
  "400": methodologyErrorResponse(
    "400",
    "Invalid or unsupported request parameter",
    "invalid_parameter",
    "The request contains an invalid parameter.",
  ),
  "404": methodologyErrorResponse(
    "404",
    "The requested methodology or closed route was not found",
    "resource_not_found",
    "The requested resource does not exist.",
  ),
  "405": methodologyErrorResponse(
    "405",
    "The request method is not allowed",
    "method_not_allowed",
    "Only GET, HEAD, and OPTIONS are supported.",
  ),
  "409": methodologyErrorResponse(
    "409",
    "The request's publication snapshot is no longer retained",
    "publication_expired",
    "The requested publication is no longer available.",
  ),
  "413": methodologyErrorResponse(
    "413",
    "The bounded request-target limit was exceeded",
    "query_too_large",
    "The request target exceeds the configured size limit.",
  ),
  "429": methodologyErrorResponse(
    "429",
    "The permissive abuse-protection limit was exceeded",
    "rate_limited",
    "Rate limit exceeded.",
  ),
  "503": methodologyErrorResponse(
    "503",
    "The publication, methodology operation, service, or limiter is unavailable",
    "temporarily_unavailable",
    "The methodology detail is temporarily unavailable.",
  ),
};

const methodologyOptionsUnavailable = methodologyErrorResponse(
  "503",
  "The methodology route, service configuration, or limiter is unavailable",
  "temporarily_unavailable",
  "The methodology detail is temporarily unavailable.",
  false,
);

function methodologyRepresentationHeaders(): JsonObject {
  return {
    ...responseHeaders("methodology"),
    ...methodologySecurityHeaders,
    ETag: {
      description:
        "Strong publication-qualified SHA-256 validator for the exact JSON bytes.",
      schema: { type: "string", pattern: '^"[0-9a-f]{64}"$' },
    },
    Vary: {
      description: "The exact publication pin controls this representation.",
      schema: {
        type: "string",
        const: "X-QuantClarity-Publication",
      },
    },
  };
}

function protocolOperations(
  operationId: string,
  summary: string,
  parameters: JsonObject[] = [],
  cachePolicy: CachePolicy = "active-detail",
  includeNotFound = false,
) {
  return {
    head: {
      operationId: `${operationId}Head`,
      summary: `${summary} headers`,
      parameters: withReadHeaders(parameters),
      responses: {
        "200": {
          description:
            "The GET representation exists; no response body is returned.",
          headers: {
            ...responseHeaders(cachePolicy),
            "X-QuantClarity-Publication": {
              schema: { $ref: "#/components/schemas/PublicationId" },
            },
            ETag: { schema: { type: "string" } },
          },
        },
        "304": notModifiedResponse(cachePolicy),
        "400": bodylessResponse(commonErrors["400"]),
        ...(includeNotFound
          ? {
              "404": bodylessResponse(
                errorResponse(
                  "The requested resource was not found",
                  "resource_not_found",
                  "The requested resource does not exist.",
                ),
              ),
            }
          : {}),
        "405": bodylessResponse(commonErrors["405"]),
        "409": bodylessResponse(commonErrors["409"]),
        "413": bodylessResponse(commonErrors["413"]),
        "429": bodylessResponse(commonErrors["429"]),
        "503": bodylessResponse(commonErrors["503"]),
      },
    },
    options: {
      operationId: `${operationId}Options`,
      summary: `${summary} CORS capabilities`,
      parameters: parameters.filter((parameter) => parameter.in === "path"),
      responses: {
        "204": {
          description: "Non-credentialed public read CORS preflight response.",
          headers: {
            Allow: { schema: { type: "string", const: "GET, HEAD, OPTIONS" } },
            "Access-Control-Allow-Origin": {
              schema: { type: "string", const: "*" },
            },
            "Access-Control-Allow-Methods": {
              schema: { type: "string", const: "GET, HEAD, OPTIONS" },
            },
            "Access-Control-Allow-Headers": {
              schema: {
                type: "string",
                const: "If-None-Match, X-QuantClarity-Publication",
              },
            },
            "Access-Control-Expose-Headers": {
              schema: {
                type: "string",
                const: "ETag, X-QuantClarity-Publication",
              },
            },
            "Cache-Control": {
              schema: { type: "string", const: "private, no-store" },
            },
          },
        },
        ...(includeNotFound && cachePolicy === "methodology"
          ? {
              "404": errorResponse(
                "The requested resource was not found",
                "resource_not_found",
                "The requested resource does not exist.",
              ),
            }
          : {}),
        "429": commonErrors["429"],
        "503": commonErrors["503"],
      },
    },
  };
}

type RoutePolicyName = keyof typeof API_ROUTE_POLICIES;

function filterSchema(name: string): JsonObject {
  if (
    ["stale", "stale_offering", "standard_comparable", "promotional"].includes(
      name,
    )
  )
    return { type: "boolean" };
  if (["updated_since", "observed_since", "effective_since"].includes(name))
    return {
      type: "string",
      format: "date-time",
      pattern:
        "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$",
    };
  if (["price_min", "price_max"].includes(name))
    return {
      type: "string",
      pattern: "^(0|[1-9][0-9]{0,23})(\\.[0-9]{1,18})?$",
    };
  if (name === "currency") return { type: "string", pattern: "^[A-Z]{3}$" };
  return {
    type: "string",
    minLength: 1,
    maxLength: 512,
    description:
      "A single value or at most ten comma-separated values where this filter is documented as multi-value.",
  };
}

function collectionParameters(
  policyName: RoutePolicyName,
  maximumLimit: number,
  requireQuery: boolean,
) {
  const policy = API_ROUTE_POLICIES[policyName];
  return [
    {
      name: "limit",
      in: "query",
      required: false,
      schema: {
        type: "integer",
        minimum: 1,
        maximum: maximumLimit,
        default: Math.min(25, maximumLimit),
      },
    },
    {
      name: "cursor",
      in: "query",
      required: false,
      schema: { type: "string", minLength: 1, maxLength: 4096 },
    },
    {
      name: "sort",
      in: "query",
      required: false,
      description: `Allowlisted neutral primary sort; deterministic default is ${policy.defaultSort.join(", ")}.`,
      schema: {
        type: "string",
        enum: [...policy.sorts],
        default: policy.defaultSort[0],
      },
    },
    ...policy.filters.map((name) => ({
      name,
      in: "query",
      required: false,
      schema: filterSchema(name),
    })),
    ...(requireQuery
      ? [
          {
            name: "q",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 200 },
          },
        ]
      : []),
  ];
}

function collectionOperation(
  operationId: string,
  summary: string,
  responseSchema: string,
  policyName: RoutePolicyName,
  extraParameters: JsonObject[] = [],
  maximumLimit = 100,
  requireQuery = false,
  responseExample?: unknown,
) {
  const parameters = [
    ...collectionParameters(policyName, maximumLimit, requireQuery),
    ...extraParameters,
  ];
  return {
    get: {
      operationId,
      summary,
      parameters: withReadHeaders(parameters),
      responses: {
        "200": jsonResponse(
          summary,
          responseSchema,
          "collection",
          responseExample,
        ),
        "304": notModifiedResponse("collection"),
        ...commonErrors,
      },
    },
    ...protocolOperations(operationId, summary, parameters, "collection"),
  };
}

function detailOperation(
  operationId: string,
  summary: string,
  responseSchema: string,
  parameterName: string,
  description: string,
  parameterSchema: JsonObject = {
    type: "string",
    minLength: 1,
    maxLength: 256,
  },
  cachePolicy: CachePolicy = "active-detail",
) {
  return {
    get: {
      operationId,
      summary,
      parameters: withReadHeaders([
        {
          name: parameterName,
          in: "path",
          required: true,
          description,
          schema: parameterSchema,
        },
      ]),
      responses: {
        "200": jsonResponse(summary, responseSchema, cachePolicy),
        "304": notModifiedResponse(cachePolicy),
        "400": commonErrors["400"],
        "404": errorResponse(
          "The requested resource was not found",
          "resource_not_found",
          "The requested resource does not exist.",
        ),
        "405": commonErrors["405"],
        "409": commonErrors["409"],
        "413": commonErrors["413"],
        "429": commonErrors["429"],
        "503": commonErrors["503"],
      },
    },
    ...protocolOperations(
      operationId,
      summary,
      [
        {
          name: parameterName,
          in: "path",
          required: true,
          description,
          schema: parameterSchema,
        },
      ],
      cachePolicy,
      true,
    ),
  };
}

function methodologyDetailOperation() {
  const operation = detailOperation(
    "getMethodology",
    "Get versioned methodology metadata",
    "MethodologyDetail",
    "version",
    "Exact historical methodology version.",
    {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$",
    },
    "methodology",
  );
  const representationHeaders = methodologyRepresentationHeaders();
  return {
    get: {
      ...operation.get,
      responses: {
        ...operation.get.responses,
        "200": {
          ...operation.get.responses["200"],
          headers: representationHeaders,
        },
        "304": {
          ...operation.get.responses["304"],
          headers: representationHeaders,
        },
        ...methodologyErrors,
      },
    },
    head: {
      ...operation.head,
      responses: Object.fromEntries(
        Object.entries(operation.head.responses).map(([status, response]) => [
          status,
          status === "200" || status === "304"
            ? { ...response, headers: representationHeaders }
            : bodylessResponse(
                (methodologyErrors as Readonly<Record<string, JsonObject>>)[
                  status
                ]!,
              ),
        ]),
      ),
    },
    options: {
      ...operation.options,
      responses: {
        "204": {
          ...operation.options.responses["204"],
          headers: {
            ...operation.options.responses["204"].headers,
            ...methodologySecurityHeaders,
            "Access-Control-Max-Age": {
              schema: { type: "integer", const: 600 },
            },
          },
        },
        "400": methodologyErrors["400"],
        "404": methodologyErrors["404"],
        "413": methodologyErrors["413"],
        "429": methodologyErrors["429"],
        "503": methodologyOptionsUnavailable,
      },
    },
  };
}

const modelDetailPublicCacheControl = {
  description:
    "Stable-ID representations privately revalidate; slug representations and redirects are private, no-store.",
  schema: {
    type: "string",
    enum: ["private, max-age=0, must-revalidate", "private, no-store"],
  },
} as const;

const modelJsonMediaType = "application/json; charset=utf-8";

const modelSecurityHeaders = {
  "Content-Security-Policy": {
    schema: {
      type: "string",
      const:
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  },
  "Permissions-Policy": {
    schema: {
      type: "string",
      const:
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    },
  },
  "Referrer-Policy": {
    schema: { type: "string", const: "no-referrer" },
  },
  "Strict-Transport-Security": {
    description: "Protected environment-owned HTTPS policy.",
    schema: {
      type: "string",
      enum: ["max-age=300", "max-age=31536000; includeSubDomains"],
    },
  },
  "X-Content-Type-Options": {
    schema: { type: "string", const: "nosniff" },
  },
  "X-Frame-Options": {
    schema: { type: "string", const: "DENY" },
  },
} as const;

const modelCommonHeaders = (cacheControl: JsonObject) => ({
  ...modelSecurityHeaders,
  "Access-Control-Allow-Origin": {
    schema: { type: "string", const: "*" },
  },
  "Access-Control-Expose-Headers": {
    schema: {
      type: "string",
      const: "ETag, X-QuantClarity-Publication",
    },
  },
  "Cache-Control": cacheControl,
});

const modelPublicationHeaders = {
  Vary: {
    schema: { type: "string", const: "X-QuantClarity-Publication" },
  },
  "X-QuantClarity-Publication": {
    schema: { $ref: "#/components/schemas/PublicationId" },
  },
} as const;

const modelJsonHeaders = {
  "Content-Length": {
    schema: { type: "integer", minimum: 1, maximum: 65_536 },
  },
} as const;

const modelError = (
  description: string,
  code: string,
  message: string,
  publication = false,
  extraHeaders: JsonObject = {},
) => {
  const response = errorResponse(description, code, message);
  return {
    ...response,
    headers: {
      ...modelCommonHeaders({
        schema: { type: "string", const: "private, no-store" },
      }),
      ...modelJsonHeaders,
      ...(publication ? modelPublicationHeaders : {}),
      ...extraHeaders,
    },
    content: {
      [modelJsonMediaType]: response.content["application/json"],
    },
  };
};

const modelErrors = {
  "400": modelError(
    "The Model detail request is invalid",
    "invalid_parameter",
    "The Model detail request is invalid.",
  ),
  "404": modelError(
    "The Model was not found in the selected publication",
    "resource_not_found",
    "The requested resource does not exist.",
    true,
  ),
  "405": modelError(
    "The request method is not allowed",
    "method_not_allowed",
    "Only GET, HEAD, and OPTIONS are supported.",
    false,
    {
      Allow: {
        schema: { type: "string", const: "GET, HEAD, OPTIONS" },
      },
    },
  ),
  "409": modelError(
    "The exact publication is no longer retained",
    "publication_expired",
    "The requested publication is no longer available.",
    true,
  ),
  "413": modelError(
    "The request exceeds the configured size limit",
    "query_too_large",
    "The request exceeds the configured size limit.",
  ),
  "429": modelError(
    "The permissive abuse-protection limit was exceeded",
    "rate_limited",
    "Rate limit exceeded.",
    false,
    {
      "Retry-After": { schema: { type: "integer", const: 60 } },
    },
  ),
  "503": modelError(
    "No safe publication or exact response is available",
    "temporarily_unavailable",
    "The Model detail is temporarily unavailable.",
  ),
} as const;

const modelAllErrors = {
  ...modelErrors,
  "503": {
    ...modelErrors["503"],
    content: {
      [modelJsonMediaType]: {
        schema: { $ref: "#/components/schemas/ErrorEnvelope" },
        examples: {
          publicationNotReady: {
            value: {
              error: {
                code: "publication_not_ready",
                message: "No public dataset has been published yet.",
              },
            },
          },
          temporarilyUnavailable: {
            value: {
              error: {
                code: "temporarily_unavailable",
                message: "The Model detail is temporarily unavailable.",
              },
            },
          },
          gateUnavailable: {
            value: {
              error: {
                code: "temporarily_unavailable",
                message: "The request cannot be safely rate limited.",
              },
            },
          },
        },
      },
    },
  },
} as const;

const modelGateUnavailableError = modelError(
  "The request cannot be safely rate limited",
  "temporarily_unavailable",
  "The request cannot be safely rate limited.",
);

const modelDetailExample = {
  data: {
    active_parameters: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
    architecture: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
    authoritative_checkpoint_ids: [],
    cataloged_provider_count: {
      derivation_version: "cataloged-provider-count@1",
      observed_at: "2026-08-03T00:00:00.000Z",
      value: 0,
    },
    checkpoints: [],
    context_window_tokens: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
    display_name: {
      evidence_ids: ["evd_11111111-1111-4111-8111-111111111111"],
      observed_at: "2026-08-03T00:00:00.000Z",
      state: "known",
      value: "Fixture Model",
    },
    family_id: "fam_11111111-1111-4111-8111-111111111111",
    last_model_data_refresh: {
      evidence_ids: ["evd_11111111-1111-4111-8111-111111111111"],
      observed_at: "2026-08-03T00:00:00.000Z",
      state: "known",
      value: "2026-08-03T00:00:00.000Z",
    },
    license: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
    maximum_output_tokens: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
    modalities: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
    model_id: "mdl_11111111-1111-4111-8111-111111111111",
    publisher: {
      evidence_ids: ["evd_11111111-1111-4111-8111-111111111111"],
      observed_at: "2026-08-03T00:00:00.000Z",
      state: "known",
      value: "Fixture Publisher",
    },
    release_date: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
    slug: {
      evidence_ids: ["evd_11111111-1111-4111-8111-111111111111"],
      observed_at: "2026-08-03T00:00:00.000Z",
      state: "known",
      value: "fixture-model",
    },
    source_quantization: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
    source_weight_format: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
    status: {
      evidence_ids: ["evd_11111111-1111-4111-8111-111111111111"],
      observed_at: "2026-08-03T00:00:00.000Z",
      state: "known",
      value: "active",
    },
    total_parameters: {
      evidence_ids: [],
      observed_at: null,
      state: "unknown",
      value: null,
    },
  },
  meta: {
    filters: {},
    publication_id: "pub_11111111-1111-4111-8111-111111111111",
    resource: "models",
    schema_version: "1.13.0",
    sort: ["name", "stable_id"],
  },
} as const;

const modelDetailRedirect = {
  description:
    "An unpinned historical slug redirects to the verified stable Model ID path.",
  headers: {
    ...modelCommonHeaders({
      schema: { type: "string", const: "private, no-store" },
    }),
    "Content-Length": { schema: { type: "integer", const: 0 } },
    Location: {
      description: "Relative verified stable Model ID path.",
      schema: {
        type: "string",
        pattern:
          "^/v1/models/mdl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      },
    },
    ...modelPublicationHeaders,
  },
} as const;

function modelDetailOperation() {
  const operation = detailOperation(
    "getModel",
    "Get a canonical model",
    "ModelDetail",
    "model_id_or_slug",
    "Stable model ID, current slug, or historical slug. An unpinned historical slug returns 308 to the stable ID; an explicitly pinned historical slug returns the selected representation. Raw targets containing percent-encoding, any query marker (including a bare ?), a trailing slash, or an extra path segment are rejected before identifier matching.",
    {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern:
        "^(?:mdl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9]+(?:-[a-z0-9]+)*)$",
    },
  );
  const get = operation.get;
  const head = operation.head;
  const getSuccess = get.responses["200"];
  const successHeaders = {
    ...modelCommonHeaders(modelDetailPublicCacheControl),
    ...modelJsonHeaders,
    ...modelPublicationHeaders,
    ETag: {
      schema: { type: "string", pattern: '^"[0-9a-f]{64}"$' },
    },
  };
  const notModifiedHeaders = {
    ...modelCommonHeaders(modelDetailPublicCacheControl),
    ...modelPublicationHeaders,
    ETag: {
      schema: { type: "string", pattern: '^"[0-9a-f]{64}"$' },
    },
  };
  const headErrors = Object.fromEntries(
    Object.entries(modelAllErrors).map(([status, response]) => [
      status,
      bodylessResponse(response),
    ]),
  );
  const options204 = operation.options.responses["204"];
  return {
    ...operation,
    get: {
      ...get,
      responses: {
        ...get.responses,
        "200": {
          ...getSuccess,
          headers: successHeaders,
          content: {
            [modelJsonMediaType]: {
              schema: { $ref: "#/components/schemas/ModelDetail" },
              example: modelDetailExample,
            },
          },
        },
        "304": {
          description:
            "The selected exact Model representation matches If-None-Match; no response body is returned.",
          headers: notModifiedHeaders,
        },
        "308": modelDetailRedirect,
        ...modelAllErrors,
      },
    },
    head: {
      ...head,
      description:
        "HEAD returns no body. Entity-bearing outcomes retain the exact GET Content-Type application/json; charset=utf-8 and Content-Length headers on the wire; OpenAPI represents that media type on body-bearing GET/OPTIONS responses because OAS ignores a response Header Object named Content-Type.",
      responses: {
        ...head.responses,
        "200": {
          description:
            "The exact GET representation exists; no response body is returned.",
          headers: successHeaders,
        },
        "304": {
          description:
            "The selected exact Model representation matches If-None-Match; no response body is returned.",
          headers: notModifiedHeaders,
        },
        "308": modelDetailRedirect,
        ...headErrors,
      },
    },
    options: {
      ...operation.options,
      responses: {
        ...operation.options.responses,
        "204": {
          ...options204,
          headers: {
            ...options204.headers,
            ...modelSecurityHeaders,
            "Access-Control-Max-Age": {
              schema: { type: "integer", const: 600 },
            },
          },
        },
        "400": modelErrors["400"],
        "413": modelErrors["413"],
        "429": modelErrors["429"],
        "503": modelGateUnavailableError,
      },
    },
  };
}

const openapi = {
  openapi: "3.1.1",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "QuantClarity public API",
    version: "1.0.0",
    description:
      "Anonymous, read-only, neutral inference-provider facts. Unknowns are explicit, prices are never currency-converted or blended, and no visitor telemetry is retained. Within /v1, clients recursively ignore additive unknown object fields and tolerate bounded unknown values in extensible string vocabularies.",
  },
  security: [],
  servers: [
    {
      url: "https://api.example.invalid/v1",
      description: "Placeholder until the public domain is cleared",
    },
  ],
  paths: {
    "/metadata": {
      get: {
        summary: "Get selected dataset metadata",
        operationId: "getMetadata",
        parameters: withReadHeaders(),
        responses: {
          "200": jsonResponse(
            "Selected dataset metadata",
            "DatasetMetadata",
            "metadata",
            {
              publication_id: "pub_00000000-0000-4000-8000-000000000001",
              schema_version: "1.0.0",
              api_version: "1",
              methodology_version: "1.0.0",
              methodology_effective_at: "2026-08-01T00:00:00.000Z",
              methodology_url:
                "https://api.example.invalid/v1/methodologies/1.0.0",
              precision_normalization_version: "precision-normalization@1",
              precision_display_order_version: "precision-display-order@1",
              price_policy_version: "1.0.0",
              published_at: "2026-08-01T00:00:00.000Z",
              generated_at: "2026-08-01T00:00:00.000Z",
              next_refresh_window: {
                starts_at: "2026-08-03T05:00:00.000Z",
                ends_at: "2026-08-03T17:00:00.000Z",
              },
              counts: {
                active_models: 0,
                active_offerings: 0,
                active_providers: 0,
              },
              degradation_notices: [],
            },
          ),
          "304": notModifiedResponse("metadata"),
          ...commonErrors,
        },
      },
      ...protocolOperations(
        "getMetadata",
        "Get selected dataset metadata",
        [],
        "metadata",
      ),
    },
    "/model-families": collectionOperation(
      "listModelFamilies",
      "List canonical model families",
      "ModelFamilyCollection",
      "modelFamilies",
    ),
    "/methodologies/{version}": methodologyDetailOperation(),
    "/model-families/{family_id_or_slug}": detailOperation(
      "getModelFamily",
      "Get a canonical model family",
      "ModelFamilyDetail",
      "family_id_or_slug",
      "Stable family ID or current/historical slug.",
    ),
    "/models": collectionOperation(
      "listModels",
      "List canonical models",
      "ModelCollection",
      "models",
    ),
    "/models/{model_id_or_slug}": modelDetailOperation(),
    "/models/{model_id}/offerings": collectionOperation(
      "listModelOfferings",
      "List neutral offerings for one model",
      "OfferingCollection",
      "offerings",
      [
        {
          name: "model_id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
    ),
    "/variants": collectionOperation(
      "listVariants",
      "List explicit model variants",
      "VariantCollection",
      "variants",
    ),
    "/variants/{variant_id_or_slug}": detailOperation(
      "getVariant",
      "Get an explicit model variant",
      "VariantDetail",
      "variant_id_or_slug",
      "Stable variant ID or current/historical slug.",
    ),
    "/variants/{variant_id}/offerings": collectionOperation(
      "listVariantOfferings",
      "List neutral offerings for one explicit variant",
      "OfferingCollection",
      "offerings",
      [
        {
          name: "variant_id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
    ),
    "/providers": collectionOperation(
      "listProviders",
      "List inference providers",
      "ProviderCollection",
      "providers",
    ),
    "/providers/{provider_id_or_slug}": detailOperation(
      "getProvider",
      "Get an inference provider",
      "ProviderDetail",
      "provider_id_or_slug",
      "Stable provider ID or current/historical slug.",
    ),
    "/providers/{provider_id}/offerings": collectionOperation(
      "listProviderOfferings",
      "List neutral offerings for one provider",
      "OfferingCollection",
      "offerings",
      [
        {
          name: "provider_id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
    ),
    "/offerings": collectionOperation(
      "listOfferings",
      "List neutral provider offerings",
      "OfferingCollection",
      "offerings",
    ),
    "/offerings/{offering_id}": detailOperation(
      "getOffering",
      "Get an exact provider offering",
      "OfferingDetail",
      "offering_id",
      "Stable offering ID.",
    ),
    "/prices": collectionOperation(
      "listPrices",
      "List independent price records",
      "PriceCollection",
      "prices",
    ),
    "/prices/{price_id}": detailOperation(
      "getPrice",
      "Get an independent price record",
      "PriceDetail",
      "price_id",
      "Stable price ID.",
    ),
    "/precision-observations": collectionOperation(
      "listPrecisionObservations",
      "List exact-scope precision observations",
      "PrecisionObservationCollection",
      "precisionObservations",
    ),
    "/precision-observations/{precision_id}": detailOperation(
      "getPrecisionObservation",
      "Get an exact-scope precision observation",
      "PrecisionObservationDetail",
      "precision_id",
      "Stable precision observation ID.",
    ),
    "/evidence": collectionOperation(
      "listEvidenceSummaries",
      "List public evidence summaries",
      "EvidenceSummaryCollection",
      "evidence",
    ),
    "/evidence/{evidence_id}": detailOperation(
      "getEvidenceSummary",
      "Get a public evidence summary",
      "EvidenceSummaryDetail",
      "evidence_id",
      "Stable evidence ID.",
    ),
    "/search": collectionOperation(
      "searchModels",
      "Search models, explicit variants, and provider suggestions",
      "SearchCollection",
      "search",
      [],
      20,
      true,
      {
        data: [],
        page: { next_cursor: null, limit: 20 },
        meta: {
          semantic_degraded: "disabled",
          resource: "search",
          publication_id: "pub_00000000-0000-4000-8000-000000000001",
          schema_version: "1.0.0",
          sort: ["relevance", "stable_id"],
          filters: {},
        },
      },
    ),
    "/openapi.json": {
      get: {
        operationId: "getOpenApi",
        summary: "Get the OpenAPI contract",
        parameters: withReadHeaders(),
        responses: {
          "200": {
            description: "This OpenAPI document",
            headers: responseHeaders("contract"),
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          "304": notModifiedResponse("contract"),
          "400": commonErrors["400"],
          "429": commonErrors["429"],
          "405": commonErrors["405"],
          "409": commonErrors["409"],
          "413": commonErrors["413"],
          "503": commonErrors["503"],
        },
      },
      ...protocolOperations(
        "getOpenApi",
        "Get the OpenAPI contract",
        [],
        "contract",
      ),
    },
    "/openapi.yaml": {
      get: {
        operationId: "getOpenApiYaml",
        summary: "Get the OpenAPI contract as YAML",
        parameters: withReadHeaders(),
        responses: {
          "200": {
            description: "This OpenAPI document in YAML 1.2 format",
            headers: responseHeaders("contract"),
            content: {
              "application/yaml": { schema: { type: "object" } },
            },
          },
          "304": notModifiedResponse("contract"),
          "400": commonErrors["400"],
          "429": commonErrors["429"],
          "405": commonErrors["405"],
          "409": commonErrors["409"],
          "413": commonErrors["413"],
          "503": commonErrors["503"],
        },
      },
      ...protocolOperations(
        "getOpenApiYaml",
        "Get the OpenAPI contract as YAML",
        [],
        "contract",
      ),
    },
  },
  components: { schemas: apiSchemas },
} as const;

const serializedOpenApi = `${JSON.stringify(openapi, null, 2)}\n`;
const files = new Map<string, string>([
  ["openapi.json", serializedOpenApi],
  // JSON is a valid YAML 1.2 representation. Keeping one deterministic
  // serialization prevents the JSON and YAML contract surfaces from drifting.
  ["openapi.yaml", serializedOpenApi],
  ...Object.entries(generatedSchemas).map(
    ([name, schema]) =>
      [
        `schemas/${name}.schema.json`,
        `${JSON.stringify(schema, null, 2)}\n`,
      ] as const,
  ),
  [
    "provenance-v2/canonical-json.v1.json",
    `${JSON.stringify(PROVENANCE_V2_CANONICAL_JSON_CONTRACT, null, 2)}\n`,
  ],
  [
    "provenance-v2/frame-contract.v1.json",
    `${JSON.stringify(PROVENANCE_V2_FRAME_CONTRACT, null, 2)}\n`,
  ],
  [
    "provenance-v2/field-corpus.v1.json",
    `${JSON.stringify(PROVENANCE_V2_FIELD_CORPUS, null, 2)}\n`,
  ],
  [
    "provenance-v2/raw-field-mapping-contract.v1.json",
    `${JSON.stringify(PROVENANCE_V2_RAW_FIELD_MAPPING_CONTRACT, null, 2)}\n`,
  ],
  [
    "provenance-v2/registration-semantics.v1.json",
    `${JSON.stringify(PROVENANCE_V2_SEMANTIC_POLICY, null, 2)}\n`,
  ],
  [
    "provenance-v2/successor-manifest-preimage.v1.json",
    `${JSON.stringify(PROVENANCE_V2_SUCCESSOR_MANIFEST_CONTRACT, null, 2)}\n`,
  ],
  [
    "provenance-v2/root-registry.v1.json",
    `${JSON.stringify(PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY, null, 2)}\n`,
  ],
  [
    "provenance-v2/root-binding-plan.v1.json",
    `${JSON.stringify(PROVENANCE_V2_ROOT_BINDING_PLAN, null, 2)}\n`,
  ],
  [
    "provenance-v2/golden-vectors.v1.json",
    `${JSON.stringify(PROVENANCE_V2_AUTHORITY_ROOT_VECTORS, null, 2)}\n`,
  ],
  [
    "provenance-v2/composite-root-vectors.v1.json",
    `${JSON.stringify(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS, null, 2)}\n`,
  ],
  [
    "provenance-v2/connected-document-cascade-vectors.v1.json",
    `${JSON.stringify(PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS, null, 2)}\n`,
  ],
  [
    "provenance-v2/external-row-resolver-vectors.v1.json",
    `${JSON.stringify(PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS, null, 2)}\n`,
  ],
  [
    "provenance-v2/connected-registration-graph.v1.json",
    `${JSON.stringify(PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH, null, 2)}\n`,
  ],
  [
    "provenance-v2/connected-registration-document-vectors.v1.json",
    `${JSON.stringify(PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS, null, 2)}\n`,
  ],
  [
    "provenance-v2/connected-successor-manifest-vectors.v1.json",
    `${JSON.stringify(PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS, null, 2)}\n`,
  ],
  [
    "provenance-v2/connected-traversal-vectors.v1.json",
    `${JSON.stringify(PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS, null, 2)}\n`,
  ],
  [
    "provenance-v2/registration-document-resolver-contract.v1.json",
    `${JSON.stringify(PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT, null, 2)}\n`,
  ],
]);

const check = process.argv.includes("--check");
const mismatches: string[] = [];

async function generatedFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? generatedFiles(path)
        : Promise.resolve([relative(generatedDirectory, path)]);
    }),
  );
  return nested.flat();
}

const expectedPaths = new Set(files.keys());
for (const relativePath of await generatedFiles(generatedDirectory)) {
  if (expectedPaths.has(relativePath)) continue;
  if (check) mismatches.push(`orphan:${relativePath}`);
  else await rm(resolve(generatedDirectory, relativePath));
}

for (const [relativePath, contents] of files) {
  const path = resolve(generatedDirectory, relativePath);
  if (check) {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing !== contents) mismatches.push(relativePath);
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, { encoding: "utf8" });
  }
}

if (mismatches.length > 0) {
  throw new Error(`Generated contracts are stale: ${mismatches.join(", ")}`);
}
