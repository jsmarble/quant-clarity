-- Exact-generation publication activation, rollback preflight, and immutable switch history.
-- Requirements: PIPE-044, PIPE-050–PIPE-056, BE-011, QA-006.

PRAGMA defer_foreign_keys = true;

SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.3.0'
) <> 1 THEN json('') END;

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication
  WHERE state IN ('active', 'superseded', 'rolled_back')
) OR EXISTS (
  SELECT 1 FROM publication_head
) THEN json('') END;

CREATE TABLE publication_switch_preflight (
  switch_id TEXT PRIMARY KEY CHECK (length(switch_id) BETWEEN 1 AND 512 AND switch_id NOT GLOB '*[^ -~]*'),
  preflight_version TEXT NOT NULL CHECK (preflight_version = '1.0.0'),
  preflight_hash TEXT NOT NULL CHECK (length(preflight_hash) = 71 AND substr(preflight_hash, 1, 7) = 'sha256:' AND substr(preflight_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  action TEXT NOT NULL CHECK (action IN ('activate', 'rollback')),
  environment TEXT NOT NULL CHECK (environment IN ('local', 'preview', 'production')),
  expected_prior_generation INTEGER NOT NULL CHECK (typeof(expected_prior_generation) = 'integer' AND expected_prior_generation >= 0),
  expected_prior_rollback_candidate_publication_id TEXT REFERENCES publication(publication_id) ON DELETE RESTRICT,
  expected_prior_switched_at_ms INTEGER CHECK (expected_prior_switched_at_ms IS NULL OR (typeof(expected_prior_switched_at_ms) = 'integer' AND expected_prior_switched_at_ms >= 0)),
  new_generation INTEGER NOT NULL UNIQUE CHECK (typeof(new_generation) = 'integer' AND new_generation = expected_prior_generation + 1),
  from_publication_id TEXT REFERENCES publication(publication_id) ON DELETE RESTRICT,
  from_closure_hash TEXT CHECK (from_closure_hash IS NULL OR (length(from_closure_hash) = 71 AND substr(from_closure_hash, 1, 7) = 'sha256:' AND substr(from_closure_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  to_publication_id TEXT NOT NULL REFERENCES publication_closure_seal(publication_id) ON DELETE RESTRICT,
  to_closure_hash TEXT NOT NULL CHECK (length(to_closure_hash) = 71 AND substr(to_closure_hash, 1, 7) = 'sha256:' AND substr(to_closure_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  to_attestation_hash TEXT CHECK (to_attestation_hash IS NULL OR (length(to_attestation_hash) = 71 AND substr(to_attestation_hash, 1, 7) = 'sha256:' AND substr(to_attestation_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  switched_at_ms INTEGER NOT NULL CHECK (typeof(switched_at_ms) = 'integer' AND switched_at_ms >= 0),
  observed_at_ms INTEGER NOT NULL CHECK (typeof(observed_at_ms) = 'integer' AND observed_at_ms >= 0),
  maximum_age_ms INTEGER NOT NULL CHECK (typeof(maximum_age_ms) = 'integer' AND maximum_age_ms >= 0),
  valid_until_ms INTEGER NOT NULL CHECK (typeof(valid_until_ms) = 'integer' AND valid_until_ms = observed_at_ms + maximum_age_ms AND valid_until_ms >= switched_at_ms),
  fts_build_version TEXT NOT NULL CHECK (fts_build_version = 'fts5-unicode61@1'),
  fts_source_document_count INTEGER NOT NULL CHECK (typeof(fts_source_document_count) = 'integer' AND fts_source_document_count >= 0),
  fts_index_document_count INTEGER NOT NULL CHECK (typeof(fts_index_document_count) = 'integer' AND fts_index_document_count >= 0),
  fts_source_inventory_hash TEXT NOT NULL CHECK (length(fts_source_inventory_hash) = 71 AND substr(fts_source_inventory_hash, 1, 7) = 'sha256:' AND substr(fts_source_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  fts_exact_parity INTEGER NOT NULL CHECK (fts_exact_parity IN (0, 1)),
  archive_bundle_hash TEXT NOT NULL CHECK (length(archive_bundle_hash) = 71 AND substr(archive_bundle_hash, 1, 7) = 'sha256:' AND substr(archive_bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  archive_immutable INTEGER NOT NULL CHECK (archive_immutable IN (0, 1)),
  vector_namespace TEXT NOT NULL,
  vector_document_count INTEGER NOT NULL CHECK (typeof(vector_document_count) = 'integer' AND vector_document_count >= 0),
  vector_verified_document_count INTEGER NOT NULL CHECK (typeof(vector_verified_document_count) = 'integer' AND vector_verified_document_count >= 0),
  vector_inventory_hash TEXT NOT NULL CHECK (length(vector_inventory_hash) = 71 AND substr(vector_inventory_hash, 1, 7) = 'sha256:' AND substr(vector_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  vector_visibility_probe_version TEXT NOT NULL CHECK (vector_visibility_probe_version = 'vector-visibility@1'),
  vector_mutation_id TEXT NOT NULL CHECK (length(vector_mutation_id) BETWEEN 1 AND 128 AND vector_mutation_id NOT GLOB '*[^ -~]*'),
  vector_all_ids_present INTEGER NOT NULL CHECK (vector_all_ids_present IN (0, 1)),
  vector_all_namespaces_match INTEGER NOT NULL CHECK (vector_all_namespaces_match IN (0, 1)),
  vector_queryable INTEGER NOT NULL CHECK (vector_queryable IN (0, 1)),
  probe_set_version TEXT NOT NULL CHECK (probe_set_version = 'search-gold@1'),
  integrity_passed INTEGER NOT NULL CHECK (integrity_passed IN (0, 1)),
  exact_search_passed INTEGER NOT NULL CHECK (exact_search_passed IN (0, 1)),
  semantic_search_passed INTEGER NOT NULL CHECK (semantic_search_passed IN (0, 1)),
  structured_filter_passed INTEGER NOT NULL CHECK (structured_filter_passed IN (0, 1)),
  neutrality_passed INTEGER NOT NULL CHECK (neutrality_passed IN (0, 1)),
  version_isolation_passed INTEGER NOT NULL CHECK (version_isolation_passed IN (0, 1)),
  CHECK ((from_publication_id IS NULL) = (from_closure_hash IS NULL)),
  CHECK ((expected_prior_generation = 0) = (expected_prior_switched_at_ms IS NULL)),
  CHECK (expected_prior_generation > 0 OR expected_prior_rollback_candidate_publication_id IS NULL),
  CHECK (from_publication_id IS NULL OR from_publication_id <> to_publication_id),
  CHECK ((action = 'activate' AND to_attestation_hash IS NOT NULL) OR (action = 'rollback' AND to_attestation_hash IS NULL))
);

CREATE TABLE publication_switch_history (
  switch_id TEXT PRIMARY KEY,
  event_version TEXT NOT NULL CHECK (event_version = '1.0.0'),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 71 AND substr(event_hash, 1, 7) = 'sha256:' AND substr(event_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  preflight_hash TEXT NOT NULL CHECK (length(preflight_hash) = 71 AND substr(preflight_hash, 1, 7) = 'sha256:' AND substr(preflight_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  action TEXT NOT NULL CHECK (action IN ('activate', 'rollback')),
  expected_prior_generation INTEGER NOT NULL CHECK (typeof(expected_prior_generation) = 'integer' AND expected_prior_generation >= 0),
  expected_prior_rollback_candidate_publication_id TEXT REFERENCES publication(publication_id) ON DELETE RESTRICT,
  expected_prior_switched_at_ms INTEGER CHECK (expected_prior_switched_at_ms IS NULL OR (typeof(expected_prior_switched_at_ms) = 'integer' AND expected_prior_switched_at_ms >= 0)),
  new_generation INTEGER NOT NULL UNIQUE CHECK (typeof(new_generation) = 'integer' AND new_generation = expected_prior_generation + 1),
  from_publication_id TEXT REFERENCES publication(publication_id) ON DELETE RESTRICT,
  from_closure_hash TEXT CHECK (from_closure_hash IS NULL OR (length(from_closure_hash) = 71 AND substr(from_closure_hash, 1, 7) = 'sha256:' AND substr(from_closure_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  to_publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  to_closure_hash TEXT NOT NULL CHECK (length(to_closure_hash) = 71 AND substr(to_closure_hash, 1, 7) = 'sha256:' AND substr(to_closure_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  to_attestation_hash TEXT CHECK (to_attestation_hash IS NULL OR (length(to_attestation_hash) = 71 AND substr(to_attestation_hash, 1, 7) = 'sha256:' AND substr(to_attestation_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  resulting_rollback_candidate_publication_id TEXT REFERENCES publication(publication_id) ON DELETE RESTRICT,
  switched_at_ms INTEGER NOT NULL CHECK (typeof(switched_at_ms) = 'integer' AND switched_at_ms >= 0),
  authorized_by_kind TEXT NOT NULL CHECK (authorized_by_kind IN ('pipeline', 'operator')),
  authorized_identity_id TEXT NOT NULL CHECK (length(authorized_identity_id) BETWEEN 1 AND 128 AND authorized_identity_id = lower(authorized_identity_id) AND authorized_identity_id NOT GLOB '*[^a-z0-9._:@/-]*' AND substr(authorized_identity_id, 1, 1) GLOB '[a-z0-9]'),
  FOREIGN KEY (switch_id) REFERENCES publication_switch_preflight(switch_id) ON DELETE RESTRICT,
  CHECK ((from_publication_id IS NULL) = (from_closure_hash IS NULL)),
  CHECK ((expected_prior_generation = 0) = (expected_prior_switched_at_ms IS NULL)),
  CHECK (expected_prior_generation > 0 OR expected_prior_rollback_candidate_publication_id IS NULL),
  CHECK (resulting_rollback_candidate_publication_id IS from_publication_id),
  CHECK ((action = 'activate' AND to_attestation_hash IS NOT NULL) OR (action = 'rollback' AND to_attestation_hash IS NULL))
);

CREATE INDEX publication_switch_preflight_generation_idx
ON publication_switch_preflight(new_generation, action);

CREATE TRIGGER publication_switch_preflight_insert_guard
BEFORE INSERT ON publication_switch_preflight
BEGIN
  SELECT CASE WHEN NEW.observed_at_ms > NEW.switched_at_ms
    OR NEW.observed_at_ms < (SELECT sealed_at_ms FROM publication_closure_seal WHERE publication_id = NEW.to_publication_id)
    OR CAST(strftime('%s', 'now') AS INTEGER) * 1000 > NEW.valid_until_ms
    OR NEW.observed_at_ms > CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 300000
    OR NEW.switched_at_ms < CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 300000
    OR NEW.switched_at_ms > CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 300000
    THEN RAISE(ABORT, 'switch preflight is stale or outside the database clock bound') END;

  SELECT CASE WHEN NOT (
    (
      NEW.expected_prior_generation = 0
      AND NEW.new_generation = 1
      AND NEW.from_publication_id IS NULL
      AND NEW.expected_prior_rollback_candidate_publication_id IS NULL
      AND NEW.expected_prior_switched_at_ms IS NULL
      AND NEW.action = 'activate'
      AND NOT EXISTS (SELECT 1 FROM publication_head)
    ) OR (
      NEW.expected_prior_generation >= 1
      AND EXISTS (
        SELECT 1
        FROM publication_head AS head
        JOIN publication AS current ON current.publication_id = head.active_publication_id
        WHERE head.singleton = 1
          AND head.generation = NEW.expected_prior_generation
          AND head.active_publication_id = NEW.from_publication_id
          AND head.rollback_candidate_publication_id IS NEW.expected_prior_rollback_candidate_publication_id
          AND head.switched_at_ms = NEW.expected_prior_switched_at_ms
          AND head.switched_at_ms < NEW.switched_at_ms
          AND current.state = 'active'
          AND current.closure_hash = NEW.from_closure_hash
      )
    )
  ) THEN RAISE(ABORT, 'switch preflight does not match the exact head generation') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS target
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE target.publication_id = NEW.to_publication_id
      AND target.closure_hash = NEW.to_closure_hash
      AND seal.closure_hash = NEW.to_closure_hash
      AND seal.bundle_hash = NEW.archive_bundle_hash
      AND NEW.archive_immutable = 1
      AND seal.exact_document_count = NEW.fts_source_document_count
      AND seal.exact_document_count = NEW.fts_index_document_count
      AND seal.exact_search_inventory_hash = NEW.fts_source_inventory_hash
      AND NEW.fts_exact_parity = 1
      AND NEW.vector_namespace = target.publication_id
      AND seal.vector_document_count = NEW.vector_document_count
      AND seal.vector_document_count = NEW.vector_verified_document_count
      AND seal.vector_inventory_hash = NEW.vector_inventory_hash
      AND NEW.vector_all_ids_present = 1
      AND NEW.vector_all_namespaces_match = 1
      AND NEW.vector_queryable = 1
      AND NEW.integrity_passed = 1
      AND NEW.exact_search_passed = 1
      AND NEW.semantic_search_passed = 1
      AND NEW.structured_filter_passed = 1
      AND NEW.neutrality_passed = 1
      AND NEW.version_isolation_passed = 1
  ) THEN RAISE(ABORT, 'switch preflight does not prove the sealed serving artifacts') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> NEW.fts_source_document_count OR (
    SELECT count(*) FROM publication_search_fts
    WHERE publication_id = NEW.to_publication_id
  ) <> NEW.fts_index_document_count OR EXISTS (
    SELECT 1 FROM publication_search_document AS source
    WHERE source.publication_id = NEW.to_publication_id
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
    WHERE indexed.publication_id = NEW.to_publication_id
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
  ) THEN RAISE(ABORT, 'switch preflight FTS does not exactly match its sealed source') END;

  SELECT CASE WHEN NEW.action = 'activate' AND NOT EXISTS (
    SELECT 1
    FROM publication AS target
    JOIN publication_readiness_attestation AS attestation USING (publication_id)
    WHERE target.publication_id = NEW.to_publication_id
      AND target.state = 'ready'
      AND target.ready_at_ms = attestation.ready_at_ms
      AND attestation.environment = NEW.environment
      AND attestation.closure_hash = NEW.to_closure_hash
      AND attestation.attestation_hash = NEW.to_attestation_hash
      AND NEW.switched_at_ms <= attestation.effective_valid_until_ms
      AND CAST(strftime('%s', 'now') AS INTEGER) * 1000 <= attestation.effective_valid_until_ms
  ) THEN RAISE(ABORT, 'activation lacks a fresh exact readiness attestation') END;

  SELECT CASE WHEN NEW.action = 'rollback' AND NOT EXISTS (
    SELECT 1
    FROM publication_head AS head
    JOIN publication AS target ON target.publication_id = NEW.to_publication_id
    WHERE head.singleton = 1
      AND head.rollback_candidate_publication_id = target.publication_id
      AND target.state = 'superseded'
  ) THEN RAISE(ABORT, 'rollback target is not the immediate superseded publication') END;
END;

CREATE TRIGGER publication_switch_preflight_immutable_update
BEFORE UPDATE ON publication_switch_preflight
BEGIN SELECT RAISE(ABORT, 'switch preflight is immutable'); END;
CREATE TRIGGER publication_switch_preflight_immutable_delete
BEFORE DELETE ON publication_switch_preflight
BEGIN SELECT RAISE(ABORT, 'switch preflight cannot be deleted'); END;

CREATE TRIGGER publication_switch_history_insert_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_switch_preflight AS preflight
    WHERE preflight.switch_id = NEW.switch_id
      AND preflight.preflight_hash = NEW.preflight_hash
      AND preflight.action = NEW.action
      AND preflight.expected_prior_generation = NEW.expected_prior_generation
      AND preflight.expected_prior_rollback_candidate_publication_id IS NEW.expected_prior_rollback_candidate_publication_id
      AND preflight.expected_prior_switched_at_ms IS NEW.expected_prior_switched_at_ms
      AND preflight.new_generation = NEW.new_generation
      AND preflight.from_publication_id IS NEW.from_publication_id
      AND preflight.from_closure_hash IS NEW.from_closure_hash
      AND preflight.to_publication_id = NEW.to_publication_id
      AND preflight.to_closure_hash = NEW.to_closure_hash
      AND preflight.to_attestation_hash IS NEW.to_attestation_hash
      AND preflight.switched_at_ms = NEW.switched_at_ms
      AND CAST(strftime('%s', 'now') AS INTEGER) * 1000 <= preflight.valid_until_ms
  ) THEN RAISE(ABORT, 'switch history does not match a fresh exact preflight') END;

  SELECT CASE WHEN NOT (
    (NEW.expected_prior_generation = 0 AND NOT EXISTS (SELECT 1 FROM publication_head)) OR
    EXISTS (
      SELECT 1 FROM publication_head AS head
      JOIN publication AS current ON current.publication_id = head.active_publication_id
      WHERE head.singleton = 1
        AND head.generation = NEW.expected_prior_generation
        AND head.active_publication_id = NEW.from_publication_id
        AND head.rollback_candidate_publication_id IS (
          SELECT expected_prior_rollback_candidate_publication_id
          FROM publication_switch_preflight
          WHERE switch_id = NEW.switch_id
        )
        AND head.switched_at_ms = (
          SELECT expected_prior_switched_at_ms
          FROM publication_switch_preflight
          WHERE switch_id = NEW.switch_id
        )
        AND current.state = 'active'
        AND current.closure_hash = NEW.from_closure_hash
    )
  ) THEN RAISE(ABORT, 'switch history lost its exact prior generation') END;

  SELECT CASE WHEN (NEW.action = 'activate' AND NOT EXISTS (
    SELECT 1 FROM publication AS target
    JOIN publication_readiness_attestation AS attestation USING (publication_id)
    WHERE target.publication_id = NEW.to_publication_id
      AND target.state = 'ready'
      AND target.closure_hash = NEW.to_closure_hash
      AND attestation.attestation_hash = NEW.to_attestation_hash
      AND NEW.switched_at_ms <= attestation.effective_valid_until_ms
      AND CAST(strftime('%s', 'now') AS INTEGER) * 1000 <= attestation.effective_valid_until_ms
  )) OR (NEW.action = 'rollback' AND NOT EXISTS (
    SELECT 1 FROM publication_head AS head
    JOIN publication AS target ON target.publication_id = NEW.to_publication_id
    WHERE head.singleton = 1
      AND head.rollback_candidate_publication_id = target.publication_id
      AND target.state = 'superseded'
  )) THEN RAISE(ABORT, 'switch target state or freshness changed after preflight') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> (
    SELECT fts_source_document_count FROM publication_switch_preflight
    WHERE switch_id = NEW.switch_id
  ) OR (
    SELECT count(*) FROM publication_search_fts
    WHERE publication_id = NEW.to_publication_id
  ) <> (
    SELECT fts_index_document_count FROM publication_switch_preflight
    WHERE switch_id = NEW.switch_id
  ) OR EXISTS (
    SELECT 1 FROM publication_search_document AS source
    WHERE source.publication_id = NEW.to_publication_id
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
    WHERE indexed.publication_id = NEW.to_publication_id
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
  ) THEN RAISE(ABORT, 'switch-time FTS parity changed after preflight') END;
END;

DROP TRIGGER publication_state_transition;
CREATE TRIGGER publication_state_transition
BEFORE UPDATE OF state, ready_at_ms, activated_at_ms, failure_codes_json ON publication
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.state = 'building' AND NEW.state IN ('ready', 'failed')) OR
    (OLD.state = 'ready' AND NEW.state = 'active') OR
    (OLD.state = 'active' AND NEW.state IN ('superseded', 'rolled_back')) OR
    (OLD.state = 'superseded' AND NEW.state = 'active') OR
    (OLD.state = NEW.state)
  ) THEN RAISE(ABORT, 'invalid publication state transition') END;
  SELECT CASE WHEN OLD.state = 'building' AND NEW.state = 'ready' AND NOT EXISTS (
    SELECT 1 FROM publication_readiness_attestation
    WHERE publication_id = NEW.publication_id
      AND closure_hash = NEW.closure_hash
      AND ready_at_ms = NEW.ready_at_ms
  ) THEN RAISE(ABORT, 'publication readiness lacks its exact attestation') END;
  SELECT CASE WHEN OLD.state = 'ready' AND NEW.state = 'active' AND NOT EXISTS (
    SELECT 1
    FROM publication_switch_history AS history
    JOIN publication_switch_preflight AS preflight USING (switch_id)
    WHERE history.to_publication_id = NEW.publication_id
      AND history.action = 'activate'
      AND history.switched_at_ms = NEW.activated_at_ms
      AND (
        (
          history.expected_prior_generation = 0
          AND preflight.expected_prior_switched_at_ms IS NULL
          AND preflight.expected_prior_rollback_candidate_publication_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM publication_head)
        ) OR EXISTS (
          SELECT 1 FROM publication_head AS head
          WHERE head.singleton = 1
            AND head.generation = history.expected_prior_generation
            AND head.active_publication_id = history.from_publication_id
            AND head.rollback_candidate_publication_id IS preflight.expected_prior_rollback_candidate_publication_id
            AND head.switched_at_ms = preflight.expected_prior_switched_at_ms
        )
      )
  ) THEN RAISE(ABORT, 'publication activation lacks its exact switch event') END;
  SELECT CASE WHEN OLD.state = 'superseded' AND NEW.state = 'active' AND NOT EXISTS (
    SELECT 1
    FROM publication_switch_history AS history
    JOIN publication_switch_preflight AS preflight USING (switch_id)
    JOIN publication_head AS head
      ON head.generation = history.expected_prior_generation
      AND head.active_publication_id = history.from_publication_id
      AND head.rollback_candidate_publication_id = history.to_publication_id
      AND head.rollback_candidate_publication_id IS preflight.expected_prior_rollback_candidate_publication_id
      AND head.switched_at_ms = preflight.expected_prior_switched_at_ms
    WHERE history.to_publication_id = NEW.publication_id
      AND history.action = 'rollback'
      AND NEW.activated_at_ms = OLD.activated_at_ms
  ) THEN RAISE(ABORT, 'publication rollback lacks its exact switch event') END;
  SELECT CASE WHEN OLD.state = 'active' AND NEW.state IN ('superseded', 'rolled_back') AND NOT EXISTS (
    SELECT 1 FROM publication_switch_history AS history
    JOIN publication_head AS head ON head.generation = history.new_generation
    WHERE history.from_publication_id = OLD.publication_id
      AND head.active_publication_id = history.to_publication_id
      AND ((NEW.state = 'superseded' AND history.action = 'activate') OR (NEW.state = 'rolled_back' AND history.action = 'rollback'))
  ) THEN RAISE(ABORT, 'publication demotion lacks its exact switch event') END;
  SELECT CASE WHEN NEW.state = 'ready' AND (
    (SELECT count(*) FROM publication_provider_slice WHERE publication_id = NEW.publication_id) = 0 OR
    NOT EXISTS (SELECT 1 FROM publication_provider_slice WHERE publication_id = NEW.publication_id AND provider_slice_id IS NOT NULL) OR
    EXISTS (
      SELECT 1
      FROM publication_provider_slice AS current_slice
      WHERE current_slice.publication_id = NEW.publication_id
        AND current_slice.provider_slice_id IS NOT NULL
        AND (
          (
            current_slice.carried_forward = 1 AND NOT EXISTS (
              SELECT 1
              FROM publication_provider_slice AS prior_slice
              JOIN publication AS prior_publication
                ON prior_publication.publication_id = prior_slice.publication_id
              WHERE prior_slice.provider_slice_id = current_slice.provider_slice_id
                AND prior_slice.provider_id = current_slice.provider_id
                AND prior_slice.provider_run_id = current_slice.provider_run_id
                AND prior_publication.state IN ('active', 'superseded', 'rolled_back')
                AND prior_publication.activated_at_ms IS NOT NULL
                AND prior_publication.activated_at_ms <= NEW.generated_at_ms
            )
          ) OR
          EXISTS (
            SELECT 1
            FROM publication_provider_slice AS other_occurrence
            JOIN publication AS other_publication
              ON other_publication.publication_id = other_occurrence.publication_id
            WHERE other_occurrence.provider_slice_id = current_slice.provider_slice_id
              AND other_publication.generated_at_ms > NEW.generated_at_ms
              AND other_publication.state IN ('active', 'superseded', 'rolled_back')
          ) OR
          (
            current_slice.carried_forward = 0 AND EXISTS (
              SELECT 1
              FROM publication_provider_slice AS prior_slice
              JOIN publication AS prior_publication
                ON prior_publication.publication_id = prior_slice.publication_id
              WHERE prior_slice.provider_slice_id = current_slice.provider_slice_id
                AND prior_publication.publication_id <> NEW.publication_id
                AND prior_publication.state IN ('ready', 'active', 'superseded', 'rolled_back')
            )
          )
        )
    ) OR
    NEW.resource_count = 0
  ) THEN RAISE(ABORT, 'publication selected content or provider lineage is incomplete') END;
END;

DROP TRIGGER publication_head_closed_insert;
DROP TRIGGER publication_head_closed_update;

CREATE TRIGGER publication_head_switch_insert
BEFORE INSERT ON publication_head
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_switch_history AS history
    JOIN publication_switch_preflight AS preflight USING (switch_id)
    JOIN publication AS target ON target.publication_id = history.to_publication_id
    WHERE history.new_generation = NEW.generation
      AND history.expected_prior_generation = 0
      AND history.new_generation = 1
      AND history.from_publication_id IS NULL
      AND history.to_publication_id = NEW.active_publication_id
      AND history.resulting_rollback_candidate_publication_id IS NEW.rollback_candidate_publication_id
      AND history.switched_at_ms = NEW.switched_at_ms
      AND target.state = 'active'
  ) THEN RAISE(ABORT, 'publication head insert lacks its exact switch event') END;
END;

CREATE TRIGGER publication_head_switch_update
BEFORE UPDATE ON publication_head
BEGIN
  SELECT CASE WHEN NEW.generation <> OLD.generation + 1
    OR NEW.switched_at_ms <= OLD.switched_at_ms
    OR NEW.rollback_candidate_publication_id IS NOT OLD.active_publication_id
    THEN RAISE(ABORT, 'publication head update is not the exact next generation') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_switch_history AS history
    JOIN publication_switch_preflight AS preflight USING (switch_id)
    JOIN publication AS target ON target.publication_id = history.to_publication_id
    JOIN publication AS prior ON prior.publication_id = history.from_publication_id
    WHERE history.expected_prior_generation = OLD.generation
      AND history.new_generation = NEW.generation
      AND preflight.expected_prior_rollback_candidate_publication_id IS OLD.rollback_candidate_publication_id
      AND preflight.expected_prior_switched_at_ms = OLD.switched_at_ms
      AND history.from_publication_id = OLD.active_publication_id
      AND history.from_closure_hash = prior.closure_hash
      AND history.to_publication_id = NEW.active_publication_id
      AND history.to_closure_hash = target.closure_hash
      AND history.resulting_rollback_candidate_publication_id = OLD.active_publication_id
      AND history.switched_at_ms = NEW.switched_at_ms
      AND target.state = 'active'
      AND prior.state = 'active'
  ) THEN RAISE(ABORT, 'publication head update lacks its exact switch event') END;
END;

-- The history insert is the single SQL mutation that performs the switch. Any nested
-- lifecycle/head failure rolls back the event and leaves the prior head unchanged.
CREATE TRIGGER publication_switch_history_apply
AFTER INSERT ON publication_switch_history
BEGIN
  UPDATE publication
  SET state = 'active',
      activated_at_ms = CASE WHEN NEW.action = 'activate' THEN NEW.switched_at_ms ELSE activated_at_ms END
  WHERE publication_id = NEW.to_publication_id;

  INSERT INTO publication_head(singleton, active_publication_id, rollback_candidate_publication_id, switched_at_ms, generation)
  SELECT 1, NEW.to_publication_id, NEW.resulting_rollback_candidate_publication_id, NEW.switched_at_ms, NEW.new_generation
  WHERE NEW.expected_prior_generation = 0;

  UPDATE publication_head
  SET active_publication_id = NEW.to_publication_id,
      rollback_candidate_publication_id = NEW.resulting_rollback_candidate_publication_id,
      switched_at_ms = NEW.switched_at_ms,
      generation = NEW.new_generation
  WHERE singleton = 1 AND NEW.expected_prior_generation > 0;

  UPDATE publication
  SET state = CASE NEW.action WHEN 'activate' THEN 'superseded' ELSE 'rolled_back' END
  WHERE publication_id = NEW.from_publication_id;
END;

CREATE TRIGGER publication_switch_history_immutable_update
BEFORE UPDATE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, 'switch history is append-only'); END;
CREATE TRIGGER publication_switch_history_immutable_delete
BEFORE DELETE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, 'switch history cannot be deleted'); END;

-- The existing closed-delete trigger intentionally remains in force.

UPDATE serving_schema_metadata
SET schema_version = '1.4.0'
WHERE singleton = 1;
