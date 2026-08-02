import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  API_ROUTE_POLICIES,
  GENERATED_SCHEMAS,
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
  "active-detail" | "collection" | "contract" | "error" | "metadata";

const cacheControlExample: Record<CachePolicy, string> = {
  "active-detail": "max-age=0, must-revalidate",
  collection: "private, no-store",
  contract: "public, max-age=300",
  error: "no-store",
  metadata: "no-store",
};

function responseHeaders(cachePolicy: CachePolicy) {
  return {
    "Access-Control-Allow-Origin": {
      description: "Public non-credentialed read access.",
      schema: { type: "string", const: "*" },
    },
    "Cache-Control": {
      description: "Visitor-safe cache policy for this representation class.",
      schema: { type: "string", example: cacheControlExample[cachePolicy] },
    },
    "X-QuantClarity-Publication": {
      description: "Publication ID used for this response.",
      schema: { type: "string" },
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
  "405": errorResponse(
    "The request method is not allowed",
    "method_not_allowed",
    "Only GET, HEAD, and OPTIONS are supported.",
  ),
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

function protocolOperations(
  operationId: string,
  summary: string,
  parameters: JsonObject[] = [],
  cachePolicy: CachePolicy = "active-detail",
) {
  return {
    head: {
      operationId: `${operationId}Head`,
      summary: `${summary} headers`,
      parameters,
      responses: {
        "200": {
          description:
            "The GET representation exists; no response body is returned.",
          headers: {
            ...responseHeaders(cachePolicy),
            "X-QuantClarity-Publication": {
              schema: { type: "string" },
            },
            ETag: { schema: { type: "string" } },
          },
        },
        "429": commonErrors["429"],
        "503": commonErrors["503"],
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
            "Cache-Control": {
              schema: { type: "string", const: "private, no-store" },
            },
          },
        },
        "429": commonErrors["429"],
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
) {
  const parameters = [
    ...collectionParameters(policyName, maximumLimit, requireQuery),
    ...extraParameters,
  ];
  return {
    get: {
      operationId,
      summary,
      parameters,
      responses: {
        "200": jsonResponse(summary, responseSchema, "collection"),
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
) {
  return {
    get: {
      operationId,
      summary,
      parameters: [
        {
          name: parameterName,
          in: "path",
          required: true,
          description,
          schema: { type: "string", minLength: 1, maxLength: 256 },
        },
      ],
      responses: {
        "200": jsonResponse(summary, responseSchema, "active-detail"),
        "404": errorResponse(
          "The requested resource was not found",
          "resource_not_found",
          "The requested resource does not exist.",
        ),
        "405": commonErrors["405"],
        "409": commonErrors["409"],
        "429": commonErrors["429"],
        "503": commonErrors["503"],
      },
    },
    ...protocolOperations(operationId, summary, [
      {
        name: parameterName,
        in: "path",
        required: true,
        description,
        schema: { type: "string", minLength: 1, maxLength: 256 },
      },
    ]),
  };
}

const openapi = {
  openapi: "3.1.1",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "QuantClarity public API",
    version: "1.0.0",
    description:
      "Anonymous, read-only, neutral inference-provider facts. Unknowns are explicit, prices are never currency-converted or blended, and no visitor telemetry is retained.",
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
        summary: "Get active dataset metadata",
        operationId: "getMetadata",
        responses: {
          "200": jsonResponse(
            "Active dataset metadata",
            "DatasetMetadata",
            "metadata",
            {
              publication_id: "pub_00000000-0000-4000-8000-000000000001",
              schema_version: "1.0.0",
              api_version: "1",
              methodology_version: "1.0.0",
              methodology_effective_at: "2026-08-01T00:00:00.000Z",
              methodology_url: "https://example.invalid/methodology/1.0.0",
              precision_vocabulary_version: "1.0.0",
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
          ...commonErrors,
        },
      },
      ...protocolOperations(
        "getMetadata",
        "Get active dataset metadata",
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
    "/models/{model_id_or_slug}": detailOperation(
      "getModel",
      "Get a canonical model",
      "ModelDetail",
      "model_id_or_slug",
      "Stable model ID or current/historical slug.",
    ),
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
    ),
    "/openapi.json": {
      get: {
        operationId: "getOpenApi",
        summary: "Get the OpenAPI contract",
        responses: {
          "200": {
            description: "This OpenAPI document",
            headers: responseHeaders("contract"),
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          "429": commonErrors["429"],
          "405": commonErrors["405"],
        },
      },
      ...protocolOperations(
        "getOpenApi",
        "Get the OpenAPI contract",
        [],
        "contract",
      ),
    },
  },
  components: { schemas: apiSchemas },
} as const;

const files = new Map<string, string>([
  ["openapi.json", `${JSON.stringify(openapi, null, 2)}\n`],
  ...Object.entries(generatedSchemas).map(
    ([name, schema]) =>
      [
        `schemas/${name}.schema.json`,
        `${JSON.stringify(schema, null, 2)}\n`,
      ] as const,
  ),
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

if (!check)
  await mkdir(resolve(generatedDirectory, "schemas"), { recursive: true });

for (const [relativePath, contents] of files) {
  const path = resolve(generatedDirectory, relativePath);
  if (check) {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing !== contents) mismatches.push(relativePath);
  } else {
    await writeFile(path, contents, { encoding: "utf8" });
  }
}

if (mismatches.length > 0) {
  throw new Error(`Generated contracts are stale: ${mismatches.join(", ")}`);
}
