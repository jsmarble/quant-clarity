import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  projectServingClosureSeal,
  projectServingSwitchPreflightProofV4,
  projectServingSwitchV4,
  readProviderModelIdSearchStagingPersistenceV1,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV4,
  type PublicationRecord,
  type ResourceDescriptor,
  type ServingClosureRows,
  type ServingSwitchProjectionV4,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

import { applyModelVariantNameSearchStagingV1 } from "./model-variant-name-search-staging.js";
import { applyProviderSearchStagingV2 } from "./provider-search-staging.js";
import { applyProviderModelIdSearchStagingV1 } from "./provider-model-id-search-staging.js";
import { applyReadinessCommitV4 } from "./readiness-commit-v4.js";
import { applyServingSwitchV4 } from "./serving-switch.js";
import {
  createServingV4Fixture,
  sealServingV4Fixture,
  type ServingV4Fixture,
} from "../test/serving-switch-v4-fixture.js";
import { seedModelVariantNameSearchBuildingPublication } from "../test/model-variant-name-search-fixture.js";

const PUBLICATION_A = "pub_cccccccc-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_cccccccc-0000-4000-8000-000000000002" as const;
const PUBLICATION_C = "pub_cccccccc-0000-4000-8000-000000000003" as const;
const PUBLICATION_D = "pub_cccccccc-0000-4000-8000-000000000004" as const;
const PUBLICATION_E = "pub_cccccccc-0000-4000-8000-000000000005" as const;
const PUBLICATION_F = "pub_cccccccc-0000-4000-8000-000000000006" as const;
const PUBLICATION_G = "pub_cccccccc-0000-4000-8000-000000000007" as const;

const artifactProof = (
  fixture: ServingV4Fixture,
  observedAtMs: number,
  maximumAgeMs = 60 * 60 * 1_000,
) => ({
  environment: "local" as const,
  observedAtMs,
  maximumAgeMs,
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
  vectorMutationId: `workerd-v4-${fixture.base.manifest.publicationId}`,
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
  maximumAgeMs?: number,
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
    artifactProof: artifactProof(fixture, switchedAtMs - 1_000, maximumAgeMs),
  });
  return projectServingSwitchV4({
    preflight,
    target: record(fixture, "ready"),
    currentHead,
    currentActive,
    authorizedBy: { kind: "pipeline", identityId: "pipeline.workerd-v4" },
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
  head: StoredPublicationHead,
  active: PublicationRecord,
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
  return projectServingSwitchV4({
    preflight,
    target: record(target, "superseded", targetFirstActivatedAt),
    currentHead: head,
    currentActive: active,
    authorizedBy: { kind: "operator", identityId: "operator.workerd-v4" },
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

const prepareReady = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
  includeVariant = false,
): Promise<ServingV4Fixture> => {
  const fixture = await createServingV4Fixture(
    publicationId,
    generatedAtMs,
    undefined,
    includeVariant,
  );
  await seedModelVariantNameSearchBuildingPublication(
    env.SERVING_DB,
    fixture.base,
  );
  await applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging);
  await applyModelVariantNameSearchStagingV1(
    env.SERVING_DB,
    fixture.base.staging,
  );
  await applyProviderModelIdSearchStagingV1(
    env.SERVING_DB,
    fixture.providerModelIdStaging,
  );
  await sealServingV4Fixture(env.SERVING_DB, fixture);
  await applyReadinessCommitV4(env.SERVING_DB, fixture.readinessCommit);
  return fixture;
};

const corruptFamilyMembership = async (
  fixture: ServingV4Fixture,
): Promise<ServingClosureRows> => {
  const rows = fixture.base.closureRows;
  const family = rows.resources.find(
    (resource) => resource.resource_type === "model_family",
  );
  if (family === undefined) throw new Error("fixture lacks a ModelFamily");
  const resourceJson = family.resource_json.replace(
    /"model_ids":\[[^\]]+\]/u,
    '"model_ids":[]',
  );
  if (resourceJson === family.resource_json)
    throw new Error("fixture ModelFamily has no membership to corrupt");
  const contentHash = await hashPublicationResourceContent({
    resourceType: "model_family",
    resourceId: family.resource_id,
    resourceJson,
  });
  const resources = rows.resources.map((resource) =>
    resource === family
      ? { ...resource, resource_json: resourceJson, content_hash: contentHash }
      : resource,
  );
  const descriptors = resources
    .map((resource): ResourceDescriptor => ({
      resourceType:
        resource.resource_type as ResourceDescriptor["resourceType"],
      resourceId: resource.resource_id,
      contentHash: resource.content_hash as ResourceDescriptor["contentHash"],
    }))
    .sort((left, right) => {
      const leftKey = `${left.resourceType}:${left.resourceId}`;
      const rightKey = `${right.resourceType}:${right.resourceId}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const resourceChunks = rows.chunks.filter(
    (chunk) => chunk.kind === "resources",
  );
  if (resourceChunks.length !== 1)
    throw new Error("fixture requires one resource inventory chunk");
  const resourceChunkHash = await hashPublicationResourceChunk(descriptors);
  return {
    ...rows,
    resources,
    chunks: rows.chunks.map((chunk) =>
      chunk.kind === "resources"
        ? { ...chunk, content_hash: resourceChunkHash }
        : chunk,
    ),
  };
};

const withAbortAt = (database: D1Database, ordinal: number): D1Database => {
  let injected = false;
  let fiveStatementBatchCount = 0;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        batch(statements: D1PreparedStatement[]) {
          if (statements.length === 5) fiveStatementBatchCount += 1;
          if (injected || fiveStatementBatchCount !== 2)
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

const withLostResponse = (database: D1Database): D1Database => {
  let injected = false;
  let fiveStatementBatchCount = 0;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          const results = await session.batch(statements);
          if (statements.length === 5) fiveStatementBatchCount += 1;
          if (!injected && fiveStatementBatchCount === 2) {
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
  let fiveStatementBatchCount = 0;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          if (statements.length === 5) fiveStatementBatchCount += 1;
          if (!injected && fiveStatementBatchCount === 2) {
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

const withProviderModelIdCorruptionBeforeSwitchBatch = (
  database: D1Database,
  publicationId: string,
): D1Database => {
  let injected = false;
  let fiveStatementBatchCount = 0;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          if (statements.length === 5) fiveStatementBatchCount += 1;
          if (!injected && fiveStatementBatchCount === 2) {
            injected = true;
            await database
              .prepare(
                "DROP TRIGGER publication_provider_model_id_search_document_immutable_update",
              )
              .run();
            await database
              .prepare(
                `UPDATE publication_provider_model_id_search_document
                 SET normalized_provider_model_id_utf8 = X'03'
                 WHERE publication_id = ? AND offering_id = (
                   SELECT min(offering_id)
                   FROM publication_provider_model_id_search_document
                   WHERE publication_id = ?
                 )`,
              )
              .bind(publicationId, publicationId)
              .run();
            await database
              .prepare(
                `CREATE TRIGGER publication_provider_model_id_search_document_immutable_update
                 BEFORE UPDATE ON publication_provider_model_id_search_document
                 BEGIN SELECT RAISE(ABORT, 'provider model ID search document is immutable'); END`,
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
  await applyD1Migrations(
    env.SERVING_DB,
    env.TEST_MIGRATIONS.filter(
      (migration) => migration.name <= "0015_model_slug_projection.sql",
    ),
  );
});

let lastKnownGoodFixture: ServingV4Fixture;
let lastKnownGoodHead: StoredPublicationHead;
let lastKnownGoodActive: PublicationRecord;
let pendingProjection: ServingSwitchProjectionV4;

describe("legacy v4 serving switch on schema 1.12 in pinned workerd", () => {
  it("activates, replaces, and immediately rolls back while preserving last-known-good head", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixtureA = await prepareReady(PUBLICATION_A, now - 25 * 60_000, true);
    await expect(
      one<{
        document_count: number;
        provider_count: number;
        target_count: number;
        nul_raw_count: number;
        empty_normalized_count: number;
        maximum_normalized_collision: number;
        inactive_stale_count: number;
      }>(
        `SELECT count(*) AS document_count,
          count(DISTINCT projected.provider_id) AS provider_count,
          count(DISTINCT projected.target_resource_type || ':' || projected.target_resource_id) AS target_count,
          sum(CASE WHEN projected.raw_provider_model_id_utf8 = X'00' THEN 1 ELSE 0 END) AS nul_raw_count,
          sum(CASE WHEN length(projected.normalized_provider_model_id_utf8) = 0 THEN 1 ELSE 0 END) AS empty_normalized_count,
          (SELECT max(collision_count) FROM (
            SELECT count(*) AS collision_count
            FROM publication_provider_model_id_search_document
            WHERE publication_id = '${PUBLICATION_A}'
            GROUP BY normalized_provider_model_id_utf8
          )) AS maximum_normalized_collision,
          sum(CASE WHEN json_extract(offering.resource_json, '$.status.value') = 'inactive'
                    AND json_extract(offering.resource_json, '$.stale') = 1
                   THEN 1 ELSE 0 END) AS inactive_stale_count
         FROM publication_provider_model_id_search_document AS projected
         JOIN publication_resource AS offering
           ON offering.publication_id = projected.publication_id
          AND offering.resource_type = 'offering'
          AND offering.resource_id = projected.offering_id
         WHERE projected.publication_id = '${PUBLICATION_A}'`,
      ),
    ).resolves.toEqual({
      document_count: 5,
      provider_count: 1,
      target_count: 1,
      nul_raw_count: 2,
      empty_normalized_count: 1,
      maximum_normalized_collision: 2,
      inactive_stale_count: 2,
    });
    const switchedA = now - 4 * 60_000;
    const first = await activation(fixtureA, switchedA);
    await expect(
      applyServingSwitchV4(withLostResponse(env.SERVING_DB), first),
    ).resolves.toMatchObject({ outcome: "idempotent_success", generation: 1 });
    await expect(
      one<{
        family_count: number;
        model_count: number;
        variant_count: number;
        broken_model_family_count: number;
        extra_family_member_count: number;
        broken_variant_count: number;
      }>(
        `SELECT
          (SELECT count(*) FROM publication_resource
             WHERE publication_id = '${PUBLICATION_A}' AND resource_type = 'model_family') AS family_count,
          (SELECT count(*) FROM publication_resource
             WHERE publication_id = '${PUBLICATION_A}' AND resource_type = 'model') AS model_count,
          (SELECT count(*) FROM publication_resource
             WHERE publication_id = '${PUBLICATION_A}' AND resource_type = 'variant') AS variant_count,
          (SELECT count(*)
             FROM publication_resource AS model
             LEFT JOIN publication_resource AS family
               ON family.publication_id = model.publication_id
              AND family.resource_type = 'model_family'
              AND family.resource_id = json_extract(model.resource_json, '$.family_id')
            WHERE model.publication_id = '${PUBLICATION_A}'
              AND model.resource_type = 'model'
              AND (family.resource_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM json_each(family.resource_json, '$.model_ids') AS member
                WHERE member.value = model.resource_id
              ))) AS broken_model_family_count,
          (SELECT count(*)
             FROM publication_resource AS family,
                  json_each(family.resource_json, '$.model_ids') AS member
             LEFT JOIN publication_resource AS model
               ON model.publication_id = family.publication_id
              AND model.resource_type = 'model'
              AND model.resource_id = member.value
            WHERE family.publication_id = '${PUBLICATION_A}'
              AND family.resource_type = 'model_family'
              AND (model.resource_id IS NULL OR
                   json_extract(model.resource_json, '$.family_id') <> family.resource_id)) AS extra_family_member_count,
          (SELECT count(*)
             FROM publication_resource AS variant
             LEFT JOIN publication_resource AS model
               ON model.publication_id = variant.publication_id
              AND model.resource_type = 'model'
              AND model.resource_id = json_extract(variant.resource_json, '$.model_id')
            WHERE variant.publication_id = '${PUBLICATION_A}'
              AND variant.resource_type = 'variant'
              AND (model.resource_id IS NULL OR
                   json_extract(variant.resource_json, '$.family_id') <>
                   json_extract(model.resource_json, '$.family_id'))) AS broken_variant_count`,
      ),
    ).resolves.toEqual({
      family_count: 1,
      model_count: 1,
      variant_count: 1,
      broken_model_family_count: 0,
      extra_family_member_count: 0,
      broken_variant_count: 0,
    });

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
      applyServingSwitchV4(env.SERVING_DB, second),
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
      applyServingSwitchV4(env.SERVING_DB, rollbackProjection),
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

  it("rejects corrupt canonical family membership before activation and preserves the head", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    type HeadRow = Readonly<{
      active_publication_id: string;
      rollback_candidate_publication_id: string | null;
      generation: number;
    }>;
    const headBefore = await env.SERVING_DB.prepare(
      "SELECT active_publication_id, rollback_candidate_publication_id, generation FROM publication_head WHERE singleton = 1",
    ).first<HeadRow>();
    const fixture = await createServingV4Fixture(
      PUBLICATION_G,
      now - 15 * 60_000,
      undefined,
      true,
    );
    await expect(
      corruptFamilyMembership(fixture).then((rows) =>
        projectServingClosureSeal(rows),
      ),
    ).rejects.toThrow(/family model membership does not close/u);
    await expect(
      one<{ count: number }>(
        `SELECT count(*) AS count FROM publication
         WHERE publication_id = '${PUBLICATION_G}'`,
      ),
    ).resolves.toEqual({ count: 0 });
    await expect(
      env.SERVING_DB.prepare(
        "SELECT active_publication_id, rollback_candidate_publication_id, generation FROM publication_head WHERE singleton = 1",
      ).first<HeadRow>(),
    ).resolves.toEqual(headBefore);
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
    for (let ordinal = 0; ordinal < 5; ordinal += 1) {
      await expect(
        applyServingSwitchV4(withAbortAt(env.SERVING_DB, ordinal), projection),
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
      applyServingSwitchV4(
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

  it("rejects an expired v4 preflight and preserves the last-known-good head", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await prepareReady(PUBLICATION_D, now - 15 * 60_000);
    const projection = await activation(
      fixture,
      now - 30_000,
      lastKnownGoodHead,
      lastKnownGoodActive,
      1_000,
    );
    await expect(
      applyServingSwitchV4(env.SERVING_DB, projection),
    ).rejects.toMatchObject({ code: "stale", retrySameProjection: false });
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

  it("rejects provider-model-ID drift introduced after precheck and preserves the head", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await prepareReady(PUBLICATION_F, now - 15 * 60_000);
    const projection = await activation(
      fixture,
      now - 10_000,
      lastKnownGoodHead,
      lastKnownGoodActive,
    );
    await expect(
      applyServingSwitchV4(
        withProviderModelIdCorruptionBeforeSwitchBatch(
          env.SERVING_DB,
          PUBLICATION_F,
        ),
        projection,
      ),
    ).rejects.toMatchObject({
      code: "integrity_failure",
      retrySameProjection: false,
    });
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

  it("fails closed on dropped indexes and normalized drift without undoing an applied head", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await prepareReady(PUBLICATION_E, now - 15 * 60_000);
    const projection = await activation(
      fixture,
      now - 10_000,
      lastKnownGoodHead,
      lastKnownGoodActive,
    );
    await expect(
      applyServingSwitchV4(env.SERVING_DB, projection),
    ).resolves.toMatchObject({ outcome: "applied", generation: 4 });

    await env.SERVING_DB.prepare(
      "DROP INDEX publication_provider_model_id_raw_exact_idx",
    ).run();
    try {
      await expect(
        applyServingSwitchV4(env.SERVING_DB, projection),
      ).rejects.toMatchObject({
        code: "outcome_unknown",
        retrySameProjection: false,
      });
    } finally {
      await env.SERVING_DB.prepare(
        `CREATE INDEX publication_provider_model_id_raw_exact_idx
         ON publication_provider_model_id_search_document(
           publication_id, raw_provider_model_id_utf8, offering_id
         )`,
      ).run();
    }

    await env.SERVING_DB.prepare(
      "DROP INDEX publication_provider_model_id_raw_exact_idx",
    ).run();
    await env.SERVING_DB.prepare(
      `CREATE INDEX publication_provider_model_id_raw_exact_idx
       ON publication_provider_model_id_search_document(
         publication_id, offering_id, raw_provider_model_id_utf8
       )`,
    ).run();
    try {
      await expect(
        applyServingSwitchV4(env.SERVING_DB, projection),
      ).rejects.toMatchObject({
        code: "integrity_failure",
        retrySameProjection: false,
      });
    } finally {
      await env.SERVING_DB.prepare(
        "DROP INDEX publication_provider_model_id_raw_exact_idx",
      ).run();
      await env.SERVING_DB.prepare(
        `CREATE INDEX publication_provider_model_id_raw_exact_idx
         ON publication_provider_model_id_search_document(
           publication_id, raw_provider_model_id_utf8, offering_id
         )`,
      ).run();
    }

    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_provider_model_id_search_document_immutable_update",
    ).run();
    await env.SERVING_DB.prepare(
      `UPDATE publication_provider_model_id_search_document
       SET normalized_provider_model_id_utf8 = X'01'
       WHERE publication_id = ? AND offering_id = (
         SELECT min(offering_id)
         FROM publication_provider_model_id_search_document
         WHERE publication_id = ?
       )`,
    )
      .bind(PUBLICATION_E, PUBLICATION_E)
      .run();
    await env.SERVING_DB.prepare(
      `CREATE TRIGGER publication_provider_model_id_search_document_immutable_update
       BEFORE UPDATE ON publication_provider_model_id_search_document
       BEGIN SELECT RAISE(ABORT, 'provider model ID search document is immutable'); END`,
    ).run();
    await expect(
      applyServingSwitchV4(env.SERVING_DB, projection),
    ).rejects.toMatchObject({
      code: "integrity_failure",
      retrySameProjection: false,
    });
    await expect(
      one<{
        active_publication_id: string;
        rollback_candidate_publication_id: string;
        generation: number;
      }>(
        "SELECT active_publication_id, rollback_candidate_publication_id, generation FROM publication_head WHERE singleton = 1",
      ),
    ).resolves.toEqual({
      active_publication_id: PUBLICATION_E,
      rollback_candidate_publication_id: PUBLICATION_A,
      generation: 4,
    });
  });
});
