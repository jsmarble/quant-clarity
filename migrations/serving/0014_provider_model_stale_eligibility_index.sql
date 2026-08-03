-- Bounded target-first Offering eligibility for explicit stale search filters.
-- Requirements: DATA-067, FE-025, SRCH-004, API-008, API-010, BE-003,
-- QA-005, QA-013.

PRAGMA defer_foreign_keys = true;

-- Advance only the exact clean schema installed by migration 0013.
SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.10.0'
) <> 1 THEN json('') END;

-- Recheck the complete immutable provider-model-ID projection and all three
-- existing indexes. The new index adds no authority or lifecycle columns.
SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table'
    AND name = 'publication_provider_model_id_search_document'
    AND instr(lower(sql), 'primary key (publication_id, offering_id)') > 0
    AND instr(lower(sql), 'projection_version = ''provider-model-id@1''') > 0
    AND instr(lower(sql), ') strict') > 0
) <> 1 OR (
  SELECT count(*)
  FROM pragma_table_info('publication_provider_model_id_search_document')
) <> 11 OR (
  SELECT count(*)
  FROM pragma_table_info('publication_provider_model_id_search_document')
  WHERE
    (cid = 0 AND name = 'publication_id' AND type = 'TEXT' AND "notnull" = 1 AND pk = 1) OR
    (cid = 1 AND name = 'offering_resource_type' AND type = 'TEXT' AND "notnull" = 1 AND dflt_value = '''offering''' AND pk = 0) OR
    (cid = 2 AND name = 'offering_id' AND type = 'TEXT' AND "notnull" = 1 AND pk = 2) OR
    (cid = 3 AND name = 'provider_id' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 4 AND name = 'target_resource_type' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 5 AND name = 'target_resource_id' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 6 AND name = 'projection_version' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 7 AND name = 'raw_provider_model_id_utf8' AND type = 'BLOB' AND "notnull" = 1 AND pk = 0) OR
    (cid = 8 AND name = 'normalized_provider_model_id_utf8' AND type = 'BLOB' AND "notnull" = 1 AND pk = 0) OR
    (cid = 9 AND name = 'offering_content_hash' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 10 AND name = 'target_content_hash' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0)
) <> 11 OR (
  SELECT count(*)
  FROM pragma_foreign_key_list(
    'publication_provider_model_id_search_document'
  )
) <> 9 OR (
  WITH expected_foreign_key(id, seq, target_table, source_column, target_column) AS (
    VALUES
      (0, 0, 'publication_resource', 'publication_id', 'publication_id'),
      (0, 1, 'publication_resource', 'target_resource_type', 'resource_type'),
      (0, 2, 'publication_resource', 'target_resource_id', 'resource_id'),
      (1, 0, 'publication_provider_slice', 'publication_id', 'publication_id'),
      (1, 1, 'publication_provider_slice', 'provider_id', 'provider_id'),
      (2, 0, 'publication_resource', 'publication_id', 'publication_id'),
      (2, 1, 'publication_resource', 'offering_resource_type', 'resource_type'),
      (2, 2, 'publication_resource', 'offering_id', 'resource_id'),
      (3, 0, 'publication', 'publication_id', 'publication_id')
  )
  SELECT count(*)
  FROM expected_foreign_key AS expected
  JOIN pragma_foreign_key_list(
    'publication_provider_model_id_search_document'
  ) AS actual
    ON actual.id = expected.id
   AND actual.seq = expected.seq
   AND actual."table" = expected.target_table
   AND actual."from" = expected.source_column
   AND actual."to" = expected.target_column
   AND actual."on_update" = 'NO ACTION'
   AND actual."on_delete" = 'RESTRICT'
   AND actual."match" = 'NONE'
) <> 9 OR NOT EXISTS (
  SELECT count(*)
  FROM pragma_index_xinfo('publication_provider_model_id_raw_exact_idx')
  WHERE key = 1
  HAVING count(*) = 3 AND sum(CASE
    WHEN seqno = 0 AND cid = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 1 AND cid = 7 AND name = 'raw_provider_model_id_utf8' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 2 AND cid = 2 AND name = 'offering_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    ELSE 0 END) = 3
) OR NOT EXISTS (
  SELECT count(*)
  FROM pragma_index_xinfo('publication_provider_model_id_normalized_exact_idx')
  WHERE key = 1
  HAVING count(*) = 3 AND sum(CASE
    WHEN seqno = 0 AND cid = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 1 AND cid = 8 AND name = 'normalized_provider_model_id_utf8' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 2 AND cid = 2 AND name = 'offering_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    ELSE 0 END) = 3
) OR NOT EXISTS (
  SELECT count(*)
  FROM pragma_index_xinfo('publication_provider_model_id_eligibility_idx')
  WHERE key = 1
  HAVING count(*) = 5 AND sum(CASE
    WHEN seqno = 0 AND cid = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 1 AND cid = 3 AND name = 'provider_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 2 AND cid = 4 AND name = 'target_resource_type' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 3 AND cid = 5 AND name = 'target_resource_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 4 AND cid = 2 AND name = 'offering_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    ELSE 0 END) = 5
) OR (
  SELECT count(*) FROM pragma_index_list(
    'publication_provider_model_id_search_document'
  ) WHERE name IN (
    'publication_provider_model_id_raw_exact_idx',
    'publication_provider_model_id_normalized_exact_idx',
    'publication_provider_model_id_eligibility_idx'
  ) AND "unique" = 0 AND origin = 'c' AND partial = 0
) <> 3 OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_provider_model_id_search_document_immutable_update'
    AND tbl_name = 'publication_provider_model_id_search_document'
    AND length(sql) = 221
    AND instr(sql, 'provider model ID search document is immutable') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_provider_model_id_search_document_immutable_delete'
    AND tbl_name = 'publication_provider_model_id_search_document'
    AND length(sql) = 226
    AND instr(sql, 'provider model ID search document cannot be deleted') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_provider_model_id_search_document_insert_guard'
    AND tbl_name = 'publication_provider_model_id_search_document'
    AND length(sql) = 9910
    AND instr(sql, 'provider model ID search document does not match canonical offering and target content') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_switch_history_provider_eligibility_index_guard'
    AND tbl_name = 'publication_switch_history'
    AND instr(sql, 'switch-time provider eligibility index is missing malformed or unqueryable') > 0
    AND instr(sql, 'publication_provider_model_id_eligibility_idx') > 0
    AND instr(sql, 'target_resource_type = ''__queryability_probe__''') > 0
) THEN json('') END;

-- Preserve the schema-1.10 immutable dataset summary rather than trusting the
-- version marker. This migration neither reads nor rewrites summary rows.
SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table'
    AND name = 'publication_dataset_metadata_summary'
    AND instr(lower(sql), 'summary_version = ''1.0.0''') > 0
    AND instr(lower(sql), ') strict') > 0
) <> 1 OR (
  SELECT count(*)
  FROM pragma_table_info('publication_dataset_metadata_summary')
) <> 12 OR (
  SELECT count(*)
  FROM pragma_table_info('publication_dataset_metadata_summary')
  WHERE
    (cid = 0 AND name = 'publication_id' AND type = 'TEXT' AND "notnull" = 1 AND pk = 1) OR
    (cid = 1 AND name = 'summary_version' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 2 AND name = 'closure_hash' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 3 AND name = 'source_resource_count' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0) OR
    (cid = 4 AND name = 'provider_slice_count' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0) OR
    (cid = 5 AND name = 'provider_slice_hash' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 6 AND name = 'active_model_count' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0) OR
    (cid = 7 AND name = 'active_offering_count' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0) OR
    (cid = 8 AND name = 'active_provider_count' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0) OR
    (cid = 9 AND name = 'has_stale_provider_slices' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0) OR
    (cid = 10 AND name = 'has_unavailable_provider_slices' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0) OR
    (cid = 11 AND name = 'summary_hash' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0)
) <> 12 OR (
  SELECT count(*) FROM pragma_foreign_key_list(
    'publication_dataset_metadata_summary'
  )
) <> 1 OR (
  SELECT count(*) FROM pragma_foreign_key_list(
    'publication_dataset_metadata_summary'
  ) WHERE "table" = 'publication_closure_seal'
    AND "from" = 'publication_id' AND "to" = 'publication_id'
    AND "on_delete" = 'RESTRICT'
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name IN (
    'publication_dataset_metadata_summary_insert_guard',
    'publication_dataset_metadata_summary_immutable_update',
    'publication_dataset_metadata_summary_immutable_delete',
    'publication_dataset_metadata_summary_readiness_guard',
    'publication_dataset_metadata_summary_switch_guard'
  )
) <> 5 OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_dataset_metadata_summary_insert_guard'
    AND tbl_name = 'publication_dataset_metadata_summary'
    AND length(sql) = 4163
    AND instr(sql, 'dataset metadata summary does not match its sealed publication') > 0
    AND instr(sql, 'dataset metadata summary does not match sealed source rows') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_dataset_metadata_summary_immutable_update'
    AND tbl_name = 'publication_dataset_metadata_summary'
    AND length(sql) = 194
    AND instr(sql, 'dataset metadata summary is immutable') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_dataset_metadata_summary_immutable_delete'
    AND tbl_name = 'publication_dataset_metadata_summary'
    AND length(sql) = 199
    AND instr(sql, 'dataset metadata summary cannot be deleted') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_dataset_metadata_summary_readiness_guard'
    AND tbl_name = 'publication'
    AND length(sql) = 3915
    AND instr(sql, 'publication readiness lacks an exact dataset metadata summary') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_dataset_metadata_summary_switch_guard'
    AND tbl_name = 'publication_switch_history'
    AND length(sql) = 2565
    AND instr(sql, 'switch target lacks an exact dataset metadata summary') > 0
) THEN json('') END;

-- Any same-name object is corruption, including a lookalike table or trigger.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE name IN (
    'publication_provider_model_id_target_eligibility_idx',
    'publication_switch_history_target_eligibility_index_guard'
  )
) THEN json('') END;

CREATE INDEX publication_provider_model_id_target_eligibility_idx
ON publication_provider_model_id_search_document(
  publication_id,
  target_resource_type,
  target_resource_id,
  offering_id
);

-- Activation and rollback share publication_switch_history, so this one
-- trigger protects both state transitions atomically.
CREATE TRIGGER publication_switch_history_target_eligibility_index_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM pragma_index_list('publication_provider_model_id_search_document')
    WHERE name = 'publication_provider_model_id_target_eligibility_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*)
    FROM pragma_index_xinfo(
      'publication_provider_model_id_target_eligibility_idx'
    )
    WHERE key = 1
    HAVING count(*) = 4 AND sum(CASE
      WHEN seqno = 0 AND cid = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 1 AND cid = 4 AND name = 'target_resource_type' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 2 AND cid = 5 AND name = 'target_resource_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 3 AND cid = 2 AND name = 'offering_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      ELSE 0 END) = 4
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_target_eligibility_idx
    WHERE publication_id = NEW.to_publication_id
      AND target_resource_type = '__queryability_probe__'
      AND target_resource_id = 'mdl_ffffffff-ffff-4fff-bfff-ffffffffffff'
      AND offering_id = 'off_ffffffff-ffff-4fff-bfff-ffffffffffff'
  ) THEN RAISE(ABORT, 'switch-time target eligibility index is missing malformed or unqueryable') END;
END;

UPDATE serving_schema_metadata
SET schema_version = '1.11.0'
WHERE singleton = 1;
