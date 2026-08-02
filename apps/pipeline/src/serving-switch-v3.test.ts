import { beforeAll, describe, expect, it } from "vitest";

import {
  projectServingSwitchPreflightProofV3,
  projectServingSwitchV3,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV3,
  readServingSwitchPersistenceV3,
  type PublicationRecord,
  type ServingSwitchProjectionV3,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

import { applyServingSwitchV3 } from "./serving-switch.js";
import {
  createServingV3Fixture,
  type ServingV3Fixture,
} from "../test/serving-switch-v3-fixture.js";
import {
  createActivationProjectionV2,
  createReadyPublicationFixture,
} from "../test/serving-switch-fixture.js";

const PUBLICATION_A = "pub_30000001-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_30000002-0000-4000-8000-000000000001" as const;
const NOW = Date.parse("2026-08-02T10:00:00.000Z");

const artifactProof = (fixture: ServingV3Fixture, observedAtMs: number) => ({
  environment: "local" as const,
  observedAtMs,
  maximumAgeMs: 60 * 60 * 1_000,
  ftsBuildVersion: "fts5-unicode61@1",
  ftsSourceDocumentCount: fixture.base.manifest.searchDocuments.length,
  ftsIndexDocumentCount: fixture.base.manifest.searchDocuments.length,
  ftsSourceInventoryHash: fixture.base.manifest.exactSearchInventoryHash,
  ftsExactParity: true as const,
  archiveBundleHash: fixture.base.manifest.bundleHash,
  archiveImmutable: true as const,
  vectorNamespace: fixture.base.manifest.publicationId,
  vectorDocumentCount: fixture.base.manifest.vectors.length,
  vectorVerifiedDocumentCount: fixture.base.manifest.vectors.length,
  vectorInventoryHash: fixture.base.manifest.vectorInventoryHash,
  vectorVisibilityProbeVersion: "vector-visibility@1",
  vectorMutationId: `switch-v3-${fixture.base.manifest.publicationId}`,
  vectorAllIdsPresent: true as const,
  vectorAllNamespacesMatch: true as const,
  vectorQueryable: true as const,
  probeSetVersion: "search-gold@3" as const,
  integrityPassed: true as const,
  exactSearchPassed: true as const,
  semanticSearchPassed: true as const,
  structuredFilterPassed: true as const,
  neutralityPassed: true as const,
  versionIsolationPassed: true as const,
});

const record = (
  fixture: ServingV3Fixture,
  state: PublicationRecord["state"],
  firstActivatedAt: string | null = null,
): PublicationRecord => {
  const readiness = readServingReadinessCommitPersistenceV3(
    fixture.readinessCommit,
  );
  return {
    publicationId: fixture.base.manifest.publicationId,
    closureHash: fixture.base.manifest.closureHash,
    state,
    generatedAt: fixture.base.manifest.generatedAt,
    readyAt: new Date(readiness.transition.ready_at_ms).toISOString(),
    firstActivatedAt,
    lastHeadReferencedAt: firstActivatedAt,
  };
};

const activation = async (
  fixture: ServingV3Fixture,
  switchedAtMs: number,
  currentHead: StoredPublicationHead | null = null,
  currentActive: PublicationRecord | null = null,
): Promise<ServingSwitchProjectionV3> => {
  const provider = readProviderSearchStagingPersistenceV2(
    fixture.providerStaging,
  );
  const readiness = readServingReadinessCommitPersistenceV3(
    fixture.readinessCommit,
  );
  const generation = (currentHead?.generation ?? 0) + 1;
  const preflight = await projectServingSwitchPreflightProofV3({
    manifest: fixture.base.manifest,
    providerProof: fixture.providerProof,
    modelVariantNameProof: fixture.modelProof,
    readinessProof: fixture.readinessProof,
    context: {
      switchId: `publication-switch|activate|${String(generation)}|${fixture.base.manifest.publicationId}|${fixture.base.manifest.closureHash}`,
      action: "activate",
      expectedPriorGeneration: currentHead?.generation ?? 0,
      expectedPriorRollbackCandidatePublicationId:
        currentHead?.rollbackCandidatePublicationId ?? null,
      expectedPriorSwitchedAtMs:
        currentHead === null ? null : Date.parse(currentHead.switchedAt),
      newGeneration: generation,
      fromPublicationId: currentActive?.publicationId ?? null,
      fromClosureHash: currentActive?.closureHash ?? null,
      toPublicationId: fixture.base.manifest.publicationId,
      toClosureHash: fixture.base.manifest.closureHash,
      switchedAtMs,
    },
    artifactProof: artifactProof(fixture, switchedAtMs - 1_000),
  });
  return projectServingSwitchV3({
    preflight,
    target: record(fixture, "ready"),
    currentHead,
    currentActive,
    authorizedBy: { kind: "pipeline", identityId: "pipeline.switch-v3" },
    closureRows: fixture.base.closureRows,
    persistedSeal: fixture.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: fixture.base.persistence.rows,
    persistedReceiptRows: readiness.receiptRows,
    persistedAttestation: readiness.attestation,
  });
};

const rollback = async (
  target: ServingV3Fixture,
  targetFirstActivatedAt: string,
  currentHead: StoredPublicationHead,
  currentActive: PublicationRecord,
  switchedAtMs: number,
): Promise<ServingSwitchProjectionV3> => {
  const provider = readProviderSearchStagingPersistenceV2(
    target.providerStaging,
  );
  const preflight = await projectServingSwitchPreflightProofV3({
    manifest: target.base.manifest,
    providerProof: target.providerProof,
    modelVariantNameProof: target.modelProof,
    readinessProof: null,
    context: {
      switchId: `publication-switch|rollback|${String(currentHead.generation + 1)}|${target.base.manifest.publicationId}|${target.base.manifest.closureHash}`,
      action: "rollback",
      expectedPriorGeneration: currentHead.generation,
      expectedPriorRollbackCandidatePublicationId:
        currentHead.rollbackCandidatePublicationId,
      expectedPriorSwitchedAtMs: Date.parse(currentHead.switchedAt),
      newGeneration: currentHead.generation + 1,
      fromPublicationId: currentActive.publicationId,
      fromClosureHash: currentActive.closureHash,
      toPublicationId: target.base.manifest.publicationId,
      toClosureHash: target.base.manifest.closureHash,
      switchedAtMs,
    },
    artifactProof: artifactProof(target, switchedAtMs - 1_000),
  });
  return projectServingSwitchV3({
    preflight,
    target: record(target, "superseded", targetFirstActivatedAt),
    currentHead,
    currentActive,
    authorizedBy: { kind: "operator", identityId: "operator.switch-v3" },
    closureRows: target.base.closureRows,
    persistedSeal: target.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: target.base.persistence.rows,
    persistedReceiptRows: null,
    persistedAttestation: null,
  });
};

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
const CAPTURE = Symbol("captured switch v3 statement");
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
  const batches: Captured[][] = [];
  let index = 0;
  const database = {
    withSession() {
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
  return { database, batches };
};
const resolves =
  (results: FakeD1Result[]): Handler =>
  () =>
    Promise.resolve(results);

const snapshot = (
  projection: ServingSwitchProjectionV3,
  committed: boolean,
  preflightOverride?: unknown,
  historyOverride?: unknown,
): FakeD1Result[] => {
  const state = readServingSwitchPersistenceV3(projection);
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
        : state.history.expected_prior_generation === 0
          ? []
          : [
              {
                active_publication_id: state.history.from_publication_id,
                rollback_candidate_publication_id:
                  state.history
                    .expected_prior_rollback_candidate_publication_id,
                switched_at_ms: state.history.expected_prior_switched_at_ms,
                generation: state.history.expected_prior_generation,
              },
            ],
    ),
    result(
      committed
        ? [preflightOverride ?? { ...state.preflight }]
        : preflightOverride === undefined
          ? []
          : [preflightOverride],
    ),
    result(committed ? [historyOverride ?? { ...state.history }] : []),
    result([
      {
        target_state: committed
          ? "active"
          : state.history.action === "activate"
            ? "ready"
            : "superseded",
        former_state:
          state.history.from_publication_id === null
            ? null
            : committed
              ? state.history.action === "activate"
                ? "superseded"
                : "rolled_back"
              : "active",
      },
    ]),
  ];
};

let fixtureA: ServingV3Fixture;
let fixtureB: ServingV3Fixture;
let first: ServingSwitchProjectionV3;
let replacement: ServingSwitchProjectionV3;
let immediateRollback: ServingSwitchProjectionV3;
let legacyV2: Awaited<ReturnType<typeof createActivationProjectionV2>>;

beforeAll(async () => {
  fixtureA = await createServingV3Fixture(PUBLICATION_A, NOW - 20 * 60_000);
  fixtureB = await createServingV3Fixture(PUBLICATION_B, NOW - 15 * 60_000);
  first = await activation(fixtureA, NOW - 4 * 60_000);
  const headA: StoredPublicationHead = {
    activePublicationId: PUBLICATION_A,
    rollbackCandidatePublicationId: null,
    switchedAt: new Date(NOW - 4 * 60_000).toISOString(),
    generation: 1,
  };
  replacement = await activation(
    fixtureB,
    NOW - 2 * 60_000,
    headA,
    record(fixtureA, "active", headA.switchedAt),
  );
  const headB: StoredPublicationHead = {
    activePublicationId: PUBLICATION_B,
    rollbackCandidatePublicationId: PUBLICATION_A,
    switchedAt: new Date(NOW - 2 * 60_000).toISOString(),
    generation: 2,
  };
  immediateRollback = await rollback(
    fixtureA,
    headA.switchedAt,
    headB,
    record(fixtureB, "active", headB.switchedAt),
    NOW - 60_000,
  );
  const legacyFixture = await createReadyPublicationFixture(
    "pub_30000009-0000-4000-8000-000000000001",
    NOW - 20 * 60_000,
  );
  legacyV2 = await createActivationProjectionV2(legacyFixture, NOW - 60_000);
});

describe("schema-1.6 serving switch v3 adapter", () => {
  it("uses an exact 55-field preflight and fixed three-statement event-v1 batch", async () => {
    for (const projection of [first, replacement, immediateRollback]) {
      const harness = fakeDatabase(
        resolves(snapshot(projection, false)),
        resolves([result(), result(), result([{ verified: 1 }])]),
      );
      await expect(
        applyServingSwitchV3(harness.database, projection),
      ).resolves.toMatchObject({ outcome: "applied" });
      expect(harness.batches.map((batch) => batch.length)).toEqual([4, 3]);
      expect(harness.batches[1]?.[0]?.values).toHaveLength(55);
      expect(harness.batches[1]?.[0]?.sql).toContain(
        "model_variant_name_storage_exact_parity",
      );
      expect(harness.batches[1]?.[1]?.values[1]).toBe("1.0.0");
      expect(harness.batches[1]?.[2]?.sql).toContain(
        "publication_model_variant_name_search_document",
      );
    }
  });

  it("rejects non-v3 and copied values before D1", async () => {
    const harness = fakeDatabase();
    for (const value of [
      fixtureA.readinessCommit,
      legacyV2,
      readServingSwitchPersistenceV3(first).preflight,
      { ...first },
      JSON.parse(JSON.stringify(first)),
    ]) {
      await expect(
        applyServingSwitchV3(harness.database, value),
      ).rejects.toMatchObject({ code: "integrity_failure" });
    }
    expect(harness.batches).toEqual([]);
  });

  it("reconciles every failed statement and response loss without guessing", async () => {
    for (let failedAt = 0; failedAt < 3; failedAt += 1) {
      const mutation = Array.from({ length: 3 }, (_, index) =>
        index === failedAt ? failedResult() : result(),
      );
      const harness = fakeDatabase(
        resolves(snapshot(first, false)),
        resolves(mutation),
        resolves(snapshot(first, false)),
      );
      await expect(
        applyServingSwitchV3(harness.database, first),
      ).rejects.toMatchObject({
        code: "not_applied",
        retrySameProjection: true,
      });
    }
    const lost = fakeDatabase(
      resolves(snapshot(first, false)),
      () => Promise.reject(new Error("private response lost")),
      resolves(snapshot(first, true)),
    );
    await expect(applyServingSwitchV3(lost.database, first)).resolves.toEqual({
      outcome: "idempotent_success",
      switchId: readServingSwitchPersistenceV3(first).history.switch_id,
      generation: 1,
    });
  });

  it("fails closed on hostile envelopes, bounds, corruption, and stale generations", async () => {
    const malformed = fakeDatabase(() =>
      Promise.resolve(null as unknown as D1Result[]),
    );
    await expect(
      applyServingSwitchV3(malformed.database, first),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const failedEnvelope = fakeDatabase(
      resolves([failedResult(), result(), result(), result()]),
    );
    await expect(
      applyServingSwitchV3(failedEnvelope.database, first),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const state = readServingSwitchPersistenceV3(first);
    const corrupted = {
      ...state.preflight,
      preflight_hash: `sha256:${"0".repeat(64)}`,
    };
    const conflict = fakeDatabase(resolves(snapshot(first, true, corrupted)));
    await expect(
      applyServingSwitchV3(conflict.database, first),
    ).rejects.toMatchObject({ code: "conflict" });

    const corruptHistory = {
      ...state.history,
      event_hash: `sha256:${"1".repeat(64)}`,
    };
    const historyConflict = fakeDatabase(
      resolves(snapshot(first, true, undefined, corruptHistory)),
    );
    await expect(
      applyServingSwitchV3(historyConflict.database, first),
    ).rejects.toMatchObject({ code: "conflict" });

    const oversized = {
      ...state.preflight,
      switch_id: "x".repeat(513),
    };
    const hostile = fakeDatabase(resolves(snapshot(first, true, oversized)));
    await expect(
      applyServingSwitchV3(hostile.database, first),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const staleRows = snapshot(first, false);
    const staleHead = result([
      {
        active_publication_id: PUBLICATION_B,
        rollback_candidate_publication_id: null,
        switched_at_ms: NOW,
        generation: 9,
      },
    ]);
    const stale = fakeDatabase(resolves([staleHead, ...staleRows.slice(1)]));
    await expect(
      applyServingSwitchV3(stale.database, first),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("snapshots each hostile row field exactly once", async () => {
    const state = readServingSwitchPersistenceV3(first);
    let reads = 0;
    const row = { ...state.preflight } as Record<string, unknown>;
    Object.defineProperty(row, "switch_id", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? state.preflight.switch_id : "forged-after-read";
      },
    });
    const harness = fakeDatabase(resolves(snapshot(first, true, row)));
    await expect(
      applyServingSwitchV3(harness.database, first),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    expect(reads).toBe(1);

    let batchLengthReads = 0;
    let rowLengthReads = 0;
    const envelopes = snapshot(first, true).map((entry) => ({
      ...entry,
      results: new Proxy(entry.results, {
        get: (target, property, receiver) => {
          if (property === "length") {
            rowLengthReads += 1;
            return rowLengthReads <= 4 ? target.length : 99;
          }
          return Reflect.get(target, property, receiver) as unknown;
        },
      }),
    }));
    const rotating = new Proxy(envelopes, {
      get: (target, property, receiver) => {
        if (property === "length") {
          batchLengthReads += 1;
          return batchLengthReads === 1 ? target.length : 0;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const proxyHarness = fakeDatabase(() => Promise.resolve(rotating));
    await expect(
      applyServingSwitchV3(proxyHarness.database, first),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    expect(batchLengthReads).toBe(1);
    expect(rowLengthReads).toBe(4);
  });
});
