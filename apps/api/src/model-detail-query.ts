import {
  assertApiLimits,
  buildQueryServiceEnvelope,
  type ApiLimits,
  type DeploymentEnvironment,
  type ModelDetailQueryRpcV1,
  type NormalizedRequest,
  type QueryServiceEnvelope,
  type ReadModelDetailV1Input,
} from "@quant-clarity/api-core";
import { checkModelContract, type Model } from "@quant-clarity/contracts";

const AUDIENCE = "quantclarity-catalog-query-v1" as const;
const FRESH_REQUEST_HORIZON_MS = 15 * 60 * 1000;
const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const SCHEMA_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const UTF8 = new TextEncoder();
const MAX_SCHEMA_VERSION_CHARACTERS = 128;
const MAX_SCHEMA_VERSION_BYTES = 512;
const MAX_SNAPSHOT_OBJECT_KEYS = 256;
const MAX_SNAPSHOT_KEY_CHARACTERS = 128;
const MAX_SNAPSHOT_KEY_BYTES = 512;

const validSchemaVersion = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_SCHEMA_VERSION_CHARACTERS &&
  UTF8.encode(value).byteLength <= MAX_SCHEMA_VERSION_BYTES &&
  SCHEMA_VERSION.test(value);

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

export type ModelDetailApiInput = Readonly<{
  environment: DeploymentEnvironment;
  limits: ApiLimits;
  nowMs: number;
  request: NormalizedRequest;
  service: ModelDetailQueryRpcV1 | Service;
}>;

export type ModelDetailApiOutcome =
  | Readonly<{
      success: true;
      detail: ModelDetailResponse;
      publicationId: string;
      representationBytes: Uint8Array;
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
        | "not_found"
        | "publication_not_ready"
        | "read_failure";
    }>;

type ModelDetailNormalizedRequest = Omit<
  NormalizedRequest,
  "operation" | "route"
> &
  Readonly<{
    operation: Readonly<{
      identifier: string;
      kind: "detail";
      resourceType: "model";
    }>;
    route: Readonly<{
      operation: Readonly<{
        identifier: string;
        kind: "detail";
        resourceType: "model";
      }>;
      policy: "models";
    }>;
  }>;

const snapshotOwnRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some(
        (key) =>
          typeof key !== "string" ||
          key.length > MAX_SNAPSHOT_KEY_CHARACTERS ||
          UTF8.encode(key).byteLength > MAX_SNAPSHOT_KEY_BYTES,
      )
    )
      return null;
    const actualKeys = (ownKeys as string[]).sort();
    const sortedExpected = [...expectedKeys].sort();
    if (sortedExpected.some((key, index) => actualKeys[index] !== key))
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

const snapshotArray = (
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

const parseRequest = (value: unknown): ModelDetailNormalizedRequest | null => {
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
    const operation = snapshotOwnRecord(request?.operation, [
      "identifier",
      "kind",
      "resourceType",
    ]);
    const route = snapshotOwnRecord(request?.route, ["operation", "policy"]);
    const routeOperation = snapshotOwnRecord(route?.operation, [
      "identifier",
      "kind",
      "resourceType",
    ]);
    const filters = snapshotOwnRecord(request?.filters, []);
    const sort = snapshotArray(request?.sort, 2);
    if (
      request === null ||
      operation?.kind !== "detail" ||
      operation.resourceType !== "model" ||
      typeof operation.identifier !== "string" ||
      !MODEL_ID.test(operation.identifier) ||
      route?.policy !== "models" ||
      routeOperation?.kind !== "detail" ||
      routeOperation.resourceType !== "model" ||
      routeOperation.identifier !== operation.identifier ||
      filters === null ||
      sort?.length !== 2 ||
      sort[0] !== "name" ||
      sort[1] !== "stable_id" ||
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
      operation: {
        identifier: operation.identifier,
        kind: "detail",
        resourceType: "model",
      },
      publicationHeader: request.publicationHeader,
      query: null,
      route: {
        operation: {
          identifier: operation.identifier,
          kind: "detail",
          resourceType: "model",
        },
        policy: "models",
      },
      sort: ["name", "stable_id"],
      sortProvided: false,
    };
  } catch {
    return null;
  }
};

const validEnvironment = (value: unknown): value is DeploymentEnvironment =>
  value === "local" ||
  value === "preview" ||
  value === "production" ||
  value === "test";

type ResolverClassification =
  | Readonly<{
      kind: "selected";
      bookmark: string;
      publicationId: string;
      requiredAvailableUntilMs: number;
    }>
  | Readonly<{
      kind: "failure";
      outcome: Exclude<ModelDetailApiOutcome, { success: true }>;
    }>
  | Readonly<{ kind: "invalid" }>;

const classifyResolver = (
  value: unknown,
  requiredAvailableUntilMs: number,
): ResolverClassification => {
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
  const expired = snapshotOwnRecord(value, ["currentPublicationId", "outcome"]);
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
    return { kind: "invalid" };
  return {
    kind: "selected",
    bookmark: selected.bookmark,
    publicationId: selected.publicationId,
    requiredAvailableUntilMs,
  };
};

interface SnapshotBudget {
  remaining: number;
  seen: WeakSet<object>;
}

const snapshotJson = (value: unknown, budget: SnapshotBudget): unknown => {
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
      const array = snapshotArray(value, Math.max(0, budget.remaining));
      if (array === null) throw new TypeError("hostile array");
      return array.map((item) => snapshotJson(item, budget));
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("hostile object");
    const keys = Reflect.ownKeys(value);
    if (
      keys.length > MAX_SNAPSHOT_OBJECT_KEYS ||
      keys.length > budget.remaining ||
      keys.some((key) => typeof key !== "string")
    )
      throw new TypeError("hostile object keys");
    let keyBytes = 0;
    for (const key of keys as string[]) {
      if (
        key.length > MAX_SNAPSHOT_KEY_CHARACTERS ||
        key.length > budget.remaining
      )
        throw new RangeError("snapshot budget exceeded");
      const bytes = UTF8.encode(key).byteLength;
      if (bytes > MAX_SNAPSHOT_KEY_BYTES) throw new TypeError("hostile key");
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
      output[key] = snapshotJson(descriptor.value, budget);
    }
    return output;
  } finally {
    budget.seen.delete(value);
  }
};

const snapshotModel = (
  value: unknown,
  modelId: string,
  maxResponseBytes: number,
): Model | null => {
  try {
    if (maxResponseBytes > Math.floor(Number.MAX_SAFE_INTEGER / 2)) return null;
    const detached = snapshotJson(value, {
      remaining: Math.max(4096, maxResponseBytes * 2),
      seen: new WeakSet(),
    });
    if (!checkModelContract(detached) || detached.model_id !== modelId)
      return null;
    return detached;
  } catch {
    return null;
  }
};

export const readModelDetailFromQueryV1 = async (
  input: ModelDetailApiInput,
): Promise<ModelDetailApiOutcome> => {
  try {
    assertApiLimits(input.limits);
    const request = parseRequest(input.request);
    if (
      request === null ||
      !validEnvironment(input.environment) ||
      !Number.isSafeInteger(input.nowMs) ||
      input.nowMs < 0 ||
      input.nowMs > Number.MAX_SAFE_INTEGER - FRESH_REQUEST_HORIZON_MS
    )
      return { success: false, code: "invalid_input" };
    const requiredAvailableUntilMs = input.nowMs + FRESH_REQUEST_HORIZON_MS;
    let resolverValue: unknown;
    try {
      resolverValue = await (
        input.service as ModelDetailQueryRpcV1
      ).resolvePublicationV2({
        version: 2,
        audience: AUDIENCE,
        environment: input.environment,
        requestedPublicationId: request.publicationHeader,
        requiredAvailableUntilMs,
      });
    } catch {
      return { success: false, code: "read_failure" };
    }
    const resolver = classifyResolver(resolverValue, requiredAvailableUntilMs);
    if (resolver.kind === "failure") return resolver.outcome;
    if (resolver.kind === "invalid")
      return { success: false, code: "integrity_failure" };
    if (
      request.publicationHeader !== null &&
      resolver.publicationId !== request.publicationHeader
    )
      return { success: false, code: "integrity_failure" };
    let envelope: QueryServiceEnvelope;
    try {
      envelope = buildQueryServiceEnvelope(
        request,
        resolver.publicationId,
        input.environment,
        null,
        input.limits,
      );
    } catch {
      return { success: false, code: "invalid_input" };
    }
    const readInput: ReadModelDetailV1Input = {
      version: 1,
      audience: AUDIENCE,
      environment: input.environment,
      bookmark: resolver.bookmark,
      requiredAvailableUntilMs,
      envelope,
    };
    let readValue: unknown;
    try {
      readValue = await (
        input.service as ModelDetailQueryRpcV1
      ).readModelDetailV1(readInput);
    } catch {
      return { success: false, code: "read_failure" };
    }
    const failure = snapshotOwnRecord(readValue, ["outcome"]);
    if (failure !== null) {
      if (
        failure.outcome === "integrity_failure" ||
        failure.outcome === "read_failure"
      )
        return { success: false, code: failure.outcome };
      return { success: false, code: "integrity_failure" };
    }
    const notFound = snapshotOwnRecord(readValue, [
      "outcome",
      "publicationId",
      "schemaVersion",
    ]);
    if (notFound !== null) {
      if (
        notFound.outcome === "not_found" &&
        notFound.publicationId === resolver.publicationId &&
        validSchemaVersion(notFound.schemaVersion)
      )
        return { success: false, code: "not_found" };
      return { success: false, code: "integrity_failure" };
    }
    const response = snapshotOwnRecord(readValue, [
      "model",
      "outcome",
      "publicationId",
      "schemaVersion",
    ]);
    if (
      response?.outcome !== "model" ||
      response.publicationId !== resolver.publicationId ||
      !validSchemaVersion(response.schemaVersion)
    )
      return { success: false, code: "integrity_failure" };
    const modelId = request.operation.identifier;
    const model = snapshotModel(
      response.model,
      modelId,
      input.limits.maxResponseBytes,
    );
    if (model === null) return { success: false, code: "integrity_failure" };
    const detail: ModelDetailResponse = {
      data: model,
      meta: {
        resource: "models",
        publication_id: resolver.publicationId,
        schema_version: response.schemaVersion,
        sort: ["name", "stable_id"],
        filters: {},
      },
    };
    const representationBytes = UTF8.encode(JSON.stringify(detail));
    if (representationBytes.byteLength > input.limits.maxResponseBytes)
      return { success: false, code: "integrity_failure" };
    return {
      success: true,
      detail,
      publicationId: resolver.publicationId,
      representationBytes,
    };
  } catch {
    return { success: false, code: "invalid_input" };
  }
};
