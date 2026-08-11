import { describe, expect, it, vi } from "vitest";

import {
  encodeExactVariantCardCollectionRepresentation,
  EXACT_VARIANT_SEARCH_API_PATH,
  validateAndNormalizeRequest,
  verifyCursor,
  type ApiLimits,
  type CursorKeyring,
  type NormalizedRequest,
} from "@quant-clarity/api-core";

import { handleAdmittedExactVariantSearchRuntime } from "./exact-variant-search-runtime.js";
import {
  readExactVariantCardSearchFromQueryV1,
  type ExactVariantCardSearchCatalogQueryRpcV1,
} from "./merged-exact-search-query.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const FAMILY = "fam_11111111-1111-4111-8111-111111111111";
const MODEL = "mdl_11111111-1111-4111-8111-111111111111";
const VARIANT_A = "var_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VARIANT_B = "var_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
  current: { id: "variant-current", secret: new Uint8Array(32).fill(0x32) },
  next: null,
};

const request = (
  rawQuery = "q=Variant&record_type=variant&limit=20",
): NormalizedRequest => {
  const normalized = validateAndNormalizeRequest(
    {
      bodyBytes: 0,
      hasQueryString: true,
      method: "GET",
      pathname: EXACT_VARIANT_SEARCH_API_PATH,
      publicationHeader: null,
      rawQuery,
    },
    limits,
  );
  if (!normalized.success) throw new Error("fixture request must validate");
  return normalized.request;
};

const variantCard = (
  variantId = VARIANT_A,
  evidenceIds: string[] = [EVIDENCE],
) => ({
  variant_id: variantId,
  model_id: MODEL,
  family_id: FAMILY,
  variant_kind: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "quantized-checkpoint",
  },
  display_name: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: variantId === VARIANT_A ? "Variant A" : "Variant B",
  },
  publisher: {
    evidence_ids: evidenceIds,
    observed_at: OBSERVED_AT,
    state: "known",
    value: "Publisher",
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
  active_parameters: {
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
  source_quantization: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "INT4",
  },
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: OBSERVED_AT,
    value: 2,
  },
  last_model_data_refresh: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: OBSERVED_AT,
  },
});

const generatedVariantId = (index: number) =>
  `var_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const page = (
  cards = [variantCard()],
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
      tierMarker: index === 0 ? "exact-v1:c" : "exact-v1:r",
      variantCard: card,
    })),
    semanticDegraded: "disabled",
  },
});

const service = (pageValue: unknown = page()) => ({
  resolvePublicationV2: vi.fn((inputValue: unknown) => {
    const input = inputValue as { requiredAvailableUntilMs: number };
    return Promise.resolve({
      bookmark: "bookmark-variant-card",
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs: input.requiredAvailableUntilMs,
    });
  }),
  readExactVariantCardSearchV1: vi.fn((input: unknown) => {
    void input;
    return Promise.resolve(pageValue);
  }),
  readExactModelCardSearchV1: vi.fn(() =>
    Promise.reject(new Error("Model-card RPC must not be called")),
  ),
  readMergedExactSearchV2: vi.fn(() =>
    Promise.reject(new Error("generic RPC must not be called")),
  ),
});

const execute = (
  queryService: ExactVariantCardSearchCatalogQueryRpcV1,
  requestValue = request(),
) =>
  readExactVariantCardSearchFromQueryV1({
    cursorKeyring: keyring,
    environment: "local",
    limits,
    maximumClockSkewSeconds: 30,
    nowSeconds: NOW_SECONDS,
    request: requestValue,
    service: queryService,
    subtle: crypto.subtle,
  });

const runtimeService = (queryService: ReturnType<typeof service>) =>
  ({
    ...queryService,
    connect() {
      throw new Error("connect must not be called");
    },
    fetch() {
      return Promise.resolve(new Response(null, { status: 500 }));
    },
  }) satisfies Service & ReturnType<typeof service>;

describe("exact Variant-card API adapter (FE-020–FE-027, API-003/007, PRIV-006)", () => {
  it("calls only the dedicated Variant RPC and admits the exact collection", async () => {
    const queryService = service();
    const outcome = await execute(queryService);

    expect(outcome).toEqual({
      success: true,
      collection: {
        data: [
          { match_kind: "canonical_name", variant: variantCard(VARIANT_A) },
        ],
        page: { limit: 20, next_cursor: null },
        meta: {
          filters: { record_type: "variant" },
          publication_id: PUBLICATION,
          resource: "exact_variant_cards",
          schema_version: "1.0.0",
          sort: ["relevance", "stable_id"],
        },
      },
    });
    expect(queryService.readExactVariantCardSearchV1).toHaveBeenCalledOnce();
    expect(queryService.readExactModelCardSearchV1).not.toHaveBeenCalled();
    expect(queryService.readMergedExactSearchV2).not.toHaveBeenCalled();
    expect(
      queryService.readExactVariantCardSearchV1.mock.calls[0]?.[0],
    ).toMatchObject({
      audience: "quantclarity-catalog-query-v1",
      bookmark: "bookmark-variant-card",
      environment: "local",
      version: 1,
      envelope: {
        continuation: null,
        filters: { record_type: "variant" },
        limit: 20,
        publicationId: PUBLICATION,
      },
    });
  });

  it("issues a publication-pinned Variant-only continuation", async () => {
    const cards = Array.from({ length: 20 }, (_, index) =>
      variantCard(generatedVariantId(index + 1)),
    );
    const last = generatedVariantId(20);
    const queryService = service(
      page(cards, { resourceId: last, tierMarker: "exact-v1:r" }),
    );
    const first = await execute(queryService);
    expect(first.success).toBe(true);
    if (!first.success) return;
    const cursor = first.collection.page.next_cursor;
    expect(cursor).toEqual(expect.any(String));
    await expect(
      verifyCursor(cursor ?? "", keyring, NOW_SECONDS, 30, crypto.subtle),
    ).resolves.toMatchObject({
      success: true,
      payload: {
        filters: { record_type: "variant" },
        publicationId: PUBLICATION,
        stableId: last,
      },
    });

    const continuedPage = page([variantCard(VARIANT_B)]);
    continuedPage.page.results[0]!.matchKind = "provider_model_id";
    continuedPage.page.results[0]!.tierMarker = "exact-v1:r";
    const continuedService = service(continuedPage);
    const continued = await execute(
      continuedService,
      request(
        `q=Variant&record_type=variant&limit=20&cursor=${encodeURIComponent(cursor ?? "")}`,
      ),
    );
    expect(continued).toMatchObject({
      success: true,
      collection: { data: [{ variant: { variant_id: VARIANT_B } }] },
    });
    expect(
      continuedService.readExactVariantCardSearchV1.mock.calls[0]?.[0],
    ).toMatchObject({
      envelope: {
        continuation: {
          lastSortTuple: ["exact-v1:r", last],
          stableId: last,
        },
      },
    });
  });

  it("fails closed on wrong order, publication, cursor, shape, and bytes", async () => {
    const wrongOrder = page([variantCard(VARIANT_B), variantCard(VARIANT_A)]);
    wrongOrder.page.results[0]!.matchKind = "provider_model_id";
    wrongOrder.page.results[0]!.tierMarker = "exact-v1:r";
    wrongOrder.page.results[1]!.tierMarker = "exact-v1:r";
    const wrongPublication = page();
    wrongPublication.page.publicationId =
      "pub_22222222-2222-4222-8222-222222222222";
    const wrongCursor = page();
    wrongCursor.page.nextContinuation = {
      resourceId: VARIANT_B,
      tierMarker: "exact-v1:c",
    };
    const wrongShape = page();
    Object.assign(wrongShape.page.results[0]!.variantCard, {
      provider_name: "forbidden",
    });
    let hostileReads = 0;
    const hostile = page();
    Object.defineProperty(hostile.page.results[0]!, "variantCard", {
      enumerable: true,
      get() {
        hostileReads += 1;
        return variantCard();
      },
    });
    const oversized = page([
      variantCard(
        VARIANT_A,
        Array.from(
          { length: 1_600 },
          (_, index) =>
            `evd_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      ),
    ]);
    expect(
      new TextEncoder().encode(JSON.stringify(oversized)).byteLength,
    ).toBeGreaterThan(65_536);

    for (const candidate of [
      wrongOrder,
      wrongPublication,
      wrongCursor,
      wrongShape,
      hostile,
      oversized,
    ])
      await expect(execute(service(candidate))).resolves.toEqual({
        code: "integrity_failure",
        success: false,
      });
    expect(hostileReads).toBe(0);
  });
});

describe("admitted exact Variant runtime (API-010/013, PRIV-003/006/011)", () => {
  it.each(["local", "test"] as const)(
    "serves exact private no-store bytes in %s through only the Variant RPC",
    async (environment) => {
      const queryService = service();
      const response = await handleAdmittedExactVariantSearchRuntime(
        request(),
        { CATALOG_QUERY: runtimeService(queryService) },
        environment,
        NOW_SECONDS * 1000,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("ETag")).toBeNull();
      expect(response.headers.get("Set-Cookie")).toBeNull();
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
      const expected = encodeExactVariantCardCollectionRepresentation({
        data: [
          { match_kind: "canonical_name", variant: variantCard(VARIANT_A) },
        ],
        page: { limit: 20, next_cursor: null },
        meta: {
          filters: { record_type: "variant" },
          publication_id: PUBLICATION,
          resource: "exact_variant_cards",
          schema_version: "1.0.0",
          sort: ["relevance", "stable_id"],
        },
      });
      expect(bytes).toEqual(expected?.representationBytes);
      expect(queryService.readExactVariantCardSearchV1).toHaveBeenCalledOnce();
      expect(queryService.readExactModelCardSearchV1).not.toHaveBeenCalled();
      expect(queryService.readMergedExactSearchV2).not.toHaveBeenCalled();
    },
  );

  it.each(["preview", "production"] as const)(
    "fails closed in %s before reading the query binding",
    async (environment) => {
      let queryCapabilityReads = 0;
      const bindings = Object.defineProperty({}, "CATALOG_QUERY", {
        configurable: false,
        enumerable: true,
        get() {
          queryCapabilityReads += 1;
          return runtimeService(service());
        },
      });
      const response = await handleAdmittedExactVariantSearchRuntime(
        request(),
        bindings as Readonly<{ CATALOG_QUERY: Service }>,
        environment as unknown as "local",
        NOW_SECONDS * 1000,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(queryCapabilityReads).toBe(0);
    },
  );
});
