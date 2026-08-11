import { describe, expect, it, vi } from "vitest";

import {
  FRONTEND_API_ENVELOPE_HEADER,
  FRONTEND_API_INTERNAL_ORIGIN,
  signFrontendApiRequest,
} from "@quant-clarity/api-core";
import type { DatasetMetadata } from "@quant-clarity/contracts";

import { handleRequest } from "./request.js";

const SECRET = "test-only-hmac-key-with-at-least-32-characters";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const CURRENT_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const FRONTEND_SECRET = "frontend-test-secret-with-at-least-32-characters";

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

describe("signed frontend metadata ingress (FE-009, API-003, SEC-001, SEC-011, PRIV-006)", () => {
  const nowMs = 1_786_339_200_000;

  async function internalRequest(
    path = "/v1/metadata",
    rawQuery = "",
  ): Promise<Request> {
    const headers = await signFrontendApiRequest({
      environment: "local",
      method: "GET",
      nowMs,
      path,
      rawQuery,
      secret: FRONTEND_SECRET,
      subtle: crypto.subtle,
    });
    if (headers === null) throw new Error("test signing failed");
    return new Request(
      `${FRONTEND_API_INTERNAL_ORIGIN}${path}${rawQuery === "" ? "" : `?${rawQuery}`}`,
      { headers },
    );
  }

  it("admits an authenticated service-bound read without an address or second limiter event", async () => {
    const runtime = environment();
    const env = {
      ...runtime.env,
      FRONTEND_API_HMAC_CURRENT: FRONTEND_SECRET,
    };
    const clock = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      const response = await handleRequest(await internalRequest(), env);
      expect(response.status).toBe(200);
      expect(runtime.keys).toEqual([]);
      expect(runtime.rpc.readDatasetMetadataV1).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("rejects forged internal ingress without touching limiters or canonical data", async () => {
    const runtime = environment();
    const response = await handleRequest(
      new Request(`${FRONTEND_API_INTERNAL_ORIGIN}/v1/metadata`, {
        headers: { [FRONTEND_API_ENVELOPE_HEADER]: "forged" },
      }),
      {
        ...runtime.env,
        FRONTEND_API_HMAC_CURRENT: FRONTEND_SECRET,
      },
    );
    expect(response.status).toBe(404);
    expect(runtime.keys).toEqual([]);
    expect(runtime.rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
  });

  it.each([
    ["/v1/methodologies/1.0.0", ""],
    ["/v1/metadata", "q=visitor-query"],
  ])(
    "confines the limiter bypass to exact metadata for %s",
    async (path, rawQuery) => {
      const runtime = environment();
      const clock = vi.spyOn(Date, "now").mockReturnValue(nowMs);
      try {
        const response = await handleRequest(
          await internalRequest(path, rawQuery),
          {
            ...runtime.env,
            FRONTEND_API_HMAC_CURRENT: FRONTEND_SECRET,
          },
        );
        expect(response.status).toBe(404);
        expect(runtime.keys).toEqual([]);
        expect(runtime.rpc.resolvePublicationV2).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
      }
    },
  );

  it("does not read a source address or public limiter capability for authenticated metadata", async () => {
    const runtime = environment();
    const signed = await internalRequest();
    const headers = signed.headers;
    const guardedRequest = {
      body: null,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "cf-connecting-ip")
            throw new Error("source address must not be read");
          return headers.get(name);
        },
      },
      method: "GET",
      url: signed.url,
    } as unknown as Request;
    const env = {
      ...runtime.env,
      FRONTEND_API_HMAC_CURRENT: FRONTEND_SECRET,
    };
    Object.defineProperties(env, {
      RATE_LIMIT_HMAC_KEY: {
        get() {
          throw new Error("public limiter secret must not be read");
        },
      },
      READ_LIMITER: {
        get() {
          throw new Error("public limiter must not be read");
        },
      },
      ROTATION_LIMITER: {
        get() {
          throw new Error("public rotation limiter must not be read");
        },
      },
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      const response = await handleRequest(guardedRequest, env);
      expect(response.status).toBe(200);
      expect(runtime.rpc.readDatasetMetadataV1).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("rate-limits a public request before rejecting a reserved internal header", async () => {
    const runtime = environment();
    const response = await handleRequest(
      request(undefined, {
        headers: { [FRONTEND_API_ENVELOPE_HEADER]: "forged" },
      }),
      runtime.env,
    );
    expect(response.status).toBe(400);
    expect(runtime.keys).toHaveLength(1);
    expect(runtime.rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
  });
});

type Rpc = Readonly<{
  resolvePublicationV2: (input: unknown) => Promise<unknown>;
  readDatasetMetadataV1: (input: unknown) => Promise<unknown>;
  readMethodologyContextV1?: (input: unknown) => Promise<unknown>;
  readModelDetailV1: (input: unknown) => Promise<unknown>;
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
    readMethodologyContextV1: vi.fn(() =>
      Promise.resolve({
        outcome: "context",
        publicationId: PUBLICATION,
        publicApiOrigin: "https://api.example.test",
        schemaVersion: "1.0.0",
      }),
    ),
    readModelDetailV1: vi.fn(),
  };
}

function environment(
  outcomes: boolean[] = [true, true],
  failure: Error | null = null,
  rpc: Rpc = successfulRpc(),
  deploymentEnvironment: unknown = "local",
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
      API_TRANSPORT_POLICY: "local_test" as unknown,
      DEPLOYMENT_ENV: deploymentEnvironment,
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
  if (!headers.has("CF-Connecting-IP"))
    headers.set("CF-Connecting-IP", "203.0.113.9");
  return new Request(`https://api.example.test${path}`, {
    ...init,
    headers,
  });
};

describe("public dataset metadata endpoint (API-002, API-003, API-013, API-024, CF-005, CF-006)", () => {
  it.each(["local", "test", "preview", "production"] as const)(
    "forwards the exact %s deployment environment through both RPC envelopes",
    async (deploymentEnvironment) => {
      const rpc = successfulRpc();
      const { env } = environment(undefined, null, rpc, deploymentEnvironment);
      const response = await handleRequest(request(), env);

      expect(response.status).toBe(200);
      expect(rpc.resolvePublicationV2).toHaveBeenCalledWith(
        expect.objectContaining({ environment: deploymentEnvironment }),
      );
      const readInput = vi.mocked(rpc.readDatasetMetadataV1).mock
        .calls[0]?.[0] as
        | {
            environment?: unknown;
            envelope?: { environment?: unknown };
          }
        | undefined;
      expect(readInput?.environment).toBe(deploymentEnvironment);
      expect(readInput?.envelope?.environment).toBe(deploymentEnvironment);
    },
  );

  it("returns the exact publication representation with validators and zero-data controls", async () => {
    const { env, rpc } = environment();
    const response = await handleRequest(request(), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(metadata());
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
      readModelDetailV1: vi.fn(),
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
        readModelDetailV1: vi.fn(),
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

describe("local public methodology detail endpoint (FE-051, API-003, PRIV-003–PRIV-007)", () => {
  const methodologyPath = "/v1/methodologies/1.0.0";

  it("returns exact historical methodology metadata from protected publication context", async () => {
    const { env, rpc } = environment();
    const response = await handleRequest(request(methodologyPath), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        methodology_version: "1.0.0",
        methodology_effective_at: "2026-08-01T00:00:00.000Z",
        methodology_url: "https://api.example.test/v1/methodologies/1.0.0",
      },
      meta: {
        resource: "methodologies",
        publication_id: PUBLICATION,
        schema_version: "1.0.0",
        sort: ["version"],
        filters: {},
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("X-QuantClarity-Publication");
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      PUBLICATION,
    );
    expect(response.headers.get("ETag")).toMatch(/^"[0-9a-f]{64}"$/u);
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.has("X-Request-ID")).toBe(false);
    expect(rpc.resolvePublicationV2).toHaveBeenCalledTimes(1);
    expect(rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
    expect(rpc.readMethodologyContextV1).toHaveBeenCalledTimes(1);
    if (rpc.readMethodologyContextV1 === undefined)
      throw new Error("methodology RPC fixture is missing");
    const readInput = vi.mocked(rpc.readMethodologyContextV1).mock
      .calls[0]?.[0] as
      | {
          envelope?: {
            operation?: unknown;
            publicationId?: unknown;
            sort?: unknown;
          };
        }
      | undefined;
    expect(readInput?.envelope?.operation).toEqual({
      kind: "methodology_detail",
      version: "1.0.0",
    });
    expect(readInput?.envelope?.publicationId).toBe(PUBLICATION);
    expect(readInput?.envelope?.sort).toEqual(["version"]);
  });

  it("never derives the methodology URL from request authority headers", async () => {
    const response = await handleRequest(
      new Request(`https://visitor-controlled.invalid${methodologyPath}`, {
        headers: {
          "CF-Connecting-IP": "203.0.113.9",
          Host: "attacker.invalid",
          "X-Forwarded-Host": "attacker.invalid",
        },
      }),
      environment().env,
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("https://api.example.test/v1/methodologies/1.0.0");
    expect(body).not.toContain("visitor-controlled");
    expect(body).not.toContain("attacker.invalid");
  });

  it("keeps GET, HEAD, and conditional representation semantics identical", async () => {
    const get = await handleRequest(
      request(methodologyPath),
      environment().env,
    );
    const etag = get.headers.get("ETag");
    if (etag === null) throw new Error("methodology fixture requires an ETag");
    const head = await handleRequest(
      request(methodologyPath, { method: "HEAD" }),
      environment().env,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("Content-Length")).toBe(
      get.headers.get("Content-Length"),
    );
    expect(head.headers.get("ETag")).toBe(etag);
    const conditional = await handleRequest(
      request(methodologyPath, { headers: { "If-None-Match": etag } }),
      environment().env,
    );
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(conditional.headers.get("ETag")).toBe(etag);
    expect(conditional.headers.get("Cache-Control")).toBe("private, no-store");
    expect(conditional.headers.get("Vary")).toBe("X-QuantClarity-Publication");
  });

  it.each(["GET", "HEAD", "OPTIONS"])(
    "returns a withheld static 404 for unregistered %s without RPC",
    async (method) => {
      const { env, rpc, keys } = environment();
      const response = await handleRequest(
        request("/v1/methodologies/2.0.0", { method }),
        env,
      );
      expect(response.status).toBe(404);
      expect(keys).toHaveLength(1);
      expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
      expect(rpc.readMethodologyContextV1).not.toHaveBeenCalled();
      if (method === "HEAD") expect(await response.text()).toBe("");
    },
  );

  it("returns registered fixed preflight without query effects", async () => {
    const { env, rpc } = environment();
    const response = await handleRequest(
      request(methodologyPath, { method: "OPTIONS" }),
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    expect(rpc.readMethodologyContextV1).not.toHaveBeenCalled();
  });

  it("returns publication expiration before any context read", async () => {
    const rpc: Rpc = {
      resolvePublicationV2: vi.fn(() =>
        Promise.resolve({
          outcome: "publication_expired",
          currentPublicationId: CURRENT_PUBLICATION,
        }),
      ),
      readDatasetMetadataV1: vi.fn(),
      readMethodologyContextV1: vi.fn(),
      readModelDetailV1: vi.fn(),
    };
    const { env } = environment(undefined, null, rpc);
    const response = await handleRequest(
      request(methodologyPath, {
        headers: { "X-QuantClarity-Publication": PUBLICATION },
      }),
      env,
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      CURRENT_PUBLICATION,
    );
    expect(response.headers.get("Vary")).toBe("X-QuantClarity-Publication");
    expect(rpc.readMethodologyContextV1).not.toHaveBeenCalled();
  });

  it("withholds an unregistered 404 until the limiter admits the request", async () => {
    const { env, rpc } = environment([false]);
    const response = await handleRequest(
      request("/v1/methodologies/2.0.0"),
      env,
    );
    expect(response.status).toBe(429);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    expect(rpc.readMethodologyContextV1).not.toHaveBeenCalled();
  });

  it.each(["preview", "production"] as const)(
    "keeps the registered route closed in %s",
    async (deploymentEnvironment) => {
      const { env, rpc } = environment(
        undefined,
        null,
        successfulRpc(),
        deploymentEnvironment,
      );
      const response = await handleRequest(request(methodologyPath), env);
      expect(response.status).toBe(404);
      expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
      expect(rpc.readMethodologyContextV1).not.toHaveBeenCalled();
    },
  );

  it("fails closed on local transport-policy drift after limiting", async () => {
    const { env, keys, rpc } = environment();
    env.API_TRANSPORT_POLICY = "preview_https";
    const response = await handleRequest(request(methodologyPath), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "The methodology detail is temporarily unavailable.",
      },
    });
    expect(keys).toHaveLength(1);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("contains a hostile query binding getter behind the limiter boundary", async () => {
    const { env, keys } = environment();
    Object.defineProperty(env, "CATALOG_QUERY", {
      get: () => {
        throw new Error("private binding detail");
      },
    });
    const response = await handleRequest(request(methodologyPath), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "The methodology detail is temporarily unavailable.",
      },
    });
    expect(keys).toHaveLength(1);
  });

  it("maps hostile context RPC output to one static bounded failure", async () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "outcome", {
      enumerable: true,
      get: () => {
        throw new Error("private upstream detail");
      },
    });
    const rpc = successfulRpc();
    const hostileRpc: Rpc = {
      ...rpc,
      readMethodologyContextV1: vi.fn(() => Promise.resolve(hostile)),
    };
    const response = await handleRequest(
      request(methodologyPath),
      environment(undefined, null, hostileRpc).env,
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toBe(
      JSON.stringify({
        error: {
          code: "temporarily_unavailable",
          message: "The methodology detail is temporarily unavailable.",
        },
      }),
    );
    expect(body).not.toContain("upstream");
  });

  it("snapshots each query-service method exactly once before awaiting", async () => {
    const rpc = successfulRpc();
    let resolverReads = 0;
    let contextReads = 0;
    const hostileRpc = {
      readDatasetMetadataV1: rpc.readDatasetMetadataV1,
      readModelDetailV1: rpc.readModelDetailV1,
    } as unknown as Rpc;
    Object.defineProperties(hostileRpc, {
      resolvePublicationV2: {
        enumerable: true,
        get: () => {
          resolverReads += 1;
          return rpc.resolvePublicationV2;
        },
      },
      readMethodologyContextV1: {
        enumerable: true,
        get: () => {
          contextReads += 1;
          return rpc.readMethodologyContextV1;
        },
      },
    });
    const response = await handleRequest(
      request(methodologyPath),
      environment(undefined, null, hostileRpc).env,
    );
    expect(response.status).toBe(200);
    expect(resolverReads).toBe(1);
    expect(contextReads).toBe(1);
  });

  it.each([
    ["publicApiOrigin", `https://${"a".repeat(100_000)}.test`],
    ["schemaVersion", "1".repeat(100_000)],
  ] as const)(
    "rejects oversized hostile context %s with a static bounded failure",
    async (field, value) => {
      const rpc = successfulRpc();
      const hostileRpc: Rpc = {
        ...rpc,
        readMethodologyContextV1: vi.fn(() =>
          Promise.resolve({
            outcome: "context",
            publicationId: PUBLICATION,
            publicApiOrigin: "https://api.example.test",
            schemaVersion: "1.0.0",
            [field]: value,
          }),
        ),
      };
      const response = await handleRequest(
        request(methodologyPath),
        environment(undefined, null, hostileRpc).env,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "temporarily_unavailable",
          message: "The methodology detail is temporarily unavailable.",
        },
      });
    },
  );

  it("preserves unrelated closed-route behavior before route-specific publication validation", async () => {
    const { env, rpc } = environment();
    const response = await handleRequest(
      request("/v1/models/fixture-model?unexpected=1", {
        headers: { "X-QuantClarity-Publication": "malformed" },
      }),
      env,
    );
    expect(response.status).toBe(404);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });
});

describe("public API privacy and protocol boundary (PRIV-002–PRIV-007)", () => {
  it.each([
    ["empty", ""],
    ["whitespace", " local"],
    ["case variant", "PREVIEW"],
    ["unknown", "staging"],
    ["number", 1],
    ["null", null],
    ["array", ["local"]],
    ["boxed string", Object("local")],
    [
      "coercible object",
      {
        toString: () => {
          throw new Error("must not coerce deployment configuration");
        },
      },
    ],
  ])("fails closed for an %s deployment environment", async (_label, value) => {
    const { env, keys, rpc } = environment(
      undefined,
      null,
      successfulRpc(),
      value,
    );
    const response = await handleRequest(request(), env);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "The service is temporarily unavailable.",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(keys).toHaveLength(1);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    expect(rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
  });

  it("fails closed when the deployment environment binding is missing", async () => {
    const { env, rpc } = environment();
    delete (env as { DEPLOYMENT_ENV?: unknown }).DEPLOYMENT_ENV;

    const response = await handleRequest(request(), env);

    expect(response.status).toBe(503);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("snapshots the deployment environment binding exactly once", async () => {
    const { env, rpc } = environment();
    let reads = 0;
    Object.defineProperty(env, "DEPLOYMENT_ENV", {
      configurable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? "local" : "preview";
      },
    });

    const response = await handleRequest(request(), env);

    expect(response.status).toBe(200);
    expect(reads).toBe(1);
    expect(rpc.resolvePublicationV2).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "local" }),
    );
    expect(rpc.readDatasetMetadataV1).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "local" }),
    );
  });

  it("keeps the request-start environment snapshot across an awaited limiter", async () => {
    let release: ((outcome: RateLimitOutcome) => void) | undefined;
    const limiterOutcome = new Promise<RateLimitOutcome>((resolve) => {
      release = resolve;
    });
    const limiter: RateLimit = {
      limit: vi.fn(() => limiterOutcome),
    };
    const rpc = successfulRpc();
    const env = {
      API_TRANSPORT_POLICY: "local_test" as unknown,
      DEPLOYMENT_ENV: "preview" as unknown,
      RATE_LIMIT_HMAC_KEY: SECRET,
      READ_LIMITER: limiter,
      ROTATION_LIMITER: limiter,
      CATALOG_QUERY: rpc as unknown as Service,
    };

    const responsePromise = handleRequest(request(), env);
    env.DEPLOYMENT_ENV = "production";
    if (release === undefined)
      throw new Error("deferred limiter fixture was not initialized");
    release({ success: true });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(rpc.resolvePublicationV2).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "preview" }),
    );
    expect(rpc.readDatasetMetadataV1).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "preview" }),
    );
  });

  it("gives invalid protected environment configuration precedence after limiting", async () => {
    const { env, rpc } = environment(
      [false, true],
      null,
      successfulRpc(),
      "staging",
    );
    const response = await handleRequest(
      request(undefined, {
        headers: { "CF-Connecting-IP": "2001:db8:abcd:12::99" },
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "The service is temporarily unavailable.",
      },
    });
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("withholds an inaccessible environment failure until both IPv6 controls settle", async () => {
    const events: string[] = [];
    const rpc = successfulRpc();
    const limiter: RateLimit = {
      limit: vi.fn(() => {
        events.push("limit");
        return Promise.resolve({ success: true });
      }),
    };
    const env = {
      API_TRANSPORT_POLICY: "local_test" as unknown,
      DEPLOYMENT_ENV: "local" as unknown,
      RATE_LIMIT_HMAC_KEY: SECRET,
      READ_LIMITER: limiter,
      ROTATION_LIMITER: limiter,
      CATALOG_QUERY: rpc as unknown as Service,
    };
    Object.defineProperty(env, "DEPLOYMENT_ENV", {
      get: () => {
        events.push("environment");
        throw new Error("private binding detail");
      },
    });

    const response = await handleRequest(
      request(undefined, {
        headers: { "CF-Connecting-IP": "2001:db8:abcd:12::99" },
      }),
      env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "The service is temporarily unavailable.",
      },
    });
    expect(events).toEqual(["environment", "limit", "limit"]);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it.each([
    ["OPTIONS", "/v1/metadata"],
    ["POST", "/v1/metadata"],
    ["GET", "/v1/not-present"],
  ])(
    "keeps invalid protected configuration ahead of the planned %s response",
    async (method, path) => {
      const { env, keys, rpc } = environment(
        undefined,
        null,
        successfulRpc(),
        "staging",
      );
      const response = await handleRequest(request(path, { method }), env);

      expect(response.status).toBe(503);
      expect(keys).toHaveLength(1);
      expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    },
  );

  it("keeps an invalid-environment HEAD failure bodyless and side-effect bounded", async () => {
    const now = vi.spyOn(Date, "now");
    try {
      const { env, keys, rpc } = environment(
        undefined,
        null,
        successfulRpc(),
        "preview ",
      );
      const response = await handleRequest(
        request(undefined, { method: "HEAD" }),
        env,
      );

      expect(response.status).toBe(503);
      expect(await response.text()).toBe("");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.has("Set-Cookie")).toBe(false);
      expect(response.headers.has("X-Request-ID")).toBe(false);
      expect(keys).toHaveLength(1);
      expect(now).not.toHaveBeenCalled();
      expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

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
    [
      "closed Model stable-ID path",
      "GET",
      "/v1/models/mdl_11111111-1111-4111-8111-111111111111",
      404,
    ],
    ["closed Model slug path", "GET", "/v1/models/fixture-model", 404],
  ])(
    "rate limits the %s response path without RPC",
    async (_label, method, path, status) => {
      const { env, keys, rpc } = environment();
      const response = await handleRequest(request(path, { method }), env);
      expect(response.status).toBe(status);
      expect(keys).toHaveLength(1);
      expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
      expect(rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
      expect(rpc.readModelDetailV1).not.toHaveBeenCalled();
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
    expect(events[0]).toBe("method");
    expect(events.indexOf("method")).toBeLessThan(events.indexOf("limit"));
    expect(events.indexOf("url")).toBeLessThan(events.indexOf("limit"));
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("fails closed when a hostile request method getter throws", async () => {
    const headers = new Headers({ "CF-Connecting-IP": "203.0.113.9" });
    const hostileRequest = {
      body: null,
      headers,
      get method() {
        throw new Error("private method detail");
      },
      url: "https://api.example.test/v1/metadata",
    } as unknown as Request;
    const { env, keys, rpc } = environment();
    const response = await handleRequest(hostileRequest, env);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_parameter",
        message: "The request target is malformed.",
      },
    });
    expect(keys).toHaveLength(1);
    expect(rpc.resolvePublicationV2).not.toHaveBeenCalled();
    expect(rpc.readDatasetMetadataV1).not.toHaveBeenCalled();
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
