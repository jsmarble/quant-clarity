import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

import { parse, type ParseError } from "jsonc-parser";

import {
  findBrowserContentViolations,
  findContentViolations,
  validatePublicWorkerConfig,
} from "./privacy-policy.js";

const configuredRoots = ["apps/api", "apps/query", "apps/web"];
const publicRoots: string[] = [];
for (const candidate of configuredRoots.map((path) => resolve(path))) {
  const exists = await stat(candidate).then(
    () => true,
    () => false,
  );
  if (exists) publicRoots.push(candidate);
}
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".mjs",
  ".ts",
  ".tsx",
]);

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.name !== "node_modules")
      .map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : Promise.resolve([path]);
      }),
  );
  return nested.flat();
}

const violations: string[] = [];
for (const root of publicRoots) {
  for (const path of await files(root)) {
    if (
      !textExtensions.has(extname(path)) ||
      path.endsWith("worker-configuration.d.ts") ||
      path.endsWith(".test.ts")
    )
      continue;
    const contents = await readFile(path, "utf8");
    const labels = findContentViolations(contents);
    if (root.endsWith("/apps/web"))
      labels.push(...findBrowserContentViolations(contents));
    for (const label of labels)
      violations.push(`${relative(process.cwd(), path)}: ${label}`);
  }

  const configurationPath = join(root, "wrangler.jsonc");
  const configuration = await readFile(configurationPath, "utf8");
  const parseErrors: ParseError[] = [];
  const parsed: unknown = parse(configuration, parseErrors, {
    allowTrailingComma: true,
  });
  if (parseErrors.length > 0) {
    violations.push(
      `${relative(process.cwd(), configurationPath)}: invalid JSONC configuration`,
    );
    continue;
  }
  for (const label of validatePublicWorkerConfig(parsed, true))
    violations.push(`${relative(process.cwd(), configurationPath)}: ${label}`);
}

if (violations.length > 0)
  throw new Error(`Zero-visitor-data violations:\n${violations.join("\n")}`);
