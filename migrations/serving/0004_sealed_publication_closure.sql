-- Sealed serving-closure persistence and fail-closed readiness boundary.
-- Requirements: SRCH-006, PIPE-044, PIPE-050–PIPE-052, BE-011, QA-006.

PRAGMA defer_foreign_keys = true;

-- These read-only preflights deliberately abort before the first schema mutation.
SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.1.0'
) <> 1 THEN json('') END;

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication
  WHERE state IN ('ready', 'active', 'superseded', 'rolled_back')
) OR EXISTS (
  SELECT 1 FROM publication_head
) THEN json('') END;

CREATE TABLE publication_staging_revision (
  publication_id TEXT PRIMARY KEY REFERENCES publication(publication_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 0)
);

INSERT INTO publication_staging_revision(publication_id, revision)
SELECT publication_id, 0 FROM publication;

CREATE TABLE publication_provider_slice_metadata (
  publication_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  adapter_version TEXT NOT NULL CHECK (length(adapter_version) BETWEEN 1 AND 128 AND adapter_version NOT GLOB '*[^ -~]*'),
  roster_version TEXT NOT NULL CHECK (length(roster_version) BETWEEN 1 AND 128 AND roster_version NOT GLOB '*[^ -~]*'),
  source_register_version TEXT NOT NULL CHECK (length(source_register_version) BETWEEN 1 AND 128 AND source_register_version NOT GLOB '*[^ -~]*'),
  PRIMARY KEY (publication_id, provider_id),
  FOREIGN KEY (publication_id, provider_id)
    REFERENCES publication_provider_slice(publication_id, provider_id)
    ON DELETE RESTRICT
);

CREATE TABLE publication_provider_attribution (
  publication_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('provider', 'offering', 'price', 'precision_observation')),
  resource_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  PRIMARY KEY (publication_id, resource_type, resource_id),
  FOREIGN KEY (publication_id, resource_type, resource_id)
    REFERENCES publication_resource(publication_id, resource_type, resource_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (publication_id, provider_id)
    REFERENCES publication_provider_slice(publication_id, provider_id)
    ON DELETE RESTRICT
);

CREATE TABLE publication_vector_inventory (
  publication_id TEXT NOT NULL,
  vector_namespace TEXT NOT NULL CHECK (vector_namespace = publication_id),
  vector_id TEXT NOT NULL CHECK (length(vector_id) = 64 AND vector_id = lower(vector_id) AND vector_id NOT GLOB '*[^0-9a-f]*'),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('model', 'variant')),
  resource_id TEXT NOT NULL,
  search_document_content_hash TEXT NOT NULL CHECK (length(search_document_content_hash) = 71 AND substr(search_document_content_hash, 1, 7) = 'sha256:' AND substr(search_document_content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  embedding_input_hash TEXT NOT NULL CHECK (length(embedding_input_hash) = 71 AND substr(embedding_input_hash, 1, 7) = 'sha256:' AND substr(embedding_input_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (publication_id, vector_id),
  UNIQUE (publication_id, resource_type, resource_id),
  FOREIGN KEY (publication_id, vector_id)
    REFERENCES publication_search_document(publication_id, document_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (publication_id, resource_type, resource_id)
    REFERENCES publication_search_document(publication_id, resource_type, resource_id)
    ON DELETE RESTRICT
);

CREATE TABLE publication_inventory_chunk (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('resources', 'exact_search', 'vectors')),
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal >= 0),
  first_key TEXT NOT NULL CHECK (length(first_key) BETWEEN 1 AND 512 AND first_key NOT GLOB '*[^ -~]*'),
  last_key TEXT NOT NULL CHECK (length(last_key) BETWEEN 1 AND 512 AND last_key NOT GLOB '*[^ -~]*' AND first_key <= last_key),
  item_count INTEGER NOT NULL CHECK (typeof(item_count) = 'integer' AND item_count >= 1),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (publication_id, kind, ordinal)
);

CREATE TABLE publication_closure_seal (
  publication_id TEXT PRIMARY KEY REFERENCES publication(publication_id) ON DELETE RESTRICT,
  staging_revision INTEGER NOT NULL CHECK (typeof(staging_revision) = 'integer' AND staging_revision >= 0),
  manifest_contract_version TEXT NOT NULL CHECK (manifest_contract_version = '1.0.0'),
  hash_domain TEXT NOT NULL CHECK (hash_domain = 'publication-closure'),
  hash_encoding_version TEXT NOT NULL CHECK (hash_encoding_version = '1'),
  enabled_provider_scope_version TEXT NOT NULL CHECK (length(enabled_provider_scope_version) BETWEEN 1 AND 128 AND enabled_provider_scope_version NOT GLOB '*[^ -~]*'),
  enabled_provider_count INTEGER NOT NULL CHECK (typeof(enabled_provider_count) = 'integer' AND enabled_provider_count >= 1),
  provider_slice_count INTEGER NOT NULL CHECK (typeof(provider_slice_count) = 'integer' AND provider_slice_count >= 1),
  provider_attribution_count INTEGER NOT NULL CHECK (typeof(provider_attribution_count) = 'integer' AND provider_attribution_count >= 0),
  resource_count INTEGER NOT NULL CHECK (typeof(resource_count) = 'integer' AND resource_count >= 1),
  exact_document_count INTEGER NOT NULL CHECK (typeof(exact_document_count) = 'integer' AND exact_document_count >= 0),
  vector_document_count INTEGER NOT NULL CHECK (typeof(vector_document_count) = 'integer' AND vector_document_count >= 0),
  chunk_count INTEGER NOT NULL CHECK (typeof(chunk_count) = 'integer' AND chunk_count >= 1),
  bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 71 AND substr(bundle_hash, 1, 7) = 'sha256:' AND substr(bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  enabled_provider_scope_hash TEXT NOT NULL CHECK (length(enabled_provider_scope_hash) = 71 AND substr(enabled_provider_scope_hash, 1, 7) = 'sha256:' AND substr(enabled_provider_scope_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_slice_hash TEXT NOT NULL CHECK (length(provider_slice_hash) = 71 AND substr(provider_slice_hash, 1, 7) = 'sha256:' AND substr(provider_slice_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_attribution_hash TEXT NOT NULL CHECK (length(provider_attribution_hash) = 71 AND substr(provider_attribution_hash, 1, 7) = 'sha256:' AND substr(provider_attribution_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  resource_inventory_hash TEXT NOT NULL CHECK (length(resource_inventory_hash) = 71 AND substr(resource_inventory_hash, 1, 7) = 'sha256:' AND substr(resource_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  exact_search_inventory_hash TEXT NOT NULL CHECK (length(exact_search_inventory_hash) = 71 AND substr(exact_search_inventory_hash, 1, 7) = 'sha256:' AND substr(exact_search_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  vector_inventory_hash TEXT NOT NULL CHECK (length(vector_inventory_hash) = 71 AND substr(vector_inventory_hash, 1, 7) = 'sha256:' AND substr(vector_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  chunk_root_hash TEXT NOT NULL CHECK (length(chunk_root_hash) = 71 AND substr(chunk_root_hash, 1, 7) = 'sha256:' AND substr(chunk_root_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = 'sha256:' AND substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  sealed_at_ms INTEGER NOT NULL CHECK (typeof(sealed_at_ms) = 'integer' AND sealed_at_ms >= 0)
);

CREATE INDEX publication_provider_attribution_provider_idx
ON publication_provider_attribution(publication_id, provider_id, resource_type, resource_id);

CREATE INDEX publication_vector_resource_idx
ON publication_vector_inventory(publication_id, resource_type, resource_id);

CREATE INDEX publication_chunk_kind_idx
ON publication_inventory_chunk(publication_id, kind, ordinal);

CREATE TRIGGER publication_staging_revision_seed
AFTER INSERT ON publication
BEGIN
  INSERT INTO publication_staging_revision(publication_id, revision)
  VALUES (NEW.publication_id, 0);
END;

CREATE TRIGGER publication_provider_slice_metadata_insert_guard
BEFORE INSERT ON publication_provider_slice_metadata
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = 'building'
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, 'closure rows may be staged only while building and unsealed') END;
END;

CREATE TRIGGER publication_provider_attribution_insert_guard
BEFORE INSERT ON publication_provider_attribution
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = 'building'
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, 'closure rows may be staged only while building and unsealed') END;
  SELECT CASE WHEN NEW.resource_type = 'provider' AND NEW.resource_id <> NEW.provider_id
    THEN RAISE(ABORT, 'provider resource attribution must match its provider identity') END;
END;

CREATE TRIGGER publication_vector_inventory_insert_guard
BEFORE INSERT ON publication_vector_inventory
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = 'building'
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, 'closure rows may be staged only while building and unsealed') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_search_document
    WHERE publication_id = NEW.publication_id
      AND document_id = NEW.vector_id
      AND resource_type = NEW.resource_type
      AND resource_id = NEW.resource_id
      AND content_hash = NEW.search_document_content_hash
  ) THEN RAISE(ABORT, 'vector inventory does not match its search document') END;
END;

CREATE TRIGGER publication_inventory_chunk_insert_guard
BEFORE INSERT ON publication_inventory_chunk
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = NEW.publication_id AND state = 'building'
  ) OR EXISTS (
    SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id
  ) THEN RAISE(ABORT, 'closure rows may be staged only while building and unsealed') END;
END;

CREATE TRIGGER publication_resource_post_seal_insert_guard
BEFORE INSERT ON publication_resource
WHEN EXISTS (SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id)
BEGIN SELECT RAISE(ABORT, 'sealed publication closure is immutable'); END;

CREATE TRIGGER publication_search_post_seal_insert_guard
BEFORE INSERT ON publication_search_document
WHEN EXISTS (SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id)
BEGIN SELECT RAISE(ABORT, 'sealed publication closure is immutable'); END;

CREATE TRIGGER publication_provider_slice_post_seal_insert_guard
BEFORE INSERT ON publication_provider_slice
WHEN EXISTS (SELECT 1 FROM publication_closure_seal WHERE publication_id = NEW.publication_id)
BEGIN SELECT RAISE(ABORT, 'sealed publication closure is immutable'); END;

CREATE TRIGGER publication_provider_slice_revision
AFTER INSERT ON publication_provider_slice
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END;
CREATE TRIGGER publication_resource_revision
AFTER INSERT ON publication_resource
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END;
CREATE TRIGGER publication_search_revision
AFTER INSERT ON publication_search_document
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END;
CREATE TRIGGER publication_provider_slice_metadata_revision
AFTER INSERT ON publication_provider_slice_metadata
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END;
CREATE TRIGGER publication_provider_attribution_revision
AFTER INSERT ON publication_provider_attribution
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END;
CREATE TRIGGER publication_vector_inventory_revision
AFTER INSERT ON publication_vector_inventory
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END;
CREATE TRIGGER publication_inventory_chunk_revision
AFTER INSERT ON publication_inventory_chunk
BEGIN UPDATE publication_staging_revision SET revision = revision + 1 WHERE publication_id = NEW.publication_id; END;

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
END;

CREATE TRIGGER publication_closure_seal_immutable_update
BEFORE UPDATE ON publication_closure_seal
BEGIN SELECT RAISE(ABORT, 'publication closure seal is immutable'); END;
CREATE TRIGGER publication_closure_seal_immutable_delete
BEFORE DELETE ON publication_closure_seal
BEGIN SELECT RAISE(ABORT, 'publication closure seal cannot be deleted'); END;

CREATE TRIGGER publication_provider_slice_metadata_immutable_update
BEFORE UPDATE ON publication_provider_slice_metadata
BEGIN SELECT RAISE(ABORT, 'publication closure row is immutable'); END;
CREATE TRIGGER publication_provider_slice_metadata_immutable_delete
BEFORE DELETE ON publication_provider_slice_metadata
BEGIN SELECT RAISE(ABORT, 'publication closure row cannot be deleted'); END;
CREATE TRIGGER publication_provider_attribution_immutable_update
BEFORE UPDATE ON publication_provider_attribution
BEGIN SELECT RAISE(ABORT, 'publication closure row is immutable'); END;
CREATE TRIGGER publication_provider_attribution_immutable_delete
BEFORE DELETE ON publication_provider_attribution
BEGIN SELECT RAISE(ABORT, 'publication closure row cannot be deleted'); END;
CREATE TRIGGER publication_vector_inventory_immutable_update
BEFORE UPDATE ON publication_vector_inventory
BEGIN SELECT RAISE(ABORT, 'publication closure row is immutable'); END;
CREATE TRIGGER publication_vector_inventory_immutable_delete
BEFORE DELETE ON publication_vector_inventory
BEGIN SELECT RAISE(ABORT, 'publication closure row cannot be deleted'); END;
CREATE TRIGGER publication_inventory_chunk_immutable_update
BEFORE UPDATE ON publication_inventory_chunk
BEGIN SELECT RAISE(ABORT, 'publication closure row is immutable'); END;
CREATE TRIGGER publication_inventory_chunk_immutable_delete
BEFORE DELETE ON publication_inventory_chunk
BEGIN SELECT RAISE(ABORT, 'publication closure row cannot be deleted'); END;
CREATE TRIGGER publication_staging_revision_immutable_update
BEFORE UPDATE ON publication_staging_revision
WHEN NEW.publication_id <> OLD.publication_id
  OR NEW.revision <> OLD.revision + 1
  OR NOT EXISTS (
    SELECT 1 FROM publication
    WHERE publication_id = OLD.publication_id AND state = 'building'
  )
  OR EXISTS (
  SELECT 1 FROM publication_closure_seal WHERE publication_id = OLD.publication_id
)
BEGIN SELECT RAISE(ABORT, 'publication staging revision is trigger-managed'); END;
CREATE TRIGGER publication_staging_revision_immutable_delete
BEFORE DELETE ON publication_staging_revision
BEGIN SELECT RAISE(ABORT, 'publication staging revision cannot be deleted'); END;

DROP TRIGGER publication_state_transition;
CREATE TRIGGER publication_state_transition
BEFORE UPDATE OF state, ready_at_ms, activated_at_ms, failure_codes_json ON publication
BEGIN
  SELECT CASE WHEN NEW.state = 'ready'
    THEN RAISE(ABORT, 'readiness receipts are not persisted') END;
  SELECT CASE WHEN NOT (
    (OLD.state = 'building' AND NEW.state = 'failed') OR
    (OLD.state = NEW.state)
  ) THEN RAISE(ABORT, 'invalid publication state transition') END;
END;

DROP TRIGGER publication_head_state_insert;
DROP TRIGGER publication_head_state_update;
CREATE TRIGGER publication_head_closed_insert
BEFORE INSERT ON publication_head
BEGIN SELECT RAISE(ABORT, 'publication head switching is not implemented'); END;
CREATE TRIGGER publication_head_closed_update
BEFORE UPDATE ON publication_head
BEGIN SELECT RAISE(ABORT, 'publication head switching is not implemented'); END;
CREATE TRIGGER publication_head_closed_delete
BEFORE DELETE ON publication_head
BEGIN SELECT RAISE(ABORT, 'publication head switching is not implemented'); END;

UPDATE serving_schema_metadata
SET schema_version = '1.2.0'
WHERE singleton = 1;
