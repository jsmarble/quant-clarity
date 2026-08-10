import { describe, expect, it, vi } from "vitest";

import type { ModelDetailQueryRpcV2 } from "@quant-clarity/api-core";

import {
  handleModelDetailHttp,
  type ModelDetailHttpCapabilities,
} from "./model-detail-http.js";

const SECRET = "test-only-hmac-key-with-at-least-32-characters";
const ORIGIN = "https://cache-orchestrator.api.example.test";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const FAMILY_ID = "fam_11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const NOW_MS = 1_785_774_000_000;

const known = (value: unknown) => ({
  evidence_ids: [EVIDENCE_ID],
  observed_at: OBSERVED_AT,
  state: "known",
  value,
});

const unknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown",
  value: null,
});

const model = () => ({
  active_parameters: unknown(),
  architecture: unknown(),
  authoritative_checkpoint_ids: [],
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: OBSERVED_AT,
    value: 0,
  },
  checkpoints: [],
  context_window_tokens: unknown(),
  display_name: known("Orchestrated Model"),
  family_id: FAMILY_ID,
  last_model_data_refresh: known(OBSERVED_AT),
  license: unknown(),
  maximum_output_tokens: unknown(),
  modalities: unknown(),
  model_id: MODEL_ID,
  publisher: known("Fixture Publisher"),
  release_date: unknown(),
  slug: known("orchestrated-model"),
  source_quantization: unknown(),
  source_weight_format: unknown(),
  status: known("active"),
  total_parameters: unknown(),
});

type HarnessOptions = Readonly<{
  readLimit?: boolean | Error;
  rotationLimit?: boolean | Error;
}>;

const harness = (options: HarnessOptions = {}) => {
  const events: string[] = [];
  const scheduled: Promise<void>[] = [];
  const limiter = (name: string, result: boolean | Error): RateLimit => ({
    limit: vi.fn(() => {
      events.push(name);
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve({ success: result });
    }),
  });
  const service = {
    readModelDetailV1: vi.fn(),
    resolvePublicationV2: vi.fn((input: unknown) => {
      events.push("resolve");
      const requiredAvailableUntilMs = (
        input as { requiredAvailableUntilMs: number }
      ).requiredAvailableUntilMs;
      return Promise.resolve({
        bookmark: "bookmark-orchestrator",
        outcome: "selected",
        publicationId: PUBLICATION,
        requiredAvailableUntilMs,
      });
    }),
    readModelDetailV2: vi.fn((input: unknown) => {
      events.push("read");
      const lookup = (input as { lookup: unknown }).lookup as {
        kind: "slug" | "stable_id";
      };
      return Promise.resolve({
        lookupProvenance: {
          canonicalSlug: "orchestrated-model",
          matchedBy: lookup.kind === "stable_id" ? "stable_id" : "current_slug",
          projectionVersion: "model-slug@1",
        },
        model: model(),
        outcome: "model",
        publicationId: PUBLICATION,
        schemaVersion: "1.13.0",
      });
    }),
  } satisfies ModelDetailQueryRpcV2;
  const cache = {
    match: vi.fn(() => {
      events.push("cache.match");
      return Promise.resolve(undefined);
    }),
    put: vi.fn(() => {
      events.push("cache.put");
      return Promise.resolve();
    }),
  };
  const capabilities: ModelDetailHttpCapabilities = {
    cache,
    context: {
      waitUntil(promise) {
        events.push("waitUntil");
        scheduled.push(Promise.resolve(promise).then(() => undefined));
      },
    },
    environment: "local",
    nowMs: NOW_MS,
    protectedCacheOrigin: ORIGIN,
    queryService: service,
    rateLimitSecret: SECRET,
    readLimiter: limiter("limit.read", options.readLimit ?? true),
    rotationLimiter: limiter("limit.rotation", options.rotationLimit ?? true),
    subtle: crypto.subtle,
    transportPolicy: "local_test",
  };
  return { cache, capabilities, events, scheduled, service };
};

const request = (
  identifier = MODEL_ID,
  init: RequestInit = {},
  sourceAddress = "2001:db8:abcd:12::99",
): Request => {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", sourceAddress);
  return new Request(`https://visitor-host.example/v1/models/${identifier}`, {
    ...init,
    headers,
  });
};

const expectZeroVisitorHeaders = (response: Response) => {
  for (const name of [
    "Access-Control-Allow-Credentials",
    "Server-Timing",
    "Set-Cookie",
    "X-Cache",
    "X-Request-ID",
  ])
    expect(response.headers.has(name), name).toBe(false);
};

describe("closed Model detail HTTP orchestration (API-020–API-025, PRIV-006)", () => {
  it("withholds a planned validation error until both IPv6 controls settle", async () => {
    const state = harness();
    const response = await handleModelDetailHttp(
      new Request(
        "https://visitor-host.example/v1/models/bad_identifier?q=secret",
        {
          headers: { "CF-Connecting-IP": "2001:db8:abcd:12::99" },
        },
      ),
      state.capabilities,
    );

    expect(response.status).toBe(400);
    expect(state.events).toEqual(["limit.read", "limit.rotation"]);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_parameter",
        message: "The Model detail request is invalid.",
      },
    });
    expectZeroVisitorHeaders(response);
  });

  it.each([
    ["unopened path", "/v1/providers/example", {}, 404],
    ["unsupported method", `/v1/models/${MODEL_ID}`, { method: "POST" }, 405],
    [
      "oversized body declaration",
      `/v1/models/${MODEL_ID}`,
      { headers: { "Content-Length": "1025" } },
      413,
    ],
  ] as const)(
    "limits planned %s before fixed %s",
    async (_label: string, path: string, init: RequestInit, status: number) => {
      const state = harness();
      const headers = new Headers(init.headers);
      headers.set("CF-Connecting-IP", "2001:db8:abcd:12::99");
      const response = await handleModelDetailHttp(
        new Request(`https://visitor-host.example${path}`, {
          ...init,
          headers,
        }),
        state.capabilities,
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Allow")).toBe(
        status === 405 ? "GET, HEAD, OPTIONS" : null,
      );
      expect(state.events).toEqual(["limit.read", "limit.rotation"]);
      expect(state.service.resolvePublicationV2).not.toHaveBeenCalled();
    },
  );

  it("gives a limiter fault precedence over denial after invoking both controls", async () => {
    const state = harness({
      readLimit: false,
      rotationLimit: new Error("private limiter diagnostic"),
    });
    const response = await handleModelDetailHttp(request(), state.capabilities);

    expect(response.status).toBe(503);
    expect(state.events).toEqual(["limit.read", "limit.rotation"]);
    expect(await response.text()).not.toContain("private limiter diagnostic");
  });

  it("returns fixed 429 only after both applicable controls deny or allow", async () => {
    const state = harness({ readLimit: false });
    const response = await handleModelDetailHttp(request(), state.capabilities);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(state.events).toEqual(["limit.read", "limit.rotation"]);
    expect(state.service.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("limits OPTIONS before returning the fixed bodyless preflight", async () => {
    const state = harness();
    const response = await handleModelDetailHttp(
      request(undefined, { method: "OPTIONS" }),
      state.capabilities,
    );

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(state.events).toEqual(["limit.read", "limit.rotation"]);
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
  });

  it("composes limit, resolver, stable-ID cache miss, canonical read, and fill once", async () => {
    const state = harness();
    const response = await handleModelDetailHttp(request(), state.capabilities);
    await Promise.all(state.scheduled);

    expect(
      response.status,
      `${state.events.join(",")}: ${await response.clone().text()}`,
    ).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=0, must-revalidate",
    );
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      PUBLICATION,
    );
    const body = await response.json<{ data: { model_id: string } }>();
    expect(body.data.model_id).toBe(MODEL_ID);
    expect(state.events).toEqual([
      "limit.read",
      "limit.rotation",
      "resolve",
      "cache.match",
      "read",
      "cache.put",
      "waitUntil",
    ]);
    expect(state.service.resolvePublicationV2).toHaveBeenCalledOnce();
    expect(state.service.readModelDetailV2).toHaveBeenCalledOnce();
    expectZeroVisitorHeaders(response);
  });

  it("keeps slugs private and outside Cache API", async () => {
    const state = harness();
    const response = await handleModelDetailHttp(
      request("orchestrated-model"),
      state.capabilities,
    );

    expect(
      response.status,
      `${state.events.join(",")}: ${await response.clone().text()}`,
    ).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.events).toEqual([
      "limit.read",
      "limit.rotation",
      "resolve",
      "read",
    ]);
    expect(state.cache.match).not.toHaveBeenCalled();
    expect(state.cache.put).not.toHaveBeenCalled();
  });

  it("uses only the primary limiter for IPv4 and keeps early HEAD errors bodyless", async () => {
    const state = harness();
    const response = await handleModelDetailHttp(
      request("bad_identifier", { method: "HEAD" }, "203.0.113.9"),
      state.capabilities,
    );

    expect(response.status).toBe(400);
    expect(response.body).toBeNull();
    expect(response.headers.get("Content-Length")).not.toBeNull();
    expect(state.events).toEqual(["limit.read"]);
  });

  it("withholds downstream configuration failure until both limiters settle", async () => {
    const state = harness();
    const response = await handleModelDetailHttp(request(), {
      ...state.capabilities,
      protectedCacheOrigin: "http://unsafe-cache.example",
    });

    expect(response.status).toBe(503);
    expect(state.events).toEqual(["limit.read", "limit.rotation"]);
    expect(state.service.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("fails a crossed environment policy with environment-derived HSTS after limiting", async () => {
    const state = harness();
    const response = await handleModelDetailHttp(request(), {
      ...state.capabilities,
      environment: "production",
      transportPolicy: "local_test",
    });

    expect(response.status).toBe(503);
    expect(state.events).toEqual(["limit.read", "limit.rotation"]);
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(state.service.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("does not read or forward unrelated visitor headers or request bodies", async () => {
    const state = harness({ readLimit: false });
    const canary = "privacy-canary-never-forward";
    const response = await handleModelDetailHttp(
      request(undefined, {
        headers: {
          Authorization: canary,
          Cookie: canary,
          Referer: `https://${canary}.example`,
          "User-Agent": canary,
          "X-Forwarded-For": canary,
        },
      }),
      state.capabilities,
    );

    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain(canary);
    expect(
      JSON.stringify(state.service.resolvePublicationV2.mock.calls),
    ).not.toContain(canary);
    expect(JSON.stringify(state.cache.match.mock.calls)).not.toContain(canary);
  });
});
