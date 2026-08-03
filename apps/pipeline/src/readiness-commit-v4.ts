import {
  assertServingReadinessCommitProjectionV4,
  classifyServingReadinessCommitRetryV4,
  readServingReadinessCommitPersistenceV4,
  verifyDatasetMetadataSummaryHash,
  type DatasetMetadataSummaryProjection,
  type PublicationState,
  type ServingArchiveReceiptRow,
  type ServingProbeReceiptRow,
  type ServingReadinessAttestationProjectionV4,
  type ServingReadinessCommitProjectionV4,
  type ServingReadinessCommitPersistenceV4,
  type ServingReadinessReceiptBindingRow,
  type ServingReadinessReceiptRowsV4,
  type ServingReceiptRowV4,
  type ServingVectorReceiptRow,
} from "@quant-clarity/publication-core";

import {
  ProviderModelIdSearchStagingError,
  prepareProviderModelIdSearchAtomicAssertionsV4,
  verifyProviderModelIdSearchStorageV4,
} from "./provider-model-id-search-staging.js";

const SELECT_PUBLICATION_SQL = `SELECT
  candidate.state, candidate.ready_at_ms, candidate.closure_hash,
  seal.closure_hash AS seal_closure_hash, seal.bundle_hash AS seal_bundle_hash,
  (SELECT count(*) FROM publication_provider_search_document
   WHERE publication_id = candidate.publication_id) AS provider_search_document_count,
  (SELECT count(*) FROM publication_provider_search_fts
   WHERE publication_id = candidate.publication_id) AS provider_search_fts_document_count,
  (SELECT count(*) FROM publication_model_variant_name_search_document
   WHERE publication_id = candidate.publication_id) AS model_variant_name_storage_document_count,
  (SELECT count(*) FROM publication_provider_model_id_search_document
   WHERE publication_id = candidate.publication_id) AS provider_model_id_storage_document_count
FROM publication AS candidate
LEFT JOIN publication_closure_seal AS seal USING (publication_id)
WHERE candidate.publication_id = ?1`;
const SELECT_BINDINGS_SQL = `SELECT publication_id, kind, receipt_version,
  receipt_hash, environment, closure_hash, bundle_hash, schema_version,
  build_commit, observed_at_ms
FROM publication_readiness_receipt WHERE publication_id = ?1 ORDER BY kind`;
const SELECT_ARCHIVE_SQL = `SELECT publication_id, kind, retained_bundle_hash,
  immutable FROM publication_archive_receipt WHERE publication_id = ?1`;
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
  provider_model_id_storage_exact_parity
FROM publication_serving_receipt WHERE publication_id = ?1`;
const SELECT_VECTOR_SQL = `SELECT publication_id, kind, vector_namespace,
  document_count, verified_document_count, vector_inventory_hash,
  visibility_probe_version, mutation_id, all_ids_present,
  all_namespaces_match, queryable
FROM publication_vector_receipt WHERE publication_id = ?1`;
const SELECT_PROBE_SQL = `SELECT publication_id, kind, probe_set_version,
  integrity_passed, evidence_coverage_passed, exact_search_passed,
  semantic_search_passed, structured_filter_passed, neutrality_passed,
  version_isolation_passed
FROM publication_probe_receipt WHERE publication_id = ?1`;
const SELECT_ATTESTATION_SQL = `SELECT publication_id, environment,
  closure_hash, bundle_hash, evaluator_version, ready_at_ms,
  maximum_receipt_age_ms, effective_valid_until_ms, archive_observed_at_ms,
  serving_observed_at_ms, vector_observed_at_ms, probes_observed_at_ms,
  archive_receipt_hash, serving_receipt_hash, vector_receipt_hash,
  probes_receipt_hash, attestation_hash
FROM publication_readiness_attestation WHERE publication_id = ?1`;

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
    coalesce(sum(CASE WHEN resource_type IN ('model', 'offering', 'provider') AND (
      json_type(resource_json, '$.status') IS NOT 'object' OR
      json_type(resource_json, '$.status.state') IS NOT 'text' OR
      COALESCE(json_extract(resource_json, '$.status.state'), '__missing__') NOT IN
        ('known', 'unknown', 'not_applicable', 'unavailable') OR
      (json_extract(resource_json, '$.status.state') = 'known' AND
        json_type(resource_json, '$.status.value') IS NOT 'text') OR
      (json_extract(resource_json, '$.status.state') IS NOT 'known' AND
        json_type(resource_json, '$.status.value') IS NOT 'null') OR
      (resource_type = 'model' AND
        json_extract(resource_json, '$.model_id') IS NOT resource_id) OR
      (resource_type = 'offering' AND (
        json_extract(resource_json, '$.offering_id') IS NOT resource_id OR
        (json_type(resource_json, '$.stale') IS NOT 'true' AND
          json_type(resource_json, '$.stale') IS NOT 'false')
      )) OR
      (resource_type = 'provider' AND
        json_extract(resource_json, '$.provider_id') IS NOT resource_id)
    ) THEN 1 ELSE 0 END), 0) AS malformed_counted_resource_count
  FROM publication_resource WHERE publication_id = ?1
)
SELECT summary.publication_id, summary.summary_version,
  summary.closure_hash, summary.source_resource_count,
  summary.provider_slice_count, summary.provider_slice_hash,
  summary.active_model_count, summary.active_offering_count,
  summary.active_provider_count, summary.has_stale_provider_slices,
  summary.has_unavailable_provider_slices, summary.summary_hash,
  seal.closure_hash AS seal_closure_hash,
  seal.resource_count AS seal_resource_count,
  seal.provider_slice_count AS seal_provider_slice_count,
  seal.provider_slice_hash AS seal_provider_slice_hash,
  aggregate_counts.derived_active_model_count,
  aggregate_counts.derived_active_offering_count,
  aggregate_counts.derived_active_provider_count,
  aggregate_counts.malformed_counted_resource_count,
  EXISTS (SELECT 1 FROM publication_provider_slice
    WHERE publication_id = ?1 AND freshness_state = 'stale')
      AS derived_has_stale_provider_slices,
  EXISTS (SELECT 1 FROM publication_provider_slice
    WHERE publication_id = ?1 AND freshness_state = 'unavailable')
      AS derived_has_unavailable_provider_slices
FROM publication_dataset_metadata_summary AS summary
JOIN publication_closure_seal AS seal USING (publication_id)
CROSS JOIN aggregate_counts
WHERE summary.publication_id = ?1`;

const PROVIDER_PARITY_SQL = `
    AND (SELECT count(*) FROM publication_provider_search_document
         WHERE publication_id = ?1) = ?4
    AND (SELECT count(*) FROM publication_provider_search_fts
         WHERE publication_id = ?1) = ?4
    AND NOT EXISTS (
      SELECT 1 FROM publication_provider_search_document AS source
      WHERE source.publication_id = ?1 AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_fts AS indexed
        WHERE indexed.publication_id = source.publication_id
          AND indexed.provider_id = source.provider_id
          AND indexed.display_name = source.display_name
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM publication_provider_search_fts AS indexed
      WHERE indexed.publication_id = ?1 AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_document AS source
        WHERE source.publication_id = indexed.publication_id
          AND source.provider_id = indexed.provider_id
          AND source.display_name = indexed.display_name
      )
    )`;

const ASSERT_PRECONDITION_SQL = `SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication AS candidate
  JOIN publication_closure_seal AS seal USING (publication_id)
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building' AND candidate.ready_at_ms IS NULL
    AND candidate.closure_hash = ?2 AND seal.closure_hash = ?2
    AND seal.bundle_hash = ?3
    AND NOT EXISTS (SELECT 1 FROM publication_readiness_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_archive_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_serving_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_vector_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_probe_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_readiness_attestation WHERE publication_id = ?1)
    ${PROVIDER_PARITY_SQL}
    AND (SELECT count(*) FROM publication_model_variant_name_search_document
         WHERE publication_id = ?1) = ?5
    AND (SELECT count(*) FROM publication_provider_model_id_search_document
         WHERE publication_id = ?1) = ?6
) THEN 1 ELSE json('') END AS clean`;

const INSERT_BINDING_SQL = `INSERT INTO publication_readiness_receipt (
  publication_id, kind, receipt_version, receipt_hash, environment,
  closure_hash, bundle_hash, schema_version, build_commit, observed_at_ms
) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`;
const INSERT_ARCHIVE_SQL = `INSERT INTO publication_archive_receipt (
  publication_id, kind, retained_bundle_hash, immutable
) VALUES (?1,?2,?3,?4)`;
const INSERT_SERVING_SQL = `INSERT INTO publication_serving_receipt (
  publication_id, kind, enabled_provider_count, enabled_provider_scope_hash,
  provider_slice_count, provider_slice_hash, provider_attribution_count,
  provider_attribution_hash, resource_count, exact_document_count,
  resource_inventory_hash, exact_search_inventory_hash, fts_build_version,
  fts_document_count, fts_queryable, foreign_keys_valid, content_hashes_valid,
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
  provider_model_id_storage_exact_parity
) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,
  ?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,
  ?33,?34,?35,?36,?37,?38,?39)`;
const INSERT_VECTOR_SQL = `INSERT INTO publication_vector_receipt (
  publication_id, kind, vector_namespace, document_count,
  verified_document_count, vector_inventory_hash, visibility_probe_version,
  mutation_id, all_ids_present, all_namespaces_match, queryable
) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`;
const INSERT_PROBE_SQL = `INSERT INTO publication_probe_receipt (
  publication_id, kind, probe_set_version, integrity_passed,
  evidence_coverage_passed, exact_search_passed, semantic_search_passed,
  structured_filter_passed, neutrality_passed, version_isolation_passed
) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`;
const INSERT_ATTESTATION_SQL = `INSERT INTO publication_readiness_attestation (
  publication_id, environment, closure_hash, bundle_hash, evaluator_version,
  ready_at_ms, maximum_receipt_age_ms, effective_valid_until_ms,
  archive_observed_at_ms, serving_observed_at_ms, vector_observed_at_ms,
  probes_observed_at_ms, archive_receipt_hash, serving_receipt_hash,
  vector_receipt_hash, probes_receipt_hash, attestation_hash
) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`;
const UPDATE_READY_SQL = `UPDATE publication SET state = 'ready', ready_at_ms = ?2
WHERE publication_id = ?1 AND state = 'building' AND ready_at_ms IS NULL
  AND closure_hash = ?3`;
const ASSERT_POSTCONDITION_SQL = `SELECT CASE WHEN
  changes() = 1
  AND EXISTS (
    SELECT 1 FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    JOIN publication_serving_receipt AS serving USING (publication_id)
    JOIN publication_vector_receipt AS vectors USING (publication_id)
    JOIN publication_readiness_attestation AS attestation USING (publication_id)
    WHERE candidate.publication_id = ?1 AND candidate.state = 'ready'
      AND candidate.ready_at_ms = ?2 AND candidate.closure_hash = ?3
      AND seal.closure_hash = ?3 AND seal.bundle_hash = ?4
      AND serving.provider_search_projection_version = ?5
      AND serving.provider_search_document_count = ?6
      AND serving.provider_search_inventory_hash = ?7
      AND serving.provider_search_fts_build_version = ?8
      AND serving.provider_search_fts_document_count = ?6
      AND serving.provider_search_fts_queryable = 1
      AND serving.provider_search_exact_parity = 1
      AND serving.model_variant_name_projection_version = ?9
      AND serving.model_variant_name_document_count = ?10
      AND serving.model_variant_name_inventory_hash = ?11
      AND serving.model_variant_name_storage_version = ?12
      AND serving.model_variant_name_storage_document_count = ?10
      AND serving.model_variant_name_storage_queryable = 1
      AND serving.model_variant_name_storage_exact_parity = 1
      AND serving.provider_model_id_projection_version = ?13
      AND serving.provider_model_id_document_count = ?14
      AND serving.provider_model_id_inventory_hash = ?15
      AND serving.provider_model_id_storage_version = ?16
      AND serving.provider_model_id_storage_document_count = ?14
      AND serving.provider_model_id_storage_queryable = 1
      AND serving.provider_model_id_storage_exact_parity = 1
      AND vectors.mutation_id = ?18
      AND attestation.attestation_hash = ?17
  )
  AND (SELECT count(*) FROM publication_readiness_receipt
       WHERE publication_id = ?1 AND receipt_version = '4.0.0') = 4
  AND (SELECT count(*) FROM publication_provider_search_document
       WHERE publication_id = ?1) = ?6
  AND (SELECT count(*) FROM publication_provider_search_fts
       WHERE publication_id = ?1) = ?6
  AND (SELECT count(*) FROM publication_model_variant_name_search_document
       WHERE publication_id = ?1) = ?10
  AND (SELECT count(*) FROM publication_provider_model_id_search_document
       WHERE publication_id = ?1) = ?14
  AND NOT EXISTS (
    SELECT 1 FROM publication_provider_search_document AS source
    WHERE source.publication_id = ?1 AND NOT EXISTS (
      SELECT 1 FROM publication_provider_search_fts AS indexed
      WHERE indexed.publication_id = source.publication_id
        AND indexed.provider_id = source.provider_id
        AND indexed.display_name = source.display_name
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM publication_provider_search_fts AS indexed
    WHERE indexed.publication_id = ?1 AND NOT EXISTS (
      SELECT 1 FROM publication_provider_search_document AS source
      WHERE source.publication_id = indexed.publication_id
        AND source.provider_id = indexed.provider_id
        AND source.display_name = indexed.display_name
    )
  )
THEN 1 ELSE json('') END AS verified`;

export type ReadinessCommitV4ErrorCode =
  | "stale"
  | "conflict"
  | "integrity_failure"
  | "not_applied"
  | "outcome_unknown";
export class ReadinessCommitV4Error extends Error {
  readonly code: ReadinessCommitV4ErrorCode;
  readonly retrySameProjection: boolean;
  constructor(code: ReadinessCommitV4ErrorCode) {
    super("The schema-1.7 readiness commit could not be applied safely.");
    this.name = "ReadinessCommitV4Error";
    this.code = code;
    this.retrySameProjection = code === "not_applied";
  }
}
export type ReadinessCommitV4Result = Readonly<{
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
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (row: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(row).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < actual.length; index += 1)
    if (actual[index] !== expected[index]) return false;
  return true;
};

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

const snapshotBatch = (value: unknown, count: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length !== count)
    throw new ReadinessCommitV4Error("integrity_failure");
  const result = new Array<unknown>(count);
  for (let index = 0; index < count; index += 1) result[index] = value[index];
  return Object.freeze(result);
};

const snapshotResult = (
  value: unknown,
  maximum: number,
): readonly unknown[] => {
  if (!isRecord(value)) throw new ReadinessCommitV4Error("integrity_failure");
  const success: unknown = value.success;
  const untrustedRows: unknown = value.results;
  if (success !== true || !Array.isArray(untrustedRows))
    throw new ReadinessCommitV4Error("integrity_failure");
  const rowCount = untrustedRows.length;
  if (!Number.isSafeInteger(rowCount) || rowCount > maximum)
    throw new ReadinessCommitV4Error("integrity_failure");
  const rows = new Array<unknown>(rowCount);
  for (let index = 0; index < rowCount; index += 1)
    rows[index] = untrustedRows[index];
  return Object.freeze(rows);
};

const flagKeys = new Set<string>([
  "immutable",
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
]);
const hashKeys = new Set<string>([
  "receipt_hash",
  "closure_hash",
  "bundle_hash",
  "retained_bundle_hash",
  "enabled_provider_scope_hash",
  "provider_slice_hash",
  "provider_attribution_hash",
  "resource_inventory_hash",
  "exact_search_inventory_hash",
  "provider_search_inventory_hash",
  "model_variant_name_inventory_hash",
  "provider_model_id_inventory_hash",
  "vector_inventory_hash",
  "archive_receipt_hash",
  "serving_receipt_hash",
  "vector_receipt_hash",
  "probes_receipt_hash",
  "attestation_hash",
  "summary_hash",
]);
const HASH = /^sha256:[0-9a-f]{64}$/u;

const validScalar = (key: string, value: unknown): boolean => {
  if (typeof value === "number")
    return (
      Number.isSafeInteger(value) &&
      value >= 0 &&
      (!flagKeys.has(key) || value <= 1)
    );
  if (typeof value !== "string" || value.length === 0 || value.length > 128)
    return false;
  return !hashKeys.has(key) || HASH.test(value);
};

const decode = <Row extends Readonly<Record<string, unknown>>>(
  untrustedRows: readonly unknown[],
  keys: readonly (keyof Row & string)[],
): readonly Row[] => {
  const rows = new Array<Row>(untrustedRows.length);
  for (let index = 0; index < untrustedRows.length; index += 1) {
    const row = untrustedRows[index];
    if (!isRecord(row) || !exactKeys(row, keys))
      throw new ReadinessCommitV4Error("integrity_failure");
    const detached: Record<string, unknown> = {};
    for (const key of keys) {
      const value: unknown = row[key];
      if (!validScalar(key, value))
        throw new ReadinessCommitV4Error("integrity_failure");
      detached[key] = value;
    }
    rows[index] = Object.freeze(detached) as Row;
  }
  return Object.freeze(rows);
};

const readSnapshot = async (
  database: D1Database,
  expected: ServingReadinessCommitProjectionV4,
) => {
  const persistence = readServingReadinessCommitPersistenceV4(expected);
  const publicationId = persistence.transition.publication_id;
  const session = database.withSession("first-primary");
  const untrusted = await session.batch([
    session.prepare(SELECT_PUBLICATION_SQL).bind(publicationId),
    session.prepare(SELECT_DATASET_METADATA_SUMMARY_SQL).bind(publicationId),
    session.prepare(SELECT_BINDINGS_SQL).bind(publicationId),
    session.prepare(SELECT_ARCHIVE_SQL).bind(publicationId),
    session.prepare(SELECT_SERVING_SQL).bind(publicationId),
    session.prepare(SELECT_VECTOR_SQL).bind(publicationId),
    session.prepare(SELECT_PROBE_SQL).bind(publicationId),
    session.prepare(SELECT_ATTESTATION_SQL).bind(publicationId),
  ]);
  const results = snapshotBatch(untrusted, 8);
  const captured = new Array<readonly unknown[]>(8);
  const maxima = [1, 1, 4, 1, 1, 1, 1, 1] as const;
  for (let index = 0; index < results.length; index += 1)
    captured[index] = snapshotResult(results[index], maxima[index] ?? 0);
  const publication = captured[0];
  const row = publication?.[0];
  if (
    publication?.length !== 1 ||
    !isRecord(row) ||
    !exactKeys(row, [
      "state",
      "ready_at_ms",
      "closure_hash",
      "seal_closure_hash",
      "seal_bundle_hash",
      "provider_search_document_count",
      "provider_search_fts_document_count",
      "model_variant_name_storage_document_count",
      "provider_model_id_storage_document_count",
    ])
  )
    throw new ReadinessCommitV4Error("integrity_failure");
  const state: unknown = row.state;
  const readyAtMs: unknown = row.ready_at_ms;
  const closureHash: unknown = row.closure_hash;
  const sealClosureHash: unknown = row.seal_closure_hash;
  const sealBundleHash: unknown = row.seal_bundle_hash;
  const providerSearchDocumentCount: unknown =
    row.provider_search_document_count;
  const providerSearchFtsDocumentCount: unknown =
    row.provider_search_fts_document_count;
  const modelVariantNameStorageDocumentCount: unknown =
    row.model_variant_name_storage_document_count;
  const providerModelIdStorageDocumentCount: unknown =
    row.provider_model_id_storage_document_count;
  if (
    typeof state !== "string" ||
    !states.has(state) ||
    (readyAtMs !== null &&
      (typeof readyAtMs !== "number" ||
        !Number.isSafeInteger(readyAtMs) ||
        readyAtMs < 0)) ||
    closureHash !== persistence.transition.closure_hash ||
    sealClosureHash !== persistence.transition.closure_hash ||
    sealBundleHash !== persistence.attestation.bundle_hash ||
    providerSearchDocumentCount !==
      persistence.providerSearch.documents.length ||
    providerSearchFtsDocumentCount !==
      persistence.providerSearch.documents.length ||
    modelVariantNameStorageDocumentCount !==
      persistence.modelVariantNameSearch.documentCount ||
    providerModelIdStorageDocumentCount !==
      persistence.providerModelIdSearch.documentCount
  )
    throw new ReadinessCommitV4Error("integrity_failure");

  const summaryRows = captured[1] ?? [];
  const summaryRow = summaryRows[0];
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
  if (
    summaryRows.length !== 1 ||
    !isRecord(summaryRow) ||
    !exactKeys(summaryRow, summaryKeys)
  )
    throw new ReadinessCommitV4Error("integrity_failure");
  for (const key of summaryKeys)
    if (!validScalar(key, summaryRow[key]))
      throw new ReadinessCommitV4Error("integrity_failure");
  const summary = Object.freeze({
    publication_id: summaryRow.publication_id,
    summary_version: summaryRow.summary_version,
    closure_hash: summaryRow.closure_hash,
    source_resource_count: summaryRow.source_resource_count,
    provider_slice_count: summaryRow.provider_slice_count,
    provider_slice_hash: summaryRow.provider_slice_hash,
    active_model_count: summaryRow.active_model_count,
    active_offering_count: summaryRow.active_offering_count,
    active_provider_count: summaryRow.active_provider_count,
    has_stale_provider_slices: summaryRow.has_stale_provider_slices,
    has_unavailable_provider_slices: summaryRow.has_unavailable_provider_slices,
    summary_hash: summaryRow.summary_hash,
  }) as DatasetMetadataSummaryProjection;
  const expectedServing = persistence.receiptRows.servings[0];
  if (
    expectedServing === undefined ||
    !(await verifyDatasetMetadataSummaryHash(summary)) ||
    summary.publication_id !== publicationId ||
    summary.closure_hash !== persistence.transition.closure_hash ||
    summary.source_resource_count !== expectedServing.resource_count ||
    summary.provider_slice_count !== expectedServing.provider_slice_count ||
    summary.provider_slice_hash !== expectedServing.provider_slice_hash ||
    summaryRow.seal_closure_hash !== summary.closure_hash ||
    summaryRow.seal_resource_count !== summary.source_resource_count ||
    summaryRow.seal_provider_slice_count !== summary.provider_slice_count ||
    summaryRow.seal_provider_slice_hash !== summary.provider_slice_hash ||
    summaryRow.malformed_counted_resource_count !== 0 ||
    summaryRow.derived_active_model_count !== summary.active_model_count ||
    summaryRow.derived_active_offering_count !==
      summary.active_offering_count ||
    summaryRow.derived_active_provider_count !==
      summary.active_provider_count ||
    summaryRow.derived_has_stale_provider_slices !==
      summary.has_stale_provider_slices ||
    summaryRow.derived_has_unavailable_provider_slices !==
      summary.has_unavailable_provider_slices
  )
    throw new ReadinessCommitV4Error("integrity_failure");
  return Object.freeze({
    publicationState: state as PublicationState,
    publicationReadyAtMs: readyAtMs,
    publicationClosureHash: closureHash,
    receiptRows: Object.freeze({
      bindings: decode<ServingReadinessReceiptBindingRow>(
        captured[2] ?? [],
        bindingKeys,
      ),
      archives: decode<ServingArchiveReceiptRow>(
        captured[3] ?? [],
        archiveKeys,
      ),
      servings: decode<ServingReceiptRowV4>(captured[4] ?? [], servingKeys),
      vectors: decode<ServingVectorReceiptRow>(captured[5] ?? [], vectorKeys),
      probes: decode<ServingProbeReceiptRow>(captured[6] ?? [], probeKeys),
    }) satisfies ServingReadinessReceiptRowsV4,
    attestation:
      decode<ServingReadinessAttestationProjectionV4>(
        captured[7] ?? [],
        attestationKeys,
      )[0] ?? null,
  });
};

const values = <Row extends Readonly<Record<string, unknown>>>(
  row: Row,
  keys: readonly (keyof Row & string)[],
): readonly unknown[] => {
  const result = new Array<unknown>(keys.length);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined)
      throw new ReadinessCommitV4Error("integrity_failure");
    result[index] = row[key];
  }
  return result;
};
const one = <Row>(rows: readonly Row[]): Row => {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined)
    throw new ReadinessCommitV4Error("integrity_failure");
  return row;
};
const classify = async (
  database: D1Database,
  expected: ServingReadinessCommitProjectionV4,
) =>
  classifyServingReadinessCommitRetryV4({
    expected,
    ...(await readSnapshot(database, expected)),
  });
const success = (
  expected: ServingReadinessCommitProjectionV4,
  outcome: ReadinessCommitV4Result["outcome"],
): ReadinessCommitV4Result => {
  const state = readServingReadinessCommitPersistenceV4(expected);
  return Object.freeze({
    outcome,
    publicationId: state.transition.publication_id,
    readyAtMs: state.transition.ready_at_ms,
  });
};
const throwDecision = (outcome: string): never => {
  throw new ReadinessCommitV4Error(outcome as ReadinessCommitV4ErrorCode);
};

const verifyProviderModelIdStorage = async (
  database: D1Database,
  proof: ServingReadinessCommitPersistenceV4["providerModelIdProof"],
): Promise<void> => {
  try {
    await verifyProviderModelIdSearchStorageV4(database, proof);
  } catch (error) {
    if (
      error instanceof ProviderModelIdSearchStagingError &&
      error.code === "integrity_failure"
    )
      throw new ReadinessCommitV4Error("integrity_failure");
    throw new ReadinessCommitV4Error("outcome_unknown");
  }
};

/** Fixed schema-1.7 cumulative-search readiness transaction (PIPE-050-PIPE-052). */
export const applyReadinessCommitV4 = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ReadinessCommitV4Result> => {
  try {
    assertServingReadinessCommitProjectionV4(expectedValue);
  } catch {
    throw new ReadinessCommitV4Error("integrity_failure");
  }
  const expected = expectedValue;
  const state = readServingReadinessCommitPersistenceV4(expected);
  let initial;
  try {
    initial = await classify(database, expected);
  } catch (error) {
    if (error instanceof ReadinessCommitV4Error) throw error;
    throw new ReadinessCommitV4Error("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success") {
    await verifyProviderModelIdStorage(database, state.providerModelIdProof);
    return success(expected, "idempotent_success");
  }
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);
  await verifyProviderModelIdStorage(database, state.providerModelIdProof);
  const rows = state.receiptRows;
  if (rows.bindings.length !== 4)
    throw new ReadinessCommitV4Error("integrity_failure");
  try {
    const session = database.withSession("first-primary");
    const serving = one(rows.servings);
    const vector = one(rows.vectors);
    const statements: D1PreparedStatement[] = [
      ...prepareProviderModelIdSearchAtomicAssertionsV4(
        session,
        state.providerModelIdProof,
      ),
      session
        .prepare(ASSERT_PRECONDITION_SQL)
        .bind(
          state.transition.publication_id,
          state.transition.closure_hash,
          state.attestation.bundle_hash,
          state.providerSearch.documents.length,
          state.modelVariantNameSearch.documentCount,
          state.providerModelIdSearch.documentCount,
        ),
    ];
    for (const row of rows.bindings)
      statements.push(
        session.prepare(INSERT_BINDING_SQL).bind(...values(row, bindingKeys)),
      );
    statements.push(
      session
        .prepare(INSERT_ARCHIVE_SQL)
        .bind(...values(one(rows.archives), archiveKeys)),
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
          serving.provider_search_projection_version,
          serving.provider_search_document_count,
          serving.provider_search_inventory_hash,
          serving.provider_search_fts_build_version,
          serving.model_variant_name_projection_version,
          serving.model_variant_name_document_count,
          serving.model_variant_name_inventory_hash,
          serving.model_variant_name_storage_version,
          serving.provider_model_id_projection_version,
          serving.provider_model_id_document_count,
          serving.provider_model_id_inventory_hash,
          serving.provider_model_id_storage_version,
          state.attestation.attestation_hash,
          vector.mutation_id,
        ),
    );
    const untrusted = await session.batch(statements);
    const batch = snapshotBatch(untrusted, 14);
    const captured = new Array<readonly unknown[]>(batch.length);
    for (let index = 0; index < batch.length; index += 1)
      captured[index] = snapshotResult(batch[index], 1);
    const post = captured[13]?.[0];
    if (!isRecord(post) || post.verified !== 1)
      throw new Error("ambiguous D1 postcondition result");
    const reconciled = await classify(database, expected);
    if (reconciled.outcome !== "idempotent_success")
      throw new Error("readiness v4 postcondition was not durable");
    await verifyProviderModelIdStorage(database, state.providerModelIdProof);
    return success(expected, "applied");
  } catch {
    let reconciled;
    try {
      reconciled = await classify(database, expected);
    } catch (error) {
      if (error instanceof ReadinessCommitV4Error) throw error;
      throw new ReadinessCommitV4Error("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success") {
      await verifyProviderModelIdStorage(database, state.providerModelIdProof);
      return success(expected, "idempotent_success");
    }
    await verifyProviderModelIdStorage(database, state.providerModelIdProof);
    if (reconciled.outcome === "execute")
      throw new ReadinessCommitV4Error("not_applied");
    return throwDecision(reconciled.outcome);
  }
};
