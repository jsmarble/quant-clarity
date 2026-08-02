import { describe, expect, it } from "vitest";

import {
  RESOLVE_PUBLICATION_SELECT_SQL,
  readProviderExactNameTierV1,
  resolvePublicationV1,
} from "./catalog-query-rpc.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const CURRENT_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";

const resolveInput = (requestedPublicationId: string | null = null) => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  requestedPublicationId,
});

const envelope = {
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  operation: { kind: "search" },
  publicationId: PUBLICATION,
  filters: { record_type: "provider" },
  sort: ["relevance", "stable_id"],
  limit: 20,
  continuation: null,
  searchPlan: {
    kind: "exact_structured",
    query: "Fixture Provider",
    filters: { record_type: "provider" },
    limit: 20,
    semanticCandidates: 0,
    semanticCalls: 0,
    semanticDegraded: "disabled",
  },
} as const;

class FakeDatabase {
  readonly sessionInputs: string[] = [];
  readonly binds: unknown[][] = [];

  constructor(
    private readonly rows: readonly unknown[],
    private readonly success = true,
    private readonly bookmark: string | null = "bookmark-test-only",
  ) {}

  asD1(): D1Database {
    return {
      withSession: (input: string) => {
        this.sessionInputs.push(input);
        return {
          getBookmark: () => this.bookmark,
          prepare: (sql: string) => {
            if (sql !== RESOLVE_PUBLICATION_SELECT_SQL)
              throw new Error("unexpected query");
            return {
              bind: (...values: unknown[]) => {
                this.binds.push(values);
                return {
                  all: () =>
                    Promise.resolve({
                      success: this.success,
                      results: this.rows.map((row) => structuredClone(row)),
                      meta: {},
                    }),
                } as D1PreparedStatement;
              },
            } as D1PreparedStatement;
          },
        } as D1DatabaseSession;
      },
    } as D1Database;
  }
}

const activeRow = {
  current_publication_id: CURRENT_PUBLICATION,
  current_publication_state: "active",
  rollback_candidate_publication_id: null,
  selected_publication_id: CURRENT_PUBLICATION,
  selected_publication_state: "active",
};

describe("catalog query RPC boundary (API-003, CF-020, PRIV-006)", () => {
  it("selects the active head on first-primary and returns only its bookmark", async () => {
    const database = new FakeDatabase([activeRow]);
    await expect(
      resolvePublicationV1(database.asD1(), "test", resolveInput()),
    ).resolves.toEqual({
      outcome: "selected",
      publicationId: CURRENT_PUBLICATION,
      bookmark: "bookmark-test-only",
    });
    expect(database.sessionInputs).toEqual(["first-primary"]);
    expect(database.binds).toEqual([[null]]);
  });

  it("selects only the current rollback candidate for an explicit pin", async () => {
    const database = new FakeDatabase([
      {
        ...activeRow,
        rollback_candidate_publication_id: PUBLICATION,
        selected_publication_id: PUBLICATION,
        selected_publication_state: "superseded",
      },
    ]);
    await expect(
      resolvePublicationV1(database.asD1(), "test", resolveInput(PUBLICATION)),
    ).resolves.toEqual({
      outcome: "selected",
      publicationId: PUBLICATION,
      bookmark: "bookmark-test-only",
    });
  });

  it("collapses an unavailable pin to expiry with the current public ID", async () => {
    const database = new FakeDatabase([
      {
        ...activeRow,
        selected_publication_id: null,
        selected_publication_state: null,
      },
    ]);
    await expect(
      resolvePublicationV1(database.asD1(), "test", resolveInput(PUBLICATION)),
    ).resolves.toEqual({
      outcome: "publication_expired",
      currentPublicationId: CURRENT_PUBLICATION,
    });
  });

  it("rejects a missing active selection when no pin was requested", async () => {
    const database = new FakeDatabase([
      {
        ...activeRow,
        selected_publication_id: null,
        selected_publication_state: null,
      },
    ]);
    await expect(
      resolvePublicationV1(database.asD1(), "test", resolveInput()),
    ).resolves.toEqual({ outcome: "integrity_failure" });
  });

  it("rejects contradictory null-pin and non-candidate rollback rows", async () => {
    await expect(
      resolvePublicationV1(
        new FakeDatabase([
          {
            ...activeRow,
            selected_publication_id: PUBLICATION,
            selected_publication_state: "superseded",
          },
        ]).asD1(),
        "test",
        resolveInput(),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    await expect(
      resolvePublicationV1(
        new FakeDatabase([
          {
            ...activeRow,
            selected_publication_id: PUBLICATION,
            selected_publication_state: "rolled_back",
          },
        ]).asD1(),
        "test",
        resolveInput(PUBLICATION),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
  });

  it("distinguishes an absent head from malformed or failed D1 results", async () => {
    await expect(
      resolvePublicationV1(new FakeDatabase([]).asD1(), "test", resolveInput()),
    ).resolves.toEqual({ outcome: "publication_not_ready" });
    await expect(
      resolvePublicationV1(
        new FakeDatabase([activeRow, activeRow]).asD1(),
        "test",
        resolveInput(),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    await expect(
      resolvePublicationV1(
        new FakeDatabase([activeRow], false).asD1(),
        "test",
        resolveInput(),
      ),
    ).resolves.toEqual({ outcome: "read_failure" });
    await expect(
      resolvePublicationV1(
        new FakeDatabase([activeRow], true, null).asD1(),
        "test",
        resolveInput(),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
  });

  it("rejects malformed, inherited, extra, or cross-environment resolver input before D1", async () => {
    const database = new FakeDatabase([activeRow]);
    for (const input of [
      { ...resolveInput(), extra: true },
      { ...resolveInput(), environment: "preview" },
      Object.assign(
        Object.create({ rawUrl: "https://visitor.invalid" }),
        resolveInput(),
      ),
      { ...resolveInput(), requestedPublicationId: "pub_invalid" },
    ]) {
      await expect(
        resolvePublicationV1(database.asD1(), "test", input),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }
    expect(database.sessionInputs).toEqual([]);
  });

  it("rejects unsafe read envelopes before opening a bookmark session", async () => {
    const database = new FakeDatabase([]);
    const validInput = {
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      bookmark: "bookmark-test-only",
      envelope,
    };
    for (const input of [
      { ...validInput, rawQuery: "Fixture Provider" },
      { ...validInput, bookmark: "" },
      { ...validInput, bookmark: "first-primary" },
      { ...validInput, bookmark: "first-unconstrained" },
      { ...validInput, environment: "preview" },
      {
        ...validInput,
        envelope: { ...envelope, continuation: { tuple: [] } },
      },
      {
        ...validInput,
        envelope: {
          ...envelope,
          searchPlan: {
            ...envelope.searchPlan,
            query: "Fixture\u0000Provider",
          },
        },
      },
      {
        ...validInput,
        envelope: { ...envelope, headers: { authorization: "secret" } },
      },
    ]) {
      await expect(
        readProviderExactNameTierV1(database.asD1(), "test", input),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }
    expect(database.sessionInputs).toEqual([]);
  });

  it("keeps resolver SQL fixed, bound, SELECT-only, and non-extensible", () => {
    expect(RESOLVE_PUBLICATION_SELECT_SQL).toMatch(/^\s*SELECT\b/u);
    expect(RESOLVE_PUBLICATION_SELECT_SQL).toContain("?1");
    expect(RESOLVE_PUBLICATION_SELECT_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/iu,
    );
  });
});
