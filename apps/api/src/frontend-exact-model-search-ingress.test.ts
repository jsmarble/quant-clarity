import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalExactModelSearchQuery,
  encodeExactModelCardCollectionRepresentation,
  EXACT_MODEL_SEARCH_API_PATH,
  FRONTEND_API_INTERNAL_ORIGIN,
  signFrontendApiRequest,
} from "@quant-clarity/api-core";

import { handleRequest } from "./request.js";
import type { ExactModelCardSearchCatalogQueryRpcV1 } from "./merged-exact-search-query.js";

const FRONTEND_SECRET = "frontend-test-secret-with-at-least-32-characters";
const LIMITER_SECRET = "limiter-test-secret-with-at-least-32-characters";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const OTHER_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const NOW_MS = 1_786_339_200_000;

const modelCard = (resourceId = MODEL_ID) => ({
  model_id: resourceId,
  display_name: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "Exact Model",
  },
  publisher: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "Fixture Publisher",
  },
  total_parameters: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  active_parameters: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  source_weight_format: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "BF16",
  },
  source_quantization: {
    evidence_ids: [],
    observed_at: OBSERVED_AT,
    state: "unknown",
    value: null,
  },
  cataloged_provider_count: {
    value: 1,
    observed_at: OBSERVED_AT,
    derivation_version: "cataloged-provider-count@1",
  },
  last_model_data_refresh: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: OBSERVED_AT,
  },
});

const result = (resourceId = MODEL_ID) => ({
  matchKind: "canonical_name",
  modelCard: modelCard(resourceId),
  tierMarker: "exact-v1:c",
});

const pageModelId = (index: number) =>
  `mdl_00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

const service = () =>
  ({
    resolvePublicationV2: vi.fn((input: unknown): Promise<unknown> => {
      const requiredAvailableUntilMs = (
        input as { requiredAvailableUntilMs: number }
      ).requiredAvailableUntilMs;
      return Promise.resolve({
        bookmark: "bookmark-exact-model-search",
        outcome: "selected",
        publicationId: PUBLICATION,
        requiredAvailableUntilMs,
      });
    }),
    readExactModelCardSearchV1: vi.fn((input: unknown): Promise<unknown> => {
      void input;
      return Promise.resolve({
        outcome: "page",
        page: {
          nextContinuation: null,
          publicationId: PUBLICATION,
          results: [result()],
          semanticDegraded: "disabled",
        },
      });
    }),
  }) satisfies ExactModelCardSearchCatalogQueryRpcV1;

type DeploymentEnvironment = "local" | "test" | "preview" | "production";

const guardedEnvironment = (
  deploymentEnvironment: DeploymentEnvironment = "local",
) => {
  let limiterCapabilityReads = 0;
  let queryCapabilityReads = 0;
  const queryService = service();
  const env = {
    API_TRANSPORT_POLICY: "local_test",
    DEPLOYMENT_ENV: deploymentEnvironment,
    FRONTEND_API_HMAC_CURRENT: FRONTEND_SECRET,
    PUBLIC_API_ORIGIN: "https://api.example.test",
  } as Record<string, unknown>;
  Object.defineProperty(env, "CATALOG_QUERY", {
    enumerable: true,
    get() {
      queryCapabilityReads += 1;
      return queryService;
    },
  });
  for (const name of [
    "RATE_LIMIT_HMAC_KEY",
    "READ_LIMITER",
    "ROTATION_LIMITER",
  ])
    Object.defineProperty(env, name, {
      enumerable: true,
      get() {
        limiterCapabilityReads += 1;
        throw new Error(`${name} must not be read for internal ingress`);
      },
    });
  return {
    env: env as unknown as Parameters<typeof handleRequest>[1],
    limiterCapabilityReads: () => limiterCapabilityReads,
    queryCapabilityReads: () => queryCapabilityReads,
    queryService,
  };
};

type SignedRequestOptions = Readonly<{
  bodyPresent?: boolean;
  deploymentEnvironment?: DeploymentEnvironment;
  extraHeaders?: Readonly<Record<string, string>>;
  method?: "GET" | "HEAD";
  path?: string;
  publicationHeader?: string | null;
  publicationId?: string | null;
  rawQuery?: string;
}>;

const signedRequest = async (
  options: SignedRequestOptions = {},
): Promise<Request> => {
  const rawQuery =
    options.rawQuery ?? canonicalExactModelSearchQuery("Exact Model");
  if (rawQuery === null) throw new Error("test query is invalid");
  const path = options.path ?? EXACT_MODEL_SEARCH_API_PATH;
  const method = options.method ?? "GET";
  const publicationId =
    options.publicationId === undefined ? PUBLICATION : options.publicationId;
  const headers = await signFrontendApiRequest({
    environment: options.deploymentEnvironment ?? "local",
    method,
    nowMs: NOW_MS,
    path,
    publicationId,
    rawQuery,
    secret: FRONTEND_SECRET,
    subtle: crypto.subtle,
  });
  if (headers === null) throw new Error("test signing failed");
  const publicationHeader =
    options.publicationHeader === undefined
      ? publicationId
      : options.publicationHeader;
  if (publicationHeader !== null)
    headers.set("X-QuantClarity-Publication", publicationHeader);
  for (const [name, value] of Object.entries(options.extraHeaders ?? {}))
    headers.set(name, value);
  const native = new Request(
    `${FRONTEND_API_INTERNAL_ORIGIN}${path}?${rawQuery}`,
    { headers, method },
  );
  if (options.bodyPresent !== true) return native;
  return {
    body: {},
    headers: native.headers,
    method: native.method,
    url: native.url,
  } as unknown as Request;
};

const guardSourceAddress = (request: Request) => {
  let sourceAddressReads = 0;
  const headers = request.headers;
  const guarded = {
    get body() {
      return request.body;
    },
    headers: {
      get(name: string) {
        if (name.toLowerCase() === "cf-connecting-ip") {
          sourceAddressReads += 1;
          throw new Error("source address must not be read before admission");
        }
        return headers.get(name);
      },
      keys() {
        return headers.keys();
      },
    },
    method: request.method,
    url: request.url,
  } as unknown as Request;
  return { guarded, sourceAddressReads: () => sourceAddressReads };
};

const expectClosed = async (
  request: Request,
  deploymentEnvironment: DeploymentEnvironment = "local",
) => {
  const runtime = guardedEnvironment(deploymentEnvironment);
  const incoming = guardSourceAddress(request);
  const response = await handleRequest(incoming.guarded, runtime.env);
  expect(response.status).toBe(404);
  if (request.method === "HEAD") expect(await response.text()).toBe("");
  else
    expect(await response.json()).toEqual({
      error: {
        code: "resource_not_found",
        message: "The requested resource does not exist.",
      },
    });
  expect(response.headers.get("X-QuantClarity-Publication")).toBeNull();
  expect(incoming.sourceAddressReads()).toBe(0);
  expect(runtime.limiterCapabilityReads()).toBe(0);
  expect(runtime.queryCapabilityReads()).toBe(0);
  expect(runtime.queryService.resolvePublicationV2).not.toHaveBeenCalled();
  expect(
    runtime.queryService.readExactModelCardSearchV1,
  ).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signed frontend exact-Model search ingress (FE-010, API-010, SEC-001, SEC-007, SEC-011, PRIV-006)", () => {
  it("admits the exact signed pinned canonical query without visitor-derived capabilities", async () => {
    const runtime = guardedEnvironment();
    const incoming = guardSourceAddress(await signedRequest());
    const response = await handleRequest(incoming.guarded, runtime.env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(
      "X-QuantClarity-Publication",
    );
    expect(response.headers.get("Vary")).toBe("X-QuantClarity-Publication");
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      PUBLICATION,
    );
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("Content-Length")).toBe(
      String(bytes.byteLength),
    );
    const body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    const encoded = encodeExactModelCardCollectionRepresentation(body);
    expect(encoded?.representationBytes).toEqual(bytes);
    expect(encoded?.collection.data).toHaveLength(1);
    expect(encoded?.collection.data[0]).toMatchObject({
      model: { model_id: MODEL_ID },
    });

    expect(incoming.sourceAddressReads()).toBe(0);
    expect(runtime.limiterCapabilityReads()).toBe(0);
    expect(runtime.queryCapabilityReads()).toBe(1);
    expect(runtime.queryService.resolvePublicationV2).toHaveBeenCalledWith({
      audience: "quantclarity-catalog-query-v1",
      environment: "local",
      requestedPublicationId: PUBLICATION,
      requiredAvailableUntilMs: NOW_MS + 15 * 60 * 1000,
      version: 2,
    });
    const firstRead: unknown =
      runtime.queryService.readExactModelCardSearchV1.mock.calls[0]?.[0];
    expect(firstRead).toMatchObject({
      audience: "quantclarity-catalog-query-v1",
      environment: "local",
      envelope: {
        filters: { record_type: "model" },
        limit: 20,
        publicationId: PUBLICATION,
      },
    });
    const calls = JSON.stringify([
      runtime.queryService.resolvePublicationV2.mock.calls,
      runtime.queryService.readExactModelCardSearchV1.mock.calls,
    ]);
    expect(calls).not.toContain(FRONTEND_SECRET);
    expect(calls).not.toContain("cf-connecting-ip");
  });

  it.each([
    ["reordered query", "record_type=model&q=Exact+Model&limit=20"],
    ["equivalent encoding", "q=Exact%20Model&record_type=model&limit=20"],
    ["wrong record type", "q=Exact+Model&record_type=variant&limit=20"],
    ["wrong limit", "q=Exact+Model&record_type=model&limit=19"],
    ["missing limit", "q=Exact+Model&record_type=model"],
    [
      "extra parameter",
      "q=Exact+Model&record_type=model&limit=20&sort=relevance",
    ],
    ["duplicate", "q=Exact+Model&q=Other&record_type=model&limit=20"],
  ])(
    "rejects a signed %s before every read capability",
    async (_label, rawQuery) => {
      await expectClosed(await signedRequest({ rawQuery }));
    },
  );

  it.each([
    ["unpin", { publicationHeader: null, publicationId: null }],
    ["publication mismatch", { publicationHeader: OTHER_PUBLICATION }],
    ["HEAD", { method: "HEAD" }],
    ["body", { bodyPresent: true }],
    ["conditional", { extraHeaders: { "If-None-Match": '"opaque"' } }],
    ["extra header", { extraHeaders: { "X-Visitor": "identity" } }],
    ["wrong path", { path: "/v1/search/" }],
  ] as const)("rejects a signed %s before effects", async (_label, options) => {
    await expectClosed(await signedRequest(options));
  });

  it.each(["test", "preview", "production"] as const)(
    "keeps signed exact Model search closed in %s",
    async (deploymentEnvironment) => {
      await expectClosed(
        await signedRequest({ deploymentEnvironment }),
        deploymentEnvironment,
      );
    },
  );

  it("rejects query tampering before every read capability", async () => {
    const signed = await signedRequest();
    const altered = new Request(
      `${FRONTEND_API_INTERNAL_ORIGIN}${EXACT_MODEL_SEARCH_API_PATH}?q=Other&record_type=model&limit=20`,
      { headers: signed.headers },
    );
    await expectClosed(altered);
  });

  it("authenticates a malformed cursor before reading the query binding", async () => {
    const rawQuery = canonicalExactModelSearchQuery("Exact Model", "tampered");
    if (rawQuery === null) throw new Error("test query is invalid");
    const runtime = guardedEnvironment();
    const response = await handleRequest(
      await signedRequest({ rawQuery }),
      runtime.env,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_cursor", message: "The cursor is invalid." },
    });
    expect(runtime.queryCapabilityReads()).toBe(0);
    expect(runtime.limiterCapabilityReads()).toBe(0);
  });

  it("issues and accepts a continuation with the distinct deterministic local cursor key", async () => {
    const runtime = guardedEnvironment();
    const firstResults = Array.from({ length: 20 }, (_, index) =>
      result(pageModelId(index + 1)),
    );
    const last = firstResults.at(-1);
    if (last === undefined) throw new Error("test page is empty");
    runtime.queryService.readExactModelCardSearchV1
      .mockImplementationOnce(() =>
        Promise.resolve({
          outcome: "page",
          page: {
            nextContinuation: {
              resourceId: last.modelCard.model_id,
              tierMarker: last.tierMarker,
            },
            publicationId: PUBLICATION,
            results: firstResults,
            semanticDegraded: "disabled",
          },
        }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          outcome: "page",
          page: {
            nextContinuation: null,
            publicationId: PUBLICATION,
            results: [],
            semanticDegraded: "disabled",
          },
        }),
      );

    const first = await handleRequest(await signedRequest(), runtime.env);
    expect(first.status).toBe(200);
    const firstBody = await first.json<{
      page: { next_cursor: string | null };
    }>();
    expect(firstBody.page.next_cursor).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    const rawQuery = canonicalExactModelSearchQuery(
      "Exact Model",
      firstBody.page.next_cursor,
    );
    if (rawQuery === null) throw new Error("issued cursor is not canonical");
    const second = await handleRequest(
      await signedRequest({ rawQuery }),
      runtime.env,
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      data: [],
      page: { limit: 20, next_cursor: null },
    });
    expect(runtime.queryCapabilityReads()).toBe(2);
    const secondRead =
      runtime.queryService.readExactModelCardSearchV1.mock.calls[1]?.[0];
    expect(secondRead).toMatchObject({
      envelope: {
        continuation: {
          lastSortTuple: ["exact-v1:c", last.modelCard.model_id],
          stableId: last.modelCard.model_id,
        },
      },
    });
    expect(JSON.stringify(secondRead)).not.toContain(FRONTEND_SECRET);
  });

  it("maps publication expiry without leaking the requested query", async () => {
    const runtime = guardedEnvironment();
    runtime.queryService.resolvePublicationV2.mockImplementationOnce(() =>
      Promise.resolve({
        currentPublicationId: OTHER_PUBLICATION,
        outcome: "publication_expired",
      }),
    );
    const response = await handleRequest(await signedRequest(), runtime.env);
    expect(response.status).toBe(409);
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      OTHER_PUBLICATION,
    );
    expect(await response.json()).toEqual({
      error: {
        code: "publication_expired",
        message: "The requested publication is no longer available.",
      },
    });
    expect(
      runtime.queryService.readExactModelCardSearchV1,
    ).not.toHaveBeenCalled();
  });

  it.each(["publication_not_ready", "read_failure"] as const)(
    "maps resolver %s to a static no-store unavailable response",
    async (outcome) => {
      const runtime = guardedEnvironment();
      runtime.queryService.resolvePublicationV2.mockImplementationOnce(() =>
        Promise.resolve({ outcome }),
      );
      const rawQuery = canonicalExactModelSearchQuery("Visitor Canary");
      if (rawQuery === null) throw new Error("test query is invalid");
      const response = await handleRequest(
        await signedRequest({ rawQuery }),
        runtime.env,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const text = await response.text();
      expect(text).not.toContain("Visitor Canary");
      expect(text).not.toContain(FRONTEND_SECRET);
    },
  );

  it("maps a malformed query response to a static unavailable response", async () => {
    const runtime = guardedEnvironment();
    runtime.queryService.readExactModelCardSearchV1.mockImplementationOnce(() =>
      Promise.resolve({ outcome: "page", visitor: "leak" }),
    );
    const response = await handleRequest(await signedRequest(), runtime.env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "Exact Model search is temporarily unavailable.",
      },
    });
  });

  it("keeps the public search route closed behind the public limiter", async () => {
    const keys: string[] = [];
    const limiter: RateLimit = {
      limit({ key }) {
        keys.push(key);
        return Promise.resolve({ success: true });
      },
    };
    const queryService = service();
    const publicEnv = {
      API_TRANSPORT_POLICY: "local_test",
      CATALOG_QUERY: queryService,
      DEPLOYMENT_ENV: "local",
      RATE_LIMIT_HMAC_KEY: LIMITER_SECRET,
      READ_LIMITER: limiter,
      ROTATION_LIMITER: limiter,
    } as unknown as Parameters<typeof handleRequest>[1];
    const response = await handleRequest(
      new Request(
        `https://api.example.test${EXACT_MODEL_SEARCH_API_PATH}?q=Exact+Model&record_type=model&limit=20`,
        { headers: { "CF-Connecting-IP": "203.0.113.9" } },
      ),
      publicEnv,
    );
    expect(response.status).toBe(404);
    expect(keys).toHaveLength(1);
    expect(queryService.resolvePublicationV2).not.toHaveBeenCalled();
    expect(queryService.readExactModelCardSearchV1).not.toHaveBeenCalled();
  });
});
