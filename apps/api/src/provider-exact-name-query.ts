import {
  buildQueryServiceEnvelope,
  type ApiLimits,
  type DeploymentEnvironment,
  type NormalizedRequest,
  type QueryServiceEnvelope,
} from "@quant-clarity/api-core";
import { normalizeExactSearchName } from "@quant-clarity/publication-core";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const PROVIDER_ID = new RegExp(`^prv_${UUID_V4}$`, "u");
const EVIDENCE_ID = new RegExp(`^evd_${UUID_V4}$`, "u");
const RFC3339_MILLISECONDS =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const UTF8 = new TextEncoder();
const AUDIENCE = "quantclarity-catalog-query-v1" as const;

export type ProviderExactNameApiResult = Readonly<{
  tier: 3;
  resourceType: "provider";
  resourceId: string;
  matchKind: "provider_name";
  displayName: Readonly<{
    state: "known";
    value: string;
    observed_at: string;
    evidence_ids: readonly string[];
  }>;
  semanticDegraded: "disabled";
  normalizedOrderingKey: string;
}>;

export type ProviderExactNameApiOutcome =
  | Readonly<{
      success: true;
      publicationId: string;
      results: readonly ProviderExactNameApiResult[];
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

export interface CatalogQueryRpcV1 {
  resolvePublicationV1(input: unknown): Promise<unknown>;
  readProviderExactNameTierV1(input: unknown): Promise<unknown>;
}

export type ProviderExactNameApiInput = Readonly<{
  service: CatalogQueryRpcV1;
  request: NormalizedRequest;
  environment: DeploymentEnvironment;
  limits: ApiLimits;
}>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

const validEnvironment = (value: unknown): value is DeploymentEnvironment =>
  value === "local" ||
  value === "preview" ||
  value === "production" ||
  value === "test";

const normalizedQuery = (value: string): boolean => {
  try {
    return value === value.normalize("NFC").trim().replace(/\s+/gu, " ");
  } catch {
    return false;
  }
};

const canonicalTimestamp = (value: string): boolean => {
  if (!RFC3339_MILLISECONDS.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const validRequest = (value: unknown): value is NormalizedRequest => {
  if (
    !record(value) ||
    !exactKeys(value, [
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
    ]) ||
    (value.method !== "GET" && value.method !== "HEAD") ||
    value.cursor !== null ||
    value.hasQueryString !== true ||
    typeof value.limitProvided !== "boolean" ||
    typeof value.sortProvided !== "boolean" ||
    !Number.isSafeInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > 20 ||
    (value.publicationHeader !== null &&
      (typeof value.publicationHeader !== "string" ||
        !PUBLICATION_ID.test(value.publicationHeader))) ||
    typeof value.query !== "string" ||
    value.query.includes("\u0000") ||
    !normalizedQuery(value.query) ||
    UTF8.encode(value.query).byteLength === 0 ||
    UTF8.encode(value.query).byteLength > 200 ||
    !record(value.operation) ||
    !exactKeys(value.operation, ["kind"]) ||
    value.operation.kind !== "search" ||
    !record(value.route) ||
    !exactKeys(value.route, ["operation", "policy"]) ||
    value.route.policy !== "search" ||
    !record(value.route.operation) ||
    !exactKeys(value.route.operation, ["kind"]) ||
    value.route.operation.kind !== "search" ||
    !record(value.filters) ||
    !Array.isArray(value.sort) ||
    value.sort.length !== 2 ||
    value.sort[0] !== "relevance" ||
    value.sort[1] !== "stable_id"
  )
    return false;
  const filterKeys = Object.keys(value.filters);
  return (
    filterKeys.length === 0 ||
    (filterKeys.length === 1 &&
      filterKeys[0] === "record_type" &&
      value.filters.record_type === "provider")
  );
};

const resolverSuccess = (
  value: unknown,
): value is Readonly<{
  outcome: "selected";
  publicationId: string;
  bookmark: string;
}> =>
  record(value) &&
  exactKeys(value, ["bookmark", "outcome", "publicationId"]) &&
  value.outcome === "selected" &&
  typeof value.publicationId === "string" &&
  PUBLICATION_ID.test(value.publicationId) &&
  typeof value.bookmark === "string" &&
  value.bookmark.length > 0 &&
  value.bookmark.length <= 4096 &&
  value.bookmark !== "first-primary" &&
  value.bookmark !== "first-unconstrained";

const resolverFailure = (
  value: unknown,
): ProviderExactNameApiOutcome | null => {
  if (!record(value)) return null;
  if (
    exactKeys(value, ["currentPublicationId", "outcome"]) &&
    value.outcome === "publication_expired" &&
    typeof value.currentPublicationId === "string" &&
    PUBLICATION_ID.test(value.currentPublicationId)
  )
    return {
      success: false,
      code: "publication_expired",
      currentPublicationId: value.currentPublicationId,
    };
  if (!exactKeys(value, ["outcome"])) return null;
  switch (value.outcome) {
    case "integrity_failure":
    case "publication_not_ready":
    case "read_failure":
      return { success: false, code: value.outcome };
    default:
      return null;
  }
};

const tierFailure = (value: unknown): ProviderExactNameApiOutcome | null => {
  if (!record(value) || !exactKeys(value, ["outcome"])) return null;
  if (value.outcome === "integrity_failure")
    return { success: false, code: "integrity_failure" };
  if (value.outcome === "read_failure")
    return { success: false, code: "read_failure" };
  return null;
};

const validFact = (value: unknown): boolean =>
  record(value) &&
  exactKeys(value, ["evidence_ids", "observed_at", "state", "value"]) &&
  value.state === "known" &&
  typeof value.value === "string" &&
  !value.value.includes("\u0000") &&
  Array.from(value.value).length > 0 &&
  Array.from(value.value).length <= 200 &&
  typeof value.observed_at === "string" &&
  canonicalTimestamp(value.observed_at) &&
  Array.isArray(value.evidence_ids) &&
  value.evidence_ids.length > 0 &&
  value.evidence_ids.every(
    (id) => typeof id === "string" && EVIDENCE_ID.test(id),
  ) &&
  new Set(value.evidence_ids).size === value.evidence_ids.length;

const validResult = (value: unknown): value is ProviderExactNameApiResult =>
  record(value) &&
  exactKeys(value, [
    "displayName",
    "matchKind",
    "normalizedOrderingKey",
    "resourceId",
    "resourceType",
    "semanticDegraded",
    "tier",
  ]) &&
  value.tier === 3 &&
  value.resourceType === "provider" &&
  typeof value.resourceId === "string" &&
  PROVIDER_ID.test(value.resourceId) &&
  value.matchKind === "provider_name" &&
  validFact(value.displayName) &&
  value.semanticDegraded === "disabled" &&
  typeof value.normalizedOrderingKey === "string" &&
  !value.normalizedOrderingKey.includes("\u0000") &&
  UTF8.encode(value.normalizedOrderingKey).byteLength > 0 &&
  UTF8.encode(value.normalizedOrderingKey).byteLength <= 800;

const tierPage = (
  value: unknown,
  publicationId: string,
  limit: number,
  query: string,
  maxResponseBytes: number,
): readonly ProviderExactNameApiResult[] | null => {
  try {
    const serialized = JSON.stringify(value);
    if (UTF8.encode(serialized).byteLength > maxResponseBytes) return null;
  } catch {
    return null;
  }
  if (
    !record(value) ||
    !exactKeys(value, ["outcome", "page"]) ||
    value.outcome !== "page" ||
    !record(value.page) ||
    !exactKeys(value.page, [
      "nextAfterProviderId",
      "publicationId",
      "results",
    ]) ||
    value.page.publicationId !== publicationId ||
    !Array.isArray(value.page.results) ||
    value.page.results.length > limit ||
    (value.page.nextAfterProviderId !== null &&
      (typeof value.page.nextAfterProviderId !== "string" ||
        !PROVIDER_ID.test(value.page.nextAfterProviderId))) ||
    !value.page.results.every(validResult)
  )
    return null;
  const nextAfterProviderId = value.page.nextAfterProviderId;
  if (
    nextAfterProviderId !== null &&
    (value.page.results.length !== limit ||
      value.page.results.at(-1)?.resourceId !== nextAfterProviderId)
  )
    return null;
  let expectedOrderingKey: string;
  try {
    expectedOrderingKey = normalizeExactSearchName(query);
  } catch {
    return null;
  }
  const seenIds = new Set<string>();
  let priorKey = "";
  let priorId = "";
  try {
    for (const result of value.page.results) {
      if (
        result.normalizedOrderingKey !== expectedOrderingKey ||
        normalizeExactSearchName(result.displayName.value) !==
          expectedOrderingKey ||
        seenIds.has(result.resourceId) ||
        result.normalizedOrderingKey < priorKey ||
        (result.normalizedOrderingKey === priorKey &&
          result.resourceId <= priorId)
      )
        return null;
      seenIds.add(result.resourceId);
      priorKey = result.normalizedOrderingKey;
      priorId = result.resourceId;
    }
  } catch {
    return null;
  }
  return value.page.results;
};

export const readProviderExactNameFromQueryV1 = async (
  input: ProviderExactNameApiInput,
): Promise<ProviderExactNameApiOutcome> => {
  if (
    !record(input) ||
    !exactKeys(input, ["environment", "limits", "request", "service"]) ||
    !validEnvironment(input.environment) ||
    !validRequest(input.request) ||
    !record(input.service)
  )
    return { success: false, code: "invalid_input" };
  const query = input.request.query;
  if (query === null) return { success: false, code: "invalid_input" };

  let resolved: unknown;
  try {
    resolved = await input.service.resolvePublicationV1({
      version: 1,
      audience: AUDIENCE,
      environment: input.environment,
      requestedPublicationId: input.request.publicationHeader,
    });
  } catch {
    return { success: false, code: "read_failure" };
  }
  if (!resolverSuccess(resolved))
    return (
      resolverFailure(resolved) ?? {
        success: false,
        code: "integrity_failure",
      }
    );
  if (
    input.request.publicationHeader !== null &&
    resolved.publicationId !== input.request.publicationHeader
  )
    return { success: false, code: "integrity_failure" };

  let envelope: QueryServiceEnvelope;
  try {
    envelope = buildQueryServiceEnvelope(
      input.request,
      resolved.publicationId,
      input.environment,
      null,
      input.limits,
    );
  } catch {
    return { success: false, code: "invalid_input" };
  }

  let tier: unknown;
  try {
    tier = await input.service.readProviderExactNameTierV1({
      version: 1,
      audience: AUDIENCE,
      environment: input.environment,
      bookmark: resolved.bookmark,
      envelope,
    });
  } catch {
    return { success: false, code: "read_failure" };
  }
  const results = tierPage(
    tier,
    resolved.publicationId,
    input.request.limit,
    query,
    input.limits.maxResponseBytes,
  );
  if (results === null)
    return (
      tierFailure(tier) ?? {
        success: false,
        code: "integrity_failure",
      }
    );
  return {
    success: true,
    publicationId: resolved.publicationId,
    results: results.map((result) => ({
      ...result,
      displayName: {
        ...result.displayName,
        evidence_ids: [...result.displayName.evidence_ids],
      },
    })),
  };
};
