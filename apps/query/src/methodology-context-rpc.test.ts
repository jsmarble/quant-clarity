import { describe, expect, it } from "vitest";

import {
  METHODOLOGY_CONTEXT_SELECT_SQL,
  readMethodologyContextV1,
} from "./catalog-query-rpc.js";
import {
  RETAINED_HOT_FROM_INDEX,
  RETAINED_HOT_ROLLBACK_INDEX,
} from "./retained-hot-publication.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const BOOKMARK = "bookmark-methodology-test-only";
const HORIZON_MS = Date.parse("2026-08-03T06:15:00.000Z");

const input = () => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  bookmark: BOOKMARK,
  requiredAvailableUntilMs: HORIZON_MS,
  envelope: {
    version: 1,
    audience: "quantclarity-catalog-query-v1",
    environment: "test",
    operation: { kind: "methodology_detail", version: "1.0.0" },
    publicationId: PUBLICATION,
    filters: {},
    sort: ["version"],
    limit: 25,
    continuation: null,
    searchPlan: null,
  },
});

class FakeDatabase {
  readonly sessionInputs: string[] = [];
  readonly binds: unknown[][] = [];

  constructor(
    private readonly rows: readonly unknown[],
    private readonly success = true,
  ) {}

  asD1(): D1Database {
    return {
      withSession: (bookmark: string) => {
        this.sessionInputs.push(bookmark);
        return {
          getBookmark: () => bookmark,
          prepare: (sql: string) => {
            if (sql !== METHODOLOGY_CONTEXT_SELECT_SQL)
              throw new Error("unexpected query");
            return {
              bind: (...values: unknown[]) => {
                this.binds.push(values);
                return {
                  all: () =>
                    Promise.resolve({
                      success: this.success,
                      results: this.rows.map((value) => structuredClone(value)),
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

describe("methodology context query RPC (FE-051, API-003, PRIV-006)", () => {
  it("returns one bookmark-continuous selected-publication context", async () => {
    const database = new FakeDatabase([
      { publication_id: PUBLICATION, schema_version: "1.13.0" },
    ]);
    await expect(
      readMethodologyContextV1(
        database.asD1(),
        "test",
        "https://api.example.test",
        input(),
      ),
    ).resolves.toEqual({
      outcome: "context",
      publicationId: PUBLICATION,
      publicApiOrigin: "https://api.example.test",
      schemaVersion: "1.13.0",
    });
    expect(database.sessionInputs).toEqual([BOOKMARK]);
    expect(database.binds).toEqual([[PUBLICATION, HORIZON_MS]]);
  });

  it("fails closed for hostile envelopes, rows, origin, and D1 failure", async () => {
    const cases: readonly [unknown, unknown, readonly unknown[], boolean][] = [
      [{ ...input(), unexpected: true }, "https://api.example.test", [], true],
      [input(), "https://request-derived.invalid/path", [], true],
      [input(), "https://api.example.test", [], true],
      [
        input(),
        "https://api.example.test",
        [{ publication_id: PUBLICATION, schema_version: "invalid" }],
        true,
      ],
      [
        input(),
        "https://api.example.test",
        [{ publication_id: PUBLICATION, schema_version: "1.13.0-alpha" }],
        true,
      ],
      [
        input(),
        "https://api.example.test",
        [
          {
            publication_id: PUBLICATION,
            schema_version: `1.2.${"3".repeat(129)}`,
          },
        ],
        true,
      ],
      [
        input(),
        "https://api.example.test",
        [
          { publication_id: PUBLICATION, schema_version: "1.13.0" },
          { publication_id: PUBLICATION, schema_version: "1.13.0" },
        ],
        true,
      ],
    ];
    for (const [rpcInput, origin, rows, success] of cases)
      await expect(
        readMethodologyContextV1(
          new FakeDatabase(rows, success).asD1(),
          "test",
          origin,
          rpcInput,
        ),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    await expect(
      readMethodologyContextV1(
        new FakeDatabase(
          [{ publication_id: PUBLICATION, schema_version: "1.13.0" }],
          false,
        ).asD1(),
        "test",
        "https://api.example.test",
        input(),
      ),
    ).resolves.toEqual({ outcome: "read_failure" });
  });

  it("uses one fixed bounded SELECT-only retained-hot statement", () => {
    expect(METHODOLOGY_CONTEXT_SELECT_SQL.trimStart()).toMatch(/^WITH /u);
    expect(METHODOLOGY_CONTEXT_SELECT_SQL).toContain(
      `INDEXED BY ${RETAINED_HOT_FROM_INDEX}`,
    );
    expect(METHODOLOGY_CONTEXT_SELECT_SQL).toContain(
      `INDEXED BY ${RETAINED_HOT_ROLLBACK_INDEX}`,
    );
    expect(METHODOLOGY_CONTEXT_SELECT_SQL).toContain(
      "JOIN publication_closure_seal AS seal",
    );
    expect(METHODOLOGY_CONTEXT_SELECT_SQL).toMatch(/LIMIT 2\s*$/u);
    expect(METHODOLOGY_CONTEXT_SELECT_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|PRAGMA|ATTACH|DETACH)\b/iu,
    );
  });
});
