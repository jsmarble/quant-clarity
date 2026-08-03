import { describe, expect, it } from "vitest";

import {
  RESOLVE_PUBLICATION_SELECT_SQL,
  RESOLVE_PUBLICATION_V2_SELECT_SQL,
  readProviderExactNameTierV1,
  resolvePublicationV1,
  resolvePublicationV2,
} from "./catalog-query-rpc.js";
import {
  RETAINED_HOT_FROM_INDEX,
  RETAINED_HOT_PUBLICATION_WINDOW_MS,
  RETAINED_HOT_ROLLBACK_INDEX,
} from "./retained-hot-publication.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const CURRENT_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const NOW_MS = 2_000_000_000_000;
const HORIZON_MS = NOW_MS + 10 * 60 * 1000;

const resolveInput = (requestedPublicationId: string | null = null) => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  requestedPublicationId,
});

const resolveV2Input = (requestedPublicationId: string | null = null) => ({
  version: 2,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  requestedPublicationId,
  requiredAvailableUntilMs: HORIZON_MS,
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
    private readonly expectedSql = RESOLVE_PUBLICATION_SELECT_SQL,
  ) {}

  asD1(): D1Database {
    return {
      withSession: (input: string) => {
        this.sessionInputs.push(input);
        return {
          getBookmark: () => this.bookmark,
          prepare: (sql: string) => {
            if (sql !== this.expectedSql) throw new Error("unexpected query");
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

const activeV2Row = {
  ...activeRow,
  database_now_ms: NOW_MS,
  horizon_valid: 1,
  selected_latest_head_reference_ms: null,
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

describe("retained-hot publication resolver v2 (API-003, PRIV-006)", () => {
  const database = (rows: readonly unknown[], success = true) =>
    new FakeDatabase(
      rows,
      success,
      "bookmark-test-only",
      RESOLVE_PUBLICATION_V2_SELECT_SQL,
    );

  it("selects active, rollback, and retained superseded publications", async () => {
    await expect(
      resolvePublicationV2(
        database([activeV2Row]).asD1(),
        "test",
        resolveV2Input(),
      ),
    ).resolves.toEqual({
      outcome: "selected",
      publicationId: CURRENT_PUBLICATION,
      bookmark: "bookmark-test-only",
      requiredAvailableUntilMs: HORIZON_MS,
    });

    await expect(
      resolvePublicationV2(
        database([
          {
            ...activeV2Row,
            rollback_candidate_publication_id: PUBLICATION,
            selected_publication_id: PUBLICATION,
            selected_publication_state: "rolled_back",
          },
        ]).asD1(),
        "test",
        resolveV2Input(PUBLICATION),
      ),
    ).resolves.toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs: HORIZON_MS,
    });

    await expect(
      resolvePublicationV2(
        database([
          {
            ...activeV2Row,
            selected_publication_id: PUBLICATION,
            selected_publication_state: "superseded",
            selected_latest_head_reference_ms: NOW_MS,
          },
        ]).asD1(),
        "test",
        resolveV2Input(PUBLICATION),
      ),
    ).resolves.toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs: HORIZON_MS,
    });
  });

  it("collapses unavailable retained pins to the same generic expiry outcome", async () => {
    await expect(
      resolvePublicationV2(
        database([
          {
            ...activeV2Row,
            selected_publication_id: null,
            selected_publication_state: null,
          },
        ]).asD1(),
        "test",
        resolveV2Input(PUBLICATION),
      ),
    ).resolves.toEqual({
      outcome: "publication_expired",
      currentPublicationId: CURRENT_PUBLICATION,
    });
  });

  it("fails closed for invalid horizons and contradictory retention evidence", async () => {
    await expect(
      resolvePublicationV2(
        database([{ ...activeV2Row, horizon_valid: 0 }]).asD1(),
        "test",
        resolveV2Input(),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    await expect(
      resolvePublicationV2(
        database([
          {
            ...activeV2Row,
            selected_publication_id: PUBLICATION,
            selected_publication_state: "superseded",
            selected_latest_head_reference_ms:
              HORIZON_MS - RETAINED_HOT_PUBLICATION_WINDOW_MS,
          },
        ]).asD1(),
        "test",
        resolveV2Input(PUBLICATION),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    await expect(
      resolvePublicationV2(
        database([
          {
            ...activeV2Row,
            selected_publication_id: PUBLICATION,
            selected_publication_state: "superseded",
            selected_latest_head_reference_ms: Number.MAX_SAFE_INTEGER,
          },
        ]).asD1(),
        "test",
        resolveV2Input(PUBLICATION),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
  });

  it("snapshots exact own data properties and rejects hostile or malformed input before D1", async () => {
    const fake = database([activeV2Row]);
    let reads = 0;
    const hostile = { ...resolveV2Input() } as Record<string, unknown>;
    Object.defineProperty(hostile, "requiredAvailableUntilMs", {
      enumerable: true,
      get: () => {
        reads += 1;
        return HORIZON_MS;
      },
    });
    for (const input of [
      hostile,
      { ...resolveV2Input(), extra: true },
      { ...resolveV2Input(), requiredAvailableUntilMs: Number.MAX_VALUE },
      { ...resolveV2Input(), environment: "preview" },
    ]) {
      await expect(
        resolvePublicationV2(fake.asD1(), "test", input),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }
    expect(reads).toBe(0);
    expect(fake.sessionInputs).toEqual([]);
  });

  it("uses first-primary, one bound statement, and both immutable history indexes", async () => {
    const fake = database([activeV2Row]);
    await resolvePublicationV2(fake.asD1(), "test", resolveV2Input());
    expect(fake.sessionInputs).toEqual(["first-primary"]);
    expect(fake.binds).toEqual([[null, HORIZON_MS]]);
    expect(RESOLVE_PUBLICATION_V2_SELECT_SQL).toContain(
      `INDEXED BY ${RETAINED_HOT_FROM_INDEX}`,
    );
    expect(RESOLVE_PUBLICATION_V2_SELECT_SQL).toContain(
      `INDEXED BY ${RETAINED_HOT_ROLLBACK_INDEX}`,
    );
    expect(RESOLVE_PUBLICATION_V2_SELECT_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/iu,
    );
  });
});
