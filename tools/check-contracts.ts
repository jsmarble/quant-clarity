import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { AnySchema } from "ajv";

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
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
for (const [name, schema] of Object.entries(components.schemas))
  validators.set(name, ajv.compile(schema as AnySchema));

const errors: string[] = [];
const paths = openapi.paths;
if (!isObject(paths)) throw new Error("OpenAPI paths is missing.");
for (const [pathName, pathItem] of Object.entries(paths)) {
  if (!isObject(pathItem)) continue;
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!isObject(operation) || !isObject(operation.responses)) continue;
    for (const [status, response] of Object.entries(operation.responses)) {
      if (!isObject(response) || !isObject(response.content)) continue;
      const media = response.content["application/json"];
      if (!isObject(media) || !("example" in media) || !isObject(media.schema))
        continue;
      const reference = media.schema.$ref;
      if (typeof reference !== "string") continue;
      const name = reference.split("/").at(-1) ?? "";
      const validate = validators.get(name);
      if (!validate?.(media.example))
        errors.push(
          `${method.toUpperCase()} ${pathName} ${status} example does not validate against ${name}: ${ajv.errorsText(validate?.errors)}`,
        );
    }
  }
}

if (errors.length > 0)
  throw new Error(`Contract example validation failed:\n${errors.join("\n")}`);
