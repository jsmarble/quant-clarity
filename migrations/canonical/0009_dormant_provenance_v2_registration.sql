-- Dormant normalized registration authority for provenance-v2.
-- No runtime registration or activation path is enabled by this migration.
-- Requirements: DATA-030–DATA-046, DATA-048–DATA-051, DATA-055–DATA-061,
-- PIPE-010–PIPE-022, PIPE-030–PIPE-045, BE-005, SEC-011–SEC-012,
-- PRIV-006–PRIV-007, PRIV-011, QA-006, QA-010, QA-012.

PRAGMA defer_foreign_keys = true;

-- Bind the exact migration-0008 capability and closed object inventory. The
-- capability and every predecessor row are immutable; the explicit inventory
-- also rejects a same-prefix addition, omission, or wrong SQLite object kind.
SELECT CASE WHEN (
  SELECT count(*) FROM provenance_v2_integrity_metadata
) <> 1 OR (
  SELECT count(*) FROM provenance_v2_integrity_metadata
  WHERE singleton = 1
    AND capability = 'fenced-provenance-v2@1'
    AND predecessor_capability = 'publication-orchestration-ledger@1'
    AND hash_domain = 'quantclarity:provenance-v2:v1'
    AND vocabulary_version = 'provenance-v2-vocabulary@1'
    AND writer_contract_version = 'provenance-v2-writer@1'
) <> 1 OR (
  SELECT count(*) FROM schema_metadata
  WHERE singleton = 1 AND schema_version = '1.0.0'
) <> 1 THEN json('') END;

WITH expected(type, name, table_name) AS (VALUES
  ('index', 'provenance_v2_coordination_run_exact_uq', 'publication_coordination_run'),
  ('index', 'provenance_v2_environment_exact_uq', 'publication_orchestration_environment'),
  ('index', 'provenance_v2_fence_claim_exact_uq', 'publication_provider_fence_claim'),
  ('index', 'provenance_v2_provider_run_exact_uq', 'publication_coordination_provider_run'),
  ('index', 'provenance_v2_run_plan_exact_uq', 'publication_run_plan'),
  ('index', 'provenance_v2_source_register_exact_uq', 'source_compliance_record'),
  ('table', 'provenance_v2_acquisition_permit', 'provenance_v2_acquisition_permit'),
  ('table', 'provenance_v2_admitted_response', 'provenance_v2_admitted_response'),
  ('table', 'provenance_v2_authority_plan', 'provenance_v2_authority_plan'),
  ('table', 'provenance_v2_authority_plan_approval', 'provenance_v2_authority_plan_approval'),
  ('table', 'provenance_v2_authority_plan_seal', 'provenance_v2_authority_plan_seal'),
  ('table', 'provenance_v2_installation_identity', 'provenance_v2_installation_identity'),
  ('table', 'provenance_v2_integrity_metadata', 'provenance_v2_integrity_metadata'),
  ('table', 'provenance_v2_provider_bundle', 'provenance_v2_provider_bundle'),
  ('table', 'provenance_v2_source_endpoint', 'provenance_v2_source_endpoint'),
  ('trigger', 'provenance_v2_acquisition_permit_activation_blocked', 'provenance_v2_acquisition_permit'),
  ('trigger', 'provenance_v2_acquisition_permit_immutable_delete', 'provenance_v2_acquisition_permit'),
  ('trigger', 'provenance_v2_acquisition_permit_immutable_update', 'provenance_v2_acquisition_permit'),
  ('trigger', 'provenance_v2_admitted_response_activation_blocked', 'provenance_v2_admitted_response'),
  ('trigger', 'provenance_v2_admitted_response_immutable_delete', 'provenance_v2_admitted_response'),
  ('trigger', 'provenance_v2_admitted_response_immutable_update', 'provenance_v2_admitted_response'),
  ('trigger', 'provenance_v2_authority_plan_activation_blocked', 'provenance_v2_authority_plan'),
  ('trigger', 'provenance_v2_authority_plan_approval_activation_blocked', 'provenance_v2_authority_plan_approval'),
  ('trigger', 'provenance_v2_authority_plan_approval_immutable_delete', 'provenance_v2_authority_plan_approval'),
  ('trigger', 'provenance_v2_authority_plan_approval_immutable_update', 'provenance_v2_authority_plan_approval'),
  ('trigger', 'provenance_v2_authority_plan_immutable_delete', 'provenance_v2_authority_plan'),
  ('trigger', 'provenance_v2_authority_plan_immutable_update', 'provenance_v2_authority_plan'),
  ('trigger', 'provenance_v2_authority_plan_seal_activation_blocked', 'provenance_v2_authority_plan_seal'),
  ('trigger', 'provenance_v2_authority_plan_seal_immutable_delete', 'provenance_v2_authority_plan_seal'),
  ('trigger', 'provenance_v2_authority_plan_seal_immutable_update', 'provenance_v2_authority_plan_seal'),
  ('trigger', 'provenance_v2_installation_identity_activation_blocked', 'provenance_v2_installation_identity'),
  ('trigger', 'provenance_v2_installation_identity_immutable_delete', 'provenance_v2_installation_identity'),
  ('trigger', 'provenance_v2_installation_identity_immutable_update', 'provenance_v2_installation_identity'),
  ('trigger', 'provenance_v2_integrity_metadata_immutable_delete', 'provenance_v2_integrity_metadata'),
  ('trigger', 'provenance_v2_integrity_metadata_immutable_update', 'provenance_v2_integrity_metadata'),
  ('trigger', 'provenance_v2_integrity_metadata_insert_guard', 'provenance_v2_integrity_metadata'),
  ('trigger', 'provenance_v2_provider_bundle_activation_blocked', 'provenance_v2_provider_bundle'),
  ('trigger', 'provenance_v2_provider_bundle_immutable_delete', 'provenance_v2_provider_bundle'),
  ('trigger', 'provenance_v2_provider_bundle_immutable_update', 'provenance_v2_provider_bundle'),
  ('trigger', 'provenance_v2_source_endpoint_activation_blocked', 'provenance_v2_source_endpoint'),
  ('trigger', 'provenance_v2_source_endpoint_immutable_delete', 'provenance_v2_source_endpoint'),
  ('trigger', 'provenance_v2_source_endpoint_immutable_update', 'provenance_v2_source_endpoint')
)
SELECT CASE WHEN
  (SELECT count(*) FROM sqlite_schema WHERE name GLOB 'provenance_v2_*') <> 42 OR
  EXISTS (
    SELECT 1 FROM expected
    LEFT JOIN sqlite_schema AS actual ON actual.name = expected.name
    WHERE actual.type IS NOT expected.type OR actual.tbl_name IS NOT expected.table_name
  ) OR EXISTS (
    SELECT 1 FROM sqlite_schema AS actual
    WHERE actual.name GLOB 'provenance_v2_*'
      AND NOT EXISTS (SELECT 1 FROM expected WHERE expected.name = actual.name)
  )
THEN json('') END;

-- All eight activation blockers must still be unconditional INSERT guards.
WITH expected(name, table_name, failure_fragment) AS (VALUES
  ('provenance_v2_installation_identity_activation_blocked', 'provenance_v2_installation_identity', 'installation initialization is not activated'),
  ('provenance_v2_authority_plan_activation_blocked', 'provenance_v2_authority_plan', 'authority-plan registration is not activated'),
  ('provenance_v2_authority_plan_seal_activation_blocked', 'provenance_v2_authority_plan_seal', 'authority-plan sealing is not activated'),
  ('provenance_v2_authority_plan_approval_activation_blocked', 'provenance_v2_authority_plan_approval', 'authority-plan approval is not activated'),
  ('provenance_v2_source_endpoint_activation_blocked', 'provenance_v2_source_endpoint', 'source-endpoint registration is not activated'),
  ('provenance_v2_provider_bundle_activation_blocked', 'provenance_v2_provider_bundle', 'bundle opening is not activated'),
  ('provenance_v2_acquisition_permit_activation_blocked', 'provenance_v2_acquisition_permit', 'acquisition permits are not activated'),
  ('provenance_v2_admitted_response_activation_blocked', 'provenance_v2_admitted_response', 'response admission is not activated')
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM expected
  LEFT JOIN sqlite_schema AS actual
    ON actual.type = 'trigger' AND actual.name = expected.name
  WHERE actual.tbl_name IS NOT expected.table_name OR actual.sql IS NULL
    OR instr(actual.sql, 'BEFORE INSERT ON ' || expected.table_name) = 0
    OR instr(actual.sql, 'WHEN') > 0
    OR instr(actual.sql, 'RAISE(ABORT') = 0
    OR instr(actual.sql, expected.failure_fragment) = 0
) THEN json('') END;

-- Re-prove the complete migration-0008 predecessor guard boundary. These are
-- the same 105 legacy, run-plan, publication, schedule, and fence triggers
-- admitted by migration 0008 in both supported runtimes.
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
    (object_count = 105 AND input_length = 95845 AND
      lane_a = 884512470 AND lane_b = 278567098 AND
      lane_c = 846283883 AND lane_d = 175437845) OR
    (object_count = 105 AND input_length = 95120 AND
      lane_a = 1184170414 AND lane_b = 1177013007 AND
      lane_c = 1673190829 AND lane_d = 487112043)
  )
) THEN json('') END;

-- Dormant migration 0008 cannot be accepted after any blocked runtime row has
-- been smuggled in by temporarily weakening a guard.
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM provenance_v2_installation_identity) OR
  EXISTS (SELECT 1 FROM provenance_v2_authority_plan) OR
  EXISTS (SELECT 1 FROM provenance_v2_authority_plan_seal) OR
  EXISTS (SELECT 1 FROM provenance_v2_authority_plan_approval) OR
  EXISTS (SELECT 1 FROM provenance_v2_source_endpoint) OR
  EXISTS (SELECT 1 FROM provenance_v2_provider_bundle) OR
  EXISTS (SELECT 1 FROM provenance_v2_acquisition_permit) OR
  EXISTS (SELECT 1 FROM provenance_v2_admitted_response)
THEN json('') END;

-- Bind the complete normalized SQL of all 42 migration-0008 objects, not only
-- their names. The supported Node SQLite and workerd/D1 runtimes produce the
-- same profile for this closed object set.
WITH RECURSIVE
source(object_key, input) AS (
  SELECT type || char(31) || name,
    type || char(31) || name || char(31) || tbl_name || char(31) || coalesce(sql, '')
  FROM sqlite_schema WHERE name GLOB 'provenance_v2_*'
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
    object_count = 42 AND input_length = 26276 AND
    lane_a = 580523810 AND lane_b = 1756861999 AND
    lane_c = 2051231111 AND lane_d = 794430167
  )
) THEN json('') END;

-- No name allocated by this slice may already exist as any SQLite object kind.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema WHERE name IN (
    'provenance_v2_registration_integrity_metadata',
    'provenance_v2_source_owner_receipt',
    'provenance_v2_source_register_receipt',
    'provenance_v2_source_register_member',
    'provenance_v2_adapter_manifest_receipt',
    'provenance_v2_adapter_manifest_environment',
    'provenance_v2_adapter_manifest_credential',
    'provenance_v2_adapter_manifest_source',
    'provenance_v2_source_endpoint_registration',
    'provenance_v2_source_endpoint_request',
    'provenance_v2_source_endpoint_parameter',
    'provenance_v2_source_endpoint_parameter_enum',
    'provenance_v2_source_endpoint_allowed_header',
    'provenance_v2_source_endpoint_redirect_host',
    'provenance_v2_source_endpoint_content_type',
    'provenance_v2_source_endpoint_expected_field',
    'provenance_v2_source_endpoint_approval',
    'provenance_v2_source_endpoint_revocation',
    'provenance_v2_field_path_vocabulary',
    'provenance_v2_field_policy',
    'provenance_v2_field_policy_precedence_class',
    'provenance_v2_field_policy_precedence_edge',
    'provenance_v2_field_policy_endpoint_admission',
    'provenance_v2_verifier_implementation',
    'provenance_v2_verifier_policy',
    'provenance_v2_verifier_policy_member',
    'provenance_v2_authority_plan_registration_close',
    'provenance_v2_authority_plan_oracle_receipt',
    'provenance_v2_authority_plan_approval_intent',
    'provenance_v2_authority_plan_revocation',
    'provenance_v2_registration_plan_exact_uq',
    'provenance_v2_registration_plan_roots_exact_uq',
    'provenance_v2_registration_plan_provider_exact_uq',
    'provenance_v2_registration_endpoint_exact_uq',
    'provenance_v2_registration_source_compliance_authority_uq',
    'provenance_v2_registration_provider_owner_exact_uq'
  )
) THEN json('') END;

CREATE TABLE provenance_v2_registration_integrity_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  capability TEXT NOT NULL CHECK (capability = 'fenced-provenance-v2-registration@1'),
  predecessor_capability TEXT NOT NULL CHECK (predecessor_capability = 'fenced-provenance-v2@1'),
  adapter_receipt_contract TEXT NOT NULL CHECK (adapter_receipt_contract = 'provenance-v2-adapter-receipt@1'),
  endpoint_contract TEXT NOT NULL CHECK (endpoint_contract = 'provenance-v2-endpoint@1'),
  field_policy_contract TEXT NOT NULL CHECK (field_policy_contract = 'provenance-v2-field-policy@1'),
  verifier_policy_contract TEXT NOT NULL CHECK (verifier_policy_contract = 'provenance-v2-verifier-policy@1'),
  root_contract TEXT NOT NULL CHECK (root_contract = 'provenance-v2-authority-root@1')
) STRICT;

INSERT INTO provenance_v2_registration_integrity_metadata VALUES (
  1, 'fenced-provenance-v2-registration@1', 'fenced-provenance-v2@1',
  'provenance-v2-adapter-receipt@1', 'provenance-v2-endpoint@1',
  'provenance-v2-field-policy@1', 'provenance-v2-verifier-policy@1',
  'provenance-v2-authority-root@1'
);

CREATE UNIQUE INDEX provenance_v2_registration_plan_exact_uq
ON provenance_v2_authority_plan(authority_plan_id, run_plan_id, installation_id);

CREATE UNIQUE INDEX provenance_v2_registration_plan_roots_exact_uq
ON provenance_v2_authority_plan(
  authority_plan_id, endpoint_set_root, field_policy_set_root,
  verifier_policy_set_root, adapter_manifest_set_root
);

CREATE UNIQUE INDEX provenance_v2_registration_plan_provider_exact_uq
ON publication_run_plan_provider(
  run_plan_id, provider_id, adapter_version, roster_version,
  roster_content_hash, source_register_version, source_artifact_hash,
  request_ceiling, byte_ceiling, ai_token_ceiling,
  browser_millisecond_ceiling, elapsed_millisecond_ceiling,
  cost_microusd_ceiling
);

CREATE UNIQUE INDEX provenance_v2_registration_source_compliance_authority_uq
ON source_compliance_record(
  provider_id, register_version, artifact_hash, approval_state,
  reviewed_at_ms, next_review_at_ms, access_permitted, retention_permitted,
  excerpt_permitted, publication_permitted
);

CREATE UNIQUE INDEX provenance_v2_registration_provider_owner_exact_uq
ON provider(provider_id, organization_id);

CREATE UNIQUE INDEX provenance_v2_registration_endpoint_exact_uq
ON provenance_v2_source_endpoint(
  authority_plan_id, endpoint_id, provider_id,
  source_register_version, source_register_artifact_hash, source_id,
  adapter_source_type, source_owner_organization_id,
  provider_owner_relationship, host_ascii, path_template_hash,
  adapter_manifest_hash, endpoint_content_hash
);

CREATE TABLE provenance_v2_source_owner_receipt (
  authority_plan_id TEXT NOT NULL REFERENCES provenance_v2_authority_plan(authority_plan_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL,
  provider_organization_id TEXT NOT NULL,
  owner_organization_id TEXT NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('provider_operator', 'model_publisher', 'independent_catalog_operator')),
  provider_owner_relationship TEXT NOT NULL CHECK (provider_owner_relationship IN ('provider_controlled', 'publisher_controlled', 'independent')),
  identity_contract_version TEXT NOT NULL CHECK (identity_contract_version = 'provenance-v2-source-owner@1'),
  identity_content_hash TEXT NOT NULL UNIQUE CHECK (length(identity_content_hash) = 71 AND substr(identity_content_hash, 1, 7) = 'sha256:' AND substr(identity_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  relationship_approval_hash TEXT NOT NULL CHECK (length(relationship_approval_hash) = 71 AND substr(relationship_approval_hash, 1, 7) = 'sha256:' AND substr(relationship_approval_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms BETWEEN 0 AND 253402300799999),
  CHECK (
    (provider_owner_relationship = 'provider_controlled' AND
      owner_kind = 'provider_operator' AND
      owner_organization_id = provider_organization_id) OR
    (provider_owner_relationship = 'publisher_controlled' AND
      owner_kind = 'model_publisher') OR
    (provider_owner_relationship = 'independent' AND
      owner_kind = 'independent_catalog_operator')
  ),
  PRIMARY KEY (authority_plan_id, provider_id, owner_organization_id),
  UNIQUE (
    authority_plan_id, provider_id, provider_organization_id,
    owner_organization_id, provider_owner_relationship, owner_kind
  ),
  FOREIGN KEY (provider_id, provider_organization_id)
    REFERENCES provider(provider_id, organization_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_register_receipt (
  authority_plan_id TEXT NOT NULL REFERENCES provenance_v2_authority_plan(authority_plan_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  register_version TEXT NOT NULL CHECK (length(CAST(register_version AS BLOB)) BETWEEN 1 AND 128 AND register_version NOT GLOB '*[^ -~]*'),
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) = 71 AND substr(artifact_hash, 1, 7) = 'sha256:' AND substr(artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  member_count INTEGER NOT NULL CHECK (typeof(member_count) = 'integer' AND member_count BETWEEN 1 AND 32),
  member_set_root TEXT NOT NULL CHECK (length(member_set_root) = 71 AND substr(member_set_root, 1, 7) = 'sha256:' AND substr(member_set_root, 8) NOT GLOB '*[^0-9a-f]*'),
  approval_state TEXT NOT NULL CHECK (approval_state = 'approved'),
  reviewed_at_ms INTEGER NOT NULL CHECK (typeof(reviewed_at_ms) = 'integer' AND reviewed_at_ms BETWEEN 0 AND 253402300799999),
  next_review_at_ms INTEGER NOT NULL CHECK (typeof(next_review_at_ms) = 'integer' AND next_review_at_ms BETWEEN 1 AND 253402300799999),
  access_permitted INTEGER NOT NULL CHECK (access_permitted = 1),
  retention_permitted INTEGER NOT NULL CHECK (retention_permitted = 1),
  excerpt_permitted INTEGER NOT NULL CHECK (excerpt_permitted IN (0, 1)),
  publication_permitted INTEGER NOT NULL CHECK (publication_permitted = 1),
  receipt_content_hash TEXT NOT NULL UNIQUE CHECK (length(receipt_content_hash) = 71 AND substr(receipt_content_hash, 1, 7) = 'sha256:' AND substr(receipt_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  CHECK (reviewed_at_ms < next_review_at_ms),
  PRIMARY KEY (authority_plan_id, provider_id),
  UNIQUE (authority_plan_id, provider_id, register_version, artifact_hash),
  FOREIGN KEY (
    provider_id, register_version, artifact_hash, approval_state,
    reviewed_at_ms, next_review_at_ms, access_permitted, retention_permitted,
    excerpt_permitted, publication_permitted
  ) REFERENCES source_compliance_record(
    provider_id, register_version, artifact_hash, approval_state,
    reviewed_at_ms, next_review_at_ms, access_permitted, retention_permitted,
    excerpt_permitted, publication_permitted
  ) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_register_member (
  authority_plan_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  register_version TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 31),
  source_id TEXT NOT NULL CHECK (length(CAST(source_id AS BLOB)) BETWEEN 1 AND 64 AND source_id = lower(source_id) AND substr(source_id, 1, 1) GLOB '[a-z]' AND source_id NOT GLOB '*[^a-z0-9_-]*'),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, provider_id, source_id),
  UNIQUE (authority_plan_id, provider_id, ordinal),
  UNIQUE (authority_plan_id, provider_id, register_version, artifact_hash, source_id),
  FOREIGN KEY (authority_plan_id, provider_id, register_version, artifact_hash)
    REFERENCES provenance_v2_source_register_receipt(authority_plan_id, provider_id, register_version, artifact_hash) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_adapter_manifest_receipt (
  authority_plan_id TEXT NOT NULL,
  run_plan_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  receipt_contract_version TEXT NOT NULL CHECK (receipt_contract_version = 'provenance-v2-adapter-receipt@1'),
  adapter_contract_version TEXT NOT NULL CHECK (length(adapter_contract_version) BETWEEN 5 AND 32 AND adapter_contract_version NOT GLOB '*[^0-9.]*'),
  adapter_version TEXT NOT NULL CHECK (length(CAST(adapter_version AS BLOB)) BETWEEN 1 AND 128 AND adapter_version NOT GLOB '*[^ -~]*'),
  adapter_manifest_hash TEXT NOT NULL CHECK (length(adapter_manifest_hash) = 71 AND substr(adapter_manifest_hash, 1, 7) = 'sha256:' AND substr(adapter_manifest_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  successor_manifest_hash TEXT NOT NULL CHECK (length(successor_manifest_hash) = 71 AND substr(successor_manifest_hash, 1, 7) = 'sha256:' AND substr(successor_manifest_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  source_policy_version TEXT NOT NULL CHECK (length(CAST(source_policy_version AS BLOB)) BETWEEN 1 AND 128 AND source_policy_version NOT GLOB '*[^ -~]*'),
  parser_version TEXT NOT NULL CHECK (length(CAST(parser_version AS BLOB)) BETWEEN 1 AND 128 AND parser_version NOT GLOB '*[^ -~]*'),
  extraction_policy_version TEXT CHECK (extraction_policy_version IS NULL OR (length(CAST(extraction_policy_version AS BLOB)) BETWEEN 1 AND 128 AND extraction_policy_version NOT GLOB '*[^ -~]*')),
  roster_version TEXT NOT NULL,
  roster_content_hash TEXT NOT NULL,
  source_register_version TEXT NOT NULL,
  source_artifact_hash TEXT NOT NULL,
  source_count INTEGER NOT NULL CHECK (typeof(source_count) = 'integer' AND source_count BETWEEN 1 AND 32),
  environment_count INTEGER NOT NULL CHECK (typeof(environment_count) = 'integer' AND environment_count BETWEEN 1 AND 4),
  credential_count INTEGER NOT NULL CHECK (typeof(credential_count) = 'integer' AND credential_count BETWEEN 0 AND 16),
  request_ceiling INTEGER NOT NULL,
  byte_ceiling INTEGER NOT NULL,
  ai_token_ceiling INTEGER NOT NULL,
  browser_millisecond_ceiling INTEGER NOT NULL,
  elapsed_millisecond_ceiling INTEGER NOT NULL,
  cost_microusd_ceiling INTEGER NOT NULL,
  manifest_requests_per_run INTEGER NOT NULL CHECK (typeof(manifest_requests_per_run) = 'integer' AND manifest_requests_per_run BETWEEN 1 AND 10000),
  pages_per_source INTEGER NOT NULL CHECK (typeof(pages_per_source) = 'integer' AND pages_per_source BETWEEN 1 AND 10000),
  manifest_bytes_per_run INTEGER NOT NULL CHECK (typeof(manifest_bytes_per_run) = 'integer' AND manifest_bytes_per_run BETWEEN 1 AND 1000000000),
  manifest_duration_ms INTEGER NOT NULL CHECK (typeof(manifest_duration_ms) = 'integer' AND manifest_duration_ms BETWEEN 1 AND 43200000),
  retry_attempts INTEGER NOT NULL CHECK (typeof(retry_attempts) = 'integer' AND retry_attempts BETWEEN 0 AND 10),
  manifest_browser_sessions INTEGER NOT NULL CHECK (typeof(manifest_browser_sessions) = 'integer' AND manifest_browser_sessions BETWEEN 0 AND 1000),
  manifest_ai_tokens INTEGER NOT NULL CHECK (typeof(manifest_ai_tokens) = 'integer' AND manifest_ai_tokens BETWEEN 0 AND 10000000),
  items_per_run INTEGER NOT NULL CHECK (typeof(items_per_run) = 'integer' AND items_per_run BETWEEN 1 AND 100000),
  manifest_content_hash TEXT NOT NULL CHECK (length(manifest_content_hash) = 71 AND substr(manifest_content_hash, 1, 7) = 'sha256:' AND substr(manifest_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms BETWEEN 0 AND 253402300799999),
  PRIMARY KEY (authority_plan_id, provider_id),
  UNIQUE (authority_plan_id, provider_id, adapter_manifest_hash),
  UNIQUE (authority_plan_id, successor_manifest_hash),
  UNIQUE (authority_plan_id, manifest_content_hash),
  CHECK (manifest_requests_per_run <= request_ceiling),
  CHECK (manifest_bytes_per_run <= byte_ceiling),
  CHECK (manifest_duration_ms <= elapsed_millisecond_ceiling),
  CHECK (manifest_ai_tokens <= ai_token_ceiling),
  FOREIGN KEY (authority_plan_id, run_plan_id, installation_id)
    REFERENCES provenance_v2_authority_plan(authority_plan_id, run_plan_id, installation_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    run_plan_id, provider_id, adapter_version, roster_version,
    roster_content_hash, source_register_version, source_artifact_hash,
    request_ceiling, byte_ceiling, ai_token_ceiling,
    browser_millisecond_ceiling, elapsed_millisecond_ceiling, cost_microusd_ceiling
  ) REFERENCES publication_run_plan_provider(
    run_plan_id, provider_id, adapter_version, roster_version,
    roster_content_hash, source_register_version, source_artifact_hash,
    request_ceiling, byte_ceiling, ai_token_ceiling,
    browser_millisecond_ceiling, elapsed_millisecond_ceiling, cost_microusd_ceiling
  ) ON DELETE RESTRICT,
  FOREIGN KEY (authority_plan_id, provider_id, source_register_version, source_artifact_hash)
    REFERENCES provenance_v2_source_register_receipt(authority_plan_id, provider_id, register_version, artifact_hash) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_adapter_manifest_environment (
  authority_plan_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 3),
  environment TEXT NOT NULL CHECK (environment IN ('local', 'test', 'preview', 'production')),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, provider_id, environment),
  UNIQUE (authority_plan_id, provider_id, ordinal),
  FOREIGN KEY (authority_plan_id, provider_id)
    REFERENCES provenance_v2_adapter_manifest_receipt(authority_plan_id, provider_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_adapter_manifest_credential (
  authority_plan_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 15),
  binding_name TEXT NOT NULL CHECK (length(binding_name) BETWEEN 1 AND 128 AND substr(binding_name, 1, 1) GLOB '[A-Z]' AND binding_name NOT GLOB '*[^A-Z0-9_]*'),
  purpose_hash TEXT NOT NULL CHECK (length(purpose_hash) = 71 AND substr(purpose_hash, 1, 7) = 'sha256:' AND substr(purpose_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, provider_id, binding_name),
  UNIQUE (authority_plan_id, provider_id, ordinal),
  FOREIGN KEY (authority_plan_id, provider_id)
    REFERENCES provenance_v2_adapter_manifest_receipt(authority_plan_id, provider_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_adapter_manifest_source (
  authority_plan_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  source_ordinal INTEGER NOT NULL CHECK (typeof(source_ordinal) = 'integer' AND source_ordinal BETWEEN 0 AND 31),
  source_id TEXT NOT NULL,
  adapter_source_type TEXT NOT NULL CHECK (adapter_source_type IN ('provider_api', 'authenticated_catalog', 'public_static_page', 'public_rendered_page', 'publisher_checkpoint_repository')),
  provider_organization_id TEXT NOT NULL,
  owner_organization_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('provider_operator', 'model_publisher', 'independent_catalog_operator')),
  provider_owner_relationship TEXT NOT NULL CHECK (provider_owner_relationship IN ('provider_controlled', 'publisher_controlled', 'independent')),
  authority_source_class TEXT NOT NULL CHECK (authority_source_class IN ('provider_exact_api', 'provider_exact_authenticated_catalog', 'provider_controlled_public', 'publisher_checkpoint', 'provider_support_or_changelog', 'independent_structured_catalog')),
  host_ascii TEXT NOT NULL CHECK (length(CAST(host_ascii AS BLOB)) BETWEEN 1 AND 253 AND host_ascii = lower(host_ascii) AND host_ascii NOT GLOB '*[^a-z0-9.-]*'),
  path_template_hash TEXT NOT NULL CHECK (length(path_template_hash) = 71 AND substr(path_template_hash, 1, 7) = 'sha256:' AND substr(path_template_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  manifest_source_hash TEXT NOT NULL CHECK (length(manifest_source_hash) = 71 AND substr(manifest_source_hash, 1, 7) = 'sha256:' AND substr(manifest_source_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    (authority_source_class = 'provider_exact_api' AND
      adapter_source_type = 'provider_api' AND
      provider_owner_relationship = 'provider_controlled') OR
    (authority_source_class = 'provider_exact_authenticated_catalog' AND
      adapter_source_type = 'authenticated_catalog' AND
      provider_owner_relationship = 'provider_controlled') OR
    (authority_source_class IN ('provider_controlled_public', 'provider_support_or_changelog') AND
      adapter_source_type IN ('public_static_page', 'public_rendered_page') AND
      provider_owner_relationship = 'provider_controlled') OR
    (authority_source_class = 'publisher_checkpoint' AND
      adapter_source_type = 'publisher_checkpoint_repository' AND
      provider_owner_relationship = 'publisher_controlled') OR
    (authority_source_class = 'independent_structured_catalog' AND
      adapter_source_type IN ('authenticated_catalog', 'public_static_page', 'public_rendered_page') AND
      provider_owner_relationship = 'independent')
  ),
  PRIMARY KEY (authority_plan_id, provider_id, source_id),
  UNIQUE (authority_plan_id, provider_id, source_ordinal),
  UNIQUE (authority_plan_id, provider_id, manifest_source_hash),
  UNIQUE (
    authority_plan_id, provider_id, source_id, adapter_source_type,
    provider_organization_id, owner_organization_id, owner_kind,
    provider_owner_relationship, authority_source_class, host_ascii,
    path_template_hash, manifest_source_hash
  ),
  FOREIGN KEY (authority_plan_id, provider_id)
    REFERENCES provenance_v2_adapter_manifest_receipt(authority_plan_id, provider_id) ON DELETE RESTRICT,
  FOREIGN KEY (
    authority_plan_id, provider_id, provider_organization_id,
    owner_organization_id, provider_owner_relationship, owner_kind
  ) REFERENCES provenance_v2_source_owner_receipt(
    authority_plan_id, provider_id, provider_organization_id,
    owner_organization_id, provider_owner_relationship, owner_kind
  ) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_registration (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  source_register_version TEXT NOT NULL,
  source_register_artifact_hash TEXT NOT NULL,
  source_id TEXT NOT NULL,
  adapter_source_type TEXT NOT NULL,
  provider_organization_id TEXT NOT NULL,
  source_owner_organization_id TEXT NOT NULL,
  source_owner_kind TEXT NOT NULL,
  provider_owner_relationship TEXT NOT NULL,
  host_ascii TEXT NOT NULL,
  path_template_hash TEXT NOT NULL,
  adapter_manifest_hash TEXT NOT NULL,
  endpoint_content_hash TEXT NOT NULL,
  authority_source_class TEXT NOT NULL,
  manifest_source_hash TEXT NOT NULL,
  registration_hash TEXT NOT NULL UNIQUE CHECK (length(registration_hash) = 71 AND substr(registration_hash, 1, 7) = 'sha256:' AND substr(registration_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, endpoint_id),
  UNIQUE (authority_plan_id, endpoint_id, provider_id),
  UNIQUE (authority_plan_id, endpoint_id, authority_source_class),
  FOREIGN KEY (
    authority_plan_id, endpoint_id, provider_id,
    source_register_version, source_register_artifact_hash, source_id,
    adapter_source_type, source_owner_organization_id,
    provider_owner_relationship, host_ascii, path_template_hash,
    adapter_manifest_hash, endpoint_content_hash
  ) REFERENCES provenance_v2_source_endpoint(
    authority_plan_id, endpoint_id, provider_id,
    source_register_version, source_register_artifact_hash, source_id,
    adapter_source_type, source_owner_organization_id,
    provider_owner_relationship, host_ascii, path_template_hash,
    adapter_manifest_hash, endpoint_content_hash
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    authority_plan_id, provider_id, source_id, adapter_source_type,
    provider_organization_id, source_owner_organization_id,
    source_owner_kind, provider_owner_relationship, authority_source_class,
    host_ascii, path_template_hash, manifest_source_hash
  ) REFERENCES provenance_v2_adapter_manifest_source(
    authority_plan_id, provider_id, source_id, adapter_source_type,
    provider_organization_id, owner_organization_id, owner_kind,
    provider_owner_relationship, authority_source_class, host_ascii,
    path_template_hash, manifest_source_hash
  ) ON DELETE RESTRICT,
  FOREIGN KEY (authority_plan_id, provider_id, adapter_manifest_hash)
    REFERENCES provenance_v2_adapter_manifest_receipt(authority_plan_id, provider_id, adapter_manifest_hash) ON DELETE RESTRICT,
  FOREIGN KEY (
    authority_plan_id, provider_id, source_register_version,
    source_register_artifact_hash, source_id
  ) REFERENCES provenance_v2_source_register_member(
    authority_plan_id, provider_id, register_version, artifact_hash, source_id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    authority_plan_id, provider_id, provider_organization_id,
    source_owner_organization_id, provider_owner_relationship,
    source_owner_kind
  ) REFERENCES provenance_v2_source_owner_receipt(
    authority_plan_id, provider_id, provider_organization_id,
    owner_organization_id, provider_owner_relationship, owner_kind
  ) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_request (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  scheme TEXT NOT NULL CHECK (scheme = 'https'),
  method TEXT NOT NULL CHECK (method = 'GET'),
  safe_locator_template_hash TEXT NOT NULL CHECK (length(safe_locator_template_hash) = 71 AND substr(safe_locator_template_hash, 1, 7) = 'sha256:' AND substr(safe_locator_template_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  pagination_hash TEXT NOT NULL CHECK (length(pagination_hash) = 71 AND substr(pagination_hash, 1, 7) = 'sha256:' AND substr(pagination_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  authentication_class TEXT NOT NULL CHECK (authentication_class IN ('none', 'api_key', 'bearer')),
  credential_binding_name TEXT,
  credential_injection TEXT CHECK (credential_injection IS NULL OR credential_injection IN ('authorization_bearer', 'header')),
  credential_header TEXT CHECK (credential_header IS NULL OR (length(credential_header) BETWEEN 1 AND 64 AND credential_header NOT GLOB '*[^A-Za-z0-9-]*')),
  compressed_byte_limit INTEGER NOT NULL CHECK (typeof(compressed_byte_limit) = 'integer' AND compressed_byte_limit BETWEEN 1 AND 1000000000),
  uncompressed_byte_limit INTEGER NOT NULL CHECK (typeof(uncompressed_byte_limit) = 'integer' AND uncompressed_byte_limit BETWEEN 1 AND 1000000000),
  timeout_ms INTEGER NOT NULL CHECK (typeof(timeout_ms) = 'integer' AND timeout_ms BETWEEN 1 AND 43200000),
  redirect_limit INTEGER NOT NULL CHECK (typeof(redirect_limit) = 'integer' AND redirect_limit BETWEEN 0 AND 3),
  provider_rate_limit_hash TEXT NOT NULL CHECK (length(provider_rate_limit_hash) = 71 AND substr(provider_rate_limit_hash, 1, 7) = 'sha256:' AND substr(provider_rate_limit_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  crawl_purpose_hash TEXT NOT NULL CHECK (length(crawl_purpose_hash) = 71 AND substr(crawl_purpose_hash, 1, 7) = 'sha256:' AND substr(crawl_purpose_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  robots_policy_hash TEXT NOT NULL CHECK (length(robots_policy_hash) = 71 AND substr(robots_policy_hash, 1, 7) = 'sha256:' AND substr(robots_policy_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  content_signals_policy_hash TEXT NOT NULL CHECK (length(content_signals_policy_hash) = 71 AND substr(content_signals_policy_hash, 1, 7) = 'sha256:' AND substr(content_signals_policy_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  browser_session_approved INTEGER NOT NULL CHECK (browser_session_approved IN (0, 1)),
  retention_permitted INTEGER NOT NULL CHECK (retention_permitted = 1),
  publication_permitted INTEGER NOT NULL CHECK (publication_permitted = 1),
  parameter_count INTEGER NOT NULL CHECK (typeof(parameter_count) = 'integer' AND parameter_count BETWEEN 0 AND 64),
  allowed_header_count INTEGER NOT NULL CHECK (typeof(allowed_header_count) = 'integer' AND allowed_header_count BETWEEN 0 AND 16),
  redirect_host_count INTEGER NOT NULL CHECK (typeof(redirect_host_count) = 'integer' AND redirect_host_count BETWEEN 0 AND 8),
  content_type_count INTEGER NOT NULL CHECK (typeof(content_type_count) = 'integer' AND content_type_count BETWEEN 1 AND 8),
  expected_field_count INTEGER NOT NULL CHECK (typeof(expected_field_count) = 'integer' AND expected_field_count BETWEEN 0 AND 128),
  request_content_hash TEXT NOT NULL UNIQUE CHECK (length(request_content_hash) = 71 AND substr(request_content_hash, 1, 7) = 'sha256:' AND substr(request_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  CHECK (compressed_byte_limit <= uncompressed_byte_limit),
  CHECK (
    (authentication_class = 'none' AND credential_binding_name IS NULL AND credential_injection IS NULL AND credential_header IS NULL) OR
    (authentication_class = 'bearer' AND credential_binding_name IS NOT NULL AND credential_injection = 'authorization_bearer' AND credential_header = 'Authorization') OR
    (authentication_class = 'api_key' AND credential_binding_name IS NOT NULL AND credential_injection = 'header' AND credential_header IS NOT NULL)
  ),
  PRIMARY KEY (authority_plan_id, endpoint_id),
  FOREIGN KEY (authority_plan_id, endpoint_id, provider_id)
    REFERENCES provenance_v2_source_endpoint_registration(authority_plan_id, endpoint_id, provider_id) ON DELETE RESTRICT,
  FOREIGN KEY (authority_plan_id, provider_id, credential_binding_name)
    REFERENCES provenance_v2_adapter_manifest_credential(authority_plan_id, provider_id, binding_name) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_parameter (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 63),
  parameter_name TEXT NOT NULL CHECK (length(parameter_name) BETWEEN 1 AND 64 AND substr(parameter_name, 1, 1) GLOB '[a-z]' AND parameter_name NOT GLOB '*[^a-z0-9_]*'),
  location TEXT NOT NULL CHECK (location IN ('path', 'query')),
  value_type TEXT NOT NULL CHECK (value_type IN ('string', 'integer', 'boolean')),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  pattern_hash TEXT CHECK (pattern_hash IS NULL OR (length(pattern_hash) = 71 AND substr(pattern_hash, 1, 7) = 'sha256:' AND substr(pattern_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  maximum_length INTEGER CHECK (maximum_length IS NULL OR (typeof(maximum_length) = 'integer' AND maximum_length BETWEEN 1 AND 4096)),
  enum_count INTEGER NOT NULL CHECK (typeof(enum_count) = 'integer' AND enum_count BETWEEN 0 AND 128),
  parameter_hash TEXT NOT NULL UNIQUE CHECK (length(parameter_hash) = 71 AND substr(parameter_hash, 1, 7) = 'sha256:' AND substr(parameter_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, endpoint_id, ordinal),
  UNIQUE (authority_plan_id, endpoint_id, parameter_name),
  UNIQUE (authority_plan_id, endpoint_id, ordinal, parameter_name),
  FOREIGN KEY (authority_plan_id, endpoint_id)
    REFERENCES provenance_v2_source_endpoint_request(authority_plan_id, endpoint_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_parameter_enum (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  parameter_ordinal INTEGER NOT NULL,
  parameter_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 127),
  value_hash TEXT NOT NULL CHECK (length(value_hash) = 71 AND substr(value_hash, 1, 7) = 'sha256:' AND substr(value_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, endpoint_id, parameter_ordinal, ordinal),
  UNIQUE (authority_plan_id, endpoint_id, parameter_ordinal, value_hash),
  FOREIGN KEY (authority_plan_id, endpoint_id, parameter_ordinal, parameter_name)
    REFERENCES provenance_v2_source_endpoint_parameter(authority_plan_id, endpoint_id, ordinal, parameter_name) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_allowed_header (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 15),
  header_name TEXT NOT NULL CHECK (length(header_name) BETWEEN 1 AND 64 AND header_name NOT GLOB '*[^A-Za-z0-9-]*'),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, endpoint_id, header_name),
  UNIQUE (authority_plan_id, endpoint_id, ordinal),
  FOREIGN KEY (authority_plan_id, endpoint_id)
    REFERENCES provenance_v2_source_endpoint_request(authority_plan_id, endpoint_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_redirect_host (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 7),
  host_ascii TEXT NOT NULL CHECK (length(CAST(host_ascii AS BLOB)) BETWEEN 1 AND 253 AND host_ascii = lower(host_ascii) AND host_ascii NOT GLOB '*[^a-z0-9.-]*' AND instr(host_ascii, '.') BETWEEN 2 AND 252 AND instr(host_ascii, '..') = 0 AND instr(host_ascii, '.-') = 0 AND instr(host_ascii, '-.') = 0),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, endpoint_id, host_ascii),
  UNIQUE (authority_plan_id, endpoint_id, ordinal),
  FOREIGN KEY (authority_plan_id, endpoint_id)
    REFERENCES provenance_v2_source_endpoint_request(authority_plan_id, endpoint_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_content_type (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 7),
  content_type TEXT NOT NULL CHECK (length(CAST(content_type AS BLOB)) BETWEEN 1 AND 128 AND content_type = lower(content_type) AND content_type NOT GLOB '*[^a-z0-9!#$&^_.+\/-]*'),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, endpoint_id, content_type),
  UNIQUE (authority_plan_id, endpoint_id, ordinal),
  FOREIGN KEY (authority_plan_id, endpoint_id)
    REFERENCES provenance_v2_source_endpoint_request(authority_plan_id, endpoint_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_field_path_vocabulary (
  vocabulary_version TEXT NOT NULL CHECK (vocabulary_version = 'provenance-v2-field-path@1'),
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 127),
  field_path TEXT PRIMARY KEY CHECK (length(CAST(field_path AS BLOB)) BETWEEN 1 AND 128 AND field_path = lower(field_path) AND field_path NOT GLOB '*[^a-z0-9_.]*'),
  field_group TEXT NOT NULL CHECK (field_group IN ('offering_applicability', 'price', 'precision_summary', 'precision_component')),
  value_kind TEXT NOT NULL CHECK (value_kind IN ('text', 'decimal', 'currency', 'timestamp', 'boolean', 'enum')),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('offering', 'price_role', 'precision_summary', 'precision_component')),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  UNIQUE (vocabulary_version, ordinal)
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_expected_field (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 127),
  field_path TEXT NOT NULL REFERENCES provenance_v2_field_path_vocabulary(field_path) ON DELETE RESTRICT,
  declaration_kind TEXT NOT NULL CHECK (declaration_kind IN ('price', 'precision')),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, endpoint_id, field_path),
  UNIQUE (authority_plan_id, endpoint_id, ordinal),
  FOREIGN KEY (authority_plan_id, endpoint_id)
    REFERENCES provenance_v2_source_endpoint_request(authority_plan_id, endpoint_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_approval (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  effective_from_ms INTEGER NOT NULL CHECK (typeof(effective_from_ms) = 'integer' AND effective_from_ms BETWEEN 0 AND 253402300799999),
  effective_to_ms INTEGER NOT NULL CHECK (typeof(effective_to_ms) = 'integer' AND effective_to_ms BETWEEN 1 AND 253402300799999),
  approval_artifact_hash TEXT NOT NULL CHECK (length(approval_artifact_hash) = 71 AND substr(approval_artifact_hash, 1, 7) = 'sha256:' AND substr(approval_artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  approved_at_ms INTEGER NOT NULL CHECK (typeof(approved_at_ms) = 'integer' AND approved_at_ms BETWEEN 0 AND 253402300799999),
  CHECK (approved_at_ms <= effective_from_ms AND effective_from_ms < effective_to_ms),
  PRIMARY KEY (authority_plan_id, endpoint_id),
  FOREIGN KEY (authority_plan_id, endpoint_id)
    REFERENCES provenance_v2_source_endpoint_registration(authority_plan_id, endpoint_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_source_endpoint_revocation (
  authority_plan_id TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('integrity_failure', 'legal_source_revoked', 'credential_authority_revoked', 'superseded')),
  effective_at_ms INTEGER NOT NULL CHECK (typeof(effective_at_ms) = 'integer' AND effective_at_ms BETWEEN 0 AND 253402300799999),
  PRIMARY KEY (authority_plan_id, endpoint_id),
  FOREIGN KEY (authority_plan_id, endpoint_id)
    REFERENCES provenance_v2_source_endpoint_approval(authority_plan_id, endpoint_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_verifier_implementation (
  authority_plan_id TEXT NOT NULL REFERENCES provenance_v2_authority_plan(authority_plan_id) ON DELETE RESTRICT,
  implementation_key TEXT NOT NULL CHECK (length(implementation_key) BETWEEN 1 AND 64 AND implementation_key = lower(implementation_key) AND substr(implementation_key, 1, 1) GLOB '[a-z]' AND implementation_key NOT GLOB '*[^a-z0-9_-]*'),
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 511),
  implementation_kind TEXT NOT NULL CHECK (implementation_kind IN ('deterministic_parser', 'span_entailment', 'generative_reextraction', 'authoritative_corroboration', 'anomaly_validator')),
  family_key TEXT NOT NULL CHECK (length(family_key) BETWEEN 1 AND 64 AND family_key = lower(family_key) AND substr(family_key, 1, 1) GLOB '[a-z]' AND family_key NOT GLOB '*[^a-z0-9_-]*'),
  implementation_version TEXT NOT NULL CHECK (length(CAST(implementation_version AS BLOB)) BETWEEN 1 AND 128 AND implementation_version NOT GLOB '*[^ -~]*'),
  implementation_artifact_hash TEXT NOT NULL CHECK (length(implementation_artifact_hash) = 71 AND substr(implementation_artifact_hash, 1, 7) = 'sha256:' AND substr(implementation_artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  prompt_hash TEXT CHECK (prompt_hash IS NULL OR (length(prompt_hash) = 71 AND substr(prompt_hash, 1, 7) = 'sha256:' AND substr(prompt_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  deterministic_procedure_hash TEXT CHECK (deterministic_procedure_hash IS NULL OR (length(deterministic_procedure_hash) = 71 AND substr(deterministic_procedure_hash, 1, 7) = 'sha256:' AND substr(deterministic_procedure_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    (implementation_kind IN ('deterministic_parser', 'anomaly_validator') AND deterministic_procedure_hash IS NOT NULL AND prompt_hash IS NULL) OR
    (implementation_kind IN ('span_entailment', 'generative_reextraction') AND prompt_hash IS NOT NULL) OR
    implementation_kind = 'authoritative_corroboration'
  ),
  PRIMARY KEY (authority_plan_id, implementation_key),
  UNIQUE (authority_plan_id, ordinal)
) STRICT;

CREATE TABLE provenance_v2_verifier_policy (
  authority_plan_id TEXT NOT NULL REFERENCES provenance_v2_authority_plan(authority_plan_id) ON DELETE RESTRICT,
  verifier_policy_key TEXT NOT NULL CHECK (length(verifier_policy_key) BETWEEN 1 AND 64 AND verifier_policy_key = lower(verifier_policy_key) AND substr(verifier_policy_key, 1, 1) GLOB '[a-z]' AND verifier_policy_key NOT GLOB '*[^a-z0-9_-]*'),
  policy_version TEXT NOT NULL CHECK (length(CAST(policy_version AS BLOB)) BETWEEN 1 AND 128 AND policy_version NOT GLOB '*[^ -~]*'),
  effective_from_ms INTEGER NOT NULL CHECK (typeof(effective_from_ms) = 'integer' AND effective_from_ms BETWEEN 0 AND 253402300799999),
  effective_to_ms INTEGER NOT NULL CHECK (typeof(effective_to_ms) = 'integer' AND effective_to_ms BETWEEN 1 AND 253402300799999),
  profile_kind TEXT NOT NULL CHECK (profile_kind IN (
    'deterministic_structured',
    'span_independent_model',
    'span_independent_deterministic',
    'span_second_authoritative'
  )),
  minimum_member_count INTEGER NOT NULL CHECK (typeof(minimum_member_count) = 'integer' AND minimum_member_count BETWEEN 1 AND 64),
  minimum_distinct_family_count INTEGER NOT NULL CHECK (typeof(minimum_distinct_family_count) = 'integer' AND minimum_distinct_family_count BETWEEN 1 AND 64),
  span_entailment_required INTEGER NOT NULL CHECK (span_entailment_required IN (0, 1)),
  independent_corroboration_required INTEGER NOT NULL CHECK (independent_corroboration_required IN (0, 1)),
  confidence_semantics TEXT NOT NULL CHECK (confidence_semantics IN ('not_applicable', 'scored')),
  minimum_confidence_ppm INTEGER NOT NULL CHECK (typeof(minimum_confidence_ppm) = 'integer' AND minimum_confidence_ppm BETWEEN 0 AND 1000000),
  disagreement_action TEXT NOT NULL CHECK (disagreement_action IN ('quarantine', 'ineligible')),
  content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  CHECK (effective_from_ms < effective_to_ms),
  CHECK (minimum_distinct_family_count <= minimum_member_count),
  CHECK (
    (profile_kind = 'deterministic_structured' AND
      span_entailment_required = 0 AND independent_corroboration_required = 0 AND
      confidence_semantics = 'not_applicable' AND minimum_confidence_ppm = 0) OR
    (profile_kind <> 'deterministic_structured' AND
      span_entailment_required = 1 AND independent_corroboration_required = 1 AND
      confidence_semantics = 'scored' AND minimum_distinct_family_count >= 2)
  ),
  PRIMARY KEY (authority_plan_id, verifier_policy_key)
) STRICT;

CREATE TABLE provenance_v2_verifier_policy_member (
  authority_plan_id TEXT NOT NULL,
  verifier_policy_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 63),
  implementation_key TEXT NOT NULL,
  member_role TEXT NOT NULL CHECK (member_role IN ('primary', 'entailment', 'independent_reextract', 'corroborating_authority', 'anomaly')),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, verifier_policy_key, implementation_key),
  UNIQUE (authority_plan_id, verifier_policy_key, ordinal),
  FOREIGN KEY (authority_plan_id, verifier_policy_key)
    REFERENCES provenance_v2_verifier_policy(authority_plan_id, verifier_policy_key) ON DELETE RESTRICT,
  FOREIGN KEY (authority_plan_id, implementation_key)
    REFERENCES provenance_v2_verifier_implementation(authority_plan_id, implementation_key) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_field_policy (
  authority_plan_id TEXT NOT NULL REFERENCES provenance_v2_authority_plan(authority_plan_id) ON DELETE RESTRICT,
  field_path TEXT NOT NULL REFERENCES provenance_v2_field_path_vocabulary(field_path) ON DELETE RESTRICT,
  policy_version TEXT NOT NULL CHECK (length(CAST(policy_version AS BLOB)) BETWEEN 1 AND 128 AND policy_version NOT GLOB '*[^ -~]*'),
  effective_from_ms INTEGER NOT NULL CHECK (typeof(effective_from_ms) = 'integer' AND effective_from_ms BETWEEN 0 AND 253402300799999),
  effective_to_ms INTEGER NOT NULL CHECK (typeof(effective_to_ms) = 'integer' AND effective_to_ms BETWEEN 1 AND 253402300799999),
  order_kind TEXT NOT NULL CHECK (order_kind IN ('total', 'partial')),
  verifier_policy_key TEXT NOT NULL,
  confidence_semantics TEXT NOT NULL CHECK (confidence_semantics IN ('not_applicable', 'scored')),
  minimum_confidence_ppm INTEGER NOT NULL CHECK (typeof(minimum_confidence_ppm) = 'integer' AND minimum_confidence_ppm BETWEEN 0 AND 1000000),
  equality_rule TEXT NOT NULL CHECK (equality_rule IN ('exact_canonical_bytes', 'exact_price_tuple', 'precision_value_and_scope')),
  conflict_rule TEXT NOT NULL CHECK (conflict_rule IN ('unknown', 'quarantine')),
  quarantine_rule TEXT NOT NULL CHECK (quarantine_rule IN ('affected_field', 'affected_offering', 'provider_bundle')),
  precedence_class_count INTEGER NOT NULL CHECK (typeof(precedence_class_count) = 'integer' AND precedence_class_count BETWEEN 1 AND 512),
  precedence_edge_count INTEGER NOT NULL CHECK (typeof(precedence_edge_count) = 'integer' AND precedence_edge_count BETWEEN 0 AND 4096),
  endpoint_admission_count INTEGER NOT NULL CHECK (typeof(endpoint_admission_count) = 'integer' AND endpoint_admission_count BETWEEN 0 AND 512),
  canonical_bytes_hash TEXT NOT NULL CHECK (length(canonical_bytes_hash) = 71 AND substr(canonical_bytes_hash, 1, 7) = 'sha256:' AND substr(canonical_bytes_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  CHECK (effective_from_ms < effective_to_ms),
  CHECK (confidence_semantics = 'scored' OR minimum_confidence_ppm = 0),
  PRIMARY KEY (authority_plan_id, field_path),
  FOREIGN KEY (authority_plan_id, verifier_policy_key)
    REFERENCES provenance_v2_verifier_policy(authority_plan_id, verifier_policy_key) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_field_policy_precedence_class (
  authority_plan_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  class_key TEXT NOT NULL CHECK (length(class_key) BETWEEN 1 AND 64 AND class_key = lower(class_key) AND substr(class_key, 1, 1) GLOB '[a-z]' AND class_key NOT GLOB '*[^a-z0-9_-]*'),
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 511),
  authority_source_class TEXT NOT NULL CHECK (authority_source_class IN ('provider_exact_api', 'provider_exact_authenticated_catalog', 'provider_controlled_public', 'publisher_checkpoint', 'provider_support_or_changelog', 'independent_structured_catalog')),
  class_hash TEXT NOT NULL UNIQUE CHECK (length(class_hash) = 71 AND substr(class_hash, 1, 7) = 'sha256:' AND substr(class_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, field_path, class_key),
  UNIQUE (authority_plan_id, field_path, ordinal),
  UNIQUE (authority_plan_id, field_path, class_key, authority_source_class),
  FOREIGN KEY (authority_plan_id, field_path)
    REFERENCES provenance_v2_field_policy(authority_plan_id, field_path) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_field_policy_precedence_edge (
  authority_plan_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 4095),
  higher_class_key TEXT NOT NULL,
  lower_class_key TEXT NOT NULL,
  edge_hash TEXT NOT NULL UNIQUE CHECK (length(edge_hash) = 71 AND substr(edge_hash, 1, 7) = 'sha256:' AND substr(edge_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  CHECK (higher_class_key <> lower_class_key),
  PRIMARY KEY (authority_plan_id, field_path, higher_class_key, lower_class_key),
  UNIQUE (authority_plan_id, field_path, ordinal),
  FOREIGN KEY (authority_plan_id, field_path, higher_class_key)
    REFERENCES provenance_v2_field_policy_precedence_class(authority_plan_id, field_path, class_key) ON DELETE RESTRICT,
  FOREIGN KEY (authority_plan_id, field_path, lower_class_key)
    REFERENCES provenance_v2_field_policy_precedence_class(authority_plan_id, field_path, class_key) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_field_policy_endpoint_admission (
  authority_plan_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 511),
  endpoint_id TEXT NOT NULL,
  class_key TEXT NOT NULL,
  authority_source_class TEXT NOT NULL CHECK (authority_source_class IN ('provider_exact_api', 'provider_exact_authenticated_catalog', 'provider_controlled_public', 'publisher_checkpoint', 'provider_support_or_changelog', 'independent_structured_catalog')),
  admission_role TEXT NOT NULL CHECK (admission_role IN ('primary', 'corroborating', 'conflict_detection_only')),
  member_hash TEXT NOT NULL UNIQUE CHECK (length(member_hash) = 71 AND substr(member_hash, 1, 7) = 'sha256:' AND substr(member_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (authority_plan_id, field_path, endpoint_id),
  UNIQUE (authority_plan_id, field_path, ordinal),
  FOREIGN KEY (authority_plan_id, field_path, class_key, authority_source_class)
    REFERENCES provenance_v2_field_policy_precedence_class(authority_plan_id, field_path, class_key, authority_source_class) ON DELETE RESTRICT,
  FOREIGN KEY (authority_plan_id, endpoint_id, authority_source_class)
    REFERENCES provenance_v2_source_endpoint_registration(authority_plan_id, endpoint_id, authority_source_class) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_authority_plan_registration_close (
  authority_plan_id TEXT PRIMARY KEY REFERENCES provenance_v2_authority_plan(authority_plan_id) ON DELETE RESTRICT,
  endpoint_count INTEGER NOT NULL CHECK (typeof(endpoint_count) = 'integer' AND endpoint_count BETWEEN 1 AND 512),
  field_policy_count INTEGER NOT NULL CHECK (typeof(field_policy_count) = 'integer' AND field_policy_count BETWEEN 1 AND 128),
  verifier_policy_count INTEGER NOT NULL CHECK (typeof(verifier_policy_count) = 'integer' AND verifier_policy_count BETWEEN 1 AND 512),
  adapter_manifest_count INTEGER NOT NULL CHECK (typeof(adapter_manifest_count) = 'integer' AND adapter_manifest_count BETWEEN 1 AND 16),
  claimed_authority_root TEXT NOT NULL UNIQUE CHECK (length(claimed_authority_root) = 71 AND substr(claimed_authority_root, 1, 7) = 'sha256:' AND substr(claimed_authority_root, 8) NOT GLOB '*[^0-9a-f]*'),
  closed_at_ms INTEGER NOT NULL CHECK (typeof(closed_at_ms) = 'integer' AND closed_at_ms BETWEEN 0 AND 253402300799999),
  UNIQUE (
    authority_plan_id, endpoint_count, field_policy_count,
    verifier_policy_count, adapter_manifest_count, claimed_authority_root
  )
) STRICT;

CREATE TABLE provenance_v2_authority_plan_oracle_receipt (
  authority_plan_id TEXT PRIMARY KEY,
  oracle_contract_version TEXT NOT NULL CHECK (oracle_contract_version = 'provenance-v2-authority-root@1'),
  oracle_implementation_hash TEXT NOT NULL CHECK (length(oracle_implementation_hash) = 71 AND substr(oracle_implementation_hash, 1, 7) = 'sha256:' AND substr(oracle_implementation_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  endpoint_set_root TEXT NOT NULL CHECK (length(endpoint_set_root) = 71 AND substr(endpoint_set_root, 1, 7) = 'sha256:' AND substr(endpoint_set_root, 8) NOT GLOB '*[^0-9a-f]*'),
  field_policy_set_root TEXT NOT NULL CHECK (length(field_policy_set_root) = 71 AND substr(field_policy_set_root, 1, 7) = 'sha256:' AND substr(field_policy_set_root, 8) NOT GLOB '*[^0-9a-f]*'),
  verifier_policy_set_root TEXT NOT NULL CHECK (length(verifier_policy_set_root) = 71 AND substr(verifier_policy_set_root, 1, 7) = 'sha256:' AND substr(verifier_policy_set_root, 8) NOT GLOB '*[^0-9a-f]*'),
  adapter_manifest_set_root TEXT NOT NULL CHECK (length(adapter_manifest_set_root) = 71 AND substr(adapter_manifest_set_root, 1, 7) = 'sha256:' AND substr(adapter_manifest_set_root, 8) NOT GLOB '*[^0-9a-f]*'),
  endpoint_count INTEGER NOT NULL CHECK (typeof(endpoint_count) = 'integer' AND endpoint_count BETWEEN 1 AND 512),
  field_policy_count INTEGER NOT NULL CHECK (typeof(field_policy_count) = 'integer' AND field_policy_count BETWEEN 1 AND 128),
  verifier_policy_count INTEGER NOT NULL CHECK (typeof(verifier_policy_count) = 'integer' AND verifier_policy_count BETWEEN 1 AND 512),
  adapter_manifest_count INTEGER NOT NULL CHECK (typeof(adapter_manifest_count) = 'integer' AND adapter_manifest_count BETWEEN 1 AND 16),
  authority_root TEXT NOT NULL UNIQUE CHECK (length(authority_root) = 71 AND substr(authority_root, 1, 7) = 'sha256:' AND substr(authority_root, 8) NOT GLOB '*[^0-9a-f]*'),
  verified_at_ms INTEGER NOT NULL CHECK (typeof(verified_at_ms) = 'integer' AND verified_at_ms BETWEEN 0 AND 253402300799999),
  receipt_hash TEXT NOT NULL UNIQUE CHECK (length(receipt_hash) = 71 AND substr(receipt_hash, 1, 7) = 'sha256:' AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  UNIQUE (authority_plan_id, authority_root),
  FOREIGN KEY (
    authority_plan_id, endpoint_count, field_policy_count,
    verifier_policy_count, adapter_manifest_count, authority_root
  ) REFERENCES provenance_v2_authority_plan_registration_close(
    authority_plan_id, endpoint_count, field_policy_count,
    verifier_policy_count, adapter_manifest_count, claimed_authority_root
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    authority_plan_id, endpoint_set_root, field_policy_set_root,
    verifier_policy_set_root, adapter_manifest_set_root
  ) REFERENCES provenance_v2_authority_plan(
    authority_plan_id, endpoint_set_root, field_policy_set_root,
    verifier_policy_set_root, adapter_manifest_set_root
  ) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_authority_plan_approval_intent (
  authority_plan_id TEXT PRIMARY KEY REFERENCES provenance_v2_authority_plan_oracle_receipt(authority_plan_id) ON DELETE RESTRICT,
  artifact_path TEXT NOT NULL CHECK (length(artifact_path) BETWEEN 28 AND 512 AND artifact_path GLOB 'docs/compliance/provenance-v2/*' AND artifact_path NOT GLOB '*[^ -~]*' AND instr(artifact_path, '..') = 0 AND instr(artifact_path, '?') = 0 AND instr(artifact_path, '#') = 0 AND instr(artifact_path, '@') = 0),
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) = 71 AND substr(artifact_hash, 1, 7) = 'sha256:' AND substr(artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  approval_roles_json TEXT NOT NULL CHECK (approval_roles_json = '["legal_source_owner","platform_owner","product_owner"]'),
  authority_root TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms BETWEEN 0 AND 253402300799999),
  FOREIGN KEY (authority_plan_id, authority_root)
    REFERENCES provenance_v2_authority_plan_oracle_receipt(authority_plan_id, authority_root) ON DELETE RESTRICT
) STRICT;

CREATE TABLE provenance_v2_authority_plan_revocation (
  authority_plan_id TEXT PRIMARY KEY REFERENCES provenance_v2_authority_plan_approval(authority_plan_id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('integrity_failure', 'legal_source_revoked', 'platform_authority_revoked', 'product_authority_revoked', 'superseded')),
  effective_at_ms INTEGER NOT NULL CHECK (typeof(effective_at_ms) = 'integer' AND effective_at_ms BETWEEN 0 AND 253402300799999)
) STRICT;


-- The capability row is the only row installed by this slice.
CREATE TRIGGER provenance_v2_registration_integrity_metadata_insert_guard
BEFORE INSERT ON provenance_v2_registration_integrity_metadata
BEGIN SELECT RAISE(ABORT, 'provenance-v2 registration capability cannot be replaced'); END;
CREATE TRIGGER provenance_v2_registration_integrity_metadata_immutable_update
BEFORE UPDATE ON provenance_v2_registration_integrity_metadata
BEGIN SELECT RAISE(ABORT, 'provenance-v2 registration capability is immutable'); END;
CREATE TRIGGER provenance_v2_registration_integrity_metadata_immutable_delete
BEFORE DELETE ON provenance_v2_registration_integrity_metadata
BEGIN SELECT RAISE(ABORT, 'provenance-v2 registration capability cannot be deleted'); END;

-- Every registration and lifecycle row remains explicitly dormant. These
-- blockers are replaced only by the complete separately reviewed activation.
CREATE TRIGGER provenance_v2_source_owner_receipt_activation_blocked
BEFORE INSERT ON provenance_v2_source_owner_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source owner receipt is not activated'); END;
CREATE TRIGGER provenance_v2_source_owner_receipt_immutable_update
BEFORE UPDATE ON provenance_v2_source_owner_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source owner receipt is immutable'); END;
CREATE TRIGGER provenance_v2_source_owner_receipt_immutable_delete
BEFORE DELETE ON provenance_v2_source_owner_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source owner receipt cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_register_receipt_activation_blocked
BEFORE INSERT ON provenance_v2_source_register_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source register receipt is not activated'); END;
CREATE TRIGGER provenance_v2_source_register_receipt_immutable_update
BEFORE UPDATE ON provenance_v2_source_register_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source register receipt is immutable'); END;
CREATE TRIGGER provenance_v2_source_register_receipt_immutable_delete
BEFORE DELETE ON provenance_v2_source_register_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source register receipt cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_register_member_activation_blocked
BEFORE INSERT ON provenance_v2_source_register_member
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source register member is not activated'); END;
CREATE TRIGGER provenance_v2_source_register_member_immutable_update
BEFORE UPDATE ON provenance_v2_source_register_member
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source register member is immutable'); END;
CREATE TRIGGER provenance_v2_source_register_member_immutable_delete
BEFORE DELETE ON provenance_v2_source_register_member
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source register member cannot be deleted'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_receipt_activation_blocked
BEFORE INSERT ON provenance_v2_adapter_manifest_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest receipt is not activated'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_receipt_immutable_update
BEFORE UPDATE ON provenance_v2_adapter_manifest_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest receipt is immutable'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_receipt_immutable_delete
BEFORE DELETE ON provenance_v2_adapter_manifest_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest receipt cannot be deleted'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_environment_activation_blocked
BEFORE INSERT ON provenance_v2_adapter_manifest_environment
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest environment is not activated'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_environment_immutable_update
BEFORE UPDATE ON provenance_v2_adapter_manifest_environment
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest environment is immutable'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_environment_immutable_delete
BEFORE DELETE ON provenance_v2_adapter_manifest_environment
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest environment cannot be deleted'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_credential_activation_blocked
BEFORE INSERT ON provenance_v2_adapter_manifest_credential
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest credential is not activated'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_credential_immutable_update
BEFORE UPDATE ON provenance_v2_adapter_manifest_credential
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest credential is immutable'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_credential_immutable_delete
BEFORE DELETE ON provenance_v2_adapter_manifest_credential
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest credential cannot be deleted'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_source_activation_blocked
BEFORE INSERT ON provenance_v2_adapter_manifest_source
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest source is not activated'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_source_immutable_update
BEFORE UPDATE ON provenance_v2_adapter_manifest_source
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest source is immutable'); END;
CREATE TRIGGER provenance_v2_adapter_manifest_source_immutable_delete
BEFORE DELETE ON provenance_v2_adapter_manifest_source
BEGIN SELECT RAISE(ABORT, 'provenance-v2 adapter manifest source cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_registration_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_registration
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint registration is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_registration_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_registration
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint registration is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_registration_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_registration
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint registration cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_request_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_request
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint request is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_request_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_request
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint request is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_request_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_request
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint request cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_parameter_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_parameter
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint parameter is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_parameter_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_parameter
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint parameter is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_parameter_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_parameter
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint parameter cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_parameter_enum_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_parameter_enum
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint parameter enum is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_parameter_enum_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_parameter_enum
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint parameter enum is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_parameter_enum_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_parameter_enum
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint parameter enum cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_allowed_header_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_allowed_header
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint allowed header is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_allowed_header_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_allowed_header
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint allowed header is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_allowed_header_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_allowed_header
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint allowed header cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_redirect_host_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_redirect_host
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint redirect host is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_redirect_host_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_redirect_host
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint redirect host is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_redirect_host_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_redirect_host
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint redirect host cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_content_type_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_content_type
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint content type is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_content_type_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_content_type
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint content type is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_content_type_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_content_type
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint content type cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_expected_field_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_expected_field
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint expected field is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_expected_field_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_expected_field
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint expected field is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_expected_field_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_expected_field
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint expected field cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_approval_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_approval
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint approval is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_approval_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_approval
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint approval is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_approval_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_approval
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint approval cannot be deleted'); END;
CREATE TRIGGER provenance_v2_source_endpoint_revocation_activation_blocked
BEFORE INSERT ON provenance_v2_source_endpoint_revocation
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint revocation is not activated'); END;
CREATE TRIGGER provenance_v2_source_endpoint_revocation_immutable_update
BEFORE UPDATE ON provenance_v2_source_endpoint_revocation
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint revocation is immutable'); END;
CREATE TRIGGER provenance_v2_source_endpoint_revocation_immutable_delete
BEFORE DELETE ON provenance_v2_source_endpoint_revocation
BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint revocation cannot be deleted'); END;
CREATE TRIGGER provenance_v2_field_path_vocabulary_activation_blocked
BEFORE INSERT ON provenance_v2_field_path_vocabulary
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field path vocabulary is not activated'); END;
CREATE TRIGGER provenance_v2_field_path_vocabulary_immutable_update
BEFORE UPDATE ON provenance_v2_field_path_vocabulary
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field path vocabulary is immutable'); END;
CREATE TRIGGER provenance_v2_field_path_vocabulary_immutable_delete
BEFORE DELETE ON provenance_v2_field_path_vocabulary
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field path vocabulary cannot be deleted'); END;
CREATE TRIGGER provenance_v2_field_policy_activation_blocked
BEFORE INSERT ON provenance_v2_field_policy
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy is not activated'); END;
CREATE TRIGGER provenance_v2_field_policy_immutable_update
BEFORE UPDATE ON provenance_v2_field_policy
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy is immutable'); END;
CREATE TRIGGER provenance_v2_field_policy_immutable_delete
BEFORE DELETE ON provenance_v2_field_policy
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy cannot be deleted'); END;
CREATE TRIGGER provenance_v2_field_policy_precedence_class_activation_blocked
BEFORE INSERT ON provenance_v2_field_policy_precedence_class
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy precedence class is not activated'); END;
CREATE TRIGGER provenance_v2_field_policy_precedence_class_immutable_update
BEFORE UPDATE ON provenance_v2_field_policy_precedence_class
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy precedence class is immutable'); END;
CREATE TRIGGER provenance_v2_field_policy_precedence_class_immutable_delete
BEFORE DELETE ON provenance_v2_field_policy_precedence_class
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy precedence class cannot be deleted'); END;
CREATE TRIGGER provenance_v2_field_policy_precedence_edge_activation_blocked
BEFORE INSERT ON provenance_v2_field_policy_precedence_edge
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy precedence edge is not activated'); END;
CREATE TRIGGER provenance_v2_field_policy_precedence_edge_immutable_update
BEFORE UPDATE ON provenance_v2_field_policy_precedence_edge
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy precedence edge is immutable'); END;
CREATE TRIGGER provenance_v2_field_policy_precedence_edge_immutable_delete
BEFORE DELETE ON provenance_v2_field_policy_precedence_edge
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy precedence edge cannot be deleted'); END;
CREATE TRIGGER provenance_v2_field_policy_endpoint_admission_activation_blocked
BEFORE INSERT ON provenance_v2_field_policy_endpoint_admission
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy endpoint admission is not activated'); END;
CREATE TRIGGER provenance_v2_field_policy_endpoint_admission_immutable_update
BEFORE UPDATE ON provenance_v2_field_policy_endpoint_admission
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy endpoint admission is immutable'); END;
CREATE TRIGGER provenance_v2_field_policy_endpoint_admission_immutable_delete
BEFORE DELETE ON provenance_v2_field_policy_endpoint_admission
BEGIN SELECT RAISE(ABORT, 'provenance-v2 field policy endpoint admission cannot be deleted'); END;
CREATE TRIGGER provenance_v2_verifier_implementation_activation_blocked
BEFORE INSERT ON provenance_v2_verifier_implementation
BEGIN SELECT RAISE(ABORT, 'provenance-v2 verifier implementation is not activated'); END;
CREATE TRIGGER provenance_v2_verifier_implementation_immutable_update
BEFORE UPDATE ON provenance_v2_verifier_implementation
BEGIN SELECT RAISE(ABORT, 'provenance-v2 verifier implementation is immutable'); END;
CREATE TRIGGER provenance_v2_verifier_implementation_immutable_delete
BEFORE DELETE ON provenance_v2_verifier_implementation
BEGIN SELECT RAISE(ABORT, 'provenance-v2 verifier implementation cannot be deleted'); END;
CREATE TRIGGER provenance_v2_verifier_policy_activation_blocked
BEFORE INSERT ON provenance_v2_verifier_policy
BEGIN SELECT RAISE(ABORT, 'provenance-v2 verifier policy is not activated'); END;
CREATE TRIGGER provenance_v2_verifier_policy_immutable_update
BEFORE UPDATE ON provenance_v2_verifier_policy
BEGIN SELECT RAISE(ABORT, 'provenance-v2 verifier policy is immutable'); END;
CREATE TRIGGER provenance_v2_verifier_policy_immutable_delete
BEFORE DELETE ON provenance_v2_verifier_policy
BEGIN SELECT RAISE(ABORT, 'provenance-v2 verifier policy cannot be deleted'); END;
CREATE TRIGGER provenance_v2_verifier_policy_member_activation_blocked
BEFORE INSERT ON provenance_v2_verifier_policy_member
BEGIN SELECT RAISE(ABORT, 'provenance-v2 verifier policy member is not activated'); END;
CREATE TRIGGER provenance_v2_verifier_policy_member_immutable_update
BEFORE UPDATE ON provenance_v2_verifier_policy_member
BEGIN SELECT RAISE(ABORT, 'provenance-v2 verifier policy member is immutable'); END;
CREATE TRIGGER provenance_v2_verifier_policy_member_immutable_delete
BEFORE DELETE ON provenance_v2_verifier_policy_member
BEGIN SELECT RAISE(ABORT, 'provenance-v2 verifier policy member cannot be deleted'); END;
CREATE TRIGGER provenance_v2_authority_plan_registration_close_activation_blocked
BEFORE INSERT ON provenance_v2_authority_plan_registration_close
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan registration close is not activated'); END;
CREATE TRIGGER provenance_v2_authority_plan_registration_close_immutable_update
BEFORE UPDATE ON provenance_v2_authority_plan_registration_close
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan registration close is immutable'); END;
CREATE TRIGGER provenance_v2_authority_plan_registration_close_immutable_delete
BEFORE DELETE ON provenance_v2_authority_plan_registration_close
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan registration close cannot be deleted'); END;
CREATE TRIGGER provenance_v2_authority_plan_oracle_receipt_activation_blocked
BEFORE INSERT ON provenance_v2_authority_plan_oracle_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan oracle receipt is not activated'); END;
CREATE TRIGGER provenance_v2_authority_plan_oracle_receipt_immutable_update
BEFORE UPDATE ON provenance_v2_authority_plan_oracle_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan oracle receipt is immutable'); END;
CREATE TRIGGER provenance_v2_authority_plan_oracle_receipt_immutable_delete
BEFORE DELETE ON provenance_v2_authority_plan_oracle_receipt
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan oracle receipt cannot be deleted'); END;
CREATE TRIGGER provenance_v2_authority_plan_approval_intent_activation_blocked
BEFORE INSERT ON provenance_v2_authority_plan_approval_intent
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan approval intent is not activated'); END;
CREATE TRIGGER provenance_v2_authority_plan_approval_intent_immutable_update
BEFORE UPDATE ON provenance_v2_authority_plan_approval_intent
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan approval intent is immutable'); END;
CREATE TRIGGER provenance_v2_authority_plan_approval_intent_immutable_delete
BEFORE DELETE ON provenance_v2_authority_plan_approval_intent
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan approval intent cannot be deleted'); END;
CREATE TRIGGER provenance_v2_authority_plan_revocation_activation_blocked
BEFORE INSERT ON provenance_v2_authority_plan_revocation
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan revocation is not activated'); END;
CREATE TRIGGER provenance_v2_authority_plan_revocation_immutable_update
BEFORE UPDATE ON provenance_v2_authority_plan_revocation
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan revocation is immutable'); END;
CREATE TRIGGER provenance_v2_authority_plan_revocation_immutable_delete
BEFORE DELETE ON provenance_v2_authority_plan_revocation
BEGIN SELECT RAISE(ABORT, 'provenance-v2 authority plan revocation cannot be deleted'); END;
