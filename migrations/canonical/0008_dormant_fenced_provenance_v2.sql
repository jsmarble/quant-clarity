-- Dormant physical foundation for fenced provenance-v2 authority.
-- Every runtime insert remains unconditionally blocked in this migration.
-- Requirements: DATA-030–DATA-046, DATA-048–DATA-051, DATA-055–DATA-061,
-- PIPE-010–PIPE-022, PIPE-030–PIPE-045, PIPE-050–PIPE-056, BE-005,
-- SEC-011–SEC-012, PRIV-006–PRIV-007, PRIV-011, QA-006, QA-010, QA-012.

PRAGMA defer_foreign_keys = true;

-- Install only over the exact local migration-0007 authority boundary.
SELECT CASE WHEN (
  SELECT count(*) FROM schema_metadata
) <> 1 OR (
  SELECT count(*) FROM publication_run_plan_authority_integrity_metadata
  WHERE singleton = 1 AND capability = 'publication-run-plan-authority@1'
) <> 1 OR (
  SELECT count(*) FROM schema_metadata
  WHERE singleton = 1 AND schema_version = '1.0.0'
) <> 1 OR (
  SELECT count(*) FROM publication_orchestration_integrity_metadata
  WHERE singleton = 1 AND capability = 'publication-orchestration-ledger@1'
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_run_plan_revocation_admitted_history_guard'
    AND tbl_name = 'publication_run_plan_revocation'
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name IN (
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
    'publication_roster_outcome_source_execution_blocked'
  )
) <> 24 OR EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name GLOB 'legacy_*'
    AND name IN (
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
      'legacy_quarantine_delete_disabled'
    ) AND (
      sql IS NULL OR
      instr(sql, 'publication_orchestration_environment') = 0 OR
      instr(sql, 'RAISE(ABORT') = 0
    )
) OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_roster_outcome_source_execution_blocked'
    AND tbl_name = 'publication_roster_operational_outcome'
    AND instr(sql, 'source-backed outcomes require provenance-v2 authority') > 0
) <> 1
THEN json('') END;

-- The 23 legacy freeze triggers are small and uniform, so compare their full
-- normalized sqlite_schema SQL rather than trusting names or substrings.
WITH expected(name, table_name, event_name, failure_message) AS (VALUES
  ('legacy_pipeline_run_disabled', 'pipeline_run', 'INSERT', 'legacy pipeline run graph is disabled'),
  ('legacy_pipeline_run_update_disabled', 'pipeline_run', 'UPDATE', 'legacy pipeline run graph is disabled'),
  ('legacy_provider_run_disabled', 'provider_run', 'INSERT', 'legacy provider run graph is disabled'),
  ('legacy_provider_run_update_disabled', 'provider_run', 'UPDATE', 'legacy provider run graph is disabled'),
  ('legacy_acquisition_run_disabled', 'acquisition_run', 'INSERT', 'legacy acquisition graph is disabled'),
  ('legacy_acquisition_run_update_disabled', 'acquisition_run', 'UPDATE', 'legacy acquisition graph is disabled'),
  ('legacy_roster_outcome_disabled', 'roster_outcome', 'INSERT', 'legacy roster outcomes are disabled'),
  ('legacy_observation_disabled', 'observation', 'INSERT', 'legacy observations require provenance-v2 authority'),
  ('legacy_evidence_disabled', 'evidence', 'INSERT', 'legacy evidence requires provenance-v2 authority'),
  ('legacy_field_claim_disabled', 'field_claim', 'INSERT', 'legacy field claims require provenance-v2 authority'),
  ('legacy_claim_conflict_disabled', 'claim_conflict', 'INSERT', 'legacy claim conflicts require provenance-v2 authority'),
  ('legacy_parameter_fact_disabled', 'parameter_fact', 'INSERT', 'legacy parameter facts require provenance-v2 authority'),
  ('legacy_parameter_fact_update_disabled', 'parameter_fact', 'UPDATE', 'legacy parameter facts require provenance-v2 authority'),
  ('legacy_parameter_fact_delete_disabled', 'parameter_fact', 'DELETE', 'legacy parameter facts require provenance-v2 authority'),
  ('legacy_precision_observation_disabled', 'precision_observation', 'INSERT', 'legacy precision observations require provenance-v2 authority'),
  ('legacy_precision_component_disabled', 'precision_component', 'INSERT', 'legacy precision components require provenance-v2 authority'),
  ('legacy_price_schedule_disabled', 'price_schedule', 'INSERT', 'legacy price schedules require provenance-v2 authority'),
  ('legacy_anomaly_disabled', 'anomaly', 'INSERT', 'legacy anomalies require provenance-v2 authority'),
  ('legacy_anomaly_update_disabled', 'anomaly', 'UPDATE', 'legacy anomalies require provenance-v2 authority'),
  ('legacy_anomaly_delete_disabled', 'anomaly', 'DELETE', 'legacy anomalies require provenance-v2 authority'),
  ('legacy_quarantine_disabled', 'quarantine', 'INSERT', 'legacy quarantines require provenance-v2 authority'),
  ('legacy_quarantine_update_disabled', 'quarantine', 'UPDATE', 'legacy quarantines require provenance-v2 authority'),
  ('legacy_quarantine_delete_disabled', 'quarantine', 'DELETE', 'legacy quarantines require provenance-v2 authority')
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM expected
  LEFT JOIN sqlite_schema AS actual
    ON actual.type = 'trigger' AND actual.name = expected.name
  WHERE actual.tbl_name IS NOT expected.table_name OR actual.sql IS NOT (
    'CREATE TRIGGER ' || expected.name || ' BEFORE ' || expected.event_name ||
    ' ON ' || expected.table_name || char(10) ||
    'WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)' || char(10) ||
    'BEGIN SELECT RAISE(ABORT, ''' || expected.failure_message || '''); END'
  )
) THEN json('') END;

-- The source-backed outcome blocker is also short enough for exact comparison.
SELECT CASE WHEN (
  SELECT sql FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_roster_outcome_source_execution_blocked'
    AND tbl_name = 'publication_roster_operational_outcome'
) IS NOT (
  'CREATE TRIGGER publication_roster_outcome_source_execution_blocked' || char(10) ||
  'BEFORE INSERT ON publication_roster_operational_outcome' || char(10) ||
  'WHEN NEW.status IN (''published_candidate'', ''published_candidate_with_unknowns'')' || char(10) ||
  'BEGIN SELECT RAISE(ABORT, ''source-backed outcomes require provenance-v2 authority''); END'
) THEN json('') END;

-- Bind every predecessor guard relied on by this authority boundary. Each
-- guard's type, name, table, and exact sqlite_schema SQL feed four independent
-- rolling lanes; count and aggregate length make omission/addition fail closed.
WITH RECURSIVE
source(object_key, input) AS (
  SELECT type || char(31) || name,
    type || char(31) || name || char(31) || tbl_name || char(31) || coalesce(sql, '')
  FROM sqlite_schema
  WHERE type = 'trigger' AND (
    name GLOB 'publication_*' OR name GLOB 'legacy_*' OR
    name GLOB 'schedule_occurrence_orchestration_*' OR
    name GLOB 'provider_roster*run_plan_frozen_*' OR
    name GLOB 'source_compliance_run_plan_frozen_*'
  )
),
digest(object_key, input, position, lane_a, lane_b, lane_c, lane_d) AS (
  SELECT object_key, input, 1, 0, 0, 0, 0 FROM source
  UNION ALL
  SELECT object_key, input, position + 1,
    (lane_a * 257 + unicode(substr(input, position, 1))) % 2147483629,
    (lane_b * 65599 + unicode(substr(input, position, 1))) % 2147483587,
    (lane_c * 131071 + unicode(substr(input, position, 1))) % 2147483563,
    (lane_d * 524287 + unicode(substr(input, position, 1))) % 2147483549
  FROM digest WHERE position <= length(input)
),
object_digest AS (
  SELECT object_key, length(input) AS input_length,
    lane_a, lane_b, lane_c, lane_d
  FROM digest WHERE position = length(input) + 1
),
actual AS (
  SELECT count(*) AS object_count, sum(input_length) AS input_length,
    sum(lane_a) % 2147483629 AS lane_a,
    sum(lane_b) % 2147483587 AS lane_b,
    sum(lane_c) % 2147483563 AS lane_c,
    sum(lane_d) % 2147483549 AS lane_d
  FROM object_digest
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM actual WHERE NOT (
    (
      object_count = 105 AND input_length = 95845 AND
      lane_a = 884512470 AND lane_b = 278567098 AND
      lane_c = 846283883 AND lane_d = 175437845
    ) OR (
      object_count = 105 AND input_length = 95120 AND
      lane_a = 1184170414 AND lane_b = 1177013007 AND
      lane_c = 1673190829 AND lane_d = 487112043
    )
  )
)
THEN json('') END;

-- Initialized databases cannot install over an active legacy source owner.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication_orchestration_environment
) AND (
  EXISTS (SELECT 1 FROM pipeline_run WHERE status IN ('pending', 'running')) OR
  EXISTS (SELECT 1 FROM provider_run WHERE status IN ('pending', 'running')) OR
  EXISTS (SELECT 1 FROM acquisition_run WHERE status IN ('pending', 'running'))
) THEN json('') END;

-- A same-name object of any SQLite kind is an authority-boundary collision.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema WHERE name IN (
    'provenance_v2_integrity_metadata',
    'provenance_v2_installation_identity',
    'provenance_v2_authority_plan',
    'provenance_v2_authority_plan_seal',
    'provenance_v2_authority_plan_approval',
    'provenance_v2_source_endpoint',
    'provenance_v2_provider_bundle',
    'provenance_v2_acquisition_permit',
    'provenance_v2_admitted_response',
    'provenance_v2_environment_exact_uq',
    'provenance_v2_run_plan_exact_uq',
    'provenance_v2_coordination_run_exact_uq',
    'provenance_v2_provider_run_exact_uq',
    'provenance_v2_fence_claim_exact_uq',
    'provenance_v2_source_register_exact_uq',
    'provenance_v2_integrity_metadata_insert_guard',
    'provenance_v2_integrity_metadata_immutable_update',
    'provenance_v2_integrity_metadata_immutable_delete',
    'provenance_v2_installation_identity_activation_blocked',
    'provenance_v2_installation_identity_immutable_update',
    'provenance_v2_installation_identity_immutable_delete',
    'provenance_v2_authority_plan_activation_blocked',
    'provenance_v2_authority_plan_immutable_update',
    'provenance_v2_authority_plan_immutable_delete',
    'provenance_v2_authority_plan_seal_activation_blocked',
    'provenance_v2_authority_plan_seal_immutable_update',
    'provenance_v2_authority_plan_seal_immutable_delete',
    'provenance_v2_authority_plan_approval_activation_blocked',
    'provenance_v2_authority_plan_approval_immutable_update',
    'provenance_v2_authority_plan_approval_immutable_delete',
    'provenance_v2_source_endpoint_activation_blocked',
    'provenance_v2_source_endpoint_immutable_update',
    'provenance_v2_source_endpoint_immutable_delete',
    'provenance_v2_provider_bundle_activation_blocked',
    'provenance_v2_provider_bundle_immutable_update',
    'provenance_v2_provider_bundle_immutable_delete',
    'provenance_v2_acquisition_permit_activation_blocked',
    'provenance_v2_acquisition_permit_immutable_update',
    'provenance_v2_acquisition_permit_immutable_delete',
    'provenance_v2_admitted_response_activation_blocked',
    'provenance_v2_admitted_response_immutable_update',
    'provenance_v2_admitted_response_immutable_delete'
  )
) THEN json('') END;

CREATE TABLE provenance_v2_integrity_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  capability TEXT NOT NULL CHECK (capability = 'fenced-provenance-v2@1'),
  predecessor_capability TEXT NOT NULL
    CHECK (predecessor_capability = 'publication-orchestration-ledger@1'),
  hash_domain TEXT NOT NULL CHECK (hash_domain = 'quantclarity:provenance-v2:v1'),
  vocabulary_version TEXT NOT NULL CHECK (vocabulary_version = 'provenance-v2-vocabulary@1'),
  writer_contract_version TEXT NOT NULL CHECK (writer_contract_version = 'provenance-v2-writer@1')
) STRICT;

INSERT INTO provenance_v2_integrity_metadata VALUES (
  1,
  'fenced-provenance-v2@1',
  'publication-orchestration-ledger@1',
  'quantclarity:provenance-v2:v1',
  'provenance-v2-vocabulary@1',
  'provenance-v2-writer@1'
);

-- Additive exact-tuple parents prevent later child tables from splicing
-- independently valid coordination identities.
CREATE UNIQUE INDEX provenance_v2_environment_exact_uq
ON publication_orchestration_environment(environment);
CREATE UNIQUE INDEX provenance_v2_run_plan_exact_uq
ON publication_run_plan(run_plan_id, plan_hash);
CREATE UNIQUE INDEX provenance_v2_coordination_run_exact_uq
ON publication_coordination_run(run_id, occurrence_id, attempt_number);
CREATE UNIQUE INDEX provenance_v2_provider_run_exact_uq
ON publication_coordination_provider_run(provider_run_id, run_id, provider_id);
CREATE UNIQUE INDEX provenance_v2_fence_claim_exact_uq
ON publication_provider_fence_claim(
  environment, provider_id, generation, provider_run_id
);
CREATE UNIQUE INDEX provenance_v2_source_register_exact_uq
ON source_compliance_record(provider_id, register_version, artifact_hash);

CREATE TABLE provenance_v2_installation_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  installation_id TEXT NOT NULL UNIQUE CHECK (
    length(installation_id) = 40 AND substr(installation_id, 1, 4) = 'pvi_' AND
    installation_id = lower(installation_id) AND
    substr(installation_id, 13, 1) = '-' AND substr(installation_id, 18, 1) = '-' AND
    substr(installation_id, 19, 1) = '4' AND substr(installation_id, 23, 1) = '-' AND
    substr(installation_id, 24, 1) IN ('8', '9', 'a', 'b') AND substr(installation_id, 28, 1) = '-' AND
    substr(installation_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(installation_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(installation_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(installation_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(installation_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  initialized_at_ms INTEGER NOT NULL CHECK (
    typeof(initialized_at_ms) = 'integer' AND initialized_at_ms BETWEEN 0 AND 253402300799999
  ),
  UNIQUE (installation_id, environment),
  FOREIGN KEY (environment)
    REFERENCES publication_orchestration_environment(environment)
    ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_authority_plan (
  authority_plan_id TEXT PRIMARY KEY CHECK (
    length(authority_plan_id) = 40 AND substr(authority_plan_id, 1, 4) = 'vpa_' AND
    authority_plan_id = lower(authority_plan_id) AND
    substr(authority_plan_id, 13, 1) = '-' AND substr(authority_plan_id, 18, 1) = '-' AND
    substr(authority_plan_id, 19, 1) = '4' AND substr(authority_plan_id, 23, 1) = '-' AND
    substr(authority_plan_id, 24, 1) IN ('8', '9', 'a', 'b') AND substr(authority_plan_id, 28, 1) = '-' AND
    substr(authority_plan_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(authority_plan_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(authority_plan_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(authority_plan_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(authority_plan_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  installation_id TEXT NOT NULL REFERENCES provenance_v2_installation_identity(installation_id) ON DELETE RESTRICT,
  run_plan_id TEXT NOT NULL UNIQUE REFERENCES publication_run_plan_approval(run_plan_id) ON DELETE RESTRICT,
  run_plan_hash TEXT NOT NULL CHECK (
    length(run_plan_hash) = 71 AND substr(run_plan_hash, 1, 7) = 'sha256:' AND
    substr(run_plan_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  endpoint_set_root TEXT NOT NULL CHECK (
    length(endpoint_set_root) = 71 AND substr(endpoint_set_root, 1, 7) = 'sha256:' AND
    substr(endpoint_set_root, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  field_policy_set_root TEXT NOT NULL CHECK (
    length(field_policy_set_root) = 71 AND substr(field_policy_set_root, 1, 7) = 'sha256:' AND
    substr(field_policy_set_root, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  verifier_policy_set_root TEXT NOT NULL CHECK (
    length(verifier_policy_set_root) = 71 AND substr(verifier_policy_set_root, 1, 7) = 'sha256:' AND
    substr(verifier_policy_set_root, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  adapter_manifest_set_root TEXT NOT NULL CHECK (
    length(adapter_manifest_set_root) = 71 AND substr(adapter_manifest_set_root, 1, 7) = 'sha256:' AND
    substr(adapter_manifest_set_root, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  effective_from_ms INTEGER NOT NULL CHECK (
    typeof(effective_from_ms) = 'integer' AND effective_from_ms BETWEEN 0 AND 253402300799999
  ),
  effective_to_ms INTEGER NOT NULL CHECK (
    typeof(effective_to_ms) = 'integer' AND effective_to_ms BETWEEN 1 AND 253402300799999
  ),
  created_at_ms INTEGER NOT NULL CHECK (
    typeof(created_at_ms) = 'integer' AND created_at_ms BETWEEN 0 AND 253402300799999
  ),
  CHECK (effective_from_ms < effective_to_ms),
  CHECK (created_at_ms <= effective_from_ms),
  UNIQUE (authority_plan_id, installation_id),
  FOREIGN KEY (run_plan_id, run_plan_hash)
    REFERENCES publication_run_plan(run_plan_id, plan_hash)
    ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_authority_plan_seal (
  authority_plan_id TEXT PRIMARY KEY REFERENCES provenance_v2_authority_plan(authority_plan_id) ON DELETE RESTRICT,
  endpoint_count INTEGER NOT NULL CHECK (typeof(endpoint_count) = 'integer' AND endpoint_count BETWEEN 1 AND 512),
  field_policy_count INTEGER NOT NULL CHECK (typeof(field_policy_count) = 'integer' AND field_policy_count BETWEEN 1 AND 512),
  verifier_policy_count INTEGER NOT NULL CHECK (typeof(verifier_policy_count) = 'integer' AND verifier_policy_count BETWEEN 1 AND 512),
  adapter_manifest_count INTEGER NOT NULL CHECK (typeof(adapter_manifest_count) = 'integer' AND adapter_manifest_count BETWEEN 1 AND 16),
  authority_root TEXT NOT NULL UNIQUE CHECK (
    length(authority_root) = 71 AND substr(authority_root, 1, 7) = 'sha256:' AND
    substr(authority_root, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  sealed_at_ms INTEGER NOT NULL CHECK (
    typeof(sealed_at_ms) = 'integer' AND sealed_at_ms BETWEEN 0 AND 253402300799999
  )
) STRICT;

CREATE TABLE provenance_v2_authority_plan_approval (
  authority_plan_id TEXT PRIMARY KEY REFERENCES provenance_v2_authority_plan_seal(authority_plan_id) ON DELETE RESTRICT,
  artifact_hash TEXT NOT NULL CHECK (
    length(artifact_hash) = 71 AND substr(artifact_hash, 1, 7) = 'sha256:' AND
    substr(artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  approval_roles_json TEXT NOT NULL CHECK (
    approval_roles_json = '["legal_source_owner","platform_owner","product_owner"]'
  ),
  approved_at_ms INTEGER NOT NULL CHECK (
    typeof(approved_at_ms) = 'integer' AND approved_at_ms BETWEEN 0 AND 253402300799999
  )
) STRICT;

CREATE TABLE provenance_v2_source_endpoint (
  endpoint_id TEXT PRIMARY KEY CHECK (
    length(endpoint_id) = 40 AND substr(endpoint_id, 1, 4) = 'sep_' AND
    endpoint_id = lower(endpoint_id) AND
    substr(endpoint_id, 13, 1) = '-' AND substr(endpoint_id, 18, 1) = '-' AND
    substr(endpoint_id, 19, 1) = '4' AND substr(endpoint_id, 23, 1) = '-' AND
    substr(endpoint_id, 24, 1) IN ('8', '9', 'a', 'b') AND substr(endpoint_id, 28, 1) = '-' AND
    substr(endpoint_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(endpoint_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(endpoint_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(endpoint_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(endpoint_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  authority_plan_id TEXT NOT NULL REFERENCES provenance_v2_authority_plan(authority_plan_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  source_register_version TEXT NOT NULL CHECK (
    length(CAST(source_register_version AS BLOB)) BETWEEN 1 AND 128 AND
    source_register_version NOT GLOB '*[^ -~]*'
  ),
  source_register_artifact_hash TEXT NOT NULL CHECK (
    length(source_register_artifact_hash) = 71 AND
    substr(source_register_artifact_hash, 1, 7) = 'sha256:' AND
    substr(source_register_artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  source_id TEXT NOT NULL CHECK (
    length(CAST(source_id AS BLOB)) BETWEEN 1 AND 64 AND
    source_id = lower(source_id) AND
    substr(source_id, 1, 1) GLOB '[a-z]' AND
    source_id NOT GLOB '*[^a-z0-9_-]*'
  ),
  adapter_source_type TEXT NOT NULL CHECK (adapter_source_type IN (
    'provider_api', 'authenticated_catalog', 'public_static_page',
    'public_rendered_page', 'publisher_checkpoint_repository'
  )),
  source_owner_organization_id TEXT NOT NULL
    REFERENCES organization(organization_id) ON DELETE RESTRICT CHECK (
    length(source_owner_organization_id) = 40 AND
    substr(source_owner_organization_id, 1, 4) = 'org_' AND
    source_owner_organization_id = lower(source_owner_organization_id) AND
    substr(source_owner_organization_id, 13, 1) = '-' AND
    substr(source_owner_organization_id, 18, 1) = '-' AND
    substr(source_owner_organization_id, 19, 1) = '4' AND
    substr(source_owner_organization_id, 23, 1) = '-' AND
    substr(source_owner_organization_id, 24, 1) IN ('8', '9', 'a', 'b') AND
    substr(source_owner_organization_id, 28, 1) = '-' AND
    substr(source_owner_organization_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(source_owner_organization_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(source_owner_organization_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(source_owner_organization_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(source_owner_organization_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_owner_relationship TEXT NOT NULL CHECK (
    provider_owner_relationship IN ('provider_controlled', 'publisher_controlled', 'independent')
  ),
  host_ascii TEXT NOT NULL CHECK (
    length(CAST(host_ascii AS BLOB)) BETWEEN 1 AND 253 AND
    host_ascii = lower(host_ascii) AND
    host_ascii NOT GLOB '*[^a-z0-9.-]*' AND
    instr(host_ascii, '.') BETWEEN 2 AND 252 AND
    substr(host_ascii, 1, 1) GLOB '[a-z0-9]' AND
    substr(host_ascii, -1, 1) GLOB '[a-z0-9]' AND
    instr(host_ascii, '..') = 0 AND instr(host_ascii, '.-') = 0 AND
    instr(host_ascii, '-.') = 0
  ),
  path_template_hash TEXT NOT NULL CHECK (
    length(path_template_hash) = 71 AND substr(path_template_hash, 1, 7) = 'sha256:' AND
    substr(path_template_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  adapter_manifest_hash TEXT NOT NULL CHECK (
    length(adapter_manifest_hash) = 71 AND substr(adapter_manifest_hash, 1, 7) = 'sha256:' AND
    substr(adapter_manifest_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  endpoint_content_hash TEXT NOT NULL UNIQUE CHECK (
    length(endpoint_content_hash) = 71 AND substr(endpoint_content_hash, 1, 7) = 'sha256:' AND
    substr(endpoint_content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  created_at_ms INTEGER NOT NULL CHECK (
    typeof(created_at_ms) = 'integer' AND created_at_ms BETWEEN 0 AND 253402300799999
  ),
  UNIQUE (authority_plan_id, endpoint_id),
  UNIQUE (authority_plan_id, provider_id, source_id),
  FOREIGN KEY (
    provider_id, source_register_version, source_register_artifact_hash
  ) REFERENCES source_compliance_record(
    provider_id, register_version, artifact_hash
  ) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_provider_bundle (
  bundle_id TEXT PRIMARY KEY CHECK (
    length(bundle_id) = 40 AND substr(bundle_id, 1, 4) = 'pvb_' AND
    bundle_id = lower(bundle_id) AND
    substr(bundle_id, 13, 1) = '-' AND substr(bundle_id, 18, 1) = '-' AND
    substr(bundle_id, 19, 1) = '4' AND substr(bundle_id, 23, 1) = '-' AND
    substr(bundle_id, 24, 1) IN ('8', '9', 'a', 'b') AND substr(bundle_id, 28, 1) = '-' AND
    substr(bundle_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(bundle_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(bundle_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(bundle_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(bundle_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  installation_id TEXT NOT NULL,
  authority_plan_id TEXT NOT NULL REFERENCES provenance_v2_authority_plan_approval(authority_plan_id) ON DELETE RESTRICT,
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  run_id TEXT NOT NULL REFERENCES publication_coordination_run(run_id) ON DELETE RESTRICT,
  occurrence_id TEXT NOT NULL REFERENCES publication_orchestration_occurrence(occurrence_id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (typeof(attempt_number) = 'integer' AND attempt_number >= 1),
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  provider_run_id TEXT NOT NULL UNIQUE REFERENCES publication_coordination_provider_run(provider_run_id) ON DELETE RESTRICT,
  fence_generation INTEGER NOT NULL CHECK (typeof(fence_generation) = 'integer' AND fence_generation >= 1),
  deadline_at_ms INTEGER NOT NULL CHECK (
    typeof(deadline_at_ms) = 'integer' AND deadline_at_ms BETWEEN 1 AND 253402300799999
  ),
  opened_at_ms INTEGER NOT NULL CHECK (
    typeof(opened_at_ms) = 'integer' AND opened_at_ms BETWEEN 0 AND 253402300799999
  ),
  UNIQUE (bundle_id, authority_plan_id),
  FOREIGN KEY (installation_id, environment)
    REFERENCES provenance_v2_installation_identity(installation_id, environment)
    ON DELETE RESTRICT,
  FOREIGN KEY (authority_plan_id, installation_id)
    REFERENCES provenance_v2_authority_plan(authority_plan_id, installation_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (run_id, occurrence_id, attempt_number)
    REFERENCES publication_coordination_run(run_id, occurrence_id, attempt_number)
    ON DELETE RESTRICT,
  FOREIGN KEY (provider_run_id, run_id, provider_id)
    REFERENCES publication_coordination_provider_run(provider_run_id, run_id, provider_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (environment, provider_id, fence_generation, provider_run_id)
    REFERENCES publication_provider_fence_claim(environment, provider_id, generation, provider_run_id)
    ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_acquisition_permit (
  permit_id TEXT PRIMARY KEY CHECK (
    length(permit_id) = 40 AND substr(permit_id, 1, 4) = 'pvp_' AND
    permit_id = lower(permit_id) AND
    substr(permit_id, 13, 1) = '-' AND substr(permit_id, 18, 1) = '-' AND
    substr(permit_id, 19, 1) = '4' AND substr(permit_id, 23, 1) = '-' AND
    substr(permit_id, 24, 1) IN ('8', '9', 'a', 'b') AND substr(permit_id, 28, 1) = '-' AND
    substr(permit_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(permit_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(permit_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(permit_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(permit_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  bundle_id TEXT NOT NULL REFERENCES provenance_v2_provider_bundle(bundle_id) ON DELETE RESTRICT,
  authority_plan_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 9999),
  endpoint_id TEXT NOT NULL,
  request_commitment TEXT NOT NULL CHECK (
    length(request_commitment) = 71 AND substr(request_commitment, 1, 7) = 'sha256:' AND
    substr(request_commitment, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  started_at_ms INTEGER NOT NULL CHECK (
    typeof(started_at_ms) = 'integer' AND started_at_ms BETWEEN 0 AND 253402300799999
  ),
  UNIQUE (bundle_id, ordinal),
  UNIQUE (permit_id, bundle_id),
  FOREIGN KEY (bundle_id, authority_plan_id)
    REFERENCES provenance_v2_provider_bundle(bundle_id, authority_plan_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (authority_plan_id, endpoint_id)
    REFERENCES provenance_v2_source_endpoint(authority_plan_id, endpoint_id)
    ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_admitted_response (
  response_id TEXT PRIMARY KEY CHECK (
    length(response_id) = 40 AND substr(response_id, 1, 4) = 'prs_' AND
    response_id = lower(response_id) AND
    substr(response_id, 13, 1) = '-' AND substr(response_id, 18, 1) = '-' AND
    substr(response_id, 19, 1) = '4' AND substr(response_id, 23, 1) = '-' AND
    substr(response_id, 24, 1) IN ('8', '9', 'a', 'b') AND substr(response_id, 28, 1) = '-' AND
    substr(response_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(response_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(response_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(response_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(response_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  permit_id TEXT NOT NULL UNIQUE,
  bundle_id TEXT NOT NULL,
  retained_bytes_hash TEXT NOT NULL CHECK (
    length(retained_bytes_hash) = 71 AND substr(retained_bytes_hash, 1, 7) = 'sha256:' AND
    substr(retained_bytes_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  retained_byte_count INTEGER NOT NULL CHECK (
    typeof(retained_byte_count) = 'integer' AND retained_byte_count BETWEEN 0 AND 1000000000
  ),
  response_commitment TEXT NOT NULL UNIQUE CHECK (
    length(response_commitment) = 71 AND substr(response_commitment, 1, 7) = 'sha256:' AND
    substr(response_commitment, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  retrieved_at_ms INTEGER NOT NULL CHECK (
    typeof(retrieved_at_ms) = 'integer' AND retrieved_at_ms BETWEEN 0 AND 253402300799999
  ),
  FOREIGN KEY (permit_id, bundle_id)
    REFERENCES provenance_v2_acquisition_permit(permit_id, bundle_id)
    ON DELETE RESTRICT
) STRICT;

-- Static capability is the only row installed by this slice.
CREATE TRIGGER provenance_v2_integrity_metadata_insert_guard
BEFORE INSERT ON provenance_v2_integrity_metadata
BEGIN SELECT RAISE(ABORT, 'provenance-v2 capability cannot be replaced'); END;
CREATE TRIGGER provenance_v2_integrity_metadata_immutable_update
BEFORE UPDATE ON provenance_v2_integrity_metadata
BEGIN SELECT RAISE(ABORT, 'provenance-v2 capability is immutable'); END;
CREATE TRIGGER provenance_v2_integrity_metadata_immutable_delete
BEFORE DELETE ON provenance_v2_integrity_metadata
BEGIN SELECT RAISE(ABORT, 'provenance-v2 capability cannot be deleted'); END;

-- Every runtime path is intentionally dormant until successor migrations add
-- the normalized registrars, validators, and jointly reviewed activation.
CREATE TRIGGER provenance_v2_installation_identity_activation_blocked
BEFORE INSERT ON provenance_v2_installation_identity
BEGIN SELECT RAISE(ABORT, 'provenance-v2 installation initialization is not activated'); END;
CREATE TRIGGER provenance_v2_authority_plan_activation_blocked
BEFORE INSERT ON provenance_v2_authority_plan
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority-plan registration is not activated'); END;
CREATE TRIGGER provenance_v2_authority_plan_seal_activation_blocked
BEFORE INSERT ON provenance_v2_authority_plan_seal
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority-plan sealing is not activated'); END;
CREATE TRIGGER provenance_v2_authority_plan_approval_activation_blocked
BEFORE INSERT ON provenance_v2_authority_plan_approval
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority-plan approval is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source-endpoint registration is not activated'); END;
CREATE TRIGGER provenance_v2_provider_bundle_activation_blocked
BEFORE INSERT ON provenance_v2_provider_bundle
BEGIN SELECT RAISE(ABORT, 'provenance-v2 bundle opening is not activated'); END;
CREATE TRIGGER provenance_v2_acquisition_permit_activation_blocked
BEFORE INSERT ON provenance_v2_acquisition_permit
BEGIN SELECT RAISE(ABORT, 'provenance-v2 acquisition permits are not activated'); END;
CREATE TRIGGER provenance_v2_admitted_response_activation_blocked
BEFORE INSERT ON provenance_v2_admitted_response
BEGIN SELECT RAISE(ABORT, 'provenance-v2 response admission is not activated'); END;

CREATE TRIGGER provenance_v2_installation_identity_immutable_update
BEFORE UPDATE ON provenance_v2_installation_identity
BEGIN SELECT RAISE(ABORT, 'provenance-v2 installation identity is immutable'); END;
CREATE TRIGGER provenance_v2_installation_identity_immutable_delete
BEFORE DELETE ON provenance_v2_installation_identity
BEGIN SELECT RAISE(ABORT, 'provenance-v2 installation identity cannot be deleted'); END;
CREATE TRIGGER provenance_v2_authority_plan_immutable_update
BEFORE UPDATE ON provenance_v2_authority_plan
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan is immutable'); END;
CREATE TRIGGER provenance_v2_authority_plan_immutable_delete
BEFORE DELETE ON provenance_v2_authority_plan
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan cannot be deleted'); END;
CREATE TRIGGER provenance_v2_authority_plan_seal_immutable_update
BEFORE UPDATE ON provenance_v2_authority_plan_seal
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority-plan seal is immutable'); END;
CREATE TRIGGER provenance_v2_authority_plan_seal_immutable_delete
BEFORE DELETE ON provenance_v2_authority_plan_seal
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority-plan seal cannot be deleted'); END;
CREATE TRIGGER provenance_v2_authority_plan_approval_immutable_update
BEFORE UPDATE ON provenance_v2_authority_plan_approval
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority-plan approval is immutable'); END;
CREATE TRIGGER provenance_v2_authority_plan_approval_immutable_delete
BEFORE DELETE ON provenance_v2_authority_plan_approval
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority-plan approval cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint cannot be deleted'); END;
CREATE TRIGGER provenance_v2_provider_bundle_immutable_update
BEFORE UPDATE ON provenance_v2_provider_bundle
BEGIN SELECT RAISE(ABORT, 'provenance-v2 Provider bundle is immutable'); END;
CREATE TRIGGER provenance_v2_provider_bundle_immutable_delete
BEFORE DELETE ON provenance_v2_provider_bundle
BEGIN SELECT RAISE(ABORT, 'provenance-v2 Provider bundle cannot be deleted'); END;
CREATE TRIGGER provenance_v2_acquisition_permit_immutable_update
BEFORE UPDATE ON provenance_v2_acquisition_permit
BEGIN SELECT RAISE(ABORT, 'provenance-v2 acquisition permit is immutable'); END;
CREATE TRIGGER provenance_v2_acquisition_permit_immutable_delete
BEFORE DELETE ON provenance_v2_acquisition_permit
BEGIN SELECT RAISE(ABORT, 'provenance-v2 acquisition permit cannot be deleted'); END;
CREATE TRIGGER provenance_v2_admitted_response_immutable_update
BEFORE UPDATE ON provenance_v2_admitted_response
BEGIN SELECT RAISE(ABORT, 'provenance-v2 admitted response is immutable'); END;
CREATE TRIGGER provenance_v2_admitted_response_immutable_delete
BEFORE DELETE ON provenance_v2_admitted_response
BEGIN SELECT RAISE(ABORT, 'provenance-v2 admitted response cannot be deleted'); END;
