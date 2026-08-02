import { beforeAll, describe, expect, it } from "vitest";

import type { ServingReadinessCommitProjection } from "@quant-clarity/publication-core";

import {
  applyReadinessCommit,
  ReadinessCommitError,
} from "./readiness-commit.js";
import { createReadyPublicationFixture } from "../test/serving-switch-fixture.js";

const PUBLICATION_ID = "pub_11111111-1111-4111-8111-111111111111" as const;
const NOW = Date.parse("2026-08-02T10:00:00.000Z");
let projection: ServingReadinessCommitProjection;

beforeAll(async () => {
  projection = (
    await createReadyPublicationFixture(PUBLICATION_ID, NOW - 10 * 60_000)
  ).readinessCommit;
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

const preCommitSnapshot = (): D1Result[] => [
  result([
    {
      state: "building",
      ready_at_ms: null,
      closure_hash: projection.transition.closure_hash,
      seal_closure_hash: projection.transition.closure_hash,
      seal_bundle_hash: projection.attestation.bundle_hash,
    },
  ]),
  result(),
  result(),
  result(),
  result(),
  result(),
  result(),
];

const committedSnapshot = (): D1Result[] => [
  result([
    {
      state: "ready",
      ready_at_ms: projection.transition.ready_at_ms,
      closure_hash: projection.transition.closure_hash,
      seal_closure_hash: projection.transition.closure_hash,
      seal_bundle_hash: projection.attestation.bundle_hash,
    },
  ]),
  result([...projection.receiptRows.bindings]),
  result([...projection.receiptRows.archives]),
  result([...projection.receiptRows.servings]),
  result([...projection.receiptRows.vectors]),
  result([...projection.receiptRows.probes]),
  result([{ ...projection.attestation }]),
];

const successfulMutation = (transitioned = 1): D1Result[] =>
  Array.from({ length: 14 }, (_, index) =>
    index === 0
      ? result([{ clean: 1 }])
      : index === 9 || index === 11
        ? result([{ verified: 1 }])
        : index === 13
          ? result([{ verified: 1, transitioned }])
          : result(),
  );

type CapturedStatement = Readonly<{
  sql: string;
  values: readonly unknown[];
}>;
const CAPTURE = Symbol("captured readiness statement");
type CapturedPreparedStatement = D1PreparedStatement & {
  readonly [CAPTURE]: CapturedStatement;
};

const prepared = (
  sql: string,
  values: readonly unknown[] = [],
): D1PreparedStatement => {
  const statement = {
    [CAPTURE]: { sql, values },
    bind: (...next: unknown[]) => prepared(sql, next),
  };
  return statement as CapturedPreparedStatement;
};

type BatchHandler = (
  statements: readonly CapturedStatement[],
) => Promise<D1Result[]>;

const fakeDatabase = (...handlers: BatchHandler[]) => {
  const sessions: string[] = [];
  const batches: CapturedStatement[][] = [];
  let batchIndex = 0;
  const database = {
    withSession(constraint?: D1SessionConstraint) {
      sessions.push(String(constraint));
      return {
        prepare: prepared,
        batch(statements: D1PreparedStatement[]) {
          const captured = statements.map(
            (statement) => (statement as CapturedPreparedStatement)[CAPTURE],
          );
          batches.push(captured);
          const handler = handlers[batchIndex];
          batchIndex += 1;
          if (handler === undefined) throw new Error("unexpected D1 batch");
          return handler(captured);
        },
        getBookmark: () => null,
      } as D1DatabaseSession;
    },
  } as D1Database;
  return { database, sessions, batches };
};

const resolves =
  (rows: D1Result[]): BatchHandler =>
  () =>
    Promise.resolve(rows);
const rejects: BatchHandler = () =>
  Promise.reject(new Error("raw D1 SQL and private receipt proof"));

const expectCode = async (
  promise: Promise<unknown>,
  code: ReadinessCommitError["code"],
  retrySameProjection = false,
): Promise<void> => {
  try {
    await promise;
    throw new Error("expected readiness commit failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ReadinessCommitError);
    if (error instanceof ReadinessCommitError) {
      expect(error.code).toBe(code);
      expect(error.retrySameProjection).toBe(retrySameProjection);
      expect(error.message).not.toMatch(/SELECT|INSERT|private receipt/u);
      expect("cause" in error).toBe(false);
    }
  }
};

describe("fixed atomic D1 readiness adapter (SRCH-007, PIPE-044, PIPE-050–PIPE-053, QA-006)", () => {
  it("rejects an untrusted projection before opening D1", async () => {
    const harness = fakeDatabase();
    await expectCode(
      applyReadinessCommit(
        harness.database,
        JSON.parse(JSON.stringify(projection)),
      ),
      "integrity_failure",
    );
    expect(harness.sessions).toEqual([]);
  });

  it("executes the fixed fourteen-statement transaction within D1's parameter ceiling", async () => {
    const harness = fakeDatabase(
      resolves(preCommitSnapshot()),
      resolves(successfulMutation()),
    );
    await expect(
      applyReadinessCommit(harness.database, projection),
    ).resolves.toMatchObject({
      outcome: "applied",
      publicationId: PUBLICATION_ID,
    });
    expect(harness.sessions).toEqual(["first-primary", "first-primary"]);
    expect(harness.batches.map((batch) => batch.length)).toEqual([7, 14]);
    const mutation = harness.batches[1]!;
    expect(mutation[0]!.sql).toContain("THEN 1 ELSE json('') END AS clean");
    expect(mutation[9]!.sql).toContain("expected_bindings");
    expect(mutation[11]!.sql).toContain("expected_attestation");
    expect(mutation[13]!.sql).toContain("changes() AS transitioned");
    const numberedParameters = mutation.flatMap((statement) =>
      [...statement.sql.matchAll(/\?(\d+)/gu)].map((match) => Number(match[1])),
    );
    expect(Math.max(...numberedParameters)).toBeLessThanOrEqual(100);
    expect(mutation[13]!.values).toHaveLength(100);
    expect(
      mutation.every((statement) => !statement.sql.includes(PUBLICATION_ID)),
    ).toBe(true);
  });

  it("returns exact idempotent success without a mutation batch", async () => {
    const harness = fakeDatabase(resolves(committedSnapshot()));
    await expect(
      applyReadinessCommit(harness.database, projection),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    expect(harness.batches).toHaveLength(1);
  });

  it("accepts a defensive transitioned-zero verified result", async () => {
    const harness = fakeDatabase(
      resolves(preCommitSnapshot()),
      resolves(successfulMutation(0)),
    );
    await expect(
      applyReadinessCommit(harness.database, projection),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("reconciles response loss after commit", async () => {
    const harness = fakeDatabase(
      resolves(preCommitSnapshot()),
      rejects,
      resolves(committedSnapshot()),
    );
    await expect(
      applyReadinessCommit(harness.database, projection),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    expect(harness.sessions).toEqual([
      "first-primary",
      "first-primary",
      "first-primary",
    ]);
  });

  it("marks a rolled-back attempt retryable only after exact reconciliation", async () => {
    const harness = fakeDatabase(
      resolves(preCommitSnapshot()),
      rejects,
      resolves(preCommitSnapshot()),
    );
    await expectCode(
      applyReadinessCommit(harness.database, projection),
      "not_applied",
      true,
    );
  });
});
