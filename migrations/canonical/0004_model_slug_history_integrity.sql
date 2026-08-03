-- Harden exact current and historical slug ownership for canonical Models.
-- Requirements: DATA-001, BE-005, BE-006.

PRAGMA defer_foreign_keys = true;

-- Canonical migrations currently share the baseline schema marker. Refuse to
-- install the guards over an unexpected or structurally incomplete database.
SELECT CASE WHEN (
  SELECT count(*) FROM schema_metadata
) <> 1 OR (
  SELECT count(*) FROM schema_metadata
  WHERE singleton = 1 AND schema_version = '1.0.0'
) <> 1 OR (
  SELECT count(*) FROM sqlite_schema
  WHERE type = 'table' AND name IN ('resource_identity', 'slug_history')
) <> 2 THEN json('') END;

-- Existing Model history must already satisfy the new contract. The interval
-- relation is half-open: [valid_from_ms, valid_to_ms), with NULL as infinity.
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM slug_history AS history
  JOIN resource_identity AS identity
    ON identity.resource_id = history.resource_id
   AND identity.resource_type = 'model'
  WHERE typeof(history.slug) <> 'text'
     OR length(history.slug) NOT BETWEEN 1 AND 128
     OR instr(
       CAST(history.slug AS BLOB),
       CAST(char(0) AS BLOB)
     ) > 0
     OR history.slug GLOB '*[^a-z0-9-]*'
     OR history.slug GLOB '-*'
     OR history.slug GLOB '*-'
     OR history.slug GLOB '*--*'
     OR typeof(history.valid_from_ms) <> 'integer'
     OR history.valid_from_ms < 0
     OR (
       history.valid_to_ms IS NOT NULL
       AND (
         typeof(history.valid_to_ms) <> 'integer'
         OR history.valid_to_ms <= history.valid_from_ms
       )
     )
) THEN json('') END;

SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM slug_history AS left_history
  JOIN resource_identity AS left_identity
    ON left_identity.resource_id = left_history.resource_id
   AND left_identity.resource_type = 'model'
  JOIN slug_history AS right_history
    ON right_history.resource_id = left_history.resource_id
   AND right_history.slug_history_id > left_history.slug_history_id
  WHERE (left_history.valid_to_ms IS NULL
         OR right_history.valid_from_ms < left_history.valid_to_ms)
    AND (right_history.valid_to_ms IS NULL
         OR left_history.valid_from_ms < right_history.valid_to_ms)
) THEN json('') END;

SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM slug_history AS left_history
  JOIN resource_identity AS left_identity
    ON left_identity.resource_id = left_history.resource_id
   AND left_identity.resource_type = 'model'
  JOIN slug_history AS right_history
    ON right_history.slug = left_history.slug
   AND right_history.resource_id <> left_history.resource_id
  JOIN resource_identity AS right_identity
    ON right_identity.resource_id = right_history.resource_id
   AND right_identity.resource_type = 'model'
) THEN json('') END;

CREATE TABLE model_slug_history_integrity_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  guard_version TEXT NOT NULL
    CHECK (guard_version = 'model-slug-history-guard@1')
);

INSERT INTO model_slug_history_integrity_metadata (singleton, guard_version)
VALUES (1, 'model-slug-history-guard@1');

CREATE TRIGGER model_slug_history_integrity_metadata_immutable_update
BEFORE UPDATE ON model_slug_history_integrity_metadata
BEGIN
  SELECT RAISE(ABORT, 'model slug history integrity metadata is immutable');
END;

CREATE TRIGGER model_slug_history_integrity_metadata_immutable_delete
BEFORE DELETE ON model_slug_history_integrity_metadata
BEGIN
  SELECT RAISE(ABORT, 'model slug history integrity metadata cannot be deleted');
END;

CREATE INDEX slug_history_resource_interval_idx
ON slug_history(resource_id, valid_from_ms, valid_to_ms);

CREATE INDEX slug_history_slug_owner_idx
ON slug_history(slug, resource_id);

-- SQLite REPLACE can remove a conflicting row without invoking its DELETE
-- trigger. Protect both primary-key and active-slug conflicts unconditionally
-- when the row that REPLACE would remove belongs to a Model.
CREATE TRIGGER slug_history_model_replace_guard
BEFORE INSERT ON slug_history
WHEN EXISTS (
  SELECT 1
  FROM slug_history AS existing
  JOIN resource_identity AS identity
    ON identity.resource_id = existing.resource_id
   AND identity.resource_type = 'model'
  WHERE existing.slug_history_id = NEW.slug_history_id
     OR (
       existing.valid_to_ms IS NULL
       AND NEW.valid_to_ms IS NULL
       AND existing.slug = NEW.slug
     )
)
BEGIN
  SELECT RAISE(ABORT, 'model slug history cannot be replaced');
END;

CREATE TRIGGER slug_history_model_insert_guard
BEFORE INSERT ON slug_history
WHEN EXISTS (
  SELECT 1
  FROM resource_identity
  WHERE resource_id = NEW.resource_id AND resource_type = 'model'
)
BEGIN
  SELECT CASE WHEN
    typeof(NEW.slug) <> 'text'
    OR length(NEW.slug) NOT BETWEEN 1 AND 128
    OR instr(
      CAST(NEW.slug AS BLOB),
      CAST(char(0) AS BLOB)
    ) > 0
    OR NEW.slug GLOB '*[^a-z0-9-]*'
    OR NEW.slug GLOB '-*'
    OR NEW.slug GLOB '*-'
    OR NEW.slug GLOB '*--*'
    OR typeof(NEW.valid_from_ms) <> 'integer'
    OR NEW.valid_from_ms < 0
    OR (
      NEW.valid_to_ms IS NOT NULL
      AND (
        typeof(NEW.valid_to_ms) <> 'integer'
        OR NEW.valid_to_ms <= NEW.valid_from_ms
      )
    )
  THEN RAISE(ABORT, 'model slug history row is invalid') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM slug_history AS existing
    WHERE existing.resource_id = NEW.resource_id
      AND (NEW.valid_to_ms IS NULL
           OR existing.valid_from_ms < NEW.valid_to_ms)
      AND (existing.valid_to_ms IS NULL
           OR NEW.valid_from_ms < existing.valid_to_ms)
  ) THEN RAISE(ABORT, 'model slug history intervals overlap') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM slug_history AS existing
    JOIN resource_identity AS identity
      ON identity.resource_id = existing.resource_id
     AND identity.resource_type = 'model'
    WHERE existing.slug = NEW.slug
      AND existing.resource_id <> NEW.resource_id
  ) THEN RAISE(ABORT, 'model slug is permanently owned by another model') END;
END;

CREATE TRIGGER slug_history_model_update_guard
BEFORE UPDATE ON slug_history
WHEN EXISTS (
  SELECT 1
  FROM resource_identity
  WHERE resource_id = OLD.resource_id AND resource_type = 'model'
) OR EXISTS (
  SELECT 1
  FROM resource_identity
  WHERE resource_id = NEW.resource_id AND resource_type = 'model'
)
BEGIN
  SELECT CASE WHEN
    NEW.slug_history_id IS NOT OLD.slug_history_id
    OR NEW.resource_id IS NOT OLD.resource_id
    OR NEW.slug IS NOT OLD.slug
    OR NEW.valid_from_ms IS NOT OLD.valid_from_ms
  THEN RAISE(ABORT, 'model slug history identity is immutable') END;

  SELECT CASE WHEN
    OLD.valid_to_ms IS NOT NULL
    OR NEW.valid_to_ms IS NULL
    OR typeof(NEW.valid_to_ms) <> 'integer'
    OR NEW.valid_to_ms <= OLD.valid_from_ms
  THEN RAISE(ABORT, 'model slug history may only close an open interval') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM slug_history AS existing
    WHERE existing.resource_id = NEW.resource_id
      AND existing.slug_history_id <> OLD.slug_history_id
      AND existing.valid_from_ms < NEW.valid_to_ms
      AND (existing.valid_to_ms IS NULL
           OR NEW.valid_from_ms < existing.valid_to_ms)
  ) THEN RAISE(ABORT, 'model slug history intervals overlap') END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM slug_history AS existing
    JOIN resource_identity AS identity
      ON identity.resource_id = existing.resource_id
     AND identity.resource_type = 'model'
    WHERE existing.slug = NEW.slug
      AND existing.resource_id <> NEW.resource_id
  ) THEN RAISE(ABORT, 'model slug is permanently owned by another model') END;
END;

CREATE TRIGGER slug_history_model_delete_guard
BEFORE DELETE ON slug_history
WHEN EXISTS (
  SELECT 1
  FROM resource_identity
  WHERE resource_id = OLD.resource_id AND resource_type = 'model'
)
BEGIN
  SELECT RAISE(ABORT, 'model slug history cannot be deleted');
END;
