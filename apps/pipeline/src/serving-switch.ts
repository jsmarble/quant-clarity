import {
  assertServingSwitchProjection,
  assertServingSwitchProjectionV2,
  classifyServingSwitchRetry,
  classifyServingSwitchRetryV2,
  readServingSwitchPersistenceV2,
  type PublicationState,
  type ServingSwitchHistoryRow,
  type ServingSwitchPreflightRow,
  type ServingSwitchProjection,
  type ServingSwitchPreflightProofV2,
  type ServingSwitchProjectionV2,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

const SELECT_HEAD_SQL = `SELECT
  active_publication_id,
  rollback_candidate_publication_id,
  switched_at_ms,
  generation
FROM publication_head
WHERE singleton = 1`;

const SELECT_PREFLIGHT_SQL = `SELECT
  switch_id, preflight_version, preflight_hash, action, environment,
  expected_prior_generation, expected_prior_rollback_candidate_publication_id,
  expected_prior_switched_at_ms, new_generation, from_publication_id,
  from_closure_hash, to_publication_id, to_closure_hash, to_attestation_hash,
  switched_at_ms, observed_at_ms, maximum_age_ms, valid_until_ms,
  fts_build_version, fts_source_document_count, fts_index_document_count,
  fts_source_inventory_hash, fts_exact_parity, archive_bundle_hash,
  archive_immutable, vector_namespace, vector_document_count,
  vector_verified_document_count, vector_inventory_hash,
  vector_visibility_probe_version, vector_mutation_id, vector_all_ids_present,
  vector_all_namespaces_match, vector_queryable, probe_set_version,
  integrity_passed, exact_search_passed, semantic_search_passed,
  structured_filter_passed, neutrality_passed, version_isolation_passed
FROM publication_switch_preflight
WHERE new_generation = ?1`;

const SELECT_HISTORY_SQL = `SELECT
  switch_id, event_version, event_hash, preflight_hash, action,
  expected_prior_generation, expected_prior_rollback_candidate_publication_id,
  expected_prior_switched_at_ms, new_generation, from_publication_id,
  from_closure_hash, to_publication_id, to_closure_hash, to_attestation_hash,
  resulting_rollback_candidate_publication_id, switched_at_ms,
  authorized_by_kind, authorized_identity_id
FROM publication_switch_history
WHERE new_generation = ?1`;

const SELECT_STATES_SQL = `SELECT
  (SELECT state FROM publication WHERE publication_id = ?1) AS target_state,
  CASE WHEN ?2 IS NULL THEN NULL ELSE
    (SELECT state FROM publication WHERE publication_id = ?2)
  END AS former_state`;

const INSERT_PREFLIGHT_SQL = `INSERT INTO publication_switch_preflight (
  switch_id, preflight_version, preflight_hash, action, environment,
  expected_prior_generation, expected_prior_rollback_candidate_publication_id,
  expected_prior_switched_at_ms, new_generation, from_publication_id,
  from_closure_hash, to_publication_id, to_closure_hash, to_attestation_hash,
  switched_at_ms, observed_at_ms, maximum_age_ms, valid_until_ms,
  fts_build_version, fts_source_document_count, fts_index_document_count,
  fts_source_inventory_hash, fts_exact_parity, archive_bundle_hash,
  archive_immutable, vector_namespace, vector_document_count,
  vector_verified_document_count, vector_inventory_hash,
  vector_visibility_probe_version, vector_mutation_id, vector_all_ids_present,
  vector_all_namespaces_match, vector_queryable, probe_set_version,
  integrity_passed, exact_search_passed, semantic_search_passed,
  structured_filter_passed, neutrality_passed, version_isolation_passed
) VALUES (
  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
  ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27,
  ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40,
  ?41
)`;

const INSERT_HISTORY_SQL = `INSERT INTO publication_switch_history (
  switch_id, event_version, event_hash, preflight_hash, action,
  expected_prior_generation, expected_prior_rollback_candidate_publication_id,
  expected_prior_switched_at_ms, new_generation, from_publication_id,
  from_closure_hash, to_publication_id, to_closure_hash, to_attestation_hash,
  resulting_rollback_candidate_publication_id, switched_at_ms,
  authorized_by_kind, authorized_identity_id
) VALUES (
  ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
  ?16, ?17, ?18
)`;

const ASSERT_POSTCONDITION_SQL = `SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1
    FROM publication_switch_preflight AS preflight
    JOIN publication_switch_history AS history USING (switch_id)
    JOIN publication_head AS head ON head.singleton = 1
    JOIN publication AS target
      ON target.publication_id = history.to_publication_id
    JOIN publication_closure_seal AS seal
      ON seal.publication_id = target.publication_id
    WHERE preflight.switch_id = ?1
      AND preflight.preflight_hash = ?2
      AND history.event_hash = ?3
      AND history.preflight_hash = preflight.preflight_hash
      AND history.new_generation = ?4
      AND history.to_publication_id = ?5
      AND head.generation = history.new_generation
      AND head.active_publication_id = history.to_publication_id
      AND head.rollback_candidate_publication_id IS history.resulting_rollback_candidate_publication_id
      AND head.switched_at_ms = history.switched_at_ms
      AND target.state = 'active'
      AND target.closure_hash = history.to_closure_hash
      AND seal.closure_hash = history.to_closure_hash
      AND (
        history.from_publication_id IS NULL OR EXISTS (
          SELECT 1 FROM publication AS former
          WHERE former.publication_id = history.from_publication_id
            AND former.closure_hash = history.from_closure_hash
            AND former.state = CASE history.action
              WHEN 'activate' THEN 'superseded'
              ELSE 'rolled_back'
            END
        )
      )
  ) OR (
    SELECT count(*) FROM publication_search_document
    WHERE publication_id = ?5
  ) <> (
    SELECT fts_source_document_count FROM publication_switch_preflight
    WHERE switch_id = ?1
  ) OR (
    SELECT count(*) FROM publication_search_fts
    WHERE publication_id = ?5
  ) <> (
    SELECT fts_index_document_count FROM publication_switch_preflight
    WHERE switch_id = ?1
  ) OR EXISTS (
    SELECT 1 FROM publication_search_document AS source
    WHERE source.publication_id = ?5
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
  ) OR EXISTS (
    SELECT 1 FROM publication_search_fts AS indexed
    WHERE indexed.publication_id = ?5
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
THEN json('') ELSE 1 END AS verified`;

export const SERVING_SWITCH_ERROR_CODES = [
  "stale",
  "conflict",
  "integrity_failure",
  "not_applied",
  "outcome_unknown",
] as const;

export type ServingSwitchErrorCode =
  (typeof SERVING_SWITCH_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<ServingSwitchErrorCode, string>> = {
  stale: "The publication head changed before the switch could commit.",
  conflict: "Persisted switch authorization conflicts with this operation.",
  integrity_failure:
    "Persisted publication switch state failed integrity checks.",
  not_applied:
    "The publication switch did not commit; the same projection may be retried.",
  outcome_unknown:
    "The publication switch outcome could not be reconciled safely.",
};

export class ServingSwitchError extends Error {
  readonly code: ServingSwitchErrorCode;
  readonly retrySameProjection: boolean;

  constructor(code: ServingSwitchErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ServingSwitchError";
    this.code = code;
    this.retrySameProjection = code === "not_applied";
  }
}

export type ServingSwitchResult = Readonly<{
  outcome: "applied" | "idempotent_success";
  switchId: string;
  generation: number;
}>;

type Snapshot = Readonly<{
  currentHead: StoredPublicationHead | null;
  preflightAtGeneration: ServingSwitchPreflightRow | null;
  historyAtGeneration: ServingSwitchHistoryRow | null;
  targetState: PublicationState;
  formerState: PublicationState | null;
}>;

const PUBLICATION_STATES = new Set<string>([
  "building",
  "failed",
  "ready",
  "active",
  "superseded",
  "rolled_back",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
};

const decodeHead = (value: unknown): StoredPublicationHead | null => {
  if (value === undefined) return null;
  const keys = [
    "active_publication_id",
    "rollback_candidate_publication_id",
    "switched_at_ms",
    "generation",
  ] as const;
  if (!isRecord(value) || !exactKeys(value, keys))
    throw new ServingSwitchError("integrity_failure");
  const active = value.active_publication_id;
  const rollback = value.rollback_candidate_publication_id;
  const switchedAtMs = value.switched_at_ms;
  const generation = value.generation;
  if (
    typeof active !== "string" ||
    (rollback !== null && typeof rollback !== "string") ||
    typeof switchedAtMs !== "number" ||
    !Number.isSafeInteger(switchedAtMs) ||
    switchedAtMs < 0 ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  )
    throw new ServingSwitchError("integrity_failure");
  let switchedAt: string;
  try {
    switchedAt = new Date(switchedAtMs).toISOString();
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
  return {
    activePublicationId: active as StoredPublicationHead["activePublicationId"],
    rollbackCandidatePublicationId:
      rollback as StoredPublicationHead["rollbackCandidatePublicationId"],
    switchedAt,
    generation,
  };
};

const PREFLIGHT_KEYS = [
  "switch_id",
  "preflight_version",
  "preflight_hash",
  "action",
  "environment",
  "expected_prior_generation",
  "expected_prior_rollback_candidate_publication_id",
  "expected_prior_switched_at_ms",
  "new_generation",
  "from_publication_id",
  "from_closure_hash",
  "to_publication_id",
  "to_closure_hash",
  "to_attestation_hash",
  "switched_at_ms",
  "observed_at_ms",
  "maximum_age_ms",
  "valid_until_ms",
  "fts_build_version",
  "fts_source_document_count",
  "fts_index_document_count",
  "fts_source_inventory_hash",
  "fts_exact_parity",
  "archive_bundle_hash",
  "archive_immutable",
  "vector_namespace",
  "vector_document_count",
  "vector_verified_document_count",
  "vector_inventory_hash",
  "vector_visibility_probe_version",
  "vector_mutation_id",
  "vector_all_ids_present",
  "vector_all_namespaces_match",
  "vector_queryable",
  "probe_set_version",
  "integrity_passed",
  "exact_search_passed",
  "semantic_search_passed",
  "structured_filter_passed",
  "neutrality_passed",
  "version_isolation_passed",
] as const satisfies readonly (keyof ServingSwitchPreflightRow)[];

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

const decodeExactRow = <T extends Readonly<Record<string, unknown>>>(
  value: unknown,
  keys: readonly (keyof T & string)[],
): T | null => {
  if (value === undefined) return null;
  if (!isRecord(value) || !exactKeys(value, keys))
    throw new ServingSwitchError("integrity_failure");
  return value as T;
};

const decodeState = (value: unknown): PublicationState => {
  if (typeof value !== "string" || !PUBLICATION_STATES.has(value))
    throw new ServingSwitchError("integrity_failure");
  return value as PublicationState;
};

const readSnapshot = async (
  session: D1DatabaseSession,
  expected: ServingSwitchProjection,
): Promise<Snapshot> => {
  const results = await session.batch([
    session.prepare(SELECT_HEAD_SQL),
    session.prepare(SELECT_PREFLIGHT_SQL).bind(expected.history.new_generation),
    session.prepare(SELECT_HISTORY_SQL).bind(expected.history.new_generation),
    session
      .prepare(SELECT_STATES_SQL)
      .bind(
        expected.history.to_publication_id,
        expected.history.from_publication_id,
      ),
  ]);
  if (
    results.length !== 4 ||
    results.some((result) => result.results.length > 1)
  )
    throw new ServingSwitchError("integrity_failure");
  const states = results[3]?.results[0];
  if (!isRecord(states) || !exactKeys(states, ["target_state", "former_state"]))
    throw new ServingSwitchError("integrity_failure");
  const targetState = decodeState(states.target_state);
  const formerState =
    expected.history.from_publication_id === null
      ? states.former_state === null
        ? null
        : (() => {
            throw new ServingSwitchError("integrity_failure");
          })()
      : decodeState(states.former_state);
  return Object.freeze({
    currentHead: decodeHead(results[0]?.results[0]),
    preflightAtGeneration: decodeExactRow<ServingSwitchPreflightRow>(
      results[1]?.results[0],
      PREFLIGHT_KEYS,
    ),
    historyAtGeneration: decodeExactRow<ServingSwitchHistoryRow>(
      results[2]?.results[0],
      HISTORY_KEYS,
    ),
    targetState,
    formerState,
  });
};

const preflightValues = (
  row: ServingSwitchPreflightRow,
): readonly unknown[] => [
  row.switch_id,
  row.preflight_version,
  row.preflight_hash,
  row.action,
  row.environment,
  row.expected_prior_generation,
  row.expected_prior_rollback_candidate_publication_id,
  row.expected_prior_switched_at_ms,
  row.new_generation,
  row.from_publication_id,
  row.from_closure_hash,
  row.to_publication_id,
  row.to_closure_hash,
  row.to_attestation_hash,
  row.switched_at_ms,
  row.observed_at_ms,
  row.maximum_age_ms,
  row.valid_until_ms,
  row.fts_build_version,
  row.fts_source_document_count,
  row.fts_index_document_count,
  row.fts_source_inventory_hash,
  row.fts_exact_parity,
  row.archive_bundle_hash,
  row.archive_immutable,
  row.vector_namespace,
  row.vector_document_count,
  row.vector_verified_document_count,
  row.vector_inventory_hash,
  row.vector_visibility_probe_version,
  row.vector_mutation_id,
  row.vector_all_ids_present,
  row.vector_all_namespaces_match,
  row.vector_queryable,
  row.probe_set_version,
  row.integrity_passed,
  row.exact_search_passed,
  row.semantic_search_passed,
  row.structured_filter_passed,
  row.neutrality_passed,
  row.version_isolation_passed,
];

const historyValues = (row: ServingSwitchHistoryRow): readonly unknown[] => [
  row.switch_id,
  row.event_version,
  row.event_hash,
  row.preflight_hash,
  row.action,
  row.expected_prior_generation,
  row.expected_prior_rollback_candidate_publication_id,
  row.expected_prior_switched_at_ms,
  row.new_generation,
  row.from_publication_id,
  row.from_closure_hash,
  row.to_publication_id,
  row.to_closure_hash,
  row.to_attestation_hash,
  row.resulting_rollback_candidate_publication_id,
  row.switched_at_ms,
  row.authorized_by_kind,
  row.authorized_identity_id,
];

const classify = async (
  database: D1Database,
  expected: ServingSwitchProjection,
): Promise<ReturnType<typeof classifyServingSwitchRetry>> => {
  const session = database.withSession("first-primary");
  const snapshot = await readSnapshot(session, expected);
  return classifyServingSwitchRetry({ expected, ...snapshot });
};

const throwDecision = (
  outcome: Exclude<
    ReturnType<typeof classifyServingSwitchRetry>["outcome"],
    "execute" | "idempotent_success"
  >,
): never => {
  throw new ServingSwitchError(outcome);
};

const success = (
  expected: ServingSwitchProjection,
  outcome: ServingSwitchResult["outcome"],
): ServingSwitchResult =>
  Object.freeze({
    outcome,
    switchId: expected.history.switch_id,
    generation: expected.history.new_generation,
  });

/** Executes only the ADR 0020 three-statement switch transaction. */
export const applyServingSwitch = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ServingSwitchResult> => {
  try {
    assertServingSwitchProjection(expectedValue);
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
  const expected: ServingSwitchProjection = expectedValue;
  let initial: ReturnType<typeof classifyServingSwitchRetry>;
  try {
    initial = await classify(database, expected);
  } catch (error) {
    if (error instanceof ServingSwitchError) throw error;
    throw new ServingSwitchError("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success")
    return success(expected, "idempotent_success");
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);

  try {
    const session = database.withSession("first-primary");
    const results = await session.batch([
      session
        .prepare(INSERT_PREFLIGHT_SQL)
        .bind(...preflightValues(expected.preflight)),
      session
        .prepare(INSERT_HISTORY_SQL)
        .bind(...historyValues(expected.history)),
      session
        .prepare(ASSERT_POSTCONDITION_SQL)
        .bind(
          expected.history.switch_id,
          expected.preflight.preflight_hash,
          expected.history.event_hash,
          expected.history.new_generation,
          expected.history.to_publication_id,
        ),
    ]);
    const verification = results[2]?.results;
    if (
      results.length !== 3 ||
      verification?.length !== 1 ||
      !isRecord(verification[0]) ||
      !exactKeys(verification[0], ["verified"]) ||
      verification[0].verified !== 1
    )
      throw new Error("ambiguous batch result");
    return success(expected, "applied");
  } catch {
    let reconciled: ReturnType<typeof classifyServingSwitchRetry>;
    try {
      reconciled = await classify(database, expected);
    } catch (error) {
      if (error instanceof ServingSwitchError) throw error;
      throw new ServingSwitchError("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success")
      return success(expected, "idempotent_success");
    if (reconciled.outcome === "execute")
      throw new ServingSwitchError("not_applied");
    return throwDecision(reconciled.outcome);
  }
};

const SELECT_PREFLIGHT_V2_SQL = `SELECT
  switch_id, preflight_version, preflight_hash, action, environment,
  expected_prior_generation, expected_prior_rollback_candidate_publication_id,
  expected_prior_switched_at_ms, new_generation, from_publication_id,
  from_closure_hash, to_publication_id, to_closure_hash, to_attestation_hash,
  switched_at_ms, observed_at_ms, maximum_age_ms, valid_until_ms,
  fts_build_version, fts_source_document_count, fts_index_document_count,
  fts_source_inventory_hash, fts_exact_parity, archive_bundle_hash,
  archive_immutable, vector_namespace, vector_document_count,
  vector_verified_document_count, vector_inventory_hash,
  vector_visibility_probe_version, vector_mutation_id, vector_all_ids_present,
  vector_all_namespaces_match, vector_queryable, probe_set_version,
  integrity_passed, exact_search_passed, semantic_search_passed,
  structured_filter_passed, neutrality_passed, version_isolation_passed,
  provider_search_projection_version, provider_search_document_count,
  provider_search_inventory_hash, provider_search_fts_build_version,
  provider_search_fts_document_count, provider_search_fts_queryable,
  provider_search_exact_parity
FROM publication_switch_preflight WHERE new_generation = ?1`;

const INSERT_PREFLIGHT_V2_SQL = `INSERT INTO publication_switch_preflight (
  switch_id, preflight_version, preflight_hash, action, environment,
  expected_prior_generation, expected_prior_rollback_candidate_publication_id,
  expected_prior_switched_at_ms, new_generation, from_publication_id,
  from_closure_hash, to_publication_id, to_closure_hash, to_attestation_hash,
  switched_at_ms, observed_at_ms, maximum_age_ms, valid_until_ms,
  fts_build_version, fts_source_document_count, fts_index_document_count,
  fts_source_inventory_hash, fts_exact_parity, archive_bundle_hash,
  archive_immutable, vector_namespace, vector_document_count,
  vector_verified_document_count, vector_inventory_hash,
  vector_visibility_probe_version, vector_mutation_id, vector_all_ids_present,
  vector_all_namespaces_match, vector_queryable, probe_set_version,
  integrity_passed, exact_search_passed, semantic_search_passed,
  structured_filter_passed, neutrality_passed, version_isolation_passed,
  provider_search_projection_version, provider_search_document_count,
  provider_search_inventory_hash, provider_search_fts_build_version,
  provider_search_fts_document_count, provider_search_fts_queryable,
  provider_search_exact_parity
) VALUES (
  ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,
  ?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,
  ?31,?32,?33,?34,?35,?36,?37,?38,?39,?40,?41,?42,?43,?44,
  ?45,?46,?47,?48
)`;

const ASSERT_POSTCONDITION_V2_SQL = `SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1
    FROM publication_switch_preflight AS preflight
    JOIN publication_switch_history AS history USING (switch_id)
    JOIN publication_head AS head ON head.singleton = 1
    JOIN publication AS target ON target.publication_id = history.to_publication_id
    JOIN publication_closure_seal AS seal ON seal.publication_id = target.publication_id
    WHERE preflight.switch_id = ?1
      AND preflight.preflight_hash = ?2
      AND preflight.preflight_version = '2.0.0'
      AND history.event_hash = ?3
      AND history.preflight_hash = preflight.preflight_hash
      AND history.new_generation = ?4
      AND history.to_publication_id = ?5
      AND head.generation = history.new_generation
      AND head.active_publication_id = history.to_publication_id
      AND head.rollback_candidate_publication_id IS history.resulting_rollback_candidate_publication_id
      AND head.switched_at_ms = history.switched_at_ms
      AND target.state = 'active'
      AND target.closure_hash = history.to_closure_hash
      AND seal.closure_hash = history.to_closure_hash
      AND preflight.provider_search_projection_version = ?6
      AND preflight.provider_search_document_count = ?7
      AND preflight.provider_search_inventory_hash = ?8
      AND preflight.provider_search_fts_build_version = ?9
      AND preflight.provider_search_fts_document_count = ?7
      AND preflight.provider_search_fts_queryable = 1
      AND preflight.provider_search_exact_parity = 1
      AND (history.from_publication_id IS NULL OR EXISTS (
        SELECT 1 FROM publication AS former
        WHERE former.publication_id = history.from_publication_id
          AND former.closure_hash = history.from_closure_hash
          AND former.state = CASE history.action
            WHEN 'activate' THEN 'superseded' ELSE 'rolled_back' END
      ))
  )
  OR (SELECT count(*) FROM publication_search_document WHERE publication_id = ?5)
     <> (SELECT fts_source_document_count FROM publication_switch_preflight WHERE switch_id = ?1)
  OR (SELECT count(*) FROM publication_search_fts WHERE publication_id = ?5)
     <> (SELECT fts_index_document_count FROM publication_switch_preflight WHERE switch_id = ?1)
  OR (SELECT count(*) FROM publication_provider_search_document WHERE publication_id = ?5) <> ?7
  OR (SELECT count(*) FROM publication_provider_search_fts WHERE publication_id = ?5) <> ?7
  OR EXISTS (
    SELECT 1 FROM publication_provider_search_document AS source
    WHERE source.publication_id = ?5 AND NOT EXISTS (
      SELECT 1 FROM publication_provider_search_fts AS indexed
      WHERE indexed.publication_id = source.publication_id
        AND indexed.provider_id = source.provider_id
        AND indexed.display_name = source.display_name
    )
  )
  OR EXISTS (
    SELECT 1 FROM publication_provider_search_fts AS indexed
    WHERE indexed.publication_id = ?5 AND NOT EXISTS (
      SELECT 1 FROM publication_provider_search_document AS source
      WHERE source.publication_id = indexed.publication_id
        AND source.provider_id = indexed.provider_id
        AND source.display_name = indexed.display_name
    )
  )
THEN json('') ELSE 1 END AS verified`;

const PREFLIGHT_V2_KEYS = [
  ...PREFLIGHT_KEYS,
  "provider_search_projection_version",
  "provider_search_document_count",
  "provider_search_inventory_hash",
  "provider_search_fts_build_version",
  "provider_search_fts_document_count",
  "provider_search_fts_queryable",
  "provider_search_exact_parity",
] as const satisfies readonly (keyof ServingSwitchPreflightProofV2)[];

const preflightValuesV2 = (
  row: ServingSwitchPreflightProofV2,
): readonly unknown[] => PREFLIGHT_V2_KEYS.map((key) => row[key]);

const readSnapshotV2 = async (
  session: D1DatabaseSession,
  expected: ServingSwitchProjectionV2,
) => {
  const state = readServingSwitchPersistenceV2(expected);
  const results = await session.batch([
    session.prepare(SELECT_HEAD_SQL),
    session.prepare(SELECT_PREFLIGHT_V2_SQL).bind(state.history.new_generation),
    session.prepare(SELECT_HISTORY_SQL).bind(state.history.new_generation),
    session
      .prepare(SELECT_STATES_SQL)
      .bind(state.history.to_publication_id, state.history.from_publication_id),
  ]);
  if (
    results.length !== 4 ||
    results.some((result) => result.results.length > 1)
  )
    throw new ServingSwitchError("integrity_failure");
  const statesRow = results[3]?.results[0];
  if (
    !isRecord(statesRow) ||
    !exactKeys(statesRow, ["target_state", "former_state"])
  )
    throw new ServingSwitchError("integrity_failure");
  const targetState = decodeState(statesRow.target_state);
  const formerState =
    state.history.from_publication_id === null
      ? statesRow.former_state === null
        ? null
        : (() => {
            throw new ServingSwitchError("integrity_failure");
          })()
      : decodeState(statesRow.former_state);
  return Object.freeze({
    currentHead: decodeHead(results[0]?.results[0]),
    preflightAtGeneration: decodeExactRow<ServingSwitchPreflightProofV2>(
      results[1]?.results[0],
      PREFLIGHT_V2_KEYS,
    ),
    historyAtGeneration: decodeExactRow<ServingSwitchHistoryRow>(
      results[2]?.results[0],
      HISTORY_KEYS,
    ),
    targetState,
    formerState,
  });
};

const classifyV2 = async (
  database: D1Database,
  expected: ServingSwitchProjectionV2,
) =>
  classifyServingSwitchRetryV2({
    expected,
    ...(await readSnapshotV2(database.withSession("first-primary"), expected)),
  });

const successV2 = (
  expected: ServingSwitchProjectionV2,
  outcome: ServingSwitchResult["outcome"],
): ServingSwitchResult => {
  const state = readServingSwitchPersistenceV2(expected);
  return Object.freeze({
    outcome,
    switchId: state.history.switch_id,
    generation: state.history.new_generation,
  });
};

/** Fixed schema-1.5 provider-aware head switch transaction. */
export const applyServingSwitchV2 = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ServingSwitchResult> => {
  try {
    assertServingSwitchProjectionV2(expectedValue);
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
  const expected = expectedValue;
  const state = readServingSwitchPersistenceV2(expected);
  let initial;
  try {
    initial = await classifyV2(database, expected);
  } catch (error) {
    if (error instanceof ServingSwitchError) throw error;
    throw new ServingSwitchError("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success")
    return successV2(expected, "idempotent_success");
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);
  try {
    const session = database.withSession("first-primary");
    const results = await session.batch([
      session
        .prepare(INSERT_PREFLIGHT_V2_SQL)
        .bind(...preflightValuesV2(state.preflight)),
      session.prepare(INSERT_HISTORY_SQL).bind(...historyValues(state.history)),
      session
        .prepare(ASSERT_POSTCONDITION_V2_SQL)
        .bind(
          state.history.switch_id,
          state.preflight.preflight_hash,
          state.history.event_hash,
          state.history.new_generation,
          state.history.to_publication_id,
          state.preflight.provider_search_projection_version,
          state.preflight.provider_search_document_count,
          state.preflight.provider_search_inventory_hash,
          state.preflight.provider_search_fts_build_version,
        ),
    ]);
    const verification = results[2]?.results;
    if (
      results.length !== 3 ||
      verification?.length !== 1 ||
      !isRecord(verification[0]) ||
      !exactKeys(verification[0], ["verified"]) ||
      verification[0].verified !== 1
    )
      throw new Error("ambiguous batch result");
    return successV2(expected, "applied");
  } catch {
    let reconciled;
    try {
      reconciled = await classifyV2(database, expected);
    } catch (error) {
      if (error instanceof ServingSwitchError) throw error;
      throw new ServingSwitchError("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success")
      return successV2(expected, "idempotent_success");
    if (reconciled.outcome === "execute")
      throw new ServingSwitchError("not_applied");
    return throwDecision(reconciled.outcome);
  }
};
