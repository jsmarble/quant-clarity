import { sourcePrefixes } from "@quant-clarity/domain/source-address";

export interface FrontendRateLimitEnv {
  DEPLOYMENT_ENV: string;
  RATE_LIMIT_HMAC_KEY?: string;
  READ_LIMITER: RateLimit;
  ROTATION_LIMITER: RateLimit;
}

export type RateLimitDecision = "allowed" | "limited" | "unavailable";

const LOCAL_RATE_LIMIT_HMAC_KEY = "quantclarity-local-only-rate-limit-key-v1";

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

async function permits(
  limiter: RateLimit,
  prefix: string,
  secret: unknown,
  bucket: "read" | "rotation",
): Promise<boolean> {
  const key = await transientActorKey(prefix, secret, bucket);
  if (key === null) return false;
  return (await limiter.limit({ key })).success;
}

export async function rateLimitDecision(
  request: Request,
  env: FrontendRateLimitEnv,
): Promise<RateLimitDecision> {
  const sourceAddress = request.headers.get("CF-Connecting-IP");
  const prefixes =
    sourceAddress === null ? null : sourcePrefixes(sourceAddress);
  if (prefixes === null) return "unavailable";

  const secret =
    env.RATE_LIMIT_HMAC_KEY ??
    (env.DEPLOYMENT_ENV === "local" ? LOCAL_RATE_LIMIT_HMAC_KEY : undefined);
  if (typeof secret !== "string" || secret.length < 32) return "unavailable";

  try {
    if (!(await permits(env.READ_LIMITER, prefixes.primary, secret, "read")))
      return "limited";
    const rotationAllowed =
      prefixes.rotation === null ||
      (await permits(
        env.ROTATION_LIMITER,
        prefixes.rotation,
        secret,
        "rotation",
      ));
    return rotationAllowed ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}
