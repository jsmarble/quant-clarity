import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  renderApiPreflight,
  renderModelDetailResponse,
} from "./api-response-renderer.js";
import type { ModelDetailResponsePlan } from "./model-detail-response-plan.js";

const RENDER_PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const RENDER_MODEL = "mdl_22222222-2222-4222-8222-222222222222";
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
