import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "@quant-clarity/contracts";
import { MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES } from "@quant-clarity/publication-core";

const mocked = vi.hoisted(() => ({
  model: vi.fn(),
  providerModelId: vi.fn(),
  provider: vi.fn(),
}));

vi.mock("./model-variant-exact-name.js", () => ({
  ModelVariantExactNameError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  readModelVariantExactNamePage: mocked.model,
}));

vi.mock("./provider-model-id-exact.js", () => ({
  ProviderModelIdExactError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  readMergedProviderModelIdExactPage: mocked.providerModelId,
}));

vi.mock("./provider-exact-name.js", () => ({
  ProviderExactNameError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  readProviderExactNamePage: mocked.provider,
}));

import {
  EXACT_CANONICAL_MARKER,
  EXACT_PROVIDER_MARKER,
  EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER,
  EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
  MergedExactSearchError,
  readExactModelCardSearchPage,
  readMergedExactSearchPage,
} from "./merged-exact-search.js";
import { attachModelCardView } from "./model-card-view.js";
import { ProviderModelIdExactError } from "./provider-model-id-exact.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL_1 = "mdl_11111111-1111-4111-8111-111111111111";
const MODEL_2 = "mdl_22222222-2222-4222-8222-222222222222";
const MODEL_3 = "mdl_33333333-3333-4333-8333-333333333333";
const PROVIDER = "prv_44444444-4444-4444-8444-444444444444";
const FAMILY = "fam_66666666-6666-4666-8666-666666666666";
const displayName = Object.freeze({
  state: "known",
  value: "Fixture",
  observed_at: "2026-08-01T00:00:00.000Z",
  evidence_ids: Object.freeze(["evd_55555555-5555-4555-8555-555555555555"]),
});
const unknownFact = Object.freeze({
  state: "unknown" as const,
  value: null,
  observed_at: null,
  evidence_ids: Object.freeze([]),
});
const cardModel = (resourceId = MODEL_1) =>
  ({
    model_id: resourceId,
    family_id: FAMILY,
    display_name: displayName,
    publisher: { ...displayName, value: "Fixture Publisher" },
    total_parameters: {
      ...displayName,
      value: {
        raw_value: "8B",
        normalized_decimal: "8000000000",
        approximation: "exact",
      },
    },
    active_parameters: unknownFact,
    source_weight_format: { ...displayName, value: "BF16" },
    source_quantization: unknownFact,
    cataloged_provider_count: {
      value: 2,
      observed_at: "2026-08-01T00:00:00.000Z",
      derivation_version: "provider-count@1",
    },
    last_model_data_refresh: {
      ...displayName,
      value: "2026-08-01T00:00:00.000Z",
    },
  }) as unknown as Model;

const canonical = (resourceId = MODEL_1) => ({
  tier: 1,
  resourceType: "model",
  resourceId,
  matchKind: "canonical_name",
  displayName,
  semanticDegraded: "disabled",
});

const providerModelId = (resourceId: string) => ({
  tier: 2,
  resourceType: "model",
  resourceId,
  matchKind: "provider_model_id",
  displayName,
  semanticDegraded: "disabled",
});

const provider = () => ({
  tier: 3,
  resourceType: "provider",
  resourceId: PROVIDER,
  matchKind: "provider_name",
  displayName,
  semanticDegraded: "disabled",
  normalizedOrderingKey: "fixture",
});

const input = (overrides: Record<string, unknown> = {}) => ({
  publicationId: PUBLICATION,
  query: "Fixture",
  recordType: null,
  eligibilityProviderId: null,
  continuation: null,
  limit: 20,
  ...overrides,
});

describe("merged exact search (SRCH-002, SRCH-006, API-007, PRIV-006)", () => {
  beforeEach(() => {
    mocked.model.mockReset().mockResolvedValue({
      publicationId: PUBLICATION,
      results: [],
      nextAfterResourceId: null,
    });
    mocked.providerModelId.mockReset().mockResolvedValue({
      publicationId: PUBLICATION,
      results: [],
      matchModes: [],
      nextContinuation: null,
    });
    mocked.provider.mockReset().mockResolvedValue({
      publicationId: PUBLICATION,
      results: [],
      nextAfterProviderId: null,
    });
  });

  it("merges canonical, raw ID, normalized ID, and provider tiers in fixed order", async () => {
    mocked.model.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [canonical()],
      nextAfterResourceId: null,
    });
    mocked.providerModelId.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_2), providerModelId(MODEL_3)],
      matchModes: ["raw", "normalized"],
      nextContinuation: null,
    });
    mocked.provider.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [provider()],
      nextAfterProviderId: null,
    });

    const page = await readMergedExactSearchPage({ prepare: vi.fn() }, input());
    expect(page.results.map((result) => result.tierMarker)).toEqual([
      EXACT_CANONICAL_MARKER,
      EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
      EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER,
      EXACT_PROVIDER_MARKER,
    ]);
    expect(page.nextContinuation).toBeNull();
    expect(page.semanticDegraded).toBe("disabled");
    expect(mocked.providerModelId).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ continuation: null }),
    );
  });

  it("projects a closed Model card from the canonical bytes already held by each exact tier", async () => {
    const canonicalResult = attachModelCardView(canonical(), cardModel());
    const providerIdResult = attachModelCardView(
      providerModelId(MODEL_2),
      cardModel(MODEL_2),
    );
    mocked.model.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [canonicalResult],
      nextAfterResourceId: null,
    });
    mocked.providerModelId.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [providerIdResult],
      matchModes: ["raw"],
      nextContinuation: null,
    });
    const database = { prepare: vi.fn() };
    const page = await readExactModelCardSearchPage(
      database,
      input({ recordType: "model" }),
    );

    expect(database.prepare).not.toHaveBeenCalled();
    expect(page.results).toHaveLength(2);
    expect(page.results[0]?.tierMarker).toBe(EXACT_CANONICAL_MARKER);
    expect(page.results[0]?.matchKind).toBe("canonical_name");
    expect(page.results[0]?.modelCard.model_id).toBe(MODEL_1);
    expect(page.results[0]?.modelCard.cataloged_provider_count).toEqual({
      value: 2,
      observed_at: "2026-08-01T00:00:00.000Z",
      derivation_version: "provider-count@1",
    });
    expect(Object.keys(canonicalResult).sort()).toEqual([
      "displayName",
      "matchKind",
      "resourceId",
      "resourceType",
      "semanticDegraded",
      "tier",
    ]);
    expect(page.results[1]?.modelCard.model_id).toBe(MODEL_2);
    expect(page.results[0]?.modelCard).not.toBe(cardModel());
  });

  it("keeps common Model-card bytes and order invariant under provider and stale eligibility", async () => {
    const arrangeEligibleResults = () => {
      mocked.model.mockResolvedValue({
        publicationId: PUBLICATION,
        results: [attachModelCardView(canonical(), cardModel())],
        nextAfterResourceId: null,
      });
      mocked.providerModelId.mockResolvedValue({
        publicationId: PUBLICATION,
        results: [
          attachModelCardView(providerModelId(MODEL_2), cardModel(MODEL_2)),
        ],
        matchModes: ["raw"],
        nextContinuation: null,
      });
    };
    arrangeEligibleResults();
    const baseline = await readExactModelCardSearchPage(
      { prepare: vi.fn() },
      input({ recordType: "model" }),
    );

    arrangeEligibleResults();
    const filtered = await readExactModelCardSearchPage(
      { prepare: vi.fn() },
      input({
        eligibilityProviderId: PROVIDER,
        eligibilityStale: true,
        recordType: "model",
      }),
    );

    expect(filtered.results.map(({ modelCard }) => modelCard.model_id)).toEqual(
      baseline.results.map(({ modelCard }) => modelCard.model_id),
    );
    expect(
      filtered.results.map(({ modelCard }) => JSON.stringify(modelCard)),
    ).toEqual(
      baseline.results.map(({ modelCard }) => JSON.stringify(modelCard)),
    );
    expect(mocked.model).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        eligibilityProviderId: PROVIDER,
        eligibilityStale: true,
      }),
    );
    expect(mocked.providerModelId).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        eligibilityProviderId: PROVIDER,
        eligibilityStale: true,
      }),
    );

    mocked.model.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [attachModelCardView(canonical(), cardModel())],
      nextAfterResourceId: null,
    });
    mocked.providerModelId.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [],
      matchModes: [],
      nextContinuation: null,
    });
    const membershipReduced = await readExactModelCardSearchPage(
      { prepare: vi.fn() },
      input({
        eligibilityProviderId: PROVIDER,
        eligibilityStale: false,
        recordType: "model",
      }),
    );
    expect(membershipReduced.results).toHaveLength(1);
    expect(JSON.stringify(membershipReduced.results[0]?.modelCard)).toBe(
      JSON.stringify(baseline.results[0]?.modelCard),
    );
  });

  it("rejects non-Model scopes before invoking an exact tier", async () => {
    await expect(
      readExactModelCardSearchPage(
        { prepare: vi.fn() },
        input({ recordType: "variant" }),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(mocked.model).not.toHaveBeenCalled();
    expect(mocked.providerModelId).not.toHaveBeenCalled();
  });

  it("stops on a tier-local lookahead and exposes only the compact marker and ID", async () => {
    mocked.model.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [canonical()],
      nextAfterResourceId: MODEL_1,
    });
    const page = await readMergedExactSearchPage(
      { prepare: vi.fn() },
      input({ limit: 1 }),
    );
    expect(page.results).toHaveLength(1);
    expect(page.nextContinuation).toEqual({
      tierMarker: EXACT_CANONICAL_MARKER,
      resourceId: MODEL_1,
    });
    expect(mocked.providerModelId).not.toHaveBeenCalled();
    expect(mocked.provider).not.toHaveBeenCalled();
  });

  it("probes the next tier when a page ends exactly at a tier boundary", async () => {
    mocked.model.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [canonical()],
      nextAfterResourceId: null,
    });
    mocked.providerModelId.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_2)],
      matchModes: ["raw"],
      nextContinuation: null,
    });
    const page = await readMergedExactSearchPage(
      { prepare: vi.fn() },
      input({ limit: 1 }),
    );
    expect(page.results.map((result) => result.resourceId)).toEqual([MODEL_1]);
    expect(page.nextContinuation).toEqual({
      tierMarker: EXACT_CANONICAL_MARKER,
      resourceId: MODEL_1,
    });
    expect(mocked.provider).not.toHaveBeenCalled();
  });

  it("resumes tier two directly from the complete class and stable-ID tuple", async () => {
    const database = { prepare: vi.fn() };
    mocked.providerModelId.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [],
      matchModes: [],
      nextContinuation: null,
    });
    await readMergedExactSearchPage(
      database,
      input({
        continuation: {
          tierMarker: EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
          resourceId: MODEL_1,
        },
      }),
    );
    expect(database.prepare).not.toHaveBeenCalled();
    expect(mocked.model).not.toHaveBeenCalled();
    expect(mocked.providerModelId).toHaveBeenCalledWith(database, {
      publicationId: PUBLICATION,
      query: "Fixture",
      providerId: null,
      eligibilityProviderId: null,
      familyId: null,
      recordType: null,
      continuation: {
        matchMode: "raw",
        resourceId: MODEL_1,
      },
      limit: 20,
      requiredAvailableUntilMs: null,
    });
  });

  it("paginates raw, normalized, and provider boundaries without skipping tiers", async () => {
    mocked.providerModelId.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_1)],
      matchModes: ["raw"],
      nextContinuation: {
        matchMode: "raw",
        resourceId: MODEL_1,
      },
    });
    const first = await readMergedExactSearchPage(
      { prepare: vi.fn() },
      input({ limit: 1 }),
    );
    expect(first.nextContinuation).toEqual({
      tierMarker: EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
      resourceId: MODEL_1,
    });

    const database = { prepare: vi.fn() };
    mocked.providerModelId.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_2)],
      matchModes: ["normalized"],
      nextContinuation: null,
    });
    mocked.provider.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [provider()],
      nextAfterProviderId: null,
    });
    const second = await readMergedExactSearchPage(
      database,
      input({ limit: 1, continuation: first.nextContinuation }),
    );
    expect(second.results[0]?.tierMarker).toBe(
      EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER,
    );
    expect(second.nextContinuation).toEqual({
      tierMarker: EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER,
      resourceId: MODEL_2,
    });
  });

  it("keeps a maximum display name entirely out of the complete public ordering tuple", async () => {
    const maximumName = "\u{10000}".repeat(
      MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES / 4,
    );
    mocked.providerModelId.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [
        {
          ...providerModelId(MODEL_1),
          displayName: { ...displayName, value: maximumName },
        },
      ],
      matchModes: ["normalized"],
      nextContinuation: {
        matchMode: "normalized",
        resourceId: MODEL_1,
      },
    });
    const database = { prepare: vi.fn() };
    const page = await readMergedExactSearchPage(database, input({ limit: 1 }));
    expect(page.nextContinuation).toEqual({
      tierMarker: EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER,
      resourceId: MODEL_1,
    });
    expect(JSON.stringify(page.nextContinuation)).not.toContain(maximumName);
    expect(database.prepare).not.toHaveBeenCalled();
  });

  it("applies provider-only semantics and skips model tiers", async () => {
    mocked.provider.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [provider()],
      nextAfterProviderId: null,
    });
    const page = await readMergedExactSearchPage(
      { prepare: vi.fn() },
      input({ recordType: "provider" }),
    );
    expect(page.semanticDegraded).toBe("not_applicable");
    expect(page.results[0]?.tierMarker).toBe(EXACT_PROVIDER_MARKER);
    expect(mocked.model).not.toHaveBeenCalled();
    expect(mocked.providerModelId).not.toHaveBeenCalled();
  });

  it("applies provider eligibility independently to target tiers and skips the provider tier", async () => {
    mocked.model.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [canonical()],
      nextAfterResourceId: null,
    });
    mocked.providerModelId.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_2)],
      matchModes: ["raw"],
      nextContinuation: null,
    });
    const database = { prepare: vi.fn() };
    const page = await readMergedExactSearchPage(
      database,
      input({ eligibilityProviderId: PROVIDER }),
    );
    expect(page.results.map((result) => result.resourceType)).toEqual([
      "model",
      "model",
    ]);
    expect(page.results.map((result) => result.resourceId)).toEqual([
      MODEL_1,
      MODEL_2,
    ]);
    expect(mocked.model).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ eligibilityProviderId: PROVIDER }),
    );
    expect(mocked.providerModelId).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        providerId: null,
        eligibilityProviderId: PROVIDER,
      }),
    );
    expect(mocked.provider).not.toHaveBeenCalled();
  });

  it("propagates stale eligibility to both target tiers and suppresses Provider results", async () => {
    const database = { prepare: vi.fn() };
    await readMergedExactSearchPage(
      database,
      input({ eligibilityStale: true }),
    );
    expect(mocked.model).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ eligibilityStale: true }),
    );
    expect(mocked.providerModelId).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ eligibilityStale: true }),
    );
    expect(mocked.provider).not.toHaveBeenCalled();
  });

  it("preserves stale eligibility across compact continuation pages", async () => {
    mocked.providerModelId.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_1)],
      matchModes: ["raw"],
      nextContinuation: { matchMode: "raw", resourceId: MODEL_1 },
    });
    const database = { prepare: vi.fn() };
    const first = await readMergedExactSearchPage(
      database,
      input({ eligibilityStale: true, limit: 1 }),
    );
    expect(first.nextContinuation).toEqual({
      tierMarker: EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
      resourceId: MODEL_1,
    });

    mocked.providerModelId.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_2)],
      matchModes: ["normalized"],
      nextContinuation: null,
    });
    const second = await readMergedExactSearchPage(
      database,
      input({
        eligibilityStale: true,
        continuation: first.nextContinuation,
        limit: 1,
      }),
    );
    expect(second.results.map((result) => result.resourceId)).toEqual([
      MODEL_2,
    ]);
    expect(mocked.providerModelId).toHaveBeenLastCalledWith(
      database,
      expect.objectContaining({ eligibilityStale: true }),
    );
    expect(mocked.provider).not.toHaveBeenCalled();
  });

  it("applies family membership to both target tiers and skips Provider results", async () => {
    mocked.model.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [canonical()],
      nextAfterResourceId: null,
    });
    mocked.providerModelId.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_2)],
      matchModes: ["raw"],
      nextContinuation: null,
    });
    const database = { prepare: vi.fn() };
    const page = await readMergedExactSearchPage(
      database,
      input({ familyId: FAMILY }),
    );
    expect(page.results.map((result) => result.resourceId)).toEqual([
      MODEL_1,
      MODEL_2,
    ]);
    expect(mocked.model).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ familyId: FAMILY }),
    );
    expect(mocked.providerModelId).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ familyId: FAMILY }),
    );
    expect(mocked.provider).not.toHaveBeenCalled();
  });

  it("preserves family membership across compact continuation pages", async () => {
    mocked.providerModelId.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_1)],
      matchModes: ["raw"],
      nextContinuation: { matchMode: "raw", resourceId: MODEL_1 },
    });
    const database = { prepare: vi.fn() };
    const first = await readMergedExactSearchPage(
      database,
      input({ familyId: FAMILY, limit: 1 }),
    );
    expect(first.nextContinuation).toEqual({
      tierMarker: EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
      resourceId: MODEL_1,
    });

    mocked.providerModelId.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_2)],
      matchModes: ["normalized"],
      nextContinuation: null,
    });
    const second = await readMergedExactSearchPage(
      database,
      input({
        familyId: FAMILY,
        continuation: first.nextContinuation,
        limit: 1,
      }),
    );
    expect(second.results.map((result) => result.resourceId)).toEqual([
      MODEL_2,
    ]);
    expect(mocked.providerModelId).toHaveBeenLastCalledWith(
      database,
      expect.objectContaining({ familyId: FAMILY }),
    );
    expect(mocked.provider).not.toHaveBeenCalled();
  });

  it("keeps provider eligibility on every filtered page without entering the provider tier", async () => {
    mocked.providerModelId.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_1)],
      matchModes: ["raw"],
      nextContinuation: { matchMode: "raw", resourceId: MODEL_1 },
    });
    const database = { prepare: vi.fn() };
    const first = await readMergedExactSearchPage(
      database,
      input({ eligibilityProviderId: PROVIDER, limit: 1 }),
    );
    expect(first.nextContinuation).toEqual({
      tierMarker: EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
      resourceId: MODEL_1,
    });
    expect(mocked.providerModelId).toHaveBeenLastCalledWith(
      database,
      expect.objectContaining({ eligibilityProviderId: PROVIDER }),
    );

    mocked.providerModelId.mockResolvedValueOnce({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_2)],
      matchModes: ["normalized"],
      nextContinuation: null,
    });
    const second = await readMergedExactSearchPage(
      database,
      input({
        eligibilityProviderId: PROVIDER,
        continuation: first.nextContinuation,
        limit: 1,
      }),
    );
    expect(second.results).toHaveLength(1);
    expect(second.results[0]?.resourceId).toBe(MODEL_2);
    expect(mocked.providerModelId).toHaveBeenLastCalledWith(
      database,
      expect.objectContaining({ eligibilityProviderId: PROVIDER }),
    );
    expect(mocked.provider).not.toHaveBeenCalled();
  });

  it("keeps raw-only provider-model IDs searchable when normalization is empty", async () => {
    mocked.providerModelId.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [providerModelId(MODEL_1)],
      matchModes: ["raw"],
      nextContinuation: null,
    });
    const page = await readMergedExactSearchPage(
      { prepare: vi.fn() },
      input({ query: "*" }),
    );
    expect(page.results[0]?.tierMarker).toBe(
      EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
    );
    expect(mocked.model).not.toHaveBeenCalled();
    expect(mocked.provider).not.toHaveBeenCalled();
  });

  it("rejects malformed continuations and incompatible filters before reads", async () => {
    const candidates = [
      input({
        continuation: { tierMarker: "exact-v1:x", resourceId: MODEL_1 },
      }),
      input({
        recordType: "provider",
        continuation: {
          tierMarker: EXACT_CANONICAL_MARKER,
          resourceId: MODEL_1,
        },
      }),
      input({
        recordType: "model",
        continuation: {
          tierMarker: EXACT_CANONICAL_MARKER,
          resourceId: "var_11111111-1111-4111-8111-111111111111",
        },
      }),
      input({ query: " padded " }),
      input({ query: "\ud800" }),
      input({ limit: 21 }),
      input({ eligibilityProviderId: "prv_invalid" }),
      input({ familyId: "fam_invalid" }),
      input({ familyId: FAMILY, recordType: "provider" }),
      input({ eligibilityProviderId: PROVIDER, recordType: "provider" }),
      input({ eligibilityStale: "true" }),
      input({ eligibilityStale: true, recordType: "provider" }),
      input({
        familyId: FAMILY,
        continuation: {
          tierMarker: EXACT_PROVIDER_MARKER,
          resourceId: PROVIDER,
        },
      }),
      input({
        eligibilityProviderId: PROVIDER,
        continuation: {
          tierMarker: EXACT_PROVIDER_MARKER,
          resourceId: PROVIDER,
        },
      }),
    ];
    for (const candidate of candidates)
      await expect(
        readMergedExactSearchPage({ prepare: vi.fn() }, candidate),
      ).rejects.toBeInstanceOf(MergedExactSearchError);
    expect(mocked.model).not.toHaveBeenCalled();
  });

  it("maps reader failures to static errors without echoing visitor input", async () => {
    mocked.providerModelId.mockRejectedValueOnce(
      new ProviderModelIdExactError("read_failure"),
    );
    await expect(
      readMergedExactSearchPage(
        { prepare: vi.fn() },
        input({ query: "private visitor query" }),
      ),
    ).rejects.toMatchObject({ code: "read_failure" });
    mocked.providerModelId.mockRejectedValueOnce(
      new Error("private visitor query"),
    );
    await expect(
      readMergedExactSearchPage(
        { prepare: vi.fn() },
        input({ query: "private visitor query" }),
      ),
    ).rejects.toMatchObject({
      code: "read_failure",
      message: "Published exact-search data could not be read.",
    });
  });

  it("rejects hostile reader pages without invoking accessors", async () => {
    let reads = 0;
    const hostile = {
      publicationId: PUBLICATION,
      results: [],
      nextAfterResourceId: null,
    } as Record<string, unknown>;
    Object.defineProperty(hostile, "results", {
      enumerable: true,
      get: () => {
        reads += 1;
        return [];
      },
    });
    mocked.model.mockResolvedValueOnce(hostile);
    await expect(
      readMergedExactSearchPage({ prepare: vi.fn() }, input()),
    ).rejects.toMatchObject({ code: "integrity_failure" });
    expect(reads).toBe(0);
    expect(mocked.providerModelId).not.toHaveBeenCalled();
  });
});
