import {
  canonicalExactVariantSearchQuery,
  encodeExactVariantCardCollectionRepresentation,
  EXACT_VARIANT_SEARCH_API_PATH,
  EXACT_VARIANT_SEARCH_PUBLIC_MAX_BYTES,
  FRONTEND_API_INTERNAL_ORIGIN,
  parseCanonicalExactVariantSearchQuery,
  signFrontendApiRequest,
  type ExactVariantCardCollection,
  type FrontendApiEnvironment,
} from "@quant-clarity/api-core";
import { parsePublicationPin } from "@quant-clarity/domain/publication-consistency";

const SEARCH_DEADLINE_MS = 500;
const MAX_BODY_CHUNKS = 1_024;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const PUBLICATION_VARY = "X-QuantClarity-Publication";
const LOCAL_FRONTEND_API_HMAC_CURRENT =
  "quantclarity-local-only-frontend-api-signing-key-v1";
const DEADLINE = Symbol("exact-variant-search-deadline");
const READ_FAILURE = Symbol("exact-variant-search-read-failure");
const UTF8_FATAL = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});
const UTF8 = new TextEncoder();
const INVALID_CURSOR_BYTES = UTF8.encode(
  JSON.stringify({
    error: { code: "invalid_cursor", message: "The cursor is invalid." },
  }),
);

const COMMON_RESPONSE_HEADERS = Object.freeze({
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "X-QuantClarity-Publication",
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

export interface ExactVariantSearchEnv {
  API: { fetch(input: Request): Promise<Response> };
  DEPLOYMENT_ENV: FrontendApiEnvironment;
  FRONTEND_API_HMAC_CURRENT?: unknown;
}

export type ExactVariantSearchCollection = ExactVariantCardCollection;

export type ExactVariantSearchState =
  | Readonly<{ collection: ExactVariantSearchCollection; kind: "found" }>
  | Readonly<{ kind: "invalid_cursor" }>
  | Readonly<{ kind: "unavailable" }>;

type HeaderProfile = Readonly<{ contentLength: number }>;

const cancelBody = (response: Response): void => {
  try {
    if (response.body !== null)
      void response.body.cancel().catch(() => undefined);
  } catch {
    // A rejected hostile body needs no further effect.
  }
};

const exactHeaderProfile = (
  response: Response,
  publicationId: string,
): HeaderProfile | null => {
  try {
    const expected = new Set([
      ...Object.keys(COMMON_RESPONSE_HEADERS),
      "cache-control",
      "content-length",
      "content-type",
      "vary",
      "x-quantclarity-publication",
    ]);
    const names = [...response.headers.keys()];
    if (
      names.length !== expected.size ||
      names.some((name) => !expected.has(name))
    )
      return null;
    for (const [name, value] of Object.entries(COMMON_RESPONSE_HEADERS))
      if (response.headers.get(name) !== value) return null;
    if (
      response.headers.get("Cache-Control") !== "private, no-store" ||
      response.headers.get("Content-Type") !== JSON_CONTENT_TYPE ||
      response.headers.get("Vary") !== PUBLICATION_VARY ||
      response.headers.get("X-QuantClarity-Publication") !== publicationId
    )
      return null;
    const declared = response.headers.get("Content-Length");
    if (
      declared === null ||
      !/^[1-9][0-9]*$/u.test(declared) ||
      Number(declared) > EXACT_VARIANT_SEARCH_PUBLIC_MAX_BYTES
    )
      return null;
    return { contentLength: Number(declared) };
  } catch {
    return null;
  }
};

const invalidCursorHeaderProfile = (
  response: Response,
): HeaderProfile | null => {
  try {
    const expected = new Set([
      ...Object.keys(COMMON_RESPONSE_HEADERS),
      "cache-control",
      "content-length",
      "content-type",
    ]);
    const names = [...response.headers.keys()];
    if (
      names.length !== expected.size ||
      names.some((name) => !expected.has(name))
    )
      return null;
    for (const [name, value] of Object.entries(COMMON_RESPONSE_HEADERS))
      if (response.headers.get(name) !== value) return null;
    if (
      response.headers.get("Cache-Control") !== "private, no-store" ||
      response.headers.get("Content-Type") !== JSON_CONTENT_TYPE ||
      response.headers.get("Content-Length") !==
        String(INVALID_CURSOR_BYTES.byteLength)
    )
      return null;
    return { contentLength: INVALID_CURSOR_BYTES.byteLength };
  } catch {
    return null;
  }
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((byte, index) => byte === right[index]);

const readResult = (
  value: unknown,
): ReadableStreamReadResult<Uint8Array> | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const done = Object.getOwnPropertyDescriptor(value, "done");
    const chunk = Object.getOwnPropertyDescriptor(value, "value");
    if (
      done === undefined ||
      !("value" in done) ||
      typeof done.value !== "boolean" ||
      (!done.value &&
        (chunk === undefined ||
          !("value" in chunk) ||
          !(chunk.value instanceof Uint8Array) ||
          Object.getPrototypeOf(chunk.value) !== Uint8Array.prototype))
    )
      return null;
    return done.value
      ? { done: true, value: undefined }
      : { done: false, value: chunk?.value as Uint8Array };
  } catch {
    return null;
  }
};

const boundedBytes = async (
  response: Response,
  declaredLength: number,
  deadline: Promise<typeof DEADLINE>,
): Promise<Uint8Array | null> => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    if (response.body === null) return null;
    reader = response.body.getReader();
  } catch {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let chunkCount = 0;
  try {
    for (;;) {
      const raw = await Promise.race([
        Promise.resolve()
          .then(() => reader.read())
          .catch(() => READ_FAILURE),
        deadline,
      ]);
      if (raw === DEADLINE || raw === READ_FAILURE) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      const item = readResult(raw);
      if (item === null) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      if (item.done) break;
      chunkCount += 1;
      total += item.value.byteLength;
      if (
        chunkCount > MAX_BODY_CHUNKS ||
        total > declaredLength ||
        total > EXACT_VARIANT_SEARCH_PUBLIC_MAX_BYTES
      ) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(new Uint8Array(item.value));
    }
  } catch {
    return null;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A hostile reader is already a failed response admission.
    }
  }
  if (total !== declaredLength) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const exactCollection = (
  collection: ExactVariantCardCollection,
  expectedPublicationId: string,
  query: string,
): boolean =>
  collection.meta.publication_id === expectedPublicationId &&
  (collection.page.next_cursor === null ||
    canonicalExactVariantSearchQuery(query, collection.page.next_cursor) !==
      null);

export async function readExactVariantSearchState(
  env: ExactVariantSearchEnv,
  rawQueryValue: unknown,
  expectedPublicationValue: unknown,
  nowMs = Date.now(),
  subtle = crypto.subtle,
  deadlineMs = SEARCH_DEADLINE_MS,
): Promise<ExactVariantSearchState> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;
  try {
    const parsed = parseCanonicalExactVariantSearchQuery(rawQueryValue);
    const expectedPublicationId =
      typeof expectedPublicationValue === "string"
        ? parsePublicationPin(expectedPublicationValue)
        : null;
    if (
      parsed === null ||
      env.DEPLOYMENT_ENV !== "local" ||
      expectedPublicationId === null ||
      !Number.isSafeInteger(deadlineMs) ||
      deadlineMs < 1 ||
      deadlineMs > 5_000
    )
      return { kind: "unavailable" };
    const rawQuery = rawQueryValue as string;
    abort = new AbortController();
    const deadline = new Promise<typeof DEADLINE>((resolve) => {
      timeout = setTimeout(() => {
        abort?.abort();
        resolve(DEADLINE);
      }, deadlineMs);
    });
    const secret =
      env.FRONTEND_API_HMAC_CURRENT ?? LOCAL_FRONTEND_API_HMAC_CURRENT;
    const signedHeaders = await Promise.race([
      signFrontendApiRequest({
        environment: env.DEPLOYMENT_ENV,
        method: "GET",
        nowMs,
        path: EXACT_VARIANT_SEARCH_API_PATH,
        publicationId: expectedPublicationId,
        rawQuery,
        secret,
        subtle,
      }),
      deadline,
    ]);
    if (signedHeaders === DEADLINE || signedHeaders === null)
      return { kind: "unavailable" };
    signedHeaders.set("X-QuantClarity-Publication", expectedPublicationId);
    const internalRequest = new Request(
      `${FRONTEND_API_INTERNAL_ORIGIN}${EXACT_VARIANT_SEARCH_API_PATH}?${rawQuery}`,
      {
        headers: signedHeaders,
        method: "GET",
        redirect: "manual",
        signal: abort.signal,
      },
    );
    const fetched = Promise.resolve()
      .then(() => env.API.fetch(internalRequest))
      .catch(() => READ_FAILURE);
    const rawResponse = await Promise.race([fetched, deadline]);
    if (rawResponse === DEADLINE || rawResponse === READ_FAILURE)
      return { kind: "unavailable" };
    if (!(rawResponse instanceof Response)) return { kind: "unavailable" };
    let status: number;
    try {
      status = rawResponse.status;
    } catch {
      return { kind: "unavailable" };
    }
    if (status !== 200 && status !== 400) {
      cancelBody(rawResponse);
      return { kind: "unavailable" };
    }
    const profile =
      status === 200
        ? exactHeaderProfile(rawResponse, expectedPublicationId)
        : invalidCursorHeaderProfile(rawResponse);
    if (profile === null) {
      cancelBody(rawResponse);
      return { kind: "unavailable" };
    }
    const bytes = await boundedBytes(
      rawResponse,
      profile.contentLength,
      deadline,
    );
    if (bytes === null) return { kind: "unavailable" };
    if (status === 400)
      return parsed.cursor !== null && sameBytes(bytes, INVALID_CURSOR_BYTES)
        ? { kind: "invalid_cursor" }
        : { kind: "unavailable" };
    let collection: unknown;
    try {
      collection = JSON.parse(UTF8_FATAL.decode(bytes));
    } catch {
      return { kind: "unavailable" };
    }
    let encoded;
    try {
      encoded = encodeExactVariantCardCollectionRepresentation(collection);
    } catch {
      return { kind: "unavailable" };
    }
    if (
      encoded === null ||
      !exactCollection(encoded.collection, expectedPublicationId, parsed.query)
    )
      return { kind: "unavailable" };
    return sameBytes(encoded.representationBytes, bytes)
      ? { collection: encoded.collection, kind: "found" }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
