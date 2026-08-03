-- Immutable publication-scoped source for the O(1) public metadata read.
-- Requirements: DATA-053, API-015, PIPE-050–PIPE-054, BE-003, BE-007,
-- BE-011, QA-004, QA-006, QA-014.

PRAGMA defer_foreign_keys = true;

-- Advance only the exact clean schema installed by migration 0012. No
-- deployed publication exists, so refuse to invent summaries for an already
-- sealed legacy publication rather than silently backfilling authority.
SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.9.0'
) <> 1 OR EXISTS (
  SELECT 1 FROM publication_closure_seal
) THEN json('') END;

SELECT CASE WHEN EXISTS (
  SELECT 1 FROM sqlite_schema
  WHERE name IN (
    'publication_dataset_metadata_summary',
    'publication_dataset_metadata_summary_insert_guard',
    'publication_dataset_metadata_summary_immutable_update',
    'publication_dataset_metadata_summary_immutable_delete',
    'publication_dataset_metadata_summary_readiness_guard',
    'publication_dataset_metadata_summary_switch_guard'
  )
) THEN json('') END;

CREATE TABLE publication_dataset_metadata_summary (
  publication_id TEXT PRIMARY KEY
    REFERENCES publication_closure_seal(publication_id) ON DELETE RESTRICT,
  summary_version TEXT NOT NULL CHECK (summary_version = '1.0.0'),
  closure_hash TEXT NOT NULL CHECK (
    length(closure_hash) = 71 AND substr(closure_hash, 1, 7) = 'sha256:' AND
    substr(closure_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  source_resource_count INTEGER NOT NULL CHECK (
    typeof(source_resource_count) = 'integer' AND source_resource_count >= 0
  ),
  provider_slice_count INTEGER NOT NULL CHECK (
    typeof(provider_slice_count) = 'integer' AND provider_slice_count >= 1
  ),
  provider_slice_hash TEXT NOT NULL CHECK (
    length(provider_slice_hash) = 71 AND
    substr(provider_slice_hash, 1, 7) = 'sha256:' AND
    substr(provider_slice_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  active_model_count INTEGER NOT NULL CHECK (
    typeof(active_model_count) = 'integer' AND active_model_count >= 0
  ),
  active_offering_count INTEGER NOT NULL CHECK (
    typeof(active_offering_count) = 'integer' AND active_offering_count >= 0
  ),
  active_provider_count INTEGER NOT NULL CHECK (
    typeof(active_provider_count) = 'integer' AND active_provider_count >= 0
  ),
  has_stale_provider_slices INTEGER NOT NULL CHECK (
    has_stale_provider_slices IN (0, 1)
  ),
  has_unavailable_provider_slices INTEGER NOT NULL CHECK (
    has_unavailable_provider_slices IN (0, 1)
  ),
  summary_hash TEXT NOT NULL CHECK (
    length(summary_hash) = 71 AND substr(summary_hash, 1, 7) = 'sha256:' AND
    substr(summary_hash, 8) NOT GLOB '*[^0-9a-f]*'
  )
) STRICT;

-- The controlled writer supplies only the publication-core projection. D1
-- independently binds it to the exact immutable seal and rederives every
-- public count and degradation flag from the sealed source rows.
CREATE TRIGGER publication_dataset_metadata_summary_insert_guard
BEFORE INSERT ON publication_dataset_metadata_summary
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE candidate.publication_id = NEW.publication_id
      AND candidate.state = 'building'
      AND candidate.closure_hash = NEW.closure_hash
      AND seal.closure_hash = NEW.closure_hash
      AND seal.resource_count = NEW.source_resource_count
      AND seal.provider_slice_count = NEW.provider_slice_count
      AND seal.provider_slice_hash = NEW.provider_slice_hash
  ) THEN RAISE(ABORT, 'dataset metadata summary does not match its sealed publication') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type IN ('model', 'offering', 'provider')
      AND (
        json_type(resource.resource_json, '$.status') IS NOT 'object' OR
        json_type(resource.resource_json, '$.status.state') IS NOT 'text' OR
        COALESCE(json_extract(resource.resource_json, '$.status.state'), '__missing__') NOT IN
          ('known', 'unknown', 'not_applicable', 'unavailable') OR
        (
          json_extract(resource.resource_json, '$.status.state') = 'known'
          AND json_type(resource.resource_json, '$.status.value') IS NOT 'text'
        ) OR (
          json_extract(resource.resource_json, '$.status.state') IS NOT 'known'
          AND json_type(resource.resource_json, '$.status.value') IS NOT 'null'
        ) OR (
          resource.resource_type = 'model' AND (
            json_type(resource.resource_json, '$.model_id') IS NOT 'text' OR
            json_extract(resource.resource_json, '$.model_id') IS NOT resource.resource_id
          )
        ) OR (
          resource.resource_type = 'offering' AND (
            json_type(resource.resource_json, '$.offering_id') IS NOT 'text' OR
            json_extract(resource.resource_json, '$.offering_id') IS NOT resource.resource_id OR
            (json_type(resource.resource_json, '$.stale') IS NOT 'true' AND
              json_type(resource.resource_json, '$.stale') IS NOT 'false')
          )
        ) OR (
          resource.resource_type = 'provider' AND (
            json_type(resource.resource_json, '$.provider_id') IS NOT 'text' OR
            json_extract(resource.resource_json, '$.provider_id') IS NOT resource.resource_id
          )
        )
      )
  ) THEN RAISE(ABORT, 'dataset metadata counted resource is malformed') END;

  SELECT CASE WHEN NEW.active_model_count <> (
    SELECT count(*) FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type = 'model'
      AND json_extract(resource.resource_json, '$.status.state') = 'known'
      AND json_extract(resource.resource_json, '$.status.value') = 'active'
  ) OR NEW.active_offering_count <> (
    SELECT count(*) FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type = 'offering'
      AND json_extract(resource.resource_json, '$.status.state') = 'known'
      AND json_extract(resource.resource_json, '$.status.value') = 'active'
      AND json_extract(resource.resource_json, '$.stale') = 0
  ) OR NEW.active_provider_count <> (
    SELECT count(*) FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type = 'provider'
      AND json_extract(resource.resource_json, '$.status.state') = 'known'
      AND json_extract(resource.resource_json, '$.status.value') = 'active'
  ) OR NEW.has_stale_provider_slices <> EXISTS (
    SELECT 1 FROM publication_provider_slice
    WHERE publication_id = NEW.publication_id AND freshness_state = 'stale'
  ) OR NEW.has_unavailable_provider_slices <> EXISTS (
    SELECT 1 FROM publication_provider_slice
    WHERE publication_id = NEW.publication_id AND freshness_state = 'unavailable'
  ) THEN RAISE(ABORT, 'dataset metadata summary does not match sealed source rows') END;
END;

CREATE TRIGGER publication_dataset_metadata_summary_immutable_update
BEFORE UPDATE ON publication_dataset_metadata_summary
BEGIN SELECT RAISE(ABORT, 'dataset metadata summary is immutable'); END;

CREATE TRIGGER publication_dataset_metadata_summary_immutable_delete
BEFORE DELETE ON publication_dataset_metadata_summary
BEGIN SELECT RAISE(ABORT, 'dataset metadata summary cannot be deleted'); END;

-- Readiness is an independent recomputation, not trust in the insert guard.
-- Any absent singleton, malformed counted field, digest-bound authority drift,
-- or rederived aggregate disagreement keeps the candidate non-public.
CREATE TRIGGER publication_dataset_metadata_summary_readiness_guard
BEFORE UPDATE OF state ON publication
WHEN OLD.state = 'building' AND NEW.state = 'ready'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM publication_dataset_metadata_summary AS summary
    JOIN publication_closure_seal AS seal USING (publication_id)
    WHERE summary.publication_id = NEW.publication_id
      AND summary.summary_version = '1.0.0'
      AND summary.closure_hash = NEW.closure_hash
      AND summary.closure_hash = seal.closure_hash
      AND summary.source_resource_count = NEW.resource_count
      AND summary.source_resource_count = seal.resource_count
      AND summary.provider_slice_count = seal.provider_slice_count
      AND summary.provider_slice_hash = seal.provider_slice_hash
      AND summary.active_model_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.publication_id
          AND resource.resource_type = 'model'
          AND json_extract(resource.resource_json, '$.status.state') = 'known'
          AND json_extract(resource.resource_json, '$.status.value') = 'active'
      )
      AND summary.active_offering_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.publication_id
          AND resource.resource_type = 'offering'
          AND json_extract(resource.resource_json, '$.status.state') = 'known'
          AND json_extract(resource.resource_json, '$.status.value') = 'active'
          AND json_extract(resource.resource_json, '$.stale') = 0
      )
      AND summary.active_provider_count = (
        SELECT count(*) FROM publication_resource AS resource
        WHERE resource.publication_id = NEW.publication_id
          AND resource.resource_type = 'provider'
          AND json_extract(resource.resource_json, '$.status.state') = 'known'
          AND json_extract(resource.resource_json, '$.status.value') = 'active'
      )
      AND summary.has_stale_provider_slices = EXISTS (
        SELECT 1 FROM publication_provider_slice
        WHERE publication_id = NEW.publication_id AND freshness_state = 'stale'
      )
      AND summary.has_unavailable_provider_slices = EXISTS (
        SELECT 1 FROM publication_provider_slice
        WHERE publication_id = NEW.publication_id AND freshness_state = 'unavailable'
      )
  ) OR EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = NEW.publication_id
      AND resource.resource_type IN ('model', 'offering', 'provider')
      AND (
        json_type(resource.resource_json, '$.status') IS NOT 'object' OR
        json_type(resource.resource_json, '$.status.state') IS NOT 'text' OR
        COALESCE(json_extract(resource.resource_json, '$.status.state'), '__missing__') NOT IN
          ('known', 'unknown', 'not_applicable', 'unavailable') OR
        (json_extract(resource.resource_json, '$.status.state') = 'known' AND
          json_type(resource.resource_json, '$.status.value') IS NOT 'text') OR
        (json_extract(resource.resource_json, '$.status.state') IS NOT 'known' AND
          json_type(resource.resource_json, '$.status.value') IS NOT 'null') OR
        (resource.resource_type = 'model' AND
          json_extract(resource.resource_json, '$.model_id') IS NOT resource.resource_id) OR
        (resource.resource_type = 'offering' AND (
          json_extract(resource.resource_json, '$.offering_id') IS NOT resource.resource_id OR
          (json_type(resource.resource_json, '$.stale') IS NOT 'true' AND
            json_type(resource.resource_json, '$.stale') IS NOT 'false')
        )) OR
        (resource.resource_type = 'provider' AND
          json_extract(resource.resource_json, '$.provider_id') IS NOT resource.resource_id)
      )
  ) THEN RAISE(ABORT, 'publication readiness lacks an exact dataset metadata summary') END;
END;

-- Activation and rollback both recheck the immutable structural binding. The
-- application readiness adapter separately recomputes the summary digest.
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

UPDATE serving_schema_metadata
SET schema_version = '1.10.0'
WHERE singleton = 1;
