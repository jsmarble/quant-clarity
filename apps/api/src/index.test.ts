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

  it("rate limits before resource lookup and returns Retry-After", async () => {
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
});
