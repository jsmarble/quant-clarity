import {
  ifNoneMatchMatches,
  representationEtag,
  validateAndNormalizeRequest,
  type ApiLimits,
  type DeploymentEnvironment,
  type NormalizedRequest,
} from "@quant-clarity/api-core";
import type { ErrorEnvelope } from "@quant-clarity/contracts";
import { sourcePrefixes } from "@quant-clarity/domain/source-address";

import { readDatasetMetadataFromQueryV1 } from "./dataset-metadata-query.js";

type Env = CloudflareEnv & {
  RATE_LIMIT_HMAC_KEY: string;
};

const DEPLOYMENT_ENVIRONMENT: DeploymentEnvironment = "local";
const CONDITIONAL_HEADER_MAX_BYTES = 256;
const PUBLICATION_HEADER_MAX_BYTES = 40;
const UTF8 = new TextEncoder();
const ENTITY_TAG = String.raw`(?:W/)?"[\x21\x23-\x7e]*"`;
const IF_NONE_MATCH_LIST = new RegExp(
  String.raw`^[\t ]*${ENTITY_TAG}(?:[\t ]*,[\t ]*${ENTITY_TAG})*[\t ]*$`,
  "u",
);

const API_LIMITS: ApiLimits = {
  defaultPageSize: 25,
  maxBodyBytes: 1024,
  maxCpuMilliseconds: 50,
  maxCursorCharacters: 4096,
  maxErrorDetails: 10,
  maxFilterValues: 10,
  maxPageSize: 100,
  maxPathBytes: 512,
  maxQueryBytes: 4096,
  maxQueryValueBytes: 512,
  maxResponseBytes: 65_536,
  maxSearchQueryBytes: 200,
  maxSearchResults: 20,
  maxSemanticCalls: 0,
  maxSemanticCandidates: 0,
  maxSubrequests: 4,
  maxUpstreamCalls: 2,
  maxUrlBytes: 8192,
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function json(
  body: unknown,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  const headers = new Headers({
    ...SECURITY_HEADERS,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
    "Cache-Control": "private, no-store",
  });
  new Headers(extraHeaders).forEach((value, key) => {
    headers.set(key, value);
  });
  return Response.json(body, {
    status,
    headers,
  });
}

function error(
  code: string,
  message: string,
  status: number,
  extraHeaders: HeadersInit = {},
): Response {
  const body: ErrorEnvelope = { error: { code, message } };
  return json(body, status, extraHeaders);
}

type ProtocolPlan =
  | Readonly<{
      ifNoneMatch: string | null;
      kind: "metadata";
      request: NormalizedRequest;
    }>
  | Readonly<{ kind: "response"; response: Response }>;

const targetTooLarge = (): ProtocolPlan => ({
  kind: "response",
  response: error(
    "query_too_large",
    "The request target exceeds the configured size limit.",
    413,
  ),
});

const bodyBytesWithoutReading = (request: Request): number => {
  const declared = request.headers.get("Content-Length");
  if (declared === null) return request.body === null ? 0 : 1;
  if (declared.length > 16) return API_LIMITS.maxBodyBytes + 1;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(declared)) return Number.NaN;
  const parsed = Number(declared);
  if (!Number.isSafeInteger(parsed)) return API_LIMITS.maxBodyBytes + 1;
  return request.body === null ? parsed : Math.max(1, parsed);
};

const validIfNoneMatch = (value: string | null): boolean => {
  if (value === null) return true;
  if (
    value.length > CONDITIONAL_HEADER_MAX_BYTES ||
    UTF8.encode(value).byteLength > CONDITIONAL_HEADER_MAX_BYTES
  )
    return false;
  if (/^[\t ]*\*[\t ]*$/u.test(value)) return true;
  return IF_NONE_MATCH_LIST.test(value);
};

function protocolResponsePlan(request: Request): ProtocolPlan {
  const rawUrl = request.url;
  if (
    rawUrl.length > API_LIMITS.maxUrlBytes ||
    UTF8.encode(rawUrl).byteLength > API_LIMITS.maxUrlBytes
  )
    return targetTooLarge();

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      kind: "response",
      response: error(
        "invalid_parameter",
        "The request target is malformed.",
        400,
      ),
    };
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "")
    return {
      kind: "response",
      response: error(
        "invalid_parameter",
        "The request target is malformed.",
        400,
      ),
    };

  const queryMarker = rawUrl.indexOf("?", rawUrl.indexOf("://") + 3);
  const hasQueryString = queryMarker >= 0;
  const rawQuery = hasQueryString ? url.search.slice(1) : "";
  const pathnameBytes = UTF8.encode(url.pathname).byteLength;
  const queryBytes = UTF8.encode(rawQuery).byteLength;
  const targetBytes = pathnameBytes + (hasQueryString ? queryBytes + 1 : 0);
  if (
    pathnameBytes > API_LIMITS.maxPathBytes ||
    queryBytes > API_LIMITS.maxQueryBytes ||
    targetBytes > API_LIMITS.maxUrlBytes
  )
    return targetTooLarge();

  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.method !== "OPTIONS"
  )
    return {
      kind: "response",
      response: error(
        "method_not_allowed",
        "Only GET, HEAD, and OPTIONS are supported.",
        405,
        { Allow: "GET, HEAD, OPTIONS" },
      ),
    };

  const bodyBytes = bodyBytesWithoutReading(request);
  if (!Number.isSafeInteger(bodyBytes) || bodyBytes < 0)
    return {
      kind: "response",
      response: error(
        "invalid_parameter",
        "The request body size is invalid.",
        400,
      ),
    };
  if (bodyBytes > API_LIMITS.maxBodyBytes)
    return {
      kind: "response",
      response: error(
        "query_too_large",
        "The request body exceeds the configured size limit.",
        413,
      ),
    };
  if (bodyBytes !== 0)
    return {
      kind: "response",
      response: error(
        "invalid_parameter",
        "Public read requests do not accept a request body.",
        400,
      ),
    };

  const ifNoneMatch = request.headers.get("If-None-Match");
  if (!validIfNoneMatch(ifNoneMatch))
    return {
      kind: "response",
      response: error(
        "invalid_parameter",
        "If-None-Match is malformed or exceeds the configured size limit.",
        400,
      ),
    };

  if (url.pathname !== "/v1/metadata")
    return {
      kind: "response",
      response: error(
        "resource_not_found",
        "The requested resource does not exist.",
        404,
      ),
    };

  const publicationHeader = request.headers.get("X-QuantClarity-Publication");
  if (
    publicationHeader !== null &&
    (publicationHeader.length > PUBLICATION_HEADER_MAX_BYTES ||
      UTF8.encode(publicationHeader).byteLength > PUBLICATION_HEADER_MAX_BYTES)
  )
    return {
      kind: "response",
      response: error(
        "invalid_parameter",
        "The publication header is malformed.",
        400,
      ),
    };

  const validation = validateAndNormalizeRequest(
    {
      bodyBytes,
      hasQueryString,
      method: request.method,
      pathname: url.pathname,
      publicationHeader,
      rawQuery,
    },
    API_LIMITS,
  );
  if (!validation.success) {
    const headers: HeadersInit =
      validation.error.status === 405 ? { Allow: "GET, HEAD, OPTIONS" } : {};
    return {
      kind: "response",
      response: error(
        validation.error.code,
        validation.error.message,
        validation.error.status,
        headers,
      ),
    };
  }

  if (validation.request.operation.kind !== "metadata") {
    return {
      kind: "response",
      response: error(
        "resource_not_found",
        "The requested resource does not exist.",
        404,
      ),
    };
  }

  if (validation.request.hasQueryString)
    return {
      kind: "response",
      response: error(
        "invalid_parameter",
        "This route does not accept a query string.",
        400,
      ),
    };

  if (validation.request.method === "OPTIONS") {
    return {
      kind: "response",
      response: new Response(null, {
        status: 204,
        headers: {
          ...SECURITY_HEADERS,
          "Access-Control-Allow-Headers":
            "If-None-Match, X-QuantClarity-Publication",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
          "Access-Control-Max-Age": "600",
          Allow: "GET, HEAD, OPTIONS",
          "Cache-Control": "private, no-store",
        },
      }),
    };
  }

  return {
    ifNoneMatch,
    kind: "metadata",
    request: validation.request,
  };
}

function metadataResponse(
  method: NormalizedRequest["method"],
  ifNoneMatch: string | null,
  publicationId: string,
  representationBytes: Uint8Array,
  etag: string,
): Response {
  const headers = new Headers({
    ...SECURITY_HEADERS,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
    "Cache-Control": "private, no-store",
    ETag: etag,
    "X-QuantClarity-Publication": publicationId,
  });
  if (ifNoneMatchMatches(ifNoneMatch, etag))
    return new Response(null, { status: 304, headers });
  headers.set("Content-Length", String(representationBytes.byteLength));
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(
    method === "HEAD" ? null : new Uint8Array(representationBytes),
    { status: 200, headers },
  );
}

async function transientActorKey(
  sourcePrefix: string,
  secret: unknown,
  bucket: "read" | "rotation",
): Promise<string | null> {
  if (typeof secret !== "string" || secret.length < 32) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`ip-v1:${bucket}:${sourcePrefix}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const send = (response: Response) =>
    request.method === "HEAD" ? new Response(null, response) : response;
  // Select a bounded protocol plan before any effect. The selected response or
  // metadata read is deliberately withheld until abuse controls succeed.
  const plan = protocolResponsePlan(request);
  const sourceAddress = request.headers.get("CF-Connecting-IP");
  const prefixes =
    sourceAddress === null ? null : sourcePrefixes(sourceAddress);
  if (prefixes === null)
    return send(
      error(
        "temporarily_unavailable",
        "The request cannot be safely rate limited.",
        503,
      ),
    );
  let actorKey: string | null;
  try {
    actorKey = await transientActorKey(
      prefixes.primary,
      env.RATE_LIMIT_HMAC_KEY,
      "read",
    );
  } catch {
    actorKey = null;
  }
  if (actorKey === null)
    return send(
      error(
        "temporarily_unavailable",
        "The request cannot be safely rate limited.",
        503,
      ),
    );
  let limit: RateLimitOutcome;
  try {
    limit = await env.READ_LIMITER.limit({ key: actorKey });
  } catch {
    return send(
      error(
        "temporarily_unavailable",
        "The request cannot be safely rate limited.",
        503,
      ),
    );
  }
  if (!limit.success)
    return send(
      json(
        { error: { code: "rate_limited", message: "Rate limit exceeded." } },
        429,
        { "Retry-After": "60" },
      ),
    );
  if (prefixes.rotation !== null) {
    let rotationKey: string | null;
    try {
      rotationKey = await transientActorKey(
        prefixes.rotation,
        env.RATE_LIMIT_HMAC_KEY,
        "rotation",
      );
    } catch {
      rotationKey = null;
    }
    if (rotationKey === null)
      return send(
        error(
          "temporarily_unavailable",
          "The request cannot be safely rate limited.",
          503,
        ),
      );
    let rotationLimit: RateLimitOutcome;
    try {
      rotationLimit = await env.ROTATION_LIMITER.limit({
        key: rotationKey,
      });
    } catch {
      return send(
        error(
          "temporarily_unavailable",
          "The request cannot be safely rate limited.",
          503,
        ),
      );
    }
    if (!rotationLimit.success)
      return send(
        json(
          { error: { code: "rate_limited", message: "Rate limit exceeded." } },
          429,
          { "Retry-After": "60" },
        ),
      );
  }

  if (plan.kind === "response") return send(plan.response);

  const outcome = await readDatasetMetadataFromQueryV1({
    environment: DEPLOYMENT_ENVIRONMENT,
    limits: API_LIMITS,
    nowMs: Date.now(),
    request: plan.request,
    service: env.CATALOG_QUERY,
  });
  if (!outcome.success) {
    if (outcome.code === "publication_expired")
      return send(
        error(
          "publication_expired",
          "The requested publication is no longer available.",
          409,
          {
            "X-QuantClarity-Publication": outcome.currentPublicationId,
          },
        ),
      );
    if (outcome.code === "publication_not_ready")
      return send(
        error(
          "publication_not_ready",
          "No public dataset has been published yet.",
          503,
        ),
      );
    return send(
      error(
        "temporarily_unavailable",
        "The metadata is temporarily unavailable.",
        503,
      ),
    );
  }
  let etag: string;
  try {
    etag = await representationEtag(
      outcome.publicationId,
      "json",
      outcome.representationBytes,
      crypto.subtle,
    );
  } catch {
    return send(
      error(
        "temporarily_unavailable",
        "The metadata is temporarily unavailable.",
        503,
      ),
    );
  }
  return metadataResponse(
    plan.request.method,
    plan.ifNoneMatch,
    outcome.publicationId,
    outcome.representationBytes,
    etag,
  );
}
