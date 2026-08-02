import { beforeAll, describe, expect, it } from "vitest";

import {
  projectServingSwitchPreflightProofV4,
  projectServingSwitchPreflightProofV3,
  projectServingSwitchV3,
  projectServingSwitchV4,
  readProviderModelIdSearchQueryablePersistenceV4,
  readProviderModelIdSearchStagingPersistenceV1,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV4,
  readServingReadinessCommitPersistenceV3,
  readServingSwitchPersistenceV4,
  type PublicationRecord,
  type ServingSwitchProjectionV4,
  type ServingSwitchProjectionV3,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

import { applyServingSwitchV4 } from "./serving-switch.js";
import {
  createServingV4Fixture,
  type ServingV4Fixture,
} from "../test/serving-switch-v4-fixture.js";
import { createServingV3Fixture } from "../test/serving-switch-v3-fixture.js";
import {
  createActivationProjectionV2,
  createReadyPublicationFixture,
} from "../test/serving-switch-fixture.js";

const PUBLICATION_A = "pub_30000001-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_30000002-0000-4000-8000-000000000001" as const;
const NOW = Date.parse("2026-08-02T10:00:00.000Z");

const artifactProof = (fixture: ServingV4Fixture, observedAtMs: number) => ({
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
  vectorMutationId: `switch-v4-${fixture.base.manifest.publicationId}`,
  vectorAllIdsPresent: true as const,
  vectorAllNamespacesMatch: true as const,
  vectorQueryable: true as const,
  probeSetVersion: "search-gold@4" as const,
  integrityPassed: true as const,
  exactSearchPassed: true as const,
  semanticSearchPassed: true as const,
  structuredFilterPassed: true as const,
  neutralityPassed: true as const,
  versionIsolationPassed: true as const,
});

const record = (
  fixture: ServingV4Fixture,
  state: PublicationRecord["state"],
  firstActivatedAt: string | null = null,
): PublicationRecord => {
  const readiness = readServingReadinessCommitPersistenceV4(
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
  fixture: ServingV4Fixture,
  switchedAtMs: number,
  currentHead: StoredPublicationHead | null = null,
  currentActive: PublicationRecord | null = null,
): Promise<ServingSwitchProjectionV4> => {
  const provider = readProviderSearchStagingPersistenceV2(
    fixture.providerStaging,
  );
  const providerModel = readProviderModelIdSearchStagingPersistenceV1(
    fixture.providerModelIdStaging,
  );
  const readiness = readServingReadinessCommitPersistenceV4(
    fixture.readinessCommit,
  );
  const generation = (currentHead?.generation ?? 0) + 1;
  const preflight = await projectServingSwitchPreflightProofV4({
    manifest: fixture.base.manifest,
    providerProof: fixture.providerProof,
    modelVariantNameProof: fixture.modelProof,
    providerModelIdProof: fixture.providerModelIdProof,
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
  return projectServingSwitchV4({
    preflight,
    target: record(fixture, "ready"),
    currentHead,
    currentActive,
    authorizedBy: { kind: "pipeline", identityId: "pipeline.switch-v4" },
    closureRows: fixture.base.closureRows,
    persistedSeal: fixture.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: fixture.base.persistence.rows,
    persistedProviderModelIdRows: providerModel.rows,
    persistedReceiptRows: readiness.receiptRows,
    persistedAttestation: readiness.attestation,
  });
};

const rollback = async (
  target: ServingV4Fixture,
  targetFirstActivatedAt: string,
  currentHead: StoredPublicationHead,
  currentActive: PublicationRecord,
  switchedAtMs: number,
): Promise<ServingSwitchProjectionV4> => {
  const provider = readProviderSearchStagingPersistenceV2(
    target.providerStaging,
  );
  const providerModel = readProviderModelIdSearchStagingPersistenceV1(
    target.providerModelIdStaging,
  );
  const preflight = await projectServingSwitchPreflightProofV4({
    manifest: target.base.manifest,
    providerProof: target.providerProof,
    modelVariantNameProof: target.modelProof,
    providerModelIdProof: target.providerModelIdProof,
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
  return projectServingSwitchV4({
    preflight,
    target: record(target, "superseded", targetFirstActivatedAt),
    currentHead,
    currentActive,
    authorizedBy: { kind: "operator", identityId: "operator.switch-v4" },
    closureRows: target.base.closureRows,
    persistedSeal: target.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: target.base.persistence.rows,
    persistedProviderModelIdRows: providerModel.rows,
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
const CAPTURE = Symbol("captured switch v4 statement");
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

const sameBytes = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const verifierResult = (
  statements: readonly Captured[],
): FakeD1Result[] | null => {
  const publicationId = statements[0]?.values[0];
  const target = [fixtureA, fixtureB].find(
    (candidate) => candidate.base.manifest.publicationId === publicationId,
  );
  if (target === undefined) return null;
  const nominal = readProviderModelIdSearchQueryablePersistenceV4(
    target.providerModelIdProof,
  );
  const rows = nominal.providerModelIdSearch.rows;
  const firstStatement = statements[0];
  if (
    statements.length === 1 &&
    firstStatement?.sql.includes(
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
          const verification = verifierResult(captured);
          if (verification !== null) return Promise.resolve(verification);
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
  projection: ServingSwitchProjectionV4,
  committed: boolean,
  preflightOverride?: unknown,
  historyOverride?: unknown,
  countsOverride?: unknown,
): FakeD1Result[] => {
  const state = readServingSwitchPersistenceV4(projection);
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
      countsOverride ?? {
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
    result([
      {
        provider_document_count: state.preflight.provider_search_document_count,
        provider_fts_document_count:
          state.preflight.provider_search_fts_document_count,
        model_variant_name_document_count:
          state.preflight.model_variant_name_storage_document_count,
        provider_model_id_document_count:
          state.preflight.provider_model_id_storage_document_count,
        database_now_ms: state.preflight.switched_at_ms,
      },
    ]),
  ];
};

let fixtureA: ServingV4Fixture;
let fixtureB: ServingV4Fixture;
let first: ServingSwitchProjectionV4;
let replacement: ServingSwitchProjectionV4;
let immediateRollback: ServingSwitchProjectionV4;
let legacyV2: Awaited<ReturnType<typeof createActivationProjectionV2>>;
let legacyV3: ServingSwitchProjectionV3;

beforeAll(async () => {
  fixtureA = await createServingV4Fixture(PUBLICATION_A, NOW - 20 * 60_000);
  fixtureB = await createServingV4Fixture(PUBLICATION_B, NOW - 15 * 60_000);
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
  const legacyV3Fixture = await createServingV3Fixture(
    "pub_30000008-0000-4000-8000-000000000001",
    NOW - 20 * 60_000,
  );
  const legacyProvider = readProviderSearchStagingPersistenceV2(
    legacyV3Fixture.providerStaging,
  );
  const legacyReadiness = readServingReadinessCommitPersistenceV3(
    legacyV3Fixture.readinessCommit,
  );
  const legacyPreflight = await projectServingSwitchPreflightProofV3({
    manifest: legacyV3Fixture.base.manifest,
    providerProof: legacyV3Fixture.providerProof,
    modelVariantNameProof: legacyV3Fixture.modelProof,
    readinessProof: legacyV3Fixture.readinessProof,
    context: {
      switchId: `publication-switch|activate|1|${legacyV3Fixture.base.manifest.publicationId}|${legacyV3Fixture.base.manifest.closureHash}`,
      action: "activate",
      expectedPriorGeneration: 0,
      expectedPriorRollbackCandidatePublicationId: null,
      expectedPriorSwitchedAtMs: null,
      newGeneration: 1,
      fromPublicationId: null,
      fromClosureHash: null,
      toPublicationId: legacyV3Fixture.base.manifest.publicationId,
      toClosureHash: legacyV3Fixture.base.manifest.closureHash,
      switchedAtMs: NOW - 3 * 60_000,
    },
    artifactProof: {
      environment: "local",
      observedAtMs: NOW - 3 * 60_000 - 1_000,
      maximumAgeMs: 60 * 60 * 1_000,
      ftsBuildVersion: "fts5-unicode61@1",
      ftsSourceDocumentCount:
        legacyV3Fixture.base.manifest.searchDocuments.length,
      ftsIndexDocumentCount:
        legacyV3Fixture.base.manifest.searchDocuments.length,
      ftsSourceInventoryHash:
        legacyV3Fixture.base.manifest.exactSearchInventoryHash,
      ftsExactParity: true,
      archiveBundleHash: legacyV3Fixture.base.manifest.bundleHash,
      archiveImmutable: true,
      vectorNamespace: legacyV3Fixture.base.manifest.publicationId,
      vectorDocumentCount: legacyV3Fixture.base.manifest.vectors.length,
      vectorVerifiedDocumentCount: legacyV3Fixture.base.manifest.vectors.length,
      vectorInventoryHash: legacyV3Fixture.base.manifest.vectorInventoryHash,
      vectorVisibilityProbeVersion: "vector-visibility@1",
      vectorMutationId: `legacy-v3-${legacyV3Fixture.base.manifest.publicationId}`,
      vectorAllIdsPresent: true,
      vectorAllNamespacesMatch: true,
      vectorQueryable: true,
      probeSetVersion: "search-gold@3",
      integrityPassed: true,
      exactSearchPassed: true,
      semanticSearchPassed: true,
      structuredFilterPassed: true,
      neutralityPassed: true,
      versionIsolationPassed: true,
    },
  });
  legacyV3 = await projectServingSwitchV3({
    preflight: legacyPreflight,
    target: {
      publicationId: legacyV3Fixture.base.manifest.publicationId,
      closureHash: legacyV3Fixture.base.manifest.closureHash,
      state: "ready",
      generatedAt: legacyV3Fixture.base.manifest.generatedAt,
      readyAt: new Date(legacyReadiness.transition.ready_at_ms).toISOString(),
      firstActivatedAt: null,
      lastHeadReferencedAt: null,
    },
    currentHead: null,
    currentActive: null,
    authorizedBy: { kind: "pipeline", identityId: "pipeline.legacy-v3" },
    closureRows: legacyV3Fixture.base.closureRows,
    persistedSeal: legacyV3Fixture.seal,
    persistedProviderSearchDocuments: legacyProvider.documents,
    persistedProviderSearchFtsRows: legacyProvider.ftsRows,
    persistedModelVariantNameRows: legacyV3Fixture.base.persistence.rows,
    persistedReceiptRows: legacyReadiness.receiptRows,
    persistedAttestation: legacyReadiness.attestation,
  });
});

describe("schema-1.7 serving switch v4 adapter", () => {
  it("uses an exact 62-field preflight and fixed five-statement event-v1 batch", async () => {
    for (const projection of [first, replacement, immediateRollback]) {
      const harness = fakeDatabase(
        resolves(snapshot(projection, false)),
        resolves([
          result([{ provider_model_id_parity: 1 }]),
          result([{ provider_model_id_indexes: 1 }]),
          result(),
          result(),
          result([{ verified: 1 }]),
        ]),
      );
      await expect(
        applyServingSwitchV4(harness.database, projection),
      ).resolves.toMatchObject({ outcome: "applied" });
      expect(harness.batches.map((batch) => batch.length)).toEqual([
        5, 1, 4, 5, 1, 4,
      ]);
      expect(harness.batches[3]?.[0]?.values).toHaveLength(36);
      expect(harness.batches[3]?.[0]?.sql).toContain("WITH\nnominal_payload");
      expect(harness.batches[3]?.[1]?.values).toHaveLength(5);
      expect(harness.batches[3]?.[1]?.sql).toContain("pragma_index_info");
      expect(harness.batches[3]?.[1]?.sql).toContain("X'FF'");
      expect(harness.batches[3]?.[2]?.values).toHaveLength(62);
      expect(harness.batches[3]?.[2]?.sql).toContain(
        "provider_model_id_storage_exact_parity",
      );
      expect(harness.batches[3]?.[3]?.values[1]).toBe("1.0.0");
      expect(harness.batches[3]?.[4]?.sql).toContain(
        "publication_provider_model_id_search_document",
      );
    }
  });

  it("rejects non-v4 and copied values before D1", async () => {
    const harness = fakeDatabase();
    for (const value of [
      fixtureA.readinessCommit,
      legacyV2,
      legacyV3,
      readServingSwitchPersistenceV4(first).preflight,
      { ...first },
      JSON.parse(JSON.stringify(first)),
    ]) {
      await expect(
        applyServingSwitchV4(harness.database, value),
      ).rejects.toMatchObject({ code: "integrity_failure" });
    }
    expect(harness.batches).toEqual([]);
  });

  it("reconciles every failed statement and response loss without guessing", async () => {
    for (let failedAt = 0; failedAt < 5; failedAt += 1) {
      const mutation = Array.from({ length: 5 }, (_, index) =>
        index === failedAt ? failedResult() : result(),
      );
      const harness = fakeDatabase(
        resolves(snapshot(first, false)),
        resolves(mutation),
        resolves(snapshot(first, false)),
      );
      await expect(
        applyServingSwitchV4(harness.database, first),
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
    await expect(applyServingSwitchV4(lost.database, first)).resolves.toEqual({
      outcome: "idempotent_success",
      switchId: readServingSwitchPersistenceV4(first).history.switch_id,
      generation: 1,
    });
  });

  it("fails closed on hostile envelopes, bounds, corruption, and stale generations", async () => {
    const malformed = fakeDatabase(() =>
      Promise.resolve(null as unknown as D1Result[]),
    );
    await expect(
      applyServingSwitchV4(malformed.database, first),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const failedEnvelope = fakeDatabase(
      resolves([failedResult(), result(), result(), result()]),
    );
    await expect(
      applyServingSwitchV4(failedEnvelope.database, first),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const state = readServingSwitchPersistenceV4(first);
    const corrupted = {
      ...state.preflight,
      preflight_hash: `sha256:${"0".repeat(64)}`,
    };
    const conflict = fakeDatabase(resolves(snapshot(first, true, corrupted)));
    await expect(
      applyServingSwitchV4(conflict.database, first),
    ).rejects.toMatchObject({ code: "conflict" });

    const corruptHistory = {
      ...state.history,
      event_hash: `sha256:${"1".repeat(64)}`,
    };
    const historyConflict = fakeDatabase(
      resolves(snapshot(first, true, undefined, corruptHistory)),
    );
    await expect(
      applyServingSwitchV4(historyConflict.database, first),
    ).rejects.toMatchObject({ code: "conflict" });

    const oversized = {
      ...state.preflight,
      switch_id: "x".repeat(513),
    };
    const hostile = fakeDatabase(resolves(snapshot(first, true, oversized)));
    await expect(
      applyServingSwitchV4(hostile.database, first),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const countDrift = fakeDatabase(
      resolves(
        snapshot(first, true, undefined, undefined, {
          provider_document_count:
            state.preflight.provider_search_document_count,
          provider_fts_document_count:
            state.preflight.provider_search_fts_document_count,
          model_variant_name_document_count:
            state.preflight.model_variant_name_storage_document_count,
          provider_model_id_document_count:
            state.preflight.provider_model_id_storage_document_count + 1,
        }),
      ),
    );
    await expect(
      applyServingSwitchV4(countDrift.database, first),
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
      applyServingSwitchV4(stale.database, first),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("snapshots each hostile row field exactly once", async () => {
    const state = readServingSwitchPersistenceV4(first);
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
      applyServingSwitchV4(harness.database, first),
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
            return rowLengthReads <= 5 ? target.length : 99;
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
      applyServingSwitchV4(proxyHarness.database, first),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    expect(batchLengthReads).toBe(1);
    expect(rowLengthReads).toBe(5);
  });
});
