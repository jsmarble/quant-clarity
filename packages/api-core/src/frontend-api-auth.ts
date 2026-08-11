export const FRONTEND_API_AUDIENCE = "quantclarity-api";
export const FRONTEND_API_INTERNAL_ORIGIN = "https://frontend-api.internal";
export const FRONTEND_API_ENVELOPE_HEADER = "X-QuantClarity-Internal-Envelope";
export const FRONTEND_API_KEY_SLOT_HEADER = "X-QuantClarity-Internal-Key-Slot";
export const FRONTEND_API_SIGNATURE_HEADER =
  "X-QuantClarity-Internal-Signature";

export const FRONTEND_API_RESERVED_HEADERS = Object.freeze([
  FRONTEND_API_ENVELOPE_HEADER,
  FRONTEND_API_KEY_SLOT_HEADER,
  FRONTEND_API_SIGNATURE_HEADER,
]);

const VERSION = 1;
const TTL_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 5_000;
const MAX_ENVELOPE_BYTES = 768;
const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const PUBLICATION_ID =
  /^pub_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type FrontendApiEnvironment =
  "local" | "test" | "preview" | "production";
export type FrontendApiKeySlot = "current" | "next";

type Envelope = Readonly<{
  version: 1;
  audience: typeof FRONTEND_API_AUDIENCE;
  environment: FrontendApiEnvironment;
  method: "GET" | "HEAD";
  path: string;
  query_sha256: string;
  publication_id: string | null;
  issued_at_ms: number;
  expires_at_ms: number;
}>;

export type FrontendApiSecrets = Readonly<{
  current: unknown;
  next?: unknown;
}>;

export type VerifiedFrontendApiRequest = Readonly<{
  envelope: Envelope;
  keySlot: FrontendApiKeySlot;
}>;

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const base64UrlDecode = (
  value: string,
  maxBytes: number,
): Uint8Array<ArrayBuffer> | null => {
  if (!BASE64URL.test(value) || value.length > Math.ceil((maxBytes * 4) / 3))
    return null;
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    if (binary.length > maxBytes) return null;
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    return base64UrlEncode(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
};

const validEnvironment = (value: unknown): value is FrontendApiEnvironment =>
  value === "local" ||
  value === "test" ||
  value === "preview" ||
  value === "production";

const canonicalEnvelope = (envelope: Envelope): string =>
  JSON.stringify({
    version: envelope.version,
    audience: envelope.audience,
    environment: envelope.environment,
    method: envelope.method,
    path: envelope.path,
    query_sha256: envelope.query_sha256,
    publication_id: envelope.publication_id,
    issued_at_ms: envelope.issued_at_ms,
    expires_at_ms: envelope.expires_at_ms,
  });

const parseEnvelope = (bytes: Uint8Array): Envelope | null => {
  let value: unknown;
  try {
    value = JSON.parse(UTF8_FATAL.decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const candidate = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(candidate).length !== 9 ||
    candidate.version !== VERSION ||
    candidate.audience !== FRONTEND_API_AUDIENCE ||
    !validEnvironment(candidate.environment) ||
    (candidate.method !== "GET" && candidate.method !== "HEAD") ||
    typeof candidate.path !== "string" ||
    !candidate.path.startsWith("/") ||
    candidate.path.length > 512 ||
    typeof candidate.query_sha256 !== "string" ||
    !BASE64URL.test(candidate.query_sha256) ||
    base64UrlDecode(candidate.query_sha256, 32)?.byteLength !== 32 ||
    (candidate.publication_id !== null &&
      (typeof candidate.publication_id !== "string" ||
        !PUBLICATION_ID.test(candidate.publication_id))) ||
    !Number.isSafeInteger(candidate.issued_at_ms) ||
    !Number.isSafeInteger(candidate.expires_at_ms)
  )
    return null;
  const envelope = candidate as Envelope;
  return canonicalEnvelope(envelope) === UTF8_FATAL.decode(bytes)
    ? envelope
    : null;
};

const importHmacKey = async (
  subtle: SubtleCrypto,
  secret: unknown,
  usage: KeyUsage,
): Promise<CryptoKey | null> => {
  if (typeof secret !== "string" || UTF8.encode(secret).byteLength < 32)
    return null;
  try {
    return await subtle.importKey(
      "raw",
      UTF8.encode(secret),
      { hash: "SHA-256", name: "HMAC" },
      false,
      [usage],
    );
  } catch {
    return null;
  }
};

const queryDigest = async (
  rawQuery: string,
  subtle: SubtleCrypto,
): Promise<string> =>
  base64UrlEncode(
    new Uint8Array(await subtle.digest("SHA-256", UTF8.encode(rawQuery))),
  );

export async function signFrontendApiRequest(
  input: Readonly<{
    environment: FrontendApiEnvironment;
    keySlot?: FrontendApiKeySlot;
    method: "GET" | "HEAD";
    nowMs: number;
    path: string;
    publicationId?: string | null;
    rawQuery?: string;
    secret: unknown;
    subtle: SubtleCrypto;
  }>,
): Promise<Headers | null> {
  if (
    !Number.isSafeInteger(input.nowMs) ||
    !input.path.startsWith("/") ||
    input.path.length > 512 ||
    (input.publicationId !== undefined &&
      input.publicationId !== null &&
      !PUBLICATION_ID.test(input.publicationId))
  )
    return null;
  const key = await importHmacKey(input.subtle, input.secret, "sign");
  if (key === null) return null;
  const envelope: Envelope = {
    version: VERSION,
    audience: FRONTEND_API_AUDIENCE,
    environment: input.environment,
    method: input.method,
    path: input.path,
    query_sha256: await queryDigest(input.rawQuery ?? "", input.subtle),
    publication_id: input.publicationId ?? null,
    issued_at_ms: input.nowMs,
    expires_at_ms: input.nowMs + TTL_MS,
  };
  const bytes = UTF8.encode(canonicalEnvelope(envelope));
  const signature = new Uint8Array(await input.subtle.sign("HMAC", key, bytes));
  return new Headers({
    [FRONTEND_API_ENVELOPE_HEADER]: base64UrlEncode(bytes),
    [FRONTEND_API_KEY_SLOT_HEADER]: input.keySlot ?? "current",
    [FRONTEND_API_SIGNATURE_HEADER]: base64UrlEncode(signature),
  });
}

async function verifyFrontendApiRequestUnchecked(
  input: Readonly<{
    environment: FrontendApiEnvironment;
    nowMs: number;
    request: Request;
    secrets: FrontendApiSecrets;
    subtle: SubtleCrypto;
  }>,
): Promise<VerifiedFrontendApiRequest | null> {
  if (!Number.isSafeInteger(input.nowMs)) return null;
  let url: URL;
  try {
    url = new URL(input.request.url);
  } catch {
    return null;
  }
  if (url.origin !== FRONTEND_API_INTERNAL_ORIGIN) return null;
  const encodedEnvelope = input.request.headers.get(
    FRONTEND_API_ENVELOPE_HEADER,
  );
  const encodedSignature = input.request.headers.get(
    FRONTEND_API_SIGNATURE_HEADER,
  );
  const keySlot = input.request.headers.get(FRONTEND_API_KEY_SLOT_HEADER);
  if (
    encodedEnvelope === null ||
    encodedSignature === null ||
    (keySlot !== "current" && keySlot !== "next")
  )
    return null;
  const envelopeBytes = base64UrlDecode(encodedEnvelope, MAX_ENVELOPE_BYTES);
  const signature = base64UrlDecode(encodedSignature, 32);
  if (envelopeBytes === null || signature?.byteLength !== 32) return null;
  const envelope = parseEnvelope(envelopeBytes);
  if (envelope?.environment !== input.environment) return null;
  if (
    envelope.method !== input.request.method ||
    envelope.path !== url.pathname ||
    envelope.expires_at_ms !== envelope.issued_at_ms + TTL_MS ||
    envelope.issued_at_ms > input.nowMs + MAX_FUTURE_SKEW_MS ||
    envelope.expires_at_ms < input.nowMs ||
    envelope.query_sha256 !==
      (await queryDigest(url.search.slice(1), input.subtle)) ||
    envelope.publication_id !==
      input.request.headers.get("X-QuantClarity-Publication")
  )
    return null;
  const candidates: readonly (readonly [FrontendApiKeySlot, unknown])[] =
    keySlot === "current"
      ? [
          ["current", input.secrets.current],
          ["next", input.secrets.next],
        ]
      : [
          ["next", input.secrets.next],
          ["current", input.secrets.current],
        ];
  for (const [candidateSlot, secret] of candidates) {
    const key = await importHmacKey(input.subtle, secret, "verify");
    if (key === null) continue;
    const verified = await input.subtle.verify(
      "HMAC",
      key,
      signature,
      envelopeBytes,
    );
    if (verified) return { envelope, keySlot: candidateSlot };
  }
  return null;
}

export async function verifyFrontendApiRequest(
  input: Parameters<typeof verifyFrontendApiRequestUnchecked>[0],
): Promise<VerifiedFrontendApiRequest | null> {
  try {
    return await verifyFrontendApiRequestUnchecked(input);
  } catch {
    return null;
  }
}

export function hasFrontendApiReservedHeaders(request: Request): boolean {
  try {
    return FRONTEND_API_RESERVED_HEADERS.some(
      (name) => request.headers.get(name) !== null,
    );
  } catch {
    return false;
  }
}
