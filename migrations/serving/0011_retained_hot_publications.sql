-- Indexed retained-hot publication authority for multi-switch cursor continuity.
-- Requirements: API-003, API-007, API-015, API-024A, SRCH-007, PIPE-052, QA-006.

PRAGMA defer_foreign_keys = true;

-- Advance only the exact current serving schema. Metadata alone is not enough:
-- retained-hot eligibility depends on immutable, complete switch-history rows.
SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.7.0'
) <> 1 THEN json('') END;

SELECT CASE WHEN (
  SELECT count(*)
  FROM sqlite_schema
  WHERE type = 'table' AND name = 'publication_switch_history'
    AND instr(lower(sql), 'new_generation = expected_prior_generation + 1') > 0
    AND instr(lower(sql), 'resulting_rollback_candidate_publication_id is from_publication_id') > 0
    AND instr(lower(sql), 'switched_at_ms integer not null check (typeof(switched_at_ms) = ''integer'' and switched_at_ms >= 0)') > 0
    AND instr(lower(sql), 'foreign key (switch_id) references publication_switch_preflight(switch_id) on delete restrict') > 0
) <> 1 OR (
  SELECT count(*) FROM pragma_table_info('publication_switch_history')
) <> 18 OR (
  SELECT count(*)
  FROM pragma_table_info('publication_switch_history')
  WHERE
    (name = 'from_publication_id' AND type = 'TEXT' AND "notnull" = 0) OR
    (name = 'expected_prior_rollback_candidate_publication_id' AND type = 'TEXT' AND "notnull" = 0) OR
    (name = 'switched_at_ms' AND type = 'INTEGER' AND "notnull" = 1) OR
    (name = 'new_generation' AND type = 'INTEGER' AND "notnull" = 1)
) <> 4 OR (
  SELECT count(*)
  FROM sqlite_schema
  WHERE type = 'trigger'
    AND tbl_name = 'publication_switch_history'
    AND (
      (name = 'publication_switch_history_insert_guard'
        AND sql = 'CREATE TRIGGER publication_switch_history_insert_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM pragma_index_list(''publication_provider_model_id_search_document'')
    WHERE name = ''publication_provider_model_id_raw_exact_idx''
      AND "unique" = 0 AND origin = ''c'' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*)
    FROM pragma_index_info(''publication_provider_model_id_raw_exact_idx'')
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND cid = 0 AND name = ''publication_id'' THEN 1
      WHEN seqno = 1 AND cid = 7 AND name = ''raw_provider_model_id_utf8'' THEN 1
      WHEN seqno = 2 AND cid = 2 AND name = ''offering_id'' THEN 1
      ELSE 0 END) = 3
  ) OR NOT EXISTS (
    SELECT 1
    FROM pragma_index_list(''publication_provider_model_id_search_document'')
    WHERE name = ''publication_provider_model_id_normalized_exact_idx''
      AND "unique" = 0 AND origin = ''c'' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*)
    FROM pragma_index_info(''publication_provider_model_id_normalized_exact_idx'')
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND cid = 0 AND name = ''publication_id'' THEN 1
      WHEN seqno = 1 AND cid = 8 AND name = ''normalized_provider_model_id_utf8'' THEN 1
      WHEN seqno = 2 AND cid = 2 AND name = ''offering_id'' THEN 1
      ELSE 0 END) = 3
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_raw_exact_idx
    WHERE publication_id = NEW.to_publication_id
      AND raw_provider_model_id_utf8 = X''FF''
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_normalized_exact_idx
    WHERE publication_id = NEW.to_publication_id
      AND normalized_provider_model_id_utf8 = X''FF''
  ) THEN RAISE(ABORT, ''switch-time provider model ID exact indexes are missing malformed or unqueryable'') END;

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
      AND CAST(strftime(''%s'', ''now'') AS INTEGER) * 1000 <= preflight.valid_until_ms
  ) THEN RAISE(ABORT, ''switch history does not match a fresh exact preflight'') END;

  SELECT CASE WHEN NOT (
    (NEW.expected_prior_generation = 0 AND NOT EXISTS (SELECT 1 FROM publication_head))
    OR EXISTS (
      SELECT 1 FROM publication_head AS head
      JOIN publication AS current ON current.publication_id = head.active_publication_id
      WHERE head.singleton = 1
        AND head.generation = NEW.expected_prior_generation
        AND head.active_publication_id = NEW.from_publication_id
        AND head.rollback_candidate_publication_id IS (
          SELECT expected_prior_rollback_candidate_publication_id
          FROM publication_switch_preflight WHERE switch_id = NEW.switch_id
        )
        AND head.switched_at_ms = (
          SELECT expected_prior_switched_at_ms
          FROM publication_switch_preflight WHERE switch_id = NEW.switch_id
        )
        AND current.state = ''active''
        AND current.closure_hash = NEW.from_closure_hash
    )
  ) THEN RAISE(ABORT, ''switch history lost its exact prior generation'') END;

  SELECT CASE WHEN (NEW.action = ''activate'' AND NOT EXISTS (
    SELECT 1 FROM publication AS target
    JOIN publication_readiness_attestation AS attestation USING (publication_id)
    WHERE target.publication_id = NEW.to_publication_id
      AND target.state = ''ready''
      AND target.closure_hash = NEW.to_closure_hash
      AND attestation.attestation_hash = NEW.to_attestation_hash
      AND NEW.switched_at_ms <= attestation.effective_valid_until_ms
      AND CAST(strftime(''%s'', ''now'') AS INTEGER) * 1000 <= attestation.effective_valid_until_ms
  )) OR (NEW.action = ''rollback'' AND NOT EXISTS (
    SELECT 1 FROM publication_head AS head
    JOIN publication AS target ON target.publication_id = NEW.to_publication_id
    WHERE head.singleton = 1
      AND head.rollback_candidate_publication_id = target.publication_id
      AND target.state = ''superseded''
  )) THEN RAISE(ABORT, ''switch target state or freshness changed after preflight'') END;

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
  ) THEN RAISE(ABORT, ''switch-time FTS parity changed after preflight'') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_provider_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> (
    SELECT provider_search_document_count FROM publication_switch_preflight
    WHERE switch_id = NEW.switch_id
  ) OR (
    SELECT count(*) FROM publication_provider_search_fts
    WHERE publication_id = NEW.to_publication_id
  ) <> (
    SELECT provider_search_fts_document_count FROM publication_switch_preflight
    WHERE switch_id = NEW.switch_id
  ) OR EXISTS (
    SELECT 1 FROM publication_provider_search_document AS source
    WHERE source.publication_id = NEW.to_publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_fts AS indexed
        WHERE indexed.publication_id = source.publication_id
          AND indexed.provider_id = source.provider_id
          AND indexed.display_name = source.display_name
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_provider_search_fts AS indexed
    WHERE indexed.publication_id = NEW.to_publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_document AS source
        WHERE source.publication_id = indexed.publication_id
          AND source.provider_id = indexed.provider_id
          AND source.display_name = indexed.display_name
      )
  ) THEN RAISE(ABORT, ''switch-time provider FTS parity changed after preflight'') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_model_variant_name_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> (
    SELECT model_variant_name_storage_document_count
    FROM publication_switch_preflight
    WHERE switch_id = NEW.switch_id
  ) THEN RAISE(ABORT, ''switch-time model/variant name storage changed after preflight'') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_provider_model_id_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> (
    SELECT provider_model_id_storage_document_count
    FROM publication_switch_preflight
    WHERE switch_id = NEW.switch_id
  ) THEN RAISE(ABORT, ''switch-time provider model ID storage changed after preflight'') END;

END')
      OR (name = 'publication_switch_history_apply'
        AND sql = 'CREATE TRIGGER publication_switch_history_apply
AFTER INSERT ON publication_switch_history
BEGIN
  UPDATE publication
  SET state = ''active'',
      activated_at_ms = CASE WHEN NEW.action = ''activate'' THEN NEW.switched_at_ms ELSE activated_at_ms END
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
  SET state = CASE NEW.action WHEN ''activate'' THEN ''superseded'' ELSE ''rolled_back'' END
  WHERE publication_id = NEW.from_publication_id;
END')
      OR (name = 'publication_switch_history_immutable_update'
        AND sql = 'CREATE TRIGGER publication_switch_history_immutable_update
BEFORE UPDATE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, ''switch history is append-only''); END')
      OR (name = 'publication_switch_history_immutable_delete'
        AND sql = 'CREATE TRIGGER publication_switch_history_immutable_delete
BEFORE DELETE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, ''switch history cannot be deleted''); END')
    )
) <> 4 THEN json('') END;

-- Any same-name object is corruption, including a lookalike index.
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM sqlite_schema
  WHERE name IN (
    'publication_switch_history_from_retained_hot_idx',
    'publication_switch_history_prior_rollback_retained_hot_idx'
  )
) THEN json('') END;

CREATE INDEX publication_switch_history_from_retained_hot_idx
ON publication_switch_history(
  from_publication_id,
  switched_at_ms DESC,
  new_generation DESC
)
WHERE from_publication_id IS NOT NULL;

CREATE INDEX publication_switch_history_prior_rollback_retained_hot_idx
ON publication_switch_history(
  expected_prior_rollback_candidate_publication_id,
  switched_at_ms DESC,
  new_generation DESC
)
WHERE expected_prior_rollback_candidate_publication_id IS NOT NULL;

UPDATE serving_schema_metadata
SET schema_version = '1.8.0'
WHERE singleton = 1;
