import type {
  QueryServiceEnvelope,
  ReadDatasetMetadataV1Outcome,
} from "@quant-clarity/api-core";
import {
  MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS,
  type DatasetMetadata,
} from "@quant-clarity/contracts";
import {
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  normalizeExactSearchName,
  PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
  type DatasetMetadataSummaryProjection,
  verifyDatasetMetadataSummaryHash,
} from "@quant-clarity/publication-core";

import {
  ModelVariantExactNameError,
  readModelVariantExactNamePage,
  type ModelVariantExactNamePage,
} from "./model-variant-exact-name.js";
import {
  ProviderExactNameError,
  readProviderExactNamePage,
  type ProviderExactNamePage,
} from "./provider-exact-name.js";
import {
  ProviderModelIdExactError,
  readProviderModelIdExactPage,
  type ProviderModelIdExactPage,
} from "./provider-model-id-exact.js";
import {
  EXACT_CANONICAL_MARKER,
  EXACT_PROVIDER_MARKER,
  EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER,
  EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
  MergedExactSearchError,
  readMergedExactSearchPage,
  type MergedExactSearchContinuation,
  type MergedExactSearchPage,
} from "./merged-exact-search.js";
import {
  RETAINED_HOT_FROM_INDEX,
  RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS,
  RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS,
  RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS,
  RETAINED_HOT_PUBLICATION_WINDOW_MS,
  RETAINED_HOT_REFERENCE_CTE_SQL,
  RETAINED_HOT_ROLLBACK_INDEX,
} from "./retained-hot-publication.js";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const PROVIDER_ID = new RegExp(`^prv_${UUID_V4}$`, "u");
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const VARIANT_ID = new RegExp(`^var_${UUID_V4}$`, "u");
const FAMILY_ID = new RegExp(`^fam_${UUID_V4}$`, "u");
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UTF8 = new TextEncoder();
const ENVIRONMENTS = new Set(["local", "preview", "production", "test"]);
const AUDIENCE = "quantclarity-catalog-query-v1" as const;
const SEMVER =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const MAX_METADATA_RESPONSE_BYTES = 16 * 1024;
const MAX_PUBLIC_API_ORIGIN_BYTES = 2048;

const METHODOLOGY_REGISTRY: Readonly<
  Record<string, Readonly<{ effectiveAt: string; path: string }>>
> = Object.freeze({
  "1.0.0": Object.freeze({
    effectiveAt: "2026-08-01T00:00:00.000Z",
    path: "/v1/methodologies/1.0.0",
  }),
});

export const DATASET_METADATA_SELECT_SQL = `
WITH ${RETAINED_HOT_REFERENCE_CTE_SQL}, clock AS (
  SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now_ms
), eligible_publication AS (
  SELECT
    publication.publication_id,
    publication.schema_version,
    publication.methodology_version,
    publication.precision_normalization_version,
    publication.precision_display_order_version,
    publication.price_policy_version,
    publication.generated_at_ms,
    publication.activated_at_ms,
    publication.closure_hash AS publication_closure_hash,
    seal.closure_hash AS sealed_closure_hash,
    seal.resource_count AS sealed_resource_count,
    seal.provider_slice_count AS sealed_provider_slice_count,
    seal.provider_slice_hash AS sealed_provider_slice_hash,
    summary.summary_version,
    summary.closure_hash AS summary_closure_hash,
    summary.source_resource_count,
    summary.provider_slice_count AS summary_provider_slice_count,
    summary.provider_slice_hash AS summary_provider_slice_hash,
    summary.active_model_count AS active_models,
    summary.active_offering_count AS active_offerings,
    summary.active_provider_count AS active_providers,
    summary.has_stale_provider_slices,
    summary.has_unavailable_provider_slices,
    summary.summary_hash
  FROM publication
  JOIN publication_head AS head ON head.singleton = 1
  JOIN publication_closure_seal AS seal
    ON seal.publication_id = publication.publication_id
    AND seal.closure_hash = publication.closure_hash
  JOIN publication_dataset_metadata_summary AS summary
    ON summary.publication_id = publication.publication_id
    AND summary.summary_version = '1.0.0'
    AND summary.closure_hash = publication.closure_hash
    AND summary.closure_hash = seal.closure_hash
    AND summary.source_resource_count = publication.resource_count
    AND summary.source_resource_count = seal.resource_count
    AND summary.provider_slice_count = seal.provider_slice_count
    AND summary.provider_slice_hash = seal.provider_slice_hash
  CROSS JOIN retained_reference
  CROSS JOIN clock
  WHERE publication.publication_id = ?1
    AND ?2 > clock.now_ms - ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)}
    AND ?2 <= clock.now_ms + ${String(RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS)}
    AND (
      (
        publication.publication_id = head.active_publication_id
        AND publication.state = 'active'
      ) OR (
        publication.publication_id = head.rollback_candidate_publication_id
        AND publication.state IN ('superseded', 'rolled_back')
      ) OR (
        publication.state IN ('superseded', 'rolled_back')
        AND retained_reference.latest_head_reference_ms BETWEEN 0 AND
          clock.now_ms + ${String(RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS)}
        AND retained_reference.latest_head_reference_ms >
          ?2 + ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)} -
            ${String(RETAINED_HOT_PUBLICATION_WINDOW_MS)}
      )
    )
)
SELECT
  eligible.publication_id,
  eligible.schema_version,
  eligible.methodology_version,
  eligible.precision_normalization_version,
  eligible.precision_display_order_version,
  eligible.price_policy_version,
  eligible.generated_at_ms,
  eligible.activated_at_ms,
  eligible.publication_closure_hash,
  eligible.sealed_closure_hash,
  eligible.sealed_resource_count,
  eligible.sealed_provider_slice_count,
  eligible.sealed_provider_slice_hash,
  eligible.summary_version,
  eligible.summary_closure_hash,
  eligible.source_resource_count,
  eligible.summary_provider_slice_count,
  eligible.summary_provider_slice_hash,
  eligible.active_models,
  eligible.active_offerings,
  eligible.active_providers,
  eligible.has_stale_provider_slices,
  eligible.has_unavailable_provider_slices,
  eligible.summary_hash
FROM eligible_publication AS eligible
LIMIT 2
`;

export const RESOLVE_PUBLICATION_SELECT_SQL = `
SELECT
  head.active_publication_id AS current_publication_id,
  head.rollback_candidate_publication_id,
  active_publication.state AS current_publication_state,
  CASE
    WHEN ?1 IS NULL THEN head.active_publication_id
    WHEN ?1 = head.active_publication_id THEN head.active_publication_id
    WHEN ?1 = head.rollback_candidate_publication_id
      AND requested_publication.state IN ('superseded', 'rolled_back')
    THEN head.rollback_candidate_publication_id
    ELSE NULL
  END AS selected_publication_id,
  CASE
    WHEN ?1 IS NULL OR ?1 = head.active_publication_id THEN active_publication.state
    WHEN ?1 = head.rollback_candidate_publication_id THEN requested_publication.state
    ELSE NULL
  END AS selected_publication_state
FROM publication_head AS head
LEFT JOIN publication AS active_publication
  ON active_publication.publication_id = head.active_publication_id
LEFT JOIN publication AS requested_publication
  ON requested_publication.publication_id = ?1
WHERE head.singleton = 1
LIMIT 2
`;

export const RESOLVE_PUBLICATION_V2_SELECT_SQL = `
WITH clock AS (
  SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS now_ms
), requested AS (
  SELECT
    publication.publication_id,
    publication.state,
    max(
      coalesce((
        SELECT history.switched_at_ms
        FROM publication_switch_history AS history
          INDEXED BY ${RETAINED_HOT_FROM_INDEX}
        WHERE history.from_publication_id = publication.publication_id
        ORDER BY history.switched_at_ms DESC, history.new_generation DESC
        LIMIT 1
      ), -1),
      coalesce((
        SELECT history.switched_at_ms
        FROM publication_switch_history AS history
          INDEXED BY ${RETAINED_HOT_ROLLBACK_INDEX}
        WHERE history.expected_prior_rollback_candidate_publication_id =
          publication.publication_id
        ORDER BY history.switched_at_ms DESC, history.new_generation DESC
        LIMIT 1
      ), -1)
    ) AS latest_head_reference_ms
  FROM publication AS publication
  WHERE publication.publication_id = ?1
), decision AS (
  SELECT
    head.active_publication_id AS current_publication_id,
    head.rollback_candidate_publication_id,
    active_publication.state AS current_publication_state,
    clock.now_ms AS database_now_ms,
    CASE
      WHEN ?2 > clock.now_ms - ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)}
        AND ?2 <= clock.now_ms + ${String(RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS)}
      THEN 1 ELSE 0
    END AS horizon_valid,
    requested.state AS requested_publication_state,
    requested.latest_head_reference_ms,
    CASE
      WHEN NOT (
        ?2 > clock.now_ms - ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)}
        AND ?2 <= clock.now_ms + ${String(RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS)}
      ) THEN NULL
      WHEN ?1 IS NULL THEN head.active_publication_id
      WHEN ?1 = head.active_publication_id THEN head.active_publication_id
      WHEN ?1 = head.rollback_candidate_publication_id
        AND requested.state IN ('superseded', 'rolled_back')
      THEN head.rollback_candidate_publication_id
      WHEN requested.state IN ('superseded', 'rolled_back')
        AND requested.latest_head_reference_ms BETWEEN 0 AND
          clock.now_ms + ${String(RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS)}
        AND requested.latest_head_reference_ms >
          ?2 + ${String(RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS)} -
            ${String(RETAINED_HOT_PUBLICATION_WINDOW_MS)}
      THEN requested.publication_id
      ELSE NULL
    END AS selected_publication_id
  FROM publication_head AS head
  CROSS JOIN clock
  LEFT JOIN publication AS active_publication
    ON active_publication.publication_id = head.active_publication_id
  LEFT JOIN requested ON true
  WHERE head.singleton = 1
  LIMIT 2
)
SELECT
  current_publication_id,
  rollback_candidate_publication_id,
  current_publication_state,
  database_now_ms,
  horizon_valid,
  selected_publication_id,
  CASE WHEN selected_publication_id IS NULL THEN NULL
    WHEN selected_publication_id = current_publication_id THEN 'active'
    ELSE requested_publication_state
  END AS selected_publication_state,
  CASE WHEN selected_publication_id IS NULL OR
    selected_publication_id = current_publication_id OR
    selected_publication_id = rollback_candidate_publication_id
    THEN NULL ELSE latest_head_reference_ms
  END AS selected_latest_head_reference_ms
FROM decision
`;

export type QueryRpcEnvironment = "local" | "preview" | "production" | "test";

export type ResolvePublicationV1Input = Readonly<{
  version: 1;
  audience: typeof AUDIENCE;
  environment: QueryRpcEnvironment;
  requestedPublicationId: string | null;
}>;

export type ResolvePublicationV1Outcome =
  | Readonly<{
      outcome: "selected";
      publicationId: string;
      bookmark: string;
    }>
  | Readonly<{
      outcome: "publication_expired";
      currentPublicationId: string;
    }>
  | Readonly<{ outcome: "publication_not_ready" }>
  | Readonly<{ outcome: "integrity_failure" }>
  | Readonly<{ outcome: "read_failure" }>;

export type ResolvePublicationV2Input = Readonly<{
  version: 2;
  audience: typeof AUDIENCE;
  environment: QueryRpcEnvironment;
  requestedPublicationId: string | null;
  requiredAvailableUntilMs: number;
}>;

export type ResolvePublicationV2Outcome =
  | Readonly<{
      outcome: "selected";
      publicationId: string;
      bookmark: string;
      requiredAvailableUntilMs: number;
    }>
  | Exclude<ResolvePublicationV1Outcome, { outcome: "selected" }>;

export type ReadProviderExactNameTierV1Input = Readonly<{
  version: 1;
  audience: typeof AUDIENCE;
  environment: QueryRpcEnvironment;
  bookmark: string;
  envelope: QueryServiceEnvelope;
}>;

export type ReadProviderExactNameTierV1Outcome =
  | Readonly<{ outcome: "page"; page: ProviderExactNamePage }>
  | Readonly<{ outcome: "integrity_failure" }>
  | Readonly<{ outcome: "read_failure" }>;

export type ReadModelVariantExactNameTierV1Input = Readonly<{
  version: 1;
  audience: typeof AUDIENCE;
  environment: QueryRpcEnvironment;
  bookmark: string;
  envelope: QueryServiceEnvelope;
}>;

export type ReadModelVariantExactNameTierV1Outcome =
  | Readonly<{ outcome: "page"; page: ModelVariantExactNamePage }>
  | Readonly<{ outcome: "integrity_failure" }>
  | Readonly<{ outcome: "read_failure" }>;

export type ReadProviderModelIdExactTierV1Input = Readonly<{
  version: 1;
  audience: typeof AUDIENCE;
  environment: QueryRpcEnvironment;
  bookmark: string;
  envelope: QueryServiceEnvelope;
}>;

export type ReadProviderModelIdExactTierV1Outcome =
  | Readonly<{ outcome: "page"; page: ProviderModelIdExactPage }>
  | Readonly<{ outcome: "integrity_failure" }>
  | Readonly<{ outcome: "read_failure" }>;

export type ReadMergedExactSearchV1Input = Readonly<{
  version: 1;
  audience: typeof AUDIENCE;
  environment: QueryRpcEnvironment;
  bookmark: string;
  envelope: QueryServiceEnvelope;
}>;

export type ReadMergedExactSearchV1Outcome =
  | Readonly<{ outcome: "page"; page: MergedExactSearchPage }>
  | Readonly<{ outcome: "integrity_failure" }>
  | Readonly<{ outcome: "read_failure" }>;

export type ReadMergedExactSearchV2Input = Readonly<{
  version: 2;
  audience: typeof AUDIENCE;
  environment: QueryRpcEnvironment;
  bookmark: string;
  requiredAvailableUntilMs: number;
  envelope: QueryServiceEnvelope;
}>;

export type ReadMergedExactSearchV2Outcome = ReadMergedExactSearchV1Outcome;

type ResolveRow = Readonly<{
  current_publication_id: string;
  rollback_candidate_publication_id: string | null;
  current_publication_state: string | null;
  selected_publication_id: string | null;
  selected_publication_state: string | null;
}>;

type ResolveV2Row = ResolveRow &
  Readonly<{
    database_now_ms: number;
    horizon_valid: 0 | 1;
    selected_latest_head_reference_ms: number | null;
  }>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    expected.every((key, index) => actual[index] === key)
  );
};

const environment = (value: unknown): value is QueryRpcEnvironment =>
  typeof value === "string" && ENVIRONMENTS.has(value);

const closedFilters = (
  value: unknown,
): value is Readonly<Record<string, "provider">> => {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 0 ||
    (keys.length === 1 &&
      keys[0] === "record_type" &&
      value.record_type === "provider")
  );
};

const normalizedQuery = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    value.includes("\u0000") ||
    UTF8.encode(value).byteLength === 0 ||
    UTF8.encode(value).byteLength > 200
  )
    return false;
  try {
    return value === value.normalize("NFC").trim().replace(/\s+/gu, " ");
  } catch {
    return false;
  }
};

const normalizedModelVariantQuery = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    value.length > MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS * 2 ||
    Array.from(value).length === 0 ||
    Array.from(value).length > MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS ||
    UTF8.encode(value).byteLength > MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS * 4
  )
    return false;
  try {
    if (value !== value.normalize("NFC").trim()) return false;
    const normalized = normalizeExactSearchName(value);
    return (
      UTF8.encode(normalized).byteLength > 0 &&
      UTF8.encode(normalized).byteLength <=
        MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES
    );
  } catch {
    return false;
  }
};

const resolveInput = (value: unknown): value is ResolvePublicationV1Input =>
  record(value) &&
  exactKeys(value, [
    "audience",
    "environment",
    "requestedPublicationId",
    "version",
  ]) &&
  value.version === 1 &&
  value.audience === AUDIENCE &&
  environment(value.environment) &&
  (value.requestedPublicationId === null ||
    (typeof value.requestedPublicationId === "string" &&
      PUBLICATION_ID.test(value.requestedPublicationId)));

const parseResolveV2Input = (
  value: unknown,
): ResolvePublicationV2Input | null => {
  const snapshot = ownDataRecord(value, [
    "audience",
    "environment",
    "requestedPublicationId",
    "requiredAvailableUntilMs",
    "version",
  ]);
  if (
    snapshot?.version !== 2 ||
    snapshot.audience !== AUDIENCE ||
    !environment(snapshot.environment) ||
    (snapshot.requestedPublicationId !== null &&
      (typeof snapshot.requestedPublicationId !== "string" ||
        !PUBLICATION_ID.test(snapshot.requestedPublicationId))) ||
    typeof snapshot.requiredAvailableUntilMs !== "number" ||
    !Number.isSafeInteger(snapshot.requiredAvailableUntilMs) ||
    snapshot.requiredAvailableUntilMs < 0
  )
    return null;
  return {
    version: 2,
    audience: AUDIENCE,
    environment: snapshot.environment,
    requestedPublicationId: snapshot.requestedPublicationId,
    requiredAvailableUntilMs: snapshot.requiredAvailableUntilMs,
  };
};

const validEnvelope = (
  value: unknown,
  outerEnvironment: QueryRpcEnvironment,
): value is QueryServiceEnvelope => {
  if (
    !record(value) ||
    !exactKeys(value, [
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
    ]) ||
    value.audience !== AUDIENCE ||
    value.version !== 1 ||
    value.environment !== outerEnvironment ||
    value.continuation !== null ||
    typeof value.publicationId !== "string" ||
    !PUBLICATION_ID.test(value.publicationId) ||
    !Number.isSafeInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > 20 ||
    !closedFilters(value.filters) ||
    !record(value.operation) ||
    !exactKeys(value.operation, ["kind"]) ||
    value.operation.kind !== "search" ||
    !Array.isArray(value.sort) ||
    value.sort.length !== 2 ||
    value.sort[0] !== "relevance" ||
    value.sort[1] !== "stable_id" ||
    !record(value.searchPlan)
  )
    return false;
  const plan = value.searchPlan;
  return (
    exactKeys(plan, [
      "filters",
      "kind",
      "limit",
      "query",
      "semanticCalls",
      "semanticCandidates",
      "semanticDegraded",
    ]) &&
    plan.kind === "exact_structured" &&
    plan.limit === value.limit &&
    normalizedQuery(plan.query) &&
    plan.semanticCalls === 0 &&
    plan.semanticCandidates === 0 &&
    plan.semanticDegraded === "disabled" &&
    closedFilters(plan.filters) &&
    JSON.stringify(plan.filters) === JSON.stringify(value.filters)
  );
};

const readInput = (value: unknown): value is ReadProviderExactNameTierV1Input =>
  record(value) &&
  exactKeys(value, [
    "audience",
    "bookmark",
    "envelope",
    "environment",
    "version",
  ]) &&
  value.version === 1 &&
  value.audience === AUDIENCE &&
  environment(value.environment) &&
  typeof value.bookmark === "string" &&
  value.bookmark.length > 0 &&
  value.bookmark.length <= 4096 &&
  value.bookmark !== "first-primary" &&
  value.bookmark !== "first-unconstrained" &&
  validEnvelope(value.envelope, value.environment);

const snapshotOwnRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    sortedExpected.some((key, index) => actualKeys[index] !== key)
  )
    return null;
  const source = value as Record<string, unknown>;
  const snapshot: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of expectedKeys) snapshot[key] = source[key];
  return snapshot;
};

const snapshotExactArray = (
  value: unknown,
  expectedLength: number,
): readonly unknown[] | null => {
  if (!Array.isArray(value)) return null;
  const length: number = value.length;
  if (length !== expectedLength) return null;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1)
    snapshot.push((value as readonly unknown[])[index]);
  return snapshot;
};

const snapshotModelVariantFilter = (
  value: unknown,
): "model" | "variant" | null | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Object.keys(value);
  if (keys.length === 0) return null;
  if (keys.length !== 1 || keys[0] !== "record_type") return undefined;
  const recordType = (value as Record<string, unknown>).record_type;
  return recordType === "model" || recordType === "variant"
    ? recordType
    : undefined;
};

type ParsedModelVariantReadInput = Readonly<{
  environment: QueryRpcEnvironment;
  bookmark: string;
  publicationId: string;
  query: string;
  recordType: "model" | "variant" | null;
  limit: number;
}>;

const parseModelVariantReadInput = (
  value: unknown,
): ParsedModelVariantReadInput | null => {
  try {
    const outer = snapshotOwnRecord(value, [
      "audience",
      "bookmark",
      "envelope",
      "environment",
      "version",
    ]);
    if (outer === null) return null;
    if (
      outer.version !== 1 ||
      outer.audience !== AUDIENCE ||
      !environment(outer.environment) ||
      typeof outer.bookmark !== "string" ||
      outer.bookmark.length === 0 ||
      outer.bookmark.length > 4096 ||
      outer.bookmark === "first-primary" ||
      outer.bookmark === "first-unconstrained"
    )
      return null;
    const envelope = snapshotOwnRecord(outer.envelope, [
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
    if (envelope === null) return null;
    if (
      envelope.audience !== AUDIENCE ||
      envelope.version !== 1 ||
      envelope.environment !== outer.environment ||
      envelope.continuation !== null ||
      typeof envelope.publicationId !== "string" ||
      !PUBLICATION_ID.test(envelope.publicationId) ||
      !Number.isSafeInteger(envelope.limit) ||
      (envelope.limit as number) < 1 ||
      (envelope.limit as number) > 20
    )
      return null;
    const recordType = snapshotModelVariantFilter(envelope.filters);
    const operation = snapshotOwnRecord(envelope.operation, ["kind"]);
    const sort = snapshotExactArray(envelope.sort, 2);
    const plan = snapshotOwnRecord(envelope.searchPlan, [
      "filters",
      "kind",
      "limit",
      "query",
      "semanticCalls",
      "semanticCandidates",
      "semanticDegraded",
    ]);
    if (
      recordType === undefined ||
      operation?.kind !== "search" ||
      sort?.[0] !== "relevance" ||
      sort[1] !== "stable_id" ||
      plan?.kind !== "exact_structured" ||
      plan.limit !== envelope.limit ||
      !normalizedModelVariantQuery(plan.query) ||
      plan.semanticCalls !== 0 ||
      plan.semanticCandidates !== 0 ||
      plan.semanticDegraded !== "disabled" ||
      snapshotModelVariantFilter(plan.filters) !== recordType
    )
      return null;
    return {
      environment: outer.environment,
      bookmark: outer.bookmark,
      publicationId: envelope.publicationId,
      query: plan.query,
      recordType,
      limit: envelope.limit as number,
    };
  } catch {
    return null;
  }
};

type ParsedProviderModelIdReadInput = Readonly<{
  environment: QueryRpcEnvironment;
  bookmark: string;
  publicationId: string;
  query: string;
  providerId: string | null;
  recordType: "model" | "variant" | null;
  limit: number;
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
    const actualKeys = Reflect.ownKeys(value);
    if (
      actualKeys.some((key) => typeof key !== "string") ||
      actualKeys.length !== expectedKeys.length ||
      [...expectedKeys]
        .sort()
        .some(
          (key, index) => [...(actualKeys as string[])].sort()[index] !== key,
        )
    )
      return null;
    const result: Record<string, unknown> = Object.create(null) as Record<
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
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
};

const ownDataArray = (
  value: unknown,
  expectedLength: number,
): readonly unknown[] | null => {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    )
      return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== expectedLength
    )
      return null;
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
    const result: unknown[] = [];
    for (let index = 0; index < expectedLength; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
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

const providerModelIdFilters = (
  value: unknown,
): Readonly<{
  providerId: string | null;
  recordType: "model" | "variant" | null;
  canonical: Readonly<Record<string, string>>;
}> | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.length > 2 ||
      keys.some((key) => key !== "provider" && key !== "record_type")
    )
      return null;
    const snapshot = ownDataRecord(value, keys as string[]);
    if (snapshot === null) return null;
    const provider = snapshot.provider;
    const recordType = snapshot.record_type;
    if (
      (provider !== undefined &&
        (typeof provider !== "string" || !PROVIDER_ID.test(provider))) ||
      (recordType !== undefined &&
        recordType !== "model" &&
        recordType !== "variant")
    )
      return null;
    const canonical: Record<string, string> = {};
    if (typeof provider === "string") canonical.provider = provider;
    if (recordType === "model" || recordType === "variant")
      canonical.record_type = recordType;
    return {
      providerId: typeof provider === "string" ? provider : null,
      recordType:
        recordType === "model" || recordType === "variant" ? recordType : null,
      canonical,
    };
  } catch {
    return null;
  }
};

const providerModelIdQuery = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    if (
      value !== value.normalize("NFC").trim() ||
      Array.from(value).length === 0 ||
      Array.from(value).some((scalar) => {
        const point = scalar.codePointAt(0);
        return point !== undefined && point >= 0xd800 && point <= 0xdfff;
      }) ||
      UTF8.encode(value).byteLength > 200
    )
      return false;
    let normalized = "";
    try {
      normalized = normalizeExactSearchName(value);
    } catch (error) {
      if (!(error instanceof RangeError)) return false;
    }
    return (
      UTF8.encode(normalized).byteLength <=
      PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES
    );
  } catch {
    return false;
  }
};

const parseProviderModelIdReadInput = (
  value: unknown,
): ParsedProviderModelIdReadInput | null => {
  const outer = ownDataRecord(value, [
    "audience",
    "bookmark",
    "envelope",
    "environment",
    "version",
  ]);
  if (
    outer?.version !== 1 ||
    outer.audience !== AUDIENCE ||
    !environment(outer.environment) ||
    typeof outer.bookmark !== "string" ||
    outer.bookmark.length === 0 ||
    outer.bookmark.length > 4096 ||
    outer.bookmark === "first-primary" ||
    outer.bookmark === "first-unconstrained"
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
  if (
    envelope?.audience !== AUDIENCE ||
    envelope.version !== 1 ||
    envelope.environment !== outer.environment ||
    envelope.continuation !== null ||
    typeof envelope.publicationId !== "string" ||
    !PUBLICATION_ID.test(envelope.publicationId) ||
    typeof envelope.limit !== "number" ||
    !Number.isSafeInteger(envelope.limit) ||
    envelope.limit < 1 ||
    envelope.limit > 20
  )
    return null;
  const filters = providerModelIdFilters(envelope.filters);
  const operation = ownDataRecord(envelope.operation, ["kind"]);
  const sort = ownDataArray(envelope.sort, 2);
  const plan = ownDataRecord(envelope.searchPlan, [
    "filters",
    "kind",
    "limit",
    "query",
    "semanticCalls",
    "semanticCandidates",
    "semanticDegraded",
  ]);
  const planFilters = providerModelIdFilters(plan?.filters);
  if (
    filters === null ||
    planFilters === null ||
    operation?.kind !== "search" ||
    sort?.[0] !== "relevance" ||
    sort[1] !== "stable_id" ||
    plan?.kind !== "exact_structured" ||
    plan.limit !== envelope.limit ||
    !providerModelIdQuery(plan.query) ||
    plan.semanticCalls !== 0 ||
    plan.semanticCandidates !== 0 ||
    plan.semanticDegraded !== "disabled" ||
    JSON.stringify(planFilters.canonical) !== JSON.stringify(filters.canonical)
  )
    return null;
  return {
    environment: outer.environment,
    bookmark: outer.bookmark,
    publicationId: envelope.publicationId,
    query: plan.query,
    providerId: filters.providerId,
    recordType: filters.recordType,
    limit: envelope.limit,
  };
};

type ParsedMergedExactSearchInput = Readonly<{
  environment: QueryRpcEnvironment;
  bookmark: string;
  publicationId: string;
  query: string;
  recordType: "model" | "variant" | "provider" | null;
  eligibilityProviderId: string | null;
  eligibilityStale: boolean | null;
  familyId: string | null;
  continuation: MergedExactSearchContinuation | null;
  limit: number;
  requiredAvailableUntilMs: number | null;
}>;

const mergedFilters = (
  value: unknown,
):
  | Readonly<{
      canonical: Readonly<Record<string, string | boolean>>;
      eligibilityProviderId: string | null;
      eligibilityStale: boolean | null;
      familyId: string | null;
      recordType: "model" | "variant" | "provider" | null;
    }>
  | undefined => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return undefined;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) return undefined;
    const filter = ownDataRecord(value, ownKeys as string[]);
    if (filter === null) return undefined;
    const keys = Object.keys(filter);
    if (
      keys.some(
        (key) =>
          key !== "family" &&
          key !== "provider" &&
          key !== "record_type" &&
          key !== "stale",
      )
    )
      return undefined;
    const hasFamily = Object.hasOwn(filter, "family");
    const hasProvider = Object.hasOwn(filter, "provider");
    const hasRecordType = Object.hasOwn(filter, "record_type");
    const hasStale = Object.hasOwn(filter, "stale");
    const family = filter.family;
    const provider = filter.provider;
    const recordType = filter.record_type;
    const stale = filter.stale;
    if (
      (hasFamily && (typeof family !== "string" || !FAMILY_ID.test(family))) ||
      (hasProvider &&
        (typeof provider !== "string" || !PROVIDER_ID.test(provider))) ||
      (hasRecordType &&
        recordType !== "model" &&
        recordType !== "variant" &&
        recordType !== "provider") ||
      (hasStale && typeof stale !== "boolean") ||
      ((hasProvider || hasFamily || hasStale) && recordType === "provider")
    )
      return undefined;
    const canonical: Record<string, string | boolean> = {};
    if (typeof family === "string") canonical.family = family;
    if (typeof provider === "string") canonical.provider = provider;
    if (typeof recordType === "string") canonical.record_type = recordType;
    if (typeof stale === "boolean") canonical.stale = stale;
    return Object.freeze({
      canonical: Object.freeze(canonical),
      eligibilityProviderId: typeof provider === "string" ? provider : null,
      eligibilityStale: typeof stale === "boolean" ? stale : null,
      familyId: typeof family === "string" ? family : null,
      recordType:
        recordType === "model" ||
        recordType === "variant" ||
        recordType === "provider"
          ? recordType
          : null,
    });
  } catch {
    return undefined;
  }
};

const mergedContinuation = (
  value: unknown,
): MergedExactSearchContinuation | null | undefined => {
  if (value === null) return null;
  const continuation = ownDataRecord(value, ["lastSortTuple", "stableId"]);
  const tuple = ownDataArray(continuation?.lastSortTuple, 2);
  const marker = tuple?.[0];
  if (
    continuation === null ||
    tuple === null ||
    (marker !== EXACT_CANONICAL_MARKER &&
      marker !== EXACT_PROVIDER_MODEL_ID_RAW_MARKER &&
      marker !== EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER &&
      marker !== EXACT_PROVIDER_MARKER) ||
    typeof continuation.stableId !== "string" ||
    tuple[1] !== continuation.stableId ||
    (marker === EXACT_PROVIDER_MARKER
      ? !PROVIDER_ID.test(continuation.stableId)
      : !MODEL_ID.test(continuation.stableId) &&
        !VARIANT_ID.test(continuation.stableId))
  )
    return undefined;
  return Object.freeze({
    tierMarker: marker,
    resourceId: continuation.stableId,
  });
};

const parseMergedExactSearchInput = (
  value: unknown,
  protocolVersion: 1 | 2 = 1,
): ParsedMergedExactSearchInput | null => {
  const outerKeys = [
    "audience",
    "bookmark",
    "envelope",
    "environment",
    "version",
  ];
  if (protocolVersion === 2) outerKeys.push("requiredAvailableUntilMs");
  const outer = ownDataRecord(value, outerKeys);
  if (
    outer?.version !== protocolVersion ||
    outer.audience !== AUDIENCE ||
    !environment(outer.environment) ||
    typeof outer.bookmark !== "string" ||
    outer.bookmark.length === 0 ||
    outer.bookmark.length > 4096 ||
    outer.bookmark === "first-primary" ||
    outer.bookmark === "first-unconstrained"
  )
    return null;
  const requiredAvailableUntilMs =
    protocolVersion === 2 ? outer.requiredAvailableUntilMs : null;
  if (
    requiredAvailableUntilMs !== null &&
    (typeof requiredAvailableUntilMs !== "number" ||
      !Number.isSafeInteger(requiredAvailableUntilMs) ||
      requiredAvailableUntilMs < 0)
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
  if (
    envelope?.audience !== AUDIENCE ||
    envelope.version !== 1 ||
    envelope.environment !== outer.environment ||
    typeof envelope.publicationId !== "string" ||
    !PUBLICATION_ID.test(envelope.publicationId) ||
    typeof envelope.limit !== "number" ||
    !Number.isSafeInteger(envelope.limit) ||
    envelope.limit < 1 ||
    envelope.limit > 20
  )
    return null;
  const filters = mergedFilters(envelope.filters);
  const continuation = mergedContinuation(envelope.continuation);
  const operation = ownDataRecord(envelope.operation, ["kind"]);
  const sort = ownDataArray(envelope.sort, 2);
  const plan = ownDataRecord(envelope.searchPlan, [
    "filters",
    "kind",
    "limit",
    "query",
    "semanticCalls",
    "semanticCandidates",
    "semanticDegraded",
  ]);
  const planFilters = mergedFilters(plan?.filters);
  if (
    filters === undefined ||
    continuation === undefined ||
    operation?.kind !== "search" ||
    sort?.[0] !== "relevance" ||
    sort[1] !== "stable_id" ||
    plan?.kind !== "exact_structured" ||
    plan.limit !== envelope.limit ||
    !providerModelIdQuery(plan.query) ||
    plan.semanticCalls !== 0 ||
    plan.semanticCandidates !== 0 ||
    plan.semanticDegraded !== "disabled" ||
    planFilters === undefined ||
    JSON.stringify(planFilters.canonical) !== JSON.stringify(filters.canonical)
  )
    return null;
  const marker = continuation?.tierMarker;
  let normalized = "";
  try {
    normalized = normalizeExactSearchName(plan.query);
  } catch (error) {
    if (!(error instanceof RangeError)) return null;
  }
  if (
    (filters.recordType === "provider" &&
      marker !== undefined &&
      marker !== EXACT_PROVIDER_MARKER) ||
    (filters.eligibilityProviderId !== null &&
      marker === EXACT_PROVIDER_MARKER) ||
    (filters.familyId !== null && marker === EXACT_PROVIDER_MARKER) ||
    (filters.eligibilityStale !== null && marker === EXACT_PROVIDER_MARKER) ||
    ((filters.recordType === "model" || filters.recordType === "variant") &&
      marker === EXACT_PROVIDER_MARKER) ||
    (filters.recordType === "model" &&
      continuation !== null &&
      !MODEL_ID.test(continuation.resourceId)) ||
    (filters.recordType === "variant" &&
      continuation !== null &&
      !VARIANT_ID.test(continuation.resourceId)) ||
    ((marker === EXACT_CANONICAL_MARKER ||
      marker === EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER) &&
      normalized.length === 0) ||
    (marker === EXACT_PROVIDER_MARKER &&
      (normalized.length === 0 || plan.query.includes("\u0000")))
  )
    return null;
  return {
    environment: outer.environment,
    bookmark: outer.bookmark,
    publicationId: envelope.publicationId,
    query: plan.query,
    recordType: filters.recordType,
    eligibilityProviderId: filters.eligibilityProviderId,
    eligibilityStale: filters.eligibilityStale,
    familyId: filters.familyId,
    continuation,
    limit: envelope.limit,
    requiredAvailableUntilMs,
  };
};

const d1Rows = (value: unknown): unknown[] | null => {
  if (!record(value) || value.success !== true || !Array.isArray(value.results))
    return null;
  return Array.from(value.results as readonly unknown[]);
};

type DatasetMetadataRow = Readonly<{
  publication_id: string;
  schema_version: string;
  methodology_version: string;
  precision_normalization_version: string;
  precision_display_order_version: string;
  price_policy_version: string;
  generated_at_ms: number;
  activated_at_ms: number;
  publication_closure_hash: string;
  sealed_closure_hash: string;
  sealed_resource_count: number;
  sealed_provider_slice_count: number;
  sealed_provider_slice_hash: string;
  summary_version: "1.0.0";
  summary_closure_hash: string;
  source_resource_count: number;
  summary_provider_slice_count: number;
  summary_provider_slice_hash: string;
  active_models: number;
  active_offerings: number;
  active_providers: number;
  has_stale_provider_slices: 0 | 1;
  has_unavailable_provider_slices: 0 | 1;
  summary_hash: string;
}>;

type ParsedDatasetMetadataInput = Readonly<{
  environment: QueryRpcEnvironment;
  bookmark: string;
  publicationId: string;
  requiredAvailableUntilMs: number;
}>;

const boundedVersion = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    return (
      Array.from(value).length >= 1 &&
      Array.from(value).length <= 64 &&
      !value.includes("\u0000") &&
      value === value.normalize("NFC") &&
      UTF8.encode(value).byteLength <= 256
    );
  } catch {
    return false;
  }
};

const parseDatasetMetadataInput = (
  value: unknown,
): ParsedDatasetMetadataInput | null => {
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
    !environment(outer.environment) ||
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
  if (
    envelope?.audience !== AUDIENCE ||
    envelope.version !== 1 ||
    envelope.environment !== outer.environment ||
    envelope.continuation !== null ||
    envelope.limit !== 25 ||
    typeof envelope.publicationId !== "string" ||
    !PUBLICATION_ID.test(envelope.publicationId) ||
    envelope.searchPlan !== null ||
    ownDataRecord(envelope.filters, []) === null ||
    ownDataArray(envelope.sort, 0) === null ||
    ownDataRecord(envelope.operation, ["kind"])?.kind !== "metadata"
  )
    return null;
  return {
    environment: outer.environment,
    bookmark: outer.bookmark,
    publicationId: envelope.publicationId,
    requiredAvailableUntilMs: outer.requiredAvailableUntilMs,
  };
};

const datasetMetadataRow = (value: unknown): value is DatasetMetadataRow => {
  if (
    !record(value) ||
    !exactKeys(value, [
      "activated_at_ms",
      "active_models",
      "active_offerings",
      "active_providers",
      "generated_at_ms",
      "has_stale_provider_slices",
      "has_unavailable_provider_slices",
      "methodology_version",
      "precision_display_order_version",
      "precision_normalization_version",
      "price_policy_version",
      "publication_closure_hash",
      "publication_id",
      "schema_version",
      "sealed_closure_hash",
      "sealed_provider_slice_count",
      "sealed_provider_slice_hash",
      "sealed_resource_count",
      "source_resource_count",
      "summary_closure_hash",
      "summary_hash",
      "summary_provider_slice_count",
      "summary_provider_slice_hash",
      "summary_version",
    ]) ||
    typeof value.publication_id !== "string" ||
    !PUBLICATION_ID.test(value.publication_id) ||
    typeof value.schema_version !== "string" ||
    !SEMVER.test(value.schema_version) ||
    !boundedVersion(value.methodology_version) ||
    !boundedVersion(value.precision_normalization_version) ||
    !boundedVersion(value.precision_display_order_version) ||
    !boundedVersion(value.price_policy_version) ||
    value.summary_version !== "1.0.0" ||
    typeof value.publication_closure_hash !== "string" ||
    !SHA256.test(value.publication_closure_hash) ||
    typeof value.sealed_closure_hash !== "string" ||
    !SHA256.test(value.sealed_closure_hash) ||
    typeof value.summary_closure_hash !== "string" ||
    !SHA256.test(value.summary_closure_hash) ||
    typeof value.sealed_provider_slice_hash !== "string" ||
    !SHA256.test(value.sealed_provider_slice_hash) ||
    typeof value.summary_provider_slice_hash !== "string" ||
    !SHA256.test(value.summary_provider_slice_hash) ||
    typeof value.summary_hash !== "string" ||
    !SHA256.test(value.summary_hash) ||
    (value.has_stale_provider_slices !== 0 &&
      value.has_stale_provider_slices !== 1) ||
    (value.has_unavailable_provider_slices !== 0 &&
      value.has_unavailable_provider_slices !== 1)
  )
    return false;
  return [
    value.generated_at_ms,
    value.activated_at_ms,
    value.sealed_resource_count,
    value.sealed_provider_slice_count,
    value.source_resource_count,
    value.summary_provider_slice_count,
    value.active_models,
    value.active_offerings,
    value.active_providers,
  ].every(
    (item) =>
      typeof item === "number" && Number.isSafeInteger(item) && item >= 0,
  );
};

const reservedProductionHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  if (
    !normalized.includes(".") ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".invalid") ||
    normalized.endsWith(".test") ||
    normalized.endsWith(".example") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized === "example.net" ||
    normalized.endsWith(".example.net") ||
    normalized === "example.org" ||
    normalized.endsWith(".example.org") ||
    normalized === "home.arpa" ||
    normalized.endsWith(".home.arpa")
  )
    return true;
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    const address = normalized.slice(1, -1);
    return (
      address === "::" ||
      address === "::1" ||
      address.startsWith("fc") ||
      address.startsWith("fd") ||
      /^fe[89ab]/u.test(address) ||
      address.startsWith("::ffff:127.") ||
      address.startsWith("::ffff:10.") ||
      address.startsWith("::ffff:192.168.")
    );
  }
  const octets = normalized.split(".").map((part) => Number(part));
  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [first = -1, second = -1] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }
  return false;
};

const publicApiOrigin = (
  value: unknown,
  protectedEnvironment: QueryRpcEnvironment,
): string | null => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    UTF8.encode(value).byteLength > MAX_PUBLIC_API_ORIGIN_BYTES
  )
    return null;
  const authority = value.slice("https://".length);
  if (
    !value.startsWith("https://") ||
    Array.from(authority).some((scalar) => {
      const point = scalar.codePointAt(0);
      return (
        point === undefined ||
        point <= 0x20 ||
        point === 0x7f ||
        "/@\\?#%".includes(scalar)
      );
    })
  )
    return null;
  const colon = authority.lastIndexOf(":");
  const hasPort = colon >= 0;
  const hostname = hasPort ? authority.slice(0, colon) : authority;
  const port = hasPort ? authority.slice(colon + 1) : null;
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname !== hostname.toLowerCase() ||
    hostname.endsWith(".") ||
    hostname
      .split(".")
      .some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
      ) ||
    (port !== null &&
      (!/^(?:[1-9][0-9]{0,4})$/u.test(port) ||
        Number(port) > 65_535 ||
        port === "443")) ||
    ((protectedEnvironment === "preview" ||
      protectedEnvironment === "production") &&
      reservedProductionHostname(hostname))
  )
    return null;
  return value;
};

export const nextRefreshWindow = (
  nowMs: number,
): Readonly<{ starts_at: string; ends_at: string }> | null => {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    nowMs > 8_640_000_000_000_000
  )
    return null;
  const now = new Date(nowMs);
  if (!Number.isFinite(now.getTime())) return null;
  const midnightMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const candidateMidnightMs = midnightMs + dayOffset * 86_400_000;
    const candidate = new Date(candidateMidnightMs);
    const weekday = candidate.getUTCDay();
    if (weekday !== 1 && weekday !== 4) continue;
    const startsAtMs = candidateMidnightMs + 5 * 60 * 60 * 1000;
    const endsAtMs = candidateMidnightMs + 17 * 60 * 60 * 1000;
    if (dayOffset === 0 && nowMs >= endsAtMs) continue;
    return {
      starts_at: new Date(startsAtMs).toISOString(),
      ends_at: new Date(endsAtMs).toISOString(),
    };
  }
  return null;
};

const resolveRow = (value: unknown): value is ResolveRow =>
  record(value) &&
  exactKeys(value, [
    "current_publication_id",
    "current_publication_state",
    "rollback_candidate_publication_id",
    "selected_publication_id",
    "selected_publication_state",
  ]) &&
  typeof value.current_publication_id === "string" &&
  PUBLICATION_ID.test(value.current_publication_id) &&
  (value.rollback_candidate_publication_id === null ||
    (typeof value.rollback_candidate_publication_id === "string" &&
      PUBLICATION_ID.test(value.rollback_candidate_publication_id))) &&
  (value.current_publication_state === null ||
    typeof value.current_publication_state === "string") &&
  (value.selected_publication_id === null ||
    (typeof value.selected_publication_id === "string" &&
      PUBLICATION_ID.test(value.selected_publication_id))) &&
  (value.selected_publication_state === null ||
    typeof value.selected_publication_state === "string");

const resolveV2Row = (value: unknown): value is ResolveV2Row =>
  record(value) &&
  exactKeys(value, [
    "current_publication_id",
    "current_publication_state",
    "database_now_ms",
    "horizon_valid",
    "rollback_candidate_publication_id",
    "selected_latest_head_reference_ms",
    "selected_publication_id",
    "selected_publication_state",
  ]) &&
  typeof value.current_publication_id === "string" &&
  PUBLICATION_ID.test(value.current_publication_id) &&
  (value.rollback_candidate_publication_id === null ||
    (typeof value.rollback_candidate_publication_id === "string" &&
      PUBLICATION_ID.test(value.rollback_candidate_publication_id))) &&
  (value.current_publication_state === null ||
    typeof value.current_publication_state === "string") &&
  typeof value.database_now_ms === "number" &&
  Number.isSafeInteger(value.database_now_ms) &&
  value.database_now_ms >= 0 &&
  (value.horizon_valid === 0 || value.horizon_valid === 1) &&
  (value.selected_publication_id === null ||
    (typeof value.selected_publication_id === "string" &&
      PUBLICATION_ID.test(value.selected_publication_id))) &&
  (value.selected_publication_state === null ||
    typeof value.selected_publication_state === "string") &&
  (value.selected_latest_head_reference_ms === null ||
    (typeof value.selected_latest_head_reference_ms === "number" &&
      Number.isSafeInteger(value.selected_latest_head_reference_ms) &&
      value.selected_latest_head_reference_ms >= 0));

export const resolvePublicationV1 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  input: unknown,
): Promise<ResolvePublicationV1Outcome> => {
  if (
    !resolveInput(input) ||
    !environment(protectedEnvironment) ||
    input.environment !== protectedEnvironment
  )
    return { outcome: "integrity_failure" };
  try {
    const session = database.withSession("first-primary");
    const result: unknown = await session
      .prepare(RESOLVE_PUBLICATION_SELECT_SQL)
      .bind(input.requestedPublicationId)
      .all<ResolveRow>();
    const rows = d1Rows(result);
    if (rows === null) return { outcome: "read_failure" };
    if (rows.length === 0) return { outcome: "publication_not_ready" };
    if (rows.length !== 1 || !resolveRow(rows[0]))
      return { outcome: "integrity_failure" };
    const row = rows[0];
    if (row.current_publication_state !== "active")
      return { outcome: "integrity_failure" };
    if (row.selected_publication_id === null) {
      if (
        input.requestedPublicationId === null ||
        row.selected_publication_state !== null
      )
        return { outcome: "integrity_failure" };
      return {
        outcome: "publication_expired",
        currentPublicationId: row.current_publication_id,
      };
    }
    if (
      input.requestedPublicationId !== null &&
      row.selected_publication_id !== input.requestedPublicationId
    )
      return { outcome: "integrity_failure" };
    const selectedActive =
      row.selected_publication_id === row.current_publication_id;
    if (
      (input.requestedPublicationId === null && !selectedActive) ||
      (selectedActive && row.selected_publication_state !== "active") ||
      (!selectedActive &&
        row.selected_publication_id !==
          row.rollback_candidate_publication_id) ||
      (!selectedActive &&
        row.selected_publication_state !== "superseded" &&
        row.selected_publication_state !== "rolled_back")
    )
      return { outcome: "integrity_failure" };
    const bookmark = session.getBookmark();
    if (bookmark === null || bookmark.length === 0 || bookmark.length > 4096)
      return { outcome: "integrity_failure" };
    return {
      outcome: "selected",
      publicationId: row.selected_publication_id,
      bookmark,
    };
  } catch {
    return { outcome: "read_failure" };
  }
};

export const resolvePublicationV2 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  input: unknown,
): Promise<ResolvePublicationV2Outcome> => {
  const parsed = parseResolveV2Input(input);
  if (
    parsed === null ||
    !environment(protectedEnvironment) ||
    parsed.environment !== protectedEnvironment
  )
    return { outcome: "integrity_failure" };
  try {
    const session = database.withSession("first-primary");
    const result: unknown = await session
      .prepare(RESOLVE_PUBLICATION_V2_SELECT_SQL)
      .bind(parsed.requestedPublicationId, parsed.requiredAvailableUntilMs)
      .all<ResolveV2Row>();
    const rows = d1Rows(result);
    if (rows === null) return { outcome: "read_failure" };
    if (rows.length === 0) return { outcome: "publication_not_ready" };
    if (rows.length !== 1 || !resolveV2Row(rows[0]))
      return { outcome: "integrity_failure" };
    const row = rows[0];
    if (row.current_publication_state !== "active" || row.horizon_valid !== 1)
      return { outcome: "integrity_failure" };
    if (row.selected_publication_id === null) {
      if (
        parsed.requestedPublicationId === null ||
        parsed.requestedPublicationId ===
          row.rollback_candidate_publication_id ||
        row.selected_publication_state !== null ||
        row.selected_latest_head_reference_ms !== null
      )
        return { outcome: "integrity_failure" };
      return {
        outcome: "publication_expired",
        currentPublicationId: row.current_publication_id,
      };
    }
    if (
      parsed.requestedPublicationId !== null &&
      row.selected_publication_id !== parsed.requestedPublicationId
    )
      return { outcome: "integrity_failure" };
    const selectedActive =
      row.selected_publication_id === row.current_publication_id;
    const selectedRollback =
      row.selected_publication_id === row.rollback_candidate_publication_id;
    if (
      (parsed.requestedPublicationId === null && !selectedActive) ||
      (selectedActive && row.selected_publication_state !== "active") ||
      (!selectedActive &&
        row.selected_publication_state !== "superseded" &&
        row.selected_publication_state !== "rolled_back") ||
      ((selectedActive || selectedRollback) &&
        row.selected_latest_head_reference_ms !== null) ||
      (!selectedActive &&
        !selectedRollback &&
        (row.selected_latest_head_reference_ms === null ||
          row.selected_latest_head_reference_ms >
            row.database_now_ms +
              RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS ||
          row.selected_latest_head_reference_ms <=
            parsed.requiredAvailableUntilMs +
              RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS -
              RETAINED_HOT_PUBLICATION_WINDOW_MS))
    )
      return { outcome: "integrity_failure" };
    const bookmark = session.getBookmark();
    if (bookmark === null || bookmark.length === 0 || bookmark.length > 4096)
      return { outcome: "integrity_failure" };
    return {
      outcome: "selected",
      publicationId: row.selected_publication_id,
      bookmark,
      requiredAvailableUntilMs: parsed.requiredAvailableUntilMs,
    };
  } catch {
    return { outcome: "read_failure" };
  }
};

export const readDatasetMetadataV1 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  protectedPublicApiOrigin: unknown,
  nowMs: number,
  input: unknown,
): Promise<ReadDatasetMetadataV1Outcome> => {
  const parsed = parseDatasetMetadataInput(input);
  if (
    parsed === null ||
    !environment(protectedEnvironment) ||
    parsed.environment !== protectedEnvironment
  )
    return { outcome: "integrity_failure" };
  const origin = publicApiOrigin(
    protectedPublicApiOrigin,
    protectedEnvironment,
  );
  const refreshWindow = nextRefreshWindow(nowMs);
  if (origin === null || refreshWindow === null)
    return { outcome: "integrity_failure" };
  try {
    const result: unknown = await database
      .withSession(parsed.bookmark)
      .prepare(DATASET_METADATA_SELECT_SQL)
      .bind(parsed.publicationId, parsed.requiredAvailableUntilMs)
      .all<DatasetMetadataRow>();
    const rows = d1Rows(result);
    if (rows === null) return { outcome: "read_failure" };
    if (rows.length !== 1 || !datasetMetadataRow(rows[0]))
      return { outcome: "integrity_failure" };
    const row = rows[0];
    if (
      row.publication_id !== parsed.publicationId ||
      row.publication_closure_hash !== row.sealed_closure_hash ||
      row.publication_closure_hash !== row.summary_closure_hash ||
      row.source_resource_count !== row.sealed_resource_count ||
      row.summary_provider_slice_count !== row.sealed_provider_slice_count ||
      row.summary_provider_slice_hash !== row.sealed_provider_slice_hash ||
      row.generated_at_ms > row.activated_at_ms ||
      row.generated_at_ms > 8_640_000_000_000_000 ||
      row.activated_at_ms > 8_640_000_000_000_000 ||
      row.active_models > row.source_resource_count ||
      row.active_offerings > row.source_resource_count ||
      row.active_providers > row.source_resource_count ||
      !Object.hasOwn(METHODOLOGY_REGISTRY, row.methodology_version)
    )
      return { outcome: "integrity_failure" };
    const summary: DatasetMetadataSummaryProjection = {
      publication_id:
        row.publication_id as DatasetMetadataSummaryProjection["publication_id"],
      summary_version: row.summary_version,
      closure_hash:
        row.summary_closure_hash as DatasetMetadataSummaryProjection["closure_hash"],
      source_resource_count: row.source_resource_count,
      provider_slice_count: row.summary_provider_slice_count,
      provider_slice_hash:
        row.summary_provider_slice_hash as DatasetMetadataSummaryProjection["provider_slice_hash"],
      active_model_count: row.active_models,
      active_offering_count: row.active_offerings,
      active_provider_count: row.active_providers,
      has_stale_provider_slices: row.has_stale_provider_slices,
      has_unavailable_provider_slices: row.has_unavailable_provider_slices,
      summary_hash:
        row.summary_hash as DatasetMetadataSummaryProjection["summary_hash"],
    };
    if (!(await verifyDatasetMetadataSummaryHash(summary)))
      return { outcome: "integrity_failure" };
    const methodology = METHODOLOGY_REGISTRY[row.methodology_version];
    if (methodology === undefined) return { outcome: "integrity_failure" };
    const degradationNotices: string[] = [];
    if (row.has_stale_provider_slices === 1)
      degradationNotices.push("One or more enabled provider slices are stale.");
    if (row.has_unavailable_provider_slices === 1)
      degradationNotices.push(
        "One or more enabled provider slices are unavailable.",
      );
    degradationNotices.sort();
    const metadata: DatasetMetadata = {
      publication_id: row.publication_id,
      schema_version: row.schema_version,
      api_version: "1",
      methodology_version: row.methodology_version,
      methodology_effective_at: methodology.effectiveAt,
      methodology_url: `${origin}${methodology.path}`,
      precision_normalization_version: row.precision_normalization_version,
      precision_display_order_version: row.precision_display_order_version,
      price_policy_version: row.price_policy_version,
      published_at: new Date(row.activated_at_ms).toISOString(),
      generated_at: new Date(row.generated_at_ms).toISOString(),
      next_refresh_window: refreshWindow,
      counts: {
        active_models: row.active_models,
        active_offerings: row.active_offerings,
        active_providers: row.active_providers,
      },
      degradation_notices: degradationNotices,
    };
    if (
      UTF8.encode(JSON.stringify(metadata)).byteLength >
      MAX_METADATA_RESPONSE_BYTES
    )
      return { outcome: "integrity_failure" };
    return { outcome: "metadata", metadata };
  } catch {
    return { outcome: "read_failure" };
  }
};

export const readProviderExactNameTierV1 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  input: unknown,
): Promise<ReadProviderExactNameTierV1Outcome> => {
  if (
    !readInput(input) ||
    !environment(protectedEnvironment) ||
    input.environment !== protectedEnvironment
  )
    return { outcome: "integrity_failure" };
  const searchPlan = input.envelope.searchPlan;
  if (searchPlan === null) return { outcome: "integrity_failure" };
  try {
    const page = await readProviderExactNamePage(
      database.withSession(input.bookmark),
      {
        publicationId: input.envelope.publicationId,
        query: searchPlan.query,
        limit: input.envelope.limit,
      },
    );
    return { outcome: "page", page };
  } catch (error) {
    if (error instanceof ProviderExactNameError)
      return {
        outcome:
          error.code === "invalid_input"
            ? "integrity_failure"
            : error.code === "read_failure"
              ? "read_failure"
              : "integrity_failure",
      };
    return { outcome: "read_failure" };
  }
};

export const readModelVariantExactNameTierV1 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  input: unknown,
): Promise<ReadModelVariantExactNameTierV1Outcome> => {
  const parsed = parseModelVariantReadInput(input);
  if (
    parsed === null ||
    !environment(protectedEnvironment) ||
    parsed.environment !== protectedEnvironment
  )
    return { outcome: "integrity_failure" };
  try {
    const page = await readModelVariantExactNamePage(
      database.withSession(parsed.bookmark),
      {
        publicationId: parsed.publicationId,
        query: parsed.query,
        recordType: parsed.recordType,
        afterResourceId: null,
        limit: parsed.limit,
      },
    );
    return { outcome: "page", page };
  } catch (error) {
    if (error instanceof ModelVariantExactNameError)
      return {
        outcome:
          error.code === "read_failure" ? "read_failure" : "integrity_failure",
      };
    return { outcome: "read_failure" };
  }
};

export const readProviderModelIdExactTierV1 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  input: unknown,
): Promise<ReadProviderModelIdExactTierV1Outcome> => {
  const parsed = parseProviderModelIdReadInput(input);
  if (
    parsed === null ||
    !environment(protectedEnvironment) ||
    parsed.environment !== protectedEnvironment
  )
    return { outcome: "integrity_failure" };
  try {
    const page = await readProviderModelIdExactPage(
      database.withSession(parsed.bookmark),
      {
        publicationId: parsed.publicationId,
        query: parsed.query,
        providerId: parsed.providerId,
        recordType: parsed.recordType,
        continuation: null,
        limit: parsed.limit,
      },
    );
    return { outcome: "page", page };
  } catch (error) {
    if (error instanceof ProviderModelIdExactError)
      return {
        outcome:
          error.code === "read_failure" ? "read_failure" : "integrity_failure",
      };
    return { outcome: "read_failure" };
  }
};

export const readMergedExactSearchV1 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  input: unknown,
): Promise<ReadMergedExactSearchV1Outcome> => {
  const parsed = parseMergedExactSearchInput(input);
  if (
    parsed === null ||
    !environment(protectedEnvironment) ||
    parsed.environment !== protectedEnvironment
  )
    return { outcome: "integrity_failure" };
  try {
    const session = database.withSession(parsed.bookmark);
    const page = await readMergedExactSearchPage(session, {
      publicationId: parsed.publicationId,
      query: parsed.query,
      recordType: parsed.recordType,
      eligibilityProviderId: parsed.eligibilityProviderId,
      ...(parsed.eligibilityStale === null
        ? {}
        : { eligibilityStale: parsed.eligibilityStale }),
      familyId: parsed.familyId,
      continuation: parsed.continuation,
      limit: parsed.limit,
      requiredAvailableUntilMs: null,
    });
    return { outcome: "page", page };
  } catch (error) {
    if (error instanceof MergedExactSearchError)
      return {
        outcome:
          error.code === "read_failure" ? "read_failure" : "integrity_failure",
      };
    return { outcome: "read_failure" };
  }
};

export const readMergedExactSearchV2 = async (
  database: D1Database,
  protectedEnvironment: unknown,
  input: unknown,
): Promise<ReadMergedExactSearchV2Outcome> => {
  const parsed = parseMergedExactSearchInput(input, 2);
  if (
    typeof parsed?.requiredAvailableUntilMs !== "number" ||
    !environment(protectedEnvironment) ||
    parsed.environment !== protectedEnvironment
  )
    return { outcome: "integrity_failure" };
  try {
    const session = database.withSession(parsed.bookmark);
    const page = await readMergedExactSearchPage(session, {
      publicationId: parsed.publicationId,
      query: parsed.query,
      recordType: parsed.recordType,
      eligibilityProviderId: parsed.eligibilityProviderId,
      ...(parsed.eligibilityStale === null
        ? {}
        : { eligibilityStale: parsed.eligibilityStale }),
      familyId: parsed.familyId,
      continuation: parsed.continuation,
      limit: parsed.limit,
      requiredAvailableUntilMs: parsed.requiredAvailableUntilMs,
    });
    return { outcome: "page", page };
  } catch (error) {
    if (error instanceof MergedExactSearchError)
      return {
        outcome:
          error.code === "read_failure" ? "read_failure" : "integrity_failure",
      };
    return { outcome: "read_failure" };
  }
};
