import { beforeAll, describe, expect, it } from "vitest";

import { readServingReadinessCommitPersistenceV3 } from "@quant-clarity/publication-core";

import {
  ReadinessCommitV3Error,
  applyReadinessCommitV3,
} from "./readiness-commit-v3.js";
import {
  createServingV3Fixture,
  type ServingV3Fixture,
} from "../test/serving-switch-v3-fixture.js";
import {
  createReadyPublicationFixture,
  type ReadyPublicationFixture,
} from "../test/serving-switch-fixture.js";

const PUBLICATION_ID = "pub_44444444-4444-4444-8444-444444444444";
let fixture: ServingV3Fixture;
let oldFixture: ReadyPublicationFixture;

beforeAll(async () => {
  fixture = await createServingV3Fixture(
    PUBLICATION_ID,
    Date.parse("2026-08-02T04:00:00.000Z"),
  );
  oldFixture = await createReadyPublicationFixture(
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

type Captured = Readonly<{ sql: string; values: readonly unknown[] }>;
const CAPTURE = Symbol("readiness v3 statement");
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
  const state = readServingReadinessCommitPersistenceV3(
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
  Array.from({ length: 12 }, (_, index) =>
    index === failedAt
      ? failedResult()
      : result(index === 11 ? [{ verified: 1 }] : []),
  );

describe("schema-1.6 readiness D1 adapter", () => {
  it("binds the complete v3 receipt set and reconciles an exact commit", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      (statements) => {
        expect(statements).toHaveLength(12);
        expect(
          statements.slice(1, 5).every((item) => item.values[2] === "3.0.0"),
        ).toBe(true);
        expect(statements[6]?.values).toHaveLength(32);
        expect(statements[6]?.values.slice(25)).toEqual([
          "model-variant-name@1",
          1,
          fixture.modelProof.model_variant_name_inventory_hash,
          "model-variant-name-utf8-blob@1",
          1,
          1,
          1,
        ]);
        expect(statements[8]?.values[2]).toBe("search-gold@3");
        expect(statements[9]?.values[4]).toBe("3.0.0");
        expect(statements[11]?.values).toHaveLength(14);
        expect(statements[11]?.values[13]).toBe(
          readServingReadinessCommitPersistenceV3(fixture.readinessCommit)
            .receiptRows.vectors[0]?.mutation_id,
        );
        return Promise.resolve(mutation());
      },
      () => Promise.resolve(snapshot(true)),
    );
    await expect(
      applyReadinessCommitV3(fake.database, fixture.readinessCommit),
    ).resolves.toMatchObject({
      outcome: "applied",
      publicationId: PUBLICATION_ID,
    });
    expect(fake.sessions).toEqual([
      "first-primary",
      "first-primary",
      "first-primary",
    ]);
  });

  it("returns idempotent success only for the exact committed snapshot", async () => {
    const fake = fakeDatabase(() => Promise.resolve(snapshot(true)));
    await expect(
      applyReadinessCommitV3(fake.database, fixture.readinessCommit),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("reconciles a lost response to the exact committed state", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      () => Promise.reject(new Error("lost response")),
      () => Promise.resolve(snapshot(true)),
    );
    await expect(
      applyReadinessCommitV3(fake.database, fixture.readinessCommit),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("observes every failed transaction statement as safely retryable", async () => {
    for (let failedAt = 0; failedAt < 12; failedAt += 1) {
      const fake = fakeDatabase(
        () => Promise.resolve(snapshot(false)),
        () => Promise.resolve(mutation(failedAt)),
        () => Promise.resolve(snapshot(false)),
      );
      await expect(
        applyReadinessCommitV3(fake.database, fixture.readinessCommit),
      ).rejects.toEqual(new ReadinessCommitV3Error("not_applied"));
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
    ).model_variant_name_document_count = 2;
    const outOfBounds = structuredClone(exact);
    (outOfBounds[4]?.results[0] as Record<string, unknown>).mutation_id =
      "x".repeat(129);
    for (const [rows, code] of [
      [malformed, "integrity_failure"],
      [partial, "integrity_failure"],
      [conflict, "conflict"],
      [outOfBounds, "integrity_failure"],
    ] as const) {
      const fake = fakeDatabase(() => Promise.resolve(rows));
      await expect(
        applyReadinessCommitV3(fake.database, fixture.readinessCommit),
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
      applyReadinessCommitV3(fake.database, fixture.readinessCommit),
    ).rejects.toEqual(new ReadinessCommitV3Error("not_applied"));
    expect(lengthReads).toBe(1);
  });

  it("rejects old-v2 and copied values before opening D1", async () => {
    for (const value of [oldFixture.readinessCommitV2, {}, null]) {
      const fake = fakeDatabase();
      await expect(
        applyReadinessCommitV3(fake.database, value),
      ).rejects.toMatchObject({ code: "integrity_failure" });
      expect(fake.sessions).toEqual([]);
    }
  });
});
