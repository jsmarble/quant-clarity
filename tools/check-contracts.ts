import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { AnySchema } from "ajv";

import {
  API_ROUTE_POLICIES,
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_AUTHORITY_ROOT_VECTORS,
  PROVENANCE_V2_CANONICAL_JSON_CONTRACT,
  PROVENANCE_V2_COMPOSITE_ROOT_VECTORS,
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
  validateProvenanceV2ContractArtifacts,
  validateProvenanceV2CompositeRootVectors,
  validateProvenanceV2ConnectedRegistrationGraph,
  validateProvenanceV2ConnectedRegistrationDocumentVectors,
  validateProvenanceV2ConnectedSuccessorManifestVectors,
  validateProvenanceV2ConnectedTraversalVectors,
  validateProvenanceV2DocumentResolverContract,
  validateProvenanceV2RootBindingPlan,
} from "@quant-clarity/contracts";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const openapi = JSON.parse(
  await readFile(resolve("contracts/generated/openapi.json"), "utf8"),
) as JsonObject;
const openapiYaml = JSON.parse(
  await readFile(resolve("contracts/generated/openapi.yaml"), "utf8"),
) as JsonObject;
const provenanceArtifacts = [
  ["canonical-json.v1.json", PROVENANCE_V2_CANONICAL_JSON_CONTRACT],
  ["frame-contract.v1.json", PROVENANCE_V2_FRAME_CONTRACT],
  ["field-corpus.v1.json", PROVENANCE_V2_FIELD_CORPUS],
  [
    "raw-field-mapping-contract.v1.json",
    PROVENANCE_V2_RAW_FIELD_MAPPING_CONTRACT,
  ],
  ["registration-semantics.v1.json", PROVENANCE_V2_SEMANTIC_POLICY],
  [
    "successor-manifest-preimage.v1.json",
    PROVENANCE_V2_SUCCESSOR_MANIFEST_CONTRACT,
  ],
  ["root-registry.v1.json", PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY],
  ["root-binding-plan.v1.json", PROVENANCE_V2_ROOT_BINDING_PLAN],
  ["golden-vectors.v1.json", PROVENANCE_V2_AUTHORITY_ROOT_VECTORS],
  ["composite-root-vectors.v1.json", PROVENANCE_V2_COMPOSITE_ROOT_VECTORS],
  [
    "connected-registration-graph.v1.json",
    PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  ],
  [
    "connected-registration-document-vectors.v1.json",
    PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS,
  ],
  [
    "connected-successor-manifest-vectors.v1.json",
    PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS,
  ],
  [
    "connected-traversal-vectors.v1.json",
    PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS,
  ],
  [
    "registration-document-resolver-contract.v1.json",
    PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT,
  ],
] as const;

const compositeRootErrors = validateProvenanceV2CompositeRootVectors(
  PROVENANCE_V2_COMPOSITE_ROOT_VECTORS,
);
if (compositeRootErrors.length > 0)
  throw new Error(
    `Invalid provenance-v2 composite root vectors: ${compositeRootErrors.join("; ")}`,
  );

const connectedGraphErrors = validateProvenanceV2ConnectedRegistrationGraph(
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
);
if (connectedGraphErrors.length > 0)
  throw new Error(
    `Invalid provenance-v2 connected registration graph: ${connectedGraphErrors.join("; ")}`,
  );

const connectedDocumentErrors =
  validateProvenanceV2ConnectedRegistrationDocumentVectors(
    PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS,
  );
if (connectedDocumentErrors.length > 0)
  throw new Error(
    `Invalid provenance-v2 connected registration document vectors: ${connectedDocumentErrors.join("; ")}`,
  );

const connectedTraversalErrors = validateProvenanceV2ConnectedTraversalVectors(
  PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS,
);
if (connectedTraversalErrors.length > 0)
  throw new Error(
    `Invalid provenance-v2 connected traversal vectors: ${connectedTraversalErrors.join("; ")}`,
  );

const connectedSuccessorErrors =
  validateProvenanceV2ConnectedSuccessorManifestVectors(
    PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS,
  );
if (connectedSuccessorErrors.length > 0)
  throw new Error(
    `Invalid provenance-v2 connected successor manifest vectors: ${connectedSuccessorErrors.join("; ")}`,
  );

const rootBindingErrors = validateProvenanceV2RootBindingPlan(
  PROVENANCE_V2_ROOT_BINDING_PLAN,
);
if (rootBindingErrors.length > 0)
  throw new Error(
    `Invalid provenance-v2 root binding plan: ${rootBindingErrors.join("; ")}`,
  );
const documentResolverErrors = validateProvenanceV2DocumentResolverContract();
if (documentResolverErrors.length > 0)
  throw new Error(
    `Invalid provenance-v2 document resolver contract: ${documentResolverErrors.join("; ")}`,
  );
for (const [filename, expected] of provenanceArtifacts) {
  const generated = JSON.parse(
    await readFile(
      resolve("contracts/generated/provenance-v2", filename),
      "utf8",
    ),
  ) as unknown;
  if (JSON.stringify(generated) !== JSON.stringify(expected))
    throw new Error(`Generated provenance-v2 artifact drifted: ${filename}`);
  if (!isObject(generated) || generated.status !== "review_candidate")
    throw new Error(
      `Generated provenance-v2 artifact lacks review-candidate status: ${filename}`,
    );
}
for (const schemaName of [
  "ProvenanceV2AdapterReceipt",
  "ProvenanceV2AuthorityRootRegistry",
  "ProvenanceV2AuthorityRootVectors",
  "ProvenanceV2CompositeRootVectors",
  "ProvenanceV2ConnectedRegistrationGraph",
  "ProvenanceV2ConnectedSuccessorManifestVectors",
  "ProvenanceV2ConnectedTraversalVectors",
  "ProvenanceV2FieldCorpus",
  "ProvenanceV2RawFieldMapping",
  "ProvenanceV2RegistrationLimits",
  "ProvenanceV2RegistrationPlan",
  "ProvenanceV2RootBindingPlan",
  "ProvenanceV2SuccessorManifest",
]) {
  const schema = JSON.parse(
    await readFile(
      resolve("contracts/generated/schemas", `${schemaName}.schema.json`),
      "utf8",
    ),
  ) as unknown;
  if (
    !isObject(schema) ||
    schema["x-quantclarity-contract-status"] !== "review_candidate"
  )
    throw new Error(
      `Generated provenance-v2 schema lacks review-candidate status: ${schemaName}`,
    );
}
if (JSON.stringify(openapiYaml) !== JSON.stringify(openapi))
  throw new Error("OpenAPI JSON and YAML representations differ.");
const components = openapi.components;
if (!isObject(components) || !isObject(components.schemas))
  throw new Error("OpenAPI components.schemas is missing.");
const errors: string[] = [];
errors.push(
  ...validateProvenanceV2ContractArtifacts(
    PROVENANCE_V2_AUTHORITY_ROOT_VECTORS,
  ),
);
if (!Array.isArray(openapi.security) || openapi.security.length !== 0)
  errors.push("public API must remain anonymous with an empty security array");
if (
  isObject(components) &&
  isObject(components.securitySchemes) &&
  Object.keys(components.securitySchemes).length > 0
)
  errors.push("public API must not declare authentication schemes");

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addKeyword({
  keyword: "x-extensible-enum",
  schemaType: "array",
  valid: true,
});
ajv.addKeyword({
  keyword: "x-quantclarity-contract-status",
  schemaType: "string",
  valid: true,
});
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
for (const [name, schema] of Object.entries(components.schemas))
  validators.set(name, ajv.compile(schema as AnySchema));

const info = openapi.info;
if (isObject(info) && "license" in info)
  errors.push("public API must not inherit the source-code license");
if (
  !isObject(info) ||
  typeof info.description !== "string" ||
  !info.description.includes(
    "recursively ignore additive unknown object fields",
  ) ||
  !info.description.includes("tolerate bounded unknown values")
)
  errors.push(
    "public API description lacks the API-016 additive-field and extensible-value client rule",
  );
const paths = openapi.paths;
if (!isObject(paths)) throw new Error("OpenAPI paths is missing.");

const requiredPaths = [
  "/metadata",
  "/methodologies/{version}",
  "/model-families",
  "/model-families/{family_id_or_slug}",
  "/models",
  "/models/{model_id_or_slug}",
  "/models/{model_id}/offerings",
  "/variants",
  "/variants/{variant_id_or_slug}",
  "/variants/{variant_id}/offerings",
  "/providers",
  "/providers/{provider_id_or_slug}",
  "/providers/{provider_id}/offerings",
  "/offerings",
  "/offerings/{offering_id}",
  "/prices",
  "/prices/{price_id}",
  "/precision-observations",
  "/precision-observations/{precision_id}",
  "/evidence",
  "/evidence/{evidence_id}",
  "/search",
  "/openapi.json",
  "/openapi.yaml",
];
for (const requiredPath of requiredPaths)
  if (!(requiredPath in paths)) errors.push(`missing route: ${requiredPath}`);
  else {
    const pathItem = paths[requiredPath];
    if (!isObject(pathItem)) continue;
    for (const requiredMethod of ["get", "head", "options"])
      if (!(requiredMethod in pathItem))
        errors.push(`missing ${requiredMethod.toUpperCase()}: ${requiredPath}`);
  }

for (const [pathName, pathItem] of Object.entries(paths)) {
  if (!isObject(pathItem)) continue;
  for (const forbiddenMethod of ["post", "put", "patch", "delete"])
    if (forbiddenMethod in pathItem)
      errors.push(
        `${forbiddenMethod.toUpperCase()} ${pathName} is not read-only`,
      );
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!isObject(operation) || !isObject(operation.responses)) continue;
    if (
      "security" in operation &&
      (!Array.isArray(operation.security) || operation.security.length !== 0)
    )
      errors.push(
        `${method.toUpperCase()} ${pathName} must not override anonymous security`,
      );
    const operationParameters = Array.isArray(operation.parameters)
      ? operation.parameters
      : [];
    for (const parameter of operationParameters) {
      if (!isObject(parameter)) continue;
      const normalizedName =
        typeof parameter.name === "string" ? parameter.name.toLowerCase() : "";
      if (
        parameter.in === "cookie" ||
        [
          "authorization",
          "baggage",
          "cookie",
          "proxy-authorization",
          "sentry-trace",
          "set-cookie",
          "traceparent",
          "tracestate",
          "x-api-key",
        ].includes(normalizedName) ||
        /(?:^|-)(?:actor|client|correlation|request|session|trace|visitor)-?id$/u.test(
          normalizedName,
        )
      )
        errors.push(
          `${method.toUpperCase()} ${pathName} declares a forbidden credential parameter`,
        );
    }
    if (method === "options") {
      if (Array.isArray(operation.parameters)) {
        for (const parameter of operation.parameters)
          if (isObject(parameter) && parameter.in !== "path")
            errors.push(`OPTIONS ${pathName} exposes a non-path parameter`);
      }
      const preflight = operation.responses["204"];
      const preflightHeaders = isObject(preflight)
        ? preflight.headers
        : undefined;
      for (const requiredHeader of [
        "Allow",
        "Access-Control-Allow-Headers",
        "Access-Control-Expose-Headers",
      ])
        if (
          !isObject(preflightHeaders) ||
          !(requiredHeader in preflightHeaders)
        )
          errors.push(`OPTIONS ${pathName} 204 lacks ${requiredHeader}`);
      const allow = isObject(preflightHeaders)
        ? preflightHeaders.Allow
        : undefined;
      const allowSchema = isObject(allow) ? allow.schema : undefined;
      if (!isObject(allowSchema) || allowSchema.const !== "GET, HEAD, OPTIONS")
        errors.push(`OPTIONS ${pathName} must declare the fixed Allow header`);
      const allowedHeaders = isObject(preflightHeaders)
        ? preflightHeaders["Access-Control-Allow-Headers"]
        : undefined;
      const allowedHeadersSchema = isObject(allowedHeaders)
        ? allowedHeaders.schema
        : undefined;
      if (
        !isObject(allowedHeadersSchema) ||
        allowedHeadersSchema.const !==
          "If-None-Match, X-QuantClarity-Publication"
      )
        errors.push(
          `OPTIONS ${pathName} must allow only the fixed conditional and publication headers`,
        );
      const exposedHeaders = isObject(preflightHeaders)
        ? preflightHeaders["Access-Control-Expose-Headers"]
        : undefined;
      const exposedHeadersSchema = isObject(exposedHeaders)
        ? exposedHeaders.schema
        : undefined;
      if (
        !isObject(exposedHeadersSchema) ||
        exposedHeadersSchema.const !== "ETag, X-QuantClarity-Publication"
      )
        errors.push(
          `OPTIONS ${pathName} must expose only ETag and the publication header`,
        );
    }
    if (method === "get" || method === "head") {
      const parameters: readonly unknown[] = Array.isArray(operation.parameters)
        ? operation.parameters
        : [];
      const hasQueryParameters = parameters.some(
        (parameter) => isObject(parameter) && parameter.in === "query",
      );
      const publicationPins = parameters.filter(
        (parameter) =>
          isObject(parameter) &&
          parameter.name === "X-QuantClarity-Publication",
      );
      if (publicationPins.length !== 1)
        errors.push(
          `${method.toUpperCase()} ${pathName} must expose exactly one publication-pin header`,
        );
      else {
        const publicationPin = publicationPins[0];
        const schema = isObject(publicationPin)
          ? publicationPin.schema
          : undefined;
        if (
          !isObject(publicationPin) ||
          publicationPin.in !== "header" ||
          publicationPin.required !== false ||
          !isObject(schema) ||
          schema.$ref !== "#/components/schemas/PublicationId"
        )
          errors.push(
            `${method.toUpperCase()} ${pathName} has an invalid publication-pin header`,
          );
      }
      const conditionalHeaders = parameters.filter(
        (parameter) =>
          isObject(parameter) && parameter.name === "If-None-Match",
      );
      if (conditionalHeaders.length !== 1)
        errors.push(
          `${method.toUpperCase()} ${pathName} must expose exactly one If-None-Match header`,
        );
      else {
        const conditionalHeader = conditionalHeaders[0];
        if (
          !isObject(conditionalHeader) ||
          conditionalHeader.in !== "header" ||
          conditionalHeader.required !== false
        )
          errors.push(
            `${method.toUpperCase()} ${pathName} has an invalid If-None-Match header`,
          );
      }
      if (
        parameters.some(
          (parameter) =>
            isObject(parameter) &&
            parameter.in === "query" &&
            parameter.name === "publication_id",
        )
      )
        errors.push(
          `${method.toUpperCase()} ${pathName} invents a public publication pin query parameter`,
        );

      const success = operation.responses["200"];
      if (isObject(success) && isObject(success.headers)) {
        for (const requiredHeader of [
          "Access-Control-Allow-Origin",
          "Access-Control-Expose-Headers",
          "Cache-Control",
          "ETag",
          "X-QuantClarity-Publication",
        ])
          if (!(requiredHeader in success.headers))
            errors.push(
              `${method.toUpperCase()} ${pathName} 200 lacks ${requiredHeader}`,
            );
        const exposedHeaders = success.headers["Access-Control-Expose-Headers"];
        const exposedHeadersSchema = isObject(exposedHeaders)
          ? exposedHeaders.schema
          : undefined;
        if (
          !isObject(exposedHeadersSchema) ||
          exposedHeadersSchema.const !== "ETag, X-QuantClarity-Publication"
        )
          errors.push(
            `${method.toUpperCase()} ${pathName} 200 exposes the wrong response headers`,
          );
      } else
        errors.push(
          `${method.toUpperCase()} ${pathName} 200 lacks response headers`,
        );

      if (hasQueryParameters) {
        for (const [status, response] of Object.entries(operation.responses)) {
          const headers = isObject(response) ? response.headers : undefined;
          const cacheControl = isObject(headers)
            ? headers["Cache-Control"]
            : undefined;
          const cacheControlSchema = isObject(cacheControl)
            ? cacheControl.schema
            : undefined;
          if (
            !isObject(cacheControlSchema) ||
            cacheControlSchema.const !== "private, no-store"
          )
            errors.push(
              `${method.toUpperCase()} ${pathName} ${status} has query parameters without private, no-store`,
            );
        }
      }

      const notModified = operation.responses["304"];
      const notModifiedHeaders = isObject(notModified)
        ? notModified.headers
        : undefined;
      if (!isObject(notModified) || "content" in notModified)
        errors.push(
          `${method.toUpperCase()} ${pathName} must define a bodyless 304 response`,
        );
      for (const requiredHeader of [
        "Cache-Control",
        "ETag",
        "X-QuantClarity-Publication",
      ])
        if (
          !isObject(notModifiedHeaders) ||
          !(requiredHeader in notModifiedHeaders)
        )
          errors.push(
            `${method.toUpperCase()} ${pathName} 304 lacks ${requiredHeader}`,
          );
    }
    for (const [status, response] of Object.entries(operation.responses)) {
      const responseHeaders = isObject(response) ? response.headers : null;
      if (isObject(responseHeaders)) {
        const normalizedHeaderNames = new Set(
          Object.keys(responseHeaders).map((name) => name.toLowerCase()),
        );
        for (const forbiddenHeader of [
          "Access-Control-Allow-Credentials",
          "Server-Timing",
          "Set-Cookie",
          "Baggage",
          "CF-Ray",
          "Sentry-Trace",
          "Traceparent",
          "Tracestate",
          "X-Cache",
          "X-Correlation-ID",
          "X-Request-ID",
        ])
          if (normalizedHeaderNames.has(forbiddenHeader.toLowerCase()))
            errors.push(
              `${method.toUpperCase()} ${pathName} ${status} declares forbidden ${forbiddenHeader}`,
            );
        for (const normalizedName of normalizedHeaderNames)
          if (
            /(?:^|-)(?:actor|client|correlation|request|session|trace|visitor)-?id$/u.test(
              normalizedName,
            )
          )
            errors.push(
              `${method.toUpperCase()} ${pathName} ${status} declares a correlation or visitor identifier header`,
            );
        const cacheHeaders = Object.entries(responseHeaders).filter(
          ([name]) => name.toLowerCase() === "cache-control",
        );
        if (cacheHeaders.length > 1)
          errors.push(
            `${method.toUpperCase()} ${pathName} ${status} declares duplicate Cache-Control headers`,
          );
        for (const [, cacheControl] of cacheHeaders) {
          const cacheSchema = isObject(cacheControl)
            ? cacheControl.schema
            : null;
          const allowedCachePolicies = new Set([
            "private, no-store",
            "private, max-age=0, must-revalidate",
          ]);
          const closedConst =
            isObject(cacheSchema) &&
            cacheSchema.type === "string" &&
            typeof cacheSchema.const === "string" &&
            allowedCachePolicies.has(cacheSchema.const) &&
            !Array.isArray(cacheSchema.enum);
          const closedEnum =
            isObject(cacheSchema) &&
            cacheSchema.type === "string" &&
            cacheSchema.const === undefined &&
            Array.isArray(cacheSchema.enum) &&
            cacheSchema.enum.length > 0 &&
            cacheSchema.enum.every(
              (value) =>
                typeof value === "string" && allowedCachePolicies.has(value),
            );
          const hasOpenBranch =
            isObject(cacheSchema) &&
            [
              "allOf",
              "anyOf",
              "default",
              "example",
              "examples",
              "not",
              "oneOf",
            ].some((keyword) => keyword in cacheSchema);
          if ((!closedConst && !closedEnum) || hasOpenBranch)
            errors.push(
              `${method.toUpperCase()} ${pathName} ${status} declares a non-private or unconstrained cache policy`,
            );
        }
      }
      if (method === "head" && isObject(response) && "content" in response)
        errors.push(`HEAD ${pathName} ${status} must not declare a body`);
      if (status === "405") {
        const responseHeaders = isObject(response) ? response.headers : null;
        const allowHeader = isObject(responseHeaders)
          ? responseHeaders.Allow
          : null;
        const allowSchema = isObject(allowHeader) ? allowHeader.schema : null;
        if (
          !isObject(allowSchema) ||
          allowSchema.const !== "GET, HEAD, OPTIONS"
        )
          errors.push(
            `${method.toUpperCase()} ${pathName} 405 lacks the fixed Allow header`,
          );
      }
      if (!isObject(response) || !isObject(response.content)) continue;
      const media =
        response.content["application/json"] ??
        response.content["application/json; charset=utf-8"];
      if (!isObject(media) || !isObject(media.schema)) continue;
      const reference = media.schema.$ref;
      if (typeof reference !== "string") continue;
      const name = reference.split("/").at(-1) ?? "";
      const validate = validators.get(name);
      const examples = [
        ...(Object.hasOwn(media, "example")
          ? [["example", media.example] as const]
          : []),
        ...(isObject(media.examples)
          ? Object.entries(media.examples).flatMap(([exampleName, entry]) =>
              isObject(entry) && Object.hasOwn(entry, "value")
                ? ([[exampleName, entry.value]] as const)
                : [],
            )
          : []),
      ];
      for (const [exampleName, example] of examples) {
        if (!validate?.(example))
          errors.push(
            `${method.toUpperCase()} ${pathName} ${status} ${exampleName} does not validate against ${name}: ${ajv.errorsText(validate?.errors)}`,
          );
        if (
          name !== "ErrorEnvelope" ||
          !isObject(example) ||
          !isObject(example.error)
        )
          continue;
        const expectedCodes: Record<string, readonly string[]> = {
          "400": ["invalid_parameter", "invalid_cursor", "unsupported_filter"],
          "404": ["resource_not_found"],
          "405": ["method_not_allowed"],
          "409": ["publication_expired"],
          "413": ["query_too_large", "response_limit_exceeded"],
          "429": ["rate_limited"],
          "503": [
            "publication_not_ready",
            "search_degraded",
            "temporarily_unavailable",
          ],
        };
        const code = example.error.code;
        if (
          typeof code !== "string" ||
          !(expectedCodes[status] ?? []).includes(code)
        )
          errors.push(
            `${method.toUpperCase()} ${pathName} ${status} ${exampleName} has mismatched error code`,
          );
      }
    }
  }

  const getOperation = pathItem.get;
  const headOperation = pathItem.head;
  if (
    isObject(getOperation) &&
    isObject(getOperation.responses) &&
    isObject(headOperation) &&
    isObject(headOperation.responses)
  ) {
    const getStatuses = Object.keys(getOperation.responses).sort().join(",");
    const headStatuses = Object.keys(headOperation.responses).sort().join(",");
    if (getStatuses !== headStatuses)
      errors.push(`GET and HEAD ${pathName} response statuses differ`);
  }
}

const methodologyPath = paths["/methodologies/{version}"];
const methodologyGet = isObject(methodologyPath)
  ? methodologyPath.get
  : undefined;
const methodologyParametersValue: unknown = isObject(methodologyGet)
  ? methodologyGet.parameters
  : undefined;
const methodologyParameters: readonly unknown[] = Array.isArray(
  methodologyParametersValue,
)
  ? (methodologyParametersValue as unknown[])
  : [];
const methodologyVersion = methodologyParameters.find(
  (parameter) => isObject(parameter) && parameter.name === "version",
);
const methodologyVersionSchema = isObject(methodologyVersion)
  ? methodologyVersion.schema
  : undefined;
if (
  !isObject(methodologyVersionSchema) ||
  methodologyVersionSchema.maxLength !== 64 ||
  methodologyVersionSchema.pattern !== "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"
)
  errors.push("methodology version path grammar differs from the API kernel");
if (isObject(methodologyPath))
  for (const method of ["get", "head"] as const) {
    const operation = methodologyPath[method];
    if (!isObject(operation) || !isObject(operation.responses)) continue;
    for (const status of ["200", "304"] as const) {
      const response = operation.responses[status];
      const headers = isObject(response) ? response.headers : undefined;
      const cacheControl = isObject(headers)
        ? headers["Cache-Control"]
        : undefined;
      const schema = isObject(cacheControl) ? cacheControl.schema : undefined;
      if (!isObject(schema) || schema.const !== "private, no-store")
        errors.push(
          `${method.toUpperCase()} /methodologies/{version} ${status} must remain private, no-store`,
        );
      const vary = isObject(headers) ? headers.Vary : undefined;
      const varySchema = isObject(vary) ? vary.schema : undefined;
      if (
        !isObject(varySchema) ||
        varySchema.const !== "X-QuantClarity-Publication"
      )
        errors.push(
          `${method.toUpperCase()} /methodologies/{version} ${status} must use the exact publication Vary`,
        );
      const etag = isObject(headers) ? headers.ETag : undefined;
      const etagSchema = isObject(etag) ? etag.schema : undefined;
      if (!isObject(etagSchema) || etagSchema.pattern !== '^"[0-9a-f]{64}"$')
        errors.push(
          `${method.toUpperCase()} /methodologies/{version} ${status} must document the strong SHA-256 ETag`,
        );
    }
  }

const methodologyErrorStatuses = [
  "400",
  "404",
  "405",
  "409",
  "413",
  "429",
  "503",
] as const;
if (isObject(methodologyPath)) {
  const methodologySecurityHeaders: Readonly<Record<string, string>> = {
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  const checkMethodologySecurityHeaders = (
    method: string,
    status: string,
    headers: unknown,
  ) => {
    if (!isObject(headers)) return;
    for (const [name, expected] of Object.entries(methodologySecurityHeaders)) {
      const header = headers[name];
      const schema = isObject(header) ? header.schema : undefined;
      if (!isObject(schema) || schema.const !== expected)
        errors.push(
          `${method} /methodologies/{version} ${status} has an invalid ${name}`,
        );
    }
    if ("Strict-Transport-Security" in headers)
      errors.push(
        `${method} /methodologies/{version} ${status} must not advertise remote HSTS while local/test-only`,
      );
  };
  for (const method of ["get", "head"] as const) {
    const operation = methodologyPath[method];
    const responses = isObject(operation) ? operation.responses : undefined;
    if (!isObject(responses)) continue;
    for (const status of ["200", "304"] as const) {
      const response = responses[status];
      checkMethodologySecurityHeaders(
        method.toUpperCase(),
        status,
        isObject(response) ? response.headers : undefined,
      );
    }
  }
  for (const method of ["get", "head"] as const) {
    const operation = methodologyPath[method];
    if (!isObject(operation) || !isObject(operation.responses)) continue;
    for (const status of methodologyErrorStatuses) {
      const response = operation.responses[status];
      const headers = isObject(response) ? response.headers : undefined;
      if (!isObject(headers)) {
        errors.push(
          `${method.toUpperCase()} /methodologies/{version} ${status} headers are missing`,
        );
        continue;
      }
      checkMethodologySecurityHeaders(method.toUpperCase(), status, headers);
      const cacheControl = headers["Cache-Control"];
      const cacheSchema = isObject(cacheControl)
        ? cacheControl.schema
        : undefined;
      if (!isObject(cacheSchema) || cacheSchema.const !== "private, no-store")
        errors.push(
          `${method.toUpperCase()} /methodologies/{version} ${status} must remain private, no-store`,
        );
      if ("ETag" in headers)
        errors.push(
          `${method.toUpperCase()} /methodologies/{version} ${status} must not advertise ETag`,
        );
      for (const headerName of ["Vary", "X-QuantClarity-Publication"]) {
        const present = headerName in headers;
        if (present !== (status === "409"))
          errors.push(
            `${method.toUpperCase()} /methodologies/{version} ${status} has an invalid ${headerName} contract`,
          );
      }
      if (method === "head" && isObject(response) && "content" in response)
        errors.push(
          `HEAD /methodologies/{version} ${status} must remain bodyless`,
        );
      if (method === "get" && isObject(response) && !("content" in response))
        errors.push(
          `GET /methodologies/{version} ${status} must document its error body`,
        );
    }
  }

  const getResponses = isObject(methodologyPath.get)
    ? methodologyPath.get.responses
    : undefined;
  const getUnavailable = isObject(getResponses)
    ? JSON.stringify(getResponses["503"])
    : "";
  for (const expected of [
    "No public dataset has been published yet.",
    "The methodology detail is temporarily unavailable.",
    "The request cannot be safely rate limited.",
    "The service is temporarily unavailable.",
  ])
    if (!getUnavailable.includes(expected))
      errors.push(
        `GET /methodologies/{version} 503 omits runtime outcome: ${expected}`,
      );

  const options = methodologyPath.options;
  const responses = isObject(options) ? options.responses : undefined;
  if (!isObject(responses))
    errors.push("OPTIONS /methodologies/{version} responses are missing");
  else {
    for (const [status, response] of Object.entries(responses))
      checkMethodologySecurityHeaders(
        "OPTIONS",
        status,
        isObject(response) ? response.headers : undefined,
      );
    const statuses = Object.keys(responses).sort().join(",");
    if (statuses !== "204,400,404,413,429,503")
      errors.push(
        "OPTIONS /methodologies/{version} must document only 204, 400, 404, 413, 429, and 503",
      );
    for (const status of ["400", "404", "413", "429", "503"] as const) {
      const response = responses[status];
      const headers = isObject(response) ? response.headers : undefined;
      if (!isObject(response) || !isObject(headers) || !("content" in response))
        errors.push(
          `OPTIONS /methodologies/{version} ${status} must document a JSON error`,
        );
      if (isObject(headers)) {
        if (
          "ETag" in headers ||
          "Vary" in headers ||
          "X-QuantClarity-Publication" in headers
        )
          errors.push(
            `OPTIONS /methodologies/{version} ${status} advertises representation headers`,
          );
        const cacheControl = headers["Cache-Control"];
        const cacheSchema = isObject(cacheControl)
          ? cacheControl.schema
          : undefined;
        if (!isObject(cacheSchema) || cacheSchema.const !== "private, no-store")
          errors.push(
            `OPTIONS /methodologies/{version} ${status} must remain private, no-store`,
          );
      }
    }
    const unavailable = JSON.stringify(responses["503"]);
    for (const expected of [
      "The methodology detail is temporarily unavailable.",
      "The request cannot be safely rate limited.",
      "The service is temporarily unavailable.",
    ])
      if (!unavailable.includes(expected))
        errors.push(
          `OPTIONS /methodologies/{version} 503 omits runtime outcome: ${expected}`,
        );
    if (unavailable.includes("No public dataset has been published yet."))
      errors.push(
        "OPTIONS /methodologies/{version} 503 advertises unreachable publication resolution",
      );
    const preflight = responses["204"];
    const preflightHeaders = isObject(preflight)
      ? preflight.headers
      : undefined;
    const maxAge = isObject(preflightHeaders)
      ? preflightHeaders["Access-Control-Max-Age"]
      : undefined;
    const maxAgeSchema = isObject(maxAge) ? maxAge.schema : undefined;
    if (!isObject(maxAgeSchema) || maxAgeSchema.const !== 600)
      errors.push(
        "OPTIONS /methodologies/{version} 204 must advertise the exact 600-second preflight age",
      );
    if (isObject(preflightHeaders) && "Vary" in preflightHeaders)
      errors.push(
        "OPTIONS /methodologies/{version} 204 must remain input-independent without Vary",
      );
  }
}

const modelDetailPath = paths["/models/{model_id_or_slug}"];
if (!isObject(modelDetailPath))
  errors.push("Model detail OpenAPI path is missing");
else {
  const modelIdentifierPattern =
    "^(?:mdl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9]+(?:-[a-z0-9]+)*)$";
  const expectedCachePolicies = [
    "private, max-age=0, must-revalidate",
    "private, no-store",
  ];
  const expectedSecurityHeaderConstants: Readonly<Record<string, string>> = {
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  const requiredEverywhere = [
    "Access-Control-Allow-Origin",
    "Access-Control-Expose-Headers",
    "Cache-Control",
    ...Object.keys(expectedSecurityHeaderConstants),
    "Strict-Transport-Security",
  ];
  const headerSchema = (headers: unknown, name: string): JsonObject | null => {
    if (!isObject(headers)) return null;
    const header = headers[name];
    return isObject(header) && isObject(header.schema) ? header.schema : null;
  };
  const requireHeaders = (
    method: string,
    status: string,
    headers: unknown,
    names: readonly string[],
  ) => {
    for (const name of names)
      if (headerSchema(headers, name) === null)
        errors.push(`${method} Model detail ${status} lacks ${name}`);
  };
  const assertExactHeaderSet = (
    method: string,
    status: string,
    headers: unknown,
    expected: readonly string[],
  ) => {
    if (
      !isObject(headers) ||
      JSON.stringify(Object.keys(headers).sort()) !==
        JSON.stringify([...expected].sort())
    )
      errors.push(
        `${method} Model detail ${status} response-header set differs from the closed matrix`,
      );
  };
  const forbidHeaders = (
    method: string,
    status: string,
    headers: unknown,
    names: readonly string[],
  ) => {
    if (!isObject(headers)) return;
    for (const name of names)
      if (name in headers)
        errors.push(
          `${method} Model detail ${status} must not declare ${name}`,
        );
  };
  const assertCommonHeaderValues = (
    method: string,
    status: string,
    headers: unknown,
  ) => {
    for (const [name, value] of Object.entries(expectedSecurityHeaderConstants))
      if (headerSchema(headers, name)?.const !== value)
        errors.push(
          `${method} Model detail ${status} has an incorrect ${name}`,
        );
    const hsts = headerSchema(headers, "Strict-Transport-Security");
    if (
      !isObject(hsts) ||
      JSON.stringify(hsts.enum) !==
        JSON.stringify(["max-age=300", "max-age=31536000; includeSubDomains"])
    )
      errors.push(`${method} Model detail ${status} has an incorrect HSTS set`);
    if (headerSchema(headers, "Access-Control-Allow-Origin")?.const !== "*")
      errors.push(
        `${method} Model detail ${status} has an incorrect public CORS origin`,
      );
    if (
      headerSchema(headers, "Access-Control-Expose-Headers")?.const !==
      "ETag, X-QuantClarity-Publication"
    )
      errors.push(
        `${method} Model detail ${status} has an incorrect exposed-header set`,
      );
  };
  const assertHeaderConst = (
    method: string,
    status: string,
    headers: unknown,
    name: string,
    expected: unknown,
  ) => {
    if (headerSchema(headers, name)?.const !== expected)
      errors.push(`${method} Model detail ${status} has an incorrect ${name}`);
  };
  const assertEntityLength = (
    method: string,
    status: string,
    headers: unknown,
  ) => {
    const length = headerSchema(headers, "Content-Length");
    if (
      !isObject(length) ||
      length.type !== "integer" ||
      length.minimum !== 1 ||
      length.maximum !== 65_536
    )
      errors.push(
        `${method} Model detail ${status} has an incorrect Content-Length bound`,
      );
  };
  const jsonMedia = (response: unknown): JsonObject | null => {
    if (!isObject(response) || !isObject(response.content)) return null;
    if (
      JSON.stringify(Object.keys(response.content)) !==
      JSON.stringify(["application/json; charset=utf-8"])
    )
      return null;
    const media = response.content["application/json; charset=utf-8"];
    return isObject(media) ? media : null;
  };
  const assertJsonMedia = (
    method: string,
    status: string,
    response: unknown,
  ) => {
    if (jsonMedia(response) === null)
      errors.push(
        `${method} Model detail ${status} must declare application/json; charset=utf-8 content`,
      );
  };
  const assertErrorExample = (
    method: string,
    status: string,
    response: unknown,
    code: string,
    message: string,
  ) => {
    const media = jsonMedia(response);
    if (
      !isObject(media) ||
      Object.hasOwn(media, "examples") ||
      JSON.stringify(media.example) !==
        JSON.stringify({ error: { code, message } })
    )
      errors.push(
        `${method} Model detail ${status} lacks the exact fixed error example`,
      );
  };
  const expectedReadStatuses = [
    "200",
    "304",
    "308",
    "400",
    "404",
    "405",
    "409",
    "413",
    "429",
    "503",
  ];
  for (const method of ["get", "head"] as const) {
    const operation = modelDetailPath[method];
    const responses = isObject(operation) ? operation.responses : undefined;
    if (
      !isObject(responses) ||
      JSON.stringify(Object.keys(responses).sort()) !==
        JSON.stringify([...expectedReadStatuses].sort())
    )
      errors.push(
        `${method.toUpperCase()} Model detail status set differs from the closed runtime matrix`,
      );
    const parameters: readonly unknown[] =
      isObject(operation) && Array.isArray(operation.parameters)
        ? (operation.parameters as unknown[])
        : [];
    const identifier = parameters.find(
      (parameter) =>
        isObject(parameter) && parameter.name === "model_id_or_slug",
    );
    const identifierSchema = isObject(identifier) ? identifier.schema : null;
    if (
      !isObject(identifierSchema) ||
      identifierSchema.minLength !== 1 ||
      identifierSchema.maxLength !== 128 ||
      identifierSchema.pattern !== modelIdentifierPattern
    )
      errors.push(
        `${method.toUpperCase()} Model detail identifier grammar is not the closed stable-ID-or-slug grammar`,
      );
    if (
      !isObject(identifier) ||
      typeof identifier.description !== "string" ||
      !identifier.description.includes("percent-encoding") ||
      !identifier.description.includes("bare ?") ||
      !identifier.description.includes("trailing slash") ||
      !identifier.description.includes("extra path segment")
    )
      errors.push(
        `${method.toUpperCase()} Model detail does not document raw-target exclusions`,
      );
    const parameterIdentity = parameters
      .flatMap((parameter) =>
        isObject(parameter) &&
        typeof parameter.in === "string" &&
        typeof parameter.name === "string"
          ? [`${parameter.in}:${parameter.name}`]
          : [],
      )
      .sort();
    if (
      JSON.stringify(parameterIdentity) !==
      JSON.stringify(
        [
          "header:If-None-Match",
          "header:X-QuantClarity-Publication",
          "path:model_id_or_slug",
        ].sort(),
      )
    )
      errors.push(
        `${method.toUpperCase()} Model detail parameters differ from the closed anonymous allowlist`,
      );
    if (!isObject(responses)) continue;
    for (const [status, response] of Object.entries(responses)) {
      const headers = isObject(response) ? response.headers : null;
      requireHeaders(method.toUpperCase(), status, headers, requiredEverywhere);
      assertCommonHeaderValues(method.toUpperCase(), status, headers);
      if (status !== "200" && status !== "304")
        assertHeaderConst(
          method.toUpperCase(),
          status,
          headers,
          "Cache-Control",
          "private, no-store",
        );
    }
    const commonHeaders = [...requiredEverywhere];
    const exactHeaderSets: Readonly<Record<string, readonly string[]>> = {
      "200": [
        ...commonHeaders,
        "Content-Length",
        "ETag",
        "Vary",
        "X-QuantClarity-Publication",
      ],
      "304": [...commonHeaders, "ETag", "Vary", "X-QuantClarity-Publication"],
      "308": [
        ...commonHeaders,
        "Content-Length",
        "Location",
        "Vary",
        "X-QuantClarity-Publication",
      ],
      "400": [...commonHeaders, "Content-Length"],
      "404": [
        ...commonHeaders,
        "Content-Length",
        "Vary",
        "X-QuantClarity-Publication",
      ],
      "405": [...commonHeaders, "Allow", "Content-Length"],
      "409": [
        ...commonHeaders,
        "Content-Length",
        "Vary",
        "X-QuantClarity-Publication",
      ],
      "413": [...commonHeaders, "Content-Length"],
      "429": [...commonHeaders, "Content-Length", "Retry-After"],
      "503": [...commonHeaders, "Content-Length"],
    };
    for (const [status, expectedHeaders] of Object.entries(exactHeaderSets)) {
      const response = responses[status];
      assertExactHeaderSet(
        method.toUpperCase(),
        status,
        isObject(response) ? response.headers : null,
        expectedHeaders,
      );
    }
    for (const status of ["200", "304"]) {
      const response = responses[status];
      const headers = isObject(response) ? response.headers : null;
      const cacheControl = isObject(headers) ? headers["Cache-Control"] : null;
      const schema = isObject(cacheControl) ? cacheControl.schema : null;
      if (
        !isObject(schema) ||
        !Array.isArray(schema.enum) ||
        JSON.stringify(schema.enum) !== JSON.stringify(expectedCachePolicies)
      )
        errors.push(
          `${method.toUpperCase()} Model detail ${status} lacks the exact stable-ID/slug private cache policies`,
        );
    }
    const success = responses["200"];
    const successHeaders = isObject(success) ? success.headers : null;
    requireHeaders(method.toUpperCase(), "200", successHeaders, [
      "Content-Length",
      "ETag",
      "Vary",
      "X-QuantClarity-Publication",
    ]);
    if (headerSchema(successHeaders, "ETag")?.pattern !== '^"[0-9a-f]{64}"$')
      errors.push(
        `${method.toUpperCase()} Model detail 200 ETag is not strong`,
      );
    if (
      headerSchema(successHeaders, "Vary")?.const !==
      "X-QuantClarity-Publication"
    )
      errors.push(`${method.toUpperCase()} Model detail 200 Vary is incorrect`);
    assertEntityLength(method.toUpperCase(), "200", successHeaders);
    if (method === "get") {
      const media = jsonMedia(success);
      if (
        !isObject(media) ||
        !Object.hasOwn(media, "example") ||
        Object.hasOwn(media, "examples")
      )
        errors.push("GET Model detail 200 must declare a canonical example");
    }

    const notModified = responses["304"];
    const notModifiedHeaders = isObject(notModified)
      ? notModified.headers
      : null;
    requireHeaders(method.toUpperCase(), "304", notModifiedHeaders, [
      "ETag",
      "Vary",
      "X-QuantClarity-Publication",
    ]);
    forbidHeaders(method.toUpperCase(), "304", notModifiedHeaders, [
      "Content-Length",
      "Content-Type",
    ]);
    if (
      headerSchema(notModifiedHeaders, "ETag")?.pattern !== '^"[0-9a-f]{64}"$'
    )
      errors.push(
        `${method.toUpperCase()} Model detail 304 ETag is not strong`,
      );
    assertHeaderConst(
      method.toUpperCase(),
      "304",
      notModifiedHeaders,
      "Vary",
      "X-QuantClarity-Publication",
    );
    if (isObject(notModified) && "content" in notModified)
      errors.push(`${method.toUpperCase()} Model detail 304 must be bodyless`);

    const redirect = responses["308"];
    const redirectHeaders = isObject(redirect) ? redirect.headers : null;
    if (!isObject(redirect) || "content" in redirect)
      errors.push(`${method.toUpperCase()} Model detail 308 must be bodyless`);
    for (const header of [
      "Access-Control-Allow-Origin",
      "Access-Control-Expose-Headers",
      "Cache-Control",
      "Content-Length",
      "Location",
      "Vary",
      "X-QuantClarity-Publication",
    ])
      if (!isObject(redirectHeaders) || !(header in redirectHeaders))
        errors.push(`${method.toUpperCase()} Model detail 308 lacks ${header}`);
    forbidHeaders(method.toUpperCase(), "308", redirectHeaders, [
      "Content-Type",
      "ETag",
    ]);
    if (headerSchema(redirectHeaders, "Content-Length")?.const !== 0)
      errors.push(
        `${method.toUpperCase()} Model detail 308 Content-Length must be zero`,
      );
    if (
      headerSchema(redirectHeaders, "Location")?.pattern !==
      "^/v1/models/mdl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    )
      errors.push(
        `${method.toUpperCase()} Model detail 308 Location is not a verified relative stable-ID path`,
      );
    assertHeaderConst(
      method.toUpperCase(),
      "308",
      redirectHeaders,
      "Vary",
      "X-QuantClarity-Publication",
    );

    for (const status of ["400", "405", "413", "429", "503"]) {
      const response = responses[status];
      const headers = isObject(response) ? response.headers : null;
      requireHeaders(method.toUpperCase(), status, headers, ["Content-Length"]);
      assertEntityLength(method.toUpperCase(), status, headers);
      if (method === "get")
        assertJsonMedia(method.toUpperCase(), status, response);
      forbidHeaders(method.toUpperCase(), status, headers, [
        "ETag",
        "Vary",
        "X-QuantClarity-Publication",
      ]);
    }
    for (const status of ["404", "409"]) {
      const response = responses[status];
      const headers = isObject(response) ? response.headers : null;
      requireHeaders(method.toUpperCase(), status, headers, [
        "Content-Length",
        "Vary",
        "X-QuantClarity-Publication",
      ]);
      assertEntityLength(method.toUpperCase(), status, headers);
      if (method === "get")
        assertJsonMedia(method.toUpperCase(), status, response);
      assertHeaderConst(
        method.toUpperCase(),
        status,
        headers,
        "Vary",
        "X-QuantClarity-Publication",
      );
      forbidHeaders(method.toUpperCase(), status, headers, ["ETag"]);
    }
    if (
      headerSchema((responses["405"] as JsonObject).headers, "Allow")?.const !==
      "GET, HEAD, OPTIONS"
    )
      errors.push(
        `${method.toUpperCase()} Model detail 405 Allow is incorrect`,
      );
    if (
      headerSchema((responses["429"] as JsonObject).headers, "Retry-After")
        ?.const !== 60
    )
      errors.push(
        `${method.toUpperCase()} Model detail 429 Retry-After is not fixed at 60`,
      );
    if (method === "get") {
      const expectedErrorExamples: Readonly<
        Record<string, readonly [string, string]>
      > = {
        "400": ["invalid_parameter", "The Model detail request is invalid."],
        "404": ["resource_not_found", "The requested resource does not exist."],
        "405": [
          "method_not_allowed",
          "Only GET, HEAD, and OPTIONS are supported.",
        ],
        "409": [
          "publication_expired",
          "The requested publication is no longer available.",
        ],
        "413": [
          "query_too_large",
          "The request exceeds the configured size limit.",
        ],
        "429": ["rate_limited", "Rate limit exceeded."],
      };
      for (const [status, [code, message]] of Object.entries(
        expectedErrorExamples,
      ))
        assertErrorExample("GET", status, responses[status], code, message);
      const unavailableMedia = jsonMedia(responses["503"]);
      const unavailableExamples = isObject(unavailableMedia)
        ? unavailableMedia.examples
        : null;
      const expectedUnavailableExamples = {
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
      };
      if (
        !isObject(unavailableExamples) ||
        (isObject(unavailableMedia) &&
          Object.hasOwn(unavailableMedia, "example")) ||
        JSON.stringify(unavailableExamples) !==
          JSON.stringify(expectedUnavailableExamples)
      )
        errors.push(
          "GET Model detail 503 must declare the exact publication, query/runtime, and limiter/config examples",
        );
    }
  }
  const options = modelDetailPath.options;
  const optionsResponses = isObject(options) ? options.responses : null;
  const optionsParameters: readonly unknown[] =
    isObject(options) && Array.isArray(options.parameters)
      ? (options.parameters as unknown[])
      : [];
  const optionsIdentifier = optionsParameters.find(
    (parameter) => isObject(parameter) && parameter.name === "model_id_or_slug",
  );
  const optionsIdentifierSchema = isObject(optionsIdentifier)
    ? optionsIdentifier.schema
    : null;
  if (
    JSON.stringify(
      optionsParameters.flatMap((parameter) =>
        isObject(parameter) &&
        typeof parameter.in === "string" &&
        typeof parameter.name === "string"
          ? [`${parameter.in}:${parameter.name}`]
          : [],
      ),
    ) !== JSON.stringify(["path:model_id_or_slug"])
  )
    errors.push(
      "OPTIONS Model detail parameters differ from the closed anonymous allowlist",
    );
  if (
    !isObject(optionsIdentifierSchema) ||
    optionsIdentifierSchema.minLength !== 1 ||
    optionsIdentifierSchema.maxLength !== 128 ||
    optionsIdentifierSchema.pattern !== modelIdentifierPattern ||
    !isObject(optionsIdentifier) ||
    typeof optionsIdentifier.description !== "string" ||
    !optionsIdentifier.description.includes("percent-encoding") ||
    !optionsIdentifier.description.includes("bare ?") ||
    !optionsIdentifier.description.includes("trailing slash") ||
    !optionsIdentifier.description.includes("extra path segment")
  )
    errors.push(
      "OPTIONS Model detail identifier grammar/raw-target exclusions differ from GET/HEAD",
    );
  if (
    !isObject(optionsResponses) ||
    JSON.stringify(Object.keys(optionsResponses).sort()) !==
      JSON.stringify(["204", "400", "413", "429", "503"])
  )
    errors.push(
      "OPTIONS Model detail status set differs from the closed runtime matrix",
    );
  const preflight = isObject(optionsResponses) ? optionsResponses["204"] : null;
  const preflightHeaders = isObject(preflight) ? preflight.headers : null;
  const maxAge = isObject(preflightHeaders)
    ? preflightHeaders["Access-Control-Max-Age"]
    : null;
  const maxAgeSchema = isObject(maxAge) ? maxAge.schema : null;
  if (!isObject(maxAgeSchema) || maxAgeSchema.const !== 600)
    errors.push("Model detail OPTIONS must declare Access-Control-Max-Age 600");
  requireHeaders("OPTIONS", "204", preflightHeaders, [
    ...requiredEverywhere,
    "Access-Control-Allow-Headers",
    "Access-Control-Allow-Methods",
    "Access-Control-Max-Age",
    "Allow",
  ]);
  assertCommonHeaderValues("OPTIONS", "204", preflightHeaders);
  assertExactHeaderSet("OPTIONS", "204", preflightHeaders, [
    ...requiredEverywhere,
    "Access-Control-Allow-Headers",
    "Access-Control-Allow-Methods",
    "Access-Control-Max-Age",
    "Allow",
  ]);
  assertHeaderConst(
    "OPTIONS",
    "204",
    preflightHeaders,
    "Allow",
    "GET, HEAD, OPTIONS",
  );
  assertHeaderConst(
    "OPTIONS",
    "204",
    preflightHeaders,
    "Access-Control-Allow-Methods",
    "GET, HEAD, OPTIONS",
  );
  assertHeaderConst(
    "OPTIONS",
    "204",
    preflightHeaders,
    "Access-Control-Allow-Headers",
    "If-None-Match, X-QuantClarity-Publication",
  );
  assertHeaderConst(
    "OPTIONS",
    "204",
    preflightHeaders,
    "Cache-Control",
    "private, no-store",
  );
  forbidHeaders("OPTIONS", "204", preflightHeaders, [
    "Content-Length",
    "Content-Type",
    "ETag",
    "Vary",
    "X-QuantClarity-Publication",
  ]);
  if (isObject(preflight) && "content" in preflight)
    errors.push("OPTIONS Model detail 204 must be bodyless");
  if (isObject(optionsResponses))
    for (const status of ["400", "413", "429", "503"]) {
      const response = optionsResponses[status];
      const headers = isObject(response) ? response.headers : null;
      requireHeaders("OPTIONS", status, headers, [
        ...requiredEverywhere,
        "Content-Length",
      ]);
      assertCommonHeaderValues("OPTIONS", status, headers);
      assertHeaderConst(
        "OPTIONS",
        status,
        headers,
        "Cache-Control",
        "private, no-store",
      );
      assertEntityLength("OPTIONS", status, headers);
      assertJsonMedia("OPTIONS", status, response);
      forbidHeaders("OPTIONS", status, headers, [
        "ETag",
        "Vary",
        "X-QuantClarity-Publication",
      ]);
      const extraHeaders =
        status === "429"
          ? ["Content-Length", "Retry-After"]
          : ["Content-Length"];
      assertExactHeaderSet("OPTIONS", status, headers, [
        ...requiredEverywhere,
        ...extraHeaders,
      ]);
    }
  const optionsUnavailableMedia = isObject(optionsResponses)
    ? jsonMedia(optionsResponses["503"])
    : null;
  if (
    !isObject(optionsUnavailableMedia) ||
    Object.hasOwn(optionsUnavailableMedia, "examples") ||
    JSON.stringify(optionsUnavailableMedia.example) !==
      JSON.stringify({
        error: {
          code: "temporarily_unavailable",
          message: "The request cannot be safely rate limited.",
        },
      })
  )
    errors.push(
      "OPTIONS Model detail 503 must declare only the fixed limiter/config example",
    );
  if (isObject(optionsResponses)) {
    assertErrorExample(
      "OPTIONS",
      "400",
      optionsResponses["400"],
      "invalid_parameter",
      "The Model detail request is invalid.",
    );
    assertErrorExample(
      "OPTIONS",
      "413",
      optionsResponses["413"],
      "query_too_large",
      "The request exceeds the configured size limit.",
    );
    assertErrorExample(
      "OPTIONS",
      "429",
      optionsResponses["429"],
      "rate_limited",
      "Rate limit exceeded.",
    );
  }
}

const modelDetailSchema = components.schemas.ModelDetail;
const modelDetailProperties = isObject(modelDetailSchema)
  ? modelDetailSchema.properties
  : null;
const modelDetailMeta = isObject(modelDetailProperties)
  ? modelDetailProperties.meta
  : null;
const modelDetailMetaProperties = isObject(modelDetailMeta)
  ? modelDetailMeta.properties
  : null;
const modelDetailSort = isObject(modelDetailMetaProperties)
  ? modelDetailMetaProperties.sort
  : null;
const modelDetailFilters = isObject(modelDetailMetaProperties)
  ? modelDetailMetaProperties.filters
  : null;
if (
  !isObject(modelDetailMeta) ||
  modelDetailMeta.additionalProperties !== false ||
  !isObject(modelDetailMetaProperties) ||
  !isObject(modelDetailMetaProperties.resource) ||
  modelDetailMetaProperties.resource.const !== "models" ||
  !isObject(modelDetailSort) ||
  JSON.stringify(modelDetailSort.prefixItems) !==
    JSON.stringify([
      { const: "name", type: "string" },
      { const: "stable_id", type: "string" },
    ]) ||
  modelDetailSort.items !== false ||
  modelDetailSort.minItems !== 2 ||
  modelDetailSort.maxItems !== 2 ||
  !isObject(modelDetailFilters) ||
  modelDetailFilters.additionalProperties !== false ||
  !isObject(modelDetailFilters.properties) ||
  Object.keys(modelDetailFilters.properties).length !== 0
)
  errors.push(
    "ModelDetail meta must remain the fixed models/name-stable_id/empty-filter identity",
  );

const routePolicies: Record<
  string,
  (typeof API_ROUTE_POLICIES)[keyof typeof API_ROUTE_POLICIES]
> = {
  "/model-families": API_ROUTE_POLICIES.modelFamilies,
  "/models": API_ROUTE_POLICIES.models,
  "/models/{model_id}/offerings": API_ROUTE_POLICIES.offerings,
  "/variants": API_ROUTE_POLICIES.variants,
  "/variants/{variant_id}/offerings": API_ROUTE_POLICIES.offerings,
  "/providers": API_ROUTE_POLICIES.providers,
  "/providers/{provider_id}/offerings": API_ROUTE_POLICIES.offerings,
  "/offerings": API_ROUTE_POLICIES.offerings,
  "/prices": API_ROUTE_POLICIES.prices,
  "/precision-observations": API_ROUTE_POLICIES.precisionObservations,
  "/evidence": API_ROUTE_POLICIES.evidence,
  "/search": API_ROUTE_POLICIES.search,
};
for (const [pathName, policy] of Object.entries(routePolicies)) {
  const pathItem = paths[pathName];
  const get = isObject(pathItem) ? pathItem.get : undefined;
  const parameters =
    isObject(get) && Array.isArray(get.parameters) ? get.parameters : [];
  const byName = new Map(
    parameters.flatMap((parameter) =>
      isObject(parameter) && typeof parameter.name === "string"
        ? [[parameter.name, parameter] as const]
        : [],
    ),
  );
  for (const filter of policy.filters)
    if (!byName.has(filter))
      errors.push(`GET ${pathName} lacks filter parameter: ${filter}`);
  const sort = byName.get("sort");
  const sortSchema = isObject(sort) ? sort.schema : undefined;
  const sortEnum =
    isObject(sortSchema) && Array.isArray(sortSchema.enum)
      ? sortSchema.enum
      : [];
  if (JSON.stringify(sortEnum) !== JSON.stringify(policy.sorts))
    errors.push(`GET ${pathName} sort allowlist differs from route policy`);
  if (pathName === "/search") {
    const limit = byName.get("limit");
    const limitSchema = isObject(limit) ? limit.schema : undefined;
    if (!isObject(limitSchema) || limitSchema.maximum !== 20)
      errors.push("GET /search limit must be capped at 20");
    if (byName.get("q")?.required !== true)
      errors.push("GET /search must require q");
  }
}

const schemaDirectory = resolve("contracts/generated/schemas");
const generatedSchemaObjects = new Map<string, JsonObject>();
for (const filename of await readdir(schemaDirectory)) {
  if (!filename.endsWith(".schema.json")) continue;
  const schema = JSON.parse(
    await readFile(resolve(schemaDirectory, filename), "utf8"),
  ) as AnySchema;
  if (isObject(schema)) generatedSchemaObjects.set(filename, schema);
  const schemaAjv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(schemaAjv);
  schemaAjv.addKeyword({
    keyword: "x-extensible-enum",
    schemaType: "array",
    valid: true,
  });
  schemaAjv.addKeyword({
    keyword: "x-quantclarity-contract-status",
    schemaType: "string",
    valid: true,
  });
  try {
    schemaAjv.compile(schema);
  } catch (error) {
    errors.push(`${filename} does not compile: ${String(error)}`);
  }
}

for (const [filename, propertyNames] of [
  ["ModelFamily.schema.json", ["slug", "display_name"]],
  ["Model.schema.json", ["slug", "display_name"]],
  ["Variant.schema.json", ["slug", "display_name"]],
  ["Provider.schema.json", ["slug", "display_name"]],
] as const) {
  const schema = generatedSchemaObjects.get(filename);
  const properties = isObject(schema) ? schema.properties : undefined;
  for (const propertyName of propertyNames) {
    const property = isObject(properties)
      ? properties[propertyName]
      : undefined;
    if (!isObject(property) || !Array.isArray(property.anyOf))
      errors.push(
        `${filename} ${propertyName} is not evidence-bearing Fact<T>`,
      );
  }
}

const precisionFormat = generatedSchemaObjects.get(
  "PrecisionFormat.schema.json",
);
if (
  !isObject(precisionFormat) ||
  !Array.isArray(precisionFormat["x-extensible-enum"]) ||
  !isObject(precisionFormat.not)
)
  errors.push(
    "precision format is not an extensible enum that forbids unknown",
  );

const searchCollection = generatedSchemaObjects.get(
  "SearchCollection.schema.json",
);
const searchProperties = isObject(searchCollection)
  ? searchCollection.properties
  : undefined;
const searchMeta = isObject(searchProperties)
  ? searchProperties.meta
  : undefined;
const searchMetaProperties = isObject(searchMeta)
  ? searchMeta.properties
  : undefined;
const authoritativeDegradation = isObject(searchMetaProperties)
  ? searchMetaProperties.semantic_degraded
  : undefined;
const knownDegradationValues = [
  "none",
  "disabled",
  "eligibility_limit",
  "temporarily_unavailable",
  "not_applicable",
];
if (
  !isObject(authoritativeDegradation) ||
  authoritativeDegradation.type !== "string" ||
  authoritativeDegradation.minLength !== 1 ||
  authoritativeDegradation.maxLength !== 128 ||
  "default" in authoritativeDegradation ||
  !Array.isArray(authoritativeDegradation["x-extensible-enum"]) ||
  JSON.stringify(authoritativeDegradation["x-extensible-enum"]) !==
    JSON.stringify(knownDegradationValues) ||
  typeof authoritativeDegradation.description !== "string" ||
  !authoritativeDegradation.description.includes("authoritative") ||
  !authoritativeDegradation.description.includes("no default")
)
  errors.push(
    "SearchCollection metadata lacks the documented authoritative bounded degradation contract",
  );

const searchData = isObject(searchProperties)
  ? searchProperties.data
  : undefined;
const searchItems = isObject(searchData) ? searchData.items : undefined;
const searchVariants = isObject(searchItems) ? searchItems.anyOf : undefined;
if (
  !Array.isArray(searchVariants) ||
  searchVariants.length === 0 ||
  searchVariants.some((variant) => {
    const properties = isObject(variant) ? variant.properties : undefined;
    const mirror = isObject(properties)
      ? properties.semantic_degraded
      : undefined;
    return (
      !isObject(mirror) ||
      typeof mirror.description !== "string" ||
      !mirror.description.includes("compatibility mirror") ||
      !mirror.description.includes("exactly equal")
    );
  })
)
  errors.push(
    "SearchCollection results lack the documented degradation compatibility mirror",
  );

const publicContract = JSON.stringify(openapi);
for (const forbiddenPublicField of [
  "private_r2_key",
  "credential_handles",
  "commission",
  "request_correlation_id",
])
  if (publicContract.includes(forbiddenPublicField))
    errors.push(
      `public OpenAPI exposes forbidden field: ${forbiddenPublicField}`,
    );

if (errors.length > 0)
  throw new Error(`Contract validation failed:\n${errors.join("\n")}`);
