import {
  assertServingReadinessCommitProjectionV2,
  classifyServingReadinessCommitRetryV2,
  readServingReadinessCommitPersistenceV2,
  type PublicationState,
  type ServingArchiveReceiptRow,
  type ServingProbeReceiptRow,
  type ServingReadinessAttestationProjectionV2,
  type ServingReadinessCommitProjectionV2,
  type ServingReadinessReceiptBindingRow,
  type ServingReadinessReceiptRowsV2,
  type ServingServingReceiptRowV2,
  type ServingVectorReceiptRow,
} from "@quant-clarity/publication-core";

const SELECT_PUBLICATION_SQL = `SELECT
  candidate.state, candidate.ready_at_ms, candidate.closure_hash,
  seal.closure_hash AS seal_closure_hash, seal.bundle_hash AS seal_bundle_hash
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
  provider_search_fts_queryable, provider_search_exact_parity
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
    )
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
  provider_search_fts_queryable, provider_search_exact_parity
) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,
  ?17,?18,?19,?20,?21,?22,?23,?24,?25)`;
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
      AND attestation.attestation_hash = ?9
  )
  AND (SELECT count(*) FROM publication_readiness_receipt
       WHERE publication_id = ?1 AND receipt_version = '2.0.0') = 4
  AND (SELECT count(*) FROM publication_provider_search_document
       WHERE publication_id = ?1) = ?6
  AND (SELECT count(*) FROM publication_provider_search_fts
       WHERE publication_id = ?1) = ?6
THEN 1 ELSE json('') END AS verified`;

export type ReadinessCommitV2ErrorCode =
  | "stale"
  | "conflict"
  | "integrity_failure"
  | "not_applied"
  | "outcome_unknown";
export class ReadinessCommitV2Error extends Error {
  readonly code: ReadinessCommitV2ErrorCode;
  readonly retrySameProjection: boolean;
  constructor(code: ReadinessCommitV2ErrorCode) {
    super("The provider-aware readiness commit could not be applied safely.");
    this.name = "ReadinessCommitV2Error";
    this.code = code;
    this.retrySameProjection = code === "not_applied";
  }
}
export type ReadinessCommitV2Result = Readonly<{
  outcome: "applied" | "idempotent_success";
  publicationId: string;
  readyAtMs: number;
}>;

const states = new Set([
  "building",
  "failed",
  "ready",
  "active",
  "superseded",
  "rolled_back",
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (row: Record<string, unknown>, keys: readonly string[]) =>
  JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...keys].sort());
const ok = (result: D1Result | undefined): result is D1Result =>
  result?.success === true;
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

const decode = <Row extends Readonly<Record<string, unknown>>>(
  result: D1Result,
  keys: readonly (keyof Row & string)[],
  maximum: number,
): readonly Row[] => {
  if (result.results.length > maximum)
    throw new ReadinessCommitV2Error("integrity_failure");
  return Object.freeze(
    result.results.map((row) => {
      if (!isRecord(row) || !exactKeys(row, keys))
        throw new ReadinessCommitV2Error("integrity_failure");
      return Object.freeze({ ...row }) as Row;
    }),
  );
};

const readSnapshot = async (
  database: D1Database,
  expected: ServingReadinessCommitProjectionV2,
) => {
  const persistence = readServingReadinessCommitPersistenceV2(expected);
  const session = database.withSession("first-primary");
  const results = await session.batch([
    session
      .prepare(SELECT_PUBLICATION_SQL)
      .bind(persistence.transition.publication_id),
    session
      .prepare(SELECT_BINDINGS_SQL)
      .bind(persistence.transition.publication_id),
    session
      .prepare(SELECT_ARCHIVE_SQL)
      .bind(persistence.transition.publication_id),
    session
      .prepare(SELECT_SERVING_SQL)
      .bind(persistence.transition.publication_id),
    session
      .prepare(SELECT_VECTOR_SQL)
      .bind(persistence.transition.publication_id),
    session
      .prepare(SELECT_PROBE_SQL)
      .bind(persistence.transition.publication_id),
    session
      .prepare(SELECT_ATTESTATION_SQL)
      .bind(persistence.transition.publication_id),
  ]);
  if (results.length !== 7 || results.some((result) => !ok(result)))
    throw new ReadinessCommitV2Error("integrity_failure");
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
    throw new ReadinessCommitV2Error("integrity_failure");
  const publication = publicationResult.results;
  const row = publication[0];
  if (
    publication.length !== 1 ||
    !isRecord(row) ||
    !exactKeys(row, [
      "state",
      "ready_at_ms",
      "closure_hash",
      "seal_closure_hash",
      "seal_bundle_hash",
    ]) ||
    typeof row.state !== "string" ||
    !states.has(row.state) ||
    (row.ready_at_ms !== null &&
      (typeof row.ready_at_ms !== "number" ||
        !Number.isSafeInteger(row.ready_at_ms) ||
        row.ready_at_ms < 0)) ||
    row.closure_hash !== persistence.transition.closure_hash ||
    row.seal_closure_hash !== persistence.transition.closure_hash ||
    row.seal_bundle_hash !== persistence.attestation.bundle_hash
  )
    throw new ReadinessCommitV2Error("integrity_failure");
  return Object.freeze({
    publicationState: row.state as PublicationState,
    publicationReadyAtMs: row.ready_at_ms,
    publicationClosureHash: row.closure_hash,
    receiptRows: Object.freeze({
      bindings: decode<ServingReadinessReceiptBindingRow>(
        bindingResult,
        bindingKeys,
        4,
      ),
      archives: decode<ServingArchiveReceiptRow>(archiveResult, archiveKeys, 1),
      servings: decode<ServingServingReceiptRowV2>(
        servingResult,
        servingKeys,
        1,
      ),
      vectors: decode<ServingVectorReceiptRow>(vectorResult, vectorKeys, 1),
      probes: decode<ServingProbeReceiptRow>(probeResult, probeKeys, 1),
    }) satisfies ServingReadinessReceiptRowsV2,
    attestation:
      decode<ServingReadinessAttestationProjectionV2>(
        attestationResult,
        attestationKeys,
        1,
      )[0] ?? null,
  });
};

const values = <Row extends Readonly<Record<string, unknown>>>(
  row: Row,
  keys: readonly (keyof Row & string)[],
) => keys.map((key) => row[key]);
const one = <Row>(rows: readonly Row[]): Row => {
  if (rows.length !== 1 || rows[0] === undefined)
    throw new ReadinessCommitV2Error("integrity_failure");
  return rows[0];
};
const classify = async (
  database: D1Database,
  expected: ServingReadinessCommitProjectionV2,
) =>
  classifyServingReadinessCommitRetryV2({
    expected,
    ...(await readSnapshot(database, expected)),
  });
const success = (
  expected: ServingReadinessCommitProjectionV2,
  outcome: ReadinessCommitV2Result["outcome"],
): ReadinessCommitV2Result => {
  const state = readServingReadinessCommitPersistenceV2(expected);
  return Object.freeze({
    outcome,
    publicationId: state.transition.publication_id,
    readyAtMs: state.transition.ready_at_ms,
  });
};
const throwDecision = (outcome: string): never => {
  throw new ReadinessCommitV2Error(outcome as ReadinessCommitV2ErrorCode);
};

/** Fixed schema-1.5 provider-aware readiness transaction (PIPE-050–PIPE-052). */
export const applyReadinessCommitV2 = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ReadinessCommitV2Result> => {
  try {
    assertServingReadinessCommitProjectionV2(expectedValue);
  } catch {
    throw new ReadinessCommitV2Error("integrity_failure");
  }
  const expected = expectedValue;
  const state = readServingReadinessCommitPersistenceV2(expected);
  let initial;
  try {
    initial = await classify(database, expected);
  } catch (error) {
    if (error instanceof ReadinessCommitV2Error) throw error;
    throw new ReadinessCommitV2Error("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success")
    return success(expected, "idempotent_success");
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);
  const rows = state.receiptRows;
  if (rows.bindings.length !== 4)
    throw new ReadinessCommitV2Error("integrity_failure");
  try {
    const session = database.withSession("first-primary");
    const serving = one(rows.servings);
    const batch = await session.batch([
      session
        .prepare(ASSERT_PRECONDITION_SQL)
        .bind(
          state.transition.publication_id,
          state.transition.closure_hash,
          state.attestation.bundle_hash,
          state.providerSearch.documents.length,
        ),
      ...rows.bindings.map((row) =>
        session.prepare(INSERT_BINDING_SQL).bind(...values(row, bindingKeys)),
      ),
      session
        .prepare(INSERT_ARCHIVE_SQL)
        .bind(...values(one(rows.archives), archiveKeys)),
      session.prepare(INSERT_SERVING_SQL).bind(...values(serving, servingKeys)),
      session
        .prepare(INSERT_VECTOR_SQL)
        .bind(...values(one(rows.vectors), vectorKeys)),
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
          state.attestation.attestation_hash,
        ),
    ]);
    if (batch.length !== 12 || batch.some((result) => !ok(result)))
      throw new Error("ambiguous D1 batch result");
    const post = batch[11]?.results[0];
    if (!isRecord(post) || post.verified !== 1)
      throw new Error("ambiguous D1 postcondition result");
    const reconciled = await classify(database, expected);
    if (reconciled.outcome !== "idempotent_success")
      throw new Error("readiness commit postcondition was not durable");
    return success(expected, "applied");
  } catch {
    let reconciled;
    try {
      reconciled = await classify(database, expected);
    } catch (error) {
      if (error instanceof ReadinessCommitV2Error) throw error;
      throw new ReadinessCommitV2Error("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success")
      return success(expected, "idempotent_success");
    if (reconciled.outcome === "execute")
      throw new ReadinessCommitV2Error("not_applied");
    return throwDecision(reconciled.outcome);
  }
};
