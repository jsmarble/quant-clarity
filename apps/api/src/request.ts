import type { ErrorEnvelope } from "@quant-clarity/contracts";
import { sourcePrefixes } from "@quant-clarity/domain/source-address";

type Env = CloudflareEnv & { RATE_LIMIT_HMAC_KEY: string };

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

function error(code: string, message: string, status: number): Response {
  const body: ErrorEnvelope = { error: { code, message } };
  return json(body, status);
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
  const url = new URL(request.url);
  const sourceAddress = request.headers.get("CF-Connecting-IP");
  const prefixes =
    sourceAddress === null ? null : sourcePrefixes(sourceAddress);
  if (prefixes === null)
    return error(
      "temporarily_unavailable",
      "The request cannot be safely rate limited.",
      503,
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
    return error(
      "temporarily_unavailable",
      "The request cannot be safely rate limited.",
      503,
    );
  let limit: RateLimitOutcome;
  try {
    limit = await env.READ_LIMITER.limit({ key: actorKey });
  } catch {
    return error(
      "temporarily_unavailable",
      "The request cannot be safely rate limited.",
      503,
    );
  }
  if (!limit.success)
    return json(
      { error: { code: "rate_limited", message: "Rate limit exceeded." } },
      429,
      { "Retry-After": "60" },
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
      return error(
        "temporarily_unavailable",
        "The request cannot be safely rate limited.",
        503,
      );
    let rotationLimit: RateLimitOutcome;
    try {
      rotationLimit = await env.ROTATION_LIMITER.limit({
        key: rotationKey,
      });
    } catch {
      return error(
        "temporarily_unavailable",
        "The request cannot be safely rate limited.",
        503,
      );
    }
    if (!rotationLimit.success)
      return json(
        { error: { code: "rate_limited", message: "Rate limit exceeded." } },
        429,
        { "Retry-After": "60" },
      );
  }

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...SECURITY_HEADERS,
        "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Max-Age": "600",
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return json(
      {
        error: {
          code: "method_not_allowed",
          message: "Only GET, HEAD, and OPTIONS are supported.",
        },
      },
      405,
      { Allow: "GET, HEAD, OPTIONS" },
    );
  }

  if (url.search !== "")
    return error(
      "invalid_parameter",
      "This route does not accept query parameters.",
      400,
    );

  let response: Response;
  if (url.pathname === "/v1/metadata") {
    response = error(
      "publication_not_ready",
      "No public dataset has been published yet.",
      503,
    );
  } else {
    response = error(
      "resource_not_found",
      "The requested resource does not exist.",
      404,
    );
  }
  return request.method === "HEAD" ? new Response(null, response) : response;
}
