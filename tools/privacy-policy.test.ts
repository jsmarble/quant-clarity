import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  findBrowserContentViolations,
  findContentViolations,
  findControlledPipelineContentViolations,
  findGeneratedArtifactViolations,
  validateApiWorkerConfig,
  validateGeneratedFrontendConfig,
  validatePublicWorkerConfig,
} from "./privacy-policy.js";

function safeConfig(): Record<string, unknown> {
  return {
    workers_dev: false,
    preview_urls: false,
    observability: {
      enabled: false,
      logs: {
        enabled: false,
        invocation_logs: false,
        persist: false,
        destinations: [],
      },
      traces: { enabled: false, persist: false, destinations: [] },
    },
  };
}

function safeGeneratedConfig(): Record<string, unknown> {
  return {
    ...safeConfig(),
    assets: { binding: "ASSETS", run_worker_first: true },
    services: [{ binding: "API", service: "quant-clarity-api-local" }],
    ratelimits: [{ name: "READ_LIMITER" }, { name: "ROTATION_LIMITER" }],
    vars: { DEPLOYMENT_ENV: "local" },
  };
}

function safeApiConfig(): Record<string, unknown> {
  return {
    $schema: "../../node_modules/wrangler/config-schema.json",
    name: "quant-clarity-api-local",
    main: "src/index.ts",
    compatibility_date: "2026-08-01",
    ...safeConfig(),
    services: [
      {
        binding: "CATALOG_QUERY",
        service: "quant-clarity-query-local",
        entrypoint: "CatalogQueryService",
      },
    ],
    ratelimits: [
      {
        name: "READ_LIMITER",
        namespace_id: "1001",
        simple: { limit: 120, period: 60 },
      },
      {
        name: "ROTATION_LIMITER",
        namespace_id: "1002",
        simple: { limit: 600, period: 60 },
      },
    ],
  };
}

describe("zero-visitor-data static policy (GATE-zero-visitor-data)", () => {
  it("rejects representative browser persistence and telemetry mutations", () => {
    expect(findContentViolations("navigator.sendBeacon('/collect')")).toContain(
      "browser beacon",
    );
    expect(findContentViolations("cookieStore.set('visitor', '1')")).toContain(
      "browser cookie store",
    );
    expect(findContentViolations("import('@vendor/telemetry')")).toContain(
      "dynamic telemetry import",
    );
    expect(
      findContentViolations("response.headers.set('Set-Cookie', 'x=1')"),
    ).toContain("cookie-setting response");
    expect(findContentViolations("request.cf.country")).toContain(
      "Cloudflare visitor metadata capture",
    );
    expect(
      findBrowserContentViolations(
        "navigator.serviceWorker.register('/sw.js')",
      ),
    ).toContain("service worker");
    expect(
      findBrowserContentViolations("await caches.open('visitor')"),
    ).toContain("browser Cache API");
  });

  it("keeps controlled A2 pipeline adapters free of visitor inputs and echoed payloads", () => {
    expect(
      findControlledPipelineContentViolations(
        "export const run = (request: Request) => request.headers;",
      ),
    ).toEqual(expect.arrayContaining(["request object"]));
    expect(
      findControlledPipelineContentViolations(
        "throw new Error(`invalid payload ${payload}`);",
      ),
    ).toContain("error payload interpolation");
    expect(
      findControlledPipelineContentViolations(
        'throw new Error("controlled projection is invalid");',
      ),
    ).toEqual([]);
  });

  it("keeps the model/variant exact reader, RPC, and API seam free of visitor-data sinks", async () => {
    for (const path of [
      "apps/query/src/model-variant-exact-name.ts",
      "apps/query/src/catalog-query-rpc.ts",
      "apps/api/src/model-variant-exact-name-query.ts",
    ]) {
      const source = await readFile(path, "utf8");
      expect(findControlledPipelineContentViolations(source), path).toEqual([]);
    }
  });

  it("rejects telemetry export and enabled observability mutations", () => {
    const enabled = safeConfig();
    enabled.tail_consumers = [{ service: "tail" }];
    const observability = enabled.observability as Record<string, unknown>;
    const logs = observability.logs as Record<string, unknown>;
    logs.enabled = true;
    logs.destinations = ["destination"];
    expect(validatePublicWorkerConfig(enabled, false)).toEqual(
      expect.arrayContaining([
        "logs must be explicitly disabled",
        "logs.destinations must be an empty array",
        "tail_consumers is prohibited on a public Worker",
      ]),
    );
  });

  it("rejects public AI bindings before the privacy gate is approved", () => {
    const config = safeConfig();
    config.ai = { binding: "AI" };
    expect(validatePublicWorkerConfig(config, true)).toContain(
      "AI binding is prohibited until the public-query privacy gate is approved",
    );
  });

  it("accepts the complete explicit zero-data configuration", () => {
    expect(validatePublicWorkerConfig(safeConfig(), true)).toEqual([]);
  });

  it("allows only the named query service and two limiters on the public API", () => {
    expect(validateApiWorkerConfig(safeApiConfig())).toEqual([]);

    const directD1 = safeApiConfig();
    directD1.d1_databases = [
      { binding: "SERVING_DB", database_id: "not-a-real-id" },
    ];
    expect(validateApiWorkerConfig(directD1)).toContain(
      "d1_databases is not an allowlisted public API configuration field",
    );

    for (const [key, value] of [
      ["r2_buckets", [{ binding: "PRIVATE" }]],
      ["vectorize", [{ binding: "SEARCH" }]],
      ["pipelines", [{ binding: "EVENTS" }]],
      ["workflows", [{ binding: "CONTROL" }]],
    ] as const) {
      const capability = safeApiConfig();
      capability[key] = value;
      expect(validateApiWorkerConfig(capability)).toContain(
        `${key} is not an allowlisted public API configuration field`,
      );
    }

    const privateQuery = safeConfig();
    privateQuery.d1_databases = [{ binding: "SERVING_DB" }];
    expect(validatePublicWorkerConfig(privateQuery, true)).toEqual([]);
  });

  it("rejects wrong or multiple public API service bindings", () => {
    const wrong = safeApiConfig();
    wrong.services = [
      {
        binding: "CATALOG_QUERY",
        service: "quant-clarity-query-local",
        entrypoint: "WrongEntrypoint",
      },
    ];
    expect(validateApiWorkerConfig(wrong)).toContain(
      "services must contain only the local CATALOG_QUERY CatalogQueryService binding",
    );

    const multiple = safeApiConfig();
    multiple.services = [
      ...(multiple.services as unknown[]),
      { binding: "PIPELINE", service: "quant-clarity-pipeline-local" },
    ];
    expect(validateApiWorkerConfig(multiple)).toContain(
      "services must contain only the local CATALOG_QUERY CatalogQueryService binding",
    );
  });

  it("rejects alternate and unknown API root surfaces automatically", () => {
    for (const [key, value] of [
      ["env", { preview: {} }],
      ["previews", { enabled: true }],
      ["unsafe", { bindings: [{ name: "ESCAPE" }] }],
      ["routes", [{ pattern: "api.example.test/*" }]],
      ["route", "api.example.test/*"],
      ["streaming_tail_consumers", [{ service: "sink" }]],
      ["secrets", { API_KEY: "placeholder" }],
      ["cache", { binding: "CACHE" }],
      ["websearch", { binding: "SEARCH" }],
      ["stream", { binding: "STREAM" }],
      ["media", { binding: "MEDIA" }],
      ["version_metadata", { binding: "VERSION" }],
      ["text_blobs", { PAYLOAD: "payload.txt" }],
      ["data_blobs", { PAYLOAD: "payload.bin" }],
      ["wasm_modules", { MODULE: "module.wasm" }],
      ["rules", [{ type: "Text", globs: ["**/*.txt"] }]],
      ["future_capability", { binding: "UNKNOWN" }],
    ] as const) {
      const candidate = safeApiConfig();
      candidate[key] = value;
      expect(validateApiWorkerConfig(candidate), key).toContain(
        `${key} is not an allowlisted public API configuration field`,
      );
    }
  });

  it("rejects missing roots and nested service, limiter, or observability bypasses", () => {
    const missingMain = safeApiConfig();
    delete missingMain.main;
    expect(validateApiWorkerConfig(missingMain)).toContain(
      "main is required in the public API configuration",
    );

    const remoteService = safeApiConfig();
    const services = remoteService.services as Record<string, unknown>[];
    const service = services[0];
    if (service === undefined) throw new Error("safe API service is missing");
    service.remote = false;
    expect(validateApiWorkerConfig(remoteService)).toContain(
      "services must contain only the local CATALOG_QUERY CatalogQueryService binding",
    );

    const alternateLimiter = safeApiConfig();
    const rateLimits = alternateLimiter.ratelimits as Record<string, unknown>[];
    const rateLimit = rateLimits[0];
    if (rateLimit === undefined)
      throw new Error("safe API rate limiter is missing");
    const simple = rateLimit.simple as Record<string, unknown>;
    simple.limit = 121;
    simple.extra = false;
    expect(validateApiWorkerConfig(alternateLimiter)).toContain(
      "ratelimits must exactly match the local READ_LIMITER and ROTATION_LIMITER definitions",
    );

    const nestedObservability = safeApiConfig();
    const observability = nestedObservability.observability as Record<
      string,
      unknown
    >;
    const logs = observability.logs as Record<string, unknown>;
    logs.head_sampling_rate = 0;
    expect(validateApiWorkerConfig(nestedObservability)).toContain(
      "observability must contain only the exact disabled logs and traces configuration",
    );
  });

  it("audits normalized framework config without treating empty bindings as active", () => {
    const generated = safeGeneratedConfig();
    generated.analytics_engine_datasets = [];
    generated.kv_namespaces = [];
    generated.logfwdr = { bindings: [] };
    expect(validateGeneratedFrontendConfig(generated)).toEqual([]);

    generated.analytics_engine_datasets = [{ binding: "EVENTS" }];
    expect(validateGeneratedFrontendConfig(generated)).toContain(
      "analytics_engine_datasets must remain empty in generated configuration",
    );
  });

  it("keeps high-signal telemetry checks on generated framework artifacts", () => {
    expect(
      findGeneratedArtifactViolations("navigator.sendBeacon('/collect')"),
    ).toContain("browser beacon");
    expect(
      findGeneratedArtifactViolations("console.warn('framework diagnostic')"),
    ).toContain("console call");
    expect(
      findGeneratedArtifactViolations(
        'response.headers.append("Set-Cookie", "visitor=1")',
      ),
    ).not.toContain("cookie-setting response");
  });

  it("rejects every frontend capability outside the exact active allowlist", () => {
    for (const [key, value] of [
      ["queues", { producers: [{ binding: "JOBS" }] }],
      ["workflows", [{ binding: "FLOW" }]],
      ["hyperdrive", [{ binding: "DATABASE" }]],
      ["pipelines", [{ binding: "EVENTS" }]],
      ["send_email", [{ name: "MAIL" }]],
      ["vpc_services", [{ binding: "PRIVATE" }]],
    ] as const) {
      const generated = safeGeneratedConfig();
      generated[key] = value;
      expect(validateGeneratedFrontendConfig(generated)).toContain(
        `${key} persistence/AI binding is prohibited on the frontend`,
      );
    }
  });

  it("rejects personal build paths in generated artifacts", () => {
    expect(
      findGeneratedArtifactViolations(
        'const root = "file:///Users/operator/project";',
      ),
    ).toContain("local macOS user path");
  });
});
