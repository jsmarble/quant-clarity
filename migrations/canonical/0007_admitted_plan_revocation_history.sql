-- Preserve the meaning of an immutable admitted firing when run-plan
-- revocation authority is appended later. This migration activates no
-- rejection, replay, source-execution, binding, schedule, or deployment path.
-- Requirements: PIPE-001–PIPE-004, BE-003–BE-006, QA-006.

PRAGMA defer_foreign_keys = true;

-- Install only over the exact local publication-orchestration predecessor.
SELECT CASE WHEN (
  SELECT count(*) FROM schema_metadata
) <> 1 OR (
  SELECT count(*) FROM schema_metadata
  WHERE singleton = 1 AND schema_version = '1.0.0'
) <> 1 OR (
  SELECT count(*) FROM publication_run_plan_authority_integrity_metadata
  WHERE singleton = 1
    AND capability = 'publication-run-plan-authority@1'
) <> 1 OR (
  SELECT count(*) FROM publication_orchestration_integrity_metadata
  WHERE singleton = 1
    AND capability = 'publication-orchestration-ledger@1'
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name IN (
    'publication_run_plan',
    'publication_run_plan_seal',
    'publication_run_plan_approval',
    'publication_run_plan_revocation',
    'schedule_occurrence',
    'publication_orchestration_occurrence',
    'publication_admission_rejection',
    'publication_coordination_run'
  )
) <> 8 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name IN (
    'publication_run_plan_immutable_update',
    'publication_run_plan_immutable_delete',
    'publication_run_plan_revocation_insert_guard',
    'publication_run_plan_revocation_immutable_update',
    'publication_run_plan_revocation_immutable_delete',
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
    'publication_coordination_run_immutable_delete'
  )
) <> 17 OR EXISTS (
  SELECT 1
  FROM publication_run_plan_revocation AS revocation
  JOIN publication_run_plan AS plan USING (run_plan_id)
  JOIN publication_orchestration_occurrence AS occurrence
    ON occurrence.requested_run_plan_id = plan.run_plan_id
   AND occurrence.requested_run_plan_hash = plan.plan_hash
  JOIN schedule_occurrence AS scheduled USING (occurrence_id)
  WHERE revocation.effective_at_ms <= scheduled.scheduled_at_ms
    AND (
      EXISTS (
        SELECT 1 FROM publication_coordination_run AS run
        WHERE run.occurrence_id = occurrence.occurrence_id
          AND run.attempt_number = 1
      ) OR EXISTS (
        SELECT 1 FROM publication_admission_rejection AS rejection
        WHERE rejection.occurrence_id = occurrence.occurrence_id
      )
    )
) THEN json('') END;

-- A same-name object of any SQLite kind is an authority-boundary collision.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE name = 'publication_run_plan_revocation_admitted_history_guard'
) THEN json('') END;

-- Revocation remains append-only, but its effective instant may not rewrite
-- the scheduled-time authority under which an immutable run was admitted.
-- A later effective instant remains valid and is enforced for later firings by
-- the existing coordination-run admission guard.
CREATE TRIGGER publication_run_plan_revocation_admitted_history_guard
BEFORE INSERT ON publication_run_plan_revocation
WHEN EXISTS (
  SELECT 1
  FROM publication_run_plan AS plan
  JOIN publication_orchestration_occurrence AS occurrence
    ON occurrence.requested_run_plan_id = plan.run_plan_id
   AND occurrence.requested_run_plan_hash = plan.plan_hash
  JOIN schedule_occurrence AS scheduled USING (occurrence_id)
  WHERE plan.run_plan_id = NEW.run_plan_id
    AND NEW.effective_at_ms <= scheduled.scheduled_at_ms
    AND (
      EXISTS (
        SELECT 1 FROM publication_coordination_run AS run
        WHERE run.occurrence_id = occurrence.occurrence_id
          AND run.attempt_number = 1
      ) OR EXISTS (
        SELECT 1 FROM publication_admission_rejection AS rejection
        WHERE rejection.occurrence_id = occurrence.occurrence_id
      )
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'publication run-plan revocation cannot rewrite resolved scheduled history'
  );
END;
