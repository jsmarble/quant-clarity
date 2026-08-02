-- Represent selected and unavailable provider dispositions without fabricated slice IDs.
-- Requirements: PIPE-005, PIPE-019, PIPE-043, PIPE-044, PIPE-050–PIPE-052, QA-006.

-- Migration order is part of the integrity boundary. Refuse to rewrite a
-- database whose singleton metadata is absent, duplicated, or unexpected.
SELECT CASE WHEN (
  SELECT count(*)
  FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.0.0'
) = 1 AND (
  SELECT count(*) FROM serving_schema_metadata
) = 1 THEN 0 ELSE json('') END;

-- Abort before any schema mutation if a legacy database already made an empty,
-- all-unavailable publication queryable. json('') is deliberately evaluated
-- only for the invalid branch and raises a read-only SQLite error.
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM publication AS legacy_publication
  WHERE legacy_publication.state IN ('ready', 'active', 'superseded', 'rolled_back')
    AND (
      legacy_publication.resource_count = 0 OR
      NOT EXISTS (
        SELECT 1
        FROM publication_provider_slice AS legacy_slice
        WHERE legacy_slice.publication_id = legacy_publication.publication_id
          AND legacy_slice.freshness_state IN ('fresh', 'stale')
      )
    )
) THEN json('') ELSE 0 END;

-- The v1 global slice primary key made an exact prior occurrence impossible.
-- Do not bless a legacy carried-forward claim that this database cannot prove.
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM publication_provider_slice AS legacy_carried
  WHERE legacy_carried.carried_forward = 1
    AND NOT EXISTS (
      SELECT 1
      FROM publication_provider_slice AS legacy_prior
      JOIN publication AS legacy_prior_publication
        ON legacy_prior_publication.publication_id = legacy_prior.publication_id
      WHERE legacy_prior.provider_slice_id = legacy_carried.provider_slice_id
        AND legacy_prior.provider_id = legacy_carried.provider_id
        AND legacy_prior.provider_run_id = legacy_carried.provider_run_id
        AND legacy_prior.publication_id <> legacy_carried.publication_id
        AND legacy_prior_publication.state IN ('active', 'superseded', 'rolled_back')
    )
) THEN json('') ELSE 0 END;

-- Validate every legacy identity that will survive the copy so an invalid row
-- cannot fail after trigger removal or replacement-table creation.
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM publication_provider_slice AS legacy_identity
  WHERE (
    legacy_identity.freshness_state <> 'unavailable' AND NOT (
      length(legacy_identity.provider_slice_id) = 40 AND
      substr(legacy_identity.provider_slice_id, 1, 4) = 'prn_' AND
      legacy_identity.provider_slice_id = lower(legacy_identity.provider_slice_id) AND
      substr(legacy_identity.provider_slice_id, 13, 1) = '-' AND
      substr(legacy_identity.provider_slice_id, 18, 1) = '-' AND
      substr(legacy_identity.provider_slice_id, 19, 1) = '4' AND
      substr(legacy_identity.provider_slice_id, 23, 1) = '-' AND
      substr(legacy_identity.provider_slice_id, 24, 1) IN ('8', '9', 'a', 'b') AND
      substr(legacy_identity.provider_slice_id, 28, 1) = '-' AND
      substr(legacy_identity.provider_slice_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
      substr(legacy_identity.provider_slice_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(legacy_identity.provider_slice_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(legacy_identity.provider_slice_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(legacy_identity.provider_slice_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
    )
  ) OR NOT (
    length(legacy_identity.provider_id) = 40 AND
    substr(legacy_identity.provider_id, 1, 4) = 'prv_' AND
    legacy_identity.provider_id = lower(legacy_identity.provider_id) AND
    substr(legacy_identity.provider_id, 13, 1) = '-' AND
    substr(legacy_identity.provider_id, 18, 1) = '-' AND
    substr(legacy_identity.provider_id, 19, 1) = '4' AND
    substr(legacy_identity.provider_id, 23, 1) = '-' AND
    substr(legacy_identity.provider_id, 24, 1) IN ('8', '9', 'a', 'b') AND
    substr(legacy_identity.provider_id, 28, 1) = '-' AND
    substr(legacy_identity.provider_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(legacy_identity.provider_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(legacy_identity.provider_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(legacy_identity.provider_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(legacy_identity.provider_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ) OR NOT (
    length(legacy_identity.provider_run_id) = 40 AND
    substr(legacy_identity.provider_run_id, 1, 4) = 'pvr_' AND
    legacy_identity.provider_run_id = lower(legacy_identity.provider_run_id) AND
    substr(legacy_identity.provider_run_id, 13, 1) = '-' AND
    substr(legacy_identity.provider_run_id, 18, 1) = '-' AND
    substr(legacy_identity.provider_run_id, 19, 1) = '4' AND
    substr(legacy_identity.provider_run_id, 23, 1) = '-' AND
    substr(legacy_identity.provider_run_id, 24, 1) IN ('8', '9', 'a', 'b') AND
    substr(legacy_identity.provider_run_id, 28, 1) = '-' AND
    substr(legacy_identity.provider_run_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(legacy_identity.provider_run_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(legacy_identity.provider_run_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(legacy_identity.provider_run_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(legacy_identity.provider_run_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  )
) THEN json('') ELSE 0 END;

PRAGMA defer_foreign_keys = true;

DROP TRIGGER publication_state_transition;
DROP TRIGGER publication_provider_slice_immutable_update;
DROP TRIGGER publication_provider_slice_immutable_delete;
DROP TRIGGER publication_provider_slice_building_insert;

CREATE TABLE publication_provider_slice_v2 (
  provider_slice_id TEXT CHECK (
    provider_slice_id IS NULL OR (
      length(provider_slice_id) = 40 AND
      substr(provider_slice_id, 1, 4) = 'prn_' AND
      provider_slice_id = lower(provider_slice_id) AND
      substr(provider_slice_id, 13, 1) = '-' AND
      substr(provider_slice_id, 18, 1) = '-' AND
      substr(provider_slice_id, 19, 1) = '4' AND
      substr(provider_slice_id, 23, 1) = '-' AND
      substr(provider_slice_id, 24, 1) IN ('8', '9', 'a', 'b') AND
      substr(provider_slice_id, 28, 1) = '-' AND
      substr(provider_slice_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
      substr(provider_slice_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(provider_slice_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(provider_slice_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(provider_slice_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
    )
  ),
  publication_id TEXT NOT NULL REFERENCES publication(publication_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL CHECK (
    length(provider_id) = 40 AND
    substr(provider_id, 1, 4) = 'prv_' AND
    provider_id = lower(provider_id) AND
    substr(provider_id, 13, 1) = '-' AND
    substr(provider_id, 18, 1) = '-' AND
    substr(provider_id, 19, 1) = '4' AND
    substr(provider_id, 23, 1) = '-' AND
    substr(provider_id, 24, 1) IN ('8', '9', 'a', 'b') AND
    substr(provider_id, 28, 1) = '-' AND
    substr(provider_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_run_id TEXT NOT NULL CHECK (
    length(provider_run_id) = 40 AND
    substr(provider_run_id, 1, 4) = 'pvr_' AND
    provider_run_id = lower(provider_run_id) AND
    substr(provider_run_id, 13, 1) = '-' AND
    substr(provider_run_id, 18, 1) = '-' AND
    substr(provider_run_id, 19, 1) = '4' AND
    substr(provider_run_id, 23, 1) = '-' AND
    substr(provider_run_id, 24, 1) IN ('8', '9', 'a', 'b') AND
    substr(provider_run_id, 28, 1) = '-' AND
    substr(provider_run_id, 5, 8) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_run_id, 14, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_run_id, 19, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_run_id, 24, 4) NOT GLOB '*[^0-9a-f]*' AND
    substr(provider_run_id, 29, 12) NOT GLOB '*[^0-9a-f]*'
  ),
  carried_forward INTEGER NOT NULL CHECK (carried_forward IN (0, 1)),
  freshness_state TEXT NOT NULL CHECK (freshness_state IN ('fresh', 'stale', 'unavailable')),
  PRIMARY KEY (publication_id, provider_id),
  UNIQUE (publication_id, provider_slice_id),
  CHECK (
    (freshness_state = 'unavailable' AND provider_slice_id IS NULL AND carried_forward = 0) OR
    (freshness_state = 'fresh' AND provider_slice_id IS NOT NULL) OR
    (freshness_state = 'stale' AND provider_slice_id IS NOT NULL AND carried_forward = 1)
  )
);

-- Existing selected rows migrate losslessly. The old schema required a fictitious
-- slice identity for unavailable rows; discard that impossible value rather than
-- carrying it into the closed disposition.
INSERT INTO publication_provider_slice_v2 (
  provider_slice_id,
  publication_id,
  provider_id,
  provider_run_id,
  carried_forward,
  freshness_state
)
SELECT
  CASE WHEN freshness_state = 'unavailable' THEN NULL ELSE provider_slice_id END,
  publication_id,
  provider_id,
  provider_run_id,
  carried_forward,
  freshness_state
FROM publication_provider_slice;

DROP TABLE publication_provider_slice;
ALTER TABLE publication_provider_slice_v2 RENAME TO publication_provider_slice;

CREATE INDEX publication_provider_slice_identity_idx
ON publication_provider_slice(provider_slice_id)
WHERE provider_slice_id IS NOT NULL;

CREATE TRIGGER publication_provider_slice_lineage_insert
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
  ) THEN RAISE(ABORT, 'provider slice lineage is inconsistent') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM publication_provider_slice AS other_occurrence
    JOIN publication AS other_publication
      ON other_publication.publication_id = other_occurrence.publication_id
    JOIN publication AS current_publication
      ON current_publication.publication_id = NEW.publication_id
    WHERE other_occurrence.provider_slice_id = NEW.provider_slice_id
      AND other_publication.generated_at_ms > current_publication.generated_at_ms
  ) THEN RAISE(ABORT, 'provider slice occurrence chronology is inconsistent') END;
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
      AND prior_publication.state IN ('active', 'superseded', 'rolled_back')
      AND prior_publication.activated_at_ms IS NOT NULL
      AND prior_publication.activated_at_ms <= current_publication.generated_at_ms
  ) THEN RAISE(ABORT, 'carried provider slice lacks a queryable prior publication') END;
  SELECT CASE WHEN NEW.carried_forward = 0 AND EXISTS (
    SELECT 1
    FROM publication_provider_slice AS prior
    JOIN publication AS prior_publication
      ON prior_publication.publication_id = prior.publication_id
    WHERE prior.provider_slice_id = NEW.provider_slice_id
      AND prior_publication.state IN ('ready', 'active', 'superseded', 'rolled_back')
  ) THEN RAISE(ABORT, 'reused provider slice must be carried forward') END;
END;

CREATE TRIGGER publication_provider_slice_immutable_update
BEFORE UPDATE ON publication_provider_slice
BEGIN SELECT RAISE(ABORT, 'publication provider slice is immutable'); END;

CREATE TRIGGER publication_provider_slice_immutable_delete
BEFORE DELETE ON publication_provider_slice
BEGIN SELECT RAISE(ABORT, 'publication provider slice cannot be deleted'); END;

CREATE TRIGGER publication_provider_slice_building_insert
BEFORE INSERT ON publication_provider_slice
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM publication WHERE publication_id = NEW.publication_id AND state = 'building'
  ) THEN RAISE(ABORT, 'provider slices may be staged only while building') END;
END;

CREATE TRIGGER publication_state_transition
BEFORE UPDATE OF state, ready_at_ms, activated_at_ms, failure_codes_json ON publication
BEGIN
  SELECT CASE WHEN NOT (
    (OLD.state = 'building' AND NEW.state IN ('ready', 'failed')) OR
    (OLD.state = 'ready' AND NEW.state = 'active') OR
    (OLD.state = 'active' AND NEW.state IN ('superseded', 'rolled_back')) OR
    (OLD.state = 'superseded' AND NEW.state IN ('active', 'rolled_back')) OR
    (OLD.state = 'rolled_back' AND NEW.state = 'active') OR
    (OLD.state = NEW.state)
  ) THEN RAISE(ABORT, 'invalid publication state transition') END;
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
    NEW.resource_count = 0 OR
    (SELECT count(*) FROM publication_resource WHERE publication_id = NEW.publication_id) <> NEW.resource_count OR
    (SELECT count(*) FROM publication_search_document WHERE publication_id = NEW.publication_id) <> NEW.exact_document_count OR
    NEW.exact_document_count <> NEW.vector_document_count OR
    (SELECT count(*) FROM publication_resource WHERE publication_id = NEW.publication_id AND resource_type IN ('model', 'variant')) <> NEW.vector_document_count OR
    EXISTS (
      SELECT 1 FROM publication_resource resource
      WHERE resource.publication_id = NEW.publication_id
        AND resource.resource_type IN ('model', 'variant')
        AND NOT EXISTS (
          SELECT 1 FROM publication_search_document document
          WHERE document.publication_id = resource.publication_id
            AND document.resource_type = resource.resource_type
            AND document.resource_id = resource.resource_id
        )
    )
  ) THEN RAISE(ABORT, 'publication closure counts are incomplete') END;
END;

UPDATE serving_schema_metadata
SET schema_version = '1.1.0'
WHERE singleton = 1 AND schema_version = '1.0.0';
