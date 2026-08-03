import { describe, expect, it } from "vitest";

import { handleRequest } from "./request.js";

const SECRET = "test-only-hmac-key-with-at-least-32-characters";

function environment(
  outcomes: boolean[] = [true, true],
  failure: Error | null = null,
) {
  const keys: string[] = [];
  const limiter = {
    limit({ key }: RateLimitOptions): Promise<RateLimitOutcome> {
      keys.push(key);
      if (failure !== null) return Promise.reject(failure);
      return Promise.resolve({ success: outcomes.shift() ?? true });
    },
  } satisfies RateLimit;
  return {
    env: {
      RATE_LIMIT_HMAC_KEY: SECRET,
      READ_LIMITER: limiter,
      ROTATION_LIMITER: limiter,
      CATALOG_QUERY: {} as Service,
    },
    keys,
  };
}

describe("public API privacy and protocol boundary (API-013, PRIV-002–PRIV-007)", () => {
  it("returns bounded no-store errors without cookies or correlation IDs", async () => {
    const { env } = environment();
    const response = await handleRequest(
      new Request("https://api.example.test/v1/metadata", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
      env,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.has("X-Request-ID")).toBe(false);
    expect(JSON.stringify(body)).not.toContain("203.0.113.9");
    expect(JSON.stringify(body)).not.toContain("request_id");
  });

  it("withholds a planned resource error until rate limiting succeeds", async () => {
    const { env } = environment([false]);
    const response = await handleRequest(
      new Request("https://api.example.test/v1/not-present", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
      env,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it.each([
    ["invalid query", "GET", "/v1/metadata?unexpected=1", 400],
    ["preflight", "OPTIONS", "/v1/metadata", 204],
    ["unsupported method", "POST", "/v1/metadata?unexpected=1", 405],
    ["unknown path", "GET", "/v1/not-present", 404],
  ])(
    "rate limits the %s response path",
    async (_label, method, path, status) => {
      const { env, keys } = environment();
      const response = await handleRequest(
        new Request(`https://api.example.test${path}`, {
          method,
          headers: { "CF-Connecting-IP": "203.0.113.9" },
        }),
        env,
      );
      expect(response.status).toBe(status);
      expect(keys).toHaveLength(1);
    },
  );

  it("fails closed with bounded headers when the source address is invalid", async () => {
    const { env, keys } = environment();
    const response = await handleRequest(
      new Request("https://api.example.test/v1/metadata", {
        headers: { "CF-Connecting-IP": "not-an-address" },
      }),
      env,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(keys).toEqual([]);
  });

  it("fails closed with bounded headers when the runtime secret is missing", async () => {
    const { env } = environment();
    const response = await handleRequest(
      new Request("https://api.example.test/v1/metadata", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
      { ...env, RATE_LIMIT_HMAC_KEY: undefined as unknown as string },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
  });

  it("fails closed with bounded headers when a limiter binding fails", async () => {
    const { env } = environment([], new Error("test binding failure"));
    const response = await handleRequest(
      new Request("https://api.example.test/v1/metadata", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
      env,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await response.text()).not.toContain("binding failure");
  });

  it("uses stable /64 and /48 hashed limiter keys for IPv6 privacy addresses", async () => {
    const first = environment();
    const second = environment();
    await handleRequest(
      new Request("https://api.example.test/v1/metadata", {
        headers: { "CF-Connecting-IP": "2001:db8:abcd:12::99" },
      }),
      first.env,
    );
    await handleRequest(
      new Request("https://api.example.test/v1/metadata", {
        headers: { "CF-Connecting-IP": "2001:db8:abcd:12::beef" },
      }),
      second.env,
    );
    expect(first.keys).toEqual(second.keys);
    expect(first.keys).toHaveLength(2);
    expect(first.keys.join("")).not.toContain("2001:db8");
  });

  it("returns no body for HEAD", async () => {
    const { env } = environment();
    const response = await handleRequest(
      new Request("https://api.example.test/v1/metadata", {
        method: "HEAD",
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
      env,
    );
    expect(await response.text()).toBe("");
  });

  it.each([
    ["rate limiting", environment([false]).env, "203.0.113.9", 429],
    ["unsafe source address", environment().env, "not-an-address", 503],
  ])(
    "returns no HEAD body when %s fails",
    async (_case, env, address, status) => {
      const response = await handleRequest(
        new Request("https://api.example.test/v1/metadata", {
          method: "HEAD",
          headers: { "CF-Connecting-IP": address },
        }),
        env,
      );
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
    },
  );

  it("allows only conditional reads and publication pins through CORS", async () => {
    const { env } = environment();
    const response = await handleRequest(
      new Request("https://api.example.test/v1/metadata", {
        method: "OPTIONS",
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
      env,
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

  it("exposes validators on bounded JSON responses", async () => {
    const { env } = environment();
    const response = await handleRequest(
      new Request("https://api.example.test/v1/metadata", {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
      env,
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
      "ETag, X-QuantClarity-Publication",
    );
  });

  it("rejects malformed and duplicated publication pins", async () => {
    for (const pin of [
      "pub_not-a-uuid",
      "pub_00000000-0000-4000-8000-000000000001, pub_00000000-0000-4000-8000-000000000002",
    ]) {
      const { env } = environment();
      const response = await handleRequest(
        new Request("https://api.example.test/v1/metadata", {
          headers: {
            "CF-Connecting-IP": "203.0.113.9",
            "X-QuantClarity-Publication": pin,
          },
        }),
        env,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_parameter",
          message:
            "X-QuantClarity-Publication must be an exact publication ID.",
        },
      });
    }
  });
});
