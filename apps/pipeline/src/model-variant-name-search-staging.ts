import {
  MODEL_VARIANT_NAME_SEARCH_EXACT_INDEX_NAME,
  MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
  assertModelVariantNameSearchStagingProjectionV1,
  projectModelVariantNameSearchArtifactProofV1,
  projectModelVariantNameSearchQueryabilityPlanV3,
  projectModelVariantNameSearchQueryableArtifactProofV3,
  readModelVariantNameSearchStagingPersistenceV1,
  type ModelVariantNameSearchArtifactProofV1,
  type ModelVariantNameSearchQueryableArtifactProofV3,
  type ModelVariantNameSearchStagingProjectionV1,
  type ModelVariantNameSearchStorageRowV1,
  type PublicationState,
} from "@quant-clarity/publication-core";

const SELECT_PUBLICATION_SQL = `SELECT
  candidate.state,
  candidate.closure_hash,
  revision.revision AS staging_revision,
  CASE WHEN seal.publication_id IS NULL THEN 0 ELSE 1 END AS sealed,
  (SELECT count(*) FROM publication_resource AS resource
   WHERE resource.publication_id = candidate.publication_id
     AND resource.resource_type IN ('model', 'variant')
     AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
  ) AS eligible_document_count
FROM publication AS candidate
JOIN publication_staging_revision AS revision USING (publication_id)
LEFT JOIN publication_closure_seal AS seal USING (publication_id)
WHERE candidate.publication_id = ?1`;

const SELECT_DOCUMENTS_SQL = `SELECT
  publication_id, resource_type, resource_id, projection_version,
  display_name_utf8, normalized_name_utf8, resource_content_hash
FROM publication_model_variant_name_search_document
WHERE publication_id = ?1
ORDER BY resource_type, resource_id`;

// INDEXED BY is intentional: successful execution proves the named exact BLOB
// index exists and can answer the nominal match and deterministic miss probes.
const SELECT_INDEXED_RESOURCE_IDS_SQL = `SELECT resource_id
FROM publication_model_variant_name_search_document
INDEXED BY publication_model_variant_name_exact_idx
WHERE publication_id = ?1 AND normalized_name_utf8 = ?2
ORDER BY resource_id`;

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
        AND resource.resource_type IN ('model', 'variant')
        AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
    ) = ?4
    AND NOT EXISTS (
      SELECT 1 FROM publication_model_variant_name_search_document
      WHERE publication_id = ?1
    )
) THEN 1 ELSE json('') END AS clean`;

const INSERT_DOCUMENTS_SQL = `INSERT INTO publication_model_variant_name_search_document (
  publication_id, resource_type, resource_id, projection_version,
  display_name_utf8, normalized_name_utf8, resource_content_hash
)
SELECT
  json_extract(payload.value, '$.publication_id'),
  json_extract(payload.value, '$.resource_type'),
  json_extract(payload.value, '$.resource_id'),
  json_extract(payload.value, '$.projection_version'),
  unhex(json_extract(payload.value, '$.display_name_utf8_hex')),
  unhex(json_extract(payload.value, '$.normalized_name_utf8_hex')),
  json_extract(payload.value, '$.resource_content_hash')
FROM json_each(?1) AS payload
WHERE payload.type = 'object'
  AND json_type(payload.value, '$.publication_id') = 'text'
  AND json_type(payload.value, '$.resource_type') = 'text'
  AND json_type(payload.value, '$.resource_id') = 'text'
  AND json_type(payload.value, '$.projection_version') = 'text'
  AND json_type(payload.value, '$.display_name_utf8_hex') = 'text'
  AND json_type(payload.value, '$.normalized_name_utf8_hex') = 'text'
  AND json_type(payload.value, '$.resource_content_hash') = 'text'
  AND json_extract(payload.value, '$.publication_id') = ?2
  AND json_extract(payload.value, '$.projection_version') = 'model-variant-name@1'
  AND length(json_extract(payload.value, '$.display_name_utf8_hex')) BETWEEN 2 AND 1600
  AND length(json_extract(payload.value, '$.display_name_utf8_hex')) % 2 = 0
  AND json_extract(payload.value, '$.display_name_utf8_hex') = lower(json_extract(payload.value, '$.display_name_utf8_hex'))
  AND json_extract(payload.value, '$.display_name_utf8_hex') NOT GLOB '*[^0-9a-f]*'
  AND length(json_extract(payload.value, '$.normalized_name_utf8_hex')) BETWEEN 2 AND 28800
  AND length(json_extract(payload.value, '$.normalized_name_utf8_hex')) % 2 = 0
  AND json_extract(payload.value, '$.normalized_name_utf8_hex') = lower(json_extract(payload.value, '$.normalized_name_utf8_hex'))
  AND json_extract(payload.value, '$.normalized_name_utf8_hex') NOT GLOB '*[^0-9a-f]*'
  AND EXISTS (
    SELECT 1
    FROM publication AS candidate
    JOIN publication_resource AS resource
      ON resource.publication_id = candidate.publication_id
     AND resource.resource_type = json_extract(payload.value, '$.resource_type')
     AND resource.resource_id = json_extract(payload.value, '$.resource_id')
    WHERE candidate.publication_id = ?2
      AND candidate.state = 'building'
      AND candidate.closure_hash = ?3
      AND resource.resource_type IN ('model', 'variant')
      AND resource.content_hash = json_extract(payload.value, '$.resource_content_hash')
      AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
      AND json_type(resource.resource_json, '$.display_name.value') = 'text'
      AND CAST(json_extract(resource.resource_json, '$.display_name.value') AS BLOB)
          = unhex(json_extract(payload.value, '$.display_name_utf8_hex'))
      AND json_type(resource.resource_json, '$.display_name.observed_at') = 'text'
      AND json_type(resource.resource_json, '$.display_name.evidence_ids') = 'array'
      AND json_array_length(json_extract(resource.resource_json, '$.display_name.evidence_ids')) >= 1
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
    SELECT count(*) FROM publication_model_variant_name_search_document
    WHERE publication_id = ?1
  ) = ?4
  AND NOT EXISTS (
    SELECT 1 FROM publication_resource AS resource
    WHERE resource.publication_id = ?1
      AND resource.resource_type IN ('model', 'variant')
      AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
      AND NOT EXISTS (
        SELECT 1 FROM publication_model_variant_name_search_document AS projected
        WHERE projected.publication_id = resource.publication_id
          AND projected.resource_type = resource.resource_type
          AND projected.resource_id = resource.resource_id
          AND projected.resource_content_hash = resource.content_hash
          AND projected.display_name_utf8 = CAST(json_extract(resource.resource_json, '$.display_name.value') AS BLOB)
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM publication_model_variant_name_search_document AS projected
    WHERE projected.publication_id = ?1
      AND (
        typeof(projected.display_name_utf8) <> 'blob'
        OR typeof(projected.normalized_name_utf8) <> 'blob'
        OR NOT EXISTS (
          SELECT 1 FROM publication_resource AS resource
          WHERE resource.publication_id = projected.publication_id
            AND resource.resource_type = projected.resource_type
            AND resource.resource_id = projected.resource_id
            AND resource.content_hash = projected.resource_content_hash
            AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
            AND projected.display_name_utf8 = CAST(json_extract(resource.resource_json, '$.display_name.value') AS BLOB)
        )
      )
  )
THEN 1 ELSE json('') END AS verified`;

export const MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS = 2_000;
export const MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES = 2 * 1_024 * 1_024;
export const MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES = 1_500_000;
export const MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_JSON_BYTES = 8 * 1_024 * 1_024;
export const MODEL_VARIANT_NAME_SEARCH_D1_MAX_INSERT_CHUNKS = 40;
export const MODEL_VARIANT_NAME_SEARCH_D1_MAX_QUERY_COUNT = 50;
export const MODEL_VARIANT_NAME_SEARCH_MAX_RETAINED_HEAP_BYTES =
  64 * 1_024 * 1_024;
export const MODEL_VARIANT_NAME_SEARCH_D1_INSERT_BOUND_PARAMETERS = 4;
// Reserve both the ordinary durability reconciliation and the catch-path
// reconciliation when the first durability read itself fails. This is the
// invocation-wide worst case, not only the successful write path.
export const MODEL_VARIANT_NAME_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT = 12;

export type ModelVariantNameSearchStagingErrorCode =
  | "stale"
  | "conflict"
  | "integrity_failure"
  | "not_applied"
  | "outcome_unknown";

export class ModelVariantNameSearchStagingError extends Error {
  readonly code: ModelVariantNameSearchStagingErrorCode;
  readonly retrySameProjection: boolean;

  constructor(code: ModelVariantNameSearchStagingErrorCode) {
    super("Model/variant exact-search staging could not be applied safely.");
    this.name = "ModelVariantNameSearchStagingError";
    this.code = code;
    this.retrySameProjection = code === "not_applied";
  }
}

export type ModelVariantNameSearchInsertPlanV1 = Readonly<{
  payloads: readonly string[];
  payloadByteLengths: readonly number[];
  documentCount: number;
  rawNameByteCount: number;
  totalJsonBytes: number;
  maximumPayloadBytes: number;
  retainedHeapEstimateBytes: number;
  insertBoundParameterCount: number;
  queryCount: number;
}>;

export type ModelVariantNameSearchStagingResultV3 = Readonly<{
  outcome: "applied" | "idempotent_success";
  publicationId: string;
  documentCount: number;
  artifactProof: ModelVariantNameSearchQueryableArtifactProofV3;
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
      throw new ModelVariantNameSearchStagingError("integrity_failure");
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
};

/**
 * Detaches A1 storage rows into bounded lowercase-hex JSON before D1 opens.
 * The conservative heap estimate accounts for retained number arrays, hex
 * strings, JSON strings, the largest UTF-8 measurement, and per-row overhead.
 */
export const planModelVariantNameSearchInsertChunksV1 = (
  documents: readonly ModelVariantNameSearchStorageRowV1[],
): ModelVariantNameSearchInsertPlanV1 => {
  const nominalDocuments = documents;
  const untrustedDocuments: unknown = documents;
  if (
    !Array.isArray(untrustedDocuments) ||
    nominalDocuments.length > MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS
  )
    throw new ModelVariantNameSearchStagingError("integrity_failure");

  let rawNameByteCount = 0;
  for (const document of nominalDocuments) {
    if (
      !Array.isArray(document.display_name_utf8) ||
      !Array.isArray(document.normalized_name_utf8) ||
      document.display_name_utf8.length === 0 ||
      document.display_name_utf8.length >
        MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES ||
      document.normalized_name_utf8.length === 0 ||
      document.normalized_name_utf8.length >
        MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES
    )
      throw new ModelVariantNameSearchStagingError("integrity_failure");
    rawNameByteCount +=
      document.display_name_utf8.length + document.normalized_name_utf8.length;
    if (rawNameByteCount > MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES)
      throw new ModelVariantNameSearchStagingError("integrity_failure");
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
      exactBytes > MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES
    )
      throw new ModelVariantNameSearchStagingError("integrity_failure");
    totalJsonBytes += exactBytes;
    if (totalJsonBytes > MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_JSON_BYTES)
      throw new ModelVariantNameSearchStagingError("integrity_failure");
    maximumPayloadBytes = Math.max(maximumPayloadBytes, exactBytes);
    payloads.push(payload);
    payloadByteLengths.push(exactBytes);
    serializedRows = [];
    payloadBytes = 2;
  };

  for (const document of nominalDocuments) {
    const detached = {
      publication_id: document.publication_id,
      resource_type: document.resource_type,
      resource_id: document.resource_id,
      projection_version: document.projection_version,
      display_name_utf8_hex: bytesToLowercaseHex(document.display_name_utf8),
      normalized_name_utf8_hex: bytesToLowercaseHex(
        document.normalized_name_utf8,
      ),
      resource_content_hash: document.resource_content_hash,
    };
    const serialized = JSON.stringify(detached);
    const rowBytes = utf8.encode(serialized).byteLength;
    if (rowBytes + 2 > MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES)
      throw new ModelVariantNameSearchStagingError("integrity_failure");
    const separatorBytes = serializedRows.length === 0 ? 0 : 1;
    if (
      payloadBytes + separatorBytes + rowBytes >
      MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES
    )
      finishChunk();
    serializedRows.push(serialized);
    payloadBytes += (serializedRows.length === 1 ? 0 : 1) + rowBytes;
  }
  finishChunk();

  const queryCount =
    MODEL_VARIANT_NAME_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT + payloads.length;
  const hexNameCharacterCount = rawNameByteCount * 2;
  const retainedHeapEstimateBytes =
    rawNameByteCount * 8 +
    hexNameCharacterCount * 2 +
    totalJsonBytes * 2 +
    maximumPayloadBytes +
    nominalDocuments.length * 1_024;
  if (
    payloads.length > MODEL_VARIANT_NAME_SEARCH_D1_MAX_INSERT_CHUNKS ||
    queryCount > MODEL_VARIANT_NAME_SEARCH_D1_MAX_QUERY_COUNT ||
    retainedHeapEstimateBytes >
      MODEL_VARIANT_NAME_SEARCH_MAX_RETAINED_HEAP_BYTES
  )
    throw new ModelVariantNameSearchStagingError("integrity_failure");
  return Object.freeze({
    payloads: Object.freeze(payloads),
    payloadByteLengths: Object.freeze(payloadByteLengths),
    documentCount: nominalDocuments.length,
    rawNameByteCount,
    totalJsonBytes,
    maximumPayloadBytes,
    retainedHeapEstimateBytes,
    insertBoundParameterCount:
      MODEL_VARIANT_NAME_SEARCH_D1_INSERT_BOUND_PARAMETERS,
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
    throw new ModelVariantNameSearchStagingError("integrity_failure");
  const success: unknown = result.success;
  const untrustedRows: unknown = result.results;
  if (success !== true || !Array.isArray(untrustedRows))
    throw new ModelVariantNameSearchStagingError("integrity_failure");
  const count = untrustedRows.length;
  if (count > maximum)
    throw new ModelVariantNameSearchStagingError("integrity_failure");
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
    throw new ModelVariantNameSearchStagingError("integrity_failure");
  const count = value.length;
  if (count !== expectedCount)
    throw new ModelVariantNameSearchStagingError("integrity_failure");
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
      throw new ModelVariantNameSearchStagingError("integrity_failure");
    view[index] = byte;
  }
  return buffer;
};

const snapshotStorage = async (
  database: D1Database,
  expected: ModelVariantNameSearchStagingProjectionV1,
) => {
  const persistence = readModelVariantNameSearchStagingPersistenceV1(expected);
  const session = database.withSession("first-primary");
  const untrusted = await session.batch([
    session.prepare(SELECT_PUBLICATION_SQL).bind(persistence.publicationId),
    session.prepare(SELECT_DOCUMENTS_SQL).bind(persistence.publicationId),
  ]);
  const results = snapshotBatchResults(untrusted, 2);
  const publicationRows = snapshotResultRows(results[0], 1);
  const documentRows = snapshotResultRows(
    results[1],
    MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS,
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
    throw new ModelVariantNameSearchStagingError("integrity_failure");
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
    throw new ModelVariantNameSearchStagingError("integrity_failure");
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
  expected: ModelVariantNameSearchStagingProjectionV1,
  documentRows: readonly unknown[],
): ModelVariantNameSearchArtifactProofV1 | undefined => {
  try {
    return projectModelVariantNameSearchArtifactProofV1({
      staging: expected,
      observation: {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: documentRows as readonly ModelVariantNameSearchStorageRowV1[],
      },
    });
  } catch {
    return undefined;
  }
};

const indexedResourceIds = async (
  database: D1Database,
  publicationId: string,
  matchBytes: readonly number[],
  missBytes: readonly number[],
): Promise<Readonly<{ match: readonly string[]; miss: readonly string[] }>> => {
  const session = database.withSession("first-primary");
  const untrusted = await session.batch([
    session
      .prepare(SELECT_INDEXED_RESOURCE_IDS_SQL)
      .bind(publicationId, bytesToArrayBuffer(matchBytes)),
    session
      .prepare(SELECT_INDEXED_RESOURCE_IDS_SQL)
      .bind(publicationId, bytesToArrayBuffer(missBytes)),
  ]);
  const results = snapshotBatchResults(untrusted, 2);
  const snapshotIds = (result: unknown): readonly string[] => {
    const resultRows = snapshotResultRows(
      result,
      MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS,
    );
    const ids = new Array<string>(resultRows.length);
    for (let index = 0; index < resultRows.length; index += 1) {
      const row = resultRows[index];
      if (!isRecord(row) || !exactKeys(row, ["resource_id"]))
        throw new ModelVariantNameSearchStagingError("integrity_failure");
      const resourceId: unknown = row.resource_id;
      if (typeof resourceId !== "string")
        throw new ModelVariantNameSearchStagingError("integrity_failure");
      ids[index] = resourceId;
    }
    return Object.freeze(ids);
  };
  return Object.freeze({
    match: snapshotIds(results[0]),
    miss: snapshotIds(results[1]),
  });
};

const queryableProof = async (
  database: D1Database,
  expected: ModelVariantNameSearchStagingProjectionV1,
  proof: ModelVariantNameSearchArtifactProofV1,
): Promise<ModelVariantNameSearchQueryableArtifactProofV3> => {
  const persistence = readModelVariantNameSearchStagingPersistenceV1(expected);
  const plan = projectModelVariantNameSearchQueryabilityPlanV3(proof);
  const observed = await indexedResourceIds(
    database,
    persistence.publicationId,
    plan.matchNormalizedNameUtf8,
    plan.missNormalizedNameUtf8,
  );
  try {
    return projectModelVariantNameSearchQueryableArtifactProofV3({
      storageProof: proof,
      queryability: {
        indexName: MODEL_VARIANT_NAME_SEARCH_EXACT_INDEX_NAME,
        matchNormalizedNameUtf8: plan.matchNormalizedNameUtf8,
        matchResourceIds: observed.match,
        missNormalizedNameUtf8: plan.missNormalizedNameUtf8,
        missResourceIds: observed.miss,
      },
    });
  } catch {
    throw new ModelVariantNameSearchStagingError("integrity_failure");
  }
};

const observedRowsOverlapExpected = (
  observedRows: readonly unknown[],
  expectedRows: readonly ModelVariantNameSearchStorageRowV1[],
): boolean | undefined => {
  const expectedKeys = new Set<string>();
  for (const row of expectedRows)
    expectedKeys.add(`${row.resource_type}:${row.resource_id}`);
  let overlaps = false;
  for (const value of observedRows) {
    if (
      !isRecord(value) ||
      !exactKeys(value, [
        "publication_id",
        "resource_type",
        "resource_id",
        "projection_version",
        "display_name_utf8",
        "normalized_name_utf8",
        "resource_content_hash",
      ])
    )
      return undefined;
    const resourceType: unknown = value.resource_type;
    const resourceId: unknown = value.resource_id;
    if (
      (resourceType !== "model" && resourceType !== "variant") ||
      typeof resourceId !== "string"
    )
      return undefined;
    if (expectedKeys.has(`${resourceType}:${resourceId}`)) overlaps = true;
  }
  return overlaps;
};

type Decision =
  | Readonly<{
      outcome: "idempotent_success";
      proof: ModelVariantNameSearchQueryableArtifactProofV3;
    }>
  | Readonly<{
      outcome: "execute" | ModelVariantNameSearchStagingErrorCode;
    }>;

const classify = async (
  database: D1Database,
  expected: ModelVariantNameSearchStagingProjectionV1,
): Promise<Decision> => {
  const persistence = readModelVariantNameSearchStagingPersistenceV1(expected);
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
  expected: ModelVariantNameSearchStagingProjectionV1,
  outcome: ModelVariantNameSearchStagingResultV3["outcome"],
  artifactProof: ModelVariantNameSearchQueryableArtifactProofV3,
): ModelVariantNameSearchStagingResultV3 => {
  const persistence = readModelVariantNameSearchStagingPersistenceV1(expected);
  return Object.freeze({
    outcome,
    publicationId: persistence.publicationId,
    documentCount: persistence.documentCount,
    artifactProof,
  });
};

const throwDecision = (outcome: string): never => {
  throw new ModelVariantNameSearchStagingError(
    outcome as ModelVariantNameSearchStagingErrorCode,
  );
};

/** Fixed pre-seal ADR 0026 model/variant exact-name BLOB writer. */
export const applyModelVariantNameSearchStagingV1 = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ModelVariantNameSearchStagingResultV3> => {
  try {
    assertModelVariantNameSearchStagingProjectionV1(expectedValue);
  } catch {
    throw new ModelVariantNameSearchStagingError("integrity_failure");
  }
  const expected = expectedValue;
  const persistence = readModelVariantNameSearchStagingPersistenceV1(expected);
  let insertPlan: ModelVariantNameSearchInsertPlanV1;
  try {
    insertPlan = planModelVariantNameSearchInsertChunksV1(persistence.rows);
  } catch {
    throw new ModelVariantNameSearchStagingError("integrity_failure");
  }

  let initial: Decision;
  try {
    initial = await classify(database, expected);
  } catch (error) {
    if (error instanceof ModelVariantNameSearchStagingError) throw error;
    throw new ModelVariantNameSearchStagingError("outcome_unknown");
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
          "empty model/variant staging postcondition was not durable",
        );
      const queryable = await queryableProof(database, expected, proof);
      return success(expected, "applied", queryable);
    }
    const reconciled = await classify(database, expected);
    if (reconciled.outcome !== "idempotent_success")
      throw new Error("model/variant staging postcondition was not durable");
    return success(expected, "applied", reconciled.proof);
  } catch {
    let reconciled: Decision;
    try {
      reconciled = await classify(database, expected);
    } catch (error) {
      if (error instanceof ModelVariantNameSearchStagingError) throw error;
      throw new ModelVariantNameSearchStagingError("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success")
      return success(expected, "idempotent_success", reconciled.proof);
    if (reconciled.outcome === "execute")
      throw new ModelVariantNameSearchStagingError("not_applied");
    return throwDecision(reconciled.outcome);
  }
};
