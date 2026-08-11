import {
  FRONTEND_API_INTERNAL_ORIGIN,
  signFrontendApiRequest,
  type FrontendApiEnvironment,
} from "@quant-clarity/api-core";
import {
  checkDatasetMetadataContract,
  type DatasetMetadata,
} from "@quant-clarity/contracts";

const PATH = "/v1/metadata";
const MAX_RESPONSE_BYTES = 65_536;
const METADATA_DEADLINE_MS = 500;
const JSON_MEDIA_TYPE =
  /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/iu;
const LOCAL_FRONTEND_API_HMAC_CURRENT =
  "quantclarity-local-only-frontend-api-signing-key-v1";

export type PublicationState =
  | Readonly<{ kind: "published"; metadata: DatasetMetadata }>
  | Readonly<{ kind: "not_published" }>
  | Readonly<{ kind: "unavailable" }>;

export interface DatasetMetadataEnv {
  API: { fetch(input: Request): Promise<Response> };
  DEPLOYMENT_ENV: FrontendApiEnvironment;
  FRONTEND_API_HMAC_CURRENT?: unknown;
}

const isJsonResponse = (response: Response): boolean => {
  const contentType = response.headers.get("Content-Type");
  return contentType !== null && JSON_MEDIA_TYPE.test(contentType);
};

async function boundedBytes(
  response: Response,
  deadline: Promise<null>,
): Promise<Uint8Array | null> {
  const declared = response.headers.get("Content-Length");
  if (
    declared !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declared) ||
      Number(declared) > MAX_RESPONSE_BYTES)
  )
    return null;
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next === null) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readPublicationState(
  env: DatasetMetadataEnv,
  nowMs = Date.now(),
  subtle = crypto.subtle,
  deadlineMs = METADATA_DEADLINE_MS,
): Promise<PublicationState> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;
  try {
    if (
      !Number.isSafeInteger(deadlineMs) ||
      deadlineMs < 1 ||
      deadlineMs > 5_000
    )
      return { kind: "unavailable" };
    abort = new AbortController();
    const deadline = new Promise<null>((resolve) => {
      timeout = setTimeout(() => {
        abort?.abort();
        resolve(null);
      }, deadlineMs);
    });
    const secret =
      env.FRONTEND_API_HMAC_CURRENT ??
      (env.DEPLOYMENT_ENV === "local"
        ? LOCAL_FRONTEND_API_HMAC_CURRENT
        : undefined);
    const headers = await Promise.race([
      signFrontendApiRequest({
        environment: env.DEPLOYMENT_ENV,
        method: "GET",
        nowMs,
        path: PATH,
        secret,
        subtle,
      }),
      deadline,
    ]);
    if (headers === null) return { kind: "unavailable" };
    const internalRequest = new Request(
      `${FRONTEND_API_INTERNAL_ORIGIN}${PATH}`,
      {
        headers,
        method: "GET",
        redirect: "manual",
        signal: abort.signal,
      },
    );
    const fetchResult = Promise.resolve()
      .then(() => env.API.fetch(internalRequest))
      .catch(() => null);
    const response = await Promise.race([fetchResult, deadline]);
    if (response === null) return { kind: "unavailable" };
    if (response.status === 503) {
      if (!isJsonResponse(response)) return { kind: "unavailable" };
      const bytes = await boundedBytes(response, deadline);
      if (bytes === null) return { kind: "unavailable" };
      let body: unknown;
      try {
        body = JSON.parse(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            bytes,
          ),
        );
      } catch {
        return { kind: "unavailable" };
      }
      const pending = body as {
        error?: { code?: unknown; message?: unknown };
      };
      return typeof body === "object" &&
        body !== null &&
        !Array.isArray(body) &&
        Reflect.ownKeys(body).length === 1 &&
        typeof pending.error === "object" &&
        Reflect.ownKeys(pending.error).length === 2 &&
        pending.error.code === "publication_not_ready" &&
        pending.error.message === "No public dataset has been published yet."
        ? { kind: "not_published" }
        : { kind: "unavailable" };
    }
    if (response.status !== 200 || !isJsonResponse(response))
      return { kind: "unavailable" };
    const bytes = await boundedBytes(response, deadline);
    if (bytes === null) return { kind: "unavailable" };
    let metadata: unknown;
    try {
      metadata = JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ),
      );
    } catch {
      return { kind: "unavailable" };
    }
    return checkDatasetMetadataContract(metadata)
      ? { kind: "published", metadata }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
