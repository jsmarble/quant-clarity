-- QuantClarity serving D1 publication control and immutable resource source tables.
-- Requirements: PIPE-050–PIPE-056, BE-007, BE-011.

CREATE TABLE serving_schema_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

INSERT INTO serving_schema_metadata (singleton, schema_version, created_at_ms)
VALUES (1, '1.0.0', 0);

CREATE TABLE publication (
  publication_id TEXT PRIMARY KEY CHECK (length(publication_id) = 40 AND substr(publication_id, 1, 4) = 'pub_' AND publication_id = lower(publication_id)),
  state TEXT NOT NULL CHECK (state IN ('building', 'ready', 'active', 'superseded', 'rolled_back', 'failed')),
  schema_version TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  precision_normalization_version TEXT NOT NULL,
  precision_display_order_version TEXT NOT NULL,
  price_policy_version TEXT NOT NULL,
  source_policy_version TEXT NOT NULL,
  embedding_version TEXT NOT NULL,
  build_commit TEXT NOT NULL CHECK (build_commit <> ''),
  source_run_id TEXT NOT NULL CHECK (length(source_run_id) = 40 AND substr(source_run_id, 1, 4) = 'run_'),
  parent_publication_id TEXT REFERENCES publication(publication_id) ON DELETE RESTRICT,
  generated_at_ms INTEGER NOT NULL CHECK (typeof(generated_at_ms) = 'integer' AND generated_at_ms >= 0),
  ready_at_ms INTEGER CHECK (ready_at_ms IS NULL OR (typeof(ready_at_ms) = 'integer' AND ready_at_ms >= generated_at_ms)),
  activated_at_ms INTEGER CHECK (activated_at_ms IS NULL OR (typeof(activated_at_ms) = 'integer' AND activated_at_ms >= COALESCE(ready_at_ms, generated_at_ms))),
  resource_count INTEGER NOT NULL CHECK (typeof(resource_count) = 'integer' AND resource_count >= 0),
  exact_document_count INTEGER NOT NULL CHECK (typeof(exact_document_count) = 'integer' AND exact_document_count >= 0),
  vector_document_count INTEGER NOT NULL CHECK (typeof(vector_document_count) = 'integer' AND vector_document_count >= 0),
  exact_index_hash TEXT NOT NULL CHECK (length(exact_index_hash) = 71 AND substr(exact_index_hash, 1, 7) = 'sha256:' AND substr(exact_index_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  vector_index_version TEXT NOT NULL,
  closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = 'sha256:' AND substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  failure_codes_json TEXT NOT NULL CHECK (json_valid(failure_codes_json) AND json_type(failure_codes_json) = 'array'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  CHECK (parent_publication_id IS NULL OR parent_publication_id <> publication_id),
  CHECK (
    (state IN ('building', 'failed') AND ready_at_ms IS NULL AND activated_at_ms IS NULL) OR
    (state = 'ready' AND ready_at_ms IS NOT NULL AND activated_at_ms IS NULL) OR
    (state IN ('active', 'superseded', 'rolled_back') AND ready_at_ms IS NOT NULL AND activated_at_ms IS NOT NULL)
  ),
  CHECK ((state = 'failed' AND failure_codes_json <> '[]') OR (state <> 'failed' AND failure_codes_json = '[]'))
);

CREATE TABLE publication_provider_slice (
  provider_slice_id TEXT PRIMARY KEY CHECK (length(provider_slice_id) = 40 AND substr(provider_slice_id, 1, 4) = 'prn_' AND provider_slice_id = lower(provider_slice_id)),
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL CHECK (length(provider_id) = 40 AND substr(provider_id, 1, 4) = 'prv_'),
  provider_run_id TEXT NOT NULL CHECK (length(provider_run_id) = 40 AND substr(provider_run_id, 1, 4) = 'pvr_'),
  carried_forward INTEGER NOT NULL CHECK (carried_forward IN (0, 1)),
  freshness_state TEXT NOT NULL CHECK (freshness_state IN ('fresh', 'stale', 'unavailable')),
  CHECK (
    (carried_forward = 1 AND freshness_state IN ('fresh', 'stale')) OR
    (carried_forward = 0 AND freshness_state IN ('fresh', 'unavailable'))
  ),
  UNIQUE (publication_id, provider_id)
);

CREATE TABLE publication_resource (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('model_family', 'model', 'variant', 'provider', 'offering', 'price', 'precision_observation', 'evidence_summary')),
  resource_id TEXT NOT NULL CHECK (length(resource_id) = 40),
  resource_json TEXT NOT NULL CHECK (json_valid(resource_json) AND json_type(resource_json) = 'object'),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (publication_id, resource_type, resource_id)
);

CREATE TABLE publication_search_document (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  document_id TEXT NOT NULL CHECK (length(document_id) = 64 AND document_id = lower(document_id) AND document_id NOT GLOB '*[^0-9a-f]*'),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('model', 'variant')),
  resource_id TEXT NOT NULL CHECK (length(resource_id) = 40),
  normalized_name TEXT NOT NULL CHECK (normalized_name <> ''),
  aliases_json TEXT NOT NULL CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),
  publisher_name TEXT NOT NULL,
  provider_model_ids_json TEXT NOT NULL CHECK (json_valid(provider_model_ids_json) AND json_type(provider_model_ids_json) = 'array'),
  document_text TEXT NOT NULL CHECK (document_text <> ''),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 71 AND substr(content_hash, 1, 7) = 'sha256:' AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (publication_id, document_id),
  UNIQUE (publication_id, resource_type, resource_id),
  FOREIGN KEY (publication_id, resource_type, resource_id) REFERENCES publication_resource(publication_id, resource_type, resource_id) ON DELETE RESTRICT
);

CREATE TABLE publication_head (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active_publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  rollback_candidate_publication_id TEXT REFERENCES publication(publication_id) ON DELETE RESTRICT,
  switched_at_ms INTEGER NOT NULL CHECK (typeof(switched_at_ms) = 'integer' AND switched_at_ms >= 0),
  generation INTEGER NOT NULL CHECK (typeof(generation) = 'integer' AND generation >= 1),
  CHECK (rollback_candidate_publication_id IS NULL OR rollback_candidate_publication_id <> active_publication_id)
);

CREATE INDEX publication_resource_lookup_idx ON publication_resource(publication_id, resource_type, resource_id);
CREATE INDEX publication_search_resource_idx ON publication_search_document(publication_id, resource_type, resource_id);
