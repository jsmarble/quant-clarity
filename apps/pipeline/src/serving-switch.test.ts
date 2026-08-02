import { beforeAll, describe, expect, it } from "vitest";

import {
  type ServingSwitchHistoryRow,
  type ServingSwitchPreflightRow,
  type ServingSwitchProjection,
} from "@quant-clarity/publication-core";

import { applyServingSwitch, ServingSwitchError } from "./serving-switch.js";
import {
  createActivationProjection,
  createReadyPublicationFixture,
} from "../test/serving-switch-fixture.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const PUBLICATION_A = `pub_${UUID_A}` as const;
const PUBLICATION_B = `pub_${UUID_B}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const SWITCHED_AT_MS = Date.parse("2026-08-02T10:00:00.000Z");

let projection: ServingSwitchProjection;
let preflight: ServingSwitchPreflightRow;
let history: ServingSwitchHistoryRow;

beforeAll(async () => {
  const fixture = await createReadyPublicationFixture(
    PUBLICATION_A,
    SWITCHED_AT_MS - 10 * 60_000,
  );
  projection = await createActivationProjection(fixture, SWITCHED_AT_MS);
  preflight = projection.preflight;
  history = projection.history;
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

const preSwitchSnapshot = (): D1Result[] => [
  result(),
  result(),
  result(),
  result([{ target_state: "ready", former_state: null }]),
];

const committedSnapshot = (): D1Result[] => [
  result([
    {
      active_publication_id: PUBLICATION_A,
      rollback_candidate_publication_id: null,
      switched_at_ms: SWITCHED_AT_MS,
      generation: 1,
    },
  ]),
  result([{ ...preflight }]),
  result([{ ...history }]),
  result([{ target_state: "active", former_state: null }]),
];

type CapturedStatement = Readonly<{
  sql: string;
  values: readonly unknown[];
}>;

const CAPTURE = Symbol("captured D1 statement");
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
    prepare() {
      throw new Error("adapter must prepare through a first-primary session");
    },
    batch() {
      throw new Error("adapter must batch through a first-primary session");
    },
    exec() {
      throw new Error("adapter must never use exec");
    },
    dump() {
      throw new Error("adapter must never use dump");
    },
  } as D1Database;
  return { database, sessions, batches };
};

const resolves =
  (rows: D1Result[]): BatchHandler =>
  () =>
    Promise.resolve(rows);
const rejects: BatchHandler = () =>
  Promise.reject(
    new Error("raw D1 error containing SQL and private proof values"),
  );

const expectCode = async (
  promise: Promise<unknown>,
  code: ServingSwitchError["code"],
  retrySameProjection = false,
): Promise<void> => {
  try {
    await promise;
    throw new Error("expected serving switch failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ServingSwitchError);
    if (error instanceof ServingSwitchError) {
      expect(error.code).toBe(code);
      expect(error.retrySameProjection).toBe(retrySameProjection);
      expect(error.message).not.toMatch(/SELECT|INSERT|private proof/u);
      expect("cause" in error).toBe(false);
    }
  }
};

describe("fixed prepared D1 serving switch adapter (PIPE-044, PIPE-050–PIPE-056, QA-006)", () => {
  it("rejects an untrusted projection before opening a D1 session", async () => {
    const harness = fakeDatabase();
    const serialized: unknown = JSON.parse(JSON.stringify(projection));
    await expectCode(
      applyServingSwitch(harness.database, serialized),
      "integrity_failure",
    );
    expect(harness.sessions).toEqual([]);
  });

  it("executes one exact three-statement mutation batch through first-primary sessions", async () => {
    const harness = fakeDatabase(
      resolves(preSwitchSnapshot()),
      resolves([result(), result(), result([{ verified: 1 }])]),
    );

    await expect(
      applyServingSwitch(harness.database, projection),
    ).resolves.toEqual({
      outcome: "applied",
      switchId: history.switch_id,
      generation: 1,
    });
    expect(harness.sessions).toEqual(["first-primary", "first-primary"]);
    expect(harness.batches).toHaveLength(2);
    expect(harness.batches[0]).toHaveLength(4);
    expect(harness.batches[1]).toHaveLength(3);
    const mutation = harness.batches[1]!;
    expect(mutation[0]!.sql).toMatch(
      /^INSERT INTO publication_switch_preflight/u,
    );
    expect(mutation[1]!.sql).toMatch(
      /^INSERT INTO publication_switch_history/u,
    );
    expect(mutation[2]!.sql).toMatch(/^SELECT CASE WHEN/u);
    expect(mutation[2]!.sql).toContain("THEN json('') ELSE 1 END AS verified");
    expect(mutation.every((statement) => statement.sql.includes("?1"))).toBe(
      true,
    );
    expect(mutation.every((statement) => !statement.sql.includes(UUID_A))).toBe(
      true,
    );
    expect(mutation[0]!.values).toHaveLength(41);
    expect(mutation[1]!.values).toHaveLength(18);
    expect(mutation[2]!.values).toEqual([
      history.switch_id,
      preflight.preflight_hash,
      history.event_hash,
      history.new_generation,
      history.to_publication_id,
    ]);
  });

  it("returns exact idempotent success without issuing a mutation batch", async () => {
    const harness = fakeDatabase(resolves(committedSnapshot()));
    await expect(
      applyServingSwitch(harness.database, projection),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    expect(harness.batches).toHaveLength(1);
  });

  it("reconciles response loss after commit through a fresh primary session", async () => {
    const harness = fakeDatabase(
      resolves(preSwitchSnapshot()),
      rejects,
      resolves(committedSnapshot()),
    );
    await expect(
      applyServingSwitch(harness.database, projection),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    expect(harness.sessions).toEqual([
      "first-primary",
      "first-primary",
      "first-primary",
    ]);
  });

  it("reconciles a malformed success result instead of trusting it", async () => {
    const harness = fakeDatabase(
      resolves(preSwitchSnapshot()),
      resolves([result(), result(), result()]),
      resolves(committedSnapshot()),
    );
    await expect(
      applyServingSwitch(harness.database, projection),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("closes a failed pre-commit attempt as a stable database failure", async () => {
    const harness = fakeDatabase(
      resolves(preSwitchSnapshot()),
      rejects,
      resolves(preSwitchSnapshot()),
    );
    await expectCode(
      applyServingSwitch(harness.database, projection),
      "not_applied",
      true,
    );
  });

  it("closes an unreconciled write as outcome unknown and forbids retry", async () => {
    const harness = fakeDatabase(
      resolves(preSwitchSnapshot()),
      rejects,
      rejects,
    );
    await expectCode(
      applyServingSwitch(harness.database, projection),
      "outcome_unknown",
    );
  });

  it("rejects orphan, conflicting, stale, and malformed persisted state", async () => {
    const orphan = fakeDatabase(
      resolves([
        result(),
        result([{ ...preflight }]),
        result(),
        result([{ target_state: "ready", former_state: null }]),
      ]),
    );
    await expectCode(
      applyServingSwitch(orphan.database, projection),
      "integrity_failure",
    );

    const conflict = fakeDatabase(
      resolves([
        result(),
        result([{ ...preflight, preflight_hash: HASH_B }]),
        result(),
        result([{ target_state: "ready", former_state: null }]),
      ]),
    );
    await expectCode(
      applyServingSwitch(conflict.database, projection),
      "conflict",
    );

    const stale = fakeDatabase(
      resolves([
        result([
          {
            active_publication_id: PUBLICATION_B,
            rollback_candidate_publication_id: null,
            switched_at_ms: SWITCHED_AT_MS,
            generation: 1,
          },
        ]),
        result(),
        result(),
        result([{ target_state: "ready", former_state: null }]),
      ]),
    );
    await expectCode(applyServingSwitch(stale.database, projection), "stale");

    const malformed = fakeDatabase(
      resolves([
        result([{ active_publication_id: PUBLICATION_A }]),
        result(),
        result(),
        result([{ target_state: "ready", former_state: null }]),
      ]),
    );
    await expectCode(
      applyServingSwitch(malformed.database, projection),
      "integrity_failure",
    );
  });
});
