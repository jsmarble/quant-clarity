import { describe, expect, it } from "vitest";

import {
  findBrowserContentViolations,
  findContentViolations,
  findControlledPipelineContentViolations,
  findGeneratedArtifactViolations,
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
