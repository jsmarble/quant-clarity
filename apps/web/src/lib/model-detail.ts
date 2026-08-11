import {
  classifyModelDetailIdentifier,
  encodeModelDetailRepresentation,
  FRONTEND_API_INTERNAL_ORIGIN,
  modelDetailApiPath,
  MODEL_DETAIL_PUBLIC_MAX_BYTES,
  representationEtag,
  signFrontendApiRequest,
  type FrontendApiEnvironment,
} from "@quant-clarity/api-core";
import {
  checkDatasetMetadataContract,
  checkModelDetailContract,
  type DatasetMetadata,
  type ModelDetail,
} from "@quant-clarity/contracts";

const DETAIL_DEADLINE_MS = 500;
const MAX_BODY_CHUNKS = 1_024;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const PUBLICATION_VARY = "X-QuantClarity-Publication";
const LOCAL_FRONTEND_API_HMAC_CURRENT =
  "quantclarity-local-only-frontend-api-signing-key-v1";
const DEADLINE = Symbol("model-detail-deadline");
const READ_FAILURE = Symbol("model-detail-read-failure");
const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});
const STRONG_ETAG = /^"[0-9a-f]{64}"$/u;

const COMMON_RESPONSE_HEADERS = Object.freeze({
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "ETag, X-QuantClarity-Publication",
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "permissions-policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

const NOT_FOUND_BYTES = UTF8.encode(
  JSON.stringify({
    error: {
      code: "resource_not_found",
      message: "The requested resource does not exist.",
    },
  }),
);

export interface ModelDetailEnv {
  API: { fetch(input: Request): Promise<Response> };
  DEPLOYMENT_ENV: FrontendApiEnvironment;
  FRONTEND_API_HMAC_CURRENT?: unknown;
}

export type ModelDetailState =
  | Readonly<{ detail: ModelDetail; kind: "found" }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "unavailable" }>;

type HeaderProfile = Readonly<{ contentLength: number }>;

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((byte, index) => byte === right[index]);

const cancelBody = (response: Response): void => {
  try {
    if (response.body !== null)
      void response.body.cancel().catch(() => undefined);
  } catch {
    // A hostile body is rejected by the caller and needs no further effect.
  }
};

const exactHeaderProfile = (
  response: Response,
  status: 200 | 404,
  identifierKind: "slug" | "stable_id",
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
      ...(status === 200 ? ["etag"] : []),
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
      response.headers.get("Content-Type") !== JSON_CONTENT_TYPE ||
      response.headers.get("Vary") !== PUBLICATION_VARY ||
      response.headers.get("X-QuantClarity-Publication") !== publicationId
    )
      return null;
    const declared = response.headers.get("Content-Length");
    if (
      declared === null ||
      !/^[1-9][0-9]*$/u.test(declared) ||
      Number(declared) > MODEL_DETAIL_PUBLIC_MAX_BYTES
    )
      return null;
    if (status === 404) {
      if (response.headers.get("Cache-Control") !== "private, no-store")
        return null;
    } else if (
      response.headers.get("Cache-Control") !==
        (identifierKind === "stable_id"
          ? "private, max-age=0, must-revalidate"
          : "private, no-store") ||
      !STRONG_ETAG.test(response.headers.get("ETag") ?? "")
    ) {
      return null;
    }
    return { contentLength: Number(declared) };
  } catch {
    return null;
  }
};

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
        total > MODEL_DETAIL_PUBLIC_MAX_BYTES
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

export async function readModelDetailState(
  env: ModelDetailEnv,
  identifierValue: unknown,
  metadataValue: unknown,
  nowMs = Date.now(),
  subtle = crypto.subtle,
  deadlineMs = DETAIL_DEADLINE_MS,
): Promise<ModelDetailState> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;
  try {
    const identifier = classifyModelDetailIdentifier(identifierValue);
    if (
      identifier === null ||
      (env.DEPLOYMENT_ENV !== "local" && env.DEPLOYMENT_ENV !== "test") ||
      !checkDatasetMetadataContract(metadataValue) ||
      !Number.isSafeInteger(deadlineMs) ||
      deadlineMs < 1 ||
      deadlineMs > 5_000
    )
      return { kind: "unavailable" };
    const metadata: DatasetMetadata = metadataValue;
    const path = modelDetailApiPath(identifier.value);
    if (path === null) return { kind: "unavailable" };
    abort = new AbortController();
    const deadline = new Promise<typeof DEADLINE>((resolve) => {
      timeout = setTimeout(() => {
        abort?.abort();
        resolve(DEADLINE);
      }, deadlineMs);
    });
    const secret =
      env.FRONTEND_API_HMAC_CURRENT ??
      (env.DEPLOYMENT_ENV === "local"
        ? LOCAL_FRONTEND_API_HMAC_CURRENT
        : undefined);
    const signedHeaders = await Promise.race([
      signFrontendApiRequest({
        environment: env.DEPLOYMENT_ENV,
        method: "GET",
        nowMs,
        path,
        publicationId: metadata.publication_id,
        secret,
        subtle,
      }),
      deadline,
    ]);
    if (signedHeaders === DEADLINE || signedHeaders === null)
      return { kind: "unavailable" };
    signedHeaders.set("X-QuantClarity-Publication", metadata.publication_id);
    const internalRequest = new Request(
      `${FRONTEND_API_INTERNAL_ORIGIN}${path}`,
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
    if (status !== 200 && status !== 404) {
      cancelBody(rawResponse);
      return { kind: "unavailable" };
    }
    const profile = exactHeaderProfile(
      rawResponse,
      status,
      identifier.kind,
      metadata.publication_id,
    );
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
    if (status === 404)
      return sameBytes(bytes, NOT_FOUND_BYTES)
        ? { kind: "not_found" }
        : { kind: "unavailable" };

    const expectedEtag = await Promise.race([
      representationEtag(metadata.publication_id, "json", bytes, subtle).catch(
        () => READ_FAILURE,
      ),
      deadline,
    ]);
    if (
      expectedEtag === DEADLINE ||
      expectedEtag === READ_FAILURE ||
      rawResponse.headers.get("ETag") !== expectedEtag
    )
      return { kind: "unavailable" };

    let detail: unknown;
    try {
      detail = JSON.parse(UTF8_FATAL.decode(bytes));
    } catch {
      return { kind: "unavailable" };
    }
    if (
      !checkModelDetailContract(detail) ||
      detail.meta.publication_id !== metadata.publication_id ||
      detail.meta.schema_version !== metadata.schema_version ||
      (identifier.kind === "stable_id" &&
        detail.data.model_id !== identifier.value)
    )
      return { kind: "unavailable" };
    let canonicalBytes: Uint8Array;
    try {
      canonicalBytes = encodeModelDetailRepresentation({
        model: detail.data,
        publicationId: detail.meta.publication_id,
        schemaVersion: detail.meta.schema_version,
      }).representationBytes;
    } catch {
      return { kind: "unavailable" };
    }
    return sameBytes(bytes, canonicalBytes)
      ? { detail, kind: "found" }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
