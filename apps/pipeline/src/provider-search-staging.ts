import {
  assertProviderSearchStagingProjectionV2,
  classifyProviderSearchStagingRetryV2,
  readProviderSearchStagingPersistenceV2,
  type ProviderSearchDocumentRowV2,
  type ProviderSearchFtsRowV2,
  type ProviderSearchStagingProjectionV2,
  type PublicationState,
} from "@quant-clarity/publication-core";

const SELECT_PUBLICATION_SQL = `SELECT
  candidate.state,
  candidate.closure_hash,
  revision.revision AS staging_revision,
  CASE WHEN seal.publication_id IS NULL THEN 0 ELSE 1 END AS sealed
FROM publication AS candidate
JOIN publication_staging_revision AS revision USING (publication_id)
LEFT JOIN publication_closure_seal AS seal USING (publication_id)
WHERE candidate.publication_id = ?1`;

const SELECT_DOCUMENTS_SQL = `SELECT
  publication_id, provider_id, projection_version, display_name,
  normalized_name, provider_resource_content_hash
FROM publication_provider_search_document
WHERE publication_id = ?1
ORDER BY provider_id`;

const SELECT_FTS_SQL = `SELECT publication_id, provider_id, display_name
FROM publication_provider_search_fts
WHERE publication_id = ?1
ORDER BY provider_id`;

const ASSERT_EMPTY_BUILDING_SQL = `SELECT CASE WHEN EXISTS (
  SELECT 1 FROM publication AS candidate
  WHERE candidate.publication_id = ?1
    AND candidate.state = 'building'
    AND candidate.closure_hash = ?2
    AND EXISTS (
      SELECT 1 FROM publication_staging_revision
      WHERE publication_id = ?1 AND revision = ?3
    )
    AND (
      SELECT count(*)
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
      WHERE disposition.publication_id = ?1
        AND disposition.provider_slice_id IS NOT NULL
        AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
    ) = ?4
    AND NOT EXISTS (
      SELECT 1 FROM publication_closure_seal WHERE publication_id = ?1
    )
    AND NOT EXISTS (
      SELECT 1 FROM publication_provider_search_document
      WHERE publication_id = ?1
    )
    AND NOT EXISTS (
      SELECT 1 FROM publication_provider_search_fts
      WHERE publication_id = ?1
    )
) THEN 1 ELSE json('') END AS clean`;

const INSERT_DOCUMENTS_SQL = `INSERT INTO publication_provider_search_document (
  publication_id, provider_id, projection_version, display_name,
  normalized_name, provider_resource_content_hash
)
SELECT
  json_extract(payload.value, '$.publication_id'),
  json_extract(payload.value, '$.provider_id'),
  json_extract(payload.value, '$.projection_version'),
  json_extract(payload.value, '$.display_name'),
  json_extract(payload.value, '$.normalized_name'),
  json_extract(payload.value, '$.provider_resource_content_hash')
FROM json_each(?1) AS payload
WHERE payload.type = 'object'
  AND json_type(payload.value, '$.publication_id') = 'text'
  AND json_type(payload.value, '$.provider_id') = 'text'
  AND json_type(payload.value, '$.projection_version') = 'text'
  AND json_type(payload.value, '$.display_name') = 'text'
  AND json_type(payload.value, '$.normalized_name') = 'text'
  AND json_type(payload.value, '$.provider_resource_content_hash') = 'text'
  AND json_extract(payload.value, '$.publication_id') = ?2
  AND EXISTS (
  SELECT 1
  FROM publication AS candidate
  JOIN publication_resource AS resource
    ON resource.publication_id = candidate.publication_id
   AND resource.resource_type = 'provider'
   AND resource.resource_id = json_extract(payload.value, '$.provider_id')
  JOIN publication_provider_attribution AS attribution
    ON attribution.publication_id = candidate.publication_id
   AND attribution.resource_type = 'provider'
   AND attribution.resource_id = json_extract(payload.value, '$.provider_id')
   AND attribution.provider_id = json_extract(payload.value, '$.provider_id')
  JOIN publication_provider_slice AS slice
    ON slice.publication_id = candidate.publication_id
   AND slice.provider_id = json_extract(payload.value, '$.provider_id')
  WHERE candidate.publication_id = ?2
    AND candidate.state = 'building'
    AND candidate.closure_hash = ?3
    AND resource.content_hash = json_extract(
      payload.value,
      '$.provider_resource_content_hash'
    )
    AND slice.provider_slice_id IS NOT NULL
    AND slice.freshness_state IN ('fresh', 'stale')
    AND EXISTS (
      SELECT 1 FROM publication_staging_revision
      WHERE publication_id = ?2 AND revision = ?4
    )
    AND NOT EXISTS (
      SELECT 1 FROM publication_closure_seal WHERE publication_id = ?2
    )
)`;

const ASSERT_POSTCONDITION_SQL = `SELECT CASE WHEN
  (SELECT count(*) FROM publication_provider_search_document
   WHERE publication_id = ?1) = ?4
  AND (SELECT count(*) FROM publication_provider_search_fts
       WHERE publication_id = ?1) = ?4
  AND EXISTS (
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
    WHERE disposition.publication_id = ?1
      AND disposition.provider_slice_id IS NOT NULL
      AND json_extract(resource.resource_json, '$.display_name.state') = 'known'
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_document AS projected
        WHERE projected.publication_id = disposition.publication_id
          AND projected.provider_id = disposition.provider_id
          AND projected.display_name = json_extract(resource.resource_json, '$.display_name.value')
          AND projected.provider_resource_content_hash = resource.content_hash
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM publication_provider_search_document AS projected
    LEFT JOIN publication_resource AS resource
      ON resource.publication_id = projected.publication_id
     AND resource.resource_type = 'provider'
     AND resource.resource_id = projected.provider_id
     AND resource.content_hash = projected.provider_resource_content_hash
    WHERE projected.publication_id = ?1 AND resource.resource_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM publication_provider_search_document AS projected
    WHERE projected.publication_id = ?1
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_fts AS indexed
        WHERE indexed.publication_id = projected.publication_id
          AND indexed.provider_id = projected.provider_id
          AND indexed.display_name = projected.display_name
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM publication_provider_search_fts AS indexed
    WHERE indexed.publication_id = ?1
      AND NOT EXISTS (
        SELECT 1 FROM publication_provider_search_document AS projected
        WHERE projected.publication_id = indexed.publication_id
          AND projected.provider_id = indexed.provider_id
          AND projected.display_name = indexed.display_name
      )
  )
THEN 1 ELSE json('') END AS verified`;

export type ProviderSearchStagingErrorCode =
  | "stale"
  | "conflict"
  | "integrity_failure"
  | "not_applied"
  | "outcome_unknown";

export class ProviderSearchStagingError extends Error {
  readonly code: ProviderSearchStagingErrorCode;
  readonly retrySameProjection: boolean;

  constructor(code: ProviderSearchStagingErrorCode) {
    super("Provider exact-search staging could not be applied safely.");
    this.name = "ProviderSearchStagingError";
    this.code = code;
    this.retrySameProjection = code === "not_applied";
  }
}

export type ProviderSearchStagingResult = Readonly<{
  outcome: "applied" | "idempotent_success";
  publicationId: string;
  documentCount: number;
}>;

// D1 enforces these per-query limits. The complete non-empty writer path uses
// three snapshot queries, one precondition, N inserts, one postcondition, and
// three reconciliation queries. Capping N at 42 therefore also supports the
// 50-query Workers Free ceiling; Paid's 1,000-query D1 ceiling is looser.
export const PROVIDER_SEARCH_D1_MAX_BOUND_BYTES = 2_000_000;
export const PROVIDER_SEARCH_D1_MAX_INSERT_CHUNKS = 42;
export const PROVIDER_SEARCH_D1_MAX_QUERY_COUNT = 50;
export const PROVIDER_SEARCH_D1_MAX_BOUND_PARAMETERS = 100;
export const PROVIDER_SEARCH_D1_INSERT_BOUND_PARAMETERS = 4;
const PROVIDER_SEARCH_D1_FIXED_QUERY_COUNT = 8;
const PROVIDER_SEARCH_MAX_DOCUMENTS = 1_000;
const PROVIDER_SEARCH_D1_SAFE_PAYLOAD_BYTES =
  PROVIDER_SEARCH_D1_MAX_BOUND_BYTES - 1;

export type ProviderSearchInsertPlanV2 = Readonly<{
  payloads: readonly string[];
  payloadByteLengths: readonly number[];
  insertBoundParameterCount: number;
  queryCount: number;
}>;

const utf8 = new TextEncoder();

/**
 * Serializes detached nominal rows into bounded D1 JSON parameters. This is
 * deliberately pure so query and byte ceilings can be proven before D1 opens.
 */
export const planProviderSearchInsertChunksV2 = (
  documents: readonly ProviderSearchDocumentRowV2[],
): ProviderSearchInsertPlanV2 => {
  if (documents.length > PROVIDER_SEARCH_MAX_DOCUMENTS)
    throw new ProviderSearchStagingError("integrity_failure");

  const payloads: string[] = [];
  const payloadByteLengths: number[] = [];
  let serializedRows: string[] = [];
  let payloadBytes = 2;

  const finishChunk = () => {
    if (serializedRows.length === 0) return;
    const payload = `[${serializedRows.join(",")}]`;
    const exactBytes = utf8.encode(payload).byteLength;
    if (
      exactBytes !== payloadBytes ||
      exactBytes > PROVIDER_SEARCH_D1_SAFE_PAYLOAD_BYTES
    )
      throw new ProviderSearchStagingError("integrity_failure");
    payloads.push(payload);
    payloadByteLengths.push(exactBytes);
    serializedRows = [];
    payloadBytes = 2;
  };

  for (const document of documents) {
    const detached = {
      publication_id: document.publication_id,
      provider_id: document.provider_id,
      projection_version: document.projection_version,
      display_name: document.display_name,
      normalized_name: document.normalized_name,
      provider_resource_content_hash: document.provider_resource_content_hash,
    } satisfies ProviderSearchDocumentRowV2;
    const serialized = JSON.stringify(detached);
    const rowBytes = utf8.encode(serialized).byteLength;
    // The JSON object is larger than the corresponding D1 table row because it
    // includes field names and syntax, so this also bounds the inserted row.
    if (rowBytes + 2 > PROVIDER_SEARCH_D1_SAFE_PAYLOAD_BYTES)
      throw new ProviderSearchStagingError("integrity_failure");
    const separatorBytes = serializedRows.length === 0 ? 0 : 1;
    if (
      payloadBytes + separatorBytes + rowBytes >
      PROVIDER_SEARCH_D1_SAFE_PAYLOAD_BYTES
    )
      finishChunk();
    serializedRows.push(serialized);
    payloadBytes += (serializedRows.length === 1 ? 0 : 1) + rowBytes;
  }
  finishChunk();

  const queryCount = PROVIDER_SEARCH_D1_FIXED_QUERY_COUNT + payloads.length;
  if (
    payloads.length > PROVIDER_SEARCH_D1_MAX_INSERT_CHUNKS ||
    queryCount > PROVIDER_SEARCH_D1_MAX_QUERY_COUNT
  )
    throw new ProviderSearchStagingError("integrity_failure");
  return Object.freeze({
    payloads: Object.freeze(payloads),
    payloadByteLengths: Object.freeze(payloadByteLengths),
    insertBoundParameterCount: PROVIDER_SEARCH_D1_INSERT_BOUND_PARAMETERS,
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

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  JSON.stringify(Object.keys(value).sort()) ===
  JSON.stringify([...keys].sort());

const successful = (value: unknown): value is D1Result =>
  isRecord(value) && value.success === true && Array.isArray(value.results);

const documentKeys = [
  "publication_id",
  "provider_id",
  "projection_version",
  "display_name",
  "normalized_name",
  "provider_resource_content_hash",
] as const;
const ftsKeys = ["publication_id", "provider_id", "display_name"] as const;

const rows = <Row extends Readonly<Record<string, unknown>>>(
  result: D1Result,
  keys: readonly (keyof Row & string)[],
  maximum: number,
): readonly Row[] => {
  if (result.results.length > maximum)
    throw new ProviderSearchStagingError("integrity_failure");
  return Object.freeze(
    result.results.map((row) => {
      if (!isRecord(row) || !exactKeys(row, keys))
        throw new ProviderSearchStagingError("integrity_failure");
      return Object.freeze({ ...row }) as Row;
    }),
  );
};

const snapshot = async (
  database: D1Database,
  expected: ProviderSearchStagingProjectionV2,
) => {
  const persistence = readProviderSearchStagingPersistenceV2(expected);
  const session = database.withSession("first-primary");
  const results = await session.batch([
    session.prepare(SELECT_PUBLICATION_SQL).bind(persistence.publicationId),
    session.prepare(SELECT_DOCUMENTS_SQL).bind(persistence.publicationId),
    session.prepare(SELECT_FTS_SQL).bind(persistence.publicationId),
  ]);
  if (results.length !== 3 || results.some((result) => !successful(result)))
    throw new ProviderSearchStagingError("integrity_failure");
  const [publicationResult, documentResult, ftsResult] = results;
  if (
    publicationResult === undefined ||
    documentResult === undefined ||
    ftsResult === undefined
  )
    throw new ProviderSearchStagingError("integrity_failure");
  const publication = publicationResult.results;
  const publicationRow = publication[0];
  if (
    publication.length !== 1 ||
    !isRecord(publicationRow) ||
    !exactKeys(publicationRow, [
      "state",
      "closure_hash",
      "staging_revision",
      "sealed",
    ]) ||
    typeof publicationRow.state !== "string" ||
    !STATES.has(publicationRow.state) ||
    publicationRow.closure_hash !== persistence.closureHash ||
    typeof publicationRow.staging_revision !== "number" ||
    !Number.isSafeInteger(publicationRow.staging_revision) ||
    publicationRow.staging_revision < 0 ||
    (publicationRow.sealed !== 0 && publicationRow.sealed !== 1)
  )
    throw new ProviderSearchStagingError("integrity_failure");
  return Object.freeze({
    publicationState: publicationRow.state as PublicationState,
    sealed: publicationRow.sealed === 1,
    stagingRevision: publicationRow.staging_revision,
    documents: rows<ProviderSearchDocumentRowV2>(
      documentResult,
      documentKeys,
      1_000,
    ),
    ftsRows: rows<ProviderSearchFtsRowV2>(ftsResult, ftsKeys, 1_000),
  });
};

const classify = async (
  database: D1Database,
  expected: ProviderSearchStagingProjectionV2,
) =>
  classifyProviderSearchStagingRetryV2({
    expected,
    ...(await snapshot(database, expected)),
  });

const success = (
  expected: ProviderSearchStagingProjectionV2,
  outcome: ProviderSearchStagingResult["outcome"],
): ProviderSearchStagingResult => {
  const persistence = readProviderSearchStagingPersistenceV2(expected);
  return Object.freeze({
    outcome,
    publicationId: persistence.publicationId,
    documentCount: persistence.documents.length,
  });
};

const throwDecision = (outcome: string): never => {
  throw new ProviderSearchStagingError(
    outcome as ProviderSearchStagingErrorCode,
  );
};

/** Fixed, pre-seal ADR 0021 provider projection writer. */
export const applyProviderSearchStagingV2 = async (
  database: D1Database,
  expectedValue: unknown,
): Promise<ProviderSearchStagingResult> => {
  try {
    assertProviderSearchStagingProjectionV2(expectedValue);
  } catch {
    throw new ProviderSearchStagingError("integrity_failure");
  }
  const expected = expectedValue;
  const persistence = readProviderSearchStagingPersistenceV2(expected);
  let insertPlan: ProviderSearchInsertPlanV2;
  try {
    insertPlan = planProviderSearchInsertChunksV2(persistence.documents);
  } catch {
    throw new ProviderSearchStagingError("integrity_failure");
  }
  let initial;
  try {
    initial = await classify(database, expected);
  } catch (error) {
    if (error instanceof ProviderSearchStagingError) throw error;
    throw new ProviderSearchStagingError("outcome_unknown");
  }
  if (initial.outcome === "idempotent_success")
    return success(expected, "idempotent_success");
  if (initial.outcome !== "execute") return throwDecision(initial.outcome);
  try {
    const session = database.withSession("first-primary");
    const results = await session.batch([
      session
        .prepare(ASSERT_EMPTY_BUILDING_SQL)
        .bind(
          persistence.publicationId,
          persistence.closureHash,
          persistence.stagingRevision,
          persistence.documents.length,
        ),
      ...insertPlan.payloads.map((payload) =>
        session
          .prepare(INSERT_DOCUMENTS_SQL)
          .bind(
            payload,
            persistence.publicationId,
            persistence.closureHash,
            persistence.stagingRevision,
          ),
      ),
      session
        .prepare(ASSERT_POSTCONDITION_SQL)
        .bind(
          persistence.publicationId,
          persistence.closureHash,
          persistence.stagingRevision,
          persistence.documents.length,
        ),
    ]);
    if (
      results.length !== insertPlan.payloads.length + 2 ||
      results.some((result) => !successful(result))
    )
      throw new Error("ambiguous D1 batch result");
    const verified = results.at(-1)?.results[0];
    if (!isRecord(verified) || verified.verified !== 1)
      throw new Error("ambiguous D1 postcondition result");
    // An honestly empty projection has no durable row that can serve as a
    // completion marker. The fixed SQL assertion above is the operation.
    if (persistence.documents.length === 0) return success(expected, "applied");
    const reconciled = await classify(database, expected);
    if (reconciled.outcome !== "idempotent_success")
      throw new Error("provider staging postcondition was not durable");
    return success(expected, "applied");
  } catch {
    let reconciled;
    try {
      reconciled = await classify(database, expected);
    } catch (error) {
      if (error instanceof ProviderSearchStagingError) throw error;
      throw new ProviderSearchStagingError("outcome_unknown");
    }
    if (reconciled.outcome === "idempotent_success")
      return success(expected, "idempotent_success");
    if (reconciled.outcome === "execute")
      throw new ProviderSearchStagingError("not_applied");
    return throwDecision(reconciled.outcome);
  }
};
