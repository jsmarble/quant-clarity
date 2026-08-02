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
});
