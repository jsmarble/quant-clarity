import { readFile } from "node:fs/promises";

interface Environment {
  name?: unknown;
  provisioned?: unknown;
  resource_prefix?: unknown;
  write_identity?: unknown;
  may_access_production?: unknown;
}

interface Inventory {
  environments?: unknown;
}

const inventory = JSON.parse(
  await readFile("config/environments.json", "utf8"),
) as Inventory;
if (!Array.isArray(inventory.environments))
  throw new Error("Environment inventory must contain an environments array.");

const environments = inventory.environments as Environment[];
const expected = ["local", "test", "preview", "production"];
const names = environments.map((environment) => environment.name);
const prefixes = environments.map((environment) => environment.resource_prefix);
const identities = environments.map(
  (environment) => environment.write_identity,
);
const errors: string[] = [];

if (JSON.stringify(names) !== JSON.stringify(expected))
  errors.push(`Expected environments in order: ${expected.join(", ")}`);
for (const [label, values] of [
  ["resource prefixes", prefixes],
  ["write identities", identities],
] as const) {
  if (values.some((value) => typeof value !== "string" || value === ""))
    errors.push(`Every environment must define ${label}`);
  if (new Set(values).size !== values.length)
    errors.push(`Environment ${label} must be distinct`);
}
for (const environment of environments) {
  if (environment.provisioned !== false)
    errors.push(
      `${String(environment.name)} must remain unprovisioned in this inventory revision`,
    );
  if (
    environment.name !== "production" &&
    environment.may_access_production !== false
  )
    errors.push(`${String(environment.name)} must not have production access`);
}
if (
  environments.find((environment) => environment.name === "production")
    ?.may_access_production !== true
)
  errors.push(
    "Production is the only environment allowed to declare production access",
  );

if (errors.length > 0)
  throw new Error(`Environment isolation checks failed:\n${errors.join("\n")}`);
