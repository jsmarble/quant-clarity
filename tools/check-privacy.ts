import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

import { parse, type ParseError } from "jsonc-parser";

import {
  findBrowserContentViolations,
  findContentViolations,
  findControlledPipelineContentViolations,
  findGeneratedArtifactViolations,
  validateApiWorkerConfig,
  validateGeneratedFrontendConfig,
  validatePublicWorkerConfig,
} from "./privacy-policy.js";

const controlledPipelineFiles = [
  "apps/pipeline/src/model-variant-name-search-staging.ts",
  "apps/pipeline/src/readiness-commit-v3.ts",
  "apps/pipeline/src/serving-restore-rebuild-v3.ts",
  "apps/pipeline/src/serving-switch.ts",
];

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

async function files(
  directory: string,
  excludedDirectories = new Set([
    ".astro",
    ".wrangler",
    "dist",
    "dist-worker",
    "node_modules",
  ]),
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter(
        (entry) => !entry.isDirectory() || !excludedDirectories.has(entry.name),
      )
      .map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? files(path, excludedDirectories)
          : Promise.resolve([path]);
      }),
  );
  return nested.flat();
}

const violations: string[] = [];
for (const candidate of controlledPipelineFiles) {
  const path = resolve(candidate);
  const exists = await stat(path).then(
    () => true,
    () => false,
  );
  if (!exists) continue;
  const contents = await readFile(path, "utf8");
  for (const label of findControlledPipelineContentViolations(contents))
    violations.push(`${candidate}: ${label}`);
}
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
  const configurationLabels = root.endsWith("/apps/api")
    ? validateApiWorkerConfig(parsed)
    : validatePublicWorkerConfig(parsed, true);
  for (const label of configurationLabels)
    violations.push(`${relative(process.cwd(), configurationPath)}: ${label}`);

  if (!root.endsWith("/apps/web")) {
    const builtRoot = join(root, "dist");
    const builtExists = await stat(builtRoot).then(
      () => true,
      () => false,
    );
    if (!builtExists) {
      violations.push(
        `${relative(process.cwd(), builtRoot)}: final Worker artifact is missing`,
      );
      continue;
    }
    for (const path of await files(builtRoot, new Set())) {
      if (![".js", ".mjs"].includes(extname(path))) continue;
      const contents = await readFile(path, "utf8");
      for (const label of findGeneratedArtifactViolations(contents))
        violations.push(`${relative(process.cwd(), path)}: ${label}`);
    }
    continue;
  }
  const builtServer = join(root, "dist", "server");
  const builtExists = await stat(builtServer).then(
    () => true,
    () => false,
  );
  if (!builtExists) {
    violations.push("apps/web/dist/server: frontend build artifact is missing");
    continue;
  }

  const uploadContents: string[] = [];
  const generatedRoots = [
    builtServer,
    join(root, "dist", "client"),
    join(root, "dist-worker"),
  ];
  for (const generatedRoot of generatedRoots) {
    const generatedExists = await stat(generatedRoot).then(
      () => true,
      () => false,
    );
    if (!generatedExists) {
      violations.push(
        `${relative(process.cwd(), generatedRoot)}: frontend build artifact is missing`,
      );
      continue;
    }
    for (const path of await files(generatedRoot, new Set())) {
      if (!textExtensions.has(extname(path))) continue;
      const contents = await readFile(path, "utf8");
      if (generatedRoot.endsWith("/dist-worker")) uploadContents.push(contents);
      for (const label of [
        ...findGeneratedArtifactViolations(contents),
        ...findBrowserContentViolations(contents),
      ])
        violations.push(`${relative(process.cwd(), path)}: ${label}`);
    }
  }

  const generatedConfigurationPath = join(builtServer, "wrangler.json");
  const generatedConfiguration: unknown = JSON.parse(
    await readFile(generatedConfigurationPath, "utf8"),
  );
  for (const label of validateGeneratedFrontendConfig(generatedConfiguration))
    violations.push(
      `${relative(process.cwd(), generatedConfigurationPath)}: ${label}`,
    );

  const bundle = uploadContents.join("\n");
  if (/\bset-cookie\b/iu.test(bundle))
    violations.push(
      "apps/web/dist-worker: executable cookie header literal remains in final upload",
    );
  for (const [label, marker] of [
    [
      "disabled session driver is absent",
      "Astro sessions are disabled by QuantClarity policy.",
    ],
    [
      "cookie response guard is absent",
      "headers.delete(COOKIE_RESPONSE_HEADER)",
    ],
    [
      "framework cookie neutralization is absent",
      "x-quantclarity-blocked-cookie",
    ],
    ["private no-store guard is absent", "private, no-store"],
    ["request sanitization boundary is absent", "sanitizedApplicationRequest"],
    ["preview noindex guard is absent", "X-Robots-Tag"],
  ] as const) {
    if (!bundle.includes(marker))
      violations.push(`apps/web/dist/server: ${label}`);
  }
}

if (violations.length > 0)
  throw new Error(`Zero-visitor-data violations:\n${violations.join("\n")}`);
