import { describe, expect, it, vi } from "vitest";

import type { DatasetMetadata } from "@quant-clarity/contracts";

import { handleRequest } from "./request.js";

const SECRET = "test-only-hmac-key-with-at-least-32-characters";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const CURRENT_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";

const metadata = (): DatasetMetadata => ({
  publication_id: PUBLICATION,
  schema_version: "1.0.0",
  api_version: "1",
  methodology_version: "1.0.0",
  methodology_effective_at: "2026-08-01T00:00:00.000Z",
  methodology_url: "https://api.example.test/v1/methodologies/1.0.0",
  precision_normalization_version: "precision-normalization@1",
  precision_display_order_version: "precision-display-order@1",
  price_policy_version: "price-policy@1",
  published_at: "2026-08-01T01:00:00.000Z",
  generated_at: "2026-08-01T00:30:00.000Z",
  next_refresh_window: {
    starts_at: "2026-08-02T00:00:00.000Z",
    ends_at: "2026-08-02T01:00:00.000Z",
  },
  counts: {
    active_models: 2,
    active_offerings: 3,
    active_providers: 1,
  },
  degradation_notices: [],
});

type Rpc = Readonly<{
  resolvePublicationV2: (input: unknown) => Promise<unknown>;
  readDatasetMetadataV1: (input: unknown) => Promise<unknown>;
}>;

function successfulRpc(): Rpc {
  return {
    resolvePublicationV2: vi.fn((input: unknown) => {
      const requiredAvailableUntilMs = (
        input as { requiredAvailableUntilMs: number }
      ).requiredAvailableUntilMs;
      return Promise.resolve({
        outcome: "selected",
        publicationId: PUBLICATION,
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs,
      });
    }),
    readDatasetMetadataV1: vi.fn(() =>
      Promise.resolve({
        outcome: "metadata",
        metadata: metadata(),
      }),
    ),
  };
}

function environment(
  outcomes: boolean[] = [true, true],
  failure: Error | null = null,
  rpc: Rpc = successfulRpc(),
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
      CATALOG_QUERY: rpc as unknown as Service,
    },
    keys,
    rpc,
  };
}

const request = (path = "/v1/metadata", init: RequestInit = {}): Request => {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", "203.0.113.9");
  return new Request(`https://api.example.test${path}`, {
    ...init,
    headers,
  });
};

describe("public dataset metadata endpoint (API-002, API-003, API-013, API-024)", () => {
  it("returns the exact publication representation with validators and zero-data controls", async () => {
    const { env, rpc } = environment();
    const response = await handleRequest(request(), env);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(metadata());
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      PUBLICATION,
    );
    expect(response.headers.get("ETag")).toMatch(/^"[0-9a-f]{64}"$/u);
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Content-Length")).toBe(
      String(new TextEncoder().encode(JSON.stringify(metadata())).byteLength),
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.has("X-Request-ID")).toBe(false);
    expect(rpc.resolvePublicationV2).toHaveBeenCalledTimes(1);
    expect(rpc.readDatasetMetadataV1).toHaveBeenCalledTimes(1);
  });

  it("keeps HEAD metadata and conditional semantics representation-identical", async () => {
    const getEnvironment = environment();
    const get = await handleRequest(request(), getEnvironment.env);
    const etag = get.headers.get("ETag");
    if (etag === null) throw new Error("metadata fixture must produce an ETag");

    const headEnvironment = environment();
    const head = await handleRequest(
      request(undefined, { method: "HEAD" }),
      headEnvironment.env,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("ETag")).toBe(etag);
    expect(head.headers.get("Content-Length")).toBe(
      get.headers.get("Content-Length"),
    );
    expect(head.headers.get("X-QuantClarity-Publication")).toBe(PUBLICATION);

    for (const candidate of [etag, `W/${etag}`, `"other", W/${etag}`, "*"]) {
      const conditionalEnvironment = environment();
      const conditional = await handleRequest(
        request(undefined, { headers: { "If-None-Match": candidate } }),
        conditionalEnvironment.env,
      );
      expect(conditional.status).toBe(304);
      expect(await conditional.text()).toBe("");
      expect(conditional.headers.get("ETag")).toBe(etag);
      expect(conditional.headers.get("X-QuantClarity-Publication")).toBe(
        PUBLICATION,
      );
      expect(conditional.headers.get("Cache-Control")).toBe(
        "private, no-store",
      );
    }
  });

  it("passes an exact publication pin through both RPC calls", async () => {
    const { env, rpc } = environment();
    const response = await handleRequest(
      request(undefined, {
        headers: { "X-QuantClarity-Publication": PUBLICATION },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(rpc.resolvePublicationV2).toHaveBeenCalledWith(
      expect.objectContaining({ requestedPublicationId: PUBLICATION }),
    );
    const readInput = vi.mocked(rpc.readDatasetMetadataV1).mock
      .calls[0]?.[0] as { envelope?: { publicationId?: unknown } } | undefined;
    expect(readInput?.envelope?.publicationId).toBe(PUBLICATION);
  });

  it("returns the current publication header for an expired exact pin", async () => {
    const rpc: Rpc = {
      resolvePublicationV2: vi.fn(() =>
        Promise.resolve({
          outcome: "publication_expired",
          currentPublicationId: CURRENT_PUBLICATION,
        }),
      ),
      readDatasetMetadataV1: vi.fn(),
    };
    const { env } = environment(undefined, null, rpc);
    const response = await handleRequest(
      request(undefined, {
        headers: { "X-QuantClarity-Publication": PUBLICATION },
      }),
      env,
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      CURRENT_PUBLICATION,
    );
    expect(await response.json()).toEqual({
      error: {
        code: "publication_expired",
        message: "The requested publication is no longer available.",
      },
    });
    expect(rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
  });

  it("maps hostile and thrown RPC results to a static error", async () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "outcome", {
      enumerable: true,
      get: () => {
        throw new Error("private upstream detail");
      },
    });
    for (const resolvePublicationV2 of [
      vi.fn(() => Promise.resolve(hostile)),
      vi.fn(() => Promise.reject(new Error("private upstream detail"))),
    ]) {
      const rpc: Rpc = {
        resolvePublicationV2,
        readDatasetMetadataV1: vi.fn(),
      };
      const { env } = environment(undefined, null, rpc);
      const response = await handleRequest(request(), env);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "temporarily_unavailable",
          message: "The metadata is temporarily unavailable.",
        },
      });
    }
  });
});

describe("public API privacy and protocol boundary (PRIV-002–PRIV-007)", () => {
  it("withholds a planned resource error until rate limiting succeeds", async () => {
    const { env } = environment([false]);
    const response = await handleRequest(request("/v1/not-present"), env);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });

  it.each([
    ["invalid query", "GET", "/v1/metadata?unexpected=1", 400],
    ["bare query marker", "GET", "/v1/metadata?", 400],
    ["preflight", "OPTIONS", "/v1/metadata", 204],
    ["unsupported method", "POST", "/v1/metadata?unexpected=1", 405],
    ["unknown path", "GET", "/v1/not-present", 404],
  ])(
    "rate limits the %s response path without RPC",
    async (_label, method, path, status) => {
      const { env, keys, rpc } = environment();
      const response = await handleRequest(request(path, { method }), env);
      expect(response.status).toBe(status);
      expect(keys).toHaveLength(1);
      expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
      expect(rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["oversized path", `/${"a".repeat(513)}`, 413],
    ["oversized query", `/v1/metadata?x=${"a".repeat(4096)}`, 413],
    ["fragment", "/v1/metadata#visitor", 400],
  ])("bounds the %s before RPC", async (_label, path, status) => {
    const { env, keys, rpc } = environment();
    const response = await handleRequest(request(path), env);
    expect(response.status).toBe(status);
    expect(keys).toHaveLength(1);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    expect(rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
  });

  it.each([
    ["declared body", "1", 400],
    ["oversized declared body", "1025", 413],
    ["malformed declared body", "01", 400],
  ])("rejects a %s without RPC", async (_label, contentLength, status) => {
    const { env, keys, rpc } = environment();
    const response = await handleRequest(
      request(undefined, { headers: { "Content-Length": contentLength } }),
      env,
    );
    expect(response.status).toBe(status);
    expect(keys).toHaveLength(1);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("rejects an actual read body without consuming it", async () => {
    const { env, keys, rpc } = environment();
    const bodyRequest = request(undefined, {
      method: "OPTIONS",
      body: "forbidden body",
    });
    expect(bodyRequest.bodyUsed).toBe(false);
    const response = await handleRequest(bodyRequest, env);
    expect(response.status).toBe(400);
    expect(bodyRequest.bodyUsed).toBe(false);
    expect(keys).toHaveLength(1);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it.each([
    ["unquoted", "not-an-etag"],
    ["unterminated", 'W/"unterminated'],
    ["wildcard list", '*, "other"'],
    ["oversized", `"${"a".repeat(255)}"`],
    ["oversized UTF-8", `"${"é".repeat(128)}"`],
  ])("rejects a %s If-None-Match before RPC", async (_label, value) => {
    const { env, keys, rpc } = environment();
    const response = await handleRequest(
      request(undefined, { headers: { "If-None-Match": value } }),
      env,
    );
    expect(response.status).toBe(400);
    expect(keys).toHaveLength(1);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    expect(rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
  });

  it("validates If-None-Match syntax before the limiter effect", async () => {
    const events: string[] = [];
    const values = new Map<string, string>([
      ["cf-connecting-ip", "203.0.113.9"],
      ["if-none-match", "not-an-etag"],
    ]);
    const protocolRequest = {
      body: null,
      headers: {
        get(name: string) {
          events.push(`header:${name.toLowerCase()}`);
          return values.get(name.toLowerCase()) ?? null;
        },
      },
      method: "GET",
      url: "https://api.example.test/v1/metadata",
    } as unknown as Request;
    const { env, rpc } = environment();
    const limiter = {
      limit(): Promise<RateLimitOutcome> {
        events.push("limit");
        return Promise.resolve({ success: true });
      },
    } satisfies RateLimit;
    const response = await handleRequest(protocolRequest, {
      ...env,
      READ_LIMITER: limiter,
      ROTATION_LIMITER: limiter,
    });
    expect(response.status).toBe(400);
    expect(events.indexOf("header:if-none-match")).toBeLessThan(
      events.indexOf("limit"),
    );
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("accepts commas inside a syntactically valid opaque ETag", async () => {
    const { env, rpc } = environment();
    const response = await handleRequest(
      request(undefined, { headers: { "If-None-Match": 'W/"opaque,tag"' } }),
      env,
    );
    expect(response.status).toBe(200);
    expect(rpc.resolvePublicationV2).toHaveBeenCalledTimes(1);
  });

  it("selects an oversized-target error plan before the limiter effect", async () => {
    const events: string[] = [];
    const headers = new Headers({ "CF-Connecting-IP": "203.0.113.9" });
    const oversizedRequest = {
      get body() {
        events.push("body");
        return null;
      },
      get headers() {
        events.push("headers");
        return headers;
      },
      get method() {
        events.push("method");
        return "GET";
      },
      get url() {
        events.push("url");
        return `https://api.example.test/${"a".repeat(8192)}`;
      },
    } as unknown as Request;
    const { env, rpc } = environment();
    const limiter = {
      limit(): Promise<RateLimitOutcome> {
        events.push("limit");
        return Promise.resolve({ success: true });
      },
    } satisfies RateLimit;
    const response = await handleRequest(oversizedRequest, {
      ...env,
      READ_LIMITER: limiter,
      ROTATION_LIMITER: limiter,
    });
    expect(response.status).toBe(413);
    expect(events[0]).toBe("url");
    expect(events.indexOf("url")).toBeLessThan(events.indexOf("limit"));
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("fails closed when the source address, secret, or limiter is unsafe", async () => {
    const cases: readonly Readonly<
      Readonly<{ env: ReturnType<typeof environment>["env"]; address: string }>
    >[] = [
      { env: environment().env, address: "not-an-address" },
      {
        env: {
          ...environment().env,
          RATE_LIMIT_HMAC_KEY: undefined as unknown as string,
        },
        address: "203.0.113.9",
      },
      {
        env: environment([], new Error("private binding detail")).env,
        address: "203.0.113.9",
      },
    ];
    for (const testCase of cases) {
      const response = await handleRequest(
        new Request("https://api.example.test/v1/metadata", {
          headers: { "CF-Connecting-IP": testCase.address },
        }),
        testCase.env,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.has("Set-Cookie")).toBe(false);
      const body = await response.text();
      expect(body).not.toContain("binding detail");
      expect(body).not.toContain(testCase.address);
    }
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

  it("keeps preflight noncredentialed and never calls the query Worker", async () => {
    const { env, rpc } = environment();
    const response = await handleRequest(
      request(undefined, { method: "OPTIONS" }),
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
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    expect(rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
  });

  it("rejects malformed and duplicated publication pins without RPC", async () => {
    for (const pin of [
      "pub_not-a-uuid",
      "pub_00000000-0000-4000-8000-000000000001, pub_00000000-0000-4000-8000-000000000002",
    ]) {
      const { env, rpc } = environment();
      const response = await handleRequest(
        request(undefined, { headers: { "X-QuantClarity-Publication": pin } }),
        env,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_parameter",
          message: "The publication header is malformed.",
        },
      });
      expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    }
  });
});
