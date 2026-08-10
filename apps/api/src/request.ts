import {
  ifNoneMatchMatches,
  methodologyRegistryEntry,
  representationEtag,
  validIfNoneMatch,
  validateAndNormalizeRequest,
  type ApiLimits,
  type CatalogQueryRpcV6,
  type DeploymentEnvironment,
  type NormalizedRequest,
} from "@quant-clarity/api-core";
import type { ErrorEnvelope } from "@quant-clarity/contracts";

import { readDatasetMetadataFromQueryV1 } from "./dataset-metadata-query.js";
import { readMethodologyDetailFromQueryV1 } from "./methodology-detail-query.js";
import { limitPublicReadRequest } from "./public-read-limiter.js";

type Env = Omit<
  CloudflareEnv,
  | "API_TRANSPORT_POLICY"
  | "DEPLOYMENT_ENV"
  | "PUBLIC_API_ORIGIN"
  | "RATE_LIMIT_HMAC_KEY"
> & {
  API_TRANSPORT_POLICY: unknown;
  DEPLOYMENT_ENV: unknown;
  RATE_LIMIT_HMAC_KEY: unknown;
};

const PUBLICATION_HEADER_MAX_BYTES = 40;
const UTF8 = new TextEncoder();

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

function deploymentEnvironment(value: unknown): DeploymentEnvironment | null {
  return value === "local" ||
    value === "test" ||
    value === "preview" ||
    value === "production"
    ? value
    : null;
}

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
  | Readonly<{
      ifNoneMatch: string | null;
      kind: "methodology_detail";
      request: NormalizedRequest;
    }>
  | Readonly<{
      kind: "methodology_preflight";
      response: Response;
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

function protocolResponsePlan(
  request: Request,
  capturedMethod: string,
): ProtocolPlan {
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
    capturedMethod !== "GET" &&
    capturedMethod !== "HEAD" &&
    capturedMethod !== "OPTIONS"
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

  const methodologyShaped = url.pathname.startsWith("/v1/methodologies/");
  if (url.pathname !== "/v1/metadata" && !methodologyShaped)
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
      method: capturedMethod,
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

  if (
    validation.request.operation.kind !== "metadata" &&
    validation.request.operation.kind !== "methodology_detail"
  ) {
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

  if (
    validation.request.operation.kind === "methodology_detail" &&
    methodologyRegistryEntry(validation.request.operation.version) === null
  )
    return {
      kind: "response",
      response: error(
        "resource_not_found",
        "The requested resource does not exist.",
        404,
      ),
    };

  if (validation.request.method === "OPTIONS") {
    return {
      kind:
        validation.request.operation.kind === "methodology_detail"
          ? "methodology_preflight"
          : "response",
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
    kind: validation.request.operation.kind,
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

function methodologyDetailResponse(
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
    Vary: "X-QuantClarity-Publication",
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

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  let capturedMethod: string | null = null;
  try {
    capturedMethod = request.method;
  } catch {
    // A hostile request shape is converted to a bounded response after limiting.
  }
  const send = (response: Response) =>
    capturedMethod === "HEAD" ? new Response(null, response) : response;
  let environment: DeploymentEnvironment | null = null;
  let transportPolicy: unknown = null;
  try {
    environment = deploymentEnvironment(env.DEPLOYMENT_ENV);
  } catch {
    // Treat an inaccessible runtime binding exactly like an invalid one.
  }
  try {
    transportPolicy = env.API_TRANSPORT_POLICY;
  } catch {
    // Treat an inaccessible runtime binding exactly like an invalid one.
  }
  // Select a bounded protocol plan before any effect. The selected response or
  // metadata read is deliberately withheld until abuse controls succeed.
  let plan: ProtocolPlan;
  try {
    plan =
      capturedMethod === null
        ? {
            kind: "response",
            response: error(
              "invalid_parameter",
              "The request target is malformed.",
              400,
            ),
          }
        : protocolResponsePlan(request, capturedMethod);
  } catch {
    plan = {
      kind: "response",
      response: error(
        "invalid_parameter",
        "The request target is malformed.",
        400,
      ),
    };
  }
  let readLimiter: RateLimit | null = null;
  let rotationLimiter: RateLimit | null = null;
  let rateLimitSecret = "";
  let sourceAddress: string | null = null;
  let queryService: CatalogQueryRpcV6 | Service | null = null;
  let subtle: SubtleCrypto | null = null;
  let nowMs: (() => number) | null = null;
  try {
    readLimiter = env.READ_LIMITER;
  } catch {
    // A missing or inaccessible capability is handled as limiter failure.
  }
  try {
    rotationLimiter = env.ROTATION_LIMITER;
  } catch {
    // A missing or inaccessible capability is handled as limiter failure.
  }
  try {
    const secret = env.RATE_LIMIT_HMAC_KEY;
    if (typeof secret === "string") rateLimitSecret = secret;
  } catch {
    // An inaccessible secret is handled as limiter failure.
  }
  try {
    sourceAddress = request.headers.get("CF-Connecting-IP");
  } catch {
    // An inaccessible source address is handled as limiter failure.
  }
  try {
    queryService = env.CATALOG_QUERY;
  } catch {
    // A missing query capability fails only after applicable limiting.
  }
  try {
    subtle = crypto.subtle;
  } catch {
    // Web Crypto is required for limiter keys and validators.
  }
  try {
    nowMs = Date.now;
  } catch {
    // A missing clock fails only after applicable limiting.
  }
  const limit =
    subtle === null
      ? "unavailable"
      : await limitPublicReadRequest({
          readLimiter,
          rotationLimiter,
          secret: rateLimitSecret,
          sourceAddress,
          subtle,
        });

  if (limit === "unavailable")
    return send(
      error(
        "temporarily_unavailable",
        "The request cannot be safely rate limited.",
        503,
      ),
    );

  if (environment === null)
    return send(
      error(
        "temporarily_unavailable",
        "The service is temporarily unavailable.",
        503,
      ),
    );
  if (limit === "rate_limited")
    return send(
      json(
        { error: { code: "rate_limited", message: "Rate limit exceeded." } },
        429,
        { "Retry-After": "60" },
      ),
    );

  if (
    (plan.kind === "methodology_detail" ||
      plan.kind === "methodology_preflight") &&
    (environment === "preview" || environment === "production")
  )
    return send(
      error(
        "resource_not_found",
        "The requested resource does not exist.",
        404,
      ),
    );
  if (
    (plan.kind === "methodology_detail" ||
      plan.kind === "methodology_preflight") &&
    transportPolicy !== "local_test"
  )
    return send(
      error(
        "temporarily_unavailable",
        "The methodology detail is temporarily unavailable.",
        503,
      ),
    );
  if (plan.kind === "response" || plan.kind === "methodology_preflight")
    return send(plan.response);
  if (queryService === null || nowMs === null || subtle === null)
    return send(
      error(
        "temporarily_unavailable",
        plan.kind === "metadata"
          ? "The metadata is temporarily unavailable."
          : "The methodology detail is temporarily unavailable.",
        503,
      ),
    );

  let requestNowMs: number;
  try {
    requestNowMs = nowMs();
  } catch {
    return send(
      error(
        "temporarily_unavailable",
        plan.kind === "metadata"
          ? "The metadata is temporarily unavailable."
          : "The methodology detail is temporarily unavailable.",
        503,
      ),
    );
  }

  const outcome =
    plan.kind === "metadata"
      ? await readDatasetMetadataFromQueryV1({
          environment,
          limits: API_LIMITS,
          nowMs: requestNowMs,
          request: plan.request,
          service: queryService,
        })
      : await readMethodologyDetailFromQueryV1({
          environment,
          limits: API_LIMITS,
          nowMs: requestNowMs,
          request: plan.request,
          service: queryService,
        });
  if (!outcome.success) {
    if (outcome.code === "methodology_not_found")
      return send(
        error(
          "resource_not_found",
          "The requested methodology does not exist.",
          404,
        ),
      );
    if (outcome.code === "publication_expired")
      return send(
        error(
          "publication_expired",
          "The requested publication is no longer available.",
          409,
          plan.kind === "methodology_detail"
            ? {
                Vary: "X-QuantClarity-Publication",
                "X-QuantClarity-Publication": outcome.currentPublicationId,
              }
            : {
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
        plan.kind === "metadata"
          ? "The metadata is temporarily unavailable."
          : "The methodology detail is temporarily unavailable.",
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
      subtle,
    );
  } catch {
    return send(
      error(
        "temporarily_unavailable",
        plan.kind === "metadata"
          ? "The metadata is temporarily unavailable."
          : "The methodology detail is temporarily unavailable.",
        503,
      ),
    );
  }
  return plan.kind === "metadata"
    ? metadataResponse(
        plan.request.method,
        plan.ifNoneMatch,
        outcome.publicationId,
        outcome.representationBytes,
        etag,
      )
    : methodologyDetailResponse(
        plan.request.method,
        plan.ifNoneMatch,
        outcome.publicationId,
        outcome.representationBytes,
        etag,
      );
}
