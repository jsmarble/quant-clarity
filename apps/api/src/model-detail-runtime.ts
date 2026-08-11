import {
  handleAdmittedModelDetailHttp,
  handleModelDetailHttp,
  type ModelDetailHttpCapabilities,
} from "./model-detail-http.js";

type ModelDetailRuntimeBindings = Readonly<{
  API_TRANSPORT_POLICY: unknown;
  CATALOG_QUERY: Service;
  DEPLOYMENT_ENV: unknown;
  PUBLIC_API_ORIGIN: unknown;
  RATE_LIMIT_HMAC_KEY: string;
  READ_LIMITER: RateLimit;
  ROTATION_LIMITER: RateLimit;
}>;

type AdmittedModelDetailRuntimeBindings = Pick<
  ModelDetailRuntimeBindings,
  "API_TRANSPORT_POLICY" | "CATALOG_QUERY" | "DEPLOYMENT_ENV"
> &
  Readonly<{ PUBLIC_API_ORIGIN?: unknown }>;

export type ModelDetailRuntimePrimitives = Readonly<{
  cache: Pick<Cache, "match" | "put">;
  context: Pick<ExecutionContext, "waitUntil">;
  nowMs: () => number;
  subtle: SubtleCrypto;
}>;

const capture = <Value>(read: () => Value): Value | null => {
  try {
    return read();
  } catch {
    return null;
  }
};

/**
 * Snapshots protected bindings and runtime primitives independently. This
 * boundary accepts no Request, so visitor-controlled values cannot select the
 * environment, transport policy, query authority, or manual-cache origin.
 */
export const captureModelDetailRuntimeCapabilities = (
  bindings: ModelDetailRuntimeBindings,
  primitives: ModelDetailRuntimePrimitives,
): ModelDetailHttpCapabilities => {
  const environment = capture(() => bindings.DEPLOYMENT_ENV);
  const protectedCacheOrigin = capture(() => bindings.PUBLIC_API_ORIGIN);
  const transportPolicy = capture(() => bindings.API_TRANSPORT_POLICY);
  return Object.freeze({
    cache: capture(() => primitives.cache),
    context: capture(() => primitives.context),
    environment: environment === "local" ? "local" : null,
    nowMs: capture(() => primitives.nowMs),
    protectedCacheOrigin:
      protectedCacheOrigin === "https://api.example.test"
        ? protectedCacheOrigin
        : null,
    queryService: capture(() => bindings.CATALOG_QUERY),
    rateLimitSecret: capture(() => bindings.RATE_LIMIT_HMAC_KEY),
    readLimiter: capture(() => bindings.READ_LIMITER),
    rotationLimiter: capture(() => bindings.ROTATION_LIMITER),
    subtle: capture(() => primitives.subtle),
    transportPolicy: transportPolicy === "local_test" ? "local_test" : null,
  });
};

/** Captures the signed-route executor without reading public limiter bindings. */
export const captureAdmittedModelDetailRuntimeCapabilities = (
  bindings: AdmittedModelDetailRuntimeBindings,
  primitives: ModelDetailRuntimePrimitives,
): ModelDetailHttpCapabilities => {
  const environment = capture(() => bindings.DEPLOYMENT_ENV);
  const protectedCacheOrigin = capture(() => bindings.PUBLIC_API_ORIGIN);
  const transportPolicy = capture(() => bindings.API_TRANSPORT_POLICY);
  return Object.freeze({
    cache: capture(() => primitives.cache),
    context: capture(() => primitives.context),
    environment: environment === "local" ? "local" : null,
    nowMs: capture(() => primitives.nowMs),
    protectedCacheOrigin:
      protectedCacheOrigin === "https://api.example.test"
        ? protectedCacheOrigin
        : null,
    queryService: capture(() => bindings.CATALOG_QUERY),
    rateLimitSecret: null,
    readLimiter: null,
    rotationLimiter: null,
    subtle: capture(() => primitives.subtle),
    transportPolicy: transportPolicy === "local_test" ? "local_test" : null,
  });
};

/**
 * Closed runtime composition. The live Worker intentionally does not import
 * this function until the remaining route-opening gates are approved.
 */
export const handleModelDetailRuntime = (
  request: Request,
  bindings: ModelDetailRuntimeBindings,
  context: ExecutionContext,
): Promise<Response> =>
  handleModelDetailHttp(
    request,
    captureModelDetailRuntimeCapabilities(bindings, {
      cache: caches.default,
      context,
      nowMs: Date.now,
      subtle: crypto.subtle,
    }),
  );

/**
 * Captures only canonical read/cache capabilities after signed admission. It
 * never reads the public limiter bindings or their secret.
 */
export const handleAdmittedModelDetailRuntime = (
  request: Request,
  bindings: AdmittedModelDetailRuntimeBindings,
  context: ExecutionContext,
): Promise<Response> =>
  handleAdmittedModelDetailHttp(
    request,
    captureAdmittedModelDetailRuntimeCapabilities(bindings, {
      cache: caches.default,
      context,
      nowMs: Date.now,
      subtle: crypto.subtle,
    }),
  );
