import {
  ifNoneMatchMatches,
  MODEL_DETAIL_PUBLIC_MAX_BYTES,
  representationEtag,
  validIfNoneMatch,
} from "@quant-clarity/api-core";

import type { ModelDetailApiV2Outcome } from "./model-detail-query.js";
import type { ModelDetailRequestPlan } from "./model-detail-request-plan.js";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const MODEL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

const PUBLIC_HEADERS = {
  ...SECURITY_HEADERS,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
} as const;

type ModelDetailLookupPlan = Extract<
  ModelDetailRequestPlan,
  Readonly<{ kind: "lookup" }>
>;

export type ModelDetailResponsePlanInput = Readonly<{
  outcome: ModelDetailApiV2Outcome;
  requestPlan: ModelDetailLookupPlan;
}>;

export type ModelDetailResponsePlan = Readonly<{
  bodyBytes: Uint8Array | null;
  headers: Readonly<Record<string, string>>;
  status: 200 | 304 | 308 | 404 | 409 | 503;
}>;

type SnapshotInput = Readonly<{
  identifier: string;
  identifierKind: "slug" | "stable_id";
  ifNoneMatch: string | null;
  method: "GET" | "HEAD";
  outcome: SnapshotOutcome | null;
  publicationHeader: string | null;
}>;

type SnapshotOutcome =
  | Readonly<{
      canonicalSlug: string;
      lookupKind: unknown;
      lookupValue: unknown;
      matchedBy: unknown;
      publicationId: unknown;
      representationBytes: unknown;
      success: true;
    }>
  | Readonly<{
      code: "not_found";
      publicationId: unknown;
      success: false;
    }>
  | Readonly<{
      code: "publication_expired";
      currentPublicationId: unknown;
      success: false;
    }>
  | Readonly<{
      code:
        | "integrity_failure"
        | "invalid_input"
        | "publication_not_ready"
        | "read_failure";
      success: false;
    }>;

const snapshotRecord = (
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
      keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    )
      return null;
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
};

const snapshotOutcome = (value: unknown): SnapshotOutcome | null => {
  const success = snapshotRecord(value, [
    "detail",
    "lookup",
    "lookupProvenance",
    "publicationId",
    "representationBytes",
    "success",
  ]);
  if (success?.success === true) {
    const lookup = snapshotRecord(success.lookup, ["kind", "value"]);
    const provenance = snapshotRecord(success.lookupProvenance, [
      "canonicalSlug",
      "matchedBy",
      "projectionVersion",
    ]);
    if (
      (lookup?.kind !== "stable_id" && lookup?.kind !== "slug") ||
      typeof lookup.value !== "string" ||
      provenance?.projectionVersion !== "model-slug@1" ||
      typeof provenance.canonicalSlug !== "string" ||
      !MODEL_SLUG.test(provenance.canonicalSlug) ||
      UTF8.encode(provenance.canonicalSlug).byteLength > 128
    )
      return null;
    return {
      canonicalSlug: provenance.canonicalSlug,
      lookupKind: lookup.kind,
      lookupValue: lookup.value,
      matchedBy: provenance.matchedBy,
      publicationId: success.publicationId,
      representationBytes: success.representationBytes,
      success: true,
    };
  }

  const notFound = snapshotRecord(value, ["code", "publicationId", "success"]);
  if (notFound?.success === false && notFound.code === "not_found")
    return {
      code: "not_found",
      publicationId: notFound.publicationId,
      success: false,
    };

  const expired = snapshotRecord(value, [
    "code",
    "currentPublicationId",
    "success",
  ]);
  if (expired?.success === false && expired.code === "publication_expired")
    return {
      code: "publication_expired",
      currentPublicationId: expired.currentPublicationId,
      success: false,
    };

  const failure = snapshotRecord(value, ["code", "success"]);
  if (
    failure?.success === false &&
    (failure.code === "integrity_failure" ||
      failure.code === "invalid_input" ||
      failure.code === "publication_not_ready" ||
      failure.code === "read_failure")
  )
    return { code: failure.code, success: false };
  return null;
};

const snapshotInput = (input: unknown): SnapshotInput | null => {
  const top = snapshotRecord(input, ["outcome", "requestPlan"]);
  const plan = snapshotRecord(top?.requestPlan, [
    "identifier",
    "identifierKind",
    "ifNoneMatch",
    "kind",
    "request",
  ]);
  const request = snapshotRecord(plan?.request, [
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
  const operation = snapshotRecord(request?.operation, [
    "identifier",
    "kind",
    "resourceType",
  ]);
  if (
    top === null ||
    plan?.kind !== "lookup" ||
    (plan.identifierKind !== "slug" && plan.identifierKind !== "stable_id") ||
    typeof plan.identifier !== "string" ||
    (plan.identifierKind === "stable_id"
      ? !MODEL_ID.test(plan.identifier)
      : !MODEL_SLUG.test(plan.identifier) ||
        UTF8.encode(plan.identifier).byteLength > 128) ||
    (plan.ifNoneMatch !== null && typeof plan.ifNoneMatch !== "string") ||
    request === null ||
    (request.method !== "GET" && request.method !== "HEAD") ||
    (request.publicationHeader !== null &&
      (typeof request.publicationHeader !== "string" ||
        !PUBLICATION_ID.test(request.publicationHeader))) ||
    operation?.kind !== "detail" ||
    operation.resourceType !== "model" ||
    operation.identifier !== plan.identifier
  )
    return null;
  return {
    identifier: plan.identifier,
    identifierKind: plan.identifierKind,
    ifNoneMatch: plan.ifNoneMatch,
    method: request.method,
    outcome: snapshotOutcome(top.outcome),
    publicationHeader: request.publicationHeader,
  };
};

const headers = (
  cacheControl: string,
  publicationId: string | null = null,
): Record<string, string> => ({
  ...PUBLIC_HEADERS,
  "Cache-Control": cacheControl,
  ...(publicationId === null
    ? {}
    : {
        Vary: "X-QuantClarity-Publication",
        "X-QuantClarity-Publication": publicationId,
      }),
});

const response = (
  status: ModelDetailResponsePlan["status"],
  responseHeaders: Record<string, string>,
  bodyBytes: Uint8Array | null,
): ModelDetailResponsePlan => ({
  bodyBytes: bodyBytes === null ? null : new Uint8Array(bodyBytes),
  headers: Object.freeze({ ...responseHeaders }),
  status,
});

const errorResponse = (
  method: "GET" | "HEAD",
  status: 404 | 409 | 503,
  code: string,
  message: string,
  publicationId: string | null = null,
): ModelDetailResponsePlan => {
  const bodyBytes = UTF8.encode(JSON.stringify({ error: { code, message } }));
  return response(
    status,
    {
      ...headers("private, no-store", publicationId),
      "Content-Length": String(bodyBytes.byteLength),
      "Content-Type": "application/json; charset=utf-8",
    },
    method === "HEAD" ? null : bodyBytes,
  );
};

const unavailable = (method: "GET" | "HEAD"): ModelDetailResponsePlan =>
  errorResponse(
    method,
    503,
    "temporarily_unavailable",
    "The Model detail is temporarily unavailable.",
  );

const ownData = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
};

const representationIdentity = (
  bytes: Uint8Array,
): Readonly<{ modelId: string; publicationId: string }> | null => {
  try {
    const parsed: unknown = JSON.parse(UTF8_DECODER.decode(bytes));
    const data = ownData(parsed, "data");
    const meta = ownData(parsed, "meta");
    const modelId = ownData(data, "model_id");
    const publicationId = ownData(meta, "publication_id");
    return typeof modelId === "string" &&
      MODEL_ID.test(modelId) &&
      typeof publicationId === "string" &&
      PUBLICATION_ID.test(publicationId)
      ? { modelId, publicationId }
      : null;
  } catch {
    return null;
  }
};

/**
 * Pure B3-B publication-bound response plan. It creates no Response, cache,
 * query, limiter, log, metric, cookie, or browser-persistence effect.
 */
export const planModelDetailResponse = async (
  input: ModelDetailResponsePlanInput,
  subtle: SubtleCrypto,
): Promise<ModelDetailResponsePlan> => {
  const request = snapshotInput(input);
  if (request === null) return unavailable("GET");
  if (!validIfNoneMatch(request.ifNoneMatch))
    return unavailable(request.method);

  try {
    const outcome = request.outcome;
    if (outcome === null) return unavailable(request.method);
    if (!outcome.success) {
      if (outcome.code === "not_found")
        return typeof outcome.publicationId === "string" &&
          PUBLICATION_ID.test(outcome.publicationId) &&
          (request.publicationHeader === null ||
            request.publicationHeader === outcome.publicationId)
          ? errorResponse(
              request.method,
              404,
              "resource_not_found",
              "The requested resource does not exist.",
              outcome.publicationId,
            )
          : unavailable(request.method);
      if (outcome.code === "publication_expired")
        return request.publicationHeader !== null &&
          typeof outcome.currentPublicationId === "string" &&
          PUBLICATION_ID.test(outcome.currentPublicationId)
          ? errorResponse(
              request.method,
              409,
              "publication_expired",
              "The requested publication is no longer available.",
              outcome.currentPublicationId,
            )
          : unavailable(request.method);
      if (outcome.code === "publication_not_ready")
        return errorResponse(
          request.method,
          503,
          "publication_not_ready",
          "No public dataset has been published yet.",
        );
      return unavailable(request.method);
    }

    if (
      typeof outcome.publicationId !== "string" ||
      !PUBLICATION_ID.test(outcome.publicationId) ||
      !(outcome.representationBytes instanceof Uint8Array) ||
      Object.getPrototypeOf(outcome.representationBytes) !==
        Uint8Array.prototype ||
      outcome.representationBytes.byteLength > MODEL_DETAIL_PUBLIC_MAX_BYTES
    )
      return unavailable(request.method);
    const representationBytes = new Uint8Array(outcome.representationBytes);
    const identity = representationIdentity(representationBytes);
    if (
      identity?.publicationId !== outcome.publicationId ||
      outcome.lookupKind !== request.identifierKind ||
      outcome.lookupValue !== request.identifier ||
      (request.publicationHeader !== null &&
        request.publicationHeader !== outcome.publicationId) ||
      (request.identifierKind === "stable_id"
        ? outcome.matchedBy !== "stable_id" ||
          identity.modelId !== request.identifier
        : (outcome.matchedBy !== "current_slug" &&
            outcome.matchedBy !== "historical_slug") ||
          (outcome.matchedBy === "current_slug"
            ? outcome.canonicalSlug !== request.identifier
            : outcome.canonicalSlug === request.identifier))
    )
      return unavailable(request.method);

    if (
      outcome.matchedBy === "historical_slug" &&
      request.publicationHeader === null
    )
      return response(
        308,
        {
          ...headers("private, no-store", outcome.publicationId),
          "Content-Length": "0",
          Location: `/v1/models/${identity.modelId}`,
        },
        null,
      );

    let etag: string;
    try {
      etag = await representationEtag(
        outcome.publicationId,
        "json",
        representationBytes,
        subtle,
      );
    } catch {
      return unavailable(request.method);
    }
    const cacheControl =
      request.identifierKind === "stable_id"
        ? "private, max-age=0, must-revalidate"
        : "private, no-store";
    const successHeaders = {
      ...headers(cacheControl, outcome.publicationId),
      ETag: etag,
    };
    if (ifNoneMatchMatches(request.ifNoneMatch, etag))
      return response(304, successHeaders, null);
    return response(
      200,
      {
        ...successHeaders,
        "Content-Length": String(representationBytes.byteLength),
        "Content-Type": "application/json; charset=utf-8",
      },
      request.method === "HEAD" ? null : representationBytes,
    );
  } catch {
    return unavailable(request.method);
  }
};
