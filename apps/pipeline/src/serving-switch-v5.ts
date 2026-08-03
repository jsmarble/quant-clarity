import {
  assertServingSwitchProjectionV5,
  classifyServingSwitchRetryV5,
  readServingSwitchPersistenceV5,
  type PublicationState,
  type ServingSwitchHistoryRow,
  type ServingSwitchPersistenceV5,
  type ServingSwitchPreflightProofV5,
  type ServingSwitchProjectionV5,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

import {
  assertModelSlugLifecycleAuthorityBindingV5,
  assertModelSlugLifecycleAuthorityV5,
  readModelSlugLifecycleOperationalBindingV5,
  type ModelSlugLifecycleAuthorityV5,
} from "./model-slug-lifecycle-authority.js";
import {
  assertFreshModelSlugRollbackProof,
  readFreshModelSlugRollbackProof,
} from "./model-slug-history-archive.js";
import { admitModelDetailPublication } from "./model-detail-admission.js";
import {
  ProviderModelIdSearchStagingError,
  prepareProviderModelIdSearchAtomicAssertionsV4,
  verifyProviderModelIdSearchStorageV4,
} from "./provider-model-id-search-staging.js";
import {
  ServingSwitchError,
  type ServingSwitchErrorCode,
  type ServingSwitchResult,
} from "./serving-switch.js";

const SELECT_HEAD_SQL = `SELECT active_publication_id,
  rollback_candidate_publication_id, switched_at_ms, generation
FROM publication_head WHERE singleton = 1`;

const PREFLIGHT_COLUMNS = [
  ["switch_id", "switch_id"],
  ["preflight_version", "preflight_version"],
  ["preflight_hash", "preflight_hash"],
  ["action", "action"],
  ["environment", "environment"],
  ["expected_prior_generation", "expected_prior_generation"],
  [
    "expected_prior_rollback_candidate_publication_id",
    "expected_prior_rollback_candidate_publication_id",
  ],
  ["expected_prior_switched_at_ms", "expected_prior_switched_at_ms"],
  ["new_generation", "new_generation"],
  ["from_publication_id", "from_publication_id"],
  ["from_closure_hash", "from_closure_hash"],
  ["to_publication_id", "to_publication_id"],
  ["to_closure_hash", "to_closure_hash"],
  ["to_attestation_hash", "to_attestation_hash"],
  ["switched_at_ms", "switched_at_ms"],
  ["observed_at_ms", "observed_at_ms"],
  ["maximum_age_ms", "maximum_age_ms"],
  ["valid_until_ms", "valid_until_ms"],
  ["fts_build_version", "fts_build_version"],
  ["fts_source_document_count", "fts_source_document_count"],
  ["fts_index_document_count", "fts_index_document_count"],
  ["fts_source_inventory_hash", "fts_source_inventory_hash"],
  ["fts_exact_parity", "fts_exact_parity"],
  ["archive_bundle_hash", "archive_bundle_hash"],
  ["archive_model_slug_artifact_version", "model_slug_artifact_version"],
  ["archive_model_slug_acquisition_version", "model_slug_acquisition_version"],
  ["archive_model_slug_projection_version", "model_slug_projection_version"],
  ["archive_model_slug_artifact_digest", "model_slug_artifact_digest"],
  ["archive_model_slug_artifact_byte_count", "model_slug_artifact_byte_count"],
  [
    "archive_model_slug_source_history_count",
    "model_slug_source_history_count",
  ],
  ["archive_model_slug_source_history_hash", "model_slug_source_history_hash"],
  ["archive_model_slug_model_count", "model_slug_model_count"],
  ["archive_model_slug_mapping_count", "model_slug_mapping_count"],
  [
    "archive_model_slug_current_mapping_count",
    "model_slug_current_mapping_count",
  ],
  [
    "archive_model_slug_historical_mapping_count",
    "model_slug_historical_mapping_count",
  ],
  [
    "archive_model_slug_mapping_inventory_hash",
    "model_slug_mapping_inventory_hash",
  ],
  ["archive_model_slug_read_verified", "model_slug_read_verified"],
  ["archive_model_slug_immutable", "model_slug_immutable"],
  ["archive_immutable", "archive_immutable"],
  ["archive_receipt_hash", "archive_receipt_hash"],
  ["serving_model_slug_storage_version", "model_slug_storage_version"],
  ["serving_model_slug_artifact_digest", "model_slug_serving_artifact_digest"],
  [
    "serving_model_slug_projection_version",
    "model_slug_serving_projection_version",
  ],
  ["serving_model_slug_model_count", "model_slug_serving_model_count"],
  ["serving_model_slug_mapping_count", "model_slug_serving_mapping_count"],
  [
    "serving_model_slug_current_mapping_count",
    "model_slug_serving_current_mapping_count",
  ],
  [
    "serving_model_slug_historical_mapping_count",
    "model_slug_serving_historical_mapping_count",
  ],
  [
    "serving_model_slug_mapping_inventory_hash",
    "model_slug_serving_mapping_inventory_hash",
  ],
  ["serving_model_slug_queryable", "model_slug_queryable"],
  ["serving_model_slug_exact_parity", "model_slug_exact_parity"],
  ["vector_namespace", "vector_namespace"],
  ["vector_document_count", "vector_document_count"],
  ["vector_verified_document_count", "vector_verified_document_count"],
  ["vector_inventory_hash", "vector_inventory_hash"],
  ["vector_visibility_probe_version", "vector_visibility_probe_version"],
  ["vector_mutation_id", "vector_mutation_id"],
  ["vector_all_ids_present", "vector_all_ids_present"],
  ["vector_all_namespaces_match", "vector_all_namespaces_match"],
  ["vector_queryable", "vector_queryable"],
  ["probe_set_version", "probe_set_version"],
  ["integrity_passed", "integrity_passed"],
  ["exact_search_passed", "exact_search_passed"],
  ["semantic_search_passed", "semantic_search_passed"],
  ["structured_filter_passed", "structured_filter_passed"],
  ["neutrality_passed", "neutrality_passed"],
  ["version_isolation_passed", "version_isolation_passed"],
  ["model_slug_lookup_passed", "model_slug_lookup_passed"],
  ["provider_search_projection_version", "provider_search_projection_version"],
  ["provider_search_document_count", "provider_search_document_count"],
  ["provider_search_inventory_hash", "provider_search_inventory_hash"],
  ["provider_search_fts_build_version", "provider_search_fts_build_version"],
  ["provider_search_fts_document_count", "provider_search_fts_document_count"],
  ["provider_search_fts_queryable", "provider_search_fts_queryable"],
  ["provider_search_exact_parity", "provider_search_exact_parity"],
  [
    "model_variant_name_projection_version",
    "model_variant_name_projection_version",
  ],
  ["model_variant_name_document_count", "model_variant_name_document_count"],
  ["model_variant_name_inventory_hash", "model_variant_name_inventory_hash"],
  ["model_variant_name_storage_version", "model_variant_name_storage_version"],
  [
    "model_variant_name_storage_document_count",
    "model_variant_name_storage_document_count",
  ],
  [
    "model_variant_name_storage_queryable",
    "model_variant_name_storage_queryable",
  ],
  [
    "model_variant_name_storage_exact_parity",
    "model_variant_name_storage_exact_parity",
  ],
  [
    "provider_model_id_projection_version",
    "provider_model_id_projection_version",
  ],
  ["provider_model_id_document_count", "provider_model_id_document_count"],
  ["provider_model_id_inventory_hash", "provider_model_id_inventory_hash"],
  ["provider_model_id_storage_version", "provider_model_id_storage_version"],
  [
    "provider_model_id_storage_document_count",
    "provider_model_id_storage_document_count",
  ],
  [
    "provider_model_id_storage_queryable",
    "provider_model_id_storage_queryable",
  ],
  [
    "provider_model_id_storage_exact_parity",
    "provider_model_id_storage_exact_parity",
  ],
] as const satisfies readonly (readonly [
  string,
  keyof ServingSwitchPreflightProofV5,
])[];

const PREFLIGHT_KEYS = PREFLIGHT_COLUMNS.map(([, property]) => property);
const SELECT_PREFLIGHT_SQL = `SELECT ${PREFLIGHT_COLUMNS.map(
  ([column, property]) =>
    column === property ? column : `${column} AS ${property}`,
).join(", ")}
FROM publication_switch_preflight WHERE new_generation = ?1`;
const INSERT_PREFLIGHT_SQL = `INSERT INTO publication_switch_preflight (
  ${PREFLIGHT_COLUMNS.map(([column]) => column).join(", ")}
) VALUES (${PREFLIGHT_COLUMNS.map((_, index) => `?${String(index + 1)}`).join(", ")})`;

const HISTORY_KEYS = [
  "switch_id",
  "event_version",
  "event_hash",
  "preflight_hash",
  "action",
  "expected_prior_generation",
  "expected_prior_rollback_candidate_publication_id",
  "expected_prior_switched_at_ms",
  "new_generation",
  "from_publication_id",
  "from_closure_hash",
  "to_publication_id",
  "to_closure_hash",
  "to_attestation_hash",
  "resulting_rollback_candidate_publication_id",
  "switched_at_ms",
  "authorized_by_kind",
  "authorized_identity_id",
] as const satisfies readonly (keyof ServingSwitchHistoryRow)[];

const SELECT_HISTORY_SQL = `SELECT ${HISTORY_KEYS.join(", ")}
FROM publication_switch_history WHERE new_generation = ?1`;
const INSERT_HISTORY_SQL = `INSERT INTO publication_switch_history (
  ${HISTORY_KEYS.join(", ")}
) VALUES (${HISTORY_KEYS.map((_, index) => `?${String(index + 1)}`).join(", ")})`;

const SELECT_STATES_SQL = `SELECT
  (SELECT state FROM publication WHERE publication_id = ?1) AS target_state,
  CASE WHEN ?2 IS NULL THEN NULL ELSE
    (SELECT state FROM publication WHERE publication_id = ?2) END AS former_state`;

const SELECT_INTEGRITY_SQL = `SELECT
  (SELECT count(*) FROM publication_provider_search_document WHERE publication_id = ?1) AS provider_document_count,
  (SELECT count(*) FROM publication_provider_search_fts WHERE publication_id = ?1) AS provider_fts_document_count,
  (SELECT count(*) FROM publication_model_variant_name_search_document WHERE publication_id = ?1) AS model_name_count,
  (SELECT count(*) FROM publication_provider_model_id_search_document WHERE publication_id = ?1) AS provider_model_id_count,
  (SELECT count(*) FROM publication_model_slug_mapping WHERE publication_id = ?1) AS slug_mapping_count,
  (SELECT count(*) FROM publication_model_slug_mapping WHERE publication_id = ?1 AND resolution = 'current') AS slug_current_count,
  (SELECT count(*) FROM publication_model_slug_mapping WHERE publication_id = ?1 AND resolution = 'historical') AS slug_historical_count,
  (SELECT mapping_inventory_hash FROM publication_model_slug_artifact_proof WHERE publication_id = ?1) AS slug_inventory_hash,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS database_now_ms`;

const SELECT_MODEL_SLUG_PAGE_SQL = `SELECT publication_id, slug,
  target_resource_type, model_id, projection_version, resolution,
  target_content_hash
FROM publication_model_slug_mapping
WHERE publication_id = ?1 AND (
  ?2 IS NULL OR slug > ?2 OR (slug = ?2 AND model_id > ?3)
)
ORDER BY slug, model_id LIMIT 257`;

const ASSERT_MODEL_SLUG_SQL = `SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1 FROM publication_model_slug_artifact_proof
    WHERE publication_id = ?1 AND staging_revision = ?2
      AND artifact_version = ?3 AND acquisition_version = ?4
      AND projection_version = ?5 AND base_bundle_hash = ?6
      AND closure_hash = ?7 AND publication_boundary_ms = ?8
      AND artifact_digest = ?9 AND artifact_byte_count = ?10
      AND model_count = ?11 AND source_history_count = ?12
      AND source_history_hash = ?13 AND mapping_count = ?14
      AND current_mapping_count = ?15 AND historical_mapping_count = ?16
      AND mapping_inventory_hash = ?17
  ) OR (SELECT count(*) FROM publication_model_slug_mapping WHERE publication_id = ?1) <> ?14
    OR (SELECT count(*) FROM publication_model_slug_mapping WHERE publication_id = ?1 AND resolution = 'current') <> ?15
    OR (SELECT count(*) FROM publication_model_slug_mapping WHERE publication_id = ?1 AND resolution = 'historical') <> ?16
    OR (SELECT count(*) FROM publication_resource WHERE publication_id = ?1 AND resource_type = 'model') <> ?11
    OR EXISTS (
      SELECT 1 FROM publication_model_slug_mapping INDEXED BY publication_model_slug_exact_idx
      WHERE publication_id = ?1 AND slug = '' AND model_id = ''
    )
    OR EXISTS (
      SELECT 1 FROM publication_model_slug_mapping INDEXED BY publication_model_slug_current_model_idx
      WHERE publication_id = ?1 AND model_id = '' AND resolution = 'current'
    )
    OR EXISTS (
      SELECT 1 FROM publication_model_slug_mapping AS current_mapping
      WHERE current_mapping.publication_id = ?1
        AND current_mapping.resolution = 'current'
        AND NOT EXISTS (
          SELECT 1
          FROM publication_model_slug_mapping INDEXED BY publication_model_slug_current_model_idx
          WHERE publication_id = current_mapping.publication_id
            AND model_id = current_mapping.model_id
            AND slug = current_mapping.slug
            AND resolution = 'current'
        )
    )
    OR (?11 = 0 AND (?18 IS NOT NULL OR ?19 IS NOT NULL))
    OR (?11 > 0 AND (
      ?18 IS NULL OR ?19 IS NULL OR NOT EXISTS (
        SELECT 1 FROM publication_model_slug_mapping INDEXED BY publication_model_slug_exact_idx
        WHERE publication_id = ?1 AND slug = ?18 AND model_id = ?19
          AND resolution = 'current'
      ) OR NOT EXISTS (
        SELECT 1 FROM publication_model_slug_mapping INDEXED BY publication_model_slug_current_model_idx
        WHERE publication_id = ?1 AND model_id = ?19 AND slug = ?18
          AND resolution = 'current'
      )
    ))
    OR EXISTS (
      SELECT 1 FROM publication_model_slug_mapping AS mapping
      WHERE mapping.publication_id = ?1 AND NOT EXISTS (
        SELECT 1 FROM publication_resource AS model
        WHERE model.publication_id = mapping.publication_id
          AND model.resource_type = 'model'
          AND model.resource_id = mapping.model_id
          AND model.content_hash = mapping.target_content_hash
          AND (mapping.resolution <> 'current' OR
            json_extract(model.resource_json, '$.slug.state') = 'known' AND
            json_extract(model.resource_json, '$.slug.value') = mapping.slug)
      )
    )
    OR EXISTS (
      SELECT 1 FROM publication_resource AS model
      WHERE model.publication_id = ?1 AND model.resource_type = 'model'
        AND NOT EXISTS (
          SELECT 1 FROM publication_model_slug_mapping AS mapping
          WHERE mapping.publication_id = model.publication_id
            AND mapping.model_id = model.resource_id
            AND mapping.target_content_hash = model.content_hash
            AND mapping.resolution = 'current'
            AND mapping.slug = json_extract(model.resource_json, '$.slug.value')
        )
    )
    OR NOT EXISTS (
      SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
      WHERE name = 'publication_model_slug_exact_idx' AND "unique" = 0
        AND origin = 'c' AND partial = 0
    )
    OR NOT EXISTS (
      SELECT count(*) FROM pragma_index_xinfo('publication_model_slug_exact_idx')
      WHERE key = 1 HAVING count(*) = 3 AND sum(CASE
        WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
        WHEN seqno = 1 AND name = 'slug' AND desc = 0 AND coll = 'BINARY' THEN 1
        WHEN seqno = 2 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
        ELSE 0 END) = 3
    )
    OR NOT EXISTS (
      SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
      WHERE name = 'publication_model_slug_current_model_idx' AND "unique" = 1
        AND origin = 'c' AND partial = 1
    )
    OR NOT EXISTS (
      SELECT count(*) FROM pragma_index_xinfo('publication_model_slug_current_model_idx')
      WHERE key = 1 HAVING count(*) = 2 AND sum(CASE
        WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
        WHEN seqno = 1 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
        ELSE 0 END) = 2
    )
    OR NOT EXISTS (
      SELECT 1 FROM sqlite_schema
      WHERE type = 'index'
        AND name = 'publication_model_slug_current_model_idx'
        AND tbl_name = 'publication_model_slug_mapping'
        AND replace(replace(replace(replace(sql, ' ', ''), char(9), ''), char(10), ''), char(13), '') =
          'CREATEUNIQUEINDEXpublication_model_slug_current_model_idxONpublication_model_slug_mapping(publication_id,model_id)WHEREresolution=''current'''
    )
  THEN json('') ELSE 1 END AS verified`;
const VERIFY_MODEL_SLUG_SQL = ASSERT_MODEL_SLUG_SQL.replace(
  "THEN json('') ELSE 1",
  "THEN 0 ELSE 1",
);

const ASSERT_POSTCONDITION_SQL = `SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM publication_switch_preflight AS preflight
  JOIN publication_switch_history AS history USING (switch_id)
  JOIN publication_head AS head ON head.singleton = 1
  JOIN publication AS target ON target.publication_id = history.to_publication_id
  JOIN publication_closure_seal AS seal ON seal.publication_id = target.publication_id
  JOIN publication_model_slug_artifact_proof AS slug ON slug.publication_id = target.publication_id
  WHERE preflight.switch_id = ?1 AND preflight.preflight_version = '5.0.0'
    AND preflight.preflight_hash = ?2 AND history.event_version = '1.0.0'
    AND history.event_hash = ?3 AND history.preflight_hash = preflight.preflight_hash
    AND history.new_generation = ?4 AND history.to_publication_id = ?5
    AND head.generation = history.new_generation
    AND head.active_publication_id = history.to_publication_id
    AND head.rollback_candidate_publication_id IS history.resulting_rollback_candidate_publication_id
    AND head.switched_at_ms = history.switched_at_ms
    AND target.state = 'active' AND target.closure_hash = history.to_closure_hash
    AND seal.closure_hash = history.to_closure_hash
    AND slug.artifact_digest = preflight.serving_model_slug_artifact_digest
    AND slug.mapping_inventory_hash = preflight.serving_model_slug_mapping_inventory_hash
    AND preflight.valid_until_ms >= CAST(strftime('%s', 'now') AS INTEGER) * 1000
    AND (history.from_publication_id IS NULL OR EXISTS (
      SELECT 1 FROM publication AS former WHERE former.publication_id = history.from_publication_id
        AND former.closure_hash = history.from_closure_hash
        AND former.state = CASE history.action WHEN 'activate' THEN 'superseded' ELSE 'rolled_back' END
    ))
) THEN json('') ELSE 1 END AS verified`;

const PUBLICATION_STATES = new Set<string>([
  "building",
  "failed",
  "ready",
  "active",
  "superseded",
  "rolled_back",
]);
const isRecord = (value: unknown): value is Record<string, unknown> => {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
};
const snapshotExactDataRecord = (
  value: unknown,
  expected: readonly string[],
): Readonly<Record<string, unknown>> => {
  try {
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype)
      throw new TypeError();
    const actual = Reflect.ownKeys(value);
    if (
      actual.length !== expected.length ||
      actual.some((key) => typeof key !== "string" || !expected.includes(key))
    )
      throw new TypeError();
    const output: Record<string, unknown> = {};
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor))
        throw new TypeError();
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
};

const snapshotDenseArray = (value: unknown, maximum: number): unknown[] => {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    )
      throw new TypeError();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length: unknown = lengthDescriptor?.value as unknown;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximum ||
      Reflect.ownKeys(value).length !== length + 1
    )
      throw new TypeError();
    const output = new Array<unknown>(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor))
        throw new TypeError();
      output[index] = descriptor.value;
    }
    return output;
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
};

const decodeHead = (value: unknown): StoredPublicationHead | null => {
  if (value === undefined) return null;
  const keys = [
    "active_publication_id",
    "rollback_candidate_publication_id",
    "switched_at_ms",
    "generation",
  ];
  const row = snapshotExactDataRecord(value, keys);
  const active = row.active_publication_id;
  const rollback = row.rollback_candidate_publication_id;
  const time = row.switched_at_ms;
  const generation = row.generation;
  if (
    typeof active !== "string" ||
    (rollback !== null && typeof rollback !== "string") ||
    typeof time !== "number" ||
    !Number.isSafeInteger(time) ||
    time < 0 ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  )
    throw new ServingSwitchError("integrity_failure");
  return Object.freeze({
    activePublicationId: active as StoredPublicationHead["activePublicationId"],
    rollbackCandidatePublicationId:
      rollback as StoredPublicationHead["rollbackCandidatePublicationId"],
    switchedAt: new Date(time).toISOString(),
    generation,
  });
};

const decodeBoundedRow = <T extends Readonly<Record<string, unknown>>>(
  value: unknown,
  keys: readonly (keyof T & string)[],
  shape: T,
): T | null => {
  if (value === undefined) return null;
  const row = snapshotExactDataRecord(value, keys);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const actual = row[key];
    const expected = shape[key];
    if (typeof expected === "number") {
      if (
        typeof actual !== "number" ||
        !Number.isSafeInteger(actual) ||
        actual < 0
      )
        throw new ServingSwitchError("integrity_failure");
    } else if (typeof expected === "string") {
      if (
        typeof actual !== "string" ||
        actual.length === 0 ||
        actual.length > 512 ||
        !/^[\x20-\x7e]+$/u.test(actual)
      )
        throw new ServingSwitchError("integrity_failure");
    } else if (
      expected === null &&
      actual !== null &&
      (typeof actual !== "string" ||
        actual.length === 0 ||
        actual.length > 512 ||
        !/^[\x20-\x7e]+$/u.test(actual))
    )
      throw new ServingSwitchError("integrity_failure");
    result[key] = actual;
  }
  return Object.freeze(result) as T;
};

const snapshotBatch = (
  value: unknown,
  count: number,
): readonly (readonly unknown[])[] => {
  const admitted = snapshotDenseArray(value, count);
  if (admitted.length !== count)
    throw new ServingSwitchError("integrity_failure");
  const output = new Array<readonly unknown[]>(count);
  for (let index = 0; index < count; index += 1) {
    const result: unknown = admitted[index];
    if (!isRecord(result)) throw new ServingSwitchError("integrity_failure");
    const rows: unknown = Object.getOwnPropertyDescriptor(
      result,
      "results",
    )?.value;
    const success: unknown = Object.getOwnPropertyDescriptor(
      result,
      "success",
    )?.value;
    const admittedRows = snapshotDenseArray(rows, 1);
    if (success !== true) throw new ServingSwitchError("integrity_failure");
    output[index] = Object.freeze(admittedRows);
  }
  return Object.freeze(output);
};

const preflightValues = (row: ServingSwitchPreflightProofV5) =>
  PREFLIGHT_COLUMNS.map(([, property]) => row[property]);
const historyValues = (row: ServingSwitchHistoryRow) =>
  HISTORY_KEYS.map((key) => row[key]);
const slugProofValues = (state: ServingSwitchPersistenceV5) => {
  const row = state.modelSlugArtifactProof;
  const current = state.modelSlugMappings.find(
    (mapping) => mapping.resolution === "current",
  );
  return [
    row.publication_id,
    row.staging_revision,
    row.artifact_version,
    row.acquisition_version,
    row.projection_version,
    row.base_bundle_hash,
    row.closure_hash,
    row.publication_boundary_ms,
    row.artifact_digest,
    row.artifact_byte_count,
    row.model_count,
    row.source_history_count,
    row.source_history_hash,
    row.mapping_count,
    row.current_mapping_count,
    row.historical_mapping_count,
    row.mapping_inventory_hash,
    current?.slug ?? null,
    current?.model_id ?? null,
  ] as const;
};

const storageMappingsFromOperationalProjection = (
  publicationId: string,
  mappings: readonly Readonly<{
    slug: string;
    modelId: string;
    projectionVersion: "model-slug@1";
    resolution: "current" | "historical";
    targetContentHash: `sha256:${string}`;
  }>[],
): ServingSwitchPersistenceV5["modelSlugMappings"] =>
  Object.freeze(
    mappings.map((mapping) =>
      Object.freeze({
        publication_id: publicationId as `pub_${string}`,
        slug: mapping.slug,
        target_resource_type: "model" as const,
        model_id: mapping.modelId as `mdl_${string}`,
        projection_version: mapping.projectionVersion,
        resolution: mapping.resolution,
        target_content_hash: mapping.targetContentHash,
      }),
    ),
  );

const readSnapshot = async (
  session: D1DatabaseSession,
  expected: ServingSwitchProjectionV5,
) => {
  const state = readServingSwitchPersistenceV5(expected);
  const untrusted: unknown = await session.batch([
    session.prepare(SELECT_HEAD_SQL),
    session.prepare(SELECT_PREFLIGHT_SQL).bind(state.history.new_generation),
    session.prepare(SELECT_HISTORY_SQL).bind(state.history.new_generation),
    session
      .prepare(SELECT_STATES_SQL)
      .bind(state.history.to_publication_id, state.history.from_publication_id),
    session.prepare(SELECT_INTEGRITY_SQL).bind(state.history.to_publication_id),
  ]);
  const results = snapshotBatch(untrusted, 5);
  const states = snapshotExactDataRecord(results[3]?.[0], [
    "target_state",
    "former_state",
  ]);
  const counts = snapshotExactDataRecord(results[4]?.[0], [
    "provider_document_count",
    "provider_fts_document_count",
    "model_name_count",
    "provider_model_id_count",
    "slug_mapping_count",
    "slug_current_count",
    "slug_historical_count",
    "slug_inventory_hash",
    "database_now_ms",
  ]);
  const expectedCounts = [
    state.preflight.provider_search_document_count,
    state.preflight.provider_search_fts_document_count,
    state.preflight.model_variant_name_storage_document_count,
    state.preflight.provider_model_id_storage_document_count,
    state.preflight.model_slug_serving_mapping_count,
    state.preflight.model_slug_serving_current_mapping_count,
    state.preflight.model_slug_serving_historical_mapping_count,
    state.preflight.model_slug_serving_mapping_inventory_hash,
  ];
  const actualCounts = [
    counts.provider_document_count,
    counts.provider_fts_document_count,
    counts.model_name_count,
    counts.provider_model_id_count,
    counts.slug_mapping_count,
    counts.slug_current_count,
    counts.slug_historical_count,
    counts.slug_inventory_hash,
  ];
  if (
    JSON.stringify(actualCounts) !== JSON.stringify(expectedCounts) ||
    typeof counts.database_now_ms !== "number" ||
    !Number.isSafeInteger(counts.database_now_ms) ||
    counts.database_now_ms < 0
  )
    throw new ServingSwitchError("integrity_failure");
  const targetState = decodeState(states.target_state);
  const formerState =
    state.history.from_publication_id === null
      ? states.former_state === null
        ? null
        : (() => {
            throw new ServingSwitchError("integrity_failure");
          })()
      : decodeState(states.former_state);
  return Object.freeze({
    currentHead: decodeHead(results[0]?.[0]),
    preflightAtGeneration: decodeBoundedRow(
      results[1]?.[0],
      PREFLIGHT_KEYS,
      state.preflight,
    ),
    historyAtGeneration: decodeBoundedRow(
      results[2]?.[0],
      HISTORY_KEYS,
      state.history,
    ),
    targetState,
    formerState,
    databaseNowMs: counts.database_now_ms,
  });
};

const decodeState = (value: unknown): PublicationState => {
  if (typeof value !== "string" || !PUBLICATION_STATES.has(value))
    throw new ServingSwitchError("integrity_failure");
  return value as PublicationState;
};

const classify = async (
  database: D1Database,
  expected: ServingSwitchProjectionV5,
) => {
  const state = readServingSwitchPersistenceV5(expected);
  const snapshot = await readSnapshot(
    database.withSession("first-primary"),
    expected,
  );
  if (
    snapshot.historyAtGeneration === null &&
    snapshot.databaseNowMs > state.preflight.valid_until_ms
  )
    return Object.freeze({ outcome: "stale" as const });
  return classifyServingSwitchRetryV5({ expected, ...snapshot });
};

const fail = (outcome: ServingSwitchErrorCode): never => {
  throw new ServingSwitchError(outcome);
};
const success = (
  state: ServingSwitchPersistenceV5,
  outcome: ServingSwitchResult["outcome"],
): ServingSwitchResult =>
  Object.freeze({
    outcome,
    switchId: state.history.switch_id,
    generation: state.history.new_generation,
  });

const verifyProviderIds = async (
  database: D1Database,
  state: ServingSwitchPersistenceV5,
) => {
  try {
    await verifyProviderModelIdSearchStorageV4(
      database,
      state.providerModelIdProof,
    );
  } catch (error) {
    if (
      error instanceof ProviderModelIdSearchStagingError &&
      error.code === "integrity_failure"
    )
      throw new ServingSwitchError("integrity_failure");
    throw new ServingSwitchError("outcome_unknown");
  }
};

const verifyModelSlug = async (
  database: D1Database,
  state: ServingSwitchPersistenceV5,
  expectedMappings: ServingSwitchPersistenceV5["modelSlugMappings"],
): Promise<void> => {
  let untrusted: unknown;
  const session = database.withSession("first-primary");
  try {
    untrusted = await session.batch([
      session.prepare(VERIFY_MODEL_SLUG_SQL).bind(...slugProofValues(state)),
    ]);
  } catch {
    throw new ServingSwitchError("outcome_unknown");
  }
  const results = snapshotBatch(untrusted, 1);
  const row = snapshotExactDataRecord(results[0]?.[0], ["verified"]);
  if (results[0]?.length !== 1 || row.verified !== 1)
    throw new ServingSwitchError("integrity_failure");
  const expected = [...expectedMappings].sort((left, right) =>
    left.slug === right.slug
      ? left.model_id < right.model_id
        ? -1
        : left.model_id > right.model_id
          ? 1
          : 0
      : left.slug < right.slug
        ? -1
        : 1,
  );
  let offset = 0;
  let lastSlug: string | null = null;
  let lastModelId: string | null = null;
  const maximumPages = Math.ceil(expected.length / 256) + 1;
  for (let page = 0; page < maximumPages; page += 1) {
    let pageResult: unknown;
    try {
      pageResult = await session.batch([
        session
          .prepare(SELECT_MODEL_SLUG_PAGE_SQL)
          .bind(state.preflight.to_publication_id, lastSlug, lastModelId),
      ]);
    } catch {
      throw new ServingSwitchError("outcome_unknown");
    }
    const pageEnvelopes = snapshotDenseArray(pageResult, 1);
    if (pageEnvelopes.length !== 1)
      throw new ServingSwitchError("integrity_failure");
    const envelope: unknown = pageEnvelopes[0];
    let success: unknown;
    let admittedRows: unknown[];
    try {
      if (!isRecord(envelope)) throw new TypeError();
      success = Object.getOwnPropertyDescriptor(envelope, "success")?.value;
      const rows: unknown = Object.getOwnPropertyDescriptor(
        envelope,
        "results",
      )?.value;
      admittedRows = snapshotDenseArray(rows, 257);
    } catch (error) {
      if (error instanceof ServingSwitchError) throw error;
      throw new ServingSwitchError("integrity_failure");
    }
    if (success !== true) throw new ServingSwitchError("integrity_failure");
    const admittedCount = Math.min(admittedRows.length, 256);
    for (let rowIndex = 0; rowIndex < admittedCount; rowIndex += 1) {
      const candidate: unknown = admittedRows[rowIndex];
      const expectedRow = expected[offset];
      const mappingKeys = [
        "publication_id",
        "slug",
        "target_resource_type",
        "model_id",
        "projection_version",
        "resolution",
        "target_content_hash",
      ] as const;
      const candidateRow = snapshotExactDataRecord(candidate, mappingKeys);
      const candidateValues = mappingKeys.map((key) => candidateRow[key]);
      if (
        expectedRow === undefined ||
        candidateValues.length !== 7 ||
        candidateValues[0] !== expectedRow.publication_id ||
        candidateValues[1] !== expectedRow.slug ||
        candidateValues[2] !== expectedRow.target_resource_type ||
        candidateValues[3] !== expectedRow.model_id ||
        candidateValues[4] !== expectedRow.projection_version ||
        candidateValues[5] !== expectedRow.resolution ||
        candidateValues[6] !== expectedRow.target_content_hash
      )
        throw new ServingSwitchError("integrity_failure");
      lastSlug = expectedRow.slug;
      lastModelId = expectedRow.model_id;
      offset += 1;
    }
    if (admittedRows.length < 257) {
      if (offset !== expected.length)
        throw new ServingSwitchError("integrity_failure");
      return;
    }
  }
  throw new ServingSwitchError("integrity_failure");
};

/** Executes the schema-1.13 six-statement, Model-slug-bound head switch. */
export const applyServingSwitchV5 = async (
  database: D1Database,
  authorityValue: unknown,
  freshRollbackValue: unknown,
  expectedValue: unknown,
): Promise<ServingSwitchResult> => {
  try {
    assertModelSlugLifecycleAuthorityV5(authorityValue);
    assertServingSwitchProjectionV5(expectedValue);
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
  const authority: ModelSlugLifecycleAuthorityV5 = authorityValue;
  const expected: ServingSwitchProjectionV5 = expectedValue;
  const state = readServingSwitchPersistenceV5(expected);
  let operational;
  try {
    assertModelSlugLifecycleAuthorityBindingV5(
      authority,
      state.modelSlugArchiveProof,
      state.modelSlugServingProof,
    );
    operational = readModelSlugLifecycleOperationalBindingV5(authority);
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
  let verifiedMappings = storageMappingsFromOperationalProjection(
    operational.archiveProof.publicationId,
    operational.archiveProof.projection.mappings,
  );
  if (state.preflight.action === "activate") {
    if (freshRollbackValue !== null)
      throw new ServingSwitchError("integrity_failure");
  } else {
    let fresh;
    try {
      assertFreshModelSlugRollbackProof(freshRollbackValue);
      fresh = readFreshModelSlugRollbackProof(freshRollbackValue);
    } catch {
      throw new ServingSwitchError("integrity_failure");
    }
    const archive = fresh.archiveProof;
    if (
      archive.publicationId !== state.modelSlugArchiveProof.publication_id ||
      archive.closureHash !== state.modelSlugArchiveProof.closure_hash ||
      archive.baseBundleHash !== state.modelSlugArchiveProof.base_bundle_hash ||
      archive.publicationBoundaryMs !==
        state.modelSlugArchiveProof.publication_boundary_ms ||
      archive.artifactDigest !== state.modelSlugArchiveProof.artifact_digest ||
      archive.artifactByteCount !==
        state.modelSlugArchiveProof.artifact_byte_count ||
      archive.projection.mappingInventoryHash !==
        state.modelSlugArchiveProof.mapping_inventory_hash ||
      archive.projection.modelCount !==
        state.modelSlugArchiveProof.model_count ||
      archive.projection.sourceHistoryCount !==
        state.modelSlugArchiveProof.source_history_count ||
      archive.projection.sourceHistoryHash !==
        state.modelSlugArchiveProof.source_history_hash ||
      archive.projection.mappingCount !==
        state.modelSlugArchiveProof.mapping_count ||
      archive.projection.currentMappingCount !==
        state.modelSlugArchiveProof.current_mapping_count ||
      archive.projection.historicalMappingCount !==
        state.modelSlugArchiveProof.historical_mapping_count ||
      fresh.observedAtMs !== state.preflight.observed_at_ms ||
      fresh.maximumAgeMs !== state.preflight.maximum_age_ms ||
      fresh.observedAtMs + fresh.maximumAgeMs !== state.preflight.valid_until_ms
    )
      throw new ServingSwitchError("integrity_failure");
    verifiedMappings = storageMappingsFromOperationalProjection(
      archive.publicationId,
      archive.projection.mappings,
    );
  }
  let initial;
  try {
    initial = await classify(database, expected);
  } catch (error) {
    if (error instanceof ServingSwitchError) throw error;
    throw new ServingSwitchError("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success") {
    await verifyProviderIds(database, state);
    await verifyModelSlug(database, state, verifiedMappings);
    return success(state, "idempotent_success");
  }
  if (initial.outcome !== "execute") return fail(initial.outcome);
  await verifyProviderIds(database, state);
  await verifyModelSlug(database, state, verifiedMappings);
  const session = database.withSession("first-primary");
  await admitModelDetailPublication(session, {
    publicationId: state.preflight.to_publication_id,
    expectedModelCount: state.modelSlugArchiveProof.model_count,
  });
  try {
    const untrusted: unknown = await session.batch([
      ...prepareProviderModelIdSearchAtomicAssertionsV4(
        session,
        state.providerModelIdProof,
      ),
      session.prepare(ASSERT_MODEL_SLUG_SQL).bind(...slugProofValues(state)),
      session
        .prepare(INSERT_PREFLIGHT_SQL)
        .bind(...preflightValues(state.preflight)),
      session.prepare(INSERT_HISTORY_SQL).bind(...historyValues(state.history)),
      session
        .prepare(ASSERT_POSTCONDITION_SQL)
        .bind(
          state.history.switch_id,
          state.preflight.preflight_hash,
          state.history.event_hash,
          state.history.new_generation,
          state.history.to_publication_id,
        ),
    ]);
    const results = snapshotBatch(untrusted, 6);
    const verified = snapshotExactDataRecord(results[5]?.[0], ["verified"]);
    if (results[5]?.length !== 1 || verified.verified !== 1)
      throw new Error("ambiguous switch result");
    await verifyProviderIds(database, state);
    await verifyModelSlug(database, state, verifiedMappings);
    return success(state, "applied");
  } catch {
    let reconciled;
    try {
      reconciled = await classify(database, expected);
    } catch (error) {
      if (error instanceof ServingSwitchError) throw error;
      throw new ServingSwitchError("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success") {
      await verifyProviderIds(database, state);
      await verifyModelSlug(database, state, verifiedMappings);
      return success(state, "idempotent_success");
    }
    await verifyProviderIds(database, state);
    await verifyModelSlug(database, state, verifiedMappings);
    if (reconciled.outcome === "execute")
      throw new ServingSwitchError("not_applied");
    return fail(reconciled.outcome);
  }
};
