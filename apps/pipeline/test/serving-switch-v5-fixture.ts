import {
  projectModelSlugArchiveArtifactProofV5,
  projectModelSlugProjection,
  projectModelSlugServingArtifactProofV5,
  projectReadinessReceiptProofV5,
  projectServingReadinessCommitV5,
  projectServingReadinessProofV5,
  readProviderModelIdSearchStagingPersistenceV1,
  readProviderSearchStagingPersistenceV2,
  type ArchiveReceiptV5,
  type ModelSlugArchiveArtifactProofV5,
  type ModelSlugArtifactProofStorageRowV5,
  type ModelSlugHistorySourceRow,
  type ModelSlugMappingStorageRowV5,
  type ModelSlugServingArtifactProofV5,
  type ProbeReceiptV5,
  type ReadinessReceiptV5,
  type ServingReadinessCommitProjectionV5,
  type ServingReadinessProofV5,
  type ServingReceiptV5,
  type TrustedModelSlugProjection,
} from "@quant-clarity/publication-core";
import type { TrustedModelSlugHistoryArchiveProof } from "../src/model-slug-history-archive.js";
import {
  createZeroModelProviderModelIdSearchFixture,
  type ProviderModelIdSearchFixture,
} from "./provider-model-id-search-fixture.js";

import {
  createServingV4Fixture,
  sealServingV4Fixture,
  type ServingV4Fixture,
} from "./serving-switch-v4-fixture.js";

const MAXIMUM_AGE_MS = 60 * 60 * 1_000;
const iso = (value: number): string => new Date(value).toISOString();
const id = (sequence: number): `slg_${string}` =>
  `slg_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;

export type ServingV5Fixture = Readonly<{
  v4: ServingV4Fixture;
  modelSlugProjection: TrustedModelSlugProjection;
  historyRows: readonly ModelSlugHistorySourceRow[];
  modelSlugArtifactProof: ModelSlugArtifactProofStorageRowV5;
  modelSlugMappings: readonly ModelSlugMappingStorageRowV5[];
  archiveProof: ModelSlugArchiveArtifactProofV5;
  servingProof: ModelSlugServingArtifactProofV5;
  readinessProof: ServingReadinessProofV5;
  readinessCommit: ServingReadinessCommitProjectionV5;
}>;

export const createServingV5Fixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
  operationalArchive?: TrustedModelSlugHistoryArchiveProof,
  providerModelIdFixtureOverride?: ProviderModelIdSearchFixture,
): Promise<ServingV5Fixture> => {
  const v4 = await createServingV4Fixture(
    publicationId,
    generatedAtMs,
    [],
    false,
    providerModelIdFixtureOverride,
  );
  const { manifest, closureRows } = v4.base;
  const modelResources = closureRows.resources.filter(
    (resource) => resource.resource_type === "model",
  );
  const historyRows = modelResources.flatMap((resource, index) => {
    const value = JSON.parse(resource.resource_json) as {
      slug: { state: string; value: string | null };
    };
    if (value.slug.state !== "known" || value.slug.value === null)
      throw new TypeError("v5 fixture Model slug is invalid");
    return [
      Object.freeze({
        slug_history_id: id(index * 2 + 1),
        resource_id: resource.resource_id,
        resource_type: "model" as const,
        slug: `legacy-${value.slug.value}`,
        valid_from_ms: generatedAtMs - 120_000,
        valid_to_ms: generatedAtMs - 1,
      }),
      Object.freeze({
        slug_history_id: id(index * 2 + 2),
        resource_id: resource.resource_id,
        resource_type: "model" as const,
        slug: value.slug.value,
        valid_from_ms: generatedAtMs,
        valid_to_ms: null,
      }),
    ];
  });
  const projected = await projectModelSlugProjection({
    manifest,
    resources: modelResources,
    historyRows,
  });
  const modelSlugProjection = operationalArchive?.projection ?? projected;
  if (
    modelSlugProjection.mappingInventoryHash !==
      projected.mappingInventoryHash ||
    (operationalArchive?.publicationId !== undefined &&
      operationalArchive.publicationId !== publicationId)
  )
    throw new TypeError("operational archive fixture does not match");
  const artifactDigest =
    operationalArchive?.artifactDigest ?? (`sha256:${"d".repeat(64)}` as const);
  const archiveProof = projectModelSlugArchiveArtifactProofV5({
    manifest,
    projection: modelSlugProjection,
    observation: {
      publicationId,
      closureHash: manifest.closureHash,
      baseBundleHash: manifest.bundleHash,
      publicationBoundaryMs: generatedAtMs,
      artifactVersion: "model-slug-history-artifact@1",
      acquisitionVersion: "model-slug-history-canonical@1",
      artifactDigest,
      artifactByteCount: operationalArchive?.artifactByteCount ?? 512,
      readVerified: true,
      immutable: true,
    },
  });
  const servingProof = projectModelSlugServingArtifactProofV5({
    archiveProof,
    projection: modelSlugProjection,
    observation: {
      publicationId,
      closureHash: manifest.closureHash,
      stagingRevision: closureRows.stagingRevision,
      storageVersion: "model-slug-serving@1",
      artifactDigest,
      queryable: true,
      exactParity: true,
    },
  });
  const binding = {
    environment: "local" as const,
    publicationId,
    closureHash: manifest.closureHash,
    bundleHash: manifest.bundleHash,
    schemaVersion: manifest.versions.schema,
    buildCommit: manifest.versions.buildCommit,
  };
  const archiveReceipt: ArchiveReceiptV5 = {
    kind: "archive",
    binding,
    observedAt: iso(generatedAtMs + 2 * 60_000),
    retainedBundleHash: manifest.bundleHash,
    immutable: true,
    modelSlugArtifactVersion: archiveProof.artifact_version,
    modelSlugAcquisitionVersion: archiveProof.acquisition_version,
    modelSlugProjectionVersion: archiveProof.projection_version,
    modelSlugArtifactDigest: archiveProof.artifact_digest,
    modelSlugArtifactByteCount: archiveProof.artifact_byte_count,
    modelSlugSourceHistoryCount: archiveProof.source_history_count,
    modelSlugSourceHistoryHash: archiveProof.source_history_hash,
    modelSlugModelCount: archiveProof.model_count,
    modelSlugMappingCount: archiveProof.mapping_count,
    modelSlugCurrentMappingCount: archiveProof.current_mapping_count,
    modelSlugHistoricalMappingCount: archiveProof.historical_mapping_count,
    modelSlugMappingInventoryHash: archiveProof.mapping_inventory_hash,
    modelSlugReadVerified: true,
    modelSlugImmutable: true,
  };
  const servingReceipt: ServingReceiptV5 = {
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
    modelSlugStorageVersion: servingProof.storage_version,
    modelSlugArtifactDigest: servingProof.artifact_digest,
    modelSlugProjectionVersion: servingProof.projection_version,
    modelSlugModelCount: servingProof.model_count,
    modelSlugMappingCount: servingProof.mapping_count,
    modelSlugCurrentMappingCount: servingProof.current_mapping_count,
    modelSlugHistoricalMappingCount: servingProof.historical_mapping_count,
    modelSlugMappingInventoryHash: servingProof.mapping_inventory_hash,
    modelSlugQueryable: true,
    modelSlugExactParity: true,
  };
  const probeReceipt: ProbeReceiptV5 = {
    kind: "probes",
    binding,
    observedAt: iso(generatedAtMs + 5 * 60_000),
    probeSetVersion: "search-gold@5",
    integrityPassed: true,
    evidenceCoveragePassed: true,
    exactSearchPassed: true,
    semanticSearchPassed: true,
    structuredFilterPassed: true,
    neutralityPassed: true,
    versionIsolationPassed: true,
    modelSlugLookupPassed: true,
  };
  const evidence: ReadinessReceiptV5[] = [
    archiveReceipt,
    servingReceipt,
    {
      kind: "vectors",
      binding,
      observedAt: iso(generatedAtMs + 4 * 60_000),
      namespace: publicationId,
      documentCount: manifest.vectors.length,
      verifiedDocumentCount: manifest.vectors.length,
      vectorInventoryHash: manifest.vectorInventoryHash,
      visibilityProbeVersion: "vector-visibility@1",
      mutationId: `fixture-v5-${publicationId}`,
      allIdsPresent: true,
      allNamespacesMatch: true,
      queryable: true,
    },
    probeReceipt,
  ];
  const receiptProofs = await Promise.all(
    evidence.map((receipt) =>
      projectReadinessReceiptProofV5({
        receipt,
        providerProof: receipt.kind === "serving" ? v4.providerProof : null,
        modelVariantNameProof:
          receipt.kind === "serving" ? v4.modelProof : null,
        providerModelIdProof:
          receipt.kind === "serving" ? v4.providerModelIdProof : null,
        modelSlugArchiveProof: receipt.kind === "archive" ? archiveProof : null,
        modelSlugServingProof: receipt.kind === "serving" ? servingProof : null,
      }),
    ),
  );
  const readinessProof = await projectServingReadinessProofV5({
    manifest,
    receiptProofs,
    environment: "local",
    readyAtMs: generatedAtMs + 6 * 60_000,
    maximumReceiptAgeMs: MAXIMUM_AGE_MS,
  });
  const modelSlugArtifactProof = Object.freeze({
    publication_id: publicationId,
    staging_revision: servingProof.staging_revision,
    artifact_version: archiveProof.artifact_version,
    acquisition_version: archiveProof.acquisition_version,
    projection_version: archiveProof.projection_version,
    base_bundle_hash: archiveProof.base_bundle_hash,
    closure_hash: archiveProof.closure_hash,
    publication_boundary_ms: archiveProof.publication_boundary_ms,
    artifact_digest: archiveProof.artifact_digest,
    artifact_byte_count: archiveProof.artifact_byte_count,
    model_count: archiveProof.model_count,
    source_history_count: archiveProof.source_history_count,
    source_history_hash: archiveProof.source_history_hash,
    mapping_count: archiveProof.mapping_count,
    current_mapping_count: archiveProof.current_mapping_count,
    historical_mapping_count: archiveProof.historical_mapping_count,
    mapping_inventory_hash: archiveProof.mapping_inventory_hash,
  } satisfies ModelSlugArtifactProofStorageRowV5);
  const modelSlugMappings = Object.freeze(
    modelSlugProjection.mappings.map((mapping) =>
      Object.freeze({
        publication_id: publicationId,
        slug: mapping.slug,
        target_resource_type: "model" as const,
        model_id: mapping.modelId,
        projection_version: mapping.projectionVersion,
        resolution: mapping.resolution,
        target_content_hash: mapping.targetContentHash,
      }),
    ),
  );
  const readinessCommit = await projectServingReadinessCommitV5({
    proof: readinessProof,
    closureRows,
    persistedSeal: v4.seal,
    persistedProviderSearchDocuments: readProviderSearchStagingPersistenceV2(
      v4.providerStaging,
    ).documents,
    persistedProviderSearchFtsRows: readProviderSearchStagingPersistenceV2(
      v4.providerStaging,
    ).ftsRows,
    persistedModelVariantNameRows: v4.base.persistence.rows,
    persistedProviderModelIdRows: readProviderModelIdSearchStagingPersistenceV1(
      v4.providerModelIdStaging,
    ).rows,
    persistedModelSlugArtifactProof: modelSlugArtifactProof,
    persistedModelSlugMappings: modelSlugMappings,
  });
  return Object.freeze({
    v4,
    modelSlugProjection,
    historyRows,
    modelSlugArtifactProof,
    modelSlugMappings,
    archiveProof,
    servingProof,
    readinessProof,
    readinessCommit,
  });
};

export const createZeroModelServingV5Fixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
  operationalArchive?: TrustedModelSlugHistoryArchiveProof,
): Promise<ServingV5Fixture> =>
  createServingV5Fixture(
    publicationId,
    generatedAtMs,
    operationalArchive,
    await createZeroModelProviderModelIdSearchFixture(
      publicationId,
      generatedAtMs,
    ),
  );

export const stageAndSealServingV5Fixture = async (
  database: D1Database,
  fixture: ServingV5Fixture,
): Promise<void> => {
  for (const mapping of fixture.modelSlugMappings)
    await database
      .prepare(
        `INSERT INTO publication_model_slug_mapping
         (publication_id, slug, target_resource_type, model_id,
          projection_version, resolution, target_content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(...Object.values(mapping))
      .run();
  await database
    .prepare(
      `INSERT INTO publication_model_slug_artifact_proof VALUES
       (${Array.from({ length: 17 }, () => "?").join(",")})`,
    )
    .bind(...Object.values(fixture.modelSlugArtifactProof))
    .run();
  await sealServingV4Fixture(database, fixture.v4);
};
