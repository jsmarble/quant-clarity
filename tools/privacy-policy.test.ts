import { describe, expect, it } from "vitest";

import {
  findBrowserContentViolations,
  findContentViolations,
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
});
