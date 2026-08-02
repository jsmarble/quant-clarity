import {
  assertApiLimits,
  buildQueryServiceEnvelope,
  hashNormalizedQuery,
  issueCursor,
  reconcileRequestCursor,
  verifyCursor,
  type ApiLimits,
  type CursorKeyring,
  type CursorPayload,
  type DeploymentEnvironment,
  type NormalizedRequest,
  type QueryServiceEnvelope,
} from "@quant-clarity/api-core";
import { MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS } from "@quant-clarity/contracts";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const VARIANT_ID = new RegExp(`^var_${UUID_V4}$`, "u");
const PROVIDER_ID = new RegExp(`^prv_${UUID_V4}$`, "u");
const EVIDENCE_ID = new RegExp(`^evd_${UUID_V4}$`, "u");
const RFC3339_MILLISECONDS =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/u;
const UTF8 = new TextEncoder();
const AUDIENCE = "quantclarity-catalog-query-v1" as const;
const CURSOR_TTL_SECONDS = 15 * 60;
const MAX_CLOCK_SKEW_SECONDS = 30;
const MAX_DISPLAY_NAME_BYTES = MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS * 4;
const MAX_EVIDENCE_PER_RESULT = 25_000;
const MAX_EVIDENCE_PER_PAGE = 500_000;

export const EXACT_TIER_MARKERS = [
  "exact-v1:c",
  "exact-v1:r",
  "exact-v1:n",
  "exact-v1:p",
] as const;
export type ExactTierMarker = (typeof EXACT_TIER_MARKERS)[number];
type SearchResourceType = "model" | "provider" | "variant";
type SearchMatchKind = "canonical_name" | "provider_model_id" | "provider_name";
type SemanticDegraded = "disabled" | "not_applicable";

export type MergedExactSearchRpcResult = Readonly<{
  tierMarker: ExactTierMarker;
  resourceType: SearchResourceType;
  resourceId: string;
  matchKind: SearchMatchKind;
  displayName: Readonly<{
    state: "known";
    value: string;
    observed_at: string;
    evidence_ids: readonly string[];
  }>;
}>;

export interface MergedExactSearchCatalogQueryRpcV1 {
  resolvePublicationV1(input: unknown): Promise<unknown>;
  readMergedExactSearchV1(input: unknown): Promise<unknown>;
}

export type MergedExactSearchCollection = Readonly<{
  data: readonly Readonly<{
    resource_type: SearchResourceType;
    resource_id: string;
    display_name: MergedExactSearchRpcResult["displayName"];
    match_kind: SearchMatchKind;
    semantic_degraded: SemanticDegraded;
  }>[];
  page: Readonly<{ next_cursor: string | null; limit: number }>;
  meta: Readonly<{
    resource: "search";
    publication_id: string;
    schema_version: "1.0.0";
    sort: readonly ["relevance", "stable_id"];
    filters: Readonly<Record<string, string>>;
    semantic_degraded: SemanticDegraded;
  }>;
}>;

export type MergedExactSearchApiOutcome =
  | Readonly<{ success: true; collection: MergedExactSearchCollection }>
  | Readonly<{
      success: false;
      code: "publication_expired";
      currentPublicationId: string;
    }>
  | Readonly<{
      success: false;
      code:
        | "integrity_failure"
        | "invalid_cursor"
        | "invalid_input"
        | "publication_not_ready"
        | "read_failure";
    }>;

export type MergedExactSearchApiInput = Readonly<{
  service: MergedExactSearchCatalogQueryRpcV1;
  request: NormalizedRequest;
  environment: DeploymentEnvironment;
  limits: ApiLimits;
  cursorKeyring: CursorKeyring;
  nowSeconds: number;
  maximumClockSkewSeconds: number;
  subtle: SubtleCrypto;
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
  const actual = (ownKeys as string[]).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    expected.some((key, index) => actual[index] !== key)
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
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return null;
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength)
    return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== length + 1 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" &&
          (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)),
    )
  )
    return null;
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
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
};

const validUnicodeScalars = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
};

const validEnvironment = (value: unknown): value is DeploymentEnvironment =>
  value === "local" ||
  value === "preview" ||
  value === "production" ||
  value === "test";

const canonicalTimestamp = (value: string): boolean => {
  if (!RFC3339_MILLISECONDS.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

type ParsedRequest = Readonly<{
  request: NormalizedRequest;
  recordType: SearchResourceType | null;
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
      (request.cursor !== null && typeof request.cursor !== "string") ||
      request.hasQueryString !== true ||
      typeof request.limitProvided !== "boolean" ||
      typeof request.sortProvided !== "boolean" ||
      !Number.isSafeInteger(request.limit) ||
      (request.limit as number) < 1 ||
      (request.limit as number) > 20 ||
      (request.publicationHeader !== null &&
        (typeof request.publicationHeader !== "string" ||
          !PUBLICATION_ID.test(request.publicationHeader))) ||
      typeof request.query !== "string" ||
      request.query.length === 0 ||
      !validUnicodeScalars(request.query) ||
      request.query !== request.query.normalize("NFC").trim() ||
      UTF8.encode(request.query).byteLength > 200
    )
      return null;
    const operation = snapshotOwnRecord(request.operation, ["kind"]);
    const route = snapshotOwnRecord(request.route, ["operation", "policy"]);
    const routeOperation = snapshotOwnRecord(route?.operation, ["kind"]);
    const filters = snapshotOwnRecord(request.filters, []);
    let recordType: SearchResourceType | null = null;
    let safeFilters: Readonly<Record<string, string>> = {};
    if (filters === null) {
      const typed = snapshotOwnRecord(request.filters, ["record_type"]);
      if (
        typed === null ||
        (typed.record_type !== "model" &&
          typed.record_type !== "variant" &&
          typed.record_type !== "provider")
      )
        return null;
      recordType = typed.record_type;
      safeFilters = { record_type: recordType };
    }
    const sort = snapshotArray(request.sort, 2);
    if (
      operation?.kind !== "search" ||
      route?.policy !== "search" ||
      routeOperation?.kind !== "search" ||
      sort?.length !== 2 ||
      sort[0] !== "relevance" ||
      sort[1] !== "stable_id"
    )
      return null;
    return {
      recordType,
      request: {
        cursor: request.cursor,
        filters: safeFilters,
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
    const fields = [
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
    ];
    const snapshot = snapshotOwnRecord(value, fields);
    if (snapshot === null) return null;
    const limits = { ...snapshot } as unknown as ApiLimits;
    assertApiLimits(limits);
    return limits;
  } catch {
    return null;
  }
};

const snapshotKeyring = (value: unknown): CursorKeyring | null => {
  try {
    const keyring = snapshotOwnRecord(value, ["current", "next"]);
    if (keyring === null) return null;
    const parseKey = (raw: unknown): CursorKeyring["current"] | null => {
      const key = snapshotOwnRecord(raw, ["id", "secret"]);
      if (
        key === null ||
        typeof key.id !== "string" ||
        !KEY_ID.test(key.id) ||
        !(key.secret instanceof Uint8Array) ||
        key.secret.byteLength < 32
      )
        return null;
      return { id: key.id, secret: new Uint8Array(key.secret) };
    };
    const current = parseKey(keyring.current);
    const next = keyring.next === null ? null : parseKey(keyring.next);
    if (
      current === null ||
      (keyring.next !== null && next === null) ||
      next?.id === current.id
    )
      return null;
    return { current, next };
  } catch {
    return null;
  }
};

type ResolverClassification =
  | Readonly<{ kind: "selected"; publicationId: string; bookmark: string }>
  | Readonly<{
      kind: "failure";
      outcome: Exclude<MergedExactSearchApiOutcome, { success: true }>;
    }>
  | Readonly<{ kind: "invalid" }>;

const classifyResolver = (value: unknown): ResolverClassification => {
  try {
    const failure = snapshotOwnRecord(value, ["outcome"]);
    if (failure !== null)
      return failure.outcome === "integrity_failure" ||
        failure.outcome === "publication_not_ready" ||
        failure.outcome === "read_failure"
        ? {
            kind: "failure",
            outcome: { success: false, code: failure.outcome },
          }
        : { kind: "invalid" };
    const expired = snapshotOwnRecord(value, [
      "currentPublicationId",
      "outcome",
    ]);
    if (expired !== null)
      return expired.outcome === "publication_expired" &&
        typeof expired.currentPublicationId === "string" &&
        PUBLICATION_ID.test(expired.currentPublicationId)
        ? {
            kind: "failure",
            outcome: {
              success: false,
              code: "publication_expired",
              currentPublicationId: expired.currentPublicationId,
            },
          }
        : { kind: "invalid" };
    const selected = snapshotOwnRecord(value, [
      "bookmark",
      "outcome",
      "publicationId",
    ]);
    if (
      selected?.outcome !== "selected" ||
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
  evidenceLimit: number,
): MergedExactSearchRpcResult["displayName"] | null => {
  const fact = snapshotOwnRecord(value, [
    "evidence_ids",
    "observed_at",
    "state",
    "value",
  ]);
  if (
    fact?.state !== "known" ||
    typeof fact.value !== "string" ||
    !validUnicodeScalars(fact.value) ||
    Array.from(fact.value).length === 0 ||
    Array.from(fact.value).length > MODEL_DISPLAY_NAME_MAX_UNICODE_SCALARS ||
    UTF8.encode(fact.value).byteLength > MAX_DISPLAY_NAME_BYTES ||
    typeof fact.observed_at !== "string" ||
    !canonicalTimestamp(fact.observed_at)
  )
    return null;
  const evidence = snapshotArray(fact.evidence_ids, evidenceLimit);
  if (
    evidence === null ||
    evidence.length === 0 ||
    evidence.some((id) => typeof id !== "string" || !EVIDENCE_ID.test(id)) ||
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

const validMarkerResult = (
  marker: ExactTierMarker,
  resourceType: SearchResourceType,
  matchKind: SearchMatchKind,
): boolean =>
  marker === "exact-v1:c"
    ? (resourceType === "model" || resourceType === "variant") &&
      matchKind === "canonical_name"
    : marker === "exact-v1:r" || marker === "exact-v1:n"
      ? (resourceType === "model" || resourceType === "variant") &&
        matchKind === "provider_model_id"
      : resourceType === "provider" && matchKind === "provider_name";

const markerIndex = (marker: ExactTierMarker): number =>
  EXACT_TIER_MARKERS.indexOf(marker);

const markerAcceptsStableId = (
  marker: ExactTierMarker,
  stableId: string,
): boolean =>
  marker === "exact-v1:p"
    ? PROVIDER_ID.test(stableId)
    : MODEL_ID.test(stableId) || VARIANT_ID.test(stableId);

const snapshotServiceMethod = (
  service: object | ((...values: never[]) => unknown),
  name: string,
): ((input: unknown) => Promise<unknown>) | null => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(service, name);
    return descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "function"
      ? (descriptor.value as (input: unknown) => Promise<unknown>)
      : null;
  } catch {
    return null;
  }
};

type PageClassification =
  | Readonly<{
      kind: "page";
      results: readonly MergedExactSearchRpcResult[];
      nextContinuation: Readonly<{
        tierMarker: ExactTierMarker;
        resourceId: string;
      }> | null;
      semanticDegraded: SemanticDegraded;
    }>
  | Readonly<{ kind: "failure"; code: "integrity_failure" | "read_failure" }>
  | Readonly<{ kind: "invalid" }>;

const classifyPage = (
  value: unknown,
  publicationId: string,
  limit: number,
  recordType: SearchResourceType | null,
  incomingContinuation: Readonly<{
    tierMarker: ExactTierMarker;
    resourceId: string;
  }> | null,
  maxResponseBytes: number,
): PageClassification => {
  try {
    const failure = snapshotOwnRecord(value, ["outcome"]);
    if (failure !== null)
      return failure.outcome === "integrity_failure" ||
        failure.outcome === "read_failure"
        ? { kind: "failure", code: failure.outcome }
        : { kind: "invalid" };
    const response = snapshotOwnRecord(value, ["outcome", "page"]);
    if (response?.outcome !== "page") return { kind: "invalid" };
    const page = snapshotOwnRecord(response.page, [
      "nextContinuation",
      "publicationId",
      "results",
      "semanticDegraded",
    ]);
    const expectedDegradation: SemanticDegraded =
      recordType === "provider" ? "not_applicable" : "disabled";
    if (
      page?.publicationId !== publicationId ||
      page.semanticDegraded !== expectedDegradation
    )
      return { kind: "invalid" };
    const rows = snapshotArray(page.results, limit);
    if (rows === null) return { kind: "invalid" };
    const results: MergedExactSearchRpcResult[] = [];
    const seen = new Set<string>();
    let priorMarker: ExactTierMarker | null =
      incomingContinuation?.tierMarker ?? null;
    let priorId = incomingContinuation?.resourceId ?? "";
    let remainingEvidence = MAX_EVIDENCE_PER_PAGE;
    for (const row of rows) {
      const result = snapshotOwnRecord(row, [
        "displayName",
        "matchKind",
        "resourceId",
        "resourceType",
        "tierMarker",
      ]);
      if (
        result === null ||
        !EXACT_TIER_MARKERS.includes(result.tierMarker as ExactTierMarker) ||
        (result.resourceType !== "model" &&
          result.resourceType !== "variant" &&
          result.resourceType !== "provider") ||
        (result.matchKind !== "canonical_name" &&
          result.matchKind !== "provider_model_id" &&
          result.matchKind !== "provider_name") ||
        typeof result.resourceId !== "string"
      )
        return { kind: "invalid" };
      const tierMarker = result.tierMarker as ExactTierMarker;
      const resourceType = result.resourceType;
      const matchKind = result.matchKind;
      const validId =
        resourceType === "model"
          ? MODEL_ID.test(result.resourceId)
          : resourceType === "variant"
            ? VARIANT_ID.test(result.resourceId)
            : PROVIDER_ID.test(result.resourceId);
      const displayName = snapshotFact(
        result.displayName,
        Math.min(MAX_EVIDENCE_PER_RESULT, remainingEvidence),
      );
      if (
        !validId ||
        !validMarkerResult(tierMarker, resourceType, matchKind) ||
        displayName === null ||
        (recordType !== null && resourceType !== recordType) ||
        seen.has(result.resourceId) ||
        (priorMarker !== null &&
          (markerIndex(tierMarker) < markerIndex(priorMarker) ||
            (tierMarker === priorMarker && result.resourceId <= priorId)))
      )
        return { kind: "invalid" };
      remainingEvidence -= displayName.evidence_ids.length;
      seen.add(result.resourceId);
      priorMarker = tierMarker;
      priorId = result.resourceId;
      results.push({
        tierMarker,
        resourceType,
        resourceId: result.resourceId,
        matchKind,
        displayName,
      });
    }
    let nextContinuation: {
      tierMarker: ExactTierMarker;
      resourceId: string;
    } | null = null;
    if (page.nextContinuation !== null) {
      const continuation = snapshotOwnRecord(page.nextContinuation, [
        "resourceId",
        "tierMarker",
      ]);
      const last = results.at(-1);
      if (
        continuation === null ||
        !EXACT_TIER_MARKERS.includes(
          continuation.tierMarker as ExactTierMarker,
        ) ||
        typeof continuation.resourceId !== "string" ||
        results.length !== limit ||
        last === undefined ||
        continuation.tierMarker !== last.tierMarker ||
        continuation.resourceId !== last.resourceId
      )
        return { kind: "invalid" };
      nextContinuation = {
        tierMarker: continuation.tierMarker as ExactTierMarker,
        resourceId: continuation.resourceId,
      };
    }
    const safe = {
      outcome: "page",
      page: {
        publicationId,
        results,
        nextContinuation,
        semanticDegraded: expectedDegradation,
      },
    };
    if (UTF8.encode(JSON.stringify(safe)).byteLength > maxResponseBytes)
      return { kind: "invalid" };
    return {
      kind: "page",
      results,
      nextContinuation,
      semanticDegraded: expectedDegradation,
    };
  } catch {
    return { kind: "invalid" };
  }
};

export const readMergedExactSearchFromQueryV1 = async (
  input: MergedExactSearchApiInput,
): Promise<MergedExactSearchApiOutcome> => {
  try {
    const outer = snapshotOwnRecord(input, [
      "cursorKeyring",
      "environment",
      "limits",
      "maximumClockSkewSeconds",
      "nowSeconds",
      "request",
      "service",
      "subtle",
    ]);
    const parsed = parseRequest(outer?.request);
    const limits = snapshotLimits(outer?.limits);
    const keyring = snapshotKeyring(outer?.cursorKeyring);
    if (
      outer === null ||
      parsed === null ||
      limits === null ||
      keyring === null ||
      !validEnvironment(outer.environment) ||
      !Number.isSafeInteger(outer.nowSeconds) ||
      (outer.nowSeconds as number) < 0 ||
      !Number.isSafeInteger(outer.maximumClockSkewSeconds) ||
      (outer.maximumClockSkewSeconds as number) < 0 ||
      (outer.maximumClockSkewSeconds as number) > MAX_CLOCK_SKEW_SECONDS ||
      (typeof outer.service !== "object" &&
        typeof outer.service !== "function") ||
      outer.service === null ||
      (typeof outer.subtle !== "object" &&
        typeof outer.subtle !== "function") ||
      outer.subtle === null
    )
      return { success: false, code: "invalid_input" };
    const nowSeconds = outer.nowSeconds as number;
    const subtle = outer.subtle as SubtleCrypto;
    let request = parsed.request;
    if (
      request.limit > Math.min(limits.maxSearchResults, limits.maxPageSize) ||
      UTF8.encode(request.query ?? "").byteLength >
        Math.min(limits.maxSearchQueryBytes, limits.maxQueryValueBytes) ||
      (request.cursor !== null &&
        request.cursor.length > limits.maxCursorCharacters)
    )
      return { success: false, code: "invalid_input" };

    let continuation: Readonly<{
      lastSortTuple: readonly [ExactTierMarker, string];
      stableId: string;
    }> | null = null;
    let requestedPublicationId = request.publicationHeader;
    let cursorTiming: Pick<
      CursorPayload,
      "issuedAtSeconds" | "expiresAtSeconds"
    > = {
      issuedAtSeconds: nowSeconds,
      expiresAtSeconds: nowSeconds + CURSOR_TTL_SECONDS,
    };
    if (request.cursor !== null) {
      let verified;
      try {
        verified = await verifyCursor(
          request.cursor,
          keyring,
          nowSeconds,
          outer.maximumClockSkewSeconds as number,
          subtle,
        );
      } catch {
        return { success: false, code: "invalid_input" };
      }
      if (!verified.success) return { success: false, code: "invalid_cursor" };
      let reconciled;
      try {
        reconciled = await reconcileRequestCursor(
          request,
          verified,
          limits,
          subtle,
        );
      } catch {
        return { success: false, code: "invalid_cursor" };
      }
      const tuple = verified.payload.lastSortTuple;
      if (
        tuple.length !== 2 ||
        !EXACT_TIER_MARKERS.includes(tuple[0] as ExactTierMarker) ||
        typeof tuple[1] !== "string" ||
        tuple[1] !== verified.payload.stableId ||
        !markerAcceptsStableId(tuple[0] as ExactTierMarker, tuple[1])
      )
        return { success: false, code: "invalid_cursor" };
      request = reconciled.request;
      requestedPublicationId = reconciled.publicationId;
      continuation = {
        lastSortTuple: [tuple[0] as ExactTierMarker, tuple[1]],
        stableId: tuple[1],
      };
      cursorTiming = {
        issuedAtSeconds: verified.payload.issuedAtSeconds,
        expiresAtSeconds: verified.payload.expiresAtSeconds,
      };

      // ADR 0016 cursors are shared across the eventual complete search route,
      // whose filter allowlist is wider than this B2 seam. Re-apply B2's closed
      // filter and sort policy after inherited cursor parameters are restored,
      // before publication resolution or any query-service/D1 access.
      const inherited = parseRequest(request);
      if (inherited === null) return { success: false, code: "invalid_cursor" };
      if (
        (inherited.recordType === "provider" &&
          continuation.lastSortTuple[0] !== "exact-v1:p") ||
        ((inherited.recordType === "model" ||
          inherited.recordType === "variant") &&
          (continuation.lastSortTuple[0] === "exact-v1:p" ||
            (inherited.recordType === "model"
              ? !MODEL_ID.test(continuation.stableId)
              : !VARIANT_ID.test(continuation.stableId))))
      )
        return { success: false, code: "invalid_cursor" };
      request = inherited.request;
    }

    const service = outer.service;
    const resolve = snapshotServiceMethod(service, "resolvePublicationV1");
    if (resolve === null) return { success: false, code: "invalid_input" };
    let resolutionValue: unknown;
    try {
      resolutionValue = await resolve.call(service, {
        version: 1,
        audience: AUDIENCE,
        environment: outer.environment,
        requestedPublicationId,
      });
    } catch {
      return { success: false, code: "read_failure" };
    }
    const resolution = classifyResolver(resolutionValue);
    if (resolution.kind === "failure") return resolution.outcome;
    if (resolution.kind === "invalid")
      return { success: false, code: "integrity_failure" };
    if (
      requestedPublicationId !== null &&
      resolution.publicationId !== requestedPublicationId
    )
      return { success: false, code: "integrity_failure" };

    let envelope: QueryServiceEnvelope;
    try {
      envelope = buildQueryServiceEnvelope(
        request,
        resolution.publicationId,
        outer.environment,
        continuation,
        limits,
      );
    } catch {
      return { success: false, code: "invalid_input" };
    }
    const read = snapshotServiceMethod(service, "readMergedExactSearchV1");
    if (read === null) return { success: false, code: "integrity_failure" };
    let pageValue: unknown;
    try {
      pageValue = await read.call(service, {
        version: 1,
        audience: AUDIENCE,
        environment: outer.environment,
        bookmark: resolution.bookmark,
        envelope,
      });
    } catch {
      return { success: false, code: "read_failure" };
    }
    const effectiveRecordType =
      typeof request.filters.record_type === "string"
        ? (request.filters.record_type as SearchResourceType)
        : null;
    const page = classifyPage(
      pageValue,
      resolution.publicationId,
      request.limit,
      effectiveRecordType,
      continuation === null
        ? null
        : {
            tierMarker: continuation.lastSortTuple[0],
            resourceId: continuation.stableId,
          },
      limits.maxResponseBytes,
    );
    if (page.kind === "failure") return { success: false, code: page.code };
    if (page.kind === "invalid")
      return { success: false, code: "integrity_failure" };

    let nextCursor: string | null = null;
    if (page.nextContinuation !== null) {
      try {
        const queryHash = await hashNormalizedQuery(request.query, subtle);
        if (queryHash === null)
          return { success: false, code: "integrity_failure" };
        nextCursor = await issueCursor(
          {
            version: 1,
            publicationId: resolution.publicationId,
            operation: "search",
            queryHash,
            filters: request.filters,
            sort: ["relevance", "stable_id"],
            limit: request.limit,
            lastSortTuple: [
              page.nextContinuation.tierMarker,
              page.nextContinuation.resourceId,
            ],
            stableId: page.nextContinuation.resourceId,
            ...cursorTiming,
          },
          keyring,
          subtle,
        );
      } catch {
        return { success: false, code: "integrity_failure" };
      }
    }
    const collection: MergedExactSearchCollection = {
      data: page.results.map((result) => ({
        resource_type: result.resourceType,
        resource_id: result.resourceId,
        display_name: result.displayName,
        match_kind: result.matchKind,
        semantic_degraded: page.semanticDegraded,
      })),
      page: { next_cursor: nextCursor, limit: request.limit },
      meta: {
        resource: "search",
        publication_id: resolution.publicationId,
        schema_version: "1.0.0",
        sort: ["relevance", "stable_id"],
        filters: request.filters as Readonly<Record<string, string>>,
        semantic_degraded: page.semanticDegraded,
      },
    };
    if (
      UTF8.encode(JSON.stringify(collection)).byteLength >
      limits.maxResponseBytes
    )
      return { success: false, code: "integrity_failure" };
    return { success: true, collection };
  } catch {
    return { success: false, code: "invalid_input" };
  }
};
