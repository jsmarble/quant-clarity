import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PROVIDER_SEARCH_FTS_BUILD_VERSION,
  canonicalizePublicationJson,
  buildImmutableManifestFromPersistedContent,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  projectModelVariantNameSearchArtifactProofV1,
  projectModelVariantNameSearchProjection,
  projectModelVariantNameSearchQueryabilityPlanV3,
  projectModelVariantNameSearchQueryableArtifactProofV3,
  projectModelVariantNameSearchStagingV1,
  projectProviderModelIdSearchArtifactProofV1,
  projectProviderModelIdSearchProjection,
  projectProviderModelIdSearchQueryabilityPlanV4,
  projectProviderModelIdSearchQueryableArtifactProofV4,
  projectProviderModelIdSearchStagingV1,
  projectProviderSearchArtifactProofV2,
  projectProviderSearchProjection,
  projectProviderSearchStagingV2,
  projectReadinessReceiptProofV4,
  projectServingClosureSeal,
  projectServingReadinessCommitV4,
  projectServingReadinessProofV4,
  projectServingSwitchPreflightProofV4,
  projectServingSwitchV4,
  readModelVariantNameSearchStagingPersistenceV1,
  readProviderModelIdSearchStagingPersistenceV1,
  readProviderModelIdSearchQueryablePersistenceV4,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV4,
  readServingSwitchPersistenceV4,
  type ProviderModelIdSearchQueryableArtifactProofV4,
  type ProviderSearchArtifactProofV2,
  type ReadinessReceipt,
  type ServingClosureRows,
  type ServingReadinessAttestationProjectionV4,
  type ServingSwitchHistoryRow,
  type ServingSwitchPreflightProofV4,
} from "./index.js";

type OracleField = Readonly<{
  name: string;
  type: string;
  value: string;
}>;

const field = (
  name: string,
  type: string,
  value: string | number | boolean,
): OracleField => ({ name, type, value: String(value) });

const nullable = (
  name: string,
  type: string,
  value: string | null,
): OracleField =>
  value === null ? field(name, "null", "null") : field(name, type, value);

const uint64 = (value: number): Buffer => {
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(BigInt(value));
  return result;
};

/** Independent canonical framing oracle; it does not call production digest helpers. */
const encode = (domain: string, fields: readonly OracleField[]): Buffer =>
  Buffer.concat(
    [
      field("hash_domain", "text", domain),
      field("encoding_version", "integer", 1),
      ...fields,
    ].flatMap((entry) =>
      [entry.name, entry.type, entry.value].flatMap((value) => {
        const bytes = Buffer.from(value, "utf8");
        return [uint64(bytes.length), bytes];
      }),
    ),
  );

const digest = (domain: string, fields: readonly OracleField[]): string =>
  `sha256:${createHash("sha256").update(encode(domain, fields)).digest("hex")}`;

const receiptSpecificFields = (
  receipt: ReadinessReceipt,
): readonly OracleField[] => {
  switch (receipt.kind) {
    case "archive":
      return [
        field("retained_bundle_hash", "digest", receipt.retainedBundleHash),
        field("immutable", "boolean", receipt.immutable),
      ];
    case "serving":
      return [
        field(
          "enabled_provider_count",
          "integer",
          receipt.enabledProviderCount,
        ),
        field(
          "enabled_provider_scope_hash",
          "digest",
          receipt.enabledProviderScopeHash,
        ),
        field("provider_slice_count", "integer", receipt.providerSliceCount),
        field("provider_slice_hash", "digest", receipt.providerSliceHash),
        field(
          "provider_attribution_count",
          "integer",
          receipt.providerAttributionCount,
        ),
        field(
          "provider_attribution_hash",
          "digest",
          receipt.providerAttributionHash,
        ),
        field("resource_count", "integer", receipt.resourceCount),
        field("exact_document_count", "integer", receipt.exactDocumentCount),
        field(
          "resource_inventory_hash",
          "digest",
          receipt.resourceInventoryHash,
        ),
        field(
          "exact_search_inventory_hash",
          "digest",
          receipt.exactSearchInventoryHash,
        ),
        field("fts_build_version", "text", receipt.ftsBuildVersion),
        field("fts_document_count", "integer", receipt.ftsDocumentCount),
        field("fts_queryable", "boolean", receipt.ftsQueryable),
        field("foreign_keys_valid", "boolean", receipt.foreignKeysValid),
        field("content_hashes_valid", "boolean", receipt.contentHashesValid),
        field(
          "unavailable_provider_isolation_valid",
          "boolean",
          receipt.unavailableProviderIsolationValid,
        ),
      ];
    case "vectors":
      return [
        field("namespace", "identifier", receipt.namespace),
        field("document_count", "integer", receipt.documentCount),
        field(
          "verified_document_count",
          "integer",
          receipt.verifiedDocumentCount,
        ),
        field("vector_inventory_hash", "digest", receipt.vectorInventoryHash),
        field(
          "visibility_probe_version",
          "text",
          receipt.visibilityProbeVersion,
        ),
        field("mutation_id", "text", receipt.mutationId),
        field("all_ids_present", "boolean", receipt.allIdsPresent),
        field("all_namespaces_match", "boolean", receipt.allNamespacesMatch),
        field("queryable", "boolean", receipt.queryable),
      ];
    case "probes":
      return [
        field("probe_set_version", "text", receipt.probeSetVersion),
        field("integrity_passed", "boolean", receipt.integrityPassed),
        field(
          "evidence_coverage_passed",
          "boolean",
          receipt.evidenceCoveragePassed,
        ),
        field("exact_search_passed", "boolean", receipt.exactSearchPassed),
        field(
          "semantic_search_passed",
          "boolean",
          receipt.semanticSearchPassed,
        ),
        field(
          "structured_filter_passed",
          "boolean",
          receipt.structuredFilterPassed,
        ),
        field("neutrality_passed", "boolean", receipt.neutralityPassed),
        field(
          "version_isolation_passed",
          "boolean",
          receipt.versionIsolationPassed,
        ),
      ];
  }
};

const providerFields = (
  proof: ProviderSearchArtifactProofV2,
): readonly OracleField[] => [
  field(
    "provider_search_projection_version",
    "text",
    proof.provider_search_projection_version,
  ),
  field(
    "provider_search_document_count",
    "integer",
    proof.provider_search_document_count,
  ),
  field(
    "provider_search_inventory_hash",
    "digest",
    proof.provider_search_inventory_hash,
  ),
  field(
    "provider_search_fts_build_version",
    "text",
    proof.provider_search_fts_build_version,
  ),
  field(
    "provider_search_fts_document_count",
    "integer",
    proof.provider_search_fts_document_count,
  ),
  field("provider_search_fts_queryable", "boolean", true),
  field("provider_search_exact_parity", "boolean", true),
];

const modelFields = (proof: {
  model_variant_name_projection_version: string;
  model_variant_name_document_count: number;
  model_variant_name_inventory_hash: string;
  model_variant_name_storage_version: string;
  model_variant_name_storage_document_count: number;
}): readonly OracleField[] => [
  field(
    "model_variant_name_projection_version",
    "text",
    proof.model_variant_name_projection_version,
  ),
  field(
    "model_variant_name_document_count",
    "integer",
    proof.model_variant_name_document_count,
  ),
  field(
    "model_variant_name_inventory_hash",
    "digest",
    proof.model_variant_name_inventory_hash,
  ),
  field(
    "model_variant_name_storage_version",
    "text",
    proof.model_variant_name_storage_version,
  ),
  field(
    "model_variant_name_storage_document_count",
    "integer",
    proof.model_variant_name_storage_document_count,
  ),
  field("model_variant_name_storage_queryable", "boolean", true),
  field("model_variant_name_storage_exact_parity", "boolean", true),
];

type ProviderModelIdFieldSource = Pick<
  ProviderModelIdSearchQueryableArtifactProofV4,
  | "provider_model_id_projection_version"
  | "provider_model_id_document_count"
  | "provider_model_id_inventory_hash"
  | "provider_model_id_storage_version"
  | "provider_model_id_storage_document_count"
>;

const providerModelIdFields = (
  proof: ProviderModelIdFieldSource,
): readonly OracleField[] => [
  field(
    "provider_model_id_projection_version",
    "text",
    proof.provider_model_id_projection_version,
  ),
  field(
    "provider_model_id_document_count",
    "integer",
    proof.provider_model_id_document_count,
  ),
  field(
    "provider_model_id_inventory_hash",
    "digest",
    proof.provider_model_id_inventory_hash,
  ),
  field(
    "provider_model_id_storage_version",
    "text",
    proof.provider_model_id_storage_version,
  ),
  field(
    "provider_model_id_storage_document_count",
    "integer",
    proof.provider_model_id_storage_document_count,
  ),
  field("provider_model_id_storage_queryable", "boolean", true),
  field("provider_model_id_storage_exact_parity", "boolean", true),
];

const receiptFields = (
  receipt: ReadinessReceipt,
  searchSuffix: readonly OracleField[],
): readonly OracleField[] => [
  field("receipt_version", "text", "4.0.0"),
  field("kind", "text", receipt.kind),
  field("environment", "text", receipt.binding.environment),
  field("publication_id", "identifier", receipt.binding.publicationId),
  field("closure_hash", "digest", receipt.binding.closureHash),
  field("bundle_hash", "digest", receipt.binding.bundleHash),
  field("schema_version", "text", receipt.binding.schemaVersion),
  field("build_commit", "text", receipt.binding.buildCommit),
  field("observed_at", "timestamp", receipt.observedAt),
  ...receiptSpecificFields(receipt),
  ...(receipt.kind === "serving" ? searchSuffix : []),
];

const attestationFields = (
  value: ServingReadinessAttestationProjectionV4,
): readonly OracleField[] => [
  field("evaluator_version", "text", "4.0.0"),
  field("environment", "text", value.environment),
  field("publication_id", "identifier", value.publication_id),
  field("closure_hash", "digest", value.closure_hash),
  field("bundle_hash", "digest", value.bundle_hash),
  field("ready_at", "timestamp", new Date(value.ready_at_ms).toISOString()),
  field("maximum_receipt_age_ms", "integer", value.maximum_receipt_age_ms),
  field(
    "effective_valid_until",
    "timestamp",
    new Date(value.effective_valid_until_ms).toISOString(),
  ),
  field("archive_receipt_hash", "digest", value.archive_receipt_hash),
  field("serving_receipt_hash", "digest", value.serving_receipt_hash),
  field("vector_receipt_hash", "digest", value.vector_receipt_hash),
  field("probes_receipt_hash", "digest", value.probes_receipt_hash),
];

const preflightFields = (
  proof: ServingSwitchPreflightProofV4,
): readonly OracleField[] => [
  field("preflight_version", "text", "4.0.0"),
  field("action", "text", proof.action),
  field("environment", "text", proof.environment),
  field(
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
  field("new_generation", "integer", proof.new_generation),
  nullable("from_publication_id", "identifier", proof.from_publication_id),
  nullable("from_closure_hash", "digest", proof.from_closure_hash),
  field("to_publication_id", "identifier", proof.to_publication_id),
  field("to_closure_hash", "digest", proof.to_closure_hash),
  nullable("to_attestation_hash", "digest", proof.to_attestation_hash),
  field(
    "switched_at",
    "timestamp",
    new Date(proof.switched_at_ms).toISOString(),
  ),
  field(
    "observed_at",
    "timestamp",
    new Date(proof.observed_at_ms).toISOString(),
  ),
  field("maximum_age_ms", "integer", proof.maximum_age_ms),
  field(
    "valid_until",
    "timestamp",
    new Date(proof.valid_until_ms).toISOString(),
  ),
  field("fts_build_version", "text", proof.fts_build_version),
  field(
    "fts_source_document_count",
    "integer",
    proof.fts_source_document_count,
  ),
  field("fts_index_document_count", "integer", proof.fts_index_document_count),
  field("fts_source_inventory_hash", "digest", proof.fts_source_inventory_hash),
  field("fts_exact_parity", "boolean", true),
  field("archive_bundle_hash", "digest", proof.archive_bundle_hash),
  field("archive_immutable", "boolean", true),
  field("vector_namespace", "identifier", proof.vector_namespace),
  field("vector_document_count", "integer", proof.vector_document_count),
  field(
    "vector_verified_document_count",
    "integer",
    proof.vector_verified_document_count,
  ),
  field("vector_inventory_hash", "digest", proof.vector_inventory_hash),
  field(
    "vector_visibility_probe_version",
    "text",
    proof.vector_visibility_probe_version,
  ),
  field("vector_mutation_id", "text", proof.vector_mutation_id),
  field("vector_all_ids_present", "boolean", true),
  field("vector_all_namespaces_match", "boolean", true),
  field("vector_queryable", "boolean", true),
  field("probe_set_version", "text", proof.probe_set_version),
  field("integrity_passed", "boolean", true),
  field("exact_search_passed", "boolean", true),
  field("semantic_search_passed", "boolean", true),
  field("structured_filter_passed", "boolean", true),
  field("neutrality_passed", "boolean", true),
  field("version_isolation_passed", "boolean", true),
  field(
    "provider_search_projection_version",
    "text",
    proof.provider_search_projection_version,
  ),
  field(
    "provider_search_document_count",
    "integer",
    proof.provider_search_document_count,
  ),
  field(
    "provider_search_inventory_hash",
    "digest",
    proof.provider_search_inventory_hash,
  ),
  field(
    "provider_search_fts_build_version",
    "text",
    proof.provider_search_fts_build_version,
  ),
  field(
    "provider_search_fts_document_count",
    "integer",
    proof.provider_search_fts_document_count,
  ),
  field("provider_search_fts_queryable", "boolean", true),
  field("provider_search_exact_parity", "boolean", true),
  field(
    "model_variant_name_projection_version",
    "text",
    proof.model_variant_name_projection_version,
  ),
  field(
    "model_variant_name_document_count",
    "integer",
    proof.model_variant_name_document_count,
  ),
  field(
    "model_variant_name_inventory_hash",
    "digest",
    proof.model_variant_name_inventory_hash,
  ),
  field(
    "model_variant_name_storage_version",
    "text",
    proof.model_variant_name_storage_version,
  ),
  field(
    "model_variant_name_storage_document_count",
    "integer",
    proof.model_variant_name_storage_document_count,
  ),
  field("model_variant_name_storage_queryable", "boolean", true),
  field("model_variant_name_storage_exact_parity", "boolean", true),
  ...providerModelIdFields(proof),
];

const eventFields = (
  history: ServingSwitchHistoryRow,
): readonly OracleField[] => [
  field("event_version", "text", "1.0.0"),
  field("switch_id", "text", history.switch_id),
  field("preflight_hash", "digest", history.preflight_hash),
  field("action", "text", history.action),
  field(
    "expected_prior_generation",
    "integer",
    history.expected_prior_generation,
  ),
  nullable(
    "expected_prior_rollback_candidate_publication_id",
    "identifier",
    history.expected_prior_rollback_candidate_publication_id,
  ),
  nullable(
    "expected_prior_switched_at",
    "timestamp",
    history.expected_prior_switched_at_ms === null
      ? null
      : new Date(history.expected_prior_switched_at_ms).toISOString(),
  ),
  field("new_generation", "integer", history.new_generation),
  nullable("from_publication_id", "identifier", history.from_publication_id),
  nullable("from_closure_hash", "digest", history.from_closure_hash),
  field("to_publication_id", "identifier", history.to_publication_id),
  field("to_closure_hash", "digest", history.to_closure_hash),
  nullable("to_attestation_hash", "digest", history.to_attestation_hash),
  nullable(
    "resulting_rollback_candidate_publication_id",
    "identifier",
    history.resulting_rollback_candidate_publication_id,
  ),
  field(
    "switched_at",
    "timestamp",
    new Date(history.switched_at_ms).toISOString(),
  ),
  field("authorized_by_kind", "text", history.authorized_by_kind),
  field("authorized_identity_id", "text", history.authorized_identity_id),
];

const PUBLICATION_ID = "pub_00000001-0000-4000-8000-000000000001" as const;
const OTHER_PUBLICATION_ID =
  "pub_00000002-0000-4000-8000-000000000001" as const;
const PROVIDER_ID = "prv_00000001-0000-4000-8000-000000000001";
const OBSERVED = "2026-08-02T00:00:00.000Z";
const TIMES = [30, 31, 32, 33].map(
  (minute) => `2026-08-02T00:${String(minute)}:00.000Z`,
);

const makeFixture = async () => {
  const fact = (value: string) => ({
    evidence_ids: ["evd_00000001-0000-4000-8000-000000000001"],
    observed_at: OBSERVED,
    state: "known",
    value,
  });
  const providerJson = canonicalizePublicationJson(
    JSON.stringify({
      active_offering_count: {
        derivation_version: "provider-count@1",
        observed_at: OBSERVED,
        value: 0,
      },
      affiliate_relationship_present: false,
      display_name: fact("Oracle Provider"),
      last_successful_refresh: fact(OBSERVED),
      official_site: fact("https://provider.example"),
      precision_coverage: {
        derivation_version: "precision-coverage@1",
        known_count: 0,
        known_proportion_decimal: "0",
        unknown_count: 0,
      },
      provider_id: PROVIDER_ID,
      slug: fact("oracle-provider"),
      status: fact("active"),
    }),
    "object",
  );
  const providerHash = await hashPublicationResourceContent({
    resourceType: "provider",
    resourceId: PROVIDER_ID,
    resourceJson: providerJson,
  });
  const resource = {
    resource_type: "provider" as const,
    resource_id: PROVIDER_ID,
    resource_json: providerJson,
    content_hash: providerHash,
  };
  const chunkHash = await hashPublicationResourceChunk([
    {
      resourceType: "provider",
      resourceId: PROVIDER_ID,
      contentHash: providerHash,
    },
  ]);
  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: "1.0.0",
    publicationId: PUBLICATION_ID,
    sourceRunId: "run_00000001-0000-4000-8000-000000000001",
    parentPublicationId: null,
    generatedAt: OBSERVED,
    versions: {
      schema: "1.0.0",
      methodology: "1.0.0",
      precisionNormalization: "1.0.0",
      precisionDisplayOrder: "1.0.0",
      pricePolicy: "1.0.0",
      sourcePolicy: "1.0.0",
      embedding: "embedding@1",
      buildCommit: "oracle-commit",
    },
    enabledProviderScopeVersion: "provider-scope@1",
    enabledProviderIds: [PROVIDER_ID],
    providerSlices: [
      {
        providerId: PROVIDER_ID,
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
        resourceId: PROVIDER_ID,
        providerId: PROVIDER_ID,
      },
    ],
    resources: [
      {
        resourceType: "provider",
        resourceId: PROVIDER_ID,
        resourceJson: providerJson,
        contentHash: providerHash,
      },
    ],
    searchDocuments: [],
    vectors: [],
    chunks: [
      {
        kind: "resources",
        ordinal: 0,
        firstKey: `provider:${PROVIDER_ID}`,
        lastKey: `provider:${PROVIDER_ID}`,
        itemCount: 1,
        contentHash: chunkHash,
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
    resources: [resource],
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
    manifestContractVersion: "1.0.0" as const,
    enabledProviderScopeVersion: manifest.enabledProviderScopeVersion,
    bundleHash: manifest.bundleHash,
    stagingRevision: 1,
    sealedAtMs: Date.parse(OBSERVED) + 60_000,
  };
  const providerProjection = await projectProviderSearchProjection({
    manifest,
    providerResources: [resource],
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
  const modelProof = projectModelVariantNameSearchQueryableArtifactProofV3({
    storageProof: modelStorageProof,
    queryability:
      projectModelVariantNameSearchQueryabilityPlanV3(modelStorageProof),
  });
  const providerModelIdProjection =
    await projectProviderModelIdSearchProjection({ manifest, resources: [] });
  const providerModelIdStaging = await projectProviderModelIdSearchStagingV1({
    projection: providerModelIdProjection,
    closureRows,
  });
  const providerModelIdPersistence =
    readProviderModelIdSearchStagingPersistenceV1(providerModelIdStaging);
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
  const binding = {
    environment: "local" as const,
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
      observedAt: TIMES[0]!,
      retainedBundleHash: manifest.bundleHash,
      immutable: true,
    },
    {
      kind: "serving",
      binding,
      observedAt: TIMES[1]!,
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
      observedAt: TIMES[2]!,
      namespace: manifest.publicationId,
      documentCount: 0,
      verifiedDocumentCount: 0,
      vectorInventoryHash: manifest.vectorInventoryHash,
      visibilityProbeVersion: "vector-visibility@1",
      mutationId: "oracle-vector-mutation",
      allIdsPresent: true,
      allNamespacesMatch: true,
      queryable: true,
    },
    {
      kind: "probes",
      binding,
      observedAt: TIMES[3]!,
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
    receipts.map((receipt) =>
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
    readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
    maximumReceiptAgeMs: 60 * 60 * 1_000,
  });
  const seal = await projectServingClosureSeal(closureRows);
  const readinessCommit = await projectServingReadinessCommitV4({
    proof: readinessProof,
    closureRows,
    persistedSeal: seal.seal,
    persistedProviderSearchDocuments: providerPersistence.documents,
    persistedProviderSearchFtsRows: providerPersistence.ftsRows,
    persistedModelVariantNameRows: modelPersistence.rows,
    persistedProviderModelIdRows: providerModelIdPersistence.rows,
  });
  return {
    manifest,
    closureRows,
    seal: seal.seal,
    providerPersistence,
    providerProof,
    modelPersistence,
    modelProof,
    providerModelIdPersistence,
    providerModelIdProof,
    receipts,
    receiptProofs,
    readinessProof,
    readinessCommit,
  };
};

const artifactProof = (source: Awaited<ReturnType<typeof makeFixture>>) => ({
  environment: "local" as const,
  observedAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
  maximumAgeMs: 60 * 60 * 1_000,
  ftsBuildVersion: "fts5-unicode61@1" as const,
  ftsSourceDocumentCount: 0,
  ftsIndexDocumentCount: 0,
  ftsSourceInventoryHash: source.manifest.exactSearchInventoryHash,
  ftsExactParity: true as const,
  archiveBundleHash: source.manifest.bundleHash,
  archiveImmutable: true as const,
  vectorNamespace: source.manifest.publicationId,
  vectorDocumentCount: 0,
  vectorVerifiedDocumentCount: 0,
  vectorInventoryHash: source.manifest.vectorInventoryHash,
  vectorVisibilityProbeVersion: "vector-visibility@1" as const,
  vectorMutationId: "oracle-vector-mutation",
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

describe("independent provider-model-ID v4 hash oracle", () => {
  it("preserves the v3 search prefix and appends exactly seven ordered fields", async () => {
    const source = await makeFixture();
    const v3Prefix = [
      ...providerFields(source.providerProof),
      ...modelFields(source.modelProof),
    ];
    const v4Suffix = providerModelIdFields(source.providerModelIdProof);
    const serving = source.receipts.find(
      (receipt) => receipt.kind === "serving",
    )!;
    const prefixBytes = encode(
      "publication-readiness-receipt",
      receiptFields(serving, v3Prefix),
    );
    const v4Bytes = encode(
      "publication-readiness-receipt",
      receiptFields(serving, [...v3Prefix, ...v4Suffix]),
    );
    expect(v4Bytes.subarray(0, prefixBytes.length)).toEqual(prefixBytes);
    expect(v4Suffix.map((entry) => entry.name)).toEqual([
      "provider_model_id_projection_version",
      "provider_model_id_document_count",
      "provider_model_id_inventory_hash",
      "provider_model_id_storage_version",
      "provider_model_id_storage_document_count",
      "provider_model_id_storage_queryable",
      "provider_model_id_storage_exact_parity",
    ]);
  });

  it("pins literal v4 receipt and attestation hashes with mutation negatives", async () => {
    const source = await makeFixture();
    const suffix = [
      ...providerFields(source.providerProof),
      ...modelFields(source.modelProof),
      ...providerModelIdFields(source.providerModelIdProof),
    ];
    const expectedReceipts = source.receipts.map((receipt) =>
      digest("publication-readiness-receipt", receiptFields(receipt, suffix)),
    );
    expect(source.receiptProofs.map((proof) => proof.receipt_hash)).toEqual(
      expectedReceipts,
    );
    expect(expectedReceipts[1]).toBe(
      "sha256:2e5f9fb1b12964003498dd6ba135f1d1608d2a0d4e4e2e8b4c7cd4d1dba67601",
    );
    const attestationHash = digest(
      "publication-readiness-attestation",
      attestationFields(source.readinessProof.attestation),
    );
    expect(source.readinessProof.attestation.attestation_hash).toBe(
      attestationHash,
    );
    expect(attestationHash).toBe(
      "sha256:3b2f2ac016b402edb07649d91de497d97776af1d9b8e22d0d21ea523b395b87a",
    );

    const serving = source.receipts[1]!;
    const exact = receiptFields(serving, suffix);
    const swapped = [...exact];
    const last = swapped.length - 1;
    [swapped[last - 1], swapped[last]] = [swapped[last]!, swapped[last - 1]!];
    expect(digest("publication-readiness-receipt", swapped)).not.toBe(
      source.receiptProofs[1]!.receipt_hash,
    );
    const changed = exact.map((entry) =>
      entry.name === "provider_model_id_document_count"
        ? field(entry.name, entry.type, Number(entry.value) + 1)
        : entry,
    );
    expect(digest("publication-readiness-receipt", changed)).not.toBe(
      source.receiptProofs[1]!.receipt_hash,
    );
  });

  it("pins activation and rollback preflight and event-v1 hashes", async () => {
    const source = await makeFixture();
    const commit = readServingReadinessCommitPersistenceV4(
      source.readinessCommit,
    );
    expect(commit.providerModelIdProof).toBe(source.providerModelIdProof);
    expect(
      readProviderModelIdSearchQueryablePersistenceV4(
        commit.providerModelIdProof,
      ).providerModelIdSearch,
    ).toBe(source.providerModelIdPersistence);
    const activatedAtMs = Date.parse("2026-08-02T00:35:00.000Z");
    const activationPreflight = await projectServingSwitchPreflightProofV4({
      manifest: source.manifest,
      providerProof: source.providerProof,
      modelVariantNameProof: source.modelProof,
      providerModelIdProof: source.providerModelIdProof,
      readinessProof: source.readinessProof,
      context: {
        switchId: `publication-switch|activate|1|${PUBLICATION_ID}|${source.manifest.closureHash}`,
        action: "activate",
        expectedPriorGeneration: 0,
        expectedPriorRollbackCandidatePublicationId: null,
        expectedPriorSwitchedAtMs: null,
        newGeneration: 1,
        fromPublicationId: null,
        fromClosureHash: null,
        toPublicationId: PUBLICATION_ID,
        toClosureHash: source.manifest.closureHash,
        switchedAtMs: activatedAtMs,
      },
      artifactProof: artifactProof(source),
    });
    const activation = await projectServingSwitchV4({
      preflight: activationPreflight,
      target: {
        publicationId: PUBLICATION_ID,
        closureHash: source.manifest.closureHash,
        state: "ready",
        generatedAt: source.manifest.generatedAt,
        readyAt: new Date(commit.transition.ready_at_ms).toISOString(),
        firstActivatedAt: null,
        lastHeadReferencedAt: null,
      },
      currentHead: null,
      currentActive: null,
      authorizedBy: { kind: "pipeline", identityId: "pipeline.oracle" },
      closureRows: source.closureRows,
      persistedSeal: source.seal,
      persistedProviderSearchDocuments: source.providerPersistence.documents,
      persistedProviderSearchFtsRows: source.providerPersistence.ftsRows,
      persistedModelVariantNameRows: source.modelPersistence.rows,
      persistedProviderModelIdRows: source.providerModelIdPersistence.rows,
      persistedReceiptRows: commit.receiptRows,
      persistedAttestation: commit.attestation,
    });
    const activationState = readServingSwitchPersistenceV4(activation);
    expect(activationState.providerModelIdProof).toBe(
      source.providerModelIdProof,
    );
    expect(activationState.providerModelIdSearch.rows).toEqual(
      source.providerModelIdPersistence.rows,
    );
    const activationPreflightHash = digest(
      "publication-switch-preflight",
      preflightFields(activationState.preflight),
    );
    const activationEventHash = digest(
      "publication-switch-event",
      eventFields(activationState.history),
    );
    expect(activationState.preflight.preflight_hash).toBe(
      activationPreflightHash,
    );
    expect(activationState.history.event_hash).toBe(activationEventHash);
    expect(activationPreflightHash).toBe(
      "sha256:95c62e0348fd4f784bdfd50acf7788d7cba8266f061f96ec5fad30c3a9b2cdfb",
    );
    expect(activationEventHash).toBe(
      "sha256:3939194e5cc886b56cb7b22a2ad7744b38dee9b7f61ab5cdef7e5b379a28cbdf",
    );

    const rollbackAtMs = Date.parse("2026-08-02T00:36:00.000Z");
    const otherClosure = `sha256:${"c".repeat(64)}` as const;
    const rollbackPreflight = await projectServingSwitchPreflightProofV4({
      manifest: source.manifest,
      providerProof: source.providerProof,
      modelVariantNameProof: source.modelProof,
      providerModelIdProof: source.providerModelIdProof,
      readinessProof: null,
      context: {
        switchId: `publication-switch|rollback|2|${PUBLICATION_ID}|${source.manifest.closureHash}`,
        action: "rollback",
        expectedPriorGeneration: 1,
        expectedPriorRollbackCandidatePublicationId: PUBLICATION_ID,
        expectedPriorSwitchedAtMs: activatedAtMs,
        newGeneration: 2,
        fromPublicationId: OTHER_PUBLICATION_ID,
        fromClosureHash: otherClosure,
        toPublicationId: PUBLICATION_ID,
        toClosureHash: source.manifest.closureHash,
        switchedAtMs: rollbackAtMs,
      },
      artifactProof: artifactProof(source),
    });
    const rollback = await projectServingSwitchV4({
      preflight: rollbackPreflight,
      target: {
        publicationId: PUBLICATION_ID,
        closureHash: source.manifest.closureHash,
        state: "superseded",
        generatedAt: source.manifest.generatedAt,
        readyAt: new Date(commit.transition.ready_at_ms).toISOString(),
        firstActivatedAt: new Date(activatedAtMs).toISOString(),
        lastHeadReferencedAt: new Date(activatedAtMs).toISOString(),
      },
      currentHead: {
        activePublicationId: OTHER_PUBLICATION_ID,
        rollbackCandidatePublicationId: PUBLICATION_ID,
        switchedAt: new Date(activatedAtMs).toISOString(),
        generation: 1,
      },
      currentActive: {
        publicationId: OTHER_PUBLICATION_ID,
        closureHash: otherClosure,
        state: "active",
        generatedAt: source.manifest.generatedAt,
        readyAt: new Date(commit.transition.ready_at_ms).toISOString(),
        firstActivatedAt: new Date(activatedAtMs).toISOString(),
        lastHeadReferencedAt: new Date(activatedAtMs).toISOString(),
      },
      authorizedBy: { kind: "operator", identityId: "operator.oracle" },
      closureRows: source.closureRows,
      persistedSeal: source.seal,
      persistedProviderSearchDocuments: source.providerPersistence.documents,
      persistedProviderSearchFtsRows: source.providerPersistence.ftsRows,
      persistedModelVariantNameRows: source.modelPersistence.rows,
      persistedProviderModelIdRows: source.providerModelIdPersistence.rows,
      persistedReceiptRows: null,
      persistedAttestation: null,
    });
    const rollbackState = readServingSwitchPersistenceV4(rollback);
    expect(rollbackState.providerModelIdProof).toBe(
      source.providerModelIdProof,
    );
    expect(rollbackState.providerModelIdSearch.rows).toEqual(
      source.providerModelIdPersistence.rows,
    );
    const rollbackPreflightHash = digest(
      "publication-switch-preflight",
      preflightFields(rollbackState.preflight),
    );
    const rollbackEventHash = digest(
      "publication-switch-event",
      eventFields(rollbackState.history),
    );
    expect(rollbackState.preflight.preflight_hash).toBe(rollbackPreflightHash);
    expect(rollbackState.history.event_hash).toBe(rollbackEventHash);
    expect(rollbackPreflightHash).toBe(
      "sha256:631bc98877b290f80c0c332ac63a280178a93aedeaca50e4972872e5f35bee7b",
    );
    expect(rollbackEventHash).toBe(
      "sha256:63220f83a0e98c700aa1565c061361334ee345110f2c7665c727de1d006cdfd7",
    );

    const wrongOrder = preflightFields(rollbackState.preflight);
    expect(wrongOrder.slice(-7).map((entry) => entry.name)).toEqual([
      "provider_model_id_projection_version",
      "provider_model_id_document_count",
      "provider_model_id_inventory_hash",
      "provider_model_id_storage_version",
      "provider_model_id_storage_document_count",
      "provider_model_id_storage_queryable",
      "provider_model_id_storage_exact_parity",
    ]);
    const reordered = [...wrongOrder];
    const last = reordered.length - 1;
    [reordered[last - 1], reordered[last]] = [
      reordered[last]!,
      reordered[last - 1]!,
    ];
    expect(digest("publication-switch-preflight", reordered)).not.toBe(
      rollbackState.preflight.preflight_hash,
    );
    const eventWithWrongPreflight = eventFields(rollbackState.history).map(
      (entry) =>
        entry.name === "preflight_hash"
          ? field(entry.name, entry.type, activationPreflightHash)
          : entry,
    );
    expect(
      digest("publication-switch-event", eventWithWrongPreflight),
    ).not.toBe(rollbackState.history.event_hash);
  });
});
