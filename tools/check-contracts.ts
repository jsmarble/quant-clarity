import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { AnySchema } from "ajv";

import { API_ROUTE_POLICIES } from "@quant-clarity/contracts";

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
if (JSON.stringify(openapiYaml) !== JSON.stringify(openapi))
  throw new Error("OpenAPI JSON and YAML representations differ.");
const components = openapi.components;
if (!isObject(components) || !isObject(components.schemas))
  throw new Error("OpenAPI components.schemas is missing.");

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addKeyword({
  keyword: "x-extensible-enum",
  schemaType: "array",
  valid: true,
});
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
for (const [name, schema] of Object.entries(components.schemas))
  validators.set(name, ajv.compile(schema as AnySchema));

const errors: string[] = [];
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
      const media = response.content["application/json"];
      if (!isObject(media) || !("example" in media) || !isObject(media.schema))
        continue;
      const reference = media.schema.$ref;
      if (typeof reference !== "string") continue;
      const name = reference.split("/").at(-1) ?? "";
      const validate = validators.get(name);
      const example = media.example;
      if (!validate?.(example))
        errors.push(
          `${method.toUpperCase()} ${pathName} ${status} example does not validate against ${name}: ${ajv.errorsText(validate?.errors)}`,
        );
      if (
        name === "ErrorEnvelope" &&
        isObject(example) &&
        isObject(example.error)
      ) {
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
            `${method.toUpperCase()} ${pathName} ${status} has mismatched error code`,
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
