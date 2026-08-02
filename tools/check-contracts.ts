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
const paths = openapi.paths;
if (!isObject(paths)) throw new Error("OpenAPI paths is missing.");

const requiredPaths = [
  "/metadata",
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
    if (method === "options" && Array.isArray(operation.parameters)) {
      for (const parameter of operation.parameters)
        if (isObject(parameter) && parameter.in !== "path")
          errors.push(`OPTIONS ${pathName} exposes a non-path parameter`);
    }
    if (method === "get") {
      const success = operation.responses["200"];
      if (isObject(success) && isObject(success.headers)) {
        for (const requiredHeader of [
          "Access-Control-Allow-Origin",
          "Cache-Control",
        ])
          if (!(requiredHeader in success.headers))
            errors.push(`GET ${pathName} 200 lacks ${requiredHeader}`);
        const cacheControl = success.headers["Cache-Control"];
        const cacheControlSchema = isObject(cacheControl)
          ? cacheControl.schema
          : undefined;
        const cacheControlExample = isObject(cacheControlSchema)
          ? cacheControlSchema.example
          : undefined;
        const hasQueryParameters =
          Array.isArray(operation.parameters) &&
          operation.parameters.some(
            (parameter) => isObject(parameter) && parameter.in === "query",
          );
        if (hasQueryParameters && cacheControlExample !== "private, no-store")
          errors.push(
            `GET ${pathName} has query parameters without private, no-store`,
          );
      } else errors.push(`GET ${pathName} 200 lacks response headers`);
      if (
        Array.isArray(operation.parameters) &&
        operation.parameters.some(
          (parameter) =>
            isObject(parameter) && parameter.name === "publication_id",
        )
      )
        errors.push(`GET ${pathName} invents a public publication pin`);
    }
    for (const [status, response] of Object.entries(operation.responses)) {
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
}

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
