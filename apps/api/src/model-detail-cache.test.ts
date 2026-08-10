import { describe, expect, it, vi } from "vitest";

import {
  encodeModelDetailRepresentation,
  representationEtag,
  type ApiLimits,
  type ModelDetailLookupProvenanceV2,
  type NormalizedRequest,
} from "@quant-clarity/api-core";

import {
  modelDetailCacheRequest,
  readModelDetailFromQueryWithCacheV2,
  readModelDetailThroughCache,
  type ModelDetailCacheReadInput,
} from "./model-detail-cache.js";
import type {
  ModelDetailApiV2Outcome,
  ModelDetailSelectedReadV2Outcome,
} from "./model-detail-query.js";

const ORIGIN = "https://cache.api.quantclarity.example";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const OTHER_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const OTHER_MODEL_ID = "mdl_22222222-2222-4222-8222-222222222222";
const FAMILY_ID = "fam_11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const INTERNAL_CACHE_CONTROL = "public, max-age=300, must-revalidate";
const NOW_MS = 1_785_774_000_000;
const LIMITS: ApiLimits = {
  defaultPageSize: 25,
  maxBodyBytes: 1024,
  maxCpuMilliseconds: 50,
  maxCursorCharacters: 4096,
  maxErrorDetails: 10,
  maxFilterValues: 10,
  maxPageSize: 100,
  maxPathBytes: 512,
  maxQueryBytes: 4096,
  maxQueryValueBytes: 512,
  maxResponseBytes: 65_536,
  maxSearchQueryBytes: 200,
  maxSearchResults: 20,
  maxSemanticCalls: 0,
  maxSemanticCandidates: 0,
  maxSubrequests: 4,
  maxUpstreamCalls: 2,
  maxUrlBytes: 8192,
};

const known = <T>(value: T) => ({
  evidence_ids: [EVIDENCE_ID],
  observed_at: OBSERVED_AT,
  state: "known" as const,
  value,
});

const unknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown" as const,
  value: null,
});

const model = (modelId = MODEL_ID, slug = "fixture-model") => ({
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
  display_name: known("Fixture Model"),
  family_id: FAMILY_ID,
  last_model_data_refresh: known(OBSERVED_AT),
  license: unknown(),
  maximum_output_tokens: unknown(),
  modalities: unknown(),
  model_id: modelId,
  publisher: known("Fixture Publisher"),
  release_date: unknown(),
  slug: known(slug),
  source_quantization: unknown(),
  source_weight_format: unknown(),
  status: known("active"),
  total_parameters: unknown(),
});

const representation = encodeModelDetailRepresentation({
  model: model(),
  publicationId: PUBLICATION,
  schemaVersion: "1.13.0",
});

const provenance: ModelDetailLookupProvenanceV2 = {
  canonicalSlug: "fixture-model",
  matchedBy: "stable_id",
  projectionVersion: "model-slug@1",
};

const canonicalOutcome = (): Extract<
  ModelDetailApiV2Outcome,
  { success: true }
> => ({
  success: true,
  detail: representation.detail,
  lookup: { kind: "stable_id", value: MODEL_ID },
  lookupProvenance: provenance,
  publicationId: PUBLICATION,
  representationBytes: new Uint8Array(representation.representationBytes),
});

const cacheResponse = async (
  overrides: Readonly<{
    body?: BodyInit | null;
    headers?: Record<string, string>;
    status?: number;
  }> = {},
): Promise<Response> => {
  const etag = await representationEtag(
    PUBLICATION,
    "json",
    representation.representationBytes,
    crypto.subtle,
  );
  return new Response(
    overrides.body ?? new Uint8Array(representation.representationBytes),
    {
      status: overrides.status ?? 200,
      headers: {
        "Cache-Control": INTERNAL_CACHE_CONTROL,
        "Content-Length": String(representation.representationBytes.byteLength),
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
        "X-QuantClarity-Publication": PUBLICATION,
        ...overrides.headers,
      },
    },
  );
};

const harness = (
  matchValue: Response | undefined | Promise<Response | undefined>,
  readOutcome: ModelDetailSelectedReadV2Outcome = canonicalOutcome(),
) => {
  const cache = {
    match: vi.fn<(request: Request) => Promise<Response | undefined>>(() =>
      Promise.resolve(matchValue),
    ),
    put: vi.fn<(request: Request, response: Response) => Promise<void>>(() =>
      Promise.resolve(),
    ),
  };
  const scheduled: Promise<void>[] = [];
  const readCanonical = vi.fn(() => Promise.resolve(readOutcome));
  const schedule = vi.fn((promise: Promise<void>) => scheduled.push(promise));
  const input: ModelDetailCacheReadInput = {
    cache,
    modelId: MODEL_ID,
    protectedOrigin: ORIGIN,
    publicationId: PUBLICATION,
    readCanonical,
    schedule,
    subtle: crypto.subtle,
  };
  return { cache, input, readCanonical, schedule, scheduled };
};

const headerObject = (request: Request): Record<string, string> =>
  Object.fromEntries(request.headers.entries());

const queryRequest = (
  identifier: string,
  method: "GET" | "HEAD" = "GET",
): NormalizedRequest => ({
  cursor: null,
  filters: {},
  hasQueryString: false,
  limit: 25,
  limitProvided: false,
  method,
  operation: { identifier, kind: "detail", resourceType: "model" },
  publicationHeader: null,
  query: null,
  route: {
    operation: { identifier, kind: "detail", resourceType: "model" },
    policy: "models",
  },
  sort: ["name", "stable_id"],
  sortProvided: false,
});

const queryService = () => ({
  readModelDetailV1: vi.fn(),
  readModelDetailV2: vi.fn<() => Promise<unknown>>(() =>
    Promise.resolve({
      lookupProvenance: provenance,
      model: model(),
      outcome: "model",
      publicationId: PUBLICATION,
      schemaVersion: "1.13.0",
    }),
  ),
  resolvePublicationV2: vi.fn<(input: unknown) => Promise<unknown>>((input) =>
    Promise.resolve({
      bookmark: "bookmark-cache-v2",
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs: (input as { requiredAvailableUntilMs: number })
        .requiredAvailableUntilMs,
    }),
  ),
});

describe("Model detail stable-ID Cache API boundary", () => {
  it("builds one exact headerless HTTPS GET key from protected canonical facts", () => {
    const request = modelDetailCacheRequest(ORIGIN, PUBLICATION, MODEL_ID);
    expect(request).not.toBeNull();
    if (request === null) return;
    expect(request.url).toBe(
      `${ORIGIN}/.well-known/quantclarity-cache/v1/${PUBLICATION}/model/${MODEL_ID}/json`,
    );
    expect(request.method).toBe("GET");
    expect(headerObject(request)).toEqual({});
    expect(request.body).toBeNull();
    expect(request.url).not.toMatch(
      /visitor|slug|query|cookie|authorization|forwarded|actor|referrer/iu,
    );
  });

  it.each([
    [
      "http origin",
      "http://cache.api.quantclarity.example",
      PUBLICATION,
      MODEL_ID,
    ],
    ["origin path", `${ORIGIN}/path`, PUBLICATION, MODEL_ID],
    ["origin query", `${ORIGIN}?visitor=1`, PUBLICATION, MODEL_ID],
    [
      "origin credentials",
      "https://visitor@cache.example",
      PUBLICATION,
      MODEL_ID,
    ],
    ["publication", ORIGIN, "pub_invalid", MODEL_ID],
    ["slug", ORIGIN, PUBLICATION, "fixture-model"],
  ])(
    "rejects an invalid %s cache identity",
    (_label, origin, publicationId, modelId) => {
      expect(
        modelDetailCacheRequest(origin, publicationId, modelId),
      ).toBeNull();
    },
  );

  it("falls through a cold miss, returns canonical bytes, and schedules one exact put", async () => {
    const state = harness(undefined);
    const outcome = await readModelDetailThroughCache(state.input);

    expect(outcome).toEqual(canonicalOutcome());
    expect(state.cache.match).toHaveBeenCalledOnce();
    expect(state.readCanonical).toHaveBeenCalledOnce();
    expect(state.cache.put).toHaveBeenCalledOnce();
    expect(state.schedule).toHaveBeenCalledOnce();
    expect(state.scheduled).toHaveLength(1);
    await expect(state.scheduled[0]).resolves.toBeUndefined();

    const matchRequest = state.cache.match.mock.calls[0]![0];
    const [putRequest, putResponse] = state.cache.put.mock
      .calls[0] as unknown as [Request, Response];
    expect(matchRequest).not.toBe(putRequest);
    expect(matchRequest.url).toBe(putRequest.url);
    expect(headerObject(matchRequest)).toEqual({});
    expect(headerObject(putRequest)).toEqual({});
    expect(putResponse.status).toBe(200);
    expect(putResponse.headers.get("Cache-Control")).toBe(
      INTERNAL_CACHE_CONTROL,
    );
    expect(putResponse.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(putResponse.headers.get("Content-Length")).toBe(
      String(representation.representationBytes.byteLength),
    );
    expect(putResponse.headers.get("X-QuantClarity-Publication")).toBe(
      PUBLICATION,
    );
    expect(putResponse.headers.get("ETag")).toMatch(/^"[0-9a-f]{64}"$/u);
    expect(putResponse.headers.has("Set-Cookie")).toBe(false);
    expect(putResponse.headers.has("Vary")).toBe(false);
    expect(new Uint8Array(await putResponse.arrayBuffer())).toEqual(
      representation.representationBytes,
    );
  });

  it("accepts a fully revalidated warm hit without a canonical read or write", async () => {
    const state = harness(await cacheResponse());
    const outcome = await readModelDetailThroughCache(state.input);

    expect(outcome).toEqual(canonicalOutcome());
    expect(state.cache.match).toHaveBeenCalledOnce();
    expect(state.readCanonical).not.toHaveBeenCalled();
    expect(state.cache.put).not.toHaveBeenCalled();
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it("uses the same stable-ID cache identity for callers serving GET or HEAD", async () => {
    const first = harness(undefined);
    const second = harness(undefined);
    await readModelDetailThroughCache(first.input);
    await readModelDetailThroughCache(second.input);
    const firstKey = first.cache.match.mock.calls[0]![0];
    const secondKey = second.cache.match.mock.calls[0]![0];
    expect(firstKey.url).toBe(secondKey.url);
    expect(firstKey.method).toBe("GET");
    expect(secondKey.method).toBe("GET");
  });

  it("treats cache exceptions as misses and never reflects diagnostics", async () => {
    const state = harness(undefined);
    state.cache.match.mockRejectedValueOnce(
      new Error("visitor-canary private cache diagnostic"),
    );
    const outcome = await readModelDetailThroughCache(state.input);
    expect(outcome).toEqual(canonicalOutcome());
    expect(JSON.stringify(outcome)).not.toContain("visitor-canary");
    expect(state.readCanonical).toHaveBeenCalledOnce();
  });

  it("treats revoked and throwing cache capabilities as canonical misses", async () => {
    const revokedState = harness(undefined);
    const revoked = Proxy.revocable(revokedState.input.cache, {});
    revoked.revoke();
    const revokedOutcome = await readModelDetailThroughCache({
      ...revokedState.input,
      cache: revoked.proxy,
    });
    expect(revokedOutcome).toEqual(canonicalOutcome());
    expect(revokedState.readCanonical).toHaveBeenCalledOnce();
    expect(revokedState.cache.match).not.toHaveBeenCalled();
    expect(revokedState.cache.put).not.toHaveBeenCalled();
    expect(revokedState.schedule).not.toHaveBeenCalled();

    const throwingState = harness(undefined);
    let getterCalls = 0;
    const throwingCache = {
      get match() {
        getterCalls += 1;
        throw new Error("private cache capability diagnostic");
      },
      put: throwingState.cache.put,
    } as unknown as ModelDetailCacheReadInput["cache"];
    const throwingOutcome = await readModelDetailThroughCache({
      ...throwingState.input,
      cache: throwingCache,
    });
    expect(throwingOutcome).toEqual(canonicalOutcome());
    expect(getterCalls).toBe(1);
    expect(throwingState.readCanonical).toHaveBeenCalledOnce();
    expect(throwingState.cache.put).not.toHaveBeenCalled();
    expect(throwingState.schedule).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong status", () => cacheResponse({ status: 404 })],
    [
      "wrong cache control",
      () => cacheResponse({ headers: { "Cache-Control": "private" } }),
    ],
    [
      "wrong content type",
      () => cacheResponse({ headers: { "Content-Type": "application/json" } }),
    ],
    [
      "wrong publication",
      () =>
        cacheResponse({
          headers: { "X-QuantClarity-Publication": OTHER_PUBLICATION },
        }),
    ],
    ["wrong ETag", () => cacheResponse({ headers: { ETag: '"wrong"' } })],
    ["Set-Cookie", () => cacheResponse({ headers: { "Set-Cookie": "x=y" } })],
    ["Vary", () => cacheResponse({ headers: { Vary: "*" } })],
    [
      "content encoding",
      () => cacheResponse({ headers: { "Content-Encoding": "gzip" } }),
    ],
    [
      "wrong content length",
      () => cacheResponse({ headers: { "Content-Length": "1" } }),
    ],
    [
      "oversized declaration",
      () => cacheResponse({ headers: { "Content-Length": "65537" } }),
    ],
    ["malformed JSON", () => cacheResponse({ body: "{" })],
    [
      "noncanonical JSON",
      () =>
        cacheResponse({
          body: `${new TextDecoder().decode(
            representation.representationBytes,
          )}\n`,
          headers: {
            "Content-Length": String(
              representation.representationBytes.byteLength + 1,
            ),
          },
        }),
    ],
  ])("treats a %s entry as a miss", async (_label, responseFactory) => {
    const state = harness(await responseFactory());
    const outcome = await readModelDetailThroughCache(state.input);
    expect(outcome).toEqual(canonicalOutcome());
    expect(state.readCanonical).toHaveBeenCalledOnce();
    expect(state.cache.put).toHaveBeenCalledOnce();
  });

  it("cancels a cached stream as soon as actual bytes exceed the declaration", async () => {
    let canceled = 0;
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => {
        canceled += 1;
      },
      start: (controller) => {
        controller.enqueue(new Uint8Array([1, 2]));
      },
    });
    const response = await cacheResponse({
      body: stream,
      headers: { "Content-Length": "1" },
    });
    const state = harness(response);
    await expect(readModelDetailThroughCache(state.input)).resolves.toEqual(
      canonicalOutcome(),
    );
    expect(canceled).toBe(1);
    expect(state.readCanonical).toHaveBeenCalledOnce();
    expect(state.cache.put).toHaveBeenCalledOnce();
  });

  it("cancels a pathological cache body after 1,024 chunks", async () => {
    let canceled = 0;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => {
        canceled += 1;
      },
      pull: (controller) => {
        pulls += 1;
        controller.enqueue(new Uint8Array());
      },
    });
    const response = await cacheResponse({
      body: stream,
      headers: { "Content-Length": "1" },
    });
    const state = harness(response);
    await expect(readModelDetailThroughCache(state.input)).resolves.toEqual(
      canonicalOutcome(),
    );
    expect(pulls).toBeGreaterThanOrEqual(1025);
    expect(pulls).toBeLessThanOrEqual(1026);
    expect(canceled).toBe(1);
    expect(state.readCanonical).toHaveBeenCalledOnce();
    expect(state.cache.put).toHaveBeenCalledOnce();
  });

  it("rejects a canonical-looking entry crossed to another Model", async () => {
    const crossed = encodeModelDetailRepresentation({
      model: model(OTHER_MODEL_ID, "other-model"),
      publicationId: PUBLICATION,
      schemaVersion: "1.13.0",
    });
    const etag = await representationEtag(
      PUBLICATION,
      "json",
      crossed.representationBytes,
      crypto.subtle,
    );
    const response = await cacheResponse({
      body: new Uint8Array(crossed.representationBytes),
      headers: {
        "Content-Length": String(crossed.representationBytes.byteLength),
        ETag: etag,
      },
    });
    const state = harness(response);
    await expect(readModelDetailThroughCache(state.input)).resolves.toEqual(
      canonicalOutcome(),
    );
    expect(state.readCanonical).toHaveBeenCalledOnce();
  });

  it.each([
    {
      code: "not_found",
      publicationId: PUBLICATION,
      success: false,
    },
    { code: "integrity_failure", success: false },
    { code: "invalid_input", success: false },
    { code: "read_failure", success: false },
  ] as const)("never writes a canonical $code failure", async (failure) => {
    const state = harness(undefined, failure);
    const outcome = await readModelDetailThroughCache(state.input);
    expect(outcome).toEqual(failure);
    expect(state.cache.put).not.toHaveBeenCalled();
    expect(state.schedule).not.toHaveBeenCalled();
  });

  it("fails closed on a crossed or hostile canonical outcome without writing", async () => {
    const crossed = {
      ...canonicalOutcome(),
      publicationId: OTHER_PUBLICATION,
    } as ModelDetailSelectedReadV2Outcome;
    const state = harness(undefined, crossed);
    await expect(readModelDetailThroughCache(state.input)).resolves.toEqual({
      code: "integrity_failure",
      success: false,
    });
    expect(state.cache.put).not.toHaveBeenCalled();

    let getterCalls = 0;
    const hostile = { ...canonicalOutcome() } as Record<string, unknown>;
    Object.defineProperty(hostile, "detail", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return representation.detail;
      },
    });
    const hostileState = harness(
      undefined,
      hostile as ModelDetailSelectedReadV2Outcome,
    );
    await expect(
      readModelDetailThroughCache(hostileState.input),
    ).resolves.toEqual({ code: "integrity_failure", success: false });
    expect(getterCalls).toBe(0);
    expect(hostileState.cache.put).not.toHaveBeenCalled();
  });

  it("suppresses asynchronous put rejection and scheduler failure", async () => {
    const state = harness(undefined);
    state.cache.put.mockRejectedValueOnce(
      new Error("private cache put diagnostic"),
    );
    state.schedule.mockImplementationOnce(() => {
      throw new Error("private scheduler diagnostic");
    });
    const outcome = await readModelDetailThroughCache(state.input);
    expect(outcome).toEqual(canonicalOutcome());
    expect(state.cache.put).toHaveBeenCalledOnce();
    expect(state.schedule).toHaveBeenCalledOnce();
    await Promise.resolve();
  });

  it("contains canonical-reader rejection as a fixed read failure", async () => {
    const state = harness(undefined);
    state.readCanonical.mockRejectedValueOnce(
      new Error("visitor-canary query diagnostic"),
    );
    await expect(readModelDetailThroughCache(state.input)).resolves.toEqual({
      code: "read_failure",
      success: false,
    });
    expect(state.cache.put).not.toHaveBeenCalled();
  });

  it("rejects malformed top-level capability inputs before any effect", async () => {
    const state = harness(undefined);
    const hostile = { ...state.input } as Record<string, unknown>;
    let getterCalls = 0;
    Object.defineProperty(hostile, "modelId", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return MODEL_ID;
      },
    });
    await expect(
      readModelDetailThroughCache(hostile as ModelDetailCacheReadInput),
    ).resolves.toEqual({ code: "invalid_input", success: false });
    expect(getterCalls).toBe(0);
    expect(state.cache.match).not.toHaveBeenCalled();
    expect(state.readCanonical).not.toHaveBeenCalled();
  });
});

describe("resolver-first Model detail cache orchestration", () => {
  const cacheHarness = (matchValue: Response | undefined) => {
    const cache = {
      match: vi.fn<(request: Request) => Promise<Response | undefined>>(() =>
        Promise.resolve(matchValue),
      ),
      put: vi.fn<(request: Request, response: Response) => Promise<void>>(() =>
        Promise.resolve(),
      ),
    };
    const scheduled: Promise<void>[] = [];
    return {
      cache,
      input: (
        identifier: string,
        service: ReturnType<typeof queryService>,
        method: "GET" | "HEAD" = "GET",
      ) => ({
        cache,
        protectedOrigin: ORIGIN,
        query: {
          environment: "test" as const,
          limits: LIMITS,
          nowMs: NOW_MS,
          request: queryRequest(identifier, method),
          service,
        },
        schedule: (promise: Promise<void>) => {
          scheduled.push(promise);
        },
        subtle: crypto.subtle,
      }),
      scheduled,
    };
  };

  it("resolves before a warm stable-ID hit and skips the canonical RPC", async () => {
    const state = cacheHarness(await cacheResponse());
    const service = queryService();
    const outcome = await readModelDetailFromQueryWithCacheV2(
      state.input(MODEL_ID, service),
    );

    expect(outcome).toEqual(canonicalOutcome());
    expect(service.resolvePublicationV2).toHaveBeenCalledOnce();
    expect(state.cache.match).toHaveBeenCalledOnce();
    expect(service.readModelDetailV2).not.toHaveBeenCalled();
    expect(state.cache.put).not.toHaveBeenCalled();
  });

  it("continues one cold stable-ID miss through the same resolver authority", async () => {
    const state = cacheHarness(undefined);
    const service = queryService();
    const events: string[] = [];
    service.resolvePublicationV2.mockImplementationOnce((input: unknown) => {
      events.push("resolve");
      return Promise.resolve({
        bookmark: "bookmark-cache-v2",
        outcome: "selected",
        publicationId: PUBLICATION,
        requiredAvailableUntilMs: (
          input as { requiredAvailableUntilMs: number }
        ).requiredAvailableUntilMs,
      });
    });
    state.cache.match.mockImplementationOnce(() => {
      events.push("cache.match");
      return Promise.resolve(undefined);
    });
    service.readModelDetailV2.mockImplementationOnce(() => {
      events.push("read");
      return Promise.resolve({
        lookupProvenance: provenance,
        model: model(),
        outcome: "model",
        publicationId: PUBLICATION,
        schemaVersion: "1.13.0",
      });
    });
    state.cache.put.mockImplementationOnce(() => {
      events.push("cache.put");
      return Promise.resolve();
    });

    const outcome = await readModelDetailFromQueryWithCacheV2(
      state.input(MODEL_ID, service),
    );
    expect(outcome).toEqual(canonicalOutcome());
    expect(events).toEqual(["resolve", "cache.match", "read", "cache.put"]);
    expect(state.scheduled).toHaveLength(1);
    await expect(state.scheduled[0]).resolves.toBeUndefined();
  });

  it("never touches Cache API for a resolver-classified slug", async () => {
    const state = cacheHarness(undefined);
    const service = queryService();
    service.readModelDetailV2.mockResolvedValueOnce({
      lookupProvenance: {
        canonicalSlug: "fixture-model",
        matchedBy: "current_slug",
        projectionVersion: "model-slug@1",
      },
      model: model(),
      outcome: "model",
      publicationId: PUBLICATION,
      schemaVersion: "1.13.0",
    });
    const outcome = await readModelDetailFromQueryWithCacheV2(
      state.input("fixture-model", service),
    );

    expect(outcome).toMatchObject({
      lookup: { kind: "slug", value: "fixture-model" },
      success: true,
    });
    expect(service.resolvePublicationV2).toHaveBeenCalledOnce();
    expect(service.readModelDetailV2).toHaveBeenCalledOnce();
    expect(state.cache.match).not.toHaveBeenCalled();
    expect(state.cache.put).not.toHaveBeenCalled();
    expect(state.scheduled).toHaveLength(0);
  });

  it("uses one cache identity for normalized stable-ID GET and HEAD", async () => {
    const state = cacheHarness(undefined);
    await readModelDetailFromQueryWithCacheV2(
      state.input(MODEL_ID, queryService(), "GET"),
    );
    await readModelDetailFromQueryWithCacheV2(
      state.input(MODEL_ID, queryService(), "HEAD"),
    );
    expect(state.cache.match).toHaveBeenCalledTimes(2);
    const getKey = state.cache.match.mock.calls[0]![0];
    const headKey = state.cache.match.mock.calls[1]![0];
    expect(getKey.url).toBe(headKey.url);
    expect(getKey.method).toBe("GET");
    expect(headKey.method).toBe("GET");
    expect(Object.fromEntries(getKey.headers.entries())).toEqual({});
    expect(Object.fromEntries(headKey.headers.entries())).toEqual({});
  });

  it("stops on resolver failure before cache or canonical effects", async () => {
    const state = cacheHarness(undefined);
    const service = queryService();
    service.resolvePublicationV2.mockResolvedValueOnce({
      outcome: "publication_not_ready",
    });
    await expect(
      readModelDetailFromQueryWithCacheV2(state.input(MODEL_ID, service)),
    ).resolves.toEqual({ code: "publication_not_ready", success: false });
    expect(state.cache.match).not.toHaveBeenCalled();
    expect(service.readModelDetailV2).not.toHaveBeenCalled();
  });
});
