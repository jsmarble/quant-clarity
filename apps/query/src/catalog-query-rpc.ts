import type { QueryServiceEnvelope } from "@quant-clarity/api-core";

import {
  ProviderExactNameError,
  readProviderExactNamePage,
  type ProviderExactNamePage,
} from "./provider-exact-name.js";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
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

type ResolveRow = Readonly<{
  current_publication_id: string;
  rollback_candidate_publication_id: string | null;
  current_publication_state: string | null;
  selected_publication_id: string | null;
  selected_publication_state: string | null;
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
    UTF8.encode(value).byteLength > 200 ||
    ["*", "\\", "[", "]", "{", "}", "|"].some((token) => value.includes(token))
  )
    return false;
  try {
    return value === value.normalize("NFC").trim().replace(/\s+/gu, " ");
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
