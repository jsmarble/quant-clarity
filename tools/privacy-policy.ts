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

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
