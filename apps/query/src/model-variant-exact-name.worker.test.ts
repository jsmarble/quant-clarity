import { env, exports } from "cloudflare:workers";
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
import type { QueryServiceEnvelope } from "@quant-clarity/api-core";

import { applyModelVariantNameSearchStagingV1 } from "../../pipeline/src/model-variant-name-search-staging.js";
import { applyProviderSearchStagingV2 } from "../../pipeline/src/provider-search-staging.js";
import { applyReadinessCommitV3 } from "../../pipeline/src/readiness-commit-v3.js";
import { applyServingSwitchV3 } from "../../pipeline/src/serving-switch.js";
import { seedModelVariantNameSearchBuildingPublication } from "../../pipeline/test/model-variant-name-search-fixture.js";
import {
  createServingV3Fixture,
  sealServingV3Fixture,
  type ServingV3Fixture,
} from "../../pipeline/test/serving-switch-v3-fixture.js";
import {
  MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES,
  MODEL_VARIANT_EXACT_NAME_SELECT_SQL,
  readModelVariantExactNamePage,
} from "./model-variant-exact-name.js";

const PUBLICATION = "pub_dddddddd-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_dddddddd-0000-4000-8000-000000000002" as const;
const PUBLICATION_C = "pub_dddddddd-0000-4000-8000-000000000003" as const;
const UNKNOWN_PUBLICATION = "pub_dddddddd-0000-4000-8000-000000000004" as const;
const NEUTRAL_PUBLICATION_A =
  "pub_dddddddd-0000-4000-8000-000000000005" as const;
const NEUTRAL_PUBLICATION_B =
  "pub_dddddddd-0000-4000-8000-000000000006" as const;
const NOW = Math.floor(Date.now() / 1_000) * 1_000;
const GENERATED_AT = NOW - 20 * 60_000;
const SWITCHED_AT = NOW - 60_000;
const utf8 = new TextEncoder();
let fixture: ServingV3Fixture;

const rpcEnvelope = (
  publicationId: string,
  query: string,
): QueryServiceEnvelope => ({
  audience: "quantclarity-catalog-query-v1",
  continuation: null,
  environment: "local",
  filters: {},
  limit: 20,
  operation: { kind: "search" },
  publicationId,
  searchPlan: {
    filters: {},
    kind: "exact_structured",
    limit: 20,
    query,
    semanticCalls: 0,
    semanticCandidates: 0,
    semanticDegraded: "disabled",
  },
  sort: ["relevance", "stable_id"],
  version: 1,
});

const artifactProof = (value: ServingV3Fixture) => ({
  environment: "local" as const,
  observedAtMs: SWITCHED_AT - 1_000,
  maximumAgeMs: 60 * 60 * 1_000,
  ftsBuildVersion: "fts5-unicode61@1",
  ftsSourceDocumentCount: value.base.manifest.searchDocuments.length,
  ftsIndexDocumentCount: value.base.manifest.searchDocuments.length,
  ftsSourceInventoryHash: value.base.manifest.exactSearchInventoryHash,
  ftsExactParity: true as const,
  archiveBundleHash: value.base.manifest.bundleHash,
  archiveImmutable: true as const,
  vectorNamespace: value.base.manifest.publicationId,
  vectorDocumentCount: value.base.manifest.vectors.length,
  vectorVerifiedDocumentCount: value.base.manifest.vectors.length,
  vectorInventoryHash: value.base.manifest.vectorInventoryHash,
  vectorVisibilityProbeVersion: "vector-visibility@1",
  vectorMutationId: `query-reader-v3-${value.base.manifest.publicationId}`,
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
  value: ServingV3Fixture,
  state: PublicationRecord["state"] = "ready",
  firstActivatedAt: string | null = null,
  lastHeadReferencedAt: string | null = firstActivatedAt,
): PublicationRecord => {
  const readiness = readServingReadinessCommitPersistenceV3(
    value.readinessCommit,
  );
  return {
    publicationId: value.base.manifest.publicationId,
    closureHash: value.base.manifest.closureHash,
    state,
    generatedAt: value.base.manifest.generatedAt,
    readyAt: new Date(readiness.transition.ready_at_ms).toISOString(),
    firstActivatedAt,
    lastHeadReferencedAt,
  };
};

const activation = async (
  value: ServingV3Fixture,
  switchedAtMs: number,
  currentHead: StoredPublicationHead | null = null,
  currentActive: PublicationRecord | null = null,
): Promise<ServingSwitchProjectionV3> => {
  const provider = readProviderSearchStagingPersistenceV2(
    value.providerStaging,
  );
  const readiness = readServingReadinessCommitPersistenceV3(
    value.readinessCommit,
  );
  const generation = (currentHead?.generation ?? 0) + 1;
  const preflight = await projectServingSwitchPreflightProofV3({
    manifest: value.base.manifest,
    providerProof: value.providerProof,
    modelVariantNameProof: value.modelProof,
    readinessProof: value.readinessProof,
    context: {
      switchId: `publication-switch|activate|${String(generation)}|${value.base.manifest.publicationId}|${value.base.manifest.closureHash}`,
      action: "activate",
      expectedPriorGeneration: currentHead?.generation ?? 0,
      expectedPriorRollbackCandidatePublicationId:
        currentHead?.rollbackCandidatePublicationId ?? null,
      expectedPriorSwitchedAtMs:
        currentHead === null ? null : Date.parse(currentHead.switchedAt),
      newGeneration: generation,
      fromPublicationId: currentActive?.publicationId ?? null,
      fromClosureHash: currentActive?.closureHash ?? null,
      toPublicationId: value.base.manifest.publicationId,
      toClosureHash: value.base.manifest.closureHash,
      switchedAtMs,
    },
    artifactProof: artifactProof(value),
  });
  return projectServingSwitchV3({
    preflight,
    target: record(value),
    currentHead,
    currentActive,
    authorizedBy: {
      kind: "pipeline",
      identityId: "pipeline.query-reader-workerd",
    },
    closureRows: value.base.closureRows,
    persistedSeal: value.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: value.base.persistence.rows,
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
    artifactProof: artifactProof(target),
  });
  return projectServingSwitchV3({
    preflight,
    target: record(target, "superseded", targetFirstActivatedAt),
    currentHead,
    currentActive,
    authorizedBy: {
      kind: "operator",
      identityId: "operator.query-reader-workerd",
    },
    closureRows: target.base.closureRows,
    persistedSeal: target.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: target.base.persistence.rows,
    persistedReceiptRows: null,
    persistedAttestation: null,
  });
};

const publish = async (value: ServingV3Fixture): Promise<void> => {
  await seedModelVariantNameSearchBuildingPublication(
    env.SERVING_DB,
    value.base,
  );
  await applyProviderSearchStagingV2(env.SERVING_DB, value.providerStaging);
  await applyModelVariantNameSearchStagingV1(
    env.SERVING_DB,
    value.base.staging,
  );
  await sealServingV3Fixture(env.SERVING_DB, value);
  await applyReadinessCommitV3(env.SERVING_DB, value.readinessCommit);
};

const read = (query: string, recordType: "model" | "variant" | null = null) =>
  readModelVariantExactNamePage(env.SERVING_DB, {
    publicationId: PUBLICATION,
    query,
    recordType,
    afterResourceId: null,
    limit: 20,
  });

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
  fixture = await createServingV3Fixture(PUBLICATION, GENERATED_AT, {
    modelDisplayName: [
      "\u0000Leading Model",
      "Interior\u0000Model",
      "Trailing Model\u0000",
      "Beta Variant",
    ],
    includeVariant: true,
  });
  await publish(fixture);
  await applyServingSwitchV3(
    env.SERVING_DB,
    await activation(fixture, SWITCHED_AT),
  );
});

describe("model/variant exact-name reader in pinned workerd/D1 (SRCH-002, SRCH-006, SRCH-009, QA-005)", () => {
  it("round-trips leading, interior, and trailing NUL through bound BLOB equality", async () => {
    for (const displayName of [
      "\u0000Leading Model",
      "Interior\u0000Model",
      "Trailing Model\u0000",
    ])
      await expect(read(displayName)).resolves.toMatchObject({
        publicationId: PUBLICATION,
        nextAfterResourceId: null,
        results: [
          {
            tier: 1,
            resourceType: "model",
            matchKind: "canonical_name",
            displayName: { state: "known", value: displayName },
          },
        ],
      });
  });

  it("retains model/variant collisions, selectors, stable pagination, and empty results", async () => {
    const both = await read("beta variant");
    expect(both.results.map((result) => result.resourceType)).toEqual([
      "model",
      "variant",
    ]);
    await expect(read("beta variant", "model")).resolves.toMatchObject({
      results: [{ resourceType: "model" }],
    });
    await expect(read("beta variant", "variant")).resolves.toMatchObject({
      results: [{ resourceType: "variant" }],
    });
    const first = await readModelVariantExactNamePage(env.SERVING_DB, {
      publicationId: PUBLICATION,
      query: "beta variant",
      recordType: null,
      afterResourceId: null,
      limit: 1,
    });
    expect(first.results).toHaveLength(1);
    expect(first.nextAfterResourceId).toBe(first.results[0]?.resourceId);
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "beta variant",
        recordType: null,
        afterResourceId: first.nextAfterResourceId,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      nextAfterResourceId: null,
      results: [{ resourceType: "variant" }],
    });
    await expect(read("missing model")).resolves.toMatchObject({
      nextAfterResourceId: null,
      results: [],
    });
  });

  it("uses the declared exact index with a direct ArrayBuffer binding", async () => {
    const queryBytes = utf8.encode("beta variant");
    const binding = queryBytes.buffer.slice(
      queryBytes.byteOffset,
      queryBytes.byteOffset + queryBytes.byteLength,
    );
    const plan = await env.SERVING_DB.prepare(
      `EXPLAIN QUERY PLAN ${MODEL_VARIANT_EXACT_NAME_SELECT_SQL}`,
    )
      .bind(
        PUBLICATION,
        binding,
        null,
        "",
        MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES,
        21,
      )
      .all<{ detail: string }>();
    expect(plan.success).toBe(true);
    expect(plan.results.map((row) => row.detail).join("\n")).toContain(
      "publication_model_variant_name_exact_idx",
    );
  });

  it("preserves lifecycle/bookmark eligibility, status exclusion, and neutral exact ordering across publications", async () => {
    const selectedA = await exports.CatalogQueryService.resolvePublicationV1({
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "local",
      requestedPublicationId: null,
    });
    expect(selectedA).toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION,
    });
    if (selectedA.outcome !== "selected")
      throw new Error("initial selection failed");
    await expect(
      exports.CatalogQueryService.readModelVariantExactNameTierV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: selectedA.bookmark,
        envelope: rpcEnvelope(PUBLICATION, "Interior\u0000Model"),
      }),
    ).resolves.toMatchObject({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [{ resourceType: "model", matchKind: "canonical_name" }],
      },
    });
    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: UNKNOWN_PUBLICATION,
      }),
    ).resolves.toEqual({
      outcome: "publication_expired",
      currentPublicationId: PUBLICATION,
    });

    const fixtureB = await createServingV3Fixture(
      PUBLICATION_B,
      NOW - 15 * 60_000,
      { modelDisplayName: "Replacement Model" },
    );
    const fixtureC = await createServingV3Fixture(
      PUBLICATION_C,
      NOW - 10 * 60_000,
      {
        modelDisplayName: [
          "Inactive Model",
          "Unavailable Model",
          "Deleted Model",
          "Unknown Status Model",
          "Active Control Model",
        ],
        modelStatus: ["inactive", "unavailable", "deleted", null, "active"],
      },
    );
    await publish(fixtureB);
    await publish(fixtureC);
    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION_B,
      }),
    ).resolves.toEqual({
      outcome: "publication_expired",
      currentPublicationId: PUBLICATION,
    });
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION_B,
        query: "Replacement Model",
        recordType: null,
        afterResourceId: null,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const firstActivatedAtA = new Date(SWITCHED_AT).toISOString();
    const headA: StoredPublicationHead = {
      activePublicationId: PUBLICATION,
      rollbackCandidatePublicationId: null,
      switchedAt: firstActivatedAtA,
      generation: 1,
    };
    const activeA = record(fixture, "active", firstActivatedAtA);
    const switchedAtB = NOW - 50_000;
    await applyServingSwitchV3(
      env.SERVING_DB,
      await activation(fixtureB, switchedAtB, headA, activeA),
    );

    const replacementA = await exports.CatalogQueryService.resolvePublicationV1(
      {
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION,
      },
    );
    expect(replacementA).toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION,
    });
    if (replacementA.outcome !== "selected")
      throw new Error("replacement selection failed");
    await expect(
      exports.CatalogQueryService.readModelVariantExactNameTierV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: replacementA.bookmark,
        envelope: rpcEnvelope(PUBLICATION, "Interior\u0000Model"),
      }),
    ).resolves.toMatchObject({
      outcome: "page",
      page: { results: [{ resourceType: "model" }] },
    });

    const firstActivatedAtB = new Date(switchedAtB).toISOString();
    const headB: StoredPublicationHead = {
      activePublicationId: PUBLICATION_B,
      rollbackCandidatePublicationId: PUBLICATION,
      switchedAt: firstActivatedAtB,
      generation: 2,
    };
    const activeB = record(fixtureB, "active", firstActivatedAtB);
    const switchedAtC = NOW - 40_000;
    await applyServingSwitchV3(
      env.SERVING_DB,
      await activation(fixtureC, switchedAtC, headB, activeB),
    );

    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION,
      }),
    ).resolves.toEqual({
      outcome: "publication_expired",
      currentPublicationId: PUBLICATION_C,
    });
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Interior\u0000Model",
        recordType: null,
        afterResourceId: null,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const selectedC = await exports.CatalogQueryService.resolvePublicationV1({
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "local",
      requestedPublicationId: null,
    });
    if (selectedC.outcome !== "selected")
      throw new Error("third selection failed");
    for (const excludedName of [
      "Inactive Model",
      "Unavailable Model",
      "Deleted Model",
      "Unknown Status Model",
    ])
      await expect(
        exports.CatalogQueryService.readModelVariantExactNameTierV1({
          version: 1,
          audience: "quantclarity-catalog-query-v1",
          environment: "local",
          bookmark: selectedC.bookmark,
          envelope: rpcEnvelope(PUBLICATION_C, excludedName),
        }),
      ).resolves.toEqual({
        outcome: "page",
        page: {
          publicationId: PUBLICATION_C,
          results: [],
          nextAfterResourceId: null,
        },
      });
    await expect(
      exports.CatalogQueryService.readModelVariantExactNameTierV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: selectedC.bookmark,
        envelope: rpcEnvelope(PUBLICATION_C, "Active Control Model"),
      }),
    ).resolves.toMatchObject({
      outcome: "page",
      page: { results: [{ resourceType: "model" }] },
    });

    const firstActivatedAtC = new Date(switchedAtC).toISOString();
    const headC: StoredPublicationHead = {
      activePublicationId: PUBLICATION_C,
      rollbackCandidatePublicationId: PUBLICATION_B,
      switchedAt: firstActivatedAtC,
      generation: 3,
    };
    const activeC = record(fixtureC, "active", firstActivatedAtC);
    await applyServingSwitchV3(
      env.SERVING_DB,
      await rollback(fixtureB, firstActivatedAtB, headC, activeC, NOW - 30_000),
    );

    const rollbackCandidateC =
      await exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION_C,
      });
    expect(rollbackCandidateC).toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION_C,
    });
    if (rollbackCandidateC.outcome !== "selected")
      throw new Error("rollback-candidate selection failed");
    await expect(
      exports.CatalogQueryService.readModelVariantExactNameTierV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: rollbackCandidateC.bookmark,
        envelope: rpcEnvelope(PUBLICATION_C, "Inactive Model"),
      }),
    ).resolves.toEqual({
      outcome: "page",
      page: {
        publicationId: PUBLICATION_C,
        results: [],
        nextAfterResourceId: null,
      },
    });

    const neutralA = await createServingV3Fixture(
      NEUTRAL_PUBLICATION_A,
      NOW - 8 * 60_000,
      { modelDisplayName: ["Neutral Model", "Neutral Model"] },
    );
    const neutralB = await createServingV3Fixture(
      NEUTRAL_PUBLICATION_B,
      NOW - 7 * 60_000,
      {
        modelDisplayName: ["Neutral Model", "Neutral Model"],
        neutrality: {
          modelPublisher: "Different Publisher",
          providerAffiliateRelationshipPresent: true,
          providerOfficialSite: "https://different-provider.example",
          providerPrecisionKnownCount: 7,
        },
      },
    );
    await publish(neutralA);
    await publish(neutralB);
    const rollbackAt = NOW - 30_000;
    const headAfterRollback: StoredPublicationHead = {
      activePublicationId: PUBLICATION_B,
      rollbackCandidatePublicationId: PUBLICATION_C,
      switchedAt: new Date(rollbackAt).toISOString(),
      generation: 4,
    };
    const activeBAfterRollback = record(
      fixtureB,
      "active",
      firstActivatedAtB,
      headAfterRollback.switchedAt,
    );
    const neutralASwitchedAt = NOW - 20_000;
    await applyServingSwitchV3(
      env.SERVING_DB,
      await activation(
        neutralA,
        neutralASwitchedAt,
        headAfterRollback,
        activeBAfterRollback,
      ),
    );
    const selectedNeutralA =
      await exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: null,
      });
    if (selectedNeutralA.outcome !== "selected")
      throw new Error("first neutrality selection failed");
    const resultNeutralA =
      await exports.CatalogQueryService.readModelVariantExactNameTierV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: selectedNeutralA.bookmark,
        envelope: rpcEnvelope(NEUTRAL_PUBLICATION_A, "Neutral Model"),
      });
    if (resultNeutralA.outcome !== "page")
      throw new Error("first neutrality read failed");

    const headNeutralA: StoredPublicationHead = {
      activePublicationId: NEUTRAL_PUBLICATION_A,
      rollbackCandidatePublicationId: PUBLICATION_B,
      switchedAt: new Date(neutralASwitchedAt).toISOString(),
      generation: 5,
    };
    const activeNeutralA = record(neutralA, "active", headNeutralA.switchedAt);
    await applyServingSwitchV3(
      env.SERVING_DB,
      await activation(neutralB, NOW - 10_000, headNeutralA, activeNeutralA),
    );
    const selectedNeutralB =
      await exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: null,
      });
    if (selectedNeutralB.outcome !== "selected")
      throw new Error("second neutrality selection failed");
    const resultNeutralB =
      await exports.CatalogQueryService.readModelVariantExactNameTierV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: selectedNeutralB.bookmark,
        envelope: rpcEnvelope(NEUTRAL_PUBLICATION_B, "Neutral Model"),
      });
    if (resultNeutralB.outcome !== "page")
      throw new Error("second neutrality read failed");
    const neutralOrderingFacts = (result: typeof resultNeutralA) =>
      result.page.results.map((item) => ({
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        matchKind: item.matchKind,
        displayName: item.displayName.value,
        semanticDegraded: item.semanticDegraded,
      }));
    expect(neutralOrderingFacts(resultNeutralB)).toEqual(
      neutralOrderingFacts(resultNeutralA),
    );
  });
});
