-- Close the U+0000 boundary between JSON Schema strings and SQLite TEXT.
-- Requirements: DATA-060, SRCH-002, SRCH-006, SRCH-009, PIPE-033,
-- PIPE-039A, PIPE-044, BE-005, BE-011, SEC-005, SEC-007, QA-001,
-- QA-005, QA-006.

PRAGMA defer_foreign_keys = true;

-- Advance only the exact schema produced by migration 0007. Migration runners
-- wrap this file in one transaction, so every preflight and the version bump
-- either commits together or leaves schema 1.5.0 retryable.
SELECT CASE WHEN (
  SELECT count(*) FROM serving_schema_metadata
) <> 1 OR (
  SELECT count(*) FROM serving_schema_metadata
  WHERE singleton = 1 AND schema_version = '1.5.0'
) <> 1 THEN json('') END;

-- SQLite length(TEXT) stops before U+0000. Use BLOB operands so instr reports
-- the exact byte position even when the zero byte is leading or embedded.
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM publication_provider_search_document
  WHERE instr(
    CAST(display_name AS BLOB),
    CAST(char(0) AS BLOB)
  ) > 0 OR instr(
    CAST(normalized_name AS BLOB),
    CAST(char(0) AS BLOB)
  ) > 0
) THEN json('') END;

CREATE TRIGGER publication_provider_search_document_nul_insert_guard
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
    AND resource.resource_type = 'provider'
    AND resource.resource_id = NEW.provider_id
    AND instr(
      CAST(json_extract(
        resource.resource_json,
        '$.display_name.value'
      ) AS BLOB),
      CAST(char(0) AS BLOB)
    ) > 0
)
BEGIN
  SELECT RAISE(ABORT, 'provider search document contains U+0000');
END;

UPDATE serving_schema_metadata
SET schema_version = '1.5.1'
WHERE singleton = 1;
