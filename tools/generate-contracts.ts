import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { GENERATED_SCHEMAS } from "@quant-clarity/contracts";

const generatedDirectory = resolve("contracts/generated");

const openapi = {
  openapi: "3.1.1",
  info: {
    title: "QuantClarity public API",
    version: "1.0.0",
    description:
      "Anonymous, read-only, neutral inference-provider facts. No visitor telemetry is retained.",
    license: { name: "MPL-2.0", identifier: "MPL-2.0" },
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
          "200": {
            description: "Active dataset metadata",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DatasetMetadata" },
                example: {
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
              },
            },
          },
          "400": {
            description: "Invalid request parameter",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
                example: {
                  error: {
                    code: "invalid_parameter",
                    message: "The request contains an invalid parameter.",
                  },
                },
              },
            },
          },
          "503": {
            description: "No publication is ready",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      DatasetMetadata: GENERATED_SCHEMAS.DatasetMetadata,
      ErrorEnvelope: GENERATED_SCHEMAS.ErrorEnvelope,
    },
  },
} as const;

const files = new Map<string, string>([
  ["openapi.json", `${JSON.stringify(openapi, null, 2)}\n`],
  ...Object.entries(GENERATED_SCHEMAS).map(
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
