import { beforeAll, describe, expect, it } from "vitest";

import {
  PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV2,
  readServingSwitchPersistenceV2,
  reconstructServingReadinessProofV2FromPersistence,
  type ProviderSearchDocumentRowV2,
  type ServingSwitchProjectionV2,
} from "@quant-clarity/publication-core";

import {
  applyProviderSearchStagingV2,
  planProviderSearchInsertChunksV2,
  PROVIDER_SEARCH_D1_MAX_BOUND_BYTES,
  PROVIDER_SEARCH_D1_MAX_BOUND_PARAMETERS,
  PROVIDER_SEARCH_D1_MAX_INSERT_CHUNKS,
  PROVIDER_SEARCH_D1_MAX_QUERY_COUNT,
  ProviderSearchStagingError,
} from "./provider-search-staging.js";
import {
  applyReadinessCommitV2,
  ReadinessCommitV2Error,
} from "./readiness-commit-v2.js";
import { applyServingSwitchV2, ServingSwitchError } from "./serving-switch.js";
import {
  createActivationProjectionV2,
  createReadyPublicationFixture,
  type ReadyPublicationFixture,
} from "../test/serving-switch-fixture.js";

const PUBLICATION_ID = "pub_11111111-1111-4111-8111-111111111111" as const;
const SWITCHED_AT_MS = Date.parse("2026-08-02T10:00:00.000Z");
let fixture: ReadyPublicationFixture;
let switchProjection: ServingSwitchProjectionV2;

beforeAll(async () => {
  fixture = await createReadyPublicationFixture(
    PUBLICATION_ID,
    SWITCHED_AT_MS - 10 * 60_000,
  );
  switchProjection = await createActivationProjectionV2(
    fixture,
    SWITCHED_AT_MS,
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
const failedResult = (): D1Result =>
  ({
    success: false,
    meta: META,
    results: [],
    error: "private SQL failure",
  }) as unknown as D1Result;

type Captured = Readonly<{ sql: string; values: readonly unknown[] }>;
const CAPTURE = Symbol("captured v2 statement");
type CapturedStatement = D1PreparedStatement & { readonly [CAPTURE]: Captured };
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
  let index = 0;
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
          const handler = handlers[index++];
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
  (results: D1Result[]): Handler =>
  () =>
    Promise.resolve(results);

const stagingSnapshot = (committed: boolean): D1Result[] => {
  const state = readProviderSearchStagingPersistenceV2(fixture.providerStaging);
  return [
    result([
      {
        state: "building",
        closure_hash: state.closureHash,
        staging_revision: state.stagingRevision,
        sealed: 0,
      },
    ]),
    result(committed ? [...state.documents] : []),
    result(committed ? [...state.ftsRows] : []),
  ];
};

const readinessSnapshot = (committed: boolean): D1Result[] => {
  const state = readServingReadinessCommitPersistenceV2(
    fixture.readinessCommitV2,
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

const switchSnapshot = (committed: boolean): D1Result[] => {
  const state = readServingSwitchPersistenceV2(switchProjection);
  return [
    result(
      committed
        ? [
            {
              active_publication_id: state.history.to_publication_id,
              rollback_candidate_publication_id:
                state.history.resulting_rollback_candidate_publication_id,
              switched_at_ms: state.history.switched_at_ms,
              generation: state.history.new_generation,
            },
          ]
        : [],
    ),
    result(committed ? [{ ...state.preflight }] : []),
    result(committed ? [{ ...state.history }] : []),
    result([
      {
        target_state: committed ? "active" : "ready",
        former_state: null,
      },
    ]),
  ];
};

const mutationWithFailure = (length: number, failedAt: number): D1Result[] =>
  Array.from({ length }, (_, index) =>
    index === failedAt ? failedResult() : result(),
  );

describe("schema-1.5 provider writer nominal boundaries", () => {
  it("reconstructs restart-safe v2 readiness and rejects persisted corruption", async () => {
    const state = readServingReadinessCommitPersistenceV2(
      fixture.readinessCommitV2,
    );
    const serving = state.receiptRows.servings[0];
    if (serving === undefined) throw new Error("fixture lacks serving v2 row");
    const input = {
      manifest: fixture.manifest,
      providerProjection: fixture.providerProjection,
      providerFts: {
        buildVersion: "provider-name-fts5-unicode61@1" as const,
        documentCount: fixture.providerProjection.documentCount,
        queryable: true,
        exactParity: true,
      },
      providerSearchDocuments: state.providerSearch.documents,
      providerSearchFtsRows: state.providerSearch.ftsRows,
      receiptRows: state.receiptRows,
      attestation: state.attestation,
    };
    await expect(
      reconstructServingReadinessProofV2FromPersistence(input),
    ).resolves.toBeDefined();
    await expect(
      reconstructServingReadinessProofV2FromPersistence({
        ...input,
        attestation: {
          ...state.attestation,
          attestation_hash: `sha256:${"0".repeat(64)}`,
        },
      }),
    ).rejects.toThrow("attestation v2 is invalid");
    await expect(
      reconstructServingReadinessProofV2FromPersistence({
        ...input,
        receiptRows: {
          ...state.receiptRows,
          servings: [
            {
              ...serving,
              provider_search_document_count: 2,
            },
          ],
        },
      }),
    ).rejects.toThrow("provider serving receipt v2 is invalid");
  });

  it("rejects bare, copied, and v1 values before opening D1", async () => {
    const harness = fakeDatabase();
    const attempts = [
      applyProviderSearchStagingV2(
        harness.database,
        fixture.providerProjection,
      ),
      applyReadinessCommitV2(harness.database, fixture.readinessCommit),
      applyServingSwitchV2(
        harness.database,
        JSON.parse(JSON.stringify(switchProjection)),
      ),
    ];
    await expect(attempts[0]).rejects.toBeInstanceOf(
      ProviderSearchStagingError,
    );
    await expect(attempts[1]).rejects.toBeInstanceOf(ReadinessCommitV2Error);
    await expect(attempts[2]).rejects.toBeInstanceOf(ServingSwitchError);
    expect(harness.sessions).toEqual([]);
  });

  it("stages exact provider rows through fixed statements and reconciles", async () => {
    const persistence = readProviderSearchStagingPersistenceV2(
      fixture.providerStaging,
    );
    const mutation = Array.from(
      { length: persistence.documents.length + 2 },
      (_, index) =>
        index === persistence.documents.length + 1
          ? result([{ verified: 1 }])
          : result(),
    );
    const harness = fakeDatabase(
      resolves(stagingSnapshot(false)),
      resolves(mutation),
      resolves(stagingSnapshot(true)),
    );
    await expect(
      applyProviderSearchStagingV2(harness.database, fixture.providerStaging),
    ).resolves.toMatchObject({ outcome: "applied", documentCount: 1 });
    expect(harness.batches.map((batch) => batch.length)).toEqual([3, 3, 3]);
    expect(harness.batches[1]?.[1]?.sql).toContain("FROM json_each(?1)");
    expect(harness.batches[1]?.[1]?.values).toEqual([
      JSON.stringify([persistence.documents[0]]),
      persistence.publicationId,
      persistence.closureHash,
      persistence.stagingRevision,
    ]);
  });

  it("bounds a maximum-cardinality staging plan below every D1 ceiling", () => {
    const documents = Array.from({ length: 1_000 }, (_, index) => {
      const suffix = index.toString(16).padStart(12, "0");
      return {
        publication_id: PUBLICATION_ID,
        provider_id: `prv_00000000-0000-4000-8000-${suffix}`,
        projection_version: "provider-name@1",
        display_name: "\u{1f642}".repeat(200),
        normalized_name: "\u{1f642}".repeat(
          PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS,
        ),
        provider_resource_content_hash: `sha256:${"a".repeat(64)}`,
      } satisfies ProviderSearchDocumentRowV2;
    });

    const plan = planProviderSearchInsertChunksV2(documents);
    expect(plan.payloads.length).toBeGreaterThan(1);
    expect(plan.payloads.length).toBeLessThanOrEqual(
      PROVIDER_SEARCH_D1_MAX_INSERT_CHUNKS,
    );
    expect(Math.max(...plan.payloadByteLengths)).toBeLessThan(
      PROVIDER_SEARCH_D1_MAX_BOUND_BYTES,
    );
    expect(plan.queryCount).toBe(plan.payloads.length + 8);
    expect(plan.queryCount).toBeLessThanOrEqual(
      PROVIDER_SEARCH_D1_MAX_QUERY_COUNT,
    );
    expect(plan.insertBoundParameterCount).toBeLessThanOrEqual(
      PROVIDER_SEARCH_D1_MAX_BOUND_PARAMETERS,
    );
    expect(
      plan.payloads.flatMap(
        (payload) => JSON.parse(payload) as ProviderSearchDocumentRowV2[],
      ),
    ).toEqual(documents);
  });

  it("rejects an oversized JSON row before it can become a D1 binding", () => {
    const oversized = {
      publication_id: PUBLICATION_ID,
      provider_id: "prv_00000000-0000-4000-8000-000000000000",
      projection_version: "provider-name@1",
      display_name: "Provider",
      normalized_name: "x".repeat(PROVIDER_SEARCH_D1_MAX_BOUND_BYTES),
      provider_resource_content_hash: `sha256:${"a".repeat(64)}`,
    } satisfies ProviderSearchDocumentRowV2;
    expect(() => planProviderSearchInsertChunksV2([oversized])).toThrow(
      ProviderSearchStagingError,
    );
  });

  it("makes every staging statement failure retryable only after a clean reread", async () => {
    for (let failedAt = 0; failedAt < 3; failedAt += 1) {
      const harness = fakeDatabase(
        resolves(stagingSnapshot(false)),
        resolves(mutationWithFailure(3, failedAt)),
        resolves(stagingSnapshot(false)),
      );
      await expect(
        applyProviderSearchStagingV2(harness.database, fixture.providerStaging),
      ).rejects.toMatchObject({
        code: "not_applied",
        retrySameProjection: true,
      });
    }
  });

  it("commits all v2 readiness evidence atomically", async () => {
    const mutation = Array.from({ length: 12 }, (_, index) =>
      index === 11 ? result([{ verified: 1 }]) : result(),
    );
    const harness = fakeDatabase(
      resolves(readinessSnapshot(false)),
      resolves(mutation),
      resolves(readinessSnapshot(true)),
    );
    await expect(
      applyReadinessCommitV2(harness.database, fixture.readinessCommitV2),
    ).resolves.toMatchObject({ outcome: "applied" });
    expect(harness.batches.map((batch) => batch.length)).toEqual([7, 12, 7]);
    expect(harness.batches[1]?.[0]?.sql).toContain(
      "publication_provider_search_document",
    );
    expect(harness.batches[1]?.[6]?.values).toHaveLength(25);
  });

  it("makes every readiness statement failure retryable only after rollback", async () => {
    for (let failedAt = 0; failedAt < 12; failedAt += 1) {
      const harness = fakeDatabase(
        resolves(readinessSnapshot(false)),
        resolves(mutationWithFailure(12, failedAt)),
        resolves(readinessSnapshot(false)),
      );
      await expect(
        applyReadinessCommitV2(harness.database, fixture.readinessCommitV2),
      ).rejects.toMatchObject({
        code: "not_applied",
        retrySameProjection: true,
      });
    }
  });

  it("switches with the 48-field v2 preflight and v1 event", async () => {
    const harness = fakeDatabase(
      resolves(switchSnapshot(false)),
      resolves([result(), result(), result([{ verified: 1 }])]),
    );
    await expect(
      applyServingSwitchV2(harness.database, switchProjection),
    ).resolves.toMatchObject({ outcome: "applied", generation: 1 });
    expect(harness.batches.map((batch) => batch.length)).toEqual([4, 3]);
    expect(harness.batches[1]?.[0]?.values).toHaveLength(48);
    expect(harness.batches[1]?.[1]?.values[1]).toBe("1.0.0");
  });

  it("reconciles every switch statement failure without replacing the head", async () => {
    for (let failedAt = 0; failedAt < 3; failedAt += 1) {
      const harness = fakeDatabase(
        resolves(switchSnapshot(false)),
        resolves(mutationWithFailure(3, failedAt)),
        resolves(switchSnapshot(false)),
      );
      await expect(
        applyServingSwitchV2(harness.database, switchProjection),
      ).rejects.toMatchObject({
        code: "not_applied",
        retrySameProjection: true,
      });
    }
  });

  it("reconciles response loss to exact idempotent success", async () => {
    const harness = fakeDatabase(
      resolves(switchSnapshot(false)),
      () => Promise.reject(new Error("private mutation response lost")),
      resolves(switchSnapshot(true)),
    );
    await expect(
      applyServingSwitchV2(harness.database, switchProjection),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });
});
