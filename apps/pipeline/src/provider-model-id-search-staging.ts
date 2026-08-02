import {
  PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_UTF8_BYTES,
  PROVIDER_MODEL_ID_SEARCH_NORMALIZED_EXACT_INDEX_NAME,
  PROVIDER_MODEL_ID_SEARCH_RAW_EXACT_INDEX_NAME,
  PROVIDER_MODEL_ID_SEARCH_STORAGE_VERSION,
  assertProviderModelIdSearchStagingProjectionV1,
  projectProviderModelIdSearchArtifactProofV1,
  projectProviderModelIdSearchQueryabilityPlanV4,
  projectProviderModelIdSearchQueryableArtifactProofV4,
  readProviderModelIdSearchQueryablePersistenceV4,
  readProviderModelIdSearchStagingPersistenceV1,
  type ProviderModelIdSearchArtifactProofV1,
  type ProviderModelIdSearchQueryableArtifactProofV4,
  type ProviderModelIdSearchStagingProjectionV1,
  type ProviderModelIdSearchStorageRowV1,
  type PublicationState,
} from "@quant-clarity/publication-core";

const SELECT_PUBLICATION_SQL = `SELECT
  candidate.state,
  candidate.closure_hash,
  revision.revision AS staging_revision,
  CASE WHEN seal.publication_id IS NULL THEN 0 ELSE 1 END AS sealed,
  (SELECT count(*) FROM publication_resource AS resource
   WHERE resource.publication_id = candidate.publication_id
     AND resource.resource_type = 'offering'
  ) AS eligible_document_count
FROM publication AS candidate
JOIN publication_staging_revision AS revision USING (publication_id)
LEFT JOIN publication_closure_seal AS seal USING (publication_id)
WHERE candidate.publication_id = ?1`;

const SELECT_DOCUMENTS_SQL = `SELECT
  publication_id, offering_id, provider_id, target_resource_type,
  target_resource_id, projection_version, raw_provider_model_id_utf8,
  normalized_provider_model_id_utf8, offering_content_hash, target_content_hash
FROM publication_provider_model_id_search_document
WHERE publication_id = ?1
ORDER BY offering_id`;

const SELECT_RAW_INDEXED_OFFERING_IDS_SQL = `WITH exact_indexes(exact) AS (
  SELECT CASE WHEN
    (SELECT count(*) FROM pragma_index_info('publication_provider_model_id_raw_exact_idx')) = 3
    AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_raw_exact_idx') WHERE seqno = 0 AND name = 'publication_id')
    AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_raw_exact_idx') WHERE seqno = 1 AND name = 'raw_provider_model_id_utf8')
    AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_raw_exact_idx') WHERE seqno = 2 AND name = 'offering_id')
    AND (SELECT count(*) FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx')) = 3
    AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx') WHERE seqno = 0 AND name = 'publication_id')
    AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx') WHERE seqno = 1 AND name = 'normalized_provider_model_id_utf8')
    AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx') WHERE seqno = 2 AND name = 'offering_id')
  THEN 1 ELSE 0 END
)
SELECT document.offering_id, exact_indexes.exact AS indexes_exact
FROM exact_indexes
LEFT JOIN publication_provider_model_id_search_document AS document
INDEXED BY publication_provider_model_id_raw_exact_idx
  ON document.publication_id = ?1 AND document.raw_provider_model_id_utf8 = ?2
ORDER BY document.offering_id`;

const SELECT_NORMALIZED_INDEXED_OFFERING_IDS_SQL = `SELECT offering_id
FROM publication_provider_model_id_search_document
INDEXED BY publication_provider_model_id_normalized_exact_idx
WHERE publication_id = ?1 AND normalized_provider_model_id_utf8 = ?2
ORDER BY offering_id`;

const ASSERT_ATOMIC_PROVIDER_MODEL_ID_PARITY_V4_SQL = `WITH
nominal_payload(payload) AS (
  VALUES
    (?2), (?3), (?4), (?5), (?6), (?7), (?8), (?9), (?10), (?11),
    (?12), (?13), (?14), (?15), (?16), (?17), (?18), (?19), (?20),
    (?21), (?22), (?23), (?24), (?25), (?26), (?27), (?28), (?29),
    (?30), (?31), (?32), (?33), (?34), (?35)
),
nominal AS (
  SELECT
    json_extract(row.value, '$.publication_id') AS publication_id,
    json_extract(row.value, '$.offering_id') AS offering_id,
    json_extract(row.value, '$.provider_id') AS provider_id,
    json_extract(row.value, '$.target_resource_type') AS target_resource_type,
    json_extract(row.value, '$.target_resource_id') AS target_resource_id,
    json_extract(row.value, '$.projection_version') AS projection_version,
    unhex(json_extract(row.value, '$.raw_provider_model_id_utf8_hex'))
      AS raw_provider_model_id_utf8,
    unhex(json_extract(row.value, '$.normalized_provider_model_id_utf8_hex'))
      AS normalized_provider_model_id_utf8,
    json_extract(row.value, '$.offering_content_hash') AS offering_content_hash,
    json_extract(row.value, '$.target_content_hash') AS target_content_hash
  FROM nominal_payload
  JOIN json_each(nominal_payload.payload) AS row
  WHERE row.type = 'object'
)
SELECT CASE WHEN
  (SELECT count(*) FROM nominal) = ?36
  AND (SELECT count(*)
       FROM publication_provider_model_id_search_document
       WHERE publication_id = ?1) = ?36
  AND NOT EXISTS (
    SELECT 1 FROM nominal
    WHERE nominal.publication_id <> ?1 OR NOT EXISTS (
      SELECT 1 FROM publication_provider_model_id_search_document AS actual
      WHERE actual.publication_id = nominal.publication_id
        AND actual.offering_id = nominal.offering_id
        AND actual.provider_id = nominal.provider_id
        AND actual.target_resource_type = nominal.target_resource_type
        AND actual.target_resource_id = nominal.target_resource_id
        AND actual.projection_version = nominal.projection_version
        AND actual.raw_provider_model_id_utf8 = nominal.raw_provider_model_id_utf8
        AND actual.normalized_provider_model_id_utf8 = nominal.normalized_provider_model_id_utf8
        AND actual.offering_content_hash = nominal.offering_content_hash
        AND actual.target_content_hash = nominal.target_content_hash
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM publication_provider_model_id_search_document AS actual
    WHERE actual.publication_id = ?1 AND NOT EXISTS (
      SELECT 1 FROM nominal
      WHERE nominal.publication_id = actual.publication_id
        AND nominal.offering_id = actual.offering_id
        AND nominal.provider_id = actual.provider_id
        AND nominal.target_resource_type = actual.target_resource_type
        AND nominal.target_resource_id = actual.target_resource_id
        AND nominal.projection_version = actual.projection_version
        AND nominal.raw_provider_model_id_utf8 = actual.raw_provider_model_id_utf8
        AND nominal.normalized_provider_model_id_utf8 = actual.normalized_provider_model_id_utf8
        AND nominal.offering_content_hash = actual.offering_content_hash
        AND nominal.target_content_hash = actual.target_content_hash
    )
  )
THEN 1 ELSE json('') END AS provider_model_id_parity`;

const ASSERT_ATOMIC_PROVIDER_MODEL_ID_INDEXES_V4_SQL = `SELECT CASE WHEN
  (SELECT count(*) FROM pragma_index_info('publication_provider_model_id_raw_exact_idx')) = 3
  AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_raw_exact_idx') WHERE seqno = 0 AND name = 'publication_id')
  AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_raw_exact_idx') WHERE seqno = 1 AND name = 'raw_provider_model_id_utf8')
  AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_raw_exact_idx') WHERE seqno = 2 AND name = 'offering_id')
  AND (SELECT count(*) FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx')) = 3
  AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx') WHERE seqno = 0 AND name = 'publication_id')
  AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx') WHERE seqno = 1 AND name = 'normalized_provider_model_id_utf8')
  AND EXISTS (SELECT 1 FROM pragma_index_info('publication_provider_model_id_normalized_exact_idx') WHERE seqno = 2 AND name = 'offering_id')
  AND NOT EXISTS (
    SELECT offering_id
    FROM publication_provider_model_id_search_document
    INDEXED BY publication_provider_model_id_raw_exact_idx
    WHERE publication_id = ?1 AND raw_provider_model_id_utf8 = ?2
    EXCEPT SELECT value FROM json_each(?3)
  )
  AND NOT EXISTS (
    SELECT value FROM json_each(?3)
    EXCEPT SELECT offering_id
    FROM publication_provider_model_id_search_document
    INDEXED BY publication_provider_model_id_raw_exact_idx
    WHERE publication_id = ?1 AND raw_provider_model_id_utf8 = ?2
  )
  AND NOT EXISTS (
    SELECT 1 FROM publication_provider_model_id_search_document
    INDEXED BY publication_provider_model_id_raw_exact_idx
    WHERE publication_id = ?1 AND raw_provider_model_id_utf8 = X'FF'
  )
  AND NOT EXISTS (
    SELECT offering_id
    FROM publication_provider_model_id_search_document
    INDEXED BY publication_provider_model_id_normalized_exact_idx
    WHERE publication_id = ?1 AND normalized_provider_model_id_utf8 = ?4
    EXCEPT SELECT value FROM json_each(?5)
  )
  AND NOT EXISTS (
    SELECT value FROM json_each(?5)
    EXCEPT SELECT offering_id
    FROM publication_provider_model_id_search_document
    INDEXED BY publication_provider_model_id_normalized_exact_idx
    WHERE publication_id = ?1 AND normalized_provider_model_id_utf8 = ?4
  )
  AND NOT EXISTS (
    SELECT 1 FROM publication_provider_model_id_search_document
    INDEXED BY publication_provider_model_id_normalized_exact_idx
    WHERE publication_id = ?1 AND normalized_provider_model_id_utf8 = X'FF'
  )
THEN 1 ELSE json('') END AS provider_model_id_indexes`;

const ASSERT_EMPTY_BUILDING_SQL = `SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication AS candidate
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building'
    AND candidate.closure_hash = ?2
    AND EXISTS (
      SELECT 1 FROM publication_staging_revision
      WHERE publication_id = ?1 AND revision = ?3
    )
    AND NOT EXISTS (
      SELECT 1 FROM publication_closure_seal WHERE publication_id = ?1
    )
    AND (
      SELECT count(*) FROM publication_resource AS resource
      WHERE resource.publication_id = ?1
        AND resource.resource_type = 'offering'
    ) = ?4
    AND NOT EXISTS (
      SELECT 1 FROM publication_provider_model_id_search_document
      WHERE publication_id = ?1
    )
) THEN 1 ELSE json('') END AS clean`;

const INSERT_DOCUMENTS_SQL = `INSERT INTO publication_provider_model_id_search_document (
  publication_id, offering_id, provider_id, target_resource_type,
  target_resource_id, projection_version, raw_provider_model_id_utf8,
  normalized_provider_model_id_utf8, offering_content_hash, target_content_hash
)
SELECT
  json_extract(payload.value, '$.publication_id'),
  json_extract(payload.value, '$.offering_id'),
  json_extract(payload.value, '$.provider_id'),
  json_extract(payload.value, '$.target_resource_type'),
  json_extract(payload.value, '$.target_resource_id'),
  json_extract(payload.value, '$.projection_version'),
  unhex(json_extract(payload.value, '$.raw_provider_model_id_utf8_hex')),
  unhex(json_extract(payload.value, '$.normalized_provider_model_id_utf8_hex')),
  json_extract(payload.value, '$.offering_content_hash'),
  json_extract(payload.value, '$.target_content_hash')
FROM json_each(?1) AS payload
WHERE payload.type = 'object'
  AND json_type(payload.value, '$.publication_id') = 'text'
  AND json_type(payload.value, '$.offering_id') = 'text'
  AND json_type(payload.value, '$.provider_id') = 'text'
  AND json_type(payload.value, '$.target_resource_type') = 'text'
  AND json_type(payload.value, '$.target_resource_id') = 'text'
  AND json_type(payload.value, '$.projection_version') = 'text'
  AND json_type(payload.value, '$.raw_provider_model_id_utf8_hex') = 'text'
  AND json_type(payload.value, '$.normalized_provider_model_id_utf8_hex') = 'text'
  AND json_type(payload.value, '$.offering_content_hash') = 'text'
  AND json_type(payload.value, '$.target_content_hash') = 'text'
  AND json_extract(payload.value, '$.publication_id') = ?2
  AND json_extract(payload.value, '$.projection_version') = 'provider-model-id@1'
  AND length(json_extract(payload.value, '$.raw_provider_model_id_utf8_hex')) BETWEEN 2 AND 2048
  AND length(json_extract(payload.value, '$.raw_provider_model_id_utf8_hex')) % 2 = 0
  AND json_extract(payload.value, '$.raw_provider_model_id_utf8_hex') = lower(json_extract(payload.value, '$.raw_provider_model_id_utf8_hex'))
  AND json_extract(payload.value, '$.raw_provider_model_id_utf8_hex') NOT GLOB '*[^0-9a-f]*'
  AND length(json_extract(payload.value, '$.normalized_provider_model_id_utf8_hex')) BETWEEN 0 AND 36864
  AND length(json_extract(payload.value, '$.normalized_provider_model_id_utf8_hex')) % 2 = 0
  AND json_extract(payload.value, '$.normalized_provider_model_id_utf8_hex') = lower(json_extract(payload.value, '$.normalized_provider_model_id_utf8_hex'))
  AND json_extract(payload.value, '$.normalized_provider_model_id_utf8_hex') NOT GLOB '*[^0-9a-f]*'
  AND EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_resource AS offering
      ON offering.publication_id = candidate.publication_id
     AND offering.resource_type = 'offering'
     AND offering.resource_id = json_extract(payload.value, '$.offering_id')
    JOIN publication_provider_attribution AS attribution
      ON attribution.publication_id = offering.publication_id
     AND attribution.resource_type = offering.resource_type
     AND attribution.resource_id = offering.resource_id
     AND attribution.provider_id = json_extract(payload.value, '$.provider_id')
    JOIN publication_provider_slice AS disposition
      ON disposition.publication_id = attribution.publication_id
     AND disposition.provider_id = attribution.provider_id
     AND disposition.provider_slice_id IS NOT NULL
    JOIN publication_resource AS target
      ON target.publication_id = offering.publication_id
     AND target.resource_type = json_extract(payload.value, '$.target_resource_type')
     AND target.resource_id = json_extract(payload.value, '$.target_resource_id')
    WHERE candidate.publication_id = ?2
      AND candidate.state = 'building'
      AND candidate.closure_hash = ?3
      AND offering.content_hash = json_extract(payload.value, '$.offering_content_hash')
      AND json_extract(offering.resource_json, '$.offering_id') = offering.resource_id
      AND json_extract(offering.resource_json, '$.provider_id') = attribution.provider_id
      AND json_extract(offering.resource_json, '$.model_resource_id') = target.resource_id
      AND CAST(json_extract(offering.resource_json, '$.provider_model_id') AS BLOB)
          = unhex(json_extract(payload.value, '$.raw_provider_model_id_utf8_hex'))
      AND target.content_hash = json_extract(payload.value, '$.target_content_hash')
      AND CASE target.resource_type
        WHEN 'model' THEN json_extract(target.resource_json, '$.model_id')
        WHEN 'variant' THEN json_extract(target.resource_json, '$.variant_id')
      END = target.resource_id
      AND EXISTS (
        SELECT 1 FROM publication_staging_revision
        WHERE publication_id = ?2 AND revision = ?4
      )
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal WHERE publication_id = ?2
      )
  )`;

const ASSERT_POSTCONDITION_SQL = `SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM publication AS candidate
    WHERE candidate.publication_id = ?1
      AND candidate.state = 'building'
      AND candidate.closure_hash = ?2
      AND EXISTS (
        SELECT 1 FROM publication_staging_revision
        WHERE publication_id = ?1 AND revision = ?3
      )
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal WHERE publication_id = ?1
      )
  )
  AND (
    SELECT count(*) FROM publication_provider_model_id_search_document
    WHERE publication_id = ?1
  ) = ?4
  AND (
    SELECT count(*) FROM publication_resource
    WHERE publication_id = ?1 AND resource_type = 'offering'
  ) = ?4
  AND NOT EXISTS (
    SELECT 1 FROM publication_resource AS offering
    WHERE offering.publication_id = ?1
      AND offering.resource_type = 'offering'
      AND NOT EXISTS (
        SELECT 1
        FROM publication_provider_model_id_search_document AS projected
        JOIN publication_provider_attribution AS attribution
          ON attribution.publication_id = projected.publication_id
         AND attribution.resource_type = 'offering'
         AND attribution.resource_id = projected.offering_id
         AND attribution.provider_id = projected.provider_id
        JOIN publication_provider_slice AS disposition
          ON disposition.publication_id = attribution.publication_id
         AND disposition.provider_id = attribution.provider_id
         AND disposition.provider_slice_id IS NOT NULL
        JOIN publication_resource AS target
          ON target.publication_id = projected.publication_id
         AND target.resource_type = projected.target_resource_type
         AND target.resource_id = projected.target_resource_id
        WHERE projected.publication_id = offering.publication_id
          AND projected.offering_id = offering.resource_id
          AND projected.offering_content_hash = offering.content_hash
          AND json_extract(offering.resource_json, '$.provider_id') = projected.provider_id
          AND json_extract(offering.resource_json, '$.model_resource_id') = projected.target_resource_id
          AND CAST(json_extract(offering.resource_json, '$.provider_model_id') AS BLOB)
              = projected.raw_provider_model_id_utf8
          AND target.content_hash = projected.target_content_hash
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM publication_provider_model_id_search_document AS projected
    WHERE projected.publication_id = ?1
      AND (
        typeof(projected.raw_provider_model_id_utf8) <> 'blob'
        OR typeof(projected.normalized_provider_model_id_utf8) <> 'blob'
        OR NOT EXISTS (
          SELECT 1
          FROM publication_resource AS offering
          JOIN publication_provider_attribution AS attribution
            ON attribution.publication_id = offering.publication_id
           AND attribution.resource_type = offering.resource_type
           AND attribution.resource_id = offering.resource_id
           AND attribution.provider_id = projected.provider_id
          JOIN publication_provider_slice AS disposition
            ON disposition.publication_id = attribution.publication_id
           AND disposition.provider_id = attribution.provider_id
           AND disposition.provider_slice_id IS NOT NULL
          JOIN publication_resource AS target
            ON target.publication_id = offering.publication_id
           AND target.resource_type = projected.target_resource_type
           AND target.resource_id = projected.target_resource_id
          WHERE offering.publication_id = projected.publication_id
            AND offering.resource_type = 'offering'
            AND offering.resource_id = projected.offering_id
            AND offering.content_hash = projected.offering_content_hash
            AND json_extract(offering.resource_json, '$.provider_id') = projected.provider_id
            AND json_extract(offering.resource_json, '$.model_resource_id') = projected.target_resource_id
            AND CAST(json_extract(offering.resource_json, '$.provider_model_id') AS BLOB)
                = projected.raw_provider_model_id_utf8
            AND target.content_hash = projected.target_content_hash
        )
      )
  )
THEN 1 ELSE json('') END AS verified`;

export const PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS = 2_000;
export const PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES = 2 * 1_024 * 1_024;
export const PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES = 1_500_000;
export const PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_JSON_BYTES = 8 * 1_024 * 1_024;
export const PROVIDER_MODEL_ID_SEARCH_D1_MAX_INSERT_CHUNKS = 34;
export const PROVIDER_MODEL_ID_SEARCH_D1_MAX_QUERY_COUNT = 50;
export const PROVIDER_MODEL_ID_SEARCH_MAX_RETAINED_HEAP_BYTES =
  64 * 1_024 * 1_024;
export const PROVIDER_MODEL_ID_SEARCH_D1_INSERT_BOUND_PARAMETERS = 4;
// Reserve both the ordinary durability reconciliation and the catch-path
// reconciliation when the first durability read itself fails. This is the
// invocation-wide worst case, not only the successful write path.
export const PROVIDER_MODEL_ID_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT = 16;
export const PROVIDER_MODEL_ID_SEARCH_ATOMIC_ASSERTION_STATEMENT_COUNT = 2;

export type ProviderModelIdSearchStagingErrorCode =
  | "stale"
  | "conflict"
  | "integrity_failure"
  | "not_applied"
  | "outcome_unknown";

export class ProviderModelIdSearchStagingError extends Error {
  readonly code: ProviderModelIdSearchStagingErrorCode;
  readonly retrySameProjection: boolean;

  constructor(code: ProviderModelIdSearchStagingErrorCode) {
    super(
      "Provider model ID exact-search staging could not be applied safely.",
    );
    this.name = "ProviderModelIdSearchStagingError";
    this.code = code;
    this.retrySameProjection = code === "not_applied";
  }
}

export type ProviderModelIdSearchInsertPlanV1 = Readonly<{
  payloads: readonly string[];
  payloadByteLengths: readonly number[];
  documentCount: number;
  rawProviderModelIdByteCount: number;
  totalJsonBytes: number;
  maximumPayloadBytes: number;
  retainedHeapEstimateBytes: number;
  insertBoundParameterCount: number;
  queryCount: number;
}>;

export type ProviderModelIdSearchStagingResultV4 = Readonly<{
  outcome: "applied" | "idempotent_success";
  publicationId: string;
  documentCount: number;
  artifactProof: ProviderModelIdSearchQueryableArtifactProofV4;
}>;

const utf8 = new TextEncoder();

const bytesToLowercaseHex = (bytes: readonly number[]): string => {
  let result = "";
  for (const byte of bytes) {
    if (
      typeof byte !== "number" ||
      !Number.isSafeInteger(byte) ||
      byte < 0 ||
      byte > 255
    )
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
};

/**
 * Detaches A1 storage rows into bounded lowercase-hex JSON before D1 opens.
 * The conservative heap estimate accounts for retained number arrays, hex
 * strings, JSON strings, the largest UTF-8 measurement, and per-row overhead.
 */
export const planProviderModelIdSearchInsertChunksV1 = (
  documents: readonly ProviderModelIdSearchStorageRowV1[],
): ProviderModelIdSearchInsertPlanV1 => {
  const nominalDocuments = documents;
  const untrustedDocuments: unknown = documents;
  if (
    !Array.isArray(untrustedDocuments) ||
    nominalDocuments.length > PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS
  )
    throw new ProviderModelIdSearchStagingError("integrity_failure");

  let rawProviderModelIdByteCount = 0;
  for (const document of nominalDocuments) {
    if (
      !Array.isArray(document.raw_provider_model_id_utf8) ||
      !Array.isArray(document.normalized_provider_model_id_utf8) ||
      document.raw_provider_model_id_utf8.length === 0 ||
      document.raw_provider_model_id_utf8.length >
        PROVIDER_MODEL_ID_SEARCH_MAX_UTF8_BYTES ||
      document.normalized_provider_model_id_utf8.length >
        PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES
    )
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    rawProviderModelIdByteCount +=
      document.raw_provider_model_id_utf8.length +
      document.normalized_provider_model_id_utf8.length;
    if (
      rawProviderModelIdByteCount > PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES
    )
      throw new ProviderModelIdSearchStagingError("integrity_failure");
  }

  const payloads: string[] = [];
  const payloadByteLengths: number[] = [];
  let serializedRows: string[] = [];
  let payloadBytes = 2;
  let totalJsonBytes = 0;
  let maximumPayloadBytes = 0;

  const finishChunk = () => {
    if (serializedRows.length === 0) return;
    const payload = `[${serializedRows.join(",")}]`;
    const exactBytes = utf8.encode(payload).byteLength;
    if (
      exactBytes !== payloadBytes ||
      exactBytes > PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES
    )
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    totalJsonBytes += exactBytes;
    if (totalJsonBytes > PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_JSON_BYTES)
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    maximumPayloadBytes = Math.max(maximumPayloadBytes, exactBytes);
    payloads.push(payload);
    payloadByteLengths.push(exactBytes);
    serializedRows = [];
    payloadBytes = 2;
  };

  for (const document of nominalDocuments) {
    const detached = {
      publication_id: document.publication_id,
      offering_id: document.offering_id,
      provider_id: document.provider_id,
      target_resource_type: document.target_resource_type,
      target_resource_id: document.target_resource_id,
      projection_version: document.projection_version,
      raw_provider_model_id_utf8_hex: bytesToLowercaseHex(
        document.raw_provider_model_id_utf8,
      ),
      normalized_provider_model_id_utf8_hex: bytesToLowercaseHex(
        document.normalized_provider_model_id_utf8,
      ),
      offering_content_hash: document.offering_content_hash,
      target_content_hash: document.target_content_hash,
    };
    const serialized = JSON.stringify(detached);
    const rowBytes = utf8.encode(serialized).byteLength;
    if (rowBytes + 2 > PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES)
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    const separatorBytes = serializedRows.length === 0 ? 0 : 1;
    if (
      payloadBytes + separatorBytes + rowBytes >
      PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES
    )
      finishChunk();
    serializedRows.push(serialized);
    payloadBytes += (serializedRows.length === 1 ? 0 : 1) + rowBytes;
  }
  finishChunk();

  const queryCount =
    PROVIDER_MODEL_ID_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT + payloads.length;
  const hexNameCharacterCount = rawProviderModelIdByteCount * 2;
  const retainedHeapEstimateBytes =
    rawProviderModelIdByteCount * 8 +
    hexNameCharacterCount * 2 +
    totalJsonBytes * 2 +
    maximumPayloadBytes +
    nominalDocuments.length * 1_024;
  if (
    payloads.length > PROVIDER_MODEL_ID_SEARCH_D1_MAX_INSERT_CHUNKS ||
    queryCount > PROVIDER_MODEL_ID_SEARCH_D1_MAX_QUERY_COUNT ||
    retainedHeapEstimateBytes > PROVIDER_MODEL_ID_SEARCH_MAX_RETAINED_HEAP_BYTES
  )
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  return Object.freeze({
    payloads: Object.freeze(payloads),
    payloadByteLengths: Object.freeze(payloadByteLengths),
    documentCount: nominalDocuments.length,
    rawProviderModelIdByteCount,
    totalJsonBytes,
    maximumPayloadBytes,
    retainedHeapEstimateBytes,
    insertBoundParameterCount:
      PROVIDER_MODEL_ID_SEARCH_D1_INSERT_BOUND_PARAMETERS,
    queryCount,
  });
};

const STATES = new Set<string>([
  "building",
  "failed",
  "ready",
  "active",
  "superseded",
  "rolled_back",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < actual.length; index += 1)
    if (actual[index] !== expected[index]) return false;
  return true;
};

const snapshotResultRows = (
  result: unknown,
  maximum: number,
): readonly unknown[] => {
  if (!isRecord(result))
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  const success: unknown = result.success;
  const untrustedRows: unknown = result.results;
  if (success !== true || !Array.isArray(untrustedRows))
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  const count = untrustedRows.length;
  if (count > maximum)
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  const detached = new Array<unknown>(count);
  for (let index = 0; index < count; index += 1)
    detached[index] = untrustedRows[index];
  return Object.freeze(detached);
};

const snapshotBatchResults = (
  value: unknown,
  expectedCount: number,
): readonly unknown[] => {
  if (!Array.isArray(value))
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  const count = value.length;
  if (count !== expectedCount)
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  const detached = new Array<unknown>(count);
  for (let index = 0; index < count; index += 1) detached[index] = value[index];
  return Object.freeze(detached);
};

const bytesToArrayBuffer = (bytes: readonly number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined)
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    view[index] = byte;
  }
  return buffer;
};

const isFixedProviderModelIdMiss = (bytes: readonly number[]): boolean =>
  bytes.length === 1 && bytes[0] === 255;

/**
 * Builds the two fixed statements that must lead every v4 readiness or switch
 * mutation batch. The first reconstructs the complete nominal projection from
 * a fixed 34-slot payload envelope and proves bidirectional scalar/BLOB parity.
 * The second validates both exact index definitions and forces match/collision
 * plus X'FF' miss probes through the named indexes.
 */
export const prepareProviderModelIdSearchAtomicAssertionsV4 = (
  session: D1DatabaseSession,
  proof: ProviderModelIdSearchQueryableArtifactProofV4,
): readonly D1PreparedStatement[] => {
  let nominal: ReturnType<
    typeof readProviderModelIdSearchQueryablePersistenceV4
  >;
  try {
    nominal = readProviderModelIdSearchQueryablePersistenceV4(proof);
  } catch {
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  }
  const persistence = nominal.providerModelIdSearch;
  const payloadPlan = planProviderModelIdSearchInsertChunksV1(persistence.rows);
  const payloads = new Array<string>(
    PROVIDER_MODEL_ID_SEARCH_D1_MAX_INSERT_CHUNKS,
  ).fill("[]");
  for (let index = 0; index < payloadPlan.payloads.length; index += 1) {
    const payload = payloadPlan.payloads[index];
    if (payload === undefined)
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    payloads[index] = payload;
  }

  const queryability = nominal.queryabilityPlan;
  if (
    !isFixedProviderModelIdMiss(queryability.rawMissProviderModelIdUtf8) ||
    !isFixedProviderModelIdMiss(
      queryability.normalizedMissProviderModelIdUtf8,
    ) ||
    (queryability.rawMatchProviderModelIdUtf8 === null) !==
      (queryability.normalizedMatchProviderModelIdUtf8 === null)
  )
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  const rawMatch =
    queryability.rawMatchProviderModelIdUtf8 ??
    queryability.rawMissProviderModelIdUtf8;
  const normalizedMatch =
    queryability.normalizedMatchProviderModelIdUtf8 ??
    queryability.normalizedMissProviderModelIdUtf8;

  return Object.freeze([
    session
      .prepare(ASSERT_ATOMIC_PROVIDER_MODEL_ID_PARITY_V4_SQL)
      .bind(persistence.publicationId, ...payloads, persistence.documentCount),
    session
      .prepare(ASSERT_ATOMIC_PROVIDER_MODEL_ID_INDEXES_V4_SQL)
      .bind(
        persistence.publicationId,
        bytesToArrayBuffer(rawMatch),
        JSON.stringify(queryability.rawMatchOfferingIds),
        bytesToArrayBuffer(normalizedMatch),
        JSON.stringify(queryability.normalizedMatchOfferingIds),
      ),
  ]);
};

const snapshotStorage = async (
  database: D1Database,
  expected: ProviderModelIdSearchStagingProjectionV1,
) => {
  const persistence = readProviderModelIdSearchStagingPersistenceV1(expected);
  const session = database.withSession("first-primary");
  const untrusted = await session.batch([
    session.prepare(SELECT_PUBLICATION_SQL).bind(persistence.publicationId),
    session.prepare(SELECT_DOCUMENTS_SQL).bind(persistence.publicationId),
  ]);
  const results = snapshotBatchResults(untrusted, 2);
  const publicationRows = snapshotResultRows(results[0], 1);
  const documentRows = snapshotResultRows(
    results[1],
    PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS,
  );
  const publicationRow = publicationRows[0];
  if (
    publicationRows.length !== 1 ||
    !isRecord(publicationRow) ||
    !exactKeys(publicationRow, [
      "state",
      "closure_hash",
      "staging_revision",
      "sealed",
      "eligible_document_count",
    ])
  )
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  const state: unknown = publicationRow.state;
  const closureHash: unknown = publicationRow.closure_hash;
  const stagingRevision: unknown = publicationRow.staging_revision;
  const sealed: unknown = publicationRow.sealed;
  const eligibleDocumentCount: unknown = publicationRow.eligible_document_count;
  if (
    typeof state !== "string" ||
    !STATES.has(state) ||
    typeof closureHash !== "string" ||
    typeof stagingRevision !== "number" ||
    !Number.isSafeInteger(stagingRevision) ||
    stagingRevision < 0 ||
    (sealed !== 0 && sealed !== 1) ||
    typeof eligibleDocumentCount !== "number" ||
    !Number.isSafeInteger(eligibleDocumentCount) ||
    eligibleDocumentCount < 0
  )
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  return Object.freeze({
    publicationState: state as PublicationState,
    closureHash,
    stagingRevision,
    sealed: sealed === 1,
    eligibleDocumentCount,
    documentRows,
  });
};

const storageProof = (
  expected: ProviderModelIdSearchStagingProjectionV1,
  documentRows: readonly unknown[],
): ProviderModelIdSearchArtifactProofV1 | undefined => {
  try {
    return projectProviderModelIdSearchArtifactProofV1({
      staging: expected,
      observation: {
        storageVersion: PROVIDER_MODEL_ID_SEARCH_STORAGE_VERSION,
        rows: documentRows as readonly ProviderModelIdSearchStorageRowV1[],
      },
    });
  } catch {
    return undefined;
  }
};

const snapshotOfferingIds = (result: unknown): readonly string[] => {
  const resultRows = snapshotResultRows(
    result,
    PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS,
  );
  const ids = new Array<string>(resultRows.length);
  for (let index = 0; index < resultRows.length; index += 1) {
    const row = resultRows[index];
    if (!isRecord(row) || !exactKeys(row, ["offering_id"]))
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    const offeringId: unknown = row.offering_id;
    if (typeof offeringId !== "string")
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    ids[index] = offeringId;
  }
  return Object.freeze(ids);
};

const snapshotRawOfferingIdsWithIndexDefinitions = (
  result: unknown,
): readonly string[] => {
  const rows = snapshotResultRows(
    result,
    PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS + 1,
  );
  if (rows.length === 0)
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  const offeringIds: string[] = [];
  for (const row of rows) {
    if (
      !isRecord(row) ||
      !exactKeys(row, ["offering_id", "indexes_exact"]) ||
      row.indexes_exact !== 1 ||
      (row.offering_id !== null && typeof row.offering_id !== "string")
    )
      throw new ProviderModelIdSearchStagingError("integrity_failure");
    if (typeof row.offering_id === "string") offeringIds.push(row.offering_id);
  }
  return Object.freeze(offeringIds);
};

const exactBytes = (
  observed: unknown,
  expected: readonly number[],
): boolean => {
  if (!Array.isArray(observed) || observed.length !== expected.length)
    return false;
  for (let index = 0; index < expected.length; index += 1) {
    const value: unknown = observed[index];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 255 ||
      value !== expected[index]
    )
      return false;
  }
  return true;
};

const exactStringArray = (
  observed: readonly string[],
  expected: readonly string[],
): boolean => {
  if (observed.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1)
    if (observed[index] !== expected[index]) return false;
  return true;
};

const exactStorageRows = (
  observed: readonly unknown[],
  expected: readonly ProviderModelIdSearchStorageRowV1[],
): boolean => {
  if (observed.length !== expected.length) return false;
  const keys = [
    "publication_id",
    "offering_id",
    "provider_id",
    "target_resource_type",
    "target_resource_id",
    "projection_version",
    "raw_provider_model_id_utf8",
    "normalized_provider_model_id_utf8",
    "offering_content_hash",
    "target_content_hash",
  ] as const;
  for (let index = 0; index < expected.length; index += 1) {
    const actual = observed[index];
    const nominal = expected[index];
    if (
      nominal === undefined ||
      !isRecord(actual) ||
      !exactKeys(actual, keys) ||
      actual.publication_id !== nominal.publication_id ||
      actual.offering_id !== nominal.offering_id ||
      actual.provider_id !== nominal.provider_id ||
      actual.target_resource_type !== nominal.target_resource_type ||
      actual.target_resource_id !== nominal.target_resource_id ||
      actual.projection_version !== nominal.projection_version ||
      !exactBytes(
        actual.raw_provider_model_id_utf8,
        nominal.raw_provider_model_id_utf8,
      ) ||
      !exactBytes(
        actual.normalized_provider_model_id_utf8,
        nominal.normalized_provider_model_id_utf8,
      ) ||
      actual.offering_content_hash !== nominal.offering_content_hash ||
      actual.target_content_hash !== nominal.target_content_hash
    )
      return false;
  }
  return true;
};

const indexedOfferingIds = async (
  database: D1Database,
  publicationId: string,
  plan: ReturnType<typeof projectProviderModelIdSearchQueryabilityPlanV4>,
): Promise<
  Readonly<{
    rawMatch: readonly string[];
    rawMiss: readonly string[];
    normalizedMatch: readonly string[];
    normalizedMiss: readonly string[];
  }>
> => {
  const session = database.withSession("first-primary");
  const rawMatch = plan.rawMatchProviderModelIdUtf8;
  const normalizedMatch = plan.normalizedMatchProviderModelIdUtf8;
  if ((rawMatch === null) !== (normalizedMatch === null))
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  if (rawMatch === null && normalizedMatch === null) {
    const untrusted = await session.batch([
      session
        .prepare(SELECT_RAW_INDEXED_OFFERING_IDS_SQL)
        .bind(
          publicationId,
          bytesToArrayBuffer(plan.rawMissProviderModelIdUtf8),
        ),
      session
        .prepare(SELECT_NORMALIZED_INDEXED_OFFERING_IDS_SQL)
        .bind(
          publicationId,
          bytesToArrayBuffer(plan.normalizedMissProviderModelIdUtf8),
        ),
    ]);
    const results = snapshotBatchResults(untrusted, 2);
    const rawMiss = snapshotRawOfferingIdsWithIndexDefinitions(results[0]);
    const normalizedMiss = snapshotOfferingIds(results[1]);
    return Object.freeze({
      rawMatch: Object.freeze([]),
      rawMiss,
      normalizedMatch: Object.freeze([]),
      normalizedMiss,
    });
  }
  if (rawMatch === null || normalizedMatch === null)
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  const untrusted = await session.batch([
    session
      .prepare(SELECT_RAW_INDEXED_OFFERING_IDS_SQL)
      .bind(publicationId, bytesToArrayBuffer(rawMatch)),
    session
      .prepare(SELECT_RAW_INDEXED_OFFERING_IDS_SQL)
      .bind(publicationId, bytesToArrayBuffer(plan.rawMissProviderModelIdUtf8)),
    session
      .prepare(SELECT_NORMALIZED_INDEXED_OFFERING_IDS_SQL)
      .bind(publicationId, bytesToArrayBuffer(normalizedMatch)),
    session
      .prepare(SELECT_NORMALIZED_INDEXED_OFFERING_IDS_SQL)
      .bind(
        publicationId,
        bytesToArrayBuffer(plan.normalizedMissProviderModelIdUtf8),
      ),
  ]);
  const results = snapshotBatchResults(untrusted, 4);
  return Object.freeze({
    rawMatch: snapshotRawOfferingIdsWithIndexDefinitions(results[0]),
    rawMiss: snapshotRawOfferingIdsWithIndexDefinitions(results[1]),
    normalizedMatch: snapshotOfferingIds(results[2]),
    normalizedMiss: snapshotOfferingIds(results[3]),
  });
};

/**
 * Revalidates a nominal v4 proof against primary-anchored D1 state without
 * mutating storage. Readiness and switch paths share this verifier so neither
 * can replace exact row, byte, root, and dual-index parity with scalar claims.
 */
export const verifyProviderModelIdSearchStorageV4 = async (
  database: D1Database,
  proof: ProviderModelIdSearchQueryableArtifactProofV4,
): Promise<void> => {
  let nominal: ReturnType<
    typeof readProviderModelIdSearchQueryablePersistenceV4
  >;
  try {
    nominal = readProviderModelIdSearchQueryablePersistenceV4(proof);
  } catch {
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  }
  const persistence = nominal.providerModelIdSearch;
  let documentBatch: unknown;
  try {
    const session = database.withSession("first-primary");
    documentBatch = await session.batch([
      session.prepare(SELECT_DOCUMENTS_SQL).bind(persistence.publicationId),
    ]);
  } catch {
    throw new ProviderModelIdSearchStagingError("outcome_unknown");
  }
  const documentResult = snapshotBatchResults(documentBatch, 1)[0];
  const rows = snapshotResultRows(
    documentResult,
    PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS,
  );
  if (
    persistence.documentCount !== persistence.rows.length ||
    proof.provider_model_id_document_count !== persistence.documentCount ||
    proof.provider_model_id_inventory_hash !== persistence.inventoryHash ||
    proof.provider_model_id_storage_document_count !==
      persistence.documentCount ||
    !exactStorageRows(rows, persistence.rows)
  )
    throw new ProviderModelIdSearchStagingError("integrity_failure");

  let observed: Awaited<ReturnType<typeof indexedOfferingIds>>;
  try {
    observed = await indexedOfferingIds(
      database,
      persistence.publicationId,
      nominal.queryabilityPlan,
    );
  } catch (error) {
    if (error instanceof ProviderModelIdSearchStagingError) throw error;
    throw new ProviderModelIdSearchStagingError("outcome_unknown");
  }
  const plan = nominal.queryabilityPlan;
  if (
    !exactStringArray(observed.rawMatch, plan.rawMatchOfferingIds) ||
    !exactStringArray(observed.rawMiss, plan.rawMissOfferingIds) ||
    !exactStringArray(
      observed.normalizedMatch,
      plan.normalizedMatchOfferingIds,
    ) ||
    !exactStringArray(observed.normalizedMiss, plan.normalizedMissOfferingIds)
  )
    throw new ProviderModelIdSearchStagingError("integrity_failure");
};

const queryableProof = async (
  database: D1Database,
  expected: ProviderModelIdSearchStagingProjectionV1,
  proof: ProviderModelIdSearchArtifactProofV1,
): Promise<ProviderModelIdSearchQueryableArtifactProofV4> => {
  const persistence = readProviderModelIdSearchStagingPersistenceV1(expected);
  const plan = projectProviderModelIdSearchQueryabilityPlanV4(proof);
  const observed = await indexedOfferingIds(
    database,
    persistence.publicationId,
    plan,
  );
  try {
    return projectProviderModelIdSearchQueryableArtifactProofV4({
      storageProof: proof,
      queryability: {
        rawIndexName: PROVIDER_MODEL_ID_SEARCH_RAW_EXACT_INDEX_NAME,
        rawMatchProviderModelIdUtf8: plan.rawMatchProviderModelIdUtf8,
        rawMatchOfferingIds: observed.rawMatch,
        rawMissProviderModelIdUtf8: plan.rawMissProviderModelIdUtf8,
        rawMissOfferingIds: observed.rawMiss,
        normalizedIndexName:
          PROVIDER_MODEL_ID_SEARCH_NORMALIZED_EXACT_INDEX_NAME,
        normalizedMatchProviderModelIdUtf8:
          plan.normalizedMatchProviderModelIdUtf8,
        normalizedMatchOfferingIds: observed.normalizedMatch,
        normalizedMissProviderModelIdUtf8:
          plan.normalizedMissProviderModelIdUtf8,
        normalizedMissOfferingIds: observed.normalizedMiss,
      },
    });
  } catch {
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  }
};

const observedRowsOverlapExpected = (
  observedRows: readonly unknown[],
  expectedRows: readonly ProviderModelIdSearchStorageRowV1[],
): boolean | undefined => {
  const expectedKeys = new Set<string>();
  for (const row of expectedRows) expectedKeys.add(row.offering_id);
  let overlaps = false;
  for (const value of observedRows) {
    if (
      !isRecord(value) ||
      !exactKeys(value, [
        "publication_id",
        "offering_id",
        "provider_id",
        "target_resource_type",
        "target_resource_id",
        "projection_version",
        "raw_provider_model_id_utf8",
        "normalized_provider_model_id_utf8",
        "offering_content_hash",
        "target_content_hash",
      ])
    )
      return undefined;
    const offeringId: unknown = value.offering_id;
    if (typeof offeringId !== "string") return undefined;
    if (expectedKeys.has(offeringId)) overlaps = true;
  }
  return overlaps;
};

type Decision =
  | Readonly<{
      outcome: "idempotent_success";
      proof: ProviderModelIdSearchQueryableArtifactProofV4;
    }>
  | Readonly<{
      outcome: "execute" | ProviderModelIdSearchStagingErrorCode;
    }>;

const classify = async (
  database: D1Database,
  expected: ProviderModelIdSearchStagingProjectionV1,
): Promise<Decision> => {
  const persistence = readProviderModelIdSearchStagingPersistenceV1(expected);
  const observed = await snapshotStorage(database, expected);
  if (
    observed.closureHash !== persistence.closureHash ||
    observed.stagingRevision !== persistence.stagingRevision ||
    observed.eligibleDocumentCount !== persistence.documentCount
  )
    return Object.freeze({ outcome: "stale" });
  const proof = storageProof(expected, observed.documentRows);
  if (proof !== undefined) {
    const queryable = await queryableProof(database, expected, proof);
    return Object.freeze({
      outcome: "idempotent_success",
      proof: queryable,
    });
  }
  if (persistence.documentCount === 0 && observed.documentRows.length === 0) {
    if (observed.publicationState === "building" && !observed.sealed)
      return Object.freeze({ outcome: "execute" });
    if (observed.publicationState === "failed" && !observed.sealed)
      return Object.freeze({ outcome: "stale" });
    return Object.freeze({ outcome: "integrity_failure" });
  }
  if (observed.documentRows.length !== 0) {
    const overlaps = observedRowsOverlapExpected(
      observed.documentRows,
      persistence.rows,
    );
    return Object.freeze({
      outcome:
        overlaps === undefined
          ? "integrity_failure"
          : overlaps
            ? "conflict"
            : "integrity_failure",
    });
  }
  if (observed.publicationState === "building" && !observed.sealed)
    return Object.freeze({ outcome: "execute" });
  if (observed.publicationState === "failed")
    return Object.freeze({ outcome: "stale" });
  return Object.freeze({ outcome: "integrity_failure" });
};

const success = (
  expected: ProviderModelIdSearchStagingProjectionV1,
  outcome: ProviderModelIdSearchStagingResultV4["outcome"],
  artifactProof: ProviderModelIdSearchQueryableArtifactProofV4,
): ProviderModelIdSearchStagingResultV4 => {
  const persistence = readProviderModelIdSearchStagingPersistenceV1(expected);
  return Object.freeze({
    outcome,
    publicationId: persistence.publicationId,
    documentCount: persistence.documentCount,
    artifactProof,
  });
};

const throwDecision = (outcome: string): never => {
  throw new ProviderModelIdSearchStagingError(
    outcome as ProviderModelIdSearchStagingErrorCode,
  );
};

/** Fixed pre-seal ADR 0028 provider-model-ID exact BLOB writer. */
export const applyProviderModelIdSearchStagingV1 = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ProviderModelIdSearchStagingResultV4> => {
  try {
    assertProviderModelIdSearchStagingProjectionV1(expectedValue);
  } catch {
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  }
  const expected = expectedValue;
  const persistence = readProviderModelIdSearchStagingPersistenceV1(expected);
  let insertPlan: ProviderModelIdSearchInsertPlanV1;
  try {
    insertPlan = planProviderModelIdSearchInsertChunksV1(persistence.rows);
  } catch {
    throw new ProviderModelIdSearchStagingError("integrity_failure");
  }

  let initial: Decision;
  try {
    initial = await classify(database, expected);
  } catch (error) {
    if (error instanceof ProviderModelIdSearchStagingError) throw error;
    throw new ProviderModelIdSearchStagingError("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success")
    return success(expected, "idempotent_success", initial.proof);
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);

  try {
    const session = database.withSession("first-primary");
    const statements: D1PreparedStatement[] = [
      session
        .prepare(ASSERT_EMPTY_BUILDING_SQL)
        .bind(
          persistence.publicationId,
          persistence.closureHash,
          persistence.stagingRevision,
          persistence.documentCount,
        ),
    ];
    for (const payload of insertPlan.payloads) {
      statements.push(
        session
          .prepare(INSERT_DOCUMENTS_SQL)
          .bind(
            payload,
            persistence.publicationId,
            persistence.closureHash,
            persistence.stagingRevision,
          ),
      );
    }
    statements.push(
      session
        .prepare(ASSERT_POSTCONDITION_SQL)
        .bind(
          persistence.publicationId,
          persistence.closureHash,
          persistence.stagingRevision,
          persistence.documentCount,
        ),
    );
    const untrusted = await session.batch(statements);
    const results = snapshotBatchResults(untrusted, statements.length);
    const capturedRows = new Array<readonly unknown[]>(results.length);
    for (let index = 0; index < results.length; index += 1)
      capturedRows[index] = snapshotResultRows(results[index], 1);
    const postconditionRows = capturedRows[capturedRows.length - 1];
    if (postconditionRows === undefined)
      throw new Error("ambiguous D1 postcondition result");
    const verified = postconditionRows[0];
    if (!isRecord(verified) || verified.verified !== 1)
      throw new Error("ambiguous D1 postcondition result");

    if (persistence.documentCount === 0) {
      const observed = await snapshotStorage(database, expected);
      const proof = storageProof(expected, observed.documentRows);
      if (proof === undefined)
        throw new Error(
          "empty provider model ID staging postcondition was not durable",
        );
      const queryable = await queryableProof(database, expected, proof);
      return success(expected, "applied", queryable);
    }
    const reconciled = await classify(database, expected);
    if (reconciled.outcome !== "idempotent_success")
      throw new Error(
        "provider model ID staging postcondition was not durable",
      );
    return success(expected, "applied", reconciled.proof);
  } catch {
    let reconciled: Decision;
    try {
      reconciled = await classify(database, expected);
    } catch (error) {
      if (error instanceof ProviderModelIdSearchStagingError) throw error;
      throw new ProviderModelIdSearchStagingError("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success")
      return success(expected, "idempotent_success", reconciled.proof);
    if (reconciled.outcome === "execute")
      throw new ProviderModelIdSearchStagingError("not_applied");
    return throwDecision(reconciled.outcome);
  }
};
