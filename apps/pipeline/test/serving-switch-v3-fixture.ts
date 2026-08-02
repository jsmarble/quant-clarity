import {
  projectModelVariantNameSearchArtifactProofV1,
  projectModelVariantNameSearchQueryabilityPlanV3,
  projectModelVariantNameSearchQueryableArtifactProofV3,
  projectProviderSearchArtifactProofV2,
  projectProviderSearchProjection,
  projectProviderSearchStagingV2,
  projectReadinessReceiptProofV3,
  projectServingClosureSeal,
  projectServingReadinessCommitV3,
  projectServingReadinessProofV3,
  readProviderSearchStagingPersistenceV2,
  type ModelVariantNameSearchQueryableArtifactProofV3,
  type ProviderSearchArtifactProofV2,
  type ProviderSearchStagingProjectionV2,
  type ReadinessReceipt,
  type ServingClosureSealProjection,
  type ServingReadinessCommitProjectionV3,
  type ServingReadinessProofV3,
  type TrustedProviderSearchProjection,
} from "@quant-clarity/publication-core";

import {
  createModelVariantNameSearchFixture,
  type ModelVariantNameSearchFixture,
} from "./model-variant-name-search-fixture.js";

const MAXIMUM_AGE_MS = 60 * 60 * 1_000;
const iso = (value: number): string => new Date(value).toISOString();

export type ServingV3Fixture = Readonly<{
  base: ModelVariantNameSearchFixture;
  seal: ServingClosureSealProjection;
  providerProjection: TrustedProviderSearchProjection;
  providerStaging: ProviderSearchStagingProjectionV2;
  providerProof: ProviderSearchArtifactProofV2;
  modelProof: ModelVariantNameSearchQueryableArtifactProofV3;
  readinessProof: ServingReadinessProofV3;
  readinessCommit: ServingReadinessCommitProjectionV3;
}>;

export const createServingV3Fixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
  options: Readonly<{
    modelDisplayName?: string | readonly string[];
    includeVariant?: boolean;
    modelStatus?:
      | "active"
      | "inactive"
      | "unavailable"
      | "deleted"
      | null
      | readonly ("active" | "inactive" | "unavailable" | "deleted" | null)[];
    neutrality?: Readonly<{
      modelPublisher?: string;
      providerAffiliateRelationshipPresent?: boolean;
      providerOfficialSite?: string;
      providerPrecisionKnownCount?: number;
    }>;
  }> = {},
): Promise<ServingV3Fixture> => {
  const base = await createModelVariantNameSearchFixture(
    publicationId,
    generatedAtMs,
    options.modelDisplayName ?? "Älpha Model",
    options.includeVariant ?? false,
    true,
    options.modelStatus === undefined ? "active" : options.modelStatus,
    options.neutrality,
  );
  const { manifest, closureRows } = base;
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
  const storageProof = projectModelVariantNameSearchArtifactProofV1({
    staging: base.staging,
    observation: {
      storageVersion: base.persistence.storageVersion,
      rows: base.persistence.rows,
    },
  });
  const queryability =
    projectModelVariantNameSearchQueryabilityPlanV3(storageProof);
  const modelProof = projectModelVariantNameSearchQueryableArtifactProofV3({
    storageProof,
    queryability,
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
      mutationId: `fixture-v3-${publicationId}`,
      allIdsPresent: true,
      allNamespacesMatch: true,
      queryable: true,
    },
    {
      kind: "probes",
      binding,
      observedAt: iso(generatedAtMs + 5 * 60_000),
      probeSetVersion: "search-gold@3",
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
      projectReadinessReceiptProofV3({
        receipt,
        providerProof: receipt.kind === "serving" ? providerProof : null,
        modelVariantNameProof: receipt.kind === "serving" ? modelProof : null,
      }),
    ),
  );
  const readinessProof = await projectServingReadinessProofV3({
    manifest,
    receiptProofs,
    environment: "local",
    readyAtMs: generatedAtMs + 6 * 60_000,
    maximumReceiptAgeMs: MAXIMUM_AGE_MS,
  });
  const readinessCommit = await projectServingReadinessCommitV3({
    proof: readinessProof,
    closureRows,
    persistedSeal: seal,
    persistedProviderSearchDocuments: providerPersistence.documents,
    persistedProviderSearchFtsRows: providerPersistence.ftsRows,
    persistedModelVariantNameRows: base.persistence.rows,
  });
  return Object.freeze({
    base,
    seal,
    providerProjection,
    providerStaging,
    providerProof,
    modelProof,
    readinessProof,
    readinessCommit,
  });
};

export const sealServingV3Fixture = async (
  database: D1Database,
  fixture: ServingV3Fixture,
): Promise<void> => {
  const seal = fixture.seal;
  await database
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
    .run();
};
