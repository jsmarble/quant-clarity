import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  renderApiPreflight,
  renderModelDetailGateResponse,
  renderModelDetailResponse,
} from "./api-response-renderer.js";
import { modelDetailCacheRequest } from "./model-detail-cache.js";
import { handleModelDetailHttp } from "./model-detail-http.js";
import type { ModelDetailResponsePlan } from "./model-detail-response-plan.js";

const RENDER_PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const RENDER_MODEL = "mdl_22222222-2222-4222-8222-222222222222";
const RUNTIME_FAMILY = "fam_22222222-2222-4222-8222-222222222222";
const RUNTIME_EVIDENCE = "evd_22222222-2222-4222-8222-222222222222";
const RUNTIME_ORIGIN = "https://orchestrator-runtime.api.example.test";
const RUNTIME_OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const RENDER_BYTES = new TextEncoder().encode(
  JSON.stringify({
    data: { model_id: RENDER_MODEL },
    meta: { publication_id: RENDER_PUBLICATION },
  }),
);
const RENDER_COMMON = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

const runtimeKnown = (value: unknown) => ({
  evidence_ids: [RUNTIME_EVIDENCE],
  observed_at: RUNTIME_OBSERVED_AT,
  state: "known",
  value,
});

const runtimeUnknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown",
  value: null,
});

const runtimeModel = () => ({
  active_parameters: runtimeUnknown(),
  architecture: runtimeUnknown(),
  authoritative_checkpoint_ids: [],
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: RUNTIME_OBSERVED_AT,
    value: 0,
  },
  checkpoints: [],
  context_window_tokens: runtimeUnknown(),
  display_name: runtimeKnown("Runtime Orchestrated Model"),
  family_id: RUNTIME_FAMILY,
  last_model_data_refresh: runtimeKnown(RUNTIME_OBSERVED_AT),
  license: runtimeUnknown(),
  maximum_output_tokens: runtimeUnknown(),
  modalities: runtimeUnknown(),
  model_id: RENDER_MODEL,
  publisher: runtimeKnown("Runtime Publisher"),
  release_date: runtimeUnknown(),
  slug: runtimeKnown("runtime-orchestrated-model"),
  source_quantization: runtimeUnknown(),
  source_weight_format: runtimeUnknown(),
  status: runtimeKnown("active"),
  total_parameters: runtimeUnknown(),
});

const renderPlan = (method: "GET" | "HEAD"): ModelDetailResponsePlan => ({
  bodyBytes: method === "HEAD" ? null : new Uint8Array(RENDER_BYTES),
  headers: {
    ...RENDER_COMMON,
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Content-Length": String(RENDER_BYTES.byteLength),
    "Content-Type": "application/json; charset=utf-8",
    ETag: `"${"a".repeat(64)}"`,
    Vary: "X-QuantClarity-Publication",
    "X-QuantClarity-Publication": RENDER_PUBLICATION,
  },
  method,
  status: 200,
});

const runtimeErrorPlan = (
  status: 404 | 409 | 503,
  method: "GET" | "HEAD",
): ModelDetailResponsePlan => {
  const error =
    status === 404
      ? {
          code: "resource_not_found",
          message: "The requested resource does not exist.",
        }
      : status === 409
        ? {
            code: "publication_expired",
            message: "The requested publication is no longer available.",
          }
        : {
            code: "temporarily_unavailable",
            message: "The Model detail is temporarily unavailable.",
          };
  const bodyBytes = new TextEncoder().encode(JSON.stringify({ error }));
  return {
    bodyBytes: method === "HEAD" ? null : bodyBytes,
    headers: {
      ...RENDER_COMMON,
      "Cache-Control": "private, no-store",
      "Content-Length": String(bodyBytes.byteLength),
      "Content-Type": "application/json; charset=utf-8",
      ...(status === 503
        ? {}
        : {
            Vary: "X-QuantClarity-Publication",
            "X-QuantClarity-Publication": RENDER_PUBLICATION,
          }),
    },
    method,
    status,
  };
};

describe("public API in workerd (API-013, API-024)", () => {
  it("runs the closed limiter-to-cache composition with native Worker objects", async () => {
    const key = modelDetailCacheRequest(
      RUNTIME_ORIGIN,
      RENDER_PUBLICATION,
      RENDER_MODEL,
    );
    if (key === null) throw new Error("runtime cache key fixture is invalid");
    await caches.default.delete(key);
    const events: string[] = [];
    const scheduled: Promise<void>[] = [];
    const limiter = (name: string): RateLimit => ({
      limit: () => {
        events.push(name);
        return Promise.resolve({ success: true });
      },
    });
    const cache = {
      match(request: Request) {
        events.push("cache.match");
        return caches.default.match(request);
      },
      put(request: Request, response: Response) {
        events.push("cache.put");
        return caches.default.put(request, response);
      },
    };
    const service = {
      readModelDetailV1: () => Promise.resolve(undefined),
      resolvePublicationV2: (input: unknown) => {
        events.push("resolve");
        const requiredAvailableUntilMs = (
          input as { requiredAvailableUntilMs: number }
        ).requiredAvailableUntilMs;
        return Promise.resolve({
          bookmark: "bookmark-runtime-orchestrator",
          outcome: "selected",
          publicationId: RENDER_PUBLICATION,
          requiredAvailableUntilMs,
        });
      },
      readModelDetailV2: () => {
        events.push("read");
        return Promise.resolve({
          lookupProvenance: {
            canonicalSlug: "runtime-orchestrated-model",
            matchedBy: "stable_id",
            projectionVersion: "model-slug@1",
          },
          model: runtimeModel(),
          outcome: "model",
          publicationId: RENDER_PUBLICATION,
          schemaVersion: "1.13.0",
        });
      },
    };
    const response = await handleModelDetailHttp(
      new Request(`https://visitor.example/v1/models/${RENDER_MODEL}`, {
        headers: { "CF-Connecting-IP": "2001:db8:abcd:12::99" },
      }),
      {
        cache,
        context: {
          waitUntil(promise) {
            events.push("waitUntil");
            scheduled.push(Promise.resolve(promise).then(() => undefined));
          },
        },
        environment: "test",
        nowMs: () => 1_785_774_000_000,
        protectedCacheOrigin: RUNTIME_ORIGIN,
        queryService: service,
        rateLimitSecret: "runtime-test-hmac-key-with-at-least-32-characters",
        readLimiter: limiter("limit.read"),
        rotationLimiter: limiter("limit.rotation"),
        subtle: crypto.subtle,
        transportPolicy: "local_test",
      },
    );
    await Promise.all(scheduled);
    try {
      expect(response.status).toBe(200);
      expect(
        (await response.json<{ data: { model_id: string } }>()).data.model_id,
      ).toBe(RENDER_MODEL);
      expect(events).toEqual([
        "limit.read",
        "limit.rotation",
        "resolve",
        "cache.match",
        "read",
        "cache.put",
        "waitUntil",
      ]);
    } finally {
      await caches.default.delete(key);
    }
  });

  it("renders exact Model GET and bodyless HEAD Response objects in workerd", async () => {
    const get = renderModelDetailResponse(renderPlan("GET"), "local_test");
    const head = renderModelDetailResponse(renderPlan("HEAD"), "local_test");

    expect(new Uint8Array(await get.arrayBuffer())).toEqual(RENDER_BYTES);
    expect(get.headers.get("Content-Length")).toBe(
      String(RENDER_BYTES.byteLength),
    );
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(await head.text()).toBe("");
    expect(head.headers.get("Content-Length")).toBe(
      get.headers.get("Content-Length"),
    );
  });

  it("renders bodyless preflight with preview HSTS in workerd", () => {
    const response = renderApiPreflight("preview_https");
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=300",
    );
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
  });

  it("renders fixed limiter and HEAD validation responses in workerd", async () => {
    const limited = renderModelDetailGateResponse(
      { kind: "rate_limited" },
      "GET",
      "preview_https",
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(limited.headers.get("Strict-Transport-Security")).toBe(
      "max-age=300",
    );

    const head = renderModelDetailGateResponse(
      {
        error: {
          code: "method_not_allowed",
          message: "must not be reflected",
          status: 405,
        },
        kind: "request_error",
      },
      "HEAD",
      "local_test",
    );
    expect(head.status).toBe(405);
    expect(head.body).toBeNull();
    expect(await head.text()).toBe("");
    expect(head.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("preserves conditional and redirect entity-header rules in workerd", () => {
    const success = renderPlan("GET");
    const conditional = renderModelDetailResponse(
      {
        ...success,
        bodyBytes: null,
        headers: {
          ...RENDER_COMMON,
          "Cache-Control": "private, max-age=0, must-revalidate",
          ETag: success.headers.ETag ?? "",
          Vary: "X-QuantClarity-Publication",
          "X-QuantClarity-Publication": RENDER_PUBLICATION,
        },
        status: 304,
      },
      "production_https_custom_hostname",
    );
    expect(conditional.status).toBe(304);
    expect(conditional.body).toBeNull();
    expect(conditional.headers.has("Content-Length")).toBe(false);
    expect(conditional.headers.has("Content-Type")).toBe(false);
    expect(conditional.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );

    const redirect = renderModelDetailResponse(
      {
        bodyBytes: null,
        headers: {
          ...RENDER_COMMON,
          "Cache-Control": "private, no-store",
          "Content-Length": "0",
          Location: `/v1/models/${RENDER_MODEL}`,
          Vary: "X-QuantClarity-Publication",
          "X-QuantClarity-Publication": RENDER_PUBLICATION,
        },
        method: "GET",
        status: 308,
      },
      "preview_https",
    );
    expect(redirect.status).toBe(308);
    expect(redirect.body).toBeNull();
    expect(redirect.headers.get("Location")).toBe(`/v1/models/${RENDER_MODEL}`);
    expect(redirect.headers.get("Content-Length")).toBe("0");
    expect(redirect.headers.has("ETag")).toBe(false);
    expect(redirect.headers.has("Content-Type")).toBe(false);
  });

  it.each([404, 409, 503] as const)(
    "renders closed %s GET and HEAD errors in workerd",
    async (status) => {
      const get = renderModelDetailResponse(
        runtimeErrorPlan(status, "GET"),
        "production_https_custom_hostname",
      );
      const head = renderModelDetailResponse(
        runtimeErrorPlan(status, "HEAD"),
        "production_https_custom_hostname",
      );
      expect(get.status).toBe(status);
      expect(await get.json()).toHaveProperty("error");
      expect(head.status).toBe(status);
      expect(head.body).toBeNull();
      expect(await head.text()).toBe("");
      expect(head.headers.get("Content-Length")).toBe(
        get.headers.get("Content-Length"),
      );
      expect(head.headers.get("Strict-Transport-Security")).toBe(
        "max-age=31536000; includeSubDomains",
      );
      expect(head.headers.has("ETag")).toBe(false);
      expect(head.headers.has("Location")).toBe(false);
      expect(head.headers.has("X-QuantClarity-Publication")).toBe(
        status !== 503,
      );
      expect(head.headers.has("Vary")).toBe(status !== 503);
    },
  );

  it("runs the real module handler and bindings with zero-data response controls", async () => {
    const response = await exports.default.fetch(
      new Request("https://api.example.test/v1/metadata", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.has("X-Request-ID")).toBe(false);
  });

  it.each([
    ["invalid query", "GET", "/v1/metadata?unexpected=1", 400],
    ["bare query marker", "GET", "/v1/metadata?", 400],
    ["preflight", "OPTIONS", "/v1/metadata", 204],
    ["mutation", "POST", "/v1/metadata", 405],
    ["unknown path", "GET", "/v1/not-present", 404],
    [
      "registered methodology without a publication",
      "GET",
      "/v1/methodologies/1.0.0",
      503,
    ],
    [
      "registered methodology preflight",
      "OPTIONS",
      "/v1/methodologies/1.0.0",
      204,
    ],
    ["unregistered methodology", "GET", "/v1/methodologies/2.0.0", 404],
    ["methodology query", "GET", "/v1/methodologies/1.0.0?unexpected=1", 400],
    ["closed Model stable-ID path", "GET", `/v1/models/${RENDER_MODEL}`, 404],
    ["closed Model slug path", "GET", "/v1/models/fixture-model", 404],
  ])(
    "enforces the %s path in the deployed runtime",
    async (_label, method, path, status) => {
      const response = await exports.default.fetch(
        new Request(`https://api.example.test${path}`, {
          method,
          headers: { "CF-Connecting-IP": "198.51.100.24" },
        }),
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.has("Set-Cookie")).toBe(false);
    },
  );

  it.each([
    ["oversized target", `/${"a".repeat(513)}`, {}, 413],
    [
      "malformed conditional",
      "/v1/metadata",
      { "If-None-Match": "not-an-etag" },
      400,
    ],
    [
      "oversized body declaration",
      "/v1/metadata",
      { "Content-Length": "1025" },
      413,
    ],
  ])("rejects a %s in workerd", async (_label, path, extraHeaders, status) => {
    const response = await exports.default.fetch(
      new Request(`https://api.example.test${path}`, {
        headers: {
          "CF-Connecting-IP": "198.51.100.24",
          ...extraHeaders,
        },
      }),
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
  });

  it("rejects but does not consume an OPTIONS body in workerd", async () => {
    const request = new Request("https://api.example.test/v1/metadata", {
      method: "OPTIONS",
      headers: { "CF-Connecting-IP": "198.51.100.24" },
      body: "forbidden body",
    });
    const response = await exports.default.fetch(request);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps the deployed CORS surface noncredentialed and conditional-read only", async () => {
    const response = await exports.default.fetch(
      new Request("https://api.example.test/v1/metadata", {
        method: "OPTIONS",
        headers: { "CF-Connecting-IP": "198.51.100.24" },
      }),
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "If-None-Match, X-QuantClarity-Publication",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
      "ETag, X-QuantClarity-Publication",
    );
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(
      false,
    );
  });
});
