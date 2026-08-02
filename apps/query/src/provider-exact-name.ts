import {
  checkProviderContract,
  PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS,
  type Provider,
} from "@quant-clarity/contracts";
import {
  hashPublicationResourceContent,
  normalizeExactSearchName,
  PUBLICATION_RESOURCE_JSON_MAX_BYTES,
  PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS,
  PROVIDER_SEARCH_PROJECTION_VERSION,
} from "@quant-clarity/publication-core";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const PROVIDER_ID = new RegExp(`^prv_${UUID_V4}$`, "u");
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const utf8 = new TextEncoder();

export const PROVIDER_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS =
  PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS;
export const PROVIDER_EXACT_NAME_MAX_QUERY_BYTES = 800;
export const PROVIDER_EXACT_NAME_MAX_PAGE_SIZE = 20;
export const PROVIDER_EXACT_NAME_MAX_RESOURCE_BYTES =
  PUBLICATION_RESOURCE_JSON_MAX_BYTES;
export const PROVIDER_EXACT_NAME_MAX_TRANSFER_BYTES =
  (PROVIDER_EXACT_NAME_MAX_PAGE_SIZE + 1) *
  PROVIDER_EXACT_NAME_MAX_RESOURCE_BYTES;

/**
 * One fixed SELECT-only statement. Exact classification never invokes FTS5,
 * and visitor input is bound rather than interpreted as SQL or MATCH syntax.
 */
export const PROVIDER_EXACT_NAME_SELECT_SQL = `
WITH eligible_publication AS (
  SELECT publication.publication_id
  FROM publication_head AS head
  JOIN publication AS publication
    ON publication.publication_id = ?1
  WHERE head.singleton = 1
    AND (
      (
        head.active_publication_id = publication.publication_id
        AND publication.state = 'active'
      )
      OR (
        publication.state = 'superseded'
      )
      OR (
        head.rollback_candidate_publication_id = publication.publication_id
        AND publication.state = 'rolled_back'
      )
    )
), candidate_page AS (
  SELECT
    document.publication_id,
    document.provider_id,
    document.projection_version,
    document.display_name,
    document.normalized_name,
    document.provider_resource_content_hash,
    resource.content_hash AS resource_content_hash,
    length(CAST(resource.resource_json AS BLOB)) AS resource_json_bytes,
    CASE
      WHEN length(CAST(resource.resource_json AS BLOB)) <= ?4
      THEN resource.resource_json
      ELSE NULL
    END AS resource_json
  FROM eligible_publication AS eligible
  JOIN publication_provider_search_document AS document
    ON document.publication_id = eligible.publication_id
  JOIN publication_resource AS resource
    ON resource.publication_id = document.publication_id
   AND resource.resource_type = 'provider'
   AND resource.resource_id = document.provider_id
  WHERE document.normalized_name = ?2
    AND document.provider_id > ?3
    AND json_extract(resource.resource_json, '$.status.state') = 'known'
    AND json_extract(resource.resource_json, '$.status.value') = 'active'
  ORDER BY document.provider_id ASC
  LIMIT ?5
)
SELECT
  0 AS row_ordinal,
  'hot_publication' AS row_kind,
  eligible.publication_id,
  NULL AS provider_id,
  NULL AS projection_version,
  NULL AS display_name,
  NULL AS normalized_name,
  NULL AS provider_resource_content_hash,
  NULL AS resource_content_hash,
  0 AS resource_json_bytes,
  NULL AS resource_json
FROM eligible_publication AS eligible
UNION ALL
SELECT
  1 AS row_ordinal,
  'candidate' AS row_kind,
  candidate.publication_id,
  candidate.provider_id,
  candidate.projection_version,
  candidate.display_name,
  candidate.normalized_name,
  candidate.provider_resource_content_hash,
  candidate.resource_content_hash,
  candidate.resource_json_bytes,
  candidate.resource_json
FROM candidate_page AS candidate
ORDER BY row_ordinal ASC, provider_id ASC
`;

export type ProviderExactNameInput = Readonly<{
  publicationId: string;
  query: string;
  afterProviderId?: string | null;
  limit?: number;
}>;

export type ProviderExactNameResult = Readonly<{
  tier: 3;
  resourceType: "provider";
  resourceId: string;
  matchKind: "provider_name";
  displayName: Readonly<
    Omit<
      Extract<Provider["display_name"], { state: "known" }>,
      "evidence_ids"
    > & { evidence_ids: readonly string[] }
  >;
  semanticDegraded: "disabled";
  normalizedOrderingKey: string;
}>;

export type ProviderExactNamePage = Readonly<{
  publicationId: string;
  results: readonly ProviderExactNameResult[];
  nextAfterProviderId: string | null;
}>;

export type ProviderExactNameErrorCode =
  "invalid_input" | "integrity_failure" | "read_failure";

export class ProviderExactNameError extends Error {
  readonly code: ProviderExactNameErrorCode;

  constructor(code: ProviderExactNameErrorCode) {
    super(
      code === "invalid_input"
        ? "The provider-name query is invalid."
        : code === "integrity_failure"
          ? "Published provider data failed integrity verification."
          : "Published provider data could not be read.",
    );
    this.name = "ProviderExactNameError";
    this.code = code;
  }
}

type ProviderExactNameRow = Readonly<{
  row_ordinal: 1;
  row_kind: "candidate";
  publication_id: string;
  provider_id: string;
  projection_version: typeof PROVIDER_SEARCH_PROJECTION_VERSION;
  display_name: string;
  normalized_name: string;
  provider_resource_content_hash: string;
  resource_content_hash: string;
  resource_json_bytes: number;
  resource_json: string | null;
}>;

const invalidInput = (): never => {
  throw new ProviderExactNameError("invalid_input");
};

const validateInput = (
  inputValue: unknown,
): Readonly<{
  publicationId: string;
  normalizedQuery: string;
  afterProviderId: string;
  limit: number;
}> => {
  const allowedKeys = new Set([
    "publicationId",
    "query",
    "afterProviderId",
    "limit",
  ]);
  if (
    typeof inputValue !== "object" ||
    inputValue === null ||
    Array.isArray(inputValue)
  )
    return invalidInput();
  const input = inputValue as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !allowedKeys.has(key)) ||
    typeof input.publicationId !== "string" ||
    !PUBLICATION_ID.test(input.publicationId) ||
    typeof input.query !== "string" ||
    Array.from(input.query).length >
      PROVIDER_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS ||
    utf8.encode(input.query).length > PROVIDER_EXACT_NAME_MAX_QUERY_BYTES
  )
    return invalidInput();

  const afterValue = input.afterProviderId;
  if (
    afterValue !== undefined &&
    afterValue !== null &&
    typeof afterValue !== "string"
  )
    return invalidInput();
  const afterProviderId = afterValue ?? "";
  if (afterProviderId !== "" && !PROVIDER_ID.test(afterProviderId))
    return invalidInput();
  const limitValue = input.limit;
  if (limitValue !== undefined && typeof limitValue !== "number")
    return invalidInput();
  const limit = limitValue ?? PROVIDER_EXACT_NAME_MAX_PAGE_SIZE;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > PROVIDER_EXACT_NAME_MAX_PAGE_SIZE
  )
    return invalidInput();

  let normalizedQuery: string;
  try {
    normalizedQuery = normalizeExactSearchName(input.query);
  } catch {
    return invalidInput();
  }
  if (
    Array.from(normalizedQuery).length >
    PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS
  )
    return invalidInput();

  return {
    publicationId: input.publicationId,
    normalizedQuery,
    afterProviderId,
    limit,
  };
};

const isExactRow = (value: unknown): value is ProviderExactNameRow => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).length === 11 &&
    row.row_ordinal === 1 &&
    row.row_kind === "candidate" &&
    typeof row.publication_id === "string" &&
    PUBLICATION_ID.test(row.publication_id) &&
    typeof row.provider_id === "string" &&
    PROVIDER_ID.test(row.provider_id) &&
    row.projection_version === PROVIDER_SEARCH_PROJECTION_VERSION &&
    typeof row.display_name === "string" &&
    typeof row.normalized_name === "string" &&
    typeof row.provider_resource_content_hash === "string" &&
    SHA256.test(row.provider_resource_content_hash) &&
    typeof row.resource_content_hash === "string" &&
    SHA256.test(row.resource_content_hash) &&
    typeof row.resource_json_bytes === "number" &&
    Number.isSafeInteger(row.resource_json_bytes) &&
    row.resource_json_bytes >= 0 &&
    (typeof row.resource_json === "string" || row.resource_json === null)
  );
};

const isHotPublicationSentinel = (
  value: unknown,
  publicationId: string,
): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const row = value as Record<string, unknown>;
  return (
    Object.keys(row).length === 11 &&
    row.row_ordinal === 0 &&
    row.row_kind === "hot_publication" &&
    row.publication_id === publicationId &&
    row.provider_id === null &&
    row.projection_version === null &&
    row.display_name === null &&
    row.normalized_name === null &&
    row.provider_resource_content_hash === null &&
    row.resource_content_hash === null &&
    row.resource_json_bytes === 0 &&
    row.resource_json === null
  );
};

const successfulD1Rows = (value: unknown): unknown[] | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const result = value as Record<string, unknown>;
  return result.success === true && Array.isArray(result.results)
    ? result.results
    : null;
};

const rehydrate = async (
  rowValue: unknown,
  normalizedQuery: string,
): Promise<ProviderExactNameResult> => {
  if (!isExactRow(rowValue))
    throw new ProviderExactNameError("integrity_failure");
  const row = rowValue;
  if (
    row.resource_json === null ||
    row.resource_json_bytes > PROVIDER_EXACT_NAME_MAX_RESOURCE_BYTES ||
    utf8.encode(row.resource_json).length !== row.resource_json_bytes ||
    row.provider_resource_content_hash !== row.resource_content_hash ||
    row.normalized_name !== normalizedQuery
  )
    throw new ProviderExactNameError("integrity_failure");

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.resource_json) as unknown;
  } catch {
    throw new ProviderExactNameError("integrity_failure");
  }
  if (
    !checkProviderContract(parsed) ||
    parsed.provider_id !== row.provider_id ||
    parsed.display_name.state !== "known" ||
    parsed.display_name.value !== row.display_name ||
    parsed.status.state !== "known" ||
    parsed.status.value !== "active"
  )
    throw new ProviderExactNameError("integrity_failure");

  let normalizedDisplayName: string;
  let computedHash: string;
  try {
    normalizedDisplayName = normalizeExactSearchName(parsed.display_name.value);
    computedHash = await hashPublicationResourceContent({
      resourceType: "provider",
      resourceId: parsed.provider_id,
      resourceJson: row.resource_json,
    });
  } catch {
    throw new ProviderExactNameError("integrity_failure");
  }
  if (
    normalizedDisplayName !== row.normalized_name ||
    computedHash !== row.resource_content_hash
  )
    throw new ProviderExactNameError("integrity_failure");

  return {
    tier: 3,
    resourceType: "provider",
    resourceId: parsed.provider_id,
    matchKind: "provider_name",
    displayName: Object.freeze({
      ...parsed.display_name,
      evidence_ids: Object.freeze([...parsed.display_name.evidence_ids]),
    }),
    semanticDegraded: "disabled",
    normalizedOrderingKey: row.normalized_name,
  };
};

export const readProviderExactNamePage = async (
  database: D1Database,
  input: ProviderExactNameInput,
): Promise<ProviderExactNamePage> => {
  const validated = validateInput(input);
  let rowValues: unknown[];
  try {
    const result: unknown = await database
      .prepare(PROVIDER_EXACT_NAME_SELECT_SQL)
      .bind(
        validated.publicationId,
        validated.normalizedQuery,
        validated.afterProviderId,
        PROVIDER_EXACT_NAME_MAX_RESOURCE_BYTES,
        validated.limit + 1,
      )
      .all<ProviderExactNameRow>();
    const results = successfulD1Rows(result);
    if (results === null) throw new ProviderExactNameError("read_failure");
    rowValues = results;
  } catch (error) {
    if (error instanceof ProviderExactNameError) throw error;
    throw new ProviderExactNameError("read_failure");
  }
  if (rowValues.length > validated.limit + 2)
    throw new ProviderExactNameError("integrity_failure");

  const sentinels = rowValues.filter(
    (row) =>
      typeof row === "object" &&
      row !== null &&
      !Array.isArray(row) &&
      (row as Record<string, unknown>).row_kind === "hot_publication",
  );
  if (
    sentinels.length !== 1 ||
    !isHotPublicationSentinel(sentinels[0], validated.publicationId)
  )
    throw new ProviderExactNameError("integrity_failure");
  const candidateRows = rowValues.filter((row) => row !== sentinels[0]);
  if (candidateRows.length > validated.limit + 1)
    throw new ProviderExactNameError("integrity_failure");
  let transferredBytes = 0;
  let priorProviderId = validated.afterProviderId;
  for (const row of candidateRows) {
    if (!isExactRow(row)) throw new ProviderExactNameError("integrity_failure");
    if (
      row.publication_id !== validated.publicationId ||
      row.provider_id <= priorProviderId
    )
      throw new ProviderExactNameError("integrity_failure");
    priorProviderId = row.provider_id;
    if (typeof row.resource_json === "string")
      transferredBytes += utf8.encode(row.resource_json).length;
  }
  if (transferredBytes > PROVIDER_EXACT_NAME_MAX_TRANSFER_BYTES)
    throw new ProviderExactNameError("integrity_failure");
  const hydrated: ProviderExactNameResult[] = [];
  for (const row of candidateRows)
    hydrated.push(await rehydrate(row, validated.normalizedQuery));
  const results = Object.freeze(
    hydrated.slice(0, validated.limit).map((result) => Object.freeze(result)),
  );
  const nextAfterProviderId =
    candidateRows.length > validated.limit
      ? (results.at(-1)?.resourceId ?? null)
      : null;
  return Object.freeze({
    publicationId: validated.publicationId,
    results,
    nextAfterProviderId,
  });
};
