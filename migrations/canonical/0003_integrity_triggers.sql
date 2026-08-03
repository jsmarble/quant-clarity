-- Cross-table constraints and append-oriented audit protection.
-- Requirements: DATA-051, DATA-060, PIPE-020–PIPE-022, BE-005–BE-006, QA-012.

CREATE TRIGGER organization_identity_type_insert
BEFORE INSERT ON organization
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.organization_id AND resource_type = 'organization'
  ) THEN RAISE(ABORT, 'organization identity type mismatch') END;
END;

CREATE TRIGGER model_family_identity_type_insert
BEFORE INSERT ON model_family
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.family_id AND resource_type = 'model_family'
  ) THEN RAISE(ABORT, 'model family identity type mismatch') END;
END;

CREATE TRIGGER model_identity_type_insert
BEFORE INSERT ON model
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.model_id AND resource_type = 'model'
  ) THEN RAISE(ABORT, 'model identity type mismatch') END;
END;

CREATE TRIGGER model_variant_identity_type_insert
BEFORE INSERT ON model_variant
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.variant_id AND resource_type = 'model_variant'
  ) THEN RAISE(ABORT, 'variant identity type mismatch') END;
END;

CREATE TRIGGER checkpoint_identity_type_insert
BEFORE INSERT ON checkpoint
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.checkpoint_id AND resource_type = 'checkpoint'
  ) THEN RAISE(ABORT, 'checkpoint identity type mismatch') END;
END;

CREATE TRIGGER provider_identity_type_insert
BEFORE INSERT ON provider
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.provider_id AND resource_type = 'provider'
  ) THEN RAISE(ABORT, 'provider identity type mismatch') END;
END;

CREATE TRIGGER offering_identity_type_insert
BEFORE INSERT ON offering
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.offering_id AND resource_type = 'offering'
  ) THEN RAISE(ABORT, 'offering identity type mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.model_resource_id AND resource_type IN ('model', 'model_variant')
  ) THEN RAISE(ABORT, 'offering model target type mismatch') END;
END;

CREATE TRIGGER offering_model_type_update
BEFORE UPDATE OF model_resource_id ON offering
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.model_resource_id AND resource_type IN ('model', 'model_variant')
  ) THEN RAISE(ABORT, 'offering model target type mismatch') END;
END;

CREATE TRIGGER model_alias_target_type_insert
BEFORE INSERT ON model_alias
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.target_resource_id AND resource_type IN ('model', 'model_variant')
  ) THEN RAISE(ABORT, 'model alias target type mismatch') END;
  SELECT CASE WHEN NEW.alias_kind = 'explicit_variant_identifier' AND NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.target_resource_id AND resource_type = 'model_variant'
  ) THEN RAISE(ABORT, 'explicit variant alias must target a variant') END;
END;

CREATE TRIGGER model_checkpoint_target_type_insert
BEFORE INSERT ON model_checkpoint
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.model_resource_id AND resource_type IN ('model', 'model_variant')
  ) THEN RAISE(ABORT, 'model checkpoint target type mismatch') END;
END;

CREATE TRIGGER claim_scope_subject_type_insert
BEFORE INSERT ON claim_scope
BEGIN
  SELECT CASE WHEN NEW.scope_kind = 'model' AND NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.subject_resource_id AND resource_type IN ('model', 'model_variant')
  ) THEN RAISE(ABORT, 'model scope subject type mismatch') END;
  SELECT CASE WHEN NEW.scope_kind = 'checkpoint' AND NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.subject_resource_id AND resource_type = 'checkpoint'
  ) THEN RAISE(ABORT, 'checkpoint scope subject type mismatch') END;
  SELECT CASE WHEN NEW.scope_kind = 'provider' AND NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.subject_resource_id AND resource_type = 'provider'
  ) THEN RAISE(ABORT, 'provider scope subject type mismatch') END;
  SELECT CASE WHEN NEW.scope_kind = 'offering' AND NOT EXISTS (
    SELECT 1 FROM offering o
    WHERE o.offering_id = NEW.subject_resource_id
      AND o.provider_id = NEW.provider_id
      AND o.provider_model_id = NEW.provider_model_id
      AND o.tier_key = NEW.tier_key
      AND o.endpoint_class = NEW.endpoint_class
      AND o.material_region_key = NEW.material_region_key
  ) THEN RAISE(ABORT, 'offering scope does not equal offering identity') END;
END;

CREATE TRIGGER field_claim_scope_subject_insert
BEFORE INSERT ON field_claim
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM claim_scope WHERE scope_id = NEW.scope_id AND subject_resource_id = NEW.subject_resource_id
  ) THEN RAISE(ABORT, 'claim scope subject mismatch') END;
  SELECT CASE WHEN (
    NEW.field_name LIKE 'price.%' OR
    NEW.field_name = 'serving_precision' OR
    NEW.field_name LIKE 'serving_precision.%'
  ) AND NOT EXISTS (
    SELECT 1 FROM claim_scope WHERE scope_id = NEW.scope_id AND scope_kind = 'offering' AND complete = 1
  ) THEN RAISE(ABORT, 'price or precision claim lacks exact offering scope') END;
  SELECT CASE WHEN NEW.supersedes_claim_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM field_claim prior
    WHERE prior.claim_id = NEW.supersedes_claim_id
      AND prior.subject_resource_id = NEW.subject_resource_id
      AND prior.field_name = NEW.field_name
      AND prior.scope_id = NEW.scope_id
  ) THEN RAISE(ABORT, 'superseded claim has different subject, field, or scope') END;
END;

CREATE TRIGGER parameter_fact_claim_insert
BEFORE INSERT ON parameter_fact
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM resource_identity WHERE resource_id = NEW.model_resource_id AND resource_type IN ('model', 'model_variant')
  ) THEN RAISE(ABORT, 'parameter target type mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM field_claim
    WHERE claim_id = NEW.claim_id
      AND subject_resource_id = NEW.model_resource_id
      AND field_name = CASE NEW.parameter_kind WHEN 'total' THEN 'total_parameters' ELSE 'active_parameters' END
      AND verification_state = 'verified'
      AND value_state = 'known'
  ) THEN RAISE(ABORT, 'parameter claim mismatch') END;
END;

CREATE TRIGGER precision_observation_applicability_insert
BEFORE INSERT ON precision_observation
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM field_claim c
    JOIN claim_scope s ON s.scope_id = c.scope_id
    JOIN offering o ON o.offering_id = NEW.offering_id
    WHERE c.claim_id = NEW.claim_id
      AND c.subject_resource_id = NEW.offering_id
      AND c.field_name = 'serving_precision'
      AND c.verification_state = 'verified'
      AND c.value_state = 'known'
      AND json_type(c.normalized_value_json) = 'text'
      AND json_extract(c.normalized_value_json, '$') = NEW.normalized_format
      AND c.scope_id = NEW.scope_id
      AND s.scope_kind = 'offering'
      AND s.complete = 1
      AND s.provider_id = o.provider_id
      AND s.provider_model_id = o.provider_model_id
      AND s.tier_key = o.tier_key
      AND s.endpoint_class = o.endpoint_class
      AND s.material_region_key = o.material_region_key
      AND s.component_scope IS NULL
  ) THEN RAISE(ABORT, 'precision applicability mismatch') END;
END;

CREATE TRIGGER precision_component_applicability_insert
BEFORE INSERT ON precision_component
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM precision_observation p
    JOIN field_claim c ON c.claim_id = NEW.claim_id
    JOIN claim_scope s ON s.scope_id = c.scope_id
    JOIN offering o ON o.offering_id = p.offering_id
    WHERE p.precision_id = NEW.precision_id
      AND c.subject_resource_id = p.offering_id
      AND c.field_name = 'serving_precision.' || NEW.component
      AND c.verification_state = 'verified'
      AND c.value_state = 'known'
      AND json_type(c.normalized_value_json) = 'text'
      AND json_extract(c.normalized_value_json, '$') = NEW.normalized_format
      AND s.scope_kind = 'offering'
      AND s.complete = 1
      AND s.subject_resource_id = p.offering_id
      AND s.provider_id = o.provider_id
      AND s.provider_model_id = o.provider_model_id
      AND s.tier_key = o.tier_key
      AND s.endpoint_class = o.endpoint_class
      AND s.material_region_key = o.material_region_key
      AND s.component_scope = NEW.component
  ) THEN RAISE(ABORT, 'precision component applicability mismatch') END;
END;

CREATE TRIGGER price_schedule_applicability_insert
BEFORE INSERT ON price_schedule
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM field_claim c
    JOIN claim_scope s ON s.scope_id = c.scope_id
    JOIN offering o ON o.offering_id = NEW.offering_id
    WHERE c.claim_id = NEW.claim_id
      AND c.subject_resource_id = NEW.offering_id
      AND c.field_name = 'price.' || NEW.role
      AND c.verification_state = 'verified'
      AND c.value_state = 'known'
      AND json_type(c.normalized_value_json) = 'text'
      AND json_extract(c.normalized_value_json, '$') = NEW.amount_decimal
      AND s.scope_kind = 'offering'
      AND s.complete = 1
      AND s.provider_id = o.provider_id
      AND s.provider_model_id = o.provider_model_id
      AND s.tier_key = o.tier_key
      AND s.endpoint_class = o.endpoint_class
      AND s.material_region_key = o.material_region_key
      AND s.component_scope IS NULL
  ) THEN RAISE(ABORT, 'price applicability mismatch') END;
END;

CREATE TRIGGER price_schedule_sort_key_insert
BEFORE INSERT ON price_schedule
BEGIN
  SELECT CASE WHEN NEW.amount_sort_key <> (
    substr(
      '000000000000000000000000' ||
      CASE WHEN instr(NEW.amount_decimal, '.') = 0
        THEN NEW.amount_decimal
        ELSE substr(NEW.amount_decimal, 1, instr(NEW.amount_decimal, '.') - 1)
      END,
      -24,
      24
    ) || '.' || substr(
      CASE WHEN instr(NEW.amount_decimal, '.') = 0
        THEN ''
        ELSE substr(NEW.amount_decimal, instr(NEW.amount_decimal, '.') + 1)
      END || '000000000000000000',
      1,
      18
    )
  ) THEN RAISE(ABORT, 'price amount and sort key do not round-trip') END;
END;

CREATE TRIGGER acquisition_run_provider_run_insert
BEFORE INSERT ON acquisition_run
WHEN NEW.provider_run_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM provider_run
    WHERE provider_run_id = NEW.provider_run_id AND run_id = NEW.run_id
      AND status IN ('pending', 'running')
  ) THEN RAISE(ABORT, 'acquisition and provider run mismatch') END;
END;

CREATE TRIGGER observation_source_type_insert
BEFORE INSERT ON observation
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM acquisition_run a
    WHERE a.acquisition_run_id = NEW.acquisition_run_id
      AND a.source_type = NEW.source_type
      AND a.status IN ('pending', 'running')
      AND (
        a.provider_run_id IS NULL OR EXISTS (
          SELECT 1 FROM provider_run pr
          WHERE pr.provider_run_id = a.provider_run_id
            AND pr.status IN ('pending', 'running')
        )
      )
  ) THEN RAISE(ABORT, 'observation and acquisition source type mismatch') END;
END;

CREATE TRIGGER observation_approved_source_insert
BEFORE INSERT ON observation
WHEN EXISTS (
  SELECT 1 FROM acquisition_run
  WHERE acquisition_run_id = NEW.acquisition_run_id AND provider_run_id IS NOT NULL
)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM acquisition_run a
    JOIN provider_run pr ON pr.provider_run_id = a.provider_run_id
    JOIN source_compliance_record compliance
      ON compliance.provider_id = pr.provider_id
     AND compliance.register_version = pr.source_register_version
    JOIN json_each(compliance.source_ids_json) source
    WHERE a.acquisition_run_id = NEW.acquisition_run_id
      AND source.type = 'text'
      AND source.value = NEW.source_id
      AND compliance.approval_state = 'approved'
      AND compliance.access_permitted = 1
      AND compliance.retention_permitted = 1
      AND compliance.excerpt_permitted = 1
      AND compliance.publication_permitted = 1
  ) THEN RAISE(ABORT, 'observation source is not in the approved register') END;
END;

CREATE TRIGGER roster_outcome_provider_run_insert
BEFORE INSERT ON roster_outcome
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM provider_run
    WHERE provider_run_id = NEW.provider_run_id
      AND provider_id = NEW.provider_id
      AND roster_version = NEW.roster_version
  ) THEN RAISE(ABORT, 'roster outcome provider run mismatch') END;
  SELECT CASE WHEN NEW.offering_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM offering WHERE offering_id = NEW.offering_id AND provider_id = NEW.provider_id
  ) THEN RAISE(ABORT, 'roster outcome offering provider mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM evidence e
    JOIN observation o ON o.observation_id = e.observation_id
    JOIN acquisition_run a ON a.acquisition_run_id = o.acquisition_run_id
    WHERE e.evidence_id = NEW.evidence_id
      AND a.provider_run_id = NEW.provider_run_id
  ) THEN RAISE(ABORT, 'roster outcome evidence provider run mismatch') END;
END;

CREATE TRIGGER provider_run_must_start_nonterminal
BEFORE INSERT ON provider_run
WHEN NEW.status NOT IN ('pending', 'running')
BEGIN
  SELECT RAISE(ABORT, 'provider run must start before becoming terminal');
END;

CREATE TRIGGER pipeline_run_must_start_nonterminal
BEFORE INSERT ON pipeline_run
WHEN NEW.status NOT IN ('pending', 'running')
BEGIN SELECT RAISE(ABORT, 'pipeline run must start before becoming terminal'); END;

CREATE TRIGGER acquisition_run_must_start_nonterminal
BEFORE INSERT ON acquisition_run
WHEN NEW.status NOT IN ('pending', 'running')
BEGIN SELECT RAISE(ABORT, 'acquisition run must start before becoming terminal'); END;

CREATE TRIGGER provider_run_source_approval_insert
BEFORE INSERT ON provider_run
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM source_compliance_record
    WHERE provider_id = NEW.provider_id
      AND register_version = NEW.source_register_version
      AND approval_state = 'approved'
      AND access_permitted = 1
      AND retention_permitted = 1
      AND excerpt_permitted = 1
      AND publication_permitted = 1
      AND next_review_at_ms > NEW.started_at_ms
  ) THEN RAISE(ABORT, 'provider run lacks current source approval') END;
END;

CREATE TRIGGER provider_run_terminal_roster_update
BEFORE UPDATE OF status, ended_at_ms ON provider_run
WHEN NEW.status IN ('succeeded', 'failed', 'quarantined')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM acquisition_run
    WHERE provider_run_id = NEW.provider_run_id AND status IN ('pending', 'running')
  ) THEN RAISE(ABORT, 'provider run has nonterminal acquisitions') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM provider_roster_item item
    WHERE item.provider_id = NEW.provider_id
      AND item.roster_version = NEW.roster_version
      AND NOT EXISTS (
        SELECT 1 FROM roster_outcome outcome
        WHERE outcome.provider_run_id = NEW.provider_run_id
          AND outcome.provider_id = item.provider_id
          AND outcome.roster_version = item.roster_version
          AND outcome.roster_item_id = item.roster_item_id
      )
  ) THEN RAISE(ABORT, 'provider run has missing roster outcomes') END;
END;

CREATE TRIGGER pipeline_run_terminal_children_update
BEFORE UPDATE OF status, ended_at_ms ON pipeline_run
WHEN NEW.status IN ('succeeded', 'failed', 'quarantined')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM provider_run
    WHERE run_id = NEW.run_id AND status IN ('pending', 'running')
  ) OR EXISTS (
    SELECT 1 FROM acquisition_run
    WHERE run_id = NEW.run_id AND status IN ('pending', 'running')
  ) THEN RAISE(ABORT, 'pipeline run has nonterminal children') END;
END;

CREATE TRIGGER provider_run_state_transition
BEFORE UPDATE OF status ON provider_run
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.status = 'pending' AND NEW.status IN ('pending', 'running', 'failed', 'quarantined')) OR
    (OLD.status = 'running' AND NEW.status IN ('running', 'succeeded', 'failed', 'quarantined')) OR
    OLD.status = NEW.status
  ) THEN RAISE(ABORT, 'invalid provider run state transition') END;
END;

CREATE TRIGGER pipeline_run_state_transition
BEFORE UPDATE OF status ON pipeline_run
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.status = 'pending' AND NEW.status IN ('pending', 'running', 'failed', 'quarantined')) OR
    (OLD.status = 'running' AND NEW.status IN ('running', 'succeeded', 'failed', 'quarantined')) OR
    OLD.status = NEW.status
  ) THEN RAISE(ABORT, 'invalid pipeline run state transition') END;
END;

CREATE TRIGGER acquisition_run_state_transition
BEFORE UPDATE OF status ON acquisition_run
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.status = 'pending' AND NEW.status IN ('pending', 'running', 'failed', 'quarantined')) OR
    (OLD.status = 'running' AND NEW.status IN ('running', 'succeeded', 'failed', 'quarantined')) OR
    OLD.status = NEW.status
  ) THEN RAISE(ABORT, 'invalid acquisition run state transition') END;
END;

CREATE TRIGGER pipeline_run_terminal_immutable
BEFORE UPDATE OF status, ended_at_ms, cost_summary_json, error_summary_json ON pipeline_run
WHEN OLD.status IN ('succeeded', 'failed', 'quarantined')
BEGIN SELECT RAISE(ABORT, 'terminal pipeline run is immutable'); END;
CREATE TRIGGER provider_run_terminal_immutable
BEFORE UPDATE OF status, ended_at_ms, error_summary_json ON provider_run
WHEN OLD.status IN ('succeeded', 'failed', 'quarantined')
BEGIN SELECT RAISE(ABORT, 'terminal provider run is immutable'); END;
CREATE TRIGGER acquisition_run_terminal_immutable
BEFORE UPDATE OF status, ended_at_ms ON acquisition_run
WHEN OLD.status IN ('succeeded', 'failed', 'quarantined')
BEGIN SELECT RAISE(ABORT, 'terminal acquisition run is immutable'); END;

CREATE TRIGGER pipeline_run_immutable_delete
BEFORE DELETE ON pipeline_run BEGIN SELECT RAISE(ABORT, 'pipeline run cannot be deleted'); END;
CREATE TRIGGER provider_run_immutable_delete
BEFORE DELETE ON provider_run BEGIN SELECT RAISE(ABORT, 'provider run cannot be deleted'); END;
CREATE TRIGGER acquisition_run_immutable_delete
BEFORE DELETE ON acquisition_run BEGIN SELECT RAISE(ABORT, 'acquisition run cannot be deleted'); END;

CREATE TRIGGER claim_conflict_members_insert
BEFORE INSERT ON claim_conflict
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM field_claim l
    JOIN field_claim r
      ON r.claim_id = NEW.right_claim_id
     AND r.subject_resource_id = l.subject_resource_id
     AND r.field_name = l.field_name
    WHERE l.claim_id = NEW.left_claim_id
      AND l.subject_resource_id = NEW.subject_resource_id
      AND l.field_name = NEW.field_name
  ) THEN RAISE(ABORT, 'conflict claims do not share subject and field') END;
  SELECT CASE WHEN NEW.resolved_claim_id IS NOT NULL AND NEW.resolved_claim_id NOT IN (NEW.left_claim_id, NEW.right_claim_id)
    THEN RAISE(ABORT, 'resolved claim is not a conflict member') END;
END;

CREATE TRIGGER resource_identity_immutable_update
BEFORE UPDATE ON resource_identity BEGIN SELECT RAISE(ABORT, 'resource identity is immutable'); END;
CREATE TRIGGER resource_identity_immutable_delete
BEFORE DELETE ON resource_identity BEGIN SELECT RAISE(ABORT, 'resource identity cannot be deleted'); END;
CREATE TRIGGER claim_scope_immutable_update
BEFORE UPDATE ON claim_scope BEGIN SELECT RAISE(ABORT, 'claim scope is append-only'); END;
CREATE TRIGGER claim_scope_immutable_delete
BEFORE DELETE ON claim_scope BEGIN SELECT RAISE(ABORT, 'claim scope cannot be deleted'); END;
CREATE TRIGGER observation_immutable_update
BEFORE UPDATE ON observation BEGIN SELECT RAISE(ABORT, 'observation is immutable'); END;
CREATE TRIGGER observation_immutable_delete
BEFORE DELETE ON observation BEGIN SELECT RAISE(ABORT, 'observation cannot be deleted'); END;
CREATE TRIGGER evidence_immutable_update
BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT, 'evidence is immutable'); END;
CREATE TRIGGER evidence_immutable_delete
BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT, 'evidence cannot be deleted'); END;
CREATE TRIGGER field_claim_immutable_update
BEFORE UPDATE ON field_claim BEGIN SELECT RAISE(ABORT, 'field claim is append-only'); END;
CREATE TRIGGER field_claim_immutable_delete
BEFORE DELETE ON field_claim BEGIN SELECT RAISE(ABORT, 'field claim cannot be deleted'); END;
CREATE TRIGGER claim_conflict_immutable_update
BEFORE UPDATE ON claim_conflict BEGIN SELECT RAISE(ABORT, 'claim conflict is append-only'); END;
CREATE TRIGGER claim_conflict_immutable_delete
BEFORE DELETE ON claim_conflict BEGIN SELECT RAISE(ABORT, 'claim conflict cannot be deleted'); END;
CREATE TRIGGER precision_observation_immutable_update
BEFORE UPDATE ON precision_observation BEGIN SELECT RAISE(ABORT, 'precision observation is immutable'); END;
CREATE TRIGGER precision_observation_immutable_delete
BEFORE DELETE ON precision_observation BEGIN SELECT RAISE(ABORT, 'precision observation cannot be deleted'); END;
CREATE TRIGGER precision_component_immutable_update
BEFORE UPDATE ON precision_component BEGIN SELECT RAISE(ABORT, 'precision component is immutable'); END;
CREATE TRIGGER precision_component_immutable_delete
BEFORE DELETE ON precision_component BEGIN SELECT RAISE(ABORT, 'precision component cannot be deleted'); END;
CREATE TRIGGER price_schedule_immutable_update
BEFORE UPDATE ON price_schedule BEGIN SELECT RAISE(ABORT, 'price schedule is immutable'); END;
CREATE TRIGGER price_schedule_immutable_delete
BEFORE DELETE ON price_schedule BEGIN SELECT RAISE(ABORT, 'price schedule cannot be deleted'); END;
CREATE TRIGGER policy_version_immutable_update
BEFORE UPDATE ON policy_version BEGIN SELECT RAISE(ABORT, 'policy version is immutable'); END;
CREATE TRIGGER policy_version_immutable_delete
BEFORE DELETE ON policy_version BEGIN SELECT RAISE(ABORT, 'policy version cannot be deleted'); END;
CREATE TRIGGER source_compliance_immutable_update
BEFORE UPDATE ON source_compliance_record BEGIN SELECT RAISE(ABORT, 'source compliance record is immutable'); END;
CREATE TRIGGER source_compliance_immutable_delete
BEFORE DELETE ON source_compliance_record BEGIN SELECT RAISE(ABORT, 'source compliance record cannot be deleted'); END;
CREATE TRIGGER provider_roster_immutable_update
BEFORE UPDATE ON provider_roster BEGIN SELECT RAISE(ABORT, 'provider roster is append-only'); END;
CREATE TRIGGER provider_roster_immutable_delete
BEFORE DELETE ON provider_roster BEGIN SELECT RAISE(ABORT, 'provider roster cannot be deleted'); END;
CREATE TRIGGER provider_roster_item_immutable_update
BEFORE UPDATE ON provider_roster_item BEGIN SELECT RAISE(ABORT, 'provider roster item is append-only'); END;
CREATE TRIGGER provider_roster_item_immutable_delete
BEFORE DELETE ON provider_roster_item BEGIN SELECT RAISE(ABORT, 'provider roster item cannot be deleted'); END;
CREATE TRIGGER provider_roster_item_frozen_insert
BEFORE INSERT ON provider_roster_item
WHEN EXISTS (
  SELECT 1 FROM provider_run
  WHERE provider_id = NEW.provider_id AND roster_version = NEW.roster_version
)
BEGIN SELECT RAISE(ABORT, 'referenced provider roster cannot grow'); END;
CREATE TRIGGER roster_outcome_immutable_update
BEFORE UPDATE ON roster_outcome BEGIN SELECT RAISE(ABORT, 'roster outcome is append-only'); END;
CREATE TRIGGER roster_outcome_immutable_delete
BEFORE DELETE ON roster_outcome BEGIN SELECT RAISE(ABORT, 'roster outcome cannot be deleted'); END;

CREATE TRIGGER pipeline_run_provenance_immutable
BEFORE UPDATE OF run_id, occurrence_id, attempt_number, code_version, schema_version, provider_scope_json, started_at_ms, replay_of_run_id, created_at_ms ON pipeline_run
BEGIN SELECT RAISE(ABORT, 'pipeline run provenance is immutable'); END;
CREATE TRIGGER provider_run_provenance_immutable
BEFORE UPDATE OF provider_run_id, run_id, provider_id, adapter_version, roster_version, source_register_version, started_at_ms, created_at_ms ON provider_run
BEGIN SELECT RAISE(ABORT, 'provider run provenance is immutable'); END;
CREATE TRIGGER acquisition_run_provenance_immutable
BEFORE UPDATE OF acquisition_run_id, run_id, provider_run_id, source_owner_organization_id, source_type, started_at_ms, created_at_ms ON acquisition_run
BEGIN SELECT RAISE(ABORT, 'acquisition run provenance is immutable'); END;

CREATE TRIGGER organization_identity_columns_immutable
BEFORE UPDATE OF organization_id, created_at_ms ON organization BEGIN SELECT RAISE(ABORT, 'organization identity columns are immutable'); END;
CREATE TRIGGER model_family_identity_columns_immutable
BEFORE UPDATE OF family_id, created_at_ms ON model_family BEGIN SELECT RAISE(ABORT, 'model family identity columns are immutable'); END;
CREATE TRIGGER model_identity_columns_immutable
BEFORE UPDATE OF model_id, created_at_ms ON model BEGIN SELECT RAISE(ABORT, 'model identity columns are immutable'); END;
CREATE TRIGGER variant_identity_columns_immutable
BEFORE UPDATE OF variant_id, model_id, created_at_ms ON model_variant BEGIN SELECT RAISE(ABORT, 'variant identity columns are immutable'); END;
CREATE TRIGGER checkpoint_identity_columns_immutable
BEFORE UPDATE OF checkpoint_id, created_at_ms ON checkpoint BEGIN SELECT RAISE(ABORT, 'checkpoint identity columns are immutable'); END;
CREATE TRIGGER provider_identity_columns_immutable
BEFORE UPDATE OF provider_id, created_at_ms ON provider BEGIN SELECT RAISE(ABORT, 'provider identity columns are immutable'); END;
CREATE TRIGGER offering_identity_columns_immutable
BEFORE UPDATE OF offering_id, provider_id, provider_model_id, normalized_provider_model_id, tier_key, endpoint_class, material_region_key, model_resource_id, created_at_ms ON offering
BEGIN SELECT RAISE(ABORT, 'offering identity tuple is immutable'); END;

-- Claim pointers are selected typed bindings, never arbitrary references to a claim row.
CREATE TRIGGER organization_claim_pointer_insert
BEFORE INSERT ON organization WHEN NEW.official_url_claim_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.official_url_claim_id AND c.subject_resource_id = NEW.organization_id
      AND c.field_name = 'official_url' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'entity'
  ) THEN RAISE(ABORT, 'organization claim pointer mismatch') END;
END;
CREATE TRIGGER organization_claim_pointer_update
BEFORE UPDATE OF official_url_claim_id ON organization WHEN NEW.official_url_claim_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.official_url_claim_id AND c.subject_resource_id = NEW.organization_id
      AND c.field_name = 'official_url' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'entity'
  ) THEN RAISE(ABORT, 'organization claim pointer mismatch') END;
END;

CREATE TRIGGER model_family_claim_pointer_insert
BEFORE INSERT ON model_family WHEN NEW.publisher_claim_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.publisher_claim_id AND c.subject_resource_id = NEW.family_id
      AND c.field_name = 'publisher' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'entity'
  ) THEN RAISE(ABORT, 'model family claim pointer mismatch') END;
END;
CREATE TRIGGER model_family_claim_pointer_update
BEFORE UPDATE OF publisher_claim_id ON model_family WHEN NEW.publisher_claim_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.publisher_claim_id AND c.subject_resource_id = NEW.family_id
      AND c.field_name = 'publisher' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'entity'
  ) THEN RAISE(ABORT, 'model family claim pointer mismatch') END;
END;

CREATE TRIGGER model_claim_pointers_insert
BEFORE INSERT ON model
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(json_object(
      'publisher', NEW.publisher_claim_id,
      'release_date', NEW.release_claim_id,
      'modalities', NEW.modality_claim_id,
      'context_window_tokens', NEW.context_claim_id,
      'maximum_output_tokens', NEW.output_limit_claim_id,
      'license', NEW.license_claim_id,
      'architecture', NEW.architecture_claim_id
    )) pointer
    WHERE pointer.value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
      WHERE c.claim_id = pointer.value AND c.subject_resource_id = NEW.model_id
        AND c.field_name = pointer.key AND c.verification_state = 'verified'
        AND c.value_state = 'known' AND s.scope_kind = 'model'
    )
  ) THEN RAISE(ABORT, 'model claim pointer mismatch') END;
END;
CREATE TRIGGER model_claim_pointers_update
BEFORE UPDATE OF publisher_claim_id, release_claim_id, modality_claim_id, context_claim_id, output_limit_claim_id, license_claim_id, architecture_claim_id ON model
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(json_object(
      'publisher', NEW.publisher_claim_id,
      'release_date', NEW.release_claim_id,
      'modalities', NEW.modality_claim_id,
      'context_window_tokens', NEW.context_claim_id,
      'maximum_output_tokens', NEW.output_limit_claim_id,
      'license', NEW.license_claim_id,
      'architecture', NEW.architecture_claim_id
    )) pointer
    WHERE pointer.value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
      WHERE c.claim_id = pointer.value AND c.subject_resource_id = NEW.model_id
        AND c.field_name = pointer.key AND c.verification_state = 'verified'
        AND c.value_state = 'known' AND s.scope_kind = 'model'
    )
  ) THEN RAISE(ABORT, 'model claim pointer mismatch') END;
END;

CREATE TRIGGER model_variant_claim_pointers_insert
BEFORE INSERT ON model_variant
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM (
      SELECT NEW.selection_evidence_claim_id AS claim_id, 'selection_evidence' AS field_name UNION ALL
      SELECT NEW.description_claim_id, 'description'
    ) pointer
    WHERE pointer.claim_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
      WHERE c.claim_id = pointer.claim_id AND c.subject_resource_id = NEW.variant_id
        AND c.field_name = pointer.field_name AND c.verification_state = 'verified'
        AND c.value_state = 'known' AND s.scope_kind = 'model'
    )
  ) THEN RAISE(ABORT, 'model variant claim pointer mismatch') END;
END;
CREATE TRIGGER model_variant_claim_pointers_update
BEFORE UPDATE OF selection_evidence_claim_id, description_claim_id ON model_variant
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM (
      SELECT NEW.selection_evidence_claim_id AS claim_id, 'selection_evidence' AS field_name UNION ALL
      SELECT NEW.description_claim_id, 'description'
    ) pointer
    WHERE pointer.claim_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
      WHERE c.claim_id = pointer.claim_id AND c.subject_resource_id = NEW.variant_id
        AND c.field_name = pointer.field_name AND c.verification_state = 'verified'
        AND c.value_state = 'known' AND s.scope_kind = 'model'
    )
  ) THEN RAISE(ABORT, 'model variant claim pointer mismatch') END;
END;

CREATE TRIGGER checkpoint_claim_pointers_insert
BEFORE INSERT ON checkpoint
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(json_object(
      'repository_id', NEW.repository_id_claim_id,
      'revision', NEW.revision_claim_id,
      'published_at', NEW.publication_time_claim_id,
      'declared_weight_format', NEW.declared_weight_format_claim_id,
      'quantization', NEW.quantization_claim_id,
      'file_format', NEW.file_format_claim_id
    )) pointer
    WHERE pointer.value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
      WHERE c.claim_id = pointer.value AND c.subject_resource_id = NEW.checkpoint_id
        AND c.field_name = pointer.key AND c.verification_state = 'verified'
        AND c.value_state = 'known' AND s.scope_kind = 'checkpoint'
    )
  ) THEN RAISE(ABORT, 'checkpoint claim pointer mismatch') END;
END;
CREATE TRIGGER checkpoint_claim_pointers_update
BEFORE UPDATE OF repository_id_claim_id, revision_claim_id, publication_time_claim_id, declared_weight_format_claim_id, quantization_claim_id, file_format_claim_id ON checkpoint
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(json_object(
      'repository_id', NEW.repository_id_claim_id,
      'revision', NEW.revision_claim_id,
      'published_at', NEW.publication_time_claim_id,
      'declared_weight_format', NEW.declared_weight_format_claim_id,
      'quantization', NEW.quantization_claim_id,
      'file_format', NEW.file_format_claim_id
    )) pointer
    WHERE pointer.value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
      WHERE c.claim_id = pointer.value AND c.subject_resource_id = NEW.checkpoint_id
        AND c.field_name = pointer.key AND c.verification_state = 'verified'
        AND c.value_state = 'known' AND s.scope_kind = 'checkpoint'
    )
  ) THEN RAISE(ABORT, 'checkpoint claim pointer mismatch') END;
END;

CREATE TRIGGER provider_claim_pointer_insert
BEFORE INSERT ON provider WHEN NEW.official_url_claim_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.official_url_claim_id AND c.subject_resource_id = NEW.provider_id
      AND c.field_name = 'official_url' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'provider'
  ) THEN RAISE(ABORT, 'provider claim pointer mismatch') END;
END;
CREATE TRIGGER provider_claim_pointer_update
BEFORE UPDATE OF official_url_claim_id ON provider WHEN NEW.official_url_claim_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.official_url_claim_id AND c.subject_resource_id = NEW.provider_id
      AND c.field_name = 'official_url' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'provider'
  ) THEN RAISE(ABORT, 'provider claim pointer mismatch') END;
END;

CREATE TRIGGER offering_claim_pointer_insert
BEFORE INSERT ON offering WHEN NEW.display_name_claim_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM field_claim c
    JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.display_name_claim_id AND c.subject_resource_id = NEW.offering_id
      AND c.field_name = 'display_name' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'offering' AND s.complete = 1
      AND s.provider_id = NEW.provider_id
      AND s.provider_model_id = NEW.provider_model_id
      AND s.tier_key = NEW.tier_key
      AND s.endpoint_class = NEW.endpoint_class
      AND s.material_region_key = NEW.material_region_key
  ) THEN RAISE(ABORT, 'offering claim pointer mismatch') END;
END;
CREATE TRIGGER offering_claim_pointer_update
BEFORE UPDATE OF display_name_claim_id ON offering WHEN NEW.display_name_claim_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM field_claim c
    JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.display_name_claim_id AND c.subject_resource_id = NEW.offering_id
      AND c.field_name = 'display_name' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'offering' AND s.complete = 1
      AND s.provider_id = NEW.provider_id
      AND s.provider_model_id = NEW.provider_model_id
      AND s.tier_key = NEW.tier_key
      AND s.endpoint_class = NEW.endpoint_class
      AND s.material_region_key = NEW.material_region_key
  ) THEN RAISE(ABORT, 'offering claim pointer mismatch') END;
END;

CREATE TRIGGER model_checkpoint_claim_pointer_insert
BEFORE INSERT ON model_checkpoint
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.claim_id AND c.subject_resource_id = NEW.model_resource_id
      AND c.field_name = 'role' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'model'
      AND json_type(c.normalized_value_json) = 'text'
      AND json_extract(c.normalized_value_json, '$') = NEW.role
  ) THEN RAISE(ABORT, 'model checkpoint claim pointer mismatch') END;
END;
CREATE TRIGGER checkpoint_edge_claim_pointer_insert
BEFORE INSERT ON checkpoint_edge
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM field_claim c JOIN claim_scope s ON s.scope_id = c.scope_id
    WHERE c.claim_id = NEW.claim_id AND c.subject_resource_id = NEW.from_checkpoint_id
      AND c.field_name = 'relationship' AND c.verification_state = 'verified'
      AND c.value_state = 'known' AND s.scope_kind = 'checkpoint'
      AND json_type(c.normalized_value_json) = 'text'
      AND json_extract(c.normalized_value_json, '$') = NEW.relationship
  ) THEN RAISE(ABORT, 'checkpoint edge claim pointer mismatch') END;
END;

CREATE TRIGGER model_checkpoint_immutable_update
BEFORE UPDATE ON model_checkpoint BEGIN SELECT RAISE(ABORT, 'model checkpoint link is append-only'); END;
CREATE TRIGGER model_checkpoint_immutable_delete
BEFORE DELETE ON model_checkpoint BEGIN SELECT RAISE(ABORT, 'model checkpoint link cannot be deleted'); END;
CREATE TRIGGER checkpoint_edge_immutable_update
BEFORE UPDATE ON checkpoint_edge BEGIN SELECT RAISE(ABORT, 'checkpoint edge is append-only'); END;
CREATE TRIGGER checkpoint_edge_immutable_delete
BEFORE DELETE ON checkpoint_edge BEGIN SELECT RAISE(ABORT, 'checkpoint edge cannot be deleted'); END;
