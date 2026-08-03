import type { QueryServiceEnvelope } from "@quant-clarity/api-core";
import { MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS } from "@quant-clarity/contracts";
import {
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  normalizeExactSearchName,
  PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
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
  RETAINED_HOT_ROLLBACK_INDEX,
} from "./retained-hot-publication.js";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const PROVIDER_ID = new RegExp(`^prv_${UUID_V4}$`, "u");
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const VARIANT_ID = new RegExp(`^var_${UUID_V4}$`, "u");
const FAMILY_ID = new RegExp(`^fam_${UUID_V4}$`, "u");
const UTF8 = new TextEncoder();
const ENVIRONMENTS = new Set(["local", "preview", "production", "test"]);
const AUDIENCE = "quantclarity-catalog-query-v1" as const;

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
  familyId: string | null;
  continuation: MergedExactSearchContinuation | null;
  limit: number;
  requiredAvailableUntilMs: number | null;
}>;

const mergedFilters = (
  value: unknown,
):
  | Readonly<{
      canonical: Readonly<Record<string, string>>;
      eligibilityProviderId: string | null;
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
          key !== "family" && key !== "provider" && key !== "record_type",
      )
    )
      return undefined;
    const hasFamily = Object.hasOwn(filter, "family");
    const hasProvider = Object.hasOwn(filter, "provider");
    const hasRecordType = Object.hasOwn(filter, "record_type");
    const family = filter.family;
    const provider = filter.provider;
    const recordType = filter.record_type;
    if (
      (hasFamily && (typeof family !== "string" || !FAMILY_ID.test(family))) ||
      (hasProvider &&
        (typeof provider !== "string" || !PROVIDER_ID.test(provider))) ||
      (hasRecordType &&
        recordType !== "model" &&
        recordType !== "variant" &&
        recordType !== "provider") ||
      ((hasProvider || hasFamily) && recordType === "provider")
    )
      return undefined;
    const canonical: Record<string, string> = {};
    if (typeof family === "string") canonical.family = family;
    if (typeof provider === "string") canonical.provider = provider;
    if (typeof recordType === "string") canonical.record_type = recordType;
    return Object.freeze({
      canonical: Object.freeze(canonical),
      eligibilityProviderId: typeof provider === "string" ? provider : null,
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
