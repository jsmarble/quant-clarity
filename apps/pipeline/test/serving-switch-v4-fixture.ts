import {
  projectModelVariantNameSearchArtifactProofV1,
  projectModelVariantNameSearchProjection,
  projectModelVariantNameSearchQueryabilityPlanV3,
  projectModelVariantNameSearchQueryableArtifactProofV3,
  projectModelVariantNameSearchStagingV1,
  projectProviderModelIdSearchArtifactProofV1,
  projectProviderModelIdSearchProjection,
  projectProviderModelIdSearchQueryabilityPlanV4,
  projectProviderModelIdSearchQueryableArtifactProofV4,
  projectProviderSearchArtifactProofV2,
  projectProviderSearchProjection,
  projectProviderSearchStagingV2,
  projectReadinessReceiptProofV3,
  projectReadinessReceiptProofV4,
  projectServingClosureSeal,
  projectServingReadinessCommitV3,
  projectServingReadinessCommitV4,
  projectServingReadinessProofV3,
  projectServingReadinessProofV4,
  readModelVariantNameSearchStagingPersistenceV1,
  readProviderSearchStagingPersistenceV2,
  type ModelVariantNameSearchQueryableArtifactProofV3,
  type ProviderModelIdSearchQueryableArtifactProofV4,
  type ProviderModelIdSearchStagingProjectionV1,
  type ProviderSearchArtifactProofV2,
  type ProviderSearchStagingProjectionV2,
  type ReadinessReceipt,
  type ServingClosureSealProjection,
  type ServingReadinessCommitProjectionV3,
  type ServingReadinessCommitProjectionV4,
  type ServingReadinessProofV3,
  type ServingReadinessProofV4,
  type TrustedProviderModelIdSearchProjection,
  type TrustedProviderSearchProjection,
} from "@quant-clarity/publication-core";

import {
  createProviderModelIdSearchFixture,
  type ProviderModelIdOfferingFixture,
} from "./provider-model-id-search-fixture.js";
import type { ModelVariantNameSearchFixture } from "./model-variant-name-search-fixture.js";

const MAXIMUM_AGE_MS = 60 * 60 * 1_000;
const iso = (value: number): string => new Date(value).toISOString();
const DEFAULT_OFFERINGS = Object.freeze([
  { rawProviderModelId: "\u0000" },
  { rawProviderModelId: "\u0000", status: "inactive", stale: true },
  { rawProviderModelId: "   ", status: "inactive", stale: true },
  { rawProviderModelId: "Accounts/Alpha" },
  { rawProviderModelId: "ACCOUNTS/ALPHA", status: "unavailable" },
] as const satisfies readonly ProviderModelIdOfferingFixture[]);

export type ServingV4Fixture = Readonly<{
  base: ModelVariantNameSearchFixture;
  seal: ServingClosureSealProjection;
  providerStaging: ProviderSearchStagingProjectionV2;
  providerProjection: TrustedProviderSearchProjection;
  providerProof: ProviderSearchArtifactProofV2;
  modelProof: ModelVariantNameSearchQueryableArtifactProofV3;
  providerModelIdProjection: TrustedProviderModelIdSearchProjection;
  providerModelIdStaging: ProviderModelIdSearchStagingProjectionV1;
  providerModelIdProof: ProviderModelIdSearchQueryableArtifactProofV4;
  readinessProof: ServingReadinessProofV4;
  readinessCommit: ServingReadinessCommitProjectionV4;
  legacyReadinessProof: ServingReadinessProofV3;
  legacyReadinessCommit: ServingReadinessCommitProjectionV3;
}>;

/** Builds a nonempty cumulative-search fixture through the real projection. */
export const createServingV4Fixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
  offerings: readonly ProviderModelIdOfferingFixture[] = DEFAULT_OFFERINGS,
): Promise<ServingV4Fixture> => {
  const providerModelIdFixture = await createProviderModelIdSearchFixture(
    publicationId,
    generatedAtMs,
    offerings,
  );
  const { manifest, closureRows } = providerModelIdFixture;
  const { seal } = await projectServingClosureSeal(closureRows);
  const providerProjection = await projectProviderSearchProjection({
    manifest,
    providerResources: closureRows.resources.filter(
      (resource) => resource.resource_type === "provider",
    ),
  });
  const providerStaging = await projectProviderSearchStagingV2({
    projection: providerProjection,
    closureRows,
  });
  const providerPersistence =
    readProviderSearchStagingPersistenceV2(providerStaging);
  const providerProof = projectProviderSearchArtifactProofV2({
    manifest,
    projection: providerProjection,
    fts: {
      buildVersion: "provider-name-fts5-unicode61@1",
      documentCount: providerProjection.documentCount,
      queryable: true,
      exactParity: true,
    },
  });
  const modelProjection = await projectModelVariantNameSearchProjection({
    manifest,
    resources: closureRows.resources.filter(
      (resource) =>
        resource.resource_type === "model" ||
        resource.resource_type === "variant",
    ),
  });
  const modelStaging = await projectModelVariantNameSearchStagingV1({
    projection: modelProjection,
    closureRows,
  });
  const modelPersistence =
    readModelVariantNameSearchStagingPersistenceV1(modelStaging);
  const modelStorageProof = projectModelVariantNameSearchArtifactProofV1({
    staging: modelStaging,
    observation: {
      storageVersion: modelPersistence.storageVersion,
      rows: modelPersistence.rows,
    },
  });
  const modelProof = projectModelVariantNameSearchQueryableArtifactProofV3({
    storageProof: modelStorageProof,
    queryability:
      projectModelVariantNameSearchQueryabilityPlanV3(modelStorageProof),
  });
  const providerModelIdProjection =
    await projectProviderModelIdSearchProjection({
      manifest,
      resources: closureRows.resources.filter(
        (resource) =>
          resource.resource_type === "offering" ||
          resource.resource_type === "model" ||
          resource.resource_type === "variant",
      ),
    });
  const providerModelIdStaging = providerModelIdFixture.staging;
  const providerModelIdPersistence = providerModelIdFixture.persistence;
  const providerModelIdStorageProof =
    projectProviderModelIdSearchArtifactProofV1({
      staging: providerModelIdStaging,
      observation: {
        storageVersion: providerModelIdPersistence.storageVersion,
        rows: providerModelIdPersistence.rows,
      },
    });
  const providerModelIdProof =
    projectProviderModelIdSearchQueryableArtifactProofV4({
      storageProof: providerModelIdStorageProof,
      queryability: projectProviderModelIdSearchQueryabilityPlanV4(
        providerModelIdStorageProof,
      ),
    });
  const base: ModelVariantNameSearchFixture = Object.freeze({
    manifest,
    closureRows,
    staging: modelStaging,
    persistence: modelPersistence,
  });
  const binding = {
    environment: "local" as const,
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    bundleHash: manifest.bundleHash,
    schemaVersion: manifest.versions.schema,
    buildCommit: manifest.versions.buildCommit,
  };
  const evidence: ReadinessReceipt[] = [
    {
      kind: "archive",
      binding,
      observedAt: iso(generatedAtMs + 2 * 60_000),
      retainedBundleHash: manifest.bundleHash,
      immutable: true,
    },
    {
      kind: "serving",
      binding,
      observedAt: iso(generatedAtMs + 3 * 60_000),
      enabledProviderCount: manifest.enabledProviderIds.length,
      enabledProviderScopeHash: manifest.enabledProviderScopeHash,
      providerSliceCount: manifest.providerSlices.length,
      providerSliceHash: manifest.providerSliceHash,
      providerAttributionCount: manifest.providerAttributions.length,
      providerAttributionHash: manifest.providerAttributionHash,
      resourceCount: manifest.resources.length,
      exactDocumentCount: manifest.searchDocuments.length,
      resourceInventoryHash: manifest.resourceInventoryHash,
      exactSearchInventoryHash: manifest.exactSearchInventoryHash,
      ftsBuildVersion: "fts5-unicode61@1",
      ftsDocumentCount: manifest.searchDocuments.length,
      ftsQueryable: true,
      foreignKeysValid: true,
      contentHashesValid: true,
      unavailableProviderIsolationValid: true,
    },
    {
      kind: "vectors",
      binding,
      observedAt: iso(generatedAtMs + 4 * 60_000),
      namespace: manifest.publicationId,
      documentCount: manifest.vectors.length,
      verifiedDocumentCount: manifest.vectors.length,
      vectorInventoryHash: manifest.vectorInventoryHash,
      visibilityProbeVersion: "vector-visibility@1",
      mutationId: `fixture-v4-${publicationId}`,
      allIdsPresent: true,
      allNamespacesMatch: true,
      queryable: true,
    },
    {
      kind: "probes",
      binding,
      observedAt: iso(generatedAtMs + 5 * 60_000),
      probeSetVersion: "search-gold@4",
      integrityPassed: true,
      evidenceCoveragePassed: true,
      exactSearchPassed: true,
      semanticSearchPassed: true,
      structuredFilterPassed: true,
      neutralityPassed: true,
      versionIsolationPassed: true,
    },
  ];
  const receiptProofs = await Promise.all(
    evidence.map((receipt) =>
      projectReadinessReceiptProofV4({
        receipt,
        providerProof: receipt.kind === "serving" ? providerProof : null,
        modelVariantNameProof: receipt.kind === "serving" ? modelProof : null,
        providerModelIdProof:
          receipt.kind === "serving" ? providerModelIdProof : null,
      }),
    ),
  );
  const readinessProof = await projectServingReadinessProofV4({
    manifest,
    receiptProofs,
    environment: "local",
    readyAtMs: generatedAtMs + 6 * 60_000,
    maximumReceiptAgeMs: MAXIMUM_AGE_MS,
  });
  const legacyEvidence: ReadinessReceipt[] = evidence.map((receipt) =>
    receipt.kind === "probes"
      ? { ...receipt, probeSetVersion: "search-gold@3" as const }
      : receipt,
  );
  const legacyReceiptProofs = await Promise.all(
    legacyEvidence.map((receipt) =>
      projectReadinessReceiptProofV3({
        receipt,
        providerProof: receipt.kind === "serving" ? providerProof : null,
        modelVariantNameProof: receipt.kind === "serving" ? modelProof : null,
      }),
    ),
  );
  const legacyReadinessProof = await projectServingReadinessProofV3({
    manifest,
    receiptProofs: legacyReceiptProofs,
    environment: "local",
    readyAtMs: generatedAtMs + 6 * 60_000,
    maximumReceiptAgeMs: MAXIMUM_AGE_MS,
  });
  const legacyReadinessCommit = await projectServingReadinessCommitV3({
    proof: legacyReadinessProof,
    closureRows,
    persistedSeal: seal,
    persistedProviderSearchDocuments: providerPersistence.documents,
    persistedProviderSearchFtsRows: providerPersistence.ftsRows,
    persistedModelVariantNameRows: modelPersistence.rows,
  });
  const readinessCommit = await projectServingReadinessCommitV4({
    proof: readinessProof,
    closureRows,
    persistedSeal: seal,
    persistedProviderSearchDocuments: providerPersistence.documents,
    persistedProviderSearchFtsRows: providerPersistence.ftsRows,
    persistedModelVariantNameRows: base.persistence.rows,
    persistedProviderModelIdRows: providerModelIdPersistence.rows,
  });
  return Object.freeze({
    base,
    seal,
    providerStaging,
    providerProjection,
    providerProof,
    modelProof,
    providerModelIdProjection,
    providerModelIdStaging,
    providerModelIdProof,
    readinessProof,
    readinessCommit,
    legacyReadinessProof,
    legacyReadinessCommit,
  });
};

export const sealServingV4Fixture = (
  database: D1Database,
  fixture: ServingV4Fixture,
): Promise<void> => {
  const seal = fixture.seal;
  return database
    .prepare(
      "INSERT INTO publication_closure_seal VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      seal.publication_id,
      seal.staging_revision,
      seal.manifest_contract_version,
      seal.hash_domain,
      seal.hash_encoding_version,
      seal.enabled_provider_scope_version,
      seal.enabled_provider_count,
      seal.provider_slice_count,
      seal.provider_attribution_count,
      seal.resource_count,
      seal.exact_document_count,
      seal.vector_document_count,
      seal.chunk_count,
      seal.bundle_hash,
      seal.enabled_provider_scope_hash,
      seal.provider_slice_hash,
      seal.provider_attribution_hash,
      seal.resource_inventory_hash,
      seal.exact_search_inventory_hash,
      seal.vector_inventory_hash,
      seal.chunk_root_hash,
      seal.closure_hash,
      seal.sealed_at_ms,
    )
    .run()
    .then(() => undefined);
};
