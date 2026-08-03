import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  projectServingSwitchPreflightProofV5,
  projectServingSwitchV5,
  readProviderModelIdSearchStagingPersistenceV1,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV5,
  readServingSwitchPersistenceV5,
  type PublicationRecord,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

import {
  archiveModelSlugHistoryCandidate,
  verifyArchivedModelSlugHistoryForRollback,
  type TrustedFreshModelSlugRollbackProof,
} from "./model-slug-history-archive.js";
import { stageModelSlugHistoryArchive } from "./model-slug-history-staging.js";
import { mintModelSlugLifecycleAuthorityV5 } from "./model-slug-lifecycle-authority.js";
import { auditServeableModelDetailPublications } from "./model-detail-pre-open-audit.js";
import { applyModelVariantNameSearchStagingV1 } from "./model-variant-name-search-staging.js";
import { applyProviderModelIdSearchStagingV1 } from "./provider-model-id-search-staging.js";
import { applyProviderSearchStagingV2 } from "./provider-search-staging.js";
import { applyReadinessCommitV5 } from "./readiness-commit-v5.js";
import { applyServingSwitchV5 } from "./serving-switch-v5.js";
import { ServingSwitchError } from "./serving-switch.js";
import { createModelSlugHistoryCandidateForAssembly } from "../test/model-slug-history-candidate-fixture.js";
import { seedModelVariantNameSearchBuildingPublication } from "../test/model-variant-name-search-fixture.js";
import { createProviderModelIdSearchFixture } from "../test/provider-model-id-search-fixture.js";
import { sealServingV4Fixture } from "../test/serving-switch-v4-fixture.js";
import {
  createServingV5Fixture,
  createZeroModelServingV5Fixture,
  type ServingV5Fixture,
} from "../test/serving-switch-v5-fixture.js";

type ReadyPrepared = Awaited<ReturnType<typeof prepareReady>>;
type Prepared = ReadyPrepared &
  Readonly<{ projection: Awaited<ReturnType<typeof projectActivation>> }>;
let activated: Prepared | undefined;

const archiveBucket = (
  env as typeof env & Readonly<{ MODEL_SLUG_ARCHIVE_BUCKET: R2Bucket }>
).MODEL_SLUG_ARCHIVE_BUCKET;

const artifactProof = (
  fixture: ServingV5Fixture,
  observedAtMs: number,
  maximumAgeMs = 60 * 60_000,
) => ({
  environment: "local" as const,
  observedAtMs,
  maximumAgeMs,
  ftsBuildVersion: "fts5-unicode61@1",
  ftsSourceDocumentCount: fixture.v4.base.manifest.searchDocuments.length,
  ftsIndexDocumentCount: fixture.v4.base.manifest.searchDocuments.length,
  ftsSourceInventoryHash: fixture.v4.base.manifest.exactSearchInventoryHash,
  ftsExactParity: true as const,
  archiveBundleHash: fixture.v4.base.manifest.bundleHash,
  archiveImmutable: true as const,
  vectorNamespace: fixture.v4.base.manifest.publicationId,
  vectorDocumentCount: fixture.v4.base.manifest.vectors.length,
  vectorVerifiedDocumentCount: fixture.v4.base.manifest.vectors.length,
  vectorInventoryHash: fixture.v4.base.manifest.vectorInventoryHash,
  vectorVisibilityProbeVersion: "vector-visibility@1",
  vectorMutationId: `switch-v5-${fixture.v4.base.manifest.publicationId}`,
  vectorAllIdsPresent: true as const,
  vectorAllNamespacesMatch: true as const,
  vectorQueryable: true as const,
  probeSetVersion: "search-gold@5" as const,
  integrityPassed: true as const,
  exactSearchPassed: true as const,
  semanticSearchPassed: true as const,
  structuredFilterPassed: true as const,
  neutralityPassed: true as const,
  versionIsolationPassed: true as const,
  modelSlugLookupPassed: true as const,
});

const prepareReady = async (
  sequence: number,
  zeroModel = false,
  modelCount = 1,
) => {
  const generatedAtMs = Date.now() - 10 * 60_000 + sequence;
  const publicationId =
    `pub_f6000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}` as const;
  const providerModelIdFixture =
    !zeroModel && modelCount > 1
      ? await createProviderModelIdSearchFixture(
          publicationId,
          generatedAtMs,
          [],
          false,
          Array.from(
            { length: modelCount },
            (_, index) => `Paged Model ${String(index).padStart(4, "0")}`,
          ),
        )
      : undefined;
  const initial = zeroModel
    ? await createZeroModelServingV5Fixture(publicationId, generatedAtMs)
    : await createServingV5Fixture(
        publicationId,
        generatedAtMs,
        undefined,
        providerModelIdFixture,
      );
  const candidate = await createModelSlugHistoryCandidateForAssembly(
    {
      manifest: initial.v4.base.manifest,
      resources: initial.v4.base.closureRows.resources.filter(
        (resource) => resource.resource_type === "model",
      ),
    },
    initial.historyRows,
  );
  const operationalArchive = await archiveModelSlugHistoryCandidate(
    archiveBucket,
    candidate,
  );
  const fixture = zeroModel
    ? await createZeroModelServingV5Fixture(
        publicationId,
        generatedAtMs,
        operationalArchive,
      )
    : await createServingV5Fixture(
        publicationId,
        generatedAtMs,
        operationalArchive,
        providerModelIdFixture,
      );
  await seedModelVariantNameSearchBuildingPublication(
    env.SERVING_DB,
    fixture.v4.base,
  );
  await applyProviderSearchStagingV2(
    env.SERVING_DB,
    fixture.v4.providerStaging,
  );
  await applyModelVariantNameSearchStagingV1(
    env.SERVING_DB,
    fixture.v4.base.staging,
  );
  await applyProviderModelIdSearchStagingV1(
    env.SERVING_DB,
    fixture.v4.providerModelIdStaging,
  );
  const operationalServing = (
    await stageModelSlugHistoryArchive(env.SERVING_DB, operationalArchive)
  ).proof;
  await sealServingV4Fixture(env.SERVING_DB, fixture.v4);
  const authority = mintModelSlugLifecycleAuthorityV5({
    archiveProof: fixture.archiveProof,
    operationalArchiveProof: operationalArchive,
    operationalServingProof: operationalServing,
    servingProof: fixture.servingProof,
  });
  await applyReadinessCommitV5(
    env.SERVING_DB,
    authority,
    fixture.readinessCommit,
  );
  return Object.freeze({ fixture, authority, operationalArchive });
};

const readyRecord = (prepared: ReadyPrepared): PublicationRecord => {
  const readiness = readServingReadinessCommitPersistenceV5(
    prepared.fixture.readinessCommit,
  );
  return Object.freeze({
    publicationId: prepared.fixture.v4.base.manifest.publicationId,
    closureHash: prepared.fixture.v4.base.manifest.closureHash,
    state: "ready",
    generatedAt: prepared.fixture.v4.base.manifest.generatedAt,
    readyAt: new Date(readiness.transition.ready_at_ms).toISOString(),
    firstActivatedAt: null,
    lastHeadReferencedAt: null,
  });
};

const projectActivation = async (
  prepared: ReadyPrepared,
  switchedAtMs: number,
  currentHead: StoredPublicationHead | null = null,
  currentActive: PublicationRecord | null = null,
  observedAtMs = switchedAtMs - 1_000,
  maximumAgeMs = 60 * 60_000,
) => {
  const { fixture } = prepared;
  const readiness = readServingReadinessCommitPersistenceV5(
    fixture.readinessCommit,
  );
  const provider = readProviderSearchStagingPersistenceV2(
    fixture.v4.providerStaging,
  );
  const providerModelIds = readProviderModelIdSearchStagingPersistenceV1(
    fixture.v4.providerModelIdStaging,
  );
  const preflight = await projectServingSwitchPreflightProofV5({
    manifest: fixture.v4.base.manifest,
    providerProof: fixture.v4.providerProof,
    modelVariantNameProof: fixture.v4.modelProof,
    providerModelIdProof: fixture.v4.providerModelIdProof,
    modelSlugArchiveProof: fixture.archiveProof,
    modelSlugServingProof: fixture.servingProof,
    readinessProof: fixture.readinessProof,
    rollbackArchiveReceiptHash: null,
    context: {
      switchId: `publication-switch|activate|${String((currentHead?.generation ?? 0) + 1)}|${fixture.v4.base.manifest.publicationId}|${fixture.v4.base.manifest.closureHash}`,
      action: "activate",
      expectedPriorGeneration: currentHead?.generation ?? 0,
      expectedPriorRollbackCandidatePublicationId:
        currentHead?.rollbackCandidatePublicationId ?? null,
      expectedPriorSwitchedAtMs:
        currentHead === null ? null : Date.parse(currentHead.switchedAt),
      newGeneration: (currentHead?.generation ?? 0) + 1,
      fromPublicationId: currentActive?.publicationId ?? null,
      fromClosureHash: currentActive?.closureHash ?? null,
      toPublicationId: fixture.v4.base.manifest.publicationId,
      toClosureHash: fixture.v4.base.manifest.closureHash,
      switchedAtMs,
    },
    artifactProof: artifactProof(fixture, observedAtMs, maximumAgeMs),
  });
  return projectServingSwitchV5({
    preflight,
    target: readyRecord(prepared),
    currentHead,
    currentActive,
    authorizedBy: { kind: "pipeline", identityId: "pipeline.switch-v5" },
    closureRows: fixture.v4.base.closureRows,
    persistedSeal: fixture.v4.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: fixture.v4.base.persistence.rows,
    persistedProviderModelIdRows: providerModelIds.rows,
    persistedModelSlugArtifactProof: fixture.modelSlugArtifactProof,
    persistedModelSlugMappings: fixture.modelSlugMappings,
    persistedReceiptRows: readiness.receiptRows,
    persistedAttestation: readiness.attestation,
  });
};

const projectRollback = async (
  target: ReadyPrepared,
  currentHead: StoredPublicationHead,
  targetRecord: PublicationRecord,
  defectiveRecord: PublicationRecord,
  switchedAtMs: number,
  freshProof: TrustedFreshModelSlugRollbackProof,
) => {
  const { fixture } = target;
  const readiness = readServingReadinessCommitPersistenceV5(
    fixture.readinessCommit,
  );
  const provider = readProviderSearchStagingPersistenceV2(
    fixture.v4.providerStaging,
  );
  const providerModelIds = readProviderModelIdSearchStagingPersistenceV1(
    fixture.v4.providerModelIdStaging,
  );
  const preflight = await projectServingSwitchPreflightProofV5({
    manifest: fixture.v4.base.manifest,
    providerProof: fixture.v4.providerProof,
    modelVariantNameProof: fixture.v4.modelProof,
    providerModelIdProof: fixture.v4.providerModelIdProof,
    modelSlugArchiveProof: fixture.archiveProof,
    modelSlugServingProof: fixture.servingProof,
    readinessProof: null,
    rollbackArchiveReceiptHash: readiness.attestation.archive_receipt_hash,
    context: {
      switchId: `publication-switch|rollback|${String(currentHead.generation + 1)}|${fixture.v4.base.manifest.publicationId}|${fixture.v4.base.manifest.closureHash}`,
      action: "rollback",
      expectedPriorGeneration: currentHead.generation,
      expectedPriorRollbackCandidatePublicationId:
        currentHead.rollbackCandidatePublicationId,
      expectedPriorSwitchedAtMs: Date.parse(currentHead.switchedAt),
      newGeneration: currentHead.generation + 1,
      fromPublicationId: defectiveRecord.publicationId,
      fromClosureHash: defectiveRecord.closureHash,
      toPublicationId: targetRecord.publicationId,
      toClosureHash: targetRecord.closureHash,
      switchedAtMs,
    },
    artifactProof: artifactProof(
      fixture,
      freshProof.observedAtMs,
      freshProof.maximumAgeMs,
    ),
  });
  return projectServingSwitchV5({
    preflight,
    target: targetRecord,
    currentHead,
    currentActive: defectiveRecord,
    authorizedBy: { kind: "operator", identityId: "operator.rollback-v5" },
    closureRows: fixture.v4.base.closureRows,
    persistedSeal: fixture.v4.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: fixture.v4.base.persistence.rows,
    persistedProviderModelIdRows: providerModelIds.rows,
    persistedModelSlugArtifactProof: fixture.modelSlugArtifactProof,
    persistedModelSlugMappings: fixture.modelSlugMappings,
    persistedReceiptRows: null,
    persistedAttestation: null,
  });
};

const prepare = async (sequence: number): Promise<Prepared> => {
  const prepared = await prepareReady(sequence);
  const projection = await projectActivation(prepared, Date.now() - 1_000);
  return Object.freeze({ ...prepared, projection });
};

const lifecycleRecord = (
  prepared: ReadyPrepared,
  state: "active" | "superseded" | "rolled_back",
  firstActivatedAtMs: number,
): PublicationRecord =>
  Object.freeze({
    ...readyRecord(prepared),
    state,
    firstActivatedAt: new Date(firstActivatedAtMs).toISOString(),
    lastHeadReferencedAt: new Date(firstActivatedAtMs).toISOString(),
  });

const head = (
  active: ReadyPrepared,
  rollbackCandidate: ReadyPrepared | null,
  switchedAtMs: number,
  generation: number,
): StoredPublicationHead =>
  Object.freeze({
    activePublicationId: active.fixture.v4.base.manifest.publicationId,
    rollbackCandidatePublicationId:
      rollbackCandidate?.fixture.v4.base.manifest.publicationId ?? null,
    switchedAt: new Date(switchedAtMs).toISOString(),
    generation,
  });

const verifyFreshRollback = (
  prepared: ReadyPrepared,
  observedAtMs: number,
  maximumAgeMs: number,
): Promise<TrustedFreshModelSlugRollbackProof> =>
  verifyArchivedModelSlugHistoryForRollback(
    {
      get: archiveBucket.get.bind(archiveBucket),
    },
    {
      manifest: prepared.fixture.v4.base.manifest,
      resources: prepared.fixture.v4.base.closureRows.resources.filter(
        (resource) => resource.resource_type === "model",
      ),
    },
    prepared.fixture.archiveProof,
    { observedAtMs, maximumAgeMs },
  );

const readHead = () =>
  env.SERVING_DB.prepare(
    `SELECT active_publication_id, rollback_candidate_publication_id,
      switched_at_ms, generation
     FROM publication_head WHERE singleton = 1`,
  ).first<{
    active_publication_id: string;
    rollback_candidate_publication_id: string | null;
    switched_at_ms: number;
    generation: number;
  }>();

const withLostSwitchResponse = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          const result = await session.batch(statements);
          if (!injected && statements.length === 6) {
            injected = true;
            throw new Error("simulated lost switch response");
          }
          return result;
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withBroadenedIndexPredicateBeforeSwitchBatch = (
  database: D1Database,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          if (!injected && statements.length === 6) {
            injected = true;
            await database.exec(`
              DROP INDEX publication_model_slug_current_model_idx;
              CREATE UNIQUE INDEX publication_model_slug_current_model_idx
              ON publication_model_slug_mapping(publication_id, model_id)
              WHERE resolution = 'current' OR resolution = 'CURRENT';
            `);
          }
          return session.batch(statements);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withAbortedSwitchStatement = (
  database: D1Database,
  ordinal: number,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        batch(statements: D1PreparedStatement[]) {
          if (injected || statements.length !== 6)
            return session.batch(statements);
          injected = true;
          return session.batch([
            ...statements.slice(0, ordinal),
            session.prepare("SELECT json('')"),
            ...statements.slice(ordinal + 1),
          ]);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withHostileMappingPage = (
  database: D1Database,
  kind: "revoked" | "sparse" | "getter" | "oversize" | "proxy-get-trap",
  onGetTrap: () => void = () => undefined,
): D1Database =>
  ({
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          const result = await session.batch(statements);
          const first = result[0]?.results[0] as
            Readonly<Record<string, unknown>> | undefined;
          if (first?.target_resource_type !== "model") return result;
          if (kind === "revoked") {
            const revoked = Proxy.revocable(result, {});
            revoked.revoke();
            return revoked.proxy;
          }
          if (kind === "sparse") return new Array(1) as typeof result;
          if (kind === "getter") {
            const hostile: unknown[] = [];
            Object.defineProperty(hostile, "0", {
              enumerable: true,
              get() {
                throw new Error("getter must not execute");
              },
            });
            hostile.length = 1;
            return hostile as typeof result;
          }
          if (kind === "proxy-get-trap") {
            const hostileRow = new Proxy(first, {
              get() {
                onGetTrap();
                throw new Error("get trap must not execute");
              },
              ownKeys(target) {
                return [...Reflect.ownKeys(target), "unexpected"];
              },
            });
            return [
              {
                ...result[0],
                results: [hostileRow],
              },
            ] as typeof result;
          }
          return [
            {
              ...result[0],
              results: new Array(258).fill(first),
            },
          ] as typeof result;
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  }) as D1Database;

const withHostileHeadRow = (
  database: D1Database,
  onGetTrap: () => void,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          const result = await session.batch(statements);
          const row = result[0]?.results[0] as
            Readonly<Record<string, unknown>> | undefined;
          if (injected || statements.length !== 5 || row === undefined)
            return result;
          injected = true;
          const hostileRow = new Proxy(row, {
            get() {
              onGetTrap();
              throw new Error("get trap must not execute");
            },
            ownKeys(target) {
              return [...Reflect.ownKeys(target), "unexpected"];
            },
          });
          return [
            { ...result[0], results: [hostileRow] },
            ...result.slice(1),
          ] as typeof result;
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
});

describe("schema-1.13 Model-slug-bound serving switch", () => {
  it("reconciles activation, revalidates idempotently, and stores all 88 preflight columns", async () => {
    const prepared = await prepare(1);
    const publicationId = prepared.fixture.v4.base.manifest.publicationId;
    const originalModel = await env.SERVING_DB.prepare(
      `SELECT resource_id, resource_json FROM publication_resource
       WHERE publication_id = ?1 AND resource_type = 'model' LIMIT 1`,
    )
      .bind(publicationId)
      .first<{ resource_id: string; resource_json: string }>();
    if (originalModel === null)
      throw new Error("activation fixture lacks Model");
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_resource_immutable_update",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        `UPDATE publication_resource SET resource_json = json_set(
           resource_json, '$.publisher.value', 'admission-corruption'
         ) WHERE publication_id = ?1 AND resource_type = 'model'
           AND resource_id = ?2`,
      )
        .bind(publicationId, originalModel.resource_id)
        .run();
      await expect(
        applyServingSwitchV5(
          env.SERVING_DB,
          prepared.authority,
          null,
          prepared.projection,
        ),
      ).rejects.toEqual(new ServingSwitchError("integrity_failure"));
      await expect(readHead()).resolves.toBeNull();
    } finally {
      await env.SERVING_DB.prepare(
        `UPDATE publication_resource SET resource_json = ?3
         WHERE publication_id = ?1 AND resource_type = 'model'
           AND resource_id = ?2`,
      )
        .bind(
          publicationId,
          originalModel.resource_id,
          originalModel.resource_json,
        )
        .run();
      await env.SERVING_DB.prepare(
        `CREATE TRIGGER publication_resource_immutable_update
         BEFORE UPDATE ON publication_resource
         BEGIN SELECT RAISE(ABORT, 'publication resource is immutable'); END`,
      ).run();
    }
    await expect(
      applyServingSwitchV5(
        env.SERVING_DB,
        prepared.authority,
        prepared.fixture.archiveProof,
        prepared.projection,
      ),
    ).rejects.toEqual(new ServingSwitchError("integrity_failure"));
    for (let ordinal = 0; ordinal < 6; ordinal += 1) {
      await expect(
        applyServingSwitchV5(
          withAbortedSwitchStatement(env.SERVING_DB, ordinal),
          prepared.authority,
          null,
          prepared.projection,
        ),
      ).rejects.toEqual(new ServingSwitchError("not_applied"));
      await expect(
        env.SERVING_DB.prepare(
          "SELECT state FROM publication WHERE publication_id = ?",
        )
          .bind(prepared.fixture.v4.base.manifest.publicationId)
          .first(),
      ).resolves.toEqual({ state: "ready" });
    }
    await expect(
      applyServingSwitchV5(
        withLostSwitchResponse(env.SERVING_DB),
        prepared.authority,
        null,
        prepared.projection,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success", generation: 1 });
    await expect(
      applyServingSwitchV5(
        env.SERVING_DB,
        prepared.authority,
        null,
        prepared.projection,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    activated = prepared;
    await expect(
      env.SERVING_DB.prepare(
        "SELECT count(*) AS column_count FROM pragma_table_info('publication_switch_preflight')",
      ).first(),
    ).resolves.toEqual({ column_count: 88 });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT preflight_version, archive_model_slug_artifact_digest,
          serving_model_slug_artifact_digest, model_slug_lookup_passed
         FROM publication_switch_preflight WHERE new_generation = 1`,
      ).first(),
    ).resolves.toMatchObject({
      preflight_version: "5.0.0",
      archive_model_slug_artifact_digest:
        prepared.fixture.archiveProof.artifact_digest,
      serving_model_slug_artifact_digest:
        prepared.fixture.servingProof.artifact_digest,
      model_slug_lookup_passed: 1,
    });
  });

  it.each([
    "revoked",
    "sparse",
    "getter",
    "oversize",
    "proxy-get-trap",
  ] as const)("normalizes a hostile %s mapping-page result", async (kind) => {
    if (activated === undefined)
      throw new Error("activation prerequisite missing");
    let getTrapCalls = 0;
    await expect(
      applyServingSwitchV5(
        withHostileMappingPage(env.SERVING_DB, kind, () => {
          getTrapCalls += 1;
        }),
        activated.authority,
        null,
        activated.projection,
      ),
    ).rejects.toEqual(
      new ServingSwitchError(
        kind === "revoked" ? "outcome_unknown" : "integrity_failure",
      ),
    );
    expect(getTrapCalls).toBe(0);
    await expect(
      env.SERVING_DB.prepare(
        "SELECT generation FROM publication_head WHERE singleton = 1",
      ).first(),
    ).resolves.toEqual({ generation: 1 });
  });

  it("rejects a hostile head-row get trap without invoking it", async () => {
    if (activated === undefined)
      throw new Error("activation prerequisite missing");
    let getTrapCalls = 0;
    await expect(
      applyServingSwitchV5(
        withHostileHeadRow(env.SERVING_DB, () => {
          getTrapCalls += 1;
        }),
        activated.authority,
        null,
        activated.projection,
      ),
    ).rejects.toEqual(new ServingSwitchError("integrity_failure"));
    expect(getTrapCalls).toBe(0);
    await expect(readHead()).resolves.toMatchObject({ generation: 1 });
  });

  it("rejects a raw core proof as mutation authority", async () => {
    const prepared = await prepare(20);
    await expect(
      applyServingSwitchV5(
        env.SERVING_DB,
        prepared.fixture.archiveProof,
        null,
        prepared.projection,
      ),
    ).rejects.toEqual(new ServingSwitchError("integrity_failure"));
  });

  it("displaces A to B to C, requires fresh exact rollback authority, and supports zero-Model activation", async () => {
    if (activated === undefined)
      throw new Error("activation prerequisite missing");
    const publicationA = activated;
    const activationA = readServingSwitchPersistenceV5(publicationA.projection)
      .preflight.switched_at_ms;
    const activeA = lifecycleRecord(publicationA, "active", activationA);
    const headA = head(publicationA, null, activationA, 1);

    const publicationB = await prepareReady(21);
    const activationB = activationA + 1;
    const projectionB = await projectActivation(
      publicationB,
      activationB,
      headA,
      activeA,
    );
    await expect(
      applyServingSwitchV5(
        env.SERVING_DB,
        publicationB.authority,
        null,
        projectionB,
      ),
    ).resolves.toMatchObject({ outcome: "applied", generation: 2 });

    const activeB = lifecycleRecord(publicationB, "active", activationB);
    const headB = head(publicationB, publicationA, activationB, 2);
    const publicationC = await prepareReady(22);
    const activationC = activationB + 1;
    const projectionC = await projectActivation(
      publicationC,
      activationC,
      headB,
      activeB,
    );
    await expect(
      applyServingSwitchV5(
        env.SERVING_DB,
        publicationC.authority,
        null,
        projectionC,
      ),
    ).resolves.toMatchObject({ outcome: "applied", generation: 3 });

    const activeC = lifecycleRecord(publicationC, "active", activationC);
    const supersededB = lifecycleRecord(
      publicationB,
      "superseded",
      activationB,
    );
    const headC = head(publicationC, publicationB, activationC, 3);
    const expectedHeadC = {
      active_publication_id:
        publicationC.fixture.v4.base.manifest.publicationId,
      rollback_candidate_publication_id:
        publicationB.fixture.v4.base.manifest.publicationId,
      switched_at_ms: activationC,
      generation: 3,
    };
    await expect(readHead()).resolves.toEqual(expectedHeadC);
    await expect(
      env.SERVING_DB.prepare(
        "SELECT state FROM publication WHERE publication_id = ?",
      )
        .bind(publicationA.fixture.v4.base.manifest.publicationId)
        .first(),
    ).resolves.toEqual({ state: "superseded" });
    await expect(
      auditServeableModelDetailPublications(env.SERVING_DB),
    ).resolves.toMatchObject({
      modelCount: 3,
      outcome: "passed",
      publicationCount: 3,
    });

    const expiredObservedAt = activationC + 1;
    const expiredFresh = await verifyFreshRollback(
      publicationB,
      expiredObservedAt,
      0,
    );
    const expiredRollback = await projectRollback(
      publicationB,
      headC,
      supersededB,
      activeC,
      expiredObservedAt,
      expiredFresh,
    );
    await expect(
      applyServingSwitchV5(
        env.SERVING_DB,
        publicationB.authority,
        expiredFresh,
        expiredRollback,
      ),
    ).rejects.toEqual(new ServingSwitchError("stale"));
    await expect(readHead()).resolves.toEqual(expectedHeadC);

    const rollbackAt = Math.max(Date.now(), activationC + 2);
    const freshRollback = await verifyFreshRollback(
      publicationB,
      rollbackAt,
      60 * 60_000,
    );
    const rollback = await projectRollback(
      publicationB,
      headC,
      supersededB,
      activeC,
      rollbackAt,
      freshRollback,
    );
    const mismatchedFresh = await verifyFreshRollback(
      publicationA,
      rollbackAt,
      60 * 60_000,
    );
    for (const rejected of [
      null,
      publicationB.operationalArchive,
      { ...freshRollback },
      mismatchedFresh,
    ]) {
      await expect(
        applyServingSwitchV5(
          env.SERVING_DB,
          publicationB.authority,
          rejected,
          rollback,
        ),
      ).rejects.toEqual(new ServingSwitchError("integrity_failure"));
      await expect(readHead()).resolves.toEqual(expectedHeadC);
    }

    const historical = await env.SERVING_DB.prepare(
      `SELECT slug FROM publication_model_slug_mapping
       WHERE publication_id = ? AND resolution = 'historical' LIMIT 1`,
    )
      .bind(publicationB.fixture.v4.base.manifest.publicationId)
      .first<{ slug: string }>();
    if (historical === null)
      throw new Error("rollback fixture lacks a historical slug");
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_model_slug_mapping_immutable_update",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        `UPDATE publication_model_slug_mapping SET slug = ?
         WHERE publication_id = ? AND slug = ?`,
      )
        .bind(
          `corrupt-${historical.slug}`,
          publicationB.fixture.v4.base.manifest.publicationId,
          historical.slug,
        )
        .run();
      await expect(
        applyServingSwitchV5(
          env.SERVING_DB,
          publicationB.authority,
          freshRollback,
          rollback,
        ),
      ).rejects.toEqual(new ServingSwitchError("integrity_failure"));
      await expect(readHead()).resolves.toEqual(expectedHeadC);
    } finally {
      await env.SERVING_DB.prepare(
        `UPDATE publication_model_slug_mapping SET slug = ?
         WHERE publication_id = ? AND slug = ?`,
      )
        .bind(
          historical.slug,
          publicationB.fixture.v4.base.manifest.publicationId,
          `corrupt-${historical.slug}`,
        )
        .run();
      await env.SERVING_DB.prepare(
        `CREATE TRIGGER publication_model_slug_mapping_immutable_update
         BEFORE UPDATE ON publication_model_slug_mapping
         BEGIN SELECT RAISE(ABORT, 'publication Model slug mapping is immutable'); END`,
      ).run();
    }

    try {
      await expect(
        applyServingSwitchV5(
          withBroadenedIndexPredicateBeforeSwitchBatch(env.SERVING_DB),
          publicationB.authority,
          freshRollback,
          rollback,
        ),
      ).rejects.toEqual(new ServingSwitchError("not_applied"));
      await expect(readHead()).resolves.toEqual(expectedHeadC);
    } finally {
      await env.SERVING_DB.prepare(
        "DROP INDEX publication_model_slug_current_model_idx",
      ).run();
      await env.SERVING_DB.prepare(
        `CREATE UNIQUE INDEX publication_model_slug_current_model_idx
         ON publication_model_slug_mapping(publication_id, model_id)
         WHERE resolution = 'current'`,
      ).run();
    }

    for (let ordinal = 0; ordinal < 6; ordinal += 1) {
      await expect(
        applyServingSwitchV5(
          withAbortedSwitchStatement(env.SERVING_DB, ordinal),
          publicationB.authority,
          freshRollback,
          rollback,
        ),
      ).rejects.toEqual(new ServingSwitchError("not_applied"));
      await expect(readHead()).resolves.toEqual(expectedHeadC);
    }
    await expect(
      applyServingSwitchV5(
        withLostSwitchResponse(env.SERVING_DB),
        publicationB.authority,
        freshRollback,
        rollback,
      ),
    ).resolves.toMatchObject({
      outcome: "idempotent_success",
      generation: 4,
    });
    const headAfterRollback = head(publicationB, publicationC, rollbackAt, 4);
    await expect(readHead()).resolves.toEqual({
      active_publication_id:
        publicationB.fixture.v4.base.manifest.publicationId,
      rollback_candidate_publication_id:
        publicationC.fixture.v4.base.manifest.publicationId,
      switched_at_ms: rollbackAt,
      generation: 4,
    });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT state, activated_at_ms FROM publication
         WHERE publication_id = ?`,
      )
        .bind(publicationB.fixture.v4.base.manifest.publicationId)
        .first(),
    ).resolves.toEqual({ state: "active", activated_at_ms: activationB });
    await expect(
      env.SERVING_DB.prepare(
        "SELECT state FROM publication WHERE publication_id = ?",
      )
        .bind(publicationC.fixture.v4.base.manifest.publicationId)
        .first(),
    ).resolves.toEqual({ state: "rolled_back" });

    const zeroModel = await prepareReady(23, true);
    const zeroActivationAt = rollbackAt + 1;
    const zeroProjection = await projectActivation(
      zeroModel,
      zeroActivationAt,
      headAfterRollback,
      lifecycleRecord(publicationB, "active", activationB),
    );
    await expect(
      applyServingSwitchV5(
        env.SERVING_DB,
        zeroModel.authority,
        null,
        zeroProjection,
      ),
    ).resolves.toMatchObject({ outcome: "applied", generation: 5 });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT count(*) AS count FROM publication_model_slug_mapping
         WHERE publication_id = ?`,
      )
        .bind(zeroModel.fixture.v4.base.manifest.publicationId)
        .first(),
    ).resolves.toEqual({ count: 0 });

    const paged = await prepareReady(25, false, 130);
    const pagedActivationAt = zeroActivationAt + 1;
    const pagedProjection = await projectActivation(
      paged,
      pagedActivationAt,
      head(zeroModel, publicationB, zeroActivationAt, 5),
      lifecycleRecord(zeroModel, "active", zeroActivationAt),
    );
    await expect(
      applyServingSwitchV5(
        env.SERVING_DB,
        paged.authority,
        null,
        pagedProjection,
      ),
    ).resolves.toMatchObject({ outcome: "applied", generation: 6 });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT count(*) AS count FROM publication_model_slug_mapping
         WHERE publication_id = ?`,
      )
        .bind(paged.fixture.v4.base.manifest.publicationId)
        .first(),
    ).resolves.toEqual({ count: 260 });

    const expiredActivationTarget = await prepareReady(24);
    const expiredActivationAt = pagedActivationAt + 1;
    const expiredActivation = await projectActivation(
      expiredActivationTarget,
      expiredActivationAt,
      head(paged, zeroModel, pagedActivationAt, 6),
      lifecycleRecord(paged, "active", pagedActivationAt),
      expiredActivationAt,
      0,
    );
    const delayMs = Math.max(0, expiredActivationAt - Date.now() + 1_100);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await expect(
      applyServingSwitchV5(
        env.SERVING_DB,
        expiredActivationTarget.authority,
        null,
        expiredActivation,
      ),
    ).rejects.toEqual(new ServingSwitchError("stale"));
    await expect(readHead()).resolves.toEqual({
      active_publication_id: paged.fixture.v4.base.manifest.publicationId,
      rollback_candidate_publication_id:
        zeroModel.fixture.v4.base.manifest.publicationId,
      switched_at_ms: pagedActivationAt,
      generation: 6,
    });
  });
});
