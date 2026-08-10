import { createHash } from "node:crypto";

type JsonObject = Record<string, unknown>;

export interface PredeploymentInputs {
  policy: unknown;
  environments: unknown;
  npmConfiguration: string;
  npmLockfile: string;
  packageManifests: Readonly<Record<string, unknown>>;
  wranglerConfigs: Readonly<Record<string, unknown>>;
  workflowFiles: Readonly<Record<string, string>>;
}

export interface PredeploymentPaths {
  packagePaths: string[];
  wranglerPaths: string[];
  workflowPaths: string[];
}

export function classifyPredeploymentPaths(
  repositoryFiles: readonly string[],
): PredeploymentPaths {
  return {
    packagePaths: repositoryFiles
      .filter(
        (path) => path === "package.json" || path.endsWith("/package.json"),
      )
      .sort(),
    wranglerPaths: repositoryFiles
      .filter((path) =>
        /(?:^|\/)wrangler(?:\.[^/]+)?\.(?:jsonc?|toml)$/u.test(path),
      )
      .sort(),
    workflowPaths: repositoryFiles
      .filter(
        (path) =>
          /^\.github\/workflows\/.*\.ya?ml$/u.test(path) ||
          /(?:^|\/)action\.ya?ml$/u.test(path),
      )
      .sort(),
  };
}

const expectedPolicyKeys = [
  "allowed_wrangler_mode",
  "deployment_authorized",
  "environment_inventory",
  "environment_names",
  "npm_configuration",
  "npm_lockfile",
  "package_manifests",
  "schema_version",
  "workflow_files",
  "wrangler_configs",
] as const;

const forbiddenWranglerKeys = [
  "account_id",
  "ai",
  "analytics_engine_datasets",
  "browser",
  "containers",
  "d1_databases",
  "dispatch_namespaces",
  "durable_objects",
  "hyperdrive",
  "kv_namespaces",
  "logfwdr",
  "logpush",
  "mtls_certificates",
  "pipelines",
  "queues",
  "r2_buckets",
  "route",
  "routes",
  "secrets",
  "send_email",
  "tail_consumers",
  "vectorize",
  "workflows",
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonSha256(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function manifestAuthority(manifest: JsonObject): JsonObject {
  return {
    scripts: manifest.scripts,
    allowScripts: manifest.allowScripts ?? null,
  };
}

function validateObservability(value: unknown): boolean {
  if (
    !isObject(value) ||
    !exactKeys(value, ["enabled", "logs", "traces"]) ||
    value.enabled !== false
  )
    return false;
  const logs = value.logs;
  const traces = value.traces;
  return (
    isObject(logs) &&
    exactKeys(logs, [
      "destinations",
      "enabled",
      "invocation_logs",
      "persist",
    ]) &&
    logs.enabled === false &&
    logs.invocation_logs === false &&
    logs.persist === false &&
    Array.isArray(logs.destinations) &&
    logs.destinations.length === 0 &&
    isObject(traces) &&
    exactKeys(traces, ["destinations", "enabled", "persist"]) &&
    traces.enabled === false &&
    traces.persist === false &&
    Array.isArray(traces.destinations) &&
    traces.destinations.length === 0
  );
}

function validateScript(path: string, name: string, command: string): string[] {
  const errors: string[] = [];
  const label = `${path}#${name}`;
  const segments = command.split(/(?:&&|\|\||[;|])/u);
  for (const segment of segments) {
    if (!/\bwrangler\b/iu.test(segment)) continue;
    const isAllowedDryRun =
      /^\s*WRANGLER_SEND_METRICS=false\s+wrangler\s+deploy\s+--dry-run(?:\s|$)/u.test(
        segment,
      );
    const hasDeploy = /\bdeploy\b/iu.test(segment);
    if (hasDeploy && !isAllowedDryRun)
      errors.push(`${label} contains a non-allowlisted Wrangler deploy`);
    if (
      /\b(?:publish|upload|rollback|delete|secret|d1|r2|vectorize|workflows?|queues?|kv|hyperdrive|pages|containers?|versions?|triggers?)\b/iu.test(
        segment,
      )
    )
      errors.push(`${label} contains a prohibited Wrangler mutation command`);
  }
  if (/api\.cloudflare\.com/iu.test(command))
    errors.push(`${label} contains a direct Cloudflare API reference`);
  return errors;
}

export function validatePredeploymentPolicy(
  inputs: PredeploymentInputs,
): string[] {
  const errors: string[] = [];
  if (!isObject(inputs.policy)) return ["policy must be an object"];
  const policy = inputs.policy;
  if (!exactKeys(policy, expectedPolicyKeys))
    errors.push("policy must use the exact closed schema");
  if (policy.schema_version !== "1.0.0")
    errors.push("policy schema_version must be 1.0.0");
  if (policy.deployment_authorized !== false)
    errors.push("deployment_authorized must remain false");
  if (
    !isObject(policy.environment_inventory) ||
    !exactKeys(policy.environment_inventory, ["config_sha256", "path"]) ||
    policy.environment_inventory.path !== "config/environments.json" ||
    typeof policy.environment_inventory.config_sha256 !== "string"
  ) {
    errors.push("environment_inventory must use the exact closed schema");
  } else if (
    jsonSha256(inputs.environments) !==
    policy.environment_inventory.config_sha256
  ) {
    errors.push("environment inventory does not match the approved digest");
  }
  if (policy.allowed_wrangler_mode !== "telemetry_disabled_dry_run_only")
    errors.push("only telemetry-disabled Wrangler dry runs are allowed");

  for (const [key, expectedPath, contents] of [
    ["npm_configuration", ".npmrc", inputs.npmConfiguration],
    ["npm_lockfile", "package-lock.json", inputs.npmLockfile],
  ] as const) {
    const row = policy[key];
    if (
      !isObject(row) ||
      !exactKeys(row, ["file_sha256", "path"]) ||
      row.path !== expectedPath ||
      typeof row.file_sha256 !== "string"
    ) {
      errors.push(`${key} must use the exact closed schema`);
    } else if (sha256(contents) !== row.file_sha256) {
      errors.push(`${expectedPath} does not match the approved digest`);
    }
  }

  const environmentNames = policy.environment_names;
  if (
    !stringArray(environmentNames) ||
    JSON.stringify(environmentNames) !==
      JSON.stringify(["local", "test", "preview", "production"])
  )
    errors.push("environment_names must be the closed four-environment set");

  if (!isObject(inputs.environments)) {
    errors.push("environment inventory must be an object");
  } else {
    if (inputs.environments.status !== "logical_inventory_only")
      errors.push("environment inventory must remain logical-only");
    const rows = inputs.environments.environments;
    if (!Array.isArray(rows)) {
      errors.push("environment inventory must contain environments");
    } else {
      const actualNames = rows.map((row) =>
        isObject(row) ? row.name : undefined,
      );
      if (
        JSON.stringify(actualNames) !==
        JSON.stringify(["local", "test", "preview", "production"])
      )
        errors.push(
          "environment inventory rows must use the closed four-environment set in order",
        );
      for (const row of rows) {
        if (!isObject(row)) {
          errors.push("environment entries must be objects");
          continue;
        }
        if (row.provisioned !== false)
          errors.push(`${String(row.name)} must remain unprovisioned`);
        if (row.name !== "production" && row.may_access_production !== false)
          errors.push(`${String(row.name)} must not access production`);
      }
      const identities = rows
        .filter(isObject)
        .map((row) => row.write_identity)
        .filter((value): value is string => typeof value === "string");
      if (
        identities.length !== rows.length ||
        new Set(identities).size !== rows.length
      )
        errors.push(
          "environment write identities must be present and distinct",
        );
    }
  }

  const manifests = policy.package_manifests;
  const declaredManifestPaths: string[] = [];
  if (!Array.isArray(manifests)) {
    errors.push("package_manifests must be an array");
  } else {
    for (const row of manifests) {
      if (
        !isObject(row) ||
        !exactKeys(row, ["authority_sha256", "path"]) ||
        typeof row.path !== "string" ||
        typeof row.authority_sha256 !== "string"
      ) {
        errors.push("package manifest rows must use the exact closed schema");
        continue;
      }
      declaredManifestPaths.push(row.path);
      const manifest = inputs.packageManifests[row.path];
      if (!isObject(manifest) || !isObject(manifest.scripts)) {
        errors.push(`${row.path} must contain a scripts object`);
        continue;
      }
      if (jsonSha256(manifestAuthority(manifest)) !== row.authority_sha256)
        errors.push(
          `${row.path} scripts/allowScripts do not match the approved digest`,
        );
    }
  }
  if (
    JSON.stringify(declaredManifestPaths.sort()) !==
    JSON.stringify(Object.keys(inputs.packageManifests).sort())
  )
    errors.push("package manifest inventory does not match repository inputs");
  for (const [path, manifest] of Object.entries(inputs.packageManifests)) {
    if (!isObject(manifest) || !isObject(manifest.scripts)) {
      errors.push(`${path} must contain a scripts object`);
      continue;
    }
    for (const [name, command] of Object.entries(manifest.scripts)) {
      if (typeof command !== "string") {
        errors.push(`${path}#${name} must be a string`);
        continue;
      }
      if (name === "preverify" || name === "prepredeployment:check")
        errors.push(`${path}#${name} is a prohibited pre-gate lifecycle hook`);
      errors.push(...validateScript(path, name, command));
    }
  }

  const wranglerRows = policy.wrangler_configs;
  if (!Array.isArray(wranglerRows)) {
    errors.push("wrangler_configs must be an array");
  } else {
    const declaredPaths: string[] = [];
    for (const row of wranglerRows) {
      if (
        !isObject(row) ||
        !exactKeys(row, [
          "allowed_root_keys",
          "app",
          "config_sha256",
          "path",
          "worker_name",
        ]) ||
        typeof row.path !== "string" ||
        typeof row.worker_name !== "string" ||
        typeof row.config_sha256 !== "string" ||
        !stringArray(row.allowed_root_keys)
      ) {
        errors.push("wrangler policy rows must use the exact closed schema");
        continue;
      }
      declaredPaths.push(row.path);
      const config = inputs.wranglerConfigs[row.path];
      if (!isObject(config)) {
        errors.push(`${row.path} is missing or invalid`);
        continue;
      }
      if (config.name !== row.worker_name)
        errors.push(`${row.path} worker name does not match policy`);
      if (jsonSha256(config) !== row.config_sha256)
        errors.push(`${row.path} contents do not match the approved digest`);
      if (config.workers_dev !== false || config.preview_urls !== false)
        errors.push(`${row.path} must remain unrouted`);
      if (!validateObservability(config.observability))
        errors.push(`${row.path} observability must remain fully disabled`);
      const actualKeys = Object.keys(config).sort();
      const allowedKeys = [...row.allowed_root_keys].sort();
      if (JSON.stringify(actualKeys) !== JSON.stringify(allowedKeys))
        errors.push(`${row.path} root keys do not match the allowlist`);
      for (const key of forbiddenWranglerKeys) {
        if (key in config) errors.push(`${row.path} contains forbidden ${key}`);
      }
    }
    if (
      JSON.stringify(declaredPaths.sort()) !==
      JSON.stringify(Object.keys(inputs.wranglerConfigs).sort())
    )
      errors.push("Wrangler config inventory does not match tracked inputs");
  }

  const workflowRows = policy.workflow_files;
  const declaredWorkflowPaths: string[] = [];
  if (!Array.isArray(workflowRows)) {
    errors.push("workflow_files must be an array");
  } else {
    for (const row of workflowRows) {
      if (
        !isObject(row) ||
        !exactKeys(row, ["file_sha256", "path"]) ||
        typeof row.path !== "string" ||
        typeof row.file_sha256 !== "string"
      ) {
        errors.push("workflow rows must use the exact closed schema");
        continue;
      }
      declaredWorkflowPaths.push(row.path);
      const contents = inputs.workflowFiles[row.path];
      if (typeof contents !== "string") {
        errors.push(`${row.path} is missing or invalid`);
        continue;
      }
      if (sha256(contents) !== row.file_sha256)
        errors.push(`${row.path} contents do not match the approved digest`);
    }
  }
  if (
    JSON.stringify(declaredWorkflowPaths.sort()) !==
    JSON.stringify(Object.keys(inputs.workflowFiles).sort())
  )
    errors.push("workflow inventory does not match repository inputs");
  for (const [path, contents] of Object.entries(inputs.workflowFiles)) {
    if (path === ".github/workflows/ci.yml") {
      const bootstrapSteps = [
        "npm ci --ignore-scripts",
        "node --import tsx tools/check-predeployment.ts",
        "npm rebuild --strict-allow-scripts",
        "npm run verify",
      ].map((step) => contents.indexOf(step));
      if (
        bootstrapSteps.some((index) => index < 0) ||
        !bootstrapSteps.every(
          (index, position) =>
            position === 0 || index > bootstrapSteps[position - 1]!,
        )
      )
        errors.push(
          `${path} must bootstrap the embargo before lifecycle scripts and verification`,
        );
      if (/\bnpm\s+ci\b(?![^\n]*--ignore-scripts)/u.test(contents))
        errors.push(`${path} npm ci must disable lifecycle scripts`);
    }
    if (/^\s*environment\s*:/gmu.test(contents))
      errors.push(`${path} must not target a GitHub deployment environment`);
    if (
      /^\s*permissions\s*:\s*write-all\s*$/gmu.test(contents) ||
      /^\s*[a-z-]+\s*:\s*(?:write|admin)\s*$/gmu.test(contents)
    )
      errors.push(`${path} contains prohibited GitHub write permissions`);
    if (
      /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)|WRANGLER_API_TOKEN/u.test(contents)
    )
      errors.push(
        `${path} contains a Cloudflare deployment credential reference`,
      );
    for (const match of contents.matchAll(
      /\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/gu,
    )) {
      if (match[1] !== "GITHUB_TOKEN")
        errors.push(`${path} contains a non-platform secret reference`);
    }
    if (/^\s*secrets\s*:\s*inherit\s*$/gmu.test(contents))
      errors.push(`${path} must not inherit workflow secrets`);
    if (/api\.cloudflare\.com/iu.test(contents))
      errors.push(`${path} contains a direct Cloudflare API reference`);
    if (
      /\bwrangler\b[^\n]*(?:deploy|publish|upload|rollback|delete|secret|d1|r2|vectorize|workflows?|queues?|kv|hyperdrive|pages|containers?|versions?|triggers?)/iu.test(
        contents,
      )
    )
      errors.push(`${path} contains a Cloudflare mutation command`);
    if (
      /uses:\s*actions\/checkout@/u.test(contents) &&
      !/persist-credentials:\s*false/u.test(contents)
    )
      errors.push(`${path} checkout must disable credential persistence`);
    for (const match of contents.matchAll(/uses:\s*[^@\s]+@([^\s#]+)/gu)) {
      if (!/^[0-9a-f]{40}$/u.test(match[1] ?? ""))
        errors.push(`${path} action references must use full commit SHAs`);
    }
  }
  return errors;
}
