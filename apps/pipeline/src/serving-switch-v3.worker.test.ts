import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  projectServingSwitchPreflightProofV3,
  projectServingSwitchV3,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV3,
  type PublicationRecord,
  type ServingSwitchProjectionV3,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

import { applyModelVariantNameSearchStagingV1 } from "./model-variant-name-search-staging.js";
import { applyProviderSearchStagingV2 } from "./provider-search-staging.js";
import { applyReadinessCommitV3 } from "./readiness-commit-v3.js";
import { applyServingSwitchV3 } from "./serving-switch.js";
import {
  createServingV3Fixture,
  sealServingV3Fixture,
  type ServingV3Fixture,
} from "../test/serving-switch-v3-fixture.js";
import { seedModelVariantNameSearchBuildingPublication } from "../test/model-variant-name-search-fixture.js";

const PUBLICATION_A = "pub_cccccccc-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_cccccccc-0000-4000-8000-000000000002" as const;
const PUBLICATION_C = "pub_cccccccc-0000-4000-8000-000000000003" as const;

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
  vectorMutationId: `workerd-v3-${fixture.base.manifest.publicationId}`,
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
    authorizedBy: { kind: "pipeline", identityId: "pipeline.workerd-v3" },
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
  head: StoredPublicationHead,
  active: PublicationRecord,
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
      switchId: `publication-switch|rollback|${String(head.generation + 1)}|${target.base.manifest.publicationId}|${target.base.manifest.closureHash}`,
      action: "rollback",
      expectedPriorGeneration: head.generation,
      expectedPriorRollbackCandidatePublicationId:
        head.rollbackCandidatePublicationId,
      expectedPriorSwitchedAtMs: Date.parse(head.switchedAt),
      newGeneration: head.generation + 1,
      fromPublicationId: active.publicationId,
      fromClosureHash: active.closureHash,
      toPublicationId: target.base.manifest.publicationId,
      toClosureHash: target.base.manifest.closureHash,
      switchedAtMs,
    },
    artifactProof: artifactProof(target, switchedAtMs - 1_000),
  });
  return projectServingSwitchV3({
    preflight,
    target: record(target, "superseded", targetFirstActivatedAt),
    currentHead: head,
    currentActive: active,
    authorizedBy: { kind: "operator", identityId: "operator.workerd-v3" },
    closureRows: target.base.closureRows,
    persistedSeal: target.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: target.base.persistence.rows,
    persistedReceiptRows: null,
    persistedAttestation: null,
  });
};

const prepareReady = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
): Promise<ServingV3Fixture> => {
  const fixture = await createServingV3Fixture(publicationId, generatedAtMs);
  await seedModelVariantNameSearchBuildingPublication(
    env.SERVING_DB,
    fixture.base,
  );
  await applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging);
  await applyModelVariantNameSearchStagingV1(
    env.SERVING_DB,
    fixture.base.staging,
  );
  await sealServingV3Fixture(env.SERVING_DB, fixture);
  await applyReadinessCommitV3(env.SERVING_DB, fixture.readinessCommit);
  return fixture;
};

const withAbortAfter = (database: D1Database, ordinal: number): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        batch(statements: D1PreparedStatement[]) {
          if (injected || statements.length !== 3)
            return session.batch(statements);
          injected = true;
          return session.batch([
            ...statements.slice(0, ordinal),
            session.prepare("SELECT json('')"),
            ...statements.slice(ordinal),
          ]);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withLostResponse = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          const results = await session.batch(statements);
          if (!injected && statements.length === 3) {
            injected = true;
            throw new Error("simulated private response loss");
          }
          return results;
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withProjectionCorruption = (
  database: D1Database,
  publicationId: string,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          if (!injected && statements.length === 3) {
            injected = true;
            await database
              .prepare(
                "DROP TRIGGER publication_model_variant_name_search_document_immutable_update",
              )
              .run();
            await database
              .prepare(
                "UPDATE publication_model_variant_name_search_document SET display_name_utf8 = X'78' WHERE publication_id = ?",
              )
              .bind(publicationId)
              .run();
            await database
              .prepare(
                `CREATE TRIGGER publication_model_variant_name_search_document_immutable_update
                 BEFORE UPDATE ON publication_model_variant_name_search_document
                 BEGIN SELECT RAISE(ABORT, 'model/variant name search document is immutable'); END`,
              )
              .run();
          }
          return session.batch(statements);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const one = async <T>(sql: string): Promise<T> => {
  const row = await env.SERVING_DB.prepare(sql).first<T>();
  if (row === null) throw new Error("expected a D1 row");
  return row;
};

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
});

let lastKnownGoodFixture: ServingV3Fixture;
let lastKnownGoodHead: StoredPublicationHead;
let lastKnownGoodActive: PublicationRecord;
let pendingProjection: ServingSwitchProjectionV3;

describe("schema-1.6 serving switch v3 in pinned workerd", () => {
  it("activates, replaces, and immediately rolls back while preserving last-known-good head", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixtureA = await prepareReady(PUBLICATION_A, now - 25 * 60_000);
    const switchedA = now - 4 * 60_000;
    const first = await activation(fixtureA, switchedA);
    await expect(
      applyServingSwitchV3(withLostResponse(env.SERVING_DB), first),
    ).resolves.toMatchObject({ outcome: "idempotent_success", generation: 1 });

    const fixtureB = await prepareReady(PUBLICATION_B, now - 18 * 60_000);
    const headA: StoredPublicationHead = {
      activePublicationId: PUBLICATION_A,
      rollbackCandidatePublicationId: null,
      switchedAt: new Date(switchedA).toISOString(),
      generation: 1,
    };
    const switchedB = now - 2 * 60_000;
    const second = await activation(
      fixtureB,
      switchedB,
      headA,
      record(fixtureA, "active", headA.switchedAt),
    );
    await expect(
      applyServingSwitchV3(env.SERVING_DB, second),
    ).resolves.toMatchObject({ outcome: "applied", generation: 2 });

    const headB: StoredPublicationHead = {
      activePublicationId: PUBLICATION_B,
      rollbackCandidatePublicationId: PUBLICATION_A,
      switchedAt: new Date(switchedB).toISOString(),
      generation: 2,
    };
    const rollbackProjection = await rollback(
      fixtureA,
      headA.switchedAt,
      headB,
      record(fixtureB, "active", headB.switchedAt),
      now - 60_000,
    );
    await expect(
      applyServingSwitchV3(env.SERVING_DB, rollbackProjection),
    ).resolves.toMatchObject({ outcome: "applied", generation: 3 });
    lastKnownGoodFixture = fixtureA;
    lastKnownGoodHead = {
      activePublicationId: PUBLICATION_A,
      rollbackCandidatePublicationId: PUBLICATION_B,
      switchedAt: new Date(now - 60_000).toISOString(),
      generation: 3,
    };
    lastKnownGoodActive = {
      ...record(fixtureA, "active", headA.switchedAt),
      lastHeadReferencedAt: lastKnownGoodHead.switchedAt,
    };
    await expect(
      one<{
        active_publication_id: string;
        rollback_candidate_publication_id: string;
        generation: number;
      }>(
        "SELECT active_publication_id, rollback_candidate_publication_id, generation FROM publication_head WHERE singleton = 1",
      ),
    ).resolves.toEqual({
      active_publication_id: PUBLICATION_A,
      rollback_candidate_publication_id: PUBLICATION_B,
      generation: 3,
    });
  });

  it("rolls back the whole transaction at every failure position", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await prepareReady(PUBLICATION_C, now - 15 * 60_000);
    const projection = await activation(
      fixture,
      now - 30_000,
      lastKnownGoodHead,
      lastKnownGoodActive,
    );
    pendingProjection = projection;
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await expect(
        applyServingSwitchV3(
          withAbortAfter(env.SERVING_DB, ordinal),
          projection,
        ),
      ).rejects.toMatchObject({
        code: "not_applied",
        retrySameProjection: true,
      });
      await expect(
        one<{ count: number }>(
          `SELECT count(*) AS count FROM publication_head
           WHERE active_publication_id = '${PUBLICATION_C}'`,
        ),
      ).resolves.toEqual({ count: 0 });
      await expect(
        one<{
          active_publication_id: string;
          rollback_candidate_publication_id: string;
          generation: number;
        }>(
          "SELECT active_publication_id, rollback_candidate_publication_id, generation FROM publication_head WHERE singleton = 1",
        ),
      ).resolves.toEqual({
        active_publication_id: lastKnownGoodFixture.base.manifest.publicationId,
        rollback_candidate_publication_id: PUBLICATION_B,
        generation: 3,
      });
    }
  });

  it("detects model BLOB corruption between gates and leaves the head unchanged", async () => {
    await expect(
      applyServingSwitchV3(
        withProjectionCorruption(env.SERVING_DB, PUBLICATION_C),
        pendingProjection,
      ),
    ).rejects.toMatchObject({ code: "not_applied", retrySameProjection: true });
    await expect(
      one<{
        active_publication_id: string;
        rollback_candidate_publication_id: string;
        generation: number;
      }>(
        "SELECT active_publication_id, rollback_candidate_publication_id, generation FROM publication_head WHERE singleton = 1",
      ),
    ).resolves.toEqual({
      active_publication_id: PUBLICATION_A,
      rollback_candidate_publication_id: PUBLICATION_B,
      generation: 3,
    });
  });
});
