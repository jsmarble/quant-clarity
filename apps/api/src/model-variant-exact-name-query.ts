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
  MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCE_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  normalizeExactSearchName,
} from "@quant-clarity/publication-core";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const VARIANT_ID = new RegExp(`^var_${UUID_V4}$`, "u");
const EVIDENCE_ID = new RegExp(`^evd_${UUID_V4}$`, "u");
const RFC3339_MILLISECONDS =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const UTF8 = new TextEncoder();
const AUDIENCE = "quantclarity-catalog-query-v1" as const;
const MAX_QUERY_BYTES = MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS * 4;
const MIN_SERIALIZED_EVIDENCE_ID_BYTES = 42;
const MAX_EVIDENCE_IDS_PER_FACT = Math.floor(
  MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCE_BYTES /
    MIN_SERIALIZED_EVIDENCE_ID_BYTES,
);
const MAX_EVIDENCE_IDS_PER_PAGE = 20 * MAX_EVIDENCE_IDS_PER_FACT;

export type ModelVariantExactNameApiResult = Readonly<{
  tier: 1;
  resourceType: "model" | "variant";
  resourceId: string;
  matchKind: "canonical_name";
  displayName: Readonly<{
    state: "known";
    value: string;
    observed_at: string;
    evidence_ids: readonly string[];
  }>;
  semanticDegraded: "disabled";
}>;

export type ModelVariantExactNameApiOutcome =
  | Readonly<{
      success: true;
      publicationId: string;
      results: readonly ModelVariantExactNameApiResult[];
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

export interface ModelVariantCatalogQueryRpcV1 {
  resolvePublicationV1(input: unknown): Promise<unknown>;
  readModelVariantExactNameTierV1(input: unknown): Promise<unknown>;
}

export type ModelVariantExactNameApiInput = Readonly<{
  service: ModelVariantCatalogQueryRpcV1;
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

const snapshotArray = (
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null => {
  if (!Array.isArray(value)) return null;
  const length: number = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength)
    return null;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1)
    snapshot.push((value as readonly unknown[])[index]);
  return snapshot;
};

const validEnvironment = (value: unknown): value is DeploymentEnvironment =>
  value === "local" ||
  value === "preview" ||
  value === "production" ||
  value === "test";

const validQuery = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    value.length > MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS * 2 ||
    Array.from(value).length === 0 ||
    Array.from(value).length > MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS ||
    UTF8.encode(value).byteLength > MAX_QUERY_BYTES ||
    ["*", "\\", "[", "]", "{", "}", "|"].some((token) => value.includes(token))
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

const canonicalTimestamp = (value: string): boolean => {
  if (!RFC3339_MILLISECONDS.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const snapshotFilter = (
  value: unknown,
): Readonly<{
  filters: Readonly<Record<string, "model" | "variant">>;
  recordType: "model" | "variant" | null;
}> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Object.keys(value);
  if (keys.length === 0) return { filters: {}, recordType: null };
  if (keys.length !== 1 || keys[0] !== "record_type") return null;
  const recordType = (value as Record<string, unknown>).record_type;
  if (recordType !== "model" && recordType !== "variant") return null;
  return { filters: { record_type: recordType }, recordType };
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
    const filter = snapshotFilter(request.filters);
    const sort = snapshotArray(request.sort, 2);
    if (
      operation?.kind !== "search" ||
      route?.policy !== "search" ||
      routeOperation?.kind !== "search" ||
      filter === null ||
      sort?.length !== 2 ||
      sort[0] !== "relevance" ||
      sort[1] !== "stable_id"
    )
      return null;
    return {
      recordType: filter.recordType,
      request: {
        cursor: null,
        filters: filter.filters,
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
      outcome: Exclude<ModelVariantExactNameApiOutcome, { success: true }>;
    }>
  | Readonly<{ kind: "invalid" }>;

const classifyResolver = (value: unknown): ResolverClassification => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return { kind: "invalid" };
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      return { kind: "invalid" };
    const keys = Object.keys(value).sort();
    if (keys.length === 1 && keys[0] === "outcome") {
      const outcome = (value as Record<string, unknown>).outcome;
      if (
        outcome === "integrity_failure" ||
        outcome === "publication_not_ready" ||
        outcome === "read_failure"
      )
        return { kind: "failure", outcome: { success: false, code: outcome } };
      return { kind: "invalid" };
    }
    if (
      keys.length === 2 &&
      keys[0] === "currentPublicationId" &&
      keys[1] === "outcome"
    ) {
      const source = value as Record<string, unknown>;
      const currentPublicationId = source.currentPublicationId;
      const outcome = source.outcome;
      if (
        outcome === "publication_expired" &&
        typeof currentPublicationId === "string" &&
        PUBLICATION_ID.test(currentPublicationId)
      )
        return {
          kind: "failure",
          outcome: {
            success: false,
            code: "publication_expired",
            currentPublicationId,
          },
        };
      return { kind: "invalid" };
    }
    if (
      keys.length !== 3 ||
      keys[0] !== "bookmark" ||
      keys[1] !== "outcome" ||
      keys[2] !== "publicationId"
    )
      return { kind: "invalid" };
    const source = value as Record<string, unknown>;
    const bookmark = source.bookmark;
    const outcome = source.outcome;
    const publicationId = source.publicationId;
    if (
      outcome !== "selected" ||
      typeof publicationId !== "string" ||
      !PUBLICATION_ID.test(publicationId) ||
      typeof bookmark !== "string" ||
      bookmark.length === 0 ||
      bookmark.length > 4096 ||
      bookmark === "first-primary" ||
      bookmark === "first-unconstrained"
    )
      return { kind: "invalid" };
    return {
      kind: "selected",
      publicationId,
      bookmark,
    };
  } catch {
    return { kind: "invalid" };
  }
};

const snapshotFact = (
  value: unknown,
  maximumEvidenceItems: number,
): ModelVariantExactNameApiResult["displayName"] | null => {
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
    Array.from(fact.value).length === 0 ||
    Array.from(fact.value).length > MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS ||
    UTF8.encode(fact.value).byteLength > MAX_QUERY_BYTES ||
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
): ModelVariantExactNameApiResult | null => {
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
    result.tier !== 1 ||
    (result.resourceType !== "model" && result.resourceType !== "variant") ||
    typeof result.resourceId !== "string" ||
    (result.resourceType === "model"
      ? !MODEL_ID.test(result.resourceId)
      : !VARIANT_ID.test(result.resourceId)) ||
    result.matchKind !== "canonical_name" ||
    result.semanticDegraded !== "disabled"
  )
    return null;
  const displayName = snapshotFact(result.displayName, maximumEvidenceItems);
  return displayName === null
    ? null
    : {
        tier: 1,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        matchKind: "canonical_name",
        displayName,
        semanticDegraded: "disabled",
      };
};

type TierClassification =
  | Readonly<{
      kind: "page";
      results: readonly ModelVariantExactNameApiResult[];
    }>
  | Readonly<{ kind: "failure"; code: "integrity_failure" | "read_failure" }>
  | Readonly<{ kind: "invalid" }>;

const classifyTier = (
  value: unknown,
  publicationId: string,
  limit: number,
  query: string,
  recordType: "model" | "variant" | null,
  maxResponseBytes: number,
): TierClassification => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return { kind: "invalid" };
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      return { kind: "invalid" };
    const keys = Object.keys(value).sort();
    const source = value as Record<string, unknown>;
    if (keys.length === 1 && keys[0] === "outcome") {
      const outcome = source.outcome;
      return outcome === "integrity_failure" || outcome === "read_failure"
        ? { kind: "failure", code: outcome }
        : { kind: "invalid" };
    }
    if (keys.length !== 2 || keys[0] !== "outcome" || keys[1] !== "page")
      return { kind: "invalid" };
    const outcome = source.outcome;
    const pageValue = source.page;
    if (outcome !== "page") return { kind: "invalid" };
    const page = snapshotOwnRecord(pageValue, [
      "nextAfterResourceId",
      "publicationId",
      "results",
    ]);
    if (page === null) return { kind: "invalid" };
    if (page.publicationId !== publicationId) return { kind: "invalid" };
    const nextAfterResourceId = page.nextAfterResourceId;
    if (
      nextAfterResourceId !== null &&
      (typeof nextAfterResourceId !== "string" ||
        (!MODEL_ID.test(nextAfterResourceId) &&
          !VARIANT_ID.test(nextAfterResourceId)))
    )
      return { kind: "invalid" };
    const rows = snapshotArray(page.results, limit);
    if (rows === null) return { kind: "invalid" };
    const results: ModelVariantExactNameApiResult[] = [];
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
    if (
      nextAfterResourceId !== null &&
      (results.length !== limit ||
        results.at(-1)?.resourceId !== nextAfterResourceId)
    )
      return { kind: "invalid" };
    const expectedOrderingKey = normalizeExactSearchName(query);
    const seenIds = new Set<string>();
    let priorId = "";
    for (const result of results) {
      if (
        (recordType !== null && result.resourceType !== recordType) ||
        normalizeExactSearchName(result.displayName.value) !==
          expectedOrderingKey ||
        seenIds.has(result.resourceId) ||
        result.resourceId <= priorId
      )
        return { kind: "invalid" };
      seenIds.add(result.resourceId);
      priorId = result.resourceId;
    }
    const safePage = {
      outcome: "page",
      page: { publicationId, results, nextAfterResourceId },
    };
    if (UTF8.encode(JSON.stringify(safePage)).byteLength > maxResponseBytes)
      return { kind: "invalid" };
    return { kind: "page", results };
  } catch {
    return { kind: "invalid" };
  }
};

export const readModelVariantExactNameFromQueryV1 = async (
  input: ModelVariantExactNameApiInput,
): Promise<ModelVariantExactNameApiOutcome> => {
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

    const tierMethod = service.readModelVariantExactNameTierV1;
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
      query,
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
