import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ readPage: vi.fn() }));

vi.mock("./provider-model-id-exact.js", () => ({
  ProviderModelIdExactError: class extends Error {
    readonly code: "invalid_input" | "integrity_failure" | "read_failure";

    constructor(code: "invalid_input" | "integrity_failure" | "read_failure") {
      super(code);
      this.code = code;
    }
  },
  readProviderModelIdExactPage: mocked.readPage,
}));

import { readProviderModelIdExactTierV1 } from "./catalog-query-rpc.js";
import { ProviderModelIdExactError } from "./provider-model-id-exact.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const PROVIDER = "prv_22222222-2222-4222-8222-222222222222";
const QUERY = "accounts/provider/models/*\u0000[alpha]";

const envelope = (filters: Record<string, string> = {}, query = QUERY) => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  operation: { kind: "search" },
  publicationId: PUBLICATION,
  filters,
  sort: ["relevance", "stable_id"],
  limit: 20,
  continuation: null,
  searchPlan: {
    kind: "exact_structured",
    query,
    filters: { ...filters },
    limit: 20,
    semanticCandidates: 0,
    semanticCalls: 0,
    semanticDegraded: "disabled",
  },
});

const input = (filters: Record<string, string> = {}, query = QUERY) => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  bookmark: "bookmark-test-only",
  envelope: envelope(filters, query),
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

describe("provider-model-ID exact query RPC (SRCH-002, API-003, PRIV-006)", () => {
  beforeEach(() => mocked.readPage.mockReset());

  it("uses the selected bookmark and preserves literal punctuation and NUL", async () => {
    const page = {
      publicationId: PUBLICATION,
      matchModes: [],
      results: [],
      nextContinuation: null,
    } as const;
    mocked.readPage.mockResolvedValue(page);
    const database = new FakeDatabase();

    await expect(
      readProviderModelIdExactTierV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "page", page });
    expect(database.sessionInputs).toEqual(["bookmark-test-only"]);
    expect(mocked.readPage).toHaveBeenCalledWith(database.session, {
      publicationId: PUBLICATION,
      query: QUERY,
      providerId: null,
      recordType: null,
      continuation: null,
      limit: 20,
    });
  });

  it("passes only the closed provider and record-type filters", async () => {
    mocked.readPage.mockResolvedValue({
      publicationId: PUBLICATION,
      matchModes: [],
      results: [],
      nextContinuation: null,
    });
    const database = new FakeDatabase();
    await expect(
      readProviderModelIdExactTierV1(
        database.asD1(),
        "test",
        input({ provider: PROVIDER, record_type: "variant" }),
      ),
    ).resolves.toMatchObject({ outcome: "page" });
    expect(mocked.readPage).toHaveBeenCalledWith(database.session, {
      publicationId: PUBLICATION,
      query: QUERY,
      providerId: PROVIDER,
      recordType: "variant",
      continuation: null,
      limit: 20,
    });
  });

  it("accepts a raw-only literal whose pinned normalization is empty", async () => {
    mocked.readPage.mockResolvedValue({
      publicationId: PUBLICATION,
      matchModes: [],
      results: [],
      nextContinuation: null,
    });
    const database = new FakeDatabase();
    await expect(
      readProviderModelIdExactTierV1(database.asD1(), "test", input({}, "*")),
    ).resolves.toMatchObject({ outcome: "page" });
    expect(mocked.readPage).toHaveBeenCalledWith(
      database.session,
      expect.objectContaining({ query: "*" }),
    );
  });

  it("rejects malformed envelopes and accessors before opening a session", async () => {
    const valid = input();
    const getter = { ...valid } as Record<string, unknown>;
    let reads = 0;
    Object.defineProperty(getter, "envelope", {
      enumerable: true,
      get: () => {
        reads += 1;
        return valid.envelope;
      },
    });
    const candidates: unknown[] = [
      { ...valid, extra: true },
      { ...valid, bookmark: "first-primary" },
      { ...valid, environment: "preview" },
      { ...valid, envelope: { ...valid.envelope, continuation: {} } },
      { ...valid, envelope: { ...valid.envelope, filters: { stale: true } } },
      {
        ...valid,
        envelope: {
          ...valid.envelope,
          filters: { provider: "not-a-provider" },
          searchPlan: {
            ...valid.envelope.searchPlan,
            filters: { provider: "not-a-provider" },
          },
        },
      },
      {
        ...valid,
        envelope: {
          ...valid.envelope,
          searchPlan: { ...valid.envelope.searchPlan, query: " padded " },
        },
      },
      {
        ...valid,
        envelope: {
          ...valid.envelope,
          searchPlan: {
            ...valid.envelope.searchPlan,
            query: "x".repeat(201),
          },
        },
      },
      getter,
    ];

    const database = new FakeDatabase();
    for (const candidate of candidates)
      await expect(
        readProviderModelIdExactTierV1(database.asD1(), "test", candidate),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(reads).toBe(0);
    expect(database.sessionInputs).toEqual([]);
    expect(mocked.readPage).not.toHaveBeenCalled();
  });

  it("maps only static reader errors and never echoes an unknown failure", async () => {
    const database = new FakeDatabase();
    mocked.readPage.mockRejectedValueOnce(
      new ProviderModelIdExactError("read_failure"),
    );
    await expect(
      readProviderModelIdExactTierV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "read_failure" });

    mocked.readPage.mockRejectedValueOnce(
      new ProviderModelIdExactError("invalid_input"),
    );
    await expect(
      readProviderModelIdExactTierV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    mocked.readPage.mockRejectedValueOnce(
      new ProviderModelIdExactError("integrity_failure"),
    );
    await expect(
      readProviderModelIdExactTierV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    mocked.readPage.mockRejectedValueOnce(new Error("private query value"));
    await expect(
      readProviderModelIdExactTierV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "read_failure" });
  });
});
