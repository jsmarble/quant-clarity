import { MODEL_DETAIL_PUBLIC_MAX_BYTES } from "@quant-clarity/api-core";

import type { ModelDetailResponsePlan } from "./model-detail-response-plan.js";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MODEL_LOCATION = new RegExp(`^/v1/models/mdl_${UUID_V4}$`, "u");
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const STRONG_ETAG = /^"[0-9a-f]{64}"$/u;
const UTF8 = new TextEncoder();

const ERROR_BYTES = {
  404: UTF8.encode(
    JSON.stringify({
      error: {
        code: "resource_not_found",
        message: "The requested resource does not exist.",
      },
    }),
  ),
  409: UTF8.encode(
    JSON.stringify({
      error: {
        code: "publication_expired",
        message: "The requested publication is no longer available.",
      },
    }),
  ),
  503: [
    UTF8.encode(
      JSON.stringify({
        error: {
          code: "publication_not_ready",
          message: "No public dataset has been published yet.",
        },
      }),
    ),
    UTF8.encode(
      JSON.stringify({
        error: {
          code: "temporarily_unavailable",
          message: "The Model detail is temporarily unavailable.",
        },
      }),
    ),
  ],
} as const;

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

const COMMON_HEADERS = {
  ...SECURITY_HEADERS,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
} as const;

const HEADER_NAMES = new Set([
  ...Object.keys(COMMON_HEADERS),
  "Cache-Control",
  "Content-Length",
  "Content-Type",
  "ETag",
  "Location",
  "Vary",
  "X-QuantClarity-Publication",
]);

export type ApiTransportPolicy =
  "local_test" | "preview_https" | "production_https_custom_hostname";

const hsts = (policy: unknown): string | null | undefined => {
  if (policy === "local_test") return null;
  if (policy === "preview_https") return "max-age=300";
  if (policy === "production_https_custom_hostname")
    return "max-age=31536000; includeSubDomains";
  return undefined;
};

const withTransportPolicy = (
  input: Readonly<Record<string, string>>,
  policy: ApiTransportPolicy,
): Headers => {
  const headers = new Headers(input);
  const strictTransportSecurity = hsts(policy);
  if (strictTransportSecurity !== null && strictTransportSecurity !== undefined)
    headers.set("Strict-Transport-Security", strictTransportSecurity);
  return headers;
};

const genericFailure = (method: "GET" | "HEAD", policy: unknown): Response => {
  const bodyBytes = UTF8.encode(
    JSON.stringify({
      error: {
        code: "temporarily_unavailable",
        message: "The Model detail is temporarily unavailable.",
      },
    }),
  );
  const headers: Record<string, string> = {
    ...COMMON_HEADERS,
    "Cache-Control": "private, no-store",
    "Content-Length": String(bodyBytes.byteLength),
    "Content-Type": "application/json; charset=utf-8",
  };
  const transport = hsts(policy);
  if (transport !== null && transport !== undefined)
    headers["Strict-Transport-Security"] = transport;
  return new Response(method === "HEAD" ? null : bodyBytes, {
    headers,
    status: 503,
  });
};

const dataProperty = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    "value" in descriptor &&
    descriptor.enumerable === true
    ? descriptor.value
    : undefined;
};

const safeMethod = (value: unknown): "GET" | "HEAD" => {
  try {
    return dataProperty(value, "method") === "HEAD" ? "HEAD" : "GET";
  } catch {
    return "GET";
  }
};

const snapshotHeaders = (
  value: unknown,
): Readonly<Record<string, string>> | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length > HEADER_NAMES.size ||
      keys.some((key) => typeof key !== "string" || !HEADER_NAMES.has(key))
    )
      return null;
    const output: Record<string, string> = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        typeof descriptor.value !== "string" ||
        descriptor.value.length > 512
      )
        return null;
      output[key] = descriptor.value;
    }
    for (const [key, expected] of Object.entries(COMMON_HEADERS))
      if (output[key] !== expected) return null;
    return Object.freeze(output);
  } catch {
    return null;
  }
};

type Snapshot = Readonly<{
  bodyBytes: Uint8Array | null;
  headers: Readonly<Record<string, string>>;
  method: "GET" | "HEAD";
  status: ModelDetailResponsePlan["status"];
}>;

const snapshotPlan = (value: unknown): Snapshot | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    const expected = ["bodyBytes", "headers", "method", "status"];
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== "string" || !expected.includes(key))
    )
      return null;
    const body = dataProperty(value, "bodyBytes");
    const headers = snapshotHeaders(dataProperty(value, "headers"));
    const method = dataProperty(value, "method");
    const status = dataProperty(value, "status");
    if (
      (body !== null &&
        (!(body instanceof Uint8Array) ||
          Object.getPrototypeOf(body) !== Uint8Array.prototype ||
          body.byteLength > MODEL_DETAIL_PUBLIC_MAX_BYTES)) ||
      headers === null ||
      (method !== "GET" && method !== "HEAD") ||
      (status !== 200 &&
        status !== 304 &&
        status !== 308 &&
        status !== 404 &&
        status !== 409 &&
        status !== 503)
    )
      return null;
    return {
      bodyBytes: body === null ? null : new Uint8Array(body),
      headers,
      method,
      status,
    };
  } catch {
    return null;
  }
};

const hasOnly = (
  headers: Readonly<Record<string, string>>,
  optional: readonly string[],
): boolean => {
  const expected = new Set([...Object.keys(COMMON_HEADERS), ...optional]);
  return (
    Object.keys(headers).every((key) => expected.has(key)) &&
    expected.size === Object.keys(headers).length
  );
};

const hasPublication = (headers: Readonly<Record<string, string>>): boolean =>
  typeof headers["X-QuantClarity-Publication"] === "string" &&
  PUBLICATION_ID.test(headers["X-QuantClarity-Publication"]) &&
  headers.Vary === "X-QuantClarity-Publication";

const hasJsonRepresentation = (snapshot: Snapshot): boolean => {
  const declared = snapshot.headers["Content-Length"];
  if (
    !/^(?:0|[1-9][0-9]*)$/u.test(declared ?? "") ||
    Number(declared) > MODEL_DETAIL_PUBLIC_MAX_BYTES ||
    snapshot.headers["Content-Type"] !== "application/json; charset=utf-8"
  )
    return false;
  return snapshot.bodyBytes === null
    ? snapshot.method === "HEAD"
    : snapshot.method === "GET" &&
        snapshot.bodyBytes.byteLength === Number(declared);
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((byte, index) => byte === right[index]);

const hasStaticErrorRepresentation = (
  snapshot: Snapshot,
  candidates: readonly Uint8Array[],
): boolean =>
  hasJsonRepresentation(snapshot) &&
  candidates.some(
    (candidate) =>
      snapshot.headers["Content-Length"] === String(candidate.byteLength) &&
      (snapshot.bodyBytes === null || sameBytes(snapshot.bodyBytes, candidate)),
  );

const validPlan = (snapshot: Snapshot): boolean => {
  const { bodyBytes, headers, status } = snapshot;
  if (status === 200)
    return (
      hasOnly(headers, [
        "Cache-Control",
        "Content-Length",
        "Content-Type",
        "ETag",
        "Vary",
        "X-QuantClarity-Publication",
      ]) &&
      (headers["Cache-Control"] === "private, max-age=0, must-revalidate" ||
        headers["Cache-Control"] === "private, no-store") &&
      STRONG_ETAG.test(headers.ETag ?? "") &&
      hasPublication(headers) &&
      hasJsonRepresentation(snapshot)
    );
  if (status === 304)
    return (
      bodyBytes === null &&
      hasOnly(headers, [
        "Cache-Control",
        "ETag",
        "Vary",
        "X-QuantClarity-Publication",
      ]) &&
      (headers["Cache-Control"] === "private, max-age=0, must-revalidate" ||
        headers["Cache-Control"] === "private, no-store") &&
      STRONG_ETAG.test(headers.ETag ?? "") &&
      hasPublication(headers)
    );
  if (status === 308)
    return (
      bodyBytes === null &&
      hasOnly(headers, [
        "Cache-Control",
        "Content-Length",
        "Location",
        "Vary",
        "X-QuantClarity-Publication",
      ]) &&
      headers["Cache-Control"] === "private, no-store" &&
      headers["Content-Length"] === "0" &&
      MODEL_LOCATION.test(headers.Location ?? "") &&
      hasPublication(headers)
    );
  if (status === 404 || status === 409)
    return (
      hasOnly(headers, [
        "Cache-Control",
        "Content-Length",
        "Content-Type",
        "Vary",
        "X-QuantClarity-Publication",
      ]) &&
      headers["Cache-Control"] === "private, no-store" &&
      hasPublication(headers) &&
      hasStaticErrorRepresentation(snapshot, [ERROR_BYTES[status]])
    );
  return (
    hasOnly(headers, ["Cache-Control", "Content-Length", "Content-Type"]) &&
    headers["Cache-Control"] === "private, no-store" &&
    hasStaticErrorRepresentation(snapshot, ERROR_BYTES[503])
  );
};

/**
 * Converts one closed Model-detail response plan to a Worker-native Response.
 * It accepts no Request, URL, host, environment object, or arbitrary headers.
 */
export const renderModelDetailResponse = (
  plan: ModelDetailResponsePlan,
  policy: ApiTransportPolicy,
): Response => {
  const method = safeMethod(plan);
  try {
    const snapshot = snapshotPlan(plan);
    if (snapshot === null || hsts(policy) === undefined || !validPlan(snapshot))
      return genericFailure(method, policy);
    return new Response(
      snapshot.bodyBytes === null ? null : new Uint8Array(snapshot.bodyBytes),
      {
        headers: withTransportPolicy(snapshot.headers, policy),
        status: snapshot.status,
      },
    );
  } catch {
    return genericFailure(method, policy);
  }
};

/** Builds the fixed preflight response after the caller has completed limiting. */
export const renderApiPreflight = (policy: ApiTransportPolicy): Response => {
  if (hsts(policy) === undefined) return genericFailure("GET", policy);
  return new Response(null, {
    status: 204,
    headers: withTransportPolicy(
      {
        ...COMMON_HEADERS,
        "Access-Control-Allow-Headers":
          "If-None-Match, X-QuantClarity-Publication",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Max-Age": "600",
        Allow: "GET, HEAD, OPTIONS",
        "Cache-Control": "private, no-store",
      },
      policy,
    ),
  });
};
