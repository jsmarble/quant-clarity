import {
  assertApiLimits,
  buildQueryServiceEnvelope,
  encodeModelDetailRepresentation,
  MODEL_DETAIL_PUBLIC_MAX_BYTES,
  snapshotModelDetailModel,
  type ApiLimits,
  type DeploymentEnvironment,
  type ModelDetailLookupProvenanceV2,
  type ModelDetailLookupV2,
  type ModelDetailQueryRpcV1,
  type ModelDetailQueryRpcV2,
  type ModelDetailResponse,
  type NormalizedRequest,
  type QueryServiceEnvelope,
  type ReadModelDetailV1Input,
  type ReadModelDetailV2Input,
} from "@quant-clarity/api-core";
import type { Model } from "@quant-clarity/contracts";

export type { ModelDetailResponse } from "@quant-clarity/api-core";

const AUDIENCE = "quantclarity-catalog-query-v1" as const;
const FRESH_REQUEST_HORIZON_MS = 15 * 60 * 1000;
const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const MODEL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const SCHEMA_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const UTF8 = new TextEncoder();
const MAX_SCHEMA_VERSION_CHARACTERS = 128;
const MAX_SCHEMA_VERSION_BYTES = 512;
const MAX_SNAPSHOT_KEY_CHARACTERS = 128;
const MAX_SNAPSHOT_KEY_BYTES = 512;
const MODEL_SLUG_MAX_BYTES = 128;

const validSchemaVersion = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_SCHEMA_VERSION_CHARACTERS &&
  UTF8.encode(value).byteLength <= MAX_SCHEMA_VERSION_BYTES &&
  SCHEMA_VERSION.test(value);

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
      code: "not_found";
      publicationId: string;
    }>
  | Readonly<{
      success: false;
      code:
        | "integrity_failure"
        | "invalid_input"
        | "publication_not_ready"
        | "read_failure";
    }>;

export type ModelDetailApiV2Input = Readonly<
  Omit<ModelDetailApiInput, "service"> & {
    service: ModelDetailQueryRpcV2 | Service;
  }
>;

export type ModelDetailApiV2Outcome =
  | Readonly<{
      success: true;
      detail: ModelDetailResponse;
      lookup: ModelDetailLookupV2;
      lookupProvenance: ModelDetailLookupProvenanceV2;
      publicationId: string;
      representationBytes: Uint8Array;
    }>
  | Exclude<ModelDetailApiOutcome, { success: true }>;

type ModelDetailSelectionV2 = Readonly<{
  audience: "quantclarity-catalog-query-v1";
  bookmark: string;
  environment: DeploymentEnvironment;
  kind: "model_detail_v2_selection";
  lookup: ModelDetailLookupV2;
  maxRepresentationBytes: number;
  publicationId: string;
  requiredAvailableUntilMs: number;
  version: 1;
}>;

type ModelDetailSelectionV2Outcome =
  | Readonly<{ selection: ModelDetailSelectionV2; success: true }>
  | Exclude<
      ModelDetailApiV2Outcome,
      Readonly<{ success: true }> | Readonly<{ code: "not_found" }>
    >;

export type ModelDetailSelectedReadV2Outcome =
  | Extract<ModelDetailApiV2Outcome, Readonly<{ success: true }>>
  | Extract<ModelDetailApiV2Outcome, Readonly<{ code: "not_found" }>>
  | Readonly<{
      success: false;
      code: "integrity_failure" | "invalid_input" | "read_failure";
    }>;

type ReadSelectedModelDetailV2Input = Readonly<{
  limits: ApiLimits;
  selection: ModelDetailSelectionV2;
  service: Pick<ModelDetailQueryRpcV2, "readModelDetailV2"> | Service;
}>;

/**
 * Resolver-minted, request-lifetime capability for same-isolate cache
 * orchestration. It exposes only canonical cache-selection facts and an opaque,
 * one-shot canonical read. It is not an RPC, cache, persistence, logging, or
 * public-response contract.
 */
export type ResolvedModelDetailReadV2 = Readonly<{
  lookup: ModelDetailLookupV2;
  publicationId: string;
  readCanonical: () => Promise<ModelDetailSelectedReadV2Outcome>;
}>;

export type ResolvedModelDetailContinuationV2 = (
  resolved: ResolvedModelDetailReadV2,
) => Promise<ModelDetailApiV2Outcome>;

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

const validModelSlug = (value: string): boolean =>
  value.length <= MODEL_SLUG_MAX_BYTES &&
  UTF8.encode(value).byteLength <= MODEL_SLUG_MAX_BYTES &&
  MODEL_SLUG.test(value);

const modelDetailNormalizedRequest = (
  identifier: string,
  method: "GET" | "HEAD",
  publicationHeader: string | null,
): ModelDetailNormalizedRequest => ({
  cursor: null,
  filters: {},
  hasQueryString: false,
  limit: 25,
  limitProvided: false,
  method,
  operation: {
    identifier,
    kind: "detail",
    resourceType: "model",
  },
  publicationHeader,
  query: null,
  route: {
    operation: {
      identifier,
      kind: "detail",
      resourceType: "model",
    },
    policy: "models",
  },
  sort: ["name", "stable_id"],
  sortProvided: false,
});

const parseRequestForIdentifier = (
  value: unknown,
  acceptsIdentifier: (identifier: string) => boolean,
): ModelDetailNormalizedRequest | null => {
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
      !acceptsIdentifier(operation.identifier) ||
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
    return modelDetailNormalizedRequest(
      operation.identifier,
      request.method,
      request.publicationHeader,
    );
  } catch {
    return null;
  }
};

const parseRequest = (value: unknown): ModelDetailNormalizedRequest | null =>
  parseRequestForIdentifier(value, (identifier) => MODEL_ID.test(identifier));

const parseRequestV2 = (value: unknown): ModelDetailNormalizedRequest | null =>
  parseRequestForIdentifier(
    value,
    (identifier) => MODEL_ID.test(identifier) || validModelSlug(identifier),
  );

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
      outcome: Exclude<ModelDetailSelectionV2Outcome, { success: true }>;
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

const encodeAcceptedModelDetail = (
  input: Readonly<{
    model: Model;
    publicationId: string;
    schemaVersion: string;
  }>,
): ReturnType<typeof encodeModelDetailRepresentation> | null => {
  try {
    return encodeModelDetailRepresentation(input);
  } catch {
    return null;
  }
};

type ParsedModelDetailSelectionV2 = Readonly<{
  bookmark: string;
  environment: DeploymentEnvironment;
  lookup: ModelDetailLookupV2;
  maxRepresentationBytes: number;
  publicationId: string;
  requiredAvailableUntilMs: number;
}>;

const freezeLookup = (lookup: ModelDetailLookupV2): ModelDetailLookupV2 =>
  Object.freeze({ ...lookup });

const modelDetailSelection = (
  input: Readonly<{
    bookmark: string;
    environment: DeploymentEnvironment;
    lookup: ModelDetailLookupV2;
    maxRepresentationBytes: number;
    publicationId: string;
    requiredAvailableUntilMs: number;
  }>,
): ModelDetailSelectionV2 => {
  const lookup = freezeLookup(input.lookup);
  return Object.freeze({
    audience: AUDIENCE,
    bookmark: input.bookmark,
    environment: input.environment,
    kind: "model_detail_v2_selection",
    lookup,
    maxRepresentationBytes: input.maxRepresentationBytes,
    publicationId: input.publicationId,
    requiredAvailableUntilMs: input.requiredAvailableUntilMs,
    version: 1,
  });
};

const parseSelectionLookup = (value: unknown): ModelDetailLookupV2 | null => {
  const lookup = snapshotOwnRecord(value, ["kind", "value"]);
  if (
    typeof lookup?.value !== "string" ||
    (lookup.kind !== "stable_id" && lookup.kind !== "slug") ||
    (lookup.kind === "stable_id"
      ? !MODEL_ID.test(lookup.value)
      : !validModelSlug(lookup.value))
  )
    return null;
  return { kind: lookup.kind, value: lookup.value };
};

const parseModelDetailSelection = (
  value: unknown,
): ParsedModelDetailSelectionV2 | null => {
  const selection = snapshotOwnRecord(value, [
    "audience",
    "bookmark",
    "environment",
    "kind",
    "lookup",
    "maxRepresentationBytes",
    "publicationId",
    "requiredAvailableUntilMs",
    "version",
  ]);
  const lookup = parseSelectionLookup(selection?.lookup);
  if (
    selection?.version !== 1 ||
    selection.audience !== AUDIENCE ||
    selection.kind !== "model_detail_v2_selection" ||
    !validEnvironment(selection.environment) ||
    typeof selection.bookmark !== "string" ||
    selection.bookmark.length === 0 ||
    selection.bookmark.length > 4096 ||
    selection.bookmark === "first-primary" ||
    selection.bookmark === "first-unconstrained" ||
    lookup === null ||
    !Number.isSafeInteger(selection.maxRepresentationBytes) ||
    (selection.maxRepresentationBytes as number) < 1 ||
    (selection.maxRepresentationBytes as number) >
      MODEL_DETAIL_PUBLIC_MAX_BYTES ||
    typeof selection.publicationId !== "string" ||
    !PUBLICATION_ID.test(selection.publicationId) ||
    !Number.isSafeInteger(selection.requiredAvailableUntilMs) ||
    (selection.requiredAvailableUntilMs as number) < 0
  )
    return null;
  return {
    bookmark: selection.bookmark,
    environment: selection.environment,
    lookup: freezeLookup(lookup),
    maxRepresentationBytes: selection.maxRepresentationBytes as number,
    publicationId: selection.publicationId,
    requiredAvailableUntilMs: selection.requiredAvailableUntilMs as number,
  };
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
        return {
          success: false,
          code: "not_found",
          publicationId: resolver.publicationId,
        };
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
    const model = snapshotModelDetailModel({
      expectedModelId: modelId,
      maxRepresentationBytes: input.limits.maxResponseBytes,
      model: response.model,
    });
    if (model === null) return { success: false, code: "integrity_failure" };
    const representation = encodeAcceptedModelDetail({
      model,
      publicationId: resolver.publicationId,
      schemaVersion: response.schemaVersion,
    });
    if (representation === null)
      return { success: false, code: "integrity_failure" };
    const { detail, representationBytes } = representation;
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

const resolveModelDetailPublicationV2 = async (
  input: ModelDetailApiV2Input,
): Promise<ModelDetailSelectionV2Outcome> => {
  try {
    const environment = input.environment;
    const limits = input.limits;
    const nowMs = input.nowMs;
    const requestValue = input.request;
    const service = input.service;
    assertApiLimits(limits);
    const maxRepresentationBytes = Math.min(
      limits.maxResponseBytes,
      MODEL_DETAIL_PUBLIC_MAX_BYTES,
    );
    const request = parseRequestV2(requestValue);
    if (
      request === null ||
      !validEnvironment(environment) ||
      !Number.isSafeInteger(nowMs) ||
      nowMs < 0 ||
      nowMs > Number.MAX_SAFE_INTEGER - FRESH_REQUEST_HORIZON_MS
    )
      return { success: false, code: "invalid_input" };

    const identifier = request.operation.identifier;
    const lookup = MODEL_ID.test(identifier)
      ? ({ kind: "stable_id", value: identifier } as const)
      : ({ kind: "slug", value: identifier } as const);
    const requiredAvailableUntilMs = nowMs + FRESH_REQUEST_HORIZON_MS;
    let resolverValue: unknown;
    try {
      resolverValue = await (
        service as ModelDetailQueryRpcV2
      ).resolvePublicationV2({
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
    if (resolver.kind === "failure") return resolver.outcome;
    if (resolver.kind === "invalid")
      return { success: false, code: "integrity_failure" };
    if (
      request.publicationHeader !== null &&
      resolver.publicationId !== request.publicationHeader
    )
      return { success: false, code: "integrity_failure" };

    return {
      selection: modelDetailSelection({
        bookmark: resolver.bookmark,
        environment,
        lookup,
        maxRepresentationBytes,
        publicationId: resolver.publicationId,
        requiredAvailableUntilMs,
      }),
      success: true,
    };
  } catch {
    return { success: false, code: "invalid_input" };
  }
};

const readSelectedModelDetailFromQueryV2 = async (
  input: ReadSelectedModelDetailV2Input,
): Promise<ModelDetailSelectedReadV2Outcome> => {
  try {
    const top = snapshotOwnRecord(input, ["limits", "selection", "service"]);
    if (top === null) return { success: false, code: "integrity_failure" };
    const limits = top.limits as ApiLimits;
    try {
      assertApiLimits(limits);
    } catch {
      return { success: false, code: "invalid_input" };
    }
    const selection = parseModelDetailSelection(top.selection);
    if (
      selection?.maxRepresentationBytes !==
      Math.min(limits.maxResponseBytes, MODEL_DETAIL_PUBLIC_MAX_BYTES)
    )
      return { success: false, code: "integrity_failure" };
    const request = modelDetailNormalizedRequest(
      selection.lookup.value,
      "GET",
      null,
    );
    let envelope: QueryServiceEnvelope;
    try {
      envelope = buildQueryServiceEnvelope(
        request,
        selection.publicationId,
        selection.environment,
        null,
        limits,
      );
    } catch {
      return { success: false, code: "integrity_failure" };
    }
    const readInput: ReadModelDetailV2Input = {
      version: 2,
      audience: AUDIENCE,
      environment: selection.environment,
      bookmark: selection.bookmark,
      requiredAvailableUntilMs: selection.requiredAvailableUntilMs,
      envelope,
      lookup: selection.lookup,
    };
    let readValue: unknown;
    try {
      readValue = await (
        top.service as ModelDetailQueryRpcV2
      ).readModelDetailV2(readInput);
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
        notFound.publicationId === selection.publicationId &&
        validSchemaVersion(notFound.schemaVersion)
      )
        return {
          success: false,
          code: "not_found",
          publicationId: selection.publicationId,
        };
      return { success: false, code: "integrity_failure" };
    }
    const response = snapshotOwnRecord(readValue, [
      "lookupProvenance",
      "model",
      "outcome",
      "publicationId",
      "schemaVersion",
    ]);
    const provenance = snapshotOwnRecord(response?.lookupProvenance, [
      "canonicalSlug",
      "matchedBy",
      "projectionVersion",
    ]);
    if (
      response?.outcome !== "model" ||
      response.publicationId !== selection.publicationId ||
      !validSchemaVersion(response.schemaVersion) ||
      provenance?.projectionVersion !== "model-slug@1" ||
      typeof provenance.canonicalSlug !== "string" ||
      !validModelSlug(provenance.canonicalSlug) ||
      (provenance.matchedBy !== "stable_id" &&
        provenance.matchedBy !== "current_slug" &&
        provenance.matchedBy !== "historical_slug")
    )
      return { success: false, code: "integrity_failure" };

    const model = snapshotModelDetailModel({
      expectedModelId:
        selection.lookup.kind === "stable_id" ? selection.lookup.value : null,
      maxRepresentationBytes: selection.maxRepresentationBytes,
      model: response.model,
    });
    if (
      model?.slug.state !== "known" ||
      model.slug.value !== provenance.canonicalSlug ||
      (selection.lookup.kind === "stable_id"
        ? provenance.matchedBy !== "stable_id"
        : (provenance.matchedBy !== "current_slug" &&
            provenance.matchedBy !== "historical_slug") ||
          (provenance.matchedBy === "current_slug" &&
            provenance.canonicalSlug !== selection.lookup.value) ||
          (provenance.matchedBy === "historical_slug" &&
            provenance.canonicalSlug === selection.lookup.value))
    )
      return { success: false, code: "integrity_failure" };

    const lookupProvenance: ModelDetailLookupProvenanceV2 = {
      matchedBy: provenance.matchedBy,
      canonicalSlug: provenance.canonicalSlug,
      projectionVersion: "model-slug@1",
    };
    const representation = encodeAcceptedModelDetail({
      model,
      publicationId: selection.publicationId,
      schemaVersion: response.schemaVersion,
    });
    if (representation === null)
      return { success: false, code: "integrity_failure" };
    const { detail, representationBytes } = representation;
    if (
      representationBytes.byteLength > MODEL_DETAIL_PUBLIC_MAX_BYTES ||
      representationBytes.byteLength > selection.maxRepresentationBytes
    )
      return { success: false, code: "integrity_failure" };
    return {
      success: true,
      detail,
      lookup: selection.lookup,
      lookupProvenance,
      publicationId: selection.publicationId,
      representationBytes,
    };
  } catch {
    return { success: false, code: "invalid_input" };
  }
};

interface ModelDetailReadStateV2 {
  current: ReadSelectedModelDetailV2Input | null;
}

const modelDetailReadControlsV2 = (state: ModelDetailReadStateV2) => {
  let active = true;
  const readCanonical = Object.freeze(
    async (): Promise<ModelDetailSelectedReadV2Outcome> => {
      const current = state.current;
      if (!active || current === null)
        return { success: false, code: "integrity_failure" };
      state.current = null;
      return readSelectedModelDetailFromQueryV2(current);
    },
  );
  return Object.freeze({
    readCanonical,
    revoke: Object.freeze(() => {
      active = false;
      state.current = null;
    }),
  });
};

const modelDetailReadCapabilityV2 = (
  initialState: ReadSelectedModelDetailV2Input,
): Readonly<{
  resolved: ResolvedModelDetailReadV2;
  revoke: () => void;
}> => {
  const lookup = freezeLookup(initialState.selection.lookup);
  const publicationId = initialState.selection.publicationId;
  const controls = modelDetailReadControlsV2({ current: initialState });
  return Object.freeze({
    resolved: Object.freeze({
      lookup,
      publicationId,
      readCanonical: controls.readCanonical,
    }),
    revoke: controls.revoke,
  });
};

/**
 * Resolves the publication before invoking cache orchestration. The continuation
 * receives no bookmark, request, service, limits, or forgeable selected-read
 * input; its one-shot read closure retains those values privately.
 */
export const executeAfterModelDetailPublicationResolutionV2 = async (
  input: ModelDetailApiV2Input,
  continuation: ResolvedModelDetailContinuationV2,
): Promise<ModelDetailApiV2Outcome> => {
  let captured: ModelDetailApiV2Input;
  try {
    captured = {
      environment: input.environment,
      limits: input.limits,
      nowMs: input.nowMs,
      request: input.request,
      service: input.service,
    };
    if (typeof continuation !== "function")
      return { success: false, code: "invalid_input" };
  } catch {
    return { success: false, code: "invalid_input" };
  }

  const selected = await resolveModelDetailPublicationV2(captured);
  if (!selected.success) return selected;
  const capability = modelDetailReadCapabilityV2({
    limits: captured.limits,
    selection: selected.selection,
    service: captured.service,
  });
  try {
    return await continuation(capability.resolved);
  } catch {
    return { success: false, code: "read_failure" };
  } finally {
    capability.revoke();
  }
};

export const readModelDetailFromQueryV2 = async (
  input: ModelDetailApiV2Input,
): Promise<ModelDetailApiV2Outcome> => {
  return executeAfterModelDetailPublicationResolutionV2(
    input,
    ({ readCanonical }) => readCanonical(),
  );
};
