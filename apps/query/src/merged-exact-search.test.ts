import { beforeEach, describe, expect, it, vi } from "vitest";
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
  readMergedExactSearchPage,
} from "./merged-exact-search.js";
import { ProviderModelIdExactError } from "./provider-model-id-exact.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL_1 = "mdl_11111111-1111-4111-8111-111111111111";
const MODEL_2 = "mdl_22222222-2222-4222-8222-222222222222";
const MODEL_3 = "mdl_33333333-3333-4333-8333-333333333333";
const PROVIDER = "prv_44444444-4444-4444-8444-444444444444";
const displayName = Object.freeze({
  state: "known",
  value: "Fixture",
  observed_at: "2026-08-01T00:00:00.000Z",
  evidence_ids: Object.freeze(["evd_55555555-5555-4555-8555-555555555555"]),
});

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
      input({ eligibilityProviderId: PROVIDER, recordType: "provider" }),
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
