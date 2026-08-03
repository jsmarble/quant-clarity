import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  assertServingReadinessCommitProjection,
  assertServingSwitchProjection,
  buildBackupRootHash,
  buildImmutableManifest,
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  classifyServingReadinessCommitRetry,
  classifyServingSwitchRetry,
  decideHotRetention,
  derivePublicationVectorId,
  deriveNormalizedPublicationHead,
  evaluateReadiness,
  hashCanonicalTuple,
  hashPublicationResourceContent,
  hashPublicationResourceChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationSearchChunk,
  hashPublicationVectorChunk,
  planActivation,
  planRollback,
  projectServingClosureSeal,
  projectServingReadinessAttestation,
  projectServingReadinessCommit,
  projectServingReadinessReceiptRows,
  projectServingSwitch,
  readServingReadinessReceipts,
  selectPublication,
  SERVING_BACKUP_TABLES,
  validateBackupManifest,
  validateManifestInput,
  verifyImmutableManifest,
  verifyServingReadinessAttestationProjection,
  verifyServingClosureSealProjection,
  type ArtifactBinding,
  type BackupManifest,
  type ImmutablePublicationManifest,
  type StoredPublicationHead,
  type PublicationManifestInput,
  type PublicationRecord,
  type ReadinessReceipt,
  type ServingChunkClosureRow,
  type ServingClosureRows,
  type ServingProviderAttributionClosureRow,
  type ServingProviderSliceClosureRow,
  type ServingPublicationClosureRow,
  type ServingResourceClosureRow,
  type ServingReadinessReceiptRows,
  type ServingReadinessAttestationProjection,
  type ServingSearchDocumentClosureRow,
  type ServingSwitchHistoryRow,
  type ServingSwitchPreflightRow,
  type ServingVectorClosureRow,
  type SwitchAuthorization,
} from "./index.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
const UUID_E = "55555555-5555-4555-8555-555555555555";
const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;
const VECTOR_A =
  "005355ece853f66dfb82aca841ddfd1ee7aad59ba93be96ee481abdf98635a8a";
const VECTOR_B =
  "fd5c2daf17463b6a91c214570b59b90c28a45b9677703faf6a8851b7353c00f6";
const NOW = "2026-08-01T12:00:00.000Z";
const AUTHORIZATION = {
  kind: "pipeline" as const,
  identityId: "pipeline-publication-test",
};

const applyServingV1Migrations = (): DatabaseSync => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const filename of readdirSync(resolve("migrations", "serving")).sort()) {
    if (filename > "0006_exact_generation_activation.sql") continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(
        readFileSync(resolve("migrations", "serving", filename), "utf8"),
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return database;
};

const insertReadinessReceiptRows = (
  database: DatabaseSync,
  rows: ServingReadinessReceiptRows,
): void => {
  for (const row of rows.bindings)
    database
      .prepare(
        "INSERT INTO publication_readiness_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.publication_id,
        row.kind,
        row.receipt_version,
        row.receipt_hash,
        row.environment,
        row.closure_hash,
        row.bundle_hash,
        row.schema_version,
        row.build_commit,
        row.observed_at_ms,
      );
  for (const row of rows.archives)
    database
      .prepare("INSERT INTO publication_archive_receipt VALUES (?, ?, ?, ?)")
      .run(
        row.publication_id,
        row.kind,
        row.retained_bundle_hash,
        row.immutable,
      );
  for (const row of rows.servings)
    database
      .prepare(
        "INSERT INTO publication_serving_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.publication_id,
        row.kind,
        row.enabled_provider_count,
        row.enabled_provider_scope_hash,
        row.provider_slice_count,
        row.provider_slice_hash,
        row.provider_attribution_count,
        row.provider_attribution_hash,
        row.resource_count,
        row.exact_document_count,
        row.resource_inventory_hash,
        row.exact_search_inventory_hash,
        row.fts_build_version,
        row.fts_document_count,
        row.fts_queryable,
        row.foreign_keys_valid,
        row.content_hashes_valid,
        row.unavailable_provider_isolation_valid,
      );
  for (const row of rows.vectors)
    database
      .prepare(
        "INSERT INTO publication_vector_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.publication_id,
        row.kind,
        row.vector_namespace,
        row.document_count,
        row.verified_document_count,
        row.vector_inventory_hash,
        row.visibility_probe_version,
        row.mutation_id,
        row.all_ids_present,
        row.all_namespaces_match,
        row.queryable,
      );
  for (const row of rows.probes)
    database
      .prepare(
        "INSERT INTO publication_probe_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.publication_id,
        row.kind,
        row.probe_set_version,
        row.integrity_passed,
        row.evidence_coverage_passed,
        row.exact_search_passed,
        row.semantic_search_passed,
        row.structured_filter_passed,
        row.neutrality_passed,
        row.version_isolation_passed,
      );
};

const selectReadinessReceiptRows = (
  database: DatabaseSync,
  publicationId: string,
): ServingReadinessReceiptRows => ({
  bindings: database
    .prepare(
      "SELECT publication_id, kind, receipt_version, receipt_hash, environment, closure_hash, bundle_hash, schema_version, build_commit, observed_at_ms FROM publication_readiness_receipt WHERE publication_id = ? ORDER BY kind",
    )
    .all(publicationId) as unknown as ServingReadinessReceiptRows["bindings"],
  archives: database
    .prepare(
      "SELECT publication_id, kind, retained_bundle_hash, immutable FROM publication_archive_receipt WHERE publication_id = ?",
    )
    .all(publicationId) as unknown as ServingReadinessReceiptRows["archives"],
  servings: database
    .prepare(
      "SELECT publication_id, kind, enabled_provider_count, enabled_provider_scope_hash, provider_slice_count, provider_slice_hash, provider_attribution_count, provider_attribution_hash, resource_count, exact_document_count, resource_inventory_hash, exact_search_inventory_hash, fts_build_version, fts_document_count, fts_queryable, foreign_keys_valid, content_hashes_valid, unavailable_provider_isolation_valid FROM publication_serving_receipt WHERE publication_id = ?",
    )
    .all(publicationId) as unknown as ServingReadinessReceiptRows["servings"],
  vectors: database
    .prepare(
      "SELECT publication_id, kind, vector_namespace, document_count, verified_document_count, vector_inventory_hash, visibility_probe_version, mutation_id, all_ids_present, all_namespaces_match, queryable FROM publication_vector_receipt WHERE publication_id = ?",
    )
    .all(publicationId) as unknown as ServingReadinessReceiptRows["vectors"],
  probes: database
    .prepare(
      "SELECT publication_id, kind, probe_set_version, integrity_passed, evidence_coverage_passed, exact_search_passed, semantic_search_passed, structured_filter_passed, neutrality_passed, version_isolation_passed FROM publication_probe_receipt WHERE publication_id = ?",
    )
    .all(publicationId) as unknown as ServingReadinessReceiptRows["probes"],
});

const insertReadinessAttestation = (
  database: DatabaseSync,
  row: ServingReadinessAttestationProjection,
): void => {
  database
    .prepare(
      "INSERT INTO publication_readiness_attestation VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      row.publication_id,
      row.environment,
      row.closure_hash,
      row.bundle_hash,
      row.evaluator_version,
      row.ready_at_ms,
      row.maximum_receipt_age_ms,
      row.effective_valid_until_ms,
      row.archive_observed_at_ms,
      row.serving_observed_at_ms,
      row.vector_observed_at_ms,
      row.probes_observed_at_ms,
      row.archive_receipt_hash,
      row.serving_receipt_hash,
      row.vector_receipt_hash,
      row.probes_receipt_hash,
      row.attestation_hash,
    );
};

const insertServingSwitch = (
  database: DatabaseSync,
  preflight: ServingSwitchPreflightRow,
  history: ServingSwitchHistoryRow,
): void => {
  const preflightValues = [
    preflight.switch_id,
    preflight.preflight_version,
    preflight.preflight_hash,
    preflight.action,
    preflight.environment,
    preflight.expected_prior_generation,
    preflight.expected_prior_rollback_candidate_publication_id,
    preflight.expected_prior_switched_at_ms,
    preflight.new_generation,
    preflight.from_publication_id,
    preflight.from_closure_hash,
    preflight.to_publication_id,
    preflight.to_closure_hash,
    preflight.to_attestation_hash,
    preflight.switched_at_ms,
    preflight.observed_at_ms,
    preflight.maximum_age_ms,
    preflight.valid_until_ms,
    preflight.fts_build_version,
    preflight.fts_source_document_count,
    preflight.fts_index_document_count,
    preflight.fts_source_inventory_hash,
    preflight.fts_exact_parity,
    preflight.archive_bundle_hash,
    preflight.archive_immutable,
    preflight.vector_namespace,
    preflight.vector_document_count,
    preflight.vector_verified_document_count,
    preflight.vector_inventory_hash,
    preflight.vector_visibility_probe_version,
    preflight.vector_mutation_id,
    preflight.vector_all_ids_present,
    preflight.vector_all_namespaces_match,
    preflight.vector_queryable,
    preflight.probe_set_version,
    preflight.integrity_passed,
    preflight.exact_search_passed,
    preflight.semantic_search_passed,
    preflight.structured_filter_passed,
    preflight.neutrality_passed,
    preflight.version_isolation_passed,
  ] as const;
  database
    .prepare(
      `INSERT INTO publication_switch_preflight VALUES (${preflightValues.map(() => "?").join(", ")})`,
    )
    .run(...preflightValues);
  const historyValues = [
    history.switch_id,
    history.event_version,
    history.event_hash,
    history.preflight_hash,
    history.action,
    history.expected_prior_generation,
    history.expected_prior_rollback_candidate_publication_id,
    history.expected_prior_switched_at_ms,
    history.new_generation,
    history.from_publication_id,
    history.from_closure_hash,
    history.to_publication_id,
    history.to_closure_hash,
    history.to_attestation_hash,
    history.resulting_rollback_candidate_publication_id,
    history.switched_at_ms,
    history.authorized_by_kind,
    history.authorized_identity_id,
  ] as const;
  database
    .prepare(
      `INSERT INTO publication_switch_history VALUES (${historyValues.map(() => "?").join(", ")})`,
    )
    .run(...historyValues);
};

const manifestInput = (): PublicationManifestInput => ({
  contractVersion: "1.0.0",
  publicationId: `pub_${UUID_B}`,
  sourceRunId: `run_${UUID_A}`,
  parentPublicationId: `pub_${UUID_A}`,
  generatedAt: "2026-08-01T11:00:00.000Z",
  versions: {
    schema: "1.0.0",
    methodology: "methodology@1",
    precisionNormalization: "precision@1",
    precisionDisplayOrder: "display@1",
    pricePolicy: "price@1",
    sourcePolicy: "source@1",
    embedding: "embedding@1",
    buildCommit: "git:abc123",
  },
  enabledProviderScopeVersion: "launch-scope@1",
  enabledProviderIds: [`prv_${UUID_A}`, `prv_${UUID_B}`],
  providerSlices: [
    {
      providerId: `prv_${UUID_A}`,
      providerSliceId: `prn_${UUID_A}`,
      providerRunId: `pvr_${UUID_A}`,
      adapterVersion: "adapter@1",
      rosterVersion: "roster@1",
      sourceRegisterVersion: "source-register@1",
      carriedForward: false,
      freshnessState: "fresh",
    },
    {
      providerId: `prv_${UUID_B}`,
      providerSliceId: null,
      providerRunId: `pvr_${UUID_B}`,
      adapterVersion: "adapter@1",
      rosterVersion: "roster@1",
      sourceRegisterVersion: "source-register@1",
      carriedForward: false,
      freshnessState: "unavailable",
    },
  ],
  providerAttributions: [
    {
      resourceType: "provider",
      resourceId: `prv_${UUID_A}`,
      providerId: `prv_${UUID_A}`,
    },
  ],
  resources: [
    {
      resourceType: "provider",
      resourceId: `prv_${UUID_A}`,
      contentHash: HASH_A,
    },
    {
      resourceType: "model",
      resourceId: `mdl_${UUID_A}`,
      contentHash: HASH_B,
    },
    {
      resourceType: "variant",
      resourceId: `var_${UUID_B}`,
      contentHash: HASH_C,
    },
  ],
  searchDocuments: [
    {
      resourceType: "model",
      resourceId: `mdl_${UUID_A}`,
      documentId: VECTOR_A,
      contentHash: HASH_A,
    },
    {
      resourceType: "variant",
      resourceId: `var_${UUID_B}`,
      documentId: VECTOR_B,
      contentHash: HASH_B,
    },
  ],
  vectors: [
    {
      resourceType: "model",
      resourceId: `mdl_${UUID_A}`,
      vectorId: VECTOR_A,
      searchDocumentContentHash: HASH_A,
      embeddingInputHash: HASH_C,
    },
    {
      resourceType: "variant",
      resourceId: `var_${UUID_B}`,
      vectorId: VECTOR_B,
      searchDocumentContentHash: HASH_B,
      embeddingInputHash: HASH_C,
    },
  ],
  chunks: [
    {
      kind: "resources",
      ordinal: 0,
      firstKey: `model:mdl_${UUID_A}`,
      lastKey: `variant:var_${UUID_B}`,
      itemCount: 3,
      contentHash: HASH_A,
    },
    {
      kind: "exact_search",
      ordinal: 0,
      firstKey: `model:mdl_${UUID_A}`,
      lastKey: `variant:var_${UUID_B}`,
      itemCount: 2,
      contentHash: HASH_B,
    },
    {
      kind: "vectors",
      ordinal: 0,
      firstKey: `model:mdl_${UUID_A}`,
      lastKey: `variant:var_${UUID_B}`,
      itemCount: 2,
      contentHash: HASH_C,
    },
  ],
  bundleHash: HASH_C,
});

const fixtureCanonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value))
    return `[${value.map(fixtureCanonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${fixtureCanonicalJson(record[key])}`)
    .join(",")}}`;
};

const fixtureKnownFact = <T>(value: T) => ({
  evidence_ids: [`evd_${UUID_C}`],
  observed_at: "2026-08-01T11:00:00.000Z",
  state: "known" as const,
  value,
});

const fixtureUnknownFact = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown" as const,
  value: null,
});

const fixtureModelFamily = (familyId: string, modelIds: readonly string[]) => ({
  display_name: fixtureKnownFact("Fixture Family"),
  family_id: familyId,
  last_model_data_refresh: fixtureKnownFact("2026-08-01T11:00:00.000Z"),
  model_ids: [...modelIds],
  publisher: fixtureKnownFact("Fixture Publisher"),
  slug: fixtureKnownFact("fixture-family"),
});

const fixtureModel = (modelId: string, familyId: string) => ({
  active_parameters: fixtureUnknownFact(),
  architecture: fixtureUnknownFact(),
  authoritative_checkpoint_ids: [],
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: "2026-08-01T11:00:00.000Z",
    value: 0,
  },
  checkpoints: [],
  context_window_tokens: fixtureUnknownFact(),
  display_name: fixtureKnownFact("Fixture Model"),
  family_id: familyId,
  last_model_data_refresh: fixtureKnownFact("2026-08-01T11:00:00.000Z"),
  license: fixtureUnknownFact(),
  maximum_output_tokens: fixtureUnknownFact(),
  modalities: fixtureUnknownFact(),
  model_id: modelId,
  publisher: fixtureKnownFact("Fixture Publisher"),
  release_date: fixtureKnownFact("2026-08-01"),
  slug: fixtureKnownFact("fixture-model"),
  source_quantization: fixtureUnknownFact(),
  source_weight_format: fixtureUnknownFact(),
  status: fixtureKnownFact("active"),
  total_parameters: fixtureUnknownFact(),
});

const fixtureVariant = (
  variantId: string,
  modelId: string,
  familyId: string,
) => ({
  active_parameters: fixtureUnknownFact(),
  architecture: fixtureUnknownFact(),
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: "2026-08-01T11:00:00.000Z",
    value: 0,
  },
  checkpoint_ids: [],
  checkpoints: [],
  context_window_tokens: fixtureUnknownFact(),
  display_name: fixtureKnownFact("Fixture Variant"),
  family_id: familyId,
  last_model_data_refresh: fixtureKnownFact("2026-08-01T11:00:00.000Z"),
  license: fixtureUnknownFact(),
  maximum_output_tokens: fixtureUnknownFact(),
  modalities: fixtureUnknownFact(),
  model_id: modelId,
  publisher: fixtureKnownFact("Fixture Publisher"),
  release_date: fixtureKnownFact("2026-08-01"),
  selection_evidence: fixtureUnknownFact(),
  slug: fixtureKnownFact("fixture-variant"),
  source_quantization: fixtureUnknownFact(),
  source_weight_format: fixtureUnknownFact(),
  status: fixtureKnownFact("active"),
  total_parameters: fixtureUnknownFact(),
  variant_id: variantId,
  variant_kind: fixtureKnownFact("publisher_variant"),
});

const record = (
  publicationId: `pub_${string}`,
  state: PublicationRecord["state"],
  overrides: Partial<PublicationRecord> = {},
): PublicationRecord => ({
  publicationId,
  closureHash: HASH_A,
  state,
  generatedAt: "2026-08-01T09:00:00.000Z",
  readyAt:
    state === "building" || state === "failed"
      ? null
      : "2026-08-01T09:30:00.000Z",
  firstActivatedAt:
    state === "active" || state === "superseded" || state === "rolled_back"
      ? "2026-08-01T10:00:00.000Z"
      : null,
  lastHeadReferencedAt: "2026-08-01T10:00:00.000Z",
  ...overrides,
});

const head = (): StoredPublicationHead => ({
  activePublicationId: `pub_${UUID_A}`,
  rollbackCandidatePublicationId: null,
  switchedAt: "2026-08-01T10:00:00.000Z",
  generation: 1,
});

describe("immutable publication closure (PIPE-050, PIPE-051, BE-011)", () => {
  it("encodes true uint64be UTF-8 byte lengths including multibyte text", async () => {
    const fields = [
      "hash_domain",
      "text",
      "golden",
      "encoding_version",
      "integer",
      "1",
      "accent",
      "text",
      "é",
      "ideograph",
      "text",
      "界",
    ];
    const bytes: Buffer[] = [];
    for (const field of fields) {
      const value = Buffer.from(field, "utf8");
      const length = Buffer.alloc(8);
      length.writeBigUInt64BE(BigInt(value.length));
      bytes.push(length, value);
    }
    const expected = `sha256:${createHash("sha256")
      .update(Buffer.concat(bytes))
      .digest("hex")}`;
    await expect(
      hashCanonicalTuple("golden", [
        { name: "accent", type: "text", value: "é" },
        { name: "ideograph", type: "text", value: "界" },
      ]),
    ).resolves.toBe(expected);
  });

  it("canonicalizes persisted JSON and recomputes content hashes before sealing", async () => {
    expect(canonicalizePublicationJson('{"a":[2,1],"z":1}', "object")).toBe(
      '{"a":[2,1],"z":1}',
    );
    const base = manifestInput();
    const familyId = `fam_${UUID_A}`;
    const modelId = `mdl_${UUID_A}`;
    const variantId = `var_${UUID_B}`;
    const canonicalResourceJson = new Map([
      [
        `model:${modelId}`,
        fixtureCanonicalJson(fixtureModel(modelId, familyId)),
      ],
      [
        `variant:${variantId}`,
        fixtureCanonicalJson(fixtureVariant(variantId, modelId, familyId)),
      ],
    ]);
    const persistedResources = await Promise.all(
      base.resources.map(async (resource, index) => {
        const value = {
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          resourceJson:
            canonicalResourceJson.get(
              `${resource.resourceType}:${resource.resourceId}`,
            ) ?? (index === 0 ? '{"a":2,"z":1}' : '{"name":"one"}'),
        };
        return {
          ...value,
          contentHash: await hashPublicationResourceContent(value),
        };
      }),
    );
    const familyResourceBase = {
      resourceType: "model_family" as const,
      resourceId: familyId,
      resourceJson: fixtureCanonicalJson(
        fixtureModelFamily(familyId, [modelId]),
      ),
    };
    persistedResources.push({
      ...familyResourceBase,
      contentHash: await hashPublicationResourceContent(familyResourceBase),
    });
    const sortedPersistedResources = [...persistedResources].sort(
      (left, right) => {
        const leftKey = `${left.resourceType}:${left.resourceId}`;
        const rightKey = `${right.resourceType}:${right.resourceId}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      },
    );
    const resourceChunk = {
      kind: "resources" as const,
      ordinal: 0,
      firstKey: `${sortedPersistedResources[0]!.resourceType}:${sortedPersistedResources[0]!.resourceId}`,
      lastKey: `${sortedPersistedResources.at(-1)!.resourceType}:${sortedPersistedResources.at(-1)!.resourceId}`,
      itemCount: sortedPersistedResources.length,
      contentHash: await hashPublicationResourceChunk(sortedPersistedResources),
    };
    const persistedSearchDocuments = await Promise.all(
      base.searchDocuments.map(async (document) => {
        const value = {
          resourceType: document.resourceType,
          resourceId: document.resourceId,
          documentId: document.documentId,
          normalizedName: "one",
          aliasesJson: "[]",
          publisherName: "Publisher",
          providerModelIdsJson: "[]",
          documentText: "one model",
        };
        return {
          ...value,
          contentHash: await hashPublicationSearchDocumentContent(value),
        };
      }),
    );
    const vectors = base.vectors.map((vector, index) => ({
      ...vector,
      searchDocumentContentHash:
        persistedSearchDocuments[index]?.contentHash ?? HASH_A,
    }));
    const manifest = await buildImmutableManifestFromPersistedContent({
      ...base,
      resources: persistedResources,
      searchDocuments: persistedSearchDocuments,
      vectors,
      chunks: base.chunks.map((chunk) =>
        chunk.kind === "resources" ? resourceChunk : chunk,
      ),
    });
    await expect(verifyImmutableManifest(manifest)).resolves.toEqual([]);
    await expect(
      buildImmutableManifestFromPersistedContent({
        ...base,
        resources: [
          { ...persistedResources[0]!, contentHash: HASH_A },
          ...persistedResources.slice(1),
        ],
        searchDocuments: persistedSearchDocuments,
        vectors,
        chunks: base.chunks.map((chunk) =>
          chunk.kind === "resources" ? resourceChunk : chunk,
        ),
      }),
    ).rejects.toThrow(/resource content hash does not match/u);
    await expect(
      hashPublicationResourceContent({
        resourceType: "model",
        resourceId: `mdl_${UUID_A}`,
        resourceJson: '{"z":1,"a":2}',
      }),
    ).rejects.toThrow(/must be canonical/u);
  });

  it("uses fixed content-hash vectors and rejects ambiguous JSON bytes", async () => {
    await expect(
      hashPublicationResourceContent({
        resourceType: "model",
        resourceId: `mdl_${UUID_A}`,
        resourceJson:
          '{"label":"精度","nested":{"emoji":"🔒","values":[1,2,3]}}',
      }),
    ).resolves.toBe(
      "sha256:e0de6e4b207796e89441c4f9191294ef21a4d874eb94b31a367ccecd577764c6",
    );
    await expect(
      hashPublicationSearchDocumentContent({
        resourceType: "model",
        resourceId: `mdl_${UUID_A}`,
        documentId: VECTOR_A,
        normalizedName: "módèle",
        aliasesJson: '["模型","🔒"]',
        publisherName: "Éditeur",
        providerModelIdsJson: '["alpha"]',
        documentText: "Modèle 精度 🔒",
      }),
    ).resolves.toBe(
      "sha256:746fc9249681799ed9d9b65cca28f554c92165a0c4fa2d17373cfafc33379732",
    );
    for (const invalid of [
      '{"x":1,"x":2}',
      '{ "x":1}',
      '{"z":1,"a":2}',
      '{"x":-0}',
      '{"x":1.5}',
      '{"x":9007199254740992}',
      '{"x":9007199254740993}',
      '{"é":1}',
      "not-json",
    ])
      expect(() => canonicalizePublicationJson(invalid, "object")).toThrow();
    expect(() => canonicalizePublicationJson("[]", "object")).toThrow(
      /must be an object/u,
    );
    expect(() =>
      canonicalizePublicationJson(`${"[".repeat(66)}0${"]".repeat(66)}`),
    ).toThrow(/deeply nested/u);
    expect(() =>
      canonicalizePublicationJson(`{"x":"${"a".repeat(1_000_001)}"}`),
    ).toThrow(/byte limit/u);
    await expect(
      hashPublicationSearchDocumentContent({
        resourceType: "model",
        resourceId: `mdl_${UUID_A}`,
        documentId: VECTOR_A,
        normalizedName: "one",
        aliasesJson: '[ "alias"]',
        publisherName: "Publisher",
        providerModelIdsJson: "[]",
        documentText: "one",
      }),
    ).rejects.toThrow(/must be canonical/u);
  });

  it("projects exact persisted serving rows into the only accepted seal", async () => {
    const publicationId = `pub_${UUID_B}` as const;
    const modelId = `mdl_${UUID_A}`;
    const familyId = `fam_${UUID_A}`;
    const providerId = `prv_${UUID_A}`;
    const unavailableProviderId = `prv_${UUID_B}`;
    const vectorId = await derivePublicationVectorId(
      publicationId,
      "model",
      modelId,
    );
    const resources = await Promise.all(
      [
        {
          resourceType: "model" as const,
          resourceId: modelId,
          resourceJson: fixtureCanonicalJson(fixtureModel(modelId, familyId)),
        },
        {
          resourceType: "model_family" as const,
          resourceId: familyId,
          resourceJson: fixtureCanonicalJson(
            fixtureModelFamily(familyId, [modelId]),
          ),
        },
        {
          resourceType: "provider" as const,
          resourceId: providerId,
          resourceJson: '{"name":"Provider"}',
        },
      ].map(async (resource) => ({
        ...resource,
        contentHash: await hashPublicationResourceContent(resource),
      })),
    );
    const searchDocumentBase = {
      resourceType: "model" as const,
      resourceId: modelId,
      documentId: vectorId,
      normalizedName: "model",
      aliasesJson: "[]",
      publisherName: "Publisher",
      providerModelIdsJson: "[]",
      documentText: "model document",
    };
    const searchDocuments = [
      {
        ...searchDocumentBase,
        contentHash:
          await hashPublicationSearchDocumentContent(searchDocumentBase),
      },
    ];
    const vectors = [
      {
        resourceType: "model" as const,
        resourceId: modelId,
        vectorId,
        searchDocumentContentHash: searchDocuments[0]!.contentHash,
        embeddingInputHash: HASH_C,
      },
    ];
    const chunkDescriptors = [
      {
        kind: "resources" as const,
        ordinal: 0,
        firstKey: `model:${modelId}`,
        lastKey: `provider:${providerId}`,
        itemCount: 3,
        contentHash: await hashPublicationResourceChunk(resources),
      },
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
        contentHash: await hashPublicationVectorChunk(publicationId, vectors),
      },
    ];
    const providerSlices = [
      {
        providerId,
        providerSliceId: `prn_${UUID_A}`,
        providerRunId: `pvr_${UUID_A}`,
        adapterVersion: "adapter@1",
        rosterVersion: "roster@1",
        sourceRegisterVersion: "register@1",
        carriedForward: false,
        freshnessState: "fresh" as const,
      },
      {
        providerId: unavailableProviderId,
        providerSliceId: null,
        providerRunId: `pvr_${UUID_B}`,
        adapterVersion: "adapter@1",
        rosterVersion: "roster@1",
        sourceRegisterVersion: "register@1",
        carriedForward: false,
        freshnessState: "unavailable" as const,
      },
    ];
    const expected = await buildImmutableManifestFromPersistedContent({
      contractVersion: "1.0.0",
      publicationId,
      sourceRunId: `run_${UUID_A}`,
      parentPublicationId: null,
      generatedAt: "2026-08-01T11:00:00.000Z",
      versions: {
        schema: "1.0.0",
        methodology: "methodology@1",
        precisionNormalization: "precision@1",
        precisionDisplayOrder: "display@1",
        pricePolicy: "price@1",
        sourcePolicy: "source@1",
        embedding: "embedding@1",
        buildCommit: "git:abc123",
      },
      enabledProviderScopeVersion: "launch@1",
      enabledProviderIds: [providerId, unavailableProviderId],
      providerSlices,
      providerAttributions: [
        {
          resourceType: "provider",
          resourceId: providerId,
          providerId,
        },
      ],
      resources,
      searchDocuments,
      vectors,
      chunks: chunkDescriptors,
      bundleHash: HASH_C,
    });
    const database = applyServingV1Migrations();
    database
      .prepare(
        "INSERT INTO publication (publication_id, state, schema_version, methodology_version, precision_normalization_version, precision_display_order_version, price_policy_version, source_policy_version, embedding_version, build_commit, source_run_id, parent_publication_id, generated_at_ms, ready_at_ms, activated_at_ms, resource_count, exact_document_count, vector_document_count, exact_index_hash, vector_index_version, closure_hash, failure_codes_json, created_at_ms) VALUES (?, 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, 'vector@1', ?, '[]', ?)",
      )
      .run(
        publicationId,
        expected.versions.schema,
        expected.versions.methodology,
        expected.versions.precisionNormalization,
        expected.versions.precisionDisplayOrder,
        expected.versions.pricePolicy,
        expected.versions.sourcePolicy,
        expected.versions.embedding,
        expected.versions.buildCommit,
        expected.sourceRunId,
        Date.parse(expected.generatedAt),
        expected.resources.length,
        expected.searchDocuments.length,
        expected.vectors.length,
        HASH_A,
        expected.closureHash,
        Date.parse(expected.generatedAt),
      );
    for (const slice of providerSlices) {
      database
        .prepare(
          "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          slice.providerSliceId,
          publicationId,
          slice.providerId,
          slice.providerRunId,
          slice.carriedForward ? 1 : 0,
          slice.freshnessState,
        );
      database
        .prepare(
          "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          publicationId,
          slice.providerId,
          slice.adapterVersion,
          slice.rosterVersion,
          slice.sourceRegisterVersion,
        );
    }
    for (const resource of resources)
      database
        .prepare("INSERT INTO publication_resource VALUES (?, ?, ?, ?, ?)")
        .run(
          publicationId,
          resource.resourceType,
          resource.resourceId,
          resource.resourceJson,
          resource.contentHash,
        );
    database
      .prepare(
        "INSERT INTO publication_provider_attribution VALUES (?, ?, ?, ?)",
      )
      .run(publicationId, "provider", providerId, providerId);
    for (const document of searchDocuments)
      database
        .prepare(
          "INSERT INTO publication_search_document VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          publicationId,
          document.documentId,
          document.resourceType,
          document.resourceId,
          document.normalizedName,
          document.aliasesJson,
          document.publisherName,
          document.providerModelIdsJson,
          document.documentText,
          document.contentHash,
        );
    for (const vector of vectors)
      database
        .prepare(
          "INSERT INTO publication_vector_inventory VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          publicationId,
          publicationId,
          vector.vectorId,
          vector.resourceType,
          vector.resourceId,
          vector.searchDocumentContentHash,
          vector.embeddingInputHash,
        );
    for (const chunk of chunkDescriptors)
      database
        .prepare(
          "INSERT INTO publication_inventory_chunk VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          publicationId,
          chunk.kind,
          chunk.ordinal,
          chunk.firstKey,
          chunk.lastKey,
          chunk.itemCount,
          chunk.contentHash,
        );
    const rows: ServingClosureRows = {
      publication: database
        .prepare(
          "SELECT publication_id, source_run_id, parent_publication_id, generated_at_ms, schema_version, methodology_version, precision_normalization_version, precision_display_order_version, price_policy_version, source_policy_version, embedding_version, build_commit, closure_hash FROM publication WHERE publication_id = ?",
        )
        .get(publicationId) as unknown as ServingPublicationClosureRow,
      providerSlices: database
        .prepare(
          "SELECT disposition.provider_id, disposition.provider_slice_id, disposition.provider_run_id, metadata.adapter_version, metadata.roster_version, metadata.source_register_version, disposition.carried_forward, disposition.freshness_state FROM publication_provider_slice AS disposition JOIN publication_provider_slice_metadata AS metadata USING (publication_id, provider_id) WHERE disposition.publication_id = ? ORDER BY disposition.provider_id",
        )
        .all(publicationId) as unknown as ServingProviderSliceClosureRow[],
      providerAttributions: database
        .prepare(
          "SELECT resource_type, resource_id, provider_id FROM publication_provider_attribution WHERE publication_id = ? ORDER BY resource_type, resource_id",
        )
        .all(
          publicationId,
        ) as unknown as ServingProviderAttributionClosureRow[],
      resources: database
        .prepare(
          "SELECT resource_type, resource_id, resource_json, content_hash FROM publication_resource WHERE publication_id = ? ORDER BY resource_type, resource_id",
        )
        .all(publicationId) as unknown as ServingResourceClosureRow[],
      searchDocuments: database
        .prepare(
          "SELECT document_id, resource_type, resource_id, normalized_name, aliases_json, publisher_name, provider_model_ids_json, document_text, content_hash FROM publication_search_document WHERE publication_id = ? ORDER BY resource_type, resource_id",
        )
        .all(publicationId) as unknown as ServingSearchDocumentClosureRow[],
      vectors: database
        .prepare(
          "SELECT vector_namespace, vector_id, resource_type, resource_id, search_document_content_hash, embedding_input_hash FROM publication_vector_inventory WHERE publication_id = ? ORDER BY resource_type, resource_id",
        )
        .all(publicationId) as unknown as ServingVectorClosureRow[],
      chunks: database
        .prepare(
          "SELECT kind, ordinal, first_key, last_key, item_count, content_hash FROM publication_inventory_chunk WHERE publication_id = ? ORDER BY kind, ordinal",
        )
        .all(publicationId) as unknown as ServingChunkClosureRow[],
      manifestContractVersion: "1.0.0",
      enabledProviderScopeVersion: "launch@1",
      bundleHash: HASH_C,
      stagingRevision: (
        database
          .prepare(
            "SELECT revision FROM publication_staging_revision WHERE publication_id = ?",
          )
          .get(publicationId) as unknown as { revision: number }
      ).revision,
      sealedAtMs: Date.parse(NOW),
    };
    const projected = await projectServingClosureSeal(rows);
    expect(projected.manifest).toEqual(expected);
    await expect(
      verifyServingClosureSealProjection(rows, projected.seal),
    ).resolves.toEqual([]);
    await expect(
      verifyServingClosureSealProjection(rows, {
        ...projected.seal,
        vector_inventory_hash: HASH_A,
      }),
    ).resolves.toContain(
      "vector_inventory_hash does not match persisted closure",
    );
    await expect(
      projectServingClosureSeal({
        ...rows,
        chunks: rows.chunks.map((chunk, index) =>
          index === 0 ? { ...chunk, content_hash: HASH_A } : chunk,
        ),
      }),
    ).rejects.toThrow(/chunk content hash does not match/u);
    const seal = projected.seal;
    const sealParameters = [
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
    ] as const;
    database.exec("SAVEPOINT staging_race");
    database
      .prepare(
        "INSERT INTO publication_inventory_chunk VALUES (?, 'resources', 1, 'z', 'z', 1, ?)",
      )
      .run(publicationId, HASH_A);
    expect(() =>
      database
        .prepare(
          "INSERT INTO publication_closure_seal VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(...sealParameters),
    ).toThrow(/staging revision changed/u);
    database.exec("ROLLBACK TO staging_race");
    database.exec("RELEASE staging_race");
    database
      .prepare(
        "INSERT INTO publication_closure_seal VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(...sealParameters);
    expect(
      database
        .prepare(
          "SELECT closure_hash, vector_inventory_hash, chunk_root_hash FROM publication_closure_seal WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({
      closure_hash: expected.closureHash,
      vector_inventory_hash: expected.vectorInventoryHash,
      chunk_root_hash: expected.chunkRootHash,
    });
    expect(() =>
      database
        .prepare(
          "UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = ?",
        )
        .run(publicationId),
    ).toThrow(/trigger-managed/u);
    expect(() =>
      database
        .prepare(
          "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
        )
        .run(publicationId, `mdl_${UUID_C}`, HASH_A),
    ).toThrow(/sealed publication closure is immutable/u);
    expect(() =>
      database
        .prepare(
          "UPDATE publication SET state = 'ready', ready_at_ms = ? WHERE publication_id = ?",
        )
        .run(Date.parse(NOW), publicationId),
    ).toThrow(/readiness lacks its exact attestation/u);
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_search_fts WHERE publication_search_fts MATCH 'model' AND publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ count: 1 });

    const observationTimes = [
      "2026-08-01T12:01:00.000Z",
      "2026-08-01T12:02:00.000Z",
      "2026-08-01T12:03:00.000Z",
      "2026-08-01T12:04:00.000Z",
    ] as const;
    const readinessEvidence: ReadinessReceipt[] = receipts(expected).map(
      (receipt, index) => ({
        ...receipt,
        binding: { ...receipt.binding, environment: "local" },
        observedAt: observationTimes[index]!,
      }),
    );
    const projectedReceiptRows =
      await projectServingReadinessReceiptRows(readinessEvidence);
    expect(
      [...projectedReceiptRows.bindings]
        .sort((left, right) => left.kind.localeCompare(right.kind))
        .map((row) => row.receipt_hash),
    ).toEqual([
      "sha256:a21fe3530149aeee216a5b9687fdb961cfb78e38c44a559fab7d2ecfb0d230fe",
      "sha256:da2de742b662ff31a217581016b0a87e61c216269d3d60812e8607940cd731b1",
      "sha256:3198a79f41507bfc16e6acdc3f7d890f973c5b8b373b6f2f44896179d29fe486",
      "sha256:3ff8e64425bda1d3c468eb5dccfb415492a64d895bc145cc2c262582571e7c04",
    ]);
    await expect(
      readServingReadinessReceipts({
        ...projectedReceiptRows,
        bindings: projectedReceiptRows.bindings.map((row, index) =>
          index === 0 ? { ...row, receipt_hash: HASH_A } : row,
        ),
      }),
    ).rejects.toThrow(/receipt hash does not match/u);
    const readyAtMs = Date.parse("2026-08-01T12:05:00.000Z");
    const readinessMaximumAgeMs = 10 * 365 * 24 * 60 * 60 * 1000;
    const preSealReceiptRows = await projectServingReadinessReceiptRows(
      readinessEvidence.map((receipt) =>
        receipt.kind === "archive"
          ? { ...receipt, observedAt: "2026-08-01T11:59:59.999Z" }
          : receipt,
      ),
    );
    await expect(
      projectServingReadinessAttestation({
        closureRows: rows,
        persistedSeal: seal,
        receiptRows: preSealReceiptRows,
        environment: "local",
        readyAtMs,
        maximumReceiptAgeMs: readinessMaximumAgeMs,
      }),
    ).rejects.toThrow(/observation predates closure seal/u);
    const attestationDecision = await projectServingReadinessAttestation({
      closureRows: rows,
      persistedSeal: seal,
      receiptRows: projectedReceiptRows,
      environment: "local" as const,
      readyAtMs,
      maximumReceiptAgeMs: readinessMaximumAgeMs,
    });
    expect(attestationDecision.decision).toBe("ready");
    if (attestationDecision.decision !== "ready")
      throw new Error("expected a ready attestation projection");
    expect(attestationDecision.attestation.attestation_hash).toBe(
      "sha256:4a7a3664590fa5bf53b99ab24b34088cb4a3c8a929313d20d8a2ffe4d73a97f0",
    );
    await expect(
      verifyServingReadinessAttestationProjection(
        {
          closureRows: rows,
          persistedSeal: seal,
          receiptRows: projectedReceiptRows,
          environment: "local",
          readyAtMs,
          maximumReceiptAgeMs: readinessMaximumAgeMs,
        },
        {
          ...attestationDecision.attestation,
          attestation_hash: HASH_A,
        },
      ),
    ).resolves.toContain(
      "attestation_hash does not match persisted readiness evidence",
    );
    await expect(
      projectServingReadinessAttestation({
        closureRows: rows,
        persistedSeal: seal,
        receiptRows: projectedReceiptRows,
        environment: "test" as unknown as "local",
        readyAtMs,
        maximumReceiptAgeMs: readinessMaximumAgeMs,
      }),
    ).rejects.toThrow(/serving readiness environment is invalid/u);

    const mutableCommitInput = structuredClone({
      closureRows: rows,
      persistedSeal: seal,
      receiptRows: projectedReceiptRows,
      environment: "local" as const,
      readyAtMs,
      maximumReceiptAgeMs: readinessMaximumAgeMs,
    });
    const commitPromise = projectServingReadinessCommit(mutableCommitInput);
    Reflect.set(
      mutableCommitInput.receiptRows.bindings[0]!,
      "receipt_hash",
      HASH_A,
    );
    Reflect.set(
      mutableCommitInput.closureRows.publication,
      "closure_hash",
      HASH_A,
    );
    const commitDecision = await commitPromise;
    if (commitDecision.decision !== "ready")
      throw new Error("readiness commit was unexpectedly blocked");
    const commitProjection = commitDecision.projection;
    expect(() => {
      assertServingReadinessCommitProjection(commitProjection);
    }).not.toThrow();
    expect(() => {
      assertServingReadinessCommitProjection(
        JSON.parse(JSON.stringify(commitProjection)),
      );
    }).toThrow(/not trusted/u);
    const reflectedCommitForgery = JSON.parse(
      JSON.stringify(commitProjection),
    ) as object;
    for (const symbol of Object.getOwnPropertySymbols(commitProjection))
      Object.defineProperty(
        reflectedCommitForgery,
        symbol,
        Object.getOwnPropertyDescriptor(commitProjection, symbol)!,
      );
    expect(() => {
      assertServingReadinessCommitProjection(reflectedCommitForgery);
    }).toThrow(/not trusted/u);
    expect(
      commitProjection.receiptRows.bindings.find(
        (row) => row.kind === "archive",
      )?.receipt_hash,
    ).toBe(
      projectedReceiptRows.bindings.find((row) => row.kind === "archive")
        ?.receipt_hash,
    );
    expect(commitProjection.attestation).toEqual(
      attestationDecision.attestation,
    );
    Reflect.set(
      mutableCommitInput.receiptRows.bindings[1]!,
      "receipt_hash",
      HASH_B,
    );
    expect(
      commitProjection.receiptRows.bindings.find(
        (row) => row.kind === "serving",
      )?.receipt_hash,
    ).toBe(
      projectedReceiptRows.bindings.find((row) => row.kind === "serving")
        ?.receipt_hash,
    );
    const emptyReceiptRows: ServingReadinessReceiptRows = {
      bindings: [],
      archives: [],
      servings: [],
      vectors: [],
      probes: [],
    };
    expect(
      classifyServingReadinessCommitRetry({
        expected: commitProjection,
        publicationState: "building",
        publicationReadyAtMs: null,
        publicationClosureHash: expected.closureHash,
        receiptRows: emptyReceiptRows,
        attestation: null,
      }),
    ).toEqual({ outcome: "execute" });
    expect(
      classifyServingReadinessCommitRetry({
        expected: commitProjection,
        publicationState: "ready",
        publicationReadyAtMs: readyAtMs,
        publicationClosureHash: expected.closureHash,
        receiptRows: commitProjection.receiptRows,
        attestation: commitProjection.attestation,
      }),
    ).toEqual({ outcome: "idempotent_success" });
    for (const publicationState of [
      "active",
      "superseded",
      "rolled_back",
    ] as const)
      expect(
        classifyServingReadinessCommitRetry({
          expected: commitProjection,
          publicationState,
          publicationReadyAtMs: readyAtMs,
          publicationClosureHash: expected.closureHash,
          receiptRows: commitProjection.receiptRows,
          attestation: commitProjection.attestation,
        }),
      ).toEqual({ outcome: "idempotent_success" });
    for (const publicationState of ["building", "failed"] as const)
      expect(
        classifyServingReadinessCommitRetry({
          expected: commitProjection,
          publicationState,
          publicationReadyAtMs: readyAtMs,
          publicationClosureHash: expected.closureHash,
          receiptRows: commitProjection.receiptRows,
          attestation: commitProjection.attestation,
        }),
      ).toEqual({ outcome: "integrity_failure" });
    expect(
      classifyServingReadinessCommitRetry({
        expected: commitProjection,
        publicationState: "building",
        publicationReadyAtMs: null,
        publicationClosureHash: expected.closureHash,
        receiptRows: {
          ...emptyReceiptRows,
          bindings: [commitProjection.receiptRows.bindings[0]!],
        },
        attestation: null,
      }),
    ).toEqual({ outcome: "integrity_failure" });
    expect(
      classifyServingReadinessCommitRetry({
        expected: commitProjection,
        publicationState: "building",
        publicationReadyAtMs: null,
        publicationClosureHash: expected.closureHash,
        receiptRows: {
          ...commitProjection.receiptRows,
          bindings: commitProjection.receiptRows.bindings.map((row, index) =>
            index === 0 ? { ...row, receipt_hash: HASH_A } : row,
          ),
        },
        attestation: null,
      }),
    ).toEqual({ outcome: "conflict" });
    expect(
      classifyServingReadinessCommitRetry({
        expected: commitProjection,
        publicationState: "failed",
        publicationReadyAtMs: null,
        publicationClosureHash: expected.closureHash,
        receiptRows: emptyReceiptRows,
        attestation: null,
      }),
    ).toEqual({ outcome: "stale" });
    for (const publicationState of ["ready", "active"] as const)
      expect(
        classifyServingReadinessCommitRetry({
          expected: commitProjection,
          publicationState,
          publicationReadyAtMs: readyAtMs,
          publicationClosureHash: expected.closureHash,
          receiptRows: emptyReceiptRows,
          attestation: null,
        }),
      ).toEqual({ outcome: "integrity_failure" });

    database.exec("BEGIN IMMEDIATE");
    try {
      insertReadinessReceiptRows(database, projectedReceiptRows);
      const firstSearchDocument = expected.searchDocuments[0];
      if (firstSearchDocument === undefined)
        throw new Error("expected a searchable document");
      database
        .prepare(
          "DELETE FROM publication_search_fts WHERE publication_id = ? AND document_id = ?",
        )
        .run(publicationId, firstSearchDocument.documentId);
      expect(() => {
        insertReadinessAttestation(database, attestationDecision.attestation);
      }).toThrow(/exact search FTS does not match/u);
    } finally {
      database.exec("ROLLBACK");
    }
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_readiness_receipt WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ count: 0 });

    database.exec("BEGIN IMMEDIATE");
    try {
      insertReadinessReceiptRows(database, projectedReceiptRows);
      const persistedRows = selectReadinessReceiptRows(database, publicationId);
      await expect(
        readServingReadinessReceipts(persistedRows),
      ).resolves.toEqual(expect.arrayContaining(readinessEvidence));
      const persistedDecision = await projectServingReadinessAttestation({
        closureRows: rows,
        persistedSeal: seal,
        receiptRows: persistedRows,
        environment: "local",
        readyAtMs,
        maximumReceiptAgeMs: readinessMaximumAgeMs,
      });
      if (persistedDecision.decision !== "ready")
        throw new Error(
          "persisted readiness evidence was unexpectedly blocked",
        );
      expect(persistedDecision.attestation).toEqual(
        attestationDecision.attestation,
      );
      insertReadinessAttestation(database, persistedDecision.attestation);
      database
        .prepare(
          "UPDATE publication SET state = 'ready', ready_at_ms = ? WHERE publication_id = ?",
        )
        .run(readyAtMs, publicationId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    const persistedAttestation = database
      .prepare(
        "SELECT publication_id, environment, closure_hash, bundle_hash, evaluator_version, ready_at_ms, maximum_receipt_age_ms, effective_valid_until_ms, archive_observed_at_ms, serving_observed_at_ms, vector_observed_at_ms, probes_observed_at_ms, archive_receipt_hash, serving_receipt_hash, vector_receipt_hash, probes_receipt_hash, attestation_hash FROM publication_readiness_attestation WHERE publication_id = ?",
      )
      .get(publicationId) as unknown as ServingReadinessAttestationProjection;
    await expect(
      verifyServingReadinessAttestationProjection(
        {
          closureRows: rows,
          persistedSeal: seal,
          receiptRows: selectReadinessReceiptRows(database, publicationId),
          environment: "local",
          readyAtMs,
          maximumReceiptAgeMs: readinessMaximumAgeMs,
        },
        persistedAttestation,
      ),
    ).resolves.toEqual([]);
    expect(
      database
        .prepare(
          "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ state: "ready", ready_at_ms: readyAtMs });
    expect(() =>
      database
        .prepare(
          "UPDATE publication_readiness_receipt SET receipt_hash = ? WHERE publication_id = ? AND kind = 'archive'",
        )
        .run(HASH_A, publicationId),
    ).toThrow(/readiness receipt is immutable/u);

    const mutableArtifactProof = {
      environment: "local" as const,
      observedAtMs: Date.parse("2026-08-01T12:05:30.000Z"),
      maximumAgeMs: 5 * 60 * 1000,
      ftsBuildVersion: "fts5-unicode61@1",
      ftsSourceDocumentCount: expected.searchDocuments.length,
      ftsIndexDocumentCount: expected.searchDocuments.length,
      ftsSourceInventoryHash: expected.exactSearchInventoryHash,
      ftsExactParity: true,
      archiveBundleHash: expected.bundleHash,
      archiveImmutable: true,
      vectorNamespace: publicationId,
      vectorDocumentCount: expected.vectors.length,
      vectorVerifiedDocumentCount: expected.vectors.length,
      vectorInventoryHash: expected.vectorInventoryHash,
      vectorVisibilityProbeVersion: "vector-visibility@1",
      vectorMutationId: "mutation-switch-1",
      vectorAllIdsPresent: true,
      vectorAllNamespacesMatch: true,
      vectorQueryable: true,
      probeSetVersion: "search-gold@1",
      integrityPassed: true,
      exactSearchPassed: true,
      semanticSearchPassed: true,
      structuredFilterPassed: true,
      neutralityPassed: true,
      versionIsolationPassed: true,
    };
    const switchProjectionPromise = projectServingSwitch({
      action: "activate",
      target: {
        publicationId,
        closureHash: expected.closureHash,
        state: "ready",
        generatedAt: expected.generatedAt,
        readyAt: new Date(readyAtMs).toISOString(),
        firstActivatedAt: null,
        lastHeadReferencedAt: null,
      },
      currentHead: null,
      currentActive: null,
      switchedAt: "2026-08-01T12:06:00.000Z",
      authorizedBy: AUTHORIZATION,
      closureRows: rows,
      persistedSeal: seal,
      receiptRows: selectReadinessReceiptRows(database, publicationId),
      persistedAttestation,
      artifactProof: mutableArtifactProof,
    });
    mutableArtifactProof.maximumAgeMs = 0;
    mutableArtifactProof.vectorMutationId = "mutated-during-digest";
    const switchProjection = await switchProjectionPromise;
    expect(switchProjection.preflight).toMatchObject({
      maximum_age_ms: 5 * 60 * 1000,
      vector_mutation_id: "mutation-switch-1",
    });
    expect(() => {
      assertServingSwitchProjection(switchProjection);
    }).not.toThrow();
    const serializedProjection: unknown = JSON.parse(
      JSON.stringify(switchProjection),
    );
    expect(serializedProjection).toEqual({
      plan: switchProjection.plan,
      preflight: switchProjection.preflight,
      history: switchProjection.history,
    });
    expect(() => {
      assertServingSwitchProjection(serializedProjection);
    }).toThrow(/not trusted/u);
    if (
      typeof serializedProjection !== "object" ||
      serializedProjection === null
    )
      throw new TypeError("serialized projection is not an object");
    const reflectedForgery = { ...serializedProjection };
    for (const symbol of Object.getOwnPropertySymbols(switchProjection))
      Object.defineProperty(
        reflectedForgery,
        symbol,
        Object.getOwnPropertyDescriptor(switchProjection, symbol)!,
      );
    expect(() => {
      assertServingSwitchProjection(reflectedForgery);
    }).toThrow(/not trusted/u);
    expect(switchProjection.plan.operation).toBe("activate");
    expect(switchProjection.preflight).toMatchObject({
      action: "activate",
      expected_prior_generation: 0,
      new_generation: 1,
      from_publication_id: null,
      to_publication_id: publicationId,
      to_attestation_hash: persistedAttestation.attestation_hash,
    });
    expect(switchProjection.history).toMatchObject({
      action: "activate",
      expected_prior_generation: 0,
      new_generation: 1,
      resulting_rollback_candidate_publication_id: null,
      authorized_by_kind: "pipeline",
      authorized_identity_id: AUTHORIZATION.identityId,
    });
    expect(switchProjection.preflight.preflight_hash).toBe(
      "sha256:eeb8dd544cef17aa24a7aecaf084a635177142cfea779b5eea2667dcb6476012",
    );
    expect(switchProjection.history.event_hash).toBe(
      "sha256:fb9e09467a120f92f346e77121889285423beccc3996231ae18f2d36eee47164",
    );
    const switchedHead: StoredPublicationHead = {
      activePublicationId: publicationId,
      rollbackCandidatePublicationId: null,
      switchedAt: "2026-08-01T12:06:00.000Z",
      generation: 1,
    };
    expect(
      classifyServingSwitchRetry({
        expected: switchProjection,
        currentHead: null,
        preflightAtGeneration: null,
        historyAtGeneration: null,
        targetState: "ready",
        formerState: null,
      }),
    ).toEqual({ outcome: "execute" });
    for (const targetState of ["active", "failed"] as const)
      expect(
        classifyServingSwitchRetry({
          expected: switchProjection,
          currentHead: null,
          preflightAtGeneration: null,
          historyAtGeneration: null,
          targetState,
          formerState: null,
        }),
      ).toEqual({ outcome: "integrity_failure" });
    expect(
      classifyServingSwitchRetry({
        expected: switchProjection,
        currentHead: null,
        preflightAtGeneration: null,
        historyAtGeneration: null,
        targetState: "ready",
        formerState: "active",
      }),
    ).toEqual({ outcome: "integrity_failure" });
    expect(
      classifyServingSwitchRetry({
        expected: switchProjection,
        currentHead: switchedHead,
        preflightAtGeneration: null,
        historyAtGeneration: null,
        targetState: "active",
        formerState: null,
      }),
    ).toEqual({ outcome: "stale" });
    expect(
      classifyServingSwitchRetry({
        expected: switchProjection,
        currentHead: null,
        preflightAtGeneration: switchProjection.preflight,
        historyAtGeneration: null,
        targetState: "ready",
        formerState: null,
      }),
    ).toEqual({ outcome: "integrity_failure" });
    for (const preflightAtGeneration of [
      {
        ...switchProjection.preflight,
        preflight_hash: HASH_A,
      },
      {
        ...switchProjection.preflight,
        switch_id: "publication-switch|activate|1|competing",
      },
    ])
      expect(
        classifyServingSwitchRetry({
          expected: switchProjection,
          currentHead: null,
          preflightAtGeneration,
          historyAtGeneration: null,
          targetState: "ready",
          formerState: null,
        }),
      ).toEqual({ outcome: "conflict" });
    expect(
      classifyServingSwitchRetry({
        expected: switchProjection,
        currentHead: switchedHead,
        preflightAtGeneration: switchProjection.preflight,
        historyAtGeneration: switchProjection.history,
        targetState: "active",
        formerState: null,
      }),
    ).toEqual({ outcome: "idempotent_success" });
    expect(
      classifyServingSwitchRetry({
        expected: switchProjection,
        currentHead: switchedHead,
        preflightAtGeneration: switchProjection.preflight,
        historyAtGeneration: {
          ...switchProjection.history,
          event_hash: HASH_A,
        },
        targetState: "active",
        formerState: null,
      }),
    ).toEqual({ outcome: "conflict" });
    expect(
      classifyServingSwitchRetry({
        expected: switchProjection,
        currentHead: null,
        preflightAtGeneration: switchProjection.preflight,
        historyAtGeneration: switchProjection.history,
        targetState: "active",
        formerState: null,
      }),
    ).toEqual({ outcome: "integrity_failure" });
    expect(
      classifyServingSwitchRetry({
        expected: switchProjection,
        currentHead: switchedHead,
        preflightAtGeneration: null,
        historyAtGeneration: switchProjection.history,
        targetState: "active",
        formerState: null,
      }),
    ).toEqual({ outcome: "integrity_failure" });
    expect(
      classifyServingSwitchRetry({
        expected: switchProjection,
        currentHead: switchedHead,
        preflightAtGeneration: {
          ...switchProjection.preflight,
          preflight_hash: HASH_A,
        },
        historyAtGeneration: switchProjection.history,
        targetState: "active",
        formerState: null,
      }),
    ).toEqual({ outcome: "conflict" });
    const mutableRollbackHead = {
      activePublicationId: `pub_${UUID_C}` as const,
      rollbackCandidatePublicationId: publicationId,
      switchedAt: "2026-08-01T12:06:30.000Z",
      generation: 1,
    };
    const rollbackProjectionPromise = projectServingSwitch({
      action: "rollback",
      target: {
        publicationId,
        closureHash: expected.closureHash,
        state: "superseded",
        generatedAt: expected.generatedAt,
        readyAt: new Date(readyAtMs).toISOString(),
        firstActivatedAt: "2026-08-01T12:06:00.000Z",
        lastHeadReferencedAt: "2026-08-01T12:06:30.000Z",
      },
      currentHead: mutableRollbackHead,
      currentActive: {
        publicationId: `pub_${UUID_C}`,
        closureHash: HASH_A,
        state: "active",
        generatedAt: "2026-08-01T10:00:00.000Z",
        readyAt: "2026-08-01T10:30:00.000Z",
        firstActivatedAt: "2026-08-01T11:00:00.000Z",
        lastHeadReferencedAt: "2026-08-01T12:06:30.000Z",
      },
      switchedAt: "2026-08-01T12:07:00.000Z",
      authorizedBy: { kind: "operator", identityId: "operator.release" },
      closureRows: rows,
      persistedSeal: seal,
      receiptRows: null,
      persistedAttestation: null,
      artifactProof: {
        environment: "local",
        observedAtMs: Date.parse("2026-08-01T12:06:45.000Z"),
        maximumAgeMs: 60 * 1000,
        ftsBuildVersion: "fts5-unicode61@1",
        ftsSourceDocumentCount: expected.searchDocuments.length,
        ftsIndexDocumentCount: expected.searchDocuments.length,
        ftsSourceInventoryHash: expected.exactSearchInventoryHash,
        ftsExactParity: true,
        archiveBundleHash: expected.bundleHash,
        archiveImmutable: true,
        vectorNamespace: publicationId,
        vectorDocumentCount: expected.vectors.length,
        vectorVerifiedDocumentCount: expected.vectors.length,
        vectorInventoryHash: expected.vectorInventoryHash,
        vectorVisibilityProbeVersion: "vector-visibility@1",
        vectorMutationId: "mutation-rollback-1",
        vectorAllIdsPresent: true,
        vectorAllNamespacesMatch: true,
        vectorQueryable: true,
        probeSetVersion: "search-gold@1",
        integrityPassed: true,
        exactSearchPassed: true,
        semanticSearchPassed: true,
        structuredFilterPassed: true,
        neutralityPassed: true,
        versionIsolationPassed: true,
      },
    });
    mutableRollbackHead.generation = 99;
    mutableRollbackHead.switchedAt = "2026-08-01T12:06:59.000Z";
    const rollbackProjection = await rollbackProjectionPromise;
    mutableRollbackHead.generation = 100;
    const rollbackCas = rollbackProjection.plan.steps.find(
      (step) => step.kind === "compare_and_swap_head",
    );
    expect(rollbackCas?.expected).toEqual({
      activePublicationId: `pub_${UUID_C}`,
      rollbackCandidatePublicationId: publicationId,
      switchedAt: "2026-08-01T12:06:30.000Z",
      generation: 1,
    });
    expect(Object.isFrozen(rollbackCas?.expected)).toBe(true);
    expect(() => {
      Object.assign(rollbackCas?.expected ?? {}, { generation: 2 });
    }).toThrow(TypeError);
    expect(rollbackProjection.preflight).toMatchObject({
      action: "rollback",
      expected_prior_generation: 1,
      new_generation: 2,
      from_publication_id: `pub_${UUID_C}`,
      to_publication_id: publicationId,
      to_attestation_hash: null,
    });
    expect(rollbackProjection.history).toMatchObject({
      action: "rollback",
      resulting_rollback_candidate_publication_id: `pub_${UUID_C}`,
      authorized_by_kind: "operator",
    });
    const rollbackHead: StoredPublicationHead = {
      activePublicationId: `pub_${UUID_C}`,
      rollbackCandidatePublicationId: publicationId,
      switchedAt: "2026-08-01T12:06:30.000Z",
      generation: 1,
    };
    expect(
      classifyServingSwitchRetry({
        expected: rollbackProjection,
        currentHead: rollbackHead,
        preflightAtGeneration: null,
        historyAtGeneration: null,
        targetState: "superseded",
        formerState: "active",
      }),
    ).toEqual({ outcome: "execute" });
    expect(
      classifyServingSwitchRetry({
        expected: rollbackProjection,
        currentHead: rollbackHead,
        preflightAtGeneration: null,
        historyAtGeneration: null,
        targetState: "rolled_back",
        formerState: "active",
      }),
    ).toEqual({ outcome: "integrity_failure" });
    expect(
      classifyServingSwitchRetry({
        expected: rollbackProjection,
        currentHead: rollbackHead,
        preflightAtGeneration: null,
        historyAtGeneration: null,
        targetState: "superseded",
        formerState: "superseded",
      }),
    ).toEqual({ outcome: "integrity_failure" });
    await expect(
      projectServingSwitch({
        action: "rollback",
        target: {
          publicationId,
          closureHash: expected.closureHash,
          state: "superseded",
          generatedAt: expected.generatedAt,
          readyAt: new Date(readyAtMs).toISOString(),
          firstActivatedAt: "2026-08-01T12:06:00.000Z",
          lastHeadReferencedAt: "2026-08-01T12:06:30.000Z",
        },
        currentHead: {
          activePublicationId: `pub_${UUID_C}`,
          rollbackCandidatePublicationId: publicationId,
          switchedAt: "2026-08-01T12:06:30.000Z",
          generation: 1,
        },
        currentActive: {
          publicationId: `pub_${UUID_C}`,
          closureHash: HASH_A,
          state: "active",
          generatedAt: "2026-08-01T10:00:00.000Z",
          readyAt: "2026-08-01T10:30:00.000Z",
          firstActivatedAt: "2026-08-01T11:00:00.000Z",
          lastHeadReferencedAt: "2026-08-01T12:06:30.000Z",
        },
        switchedAt: "2026-08-01T12:07:00.000Z",
        authorizedBy: { kind: "operator", identityId: "operator.release" },
        closureRows: rows,
        persistedSeal: seal,
        receiptRows: null,
        persistedAttestation: null,
        artifactProof: {
          environment: "local",
          observedAtMs: Date.parse("2026-08-01T12:06:45.000Z"),
          maximumAgeMs: 60 * 1000,
          ftsBuildVersion: "fts5-unicode61@1",
          ftsSourceDocumentCount: expected.searchDocuments.length,
          ftsIndexDocumentCount: expected.searchDocuments.length,
          ftsSourceInventoryHash: expected.exactSearchInventoryHash,
          ftsExactParity: true,
          archiveBundleHash: expected.bundleHash,
          archiveImmutable: true,
          vectorNamespace: publicationId,
          vectorDocumentCount: expected.vectors.length,
          vectorVerifiedDocumentCount: expected.vectors.length - 1,
          vectorInventoryHash: expected.vectorInventoryHash,
          vectorVisibilityProbeVersion: "vector-visibility@1",
          vectorMutationId: "mutation-rollback-1",
          vectorAllIdsPresent: true,
          vectorAllNamespacesMatch: true,
          vectorQueryable: true,
          probeSetVersion: "search-gold@1",
          integrityPassed: true,
          exactSearchPassed: true,
          semanticSearchPassed: true,
          structuredFilterPassed: true,
          neutralityPassed: true,
          versionIsolationPassed: true,
        },
      }),
    ).rejects.toThrow(/does not prove/u);
    await expect(
      projectServingSwitch({
        action: "activate",
        target: {
          publicationId,
          closureHash: expected.closureHash,
          state: "ready",
          generatedAt: expected.generatedAt,
          readyAt: new Date(readyAtMs).toISOString(),
          firstActivatedAt: null,
          lastHeadReferencedAt: null,
        },
        currentHead: null,
        currentActive: null,
        switchedAt: "2026-08-01T12:06:00.000Z",
        authorizedBy: AUTHORIZATION,
        closureRows: rows,
        persistedSeal: seal,
        receiptRows: selectReadinessReceiptRows(database, publicationId),
        persistedAttestation: {
          ...persistedAttestation,
          attestation_hash: HASH_A,
        },
        artifactProof: {
          ...switchProjection.preflight,
          environment: "local",
          observedAtMs: Date.parse("2026-08-01T12:05:30.000Z"),
          maximumAgeMs: 5 * 60 * 1000,
          ftsBuildVersion: "fts5-unicode61@1",
          ftsSourceDocumentCount: expected.searchDocuments.length,
          ftsIndexDocumentCount: expected.searchDocuments.length,
          ftsSourceInventoryHash: expected.exactSearchInventoryHash,
          ftsExactParity: true,
          archiveBundleHash: expected.bundleHash,
          archiveImmutable: true,
          vectorNamespace: publicationId,
          vectorDocumentCount: expected.vectors.length,
          vectorVerifiedDocumentCount: expected.vectors.length,
          vectorInventoryHash: expected.vectorInventoryHash,
          vectorVisibilityProbeVersion: "vector-visibility@1",
          vectorMutationId: "mutation-switch-1",
          vectorAllIdsPresent: true,
          vectorAllNamespacesMatch: true,
          vectorQueryable: true,
          probeSetVersion: "search-gold@1",
          integrityPassed: true,
          exactSearchPassed: true,
          semanticSearchPassed: true,
          structuredFilterPassed: true,
          neutralityPassed: true,
          versionIsolationPassed: true,
        },
      }),
    ).rejects.toThrow(/attestation is invalid/u);

    const databaseClockMs = Math.floor(Date.now() / 1_000) * 1_000;
    const persistedSwitch = await projectServingSwitch({
      action: "activate",
      target: {
        publicationId,
        closureHash: expected.closureHash,
        state: "ready",
        generatedAt: expected.generatedAt,
        readyAt: new Date(readyAtMs).toISOString(),
        firstActivatedAt: null,
        lastHeadReferencedAt: null,
      },
      currentHead: null,
      currentActive: null,
      switchedAt: new Date(databaseClockMs + 1_000).toISOString(),
      authorizedBy: AUTHORIZATION,
      closureRows: rows,
      persistedSeal: seal,
      receiptRows: selectReadinessReceiptRows(database, publicationId),
      persistedAttestation,
      artifactProof: {
        environment: "local",
        observedAtMs: databaseClockMs,
        maximumAgeMs: 60 * 1000,
        ftsBuildVersion: "fts5-unicode61@1",
        ftsSourceDocumentCount: expected.searchDocuments.length,
        ftsIndexDocumentCount: expected.searchDocuments.length,
        ftsSourceInventoryHash: expected.exactSearchInventoryHash,
        ftsExactParity: true,
        archiveBundleHash: expected.bundleHash,
        archiveImmutable: true,
        vectorNamespace: publicationId,
        vectorDocumentCount: expected.vectors.length,
        vectorVerifiedDocumentCount: expected.vectors.length,
        vectorInventoryHash: expected.vectorInventoryHash,
        vectorVisibilityProbeVersion: "vector-visibility@1",
        vectorMutationId: "mutation-persisted-switch-1",
        vectorAllIdsPresent: true,
        vectorAllNamespacesMatch: true,
        vectorQueryable: true,
        probeSetVersion: "search-gold@1",
        integrityPassed: true,
        exactSearchPassed: true,
        semanticSearchPassed: true,
        structuredFilterPassed: true,
        neutralityPassed: true,
        versionIsolationPassed: true,
      },
    });
    database.exec("BEGIN IMMEDIATE");
    try {
      insertServingSwitch(
        database,
        persistedSwitch.preflight,
        persistedSwitch.history,
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    expect(
      database
        .prepare(
          "SELECT active_publication_id, rollback_candidate_publication_id, switched_at_ms, generation FROM publication_head",
        )
        .get(),
    ).toEqual({
      active_publication_id: publicationId,
      rollback_candidate_publication_id: null,
      switched_at_ms: databaseClockMs + 1_000,
      generation: 1,
    });
    expect(
      database
        .prepare(
          "SELECT state, ready_at_ms, activated_at_ms FROM publication WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({
      state: "active",
      ready_at_ms: readyAtMs,
      activated_at_ms: databaseClockMs + 1_000,
    });
    expect(
      database
        .prepare(
          "SELECT event_hash, preflight_hash, new_generation FROM publication_switch_history WHERE switch_id = ?",
        )
        .get(persistedSwitch.history.switch_id),
    ).toEqual({
      event_hash: persistedSwitch.history.event_hash,
      preflight_hash: persistedSwitch.preflight.preflight_hash,
      new_generation: 1,
    });
  });

  it("hashes all policy versions and inventories with deterministic ordering", async () => {
    const input = manifestInput();
    const first = await buildImmutableManifest(input);
    const permuted = await buildImmutableManifest({
      ...input,
      providerSlices: [...input.providerSlices].reverse(),
      enabledProviderIds: [...input.enabledProviderIds].reverse(),
      providerAttributions: [...input.providerAttributions].reverse(),
      resources: [...input.resources].reverse(),
      searchDocuments: [...input.searchDocuments].reverse(),
      vectors: [...input.vectors].reverse(),
      chunks: [...input.chunks].reverse(),
    });
    expect(first.closureHash).toBe(permuted.closureHash);
    expect(first.resources.map((value) => value.resourceType)).toEqual([
      "model",
      "provider",
      "variant",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.resources)).toBe(true);

    const changed = await buildImmutableManifest({
      ...input,
      versions: { ...input.versions, methodology: "methodology@2" },
    });
    expect(changed.closureHash).not.toBe(first.closureHash);
    const changedSlice = await buildImmutableManifest({
      ...input,
      providerSlices: input.providerSlices.map((slice, index) =>
        index === 0 ? { ...slice, providerSliceId: `prn_${UUID_C}` } : slice,
      ),
    });
    expect(changedSlice.closureHash).not.toBe(first.closureHash);
  });

  it("detects altered derived hashes instead of trusting manifest claims", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    expect(await verifyImmutableManifest(manifest)).toEqual([]);
    expect(
      await verifyImmutableManifest({
        ...manifest,
        vectorInventoryHash: HASH_C,
      }),
    ).toContain("vectorInventoryHash does not match immutable content");
  });

  it("requires exact search and vector inventories to map every model and variant once", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        vectors: [
          { ...input.vectors[0]!, vectorId: VECTOR_B },
          input.vectors[1]!,
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "vector IDs contains a duplicate",
        "search document and vector IDs disagree",
      ]),
    );
    expect(
      validateManifestInput({
        ...input,
        searchDocuments: input.searchDocuments.slice(0, 1),
      }),
    ).toContain(
      "exact-search inventory does not close over models and variants",
    );
  });

  it("recomputes publication-qualified vector IDs instead of trusting 64 hex", async () => {
    const input = manifestInput();
    await expect(
      buildImmutableManifest({
        ...input,
        searchDocuments: input.searchDocuments.map((document, index) =>
          index === 0 ? { ...document, documentId: "f".repeat(64) } : document,
        ),
        vectors: input.vectors.map((vector, index) =>
          index === 0 ? { ...vector, vectorId: "f".repeat(64) } : vector,
        ),
      }),
    ).rejects.toThrow(/publication-qualified identity/u);
  });

  it("represents unavailable provider outcomes explicitly without selected content", () => {
    const input = manifestInput();
    expect(validateManifestInput(input)).toEqual([]);
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.map((slice) =>
          slice.freshnessState === "unavailable"
            ? { ...slice, carriedForward: true }
            : slice,
        ),
      }),
    ).toContain("unavailable provider cannot carry selected content");
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.map((slice) =>
          slice.freshnessState === "unavailable"
            ? { ...slice, providerSliceId: `prn_${UUID_B}` }
            : { ...slice, providerSliceId: null },
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        "provider selected-slice identity is inconsistent",
      ]),
    );
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.map((slice, index) =>
          index === 0
            ? { ...slice, carriedForward: false, freshnessState: "stale" }
            : slice,
        ),
      }),
    ).toContain("stale provider slice must be carried forward");
  });

  it("enforces contract length ceilings for closure and provider versions", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        versions: { ...input.versions, methodology: "m".repeat(65) },
        providerSlices: input.providerSlices.map((slice, index) =>
          index === 0 ? { ...slice, adapterVersion: "a".repeat(129) } : slice,
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        "methodology version is invalid",
        "provider slice version is invalid",
      ]),
    );
  });

  it("rejects unknown runtime provider freshness discriminants", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.map((slice, index) =>
          index === 0
            ? ({
                ...slice,
                freshnessState: "banana",
              } as unknown as typeof slice)
            : slice,
        ),
      }),
    ).toContain("provider freshness state is invalid");
  });

  it("closure-binds exact enabled-provider coverage and attribution isolation", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.slice(0, 1),
      }),
    ).toContain("provider slices do not exactly cover enabled provider scope");
    expect(
      validateManifestInput({
        ...input,
        enabledProviderIds: [...input.enabledProviderIds, `prv_${UUID_C}`],
      }),
    ).toContain("provider slices do not exactly cover enabled provider scope");
    expect(
      validateManifestInput({
        ...input,
        providerAttributions: input.providerAttributions.map((attribution) => ({
          ...attribution,
          providerId: `prv_${UUID_B}`,
        })),
      }),
    ).toEqual(
      expect.arrayContaining([
        "unavailable provider owns attributed public resources",
        "provider resource attribution does not match its identity",
      ]),
    );
  });

  it("rejects unknown chunk kinds before closure hashing", async () => {
    const input = manifestInput();
    const hostile = {
      ...input,
      chunks: [
        ...input.chunks,
        {
          ...input.chunks[0]!,
          kind: "telemetry",
          ordinal: 0,
          itemCount: 1,
        } as unknown as (typeof input.chunks)[number],
      ],
    };
    expect(validateManifestInput(hostile)).toContain("chunk kind is invalid");
    await expect(buildImmutableManifest(hostile)).rejects.toThrow(
      /chunk kind/u,
    );
  });

  it("rejects chunk gaps, overlap, count drift, self-parenting, and prefix mismatch", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        parentPublicationId: input.publicationId,
        resources: [
          { ...input.resources[0]!, resourceType: "model" },
          ...input.resources.slice(1),
        ],
        chunks: [
          { ...input.chunks[0]!, itemCount: 2 },
          ...input.chunks.slice(1),
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "parent publication ID is invalid",
        "resource type and ID prefix disagree",
        "resources chunk count does not match its inventory",
      ]),
    );
  });
});

const receipts = (
  manifest: ImmutablePublicationManifest,
): ReadinessReceipt[] => {
  const binding: ArtifactBinding = {
    environment: "test",
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
      observedAt: "2026-08-01T11:30:00.000Z",
      retainedBundleHash: manifest.bundleHash,
      immutable: true,
    },
    {
      kind: "serving",
      binding,
      observedAt: "2026-08-01T11:31:00.000Z",
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
      observedAt: "2026-08-01T11:32:00.000Z",
      namespace: manifest.publicationId,
      documentCount: manifest.vectors.length,
      verifiedDocumentCount: manifest.vectors.length,
      vectorInventoryHash: manifest.vectorInventoryHash,
      visibilityProbeVersion: "vector-visibility@1",
      mutationId: "mutation-test-1",
      allIdsPresent: true,
      allNamespacesMatch: true,
      queryable: true,
    },
    {
      kind: "probes",
      binding,
      observedAt: "2026-08-01T11:33:00.000Z",
      probeSetVersion: "search-gold@1",
      integrityPassed: true,
      evidenceCoveragePassed: true,
      exactSearchPassed: true,
      semanticSearchPassed: true,
      structuredFilterPassed: true,
      neutralityPassed: true,
      versionIsolationPassed: true,
    },
  ];
};

describe("adapter-supplied readiness evidence (SRCH-007, PIPE-044, PIPE-050–PIPE-052, QA-006)", () => {
  it("accepts only a complete, fresh, consistently bound receipt set", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    await expect(
      evaluateReadiness({
        manifest,
        receipts: receipts(manifest),
        environment: "test",
        now: NOW,
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).resolves.toEqual({
      decision: "ready",
      readyAt: NOW,
      closureHash: manifest.closureHash,
    });
    await expect(
      projectServingReadinessReceiptRows(receipts(manifest)),
    ).rejects.toThrow(/test-only environment/u);
  });

  it("blocks missing, duplicate, stale, or cross-environment receipts", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    const evidence = receipts(manifest);
    const serving = evidence.find((receipt) => receipt.kind === "serving")!;
    const probes = evidence.find((receipt) => receipt.kind === "probes")!;
    const result = await evaluateReadiness({
      manifest,
      receipts: [
        ...evidence.filter(
          (receipt) => receipt.kind !== "archive" && receipt.kind !== "probes",
        ),
        serving,
        { ...probes, binding: { ...probes.binding, environment: "preview" } },
      ],
      environment: "test",
      now: "2026-08-02T12:00:00.000Z",
      maximumReceiptAgeMs: 60 * 60 * 1000,
    });
    expect(result).toMatchObject({ decision: "blocked" });
    if (result.decision === "blocked")
      expect(result.failureCodes).toEqual(
        expect.arrayContaining([
          "receipt_missing",
          "receipt_duplicate",
          "receipt_binding_mismatch",
          "receipt_stale",
        ]),
      );
  });

  it("fails closed on count/hash/queryability or acceptance-probe drift", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    const evidence = receipts(manifest).map((receipt) => {
      if (receipt.kind === "serving")
        return {
          ...receipt,
          providerSliceCount: 0,
          providerAttributionHash: HASH_A,
          ftsBuildVersion: "fts5-unknown@9",
          foreignKeysValid: false,
        };
      if (receipt.kind === "vectors")
        return {
          ...receipt,
          visibilityProbeVersion: "vector-visibility@unknown",
          allIdsPresent: false,
          queryable: false,
        };
      if (receipt.kind === "probes")
        return {
          ...receipt,
          probeSetVersion: "search-gold@unknown",
          neutralityPassed: false,
        };
      return receipt;
    });
    const result = await evaluateReadiness({
      manifest,
      receipts: evidence,
      environment: "test",
      now: NOW,
      maximumReceiptAgeMs: 60 * 60 * 1000,
    });
    expect(result.decision).toBe("blocked");
    if (result.decision === "blocked")
      expect(result.failureCodes).toEqual(
        expect.arrayContaining([
          "serving_invalid",
          "vectors_invalid",
          "probes_failed",
        ]),
      );
  });

  it("blocks hostile receipt shapes without throwing", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    const evidence = receipts(manifest);
    const hostile = evidence.map((receipt): ReadinessReceipt => {
      if (receipt.kind === "archive")
        return {
          ...receipt,
          immutable: "false",
        } as unknown as ReadinessReceipt;
      if (receipt.kind === "vectors")
        return {
          ...receipt,
          binding: { ...receipt.binding, environment: "staging" },
        } as unknown as ReadinessReceipt;
      if (receipt.kind === "probes")
        return {
          ...receipt,
          probeSetVersion: "probe\u0000set",
        };
      return receipt;
    });
    const result = await evaluateReadiness({
      manifest,
      receipts: hostile,
      environment: "test",
      now: NOW,
      maximumReceiptAgeMs: 60 * 60 * 1000,
    });
    expect(result.decision).toBe("blocked");
    if (result.decision === "blocked")
      expect(result.failureCodes).toContain("receipt_invalid");
  });
});

describe("closed activation and rollback plans (PIPE-050–PIPE-056, QA-006)", () => {
  it("plans initial activation and a generation-CAS switch with an aborting postcondition", () => {
    const candidate = record(`pub_${UUID_B}`, "ready", {
      closureHash: HASH_B,
      readyAt: "2026-08-01T11:00:00.000Z",
    });
    const first = planActivation({
      candidate,
      currentHead: null,
      currentActive: null,
      switchedAt: NOW,
      authorizedBy: AUTHORIZATION,
    });
    expect(first.steps.map((step) => step.kind)).toEqual([
      "assert_candidate_ready",
      "activate_candidate",
      "compare_and_swap_head",
      "append_switch_history",
      "assert_head_postcondition",
    ]);
    expect(first.steps[2]).toMatchObject({ next: { generation: 1 } });

    const current = record(`pub_${UUID_A}`, "active");
    const next = planActivation({
      candidate,
      currentHead: head(),
      currentActive: current,
      switchedAt: NOW,
      authorizedBy: AUTHORIZATION,
    });
    expect(next.steps.map((step) => step.kind)).toEqual([
      "assert_candidate_ready",
      "activate_candidate",
      "compare_and_swap_head",
      "demote_previous",
      "append_switch_history",
      "assert_head_postcondition",
    ]);
    expect(next.steps[2]).toMatchObject({
      expected: head(),
      next: {
        activePublicationId: candidate.publicationId,
        rollbackCandidatePublicationId: current.publicationId,
        generation: 2,
      },
    });
    expect(next.steps[4]).toMatchObject({
      kind: "append_switch_history",
      action: "activate",
      expectedPriorGeneration: 1,
      newGeneration: 2,
      fromPublicationId: current.publicationId,
      fromClosureHash: current.closureHash,
      toPublicationId: candidate.publicationId,
      toClosureHash: candidate.closureHash,
      resultingRollbackCandidatePublicationId: current.publicationId,
      authorizedBy: AUTHORIZATION,
    });
  });

  it("rejects activation when lifecycle and head evidence disagree", () => {
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "building"),
        currentHead: head(),
        currentActive: record(`pub_${UUID_C}`, "active"),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/not ready/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready"),
        currentHead: head(),
        currentActive: record(`pub_${UUID_C}`, "active"),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/does not select/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready"),
        currentHead: { ...head(), switchedAt: NOW },
        currentActive: record(`pub_${UUID_A}`, "active"),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/precedes the current head/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready", {
          firstActivatedAt: "2026-08-01T11:30:00.000Z",
        }),
        currentHead: null,
        currentActive: null,
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/lifecycle timestamps/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_A}`, "ready"),
        currentHead: head(),
        currentActive: record(`pub_${UUID_A}`, "active"),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/already active/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready"),
        currentHead: null,
        currentActive: null,
        switchedAt: NOW,
        authorizedBy: {
          kind: "admin",
          identityId: "invalid-authority",
        } as unknown as SwitchAuthorization,
      }),
    ).toThrow(/authorization identity/u);
    for (const identityId of [
      "UPPERCASE",
      "contains space",
      "visitor\nheader",
      `pipeline-${"x".repeat(128)}`,
    ])
      expect(() =>
        planActivation({
          candidate: record(`pub_${UUID_B}`, "ready"),
          currentHead: null,
          currentActive: null,
          switchedAt: NOW,
          authorizedBy: { kind: "pipeline", identityId },
        }),
      ).toThrow(/authorization identity/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready"),
        currentHead: head(),
        currentActive: record(`pub_${UUID_A}`, "active", {
          firstActivatedAt: "2026-08-01T10:30:00.000Z",
        }),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/switch predates first activation/u);
  });

  it("rolls back only to the immediate retained superseded publication", () => {
    const defective = record(`pub_${UUID_B}`, "active", {
      closureHash: HASH_B,
    });
    const target = record(`pub_${UUID_A}`, "superseded", {
      closureHash: HASH_A,
    });
    const currentHead: StoredPublicationHead = {
      activePublicationId: defective.publicationId,
      rollbackCandidatePublicationId: target.publicationId,
      switchedAt: "2026-08-01T11:00:00.000Z",
      generation: 8,
    };
    const plan = planRollback({
      currentHead,
      defective,
      target,
      switchedAt: NOW,
      authorizedBy: AUTHORIZATION,
    });
    expect(plan.operation).toBe("rollback");
    expect(plan.steps.slice(0, 2)).toEqual([
      {
        kind: "assert_rollback_target",
        publicationId: target.publicationId,
        closureHash: target.closureHash,
        expectedState: "superseded",
      },
      {
        kind: "reactivate_rollback_target",
        publicationId: target.publicationId,
        preserveFirstActivatedAt: target.firstActivatedAt,
      },
    ]);
    expect(plan.steps[2]).toMatchObject({
      kind: "compare_and_swap_head",
      expected: currentHead,
      next: {
        activePublicationId: target.publicationId,
        rollbackCandidatePublicationId: defective.publicationId,
        generation: 9,
      },
    });
    expect(plan.steps[3]).toEqual({
      kind: "demote_previous",
      publicationId: defective.publicationId,
      toState: "rolled_back",
    });
    expect(plan.steps[4]).toMatchObject({
      kind: "append_switch_history",
      action: "rollback",
      expectedPriorGeneration: 8,
      newGeneration: 9,
      authorizedBy: AUTHORIZATION,
    });
    expect(() =>
      planRollback({
        currentHead,
        defective,
        target: { ...target, state: "rolled_back" },
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/retained immediate candidate/u);
    expect(() =>
      planRollback({
        currentHead: { ...currentHead, switchedAt: NOW },
        defective,
        target,
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/precedes the current head/u);
    expect(() =>
      planRollback({
        currentHead,
        defective,
        target: {
          ...target,
          firstActivatedAt: "2026-08-01T12:30:00.000Z",
        },
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/follows switch time/u);
  });

  it("derives contract-facing head fields from one stored head and active closure", () => {
    const active = record(`pub_${UUID_A}`, "active", { closureHash: HASH_B });
    expect(deriveNormalizedPublicationHead(head(), active)).toEqual({
      activePublicationId: active.publicationId,
      vectorNamespace: active.publicationId,
      manifestHash: active.closureHash,
      publishedAt: active.firstActivatedAt,
      rollbackCandidatePublicationId: null,
      switchedAt: head().switchedAt,
      generation: 1,
    });
    expect(() =>
      deriveNormalizedPublicationHead(head(), {
        ...active,
        state: "superseded",
      }),
    ).toThrow(/derive/u);
    expect(() =>
      deriveNormalizedPublicationHead(
        { ...head(), switchedAt: "2026-08-01T09:59:59.000Z" },
        active,
      ),
    ).toThrow(/predates/u);
  });
});

describe("publication selection and hot retention (API-003, API-024A, PIPE-052, PIPE-056)", () => {
  it("selects active or hot pins and gives one generic result for other pins", () => {
    const active = record(`pub_${UUID_A}`, "active");
    const previous = record(`pub_${UUID_B}`, "superseded");
    const currentHead = {
      ...head(),
      rollbackCandidatePublicationId: previous.publicationId,
    };
    expect(
      selectPublication({
        requestedPublicationId: null,
        head: currentHead,
        hotPublications: [active, previous],
      }),
    ).toEqual({
      outcome: "selected",
      publicationId: active.publicationId,
      source: "active",
    });
    expect(
      selectPublication({
        requestedPublicationId: previous.publicationId,
        head: currentHead,
        hotPublications: [active, previous],
      }),
    ).toEqual({
      outcome: "selected",
      publicationId: previous.publicationId,
      source: "pin",
    });
    expect(
      selectPublication({
        requestedPublicationId: `pub_${UUID_C}`,
        head: currentHead,
        hotPublications: [active, previous],
      }),
    ).toEqual({
      outcome: "publication_expired",
      currentPublicationId: active.publicationId,
    });
    expect(
      selectPublication({
        requestedPublicationId: previous.publicationId,
        head: currentHead,
        hotPublications: [active, { ...previous, state: "rolled_back" }],
      }),
    ).toEqual({
      outcome: "selected",
      publicationId: previous.publicationId,
      source: "pin",
    });
    expect(
      selectPublication({
        requestedPublicationId: `pub_${UUID_C}`,
        head: currentHead,
        hotPublications: [
          active,
          previous,
          record(`pub_${UUID_C}`, "rolled_back"),
        ],
      }),
    ).toEqual({
      outcome: "publication_expired",
      currentPublicationId: active.publicationId,
    });
    expect(() =>
      selectPublication({
        requestedPublicationId: null,
        head: currentHead,
        hotPublications: [
          active,
          record(`pub_${UUID_C}`, "building", {
            readyAt: "2026-08-01T11:00:00.000Z",
          }),
        ],
      }),
    ).toThrow(/non-ready publication/u);
  });

  it("never prunes active, rollback, or building state and observes safety intervals", () => {
    const active = record(`pub_${UUID_A}`, "active");
    const previous = record(`pub_${UUID_B}`, "superseded");
    const building = record(`pub_${UUID_C}`, "building");
    const old = record(`pub_${UUID_D}`, "rolled_back", {
      lastHeadReferencedAt: "2026-07-01T00:00:00.000Z",
    });
    const rolledHot = record(`pub_${UUID_E}`, "rolled_back", {
      lastHeadReferencedAt: "2026-08-01T11:59:00.000Z",
    });
    const decisions = decideHotRetention({
      now: NOW,
      head: {
        ...head(),
        rollbackCandidatePublicationId: previous.publicationId,
      },
      publications: [old, rolledHot, building, previous, active],
      minimumHotMs: 7 * 24 * 60 * 60 * 1000,
      cursorTtlMs: 15 * 60 * 1000,
      maximumClockSkewMs: 60 * 1000,
    });
    expect(decisions).toEqual(
      expect.arrayContaining([
        {
          publicationId: active.publicationId,
          action: "retain_hot",
          reason: "active",
        },
        {
          publicationId: previous.publicationId,
          action: "retain_hot",
          reason: "rollback_candidate",
        },
        {
          publicationId: building.publicationId,
          action: "retain_hot",
          reason: "building",
        },
        {
          publicationId: old.publicationId,
          action: "archive_only_eligible",
          reason: "expired",
        },
        {
          publicationId: rolledHot.publicationId,
          action: "retain_hot",
          reason: "safety_interval",
        },
      ]),
    );
  });
});

describe("portable backup manifest validation (BE-010–BE-012, OPS-008)", () => {
  const trustedClosure = {
    publicationId: `pub_${UUID_A}` as const,
    closureHash: HASH_A,
    providerSliceCount: 2,
    resourceCount: 3,
    searchDocumentCount: 2,
  };
  const validateBackup = (manifest: BackupManifest) =>
    validateBackupManifest(manifest, trustedClosure);

  const backup = async (): Promise<BackupManifest> => {
    const withoutRoot = {
      formatVersion: "1.0.0" as const,
      publicationId: `pub_${UUID_A}` as const,
      closureHash: HASH_A,
      canonicalStartBoundary: "bookmark:42",
      canonicalEndBoundary: "bookmark:42",
      writerLeaseDrained: true,
      ordinaryTablesOnly: true,
      searchDocumentsIncluded: true,
      expectedProviderSliceCount: 2,
      expectedResourceCount: 3,
      expectedSearchDocumentCount: 2,
      tables: [
        {
          table: "publication",
          chunkCount: 1,
          rowCount: 1,
          byteCount: 64,
        },
        {
          table: "publication_provider_slice",
          chunkCount: 1,
          rowCount: 2,
          byteCount: 80,
        },
        {
          table: "publication_resource",
          chunkCount: 1,
          rowCount: 3,
          byteCount: 128,
        },
        {
          table: "publication_search_document",
          chunkCount: 1,
          rowCount: 2,
          byteCount: 96,
        },
        {
          table: "publication_dataset_metadata_summary",
          chunkCount: 1,
          rowCount: 1,
          byteCount: 64,
        },
        ...SERVING_BACKUP_TABLES.filter(
          (table) =>
            ![
              "publication",
              "publication_provider_slice",
              "publication_resource",
              "publication_search_document",
              "publication_dataset_metadata_summary",
            ].includes(table),
        ).map((table) => ({
          table,
          chunkCount: 0,
          rowCount: 0,
          byteCount: 0,
        })),
      ],
      chunks: [
        {
          table: "publication",
          ordinal: 0,
          firstKey: "publication",
          lastKey: "publication",
          rowCount: 1,
          byteCount: 64,
          contentHash: HASH_A,
        },
        {
          table: "publication_provider_slice",
          ordinal: 0,
          firstKey: "a",
          lastKey: "z",
          rowCount: 2,
          byteCount: 80,
          contentHash: HASH_A,
        },
        {
          table: "publication_resource",
          ordinal: 0,
          firstKey: "a",
          lastKey: "z",
          rowCount: 3,
          byteCount: 128,
          contentHash: HASH_B,
        },
        {
          table: "publication_search_document",
          ordinal: 0,
          firstKey: "a",
          lastKey: "z",
          rowCount: 2,
          byteCount: 96,
          contentHash: HASH_C,
        },
        {
          table: "publication_dataset_metadata_summary",
          ordinal: 0,
          firstKey: "summary",
          lastKey: "summary",
          rowCount: 1,
          byteCount: 64,
          contentHash: HASH_A,
        },
      ],
    };
    return { ...withoutRoot, rootHash: await buildBackupRootHash(withoutRoot) };
  };

  it("accepts one stable drained boundary over ordinary rows and search sources", async () => {
    expect(await validateBackup(await backup())).toEqual([]);
  });

  it("rejects boundary drift, virtual-index backup, missing search sources, and hash drift", async () => {
    const manifest = await backup();
    const errors = await validateBackup({
      ...manifest,
      canonicalEndBoundary: "bookmark:43",
      writerLeaseDrained: false,
      ordinaryTablesOnly: false,
      searchDocumentsIncluded: false,
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "canonical writer lease was not drained",
        "canonical backup boundary drifted",
        "backup includes a non-portable index table",
        "backup omits search document sources",
        "backup root hash does not match immutable content",
      ]),
    );
  });

  it("rejects missing, duplicate, unexpected, and count-drifted table inventories", async () => {
    const manifest = await backup();
    const errors = await validateBackup({
      ...manifest,
      tables: [
        ...manifest.tables.filter(
          (table) => table.table !== "publication_search_document",
        ),
        manifest.tables[0]!,
        {
          table: "fts_publication_search",
          chunkCount: 0,
          rowCount: 0,
          byteCount: 0,
        },
        { ...manifest.tables[2]!, rowCount: 4 },
      ],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "backup table inventory contains a duplicate",
        "backup table inventory is missing publication_search_document",
        "backup table inventory contains unexpected table fts_publication_search",
        "publication_resource backup table totals do not match chunks",
        "backup root hash does not match immutable content",
      ]),
    );
  });

  it("rejects every reconstructible search projection from backup inventories", async () => {
    const manifest = await backup();
    for (const excludedTable of [
      "publication_provider_search_document",
      "fts_publication_provider_name",
      "publication_model_variant_name_search_document",
      "publication_provider_model_id_search_document",
    ]) {
      const withoutRoot = {
        ...manifest,
        tables: [
          ...manifest.tables,
          {
            table: excludedTable,
            chunkCount: 0,
            rowCount: 0,
            byteCount: 0,
          },
        ],
      };
      const candidate = {
        ...withoutRoot,
        rootHash: await buildBackupRootHash(withoutRoot),
      };

      expect(await validateBackup(candidate)).toContain(
        `backup table inventory contains unexpected table ${excludedTable}`,
      );
    }
  });

  it("rejects a self-consistent truncated export against trusted closure facts", async () => {
    const manifest = await backup();
    const tables = manifest.tables.map((table) =>
      table.table === "publication_resource"
        ? { ...table, rowCount: 2 }
        : table,
    );
    const chunks = manifest.chunks.map((chunk) =>
      chunk.table === "publication_resource"
        ? { ...chunk, rowCount: 2 }
        : chunk,
    );
    const truncatedWithoutTrustedCount = {
      ...manifest,
      expectedResourceCount: 2,
      tables,
      chunks,
    };
    const truncated = {
      ...truncatedWithoutTrustedCount,
      rootHash: await buildBackupRootHash(truncatedWithoutTrustedCount),
    };

    expect(await validateBackup(truncated)).toContain(
      "backup declared counts do not match the trusted closure",
    );
  });

  it("rejects hostile booleans, boundaries, and empty or closure-mismatched backups", async () => {
    const manifest = await backup();
    const hostileBoolean = await validateBackup({
      ...manifest,
      writerLeaseDrained: "false",
    } as unknown as BackupManifest);
    expect(hostileBoolean).toEqual(
      expect.arrayContaining([
        "backup Boolean fields are invalid",
        "backup root hash does not match immutable content",
      ]),
    );
    for (const boundary of ["", "bad\u0001boundary", "x".repeat(257)]) {
      const errors = await validateBackup({
        ...manifest,
        canonicalStartBoundary: boundary,
        canonicalEndBoundary: boundary,
      });
      expect(errors).toContain("canonical backup boundary is invalid");
    }
    const empty = await validateBackup({
      ...manifest,
      tables: [],
      chunks: [],
    });
    expect(empty).toEqual(
      expect.arrayContaining([
        "backup table inventory is missing publication",
        "backup table inventory is missing publication_provider_slice",
        "backup must contain exactly one publication row",
        "backup provider-slice count does not match closure",
      ]),
    );
    const mismatched = await validateBackup({
      ...manifest,
      expectedResourceCount: 4,
      expectedSearchDocumentCount: 3,
      tables: manifest.tables.map((table) =>
        table.table === "publication"
          ? { ...table, rowCount: 0 }
          : table.table === "publication_provider_slice"
            ? { ...table, rowCount: 0 }
            : table,
      ),
    });
    expect(mismatched).toEqual(
      expect.arrayContaining([
        "backup must contain exactly one publication row",
        "backup provider-slice count does not match closure",
        "backup resource count does not match closure",
        "backup search-document count does not match closure",
      ]),
    );
  });
});
