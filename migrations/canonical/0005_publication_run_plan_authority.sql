-- Immutable publication run-plan authority. This migration adds no runtime
-- resolver, schedule, binding, provider execution, or deployment authority.
-- Requirements: PIPE-001–PIPE-004, PIPE-045, BE-004–BE-006.

PRAGMA defer_foreign_keys = true;

-- Install only over the exact canonical predecessor capability.
SELECT CASE WHEN (
  SELECT count(*) FROM schema_metadata
) <> 1 OR (
  SELECT count(*) FROM schema_metadata
  WHERE singleton = 1 AND schema_version = '1.0.0'
) <> 1 OR (
  SELECT count(*) FROM model_slug_history_integrity_metadata
) <> 1 OR (
  SELECT count(*) FROM model_slug_history_integrity_metadata
  WHERE singleton = 1 AND guard_version = 'model-slug-history-guard@1'
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name IN (
    'provider', 'provider_roster', 'provider_roster_item',
    'source_compliance_record', 'model_slug_history_integrity_metadata'
  )
) <> 5 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE (type = 'table' AND name = 'model_slug_history_integrity_metadata')
     OR (type = 'index' AND name IN (
       'slug_history_resource_interval_idx',
       'slug_history_slug_owner_idx'
     ))
     OR (type = 'trigger' AND name IN (
       'model_slug_history_integrity_metadata_immutable_update',
       'model_slug_history_integrity_metadata_immutable_delete',
       'slug_history_model_replace_guard',
       'slug_history_model_insert_guard',
       'slug_history_model_update_guard',
       'slug_history_model_delete_guard'
     ))
) <> 9 THEN json('') END;

-- A same-name object of any SQLite kind is an authority-boundary collision.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema WHERE name IN (
    'publication_run_plan_authority_integrity_metadata',
    'publication_run_plan',
    'publication_run_plan_provider',
    'publication_run_plan_policy',
    'publication_run_plan_seal',
    'publication_run_plan_approval',
    'publication_run_plan_revocation',
    'publication_run_plan_effective_idx',
    'publication_run_plan_provider_ordinal_uq',
    'publication_run_plan_authority_integrity_metadata_insert_guard',
    'publication_run_plan_authority_integrity_metadata_immutable_update',
    'publication_run_plan_authority_integrity_metadata_immutable_delete',
    'publication_run_plan_insert_guard',
    'publication_run_plan_immutable_update',
    'publication_run_plan_immutable_delete',
    'publication_run_plan_provider_insert_guard',
    'publication_run_plan_provider_immutable_update',
    'publication_run_plan_provider_immutable_delete',
    'provider_roster_item_run_plan_frozen_insert',
    'provider_roster_run_plan_frozen_update',
    'provider_roster_run_plan_frozen_delete',
    'provider_roster_item_run_plan_frozen_update',
    'provider_roster_item_run_plan_frozen_delete',
    'source_compliance_run_plan_frozen_update',
    'source_compliance_run_plan_frozen_delete',
    'publication_run_plan_policy_insert_guard',
    'publication_run_plan_policy_immutable_update',
    'publication_run_plan_policy_immutable_delete',
    'publication_run_plan_seal_insert_guard',
    'publication_run_plan_seal_immutable_update',
    'publication_run_plan_seal_immutable_delete',
    'publication_run_plan_approval_insert_guard',
    'publication_run_plan_approval_immutable_update',
    'publication_run_plan_approval_immutable_delete',
    'publication_run_plan_revocation_insert_guard',
    'publication_run_plan_revocation_immutable_update',
    'publication_run_plan_revocation_immutable_delete'
  )
) THEN json('') END;

CREATE TABLE publication_run_plan_authority_integrity_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  capability TEXT NOT NULL
    CHECK (capability = 'publication-run-plan-authority@1')
) STRICT;

INSERT INTO publication_run_plan_authority_integrity_metadata (
  singleton, capability
) VALUES (1, 'publication-run-plan-authority@1');

CREATE TABLE publication_run_plan (
  run_plan_id TEXT PRIMARY KEY CHECK (
    length(run_plan_id) = 40 AND
    substr(run_plan_id, 1, 4) = 'rpl_' AND
    run_plan_id = lower(run_plan_id) AND
    substr(run_plan_id, 13, 1) = '-' AND
    substr(run_plan_id, 18, 1) = '-' AND
    substr(run_plan_id, 19, 1) = '4' AND
    substr(run_plan_id, 23, 1) = '-' AND
    substr(run_plan_id, 24, 1) IN ('8', '9', 'a', 'b') AND
    substr(run_plan_id, 28, 1) = '-' AND
    substr(run_plan_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(run_plan_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(run_plan_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(run_plan_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(run_plan_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  contract_version TEXT NOT NULL
    CHECK (contract_version = 'publication-run-plan@1'),
  canonical_schema_version TEXT NOT NULL CHECK (
    length(canonical_schema_version) BETWEEN 1 AND 64 AND
    canonical_schema_version NOT GLOB '*[^ -~]*'
  ),
  pipeline_contract_version TEXT NOT NULL CHECK (
    length(pipeline_contract_version) BETWEEN 1 AND 128 AND
    pipeline_contract_version NOT GLOB '*[^ -~]*'
  ),
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  schedule_name TEXT NOT NULL CHECK (schedule_name = 'provider-refresh-v1'),
  schedule_expression TEXT NOT NULL CHECK (schedule_expression = '0 5 * * 1,4'),
  effective_from_ms INTEGER NOT NULL CHECK (
    typeof(effective_from_ms) = 'integer' AND
    effective_from_ms BETWEEN 0 AND 8640000000000000
  ),
  effective_to_ms INTEGER NOT NULL CHECK (
    typeof(effective_to_ms) = 'integer' AND
    effective_to_ms > effective_from_ms AND
    effective_to_ms <= 8640000000000000
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
  plan_hash TEXT NOT NULL UNIQUE CHECK (
    length(plan_hash) = 71 AND
    substr(plan_hash, 1, 7) = 'sha256:' AND
    substr(plan_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  created_at_ms INTEGER NOT NULL CHECK (
    typeof(created_at_ms) = 'integer' AND
    created_at_ms BETWEEN 0 AND effective_from_ms
  )
) STRICT;

CREATE INDEX publication_run_plan_effective_idx
ON publication_run_plan(
  environment, schedule_name, effective_from_ms, effective_to_ms, run_plan_id
);

CREATE TABLE publication_run_plan_provider (
  run_plan_id TEXT NOT NULL
    REFERENCES publication_run_plan(run_plan_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (
    typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 15
  ),
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT
    CHECK (
      length(provider_id) = 40 AND
      substr(provider_id, 1, 4) = 'prv_' AND
      provider_id = lower(provider_id) AND
      substr(provider_id, 13, 1) = '-' AND
      substr(provider_id, 18, 1) = '-' AND
      substr(provider_id, 19, 1) = '4' AND
      substr(provider_id, 23, 1) = '-' AND
      substr(provider_id, 24, 1) IN ('8', '9', 'a', 'b') AND
      substr(provider_id, 28, 1) = '-' AND
      substr(provider_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
      substr(provider_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(provider_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(provider_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(provider_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
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
    length(roster_content_hash) = 71 AND
    substr(roster_content_hash, 1, 7) = 'sha256:' AND
    substr(roster_content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  source_register_version TEXT NOT NULL CHECK (
    length(source_register_version) BETWEEN 1 AND 128 AND
    source_register_version NOT GLOB '*[^ -~]*'
  ),
  source_artifact_hash TEXT NOT NULL CHECK (
    length(source_artifact_hash) = 71 AND
    substr(source_artifact_hash, 1, 7) = 'sha256:' AND
    substr(source_artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  request_ceiling INTEGER NOT NULL CHECK (
    typeof(request_ceiling) = 'integer' AND
    request_ceiling BETWEEN 0 AND 9007199254740991
  ),
  byte_ceiling INTEGER NOT NULL CHECK (
    typeof(byte_ceiling) = 'integer' AND
    byte_ceiling BETWEEN 0 AND 9007199254740991
  ),
  ai_token_ceiling INTEGER NOT NULL CHECK (
    typeof(ai_token_ceiling) = 'integer' AND
    ai_token_ceiling BETWEEN 0 AND 9007199254740991
  ),
  browser_millisecond_ceiling INTEGER NOT NULL CHECK (
    typeof(browser_millisecond_ceiling) = 'integer' AND
    browser_millisecond_ceiling BETWEEN 0 AND 9007199254740991
  ),
  elapsed_millisecond_ceiling INTEGER NOT NULL CHECK (
    typeof(elapsed_millisecond_ceiling) = 'integer' AND
    elapsed_millisecond_ceiling BETWEEN 0 AND 9007199254740991
  ),
  cost_microusd_ceiling INTEGER NOT NULL CHECK (
    typeof(cost_microusd_ceiling) = 'integer' AND
    cost_microusd_ceiling BETWEEN 0 AND 9007199254740991
  ),
  retry_policy_hash TEXT NOT NULL CHECK (
    length(retry_policy_hash) = 71 AND
    substr(retry_policy_hash, 1, 7) = 'sha256:' AND
    substr(retry_policy_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (run_plan_id, provider_id),
  FOREIGN KEY (provider_id, roster_version)
    REFERENCES provider_roster(provider_id, roster_version) ON DELETE RESTRICT,
  FOREIGN KEY (provider_id, source_register_version)
    REFERENCES source_compliance_record(provider_id, register_version)
    ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX publication_run_plan_provider_ordinal_uq
ON publication_run_plan_provider(run_plan_id, ordinal);

CREATE TABLE publication_run_plan_policy (
  run_plan_id TEXT NOT NULL
    REFERENCES publication_run_plan(run_plan_id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (
    role IN ('run_budget', 'provider_retry', 'terminal_deadline')
  ),
  policy_version TEXT NOT NULL CHECK (
    length(policy_version) BETWEEN 1 AND 128 AND
    policy_version NOT GLOB '*[^ -~]*'
  ),
  policy_hash TEXT NOT NULL CHECK (
    length(policy_hash) = 71 AND
    substr(policy_hash, 1, 7) = 'sha256:' AND
    substr(policy_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (run_plan_id, role)
) STRICT;

CREATE TABLE publication_run_plan_seal (
  run_plan_id TEXT PRIMARY KEY
    REFERENCES publication_run_plan(run_plan_id) ON DELETE RESTRICT,
  contract_version TEXT NOT NULL
    CHECK (contract_version = 'publication-run-plan@1'),
  provider_count INTEGER NOT NULL CHECK (
    typeof(provider_count) = 'integer' AND provider_count BETWEEN 1 AND 16
  ),
  provider_scope_hash TEXT NOT NULL CHECK (
    length(provider_scope_hash) = 71 AND
    substr(provider_scope_hash, 1, 7) = 'sha256:' AND
    substr(provider_scope_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  policy_count INTEGER NOT NULL CHECK (policy_count = 3),
  policy_set_hash TEXT NOT NULL CHECK (
    length(policy_set_hash) = 71 AND
    substr(policy_set_hash, 1, 7) = 'sha256:' AND
    substr(policy_set_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  plan_hash TEXT NOT NULL UNIQUE CHECK (
    length(plan_hash) = 71 AND
    substr(plan_hash, 1, 7) = 'sha256:' AND
    substr(plan_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  sealed_at_ms INTEGER NOT NULL CHECK (
    typeof(sealed_at_ms) = 'integer' AND
    sealed_at_ms BETWEEN 0 AND 8640000000000000
  )
) STRICT;

CREATE TABLE publication_run_plan_approval (
  run_plan_id TEXT PRIMARY KEY
    REFERENCES publication_run_plan_seal(run_plan_id) ON DELETE RESTRICT,
  approval_roles_json TEXT NOT NULL CHECK (
    approval_roles_json =
      '["legal_source_owner","platform_owner","product_owner"]'
  ),
  artifact_path TEXT NOT NULL CHECK (
    length(artifact_path) BETWEEN 28 AND 512 AND
    artifact_path GLOB 'docs/compliance/run-plans/*' AND
    artifact_path NOT GLOB '*[^ -~]*' AND
    instr(artifact_path, '..') = 0 AND
    instr(artifact_path, '?') = 0 AND
    instr(artifact_path, '#') = 0 AND
    instr(artifact_path, '@') = 0
  ),
  artifact_hash TEXT NOT NULL CHECK (
    length(artifact_hash) = 71 AND
    substr(artifact_hash, 1, 7) = 'sha256:' AND
    substr(artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  approved_at_ms INTEGER NOT NULL CHECK (
    typeof(approved_at_ms) = 'integer' AND
    approved_at_ms BETWEEN 0 AND 8640000000000000
  )
) STRICT;

CREATE TABLE publication_run_plan_revocation (
  run_plan_id TEXT PRIMARY KEY
    REFERENCES publication_run_plan_approval(run_plan_id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'integrity_failure',
    'legal_source_revoked',
    'platform_authority_revoked',
    'product_authority_revoked',
    'superseded'
  )),
  effective_at_ms INTEGER NOT NULL CHECK (
    typeof(effective_at_ms) = 'integer' AND
    effective_at_ms BETWEEN 0 AND 8640000000000000
  )
) STRICT;

CREATE TRIGGER publication_run_plan_authority_integrity_metadata_insert_guard
BEFORE INSERT ON publication_run_plan_authority_integrity_metadata
WHEN EXISTS (SELECT 1 FROM publication_run_plan_authority_integrity_metadata)
BEGIN
  SELECT RAISE(ABORT, 'publication run-plan authority capability cannot be replaced');
END;

CREATE TRIGGER publication_run_plan_authority_integrity_metadata_immutable_update
BEFORE UPDATE ON publication_run_plan_authority_integrity_metadata
BEGIN
  SELECT RAISE(ABORT, 'publication run-plan authority capability is immutable');
END;

CREATE TRIGGER publication_run_plan_authority_integrity_metadata_immutable_delete
BEFORE DELETE ON publication_run_plan_authority_integrity_metadata
BEGIN
  SELECT RAISE(ABORT, 'publication run-plan authority capability cannot be deleted');
END;

CREATE TRIGGER publication_run_plan_insert_guard
BEFORE INSERT ON publication_run_plan
WHEN EXISTS (
  SELECT 1 FROM publication_run_plan
  WHERE run_plan_id = NEW.run_plan_id OR plan_hash = NEW.plan_hash
)
BEGIN
  SELECT RAISE(ABORT, 'publication run plan cannot be replaced');
END;

CREATE TRIGGER publication_run_plan_immutable_update
BEFORE UPDATE ON publication_run_plan
BEGIN SELECT RAISE(ABORT, 'publication run plan is immutable'); END;

CREATE TRIGGER publication_run_plan_immutable_delete
BEFORE DELETE ON publication_run_plan
BEGIN SELECT RAISE(ABORT, 'publication run plan cannot be deleted'); END;

CREATE TRIGGER publication_run_plan_provider_insert_guard
BEFORE INSERT ON publication_run_plan_provider
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_run_plan_seal
    WHERE run_plan_id = NEW.run_plan_id
  ) THEN RAISE(ABORT, 'sealed publication run plan cannot accept providers') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_run_plan_provider
    WHERE run_plan_id = NEW.run_plan_id
      AND (provider_id = NEW.provider_id OR ordinal = NEW.ordinal)
  ) THEN RAISE(ABORT, 'publication run-plan provider cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM provider_roster
    WHERE provider_id = NEW.provider_id
      AND roster_version = NEW.roster_version
      AND content_hash = NEW.roster_content_hash
  ) THEN RAISE(ABORT, 'publication run-plan provider lacks exact roster') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM source_compliance_record
    WHERE provider_id = NEW.provider_id
      AND register_version = NEW.source_register_version
      AND artifact_hash = NEW.source_artifact_hash
  ) THEN RAISE(ABORT, 'publication run-plan provider lacks exact source register') END;
END;

CREATE TRIGGER publication_run_plan_provider_immutable_update
BEFORE UPDATE ON publication_run_plan_provider
BEGIN SELECT RAISE(ABORT, 'publication run-plan provider is immutable'); END;

CREATE TRIGGER publication_run_plan_provider_immutable_delete
BEFORE DELETE ON publication_run_plan_provider
BEGIN SELECT RAISE(ABORT, 'publication run-plan provider cannot be deleted'); END;

-- Roster headers are immutable, but their item sets otherwise remain open until
-- a provider run exists. Plan membership is an earlier authority boundary: the
-- exact roster named by any plan cannot grow after it has been referenced.
CREATE TRIGGER provider_roster_item_run_plan_frozen_insert
BEFORE INSERT ON provider_roster_item
WHEN EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = NEW.provider_id
    AND roster_version = NEW.roster_version
)
BEGIN
  SELECT RAISE(ABORT, 'run-plan-referenced provider roster cannot grow');
END;

CREATE TRIGGER provider_roster_run_plan_frozen_update
BEFORE UPDATE ON provider_roster
WHEN EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = OLD.provider_id
    AND roster_version = OLD.roster_version
)
OR EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = NEW.provider_id
    AND roster_version = NEW.roster_version
)
BEGIN
  SELECT RAISE(ABORT, 'run-plan-referenced provider roster is immutable');
END;

CREATE TRIGGER provider_roster_run_plan_frozen_delete
BEFORE DELETE ON provider_roster
WHEN EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = OLD.provider_id
    AND roster_version = OLD.roster_version
)
BEGIN
  SELECT RAISE(ABORT, 'run-plan-referenced provider roster cannot be deleted');
END;

CREATE TRIGGER provider_roster_item_run_plan_frozen_update
BEFORE UPDATE ON provider_roster_item
WHEN EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = OLD.provider_id
    AND roster_version = OLD.roster_version
)
OR EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = NEW.provider_id
    AND roster_version = NEW.roster_version
)
BEGIN
  SELECT RAISE(ABORT, 'run-plan-referenced provider roster item is immutable');
END;

CREATE TRIGGER provider_roster_item_run_plan_frozen_delete
BEFORE DELETE ON provider_roster_item
WHEN EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = OLD.provider_id
    AND roster_version = OLD.roster_version
)
BEGIN
  SELECT RAISE(ABORT, 'run-plan-referenced provider roster item cannot be deleted');
END;

CREATE TRIGGER source_compliance_run_plan_frozen_update
BEFORE UPDATE ON source_compliance_record
WHEN EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = OLD.provider_id
    AND source_register_version = OLD.register_version
)
OR EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = NEW.provider_id
    AND source_register_version = NEW.register_version
)
BEGIN
  SELECT RAISE(ABORT, 'run-plan-referenced source compliance is immutable');
END;

CREATE TRIGGER source_compliance_run_plan_frozen_delete
BEFORE DELETE ON source_compliance_record
WHEN EXISTS (
  SELECT 1 FROM publication_run_plan_provider
  WHERE provider_id = OLD.provider_id
    AND source_register_version = OLD.register_version
)
BEGIN
  SELECT RAISE(ABORT, 'run-plan-referenced source compliance cannot be deleted');
END;

CREATE TRIGGER publication_run_plan_policy_insert_guard
BEFORE INSERT ON publication_run_plan_policy
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_run_plan_seal
    WHERE run_plan_id = NEW.run_plan_id
  ) THEN RAISE(ABORT, 'sealed publication run plan cannot accept policies') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_run_plan_policy
    WHERE run_plan_id = NEW.run_plan_id AND role = NEW.role
  ) THEN RAISE(ABORT, 'publication run-plan policy cannot be replaced') END;
END;

CREATE TRIGGER publication_run_plan_policy_immutable_update
BEFORE UPDATE ON publication_run_plan_policy
BEGIN SELECT RAISE(ABORT, 'publication run-plan policy is immutable'); END;

CREATE TRIGGER publication_run_plan_policy_immutable_delete
BEFORE DELETE ON publication_run_plan_policy
BEGIN SELECT RAISE(ABORT, 'publication run-plan policy cannot be deleted'); END;

CREATE TRIGGER publication_run_plan_seal_insert_guard
BEFORE INSERT ON publication_run_plan_seal
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_run_plan_seal
    WHERE run_plan_id = NEW.run_plan_id OR plan_hash = NEW.plan_hash
  ) THEN RAISE(ABORT, 'publication run-plan seal cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_run_plan AS plan
    WHERE plan.run_plan_id = NEW.run_plan_id
      AND plan.contract_version = NEW.contract_version
      AND plan.provider_count = NEW.provider_count
      AND plan.provider_scope_hash = NEW.provider_scope_hash
      AND plan.policy_set_hash = NEW.policy_set_hash
      AND plan.plan_hash = NEW.plan_hash
      AND NEW.sealed_at_ms >= plan.created_at_ms
      AND NEW.sealed_at_ms <= plan.effective_from_ms
  ) THEN RAISE(ABORT, 'publication run-plan seal does not match its plan') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_run_plan_provider
    WHERE run_plan_id = NEW.run_plan_id
  ) <> NEW.provider_count OR (
    SELECT min(ordinal) FROM publication_run_plan_provider
    WHERE run_plan_id = NEW.run_plan_id
  ) <> 0 OR (
    SELECT max(ordinal) FROM publication_run_plan_provider
    WHERE run_plan_id = NEW.run_plan_id
  ) <> NEW.provider_count - 1
  THEN RAISE(ABORT, 'publication run-plan provider scope is incomplete') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM publication_run_plan_provider AS earlier
    JOIN publication_run_plan_provider AS later
      ON later.run_plan_id = earlier.run_plan_id
     AND later.ordinal > earlier.ordinal
    WHERE earlier.run_plan_id = NEW.run_plan_id
      AND earlier.provider_id >= later.provider_id
  ) THEN RAISE(ABORT, 'publication run-plan providers are not canonically ordered') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_run_plan_policy
    WHERE run_plan_id = NEW.run_plan_id
  ) <> 3 OR NOT EXISTS (
    SELECT 1 FROM publication_run_plan_policy
    WHERE run_plan_id = NEW.run_plan_id AND role = 'run_budget'
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_run_plan_policy
    WHERE run_plan_id = NEW.run_plan_id AND role = 'provider_retry'
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_run_plan_policy
    WHERE run_plan_id = NEW.run_plan_id AND role = 'terminal_deadline'
  ) THEN RAISE(ABORT, 'publication run-plan policy set is incomplete') END;
END;

CREATE TRIGGER publication_run_plan_seal_immutable_update
BEFORE UPDATE ON publication_run_plan_seal
BEGIN SELECT RAISE(ABORT, 'publication run-plan seal is immutable'); END;

CREATE TRIGGER publication_run_plan_seal_immutable_delete
BEFORE DELETE ON publication_run_plan_seal
BEGIN SELECT RAISE(ABORT, 'publication run-plan seal cannot be deleted'); END;

CREATE TRIGGER publication_run_plan_approval_insert_guard
BEFORE INSERT ON publication_run_plan_approval
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_run_plan_approval
    WHERE run_plan_id = NEW.run_plan_id
  ) THEN RAISE(ABORT, 'publication run-plan approval cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_run_plan_seal AS seal
    JOIN publication_run_plan AS plan USING (run_plan_id)
    WHERE seal.run_plan_id = NEW.run_plan_id
      AND NEW.approved_at_ms >= seal.sealed_at_ms
      AND NEW.approved_at_ms <= plan.effective_from_ms
  ) THEN RAISE(ABORT, 'publication run-plan approval lacks a timely seal') END;
END;

CREATE TRIGGER publication_run_plan_approval_immutable_update
BEFORE UPDATE ON publication_run_plan_approval
BEGIN SELECT RAISE(ABORT, 'publication run-plan approval is immutable'); END;

CREATE TRIGGER publication_run_plan_approval_immutable_delete
BEFORE DELETE ON publication_run_plan_approval
BEGIN SELECT RAISE(ABORT, 'publication run-plan approval cannot be deleted'); END;

CREATE TRIGGER publication_run_plan_revocation_insert_guard
BEFORE INSERT ON publication_run_plan_revocation
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_run_plan_revocation
    WHERE run_plan_id = NEW.run_plan_id
  ) THEN RAISE(ABORT, 'publication run-plan revocation cannot be replaced') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_run_plan_approval
    WHERE run_plan_id = NEW.run_plan_id
      AND NEW.effective_at_ms >= approved_at_ms
  ) THEN RAISE(ABORT, 'publication run-plan revocation precedes approval') END;
END;

CREATE TRIGGER publication_run_plan_revocation_immutable_update
BEFORE UPDATE ON publication_run_plan_revocation
BEGIN SELECT RAISE(ABORT, 'publication run-plan revocation is immutable'); END;

CREATE TRIGGER publication_run_plan_revocation_immutable_delete
BEFORE DELETE ON publication_run_plan_revocation
BEGIN SELECT RAISE(ABORT, 'publication run-plan revocation cannot be deleted'); END;
