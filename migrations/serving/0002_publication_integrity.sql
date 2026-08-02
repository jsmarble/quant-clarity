-- Publication closure/type/state protection. FTS remains a Phase 4 migration.

CREATE TRIGGER publication_resource_type_insert
BEFORE INSERT ON publication_resource
BEGIN
  SELECT CASE WHEN NOT (
    (NEW.resource_type = 'model_family' AND substr(NEW.resource_id, 1, 4) = 'fam_') OR
    (NEW.resource_type = 'model' AND substr(NEW.resource_id, 1, 4) = 'mdl_') OR
    (NEW.resource_type = 'variant' AND substr(NEW.resource_id, 1, 4) = 'var_') OR
    (NEW.resource_type = 'provider' AND substr(NEW.resource_id, 1, 4) = 'prv_') OR
    (NEW.resource_type = 'offering' AND substr(NEW.resource_id, 1, 4) = 'off_') OR
    (NEW.resource_type = 'price' AND substr(NEW.resource_id, 1, 4) = 'pcs_') OR
    (NEW.resource_type = 'precision_observation' AND substr(NEW.resource_id, 1, 4) = 'prc_') OR
    (NEW.resource_type = 'evidence_summary' AND substr(NEW.resource_id, 1, 4) = 'evd_')
  ) THEN RAISE(ABORT, 'publication resource type and ID prefix disagree') END;
END;

CREATE TRIGGER publication_search_type_insert
BEFORE INSERT ON publication_search_document
BEGIN
  SELECT CASE WHEN NOT (
    (NEW.resource_type = 'model' AND substr(NEW.resource_id, 1, 4) = 'mdl_') OR
    (NEW.resource_type = 'variant' AND substr(NEW.resource_id, 1, 4) = 'var_')
  ) THEN RAISE(ABORT, 'search document type and ID prefix disagree') END;
END;

CREATE TRIGGER publication_state_transition
BEFORE UPDATE OF state, ready_at_ms, activated_at_ms, failure_codes_json ON publication
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.state = 'building' AND NEW.state IN ('ready', 'failed')) OR
    (OLD.state = 'ready' AND NEW.state IN ('active', 'failed')) OR
    (OLD.state = 'active' AND NEW.state IN ('superseded', 'rolled_back')) OR
    (OLD.state = 'superseded' AND NEW.state IN ('active', 'rolled_back')) OR
    (OLD.state = NEW.state)
  ) THEN RAISE(ABORT, 'invalid publication state transition') END;
  SELECT CASE WHEN NEW.state = 'ready' AND (
    (SELECT count(*) FROM publication_provider_slice WHERE publication_id = NEW.publication_id) = 0 OR
    (SELECT count(*) FROM publication_resource WHERE publication_id = NEW.publication_id) <> NEW.resource_count OR
    (SELECT count(*) FROM publication_search_document WHERE publication_id = NEW.publication_id) <> NEW.exact_document_count OR
    NEW.exact_document_count <> NEW.vector_document_count OR
    (SELECT count(*) FROM publication_resource WHERE publication_id = NEW.publication_id AND resource_type IN ('model', 'variant')) <> NEW.vector_document_count OR
    EXISTS (
      SELECT 1 FROM publication_resource resource
      WHERE resource.publication_id = NEW.publication_id
        AND resource.resource_type IN ('model', 'variant')
        AND NOT EXISTS (
          SELECT 1 FROM publication_search_document document
          WHERE document.publication_id = resource.publication_id
            AND document.resource_type = resource.resource_type
            AND document.resource_id = resource.resource_id
        )
    )
  ) THEN RAISE(ABORT, 'publication closure counts are incomplete') END;
END;

CREATE TRIGGER publication_identity_immutable
BEFORE UPDATE OF publication_id, schema_version, methodology_version, precision_normalization_version, precision_display_order_version, price_policy_version, source_policy_version, embedding_version, build_commit, source_run_id, parent_publication_id, generated_at_ms, resource_count, exact_document_count, vector_document_count, exact_index_hash, vector_index_version, closure_hash, created_at_ms ON publication
BEGIN SELECT RAISE(ABORT, 'publication identity metadata is immutable'); END;

CREATE TRIGGER publication_ready_timestamp_guard
BEFORE UPDATE OF ready_at_ms ON publication
WHEN NOT (NEW.ready_at_ms IS OLD.ready_at_ms) AND NOT (
  OLD.state = 'building' AND NEW.state = 'ready' AND
  OLD.ready_at_ms IS NULL AND NEW.ready_at_ms IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'ready timestamp may change only on readiness transition'); END;

CREATE TRIGGER publication_activation_timestamp_guard
BEFORE UPDATE OF activated_at_ms ON publication
WHEN NOT (NEW.activated_at_ms IS OLD.activated_at_ms) AND NOT (
  OLD.state = 'ready' AND NEW.state = 'active' AND
  OLD.activated_at_ms IS NULL AND NEW.activated_at_ms IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'activation timestamp may change only on activation transition'); END;

CREATE TRIGGER publication_failure_codes_guard
BEFORE UPDATE OF failure_codes_json ON publication
WHEN NEW.failure_codes_json <> OLD.failure_codes_json AND NOT (
  OLD.state IN ('building', 'ready') AND NEW.state = 'failed'
)
BEGIN SELECT RAISE(ABORT, 'failure codes may change only on failure transition'); END;

CREATE TRIGGER publication_headed_state_guard
BEFORE UPDATE OF state ON publication
WHEN OLD.state = 'active' AND NEW.state IN ('superseded', 'rolled_back')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_head WHERE active_publication_id = OLD.publication_id
  ) THEN RAISE(ABORT, 'active publication must be switched before demotion') END;
END;

CREATE TRIGGER publication_immutable_delete
BEFORE DELETE ON publication BEGIN SELECT RAISE(ABORT, 'publication manifest cannot be deleted'); END;

CREATE TRIGGER publication_resource_immutable_update
BEFORE UPDATE ON publication_resource BEGIN SELECT RAISE(ABORT, 'publication resource is immutable'); END;
CREATE TRIGGER publication_resource_immutable_delete
BEFORE DELETE ON publication_resource BEGIN SELECT RAISE(ABORT, 'publication resource cannot be deleted'); END;
CREATE TRIGGER publication_provider_slice_immutable_update
BEFORE UPDATE ON publication_provider_slice BEGIN SELECT RAISE(ABORT, 'publication provider slice is immutable'); END;
CREATE TRIGGER publication_provider_slice_immutable_delete
BEFORE DELETE ON publication_provider_slice BEGIN SELECT RAISE(ABORT, 'publication provider slice cannot be deleted'); END;
CREATE TRIGGER publication_search_immutable_update
BEFORE UPDATE ON publication_search_document BEGIN SELECT RAISE(ABORT, 'publication search document is immutable'); END;
CREATE TRIGGER publication_search_immutable_delete
BEFORE DELETE ON publication_search_document BEGIN SELECT RAISE(ABORT, 'publication search document cannot be deleted'); END;

CREATE TRIGGER publication_resource_building_insert
BEFORE INSERT ON publication_resource
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.publication_id AND state = 'building'
  ) THEN RAISE(ABORT, 'publication resources may be staged only while building') END;
END;

CREATE TRIGGER publication_provider_slice_building_insert
BEFORE INSERT ON publication_provider_slice
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.publication_id AND state = 'building'
  ) THEN RAISE(ABORT, 'provider slices may be staged only while building') END;
END;

CREATE TRIGGER publication_search_building_insert
BEFORE INSERT ON publication_search_document
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.publication_id AND state = 'building'
  ) THEN RAISE(ABORT, 'search documents may be staged only while building') END;
END;

CREATE TRIGGER publication_head_state_insert
BEFORE INSERT ON publication_head
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.active_publication_id AND state = 'active'
  ) THEN RAISE(ABORT, 'publication head must select an active publication') END;
  SELECT CASE WHEN NEW.rollback_candidate_publication_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.rollback_candidate_publication_id
      AND state IN ('active', 'superseded', 'rolled_back')
  ) THEN RAISE(ABORT, 'rollback candidate must be a retained queryable publication') END;
END;

CREATE TRIGGER publication_head_state_update
BEFORE UPDATE ON publication_head
BEGIN
  SELECT CASE WHEN NEW.generation <= OLD.generation THEN RAISE(ABORT, 'publication head generation must increase') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.active_publication_id AND state = 'active'
  ) THEN RAISE(ABORT, 'publication head must select an active publication') END;
  SELECT CASE WHEN NEW.rollback_candidate_publication_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.rollback_candidate_publication_id
      AND state IN ('active', 'superseded', 'rolled_back')
  ) THEN RAISE(ABORT, 'rollback candidate must be a retained queryable publication') END;
END;
