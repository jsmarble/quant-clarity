import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("public API in workerd (API-013, API-024)", () => {
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
