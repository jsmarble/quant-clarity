import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as MergedExactSearchModule from "./merged-exact-search.js";

const mocked = vi.hoisted(() => ({
  readCardPage: vi.fn(),
  readVariantCardPage: vi.fn(),
  readPage: vi.fn(),
}));

vi.mock("./merged-exact-search.js", async (importOriginal) => {
  const original = await importOriginal<typeof MergedExactSearchModule>();
  return {
    ...original,
    readExactModelCardSearchPage: mocked.readCardPage,
    readExactVariantCardSearchPage: mocked.readVariantCardPage,
    readMergedExactSearchPage: mocked.readPage,
  };
});

import {
  EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
  MergedExactSearchError,
} from "./merged-exact-search.js";
import {
  readExactModelCardSearchV1,
  readExactVariantCardSearchV1,
  readMergedExactSearchV1,
  readMergedExactSearchV2,
} from "./catalog-query-rpc.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL = "mdl_22222222-2222-4222-8222-222222222222";
const VARIANT = "var_22222222-2222-4222-8222-222222222222";
const FAMILY = "fam_33333333-3333-4333-8333-333333333333";

const envelope = (
  filters: Record<string, string | boolean> = {},
  continuation: unknown = null,
) => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  operation: { kind: "search" },
  publicationId: PUBLICATION,
  filters,
  sort: ["relevance", "stable_id"],
  limit: 20,
  continuation,
  searchPlan: {
    kind: "exact_structured",
    query: "Fixture",
    filters: { ...filters },
    limit: 20,
    semanticCandidates: 0,
    semanticCalls: 0,
    semanticDegraded: "disabled",
  },
});

const input = (
  filters: Record<string, string | boolean> = {},
  continuation: unknown = null,
) => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  bookmark: "bookmark-test-only",
  envelope: envelope(filters, continuation),
});

const inputV2 = (
  requiredAvailableUntilMs: number,
  filters: Record<string, string | boolean> = {},
  continuation: unknown = null,
) => ({
  version: 2,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  bookmark: "bookmark-test-only",
  requiredAvailableUntilMs,
  envelope: envelope(filters, continuation),
});

const cardInput = (requiredAvailableUntilMs: number) => ({
  ...inputV2(requiredAvailableUntilMs, { record_type: "model" }),
  version: 1,
});

const variantCardInput = (
  requiredAvailableUntilMs: number,
  continuation: unknown = null,
) => ({
  ...inputV2(
    requiredAvailableUntilMs,
    { record_type: "variant" },
    continuation,
  ),
  version: 1,
});

class FakeDatabase {
  readonly sessionInputs: string[] = [];
  readonly session = { prepare: vi.fn() } as unknown as D1DatabaseSession;

  asD1(): D1Database {
    return {
      withSession: (bookmark: string) => {
        this.sessionInputs.push(bookmark);
        return this.session;
      },
    } as D1Database;
  }
}

describe("merged exact-search RPC (SRCH-002, API-003, API-007, CF-020)", () => {
  beforeEach(() => {
    mocked.readCardPage.mockReset();
    mocked.readVariantCardPage.mockReset();
    mocked.readPage.mockReset();
  });

  it("exposes a dedicated V1 Variant-card RPC with exact bookmark/horizon continuity", async () => {
    const page = {
      publicationId: PUBLICATION,
      results: [],
      nextContinuation: null,
      semanticDegraded: "disabled",
    } as const;
    const horizon = 2_000_000_000_000;
    mocked.readVariantCardPage.mockResolvedValue(page);
    const database = new FakeDatabase();

    await expect(
      readExactVariantCardSearchV1(
        database.asD1(),
        "test",
        variantCardInput(horizon),
      ),
    ).resolves.toEqual({ outcome: "page", page });
    expect(database.sessionInputs).toEqual(["bookmark-test-only"]);
    expect(mocked.readVariantCardPage).toHaveBeenCalledWith(database.session, {
      publicationId: PUBLICATION,
      query: "Fixture",
      recordType: "variant",
      eligibilityProviderId: null,
      familyId: null,
      continuation: null,
      limit: 20,
      requiredAvailableUntilMs: horizon,
    });
    expect(mocked.readPage).not.toHaveBeenCalled();

    const continuation = {
      lastSortTuple: [EXACT_PROVIDER_MODEL_ID_RAW_MARKER, VARIANT],
      stableId: VARIANT,
    };
    await expect(
      readExactVariantCardSearchV1(
        database.asD1(),
        "test",
        variantCardInput(horizon, continuation),
      ),
    ).resolves.toEqual({ outcome: "page", page });
    expect(mocked.readVariantCardPage).toHaveBeenLastCalledWith(
      database.session,
      expect.objectContaining({
        continuation: {
          tierMarker: EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
          resourceId: VARIANT,
        },
        requiredAvailableUntilMs: horizon,
      }),
    );

    await expect(
      readExactVariantCardSearchV1(database.asD1(), "test", {
        ...variantCardInput(horizon),
        envelope: envelope({ record_type: "model" }),
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    await expect(
      readExactVariantCardSearchV1(database.asD1(), "preview", {
        ...variantCardInput(horizon),
        envelope: {
          ...envelope({ record_type: "variant" }),
          environment: "preview",
          searchPlan: {
            ...envelope({ record_type: "variant" }).searchPlan,
            filters: { record_type: "variant" },
          },
        },
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });
  });

  it("exposes a dedicated V1 Model-card RPC without changing generic V2", async () => {
    const page = {
      publicationId: PUBLICATION,
      results: [],
      nextContinuation: null,
      semanticDegraded: "disabled",
    } as const;
    const horizon = 2_000_000_000_000;
    mocked.readCardPage.mockResolvedValue(page);
    const database = new FakeDatabase();

    await expect(
      readExactModelCardSearchV1(database.asD1(), "test", cardInput(horizon)),
    ).resolves.toEqual({ outcome: "page", page });
    expect(mocked.readCardPage).toHaveBeenCalledWith(database.session, {
      publicationId: PUBLICATION,
      query: "Fixture",
      recordType: "model",
      eligibilityProviderId: null,
      familyId: null,
      continuation: null,
      limit: 20,
      requiredAvailableUntilMs: horizon,
    });
    expect(mocked.readPage).not.toHaveBeenCalled();

    await expect(
      readExactModelCardSearchV1(database.asD1(), "test", {
        ...cardInput(horizon),
        envelope: envelope(),
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });
  });

  it("opens exactly one bookmark-continuous session and passes the compact continuation", async () => {
    const page = {
      publicationId: PUBLICATION,
      results: [],
      nextContinuation: null,
      semanticDegraded: "disabled",
    } as const;
    mocked.readPage.mockResolvedValue(page);
    const database = new FakeDatabase();
    const continuation = {
      lastSortTuple: [EXACT_PROVIDER_MODEL_ID_RAW_MARKER, MODEL],
      stableId: MODEL,
    };
    await expect(
      readMergedExactSearchV1(
        database.asD1(),
        "test",
        input({ record_type: "model" }, continuation),
      ),
    ).resolves.toEqual({ outcome: "page", page });
    expect(database.sessionInputs).toEqual(["bookmark-test-only"]);
    expect(mocked.readPage).toHaveBeenCalledWith(database.session, {
      publicationId: PUBLICATION,
      query: "Fixture",
      recordType: "model",
      eligibilityProviderId: null,
      familyId: null,
      continuation: {
        tierMarker: EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
        resourceId: MODEL,
      },
      limit: 20,
      requiredAvailableUntilMs: null,
    });
  });

  it("rejects open filters, mismatched tuples, and accessors before opening D1", async () => {
    const valid = input();
    const accessor = { ...valid } as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(accessor, "envelope", {
      enumerable: true,
      get: () => {
        reads += 1;
        return valid.envelope;
      },
    });
    const hostileFilter = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("private nested proxy");
        },
      },
    );
    const hostileNested = input();
    hostileNested.envelope.filters = hostileFilter;
    hostileNested.envelope.searchPlan.filters = hostileFilter;
    const candidates = [
      input({ provider: "prv_invalid" }),
      input({ provider: undefined as unknown as string }),
      input({ record_type: undefined as unknown as string }),
      input({ record_type: "offering" }),
      input({ stale: "true" }),
      input({ stale: true, record_type: "provider" }),
      input(
        {},
        {
          lastSortTuple: [EXACT_PROVIDER_MODEL_ID_RAW_MARKER, MODEL],
          stableId: "mdl_33333333-3333-4333-8333-333333333333",
        },
      ),
      input(
        {},
        {
          lastSortTuple: [EXACT_PROVIDER_MODEL_ID_RAW_MARKER],
          stableId: MODEL,
        },
      ),
      { ...valid, bookmark: "first-primary" },
      accessor,
      hostileNested,
    ];
    const database = new FakeDatabase();
    for (const candidate of candidates)
      await expect(
        readMergedExactSearchV1(database.asD1(), "test", candidate),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(reads).toBe(0);
    expect(database.sessionInputs).toEqual([]);
    expect(mocked.readPage).not.toHaveBeenCalled();
  });

  it("maps only static errors and never echoes the query", async () => {
    const database = new FakeDatabase();
    mocked.readPage.mockRejectedValueOnce(
      new MergedExactSearchError("integrity_failure"),
    );
    await expect(
      readMergedExactSearchV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    mocked.readPage.mockRejectedValueOnce(
      new MergedExactSearchError("read_failure"),
    );
    await expect(
      readMergedExactSearchV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "read_failure" });
    mocked.readPage.mockRejectedValueOnce(new Error("private visitor query"));
    await expect(
      readMergedExactSearchV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "read_failure" });
  });

  it("propagates the authenticated availability horizon through protocol v2", async () => {
    const page = {
      publicationId: PUBLICATION,
      results: [],
      nextContinuation: null,
      semanticDegraded: "disabled",
    } as const;
    const horizon = 2_000_000_000_000;
    mocked.readPage.mockResolvedValue(page);
    const database = new FakeDatabase();
    await expect(
      readMergedExactSearchV2(database.asD1(), "test", inputV2(horizon)),
    ).resolves.toEqual({ outcome: "page", page });
    expect(mocked.readPage).toHaveBeenCalledWith(database.session, {
      publicationId: PUBLICATION,
      query: "Fixture",
      recordType: null,
      continuation: null,
      limit: 20,
      requiredAvailableUntilMs: horizon,
      eligibilityProviderId: null,
      familyId: null,
    });
  });

  it("passes an exact provider eligibility filter while keeping it independent of match witnesses", async () => {
    const page = {
      publicationId: PUBLICATION,
      results: [],
      nextContinuation: null,
      semanticDegraded: "disabled",
    } as const;
    const provider = "prv_11111111-1111-4111-8111-111111111111";
    mocked.readPage.mockResolvedValue(page);
    const database = new FakeDatabase();
    await expect(
      readMergedExactSearchV1(
        database.asD1(),
        "test",
        input({ provider, record_type: "model" }),
      ),
    ).resolves.toEqual({ outcome: "page", page });
    expect(mocked.readPage).toHaveBeenCalledWith(
      database.session,
      expect.objectContaining({
        recordType: "model",
        eligibilityProviderId: provider,
      }),
    );
  });

  it("passes an exact boolean stale eligibility filter", async () => {
    const page = {
      publicationId: PUBLICATION,
      results: [],
      nextContinuation: null,
      semanticDegraded: "disabled",
    } as const;
    mocked.readPage.mockResolvedValue(page);
    const database = new FakeDatabase();
    await expect(
      readMergedExactSearchV1(database.asD1(), "test", input({ stale: true })),
    ).resolves.toEqual({ outcome: "page", page });
    expect(mocked.readPage).toHaveBeenCalledWith(
      database.session,
      expect.objectContaining({ eligibilityStale: true }),
    );
  });

  it("reconciles one exact canonical family filter and passes its stable ID", async () => {
    const page = {
      publicationId: PUBLICATION,
      results: [],
      nextContinuation: null,
      semanticDegraded: "disabled",
    } as const;
    mocked.readPage.mockResolvedValue(page);
    const database = new FakeDatabase();
    await expect(
      readMergedExactSearchV1(
        database.asD1(),
        "test",
        input({ family: FAMILY }),
      ),
    ).resolves.toEqual({ outcome: "page", page });
    expect(mocked.readPage).toHaveBeenCalledWith(
      database.session,
      expect.objectContaining({ familyId: FAMILY }),
    );
  });

  it("rejects mismatched provider filters, provider records, and provider cursors before D1", async () => {
    const provider = "prv_11111111-1111-4111-8111-111111111111";
    const mismatched = input({ provider });
    mismatched.envelope.searchPlan.filters = {};
    const candidates = [
      mismatched,
      input({ provider, record_type: "provider" }),
      input(
        { provider },
        {
          lastSortTuple: [
            "exact-v1:p",
            "prv_22222222-2222-4222-8222-222222222222",
          ],
          stableId: "prv_22222222-2222-4222-8222-222222222222",
        },
      ),
    ];
    const database = new FakeDatabase();
    for (const candidate of candidates)
      await expect(
        readMergedExactSearchV1(database.asD1(), "test", candidate),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(database.sessionInputs).toEqual([]);
    expect(mocked.readPage).not.toHaveBeenCalled();
  });

  it("rejects malformed, mismatched, Provider-scoped, and accessor-backed family filters before D1", async () => {
    const mismatched = input({ family: FAMILY });
    mismatched.envelope.searchPlan.filters = {};
    const accessor = input();
    const familyFilter = {} as Record<string, string>;
    let reads = 0;
    Object.defineProperty(familyFilter, "family", {
      enumerable: true,
      get: () => {
        reads += 1;
        return FAMILY;
      },
    });
    accessor.envelope.filters = familyFilter;
    accessor.envelope.searchPlan.filters = familyFilter;
    const candidates = [
      input({ family: "fam_invalid" }),
      input({ family: FAMILY.toUpperCase() }),
      input({ family: FAMILY, record_type: "provider" }),
      input(
        { family: FAMILY },
        {
          lastSortTuple: [
            "exact-v1:p",
            "prv_22222222-2222-4222-8222-222222222222",
          ],
          stableId: "prv_22222222-2222-4222-8222-222222222222",
        },
      ),
      mismatched,
      accessor,
    ];
    const database = new FakeDatabase();
    for (const candidate of candidates)
      await expect(
        readMergedExactSearchV1(database.asD1(), "test", candidate),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(reads).toBe(0);
    expect(database.sessionInputs).toEqual([]);
    expect(mocked.readPage).not.toHaveBeenCalled();
  });

  it("rejects malformed or accessor-backed v2 horizons before opening D1", async () => {
    const database = new FakeDatabase();
    const valid = inputV2(2_000_000_000_000);
    let reads = 0;
    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, "requiredAvailableUntilMs", {
      enumerable: true,
      get: () => {
        reads += 1;
        return 2_000_000_000_000;
      },
    });
    for (const candidate of [
      accessor,
      { ...valid, requiredAvailableUntilMs: -1 },
      { ...valid, requiredAvailableUntilMs: Number.MAX_VALUE },
      { ...valid, extra: true },
    ])
      await expect(
        readMergedExactSearchV2(database.asD1(), "test", candidate),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(reads).toBe(0);
    expect(database.sessionInputs).toEqual([]);
    expect(mocked.readPage).not.toHaveBeenCalled();
  });
});
