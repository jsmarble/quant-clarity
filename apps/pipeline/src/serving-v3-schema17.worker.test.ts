import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  projectServingSwitchPreflightProofV3,
  projectServingSwitchV3,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV3,
} from "@quant-clarity/publication-core";

import { applyModelVariantNameSearchStagingV1 } from "./model-variant-name-search-staging.js";
import { applyProviderModelIdSearchStagingV1 } from "./provider-model-id-search-staging.js";
import { applyProviderSearchStagingV2 } from "./provider-search-staging.js";
import {
  ReadinessCommitV3Error,
  applyReadinessCommitV3,
} from "./readiness-commit-v3.js";
import { applyReadinessCommitV4 } from "./readiness-commit-v4.js";
import { applyServingSwitchV3 } from "./serving-switch.js";
import { seedModelVariantNameSearchBuildingPublication } from "../test/model-variant-name-search-fixture.js";
import {
  createServingV4Fixture,
  sealServingV4Fixture,
} from "../test/serving-switch-v4-fixture.js";

const PUBLICATION_ID = "pub_dddddddd-0000-4000-8000-000000000001" as const;

beforeAll(async () => {
  await applyD1Migrations(
    env.SERVING_DB,
    env.TEST_MIGRATIONS.filter(
      (migration) => migration.name <= "0015_model_slug_projection.sql",
    ),
  );
});

describe("legacy v3 adapters on schema 1.12", () => {
  it("rejects v3 readiness and switch writes without leaving rows or a head", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createServingV4Fixture(
      PUBLICATION_ID,
      now - 15 * 60_000,
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

    await expect(
      applyReadinessCommitV3(env.SERVING_DB, fixture.legacyReadinessCommit),
    ).rejects.toEqual(new ReadinessCommitV3Error("not_applied"));
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state,
          (SELECT count(*) FROM publication_readiness_receipt
           WHERE publication_id = candidate.publication_id) AS receipt_count
         FROM publication AS candidate WHERE candidate.publication_id = ?`,
      )
        .bind(PUBLICATION_ID)
        .first(),
    ).resolves.toEqual({ state: "building", receipt_count: 0 });

    await applyReadinessCommitV4(env.SERVING_DB, fixture.readinessCommit);
    const provider = readProviderSearchStagingPersistenceV2(
      fixture.providerStaging,
    );
    const readiness = readServingReadinessCommitPersistenceV3(
      fixture.legacyReadinessCommit,
    );
    const switchedAtMs = now - 30_000;
    const preflight = await projectServingSwitchPreflightProofV3({
      manifest: fixture.base.manifest,
      providerProof: fixture.providerProof,
      modelVariantNameProof: fixture.modelProof,
      readinessProof: fixture.legacyReadinessProof,
      context: {
        switchId: `publication-switch|activate|1|${PUBLICATION_ID}|${fixture.base.manifest.closureHash}`,
        action: "activate",
        expectedPriorGeneration: 0,
        expectedPriorRollbackCandidatePublicationId: null,
        expectedPriorSwitchedAtMs: null,
        newGeneration: 1,
        fromPublicationId: null,
        fromClosureHash: null,
        toPublicationId: PUBLICATION_ID,
        toClosureHash: fixture.base.manifest.closureHash,
        switchedAtMs,
      },
      artifactProof: {
        environment: "local",
        observedAtMs: switchedAtMs - 1_000,
        maximumAgeMs: 60 * 60 * 1_000,
        ftsBuildVersion: "fts5-unicode61@1",
        ftsSourceDocumentCount: fixture.base.manifest.searchDocuments.length,
        ftsIndexDocumentCount: fixture.base.manifest.searchDocuments.length,
        ftsSourceInventoryHash: fixture.base.manifest.exactSearchInventoryHash,
        ftsExactParity: true,
        archiveBundleHash: fixture.base.manifest.bundleHash,
        archiveImmutable: true,
        vectorNamespace: PUBLICATION_ID,
        vectorDocumentCount: fixture.base.manifest.vectors.length,
        vectorVerifiedDocumentCount: fixture.base.manifest.vectors.length,
        vectorInventoryHash: fixture.base.manifest.vectorInventoryHash,
        vectorVisibilityProbeVersion: "vector-visibility@1",
        vectorMutationId: `schema17-v3-${PUBLICATION_ID}`,
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
    const projection = await projectServingSwitchV3({
      preflight,
      target: {
        publicationId: PUBLICATION_ID,
        closureHash: fixture.base.manifest.closureHash,
        state: "ready",
        generatedAt: fixture.base.manifest.generatedAt,
        readyAt: new Date(readiness.transition.ready_at_ms).toISOString(),
        firstActivatedAt: null,
        lastHeadReferencedAt: null,
      },
      currentHead: null,
      currentActive: null,
      authorizedBy: { kind: "pipeline", identityId: "pipeline.schema17-v3" },
      closureRows: fixture.base.closureRows,
      persistedSeal: fixture.seal,
      persistedProviderSearchDocuments: provider.documents,
      persistedProviderSearchFtsRows: provider.ftsRows,
      persistedModelVariantNameRows: fixture.base.persistence.rows,
      persistedReceiptRows: readiness.receiptRows,
      persistedAttestation: readiness.attestation,
    });
    await expect(
      applyServingSwitchV3(env.SERVING_DB, projection),
    ).rejects.toMatchObject({
      code: "not_applied",
      retrySameProjection: true,
    });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state,
          (SELECT count(*) FROM publication_switch_preflight) AS preflight_count,
          (SELECT count(*) FROM publication_switch_history) AS history_count,
          (SELECT count(*) FROM publication_head) AS head_count
         FROM publication AS candidate WHERE candidate.publication_id = ?`,
      )
        .bind(PUBLICATION_ID)
        .first(),
    ).resolves.toEqual({
      state: "ready",
      preflight_count: 0,
      history_count: 0,
      head_count: 0,
    });
  });
});
