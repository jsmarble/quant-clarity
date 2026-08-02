-- Canonical provider exact-search projection and serving proof v2 cutover.
-- Requirements: SRCH-002, SRCH-006–SRCH-010, PIPE-044, PIPE-050–PIPE-053, BE-003, BE-011, CF-022, QA-005, QA-006.

PRAGMA defer_foreign_keys = true;

-- This migration deliberately supports only pristine schema-1.4 serving stores.
-- V2 provider proof cannot be fabricated for an already sealed or switched v1
-- publication, so every legacy proof-bearing state fails before schema mutation.
SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.4.0'
) <> 1 THEN json('') END;

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication
  WHERE state NOT IN ('building', 'failed')
) OR EXISTS (
  SELECT 1 FROM publication_closure_seal
) OR EXISTS (
  SELECT 1 FROM publication_readiness_receipt
) OR EXISTS (
  SELECT 1 FROM publication_readiness_attestation
) OR EXISTS (
  SELECT 1 FROM publication_head
) OR EXISTS (
  SELECT 1 FROM publication_switch_preflight
) OR EXISTS (
  SELECT 1 FROM publication_switch_history
) THEN json('') END;

CREATE TABLE publication_provider_search_document (
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL CHECK (
    length(provider_id) = 40
    AND substr(provider_id, 1, 4) = 'prv_'
    AND provider_id = lower(provider_id)
  ),
  projection_version TEXT NOT NULL CHECK (projection_version = 'provider-name@1'),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  -- 200 ProviderSchema display-name scalars times Unicode 17 NFKC_CF's
  -- generated maximum expansion of 18 (U+FDFA).
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 3600),
  provider_resource_content_hash TEXT NOT NULL CHECK (
    length(provider_resource_content_hash) = 71
    AND substr(provider_resource_content_hash, 1, 7) = 'sha256:'
    AND substr(provider_resource_content_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (publication_id, provider_id),
  FOREIGN KEY (publication_id, provider_id)
    REFERENCES publication_provider_slice(publication_id, provider_id)
    ON DELETE RESTRICT
);

CREATE INDEX publication_provider_search_exact_idx
ON publication_provider_search_document(
  publication_id,
  normalized_name,
  provider_id
);

-- SQLite does not permit triggers on virtual tables, and D1 does not expose a
-- per-table writer ACL. Direct mutation of this reconstructible index therefore
-- cannot be represented as a database invariant. Only the controlled fixed
-- pipeline statements may write it; exact-name reads use the ordinary table.
-- Every seal/readiness/switch boundary below independently compares counts and
-- bidirectional rows so any direct FTS drift fails closed before publication.
CREATE VIRTUAL TABLE publication_provider_search_fts USING fts5(
  publication_id UNINDEXED,
  provider_id UNINDEXED,
  display_name,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER publication_provider_search_document_insert_guard
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
      AND attribution.resource_type = 'provider'
      AND attribution.resource_id = disposition.provider_id
    JOIN publication_resource AS resource
      ON resource.publication_id = attribution.publication_id
      AND resource.resource_type = attribution.resource_type
      AND resource.resource_id = attribution.resource_id
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal
        WHERE publication_id = candidate.publication_id
      )
      AND disposition.provider_slice_id IS NOT NULL
      AND (
        (disposition.freshness_state = 'fresh' AND disposition.carried_forward = 0)
        OR (disposition.freshness_state = 'stale' AND disposition.carried_forward = 1)
      )
      AND resource.content_hash = NEW.provider_resource_content_hash
      AND json_extract(resource.resource_json, '$.provider_id') = NEW.provider_id
      AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
      AND json_extract(resource.resource_json, '$.display_name.value') = NEW.display_name
      AND json_type(resource.resource_json, '$.display_name.observed_at') = 'text'
      AND json_type(resource.resource_json, '$.display_name.evidence_ids') = 'array'
      AND json_array_length(json_extract(resource.resource_json, '$.display_name.evidence_ids')) >= 1
  ) THEN RAISE(ABORT, 'provider search document does not match eligible canonical provider content') END;
END;

CREATE TRIGGER publication_provider_search_fts_insert
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
END;

CREATE TRIGGER publication_provider_search_document_immutable_update
BEFORE UPDATE ON publication_provider_search_document
BEGIN SELECT RAISE(ABORT, 'provider search document is immutable'); END;
CREATE TRIGGER publication_provider_search_document_immutable_delete
BEFORE DELETE ON publication_provider_search_document
BEGIN SELECT RAISE(ABORT, 'provider search document cannot be deleted'); END;

-- A publication may seal only after the provider projection is complete and its
-- separate FTS materialization is byte-for-byte bidirectionally equal.
CREATE TRIGGER publication_provider_search_seal_guard
BEFORE INSERT ON publication_closure_seal
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM publication_provider_slice AS disposition
    WHERE disposition.publication_id = NEW.publication_id
      AND disposition.provider_slice_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM publication_resource AS resource
        WHERE resource.publication_id = disposition.publication_id
          AND resource.resource_type = 'provider'
          AND resource.resource_id = disposition.provider_id
          AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
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
          AND attribution.resource_type = 'provider'
          AND attribution.resource_id = disposition.provider_id
        JOIN publication_resource AS resource
          ON resource.publication_id = attribution.publication_id
          AND resource.resource_type = attribution.resource_type
          AND resource.resource_id = attribution.resource_id
        WHERE disposition.publication_id = document.publication_id
          AND disposition.provider_id = document.provider_id
          AND disposition.provider_slice_id IS NOT NULL
          AND resource.content_hash = document.provider_resource_content_hash
          AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
          AND json_extract(resource.resource_json, '$.display_name.value') = document.display_name
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
  ) THEN RAISE(ABORT, 'provider search projection does not close') END;
END;

-- All v1 proof rows were rejected above. Replace their closed schemas without
-- inventing v2 evidence.
DROP TRIGGER publication_state_transition;
DROP TABLE publication_switch_history;
DROP TABLE publication_switch_preflight;
DROP TABLE publication_readiness_attestation;
DROP TABLE publication_archive_receipt;
DROP TABLE publication_serving_receipt;
DROP TABLE publication_vector_receipt;
DROP TABLE publication_probe_receipt;
DROP TABLE publication_readiness_receipt;

CREATE TABLE publication_readiness_receipt (
  publication_id TEXT NOT NULL REFERENCES publication_closure_seal(publication_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('archive', 'serving', 'vectors', 'probes')),
  receipt_version TEXT NOT NULL CHECK (receipt_version = '2.0.0'),
  receipt_hash TEXT NOT NULL CHECK (length(receipt_hash) = 71 AND substr(receipt_hash, 1, 7) = 'sha256:' AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  environment TEXT NOT NULL CHECK (environment IN ('local', 'preview', 'production')),
  closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = 'sha256:' AND substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 71 AND substr(bundle_hash, 1, 7) = 'sha256:' AND substr(bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  schema_version TEXT NOT NULL CHECK (length(schema_version) BETWEEN 1 AND 128 AND schema_version NOT GLOB '*[^ -~]*'),
  build_commit TEXT NOT NULL CHECK (length(build_commit) BETWEEN 1 AND 128 AND build_commit NOT GLOB '*[^ -~]*'),
  observed_at_ms INTEGER NOT NULL CHECK (typeof(observed_at_ms) = 'integer' AND observed_at_ms >= 0),
  PRIMARY KEY (publication_id, kind)
);

CREATE TABLE publication_archive_receipt (
  publication_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'archive' CHECK (kind = 'archive'),
  retained_bundle_hash TEXT NOT NULL CHECK (length(retained_bundle_hash) = 71 AND substr(retained_bundle_hash, 1, 7) = 'sha256:' AND substr(retained_bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  immutable INTEGER NOT NULL CHECK (immutable IN (0, 1)),
  FOREIGN KEY (publication_id, kind) REFERENCES publication_readiness_receipt(publication_id, kind) ON DELETE RESTRICT
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
  FOREIGN KEY (publication_id, kind) REFERENCES publication_readiness_receipt(publication_id, kind) ON DELETE RESTRICT
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

CREATE TABLE publication_probe_receipt (
  publication_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'probes' CHECK (kind = 'probes'),
  probe_set_version TEXT NOT NULL CHECK (probe_set_version = 'search-gold@2'),
  integrity_passed INTEGER NOT NULL CHECK (integrity_passed IN (0, 1)),
  evidence_coverage_passed INTEGER NOT NULL CHECK (evidence_coverage_passed IN (0, 1)),
  exact_search_passed INTEGER NOT NULL CHECK (exact_search_passed IN (0, 1)),
  semantic_search_passed INTEGER NOT NULL CHECK (semantic_search_passed IN (0, 1)),
  structured_filter_passed INTEGER NOT NULL CHECK (structured_filter_passed IN (0, 1)),
  neutrality_passed INTEGER NOT NULL CHECK (neutrality_passed IN (0, 1)),
  version_isolation_passed INTEGER NOT NULL CHECK (version_isolation_passed IN (0, 1)),
  FOREIGN KEY (publication_id, kind) REFERENCES publication_readiness_receipt(publication_id, kind) ON DELETE RESTRICT
);

CREATE TABLE publication_readiness_attestation (
  publication_id TEXT PRIMARY KEY REFERENCES publication_closure_seal(publication_id) ON DELETE RESTRICT,
  environment TEXT NOT NULL CHECK (environment IN ('local', 'preview', 'production')),
  closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = 'sha256:' AND substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 71 AND substr(bundle_hash, 1, 7) = 'sha256:' AND substr(bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  evaluator_version TEXT NOT NULL CHECK (evaluator_version = '2.0.0'),
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

CREATE TRIGGER publication_archive_receipt_insert_guard
BEFORE INSERT ON publication_archive_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'archive' AND candidate.state = 'building'
  ) THEN RAISE(ABORT, 'archive receipt lacks its sealed binding') END;
END;

CREATE TRIGGER publication_serving_receipt_insert_guard
BEFORE INSERT ON publication_serving_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'serving' AND candidate.state = 'building'
  ) THEN RAISE(ABORT, 'serving receipt lacks its sealed binding') END;
END;

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

CREATE TRIGGER publication_readiness_attestation_insert_guard
BEFORE INSERT ON publication_readiness_attestation
BEGIN
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
        OR receipt_version <> '2.0.0'
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
    WHERE archive.publication_id = NEW.publication_id
      AND archive.retained_bundle_hash = seal.bundle_hash
      AND archive.immutable = 1
  ) THEN RAISE(ABORT, 'archive receipt does not prove retained immutable closure') END;

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
      AND probe_set_version = 'search-gold@2'
      AND integrity_passed = 1
      AND evidence_coverage_passed = 1
      AND exact_search_passed = 1
      AND semantic_search_passed = 1
      AND structured_filter_passed = 1
      AND neutrality_passed = 1
      AND version_isolation_passed = 1
  ) THEN RAISE(ABORT, 'probe receipt does not prove every acceptance probe') END;

  SELECT CASE WHEN NEW.effective_valid_until_ms <> MIN(
    NEW.archive_observed_at_ms,
    NEW.serving_observed_at_ms,
    NEW.vector_observed_at_ms,
    NEW.probes_observed_at_ms
  ) + NEW.maximum_receipt_age_ms OR NEW.ready_at_ms >
    CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 300000
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
END;

CREATE TRIGGER publication_readiness_receipt_immutable_update BEFORE UPDATE ON publication_readiness_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_readiness_receipt_immutable_delete BEFORE DELETE ON publication_readiness_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_archive_receipt_immutable_update BEFORE UPDATE ON publication_archive_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_archive_receipt_immutable_delete BEFORE DELETE ON publication_archive_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_serving_receipt_immutable_update BEFORE UPDATE ON publication_serving_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_serving_receipt_immutable_delete BEFORE DELETE ON publication_serving_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_vector_receipt_immutable_update BEFORE UPDATE ON publication_vector_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_vector_receipt_immutable_delete BEFORE DELETE ON publication_vector_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_probe_receipt_immutable_update BEFORE UPDATE ON publication_probe_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_probe_receipt_immutable_delete BEFORE DELETE ON publication_probe_receipt BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_readiness_attestation_immutable_update BEFORE UPDATE ON publication_readiness_attestation BEGIN SELECT RAISE(ABORT, 'readiness attestation is immutable'); END;
CREATE TRIGGER publication_readiness_attestation_immutable_delete BEFORE DELETE ON publication_readiness_attestation BEGIN SELECT RAISE(ABORT, 'readiness attestation cannot be deleted'); END;

CREATE TABLE publication_switch_preflight (
  switch_id TEXT PRIMARY KEY CHECK (length(switch_id) BETWEEN 1 AND 512 AND switch_id NOT GLOB '*[^ -~]*'),
  preflight_version TEXT NOT NULL CHECK (preflight_version = '2.0.0'),
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
  probe_set_version TEXT NOT NULL CHECK (probe_set_version = 'search-gold@2'),
  integrity_passed INTEGER NOT NULL CHECK (integrity_passed IN (0, 1)),
  exact_search_passed INTEGER NOT NULL CHECK (exact_search_passed IN (0, 1)),
  semantic_search_passed INTEGER NOT NULL CHECK (semantic_search_passed IN (0, 1)),
  structured_filter_passed INTEGER NOT NULL CHECK (structured_filter_passed IN (0, 1)),
  neutrality_passed INTEGER NOT NULL CHECK (neutrality_passed IN (0, 1)),
  version_isolation_passed INTEGER NOT NULL CHECK (version_isolation_passed IN (0, 1)),
  provider_search_projection_version TEXT NOT NULL CHECK (provider_search_projection_version = 'provider-name@1'),
  provider_search_document_count INTEGER NOT NULL CHECK (typeof(provider_search_document_count) = 'integer' AND provider_search_document_count >= 0),
  provider_search_inventory_hash TEXT NOT NULL CHECK (length(provider_search_inventory_hash) = 71 AND substr(provider_search_inventory_hash, 1, 7) = 'sha256:' AND substr(provider_search_inventory_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  provider_search_fts_build_version TEXT NOT NULL CHECK (provider_search_fts_build_version = 'provider-name-fts5-unicode61@1'),
  provider_search_fts_document_count INTEGER NOT NULL CHECK (typeof(provider_search_fts_document_count) = 'integer' AND provider_search_fts_document_count >= 0),
  provider_search_fts_queryable INTEGER NOT NULL CHECK (provider_search_fts_queryable IN (0, 1)),
  provider_search_exact_parity INTEGER NOT NULL CHECK (provider_search_exact_parity IN (0, 1)),
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

CREATE TRIGGER publication_switch_history_immutable_update
BEFORE UPDATE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, 'switch history is append-only'); END;
CREATE TRIGGER publication_switch_history_immutable_delete
BEFORE DELETE ON publication_switch_history
BEGIN SELECT RAISE(ABORT, 'switch history cannot be deleted'); END;

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

UPDATE serving_schema_metadata
SET schema_version = '1.5.0'
WHERE singleton = 1;
