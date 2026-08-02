import {
  assertServingReadinessCommitProjection,
  classifyServingReadinessCommitRetry,
  type PublicationState,
  type ServingArchiveReceiptRow,
  type ServingProbeReceiptRow,
  type ServingReadinessAttestationProjection,
  type ServingReadinessCommitProjection,
  type ServingReadinessReceiptBindingRow,
  type ServingReadinessReceiptRows,
  type ServingServingReceiptRow,
  type ServingVectorReceiptRow,
} from "@quant-clarity/publication-core";

const SELECT_PUBLICATION_SQL = `SELECT
  candidate.state,
  candidate.ready_at_ms,
  candidate.closure_hash,
  seal.closure_hash AS seal_closure_hash,
  seal.bundle_hash AS seal_bundle_hash
FROM publication AS candidate
LEFT JOIN publication_closure_seal AS seal USING (publication_id)
WHERE candidate.publication_id = ?1`;

const SELECT_BINDINGS_SQL = `SELECT
  publication_id, kind, receipt_version, receipt_hash, environment,
  closure_hash, bundle_hash, schema_version, build_commit, observed_at_ms
FROM publication_readiness_receipt
WHERE publication_id = ?1
ORDER BY kind`;

const SELECT_ARCHIVE_SQL = `SELECT
  publication_id, kind, retained_bundle_hash, immutable
FROM publication_archive_receipt
WHERE publication_id = ?1`;

const SELECT_SERVING_SQL = `SELECT
  publication_id, kind, enabled_provider_count, enabled_provider_scope_hash,
  provider_slice_count, provider_slice_hash, provider_attribution_count,
  provider_attribution_hash, resource_count, exact_document_count,
  resource_inventory_hash, exact_search_inventory_hash, fts_build_version,
  fts_document_count, fts_queryable, foreign_keys_valid, content_hashes_valid,
  unavailable_provider_isolation_valid
FROM publication_serving_receipt
WHERE publication_id = ?1`;

const SELECT_VECTOR_SQL = `SELECT
  publication_id, kind, vector_namespace, document_count,
  verified_document_count, vector_inventory_hash, visibility_probe_version,
  mutation_id, all_ids_present, all_namespaces_match, queryable
FROM publication_vector_receipt
WHERE publication_id = ?1`;

const SELECT_PROBE_SQL = `SELECT
  publication_id, kind, probe_set_version, integrity_passed,
  evidence_coverage_passed, exact_search_passed, semantic_search_passed,
  structured_filter_passed, neutrality_passed, version_isolation_passed
FROM publication_probe_receipt
WHERE publication_id = ?1`;

const SELECT_ATTESTATION_SQL = `SELECT
  publication_id, environment, closure_hash, bundle_hash, evaluator_version,
  ready_at_ms, maximum_receipt_age_ms, effective_valid_until_ms,
  archive_observed_at_ms, serving_observed_at_ms, vector_observed_at_ms,
  probes_observed_at_ms, archive_receipt_hash, serving_receipt_hash,
  vector_receipt_hash, probes_receipt_hash, attestation_hash
FROM publication_readiness_attestation
WHERE publication_id = ?1`;

const ASSERT_ZERO_BUILDING_LEDGER_SQL = `SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication AS candidate
  JOIN publication_closure_seal AS seal USING (publication_id)
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building'
    AND candidate.ready_at_ms IS NULL
    AND candidate.closure_hash = ?2
    AND seal.closure_hash = ?2
    AND NOT EXISTS (SELECT 1 FROM publication_readiness_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_archive_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_serving_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_vector_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_probe_receipt WHERE publication_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM publication_readiness_attestation WHERE publication_id = ?1)
) THEN 1 ELSE json('') END AS clean`;

const INSERT_BINDING_SQL = `INSERT INTO publication_readiness_receipt (
  publication_id, kind, receipt_version, receipt_hash, environment,
  closure_hash, bundle_hash, schema_version, build_commit, observed_at_ms
)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
WHERE NOT EXISTS (
  SELECT 1 FROM publication_readiness_receipt
  WHERE publication_id = ?1 AND kind = ?2
)
AND EXISTS (
  SELECT 1 FROM publication AS candidate
  JOIN publication_closure_seal AS seal USING (publication_id)
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building'
    AND candidate.ready_at_ms IS NULL
    AND candidate.closure_hash = ?6
    AND candidate.schema_version = ?8
    AND candidate.build_commit = ?9
    AND seal.closure_hash = ?6
    AND seal.bundle_hash = ?7
)`;

const INSERT_ARCHIVE_SQL = `INSERT INTO publication_archive_receipt (
  publication_id, kind, retained_bundle_hash, immutable
)
SELECT ?1, ?2, ?3, ?4
WHERE NOT EXISTS (
  SELECT 1 FROM publication_archive_receipt WHERE publication_id = ?1
)
AND EXISTS (
  SELECT 1 FROM publication AS candidate
  JOIN publication_closure_seal AS seal USING (publication_id)
  JOIN publication_readiness_receipt AS binding USING (publication_id)
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building' AND candidate.ready_at_ms IS NULL
    AND candidate.closure_hash = ?5 AND seal.closure_hash = ?5
    AND seal.bundle_hash = ?6 AND binding.kind = ?2
)`;

const INSERT_SERVING_SQL = `INSERT INTO publication_serving_receipt (
  publication_id, kind, enabled_provider_count, enabled_provider_scope_hash,
  provider_slice_count, provider_slice_hash, provider_attribution_count,
  provider_attribution_hash, resource_count, exact_document_count,
  resource_inventory_hash, exact_search_inventory_hash, fts_build_version,
  fts_document_count, fts_queryable, foreign_keys_valid, content_hashes_valid,
  unavailable_provider_isolation_valid
)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
  ?15, ?16, ?17, ?18
WHERE NOT EXISTS (
  SELECT 1 FROM publication_serving_receipt WHERE publication_id = ?1
)
AND EXISTS (
  SELECT 1 FROM publication AS candidate
  JOIN publication_closure_seal AS seal USING (publication_id)
  JOIN publication_readiness_receipt AS binding USING (publication_id)
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building' AND candidate.ready_at_ms IS NULL
    AND candidate.closure_hash = ?19 AND seal.closure_hash = ?19
    AND seal.bundle_hash = ?20 AND binding.kind = ?2
)`;

const INSERT_VECTOR_SQL = `INSERT INTO publication_vector_receipt (
  publication_id, kind, vector_namespace, document_count,
  verified_document_count, vector_inventory_hash, visibility_probe_version,
  mutation_id, all_ids_present, all_namespaces_match, queryable
)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
WHERE NOT EXISTS (
  SELECT 1 FROM publication_vector_receipt WHERE publication_id = ?1
)
AND EXISTS (
  SELECT 1 FROM publication AS candidate
  JOIN publication_closure_seal AS seal USING (publication_id)
  JOIN publication_readiness_receipt AS binding USING (publication_id)
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building' AND candidate.ready_at_ms IS NULL
    AND candidate.closure_hash = ?12 AND seal.closure_hash = ?12
    AND seal.bundle_hash = ?13 AND binding.kind = ?2
)`;

const INSERT_PROBE_SQL = `INSERT INTO publication_probe_receipt (
  publication_id, kind, probe_set_version, integrity_passed,
  evidence_coverage_passed, exact_search_passed, semantic_search_passed,
  structured_filter_passed, neutrality_passed, version_isolation_passed
)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
WHERE NOT EXISTS (
  SELECT 1 FROM publication_probe_receipt WHERE publication_id = ?1
)
AND EXISTS (
  SELECT 1 FROM publication AS candidate
  JOIN publication_closure_seal AS seal USING (publication_id)
  JOIN publication_readiness_receipt AS binding USING (publication_id)
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building' AND candidate.ready_at_ms IS NULL
    AND candidate.closure_hash = ?11 AND seal.closure_hash = ?11
    AND seal.bundle_hash = ?12 AND binding.kind = ?2
)`;

const RECEIPT_EXPECTATIONS_SQL = `
expected_bindings(
  publication_id, kind, receipt_version, receipt_hash, environment,
  closure_hash, bundle_hash, schema_version, build_commit, observed_at_ms
) AS (VALUES
  (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10),
  (?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20),
  (?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30),
  (?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40)
),
expected_archive(
  publication_id, kind, retained_bundle_hash, immutable
) AS (VALUES (?41, ?42, ?43, ?44)),
expected_serving(
  publication_id, kind, enabled_provider_count, enabled_provider_scope_hash,
  provider_slice_count, provider_slice_hash, provider_attribution_count,
  provider_attribution_hash, resource_count, exact_document_count,
  resource_inventory_hash, exact_search_inventory_hash, fts_build_version,
  fts_document_count, fts_queryable, foreign_keys_valid, content_hashes_valid,
  unavailable_provider_isolation_valid
) AS (VALUES
  (?45, ?46, ?47, ?48, ?49, ?50, ?51, ?52, ?53, ?54, ?55, ?56, ?57,
   ?58, ?59, ?60, ?61, ?62)
),
expected_vector(
  publication_id, kind, vector_namespace, document_count,
  verified_document_count, vector_inventory_hash, visibility_probe_version,
  mutation_id, all_ids_present, all_namespaces_match, queryable
) AS (VALUES
  (?63, ?64, ?65, ?66, ?67, ?68, ?69, ?70, ?71, ?72, ?73)
),
expected_probe(
  publication_id, kind, probe_set_version, integrity_passed,
  evidence_coverage_passed, exact_search_passed, semantic_search_passed,
  structured_filter_passed, neutrality_passed, version_isolation_passed
) AS (VALUES
  (?74, ?75, ?76, ?77, ?78, ?79, ?80, ?81, ?82, ?83)
)`;

const RECEIPT_MISMATCH_SQL = `
EXISTS (
  SELECT publication_id, kind, receipt_version, receipt_hash, environment,
    closure_hash, bundle_hash, schema_version, build_commit, observed_at_ms
  FROM publication_readiness_receipt WHERE publication_id = ?1
  EXCEPT SELECT * FROM expected_bindings
) OR EXISTS (
  SELECT * FROM expected_bindings EXCEPT
  SELECT publication_id, kind, receipt_version, receipt_hash, environment,
    closure_hash, bundle_hash, schema_version, build_commit, observed_at_ms
  FROM publication_readiness_receipt WHERE publication_id = ?1
) OR EXISTS (
  SELECT publication_id, kind, retained_bundle_hash, immutable
  FROM publication_archive_receipt WHERE publication_id = ?1
  EXCEPT SELECT * FROM expected_archive
) OR EXISTS (
  SELECT * FROM expected_archive EXCEPT
  SELECT publication_id, kind, retained_bundle_hash, immutable
  FROM publication_archive_receipt WHERE publication_id = ?1
) OR EXISTS (
  SELECT publication_id, kind, enabled_provider_count, enabled_provider_scope_hash,
    provider_slice_count, provider_slice_hash, provider_attribution_count,
    provider_attribution_hash, resource_count, exact_document_count,
    resource_inventory_hash, exact_search_inventory_hash, fts_build_version,
    fts_document_count, fts_queryable, foreign_keys_valid, content_hashes_valid,
    unavailable_provider_isolation_valid
  FROM publication_serving_receipt WHERE publication_id = ?1
  EXCEPT SELECT * FROM expected_serving
) OR EXISTS (
  SELECT * FROM expected_serving EXCEPT
  SELECT publication_id, kind, enabled_provider_count, enabled_provider_scope_hash,
    provider_slice_count, provider_slice_hash, provider_attribution_count,
    provider_attribution_hash, resource_count, exact_document_count,
    resource_inventory_hash, exact_search_inventory_hash, fts_build_version,
    fts_document_count, fts_queryable, foreign_keys_valid, content_hashes_valid,
    unavailable_provider_isolation_valid
  FROM publication_serving_receipt WHERE publication_id = ?1
) OR EXISTS (
  SELECT publication_id, kind, vector_namespace, document_count,
    verified_document_count, vector_inventory_hash, visibility_probe_version,
    mutation_id, all_ids_present, all_namespaces_match, queryable
  FROM publication_vector_receipt WHERE publication_id = ?1
  EXCEPT SELECT * FROM expected_vector
) OR EXISTS (
  SELECT * FROM expected_vector EXCEPT
  SELECT publication_id, kind, vector_namespace, document_count,
    verified_document_count, vector_inventory_hash, visibility_probe_version,
    mutation_id, all_ids_present, all_namespaces_match, queryable
  FROM publication_vector_receipt WHERE publication_id = ?1
) OR EXISTS (
  SELECT publication_id, kind, probe_set_version, integrity_passed,
    evidence_coverage_passed, exact_search_passed, semantic_search_passed,
    structured_filter_passed, neutrality_passed, version_isolation_passed
  FROM publication_probe_receipt WHERE publication_id = ?1
  EXCEPT SELECT * FROM expected_probe
) OR EXISTS (
  SELECT * FROM expected_probe EXCEPT
  SELECT publication_id, kind, probe_set_version, integrity_passed,
    evidence_coverage_passed, exact_search_passed, semantic_search_passed,
    structured_filter_passed, neutrality_passed, version_isolation_passed
  FROM publication_probe_receipt WHERE publication_id = ?1
)`;

const ASSERT_RECEIPTS_SQL = `WITH ${RECEIPT_EXPECTATIONS_SQL}
SELECT CASE WHEN ${RECEIPT_MISMATCH_SQL}
THEN json('') ELSE 1 END AS verified`;

const INSERT_ATTESTATION_SQL = `INSERT INTO publication_readiness_attestation (
  publication_id, environment, closure_hash, bundle_hash, evaluator_version,
  ready_at_ms, maximum_receipt_age_ms, effective_valid_until_ms,
  archive_observed_at_ms, serving_observed_at_ms, vector_observed_at_ms,
  probes_observed_at_ms, archive_receipt_hash, serving_receipt_hash,
  vector_receipt_hash, probes_receipt_hash, attestation_hash
)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
  ?15, ?16, ?17
WHERE NOT EXISTS (
  SELECT 1 FROM publication_readiness_attestation WHERE publication_id = ?1
)
AND EXISTS (
  SELECT 1 FROM publication AS candidate
  JOIN publication_closure_seal AS seal USING (publication_id)
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building' AND candidate.ready_at_ms IS NULL
    AND candidate.closure_hash = ?3 AND seal.closure_hash = ?3
    AND seal.bundle_hash = ?4
)`;

const ATTESTATION_EXPECTATION_SQL = `expected_attestation(
  publication_id, environment, closure_hash, bundle_hash, evaluator_version,
  ready_at_ms, maximum_receipt_age_ms, effective_valid_until_ms,
  archive_observed_at_ms, serving_observed_at_ms, vector_observed_at_ms,
  probes_observed_at_ms, archive_receipt_hash, serving_receipt_hash,
  vector_receipt_hash, probes_receipt_hash, attestation_hash
) AS (VALUES
  (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
   ?15, ?16, ?17)
)`;

const ATTESTATION_MISMATCH_SQL = `EXISTS (
  SELECT publication_id, environment, closure_hash, bundle_hash,
    evaluator_version, ready_at_ms, maximum_receipt_age_ms,
    effective_valid_until_ms, archive_observed_at_ms, serving_observed_at_ms,
    vector_observed_at_ms, probes_observed_at_ms, archive_receipt_hash,
    serving_receipt_hash, vector_receipt_hash, probes_receipt_hash,
    attestation_hash
  FROM publication_readiness_attestation WHERE publication_id = ?1
  EXCEPT SELECT * FROM expected_attestation
) OR EXISTS (
  SELECT * FROM expected_attestation EXCEPT
  SELECT publication_id, environment, closure_hash, bundle_hash,
    evaluator_version, ready_at_ms, maximum_receipt_age_ms,
    effective_valid_until_ms, archive_observed_at_ms, serving_observed_at_ms,
    vector_observed_at_ms, probes_observed_at_ms, archive_receipt_hash,
    serving_receipt_hash, vector_receipt_hash, probes_receipt_hash,
    attestation_hash
  FROM publication_readiness_attestation WHERE publication_id = ?1
)`;

const ASSERT_ATTESTATION_SQL = `WITH ${ATTESTATION_EXPECTATION_SQL}
SELECT CASE WHEN ${ATTESTATION_MISMATCH_SQL}
THEN json('') ELSE 1 END AS verified`;

const UPDATE_READY_SQL = `UPDATE publication
SET state = 'ready', ready_at_ms = ?2
WHERE publication_id = ?1
  AND state = 'building'
  AND ready_at_ms IS NULL
  AND closure_hash = ?3`;

const FINAL_ATTESTATION_EXPECTATION_SQL = `expected_attestation(
  publication_id, environment, closure_hash, bundle_hash, evaluator_version,
  ready_at_ms, maximum_receipt_age_ms, effective_valid_until_ms,
  archive_observed_at_ms, serving_observed_at_ms, vector_observed_at_ms,
  probes_observed_at_ms, archive_receipt_hash, serving_receipt_hash,
  vector_receipt_hash, probes_receipt_hash, attestation_hash
) AS (VALUES
  (?84, ?85, ?86, ?87, ?88, ?89, ?90, ?91, ?92, ?93, ?94, ?95, ?96,
   ?97, ?98, ?99, ?100)
)`;

const ASSERT_POSTCONDITION_SQL = `WITH ${RECEIPT_EXPECTATIONS_SQL},
${FINAL_ATTESTATION_EXPECTATION_SQL}
SELECT CASE WHEN changes() NOT IN (0, 1)
  OR ${RECEIPT_MISMATCH_SQL}
  OR ${ATTESTATION_MISMATCH_SQL}
  OR NOT EXISTS (
    SELECT 1 FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE candidate.publication_id = ?1
      AND candidate.state = 'ready'
      AND candidate.ready_at_ms = ?89
      AND candidate.closure_hash = ?86
      AND seal.closure_hash = ?86
  )
  OR (
    SELECT count(*) FROM publication_search_document
    WHERE publication_id = ?1
  ) <> (
    SELECT exact_document_count FROM publication_closure_seal
    WHERE publication_id = ?1
  )
  OR (
    SELECT count(*) FROM publication_search_fts
    WHERE publication_id = ?1
  ) <> (
    SELECT exact_document_count FROM publication_closure_seal
    WHERE publication_id = ?1
  )
  OR EXISTS (
    SELECT 1 FROM publication_search_document AS source
    WHERE source.publication_id = ?1
      AND NOT EXISTS (
        SELECT 1 FROM publication_search_fts AS indexed
        WHERE indexed.publication_id = source.publication_id
          AND indexed.document_id = source.document_id
          AND indexed.normalized_name = source.normalized_name
          AND indexed.aliases = source.aliases_json
          AND indexed.publisher_name = source.publisher_name
          AND indexed.provider_model_ids = source.provider_model_ids_json
          AND indexed.document_text = source.document_text
      )
  )
  OR EXISTS (
    SELECT 1 FROM publication_search_fts AS indexed
    WHERE indexed.publication_id = ?1
      AND NOT EXISTS (
        SELECT 1 FROM publication_search_document AS source
        WHERE source.publication_id = indexed.publication_id
          AND source.document_id = indexed.document_id
          AND source.normalized_name = indexed.normalized_name
          AND source.aliases_json = indexed.aliases
          AND source.publisher_name = indexed.publisher_name
          AND source.provider_model_ids_json = indexed.provider_model_ids
          AND source.document_text = indexed.document_text
      )
  )
THEN json('') ELSE 1 END AS verified,
changes() AS transitioned`;

export const READINESS_COMMIT_ERROR_CODES = [
  "stale",
  "conflict",
  "integrity_failure",
  "not_applied",
  "outcome_unknown",
] as const;

export type ReadinessCommitErrorCode =
  (typeof READINESS_COMMIT_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<ReadinessCommitErrorCode, string>> = {
  stale: "The publication lifecycle changed before readiness could commit.",
  conflict: "Persisted readiness evidence conflicts with this operation.",
  integrity_failure:
    "Persisted publication readiness state failed integrity checks.",
  not_applied:
    "The readiness commit did not apply; the same projection may be retried.",
  outcome_unknown:
    "The readiness commit outcome could not be reconciled safely.",
};

export class ReadinessCommitError extends Error {
  readonly code: ReadinessCommitErrorCode;
  readonly retrySameProjection: boolean;

  constructor(code: ReadinessCommitErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ReadinessCommitError";
    this.code = code;
    this.retrySameProjection = code === "not_applied";
  }
}

export type ReadinessCommitResult = Readonly<{
  outcome: "applied" | "idempotent_success";
  publicationId: string;
  readyAtMs: number;
}>;

const PUBLICATION_STATES = new Set<string>([
  "building",
  "failed",
  "ready",
  "active",
  "superseded",
  "rolled_back",
]);

const BINDING_KEYS = [
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
] as const satisfies readonly (keyof ServingReadinessReceiptBindingRow)[];
const ARCHIVE_KEYS = [
  "publication_id",
  "kind",
  "retained_bundle_hash",
  "immutable",
] as const satisfies readonly (keyof ServingArchiveReceiptRow)[];
const SERVING_KEYS = [
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
] as const satisfies readonly (keyof ServingServingReceiptRow)[];
const VECTOR_KEYS = [
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
] as const satisfies readonly (keyof ServingVectorReceiptRow)[];
const PROBE_KEYS = [
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
] as const satisfies readonly (keyof ServingProbeReceiptRow)[];
const ATTESTATION_KEYS = [
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
] as const satisfies readonly (keyof ServingReadinessAttestationProjection)[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSuccessfulResult = (value: unknown): boolean =>
  isRecord(value) && value.success === true;

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...keys].sort());
};

const decodeRows = <Row extends Readonly<Record<string, unknown>>>(
  result: D1Result,
  keys: readonly (keyof Row & string)[],
  maximum: number,
): readonly Row[] => {
  if (result.results.length > maximum)
    throw new ReadinessCommitError("integrity_failure");
  return Object.freeze(
    result.results.map((row) => {
      if (!isRecord(row) || !hasExactKeys(row, keys))
        throw new ReadinessCommitError("integrity_failure");
      return row as Row;
    }),
  );
};

type Snapshot = Readonly<{
  publicationState: PublicationState;
  publicationReadyAtMs: number | null;
  publicationClosureHash: string;
  receiptRows: ServingReadinessReceiptRows;
  attestation: ServingReadinessAttestationProjection | null;
}>;

const readSnapshot = async (
  session: D1DatabaseSession,
  expected: ServingReadinessCommitProjection,
): Promise<Snapshot> => {
  const publicationId = expected.transition.publication_id;
  const results = await session.batch([
    session.prepare(SELECT_PUBLICATION_SQL).bind(publicationId),
    session.prepare(SELECT_BINDINGS_SQL).bind(publicationId),
    session.prepare(SELECT_ARCHIVE_SQL).bind(publicationId),
    session.prepare(SELECT_SERVING_SQL).bind(publicationId),
    session.prepare(SELECT_VECTOR_SQL).bind(publicationId),
    session.prepare(SELECT_PROBE_SQL).bind(publicationId),
    session.prepare(SELECT_ATTESTATION_SQL).bind(publicationId),
  ]);
  if (results.length !== 7) throw new ReadinessCommitError("integrity_failure");
  if (results.some((result) => !isSuccessfulResult(result)))
    throw new ReadinessCommitError("integrity_failure");
  const [
    publicationResult,
    bindingResult,
    archiveResult,
    servingResult,
    vectorResult,
    probeResult,
    attestationResult,
  ] = results;
  if (
    publicationResult === undefined ||
    bindingResult === undefined ||
    archiveResult === undefined ||
    servingResult === undefined ||
    vectorResult === undefined ||
    probeResult === undefined ||
    attestationResult === undefined
  )
    throw new ReadinessCommitError("integrity_failure");
  const publication = publicationResult.results;
  if (publication.length !== 1 || !isRecord(publication[0]))
    throw new ReadinessCommitError("integrity_failure");
  const row = publication[0];
  if (
    !hasExactKeys(row, [
      "state",
      "ready_at_ms",
      "closure_hash",
      "seal_closure_hash",
      "seal_bundle_hash",
    ]) ||
    typeof row.state !== "string" ||
    !PUBLICATION_STATES.has(row.state) ||
    (row.ready_at_ms !== null &&
      (typeof row.ready_at_ms !== "number" ||
        !Number.isSafeInteger(row.ready_at_ms) ||
        row.ready_at_ms < 0)) ||
    typeof row.closure_hash !== "string" ||
    row.closure_hash !== expected.transition.closure_hash ||
    row.seal_closure_hash !== expected.transition.closure_hash ||
    row.seal_bundle_hash !== expected.attestation.bundle_hash
  )
    throw new ReadinessCommitError("integrity_failure");
  const bindings = decodeRows<ServingReadinessReceiptBindingRow>(
    bindingResult,
    BINDING_KEYS,
    4,
  );
  const archives = decodeRows<ServingArchiveReceiptRow>(
    archiveResult,
    ARCHIVE_KEYS,
    1,
  );
  const servings = decodeRows<ServingServingReceiptRow>(
    servingResult,
    SERVING_KEYS,
    1,
  );
  const vectors = decodeRows<ServingVectorReceiptRow>(
    vectorResult,
    VECTOR_KEYS,
    1,
  );
  const probes = decodeRows<ServingProbeReceiptRow>(probeResult, PROBE_KEYS, 1);
  const attestations = decodeRows<ServingReadinessAttestationProjection>(
    attestationResult,
    ATTESTATION_KEYS,
    1,
  );
  return Object.freeze({
    publicationState: row.state as PublicationState,
    publicationReadyAtMs: row.ready_at_ms,
    publicationClosureHash: row.closure_hash,
    receiptRows: Object.freeze({
      bindings,
      archives,
      servings,
      vectors,
      probes,
    }),
    attestation: attestations[0] ?? null,
  });
};

const bindingValues = (
  row: ServingReadinessReceiptBindingRow,
): readonly unknown[] => [
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
];
const archiveValues = (row: ServingArchiveReceiptRow): readonly unknown[] => [
  row.publication_id,
  row.kind,
  row.retained_bundle_hash,
  row.immutable,
];
const servingValues = (row: ServingServingReceiptRow): readonly unknown[] => [
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
];
const vectorValues = (row: ServingVectorReceiptRow): readonly unknown[] => [
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
];
const probeValues = (row: ServingProbeReceiptRow): readonly unknown[] => [
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
];
const attestationValues = (
  row: ServingReadinessAttestationProjection,
): readonly unknown[] => [
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
];

const requireOne = <Row>(rows: readonly Row[], label: string): Row => {
  const row = rows[0];
  if (rows.length !== 1 || row === undefined)
    throw new ReadinessCommitError("integrity_failure");
  void label;
  return row;
};

const receiptAssertionValues = (
  rows: ServingReadinessReceiptRows,
): readonly unknown[] => [
  ...rows.bindings.flatMap(bindingValues),
  ...archiveValues(requireOne(rows.archives, "archive")),
  ...servingValues(requireOne(rows.servings, "serving")),
  ...vectorValues(requireOne(rows.vectors, "vector")),
  ...probeValues(requireOne(rows.probes, "probe")),
];

const classify = async (
  database: D1Database,
  expected: ServingReadinessCommitProjection,
): Promise<ReturnType<typeof classifyServingReadinessCommitRetry>> => {
  const snapshot = await readSnapshot(
    database.withSession("first-primary"),
    expected,
  );
  return classifyServingReadinessCommitRetry({ expected, ...snapshot });
};

const throwDecision = (
  outcome: Exclude<
    ReturnType<typeof classifyServingReadinessCommitRetry>["outcome"],
    "execute" | "idempotent_success"
  >,
): never => {
  throw new ReadinessCommitError(outcome);
};

const success = (
  expected: ServingReadinessCommitProjection,
  outcome: ReadinessCommitResult["outcome"],
): ReadinessCommitResult =>
  Object.freeze({
    outcome,
    publicationId: expected.transition.publication_id,
    readyAtMs: expected.transition.ready_at_ms,
  });

const exactAssertion = (
  result: D1Result | undefined,
  keys: readonly string[],
): Record<string, unknown> => {
  const row = result?.results[0];
  if (
    result?.success !== true ||
    result.results.length !== 1 ||
    !isRecord(row) ||
    !hasExactKeys(row, keys)
  )
    throw new Error("ambiguous D1 batch result");
  return row;
};

/** Executes only the ADR 0019 fixed fourteen-statement readiness transaction. */
export const applyReadinessCommit = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ReadinessCommitResult> => {
  try {
    assertServingReadinessCommitProjection(expectedValue);
  } catch {
    throw new ReadinessCommitError("integrity_failure");
  }
  const expected: ServingReadinessCommitProjection = expectedValue;
  let initial: ReturnType<typeof classifyServingReadinessCommitRetry>;
  try {
    initial = await classify(database, expected);
  } catch (error) {
    if (error instanceof ReadinessCommitError) throw error;
    throw new ReadinessCommitError("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success")
    return success(expected, "idempotent_success");
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);

  const bindings = expected.receiptRows.bindings;
  const archive = requireOne(expected.receiptRows.archives, "archive");
  const serving = requireOne(expected.receiptRows.servings, "serving");
  const vector = requireOne(expected.receiptRows.vectors, "vector");
  const probe = requireOne(expected.receiptRows.probes, "probe");
  if (bindings.length !== 4)
    throw new ReadinessCommitError("integrity_failure");
  const receiptValues = receiptAssertionValues(expected.receiptRows);
  const attestValues = attestationValues(expected.attestation);
  try {
    const session = database.withSession("first-primary");
    const results = await session.batch([
      session
        .prepare(ASSERT_ZERO_BUILDING_LEDGER_SQL)
        .bind(
          expected.transition.publication_id,
          expected.transition.closure_hash,
        ),
      ...bindings.map((row) =>
        session.prepare(INSERT_BINDING_SQL).bind(...bindingValues(row)),
      ),
      session
        .prepare(INSERT_ARCHIVE_SQL)
        .bind(
          ...archiveValues(archive),
          expected.transition.closure_hash,
          expected.attestation.bundle_hash,
        ),
      session
        .prepare(INSERT_SERVING_SQL)
        .bind(
          ...servingValues(serving),
          expected.transition.closure_hash,
          expected.attestation.bundle_hash,
        ),
      session
        .prepare(INSERT_VECTOR_SQL)
        .bind(
          ...vectorValues(vector),
          expected.transition.closure_hash,
          expected.attestation.bundle_hash,
        ),
      session
        .prepare(INSERT_PROBE_SQL)
        .bind(
          ...probeValues(probe),
          expected.transition.closure_hash,
          expected.attestation.bundle_hash,
        ),
      session.prepare(ASSERT_RECEIPTS_SQL).bind(...receiptValues),
      session.prepare(INSERT_ATTESTATION_SQL).bind(...attestValues),
      session.prepare(ASSERT_ATTESTATION_SQL).bind(...attestValues),
      session
        .prepare(UPDATE_READY_SQL)
        .bind(
          expected.transition.publication_id,
          expected.transition.ready_at_ms,
          expected.transition.closure_hash,
        ),
      session
        .prepare(ASSERT_POSTCONDITION_SQL)
        .bind(...receiptValues, ...attestValues),
    ]);
    if (results.length !== 14) throw new Error("ambiguous D1 batch result");
    if (exactAssertion(results[0], ["clean"]).clean !== 1)
      throw new Error("ambiguous D1 precondition result");
    if (exactAssertion(results[9], ["verified"]).verified !== 1)
      throw new Error("ambiguous D1 receipt assertion result");
    if (exactAssertion(results[11], ["verified"]).verified !== 1)
      throw new Error("ambiguous D1 attestation assertion result");
    const postcondition = exactAssertion(results[13], [
      "verified",
      "transitioned",
    ]);
    if (
      postcondition.verified !== 1 ||
      (postcondition.transitioned !== 0 && postcondition.transitioned !== 1)
    )
      throw new Error("ambiguous D1 postcondition result");
    return success(
      expected,
      postcondition.transitioned === 1 ? "applied" : "idempotent_success",
    );
  } catch {
    let reconciled: ReturnType<typeof classifyServingReadinessCommitRetry>;
    try {
      reconciled = await classify(database, expected);
    } catch (error) {
      if (error instanceof ReadinessCommitError) throw error;
      throw new ReadinessCommitError("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success")
      return success(expected, "idempotent_success");
    if (reconciled.outcome === "execute")
      throw new ReadinessCommitError("not_applied");
    return throwDecision(reconciled.outcome);
  }
};
