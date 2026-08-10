import {
  assertApiLimits,
  buildQueryServiceEnvelope,
  encodeMethodologyDetailRepresentation,
  methodologyRegistryEntry,
  type ApiLimits,
  type DeploymentEnvironment,
  type MethodologyContextQueryRpcV1,
  type MethodologyDetailResponse,
  type NormalizedRequest,
  type ReadMethodologyContextV1Input,
} from "@quant-clarity/api-core";

const AUDIENCE = "quantclarity-catalog-query-v1" as const;
const FRESH_REQUEST_HORIZON_MS = 15 * 60 * 1000;
const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");

export type MethodologyDetailApiOutcome =
  | Readonly<{
      success: true;
      detail: MethodologyDetailResponse;
      publicationId: string;
      representationBytes: Uint8Array;
    }>
  | Readonly<{ success: false; code: "methodology_not_found" }>
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

export type MethodologyDetailApiInput = Readonly<{
  environment: DeploymentEnvironment;
  limits: ApiLimits;
  nowMs: number;
  request: NormalizedRequest;
  service: MethodologyContextQueryRpcV1 | Service;
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
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== expectedLength
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

const snapshotMethodologyRequest = (
  value: unknown,
): NormalizedRequest | null => {
  const request = ownDataRecord(value, [
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
  const operation = ownDataRecord(request?.operation, ["kind", "version"]);
  const route = ownDataRecord(request?.route, ["operation", "policy"]);
  const routeOperation = ownDataRecord(route?.operation, ["kind", "version"]);
  const filters = ownDataRecord(request?.filters, []);
  const sort = ownDataArray(request?.sort, 1);
  if (
    request === null ||
    operation?.kind !== "methodology_detail" ||
    typeof operation.version !== "string" ||
    route?.policy !== "methodologies" ||
    routeOperation?.kind !== "methodology_detail" ||
    routeOperation.version !== operation.version ||
    filters === null ||
    sort?.[0] !== "version" ||
    (request.method !== "GET" && request.method !== "HEAD") ||
    request.cursor !== null ||
    request.hasQueryString !== false ||
    request.limit !== 25 ||
    request.limitProvided !== false ||
    request.query !== null ||
    request.sortProvided !== false ||
    (request.publicationHeader !== null &&
      (typeof request.publicationHeader !== "string" ||
        !PUBLICATION_ID.test(request.publicationHeader)))
  )
    return null;
  return {
    cursor: null,
    filters: {},
    hasQueryString: false,
    limit: 25,
    limitProvided: false,
    method: request.method,
    operation: { kind: "methodology_detail", version: operation.version },
    publicationHeader: request.publicationHeader,
    query: null,
    route: {
      operation: { kind: "methodology_detail", version: operation.version },
      policy: "methodologies",
    },
    sort: ["version"],
    sortProvided: false,
  };
};

type SelectedPublication = Readonly<{
  bookmark: string;
  publicationId: string;
  requiredAvailableUntilMs: number;
}>;

const classifyResolver = (
  value: unknown,
  requiredAvailableUntilMs: number,
):
  | Readonly<{ kind: "selected"; value: SelectedPublication }>
  | Readonly<{
      kind: "outcome";
      value: Exclude<MethodologyDetailApiOutcome, { success: true }>;
    }> => {
  const simple = ownDataRecord(value, ["outcome"]);
  if (simple !== null) {
    if (
      simple.outcome === "integrity_failure" ||
      simple.outcome === "publication_not_ready" ||
      simple.outcome === "read_failure"
    )
      return {
        kind: "outcome",
        value: { success: false, code: simple.outcome },
      };
    return {
      kind: "outcome",
      value: { success: false, code: "integrity_failure" },
    };
  }
  const expired = ownDataRecord(value, ["currentPublicationId", "outcome"]);
  if (expired !== null)
    return expired.outcome === "publication_expired" &&
      typeof expired.currentPublicationId === "string" &&
      PUBLICATION_ID.test(expired.currentPublicationId)
      ? {
          kind: "outcome",
          value: {
            success: false,
            code: "publication_expired",
            currentPublicationId: expired.currentPublicationId,
          },
        }
      : {
          kind: "outcome",
          value: { success: false, code: "integrity_failure" },
        };
  const selected = ownDataRecord(value, [
    "bookmark",
    "outcome",
    "publicationId",
    "requiredAvailableUntilMs",
  ]);
  if (
    selected?.outcome !== "selected" ||
    typeof selected.publicationId !== "string" ||
    !PUBLICATION_ID.test(selected.publicationId) ||
    typeof selected.bookmark !== "string" ||
    selected.bookmark.length === 0 ||
    selected.bookmark.length > 4096 ||
    selected.bookmark === "first-primary" ||
    selected.bookmark === "first-unconstrained" ||
    selected.requiredAvailableUntilMs !== requiredAvailableUntilMs
  )
    return {
      kind: "outcome",
      value: { success: false, code: "integrity_failure" },
    };
  return {
    kind: "selected",
    value: {
      bookmark: selected.bookmark,
      publicationId: selected.publicationId,
      requiredAvailableUntilMs,
    },
  };
};

/** Performs one resolver and one bookmark-continuous methodology-context read. */
export const readMethodologyDetailFromQueryV1 = async (
  input: MethodologyDetailApiInput,
): Promise<MethodologyDetailApiOutcome> => {
  try {
    const top = ownDataRecord(input, [
      "environment",
      "limits",
      "nowMs",
      "request",
      "service",
    ]);
    if (top === null) return { success: false, code: "invalid_input" };
    const limits = top.limits as ApiLimits;
    const environment = top.environment;
    const nowMs = top.nowMs;
    const request = snapshotMethodologyRequest(top.request);
    const service = top.service;
    assertApiLimits(limits);
    if (
      request === null ||
      (environment !== "local" &&
        environment !== "test" &&
        environment !== "preview" &&
        environment !== "production") ||
      !Number.isSafeInteger(nowMs) ||
      (nowMs as number) < 0 ||
      (nowMs as number) > Number.MAX_SAFE_INTEGER - FRESH_REQUEST_HORIZON_MS
    )
      return { success: false, code: "invalid_input" };

    let resolvePublication: (value: unknown) => Promise<unknown>;
    let readContext: (value: unknown) => Promise<unknown>;
    try {
      const resolver = (service as MethodologyContextQueryRpcV1)
        .resolvePublicationV2;
      const reader = (service as MethodologyContextQueryRpcV1)
        .readMethodologyContextV1;
      if (typeof resolver !== "function" || typeof reader !== "function")
        return { success: false, code: "read_failure" };
      resolvePublication = resolver;
      readContext = reader;
    } catch {
      return { success: false, code: "read_failure" };
    }

    const requiredAvailableUntilMs =
      (nowMs as number) + FRESH_REQUEST_HORIZON_MS;
    let resolverValue: unknown;
    try {
      resolverValue = await resolvePublication.call(service, {
        version: 2,
        audience: AUDIENCE,
        environment,
        requestedPublicationId: request.publicationHeader,
        requiredAvailableUntilMs,
      });
    } catch {
      return { success: false, code: "read_failure" };
    }
    const resolver = classifyResolver(resolverValue, requiredAvailableUntilMs);
    if (resolver.kind === "outcome") return resolver.value;
    if (
      request.publicationHeader !== null &&
      resolver.value.publicationId !== request.publicationHeader
    )
      return { success: false, code: "integrity_failure" };

    const version =
      request.operation.kind === "methodology_detail"
        ? request.operation.version
        : "";
    if (methodologyRegistryEntry(version) === null)
      return { success: false, code: "methodology_not_found" };

    let envelope;
    try {
      envelope = buildQueryServiceEnvelope(
        request,
        resolver.value.publicationId,
        environment,
        null,
        limits,
      );
    } catch {
      return { success: false, code: "invalid_input" };
    }
    const readInput: ReadMethodologyContextV1Input = {
      version: 1,
      audience: AUDIENCE,
      environment,
      bookmark: resolver.value.bookmark,
      requiredAvailableUntilMs,
      envelope,
    };
    let contextValue: unknown;
    try {
      contextValue = await readContext.call(service, readInput);
    } catch {
      return { success: false, code: "read_failure" };
    }
    const failure = ownDataRecord(contextValue, ["outcome"]);
    if (failure !== null)
      return failure.outcome === "integrity_failure" ||
        failure.outcome === "read_failure"
        ? { success: false, code: failure.outcome }
        : { success: false, code: "integrity_failure" };
    const context = ownDataRecord(contextValue, [
      "outcome",
      "publicationId",
      "publicApiOrigin",
      "schemaVersion",
    ]);
    if (
      context?.outcome !== "context" ||
      context.publicationId !== resolver.value.publicationId ||
      typeof context.publicApiOrigin !== "string" ||
      context.publicApiOrigin.length > 2048 ||
      typeof context.schemaVersion !== "string" ||
      context.schemaVersion.length > 128
    )
      return { success: false, code: "integrity_failure" };
    let representation;
    try {
      representation = encodeMethodologyDetailRepresentation({
        publicApiOrigin: context.publicApiOrigin,
        publicationId: resolver.value.publicationId,
        schemaVersion: context.schemaVersion,
        version,
      });
    } catch {
      return { success: false, code: "integrity_failure" };
    }
    if (representation.representationBytes.byteLength > limits.maxResponseBytes)
      return { success: false, code: "integrity_failure" };
    return {
      success: true,
      detail: representation.detail,
      publicationId: resolver.value.publicationId,
      representationBytes: representation.representationBytes,
    };
  } catch {
    return { success: false, code: "integrity_failure" };
  }
};
