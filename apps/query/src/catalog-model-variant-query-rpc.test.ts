import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  readPage: vi.fn(),
}));

vi.mock("./model-variant-exact-name.js", () => ({
  ModelVariantExactNameError: class extends Error {
    readonly code: "invalid_input" | "integrity_failure" | "read_failure";

    constructor(code: "invalid_input" | "integrity_failure" | "read_failure") {
      super(code);
      this.code = code;
    }
  },
  readModelVariantExactNamePage: mocked.readPage,
}));

import { ModelVariantExactNameError } from "./model-variant-exact-name.js";
import { readModelVariantExactNameTierV1 } from "./catalog-query-rpc.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL = "mdl_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const envelope = (query = "Fixture\u0000Model") => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  operation: { kind: "search" },
  publicationId: PUBLICATION,
  filters: {},
  sort: ["relevance", "stable_id"],
  limit: 20,
  continuation: null,
  searchPlan: {
    kind: "exact_structured",
    query,
    filters: {},
    limit: 20,
    semanticCandidates: 0,
    semanticCalls: 0,
    semanticDegraded: "disabled",
  },
});

const input = (query?: string) => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  bookmark: "bookmark-test-only",
  envelope: envelope(query),
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

describe("model/variant exact-name query RPC (API-003, SRCH-002, CF-020)", () => {
  beforeEach(() => {
    mocked.readPage.mockReset();
  });

  it("anchors the reader to the selected bookmark and preserves embedded NUL", async () => {
    const page = {
      publicationId: PUBLICATION,
      results: [
        {
          tier: 1,
          resourceType: "model",
          resourceId: MODEL,
          matchKind: "canonical_name",
          displayName: {
            state: "known",
            value: "Fixture\u0000Model",
            observed_at: "2026-08-01T00:00:00.000Z",
            evidence_ids: ["evd_cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
          },
          semanticDegraded: "disabled",
        },
      ],
      nextAfterResourceId: null,
    } as const;
    mocked.readPage.mockResolvedValue(page);
    const database = new FakeDatabase();

    await expect(
      readModelVariantExactNameTierV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "page", page });
    expect(database.sessionInputs).toEqual(["bookmark-test-only"]);
    expect(mocked.readPage).toHaveBeenCalledWith(database.session, {
      publicationId: PUBLICATION,
      query: "Fixture\u0000Model",
      recordType: null,
      afterResourceId: null,
      limit: 20,
    });
  });

  it("passes the optional closed model/variant selector to the reader", async () => {
    mocked.readPage.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [],
      nextAfterResourceId: null,
    });
    const base = input();
    const selected = {
      ...base,
      envelope: {
        ...base.envelope,
        filters: { record_type: "variant" },
        searchPlan: {
          ...base.envelope.searchPlan,
          filters: { record_type: "variant" },
        },
      },
    };
    const database = new FakeDatabase();
    await expect(
      readModelVariantExactNameTierV1(database.asD1(), "test", selected),
    ).resolves.toMatchObject({ outcome: "page" });
    expect(mocked.readPage).toHaveBeenCalledWith(database.session, {
      publicationId: PUBLICATION,
      query: "Fixture\u0000Model",
      recordType: "variant",
      afterResourceId: null,
      limit: 20,
    });
  });

  it("preserves repeated separators for the pinned exact normalizer", async () => {
    mocked.readPage.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [],
      nextAfterResourceId: null,
    });
    const database = new FakeDatabase();
    await expect(
      readModelVariantExactNameTierV1(
        database.asD1(),
        "test",
        input("Fixture  Model"),
      ),
    ).resolves.toMatchObject({ outcome: "page" });
    expect(mocked.readPage).toHaveBeenCalledWith(database.session, {
      publicationId: PUBLICATION,
      query: "Fixture  Model",
      recordType: null,
      afterResourceId: null,
      limit: 20,
    });
  });

  it("snapshots hostile accessors and array lengths exactly once", async () => {
    mocked.readPage.mockResolvedValue({
      publicationId: PUBLICATION,
      results: [],
      nextAfterResourceId: null,
    });
    const base = input();
    let envelopeReads = 0;
    let lengthReads = 0;
    const sort = new Proxy(["relevance", "stable_id"], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 2 : 999;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const outer = { ...base } as Record<string, unknown>;
    Object.defineProperty(outer, "envelope", {
      enumerable: true,
      get: () => {
        envelopeReads += 1;
        return envelopeReads === 1
          ? { ...base.envelope, sort }
          : { ...base.envelope, extra: true };
      },
    });
    const database = new FakeDatabase();
    await expect(
      readModelVariantExactNameTierV1(database.asD1(), "test", outer),
    ).resolves.toMatchObject({ outcome: "page" });
    expect(envelopeReads).toBe(1);
    expect(lengthReads).toBe(1);
  });

  it("rejects every malformed envelope before opening a bookmark session", async () => {
    const valid = input();
    const candidates = [
      { ...valid, extra: true },
      { ...valid, bookmark: "" },
      { ...valid, bookmark: "first-primary" },
      { ...valid, bookmark: "first-unconstrained" },
      { ...valid, environment: "preview" },
      {
        ...valid,
        envelope: { ...valid.envelope, continuation: { stableId: MODEL } },
      },
      {
        ...valid,
        envelope: { ...valid.envelope, filters: { record_type: "provider" } },
      },
      {
        ...valid,
        envelope: {
          ...valid.envelope,
          searchPlan: { ...valid.envelope.searchPlan, query: " " },
        },
      },
      {
        ...valid,
        envelope: {
          ...valid.envelope,
          searchPlan: { ...valid.envelope.searchPlan, query: "\ud800" },
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
      {
        ...valid,
        envelope: {
          ...valid.envelope,
          searchPlan: {
            ...valid.envelope.searchPlan,
            query: "x".repeat(401),
          },
        },
      },
      { ...valid, visitorPayload: "must not cross" },
    ];

    const database = new FakeDatabase();
    for (const candidate of candidates)
      await expect(
        readModelVariantExactNameTierV1(database.asD1(), "test", candidate),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(database.sessionInputs).toEqual([]);
    expect(mocked.readPage).not.toHaveBeenCalled();
  });

  it("maps only the reader's fixed errors and never echoes its input", async () => {
    const database = new FakeDatabase();
    mocked.readPage.mockRejectedValueOnce(
      new ModelVariantExactNameError("read_failure"),
    );
    await expect(
      readModelVariantExactNameTierV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "read_failure" });

    mocked.readPage.mockRejectedValueOnce(
      new ModelVariantExactNameError("invalid_input"),
    );
    await expect(
      readModelVariantExactNameTierV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    mocked.readPage.mockRejectedValueOnce(new Error("private"));
    await expect(
      readModelVariantExactNameTierV1(database.asD1(), "test", input()),
    ).resolves.toEqual({ outcome: "read_failure" });
  });
});
