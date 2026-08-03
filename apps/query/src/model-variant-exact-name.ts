import {
  checkModelContract,
  checkVariantContract,
  MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS,
  type Model,
  type Variant,
} from "@quant-clarity/contracts";
import {
  hashPublicationResourceContent,
  MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UNICODE_SCALARS,
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCE_BYTES,
  MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION,
  normalizeExactSearchName,
} from "@quant-clarity/publication-core";

import {
  RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS,
  RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS,
  RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS,
  RETAINED_HOT_PUBLICATION_WINDOW_MS,
  RETAINED_HOT_REFERENCE_CTE_SQL,
  validRequiredAvailableUntilMs,
} from "./retained-hot-publication.js";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const VARIANT_ID = new RegExp(`^var_${UUID_V4}$`, "u");
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const utf8 = new TextEncoder();

export const MODEL_VARIANT_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS =
  MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS;
export const MODEL_VARIANT_EXACT_NAME_MAX_QUERY_BYTES =
  MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES;
export const MODEL_VARIANT_EXACT_NAME_MAX_PAGE_SIZE = 20;
export const MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES =
  MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCE_BYTES;
export const MODEL_VARIANT_EXACT_NAME_MAX_TRANSFER_BYTES =
  (MODEL_VARIANT_EXACT_NAME_MAX_PAGE_SIZE + 1) *
  MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES;

/**
 * One fixed SELECT-only statement. The equality lookup binds normalized UTF-8
 * as a BLOB and names the immutable exact index. Projection bytes never cross
 * the D1 boundary: the display-byte comparison is returned only as a boolean.
 */
export const MODEL_VARIANT_EXACT_NAME_SELECT_SQL = `
WITH ${RETAINED_HOT_REFERENCE_CTE_SQL}, eligible_publication AS (
  SELECT publication.publication_id
  FROM publication_head AS head
  JOIN publication AS publication
    ON publication.publication_id = ?1
  CROSS JOIN retained_reference AS retained
  WHERE head.singleton = 1
    AND (
      ?7 IS NULL OR (
        ?7 > CAST(strftime('%s', 'now') AS INTEGER) * 1000 -
          ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)}
        AND ?7 <= CAST(strftime('%s', 'now') AS INTEGER) * 1000 +
          ${String(RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS)}
      )
    )
    AND (
      (
        head.active_publication_id = publication.publication_id
        AND publication.state = 'active'
      )
      OR (
        head.rollback_candidate_publication_id = publication.publication_id
        AND publication.state IN ('superseded', 'rolled_back')
      )
      OR (
        ?7 IS NOT NULL
        AND publication.state IN ('superseded', 'rolled_back')
        AND retained.latest_head_reference_ms BETWEEN 0 AND
          CAST(strftime('%s', 'now') AS INTEGER) * 1000 +
            ${String(RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS)}
        AND retained.latest_head_reference_ms >
          ?7 + ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)} -
            ${String(RETAINED_HOT_PUBLICATION_WINDOW_MS)}
      )
    )
), candidate_page AS (
  SELECT
    document.publication_id,
    document.resource_type,
    document.resource_id,
    document.projection_version,
    document.resource_content_hash AS projection_resource_content_hash,
    resource.content_hash AS resource_content_hash,
    CASE
      WHEN typeof(json_extract(resource.resource_json, '$.display_name.value')) = 'text'
        AND document.display_name_utf8 = CAST(
          json_extract(resource.resource_json, '$.display_name.value') AS BLOB
        )
      THEN 1
      ELSE 0
    END AS display_name_bytes_match,
    length(CAST(resource.resource_json AS BLOB)) AS resource_json_bytes,
    CASE
      WHEN length(CAST(resource.resource_json AS BLOB)) <= ?5
      THEN resource.resource_json
      ELSE NULL
    END AS resource_json
  FROM eligible_publication AS eligible
  JOIN publication_model_variant_name_search_document AS document
    INDEXED BY publication_model_variant_name_exact_idx
    ON document.publication_id = eligible.publication_id
  JOIN publication_resource AS resource
    ON resource.publication_id = document.publication_id
   AND resource.resource_type = document.resource_type
   AND resource.resource_id = document.resource_id
  WHERE document.normalized_name_utf8 = ?2
    AND (?3 IS NULL OR document.resource_type = ?3)
    AND document.resource_id > ?4
    AND json_extract(resource.resource_json, '$.status.state') = 'known'
    AND json_extract(resource.resource_json, '$.status.value') = 'active'
  ORDER BY document.resource_id ASC
  LIMIT ?6
)
SELECT
  0 AS row_ordinal,
  'hot_publication' AS row_kind,
  eligible.publication_id,
  NULL AS resource_type,
  NULL AS resource_id,
  NULL AS projection_version,
  NULL AS projection_resource_content_hash,
  NULL AS resource_content_hash,
  NULL AS display_name_bytes_match,
  0 AS resource_json_bytes,
  NULL AS resource_json
FROM eligible_publication AS eligible
UNION ALL
SELECT
  1 AS row_ordinal,
  'candidate' AS row_kind,
  candidate.publication_id,
  candidate.resource_type,
  candidate.resource_id,
  candidate.projection_version,
  candidate.projection_resource_content_hash,
  candidate.resource_content_hash,
  candidate.display_name_bytes_match,
  candidate.resource_json_bytes,
  candidate.resource_json
FROM candidate_page AS candidate
ORDER BY row_ordinal ASC, resource_id ASC
`;

export type ModelVariantExactNameInput = Readonly<{
  publicationId: string;
  query: string;
  recordType: "model" | "variant" | null;
  afterResourceId: string | null;
  limit: number;
  requiredAvailableUntilMs?: number | null;
}>;

export type ModelVariantExactNameDatabase = Pick<D1DatabaseSession, "prepare">;

type KnownDisplayName = Readonly<
  Omit<Extract<Model["display_name"], { state: "known" }>, "evidence_ids"> & {
    evidence_ids: readonly string[];
  }
>;

export type ModelVariantExactNameResult = Readonly<{
  tier: 1;
  resourceType: "model" | "variant";
  resourceId: string;
  matchKind: "canonical_name";
  displayName: KnownDisplayName;
  semanticDegraded: "disabled";
}>;

export type ModelVariantExactNamePage = Readonly<{
  publicationId: string;
  results: readonly ModelVariantExactNameResult[];
  nextAfterResourceId: string | null;
}>;

export type ModelVariantExactNameErrorCode =
  "invalid_input" | "integrity_failure" | "read_failure";

export class ModelVariantExactNameError extends Error {
  readonly code: ModelVariantExactNameErrorCode;

  constructor(code: ModelVariantExactNameErrorCode) {
    super(
      code === "invalid_input"
        ? "The model-name query is invalid."
        : code === "integrity_failure"
          ? "Published model data failed integrity verification."
          : "Published model data could not be read.",
    );
    this.name = "ModelVariantExactNameError";
    this.code = code;
  }
}

type ModelVariantExactNameRow = Readonly<{
  row_ordinal: 1;
  row_kind: "candidate";
  publication_id: string;
  resource_type: "model" | "variant";
  resource_id: string;
  projection_version: typeof MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION;
  projection_resource_content_hash: string;
  resource_content_hash: string;
  display_name_bytes_match: 1;
  resource_json_bytes: number;
  resource_json: string | null;
}>;

const invalidInput = (): never => {
  throw new ModelVariantExactNameError("invalid_input");
};

const plainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    expected.every((key, index) => keys[index] === key)
  );
};

const snapshotRecord = (value: unknown): Record<string, unknown> | null => {
  try {
    if (!plainRecord(value)) return null;
    const keys = Object.keys(value);
    const snapshot: Record<string, unknown> = {};
    for (const key of keys) snapshot[key] = value[key];
    return snapshot;
  } catch {
    return null;
  }
};

const validResourceId = (value: string): boolean =>
  MODEL_ID.test(value) || VARIANT_ID.test(value);

const containsInvalidUnicodeScalar = (value: string): boolean =>
  Array.from(value).some((scalar) => {
    const point = scalar.codePointAt(0);
    return point !== undefined && point >= 0xd800 && point <= 0xdfff;
  });

const validateInput = (
  inputValue: unknown,
): Readonly<{
  publicationId: string;
  normalizedQuery: string;
  normalizedQueryBytes: ArrayBuffer;
  recordType: "model" | "variant" | null;
  afterResourceId: string;
  limit: number;
  requiredAvailableUntilMs: number | null;
}> => {
  const input = snapshotRecord(inputValue);
  if (input === null) return invalidInput();
  const expectedKeys = [
    "afterResourceId",
    "limit",
    "publicationId",
    "query",
    "recordType",
  ];
  if (Object.hasOwn(input, "requiredAvailableUntilMs"))
    expectedKeys.push("requiredAvailableUntilMs");
  if (
    !exactKeys(input, expectedKeys) ||
    typeof input.publicationId !== "string" ||
    !PUBLICATION_ID.test(input.publicationId) ||
    typeof input.query !== "string" ||
    input.query.length >
      MODEL_VARIANT_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS * 2 ||
    containsInvalidUnicodeScalar(input.query) ||
    Array.from(input.query).length >
      MODEL_VARIANT_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS ||
    utf8.encode(input.query).byteLength >
      MODEL_VARIANT_EXACT_NAME_MAX_QUERY_BYTES
  )
    return invalidInput();

  const requiredAvailableUntilMs = Object.hasOwn(
    input,
    "requiredAvailableUntilMs",
  )
    ? input.requiredAvailableUntilMs
    : null;
  if (!validRequiredAvailableUntilMs(requiredAvailableUntilMs))
    return invalidInput();

  const recordType = input.recordType;
  if (recordType !== null && recordType !== "model" && recordType !== "variant")
    return invalidInput();

  const afterValue = input.afterResourceId;
  if (afterValue !== null && typeof afterValue !== "string")
    return invalidInput();
  const afterResourceId = afterValue ?? "";
  if (
    (afterResourceId !== "" && !validResourceId(afterResourceId)) ||
    (recordType === "model" &&
      afterResourceId !== "" &&
      !MODEL_ID.test(afterResourceId)) ||
    (recordType === "variant" &&
      afterResourceId !== "" &&
      !VARIANT_ID.test(afterResourceId))
  )
    return invalidInput();

  const limitValue = input.limit;
  if (
    typeof limitValue !== "number" ||
    !Number.isSafeInteger(limitValue) ||
    limitValue < 1 ||
    limitValue > MODEL_VARIANT_EXACT_NAME_MAX_PAGE_SIZE
  )
    return invalidInput();

  let normalizedQuery: string;
  try {
    normalizedQuery = normalizeExactSearchName(input.query);
  } catch {
    return invalidInput();
  }
  const normalizedQueryView = utf8.encode(normalizedQuery);
  if (
    Array.from(normalizedQuery).length >
      MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UNICODE_SCALARS ||
    normalizedQueryView.byteLength === 0 ||
    normalizedQueryView.byteLength >
      MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES
  )
    return invalidInput();
  const normalizedQueryBytes = normalizedQueryView.buffer.slice(
    normalizedQueryView.byteOffset,
    normalizedQueryView.byteOffset + normalizedQueryView.byteLength,
  ) as ArrayBuffer;

  return {
    publicationId: input.publicationId,
    normalizedQuery,
    normalizedQueryBytes,
    recordType,
    afterResourceId,
    limit: limitValue,
    requiredAvailableUntilMs,
  };
};

const snapshotD1Rows = (value: unknown, maximum: number): unknown[] | null => {
  const result = snapshotRecord(value);
  if (result?.success !== true || !Array.isArray(result.results)) return null;
  const resultValues = result.results as unknown[];
  const count = resultValues.length;
  if (!Number.isSafeInteger(count) || count < 0 || count > maximum)
    throw new ModelVariantExactNameError("integrity_failure");
  const rows = new Array<unknown>(count);
  for (let index = 0; index < count; index += 1) {
    const valueAtIndex = resultValues[index];
    rows[index] = snapshotRecord(valueAtIndex) ?? valueAtIndex;
  }
  return rows;
};

const snapshotExactRow = (value: unknown): ModelVariantExactNameRow | null => {
  const row = snapshotRecord(value);
  if (
    row === null ||
    !exactKeys(row, [
      "display_name_bytes_match",
      "projection_resource_content_hash",
      "projection_version",
      "publication_id",
      "resource_content_hash",
      "resource_id",
      "resource_json",
      "resource_json_bytes",
      "resource_type",
      "row_kind",
      "row_ordinal",
    ]) ||
    row.row_ordinal !== 1 ||
    row.row_kind !== "candidate" ||
    typeof row.publication_id !== "string" ||
    !PUBLICATION_ID.test(row.publication_id) ||
    (row.resource_type !== "model" && row.resource_type !== "variant") ||
    typeof row.resource_id !== "string" ||
    !validResourceId(row.resource_id) ||
    (row.resource_type === "model"
      ? !MODEL_ID.test(row.resource_id)
      : !VARIANT_ID.test(row.resource_id)) ||
    row.projection_version !== MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION ||
    typeof row.projection_resource_content_hash !== "string" ||
    !SHA256.test(row.projection_resource_content_hash) ||
    typeof row.resource_content_hash !== "string" ||
    !SHA256.test(row.resource_content_hash) ||
    row.display_name_bytes_match !== 1 ||
    typeof row.resource_json_bytes !== "number" ||
    !Number.isSafeInteger(row.resource_json_bytes) ||
    row.resource_json_bytes < 0 ||
    (typeof row.resource_json !== "string" && row.resource_json !== null)
  )
    return null;
  return row as ModelVariantExactNameRow;
};

const isHotPublicationSentinel = (
  value: unknown,
  publicationId: string,
): boolean => {
  const row = snapshotRecord(value);
  return (
    row !== null &&
    exactKeys(row, [
      "display_name_bytes_match",
      "projection_resource_content_hash",
      "projection_version",
      "publication_id",
      "resource_content_hash",
      "resource_id",
      "resource_json",
      "resource_json_bytes",
      "resource_type",
      "row_kind",
      "row_ordinal",
    ]) &&
    row.row_ordinal === 0 &&
    row.row_kind === "hot_publication" &&
    row.publication_id === publicationId &&
    row.resource_type === null &&
    row.resource_id === null &&
    row.projection_version === null &&
    row.projection_resource_content_hash === null &&
    row.resource_content_hash === null &&
    row.display_name_bytes_match === null &&
    row.resource_json_bytes === 0 &&
    row.resource_json === null
  );
};

const rehydrate = async (
  row: ModelVariantExactNameRow,
  normalizedQuery: string,
): Promise<ModelVariantExactNameResult> => {
  if (
    row.resource_json === null ||
    row.resource_json_bytes > MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES ||
    utf8.encode(row.resource_json).byteLength !== row.resource_json_bytes ||
    row.projection_resource_content_hash !== row.resource_content_hash
  )
    throw new ModelVariantExactNameError("integrity_failure");

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.resource_json) as unknown;
  } catch {
    throw new ModelVariantExactNameError("integrity_failure");
  }
  const validContract =
    row.resource_type === "model"
      ? checkModelContract(parsed)
      : checkVariantContract(parsed);
  if (!validContract) throw new ModelVariantExactNameError("integrity_failure");
  const canonical = parsed as Model | Variant;
  const canonicalId =
    row.resource_type === "model"
      ? (canonical as Model).model_id
      : (canonical as Variant).variant_id;
  if (
    canonicalId !== row.resource_id ||
    canonical.display_name.state !== "known" ||
    canonical.status.state !== "known" ||
    canonical.status.value !== "active"
  )
    throw new ModelVariantExactNameError("integrity_failure");

  let normalizedDisplayName: string;
  let computedHash: string;
  try {
    normalizedDisplayName = normalizeExactSearchName(
      canonical.display_name.value,
    );
    computedHash = await hashPublicationResourceContent({
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      resourceJson: row.resource_json,
    });
  } catch {
    throw new ModelVariantExactNameError("integrity_failure");
  }
  if (
    normalizedDisplayName !== normalizedQuery ||
    computedHash !== row.resource_content_hash
  )
    throw new ModelVariantExactNameError("integrity_failure");

  return Object.freeze({
    tier: 1,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    matchKind: "canonical_name",
    displayName: Object.freeze({
      ...canonical.display_name,
      evidence_ids: Object.freeze([...canonical.display_name.evidence_ids]),
    }),
    semanticDegraded: "disabled",
  });
};

export const readModelVariantExactNamePage = async (
  database: ModelVariantExactNameDatabase,
  input: ModelVariantExactNameInput,
): Promise<ModelVariantExactNamePage> => {
  const validated = validateInput(input);
  let rowValues: unknown[];
  try {
    const result: unknown = await database
      .prepare(MODEL_VARIANT_EXACT_NAME_SELECT_SQL)
      .bind(
        validated.publicationId,
        validated.normalizedQueryBytes,
        validated.recordType,
        validated.afterResourceId,
        MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES,
        validated.limit + 1,
        validated.requiredAvailableUntilMs,
      )
      .all<ModelVariantExactNameRow>();
    const rows = snapshotD1Rows(result, validated.limit + 2);
    if (rows === null) throw new ModelVariantExactNameError("read_failure");
    rowValues = rows;
  } catch (error) {
    if (error instanceof ModelVariantExactNameError) throw error;
    throw new ModelVariantExactNameError("read_failure");
  }

  let sentinel: unknown = null;
  let sentinelCount = 0;
  const candidateValues: unknown[] = [];
  for (const value of rowValues) {
    const row = snapshotRecord(value);
    if (row?.row_kind === "hot_publication") {
      sentinel = value;
      sentinelCount += 1;
    } else {
      candidateValues.push(value);
    }
  }
  if (
    sentinelCount !== 1 ||
    !isHotPublicationSentinel(sentinel, validated.publicationId) ||
    candidateValues.length > validated.limit + 1
  )
    throw new ModelVariantExactNameError("integrity_failure");

  const candidateRows: ModelVariantExactNameRow[] = [];
  let transferredBytes = 0;
  let priorResourceId = validated.afterResourceId;
  for (const value of candidateValues) {
    const row = snapshotExactRow(value);
    if (
      row?.publication_id !== validated.publicationId ||
      (validated.recordType !== null &&
        row.resource_type !== validated.recordType) ||
      row.resource_id <= priorResourceId
    )
      throw new ModelVariantExactNameError("integrity_failure");
    priorResourceId = row.resource_id;
    if (typeof row.resource_json === "string")
      transferredBytes += utf8.encode(row.resource_json).byteLength;
    candidateRows.push(row);
  }
  if (transferredBytes > MODEL_VARIANT_EXACT_NAME_MAX_TRANSFER_BYTES)
    throw new ModelVariantExactNameError("integrity_failure");

  const hydrated: ModelVariantExactNameResult[] = [];
  for (const row of candidateRows)
    hydrated.push(await rehydrate(row, validated.normalizedQuery));
  const results = Object.freeze(hydrated.slice(0, validated.limit));
  return Object.freeze({
    publicationId: validated.publicationId,
    results,
    nextAfterResourceId:
      candidateRows.length > validated.limit
        ? (results.at(-1)?.resourceId ?? null)
        : null,
  });
};
