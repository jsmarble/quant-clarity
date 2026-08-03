import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as MergedExactSearchModule from "./merged-exact-search.js";

const mocked = vi.hoisted(() => ({ readPage: vi.fn() }));

vi.mock("./merged-exact-search.js", async (importOriginal) => {
  const original = await importOriginal<typeof MergedExactSearchModule>();
  return {
    ...original,
    readMergedExactSearchPage: mocked.readPage,
  };
});

import {
  EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
  MergedExactSearchError,
} from "./merged-exact-search.js";
import {
  readMergedExactSearchV1,
  readMergedExactSearchV2,
} from "./catalog-query-rpc.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL = "mdl_22222222-2222-4222-8222-222222222222";

const envelope = (
  filters: Record<string, string> = {},
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
  filters: Record<string, string> = {},
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
  filters: Record<string, string> = {},
  continuation: unknown = null,
) => ({
  version: 2,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  bookmark: "bookmark-test-only",
  requiredAvailableUntilMs,
  envelope: envelope(filters, continuation),
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
  beforeEach(() => mocked.readPage.mockReset());

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
