import {
  API_ROUTE_POLICIES,
  checkModelContract,
  checkSearchCollectionContract,
  checkVariantContract,
  type DatasetMetadata,
  type Methodology,
  type Model,
  type SearchCollection,
  type Variant,
} from "@quant-clarity/contracts";
import {
  parsePublicationPin,
  publicationCacheKey,
  reconcilePublicationPin,
  type PublicationCacheResourceType,
  type PublicationRepresentation,
} from "@quant-clarity/domain/publication-consistency";

export * from "./frontend-api-auth.js";

const UTF8 = new TextEncoder();
const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const STABLE_ID = new RegExp(
  `^(?:fam|mdl|var|prv|off|pcs|prc|evd)_${UUID_V4}$`,
  "u",
);
const MODEL_STABLE_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const MODEL_DETAIL_IDENTIFIER_MAX_CHARACTERS = 128;
export const MODEL_DETAIL_API_PATH_PREFIX = "/v1/models/" as const;
export const MODEL_DETAIL_FRONTEND_PATH_PREFIX = "/models/" as const;
export const EXACT_MODEL_SEARCH_API_PATH = "/v1/search" as const;
export const EXACT_MODEL_SEARCH_LIMIT = 20 as const;
export const EXACT_MODEL_SEARCH_QUERY_MAX_BYTES = 200;
export const EXACT_MODEL_SEARCH_CURSOR_MAX_CHARACTERS = 4096;
export const EXACT_MODEL_SEARCH_RAW_QUERY_MAX_BYTES = 4096;
export const EXACT_MODEL_SEARCH_PUBLIC_MAX_BYTES = 65_536;
export const EXACT_VARIANT_SEARCH_API_PATH = "/v1/variant-search" as const;
export const EXACT_VARIANT_SEARCH_LIMIT = 20 as const;
export const EXACT_VARIANT_SEARCH_QUERY_MAX_BYTES = 200;
export const EXACT_VARIANT_SEARCH_CURSOR_MAX_CHARACTERS = 4096;
export const EXACT_VARIANT_SEARCH_RAW_QUERY_MAX_BYTES = 4096;
export const EXACT_VARIANT_SEARCH_PUBLIC_MAX_BYTES = 65_536;
const SCHEMA_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const RFC3339_MILLISECONDS =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,18})?$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/u;
const METHODOLOGY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CURSOR_DOMAIN = "quantclarity-cursor-v1";
const CURSOR_VERSION = 1;
const CURSOR_TTL_SECONDS = 15 * 60;
const CURSOR_MAX_CHARACTERS = 4096;
const CURSOR_MAX_CLOCK_SKEW_SECONDS = 30;
const ENTITY_TAG = String.raw`(?:W/)?"[\x21\x23-\x7e]*"`;
const IF_NONE_MATCH_LIST = new RegExp(
  String.raw`^[\t ]*${ENTITY_TAG}(?:[\t ]*,[\t ]*${ENTITY_TAG})*[\t ]*$`,
  "u",
);

export type MethodologyRegistryEntry = Readonly<{
  effectiveAt: string;
  path: `/v1/methodologies/${string}`;
  version: string;
}>;

export type ModelDetailIdentifier = Readonly<{
  kind: "stable_id" | "slug";
  value: string;
}>;

export type CanonicalExactModelSearchQuery = Readonly<{
  cursor: string | null;
  query: string;
}>;

export type CanonicalExactVariantSearchQuery = Readonly<{
  cursor: string | null;
  query: string;
}>;

const hasValidUnicodeScalars = (value: string): boolean => {
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

/**
 * Builds the sole raw query representation accepted by the signed exact-Model
 * discovery channel. User text is normalized once; cursor bytes are not.
 */
export const canonicalExactModelSearchQuery = (
  query: unknown,
  cursor: unknown = null,
): string | null => {
  try {
    if (typeof query !== "string" || !hasValidUnicodeScalars(query))
      return null;
    const normalizedQuery = query.normalize("NFC").trim();
    if (
      normalizedQuery.length === 0 ||
      UTF8.encode(normalizedQuery).byteLength >
        EXACT_MODEL_SEARCH_QUERY_MAX_BYTES ||
      (cursor !== null &&
        (typeof cursor !== "string" ||
          cursor.length === 0 ||
          cursor.length > EXACT_MODEL_SEARCH_CURSOR_MAX_CHARACTERS ||
          !hasValidUnicodeScalars(cursor)))
    )
      return null;
    const parameters = new URLSearchParams();
    parameters.append("q", normalizedQuery);
    parameters.append("record_type", "model");
    parameters.append("limit", String(EXACT_MODEL_SEARCH_LIMIT));
    if (cursor !== null) parameters.append("cursor", cursor);
    const rawQuery = parameters.toString();
    return UTF8.encode(rawQuery).byteLength <=
      EXACT_MODEL_SEARCH_RAW_QUERY_MAX_BYTES
      ? rawQuery
      : null;
  } catch {
    return null;
  }
};

/**
 * Parses only the byte-canonical exact-Model discovery query. Equivalent
 * encodings, reordered parameters, defaults, additions, and duplicates fail.
 */
export const parseCanonicalExactModelSearchQuery = (
  rawQuery: unknown,
): CanonicalExactModelSearchQuery | null => {
  try {
    if (
      typeof rawQuery !== "string" ||
      rawQuery.length === 0 ||
      !hasValidUnicodeScalars(rawQuery) ||
      UTF8.encode(rawQuery).byteLength > EXACT_MODEL_SEARCH_RAW_QUERY_MAX_BYTES
    )
      return null;
    const parameters = new URLSearchParams(rawQuery);
    const keys = [...parameters.keys()];
    const expectedKeys = parameters.has("cursor")
      ? ["q", "record_type", "limit", "cursor"]
      : ["q", "record_type", "limit"];
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index]) ||
      parameters.get("record_type") !== "model" ||
      parameters.get("limit") !== String(EXACT_MODEL_SEARCH_LIMIT)
    )
      return null;
    const query = parameters.get("q");
    const cursor = parameters.get("cursor");
    if (query === null) return null;
    const canonical = canonicalExactModelSearchQuery(query, cursor);
    if (canonical !== rawQuery) return null;
    return Object.freeze({ cursor, query: query.normalize("NFC").trim() });
  } catch {
    return null;
  }
};

/**
 * Builds the sole raw query representation accepted by the purpose-separated
 * signed exact-Variant discovery channel. User text is normalized once;
 * cursor bytes are not.
 */
export const canonicalExactVariantSearchQuery = (
  query: unknown,
  cursor: unknown = null,
): string | null => {
  try {
    if (typeof query !== "string" || !hasValidUnicodeScalars(query))
      return null;
    const normalizedQuery = query.normalize("NFC").trim();
    if (
      normalizedQuery.length === 0 ||
      UTF8.encode(normalizedQuery).byteLength >
        EXACT_VARIANT_SEARCH_QUERY_MAX_BYTES ||
      (cursor !== null &&
        (typeof cursor !== "string" ||
          cursor.length === 0 ||
          cursor.length > EXACT_VARIANT_SEARCH_CURSOR_MAX_CHARACTERS ||
          !hasValidUnicodeScalars(cursor)))
    )
      return null;
    const parameters = new URLSearchParams();
    parameters.append("q", normalizedQuery);
    parameters.append("record_type", "variant");
    parameters.append("limit", String(EXACT_VARIANT_SEARCH_LIMIT));
    if (cursor !== null) parameters.append("cursor", cursor);
    const rawQuery = parameters.toString();
    return UTF8.encode(rawQuery).byteLength <=
      EXACT_VARIANT_SEARCH_RAW_QUERY_MAX_BYTES
      ? rawQuery
      : null;
  } catch {
    return null;
  }
};

/** Parses only the byte-canonical exact-Variant discovery query. */
export const parseCanonicalExactVariantSearchQuery = (
  rawQuery: unknown,
): CanonicalExactVariantSearchQuery | null => {
  try {
    if (
      typeof rawQuery !== "string" ||
      rawQuery.length === 0 ||
      !hasValidUnicodeScalars(rawQuery) ||
      UTF8.encode(rawQuery).byteLength >
        EXACT_VARIANT_SEARCH_RAW_QUERY_MAX_BYTES
    )
      return null;
    const parameters = new URLSearchParams(rawQuery);
    const keys = [...parameters.keys()];
    const expectedKeys = parameters.has("cursor")
      ? ["q", "record_type", "limit", "cursor"]
      : ["q", "record_type", "limit"];
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index]) ||
      parameters.get("record_type") !== "variant" ||
      parameters.get("limit") !== String(EXACT_VARIANT_SEARCH_LIMIT)
    )
      return null;
    const query = parameters.get("q");
    const cursor = parameters.get("cursor");
    if (query === null) return null;
    const canonical = canonicalExactVariantSearchQuery(query, cursor);
    if (canonical !== rawQuery) return null;
    return Object.freeze({ cursor, query: query.normalize("NFC").trim() });
  } catch {
    return null;
  }
};

/**
 * Classifies one exact public Model identifier without decoding, coercion, or
 * normalization. Slugs are ASCII by grammar, so their character and UTF-8
 * byte lengths are identical.
 */
export const classifyModelDetailIdentifier = (
  value: unknown,
): ModelDetailIdentifier | null => {
  try {
    if (typeof value !== "string") return null;
    if (MODEL_STABLE_ID.test(value))
      return Object.freeze({ kind: "stable_id", value });
    if (
      value.length > 0 &&
      value.length <= MODEL_DETAIL_IDENTIFIER_MAX_CHARACTERS &&
      SLUG.test(value)
    )
      return Object.freeze({ kind: "slug", value });
    return null;
  } catch {
    return null;
  }
};

/** Parses only one exact, single-segment v1 Model-detail API pathname. */
export const parseModelDetailApiPath = (
  pathname: unknown,
): ModelDetailIdentifier | null => {
  try {
    if (
      typeof pathname !== "string" ||
      !pathname.startsWith(MODEL_DETAIL_API_PATH_PREFIX)
    )
      return null;
    return classifyModelDetailIdentifier(
      pathname.slice(MODEL_DETAIL_API_PATH_PREFIX.length),
    );
  } catch {
    return null;
  }
};

/** Parses only one exact, single-segment frontend Model pathname. */
export const parseModelDetailFrontendPath = (
  pathname: unknown,
): ModelDetailIdentifier | null => {
  try {
    if (
      typeof pathname !== "string" ||
      !pathname.startsWith(MODEL_DETAIL_FRONTEND_PATH_PREFIX)
    )
      return null;
    return classifyModelDetailIdentifier(
      pathname.slice(MODEL_DETAIL_FRONTEND_PATH_PREFIX.length),
    );
  } catch {
    return null;
  }
};

/** Builds the only canonical frontend path for a valid Model identifier. */
export const modelDetailFrontendPath = (
  identifier: unknown,
): `/models/${string}` | null => {
  const classified = classifyModelDetailIdentifier(identifier);
  return classified === null
    ? null
    : `${MODEL_DETAIL_FRONTEND_PATH_PREFIX}${classified.value}`;
};

/** Builds the only canonical internal/public API path for a valid identifier. */
export const modelDetailApiPath = (
  identifier: unknown,
): `/v1/models/${string}` | null => {
  const classified = classifyModelDetailIdentifier(identifier);
  return classified === null
    ? null
    : `${MODEL_DETAIL_API_PATH_PREFIX}${classified.value}`;
};

const METHODOLOGY_REGISTRY: Readonly<Record<string, MethodologyRegistryEntry>> =
  Object.freeze({
    "1.0.0": Object.freeze({
      effectiveAt: "2026-08-01T00:00:00.000Z",
      path: "/v1/methodologies/1.0.0",
      version: "1.0.0",
    }),
  });

/** Returns one immutable, code-owned methodology entry or null. */
export function methodologyRegistryEntry(
  version: unknown,
): MethodologyRegistryEntry | null {
  try {
    if (
      typeof version !== "string" ||
      !METHODOLOGY_VERSION.test(version) ||
      !Object.hasOwn(METHODOLOGY_REGISTRY, version)
    )
      return null;
    const entry: unknown = METHODOLOGY_REGISTRY[version];
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.getPrototypeOf(entry) !== Object.prototype ||
      !Object.isFrozen(entry)
    )
      return null;
    const keys = Reflect.ownKeys(entry);
    if (
      keys.length !== 3 ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          !new Set(["effectiveAt", "path", "version"]).has(key),
      )
    )
      return null;
    const values: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of ["effectiveAt", "path", "version"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      )
        return null;
      values[key] = descriptor.value;
    }
    if (
      values.version !== version ||
      values.path !== `/v1/methodologies/${version}` ||
      typeof values.effectiveAt !== "string" ||
      !RFC3339_MILLISECONDS.test(values.effectiveAt) ||
      new Date(Date.parse(values.effectiveAt)).toISOString() !==
        values.effectiveAt
    )
      return null;
    return entry as MethodologyRegistryEntry;
  } catch {
    return null;
  }
}

export interface ApiLimits {
  defaultPageSize: number;
  maxBodyBytes: number;
  maxCpuMilliseconds: number;
  maxCursorCharacters: number;
  maxErrorDetails: number;
  maxFilterValues: number;
  maxPageSize: number;
  maxPathBytes: number;
  maxQueryBytes: number;
  maxQueryValueBytes: number;
  maxResponseBytes: number;
  maxSemanticCalls: number;
  maxSemanticCandidates: number;
  maxSearchQueryBytes: number;
  maxSearchResults: number;
  maxSubrequests: number;
  maxUpstreamCalls: number;
  maxUrlBytes: number;
}

export type ApiMethod = "GET" | "HEAD" | "OPTIONS";
export type RateCostClass = "read" | "search";
export type Representation = "json";
export type NormalizedFilterValue = boolean | string;
export type CursorScalar = boolean | null | string;

type CollectionName =
  | "evidence"
  | "modelFamilies"
  | "models"
  | "offerings"
  | "precisionObservations"
  | "prices"
  | "providers"
  | "variants";

export type QueryOperation =
  | { kind: "metadata" }
  | { format: "json" | "yaml"; kind: "openapi" }
  | { kind: "methodology_detail"; version: string }
  | { collection: CollectionName; kind: "collection" }
  | {
      collection: "offerings";
      kind: "related_collection";
      ownerId: string;
      ownerType: "model" | "provider" | "variant";
    }
  | {
      identifier: string;
      kind: "detail";
      resourceType: PublicationCacheResourceType;
    }
  | { kind: "search" };

export interface RouteMatch {
  operation: QueryOperation;
  policy: keyof typeof API_ROUTE_POLICIES | null;
}

export interface RequestInput {
  bodyBytes: number;
  hasQueryString: boolean;
  method: string;
  pathname: string;
  publicationHeader: string | null;
  rawQuery: string;
}

export interface NormalizedRequest {
  cursor: string | null;
  filters: Readonly<Record<string, NormalizedFilterValue>>;
  hasQueryString: boolean;
  limit: number;
  limitProvided: boolean;
  method: ApiMethod;
  operation: QueryOperation;
  publicationHeader: string | null;
  query: string | null;
  route: RouteMatch;
  sort: readonly string[];
  sortProvided: boolean;
}

type ApiValidationCoreResult =
  | { request: NormalizedRequest; success: true }
  | { error: ApiError; success: false };

export type ApiValidationResult =
  | { cost: RateCostClass; request: NormalizedRequest; success: true }
  | { cost: RateCostClass; error: ApiError; success: false };

export interface ErrorDetail {
  parameter: string;
  reason: string;
}

export interface ApiError {
  code:
    | "invalid_cursor"
    | "invalid_parameter"
    | "method_not_allowed"
    | "query_too_large"
    | "resource_not_found"
    | "unsupported_filter";
  details?: readonly ErrorDetail[];
  message: string;
  status: 400 | 404 | 405 | 413;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertApiLimits(limits: ApiLimits): void {
  const names = [
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
    "maxSubrequests",
    "maxUpstreamCalls",
    "maxUrlBytes",
  ] as const satisfies readonly (keyof ApiLimits)[];
  for (const name of names) {
    const value = limits[name];
    if (!positiveInteger(value))
      throw new RangeError(
        `${name} must be an explicitly injected positive integer.`,
      );
  }
  for (const name of ["maxSemanticCalls", "maxSemanticCandidates"] as const) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 0)
      throw new RangeError(
        `${name} must be an explicitly injected non-negative integer.`,
      );
  }
  if (limits.defaultPageSize > limits.maxPageSize)
    throw new RangeError("defaultPageSize cannot exceed maxPageSize.");
  if (limits.defaultPageSize !== 25)
    throw new RangeError("defaultPageSize must equal the approved value 25.");
  if (limits.maxSearchResults > limits.maxPageSize)
    throw new RangeError("maxSearchResults cannot exceed maxPageSize.");
  if (limits.maxUpstreamCalls > limits.maxSubrequests)
    throw new RangeError("maxUpstreamCalls cannot exceed maxSubrequests.");
  if (limits.maxSemanticCalls > limits.maxUpstreamCalls)
    throw new RangeError("maxSemanticCalls cannot exceed maxUpstreamCalls.");
  if (limits.maxCursorCharacters > CURSOR_MAX_CHARACTERS)
    throw new RangeError("maxCursorCharacters cannot exceed 4096.");
  if (limits.maxPageSize > 100)
    throw new RangeError("maxPageSize cannot exceed 100.");
  if (limits.maxSearchResults > 20)
    throw new RangeError("maxSearchResults cannot exceed 20.");
  if (limits.maxSearchQueryBytes > 200)
    throw new RangeError("maxSearchQueryBytes cannot exceed 200.");
  if (limits.maxFilterValues > 10)
    throw new RangeError("maxFilterValues cannot exceed 10.");
  if (limits.maxSemanticCalls !== 0 || limits.maxSemanticCandidates !== 0)
    throw new RangeError("Semantic processing ceilings must remain zero.");
}

function safeFilterValue(value: string): boolean {
  if (value.length === 0 || value.length > 512) return false;
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point === undefined || point <= 0x1f || point === 0x7f) return false;
  }
  return true;
}

function failure(
  code: ApiError["code"],
  message: string,
  status: ApiError["status"],
  detail?: ErrorDetail,
): ApiValidationCoreResult {
  return {
    error: {
      code,
      ...(detail === undefined ? {} : { details: [detail] }),
      message,
      status,
    },
    success: false,
  };
}

function detail(
  resourceType: PublicationCacheResourceType,
  identifier: string,
): RouteMatch | null {
  if (UTF8.encode(identifier).byteLength > 256) return null;
  const prefixes = {
    "evidence-summary": "evd_",
    "model-family": "fam_",
    model: "mdl_",
    offering: "off_",
    precision: "prc_",
    price: "pcs_",
    provider: "prv_",
    variant: "var_",
  } as const satisfies Record<PublicationCacheResourceType, string>;
  const stableIdentifier = new RegExp(
    `^${prefixes[resourceType]}${UUID_V4}$`,
    "u",
  ).test(identifier);
  const slugEligible =
    resourceType === "model-family" ||
    resourceType === "model" ||
    resourceType === "provider" ||
    resourceType === "variant";
  if (!stableIdentifier && (!slugEligible || !SLUG.test(identifier)))
    return null;
  const policies = {
    "evidence-summary": "evidence",
    "model-family": "modelFamilies",
    model: "models",
    offering: "offerings",
    precision: "precisionObservations",
    price: "prices",
    provider: "providers",
    variant: "variants",
  } as const satisfies Record<
    PublicationCacheResourceType,
    keyof typeof API_ROUTE_POLICIES
  >;
  return {
    operation: { identifier, kind: "detail", resourceType },
    policy: policies[resourceType],
  };
}

function related(
  ownerType: "model" | "provider" | "variant",
  ownerId: string,
): RouteMatch | null {
  const prefix = { model: "mdl_", provider: "prv_", variant: "var_" }[
    ownerType
  ];
  if (!new RegExp(`^${prefix}${UUID_V4}$`, "u").test(ownerId)) return null;
  return {
    operation: {
      collection: "offerings",
      kind: "related_collection",
      ownerId,
      ownerType,
    },
    policy: "offerings",
  };
}

export function matchRoute(pathname: string): RouteMatch | null {
  if (
    pathname.length === 0 ||
    pathname.includes("%") ||
    pathname.includes("//") ||
    (pathname.length > 1 && pathname.endsWith("/"))
  )
    return null;
  if (pathname === "/v1/metadata")
    return { operation: { kind: "metadata" }, policy: null };
  if (pathname === "/v1/openapi.json")
    return {
      operation: { format: "json", kind: "openapi" },
      policy: null,
    };
  if (pathname === "/v1/openapi.yaml")
    return {
      operation: { format: "yaml", kind: "openapi" },
      policy: null,
    };
  if (
    pathname === EXACT_MODEL_SEARCH_API_PATH ||
    pathname === EXACT_VARIANT_SEARCH_API_PATH
  )
    return { operation: { kind: "search" }, policy: "search" };

  const collection = {
    "/v1/evidence": "evidence",
    "/v1/model-families": "modelFamilies",
    "/v1/models": "models",
    "/v1/offerings": "offerings",
    "/v1/precision-observations": "precisionObservations",
    "/v1/prices": "prices",
    "/v1/providers": "providers",
    "/v1/variants": "variants",
  }[pathname] as CollectionName | undefined;
  if (collection !== undefined)
    return {
      operation: { collection, kind: "collection" },
      policy: collection,
    };

  const segments = pathname.split("/");
  if (segments.length < 4 || segments[0] !== "" || segments[1] !== "v1")
    return null;
  const resource = segments[2];
  const identifier = segments[3];
  if (identifier === undefined) return null;
  if (segments.length === 4 && resource === "methodologies")
    return METHODOLOGY_VERSION.test(identifier)
      ? {
          operation: { kind: "methodology_detail", version: identifier },
          policy: "methodologies",
        }
      : null;
  if (segments.length === 5 && segments[4] === "offerings") {
    if (resource === "models") return related("model", identifier);
    if (resource === "providers") return related("provider", identifier);
    if (resource === "variants") return related("variant", identifier);
    return null;
  }
  if (segments.length !== 4) return null;
  switch (resource) {
    case "evidence":
      return detail("evidence-summary", identifier);
    case "model-families":
      return detail("model-family", identifier);
    case "models":
      return detail("model", identifier);
    case "offerings":
      return detail("offering", identifier);
    case "precision-observations":
      return detail("precision", identifier);
    case "prices":
      return detail("price", identifier);
    case "providers":
      return detail("provider", identifier);
    case "variants":
      return detail("variant", identifier);
    default:
      return null;
  }
}

function validPercentEncoding(rawQuery: string): boolean {
  if (/%(?![0-9a-f]{2})/iu.test(rawQuery)) return false;
  try {
    for (const component of rawQuery.split(/[&=]/u))
      decodeURIComponent(component.replaceAll("+", " "));
    return true;
  } catch {
    return false;
  }
}

function normalizedText(value: string): string {
  return value.normalize("NFC").trim();
}

const BOOLEAN_FILTERS = new Set([
  "promotional",
  "stale",
  "stale_offering",
  "standard_comparable",
]);
const TIMESTAMP_FILTERS = new Set([
  "effective_since",
  "observed_since",
  "updated_since",
]);
const DECIMAL_FILTERS = new Set(["price_max", "price_min"]);
const SINGLE_VALUE_FILTERS = new Set([
  ...BOOLEAN_FILTERS,
  ...TIMESTAMP_FILTERS,
  ...DECIMAL_FILTERS,
  "currency",
]);

function parseFilter(
  name: string,
  rawValue: string,
  limits: Pick<ApiLimits, "maxQueryValueBytes">,
): { count: number; value: NormalizedFilterValue } | null {
  const normalized = normalizedText(rawValue);
  if (
    normalized.length === 0 ||
    UTF8.encode(normalized).byteLength > limits.maxQueryValueBytes
  )
    return null;
  if (BOOLEAN_FILTERS.has(name)) {
    if (normalized === "true") return { count: 1, value: true };
    if (normalized === "false") return { count: 1, value: false };
    return null;
  }
  if (TIMESTAMP_FILTERS.has(name))
    return RFC3339_MILLISECONDS.test(normalized)
      ? { count: 1, value: normalized }
      : null;
  if (DECIMAL_FILTERS.has(name))
    return DECIMAL.test(normalized) ? { count: 1, value: normalized } : null;
  if (name === "currency")
    return CURRENCY.test(normalized) ? { count: 1, value: normalized } : null;
  const values = normalized.split(",").map(normalizedText);
  if (SINGLE_VALUE_FILTERS.has(name) && values.length !== 1) return null;
  if (
    values.some((value) => !safeFilterValue(value)) ||
    new Set(values).size !== values.length
  )
    return null;
  const canonical = [...values].sort().join(",");
  return { count: values.length, value: canonical };
}

function method(value: string): ApiMethod | null {
  if (value === "GET" || value === "HEAD" || value === "OPTIONS") return value;
  return null;
}

function noQueryRoute(operation: QueryOperation): boolean {
  return (
    operation.kind === "detail" ||
    operation.kind === "metadata" ||
    operation.kind === "methodology_detail" ||
    operation.kind === "openapi"
  );
}

function validateAndNormalizeRequestCore(
  input: RequestInput,
  limits: ApiLimits,
): ApiValidationCoreResult {
  assertApiLimits(limits);
  if (!input.hasQueryString && input.rawQuery !== "")
    return failure(
      "invalid_parameter",
      "The query-string marker is inconsistent.",
      400,
    );
  if (!Number.isSafeInteger(input.bodyBytes) || input.bodyBytes < 0)
    return failure(
      "invalid_parameter",
      "The request body size is invalid.",
      400,
    );
  if (input.bodyBytes > limits.maxBodyBytes)
    return failure(
      "query_too_large",
      "The request body exceeds the configured size limit.",
      413,
    );
  const pathnameBytes = UTF8.encode(input.pathname).byteLength;
  const queryBytes = UTF8.encode(input.rawQuery).byteLength;
  const urlBytes = pathnameBytes + (input.hasQueryString ? queryBytes + 1 : 0);
  if (
    pathnameBytes > limits.maxPathBytes ||
    queryBytes > limits.maxQueryBytes ||
    urlBytes > limits.maxUrlBytes
  )
    return failure(
      "query_too_large",
      "The request target exceeds the configured size limit.",
      413,
    );

  const route = matchRoute(input.pathname);
  const parsedMethod = method(input.method);
  if (parsedMethod === null)
    return failure(
      "method_not_allowed",
      "Only GET, HEAD, and OPTIONS are supported.",
      405,
    );
  if (route === null)
    return failure(
      "resource_not_found",
      "The requested resource does not exist.",
      404,
    );
  if (input.bodyBytes !== 0)
    return failure(
      "invalid_parameter",
      "Public read requests do not accept a request body.",
      400,
    );
  if (!validPercentEncoding(input.rawQuery))
    return failure("invalid_parameter", "The query string is malformed.", 400);

  try {
    parsePublicationPin(input.publicationHeader);
  } catch {
    return failure(
      "invalid_parameter",
      "The publication header is malformed.",
      400,
      { parameter: "X-QuantClarity-Publication", reason: "invalid" },
    );
  }

  const parameters = new URLSearchParams(input.rawQuery);
  const seen = new Set<string>();
  for (const [name] of parameters) {
    if (seen.has(name))
      return failure(
        "invalid_parameter",
        "Duplicate query parameters are not supported.",
        400,
        {
          parameter: /^[a-z][a-z0-9_]{0,63}$/u.test(name) ? name : "query",
          reason: "duplicate",
        },
      );
    seen.add(name);
  }
  if (noQueryRoute(route.operation) && seen.size > 0)
    return failure(
      "invalid_parameter",
      "This route does not accept query parameters.",
      400,
    );

  const common = new Set(["cursor", "limit", "sort"]);
  const policy =
    route.policy === null ? null : API_ROUTE_POLICIES[route.policy];
  const allowed = new Set([
    ...common,
    ...(policy?.filters ?? []),
    ...(route.operation.kind === "search" ? ["q"] : []),
  ]);
  for (const name of seen)
    if (!allowed.has(name))
      return failure(
        "unsupported_filter",
        "The request contains an unsupported parameter.",
        400,
        { parameter: "query", reason: "unsupported" },
      );

  const rawLimit = parameters.get("limit");
  const pageMaximum =
    route.operation.kind === "search"
      ? Math.min(limits.maxSearchResults, limits.maxPageSize)
      : limits.maxPageSize;
  const defaultLimit =
    route.operation.kind === "search"
      ? pageMaximum
      : Math.min(limits.defaultPageSize, pageMaximum);
  const limit =
    rawLimit === null || !/^[1-9][0-9]*$/u.test(rawLimit)
      ? rawLimit === null
        ? defaultLimit
        : null
      : Number(rawLimit);
  if (limit === null || !Number.isSafeInteger(limit) || limit > pageMaximum)
    return failure("invalid_parameter", "The page limit is invalid.", 400, {
      parameter: "limit",
      reason: `maximum is ${String(pageMaximum)}`,
    });

  const cursor = parameters.get("cursor");
  if (
    cursor !== null &&
    (cursor.length === 0 || cursor.length > limits.maxCursorCharacters)
  )
    return failure("invalid_cursor", "The cursor is invalid.", 400, {
      parameter: "cursor",
      reason: "invalid",
    });

  const rawSort = parameters.get("sort");
  let sort: readonly string[] = [];
  if (policy !== null) {
    if (
      rawSort !== null &&
      !(policy.sorts as readonly string[]).includes(rawSort)
    )
      return failure(
        "invalid_parameter",
        "The sort is not supported for this resource.",
        400,
        { parameter: "sort", reason: "unsupported" },
      );
    const primary = rawSort ?? policy.defaultSort[0];
    sort = [
      primary,
      ...(primary === "stable_id" ||
      !(policy.sorts as readonly string[]).includes("stable_id")
        ? []
        : ["stable_id"]),
    ];
  } else if (rawSort !== null) {
    return failure(
      "invalid_parameter",
      "This route does not accept a sort.",
      400,
    );
  }

  const filters: Record<string, NormalizedFilterValue> = {};
  let filterCount = 0;
  for (const filterName of policy?.filters ?? []) {
    const rawValue = parameters.get(filterName);
    if (rawValue === null) continue;
    const parsed = parseFilter(filterName, rawValue, limits);
    if (parsed === null)
      return failure("invalid_parameter", "A filter value is invalid.", 400, {
        parameter: filterName,
        reason: "invalid",
      });
    filterCount += parsed.count;
    filters[filterName] = parsed.value;
  }
  if (filterCount > limits.maxFilterValues)
    return failure(
      "invalid_parameter",
      "The request contains too many filter values.",
      400,
      {
        parameter: "filters",
        reason: `maximum is ${String(limits.maxFilterValues)}`,
      },
    );

  let query: string | null = null;
  if (route.operation.kind === "search" && parsedMethod !== "OPTIONS") {
    const raw = parameters.get("q");
    const normalizedQuery = raw === null ? null : normalizedText(raw);
    if (
      normalizedQuery === null ||
      normalizedQuery.length === 0 ||
      UTF8.encode(normalizedQuery).byteLength > limits.maxSearchQueryBytes
    )
      return failure("invalid_parameter", "The search query is invalid.", 400, {
        parameter: "q",
        reason: "invalid",
      });
    query = normalizedQuery;
  }

  return {
    request: {
      cursor,
      filters,
      hasQueryString: input.hasQueryString,
      limit,
      limitProvided: rawLimit !== null,
      method: parsedMethod,
      operation: route.operation,
      publicationHeader: input.publicationHeader,
      query,
      route,
      sort,
      sortProvided: rawSort !== null,
    },
    success: true,
  };
}

export function validateAndNormalizeRequest(
  input: RequestInput,
  limits: ApiLimits,
): ApiValidationResult {
  return {
    ...validateAndNormalizeRequestCore(input, limits),
    cost: classifyCost(input.pathname),
  };
}

export function classifyCost(pathname: string): RateCostClass {
  return pathname === EXACT_MODEL_SEARCH_API_PATH ||
    pathname === EXACT_VARIANT_SEARCH_API_PATH
    ? "search"
    : "read";
}

export interface ReadBoundaryEffects<Head, Result> {
  cache(request: NormalizedRequest, head: Head): Promise<Result | null>;
  limit(cost: RateCostClass): Promise<boolean>;
  query(request: NormalizedRequest, head: Head): Promise<Result>;
  resolveHead(request: NormalizedRequest): Promise<Head>;
}

export type ReadBoundaryOutcome<Result> =
  | { error: ApiError; kind: "validation_error" }
  | { kind: "preflight" }
  | { kind: "rate_limited" }
  | { kind: "success"; result: Result; source: "cache" | "query" };

export async function executeReadBoundary<Head, Result>(
  validate: () => ApiValidationResult,
  effects: ReadBoundaryEffects<Head, Result>,
): Promise<ReadBoundaryOutcome<Result>> {
  const validation = validate();
  const cost = validation.success
    ? validation.request.operation.kind === "search"
      ? "search"
      : "read"
    : validation.cost;
  if (!(await effects.limit(cost))) return { kind: "rate_limited" };
  if (!validation.success)
    return { error: validation.error, kind: "validation_error" };
  if (validation.request.method === "OPTIONS") return { kind: "preflight" };
  const head = await effects.resolveHead(validation.request);
  if (cacheEligibleRequest(validation.request)) {
    const cached = await effects.cache(validation.request, head);
    if (cached !== null)
      return { kind: "success", result: cached, source: "cache" };
  }
  return {
    kind: "success",
    result: await effects.query(validation.request, head),
    source: "query",
  };
}

export interface CursorPayload {
  expiresAtSeconds: number;
  filters: Readonly<Record<string, NormalizedFilterValue>>;
  issuedAtSeconds: number;
  lastSortTuple: readonly CursorScalar[];
  limit: number;
  operation: string;
  publicationId: string;
  queryHash: string | null;
  sort: readonly string[];
  stableId: string;
  version: 1;
}

export interface CursorKey {
  id: string;
  secret: Uint8Array;
}

export interface CursorKeyring {
  current: CursorKey;
  next: CursorKey | null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(
      value.replaceAll("-", "+").replaceAll("_", "/") + padding,
    );
    const decoded = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return base64Url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

async function hmac(
  value: string,
  secret: Uint8Array,
  subtle: SubtleCrypto,
): Promise<Uint8Array> {
  if (secret.byteLength < 32)
    throw new RangeError("Cursor HMAC keys must contain at least 32 bytes.");
  const keyBytes = new Uint8Array(secret.byteLength);
  keyBytes.set(secret);
  const key = await subtle.importKey(
    "raw",
    keyBytes.buffer,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
  return new Uint8Array(await subtle.sign("HMAC", key, UTF8.encode(value)));
}

function validateCursorKey(key: CursorKey): void {
  if (!KEY_ID.test(key.id)) throw new RangeError("Cursor key ID is invalid.");
  if (key.secret.byteLength < 32)
    throw new RangeError("Cursor HMAC keys must contain at least 32 bytes.");
}

function canonicalCursor(payload: CursorPayload): CursorPayload {
  return {
    expiresAtSeconds: payload.expiresAtSeconds,
    filters: Object.fromEntries(
      Object.entries(payload.filters).sort(([left], [right]) =>
        compareText(left, right),
      ),
    ),
    issuedAtSeconds: payload.issuedAtSeconds,
    lastSortTuple: [...payload.lastSortTuple],
    limit: payload.limit,
    operation: payload.operation,
    publicationId: payload.publicationId,
    queryHash: payload.queryHash,
    sort: [...payload.sort],
    stableId: payload.stableId,
    version: CURSOR_VERSION,
  };
}

interface CursorOperationPolicy {
  policy: keyof typeof API_ROUTE_POLICIES;
  stablePrefixes: readonly string[];
}

function canonicalCursorFilters(
  filters: Readonly<Record<string, unknown>>,
  allowedFilters: readonly string[],
): boolean {
  let count = 0;
  for (const [name, item] of Object.entries(filters)) {
    if (!allowedFilters.includes(name)) return false;
    if (typeof item !== "boolean" && typeof item !== "string") return false;
    const parsed = parseFilter(name, String(item), {
      maxQueryValueBytes: 512,
    });
    if (parsed?.value !== item) return false;
    count += parsed.count;
    if (count > 10) return false;
  }
  return true;
}

function cursorOperationPolicy(value: string): CursorOperationPolicy | null {
  const fixed: Readonly<Record<string, CursorOperationPolicy>> = {
    search: { policy: "search", stablePrefixes: ["mdl_", "prv_", "var_"] },
    "list:evidence": { policy: "evidence", stablePrefixes: ["evd_"] },
    "list:modelFamilies": {
      policy: "modelFamilies",
      stablePrefixes: ["fam_"],
    },
    "list:models": { policy: "models", stablePrefixes: ["mdl_"] },
    "list:offerings": { policy: "offerings", stablePrefixes: ["off_"] },
    "list:precisionObservations": {
      policy: "precisionObservations",
      stablePrefixes: ["prc_"],
    },
    "list:prices": { policy: "prices", stablePrefixes: ["pcs_"] },
    "list:providers": { policy: "providers", stablePrefixes: ["prv_"] },
    "list:variants": { policy: "variants", stablePrefixes: ["var_"] },
  };
  const selected = fixed[value];
  if (selected !== undefined) return selected;
  const related = /^(?:list):(model|provider|variant):offerings:(.+)$/u.exec(
    value,
  );
  if (related === null) return null;
  const ownerType = related[1];
  const ownerId = related[2];
  if (ownerType === undefined || ownerId === undefined) return null;
  const prefix =
    ownerType === "model" ? "mdl_" : ownerType === "provider" ? "prv_" : "var_";
  return new RegExp(`^${prefix}${UUID_V4}$`, "u").test(ownerId)
    ? { policy: "offerings", stablePrefixes: ["off_"] }
    : null;
}

function canonicalPolicySort(
  sort: readonly unknown[],
  allowedSorts: readonly string[],
): boolean {
  if (!sort.every((item): item is string => typeof item === "string"))
    return false;
  if (allowedSorts.includes("stable_id"))
    return (
      (sort.length === 1 && sort[0] === "stable_id") ||
      (sort.length === 2 &&
        sort[0] !== "stable_id" &&
        allowedSorts.includes(sort[0] ?? "") &&
        sort[1] === "stable_id")
    );
  return sort.length === 1 && allowedSorts.includes(sort[0] ?? "");
}

function validCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const candidate = value as Partial<CursorPayload>;
  if (typeof candidate.publicationId !== "string") return false;
  try {
    parsePublicationPin(candidate.publicationId);
  } catch {
    return false;
  }
  if (typeof candidate.operation !== "string") return false;
  const operationPolicy = cursorOperationPolicy(candidate.operation);
  if (operationPolicy === null) return false;
  const policy = API_ROUTE_POLICIES[operationPolicy.policy];
  const filters: unknown = candidate.filters;
  const sort = candidate.sort;
  const tuple = candidate.lastSortTuple;
  if (
    typeof filters !== "object" ||
    filters === null ||
    Array.isArray(filters) ||
    !Array.isArray(sort) ||
    !Array.isArray(tuple) ||
    typeof candidate.stableId !== "string"
  )
    return false;
  return (
    candidate.version === CURSOR_VERSION &&
    candidate.operation.length <= 128 &&
    STABLE_ID.test(candidate.stableId) &&
    operationPolicy.stablePrefixes.some((prefix) =>
      candidate.stableId?.startsWith(prefix),
    ) &&
    Number.isSafeInteger(candidate.issuedAtSeconds) &&
    Number.isSafeInteger(candidate.expiresAtSeconds) &&
    (candidate.issuedAtSeconds ?? -1) >= 0 &&
    (candidate.expiresAtSeconds ?? -1) > (candidate.issuedAtSeconds ?? 0) &&
    (candidate.expiresAtSeconds ?? 0) - (candidate.issuedAtSeconds ?? 0) <=
      CURSOR_TTL_SECONDS &&
    Number.isSafeInteger(candidate.limit) &&
    (candidate.limit ?? 0) > 0 &&
    (candidate.limit ?? 0) <= (candidate.operation === "search" ? 20 : 100) &&
    (operationPolicy.policy === "search"
      ? typeof candidate.queryHash === "string" &&
        /^[0-9a-f]{64}$/u.test(candidate.queryHash)
      : candidate.queryHash === null) &&
    canonicalPolicySort(sort, policy.sorts) &&
    tuple.length === sort.length &&
    tuple.at(-1) === candidate.stableId &&
    tuple.every(
      (item) =>
        item === null ||
        typeof item === "boolean" ||
        (typeof item === "string" && UTF8.encode(item).byteLength <= 512),
    ) &&
    canonicalCursorFilters(
      filters as Readonly<Record<string, unknown>>,
      policy.filters,
    )
  );
}

export async function hashNormalizedQuery(
  query: string | null,
  subtle: SubtleCrypto,
): Promise<string | null> {
  if (query === null) return null;
  const normalized = normalizedText(query);
  const digest = await subtle.digest(
    "SHA-256",
    UTF8.encode(`quantclarity-query-v1\0${normalized}`),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function issueCursor(
  payload: CursorPayload,
  keyring: CursorKeyring,
  subtle: SubtleCrypto,
): Promise<string> {
  validateCursorKey(keyring.current);
  if (keyring.next !== null) validateCursorKey(keyring.next);
  if (keyring.next?.id === keyring.current.id)
    throw new RangeError("Cursor rotation key IDs must be distinct.");
  if (!validCursorPayload(payload))
    throw new RangeError("Cursor payload is invalid.");
  const canonical = canonicalCursor(payload);
  const wirePayload = [
    CURSOR_DOMAIN,
    keyring.current.id,
    canonical.publicationId,
    canonical.operation,
    canonical.queryHash,
    Object.entries(canonical.filters),
    canonical.sort,
    canonical.limit,
    canonical.lastSortTuple,
    canonical.stableId,
    canonical.issuedAtSeconds,
    canonical.expiresAtSeconds,
  ] as const;
  const payloadText = JSON.stringify(wirePayload);
  const signature = await hmac(payloadText, keyring.current.secret, subtle);
  const cursor = `${base64Url(UTF8.encode(payloadText))}.${base64Url(signature)}`;
  if (cursor.length > CURSOR_MAX_CHARACTERS)
    throw new RangeError("Cursor exceeds the maximum encoded length.");
  return cursor;
}

export type CursorVerification =
  | { payload: CursorPayload; success: true }
  | { reason: "expired" | "invalid" | "not_yet_valid"; success: false };

function cursorFilters(
  value: unknown,
): Record<string, NormalizedFilterValue> | null {
  if (!Array.isArray(value)) return null;
  const result: Record<string, NormalizedFilterValue> = {};
  for (const rawEntry of value as unknown[]) {
    if (!Array.isArray(rawEntry)) return null;
    const entry = rawEntry as unknown[];
    if (entry.length !== 2) return null;
    const name = entry[0];
    const filterValue = entry[1];
    if (
      typeof name !== "string" ||
      (typeof filterValue !== "string" && typeof filterValue !== "boolean") ||
      name in result
    )
      return null;
    result[name] = filterValue;
  }
  return result;
}

export async function verifyCursor(
  cursor: string,
  keyring: CursorKeyring,
  nowSeconds: number,
  maximumClockSkewSeconds: number,
  subtle: SubtleCrypto,
): Promise<CursorVerification> {
  validateCursorKey(keyring.current);
  if (keyring.next !== null) validateCursorKey(keyring.next);
  if (keyring.next?.id === keyring.current.id)
    throw new RangeError("Cursor rotation key IDs must be distinct.");
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0)
    throw new RangeError(
      "Cursor verification time must be a non-negative integer.",
    );
  if (
    !Number.isSafeInteger(maximumClockSkewSeconds) ||
    maximumClockSkewSeconds < 0 ||
    maximumClockSkewSeconds > CURSOR_MAX_CLOCK_SKEW_SECONDS
  )
    throw new RangeError(
      "Cursor clock skew must be between zero and 30 seconds.",
    );
  if (cursor.length > CURSOR_MAX_CHARACTERS)
    return { reason: "invalid", success: false };
  const parts = cursor.split(".");
  if (parts.length !== 2) return { reason: "invalid", success: false };
  const encodedPayload = parts[0];
  const encodedSignature = parts[1];
  if (encodedPayload === undefined || encodedSignature === undefined)
    return { reason: "invalid", success: false };
  const payloadBytes = fromBase64Url(encodedPayload);
  const signature = fromBase64Url(encodedSignature);
  if (payloadBytes === null || signature === null)
    return { reason: "invalid", success: false };
  let wire: unknown;
  try {
    wire = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes),
    ) as unknown;
  } catch {
    return { reason: "invalid", success: false };
  }
  if (!Array.isArray(wire) || wire.length !== 12 || wire[0] !== CURSOR_DOMAIN)
    return { reason: "invalid", success: false };
  const items = wire as unknown[];
  const keyId = items[1];
  if (typeof keyId !== "string") return { reason: "invalid", success: false };
  const key: CursorKey | undefined =
    keyring.current.id === keyId
      ? keyring.current
      : keyring.next?.id === keyId
        ? keyring.next
        : undefined;
  if (key === undefined) return { reason: "invalid", success: false };
  const keyBytes = new Uint8Array(key.secret.byteLength);
  keyBytes.set(key.secret);
  const imported = await subtle.importKey(
    "raw",
    keyBytes.buffer,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"],
  );
  if (
    !(await subtle.verify(
      "HMAC",
      imported,
      new Uint8Array(signature).buffer,
      new Uint8Array(payloadBytes).buffer,
    ))
  )
    return { reason: "invalid", success: false };
  const decoded: unknown = {
    expiresAtSeconds: items[11],
    filters: cursorFilters(items[5]),
    issuedAtSeconds: items[10],
    lastSortTuple: items[8],
    limit: items[7],
    operation: items[3],
    publicationId: items[2],
    queryHash: items[4],
    sort: items[6],
    stableId: items[9],
    version: CURSOR_VERSION,
  };
  if (!validCursorPayload(decoded))
    return { reason: "invalid", success: false };
  if (decoded.issuedAtSeconds > nowSeconds + maximumClockSkewSeconds)
    return { reason: "not_yet_valid", success: false };
  if (decoded.expiresAtSeconds <= nowSeconds)
    return { reason: "expired", success: false };
  return { payload: canonicalCursor(decoded), success: true };
}

export async function reconcileRequestCursor(
  request: NormalizedRequest,
  cursor: CursorVerification,
  limits: ApiLimits,
  subtle: SubtleCrypto,
): Promise<{ publicationId: string | null; request: NormalizedRequest }> {
  assertApiLimits(limits);
  if (!cursor.success) throw new RangeError("Cursor verification failed.");
  const routeMaximum =
    request.operation.kind === "search"
      ? Math.min(limits.maxSearchResults, limits.maxPageSize)
      : limits.maxPageSize;
  const operation = operationName(request.operation);
  const suppliedFiltersMatch = Object.entries(request.filters).every(
    ([name, value]) => cursor.payload.filters[name] === value,
  );
  if (
    cursor.payload.operation !== operation ||
    !suppliedFiltersMatch ||
    (request.sortProvided &&
      JSON.stringify(cursor.payload.sort) !== JSON.stringify(request.sort)) ||
    (request.limitProvided && cursor.payload.limit !== request.limit) ||
    cursor.payload.limit > routeMaximum ||
    cursor.payload.queryHash !==
      (await hashNormalizedQuery(request.query, subtle))
  )
    throw new RangeError("Cursor parameters do not match the request.");
  return {
    publicationId: reconcilePublicationPin(
      request.publicationHeader,
      cursor.payload.publicationId,
    ),
    request: {
      ...request,
      filters: { ...cursor.payload.filters },
      limit: cursor.payload.limit,
      sort: [...cursor.payload.sort],
    },
  };
}

export function operationName(operation: QueryOperation): string {
  switch (operation.kind) {
    case "collection":
      return `list:${operation.collection}`;
    case "detail":
      return `get:${operation.resourceType}`;
    case "metadata":
      return "metadata";
    case "methodology_detail":
      return `get:methodology:${operation.version}`;
    case "openapi":
      return `openapi:${operation.format}`;
    case "related_collection":
      return `list:${operation.ownerType}:offerings:${operation.ownerId}`;
    case "search":
      return "search";
  }
}

export type DeploymentEnvironment = "local" | "preview" | "production" | "test";

export interface QueryContinuation {
  lastSortTuple: readonly CursorScalar[];
  stableId: string;
}

export interface ExactStructuredSearchPlan {
  filters: Readonly<Record<string, NormalizedFilterValue>>;
  kind: "exact_structured";
  limit: number;
  query: string;
  semanticCandidates: 0;
  semanticCalls: 0;
  semanticDegraded: "disabled";
}

export interface CatalogQueryRpcV2 {
  resolvePublicationV2(input: unknown): Promise<unknown>;
  readMergedExactSearchV2(input: unknown): Promise<unknown>;
}

export interface DatasetMetadataQueryRpcV1 {
  resolvePublicationV2(input: unknown): Promise<unknown>;
  readDatasetMetadataV1(input: unknown): Promise<unknown>;
}

export interface CatalogQueryRpcV3
  extends CatalogQueryRpcV2, DatasetMetadataQueryRpcV1 {}

export interface ModelDetailQueryRpcV1 {
  resolvePublicationV2(input: unknown): Promise<unknown>;
  readModelDetailV1(input: unknown): Promise<unknown>;
}

export interface CatalogQueryRpcV4
  extends CatalogQueryRpcV3, ModelDetailQueryRpcV1 {}

export interface ModelDetailQueryRpcV2 extends ModelDetailQueryRpcV1 {
  readModelDetailV2(input: unknown): Promise<unknown>;
}

export interface CatalogQueryRpcV5
  extends CatalogQueryRpcV4, ModelDetailQueryRpcV2 {}

export interface MethodologyContextQueryRpcV1 {
  resolvePublicationV2: (input: unknown) => Promise<unknown>;
  readMethodologyContextV1: (input: unknown) => Promise<unknown>;
}

export interface CatalogQueryRpcV6
  extends CatalogQueryRpcV5, MethodologyContextQueryRpcV1 {}

export type ReadMethodologyContextV1Input = Readonly<{
  version: 1;
  audience: "quantclarity-catalog-query-v1";
  environment: DeploymentEnvironment;
  bookmark: string;
  requiredAvailableUntilMs: number;
  envelope: QueryServiceEnvelope;
}>;

export type ReadMethodologyContextV1Outcome =
  | Readonly<{
      outcome: "context";
      publicationId: string;
      publicApiOrigin: string;
      schemaVersion: string;
    }>
  | Readonly<{ outcome: "integrity_failure" }>
  | Readonly<{ outcome: "read_failure" }>;

export type ReadDatasetMetadataV1Input = Readonly<{
  version: 1;
  audience: "quantclarity-catalog-query-v1";
  environment: DeploymentEnvironment;
  bookmark: string;
  requiredAvailableUntilMs: number;
  envelope: QueryServiceEnvelope;
}>;

export type ReadDatasetMetadataV1Outcome =
  | Readonly<{ outcome: "metadata"; metadata: DatasetMetadata }>
  | Readonly<{ outcome: "integrity_failure" }>
  | Readonly<{ outcome: "read_failure" }>;

export type ReadModelDetailV1Input = Readonly<{
  version: 1;
  audience: "quantclarity-catalog-query-v1";
  environment: DeploymentEnvironment;
  bookmark: string;
  requiredAvailableUntilMs: number;
  envelope: QueryServiceEnvelope;
}>;

export type ReadModelDetailV1Outcome =
  | Readonly<{
      outcome: "model";
      model: Model;
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

export type ModelDetailLookupV2 =
  | Readonly<{ kind: "stable_id"; value: string }>
  | Readonly<{ kind: "slug"; value: string }>;

export type ModelDetailLookupProvenanceV2 = Readonly<{
  matchedBy: "stable_id" | "current_slug" | "historical_slug";
  canonicalSlug: string;
  projectionVersion: "model-slug@1";
}>;

export type ReadModelDetailV2Input = Readonly<{
  version: 2;
  audience: "quantclarity-catalog-query-v1";
  environment: DeploymentEnvironment;
  bookmark: string;
  requiredAvailableUntilMs: number;
  envelope: QueryServiceEnvelope;
  lookup: ModelDetailLookupV2;
}>;

export type ReadModelDetailV2Outcome =
  | Readonly<{
      outcome: "model";
      model: Model;
      publicationId: string;
      schemaVersion: string;
      lookupProvenance: ModelDetailLookupProvenanceV2;
    }>
  | Readonly<{
      outcome: "not_found";
      publicationId: string;
      schemaVersion: string;
    }>
  | Readonly<{ outcome: "integrity_failure" }>
  | Readonly<{ outcome: "read_failure" }>;

export const MODEL_DETAIL_PUBLIC_MAX_BYTES = 65_536;
const MODEL_DETAIL_SNAPSHOT_MAX_OBJECT_KEYS = 256;
const MODEL_DETAIL_SNAPSHOT_MAX_KEY_CHARACTERS = 128;
const MODEL_DETAIL_SNAPSHOT_MAX_KEY_BYTES = 512;

interface ModelDetailSnapshotBudget {
  remaining: number;
  seen: WeakSet<object>;
}

const snapshotModelDetailArray = (
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null => {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    )
      return null;
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
  } catch {
    return null;
  }
};

const snapshotModelDetailJson = (
  value: unknown,
  budget: ModelDetailSnapshotBudget,
): unknown => {
  budget.remaining -= 1;
  if (budget.remaining < 0) throw new RangeError("snapshot budget exceeded");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-JSON number");
    return value;
  }
  if (typeof value === "string") {
    if (value.length > budget.remaining)
      throw new RangeError("snapshot budget exceeded");
    budget.remaining -= UTF8.encode(value).byteLength;
    if (budget.remaining < 0) throw new RangeError("snapshot budget exceeded");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("non-JSON value");
  if (budget.seen.has(value)) throw new TypeError("cyclic value");
  budget.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const array = snapshotModelDetailArray(
        value,
        Math.max(0, budget.remaining),
      );
      if (array === null) throw new TypeError("hostile array");
      return array.map((item) => snapshotModelDetailJson(item, budget));
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("hostile object");
    const keys = Reflect.ownKeys(value);
    if (
      keys.length > MODEL_DETAIL_SNAPSHOT_MAX_OBJECT_KEYS ||
      keys.length > budget.remaining ||
      keys.some((key) => typeof key !== "string")
    )
      throw new TypeError("hostile object keys");
    let keyBytes = 0;
    for (const key of keys as string[]) {
      if (
        key.length > MODEL_DETAIL_SNAPSHOT_MAX_KEY_CHARACTERS ||
        key.length > budget.remaining
      )
        throw new RangeError("snapshot budget exceeded");
      const bytes = UTF8.encode(key).byteLength;
      if (bytes > MODEL_DETAIL_SNAPSHOT_MAX_KEY_BYTES)
        throw new TypeError("hostile key");
      keyBytes += bytes;
      if (keyBytes > budget.remaining)
        throw new RangeError("snapshot budget exceeded");
    }
    budget.remaining -= keyBytes;
    const output: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      )
        throw new TypeError("hostile property");
      output[key] = snapshotModelDetailJson(descriptor.value, budget);
    }
    return output;
  } finally {
    budget.seen.delete(value);
  }
};

/**
 * Detaches and validates one canonical Model before ModelDetail serialization.
 * The bounded, recursively key-sorted snapshot is shared by request adapters
 * and publication admission so they measure the same representation bytes.
 */
export function snapshotModelDetailModel(
  input: Readonly<{
    expectedModelId: string | null;
    maxRepresentationBytes: number;
    model: unknown;
  }>,
): Model | null {
  try {
    if (
      !Number.isSafeInteger(input.maxRepresentationBytes) ||
      input.maxRepresentationBytes < 0 ||
      input.maxRepresentationBytes > Math.floor(Number.MAX_SAFE_INTEGER / 2)
    )
      return null;
    const detached = snapshotModelDetailJson(input.model, {
      remaining: Math.max(4096, input.maxRepresentationBytes * 2),
      seen: new WeakSet(),
    });
    if (
      !checkModelContract(detached) ||
      (input.expectedModelId !== null &&
        detached.model_id !== input.expectedModelId)
    )
      return null;
    return detached;
  } catch {
    return null;
  }
}

export type ExactModelSearchRepresentation = Readonly<{
  collection: SearchCollection;
  representationBytes: Uint8Array;
}>;

export type ExactModelCard = Readonly<
  Pick<
    Model,
    | "model_id"
    | "display_name"
    | "publisher"
    | "total_parameters"
    | "active_parameters"
    | "source_weight_format"
    | "source_quantization"
    | "cataloged_provider_count"
    | "last_model_data_refresh"
  >
>;

export type ExactModelCardCollection = Readonly<{
  data: readonly Readonly<{
    match_kind: "canonical_name" | "provider_model_id";
    model: ExactModelCard;
  }>[];
  page: Readonly<{
    next_cursor: string | null;
    limit: typeof EXACT_MODEL_SEARCH_LIMIT;
  }>;
  meta: Readonly<{
    resource: "exact_model_cards";
    publication_id: string;
    schema_version: "1.0.0";
    sort: readonly ["relevance", "stable_id"];
    filters: Readonly<{ record_type: "model" }>;
  }>;
}>;

export type ExactModelCardRepresentation = Readonly<{
  collection: ExactModelCardCollection;
  representationBytes: Uint8Array;
}>;

const EXACT_MODEL_CARD_KEYS = [
  "active_parameters",
  "cataloged_provider_count",
  "display_name",
  "last_model_data_refresh",
  "model_id",
  "publisher",
  "source_quantization",
  "source_weight_format",
  "total_parameters",
] as const;

const exactObjectKeys = (
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => typeof key === "string" && expected.includes(key))
  );
};

const unknownModelFact = () => ({
  state: "unknown" as const,
  value: null,
  observed_at: null,
  evidence_ids: [],
});

const exactModelCardContract = (value: unknown): value is ExactModelCard => {
  if (!exactObjectKeys(value, EXACT_MODEL_CARD_KEYS)) return false;
  const card = value as unknown as ExactModelCard;
  const unknown = unknownModelFact();
  return (
    card.display_name.state === "known" &&
    checkModelContract({
      model_id: card.model_id,
      family_id: "fam_00000000-0000-4000-8000-000000000000",
      slug: unknown,
      display_name: card.display_name,
      publisher: card.publisher,
      release_date: unknown,
      modalities: unknown,
      context_window_tokens: unknown,
      maximum_output_tokens: unknown,
      license: unknown,
      architecture: unknown,
      total_parameters: card.total_parameters,
      active_parameters: card.active_parameters,
      authoritative_checkpoint_ids: [],
      checkpoints: [],
      source_weight_format: card.source_weight_format,
      source_quantization: card.source_quantization,
      status: unknown,
      cataloged_provider_count: card.cataloged_provider_count,
      last_model_data_refresh: card.last_model_data_refresh,
    })
  );
};

const cloneModelFact = <T extends Model["display_name"]>(fact: T): T =>
  ({
    state: fact.state,
    value: fact.value,
    observed_at: fact.observed_at,
    evidence_ids: [...fact.evidence_ids],
  }) as T;

const cloneParameterFact = (
  fact: Model["total_parameters"],
): Model["total_parameters"] =>
  fact.state === "known"
    ? {
        state: "known",
        value: {
          raw_value: fact.value.raw_value,
          normalized_decimal: fact.value.normalized_decimal,
          approximation: fact.value.approximation,
        },
        observed_at: fact.observed_at,
        evidence_ids: [...fact.evidence_ids],
      }
    : {
        state: fact.state,
        value: null,
        observed_at: fact.observed_at,
        evidence_ids: [...fact.evidence_ids],
      };

const cloneExactModelCard = (card: ExactModelCard): ExactModelCard => ({
  model_id: card.model_id,
  display_name: cloneModelFact(card.display_name),
  publisher: cloneModelFact(card.publisher),
  total_parameters: cloneParameterFact(card.total_parameters),
  active_parameters: cloneParameterFact(card.active_parameters),
  source_weight_format: cloneModelFact(card.source_weight_format),
  source_quantization: cloneModelFact(card.source_quantization),
  cataloged_provider_count: {
    value: card.cataloged_provider_count.value,
    observed_at: card.cataloged_provider_count.observed_at,
    derivation_version: card.cataloged_provider_count.derivation_version,
  },
  last_model_data_refresh: cloneModelFact(card.last_model_data_refresh),
});

/**
 * Validates and fixes the exact bytes for the local-only Model-card search
 * representation. Cards are projections of canonical Model Facts; no provider
 * identity, Offering, price, serving-precision, or affiliate field is admitted.
 */
export function encodeExactModelCardCollectionRepresentation(
  input: unknown,
): ExactModelCardRepresentation | null {
  try {
    const detached = snapshotModelDetailJson(input, {
      remaining: EXACT_MODEL_SEARCH_PUBLIC_MAX_BYTES * 2,
      seen: new WeakSet(),
    });
    if (
      !exactObjectKeys(detached, ["data", "meta", "page"]) ||
      !Array.isArray(detached.data) ||
      detached.data.length > EXACT_MODEL_SEARCH_LIMIT ||
      !exactObjectKeys(detached.page, ["limit", "next_cursor"]) ||
      detached.page.limit !== EXACT_MODEL_SEARCH_LIMIT ||
      (detached.page.next_cursor !== null &&
        (typeof detached.page.next_cursor !== "string" ||
          detached.page.next_cursor.length === 0 ||
          detached.page.next_cursor.length >
            EXACT_MODEL_SEARCH_CURSOR_MAX_CHARACTERS ||
          !hasValidUnicodeScalars(detached.page.next_cursor))) ||
      !exactObjectKeys(detached.meta, [
        "filters",
        "publication_id",
        "resource",
        "schema_version",
        "sort",
      ]) ||
      detached.meta.resource !== "exact_model_cards" ||
      typeof detached.meta.publication_id !== "string" ||
      parsePublicationPin(detached.meta.publication_id) === null ||
      detached.meta.schema_version !== "1.0.0" ||
      !Array.isArray(detached.meta.sort) ||
      detached.meta.sort.length !== 2 ||
      detached.meta.sort[0] !== "relevance" ||
      detached.meta.sort[1] !== "stable_id" ||
      !exactObjectKeys(detached.meta.filters, ["record_type"]) ||
      detached.meta.filters.record_type !== "model"
    )
      return null;

    const modelIds = new Set<string>();
    const data: ExactModelCardCollection["data"][number][] = [];
    for (const value of detached.data) {
      if (
        !exactObjectKeys(value, ["match_kind", "model"]) ||
        (value.match_kind !== "canonical_name" &&
          value.match_kind !== "provider_model_id") ||
        !exactModelCardContract(value.model) ||
        modelIds.has(value.model.model_id)
      )
        return null;
      modelIds.add(value.model.model_id);
      data.push({
        match_kind: value.match_kind,
        model: cloneExactModelCard(value.model),
      });
    }

    const collection: ExactModelCardCollection = {
      data,
      page: {
        next_cursor: detached.page.next_cursor,
        limit: EXACT_MODEL_SEARCH_LIMIT,
      },
      meta: {
        resource: "exact_model_cards",
        publication_id: detached.meta.publication_id,
        schema_version: "1.0.0",
        sort: ["relevance", "stable_id"],
        filters: { record_type: "model" },
      },
    };
    const representationBytes = UTF8.encode(JSON.stringify(collection));
    if (representationBytes.byteLength > EXACT_MODEL_SEARCH_PUBLIC_MAX_BYTES)
      return null;
    return { collection, representationBytes };
  } catch {
    return null;
  }
}

export type ExactVariantCard = Readonly<
  Pick<
    Variant,
    | "variant_id"
    | "model_id"
    | "family_id"
    | "variant_kind"
    | "display_name"
    | "publisher"
    | "total_parameters"
    | "active_parameters"
    | "source_weight_format"
    | "source_quantization"
    | "cataloged_provider_count"
    | "last_model_data_refresh"
  >
>;

export type ExactVariantCardCollection = Readonly<{
  data: readonly Readonly<{
    match_kind: "canonical_name" | "provider_model_id";
    variant: ExactVariantCard;
  }>[];
  page: Readonly<{
    next_cursor: string | null;
    limit: typeof EXACT_VARIANT_SEARCH_LIMIT;
  }>;
  meta: Readonly<{
    resource: "exact_variant_cards";
    publication_id: string;
    schema_version: "1.0.0";
    sort: readonly ["relevance", "stable_id"];
    filters: Readonly<{ record_type: "variant" }>;
  }>;
}>;

export type ExactVariantCardRepresentation = Readonly<{
  collection: ExactVariantCardCollection;
  representationBytes: Uint8Array;
}>;

const EXACT_VARIANT_CARD_KEYS = [
  "active_parameters",
  "cataloged_provider_count",
  "display_name",
  "family_id",
  "last_model_data_refresh",
  "model_id",
  "publisher",
  "source_quantization",
  "source_weight_format",
  "total_parameters",
  "variant_id",
  "variant_kind",
] as const;

const exactVariantCardContract = (
  value: unknown,
): value is ExactVariantCard => {
  if (!exactObjectKeys(value, EXACT_VARIANT_CARD_KEYS)) return false;
  const card = value as unknown as ExactVariantCard;
  const unknown = unknownModelFact();
  return (
    card.display_name.state === "known" &&
    checkVariantContract({
      variant_id: card.variant_id,
      model_id: card.model_id,
      family_id: card.family_id,
      slug: unknown,
      display_name: card.display_name,
      variant_kind: card.variant_kind,
      selection_evidence: unknown,
      publisher: card.publisher,
      release_date: unknown,
      modalities: unknown,
      context_window_tokens: unknown,
      maximum_output_tokens: unknown,
      license: unknown,
      architecture: unknown,
      total_parameters: card.total_parameters,
      active_parameters: card.active_parameters,
      source_weight_format: card.source_weight_format,
      source_quantization: card.source_quantization,
      checkpoint_ids: [],
      checkpoints: [],
      status: unknown,
      cataloged_provider_count: card.cataloged_provider_count,
      last_model_data_refresh: card.last_model_data_refresh,
    })
  );
};

const cloneExactVariantCard = (card: ExactVariantCard): ExactVariantCard => ({
  variant_id: card.variant_id,
  model_id: card.model_id,
  family_id: card.family_id,
  variant_kind: cloneModelFact(card.variant_kind),
  display_name: cloneModelFact(card.display_name),
  publisher: cloneModelFact(card.publisher),
  total_parameters: cloneParameterFact(card.total_parameters),
  active_parameters: cloneParameterFact(card.active_parameters),
  source_weight_format: cloneModelFact(card.source_weight_format),
  source_quantization: cloneModelFact(card.source_quantization),
  cataloged_provider_count: {
    value: card.cataloged_provider_count.value,
    observed_at: card.cataloged_provider_count.observed_at,
    derivation_version: card.cataloged_provider_count.derivation_version,
  },
  last_model_data_refresh: cloneModelFact(card.last_model_data_refresh),
});

/**
 * Validates and fixes the exact bytes for the purpose-separated local/test
 * Variant-card search representation. Only canonical Variant facts plus the
 * allowed cataloged-provider count are admitted.
 */
export function encodeExactVariantCardCollectionRepresentation(
  input: unknown,
): ExactVariantCardRepresentation | null {
  try {
    const detached = snapshotModelDetailJson(input, {
      remaining: EXACT_VARIANT_SEARCH_PUBLIC_MAX_BYTES * 2,
      seen: new WeakSet(),
    });
    if (
      !exactObjectKeys(detached, ["data", "meta", "page"]) ||
      !Array.isArray(detached.data) ||
      detached.data.length > EXACT_VARIANT_SEARCH_LIMIT ||
      !exactObjectKeys(detached.page, ["limit", "next_cursor"]) ||
      detached.page.limit !== EXACT_VARIANT_SEARCH_LIMIT ||
      (detached.page.next_cursor !== null &&
        (typeof detached.page.next_cursor !== "string" ||
          detached.page.next_cursor.length === 0 ||
          detached.page.next_cursor.length >
            EXACT_VARIANT_SEARCH_CURSOR_MAX_CHARACTERS ||
          !hasValidUnicodeScalars(detached.page.next_cursor))) ||
      !exactObjectKeys(detached.meta, [
        "filters",
        "publication_id",
        "resource",
        "schema_version",
        "sort",
      ]) ||
      detached.meta.resource !== "exact_variant_cards" ||
      typeof detached.meta.publication_id !== "string" ||
      parsePublicationPin(detached.meta.publication_id) === null ||
      detached.meta.schema_version !== "1.0.0" ||
      !Array.isArray(detached.meta.sort) ||
      detached.meta.sort.length !== 2 ||
      detached.meta.sort[0] !== "relevance" ||
      detached.meta.sort[1] !== "stable_id" ||
      !exactObjectKeys(detached.meta.filters, ["record_type"]) ||
      detached.meta.filters.record_type !== "variant"
    )
      return null;

    const variantIds = new Set<string>();
    const data: ExactVariantCardCollection["data"][number][] = [];
    for (const value of detached.data) {
      if (
        !exactObjectKeys(value, ["match_kind", "variant"]) ||
        (value.match_kind !== "canonical_name" &&
          value.match_kind !== "provider_model_id") ||
        !exactVariantCardContract(value.variant) ||
        variantIds.has(value.variant.variant_id)
      )
        return null;
      variantIds.add(value.variant.variant_id);
      data.push({
        match_kind: value.match_kind,
        variant: cloneExactVariantCard(value.variant),
      });
    }

    const collection: ExactVariantCardCollection = {
      data,
      page: {
        next_cursor: detached.page.next_cursor,
        limit: EXACT_VARIANT_SEARCH_LIMIT,
      },
      meta: {
        resource: "exact_variant_cards",
        publication_id: detached.meta.publication_id,
        schema_version: "1.0.0",
        sort: ["relevance", "stable_id"],
        filters: { record_type: "variant" },
      },
    };
    const representationBytes = UTF8.encode(JSON.stringify(collection));
    if (representationBytes.byteLength > EXACT_VARIANT_SEARCH_PUBLIC_MAX_BYTES)
      return null;
    return { collection, representationBytes };
  } catch {
    return null;
  }
}

/**
 * Validates, detaches, and serializes the sole exact-Model SearchCollection
 * wire representation. The explicit reconstruction fixes property order for
 * byte-for-byte admission by both API and frontend.
 */
export function encodeExactModelSearchRepresentation(
  input: unknown,
): ExactModelSearchRepresentation | null {
  try {
    const detached = snapshotModelDetailJson(input, {
      remaining: EXACT_MODEL_SEARCH_PUBLIC_MAX_BYTES * 2,
      seen: new WeakSet(),
    });
    if (!checkSearchCollectionContract(detached)) return null;
    if (
      detached.page.limit !== EXACT_MODEL_SEARCH_LIMIT ||
      detached.meta.resource !== "search" ||
      detached.meta.schema_version !== "1.0.0" ||
      detached.meta.sort.length !== 2 ||
      detached.meta.sort[0] !== "relevance" ||
      detached.meta.sort[1] !== "stable_id" ||
      detached.meta.semantic_degraded !== "disabled" ||
      Reflect.ownKeys(detached.meta.filters).length !== 1 ||
      detached.meta.filters.record_type !== "model" ||
      detached.data.some(
        (result) =>
          result.resource_type !== "model" ||
          result.semantic_degraded !== "disabled" ||
          (result.match_kind !== "canonical_name" &&
            result.match_kind !== "provider_model_id"),
      )
    )
      return null;
    parsePublicationPin(detached.meta.publication_id);
    const collection: unknown = {
      data: detached.data.map((result) => ({
        resource_type: result.resource_type,
        resource_id: result.resource_id,
        display_name: {
          state: result.display_name.state,
          value: result.display_name.value,
          observed_at: result.display_name.observed_at,
          evidence_ids: [...result.display_name.evidence_ids],
        },
        match_kind: result.match_kind,
        semantic_degraded: result.semantic_degraded,
      })),
      page: {
        next_cursor: detached.page.next_cursor,
        limit: detached.page.limit,
      },
      meta: {
        resource: "search",
        publication_id: detached.meta.publication_id,
        schema_version: "1.0.0",
        sort: ["relevance", "stable_id"],
        filters: { record_type: "model" },
        semantic_degraded: "disabled",
      },
    };
    if (!checkSearchCollectionContract(collection)) return null;
    const representationBytes = UTF8.encode(JSON.stringify(collection));
    if (representationBytes.byteLength > EXACT_MODEL_SEARCH_PUBLIC_MAX_BYTES)
      return null;
    return { collection, representationBytes };
  } catch {
    return null;
  }
}

export type ModelDetailResponse = Readonly<{
  data: Model;
  meta: Readonly<{
    resource: "models";
    publication_id: string;
    schema_version: string;
    sort: readonly ["name", "stable_id"];
    filters: Readonly<Record<string, never>>;
  }>;
}>;

export type ModelDetailRepresentation = Readonly<{
  detail: ModelDetailResponse;
  representationBytes: Uint8Array;
}>;

/**
 * Builds the sole ModelDetail wire envelope and encodes its exact JSON bytes.
 * Callers validate and detach the canonical Model before this boundary, then
 * apply MODEL_DETAIL_PUBLIC_MAX_BYTES without reserializing the representation.
 */
export function encodeModelDetailRepresentation(
  input: Readonly<{
    model: Model;
    publicationId: string;
    schemaVersion: string;
  }>,
): ModelDetailRepresentation {
  parsePublicationPin(input.publicationId);
  if (!SCHEMA_VERSION.test(input.schemaVersion))
    throw new RangeError("Model detail schema version is invalid.");
  const detail: ModelDetailResponse = {
    data: input.model,
    meta: {
      resource: "models",
      publication_id: input.publicationId,
      schema_version: input.schemaVersion,
      sort: ["name", "stable_id"],
      filters: {},
    },
  };
  const representationBytes = UTF8.encode(JSON.stringify(detail));
  if (representationBytes.byteLength > MODEL_DETAIL_PUBLIC_MAX_BYTES)
    throw new RangeError("Model detail representation exceeds public limit.");
  return { detail, representationBytes };
}

export const METHODOLOGY_DETAIL_PUBLIC_MAX_BYTES = 4096;

export type MethodologyDetailResponse = Readonly<{
  data: Methodology;
  meta: Readonly<{
    resource: "methodologies";
    publication_id: string;
    schema_version: string;
    sort: readonly ["version"];
    filters: Readonly<Record<string, never>>;
  }>;
}>;

export type MethodologyDetailRepresentation = Readonly<{
  detail: MethodologyDetailResponse;
  representationBytes: Uint8Array;
}>;

const snapshotMethodologyEncoderInput = (
  value: unknown,
): Readonly<{
  publicApiOrigin: string;
  publicationId: string;
  schemaVersion: string;
  version: string;
}> | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const expected = [
      "publicApiOrigin",
      "publicationId",
      "schemaVersion",
      "version",
    ] as const;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          !(expected as readonly string[]).includes(key),
      )
    )
      return null;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        typeof descriptor.value !== "string"
      )
        return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot as {
      publicApiOrigin: string;
      publicationId: string;
      schemaVersion: string;
      version: string;
    };
  } catch {
    return null;
  }
};

/** Builds the exact public envelope for one code-owned methodology version. */
export function encodeMethodologyDetailRepresentation(
  input: Readonly<{
    publicApiOrigin: string;
    publicationId: string;
    schemaVersion: string;
    version: string;
  }>,
): MethodologyDetailRepresentation {
  const snapshot = snapshotMethodologyEncoderInput(input);
  if (snapshot === null)
    throw new TypeError("Methodology detail encoder input is invalid.");
  if (
    snapshot.publicationId.length > 40 ||
    snapshot.schemaVersion.length > 128 ||
    snapshot.publicApiOrigin.length > 2048 ||
    snapshot.version.length > 64
  )
    throw new RangeError("Methodology detail encoder input is too large.");
  parsePublicationPin(snapshot.publicationId);
  if (!SCHEMA_VERSION.test(snapshot.schemaVersion))
    throw new RangeError("Methodology detail schema version is invalid.");
  const methodology = methodologyRegistryEntry(snapshot.version);
  if (methodology === null)
    throw new RangeError("Methodology version is not registered.");
  if (
    UTF8.encode(snapshot.publicApiOrigin).byteLength > 2048 ||
    snapshot.publicApiOrigin.endsWith("/")
  )
    throw new RangeError("Public API origin is invalid.");
  let origin: URL;
  try {
    origin = new URL(snapshot.publicApiOrigin);
  } catch {
    throw new RangeError("Public API origin is invalid.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.origin !== snapshot.publicApiOrigin ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  )
    throw new RangeError("Public API origin is invalid.");
  const methodologyUrl = `${snapshot.publicApiOrigin}${methodology.path}`;
  if (methodologyUrl.length > 2048)
    throw new RangeError("Methodology URL exceeds the public contract limit.");
  const detail: MethodologyDetailResponse = {
    data: {
      methodology_version: methodology.version,
      methodology_effective_at: methodology.effectiveAt,
      methodology_url: methodologyUrl,
    },
    meta: {
      resource: "methodologies",
      publication_id: snapshot.publicationId,
      schema_version: snapshot.schemaVersion,
      sort: ["version"],
      filters: {},
    },
  };
  const representationBytes = UTF8.encode(JSON.stringify(detail));
  if (representationBytes.byteLength > METHODOLOGY_DETAIL_PUBLIC_MAX_BYTES)
    throw new RangeError(
      "Methodology detail representation exceeds public limit.",
    );
  return { detail, representationBytes };
}

export interface QueryServiceEnvelope {
  audience: "quantclarity-catalog-query-v1";
  continuation: QueryContinuation | null;
  environment: DeploymentEnvironment;
  filters: Readonly<Record<string, NormalizedFilterValue>>;
  limit: number;
  operation: QueryOperation;
  publicationId: string;
  searchPlan: ExactStructuredSearchPlan | null;
  sort: readonly string[];
  version: 1;
}

function closedOperation(operation: QueryOperation): QueryOperation {
  switch (operation.kind) {
    case "collection": {
      const allowed = new Set<CollectionName>([
        "evidence",
        "modelFamilies",
        "models",
        "offerings",
        "precisionObservations",
        "prices",
        "providers",
        "variants",
      ]);
      if (!allowed.has(operation.collection))
        throw new RangeError("The query collection is not supported.");
      return { collection: operation.collection, kind: "collection" };
    }
    case "detail":
      if (detail(operation.resourceType, operation.identifier) === null)
        throw new RangeError("The query detail operation is invalid.");
      return {
        identifier: operation.identifier,
        kind: "detail",
        resourceType: operation.resourceType,
      };
    case "metadata":
      return { kind: "metadata" };
    case "methodology_detail":
      if (!METHODOLOGY_VERSION.test(operation.version))
        throw new RangeError("The methodology version is invalid.");
      return { kind: "methodology_detail", version: operation.version };
    case "openapi": {
      const format: unknown = operation.format;
      if (format !== "json" && format !== "yaml")
        throw new RangeError("The OpenAPI representation is invalid.");
      return { format, kind: "openapi" };
    }
    case "related_collection":
      if (related(operation.ownerType, operation.ownerId) === null)
        throw new RangeError("The related query operation is invalid.");
      return {
        collection: "offerings",
        kind: "related_collection",
        ownerId: operation.ownerId,
        ownerType: operation.ownerType,
      };
    case "search":
      return { kind: "search" };
  }
}

function operationPolicy(
  operation: QueryOperation,
): keyof typeof API_ROUTE_POLICIES | null {
  switch (operation.kind) {
    case "collection":
      return operation.collection;
    case "detail":
      return (
        detail(operation.resourceType, operation.identifier)?.policy ?? null
      );
    case "metadata":
    case "openapi":
      return null;
    case "methodology_detail":
      return "methodologies";
    case "related_collection":
      return "offerings";
    case "search":
      return "search";
  }
}

export function buildExactStructuredSearchPlan(
  request: NormalizedRequest,
  limits: ApiLimits,
): ExactStructuredSearchPlan {
  assertApiLimits(limits);
  if (request.operation.kind !== "search" || request.query === null)
    throw new RangeError(
      "An exact search plan requires a normalized search request.",
    );
  if (
    request.route.operation.kind !== "search" ||
    request.route.policy !== "search" ||
    request.method === "OPTIONS"
  )
    throw new RangeError(
      "An exact search plan requires a closed search route.",
    );
  const policy = API_ROUTE_POLICIES.search;
  const filters: Record<string, NormalizedFilterValue> = {};
  let filterCount = 0;
  for (const [name, value] of Object.entries(request.filters)) {
    if (!policy.filters.includes(name as never))
      throw new RangeError("The search plan contains an unsupported filter.");
    const parsed = parseFilter(name, String(value), limits);
    if (parsed?.value !== value)
      throw new RangeError("The search plan contains a non-canonical filter.");
    filterCount += parsed.count;
    filters[name] = value;
  }
  if (filterCount > limits.maxFilterValues)
    throw new RangeError("The search plan exceeds the filter ceiling.");
  if (!canonicalPolicySort(request.sort, policy.sorts))
    throw new RangeError("The search plan contains a non-canonical sort.");
  const query = request.query;
  if (
    query !== normalizedText(query) ||
    UTF8.encode(query).byteLength === 0 ||
    UTF8.encode(query).byteLength > limits.maxSearchQueryBytes
  )
    throw new RangeError(
      "The search plan query is not normalized and bounded.",
    );
  if (
    !positiveInteger(request.limit) ||
    request.limit > Math.min(limits.maxSearchResults, limits.maxPageSize)
  )
    throw new RangeError(
      "The search result limit exceeds the current ceiling.",
    );
  return {
    filters,
    kind: "exact_structured",
    limit: request.limit,
    query,
    semanticCandidates: 0,
    semanticCalls: 0,
    semanticDegraded: "disabled",
  };
}

export function buildQueryServiceEnvelope(
  request: NormalizedRequest,
  publicationId: string,
  environment: DeploymentEnvironment,
  continuation: QueryContinuation | null,
  limits: ApiLimits,
  effectiveLimit = request.limit,
): QueryServiceEnvelope {
  assertApiLimits(limits);
  parsePublicationPin(publicationId);
  if (!new Set(["local", "preview", "production", "test"]).has(environment))
    throw new RangeError("The query environment is invalid.");
  if (request.method === "OPTIONS")
    throw new RangeError("CORS preflight is not a query operation.");
  const operation = closedOperation(request.operation);
  const policyKey = operationPolicy(operation);
  const policy = policyKey === null ? null : API_ROUTE_POLICIES[policyKey];
  const filters: Record<string, NormalizedFilterValue> = {};
  let filterCount = 0;
  for (const [name, value] of Object.entries(request.filters)) {
    if (!policy?.filters.includes(name as never))
      throw new RangeError(
        "The query envelope contains an unsupported filter.",
      );
    const parsed = parseFilter(name, String(value), limits);
    if (parsed?.value !== value)
      throw new RangeError(
        "The query envelope contains a non-canonical filter.",
      );
    filters[name] = value;
    filterCount += parsed.count;
  }
  if (filterCount > limits.maxFilterValues)
    throw new RangeError("The query envelope exceeds the filter ceiling.");
  const sort = [...request.sort];
  if (
    policy === null
      ? sort.length !== 0
      : !canonicalPolicySort(sort, policy.sorts)
  )
    throw new RangeError("The query envelope contains a non-canonical sort.");
  const query = request.query;
  if (operation.kind === "search") {
    if (
      query === null ||
      query !== normalizedText(query) ||
      UTF8.encode(query).byteLength === 0 ||
      UTF8.encode(query).byteLength > limits.maxSearchQueryBytes
    )
      throw new RangeError("The search query is not normalized and bounded.");
  } else if (query !== null) {
    throw new RangeError("Only search operations may contain query text.");
  }
  if (!positiveInteger(effectiveLimit))
    throw new RangeError("The effective query limit is invalid.");
  const routeMaximum =
    request.operation.kind === "search"
      ? Math.min(limits.maxSearchResults, limits.maxPageSize)
      : limits.maxPageSize;
  if (effectiveLimit > routeMaximum)
    throw new RangeError(
      "The effective query limit exceeds the current ceiling.",
    );
  if (continuation !== null) {
    const continuationPolicy = cursorOperationPolicy(operationName(operation));
    if (
      continuationPolicy === null ||
      !STABLE_ID.test(continuation.stableId) ||
      !continuationPolicy.stablePrefixes.some((prefix) =>
        continuation.stableId.startsWith(prefix),
      ) ||
      continuation.lastSortTuple.length !== sort.length ||
      continuation.lastSortTuple.at(-1) !== continuation.stableId ||
      continuation.lastSortTuple.some(
        (item) =>
          item !== null &&
          typeof item !== "boolean" &&
          (typeof item !== "string" || UTF8.encode(item).byteLength > 512),
      )
    )
      throw new RangeError("The query continuation is invalid.");
  }
  const normalizedRequest = {
    ...request,
    filters,
    limit: effectiveLimit,
    operation,
    query,
    sort,
  } satisfies NormalizedRequest;
  return {
    audience: "quantclarity-catalog-query-v1",
    continuation:
      continuation === null
        ? null
        : {
            lastSortTuple: [...continuation.lastSortTuple],
            stableId: continuation.stableId,
          },
    environment,
    filters: Object.fromEntries(
      Object.entries(filters).sort(([left], [right]) =>
        compareText(left, right),
      ),
    ),
    limit: effectiveLimit,
    operation,
    publicationId,
    searchPlan:
      operation.kind === "search"
        ? buildExactStructuredSearchPlan(normalizedRequest, limits)
        : null,
    sort,
    version: 1,
  };
}

export type CacheDecision =
  | { cacheable: false; policy: "private, no-store" }
  | {
      cacheable: true;
      internalKey: string;
      policy: "max-age=0, must-revalidate";
    };

type CacheEligibleRequest = NormalizedRequest & {
  method: "GET" | "HEAD";
  operation: Extract<QueryOperation, { kind: "detail" }>;
};

function cacheEligibleRequest(
  request: NormalizedRequest,
): request is CacheEligibleRequest {
  const routeOperation = request.route.operation;
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    !request.hasQueryString &&
    request.cursor === null &&
    request.query === null &&
    request.operation.kind === "detail" &&
    routeOperation.kind === "detail" &&
    routeOperation.resourceType === request.operation.resourceType &&
    routeOperation.identifier === request.operation.identifier &&
    STABLE_ID.test(request.operation.identifier) &&
    detail(request.operation.resourceType, request.operation.identifier) !==
      null
  );
}

export function cacheDecision(
  request: NormalizedRequest,
  publicationId: string,
  trustedOrigin: string,
  representation: PublicationRepresentation = "json",
): CacheDecision {
  const origin = new URL(trustedOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== trustedOrigin ||
    origin.username !== "" ||
    origin.password !== ""
  )
    throw new RangeError("Cache origin must be a fixed exact HTTPS origin.");
  if (!cacheEligibleRequest(request))
    return { cacheable: false, policy: "private, no-store" };
  return {
    cacheable: true,
    internalKey: publicationCacheKey(trustedOrigin, {
      publicationId,
      representation,
      resourceId: request.operation.identifier,
      resourceType: request.operation.resourceType,
    }),
    policy: "max-age=0, must-revalidate",
  };
}

export async function representationEtag(
  publicationId: string,
  representation: "json" | "yaml",
  bytes: Uint8Array,
  subtle: SubtleCrypto,
): Promise<string> {
  parsePublicationPin(publicationId);
  const representationBytes = new Uint8Array(bytes.byteLength);
  representationBytes.set(bytes);
  const representationDigest = await subtle.digest(
    "SHA-256",
    representationBytes.buffer,
  );
  const representationHash = [...new Uint8Array(representationDigest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const digest = await subtle.digest(
    "SHA-256",
    UTF8.encode(
      `quantclarity-etag-v1\0${publicationId}\0${representation}\0${representationHash}`,
    ),
  );
  const etag = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `"${etag}"`;
}

export function ifNoneMatchMatches(
  value: string | null,
  etag: string,
): boolean {
  if (value === null || value.length > 256) return false;
  const opaque = (candidate: string) =>
    candidate.startsWith("W/") ? candidate.slice(2) : candidate;
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .some(
      (candidate) => candidate === "*" || opaque(candidate) === opaque(etag),
    );
}

export function validIfNoneMatch(value: string | null): boolean {
  if (value === null) return true;
  if (value.length > 256 || UTF8.encode(value).byteLength > 256) return false;
  if (/^[\t ]*\*[\t ]*$/u.test(value)) return true;
  return IF_NONE_MATCH_LIST.test(value);
}

export function corsHeaders(): Readonly<Record<string, string>> {
  return {
    "Access-Control-Allow-Headers": "If-None-Match, X-QuantClarity-Publication",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
    "Access-Control-Max-Age": "600",
  };
}

export function bodyForMethod<T>(methodValue: ApiMethod, body: T): T | null {
  return methodValue === "HEAD" ? null : body;
}

export function boundedError(
  error: ApiError,
  limits: ApiLimits,
): {
  error: { code: string; details?: readonly ErrorDetail[]; message: string };
} {
  assertApiLimits(limits);
  const allowedParameters = new Set([
    "X-QuantClarity-Publication",
    "cursor",
    "filters",
    "limit",
    "q",
    "query",
    "sort",
    ...Object.values(API_ROUTE_POLICIES).flatMap((policy) => policy.filters),
  ]);
  const allowedReason = (reason: string) =>
    new Set(["duplicate", "invalid", "unsupported", "unsupported syntax"]).has(
      reason,
    ) || /^maximum is [1-9][0-9]*$/u.test(reason);
  const details = error.details
    ?.filter(
      (item) =>
        allowedParameters.has(item.parameter) && allowedReason(item.reason),
    )
    .slice(0, limits.maxErrorDetails)
    .map((item) => ({ parameter: item.parameter, reason: item.reason }));
  const messages: Readonly<Record<ApiError["code"], string>> = {
    invalid_cursor: "The cursor is invalid.",
    invalid_parameter: "The request contains an invalid parameter.",
    method_not_allowed: "Only GET, HEAD, and OPTIONS are supported.",
    query_too_large: "The request exceeds a configured size limit.",
    resource_not_found: "The requested resource does not exist.",
    unsupported_filter: "The request contains an unsupported parameter.",
  };
  return {
    error: {
      code: error.code,
      ...(details === undefined || details.length === 0 ? {} : { details }),
      message: messages[error.code],
    },
  };
}

export function assertRuntimeBudgetUsage(
  limits: ApiLimits,
  usage: {
    cpuMilliseconds: number;
    responseBytes: number;
    semanticCalls: number;
    semanticCandidates: number;
    subrequests: number;
    upstreamCalls: number;
  },
): void {
  assertApiLimits(limits);
  if (
    !Number.isFinite(usage.cpuMilliseconds) ||
    usage.cpuMilliseconds < 0 ||
    usage.cpuMilliseconds > limits.maxCpuMilliseconds
  )
    throw new RangeError("CPU budget exceeded.");
  if (
    !Number.isSafeInteger(usage.responseBytes) ||
    usage.responseBytes < 0 ||
    usage.responseBytes > limits.maxResponseBytes
  )
    throw new RangeError("Response byte budget exceeded.");
  if (
    !Number.isSafeInteger(usage.upstreamCalls) ||
    usage.upstreamCalls < 0 ||
    usage.upstreamCalls > limits.maxUpstreamCalls
  )
    throw new RangeError("Upstream call budget exceeded.");
  if (
    !Number.isSafeInteger(usage.semanticCalls) ||
    usage.semanticCalls < 0 ||
    usage.semanticCalls > limits.maxSemanticCalls
  )
    throw new RangeError("Semantic call budget exceeded.");
  if (
    !Number.isSafeInteger(usage.semanticCandidates) ||
    usage.semanticCandidates < 0 ||
    usage.semanticCandidates > limits.maxSemanticCandidates
  )
    throw new RangeError("Semantic candidate budget exceeded.");
  if (
    usage.upstreamCalls > usage.subrequests ||
    usage.semanticCalls > usage.upstreamCalls
  )
    throw new RangeError("Runtime call budgets are internally inconsistent.");
  if (
    !Number.isSafeInteger(usage.subrequests) ||
    usage.subrequests < 0 ||
    usage.subrequests > limits.maxSubrequests
  )
    throw new RangeError("Subrequest budget exceeded.");
}
