import {
  assertServingReadinessCommitProjectionV5,
  classifyServingReadinessCommitRetryV5,
  readServingReadinessCommitPersistenceV5,
  verifyDatasetMetadataSummaryHash,
  type DatasetMetadataSummaryProjection,
  type ModelSlugArtifactProofStorageRowV5,
  type PublicationState,
  type ServingArchiveReceiptRowV5,
  type ServingProbeReceiptRowV5,
  type ServingReadinessAttestationProjectionV5,
  type ServingReadinessCommitPersistenceV5,
  type ServingReadinessCommitProjectionV5,
  type ServingReadinessReceiptBindingRow,
  type ServingReadinessReceiptRowsV5,
  type ServingReceiptRowV5,
  type ServingVectorReceiptRow,
} from "@quant-clarity/publication-core";

import {
  ProviderModelIdSearchStagingError,
  prepareProviderModelIdSearchAtomicAssertionsV4,
  verifyProviderModelIdSearchStorageV4,
} from "./provider-model-id-search-staging.js";
import {
  assertModelSlugLifecycleAuthorityBindingV5,
  assertModelSlugLifecycleAuthorityV5,
  readModelSlugLifecycleOperationalBindingV5,
  type ModelSlugLifecycleAuthorityV5,
} from "./model-slug-lifecycle-authority.js";
import {
  ModelSlugHistoryStagingError,
  verifyModelSlugServingStorage,
} from "./model-slug-history-staging.js";

const SELECT_PUBLICATION_SQL = `SELECT state, ready_at_ms, closure_hash,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS database_now_ms
FROM publication WHERE publication_id = ?1`;
const SELECT_BINDINGS_SQL = `SELECT publication_id, kind, receipt_version,
  receipt_hash, environment, closure_hash, bundle_hash, schema_version,
  build_commit, observed_at_ms
FROM publication_readiness_receipt WHERE publication_id = ?1 ORDER BY kind`;
const SELECT_ARCHIVE_SQL = `SELECT publication_id, kind, retained_bundle_hash,
  model_slug_artifact_version, model_slug_acquisition_version,
  model_slug_projection_version, model_slug_artifact_digest,
  model_slug_artifact_byte_count, model_slug_source_history_count,
  model_slug_source_history_hash, model_slug_model_count,
  model_slug_mapping_count, model_slug_current_mapping_count,
  model_slug_historical_mapping_count, model_slug_mapping_inventory_hash,
  model_slug_read_verified, model_slug_immutable, immutable
FROM publication_archive_receipt WHERE publication_id = ?1`;
const SELECT_SERVING_SQL = `SELECT publication_id, kind,
  enabled_provider_count, enabled_provider_scope_hash, provider_slice_count,
  provider_slice_hash, provider_attribution_count, provider_attribution_hash,
  resource_count, exact_document_count, resource_inventory_hash,
  exact_search_inventory_hash, fts_build_version, fts_document_count,
  fts_queryable, foreign_keys_valid, content_hashes_valid,
  unavailable_provider_isolation_valid, provider_search_projection_version,
  provider_search_document_count, provider_search_inventory_hash,
  provider_search_fts_build_version, provider_search_fts_document_count,
  provider_search_fts_queryable, provider_search_exact_parity,
  model_variant_name_projection_version, model_variant_name_document_count,
  model_variant_name_inventory_hash, model_variant_name_storage_version,
  model_variant_name_storage_document_count,
  model_variant_name_storage_queryable,
  model_variant_name_storage_exact_parity,
  provider_model_id_projection_version, provider_model_id_document_count,
  provider_model_id_inventory_hash, provider_model_id_storage_version,
  provider_model_id_storage_document_count,
  provider_model_id_storage_queryable,
  provider_model_id_storage_exact_parity, model_slug_storage_version,
  model_slug_artifact_digest, model_slug_projection_version,
  model_slug_model_count, model_slug_mapping_count,
  model_slug_current_mapping_count, model_slug_historical_mapping_count,
  model_slug_mapping_inventory_hash, model_slug_queryable,
  model_slug_exact_parity
FROM publication_serving_receipt WHERE publication_id = ?1`;
const SELECT_VECTOR_SQL = `SELECT publication_id, kind, vector_namespace,
  document_count, verified_document_count, vector_inventory_hash,
  visibility_probe_version, mutation_id, all_ids_present,
  all_namespaces_match, queryable
FROM publication_vector_receipt WHERE publication_id = ?1`;
const SELECT_PROBE_SQL = `SELECT publication_id, kind, probe_set_version,
  integrity_passed, evidence_coverage_passed, exact_search_passed,
  semantic_search_passed, structured_filter_passed, neutrality_passed,
  version_isolation_passed, model_slug_lookup_passed
FROM publication_probe_receipt WHERE publication_id = ?1`;
const SELECT_ATTESTATION_SQL = `SELECT publication_id, environment,
  closure_hash, bundle_hash, evaluator_version, ready_at_ms,
  maximum_receipt_age_ms, effective_valid_until_ms, archive_observed_at_ms,
  serving_observed_at_ms, vector_observed_at_ms, probes_observed_at_ms,
  archive_receipt_hash, serving_receipt_hash, vector_receipt_hash,
  probes_receipt_hash, attestation_hash
FROM publication_readiness_attestation WHERE publication_id = ?1`;
const SELECT_MODEL_SLUG_PROOF_SQL = `SELECT publication_id, staging_revision,
  artifact_version, acquisition_version, projection_version,
  base_bundle_hash, closure_hash, publication_boundary_ms, artifact_digest,
  artifact_byte_count, model_count, source_history_count, source_history_hash,
  mapping_count, current_mapping_count, historical_mapping_count,
  mapping_inventory_hash
FROM publication_model_slug_artifact_proof WHERE publication_id = ?1`;

const SELECT_MODEL_SLUG_INTEGRITY_SQL = `SELECT
  (SELECT count(*) FROM publication_model_slug_mapping
   WHERE publication_id = ?1) AS mapping_count,
  (SELECT count(*) FROM publication_model_slug_mapping
   WHERE publication_id = ?1 AND resolution = 'current') AS current_count,
  (SELECT count(*) FROM publication_model_slug_mapping
   WHERE publication_id = ?1 AND resolution = 'historical') AS historical_count,
  NOT EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = ?1 AND resource.resource_type = 'model'
      AND NOT EXISTS (
        SELECT 1 FROM publication_model_slug_mapping AS mapping
          INDEXED BY publication_model_slug_current_model_idx
        WHERE mapping.publication_id = resource.publication_id
          AND mapping.model_id = resource.resource_id
          AND mapping.resolution = 'current'
          AND mapping.target_content_hash = resource.content_hash
          AND CAST(mapping.slug AS BLOB) = CAST(
            json_extract(resource.resource_json, '$.slug.value') AS BLOB
          )
      )
  ) AS current_parity,
  (SELECT count(*) = 3 AND sum(CASE
     WHEN seqno = 0 AND name = 'publication_id' AND coll = 'BINARY' THEN 1
     WHEN seqno = 1 AND name = 'slug' AND coll = 'BINARY' THEN 1
     WHEN seqno = 2 AND name = 'model_id' AND coll = 'BINARY' THEN 1
     ELSE 0 END) = 3
   FROM pragma_index_xinfo('publication_model_slug_exact_idx') WHERE key = 1)
    AS exact_index_valid,
  (SELECT count(*) = 2 AND sum(CASE
     WHEN seqno = 0 AND name = 'publication_id' AND coll = 'BINARY' THEN 1
     WHEN seqno = 1 AND name = 'model_id' AND coll = 'BINARY' THEN 1
     ELSE 0 END) = 2
   FROM pragma_index_xinfo('publication_model_slug_current_model_idx')
   WHERE key = 1) AS current_index_valid,
  NOT EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_exact_idx
    WHERE publication_id = ?1 AND slug = '__readiness_index_probe__'
  ) AS exact_index_queryable,
  NOT EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_current_model_idx
    WHERE publication_id = ?1
      AND model_id = 'mdl_00000000-0000-4000-8000-000000000000'
      AND resolution = 'current'
  ) AS current_index_queryable`;

const SELECT_DATASET_METADATA_SUMMARY_SQL = `WITH aggregate_counts AS (
  SELECT
    coalesce(sum(CASE WHEN resource_type = 'model'
      AND json_extract(resource_json, '$.status.state') = 'known'
      AND json_extract(resource_json, '$.status.value') = 'active'
      THEN 1 ELSE 0 END), 0) AS derived_active_model_count,
    coalesce(sum(CASE WHEN resource_type = 'offering'
      AND json_extract(resource_json, '$.status.state') = 'known'
      AND json_extract(resource_json, '$.status.value') = 'active'
      AND json_extract(resource_json, '$.stale') = 0
      THEN 1 ELSE 0 END), 0) AS derived_active_offering_count,
    coalesce(sum(CASE WHEN resource_type = 'provider'
      AND json_extract(resource_json, '$.status.state') = 'known'
      AND json_extract(resource_json, '$.status.value') = 'active'
      THEN 1 ELSE 0 END), 0) AS derived_active_provider_count,
    coalesce(sum(CASE WHEN resource_type IN ('model','offering','provider') AND (
      json_type(resource_json, '$.status') IS NOT 'object' OR
      json_type(resource_json, '$.status.state') IS NOT 'text' OR
      COALESCE(json_extract(resource_json, '$.status.state'), '__missing__') NOT IN
        ('known','unknown','not_applicable','unavailable') OR
      (json_extract(resource_json, '$.status.state') = 'known' AND
       json_type(resource_json, '$.status.value') IS NOT 'text') OR
      (json_extract(resource_json, '$.status.state') IS NOT 'known' AND
       json_type(resource_json, '$.status.value') IS NOT 'null') OR
      (resource_type = 'model' AND
       json_extract(resource_json, '$.model_id') IS NOT resource_id) OR
      (resource_type = 'offering' AND (
       json_extract(resource_json, '$.offering_id') IS NOT resource_id OR
       (json_type(resource_json, '$.stale') IS NOT 'true' AND
        json_type(resource_json, '$.stale') IS NOT 'false'))) OR
      (resource_type = 'provider' AND
       json_extract(resource_json, '$.provider_id') IS NOT resource_id)
    ) THEN 1 ELSE 0 END), 0) AS malformed_counted_resource_count
  FROM publication_resource WHERE publication_id = ?1
)
SELECT summary.*, seal.closure_hash AS seal_closure_hash,
  seal.resource_count AS seal_resource_count,
  seal.provider_slice_count AS seal_provider_slice_count,
  seal.provider_slice_hash AS seal_provider_slice_hash,
  aggregate_counts.*,
  EXISTS (SELECT 1 FROM publication_provider_slice
    WHERE publication_id = ?1 AND freshness_state = 'stale')
      AS derived_has_stale_provider_slices,
  EXISTS (SELECT 1 FROM publication_provider_slice
    WHERE publication_id = ?1 AND freshness_state = 'unavailable')
      AS derived_has_unavailable_provider_slices
FROM publication_dataset_metadata_summary AS summary
JOIN publication_closure_seal AS seal USING (publication_id)
CROSS JOIN aggregate_counts WHERE summary.publication_id = ?1`;

const ASSERT_PRECONDITION_SQL = `SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication AS candidate
  JOIN publication_closure_seal AS seal USING (publication_id)
  JOIN publication_model_slug_artifact_proof AS proof USING (publication_id)
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building' AND candidate.ready_at_ms IS NULL
    AND candidate.closure_hash = ?2 AND seal.closure_hash = ?2
    AND seal.bundle_hash = ?3 AND proof.staging_revision = seal.staging_revision
    AND proof.artifact_version = ?7 AND proof.acquisition_version = ?8
    AND proof.projection_version = ?9 AND proof.base_bundle_hash = ?3
    AND proof.closure_hash = ?2 AND proof.publication_boundary_ms = ?10
    AND proof.artifact_digest = ?11 AND proof.artifact_byte_count = ?12
    AND proof.model_count = ?13 AND proof.source_history_count = ?14
    AND proof.source_history_hash = ?15 AND proof.mapping_count = ?16
    AND proof.current_mapping_count = ?17
    AND proof.historical_mapping_count = ?18
    AND proof.mapping_inventory_hash = ?19
    AND (SELECT count(*) FROM publication_provider_search_document
         WHERE publication_id = ?1) = ?4
    AND (SELECT count(*) FROM publication_provider_search_fts
         WHERE publication_id = ?1) = ?4
    AND (SELECT count(*) FROM publication_model_variant_name_search_document
         WHERE publication_id = ?1) = ?5
    AND (SELECT count(*) FROM publication_provider_model_id_search_document
         WHERE publication_id = ?1) = ?6
    AND (SELECT count(*) FROM publication_model_slug_mapping
         WHERE publication_id = ?1) = ?16
    AND (SELECT count(*) FROM publication_model_slug_mapping
         WHERE publication_id = ?1 AND resolution = 'current') = ?17
    AND (SELECT count(*) FROM publication_model_slug_mapping
         WHERE publication_id = ?1 AND resolution = 'historical') = ?18
    AND NOT EXISTS (SELECT 1 FROM publication_readiness_receipt
                    WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_archive_receipt
                    WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_serving_receipt
                    WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_vector_receipt
                    WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_probe_receipt
                    WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_readiness_attestation
                    WHERE publication_id = ?1)
    AND CAST(strftime('%s', 'now') AS INTEGER) * 1000 <= ?20
) THEN 1 ELSE json('') END AS clean`;

const ASSERT_SLUG_PARITY_SQL = `SELECT CASE WHEN
  (SELECT count(*) FROM publication_model_slug_mapping
   WHERE publication_id = ?1) = ?2
  AND (SELECT count(*) FROM publication_model_slug_mapping
   WHERE publication_id = ?1 AND resolution = 'current') = ?3
  AND (SELECT count(*) FROM publication_model_slug_mapping
   WHERE publication_id = ?1 AND resolution = 'historical') = ?4
  AND NOT EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = ?1 AND resource.resource_type = 'model'
      AND NOT EXISTS (
        SELECT 1 FROM publication_model_slug_mapping AS mapping
          INDEXED BY publication_model_slug_current_model_idx
        WHERE mapping.publication_id = resource.publication_id
          AND mapping.model_id = resource.resource_id
          AND mapping.resolution = 'current'
          AND mapping.target_content_hash = resource.content_hash
          AND CAST(mapping.slug AS BLOB) = CAST(
            json_extract(resource.resource_json, '$.slug.value') AS BLOB)
      )
  ) THEN 1 ELSE json('') END AS exact_parity`;

const ASSERT_SLUG_INDEXES_SQL = `SELECT CASE WHEN
  EXISTS (SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
      WHERE name = 'publication_model_slug_exact_idx'
        AND "unique" = 0 AND origin = 'c' AND partial = 0)
    AND EXISTS (
      SELECT count(*) FROM pragma_index_xinfo(
        'publication_model_slug_exact_idx'
      ) WHERE key = 1 HAVING count(*) = 3 AND sum(CASE
        WHEN seqno = 0 AND name = 'publication_id' AND desc = 0
          AND coll = 'BINARY' THEN 1
        WHEN seqno = 1 AND name = 'slug' AND desc = 0
          AND coll = 'BINARY' THEN 1
        WHEN seqno = 2 AND name = 'model_id' AND desc = 0
          AND coll = 'BINARY' THEN 1
        ELSE 0 END) = 3)
    AND EXISTS (SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
      WHERE name = 'publication_model_slug_current_model_idx'
        AND "unique" = 1 AND origin = 'c' AND partial = 1)
    AND EXISTS (
      SELECT 1 FROM sqlite_schema
      WHERE type = 'index'
        AND name = 'publication_model_slug_current_model_idx'
        AND tbl_name = 'publication_model_slug_mapping'
        AND replace(replace(replace(replace(sql, char(10), ''),
          char(13), ''), char(9), ''), ' ', '') =
          'CREATEUNIQUEINDEXpublication_model_slug_current_model_idxONpublication_model_slug_mapping(publication_id,model_id)WHEREresolution=''current'''
    )
    AND EXISTS (
      SELECT count(*) FROM pragma_index_xinfo(
        'publication_model_slug_current_model_idx'
      ) WHERE key = 1 HAVING count(*) = 2 AND sum(CASE
        WHEN seqno = 0 AND name = 'publication_id' AND desc = 0
          AND coll = 'BINARY' THEN 1
        WHEN seqno = 1 AND name = 'model_id' AND desc = 0
          AND coll = 'BINARY' THEN 1
        ELSE 0 END) = 2)
    AND NOT EXISTS (
      SELECT 1 FROM publication_model_slug_mapping AS expected
      WHERE expected.publication_id = ?1 AND expected.resolution = 'current'
        AND NOT EXISTS (
          SELECT 1 FROM publication_model_slug_mapping AS indexed
            INDEXED BY publication_model_slug_current_model_idx
          WHERE indexed.publication_id = expected.publication_id
            AND indexed.model_id = expected.model_id
            AND indexed.resolution = 'current'
        )
    )
    AND (?2 = 0 OR ((SELECT count(*) FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_exact_idx
      WHERE publication_id = ?1 AND slug = ?3 AND model_id = ?4) = 1
    AND (SELECT count(*) FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_current_model_idx
      WHERE publication_id = ?1 AND model_id = ?4
        AND resolution = 'current') = 1))
    AND NOT EXISTS (
      SELECT 1 FROM publication_model_slug_mapping
        INDEXED BY publication_model_slug_exact_idx
      WHERE publication_id = ?1 AND slug = '__readiness_index_probe__')
  AND NOT EXISTS (
      SELECT 1 FROM publication_model_slug_mapping
        INDEXED BY publication_model_slug_current_model_idx
      WHERE publication_id = ?1
        AND model_id = 'mdl_00000000-0000-4000-8000-000000000000'
        AND resolution = 'current')
THEN 1 ELSE json('') END AS indexes_exact`;

const INSERT_BINDING_SQL = `INSERT INTO publication_readiness_receipt VALUES
  (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`;
const INSERT_ARCHIVE_SQL = `INSERT INTO publication_archive_receipt VALUES
  (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`;
const INSERT_SERVING_SQL = `INSERT INTO publication_serving_receipt VALUES
  (${Array.from({ length: 49 }, (_, index) => `?${String(index + 1)}`).join(",")})`;
const INSERT_VECTOR_SQL = `INSERT INTO publication_vector_receipt VALUES
  (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`;
const INSERT_PROBE_SQL = `INSERT INTO publication_probe_receipt VALUES
  (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`;
const INSERT_ATTESTATION_SQL = `INSERT INTO publication_readiness_attestation
  VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`;
const UPDATE_READY_SQL = `UPDATE publication SET state = 'ready', ready_at_ms = ?2
WHERE publication_id = ?1 AND state = 'building' AND ready_at_ms IS NULL
  AND closure_hash = ?3`;
const ASSERT_POSTCONDITION_SQL = `SELECT CASE WHEN changes() = 1
  AND EXISTS (SELECT 1 FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    JOIN publication_model_slug_artifact_proof AS proof USING (publication_id)
    JOIN publication_archive_receipt AS archive USING (publication_id)
    JOIN publication_serving_receipt AS serving USING (publication_id)
    JOIN publication_probe_receipt AS probes USING (publication_id)
    JOIN publication_readiness_attestation AS attestation USING (publication_id)
    WHERE candidate.publication_id = ?1 AND candidate.state = 'ready'
      AND candidate.ready_at_ms = ?2 AND candidate.closure_hash = ?3
      AND seal.closure_hash = ?3 AND seal.bundle_hash = ?4
      AND proof.artifact_digest = ?5 AND proof.mapping_inventory_hash = ?6
      AND archive.model_slug_artifact_digest = ?5
      AND archive.model_slug_mapping_inventory_hash = ?6
      AND serving.model_slug_artifact_digest = ?5
      AND serving.model_slug_mapping_inventory_hash = ?6
      AND archive.model_slug_read_verified = 1
      AND archive.model_slug_immutable = 1
      AND serving.model_slug_queryable = 1
      AND serving.model_slug_exact_parity = 1
      AND probes.model_slug_lookup_passed = 1
      AND attestation.attestation_hash = ?7
      AND CAST(strftime('%s', 'now') AS INTEGER) * 1000 <= ?9)
  AND (SELECT count(*) FROM publication_readiness_receipt
       WHERE publication_id = ?1 AND receipt_version = '5.0.0') = 4
  AND (SELECT count(*) FROM publication_model_slug_mapping
       WHERE publication_id = ?1) = ?8
THEN 1 ELSE json('') END AS verified`;

export type ReadinessCommitV5ErrorCode =
  | "stale"
  | "conflict"
  | "integrity_failure"
  | "not_applied"
  | "outcome_unknown";
export class ReadinessCommitV5Error extends Error {
  readonly code: ReadinessCommitV5ErrorCode;
  readonly retrySameProjection: boolean;
  constructor(code: ReadinessCommitV5ErrorCode) {
    super("The schema-1.13 readiness commit could not be applied safely.");
    this.name = "ReadinessCommitV5Error";
    this.code = code;
    this.retrySameProjection = code === "not_applied";
  }
}
export type ReadinessCommitV5Result = Readonly<{
  outcome: "applied" | "idempotent_success";
  publicationId: string;
  readyAtMs: number;
}>;

const states = new Set<string>([
  "building",
  "failed",
  "ready",
  "active",
  "superseded",
  "rolled_back",
]);
const HASH = /^sha256:[0-9a-f]{64}$/u;
const integrityFailure = (): never => {
  throw new ReadinessCommitV5Error("integrity_failure");
};
const snapshotExactDataRecord = (
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return integrityFailure();
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      return integrityFailure();
    const actual = Reflect.ownKeys(value);
    if (
      actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key))
    )
      return integrityFailure();
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.enumerable !== true || !("value" in descriptor))
        return integrityFailure();
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch (error) {
    if (error instanceof ReadinessCommitV5Error) throw error;
    return integrityFailure();
  }
};
const flagKeys = new Set([
  "immutable",
  "model_slug_read_verified",
  "model_slug_immutable",
  "model_slug_queryable",
  "model_slug_exact_parity",
  "model_slug_lookup_passed",
  "fts_queryable",
  "foreign_keys_valid",
  "content_hashes_valid",
  "unavailable_provider_isolation_valid",
  "provider_search_fts_queryable",
  "provider_search_exact_parity",
  "model_variant_name_storage_queryable",
  "model_variant_name_storage_exact_parity",
  "provider_model_id_storage_queryable",
  "provider_model_id_storage_exact_parity",
  "all_ids_present",
  "all_namespaces_match",
  "queryable",
  "integrity_passed",
  "evidence_coverage_passed",
  "exact_search_passed",
  "semantic_search_passed",
  "structured_filter_passed",
  "neutrality_passed",
  "version_isolation_passed",
  "has_stale_provider_slices",
  "has_unavailable_provider_slices",
  "derived_has_stale_provider_slices",
  "derived_has_unavailable_provider_slices",
  "current_parity",
  "exact_index_valid",
  "current_index_valid",
  "exact_index_queryable",
  "current_index_queryable",
  "verified",
]);
const validScalar = (key: string, value: unknown): boolean => {
  if (typeof value === "number")
    return (
      Number.isSafeInteger(value) &&
      value >= 0 &&
      (!flagKeys.has(key) || value <= 1)
    );
  if (typeof value !== "string" || value.length === 0 || value.length > 256)
    return false;
  return !key.endsWith("_hash") && !key.endsWith("_digest")
    ? true
    : HASH.test(value);
};
const snapshotBatch = (value: unknown, count: number): readonly unknown[] => {
  return snapshotDenseArray(value, count, count);
};
const snapshotDenseArray = (
  value: unknown,
  maximum: number,
  exact?: number,
): readonly unknown[] => {
  try {
    if (
      !Array.isArray(value) ||
      Reflect.getPrototypeOf(value) !== Array.prototype
    )
      return integrityFailure();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor))
      return integrityFailure();
    const length: unknown = lengthDescriptor.value;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximum ||
      (exact !== undefined && length !== exact)
    )
      return integrityFailure();
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== length + 1 ||
      !ownKeys.includes("length") ||
      ownKeys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" ||
            !Number.isSafeInteger(Number(key)) ||
            Number(key) < 0 ||
            Number(key) >= length ||
            String(Number(key)) !== key),
      )
    )
      return integrityFailure();
    const output = new Array<unknown>(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor?.enumerable !== true || !("value" in descriptor))
        return integrityFailure();
      output[index] = descriptor.value;
    }
    return Object.freeze(output);
  } catch (error) {
    if (error instanceof ReadinessCommitV5Error) throw error;
    return integrityFailure();
  }
};
const snapshotResult = (
  value: unknown,
  maximum: number,
): readonly unknown[] => {
  const result = snapshotExactDataRecord(value, ["meta", "results", "success"]);
  if (result.success !== true) return integrityFailure();
  return snapshotDenseArray(result.results, maximum);
};
const decode = <Row extends Readonly<Record<string, unknown>>>(
  rows: readonly unknown[],
  keys: readonly (keyof Row & string)[],
): readonly Row[] =>
  Object.freeze(
    rows.map((value) => {
      const detached = snapshotExactDataRecord(value, keys);
      for (const key of keys) {
        if (!validScalar(key, detached[key])) return integrityFailure();
      }
      return Object.freeze(detached) as Row;
    }),
  );

const bindingKeys = [
  "publication_id",
  "kind",
  "receipt_version",
  "receipt_hash",
  "environment",
  "closure_hash",
  "bundle_hash",
  "schema_version",
  "build_commit",
  "observed_at_ms",
] as const;
const archiveKeys = [
  "publication_id",
  "kind",
  "retained_bundle_hash",
  "model_slug_artifact_version",
  "model_slug_acquisition_version",
  "model_slug_projection_version",
  "model_slug_artifact_digest",
  "model_slug_artifact_byte_count",
  "model_slug_source_history_count",
  "model_slug_source_history_hash",
  "model_slug_model_count",
  "model_slug_mapping_count",
  "model_slug_current_mapping_count",
  "model_slug_historical_mapping_count",
  "model_slug_mapping_inventory_hash",
  "model_slug_read_verified",
  "model_slug_immutable",
  "immutable",
] as const;
const servingKeys = [
  "publication_id",
  "kind",
  "enabled_provider_count",
  "enabled_provider_scope_hash",
  "provider_slice_count",
  "provider_slice_hash",
  "provider_attribution_count",
  "provider_attribution_hash",
  "resource_count",
  "exact_document_count",
  "resource_inventory_hash",
  "exact_search_inventory_hash",
  "fts_build_version",
  "fts_document_count",
  "fts_queryable",
  "foreign_keys_valid",
  "content_hashes_valid",
  "unavailable_provider_isolation_valid",
  "provider_search_projection_version",
  "provider_search_document_count",
  "provider_search_inventory_hash",
  "provider_search_fts_build_version",
  "provider_search_fts_document_count",
  "provider_search_fts_queryable",
  "provider_search_exact_parity",
  "model_variant_name_projection_version",
  "model_variant_name_document_count",
  "model_variant_name_inventory_hash",
  "model_variant_name_storage_version",
  "model_variant_name_storage_document_count",
  "model_variant_name_storage_queryable",
  "model_variant_name_storage_exact_parity",
  "provider_model_id_projection_version",
  "provider_model_id_document_count",
  "provider_model_id_inventory_hash",
  "provider_model_id_storage_version",
  "provider_model_id_storage_document_count",
  "provider_model_id_storage_queryable",
  "provider_model_id_storage_exact_parity",
  "model_slug_storage_version",
  "model_slug_artifact_digest",
  "model_slug_projection_version",
  "model_slug_model_count",
  "model_slug_mapping_count",
  "model_slug_current_mapping_count",
  "model_slug_historical_mapping_count",
  "model_slug_mapping_inventory_hash",
  "model_slug_queryable",
  "model_slug_exact_parity",
] as const;
const vectorKeys = [
  "publication_id",
  "kind",
  "vector_namespace",
  "document_count",
  "verified_document_count",
  "vector_inventory_hash",
  "visibility_probe_version",
  "mutation_id",
  "all_ids_present",
  "all_namespaces_match",
  "queryable",
] as const;
const probeKeys = [
  "publication_id",
  "kind",
  "probe_set_version",
  "integrity_passed",
  "evidence_coverage_passed",
  "exact_search_passed",
  "semantic_search_passed",
  "structured_filter_passed",
  "neutrality_passed",
  "version_isolation_passed",
  "model_slug_lookup_passed",
] as const;
const attestationKeys = [
  "publication_id",
  "environment",
  "closure_hash",
  "bundle_hash",
  "evaluator_version",
  "ready_at_ms",
  "maximum_receipt_age_ms",
  "effective_valid_until_ms",
  "archive_observed_at_ms",
  "serving_observed_at_ms",
  "vector_observed_at_ms",
  "probes_observed_at_ms",
  "archive_receipt_hash",
  "serving_receipt_hash",
  "vector_receipt_hash",
  "probes_receipt_hash",
  "attestation_hash",
] as const;
const slugProofKeys = [
  "publication_id",
  "staging_revision",
  "artifact_version",
  "acquisition_version",
  "projection_version",
  "base_bundle_hash",
  "closure_hash",
  "publication_boundary_ms",
  "artifact_digest",
  "artifact_byte_count",
  "model_count",
  "source_history_count",
  "source_history_hash",
  "mapping_count",
  "current_mapping_count",
  "historical_mapping_count",
  "mapping_inventory_hash",
] as const;
const publicationKeys = [
  "state",
  "ready_at_ms",
  "closure_hash",
  "database_now_ms",
] as const;
const summaryKeys = [
  "publication_id",
  "summary_version",
  "closure_hash",
  "source_resource_count",
  "provider_slice_count",
  "provider_slice_hash",
  "active_model_count",
  "active_offering_count",
  "active_provider_count",
  "has_stale_provider_slices",
  "has_unavailable_provider_slices",
  "summary_hash",
  "seal_closure_hash",
  "seal_resource_count",
  "seal_provider_slice_count",
  "seal_provider_slice_hash",
  "derived_active_model_count",
  "derived_active_offering_count",
  "derived_active_provider_count",
  "malformed_counted_resource_count",
  "derived_has_stale_provider_slices",
  "derived_has_unavailable_provider_slices",
] as const;
const integrityKeys = [
  "mapping_count",
  "current_count",
  "historical_count",
  "current_parity",
  "exact_index_valid",
  "current_index_valid",
  "exact_index_queryable",
  "current_index_queryable",
] as const;

const one = <Row>(rows: readonly Row[]): Row => {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined)
    throw new ReadinessCommitV5Error("integrity_failure");
  return row;
};
const values = <Row extends Readonly<Record<string, unknown>>>(
  row: Row,
  keys: readonly (keyof Row & string)[],
) => keys.map((key) => row[key]);

const validateSummary = async (
  raw: readonly unknown[],
  state: ServingReadinessCommitPersistenceV5,
): Promise<void> => {
  const row = one(
    decode<Readonly<Record<(typeof summaryKeys)[number], unknown>>>(
      raw,
      summaryKeys,
    ),
  );
  const publicSummaryKeys = summaryKeys.slice(
    0,
    12,
  ) as readonly (keyof DatasetMetadataSummaryProjection)[];
  const summary = Object.freeze(
    Object.fromEntries(publicSummaryKeys.map((key) => [key, row[key]])),
  ) as DatasetMetadataSummaryProjection;
  const serving = one(state.receiptRows.servings);
  if (
    !(await verifyDatasetMetadataSummaryHash(summary)) ||
    summary.publication_id !== state.transition.publication_id ||
    summary.closure_hash !== state.transition.closure_hash ||
    summary.source_resource_count !== serving.resource_count ||
    summary.provider_slice_count !== serving.provider_slice_count ||
    summary.provider_slice_hash !== serving.provider_slice_hash ||
    row.seal_closure_hash !== summary.closure_hash ||
    row.seal_resource_count !== summary.source_resource_count ||
    row.seal_provider_slice_count !== summary.provider_slice_count ||
    row.seal_provider_slice_hash !== summary.provider_slice_hash ||
    row.malformed_counted_resource_count !== 0 ||
    row.derived_active_model_count !== summary.active_model_count ||
    row.derived_active_offering_count !== summary.active_offering_count ||
    row.derived_active_provider_count !== summary.active_provider_count ||
    row.derived_has_stale_provider_slices !==
      summary.has_stale_provider_slices ||
    row.derived_has_unavailable_provider_slices !==
      summary.has_unavailable_provider_slices
  )
    throw new ReadinessCommitV5Error("integrity_failure");
};

const readSnapshot = async (
  database: D1Database,
  expected: ServingReadinessCommitProjectionV5,
) => {
  const state = readServingReadinessCommitPersistenceV5(expected);
  const publicationId = state.transition.publication_id;
  const session = database.withSession("first-primary");
  const raw = await session.batch([
    session.prepare(SELECT_PUBLICATION_SQL).bind(publicationId),
    session.prepare(SELECT_DATASET_METADATA_SUMMARY_SQL).bind(publicationId),
    session.prepare(SELECT_BINDINGS_SQL).bind(publicationId),
    session.prepare(SELECT_ARCHIVE_SQL).bind(publicationId),
    session.prepare(SELECT_SERVING_SQL).bind(publicationId),
    session.prepare(SELECT_VECTOR_SQL).bind(publicationId),
    session.prepare(SELECT_PROBE_SQL).bind(publicationId),
    session.prepare(SELECT_ATTESTATION_SQL).bind(publicationId),
    session.prepare(SELECT_MODEL_SLUG_PROOF_SQL).bind(publicationId),
    session.prepare(SELECT_MODEL_SLUG_INTEGRITY_SQL).bind(publicationId),
  ]);
  const batch = snapshotBatch(raw, 10);
  const maxima = [1, 1, 4, 1, 1, 1, 1, 1, 1, 1] as const;
  const captured = batch.map((result, index) =>
    snapshotResult(result, maxima[index] ?? 0),
  );
  const publication = snapshotExactDataRecord(
    one(captured[0] ?? []),
    publicationKeys,
  );
  if (
    typeof publication.state !== "string" ||
    !states.has(publication.state) ||
    publication.closure_hash !== state.transition.closure_hash ||
    typeof publication.database_now_ms !== "number" ||
    !Number.isSafeInteger(publication.database_now_ms) ||
    publication.database_now_ms < 0 ||
    (publication.ready_at_ms !== null &&
      (typeof publication.ready_at_ms !== "number" ||
        !Number.isSafeInteger(publication.ready_at_ms) ||
        publication.ready_at_ms < 0))
  )
    throw new ReadinessCommitV5Error("integrity_failure");
  await validateSummary(captured[1] ?? [], state);
  const slugProof = one(
    decode<ModelSlugArtifactProofStorageRowV5>(
      captured[8] ?? [],
      slugProofKeys,
    ),
  );
  const integrity = one(
    decode<Readonly<Record<(typeof integrityKeys)[number], unknown>>>(
      captured[9] ?? [],
      integrityKeys,
    ),
  );
  if (
    JSON.stringify(slugProof) !==
      JSON.stringify(state.modelSlugArtifactProof) ||
    integrity.mapping_count !== state.modelSlugArtifactProof.mapping_count ||
    integrity.current_count !==
      state.modelSlugArtifactProof.current_mapping_count ||
    integrity.historical_count !==
      state.modelSlugArtifactProof.historical_mapping_count ||
    integrity.current_parity !== 1 ||
    integrity.exact_index_valid !== 1 ||
    integrity.current_index_valid !== 1 ||
    integrity.exact_index_queryable !== 1 ||
    integrity.current_index_queryable !== 1
  )
    throw new ReadinessCommitV5Error("integrity_failure");
  return Object.freeze({
    publicationState: publication.state as PublicationState,
    publicationReadyAtMs: publication.ready_at_ms,
    publicationClosureHash: publication.closure_hash,
    databaseNowMs: publication.database_now_ms,
    receiptRows: Object.freeze({
      bindings: decode<ServingReadinessReceiptBindingRow>(
        captured[2] ?? [],
        bindingKeys,
      ),
      archives: decode<ServingArchiveReceiptRowV5>(
        captured[3] ?? [],
        archiveKeys,
      ),
      servings: decode<ServingReceiptRowV5>(captured[4] ?? [], servingKeys),
      vectors: decode<ServingVectorReceiptRow>(captured[5] ?? [], vectorKeys),
      probes: decode<ServingProbeReceiptRowV5>(captured[6] ?? [], probeKeys),
    }) satisfies ServingReadinessReceiptRowsV5,
    attestation:
      decode<ServingReadinessAttestationProjectionV5>(
        captured[7] ?? [],
        attestationKeys,
      )[0] ?? null,
  });
};

const classify = async (
  database: D1Database,
  expected: ServingReadinessCommitProjectionV5,
) => {
  const snapshot = await readSnapshot(database, expected);
  const state = readServingReadinessCommitPersistenceV5(expected);
  if (
    snapshot.publicationState === "building" &&
    snapshot.publicationReadyAtMs === null &&
    snapshot.attestation === null &&
    snapshot.databaseNowMs > state.attestation.effective_valid_until_ms
  )
    return Object.freeze({ outcome: "stale" as const });
  return classifyServingReadinessCommitRetryV5({ expected, ...snapshot });
};
const success = (
  expected: ServingReadinessCommitProjectionV5,
  outcome: ReadinessCommitV5Result["outcome"],
): ReadinessCommitV5Result => {
  const state = readServingReadinessCommitPersistenceV5(expected);
  return Object.freeze({
    outcome,
    publicationId: state.transition.publication_id,
    readyAtMs: state.transition.ready_at_ms,
  });
};
const throwDecision = (outcome: string): never => {
  throw new ReadinessCommitV5Error(outcome as ReadinessCommitV5ErrorCode);
};
const verifyProviderModelIdStorage = async (
  database: D1Database,
  proof: ServingReadinessCommitPersistenceV5["providerModelIdProof"],
): Promise<void> => {
  try {
    await verifyProviderModelIdSearchStorageV4(database, proof);
  } catch (error) {
    if (
      error instanceof ProviderModelIdSearchStagingError &&
      error.code === "integrity_failure"
    )
      throw new ReadinessCommitV5Error("integrity_failure");
    throw new ReadinessCommitV5Error("outcome_unknown");
  }
};
const verifyModelSlugStorage = async (
  database: D1Database,
  authority: ModelSlugLifecycleAuthorityV5,
): Promise<void> => {
  const binding = readModelSlugLifecycleOperationalBindingV5(authority);
  try {
    await verifyModelSlugServingStorage(
      database,
      binding.archiveProof,
      binding.servingProof,
    );
  } catch (error) {
    if (
      error instanceof ModelSlugHistoryStagingError &&
      (error.code === "integrity_failure" || error.code === "conflict")
    )
      throw new ReadinessCommitV5Error("integrity_failure");
    throw new ReadinessCommitV5Error("outcome_unknown");
  }
};
const preconditionValues = (state: ServingReadinessCommitPersistenceV5) => {
  const proof = state.modelSlugArtifactProof;
  return [
    state.transition.publication_id,
    state.transition.closure_hash,
    state.attestation.bundle_hash,
    state.providerSearch.documents.length,
    state.modelVariantNameSearch.documentCount,
    state.providerModelIdSearch.documentCount,
    proof.artifact_version,
    proof.acquisition_version,
    proof.projection_version,
    proof.publication_boundary_ms,
    proof.artifact_digest,
    proof.artifact_byte_count,
    proof.model_count,
    proof.source_history_count,
    proof.source_history_hash,
    proof.mapping_count,
    proof.current_mapping_count,
    proof.historical_mapping_count,
    proof.mapping_inventory_hash,
    state.attestation.effective_valid_until_ms,
  ] as const;
};

/** Fixed schema-1.13 archive-bound readiness transaction (PIPE-050-PIPE-052). */
export const applyReadinessCommitV5 = async (
  database: D1Database,
  authorityValue: unknown,
  expectedValue: unknown,
): Promise<ReadinessCommitV5Result> => {
  try {
    assertModelSlugLifecycleAuthorityV5(authorityValue);
    assertServingReadinessCommitProjectionV5(expectedValue);
  } catch {
    throw new ReadinessCommitV5Error("integrity_failure");
  }
  const expected = expectedValue;
  const state = readServingReadinessCommitPersistenceV5(expected);
  try {
    assertModelSlugLifecycleAuthorityBindingV5(
      authorityValue,
      state.modelSlugArchiveProof,
      state.modelSlugServingProof,
    );
  } catch {
    throw new ReadinessCommitV5Error("integrity_failure");
  }
  await verifyModelSlugStorage(database, authorityValue);
  let initial;
  try {
    initial = await classify(database, expected);
  } catch (error) {
    if (error instanceof ReadinessCommitV5Error) throw error;
    throw new ReadinessCommitV5Error("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success") {
    await verifyProviderModelIdStorage(database, state.providerModelIdProof);
    await verifyModelSlugStorage(database, authorityValue);
    return success(expected, "idempotent_success");
  }
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);
  await verifyProviderModelIdStorage(database, state.providerModelIdProof);
  const rows = state.receiptRows;
  if (rows.bindings.length !== 4)
    throw new ReadinessCommitV5Error("integrity_failure");
  try {
    const session = database.withSession("first-primary");
    const archive = one(rows.archives);
    const serving = one(rows.servings);
    const vector = one(rows.vectors);
    const currentSlugMapping = state.modelSlugMappings.find(
      (mapping) => mapping.resolution === "current",
    );
    const statements: D1PreparedStatement[] = [
      ...prepareProviderModelIdSearchAtomicAssertionsV4(
        session,
        state.providerModelIdProof,
      ),
      session
        .prepare(ASSERT_PRECONDITION_SQL)
        .bind(...preconditionValues(state)),
      session
        .prepare(ASSERT_SLUG_PARITY_SQL)
        .bind(
          state.transition.publication_id,
          state.modelSlugArtifactProof.mapping_count,
          state.modelSlugArtifactProof.current_mapping_count,
          state.modelSlugArtifactProof.historical_mapping_count,
        ),
      session
        .prepare(ASSERT_SLUG_INDEXES_SQL)
        .bind(
          state.transition.publication_id,
          state.modelSlugArtifactProof.current_mapping_count,
          currentSlugMapping?.slug ?? "__empty_projection__",
          currentSlugMapping?.model_id ??
            "mdl_00000000-0000-4000-8000-000000000000",
        ),
    ];
    for (const row of rows.bindings)
      statements.push(
        session.prepare(INSERT_BINDING_SQL).bind(...values(row, bindingKeys)),
      );
    statements.push(
      session.prepare(INSERT_ARCHIVE_SQL).bind(...values(archive, archiveKeys)),
      session.prepare(INSERT_SERVING_SQL).bind(...values(serving, servingKeys)),
      session.prepare(INSERT_VECTOR_SQL).bind(...values(vector, vectorKeys)),
      session
        .prepare(INSERT_PROBE_SQL)
        .bind(...values(one(rows.probes), probeKeys)),
      session
        .prepare(INSERT_ATTESTATION_SQL)
        .bind(...values(state.attestation, attestationKeys)),
      session
        .prepare(UPDATE_READY_SQL)
        .bind(
          state.transition.publication_id,
          state.transition.ready_at_ms,
          state.transition.closure_hash,
        ),
      session
        .prepare(ASSERT_POSTCONDITION_SQL)
        .bind(
          state.transition.publication_id,
          state.transition.ready_at_ms,
          state.transition.closure_hash,
          state.attestation.bundle_hash,
          state.modelSlugArtifactProof.artifact_digest,
          state.modelSlugArtifactProof.mapping_inventory_hash,
          state.attestation.attestation_hash,
          state.modelSlugArtifactProof.mapping_count,
          state.attestation.effective_valid_until_ms,
        ),
    );
    if (statements.length !== 16)
      throw new ReadinessCommitV5Error("integrity_failure");
    const raw = await session.batch(statements);
    const batch = snapshotBatch(raw, 16);
    const captured = batch.map((result) => snapshotResult(result, 1));
    const post = one(
      decode<Readonly<{ verified: number }>>(captured[15] ?? [], ["verified"]),
    );
    if (post.verified !== 1) return integrityFailure();
    const reconciled = await classify(database, expected);
    if (reconciled.outcome !== "idempotent_success")
      throw new Error("readiness v5 postcondition was not durable");
    await verifyProviderModelIdStorage(database, state.providerModelIdProof);
    await verifyModelSlugStorage(database, authorityValue);
    return success(expected, "applied");
  } catch (mutationError) {
    let reconciled;
    try {
      reconciled = await classify(database, expected);
    } catch (error) {
      if (error instanceof ReadinessCommitV5Error) throw error;
      throw new ReadinessCommitV5Error("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success") {
      await verifyProviderModelIdStorage(database, state.providerModelIdProof);
      await verifyModelSlugStorage(database, authorityValue);
      return success(expected, "idempotent_success");
    }
    if (
      mutationError instanceof ReadinessCommitV5Error &&
      mutationError.code === "integrity_failure"
    )
      throw mutationError;
    await verifyProviderModelIdStorage(database, state.providerModelIdProof);
    if (reconciled.outcome === "execute")
      throw new ReadinessCommitV5Error("not_applied");
    return throwDecision(reconciled.outcome);
  }
};
