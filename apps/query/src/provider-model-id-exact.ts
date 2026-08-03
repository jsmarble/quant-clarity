import {
  checkModelContract,
  checkOfferingContract,
  checkVariantContract,
  type Model,
  type Variant,
} from "@quant-clarity/contracts";
import {
  hashPublicationResourceContent,
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION,
  normalizeExactSearchName,
  PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
  PROVIDER_MODEL_ID_SEARCH_PROJECTION_VERSION,
  PUBLICATION_RESOURCE_JSON_MAX_BYTES,
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
const PROVIDER_ID = new RegExp(`^prv_${UUID_V4}$`, "u");
const OFFERING_ID = new RegExp(`^off_${UUID_V4}$`, "u");
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const VARIANT_ID = new RegExp(`^var_${UUID_V4}$`, "u");
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const utf8 = new TextEncoder();

export const PROVIDER_MODEL_ID_EXACT_MAX_QUERY_BYTES = 200;
export const PROVIDER_MODEL_ID_EXACT_MAX_QUERY_UNICODE_SCALARS = 200;
export const PROVIDER_MODEL_ID_EXACT_MAX_PAGE_SIZE = 20;
export const PROVIDER_MODEL_ID_EXACT_MAX_RESOURCE_BYTES =
  PUBLICATION_RESOURCE_JSON_MAX_BYTES;
export const PROVIDER_MODEL_ID_EXACT_MAX_TRANSFER_BYTES =
  2 *
  (PROVIDER_MODEL_ID_EXACT_MAX_PAGE_SIZE + 1) *
  PROVIDER_MODEL_ID_EXACT_MAX_RESOURCE_BYTES;

/**
 * Fixed SELECT-only candidate read. Raw and normalized equality have distinct,
 * forced BLOB indexes. The canonical Offering is the witness for provider and
 * record-type filters. Targets are deduplicated before the page limit.
 */
export const PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL = `
WITH ${RETAINED_HOT_REFERENCE_CTE_SQL}, eligible_publication AS (
  SELECT publication.publication_id
  FROM publication_head AS head
  JOIN publication AS publication ON publication.publication_id = ?1
  CROSS JOIN retained_reference AS retained
  WHERE head.singleton = 1
    AND (
      ?13 IS NULL OR (
        ?13 > CAST(strftime('%s', 'now') AS INTEGER) * 1000 -
          ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)}
        AND ?13 <= CAST(strftime('%s', 'now') AS INTEGER) * 1000 +
          ${String(RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS)}
      )
    )
    AND (
      (head.active_publication_id = publication.publication_id AND publication.state = 'active')
      OR
      (head.rollback_candidate_publication_id = publication.publication_id
        AND publication.state IN ('superseded', 'rolled_back'))
      OR (
        ?13 IS NOT NULL
        AND publication.state IN ('superseded', 'rolled_back')
        AND retained.latest_head_reference_ms BETWEEN 0 AND
          CAST(strftime('%s', 'now') AS INTEGER) * 1000 +
            ${String(RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS)}
        AND retained.latest_head_reference_ms >
          ?13 + ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)} -
            ${String(RETAINED_HOT_PUBLICATION_WINDOW_MS)}
      )
    )
), matches AS (
  SELECT
    0 AS match_mode,
    document.publication_id,
    document.offering_id,
    document.provider_id,
    document.target_resource_type,
    document.target_resource_id,
    document.projection_version,
    document.offering_content_hash,
    document.target_content_hash,
    name.projection_version AS name_projection_version,
    name.resource_content_hash AS name_resource_content_hash,
    name.normalized_name_utf8,
    CASE WHEN name.display_name_utf8 = CAST(
      json_extract(target.resource_json, '$.display_name.value') AS BLOB
    ) THEN 1 ELSE 0 END AS display_name_bytes_match,
    offering.content_hash AS offering_resource_content_hash,
    target.content_hash AS target_resource_content_hash,
    CASE WHEN document.raw_provider_model_id_utf8 = CAST(
      json_extract(offering.resource_json, '$.provider_model_id') AS BLOB
    ) THEN 1 ELSE 0 END AS raw_provider_model_id_bytes_match,
    length(CAST(offering.resource_json AS BLOB)) AS offering_json_bytes,
    CASE WHEN length(CAST(offering.resource_json AS BLOB)) <= ?10
      THEN offering.resource_json ELSE NULL END AS offering_json
  FROM eligible_publication AS eligible
  JOIN publication_provider_model_id_search_document AS document
    INDEXED BY publication_provider_model_id_raw_exact_idx
    ON document.publication_id = eligible.publication_id
  JOIN publication_resource AS offering
    ON offering.publication_id = document.publication_id
   AND offering.resource_type = 'offering'
   AND offering.resource_id = document.offering_id
  JOIN publication_resource AS target
    ON target.publication_id = document.publication_id
   AND target.resource_type = document.target_resource_type
   AND target.resource_id = document.target_resource_id
  JOIN publication_model_variant_name_search_document AS name
    ON name.publication_id = document.publication_id
   AND name.resource_type = document.target_resource_type
   AND name.resource_id = document.target_resource_id
  WHERE document.raw_provider_model_id_utf8 = ?2
    AND (?11 = 0 OR name.normalized_name_utf8 <> ?3)
    AND (?4 IS NULL OR document.provider_id = ?4)
    AND (?5 IS NULL OR document.target_resource_type = ?5)
    AND json_extract(offering.resource_json, '$.status.state') = 'known'
    AND json_extract(offering.resource_json, '$.status.value') = 'active'
    AND json_extract(offering.resource_json, '$.stale') = 0
    AND json_extract(target.resource_json, '$.status.state') = 'known'
    AND json_extract(target.resource_json, '$.status.value') = 'active'
  UNION ALL
  SELECT
    1 AS match_mode,
    document.publication_id,
    document.offering_id,
    document.provider_id,
    document.target_resource_type,
    document.target_resource_id,
    document.projection_version,
    document.offering_content_hash,
    document.target_content_hash,
    name.projection_version AS name_projection_version,
    name.resource_content_hash AS name_resource_content_hash,
    name.normalized_name_utf8,
    CASE WHEN name.display_name_utf8 = CAST(
      json_extract(target.resource_json, '$.display_name.value') AS BLOB
    ) THEN 1 ELSE 0 END AS display_name_bytes_match,
    offering.content_hash AS offering_resource_content_hash,
    target.content_hash AS target_resource_content_hash,
    CASE WHEN document.raw_provider_model_id_utf8 = CAST(
      json_extract(offering.resource_json, '$.provider_model_id') AS BLOB
    ) THEN 1 ELSE 0 END AS raw_provider_model_id_bytes_match,
    length(CAST(offering.resource_json AS BLOB)) AS offering_json_bytes,
    CASE WHEN length(CAST(offering.resource_json AS BLOB)) <= ?10
      THEN offering.resource_json ELSE NULL END AS offering_json
  FROM eligible_publication AS eligible
  JOIN publication_provider_model_id_search_document AS document
    INDEXED BY publication_provider_model_id_normalized_exact_idx
    ON document.publication_id = eligible.publication_id
  JOIN publication_resource AS offering
    ON offering.publication_id = document.publication_id
   AND offering.resource_type = 'offering'
   AND offering.resource_id = document.offering_id
  JOIN publication_resource AS target
    ON target.publication_id = document.publication_id
   AND target.resource_type = document.target_resource_type
   AND target.resource_id = document.target_resource_id
  JOIN publication_model_variant_name_search_document AS name
    ON name.publication_id = document.publication_id
   AND name.resource_type = document.target_resource_type
   AND name.resource_id = document.target_resource_id
  WHERE length(?3) > 0
    AND (?11 = 0 OR name.normalized_name_utf8 <> ?3)
    AND document.normalized_provider_model_id_utf8 = ?3
    AND document.raw_provider_model_id_utf8 <> ?2
    AND (?4 IS NULL OR document.provider_id = ?4)
    AND (?5 IS NULL OR document.target_resource_type = ?5)
    AND json_extract(offering.resource_json, '$.status.state') = 'known'
    AND json_extract(offering.resource_json, '$.status.value') = 'active'
    AND json_extract(offering.resource_json, '$.stale') = 0
    AND json_extract(target.resource_json, '$.status.state') = 'known'
    AND json_extract(target.resource_json, '$.status.value') = 'active'
), deduplicated AS (
  SELECT *, row_number() OVER (
    PARTITION BY target_resource_type, target_resource_id
    ORDER BY match_mode ASC, offering_id ASC
  ) AS target_ordinal
  FROM matches
), candidate_page AS (
  SELECT * FROM deduplicated
  WHERE target_ordinal = 1
    AND (
      (
        ?12 = 0
        AND (
          match_mode > ?6
          OR (match_mode = ?6 AND normalized_name_utf8 > ?7)
          OR (match_mode = ?6 AND normalized_name_utf8 = ?7 AND target_resource_id > ?8)
        )
      )
      OR (
        ?12 = 1
        AND (
          match_mode > ?6
          OR (match_mode = ?6 AND target_resource_id > ?8)
        )
      )
    )
  ORDER BY match_mode ASC,
    CASE WHEN ?12 = 0 THEN normalized_name_utf8 ELSE X'' END ASC,
    target_resource_id ASC
  LIMIT ?9
)
SELECT
  0 AS row_ordinal, 'hot_publication' AS row_kind, eligible.publication_id,
  NULL AS match_mode, NULL AS offering_id, NULL AS provider_id,
  NULL AS target_resource_type, NULL AS target_resource_id,
  NULL AS projection_version, NULL AS offering_content_hash,
  NULL AS target_content_hash, NULL AS name_projection_version,
  NULL AS name_resource_content_hash, NULL AS normalized_name_utf8,
  NULL AS ordering_name_utf8,
  NULL AS display_name_bytes_match, NULL AS offering_resource_content_hash,
  NULL AS target_resource_content_hash,
  NULL AS raw_provider_model_id_bytes_match,
  0 AS offering_json_bytes, NULL AS offering_json
FROM eligible_publication AS eligible
UNION ALL
SELECT
  1, 'candidate', candidate.publication_id, candidate.match_mode,
  candidate.offering_id, candidate.provider_id,
  candidate.target_resource_type, candidate.target_resource_id,
  candidate.projection_version, candidate.offering_content_hash,
  candidate.target_content_hash, candidate.name_projection_version,
  candidate.name_resource_content_hash, candidate.normalized_name_utf8,
  CASE WHEN ?12 = 0 THEN candidate.normalized_name_utf8 ELSE X'' END,
  candidate.display_name_bytes_match, candidate.offering_resource_content_hash,
  candidate.target_resource_content_hash,
  candidate.raw_provider_model_id_bytes_match,
  candidate.offering_json_bytes, candidate.offering_json
FROM candidate_page AS candidate
ORDER BY row_ordinal ASC, match_mode ASC,
  ordering_name_utf8 ASC,
  target_resource_id ASC
`;

/** Canonical targets are fetched separately to stay below D1's row-size cap. */
export const PROVIDER_MODEL_ID_EXACT_TARGET_SELECT_SQL = `
WITH ${RETAINED_HOT_REFERENCE_CTE_SQL}, eligible_publication AS (
  SELECT publication.publication_id
  FROM publication_head AS head
  JOIN publication AS publication ON publication.publication_id = ?1
  CROSS JOIN retained_reference AS retained
  WHERE head.singleton = 1
    AND (
      ?4 IS NULL OR (
        ?4 > CAST(strftime('%s', 'now') AS INTEGER) * 1000 -
          ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)}
        AND ?4 <= CAST(strftime('%s', 'now') AS INTEGER) * 1000 +
          ${String(RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS)}
      )
    )
    AND (
      (head.active_publication_id = publication.publication_id AND publication.state = 'active')
      OR
      (head.rollback_candidate_publication_id = publication.publication_id
        AND publication.state IN ('superseded', 'rolled_back'))
      OR (
        ?4 IS NOT NULL
        AND publication.state IN ('superseded', 'rolled_back')
        AND retained.latest_head_reference_ms BETWEEN 0 AND
          CAST(strftime('%s', 'now') AS INTEGER) * 1000 +
            ${String(RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS)}
        AND retained.latest_head_reference_ms >
          ?4 + ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)} -
            ${String(RETAINED_HOT_PUBLICATION_WINDOW_MS)}
      )
    )
), requested AS (
  SELECT
    json_extract(value, '$.resourceType') AS resource_type,
    json_extract(value, '$.resourceId') AS resource_id
  FROM json_each(?2)
), target_rows AS (
  SELECT resource.publication_id, resource.resource_type, resource.resource_id,
    resource.content_hash,
    length(CAST(resource.resource_json AS BLOB)) AS resource_json_bytes,
    CASE WHEN length(CAST(resource.resource_json AS BLOB)) <= ?3
      THEN resource.resource_json ELSE NULL END AS resource_json
  FROM eligible_publication AS eligible
  JOIN requested
  JOIN publication_resource AS resource
    ON resource.publication_id = eligible.publication_id
   AND resource.resource_type = requested.resource_type
   AND resource.resource_id = requested.resource_id
)
SELECT 0 AS row_ordinal, 'hot_publication' AS row_kind,
  eligible.publication_id, NULL AS resource_type, NULL AS resource_id,
  NULL AS content_hash, 0 AS resource_json_bytes, NULL AS resource_json
FROM eligible_publication AS eligible
UNION ALL
SELECT 1, 'target', target.publication_id, target.resource_type,
  target.resource_id, target.content_hash, target.resource_json_bytes,
  target.resource_json
FROM target_rows AS target
ORDER BY row_ordinal ASC, resource_type ASC, resource_id ASC
`;

export type ProviderModelIdExactContinuation = Readonly<{
  matchMode: "raw" | "normalized";
  normalizedTargetDisplayName: string;
  resourceId: string;
}>;

export type ProviderModelIdExactInput = Readonly<{
  publicationId: string;
  query: string;
  providerId: string | null;
  recordType: "model" | "variant" | null;
  continuation: ProviderModelIdExactContinuation | null;
  limit: number;
  requiredAvailableUntilMs?: number | null;
}>;

export type MergedProviderModelIdExactContinuation = Readonly<{
  matchMode: "raw" | "normalized";
  resourceId: string;
}>;

export type MergedProviderModelIdExactInput = Readonly<
  Omit<ProviderModelIdExactInput, "continuation"> & {
    continuation: MergedProviderModelIdExactContinuation | null;
  }
>;

export type ProviderModelIdExactDatabase = Pick<D1DatabaseSession, "prepare">;

type KnownDisplayName = Readonly<
  Omit<Extract<Model["display_name"], { state: "known" }>, "evidence_ids"> & {
    evidence_ids: readonly string[];
  }
>;

export type ProviderModelIdExactResult = Readonly<{
  tier: 2;
  resourceType: "model" | "variant";
  resourceId: string;
  matchKind: "provider_model_id";
  displayName: KnownDisplayName;
  semanticDegraded: "disabled";
}>;

export type ProviderModelIdExactPage = Readonly<{
  publicationId: string;
  results: readonly ProviderModelIdExactResult[];
  matchModes: readonly ("raw" | "normalized")[];
  nextContinuation: ProviderModelIdExactContinuation | null;
}>;

export type MergedProviderModelIdExactPage = Readonly<{
  publicationId: string;
  results: readonly ProviderModelIdExactResult[];
  matchModes: readonly ("raw" | "normalized")[];
  nextContinuation: MergedProviderModelIdExactContinuation | null;
}>;

export type ProviderModelIdExactErrorCode =
  "invalid_input" | "integrity_failure" | "read_failure";

export class ProviderModelIdExactError extends Error {
  readonly code: ProviderModelIdExactErrorCode;
  constructor(code: ProviderModelIdExactErrorCode) {
    super(
      code === "invalid_input"
        ? "The provider-model-ID query is invalid."
        : code === "integrity_failure"
          ? "Published provider-model-ID data failed integrity verification."
          : "Published provider-model-ID data could not be read.",
    );
    this.name = "ProviderModelIdExactError";
    this.code = code;
  }
}

type ValidatedInput = Readonly<{
  publicationId: string;
  query: string;
  rawBytes: ArrayBuffer;
  normalizedQuery: string;
  normalizedBytes: ArrayBuffer;
  providerId: string | null;
  recordType: "model" | "variant" | null;
  afterMatchMode: -1 | 0 | 1;
  afterNormalizedBytes: ArrayBuffer;
  afterResourceId: string;
  limit: number;
  requiredAvailableUntilMs: number | null;
}>;

const candidateKeys = [
  "match_mode",
  "name_projection_version",
  "name_resource_content_hash",
  "normalized_name_utf8",
  "ordering_name_utf8",
  "display_name_bytes_match",
  "offering_content_hash",
  "offering_id",
  "offering_json",
  "offering_json_bytes",
  "offering_resource_content_hash",
  "projection_version",
  "provider_id",
  "publication_id",
  "raw_provider_model_id_bytes_match",
  "row_kind",
  "row_ordinal",
  "target_content_hash",
  "target_resource_content_hash",
  "target_resource_id",
  "target_resource_type",
] as const;
const targetKeys = [
  "content_hash",
  "publication_id",
  "resource_id",
  "resource_json",
  "resource_json_bytes",
  "resource_type",
  "row_kind",
  "row_ordinal",
] as const;

const plainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const snapshot = (value: unknown): Record<string, unknown> | null => {
  try {
    if (!plainRecord(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      )
        return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
};
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, i) => key === expected[i])
  );
};
const invalid = (): never => {
  throw new ProviderModelIdExactError("invalid_input");
};
const targetIdValid = (type: unknown, id: unknown): id is string =>
  typeof id === "string" &&
  (type === "model"
    ? MODEL_ID.test(id)
    : type === "variant" && VARIANT_ID.test(id));
const invalidUnicode = (value: string) =>
  Array.from(value).some((scalar) => {
    const point = scalar.codePointAt(0);
    return point !== undefined && point >= 0xd800 && point <= 0xdfff;
  });
const bytes = (value: string): ArrayBuffer => {
  const view = utf8.encode(value);
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
};
const snapshotD1Blob = (
  value: unknown,
  maximum: number,
): ArrayBuffer | null => {
  if (value instanceof ArrayBuffer)
    return value.byteLength <= maximum ? value.slice(0) : null;
  if (!Array.isArray(value) || value.length > maximum) return null;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== value.length + 1 ||
      ownKeys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" &&
            (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)),
      )
    )
      return null;
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    if (lengthDescriptor?.value !== value.length) return null;
    const view = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "number" ||
        !Number.isInteger(descriptor.value) ||
        descriptor.value < 0 ||
        descriptor.value > 255
      )
        return null;
      view[index] = descriptor.value;
    }
    return view.buffer;
  } catch {
    return null;
  }
};

const validateInput = (
  value: unknown,
  stableIdOrdering: boolean,
): ValidatedInput => {
  const input = snapshot(value);
  if (
    input === null ||
    !exactKeys(input, [
      "continuation",
      "limit",
      "providerId",
      "publicationId",
      "query",
      "recordType",
      ...(Object.hasOwn(input, "requiredAvailableUntilMs")
        ? ["requiredAvailableUntilMs"]
        : []),
    ]) ||
    typeof input.publicationId !== "string" ||
    !PUBLICATION_ID.test(input.publicationId) ||
    typeof input.query !== "string" ||
    invalidUnicode(input.query) ||
    input.query !== input.query.normalize("NFC").trim() ||
    Array.from(input.query).length >
      PROVIDER_MODEL_ID_EXACT_MAX_QUERY_UNICODE_SCALARS ||
    utf8.encode(input.query).byteLength < 1 ||
    utf8.encode(input.query).byteLength >
      PROVIDER_MODEL_ID_EXACT_MAX_QUERY_BYTES ||
    (input.providerId !== null &&
      (typeof input.providerId !== "string" ||
        !PROVIDER_ID.test(input.providerId))) ||
    (input.recordType !== null &&
      input.recordType !== "model" &&
      input.recordType !== "variant") ||
    typeof input.limit !== "number" ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > PROVIDER_MODEL_ID_EXACT_MAX_PAGE_SIZE
  )
    return invalid();
  const requiredAvailableUntilMs = Object.hasOwn(
    input,
    "requiredAvailableUntilMs",
  )
    ? input.requiredAvailableUntilMs
    : null;
  if (!validRequiredAvailableUntilMs(requiredAvailableUntilMs))
    return invalid();
  let normalizedQuery = "";
  try {
    normalizedQuery = normalizeExactSearchName(input.query);
  } catch (error) {
    if (!(error instanceof RangeError)) return invalid();
  }
  if (
    utf8.encode(normalizedQuery).byteLength >
    PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES
  )
    return invalid();

  let afterMatchMode: -1 | 0 | 1 = -1;
  let afterNormalizedName = "";
  let afterResourceId = "";
  if (input.continuation !== null) {
    const continuation = snapshot(input.continuation);
    if (
      continuation === null ||
      !exactKeys(
        continuation,
        stableIdOrdering
          ? ["matchMode", "resourceId"]
          : ["matchMode", "normalizedTargetDisplayName", "resourceId"],
      ) ||
      (continuation.matchMode !== "raw" &&
        continuation.matchMode !== "normalized") ||
      (!stableIdOrdering &&
        (typeof continuation.normalizedTargetDisplayName !== "string" ||
          invalidUnicode(continuation.normalizedTargetDisplayName) ||
          utf8.encode(continuation.normalizedTargetDisplayName).byteLength <
            1 ||
          utf8.encode(continuation.normalizedTargetDisplayName).byteLength >
            MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES)) ||
      !targetIdValid(
        input.recordType ??
          (String(continuation.resourceId).startsWith("mdl_")
            ? "model"
            : "variant"),
        continuation.resourceId,
      )
    )
      return invalid();
    if (!stableIdOrdering) {
      let renormalized: string;
      try {
        renormalized = normalizeExactSearchName(
          continuation.normalizedTargetDisplayName as string,
        );
      } catch {
        return invalid();
      }
      if (renormalized !== continuation.normalizedTargetDisplayName)
        return invalid();
    }
    afterMatchMode = continuation.matchMode === "raw" ? 0 : 1;
    afterNormalizedName = stableIdOrdering
      ? ""
      : (continuation.normalizedTargetDisplayName as string);
    afterResourceId = continuation.resourceId;
  }
  return {
    publicationId: input.publicationId,
    query: input.query,
    rawBytes: bytes(input.query),
    normalizedQuery,
    normalizedBytes: bytes(normalizedQuery),
    providerId: input.providerId,
    recordType: input.recordType,
    afterMatchMode,
    afterNormalizedBytes: bytes(afterNormalizedName),
    afterResourceId,
    limit: input.limit,
    requiredAvailableUntilMs,
  };
};

const snapshotRows = (value: unknown, maximum: number): unknown[] | null => {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    )
      return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximum
    )
      return null;
    const length = lengthDescriptor.value;
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== length + 1 ||
      ownKeys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" &&
            (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)),
      )
    )
      return null;
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      )
        return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
};
const rows = (value: unknown, maximum: number): unknown[] => {
  const result = snapshot(value);
  if (result?.success !== true)
    throw new ProviderModelIdExactError("read_failure");
  const resultRows = snapshotRows(result.results, maximum);
  if (resultRows === null)
    throw new ProviderModelIdExactError("integrity_failure");
  return resultRows.map((row): unknown => snapshot(row) ?? row);
};
const sentinel = (
  value: unknown,
  publicationId: string,
  keys: readonly string[],
): boolean => {
  const row = snapshot(value);
  if (
    row === null ||
    !exactKeys(row, keys) ||
    row.row_ordinal !== 0 ||
    row.row_kind !== "hot_publication" ||
    row.publication_id !== publicationId
  )
    return false;
  return Object.entries(row).every(
    ([key, field]) =>
      ["row_ordinal", "row_kind", "publication_id"].includes(key) ||
      field === null ||
      field === 0,
  );
};

type Candidate = Readonly<{
  match_mode: 0 | 1;
  publication_id: string;
  offering_id: string;
  provider_id: string;
  target_resource_type: "model" | "variant";
  target_resource_id: string;
  projection_version: typeof PROVIDER_MODEL_ID_SEARCH_PROJECTION_VERSION;
  offering_content_hash: string;
  target_content_hash: string;
  name_projection_version: typeof MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION;
  name_resource_content_hash: string;
  normalized_name_utf8: ArrayBuffer;
  ordering_name_utf8: ArrayBuffer;
  display_name_bytes_match: 1;
  offering_resource_content_hash: string;
  target_resource_content_hash: string;
  raw_provider_model_id_bytes_match: 1;
  offering_json_bytes: number;
  offering_json: string;
}>;

const candidate = (value: unknown): Candidate | null => {
  const row = snapshot(value);
  const normalizedName = snapshotD1Blob(
    row?.normalized_name_utf8,
    MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  );
  const orderingName = snapshotD1Blob(
    row?.ordering_name_utf8,
    MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  );
  if (
    row === null ||
    !exactKeys(row, candidateKeys) ||
    row.row_ordinal !== 1 ||
    row.row_kind !== "candidate" ||
    (row.match_mode !== 0 && row.match_mode !== 1) ||
    typeof row.publication_id !== "string" ||
    typeof row.offering_id !== "string" ||
    !OFFERING_ID.test(row.offering_id) ||
    typeof row.provider_id !== "string" ||
    !PROVIDER_ID.test(row.provider_id) ||
    !targetIdValid(row.target_resource_type, row.target_resource_id) ||
    row.projection_version !== PROVIDER_MODEL_ID_SEARCH_PROJECTION_VERSION ||
    row.name_projection_version !==
      MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION ||
    typeof row.name_resource_content_hash !== "string" ||
    !SHA256.test(row.name_resource_content_hash) ||
    typeof row.offering_content_hash !== "string" ||
    !SHA256.test(row.offering_content_hash) ||
    typeof row.target_content_hash !== "string" ||
    !SHA256.test(row.target_content_hash) ||
    normalizedName === null ||
    normalizedName.byteLength < 1 ||
    orderingName === null ||
    row.display_name_bytes_match !== 1 ||
    typeof row.offering_resource_content_hash !== "string" ||
    !SHA256.test(row.offering_resource_content_hash) ||
    typeof row.target_resource_content_hash !== "string" ||
    !SHA256.test(row.target_resource_content_hash) ||
    row.raw_provider_model_id_bytes_match !== 1 ||
    typeof row.offering_json_bytes !== "number" ||
    !Number.isSafeInteger(row.offering_json_bytes) ||
    row.offering_json_bytes < 0 ||
    typeof row.offering_json !== "string"
  )
    return null;
  return {
    ...row,
    normalized_name_utf8: normalizedName,
    ordering_name_utf8: orderingName,
  } as unknown as Candidate;
};

type TargetRow = Readonly<{
  publication_id: string;
  resource_type: "model" | "variant";
  resource_id: string;
  content_hash: string;
  resource_json_bytes: number;
  resource_json: string;
}>;
const targetRow = (value: unknown): TargetRow | null => {
  const row = snapshot(value);
  if (
    row === null ||
    !exactKeys(row, targetKeys) ||
    row.row_ordinal !== 1 ||
    row.row_kind !== "target" ||
    typeof row.publication_id !== "string" ||
    !targetIdValid(row.resource_type, row.resource_id) ||
    typeof row.content_hash !== "string" ||
    !SHA256.test(row.content_hash) ||
    typeof row.resource_json_bytes !== "number" ||
    !Number.isSafeInteger(row.resource_json_bytes) ||
    row.resource_json_bytes < 0 ||
    typeof row.resource_json !== "string"
  )
    return null;
  return row as unknown as TargetRow;
};

const decodeNormalized = (value: ArrayBuffer): string => {
  try {
    const decoded = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(value);
    const renormalized = normalizeExactSearchName(decoded);
    const canonical = utf8.encode(decoded);
    const source = new Uint8Array(value);
    if (
      canonical.byteLength !== source.byteLength ||
      renormalized !== decoded ||
      canonical.some((byte, index) => byte !== source[index])
    )
      throw new ProviderModelIdExactError("integrity_failure");
    return decoded;
  } catch {
    throw new ProviderModelIdExactError("integrity_failure");
  }
};

/** Mirrors SQLite's unsigned lexicographic BLOB comparison exactly. */
const compareUtf8Bytes = (left: ArrayBuffer, right: ArrayBuffer): number => {
  const leftView = new Uint8Array(left);
  const rightView = new Uint8Array(right);
  const sharedLength = Math.min(leftView.byteLength, rightView.byteLength);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftByte = leftView[index];
    const rightByte = rightView[index];
    if (leftByte === undefined || rightByte === undefined)
      throw new ProviderModelIdExactError("integrity_failure");
    if (leftByte !== rightByte) return leftByte < rightByte ? -1 : 1;
  }
  if (leftView.byteLength === rightView.byteLength) return 0;
  return leftView.byteLength < rightView.byteLength ? -1 : 1;
};

const readProviderModelIdExactPageInternal = async (
  database: ProviderModelIdExactDatabase,
  input: ProviderModelIdExactInput | MergedProviderModelIdExactInput,
  excludeCanonicalExactMatch: boolean,
  stableIdOrdering: boolean,
): Promise<ProviderModelIdExactPage> => {
  const valid = validateInput(input, stableIdOrdering);
  let candidateValues: unknown[];
  try {
    const result: unknown = await database
      .prepare(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL)
      .bind(
        valid.publicationId,
        valid.rawBytes,
        valid.normalizedBytes,
        valid.providerId,
        valid.recordType,
        valid.afterMatchMode,
        valid.afterNormalizedBytes,
        valid.afterResourceId,
        valid.limit + 1,
        PROVIDER_MODEL_ID_EXACT_MAX_RESOURCE_BYTES,
        excludeCanonicalExactMatch ? 1 : 0,
        stableIdOrdering ? 1 : 0,
        valid.requiredAvailableUntilMs,
      )
      .all();
    candidateValues = rows(result, valid.limit + 2);
  } catch (error) {
    if (error instanceof ProviderModelIdExactError) throw error;
    throw new ProviderModelIdExactError("read_failure");
  }
  const sentinels = candidateValues.filter(
    (value) => snapshot(value)?.row_kind === "hot_publication",
  );
  if (
    sentinels.length !== 1 ||
    !sentinel(sentinels[0], valid.publicationId, candidateKeys)
  )
    throw new ProviderModelIdExactError("integrity_failure");
  const candidates: Candidate[] = [];
  let prior: readonly [number, ArrayBuffer, string] = [
    valid.afterMatchMode,
    valid.afterNormalizedBytes,
    valid.afterResourceId,
  ];
  let transferred = 0;
  for (const value of candidateValues.filter(
    (value) => snapshot(value)?.row_kind !== "hot_publication",
  )) {
    const row = candidate(value);
    if (row === null) throw new ProviderModelIdExactError("integrity_failure");
    if (
      row.publication_id !== valid.publicationId ||
      (valid.providerId !== null && row.provider_id !== valid.providerId) ||
      (valid.recordType !== null &&
        row.target_resource_type !== valid.recordType) ||
      row.offering_content_hash !== row.offering_resource_content_hash ||
      row.target_content_hash !== row.target_resource_content_hash ||
      row.name_resource_content_hash !== row.target_content_hash ||
      row.offering_json_bytes > PROVIDER_MODEL_ID_EXACT_MAX_RESOURCE_BYTES ||
      utf8.encode(row.offering_json).byteLength !== row.offering_json_bytes
    )
      throw new ProviderModelIdExactError("integrity_failure");
    if (
      stableIdOrdering
        ? row.ordering_name_utf8.byteLength !== 0
        : compareUtf8Bytes(row.ordering_name_utf8, row.normalized_name_utf8) !==
          0
    )
      throw new ProviderModelIdExactError("integrity_failure");
    decodeNormalized(row.normalized_name_utf8);
    const normalizedComparison = stableIdOrdering
      ? 0
      : compareUtf8Bytes(row.normalized_name_utf8, prior[1]);
    if (
      row.match_mode < prior[0] ||
      (row.match_mode === prior[0] &&
        (stableIdOrdering
          ? row.target_resource_id <= prior[2]
          : normalizedComparison < 0 ||
            (normalizedComparison === 0 && row.target_resource_id <= prior[2])))
    )
      throw new ProviderModelIdExactError("integrity_failure");
    prior = [row.match_mode, row.normalized_name_utf8, row.target_resource_id];
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.offering_json);
    } catch {
      throw new ProviderModelIdExactError("integrity_failure");
    }
    if (!checkOfferingContract(parsed))
      throw new ProviderModelIdExactError("integrity_failure");
    let witnessNormalized = "";
    if (row.match_mode === 1)
      try {
        witnessNormalized = normalizeExactSearchName(parsed.provider_model_id);
      } catch (error) {
        if (!(error instanceof RangeError))
          throw new ProviderModelIdExactError("integrity_failure");
      }
    if (
      parsed.offering_id !== row.offering_id ||
      parsed.provider_id !== row.provider_id ||
      parsed.model_resource_id !== row.target_resource_id ||
      parsed.status.state !== "known" ||
      parsed.status.value !== "active" ||
      parsed.stale ||
      (row.match_mode === 0
        ? parsed.provider_model_id !== valid.query
        : parsed.provider_model_id === valid.query ||
          witnessNormalized.length === 0 ||
          witnessNormalized !== valid.normalizedQuery)
    )
      throw new ProviderModelIdExactError("integrity_failure");
    let hash: string;
    try {
      hash = await hashPublicationResourceContent({
        resourceType: "offering",
        resourceId: row.offering_id,
        resourceJson: row.offering_json,
      });
    } catch {
      throw new ProviderModelIdExactError("integrity_failure");
    }
    if (hash !== row.offering_content_hash)
      throw new ProviderModelIdExactError("integrity_failure");
    transferred += row.offering_json_bytes;
    candidates.push(row);
  }
  if (
    transferred > PROVIDER_MODEL_ID_EXACT_MAX_TRANSFER_BYTES ||
    candidates.length > valid.limit + 1
  )
    throw new ProviderModelIdExactError("integrity_failure");

  if (candidates.length === 0)
    return Object.freeze({
      publicationId: valid.publicationId,
      results: Object.freeze([]),
      matchModes: Object.freeze([]),
      nextContinuation: null,
    });
  const requested = JSON.stringify(
    candidates.map((row) => ({
      resourceType: row.target_resource_type,
      resourceId: row.target_resource_id,
    })),
  );
  let targetValues: unknown[];
  try {
    const result: unknown = await database
      .prepare(PROVIDER_MODEL_ID_EXACT_TARGET_SELECT_SQL)
      .bind(
        valid.publicationId,
        requested,
        PROVIDER_MODEL_ID_EXACT_MAX_RESOURCE_BYTES,
        valid.requiredAvailableUntilMs,
      )
      .all();
    targetValues = rows(result, candidates.length + 1);
  } catch (error) {
    if (error instanceof ProviderModelIdExactError) throw error;
    throw new ProviderModelIdExactError("read_failure");
  }
  const targetSentinels = targetValues.filter(
    (value) => snapshot(value)?.row_kind === "hot_publication",
  );
  if (
    targetSentinels.length !== 1 ||
    !sentinel(targetSentinels[0], valid.publicationId, targetKeys)
  )
    throw new ProviderModelIdExactError("integrity_failure");
  const targets = new Map<string, Model | Variant>();
  const targetHashes = new Map<string, string>();
  for (const value of targetValues.filter(
    (item) => snapshot(item)?.row_kind !== "hot_publication",
  )) {
    const row = targetRow(value);
    if (row === null) throw new ProviderModelIdExactError("integrity_failure");
    if (
      row.publication_id !== valid.publicationId ||
      row.resource_json_bytes > PROVIDER_MODEL_ID_EXACT_MAX_RESOURCE_BYTES ||
      utf8.encode(row.resource_json).byteLength !== row.resource_json_bytes ||
      targets.has(`${row.resource_type}:${row.resource_id}`)
    )
      throw new ProviderModelIdExactError("integrity_failure");
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.resource_json);
    } catch {
      throw new ProviderModelIdExactError("integrity_failure");
    }
    const contract =
      row.resource_type === "model"
        ? checkModelContract(parsed)
        : checkVariantContract(parsed);
    if (!contract) throw new ProviderModelIdExactError("integrity_failure");
    const canonical = parsed as Model | Variant;
    const canonicalId =
      row.resource_type === "model"
        ? (canonical as Model).model_id
        : (canonical as Variant).variant_id;
    let hash: string;
    try {
      hash = await hashPublicationResourceContent({
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        resourceJson: row.resource_json,
      });
    } catch {
      throw new ProviderModelIdExactError("integrity_failure");
    }
    if (
      canonicalId !== row.resource_id ||
      canonical.status.state !== "known" ||
      canonical.status.value !== "active" ||
      canonical.display_name.state !== "known" ||
      hash !== row.content_hash
    )
      throw new ProviderModelIdExactError("integrity_failure");
    targets.set(`${row.resource_type}:${row.resource_id}`, canonical);
    targetHashes.set(
      `${row.resource_type}:${row.resource_id}`,
      row.content_hash,
    );
    transferred += row.resource_json_bytes;
  }
  if (
    transferred > PROVIDER_MODEL_ID_EXACT_MAX_TRANSFER_BYTES ||
    targets.size !== candidates.length
  )
    throw new ProviderModelIdExactError("integrity_failure");

  const hydrated = candidates.map((row) => {
    const target = targets.get(
      `${row.target_resource_type}:${row.target_resource_id}`,
    );
    if (
      target === undefined ||
      row.target_content_hash !==
        targetHashes.get(
          `${row.target_resource_type}:${row.target_resource_id}`,
        )
    )
      throw new ProviderModelIdExactError("integrity_failure");
    const normalized = decodeNormalized(row.normalized_name_utf8);
    let canonicalNormalized: string;
    try {
      canonicalNormalized = normalizeExactSearchName(
        target.display_name.state === "known" ? target.display_name.value : "",
      );
    } catch {
      throw new ProviderModelIdExactError("integrity_failure");
    }
    if (
      canonicalNormalized !== normalized ||
      target.display_name.state !== "known"
    )
      throw new ProviderModelIdExactError("integrity_failure");
    return Object.freeze({
      tier: 2 as const,
      resourceType: row.target_resource_type,
      resourceId: row.target_resource_id,
      matchKind: "provider_model_id" as const,
      displayName: Object.freeze({
        ...target.display_name,
        evidence_ids: Object.freeze([...target.display_name.evidence_ids]),
      }),
      semanticDegraded: "disabled" as const,
    });
  });
  const results = Object.freeze(hydrated.slice(0, valid.limit));
  const last = results.at(-1);
  const lastCandidate = candidates[valid.limit - 1];
  return Object.freeze({
    publicationId: valid.publicationId,
    results,
    matchModes: Object.freeze(
      candidates
        .slice(0, valid.limit)
        .map((candidate) =>
          candidate.match_mode === 0
            ? ("raw" as const)
            : ("normalized" as const),
        ),
    ),
    nextContinuation:
      candidates.length > valid.limit &&
      last !== undefined &&
      lastCandidate !== undefined
        ? Object.freeze({
            matchMode:
              lastCandidate.match_mode === 0
                ? ("raw" as const)
                : ("normalized" as const),
            normalizedTargetDisplayName: decodeNormalized(
              lastCandidate.normalized_name_utf8,
            ),
            resourceId: last.resourceId,
          })
        : null,
  });
};

/**
 * Standalone tier reader. Canonical-name overlap is intentionally retained so
 * this independently testable seam reports the complete provider-model-ID
 * tier. The merged exact-search reader applies its cross-tier exclusion before
 * LIMIT through the separate function below.
 */
export const readProviderModelIdExactPage = (
  database: ProviderModelIdExactDatabase,
  input: ProviderModelIdExactInput,
): Promise<ProviderModelIdExactPage> =>
  readProviderModelIdExactPageInternal(database, input, false, false);

/** Composite-only tier read with canonical exact-name overlap removed in SQL. */
export const readMergedProviderModelIdExactPage = async (
  database: ProviderModelIdExactDatabase,
  input: MergedProviderModelIdExactInput,
): Promise<MergedProviderModelIdExactPage> => {
  const page = await readProviderModelIdExactPageInternal(
    database,
    input,
    true,
    true,
  );
  return Object.freeze({
    publicationId: page.publicationId,
    results: page.results,
    matchModes: page.matchModes,
    nextContinuation:
      page.nextContinuation === null
        ? null
        : Object.freeze({
            matchMode: page.nextContinuation.matchMode,
            resourceId: page.nextContinuation.resourceId,
          }),
  });
};
