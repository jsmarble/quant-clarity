import { sourcePrefixes } from "@quant-clarity/domain/source-address";

const UTF8 = new TextEncoder();
const MAX_SOURCE_ADDRESS_CHARACTERS = 64;
const MAX_SECRET_CHARACTERS = 4096;

export type PublicReadLimitOutcome = "allowed" | "rate_limited" | "unavailable";

export type PublicReadLimitInput = Readonly<{
  readLimiter: RateLimit | null;
  rotationLimiter: RateLimit | null;
  secret: string;
  sourceAddress: string | null;
  subtle: SubtleCrypto;
}>;

type Limit = (options: RateLimitOptions) => Promise<RateLimitOutcome>;

const exactLimitOutcome = (value: unknown): boolean | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== "success") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "success");
    return descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "boolean"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
};

const actorKey = async (
  prefix: string,
  secret: string,
  bucket: "read" | "rotation",
  importKey: SubtleCrypto["importKey"],
  sign: SubtleCrypto["sign"],
): Promise<string> => {
  const key = await importKey(
    "raw",
    UTF8.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const digest = await sign(
    "HMAC",
    key,
    UTF8.encode(`ip-v1:${bucket}:${prefix}`),
  );
  if (
    !(digest instanceof ArrayBuffer) ||
    Object.getPrototypeOf(digest) !== ArrayBuffer.prototype ||
    digest.byteLength !== 32
  )
    throw new Error("Invalid HMAC result");
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

/**
 * Request-lifetime public-read abuse boundary. Address, prefixes, HMAC key
 * material, and derived actor keys never leave this function.
 */
export const limitPublicReadRequest = async (
  input: PublicReadLimitInput,
): Promise<PublicReadLimitOutcome> => {
  let readLimit: Limit | null = null;
  let rotationLimit: Limit | null = null;
  let importKey: SubtleCrypto["importKey"];
  let sign: SubtleCrypto["sign"];
  let sourceAddress: string | null;
  let secret: string;
  try {
    sourceAddress = input.sourceAddress;
    secret = input.secret;
    if (
      sourceAddress === null ||
      typeof sourceAddress !== "string" ||
      sourceAddress.length > MAX_SOURCE_ADDRESS_CHARACTERS ||
      typeof secret !== "string" ||
      secret.length < 32 ||
      secret.length > MAX_SECRET_CHARACTERS
    )
      return "unavailable";
    importKey = input.subtle.importKey.bind(input.subtle);
    sign = input.subtle.sign.bind(input.subtle);
  } catch {
    return "unavailable";
  }

  const prefixes = sourcePrefixes(sourceAddress);
  if (prefixes === null) return "unavailable";

  let failed = false;
  try {
    if (input.readLimiter === null) failed = true;
    else readLimit = input.readLimiter.limit.bind(input.readLimiter);
  } catch {
    failed = true;
  }
  if (prefixes.rotation !== null) {
    try {
      if (input.rotationLimiter === null) failed = true;
      else
        rotationLimit = input.rotationLimiter.limit.bind(input.rotationLimiter);
    } catch {
      failed = true;
    }
  }

  let readKey: string;
  let rotationKey: string | null = null;
  try {
    readKey = await actorKey(prefixes.primary, secret, "read", importKey, sign);
    if (prefixes.rotation !== null)
      rotationKey = await actorKey(
        prefixes.rotation,
        secret,
        "rotation",
        importKey,
        sign,
      );
  } catch {
    return "unavailable";
  }

  let denied = false;
  if (readLimit !== null) {
    try {
      const outcome = exactLimitOutcome(await readLimit({ key: readKey }));
      if (outcome === null) failed = true;
      else if (!outcome) denied = true;
    } catch {
      failed = true;
    }
  }

  if (rotationKey !== null && rotationLimit !== null) {
    try {
      const outcome = exactLimitOutcome(
        await rotationLimit({ key: rotationKey }),
      );
      if (outcome === null) failed = true;
      else if (!outcome) denied = true;
    } catch {
      failed = true;
    }
  }

  if (failed) return "unavailable";
  return denied ? "rate_limited" : "allowed";
};
