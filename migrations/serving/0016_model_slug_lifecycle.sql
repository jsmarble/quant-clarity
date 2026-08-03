-- Archive-bound Model-slug closure, readiness, and exact-generation lifecycle.
-- Requirements: DATA-001, PIPE-044, PIPE-050--PIPE-056, BE-002,
-- BE-005--BE-007, BE-011, BE-012, SEC-011, SEC-012, QA-001, QA-006.

PRAGMA defer_foreign_keys = true;

-- This is a hard cutover, not an evidence migration. Only the exact dormant
-- schema 1.12 state can advance; no legacy seal, receipt, or switch authority
-- is copied or fabricated.
SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.12.0'
) <> 1 OR EXISTS (
  SELECT 1 FROM publication WHERE state NOT IN ('building', 'failed')
) OR EXISTS (SELECT 1 FROM publication_head)
  OR EXISTS (SELECT 1 FROM publication_closure_seal)
  OR EXISTS (SELECT 1 FROM publication_readiness_receipt)
  OR EXISTS (SELECT 1 FROM publication_archive_receipt)
  OR EXISTS (SELECT 1 FROM publication_serving_receipt)
  OR EXISTS (SELECT 1 FROM publication_vector_receipt)
  OR EXISTS (SELECT 1 FROM publication_probe_receipt)
  OR EXISTS (SELECT 1 FROM publication_readiness_attestation)
  OR EXISTS (SELECT 1 FROM publication_switch_preflight)
  OR EXISTS (SELECT 1 FROM publication_switch_history)
  OR EXISTS (SELECT 1 FROM publication_model_slug_mapping)
  OR EXISTS (SELECT 1 FROM publication_model_slug_artifact_proof)
THEN json('') END;

-- Reject every missing or unexpected logical schema object before mutation.
-- Only SQLite autoindexes and the ten FTS5 shadow tables are internal.
SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    AND name NOT IN ('_cf_METADATA', 'd1_migrations')
    AND name NOT IN (
      'publication_search_fts_config',
      'publication_search_fts_content',
      'publication_search_fts_data',
      'publication_search_fts_docsize',
      'publication_search_fts_idx',
      'publication_provider_search_fts_config',
      'publication_provider_search_fts_content',
      'publication_provider_search_fts_data',
      'publication_provider_search_fts_docsize',
      'publication_provider_search_fts_idx'
    )
) <> 28 OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      AND name NOT IN ('_cf_METADATA', 'd1_migrations')
      AND name NOT IN (
        'publication_search_fts_config',
        'publication_search_fts_content',
        'publication_search_fts_data',
        'publication_search_fts_docsize',
        'publication_search_fts_idx',
        'publication_provider_search_fts_config',
        'publication_provider_search_fts_content',
        'publication_provider_search_fts_data',
        'publication_provider_search_fts_docsize',
        'publication_provider_search_fts_idx'
      )
    ORDER BY name
  )
) <> 'publication|publication_archive_receipt|publication_closure_seal|publication_dataset_metadata_summary|publication_head|publication_inventory_chunk|publication_model_slug_artifact_proof|publication_model_slug_mapping|publication_model_variant_name_search_document|publication_probe_receipt|publication_provider_attribution|publication_provider_model_id_search_document|publication_provider_search_document|publication_provider_search_fts|publication_provider_slice|publication_provider_slice_metadata|publication_readiness_attestation|publication_readiness_receipt|publication_resource|publication_search_document|publication_search_fts|publication_serving_receipt|publication_staging_revision|publication_switch_history|publication_switch_preflight|publication_vector_inventory|publication_vector_receipt|serving_schema_metadata' THEN json('') END;

SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name IN (
    'publication_search_fts_config',
    'publication_search_fts_content',
    'publication_search_fts_data',
    'publication_search_fts_docsize',
    'publication_search_fts_idx',
    'publication_provider_search_fts_config',
    'publication_provider_search_fts_content',
    'publication_provider_search_fts_data',
    'publication_provider_search_fts_docsize',
    'publication_provider_search_fts_idx'
  )
) <> 10 OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name LIKE 'publication%_fts_%'
      AND name NOT IN ('publication_search_fts', 'publication_provider_search_fts')
    ORDER BY name
  )
) <> 'publication_provider_search_fts_config|publication_provider_search_fts_content|publication_provider_search_fts_data|publication_provider_search_fts_docsize|publication_provider_search_fts_idx|publication_search_fts_config|publication_search_fts_content|publication_search_fts_data|publication_search_fts_docsize|publication_search_fts_idx' THEN json('') END;

SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
) <> 16 OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM sqlite_schema
    WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  )
) <> 'publication_chunk_kind_idx|publication_model_slug_exact_idx|publication_model_variant_name_exact_idx|publication_provider_attribution_provider_idx|publication_provider_model_id_eligibility_idx|publication_provider_model_id_normalized_exact_idx|publication_provider_model_id_raw_exact_idx|publication_provider_model_id_target_eligibility_idx|publication_provider_search_exact_idx|publication_provider_slice_identity_idx|publication_resource_lookup_idx|publication_search_resource_idx|publication_switch_history_from_retained_hot_idx|publication_switch_history_prior_rollback_retained_hot_idx|publication_switch_preflight_generation_idx|publication_vector_resource_idx' THEN json('') END;

SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%'
) <> 103 OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM sqlite_schema
    WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  )
) <> 'publication_activation_timestamp_guard|publication_archive_receipt_immutable_delete|publication_archive_receipt_immutable_update|publication_archive_receipt_insert_guard|publication_closure_seal_immutable_delete|publication_closure_seal_immutable_update|publication_closure_seal_insert_guard|publication_dataset_metadata_summary_immutable_delete|publication_dataset_metadata_summary_immutable_update|publication_dataset_metadata_summary_insert_guard|publication_dataset_metadata_summary_readiness_guard|publication_dataset_metadata_summary_switch_guard|publication_failure_codes_guard|publication_head_closed_delete|publication_head_switch_insert|publication_head_switch_update|publication_headed_state_guard|publication_identity_immutable|publication_immutable_delete|publication_inventory_chunk_immutable_delete|publication_inventory_chunk_immutable_update|publication_inventory_chunk_insert_guard|publication_inventory_chunk_revision|publication_model_slug_artifact_proof_immutable_delete|publication_model_slug_artifact_proof_immutable_update|publication_model_slug_artifact_proof_insert_guard|publication_model_slug_artifact_proof_replace_guard|publication_model_slug_mapping_immutable_delete|publication_model_slug_mapping_immutable_update|publication_model_slug_mapping_insert_guard|publication_model_slug_mapping_replace_guard|publication_model_variant_name_search_document_immutable_delete|publication_model_variant_name_search_document_immutable_update|publication_model_variant_name_search_document_insert_guard|publication_probe_receipt_immutable_delete|publication_probe_receipt_immutable_update|publication_probe_receipt_insert_guard|publication_provider_attribution_immutable_delete|publication_provider_attribution_immutable_update|publication_provider_attribution_insert_guard|publication_provider_attribution_revision|publication_provider_model_id_search_document_immutable_delete|publication_provider_model_id_search_document_immutable_update|publication_provider_model_id_search_document_insert_guard|publication_provider_model_id_search_seal_guard|publication_provider_search_document_immutable_delete|publication_provider_search_document_immutable_update|publication_provider_search_document_insert_guard|publication_provider_search_document_nul_insert_guard|publication_provider_search_fts_insert|publication_provider_slice_building_insert|publication_provider_slice_immutable_delete|publication_provider_slice_immutable_update|publication_provider_slice_lineage_insert|publication_provider_slice_metadata_immutable_delete|publication_provider_slice_metadata_immutable_update|publication_provider_slice_metadata_insert_guard|publication_provider_slice_metadata_revision|publication_provider_slice_post_seal_insert_guard|publication_provider_slice_revision|publication_readiness_attestation_immutable_delete|publication_readiness_attestation_immutable_update|publication_readiness_attestation_insert_guard|publication_readiness_receipt_immutable_delete|publication_readiness_receipt_immutable_update|publication_readiness_receipt_insert_guard|publication_ready_timestamp_guard|publication_resource_building_insert|publication_resource_immutable_delete|publication_resource_immutable_update|publication_resource_post_seal_insert_guard|publication_resource_revision|publication_resource_type_insert|publication_search_building_insert|publication_search_fts_insert|publication_search_immutable_delete|publication_search_immutable_update|publication_search_post_seal_insert_guard|publication_search_revision|publication_search_type_insert|publication_serving_receipt_immutable_delete|publication_serving_receipt_immutable_update|publication_serving_receipt_insert_guard|publication_staging_revision_immutable_delete|publication_staging_revision_immutable_update|publication_staging_revision_seed|publication_state_transition|publication_switch_history_apply|publication_switch_history_immutable_delete|publication_switch_history_immutable_update|publication_switch_history_insert_guard|publication_switch_history_provider_eligibility_index_guard|publication_switch_history_target_eligibility_index_guard|publication_switch_preflight_immutable_delete|publication_switch_preflight_immutable_update|publication_switch_preflight_insert_guard|publication_vector_inventory_immutable_delete|publication_vector_inventory_immutable_update|publication_vector_inventory_insert_guard|publication_vector_inventory_revision|publication_vector_receipt_immutable_delete|publication_vector_receipt_immutable_update|publication_vector_receipt_insert_guard' THEN json('') END;

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type NOT IN ('table', 'index', 'trigger')
    AND name NOT LIKE 'sqlite_%'
) OR EXISTS (
  SELECT 1 FROM sqlite_schema WHERE type = 'view'
) THEN json('') END;


-- FTS5 shadow schemas are part of the virtual-table integrity boundary.
WITH expected(name, expected_sql) AS (
  VALUES
    ('publication_search_fts_config', 'CREATE TABLE ''publication_search_fts_config''(k PRIMARY KEY, v) WITHOUT ROWID'),
    ('publication_search_fts_content', 'CREATE TABLE ''publication_search_fts_content''(id INTEGER PRIMARY KEY, c0, c1, c2, c3, c4, c5, c6)'),
    ('publication_search_fts_data', 'CREATE TABLE ''publication_search_fts_data''(id INTEGER PRIMARY KEY, block BLOB)'),
    ('publication_search_fts_docsize', 'CREATE TABLE ''publication_search_fts_docsize''(id INTEGER PRIMARY KEY, sz BLOB)'),
    ('publication_search_fts_idx', 'CREATE TABLE ''publication_search_fts_idx''(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID'),
    ('publication_provider_search_fts_config', 'CREATE TABLE ''publication_provider_search_fts_config''(k PRIMARY KEY, v) WITHOUT ROWID'),
    ('publication_provider_search_fts_content', 'CREATE TABLE ''publication_provider_search_fts_content''(id INTEGER PRIMARY KEY, c0, c1, c2)'),
    ('publication_provider_search_fts_data', 'CREATE TABLE ''publication_provider_search_fts_data''(id INTEGER PRIMARY KEY, block BLOB)'),
    ('publication_provider_search_fts_docsize', 'CREATE TABLE ''publication_provider_search_fts_docsize''(id INTEGER PRIMARY KEY, sz BLOB)'),
    ('publication_provider_search_fts_idx', 'CREATE TABLE ''publication_provider_search_fts_idx''(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID')
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM expected
  LEFT JOIN sqlite_schema AS object
    ON object.type = 'table' AND object.name = expected.name
  WHERE object.sql IS NULL OR object.sql <> expected.expected_sql
) THEN json('') END;

-- Wrangler may manage this exact control table outside application migrations.
SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name = 'd1_migrations'
) > 1 OR EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'table' AND name = 'd1_migrations'
    AND (sql IS NULL OR sql NOT IN (
      'CREATE TABLE "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)',
      'CREATE TABLE "d1_migrations" (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
	)'
    ))
) OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name = '_cf_METADATA'
) > 1 OR EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'table' AND name = '_cf_METADATA'
    AND (sql IS NULL OR sql <> 'CREATE TABLE _cf_METADATA (
        key INTEGER PRIMARY KEY,
        value BLOB
      )')
) THEN json('') END;


-- The schema marker is not authority. Before the first mutation, re-establish
-- the exact retained closure foundation that the v5 guards will continue to
-- trust. The table SQL lengths close the declared CHECK/FK DDL while the
-- independent PRAGMA checks close column order, affinity, keys, and FK action.
WITH expected(name, sql_length, column_count, foreign_key_count) AS (
  VALUES
    ('publication', 2650, 23, 1),
    ('publication_resource', 682, 5, 1),
    ('publication_staging_revision', 221, 2, 1),
    ('publication_closure_seal', 3272, 23, 1),
    ('publication_head', 591, 5, 2),
    ('publication_provider_slice', 3002, 6, 1),
    ('publication_provider_slice_metadata', 686, 5, 2),
    ('publication_provider_attribution', 615, 4, 5),
    ('publication_search_document', 1212, 10, 4),
    ('publication_vector_inventory', 1204, 7, 5),
    ('publication_inventory_chunk', 821, 7, 1),
    ('publication_provider_search_document', 1091, 6, 3),
    ('publication_model_variant_name_search_document', 2721, 7, 4),
    ('publication_provider_model_id_search_document', 4799, 11, 9),
    ('publication_dataset_metadata_summary', 1629, 12, 1)
)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM expected
  LEFT JOIN sqlite_schema AS object
    ON object.type = 'table' AND object.name = expected.name
  WHERE object.name IS NULL
    OR (
      length(object.sql) <> expected.sql_length
      AND NOT (
        expected.name = 'publication_provider_search_document'
        AND length(object.sql) = 976
      )
      AND NOT (
        expected.name = 'publication_model_variant_name_search_document'
        AND length(object.sql) = 2582
      )
    )
) THEN json('') END;

SELECT CASE WHEN (
  SELECT group_concat(
    name || ':' || type || ':' || "notnull" || ':' ||
    COALESCE(dflt_value, '-') || ':' || pk,
    '|'
  ) FROM (
    SELECT * FROM pragma_table_info('publication') ORDER BY cid
  )
) <> 'publication_id:TEXT:0:-:1|state:TEXT:1:-:0|schema_version:TEXT:1:-:0|methodology_version:TEXT:1:-:0|precision_normalization_version:TEXT:1:-:0|precision_display_order_version:TEXT:1:-:0|price_policy_version:TEXT:1:-:0|source_policy_version:TEXT:1:-:0|embedding_version:TEXT:1:-:0|build_commit:TEXT:1:-:0|source_run_id:TEXT:1:-:0|parent_publication_id:TEXT:0:-:0|generated_at_ms:INTEGER:1:-:0|ready_at_ms:INTEGER:0:-:0|activated_at_ms:INTEGER:0:-:0|resource_count:INTEGER:1:-:0|exact_document_count:INTEGER:1:-:0|vector_document_count:INTEGER:1:-:0|exact_index_hash:TEXT:1:-:0|vector_index_version:TEXT:1:-:0|closure_hash:TEXT:1:-:0|failure_codes_json:TEXT:1:-:0|created_at_ms:INTEGER:1:-:0' OR (
  SELECT group_concat(
    name || ':' || type || ':' || "notnull" || ':' ||
    COALESCE(dflt_value, '-') || ':' || pk,
    '|'
  ) FROM (
    SELECT * FROM pragma_table_info('publication_resource') ORDER BY cid
  )
) <> 'publication_id:TEXT:1:-:1|resource_type:TEXT:1:-:2|resource_id:TEXT:1:-:3|resource_json:TEXT:1:-:0|content_hash:TEXT:1:-:0' OR (
  SELECT group_concat(
    name || ':' || type || ':' || "notnull" || ':' ||
    COALESCE(dflt_value, '-') || ':' || pk,
    '|'
  ) FROM (
    SELECT * FROM pragma_table_info('publication_staging_revision') ORDER BY cid
  )
) <> 'publication_id:TEXT:0:-:1|revision:INTEGER:1:-:0' OR (
  SELECT group_concat(
    name || ':' || type || ':' || "notnull" || ':' ||
    COALESCE(dflt_value, '-') || ':' || pk,
    '|'
  ) FROM (
    SELECT * FROM pragma_table_info('publication_closure_seal') ORDER BY cid
  )
) <> 'publication_id:TEXT:0:-:1|staging_revision:INTEGER:1:-:0|manifest_contract_version:TEXT:1:-:0|hash_domain:TEXT:1:-:0|hash_encoding_version:TEXT:1:-:0|enabled_provider_scope_version:TEXT:1:-:0|enabled_provider_count:INTEGER:1:-:0|provider_slice_count:INTEGER:1:-:0|provider_attribution_count:INTEGER:1:-:0|resource_count:INTEGER:1:-:0|exact_document_count:INTEGER:1:-:0|vector_document_count:INTEGER:1:-:0|chunk_count:INTEGER:1:-:0|bundle_hash:TEXT:1:-:0|enabled_provider_scope_hash:TEXT:1:-:0|provider_slice_hash:TEXT:1:-:0|provider_attribution_hash:TEXT:1:-:0|resource_inventory_hash:TEXT:1:-:0|exact_search_inventory_hash:TEXT:1:-:0|vector_inventory_hash:TEXT:1:-:0|chunk_root_hash:TEXT:1:-:0|closure_hash:TEXT:1:-:0|sealed_at_ms:INTEGER:1:-:0' OR NOT EXISTS (
  SELECT 1 FROM pragma_foreign_key_list('publication')
  WHERE "table" = 'publication' AND "from" = 'parent_publication_id'
    AND "to" = 'publication_id' AND "on_update" = 'NO ACTION'
    AND "on_delete" = 'RESTRICT' AND "match" = 'NONE'
) OR NOT EXISTS (
  SELECT 1 FROM pragma_foreign_key_list('publication_resource')
  WHERE "table" = 'publication' AND "from" = 'publication_id'
    AND "to" = 'publication_id' AND "on_update" = 'NO ACTION'
    AND "on_delete" = 'RESTRICT' AND "match" = 'NONE'
) OR NOT EXISTS (
  SELECT 1 FROM pragma_foreign_key_list('publication_staging_revision')
  WHERE "table" = 'publication' AND "from" = 'publication_id'
    AND "to" = 'publication_id' AND "on_update" = 'NO ACTION'
    AND "on_delete" = 'RESTRICT' AND "match" = 'NONE'
) OR NOT EXISTS (
  SELECT 1 FROM pragma_foreign_key_list('publication_closure_seal')
  WHERE "table" = 'publication' AND "from" = 'publication_id'
    AND "to" = 'publication_id' AND "on_update" = 'NO ACTION'
    AND "on_delete" = 'RESTRICT' AND "match" = 'NONE'
) THEN json('') END;

-- Exact canonical definitions close same-length semantic substitutions for
-- the retained resource and revision authority. Whitespace and keyword case
-- are ignored, but every token, literal, predicate, target, and action is not.
WITH expected(name, canonical_sql) AS (
  VALUES
    (
      'publication_resource',
      'CREATETABLEpublication_resource(publication_idTEXTNOTNULLREFERENCESpublication(publication_id)ONDELETERESTRICT,resource_typeTEXTNOTNULLCHECK(resource_typeIN(''model_family'',''model'',''variant'',''provider'',''offering'',''price'',''precision_observation'',''evidence_summary'')),resource_idTEXTNOTNULLCHECK(length(resource_id)=40),resource_jsonTEXTNOTNULLCHECK(json_valid(resource_json)ANDjson_type(resource_json)=''object''),content_hashTEXTNOTNULLCHECK(length(content_hash)=71ANDsubstr(content_hash,1,7)=''sha256:''ANDsubstr(content_hash,8)NOTGLOB''*[^0-9a-f]*''),PRIMARYKEY(publication_id,resource_type,resource_id))'
    ),
    (
      'publication_staging_revision',
      'CREATETABLEpublication_staging_revision(publication_idTEXTPRIMARYKEYREFERENCESpublication(publication_id)ONDELETERESTRICT,revisionINTEGERNOTNULLCHECK(typeof(revision)=''integer''ANDrevision>=0))'
    ),
    (
      'publication_resource_type_insert',
      'CREATETRIGGERpublication_resource_type_insertBEFOREINSERTONpublication_resourceBEGINSELECTCASEWHENNOT((NEW.resource_type=''model_family''ANDsubstr(NEW.resource_id,1,4)=''fam_'')OR(NEW.resource_type=''model''ANDsubstr(NEW.resource_id,1,4)=''mdl_'')OR(NEW.resource_type=''variant''ANDsubstr(NEW.resource_id,1,4)=''var_'')OR(NEW.resource_type=''provider''ANDsubstr(NEW.resource_id,1,4)=''prv_'')OR(NEW.resource_type=''offering''ANDsubstr(NEW.resource_id,1,4)=''off_'')OR(NEW.resource_type=''price''ANDsubstr(NEW.resource_id,1,4)=''pcs_'')OR(NEW.resource_type=''precision_observation''ANDsubstr(NEW.resource_id,1,4)=''prc_'')OR(NEW.resource_type=''evidence_summary''ANDsubstr(NEW.resource_id,1,4)=''evd_''))THENRAISE(ABORT,''publicationresourcetypeandIDprefixdisagree'')END;END'
    ),
    (
      'publication_resource_immutable_update',
      'CREATETRIGGERpublication_resource_immutable_updateBEFOREUPDATEONpublication_resourceBEGINSELECTRAISE(ABORT,''publicationresourceisimmutable'');END'
    ),
    (
      'publication_resource_immutable_delete',
      'CREATETRIGGERpublication_resource_immutable_deleteBEFOREDELETEONpublication_resourceBEGINSELECTRAISE(ABORT,''publicationresourcecannotbedeleted'');END'
    ),
    (
      'publication_resource_building_insert',
      'CREATETRIGGERpublication_resource_building_insertBEFOREINSERTONpublication_resourceBEGINSELECTCASEWHENNOTEXISTS(SELECT1FROMpublicationWHEREpublication_id=NEW.publication_idANDstate=''building'')THENRAISE(ABORT,''publicationresourcesmaybestagedonlywhilebuilding'')END;END'
    ),
    (
      'publication_resource_post_seal_insert_guard',
      'CREATETRIGGERpublication_resource_post_seal_insert_guardBEFOREINSERTONpublication_resourceWHENEXISTS(SELECT1FROMpublication_closure_sealWHEREpublication_id=NEW.publication_id)BEGINSELECTRAISE(ABORT,''sealedpublicationclosureisimmutable'');END'
    ),
    (
      'publication_resource_revision',
      'CREATETRIGGERpublication_resource_revisionAFTERINSERTONpublication_resourceBEGINUPDATEpublication_staging_revisionSETrevision=revision+1WHEREpublication_id=NEW.publication_id;END'
    ),
    (
      'publication_staging_revision_seed',
      'CREATETRIGGERpublication_staging_revision_seedAFTERINSERTONpublicationBEGININSERTINTOpublication_staging_revision(publication_id,revision)VALUES(NEW.publication_id,0);END'
    ),
    (
      'publication_staging_revision_immutable_update',
      'CREATETRIGGERpublication_staging_revision_immutable_updateBEFOREUPDATEONpublication_staging_revisionWHENNEW.publication_id<>OLD.publication_idORNEW.revision<>OLD.revision+1ORNOTEXISTS(SELECT1FROMpublicationWHEREpublication_id=OLD.publication_idANDstate=''building'')OREXISTS(SELECT1FROMpublication_closure_sealWHEREpublication_id=OLD.publication_id)BEGINSELECTRAISE(ABORT,''publicationstagingrevisionistrigger-managed'');END'
    ),
    (
      'publication_staging_revision_immutable_delete',
      'CREATETRIGGERpublication_staging_revision_immutable_deleteBEFOREDELETEONpublication_staging_revisionBEGINSELECTRAISE(ABORT,''publicationstagingrevisioncannotbedeleted'');END'
    ),
    (
      'publication_closure_seal_immutable_update',
      'CREATETRIGGERpublication_closure_seal_immutable_updateBEFOREUPDATEONpublication_closure_sealBEGINSELECTRAISE(ABORT,''publicationclosuresealisimmutable'');END'
    ),
    (
      'publication_closure_seal_immutable_delete',
      'CREATETRIGGERpublication_closure_seal_immutable_deleteBEFOREDELETEONpublication_closure_sealBEGINSELECTRAISE(ABORT,''publicationclosuresealcannotbedeleted'');END'
    )
)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM expected
  LEFT JOIN sqlite_schema AS object ON object.name = expected.name
  WHERE object.sql IS NULL OR replace(replace(replace(replace(
    object.sql, ' ', ''
  ), char(10), ''), char(13), ''), char(9), '') <> expected.canonical_sql
) THEN json('') END;

-- Retained mutation guards are checked by target table and canonical SQL
-- length, then the security-critical resource/revision semantics are checked
-- independently. This rejects a same-named no-op trigger before any DDL.
WITH expected(name, table_name, sql_length) AS (
  VALUES
    ('publication_resource_type_insert', 'publication_resource', 878),
    ('publication_resource_immutable_update', 'publication_resource', 158),
    ('publication_resource_immutable_delete', 'publication_resource', 163),
    ('publication_resource_building_insert', 'publication_resource', 312),
    ('publication_resource_post_seal_insert_guard', 'publication_resource', 265),
    ('publication_resource_revision', 'publication_resource', 198),
    ('publication_staging_revision_seed', 'publication', 189),
    ('publication_staging_revision_immutable_update', 'publication_staging_revision', 492),
    ('publication_staging_revision_immutable_delete', 'publication_staging_revision', 187),
    ('publication_closure_seal_insert_guard', 'publication_closure_seal', 5407),
    ('publication_closure_seal_immutable_update', 'publication_closure_seal', 170),
    ('publication_closure_seal_immutable_delete', 'publication_closure_seal', 175),
    ('publication_provider_slice_metadata_insert_guard', 'publication_provider_slice_metadata', 448),
    ('publication_provider_attribution_insert_guard', 'publication_provider_attribution', 624),
    ('publication_vector_inventory_insert_guard', 'publication_vector_inventory', 820),
    ('publication_inventory_chunk_insert_guard', 'publication_inventory_chunk', 432),
    ('publication_provider_slice_revision', 'publication_provider_slice', 210),
    ('publication_search_revision', 'publication_search_document', 203),
    ('publication_provider_slice_metadata_revision', 'publication_provider_slice_metadata', 228),
    ('publication_provider_attribution_revision', 'publication_provider_attribution', 222),
    ('publication_vector_inventory_revision', 'publication_vector_inventory', 214),
    ('publication_inventory_chunk_revision', 'publication_inventory_chunk', 212),
    ('publication_provider_model_id_search_document_insert_guard', 'publication_provider_model_id_search_document', 9910),
    ('publication_provider_model_id_search_document_immutable_update', 'publication_provider_model_id_search_document', 221),
    ('publication_provider_model_id_search_document_immutable_delete', 'publication_provider_model_id_search_document', 226),
    ('publication_dataset_metadata_summary_insert_guard', 'publication_dataset_metadata_summary', 4163),
    ('publication_dataset_metadata_summary_immutable_update', 'publication_dataset_metadata_summary', 194),
    ('publication_dataset_metadata_summary_immutable_delete', 'publication_dataset_metadata_summary', 199)
)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM expected
  LEFT JOIN sqlite_schema AS object
    ON object.type = 'trigger' AND object.name = expected.name
  WHERE object.name IS NULL
    OR object.tbl_name <> expected.table_name
    OR length(object.sql) <> expected.sql_length
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_type_insert'
    AND instr(sql, 'publication resource type and ID prefix disagree') > 0
    AND instr(sql, 'NEW.resource_type = ''model''') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_immutable_update'
    AND instr(
      sql,
      'RAISE(ABORT, ''publication resource is immutable'')'
    ) > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_immutable_delete'
    AND instr(
      sql,
      'RAISE(ABORT, ''publication resource cannot be deleted'')'
    ) > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_building_insert'
    AND instr(sql, 'state = ''building''') > 0
    AND instr(sql, 'publication resources may be staged only while building') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_resource_revision'
    AND instr(sql, 'revision = revision + 1') > 0
    AND instr(sql, 'publication_id = NEW.publication_id') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_staging_revision_immutable_update'
    AND instr(sql, 'NEW.revision <> OLD.revision + 1') > 0
    AND instr(sql, 'state = ''building''') > 0
    AND instr(sql, 'publication_closure_seal') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger' AND name = 'publication_closure_seal_insert_guard'
    AND instr(sql, 'publication staging revision changed before seal') > 0
    AND instr(sql, 'provider scope or metadata does not close') > 0
    AND instr(sql, 'resource search and vector inventories do not close') > 0
    AND instr(sql, 'inventory chunks do not close') > 0
) OR NOT EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE type = 'trigger'
    AND name = 'publication_provider_slice_metadata_insert_guard'
    AND instr(sql, 'closure rows may be staged only while building and unsealed') > 0
    AND instr(sql, 'NEW.publication_id') > 0
) THEN json('') END;

-- Raw SQL identity is intentional: schema 1.12 is produced only by the
-- lockfile-pinned migration chain, so formatting drift is also corruption.
WITH expected(name, expected_sql) AS (
  VALUES
    ('publication', 'CREATE TABLE publication (
  publication_id TEXT PRIMARY KEY CHECK (length(publication_id) = 40 AND substr(publication_id, 1, 4) = ''pub_'' AND publication_id = lower(publication_id)),
  state TEXT NOT NULL CHECK (state IN (''building'', ''ready'', ''active'', ''superseded'', ''rolled_back'', ''failed'')),
  schema_version TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  precision_normalization_version TEXT NOT NULL,
  precision_display_order_version TEXT NOT NULL,
  price_policy_version TEXT NOT NULL,
  source_policy_version TEXT NOT NULL,
  embedding_version TEXT NOT NULL,
  build_commit TEXT NOT NULL CHECK (build_commit <> ''''),
  source_run_id TEXT NOT NULL CHECK (length(source_run_id) = 40 AND substr(source_run_id, 1, 4) = ''run_''),
  parent_publication_id TEXT REFERENCES publication(publication_id) ON DELETE RESTRICT,
  generated_at_ms INTEGER NOT NULL CHECK (typeof(generated_at_ms) = ''integer'' AND generated_at_ms >= 0),
  ready_at_ms INTEGER CHECK (ready_at_ms IS NULL OR (typeof(ready_at_ms) = ''integer'' AND ready_at_ms >= generated_at_ms)),
  activated_at_ms INTEGER CHECK (activated_at_ms IS NULL OR (typeof(activated_at_ms) = ''integer'' AND activated_at_ms >= COALESCE(ready_at_ms, generated_at_ms))),
  resource_count INTEGER NOT NULL CHECK (typeof(resource_count) = ''integer'' AND resource_count >= 0),
  exact_document_count INTEGER NOT NULL CHECK (typeof(exact_document_count) = ''integer'' AND exact_document_count >= 0),
  vector_document_count INTEGER NOT NULL CHECK (typeof(vector_document_count) = ''integer'' AND vector_document_count >= 0),
  exact_index_hash TEXT NOT NULL CHECK (length(exact_index_hash) = 71 AND substr(exact_index_hash, 1, 7) = ''sha256:'' AND substr(exact_index_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  vector_index_version TEXT NOT NULL,
  closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = ''sha256:'' AND substr(closure_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  failure_codes_json TEXT NOT NULL CHECK (json_valid(failure_codes_json) AND json_type(failure_codes_json) = ''array''),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = ''integer'' AND created_at_ms >= 0),
  CHECK (parent_publication_id IS NULL OR parent_publication_id <> publication_id),
  CHECK (
    (state IN (''building'', ''failed'') AND ready_at_ms IS NULL AND activated_at_ms IS NULL) OR
    (state = ''ready'' AND ready_at_ms IS NOT NULL AND activated_at_ms IS NULL) OR
    (state IN (''active'', ''superseded'', ''rolled_back'') AND ready_at_ms IS NOT NULL AND activated_at_ms IS NOT NULL)
  ),
  CHECK ((state = ''failed'' AND failure_codes_json <> ''[]'') OR (state <> ''failed'' AND failure_codes_json = ''[]''))
)'),
    ('publication_resource', 'CREATE TABLE publication_resource (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL CHECK (resource_type IN (''model_family'', ''model'', ''variant'', ''provider'', ''offering'', ''price'', ''precision_observation'', ''evidence_summary'')),
  resource_id TEXT NOT NULL CHECK (length(resource_id) = 40),
  resource_json TEXT NOT NULL CHECK (json_valid(resource_json) AND json_type(resource_json) = ''object''),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = ''sha256:'' AND substr(content_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  PRIMARY KEY (publication_id, resource_type, resource_id)
)'),
    ('publication_staging_revision', 'CREATE TABLE publication_staging_revision (
  publication_id TEXT PRIMARY KEY REFERENCES publication(publication_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (typeof(revision) = ''integer'' AND revision >= 0)
)'),
    ('publication_closure_seal', 'CREATE TABLE publication_closure_seal (
  publication_id TEXT PRIMARY KEY REFERENCES publication(publication_id) ON DELETE RESTRICT,
  staging_revision INTEGER NOT NULL CHECK (typeof(staging_revision) = ''integer'' AND staging_revision >= 0),
  manifest_contract_version TEXT NOT NULL CHECK (manifest_contract_version = ''1.0.0''),
  hash_domain TEXT NOT NULL CHECK (hash_domain = ''publication-closure''),
  hash_encoding_version TEXT NOT NULL CHECK (hash_encoding_version = ''1''),
  enabled_provider_scope_version TEXT NOT NULL CHECK (length(enabled_provider_scope_version) BETWEEN 1 AND 128 AND enabled_provider_scope_version NOT GLOB ''*[^ -~]*''),
  enabled_provider_count INTEGER NOT NULL CHECK (typeof(enabled_provider_count) = ''integer'' AND enabled_provider_count >= 1),
  provider_slice_count INTEGER NOT NULL CHECK (typeof(provider_slice_count) = ''integer'' AND provider_slice_count >= 1),
  provider_attribution_count INTEGER NOT NULL CHECK (typeof(provider_attribution_count) = ''integer'' AND provider_attribution_count >= 0),
  resource_count INTEGER NOT NULL CHECK (typeof(resource_count) = ''integer'' AND resource_count >= 1),
  exact_document_count INTEGER NOT NULL CHECK (typeof(exact_document_count) = ''integer'' AND exact_document_count >= 0),
  vector_document_count INTEGER NOT NULL CHECK (typeof(vector_document_count) = ''integer'' AND vector_document_count >= 0),
  chunk_count INTEGER NOT NULL CHECK (typeof(chunk_count) = ''integer'' AND chunk_count >= 1),
  bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 71 AND substr(bundle_hash, 1, 7) = ''sha256:'' AND substr(bundle_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  enabled_provider_scope_hash TEXT NOT NULL CHECK (length(enabled_provider_scope_hash) = 71 AND substr(enabled_provider_scope_hash, 1, 7) = ''sha256:'' AND substr(enabled_provider_scope_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  provider_slice_hash TEXT NOT NULL CHECK (length(provider_slice_hash) = 71 AND substr(provider_slice_hash, 1, 7) = ''sha256:'' AND substr(provider_slice_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  provider_attribution_hash TEXT NOT NULL CHECK (length(provider_attribution_hash) = 71 AND substr(provider_attribution_hash, 1, 7) = ''sha256:'' AND substr(provider_attribution_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  resource_inventory_hash TEXT NOT NULL CHECK (length(resource_inventory_hash) = 71 AND substr(resource_inventory_hash, 1, 7) = ''sha256:'' AND substr(resource_inventory_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  exact_search_inventory_hash TEXT NOT NULL CHECK (length(exact_search_inventory_hash) = 71 AND substr(exact_search_inventory_hash, 1, 7) = ''sha256:'' AND substr(exact_search_inventory_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  vector_inventory_hash TEXT NOT NULL CHECK (length(vector_inventory_hash) = 71 AND substr(vector_inventory_hash, 1, 7) = ''sha256:'' AND substr(vector_inventory_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  chunk_root_hash TEXT NOT NULL CHECK (length(chunk_root_hash) = 71 AND substr(chunk_root_hash, 1, 7) = ''sha256:'' AND substr(chunk_root_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = ''sha256:'' AND substr(closure_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  sealed_at_ms INTEGER NOT NULL CHECK (typeof(sealed_at_ms) = ''integer'' AND sealed_at_ms >= 0)
)'),
    ('publication_head', 'CREATE TABLE publication_head (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active_publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  rollback_candidate_publication_id TEXT REFERENCES publication(publication_id) ON DELETE RESTRICT,
  switched_at_ms INTEGER NOT NULL CHECK (typeof(switched_at_ms) = ''integer'' AND switched_at_ms >= 0),
  generation INTEGER NOT NULL CHECK (typeof(generation) = ''integer'' AND generation >= 1),
  CHECK (rollback_candidate_publication_id IS NULL OR rollback_candidate_publication_id <> active_publication_id)
)'),
    ('publication_provider_slice', 'CREATE TABLE "publication_provider_slice" (
  provider_slice_id TEXT CHECK (
    provider_slice_id IS NULL OR (
      length(provider_slice_id) = 40 AND
      substr(provider_slice_id, 1, 4) = ''prn_'' AND
      provider_slice_id = lower(provider_slice_id) AND
      substr(provider_slice_id, 13, 1) = ''-'' AND
      substr(provider_slice_id, 18, 1) = ''-'' AND
      substr(provider_slice_id, 19, 1) = ''4'' AND
      substr(provider_slice_id, 23, 1) = ''-'' AND
      substr(provider_slice_id, 24, 1) IN (''8'', ''9'', ''a'', ''b'') AND
      substr(provider_slice_id, 28, 1) = ''-'' AND
      substr(provider_slice_id, 5, 8) NOT GLOB ''*[^0-9a-f]*'' AND
      substr(provider_slice_id, 14, 4) NOT GLOB ''*[^0-9a-f]*'' AND
      substr(provider_slice_id, 19, 4) NOT GLOB ''*[^0-9a-f]*'' AND
      substr(provider_slice_id, 24, 4) NOT GLOB ''*[^0-9a-f]*'' AND
      substr(provider_slice_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
    )
  ),
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL CHECK (
    length(provider_id) = 40 AND
    substr(provider_id, 1, 4) = ''prv_'' AND
    provider_id = lower(provider_id) AND
    substr(provider_id, 13, 1) = ''-'' AND
    substr(provider_id, 18, 1) = ''-'' AND
    substr(provider_id, 19, 1) = ''4'' AND
    substr(provider_id, 23, 1) = ''-'' AND
    substr(provider_id, 24, 1) IN (''8'', ''9'', ''a'', ''b'') AND
    substr(provider_id, 28, 1) = ''-'' AND
    substr(provider_id, 5, 8) NOT GLOB ''*[^0-9a-f]*'' AND
    substr(provider_id, 14, 4) NOT GLOB ''*[^0-9a-f]*'' AND
    substr(provider_id, 19, 4) NOT GLOB ''*[^0-9a-f]*'' AND
    substr(provider_id, 24, 4) NOT GLOB ''*[^0-9a-f]*'' AND
    substr(provider_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  provider_run_id TEXT NOT NULL CHECK (
    length(provider_run_id) = 40 AND
    substr(provider_run_id, 1, 4) = ''pvr_'' AND
    provider_run_id = lower(provider_run_id) AND
    substr(provider_run_id, 13, 1) = ''-'' AND
    substr(provider_run_id, 18, 1) = ''-'' AND
    substr(provider_run_id, 19, 1) = ''4'' AND
    substr(provider_run_id, 23, 1) = ''-'' AND
    substr(provider_run_id, 24, 1) IN (''8'', ''9'', ''a'', ''b'') AND
    substr(provider_run_id, 28, 1) = ''-'' AND
    substr(provider_run_id, 5, 8) NOT GLOB ''*[^0-9a-f]*'' AND
    substr(provider_run_id, 14, 4) NOT GLOB ''*[^0-9a-f]*'' AND
    substr(provider_run_id, 19, 4) NOT GLOB ''*[^0-9a-f]*'' AND
    substr(provider_run_id, 24, 4) NOT GLOB ''*[^0-9a-f]*'' AND
    substr(provider_run_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  carried_forward INTEGER NOT NULL CHECK (carried_forward IN (0, 1)),
  freshness_state TEXT NOT NULL CHECK (freshness_state IN (''fresh'', ''stale'', ''unavailable'')),
  PRIMARY KEY (publication_id, provider_id),
  UNIQUE (publication_id, provider_slice_id),
  CHECK (
    (freshness_state = ''unavailable'' AND provider_slice_id IS NULL AND carried_forward = 0) OR
    (freshness_state = ''fresh'' AND provider_slice_id IS NOT NULL) OR
    (freshness_state = ''stale'' AND provider_slice_id IS NOT NULL AND carried_forward = 1)
  )
)'),
    ('publication_provider_slice_metadata', 'CREATE TABLE publication_provider_slice_metadata (
  publication_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  adapter_version TEXT NOT NULL CHECK (length(adapter_version) BETWEEN 1 AND 128 AND adapter_version NOT GLOB ''*[^ -~]*''),
  roster_version TEXT NOT NULL CHECK (length(roster_version) BETWEEN 1 AND 128 AND roster_version NOT GLOB ''*[^ -~]*''),
  source_register_version TEXT NOT NULL CHECK (length(source_register_version) BETWEEN 1 AND 128 AND source_register_version NOT GLOB ''*[^ -~]*''),
  PRIMARY KEY (publication_id, provider_id),
  FOREIGN KEY (publication_id, provider_id)
    REFERENCES publication_provider_slice(publication_id, provider_id)
    ON DELETE RESTRICT
)'),
    ('publication_provider_attribution', 'CREATE TABLE publication_provider_attribution (
  publication_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN (''provider'', ''offering'', ''price'', ''precision_observation'')),
  resource_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  PRIMARY KEY (publication_id, resource_type, resource_id),
  FOREIGN KEY (publication_id, resource_type, resource_id)
    REFERENCES publication_resource(publication_id, resource_type, resource_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (publication_id, provider_id)
    REFERENCES publication_provider_slice(publication_id, provider_id)
    ON DELETE RESTRICT
)'),
    ('publication_search_document', 'CREATE TABLE publication_search_document (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  document_id TEXT NOT NULL CHECK (length(document_id) = 64 AND document_id = lower(document_id) AND document_id NOT GLOB ''*[^0-9a-f]*''),
  resource_type TEXT NOT NULL CHECK (resource_type IN (''model'', ''variant'')),
  resource_id TEXT NOT NULL CHECK (length(resource_id) = 40),
  normalized_name TEXT NOT NULL CHECK (normalized_name <> ''''),
  aliases_json TEXT NOT NULL CHECK (json_valid(aliases_json) AND json_type(aliases_json) = ''array''),
  publisher_name TEXT NOT NULL,
  provider_model_ids_json TEXT NOT NULL CHECK (json_valid(provider_model_ids_json) AND json_type(provider_model_ids_json) = ''array''),
  document_text TEXT NOT NULL CHECK (document_text <> ''''),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = ''sha256:'' AND substr(content_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  PRIMARY KEY (publication_id, document_id),
  UNIQUE (publication_id, resource_type, resource_id),
  FOREIGN KEY (publication_id, resource_type, resource_id) REFERENCES publication_resource(publication_id, resource_type, resource_id) ON DELETE RESTRICT
)'),
    ('publication_vector_inventory', 'CREATE TABLE publication_vector_inventory (
  publication_id TEXT NOT NULL,
  vector_namespace TEXT NOT NULL CHECK (vector_namespace = publication_id),
  vector_id TEXT NOT NULL CHECK (length(vector_id) = 64 AND vector_id = lower(vector_id) AND vector_id NOT GLOB ''*[^0-9a-f]*''),
  resource_type TEXT NOT NULL CHECK (resource_type IN (''model'', ''variant'')),
  resource_id TEXT NOT NULL,
  search_document_content_hash TEXT NOT NULL CHECK (length(search_document_content_hash) = 71 AND substr(search_document_content_hash, 1, 7) = ''sha256:'' AND substr(search_document_content_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  embedding_input_hash TEXT NOT NULL CHECK (length(embedding_input_hash) = 71 AND substr(embedding_input_hash, 1, 7) = ''sha256:'' AND substr(embedding_input_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  PRIMARY KEY (publication_id, vector_id),
  UNIQUE (publication_id, resource_type, resource_id),
  FOREIGN KEY (publication_id, vector_id)
    REFERENCES publication_search_document(publication_id, document_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (publication_id, resource_type, resource_id)
    REFERENCES publication_search_document(publication_id, resource_type, resource_id)
    ON DELETE RESTRICT
)'),
    ('publication_inventory_chunk', 'CREATE TABLE publication_inventory_chunk (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN (''resources'', ''exact_search'', ''vectors'')),
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = ''integer'' AND ordinal >= 0),
  first_key TEXT NOT NULL CHECK (length(first_key) BETWEEN 1 AND 512 AND first_key NOT GLOB ''*[^ -~]*''),
  last_key TEXT NOT NULL CHECK (length(last_key) BETWEEN 1 AND 512 AND last_key NOT GLOB ''*[^ -~]*'' AND first_key <= last_key),
  item_count INTEGER NOT NULL CHECK (typeof(item_count) = ''integer'' AND item_count >= 1),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = ''sha256:'' AND substr(content_hash, 8) NOT GLOB ''*[^0-9a-f]*''),
  PRIMARY KEY (publication_id, kind, ordinal)
)'),
    ('publication_provider_model_id_search_document', 'CREATE TABLE publication_provider_model_id_search_document (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT CHECK (
    length(publication_id) = 40
    AND substr(publication_id, 1, 4) = ''pub_''
    AND publication_id = lower(publication_id)
    AND substr(publication_id, 5, 8) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 13, 1) = ''-''
    AND substr(publication_id, 14, 4) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 18, 1) = ''-''
    AND substr(publication_id, 19, 1) = ''4''
    AND substr(publication_id, 20, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 23, 1) = ''-''
    AND substr(publication_id, 24, 1) GLOB ''[89ab]''
    AND substr(publication_id, 25, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 28, 1) = ''-''
    AND substr(publication_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  offering_resource_type TEXT NOT NULL DEFAULT ''offering'' CHECK (offering_resource_type = ''offering''),
  offering_id TEXT NOT NULL CHECK (
    length(offering_id) = 40
    AND substr(offering_id, 1, 4) = ''off_''
    AND offering_id = lower(offering_id)
    AND substr(offering_id, 5, 8) NOT GLOB ''*[^0-9a-f]*''
    AND substr(offering_id, 13, 1) = ''-''
    AND substr(offering_id, 14, 4) NOT GLOB ''*[^0-9a-f]*''
    AND substr(offering_id, 18, 1) = ''-''
    AND substr(offering_id, 19, 1) = ''4''
    AND substr(offering_id, 20, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(offering_id, 23, 1) = ''-''
    AND substr(offering_id, 24, 1) GLOB ''[89ab]''
    AND substr(offering_id, 25, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(offering_id, 28, 1) = ''-''
    AND substr(offering_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  provider_id TEXT NOT NULL CHECK (
    length(provider_id) = 40
    AND substr(provider_id, 1, 4) = ''prv_''
    AND provider_id = lower(provider_id)
    AND substr(provider_id, 5, 8) NOT GLOB ''*[^0-9a-f]*''
    AND substr(provider_id, 13, 1) = ''-''
    AND substr(provider_id, 14, 4) NOT GLOB ''*[^0-9a-f]*''
    AND substr(provider_id, 18, 1) = ''-''
    AND substr(provider_id, 19, 1) = ''4''
    AND substr(provider_id, 20, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(provider_id, 23, 1) = ''-''
    AND substr(provider_id, 24, 1) GLOB ''[89ab]''
    AND substr(provider_id, 25, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(provider_id, 28, 1) = ''-''
    AND substr(provider_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  target_resource_type TEXT NOT NULL CHECK (target_resource_type IN (''model'', ''variant'')),
  target_resource_id TEXT NOT NULL CHECK (
    length(target_resource_id) = 40
    AND target_resource_id = lower(target_resource_id)
    AND (
      (target_resource_type = ''model'' AND substr(target_resource_id, 1, 4) = ''mdl_'')
      OR (target_resource_type = ''variant'' AND substr(target_resource_id, 1, 4) = ''var_'')
    )
    AND substr(target_resource_id, 5, 8) NOT GLOB ''*[^0-9a-f]*''
    AND substr(target_resource_id, 13, 1) = ''-''
    AND substr(target_resource_id, 14, 4) NOT GLOB ''*[^0-9a-f]*''
    AND substr(target_resource_id, 18, 1) = ''-''
    AND substr(target_resource_id, 19, 1) = ''4''
    AND substr(target_resource_id, 20, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(target_resource_id, 23, 1) = ''-''
    AND substr(target_resource_id, 24, 1) GLOB ''[89ab]''
    AND substr(target_resource_id, 25, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(target_resource_id, 28, 1) = ''-''
    AND substr(target_resource_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  projection_version TEXT NOT NULL CHECK (projection_version = ''provider-model-id@1''),
  raw_provider_model_id_utf8 BLOB NOT NULL CHECK (
    typeof(raw_provider_model_id_utf8) = ''blob''
    AND length(raw_provider_model_id_utf8) BETWEEN 1 AND 1024
  ),
  normalized_provider_model_id_utf8 BLOB NOT NULL CHECK (
    typeof(normalized_provider_model_id_utf8) = ''blob''
    AND length(normalized_provider_model_id_utf8) BETWEEN 0 AND 18432
  ),
  offering_content_hash TEXT NOT NULL CHECK (
    length(offering_content_hash) = 71
    AND substr(offering_content_hash, 1, 7) = ''sha256:''
    AND substr(offering_content_hash, 8) NOT GLOB ''*[^0-9a-f]*''
  ),
  target_content_hash TEXT NOT NULL CHECK (
    length(target_content_hash) = 71
    AND substr(target_content_hash, 1, 7) = ''sha256:''
    AND substr(target_content_hash, 8) NOT GLOB ''*[^0-9a-f]*''
  ),
  PRIMARY KEY (publication_id, offering_id),
  FOREIGN KEY (publication_id, offering_resource_type, offering_id)
    REFERENCES publication_resource(publication_id, resource_type, resource_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (publication_id, provider_id)
    REFERENCES publication_provider_slice(publication_id, provider_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (publication_id, target_resource_type, target_resource_id)
    REFERENCES publication_resource(publication_id, resource_type, resource_id)
    ON DELETE RESTRICT
) STRICT'),
    ('publication_dataset_metadata_summary', 'CREATE TABLE publication_dataset_metadata_summary (
  publication_id TEXT PRIMARY KEY
    REFERENCES publication_closure_seal(publication_id) ON DELETE RESTRICT,
  summary_version TEXT NOT NULL CHECK (summary_version = ''1.0.0''),
  closure_hash TEXT NOT NULL CHECK (
    length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = ''sha256:'' AND
    substr(closure_hash, 8) NOT GLOB ''*[^0-9a-f]*''
  ),
  source_resource_count INTEGER NOT NULL CHECK (
    typeof(source_resource_count) = ''integer'' AND source_resource_count >= 0
  ),
  provider_slice_count INTEGER NOT NULL CHECK (
    typeof(provider_slice_count) = ''integer'' AND provider_slice_count >= 1
  ),
  provider_slice_hash TEXT NOT NULL CHECK (
    length(provider_slice_hash) = 71 AND
    substr(provider_slice_hash, 1, 7) = ''sha256:'' AND
    substr(provider_slice_hash, 8) NOT GLOB ''*[^0-9a-f]*''
  ),
  active_model_count INTEGER NOT NULL CHECK (
    typeof(active_model_count) = ''integer'' AND active_model_count >= 0
  ),
  active_offering_count INTEGER NOT NULL CHECK (
    typeof(active_offering_count) = ''integer'' AND active_offering_count >= 0
  ),
  active_provider_count INTEGER NOT NULL CHECK (
    typeof(active_provider_count) = ''integer'' AND active_provider_count >= 0
  ),
  has_stale_provider_slices INTEGER NOT NULL CHECK (
    has_stale_provider_slices IN (0, 1)
  ),
  has_unavailable_provider_slices INTEGER NOT NULL CHECK (
    has_unavailable_provider_slices IN (0, 1)
  ),
  summary_hash TEXT NOT NULL CHECK (
    length(summary_hash) = 71 AND substr(summary_hash, 1, 7) = ''sha256:'' AND
    substr(summary_hash, 8) NOT GLOB ''*[^0-9a-f]*''
  )
) STRICT')
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM expected
  LEFT JOIN sqlite_schema AS object
    ON object.type = 'table' AND object.name = expected.name
  WHERE object.sql IS NULL OR object.sql <> expected.expected_sql
) THEN json('') END;


-- Exact retained tables with the sole accepted workerd comment-elision
-- representation produced by the lockfile-pinned D1 migration runner.
WITH expected(name, native_sql, workerd_sql) AS (
  VALUES
    ('serving_schema_metadata', 'CREATE TABLE serving_schema_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = ''integer'' AND created_at_ms >= 0)
)', 'CREATE TABLE serving_schema_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = ''integer'' AND created_at_ms >= 0)
)'),
    ('publication_provider_search_document', 'CREATE TABLE publication_provider_search_document (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL CHECK (
    length(provider_id) = 40
    AND substr(provider_id, 1, 4) = ''prv_''
    AND provider_id = lower(provider_id)
  ),
  projection_version TEXT NOT NULL CHECK (projection_version = ''provider-name@1''),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  -- 200 ProviderSchema display-name scalars times Unicode 17 NFKC_CF''s
  -- generated maximum expansion of 18 (U+FDFA).
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 3600),
  provider_resource_content_hash TEXT NOT NULL CHECK (
    length(provider_resource_content_hash) = 71
    AND substr(provider_resource_content_hash, 1, 7) = ''sha256:''
    AND substr(provider_resource_content_hash, 8) NOT GLOB ''*[^0-9a-f]*''
  ),
  PRIMARY KEY (publication_id, provider_id),
  FOREIGN KEY (publication_id, provider_id)
    REFERENCES publication_provider_slice(publication_id, provider_id)
    ON DELETE RESTRICT
)', 'CREATE TABLE publication_provider_search_document (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL CHECK (
    length(provider_id) = 40
    AND substr(provider_id, 1, 4) = ''prv_''
    AND provider_id = lower(provider_id)
  ),
  projection_version TEXT NOT NULL CHECK (projection_version = ''provider-name@1''),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),' || char(10) || '  ' || char(10) || '  ' || char(10) || '  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 3600),
  provider_resource_content_hash TEXT NOT NULL CHECK (
    length(provider_resource_content_hash) = 71
    AND substr(provider_resource_content_hash, 1, 7) = ''sha256:''
    AND substr(provider_resource_content_hash, 8) NOT GLOB ''*[^0-9a-f]*''
  ),
  PRIMARY KEY (publication_id, provider_id),
  FOREIGN KEY (publication_id, provider_id)
    REFERENCES publication_provider_slice(publication_id, provider_id)
    ON DELETE RESTRICT
)'),
    ('publication_model_variant_name_search_document', 'CREATE TABLE publication_model_variant_name_search_document (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT CHECK (
    length(publication_id) = 40
    AND substr(publication_id, 1, 4) = ''pub_''
    AND publication_id = lower(publication_id)
    AND substr(publication_id, 5, 8) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 13, 1) = ''-''
    AND substr(publication_id, 14, 4) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 18, 1) = ''-''
    AND substr(publication_id, 19, 1) = ''4''
    AND substr(publication_id, 20, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 23, 1) = ''-''
    AND substr(publication_id, 24, 1) GLOB ''[89ab]''
    AND substr(publication_id, 25, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 28, 1) = ''-''
    AND substr(publication_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  resource_type TEXT NOT NULL CHECK (resource_type IN (''model'', ''variant'')),
  resource_id TEXT NOT NULL CHECK (
    length(resource_id) = 40
    AND resource_id = lower(resource_id)
    AND (
      (resource_type = ''model'' AND substr(resource_id, 1, 4) = ''mdl_'')
      OR (resource_type = ''variant'' AND substr(resource_id, 1, 4) = ''var_'')
    )
    AND substr(resource_id, 5, 8) NOT GLOB ''*[^0-9a-f]*''
    AND substr(resource_id, 13, 1) = ''-''
    AND substr(resource_id, 14, 4) NOT GLOB ''*[^0-9a-f]*''
    AND substr(resource_id, 18, 1) = ''-''
    AND substr(resource_id, 19, 1) = ''4''
    AND substr(resource_id, 20, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(resource_id, 23, 1) = ''-''
    AND substr(resource_id, 24, 1) GLOB ''[89ab]''
    AND substr(resource_id, 25, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(resource_id, 28, 1) = ''-''
    AND substr(resource_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  projection_version TEXT NOT NULL CHECK (projection_version = ''model-variant-name@1''),
  display_name_utf8 BLOB NOT NULL CHECK (
    typeof(display_name_utf8) = ''blob''
    AND length(display_name_utf8) BETWEEN 1 AND 800
  ),
  -- 200 display-name scalars times Unicode 17 NFKC_CF''s generated maximum
  -- expansion of 18, at up to four UTF-8 bytes per resulting scalar.
  normalized_name_utf8 BLOB NOT NULL CHECK (
    typeof(normalized_name_utf8) = ''blob''
    AND length(normalized_name_utf8) BETWEEN 1 AND 14400
  ),
  resource_content_hash TEXT NOT NULL CHECK (
    length(resource_content_hash) = 71
    AND substr(resource_content_hash, 1, 7) = ''sha256:''
    AND substr(resource_content_hash, 8) NOT GLOB ''*[^0-9a-f]*''
  ),
  PRIMARY KEY (publication_id, resource_type, resource_id),
  FOREIGN KEY (publication_id, resource_type, resource_id)
    REFERENCES publication_resource(publication_id, resource_type, resource_id)
    ON DELETE RESTRICT
) STRICT', 'CREATE TABLE publication_model_variant_name_search_document (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT CHECK (
    length(publication_id) = 40
    AND substr(publication_id, 1, 4) = ''pub_''
    AND publication_id = lower(publication_id)
    AND substr(publication_id, 5, 8) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 13, 1) = ''-''
    AND substr(publication_id, 14, 4) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 18, 1) = ''-''
    AND substr(publication_id, 19, 1) = ''4''
    AND substr(publication_id, 20, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 23, 1) = ''-''
    AND substr(publication_id, 24, 1) GLOB ''[89ab]''
    AND substr(publication_id, 25, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(publication_id, 28, 1) = ''-''
    AND substr(publication_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  resource_type TEXT NOT NULL CHECK (resource_type IN (''model'', ''variant'')),
  resource_id TEXT NOT NULL CHECK (
    length(resource_id) = 40
    AND resource_id = lower(resource_id)
    AND (
      (resource_type = ''model'' AND substr(resource_id, 1, 4) = ''mdl_'')
      OR (resource_type = ''variant'' AND substr(resource_id, 1, 4) = ''var_'')
    )
    AND substr(resource_id, 5, 8) NOT GLOB ''*[^0-9a-f]*''
    AND substr(resource_id, 13, 1) = ''-''
    AND substr(resource_id, 14, 4) NOT GLOB ''*[^0-9a-f]*''
    AND substr(resource_id, 18, 1) = ''-''
    AND substr(resource_id, 19, 1) = ''4''
    AND substr(resource_id, 20, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(resource_id, 23, 1) = ''-''
    AND substr(resource_id, 24, 1) GLOB ''[89ab]''
    AND substr(resource_id, 25, 3) NOT GLOB ''*[^0-9a-f]*''
    AND substr(resource_id, 28, 1) = ''-''
    AND substr(resource_id, 29, 12) NOT GLOB ''*[^0-9a-f]*''
  ),
  projection_version TEXT NOT NULL CHECK (projection_version = ''model-variant-name@1''),
  display_name_utf8 BLOB NOT NULL CHECK (
    typeof(display_name_utf8) = ''blob''
    AND length(display_name_utf8) BETWEEN 1 AND 800
  ),' || char(10) || '  ' || char(10) || '  ' || char(10) || '  normalized_name_utf8 BLOB NOT NULL CHECK (
    typeof(normalized_name_utf8) = ''blob''
    AND length(normalized_name_utf8) BETWEEN 1 AND 14400
  ),
  resource_content_hash TEXT NOT NULL CHECK (
    length(resource_content_hash) = 71
    AND substr(resource_content_hash, 1, 7) = ''sha256:''
    AND substr(resource_content_hash, 8) NOT GLOB ''*[^0-9a-f]*''
  ),
  PRIMARY KEY (publication_id, resource_type, resource_id),
  FOREIGN KEY (publication_id, resource_type, resource_id)
    REFERENCES publication_resource(publication_id, resource_type, resource_id)
    ON DELETE RESTRICT
) STRICT')
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM expected
  LEFT JOIN sqlite_schema AS object
    ON object.type = 'table' AND object.name = expected.name
  WHERE object.sql IS NULL OR object.sql NOT IN (
    expected.native_sql, expected.workerd_sql
  )
) THEN json('') END;


-- Exact raw canonical identities close every retained trigger that survives
-- the cutover and underpins v5 table integrity.
WITH expected(name, expected_sql) AS (
  VALUES
    ('publication_resource_type_insert', 'CREATE TRIGGER publication_resource_type_insert
BEFORE INSERT ON publication_resource
BEGIN
  SELECT CASE WHEN NOT (
    (NEW.resource_type = ''model_family'' AND substr(NEW.resource_id, 1, 4) = ''fam_'') OR
    (NEW.resource_type = ''model'' AND substr(NEW.resource_id, 1, 4) = ''mdl_'') OR
    (NEW.resource_type = ''variant'' AND substr(NEW.resource_id, 1, 4) = ''var_'') OR
    (NEW.resource_type = ''provider'' AND substr(NEW.resource_id, 1, 4) = ''prv_'') OR
    (NEW.resource_type = ''offering'' AND substr(NEW.resource_id, 1, 4) = ''off_'') OR
    (NEW.resource_type = ''price'' AND substr(NEW.resource_id, 1, 4) = ''pcs_'') OR
    (NEW.resource_type = ''precision_observation'' AND substr(NEW.resource_id, 1, 4) = ''prc_'') OR
    (NEW.resource_type = ''evidence_summary'' AND substr(NEW.resource_id, 1, 4) = ''evd_'')
  ) THEN RAISE(ABORT, ''publication resource type and ID prefix disagree'') END;
END'),
    ('publication_resource_immutable_update', 'CREATE TRIGGER publication_resource_immutable_update
BEFORE UPDATE ON publication_resource BEGIN SELECT RAISE(ABORT, ''publication resource is immutable''); END'),
    ('publication_resource_immutable_delete', 'CREATE TRIGGER publication_resource_immutable_delete
BEFORE DELETE ON publication_resource BEGIN SELECT RAISE(ABORT, ''publication resource cannot be deleted''); END'),
    ('publication_resource_building_insert', 'CREATE TRIGGER publication_resource_building_insert
BEFORE INSERT ON publication_resource
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.publication_id AND state = ''building''
  ) THEN RAISE(ABORT, ''publication resources may be staged only while building'') END;
END'),
    ('publication_resource_post_seal_insert_guard', 'CREATE TRIGGER publication_resource_post_seal_insert_guard
BEFORE INSERT ON publication_resource
WHEN EXISTS (SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id)
BEGIN SELECT RAISE(ABORT, ''sealed publication closure is immutable''); END'),
    ('publication_resource_revision', 'CREATE TRIGGER publication_resource_revision
AFTER INSERT ON publication_resource
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_staging_revision_seed', 'CREATE TRIGGER publication_staging_revision_seed
AFTER INSERT ON publication
BEGIN
  INSERT INTO publication_staging_revision(publication_id, revision)
  VALUES (NEW.publication_id, 0);
END'),
    ('publication_staging_revision_immutable_update', 'CREATE TRIGGER publication_staging_revision_immutable_update
BEFORE UPDATE ON publication_staging_revision
WHEN NEW.publication_id <> OLD.publication_id
  OR NEW.revision <> OLD.revision + 1
  OR NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = OLD.publication_id AND state = ''building''
  )
  OR EXISTS (
  SELECT 1 FROM publication_closure_seal WHERE publication_id = OLD.publication_id
)
BEGIN SELECT RAISE(ABORT, ''publication staging revision is trigger-managed''); END'),
    ('publication_staging_revision_immutable_delete', 'CREATE TRIGGER publication_staging_revision_immutable_delete
BEFORE DELETE ON publication_staging_revision
BEGIN SELECT RAISE(ABORT, ''publication staging revision cannot be deleted''); END'),
    ('publication_closure_seal_insert_guard', 'CREATE TRIGGER publication_closure_seal_insert_guard
BEFORE INSERT ON publication_closure_seal
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id
      AND state = ''building''
      AND closure_hash = NEW.closure_hash
      AND generated_at_ms <= NEW.sealed_at_ms
      AND resource_count = NEW.resource_count
      AND exact_document_count = NEW.exact_document_count
      AND vector_document_count = NEW.vector_document_count
  ) THEN RAISE(ABORT, ''seal does not match immutable publication metadata'') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_staging_revision
    WHERE publication_id = NEW.publication_id AND revision = NEW.staging_revision
  ) THEN RAISE(ABORT, ''publication staging revision changed before seal'') END;
  SELECT CASE WHEN NEW.enabled_provider_count <> NEW.provider_slice_count
    OR NEW.provider_slice_count <> (SELECT count(*) FROM publication_provider_slice WHERE publication_id = NEW.publication_id)
    OR NEW.provider_slice_count <> (SELECT count(*) FROM publication_provider_slice_metadata WHERE publication_id = NEW.publication_id)
    THEN RAISE(ABORT, ''provider scope or metadata does not close'') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_provider_slice AS disposition
    WHERE disposition.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_slice_metadata AS metadata
        WHERE metadata.publication_id = disposition.publication_id
          AND metadata.provider_id = disposition.provider_id
      )
  ) THEN RAISE(ABORT, ''provider scope or metadata does not close'') END;
  SELECT CASE WHEN NEW.provider_attribution_count <> (
    SELECT count(*) FROM publication_provider_attribution WHERE publication_id = NEW.publication_id
  ) OR EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type IN (''provider'', ''offering'', ''price'', ''precision_observation'')
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_attribution AS attribution
        WHERE attribution.publication_id = resource.publication_id
          AND attribution.resource_type = resource.resource_type
          AND attribution.resource_id = resource.resource_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_attribution AS attribution
    JOIN publication_provider_slice AS disposition
      ON disposition.publication_id = attribution.publication_id
      AND disposition.provider_id = attribution.provider_id
    WHERE attribution.publication_id = NEW.publication_id
      AND disposition.freshness_state = ''unavailable''
  ) THEN RAISE(ABORT, ''provider attribution does not close'') END;
  SELECT CASE WHEN NEW.resource_count = 0
    OR NEW.resource_count <> (SELECT count(*) FROM publication_resource WHERE publication_id = NEW.publication_id)
    OR NEW.exact_document_count <> (SELECT count(*) FROM publication_search_document WHERE publication_id = NEW.publication_id)
    OR NEW.vector_document_count <> (SELECT count(*) FROM publication_vector_inventory WHERE publication_id = NEW.publication_id)
    OR NEW.exact_document_count <> NEW.vector_document_count
    OR NEW.vector_document_count <> (
      SELECT count(*) FROM publication_resource
      WHERE publication_id = NEW.publication_id AND resource_type IN (''model'', ''variant'')
    ) OR EXISTS (
      SELECT 1 FROM publication_search_document AS document
      WHERE document.publication_id = NEW.publication_id
        AND NOT EXISTS (
          SELECT 1 FROM publication_vector_inventory AS vector
          WHERE vector.publication_id = document.publication_id
            AND vector.vector_id = document.document_id
            AND vector.resource_type = document.resource_type
            AND vector.resource_id = document.resource_id
            AND vector.search_document_content_hash = document.content_hash
        )
    ) THEN RAISE(ABORT, ''resource search and vector inventories do not close'') END;
  SELECT CASE WHEN NEW.chunk_count <> (
    SELECT count(*) FROM publication_inventory_chunk WHERE publication_id = NEW.publication_id
  ) OR EXISTS (
    SELECT 1 FROM publication_inventory_chunk AS later
    JOIN publication_inventory_chunk AS earlier
      ON earlier.publication_id = later.publication_id
      AND earlier.kind = later.kind
      AND earlier.ordinal = later.ordinal - 1
    WHERE later.publication_id = NEW.publication_id
      AND earlier.last_key >= later.first_key
  ) OR EXISTS (
    SELECT 1 FROM (
      SELECT ''resources'' AS kind
      UNION ALL SELECT ''exact_search''
      UNION ALL SELECT ''vectors''
    ) AS expected
    WHERE COALESCE((
      SELECT sum(item_count) FROM publication_inventory_chunk
      WHERE publication_id = NEW.publication_id AND kind = expected.kind
    ), 0) <> CASE expected.kind
      WHEN ''resources'' THEN NEW.resource_count
      WHEN ''exact_search'' THEN NEW.exact_document_count
      ELSE NEW.vector_document_count
    END
    OR (
      SELECT count(*) FROM publication_inventory_chunk
      WHERE publication_id = NEW.publication_id AND kind = expected.kind
    ) <> COALESCE((
      SELECT max(ordinal) + 1 FROM publication_inventory_chunk
      WHERE publication_id = NEW.publication_id AND kind = expected.kind
    ), 0)
  ) THEN RAISE(ABORT, ''inventory chunks do not close'') END;
END'),
    ('publication_closure_seal_immutable_update', 'CREATE TRIGGER publication_closure_seal_immutable_update
BEFORE UPDATE ON publication_closure_seal
BEGIN SELECT RAISE(ABORT, ''publication closure seal is immutable''); END'),
    ('publication_closure_seal_immutable_delete', 'CREATE TRIGGER publication_closure_seal_immutable_delete
BEFORE DELETE ON publication_closure_seal
BEGIN SELECT RAISE(ABORT, ''publication closure seal cannot be deleted''); END'),
    ('publication_provider_slice_metadata_insert_guard', 'CREATE TRIGGER publication_provider_slice_metadata_insert_guard
BEFORE INSERT ON publication_provider_slice_metadata
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = ''building''
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''closure rows may be staged only while building and unsealed'') END;
END'),
    ('publication_provider_attribution_insert_guard', 'CREATE TRIGGER publication_provider_attribution_insert_guard
BEFORE INSERT ON publication_provider_attribution
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = ''building''
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''closure rows may be staged only while building and unsealed'') END;
  SELECT CASE WHEN NEW.resource_type = ''provider'' AND NEW.resource_id <> NEW.provider_id
    THEN RAISE(ABORT, ''provider resource attribution must match its provider identity'') END;
END'),
    ('publication_vector_inventory_insert_guard', 'CREATE TRIGGER publication_vector_inventory_insert_guard
BEFORE INSERT ON publication_vector_inventory
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = ''building''
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''closure rows may be staged only while building and unsealed'') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_search_document
    WHERE publication_id = NEW.publication_id
      AND document_id = NEW.vector_id
      AND resource_type = NEW.resource_type
      AND resource_id = NEW.resource_id
      AND content_hash = NEW.search_document_content_hash
  ) THEN RAISE(ABORT, ''vector inventory does not match its search document'') END;
END'),
    ('publication_inventory_chunk_insert_guard', 'CREATE TRIGGER publication_inventory_chunk_insert_guard
BEFORE INSERT ON publication_inventory_chunk
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = ''building''
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''closure rows may be staged only while building and unsealed'') END;
END'),
    ('publication_provider_slice_revision', 'CREATE TRIGGER publication_provider_slice_revision
AFTER INSERT ON publication_provider_slice
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_search_revision', 'CREATE TRIGGER publication_search_revision
AFTER INSERT ON publication_search_document
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_provider_slice_metadata_revision', 'CREATE TRIGGER publication_provider_slice_metadata_revision
AFTER INSERT ON publication_provider_slice_metadata
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_provider_attribution_revision', 'CREATE TRIGGER publication_provider_attribution_revision
AFTER INSERT ON publication_provider_attribution
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_vector_inventory_revision', 'CREATE TRIGGER publication_vector_inventory_revision
AFTER INSERT ON publication_vector_inventory
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_inventory_chunk_revision', 'CREATE TRIGGER publication_inventory_chunk_revision
AFTER INSERT ON publication_inventory_chunk
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_provider_model_id_search_document_insert_guard', 'CREATE TRIGGER publication_provider_model_id_search_document_insert_guard
BEFORE INSERT ON publication_provider_model_id_search_document
BEGIN
  WITH RECURSIVE utf8(bytes, position, valid) AS (
    VALUES (hex(NEW.raw_provider_model_id_utf8), 1, 1)
    UNION ALL
    SELECT bytes,
      CASE
        WHEN substr(bytes, position, 2) BETWEEN ''00'' AND ''7F'' THEN position + 2
        WHEN substr(bytes, position, 2) BETWEEN ''C2'' AND ''DF''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF'' THEN position + 4
        WHEN substr(bytes, position, 2) = ''E0''
          AND substr(bytes, position + 2, 2) BETWEEN ''A0'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN (substr(bytes, position, 2) BETWEEN ''E1'' AND ''EC''
          OR substr(bytes, position, 2) BETWEEN ''EE'' AND ''EF'')
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN substr(bytes, position, 2) = ''ED''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''9F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN substr(bytes, position, 2) = ''F0''
          AND substr(bytes, position + 2, 2) BETWEEN ''90'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        WHEN substr(bytes, position, 2) BETWEEN ''F1'' AND ''F3''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        WHEN substr(bytes, position, 2) = ''F4''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''8F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        ELSE length(bytes) + 2
      END,
      CASE
        WHEN substr(bytes, position, 2) BETWEEN ''00'' AND ''7F'' THEN 1
        WHEN substr(bytes, position, 2) BETWEEN ''C2'' AND ''DF''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''E0''
          AND substr(bytes, position + 2, 2) BETWEEN ''A0'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN (substr(bytes, position, 2) BETWEEN ''E1'' AND ''EC''
          OR substr(bytes, position, 2) BETWEEN ''EE'' AND ''EF'')
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''ED''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''9F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''F0''
          AND substr(bytes, position + 2, 2) BETWEEN ''90'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) BETWEEN ''F1'' AND ''F3''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''F4''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''8F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        ELSE 0
      END
    FROM utf8
    WHERE valid = 1 AND position <= length(bytes)
  )
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM utf8
    WHERE valid = 1 AND position = length(bytes) + 1
  ) THEN RAISE(ABORT, ''raw provider model ID must be strict UTF-8'') END;
  WITH RECURSIVE utf8(bytes, position, valid) AS (
    VALUES (hex(NEW.normalized_provider_model_id_utf8), 1, 1)
    UNION ALL
    SELECT bytes,
      CASE
        WHEN substr(bytes, position, 2) BETWEEN ''00'' AND ''7F'' THEN position + 2
        WHEN substr(bytes, position, 2) BETWEEN ''C2'' AND ''DF''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF'' THEN position + 4
        WHEN substr(bytes, position, 2) = ''E0''
          AND substr(bytes, position + 2, 2) BETWEEN ''A0'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN (substr(bytes, position, 2) BETWEEN ''E1'' AND ''EC''
          OR substr(bytes, position, 2) BETWEEN ''EE'' AND ''EF'')
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN substr(bytes, position, 2) = ''ED''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''9F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN substr(bytes, position, 2) = ''F0''
          AND substr(bytes, position + 2, 2) BETWEEN ''90'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        WHEN substr(bytes, position, 2) BETWEEN ''F1'' AND ''F3''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        WHEN substr(bytes, position, 2) = ''F4''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''8F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        ELSE length(bytes) + 2
      END,
      CASE
        WHEN substr(bytes, position, 2) BETWEEN ''00'' AND ''7F'' THEN 1
        WHEN substr(bytes, position, 2) BETWEEN ''C2'' AND ''DF''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''E0''
          AND substr(bytes, position + 2, 2) BETWEEN ''A0'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN (substr(bytes, position, 2) BETWEEN ''E1'' AND ''EC''
          OR substr(bytes, position, 2) BETWEEN ''EE'' AND ''EF'')
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''ED''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''9F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''F0''
          AND substr(bytes, position + 2, 2) BETWEEN ''90'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) BETWEEN ''F1'' AND ''F3''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''F4''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''8F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        ELSE 0
      END
    FROM utf8
    WHERE valid = 1 AND position <= length(bytes)
  )
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM utf8
    WHERE valid = 1 AND position = length(bytes) + 1
  ) THEN RAISE(ABORT, ''normalized provider model ID must be strict UTF-8'') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_resource AS offering
      ON offering.publication_id = candidate.publication_id
      AND offering.resource_type = NEW.offering_resource_type
      AND offering.resource_id = NEW.offering_id
    JOIN publication_provider_attribution AS attribution
      ON attribution.publication_id = offering.publication_id
      AND attribution.resource_type = offering.resource_type
      AND attribution.resource_id = offering.resource_id
      AND attribution.provider_id = NEW.provider_id
    JOIN publication_provider_slice AS disposition
      ON disposition.publication_id = attribution.publication_id
      AND disposition.provider_id = attribution.provider_id
    JOIN publication_resource AS target
      ON target.publication_id = candidate.publication_id
      AND target.resource_type = NEW.target_resource_type
      AND target.resource_id = NEW.target_resource_id
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = ''building''
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal
        WHERE publication_id = candidate.publication_id
      )
      AND disposition.provider_slice_id IS NOT NULL
      AND offering.content_hash = NEW.offering_content_hash
      AND json_extract(offering.resource_json, ''$.offering_id'') = NEW.offering_id
      AND json_extract(offering.resource_json, ''$.provider_id'') = NEW.provider_id
      AND json_extract(offering.resource_json, ''$.model_resource_id'') = NEW.target_resource_id
      AND CAST(json_extract(
        offering.resource_json,
        ''$.provider_model_id''
      ) AS BLOB) = NEW.raw_provider_model_id_utf8
      AND target.content_hash = NEW.target_content_hash
      AND CASE NEW.target_resource_type
        WHEN ''model'' THEN json_extract(target.resource_json, ''$.model_id'')
        WHEN ''variant'' THEN json_extract(target.resource_json, ''$.variant_id'')
      END = NEW.target_resource_id
  ) THEN RAISE(ABORT, ''provider model ID search document does not match canonical offering and target content'') END;
END'),
    ('publication_provider_model_id_search_document_immutable_update', 'CREATE TRIGGER publication_provider_model_id_search_document_immutable_update
BEFORE UPDATE ON publication_provider_model_id_search_document
BEGIN SELECT RAISE(ABORT, ''provider model ID search document is immutable''); END'),
    ('publication_provider_model_id_search_document_immutable_delete', 'CREATE TRIGGER publication_provider_model_id_search_document_immutable_delete
BEFORE DELETE ON publication_provider_model_id_search_document
BEGIN SELECT RAISE(ABORT, ''provider model ID search document cannot be deleted''); END'),
    ('publication_dataset_metadata_summary_insert_guard', 'CREATE TRIGGER publication_dataset_metadata_summary_insert_guard
BEFORE INSERT ON publication_dataset_metadata_summary
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = ''building''
      AND candidate.closure_hash = NEW.closure_hash
      AND seal.closure_hash = NEW.closure_hash
      AND seal.resource_count = NEW.source_resource_count
      AND seal.provider_slice_count = NEW.provider_slice_count
      AND seal.provider_slice_hash = NEW.provider_slice_hash
  ) THEN RAISE(ABORT, ''dataset metadata summary does not match its sealed publication'') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type IN (''model'', ''offering'', ''provider'')
      AND (
        json_type(resource.resource_json, ''$.status'') IS NOT ''object'' OR
        json_type(resource.resource_json, ''$.status.state'') IS NOT ''text'' OR
        COALESCE(json_extract(resource.resource_json, ''$.status.state''), ''__missing__'') NOT IN
          (''known'', ''unknown'', ''not_applicable'', ''unavailable'') OR
        (
          json_extract(resource.resource_json, ''$.status.state'') = ''known''
          AND json_type(resource.resource_json, ''$.status.value'') IS NOT ''text''
        ) OR (
          json_extract(resource.resource_json, ''$.status.state'') IS NOT ''known''
          AND json_type(resource.resource_json, ''$.status.value'') IS NOT ''null''
        ) OR (
          resource.resource_type = ''model'' AND (
            json_type(resource.resource_json, ''$.model_id'') IS NOT ''text'' OR
            json_extract(resource.resource_json, ''$.model_id'') IS NOT resource.resource_id
          )
        ) OR (
          resource.resource_type = ''offering'' AND (
            json_type(resource.resource_json, ''$.offering_id'') IS NOT ''text'' OR
            json_extract(resource.resource_json, ''$.offering_id'') IS NOT resource.resource_id OR
            (json_type(resource.resource_json, ''$.stale'') IS NOT ''true'' AND
              json_type(resource.resource_json, ''$.stale'') IS NOT ''false'')
          )
        ) OR (
          resource.resource_type = ''provider'' AND (
            json_type(resource.resource_json, ''$.provider_id'') IS NOT ''text'' OR
            json_extract(resource.resource_json, ''$.provider_id'') IS NOT resource.resource_id
          )
        )
      )
  ) THEN RAISE(ABORT, ''dataset metadata counted resource is malformed'') END;

  SELECT CASE WHEN NEW.active_model_count <> (
    SELECT count(*) FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type = ''model''
      AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
      AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
  ) OR NEW.active_offering_count <> (
    SELECT count(*) FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type = ''offering''
      AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
      AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
      AND json_extract(resource.resource_json, ''$.stale'') = 0
  ) OR NEW.active_provider_count <> (
    SELECT count(*) FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type = ''provider''
      AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
      AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
  ) OR NEW.has_stale_provider_slices <> EXISTS (
    SELECT 1 FROM publication_provider_slice
    WHERE publication_id = NEW.publication_id AND freshness_state = ''stale''
  ) OR NEW.has_unavailable_provider_slices <> EXISTS (
    SELECT 1 FROM publication_provider_slice
    WHERE publication_id = NEW.publication_id AND freshness_state = ''unavailable''
  ) THEN RAISE(ABORT, ''dataset metadata summary does not match sealed source rows'') END;
END'),
    ('publication_dataset_metadata_summary_immutable_update', 'CREATE TRIGGER publication_dataset_metadata_summary_immutable_update
BEFORE UPDATE ON publication_dataset_metadata_summary
BEGIN SELECT RAISE(ABORT, ''dataset metadata summary is immutable''); END'),
    ('publication_dataset_metadata_summary_immutable_delete', 'CREATE TRIGGER publication_dataset_metadata_summary_immutable_delete
BEFORE DELETE ON publication_dataset_metadata_summary
BEGIN SELECT RAISE(ABORT, ''dataset metadata summary cannot be deleted''); END')
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM expected
  LEFT JOIN sqlite_schema AS object
    ON object.type = 'trigger' AND object.name = expected.name
  WHERE object.sql IS NULL OR object.sql <> expected.expected_sql
) THEN json('') END;


-- Inventory-complete exact identity for every schema-1.12 trigger that is
-- retained rather than deliberately recreated by this cutover.
WITH expected(name, expected_sql) AS (
  VALUES
    ('publication_activation_timestamp_guard', 'CREATE TRIGGER publication_activation_timestamp_guard
BEFORE UPDATE OF activated_at_ms ON publication
WHEN NOT (NEW.activated_at_ms IS OLD.activated_at_ms) AND NOT (
  OLD.state = ''ready'' AND NEW.state = ''active'' AND
  OLD.activated_at_ms IS NULL AND NEW.activated_at_ms IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, ''activation timestamp may change only on activation transition''); END'),
    ('publication_archive_receipt_immutable_delete', 'CREATE TRIGGER publication_archive_receipt_immutable_delete BEFORE DELETE ON publication_archive_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt cannot be deleted''); END'),
    ('publication_archive_receipt_immutable_update', 'CREATE TRIGGER publication_archive_receipt_immutable_update BEFORE UPDATE ON publication_archive_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt is immutable''); END'),
    ('publication_archive_receipt_insert_guard', 'CREATE TRIGGER publication_archive_receipt_insert_guard
BEFORE INSERT ON publication_archive_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = ''archive'' AND candidate.state = ''building''
  ) THEN RAISE(ABORT, ''archive receipt lacks its sealed binding'') END;
END'),
    ('publication_closure_seal_immutable_delete', 'CREATE TRIGGER publication_closure_seal_immutable_delete
BEFORE DELETE ON publication_closure_seal
BEGIN SELECT RAISE(ABORT, ''publication closure seal cannot be deleted''); END'),
    ('publication_closure_seal_immutable_update', 'CREATE TRIGGER publication_closure_seal_immutable_update
BEFORE UPDATE ON publication_closure_seal
BEGIN SELECT RAISE(ABORT, ''publication closure seal is immutable''); END'),
    ('publication_dataset_metadata_summary_immutable_delete', 'CREATE TRIGGER publication_dataset_metadata_summary_immutable_delete
BEFORE DELETE ON publication_dataset_metadata_summary
BEGIN SELECT RAISE(ABORT, ''dataset metadata summary cannot be deleted''); END'),
    ('publication_dataset_metadata_summary_immutable_update', 'CREATE TRIGGER publication_dataset_metadata_summary_immutable_update
BEFORE UPDATE ON publication_dataset_metadata_summary
BEGIN SELECT RAISE(ABORT, ''dataset metadata summary is immutable''); END'),
    ('publication_dataset_metadata_summary_insert_guard', 'CREATE TRIGGER publication_dataset_metadata_summary_insert_guard
BEFORE INSERT ON publication_dataset_metadata_summary
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = ''building''
      AND candidate.closure_hash = NEW.closure_hash
      AND seal.closure_hash = NEW.closure_hash
      AND seal.resource_count = NEW.source_resource_count
      AND seal.provider_slice_count = NEW.provider_slice_count
      AND seal.provider_slice_hash = NEW.provider_slice_hash
  ) THEN RAISE(ABORT, ''dataset metadata summary does not match its sealed publication'') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type IN (''model'', ''offering'', ''provider'')
      AND (
        json_type(resource.resource_json, ''$.status'') IS NOT ''object'' OR
        json_type(resource.resource_json, ''$.status.state'') IS NOT ''text'' OR
        COALESCE(json_extract(resource.resource_json, ''$.status.state''), ''__missing__'') NOT IN
          (''known'', ''unknown'', ''not_applicable'', ''unavailable'') OR
        (
          json_extract(resource.resource_json, ''$.status.state'') = ''known''
          AND json_type(resource.resource_json, ''$.status.value'') IS NOT ''text''
        ) OR (
          json_extract(resource.resource_json, ''$.status.state'') IS NOT ''known''
          AND json_type(resource.resource_json, ''$.status.value'') IS NOT ''null''
        ) OR (
          resource.resource_type = ''model'' AND (
            json_type(resource.resource_json, ''$.model_id'') IS NOT ''text'' OR
            json_extract(resource.resource_json, ''$.model_id'') IS NOT resource.resource_id
          )
        ) OR (
          resource.resource_type = ''offering'' AND (
            json_type(resource.resource_json, ''$.offering_id'') IS NOT ''text'' OR
            json_extract(resource.resource_json, ''$.offering_id'') IS NOT resource.resource_id OR
            (json_type(resource.resource_json, ''$.stale'') IS NOT ''true'' AND
              json_type(resource.resource_json, ''$.stale'') IS NOT ''false'')
          )
        ) OR (
          resource.resource_type = ''provider'' AND (
            json_type(resource.resource_json, ''$.provider_id'') IS NOT ''text'' OR
            json_extract(resource.resource_json, ''$.provider_id'') IS NOT resource.resource_id
          )
        )
      )
  ) THEN RAISE(ABORT, ''dataset metadata counted resource is malformed'') END;

  SELECT CASE WHEN NEW.active_model_count <> (
    SELECT count(*) FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type = ''model''
      AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
      AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
  ) OR NEW.active_offering_count <> (
    SELECT count(*) FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type = ''offering''
      AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
      AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
      AND json_extract(resource.resource_json, ''$.stale'') = 0
  ) OR NEW.active_provider_count <> (
    SELECT count(*) FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type = ''provider''
      AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
      AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
  ) OR NEW.has_stale_provider_slices <> EXISTS (
    SELECT 1 FROM publication_provider_slice
    WHERE publication_id = NEW.publication_id AND freshness_state = ''stale''
  ) OR NEW.has_unavailable_provider_slices <> EXISTS (
    SELECT 1 FROM publication_provider_slice
    WHERE publication_id = NEW.publication_id AND freshness_state = ''unavailable''
  ) THEN RAISE(ABORT, ''dataset metadata summary does not match sealed source rows'') END;
END'),
    ('publication_dataset_metadata_summary_readiness_guard', 'CREATE TRIGGER publication_dataset_metadata_summary_readiness_guard
BEFORE UPDATE OF state ON publication
WHEN OLD.state = ''building'' AND NEW.state = ''ready''
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_dataset_metadata_summary AS summary
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE summary.publication_id = NEW.publication_id
      AND summary.summary_version = ''1.0.0''
      AND summary.closure_hash = NEW.closure_hash
      AND summary.closure_hash = seal.closure_hash
      AND summary.source_resource_count = NEW.resource_count
      AND summary.source_resource_count = seal.resource_count
      AND summary.provider_slice_count = seal.provider_slice_count
      AND summary.provider_slice_hash = seal.provider_slice_hash
      AND summary.active_model_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.publication_id
          AND resource.resource_type = ''model''
          AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
          AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
      )
      AND summary.active_offering_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.publication_id
          AND resource.resource_type = ''offering''
          AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
          AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
          AND json_extract(resource.resource_json, ''$.stale'') = 0
      )
      AND summary.active_provider_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.publication_id
          AND resource.resource_type = ''provider''
          AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
          AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
      )
      AND summary.has_stale_provider_slices = EXISTS (
        SELECT 1 FROM publication_provider_slice
        WHERE publication_id = NEW.publication_id AND freshness_state = ''stale''
      )
      AND summary.has_unavailable_provider_slices = EXISTS (
        SELECT 1 FROM publication_provider_slice
        WHERE publication_id = NEW.publication_id AND freshness_state = ''unavailable''
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type IN (''model'', ''offering'', ''provider'')
      AND (
        json_type(resource.resource_json, ''$.status'') IS NOT ''object'' OR
        json_type(resource.resource_json, ''$.status.state'') IS NOT ''text'' OR
        COALESCE(json_extract(resource.resource_json, ''$.status.state''), ''__missing__'') NOT IN
          (''known'', ''unknown'', ''not_applicable'', ''unavailable'') OR
        (json_extract(resource.resource_json, ''$.status.state'') = ''known'' AND
          json_type(resource.resource_json, ''$.status.value'') IS NOT ''text'') OR
        (json_extract(resource.resource_json, ''$.status.state'') IS NOT ''known'' AND
          json_type(resource.resource_json, ''$.status.value'') IS NOT ''null'') OR
        (resource.resource_type = ''model'' AND
          json_extract(resource.resource_json, ''$.model_id'') IS NOT resource.resource_id) OR
        (resource.resource_type = ''offering'' AND (
          json_extract(resource.resource_json, ''$.offering_id'') IS NOT resource.resource_id OR
          (json_type(resource.resource_json, ''$.stale'') IS NOT ''true'' AND
            json_type(resource.resource_json, ''$.stale'') IS NOT ''false'')
        )) OR
        (resource.resource_type = ''provider'' AND
          json_extract(resource.resource_json, ''$.provider_id'') IS NOT resource.resource_id)
      )
  ) THEN RAISE(ABORT, ''publication readiness lacks an exact dataset metadata summary'') END;
END'),
    ('publication_dataset_metadata_summary_switch_guard', 'CREATE TRIGGER publication_dataset_metadata_summary_switch_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_dataset_metadata_summary AS summary
    JOIN publication_closure_seal AS seal USING (publication_id)
    JOIN publication AS candidate USING (publication_id)
    WHERE summary.publication_id = NEW.to_publication_id
      AND summary.summary_version = ''1.0.0''
      AND summary.closure_hash = NEW.to_closure_hash
      AND summary.closure_hash = candidate.closure_hash
      AND summary.closure_hash = seal.closure_hash
      AND summary.source_resource_count = candidate.resource_count
      AND summary.source_resource_count = seal.resource_count
      AND summary.provider_slice_count = seal.provider_slice_count
      AND summary.provider_slice_hash = seal.provider_slice_hash
      AND summary.active_model_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.to_publication_id
          AND resource.resource_type = ''model''
          AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
          AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
      )
      AND summary.active_offering_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.to_publication_id
          AND resource.resource_type = ''offering''
          AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
          AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
          AND json_extract(resource.resource_json, ''$.stale'') = 0
      )
      AND summary.active_provider_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.to_publication_id
          AND resource.resource_type = ''provider''
          AND json_extract(resource.resource_json, ''$.status.state'') = ''known''
          AND json_extract(resource.resource_json, ''$.status.value'') = ''active''
      )
      AND summary.has_stale_provider_slices = EXISTS (
        SELECT 1 FROM publication_provider_slice
        WHERE publication_id = NEW.to_publication_id AND freshness_state = ''stale''
      )
      AND summary.has_unavailable_provider_slices = EXISTS (
        SELECT 1 FROM publication_provider_slice
        WHERE publication_id = NEW.to_publication_id AND freshness_state = ''unavailable''
      )
  ) THEN RAISE(ABORT, ''switch target lacks an exact dataset metadata summary'') END;
END'),
    ('publication_failure_codes_guard', 'CREATE TRIGGER publication_failure_codes_guard
BEFORE UPDATE OF failure_codes_json ON publication
WHEN NEW.failure_codes_json <> OLD.failure_codes_json AND NOT (
  OLD.state = ''building'' AND NEW.state = ''failed''
)
BEGIN SELECT RAISE(ABORT, ''failure codes may change only on failure transition''); END'),
    ('publication_head_closed_delete', 'CREATE TRIGGER publication_head_closed_delete
BEFORE DELETE ON publication_head
BEGIN SELECT RAISE(ABORT, ''publication head switching is not implemented''); END'),
    ('publication_headed_state_guard', 'CREATE TRIGGER publication_headed_state_guard
BEFORE UPDATE OF state ON publication
WHEN OLD.state = ''active'' AND NEW.state IN (''superseded'', ''rolled_back'')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_head WHERE active_publication_id = OLD.publication_id
  ) THEN RAISE(ABORT, ''active publication must be switched before demotion'') END;
END'),
    ('publication_identity_immutable', 'CREATE TRIGGER publication_identity_immutable
BEFORE UPDATE OF publication_id, schema_version, methodology_version, precision_normalization_version, precision_display_order_version, price_policy_version, source_policy_version, embedding_version, build_commit, source_run_id, parent_publication_id, generated_at_ms, resource_count, exact_document_count, vector_document_count, exact_index_hash, vector_index_version, closure_hash, created_at_ms ON publication
BEGIN SELECT RAISE(ABORT, ''publication identity metadata is immutable''); END'),
    ('publication_immutable_delete', 'CREATE TRIGGER publication_immutable_delete
BEFORE DELETE ON publication BEGIN SELECT RAISE(ABORT, ''publication manifest cannot be deleted''); END'),
    ('publication_inventory_chunk_immutable_delete', 'CREATE TRIGGER publication_inventory_chunk_immutable_delete
BEFORE DELETE ON publication_inventory_chunk
BEGIN SELECT RAISE(ABORT, ''publication closure row cannot be deleted''); END'),
    ('publication_inventory_chunk_immutable_update', 'CREATE TRIGGER publication_inventory_chunk_immutable_update
BEFORE UPDATE ON publication_inventory_chunk
BEGIN SELECT RAISE(ABORT, ''publication closure row is immutable''); END'),
    ('publication_inventory_chunk_insert_guard', 'CREATE TRIGGER publication_inventory_chunk_insert_guard
BEFORE INSERT ON publication_inventory_chunk
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = ''building''
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''closure rows may be staged only while building and unsealed'') END;
END'),
    ('publication_inventory_chunk_revision', 'CREATE TRIGGER publication_inventory_chunk_revision
AFTER INSERT ON publication_inventory_chunk
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_model_variant_name_search_document_immutable_delete', 'CREATE TRIGGER publication_model_variant_name_search_document_immutable_delete
BEFORE DELETE ON publication_model_variant_name_search_document
BEGIN SELECT RAISE(ABORT, ''model/variant name search document cannot be deleted''); END'),
    ('publication_model_variant_name_search_document_immutable_update', 'CREATE TRIGGER publication_model_variant_name_search_document_immutable_update
BEFORE UPDATE ON publication_model_variant_name_search_document
BEGIN SELECT RAISE(ABORT, ''model/variant name search document is immutable''); END'),
    ('publication_model_variant_name_search_document_insert_guard', 'CREATE TRIGGER publication_model_variant_name_search_document_insert_guard
BEFORE INSERT ON publication_model_variant_name_search_document
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_resource AS resource
      ON resource.publication_id = candidate.publication_id
      AND resource.resource_type = NEW.resource_type
      AND resource.resource_id = NEW.resource_id
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = ''building''
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal
        WHERE publication_id = candidate.publication_id
      )
      AND resource.content_hash = NEW.resource_content_hash
      AND CASE NEW.resource_type
        WHEN ''model'' THEN json_extract(resource.resource_json, ''$.model_id'')
        WHEN ''variant'' THEN json_extract(resource.resource_json, ''$.variant_id'')
      END = NEW.resource_id
      AND json_extract(resource.resource_json, ''$.display_name.state'') = ''known''
      AND CAST(json_extract(
        resource.resource_json,
        ''$.display_name.value''
      ) AS BLOB) = NEW.display_name_utf8
      AND json_type(resource.resource_json, ''$.display_name.observed_at'') = ''text''
      AND json_type(resource.resource_json, ''$.display_name.evidence_ids'') = ''array''
      AND json_array_length(json_extract(
        resource.resource_json,
        ''$.display_name.evidence_ids''
      )) >= 1
  ) THEN RAISE(ABORT, ''model/variant name search document does not match eligible canonical content'') END;
END'),
    ('publication_probe_receipt_immutable_delete', 'CREATE TRIGGER publication_probe_receipt_immutable_delete BEFORE DELETE ON publication_probe_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt cannot be deleted''); END'),
    ('publication_probe_receipt_immutable_update', 'CREATE TRIGGER publication_probe_receipt_immutable_update BEFORE UPDATE ON publication_probe_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt is immutable''); END'),
    ('publication_probe_receipt_insert_guard', 'CREATE TRIGGER publication_probe_receipt_insert_guard
BEFORE INSERT ON publication_probe_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = ''probes'' AND candidate.state = ''building''
  ) THEN RAISE(ABORT, ''probe receipt lacks its sealed binding'') END;
END'),
    ('publication_provider_attribution_immutable_delete', 'CREATE TRIGGER publication_provider_attribution_immutable_delete
BEFORE DELETE ON publication_provider_attribution
BEGIN SELECT RAISE(ABORT, ''publication closure row cannot be deleted''); END'),
    ('publication_provider_attribution_immutable_update', 'CREATE TRIGGER publication_provider_attribution_immutable_update
BEFORE UPDATE ON publication_provider_attribution
BEGIN SELECT RAISE(ABORT, ''publication closure row is immutable''); END'),
    ('publication_provider_attribution_insert_guard', 'CREATE TRIGGER publication_provider_attribution_insert_guard
BEFORE INSERT ON publication_provider_attribution
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = ''building''
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''closure rows may be staged only while building and unsealed'') END;
  SELECT CASE WHEN NEW.resource_type = ''provider'' AND NEW.resource_id <> NEW.provider_id
    THEN RAISE(ABORT, ''provider resource attribution must match its provider identity'') END;
END'),
    ('publication_provider_attribution_revision', 'CREATE TRIGGER publication_provider_attribution_revision
AFTER INSERT ON publication_provider_attribution
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_provider_model_id_search_document_immutable_delete', 'CREATE TRIGGER publication_provider_model_id_search_document_immutable_delete
BEFORE DELETE ON publication_provider_model_id_search_document
BEGIN SELECT RAISE(ABORT, ''provider model ID search document cannot be deleted''); END'),
    ('publication_provider_model_id_search_document_immutable_update', 'CREATE TRIGGER publication_provider_model_id_search_document_immutable_update
BEFORE UPDATE ON publication_provider_model_id_search_document
BEGIN SELECT RAISE(ABORT, ''provider model ID search document is immutable''); END'),
    ('publication_provider_model_id_search_document_insert_guard', 'CREATE TRIGGER publication_provider_model_id_search_document_insert_guard
BEFORE INSERT ON publication_provider_model_id_search_document
BEGIN
  WITH RECURSIVE utf8(bytes, position, valid) AS (
    VALUES (hex(NEW.raw_provider_model_id_utf8), 1, 1)
    UNION ALL
    SELECT bytes,
      CASE
        WHEN substr(bytes, position, 2) BETWEEN ''00'' AND ''7F'' THEN position + 2
        WHEN substr(bytes, position, 2) BETWEEN ''C2'' AND ''DF''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF'' THEN position + 4
        WHEN substr(bytes, position, 2) = ''E0''
          AND substr(bytes, position + 2, 2) BETWEEN ''A0'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN (substr(bytes, position, 2) BETWEEN ''E1'' AND ''EC''
          OR substr(bytes, position, 2) BETWEEN ''EE'' AND ''EF'')
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN substr(bytes, position, 2) = ''ED''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''9F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN substr(bytes, position, 2) = ''F0''
          AND substr(bytes, position + 2, 2) BETWEEN ''90'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        WHEN substr(bytes, position, 2) BETWEEN ''F1'' AND ''F3''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        WHEN substr(bytes, position, 2) = ''F4''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''8F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        ELSE length(bytes) + 2
      END,
      CASE
        WHEN substr(bytes, position, 2) BETWEEN ''00'' AND ''7F'' THEN 1
        WHEN substr(bytes, position, 2) BETWEEN ''C2'' AND ''DF''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''E0''
          AND substr(bytes, position + 2, 2) BETWEEN ''A0'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN (substr(bytes, position, 2) BETWEEN ''E1'' AND ''EC''
          OR substr(bytes, position, 2) BETWEEN ''EE'' AND ''EF'')
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''ED''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''9F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''F0''
          AND substr(bytes, position + 2, 2) BETWEEN ''90'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) BETWEEN ''F1'' AND ''F3''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''F4''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''8F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        ELSE 0
      END
    FROM utf8
    WHERE valid = 1 AND position <= length(bytes)
  )
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM utf8
    WHERE valid = 1 AND position = length(bytes) + 1
  ) THEN RAISE(ABORT, ''raw provider model ID must be strict UTF-8'') END;
  WITH RECURSIVE utf8(bytes, position, valid) AS (
    VALUES (hex(NEW.normalized_provider_model_id_utf8), 1, 1)
    UNION ALL
    SELECT bytes,
      CASE
        WHEN substr(bytes, position, 2) BETWEEN ''00'' AND ''7F'' THEN position + 2
        WHEN substr(bytes, position, 2) BETWEEN ''C2'' AND ''DF''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF'' THEN position + 4
        WHEN substr(bytes, position, 2) = ''E0''
          AND substr(bytes, position + 2, 2) BETWEEN ''A0'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN (substr(bytes, position, 2) BETWEEN ''E1'' AND ''EC''
          OR substr(bytes, position, 2) BETWEEN ''EE'' AND ''EF'')
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN substr(bytes, position, 2) = ''ED''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''9F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN position + 6
        WHEN substr(bytes, position, 2) = ''F0''
          AND substr(bytes, position + 2, 2) BETWEEN ''90'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        WHEN substr(bytes, position, 2) BETWEEN ''F1'' AND ''F3''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        WHEN substr(bytes, position, 2) = ''F4''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''8F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN position + 8
        ELSE length(bytes) + 2
      END,
      CASE
        WHEN substr(bytes, position, 2) BETWEEN ''00'' AND ''7F'' THEN 1
        WHEN substr(bytes, position, 2) BETWEEN ''C2'' AND ''DF''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''E0''
          AND substr(bytes, position + 2, 2) BETWEEN ''A0'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN (substr(bytes, position, 2) BETWEEN ''E1'' AND ''EC''
          OR substr(bytes, position, 2) BETWEEN ''EE'' AND ''EF'')
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''ED''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''9F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''F0''
          AND substr(bytes, position + 2, 2) BETWEEN ''90'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) BETWEEN ''F1'' AND ''F3''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        WHEN substr(bytes, position, 2) = ''F4''
          AND substr(bytes, position + 2, 2) BETWEEN ''80'' AND ''8F''
          AND substr(bytes, position + 4, 2) BETWEEN ''80'' AND ''BF''
          AND substr(bytes, position + 6, 2) BETWEEN ''80'' AND ''BF'' THEN 1
        ELSE 0
      END
    FROM utf8
    WHERE valid = 1 AND position <= length(bytes)
  )
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM utf8
    WHERE valid = 1 AND position = length(bytes) + 1
  ) THEN RAISE(ABORT, ''normalized provider model ID must be strict UTF-8'') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_resource AS offering
      ON offering.publication_id = candidate.publication_id
      AND offering.resource_type = NEW.offering_resource_type
      AND offering.resource_id = NEW.offering_id
    JOIN publication_provider_attribution AS attribution
      ON attribution.publication_id = offering.publication_id
      AND attribution.resource_type = offering.resource_type
      AND attribution.resource_id = offering.resource_id
      AND attribution.provider_id = NEW.provider_id
    JOIN publication_provider_slice AS disposition
      ON disposition.publication_id = attribution.publication_id
      AND disposition.provider_id = attribution.provider_id
    JOIN publication_resource AS target
      ON target.publication_id = candidate.publication_id
      AND target.resource_type = NEW.target_resource_type
      AND target.resource_id = NEW.target_resource_id
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = ''building''
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal
        WHERE publication_id = candidate.publication_id
      )
      AND disposition.provider_slice_id IS NOT NULL
      AND offering.content_hash = NEW.offering_content_hash
      AND json_extract(offering.resource_json, ''$.offering_id'') = NEW.offering_id
      AND json_extract(offering.resource_json, ''$.provider_id'') = NEW.provider_id
      AND json_extract(offering.resource_json, ''$.model_resource_id'') = NEW.target_resource_id
      AND CAST(json_extract(
        offering.resource_json,
        ''$.provider_model_id''
      ) AS BLOB) = NEW.raw_provider_model_id_utf8
      AND target.content_hash = NEW.target_content_hash
      AND CASE NEW.target_resource_type
        WHEN ''model'' THEN json_extract(target.resource_json, ''$.model_id'')
        WHEN ''variant'' THEN json_extract(target.resource_json, ''$.variant_id'')
      END = NEW.target_resource_id
  ) THEN RAISE(ABORT, ''provider model ID search document does not match canonical offering and target content'') END;
END'),
    ('publication_provider_model_id_search_seal_guard', 'CREATE TRIGGER publication_provider_model_id_search_seal_guard
BEFORE INSERT ON publication_closure_seal
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM publication_resource AS offering
    WHERE offering.publication_id = NEW.publication_id
      AND offering.resource_type = ''offering''
      AND NOT EXISTS (
        SELECT 1
        FROM publication_provider_model_id_search_document AS document
        WHERE document.publication_id = offering.publication_id
          AND document.offering_id = offering.resource_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document AS document
    WHERE document.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1
        FROM publication_resource AS offering
        JOIN publication_provider_attribution AS attribution
          ON attribution.publication_id = offering.publication_id
          AND attribution.resource_type = offering.resource_type
          AND attribution.resource_id = offering.resource_id
          AND attribution.provider_id = document.provider_id
        JOIN publication_provider_slice AS disposition
          ON disposition.publication_id = attribution.publication_id
          AND disposition.provider_id = attribution.provider_id
          AND disposition.provider_slice_id IS NOT NULL
        JOIN publication_resource AS target
          ON target.publication_id = offering.publication_id
          AND target.resource_type = document.target_resource_type
          AND target.resource_id = document.target_resource_id
        WHERE offering.publication_id = document.publication_id
          AND offering.resource_type = document.offering_resource_type
          AND offering.resource_id = document.offering_id
          AND offering.content_hash = document.offering_content_hash
          AND json_extract(offering.resource_json, ''$.offering_id'') = document.offering_id
          AND json_extract(offering.resource_json, ''$.provider_id'') = document.provider_id
          AND json_extract(offering.resource_json, ''$.model_resource_id'') = document.target_resource_id
          AND CAST(json_extract(
            offering.resource_json,
            ''$.provider_model_id''
          ) AS BLOB) = document.raw_provider_model_id_utf8
          AND target.content_hash = document.target_content_hash
          AND CASE document.target_resource_type
            WHEN ''model'' THEN json_extract(target.resource_json, ''$.model_id'')
            WHEN ''variant'' THEN json_extract(target.resource_json, ''$.variant_id'')
          END = document.target_resource_id
      )
  ) THEN RAISE(ABORT, ''provider model ID search projection does not close'') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type IN (''model'', ''variant'')
      AND json_extract(resource.resource_json, ''$.display_name.state'') = ''known''
      AND NOT EXISTS (
        SELECT 1
        FROM publication_model_variant_name_search_document AS document
        WHERE document.publication_id = resource.publication_id
          AND document.resource_type = resource.resource_type
          AND document.resource_id = resource.resource_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM publication_model_variant_name_search_document AS document
    WHERE document.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1
        FROM publication_resource AS resource
        WHERE resource.publication_id = document.publication_id
          AND resource.resource_type = document.resource_type
          AND resource.resource_id = document.resource_id
          AND resource.content_hash = document.resource_content_hash
          AND CASE document.resource_type
            WHEN ''model'' THEN json_extract(resource.resource_json, ''$.model_id'')
            WHEN ''variant'' THEN json_extract(resource.resource_json, ''$.variant_id'')
          END = document.resource_id
          AND json_extract(resource.resource_json, ''$.display_name.state'') = ''known''
          AND CAST(json_extract(
            resource.resource_json,
            ''$.display_name.value''
          ) AS BLOB) = document.display_name_utf8
      )
  ) THEN RAISE(ABORT, ''model/variant name search projection does not close'') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM publication_provider_slice AS disposition
    WHERE disposition.publication_id = NEW.publication_id
      AND disposition.provider_slice_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM publication_resource AS resource
        WHERE resource.publication_id = disposition.publication_id
          AND resource.resource_type = ''provider''
          AND resource.resource_id = disposition.provider_id
          AND json_extract(resource.resource_json, ''$.display_name.state'') = ''known''
      )
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_document AS document
        WHERE document.publication_id = disposition.publication_id
          AND document.provider_id = disposition.provider_id
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_provider_search_document AS document
    WHERE document.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1
        FROM publication_provider_slice AS disposition
        JOIN publication_provider_attribution AS attribution
          ON attribution.publication_id = disposition.publication_id
          AND attribution.provider_id = disposition.provider_id
          AND attribution.resource_type = ''provider''
          AND attribution.resource_id = disposition.provider_id
        JOIN publication_resource AS resource
          ON resource.publication_id = attribution.publication_id
          AND resource.resource_type = attribution.resource_type
          AND resource.resource_id = attribution.resource_id
        WHERE disposition.publication_id = document.publication_id
          AND disposition.provider_id = document.provider_id
          AND disposition.provider_slice_id IS NOT NULL
          AND resource.content_hash = document.provider_resource_content_hash
          AND json_extract(resource.resource_json, ''$.display_name.state'') = ''known''
          AND json_extract(resource.resource_json, ''$.display_name.value'') = document.display_name
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_provider_search_document AS source
    WHERE source.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_fts AS indexed
        WHERE indexed.publication_id = source.publication_id
          AND indexed.provider_id = source.provider_id
          AND indexed.display_name = source.display_name
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_provider_search_fts AS indexed
    WHERE indexed.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_document AS source
        WHERE source.publication_id = indexed.publication_id
          AND source.provider_id = indexed.provider_id
          AND source.display_name = indexed.display_name
      )
  ) OR (
    SELECT count(*) FROM publication_provider_search_document
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT count(*) FROM publication_provider_search_fts
    WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''provider search projection does not close'') END;
END')
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM expected
  LEFT JOIN sqlite_schema AS object
    ON object.type = 'trigger' AND object.name = expected.name
  WHERE expected.name NOT LIKE 'publication_model_slug_%'
  AND expected.name NOT LIKE 'publication_readiness_receipt_%'
  AND expected.name NOT LIKE 'publication_archive_receipt_%'
  AND expected.name NOT LIKE 'publication_serving_receipt_%'
  AND expected.name NOT LIKE 'publication_vector_receipt_%'
  AND expected.name NOT LIKE 'publication_probe_receipt_%'
  AND expected.name NOT LIKE 'publication_readiness_attestation_%'
  AND expected.name NOT LIKE 'publication_switch_preflight_%'
  AND expected.name NOT LIKE 'publication_switch_history_%'
  AND expected.name NOT IN (
    'publication_closure_seal_insert_guard',
    'publication_state_transition',
    'publication_head_switch_insert',
    'publication_head_switch_update',
    'publication_dataset_metadata_summary_switch_guard'
  ) AND (object.sql IS NULL OR object.sql <> expected.expected_sql)
) THEN json('') END;

-- Retained trigger inventory, continued below the project statement ceiling.
WITH expected(name, expected_sql) AS (
  VALUES
    ('publication_provider_search_document_immutable_delete', 'CREATE TRIGGER publication_provider_search_document_immutable_delete
BEFORE DELETE ON publication_provider_search_document
BEGIN SELECT RAISE(ABORT, ''provider search document cannot be deleted''); END'),
    ('publication_provider_search_document_immutable_update', 'CREATE TRIGGER publication_provider_search_document_immutable_update
BEFORE UPDATE ON publication_provider_search_document
BEGIN SELECT RAISE(ABORT, ''provider search document is immutable''); END'),
    ('publication_provider_search_document_insert_guard', 'CREATE TRIGGER publication_provider_search_document_insert_guard
BEFORE INSERT ON publication_provider_search_document
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_provider_slice AS disposition
      ON disposition.publication_id = candidate.publication_id
      AND disposition.provider_id = NEW.provider_id
    JOIN publication_provider_attribution AS attribution
      ON attribution.publication_id = disposition.publication_id
      AND attribution.provider_id = disposition.provider_id
      AND attribution.resource_type = ''provider''
      AND attribution.resource_id = disposition.provider_id
    JOIN publication_resource AS resource
      ON resource.publication_id = attribution.publication_id
      AND resource.resource_type = attribution.resource_type
      AND resource.resource_id = attribution.resource_id
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = ''building''
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal
        WHERE publication_id = candidate.publication_id
      )
      AND disposition.provider_slice_id IS NOT NULL
      AND (
        (disposition.freshness_state = ''fresh'' AND disposition.carried_forward = 0)
        OR (disposition.freshness_state = ''stale'' AND disposition.carried_forward = 1)
      )
      AND resource.content_hash = NEW.provider_resource_content_hash
      AND json_extract(resource.resource_json, ''$.provider_id'') = NEW.provider_id
      AND json_extract(resource.resource_json, ''$.display_name.state'') = ''known''
      AND json_extract(resource.resource_json, ''$.display_name.value'') = NEW.display_name
      AND json_type(resource.resource_json, ''$.display_name.observed_at'') = ''text''
      AND json_type(resource.resource_json, ''$.display_name.evidence_ids'') = ''array''
      AND json_array_length(json_extract(resource.resource_json, ''$.display_name.evidence_ids'')) >= 1
  ) THEN RAISE(ABORT, ''provider search document does not match eligible canonical provider content'') END;
END'),
    ('publication_provider_search_document_nul_insert_guard', 'CREATE TRIGGER publication_provider_search_document_nul_insert_guard
BEFORE INSERT ON publication_provider_search_document
WHEN instr(
  CAST(NEW.display_name AS BLOB),
  CAST(char(0) AS BLOB)
) > 0 OR instr(
  CAST(NEW.normalized_name AS BLOB),
  CAST(char(0) AS BLOB)
) > 0 OR EXISTS (
  SELECT 1
  FROM publication_resource AS resource
  WHERE resource.publication_id = NEW.publication_id
    AND resource.resource_type = ''provider''
    AND resource.resource_id = NEW.provider_id
    AND instr(
      CAST(json_extract(
        resource.resource_json,
        ''$.display_name.value''
      ) AS BLOB),
      CAST(char(0) AS BLOB)
    ) > 0
)
BEGIN
  SELECT RAISE(ABORT, ''provider search document contains U+0000'');
END'),
    ('publication_provider_search_fts_insert', 'CREATE TRIGGER publication_provider_search_fts_insert
AFTER INSERT ON publication_provider_search_document
BEGIN
  INSERT INTO publication_provider_search_fts(
    publication_id,
    provider_id,
    display_name
  ) VALUES (
    NEW.publication_id,
    NEW.provider_id,
    NEW.display_name
  );
END'),
    ('publication_provider_slice_building_insert', 'CREATE TRIGGER publication_provider_slice_building_insert
BEFORE INSERT ON publication_provider_slice
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.publication_id AND state = ''building''
  ) THEN RAISE(ABORT, ''provider slices may be staged only while building'') END;
END'),
    ('publication_provider_slice_immutable_delete', 'CREATE TRIGGER publication_provider_slice_immutable_delete
BEFORE DELETE ON publication_provider_slice
BEGIN SELECT RAISE(ABORT, ''publication provider slice cannot be deleted''); END'),
    ('publication_provider_slice_immutable_update', 'CREATE TRIGGER publication_provider_slice_immutable_update
BEFORE UPDATE ON publication_provider_slice
BEGIN SELECT RAISE(ABORT, ''publication provider slice is immutable''); END'),
    ('publication_provider_slice_lineage_insert', 'CREATE TRIGGER publication_provider_slice_lineage_insert
BEFORE INSERT ON publication_provider_slice
WHEN NEW.provider_slice_id IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM publication_provider_slice AS prior
    WHERE prior.provider_slice_id = NEW.provider_slice_id
      AND (
        prior.provider_id <> NEW.provider_id OR
        prior.provider_run_id <> NEW.provider_run_id
      )
  ) THEN RAISE(ABORT, ''provider slice lineage is inconsistent'') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM publication_provider_slice AS other_occurrence
    JOIN publication AS other_publication
      ON other_publication.publication_id = other_occurrence.publication_id
    JOIN publication AS current_publication
      ON current_publication.publication_id = NEW.publication_id
    WHERE other_occurrence.provider_slice_id = NEW.provider_slice_id
      AND other_publication.generated_at_ms > current_publication.generated_at_ms
  ) THEN RAISE(ABORT, ''provider slice occurrence chronology is inconsistent'') END;
  SELECT CASE WHEN NEW.carried_forward = 1 AND NOT EXISTS (
    SELECT 1
    FROM publication_provider_slice AS prior
    JOIN publication AS prior_publication
      ON prior_publication.publication_id = prior.publication_id
    JOIN publication AS current_publication
      ON current_publication.publication_id = NEW.publication_id
    WHERE prior.provider_slice_id = NEW.provider_slice_id
      AND prior.provider_id = NEW.provider_id
      AND prior.provider_run_id = NEW.provider_run_id
      AND prior_publication.state IN (''active'', ''superseded'', ''rolled_back'')
      AND prior_publication.activated_at_ms IS NOT NULL
      AND prior_publication.activated_at_ms <= current_publication.generated_at_ms
  ) THEN RAISE(ABORT, ''carried provider slice lacks a queryable prior publication'') END;
  SELECT CASE WHEN NEW.carried_forward = 0 AND EXISTS (
    SELECT 1
    FROM publication_provider_slice AS prior
    JOIN publication AS prior_publication
      ON prior_publication.publication_id = prior.publication_id
    WHERE prior.provider_slice_id = NEW.provider_slice_id
      AND prior_publication.state IN (''ready'', ''active'', ''superseded'', ''rolled_back'')
  ) THEN RAISE(ABORT, ''reused provider slice must be carried forward'') END;
END'),
    ('publication_provider_slice_metadata_immutable_delete', 'CREATE TRIGGER publication_provider_slice_metadata_immutable_delete
BEFORE DELETE ON publication_provider_slice_metadata
BEGIN SELECT RAISE(ABORT, ''publication closure row cannot be deleted''); END'),
    ('publication_provider_slice_metadata_immutable_update', 'CREATE TRIGGER publication_provider_slice_metadata_immutable_update
BEFORE UPDATE ON publication_provider_slice_metadata
BEGIN SELECT RAISE(ABORT, ''publication closure row is immutable''); END'),
    ('publication_provider_slice_metadata_insert_guard', 'CREATE TRIGGER publication_provider_slice_metadata_insert_guard
BEFORE INSERT ON publication_provider_slice_metadata
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = ''building''
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''closure rows may be staged only while building and unsealed'') END;
END'),
    ('publication_provider_slice_metadata_revision', 'CREATE TRIGGER publication_provider_slice_metadata_revision
AFTER INSERT ON publication_provider_slice_metadata
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_provider_slice_post_seal_insert_guard', 'CREATE TRIGGER publication_provider_slice_post_seal_insert_guard
BEFORE INSERT ON publication_provider_slice
WHEN EXISTS (SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id)
BEGIN SELECT RAISE(ABORT, ''sealed publication closure is immutable''); END'),
    ('publication_provider_slice_revision', 'CREATE TRIGGER publication_provider_slice_revision
AFTER INSERT ON publication_provider_slice
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_readiness_attestation_immutable_delete', 'CREATE TRIGGER publication_readiness_attestation_immutable_delete BEFORE DELETE ON publication_readiness_attestation BEGIN SELECT RAISE(ABORT, ''readiness attestation cannot be deleted''); END'),
    ('publication_readiness_attestation_immutable_update', 'CREATE TRIGGER publication_readiness_attestation_immutable_update BEFORE UPDATE ON publication_readiness_attestation BEGIN SELECT RAISE(ABORT, ''readiness attestation is immutable''); END'),
    ('publication_readiness_attestation_insert_guard', 'CREATE TRIGGER publication_readiness_attestation_insert_guard
BEFORE INSERT ON publication_readiness_attestation
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
    WHERE publication_id = NEW.publication_id
      AND raw_provider_model_id_utf8 = X''FF''
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_normalized_exact_idx
    WHERE publication_id = NEW.publication_id
      AND normalized_provider_model_id_utf8 = X''FF''
  ) THEN RAISE(ABORT, ''provider model ID exact indexes are missing malformed or unqueryable'') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = ''building''
      AND candidate.closure_hash = NEW.closure_hash
      AND seal.closure_hash = NEW.closure_hash
      AND seal.bundle_hash = NEW.bundle_hash
      AND NEW.ready_at_ms >= seal.sealed_at_ms
  ) THEN RAISE(ABORT, ''readiness attestation does not bind the sealed building publication'') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id
  ) <> 4 OR EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id
      AND (environment <> NEW.environment
        OR receipt_version <> ''4.0.0''
        OR observed_at_ms > NEW.ready_at_ms
        OR NEW.ready_at_ms - observed_at_ms > NEW.maximum_receipt_age_ms)
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = ''archive''
      AND observed_at_ms = NEW.archive_observed_at_ms
      AND receipt_hash = NEW.archive_receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = ''serving''
      AND observed_at_ms = NEW.serving_observed_at_ms
      AND receipt_hash = NEW.serving_receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = ''vectors''
      AND observed_at_ms = NEW.vector_observed_at_ms
      AND receipt_hash = NEW.vector_receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = ''probes''
      AND observed_at_ms = NEW.probes_observed_at_ms
      AND receipt_hash = NEW.probes_receipt_hash
  ) THEN RAISE(ABORT, ''readiness receipt set is incomplete stale or mismatched'') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_archive_receipt AS archive
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE archive.publication_id = NEW.publication_id
      AND archive.retained_bundle_hash = seal.bundle_hash
      AND archive.immutable = 1
  ) THEN RAISE(ABORT, ''archive receipt does not prove retained immutable closure'') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_serving_receipt AS serving
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE serving.publication_id = NEW.publication_id
      AND serving.enabled_provider_count = seal.enabled_provider_count
      AND serving.enabled_provider_scope_hash = seal.enabled_provider_scope_hash
      AND serving.provider_slice_count = seal.provider_slice_count
      AND serving.provider_slice_hash = seal.provider_slice_hash
      AND serving.provider_attribution_count = seal.provider_attribution_count
      AND serving.provider_attribution_hash = seal.provider_attribution_hash
      AND serving.resource_count = seal.resource_count
      AND serving.exact_document_count = seal.exact_document_count
      AND serving.resource_inventory_hash = seal.resource_inventory_hash
      AND serving.exact_search_inventory_hash = seal.exact_search_inventory_hash
      AND serving.fts_document_count = seal.exact_document_count
      AND serving.fts_queryable = 1
      AND serving.foreign_keys_valid = 1
      AND serving.content_hashes_valid = 1
      AND serving.unavailable_provider_isolation_valid = 1
      AND serving.provider_search_document_count = (
        SELECT count(*) FROM publication_provider_search_document
        WHERE publication_id = NEW.publication_id
      )
      AND serving.provider_search_fts_document_count = serving.provider_search_document_count
      AND serving.provider_search_fts_queryable = 1
      AND serving.provider_search_exact_parity = 1
      AND serving.model_variant_name_document_count = (
        SELECT count(*) FROM publication_model_variant_name_search_document
        WHERE publication_id = NEW.publication_id
      )
      AND serving.model_variant_name_storage_document_count = serving.model_variant_name_document_count
      AND serving.model_variant_name_storage_queryable = 1
      AND serving.model_variant_name_storage_exact_parity = 1
      AND serving.provider_model_id_document_count = (
        SELECT count(*) FROM publication_provider_model_id_search_document
        WHERE publication_id = NEW.publication_id
      )
      AND serving.provider_model_id_storage_document_count = serving.provider_model_id_document_count
      AND serving.provider_model_id_storage_queryable = 1
      AND serving.provider_model_id_storage_exact_parity = 1
  ) THEN RAISE(ABORT, ''serving receipt does not prove the sealed closure'') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_vector_receipt AS vectors
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE vectors.publication_id = NEW.publication_id
      AND vectors.vector_namespace = vectors.publication_id
      AND vectors.document_count = seal.vector_document_count
      AND vectors.verified_document_count = seal.vector_document_count
      AND vectors.vector_inventory_hash = seal.vector_inventory_hash
      AND vectors.visibility_probe_version = ''vector-visibility@1''
      AND vectors.all_ids_present = 1
      AND vectors.all_namespaces_match = 1
      AND vectors.queryable = 1
  ) THEN RAISE(ABORT, ''vector receipt does not prove queryable sealed vectors'') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_probe_receipt
    WHERE publication_id = NEW.publication_id
      AND probe_set_version = ''search-gold@4''
      AND integrity_passed = 1
      AND evidence_coverage_passed = 1
      AND exact_search_passed = 1
      AND semantic_search_passed = 1
      AND structured_filter_passed = 1
      AND neutrality_passed = 1
      AND version_isolation_passed = 1
  ) THEN RAISE(ABORT, ''probe receipt does not prove every acceptance probe'') END;

  SELECT CASE WHEN NEW.effective_valid_until_ms <> MIN(
    NEW.archive_observed_at_ms,
    NEW.serving_observed_at_ms,
    NEW.vector_observed_at_ms,
    NEW.probes_observed_at_ms
  ) + NEW.maximum_receipt_age_ms OR NEW.ready_at_ms >
    CAST(strftime(''%s'', ''now'') AS INTEGER) * 1000 + 300000
  THEN RAISE(ABORT, ''readiness validity or clock bound is invalid'') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_search_fts
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT exact_document_count FROM publication_closure_seal
    WHERE publication_id = NEW.publication_id
  ) OR EXISTS (
    SELECT 1 FROM publication_search_document AS source
    WHERE source.publication_id = NEW.publication_id
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
    WHERE indexed.publication_id = NEW.publication_id
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
  ) THEN RAISE(ABORT, ''exact search FTS does not match the sealed source rows'') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_provider_search_document AS source
    WHERE source.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_fts AS indexed
        WHERE indexed.publication_id = source.publication_id
          AND indexed.provider_id = source.provider_id
          AND indexed.display_name = source.display_name
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_provider_search_fts AS indexed
    WHERE indexed.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_document AS source
        WHERE source.publication_id = indexed.publication_id
          AND source.provider_id = indexed.provider_id
          AND source.display_name = indexed.display_name
      )
  ) OR (
    SELECT count(*) FROM publication_provider_search_fts
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT provider_search_fts_document_count
    FROM publication_serving_receipt
    WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''provider search FTS does not match the canonical projection'') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_model_variant_name_search_document
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT model_variant_name_storage_document_count
    FROM publication_serving_receipt
    WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''model/variant name storage does not match the canonical projection'') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_provider_model_id_search_document
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT provider_model_id_storage_document_count
    FROM publication_serving_receipt
    WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''provider model ID storage does not match the canonical projection'') END;

END'),
    ('publication_readiness_receipt_immutable_delete', 'CREATE TRIGGER publication_readiness_receipt_immutable_delete BEFORE DELETE ON publication_readiness_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt cannot be deleted''); END'),
    ('publication_readiness_receipt_immutable_update', 'CREATE TRIGGER publication_readiness_receipt_immutable_update BEFORE UPDATE ON publication_readiness_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt is immutable''); END'),
    ('publication_readiness_receipt_insert_guard', 'CREATE TRIGGER publication_readiness_receipt_insert_guard
BEFORE INSERT ON publication_readiness_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = ''building''
      AND candidate.closure_hash = NEW.closure_hash
      AND candidate.schema_version = NEW.schema_version
      AND candidate.build_commit = NEW.build_commit
      AND seal.closure_hash = NEW.closure_hash
      AND seal.bundle_hash = NEW.bundle_hash
      AND NEW.observed_at_ms >= seal.sealed_at_ms
  ) THEN RAISE(ABORT, ''readiness receipt does not bind the sealed building publication'') END;
END'),
    ('publication_ready_timestamp_guard', 'CREATE TRIGGER publication_ready_timestamp_guard
BEFORE UPDATE OF ready_at_ms ON publication
WHEN NOT (NEW.ready_at_ms IS OLD.ready_at_ms) AND NOT (
  OLD.state = ''building'' AND NEW.state = ''ready'' AND
  OLD.ready_at_ms IS NULL AND NEW.ready_at_ms IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, ''ready timestamp may change only on readiness transition''); END'),
    ('publication_resource_building_insert', 'CREATE TRIGGER publication_resource_building_insert
BEFORE INSERT ON publication_resource
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.publication_id AND state = ''building''
  ) THEN RAISE(ABORT, ''publication resources may be staged only while building'') END;
END'),
    ('publication_resource_immutable_delete', 'CREATE TRIGGER publication_resource_immutable_delete
BEFORE DELETE ON publication_resource BEGIN SELECT RAISE(ABORT, ''publication resource cannot be deleted''); END'),
    ('publication_resource_immutable_update', 'CREATE TRIGGER publication_resource_immutable_update
BEFORE UPDATE ON publication_resource BEGIN SELECT RAISE(ABORT, ''publication resource is immutable''); END'),
    ('publication_resource_post_seal_insert_guard', 'CREATE TRIGGER publication_resource_post_seal_insert_guard
BEFORE INSERT ON publication_resource
WHEN EXISTS (SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id)
BEGIN SELECT RAISE(ABORT, ''sealed publication closure is immutable''); END'),
    ('publication_resource_revision', 'CREATE TRIGGER publication_resource_revision
AFTER INSERT ON publication_resource
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_resource_type_insert', 'CREATE TRIGGER publication_resource_type_insert
BEFORE INSERT ON publication_resource
BEGIN
  SELECT CASE WHEN NOT (
    (NEW.resource_type = ''model_family'' AND substr(NEW.resource_id, 1, 4) = ''fam_'') OR
    (NEW.resource_type = ''model'' AND substr(NEW.resource_id, 1, 4) = ''mdl_'') OR
    (NEW.resource_type = ''variant'' AND substr(NEW.resource_id, 1, 4) = ''var_'') OR
    (NEW.resource_type = ''provider'' AND substr(NEW.resource_id, 1, 4) = ''prv_'') OR
    (NEW.resource_type = ''offering'' AND substr(NEW.resource_id, 1, 4) = ''off_'') OR
    (NEW.resource_type = ''price'' AND substr(NEW.resource_id, 1, 4) = ''pcs_'') OR
    (NEW.resource_type = ''precision_observation'' AND substr(NEW.resource_id, 1, 4) = ''prc_'') OR
    (NEW.resource_type = ''evidence_summary'' AND substr(NEW.resource_id, 1, 4) = ''evd_'')
  ) THEN RAISE(ABORT, ''publication resource type and ID prefix disagree'') END;
END'),
    ('publication_search_building_insert', 'CREATE TRIGGER publication_search_building_insert
BEFORE INSERT ON publication_search_document
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.publication_id AND state = ''building''
  ) THEN RAISE(ABORT, ''search documents may be staged only while building'') END;
END'),
    ('publication_search_fts_insert', 'CREATE TRIGGER publication_search_fts_insert
AFTER INSERT ON publication_search_document
BEGIN
  INSERT INTO publication_search_fts(
    publication_id,
    document_id,
    normalized_name,
    aliases,
    publisher_name,
    provider_model_ids,
    document_text
  ) VALUES (
    NEW.publication_id,
    NEW.document_id,
    NEW.normalized_name,
    NEW.aliases_json,
    NEW.publisher_name,
    NEW.provider_model_ids_json,
    NEW.document_text
  );
END'),
    ('publication_search_immutable_delete', 'CREATE TRIGGER publication_search_immutable_delete
BEFORE DELETE ON publication_search_document BEGIN SELECT RAISE(ABORT, ''publication search document cannot be deleted''); END'),
    ('publication_search_immutable_update', 'CREATE TRIGGER publication_search_immutable_update
BEFORE UPDATE ON publication_search_document BEGIN SELECT RAISE(ABORT, ''publication search document is immutable''); END'),
    ('publication_search_post_seal_insert_guard', 'CREATE TRIGGER publication_search_post_seal_insert_guard
BEFORE INSERT ON publication_search_document
WHEN EXISTS (SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id)
BEGIN SELECT RAISE(ABORT, ''sealed publication closure is immutable''); END'),
    ('publication_search_revision', 'CREATE TRIGGER publication_search_revision
AFTER INSERT ON publication_search_document
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_search_type_insert', 'CREATE TRIGGER publication_search_type_insert
BEFORE INSERT ON publication_search_document
BEGIN
  SELECT CASE WHEN NOT (
    (NEW.resource_type = ''model'' AND substr(NEW.resource_id, 1, 4) = ''mdl_'') OR
    (NEW.resource_type = ''variant'' AND substr(NEW.resource_id, 1, 4) = ''var_'')
  ) THEN RAISE(ABORT, ''search document type and ID prefix disagree'') END;
END'),
    ('publication_serving_receipt_immutable_delete', 'CREATE TRIGGER publication_serving_receipt_immutable_delete BEFORE DELETE ON publication_serving_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt cannot be deleted''); END'),
    ('publication_serving_receipt_immutable_update', 'CREATE TRIGGER publication_serving_receipt_immutable_update BEFORE UPDATE ON publication_serving_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt is immutable''); END'),
    ('publication_serving_receipt_insert_guard', 'CREATE TRIGGER publication_serving_receipt_insert_guard
BEFORE INSERT ON publication_serving_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = ''serving'' AND candidate.state = ''building''
  ) THEN RAISE(ABORT, ''serving receipt lacks its sealed binding'') END;
END'),
    ('publication_staging_revision_immutable_delete', 'CREATE TRIGGER publication_staging_revision_immutable_delete
BEFORE DELETE ON publication_staging_revision
BEGIN SELECT RAISE(ABORT, ''publication staging revision cannot be deleted''); END'),
    ('publication_staging_revision_immutable_update', 'CREATE TRIGGER publication_staging_revision_immutable_update
BEFORE UPDATE ON publication_staging_revision
WHEN NEW.publication_id <> OLD.publication_id
  OR NEW.revision <> OLD.revision + 1
  OR NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = OLD.publication_id AND state = ''building''
  )
  OR EXISTS (
  SELECT 1 FROM publication_closure_seal WHERE publication_id = OLD.publication_id
)
BEGIN SELECT RAISE(ABORT, ''publication staging revision is trigger-managed''); END'),
    ('publication_staging_revision_seed', 'CREATE TRIGGER publication_staging_revision_seed
AFTER INSERT ON publication
BEGIN
  INSERT INTO publication_staging_revision(publication_id, revision)
  VALUES (NEW.publication_id, 0);
END'),
    ('publication_switch_history_apply', 'CREATE TRIGGER publication_switch_history_apply
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
END'),
    ('publication_switch_history_immutable_delete', 'CREATE TRIGGER publication_switch_history_immutable_delete
BEFORE DELETE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, ''switch history cannot be deleted''); END'),
    ('publication_switch_history_immutable_update', 'CREATE TRIGGER publication_switch_history_immutable_update
BEFORE UPDATE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, ''switch history is append-only''); END'),
    ('publication_switch_history_insert_guard', 'CREATE TRIGGER publication_switch_history_insert_guard
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

END'),
    ('publication_switch_history_provider_eligibility_index_guard', 'CREATE TRIGGER publication_switch_history_provider_eligibility_index_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM pragma_index_list(''publication_provider_model_id_search_document'')
    WHERE name = ''publication_provider_model_id_eligibility_idx''
      AND "unique" = 0 AND origin = ''c'' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*)
    FROM pragma_index_xinfo(''publication_provider_model_id_eligibility_idx'')
    WHERE key = 1
    HAVING count(*) = 5 AND sum(CASE
      WHEN seqno = 0 AND cid = 0 AND name = ''publication_id'' AND desc = 0 AND coll = ''BINARY'' THEN 1
      WHEN seqno = 1 AND cid = 3 AND name = ''provider_id'' AND desc = 0 AND coll = ''BINARY'' THEN 1
      WHEN seqno = 2 AND cid = 4 AND name = ''target_resource_type'' AND desc = 0 AND coll = ''BINARY'' THEN 1
      WHEN seqno = 3 AND cid = 5 AND name = ''target_resource_id'' AND desc = 0 AND coll = ''BINARY'' THEN 1
      WHEN seqno = 4 AND cid = 2 AND name = ''offering_id'' AND desc = 0 AND coll = ''BINARY'' THEN 1
      ELSE 0 END) = 5
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_eligibility_idx
    WHERE publication_id = NEW.to_publication_id
      AND provider_id = ''prv_ffffffff-ffff-4fff-bfff-ffffffffffff''
      -- This value is impossible under the projection table CHECK, so a
      -- legitimate all-ffff tuple can never be mistaken for probe failure.
      AND target_resource_type = ''__queryability_probe__''
      AND target_resource_id = ''mdl_ffffffff-ffff-4fff-bfff-ffffffffffff''
      AND offering_id = ''off_ffffffff-ffff-4fff-bfff-ffffffffffff''
  ) THEN RAISE(ABORT, ''switch-time provider eligibility index is missing malformed or unqueryable'') END;
END'),
    ('publication_switch_history_target_eligibility_index_guard', 'CREATE TRIGGER publication_switch_history_target_eligibility_index_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM pragma_index_list(''publication_provider_model_id_search_document'')
    WHERE name = ''publication_provider_model_id_target_eligibility_idx''
      AND "unique" = 0 AND origin = ''c'' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*)
    FROM pragma_index_xinfo(
      ''publication_provider_model_id_target_eligibility_idx''
    )
    WHERE key = 1
    HAVING count(*) = 4 AND sum(CASE
      WHEN seqno = 0 AND cid = 0 AND name = ''publication_id'' AND desc = 0 AND coll = ''BINARY'' THEN 1
      WHEN seqno = 1 AND cid = 4 AND name = ''target_resource_type'' AND desc = 0 AND coll = ''BINARY'' THEN 1
      WHEN seqno = 2 AND cid = 5 AND name = ''target_resource_id'' AND desc = 0 AND coll = ''BINARY'' THEN 1
      WHEN seqno = 3 AND cid = 2 AND name = ''offering_id'' AND desc = 0 AND coll = ''BINARY'' THEN 1
      ELSE 0 END) = 4
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_target_eligibility_idx
    WHERE publication_id = NEW.to_publication_id
      AND target_resource_type = ''__queryability_probe__''
      AND target_resource_id = ''mdl_ffffffff-ffff-4fff-bfff-ffffffffffff''
      AND offering_id = ''off_ffffffff-ffff-4fff-bfff-ffffffffffff''
  ) THEN RAISE(ABORT, ''switch-time target eligibility index is missing malformed or unqueryable'') END;
END'),
    ('publication_switch_preflight_immutable_delete', 'CREATE TRIGGER publication_switch_preflight_immutable_delete
BEFORE DELETE ON publication_switch_preflight
BEGIN SELECT RAISE(ABORT, ''switch preflight cannot be deleted''); END'),
    ('publication_switch_preflight_immutable_update', 'CREATE TRIGGER publication_switch_preflight_immutable_update
BEFORE UPDATE ON publication_switch_preflight
BEGIN SELECT RAISE(ABORT, ''switch preflight is immutable''); END'),
    ('publication_switch_preflight_insert_guard', 'CREATE TRIGGER publication_switch_preflight_insert_guard
BEFORE INSERT ON publication_switch_preflight
BEGIN
  SELECT CASE WHEN NEW.observed_at_ms > NEW.switched_at_ms
    OR NEW.observed_at_ms < (SELECT sealed_at_ms FROM publication_closure_seal WHERE publication_id = NEW.to_publication_id)
    OR CAST(strftime(''%s'', ''now'') AS INTEGER) * 1000 > NEW.valid_until_ms
    OR NEW.observed_at_ms > CAST(strftime(''%s'', ''now'') AS INTEGER) * 1000 + 300000
    OR NEW.switched_at_ms < CAST(strftime(''%s'', ''now'') AS INTEGER) * 1000 - 300000
    OR NEW.switched_at_ms > CAST(strftime(''%s'', ''now'') AS INTEGER) * 1000 + 300000
    THEN RAISE(ABORT, ''switch preflight is stale or outside the database clock bound'') END;

  SELECT CASE WHEN NOT (
    (NEW.expected_prior_generation = 0
      AND NEW.new_generation = 1
      AND NEW.from_publication_id IS NULL
      AND NEW.expected_prior_rollback_candidate_publication_id IS NULL
      AND NEW.expected_prior_switched_at_ms IS NULL
      AND NEW.action = ''activate''
      AND NOT EXISTS (SELECT 1 FROM publication_head))
    OR (NEW.expected_prior_generation >= 1 AND EXISTS (
      SELECT 1 FROM publication_head AS head
      JOIN publication AS current ON current.publication_id = head.active_publication_id
      WHERE head.singleton = 1
        AND head.generation = NEW.expected_prior_generation
        AND head.active_publication_id = NEW.from_publication_id
        AND head.rollback_candidate_publication_id IS NEW.expected_prior_rollback_candidate_publication_id
        AND head.switched_at_ms = NEW.expected_prior_switched_at_ms
        AND head.switched_at_ms < NEW.switched_at_ms
        AND current.state = ''active''
        AND current.closure_hash = NEW.from_closure_hash
    ))
  ) THEN RAISE(ABORT, ''switch preflight does not match the exact head generation'') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication AS target
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
      AND NEW.provider_search_document_count = (
        SELECT count(*) FROM publication_provider_search_document
        WHERE publication_id = NEW.to_publication_id
      )
      AND NEW.provider_search_fts_document_count = NEW.provider_search_document_count
      AND NEW.provider_search_fts_document_count = (
        SELECT count(*) FROM publication_provider_search_fts
        WHERE publication_id = NEW.to_publication_id
      )
      AND NEW.provider_search_fts_queryable = 1
      AND NEW.provider_search_exact_parity = 1
      AND NEW.model_variant_name_document_count = (
        SELECT count(*) FROM publication_model_variant_name_search_document
        WHERE publication_id = NEW.to_publication_id
      )
      AND NEW.model_variant_name_storage_document_count = NEW.model_variant_name_document_count
      AND NEW.model_variant_name_storage_queryable = 1
      AND NEW.model_variant_name_storage_exact_parity = 1
      AND NEW.provider_model_id_document_count = (
        SELECT count(*) FROM publication_provider_model_id_search_document
        WHERE publication_id = NEW.to_publication_id
      )
      AND NEW.provider_model_id_storage_document_count = NEW.provider_model_id_document_count
      AND NEW.provider_model_id_storage_queryable = 1
      AND NEW.provider_model_id_storage_exact_parity = 1
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
  ) THEN RAISE(ABORT, ''switch preflight does not prove the sealed serving artifacts'') END;

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
  ) THEN RAISE(ABORT, ''switch preflight FTS does not exactly match its sealed source'') END;

  SELECT CASE WHEN EXISTS (
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
  ) THEN RAISE(ABORT, ''switch preflight provider FTS does not exactly match its source'') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_model_variant_name_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> NEW.model_variant_name_storage_document_count
  THEN RAISE(ABORT, ''switch preflight model/variant name storage changed'') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_provider_model_id_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> NEW.provider_model_id_storage_document_count
  THEN RAISE(ABORT, ''switch preflight provider model ID storage changed'') END;

  SELECT CASE WHEN NEW.action = ''activate'' AND NOT EXISTS (
    SELECT 1 FROM publication AS target
    JOIN publication_readiness_attestation AS attestation USING (publication_id)
    WHERE target.publication_id = NEW.to_publication_id
      AND target.state = ''ready''
      AND target.ready_at_ms = attestation.ready_at_ms
      AND attestation.environment = NEW.environment
      AND attestation.closure_hash = NEW.to_closure_hash
      AND attestation.attestation_hash = NEW.to_attestation_hash
      AND NEW.switched_at_ms <= attestation.effective_valid_until_ms
      AND CAST(strftime(''%s'', ''now'') AS INTEGER) * 1000 <= attestation.effective_valid_until_ms
  ) THEN RAISE(ABORT, ''activation lacks a fresh exact readiness attestation'') END;

  SELECT CASE WHEN NEW.action = ''rollback'' AND NOT EXISTS (
    SELECT 1 FROM publication_head AS head
    JOIN publication AS target ON target.publication_id = NEW.to_publication_id
    WHERE head.singleton = 1
      AND head.rollback_candidate_publication_id = target.publication_id
      AND target.state = ''superseded''
  ) THEN RAISE(ABORT, ''rollback target is not the immediate superseded publication'') END;
END'),
    ('publication_vector_inventory_immutable_delete', 'CREATE TRIGGER publication_vector_inventory_immutable_delete
BEFORE DELETE ON publication_vector_inventory
BEGIN SELECT RAISE(ABORT, ''publication closure row cannot be deleted''); END'),
    ('publication_vector_inventory_immutable_update', 'CREATE TRIGGER publication_vector_inventory_immutable_update
BEFORE UPDATE ON publication_vector_inventory
BEGIN SELECT RAISE(ABORT, ''publication closure row is immutable''); END'),
    ('publication_vector_inventory_insert_guard', 'CREATE TRIGGER publication_vector_inventory_insert_guard
BEFORE INSERT ON publication_vector_inventory
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = ''building''
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, ''closure rows may be staged only while building and unsealed'') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_search_document
    WHERE publication_id = NEW.publication_id
      AND document_id = NEW.vector_id
      AND resource_type = NEW.resource_type
      AND resource_id = NEW.resource_id
      AND content_hash = NEW.search_document_content_hash
  ) THEN RAISE(ABORT, ''vector inventory does not match its search document'') END;
END'),
    ('publication_vector_inventory_revision', 'CREATE TRIGGER publication_vector_inventory_revision
AFTER INSERT ON publication_vector_inventory
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END'),
    ('publication_vector_receipt_immutable_delete', 'CREATE TRIGGER publication_vector_receipt_immutable_delete BEFORE DELETE ON publication_vector_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt cannot be deleted''); END'),
    ('publication_vector_receipt_immutable_update', 'CREATE TRIGGER publication_vector_receipt_immutable_update BEFORE UPDATE ON publication_vector_receipt BEGIN SELECT RAISE(ABORT, ''readiness receipt is immutable''); END'),
    ('publication_vector_receipt_insert_guard', 'CREATE TRIGGER publication_vector_receipt_insert_guard
BEFORE INSERT ON publication_vector_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = ''vectors'' AND candidate.state = ''building''
  ) THEN RAISE(ABORT, ''vector receipt lacks its sealed binding'') END;
END')
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM expected
  LEFT JOIN sqlite_schema AS object
    ON object.type = 'trigger' AND object.name = expected.name
  WHERE expected.name NOT LIKE 'publication_model_slug_%'
  AND expected.name NOT LIKE 'publication_readiness_receipt_%'
  AND expected.name NOT LIKE 'publication_archive_receipt_%'
  AND expected.name NOT LIKE 'publication_serving_receipt_%'
  AND expected.name NOT LIKE 'publication_vector_receipt_%'
  AND expected.name NOT LIKE 'publication_probe_receipt_%'
  AND expected.name NOT LIKE 'publication_readiness_attestation_%'
  AND expected.name NOT LIKE 'publication_switch_preflight_%'
  AND expected.name NOT LIKE 'publication_switch_history_%'
  AND expected.name NOT IN (
    'publication_closure_seal_insert_guard',
    'publication_state_transition',
    'publication_head_switch_insert',
    'publication_head_switch_update',
    'publication_dataset_metadata_summary_switch_guard'
  ) AND (object.sql IS NULL OR object.sql <> expected.expected_sql)
) THEN json('') END;


-- Inventory-complete exact identity for every retained named index.
WITH expected(name, expected_sql) AS (
  VALUES
    ('publication_chunk_kind_idx', 'CREATE INDEX publication_chunk_kind_idx
ON publication_inventory_chunk(publication_id, kind, ordinal)'),
    ('publication_model_variant_name_exact_idx', 'CREATE INDEX publication_model_variant_name_exact_idx
ON publication_model_variant_name_search_document(
  publication_id,
  normalized_name_utf8,
  resource_id
)'),
    ('publication_provider_attribution_provider_idx', 'CREATE INDEX publication_provider_attribution_provider_idx
ON publication_provider_attribution(publication_id, provider_id, resource_type, resource_id)'),
    ('publication_provider_model_id_eligibility_idx', 'CREATE INDEX publication_provider_model_id_eligibility_idx
ON publication_provider_model_id_search_document(
  publication_id,
  provider_id,
  target_resource_type,
  target_resource_id,
  offering_id
)'),
    ('publication_provider_model_id_normalized_exact_idx', 'CREATE INDEX publication_provider_model_id_normalized_exact_idx
ON publication_provider_model_id_search_document(
  publication_id,
  normalized_provider_model_id_utf8,
  offering_id
)'),
    ('publication_provider_model_id_raw_exact_idx', 'CREATE INDEX publication_provider_model_id_raw_exact_idx
ON publication_provider_model_id_search_document(
  publication_id,
  raw_provider_model_id_utf8,
  offering_id
)'),
    ('publication_provider_model_id_target_eligibility_idx', 'CREATE INDEX publication_provider_model_id_target_eligibility_idx
ON publication_provider_model_id_search_document(
  publication_id,
  target_resource_type,
  target_resource_id,
  offering_id
)'),
    ('publication_provider_search_exact_idx', 'CREATE INDEX publication_provider_search_exact_idx
ON publication_provider_search_document(
  publication_id,
  normalized_name,
  provider_id
)'),
    ('publication_provider_slice_identity_idx', 'CREATE INDEX publication_provider_slice_identity_idx
ON publication_provider_slice(provider_slice_id)
WHERE provider_slice_id IS NOT NULL'),
    ('publication_resource_lookup_idx', 'CREATE INDEX publication_resource_lookup_idx ON publication_resource(publication_id, resource_type, resource_id)'),
    ('publication_search_resource_idx', 'CREATE INDEX publication_search_resource_idx ON publication_search_document(publication_id, resource_type, resource_id)'),
    ('publication_switch_history_from_retained_hot_idx', 'CREATE INDEX publication_switch_history_from_retained_hot_idx
ON publication_switch_history(
  from_publication_id,
  switched_at_ms DESC,
  new_generation DESC
)
WHERE from_publication_id IS NOT NULL'),
    ('publication_switch_history_prior_rollback_retained_hot_idx', 'CREATE INDEX publication_switch_history_prior_rollback_retained_hot_idx
ON publication_switch_history(
  expected_prior_rollback_candidate_publication_id,
  switched_at_ms DESC,
  new_generation DESC
)
WHERE expected_prior_rollback_candidate_publication_id IS NOT NULL'),
    ('publication_switch_preflight_generation_idx', 'CREATE INDEX publication_switch_preflight_generation_idx
ON publication_switch_preflight(new_generation, action)'),
    ('publication_vector_resource_idx', 'CREATE INDEX publication_vector_resource_idx
ON publication_vector_inventory(publication_id, resource_type, resource_id)')
)
SELECT CASE WHEN (SELECT count(*) FROM expected) <> 15 OR EXISTS (
  SELECT 1 FROM expected
  LEFT JOIN sqlite_schema AS object
    ON object.type = 'index' AND object.name = expected.name
  WHERE object.sql IS NULL OR object.sql <> expected.expected_sql
) THEN json('') END;


-- The v5 readiness and switch guards force these four retained provider-ID
-- access paths with INDEXED BY. Close flags and every key position before
-- installing a guard that would otherwise inherit a lookalike index.
SELECT CASE WHEN (
  SELECT count(*) FROM pragma_index_list(
    'publication_provider_model_id_search_document'
  )
  WHERE name IN (
    'publication_provider_model_id_raw_exact_idx',
    'publication_provider_model_id_normalized_exact_idx',
    'publication_provider_model_id_eligibility_idx',
    'publication_provider_model_id_target_eligibility_idx'
  ) AND "unique" = 0 AND origin = 'c' AND partial = 0
) <> 4 OR NOT EXISTS (
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
  FROM pragma_index_xinfo(
    'publication_provider_model_id_normalized_exact_idx'
  )
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
) THEN json('') END;

-- FTS tokenization is serving semantics, not an implementation detail.
SELECT CASE WHEN (
  SELECT sql FROM sqlite_schema
  WHERE type = 'table' AND name = 'publication_search_fts'
) <> 'CREATE VIRTUAL TABLE publication_search_fts USING fts5(
  publication_id UNINDEXED,
  document_id UNINDEXED,
  normalized_name,
  aliases,
  publisher_name,
  provider_model_ids,
  document_text,
  tokenize = ''unicode61 remove_diacritics 2''
)' OR (
  SELECT sql FROM sqlite_schema
  WHERE type = 'table' AND name = 'publication_provider_search_fts'
) <> 'CREATE VIRTUAL TABLE publication_provider_search_fts USING fts5(
  publication_id UNINDEXED,
  provider_id UNINDEXED,
  display_name,
  tokenize = ''unicode61 remove_diacritics 2''
)' THEN json('') END;

-- Reject a forged schema marker or drifted v4 lifecycle. Column counts, exact
-- accepted versions, and all authoritative lifecycle objects must match 1.12.
SELECT CASE WHEN (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name IN (
    'publication_readiness_receipt',
    'publication_archive_receipt',
    'publication_serving_receipt',
    'publication_vector_receipt',
    'publication_probe_receipt',
    'publication_readiness_attestation',
    'publication_switch_preflight',
    'publication_switch_history'
  )
) <> 8 OR (
  SELECT count(*) FROM pragma_table_info('publication_readiness_receipt')
) <> 10 OR (
  SELECT count(*) FROM pragma_table_info('publication_archive_receipt')
) <> 4 OR (
  SELECT count(*) FROM pragma_table_info('publication_serving_receipt')
) <> 39 OR (
  SELECT count(*) FROM pragma_table_info('publication_vector_receipt')
) <> 11 OR (
  SELECT count(*) FROM pragma_table_info('publication_probe_receipt')
) <> 10 OR (
  SELECT count(*) FROM pragma_table_info('publication_readiness_attestation')
) <> 17 OR (
  SELECT count(*) FROM pragma_table_info('publication_switch_preflight')
) <> 62 OR (
  SELECT count(*) FROM pragma_table_info('publication_switch_history')
) <> 18 OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info('publication_readiness_receipt')
    ORDER BY cid
  )
) <> 'publication_id|kind|receipt_version|receipt_hash|environment|closure_hash|bundle_hash|schema_version|build_commit|observed_at_ms' OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info('publication_archive_receipt')
    ORDER BY cid
  )
) <> 'publication_id|kind|retained_bundle_hash|immutable' OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info('publication_serving_receipt')
    ORDER BY cid
  )
) <> 'publication_id|kind|enabled_provider_count|enabled_provider_scope_hash|provider_slice_count|provider_slice_hash|provider_attribution_count|provider_attribution_hash|resource_count|exact_document_count|resource_inventory_hash|exact_search_inventory_hash|fts_build_version|fts_document_count|fts_queryable|foreign_keys_valid|content_hashes_valid|unavailable_provider_isolation_valid|provider_search_projection_version|provider_search_document_count|provider_search_inventory_hash|provider_search_fts_build_version|provider_search_fts_document_count|provider_search_fts_queryable|provider_search_exact_parity|model_variant_name_projection_version|model_variant_name_document_count|model_variant_name_inventory_hash|model_variant_name_storage_version|model_variant_name_storage_document_count|model_variant_name_storage_queryable|model_variant_name_storage_exact_parity|provider_model_id_projection_version|provider_model_id_document_count|provider_model_id_inventory_hash|provider_model_id_storage_version|provider_model_id_storage_document_count|provider_model_id_storage_queryable|provider_model_id_storage_exact_parity' OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info('publication_vector_receipt')
    ORDER BY cid
  )
) <> 'publication_id|kind|vector_namespace|document_count|verified_document_count|vector_inventory_hash|visibility_probe_version|mutation_id|all_ids_present|all_namespaces_match|queryable' OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info('publication_probe_receipt')
    ORDER BY cid
  )
) <> 'publication_id|kind|probe_set_version|integrity_passed|evidence_coverage_passed|exact_search_passed|semantic_search_passed|structured_filter_passed|neutrality_passed|version_isolation_passed' OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info('publication_readiness_attestation')
    ORDER BY cid
  )
) <> 'publication_id|environment|closure_hash|bundle_hash|evaluator_version|ready_at_ms|maximum_receipt_age_ms|effective_valid_until_ms|archive_observed_at_ms|serving_observed_at_ms|vector_observed_at_ms|probes_observed_at_ms|archive_receipt_hash|serving_receipt_hash|vector_receipt_hash|probes_receipt_hash|attestation_hash' OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info('publication_switch_preflight')
    ORDER BY cid
  )
) <> 'switch_id|preflight_version|preflight_hash|action|environment|expected_prior_generation|expected_prior_rollback_candidate_publication_id|expected_prior_switched_at_ms|new_generation|from_publication_id|from_closure_hash|to_publication_id|to_closure_hash|to_attestation_hash|switched_at_ms|observed_at_ms|maximum_age_ms|valid_until_ms|fts_build_version|fts_source_document_count|fts_index_document_count|fts_source_inventory_hash|fts_exact_parity|archive_bundle_hash|archive_immutable|vector_namespace|vector_document_count|vector_verified_document_count|vector_inventory_hash|vector_visibility_probe_version|vector_mutation_id|vector_all_ids_present|vector_all_namespaces_match|vector_queryable|probe_set_version|integrity_passed|exact_search_passed|semantic_search_passed|structured_filter_passed|neutrality_passed|version_isolation_passed|provider_search_projection_version|provider_search_document_count|provider_search_inventory_hash|provider_search_fts_build_version|provider_search_fts_document_count|provider_search_fts_queryable|provider_search_exact_parity|model_variant_name_projection_version|model_variant_name_document_count|model_variant_name_inventory_hash|model_variant_name_storage_version|model_variant_name_storage_document_count|model_variant_name_storage_queryable|model_variant_name_storage_exact_parity|provider_model_id_projection_version|provider_model_id_document_count|provider_model_id_inventory_hash|provider_model_id_storage_version|provider_model_id_storage_document_count|provider_model_id_storage_queryable|provider_model_id_storage_exact_parity' OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info('publication_switch_history')
    ORDER BY cid
  )
) <> 'switch_id|event_version|event_hash|preflight_hash|action|expected_prior_generation|expected_prior_rollback_candidate_publication_id|expected_prior_switched_at_ms|new_generation|from_publication_id|from_closure_hash|to_publication_id|to_closure_hash|to_attestation_hash|resulting_rollback_candidate_publication_id|switched_at_ms|authorized_by_kind|authorized_identity_id' OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name = 'publication_readiness_receipt'
    AND instr(lower(sql), 'receipt_version = ''4.0.0''') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name = 'publication_readiness_attestation'
    AND instr(lower(sql), 'evaluator_version = ''4.0.0''') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name = 'publication_probe_receipt'
    AND instr(lower(sql), 'probe_set_version = ''search-gold@4''') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name = 'publication_switch_preflight'
    AND instr(lower(sql), 'preflight_version = ''4.0.0''') > 0
    AND instr(lower(sql), 'provider_model_id_storage_exact_parity') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name = 'publication_switch_history'
    AND instr(lower(sql), 'event_version = ''1.0.0''') > 0
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name IN (
    'publication_readiness_receipt_insert_guard',
    'publication_archive_receipt_insert_guard',
    'publication_serving_receipt_insert_guard',
    'publication_vector_receipt_insert_guard',
    'publication_probe_receipt_insert_guard',
    'publication_readiness_attestation_insert_guard',
    'publication_readiness_receipt_immutable_update',
    'publication_readiness_receipt_immutable_delete',
    'publication_archive_receipt_immutable_update',
    'publication_archive_receipt_immutable_delete',
    'publication_serving_receipt_immutable_update',
    'publication_serving_receipt_immutable_delete',
    'publication_vector_receipt_immutable_update',
    'publication_vector_receipt_immutable_delete',
    'publication_probe_receipt_immutable_update',
    'publication_probe_receipt_immutable_delete',
    'publication_readiness_attestation_immutable_update',
    'publication_readiness_attestation_immutable_delete',
    'publication_switch_preflight_insert_guard',
    'publication_switch_preflight_immutable_update',
    'publication_switch_preflight_immutable_delete',
    'publication_switch_history_insert_guard',
    'publication_switch_history_apply',
    'publication_switch_history_immutable_update',
    'publication_switch_history_immutable_delete',
    'publication_state_transition',
    'publication_head_switch_insert',
    'publication_head_switch_update',
    'publication_switch_history_provider_eligibility_index_guard',
    'publication_switch_history_target_eligibility_index_guard',
    'publication_dataset_metadata_summary_switch_guard'
  )
) <> 31 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'index' AND name IN (
    'publication_switch_preflight_generation_idx',
    'publication_switch_history_from_retained_hot_idx',
    'publication_switch_history_prior_rollback_retained_hot_idx'
  )
) <> 3 THEN json('') END;

-- Recheck the exact Model-slug projection that becomes lifecycle authority.
SELECT CASE WHEN (
  SELECT count(*) FROM pragma_table_info('publication_model_slug_mapping')
) <> 7 OR (
  SELECT count(*) FROM pragma_table_info(
    'publication_model_slug_artifact_proof'
  )
) <> 17 OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info('publication_model_slug_mapping')
    ORDER BY cid
  )
) <> 'publication_id|slug|target_resource_type|model_id|projection_version|resolution|target_content_hash' OR (
  SELECT group_concat(name, '|') FROM (
    SELECT name FROM pragma_table_info(
      'publication_model_slug_artifact_proof'
    ) ORDER BY cid
  )
) <> 'publication_id|staging_revision|artifact_version|acquisition_version|projection_version|base_bundle_hash|closure_hash|publication_boundary_ms|artifact_digest|artifact_byte_count|model_count|source_history_count|source_history_hash|mapping_count|current_mapping_count|historical_mapping_count|mapping_inventory_hash' OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'index' AND name = 'publication_model_slug_exact_idx'
) <> 1 OR NOT EXISTS (
  SELECT count(*) FROM pragma_index_xinfo('publication_model_slug_exact_idx')
  WHERE key = 1
  HAVING count(*) = 3 AND sum(CASE
    WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 1 AND name = 'slug' AND desc = 0 AND coll = 'BINARY' THEN 1
    WHEN seqno = 2 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
    ELSE 0 END) = 3
) OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'trigger' AND name IN (
    'publication_model_slug_artifact_proof_replace_guard',
    'publication_model_slug_artifact_proof_insert_guard',
    'publication_model_slug_artifact_proof_immutable_update',
    'publication_model_slug_artifact_proof_immutable_delete',
    'publication_model_slug_mapping_replace_guard',
    'publication_model_slug_mapping_insert_guard',
    'publication_model_slug_mapping_immutable_update',
    'publication_model_slug_mapping_immutable_delete'
  )
) <> 8 OR EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE name IN (
    'publication_model_slug_current_model_idx',
    'publication_switch_history_model_slug_index_guard'
  )
) THEN json('') END;

-- The B2B rows are provably empty, so replace their complete authority rather
-- than trusting same-named 1.12 objects. This repairs a same-shape table,
-- index, or no-op trigger without carrying any evidence across the cutover.
DROP TRIGGER publication_model_slug_mapping_replace_guard;
DROP TRIGGER publication_model_slug_mapping_insert_guard;
DROP TRIGGER publication_model_slug_mapping_immutable_update;
DROP TRIGGER publication_model_slug_mapping_immutable_delete;
DROP TRIGGER publication_model_slug_artifact_proof_replace_guard;
DROP TRIGGER publication_model_slug_artifact_proof_insert_guard;
DROP TRIGGER publication_model_slug_artifact_proof_immutable_update;
DROP TRIGGER publication_model_slug_artifact_proof_immutable_delete;
DROP INDEX publication_model_slug_exact_idx;
DROP TABLE publication_model_slug_mapping;
DROP TABLE publication_model_slug_artifact_proof;

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
    SELECT 1 FROM publication AS candidate
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
      AND (NEW.resolution = 'historical' OR CAST(
        json_extract(resource.resource_json, '$.slug.value') AS BLOB
      ) = CAST(NEW.slug AS BLOB))
  ) THEN RAISE(ABORT, 'publication Model slug mapping does not match its building Model resource') END;
END;

CREATE TRIGGER publication_model_slug_mapping_immutable_update
BEFORE UPDATE ON publication_model_slug_mapping
BEGIN SELECT RAISE(ABORT, 'publication Model slug mapping is immutable'); END;
CREATE TRIGGER publication_model_slug_mapping_immutable_delete
BEFORE DELETE ON publication_model_slug_mapping
BEGIN SELECT RAISE(ABORT, 'publication Model slug mapping cannot be deleted'); END;

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
    SELECT 1 FROM publication AS candidate
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
      AND (SELECT count(*) FROM publication_resource
        WHERE publication_id = candidate.publication_id
          AND resource_type = 'model') = NEW.model_count
      AND (SELECT count(*) FROM publication_model_slug_mapping
        WHERE publication_id = candidate.publication_id) = NEW.mapping_count
      AND (SELECT count(*) FROM publication_model_slug_mapping
        WHERE publication_id = candidate.publication_id
          AND resolution = 'current') = NEW.current_mapping_count
      AND (SELECT count(*) FROM publication_model_slug_mapping
        WHERE publication_id = candidate.publication_id
          AND resolution = 'historical') = NEW.historical_mapping_count
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
BEGIN SELECT RAISE(ABORT, 'publication Model slug artifact proof is immutable'); END;
CREATE TRIGGER publication_model_slug_artifact_proof_immutable_delete
BEFORE DELETE ON publication_model_slug_artifact_proof
BEGIN SELECT RAISE(ABORT, 'publication Model slug artifact proof cannot be deleted'); END;

CREATE UNIQUE INDEX publication_model_slug_current_model_idx
ON publication_model_slug_mapping(
  publication_id,
  model_id
)
WHERE resolution = 'current';

DROP TRIGGER publication_closure_seal_insert_guard;
CREATE TRIGGER publication_closure_seal_insert_guard
BEFORE INSERT ON publication_closure_seal
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id
      AND state = 'building'
      AND closure_hash = NEW.closure_hash
      AND generated_at_ms <= NEW.sealed_at_ms
      AND resource_count = NEW.resource_count
      AND exact_document_count = NEW.exact_document_count
      AND vector_document_count = NEW.vector_document_count
  ) THEN RAISE(ABORT, 'seal does not match immutable publication metadata') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_staging_revision
    WHERE publication_id = NEW.publication_id AND revision = NEW.staging_revision
  ) THEN RAISE(ABORT, 'publication staging revision changed before seal') END;
  SELECT CASE WHEN NEW.enabled_provider_count <> NEW.provider_slice_count
    OR NEW.provider_slice_count <> (SELECT count(*) FROM publication_provider_slice WHERE publication_id = NEW.publication_id)
    OR NEW.provider_slice_count <> (SELECT count(*) FROM publication_provider_slice_metadata WHERE publication_id = NEW.publication_id)
    THEN RAISE(ABORT, 'provider scope or metadata does not close') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_provider_slice AS disposition
    WHERE disposition.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_slice_metadata AS metadata
        WHERE metadata.publication_id = disposition.publication_id
          AND metadata.provider_id = disposition.provider_id
      )
  ) THEN RAISE(ABORT, 'provider scope or metadata does not close') END;
  SELECT CASE WHEN NEW.provider_attribution_count <> (
    SELECT count(*) FROM publication_provider_attribution WHERE publication_id = NEW.publication_id
  ) OR EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type IN ('provider', 'offering', 'price', 'precision_observation')
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_attribution AS attribution
        WHERE attribution.publication_id = resource.publication_id
          AND attribution.resource_type = resource.resource_type
          AND attribution.resource_id = resource.resource_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_attribution AS attribution
    JOIN publication_provider_slice AS disposition
      ON disposition.publication_id = attribution.publication_id
      AND disposition.provider_id = attribution.provider_id
    WHERE attribution.publication_id = NEW.publication_id
      AND disposition.freshness_state = 'unavailable'
  ) THEN RAISE(ABORT, 'provider attribution does not close') END;
  SELECT CASE WHEN NEW.resource_count = 0
    OR NEW.resource_count <> (SELECT count(*) FROM publication_resource WHERE publication_id = NEW.publication_id)
    OR NEW.exact_document_count <> (SELECT count(*) FROM publication_search_document WHERE publication_id = NEW.publication_id)
    OR NEW.vector_document_count <> (SELECT count(*) FROM publication_vector_inventory WHERE publication_id = NEW.publication_id)
    OR NEW.exact_document_count <> NEW.vector_document_count
    OR NEW.vector_document_count <> (
      SELECT count(*) FROM publication_resource
      WHERE publication_id = NEW.publication_id AND resource_type IN ('model', 'variant')
    ) OR EXISTS (
      SELECT 1 FROM publication_search_document AS document
      WHERE document.publication_id = NEW.publication_id
        AND NOT EXISTS (
          SELECT 1 FROM publication_vector_inventory AS vector
          WHERE vector.publication_id = document.publication_id
            AND vector.vector_id = document.document_id
            AND vector.resource_type = document.resource_type
            AND vector.resource_id = document.resource_id
            AND vector.search_document_content_hash = document.content_hash
        )
    ) THEN RAISE(ABORT, 'resource search and vector inventories do not close') END;
  SELECT CASE WHEN NEW.chunk_count <> (
    SELECT count(*) FROM publication_inventory_chunk WHERE publication_id = NEW.publication_id
  ) OR EXISTS (
    SELECT 1 FROM publication_inventory_chunk AS later
    JOIN publication_inventory_chunk AS earlier
      ON earlier.publication_id = later.publication_id
      AND earlier.kind = later.kind
      AND earlier.ordinal = later.ordinal - 1
    WHERE later.publication_id = NEW.publication_id
      AND earlier.last_key >= later.first_key
  ) OR EXISTS (
    SELECT 1 FROM (
      SELECT 'resources' AS kind
      UNION ALL SELECT 'exact_search'
      UNION ALL SELECT 'vectors'
    ) AS expected
    WHERE COALESCE((
      SELECT sum(item_count) FROM publication_inventory_chunk
      WHERE publication_id = NEW.publication_id AND kind = expected.kind
    ), 0) <> CASE expected.kind
      WHEN 'resources' THEN NEW.resource_count
      WHEN 'exact_search' THEN NEW.exact_document_count
      ELSE NEW.vector_document_count
    END
    OR (
      SELECT count(*) FROM publication_inventory_chunk
      WHERE publication_id = NEW.publication_id AND kind = expected.kind
    ) <> COALESCE((
      SELECT max(ordinal) + 1 FROM publication_inventory_chunk
      WHERE publication_id = NEW.publication_id AND kind = expected.kind
    ), 0)
  ) THEN RAISE(ABORT, 'inventory chunks do not close') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_model_slug_artifact_proof AS proof
      ON proof.publication_id = candidate.publication_id
    WHERE candidate.publication_id = NEW.publication_id
      AND proof.staging_revision = NEW.staging_revision
      AND proof.closure_hash = NEW.closure_hash
      AND proof.base_bundle_hash = NEW.bundle_hash
      AND proof.publication_boundary_ms = candidate.generated_at_ms
      AND proof.model_count = (
        SELECT count(*) FROM publication_resource
        WHERE publication_id = NEW.publication_id
          AND resource_type = 'model'
      )
      AND proof.mapping_count = (
        SELECT count(*) FROM publication_model_slug_mapping
        WHERE publication_id = NEW.publication_id
      )
      AND proof.current_mapping_count = (
        SELECT count(*) FROM publication_model_slug_mapping
        WHERE publication_id = NEW.publication_id
          AND resolution = 'current'
      )
      AND proof.historical_mapping_count = (
        SELECT count(*) FROM publication_model_slug_mapping
        WHERE publication_id = NEW.publication_id
          AND resolution = 'historical'
      )
      AND NOT EXISTS (
        SELECT 1 FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.publication_id
          AND resource.resource_type = 'model'
          AND NOT EXISTS (
            SELECT 1
            FROM publication_model_slug_mapping AS mapping
              INDEXED BY publication_model_slug_current_model_idx
            WHERE mapping.publication_id = resource.publication_id
              AND mapping.model_id = resource.resource_id
              AND mapping.resolution = 'current'
              AND mapping.target_content_hash = resource.content_hash
              AND CAST(mapping.slug AS BLOB) = CAST(
                json_extract(resource.resource_json, '$.slug.value') AS BLOB
              )
          )
      )
  ) THEN RAISE(ABORT, 'seal lacks an exact archive-bound Model slug projection') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
    WHERE name = 'publication_model_slug_exact_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*) FROM pragma_index_xinfo(
      'publication_model_slug_exact_idx'
    ) WHERE key = 1
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 1 AND name = 'slug' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 2 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      ELSE 0 END) = 3
  ) OR NOT EXISTS (
    SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
    WHERE name = 'publication_model_slug_current_model_idx'
      AND "unique" = 1 AND origin = 'c' AND partial = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type = 'index'
      AND name = 'publication_model_slug_current_model_idx'
      AND tbl_name = 'publication_model_slug_mapping'
      AND replace(replace(replace(replace(sql, char(10), ''),
        char(13), ''), char(9), ''), ' ', '') =
        'CREATEUNIQUEINDEXpublication_model_slug_current_model_idxONpublication_model_slug_mapping(publication_id,model_id)WHEREresolution=''current'''
  ) OR NOT EXISTS (
    SELECT count(*) FROM pragma_index_xinfo(
      'publication_model_slug_current_model_idx'
    ) WHERE key = 1
    HAVING count(*) = 2 AND sum(CASE
      WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 1 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      ELSE 0 END) = 2
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping AS expected
    WHERE expected.publication_id = NEW.publication_id
      AND expected.resolution = 'current'
      AND NOT EXISTS (
        SELECT 1 FROM publication_model_slug_mapping AS indexed
          INDEXED BY publication_model_slug_current_model_idx
        WHERE indexed.publication_id = expected.publication_id
          AND indexed.model_id = expected.model_id
          AND indexed.resolution = 'current'
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_exact_idx
    WHERE publication_id = NEW.publication_id AND slug = '__index_probe__'
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_current_model_idx
    WHERE publication_id = NEW.publication_id
      AND model_id = 'mdl_00000000-0000-4000-8000-000000000000'
      AND resolution = 'current'
  ) THEN RAISE(ABORT, 'Model slug indexes are missing malformed or unqueryable') END;
END;

-- All v4 proof rows were rejected above. Replace their closed schemas without
-- inventing v5 evidence.
DROP TRIGGER publication_state_transition;
DROP TRIGGER publication_head_switch_insert;
DROP TRIGGER publication_head_switch_update;
DROP TABLE publication_switch_history;
DROP TABLE publication_switch_preflight;
DROP TABLE publication_readiness_attestation;
DROP TABLE publication_archive_receipt;
DROP TABLE publication_serving_receipt;
DROP TABLE publication_vector_receipt;
DROP TABLE publication_probe_receipt;
DROP TABLE publication_readiness_receipt;

CREATE TABLE publication_archive_receipt (
  publication_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'archive' CHECK (kind = 'archive'),
  retained_bundle_hash TEXT NOT NULL CHECK (length(retained_bundle_hash) = 71 AND substr(retained_bundle_hash, 1, 7) = 'sha256:' AND substr(retained_bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  model_slug_artifact_version TEXT NOT NULL CHECK (model_slug_artifact_version = 'model-slug-history-artifact@1'),
  model_slug_acquisition_version TEXT NOT NULL CHECK (model_slug_acquisition_version = 'model-slug-history-canonical@1'),
  model_slug_projection_version TEXT NOT NULL CHECK (model_slug_projection_version = 'model-slug@1'),
  model_slug_artifact_digest TEXT NOT NULL CHECK (length(model_slug_artifact_digest) = 71 AND substr(model_slug_artifact_digest, 1, 7) = 'sha256:' AND substr(model_slug_artifact_digest, 8) NOT GLOB '*[^0-9a-f]*'),
  model_slug_artifact_byte_count INTEGER NOT NULL CHECK (typeof(model_slug_artifact_byte_count) = 'integer' AND model_slug_artifact_byte_count BETWEEN 1 AND 25165824),
  model_slug_source_history_count INTEGER NOT NULL CHECK (typeof(model_slug_source_history_count) = 'integer' AND model_slug_source_history_count BETWEEN 0 AND 50000),
  model_slug_source_history_hash TEXT NOT NULL CHECK (length(model_slug_source_history_hash) = 71 AND substr(model_slug_source_history_hash, 1, 7) = 'sha256:' AND substr(model_slug_source_history_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  model_slug_model_count INTEGER NOT NULL CHECK (typeof(model_slug_model_count) = 'integer' AND model_slug_model_count BETWEEN 0 AND 25000),
  model_slug_mapping_count INTEGER NOT NULL CHECK (typeof(model_slug_mapping_count) = 'integer' AND model_slug_mapping_count BETWEEN 0 AND 50000),
  model_slug_current_mapping_count INTEGER NOT NULL CHECK (typeof(model_slug_current_mapping_count) = 'integer' AND model_slug_current_mapping_count = model_slug_model_count AND model_slug_current_mapping_count <= model_slug_mapping_count),
  model_slug_historical_mapping_count INTEGER NOT NULL CHECK (typeof(model_slug_historical_mapping_count) = 'integer' AND model_slug_historical_mapping_count = model_slug_mapping_count - model_slug_current_mapping_count),
  model_slug_mapping_inventory_hash TEXT NOT NULL CHECK (length(model_slug_mapping_inventory_hash) = 71 AND substr(model_slug_mapping_inventory_hash, 1, 7) = 'sha256:' AND substr(model_slug_mapping_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  model_slug_read_verified INTEGER NOT NULL CHECK (model_slug_read_verified IN (0, 1)),
  model_slug_immutable INTEGER NOT NULL CHECK (model_slug_immutable IN (0, 1)),
  immutable INTEGER NOT NULL CHECK (immutable IN (0, 1)),
  FOREIGN KEY (publication_id, kind) REFERENCES publication_readiness_receipt(publication_id, kind) ON DELETE RESTRICT
);
CREATE TABLE publication_probe_receipt (
  publication_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'probes' CHECK (kind = 'probes'),
  probe_set_version TEXT NOT NULL CHECK (probe_set_version = 'search-gold@5'),
  integrity_passed INTEGER NOT NULL CHECK (integrity_passed IN (0, 1)),
  evidence_coverage_passed INTEGER NOT NULL CHECK (evidence_coverage_passed IN (0, 1)),
  exact_search_passed INTEGER NOT NULL CHECK (exact_search_passed IN (0, 1)),
  semantic_search_passed INTEGER NOT NULL CHECK (semantic_search_passed IN (0, 1)),
  structured_filter_passed INTEGER NOT NULL CHECK (structured_filter_passed IN (0, 1)),
  neutrality_passed INTEGER NOT NULL CHECK (neutrality_passed IN (0, 1)),
  version_isolation_passed INTEGER NOT NULL CHECK (version_isolation_passed IN (0, 1)),
  model_slug_lookup_passed INTEGER NOT NULL CHECK (model_slug_lookup_passed IN (0, 1)),
  FOREIGN KEY (publication_id, kind) REFERENCES publication_readiness_receipt(publication_id, kind) ON DELETE RESTRICT
);
CREATE TABLE publication_readiness_attestation (
  publication_id TEXT PRIMARY KEY REFERENCES publication_closure_seal(publication_id) ON DELETE RESTRICT,
  environment TEXT NOT NULL CHECK (environment IN ('local', 'preview', 'production')),
  closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = 'sha256:' AND substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 71 AND substr(bundle_hash, 1, 7) = 'sha256:' AND substr(bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  evaluator_version TEXT NOT NULL CHECK (evaluator_version = '5.0.0'),
  ready_at_ms INTEGER NOT NULL CHECK (typeof(ready_at_ms) = 'integer' AND ready_at_ms >= 0),
  maximum_receipt_age_ms INTEGER NOT NULL CHECK (typeof(maximum_receipt_age_ms) = 'integer' AND maximum_receipt_age_ms >= 0),
  effective_valid_until_ms INTEGER NOT NULL CHECK (typeof(effective_valid_until_ms) = 'integer' AND effective_valid_until_ms >= ready_at_ms),
  archive_observed_at_ms INTEGER NOT NULL CHECK (typeof(archive_observed_at_ms) = 'integer' AND archive_observed_at_ms >= 0),
  serving_observed_at_ms INTEGER NOT NULL CHECK (typeof(serving_observed_at_ms) = 'integer' AND serving_observed_at_ms >= 0),
  vector_observed_at_ms INTEGER NOT NULL CHECK (typeof(vector_observed_at_ms) = 'integer' AND vector_observed_at_ms >= 0),
  probes_observed_at_ms INTEGER NOT NULL CHECK (typeof(probes_observed_at_ms) = 'integer' AND probes_observed_at_ms >= 0),
  archive_receipt_hash TEXT NOT NULL CHECK (length(archive_receipt_hash) = 71 AND substr(archive_receipt_hash, 1, 7) = 'sha256:' AND substr(archive_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  serving_receipt_hash TEXT NOT NULL CHECK (length(serving_receipt_hash) = 71 AND substr(serving_receipt_hash, 1, 7) = 'sha256:' AND substr(serving_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  vector_receipt_hash TEXT NOT NULL CHECK (length(vector_receipt_hash) = 71 AND substr(vector_receipt_hash, 1, 7) = 'sha256:' AND substr(vector_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  probes_receipt_hash TEXT NOT NULL CHECK (length(probes_receipt_hash) = 71 AND substr(probes_receipt_hash, 1, 7) = 'sha256:' AND substr(probes_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  attestation_hash TEXT NOT NULL CHECK (length(attestation_hash) = 71 AND substr(attestation_hash, 1, 7) = 'sha256:' AND substr(attestation_hash, 8) NOT GLOB '*[^0-9a-f]*')
);
CREATE TABLE publication_readiness_receipt (
  publication_id TEXT NOT NULL REFERENCES publication_closure_seal(publication_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('archive', 'serving', 'vectors', 'probes')),
  receipt_version TEXT NOT NULL CHECK (receipt_version = '5.0.0'),
  receipt_hash TEXT NOT NULL CHECK (length(receipt_hash) = 71 AND substr(receipt_hash, 1, 7) = 'sha256:' AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  environment TEXT NOT NULL CHECK (environment IN ('local', 'preview', 'production')),
  closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = 'sha256:' AND substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 71 AND substr(bundle_hash, 1, 7) = 'sha256:' AND substr(bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  schema_version TEXT NOT NULL CHECK (length(schema_version) BETWEEN 1 AND 128 AND schema_version NOT GLOB '*[^ -~]*'),
  build_commit TEXT NOT NULL CHECK (length(build_commit) BETWEEN 1 AND 128 AND build_commit NOT GLOB '*[^ -~]*'),
  observed_at_ms INTEGER NOT NULL CHECK (typeof(observed_at_ms) = 'integer' AND observed_at_ms >= 0),
  PRIMARY KEY (publication_id, kind)
);
CREATE TABLE publication_serving_receipt (
  publication_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'serving' CHECK (kind = 'serving'),
  enabled_provider_count INTEGER NOT NULL CHECK (typeof(enabled_provider_count) = 'integer' AND enabled_provider_count >= 0),
  enabled_provider_scope_hash TEXT NOT NULL CHECK (length(enabled_provider_scope_hash) = 71 AND substr(enabled_provider_scope_hash, 1, 7) = 'sha256:' AND substr(enabled_provider_scope_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_slice_count INTEGER NOT NULL CHECK (typeof(provider_slice_count) = 'integer' AND provider_slice_count >= 0),
  provider_slice_hash TEXT NOT NULL CHECK (length(provider_slice_hash) = 71 AND substr(provider_slice_hash, 1, 7) = 'sha256:' AND substr(provider_slice_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_attribution_count INTEGER NOT NULL CHECK (typeof(provider_attribution_count) = 'integer' AND provider_attribution_count >= 0),
  provider_attribution_hash TEXT NOT NULL CHECK (length(provider_attribution_hash) = 71 AND substr(provider_attribution_hash, 1, 7) = 'sha256:' AND substr(provider_attribution_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  resource_count INTEGER NOT NULL CHECK (typeof(resource_count) = 'integer' AND resource_count >= 0),
  exact_document_count INTEGER NOT NULL CHECK (typeof(exact_document_count) = 'integer' AND exact_document_count >= 0),
  resource_inventory_hash TEXT NOT NULL CHECK (length(resource_inventory_hash) = 71 AND substr(resource_inventory_hash, 1, 7) = 'sha256:' AND substr(resource_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  exact_search_inventory_hash TEXT NOT NULL CHECK (length(exact_search_inventory_hash) = 71 AND substr(exact_search_inventory_hash, 1, 7) = 'sha256:' AND substr(exact_search_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  fts_build_version TEXT NOT NULL CHECK (fts_build_version = 'fts5-unicode61@1'),
  fts_document_count INTEGER NOT NULL CHECK (typeof(fts_document_count) = 'integer' AND fts_document_count >= 0),
  fts_queryable INTEGER NOT NULL CHECK (fts_queryable IN (0, 1)),
  foreign_keys_valid INTEGER NOT NULL CHECK (foreign_keys_valid IN (0, 1)),
  content_hashes_valid INTEGER NOT NULL CHECK (content_hashes_valid IN (0, 1)),
  unavailable_provider_isolation_valid INTEGER NOT NULL CHECK (unavailable_provider_isolation_valid IN (0, 1)),
  provider_search_projection_version TEXT NOT NULL CHECK (provider_search_projection_version = 'provider-name@1'),
  provider_search_document_count INTEGER NOT NULL CHECK (typeof(provider_search_document_count) = 'integer' AND provider_search_document_count >= 0),
  provider_search_inventory_hash TEXT NOT NULL CHECK (length(provider_search_inventory_hash) = 71 AND substr(provider_search_inventory_hash, 1, 7) = 'sha256:' AND substr(provider_search_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_search_fts_build_version TEXT NOT NULL CHECK (provider_search_fts_build_version = 'provider-name-fts5-unicode61@1'),
  provider_search_fts_document_count INTEGER NOT NULL CHECK (typeof(provider_search_fts_document_count) = 'integer' AND provider_search_fts_document_count >= 0),
  provider_search_fts_queryable INTEGER NOT NULL CHECK (provider_search_fts_queryable IN (0, 1)),
  provider_search_exact_parity INTEGER NOT NULL CHECK (provider_search_exact_parity IN (0, 1)),
  model_variant_name_projection_version TEXT NOT NULL CHECK (model_variant_name_projection_version = 'model-variant-name@1'),
  model_variant_name_document_count INTEGER NOT NULL CHECK (typeof(model_variant_name_document_count) = 'integer' AND model_variant_name_document_count >= 0),
  model_variant_name_inventory_hash TEXT NOT NULL CHECK (length(model_variant_name_inventory_hash) = 71 AND substr(model_variant_name_inventory_hash, 1, 7) = 'sha256:' AND substr(model_variant_name_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  model_variant_name_storage_version TEXT NOT NULL CHECK (model_variant_name_storage_version = 'model-variant-name-utf8-blob@1'),
  model_variant_name_storage_document_count INTEGER NOT NULL CHECK (typeof(model_variant_name_storage_document_count) = 'integer' AND model_variant_name_storage_document_count >= 0),
  model_variant_name_storage_queryable INTEGER NOT NULL CHECK (model_variant_name_storage_queryable IN (0, 1)),
  model_variant_name_storage_exact_parity INTEGER NOT NULL CHECK (model_variant_name_storage_exact_parity IN (0, 1)),
  provider_model_id_projection_version TEXT NOT NULL CHECK (provider_model_id_projection_version = 'provider-model-id@1'),
  provider_model_id_document_count INTEGER NOT NULL CHECK (typeof(provider_model_id_document_count) = 'integer' AND provider_model_id_document_count >= 0),
  provider_model_id_inventory_hash TEXT NOT NULL CHECK (length(provider_model_id_inventory_hash) = 71 AND substr(provider_model_id_inventory_hash, 1, 7) = 'sha256:' AND substr(provider_model_id_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_model_id_storage_version TEXT NOT NULL CHECK (provider_model_id_storage_version = 'provider-model-id-utf8-blob@1'),
  provider_model_id_storage_document_count INTEGER NOT NULL CHECK (typeof(provider_model_id_storage_document_count) = 'integer' AND provider_model_id_storage_document_count >= 0),
  provider_model_id_storage_queryable INTEGER NOT NULL CHECK (provider_model_id_storage_queryable IN (0, 1)),
  provider_model_id_storage_exact_parity INTEGER NOT NULL CHECK (provider_model_id_storage_exact_parity IN (0, 1)),
  model_slug_storage_version TEXT NOT NULL CHECK (model_slug_storage_version = 'model-slug-serving@1'),
  model_slug_artifact_digest TEXT NOT NULL CHECK (length(model_slug_artifact_digest) = 71 AND substr(model_slug_artifact_digest, 1, 7) = 'sha256:' AND substr(model_slug_artifact_digest, 8) NOT GLOB '*[^0-9a-f]*'),
  model_slug_projection_version TEXT NOT NULL CHECK (model_slug_projection_version = 'model-slug@1'),
  model_slug_model_count INTEGER NOT NULL CHECK (typeof(model_slug_model_count) = 'integer' AND model_slug_model_count BETWEEN 0 AND 25000),
  model_slug_mapping_count INTEGER NOT NULL CHECK (typeof(model_slug_mapping_count) = 'integer' AND model_slug_mapping_count BETWEEN 0 AND 50000),
  model_slug_current_mapping_count INTEGER NOT NULL CHECK (typeof(model_slug_current_mapping_count) = 'integer' AND model_slug_current_mapping_count = model_slug_model_count AND model_slug_current_mapping_count <= model_slug_mapping_count),
  model_slug_historical_mapping_count INTEGER NOT NULL CHECK (typeof(model_slug_historical_mapping_count) = 'integer' AND model_slug_historical_mapping_count = model_slug_mapping_count - model_slug_current_mapping_count),
  model_slug_mapping_inventory_hash TEXT NOT NULL CHECK (length(model_slug_mapping_inventory_hash) = 71 AND substr(model_slug_mapping_inventory_hash, 1, 7) = 'sha256:' AND substr(model_slug_mapping_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  model_slug_queryable INTEGER NOT NULL CHECK (model_slug_queryable IN (0, 1)),
  model_slug_exact_parity INTEGER NOT NULL CHECK (model_slug_exact_parity IN (0, 1)),
  FOREIGN KEY (publication_id, kind) REFERENCES publication_readiness_receipt(publication_id, kind) ON DELETE RESTRICT
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
CREATE TABLE publication_switch_preflight (
  switch_id TEXT PRIMARY KEY CHECK (length(switch_id) BETWEEN 1 AND 512 AND switch_id NOT GLOB '*[^ -~]*'),
  preflight_version TEXT NOT NULL CHECK (preflight_version = '5.0.0'),
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
  archive_model_slug_artifact_version TEXT NOT NULL CHECK (archive_model_slug_artifact_version = 'model-slug-history-artifact@1'),
  archive_model_slug_acquisition_version TEXT NOT NULL CHECK (archive_model_slug_acquisition_version = 'model-slug-history-canonical@1'),
  archive_model_slug_projection_version TEXT NOT NULL CHECK (archive_model_slug_projection_version = 'model-slug@1'),
  archive_model_slug_artifact_digest TEXT NOT NULL CHECK (length(archive_model_slug_artifact_digest) = 71 AND substr(archive_model_slug_artifact_digest, 1, 7) = 'sha256:' AND substr(archive_model_slug_artifact_digest, 8) NOT GLOB '*[^0-9a-f]*'),
  archive_model_slug_artifact_byte_count INTEGER NOT NULL CHECK (typeof(archive_model_slug_artifact_byte_count) = 'integer' AND archive_model_slug_artifact_byte_count BETWEEN 1 AND 25165824),
  archive_model_slug_source_history_count INTEGER NOT NULL CHECK (typeof(archive_model_slug_source_history_count) = 'integer' AND archive_model_slug_source_history_count BETWEEN 0 AND 50000),
  archive_model_slug_source_history_hash TEXT NOT NULL CHECK (length(archive_model_slug_source_history_hash) = 71 AND substr(archive_model_slug_source_history_hash, 1, 7) = 'sha256:' AND substr(archive_model_slug_source_history_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  archive_model_slug_model_count INTEGER NOT NULL CHECK (typeof(archive_model_slug_model_count) = 'integer' AND archive_model_slug_model_count BETWEEN 0 AND 25000),
  archive_model_slug_mapping_count INTEGER NOT NULL CHECK (typeof(archive_model_slug_mapping_count) = 'integer' AND archive_model_slug_mapping_count BETWEEN 0 AND 50000),
  archive_model_slug_current_mapping_count INTEGER NOT NULL CHECK (typeof(archive_model_slug_current_mapping_count) = 'integer' AND archive_model_slug_current_mapping_count = archive_model_slug_model_count AND archive_model_slug_current_mapping_count <= archive_model_slug_mapping_count),
  archive_model_slug_historical_mapping_count INTEGER NOT NULL CHECK (typeof(archive_model_slug_historical_mapping_count) = 'integer' AND archive_model_slug_historical_mapping_count = archive_model_slug_mapping_count - archive_model_slug_current_mapping_count),
  archive_model_slug_mapping_inventory_hash TEXT NOT NULL CHECK (length(archive_model_slug_mapping_inventory_hash) = 71 AND substr(archive_model_slug_mapping_inventory_hash, 1, 7) = 'sha256:' AND substr(archive_model_slug_mapping_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  archive_model_slug_read_verified INTEGER NOT NULL CHECK (archive_model_slug_read_verified IN (0, 1)),
  archive_model_slug_immutable INTEGER NOT NULL CHECK (archive_model_slug_immutable IN (0, 1)),
  archive_immutable INTEGER NOT NULL CHECK (archive_immutable IN (0, 1)),
  archive_receipt_hash TEXT NOT NULL CHECK (length(archive_receipt_hash) = 71 AND substr(archive_receipt_hash, 1, 7) = 'sha256:' AND substr(archive_receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  serving_model_slug_storage_version TEXT NOT NULL CHECK (serving_model_slug_storage_version = 'model-slug-serving@1'),
  serving_model_slug_artifact_digest TEXT NOT NULL CHECK (length(serving_model_slug_artifact_digest) = 71 AND substr(serving_model_slug_artifact_digest, 1, 7) = 'sha256:' AND substr(serving_model_slug_artifact_digest, 8) NOT GLOB '*[^0-9a-f]*'),
  serving_model_slug_projection_version TEXT NOT NULL CHECK (serving_model_slug_projection_version = 'model-slug@1'),
  serving_model_slug_model_count INTEGER NOT NULL CHECK (typeof(serving_model_slug_model_count) = 'integer' AND serving_model_slug_model_count BETWEEN 0 AND 25000),
  serving_model_slug_mapping_count INTEGER NOT NULL CHECK (typeof(serving_model_slug_mapping_count) = 'integer' AND serving_model_slug_mapping_count BETWEEN 0 AND 50000),
  serving_model_slug_current_mapping_count INTEGER NOT NULL CHECK (typeof(serving_model_slug_current_mapping_count) = 'integer' AND serving_model_slug_current_mapping_count = serving_model_slug_model_count AND serving_model_slug_current_mapping_count <= serving_model_slug_mapping_count),
  serving_model_slug_historical_mapping_count INTEGER NOT NULL CHECK (typeof(serving_model_slug_historical_mapping_count) = 'integer' AND serving_model_slug_historical_mapping_count = serving_model_slug_mapping_count - serving_model_slug_current_mapping_count),
  serving_model_slug_mapping_inventory_hash TEXT NOT NULL CHECK (length(serving_model_slug_mapping_inventory_hash) = 71 AND substr(serving_model_slug_mapping_inventory_hash, 1, 7) = 'sha256:' AND substr(serving_model_slug_mapping_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  serving_model_slug_queryable INTEGER NOT NULL CHECK (serving_model_slug_queryable IN (0, 1)),
  serving_model_slug_exact_parity INTEGER NOT NULL CHECK (serving_model_slug_exact_parity IN (0, 1)),
  vector_namespace TEXT NOT NULL,
  vector_document_count INTEGER NOT NULL CHECK (typeof(vector_document_count) = 'integer' AND vector_document_count >= 0),
  vector_verified_document_count INTEGER NOT NULL CHECK (typeof(vector_verified_document_count) = 'integer' AND vector_verified_document_count >= 0),
  vector_inventory_hash TEXT NOT NULL CHECK (length(vector_inventory_hash) = 71 AND substr(vector_inventory_hash, 1, 7) = 'sha256:' AND substr(vector_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  vector_visibility_probe_version TEXT NOT NULL CHECK (vector_visibility_probe_version = 'vector-visibility@1'),
  vector_mutation_id TEXT NOT NULL CHECK (length(vector_mutation_id) BETWEEN 1 AND 128 AND vector_mutation_id NOT GLOB '*[^ -~]*'),
  vector_all_ids_present INTEGER NOT NULL CHECK (vector_all_ids_present IN (0, 1)),
  vector_all_namespaces_match INTEGER NOT NULL CHECK (vector_all_namespaces_match IN (0, 1)),
  vector_queryable INTEGER NOT NULL CHECK (vector_queryable IN (0, 1)),
  probe_set_version TEXT NOT NULL CHECK (probe_set_version = 'search-gold@5'),
  integrity_passed INTEGER NOT NULL CHECK (integrity_passed IN (0, 1)),
  exact_search_passed INTEGER NOT NULL CHECK (exact_search_passed IN (0, 1)),
  semantic_search_passed INTEGER NOT NULL CHECK (semantic_search_passed IN (0, 1)),
  structured_filter_passed INTEGER NOT NULL CHECK (structured_filter_passed IN (0, 1)),
  neutrality_passed INTEGER NOT NULL CHECK (neutrality_passed IN (0, 1)),
  version_isolation_passed INTEGER NOT NULL CHECK (version_isolation_passed IN (0, 1)),
  model_slug_lookup_passed INTEGER NOT NULL CHECK (model_slug_lookup_passed IN (0, 1)),
  provider_search_projection_version TEXT NOT NULL CHECK (provider_search_projection_version = 'provider-name@1'),
  provider_search_document_count INTEGER NOT NULL CHECK (typeof(provider_search_document_count) = 'integer' AND provider_search_document_count >= 0),
  provider_search_inventory_hash TEXT NOT NULL CHECK (length(provider_search_inventory_hash) = 71 AND substr(provider_search_inventory_hash, 1, 7) = 'sha256:' AND substr(provider_search_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_search_fts_build_version TEXT NOT NULL CHECK (provider_search_fts_build_version = 'provider-name-fts5-unicode61@1'),
  provider_search_fts_document_count INTEGER NOT NULL CHECK (typeof(provider_search_fts_document_count) = 'integer' AND provider_search_fts_document_count >= 0),
  provider_search_fts_queryable INTEGER NOT NULL CHECK (provider_search_fts_queryable IN (0, 1)),
  provider_search_exact_parity INTEGER NOT NULL CHECK (provider_search_exact_parity IN (0, 1)),
  model_variant_name_projection_version TEXT NOT NULL CHECK (model_variant_name_projection_version = 'model-variant-name@1'),
  model_variant_name_document_count INTEGER NOT NULL CHECK (typeof(model_variant_name_document_count) = 'integer' AND model_variant_name_document_count >= 0),
  model_variant_name_inventory_hash TEXT NOT NULL CHECK (length(model_variant_name_inventory_hash) = 71 AND substr(model_variant_name_inventory_hash, 1, 7) = 'sha256:' AND substr(model_variant_name_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  model_variant_name_storage_version TEXT NOT NULL CHECK (model_variant_name_storage_version = 'model-variant-name-utf8-blob@1'),
  model_variant_name_storage_document_count INTEGER NOT NULL CHECK (typeof(model_variant_name_storage_document_count) = 'integer' AND model_variant_name_storage_document_count >= 0),
  model_variant_name_storage_queryable INTEGER NOT NULL CHECK (model_variant_name_storage_queryable IN (0, 1)),
  model_variant_name_storage_exact_parity INTEGER NOT NULL CHECK (model_variant_name_storage_exact_parity IN (0, 1)),
  provider_model_id_projection_version TEXT NOT NULL CHECK (provider_model_id_projection_version = 'provider-model-id@1'),
  provider_model_id_document_count INTEGER NOT NULL CHECK (typeof(provider_model_id_document_count) = 'integer' AND provider_model_id_document_count >= 0),
  provider_model_id_inventory_hash TEXT NOT NULL CHECK (length(provider_model_id_inventory_hash) = 71 AND substr(provider_model_id_inventory_hash, 1, 7) = 'sha256:' AND substr(provider_model_id_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_model_id_storage_version TEXT NOT NULL CHECK (provider_model_id_storage_version = 'provider-model-id-utf8-blob@1'),
  provider_model_id_storage_document_count INTEGER NOT NULL CHECK (typeof(provider_model_id_storage_document_count) = 'integer' AND provider_model_id_storage_document_count >= 0),
  provider_model_id_storage_queryable INTEGER NOT NULL CHECK (provider_model_id_storage_queryable IN (0, 1)),
  provider_model_id_storage_exact_parity INTEGER NOT NULL CHECK (provider_model_id_storage_exact_parity IN (0, 1)),
  CHECK ((from_publication_id IS NULL) = (from_closure_hash IS NULL)),
  CHECK ((expected_prior_generation = 0) = (expected_prior_switched_at_ms IS NULL)),
  CHECK (expected_prior_generation > 0 OR expected_prior_rollback_candidate_publication_id IS NULL),
  CHECK (from_publication_id IS NULL OR from_publication_id <> to_publication_id),
  CHECK ((action = 'activate' AND to_attestation_hash IS NOT NULL) OR (action = 'rollback' AND to_attestation_hash IS NULL))
);
CREATE TABLE publication_vector_receipt (
  publication_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'vectors' CHECK (kind = 'vectors'),
  vector_namespace TEXT NOT NULL,
  document_count INTEGER NOT NULL CHECK (typeof(document_count) = 'integer' AND document_count >= 0),
  verified_document_count INTEGER NOT NULL CHECK (typeof(verified_document_count) = 'integer' AND verified_document_count >= 0),
  vector_inventory_hash TEXT NOT NULL CHECK (length(vector_inventory_hash) = 71 AND substr(vector_inventory_hash, 1, 7) = 'sha256:' AND substr(vector_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  visibility_probe_version TEXT NOT NULL CHECK (length(visibility_probe_version) BETWEEN 1 AND 128 AND visibility_probe_version NOT GLOB '*[^ -~]*'),
  mutation_id TEXT NOT NULL CHECK (length(mutation_id) BETWEEN 1 AND 128 AND mutation_id NOT GLOB '*[^ -~]*'),
  all_ids_present INTEGER NOT NULL CHECK (all_ids_present IN (0, 1)),
  all_namespaces_match INTEGER NOT NULL CHECK (all_namespaces_match IN (0, 1)),
  queryable INTEGER NOT NULL CHECK (queryable IN (0, 1)),
  FOREIGN KEY (publication_id, kind) REFERENCES publication_readiness_receipt(publication_id, kind) ON DELETE RESTRICT
);
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
CREATE INDEX publication_switch_preflight_generation_idx
ON publication_switch_preflight(new_generation, action);
CREATE TRIGGER publication_archive_receipt_immutable_delete BEFORE DELETE ON publication_archive_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_archive_receipt_immutable_update BEFORE UPDATE ON publication_archive_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_archive_receipt_insert_guard
BEFORE INSERT ON publication_archive_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    JOIN publication_closure_seal AS seal USING (publication_id)
    JOIN publication_model_slug_artifact_proof AS proof USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'archive' AND candidate.state = 'building'
      AND NEW.retained_bundle_hash = seal.bundle_hash
      AND NEW.model_slug_artifact_version = proof.artifact_version
      AND NEW.model_slug_acquisition_version = proof.acquisition_version
      AND NEW.model_slug_projection_version = proof.projection_version
      AND NEW.model_slug_artifact_digest = proof.artifact_digest
      AND NEW.model_slug_artifact_byte_count = proof.artifact_byte_count
      AND NEW.model_slug_source_history_count = proof.source_history_count
      AND NEW.model_slug_source_history_hash = proof.source_history_hash
      AND NEW.model_slug_model_count = proof.model_count
      AND NEW.model_slug_mapping_count = proof.mapping_count
      AND NEW.model_slug_current_mapping_count = proof.current_mapping_count
      AND NEW.model_slug_historical_mapping_count = proof.historical_mapping_count
      AND NEW.model_slug_mapping_inventory_hash = proof.mapping_inventory_hash
      AND NEW.model_slug_read_verified = 1
      AND NEW.model_slug_immutable = 1
      AND NEW.immutable = 1
  ) THEN RAISE(ABORT, 'archive receipt lacks its sealed Model slug binding') END;
END;
CREATE TRIGGER publication_dataset_metadata_summary_switch_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_dataset_metadata_summary AS summary
    JOIN publication_closure_seal AS seal USING (publication_id)
    JOIN publication AS candidate USING (publication_id)
    WHERE summary.publication_id = NEW.to_publication_id
      AND summary.summary_version = '1.0.0'
      AND summary.closure_hash = NEW.to_closure_hash
      AND summary.closure_hash = candidate.closure_hash
      AND summary.closure_hash = seal.closure_hash
      AND summary.source_resource_count = candidate.resource_count
      AND summary.source_resource_count = seal.resource_count
      AND summary.provider_slice_count = seal.provider_slice_count
      AND summary.provider_slice_hash = seal.provider_slice_hash
      AND summary.active_model_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.to_publication_id
          AND resource.resource_type = 'model'
          AND json_extract(resource.resource_json, '$.status.state') = 'known'
          AND json_extract(resource.resource_json, '$.status.value') = 'active'
      )
      AND summary.active_offering_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.to_publication_id
          AND resource.resource_type = 'offering'
          AND json_extract(resource.resource_json, '$.status.state') = 'known'
          AND json_extract(resource.resource_json, '$.status.value') = 'active'
          AND json_extract(resource.resource_json, '$.stale') = 0
      )
      AND summary.active_provider_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.to_publication_id
          AND resource.resource_type = 'provider'
          AND json_extract(resource.resource_json, '$.status.state') = 'known'
          AND json_extract(resource.resource_json, '$.status.value') = 'active'
      )
      AND summary.has_stale_provider_slices = EXISTS (
        SELECT 1 FROM publication_provider_slice
        WHERE publication_id = NEW.to_publication_id AND freshness_state = 'stale'
      )
      AND summary.has_unavailable_provider_slices = EXISTS (
        SELECT 1 FROM publication_provider_slice
        WHERE publication_id = NEW.to_publication_id AND freshness_state = 'unavailable'
      )
  ) THEN RAISE(ABORT, 'switch target lacks an exact dataset metadata summary') END;
END;
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
CREATE TRIGGER publication_probe_receipt_immutable_delete BEFORE DELETE ON publication_probe_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_probe_receipt_immutable_update BEFORE UPDATE ON publication_probe_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_probe_receipt_insert_guard
BEFORE INSERT ON publication_probe_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'probes' AND candidate.state = 'building'
  ) THEN RAISE(ABORT, 'probe receipt lacks its sealed binding') END;
END;
CREATE TRIGGER publication_readiness_attestation_immutable_delete BEFORE DELETE ON publication_readiness_attestation BEGIN SELECT RAISE(ABORT, 'readiness attestation cannot be deleted'); END;
CREATE TRIGGER publication_readiness_attestation_immutable_update BEFORE UPDATE ON publication_readiness_attestation BEGIN SELECT RAISE(ABORT, 'readiness attestation is immutable'); END;
CREATE TRIGGER publication_readiness_attestation_insert_guard
BEFORE INSERT ON publication_readiness_attestation
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM pragma_index_list('publication_provider_model_id_search_document')
    WHERE name = 'publication_provider_model_id_raw_exact_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*)
    FROM pragma_index_info('publication_provider_model_id_raw_exact_idx')
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND cid = 0 AND name = 'publication_id' THEN 1
      WHEN seqno = 1 AND cid = 7 AND name = 'raw_provider_model_id_utf8' THEN 1
      WHEN seqno = 2 AND cid = 2 AND name = 'offering_id' THEN 1
      ELSE 0 END) = 3
  ) OR NOT EXISTS (
    SELECT 1
    FROM pragma_index_list('publication_provider_model_id_search_document')
    WHERE name = 'publication_provider_model_id_normalized_exact_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*)
    FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx')
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND cid = 0 AND name = 'publication_id' THEN 1
      WHEN seqno = 1 AND cid = 8 AND name = 'normalized_provider_model_id_utf8' THEN 1
      WHEN seqno = 2 AND cid = 2 AND name = 'offering_id' THEN 1
      ELSE 0 END) = 3
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_raw_exact_idx
    WHERE publication_id = NEW.publication_id
      AND raw_provider_model_id_utf8 = X'FF'
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_normalized_exact_idx
    WHERE publication_id = NEW.publication_id
      AND normalized_provider_model_id_utf8 = X'FF'
  ) THEN RAISE(ABORT, 'provider model ID exact indexes are missing malformed or unqueryable') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = 'building'
      AND candidate.closure_hash = NEW.closure_hash
      AND seal.closure_hash = NEW.closure_hash
      AND seal.bundle_hash = NEW.bundle_hash
      AND NEW.ready_at_ms >= seal.sealed_at_ms
  ) THEN RAISE(ABORT, 'readiness attestation does not bind the sealed building publication') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id
  ) <> 4 OR EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id
      AND (environment <> NEW.environment
        OR receipt_version <> '5.0.0'
        OR observed_at_ms > NEW.ready_at_ms
        OR NEW.ready_at_ms - observed_at_ms > NEW.maximum_receipt_age_ms)
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'archive'
      AND observed_at_ms = NEW.archive_observed_at_ms
      AND receipt_hash = NEW.archive_receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'serving'
      AND observed_at_ms = NEW.serving_observed_at_ms
      AND receipt_hash = NEW.serving_receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'vectors'
      AND observed_at_ms = NEW.vector_observed_at_ms
      AND receipt_hash = NEW.vector_receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'probes'
      AND observed_at_ms = NEW.probes_observed_at_ms
      AND receipt_hash = NEW.probes_receipt_hash
  ) THEN RAISE(ABORT, 'readiness receipt set is incomplete stale or mismatched') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_archive_receipt AS archive
    JOIN publication_closure_seal AS seal USING (publication_id)
    JOIN publication_model_slug_artifact_proof AS proof USING (publication_id)
    WHERE archive.publication_id = NEW.publication_id
      AND archive.retained_bundle_hash = seal.bundle_hash
      AND archive.model_slug_artifact_version = proof.artifact_version
      AND archive.model_slug_acquisition_version = proof.acquisition_version
      AND archive.model_slug_projection_version = proof.projection_version
      AND archive.model_slug_artifact_digest = proof.artifact_digest
      AND archive.model_slug_artifact_byte_count = proof.artifact_byte_count
      AND archive.model_slug_source_history_count = proof.source_history_count
      AND archive.model_slug_source_history_hash = proof.source_history_hash
      AND archive.model_slug_model_count = proof.model_count
      AND archive.model_slug_mapping_count = proof.mapping_count
      AND archive.model_slug_current_mapping_count = proof.current_mapping_count
      AND archive.model_slug_historical_mapping_count = proof.historical_mapping_count
      AND archive.model_slug_mapping_inventory_hash = proof.mapping_inventory_hash
      AND archive.model_slug_read_verified = 1
      AND archive.model_slug_immutable = 1
      AND archive.immutable = 1
  ) THEN RAISE(ABORT, 'archive receipt does not prove retained immutable closure') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_serving_receipt AS serving
    JOIN publication_closure_seal AS seal USING (publication_id)
    JOIN publication_model_slug_artifact_proof AS proof USING (publication_id)
    WHERE serving.publication_id = NEW.publication_id
      AND serving.enabled_provider_count = seal.enabled_provider_count
      AND serving.enabled_provider_scope_hash = seal.enabled_provider_scope_hash
      AND serving.provider_slice_count = seal.provider_slice_count
      AND serving.provider_slice_hash = seal.provider_slice_hash
      AND serving.provider_attribution_count = seal.provider_attribution_count
      AND serving.provider_attribution_hash = seal.provider_attribution_hash
      AND serving.resource_count = seal.resource_count
      AND serving.exact_document_count = seal.exact_document_count
      AND serving.resource_inventory_hash = seal.resource_inventory_hash
      AND serving.exact_search_inventory_hash = seal.exact_search_inventory_hash
      AND serving.fts_document_count = seal.exact_document_count
      AND serving.fts_queryable = 1
      AND serving.foreign_keys_valid = 1
      AND serving.content_hashes_valid = 1
      AND serving.unavailable_provider_isolation_valid = 1
      AND serving.provider_search_document_count = (
        SELECT count(*) FROM publication_provider_search_document
        WHERE publication_id = NEW.publication_id
      )
      AND serving.provider_search_fts_document_count = serving.provider_search_document_count
      AND serving.provider_search_fts_queryable = 1
      AND serving.provider_search_exact_parity = 1
      AND serving.model_variant_name_document_count = (
        SELECT count(*) FROM publication_model_variant_name_search_document
        WHERE publication_id = NEW.publication_id
      )
      AND serving.model_variant_name_storage_document_count = serving.model_variant_name_document_count
      AND serving.model_variant_name_storage_queryable = 1
      AND serving.model_variant_name_storage_exact_parity = 1
      AND serving.provider_model_id_document_count = (
        SELECT count(*) FROM publication_provider_model_id_search_document
        WHERE publication_id = NEW.publication_id
      )
      AND serving.provider_model_id_storage_document_count = serving.provider_model_id_document_count
      AND serving.provider_model_id_storage_queryable = 1
      AND serving.provider_model_id_storage_exact_parity = 1
      AND serving.model_slug_storage_version = 'model-slug-serving@1'
      AND serving.model_slug_artifact_digest = proof.artifact_digest
      AND serving.model_slug_projection_version = proof.projection_version
      AND serving.model_slug_model_count = proof.model_count
      AND serving.model_slug_mapping_count = proof.mapping_count
      AND serving.model_slug_current_mapping_count = proof.current_mapping_count
      AND serving.model_slug_historical_mapping_count = proof.historical_mapping_count
      AND serving.model_slug_mapping_inventory_hash = proof.mapping_inventory_hash
      AND serving.model_slug_queryable = 1
      AND serving.model_slug_exact_parity = 1
  ) THEN RAISE(ABORT, 'serving receipt does not prove the sealed closure') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_vector_receipt AS vectors
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE vectors.publication_id = NEW.publication_id
      AND vectors.vector_namespace = vectors.publication_id
      AND vectors.document_count = seal.vector_document_count
      AND vectors.verified_document_count = seal.vector_document_count
      AND vectors.vector_inventory_hash = seal.vector_inventory_hash
      AND vectors.visibility_probe_version = 'vector-visibility@1'
      AND vectors.all_ids_present = 1
      AND vectors.all_namespaces_match = 1
      AND vectors.queryable = 1
  ) THEN RAISE(ABORT, 'vector receipt does not prove queryable sealed vectors') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_probe_receipt
    WHERE publication_id = NEW.publication_id
      AND probe_set_version = 'search-gold@5'
      AND integrity_passed = 1
      AND evidence_coverage_passed = 1
      AND exact_search_passed = 1
      AND semantic_search_passed = 1
      AND structured_filter_passed = 1
      AND neutrality_passed = 1
      AND version_isolation_passed = 1
      AND model_slug_lookup_passed = 1
  ) THEN RAISE(ABORT, 'probe receipt does not prove every acceptance probe') END;
  SELECT CASE WHEN NEW.effective_valid_until_ms <> MIN(
    NEW.archive_observed_at_ms,
    NEW.serving_observed_at_ms,
    NEW.vector_observed_at_ms,
    NEW.probes_observed_at_ms
  ) + NEW.maximum_receipt_age_ms
    OR CAST(strftime('%s', 'now') AS INTEGER) * 1000 > NEW.effective_valid_until_ms
    OR NEW.ready_at_ms > CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 300000
  THEN RAISE(ABORT, 'readiness validity or clock bound is invalid') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_search_fts
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT exact_document_count FROM publication_closure_seal
    WHERE publication_id = NEW.publication_id
  ) OR EXISTS (
    SELECT 1 FROM publication_search_document AS source
    WHERE source.publication_id = NEW.publication_id
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
    WHERE indexed.publication_id = NEW.publication_id
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
  ) THEN RAISE(ABORT, 'exact search FTS does not match the sealed source rows') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_provider_search_document AS source
    WHERE source.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_fts AS indexed
        WHERE indexed.publication_id = source.publication_id
          AND indexed.provider_id = source.provider_id
          AND indexed.display_name = source.display_name
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_provider_search_fts AS indexed
    WHERE indexed.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_document AS source
        WHERE source.publication_id = indexed.publication_id
          AND source.provider_id = indexed.provider_id
          AND source.display_name = indexed.display_name
      )
  ) OR (
    SELECT count(*) FROM publication_provider_search_fts
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT provider_search_fts_document_count
    FROM publication_serving_receipt
    WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, 'provider search FTS does not match the canonical projection') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_model_variant_name_search_document
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT model_variant_name_storage_document_count
    FROM publication_serving_receipt
    WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, 'model/variant name storage does not match the canonical projection') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_provider_model_id_search_document
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT provider_model_id_storage_document_count
    FROM publication_serving_receipt
    WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, 'provider model ID storage does not match the canonical projection') END;
END;
CREATE TRIGGER publication_readiness_receipt_immutable_delete BEFORE DELETE ON publication_readiness_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_readiness_receipt_immutable_update BEFORE UPDATE ON publication_readiness_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_readiness_receipt_insert_guard
BEFORE INSERT ON publication_readiness_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = 'building'
      AND candidate.closure_hash = NEW.closure_hash
      AND candidate.schema_version = NEW.schema_version
      AND candidate.build_commit = NEW.build_commit
      AND seal.closure_hash = NEW.closure_hash
      AND seal.bundle_hash = NEW.bundle_hash
      AND NEW.observed_at_ms >= seal.sealed_at_ms
  ) THEN RAISE(ABORT, 'readiness receipt does not bind the sealed building publication') END;
END;
CREATE TRIGGER publication_serving_receipt_immutable_delete BEFORE DELETE ON publication_serving_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_serving_receipt_immutable_update BEFORE UPDATE ON publication_serving_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_serving_receipt_insert_guard
BEFORE INSERT ON publication_serving_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    JOIN publication_closure_seal AS seal USING (publication_id)
    JOIN publication_model_slug_artifact_proof AS proof USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'serving' AND candidate.state = 'building'
      AND proof.closure_hash = seal.closure_hash
      AND proof.base_bundle_hash = seal.bundle_hash
      AND NEW.model_slug_storage_version = 'model-slug-serving@1'
      AND NEW.model_slug_artifact_digest = proof.artifact_digest
      AND NEW.model_slug_projection_version = proof.projection_version
      AND NEW.model_slug_model_count = proof.model_count
      AND NEW.model_slug_mapping_count = proof.mapping_count
      AND NEW.model_slug_current_mapping_count = proof.current_mapping_count
      AND NEW.model_slug_historical_mapping_count = proof.historical_mapping_count
      AND NEW.model_slug_mapping_inventory_hash = proof.mapping_inventory_hash
      AND NEW.model_slug_queryable = 1
      AND NEW.model_slug_exact_parity = 1
  ) THEN RAISE(ABORT, 'serving receipt lacks its sealed Model slug binding') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
    WHERE name = 'publication_model_slug_exact_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*) FROM pragma_index_xinfo(
      'publication_model_slug_exact_idx'
    ) WHERE key = 1
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 1 AND name = 'slug' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 2 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      ELSE 0 END) = 3
  ) OR NOT EXISTS (
    SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
    WHERE name = 'publication_model_slug_current_model_idx'
      AND "unique" = 1 AND origin = 'c' AND partial = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type = 'index'
      AND name = 'publication_model_slug_current_model_idx'
      AND tbl_name = 'publication_model_slug_mapping'
      AND replace(replace(replace(replace(sql, char(10), ''),
        char(13), ''), char(9), ''), ' ', '') =
        'CREATEUNIQUEINDEXpublication_model_slug_current_model_idxONpublication_model_slug_mapping(publication_id,model_id)WHEREresolution=''current'''
  ) OR NOT EXISTS (
    SELECT count(*) FROM pragma_index_xinfo(
      'publication_model_slug_current_model_idx'
    ) WHERE key = 1
    HAVING count(*) = 2 AND sum(CASE
      WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 1 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      ELSE 0 END) = 2
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping AS expected
    WHERE expected.publication_id = NEW.publication_id
      AND expected.resolution = 'current'
      AND NOT EXISTS (
        SELECT 1 FROM publication_model_slug_mapping AS indexed
          INDEXED BY publication_model_slug_current_model_idx
        WHERE indexed.publication_id = expected.publication_id
          AND indexed.model_id = expected.model_id
          AND indexed.resolution = 'current'
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_exact_idx
    WHERE publication_id = NEW.publication_id AND slug = '__index_probe__'
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_current_model_idx
    WHERE publication_id = NEW.publication_id
      AND model_id = 'mdl_00000000-0000-4000-8000-000000000000'
      AND resolution = 'current'
  ) THEN RAISE(ABORT, 'serving Model slug indexes are missing or unqueryable') END;
END;
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
      AND CAST(strftime('%s', 'now') AS INTEGER) * 1000 <= effective_valid_until_ms
  ) THEN RAISE(ABORT, 'publication readiness lacks its exact attestation') END;
  SELECT CASE WHEN OLD.state = 'ready' AND NEW.state = 'active' AND NOT EXISTS (
    SELECT 1 FROM publication_switch_history AS history
    JOIN publication_switch_preflight AS preflight USING (switch_id)
    WHERE history.to_publication_id = NEW.publication_id
      AND history.action = 'activate'
      AND history.switched_at_ms = NEW.activated_at_ms
      AND (
        (history.expected_prior_generation = 0
          AND preflight.expected_prior_switched_at_ms IS NULL
          AND preflight.expected_prior_rollback_candidate_publication_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM publication_head))
        OR EXISTS (
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
    SELECT 1 FROM publication_switch_history AS history
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
      SELECT 1 FROM publication_provider_slice AS current_slice
      WHERE current_slice.publication_id = NEW.publication_id
        AND current_slice.provider_slice_id IS NOT NULL
        AND (
          (current_slice.carried_forward = 1 AND NOT EXISTS (
            SELECT 1 FROM publication_provider_slice AS prior_slice
            JOIN publication AS prior_publication ON prior_publication.publication_id = prior_slice.publication_id
            WHERE prior_slice.provider_slice_id = current_slice.provider_slice_id
              AND prior_slice.provider_id = current_slice.provider_id
              AND prior_slice.provider_run_id = current_slice.provider_run_id
              AND prior_publication.state IN ('active', 'superseded', 'rolled_back')
              AND prior_publication.activated_at_ms IS NOT NULL
              AND prior_publication.activated_at_ms <= NEW.generated_at_ms
          )) OR EXISTS (
            SELECT 1 FROM publication_provider_slice AS other_occurrence
            JOIN publication AS other_publication ON other_publication.publication_id = other_occurrence.publication_id
            WHERE other_occurrence.provider_slice_id = current_slice.provider_slice_id
              AND other_publication.generated_at_ms > NEW.generated_at_ms
              AND other_publication.state IN ('active', 'superseded', 'rolled_back')
          ) OR (current_slice.carried_forward = 0 AND EXISTS (
            SELECT 1 FROM publication_provider_slice AS prior_slice
            JOIN publication AS prior_publication ON prior_publication.publication_id = prior_slice.publication_id
            WHERE prior_slice.provider_slice_id = current_slice.provider_slice_id
              AND prior_publication.publication_id <> NEW.publication_id
              AND prior_publication.state IN ('ready', 'active', 'superseded', 'rolled_back')
          ))
        )
    ) OR NEW.resource_count = 0
  ) THEN RAISE(ABORT, 'publication selected content or provider lineage is incomplete') END;
END;
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
CREATE TRIGGER publication_switch_history_immutable_delete
BEFORE DELETE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, 'switch history cannot be deleted'); END;
CREATE TRIGGER publication_switch_history_immutable_update
BEFORE UPDATE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, 'switch history is append-only'); END;
CREATE TRIGGER publication_switch_history_insert_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM pragma_index_list('publication_provider_model_id_search_document')
    WHERE name = 'publication_provider_model_id_raw_exact_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*)
    FROM pragma_index_info('publication_provider_model_id_raw_exact_idx')
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND cid = 0 AND name = 'publication_id' THEN 1
      WHEN seqno = 1 AND cid = 7 AND name = 'raw_provider_model_id_utf8' THEN 1
      WHEN seqno = 2 AND cid = 2 AND name = 'offering_id' THEN 1
      ELSE 0 END) = 3
  ) OR NOT EXISTS (
    SELECT 1
    FROM pragma_index_list('publication_provider_model_id_search_document')
    WHERE name = 'publication_provider_model_id_normalized_exact_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*)
    FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx')
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND cid = 0 AND name = 'publication_id' THEN 1
      WHEN seqno = 1 AND cid = 8 AND name = 'normalized_provider_model_id_utf8' THEN 1
      WHEN seqno = 2 AND cid = 2 AND name = 'offering_id' THEN 1
      ELSE 0 END) = 3
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_raw_exact_idx
    WHERE publication_id = NEW.to_publication_id
      AND raw_provider_model_id_utf8 = X'FF'
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_normalized_exact_idx
    WHERE publication_id = NEW.to_publication_id
      AND normalized_provider_model_id_utf8 = X'FF'
  ) THEN RAISE(ABORT, 'switch-time provider model ID exact indexes are missing malformed or unqueryable') END;
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
  ) THEN RAISE(ABORT, 'switch-time provider FTS parity changed after preflight') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_model_variant_name_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> (
    SELECT model_variant_name_storage_document_count
    FROM publication_switch_preflight
    WHERE switch_id = NEW.switch_id
  ) THEN RAISE(ABORT, 'switch-time model/variant name storage changed after preflight') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_provider_model_id_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> (
    SELECT provider_model_id_storage_document_count
    FROM publication_switch_preflight
    WHERE switch_id = NEW.switch_id
  ) THEN RAISE(ABORT, 'switch-time provider model ID storage changed after preflight') END;
END;
CREATE TRIGGER publication_switch_history_provider_eligibility_index_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM pragma_index_list('publication_provider_model_id_search_document')
    WHERE name = 'publication_provider_model_id_eligibility_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
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
  ) OR EXISTS (
    SELECT 1
    FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_eligibility_idx
    WHERE publication_id = NEW.to_publication_id
      AND provider_id = 'prv_ffffffff-ffff-4fff-bfff-ffffffffffff'
      -- This value is impossible under the projection table CHECK, so a
      -- legitimate all-ffff tuple can never be mistaken for probe failure.
      AND target_resource_type = '__queryability_probe__'
      AND target_resource_id = 'mdl_ffffffff-ffff-4fff-bfff-ffffffffffff'
      AND offering_id = 'off_ffffffff-ffff-4fff-bfff-ffffffffffff'
  ) THEN RAISE(ABORT, 'switch-time provider eligibility index is missing malformed or unqueryable') END;
END;
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
CREATE TRIGGER publication_switch_history_model_slug_index_guard
BEFORE INSERT ON publication_switch_history
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
    WHERE name = 'publication_model_slug_exact_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*) FROM pragma_index_xinfo(
      'publication_model_slug_exact_idx'
    ) WHERE key = 1
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 1 AND name = 'slug' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 2 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      ELSE 0 END) = 3
  ) OR NOT EXISTS (
    SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
    WHERE name = 'publication_model_slug_current_model_idx'
      AND "unique" = 1 AND origin = 'c' AND partial = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type = 'index'
      AND name = 'publication_model_slug_current_model_idx'
      AND tbl_name = 'publication_model_slug_mapping'
      AND replace(replace(replace(replace(sql, char(10), ''),
        char(13), ''), char(9), ''), ' ', '') =
        'CREATEUNIQUEINDEXpublication_model_slug_current_model_idxONpublication_model_slug_mapping(publication_id,model_id)WHEREresolution=''current'''
  ) OR NOT EXISTS (
    SELECT count(*) FROM pragma_index_xinfo(
      'publication_model_slug_current_model_idx'
    ) WHERE key = 1
    HAVING count(*) = 2 AND sum(CASE
      WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 1 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      ELSE 0 END) = 2
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping AS expected
    WHERE expected.publication_id = NEW.to_publication_id
      AND expected.resolution = 'current'
      AND NOT EXISTS (
        SELECT 1 FROM publication_model_slug_mapping AS indexed
          INDEXED BY publication_model_slug_current_model_idx
        WHERE indexed.publication_id = expected.publication_id
          AND indexed.model_id = expected.model_id
          AND indexed.resolution = 'current'
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_exact_idx
    WHERE publication_id = NEW.to_publication_id AND slug = '__index_probe__'
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_current_model_idx
    WHERE publication_id = NEW.to_publication_id
      AND model_id = 'mdl_00000000-0000-4000-8000-000000000000'
      AND resolution = 'current'
  ) THEN RAISE(ABORT, 'switch-time Model slug indexes are missing malformed or unqueryable') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_switch_preflight AS preflight
    JOIN publication_model_slug_artifact_proof AS proof
      ON proof.publication_id = preflight.to_publication_id
    JOIN publication_readiness_receipt AS archive_receipt
      ON archive_receipt.publication_id = preflight.to_publication_id
      AND archive_receipt.kind = 'archive'
    WHERE preflight.switch_id = NEW.switch_id
      AND preflight.to_publication_id = NEW.to_publication_id
      AND preflight.to_closure_hash = proof.closure_hash
      AND preflight.archive_bundle_hash = proof.base_bundle_hash
      AND preflight.archive_model_slug_artifact_digest = proof.artifact_digest
      AND preflight.archive_model_slug_model_count = proof.model_count
      AND preflight.archive_model_slug_mapping_count = proof.mapping_count
      AND preflight.archive_model_slug_current_mapping_count = proof.current_mapping_count
      AND preflight.archive_model_slug_historical_mapping_count = proof.historical_mapping_count
      AND preflight.archive_model_slug_mapping_inventory_hash = proof.mapping_inventory_hash
      AND preflight.archive_model_slug_read_verified = 1
      AND preflight.archive_model_slug_immutable = 1
      AND preflight.archive_receipt_hash = archive_receipt.receipt_hash
      AND archive_receipt.receipt_version = '5.0.0'
      AND preflight.serving_model_slug_artifact_digest = proof.artifact_digest
      AND preflight.serving_model_slug_model_count = proof.model_count
      AND preflight.serving_model_slug_mapping_count = proof.mapping_count
      AND preflight.serving_model_slug_current_mapping_count = proof.current_mapping_count
      AND preflight.serving_model_slug_historical_mapping_count = proof.historical_mapping_count
      AND preflight.serving_model_slug_mapping_inventory_hash = proof.mapping_inventory_hash
      AND preflight.serving_model_slug_queryable = 1
      AND preflight.serving_model_slug_exact_parity = 1
      AND preflight.model_slug_lookup_passed = 1
  ) THEN RAISE(ABORT, 'switch-time Model slug proof changed after preflight') END;
END;
CREATE TRIGGER publication_switch_preflight_immutable_delete
BEFORE DELETE ON publication_switch_preflight
BEGIN SELECT RAISE(ABORT, 'switch preflight cannot be deleted'); END;
CREATE TRIGGER publication_switch_preflight_immutable_update
BEFORE UPDATE ON publication_switch_preflight
BEGIN SELECT RAISE(ABORT, 'switch preflight is immutable'); END;
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
    (NEW.expected_prior_generation = 0
      AND NEW.new_generation = 1
      AND NEW.from_publication_id IS NULL
      AND NEW.expected_prior_rollback_candidate_publication_id IS NULL
      AND NEW.expected_prior_switched_at_ms IS NULL
      AND NEW.action = 'activate'
      AND NOT EXISTS (SELECT 1 FROM publication_head))
    OR (NEW.expected_prior_generation >= 1 AND EXISTS (
      SELECT 1 FROM publication_head AS head
      JOIN publication AS current ON current.publication_id = head.active_publication_id
      WHERE head.singleton = 1
        AND head.generation = NEW.expected_prior_generation
        AND head.active_publication_id = NEW.from_publication_id
        AND head.rollback_candidate_publication_id IS NEW.expected_prior_rollback_candidate_publication_id
        AND head.switched_at_ms = NEW.expected_prior_switched_at_ms
        AND head.switched_at_ms < NEW.switched_at_ms
        AND current.state = 'active'
        AND current.closure_hash = NEW.from_closure_hash
    ))
  ) THEN RAISE(ABORT, 'switch preflight does not match the exact head generation') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication AS target
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
      AND NEW.provider_search_document_count = (
        SELECT count(*) FROM publication_provider_search_document
        WHERE publication_id = NEW.to_publication_id
      )
      AND NEW.provider_search_fts_document_count = NEW.provider_search_document_count
      AND NEW.provider_search_fts_document_count = (
        SELECT count(*) FROM publication_provider_search_fts
        WHERE publication_id = NEW.to_publication_id
      )
      AND NEW.provider_search_fts_queryable = 1
      AND NEW.provider_search_exact_parity = 1
      AND NEW.model_variant_name_document_count = (
        SELECT count(*) FROM publication_model_variant_name_search_document
        WHERE publication_id = NEW.to_publication_id
      )
      AND NEW.model_variant_name_storage_document_count = NEW.model_variant_name_document_count
      AND NEW.model_variant_name_storage_queryable = 1
      AND NEW.model_variant_name_storage_exact_parity = 1
      AND NEW.provider_model_id_document_count = (
        SELECT count(*) FROM publication_provider_model_id_search_document
        WHERE publication_id = NEW.to_publication_id
      )
      AND NEW.provider_model_id_storage_document_count = NEW.provider_model_id_document_count
      AND NEW.provider_model_id_storage_queryable = 1
      AND NEW.provider_model_id_storage_exact_parity = 1
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

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_model_slug_artifact_proof AS proof
    JOIN publication_closure_seal AS seal USING (publication_id)
    JOIN publication_readiness_receipt AS archive_receipt
      ON archive_receipt.publication_id = proof.publication_id
      AND archive_receipt.kind = 'archive'
    WHERE proof.publication_id = NEW.to_publication_id
      AND proof.closure_hash = NEW.to_closure_hash
      AND proof.base_bundle_hash = NEW.archive_bundle_hash
      AND NEW.archive_model_slug_artifact_version = proof.artifact_version
      AND NEW.archive_model_slug_acquisition_version = proof.acquisition_version
      AND NEW.archive_model_slug_projection_version = proof.projection_version
      AND NEW.archive_model_slug_artifact_digest = proof.artifact_digest
      AND NEW.archive_model_slug_artifact_byte_count = proof.artifact_byte_count
      AND NEW.archive_model_slug_source_history_count = proof.source_history_count
      AND NEW.archive_model_slug_source_history_hash = proof.source_history_hash
      AND NEW.archive_model_slug_model_count = proof.model_count
      AND NEW.archive_model_slug_mapping_count = proof.mapping_count
      AND NEW.archive_model_slug_current_mapping_count = proof.current_mapping_count
      AND NEW.archive_model_slug_historical_mapping_count = proof.historical_mapping_count
      AND NEW.archive_model_slug_mapping_inventory_hash = proof.mapping_inventory_hash
      AND NEW.archive_model_slug_read_verified = 1
      AND NEW.archive_model_slug_immutable = 1
      AND NEW.archive_receipt_hash = archive_receipt.receipt_hash
      AND archive_receipt.receipt_version = '5.0.0'
      AND NEW.serving_model_slug_storage_version = 'model-slug-serving@1'
      AND NEW.serving_model_slug_artifact_digest = proof.artifact_digest
      AND NEW.serving_model_slug_projection_version = proof.projection_version
      AND NEW.serving_model_slug_model_count = proof.model_count
      AND NEW.serving_model_slug_mapping_count = proof.mapping_count
      AND NEW.serving_model_slug_current_mapping_count = proof.current_mapping_count
      AND NEW.serving_model_slug_historical_mapping_count = proof.historical_mapping_count
      AND NEW.serving_model_slug_mapping_inventory_hash = proof.mapping_inventory_hash
      AND NEW.serving_model_slug_queryable = 1
      AND NEW.serving_model_slug_exact_parity = 1
      AND NEW.model_slug_lookup_passed = 1
      AND proof.model_count = (
        SELECT count(*) FROM publication_resource
        WHERE publication_id = NEW.to_publication_id
          AND resource_type = 'model'
      )
      AND proof.mapping_count = (
        SELECT count(*) FROM publication_model_slug_mapping
        WHERE publication_id = NEW.to_publication_id
      )
      AND proof.current_mapping_count = (
        SELECT count(*) FROM publication_model_slug_mapping
        WHERE publication_id = NEW.to_publication_id
          AND resolution = 'current'
      )
      AND proof.historical_mapping_count = (
        SELECT count(*) FROM publication_model_slug_mapping
        WHERE publication_id = NEW.to_publication_id
          AND resolution = 'historical'
      )
  ) THEN RAISE(ABORT, 'switch preflight does not prove the archive-bound Model slug projection') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
    WHERE name = 'publication_model_slug_exact_idx'
      AND "unique" = 0 AND origin = 'c' AND partial = 0
  ) OR NOT EXISTS (
    SELECT count(*) FROM pragma_index_xinfo(
      'publication_model_slug_exact_idx'
    ) WHERE key = 1
    HAVING count(*) = 3 AND sum(CASE
      WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 1 AND name = 'slug' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 2 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      ELSE 0 END) = 3
  ) OR NOT EXISTS (
    SELECT 1 FROM pragma_index_list('publication_model_slug_mapping')
    WHERE name = 'publication_model_slug_current_model_idx'
      AND "unique" = 1 AND origin = 'c' AND partial = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM sqlite_schema
    WHERE type = 'index'
      AND name = 'publication_model_slug_current_model_idx'
      AND tbl_name = 'publication_model_slug_mapping'
      AND replace(replace(replace(replace(sql, char(10), ''),
        char(13), ''), char(9), ''), ' ', '') =
        'CREATEUNIQUEINDEXpublication_model_slug_current_model_idxONpublication_model_slug_mapping(publication_id,model_id)WHEREresolution=''current'''
  ) OR NOT EXISTS (
    SELECT count(*) FROM pragma_index_xinfo(
      'publication_model_slug_current_model_idx'
    ) WHERE key = 1
    HAVING count(*) = 2 AND sum(CASE
      WHEN seqno = 0 AND name = 'publication_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      WHEN seqno = 1 AND name = 'model_id' AND desc = 0 AND coll = 'BINARY' THEN 1
      ELSE 0 END) = 2
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping AS expected
    WHERE expected.publication_id = NEW.to_publication_id
      AND expected.resolution = 'current'
      AND NOT EXISTS (
        SELECT 1 FROM publication_model_slug_mapping AS indexed
          INDEXED BY publication_model_slug_current_model_idx
        WHERE indexed.publication_id = expected.publication_id
          AND indexed.model_id = expected.model_id
          AND indexed.resolution = 'current'
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_exact_idx
    WHERE publication_id = NEW.to_publication_id AND slug = '__index_probe__'
  ) OR EXISTS (
    SELECT 1 FROM publication_model_slug_mapping
      INDEXED BY publication_model_slug_current_model_idx
    WHERE publication_id = NEW.to_publication_id
      AND model_id = 'mdl_00000000-0000-4000-8000-000000000000'
      AND resolution = 'current'
  ) THEN RAISE(ABORT, 'switch preflight Model slug indexes are missing or unqueryable') END;
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
  SELECT CASE WHEN EXISTS (
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
  ) THEN RAISE(ABORT, 'switch preflight provider FTS does not exactly match its source') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_model_variant_name_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> NEW.model_variant_name_storage_document_count
  THEN RAISE(ABORT, 'switch preflight model/variant name storage changed') END;
  SELECT CASE WHEN (
    SELECT count(*) FROM publication_provider_model_id_search_document
    WHERE publication_id = NEW.to_publication_id
  ) <> NEW.provider_model_id_storage_document_count
  THEN RAISE(ABORT, 'switch preflight provider model ID storage changed') END;
  SELECT CASE WHEN NEW.action = 'activate' AND NOT EXISTS (
    SELECT 1 FROM publication AS target
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
    SELECT 1 FROM publication_head AS head
    JOIN publication AS target ON target.publication_id = NEW.to_publication_id
    WHERE head.singleton = 1
      AND head.rollback_candidate_publication_id = target.publication_id
      AND target.state = 'superseded'
  ) THEN RAISE(ABORT, 'rollback target is not the immediate superseded publication') END;
END;
CREATE TRIGGER publication_vector_receipt_immutable_delete BEFORE DELETE ON publication_vector_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_vector_receipt_immutable_update BEFORE UPDATE ON publication_vector_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_vector_receipt_insert_guard
BEFORE INSERT ON publication_vector_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'vectors' AND candidate.state = 'building'
  ) THEN RAISE(ABORT, 'vector receipt lacks its sealed binding') END;
END;

UPDATE serving_schema_metadata
SET schema_version = '1.13.0'
WHERE singleton = 1;
