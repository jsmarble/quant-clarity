import { beforeAll, describe, expect, it } from "vitest";

import {
  PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
  assertProviderModelIdSearchQueryableArtifactProofV4,
  type ProviderModelIdSearchStorageRowV1,
} from "@quant-clarity/publication-core";

import {
  PROVIDER_MODEL_ID_SEARCH_D1_INSERT_BOUND_PARAMETERS,
  PROVIDER_MODEL_ID_SEARCH_D1_MAX_INSERT_CHUNKS,
  PROVIDER_MODEL_ID_SEARCH_D1_MAX_QUERY_COUNT,
  PROVIDER_MODEL_ID_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT,
  PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS,
  PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_RETAINED_HEAP_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_JSON_BYTES,
  ProviderModelIdSearchStagingError,
  applyProviderModelIdSearchStagingV1,
  planProviderModelIdSearchInsertChunksV1,
  verifyProviderModelIdSearchStorageV4,
} from "./provider-model-id-search-staging.js";
import {
  createProviderModelIdSearchFixture,
  type ProviderModelIdSearchFixture,
} from "../test/provider-model-id-search-fixture.js";

const PUBLICATION_ID = "pub_71111111-1111-4111-8111-111111111111";
let fixture: ProviderModelIdSearchFixture;
let collisionFixture: ProviderModelIdSearchFixture;
let emptyFixture: ProviderModelIdSearchFixture;

beforeAll(async () => {
  fixture = await createProviderModelIdSearchFixture(
    PUBLICATION_ID,
    Date.parse("2026-08-02T00:00:00.000Z"),
  );
  collisionFixture = await createProviderModelIdSearchFixture(
    "pub_72222222-2222-4222-8222-222222222222",
    Date.parse("2026-08-02T00:10:00.000Z"),
    [
      { rawProviderModelId: "Duplicate\u0000ID" },
      { rawProviderModelId: "duplicate\u0000id", status: "inactive" },
      { rawProviderModelId: "Duplicate\u0000ID", stale: true },
    ],
  );
  emptyFixture = await createProviderModelIdSearchFixture(
    "pub_73333333-3333-4333-8333-333333333333",
    Date.parse("2026-08-02T00:20:00.000Z"),
    [],
  );
});

const META = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
} satisfies D1Meta;

const result = (rows: unknown[] = []): D1Result => ({
  success: true,
  meta: META,
  results: rows,
});

type Captured = Readonly<{ sql: string; values: readonly unknown[] }>;
const CAPTURE = Symbol("provider model ID statement");
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

type Handler = (statements: readonly Captured[]) => Promise<D1Result[]>;

const fakeDatabase = (...handlers: Handler[]) => {
  const sessions: string[] = [];
  const batches: Captured[][] = [];
  let handlerIndex = 0;
  const database = {
    withSession(constraint?: D1SessionConstraint) {
      sessions.push(String(constraint));
      return {
        prepare: prepared,
        batch(statements: D1PreparedStatement[]) {
          const captured = statements.map(
            (statement) => (statement as CapturedStatement)[CAPTURE],
          );
          batches.push(captured);
          const handler = handlers[handlerIndex];
          handlerIndex += 1;
          if (handler === undefined) throw new Error("unexpected D1 batch");
          return handler(captured);
        },
        getBookmark: () => null,
      } as D1DatabaseSession;
    },
  } as D1Database;
  return { database, sessions, batches };
};

const snapshot = (
  committed: boolean,
  target = fixture,
  state = "building",
): D1Result[] => [
  result([
    {
      state,
      closure_hash: target.persistence.closureHash,
      staging_revision: target.persistence.stagingRevision,
      sealed: 0,
      eligible_document_count: target.persistence.documentCount,
    },
  ]),
  result(committed ? [...target.persistence.rows] : []),
];

const byteKey = (bytes: readonly number[]): string => JSON.stringify(bytes);

const indexedProbe =
  (
    target = fixture,
  ): ((statements: readonly Captured[]) => Promise<D1Result[]>) =>
  (statements) => {
    const first = target.persistence.rows[0];
    if (first === undefined) {
      expect(statements).toHaveLength(2);
      expect(statements[0]?.sql).toContain("pragma_index_info");
      expect(statements[0]?.sql).toContain(
        "INDEXED BY publication_provider_model_id_raw_exact_idx",
      );
      expect(statements[1]?.sql).toContain(
        "INDEXED BY publication_provider_model_id_normalized_exact_idx",
      );
      for (const statement of statements)
        expect((statement.values[1] as ArrayBuffer).byteLength).toBe(1);
      return Promise.resolve([
        result([{ offering_id: null, indexes_exact: 1 }]),
        result([]),
      ]);
    }
    expect(statements).toHaveLength(4);
    expect(statements[0]?.sql).toContain("pragma_index_info");
    expect(statements[0]?.sql).toContain(
      "INDEXED BY publication_provider_model_id_raw_exact_idx",
    );
    expect(statements[1]?.sql).toContain("raw_provider_model_id_utf8 = ?2");
    expect(statements[2]?.sql).toContain(
      "INDEXED BY publication_provider_model_id_normalized_exact_idx",
    );
    expect(statements[3]?.sql).toContain(
      "normalized_provider_model_id_utf8 = ?2",
    );
    for (const statement of statements)
      expect(statement.values[1]).toBeInstanceOf(ArrayBuffer);
    const rawKey = byteKey(first.raw_provider_model_id_utf8);
    const normalizedKey = byteKey(first.normalized_provider_model_id_utf8);
    const rawIds = target.persistence.rows
      .filter((row) => byteKey(row.raw_provider_model_id_utf8) === rawKey)
      .map((row) => ({ offering_id: row.offering_id }));
    const normalizedIds = target.persistence.rows
      .filter(
        (row) =>
          byteKey(row.normalized_provider_model_id_utf8) === normalizedKey,
      )
      .map((row) => ({ offering_id: row.offering_id }));
    return Promise.resolve([
      result(rawIds.map((row) => ({ ...row, indexes_exact: 1 }))),
      result([{ offering_id: null, indexes_exact: 1 }]),
      result(normalizedIds),
      result([]),
    ]);
  };

describe("provider-model-ID BLOB insert planner", () => {
  it("freezes ADR 0028 ceilings and emits lowercase even hex including empty normalized bytes", () => {
    const emptyNormalized = {
      ...fixture.persistence.rows[0],
      normalized_provider_model_id_utf8: [],
    } as ProviderModelIdSearchStorageRowV1;
    const plan = planProviderModelIdSearchInsertChunksV1([emptyNormalized]);
    expect(PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS).toBe(2_000);
    expect(PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES).toBe(2 * 1_024 * 1_024);
    expect(PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES).toBe(1_500_000);
    expect(PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_JSON_BYTES).toBe(
      8 * 1_024 * 1_024,
    );
    expect(PROVIDER_MODEL_ID_SEARCH_D1_MAX_INSERT_CHUNKS).toBe(34);
    expect(PROVIDER_MODEL_ID_SEARCH_D1_MAX_QUERY_COUNT).toBe(50);
    expect(PROVIDER_MODEL_ID_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT).toBe(16);
    expect(PROVIDER_MODEL_ID_SEARCH_MAX_RETAINED_HEAP_BYTES).toBe(
      64 * 1_024 * 1_024,
    );
    expect(plan.insertBoundParameterCount).toBe(
      PROVIDER_MODEL_ID_SEARCH_D1_INSERT_BOUND_PARAMETERS,
    );
    const parsed = JSON.parse(plan.payloads[0] ?? "") as {
      raw_provider_model_id_utf8_hex: string;
      normalized_provider_model_id_utf8_hex: string;
    }[];
    const first = parsed[0];
    if (first === undefined) throw new Error("planner payload is empty");
    expect(first.raw_provider_model_id_utf8_hex).toMatch(/^[0-9a-f]+$/u);
    expect(first.raw_provider_model_id_utf8_hex.length % 2).toBe(0);
    expect(first.normalized_provider_model_id_utf8_hex).toBe("");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.payloads)).toBe(true);
  });

  it("accepts below/at and rejects above document, value, and combined-byte caps before D1", () => {
    const row = fixture.persistence.rows[0];
    if (row === undefined) throw new Error("fixture lacks a row");
    for (const count of [1_999, 2_000])
      expect(
        planProviderModelIdSearchInsertChunksV1(
          Array.from({ length: count }, () => row),
        ).documentCount,
      ).toBe(count);
    expect(() =>
      planProviderModelIdSearchInsertChunksV1(
        Array.from({ length: 2_001 }, () => row),
      ),
    ).toThrow(ProviderModelIdSearchStagingError);
    for (const normalizedLength of [0, 18_431, 18_432])
      expect(() =>
        planProviderModelIdSearchInsertChunksV1([
          {
            ...row,
            normalized_provider_model_id_utf8: new Array(normalizedLength).fill(
              97,
            ),
          },
        ]),
      ).not.toThrow();
    expect(() =>
      planProviderModelIdSearchInsertChunksV1([
        {
          ...row,
          normalized_provider_model_id_utf8: new Array(
            PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES + 1,
          ).fill(97),
        },
      ]),
    ).toThrow(ProviderModelIdSearchStagingError);
    expect(() =>
      planProviderModelIdSearchInsertChunksV1([
        { ...row, raw_provider_model_id_utf8: [] },
      ]),
    ).toThrow(ProviderModelIdSearchStagingError);
    expect(() =>
      planProviderModelIdSearchInsertChunksV1([
        { ...row, raw_provider_model_id_utf8: [256] },
      ]),
    ).toThrow(ProviderModelIdSearchStagingError);
  });

  it("accepts below/at and rejects above 2MiB while proving secondary caps are dominated", () => {
    const prototype = fixture.persistence.rows[0];
    if (prototype === undefined) throw new Error("fixture lacks a row");
    const atRawBytes = (total: number): ProviderModelIdSearchStorageRowV1[] => {
      const rows: ProviderModelIdSearchStorageRowV1[] = [];
      let remaining = total;
      while (remaining > 0) {
        const normalizedLength = Math.min(
          PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
          remaining - 1,
        );
        const rawLength = Math.min(1_024, remaining - normalizedLength);
        rows.push({
          ...prototype,
          raw_provider_model_id_utf8: new Array(rawLength).fill(65),
          normalized_provider_model_id_utf8: new Array(normalizedLength).fill(
            97,
          ),
        });
        remaining -= rawLength + normalizedLength;
      }
      return rows;
    };
    const below = planProviderModelIdSearchInsertChunksV1(
      atRawBytes(PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES - 1),
    );
    const exact = planProviderModelIdSearchInsertChunksV1(
      atRawBytes(PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES),
    );
    expect(below.rawProviderModelIdByteCount).toBe(
      PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES - 1,
    );
    expect(exact.rawProviderModelIdByteCount).toBe(
      PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES,
    );
    expect(() =>
      planProviderModelIdSearchInsertChunksV1(
        atRawBytes(PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES + 1),
      ),
    ).toThrow(ProviderModelIdSearchStagingError);
    expect(exact.maximumPayloadBytes).toBeLessThanOrEqual(
      PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES,
    );
    expect(exact.totalJsonBytes).toBeLessThan(
      PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_JSON_BYTES,
    );
    expect(exact.payloads).toHaveLength(3);
    expect(exact.queryCount).toBe(19);
    expect(exact.payloads.length).toBeLessThan(
      PROVIDER_MODEL_ID_SEARCH_D1_MAX_INSERT_CHUNKS,
    );
    expect(exact.queryCount).toBeLessThan(
      PROVIDER_MODEL_ID_SEARCH_D1_MAX_QUERY_COUNT,
    );
    expect(exact.retainedHeapEstimateBytes).toBeLessThan(
      PROVIDER_MODEL_ID_SEARCH_MAX_RETAINED_HEAP_BYTES,
    );

    const fixedRowBytes = new TextEncoder().encode(
      JSON.stringify({
        publication_id: prototype.publication_id,
        offering_id: prototype.offering_id,
        provider_id: prototype.provider_id,
        target_resource_type: prototype.target_resource_type,
        target_resource_id: prototype.target_resource_id,
        projection_version: prototype.projection_version,
        raw_provider_model_id_utf8_hex: "",
        normalized_provider_model_id_utf8_hex: "",
        offering_content_hash: prototype.offering_content_hash,
        target_content_hash: prototype.target_content_hash,
      }),
    ).byteLength;
    const totalJsonUpperBound =
      2 +
      PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS * fixedRowBytes +
      (PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS - 1) +
      PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES * 2;
    const maximumRowBytes =
      fixedRowBytes +
      (1_024 + PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES) * 2;
    const minimumNonfinalChunkBytes =
      PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES - maximumRowBytes - 1;
    const derivedChunkUpperBound =
      Math.floor(totalJsonUpperBound / minimumNonfinalChunkBytes) + 1;
    const retainedHeapUpperBound =
      PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES * 8 +
      PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES * 2 * 2 +
      totalJsonUpperBound * 2 +
      PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES +
      PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS * 1_024;
    expect(totalJsonUpperBound).toBeLessThan(
      PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_JSON_BYTES,
    );
    expect(derivedChunkUpperBound).toBeLessThanOrEqual(
      PROVIDER_MODEL_ID_SEARCH_D1_MAX_INSERT_CHUNKS,
    );
    expect(
      PROVIDER_MODEL_ID_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT +
        derivedChunkUpperBound,
    ).toBeLessThanOrEqual(PROVIDER_MODEL_ID_SEARCH_D1_MAX_QUERY_COUNT);
    expect(retainedHeapUpperBound).toBeLessThan(
      PROVIDER_MODEL_ID_SEARCH_MAX_RETAINED_HEAP_BYTES,
    );
  });
});

describe("provider-model-ID BLOB staging writer", () => {
  it("writes one fixed atomic JSON/unhex batch, reconstructs rows, and proves both indexes", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      (statements) => {
        expect(statements).toHaveLength(3);
        expect(statements[0]?.sql).toContain("candidate.state = 'building'");
        expect(statements[1]?.sql).toContain("FROM json_each(?1)");
        expect(statements[1]?.sql).toContain(
          "unhex(json_extract(payload.value, '$.raw_provider_model_id_utf8_hex'))",
        );
        expect(statements[1]?.sql).toContain(
          "length(json_extract(payload.value, '$.normalized_provider_model_id_utf8_hex')) BETWEEN 0 AND 36864",
        );
        expect(statements[1]?.values).toHaveLength(4);
        return Promise.resolve([
          result([{ clean: 1 }]),
          result(),
          result([{ verified: 1 }]),
        ]);
      },
      () => Promise.resolve(snapshot(true)),
      indexedProbe(),
    );
    const applied = await applyProviderModelIdSearchStagingV1(
      fake.database,
      fixture.staging,
    );
    expect(applied).toMatchObject({
      outcome: "applied",
      publicationId: PUBLICATION_ID,
      documentCount: 1,
    });
    expect(() => {
      assertProviderModelIdSearchQueryableArtifactProofV4(
        applied.artifactProof,
      );
    }).not.toThrow();
    expect(fake.sessions).toEqual([
      "first-primary",
      "first-primary",
      "first-primary",
      "first-primary",
    ]);
  });

  it("returns idempotent success only after collision-complete raw and normalized probes", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(true, collisionFixture)),
      indexedProbe(collisionFixture),
    );
    await expect(
      applyProviderModelIdSearchStagingV1(
        fake.database,
        collisionFixture.staging,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("shares a nominal read-only full-row and dual-index verifier with readiness and switch", async () => {
    const proofSource = fakeDatabase(
      () => Promise.resolve(snapshot(true, collisionFixture)),
      indexedProbe(collisionFixture),
    );
    const staged = await applyProviderModelIdSearchStagingV1(
      proofSource.database,
      collisionFixture.staging,
    );
    const verified = fakeDatabase((statements) => {
      expect(statements).toHaveLength(1);
      expect(statements[0]?.sql).toContain("ORDER BY offering_id");
      return Promise.resolve([result([...collisionFixture.persistence.rows])]);
    }, indexedProbe(collisionFixture));
    await expect(
      verifyProviderModelIdSearchStorageV4(
        verified.database,
        staged.artifactProof,
      ),
    ).resolves.toBeUndefined();
    expect(verified.sessions).toEqual(["first-primary", "first-primary"]);

    const wrongBytes = fakeDatabase(() =>
      Promise.resolve([
        result(
          collisionFixture.persistence.rows.map((row, index) =>
            index === 0 ? { ...row, raw_provider_model_id_utf8: [65] } : row,
          ),
        ),
      ]),
    );
    await expect(
      verifyProviderModelIdSearchStorageV4(
        wrongBytes.database,
        staged.artifactProof,
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const untouched = fakeDatabase();
    await expect(
      verifyProviderModelIdSearchStorageV4(untouched.database, {
        ...staged.artifactProof,
      }),
    ).rejects.toMatchObject({ code: "integrity_failure" });
    expect(untouched.sessions).toEqual([]);
  });

  it("proves the empty all-Offering projection through both X'FF' misses", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(false, emptyFixture)),
      indexedProbe(emptyFixture),
    );
    await expect(
      applyProviderModelIdSearchStagingV1(fake.database, emptyFixture.staging),
    ).resolves.toMatchObject({
      outcome: "idempotent_success",
      documentCount: 0,
    });
  });

  it("classifies response loss, confirmed rollback, and uncertain durability without repeating writes", async () => {
    const lost = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      () => Promise.reject(new Error("lost response")),
      () => Promise.resolve(snapshot(true)),
      indexedProbe(),
    );
    await expect(
      applyProviderModelIdSearchStagingV1(lost.database, fixture.staging),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });

    const rolledBack = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      () => Promise.reject(new Error("batch failed")),
      () => Promise.resolve(snapshot(false)),
    );
    await expect(
      applyProviderModelIdSearchStagingV1(rolledBack.database, fixture.staging),
    ).rejects.toMatchObject({ code: "not_applied", retrySameProjection: true });

    const unknown = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      () => Promise.reject(new Error("batch failed")),
      () => Promise.reject(new Error("primary unavailable")),
    );
    await expect(
      applyProviderModelIdSearchStagingV1(unknown.database, fixture.staging),
    ).rejects.toMatchObject({
      code: "outcome_unknown",
      retrySameProjection: false,
    });
  });

  it("fails closed on malformed, conflicting, stale, and non-nominal input without payload echoes", async () => {
    const row = fixture.persistence.rows[0];
    if (row === undefined) throw new Error("fixture lacks a row");
    const malformed = fakeDatabase(() =>
      Promise.resolve([
        snapshot(true)[0]!,
        result([{ ...row, unexpected: "provider-secret-payload" }]),
      ]),
    );
    await expect(
      applyProviderModelIdSearchStagingV1(malformed.database, fixture.staging),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const conflict = fakeDatabase(() =>
      Promise.resolve([
        snapshot(true)[0]!,
        result([{ ...row, target_content_hash: `sha256:${"0".repeat(64)}` }]),
      ]),
    );
    await expect(
      applyProviderModelIdSearchStagingV1(conflict.database, fixture.staging),
    ).rejects.toMatchObject({ code: "conflict" });

    const stale = fakeDatabase(() =>
      Promise.resolve(snapshot(false, fixture, "failed")),
    );
    await expect(
      applyProviderModelIdSearchStagingV1(stale.database, fixture.staging),
    ).rejects.toMatchObject({ code: "stale" });

    const untouched = fakeDatabase();
    const rejection = await applyProviderModelIdSearchStagingV1(
      untouched.database,
      {},
    ).catch((error: unknown) => error);
    expect(rejection).toEqual(
      new ProviderModelIdSearchStagingError("integrity_failure"),
    );
    expect(String(rejection)).not.toContain("provider-secret-payload");
    expect(untouched.sessions).toEqual([]);
  });
});
