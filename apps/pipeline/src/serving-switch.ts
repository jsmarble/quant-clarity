import {
  assertServingSwitchProjection,
  assertServingSwitchProjectionV2,
  assertServingSwitchProjectionV3,
  classifyServingSwitchRetry,
  classifyServingSwitchRetryV2,
  classifyServingSwitchRetryV3,
  readServingSwitchPersistenceV2,
  readServingSwitchPersistenceV3,
  type PublicationState,
  type ServingSwitchHistoryRow,
  type ServingSwitchPreflightRow,
  type ServingSwitchProjection,
  type ServingSwitchPreflightProofV2,
  type ServingSwitchPreflightProofV3,
  type ServingSwitchProjectionV2,
  type ServingSwitchProjectionV3,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

import {
  assertServingSwitchProjectionV4,
  classifyServingSwitchRetryV4,
  readServingSwitchPersistenceV4,
  type ServingSwitchPreflightProofV4,
  type ServingSwitchPersistenceV4,
  type ServingSwitchProjectionV4,
} from "@quant-clarity/publication-core";

import {
  ProviderModelIdSearchStagingError,
  prepareProviderModelIdSearchAtomicAssertionsV4,
  verifyProviderModelIdSearchStorageV4,
} from "./provider-model-id-search-staging.js";

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

const SELECT_PREFLIGHT_V3_SQL = `SELECT
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
  provider_search_exact_parity, model_variant_name_projection_version,
  model_variant_name_document_count, model_variant_name_inventory_hash,
  model_variant_name_storage_version, model_variant_name_storage_document_count,
  model_variant_name_storage_queryable, model_variant_name_storage_exact_parity
FROM publication_switch_preflight WHERE new_generation = ?1`;

const INSERT_PREFLIGHT_V3_SQL = `INSERT INTO publication_switch_preflight (
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
  provider_search_exact_parity, model_variant_name_projection_version,
  model_variant_name_document_count, model_variant_name_inventory_hash,
  model_variant_name_storage_version, model_variant_name_storage_document_count,
  model_variant_name_storage_queryable, model_variant_name_storage_exact_parity
) VALUES (
  ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,
  ?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,
  ?31,?32,?33,?34,?35,?36,?37,?38,?39,?40,?41,?42,?43,?44,
  ?45,?46,?47,?48,?49,?50,?51,?52,?53,?54,?55
)`;

// The guard deliberately repeats the schema-1.6 trigger's critical facts.
// This turns a successful D1 response into evidence that the exact sealed
// target, provider FTS, and model/variant BLOB projection still match after
// the history trigger atomically changed the head.
const ASSERT_POSTCONDITION_V3_SQL = `SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1
    FROM publication_switch_preflight AS preflight
    JOIN publication_switch_history AS history USING (switch_id)
    JOIN publication_head AS head ON head.singleton = 1
    JOIN publication AS target ON target.publication_id = history.to_publication_id
    JOIN publication_closure_seal AS seal ON seal.publication_id = target.publication_id
    WHERE preflight.switch_id = ?1
      AND preflight.preflight_hash = ?2
      AND preflight.preflight_version = '3.0.0'
      AND history.event_version = '1.0.0'
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
      AND preflight.provider_search_document_count = ?6
      AND preflight.provider_search_fts_document_count = ?6
      AND preflight.provider_search_fts_queryable = 1
      AND preflight.provider_search_exact_parity = 1
      AND preflight.model_variant_name_document_count = ?7
      AND preflight.model_variant_name_storage_document_count = ?7
      AND preflight.model_variant_name_storage_queryable = 1
      AND preflight.model_variant_name_storage_exact_parity = 1
      AND preflight.valid_until_ms >= CAST(strftime('%s', 'now') AS INTEGER) * 1000
      AND (history.from_publication_id IS NULL OR EXISTS (
        SELECT 1 FROM publication AS former
        WHERE former.publication_id = history.from_publication_id
          AND former.closure_hash = history.from_closure_hash
          AND former.state = CASE history.action
            WHEN 'activate' THEN 'superseded' ELSE 'rolled_back' END
      ))
      AND (history.action = 'rollback' OR EXISTS (
        SELECT 1 FROM publication_readiness_attestation AS attestation
        WHERE attestation.publication_id = history.to_publication_id
          AND attestation.environment = preflight.environment
          AND attestation.closure_hash = history.to_closure_hash
          AND attestation.attestation_hash = history.to_attestation_hash
          AND attestation.effective_valid_until_ms >= preflight.switched_at_ms
          AND attestation.effective_valid_until_ms >= CAST(strftime('%s', 'now') AS INTEGER) * 1000
      ))
  )
  OR (SELECT count(*) FROM publication_search_document WHERE publication_id = ?5)
     <> (SELECT fts_source_document_count FROM publication_switch_preflight WHERE switch_id = ?1)
  OR (SELECT count(*) FROM publication_search_fts WHERE publication_id = ?5)
     <> (SELECT fts_index_document_count FROM publication_switch_preflight WHERE switch_id = ?1)
  OR EXISTS (
    SELECT 1 FROM publication_search_document AS source
    WHERE source.publication_id = ?5 AND NOT EXISTS (
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
    WHERE indexed.publication_id = ?5 AND NOT EXISTS (
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
  OR (SELECT count(*) FROM publication_provider_search_document WHERE publication_id = ?5) <> ?6
  OR (SELECT count(*) FROM publication_provider_search_fts WHERE publication_id = ?5) <> ?6
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
  OR (SELECT count(*) FROM publication_model_variant_name_search_document WHERE publication_id = ?5) <> ?7
  OR EXISTS (
    SELECT 1 FROM publication_model_variant_name_search_document AS projected
    WHERE projected.publication_id = ?5 AND NOT EXISTS (
      SELECT 1 FROM publication_resource AS resource
      WHERE resource.publication_id = projected.publication_id
        AND resource.resource_type = projected.resource_type
        AND resource.resource_id = projected.resource_id
        AND resource.content_hash = projected.resource_content_hash
        AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
        AND CAST(json_extract(resource.resource_json, '$.display_name.value') AS BLOB) = projected.display_name_utf8
    )
  )
  OR EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = ?5
      AND resource.resource_type IN ('model', 'variant')
      AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
      AND NOT EXISTS (
        SELECT 1 FROM publication_model_variant_name_search_document AS projected
        WHERE projected.publication_id = resource.publication_id
          AND projected.resource_type = resource.resource_type
          AND projected.resource_id = resource.resource_id
          AND projected.resource_content_hash = resource.content_hash
          AND projected.display_name_utf8 = CAST(json_extract(resource.resource_json, '$.display_name.value') AS BLOB)
      )
  )
THEN json('') ELSE 1 END AS verified`;

const PREFLIGHT_V3_KEYS = [
  ...PREFLIGHT_V2_KEYS,
  "model_variant_name_projection_version",
  "model_variant_name_document_count",
  "model_variant_name_inventory_hash",
  "model_variant_name_storage_version",
  "model_variant_name_storage_document_count",
  "model_variant_name_storage_queryable",
  "model_variant_name_storage_exact_parity",
] as const satisfies readonly (keyof ServingSwitchPreflightProofV3)[];

const preflightValuesV3 = (
  row: ServingSwitchPreflightProofV3,
): readonly unknown[] => PREFLIGHT_V3_KEYS.map((key) => row[key]);

const decodeBoundedRowV3 = <T extends Readonly<Record<string, unknown>>>(
  value: unknown,
  keys: readonly (keyof T & string)[],
  shape: T,
): T | null => {
  if (value === undefined) return null;
  if (!isRecord(value) || !exactKeys(value, keys))
    throw new ServingSwitchError("integrity_failure");
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const actual = value[key];
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
    ) {
      throw new ServingSwitchError("integrity_failure");
    }
    snapshot[key] = actual;
  }
  return Object.freeze(snapshot) as T;
};

const snapshotBatchResultsV3 = (
  value: unknown,
  expectedCount: number,
): readonly (readonly unknown[])[] => {
  if (!Array.isArray(value)) throw new ServingSwitchError("integrity_failure");
  const batchCount: unknown = value.length;
  if (batchCount !== expectedCount)
    throw new ServingSwitchError("integrity_failure");
  const batch = new Array<readonly unknown[]>(expectedCount);
  for (let index = 0; index < expectedCount; index += 1) {
    const candidate: unknown = value[index];
    if (!isRecord(candidate)) throw new ServingSwitchError("integrity_failure");
    const success: unknown = candidate.success;
    const rows: unknown = candidate.results;
    if (success !== true || !Array.isArray(rows))
      throw new ServingSwitchError("integrity_failure");
    const rowCount: unknown = rows.length;
    if (
      typeof rowCount !== "number" ||
      !Number.isSafeInteger(rowCount) ||
      rowCount < 0 ||
      rowCount > 1
    )
      throw new ServingSwitchError("integrity_failure");
    const detached = new Array<unknown>(rowCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1)
      detached[rowIndex] = rows[rowIndex] as unknown;
    batch[index] = Object.freeze(detached);
  }
  return Object.freeze(batch);
};

const readSnapshotV3 = async (
  session: D1DatabaseSession,
  expected: ServingSwitchProjectionV3,
) => {
  const state = readServingSwitchPersistenceV3(expected);
  const untrusted: unknown = await session.batch([
    session.prepare(SELECT_HEAD_SQL),
    session.prepare(SELECT_PREFLIGHT_V3_SQL).bind(state.history.new_generation),
    session.prepare(SELECT_HISTORY_SQL).bind(state.history.new_generation),
    session
      .prepare(SELECT_STATES_SQL)
      .bind(state.history.to_publication_id, state.history.from_publication_id),
  ]);
  const results = snapshotBatchResultsV3(untrusted, 4);
  const statesRow = results[3]?.[0];
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
    currentHead: decodeHead(results[0]?.[0]),
    preflightAtGeneration: decodeBoundedRowV3<ServingSwitchPreflightProofV3>(
      results[1]?.[0],
      PREFLIGHT_V3_KEYS,
      state.preflight,
    ),
    historyAtGeneration: decodeBoundedRowV3<ServingSwitchHistoryRow>(
      results[2]?.[0],
      HISTORY_KEYS,
      state.history,
    ),
    targetState,
    formerState,
  });
};

const classifyV3 = async (
  database: D1Database,
  expected: ServingSwitchProjectionV3,
) =>
  classifyServingSwitchRetryV3({
    expected,
    ...(await readSnapshotV3(database.withSession("first-primary"), expected)),
  });

const successV3 = (
  expected: ServingSwitchProjectionV3,
  outcome: ServingSwitchResult["outcome"],
): ServingSwitchResult => {
  const state = readServingSwitchPersistenceV3(expected);
  return Object.freeze({
    outcome,
    switchId: state.history.switch_id,
    generation: state.history.new_generation,
  });
};

/** Fixed schema-1.6 provider/model-aware three-statement head transaction. */
export const applyServingSwitchV3 = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ServingSwitchResult> => {
  try {
    assertServingSwitchProjectionV3(expectedValue);
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
  const expected = expectedValue;
  const state = readServingSwitchPersistenceV3(expected);
  let initial;
  try {
    initial = await classifyV3(database, expected);
  } catch (error) {
    if (error instanceof ServingSwitchError) throw error;
    throw new ServingSwitchError("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success")
    return successV3(expected, "idempotent_success");
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);
  try {
    const session = database.withSession("first-primary");
    const untrusted: unknown = await session.batch([
      session
        .prepare(INSERT_PREFLIGHT_V3_SQL)
        .bind(...preflightValuesV3(state.preflight)),
      session.prepare(INSERT_HISTORY_SQL).bind(...historyValues(state.history)),
      session
        .prepare(ASSERT_POSTCONDITION_V3_SQL)
        .bind(
          state.history.switch_id,
          state.preflight.preflight_hash,
          state.history.event_hash,
          state.history.new_generation,
          state.history.to_publication_id,
          state.preflight.provider_search_document_count,
          state.preflight.model_variant_name_document_count,
        ),
    ]);
    const results = snapshotBatchResultsV3(untrusted, 3);
    const verification = results[2];
    const verified = verification?.[0];
    if (
      verification?.length !== 1 ||
      !isRecord(verified) ||
      !exactKeys(verified, ["verified"]) ||
      verified.verified !== 1
    )
      throw new Error("ambiguous batch result");
    return successV3(expected, "applied");
  } catch {
    let reconciled;
    try {
      reconciled = await classifyV3(database, expected);
    } catch (error) {
      if (error instanceof ServingSwitchError) throw error;
      throw new ServingSwitchError("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success")
      return successV3(expected, "idempotent_success");
    if (reconciled.outcome === "execute")
      throw new ServingSwitchError("not_applied");
    return throwDecision(reconciled.outcome);
  }
};

const SELECT_PREFLIGHT_V4_SQL = `SELECT
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
  provider_search_exact_parity, model_variant_name_projection_version,
  model_variant_name_document_count, model_variant_name_inventory_hash,
  model_variant_name_storage_version, model_variant_name_storage_document_count,
  model_variant_name_storage_queryable, model_variant_name_storage_exact_parity,
  provider_model_id_projection_version, provider_model_id_document_count,
  provider_model_id_inventory_hash, provider_model_id_storage_version,
  provider_model_id_storage_document_count, provider_model_id_storage_queryable,
  provider_model_id_storage_exact_parity
FROM publication_switch_preflight WHERE new_generation = ?1`;

const INSERT_PREFLIGHT_V4_SQL = `INSERT INTO publication_switch_preflight (
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
  provider_search_exact_parity, model_variant_name_projection_version,
  model_variant_name_document_count, model_variant_name_inventory_hash,
  model_variant_name_storage_version, model_variant_name_storage_document_count,
  model_variant_name_storage_queryable, model_variant_name_storage_exact_parity,
  provider_model_id_projection_version, provider_model_id_document_count,
  provider_model_id_inventory_hash, provider_model_id_storage_version,
  provider_model_id_storage_document_count, provider_model_id_storage_queryable,
  provider_model_id_storage_exact_parity
) VALUES (
  ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,
  ?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,
  ?31,?32,?33,?34,?35,?36,?37,?38,?39,?40,?41,?42,?43,?44,
  ?45,?46,?47,?48,?49,?50,?51,?52,?53,?54,?55,?56,?57,?58,
  ?59,?60,?61,?62
)`;

const SELECT_SEARCH_COUNTS_V4_SQL = `SELECT
  (SELECT count(*) FROM publication_provider_search_document
   WHERE publication_id = ?1) AS provider_document_count,
  (SELECT count(*) FROM publication_provider_search_fts
   WHERE publication_id = ?1) AS provider_fts_document_count,
  (SELECT count(*) FROM publication_model_variant_name_search_document
   WHERE publication_id = ?1) AS model_variant_name_document_count,
  (SELECT count(*) FROM publication_provider_model_id_search_document
   WHERE publication_id = ?1) AS provider_model_id_document_count,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS database_now_ms`;

// The guard deliberately repeats the schema-1.7 trigger's critical facts.
// This turns a successful D1 response into evidence that the exact sealed
// target and all exact-search projections still match after the history
// trigger atomically changed the head.
const ASSERT_POSTCONDITION_V4_SQL = `SELECT CASE WHEN
  NOT EXISTS (
    SELECT 1
    FROM publication_switch_preflight AS preflight
    JOIN publication_switch_history AS history USING (switch_id)
    JOIN publication_head AS head ON head.singleton = 1
    JOIN publication AS target ON target.publication_id = history.to_publication_id
    JOIN publication_closure_seal AS seal ON seal.publication_id = target.publication_id
    WHERE preflight.switch_id = ?1
      AND preflight.preflight_hash = ?2
      AND preflight.preflight_version = '4.0.0'
      AND history.event_version = '1.0.0'
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
      AND preflight.provider_search_document_count = ?6
      AND preflight.provider_search_fts_document_count = ?6
      AND preflight.provider_search_fts_queryable = 1
      AND preflight.provider_search_exact_parity = 1
      AND preflight.model_variant_name_document_count = ?7
      AND preflight.model_variant_name_storage_document_count = ?7
      AND preflight.model_variant_name_storage_queryable = 1
      AND preflight.model_variant_name_storage_exact_parity = 1
      AND preflight.provider_model_id_document_count = ?8
      AND preflight.provider_model_id_storage_document_count = ?8
      AND preflight.provider_model_id_storage_queryable = 1
      AND preflight.provider_model_id_storage_exact_parity = 1
      AND preflight.valid_until_ms >= CAST(strftime('%s', 'now') AS INTEGER) * 1000
      AND (history.from_publication_id IS NULL OR EXISTS (
        SELECT 1 FROM publication AS former
        WHERE former.publication_id = history.from_publication_id
          AND former.closure_hash = history.from_closure_hash
          AND former.state = CASE history.action
            WHEN 'activate' THEN 'superseded' ELSE 'rolled_back' END
      ))
      AND (history.action = 'rollback' OR EXISTS (
        SELECT 1 FROM publication_readiness_attestation AS attestation
        WHERE attestation.publication_id = history.to_publication_id
          AND attestation.evaluator_version = '4.0.0'
          AND attestation.environment = preflight.environment
          AND attestation.closure_hash = history.to_closure_hash
          AND attestation.attestation_hash = history.to_attestation_hash
          AND attestation.effective_valid_until_ms >= preflight.switched_at_ms
          AND attestation.effective_valid_until_ms >= CAST(strftime('%s', 'now') AS INTEGER) * 1000
      ))
  )
  OR (SELECT count(*) FROM publication_search_document WHERE publication_id = ?5)
     <> (SELECT fts_source_document_count FROM publication_switch_preflight WHERE switch_id = ?1)
  OR (SELECT count(*) FROM publication_search_fts WHERE publication_id = ?5)
     <> (SELECT fts_index_document_count FROM publication_switch_preflight WHERE switch_id = ?1)
  OR EXISTS (
    SELECT 1 FROM publication_search_document AS source
    WHERE source.publication_id = ?5 AND NOT EXISTS (
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
    WHERE indexed.publication_id = ?5 AND NOT EXISTS (
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
  OR (SELECT count(*) FROM publication_provider_search_document WHERE publication_id = ?5) <> ?6
  OR (SELECT count(*) FROM publication_provider_search_fts WHERE publication_id = ?5) <> ?6
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
  OR (SELECT count(*) FROM publication_model_variant_name_search_document WHERE publication_id = ?5) <> ?7
  OR EXISTS (
    SELECT 1 FROM publication_model_variant_name_search_document AS projected
    WHERE projected.publication_id = ?5 AND NOT EXISTS (
      SELECT 1 FROM publication_resource AS resource
      WHERE resource.publication_id = projected.publication_id
        AND resource.resource_type = projected.resource_type
        AND resource.resource_id = projected.resource_id
        AND resource.content_hash = projected.resource_content_hash
        AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
        AND CAST(json_extract(resource.resource_json, '$.display_name.value') AS BLOB) = projected.display_name_utf8
    )
  )
  OR EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = ?5
      AND resource.resource_type IN ('model', 'variant')
      AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
      AND NOT EXISTS (
        SELECT 1 FROM publication_model_variant_name_search_document AS projected
        WHERE projected.publication_id = resource.publication_id
          AND projected.resource_type = resource.resource_type
          AND projected.resource_id = resource.resource_id
          AND projected.resource_content_hash = resource.content_hash
          AND projected.display_name_utf8 = CAST(json_extract(resource.resource_json, '$.display_name.value') AS BLOB)
      )
  )
  OR (SELECT count(*) FROM publication_provider_model_id_search_document WHERE publication_id = ?5) <> ?8
  OR EXISTS (
    SELECT 1 FROM publication_resource AS offering
    WHERE offering.publication_id = ?5
      AND offering.resource_type = 'offering'
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_model_id_search_document AS projected
        WHERE projected.publication_id = offering.publication_id
          AND projected.offering_id = offering.resource_id
      )
  )
  OR EXISTS (
    SELECT 1 FROM publication_provider_model_id_search_document AS projected
    WHERE projected.publication_id = ?5
      AND NOT EXISTS (
        SELECT 1
        FROM publication_resource AS offering
        JOIN publication_provider_attribution AS attribution
          ON attribution.publication_id = offering.publication_id
         AND attribution.resource_type = offering.resource_type
         AND attribution.resource_id = offering.resource_id
         AND attribution.provider_id = projected.provider_id
        JOIN publication_provider_slice AS disposition
          ON disposition.publication_id = attribution.publication_id
         AND disposition.provider_id = attribution.provider_id
         AND disposition.provider_slice_id IS NOT NULL
        JOIN publication_resource AS target
          ON target.publication_id = offering.publication_id
         AND target.resource_type = projected.target_resource_type
         AND target.resource_id = projected.target_resource_id
        WHERE offering.publication_id = projected.publication_id
          AND offering.resource_type = projected.offering_resource_type
          AND offering.resource_id = projected.offering_id
          AND offering.content_hash = projected.offering_content_hash
          AND json_extract(offering.resource_json, '$.offering_id') = projected.offering_id
          AND json_extract(offering.resource_json, '$.provider_id') = projected.provider_id
          AND json_extract(offering.resource_json, '$.model_resource_id') = projected.target_resource_id
          AND CAST(json_extract(offering.resource_json, '$.provider_model_id') AS BLOB)
              = projected.raw_provider_model_id_utf8
          AND target.content_hash = projected.target_content_hash
      )
  )
THEN json('') ELSE 1 END AS verified`;

const PREFLIGHT_V4_KEYS = [
  ...PREFLIGHT_V2_KEYS,
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
] as const satisfies readonly (keyof ServingSwitchPreflightProofV4)[];

const preflightValuesV4 = (
  row: ServingSwitchPreflightProofV4,
): readonly unknown[] => PREFLIGHT_V4_KEYS.map((key) => row[key]);

const decodeBoundedRowV4 = <T extends Readonly<Record<string, unknown>>>(
  value: unknown,
  keys: readonly (keyof T & string)[],
  shape: T,
): T | null => {
  if (value === undefined) return null;
  if (!isRecord(value) || !exactKeys(value, keys))
    throw new ServingSwitchError("integrity_failure");
  const snapshot: Record<string, unknown> = {};
  for (const key of keys) {
    const actual = value[key];
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
    ) {
      throw new ServingSwitchError("integrity_failure");
    }
    snapshot[key] = actual;
  }
  return Object.freeze(snapshot) as T;
};

const snapshotBatchResultsV4 = (
  value: unknown,
  expectedCount: number,
): readonly (readonly unknown[])[] => {
  if (!Array.isArray(value)) throw new ServingSwitchError("integrity_failure");
  const batchCount: unknown = value.length;
  if (batchCount !== expectedCount)
    throw new ServingSwitchError("integrity_failure");
  const batch = new Array<readonly unknown[]>(expectedCount);
  for (let index = 0; index < expectedCount; index += 1) {
    const candidate: unknown = value[index];
    if (!isRecord(candidate)) throw new ServingSwitchError("integrity_failure");
    const success: unknown = candidate.success;
    const rows: unknown = candidate.results;
    if (success !== true || !Array.isArray(rows))
      throw new ServingSwitchError("integrity_failure");
    const rowCount: unknown = rows.length;
    if (
      typeof rowCount !== "number" ||
      !Number.isSafeInteger(rowCount) ||
      rowCount < 0 ||
      rowCount > 1
    )
      throw new ServingSwitchError("integrity_failure");
    const detached = new Array<unknown>(rowCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1)
      detached[rowIndex] = rows[rowIndex] as unknown;
    batch[index] = Object.freeze(detached);
  }
  return Object.freeze(batch);
};

const readSnapshotV4 = async (
  session: D1DatabaseSession,
  expected: ServingSwitchProjectionV4,
) => {
  const state = readServingSwitchPersistenceV4(expected);
  const untrusted: unknown = await session.batch([
    session.prepare(SELECT_HEAD_SQL),
    session.prepare(SELECT_PREFLIGHT_V4_SQL).bind(state.history.new_generation),
    session.prepare(SELECT_HISTORY_SQL).bind(state.history.new_generation),
    session
      .prepare(SELECT_STATES_SQL)
      .bind(state.history.to_publication_id, state.history.from_publication_id),
    session
      .prepare(SELECT_SEARCH_COUNTS_V4_SQL)
      .bind(state.history.to_publication_id),
  ]);
  const results = snapshotBatchResultsV4(untrusted, 5);
  const statesRow = results[3]?.[0];
  if (
    !isRecord(statesRow) ||
    !exactKeys(statesRow, ["target_state", "former_state"])
  )
    throw new ServingSwitchError("integrity_failure");
  const countsRow = results[4]?.[0];
  if (
    !isRecord(countsRow) ||
    !exactKeys(countsRow, [
      "provider_document_count",
      "provider_fts_document_count",
      "model_variant_name_document_count",
      "provider_model_id_document_count",
      "database_now_ms",
    ]) ||
    countsRow.provider_document_count !==
      state.preflight.provider_search_document_count ||
    countsRow.provider_fts_document_count !==
      state.preflight.provider_search_fts_document_count ||
    countsRow.model_variant_name_document_count !==
      state.preflight.model_variant_name_storage_document_count ||
    countsRow.provider_model_id_document_count !==
      state.preflight.provider_model_id_storage_document_count ||
    typeof countsRow.database_now_ms !== "number" ||
    !Number.isSafeInteger(countsRow.database_now_ms) ||
    countsRow.database_now_ms < 0
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
    currentHead: decodeHead(results[0]?.[0]),
    preflightAtGeneration: decodeBoundedRowV4<ServingSwitchPreflightProofV4>(
      results[1]?.[0],
      PREFLIGHT_V4_KEYS,
      state.preflight,
    ),
    historyAtGeneration: decodeBoundedRowV4<ServingSwitchHistoryRow>(
      results[2]?.[0],
      HISTORY_KEYS,
      state.history,
    ),
    targetState,
    formerState,
    databaseNowMs: countsRow.database_now_ms,
  });
};

const classifyV4 = async (
  database: D1Database,
  expected: ServingSwitchProjectionV4,
) => {
  const state = readServingSwitchPersistenceV4(expected);
  const snapshot = await readSnapshotV4(
    database.withSession("first-primary"),
    expected,
  );
  if (
    snapshot.historyAtGeneration === null &&
    snapshot.databaseNowMs > state.preflight.valid_until_ms
  )
    return Object.freeze({ outcome: "stale" as const });
  return classifyServingSwitchRetryV4({ expected, ...snapshot });
};

const successV4 = (
  expected: ServingSwitchProjectionV4,
  outcome: ServingSwitchResult["outcome"],
): ServingSwitchResult => {
  const state = readServingSwitchPersistenceV4(expected);
  return Object.freeze({
    outcome,
    switchId: state.history.switch_id,
    generation: state.history.new_generation,
  });
};

const verifyProviderModelIdStorageV4 = async (
  database: D1Database,
  proof: ServingSwitchPersistenceV4["providerModelIdProof"],
): Promise<void> => {
  try {
    await verifyProviderModelIdSearchStorageV4(database, proof);
  } catch (error) {
    if (
      error instanceof ProviderModelIdSearchStagingError &&
      error.code === "integrity_failure"
    )
      throw new ServingSwitchError("integrity_failure");
    throw new ServingSwitchError("outcome_unknown");
  }
};

/** Fixed schema-1.7 provider/model-ID-aware five-statement head transaction. */
export const applyServingSwitchV4 = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ServingSwitchResult> => {
  try {
    assertServingSwitchProjectionV4(expectedValue);
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
  const expected = expectedValue;
  const state = readServingSwitchPersistenceV4(expected);
  let initial;
  try {
    initial = await classifyV4(database, expected);
  } catch (error) {
    if (error instanceof ServingSwitchError) throw error;
    throw new ServingSwitchError("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success") {
    await verifyProviderModelIdStorageV4(database, state.providerModelIdProof);
    return successV4(expected, "idempotent_success");
  }
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);
  await verifyProviderModelIdStorageV4(database, state.providerModelIdProof);
  try {
    const session = database.withSession("first-primary");
    const untrusted: unknown = await session.batch([
      ...prepareProviderModelIdSearchAtomicAssertionsV4(
        session,
        state.providerModelIdProof,
      ),
      session
        .prepare(INSERT_PREFLIGHT_V4_SQL)
        .bind(...preflightValuesV4(state.preflight)),
      session.prepare(INSERT_HISTORY_SQL).bind(...historyValues(state.history)),
      session
        .prepare(ASSERT_POSTCONDITION_V4_SQL)
        .bind(
          state.history.switch_id,
          state.preflight.preflight_hash,
          state.history.event_hash,
          state.history.new_generation,
          state.history.to_publication_id,
          state.preflight.provider_search_document_count,
          state.preflight.model_variant_name_document_count,
          state.preflight.provider_model_id_document_count,
        ),
    ]);
    const results = snapshotBatchResultsV4(untrusted, 5);
    const verification = results[4];
    const verified = verification?.[0];
    if (
      verification?.length !== 1 ||
      !isRecord(verified) ||
      !exactKeys(verified, ["verified"]) ||
      verified.verified !== 1
    )
      throw new Error("ambiguous batch result");
    await verifyProviderModelIdStorageV4(database, state.providerModelIdProof);
    return successV4(expected, "applied");
  } catch {
    let reconciled;
    try {
      reconciled = await classifyV4(database, expected);
    } catch (error) {
      if (error instanceof ServingSwitchError) throw error;
      throw new ServingSwitchError("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success") {
      await verifyProviderModelIdStorageV4(
        database,
        state.providerModelIdProof,
      );
      return successV4(expected, "idempotent_success");
    }
    await verifyProviderModelIdStorageV4(database, state.providerModelIdProof);
    if (reconciled.outcome === "execute")
      throw new ServingSwitchError("not_applied");
    return throwDecision(reconciled.outcome);
  }
};
