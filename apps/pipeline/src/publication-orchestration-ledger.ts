import {
  DURABLE_ADMISSION_REJECTION_CODES,
  encodeOrchestrationReportV2,
  publicationPlanProviderScopeHash,
  verifyAdmittedFiringDecision,
  verifyOrchestrationReportV2,
  verifyRejectedFiringDecision,
  type AdmittedFiringDecision,
  type AdjacentReplayDecision,
  type OrchestrationReportV2,
  type TerminalRunIdentityAuthorityV2,
  type TerminalRunReportV2,
} from "@quant-clarity/pipeline-core/orchestration-contract";
import {
  createPipelineRun,
  createProviderSlice,
  createScheduleOccurrence,
} from "@quant-clarity/pipeline-core";

const MAX_TIME_MS = 253_402_300_799_999;
const MAX_SAFE_SQL_INTEGER = Number.MAX_SAFE_INTEGER;
const CAPABILITY = "publication-orchestration-ledger@1" as const;
const SCHEDULE_NAME = "provider-refresh-v1" as const;
const SCHEDULE_EXPRESSION = "0 5 * * 1,4" as const;
const SCHEDULE_CONFIG = Object.freeze({
  name: SCHEDULE_NAME,
  utcWeekdays: Object.freeze([1, 4]),
  utcHour: 5,
  utcMinute: 0,
});
const LEDGER_WRITER = Object.freeze({
  kind: "pipeline" as const,
  identityId: CAPABILITY,
});

const IDS = Object.freeze({
  occurrence:
    /^occ_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  runPlan:
    /^rpl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  run: /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  provider:
    /^prv_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  providerRun:
    /^pvr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
});
const HASH = /^sha256:[0-9a-f]{64}$/;
const CODE_VERSION = /^git:[0-9a-f]{6,64}$/;
const BUDGET_MONTH = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/;

export const PUBLICATION_ORCHESTRATION_LEDGER_ERROR_CODES = [
  "invalid_input",
  "authority_missing",
  "conflict",
  "integrity_failure",
  "outcome_unknown",
] as const;
export type PublicationOrchestrationLedgerErrorCode =
  (typeof PUBLICATION_ORCHESTRATION_LEDGER_ERROR_CODES)[number];

export class PublicationOrchestrationLedgerError extends Error {
  readonly code: PublicationOrchestrationLedgerErrorCode;
  readonly retrySameOperation: boolean;

  constructor(code: PublicationOrchestrationLedgerErrorCode) {
    super("Publication orchestration state could not be persisted safely.");
    this.name = "PublicationOrchestrationLedgerError";
    this.code = code;
    this.retrySameOperation = code === "outcome_unknown";
  }
}

const trustedErrors = new WeakMap<
  object,
  PublicationOrchestrationLedgerErrorCode
>();
const failure = (
  code: PublicationOrchestrationLedgerErrorCode,
): PublicationOrchestrationLedgerError => {
  const error = new PublicationOrchestrationLedgerError(code);
  trustedErrors.set(error, code);
  return error;
};
const closeFailure = (value: unknown): never => {
  if (typeof value === "object" && value !== null) {
    const code = trustedErrors.get(value);
    if (code !== undefined) throw failure(code);
  }
  throw failure("outcome_unknown");
};

type Environment = "preview" | "production";
type ClosureState = "exact" | "absent" | "mismatch" | "unreadable";
export type LedgerMutationResult = Readonly<{
  outcome: "applied" | "idempotent_success";
}>;

const budgetAuthorityBrand: unique symbol = Symbol("budgetAuthority");
const trustedBudgetAuthorities = new WeakSet<object>();
export type PublicationBudgetAuthority = Readonly<{
  capability: typeof CAPABILITY;
  environment: Environment;
  budgetMonth: string;
  monthlyAllocationMicrousd: number;
  breakerGeneration: number;
  expensiveWorkBreakerTripped: boolean;
  monthlyUsedCostMicrousd: number;
  monthlyReservedCostMicrousd: number;
  readonly [budgetAuthorityBrand]: true;
}>;

const METADATA_SQL = `SELECT capability
FROM publication_orchestration_integrity_metadata
WHERE singleton = ?1`;
const ASSERT_LEGACY_QUIESCENT_SQL = `SELECT CASE WHEN
  EXISTS (SELECT 1 FROM pipeline_run WHERE status IN ('pending', 'running'))
  OR EXISTS (SELECT 1 FROM provider_run WHERE status IN ('pending', 'running'))
  OR EXISTS (SELECT 1 FROM acquisition_run WHERE status IN ('pending', 'running'))
THEN json('') END AS legacy_quiescent`;
const INSERT_ENVIRONMENT_SQL = `INSERT INTO publication_orchestration_environment (
  singleton, environment, monthly_allocation_microusd, initialized_at_ms
) VALUES (?1, ?2, ?3, ?4)`;
const INSERT_BREAKER_SQL = `INSERT INTO publication_budget_breaker_event (
  environment, budget_month, generation, tripped, observed_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5)`;
const SELECT_ENVIRONMENT_SQL = `SELECT singleton, environment,
  monthly_allocation_microusd, initialized_at_ms
FROM publication_orchestration_environment WHERE singleton = ?1`;
const SELECT_BREAKER_SQL = `SELECT environment, budget_month, generation,
  tripped, observed_at_ms
FROM publication_budget_breaker_event
WHERE environment = ?1 AND budget_month = ?2 AND generation = ?3`;
const SELECT_BUDGET_SQL = `SELECT metadata.capability, environment.environment,
  environment.monthly_allocation_microusd, breaker.generation,
  breaker.tripped,
  COALESCE((SELECT sum(terminal.cost_microusd)
    FROM publication_run_terminal AS terminal
    JOIN publication_coordination_run AS run ON run.run_id = terminal.run_id
    JOIN publication_orchestration_occurrence AS occurrence
      ON occurrence.occurrence_id = run.occurrence_id
    JOIN schedule_occurrence AS scheduled
      ON scheduled.occurrence_id = occurrence.occurrence_id
    WHERE run.environment = environment.environment
      AND strftime('%Y-%m', scheduled.scheduled_at_ms / 1000, 'unixepoch') = ?2
  ), 0) AS monthly_used_cost_microusd,
  COALESCE((SELECT sum(reservation.reserved_cost_microusd)
    FROM publication_run_budget_reservation AS reservation
    WHERE reservation.environment = environment.environment
      AND reservation.budget_month = ?2
      AND NOT EXISTS (SELECT 1 FROM publication_run_terminal AS terminal
        WHERE terminal.run_id = reservation.run_id)
  ), 0) AS monthly_reserved_cost_microusd
FROM publication_orchestration_integrity_metadata AS metadata
JOIN publication_orchestration_environment AS environment
  ON environment.singleton = metadata.singleton
JOIN publication_budget_breaker_event AS breaker
  ON breaker.environment = environment.environment
 AND breaker.budget_month = ?2
WHERE metadata.singleton = ?1 AND environment.environment = ?3
  AND breaker.generation = (SELECT max(later.generation)
    FROM publication_budget_breaker_event AS later
    WHERE later.environment = environment.environment
      AND later.budget_month = ?2)`;

const INSERT_SCHEDULE_OCCURRENCE_SQL = `INSERT INTO schedule_occurrence (
  occurrence_id, scheduled_at_ms, schedule_expression, schedule_name,
  created_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5)`;
const INSERT_ORCHESTRATION_OCCURRENCE_SQL = `INSERT INTO publication_orchestration_occurrence (
  occurrence_id, environment, requested_run_plan_id,
  requested_run_plan_hash, observed_at_ms, created_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;
const SELECT_SCHEDULE_OCCURRENCE_SQL = `SELECT occurrence_id, scheduled_at_ms,
  schedule_expression, schedule_name, created_at_ms
FROM schedule_occurrence WHERE occurrence_id = ?1`;
const SELECT_ORCHESTRATION_OCCURRENCE_SQL = `SELECT occurrence_id, environment,
  requested_run_plan_id, requested_run_plan_hash, observed_at_ms, created_at_ms
FROM publication_orchestration_occurrence WHERE occurrence_id = ?1`;

const INSERT_REJECTION_SQL = `INSERT INTO publication_admission_rejection (
  occurrence_id, rejection_code, report_schema_version, report_text,
  report_hash, created_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;
const SELECT_REJECTION_SQL = `SELECT occurrence_id, rejection_code,
  report_schema_version, report_text, report_hash, created_at_ms
FROM publication_admission_rejection WHERE occurrence_id = ?1`;

const INSERT_RUN_SQL = `INSERT INTO publication_coordination_run (
  run_id, occurrence_id, attempt_number, replay_of_run_id, replay_authority,
  replay_authorization_hash, run_plan_id, run_plan_hash, environment,
  code_version, canonical_schema_version, pipeline_contract_version,
  provider_count, provider_scope_hash, policy_set_hash, deadline_at_ms,
  observed_at_ms, started_at_ms, request_ceiling, byte_ceiling,
  ai_token_ceiling, browser_millisecond_ceiling,
  elapsed_millisecond_ceiling, cost_microusd_ceiling,
  projected_monthly_cost_microusd, budget_alert_percent, created_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
  ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25,
  ?26, ?27)`;
const INSERT_PROVIDER_RUN_SQL = `INSERT INTO publication_coordination_provider_run (
  provider_run_id, run_id, provider_id, ordinal, adapter_version,
  roster_version, roster_content_hash, source_register_version,
  source_artifact_hash, request_ceiling, byte_ceiling, ai_token_ceiling,
  browser_millisecond_ceiling, elapsed_millisecond_ceiling,
  cost_microusd_ceiling, retry_policy_hash, admitted_at_ms, created_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
  ?13, ?14, ?15, ?16, ?17, ?18)`;
const INSERT_RESERVATION_SQL = `INSERT INTO publication_run_budget_reservation (
  run_id, environment, budget_month, breaker_generation,
  monthly_used_snapshot_microusd, monthly_reserved_snapshot_microusd,
  reserved_cost_microusd, reserved_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`;
const SELECT_RUN_SQL = `SELECT * FROM publication_coordination_run
WHERE run_id = ?1`;
const SELECT_PROVIDER_RUNS_SQL = `SELECT *
FROM publication_coordination_provider_run WHERE run_id = ?1 ORDER BY ordinal`;
const SELECT_RESERVATION_SQL = `SELECT * FROM publication_run_budget_reservation
WHERE run_id = ?1`;

const INSERT_FENCE_CLAIM_SQL = `INSERT INTO publication_provider_fence_claim (
  environment, provider_id, generation, provider_run_id, run_id,
  occurrence_id, deadline_at_ms, claimed_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`;
const INSERT_FENCE_HEAD_SQL = `INSERT INTO publication_provider_fence_head (
  environment, provider_id, generation, provider_run_id
) VALUES (?1, ?2, ?3, ?4)`;
const ADVANCE_FENCE_HEAD_SQL = `UPDATE publication_provider_fence_head
SET generation = ?3, provider_run_id = ?4
WHERE environment = ?1 AND provider_id = ?2
  AND generation = ?5 AND provider_run_id = ?6`;
const ASSERT_FENCE_HEAD_SQL = `SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM publication_provider_fence_head
  WHERE environment = ?1 AND provider_id = ?2 AND generation = ?3
    AND provider_run_id = ?4
) THEN json('') END AS exact_fence_head`;
const SELECT_FENCE_CLAIM_SQL = `SELECT * FROM publication_provider_fence_claim
WHERE environment = ?1 AND provider_id = ?2 AND generation = ?3`;
const SELECT_FENCE_HEAD_SQL = `SELECT * FROM publication_provider_fence_head
WHERE environment = ?1 AND provider_id = ?2`;
const SELECT_FENCE_CLOSED_HISTORY_SQL = `SELECT 1 AS closed_history,
  head.generation AS head_generation,
  head.provider_run_id AS head_provider_run_id
FROM publication_provider_fence_claim AS requested
JOIN publication_provider_fence_head AS head
  ON head.environment = requested.environment
 AND head.provider_id = requested.provider_id
JOIN publication_provider_fence_claim AS head_claim
  ON head_claim.environment = head.environment
 AND head_claim.provider_id = head.provider_id
 AND head_claim.generation = head.generation
 AND head_claim.provider_run_id = head.provider_run_id
WHERE requested.environment = ?1 AND requested.provider_id = ?2
  AND requested.generation = ?3 AND head.generation >= requested.generation
  AND (SELECT count(*) FROM publication_provider_fence_claim AS history
    WHERE history.environment = requested.environment
      AND history.provider_id = requested.provider_id
      AND history.generation BETWEEN requested.generation AND head.generation
  ) = head.generation - requested.generation + 1
  AND NOT EXISTS (
    SELECT 1
    FROM publication_provider_fence_claim AS history
    LEFT JOIN publication_provider_fence_reconciliation AS reconciliation
      ON reconciliation.environment = history.environment
     AND reconciliation.provider_id = history.provider_id
     AND reconciliation.generation = history.generation
     AND reconciliation.provider_run_id = history.provider_run_id
    LEFT JOIN publication_provider_fence_release AS release
      ON release.environment = history.environment
     AND release.provider_id = history.provider_id
     AND release.generation = history.generation
     AND release.provider_run_id = history.provider_run_id
    WHERE history.environment = requested.environment
      AND history.provider_id = requested.provider_id
      AND history.generation >= requested.generation
      AND history.generation < head.generation
      AND (reconciliation.generation IS NULL OR release.generation IS NULL)
  )`;

const ASSERT_ACTIVE_FENCE_SQL = `SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM publication_provider_fence_head AS head
  WHERE head.environment = ?1 AND head.provider_id = ?2
    AND head.generation = ?3 AND head.provider_run_id = ?4
    AND NOT EXISTS (SELECT 1 FROM publication_provider_fence_release AS release
      WHERE release.environment = head.environment
        AND release.provider_id = head.provider_id
        AND release.generation = head.generation)
) THEN json('') END AS active_fence`;
const INSERT_ROSTER_OUTCOME_SQL = `INSERT INTO publication_roster_operational_outcome (
  provider_run_id, roster_item_id, status, evidence_id, offering_id,
  error_code, attempt_count, created_at_ms
) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6)`;
const SELECT_ROSTER_OUTCOME_SQL = `SELECT *
FROM publication_roster_operational_outcome
WHERE provider_run_id = ?1 AND roster_item_id = ?2`;

const INSERT_PROVIDER_TERMINAL_SQL = `INSERT INTO publication_provider_terminal (
  provider_run_id, fence_generation, state, roster_complete,
  publication_disposition, slice_id, requests, bytes, ai_tokens,
  browser_milliseconds, elapsed_milliseconds, cost_microusd,
  error_codes_json, ended_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
  ?13, ?14)`;
const INSERT_FENCE_RECONCILIATION_SQL = `INSERT INTO publication_provider_fence_reconciliation (
  environment, provider_id, generation, provider_run_id, result,
  reconciled_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;
const INSERT_FENCE_RELEASE_SQL = `INSERT INTO publication_provider_fence_release (
  environment, provider_id, generation, provider_run_id, released_at_ms
) VALUES (?1, ?2, ?3, ?4, ?5)`;
const SELECT_PROVIDER_TERMINAL_SQL = `SELECT *
FROM publication_provider_terminal WHERE provider_run_id = ?1`;
const SELECT_FENCE_RECONCILIATION_SQL = `SELECT *
FROM publication_provider_fence_reconciliation
WHERE environment = ?1 AND provider_id = ?2 AND generation = ?3`;
const SELECT_FENCE_RELEASE_SQL = `SELECT *
FROM publication_provider_fence_release
WHERE environment = ?1 AND provider_id = ?2 AND generation = ?3`;

const INSERT_RUN_TERMINAL_SQL = `INSERT INTO publication_run_terminal (
  run_id, run_outcome, publication_disposition, run_wide_quarantine,
  requests, bytes, ai_tokens, browser_milliseconds, elapsed_milliseconds,
  cost_microusd, error_codes_json, ended_at_ms, report_schema_version,
  report_text, report_hash
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
  ?13, ?14, ?15)`;
const SELECT_RUN_TERMINAL_SQL = `SELECT * FROM publication_run_terminal
WHERE run_id = ?1`;

export const PUBLICATION_ORCHESTRATION_LEDGER_SQL = Object.freeze({
  metadata: METADATA_SQL,
  assertLegacyQuiescent: ASSERT_LEGACY_QUIESCENT_SQL,
  insertEnvironment: INSERT_ENVIRONMENT_SQL,
  insertBreaker: INSERT_BREAKER_SQL,
  selectEnvironment: SELECT_ENVIRONMENT_SQL,
  selectBreaker: SELECT_BREAKER_SQL,
  selectBudget: SELECT_BUDGET_SQL,
  insertScheduleOccurrence: INSERT_SCHEDULE_OCCURRENCE_SQL,
  insertOrchestrationOccurrence: INSERT_ORCHESTRATION_OCCURRENCE_SQL,
  selectScheduleOccurrence: SELECT_SCHEDULE_OCCURRENCE_SQL,
  selectOrchestrationOccurrence: SELECT_ORCHESTRATION_OCCURRENCE_SQL,
  insertRejection: INSERT_REJECTION_SQL,
  selectRejection: SELECT_REJECTION_SQL,
  insertRun: INSERT_RUN_SQL,
  insertProviderRun: INSERT_PROVIDER_RUN_SQL,
  insertReservation: INSERT_RESERVATION_SQL,
  selectRun: SELECT_RUN_SQL,
  selectProviderRuns: SELECT_PROVIDER_RUNS_SQL,
  selectReservation: SELECT_RESERVATION_SQL,
  insertFenceClaim: INSERT_FENCE_CLAIM_SQL,
  insertFenceHead: INSERT_FENCE_HEAD_SQL,
  advanceFenceHead: ADVANCE_FENCE_HEAD_SQL,
  assertFenceHead: ASSERT_FENCE_HEAD_SQL,
  selectFenceClaim: SELECT_FENCE_CLAIM_SQL,
  selectFenceHead: SELECT_FENCE_HEAD_SQL,
  selectFenceClosedHistory: SELECT_FENCE_CLOSED_HISTORY_SQL,
  assertActiveFence: ASSERT_ACTIVE_FENCE_SQL,
  insertRosterOutcome: INSERT_ROSTER_OUTCOME_SQL,
  selectRosterOutcome: SELECT_ROSTER_OUTCOME_SQL,
  insertProviderTerminal: INSERT_PROVIDER_TERMINAL_SQL,
  insertFenceReconciliation: INSERT_FENCE_RECONCILIATION_SQL,
  insertFenceRelease: INSERT_FENCE_RELEASE_SQL,
  selectProviderTerminal: SELECT_PROVIDER_TERMINAL_SQL,
  selectFenceReconciliation: SELECT_FENCE_RECONCILIATION_SQL,
  selectFenceRelease: SELECT_FENCE_RELEASE_SQL,
  insertRunTerminal: INSERT_RUN_TERMINAL_SQL,
  selectRunTerminal: SELECT_RUN_TERMINAL_SQL,
});

const exactRecord = (
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw failure("integrity_failure");
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    throw failure("integrity_failure");
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  )
    throw failure("integrity_failure");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      throw failure("integrity_failure");
  }
  return value as Readonly<Record<string, unknown>>;
};

const exactInputRecord = (value: unknown, keys: readonly string[]): void => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error();
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error();
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    )
      throw new Error();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      )
        throw new Error();
    }
  } catch {
    throw failure("invalid_input");
  }
};

const denseInputArray = (
  value: unknown,
  maximum: number,
): readonly unknown[] => {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    )
      throw new Error();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      (lengthDescriptor.value as number) < 0 ||
      (lengthDescriptor.value as number) > maximum
    )
      throw new Error();
    const length = lengthDescriptor.value as number;
    const expectedKeys = [
      ...Array.from({ length }, (_, index) => String(index)),
      "length",
    ];
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index])
    )
      throw new Error();
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      )
        throw new Error();
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    throw failure("invalid_input");
  }
};

const safeInteger = (
  value: unknown,
  maximum = MAX_SAFE_SQL_INTEGER,
): number => {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maximum
  )
    throw failure("invalid_input");
  return value as number;
};
const storedInteger = (
  value: unknown,
  maximum = MAX_SAFE_SQL_INTEGER,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw failure("integrity_failure");
  return value;
};
const time = (value: unknown): number => safeInteger(value, MAX_TIME_MS);
const environment = (value: unknown): Environment => {
  if (value !== "preview" && value !== "production")
    throw failure("invalid_input");
  return value;
};
const id = (value: unknown, pattern: RegExp): string => {
  if (typeof value !== "string" || !pattern.test(value))
    throw failure("invalid_input");
  return value;
};
const hash = (value: unknown): string => id(value, HASH);
const printable = (value: unknown, min: number, max: number): string => {
  if (
    typeof value !== "string" ||
    value.length < min ||
    value.length > max ||
    !/^[\x20-\x7e]+$/.test(value)
  )
    throw failure("invalid_input");
  return value;
};
const instantMs = (value: unknown): number => {
  if (typeof value !== "string") throw failure("invalid_input");
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value)
    throw failure("invalid_input");
  return parsed;
};

const deriveScheduleOccurrence = (scheduledAt: string, createdAt: string) => {
  try {
    return createScheduleOccurrence({
      config: SCHEDULE_CONFIG,
      scheduledAt,
      createdAt,
    });
  } catch {
    throw failure("invalid_input");
  }
};

const resultRows = (value: unknown): readonly unknown[] => {
  const result = exactRecord(value, ["results", "success", "meta"]);
  if (result.success !== true || !Array.isArray(result.results))
    throw failure("integrity_failure");
  return result.results;
};

const batchRows = (
  value: unknown,
  expectedLength: number,
): readonly (readonly unknown[])[] => {
  if (!Array.isArray(value) || value.length !== expectedLength)
    throw failure("integrity_failure");
  return value.map(resultRows);
};

const canonicalRow = (value: unknown): string => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw failure("integrity_failure");
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    throw failure("integrity_failure");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string"))
    throw failure("integrity_failure");
  const object = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of (keys as string[]).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      throw failure("integrity_failure");
    const member = object[key];
    if (
      member !== null &&
      typeof member !== "string" &&
      typeof member !== "number"
    )
      throw failure("integrity_failure");
    sorted[key] = member;
  }
  return JSON.stringify(sorted);
};

const rowEquals = (
  observed: unknown,
  expected: Readonly<Record<string, unknown>>,
): boolean => {
  try {
    return canonicalRow(observed) === canonicalRow(expected);
  } catch {
    return false;
  }
};

type ExpectedRows = readonly (readonly Readonly<Record<string, unknown>>[])[];
const classifyRows = (
  observed: readonly (readonly unknown[])[],
  expected: ExpectedRows,
  absent?: (groups: readonly (readonly unknown[])[]) => boolean,
): ClosureState => {
  try {
    if (observed.length !== expected.length) return "unreadable";
    const exact = observed.every((group, index) => {
      const wanted = expected[index] ?? [];
      return (
        group.length === wanted.length &&
        group.every(
          (row, rowIndex) =>
            canonicalRow(row) === canonicalRow(wanted[rowIndex]),
        )
      );
    });
    if (exact) return "exact";
    if (absent?.(observed) ?? observed.every((group) => group.length === 0))
      return "absent";
    return "mismatch";
  } catch {
    return "unreadable";
  }
};

type ClosureReader = () => Promise<ClosureState>;
type BatchAttempt = () => Promise<ClosureState>;
const persistWithReconciliation = async (
  attempt: BatchAttempt,
  reconcile: ClosureReader,
): Promise<LedgerMutationResult> => {
  try {
    if ((await attempt()) === "exact")
      return Object.freeze({ outcome: "applied" });
  } catch {
    // A thrown D1 mutation response is ambiguous by definition.
  }
  let state: ClosureState;
  try {
    state = await reconcile();
  } catch {
    throw failure("outcome_unknown");
  }
  if (state === "exact")
    return Object.freeze({ outcome: "idempotent_success" });
  if (state === "mismatch") throw failure("integrity_failure");
  if (state === "unreadable") throw failure("outcome_unknown");
  try {
    await attempt();
  } catch {
    // Reconcile the one permitted same-projection retry from a new session.
  }
  try {
    state = await reconcile();
  } catch {
    throw failure("outcome_unknown");
  }
  if (state === "exact")
    return Object.freeze({ outcome: "idempotent_success" });
  if (state === "absent") throw failure("conflict");
  if (state === "mismatch") throw failure("integrity_failure");
  throw failure("outcome_unknown");
};

const sessionRows = async (
  database: D1Database,
  statements: readonly Readonly<{ sql: string; values: readonly unknown[] }>[],
): Promise<readonly (readonly unknown[])[]> => {
  const session = database.withSession("first-primary");
  const prepared = statements.map(({ sql, values }) =>
    session.prepare(sql).bind(...values),
  );
  return batchRows(await session.batch(prepared), prepared.length);
};

const mutationAttempt = async (
  database: D1Database,
  mutations: readonly Readonly<{ sql: string; values: readonly unknown[] }>[],
  selectors: readonly Readonly<{ sql: string; values: readonly unknown[] }>[],
  expected: ExpectedRows,
  absent?: (groups: readonly (readonly unknown[])[]) => boolean,
): Promise<ClosureState> => {
  const groups = await sessionRows(database, [...mutations, ...selectors]);
  return classifyRows(groups.slice(mutations.length), expected, absent);
};

const closureReader =
  (
    database: D1Database,
    selectors: readonly Readonly<{ sql: string; values: readonly unknown[] }>[],
    expected: ExpectedRows,
    absent?: (groups: readonly (readonly unknown[])[]) => boolean,
  ): ClosureReader =>
  async () =>
    classifyRows(await sessionRows(database, selectors), expected, absent);

const mutate = async (
  database: D1Database,
  mutations: readonly Readonly<{ sql: string; values: readonly unknown[] }>[],
  selectors: readonly Readonly<{ sql: string; values: readonly unknown[] }>[],
  expected: ExpectedRows,
  absent?: (groups: readonly (readonly unknown[])[]) => boolean,
): Promise<LedgerMutationResult> =>
  persistWithReconciliation(
    () => mutationAttempt(database, mutations, selectors, expected, absent),
    closureReader(database, selectors, expected, absent),
  ).catch(closeFailure);

const classifyFenceClaimRows = (
  groups: readonly (readonly unknown[])[],
  claim: Readonly<Record<string, unknown>>,
  previousHead: Readonly<Record<string, unknown>> | undefined,
  previousClaim: Readonly<Record<string, unknown>> | undefined,
): ClosureState => {
  try {
    if (groups.length !== (previousClaim === undefined ? 3 : 4))
      return "unreadable";
    const [claims = [], heads = [], histories = [], previousClaims = []] =
      groups;
    if (claims.length === 1) {
      if (
        !rowEquals(claims[0], claim) ||
        heads.length !== 1 ||
        histories.length !== 1 ||
        (previousClaim !== undefined &&
          (previousClaims.length !== 1 ||
            !rowEquals(previousClaims[0], previousClaim)))
      )
        return "mismatch";
      const observedHead = exactRecord(heads[0], [
        "environment",
        "provider_id",
        "generation",
        "provider_run_id",
      ]);
      if (
        observedHead.environment !== claim.environment ||
        observedHead.provider_id !== claim.provider_id ||
        storedInteger(observedHead.generation) <
          storedInteger(claim.generation) ||
        typeof observedHead.provider_run_id !== "string" ||
        !IDS.providerRun.test(observedHead.provider_run_id)
      )
        return "mismatch";
      if (
        !rowEquals(histories[0], {
          closed_history: 1,
          head_generation: observedHead.generation,
          head_provider_run_id: observedHead.provider_run_id,
        })
      )
        return "mismatch";
      return "exact";
    }
    if (
      claims.length !== 0 ||
      histories.length !== 0 ||
      previousClaims.length !== (previousClaim === undefined ? 0 : 1)
    )
      return "mismatch";
    if (previousClaim === undefined)
      return heads.length === 0 ? "absent" : "mismatch";
    return heads.length === 1 &&
      previousHead !== undefined &&
      rowEquals(heads[0], previousHead) &&
      rowEquals(previousClaims[0], previousClaim)
      ? "absent"
      : "mismatch";
  } catch {
    return "unreadable";
  }
};

export const initializePublicationOrchestrationEnvironment = async (input: {
  database: D1Database;
  environment: Environment;
  monthlyAllocationMicrousd: number;
  budgetMonth: string;
  initializedAtMs: number;
}): Promise<LedgerMutationResult> => {
  exactInputRecord(input, [
    "database",
    "environment",
    "monthlyAllocationMicrousd",
    "budgetMonth",
    "initializedAtMs",
  ]);
  const env = environment(input.environment);
  const allocation = safeInteger(input.monthlyAllocationMicrousd, 25_000_000);
  if (!BUDGET_MONTH.test(input.budgetMonth)) throw failure("invalid_input");
  const initializedAtMs = time(input.initializedAtMs);
  const envRow = {
    singleton: 1,
    environment: env,
    monthly_allocation_microusd: allocation,
    initialized_at_ms: initializedAtMs,
  };
  const breakerRow = {
    environment: env,
    budget_month: input.budgetMonth,
    generation: 1,
    tripped: 0,
    observed_at_ms: initializedAtMs,
  };
  return mutate(
    input.database,
    [
      { sql: ASSERT_LEGACY_QUIESCENT_SQL, values: [] },
      {
        sql: INSERT_ENVIRONMENT_SQL,
        values: [1, env, allocation, initializedAtMs],
      },
      {
        sql: INSERT_BREAKER_SQL,
        values: [env, input.budgetMonth, 1, 0, initializedAtMs],
      },
    ],
    [
      { sql: SELECT_ENVIRONMENT_SQL, values: [1] },
      { sql: SELECT_BREAKER_SQL, values: [env, input.budgetMonth, 1] },
    ],
    [[envRow], [breakerRow]],
  );
};

export const readPublicationBudgetAuthority = async (input: {
  database: D1Database;
  environment: Environment;
  budgetMonth: string;
}): Promise<PublicationBudgetAuthority> => {
  exactInputRecord(input, ["database", "environment", "budgetMonth"]);
  const env = environment(input.environment);
  if (!BUDGET_MONTH.test(input.budgetMonth)) throw failure("invalid_input");
  let groups: readonly (readonly unknown[])[];
  try {
    groups = await sessionRows(input.database, [
      { sql: SELECT_BUDGET_SQL, values: [1, input.budgetMonth, env] },
    ]);
  } catch {
    throw failure("outcome_unknown");
  }
  const rows = groups[0] ?? [];
  if (rows.length === 0) throw failure("authority_missing");
  if (rows.length !== 1) throw failure("integrity_failure");
  const row = exactRecord(rows[0], [
    "capability",
    "environment",
    "monthly_allocation_microusd",
    "generation",
    "tripped",
    "monthly_used_cost_microusd",
    "monthly_reserved_cost_microusd",
  ]);
  if (
    row.capability !== CAPABILITY ||
    row.environment !== env ||
    ![0, 1].includes(row.tripped as number)
  )
    throw failure("integrity_failure");
  const authority = {
    capability: CAPABILITY,
    environment: env,
    budgetMonth: input.budgetMonth,
    monthlyAllocationMicrousd: storedInteger(
      row.monthly_allocation_microusd,
      25_000_000,
    ),
    breakerGeneration: storedInteger(row.generation),
    expensiveWorkBreakerTripped: row.tripped === 1,
    monthlyUsedCostMicrousd: storedInteger(
      row.monthly_used_cost_microusd,
      25_000_000,
    ),
    monthlyReservedCostMicrousd: storedInteger(
      row.monthly_reserved_cost_microusd,
      25_000_000,
    ),
  };
  Object.defineProperty(authority, budgetAuthorityBrand, { value: true });
  trustedBudgetAuthorities.add(authority);
  return Object.freeze(authority) as PublicationBudgetAuthority;
};

const occurrenceProjection = (input: {
  occurrenceId: string;
  environment: Environment;
  runPlanId: string;
  runPlanHash: string;
  scheduledAtMs: number;
  observedAtMs: number;
}) => {
  const schedule = {
    occurrence_id: input.occurrenceId,
    scheduled_at_ms: input.scheduledAtMs,
    schedule_expression: SCHEDULE_EXPRESSION,
    schedule_name: SCHEDULE_NAME,
    created_at_ms: input.observedAtMs,
  };
  const occurrence = {
    occurrence_id: input.occurrenceId,
    environment: input.environment,
    requested_run_plan_id: input.runPlanId,
    requested_run_plan_hash: input.runPlanHash,
    observed_at_ms: input.observedAtMs,
    created_at_ms: input.observedAtMs,
  };
  return { schedule, occurrence };
};

export const persistPublicationAdmissionRejection = async (input: {
  database: D1Database;
  rejectionAuthority: unknown;
  report: OrchestrationReportV2;
}): Promise<LedgerMutationResult> => {
  exactInputRecord(input, ["database", "rejectionAuthority", "report"]);
  if (
    !verifyOrchestrationReportV2(input.report) ||
    input.report.kind !== "rejected_firing"
  )
    throw failure("invalid_input");
  if (
    !verifyRejectedFiringDecision(input.rejectionAuthority, {
      scheduleName: input.report.scheduleName,
      scheduleExpression: input.report.scheduleExpression,
      scheduledAt: input.report.scheduledAt,
      observedAt: input.report.observedAt,
      requestedPlan: input.report.requestedPlan,
    })
  )
    throw failure("invalid_input");
  if (input.rejectionAuthority.reason !== input.report.rejectionCode)
    throw failure("invalid_input");
  if (
    !DURABLE_ADMISSION_REJECTION_CODES.includes(
      input.report.rejectionCode as never,
    )
  )
    throw failure("invalid_input");
  encodeOrchestrationReportV2(input.report);
  const occurrenceId = id(input.report.occurrenceId, IDS.occurrence);
  instantMs(input.report.scheduledAt);
  instantMs(input.report.observedAt);
  environment(input.report.requestedPlan.environment);
  id(input.report.requestedPlan.runPlanId, IDS.runPlan);
  hash(input.report.requestedPlan.runPlanHash);
  const derivedOccurrence = deriveScheduleOccurrence(
    input.report.scheduledAt,
    input.report.observedAt,
  );
  if (occurrenceId !== derivedOccurrence.occurrenceId)
    throw failure("invalid_input");
  await Promise.resolve();
  throw failure("authority_missing");
};

type RunIdentity =
  | Readonly<{ kind: "attempt_1"; occurrenceId: string; runId: string }>
  | Readonly<{
      kind: "explicit_replay";
      runId: string;
      replay: AdjacentReplayDecision;
      replayAuthorizationHash: string;
    }>;

export const persistAdmittedPublicationRun = async (input: {
  database: D1Database;
  admission: unknown;
  identity: RunIdentity;
  providerRunIds: readonly string[];
  budget: PublicationBudgetAuthority;
  codeVersion: string;
  observedAt: string;
  startedAt: string;
}): Promise<LedgerMutationResult> => {
  exactInputRecord(input, [
    "database",
    "admission",
    "identity",
    "providerRunIds",
    "budget",
    "codeVersion",
    "observedAt",
    "startedAt",
  ]);
  if (!verifyAdmittedFiringDecision(input.admission))
    throw failure("invalid_input");
  const admission = input.admission;
  const providerRunIdsValue = denseInputArray(input.providerRunIds, 16);
  const identityValue: unknown = input.identity;
  if (
    typeof identityValue !== "object" ||
    identityValue === null ||
    Array.isArray(identityValue)
  )
    throw failure("invalid_input");
  const identityKind: unknown = input.identity.kind;
  if (identityKind !== "attempt_1" && identityKind !== "explicit_replay")
    throw failure("invalid_input");
  if (input.identity.kind === "explicit_replay")
    throw failure("authority_missing");
  if (!trustedBudgetAuthorities.has(input.budget))
    throw failure("invalid_input");
  if (
    input.budget.environment !== admission.environment ||
    input.budget.monthlyAllocationMicrousd <= 0 ||
    input.budget.expensiveWorkBreakerTripped ||
    input.budget.monthlyUsedCostMicrousd +
      input.budget.monthlyReservedCostMicrousd +
      admission.runCeilings.costMicrousd !==
      admission.projectedMonthlyCostMicrousd ||
    admission.projectedMonthlyCostMicrousd >
      input.budget.monthlyAllocationMicrousd
  )
    throw failure("invalid_input");
  const scheduledAtMs = instantMs(admission.scheduledAt);
  if (input.budget.budgetMonth !== admission.scheduledAt.slice(0, 7))
    throw failure("invalid_input");
  const observedAtMs = instantMs(input.observedAt);
  const startedAtMs = instantMs(input.startedAt);
  const deadlineAtMs = instantMs(admission.terminalDeadlineAt);
  if (
    observedAtMs < scheduledAtMs ||
    startedAtMs < observedAtMs ||
    startedAtMs >= deadlineAtMs
  )
    throw failure("invalid_input");
  if (!CODE_VERSION.test(input.codeVersion)) throw failure("invalid_input");
  if (providerRunIdsValue.length !== admission.providers.length)
    throw failure("invalid_input");
  const providerRunIds = providerRunIdsValue.map((value) =>
    id(value, IDS.providerRun),
  );
  if (new Set(providerRunIds).size !== providerRunIds.length)
    throw failure("invalid_input");
  exactInputRecord(input.identity, ["kind", "occurrenceId", "runId"]);
  const occurrenceId = id(input.identity.occurrenceId, IDS.occurrence);
  const runId = id(input.identity.runId, IDS.run);
  const attemptNumber = 1;
  const derivedOccurrence = deriveScheduleOccurrence(
    admission.scheduledAt,
    input.observedAt,
  );
  if (occurrenceId !== derivedOccurrence.occurrenceId)
    throw failure("invalid_input");
  let derivedRun: ReturnType<typeof createPipelineRun>;
  try {
    derivedRun = createPipelineRun({
      writer: LEDGER_WRITER,
      occurrence: derivedOccurrence,
      attemptNumber,
      codeVersion: input.codeVersion,
      schemaVersion: admission.canonicalSchemaVersion,
      providerScope: admission.providerScope,
      startedAt: input.startedAt,
    });
  } catch {
    throw failure("invalid_input");
  }
  if (runId !== derivedRun.runId) throw failure("invalid_input");
  for (const [index, provider] of admission.providers.entries()) {
    let derivedProviderRunId: string;
    try {
      derivedProviderRunId = createProviderSlice({
        run: derivedRun,
        occurrence: derivedOccurrence,
        providerId: provider.providerId,
      }).providerSliceId;
    } catch {
      throw failure("invalid_input");
    }
    if (providerRunIds[index] !== derivedProviderRunId)
      throw failure("invalid_input");
  }
  const env = admission.environment;
  const { schedule, occurrence } = occurrenceProjection({
    occurrenceId,
    environment: env,
    runPlanId: admission.runPlanId,
    runPlanHash: admission.runPlanHash,
    scheduledAtMs,
    observedAtMs,
  });
  const run = {
    run_id: runId,
    occurrence_id: occurrenceId,
    attempt_number: attemptNumber,
    replay_of_run_id: null,
    replay_authority: null,
    replay_authorization_hash: null,
    run_plan_id: admission.runPlanId,
    run_plan_hash: admission.runPlanHash,
    environment: env,
    code_version: input.codeVersion,
    canonical_schema_version: admission.canonicalSchemaVersion,
    pipeline_contract_version: admission.pipelineContractVersion,
    provider_count: admission.providers.length,
    provider_scope_hash: publicationPlanProviderScopeHash(
      admission.providerScope,
    ),
    policy_set_hash: admission.policySetHash,
    deadline_at_ms: deadlineAtMs,
    observed_at_ms: observedAtMs,
    started_at_ms: startedAtMs,
    request_ceiling: admission.runCeilings.requests,
    byte_ceiling: admission.runCeilings.bytes,
    ai_token_ceiling: admission.runCeilings.aiTokens,
    browser_millisecond_ceiling: admission.runCeilings.browserMilliseconds,
    elapsed_millisecond_ceiling: admission.runCeilings.elapsedMilliseconds,
    cost_microusd_ceiling: admission.runCeilings.costMicrousd,
    projected_monthly_cost_microusd: admission.projectedMonthlyCostMicrousd,
    budget_alert_percent: admission.budgetAlertPercent,
    created_at_ms: observedAtMs,
  };
  const providerRows = admission.providers.map((provider, index) => ({
    provider_run_id: providerRunIds[index],
    run_id: runId,
    provider_id: provider.providerId,
    ordinal: provider.ordinal,
    adapter_version: provider.adapterVersion,
    roster_version: provider.rosterVersion,
    roster_content_hash: provider.rosterContentHash,
    source_register_version: provider.sourceRegisterVersion,
    source_artifact_hash: provider.sourceRegisterArtifactHash,
    request_ceiling: provider.requestCeiling,
    byte_ceiling: provider.byteCeiling,
    ai_token_ceiling: provider.aiTokenCeiling,
    browser_millisecond_ceiling: provider.browserMillisecondCeiling,
    elapsed_millisecond_ceiling: provider.elapsedMillisecondCeiling,
    cost_microusd_ceiling: provider.costMicrousdCeiling,
    retry_policy_hash: provider.retryPolicyHash,
    admitted_at_ms: startedAtMs,
    created_at_ms: observedAtMs,
  }));
  const reservation = {
    run_id: runId,
    environment: env,
    budget_month: input.budget.budgetMonth,
    breaker_generation: input.budget.breakerGeneration,
    monthly_used_snapshot_microusd: input.budget.monthlyUsedCostMicrousd,
    monthly_reserved_snapshot_microusd:
      input.budget.monthlyReservedCostMicrousd,
    reserved_cost_microusd: admission.runCeilings.costMicrousd,
    reserved_at_ms: observedAtMs,
  };
  const selectors = [
    { sql: SELECT_SCHEDULE_OCCURRENCE_SQL, values: [occurrenceId] },
    { sql: SELECT_ORCHESTRATION_OCCURRENCE_SQL, values: [occurrenceId] },
    { sql: SELECT_RUN_SQL, values: [runId] },
    { sql: SELECT_PROVIDER_RUNS_SQL, values: [runId] },
    { sql: SELECT_RESERVATION_SQL, values: [runId] },
  ];
  return mutate(
    input.database,
    [
      {
        sql: INSERT_SCHEDULE_OCCURRENCE_SQL,
        values: Object.values(schedule),
      },
      {
        sql: INSERT_ORCHESTRATION_OCCURRENCE_SQL,
        values: Object.values(occurrence),
      },
      { sql: INSERT_RUN_SQL, values: Object.values(run) },
      ...providerRows.map((row) => ({
        sql: INSERT_PROVIDER_RUN_SQL,
        values: Object.values(row),
      })),
      { sql: INSERT_RESERVATION_SQL, values: Object.values(reservation) },
    ],
    selectors,
    [[schedule], [occurrence], [run], providerRows, [reservation]],
  );
};

export const claimPublicationProviderFence = async (input: {
  database: D1Database;
  environment: Environment;
  providerId: string;
  generation: number;
  providerRunId: string;
  runId: string;
  occurrenceId: string;
  deadlineAt: string;
  claimedAt: string;
  previous?: Readonly<{
    generation: number;
    providerRunId: string;
    runId: string;
    occurrenceId: string;
    deadlineAt: string;
    claimedAt: string;
  }>;
}): Promise<LedgerMutationResult> => {
  exactInputRecord(input, [
    "database",
    "environment",
    "providerId",
    "generation",
    "providerRunId",
    "runId",
    "occurrenceId",
    "deadlineAt",
    "claimedAt",
    ...(Object.prototype.hasOwnProperty.call(input, "previous")
      ? ["previous"]
      : []),
  ]);
  const env = environment(input.environment);
  const providerId = id(input.providerId, IDS.provider);
  const generation = safeInteger(input.generation);
  if (generation < 1) throw failure("invalid_input");
  const providerRunId = id(input.providerRunId, IDS.providerRun);
  const runId = id(input.runId, IDS.run);
  const occurrenceId = id(input.occurrenceId, IDS.occurrence);
  const deadlineAtMs = instantMs(input.deadlineAt);
  const claimedAtMs = instantMs(input.claimedAt);
  if (claimedAtMs >= deadlineAtMs) throw failure("invalid_input");
  if ((generation === 1) !== (input.previous === undefined))
    throw failure("invalid_input");
  const claim = {
    environment: env,
    provider_id: providerId,
    generation,
    provider_run_id: providerRunId,
    run_id: runId,
    occurrence_id: occurrenceId,
    deadline_at_ms: deadlineAtMs,
    claimed_at_ms: claimedAtMs,
  };
  const head = {
    environment: env,
    provider_id: providerId,
    generation,
    provider_run_id: providerRunId,
  };
  let previousHead: Readonly<Record<string, unknown>> | undefined;
  let previousClaim: Readonly<Record<string, unknown>> | undefined;
  const mutations: { sql: string; values: readonly unknown[] }[] = [
    { sql: INSERT_FENCE_CLAIM_SQL, values: Object.values(claim) },
  ];
  if (generation === 1) {
    mutations.push({ sql: INSERT_FENCE_HEAD_SQL, values: Object.values(head) });
  } else {
    const previous = input.previous;
    if (previous !== undefined)
      exactInputRecord(previous, [
        "generation",
        "providerRunId",
        "runId",
        "occurrenceId",
        "deadlineAt",
        "claimedAt",
      ]);
    if (
      previous === undefined ||
      safeInteger(previous.generation) !== generation - 1
    )
      throw failure("invalid_input");
    const previousRunId = id(previous.providerRunId, IDS.providerRun);
    previousHead = {
      environment: env,
      provider_id: providerId,
      generation: previous.generation,
      provider_run_id: previousRunId,
    };
    previousClaim = {
      environment: env,
      provider_id: providerId,
      generation: previous.generation,
      provider_run_id: previousRunId,
      run_id: id(previous.runId, IDS.run),
      occurrence_id: id(previous.occurrenceId, IDS.occurrence),
      deadline_at_ms: instantMs(previous.deadlineAt),
      claimed_at_ms: instantMs(previous.claimedAt),
    };
    mutations.unshift({
      sql: ASSERT_FENCE_HEAD_SQL,
      values: [env, providerId, previous.generation, previousRunId],
    });
    mutations.push({
      sql: ADVANCE_FENCE_HEAD_SQL,
      values: [
        env,
        providerId,
        generation,
        providerRunId,
        previous.generation,
        previousRunId,
      ],
    });
    mutations.push({
      sql: ASSERT_FENCE_HEAD_SQL,
      values: [env, providerId, generation, providerRunId],
    });
  }
  const selectors = [
    { sql: SELECT_FENCE_CLAIM_SQL, values: [env, providerId, generation] },
    { sql: SELECT_FENCE_HEAD_SQL, values: [env, providerId] },
    {
      sql: SELECT_FENCE_CLOSED_HISTORY_SQL,
      values: [env, providerId, generation],
    },
    ...(previousClaim === undefined
      ? []
      : [
          {
            sql: SELECT_FENCE_CLAIM_SQL,
            values: [env, providerId, generation - 1],
          },
        ]),
  ];
  const classify = (groups: readonly (readonly unknown[])[]) =>
    classifyFenceClaimRows(groups, claim, previousHead, previousClaim);
  return persistWithReconciliation(
    async () =>
      classify(
        (await sessionRows(input.database, [...mutations, ...selectors])).slice(
          mutations.length,
        ),
      ),
    async () => classify(await sessionRows(input.database, selectors)),
  ).catch(closeFailure);
};

export const persistSourceFreeRosterOutcome = async (input: {
  database: D1Database;
  fenceClaim: Readonly<{
    environment: Environment;
    providerId: string;
    generation: number;
    providerRunId: string;
    runId: string;
    occurrenceId: string;
    deadlineAt: string;
    claimedAt: string;
  }>;
  rosterItemId: string;
  status: "unavailable" | "failed" | "quarantined";
  errorCode:
    | "provider_unavailable"
    | "provider_failed"
    | "provider_quarantined"
    | "terminal_deadline_elapsed";
  attemptCount: 0;
  createdAt: string;
}): Promise<LedgerMutationResult> => {
  exactInputRecord(input, [
    "database",
    "fenceClaim",
    "rosterItemId",
    "status",
    "errorCode",
    "attemptCount",
    "createdAt",
  ]);
  exactInputRecord(input.fenceClaim, [
    "environment",
    "providerId",
    "generation",
    "providerRunId",
    "runId",
    "occurrenceId",
    "deadlineAt",
    "claimedAt",
  ]);
  const env = environment(input.fenceClaim.environment);
  const providerId = id(input.fenceClaim.providerId, IDS.provider);
  const generation = safeInteger(input.fenceClaim.generation);
  const providerRunId = id(input.fenceClaim.providerRunId, IDS.providerRun);
  const runId = id(input.fenceClaim.runId, IDS.run);
  const occurrenceId = id(input.fenceClaim.occurrenceId, IDS.occurrence);
  const deadlineAtMs = instantMs(input.fenceClaim.deadlineAt);
  const claimedAtMs = instantMs(input.fenceClaim.claimedAt);
  const rosterItemId = printable(input.rosterItemId, 1, 128);
  const attemptCount = safeInteger(input.attemptCount, 0);
  const createdAtMs = instantMs(input.createdAt);
  if (
    generation < 1 ||
    attemptCount !== 0 ||
    claimedAtMs >= deadlineAtMs ||
    createdAtMs < claimedAtMs
  )
    throw failure("invalid_input");
  const rosterStatus: unknown = input.status;
  const rosterErrorCode: unknown = input.errorCode;
  if (
    rosterStatus !== "unavailable" &&
    rosterStatus !== "failed" &&
    rosterStatus !== "quarantined"
  )
    throw failure("invalid_input");
  if (
    rosterErrorCode !== "provider_unavailable" &&
    rosterErrorCode !== "provider_failed" &&
    rosterErrorCode !== "provider_quarantined" &&
    rosterErrorCode !== "terminal_deadline_elapsed"
  )
    throw failure("invalid_input");
  if (
    (input.status === "unavailable" &&
      !["provider_unavailable", "terminal_deadline_elapsed"].includes(
        input.errorCode,
      )) ||
    (input.status === "failed" &&
      !["provider_failed", "terminal_deadline_elapsed"].includes(
        input.errorCode,
      )) ||
    (input.status === "quarantined" &&
      input.errorCode !== "provider_quarantined")
  )
    throw failure("invalid_input");
  const row = {
    provider_run_id: providerRunId,
    roster_item_id: rosterItemId,
    status: input.status,
    evidence_id: null,
    offering_id: null,
    error_code: input.errorCode,
    attempt_count: attemptCount,
    created_at_ms: createdAtMs,
  };
  const claim = {
    environment: env,
    provider_id: providerId,
    generation,
    provider_run_id: providerRunId,
    run_id: runId,
    occurrence_id: occurrenceId,
    deadline_at_ms: deadlineAtMs,
    claimed_at_ms: claimedAtMs,
  };
  return mutate(
    input.database,
    [
      {
        sql: ASSERT_ACTIVE_FENCE_SQL,
        values: [env, providerId, generation, providerRunId],
      },
      {
        sql: INSERT_ROSTER_OUTCOME_SQL,
        values: [
          providerRunId,
          rosterItemId,
          input.status,
          input.errorCode,
          attemptCount,
          createdAtMs,
        ],
      },
    ],
    [
      {
        sql: SELECT_FENCE_CLAIM_SQL,
        values: [env, providerId, generation],
      },
      {
        sql: SELECT_ROSTER_OUTCOME_SQL,
        values: [providerRunId, rosterItemId],
      },
    ],
    [[claim], [row]],
    (groups) =>
      groups[0]?.length === 1 &&
      rowEquals(groups[0][0], claim) &&
      groups[1]?.length === 0,
  );
};

type ProviderTerminalInput = Readonly<{
  state: "ready" | "failed" | "quarantined";
  rosterComplete: true;
  publicationDisposition: "new" | "carried_forward" | "unavailable";
  sliceId?: string;
  cost: Readonly<{
    requests: number;
    bytes: number;
    aiTokens: number;
    browserMilliseconds: number;
    elapsedMilliseconds: number;
    costMicrousd: number;
  }>;
  errorCodes: readonly string[];
}>;

const PROVIDER_TERMINAL_ERROR_CODES: readonly string[] = Object.freeze([
  "provider_failed",
  "provider_quarantined",
  "provider_unavailable",
  "terminal_deadline_elapsed",
]);

export const terminalizePublicationProvider = async (input: {
  database: D1Database;
  environment: Environment;
  providerId: string;
  providerRunId: string;
  fenceGeneration: number;
  terminal: ProviderTerminalInput;
  endedAt: string;
  reconciledAt: string;
  releasedAt: string;
  reconciliationResult:
    "terminal_confirmed" | "terminal_after_deadline_confirmed";
}): Promise<LedgerMutationResult> => {
  exactInputRecord(input, [
    "database",
    "environment",
    "providerId",
    "providerRunId",
    "fenceGeneration",
    "terminal",
    "endedAt",
    "reconciledAt",
    "releasedAt",
    "reconciliationResult",
  ]);
  exactInputRecord(input.terminal, [
    "state",
    "rosterComplete",
    "publicationDisposition",
    ...(Object.prototype.hasOwnProperty.call(input.terminal, "sliceId")
      ? ["sliceId"]
      : []),
    "cost",
    "errorCodes",
  ]);
  exactInputRecord(input.terminal.cost, [
    "requests",
    "bytes",
    "aiTokens",
    "browserMilliseconds",
    "elapsedMilliseconds",
    "costMicrousd",
  ]);
  const env = environment(input.environment);
  const providerId = id(input.providerId, IDS.provider);
  const providerRunId = id(input.providerRunId, IDS.providerRun);
  const generation = safeInteger(input.fenceGeneration);
  const rosterComplete: unknown = input.terminal.rosterComplete;
  if (generation < 1 || rosterComplete !== true) throw failure("invalid_input");
  const reconciliationResult: unknown = input.reconciliationResult;
  if (
    reconciliationResult !== "terminal_confirmed" &&
    reconciliationResult !== "terminal_after_deadline_confirmed"
  )
    throw failure("invalid_input");
  const terminalState: unknown = input.terminal.state;
  const terminalDisposition: unknown = input.terminal.publicationDisposition;
  if (
    terminalState !== "ready" &&
    terminalState !== "failed" &&
    terminalState !== "quarantined"
  )
    throw failure("invalid_input");
  if (
    terminalDisposition !== "new" &&
    terminalDisposition !== "carried_forward" &&
    terminalDisposition !== "unavailable"
  )
    throw failure("invalid_input");
  if (terminalState !== "ready" && terminalDisposition === "new")
    throw failure("invalid_input");
  if (terminalDisposition === "carried_forward")
    throw failure("authority_missing");
  if (terminalState === "ready" || input.terminal.sliceId !== undefined)
    throw failure("authority_missing");
  const endedAtMs = instantMs(input.endedAt);
  const reconciledAtMs = instantMs(input.reconciledAt);
  const releasedAtMs = instantMs(input.releasedAt);
  if (reconciledAtMs < endedAtMs || releasedAtMs < reconciledAtMs)
    throw failure("invalid_input");
  const errorCodesValue = denseInputArray(input.terminal.errorCodes, 4);
  if (errorCodesValue.some((code) => typeof code !== "string"))
    throw failure("invalid_input");
  const errorCodes = [...(errorCodesValue as string[])];
  if (
    errorCodes.length > 4 ||
    errorCodes.some(
      (code, index) =>
        !PROVIDER_TERMINAL_ERROR_CODES.includes(code) ||
        (index > 0 && (errorCodes[index - 1] ?? "") >= code),
    )
  )
    throw failure("invalid_input");
  if (
    (terminalState === "failed" &&
      (!errorCodes.some(
        (code) =>
          code === "provider_failed" || code === "terminal_deadline_elapsed",
      ) ||
        errorCodes.includes("provider_quarantined"))) ||
    (terminalState === "quarantined" &&
      !errorCodes.includes("provider_quarantined")) ||
    !errorCodes.some(
      (code) =>
        code === "provider_unavailable" || code === "terminal_deadline_elapsed",
    )
  )
    throw failure("invalid_input");
  for (const value of Object.values(input.terminal.cost)) safeInteger(value);
  const terminal = {
    provider_run_id: providerRunId,
    fence_generation: generation,
    state: input.terminal.state,
    roster_complete: 1,
    publication_disposition: "unavailable",
    slice_id: null,
    requests: input.terminal.cost.requests,
    bytes: input.terminal.cost.bytes,
    ai_tokens: input.terminal.cost.aiTokens,
    browser_milliseconds: input.terminal.cost.browserMilliseconds,
    elapsed_milliseconds: input.terminal.cost.elapsedMilliseconds,
    cost_microusd: input.terminal.cost.costMicrousd,
    error_codes_json: JSON.stringify(errorCodes),
    ended_at_ms: endedAtMs,
  };
  const reconciliation = {
    environment: env,
    provider_id: providerId,
    generation,
    provider_run_id: providerRunId,
    result: input.reconciliationResult,
    reconciled_at_ms: reconciledAtMs,
  };
  // D1 verifies whether the terminal crossed its claimed deadline.
  const release = {
    environment: env,
    provider_id: providerId,
    generation,
    provider_run_id: providerRunId,
    released_at_ms: releasedAtMs,
  };
  return mutate(
    input.database,
    [
      {
        sql: ASSERT_ACTIVE_FENCE_SQL,
        values: [env, providerId, generation, providerRunId],
      },
      { sql: INSERT_PROVIDER_TERMINAL_SQL, values: Object.values(terminal) },
      {
        sql: INSERT_FENCE_RECONCILIATION_SQL,
        values: Object.values(reconciliation),
      },
      { sql: INSERT_FENCE_RELEASE_SQL, values: Object.values(release) },
    ],
    [
      { sql: SELECT_PROVIDER_TERMINAL_SQL, values: [providerRunId] },
      {
        sql: SELECT_FENCE_RECONCILIATION_SQL,
        values: [env, providerId, generation],
      },
      { sql: SELECT_FENCE_RELEASE_SQL, values: [env, providerId, generation] },
    ],
    [[terminal], [reconciliation], [release]],
  );
};

export const persistPublicationRunTerminal = async (input: {
  database: D1Database;
  admission: AdmittedFiringDecision;
  runAuthority: TerminalRunIdentityAuthorityV2;
  report: TerminalRunReportV2;
}): Promise<LedgerMutationResult> => {
  exactInputRecord(input, ["database", "admission", "runAuthority", "report"]);
  if (!verifyAdmittedFiringDecision(input.admission))
    throw failure("invalid_input");
  let reportText: string;
  try {
    reportText = encodeOrchestrationReportV2(
      input.report,
      input.admission,
      input.runAuthority,
    );
  } catch {
    throw failure("invalid_input");
  }
  const report = JSON.parse(reportText) as TerminalRunReportV2;
  if (
    report.publicationDisposition === "retain_current" ||
    report.retainedPublication !== undefined ||
    report.providers.some(
      ({ publicationDisposition }) =>
        publicationDisposition === "carried_forward",
    )
  )
    throw failure("authority_missing");
  const runId = id(report.runId, IDS.run);
  const endedAtMs = instantMs(report.endedAt);
  const row = {
    run_id: runId,
    run_outcome: report.runOutcome,
    publication_disposition: report.publicationDisposition,
    run_wide_quarantine: report.runOutcome === "quarantined" ? 1 : 0,
    requests: report.cost.requests,
    bytes: report.cost.bytes,
    ai_tokens: report.cost.aiTokens,
    browser_milliseconds: report.cost.browserMilliseconds,
    elapsed_milliseconds: report.cost.elapsedMilliseconds,
    cost_microusd: report.cost.costMicrousd,
    error_codes_json: JSON.stringify(report.errorCodes),
    ended_at_ms: endedAtMs,
    report_schema_version: report.reportSchemaVersion,
    report_text: reportText,
    report_hash: report.seal.contentHash,
  };
  return mutate(
    input.database,
    [{ sql: INSERT_RUN_TERMINAL_SQL, values: Object.values(row) }],
    [{ sql: SELECT_RUN_TERMINAL_SQL, values: [runId] }],
    [[row]],
  );
};
