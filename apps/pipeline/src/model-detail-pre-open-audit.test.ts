import { beforeAll, describe, expect, it } from "vitest";

import {
  MODEL_DETAIL_ADMISSION_METADATA_SQL,
  MODEL_DETAIL_ADMISSION_PAGE_SQL,
} from "./model-detail-admission.js";
import {
  MODEL_DETAIL_PRE_OPEN_HEAD_SQL,
  MODEL_DETAIL_PRE_OPEN_HISTORY_SQL,
  MODEL_DETAIL_PRE_OPEN_MAX_D1_STATEMENTS,
  MODEL_DETAIL_PRE_OPEN_MAX_MODELS,
  MODEL_DETAIL_PRE_OPEN_MAX_PUBLICATIONS,
  MODEL_DETAIL_PRE_OPEN_MAX_RECENT_SWITCHES,
  MODEL_DETAIL_PRE_OPEN_MAX_RESOURCE_BYTES,
  MODEL_DETAIL_PRE_OPEN_METADATA_SQL,
  auditServeableModelDetailPublications,
} from "./model-detail-pre-open-audit.js";
import { createProviderModelIdSearchFixture } from "../test/provider-model-id-search-fixture.js";

const NOW = Date.parse("2026-08-03T12:00:00.000Z");
const RETAINED_THRESHOLD = NOW - 7 * 24 * 60 * 60_000;
const SCHEMA_VERSION = "1.13.0";
const CLOSURE_HASH = `sha256:${"a".repeat(64)}`;
const UTF8 = new TextEncoder();

const publicationId = (sequence: number): `pub_${string}` =>
  `pub_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;

const ACTIVE = publicationId(1);
const ROLLBACK = publicationId(2);
const RETAINED = publicationId(3);
const EXCLUDED = publicationId(4);

const META = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
} satisfies D1Meta;

const result = (rows: readonly unknown[]): D1Result => ({
  success: true,
  meta: META,
  results: [...rows],
});

type Captured = Readonly<{ sql: string; values: readonly unknown[] }>;
const CAPTURE = Symbol("pre-open audit statement");
type CapturedStatement = D1PreparedStatement & {
  readonly [CAPTURE]: Captured;
};

const prepared = (
  sql: string,
  values: readonly unknown[] = [],
): D1PreparedStatement =>
  ({
    [CAPTURE]: { sql, values },
    bind: (...next: unknown[]) => prepared(sql, next),
  }) as CapturedStatement;

const fakeDatabase = (...responses: readonly (readonly unknown[])[]) => {
  const statements: Captured[] = [];
  const sessionConstraints: string[] = [];
  let responseIndex = 0;
  const database = {
    withSession(constraint?: D1SessionConstraint) {
      sessionConstraints.push(String(constraint));
      return {
        prepare: prepared,
        batch(input: D1PreparedStatement[]) {
          expect(input).toHaveLength(1);
          const captured = (input[0] as CapturedStatement)[CAPTURE];
          statements.push(captured);
          const rows = responses[responseIndex];
          responseIndex += 1;
          if (rows === undefined) throw new Error("unexpected D1 batch");
          return Promise.resolve([result(rows)]);
        },
        getBookmark: () => null,
      } as D1DatabaseSession;
    },
  } as D1Database;
  return { database, sessionConstraints, statements };
};

const head = (
  generation: number,
  activePublicationId = ACTIVE,
  rollbackPublicationId: string | null = ROLLBACK,
) => ({
  active_publication_id: activePublicationId,
  rollback_candidate_publication_id: rollbackPublicationId,
  generation,
  active_state: "active",
  rollback_state: rollbackPublicationId === null ? null : "superseded",
  database_now_ms: NOW,
});

const history = (
  generation: number,
  switchedAtMs: number,
  fromPublicationId: string | null = null,
  priorRollbackPublicationId: string | null = null,
) => ({
  new_generation: generation,
  switched_at_ms: switchedAtMs,
  from_publication_id: fromPublicationId,
  expected_prior_rollback_candidate_publication_id: priorRollbackPublicationId,
});

const metadata = (
  id: string,
  state: "active" | "rolled_back" | "superseded",
  modelCount: number,
) => ({
  publication_id: id,
  state,
  schema_version: SCHEMA_VERSION,
  closure_hash: CLOSURE_HASH,
  seal_closure_hash: CLOSURE_HASH,
  proof_closure_hash: CLOSURE_HASH,
  model_count: modelCount,
});

type ModelResourceRow = Readonly<{
  resource_id: string;
  content_hash: string;
  resource_json: string;
}>;

let modelResource: ModelResourceRow;
let modelResourceBytes: number;

beforeAll(async () => {
  const fixture = await createProviderModelIdSearchFixture(
    ACTIVE,
    NOW - 60_000,
    [],
  );
  const row = fixture.closureRows.resources.find(
    (candidate) => candidate.resource_type === "model",
  );
  if (row === undefined) throw new Error("missing Model fixture");
  modelResource = {
    resource_id: row.resource_id,
    content_hash: row.content_hash,
    resource_json: row.resource_json,
  };
  modelResourceBytes = UTF8.encode(row.resource_json).byteLength;
});

const modelRow = () => ({
  resource_id: modelResource.resource_id,
  content_hash: modelResource.content_hash,
  resource_json_bytes: modelResourceBytes,
  resource_json: modelResource.resource_json,
});

const admissionResponses = (publicationIds: readonly string[]): unknown[][] =>
  publicationIds.flatMap(() => [
    [{ schema_version: SCHEMA_VERSION }],
    [modelRow()],
  ]);

const expectIntegrityFailure = async (operation: Promise<unknown>) => {
  await expect(operation).rejects.toMatchObject({
    name: "ServingSwitchError",
    code: "integrity_failure",
  });
};

const databaseWithRawBatch = (batch: () => Promise<unknown>): D1Database =>
  ({
    withSession: () =>
      ({
        prepare: prepared,
        batch,
        getBookmark: () => null,
      }) as unknown as D1DatabaseSession,
  }) as D1Database;

describe("Model detail pre-open audit", () => {
  it("audits active, rollback, and retained publications in stable order on one first-primary session", async () => {
    const ids = [ACTIVE, ROLLBACK, RETAINED].sort();
    const historyRows = [
      history(4, NOW - 1_000, ROLLBACK, RETAINED),
      history(3, NOW - 2_000, RETAINED, ROLLBACK),
      history(2, NOW - 3_000, ROLLBACK),
      history(1, NOW - 4_000),
    ];
    const metadataRows = ids.map((id) =>
      metadata(id, id === ACTIVE ? "active" : "superseded", 1),
    );
    const fake = fakeDatabase(
      [head(4)],
      historyRows,
      metadataRows,
      ...admissionResponses(ids),
      [head(4)],
    );

    await expect(
      auditServeableModelDetailPublications(fake.database),
    ).resolves.toEqual({
      modelCount: 3,
      outcome: "passed",
      publicationCount: 3,
      resourceBytes: modelResourceBytes * 3,
    });

    expect(fake.sessionConstraints).toEqual(["first-primary"]);
    expect(fake.statements[0]).toEqual({
      sql: MODEL_DETAIL_PRE_OPEN_HEAD_SQL,
      values: [],
    });
    expect(fake.statements[1]).toEqual({
      sql: MODEL_DETAIL_PRE_OPEN_HISTORY_SQL,
      values: [4],
    });
    expect(fake.statements[2]).toEqual({
      sql: MODEL_DETAIL_PRE_OPEN_METADATA_SQL,
      values: [JSON.stringify(ids)],
    });
    expect(
      fake.statements
        .filter(({ sql }) => sql === MODEL_DETAIL_ADMISSION_METADATA_SQL)
        .map(({ values }) => values[0]),
    ).toEqual(ids);
    expect(fake.statements.at(-1)).toEqual({
      sql: MODEL_DETAIL_PRE_OPEN_HEAD_SQL,
      values: [],
    });
    expect(
      fake.statements.every(({ sql }) => /^\s*(?:SELECT|WITH)\b/u.test(sql)),
    ).toBe(true);
  });

  it("includes cutoff plus one millisecond and excludes cutoff equality", async () => {
    const ids = [ACTIVE, ROLLBACK, RETAINED].sort();
    const historyRows = [
      history(3, RETAINED_THRESHOLD + 1, ROLLBACK, RETAINED),
      history(2, RETAINED_THRESHOLD, ROLLBACK, EXCLUDED),
      history(1, RETAINED_THRESHOLD - 1),
    ];
    const fake = fakeDatabase(
      [head(3)],
      historyRows,
      ids.map((id) =>
        metadata(id, id === ACTIVE ? "active" : "rolled_back", 1),
      ),
      ...admissionResponses(ids),
      [head(3)],
    );

    await expect(
      auditServeableModelDetailPublications(fake.database),
    ).resolves.toMatchObject({ publicationCount: 3 });
    expect(fake.statements[2]?.values).toEqual([JSON.stringify(ids)]);
    expect(fake.statements[2]?.values[0]).not.toContain(EXCLUDED);
  });

  it("fails closed when the head changes before the audit completes", async () => {
    const ids = [ACTIVE, ROLLBACK].sort();
    const fake = fakeDatabase(
      [head(2)],
      [history(2, NOW - 1_000, ROLLBACK), history(1, NOW - 2_000)],
      ids.map((id) => metadata(id, id === ACTIVE ? "active" : "superseded", 1)),
      ...admissionResponses(ids),
      [head(3, publicationId(9), ACTIVE)],
    );

    await expectIntegrityFailure(
      auditServeableModelDetailPublications(fake.database),
    );
    expect(fake.sessionConstraints).toEqual(["first-primary"]);
    expect(fake.statements.at(-1)?.sql).toBe(MODEL_DETAIL_PRE_OPEN_HEAD_SQL);
  });

  it("rejects missing, malformed, and out-of-order publication metadata before Model scans", async () => {
    const baseResponses = [
      [head(1, ACTIVE, null)],
      [history(1, NOW - 1_000)],
    ] as const;
    const valid = metadata(ACTIVE, "active", 1);
    for (const rows of [
      [],
      [{ ...valid, seal_closure_hash: `sha256:${"b".repeat(64)}` }],
      [metadata(ROLLBACK, "superseded", 1)],
      [{ ...valid, schema_version: null }],
    ]) {
      const fake = fakeDatabase(...baseResponses, rows);
      await expectIntegrityFailure(
        auditServeableModelDetailPublications(fake.database),
      );
      expect(fake.statements).toHaveLength(3);
    }
  });

  it("rejects missing history, a generation gap, and recent-history overflow", async () => {
    await expectIntegrityFailure(
      auditServeableModelDetailPublications(
        fakeDatabase([head(1, ACTIVE, null)], []).database,
      ),
    );
    await expectIntegrityFailure(
      auditServeableModelDetailPublications(
        fakeDatabase(
          [head(3, ACTIVE, null)],
          [history(3, NOW - 1_000), history(1, NOW - 2_000)],
        ).database,
      ),
    );

    const overflowingHistory = Array.from(
      { length: MODEL_DETAIL_PRE_OPEN_MAX_RECENT_SWITCHES + 1 },
      (_, index) =>
        history(
          MODEL_DETAIL_PRE_OPEN_MAX_RECENT_SWITCHES + 1 - index,
          NOW - index,
        ),
    );
    await expectIntegrityFailure(
      auditServeableModelDetailPublications(
        fakeDatabase(
          [head(MODEL_DETAIL_PRE_OPEN_MAX_RECENT_SWITCHES + 1, ACTIVE, null)],
          overflowingHistory,
        ).database,
      ),
    );
  });

  it("rejects unsafe D1 clock arithmetic before inventory", async () => {
    const fake = fakeDatabase([
      { ...head(1, ACTIVE, null), database_now_ms: Number.MAX_SAFE_INTEGER },
    ]);
    await expectIntegrityFailure(
      auditServeableModelDetailPublications(fake.database),
    );
    expect(fake.statements).toHaveLength(1);
  });

  it("normalizes hostile D1 shapes without invoking accessors", async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const sparse: unknown[] = [];
    sparse.length = 1;
    let getterCalls = 0;
    const accessorEnvelope = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorEnvelope, "success", {
      enumerable: true,
      value: true,
    });
    Object.defineProperty(accessorEnvelope, "results", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return [];
      },
    });

    for (const batchValue of [
      [revoked.proxy],
      [{ success: true, results: sparse }],
      [result([]), result([])],
      [accessorEnvelope],
    ])
      await expectIntegrityFailure(
        auditServeableModelDetailPublications(
          databaseWithRawBatch(() => Promise.resolve(batchValue)),
        ),
      );
    expect(getterCalls).toBe(0);

    await expect(
      auditServeableModelDetailPublications(
        databaseWithRawBatch(() => Promise.reject(new Error("D1 unavailable"))),
      ),
    ).rejects.toMatchObject({
      name: "ServingSwitchError",
      code: "outcome_unknown",
    });
  });

  it("enforces aggregate Model and D1-statement plans before Model scans", async () => {
    expect(MODEL_DETAIL_PRE_OPEN_MAX_PUBLICATIONS).toBe(64);
    expect(MODEL_DETAIL_PRE_OPEN_MAX_MODELS).toBe(50_000);
    expect(MODEL_DETAIL_PRE_OPEN_MAX_RESOURCE_BYTES).toBe(64 * 1_024 * 1_024);
    expect(MODEL_DETAIL_PRE_OPEN_MAX_D1_STATEMENTS).toBe(900);

    const threeIds = [ACTIVE, ROLLBACK, RETAINED].sort();
    const modelCap = fakeDatabase(
      [head(2)],
      [history(2, NOW - 1_000, ROLLBACK, RETAINED), history(1, NOW - 2_000)],
      threeIds.map((id, index) =>
        metadata(
          id,
          id === ACTIVE ? "active" : "superseded",
          index < 2 ? 25_000 : 1,
        ),
      ),
    );
    await expectIntegrityFailure(
      auditServeableModelDetailPublications(modelCap.database),
    );
    expect(modelCap.statements).toHaveLength(3);

    const statementIds = Array.from(
      { length: MODEL_DETAIL_PRE_OPEN_MAX_PUBLICATIONS },
      (_, index) => publicationId(index + 1),
    );
    const statementHistory = Array.from(
      { length: statementIds.length - 1 },
      (_, index) =>
        history(
          statementIds.length - 1 - index,
          NOW - index,
          statementIds[index + 1] ?? null,
        ),
    );
    const statementCap = fakeDatabase(
      [head(statementIds.length - 1, statementIds[0], null)],
      statementHistory,
      statementIds.map((id, index) =>
        metadata(
          id,
          index === 0 ? "active" : "superseded",
          index < 2 ? 25_000 : 0,
        ),
      ),
    );
    await expectIntegrityFailure(
      auditServeableModelDetailPublications(statementCap.database),
    );
    expect(statementCap.statements).toHaveLength(3);
  });

  it("freezes bounded fixed SQL and page arithmetic", () => {
    expect(MODEL_DETAIL_PRE_OPEN_HISTORY_SQL).toContain(
      `LIMIT ${String(MODEL_DETAIL_PRE_OPEN_MAX_RECENT_SWITCHES + 1)}`,
    );
    expect(MODEL_DETAIL_PRE_OPEN_METADATA_SQL).toContain(
      `LIMIT ${String(MODEL_DETAIL_PRE_OPEN_MAX_PUBLICATIONS + 1)}`,
    );
    expect(MODEL_DETAIL_PRE_OPEN_METADATA_SQL).not.toContain(
      "publication_resource",
    );
    expect(MODEL_DETAIL_ADMISSION_PAGE_SQL).toContain("LIMIT 65");
    for (const sql of [
      MODEL_DETAIL_PRE_OPEN_HEAD_SQL,
      MODEL_DETAIL_PRE_OPEN_HISTORY_SQL,
      MODEL_DETAIL_PRE_OPEN_METADATA_SQL,
    ])
      expect(sql).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/iu,
      );
  });
});
