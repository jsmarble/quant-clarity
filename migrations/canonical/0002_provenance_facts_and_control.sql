-- QuantClarity canonical D1 schema: provenance, facts, prices, precision, and pipeline state.
-- Requirements: DATA-030–DATA-067, PIPE-001–PIPE-045, BE-001–BE-006, LEG-001–LEG-002.

CREATE TABLE policy_version (
  policy_id TEXT PRIMARY KEY CHECK (length(policy_id) = 40 AND substr(policy_id, 1, 4) = 'pol_' AND policy_id = lower(policy_id)),
  kind TEXT NOT NULL CHECK (kind IN ('source_precedence', 'normalization', 'display_order', 'extraction', 'price_comparison', 'staleness', 'publication')),
  version TEXT NOT NULL,
  effective_at_ms INTEGER NOT NULL CHECK (typeof(effective_at_ms) = 'integer' AND effective_at_ms >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'retired')),
  supersedes_policy_id TEXT REFERENCES policy_version(policy_id) ON DELETE RESTRICT,
  UNIQUE (kind, version),
  CHECK (supersedes_policy_id IS NULL OR supersedes_policy_id <> policy_id)
);

CREATE TABLE source_compliance_record (
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  register_version TEXT NOT NULL,
  artifact_path TEXT NOT NULL CHECK (artifact_path GLOB 'docs/compliance/sources/*'),
  artifact_hash TEXT NOT NULL CHECK (length(artifact_hash) = 71 AND substr(artifact_hash, 1, 7) = 'sha256:' AND substr(artifact_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  source_ids_json TEXT NOT NULL CHECK (json_valid(source_ids_json) AND json_type(source_ids_json) = 'array'),
  reviewer_role TEXT NOT NULL CHECK (reviewer_role <> ''),
  reviewed_at_ms INTEGER NOT NULL CHECK (typeof(reviewed_at_ms) = 'integer' AND reviewed_at_ms >= 0),
  next_review_at_ms INTEGER NOT NULL CHECK (typeof(next_review_at_ms) = 'integer' AND next_review_at_ms > reviewed_at_ms),
  approval_state TEXT NOT NULL CHECK (approval_state IN ('pending', 'approved', 'rejected', 'expired')),
  access_permitted INTEGER NOT NULL CHECK (access_permitted IN (0, 1)),
  retention_permitted INTEGER NOT NULL CHECK (retention_permitted IN (0, 1)),
  excerpt_permitted INTEGER NOT NULL CHECK (excerpt_permitted IN (0, 1)),
  publication_permitted INTEGER NOT NULL CHECK (publication_permitted IN (0, 1)),
  attribution_requirements TEXT NOT NULL,
  restrictions TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  PRIMARY KEY (provider_id, register_version),
  CHECK (
    approval_state <> 'approved' OR
    (access_permitted = 1 AND retention_permitted = 1 AND publication_permitted = 1)
  )
);

CREATE TABLE provider_roster (
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  roster_version TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  PRIMARY KEY (provider_id, roster_version)
);

CREATE TABLE provider_roster_item (
  provider_id TEXT NOT NULL,
  roster_version TEXT NOT NULL,
  roster_item_id TEXT NOT NULL CHECK (roster_item_id <> ''),
  provider_model_id TEXT NOT NULL CHECK (provider_model_id <> ''),
  tier_key TEXT NOT NULL CHECK (tier_key <> ''),
  endpoint_class TEXT NOT NULL CHECK (endpoint_class <> ''),
  material_region_key TEXT NOT NULL,
  model_resource_id TEXT REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  PRIMARY KEY (provider_id, roster_version, roster_item_id),
  FOREIGN KEY (provider_id, roster_version) REFERENCES provider_roster(provider_id, roster_version) ON DELETE RESTRICT
);

CREATE TABLE schedule_occurrence (
  occurrence_id TEXT PRIMARY KEY CHECK (length(occurrence_id) = 40 AND substr(occurrence_id, 1, 4) = 'occ_' AND occurrence_id = lower(occurrence_id)),
  scheduled_at_ms INTEGER NOT NULL CHECK (typeof(scheduled_at_ms) = 'integer' AND scheduled_at_ms >= 0),
  schedule_expression TEXT NOT NULL CHECK (schedule_expression <> ''),
  schedule_name TEXT NOT NULL CHECK (schedule_name <> ''),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  UNIQUE (schedule_name, scheduled_at_ms)
);

CREATE TABLE pipeline_run (
  run_id TEXT PRIMARY KEY CHECK (length(run_id) = 40 AND substr(run_id, 1, 4) = 'run_' AND run_id = lower(run_id)),
  occurrence_id TEXT NOT NULL REFERENCES schedule_occurrence(occurrence_id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (typeof(attempt_number) = 'integer' AND attempt_number >= 1),
  code_version TEXT NOT NULL CHECK (code_version <> ''),
  schema_version TEXT NOT NULL CHECK (schema_version <> ''),
  provider_scope_json TEXT NOT NULL CHECK (json_valid(provider_scope_json) AND json_type(provider_scope_json) = 'array'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'quarantined')),
  started_at_ms INTEGER NOT NULL CHECK (typeof(started_at_ms) = 'integer' AND started_at_ms >= 0),
  ended_at_ms INTEGER CHECK (ended_at_ms IS NULL OR (typeof(ended_at_ms) = 'integer' AND ended_at_ms >= started_at_ms)),
  replay_of_run_id TEXT REFERENCES pipeline_run(run_id) ON DELETE RESTRICT,
  cost_summary_json TEXT CHECK (cost_summary_json IS NULL OR json_valid(cost_summary_json)),
  error_summary_json TEXT CHECK (error_summary_json IS NULL OR json_valid(error_summary_json)),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  UNIQUE (occurrence_id, attempt_number),
  CHECK ((status IN ('pending', 'running') AND ended_at_ms IS NULL) OR (status IN ('succeeded', 'failed', 'quarantined') AND ended_at_ms IS NOT NULL)),
  CHECK (replay_of_run_id IS NULL OR replay_of_run_id <> run_id)
);

CREATE TABLE provider_run (
  provider_run_id TEXT PRIMARY KEY CHECK (length(provider_run_id) = 40 AND substr(provider_run_id, 1, 4) = 'pvr_' AND provider_run_id = lower(provider_run_id)),
  run_id TEXT NOT NULL REFERENCES pipeline_run(run_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  adapter_version TEXT NOT NULL CHECK (adapter_version <> ''),
  roster_version TEXT NOT NULL,
  source_register_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'quarantined')),
  started_at_ms INTEGER NOT NULL CHECK (typeof(started_at_ms) = 'integer' AND started_at_ms >= 0),
  ended_at_ms INTEGER CHECK (ended_at_ms IS NULL OR (typeof(ended_at_ms) = 'integer' AND ended_at_ms >= started_at_ms)),
  error_summary_json TEXT CHECK (error_summary_json IS NULL OR json_valid(error_summary_json)),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  UNIQUE (run_id, provider_id),
  FOREIGN KEY (provider_id, roster_version) REFERENCES provider_roster(provider_id, roster_version) ON DELETE RESTRICT,
  FOREIGN KEY (provider_id, source_register_version) REFERENCES source_compliance_record(provider_id, register_version) ON DELETE RESTRICT,
  CHECK ((status IN ('pending', 'running') AND ended_at_ms IS NULL) OR (status IN ('succeeded', 'failed', 'quarantined') AND ended_at_ms IS NOT NULL))
);

CREATE TABLE acquisition_run (
  acquisition_run_id TEXT PRIMARY KEY CHECK (length(acquisition_run_id) = 40 AND substr(acquisition_run_id, 1, 4) = 'src_' AND acquisition_run_id = lower(acquisition_run_id)),
  run_id TEXT NOT NULL REFERENCES pipeline_run(run_id) ON DELETE RESTRICT,
  provider_run_id TEXT REFERENCES provider_run(provider_run_id) ON DELETE RESTRICT,
  source_owner_organization_id TEXT NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('provider_api', 'authenticated_catalog', 'public_static_page', 'public_rendered_page', 'publisher_checkpoint_repository')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'quarantined')),
  started_at_ms INTEGER NOT NULL CHECK (typeof(started_at_ms) = 'integer' AND started_at_ms >= 0),
  ended_at_ms INTEGER CHECK (ended_at_ms IS NULL OR (typeof(ended_at_ms) = 'integer' AND ended_at_ms >= started_at_ms)),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  CHECK ((status IN ('pending', 'running') AND ended_at_ms IS NULL) OR (status IN ('succeeded', 'failed', 'quarantined') AND ended_at_ms IS NOT NULL))
);

CREATE TABLE observation (
  observation_id TEXT PRIMARY KEY CHECK (length(observation_id) = 40 AND substr(observation_id, 1, 4) = 'obs_' AND observation_id = lower(observation_id)),
  acquisition_run_id TEXT NOT NULL REFERENCES acquisition_run(acquisition_run_id) ON DELETE RESTRICT,
  source_id TEXT NOT NULL CHECK (source_id <> ''),
  source_type TEXT NOT NULL CHECK (source_type IN ('provider_api', 'authenticated_catalog', 'public_static_page', 'public_rendered_page', 'publisher_checkpoint_repository')),
  source_owner TEXT NOT NULL CHECK (source_owner <> ''),
  safe_locator TEXT NOT NULL CHECK (
    safe_locator GLOB 'https://*' AND length(safe_locator) <= 2048 AND
    instr(safe_locator, '?') = 0 AND instr(safe_locator, '#') = 0 AND instr(safe_locator, '@') = 0
  ),
  retrieved_at_ms INTEGER NOT NULL CHECK (typeof(retrieved_at_ms) = 'integer' AND retrieved_at_ms >= 0),
  extraction_method TEXT NOT NULL CHECK (extraction_method <> ''),
  extraction_version TEXT NOT NULL CHECK (extraction_version <> ''),
  policy_id TEXT NOT NULL REFERENCES policy_version(policy_id) ON DELETE RESTRICT,
  redacted_hash TEXT NOT NULL CHECK (length(redacted_hash) = 71 AND substr(redacted_hash, 1, 7) = 'sha256:' AND substr(redacted_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  http_metadata_json TEXT CHECK (http_metadata_json IS NULL OR json_valid(http_metadata_json)),
  authenticated_only INTEGER NOT NULL CHECK (authenticated_only IN (0, 1)),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

CREATE TABLE evidence (
  evidence_id TEXT PRIMARY KEY CHECK (length(evidence_id) = 40 AND substr(evidence_id, 1, 4) = 'evd_' AND evidence_id = lower(evidence_id)),
  observation_id TEXT NOT NULL REFERENCES observation(observation_id) ON DELETE RESTRICT,
  private_r2_key TEXT NOT NULL CHECK (private_r2_key <> ''),
  public_summary_json TEXT NOT NULL CHECK (json_valid(public_summary_json) AND json_type(public_summary_json) = 'object'),
  source_span_locator TEXT NOT NULL CHECK (source_span_locator <> '' AND length(source_span_locator) <= 2048),
  integrity_hash TEXT NOT NULL CHECK (length(integrity_hash) = 71 AND substr(integrity_hash, 1, 7) = 'sha256:' AND substr(integrity_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  retention_class TEXT NOT NULL CHECK (retention_class = 'private_24_month_minimum'),
  public_source_url TEXT CHECK (public_source_url IS NULL OR (public_source_url GLOB 'https://*' AND instr(public_source_url, '?') = 0 AND instr(public_source_url, '#') = 0 AND instr(public_source_url, '@') = 0)),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  UNIQUE (evidence_id, observation_id)
);

CREATE TABLE field_claim (
  claim_id TEXT PRIMARY KEY CHECK (length(claim_id) = 40 AND substr(claim_id, 1, 4) = 'clm_' AND claim_id = lower(claim_id)),
  subject_resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL CHECK (field_name <> ''),
  raw_value_json TEXT NOT NULL CHECK (json_valid(raw_value_json)),
  normalized_value_json TEXT NOT NULL CHECK (json_valid(normalized_value_json)),
  value_state TEXT NOT NULL CHECK (value_state IN ('known', 'unknown', 'not_applicable', 'unavailable')),
  observation_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  scope_id TEXT NOT NULL REFERENCES claim_scope(scope_id) ON DELETE RESTRICT,
  precedence_class TEXT NOT NULL CHECK (precedence_class <> ''),
  verification_state TEXT NOT NULL CHECK (verification_state IN ('candidate', 'verified', 'quarantined', 'rejected')),
  policy_id TEXT NOT NULL REFERENCES policy_version(policy_id) ON DELETE RESTRICT,
  valid_from_ms INTEGER NOT NULL CHECK (typeof(valid_from_ms) = 'integer' AND valid_from_ms >= 0),
  valid_to_ms INTEGER CHECK (valid_to_ms IS NULL OR (typeof(valid_to_ms) = 'integer' AND valid_to_ms >= valid_from_ms)),
  supersedes_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  qualifiers_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(qualifiers_json) AND json_type(qualifiers_json) = 'object'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  FOREIGN KEY (evidence_id, observation_id) REFERENCES evidence(evidence_id, observation_id) ON DELETE RESTRICT,
  CHECK ((value_state = 'known' AND json_type(raw_value_json) <> 'null' AND json_type(normalized_value_json) <> 'null') OR (value_state <> 'known' AND json_type(raw_value_json) = 'null' AND json_type(normalized_value_json) = 'null')),
  CHECK (supersedes_claim_id IS NULL OR supersedes_claim_id <> claim_id)
);

CREATE TABLE claim_conflict (
  conflict_id TEXT PRIMARY KEY CHECK (length(conflict_id) = 40 AND substr(conflict_id, 1, 4) = 'cfl_' AND conflict_id = lower(conflict_id)),
  subject_resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL CHECK (field_name <> ''),
  left_claim_id TEXT NOT NULL REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  right_claim_id TEXT NOT NULL REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  resolution TEXT NOT NULL CHECK (resolution IN ('unresolved_unknown', 'left_selected', 'right_selected', 'other_deterministic')),
  resolved_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  CHECK (left_claim_id <> right_claim_id),
  CHECK ((resolution = 'unresolved_unknown' AND resolved_claim_id IS NULL) OR (resolution <> 'unresolved_unknown' AND resolved_claim_id IS NOT NULL)),
  UNIQUE (left_claim_id, right_claim_id)
);

CREATE TABLE parameter_fact (
  parameter_fact_id TEXT PRIMARY KEY CHECK (length(parameter_fact_id) = 40 AND substr(parameter_fact_id, 1, 4) = 'par_' AND parameter_fact_id = lower(parameter_fact_id)),
  model_resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  parameter_kind TEXT NOT NULL CHECK (parameter_kind IN ('total', 'active')),
  raw_value TEXT NOT NULL CHECK (raw_value <> ''),
  normalized_decimal TEXT,
  approximation_state TEXT NOT NULL CHECK (approximation_state IN ('exact', 'approximate', 'unknown')),
  qualifier TEXT,
  claim_id TEXT NOT NULL UNIQUE REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  CHECK ((approximation_state = 'unknown' AND normalized_decimal IS NULL) OR (approximation_state <> 'unknown' AND normalized_decimal IS NOT NULL)),
  CHECK (normalized_decimal IS NULL OR (normalized_decimal GLOB '[0-9]*' AND normalized_decimal NOT GLOB '*[^0-9]*'))
);

CREATE TABLE precision_observation (
  precision_id TEXT PRIMARY KEY CHECK (length(precision_id) = 40 AND substr(precision_id, 1, 4) = 'prc_' AND precision_id = lower(precision_id)),
  offering_id TEXT NOT NULL REFERENCES offering(offering_id) ON DELETE RESTRICT,
  claim_id TEXT NOT NULL UNIQUE REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  normalized_format TEXT NOT NULL CHECK (normalized_format <> ''),
  summary_format TEXT NOT NULL CHECK (summary_format <> ''),
  raw_field_name TEXT NOT NULL CHECK (raw_field_name <> ''),
  raw_precision TEXT NOT NULL CHECK (raw_precision <> ''),
  scope_id TEXT NOT NULL REFERENCES claim_scope(scope_id) ON DELETE RESTRICT,
  provider_definition TEXT,
  format_variant TEXT,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

CREATE TABLE precision_component (
  precision_component_id TEXT PRIMARY KEY CHECK (length(precision_component_id) = 40 AND substr(precision_component_id, 1, 4) = 'cmp_' AND precision_component_id = lower(precision_component_id)),
  precision_id TEXT NOT NULL REFERENCES precision_observation(precision_id) ON DELETE RESTRICT,
  component TEXT NOT NULL CHECK (component <> ''),
  normalized_format TEXT NOT NULL CHECK (normalized_format <> ''),
  format_variant TEXT,
  claim_id TEXT NOT NULL UNIQUE REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  UNIQUE (precision_id, component)
);

CREATE TABLE price_schedule (
  price_id TEXT PRIMARY KEY CHECK (length(price_id) = 40 AND substr(price_id, 1, 4) = 'pcs_' AND price_id = lower(price_id)),
  offering_id TEXT NOT NULL REFERENCES offering(offering_id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('input', 'output', 'cached_input')),
  price_class TEXT NOT NULL CHECK (price_class IN ('standard', 'promotional', 'batch', 'subscription', 'committed', 'volume', 'dedicated', 'region_tiered', 'context_tiered', 'other_conditional')),
  amount_decimal TEXT NOT NULL CHECK (
    amount_decimal <> '' AND length(amount_decimal) <= 43 AND amount_decimal NOT GLOB '*[^0-9.]*' AND
    amount_decimal NOT LIKE '.%' AND amount_decimal NOT LIKE '%.' AND
    amount_decimal NOT LIKE '%.%.%' AND (amount_decimal = '0' OR amount_decimal NOT GLOB '0[0-9]*') AND
    CASE WHEN instr(amount_decimal, '.') = 0
      THEN length(amount_decimal) <= 24
      ELSE instr(amount_decimal, '.') - 1 <= 24 AND length(amount_decimal) - instr(amount_decimal, '.') BETWEEN 1 AND 18
    END
  ),
  amount_sort_key TEXT NOT NULL CHECK (
    length(amount_sort_key) = 43 AND substr(amount_sort_key, 25, 1) = '.' AND
    substr(amount_sort_key, 1, 24) NOT GLOB '*[^0-9]*' AND
    substr(amount_sort_key, 26, 18) NOT GLOB '*[^0-9]*'
  ),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency) AND currency NOT GLOB '*[^A-Z]*'),
  currency_provenance TEXT NOT NULL CHECK (currency_provenance IN ('provider_stated', 'system_default')),
  currency_presence TEXT NOT NULL CHECK (currency_presence IN ('stated', 'omitted')),
  unit TEXT NOT NULL CHECK (unit = 'per_million_tokens'),
  conditions_json TEXT NOT NULL CHECK (json_valid(conditions_json) AND json_type(conditions_json) = 'array'),
  condition_hash TEXT NOT NULL CHECK (length(condition_hash) = 71 AND substr(condition_hash, 1, 7) = 'sha256:' AND substr(condition_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  is_standard_comparable INTEGER NOT NULL CHECK (is_standard_comparable IN (0, 1)),
  comparison_policy_id TEXT NOT NULL REFERENCES policy_version(policy_id) ON DELETE RESTRICT,
  claim_id TEXT NOT NULL UNIQUE REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  observed_at_ms INTEGER NOT NULL CHECK (typeof(observed_at_ms) = 'integer' AND observed_at_ms >= 0),
  effective_from_ms INTEGER CHECK (effective_from_ms IS NULL OR (typeof(effective_from_ms) = 'integer' AND effective_from_ms >= 0)),
  effective_to_ms INTEGER CHECK (effective_to_ms IS NULL OR (typeof(effective_to_ms) = 'integer' AND effective_to_ms >= COALESCE(effective_from_ms, 0))),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  CHECK ((currency_provenance = 'system_default' AND currency_presence = 'omitted' AND currency = 'USD') OR (currency_provenance = 'provider_stated' AND currency_presence = 'stated')),
  CHECK (is_standard_comparable = 0 OR (price_class = 'standard' AND conditions_json = '[]'))
);

CREATE UNIQUE INDEX price_schedule_effective_uq ON price_schedule(offering_id, role, price_class, currency, condition_hash, effective_from_ms) WHERE effective_from_ms IS NOT NULL;
CREATE UNIQUE INDEX price_schedule_no_effective_uq ON price_schedule(offering_id, role, price_class, currency, condition_hash) WHERE effective_from_ms IS NULL;

CREATE TABLE roster_outcome (
  outcome_id TEXT PRIMARY KEY CHECK (length(outcome_id) = 40 AND substr(outcome_id, 1, 4) = 'out_' AND outcome_id = lower(outcome_id)),
  provider_run_id TEXT NOT NULL REFERENCES provider_run(provider_run_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL,
  roster_version TEXT NOT NULL,
  roster_item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published_candidate', 'published_candidate_with_unknowns', 'unavailable', 'failed', 'quarantined')),
  evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id) ON DELETE RESTRICT,
  offering_id TEXT REFERENCES offering(offering_id) ON DELETE RESTRICT,
  error_code TEXT,
  attempt_count INTEGER NOT NULL CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 1),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  UNIQUE (provider_run_id, roster_item_id),
  FOREIGN KEY (provider_id, roster_version, roster_item_id) REFERENCES provider_roster_item(provider_id, roster_version, roster_item_id) ON DELETE RESTRICT,
  CHECK (status NOT IN ('published_candidate', 'published_candidate_with_unknowns') OR offering_id IS NOT NULL),
  CHECK (status NOT IN ('failed', 'quarantined') OR error_code IS NOT NULL)
);

CREATE TABLE anomaly (
  anomaly_id TEXT PRIMARY KEY CHECK (length(anomaly_id) = 40 AND substr(anomaly_id, 1, 4) = 'anm_' AND anomaly_id = lower(anomaly_id)),
  provider_run_id TEXT NOT NULL REFERENCES provider_run(provider_run_id) ON DELETE RESTRICT,
  subject_resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind <> ''),
  status TEXT NOT NULL CHECK (status IN ('detected', 'reread_confirmed', 'resolved', 'quarantined')),
  first_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  second_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  CHECK (first_claim_id IS NULL OR second_claim_id IS NULL OR first_claim_id <> second_claim_id)
);

CREATE TABLE quarantine (
  quarantine_id TEXT PRIMARY KEY CHECK (length(quarantine_id) = 40 AND substr(quarantine_id, 1, 4) = 'qrn_' AND quarantine_id = lower(quarantine_id)),
  provider_run_id TEXT NOT NULL REFERENCES provider_run(provider_run_id) ON DELETE RESTRICT,
  subject_resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL CHECK (reason_code <> ''),
  released_at_ms INTEGER CHECK (released_at_ms IS NULL OR (typeof(released_at_ms) = 'integer' AND released_at_ms >= 0)),
  release_evidence_id TEXT REFERENCES evidence(evidence_id) ON DELETE RESTRICT,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  CHECK ((released_at_ms IS NULL AND release_evidence_id IS NULL) OR (released_at_ms IS NOT NULL AND release_evidence_id IS NOT NULL))
);

CREATE INDEX field_claim_selection_idx ON field_claim(subject_resource_id, field_name, verification_state, valid_from_ms DESC, claim_id);
CREATE INDEX field_claim_scope_idx ON field_claim(scope_id, subject_resource_id, field_name);
CREATE INDEX observation_acquisition_idx ON observation(acquisition_run_id, retrieved_at_ms, observation_id);
CREATE INDEX evidence_observation_idx ON evidence(observation_id, evidence_id);
CREATE INDEX precision_offering_idx ON precision_observation(offering_id, normalized_format, precision_id);
CREATE INDEX price_neutral_sort_idx ON price_schedule(currency, role, is_standard_comparable, amount_sort_key, offering_id, price_id);
CREATE INDEX roster_outcome_staleness_idx ON roster_outcome(offering_id, status, provider_run_id);
