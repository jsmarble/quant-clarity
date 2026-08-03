import { checkModelContract, type Model } from "@quant-clarity/contracts";
import {
  hashPublicationResourceContent,
  PUBLICATION_RESOURCE_JSON_MAX_BYTES,
} from "@quant-clarity/publication-core";

import {
  RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS,
  RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS,
  RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS,
  RETAINED_HOT_PUBLICATION_WINDOW_MS,
  RETAINED_HOT_REFERENCE_CTE_SQL,
} from "./retained-hot-publication.js";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SCHEMA_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const AUDIENCE = "quantclarity-catalog-query-v1" as const;
const ENVIRONMENTS = new Set(["local", "preview", "production", "test"]);
const UTF8 = new TextEncoder();

const validSchemaVersion = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 128 &&
  UTF8.encode(value).byteLength <= 512 &&
  SCHEMA_VERSION.test(value);

export const MODEL_DETAIL_MAX_RESOURCE_BYTES =
  PUBLICATION_RESOURCE_JSON_MAX_BYTES;

/**
 * One fixed SELECT-only statement. The exact publication/type/ID predicates
 * use publication_resource's composite primary key. The sentinel makes a
 * missing model distinguishable from a publication that ceased to be safely
 * readable between resolution and this bookmark-continuous read.
 */
export const MODEL_DETAIL_SELECT_SQL = `
WITH ${RETAINED_HOT_REFERENCE_CTE_SQL}, clock AS (
  SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now_ms
), eligible_publication AS (
  SELECT publication.publication_id, publication.schema_version
  FROM publication_head AS head
  JOIN publication AS publication
    ON publication.publication_id = ?1
  JOIN publication_closure_seal AS seal
    ON seal.publication_id = publication.publication_id
   AND seal.closure_hash = publication.closure_hash
  CROSS JOIN retained_reference AS retained
  CROSS JOIN clock
  WHERE head.singleton = 1
    AND ?2 > clock.now_ms -
      ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)}
    AND ?2 <= clock.now_ms +
      ${String(RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS)}
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
        publication.state IN ('superseded', 'rolled_back')
        AND retained.latest_head_reference_ms BETWEEN 0 AND
          clock.now_ms +
            ${String(RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS)}
        AND retained.latest_head_reference_ms >
          ?2 + ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)} -
            ${String(RETAINED_HOT_PUBLICATION_WINDOW_MS)}
      )
    )
), candidate AS (
  SELECT
    resource.publication_id,
    eligible.schema_version,
    resource.resource_id AS model_id,
    resource.content_hash,
    length(CAST(resource.resource_json AS BLOB)) AS resource_json_bytes,
    CASE
      WHEN length(CAST(resource.resource_json AS BLOB)) <= ?4
      THEN resource.resource_json
      ELSE NULL
    END AS resource_json
  FROM eligible_publication AS eligible
  JOIN publication_resource AS resource
    ON resource.publication_id = eligible.publication_id
   AND resource.resource_type = 'model'
   AND resource.resource_id = ?3
)
SELECT
  0 AS row_ordinal,
  'hot_publication' AS row_kind,
  eligible.publication_id,
  eligible.schema_version,
  NULL AS model_id,
  NULL AS content_hash,
  0 AS resource_json_bytes,
  NULL AS resource_json
FROM eligible_publication AS eligible
UNION ALL
SELECT
  1 AS row_ordinal,
  'model' AS row_kind,
  candidate.publication_id,
  candidate.schema_version,
  candidate.model_id,
  candidate.content_hash,
  candidate.resource_json_bytes,
  candidate.resource_json
FROM candidate
ORDER BY row_ordinal ASC
LIMIT 2
`;

export type ReadModelDetailV1Input = Readonly<{
  audience: typeof AUDIENCE;
  bookmark: string;
  environment: "local" | "preview" | "production" | "test";
  envelope: unknown;
  requiredAvailableUntilMs: number;
  version: 1;
}>;

export type ReadModelDetailV1Outcome =
  | Readonly<{
      model: Model;
      outcome: "model";
      publicationId: string;
      schemaVersion: string;
    }>
  | Readonly<{
      outcome: "not_found";
      publicationId: string;
      schemaVersion: string;
    }>
  | Readonly<{ outcome: "integrity_failure" }>
  | Readonly<{ outcome: "read_failure" }>;

type ParsedInput = Readonly<{
  bookmark: string;
  environment: "local" | "preview" | "production" | "test";
  modelId: string;
  publicationId: string;
  requiredAvailableUntilMs: number;
}>;

const ownDataRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      [...expectedKeys]
        .sort()
        .some((key, index) => [...(keys as string[])].sort()[index] !== key)
    )
      return null;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      )
        return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
};

const ownDataArray = (
  value: unknown,
  expectedLength: number,
): readonly unknown[] | null => {
  try {
    if (!Array.isArray(value) || value.length !== expectedLength) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedLength + 1 ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" &&
            (!/^(?:0|[1-9][0-9]*)$/u.test(key) ||
              Number(key) >= expectedLength)),
      )
    )
      return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < expectedLength; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      )
        return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
};

const parseInput = (
  value: unknown,
  protectedEnvironment: unknown,
): ParsedInput | null => {
  const outer = ownDataRecord(value, [
    "audience",
    "bookmark",
    "envelope",
    "environment",
    "requiredAvailableUntilMs",
    "version",
  ]);
  if (
    outer?.version !== 1 ||
    outer.audience !== AUDIENCE ||
    typeof outer.environment !== "string" ||
    !ENVIRONMENTS.has(outer.environment) ||
    outer.environment !== protectedEnvironment ||
    typeof outer.bookmark !== "string" ||
    outer.bookmark.length === 0 ||
    outer.bookmark.length > 4096 ||
    outer.bookmark === "first-primary" ||
    outer.bookmark === "first-unconstrained" ||
    typeof outer.requiredAvailableUntilMs !== "number" ||
    !Number.isSafeInteger(outer.requiredAvailableUntilMs) ||
    outer.requiredAvailableUntilMs < 0
  )
    return null;

  const envelope = ownDataRecord(outer.envelope, [
    "audience",
    "continuation",
    "environment",
    "filters",
    "limit",
    "operation",
    "publicationId",
    "searchPlan",
    "sort",
    "version",
  ]);
  const operation = ownDataRecord(envelope?.operation, [
    "identifier",
    "kind",
    "resourceType",
  ]);
  const sort = ownDataArray(envelope?.sort, 2);
  if (
    envelope?.audience !== AUDIENCE ||
    envelope.version !== 1 ||
    envelope.environment !== outer.environment ||
    envelope.continuation !== null ||
    envelope.limit !== 25 ||
    envelope.searchPlan !== null ||
    ownDataRecord(envelope.filters, []) === null ||
    sort?.[0] !== "name" ||
    sort[1] !== "stable_id" ||
    typeof envelope.publicationId !== "string" ||
    !PUBLICATION_ID.test(envelope.publicationId) ||
    operation?.kind !== "detail" ||
    operation.resourceType !== "model" ||
    typeof operation.identifier !== "string" ||
    !MODEL_ID.test(operation.identifier)
  )
    return null;

  return {
    bookmark: outer.bookmark,
    environment: outer.environment as ParsedInput["environment"],
    modelId: operation.identifier,
    publicationId: envelope.publicationId,
    requiredAvailableUntilMs: outer.requiredAvailableUntilMs,
  };
};

type ModelRow = Readonly<{
  content_hash: string;
  model_id: string;
  publication_id: string;
  schema_version: string;
  resource_json: string | null;
  resource_json_bytes: number;
  row_kind: "model";
  row_ordinal: 1;
}>;

const snapshotModelRow = (value: unknown): ModelRow | null => {
  const row = ownDataRecord(value, [
    "content_hash",
    "model_id",
    "publication_id",
    "resource_json",
    "resource_json_bytes",
    "row_kind",
    "row_ordinal",
    "schema_version",
  ]);
  if (
    row?.row_ordinal !== 1 ||
    row.row_kind !== "model" ||
    typeof row.publication_id !== "string" ||
    !PUBLICATION_ID.test(row.publication_id) ||
    !validSchemaVersion(row.schema_version) ||
    typeof row.model_id !== "string" ||
    !MODEL_ID.test(row.model_id) ||
    typeof row.content_hash !== "string" ||
    !SHA256.test(row.content_hash) ||
    typeof row.resource_json_bytes !== "number" ||
    !Number.isSafeInteger(row.resource_json_bytes) ||
    row.resource_json_bytes < 0 ||
    (typeof row.resource_json !== "string" && row.resource_json !== null)
  )
    return null;
  return row as ModelRow;
};

const snapshotSentinel = (
  value: unknown,
  publicationId: string,
): Readonly<{ schemaVersion: string }> | null => {
  const row = ownDataRecord(value, [
    "content_hash",
    "model_id",
    "publication_id",
    "resource_json",
    "resource_json_bytes",
    "row_kind",
    "row_ordinal",
    "schema_version",
  ]);
  return row?.row_ordinal === 0 &&
    row.row_kind === "hot_publication" &&
    row.publication_id === publicationId &&
    row.model_id === null &&
    row.content_hash === null &&
    row.resource_json_bytes === 0 &&
    row.resource_json === null &&
    validSchemaVersion(row.schema_version)
    ? { schemaVersion: row.schema_version }
    : null;
};

const successfulRows = (
  value: unknown,
): readonly unknown[] | "too_many" | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const success = Object.getOwnPropertyDescriptor(value, "success");
    const results = Object.getOwnPropertyDescriptor(value, "results");
    if (
      success === undefined ||
      !("value" in success) ||
      success.value !== true ||
      results === undefined ||
      !("value" in results)
    )
      return null;
    if (!Array.isArray(results.value)) return null;
    if (results.value.length > 2) return "too_many";
    return ownDataArray(results.value, results.value.length);
  } catch {
    return null;
  }
};

export const readModelDetailV1 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  input: unknown,
): Promise<ReadModelDetailV1Outcome> => {
  const parsed = parseInput(input, protectedEnvironment);
  if (parsed === null) return { outcome: "integrity_failure" };

  let rows: readonly unknown[];
  try {
    const result: unknown = await database
      .withSession(parsed.bookmark)
      .prepare(MODEL_DETAIL_SELECT_SQL)
      .bind(
        parsed.publicationId,
        parsed.requiredAvailableUntilMs,
        parsed.modelId,
        MODEL_DETAIL_MAX_RESOURCE_BYTES,
      )
      .all<ModelRow>();
    const snapshot = successfulRows(result);
    if (snapshot === null) return { outcome: "read_failure" };
    if (snapshot === "too_many") return { outcome: "integrity_failure" };
    rows = snapshot;
  } catch {
    return { outcome: "read_failure" };
  }

  const sentinelRows = rows.filter(
    (row) => snapshotSentinel(row, parsed.publicationId) !== null,
  );
  if (sentinelRows.length !== 1) return { outcome: "integrity_failure" };
  const selected = snapshotSentinel(sentinelRows[0], parsed.publicationId);
  if (selected === null) return { outcome: "integrity_failure" };
  const candidates = rows.filter((row) => row !== sentinelRows[0]);
  if (candidates.length === 0)
    return {
      outcome: "not_found",
      publicationId: parsed.publicationId,
      schemaVersion: selected.schemaVersion,
    };
  if (candidates.length !== 1) return { outcome: "integrity_failure" };

  const row = snapshotModelRow(candidates[0]);
  if (row === null) return { outcome: "integrity_failure" };
  if (
    row.publication_id !== parsed.publicationId ||
    row.schema_version !== selected.schemaVersion ||
    row.model_id !== parsed.modelId ||
    row.resource_json === null ||
    row.resource_json_bytes > MODEL_DETAIL_MAX_RESOURCE_BYTES ||
    UTF8.encode(row.resource_json).byteLength !== row.resource_json_bytes
  )
    return { outcome: "integrity_failure" };

  let value: unknown;
  let computedHash: string;
  try {
    value = JSON.parse(row.resource_json) as unknown;
    computedHash = await hashPublicationResourceContent({
      resourceType: "model",
      resourceId: row.model_id,
      resourceJson: row.resource_json,
    });
  } catch {
    return { outcome: "integrity_failure" };
  }
  if (
    !checkModelContract(value) ||
    value.model_id !== row.model_id ||
    computedHash !== row.content_hash
  )
    return { outcome: "integrity_failure" };

  return {
    outcome: "model",
    model: value,
    publicationId: parsed.publicationId,
    schemaVersion: selected.schemaVersion,
  };
};
