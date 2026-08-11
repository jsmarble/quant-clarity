import {
  encodeExactModelCardCollectionRepresentation,
  reconcileRequestCursor,
  verifyCursor,
  type ApiLimits,
  type DeploymentEnvironment,
  type NormalizedRequest,
} from "@quant-clarity/api-core";
import type { ErrorEnvelope } from "@quant-clarity/contracts";

import { readExactModelCardSearchFromQueryV1 } from "./merged-exact-search-query.js";
import type { ExactModelCardSearchCatalogQueryRpcV1 } from "./merged-exact-search-query.js";

const LOCAL_CURSOR_KEY = new TextEncoder().encode(
  "quantclarity-local-only-exact-model-search-cursor-key-v1",
);
const MAXIMUM_CURSOR_CLOCK_SKEW_SECONDS = 30;
const SEARCH_API_LIMITS: ApiLimits = {
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

const cursorKeyring = () => ({
  current: {
    id: "local-search-v1",
    secret: new Uint8Array(LOCAL_CURSOR_KEY),
  },
  next: null,
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

const error = (
  code: string,
  message: string,
  status: number,
  extraHeaders: HeadersInit = {},
): Response => {
  const body: ErrorEnvelope = { error: { code, message } };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const headers = new Headers({
    ...SECURITY_HEADERS,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "X-QuantClarity-Publication",
    "Cache-Control": "private, no-store",
    "Content-Length": String(bytes.byteLength),
    "Content-Type": "application/json; charset=utf-8",
  });
  new Headers(extraHeaders).forEach((value, name) => {
    headers.set(name, value);
  });
  return new Response(bytes, {
    status,
    headers,
  });
};

export type AdmittedExactModelSearchCapabilities = Readonly<{
  environment: DeploymentEnvironment;
  nowMs: () => number;
  queryService: ExactModelCardSearchCatalogQueryRpcV1;
  subtle: SubtleCrypto;
  transportPolicy: unknown;
}>;

/** Executes only a request that has already crossed signed API admission. */
export const handleAdmittedExactModelSearch = async (
  request: NormalizedRequest,
  capabilities: AdmittedExactModelSearchCapabilities,
): Promise<Response> => {
  try {
    if (
      capabilities.environment !== "local" ||
      capabilities.transportPolicy !== "local_test"
    )
      return error(
        "temporarily_unavailable",
        "Exact Model search is temporarily unavailable.",
        503,
      );
    const nowMs = capabilities.nowMs();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0)
      return error(
        "temporarily_unavailable",
        "Exact Model search is temporarily unavailable.",
        503,
      );
    const outcome = await readExactModelCardSearchFromQueryV1({
      cursorKeyring: cursorKeyring(),
      environment: capabilities.environment,
      limits: SEARCH_API_LIMITS,
      maximumClockSkewSeconds: MAXIMUM_CURSOR_CLOCK_SKEW_SECONDS,
      nowSeconds: Math.floor(nowMs / 1000),
      request,
      service: capabilities.queryService,
      subtle: capabilities.subtle,
    });
    if (!outcome.success) {
      if (outcome.code === "invalid_cursor")
        return error("invalid_cursor", "The cursor is invalid.", 400);
      if (outcome.code === "publication_expired")
        return error(
          "publication_expired",
          "The requested publication is no longer available.",
          409,
          {
            Vary: "X-QuantClarity-Publication",
            "X-QuantClarity-Publication": outcome.currentPublicationId,
          },
        );
      if (outcome.code === "publication_not_ready")
        return error(
          "publication_not_ready",
          "No public dataset has been published yet.",
          503,
        );
      return error(
        "temporarily_unavailable",
        "Exact Model search is temporarily unavailable.",
        503,
      );
    }
    const encoded = encodeExactModelCardCollectionRepresentation(
      outcome.collection,
    );
    if (encoded === null)
      return error(
        "temporarily_unavailable",
        "Exact Model search is temporarily unavailable.",
        503,
      );
    const publicationId = encoded.collection.meta.publication_id;
    return new Response(new Uint8Array(encoded.representationBytes), {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "X-QuantClarity-Publication",
        "Cache-Control": "private, no-store",
        "Content-Length": String(encoded.representationBytes.byteLength),
        "Content-Type": "application/json; charset=utf-8",
        Vary: "X-QuantClarity-Publication",
        "X-QuantClarity-Publication": publicationId,
      },
    });
  } catch {
    return error(
      "temporarily_unavailable",
      "Exact Model search is temporarily unavailable.",
      503,
    );
  }
};

type RuntimeBindings = Readonly<{
  CATALOG_QUERY: Service;
}>;

/** Captures the query capability only after signed ingress admission. */
export const handleAdmittedExactModelSearchRuntime = (
  request: NormalizedRequest,
  bindings: RuntimeBindings,
  environment: "local",
  nowMs: number,
): Promise<Response> => {
  const authenticateCursor = async (): Promise<boolean> => {
    if (request.cursor === null) return true;
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return false;
    try {
      const verified = await verifyCursor(
        request.cursor,
        cursorKeyring(),
        Math.floor(nowMs / 1000),
        MAXIMUM_CURSOR_CLOCK_SKEW_SECONDS,
        crypto.subtle,
      );
      if (!verified.success) return false;
      await reconcileRequestCursor(
        request,
        verified,
        SEARCH_API_LIMITS,
        crypto.subtle,
      );
      return true;
    } catch {
      return false;
    }
  };
  return authenticateCursor().then((authenticated) => {
    if (!authenticated)
      return error("invalid_cursor", "The cursor is invalid.", 400);
    let queryService: Service | null = null;
    try {
      queryService = bindings.CATALOG_QUERY;
    } catch {
      // A missing query capability fails as a static dependency error below.
    }
    if (queryService === null)
      return error(
        "temporarily_unavailable",
        "Exact Model search is temporarily unavailable.",
        503,
      );
    const invoke = async (name: string, input: unknown): Promise<unknown> => {
      const method: unknown = Reflect.get(queryService, name);
      if (typeof method !== "function")
        throw new TypeError("missing RPC method");
      return await Reflect.apply(method, queryService, [input]);
    };
    const queryRpc: ExactModelCardSearchCatalogQueryRpcV1 = {
      resolvePublicationV2: (input) => invoke("resolvePublicationV2", input),
      readExactModelCardSearchV1: (input) =>
        invoke("readExactModelCardSearchV1", input),
    };
    return handleAdmittedExactModelSearch(request, {
      environment,
      nowMs: () => nowMs,
      queryService: queryRpc,
      subtle: crypto.subtle,
      transportPolicy: "local_test",
    });
  });
};
