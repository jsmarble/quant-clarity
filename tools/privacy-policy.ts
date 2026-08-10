type JsonObject = Record<string, unknown>;

const forbiddenContent = [
  ["console call", /\bconsole\s*\./u],
  ["browser cookie access", /\bdocument\s*\.\s*cookie\b/u],
  ["browser cookie store", /\bcookieStore\b/u],
  ["browser local storage", /\blocalStorage\b/u],
  ["browser session storage", /\bsessionStorage\b/u],
  ["browser IndexedDB", /\bindexedDB\b/u],
  ["browser beacon", /\bsendBeacon\b/u],
  ["analytics engine binding", /\banalytics_engine_datasets\b/u],
  ["Cloudflare Web Analytics beacon", /static\.cloudflareinsights\.com/u],
  ["Google analytics", /google-analytics\.com|googletagmanager\.com/u],
  ["third-party error telemetry", /sentry\.io|dsn\.ingest\./u],
  ["cookie-setting response", /["']Set-Cookie["']/iu],
  [
    "visitor header capture",
    /headers\s*\.\s*get\s*\(\s*["'](?:authorization|cf-ipcountry|cf-ray|cookie|forwarded|referer|user-agent|x-forwarded-for)["']/iu,
  ],
  ["Cloudflare visitor metadata capture", /\brequest\s*\.\s*cf\b/u],
  [
    "dynamic telemetry import",
    /import\s*\(\s*["'][^"']*(?:analytics|sentry|telemetry|tracking)[^"']*["']\s*\)/iu,
  ],
] as const;

const browserOnlyContent = [
  ["service worker", /\bnavigator\s*\.\s*serviceWorker\b/u],
  ["browser Cache API", /\bcaches\s*\.\s*open\b/u],
] as const;

const controlledPipelineContent = [
  ["request object", /\b(?:Request|URL|Headers)\b/u],
  [
    "visitor identifier",
    /\b(?:clientIp|ipAddress|userAgent|visitorId|requestId|correlationId|referrer)\b/iu,
  ],
  [
    "request telemetry",
    /\b(?:analytics|beacon|metrics|telemetry|traceparent|tracing)\b/iu,
  ],
  ["error payload interpolation", /(?:new\s+Error|super)\s*\(\s*`[^`]*\$\{/u],
] as const;

const generatedArtifactContent = forbiddenContent.filter(
  ([label]) =>
    ![
      "analytics engine binding",
      "console call",
      "cookie-setting response",
      "Cloudflare visitor metadata capture",
      "visitor header capture",
    ].includes(label),
);
const generatedConsoleContent = [
  [
    "console call",
    /\bconsole\s*\.\s*(?:assert|clear|count|countReset|debug|dir|dirxml|error|group|groupCollapsed|groupEnd|info|log|table|time|timeEnd|timeLog|trace|warn)\b/u,
  ],
] as const;

const generatedPersonalPathContent = [
  ["local macOS user path", /(?:file:\/\/)?\/Users\/[^/\s"']+\//u],
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function labelsFor(
  contents: string,
  rules: readonly (readonly [string, RegExp])[],
): string[] {
  return rules
    .filter(([, pattern]) => pattern.test(contents))
    .map(([label]) => label);
}

export function findContentViolations(contents: string): string[] {
  return labelsFor(contents, forbiddenContent);
}

export function findBrowserContentViolations(contents: string): string[] {
  return labelsFor(contents, browserOnlyContent);
}

export function findControlledPipelineContentViolations(
  contents: string,
): string[] {
  return [
    ...findContentViolations(contents),
    ...labelsFor(contents, controlledPipelineContent),
  ];
}

export function findGeneratedArtifactViolations(contents: string): string[] {
  return [
    ...labelsFor(contents, generatedArtifactContent),
    ...labelsFor(contents, generatedConsoleContent),
    ...labelsFor(contents, generatedPersonalPathContent),
  ];
}

export function validatePublicWorkerConfig(
  value: unknown,
  prohibitAiBinding: boolean,
): string[] {
  if (!isObject(value)) return ["configuration must be an object"];
  const errors: string[] = [];
  if (value.workers_dev !== false)
    errors.push("workers_dev must be explicitly disabled");
  if (value.preview_urls !== false)
    errors.push("preview_urls must be explicitly disabled");

  const observability = value.observability;
  if (!isObject(observability) || observability.enabled !== false) {
    errors.push("observability must be explicitly disabled");
  } else {
    for (const sectionName of ["logs", "traces"] as const) {
      const section = observability[sectionName];
      if (!isObject(section) || section.enabled !== false)
        errors.push(`${sectionName} must be explicitly disabled`);
      if (!isObject(section) || section.persist !== false)
        errors.push(`${sectionName}.persist must be explicitly disabled`);
      if (
        !isObject(section) ||
        !Array.isArray(section.destinations) ||
        section.destinations.length !== 0
      )
        errors.push(`${sectionName}.destinations must be an empty array`);
    }
    const logs = observability.logs;
    if (!isObject(logs) || logs.invocation_logs !== false)
      errors.push("logs.invocation_logs must be explicitly disabled");
  }

  for (const key of [
    "analytics_engine_datasets",
    "logfwdr",
    "logpush",
    "tail_consumers",
  ]) {
    if (key in value) errors.push(`${key} is prohibited on a public Worker`);
  }
  if (prohibitAiBinding && "ai" in value)
    errors.push(
      "AI binding is prohibited until the public-query privacy gate is approved",
    );
  return errors;
}

const apiRootKeys = [
  "$schema",
  "cache",
  "compatibility_date",
  "main",
  "name",
  "observability",
  "preview_urls",
  "ratelimits",
  "services",
  "vars",
  "workers_dev",
] as const;

function isExactDisabledApiCache(value: unknown): boolean {
  return (
    isObject(value) &&
    hasExactKeys(value, ["enabled"]) &&
    value.enabled === false
  );
}

function isExactApiObservability(value: unknown): boolean {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["enabled", "logs", "traces"]) ||
    value.enabled !== false
  )
    return false;
  const logs = value.logs;
  const traces = value.traces;
  return (
    isObject(logs) &&
    hasExactKeys(logs, [
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
    hasExactKeys(traces, ["destinations", "enabled", "persist"]) &&
    traces.enabled === false &&
    traces.persist === false &&
    Array.isArray(traces.destinations) &&
    traces.destinations.length === 0
  );
}

function isExactApiService(value: unknown): boolean {
  return (
    isObject(value) &&
    hasExactKeys(value, ["binding", "entrypoint", "service"]) &&
    value.binding === "CATALOG_QUERY" &&
    value.service === "quant-clarity-query-local" &&
    value.entrypoint === "CatalogQueryService"
  );
}

function isExactApiVariables(value: unknown): boolean {
  return (
    isObject(value) &&
    hasExactKeys(value, ["DEPLOYMENT_ENV"]) &&
    value.DEPLOYMENT_ENV === "local"
  );
}

function isExactApiRateLimit(
  value: unknown,
  expected: Readonly<{
    name: string;
    namespaceId: string;
    limit: number;
  }>,
): boolean {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ["name", "namespace_id", "simple"]) ||
    value.name !== expected.name ||
    value.namespace_id !== expected.namespaceId
  )
    return false;
  const simple = value.simple;
  return (
    isObject(simple) &&
    hasExactKeys(simple, ["limit", "period"]) &&
    simple.limit === expected.limit &&
    simple.period === 60
  );
}

export function validateApiWorkerConfig(value: unknown): string[] {
  const errors = validatePublicWorkerConfig(value, true);
  if (!isObject(value)) return errors;

  const allowedKeys = new Set<string>(apiRootKeys);
  for (const key of Object.keys(value))
    if (!allowedKeys.has(key))
      errors.push(
        `${key} is not an allowlisted public API configuration field`,
      );
  for (const key of apiRootKeys)
    if (!(key in value))
      errors.push(`${key} is required in the public API configuration`);

  if (value.$schema !== "../../node_modules/wrangler/config-schema.json")
    errors.push("$schema must reference the pinned local Wrangler schema");
  if (value.name !== "quant-clarity-api-local")
    errors.push("name must be quant-clarity-api-local");
  if (value.main !== "src/index.ts") errors.push("main must be src/index.ts");
  if (value.compatibility_date !== "2026-08-01")
    errors.push("compatibility_date must be 2026-08-01");
  if (!isExactDisabledApiCache(value.cache))
    errors.push("cache must contain only enabled: false");
  if (!isExactApiObservability(value.observability))
    errors.push(
      "observability must contain only the exact disabled logs and traces configuration",
    );
  if (!isExactApiVariables(value.vars))
    errors.push("vars must contain only DEPLOYMENT_ENV: local");

  const services = value.services;
  if (
    !Array.isArray(services) ||
    services.length !== 1 ||
    !isExactApiService((services as unknown[])[0])
  )
    errors.push(
      "services must contain only the local CATALOG_QUERY CatalogQueryService binding",
    );

  const rateLimits = value.ratelimits;
  if (
    !Array.isArray(rateLimits) ||
    rateLimits.length !== 2 ||
    !isExactApiRateLimit((rateLimits as unknown[])[0], {
      name: "READ_LIMITER",
      namespaceId: "1001",
      limit: 120,
    }) ||
    !isExactApiRateLimit((rateLimits as unknown[])[1], {
      name: "ROTATION_LIMITER",
      namespaceId: "1002",
      limit: 600,
    })
  )
    errors.push(
      "ratelimits must exactly match the local READ_LIMITER and ROTATION_LIMITER definitions",
    );

  return errors;
}

function isEmptyGeneratedBinding(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (!isObject(value)) return false;
  return Object.values(value).every(isEmptyGeneratedBinding);
}

export function validateGeneratedFrontendConfig(value: unknown): string[] {
  if (!isObject(value)) return ["generated configuration must be an object"];
  const errors: string[] = [];
  const generatedTelemetryKeys = new Set([
    "analytics_engine_datasets",
    "logfwdr",
    "logpush",
    "tail_consumers",
  ]);
  const normalized = Object.fromEntries(
    Object.entries(value).filter(([key]) => !generatedTelemetryKeys.has(key)),
  );

  for (const key of generatedTelemetryKeys) {
    if (!(key in value)) continue;
    if (!isEmptyGeneratedBinding(value[key]))
      errors.push(`${key} must remain empty in generated configuration`);
  }

  const emptyCapabilityKeys = [
    "agent_memory",
    "ai",
    "ai_search",
    "ai_search_namespaces",
    "artifacts",
    "browser",
    "cloudchamber",
    "containers",
    "d1_databases",
    "dispatch_namespaces",
    "durable_objects",
    "flagship",
    "hyperdrive",
    "kv_namespaces",
    "mtls_certificates",
    "pipelines",
    "queues",
    "r2_buckets",
    "secrets_store_secrets",
    "send_email",
    "unsafe_hello_world",
    "vectorize",
    "vpc_networks",
    "vpc_services",
    "worker_loaders",
    "workflows",
  ] as const;
  for (const key of emptyCapabilityKeys) {
    if (key in normalized && !isEmptyGeneratedBinding(normalized[key]))
      errors.push(
        `${key} persistence/AI binding is prohibited on the frontend`,
      );
  }

  const pythonModules = normalized.python_modules;
  if (
    pythonModules !== undefined &&
    (!isObject(pythonModules) ||
      !Array.isArray(pythonModules.exclude) ||
      pythonModules.exclude.length !== 1 ||
      pythonModules.exclude[0] !== "**/*.pyc")
  )
    errors.push("python_modules may contain only Wrangler's pyc exclusion");

  const assets = normalized.assets;
  if (
    !isObject(assets) ||
    assets.binding !== "ASSETS" ||
    assets.run_worker_first !== true
  )
    errors.push("assets must be the ASSETS run-worker-first binding");

  const services = normalized.services;
  if (
    !Array.isArray(services) ||
    services.length !== 1 ||
    !isObject(services[0]) ||
    services[0].binding !== "API" ||
    typeof services[0].service !== "string" ||
    !/^quant-clarity-api-(?:local|preview|production)$/u.test(
      services[0].service,
    )
  )
    errors.push(
      "services must contain only the environment-matched API binding",
    );

  const rateLimits = normalized.ratelimits;
  const rateLimitNames = Array.isArray(rateLimits)
    ? rateLimits
        .filter(isObject)
        .map((binding) => binding.name)
        .sort()
    : [];
  if (
    rateLimitNames.length !== 2 ||
    rateLimitNames[0] !== "READ_LIMITER" ||
    rateLimitNames[1] !== "ROTATION_LIMITER"
  )
    errors.push(
      "ratelimits must contain only READ_LIMITER and ROTATION_LIMITER",
    );

  const variables = normalized.vars;
  if (
    !isObject(variables) ||
    Object.keys(variables).length !== 1 ||
    !["local", "preview", "production"].includes(
      String(variables.DEPLOYMENT_ENV),
    )
  )
    errors.push("vars must contain only a valid DEPLOYMENT_ENV");

  const environment = isObject(variables)
    ? String(variables.DEPLOYMENT_ENV)
    : "";
  if (
    Array.isArray(services) &&
    isObject(services[0]) &&
    typeof services[0].service === "string" &&
    services[0].service !== `quant-clarity-api-${environment}`
  )
    errors.push("API service and DEPLOYMENT_ENV must match");

  const knownTopLevelKeys = new Set([
    ...emptyCapabilityKeys,
    ...generatedTelemetryKeys,
    "assets",
    "compatibility_date",
    "compatibility_flags",
    "configPath",
    "definedEnvironments",
    "dev",
    "exports",
    "jsx_factory",
    "jsx_fragment",
    "main",
    "migrations",
    "name",
    "no_bundle",
    "observability",
    "previews",
    "preview_urls",
    "python_modules",
    "ratelimits",
    "rules",
    "services",
    "topLevelName",
    "triggers",
    "userConfigPath",
    "vars",
    "workers_dev",
  ]);
  for (const key of Object.keys(value)) {
    if (!knownTopLevelKeys.has(key))
      errors.push(`${key} is not an allowlisted frontend configuration field`);
  }

  errors.push(...validatePublicWorkerConfig(normalized, true));
  return errors;
}
