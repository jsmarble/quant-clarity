-- Seal-bound readiness receipts, exact-search FTS materialization, and fail-closed readiness.
-- Requirements: SRCH-001, SRCH-002, SRCH-006, SRCH-007, PIPE-044, PIPE-050–PIPE-052, CF-022, QA-006.

PRAGMA defer_foreign_keys = true;

SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.2.0'
) <> 1 THEN json('') END;

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication
  WHERE state NOT IN ('building', 'failed')
) OR EXISTS (
  SELECT 1 FROM publication_head
) THEN json('') END;

CREATE VIRTUAL TABLE publication_search_fts USING fts5(
  publication_id UNINDEXED,
  document_id UNINDEXED,
  normalized_name,
  aliases,
  publisher_name,
  provider_model_ids,
  document_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO publication_search_fts(
  publication_id,
  document_id,
  normalized_name,
  aliases,
  publisher_name,
  provider_model_ids,
  document_text
)
SELECT
  publication_id,
  document_id,
  normalized_name,
  aliases_json,
  publisher_name,
  provider_model_ids_json,
  document_text
FROM publication_search_document;

CREATE TRIGGER publication_search_fts_insert
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
END;

CREATE TABLE publication_readiness_receipt (
  publication_id TEXT NOT NULL REFERENCES publication_closure_seal(publication_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('archive', 'serving', 'vectors', 'probes')),
  receipt_version TEXT NOT NULL CHECK (receipt_version = '1.0.0'),
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
  FOREIGN KEY (publication_id, kind)
    REFERENCES publication_readiness_receipt(publication_id, kind)
    ON DELETE RESTRICT
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
  fts_build_version TEXT NOT NULL CHECK (length(fts_build_version) BETWEEN 1 AND 128 AND fts_build_version NOT GLOB '*[^ -~]*'),
  fts_document_count INTEGER NOT NULL CHECK (typeof(fts_document_count) = 'integer' AND fts_document_count >= 0),
  fts_queryable INTEGER NOT NULL CHECK (fts_queryable IN (0, 1)),
  foreign_keys_valid INTEGER NOT NULL CHECK (foreign_keys_valid IN (0, 1)),
  content_hashes_valid INTEGER NOT NULL CHECK (content_hashes_valid IN (0, 1)),
  unavailable_provider_isolation_valid INTEGER NOT NULL CHECK (unavailable_provider_isolation_valid IN (0, 1)),
  FOREIGN KEY (publication_id, kind)
    REFERENCES publication_readiness_receipt(publication_id, kind)
    ON DELETE RESTRICT
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
  FOREIGN KEY (publication_id, kind)
    REFERENCES publication_readiness_receipt(publication_id, kind)
    ON DELETE RESTRICT
);

CREATE TABLE publication_probe_receipt (
  publication_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'probes' CHECK (kind = 'probes'),
  probe_set_version TEXT NOT NULL CHECK (length(probe_set_version) BETWEEN 1 AND 128 AND probe_set_version NOT GLOB '*[^ -~]*'),
  integrity_passed INTEGER NOT NULL CHECK (integrity_passed IN (0, 1)),
  evidence_coverage_passed INTEGER NOT NULL CHECK (evidence_coverage_passed IN (0, 1)),
  exact_search_passed INTEGER NOT NULL CHECK (exact_search_passed IN (0, 1)),
  semantic_search_passed INTEGER NOT NULL CHECK (semantic_search_passed IN (0, 1)),
  structured_filter_passed INTEGER NOT NULL CHECK (structured_filter_passed IN (0, 1)),
  neutrality_passed INTEGER NOT NULL CHECK (neutrality_passed IN (0, 1)),
  version_isolation_passed INTEGER NOT NULL CHECK (version_isolation_passed IN (0, 1)),
  FOREIGN KEY (publication_id, kind)
    REFERENCES publication_readiness_receipt(publication_id, kind)
    ON DELETE RESTRICT
);

CREATE TABLE publication_readiness_attestation (
  publication_id TEXT PRIMARY KEY REFERENCES publication_closure_seal(publication_id) ON DELETE RESTRICT,
  environment TEXT NOT NULL CHECK (environment IN ('local', 'preview', 'production')),
  closure_hash TEXT NOT NULL CHECK (length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = 'sha256:' AND substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 71 AND substr(bundle_hash, 1, 7) = 'sha256:' AND substr(bundle_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  evaluator_version TEXT NOT NULL CHECK (evaluator_version = '1.0.0'),
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
    JOIN publication_closure_seal AS seal
      ON seal.publication_id = candidate.publication_id
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
    SELECT 1
    FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'archive'
      AND candidate.state = 'building'
  ) THEN RAISE(ABORT, 'archive receipt lacks its sealed binding') END;
END;

CREATE TRIGGER publication_serving_receipt_insert_guard
BEFORE INSERT ON publication_serving_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'serving'
      AND candidate.state = 'building'
  ) THEN RAISE(ABORT, 'serving receipt lacks its sealed binding') END;
END;

CREATE TRIGGER publication_vector_receipt_insert_guard
BEFORE INSERT ON publication_vector_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'vectors'
      AND candidate.state = 'building'
  ) THEN RAISE(ABORT, 'vector receipt lacks its sealed binding') END;
END;

CREATE TRIGGER publication_probe_receipt_insert_guard
BEFORE INSERT ON publication_probe_receipt
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_readiness_receipt AS receipt
    JOIN publication AS candidate USING (publication_id)
    WHERE receipt.publication_id = NEW.publication_id
      AND receipt.kind = 'probes'
      AND candidate.state = 'building'
  ) THEN RAISE(ABORT, 'probe receipt lacks its sealed binding') END;
END;

CREATE TRIGGER publication_readiness_attestation_insert_guard
BEFORE INSERT ON publication_readiness_attestation
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_closure_seal AS seal
      ON seal.publication_id = candidate.publication_id
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
      AND (
        environment <> NEW.environment
        OR observed_at_ms > NEW.ready_at_ms
        OR NEW.ready_at_ms - observed_at_ms > NEW.maximum_receipt_age_ms
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'archive'
      AND observed_at_ms = NEW.archive_observed_at_ms
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'serving'
      AND observed_at_ms = NEW.serving_observed_at_ms
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'vectors'
      AND observed_at_ms = NEW.vector_observed_at_ms
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'probes'
      AND observed_at_ms = NEW.probes_observed_at_ms
  ) THEN RAISE(ABORT, 'readiness receipt set is incomplete stale or mismatched') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_archive_receipt AS archive
    JOIN publication_closure_seal AS seal
      ON seal.publication_id = archive.publication_id
    WHERE archive.publication_id = NEW.publication_id
      AND archive.retained_bundle_hash = seal.bundle_hash
      AND archive.immutable = 1
  ) THEN RAISE(ABORT, 'archive receipt does not prove retained immutable closure') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_serving_receipt AS serving
    JOIN publication_closure_seal AS seal
      ON seal.publication_id = serving.publication_id
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
      AND serving.fts_build_version = 'fts5-unicode61@1'
      AND serving.fts_document_count = seal.exact_document_count
      AND serving.fts_queryable = 1
      AND serving.foreign_keys_valid = 1
      AND serving.content_hashes_valid = 1
      AND serving.unavailable_provider_isolation_valid = 1
  ) THEN RAISE(ABORT, 'serving receipt does not prove the sealed closure') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_vector_receipt AS vectors
    JOIN publication_closure_seal AS seal
      ON seal.publication_id = vectors.publication_id
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
      AND probe_set_version = 'search-gold@1'
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

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'archive'
      AND receipt_hash = NEW.archive_receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'serving'
      AND receipt_hash = NEW.serving_receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'vectors'
      AND receipt_hash = NEW.vector_receipt_hash
  ) OR NOT EXISTS (
    SELECT 1 FROM publication_readiness_receipt
    WHERE publication_id = NEW.publication_id AND kind = 'probes'
      AND receipt_hash = NEW.probes_receipt_hash
  ) THEN RAISE(ABORT, 'readiness attestation does not bind the exact receipts') END;

  SELECT CASE WHEN (
    SELECT count(*) FROM publication_search_fts
    WHERE publication_id = NEW.publication_id
  ) <> (
    SELECT exact_document_count FROM publication_closure_seal
    WHERE publication_id = NEW.publication_id
  ) OR EXISTS (
    SELECT 1 FROM publication_search_document AS document
    WHERE document.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_search_fts AS indexed
        WHERE indexed.publication_id = document.publication_id
          AND indexed.document_id = document.document_id
          AND indexed.normalized_name = document.normalized_name
          AND indexed.aliases = document.aliases_json
          AND indexed.publisher_name = document.publisher_name
          AND indexed.provider_model_ids = document.provider_model_ids_json
          AND indexed.document_text = document.document_text
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_search_fts AS indexed
    WHERE indexed.publication_id = NEW.publication_id
      AND NOT EXISTS (
        SELECT 1 FROM publication_search_document AS document
        WHERE document.publication_id = indexed.publication_id
          AND document.document_id = indexed.document_id
          AND document.normalized_name = indexed.normalized_name
          AND document.aliases_json = indexed.aliases
          AND document.publisher_name = indexed.publisher_name
          AND document.provider_model_ids_json = indexed.provider_model_ids
          AND document.document_text = indexed.document_text
      )
  ) THEN RAISE(ABORT, 'exact search FTS does not match the sealed source rows') END;
END;

CREATE TRIGGER publication_readiness_receipt_immutable_update
BEFORE UPDATE ON publication_readiness_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_readiness_receipt_immutable_delete
BEFORE DELETE ON publication_readiness_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_archive_receipt_immutable_update
BEFORE UPDATE ON publication_archive_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_archive_receipt_immutable_delete
BEFORE DELETE ON publication_archive_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_serving_receipt_immutable_update
BEFORE UPDATE ON publication_serving_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_serving_receipt_immutable_delete
BEFORE DELETE ON publication_serving_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_vector_receipt_immutable_update
BEFORE UPDATE ON publication_vector_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_vector_receipt_immutable_delete
BEFORE DELETE ON publication_vector_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_probe_receipt_immutable_update
BEFORE UPDATE ON publication_probe_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt is immutable'); END;
CREATE TRIGGER publication_probe_receipt_immutable_delete
BEFORE DELETE ON publication_probe_receipt
BEGIN SELECT RAISE(ABORT, 'readiness receipt cannot be deleted'); END;
CREATE TRIGGER publication_readiness_attestation_immutable_update
BEFORE UPDATE ON publication_readiness_attestation
BEGIN SELECT RAISE(ABORT, 'readiness attestation is immutable'); END;
CREATE TRIGGER publication_readiness_attestation_immutable_delete
BEFORE DELETE ON publication_readiness_attestation
BEGIN SELECT RAISE(ABORT, 'readiness attestation cannot be deleted'); END;

DROP TRIGGER publication_state_transition;
CREATE TRIGGER publication_state_transition
BEFORE UPDATE OF state, ready_at_ms, activated_at_ms, failure_codes_json ON publication
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.state = 'building' AND NEW.state IN ('ready', 'failed')) OR
    (OLD.state = NEW.state)
  ) THEN RAISE(ABORT, 'invalid publication state transition') END;
  SELECT CASE WHEN OLD.state = 'building' AND NEW.state = 'ready' AND NOT EXISTS (
    SELECT 1 FROM publication_readiness_attestation
    WHERE publication_id = NEW.publication_id
      AND closure_hash = NEW.closure_hash
      AND ready_at_ms = NEW.ready_at_ms
  ) THEN RAISE(ABORT, 'publication readiness lacks its exact attestation') END;
  SELECT CASE WHEN NEW.state = 'ready' AND (
    (SELECT count(*) FROM publication_provider_slice WHERE publication_id = NEW.publication_id) = 0 OR
    NOT EXISTS (
      SELECT 1 FROM publication_provider_slice
      WHERE publication_id = NEW.publication_id AND provider_slice_id IS NOT NULL
    ) OR
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

UPDATE serving_schema_metadata
SET schema_version = '1.3.0'
WHERE singleton = 1;
