import { describe, expect, it, vi } from "vitest";

import {
  encodeExactModelCardCollectionRepresentation,
  validateAndNormalizeRequest,
  verifyCursor,
  type ApiLimits,
  type CursorKeyring,
  type NormalizedRequest,
} from "@quant-clarity/api-core";

import { handleAdmittedExactModelSearchRuntime } from "./exact-model-search-runtime.js";
import {
  readExactModelCardSearchFromQueryV1,
  type ExactModelCardSearchCatalogQueryRpcV1,
} from "./merged-exact-search-query.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL_A = "mdl_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MODEL_B = "mdl_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVIDENCE = "evd_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const NOW_SECONDS = 1_786_339_200;

const limits: ApiLimits = {
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

const keyring: CursorKeyring = {
  current: { id: "current", secret: new Uint8Array(32).fill(0x31) },
  next: null,
};

const generatedModelId = (index: number) =>
  `mdl_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const request = (
  rawQuery = "q=Model&record_type=model&limit=20",
  publicationHeader: string | null = null,
): NormalizedRequest => {
  const outcome = validateAndNormalizeRequest(
    {
      bodyBytes: 0,
      hasQueryString: true,
      method: "GET",
      pathname: "/v1/search",
      publicationHeader,
      rawQuery,
    },
    limits,
  );
  if (!outcome.success) throw new Error("request fixture must validate");
  return outcome.request;
};

const modelCard = (modelId = MODEL_A, evidenceIds = [EVIDENCE]) => ({
  active_parameters: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: OBSERVED_AT,
    value: 2,
  },
  display_name: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: modelId === MODEL_A ? "Model A" : "Model B",
  },
  last_model_data_refresh: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: OBSERVED_AT,
  },
  model_id: modelId,
  publisher: {
    evidence_ids: evidenceIds,
    observed_at: OBSERVED_AT,
    state: "known",
    value: "Publisher",
  },
  source_quantization: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  source_weight_format: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "BF16",
  },
  total_parameters: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: {
      approximation: "exact",
      normalized_decimal: "1000000000",
      raw_value: "1B",
    },
  },
});

const page = (
  cards = [modelCard()],
  nextContinuation: Readonly<{
    tierMarker: "exact-v1:c" | "exact-v1:r" | "exact-v1:n";
    resourceId: string;
  }> | null = null,
) => ({
  outcome: "page",
  page: {
    nextContinuation,
    publicationId: PUBLICATION,
    results: cards.map((card, index) => ({
      matchKind: index === 0 ? "canonical_name" : "provider_model_id",
      modelCard: card,
      tierMarker: index === 0 ? "exact-v1:c" : "exact-v1:r",
    })),
    semanticDegraded: "disabled",
  },
});

const service = (pageValue: unknown = page()) => {
  const readMergedExactSearchV2 = vi.fn((inputValue: unknown) => {
    void inputValue;
    return Promise.reject(new Error("generic search RPC must not be called"));
  });
  const value = {
    resolvePublicationV2: vi.fn((inputValue: unknown) => {
      const input = inputValue as { requiredAvailableUntilMs: number };
      return Promise.resolve({
        bookmark: "bookmark-card-test",
        outcome: "selected",
        publicationId: PUBLICATION,
        requiredAvailableUntilMs: input.requiredAvailableUntilMs,
      });
    }),
    readExactModelCardSearchV1: vi.fn((inputValue: unknown) => {
      void inputValue;
      return Promise.resolve(pageValue);
    }),
    readMergedExactSearchV2,
  };
  return value;
};

const runtimeService = <
  QueryService extends ExactModelCardSearchCatalogQueryRpcV1,
>(
  queryService: QueryService,
) =>
  ({
    ...queryService,
    connect() {
      throw new Error("connect must not be called");
    },
    fetch() {
      return Promise.resolve(new Response(null, { status: 500 }));
    },
  }) satisfies Service & QueryService;

const execute = (
  queryService: ExactModelCardSearchCatalogQueryRpcV1,
  requestValue: NormalizedRequest = request(),
) =>
  readExactModelCardSearchFromQueryV1({
    cursorKeyring: keyring,
    environment: "local",
    limits,
    maximumClockSkewSeconds: 30,
    nowSeconds: NOW_SECONDS,
    request: requestValue,
    service: queryService,
    subtle: crypto.subtle,
  });

describe("exact Model-card API adapter (FE-020/021/023, API-003/007, PRIV-006)", () => {
  it("calls only the dedicated card RPC and admits its closed collection", async () => {
    const queryService = service();
    const outcome = await execute(queryService);

    expect(outcome).toEqual({
      success: true,
      collection: {
        data: [{ match_kind: "canonical_name", model: modelCard() }],
        page: { limit: 20, next_cursor: null },
        meta: {
          filters: { record_type: "model" },
          publication_id: PUBLICATION,
          resource: "exact_model_cards",
          schema_version: "1.0.0",
          sort: ["relevance", "stable_id"],
        },
      },
    });
    expect(queryService.readExactModelCardSearchV1).toHaveBeenCalledTimes(1);
    expect(queryService.readMergedExactSearchV2).not.toHaveBeenCalled();
    expect(
      queryService.readExactModelCardSearchV1.mock.calls[0]?.[0],
    ).toMatchObject({
      audience: "quantclarity-catalog-query-v1",
      bookmark: "bookmark-card-test",
      environment: "local",
      requiredAvailableUntilMs: (NOW_SECONDS + 900) * 1000,
      version: 1,
      envelope: {
        continuation: null,
        filters: { record_type: "model" },
        publicationId: PUBLICATION,
      },
    });
  });

  it("pins the continuation to its publication and preserves its expiry", async () => {
    const firstPageCards = [
      modelCard(MODEL_A),
      ...Array.from({ length: 19 }, (_, index) =>
        modelCard(generatedModelId(index + 1)),
      ),
    ];
    const lastFirstPageId = generatedModelId(19);
    const firstService = service(
      page(firstPageCards, {
        resourceId: lastFirstPageId,
        tierMarker: "exact-v1:r",
      }),
    );
    const first = await execute(firstService);
    expect(first.success).toBe(true);
    if (!first.success) return;
    const cursor = first.collection.page.next_cursor;
    expect(cursor).toEqual(expect.any(String));
    const verified = await verifyCursor(
      cursor ?? "",
      keyring,
      NOW_SECONDS,
      30,
      crypto.subtle,
    );
    expect(verified).toMatchObject({
      success: true,
      payload: {
        expiresAtSeconds: NOW_SECONDS + 900,
        filters: { record_type: "model" },
        publicationId: PUBLICATION,
      },
    });

    const continuedPage = page([modelCard(MODEL_B)]);
    continuedPage.page.results[0]!.matchKind = "provider_model_id";
    continuedPage.page.results[0]!.tierMarker = "exact-v1:r";
    const continuedService = service(continuedPage);
    const continued = await execute(
      continuedService,
      request(
        `q=Model&record_type=model&cursor=${encodeURIComponent(cursor ?? "")}`,
      ),
    );
    expect(continued).toMatchObject({
      success: true,
      collection: {
        data: [{ model: { model_id: MODEL_B } }],
        meta: { publication_id: PUBLICATION },
      },
    });
    expect(continuedService.resolvePublicationV2).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedPublicationId: PUBLICATION,
        requiredAvailableUntilMs: (NOW_SECONDS + 900) * 1000,
      }),
    );
    expect(
      continuedService.readExactModelCardSearchV1.mock.calls[0]?.[0],
    ).toMatchObject({
      envelope: {
        continuation: {
          lastSortTuple: ["exact-v1:r", lastFirstPageId],
          stableId: lastFirstPageId,
        },
        publicationId: PUBLICATION,
      },
    });
    expect(continuedService.readMergedExactSearchV2).not.toHaveBeenCalled();
  });

  it("fails closed on malformed, hostile, and oversized card pages", async () => {
    const malformed = page();
    Object.assign(malformed.page.results[0]!.modelCard, {
      provider_name: "must not enter a Model card",
    });

    let hostileReads = 0;
    const hostile = page();
    Object.defineProperty(hostile.page.results[0]!.modelCard, "publisher", {
      enumerable: true,
      get() {
        hostileReads += 1;
        return modelCard().publisher;
      },
    });

    const oversizedEvidence = Array.from(
      { length: 1_600 },
      (_, index) =>
        `evd_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const oversized = page([modelCard(MODEL_A, oversizedEvidence)]);
    expect(
      new TextEncoder().encode(JSON.stringify(oversized)).byteLength,
    ).toBeGreaterThan(65_536);

    for (const candidate of [malformed, hostile, oversized]) {
      const queryService = service(candidate);
      await expect(execute(queryService)).resolves.toEqual({
        code: "integrity_failure",
        success: false,
      });
      expect(queryService.readMergedExactSearchV2).not.toHaveBeenCalled();
    }
    expect(hostileReads).toBe(0);
  });
});

describe("admitted exact Model-card runtime (API-010/013, PRIV-003/006/011)", () => {
  it("serves the exact encoded no-store representation through only the dedicated RPC", async () => {
    const queryService = service();
    const response = await handleAdmittedExactModelSearchRuntime(
      request(),
      { CATALOG_QUERY: runtimeService(queryService) },
      "local",
      NOW_SECONDS * 1000,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      PUBLICATION,
    );
    expect(response.headers.get("Vary")).toBe("X-QuantClarity-Publication");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    const expected = encodeExactModelCardCollectionRepresentation({
      data: [{ match_kind: "canonical_name", model: modelCard() }],
      page: { limit: 20, next_cursor: null },
      meta: {
        filters: { record_type: "model" },
        publication_id: PUBLICATION,
        resource: "exact_model_cards",
        schema_version: "1.0.0",
        sort: ["relevance", "stable_id"],
      },
    });
    expect(expected).not.toBeNull();
    expect(bytes).toEqual(expected?.representationBytes);
    expect(queryService.readExactModelCardSearchV1).toHaveBeenCalledTimes(1);
    expect(queryService.readMergedExactSearchV2).not.toHaveBeenCalled();
  });

  it("returns a static no-store failure for an unadmitted card page", async () => {
    const malformed = page();
    Object.assign(malformed.page.results[0]!.modelCard, {
      offering_id: "off_11111111-1111-4111-8111-111111111111",
    });
    const queryService = service(malformed);
    const response = await handleAdmittedExactModelSearchRuntime(
      request(),
      { CATALOG_QUERY: runtimeService(queryService) },
      "local",
      NOW_SECONDS * 1000,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("X-QuantClarity-Publication")).toBeNull();
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "Exact Model search is temporarily unavailable.",
      },
    });
    expect(queryService.readExactModelCardSearchV1).toHaveBeenCalledTimes(1);
    expect(queryService.readMergedExactSearchV2).not.toHaveBeenCalled();
  });
});
