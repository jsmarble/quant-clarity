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

const MODEL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MODEL_SLUG_MAX_CHARACTERS = 128;
const MODEL_SLUG_PROJECTION_VERSION = "model-slug@1" as const;

/**
 * The V2 read keeps the V1 publication-continuity boundary, but requires the
 * schema-1.13 archived Model-slug authority. The authority sentinel is
 * independent of a mapping hit, so a valid miss cannot be confused with a
 * publication that lost its seal or sidecar proof.
 */
export const MODEL_DETAIL_V2_SELECT_SQL = `
WITH ${RETAINED_HOT_REFERENCE_CTE_SQL}, clock AS (
  SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now_ms
), eligible_publication AS (
  SELECT
    publication.publication_id,
    publication.schema_version,
    schema.schema_version AS serving_schema_version
  FROM serving_schema_metadata AS schema
  JOIN publication_head AS head ON head.singleton = 1
  JOIN publication AS publication
    ON publication.publication_id = ?1
  JOIN publication_closure_seal AS seal
    ON seal.publication_id = publication.publication_id
   AND seal.closure_hash = publication.closure_hash
   AND seal.resource_count = publication.resource_count
  JOIN publication_model_slug_artifact_proof AS proof
    ON proof.publication_id = publication.publication_id
   AND proof.staging_revision = seal.staging_revision
   AND proof.artifact_version = 'model-slug-history-artifact@1'
   AND proof.acquisition_version = 'model-slug-history-canonical@1'
   AND proof.projection_version = 'model-slug@1'
   AND proof.base_bundle_hash = seal.bundle_hash
   AND proof.closure_hash = seal.closure_hash
   AND proof.publication_boundary_ms = publication.generated_at_ms
   AND proof.current_mapping_count = proof.model_count
   AND proof.mapping_count =
     proof.current_mapping_count + proof.historical_mapping_count
  CROSS JOIN retained_reference AS retained
  CROSS JOIN clock
  WHERE schema.singleton = 1
    AND schema.schema_version = '1.13.0'
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
), matched_mapping AS (
  SELECT
    mapping.publication_id,
    mapping.slug,
    mapping.target_resource_type,
    mapping.model_id,
    mapping.projection_version,
    mapping.resolution,
    mapping.target_content_hash
  FROM eligible_publication AS eligible
  JOIN publication_model_slug_mapping AS mapping
    INDEXED BY publication_model_slug_current_model_idx
    ON mapping.publication_id = eligible.publication_id
   AND mapping.model_id = ?4
   AND mapping.resolution = 'current'
  WHERE ?3 = 'stable_id'
  UNION ALL
  SELECT
    mapping.publication_id,
    mapping.slug,
    mapping.target_resource_type,
    mapping.model_id,
    mapping.projection_version,
    mapping.resolution,
    mapping.target_content_hash
  FROM eligible_publication AS eligible
  JOIN publication_model_slug_mapping AS mapping
    INDEXED BY publication_model_slug_exact_idx
    ON mapping.publication_id = eligible.publication_id
   AND mapping.slug = ?4
  WHERE ?3 = 'slug'
), candidate AS (
  SELECT
    matched.publication_id,
    eligible.schema_version,
    eligible.serving_schema_version,
    resource.resource_id AS model_id,
    resource.content_hash,
    length(CAST(resource.resource_json AS BLOB)) AS resource_json_bytes,
    CASE
      WHEN length(CAST(resource.resource_json AS BLOB)) <= ?5
      THEN resource.resource_json
      ELSE NULL
    END AS resource_json,
    matched.resolution AS matched_resolution,
    matched.slug AS matched_slug,
    current.slug AS canonical_slug,
    current.projection_version
  FROM matched_mapping AS matched
  JOIN eligible_publication AS eligible
    ON eligible.publication_id = matched.publication_id
  JOIN publication_model_slug_mapping AS current
    INDEXED BY publication_model_slug_current_model_idx
    ON current.publication_id = matched.publication_id
   AND current.model_id = matched.model_id
   AND current.resolution = 'current'
  JOIN publication_resource AS resource
    INDEXED BY publication_resource_lookup_idx
    ON resource.publication_id = matched.publication_id
   AND resource.resource_type = 'model'
   AND resource.resource_id = matched.model_id
  WHERE matched.target_resource_type = 'model'
    AND current.target_resource_type = 'model'
    AND matched.projection_version = 'model-slug@1'
    AND current.projection_version = 'model-slug@1'
    AND matched.target_content_hash = resource.content_hash
    AND current.target_content_hash = resource.content_hash
    AND CAST(current.slug AS BLOB) = CASE
      WHEN json_valid(resource.resource_json) = 1
      THEN CAST(json_extract(resource.resource_json, '$.slug.value') AS BLOB)
      ELSE NULL
    END
)
SELECT
  0 AS row_ordinal,
  'slug_authority' AS row_kind,
  eligible.publication_id,
  eligible.schema_version,
  eligible.serving_schema_version,
  NULL AS model_id,
  NULL AS content_hash,
  0 AS resource_json_bytes,
  NULL AS resource_json,
  NULL AS matched_resolution,
  NULL AS matched_slug,
  NULL AS canonical_slug,
  NULL AS projection_version,
  (SELECT count(*) FROM matched_mapping) AS matched_mapping_count,
  CASE WHEN ?3 = 'stable_id' THEN (
    SELECT count(*)
    FROM publication_resource AS requested
      INDEXED BY publication_resource_lookup_idx
    WHERE requested.publication_id = eligible.publication_id
      AND requested.resource_type = 'model'
      AND requested.resource_id = ?4
  ) ELSE 0 END AS requested_model_count
FROM eligible_publication AS eligible
UNION ALL
SELECT
  1 AS row_ordinal,
  'model' AS row_kind,
  candidate.publication_id,
  candidate.schema_version,
  candidate.serving_schema_version,
  candidate.model_id,
  candidate.content_hash,
  candidate.resource_json_bytes,
  candidate.resource_json,
  candidate.matched_resolution,
  candidate.matched_slug,
  candidate.canonical_slug,
  candidate.projection_version,
  NULL AS matched_mapping_count,
  NULL AS requested_model_count
FROM candidate
ORDER BY row_ordinal ASC
LIMIT 2
`;

export type ModelDetailLookupProvenance = Readonly<{
  matchedBy: "stable_id" | "current_slug" | "historical_slug";
  canonicalSlug: string;
  projectionVersion: typeof MODEL_SLUG_PROJECTION_VERSION;
}>;

export type ReadModelDetailV2Input = Readonly<{
  audience: typeof AUDIENCE;
  bookmark: string;
  environment: "local" | "preview" | "production" | "test";
  envelope: unknown;
  lookup: Readonly<{
    kind: "slug" | "stable_id";
    value: string;
  }>;
  requiredAvailableUntilMs: number;
  version: 2;
}>;

export type ReadModelDetailV2Outcome =
  | Readonly<{
      lookupProvenance: ModelDetailLookupProvenance;
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

type ParsedV2Input = Readonly<{
  bookmark: string;
  identifier: string;
  identifierKind: "slug" | "stable_id";
  publicationId: string;
  requiredAvailableUntilMs: number;
}>;

const parseV2Input = (
  value: unknown,
  protectedEnvironment: unknown,
): ParsedV2Input | null => {
  const outer = ownDataRecord(value, [
    "audience",
    "bookmark",
    "envelope",
    "environment",
    "lookup",
    "requiredAvailableUntilMs",
    "version",
  ]);
  if (
    outer?.version !== 2 ||
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
  const lookup = ownDataRecord(outer.lookup, ["kind", "value"]);
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
    (lookup?.kind !== "stable_id" && lookup?.kind !== "slug") ||
    typeof lookup.value !== "string" ||
    lookup.value !== operation.identifier
  )
    return null;

  const identifierKind =
    lookup.kind === "stable_id" && MODEL_ID.test(lookup.value)
      ? "stable_id"
      : lookup.kind === "slug" &&
          lookup.value.length <= MODEL_SLUG_MAX_CHARACTERS &&
          UTF8.encode(lookup.value).byteLength <= MODEL_SLUG_MAX_CHARACTERS &&
          MODEL_SLUG.test(lookup.value)
        ? "slug"
        : null;
  if (identifierKind === null) return null;
  return {
    bookmark: outer.bookmark,
    identifier: lookup.value,
    identifierKind,
    publicationId: envelope.publicationId,
    requiredAvailableUntilMs: outer.requiredAvailableUntilMs,
  };
};

type V2AuthorityRow = Readonly<{
  canonical_slug: null;
  content_hash: null;
  matched_mapping_count: 0 | 1;
  matched_resolution: null;
  matched_slug: null;
  model_id: null;
  projection_version: null;
  publication_id: string;
  requested_model_count: 0 | 1;
  resource_json: null;
  resource_json_bytes: 0;
  row_kind: "slug_authority";
  row_ordinal: 0;
  schema_version: string;
  serving_schema_version: "1.13.0";
}>;

type V2ModelRow = Readonly<{
  canonical_slug: string;
  content_hash: string;
  matched_mapping_count: null;
  matched_resolution: "current" | "historical";
  matched_slug: string;
  model_id: string;
  projection_version: typeof MODEL_SLUG_PROJECTION_VERSION;
  publication_id: string;
  requested_model_count: null;
  resource_json: string | null;
  resource_json_bytes: number;
  row_kind: "model";
  row_ordinal: 1;
  schema_version: string;
  serving_schema_version: "1.13.0";
}>;

const V2_ROW_KEYS = [
  "canonical_slug",
  "content_hash",
  "matched_mapping_count",
  "matched_resolution",
  "matched_slug",
  "model_id",
  "projection_version",
  "publication_id",
  "requested_model_count",
  "resource_json",
  "resource_json_bytes",
  "row_kind",
  "row_ordinal",
  "schema_version",
  "serving_schema_version",
] as const;

const snapshotV2Authority = (
  value: unknown,
  publicationId: string,
): V2AuthorityRow | null => {
  const row = ownDataRecord(value, V2_ROW_KEYS);
  return row?.row_ordinal === 0 &&
    row.row_kind === "slug_authority" &&
    row.publication_id === publicationId &&
    validSchemaVersion(row.schema_version) &&
    row.serving_schema_version === "1.13.0" &&
    row.model_id === null &&
    row.content_hash === null &&
    row.resource_json_bytes === 0 &&
    row.resource_json === null &&
    row.matched_resolution === null &&
    row.matched_slug === null &&
    row.canonical_slug === null &&
    row.projection_version === null &&
    (row.matched_mapping_count === 0 || row.matched_mapping_count === 1) &&
    (row.requested_model_count === 0 || row.requested_model_count === 1)
    ? (row as V2AuthorityRow)
    : null;
};

const snapshotV2Model = (value: unknown): V2ModelRow | null => {
  const row = ownDataRecord(value, V2_ROW_KEYS);
  if (
    row?.row_ordinal !== 1 ||
    row.row_kind !== "model" ||
    typeof row.publication_id !== "string" ||
    !PUBLICATION_ID.test(row.publication_id) ||
    !validSchemaVersion(row.schema_version) ||
    row.serving_schema_version !== "1.13.0" ||
    typeof row.model_id !== "string" ||
    !MODEL_ID.test(row.model_id) ||
    typeof row.content_hash !== "string" ||
    !SHA256.test(row.content_hash) ||
    typeof row.resource_json_bytes !== "number" ||
    !Number.isSafeInteger(row.resource_json_bytes) ||
    row.resource_json_bytes < 0 ||
    (typeof row.resource_json !== "string" && row.resource_json !== null) ||
    (row.matched_resolution !== "current" &&
      row.matched_resolution !== "historical") ||
    typeof row.matched_slug !== "string" ||
    row.matched_slug.length > MODEL_SLUG_MAX_CHARACTERS ||
    !MODEL_SLUG.test(row.matched_slug) ||
    typeof row.canonical_slug !== "string" ||
    row.canonical_slug.length > MODEL_SLUG_MAX_CHARACTERS ||
    !MODEL_SLUG.test(row.canonical_slug) ||
    row.projection_version !== MODEL_SLUG_PROJECTION_VERSION ||
    row.matched_mapping_count !== null ||
    row.requested_model_count !== null
  )
    return null;
  return row as V2ModelRow;
};

export const readModelDetailV2 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  input: unknown,
): Promise<ReadModelDetailV2Outcome> => {
  const parsed = parseV2Input(input, protectedEnvironment);
  if (parsed === null) return { outcome: "integrity_failure" };

  let rows: readonly unknown[];
  try {
    const result: unknown = await database
      .withSession(parsed.bookmark)
      .prepare(MODEL_DETAIL_V2_SELECT_SQL)
      .bind(
        parsed.publicationId,
        parsed.requiredAvailableUntilMs,
        parsed.identifierKind,
        parsed.identifier,
        MODEL_DETAIL_MAX_RESOURCE_BYTES,
      )
      .all<V2AuthorityRow | V2ModelRow>();
    const snapshot = successfulRows(result);
    if (snapshot === null) return { outcome: "read_failure" };
    if (snapshot === "too_many") return { outcome: "integrity_failure" };
    rows = snapshot;
  } catch {
    return { outcome: "read_failure" };
  }

  const authorities = rows.filter(
    (row) => snapshotV2Authority(row, parsed.publicationId) !== null,
  );
  if (authorities.length !== 1) return { outcome: "integrity_failure" };
  const authority = snapshotV2Authority(authorities[0], parsed.publicationId);
  if (authority === null) return { outcome: "integrity_failure" };
  if (
    (parsed.identifierKind === "slug" &&
      authority.requested_model_count !== 0) ||
    (parsed.identifierKind === "stable_id" &&
      authority.requested_model_count !== authority.matched_mapping_count)
  )
    return { outcome: "integrity_failure" };

  const candidates = rows.filter((row) => row !== authorities[0]);
  if (candidates.length === 0) {
    if (
      authority.matched_mapping_count !== 0 ||
      authority.requested_model_count !== 0
    )
      return { outcome: "integrity_failure" };
    return {
      outcome: "not_found",
      publicationId: parsed.publicationId,
      schemaVersion: authority.schema_version,
    };
  }
  if (candidates.length !== 1 || authority.matched_mapping_count !== 1)
    return { outcome: "integrity_failure" };

  const row = snapshotV2Model(candidates[0]);
  if (row === null) return { outcome: "integrity_failure" };
  if (
    row.publication_id !== parsed.publicationId ||
    row.schema_version !== authority.schema_version ||
    row.resource_json === null ||
    row.resource_json_bytes > MODEL_DETAIL_MAX_RESOURCE_BYTES ||
    UTF8.encode(row.resource_json).byteLength !== row.resource_json_bytes ||
    (parsed.identifierKind === "slug" &&
      row.matched_slug !== parsed.identifier) ||
    (parsed.identifierKind === "stable_id" &&
      (row.model_id !== parsed.identifier ||
        row.matched_resolution !== "current"))
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
    value.slug.state !== "known" ||
    value.slug.value !== row.canonical_slug ||
    computedHash !== row.content_hash
  )
    return { outcome: "integrity_failure" };

  const matchedBy =
    parsed.identifierKind === "stable_id"
      ? "stable_id"
      : row.matched_resolution === "current"
        ? "current_slug"
        : "historical_slug";
  return {
    outcome: "model",
    lookupProvenance: {
      matchedBy,
      canonicalSlug: row.canonical_slug,
      projectionVersion: MODEL_SLUG_PROJECTION_VERSION,
    },
    model: value,
    publicationId: parsed.publicationId,
    schemaVersion: authority.schema_version,
  };
};
