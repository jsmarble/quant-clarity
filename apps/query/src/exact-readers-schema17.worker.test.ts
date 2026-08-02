import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  projectServingSwitchPreflightProofV4,
  projectServingSwitchV4,
  readProviderModelIdSearchStagingPersistenceV1,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV4,
  type ServingSwitchProjectionV4,
} from "@quant-clarity/publication-core";
import type * as PublicationCoreModule from "@quant-clarity/publication-core";

import { applyModelVariantNameSearchStagingV1 } from "../../pipeline/src/model-variant-name-search-staging.js";
import { applyProviderModelIdSearchStagingV1 } from "../../pipeline/src/provider-model-id-search-staging.js";
import { applyProviderSearchStagingV2 } from "../../pipeline/src/provider-search-staging.js";
import { applyReadinessCommitV4 } from "../../pipeline/src/readiness-commit-v4.js";
import { applyServingSwitchV4 } from "../../pipeline/src/serving-switch.js";
import { seedModelVariantNameSearchBuildingPublication } from "../../pipeline/test/model-variant-name-search-fixture.js";
import type * as ModelFixtureModule from "../../pipeline/test/model-variant-name-search-fixture.js";
import {
  createServingV4Fixture,
  sealServingV4Fixture,
  type ServingV4Fixture,
} from "../../pipeline/test/serving-switch-v4-fixture.js";
import { readModelVariantExactNamePage } from "./model-variant-exact-name.js";
import { readProviderExactNamePage } from "./provider-exact-name.js";

vi.mock("@quant-clarity/publication-core", async (importOriginal) => {
  const actual = await importOriginal<typeof PublicationCoreModule>();
  const projectProviderModelIdSearchProjection: typeof actual.projectProviderModelIdSearchProjection =
    (input) => {
      const targetIds = new Set(
        input.resources
          .filter((resource) => resource.resource_type === "offering")
          .map((resource) => {
            const value = JSON.parse(resource.resource_json) as {
              model_resource_id?: unknown;
            };
            return value.model_resource_id;
          })
          .filter((value): value is string => typeof value === "string"),
      );
      return actual.projectProviderModelIdSearchProjection({
        ...input,
        resources: input.resources.filter(
          (resource) =>
            resource.resource_type === "offering" ||
            ((resource.resource_type === "model" ||
              resource.resource_type === "variant") &&
              targetIds.has(resource.resource_id)),
        ),
      });
    };
  return { ...actual, projectProviderModelIdSearchProjection };
});

vi.mock(
  "../../pipeline/test/model-variant-name-search-fixture.js",
  async (importOriginal) => {
    const actual = await importOriginal<typeof ModelFixtureModule>();
    const createFixture: typeof actual.createModelVariantNameSearchFixture = (
      ...args
    ) => {
      const [
        publicationId,
        generatedAtMs,
        ,
        ,
        availableProvider = false,
        ,
        neutrality = {},
      ] = args;
      return actual.createModelVariantNameSearchFixture(
        publicationId,
        generatedAtMs,
        ["Schema 17\u0000Model", "Beta Variant"],
        true,
        availableProvider,
        ["active", "active"],
        neutrality,
      );
    };
    return { ...actual, createModelVariantNameSearchFixture: createFixture };
  },
);

const PUBLICATION = "pub_17171717-0000-4000-8000-000000000001" as const;
const NOW = Math.floor(Date.now() / 1_000) * 1_000;
const GENERATED_AT = NOW - 20 * 60_000;
const SWITCHED_AT = NOW - 60_000;
let fixture: ServingV4Fixture;

const artifactProof = (value: ServingV4Fixture) => ({
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
  vectorMutationId: `query-schema17-${value.base.manifest.publicationId}`,
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

const activation = async (
  value: ServingV4Fixture,
): Promise<ServingSwitchProjectionV4> => {
  const provider = readProviderSearchStagingPersistenceV2(
    value.providerStaging,
  );
  const providerModel = readProviderModelIdSearchStagingPersistenceV1(
    value.providerModelIdStaging,
  );
  const readiness = readServingReadinessCommitPersistenceV4(
    value.readinessCommit,
  );
  const preflight = await projectServingSwitchPreflightProofV4({
    manifest: value.base.manifest,
    providerProof: value.providerProof,
    modelVariantNameProof: value.modelProof,
    providerModelIdProof: value.providerModelIdProof,
    readinessProof: value.readinessProof,
    context: {
      switchId: `publication-switch|activate|1|${value.base.manifest.publicationId}|${value.base.manifest.closureHash}`,
      action: "activate",
      expectedPriorGeneration: 0,
      expectedPriorRollbackCandidatePublicationId: null,
      expectedPriorSwitchedAtMs: null,
      newGeneration: 1,
      fromPublicationId: null,
      fromClosureHash: null,
      toPublicationId: value.base.manifest.publicationId,
      toClosureHash: value.base.manifest.closureHash,
      switchedAtMs: SWITCHED_AT,
    },
    artifactProof: artifactProof(value),
  });
  return projectServingSwitchV4({
    preflight,
    target: {
      publicationId: value.base.manifest.publicationId,
      closureHash: value.base.manifest.closureHash,
      state: "ready",
      generatedAt: value.base.manifest.generatedAt,
      readyAt: new Date(readiness.transition.ready_at_ms).toISOString(),
      firstActivatedAt: null,
      lastHeadReferencedAt: null,
    },
    currentHead: null,
    currentActive: null,
    authorizedBy: {
      kind: "pipeline",
      identityId: "pipeline.query-schema17-reader",
    },
    closureRows: value.base.closureRows,
    persistedSeal: value.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: value.base.persistence.rows,
    persistedProviderModelIdRows: providerModel.rows,
    persistedReceiptRows: readiness.receiptRows,
    persistedAttestation: readiness.attestation,
  });
};

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
  fixture = await createServingV4Fixture(PUBLICATION, GENERATED_AT);
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
  await applyServingSwitchV4(env.SERVING_DB, await activation(fixture));
});

describe("schema-1.7 current exact readers (SRCH-002, SRCH-006, SRCH-009, QA-005, QA-006)", () => {
  it("selects the real v4 head and returns canonical provider facts without admitting NUL", async () => {
    await expect(
      env.SERVING_DB.prepare(
        "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
      ).first(),
    ).resolves.toEqual({ schema_version: "1.7.0" });
    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: null,
      }),
    ).resolves.toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION,
    });

    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "  fixture provider  ",
      }),
    ).resolves.toMatchObject({
      publicationId: PUBLICATION,
      nextAfterProviderId: null,
      results: [
        {
          tier: 3,
          resourceType: "provider",
          matchKind: "provider_name",
          semanticDegraded: "disabled",
          displayName: { state: "known", value: "Fixture Provider" },
        },
      ],
    });
    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Fixture\u0000Provider",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("round-trips model NUL bytes and preserves canonical collision ordering and pagination", async () => {
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Schema 17\u0000Model",
        recordType: null,
        afterResourceId: null,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      publicationId: PUBLICATION,
      nextAfterResourceId: null,
      results: [
        {
          tier: 1,
          resourceType: "model",
          resourceId: "mdl_00000001-0000-4000-8000-000000000001",
          matchKind: "canonical_name",
          semanticDegraded: "disabled",
          displayName: { state: "known", value: "Schema 17\u0000Model" },
        },
      ],
    });

    const first = await readModelVariantExactNamePage(env.SERVING_DB, {
      publicationId: PUBLICATION,
      query: "beta variant",
      recordType: null,
      afterResourceId: null,
      limit: 1,
    });
    expect(first.results.map((result) => result.resourceId)).toEqual([
      "mdl_00000002-0000-4000-8000-000000000001",
    ]);
    expect(first.nextAfterResourceId).toBe(
      "mdl_00000002-0000-4000-8000-000000000001",
    );
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
      results: [
        {
          resourceType: "variant",
          resourceId: "var_00000001-0000-4000-8000-000000000001",
          matchKind: "canonical_name",
          displayName: { state: "known", value: "Beta Variant" },
        },
      ],
    });
  });
});
