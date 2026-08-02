import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PROVIDER_SEARCH_FTS_BUILD_VERSION,
  PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS,
  PROVIDER_SEARCH_PROJECTION_VERSION,
  READINESS_PROBE_SET_VERSION_V2,
  assertProviderSearchArtifactProofV2,
  assertProviderSearchProjection,
  assertProviderSearchStagingProjectionV2,
  assertReadinessReceiptProofV2,
  assertServingReadinessCommitProjection,
  assertServingReadinessProofV2,
  assertServingSwitchProjection,
  assertServingSwitchPreflightProofV2,
  buildImmutableManifest,
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  projectProviderSearchArtifactProofV2,
  projectProviderSearchProjection,
  projectProviderSearchStagingV2,
  projectReadinessReceiptProofV2,
  projectServingReadinessProofV2,
  projectServingSwitchPreflightProofV2,
  readProviderSearchStagingPersistenceV2,
  classifyProviderSearchStagingRetryV2,
  type ArtifactBinding,
  type ProviderSearchArtifactProofV2,
  type ProviderSearchDocumentProjection,
  type ProviderSearchProjectionInput,
  type ReadinessReceipt,
  type ServingReadinessAttestationProjectionV2,
  type ServingClosureRows,
  type ServingProviderSliceClosureRow,
  type ServingReceipt,
  type ServingResourceClosureRow,
  type ServingSwitchArtifactProofV2,
  type ServingSwitchPreflightProofV2,
} from "./index.js";

const publicationId = id("pub", 1);
const observedAt = "2026-08-02T00:00:00.000Z";

function id(prefix: string, sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function fact(value: string, evidenceSequence: number) {
  return {
    evidence_ids: [id("evd", evidenceSequence)],
    observed_at: observedAt,
    state: "known",
    value,
  } as const;
}

function unknownFact() {
  return {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  } as const;
}

function providerJson(
  providerId: string,
  displayName: string | null,
  affiliateRelationshipPresent = false,
  activeOfferingCount = 0,
  displayFactOverride?: unknown,
): string {
  return canonicalizePublicationJson(
    canonicalJson({
      active_offering_count: {
        derivation_version: "provider-count@1",
        observed_at: observedAt,
        value: activeOfferingCount,
      },
      affiliate_relationship_present: affiliateRelationshipPresent,
      display_name:
        displayFactOverride ??
        (displayName === null ? unknownFact() : fact(displayName, 1)),
      last_successful_refresh: fact(observedAt, 2),
      official_site: fact("https://provider.example", 3),
      precision_coverage: {
        derivation_version: "precision-coverage@1",
        known_count: 0,
        known_proportion_decimal: "0",
        unknown_count: 0,
      },
      provider_id: providerId,
      slug: fact(`provider-${providerId.slice(4, 12)}`, 4),
      status: fact("active", 5),
    }),
    "object",
  );
}

async function resource(
  providerId: string,
  displayName: string | null,
  affiliateRelationshipPresent = false,
  activeOfferingCount = 0,
  displayFactOverride?: unknown,
): Promise<ServingResourceClosureRow> {
  const resourceJson = providerJson(
    providerId,
    displayName,
    affiliateRelationshipPresent,
    activeOfferingCount,
    displayFactOverride,
  );
  const contentHash = await hashPublicationResourceContent({
    resourceType: "provider",
    resourceId: providerId,
    resourceJson,
  });
  return {
    resource_type: "provider",
    resource_id: providerId,
    resource_json: resourceJson,
    content_hash: contentHash,
  };
}

function slice(
  providerId: string,
  sequence: number,
  freshness: "fresh" | "stale" | "unavailable" = "fresh",
): ServingProviderSliceClosureRow {
  return {
    provider_id: providerId,
    provider_slice_id: freshness === "unavailable" ? null : id("prn", sequence),
    provider_run_id: id("pvr", sequence),
    adapter_version: "adapter@1",
    roster_version: "roster@1",
    source_register_version: "sources@1",
    carried_forward: freshness === "stale" ? 1 : 0,
    freshness_state: freshness,
  };
}

async function input(
  providers: readonly Readonly<{
    id: string;
    displayName: string | null;
    freshness?: "fresh" | "stale" | "unavailable";
    affiliate?: boolean;
    carriedForward?: boolean;
    offeringCount?: number;
    displayFactOverride?: unknown;
  }>[],
  options: Readonly<{ includeModel?: boolean }> = {},
): Promise<ProviderSearchProjectionInput> {
  const selected = providers.filter(
    (provider) => provider.freshness !== "unavailable",
  );
  const providerResources = await Promise.all(
    selected.map((provider) =>
      resource(
        provider.id,
        provider.displayName,
        provider.affiliate,
        provider.offeringCount,
        provider.displayFactOverride,
      ),
    ),
  );
  const modelId = id("mdl", 100);
  const modelResourceJson = "{}";
  const modelResourceHash = await hashPublicationResourceContent({
    resourceType: "model",
    resourceId: modelId,
    resourceJson: modelResourceJson,
  });
  const modelDocumentId = await derivePublicationVectorId(
    publicationId as `pub_${string}`,
    "model",
    modelId,
  );
  const modelDocument = {
    resourceType: "model" as const,
    resourceId: modelId,
    documentId: modelDocumentId,
    normalizedName: "unrelated model",
    aliasesJson: "[]",
    publisherName: "Publisher",
    providerModelIdsJson: "[]",
    documentText: "Unrelated model",
  };
  const modelDocumentHash =
    await hashPublicationSearchDocumentContent(modelDocument);
  const modelVector = {
    resourceType: "model" as const,
    resourceId: modelId,
    vectorId: modelDocumentId,
    searchDocumentContentHash: modelDocumentHash,
    embeddingInputHash: `sha256:${"e".repeat(64)}` as const,
  };
  const persistedResources = [
    ...providerResources.map((row) => ({
      resourceType: "provider" as const,
      resourceId: row.resource_id,
      resourceJson: row.resource_json,
      contentHash: row.content_hash as `sha256:${string}`,
    })),
    ...(options.includeModel
      ? [
          {
            resourceType: "model" as const,
            resourceId: modelId,
            resourceJson: modelResourceJson,
            contentHash: modelResourceHash,
          },
        ]
      : []),
  ];
  const resourceDescriptors = persistedResources
    .map(({ resourceType, resourceId, contentHash }) => ({
      resourceType,
      resourceId,
      contentHash,
    }))
    .sort((left, right) =>
      left.resourceId < right.resourceId
        ? -1
        : left.resourceId > right.resourceId
          ? 1
          : 0,
    );
  const resourceChunks =
    resourceDescriptors.length === 0
      ? []
      : [
          {
            kind: "resources" as const,
            ordinal: 0,
            firstKey: `provider:${resourceDescriptors[0]!.resourceId}`,
            lastKey: `provider:${resourceDescriptors.at(-1)!.resourceId}`,
            itemCount: resourceDescriptors.length,
            contentHash:
              await hashPublicationResourceChunk(resourceDescriptors),
          },
        ];
  const searchDocuments = options.includeModel
    ? [
        {
          ...modelDocument,
          contentHash: modelDocumentHash,
        },
      ]
    : [];
  const vectors = options.includeModel ? [modelVector] : [];
  const searchChunks = options.includeModel
    ? [
        {
          kind: "exact_search" as const,
          ordinal: 0,
          firstKey: `model:${modelId}`,
          lastKey: `model:${modelId}`,
          itemCount: 1,
          contentHash: await hashPublicationSearchChunk(searchDocuments),
        },
        {
          kind: "vectors" as const,
          ordinal: 0,
          firstKey: `model:${modelId}`,
          lastKey: `model:${modelId}`,
          itemCount: 1,
          contentHash: await hashPublicationVectorChunk(
            publicationId as `pub_${string}`,
            vectors,
          ),
        },
      ]
    : [];
  const servingSlices = providers.map((provider, index) => ({
    ...slice(provider.id, index + 1, provider.freshness),
    carried_forward:
      provider.carriedForward === undefined
        ? provider.freshness === "stale"
          ? 1
          : 0
        : provider.carriedForward
          ? 1
          : 0,
  }));
  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: "1.0.0",
    publicationId: publicationId as `pub_${string}`,
    sourceRunId: id("run", 1),
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
    enabledProviderIds: providers.map((provider) => provider.id),
    providerSlices: servingSlices.map((row) => ({
      providerId: row.provider_id,
      providerSliceId: row.provider_slice_id,
      providerRunId: row.provider_run_id,
      adapterVersion: row.adapter_version,
      rosterVersion: row.roster_version,
      sourceRegisterVersion: row.source_register_version,
      carriedForward: row.carried_forward === 1,
      freshnessState: row.freshness_state as "fresh" | "stale" | "unavailable",
    })),
    providerAttributions: selected.map((provider) => ({
      resourceType: "provider",
      resourceId: provider.id,
      providerId: provider.id,
    })),
    resources: persistedResources,
    searchDocuments,
    vectors,
    chunks: [...resourceChunks, ...searchChunks],
    bundleHash: `sha256:${"b".repeat(64)}`,
  });
  return {
    manifest,
    providerResources,
  };
}

const closureRows = (
  source: ProviderSearchProjectionInput,
): ServingClosureRows => ({
  publication: {
    publication_id: source.manifest.publicationId,
    source_run_id: source.manifest.sourceRunId,
    parent_publication_id: source.manifest.parentPublicationId,
    generated_at_ms: Date.parse(source.manifest.generatedAt),
    schema_version: source.manifest.versions.schema,
    methodology_version: source.manifest.versions.methodology,
    precision_normalization_version:
      source.manifest.versions.precisionNormalization,
    precision_display_order_version:
      source.manifest.versions.precisionDisplayOrder,
    price_policy_version: source.manifest.versions.pricePolicy,
    source_policy_version: source.manifest.versions.sourcePolicy,
    embedding_version: source.manifest.versions.embedding,
    build_commit: source.manifest.versions.buildCommit,
    closure_hash: source.manifest.closureHash,
  },
  providerSlices: source.manifest.providerSlices.map((row) => ({
    provider_id: row.providerId,
    provider_slice_id: row.providerSliceId,
    provider_run_id: row.providerRunId,
    adapter_version: row.adapterVersion,
    roster_version: row.rosterVersion,
    source_register_version: row.sourceRegisterVersion,
    carried_forward: row.carriedForward ? 1 : 0,
    freshness_state: row.freshnessState,
  })),
  providerAttributions: source.manifest.providerAttributions.map((row) => ({
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    provider_id: row.providerId,
  })),
  resources: source.providerResources,
  searchDocuments: [],
  vectors: [],
  chunks: source.manifest.chunks.map((row) => ({
    kind: row.kind,
    ordinal: row.ordinal,
    first_key: row.firstKey,
    last_key: row.lastKey,
    item_count: row.itemCount,
    content_hash: row.contentHash,
  })),
  manifestContractVersion: "1.0.0",
  enabledProviderScopeVersion: source.manifest.enabledProviderScopeVersion,
  bundleHash: source.manifest.bundleHash,
  stagingRevision: 1,
  sealedAtMs: Date.parse(observedAt) + 60_000,
});

function uint64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function tuple(
  domain: string,
  fields: readonly Readonly<{
    name: string;
    type: string;
    value: string;
  }>[],
): Buffer {
  const all = [
    { name: "hash_domain", type: "text", value: domain },
    { name: "encoding_version", type: "integer", value: "1" },
    ...fields,
  ];
  return Buffer.concat(
    all.flatMap((field) =>
      [field.name, field.type, field.value].flatMap((value) => {
        const bytes = Buffer.from(value, "utf8");
        return [uint64(bytes.length), bytes];
      }),
    ),
  );
}

type IndependentField = Readonly<{
  name: string;
  type: string;
  value: string;
}>;

function independentTupleHash(
  domain: string,
  fields: readonly IndependentField[],
): string {
  return `sha256:${createHash("sha256").update(tuple(domain, fields)).digest("hex")}`;
}

function providerProofFields(
  proof: ProviderSearchArtifactProofV2,
): IndependentField[] {
  return [
    {
      name: "provider_search_projection_version",
      type: "text",
      value: proof.provider_search_projection_version,
    },
    {
      name: "provider_search_document_count",
      type: "integer",
      value: String(proof.provider_search_document_count),
    },
    {
      name: "provider_search_inventory_hash",
      type: "digest",
      value: proof.provider_search_inventory_hash,
    },
    {
      name: "provider_search_fts_build_version",
      type: "text",
      value: proof.provider_search_fts_build_version,
    },
    {
      name: "provider_search_fts_document_count",
      type: "integer",
      value: String(proof.provider_search_fts_document_count),
    },
    {
      name: "provider_search_fts_queryable",
      type: "boolean",
      value: String(proof.provider_search_fts_queryable),
    },
    {
      name: "provider_search_exact_parity",
      type: "boolean",
      value: String(proof.provider_search_exact_parity),
    },
  ];
}

function independentServingReceiptHashV2(
  receipt: ServingReceipt,
  proof: ProviderSearchArtifactProofV2,
): string {
  return independentTupleHash("publication-readiness-receipt", [
    { name: "receipt_version", type: "text", value: "2.0.0" },
    { name: "kind", type: "text", value: "serving" },
    {
      name: "environment",
      type: "text",
      value: receipt.binding.environment,
    },
    {
      name: "publication_id",
      type: "identifier",
      value: receipt.binding.publicationId,
    },
    {
      name: "closure_hash",
      type: "digest",
      value: receipt.binding.closureHash,
    },
    {
      name: "bundle_hash",
      type: "digest",
      value: receipt.binding.bundleHash,
    },
    {
      name: "schema_version",
      type: "text",
      value: receipt.binding.schemaVersion,
    },
    {
      name: "build_commit",
      type: "text",
      value: receipt.binding.buildCommit,
    },
    { name: "observed_at", type: "timestamp", value: receipt.observedAt },
    {
      name: "enabled_provider_count",
      type: "integer",
      value: String(receipt.enabledProviderCount),
    },
    {
      name: "enabled_provider_scope_hash",
      type: "digest",
      value: receipt.enabledProviderScopeHash,
    },
    {
      name: "provider_slice_count",
      type: "integer",
      value: String(receipt.providerSliceCount),
    },
    {
      name: "provider_slice_hash",
      type: "digest",
      value: receipt.providerSliceHash,
    },
    {
      name: "provider_attribution_count",
      type: "integer",
      value: String(receipt.providerAttributionCount),
    },
    {
      name: "provider_attribution_hash",
      type: "digest",
      value: receipt.providerAttributionHash,
    },
    {
      name: "resource_count",
      type: "integer",
      value: String(receipt.resourceCount),
    },
    {
      name: "exact_document_count",
      type: "integer",
      value: String(receipt.exactDocumentCount),
    },
    {
      name: "resource_inventory_hash",
      type: "digest",
      value: receipt.resourceInventoryHash,
    },
    {
      name: "exact_search_inventory_hash",
      type: "digest",
      value: receipt.exactSearchInventoryHash,
    },
    {
      name: "fts_build_version",
      type: "text",
      value: receipt.ftsBuildVersion,
    },
    {
      name: "fts_document_count",
      type: "integer",
      value: String(receipt.ftsDocumentCount),
    },
    {
      name: "fts_queryable",
      type: "boolean",
      value: String(receipt.ftsQueryable),
    },
    {
      name: "foreign_keys_valid",
      type: "boolean",
      value: String(receipt.foreignKeysValid),
    },
    {
      name: "content_hashes_valid",
      type: "boolean",
      value: String(receipt.contentHashesValid),
    },
    {
      name: "unavailable_provider_isolation_valid",
      type: "boolean",
      value: String(receipt.unavailableProviderIsolationValid),
    },
    ...providerProofFields(proof),
  ]);
}

function independentAttestationHashV2(
  value: ServingReadinessAttestationProjectionV2,
): string {
  return independentTupleHash("publication-readiness-attestation", [
    { name: "evaluator_version", type: "text", value: "2.0.0" },
    { name: "environment", type: "text", value: value.environment },
    {
      name: "publication_id",
      type: "identifier",
      value: value.publication_id,
    },
    { name: "closure_hash", type: "digest", value: value.closure_hash },
    { name: "bundle_hash", type: "digest", value: value.bundle_hash },
    {
      name: "ready_at",
      type: "timestamp",
      value: new Date(value.ready_at_ms).toISOString(),
    },
    {
      name: "maximum_receipt_age_ms",
      type: "integer",
      value: String(value.maximum_receipt_age_ms),
    },
    {
      name: "effective_valid_until",
      type: "timestamp",
      value: new Date(value.effective_valid_until_ms).toISOString(),
    },
    {
      name: "archive_receipt_hash",
      type: "digest",
      value: value.archive_receipt_hash,
    },
    {
      name: "serving_receipt_hash",
      type: "digest",
      value: value.serving_receipt_hash,
    },
    {
      name: "vector_receipt_hash",
      type: "digest",
      value: value.vector_receipt_hash,
    },
    {
      name: "probes_receipt_hash",
      type: "digest",
      value: value.probes_receipt_hash,
    },
  ]);
}

function nullableField(
  name: string,
  type: "digest" | "identifier",
  value: string | null,
): IndependentField {
  return value === null
    ? { name, type: "null", value: "null" }
    : { name, type, value };
}

function independentPreflightHashV2(
  value: ServingSwitchPreflightProofV2,
): string {
  return independentTupleHash("publication-switch-preflight", [
    { name: "preflight_version", type: "text", value: "2.0.0" },
    { name: "action", type: "text", value: value.action },
    { name: "environment", type: "text", value: value.environment },
    {
      name: "expected_prior_generation",
      type: "integer",
      value: String(value.expected_prior_generation),
    },
    nullableField(
      "expected_prior_rollback_candidate_publication_id",
      "identifier",
      value.expected_prior_rollback_candidate_publication_id,
    ),
    value.expected_prior_switched_at_ms === null
      ? { name: "expected_prior_switched_at", type: "null", value: "null" }
      : {
          name: "expected_prior_switched_at",
          type: "timestamp",
          value: new Date(value.expected_prior_switched_at_ms).toISOString(),
        },
    {
      name: "new_generation",
      type: "integer",
      value: String(value.new_generation),
    },
    nullableField(
      "from_publication_id",
      "identifier",
      value.from_publication_id,
    ),
    nullableField("from_closure_hash", "digest", value.from_closure_hash),
    {
      name: "to_publication_id",
      type: "identifier",
      value: value.to_publication_id,
    },
    { name: "to_closure_hash", type: "digest", value: value.to_closure_hash },
    nullableField("to_attestation_hash", "digest", value.to_attestation_hash),
    {
      name: "switched_at",
      type: "timestamp",
      value: new Date(value.switched_at_ms).toISOString(),
    },
    {
      name: "observed_at",
      type: "timestamp",
      value: new Date(value.observed_at_ms).toISOString(),
    },
    {
      name: "maximum_age_ms",
      type: "integer",
      value: String(value.maximum_age_ms),
    },
    {
      name: "valid_until",
      type: "timestamp",
      value: new Date(value.valid_until_ms).toISOString(),
    },
    { name: "fts_build_version", type: "text", value: value.fts_build_version },
    {
      name: "fts_source_document_count",
      type: "integer",
      value: String(value.fts_source_document_count),
    },
    {
      name: "fts_index_document_count",
      type: "integer",
      value: String(value.fts_index_document_count),
    },
    {
      name: "fts_source_inventory_hash",
      type: "digest",
      value: value.fts_source_inventory_hash,
    },
    { name: "fts_exact_parity", type: "boolean", value: "true" },
    {
      name: "archive_bundle_hash",
      type: "digest",
      value: value.archive_bundle_hash,
    },
    { name: "archive_immutable", type: "boolean", value: "true" },
    {
      name: "vector_namespace",
      type: "identifier",
      value: value.vector_namespace,
    },
    {
      name: "vector_document_count",
      type: "integer",
      value: String(value.vector_document_count),
    },
    {
      name: "vector_verified_document_count",
      type: "integer",
      value: String(value.vector_verified_document_count),
    },
    {
      name: "vector_inventory_hash",
      type: "digest",
      value: value.vector_inventory_hash,
    },
    {
      name: "vector_visibility_probe_version",
      type: "text",
      value: value.vector_visibility_probe_version,
    },
    {
      name: "vector_mutation_id",
      type: "text",
      value: value.vector_mutation_id,
    },
    { name: "vector_all_ids_present", type: "boolean", value: "true" },
    { name: "vector_all_namespaces_match", type: "boolean", value: "true" },
    { name: "vector_queryable", type: "boolean", value: "true" },
    { name: "probe_set_version", type: "text", value: value.probe_set_version },
    { name: "integrity_passed", type: "boolean", value: "true" },
    { name: "exact_search_passed", type: "boolean", value: "true" },
    { name: "semantic_search_passed", type: "boolean", value: "true" },
    { name: "structured_filter_passed", type: "boolean", value: "true" },
    { name: "neutrality_passed", type: "boolean", value: "true" },
    { name: "version_isolation_passed", type: "boolean", value: "true" },
    ...providerProofFields({
      provider_search_projection_version:
        value.provider_search_projection_version,
      provider_search_document_count: value.provider_search_document_count,
      provider_search_inventory_hash: value.provider_search_inventory_hash,
      provider_search_fts_build_version:
        value.provider_search_fts_build_version,
      provider_search_fts_document_count:
        value.provider_search_fts_document_count,
      provider_search_fts_queryable: true,
      provider_search_exact_parity: true,
    } as ProviderSearchArtifactProofV2),
  ]);
}

function independentInventoryHash(
  documents: readonly ProviderSearchDocumentProjection[],
): string {
  const root = tuple("publication-provider-search-inventory", [
    {
      name: "provider_search_documents",
      type: "list",
      value: String(documents.length),
    },
  ]);
  const rows = documents.map((document) => {
    const row = tuple("publication-provider-search-document", [
      {
        name: "projection_version",
        type: "text",
        value: PROVIDER_SEARCH_PROJECTION_VERSION,
      },
      { name: "provider_id", type: "identifier", value: document.providerId },
      { name: "display_name", type: "text", value: document.displayName },
      { name: "normalized_name", type: "text", value: document.normalizedName },
      {
        name: "provider_resource_content_hash",
        type: "digest",
        value: document.providerResourceContentHash,
      },
    ]);
    return Buffer.concat([uint64(row.length), row]);
  });
  return `sha256:${createHash("sha256")
    .update(Buffer.concat([root, ...rows]))
    .digest("hex")}`;
}

function readinessReceiptsV2(
  manifest: ProviderSearchProjectionInput["manifest"],
): ReadinessReceipt[] {
  const binding: ArtifactBinding = {
    environment: "local",
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    bundleHash: manifest.bundleHash,
    schemaVersion: manifest.versions.schema,
    buildCommit: manifest.versions.buildCommit,
  };
  return [
    {
      kind: "archive",
      binding,
      observedAt: "2026-08-02T00:30:00.000Z",
      retainedBundleHash: manifest.bundleHash,
      immutable: true,
    },
    {
      kind: "serving",
      binding,
      observedAt: "2026-08-02T00:31:00.000Z",
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
      observedAt: "2026-08-02T00:32:00.000Z",
      namespace: manifest.publicationId,
      documentCount: manifest.vectors.length,
      verifiedDocumentCount: manifest.vectors.length,
      vectorInventoryHash: manifest.vectorInventoryHash,
      visibilityProbeVersion: "vector-visibility@1",
      mutationId: "provider-v2-test-mutation",
      allIdsPresent: true,
      allNamespacesMatch: true,
      queryable: true,
    },
    {
      kind: "probes",
      binding,
      observedAt: "2026-08-02T00:33:00.000Z",
      probeSetVersion: READINESS_PROBE_SET_VERSION_V2,
      integrityPassed: true,
      evidenceCoveragePassed: true,
      exactSearchPassed: true,
      semanticSearchPassed: true,
      structuredFilterPassed: true,
      neutralityPassed: true,
      versionIsolationPassed: true,
    },
  ];
}

function switchArtifactProofV2(
  manifest: ProviderSearchProjectionInput["manifest"],
): ServingSwitchArtifactProofV2 {
  return {
    environment: "local",
    observedAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
    maximumAgeMs: 60 * 60 * 1000,
    ftsBuildVersion: "fts5-unicode61@1",
    ftsSourceDocumentCount: manifest.searchDocuments.length,
    ftsIndexDocumentCount: manifest.searchDocuments.length,
    ftsSourceInventoryHash: manifest.exactSearchInventoryHash,
    ftsExactParity: true,
    archiveBundleHash: manifest.bundleHash,
    archiveImmutable: true,
    vectorNamespace: manifest.publicationId,
    vectorDocumentCount: manifest.vectors.length,
    vectorVerifiedDocumentCount: manifest.vectors.length,
    vectorInventoryHash: manifest.vectorInventoryHash,
    vectorVisibilityProbeVersion: "vector-visibility@1",
    vectorMutationId: "provider-v2-switch-mutation",
    vectorAllIdsPresent: true,
    vectorAllNamespacesMatch: true,
    vectorQueryable: true,
    probeSetVersion: READINESS_PROBE_SET_VERSION_V2,
    integrityPassed: true,
    exactSearchPassed: true,
    semanticSearchPassed: true,
    structuredFilterPassed: true,
    neutralityPassed: true,
    versionIsolationPassed: true,
  };
}

describe("trusted provider search projection (SRCH-002, SRCH-006, BE-011)", () => {
  it("accepts the ProviderSchema maximum through worst-case Unicode expansion", async () => {
    const displayName = "\ufdfa".repeat(200);
    const projection = await projectProviderSearchProjection(
      await input([{ id: id("prv", 999), displayName }]),
    );
    const normalizedName = projection.documents[0]?.normalizedName;
    expect(normalizedName).toBe(
      "\u0635\u0644\u0649 \u0627\u0644\u0644\u0647 \u0639\u0644\u064a\u0647 \u0648\u0633\u0644\u0645".repeat(
        200,
      ),
    );
    expect(Array.from(normalizedName ?? "")).toHaveLength(
      PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS,
    );
    expect(PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS).toBe(3_600);
  });

  it("uses Unicode-scalar ProviderSchema bounds for astral display names", async () => {
    const maximum = "\u{1f642}".repeat(200);
    const projection = await projectProviderSearchProjection(
      await input([{ id: id("prv", 998), displayName: maximum }]),
    );
    expect(projection.documents[0]).toMatchObject({
      displayName: maximum,
      normalizedName: maximum,
    });
    expect(Array.from(projection.documents[0]?.displayName ?? "")).toHaveLength(
      200,
    );

    await expect(
      projectProviderSearchProjection(
        await input([
          { id: id("prv", 997), displayName: "\u{1f642}".repeat(201) },
        ]),
      ),
    ).rejects.toThrow("provider search resource is not contract-valid");
    await expect(
      projectProviderSearchProjection(
        await input([{ id: id("prv", 996), displayName: "" }]),
      ),
    ).rejects.toThrow("provider search resource is not contract-valid");
    for (const [sequence, displayName] of [
      [995, "\u0000Leading"],
      [994, "Embedded\u0000Name"],
    ] as const)
      await expect(
        projectProviderSearchProjection(
          await input([{ id: id("prv", sequence), displayName }]),
        ),
      ).rejects.toThrow("provider search resource is not contract-valid");
  });

  it("projects known fresh and carried-stale names and skips honest unknowns (FE-023, FE-025)", async () => {
    const freshId = id("prv", 1);
    const staleId = id("prv", 2);
    const unknownId = id("prv", 3);
    const unavailableId = id("prv", 4);
    const projection = await projectProviderSearchProjection(
      await input([
        { id: staleId, displayName: "Same—Name", freshness: "stale" },
        { id: unknownId, displayName: null },
        { id: unavailableId, displayName: null, freshness: "unavailable" },
        { id: freshId, displayName: "Same Name" },
      ]),
    );

    expect(projection.documents.map((document) => document.providerId)).toEqual(
      [freshId, staleId],
    );
    expect(
      projection.documents.map((document) => document.normalizedName),
    ).toEqual(["same name", "same name"]);
    expect(projection.documentCount).toBe(2);
    expect(projection.inventoryHash).toBe(
      independentInventoryHash(projection.documents),
    );
    expect(projection.inventoryHash).toBe(
      "sha256:690ecf074496ba5310c42d48c3087a3a0581538ba3cfd71f9a3a0622ab346642",
    );
    expect(() => {
      assertProviderSearchProjection(projection);
    }).not.toThrow();
    expect(Object.isFrozen(projection.documents[0])).toBe(true);
  });

  it("is permutation-invariant while affiliate and count facts never affect identity or order (AFF-004, FE-026)", async () => {
    const firstId = id("prv", 5);
    const secondId = id("prv", 6);
    const first = await input([
      { id: firstId, displayName: "First" },
      { id: secondId, displayName: "Second" },
    ]);
    const reversed = {
      ...first,
      providerResources: [...first.providerResources].reverse(),
    };
    const [left, right] = await Promise.all([
      projectProviderSearchProjection(first),
      projectProviderSearchProjection(reversed),
    ]);
    expect(right.documents).toEqual(left.documents);
    expect(right.inventoryHash).toBe(left.inventoryHash);

    const affiliateChanged = await projectProviderSearchProjection(
      await input([
        { id: firstId, displayName: "First", affiliate: true },
        { id: secondId, displayName: "Second" },
      ]),
    );
    expect(
      affiliateChanged.documents.map(({ displayName }) => displayName),
    ).toEqual(["First", "Second"]);
    expect(affiliateChanged.documents[0]?.providerResourceContentHash).not.toBe(
      left.documents[0]?.providerResourceContentHash,
    );
    expect(affiliateChanged.inventoryHash).not.toBe(left.inventoryHash);

    const offeringCountChanged = await projectProviderSearchProjection(
      await input([
        { id: firstId, displayName: "First", offeringCount: 999 },
        { id: secondId, displayName: "Second", offeringCount: 42 },
      ]),
    );
    expect(
      offeringCountChanged.documents.map(({ providerId, displayName }) => ({
        providerId,
        displayName,
      })),
    ).toEqual(
      left.documents.map(({ providerId, displayName }) => ({
        providerId,
        displayName,
      })),
    );
    expect(offeringCountChanged.inventoryHash).not.toBe(left.inventoryHash);

    const withUnrelatedModel = await projectProviderSearchProjection(
      await input(
        [
          { id: firstId, displayName: "First" },
          { id: secondId, displayName: "Second" },
        ],
        { includeModel: true },
      ),
    );
    expect(withUnrelatedModel.documents).toEqual(left.documents);
    expect(withUnrelatedModel.inventoryHash).toBe(left.inventoryHash);
    expect(withUnrelatedModel.closureHash).not.toBe(left.closureHash);
  });

  it("rejects copied projections and dishonest persisted linkage", async () => {
    const providerId = id("prv", 7);
    const source = await input([{ id: providerId, displayName: "Provider" }]);
    const projection = await projectProviderSearchProjection(source);
    expect(() => {
      assertProviderSearchProjection({ ...projection });
    }).toThrow("not trusted");
    expect(() => {
      assertProviderSearchProjection(
        JSON.parse(JSON.stringify(projection)) as unknown,
      );
    }).toThrow("not trusted");

    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: source.providerResources.map((row) => ({
          ...row,
          content_hash: `sha256:${"0".repeat(64)}`,
        })),
      }),
    ).rejects.toThrow("does not match the trusted manifest");
    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: [],
      }),
    ).rejects.toThrow("do not exactly match the trusted manifest");
    await expect(
      projectProviderSearchProjection({
        manifest: { ...source.manifest },
        providerResources: source.providerResources,
      }),
    ).rejects.toThrow("manifest is not trusted");

    const mutationSource = await input([
      { id: id("prv", 11), displayName: "Snapshot" },
    ]);
    const pending = projectProviderSearchProjection(mutationSource);
    (
      mutationSource.providerResources[0] as { resource_json: string }
    ).resource_json = "{}";
    await expect(pending).resolves.toMatchObject({
      documents: [{ displayName: "Snapshot" }],
    });
  });

  it("fails closed on duplicate, orphaned, and wrong-identity provider closure rows", async () => {
    const providerId = id("prv", 40);
    const otherProviderId = id("prv", 41);
    const source = await input([{ id: providerId, displayName: "Provider" }]);
    const providerRow = source.providerResources[0]!;

    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: [providerRow, providerRow],
      }),
    ).rejects.toThrow("contain a duplicate");

    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: [
          providerRow,
          {
            ...providerRow,
            resource_id: otherProviderId,
          },
        ],
      }),
    ).rejects.toThrow("do not exactly match the trusted manifest");

    const wrongIdentityJson = providerJson(otherProviderId, "Wrong Identity");
    const wrongIdentityHash = await hashPublicationResourceContent({
      resourceType: "provider",
      resourceId: providerId,
      resourceJson: wrongIdentityJson,
    });
    const wrongIdentityResources = [
      {
        resourceType: "provider" as const,
        resourceId: providerId,
        contentHash: wrongIdentityHash,
      },
    ];
    const wrongIdentityManifest = await buildImmutableManifest({
      ...source.manifest,
      resources: wrongIdentityResources,
      chunks: [
        {
          ...source.manifest.chunks[0]!,
          contentHash: await hashPublicationResourceChunk(
            wrongIdentityResources,
          ),
        },
      ],
    });
    await expect(
      projectProviderSearchProjection({
        manifest: wrongIdentityManifest,
        providerResources: [
          {
            resource_type: "provider",
            resource_id: providerId,
            resource_json: wrongIdentityJson,
            content_hash: wrongIdentityHash,
          },
        ],
      }),
    ).rejects.toThrow("identity does not match");

    await expect(
      buildImmutableManifest({
        ...source.manifest,
        providerSlices: [
          {
            ...source.manifest.providerSlices[0]!,
            providerSliceId: null,
            freshnessState: "unavailable",
          },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      buildImmutableManifest({
        ...source.manifest,
        providerAttributions: [
          ...source.manifest.providerAttributions,
          {
            resourceType: "provider",
            resourceId: otherProviderId,
            providerId: otherProviderId,
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("uses the exact empty-inventory tuple and rejects invalid dispositions", async () => {
    const unavailableId = id("prv", 8);
    const projection = await projectProviderSearchProjection(
      await input([
        { id: unavailableId, displayName: null, freshness: "unavailable" },
      ]),
    );
    expect(projection.documents).toEqual([]);
    expect(projection.inventoryHash).toBe(
      independentInventoryHash(projection.documents),
    );
    expect(projection.inventoryHash).toBe(
      "sha256:15b3de8d9c92735a8d5379c3f5dfee54ed5e47026c57f0ad4f41acd497cb89e3",
    );

    const invalid = await input([
      {
        id: id("prv", 9),
        displayName: "Invalid",
        carriedForward: true,
      },
    ]);
    await expect(projectProviderSearchProjection(invalid)).rejects.toThrow(
      "disposition is invalid",
    );

    const bounded = await input([
      { id: id("prv", 10), displayName: "Bounded" },
    ]);
    await expect(
      projectProviderSearchProjection({
        ...bounded,
        providerResources: Array.from(
          { length: 1_001 },
          () => bounded.providerResources[0]!,
        ),
      }),
    ).rejects.toThrow("invalid or too large");
  });

  it("bounds declared manifest and projection data before taking snapshots", async () => {
    const providerId = id("prv", 50);
    const source = await input([{ id: providerId, displayName: "Bounded" }]);
    const withIgnoredProperty = { ...source.manifest };
    Object.defineProperty(withIgnoredProperty, "ignored", {
      enumerable: true,
      get: () => {
        throw new Error("undeclared property was read");
      },
    });
    await expect(
      buildImmutableManifest(withIgnoredProperty),
    ).resolves.toBeDefined();

    await expect(
      buildImmutableManifest({
        ...source.manifest,
        enabledProviderIds: Array.from({ length: 500_001 }, () => providerId),
      }),
    ).rejects.toThrow("manifest item limit");

    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: [
          {
            ...source.providerResources[0]!,
            resource_id: "prv_" + "x".repeat(1_000_001),
          },
        ],
      }),
    ).rejects.toThrow("input is invalid");

    const nearLimitJson = "x".repeat(999_000);
    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: Array.from({ length: 17 }, (_, index) => ({
          ...source.providerResources[0]!,
          resource_id: id("prv", 60 + index),
          resource_json: nearLimitJson,
        })),
      }),
    ).rejects.toThrow("input is too large");
  });

  it("rejects malformed fact evidence, timestamps, unknown values, and empty normalized names", async () => {
    const malformedFacts = [
      {
        evidence_ids: [],
        observed_at: observedAt,
        state: "known",
        value: "No Evidence",
      },
      {
        evidence_ids: [id("evd", 1)],
        observed_at: null,
        state: "known",
        value: "No Timestamp",
      },
      {
        evidence_ids: [],
        observed_at: null,
        state: "unknown",
        value: "Invented",
      },
    ];
    for (const [index, displayFactOverride] of malformedFacts.entries()) {
      const source = await input([
        {
          id: id("prv", 20 + index),
          displayName: "Ignored",
          displayFactOverride,
        },
      ]);
      await expect(projectProviderSearchProjection(source)).rejects.toThrow(
        "not contract-valid",
      );
    }

    await expect(
      projectProviderSearchProjection(
        await input([{ id: id("prv", 30), displayName: "—_( )" }]),
      ),
    ).rejects.toThrow("empty value");
  });
});

describe("dormant provider-search v2 proofs (SRCH-002, SRCH-007, PIPE-050)", () => {
  async function proofFixture() {
    const source = await input([
      { id: id("prv", 80), displayName: "Proof Provider" },
    ]);
    const projection = await projectProviderSearchProjection(source);
    const providerProof = projectProviderSearchArtifactProofV2({
      manifest: source.manifest,
      projection,
      fts: {
        buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
        documentCount: projection.documentCount,
        queryable: true,
        exactParity: true,
      },
    });
    const receiptProofs = await Promise.all(
      readinessReceiptsV2(source.manifest).map((receipt) =>
        projectReadinessReceiptProofV2({
          receipt,
          providerProof: receipt.kind === "serving" ? providerProof : null,
        }),
      ),
    );
    const readinessProof = await projectServingReadinessProofV2({
      manifest: source.manifest,
      receiptProofs,
      environment: "local",
      readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
      maximumReceiptAgeMs: 60 * 60 * 1000,
    });
    return { source, projection, providerProof, receiptProofs, readinessProof };
  }

  it("binds the exact seven-field serving suffix into v2 readiness", async () => {
    const fixture = await proofFixture();
    expect(() => {
      assertProviderSearchArtifactProofV2(fixture.providerProof);
      assertServingReadinessProofV2(fixture.readinessProof);
    }).not.toThrow();
    expect(fixture.providerProof).toEqual({
      provider_search_projection_version: "provider-name@1",
      provider_search_document_count: 1,
      provider_search_inventory_hash: fixture.projection.inventoryHash,
      provider_search_fts_build_version: "provider-name-fts5-unicode61@1",
      provider_search_fts_document_count: 1,
      provider_search_fts_queryable: true,
      provider_search_exact_parity: true,
    });
    const serving = fixture.receiptProofs.find(
      (proof) => proof.kind === "serving",
    );
    const servingReceipt = readinessReceiptsV2(fixture.source.manifest).find(
      (receipt): receipt is ServingReceipt => receipt.kind === "serving",
    );
    if (servingReceipt === undefined)
      throw new Error("fixture lacks its serving receipt");
    expect(serving?.receipt_version).toBe("2.0.0");
    expect(serving?.receipt_hash).toBe(
      independentServingReceiptHashV2(servingReceipt, fixture.providerProof),
    );
    expect(serving?.receipt_hash).toBe(
      "sha256:8370dc5eb781478bdc908a0ef4d875f05bff05ddf594aa557b7b36d30c048000",
    );
    expect(fixture.readinessProof.attestation).toMatchObject({
      evaluator_version: "2.0.0",
      serving_receipt_hash: serving?.receipt_hash,
    });
    expect(fixture.readinessProof.attestation.attestation_hash).toBe(
      independentAttestationHashV2(fixture.readinessProof.attestation),
    );
    expect(fixture.readinessProof.attestation.attestation_hash).toBe(
      "sha256:f1213cfa93b8950034f90b5ee3198e969fc22868e111d94b382e9a900956eb36",
    );
    expect(() => {
      assertServingReadinessCommitProjection(fixture.readinessProof);
    }).toThrow("not trusted");
  });

  it("grants pre-seal write authority only to an opaque detached staging projection", async () => {
    const fixture = await proofFixture();
    const staging = await projectProviderSearchStagingV2({
      projection: fixture.projection,
      closureRows: closureRows(fixture.source),
    });
    expect(() => {
      assertProviderSearchStagingProjectionV2(staging);
    }).not.toThrow();
    expect(() => {
      assertProviderSearchStagingProjectionV2({ ...staging });
    }).toThrow("not trusted");
    const persisted = readProviderSearchStagingPersistenceV2(staging);
    expect(persisted.documents).toEqual([
      {
        publication_id: fixture.source.manifest.publicationId,
        provider_id: id("prv", 80),
        projection_version: "provider-name@1",
        display_name: "Proof Provider",
        normalized_name: "proof provider",
        provider_resource_content_hash:
          fixture.projection.documents[0]?.providerResourceContentHash,
      },
    ]);
    expect(persisted.ftsRows).toEqual([
      {
        publication_id: fixture.source.manifest.publicationId,
        provider_id: id("prv", 80),
        display_name: "Proof Provider",
      },
    ]);
    expect(
      classifyProviderSearchStagingRetryV2({
        expected: staging,
        publicationState: "building",
        sealed: false,
        stagingRevision: persisted.stagingRevision,
        documents: [],
        ftsRows: [],
      }),
    ).toEqual({ outcome: "execute" });
    expect(
      classifyProviderSearchStagingRetryV2({
        expected: staging,
        publicationState: "building",
        sealed: false,
        stagingRevision: persisted.stagingRevision,
        documents: persisted.documents,
        ftsRows: persisted.ftsRows,
      }),
    ).toEqual({ outcome: "idempotent_success" });
    expect(
      classifyProviderSearchStagingRetryV2({
        expected: staging,
        publicationState: "building",
        sealed: false,
        stagingRevision: persisted.stagingRevision + 1,
        documents: [],
        ftsRows: [],
      }),
    ).toEqual({ outcome: "stale" });
  });

  it("projects activation and rollback preflight v2 without lifecycle authority", async () => {
    const fixture = await proofFixture();
    const switchedAtMs = Date.parse("2026-08-02T00:35:00.000Z");
    const activation = await projectServingSwitchPreflightProofV2({
      manifest: fixture.source.manifest,
      providerProof: fixture.providerProof,
      readinessProof: fixture.readinessProof,
      context: {
        switchId: "publication-switch|activate|1|provider-v2",
        action: "activate",
        expectedPriorGeneration: 0,
        expectedPriorRollbackCandidatePublicationId: null,
        expectedPriorSwitchedAtMs: null,
        newGeneration: 1,
        fromPublicationId: null,
        fromClosureHash: null,
        toPublicationId: fixture.source.manifest.publicationId,
        toClosureHash: fixture.source.manifest.closureHash,
        switchedAtMs,
      },
      artifactProof: switchArtifactProofV2(fixture.source.manifest),
    });
    expect(activation.preflight_hash).toBe(
      independentPreflightHashV2(activation),
    );
    expect(activation.preflight_hash).toBe(
      "sha256:3269db4e9686188b59865b34639c470ad8d11cd8bfd6dffbf3a9cfaa02d59ab4",
    );
    expect(activation.to_attestation_hash).toBe(
      fixture.readinessProof.attestation.attestation_hash,
    );
    expect(() => {
      assertServingSwitchPreflightProofV2(activation);
    }).not.toThrow();
    expect(() => {
      assertServingSwitchPreflightProofV2({ ...activation });
    }).toThrow("not trusted");
    const reflectedActivation = { ...activation };
    for (const symbol of Object.getOwnPropertySymbols(activation))
      Object.defineProperty(
        reflectedActivation,
        symbol,
        Object.getOwnPropertyDescriptor(activation, symbol)!,
      );
    expect(() => {
      assertServingSwitchPreflightProofV2(reflectedActivation);
    }).toThrow("not trusted");
    expect(() => {
      assertServingSwitchProjection(activation);
    }).toThrow("not trusted");
    const trustCases: readonly [object, (candidate: unknown) => void][] = [
      [
        fixture.providerProof,
        (candidate) => {
          assertProviderSearchArtifactProofV2(candidate);
        },
      ],
      [
        fixture.receiptProofs[0]!,
        (candidate) => {
          assertReadinessReceiptProofV2(candidate);
        },
      ],
      [
        fixture.readinessProof,
        (candidate) => {
          assertServingReadinessProofV2(candidate);
        },
      ],
      [
        activation,
        (candidate) => {
          assertServingSwitchPreflightProofV2(candidate);
        },
      ],
    ];
    for (const [trusted, assertTrusted] of trustCases) {
      expect(() => {
        assertTrusted({ ...trusted });
      }).toThrow("not trusted");
      expect(() => {
        assertTrusted(Object.create(trusted) as unknown);
      }).toThrow("not trusted");
    }

    const rollback = await projectServingSwitchPreflightProofV2({
      manifest: fixture.source.manifest,
      providerProof: fixture.providerProof,
      readinessProof: null,
      context: {
        switchId: "publication-switch|rollback|2|provider-v2",
        action: "rollback",
        expectedPriorGeneration: 1,
        expectedPriorRollbackCandidatePublicationId:
          fixture.source.manifest.publicationId,
        expectedPriorSwitchedAtMs: switchedAtMs,
        newGeneration: 2,
        fromPublicationId: id("pub", 81) as `pub_${string}`,
        fromClosureHash: `sha256:${"8".repeat(64)}`,
        toPublicationId: fixture.source.manifest.publicationId,
        toClosureHash: fixture.source.manifest.closureHash,
        switchedAtMs: switchedAtMs + 60_000,
      },
      artifactProof: {
        ...switchArtifactProofV2(fixture.source.manifest),
        observedAtMs: switchedAtMs + 30_000,
      },
    });
    expect(rollback.preflight_hash).toBe(independentPreflightHashV2(rollback));
    expect(rollback.preflight_hash).toBe(
      "sha256:da3c2c3e764f101b3367129f1a642a56006dd0cf67267213513d30952869a36d",
    );
    expect(rollback.to_attestation_hash).toBeNull();
    expect("plan" in rollback).toBe(false);
    expect("history" in rollback).toBe(false);
  });

  it("rejects copied trust, cross-closure evidence, v1 probes, and proof drift", async () => {
    const fixture = await proofFixture();
    expect(() => {
      assertProviderSearchArtifactProofV2({ ...fixture.providerProof });
    }).toThrow("not trusted");
    expect(() => {
      assertServingReadinessProofV2({ ...fixture.readinessProof });
    }).toThrow("not trusted");
    expect(() => {
      assertReadinessReceiptProofV2({ ...fixture.receiptProofs[0]! });
    }).toThrow("not trusted");
    expect(() =>
      projectProviderSearchArtifactProofV2({
        manifest: fixture.source.manifest,
        projection: {
          ...fixture.projection,
          normalizationVersion: "exact-search-normalization@2",
        } as unknown as typeof fixture.projection,
        fts: {
          buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
          documentCount: fixture.projection.documentCount,
          queryable: true,
          exactParity: true,
        },
      }),
    ).toThrow("not trusted");
    expect(() =>
      projectProviderSearchArtifactProofV2({
        manifest: fixture.source.manifest,
        projection: fixture.projection,
        fts: {
          buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
          documentCount: fixture.projection.documentCount,
          queryable: true,
          exactParity: true,
          ignored: "not closed",
        } as Parameters<typeof projectProviderSearchArtifactProofV2>[0]["fts"],
      }),
    ).toThrow("shape is invalid");

    for (const fts of [
      {
        buildVersion: "provider-name-fts5-unicode61@2",
        documentCount: fixture.projection.documentCount,
        queryable: true,
        exactParity: true,
      },
      {
        buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
        documentCount: fixture.projection.documentCount + 1,
        queryable: true,
        exactParity: true,
      },
      {
        buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
        documentCount: fixture.projection.documentCount,
        queryable: false,
        exactParity: true,
      },
      {
        buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
        documentCount: fixture.projection.documentCount,
        queryable: true,
        exactParity: false,
      },
    ])
      expect(() =>
        projectProviderSearchArtifactProofV2({
          manifest: fixture.source.manifest,
          projection: fixture.projection,
          fts: fts as Parameters<
            typeof projectProviderSearchArtifactProofV2
          >[0]["fts"],
        }),
      ).toThrow("does not match");

    const other = await input([
      { id: id("prv", 82), displayName: "Other Provider" },
    ]);
    expect(() =>
      projectProviderSearchArtifactProofV2({
        manifest: other.manifest,
        projection: fixture.projection,
        fts: {
          buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
          documentCount: fixture.projection.documentCount,
          queryable: true,
          exactParity: true,
        },
      }),
    ).toThrow("does not match");

    const probes = readinessReceiptsV2(fixture.source.manifest).find(
      (receipt) => receipt.kind === "probes",
    )!;
    await expect(
      projectReadinessReceiptProofV2({
        receipt: { ...probes, probeSetVersion: "search-gold@1" },
        providerProof: null,
      }),
    ).rejects.toThrow("probe set");
    await expect(
      projectServingSwitchPreflightProofV2({
        manifest: fixture.source.manifest,
        providerProof: fixture.providerProof,
        readinessProof: null,
        context: {
          switchId: "publication-switch|activate|1|missing-attestation",
          action: "activate",
          expectedPriorGeneration: 0,
          expectedPriorRollbackCandidatePublicationId: null,
          expectedPriorSwitchedAtMs: null,
          newGeneration: 1,
          fromPublicationId: null,
          fromClosureHash: null,
          toPublicationId: fixture.source.manifest.publicationId,
          toClosureHash: fixture.source.manifest.closureHash,
          switchedAtMs: Date.parse("2026-08-02T00:35:00.000Z"),
        },
        artifactProof: switchArtifactProofV2(fixture.source.manifest),
      }),
    ).rejects.toThrow("not trusted");
    await expect(
      projectServingSwitchPreflightProofV2({
        manifest: fixture.source.manifest,
        providerProof: fixture.providerProof,
        readinessProof: fixture.readinessProof,
        context: {
          switchId: "publication-switch|rollback|2|wrong-attestation",
          action: "rollback",
          expectedPriorGeneration: 1,
          expectedPriorRollbackCandidatePublicationId:
            fixture.source.manifest.publicationId,
          expectedPriorSwitchedAtMs: Date.parse("2026-08-02T00:35:00.000Z"),
          newGeneration: 2,
          fromPublicationId: id("pub", 83) as `pub_${string}`,
          fromClosureHash: `sha256:${"9".repeat(64)}`,
          toPublicationId: fixture.source.manifest.publicationId,
          toClosureHash: fixture.source.manifest.closureHash,
          switchedAtMs: Date.parse("2026-08-02T00:36:00.000Z"),
        },
        artifactProof: switchArtifactProofV2(fixture.source.manifest),
      }),
    ).rejects.toThrow("carries readiness attestation");
  });

  it("fails closed on v2 receipt-set, freshness, probe, and timing faults", async () => {
    const fixture = await proofFixture();
    const mutableReadinessInput = {
      manifest: fixture.source.manifest,
      receiptProofs: fixture.receiptProofs,
      environment: "local" as "local" | "preview" | "production",
      readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
      maximumReceiptAgeMs: 60 * 60 * 1000,
    };
    const readinessPending = projectServingReadinessProofV2(
      mutableReadinessInput,
    );
    mutableReadinessInput.environment = "preview";
    mutableReadinessInput.readyAtMs += 1_000;
    mutableReadinessInput.maximumReceiptAgeMs = 0;
    await expect(readinessPending).resolves.toMatchObject({
      attestation: {
        environment: "local",
        ready_at_ms: Date.parse("2026-08-02T00:34:00.000Z"),
        maximum_receipt_age_ms: 60 * 60 * 1000,
      },
    });
    await expect(
      projectServingReadinessProofV2({
        manifest: fixture.source.manifest,
        receiptProofs: fixture.receiptProofs.slice(1),
        environment: "local",
        readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).rejects.toThrow("input is invalid");
    await expect(
      projectServingReadinessProofV2({
        manifest: fixture.source.manifest,
        receiptProofs: [
          ...fixture.receiptProofs.slice(1),
          fixture.receiptProofs.find((proof) => proof.kind === "serving")!,
        ],
        environment: "local",
        readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).rejects.toThrow("incomplete");
    await expect(
      projectServingReadinessProofV2({
        manifest: fixture.source.manifest,
        receiptProofs: fixture.receiptProofs,
        environment: "local",
        readyAtMs: Date.parse("2026-08-02T03:34:00.000Z"),
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).rejects.toThrow("receipt_stale");

    const other = await input([
      { id: id("prv", 84), displayName: "Different Closure" },
    ]);
    await expect(
      projectServingReadinessProofV2({
        manifest: other.manifest,
        receiptProofs: fixture.receiptProofs,
        environment: "local",
        readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).rejects.toThrow("bindings do not match");

    const mutableSwitchInput = {
      manifest: fixture.source.manifest,
      providerProof: fixture.providerProof,
      readinessProof: fixture.readinessProof,
      context: {
        switchId: "publication-switch|activate|1|snapshot",
        action: "activate" as const,
        expectedPriorGeneration: 0,
        expectedPriorRollbackCandidatePublicationId: null,
        expectedPriorSwitchedAtMs: null,
        newGeneration: 1,
        fromPublicationId: null,
        fromClosureHash: null,
        toPublicationId: fixture.source.manifest.publicationId,
        toClosureHash: fixture.source.manifest.closureHash,
        switchedAtMs: Date.parse("2026-08-02T00:35:00.000Z"),
      },
      artifactProof: switchArtifactProofV2(fixture.source.manifest),
    };
    const switchPending =
      projectServingSwitchPreflightProofV2(mutableSwitchInput);
    mutableSwitchInput.manifest = other.manifest;
    await expect(switchPending).resolves.toMatchObject({
      to_publication_id: fixture.source.manifest.publicationId,
      to_closure_hash: fixture.source.manifest.closureHash,
    });

    const falseProbeReceipts = readinessReceiptsV2(fixture.source.manifest).map(
      (receipt) =>
        receipt.kind === "probes"
          ? {
              ...receipt,
              neutralityPassed: false,
              versionIsolationPassed: false,
            }
          : receipt,
    );
    const falseProbeProofs = await Promise.all(
      falseProbeReceipts.map((receipt) =>
        projectReadinessReceiptProofV2({
          receipt,
          providerProof:
            receipt.kind === "serving" ? fixture.providerProof : null,
        }),
      ),
    );
    await expect(
      projectServingReadinessProofV2({
        manifest: fixture.source.manifest,
        receiptProofs: falseProbeProofs,
        environment: "local",
        readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).rejects.toThrow("probes_failed");

    const archive = readinessReceiptsV2(fixture.source.manifest).find(
      (receipt) => receipt.kind === "archive",
    );
    if (archive === undefined) throw new Error("fixture lacks archive receipt");
    let observedAtReads = 0;
    const changingArchive = { ...archive };
    Object.defineProperty(changingArchive, "observedAt", {
      enumerable: true,
      get: () => {
        observedAtReads += 1;
        return observedAtReads === 1 ? archive.observedAt : "changed";
      },
    });
    await expect(
      projectReadinessReceiptProofV2({
        receipt: changingArchive,
        providerProof: null,
      }),
    ).resolves.toBeDefined();
    expect(observedAtReads).toBe(1);

    const servingReceipt = readinessReceiptsV2(fixture.source.manifest).find(
      (receipt) => receipt.kind === "serving",
    );
    if (servingReceipt === undefined)
      throw new Error("fixture lacks serving receipt");
    const mutableReceiptInput = {
      receipt: servingReceipt,
      providerProof:
        fixture.providerProof as ProviderSearchArtifactProofV2 | null,
    };
    const receiptPending = projectReadinessReceiptProofV2(mutableReceiptInput);
    mutableReceiptInput.providerProof = null;
    const snapshottedServingProof = await receiptPending;
    await expect(
      projectServingReadinessProofV2({
        manifest: fixture.source.manifest,
        receiptProofs: fixture.receiptProofs.map((proof) =>
          proof.kind === "serving" ? snapshottedServingProof : proof,
        ),
        environment: "local",
        readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).resolves.toBeDefined();

    const beforeReadyArtifact = {
      ...switchArtifactProofV2(fixture.source.manifest),
      observedAtMs: Date.parse("2026-08-02T00:33:00.000Z"),
    };
    await expect(
      projectServingSwitchPreflightProofV2({
        manifest: fixture.source.manifest,
        providerProof: fixture.providerProof,
        readinessProof: fixture.readinessProof,
        context: {
          switchId: "publication-switch|activate|1|before-ready",
          action: "activate",
          expectedPriorGeneration: 0,
          expectedPriorRollbackCandidatePublicationId: null,
          expectedPriorSwitchedAtMs: null,
          newGeneration: 1,
          fromPublicationId: null,
          fromClosureHash: null,
          toPublicationId: fixture.source.manifest.publicationId,
          toClosureHash: fixture.source.manifest.closureHash,
          switchedAtMs: Date.parse("2026-08-02T00:33:30.000Z"),
        },
        artifactProof: beforeReadyArtifact,
      }),
    ).rejects.toThrow("attestation is invalid");
    for (const [label, switchedAt, observedAt] of [
      ["at-ready", "2026-08-02T00:34:00.000Z", "2026-08-02T00:34:00.000Z"],
      ["at-deadline", "2026-08-02T01:30:00.000Z", "2026-08-02T01:29:00.000Z"],
    ] as const)
      await expect(
        projectServingSwitchPreflightProofV2({
          manifest: fixture.source.manifest,
          providerProof: fixture.providerProof,
          readinessProof: fixture.readinessProof,
          context: {
            switchId: `publication-switch|activate|1|${label}`,
            action: "activate",
            expectedPriorGeneration: 0,
            expectedPriorRollbackCandidatePublicationId: null,
            expectedPriorSwitchedAtMs: null,
            newGeneration: 1,
            fromPublicationId: null,
            fromClosureHash: null,
            toPublicationId: fixture.source.manifest.publicationId,
            toClosureHash: fixture.source.manifest.closureHash,
            switchedAtMs: Date.parse(switchedAt),
          },
          artifactProof: {
            ...switchArtifactProofV2(fixture.source.manifest),
            observedAtMs: Date.parse(observedAt),
          },
        }),
      ).resolves.toBeDefined();
    await expect(
      projectServingSwitchPreflightProofV2({
        manifest: fixture.source.manifest,
        providerProof: fixture.providerProof,
        readinessProof: fixture.readinessProof,
        context: {
          switchId: "publication-switch|activate|1|expired",
          action: "activate",
          expectedPriorGeneration: 0,
          expectedPriorRollbackCandidatePublicationId: null,
          expectedPriorSwitchedAtMs: null,
          newGeneration: 1,
          fromPublicationId: null,
          fromClosureHash: null,
          toPublicationId: fixture.source.manifest.publicationId,
          toClosureHash: fixture.source.manifest.closureHash,
          switchedAtMs: Date.parse("2026-08-02T02:35:00.000Z"),
        },
        artifactProof: {
          ...switchArtifactProofV2(fixture.source.manifest),
          observedAtMs: Date.parse("2026-08-02T02:34:00.000Z"),
        },
      }),
    ).rejects.toThrow("attestation is invalid");
  });

  it("accepts an honestly empty provider inventory without a sentinel row", async () => {
    const source = await input([
      {
        id: id("prv", 90),
        displayName: null,
        freshness: "unavailable",
      },
    ]);
    const projection = await projectProviderSearchProjection(source);
    const providerProof = projectProviderSearchArtifactProofV2({
      manifest: source.manifest,
      projection,
      fts: {
        buildVersion: PROVIDER_SEARCH_FTS_BUILD_VERSION,
        documentCount: 0,
        queryable: true,
        exactParity: true,
      },
    });
    expect(providerProof).toMatchObject({
      provider_search_document_count: 0,
      provider_search_fts_document_count: 0,
      provider_search_inventory_hash:
        "sha256:15b3de8d9c92735a8d5379c3f5dfee54ed5e47026c57f0ad4f41acd497cb89e3",
    });
    const emptyStaging = await projectProviderSearchStagingV2({
      projection,
      closureRows: closureRows(source),
    });
    expect(
      classifyProviderSearchStagingRetryV2({
        expected: emptyStaging,
        publicationState: "building",
        sealed: false,
        stagingRevision:
          readProviderSearchStagingPersistenceV2(emptyStaging).stagingRevision,
        documents: [],
        ftsRows: [],
      }),
    ).toEqual({ outcome: "execute" });
    expect(
      classifyProviderSearchStagingRetryV2({
        expected: emptyStaging,
        publicationState: "ready",
        sealed: true,
        stagingRevision:
          readProviderSearchStagingPersistenceV2(emptyStaging).stagingRevision,
        documents: [],
        ftsRows: [],
      }),
    ).toEqual({ outcome: "integrity_failure" });
    const receiptProofs = await Promise.all(
      readinessReceiptsV2(source.manifest).map((receipt) =>
        projectReadinessReceiptProofV2({
          receipt,
          providerProof: receipt.kind === "serving" ? providerProof : null,
        }),
      ),
    );
    await expect(
      projectServingReadinessProofV2({
        manifest: source.manifest,
        receiptProofs,
        environment: "local",
        readyAtMs: Date.parse("2026-08-02T00:34:00.000Z"),
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).resolves.toBeDefined();
  });
});
