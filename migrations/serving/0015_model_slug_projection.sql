-- Immutable publication Model-slug artifact proof and exact route projection.
-- Requirements: DATA-001, PIPE-044, PIPE-050--PIPE-055, BE-002,
-- BE-005--BE-007, BE-011, BE-012, QA-001, QA-006.

PRAGMA defer_foreign_keys = true;

-- Advance only the exact currently accepted serving schema. All following
-- mutations are installed by the migration runner in one transaction.
SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.11.0'
) <> 1 OR EXISTS (
  SELECT 1 FROM publication_closure_seal
) THEN json('') END;

-- Do not trust a forged 1.11 marker. Recheck the exact target-first index and
-- its switch guard plus the immutable projection and summary they depend on.
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM pragma_index_list(
    'publication_provider_model_id_search_document'
  )
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
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_switch_history_target_eligibility_index_guard'
    AND tbl_name = 'publication_switch_history'
    AND instr(sql, 'switch-time target eligibility index is missing malformed or unqueryable') > 0
    AND instr(sql, 'publication_provider_model_id_target_eligibility_idx') > 0
    AND instr(sql, 'target_resource_type = ''__queryability_probe__''') > 0
) OR (
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
  SELECT count(*) FROM pragma_foreign_key_list(
    'publication_provider_model_id_search_document'
  )
) <> 9 OR (
  SELECT count(*) FROM pragma_index_list(
    'publication_provider_model_id_search_document'
  ) WHERE name IN (
    'publication_provider_model_id_raw_exact_idx',
    'publication_provider_model_id_normalized_exact_idx',
    'publication_provider_model_id_eligibility_idx',
    'publication_provider_model_id_target_eligibility_idx'
  ) AND "unique" = 0 AND origin = 'c' AND partial = 0
) <> 4 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_provider_model_id_search_document_insert_guard'
    AND tbl_name = 'publication_provider_model_id_search_document'
    AND length(sql) = 9910
    AND instr(sql, 'provider model ID search document does not match canonical offering and target content') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_provider_model_id_search_document_immutable_update'
    AND tbl_name = 'publication_provider_model_id_search_document'
    AND length(sql) = 221
    AND instr(sql, 'provider model ID search document is immutable') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_provider_model_id_search_document_immutable_delete'
    AND tbl_name = 'publication_provider_model_id_search_document'
    AND length(sql) = 226
    AND instr(sql, 'provider model ID search document cannot be deleted') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name IN (
    'publication_provider_model_id_search_document_insert_guard',
    'publication_provider_model_id_search_document_immutable_update',
    'publication_provider_model_id_search_document_immutable_delete',
    'publication_switch_history_provider_eligibility_index_guard',
    'publication_switch_history_target_eligibility_index_guard'
  )
) <> 5 OR (
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
  ) WHERE "table" = 'publication_closure_seal'
    AND "from" = 'publication_id' AND "to" = 'publication_id'
    AND "on_delete" = 'RESTRICT'
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_dataset_metadata_summary_insert_guard'
    AND tbl_name = 'publication_dataset_metadata_summary'
    AND length(sql) = 4163
    AND instr(sql, 'dataset metadata summary does not match its sealed publication') > 0
    AND instr(sql, 'dataset metadata summary does not match sealed source rows') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_dataset_metadata_summary_readiness_guard'
    AND tbl_name = 'publication'
    AND length(sql) = 3915
    AND instr(sql, 'publication readiness lacks an exact dataset metadata summary') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_dataset_metadata_summary_switch_guard'
    AND tbl_name = 'publication_switch_history'
    AND length(sql) = 2565
    AND instr(sql, 'switch target lacks an exact dataset metadata summary') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name IN (
    'publication_dataset_metadata_summary_insert_guard',
    'publication_dataset_metadata_summary_immutable_update',
    'publication_dataset_metadata_summary_immutable_delete',
    'publication_dataset_metadata_summary_readiness_guard',
    'publication_dataset_metadata_summary_switch_guard'
  )
) <> 5 THEN json('') END;

-- The new guards trust these foundational closure tables. Recheck their exact
-- key columns, foreign keys, and mutation boundaries before adding authority.
SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name IN (
    'publication',
    'publication_resource',
    'publication_staging_revision',
    'publication_closure_seal'
  )
) <> 4 OR (
  SELECT count(*) FROM pragma_table_info('publication')
) <> 23 OR (
  SELECT count(*) FROM pragma_table_info('publication')
  WHERE
    (cid = 0 AND name = 'publication_id' AND type = 'TEXT' AND "notnull" = 0 AND pk = 1) OR
    (cid = 1 AND name = 'state' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 12 AND name = 'generated_at_ms' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0) OR
    (cid = 20 AND name = 'closure_hash' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0)
) <> 4 OR (
  SELECT count(*) FROM pragma_table_info('publication_resource')
) <> 5 OR (
  SELECT count(*) FROM pragma_table_info('publication_resource')
  WHERE
    (cid = 0 AND name = 'publication_id' AND type = 'TEXT' AND "notnull" = 1 AND pk = 1) OR
    (cid = 1 AND name = 'resource_type' AND type = 'TEXT' AND "notnull" = 1 AND pk = 2) OR
    (cid = 2 AND name = 'resource_id' AND type = 'TEXT' AND "notnull" = 1 AND pk = 3) OR
    (cid = 3 AND name = 'resource_json' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 4 AND name = 'content_hash' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0)
) <> 5 OR (
  SELECT count(*) FROM pragma_foreign_key_list('publication_resource')
  WHERE "table" = 'publication' AND "from" = 'publication_id'
    AND "to" = 'publication_id' AND "on_delete" = 'RESTRICT'
) <> 1 OR (
  SELECT count(*) FROM pragma_table_info('publication_staging_revision')
  WHERE
    (cid = 0 AND name = 'publication_id' AND type = 'TEXT' AND "notnull" = 0 AND pk = 1) OR
    (cid = 1 AND name = 'revision' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0)
) <> 2 OR (
  SELECT count(*) FROM pragma_foreign_key_list(
    'publication_staging_revision'
  ) WHERE "table" = 'publication' AND "from" = 'publication_id'
    AND "to" = 'publication_id' AND "on_delete" = 'RESTRICT'
) <> 1 OR (
  SELECT count(*) FROM pragma_table_info('publication_closure_seal')
) <> 23 OR (
  SELECT count(*) FROM pragma_table_info('publication_closure_seal')
  WHERE
    (cid = 0 AND name = 'publication_id' AND type = 'TEXT' AND "notnull" = 0 AND pk = 1) OR
    (cid = 1 AND name = 'staging_revision' AND type = 'INTEGER' AND "notnull" = 1 AND pk = 0) OR
    (cid = 13 AND name = 'bundle_hash' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0) OR
    (cid = 21 AND name = 'closure_hash' AND type = 'TEXT' AND "notnull" = 1 AND pk = 0)
) <> 4 OR (
  SELECT count(*) FROM pragma_foreign_key_list('publication_closure_seal')
  WHERE "table" = 'publication' AND "from" = 'publication_id'
    AND "to" = 'publication_id' AND "on_delete" = 'RESTRICT'
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name IN (
    'publication_resource_type_insert',
    'publication_resource_immutable_update',
    'publication_resource_immutable_delete',
    'publication_resource_building_insert',
    'publication_resource_post_seal_insert_guard',
    'publication_resource_revision',
    'publication_staging_revision_seed',
    'publication_staging_revision_immutable_update',
    'publication_staging_revision_immutable_delete',
    'publication_closure_seal_insert_guard',
    'publication_closure_seal_immutable_update',
    'publication_closure_seal_immutable_delete'
  )
) <> 12 OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_type_insert'
    AND tbl_name = 'publication_resource'
    AND instr(sql, 'publication resource type and ID prefix disagree') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_immutable_update'
    AND tbl_name = 'publication_resource'
    AND instr(sql, 'publication resource is immutable') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_immutable_delete'
    AND tbl_name = 'publication_resource'
    AND instr(sql, 'publication resource cannot be deleted') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_building_insert'
    AND tbl_name = 'publication_resource'
    AND instr(sql, 'publication resources may be staged only while building') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_post_seal_insert_guard'
    AND tbl_name = 'publication_resource'
    AND instr(sql, 'sealed publication closure is immutable') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_revision'
    AND tbl_name = 'publication_resource'
    AND instr(sql, 'revision = revision + 1') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_staging_revision_seed'
    AND tbl_name = 'publication'
    AND instr(sql, 'INSERT INTO publication_staging_revision') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_closure_seal_insert_guard'
    AND tbl_name = 'publication_closure_seal'
    AND instr(sql, 'seal does not match immutable publication metadata') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_staging_revision_immutable_update'
    AND tbl_name = 'publication_staging_revision'
    AND instr(sql, 'publication staging revision is trigger-managed') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_staging_revision_immutable_delete'
    AND tbl_name = 'publication_staging_revision'
    AND instr(sql, 'publication staging revision cannot be deleted') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_closure_seal_immutable_update'
    AND tbl_name = 'publication_closure_seal'
    AND instr(sql, 'publication closure seal is immutable') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_closure_seal_immutable_delete'
    AND tbl_name = 'publication_closure_seal'
    AND instr(sql, 'publication closure seal cannot be deleted') > 0
) THEN json('') END;

-- Same-name objects are corruption, including views or lookalike indexes.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE name IN (
    'publication_model_slug_artifact_proof',
    'publication_model_slug_mapping',
    'publication_model_slug_exact_idx',
    'publication_model_slug_artifact_proof_replace_guard',
    'publication_model_slug_artifact_proof_insert_guard',
    'publication_model_slug_artifact_proof_immutable_update',
    'publication_model_slug_artifact_proof_immutable_delete',
    'publication_model_slug_mapping_replace_guard',
    'publication_model_slug_mapping_insert_guard',
    'publication_model_slug_mapping_immutable_update',
    'publication_model_slug_mapping_immutable_delete'
  )
) THEN json('') END;

CREATE TABLE publication_model_slug_mapping (
  publication_id TEXT NOT NULL,
  slug TEXT NOT NULL CHECK (
    typeof(slug) = 'text'
    AND length(slug) BETWEEN 1 AND 128
    AND instr(CAST(slug AS BLOB), CAST(char(0) AS BLOB)) = 0
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND slug NOT GLOB '-*'
    AND slug NOT GLOB '*-'
    AND slug NOT GLOB '*--*'
  ),
  target_resource_type TEXT NOT NULL DEFAULT 'model'
    CHECK (target_resource_type = 'model'),
  model_id TEXT NOT NULL CHECK (
    length(model_id) = 40
    AND substr(model_id, 1, 4) = 'mdl_'
    AND model_id = lower(model_id)
    AND substr(model_id, 5, 8) NOT GLOB '*[^0-9a-f]*'
    AND substr(model_id, 13, 1) = '-'
    AND substr(model_id, 14, 4) NOT GLOB '*[^0-9a-f]*'
    AND substr(model_id, 18, 1) = '-'
    AND substr(model_id, 19, 1) = '4'
    AND substr(model_id, 20, 3) NOT GLOB '*[^0-9a-f]*'
    AND substr(model_id, 23, 1) = '-'
    AND substr(model_id, 24, 1) GLOB '[89ab]'
    AND substr(model_id, 25, 3) NOT GLOB '*[^0-9a-f]*'
    AND substr(model_id, 28, 1) = '-'
    AND substr(model_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  projection_version TEXT NOT NULL CHECK (
    projection_version = 'model-slug@1'
  ),
  resolution TEXT NOT NULL CHECK (resolution IN ('current', 'historical')),
  target_content_hash TEXT NOT NULL CHECK (
    length(target_content_hash) = 71
    AND substr(target_content_hash, 1, 7) = 'sha256:'
    AND substr(target_content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (publication_id, slug),
  FOREIGN KEY (publication_id, target_resource_type, model_id)
    REFERENCES publication_resource(publication_id, resource_type, resource_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (publication_id)
    REFERENCES publication(publication_id) ON DELETE RESTRICT
) STRICT;

-- A named BINARY index is retained even though the primary key is unique so
-- B2B/B2C can prove the exact lookup access path with INDEXED BY.
CREATE INDEX publication_model_slug_exact_idx
ON publication_model_slug_mapping(publication_id, slug, model_id);

CREATE TABLE publication_model_slug_artifact_proof (
  publication_id TEXT PRIMARY KEY
    REFERENCES publication(publication_id) ON DELETE RESTRICT,
  staging_revision INTEGER NOT NULL CHECK (
    typeof(staging_revision) = 'integer' AND staging_revision >= 0
  ),
  artifact_version TEXT NOT NULL CHECK (
    artifact_version = 'model-slug-history-artifact@1'
  ),
  acquisition_version TEXT NOT NULL CHECK (
    acquisition_version = 'model-slug-history-canonical@1'
  ),
  projection_version TEXT NOT NULL CHECK (
    projection_version = 'model-slug@1'
  ),
  base_bundle_hash TEXT NOT NULL CHECK (
    length(base_bundle_hash) = 71
    AND substr(base_bundle_hash, 1, 7) = 'sha256:'
    AND substr(base_bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  closure_hash TEXT NOT NULL CHECK (
    length(closure_hash) = 71
    AND substr(closure_hash, 1, 7) = 'sha256:'
    AND substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  publication_boundary_ms INTEGER NOT NULL CHECK (
    typeof(publication_boundary_ms) = 'integer'
    AND publication_boundary_ms BETWEEN 0 AND 9007199254740991
  ),
  artifact_digest TEXT NOT NULL CHECK (
    length(artifact_digest) = 71
    AND substr(artifact_digest, 1, 7) = 'sha256:'
    AND substr(artifact_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  artifact_byte_count INTEGER NOT NULL CHECK (
    typeof(artifact_byte_count) = 'integer'
    AND artifact_byte_count >= 1
    AND artifact_byte_count <= 25165824
  ),
  model_count INTEGER NOT NULL CHECK (
    typeof(model_count) = 'integer' AND model_count BETWEEN 0 AND 25000
  ),
  source_history_count INTEGER NOT NULL CHECK (
    typeof(source_history_count) = 'integer'
    AND source_history_count BETWEEN 0 AND 50000
    AND source_history_count >= model_count
  ),
  source_history_hash TEXT NOT NULL CHECK (
    length(source_history_hash) = 71
    AND substr(source_history_hash, 1, 7) = 'sha256:'
    AND substr(source_history_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  mapping_count INTEGER NOT NULL CHECK (
    typeof(mapping_count) = 'integer'
    AND mapping_count BETWEEN 0 AND 50000
    AND mapping_count <= source_history_count
  ),
  current_mapping_count INTEGER NOT NULL CHECK (
    typeof(current_mapping_count) = 'integer'
    AND current_mapping_count = model_count
    AND current_mapping_count <= mapping_count
  ),
  historical_mapping_count INTEGER NOT NULL CHECK (
    typeof(historical_mapping_count) = 'integer'
    AND historical_mapping_count >= 0
    AND historical_mapping_count = mapping_count - current_mapping_count
  ),
  mapping_inventory_hash TEXT NOT NULL CHECK (
    length(mapping_inventory_hash) = 71
    AND substr(mapping_inventory_hash, 1, 7) = 'sha256:'
    AND substr(mapping_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

-- DELETE triggers do not reliably protect SQLite REPLACE. Reject conflicts
-- explicitly before either immutable table can lose an accepted row.
CREATE TRIGGER publication_model_slug_mapping_replace_guard
BEFORE INSERT ON publication_model_slug_mapping
WHEN EXISTS (
  SELECT 1 FROM publication_model_slug_mapping
  WHERE publication_id = NEW.publication_id AND slug = NEW.slug
)
BEGIN
  SELECT RAISE(ABORT, 'publication Model slug mapping cannot be replaced');
END;

CREATE TRIGGER publication_model_slug_mapping_insert_guard
BEFORE INSERT ON publication_model_slug_mapping
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_model_slug_artifact_proof
    WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, 'publication Model slug mappings are closed by their artifact proof') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_staging_revision AS revision
      ON revision.publication_id = candidate.publication_id
    JOIN publication_resource AS resource
      ON resource.publication_id = candidate.publication_id
     AND resource.resource_type = NEW.target_resource_type
     AND resource.resource_id = NEW.model_id
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal
        WHERE publication_id = candidate.publication_id
      )
      AND resource.content_hash = NEW.target_content_hash
      AND json_extract(resource.resource_json, '$.slug.state') = 'known'
      AND json_type(resource.resource_json, '$.slug.value') = 'text'
      AND (
        NEW.resolution = 'historical'
        OR CAST(json_extract(resource.resource_json, '$.slug.value') AS BLOB)
           = CAST(NEW.slug AS BLOB)
      )
  ) THEN RAISE(ABORT, 'publication Model slug mapping does not match its building Model resource') END;
END;

CREATE TRIGGER publication_model_slug_mapping_immutable_update
BEFORE UPDATE ON publication_model_slug_mapping
BEGIN
  SELECT RAISE(ABORT, 'publication Model slug mapping is immutable');
END;

CREATE TRIGGER publication_model_slug_mapping_immutable_delete
BEFORE DELETE ON publication_model_slug_mapping
BEGIN
  SELECT RAISE(ABORT, 'publication Model slug mapping cannot be deleted');
END;

CREATE TRIGGER publication_model_slug_artifact_proof_replace_guard
BEFORE INSERT ON publication_model_slug_artifact_proof
WHEN EXISTS (
  SELECT 1 FROM publication_model_slug_artifact_proof
  WHERE publication_id = NEW.publication_id
)
BEGIN
  SELECT RAISE(ABORT, 'publication Model slug artifact proof cannot be replaced');
END;

CREATE TRIGGER publication_model_slug_artifact_proof_insert_guard
BEFORE INSERT ON publication_model_slug_artifact_proof
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_staging_revision AS revision
      ON revision.publication_id = candidate.publication_id
     AND revision.revision = NEW.staging_revision
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = 'building'
      AND candidate.closure_hash = NEW.closure_hash
      AND candidate.generated_at_ms = NEW.publication_boundary_ms
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal
        WHERE publication_id = candidate.publication_id
      )
      AND (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = candidate.publication_id
          AND resource.resource_type = 'model'
      ) = NEW.model_count
      AND (
        SELECT count(*) FROM publication_model_slug_mapping AS mapping
        WHERE mapping.publication_id = candidate.publication_id
      ) = NEW.mapping_count
      AND (
        SELECT count(*) FROM publication_model_slug_mapping AS mapping
        WHERE mapping.publication_id = candidate.publication_id
          AND mapping.resolution = 'current'
      ) = NEW.current_mapping_count
      AND (
        SELECT count(*) FROM publication_model_slug_mapping AS mapping
        WHERE mapping.publication_id = candidate.publication_id
          AND mapping.resolution = 'historical'
      ) = NEW.historical_mapping_count
      AND NOT EXISTS (
        SELECT 1 FROM publication_resource AS resource
        WHERE resource.publication_id = candidate.publication_id
          AND resource.resource_type = 'model'
          AND NOT EXISTS (
            SELECT 1 FROM publication_model_slug_mapping AS mapping
            WHERE mapping.publication_id = resource.publication_id
              AND mapping.model_id = resource.resource_id
              AND mapping.resolution = 'current'
              AND mapping.target_content_hash = resource.content_hash
              AND CAST(mapping.slug AS BLOB) = CAST(
                json_extract(resource.resource_json, '$.slug.value') AS BLOB
              )
          )
      )
  ) THEN RAISE(ABORT, 'publication Model slug artifact proof lacks an exact staged projection') END;
END;

CREATE TRIGGER publication_model_slug_artifact_proof_immutable_update
BEFORE UPDATE ON publication_model_slug_artifact_proof
BEGIN
  SELECT RAISE(ABORT, 'publication Model slug artifact proof is immutable');
END;

CREATE TRIGGER publication_model_slug_artifact_proof_immutable_delete
BEFORE DELETE ON publication_model_slug_artifact_proof
BEGIN
  SELECT RAISE(ABORT, 'publication Model slug artifact proof cannot be deleted');
END;

UPDATE serving_schema_metadata
SET schema_version = '1.12.0'
WHERE singleton = 1;
