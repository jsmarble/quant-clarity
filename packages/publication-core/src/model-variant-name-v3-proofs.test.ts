import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  MODEL_VARIANT_NAME_SEARCH_EXACT_INDEX_NAME,
  PROVIDER_SEARCH_FTS_BUILD_VERSION,
  READINESS_PROBE_SET_VERSION_V2,
  READINESS_PROBE_SET_VERSION_V3,
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  classifyServingReadinessCommitRetryV3,
  classifyServingSwitchRetryV3,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  modelVariantNameSearchProofFieldsV3,
  projectModelVariantNameSearchArtifactProofV1,
  projectModelVariantNameSearchProjection,
  projectModelVariantNameSearchQueryabilityPlanV3,
  projectModelVariantNameSearchQueryableArtifactProofV3,
  projectModelVariantNameSearchStagingV1,
  projectProviderSearchArtifactProofV2,
  projectProviderSearchProjection,
  projectReadinessReceiptProofV2,
  projectReadinessReceiptProofV3,
  projectServingClosureSeal,
  projectServingReadinessCommitV3,
  projectServingReadinessProofV3,
  projectServingSwitchV3,
  projectServingSwitchPreflightProofV2,
  projectServingSwitchPreflightProofV3,
  readModelVariantNameSearchStagingPersistenceV1,
  readServingReadinessCommitPersistenceV3,
  readServingSwitchPersistenceV3,
  reconstructServingReadinessProofV3FromPersistence,
  type ArtifactBinding,
  type CanonicalField,
  type ProviderSearchArtifactProofV2,
  type ReadinessReceipt,
  type ServingClosureRows,
  type ServingReceipt,
  type ServingSwitchArtifactProofV2,
  type ServingSwitchArtifactProofV3,
  type ServingSwitchPreflightProofV3,
} from "./index.js";

const publicationId = "pub_00000001-0000-4000-8000-000000000001" as const;
const observedAt = "2026-08-02T00:00:00.000Z";
const receiptTimes = [30, 31, 32, 33].map(
  (minute) => `2026-08-02T00:${String(minute)}:00.000Z`,
);

type IndependentField = Readonly<{
  name: string;
  type: string;
  value: string;
}>;

function uint64(value: number): Buffer {
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(BigInt(value));
  return result;
}

function independentHash(
  domain: string,
  fields: readonly IndependentField[],
): string {
  const all = [
    { name: "hash_domain", type: "text", value: domain },
    { name: "encoding_version", type: "integer", value: "1" },
    ...fields,
  ];
  const encoded = Buffer.concat(
    all.flatMap((entry) =>
      [entry.name, entry.type, entry.value].flatMap((value) => {
        const bytes = Buffer.from(value, "utf8");
        return [uint64(bytes.length), bytes];
      }),
    ),
  );
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}

const independentField = (
  name: string,
  type: string,
  value: string | number | boolean,
): IndependentField => ({ name, type, value: String(value) });

function providerFields(
  proof: ProviderSearchArtifactProofV2,
): IndependentField[] {
  return [
    independentField(
      "provider_search_projection_version",
      "text",
      proof.provider_search_projection_version,
    ),
    independentField(
      "provider_search_document_count",
      "integer",
      proof.provider_search_document_count,
    ),
    independentField(
      "provider_search_inventory_hash",
      "digest",
      proof.provider_search_inventory_hash,
    ),
    independentField(
      "provider_search_fts_build_version",
      "text",
      proof.provider_search_fts_build_version,
    ),
    independentField(
      "provider_search_fts_document_count",
      "integer",
      proof.provider_search_fts_document_count,
    ),
    independentField(
      "provider_search_fts_queryable",
      "boolean",
      proof.provider_search_fts_queryable,
    ),
    independentField(
      "provider_search_exact_parity",
      "boolean",
      proof.provider_search_exact_parity,
    ),
  ];
}

function modelFields(fields: readonly CanonicalField[]): IndependentField[] {
  return fields.map(({ name, type, value }) => ({ name, type, value }));
}

function receiptSpecificFields(receipt: ReadinessReceipt): IndependentField[] {
  switch (receipt.kind) {
    case "archive":
      return [
        independentField(
          "retained_bundle_hash",
          "digest",
          receipt.retainedBundleHash,
        ),
        independentField("immutable", "boolean", receipt.immutable),
      ];
    case "serving":
      return [
        independentField(
          "enabled_provider_count",
          "integer",
          receipt.enabledProviderCount,
        ),
        independentField(
          "enabled_provider_scope_hash",
          "digest",
          receipt.enabledProviderScopeHash,
        ),
        independentField(
          "provider_slice_count",
          "integer",
          receipt.providerSliceCount,
        ),
        independentField(
          "provider_slice_hash",
          "digest",
          receipt.providerSliceHash,
        ),
        independentField(
          "provider_attribution_count",
          "integer",
          receipt.providerAttributionCount,
        ),
        independentField(
          "provider_attribution_hash",
          "digest",
          receipt.providerAttributionHash,
        ),
        independentField("resource_count", "integer", receipt.resourceCount),
        independentField(
          "exact_document_count",
          "integer",
          receipt.exactDocumentCount,
        ),
        independentField(
          "resource_inventory_hash",
          "digest",
          receipt.resourceInventoryHash,
        ),
        independentField(
          "exact_search_inventory_hash",
          "digest",
          receipt.exactSearchInventoryHash,
        ),
        independentField("fts_build_version", "text", receipt.ftsBuildVersion),
        independentField(
          "fts_document_count",
          "integer",
          receipt.ftsDocumentCount,
        ),
        independentField("fts_queryable", "boolean", receipt.ftsQueryable),
        independentField(
          "foreign_keys_valid",
          "boolean",
          receipt.foreignKeysValid,
        ),
        independentField(
          "content_hashes_valid",
          "boolean",
          receipt.contentHashesValid,
        ),
        independentField(
          "unavailable_provider_isolation_valid",
          "boolean",
          receipt.unavailableProviderIsolationValid,
        ),
      ];
    case "vectors":
      return [
        independentField("namespace", "identifier", receipt.namespace),
        independentField("document_count", "integer", receipt.documentCount),
        independentField(
          "verified_document_count",
          "integer",
          receipt.verifiedDocumentCount,
        ),
        independentField(
          "vector_inventory_hash",
          "digest",
          receipt.vectorInventoryHash,
        ),
        independentField(
          "visibility_probe_version",
          "text",
          receipt.visibilityProbeVersion,
        ),
        independentField("mutation_id", "text", receipt.mutationId),
        independentField("all_ids_present", "boolean", receipt.allIdsPresent),
        independentField(
          "all_namespaces_match",
          "boolean",
          receipt.allNamespacesMatch,
        ),
        independentField("queryable", "boolean", receipt.queryable),
      ];
    case "probes":
      return [
        independentField("probe_set_version", "text", receipt.probeSetVersion),
        independentField(
          "integrity_passed",
          "boolean",
          receipt.integrityPassed,
        ),
        independentField(
          "evidence_coverage_passed",
          "boolean",
          receipt.evidenceCoveragePassed,
        ),
        independentField(
          "exact_search_passed",
          "boolean",
          receipt.exactSearchPassed,
        ),
        independentField(
          "semantic_search_passed",
          "boolean",
          receipt.semanticSearchPassed,
        ),
        independentField(
          "structured_filter_passed",
          "boolean",
          receipt.structuredFilterPassed,
        ),
        independentField(
          "neutrality_passed",
          "boolean",
          receipt.neutralityPassed,
        ),
        independentField(
          "version_isolation_passed",
          "boolean",
          receipt.versionIsolationPassed,
        ),
      ];
  }
}

function independentReceiptHash(
  receipt: ReadinessReceipt,
  suffix: readonly IndependentField[],
): string {
  return independentHash("publication-readiness-receipt", [
    independentField("receipt_version", "text", "3.0.0"),
    independentField("kind", "text", receipt.kind),
    independentField("environment", "text", receipt.binding.environment),
    independentField(
      "publication_id",
      "identifier",
      receipt.binding.publicationId,
    ),
    independentField("closure_hash", "digest", receipt.binding.closureHash),
    independentField("bundle_hash", "digest", receipt.binding.bundleHash),
    independentField("schema_version", "text", receipt.binding.schemaVersion),
    independentField("build_commit", "text", receipt.binding.buildCommit),
    independentField("observed_at", "timestamp", receipt.observedAt),
    ...receiptSpecificFields(receipt),
    ...(receipt.kind === "serving" ? suffix : []),
  ]);
}

function independentPreflightHash(
  proof: ServingSwitchPreflightProofV3,
): string {
  const nullable = (
    name: string,
    type: string,
    value: string | null,
  ): IndependentField =>
    value === null
      ? independentField(name, "null", "null")
      : independentField(name, type, value);
  return independentHash("publication-switch-preflight", [
    independentField("preflight_version", "text", "3.0.0"),
    independentField("action", "text", proof.action),
    independentField("environment", "text", proof.environment),
    independentField(
      "expected_prior_generation",
      "integer",
      proof.expected_prior_generation,
    ),
    nullable(
      "expected_prior_rollback_candidate_publication_id",
      "identifier",
      proof.expected_prior_rollback_candidate_publication_id,
    ),
    nullable(
      "expected_prior_switched_at",
      "timestamp",
      proof.expected_prior_switched_at_ms === null
        ? null
        : new Date(proof.expected_prior_switched_at_ms).toISOString(),
    ),
    independentField("new_generation", "integer", proof.new_generation),
    nullable("from_publication_id", "identifier", proof.from_publication_id),
    nullable("from_closure_hash", "digest", proof.from_closure_hash),
    independentField(
      "to_publication_id",
      "identifier",
      proof.to_publication_id,
    ),
    independentField("to_closure_hash", "digest", proof.to_closure_hash),
    nullable("to_attestation_hash", "digest", proof.to_attestation_hash),
    independentField(
      "switched_at",
      "timestamp",
      new Date(proof.switched_at_ms).toISOString(),
    ),
    independentField(
      "observed_at",
      "timestamp",
      new Date(proof.observed_at_ms).toISOString(),
    ),
    independentField("maximum_age_ms", "integer", proof.maximum_age_ms),
    independentField(
      "valid_until",
      "timestamp",
      new Date(proof.valid_until_ms).toISOString(),
    ),
    independentField("fts_build_version", "text", proof.fts_build_version),
    independentField(
      "fts_source_document_count",
      "integer",
      proof.fts_source_document_count,
    ),
    independentField(
      "fts_index_document_count",
      "integer",
      proof.fts_index_document_count,
    ),
    independentField(
      "fts_source_inventory_hash",
      "digest",
      proof.fts_source_inventory_hash,
    ),
    independentField("fts_exact_parity", "boolean", true),
    independentField(
      "archive_bundle_hash",
      "digest",
      proof.archive_bundle_hash,
    ),
    independentField("archive_immutable", "boolean", true),
    independentField("vector_namespace", "identifier", proof.vector_namespace),
    independentField(
      "vector_document_count",
      "integer",
      proof.vector_document_count,
    ),
    independentField(
      "vector_verified_document_count",
      "integer",
      proof.vector_verified_document_count,
    ),
    independentField(
      "vector_inventory_hash",
      "digest",
      proof.vector_inventory_hash,
    ),
    independentField(
      "vector_visibility_probe_version",
      "text",
      proof.vector_visibility_probe_version,
    ),
    independentField("vector_mutation_id", "text", proof.vector_mutation_id),
    independentField("vector_all_ids_present", "boolean", true),
    independentField("vector_all_namespaces_match", "boolean", true),
    independentField("vector_queryable", "boolean", true),
    independentField(
      "probe_set_version",
      "text",
      READINESS_PROBE_SET_VERSION_V3,
    ),
    independentField("integrity_passed", "boolean", true),
    independentField("exact_search_passed", "boolean", true),
    independentField("semantic_search_passed", "boolean", true),
    independentField("structured_filter_passed", "boolean", true),
    independentField("neutrality_passed", "boolean", true),
    independentField("version_isolation_passed", "boolean", true),
    independentField(
      "provider_search_projection_version",
      "text",
      proof.provider_search_projection_version,
    ),
    independentField(
      "provider_search_document_count",
      "integer",
      proof.provider_search_document_count,
    ),
    independentField(
      "provider_search_inventory_hash",
      "digest",
      proof.provider_search_inventory_hash,
    ),
    independentField(
      "provider_search_fts_build_version",
      "text",
      proof.provider_search_fts_build_version,
    ),
    independentField(
      "provider_search_fts_document_count",
      "integer",
      proof.provider_search_fts_document_count,
    ),
    independentField("provider_search_fts_queryable", "boolean", true),
    independentField("provider_search_exact_parity", "boolean", true),
    independentField(
      "model_variant_name_projection_version",
      "text",
      proof.model_variant_name_projection_version,
    ),
    independentField(
      "model_variant_name_document_count",
      "integer",
      proof.model_variant_name_document_count,
    ),
    independentField(
      "model_variant_name_inventory_hash",
      "digest",
      proof.model_variant_name_inventory_hash,
    ),
    independentField(
      "model_variant_name_storage_version",
      "text",
      proof.model_variant_name_storage_version,
    ),
    independentField(
      "model_variant_name_storage_document_count",
      "integer",
      proof.model_variant_name_storage_document_count,
    ),
    independentField("model_variant_name_storage_queryable", "boolean", true),
    independentField(
      "model_variant_name_storage_exact_parity",
      "boolean",
      true,
    ),
  ]);
}

function independentAttestationHash(
  value: Awaited<ReturnType<typeof fixture>>["readinessProof"]["attestation"],
): string {
  return independentHash("publication-readiness-attestation", [
    independentField("evaluator_version", "text", "3.0.0"),
    independentField("environment", "text", value.environment),
    independentField("publication_id", "identifier", value.publication_id),
    independentField("closure_hash", "digest", value.closure_hash),
    independentField("bundle_hash", "digest", value.bundle_hash),
    independentField(
      "ready_at",
      "timestamp",
      new Date(value.ready_at_ms).toISOString(),
    ),
    independentField(
      "maximum_receipt_age_ms",
      "integer",
      value.maximum_receipt_age_ms,
    ),
    independentField(
      "effective_valid_until",
      "timestamp",
      new Date(value.effective_valid_until_ms).toISOString(),
    ),
    independentField(
      "archive_receipt_hash",
      "digest",
      value.archive_receipt_hash,
    ),
    independentField(
      "serving_receipt_hash",
      "digest",
      value.serving_receipt_hash,
    ),
    independentField(
      "vector_receipt_hash",
      "digest",
      value.vector_receipt_hash,
    ),
    independentField(
      "probes_receipt_hash",
      "digest",
      value.probes_receipt_hash,
    ),
  ]);
}

async function fixture(
  candidatePublicationId: `pub_${string}` = publicationId,
) {
  const providerId = "prv_00000001-0000-4000-8000-000000000001";
  const evidenceId = "evd_00000001-0000-4000-8000-000000000001";
  const fact = (value: string) => ({
    evidence_ids: [evidenceId],
    observed_at: observedAt,
    state: "known",
    value,
  });
  const providerJson = canonicalizePublicationJson(
    JSON.stringify({
      active_offering_count: {
        derivation_version: "provider-count@1",
        observed_at: observedAt,
        value: 0,
      },
      affiliate_relationship_present: false,
      display_name: fact("Proof Provider"),
      last_successful_refresh: fact(observedAt),
      official_site: fact("https://provider.example"),
      precision_coverage: {
        derivation_version: "precision-coverage@1",
        known_count: 0,
        known_proportion_decimal: "0",
        unknown_count: 0,
      },
      provider_id: providerId,
      slug: fact("proof-provider"),
      status: fact("active"),
    }),
    "object",
  );
  const providerContentHash = await hashPublicationResourceContent({
    resourceType: "provider",
    resourceId: providerId,
    resourceJson: providerJson,
  });
  const providerResource = {
    resource_type: "provider" as const,
    resource_id: providerId,
    resource_json: providerJson,
    content_hash: providerContentHash,
  };
  const resourceChunkHash = await hashPublicationResourceChunk([
    {
      resourceType: "provider",
      resourceId: providerId,
      contentHash: providerContentHash,
    },
  ]);
  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: "1.0.0",
    publicationId: candidatePublicationId,
    sourceRunId: "run_00000001-0000-4000-8000-000000000001",
    parentPublicationId: null,
    generatedAt: observedAt,
    versions: {
      schema: "1.4.0",
      methodology: "1.0.0",
      precisionNormalization: "1.0.0",
      precisionDisplayOrder: "1.0.0",
      pricePolicy: "1.0.0",
      sourcePolicy: "1.0.0",
      embedding: "embedding@1",
      buildCommit: "test-commit",
    },
    enabledProviderScopeVersion: "provider-scope@1",
    enabledProviderIds: [providerId],
    providerSlices: [
      {
        providerId,
        providerSliceId: "prn_00000001-0000-4000-8000-000000000001",
        providerRunId: "pvr_00000001-0000-4000-8000-000000000001",
        adapterVersion: "adapter@1",
        rosterVersion: "roster@1",
        sourceRegisterVersion: "sources@1",
        carriedForward: false,
        freshnessState: "fresh",
      },
    ],
    providerAttributions: [
      {
        resourceType: "provider",
        resourceId: providerId,
        providerId,
      },
    ],
    resources: [
      {
        resourceType: "provider",
        resourceId: providerId,
        resourceJson: providerJson,
        contentHash: providerContentHash,
      },
    ],
    searchDocuments: [],
    vectors: [],
    chunks: [
      {
        kind: "resources",
        ordinal: 0,
        firstKey: `provider:${providerId}`,
        lastKey: `provider:${providerId}`,
        itemCount: 1,
        contentHash: resourceChunkHash,
      },
    ],
    bundleHash: `sha256:${"b".repeat(64)}`,
  });
  const closureRows: ServingClosureRows = {
    publication: {
      publication_id: manifest.publicationId,
      source_run_id: manifest.sourceRunId,
      parent_publication_id: manifest.parentPublicationId,
      generated_at_ms: Date.parse(manifest.generatedAt),
      schema_version: manifest.versions.schema,
      methodology_version: manifest.versions.methodology,
      precision_normalization_version: manifest.versions.precisionNormalization,
      precision_display_order_version: manifest.versions.precisionDisplayOrder,
      price_policy_version: manifest.versions.pricePolicy,
      source_policy_version: manifest.versions.sourcePolicy,
      embedding_version: manifest.versions.embedding,
      build_commit: manifest.versions.buildCommit,
      closure_hash: manifest.closureHash,
    },
    providerSlices: manifest.providerSlices.map((row) => ({
      provider_id: row.providerId,
      provider_slice_id: row.providerSliceId,
      provider_run_id: row.providerRunId,
      adapter_version: row.adapterVersion,
      roster_version: row.rosterVersion,
      source_register_version: row.sourceRegisterVersion,
      carried_forward: row.carriedForward ? 1 : 0,
      freshness_state: row.freshnessState,
    })),
    providerAttributions: manifest.providerAttributions.map((row) => ({
      resource_type: row.resourceType,
      resource_id: row.resourceId,
      provider_id: row.providerId,
    })),
    resources: [providerResource],
    searchDocuments: [],
    vectors: [],
    chunks: manifest.chunks.map((row) => ({
      kind: row.kind,
      ordinal: row.ordinal,
      first_key: row.firstKey,
      last_key: row.lastKey,
      item_count: row.itemCount,
      content_hash: row.contentHash,
    })),
    manifestContractVersion: "1.0.0",
    enabledProviderScopeVersion: manifest.enabledProviderScopeVersion,
    bundleHash: manifest.bundleHash,
    stagingRevision: 1,
    sealedAtMs: Date.parse(observedAt) + 60_000,
  };
  const providerProjection = await projectProviderSearchProjection({
    manifest,
    providerResources: [providerResource],
  });
  const providerProof = projectProviderSearchArtifactProofV2({
    manifest,
    projection: providerProjection,
    fts: {
      buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
      documentCount: providerProjection.documentCount,
      queryable: true,
      exactParity: true,
    },
  });
  const modelProjection = await projectModelVariantNameSearchProjection({
    manifest,
    resources: [],
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
  const queryability =
    projectModelVariantNameSearchQueryabilityPlanV3(modelStorageProof);
  const modelProof = projectModelVariantNameSearchQueryableArtifactProofV3({
    storageProof: modelStorageProof,
    queryability,
  });
  const binding: ArtifactBinding = {
    environment: "local",
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    bundleHash: manifest.bundleHash,
    schemaVersion: manifest.versions.schema,
    buildCommit: manifest.versions.buildCommit,
  };
  const receipts: ReadinessReceipt[] = [
    {
      kind: "archive",
      binding,
      observedAt: receiptTimes[0]!,
      retainedBundleHash: manifest.bundleHash,
      immutable: true,
    },
    {
      kind: "serving",
      binding,
      observedAt: receiptTimes[1]!,
      enabledProviderCount: manifest.enabledProviderIds.length,
      enabledProviderScopeHash: manifest.enabledProviderScopeHash,
      providerSliceCount: manifest.providerSlices.length,
      providerSliceHash: manifest.providerSliceHash,
      providerAttributionCount: manifest.providerAttributions.length,
      providerAttributionHash: manifest.providerAttributionHash,
      resourceCount: manifest.resources.length,
      exactDocumentCount: 0,
      resourceInventoryHash: manifest.resourceInventoryHash,
      exactSearchInventoryHash: manifest.exactSearchInventoryHash,
      ftsBuildVersion: "fts5-unicode61@1",
      ftsDocumentCount: 0,
      ftsQueryable: true,
      foreignKeysValid: true,
      contentHashesValid: true,
      unavailableProviderIsolationValid: true,
    },
    {
      kind: "vectors",
      binding,
      observedAt: receiptTimes[2]!,
      namespace: manifest.publicationId,
      documentCount: 0,
      verifiedDocumentCount: 0,
      vectorInventoryHash: manifest.vectorInventoryHash,
      visibilityProbeVersion: "vector-visibility@1",
      mutationId: "v3-test-mutation",
      allIdsPresent: true,
      allNamespacesMatch: true,
      queryable: true,
    },
    {
      kind: "probes",
      binding,
      observedAt: receiptTimes[3]!,
      probeSetVersion: READINESS_PROBE_SET_VERSION_V3,
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
    receipts.map((receipt) =>
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
    readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
    maximumReceiptAgeMs: 60 * 60 * 1000,
  });
  return {
    manifest,
    closureRows,
    providerProjection,
    providerProof,
    modelStaging,
    modelPersistence,
    modelStorageProof,
    modelProof,
    queryability,
    receipts,
    receiptProofs,
    readinessProof,
  };
}

function artifactProof(
  source: Awaited<ReturnType<typeof fixture>>,
  version: typeof READINESS_PROBE_SET_VERSION_V3,
): ServingSwitchArtifactProofV3;
function artifactProof(
  source: Awaited<ReturnType<typeof fixture>>,
  version: typeof READINESS_PROBE_SET_VERSION_V2,
): ServingSwitchArtifactProofV2;
function artifactProof(
  source: Awaited<ReturnType<typeof fixture>>,
  version:
    | typeof READINESS_PROBE_SET_VERSION_V2
    | typeof READINESS_PROBE_SET_VERSION_V3,
): ServingSwitchArtifactProofV2 | ServingSwitchArtifactProofV3 {
  return {
    environment: "local",
    observedAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
    maximumAgeMs: 60 * 60 * 1000,
    ftsBuildVersion: "fts5-unicode61@1",
    ftsSourceDocumentCount: 0,
    ftsIndexDocumentCount: 0,
    ftsSourceInventoryHash: source.manifest.exactSearchInventoryHash,
    ftsExactParity: true,
    archiveBundleHash: source.manifest.bundleHash,
    archiveImmutable: true,
    vectorNamespace: source.manifest.publicationId,
    vectorDocumentCount: 0,
    vectorVerifiedDocumentCount: 0,
    vectorInventoryHash: source.manifest.vectorInventoryHash,
    vectorVisibilityProbeVersion: "vector-visibility@1",
    vectorMutationId: "v3-switch-mutation",
    vectorAllIdsPresent: true,
    vectorAllNamespacesMatch: true,
    vectorQueryable: true,
    probeSetVersion: version,
    integrityPassed: true,
    exactSearchPassed: true,
    semanticSearchPassed: true,
    structuredFilterPassed: true,
    neutralityPassed: true,
    versionIsolationPassed: true,
  };
}

describe("publication-core v3 search integrity proofs (ADR 0026)", () => {
  it("snapshots rotating top-level nominal authority getters exactly once", async () => {
    const source = await fixture();
    const other = await fixture("pub_00000009-0000-4000-8000-000000000001");

    let storageProofReads = 0;
    const queryable = projectModelVariantNameSearchQueryableArtifactProofV3({
      get storageProof() {
        storageProofReads += 1;
        return storageProofReads === 1
          ? source.modelStorageProof
          : other.modelStorageProof;
      },
      queryability: source.queryability,
    });
    expect(storageProofReads).toBe(1);
    expect(queryable.model_variant_name_inventory_hash).toBe(
      source.modelProof.model_variant_name_inventory_hash,
    );

    let manifestReads = 0;
    const readiness = await projectServingReadinessProofV3({
      get manifest() {
        manifestReads += 1;
        return manifestReads === 1 ? source.manifest : other.manifest;
      },
      receiptProofs: source.receiptProofs,
      environment: "local",
      readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
      maximumReceiptAgeMs: 60 * 60 * 1000,
    });
    expect(manifestReads).toBe(1);
    expect(readiness.attestation.publication_id).toBe(
      source.manifest.publicationId,
    );

    let preflightManifestReads = 0;
    const preflight = await projectServingSwitchPreflightProofV3({
      get manifest() {
        preflightManifestReads += 1;
        return preflightManifestReads === 1 ? source.manifest : other.manifest;
      },
      providerProof: source.providerProof,
      modelVariantNameProof: source.modelProof,
      readinessProof: source.readinessProof,
      context: {
        switchId: `publication-switch|activate|1|${source.manifest.publicationId}|${source.manifest.closureHash}`,
        action: "activate",
        expectedPriorGeneration: 0,
        expectedPriorRollbackCandidatePublicationId: null,
        expectedPriorSwitchedAtMs: null,
        newGeneration: 1,
        fromPublicationId: null,
        fromClosureHash: null,
        toPublicationId: source.manifest.publicationId,
        toClosureHash: source.manifest.closureHash,
        switchedAtMs: Date.parse("2026-08-02T00:35:00.000Z"),
      },
      artifactProof: artifactProof(source, READINESS_PROBE_SET_VERSION_V3),
    });
    expect(preflightManifestReads).toBe(1);
    expect(preflight.to_publication_id).toBe(source.manifest.publicationId);

    const closure = await projectServingClosureSeal(source.closureRows);
    const providerDocuments = source.providerProjection.documents.map(
      (document) => ({
        publication_id: source.providerProjection.publicationId,
        provider_id: document.providerId,
        projection_version: document.projectionVersion,
        display_name: document.displayName,
        normalized_name: document.normalizedName,
        provider_resource_content_hash: document.providerResourceContentHash,
      }),
    );
    const providerFtsRows = providerDocuments.map((document) => ({
      publication_id: document.publication_id,
      provider_id: document.provider_id,
      display_name: document.display_name,
    }));
    let commitProofReads = 0;
    const commitProjection = await projectServingReadinessCommitV3({
      get proof() {
        commitProofReads += 1;
        return commitProofReads === 1
          ? source.readinessProof
          : other.readinessProof;
      },
      closureRows: source.closureRows,
      persistedSeal: closure.seal,
      persistedProviderSearchDocuments: providerDocuments,
      persistedProviderSearchFtsRows: providerFtsRows,
      persistedModelVariantNameRows: source.modelPersistence.rows,
    });
    expect(commitProofReads).toBe(1);
    const commit = readServingReadinessCommitPersistenceV3(commitProjection);
    let reconstructManifestReads = 0;
    const reconstructed =
      await reconstructServingReadinessProofV3FromPersistence({
        get manifest() {
          reconstructManifestReads += 1;
          return reconstructManifestReads === 1
            ? source.manifest
            : other.manifest;
        },
        providerProjection: source.providerProjection,
        providerFts: {
          buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
          documentCount: source.providerProjection.documentCount,
          queryable: true,
          exactParity: true,
        },
        providerSearchDocuments: providerDocuments,
        providerSearchFtsRows: providerFtsRows,
        modelVariantNameStaging: source.modelStaging,
        modelVariantNameStorage: {
          storageVersion: source.modelPersistence.storageVersion,
          rows: source.modelPersistence.rows,
        },
        modelVariantNameQueryability: source.queryability,
        receiptRows: commit.receiptRows,
        attestation: commit.attestation,
      });
    expect(reconstructManifestReads).toBe(1);
    expect(reconstructed.attestation.publication_id).toBe(
      source.manifest.publicationId,
    );

    let switchPreflightReads = 0;
    const activation = await projectServingSwitchV3({
      get preflight() {
        switchPreflightReads += 1;
        return switchPreflightReads === 1 ? preflight : (null as never);
      },
      target: {
        publicationId: source.manifest.publicationId,
        closureHash: source.manifest.closureHash,
        state: "ready",
        generatedAt: source.manifest.generatedAt,
        readyAt: new Date(commit.transition.ready_at_ms).toISOString(),
        firstActivatedAt: null,
        lastHeadReferencedAt: null,
      },
      currentHead: null,
      currentActive: null,
      authorizedBy: { kind: "pipeline", identityId: "pipeline.test" },
      closureRows: source.closureRows,
      persistedSeal: closure.seal,
      persistedProviderSearchDocuments: providerDocuments,
      persistedProviderSearchFtsRows: providerFtsRows,
      persistedModelVariantNameRows: source.modelPersistence.rows,
      persistedReceiptRows: commit.receiptRows,
      persistedAttestation: commit.attestation,
    });
    expect(switchPreflightReads).toBe(1);
    expect(readServingSwitchPersistenceV3(activation).history.action).toBe(
      "activate",
    );
  });

  it("matches an independent receipt oracle for all kinds and appends exactly seven model fields", async () => {
    const source = await fixture();
    const suffix = [
      ...providerFields(source.providerProof),
      ...modelFields(modelVariantNameSearchProofFieldsV3(source.modelProof)),
    ];
    expect(suffix.slice(7).map((entry) => entry.name)).toEqual([
      "model_variant_name_projection_version",
      "model_variant_name_document_count",
      "model_variant_name_inventory_hash",
      "model_variant_name_storage_version",
      "model_variant_name_storage_document_count",
      "model_variant_name_storage_queryable",
      "model_variant_name_storage_exact_parity",
    ]);
    expect(Object.keys(source.receiptProofs[1]!)).toHaveLength(8);
    for (const [index, receipt] of source.receipts.entries()) {
      expect(source.receiptProofs[index]!.receipt_hash).toBe(
        independentReceiptHash(receipt, suffix),
      );
    }
    expect(source.readinessProof.attestation.attestation_hash).toBe(
      independentAttestationHash(source.readinessProof.attestation),
    );
  });

  it("rejects v2, copied, forged, and mismatched search authority", async () => {
    const source = await fixture();
    const serving = source.receipts[1] as ServingReceipt;
    const v2 = await projectReadinessReceiptProofV2({
      receipt: serving,
      providerProof: source.providerProof,
    });
    await expect(
      projectServingReadinessProofV3({
        manifest: source.manifest,
        receiptProofs: [v2, ...source.receiptProofs.slice(1)] as never,
        environment: "local",
        readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).rejects.toThrow("not trusted");
    await expect(
      projectReadinessReceiptProofV3({
        receipt: serving,
        providerProof: { ...source.providerProof },
        modelVariantNameProof: source.modelProof,
      }),
    ).rejects.toThrow("not trusted");
    await expect(
      projectReadinessReceiptProofV3({
        receipt: serving,
        providerProof: source.providerProof,
        modelVariantNameProof: { ...source.modelProof },
      }),
    ).rejects.toThrow("not trusted");
    const other = await fixture("pub_00000009-0000-4000-8000-000000000001");
    await expect(
      projectReadinessReceiptProofV3({
        receipt: serving,
        providerProof: source.providerProof,
        modelVariantNameProof: other.modelProof,
      }),
    ).rejects.toThrow("trusted publication");
  });

  it("projects exact 32-field serving rows, 55-field preflights, and nominal persistence", async () => {
    const source = await fixture();
    const closure = await projectServingClosureSeal(source.closureRows);
    const providerDocuments = source.providerProjection.documents.map(
      (document) => ({
        publication_id: source.providerProjection.publicationId,
        provider_id: document.providerId,
        projection_version: document.projectionVersion,
        display_name: document.displayName,
        normalized_name: document.normalizedName,
        provider_resource_content_hash: document.providerResourceContentHash,
      }),
    );
    const providerFtsRows = providerDocuments.map((document) => ({
      publication_id: document.publication_id,
      provider_id: document.provider_id,
      display_name: document.display_name,
    }));
    const commit = await projectServingReadinessCommitV3({
      proof: source.readinessProof,
      closureRows: source.closureRows,
      persistedSeal: closure.seal,
      persistedProviderSearchDocuments: providerDocuments,
      persistedProviderSearchFtsRows: providerFtsRows,
      persistedModelVariantNameRows: source.modelPersistence.rows,
    });
    const persistence = readServingReadinessCommitPersistenceV3(commit);
    expect(Object.keys(persistence.receiptRows.servings[0]!)).toHaveLength(32);
    expect(persistence.modelVariantNameSearch.rows).toEqual([]);
    expect(() =>
      readServingReadinessCommitPersistenceV3({ ...commit }),
    ).toThrow("not trusted");

    const context = {
      switchId: `publication-switch|activate|1|${source.manifest.publicationId}|${source.manifest.closureHash}`,
      action: "activate" as const,
      expectedPriorGeneration: 0,
      expectedPriorRollbackCandidatePublicationId: null,
      expectedPriorSwitchedAtMs: null,
      newGeneration: 1,
      fromPublicationId: null,
      fromClosureHash: null,
      toPublicationId: source.manifest.publicationId,
      toClosureHash: source.manifest.closureHash,
      switchedAtMs: Date.parse("2026-08-02T00:35:00.000Z"),
    };
    const preflight = await projectServingSwitchPreflightProofV3({
      manifest: source.manifest,
      providerProof: source.providerProof,
      modelVariantNameProof: source.modelProof,
      readinessProof: source.readinessProof,
      context,
      artifactProof: artifactProof(source, READINESS_PROBE_SET_VERSION_V3),
    });
    expect(Object.keys(preflight)).toHaveLength(55);
    expect(preflight.preflight_hash).toBe(independentPreflightHash(preflight));
    await expect(
      projectServingSwitchPreflightProofV2({
        manifest: source.manifest,
        providerProof: source.providerProof,
        readinessProof: null,
        context: { ...context, action: "rollback" },
        artifactProof: artifactProof(source, READINESS_PROBE_SET_VERSION_V2),
      }),
    ).resolves.toMatchObject({ preflight_version: "2.0.0" });

    const reconstructed =
      await reconstructServingReadinessProofV3FromPersistence({
        manifest: source.manifest,
        providerProjection: source.providerProjection,
        providerFts: {
          buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
          documentCount: source.providerProjection.documentCount,
          queryable: true,
          exactParity: true,
        },
        providerSearchDocuments: providerDocuments,
        providerSearchFtsRows: providerFtsRows,
        modelVariantNameStaging: source.modelStaging,
        modelVariantNameStorage: {
          storageVersion: source.modelPersistence.storageVersion,
          rows: source.modelPersistence.rows,
        },
        modelVariantNameQueryability: source.queryability,
        receiptRows: persistence.receiptRows,
        attestation: persistence.attestation,
      });
    expect(reconstructed.attestation).toEqual(persistence.attestation);

    const emptyRows = {
      bindings: [],
      archives: [],
      servings: [],
      vectors: [],
      probes: [],
    };
    const retryBase = {
      expected: commit,
      publicationReadyAtMs: null,
      publicationClosureHash: source.manifest.closureHash,
      receiptRows: emptyRows,
      attestation: null,
    } as const;
    expect(
      classifyServingReadinessCommitRetryV3({
        ...retryBase,
        publicationState: "building",
      }).outcome,
    ).toBe("execute");
    expect(
      classifyServingReadinessCommitRetryV3({
        ...retryBase,
        publicationState: "failed",
      }).outcome,
    ).toBe("stale");
    expect(
      classifyServingReadinessCommitRetryV3({
        expected: commit,
        publicationState: "ready",
        publicationReadyAtMs: persistence.transition.ready_at_ms,
        publicationClosureHash: source.manifest.closureHash,
        receiptRows: persistence.receiptRows,
        attestation: persistence.attestation,
      }).outcome,
    ).toBe("idempotent_success");
    expect(
      classifyServingReadinessCommitRetryV3({
        expected: commit,
        publicationState: "building",
        publicationReadyAtMs: null,
        publicationClosureHash: source.manifest.closureHash,
        receiptRows: {
          ...emptyRows,
          bindings: persistence.receiptRows.bindings.slice(0, 1),
        },
        attestation: null,
      }).outcome,
    ).toBe("integrity_failure");
    expect(
      classifyServingReadinessCommitRetryV3({
        expected: commit,
        publicationState: "ready",
        publicationReadyAtMs: persistence.transition.ready_at_ms,
        publicationClosureHash: source.manifest.closureHash,
        receiptRows: {
          ...persistence.receiptRows,
          bindings: persistence.receiptRows.bindings.map((row, index) =>
            index === 0
              ? { ...row, receipt_hash: `sha256:${"c".repeat(64)}` as const }
              : row,
          ),
        },
        attestation: persistence.attestation,
      }).outcome,
    ).toBe("conflict");

    await expect(
      projectServingReadinessCommitV3({
        proof: source.readinessProof,
        closureRows: source.closureRows,
        persistedSeal: closure.seal,
        persistedProviderSearchDocuments: providerDocuments,
        persistedProviderSearchFtsRows: providerFtsRows,
        persistedModelVariantNameRows: [
          {
            publication_id: source.manifest.publicationId,
            resource_type: "model",
            resource_id: "mdl_00000001-0000-4000-8000-000000000001",
            projection_version: "model-variant-name@1",
            display_name_utf8: [120],
            normalized_name_utf8: [120],
            resource_content_hash: `sha256:${"d".repeat(64)}`,
          },
        ],
      }),
    ).rejects.toThrow("persisted sealed evidence");

    const target = {
      publicationId: source.manifest.publicationId,
      closureHash: source.manifest.closureHash,
      state: "ready" as const,
      generatedAt: source.manifest.generatedAt,
      readyAt: new Date(persistence.transition.ready_at_ms).toISOString(),
      firstActivatedAt: null,
      lastHeadReferencedAt: null,
    };
    const activation = await projectServingSwitchV3({
      preflight,
      target,
      currentHead: null,
      currentActive: null,
      authorizedBy: { kind: "pipeline", identityId: "pipeline.test" },
      closureRows: source.closureRows,
      persistedSeal: closure.seal,
      persistedProviderSearchDocuments: providerDocuments,
      persistedProviderSearchFtsRows: providerFtsRows,
      persistedModelVariantNameRows: source.modelPersistence.rows,
      persistedReceiptRows: persistence.receiptRows,
      persistedAttestation: persistence.attestation,
    });
    const activationPersistence = readServingSwitchPersistenceV3(activation);
    const activationCas = activationPersistence.plan.steps.find(
      (step) => step.kind === "compare_and_swap_head",
    );
    expect(activationCas?.kind).toBe("compare_and_swap_head");
    if (activationCas?.kind !== "compare_and_swap_head")
      throw new Error("activation CAS missing");
    expect(
      classifyServingSwitchRetryV3({
        expected: activation,
        currentHead: null,
        preflightAtGeneration: null,
        historyAtGeneration: null,
        targetState: "ready",
        formerState: null,
      }).outcome,
    ).toBe("execute");
    expect(
      classifyServingSwitchRetryV3({
        expected: activation,
        currentHead: activationCas.next,
        preflightAtGeneration: preflight,
        historyAtGeneration: activationPersistence.history,
        targetState: "active",
        formerState: null,
      }).outcome,
    ).toBe("idempotent_success");

    const activeId = "pub_00000002-0000-4000-8000-000000000001" as const;
    const activeHash = `sha256:${"e".repeat(64)}` as const;
    const priorHead = {
      activePublicationId: activeId,
      rollbackCandidatePublicationId: source.manifest.publicationId,
      switchedAt: "2026-08-02T00:35:00.000Z",
      generation: 1,
    };
    const rollbackPreflight = await projectServingSwitchPreflightProofV3({
      manifest: source.manifest,
      providerProof: source.providerProof,
      modelVariantNameProof: source.modelProof,
      readinessProof: null,
      context: {
        switchId: `publication-switch|rollback|2|${source.manifest.publicationId}|${source.manifest.closureHash}`,
        action: "rollback",
        expectedPriorGeneration: 1,
        expectedPriorRollbackCandidatePublicationId:
          source.manifest.publicationId,
        expectedPriorSwitchedAtMs: Date.parse(priorHead.switchedAt),
        newGeneration: 2,
        fromPublicationId: activeId,
        fromClosureHash: activeHash,
        toPublicationId: source.manifest.publicationId,
        toClosureHash: source.manifest.closureHash,
        switchedAtMs: Date.parse("2026-08-02T00:36:00.000Z"),
      },
      artifactProof: artifactProof(source, READINESS_PROBE_SET_VERSION_V3),
    });
    expect(rollbackPreflight.preflight_hash).toBe(
      independentPreflightHash(rollbackPreflight),
    );
    const rollback = await projectServingSwitchV3({
      preflight: rollbackPreflight,
      target: {
        ...target,
        state: "superseded",
        firstActivatedAt: "2026-08-02T00:35:00.000Z",
        lastHeadReferencedAt: "2026-08-02T00:35:00.000Z",
      },
      currentHead: priorHead,
      currentActive: {
        publicationId: activeId,
        closureHash: activeHash,
        state: "active",
        generatedAt: "2026-08-02T00:00:00.000Z",
        readyAt: "2026-08-02T00:30:00.000Z",
        firstActivatedAt: "2026-08-02T00:35:00.000Z",
        lastHeadReferencedAt: "2026-08-02T00:35:00.000Z",
      },
      authorizedBy: { kind: "operator", identityId: "operator.test" },
      closureRows: source.closureRows,
      persistedSeal: closure.seal,
      persistedProviderSearchDocuments: providerDocuments,
      persistedProviderSearchFtsRows: providerFtsRows,
      persistedModelVariantNameRows: source.modelPersistence.rows,
      persistedReceiptRows: null,
      persistedAttestation: null,
    });
    expect(readServingSwitchPersistenceV3(rollback).history.action).toBe(
      "rollback",
    );
  });

  it("binds fixed-index queryability evidence even for the empty projection", async () => {
    const source = await fixture();
    expect(source.queryability).toEqual({
      indexName: MODEL_VARIANT_NAME_SEARCH_EXACT_INDEX_NAME,
      matchNormalizedNameUtf8: [],
      matchResourceIds: [],
      missNormalizedNameUtf8: [],
      missResourceIds: [],
    });
  });
});
