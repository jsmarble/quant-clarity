-- Closed, parallel publication-orchestration coordination authority.
-- This migration deliberately does not write or reinterpret the legacy
-- pipeline_run/provider_run/roster_outcome provenance graph.
-- Requirements: PIPE-001–PIPE-008, PIPE-019, PIPE-037, PIPE-043–PIPE-045,
-- BE-003–BE-006, CF-005–CF-007, OPS-001–OPS-007, QA-006, SM-01.

PRAGMA defer_foreign_keys = true;

-- Install only over the exact Phase 7.2-B predecessor capability. A malformed
-- predecessor must fail before this migration creates any object.
SELECT CASE WHEN (
  SELECT count(*) FROM schema_metadata
) <> 1 OR (
  SELECT count(*) FROM schema_metadata
  WHERE singleton = 1 AND schema_version = '1.0.0'
) <> 1 OR (
  SELECT count(*) FROM publication_run_plan_authority_integrity_metadata
) <> 1 OR (
  SELECT count(*) FROM publication_run_plan_authority_integrity_metadata
  WHERE singleton = 1
    AND capability = 'publication-run-plan-authority@1'
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name IN (
    'schedule_occurrence', 'pipeline_run', 'provider_run', 'acquisition_run',
    'roster_outcome', 'publication_run_plan',
    'publication_run_plan_provider', 'publication_run_plan_policy',
    'publication_run_plan_seal', 'publication_run_plan_approval',
    'publication_run_plan_authority_integrity_metadata'
  )
) <> 11 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name IN (
    'publication_run_plan_immutable_update',
    'publication_run_plan_provider_immutable_update',
    'publication_run_plan_policy_immutable_update',
    'publication_run_plan_seal_immutable_update',
    'publication_run_plan_approval_immutable_update'
  )
) <> 5 THEN json('') END;

-- Same-name objects of every SQLite kind are collisions at this authority
-- boundary. Keep this list synchronized with every object created below.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema WHERE name IN (
    'publication_orchestration_integrity_metadata',
    'publication_orchestration_environment',
    'publication_orchestration_occurrence',
    'publication_admission_rejection',
    'publication_coordination_run',
    'publication_coordination_provider_run',
    'publication_budget_breaker_event',
    'publication_run_budget_reservation',
    'publication_provider_fence_claim',
    'publication_provider_fence_reconciliation',
    'publication_provider_fence_release',
    'publication_provider_fence_head',
    'publication_roster_operational_outcome',
    'publication_retained_publication_authority',
    'publication_provider_terminal',
    'publication_run_terminal',
    'publication_coordination_run_occurrence_attempt_uq',
    'publication_coordination_provider_run_ordinal_uq',
    'publication_budget_breaker_latest_idx',
    'publication_orchestration_integrity_metadata_insert_guard',
    'publication_orchestration_integrity_metadata_immutable_update',
    'publication_orchestration_integrity_metadata_immutable_delete',
    'publication_orchestration_environment_insert_guard',
    'publication_orchestration_environment_immutable_update',
    'publication_orchestration_environment_immutable_delete',
    'legacy_pipeline_run_disabled',
    'legacy_pipeline_run_update_disabled',
    'legacy_provider_run_disabled',
    'legacy_provider_run_update_disabled',
    'legacy_acquisition_run_disabled',
    'legacy_acquisition_run_update_disabled',
    'legacy_roster_outcome_disabled',
    'legacy_observation_disabled',
    'legacy_evidence_disabled',
    'legacy_field_claim_disabled',
    'legacy_claim_conflict_disabled',
    'legacy_parameter_fact_disabled',
    'legacy_parameter_fact_update_disabled',
    'legacy_parameter_fact_delete_disabled',
    'legacy_precision_observation_disabled',
    'legacy_precision_component_disabled',
    'legacy_price_schedule_disabled',
    'legacy_anomaly_disabled',
    'legacy_anomaly_update_disabled',
    'legacy_anomaly_delete_disabled',
    'legacy_quarantine_disabled',
    'legacy_quarantine_update_disabled',
    'legacy_quarantine_delete_disabled',
    'schedule_occurrence_orchestration_immutable_update',
    'schedule_occurrence_orchestration_immutable_delete',
    'publication_orchestration_occurrence_insert_guard',
    'publication_orchestration_occurrence_immutable_update',
    'publication_orchestration_occurrence_immutable_delete',
    'publication_admission_rejection_insert_guard',
    'publication_admission_rejection_activation_blocked',
    'publication_admission_rejection_immutable_update',
    'publication_admission_rejection_immutable_delete',
    'publication_coordination_run_insert_guard',
    'publication_coordination_run_immutable_update',
    'publication_coordination_run_immutable_delete',
    'publication_coordination_provider_run_insert_guard',
    'publication_coordination_provider_run_immutable_update',
    'publication_coordination_provider_run_immutable_delete',
    'publication_budget_breaker_event_insert_guard',
    'publication_budget_breaker_event_immutable_update',
    'publication_budget_breaker_event_immutable_delete',
    'publication_run_budget_reservation_insert_guard',
    'publication_run_budget_reservation_immutable_update',
    'publication_run_budget_reservation_immutable_delete',
    'publication_provider_fence_claim_insert_guard',
    'publication_provider_fence_claim_immutable_update',
    'publication_provider_fence_claim_immutable_delete',
    'publication_provider_fence_reconciliation_insert_guard',
    'publication_provider_fence_reconciliation_immutable_update',
    'publication_provider_fence_reconciliation_immutable_delete',
    'publication_provider_fence_release_insert_guard',
    'publication_provider_fence_release_immutable_update',
    'publication_provider_fence_release_immutable_delete',
    'publication_provider_fence_head_insert_guard',
    'publication_provider_fence_head_update_guard',
    'publication_provider_fence_head_immutable_delete',
    'publication_roster_operational_outcome_insert_guard',
    'publication_roster_outcome_source_execution_blocked',
    'publication_roster_operational_outcome_immutable_update',
    'publication_roster_operational_outcome_immutable_delete',
    'publication_retained_publication_authority_insert_guard',
    'publication_retained_publication_authority_activation_blocked',
    'publication_retained_publication_authority_immutable_update',
    'publication_retained_publication_authority_immutable_delete',
    'publication_provider_terminal_insert_guard',
    'publication_provider_terminal_immutable_update',
    'publication_provider_terminal_immutable_delete',
    'publication_run_terminal_insert_guard',
    'publication_run_terminal_immutable_update',
    'publication_run_terminal_immutable_delete'
  )
) THEN json('') END;

CREATE TABLE publication_orchestration_integrity_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  capability TEXT NOT NULL
    CHECK (capability = 'publication-orchestration-ledger@1')
) STRICT;

INSERT INTO publication_orchestration_integrity_metadata (
  singleton, capability
) VALUES (1, 'publication-orchestration-ledger@1');

-- Deliberately empty after migration. A later protected initialization may
-- choose exactly one physical-database environment and a checked-in share of
-- the global USD 25 monthly control target. Zero disables all admissions.
CREATE TABLE publication_orchestration_environment (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  environment TEXT NOT NULL UNIQUE
    CHECK (environment IN ('preview', 'production')),
  monthly_allocation_microusd INTEGER NOT NULL CHECK (
    typeof(monthly_allocation_microusd) = 'integer' AND
    monthly_allocation_microusd BETWEEN 0 AND 25000000
  ),
  initialized_at_ms INTEGER NOT NULL CHECK (
    typeof(initialized_at_ms) = 'integer' AND
    initialized_at_ms BETWEEN 0 AND 253402300799999
  )
) STRICT;

CREATE TABLE publication_orchestration_occurrence (
  occurrence_id TEXT PRIMARY KEY
    REFERENCES schedule_occurrence(occurrence_id) ON DELETE RESTRICT CHECK (
      length(occurrence_id) = 40 AND substr(occurrence_id, 1, 4) = 'occ_' AND
      occurrence_id = lower(occurrence_id) AND
      substr(occurrence_id, 13, 1) = '-' AND substr(occurrence_id, 18, 1) = '-' AND
      substr(occurrence_id, 19, 1) = '4' AND substr(occurrence_id, 23, 1) = '-' AND
      substr(occurrence_id, 24, 1) IN ('8', '9', 'a', 'b') AND
      substr(occurrence_id, 28, 1) = '-' AND
      substr(occurrence_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
      substr(occurrence_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(occurrence_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(occurrence_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(occurrence_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
    ),
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  requested_run_plan_id TEXT NOT NULL CHECK (
    length(requested_run_plan_id) = 40 AND
    substr(requested_run_plan_id, 1, 4) = 'rpl_' AND
    requested_run_plan_id = lower(requested_run_plan_id) AND
    substr(requested_run_plan_id, 13, 1) = '-' AND substr(requested_run_plan_id, 18, 1) = '-' AND
    substr(requested_run_plan_id, 19, 1) = '4' AND substr(requested_run_plan_id, 23, 1) = '-' AND
    substr(requested_run_plan_id, 24, 1) IN ('8', '9', 'a', 'b') AND
    substr(requested_run_plan_id, 28, 1) = '-' AND
    substr(requested_run_plan_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(requested_run_plan_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(requested_run_plan_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(requested_run_plan_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(requested_run_plan_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  requested_run_plan_hash TEXT NOT NULL CHECK (
    length(requested_run_plan_hash) = 71 AND
    substr(requested_run_plan_hash, 1, 7) = 'sha256:' AND
    substr(requested_run_plan_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  observed_at_ms INTEGER NOT NULL CHECK (
    typeof(observed_at_ms) = 'integer' AND
    observed_at_ms BETWEEN 0 AND 253402300799999
  ),
  created_at_ms INTEGER NOT NULL CHECK (
    typeof(created_at_ms) = 'integer' AND
    created_at_ms BETWEEN 0 AND observed_at_ms
  )
) STRICT;

CREATE TABLE publication_admission_rejection (
  occurrence_id TEXT PRIMARY KEY
    REFERENCES publication_orchestration_occurrence(occurrence_id)
    ON DELETE RESTRICT,
  rejection_code TEXT NOT NULL CHECK (rejection_code IN (
    'plan_unavailable', 'plan_invalid', 'plan_not_effective', 'plan_revoked',
    'source_authority_invalid', 'runtime_version_mismatch',
    'plan_context_mismatch', 'policy_mismatch', 'budget_exceeded',
    'expensive_work_breaker', 'terminal_deadline_elapsed'
  )),
  report_schema_version TEXT NOT NULL
    CHECK (report_schema_version = 'publication-run-report@2'),
  report_text TEXT NOT NULL CHECK (
    json_valid(report_text) AND json_type(report_text) = 'object' AND
    report_text = json(report_text) AND
    length(CAST(report_text AS BLOB)) BETWEEN 2 AND 16384 AND
    report_text NOT GLOB '*[^ -~]*'
  ),
  report_hash TEXT NOT NULL UNIQUE CHECK (
    length(report_hash) = 71 AND
    substr(report_hash, 1, 7) = 'sha256:' AND
    substr(report_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  created_at_ms INTEGER NOT NULL CHECK (
    typeof(created_at_ms) = 'integer' AND
    created_at_ms BETWEEN 0 AND 253402300799999
  )
) STRICT;

CREATE TABLE publication_coordination_run (
  run_id TEXT PRIMARY KEY CHECK (
    length(run_id) = 40 AND substr(run_id, 1, 4) = 'run_' AND
    run_id = lower(run_id) AND
    substr(run_id, 13, 1) = '-' AND substr(run_id, 18, 1) = '-' AND
    substr(run_id, 19, 1) = '4' AND substr(run_id, 23, 1) = '-' AND
    substr(run_id, 24, 1) IN ('8', '9', 'a', 'b') AND substr(run_id, 28, 1) = '-' AND
    substr(run_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(run_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(run_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(run_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(run_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  occurrence_id TEXT NOT NULL
    REFERENCES publication_orchestration_occurrence(occurrence_id)
    ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (
    typeof(attempt_number) = 'integer' AND attempt_number BETWEEN 1 AND 1000
  ),
  replay_of_run_id TEXT REFERENCES publication_coordination_run(run_id)
    ON DELETE RESTRICT,
  replay_authority TEXT CHECK (
    replay_authority IS NULL OR replay_authority = 'protected_operator'
  ),
  replay_authorization_hash TEXT CHECK (
    replay_authorization_hash IS NULL OR (
      length(replay_authorization_hash) = 71 AND
      substr(replay_authorization_hash, 1, 7) = 'sha256:' AND
      substr(replay_authorization_hash, 8) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  run_plan_id TEXT NOT NULL
    REFERENCES publication_run_plan_approval(run_plan_id) ON DELETE RESTRICT,
  run_plan_hash TEXT NOT NULL CHECK (
    length(run_plan_hash) = 71 AND
    substr(run_plan_hash, 1, 7) = 'sha256:' AND
    substr(run_plan_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  code_version TEXT NOT NULL CHECK (
    length(code_version) BETWEEN 10 AND 68 AND
    code_version GLOB 'git:*' AND
    substr(code_version, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  canonical_schema_version TEXT NOT NULL CHECK (
    length(canonical_schema_version) BETWEEN 1 AND 64 AND
    canonical_schema_version NOT GLOB '*[^ -~]*'
  ),
  pipeline_contract_version TEXT NOT NULL CHECK (
    length(pipeline_contract_version) BETWEEN 1 AND 128 AND
    pipeline_contract_version NOT GLOB '*[^ -~]*'
  ),
  provider_count INTEGER NOT NULL CHECK (
    typeof(provider_count) = 'integer' AND provider_count BETWEEN 1 AND 16
  ),
  provider_scope_hash TEXT NOT NULL CHECK (
    length(provider_scope_hash) = 71 AND
    substr(provider_scope_hash, 1, 7) = 'sha256:' AND
    substr(provider_scope_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  policy_set_hash TEXT NOT NULL CHECK (
    length(policy_set_hash) = 71 AND
    substr(policy_set_hash, 1, 7) = 'sha256:' AND
    substr(policy_set_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  deadline_at_ms INTEGER NOT NULL CHECK (
    typeof(deadline_at_ms) = 'integer' AND
    deadline_at_ms BETWEEN 0 AND 253402300799999
  ),
  observed_at_ms INTEGER NOT NULL CHECK (
    typeof(observed_at_ms) = 'integer' AND
    observed_at_ms BETWEEN 0 AND 253402300799999
  ),
  started_at_ms INTEGER NOT NULL CHECK (
    typeof(started_at_ms) = 'integer' AND
    started_at_ms BETWEEN 0 AND 253402300799999
  ),
  request_ceiling INTEGER NOT NULL CHECK (
    typeof(request_ceiling) = 'integer' AND request_ceiling BETWEEN 0 AND 10000
  ),
  byte_ceiling INTEGER NOT NULL CHECK (
    typeof(byte_ceiling) = 'integer' AND byte_ceiling BETWEEN 0 AND 750000000
  ),
  ai_token_ceiling INTEGER NOT NULL CHECK (
    typeof(ai_token_ceiling) = 'integer' AND ai_token_ceiling BETWEEN 0 AND 1000000
  ),
  browser_millisecond_ceiling INTEGER NOT NULL CHECK (
    typeof(browser_millisecond_ceiling) = 'integer' AND
    browser_millisecond_ceiling BETWEEN 0 AND 7200000
  ),
  elapsed_millisecond_ceiling INTEGER NOT NULL CHECK (
    typeof(elapsed_millisecond_ceiling) = 'integer' AND
    elapsed_millisecond_ceiling BETWEEN 0 AND 172800000
  ),
  cost_microusd_ceiling INTEGER NOT NULL CHECK (
    typeof(cost_microusd_ceiling) = 'integer' AND
    cost_microusd_ceiling BETWEEN 0 AND 25000000
  ),
  projected_monthly_cost_microusd INTEGER NOT NULL CHECK (
    typeof(projected_monthly_cost_microusd) = 'integer' AND
    projected_monthly_cost_microusd BETWEEN 0 AND 25000000
  ),
  budget_alert_percent INTEGER CHECK (
    budget_alert_percent IS NULL OR budget_alert_percent IN (50, 75)
  ),
  created_at_ms INTEGER NOT NULL CHECK (
    typeof(created_at_ms) = 'integer' AND
    created_at_ms BETWEEN 0 AND observed_at_ms
  ),
  CHECK (
    (attempt_number = 1 AND replay_of_run_id IS NULL AND
      replay_authority IS NULL AND replay_authorization_hash IS NULL) OR
    (attempt_number > 1 AND replay_of_run_id IS NOT NULL AND
      replay_authority = 'protected_operator' AND
      replay_authorization_hash IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX publication_coordination_run_occurrence_attempt_uq
ON publication_coordination_run(occurrence_id, attempt_number);

CREATE TABLE publication_coordination_provider_run (
  provider_run_id TEXT PRIMARY KEY CHECK (
    length(provider_run_id) = 40 AND substr(provider_run_id, 1, 4) = 'pvr_' AND
    provider_run_id = lower(provider_run_id) AND
    substr(provider_run_id, 13, 1) = '-' AND substr(provider_run_id, 18, 1) = '-' AND
    substr(provider_run_id, 19, 1) = '4' AND substr(provider_run_id, 23, 1) = '-' AND
    substr(provider_run_id, 24, 1) IN ('8', '9', 'a', 'b') AND
    substr(provider_run_id, 28, 1) = '-' AND
    substr(provider_run_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_run_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_run_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_run_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_run_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  run_id TEXT NOT NULL
    REFERENCES publication_coordination_run(run_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT CHECK (
    length(provider_id) = 40 AND substr(provider_id, 1, 4) = 'prv_' AND
    provider_id = lower(provider_id) AND substr(provider_id, 13, 1) = '-' AND
    substr(provider_id, 18, 1) = '-' AND substr(provider_id, 19, 1) = '4' AND
    substr(provider_id, 23, 1) = '-' AND substr(provider_id, 24, 1) IN ('8', '9', 'a', 'b') AND
    substr(provider_id, 28, 1) = '-' AND
    substr(provider_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  ordinal INTEGER NOT NULL CHECK (
    typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 15
  ),
  adapter_version TEXT NOT NULL CHECK (
    length(adapter_version) BETWEEN 1 AND 128 AND
    adapter_version NOT GLOB '*[^ -~]*'
  ),
  roster_version TEXT NOT NULL CHECK (
    length(roster_version) BETWEEN 1 AND 128 AND
    roster_version NOT GLOB '*[^ -~]*'
  ),
  roster_content_hash TEXT NOT NULL CHECK (
    length(roster_content_hash) = 71 AND substr(roster_content_hash, 1, 7) = 'sha256:' AND
    substr(roster_content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  source_register_version TEXT NOT NULL CHECK (
    length(source_register_version) BETWEEN 1 AND 128 AND
    source_register_version NOT GLOB '*[^ -~]*'
  ),
  source_artifact_hash TEXT NOT NULL CHECK (
    length(source_artifact_hash) = 71 AND substr(source_artifact_hash, 1, 7) = 'sha256:' AND
    substr(source_artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  request_ceiling INTEGER NOT NULL CHECK (typeof(request_ceiling) = 'integer' AND request_ceiling >= 0),
  byte_ceiling INTEGER NOT NULL CHECK (typeof(byte_ceiling) = 'integer' AND byte_ceiling >= 0),
  ai_token_ceiling INTEGER NOT NULL CHECK (typeof(ai_token_ceiling) = 'integer' AND ai_token_ceiling >= 0),
  browser_millisecond_ceiling INTEGER NOT NULL CHECK (typeof(browser_millisecond_ceiling) = 'integer' AND browser_millisecond_ceiling >= 0),
  elapsed_millisecond_ceiling INTEGER NOT NULL CHECK (typeof(elapsed_millisecond_ceiling) = 'integer' AND elapsed_millisecond_ceiling >= 0),
  cost_microusd_ceiling INTEGER NOT NULL CHECK (typeof(cost_microusd_ceiling) = 'integer' AND cost_microusd_ceiling >= 0),
  retry_policy_hash TEXT NOT NULL CHECK (
    length(retry_policy_hash) = 71 AND substr(retry_policy_hash, 1, 7) = 'sha256:' AND
    substr(retry_policy_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  admitted_at_ms INTEGER NOT NULL CHECK (
    typeof(admitted_at_ms) = 'integer' AND
    admitted_at_ms BETWEEN 0 AND 253402300799999
  ),
  created_at_ms INTEGER NOT NULL CHECK (
    typeof(created_at_ms) = 'integer' AND created_at_ms BETWEEN 0 AND admitted_at_ms
  ),
  UNIQUE (run_id, provider_id)
) STRICT;

CREATE UNIQUE INDEX publication_coordination_provider_run_ordinal_uq
ON publication_coordination_provider_run(run_id, ordinal);

-- The latest generation for the single initialized environment is the exact
-- breaker authority. It is append-only and may move false -> true, never back.
CREATE TABLE publication_budget_breaker_event (
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  budget_month TEXT NOT NULL CHECK (
    length(budget_month) = 7 AND substr(budget_month, 5, 1) = '-' AND
    substr(budget_month, 1, 4) NOT GLOB '*[^0-9]*' AND
    substr(budget_month, 6, 2) BETWEEN '01' AND '12'
  ),
  generation INTEGER NOT NULL CHECK (
    typeof(generation) = 'integer' AND generation BETWEEN 1 AND 9007199254740991
  ),
  tripped INTEGER NOT NULL CHECK (tripped IN (0, 1)),
  observed_at_ms INTEGER NOT NULL CHECK (
    typeof(observed_at_ms) = 'integer' AND
    observed_at_ms BETWEEN 0 AND 253402300799999
  ),
  PRIMARY KEY (environment, budget_month, generation)
) STRICT;

CREATE INDEX publication_budget_breaker_latest_idx
ON publication_budget_breaker_event(environment, budget_month, generation DESC);

CREATE TABLE publication_run_budget_reservation (
  run_id TEXT PRIMARY KEY
    REFERENCES publication_coordination_run(run_id) ON DELETE RESTRICT,
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  budget_month TEXT NOT NULL,
  breaker_generation INTEGER NOT NULL CHECK (
    typeof(breaker_generation) = 'integer' AND breaker_generation >= 1
  ),
  monthly_used_snapshot_microusd INTEGER NOT NULL CHECK (
    typeof(monthly_used_snapshot_microusd) = 'integer' AND
    monthly_used_snapshot_microusd BETWEEN 0 AND 25000000
  ),
  monthly_reserved_snapshot_microusd INTEGER NOT NULL CHECK (
    typeof(monthly_reserved_snapshot_microusd) = 'integer' AND
    monthly_reserved_snapshot_microusd BETWEEN 0 AND 25000000
  ),
  reserved_cost_microusd INTEGER NOT NULL CHECK (
    typeof(reserved_cost_microusd) = 'integer' AND
    reserved_cost_microusd BETWEEN 0 AND 25000000
  ),
  reserved_at_ms INTEGER NOT NULL CHECK (
    typeof(reserved_at_ms) = 'integer' AND
    reserved_at_ms BETWEEN 0 AND 253402300799999
  )
) STRICT;

CREATE TABLE publication_provider_fence_claim (
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL CHECK (
    typeof(generation) = 'integer' AND generation BETWEEN 1 AND 9007199254740991
  ),
  provider_run_id TEXT NOT NULL UNIQUE
    REFERENCES publication_coordination_provider_run(provider_run_id)
    ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES publication_coordination_run(run_id)
    ON DELETE RESTRICT,
  occurrence_id TEXT NOT NULL
    REFERENCES publication_orchestration_occurrence(occurrence_id)
    ON DELETE RESTRICT,
  deadline_at_ms INTEGER NOT NULL CHECK (
    typeof(deadline_at_ms) = 'integer' AND
    deadline_at_ms BETWEEN 0 AND 253402300799999
  ),
  claimed_at_ms INTEGER NOT NULL CHECK (
    typeof(claimed_at_ms) = 'integer' AND
    claimed_at_ms BETWEEN 0 AND 253402300799999
  ),
  PRIMARY KEY (environment, provider_id, generation)
) STRICT;

CREATE TABLE publication_provider_fence_reconciliation (
  environment TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  provider_run_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (
    result IN ('terminal_confirmed', 'terminal_after_deadline_confirmed')
  ),
  reconciled_at_ms INTEGER NOT NULL CHECK (
    typeof(reconciled_at_ms) = 'integer' AND
    reconciled_at_ms BETWEEN 0 AND 253402300799999
  ),
  PRIMARY KEY (environment, provider_id, generation),
  FOREIGN KEY (environment, provider_id, generation)
    REFERENCES publication_provider_fence_claim(environment, provider_id, generation)
    ON DELETE RESTRICT,
  FOREIGN KEY (provider_run_id)
    REFERENCES publication_coordination_provider_run(provider_run_id)
    ON DELETE RESTRICT
) STRICT;

CREATE TABLE publication_provider_fence_release (
  environment TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  provider_run_id TEXT NOT NULL,
  released_at_ms INTEGER NOT NULL CHECK (
    typeof(released_at_ms) = 'integer' AND
    released_at_ms BETWEEN 0 AND 253402300799999
  ),
  PRIMARY KEY (environment, provider_id, generation),
  FOREIGN KEY (environment, provider_id, generation)
    REFERENCES publication_provider_fence_claim(environment, provider_id, generation)
    ON DELETE RESTRICT,
  FOREIGN KEY (provider_run_id)
    REFERENCES publication_coordination_provider_run(provider_run_id)
    ON DELETE RESTRICT
) STRICT;

-- This is the only mutable orchestration row. History remains in claim,
-- reconciliation, and release; guarded updates can only advance one generation.
CREATE TABLE publication_provider_fence_head (
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  generation INTEGER NOT NULL CHECK (
    typeof(generation) = 'integer' AND generation BETWEEN 1 AND 9007199254740991
  ),
  provider_run_id TEXT NOT NULL UNIQUE
    REFERENCES publication_coordination_provider_run(provider_run_id)
    ON DELETE RESTRICT,
  PRIMARY KEY (environment, provider_id),
  FOREIGN KEY (environment, provider_id, generation)
    REFERENCES publication_provider_fence_claim(environment, provider_id, generation)
    ON DELETE RESTRICT
) STRICT;

CREATE TABLE publication_roster_operational_outcome (
  provider_run_id TEXT NOT NULL
    REFERENCES publication_coordination_provider_run(provider_run_id)
    ON DELETE RESTRICT,
  roster_item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'published_candidate', 'published_candidate_with_unknowns',
    'unavailable', 'failed', 'quarantined'
  )),
  evidence_id TEXT REFERENCES evidence(evidence_id) ON DELETE RESTRICT,
  offering_id TEXT REFERENCES offering(offering_id) ON DELETE RESTRICT,
  error_code TEXT CHECK (error_code IS NULL OR error_code IN (
    'provider_unavailable', 'provider_failed', 'provider_quarantined',
    'terminal_deadline_elapsed'
  )),
  attempt_count INTEGER NOT NULL CHECK (
    typeof(attempt_count) = 'integer' AND attempt_count BETWEEN 0 AND 4
  ),
  created_at_ms INTEGER NOT NULL CHECK (
    typeof(created_at_ms) = 'integer' AND
    created_at_ms BETWEEN 0 AND 253402300799999
  ),
  PRIMARY KEY (provider_run_id, roster_item_id),
  CHECK (
    (status IN ('published_candidate', 'published_candidate_with_unknowns') AND
      evidence_id IS NOT NULL AND offering_id IS NOT NULL AND error_code IS NULL AND
      attempt_count BETWEEN 1 AND 4) OR
    (status IN ('unavailable', 'failed', 'quarantined') AND
      evidence_id IS NULL AND offering_id IS NULL AND error_code IS NOT NULL AND
      attempt_count = 0)
  ),
  CHECK (
    status <> 'unavailable' OR
    error_code IN ('provider_unavailable', 'terminal_deadline_elapsed')
  ),
  CHECK (
    status <> 'failed' OR
    error_code IN ('provider_failed', 'terminal_deadline_elapsed')
  ),
  CHECK (
    status <> 'quarantined' OR error_code = 'provider_quarantined'
  )
) STRICT;

CREATE TABLE publication_retained_publication_authority (
  run_id TEXT PRIMARY KEY
    REFERENCES publication_coordination_run(run_id) ON DELETE RESTRICT,
  authority_schema TEXT NOT NULL
    CHECK (authority_schema = 'retained-publication-head@1'),
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  publication_id TEXT NOT NULL CHECK (
    length(publication_id) = 40 AND substr(publication_id, 1, 4) = 'pub_' AND
    publication_id = lower(publication_id) AND
    substr(publication_id, 13, 1) = '-' AND substr(publication_id, 18, 1) = '-' AND
    substr(publication_id, 19, 1) = '4' AND substr(publication_id, 23, 1) = '-' AND
    substr(publication_id, 24, 1) IN ('8', '9', 'a', 'b') AND substr(publication_id, 28, 1) = '-' AND
    substr(publication_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(publication_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(publication_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(publication_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(publication_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  closure_hash TEXT NOT NULL CHECK (
    length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = 'sha256:' AND
    substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  observed_at_ms INTEGER NOT NULL CHECK (
    typeof(observed_at_ms) = 'integer' AND
    observed_at_ms BETWEEN 0 AND 253402300799999
  )
) STRICT;

CREATE TABLE publication_provider_terminal (
  provider_run_id TEXT PRIMARY KEY
    REFERENCES publication_coordination_provider_run(provider_run_id)
    ON DELETE RESTRICT,
  fence_generation INTEGER NOT NULL CHECK (
    typeof(fence_generation) = 'integer' AND fence_generation >= 1
  ),
  state TEXT NOT NULL CHECK (state IN ('ready', 'failed', 'quarantined')),
  roster_complete INTEGER NOT NULL CHECK (roster_complete = 1),
  publication_disposition TEXT NOT NULL CHECK (
    publication_disposition IN ('new', 'carried_forward', 'unavailable')
  ),
  slice_id TEXT CHECK (
    slice_id IS NULL OR (
      length(slice_id) = 40 AND substr(slice_id, 1, 4) = 'prn_' AND
      slice_id = lower(slice_id) AND
      substr(slice_id, 13, 1) = '-' AND substr(slice_id, 18, 1) = '-' AND
      substr(slice_id, 19, 1) = '4' AND substr(slice_id, 23, 1) = '-' AND
      substr(slice_id, 24, 1) IN ('8', '9', 'a', 'b') AND substr(slice_id, 28, 1) = '-' AND
      substr(slice_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
      substr(slice_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(slice_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(slice_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(slice_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  requests INTEGER NOT NULL CHECK (typeof(requests) = 'integer' AND requests >= 0),
  bytes INTEGER NOT NULL CHECK (typeof(bytes) = 'integer' AND bytes >= 0),
  ai_tokens INTEGER NOT NULL CHECK (typeof(ai_tokens) = 'integer' AND ai_tokens >= 0),
  browser_milliseconds INTEGER NOT NULL CHECK (typeof(browser_milliseconds) = 'integer' AND browser_milliseconds >= 0),
  elapsed_milliseconds INTEGER NOT NULL CHECK (typeof(elapsed_milliseconds) = 'integer' AND elapsed_milliseconds >= 0),
  cost_microusd INTEGER NOT NULL CHECK (typeof(cost_microusd) = 'integer' AND cost_microusd >= 0),
  error_codes_json TEXT NOT NULL CHECK (
    json_valid(error_codes_json) AND json_type(error_codes_json) = 'array' AND
    error_codes_json = json(error_codes_json) AND
    length(CAST(error_codes_json AS BLOB)) BETWEEN 2 AND 256 AND
    error_codes_json NOT GLOB '*[^ -~]*'
  ),
  ended_at_ms INTEGER NOT NULL CHECK (
    typeof(ended_at_ms) = 'integer' AND
    ended_at_ms BETWEEN 0 AND 253402300799999
  ),
  CHECK (
    (publication_disposition = 'unavailable' AND slice_id IS NULL) OR
    (publication_disposition IN ('new', 'carried_forward') AND slice_id IS NOT NULL)
  ),
  CHECK ((state = 'ready') = (publication_disposition = 'new'))
) STRICT;

CREATE TABLE publication_run_terminal (
  run_id TEXT PRIMARY KEY
    REFERENCES publication_coordination_run(run_id) ON DELETE RESTRICT,
  run_outcome TEXT NOT NULL CHECK (run_outcome IN (
    'succeeded', 'completed_with_provider_failures', 'failed', 'quarantined'
  )),
  publication_disposition TEXT NOT NULL CHECK (
    publication_disposition IN ('publish_new', 'retain_current', 'blocked')
  ),
  run_wide_quarantine INTEGER NOT NULL CHECK (run_wide_quarantine IN (0, 1)),
  requests INTEGER NOT NULL CHECK (typeof(requests) = 'integer' AND requests >= 0),
  bytes INTEGER NOT NULL CHECK (typeof(bytes) = 'integer' AND bytes >= 0),
  ai_tokens INTEGER NOT NULL CHECK (typeof(ai_tokens) = 'integer' AND ai_tokens >= 0),
  browser_milliseconds INTEGER NOT NULL CHECK (typeof(browser_milliseconds) = 'integer' AND browser_milliseconds >= 0),
  elapsed_milliseconds INTEGER NOT NULL CHECK (typeof(elapsed_milliseconds) = 'integer' AND elapsed_milliseconds >= 0),
  cost_microusd INTEGER NOT NULL CHECK (typeof(cost_microusd) = 'integer' AND cost_microusd >= 0),
  error_codes_json TEXT NOT NULL CHECK (
    json_valid(error_codes_json) AND json_type(error_codes_json) = 'array' AND
    error_codes_json = json(error_codes_json) AND
    length(CAST(error_codes_json AS BLOB)) BETWEEN 2 AND 512 AND
    error_codes_json NOT GLOB '*[^ -~]*'
  ),
  ended_at_ms INTEGER NOT NULL CHECK (
    typeof(ended_at_ms) = 'integer' AND
    ended_at_ms BETWEEN 0 AND 253402300799999
  ),
  report_schema_version TEXT NOT NULL
    CHECK (report_schema_version = 'publication-run-report@2'),
  report_text TEXT NOT NULL CHECK (
    json_valid(report_text) AND json_type(report_text) = 'object' AND
    report_text = json(report_text) AND
    length(CAST(report_text AS BLOB)) BETWEEN 2 AND 16384 AND
    report_text NOT GLOB '*[^ -~]*'
  ),
  report_hash TEXT NOT NULL UNIQUE CHECK (
    length(report_hash) = 71 AND substr(report_hash, 1, 7) = 'sha256:' AND
    substr(report_hash, 8) NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

-- Capability and physical-environment authority are immutable.
CREATE TRIGGER publication_orchestration_integrity_metadata_insert_guard
BEFORE INSERT ON publication_orchestration_integrity_metadata
WHEN EXISTS (SELECT 1 FROM publication_orchestration_integrity_metadata)
BEGIN SELECT RAISE(ABORT, 'publication orchestration capability cannot be replaced'); END;
CREATE TRIGGER publication_orchestration_integrity_metadata_immutable_update
BEFORE UPDATE ON publication_orchestration_integrity_metadata
BEGIN SELECT RAISE(ABORT, 'publication orchestration capability is immutable'); END;
CREATE TRIGGER publication_orchestration_integrity_metadata_immutable_delete
BEFORE DELETE ON publication_orchestration_integrity_metadata
BEGIN SELECT RAISE(ABORT, 'publication orchestration capability cannot be deleted'); END;

CREATE TRIGGER publication_orchestration_environment_insert_guard
BEFORE INSERT ON publication_orchestration_environment
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_orchestration_environment
  ) THEN RAISE(ABORT, 'publication orchestration environment is already initialized') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM pipeline_run WHERE status IN ('pending', 'running')
  ) OR EXISTS (
    SELECT 1 FROM provider_run WHERE status IN ('pending', 'running')
  ) OR EXISTS (
    SELECT 1 FROM acquisition_run WHERE status IN ('pending', 'running')
  ) THEN RAISE(ABORT, 'legacy run graph must be quiescent before orchestration initialization') END;
END;
CREATE TRIGGER publication_orchestration_environment_immutable_update
BEFORE UPDATE ON publication_orchestration_environment
BEGIN SELECT RAISE(ABORT, 'publication orchestration environment is immutable'); END;
CREATE TRIGGER publication_orchestration_environment_immutable_delete
BEFORE DELETE ON publication_orchestration_environment
BEGIN SELECT RAISE(ABORT, 'publication orchestration environment cannot be deleted'); END;

-- Initializing the parallel ledger closes every legacy run-graph write path.
CREATE TRIGGER legacy_pipeline_run_disabled BEFORE INSERT ON pipeline_run
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy pipeline run graph is disabled'); END;
CREATE TRIGGER legacy_pipeline_run_update_disabled BEFORE UPDATE ON pipeline_run
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy pipeline run graph is disabled'); END;
CREATE TRIGGER legacy_provider_run_disabled BEFORE INSERT ON provider_run
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy provider run graph is disabled'); END;
CREATE TRIGGER legacy_provider_run_update_disabled BEFORE UPDATE ON provider_run
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy provider run graph is disabled'); END;
CREATE TRIGGER legacy_acquisition_run_disabled BEFORE INSERT ON acquisition_run
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy acquisition graph is disabled'); END;
CREATE TRIGGER legacy_acquisition_run_update_disabled BEFORE UPDATE ON acquisition_run
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy acquisition graph is disabled'); END;
CREATE TRIGGER legacy_roster_outcome_disabled BEFORE INSERT ON roster_outcome
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy roster outcomes are disabled'); END;
CREATE TRIGGER legacy_observation_disabled BEFORE INSERT ON observation
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy observations require provenance-v2 authority'); END;
CREATE TRIGGER legacy_evidence_disabled BEFORE INSERT ON evidence
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy evidence requires provenance-v2 authority'); END;
CREATE TRIGGER legacy_field_claim_disabled BEFORE INSERT ON field_claim
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy field claims require provenance-v2 authority'); END;
CREATE TRIGGER legacy_claim_conflict_disabled BEFORE INSERT ON claim_conflict
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy claim conflicts require provenance-v2 authority'); END;
CREATE TRIGGER legacy_parameter_fact_disabled BEFORE INSERT ON parameter_fact
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy parameter facts require provenance-v2 authority'); END;
CREATE TRIGGER legacy_parameter_fact_update_disabled BEFORE UPDATE ON parameter_fact
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy parameter facts require provenance-v2 authority'); END;
CREATE TRIGGER legacy_parameter_fact_delete_disabled BEFORE DELETE ON parameter_fact
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy parameter facts require provenance-v2 authority'); END;
CREATE TRIGGER legacy_precision_observation_disabled BEFORE INSERT ON precision_observation
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy precision observations require provenance-v2 authority'); END;
CREATE TRIGGER legacy_precision_component_disabled BEFORE INSERT ON precision_component
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy precision components require provenance-v2 authority'); END;
CREATE TRIGGER legacy_price_schedule_disabled BEFORE INSERT ON price_schedule
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy price schedules require provenance-v2 authority'); END;
CREATE TRIGGER legacy_anomaly_disabled BEFORE INSERT ON anomaly
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy anomalies require provenance-v2 authority'); END;
CREATE TRIGGER legacy_anomaly_update_disabled BEFORE UPDATE ON anomaly
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy anomalies require provenance-v2 authority'); END;
CREATE TRIGGER legacy_anomaly_delete_disabled BEFORE DELETE ON anomaly
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy anomalies require provenance-v2 authority'); END;
CREATE TRIGGER legacy_quarantine_disabled BEFORE INSERT ON quarantine
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy quarantines require provenance-v2 authority'); END;
CREATE TRIGGER legacy_quarantine_update_disabled BEFORE UPDATE ON quarantine
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy quarantines require provenance-v2 authority'); END;
CREATE TRIGGER legacy_quarantine_delete_disabled BEFORE DELETE ON quarantine
WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
BEGIN SELECT RAISE(ABORT, 'legacy quarantines require provenance-v2 authority'); END;

CREATE TRIGGER schedule_occurrence_orchestration_immutable_update
BEFORE UPDATE ON schedule_occurrence
WHEN EXISTS (
  SELECT 1 FROM publication_orchestration_occurrence
  WHERE occurrence_id = OLD.occurrence_id
)
BEGIN SELECT RAISE(ABORT, 'publication schedule occurrence is immutable'); END;
CREATE TRIGGER schedule_occurrence_orchestration_immutable_delete
BEFORE DELETE ON schedule_occurrence
WHEN EXISTS (
  SELECT 1 FROM publication_orchestration_occurrence
  WHERE occurrence_id = OLD.occurrence_id
)
BEGIN SELECT RAISE(ABORT, 'publication schedule occurrence cannot be deleted'); END;

CREATE TRIGGER publication_orchestration_occurrence_insert_guard
BEFORE INSERT ON publication_orchestration_occurrence
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_orchestration_occurrence
    WHERE occurrence_id = NEW.occurrence_id
  ) THEN RAISE(ABORT, 'publication orchestration occurrence cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_orchestration_environment
    WHERE singleton = 1 AND environment = NEW.environment
      AND initialized_at_ms <= NEW.created_at_ms
  ) THEN RAISE(ABORT, 'publication orchestration environment mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM schedule_occurrence
    WHERE occurrence_id = NEW.occurrence_id
      AND schedule_name = 'provider-refresh-v1'
      AND schedule_expression = '0 5 * * 1,4'
      AND scheduled_at_ms <= NEW.observed_at_ms
      AND created_at_ms <= NEW.created_at_ms
      AND strftime('%w %H:%M:%S', scheduled_at_ms / 1000, 'unixepoch')
          IN ('1 05:00:00', '4 05:00:00')
      AND scheduled_at_ms % 1000 = 0
  ) THEN RAISE(ABORT, 'publication orchestration occurrence is not an exact scheduled firing') END;
END;
CREATE TRIGGER publication_orchestration_occurrence_immutable_update
BEFORE UPDATE ON publication_orchestration_occurrence
BEGIN SELECT RAISE(ABORT, 'publication orchestration occurrence is immutable'); END;
CREATE TRIGGER publication_orchestration_occurrence_immutable_delete
BEFORE DELETE ON publication_orchestration_occurrence
BEGIN SELECT RAISE(ABORT, 'publication orchestration occurrence cannot be deleted'); END;

CREATE TRIGGER publication_admission_rejection_insert_guard
BEFORE INSERT ON publication_admission_rejection
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_admission_rejection
    WHERE occurrence_id = NEW.occurrence_id
  ) OR EXISTS (
    SELECT 1 FROM publication_coordination_run
    WHERE occurrence_id = NEW.occurrence_id
  ) THEN RAISE(ABORT, 'rejection and admitted run are mutually exclusive') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_orchestration_occurrence AS occurrence
    JOIN schedule_occurrence AS scheduled USING (occurrence_id)
    WHERE occurrence.occurrence_id = NEW.occurrence_id
      AND NEW.created_at_ms >= occurrence.observed_at_ms
      AND json_extract(NEW.report_text, '$.reportSchemaVersion') = NEW.report_schema_version
      AND json_extract(NEW.report_text, '$.kind') = 'rejected_firing'
      AND json_extract(NEW.report_text, '$.scheduleName') = scheduled.schedule_name
      AND json_extract(NEW.report_text, '$.scheduleExpression') = scheduled.schedule_expression
      AND json_extract(NEW.report_text, '$.occurrenceId') = NEW.occurrence_id
      AND json_extract(NEW.report_text, '$.scheduledAt') =
          strftime('%Y-%m-%dT%H:%M:%fZ', scheduled.scheduled_at_ms / 1000.0, 'unixepoch')
      AND json_extract(NEW.report_text, '$.observedAt') =
          strftime('%Y-%m-%dT%H:%M:%fZ', occurrence.observed_at_ms / 1000.0, 'unixepoch')
      AND json_extract(NEW.report_text, '$.rejectionCode') = NEW.rejection_code
      AND json_extract(NEW.report_text, '$.requestedPlan.runPlanId') = occurrence.requested_run_plan_id
      AND json_extract(NEW.report_text, '$.requestedPlan.runPlanHash') = occurrence.requested_run_plan_hash
      AND json_extract(NEW.report_text, '$.requestedPlan.environment') = occurrence.environment
      AND json_extract(NEW.report_text, '$.seal.algorithm') = 'sha256'
      AND json_extract(NEW.report_text, '$.seal.contentHash') = NEW.report_hash
  ) THEN RAISE(ABORT, 'rejection report does not close exact occurrence authority') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.report_text)
    WHERE key NOT IN (
      'reportSchemaVersion', 'kind', 'scheduleName', 'scheduleExpression',
      'occurrenceId', 'scheduledAt', 'observedAt', 'rejectionCode',
      'requestedPlan', 'seal'
    )
  ) OR (SELECT count(*) FROM json_each(NEW.report_text)) <> 10
    OR (SELECT count(*) FROM json_each(NEW.report_text, '$.requestedPlan')) <> 3
    OR (SELECT count(*) FROM json_each(NEW.report_text, '$.seal')) <> 2
  THEN RAISE(ABORT, 'rejection report fields are not closed') END;
  -- These reasons are directly contradicted by a fully effective, approved,
  -- exact plan whose Provider roster and source authority are valid at the
  -- scheduled instant. Other rejection reasons depend on runtime or budget
  -- state that this canonical database cannot independently reconstruct.
  SELECT CASE WHEN NEW.rejection_code IN (
    'plan_unavailable', 'plan_not_effective', 'plan_revoked',
    'source_authority_invalid'
  ) AND EXISTS (
    SELECT 1
    FROM publication_orchestration_occurrence AS occurrence
    JOIN schedule_occurrence AS scheduled USING (occurrence_id)
    JOIN publication_run_plan AS plan
      ON plan.run_plan_id = occurrence.requested_run_plan_id
     AND plan.plan_hash = occurrence.requested_run_plan_hash
    JOIN publication_run_plan_seal AS seal USING (run_plan_id)
    JOIN publication_run_plan_approval AS approval USING (run_plan_id)
    WHERE occurrence.occurrence_id = NEW.occurrence_id
      AND plan.environment = occurrence.environment
      AND plan.schedule_name = scheduled.schedule_name
      AND plan.schedule_expression = scheduled.schedule_expression
      AND scheduled.scheduled_at_ms >= plan.effective_from_ms
      AND scheduled.scheduled_at_ms < plan.effective_to_ms
      AND seal.provider_count = plan.provider_count
      AND seal.provider_scope_hash = plan.provider_scope_hash
      AND seal.policy_set_hash = plan.policy_set_hash
      AND seal.plan_hash = plan.plan_hash
      AND NOT EXISTS (
        SELECT 1 FROM publication_run_plan_revocation AS revoked
        WHERE revoked.run_plan_id = plan.run_plan_id
          AND revoked.effective_at_ms <= scheduled.scheduled_at_ms
      )
      AND NOT EXISTS (
        SELECT 1
        FROM publication_run_plan_provider AS planned
        LEFT JOIN provider_roster AS roster
          ON roster.provider_id = planned.provider_id
         AND roster.roster_version = planned.roster_version
         AND roster.content_hash = planned.roster_content_hash
        LEFT JOIN source_compliance_record AS source
          ON source.provider_id = planned.provider_id
         AND source.register_version = planned.source_register_version
         AND source.artifact_hash = planned.source_artifact_hash
        WHERE planned.run_plan_id = plan.run_plan_id
          AND (
            roster.provider_id IS NULL OR source.provider_id IS NULL OR
            source.approval_state <> 'approved' OR
            source.access_permitted <> 1 OR
            source.retention_permitted <> 1 OR
            source.excerpt_permitted <> 1 OR
            source.publication_permitted <> 1 OR
            source.reviewed_at_ms > scheduled.scheduled_at_ms OR
            source.next_review_at_ms <= scheduled.scheduled_at_ms OR
            NOT EXISTS (
              SELECT 1 FROM provider_roster_item AS item
              WHERE item.provider_id = planned.provider_id
                AND item.roster_version = planned.roster_version
            )
          )
      )
  ) THEN RAISE(ABORT, 'admission rejection reason contradicts exact eligible plan authority') END;
END;
-- D1 cannot atomically reconstruct every rejection reason from canonical
-- authority. Preserve the report contract above, but do not let caller-supplied
-- plan or budget state become durable rejection truth until the atomic
-- admission resolver exists.
CREATE TRIGGER publication_admission_rejection_activation_blocked
BEFORE INSERT ON publication_admission_rejection
BEGIN
  SELECT RAISE(ABORT, 'publication admission rejection requires the atomic D1 admission resolver');
END;
CREATE TRIGGER publication_admission_rejection_immutable_update
BEFORE UPDATE ON publication_admission_rejection
BEGIN SELECT RAISE(ABORT, 'publication admission rejection is immutable'); END;
CREATE TRIGGER publication_admission_rejection_immutable_delete
BEFORE DELETE ON publication_admission_rejection
BEGIN SELECT RAISE(ABORT, 'publication admission rejection cannot be deleted'); END;

CREATE TRIGGER publication_coordination_run_insert_guard
BEFORE INSERT ON publication_coordination_run
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_coordination_run
    WHERE run_id = NEW.run_id OR
      (occurrence_id = NEW.occurrence_id AND attempt_number = NEW.attempt_number)
  ) THEN RAISE(ABORT, 'publication coordination run cannot be replaced') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_admission_rejection
    WHERE occurrence_id = NEW.occurrence_id
  ) THEN RAISE(ABORT, 'rejection and admitted run are mutually exclusive') END;
  -- Phase D has no protected-operator resolver or independently fresh replay
  -- admission timestamp. Caller-supplied replay fields therefore cannot grant
  -- replay authority; a later migration must replace this fail-closed guard.
  SELECT CASE WHEN NEW.attempt_number > 1
    OR NEW.replay_of_run_id IS NOT NULL
    OR NEW.replay_authority IS NOT NULL
    OR NEW.replay_authorization_hash IS NOT NULL
  THEN RAISE(ABORT, 'protected publication replay resolver is unavailable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_orchestration_occurrence AS occurrence
    JOIN schedule_occurrence AS scheduled USING (occurrence_id)
    JOIN publication_orchestration_environment AS environment
      ON environment.singleton = 1 AND environment.environment = NEW.environment
    JOIN publication_run_plan AS plan ON plan.run_plan_id = NEW.run_plan_id
    JOIN publication_run_plan_seal AS seal USING (run_plan_id)
    JOIN publication_run_plan_approval AS approval USING (run_plan_id)
    WHERE occurrence.occurrence_id = NEW.occurrence_id
      AND occurrence.environment = NEW.environment
      AND environment.initialized_at_ms <= occurrence.created_at_ms
      AND occurrence.requested_run_plan_id = NEW.run_plan_id
      AND occurrence.requested_run_plan_hash = NEW.run_plan_hash
      AND plan.plan_hash = NEW.run_plan_hash
      AND plan.environment = NEW.environment
      AND plan.schedule_name = scheduled.schedule_name
      AND plan.schedule_expression = scheduled.schedule_expression
      AND scheduled.scheduled_at_ms >= plan.effective_from_ms
      AND scheduled.scheduled_at_ms < plan.effective_to_ms
      AND NOT EXISTS (
        SELECT 1 FROM publication_run_plan_revocation AS revoked
        WHERE revoked.run_plan_id = NEW.run_plan_id
          AND revoked.effective_at_ms <= scheduled.scheduled_at_ms
      )
      AND plan.canonical_schema_version = NEW.canonical_schema_version
      AND plan.pipeline_contract_version = NEW.pipeline_contract_version
      AND seal.provider_count = NEW.provider_count
      AND seal.provider_scope_hash = NEW.provider_scope_hash
      AND seal.policy_set_hash = NEW.policy_set_hash
      AND NEW.deadline_at_ms = scheduled.scheduled_at_ms + 43200000
      AND NEW.observed_at_ms = occurrence.observed_at_ms
      AND NEW.started_at_ms >= NEW.observed_at_ms
      AND NEW.started_at_ms < NEW.deadline_at_ms
      AND NEW.request_ceiling = (SELECT sum(request_ceiling) FROM publication_run_plan_provider WHERE run_plan_id = NEW.run_plan_id)
      AND NEW.byte_ceiling = (SELECT sum(byte_ceiling) FROM publication_run_plan_provider WHERE run_plan_id = NEW.run_plan_id)
      AND NEW.ai_token_ceiling = (SELECT sum(ai_token_ceiling) FROM publication_run_plan_provider WHERE run_plan_id = NEW.run_plan_id)
      AND NEW.browser_millisecond_ceiling = (SELECT sum(browser_millisecond_ceiling) FROM publication_run_plan_provider WHERE run_plan_id = NEW.run_plan_id)
      AND NEW.elapsed_millisecond_ceiling = (SELECT sum(elapsed_millisecond_ceiling) FROM publication_run_plan_provider WHERE run_plan_id = NEW.run_plan_id)
      AND NEW.cost_microusd_ceiling = (SELECT sum(cost_microusd_ceiling) FROM publication_run_plan_provider WHERE run_plan_id = NEW.run_plan_id)
      AND NOT EXISTS (
        SELECT 1 FROM publication_run_plan_provider AS planned
        WHERE planned.run_plan_id = NEW.run_plan_id
          AND (
            NOT EXISTS (
              SELECT 1 FROM provider_roster AS roster
              WHERE roster.provider_id = planned.provider_id
                AND roster.roster_version = planned.roster_version
                AND roster.content_hash = planned.roster_content_hash
            ) OR NOT EXISTS (
              SELECT 1 FROM source_compliance_record AS source
              WHERE source.provider_id = planned.provider_id
                AND source.register_version = planned.source_register_version
                AND source.artifact_hash = planned.source_artifact_hash
                AND source.approval_state = 'approved'
                AND source.access_permitted = 1
                AND source.retention_permitted = 1
                AND source.excerpt_permitted = 1
                AND source.publication_permitted = 1
                AND source.reviewed_at_ms <= scheduled.scheduled_at_ms
                AND source.next_review_at_ms > scheduled.scheduled_at_ms
            ) OR NOT EXISTS (
              SELECT 1 FROM provider_roster_item AS item
              WHERE item.provider_id = planned.provider_id
                AND item.roster_version = planned.roster_version
            )
          )
      )
  ) THEN RAISE(ABORT, 'publication coordination run lacks exact admitted plan authority') END;
  SELECT CASE WHEN NEW.attempt_number = 1 AND EXISTS (
    SELECT 1 FROM publication_coordination_run
    WHERE occurrence_id = NEW.occurrence_id
  ) THEN RAISE(ABORT, 'attempt 1 is already admitted') END;
END;
CREATE TRIGGER publication_coordination_run_immutable_update
BEFORE UPDATE ON publication_coordination_run
BEGIN SELECT RAISE(ABORT, 'publication coordination run is immutable'); END;
CREATE TRIGGER publication_coordination_run_immutable_delete
BEFORE DELETE ON publication_coordination_run
BEGIN SELECT RAISE(ABORT, 'publication coordination run cannot be deleted'); END;

CREATE TRIGGER publication_coordination_provider_run_insert_guard
BEFORE INSERT ON publication_coordination_provider_run
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_coordination_provider_run
    WHERE provider_run_id = NEW.provider_run_id OR
      (run_id = NEW.run_id AND (provider_id = NEW.provider_id OR ordinal = NEW.ordinal))
  ) THEN RAISE(ABORT, 'publication Provider run cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_coordination_run AS run
    JOIN publication_run_plan_provider AS planned
      ON planned.run_plan_id = run.run_plan_id
    WHERE run.run_id = NEW.run_id
      AND planned.provider_id = NEW.provider_id
      AND planned.ordinal = NEW.ordinal
      AND planned.adapter_version = NEW.adapter_version
      AND planned.roster_version = NEW.roster_version
      AND planned.roster_content_hash = NEW.roster_content_hash
      AND planned.source_register_version = NEW.source_register_version
      AND planned.source_artifact_hash = NEW.source_artifact_hash
      AND planned.request_ceiling = NEW.request_ceiling
      AND planned.byte_ceiling = NEW.byte_ceiling
      AND planned.ai_token_ceiling = NEW.ai_token_ceiling
      AND planned.browser_millisecond_ceiling = NEW.browser_millisecond_ceiling
      AND planned.elapsed_millisecond_ceiling = NEW.elapsed_millisecond_ceiling
      AND planned.cost_microusd_ceiling = NEW.cost_microusd_ceiling
      AND planned.retry_policy_hash = NEW.retry_policy_hash
      AND NEW.admitted_at_ms >= run.observed_at_ms
      AND NEW.admitted_at_ms <= run.started_at_ms
  ) THEN RAISE(ABORT, 'publication Provider run does not match the exact plan row') END;
END;
CREATE TRIGGER publication_coordination_provider_run_immutable_update
BEFORE UPDATE ON publication_coordination_provider_run
BEGIN SELECT RAISE(ABORT, 'publication Provider run is immutable'); END;
CREATE TRIGGER publication_coordination_provider_run_immutable_delete
BEFORE DELETE ON publication_coordination_provider_run
BEGIN SELECT RAISE(ABORT, 'publication Provider run cannot be deleted'); END;

CREATE TRIGGER publication_budget_breaker_event_insert_guard
BEFORE INSERT ON publication_budget_breaker_event
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_orchestration_environment
    WHERE singleton = 1 AND environment = NEW.environment
  ) THEN RAISE(ABORT, 'budget breaker environment mismatch') END;
  SELECT CASE WHEN (
    (NEW.generation = 1 AND EXISTS (
      SELECT 1 FROM publication_budget_breaker_event
      WHERE environment = NEW.environment AND budget_month = NEW.budget_month
    )) OR
    (NEW.generation > 1 AND NOT EXISTS (
      SELECT 1 FROM publication_budget_breaker_event
      WHERE environment = NEW.environment AND budget_month = NEW.budget_month
        AND generation = NEW.generation - 1
    )) OR EXISTS (
      SELECT 1 FROM publication_budget_breaker_event
      WHERE environment = NEW.environment AND budget_month = NEW.budget_month
        AND generation >= NEW.generation
    )
  ) THEN RAISE(ABORT, 'budget breaker generation is not adjacent') END;
  SELECT CASE WHEN NEW.generation > 1 AND EXISTS (
    SELECT 1 FROM publication_budget_breaker_event
    WHERE environment = NEW.environment AND budget_month = NEW.budget_month
      AND generation = NEW.generation - 1 AND tripped = 1
      AND NEW.tripped <> 1
  ) THEN RAISE(ABORT, 'a tripped budget breaker cannot be reset') END;
  SELECT CASE WHEN NEW.generation > 1 AND NOT EXISTS (
    SELECT 1 FROM publication_budget_breaker_event
    WHERE environment = NEW.environment AND budget_month = NEW.budget_month
      AND generation = NEW.generation - 1
      AND NEW.observed_at_ms >= observed_at_ms
  ) THEN RAISE(ABORT, 'budget breaker observation time is not monotone') END;
END;
CREATE TRIGGER publication_budget_breaker_event_immutable_update
BEFORE UPDATE ON publication_budget_breaker_event
BEGIN SELECT RAISE(ABORT, 'budget breaker history is immutable'); END;
CREATE TRIGGER publication_budget_breaker_event_immutable_delete
BEFORE DELETE ON publication_budget_breaker_event
BEGIN SELECT RAISE(ABORT, 'budget breaker history cannot be deleted'); END;

CREATE TRIGGER publication_run_budget_reservation_insert_guard
BEFORE INSERT ON publication_run_budget_reservation
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_run_budget_reservation WHERE run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'publication budget reservation cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_coordination_run AS run
    JOIN publication_orchestration_occurrence AS occurrence USING (occurrence_id)
    JOIN schedule_occurrence AS scheduled USING (occurrence_id)
    JOIN publication_orchestration_environment AS environment
      ON environment.singleton = 1 AND environment.environment = NEW.environment
    WHERE run.run_id = NEW.run_id
      AND run.environment = NEW.environment
      AND NEW.budget_month = strftime('%Y-%m', scheduled.scheduled_at_ms / 1000, 'unixepoch')
      AND NEW.reserved_cost_microusd = run.cost_microusd_ceiling
      AND NEW.reserved_at_ms >= run.observed_at_ms
      AND NEW.reserved_at_ms <= run.started_at_ms
      AND NEW.monthly_used_snapshot_microusd = COALESCE((
        SELECT sum(terminal.cost_microusd)
        FROM publication_run_terminal AS terminal
        JOIN publication_coordination_run AS settled_run
          ON settled_run.run_id = terminal.run_id
        JOIN publication_orchestration_occurrence AS settled_occurrence
          ON settled_occurrence.occurrence_id = settled_run.occurrence_id
        JOIN schedule_occurrence AS settled_schedule
          ON settled_schedule.occurrence_id = settled_occurrence.occurrence_id
        WHERE settled_run.environment = NEW.environment
          AND strftime('%Y-%m', settled_schedule.scheduled_at_ms / 1000, 'unixepoch') = NEW.budget_month
      ), 0)
      AND NEW.monthly_reserved_snapshot_microusd = COALESCE((
        SELECT sum(reservation.reserved_cost_microusd)
        FROM publication_run_budget_reservation AS reservation
        WHERE reservation.environment = NEW.environment
          AND reservation.budget_month = NEW.budget_month
          AND NOT EXISTS (
            SELECT 1 FROM publication_run_terminal AS terminal
            WHERE terminal.run_id = reservation.run_id
          )
      ), 0)
      AND run.projected_monthly_cost_microusd =
        NEW.monthly_used_snapshot_microusd +
        NEW.monthly_reserved_snapshot_microusd + NEW.reserved_cost_microusd
      AND environment.monthly_allocation_microusd > 0
      AND run.projected_monthly_cost_microusd <= environment.monthly_allocation_microusd
      AND run.budget_alert_percent IS CASE
        WHEN run.projected_monthly_cost_microusd >= 18750000 THEN 75
        WHEN run.projected_monthly_cost_microusd >= 12500000 THEN 50
        ELSE NULL
      END
  ) THEN RAISE(ABORT, 'publication budget reservation does not match run authority') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_budget_breaker_event AS breaker
    WHERE breaker.environment = NEW.environment
      AND breaker.budget_month = NEW.budget_month
      AND breaker.generation = NEW.breaker_generation
      AND breaker.tripped = 0
      AND breaker.observed_at_ms <= NEW.reserved_at_ms
      AND NOT EXISTS (
        SELECT 1 FROM publication_budget_breaker_event AS later
        WHERE later.environment = breaker.environment
          AND later.budget_month = breaker.budget_month
          AND later.generation > breaker.generation
      )
  ) THEN RAISE(ABORT, 'publication budget reservation lacks current safe breaker authority') END;
END;
CREATE TRIGGER publication_run_budget_reservation_immutable_update
BEFORE UPDATE ON publication_run_budget_reservation
BEGIN SELECT RAISE(ABORT, 'publication budget reservation is immutable'); END;
CREATE TRIGGER publication_run_budget_reservation_immutable_delete
BEFORE DELETE ON publication_run_budget_reservation
BEGIN SELECT RAISE(ABORT, 'publication budget reservation cannot be deleted'); END;

CREATE TRIGGER publication_provider_fence_claim_insert_guard
BEFORE INSERT ON publication_provider_fence_claim
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_provider_fence_claim
    WHERE provider_run_id = NEW.provider_run_id OR
      (environment = NEW.environment AND provider_id = NEW.provider_id
        AND generation = NEW.generation)
  ) THEN RAISE(ABORT, 'Provider fence claim cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_coordination_provider_run AS provider_run
    JOIN publication_coordination_run AS run ON run.run_id = provider_run.run_id
    JOIN publication_orchestration_environment AS environment
      ON environment.singleton = 1 AND environment.environment = NEW.environment
    WHERE provider_run.provider_run_id = NEW.provider_run_id
      AND provider_run.run_id = NEW.run_id
      AND provider_run.provider_id = NEW.provider_id
      AND run.occurrence_id = NEW.occurrence_id
      AND run.environment = NEW.environment
      AND run.deadline_at_ms = NEW.deadline_at_ms
      AND NEW.claimed_at_ms >= run.started_at_ms
      AND NEW.claimed_at_ms < NEW.deadline_at_ms
      AND EXISTS (
        SELECT 1 FROM publication_run_budget_reservation AS reservation
        WHERE reservation.run_id = run.run_id
      )
  ) THEN RAISE(ABORT, 'Provider fence claim does not match admitted Provider authority') END;
  SELECT CASE WHEN NEW.generation = 1 AND EXISTS (
    SELECT 1 FROM publication_provider_fence_head
    WHERE environment = NEW.environment AND provider_id = NEW.provider_id
  ) THEN RAISE(ABORT, 'initial Provider fence claim already has a head') END;
  SELECT CASE WHEN NEW.generation > 1 AND NOT EXISTS (
    SELECT 1
    FROM publication_provider_fence_head AS head
    JOIN publication_provider_fence_reconciliation AS reconciliation
      ON reconciliation.environment = head.environment
     AND reconciliation.provider_id = head.provider_id
     AND reconciliation.generation = head.generation
     AND reconciliation.provider_run_id = head.provider_run_id
    JOIN publication_provider_fence_release AS release
      ON release.environment = head.environment
     AND release.provider_id = head.provider_id
     AND release.generation = head.generation
     AND release.provider_run_id = head.provider_run_id
    WHERE head.environment = NEW.environment
      AND head.provider_id = NEW.provider_id
      AND head.generation = NEW.generation - 1
      AND NEW.claimed_at_ms >= reconciliation.reconciled_at_ms
      AND NEW.claimed_at_ms >= release.released_at_ms
  ) THEN RAISE(ABORT, 'Provider fence takeover lacks exact reconciliation and release') END;
END;
CREATE TRIGGER publication_provider_fence_claim_immutable_update
BEFORE UPDATE ON publication_provider_fence_claim
BEGIN SELECT RAISE(ABORT, 'Provider fence claim is immutable'); END;
CREATE TRIGGER publication_provider_fence_claim_immutable_delete
BEFORE DELETE ON publication_provider_fence_claim
BEGIN SELECT RAISE(ABORT, 'Provider fence claim cannot be deleted'); END;

CREATE TRIGGER publication_provider_fence_reconciliation_insert_guard
BEFORE INSERT ON publication_provider_fence_reconciliation
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_provider_fence_reconciliation
    WHERE environment = NEW.environment AND provider_id = NEW.provider_id
      AND generation = NEW.generation
  ) THEN RAISE(ABORT, 'Provider fence reconciliation cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_provider_fence_claim AS claim
    JOIN publication_provider_terminal AS terminal
      ON terminal.provider_run_id = claim.provider_run_id
    WHERE claim.environment = NEW.environment
      AND claim.provider_id = NEW.provider_id
      AND claim.generation = NEW.generation
      AND claim.provider_run_id = NEW.provider_run_id
      AND NEW.reconciled_at_ms >= terminal.ended_at_ms
      AND (
        (NEW.result = 'terminal_confirmed' AND terminal.ended_at_ms < claim.deadline_at_ms) OR
        (NEW.result = 'terminal_after_deadline_confirmed' AND terminal.ended_at_ms >= claim.deadline_at_ms)
      )
  ) THEN RAISE(ABORT, 'Provider fence reconciliation lacks exact terminal authority') END;
END;
CREATE TRIGGER publication_provider_fence_reconciliation_immutable_update
BEFORE UPDATE ON publication_provider_fence_reconciliation
BEGIN SELECT RAISE(ABORT, 'Provider fence reconciliation is immutable'); END;
CREATE TRIGGER publication_provider_fence_reconciliation_immutable_delete
BEFORE DELETE ON publication_provider_fence_reconciliation
BEGIN SELECT RAISE(ABORT, 'Provider fence reconciliation cannot be deleted'); END;

CREATE TRIGGER publication_provider_fence_release_insert_guard
BEFORE INSERT ON publication_provider_fence_release
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_provider_fence_release
    WHERE environment = NEW.environment AND provider_id = NEW.provider_id
      AND generation = NEW.generation
  ) THEN RAISE(ABORT, 'Provider fence release cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_provider_fence_claim AS claim
    JOIN publication_provider_terminal AS terminal
      ON terminal.provider_run_id = claim.provider_run_id
    JOIN publication_provider_fence_reconciliation AS reconciliation
      ON reconciliation.environment = claim.environment
     AND reconciliation.provider_id = claim.provider_id
     AND reconciliation.generation = claim.generation
     AND reconciliation.provider_run_id = claim.provider_run_id
    WHERE claim.environment = NEW.environment
      AND claim.provider_id = NEW.provider_id
      AND claim.generation = NEW.generation
      AND claim.provider_run_id = NEW.provider_run_id
      AND NEW.released_at_ms >= terminal.ended_at_ms
      AND NEW.released_at_ms >= reconciliation.reconciled_at_ms
  ) THEN RAISE(ABORT, 'Provider fence release lacks exact terminal authority') END;
END;
CREATE TRIGGER publication_provider_fence_release_immutable_update
BEFORE UPDATE ON publication_provider_fence_release
BEGIN SELECT RAISE(ABORT, 'Provider fence release is immutable'); END;
CREATE TRIGGER publication_provider_fence_release_immutable_delete
BEFORE DELETE ON publication_provider_fence_release
BEGIN SELECT RAISE(ABORT, 'Provider fence release cannot be deleted'); END;

CREATE TRIGGER publication_provider_fence_head_insert_guard
BEFORE INSERT ON publication_provider_fence_head
BEGIN
  SELECT CASE WHEN NEW.generation <> 1 OR NOT EXISTS (
    SELECT 1 FROM publication_provider_fence_claim
    WHERE environment = NEW.environment AND provider_id = NEW.provider_id
      AND generation = 1 AND provider_run_id = NEW.provider_run_id
  ) THEN RAISE(ABORT, 'initial Provider fence head lacks generation-one claim') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_orchestration_environment
    WHERE singleton = 1 AND environment = NEW.environment
  ) THEN RAISE(ABORT, 'Provider fence head environment mismatch') END;
END;
CREATE TRIGGER publication_provider_fence_head_update_guard
BEFORE UPDATE ON publication_provider_fence_head
BEGIN
  SELECT CASE WHEN NEW.environment <> OLD.environment
    OR NEW.provider_id <> OLD.provider_id
    OR NEW.generation <> OLD.generation + 1
  THEN RAISE(ABORT, 'Provider fence head may only advance one generation') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_provider_fence_reconciliation
    WHERE environment = OLD.environment AND provider_id = OLD.provider_id
      AND generation = OLD.generation AND provider_run_id = OLD.provider_run_id
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_provider_fence_release
    WHERE environment = OLD.environment AND provider_id = OLD.provider_id
      AND generation = OLD.generation AND provider_run_id = OLD.provider_run_id
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_provider_fence_claim
    WHERE environment = NEW.environment AND provider_id = NEW.provider_id
      AND generation = NEW.generation AND provider_run_id = NEW.provider_run_id
  ) THEN RAISE(ABORT, 'Provider fence head advance lacks closed history') END;
END;
CREATE TRIGGER publication_provider_fence_head_immutable_delete
BEFORE DELETE ON publication_provider_fence_head
BEGIN SELECT RAISE(ABORT, 'Provider fence head cannot be deleted'); END;

CREATE TRIGGER publication_roster_operational_outcome_insert_guard
BEFORE INSERT ON publication_roster_operational_outcome
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_roster_operational_outcome
    WHERE provider_run_id = NEW.provider_run_id
      AND roster_item_id = NEW.roster_item_id
  ) THEN RAISE(ABORT, 'operational roster outcome cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_coordination_provider_run AS provider_run
    JOIN publication_coordination_run AS run ON run.run_id = provider_run.run_id
    JOIN provider_roster_item AS item
      ON item.provider_id = provider_run.provider_id
     AND item.roster_version = provider_run.roster_version
     AND item.roster_item_id = NEW.roster_item_id
    JOIN publication_provider_fence_head AS head
      ON head.environment = run.environment
     AND head.provider_id = provider_run.provider_id
     AND head.provider_run_id = provider_run.provider_run_id
    JOIN publication_provider_fence_claim AS claim
      ON claim.environment = head.environment
     AND claim.provider_id = head.provider_id
     AND claim.generation = head.generation
     AND claim.provider_run_id = head.provider_run_id
    WHERE provider_run.provider_run_id = NEW.provider_run_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_fence_release AS release
        WHERE release.environment = head.environment
          AND release.provider_id = head.provider_id
          AND release.generation = head.generation
      )
      AND NEW.created_at_ms >= claim.claimed_at_ms
      AND (NEW.error_code IS NOT 'terminal_deadline_elapsed'
        OR NEW.created_at_ms >= run.deadline_at_ms)
  ) THEN RAISE(ABORT, 'operational roster outcome lacks current fenced Provider authority') END;
END;

-- Provenance-v2 is intentionally absent. This trigger prevents an old evidence
-- row from being misrepresented as evidence acquired by the parallel run.
CREATE TRIGGER publication_roster_outcome_source_execution_blocked
BEFORE INSERT ON publication_roster_operational_outcome
WHEN NEW.status IN ('published_candidate', 'published_candidate_with_unknowns')
BEGIN SELECT RAISE(ABORT, 'source-backed outcomes require provenance-v2 authority'); END;
CREATE TRIGGER publication_roster_operational_outcome_immutable_update
BEFORE UPDATE ON publication_roster_operational_outcome
BEGIN SELECT RAISE(ABORT, 'operational roster outcome is immutable'); END;
CREATE TRIGGER publication_roster_operational_outcome_immutable_delete
BEFORE DELETE ON publication_roster_operational_outcome
BEGIN SELECT RAISE(ABORT, 'operational roster outcome cannot be deleted'); END;

CREATE TRIGGER publication_retained_publication_authority_insert_guard
BEFORE INSERT ON publication_retained_publication_authority
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_retained_publication_authority WHERE run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'retained publication authority cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_coordination_run
    WHERE run_id = NEW.run_id AND environment = NEW.environment
      AND NEW.observed_at_ms >= started_at_ms
      AND NEW.observed_at_ms <= deadline_at_ms
  ) THEN RAISE(ABORT, 'retained publication authority does not match the run environment') END;
END;
-- The serving-head resolver does not exist in Phase D. No caller-supplied
-- publication ID/hash can become retention authority until a later migration
-- replaces this fail-closed activation boundary with a fixed resolver.
CREATE TRIGGER publication_retained_publication_authority_activation_blocked
BEFORE INSERT ON publication_retained_publication_authority
BEGIN SELECT RAISE(ABORT, 'retained publication authority requires the serving-head resolver'); END;
CREATE TRIGGER publication_retained_publication_authority_immutable_update
BEFORE UPDATE ON publication_retained_publication_authority
BEGIN SELECT RAISE(ABORT, 'retained publication authority is immutable'); END;
CREATE TRIGGER publication_retained_publication_authority_immutable_delete
BEFORE DELETE ON publication_retained_publication_authority
BEGIN SELECT RAISE(ABORT, 'retained publication authority cannot be deleted'); END;

CREATE TRIGGER publication_provider_terminal_insert_guard
BEFORE INSERT ON publication_provider_terminal
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_provider_terminal
    WHERE provider_run_id = NEW.provider_run_id
  ) THEN RAISE(ABORT, 'Provider terminal cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_coordination_provider_run AS provider_run
    JOIN publication_coordination_run AS run ON run.run_id = provider_run.run_id
    JOIN publication_provider_fence_head AS head
      ON head.environment = run.environment
     AND head.provider_id = provider_run.provider_id
     AND head.provider_run_id = provider_run.provider_run_id
     AND head.generation = NEW.fence_generation
    JOIN publication_provider_fence_claim AS claim
      ON claim.environment = head.environment
     AND claim.provider_id = head.provider_id
     AND claim.generation = head.generation
     AND claim.provider_run_id = head.provider_run_id
    WHERE provider_run.provider_run_id = NEW.provider_run_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_fence_release AS release
        WHERE release.environment = head.environment
          AND release.provider_id = head.provider_id
          AND release.generation = head.generation
      )
      AND NEW.ended_at_ms >= claim.claimed_at_ms
      AND NEW.requests <= provider_run.request_ceiling
      AND NEW.bytes <= provider_run.byte_ceiling
      AND NEW.ai_tokens <= provider_run.ai_token_ceiling
      AND NEW.browser_milliseconds <= provider_run.browser_millisecond_ceiling
      AND NEW.elapsed_milliseconds <= provider_run.elapsed_millisecond_ceiling
      AND NEW.cost_microusd <= provider_run.cost_microusd_ceiling
      AND (NOT EXISTS (
        SELECT 1 FROM json_each(NEW.error_codes_json)
        WHERE value = 'terminal_deadline_elapsed'
      ) OR NEW.ended_at_ms >= run.deadline_at_ms)
      AND NOT EXISTS (
        SELECT 1 FROM publication_roster_operational_outcome AS outcome
        WHERE outcome.provider_run_id = provider_run.provider_run_id
          AND outcome.created_at_ms > NEW.ended_at_ms
      )
      AND (SELECT count(*) FROM publication_roster_operational_outcome AS outcome
        WHERE outcome.provider_run_id = provider_run.provider_run_id) =
          (SELECT count(*) FROM provider_roster_item AS item
           WHERE item.provider_id = provider_run.provider_id
             AND item.roster_version = provider_run.roster_version)
      AND NOT EXISTS (
        SELECT 1 FROM provider_roster_item AS item
        WHERE item.provider_id = provider_run.provider_id
          AND item.roster_version = provider_run.roster_version
          AND NOT EXISTS (
            SELECT 1 FROM publication_roster_operational_outcome AS outcome
            WHERE outcome.provider_run_id = provider_run.provider_run_id
              AND outcome.roster_item_id = item.roster_item_id
          )
      )
  ) THEN RAISE(ABORT, 'Provider terminal lacks exact roster, fence, or cost closure') END;
  SELECT CASE WHEN (SELECT count(*) FROM json_each(NEW.error_codes_json)) > 4
    OR EXISTS (
      SELECT 1 FROM json_each(NEW.error_codes_json)
      WHERE type <> 'text' OR value NOT IN (
        'provider_failed', 'provider_quarantined', 'provider_unavailable',
        'terminal_deadline_elapsed'
      )
    ) OR EXISTS (
      SELECT 1 FROM json_each(NEW.error_codes_json) AS left_code
      JOIN json_each(NEW.error_codes_json) AS right_code
        ON left_code.key < right_code.key AND left_code.value >= right_code.value
    )
  THEN RAISE(ABORT, 'Provider terminal error codes are not closed, unique, and sorted') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM publication_roster_operational_outcome AS outcome
    WHERE outcome.provider_run_id = NEW.provider_run_id
      AND outcome.error_code IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.error_codes_json) AS terminal_code
        WHERE terminal_code.value = outcome.error_code
      )
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.error_codes_json) AS terminal_code
    WHERE (
      terminal_code.value = 'provider_failed'
      AND NEW.state <> 'failed'
      AND NOT EXISTS (
        SELECT 1 FROM publication_roster_operational_outcome AS outcome
        WHERE outcome.provider_run_id = NEW.provider_run_id
          AND outcome.error_code = 'provider_failed'
      )
    ) OR (
      terminal_code.value = 'provider_quarantined'
      AND NEW.state <> 'quarantined'
      AND NOT EXISTS (
        SELECT 1 FROM publication_roster_operational_outcome AS outcome
        WHERE outcome.provider_run_id = NEW.provider_run_id
          AND outcome.error_code = 'provider_quarantined'
      )
    ) OR (
      terminal_code.value = 'provider_unavailable'
      AND NEW.publication_disposition <> 'unavailable'
      AND NOT EXISTS (
        SELECT 1 FROM publication_roster_operational_outcome AS outcome
        WHERE outcome.provider_run_id = NEW.provider_run_id
          AND outcome.error_code = 'provider_unavailable'
      )
    ) OR (
      terminal_code.value = 'terminal_deadline_elapsed'
      AND NOT EXISTS (
        SELECT 1
        FROM publication_coordination_provider_run AS provider_run
        JOIN publication_coordination_run AS run ON run.run_id = provider_run.run_id
        WHERE provider_run.provider_run_id = NEW.provider_run_id
          AND NEW.ended_at_ms >= run.deadline_at_ms
      )
      AND NOT EXISTS (
        SELECT 1 FROM publication_roster_operational_outcome AS outcome
        WHERE outcome.provider_run_id = NEW.provider_run_id
          AND outcome.error_code = 'terminal_deadline_elapsed'
      )
    )
  ) THEN RAISE(ABORT, 'Provider terminal error codes lack exact roster and terminal justification') END;
  SELECT CASE WHEN NEW.state <> 'quarantined' AND EXISTS (
    SELECT 1 FROM publication_roster_operational_outcome
    WHERE provider_run_id = NEW.provider_run_id AND status = 'quarantined'
  ) THEN RAISE(ABORT, 'quarantined roster outcome requires quarantined Provider state') END;
  SELECT CASE WHEN NEW.state = 'ready' AND NEW.error_codes_json <> '[]'
    THEN RAISE(ABORT, 'ready Provider cannot carry terminal errors') END;
  SELECT CASE WHEN NEW.state = 'failed' AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.error_codes_json)
    WHERE value IN ('provider_failed', 'terminal_deadline_elapsed')
  ) THEN RAISE(ABORT, 'failed Provider lacks its terminal code') END;
  SELECT CASE WHEN NEW.state = 'quarantined' AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.error_codes_json)
    WHERE value = 'provider_quarantined'
  ) THEN RAISE(ABORT, 'quarantined Provider lacks its terminal code') END;
  SELECT CASE WHEN NEW.publication_disposition = 'unavailable' AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.error_codes_json)
    WHERE value IN ('provider_unavailable', 'terminal_deadline_elapsed')
  ) THEN RAISE(ABORT, 'unavailable Provider lacks its terminal code') END;
  SELECT CASE WHEN NEW.publication_disposition = 'carried_forward' AND NOT EXISTS (
    SELECT 1
    FROM publication_coordination_provider_run AS provider_run
    JOIN publication_retained_publication_authority AS retained
      ON retained.run_id = provider_run.run_id
    WHERE provider_run.provider_run_id = NEW.provider_run_id
  ) THEN RAISE(ABORT, 'carried Provider lacks retained publication authority') END;
  SELECT CASE WHEN NEW.state = 'ready' AND EXISTS (
    SELECT 1 FROM publication_roster_operational_outcome
    WHERE provider_run_id = NEW.provider_run_id
      AND status NOT IN ('published_candidate', 'published_candidate_with_unknowns')
  ) THEN RAISE(ABORT, 'ready Provider lacks complete source-backed outcomes') END;
  SELECT CASE WHEN NEW.state = 'failed' AND (
    EXISTS (
      SELECT 1 FROM publication_roster_operational_outcome
      WHERE provider_run_id = NEW.provider_run_id AND status = 'quarantined'
    ) OR NOT EXISTS (
      SELECT 1 FROM publication_roster_operational_outcome
      WHERE provider_run_id = NEW.provider_run_id
        AND status IN ('unavailable', 'failed')
    )
  ) THEN RAISE(ABORT, 'failed Provider does not match operational failure outcomes') END;
  SELECT CASE WHEN NEW.state = 'quarantined' AND NOT EXISTS (
    SELECT 1 FROM publication_roster_operational_outcome
    WHERE provider_run_id = NEW.provider_run_id AND status = 'quarantined'
  ) THEN RAISE(ABORT, 'quarantined Provider lacks a quarantine outcome') END;
END;
CREATE TRIGGER publication_provider_terminal_immutable_update
BEFORE UPDATE ON publication_provider_terminal
BEGIN SELECT RAISE(ABORT, 'Provider terminal is immutable'); END;
CREATE TRIGGER publication_provider_terminal_immutable_delete
BEFORE DELETE ON publication_provider_terminal
BEGIN SELECT RAISE(ABORT, 'Provider terminal cannot be deleted'); END;

CREATE TRIGGER publication_run_terminal_insert_guard
BEFORE INSERT ON publication_run_terminal
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_run_terminal WHERE run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'publication run terminal cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_coordination_run AS run
    WHERE run.run_id = NEW.run_id
      AND NEW.ended_at_ms >= run.started_at_ms
      AND NEW.requests = COALESCE((SELECT sum(terminal.requests)
        FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = run.run_id), 0)
      AND NEW.bytes = COALESCE((SELECT sum(terminal.bytes)
        FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = run.run_id), 0)
      AND NEW.ai_tokens = COALESCE((SELECT sum(terminal.ai_tokens)
        FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = run.run_id), 0)
      AND NEW.browser_milliseconds = COALESCE((SELECT sum(terminal.browser_milliseconds)
        FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = run.run_id), 0)
      AND NEW.elapsed_milliseconds = COALESCE((SELECT sum(terminal.elapsed_milliseconds)
        FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = run.run_id), 0)
      AND NEW.cost_microusd = COALESCE((SELECT sum(terminal.cost_microusd)
        FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = run.run_id), 0)
      AND NEW.requests <= run.request_ceiling
      AND NEW.bytes <= run.byte_ceiling
      AND NEW.ai_tokens <= run.ai_token_ceiling
      AND NEW.browser_milliseconds <= run.browser_millisecond_ceiling
      AND NEW.elapsed_milliseconds <= run.elapsed_millisecond_ceiling
      AND NEW.cost_microusd <= run.cost_microusd_ceiling
      AND (SELECT count(*) FROM publication_coordination_provider_run
           WHERE run_id = run.run_id) = run.provider_count
      AND (SELECT count(*) FROM publication_provider_terminal AS terminal
           JOIN publication_coordination_provider_run AS provider_run
             ON provider_run.provider_run_id = terminal.provider_run_id
           WHERE provider_run.run_id = run.run_id) = run.provider_count
      AND NOT EXISTS (
        SELECT 1 FROM publication_coordination_provider_run AS provider_run
        WHERE provider_run.run_id = run.run_id AND NOT EXISTS (
          SELECT 1 FROM publication_provider_fence_claim AS claim
          JOIN publication_provider_fence_release AS release
            ON release.environment = claim.environment
           AND release.provider_id = claim.provider_id
           AND release.generation = claim.generation
           AND release.provider_run_id = claim.provider_run_id
          WHERE claim.provider_run_id = provider_run.provider_run_id
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM publication_coordination_provider_run AS provider_run
        JOIN publication_provider_terminal AS terminal
          ON terminal.provider_run_id = provider_run.provider_run_id
        JOIN publication_provider_fence_claim AS claim
          ON claim.provider_run_id = provider_run.provider_run_id
        JOIN publication_provider_fence_reconciliation AS reconciliation
          ON reconciliation.environment = claim.environment
         AND reconciliation.provider_id = claim.provider_id
         AND reconciliation.generation = claim.generation
         AND reconciliation.provider_run_id = claim.provider_run_id
        JOIN publication_provider_fence_release AS release
          ON release.environment = claim.environment
         AND release.provider_id = claim.provider_id
         AND release.generation = claim.generation
         AND release.provider_run_id = claim.provider_run_id
        WHERE provider_run.run_id = run.run_id
          AND (terminal.ended_at_ms > NEW.ended_at_ms
            OR reconciliation.reconciled_at_ms > NEW.ended_at_ms
            OR release.released_at_ms > NEW.ended_at_ms)
      )
  ) THEN RAISE(ABORT, 'run terminal lacks exact Provider, release, or cost closure') END;
  SELECT CASE WHEN (SELECT count(*) FROM json_each(NEW.error_codes_json)) > 8
    OR EXISTS (
      SELECT 1 FROM json_each(NEW.error_codes_json)
      WHERE type <> 'text' OR value NOT IN (
        'provider_failed', 'provider_quarantined', 'provider_unavailable',
        'partial_provider_refresh', 'last_known_good_only',
        'zero_usable_providers', 'run_wide_quarantine',
        'terminal_deadline_elapsed'
      )
    ) OR EXISTS (
      SELECT 1 FROM json_each(NEW.error_codes_json) AS left_code
      JOIN json_each(NEW.error_codes_json) AS right_code
        ON left_code.key < right_code.key AND left_code.value >= right_code.value
    )
  THEN RAISE(ABORT, 'run terminal error codes are not closed, unique, and sorted') END;
  -- Exact Phase C error closure: Provider codes plus exactly one derived run
  -- reason when the terminal decision has one. No known-but-unrelated code is
  -- accepted merely because it belongs to the global enum.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.error_codes_json) AS run_code
    WHERE NOT EXISTS (
      SELECT 1
      FROM publication_provider_terminal AS terminal
      JOIN publication_coordination_provider_run AS provider_run
        ON provider_run.provider_run_id = terminal.provider_run_id
      JOIN json_each(terminal.error_codes_json) AS provider_code
      WHERE provider_run.run_id = NEW.run_id
        AND provider_code.value = run_code.value
    ) AND run_code.value IS NOT CASE
      WHEN NEW.run_wide_quarantine = 1 THEN 'run_wide_quarantine'
      WHEN NEW.ended_at_ms >= (
        SELECT deadline_at_ms FROM publication_coordination_run WHERE run_id = NEW.run_id
      ) THEN 'terminal_deadline_elapsed'
      WHEN (SELECT count(*) FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id AND terminal.state = 'ready') =
        (SELECT provider_count FROM publication_coordination_run WHERE run_id = NEW.run_id)
        THEN NULL
      WHEN EXISTS (SELECT 1 FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id AND terminal.state = 'ready')
        THEN 'partial_provider_refresh'
      WHEN EXISTS (SELECT 1 FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id
          AND terminal.publication_disposition = 'carried_forward')
        THEN 'last_known_good_only'
      ELSE 'zero_usable_providers'
    END
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_terminal AS terminal
    JOIN publication_coordination_provider_run AS provider_run
      ON provider_run.provider_run_id = terminal.provider_run_id
    JOIN json_each(terminal.error_codes_json) AS provider_code
    WHERE provider_run.run_id = NEW.run_id
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.error_codes_json) AS run_code
        WHERE run_code.value = provider_code.value
      )
  ) OR (
    CASE
      WHEN NEW.run_wide_quarantine = 1 THEN 'run_wide_quarantine'
      WHEN NEW.ended_at_ms >= (
        SELECT deadline_at_ms FROM publication_coordination_run WHERE run_id = NEW.run_id
      ) THEN 'terminal_deadline_elapsed'
      WHEN (SELECT count(*) FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id AND terminal.state = 'ready') =
        (SELECT provider_count FROM publication_coordination_run WHERE run_id = NEW.run_id)
        THEN NULL
      WHEN EXISTS (SELECT 1 FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id AND terminal.state = 'ready')
        THEN 'partial_provider_refresh'
      WHEN EXISTS (SELECT 1 FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id
          AND terminal.publication_disposition = 'carried_forward')
        THEN 'last_known_good_only'
      ELSE 'zero_usable_providers'
    END
  ) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM json_each(NEW.error_codes_json) AS run_code
    WHERE run_code.value = CASE
      WHEN NEW.run_wide_quarantine = 1 THEN 'run_wide_quarantine'
      WHEN NEW.ended_at_ms >= (
        SELECT deadline_at_ms FROM publication_coordination_run WHERE run_id = NEW.run_id
      ) THEN 'terminal_deadline_elapsed'
      WHEN (SELECT count(*) FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id AND terminal.state = 'ready') =
        (SELECT provider_count FROM publication_coordination_run WHERE run_id = NEW.run_id)
        THEN NULL
      WHEN EXISTS (SELECT 1 FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id AND terminal.state = 'ready')
        THEN 'partial_provider_refresh'
      WHEN EXISTS (SELECT 1 FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id
          AND terminal.publication_disposition = 'carried_forward')
        THEN 'last_known_good_only'
      ELSE 'zero_usable_providers'
    END
  ) THEN RAISE(ABORT, 'run terminal error codes do not equal Provider union plus decision reason') END;
  SELECT CASE WHEN NEW.run_wide_quarantine = 1 AND NOT (
    NEW.run_outcome = 'quarantined' AND NEW.publication_disposition = 'blocked'
    AND EXISTS (SELECT 1 FROM json_each(NEW.error_codes_json) WHERE value = 'run_wide_quarantine')
  ) THEN RAISE(ABORT, 'run-wide quarantine terminal mapping is inconsistent') END;
  SELECT CASE WHEN NEW.run_wide_quarantine = 0 AND NEW.ended_at_ms >= (
    SELECT deadline_at_ms FROM publication_coordination_run WHERE run_id = NEW.run_id
  ) AND NOT (
    NEW.run_outcome = 'failed' AND NEW.publication_disposition = 'blocked'
    AND EXISTS (SELECT 1 FROM json_each(NEW.error_codes_json) WHERE value = 'terminal_deadline_elapsed')
  ) THEN RAISE(ABORT, 'deadline terminal mapping is inconsistent') END;
  SELECT CASE WHEN NEW.run_wide_quarantine = 0 AND NEW.ended_at_ms < (
    SELECT deadline_at_ms FROM publication_coordination_run WHERE run_id = NEW.run_id
  ) AND NOT (
    (
      (SELECT count(*) FROM publication_provider_terminal AS terminal
       JOIN publication_coordination_provider_run AS provider_run
         ON provider_run.provider_run_id = terminal.provider_run_id
       WHERE provider_run.run_id = NEW.run_id AND terminal.state = 'ready') =
      (SELECT provider_count FROM publication_coordination_run WHERE run_id = NEW.run_id)
      AND NEW.run_outcome = 'succeeded' AND NEW.publication_disposition = 'publish_new'
    ) OR (
      (SELECT count(*) FROM publication_provider_terminal AS terminal
       JOIN publication_coordination_provider_run AS provider_run
         ON provider_run.provider_run_id = terminal.provider_run_id
       WHERE provider_run.run_id = NEW.run_id AND terminal.state = 'ready') BETWEEN 1 AND
        (SELECT provider_count - 1 FROM publication_coordination_run WHERE run_id = NEW.run_id)
      AND NEW.run_outcome = 'completed_with_provider_failures'
      AND NEW.publication_disposition = 'publish_new'
    ) OR (
      NOT EXISTS (
        SELECT 1 FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id AND terminal.state = 'ready'
      ) AND EXISTS (
        SELECT 1 FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id
          AND terminal.publication_disposition = 'carried_forward'
      ) AND NEW.run_outcome = 'completed_with_provider_failures'
        AND NEW.publication_disposition = 'retain_current'
    ) OR (
      NOT EXISTS (
        SELECT 1 FROM publication_provider_terminal AS terminal
        JOIN publication_coordination_provider_run AS provider_run
          ON provider_run.provider_run_id = terminal.provider_run_id
        WHERE provider_run.run_id = NEW.run_id
          AND terminal.publication_disposition IN ('new', 'carried_forward')
      ) AND NEW.run_outcome = 'failed' AND NEW.publication_disposition = 'blocked'
    )
  ) THEN RAISE(ABORT, 'run terminal outcome/disposition mapping is inconsistent') END;
  SELECT CASE WHEN (
    NEW.publication_disposition = 'retain_current' OR EXISTS (
      SELECT 1 FROM publication_provider_terminal AS terminal
      JOIN publication_coordination_provider_run AS provider_run
        ON provider_run.provider_run_id = terminal.provider_run_id
      WHERE provider_run.run_id = NEW.run_id
        AND terminal.publication_disposition = 'carried_forward'
    )
  ) AND NOT EXISTS (
    SELECT 1 FROM publication_retained_publication_authority
    WHERE run_id = NEW.run_id
  ) THEN RAISE(ABORT, 'retained publication disposition lacks head authority') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_coordination_run AS run
    JOIN publication_orchestration_occurrence AS occurrence USING (occurrence_id)
    JOIN schedule_occurrence AS scheduled USING (occurrence_id)
    WHERE run.run_id = NEW.run_id
      AND json_extract(NEW.report_text, '$.reportSchemaVersion') = NEW.report_schema_version
      AND json_extract(NEW.report_text, '$.kind') = 'terminal_run'
      AND json_extract(NEW.report_text, '$.scheduleName') = scheduled.schedule_name
      AND json_extract(NEW.report_text, '$.scheduleExpression') = scheduled.schedule_expression
      AND json_extract(NEW.report_text, '$.environment') = run.environment
      AND json_extract(NEW.report_text, '$.occurrenceId') = run.occurrence_id
      AND json_extract(NEW.report_text, '$.runId') = run.run_id
      AND json_extract(NEW.report_text, '$.attemptNumber') = run.attempt_number
      AND (
        (run.replay_of_run_id IS NULL AND json_type(NEW.report_text, '$.replayOfRunId') IS NULL) OR
        json_extract(NEW.report_text, '$.replayOfRunId') = run.replay_of_run_id
      )
      AND json_extract(NEW.report_text, '$.runPlanId') = run.run_plan_id
      AND json_extract(NEW.report_text, '$.runPlanHash') = run.run_plan_hash
      AND json_extract(NEW.report_text, '$.policySetHash') = run.policy_set_hash
      AND json_extract(NEW.report_text, '$.codeVersion') = run.code_version
      AND json_extract(NEW.report_text, '$.canonicalSchemaVersion') = run.canonical_schema_version
      AND json_extract(NEW.report_text, '$.pipelineContractVersion') = run.pipeline_contract_version
      AND json_extract(NEW.report_text, '$.scheduledAt') =
          strftime('%Y-%m-%dT%H:%M:%fZ', scheduled.scheduled_at_ms / 1000.0, 'unixepoch')
      AND json_extract(NEW.report_text, '$.startedAt') =
          strftime('%Y-%m-%dT%H:%M:%fZ', run.started_at_ms / 1000.0, 'unixepoch')
      AND json_extract(NEW.report_text, '$.terminalDeadlineAt') =
          strftime('%Y-%m-%dT%H:%M:%fZ', run.deadline_at_ms / 1000.0, 'unixepoch')
      AND json_extract(NEW.report_text, '$.endedAt') =
          strftime('%Y-%m-%dT%H:%M:%fZ', NEW.ended_at_ms / 1000.0, 'unixepoch')
      AND json_extract(NEW.report_text, '$.runOutcome') = NEW.run_outcome
      AND json_extract(NEW.report_text, '$.publicationDisposition') = NEW.publication_disposition
      AND json_extract(NEW.report_text, '$.cost.requests') = NEW.requests
      AND json_extract(NEW.report_text, '$.cost.bytes') = NEW.bytes
      AND json_extract(NEW.report_text, '$.cost.aiTokens') = NEW.ai_tokens
      AND json_extract(NEW.report_text, '$.cost.browserMilliseconds') = NEW.browser_milliseconds
      AND json_extract(NEW.report_text, '$.cost.elapsedMilliseconds') = NEW.elapsed_milliseconds
      AND json_extract(NEW.report_text, '$.cost.costMicrousd') = NEW.cost_microusd
      AND json(json_extract(NEW.report_text, '$.errorCodes')) = json(NEW.error_codes_json)
      AND json_extract(NEW.report_text, '$.seal.algorithm') = 'sha256'
      AND json_extract(NEW.report_text, '$.seal.contentHash') = NEW.report_hash
      AND json_array_length(NEW.report_text, '$.providerScope') = run.provider_count
      AND json_array_length(NEW.report_text, '$.providers') = run.provider_count
      AND (
        (NOT EXISTS (
          SELECT 1 FROM publication_retained_publication_authority
          WHERE run_id = NEW.run_id
        ) AND json_type(NEW.report_text, '$.retainedPublication') IS NULL) OR
        EXISTS (
          SELECT 1 FROM publication_retained_publication_authority AS retained
          WHERE retained.run_id = NEW.run_id
            AND json_extract(NEW.report_text, '$.retainedPublication.authoritySchema') = retained.authority_schema
            AND json_extract(NEW.report_text, '$.retainedPublication.environment') = retained.environment
            AND json_extract(NEW.report_text, '$.retainedPublication.publicationId') = retained.publication_id
            AND json_extract(NEW.report_text, '$.retainedPublication.closureHash') = retained.closure_hash
        )
      )
  ) THEN RAISE(ABORT, 'terminal report does not close exact run authority') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.report_text)
    WHERE key NOT IN (
      'reportSchemaVersion', 'kind', 'scheduleName', 'scheduleExpression',
      'environment', 'occurrenceId', 'runId', 'attemptNumber', 'replayOfRunId',
      'runPlanId', 'runPlanHash', 'policySetHash', 'codeVersion',
      'canonicalSchemaVersion', 'pipelineContractVersion', 'providerScope',
      'scheduledAt', 'startedAt', 'terminalDeadlineAt', 'endedAt',
      'runOutcome', 'publicationDisposition', 'cost', 'errorCodes',
      'retainedPublication', 'providers', 'seal'
    )
  ) OR (SELECT count(*) FROM json_each(NEW.report_text)) <>
      25 + CASE WHEN json_type(NEW.report_text, '$.replayOfRunId') IS NULL THEN 0 ELSE 1 END
         + CASE WHEN json_type(NEW.report_text, '$.retainedPublication') IS NULL THEN 0 ELSE 1 END
    OR EXISTS (
    SELECT 1 FROM json_each(NEW.report_text, '$.cost')
    WHERE key NOT IN ('requests', 'bytes', 'aiTokens', 'browserMilliseconds', 'elapsedMilliseconds', 'costMicrousd')
  ) OR (SELECT count(*) FROM json_each(NEW.report_text, '$.cost')) <> 6
    OR (SELECT count(*) FROM json_each(NEW.report_text, '$.seal')) <> 2
    OR (
      json_type(NEW.report_text, '$.retainedPublication') IS NOT NULL AND (
        json_type(NEW.report_text, '$.retainedPublication') <> 'object' OR
        (SELECT count(*) FROM json_each(NEW.report_text, '$.retainedPublication')) <> 4 OR
        EXISTS (
          SELECT 1 FROM json_each(NEW.report_text, '$.retainedPublication')
          WHERE key NOT IN ('authoritySchema', 'environment', 'publicationId', 'closureHash')
        )
      )
    )
  THEN RAISE(ABORT, 'terminal report fields are not closed') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.report_text, '$.providerScope') AS scope
    LEFT JOIN publication_coordination_provider_run AS provider_run
      ON provider_run.run_id = NEW.run_id
     AND provider_run.ordinal = CAST(scope.key AS INTEGER)
     AND provider_run.provider_id = scope.value
    WHERE provider_run.provider_run_id IS NULL
  ) THEN RAISE(ABORT, 'terminal report Provider scope is not exact') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.report_text, '$.providers') AS reported
    LEFT JOIN publication_coordination_provider_run AS provider_run
      ON provider_run.run_id = NEW.run_id
     AND provider_run.ordinal = CAST(reported.key AS INTEGER)
    LEFT JOIN publication_provider_terminal AS terminal
      ON terminal.provider_run_id = provider_run.provider_run_id
    WHERE terminal.provider_run_id IS NULL
      OR json_extract(reported.value, '$.providerId') IS NOT provider_run.provider_id
      OR json_extract(reported.value, '$.adapterVersion') IS NOT provider_run.adapter_version
      OR json_extract(reported.value, '$.rosterVersion') IS NOT provider_run.roster_version
      OR json_extract(reported.value, '$.sourceRegisterVersion') IS NOT provider_run.source_register_version
      OR json_extract(reported.value, '$.state') IS NOT terminal.state
      OR json_extract(reported.value, '$.rosterComplete') IS NOT 1
      OR json_extract(reported.value, '$.publicationDisposition') IS NOT terminal.publication_disposition
      OR NOT (
        (terminal.slice_id IS NULL AND json_type(reported.value, '$.sliceId') IS NULL) OR
        json_extract(reported.value, '$.sliceId') = terminal.slice_id
      )
      OR json_extract(reported.value, '$.cost.requests') IS NOT terminal.requests
      OR json_extract(reported.value, '$.cost.bytes') IS NOT terminal.bytes
      OR json_extract(reported.value, '$.cost.aiTokens') IS NOT terminal.ai_tokens
      OR json_extract(reported.value, '$.cost.browserMilliseconds') IS NOT terminal.browser_milliseconds
      OR json_extract(reported.value, '$.cost.elapsedMilliseconds') IS NOT terminal.elapsed_milliseconds
      OR json_extract(reported.value, '$.cost.costMicrousd') IS NOT terminal.cost_microusd
      OR json(json_extract(reported.value, '$.errorCodes')) IS NOT json(terminal.error_codes_json)
  ) THEN RAISE(ABORT, 'terminal report Provider rows are not exact') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.report_text, '$.providers') AS reported
    WHERE json_type(reported.value) <> 'object'
      OR EXISTS (
        SELECT 1 FROM json_each(reported.value)
        WHERE key NOT IN (
          'providerId', 'adapterVersion', 'rosterVersion',
          'sourceRegisterVersion', 'state', 'rosterComplete',
          'publicationDisposition', 'sliceId', 'cost', 'errorCodes'
        )
      )
      OR (SELECT count(*) FROM json_each(reported.value)) <>
        9 + CASE WHEN json_type(reported.value, '$.sliceId') IS NULL THEN 0 ELSE 1 END
      OR json_type(reported.value, '$.cost') <> 'object'
      OR (SELECT count(*) FROM json_each(reported.value, '$.cost')) <> 6
      OR EXISTS (
        SELECT 1 FROM json_each(reported.value, '$.cost')
        WHERE key NOT IN (
          'requests', 'bytes', 'aiTokens', 'browserMilliseconds',
          'elapsedMilliseconds', 'costMicrousd'
        )
      )
  ) THEN RAISE(ABORT, 'terminal report Provider fields are not closed') END;
END;
CREATE TRIGGER publication_run_terminal_immutable_update
BEFORE UPDATE ON publication_run_terminal
BEGIN SELECT RAISE(ABORT, 'publication run terminal is immutable'); END;
CREATE TRIGGER publication_run_terminal_immutable_delete
BEFORE DELETE ON publication_run_terminal
BEGIN SELECT RAISE(ABORT, 'publication run terminal cannot be deleted'); END;
