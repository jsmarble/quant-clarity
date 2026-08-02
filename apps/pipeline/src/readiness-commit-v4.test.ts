import { beforeAll, describe, expect, it } from "vitest";

import {
  readProviderModelIdSearchQueryablePersistenceV4,
  readServingReadinessCommitPersistenceV4,
} from "@quant-clarity/publication-core";

import {
  ReadinessCommitV4Error,
  applyReadinessCommitV4,
} from "./readiness-commit-v4.js";
import {
  createServingV4Fixture,
  type ServingV4Fixture,
} from "../test/serving-switch-v4-fixture.js";
import {
  createServingV3Fixture,
  type ServingV3Fixture,
} from "../test/serving-switch-v3-fixture.js";

const PUBLICATION_ID = "pub_44444444-4444-4444-8444-444444444444";
let fixture: ServingV4Fixture;
let oldFixture: ServingV3Fixture;

beforeAll(async () => {
  fixture = await createServingV4Fixture(
    PUBLICATION_ID,
    Date.parse("2026-08-02T04:00:00.000Z"),
  );
  oldFixture = await createServingV3Fixture(
    "pub_55555555-5555-4555-8555-555555555555",
    Date.parse("2026-08-02T05:00:00.000Z"),
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
type FakeD1Result = Readonly<{
  success: boolean;
  meta: D1Meta;
  results: unknown[];
}>;
const result = (rows: unknown[] = []): FakeD1Result => ({
  success: true,
  meta: META,
  results: rows,
});
const failedResult = (): FakeD1Result => ({
  success: false,
  meta: META,
  results: [],
});

const sameBytes = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const verifierResult = (
  statements: readonly Captured[],
): FakeD1Result[] | null => {
  const nominal = readProviderModelIdSearchQueryablePersistenceV4(
    fixture.providerModelIdProof,
  );
  const rows = nominal.providerModelIdSearch.rows;
  const first = statements[0];
  if (
    statements.length === 1 &&
    first?.sql.includes(
      "FROM publication_provider_model_id_search_document\nWHERE publication_id = ?1\nORDER BY offering_id",
    )
  )
    return [result(rows.map((row) => ({ ...row })))];
  if (
    statements.length === 4 &&
    statements[0]?.sql.includes("pragma_index_info") &&
    statements.every((statement) => statement.sql.includes("INDEXED BY"))
  )
    return statements.map((statement) => {
      const value = statement.values[1];
      if (!(value instanceof ArrayBuffer)) return failedResult();
      const bytes = [...new Uint8Array(value)];
      const field = statement.sql.includes("raw_exact_idx")
        ? "raw_provider_model_id_utf8"
        : "normalized_provider_model_id_utf8";
      const matches = rows
        .filter((row) => sameBytes(row[field], bytes))
        .map((row) => ({ offering_id: row.offering_id }));
      if (!statement.sql.includes("raw_exact_idx")) return result(matches);
      return result(
        matches.length === 0
          ? [{ offering_id: null, indexes_exact: 1 }]
          : matches.map((row) => ({ ...row, indexes_exact: 1 })),
      );
    });
  return null;
};

type Captured = Readonly<{ sql: string; values: readonly unknown[] }>;
const CAPTURE = Symbol("readiness v4 statement");
type CapturedStatement = D1PreparedStatement & { readonly [CAPTURE]: Captured };
const prepared = (
  sql: string,
  values: readonly unknown[] = [],
): D1PreparedStatement =>
  ({
    [CAPTURE]: { sql, values },
    bind: (...next: unknown[]) => prepared(sql, next),
  }) as CapturedStatement;
type Handler = (statements: readonly Captured[]) => Promise<FakeD1Result[]>;

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
          const verification = verifierResult(captured);
          if (verification !== null) return Promise.resolve(verification);
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

const snapshot = (committed: boolean): FakeD1Result[] => {
  const state = readServingReadinessCommitPersistenceV4(
    fixture.readinessCommit,
  );
  return [
    result([
      {
        state: committed ? "ready" : "building",
        ready_at_ms: committed ? state.transition.ready_at_ms : null,
        closure_hash: state.transition.closure_hash,
        seal_closure_hash: state.transition.closure_hash,
        seal_bundle_hash: state.attestation.bundle_hash,
        provider_search_document_count: state.providerSearch.documents.length,
        provider_search_fts_document_count:
          state.providerSearch.documents.length,
        model_variant_name_storage_document_count:
          state.modelVariantNameSearch.documentCount,
        provider_model_id_storage_document_count:
          state.providerModelIdSearch.documentCount,
      },
    ]),
    result(committed ? [...state.receiptRows.bindings] : []),
    result(committed ? [...state.receiptRows.archives] : []),
    result(committed ? [...state.receiptRows.servings] : []),
    result(committed ? [...state.receiptRows.vectors] : []),
    result(committed ? [...state.receiptRows.probes] : []),
    result(committed ? [{ ...state.attestation }] : []),
  ];
};

const mutation = (failedAt?: number): FakeD1Result[] =>
  Array.from({ length: 14 }, (_, index) =>
    index === failedAt
      ? failedResult()
      : result(index === 13 ? [{ verified: 1 }] : []),
  );

describe("schema-1.7 readiness D1 adapter", () => {
  it("uses fixed nonleaking errors", () => {
    const error = new ReadinessCommitV4Error("conflict");
    expect(error.message).toBe(
      "The schema-1.7 readiness commit could not be applied safely.",
    );
    expect(error.message).not.toContain(PUBLICATION_ID);
    expect(error.retrySameProjection).toBe(false);
  });

  it("binds the complete v4 receipt set and reconciles an exact commit", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      (statements) => {
        expect(statements).toHaveLength(14);
        expect(statements[0]?.sql).toContain("WITH\nnominal_payload");
        expect(statements[0]?.values).toHaveLength(36);
        expect(statements[1]?.sql).toContain("pragma_index_info");
        expect(statements[1]?.sql).toContain("X'FF'");
        expect(statements[1]?.values).toHaveLength(5);
        expect(
          statements.slice(3, 7).every((item) => item.values[2] === "4.0.0"),
        ).toBe(true);
        const state = readServingReadinessCommitPersistenceV4(
          fixture.readinessCommit,
        );
        expect(statements[2]?.values).toHaveLength(6);
        expect(statements[2]?.values[5]).toBe(
          state.providerModelIdSearch.documentCount,
        );
        expect(statements[8]?.values).toHaveLength(39);
        expect(statements[8]?.values.slice(32)).toEqual([
          "provider-model-id@1",
          state.providerModelIdSearch.documentCount,
          fixture.providerModelIdProof.provider_model_id_inventory_hash,
          "provider-model-id-utf8-blob@1",
          state.providerModelIdSearch.documentCount,
          1,
          1,
        ]);
        expect(statements[10]?.values[2]).toBe("search-gold@4");
        expect(statements[11]?.values[4]).toBe("4.0.0");
        expect(statements[13]?.values).toHaveLength(18);
        expect(statements[13]?.values[17]).toBe(
          readServingReadinessCommitPersistenceV4(fixture.readinessCommit)
            .receiptRows.vectors[0]?.mutation_id,
        );
        return Promise.resolve(mutation());
      },
      () => Promise.resolve(snapshot(true)),
    );
    await expect(
      applyReadinessCommitV4(fake.database, fixture.readinessCommit),
    ).resolves.toMatchObject({
      outcome: "applied",
      publicationId: PUBLICATION_ID,
    });
    expect(fake.sessions).toEqual([
      "first-primary",
      "first-primary",
      "first-primary",
      "first-primary",
      "first-primary",
      "first-primary",
      "first-primary",
    ]);
  });

  it("returns idempotent success only for the exact committed snapshot", async () => {
    const fake = fakeDatabase(() => Promise.resolve(snapshot(true)));
    await expect(
      applyReadinessCommitV4(fake.database, fixture.readinessCommit),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("reconciles a lost response to the exact committed state", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      () => Promise.reject(new Error("lost response")),
      () => Promise.resolve(snapshot(true)),
    );
    await expect(
      applyReadinessCommitV4(fake.database, fixture.readinessCommit),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("observes every failed transaction statement as safely retryable", async () => {
    for (let failedAt = 0; failedAt < 14; failedAt += 1) {
      const fake = fakeDatabase(
        () => Promise.resolve(snapshot(false)),
        () => Promise.resolve(mutation(failedAt)),
        () => Promise.resolve(snapshot(false)),
      );
      await expect(
        applyReadinessCommitV4(fake.database, fixture.readinessCommit),
      ).rejects.toEqual(new ReadinessCommitV4Error("not_applied"));
    }
  });

  it("fails closed on malformed, partial, and conflicting persisted state", async () => {
    const exact = snapshot(true);
    const malformed = structuredClone(exact);
    (malformed[1]?.results[0] as Record<string, unknown>).extra = true;
    const partial = structuredClone(exact);
    partial[3] = result([]);
    const conflict = structuredClone(exact);
    (
      conflict[3]?.results[0] as Record<string, unknown>
    ).provider_model_id_document_count = 2;
    const tableCountMismatch = structuredClone(exact);
    (
      tableCountMismatch[0]?.results[0] as Record<string, unknown>
    ).provider_model_id_storage_document_count = 1;
    const outOfBounds = structuredClone(exact);
    (outOfBounds[4]?.results[0] as Record<string, unknown>).mutation_id =
      "x".repeat(129);
    for (const [rows, code] of [
      [malformed, "integrity_failure"],
      [partial, "integrity_failure"],
      [conflict, "conflict"],
      [tableCountMismatch, "integrity_failure"],
      [outOfBounds, "integrity_failure"],
    ] as const) {
      const fake = fakeDatabase(() => Promise.resolve(rows));
      await expect(
        applyReadinessCommitV4(fake.database, fixture.readinessCommit),
      ).rejects.toMatchObject({ code });
    }
  });

  it("snapshots hostile result-array lengths once before bounded allocation", async () => {
    let lengthReads = 0;
    const rotatingRows = new Proxy([] as unknown[], {
      get(target, property, receiver): unknown {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 0 : Number.MAX_SAFE_INTEGER;
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      },
    });
    const hostile = snapshot(false);
    hostile[1] = result(rotatingRows);
    const fake = fakeDatabase(
      () => Promise.resolve(hostile),
      () => Promise.resolve(mutation(0)),
      () => Promise.resolve(snapshot(false)),
    );

    await expect(
      applyReadinessCommitV4(fake.database, fixture.readinessCommit),
    ).rejects.toEqual(new ReadinessCommitV4Error("not_applied"));
    expect(lengthReads).toBe(1);
  });

  it("rejects old-v3 and copied values before opening D1", async () => {
    for (const value of [oldFixture.readinessCommit, {}, null]) {
      const fake = fakeDatabase();
      await expect(
        applyReadinessCommitV4(fake.database, value),
      ).rejects.toMatchObject({ code: "integrity_failure" });
      expect(fake.sessions).toEqual([]);
    }
  });
});
