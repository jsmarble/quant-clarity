import type {
  ApiError,
  ApiLimits,
  DeploymentEnvironment,
  ModelDetailQueryRpcV2,
} from "@quant-clarity/api-core";

import {
  renderApiPreflight,
  renderModelDetailGateResponse,
  renderModelDetailResponse,
  type ApiTransportPolicy,
} from "./api-response-renderer.js";
import { readModelDetailFromQueryWithCacheV2 } from "./model-detail-cache.js";
import {
  planModelDetailRequest,
  type ModelDetailRequestPlan,
  type ModelDetailRequestPlanInput,
} from "./model-detail-request-plan.js";
import { planModelDetailResponse } from "./model-detail-response-plan.js";
import { limitPublicReadRequest } from "./public-read-limiter.js";

const UTF8 = new TextEncoder();
const PUBLICATION_HEADER_MAX_CHARACTERS = 40;
const CONDITIONAL_HEADER_MAX_CHARACTERS = 256;
const TRANSPORT_POLICIES: ReadonlySet<unknown> = new Set([
  "local_test",
  "preview_https",
  "production_https_custom_hostname",
]);

export const MODEL_DETAIL_API_LIMITS: ApiLimits = Object.freeze({
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
});

export type ModelDetailHttpCapabilities = Readonly<{
  cache: Pick<Cache, "match" | "put">;
  context: Pick<ExecutionContext, "waitUntil">;
  environment: DeploymentEnvironment;
  nowMs: number;
  protectedCacheOrigin: string;
  queryService: ModelDetailQueryRpcV2 | Service;
  rateLimitSecret: string;
  readLimiter: RateLimit;
  rotationLimiter: RateLimit;
  subtle: SubtleCrypto;
  transportPolicy: ApiTransportPolicy;
}>;

type CapturedRequest = Readonly<{
  method: "GET" | "HEAD";
  plan: ModelDetailRequestPlan;
  sourceAddress: string | null;
}>;

type CapturedRateCapabilities = Readonly<{
  rateLimitSecret: string;
  readLimiter: RateLimit | null;
  rotationLimiter: RateLimit | null;
  subtle: SubtleCrypto;
}>;

type CapturedDownstreamCapabilities = Readonly<{
  cache: Pick<Cache, "match" | "put">;
  environment: DeploymentEnvironment;
  nowMs: number;
  protectedCacheOrigin: string;
  queryService: ModelDetailQueryRpcV2 | Service;
  schedule: (promise: Promise<void>) => void;
  subtle: SubtleCrypto;
}>;

type CapturedCapabilities = Readonly<{
  downstream: CapturedDownstreamCapabilities | null;
  policyReady: boolean;
  rate: CapturedRateCapabilities | null;
  transportPolicy: ApiTransportPolicy;
}>;

type PreparedRequest = Readonly<{
  downstream: CapturedDownstreamCapabilities | null;
  limit: "allowed" | "rate_limited" | "unavailable";
  method: "GET" | "HEAD";
  plan: ModelDetailRequestPlan;
  policyReady: boolean;
  transportPolicy: ApiTransportPolicy;
}>;

const failure = (
  code: ApiError["code"],
  status: ApiError["status"],
): ModelDetailRequestPlan => ({
  error: { code, message: "closed", status },
  kind: "error",
});

const bodyBytesWithoutReading = (
  declared: string | null,
  bodyPresent: boolean,
): number => {
  if (declared === null) return bodyPresent ? 1 : 0;
  if (declared.length > 16) return MODEL_DETAIL_API_LIMITS.maxBodyBytes + 1;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(declared)) return Number.NaN;
  const parsed = Number(declared);
  if (!Number.isSafeInteger(parsed))
    return MODEL_DETAIL_API_LIMITS.maxBodyBytes + 1;
  return bodyPresent ? Math.max(1, parsed) : parsed;
};

const boundedHeader = (
  value: string | null,
  maximumCharacters: number,
): string | null =>
  value !== null && value.length > maximumCharacters ? "invalid" : value;

const captureRequest = (request: Request): CapturedRequest => {
  let rawUrl: string;
  let rawMethod: string;
  let bodyPresent: boolean;
  let declaredLength: string | null;
  let ifNoneMatch: string | null;
  let publicationHeader: string | null;
  let sourceAddress: string | null;
  try {
    rawUrl = request.url;
    rawMethod = request.method;
    bodyPresent = request.body !== null;
    const get = request.headers.get.bind(request.headers);
    declaredLength = get("Content-Length");
    ifNoneMatch = get("If-None-Match");
    publicationHeader = get("X-QuantClarity-Publication");
    sourceAddress = get("CF-Connecting-IP");
  } catch {
    return {
      method: "GET",
      plan: failure("invalid_parameter", 400),
      sourceAddress: null,
    };
  }
  const method = rawMethod === "HEAD" ? "HEAD" : "GET";
  if (
    rawUrl.length > MODEL_DETAIL_API_LIMITS.maxUrlBytes ||
    UTF8.encode(rawUrl).byteLength > MODEL_DETAIL_API_LIMITS.maxUrlBytes
  )
    return {
      method,
      plan: failure("query_too_large", 413),
      sourceAddress,
    };

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      method,
      plan: failure("invalid_parameter", 400),
      sourceAddress,
    };
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "")
    return {
      method,
      plan: failure("invalid_parameter", 400),
      sourceAddress,
    };
  const queryMarker = rawUrl.indexOf("?", rawUrl.indexOf("://") + 3);
  const hasQueryString = queryMarker >= 0;
  const planInput: ModelDetailRequestPlanInput = {
    bodyBytes: bodyBytesWithoutReading(declaredLength, bodyPresent),
    hasQueryString,
    ifNoneMatch: boundedHeader(ifNoneMatch, CONDITIONAL_HEADER_MAX_CHARACTERS),
    method: rawMethod,
    pathname: url.pathname,
    publicationHeader: boundedHeader(
      publicationHeader,
      PUBLICATION_HEADER_MAX_CHARACTERS,
    ),
    rawQuery: hasQueryString ? url.search.slice(1) : "",
  };
  return {
    method,
    plan: planModelDetailRequest(planInput, MODEL_DETAIL_API_LIMITS),
    sourceAddress,
  };
};

const exactProtectedOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
};

const captureCapabilities = (
  value: ModelDetailHttpCapabilities,
): CapturedCapabilities => {
  let environment: DeploymentEnvironment | null = null;
  let suppliedPolicy: unknown = null;
  let subtle: SubtleCrypto | null = null;
  try {
    environment = value.environment;
  } catch {
    // Invalid protected environment is handled after the limiter boundary.
  }
  try {
    suppliedPolicy = value.transportPolicy;
  } catch {
    // Invalid protected policy is handled after the limiter boundary.
  }
  try {
    subtle = value.subtle;
  } catch {
    // Web Crypto is required by both limiter and downstream authority.
  }

  const environmentPolicy: ApiTransportPolicy | null =
    environment === "production"
      ? "production_https_custom_hostname"
      : environment === "preview"
        ? "preview_https"
        : environment === "local" || environment === "test"
          ? "local_test"
          : null;
  const transportPolicy =
    environmentPolicy ??
    (TRANSPORT_POLICIES.has(suppliedPolicy)
      ? (suppliedPolicy as ApiTransportPolicy)
      : "local_test");
  const policyReady = suppliedPolicy === environmentPolicy;

  let rate: CapturedRateCapabilities | null = null;
  if (subtle !== null) {
    let rateLimitSecret: string | null = null;
    let readLimiter: RateLimit | null = null;
    let rotationLimiter: RateLimit | null = null;
    try {
      rateLimitSecret = value.rateLimitSecret;
    } catch {
      // Missing key material prevents safe limiter admission.
    }
    try {
      readLimiter = value.readLimiter;
    } catch {
      // The limiter helper still consumes every other applicable capability.
    }
    try {
      rotationLimiter = value.rotationLimiter;
    } catch {
      // The limiter helper still consumes every other applicable capability.
    }
    if (rateLimitSecret !== null)
      rate = {
        rateLimitSecret,
        readLimiter,
        rotationLimiter,
        subtle,
      };
  }

  let downstream: CapturedDownstreamCapabilities | null = null;
  if (subtle !== null && environment !== null) {
    try {
      const cache = value.cache;
      const context = value.context;
      const nowMs = value.nowMs;
      const protectedCacheOrigin = value.protectedCacheOrigin;
      const queryService = value.queryService;
      const waitUntil = context.waitUntil.bind(context);
      if (
        !Number.isSafeInteger(nowMs) ||
        nowMs < 0 ||
        typeof protectedCacheOrigin !== "string" ||
        !exactProtectedOrigin(protectedCacheOrigin)
      )
        downstream = null;
      else
        downstream = {
          cache,
          environment,
          nowMs,
          protectedCacheOrigin,
          queryService,
          schedule: (promise) => {
            waitUntil(promise);
          },
          subtle,
        };
    } catch {
      downstream = null;
    }
  }
  return { downstream, policyReady, rate, transportPolicy };
};

const prepareRequest = async (
  request: Request,
  capabilities: ModelDetailHttpCapabilities,
): Promise<PreparedRequest> => {
  const capturedRequest = captureRequest(request);
  const captured = captureCapabilities(capabilities);
  if (captured.rate === null)
    return {
      downstream: captured.downstream,
      limit: "unavailable",
      method: capturedRequest.method,
      plan: capturedRequest.plan,
      policyReady: captured.policyReady,
      transportPolicy: captured.transportPolicy,
    };

  const limit = await limitPublicReadRequest({
    readLimiter: captured.rate.readLimiter,
    rotationLimiter: captured.rate.rotationLimiter,
    secret: captured.rate.rateLimitSecret,
    sourceAddress: capturedRequest.sourceAddress,
    subtle: captured.rate.subtle,
  });
  return {
    downstream: captured.downstream,
    limit,
    method: capturedRequest.method,
    plan: capturedRequest.plan,
    policyReady: captured.policyReady,
    transportPolicy: captured.transportPolicy,
  };
};

const executePreparedRequest = async (
  prepared: PreparedRequest,
): Promise<Response> => {
  if (prepared.limit === "unavailable")
    return renderModelDetailGateResponse(
      { kind: "unavailable" },
      prepared.method,
      prepared.transportPolicy,
    );
  if (!prepared.policyReady)
    return renderModelDetailGateResponse(
      { kind: "unavailable" },
      prepared.method,
      prepared.transportPolicy,
    );
  if (prepared.limit === "rate_limited")
    return renderModelDetailGateResponse(
      { kind: "rate_limited" },
      prepared.method,
      prepared.transportPolicy,
    );

  if (prepared.plan.kind === "error")
    return renderModelDetailGateResponse(
      { error: prepared.plan.error, kind: "request_error" },
      prepared.method,
      prepared.transportPolicy,
    );
  if (prepared.plan.kind === "preflight")
    return renderApiPreflight(prepared.transportPolicy);

  if (prepared.downstream === null)
    return renderModelDetailGateResponse(
      { kind: "unavailable" },
      prepared.method,
      prepared.transportPolicy,
    );

  const outcome = await readModelDetailFromQueryWithCacheV2({
    cache: prepared.downstream.cache,
    protectedOrigin: prepared.downstream.protectedCacheOrigin,
    query: {
      environment: prepared.downstream.environment,
      limits: MODEL_DETAIL_API_LIMITS,
      nowMs: prepared.downstream.nowMs,
      request: prepared.plan.request,
      service: prepared.downstream.queryService,
    },
    schedule: prepared.downstream.schedule,
    subtle: prepared.downstream.subtle,
  });
  const responsePlan = await planModelDetailResponse(
    { outcome, requestPlan: prepared.plan },
    prepared.downstream.subtle,
  );
  return renderModelDetailResponse(responsePlan, prepared.transportPolicy);
};

/**
 * Closed B3 HTTP composition. It is intentionally absent from the live Worker
 * export until protected environment and release gates authorize routing.
 */
export const handleModelDetailHttp = (
  request: Request,
  capabilities: ModelDetailHttpCapabilities,
): Promise<Response> =>
  prepareRequest(request, capabilities).then(executePreparedRequest);
