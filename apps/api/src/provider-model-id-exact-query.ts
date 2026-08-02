import {
  assertApiLimits,
  buildQueryServiceEnvelope,
  type ApiLimits,
  type DeploymentEnvironment,
  type NormalizedRequest,
  type QueryServiceEnvelope,
} from "@quant-clarity/api-core";
import { MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS } from "@quant-clarity/contracts";
import {
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCE_BYTES,
  normalizeExactSearchName,
} from "@quant-clarity/publication-core";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const VARIANT_ID = new RegExp(`^var_${UUID_V4}$`, "u");
const PROVIDER_ID = new RegExp(`^prv_${UUID_V4}$`, "u");
const EVIDENCE_ID = new RegExp(`^evd_${UUID_V4}$`, "u");
const RFC3339_MILLISECONDS =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const UTF8 = new TextEncoder();
const AUDIENCE = "quantclarity-catalog-query-v1" as const;
const MAX_QUERY_UTF8_BYTES = 200;
const MAX_DISPLAY_NAME_UTF8_BYTES = MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS * 4;
const MIN_SERIALIZED_EVIDENCE_ID_BYTES = 42;
const MAX_EVIDENCE_IDS_PER_FACT = Math.floor(
  PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCE_BYTES /
    MIN_SERIALIZED_EVIDENCE_ID_BYTES,
);
const MAX_EVIDENCE_IDS_PER_PAGE = 20 * MAX_EVIDENCE_IDS_PER_FACT;

export type ProviderModelIdExactApiResult = Readonly<{
  tier: 2;
  resourceType: "model" | "variant";
  resourceId: string;
  matchKind: "provider_model_id";
  displayName: Readonly<{
    state: "known";
    value: string;
    observed_at: string;
    evidence_ids: readonly string[];
  }>;
  semanticDegraded: "disabled";
}>;

export type ProviderModelIdExactApiOutcome =
  | Readonly<{
      success: true;
      publicationId: string;
      results: readonly ProviderModelIdExactApiResult[];
    }>
  | Readonly<{
      success: false;
      code: "publication_expired";
      currentPublicationId: string;
    }>
  | Readonly<{
      success: false;
      code:
        | "integrity_failure"
        | "invalid_input"
        | "publication_not_ready"
        | "read_failure";
    }>;

export interface ProviderModelIdCatalogQueryRpcV1 {
  resolvePublicationV1(input: unknown): Promise<unknown>;
  readProviderModelIdExactTierV1(input: unknown): Promise<unknown>;
}

export type ProviderModelIdExactApiInput = Readonly<{
  service: ProviderModelIdCatalogQueryRpcV1;
  request: NormalizedRequest;
  environment: DeploymentEnvironment;
  limits: ApiLimits;
}>;

const snapshotOwnRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return null;
  const actualKeys = (ownKeys as string[]).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    sortedExpected.some((key, index) => actualKeys[index] !== key)
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
};

const snapshotArray = (
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null => {
  if (!Array.isArray(value)) return null;
  if (Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength)
    return null;
  const ownKeys = Reflect.ownKeys(value);
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
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
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
};

const validEnvironment = (value: unknown): value is DeploymentEnvironment =>
  value === "local" ||
  value === "preview" ||
  value === "production" ||
  value === "test";

const validUnicodeScalars = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
};

const validQuery = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_QUERY_UTF8_BYTES ||
    !validUnicodeScalars(value)
  )
    return false;
  try {
    const bytes = UTF8.encode(value).byteLength;
    return (
      value === value.normalize("NFC").trim() &&
      bytes > 0 &&
      bytes <= MAX_QUERY_UTF8_BYTES
    );
  } catch {
    return false;
  }
};

const canonicalTimestamp = (value: string): boolean => {
  if (!RFC3339_MILLISECONDS.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

type ParsedFilters = Readonly<{
  filters: Readonly<Record<string, string>>;
  recordType: "model" | "variant" | null;
}>;

const snapshotFilters = (value: unknown): ParsedFilters | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) return null;
  const keys = (ownKeys as string[]).sort();
  if (
    keys.length > 2 ||
    keys.some((key) => key !== "provider" && key !== "record_type")
  )
    return null;
  const source: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    )
      return null;
    source[key] = descriptor.value;
  }
  const recordType = source.record_type;
  const provider = source.provider;
  if (
    (recordType !== undefined &&
      recordType !== "model" &&
      recordType !== "variant") ||
    (provider !== undefined &&
      (typeof provider !== "string" || !PROVIDER_ID.test(provider)))
  )
    return null;
  const filters: Record<string, string> = {};
  if (typeof provider === "string") filters.provider = provider;
  if (recordType === "model" || recordType === "variant")
    filters.record_type = recordType;
  return {
    filters,
    recordType:
      recordType === "model" || recordType === "variant" ? recordType : null,
  };
};

type ParsedRequest = Readonly<{
  request: NormalizedRequest;
  recordType: "model" | "variant" | null;
}>;

const parseRequest = (value: unknown): ParsedRequest | null => {
  try {
    const request = snapshotOwnRecord(value, [
      "cursor",
      "filters",
      "hasQueryString",
      "limit",
      "limitProvided",
      "method",
      "operation",
      "publicationHeader",
      "query",
      "route",
      "sort",
      "sortProvided",
    ]);
    if (
      request === null ||
      (request.method !== "GET" && request.method !== "HEAD") ||
      request.cursor !== null ||
      request.hasQueryString !== true ||
      typeof request.limitProvided !== "boolean" ||
      typeof request.sortProvided !== "boolean" ||
      !Number.isSafeInteger(request.limit) ||
      (request.limit as number) < 1 ||
      (request.limit as number) > 20 ||
      (request.publicationHeader !== null &&
        (typeof request.publicationHeader !== "string" ||
          !PUBLICATION_ID.test(request.publicationHeader))) ||
      !validQuery(request.query)
    )
      return null;
    const operation = snapshotOwnRecord(request.operation, ["kind"]);
    const route = snapshotOwnRecord(request.route, ["operation", "policy"]);
    const routeOperation = snapshotOwnRecord(route?.operation, ["kind"]);
    const filters = snapshotFilters(request.filters);
    const sort = snapshotArray(request.sort, 2);
    if (
      operation?.kind !== "search" ||
      route?.policy !== "search" ||
      routeOperation?.kind !== "search" ||
      filters === null ||
      sort?.length !== 2 ||
      sort[0] !== "relevance" ||
      sort[1] !== "stable_id"
    )
      return null;
    return {
      recordType: filters.recordType,
      request: {
        cursor: null,
        filters: filters.filters,
        hasQueryString: true,
        limit: request.limit as number,
        limitProvided: request.limitProvided,
        method: request.method,
        operation: { kind: "search" },
        publicationHeader: request.publicationHeader,
        query: request.query,
        route: { operation: { kind: "search" }, policy: "search" },
        sort: ["relevance", "stable_id"],
        sortProvided: request.sortProvided,
      },
    };
  } catch {
    return null;
  }
};

const snapshotLimits = (value: unknown): ApiLimits | null => {
  try {
    const snapshot = snapshotOwnRecord(value, [
      "defaultPageSize",
      "maxBodyBytes",
      "maxCpuMilliseconds",
      "maxCursorCharacters",
      "maxErrorDetails",
      "maxFilterValues",
      "maxPageSize",
      "maxPathBytes",
      "maxQueryBytes",
      "maxQueryValueBytes",
      "maxResponseBytes",
      "maxSearchQueryBytes",
      "maxSearchResults",
      "maxSemanticCalls",
      "maxSemanticCandidates",
      "maxSubrequests",
      "maxUpstreamCalls",
      "maxUrlBytes",
    ]);
    if (snapshot === null) return null;
    const limits = { ...snapshot } as unknown as ApiLimits;
    assertApiLimits(limits);
    return limits;
  } catch {
    return null;
  }
};

type ResolverClassification =
  | Readonly<{ kind: "selected"; publicationId: string; bookmark: string }>
  | Readonly<{
      kind: "failure";
      outcome: Exclude<ProviderModelIdExactApiOutcome, { success: true }>;
    }>
  | Readonly<{ kind: "invalid" }>;

const classifyResolver = (value: unknown): ResolverClassification => {
  try {
    const oneField = snapshotOwnRecord(value, ["outcome"]);
    if (oneField !== null) {
      const outcome = oneField.outcome;
      if (
        outcome === "integrity_failure" ||
        outcome === "publication_not_ready" ||
        outcome === "read_failure"
      )
        return { kind: "failure", outcome: { success: false, code: outcome } };
      return { kind: "invalid" };
    }
    const expired = snapshotOwnRecord(value, [
      "currentPublicationId",
      "outcome",
    ]);
    if (expired !== null) {
      if (
        expired.outcome === "publication_expired" &&
        typeof expired.currentPublicationId === "string" &&
        PUBLICATION_ID.test(expired.currentPublicationId)
      )
        return {
          kind: "failure",
          outcome: {
            success: false,
            code: "publication_expired",
            currentPublicationId: expired.currentPublicationId,
          },
        };
      return { kind: "invalid" };
    }
    const selected = snapshotOwnRecord(value, [
      "bookmark",
      "outcome",
      "publicationId",
    ]);
    if (selected === null) return { kind: "invalid" };
    if (
      selected.outcome !== "selected" ||
      typeof selected.publicationId !== "string" ||
      !PUBLICATION_ID.test(selected.publicationId) ||
      typeof selected.bookmark !== "string" ||
      selected.bookmark.length === 0 ||
      selected.bookmark.length > 4096 ||
      selected.bookmark === "first-primary" ||
      selected.bookmark === "first-unconstrained"
    )
      return { kind: "invalid" };
    return {
      kind: "selected",
      publicationId: selected.publicationId,
      bookmark: selected.bookmark,
    };
  } catch {
    return { kind: "invalid" };
  }
};

const snapshotFact = (
  value: unknown,
  maximumEvidenceItems: number,
): ProviderModelIdExactApiResult["displayName"] | null => {
  const fact = snapshotOwnRecord(value, [
    "evidence_ids",
    "observed_at",
    "state",
    "value",
  ]);
  if (fact === null) return null;
  if (
    fact.state !== "known" ||
    typeof fact.value !== "string" ||
    fact.value.length > MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS * 2 ||
    !validUnicodeScalars(fact.value) ||
    Array.from(fact.value).length === 0 ||
    Array.from(fact.value).length > MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS ||
    UTF8.encode(fact.value).byteLength > MAX_DISPLAY_NAME_UTF8_BYTES ||
    typeof fact.observed_at !== "string" ||
    !canonicalTimestamp(fact.observed_at)
  )
    return null;
  const evidence = snapshotArray(fact.evidence_ids, maximumEvidenceItems);
  if (
    evidence === null ||
    evidence.length === 0 ||
    evidence.some(
      (identifier) =>
        typeof identifier !== "string" || !EVIDENCE_ID.test(identifier),
    ) ||
    new Set(evidence).size !== evidence.length
  )
    return null;
  return {
    state: "known",
    value: fact.value,
    observed_at: fact.observed_at,
    evidence_ids: evidence as readonly string[],
  };
};

const snapshotResult = (
  value: unknown,
  maximumEvidenceItems: number,
): ProviderModelIdExactApiResult | null => {
  const result = snapshotOwnRecord(value, [
    "displayName",
    "matchKind",
    "resourceId",
    "resourceType",
    "semanticDegraded",
    "tier",
  ]);
  if (result === null) return null;
  if (
    result.tier !== 2 ||
    (result.resourceType !== "model" && result.resourceType !== "variant") ||
    typeof result.resourceId !== "string" ||
    (result.resourceType === "model"
      ? !MODEL_ID.test(result.resourceId)
      : !VARIANT_ID.test(result.resourceId)) ||
    result.matchKind !== "provider_model_id" ||
    result.semanticDegraded !== "disabled"
  )
    return null;
  const displayName = snapshotFact(result.displayName, maximumEvidenceItems);
  return displayName === null
    ? null
    : {
        tier: 2,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        matchKind: "provider_model_id",
        displayName,
        semanticDegraded: "disabled",
      };
};

const compareUtf8 = (left: string, right: string): number => {
  const leftBytes = UTF8.encode(left);
  const rightBytes = UTF8.encode(right);
  const shared = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < shared; index += 1) {
    const leftByte = leftBytes[index];
    const rightByte = rightBytes[index];
    if (leftByte === undefined || rightByte === undefined)
      throw new Error("UTF-8 comparison state is invalid");
    if (leftByte !== rightByte) return leftByte < rightByte ? -1 : 1;
  }
  return leftBytes.length === rightBytes.length
    ? 0
    : leftBytes.length < rightBytes.length
      ? -1
      : 1;
};

type TierClassification =
  | Readonly<{
      kind: "page";
      results: readonly ProviderModelIdExactApiResult[];
    }>
  | Readonly<{ kind: "failure"; code: "integrity_failure" | "read_failure" }>
  | Readonly<{ kind: "invalid" }>;

const classifyTier = (
  value: unknown,
  publicationId: string,
  limit: number,
  recordType: "model" | "variant" | null,
  maxResponseBytes: number,
): TierClassification => {
  try {
    const failure = snapshotOwnRecord(value, ["outcome"]);
    if (failure !== null) {
      return failure.outcome === "integrity_failure" ||
        failure.outcome === "read_failure"
        ? { kind: "failure", code: failure.outcome }
        : { kind: "invalid" };
    }
    const response = snapshotOwnRecord(value, ["outcome", "page"]);
    if (response === null) return { kind: "invalid" };
    if (response.outcome !== "page") return { kind: "invalid" };
    const page = snapshotOwnRecord(response.page, [
      "matchModes",
      "nextContinuation",
      "publicationId",
      "results",
    ]);
    if (page === null) return { kind: "invalid" };
    if (page.publicationId !== publicationId) return { kind: "invalid" };
    const rows = snapshotArray(page.results, limit);
    const matchModes = snapshotArray(page.matchModes, limit);
    if (rows === null || matchModes === null) return { kind: "invalid" };
    if (
      matchModes.length !== rows.length ||
      matchModes.some((mode) => mode !== "raw" && mode !== "normalized")
    )
      return { kind: "invalid" };
    const results: ProviderModelIdExactApiResult[] = [];
    let remainingEvidenceItems = Math.min(
      MAX_EVIDENCE_IDS_PER_PAGE,
      Math.floor(maxResponseBytes / MIN_SERIALIZED_EVIDENCE_ID_BYTES),
    );
    for (const row of rows) {
      const result = snapshotResult(
        row,
        Math.min(MAX_EVIDENCE_IDS_PER_FACT, remainingEvidenceItems),
      );
      if (result === null) return { kind: "invalid" };
      remainingEvidenceItems -= result.displayName.evidence_ids.length;
      results.push(result);
    }

    const seen = new Set<string>();
    let priorMatchMode: "raw" | "normalized" | null = null;
    let priorOrderingKey: string | null = null;
    let priorId = "";
    const orderingKeys: string[] = [];
    for (const [index, result] of results.entries()) {
      const matchMode = matchModes[index] as "raw" | "normalized";
      if (
        (recordType !== null && result.resourceType !== recordType) ||
        seen.has(result.resourceId)
      )
        return { kind: "invalid" };
      const orderingKey = normalizeExactSearchName(result.displayName.value);
      if (
        UTF8.encode(orderingKey).byteLength >
          MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES ||
        (priorMatchMode === "normalized" && matchMode === "raw") ||
        (priorMatchMode === matchMode &&
          priorOrderingKey !== null &&
          (compareUtf8(orderingKey, priorOrderingKey) < 0 ||
            (compareUtf8(orderingKey, priorOrderingKey) === 0 &&
              result.resourceId <= priorId)))
      )
        return { kind: "invalid" };
      seen.add(result.resourceId);
      priorMatchMode = matchMode;
      priorOrderingKey = orderingKey;
      priorId = result.resourceId;
      orderingKeys.push(orderingKey);
    }

    let nextContinuation: Readonly<{
      matchMode: "raw" | "normalized";
      normalizedTargetDisplayName: string;
      resourceId: string;
    }> | null = null;
    if (page.nextContinuation !== null) {
      const continuation = snapshotOwnRecord(page.nextContinuation, [
        "matchMode",
        "normalizedTargetDisplayName",
        "resourceId",
      ]);
      const last = results.at(-1);
      const lastOrderingKey = orderingKeys.at(-1);
      if (
        continuation === null ||
        (continuation.matchMode !== "raw" &&
          continuation.matchMode !== "normalized") ||
        typeof continuation.normalizedTargetDisplayName !== "string" ||
        !validUnicodeScalars(continuation.normalizedTargetDisplayName) ||
        UTF8.encode(continuation.normalizedTargetDisplayName).byteLength ===
          0 ||
        UTF8.encode(continuation.normalizedTargetDisplayName).byteLength >
          MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES ||
        typeof continuation.resourceId !== "string" ||
        (!MODEL_ID.test(continuation.resourceId) &&
          !VARIANT_ID.test(continuation.resourceId)) ||
        results.length !== limit ||
        last === undefined ||
        lastOrderingKey === undefined ||
        continuation.normalizedTargetDisplayName !== lastOrderingKey ||
        continuation.resourceId !== last.resourceId ||
        continuation.matchMode !== matchModes.at(-1)
      )
        return { kind: "invalid" };
      nextContinuation = {
        matchMode: continuation.matchMode,
        normalizedTargetDisplayName: continuation.normalizedTargetDisplayName,
        resourceId: continuation.resourceId,
      };
    }
    const safeResponse = {
      outcome: "page",
      page: { publicationId, results, matchModes, nextContinuation },
    };
    if (UTF8.encode(JSON.stringify(safeResponse)).byteLength > maxResponseBytes)
      return { kind: "invalid" };
    return { kind: "page", results };
  } catch {
    return { kind: "invalid" };
  }
};

export const readProviderModelIdExactFromQueryV1 = async (
  input: ProviderModelIdExactApiInput,
): Promise<ProviderModelIdExactApiOutcome> => {
  try {
    const outer = snapshotOwnRecord(input, [
      "environment",
      "limits",
      "request",
      "service",
    ]);
    const parsedRequest = parseRequest(outer?.request);
    const limits = snapshotLimits(outer?.limits);
    if (
      outer === null ||
      !validEnvironment(outer.environment) ||
      parsedRequest === null ||
      limits === null ||
      (typeof outer.service !== "object" &&
        typeof outer.service !== "function") ||
      outer.service === null
    )
      return { success: false, code: "invalid_input" };
    const request = parsedRequest.request;
    const query = request.query;
    if (query === null) return { success: false, code: "invalid_input" };
    const queryBytes = UTF8.encode(query).byteLength;
    if (
      queryBytes > limits.maxSearchQueryBytes ||
      queryBytes > limits.maxQueryValueBytes ||
      request.limit > Math.min(limits.maxSearchResults, limits.maxPageSize)
    )
      return { success: false, code: "invalid_input" };
    const service = outer.service as Record<string, unknown>;
    const resolveMethod = service.resolvePublicationV1;
    if (typeof resolveMethod !== "function")
      return { success: false, code: "invalid_input" };

    let resolvedValue: unknown;
    try {
      resolvedValue = await resolveMethod.call(service, {
        version: 1,
        audience: AUDIENCE,
        environment: outer.environment,
        requestedPublicationId: request.publicationHeader,
      });
    } catch {
      return { success: false, code: "read_failure" };
    }
    const resolved = classifyResolver(resolvedValue);
    if (resolved.kind === "failure") return resolved.outcome;
    if (resolved.kind === "invalid")
      return { success: false, code: "integrity_failure" };
    if (
      request.publicationHeader !== null &&
      resolved.publicationId !== request.publicationHeader
    )
      return { success: false, code: "integrity_failure" };

    let envelope: QueryServiceEnvelope;
    try {
      envelope = buildQueryServiceEnvelope(
        request,
        resolved.publicationId,
        outer.environment,
        null,
        limits,
      );
    } catch {
      return { success: false, code: "invalid_input" };
    }

    const tierMethod = service.readProviderModelIdExactTierV1;
    if (typeof tierMethod !== "function")
      return { success: false, code: "integrity_failure" };
    let tierValue: unknown;
    try {
      tierValue = await tierMethod.call(service, {
        version: 1,
        audience: AUDIENCE,
        environment: outer.environment,
        bookmark: resolved.bookmark,
        envelope,
      });
    } catch {
      return { success: false, code: "read_failure" };
    }
    const tier = classifyTier(
      tierValue,
      resolved.publicationId,
      request.limit,
      parsedRequest.recordType,
      limits.maxResponseBytes,
    );
    if (tier.kind === "failure") return { success: false, code: tier.code };
    if (tier.kind === "invalid")
      return { success: false, code: "integrity_failure" };
    return {
      success: true,
      publicationId: resolved.publicationId,
      results: tier.results,
    };
  } catch {
    return { success: false, code: "invalid_input" };
  }
};
