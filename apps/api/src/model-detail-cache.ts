import {
  encodeModelDetailRepresentation,
  MODEL_DETAIL_PUBLIC_MAX_BYTES,
  representationEtag,
  snapshotModelDetailModel,
  type ModelDetailResponse,
} from "@quant-clarity/api-core";
import { publicationCacheKey } from "@quant-clarity/domain/publication-consistency";

import type {
  ModelDetailApiV2Outcome,
  ModelDetailApiV2Input,
  ModelDetailSelectedReadV2Outcome,
} from "./model-detail-query.js";
import { executeAfterModelDetailPublicationResolutionV2 } from "./model-detail-query.js";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const MODEL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SCHEMA_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: false,
});
const INTERNAL_CACHE_CONTROL = "public, max-age=300, must-revalidate";
const INTERNAL_CONTENT_TYPE = "application/json; charset=utf-8";
const COOKIE_RESPONSE_HEADER = ["Set", "Cookie"].join("-");
const MAX_BODY_CHUNKS = 1024;

type ModelDetailCache = Pick<Cache, "match" | "put">;
type ModelDetailCacheMatch = (
  request: Request,
) => Promise<Response | undefined>;
type ModelDetailCachePut = (
  request: Request,
  response: Response,
) => Promise<void>;

export type ModelDetailCacheReadInput = Readonly<{
  cache: ModelDetailCache;
  modelId: string;
  protectedOrigin: string;
  publicationId: string;
  readCanonical: () => Promise<ModelDetailSelectedReadV2Outcome>;
  schedule: (promise: Promise<void>) => void;
  subtle: SubtleCrypto;
}>;

export type ModelDetailCachedQueryV2Input = Readonly<{
  cache: ModelDetailCache;
  protectedOrigin: string;
  query: ModelDetailApiV2Input;
  schedule: (promise: Promise<void>) => void;
  subtle: SubtleCrypto;
}>;

interface CanonicalCacheRepresentation {
  canonicalSlug: string;
  detail: ModelDetailResponse;
  etag: string;
  representationBytes: Uint8Array;
}

const snapshotOwnRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    )
      return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      )
        return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
};

const exactArray = (value: unknown, expected: readonly string[]): boolean => {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== expected.length ||
      Reflect.ownKeys(value).length !== expected.length + 1
    )
      return false;
    return expected.every((item, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      return (
        descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable === true &&
        descriptor.value === item
      );
    });
  } catch {
    return false;
  }
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1)
    if (left[index] !== right[index]) return false;
  return true;
};

const canonicalRepresentation = async (
  detailValue: unknown,
  expectedModelId: string,
  expectedPublicationId: string,
  subtle: SubtleCrypto,
): Promise<CanonicalCacheRepresentation | null> => {
  try {
    const detail = snapshotOwnRecord(detailValue, ["data", "meta"]);
    const meta = snapshotOwnRecord(detail?.meta, [
      "filters",
      "publication_id",
      "resource",
      "schema_version",
      "sort",
    ]);
    const filters = snapshotOwnRecord(meta?.filters, []);
    if (
      meta?.resource !== "models" ||
      meta.publication_id !== expectedPublicationId ||
      typeof meta.schema_version !== "string" ||
      !SCHEMA_VERSION.test(meta.schema_version) ||
      !exactArray(meta.sort, ["name", "stable_id"]) ||
      filters === null
    )
      return null;
    const model = snapshotModelDetailModel({
      expectedModelId,
      maxRepresentationBytes: MODEL_DETAIL_PUBLIC_MAX_BYTES,
      model: detail?.data,
    });
    if (
      model?.slug.state !== "known" ||
      typeof model.slug.value !== "string" ||
      !MODEL_SLUG.test(model.slug.value) ||
      UTF8.encode(model.slug.value).byteLength > 128
    )
      return null;
    const encoded = encodeModelDetailRepresentation({
      model,
      publicationId: expectedPublicationId,
      schemaVersion: meta.schema_version,
    });
    const etag = await representationEtag(
      expectedPublicationId,
      "json",
      encoded.representationBytes,
      subtle,
    );
    return {
      canonicalSlug: model.slug.value,
      detail: encoded.detail,
      etag,
      representationBytes: new Uint8Array(encoded.representationBytes),
    };
  } catch {
    return null;
  }
};

const representationFromBytes = async (
  value: unknown,
  expectedModelId: string,
  expectedPublicationId: string,
  subtle: SubtleCrypto,
): Promise<CanonicalCacheRepresentation | null> => {
  try {
    if (
      !(value instanceof Uint8Array) ||
      Object.getPrototypeOf(value) !== Uint8Array.prototype ||
      value.byteLength < 1 ||
      value.byteLength > MODEL_DETAIL_PUBLIC_MAX_BYTES
    )
      return null;
    const bytes = new Uint8Array(value);
    const parsed: unknown = JSON.parse(UTF8_DECODER.decode(bytes));
    const canonical = await canonicalRepresentation(
      parsed,
      expectedModelId,
      expectedPublicationId,
      subtle,
    );
    return canonical !== null &&
      bytesEqual(bytes, canonical.representationBytes)
      ? canonical
      : null;
  } catch {
    return null;
  }
};

const readBoundedBody = async (
  response: Response,
  declaredLength: number,
): Promise<Uint8Array | null> => {
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let chunkCount = 0;
  let total = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      chunkCount += 1;
      if (
        chunkCount > MAX_BODY_CHUNKS ||
        !(item.value instanceof Uint8Array) ||
        Object.getPrototypeOf(item.value) !== Uint8Array.prototype
      ) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      total += item.value.byteLength;
      if (total > declaredLength || total > MODEL_DETAIL_PUBLIC_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(new Uint8Array(item.value));
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  if (total !== declaredLength) return null;
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const acceptedCacheHit = async (
  response: unknown,
  modelId: string,
  publicationId: string,
  subtle: SubtleCrypto,
): Promise<Extract<ModelDetailApiV2Outcome, { success: true }> | null> => {
  try {
    if (!(response instanceof Response) || response.status !== 200) return null;
    const contentLength = response.headers.get("Content-Length");
    if (
      contentLength === null ||
      !/^[1-9][0-9]*$/u.test(contentLength) ||
      Number(contentLength) > MODEL_DETAIL_PUBLIC_MAX_BYTES ||
      response.headers.get("Cache-Control") !== INTERNAL_CACHE_CONTROL ||
      response.headers.get("Content-Type") !== INTERNAL_CONTENT_TYPE ||
      response.headers.get("X-QuantClarity-Publication") !== publicationId ||
      response.headers.has(COOKIE_RESPONSE_HEADER) ||
      response.headers.has("Vary") ||
      response.headers.has("Content-Encoding") ||
      response.headers.has("Content-Range")
    )
      return null;
    const bytes = await readBoundedBody(response, Number(contentLength));
    if (bytes === null) return null;
    const canonical = await representationFromBytes(
      bytes,
      modelId,
      publicationId,
      subtle,
    );
    if (canonical?.etag !== response.headers.get("ETag")) return null;
    return {
      success: true,
      detail: canonical.detail,
      lookup: { kind: "stable_id", value: modelId },
      lookupProvenance: {
        canonicalSlug: canonical.canonicalSlug,
        matchedBy: "stable_id",
        projectionVersion: "model-slug@1",
      },
      publicationId,
      representationBytes: new Uint8Array(canonical.representationBytes),
    };
  } catch {
    return null;
  }
};

const snapshotCanonicalRead = async (
  value: unknown,
  modelId: string,
  publicationId: string,
  subtle: SubtleCrypto,
): Promise<
  Readonly<{
    outcome: ModelDetailSelectedReadV2Outcome;
    representation: CanonicalCacheRepresentation | null;
  }>
> => {
  const success = snapshotOwnRecord(value, [
    "detail",
    "lookup",
    "lookupProvenance",
    "publicationId",
    "representationBytes",
    "success",
  ]);
  if (success?.success === true) {
    const lookup = snapshotOwnRecord(success.lookup, ["kind", "value"]);
    const provenance = snapshotOwnRecord(success.lookupProvenance, [
      "canonicalSlug",
      "matchedBy",
      "projectionVersion",
    ]);
    const representation = await representationFromBytes(
      success.representationBytes,
      modelId,
      publicationId,
      subtle,
    );
    const detailRepresentation = await canonicalRepresentation(
      success.detail,
      modelId,
      publicationId,
      subtle,
    );
    if (
      success.publicationId !== publicationId ||
      lookup?.kind !== "stable_id" ||
      lookup.value !== modelId ||
      provenance?.matchedBy !== "stable_id" ||
      provenance.projectionVersion !== "model-slug@1" ||
      representation === null ||
      detailRepresentation === null ||
      provenance.canonicalSlug !== representation.canonicalSlug ||
      !bytesEqual(
        representation.representationBytes,
        detailRepresentation.representationBytes,
      )
    )
      return {
        outcome: { success: false, code: "integrity_failure" },
        representation: null,
      };
    return {
      outcome: {
        success: true,
        detail: representation.detail,
        lookup: { kind: "stable_id", value: modelId },
        lookupProvenance: {
          canonicalSlug: representation.canonicalSlug,
          matchedBy: "stable_id",
          projectionVersion: "model-slug@1",
        },
        publicationId,
        representationBytes: new Uint8Array(representation.representationBytes),
      },
      representation,
    };
  }

  const notFound = snapshotOwnRecord(value, [
    "code",
    "publicationId",
    "success",
  ]);
  if (
    notFound?.success === false &&
    notFound.code === "not_found" &&
    notFound.publicationId === publicationId
  )
    return {
      outcome: { success: false, code: "not_found", publicationId },
      representation: null,
    };

  const failure = snapshotOwnRecord(value, ["code", "success"]);
  if (
    failure?.success === false &&
    (failure.code === "integrity_failure" ||
      failure.code === "invalid_input" ||
      failure.code === "read_failure")
  )
    return {
      outcome: { success: false, code: failure.code },
      representation: null,
    };
  return {
    outcome: { success: false, code: "integrity_failure" },
    representation: null,
  };
};

export const modelDetailCacheRequest = (
  protectedOrigin: string,
  publicationId: string,
  modelId: string,
): Request | null => {
  try {
    const origin = new URL(protectedOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== protectedOrigin ||
      origin.username !== "" ||
      origin.password !== "" ||
      !PUBLICATION_ID.test(publicationId) ||
      !MODEL_ID.test(modelId)
    )
      return null;
    const key = publicationCacheKey(protectedOrigin, {
      publicationId,
      representation: "json",
      resourceId: modelId,
      resourceType: "model",
    });
    return new Request(key, { method: "GET" });
  } catch {
    return null;
  }
};

const internalCacheResponse = (
  representation: CanonicalCacheRepresentation,
  publicationId: string,
): Response =>
  new Response(new Uint8Array(representation.representationBytes), {
    status: 200,
    headers: {
      "Cache-Control": INTERNAL_CACHE_CONTROL,
      "Content-Length": String(representation.representationBytes.byteLength),
      "Content-Type": INTERNAL_CONTENT_TYPE,
      ETag: representation.etag,
      "X-QuantClarity-Publication": publicationId,
    },
  });

/**
 * Optional B3 stable-ID Cache API boundary. Cache absence, corruption, and
 * failures become canonical reads; only a validated canonical success is
 * scheduled for an opportunistic, publication-qualified write.
 */
export const readModelDetailThroughCache = async (
  input: ModelDetailCacheReadInput,
): Promise<ModelDetailApiV2Outcome> => {
  const top = snapshotOwnRecord(input, [
    "cache",
    "modelId",
    "protectedOrigin",
    "publicationId",
    "readCanonical",
    "schedule",
    "subtle",
  ]);
  if (
    top === null ||
    typeof top.modelId !== "string" ||
    typeof top.protectedOrigin !== "string" ||
    typeof top.publicationId !== "string" ||
    typeof top.readCanonical !== "function" ||
    typeof top.schedule !== "function"
  )
    return { success: false, code: "invalid_input" };
  let subtle: SubtleCrypto;
  try {
    const suppliedSubtle = top.subtle as SubtleCrypto;
    const digest = suppliedSubtle.digest.bind(suppliedSubtle);
    subtle = {
      digest,
    } as SubtleCrypto;
  } catch {
    return { success: false, code: "invalid_input" };
  }
  let cacheMatch: ModelDetailCacheMatch | null = null;
  let cachePut: ModelDetailCachePut | null = null;
  try {
    const suppliedCache = top.cache as ModelDetailCache;
    if (
      typeof suppliedCache.match === "function" &&
      typeof suppliedCache.put === "function"
    ) {
      cacheMatch = suppliedCache.match.bind(suppliedCache);
      cachePut = suppliedCache.put.bind(suppliedCache);
    }
  } catch {
    // An unusable optional cache capability is equivalent to a cache miss.
  }
  const key = modelDetailCacheRequest(
    top.protectedOrigin,
    top.publicationId,
    top.modelId,
  );
  if (key === null) return { success: false, code: "integrity_failure" };

  if (cacheMatch !== null) {
    try {
      const cached = await cacheMatch(key);
      const hit = await acceptedCacheHit(
        cached,
        top.modelId,
        top.publicationId,
        subtle,
      );
      if (hit !== null) return hit;
    } catch {
      // Cache API is optional; every fault continues to canonical authority.
    }
  }

  let rawOutcome: unknown;
  try {
    rawOutcome = await (
      top.readCanonical as ModelDetailCacheReadInput["readCanonical"]
    )();
  } catch {
    return { success: false, code: "read_failure" };
  }
  const canonical = await snapshotCanonicalRead(
    rawOutcome,
    top.modelId,
    top.publicationId,
    subtle,
  );
  if (!canonical.outcome.success || canonical.representation === null)
    return canonical.outcome;

  const putKey = modelDetailCacheRequest(
    top.protectedOrigin,
    top.publicationId,
    top.modelId,
  );
  if (putKey !== null && cachePut !== null) {
    try {
      const put = Promise.resolve(
        cachePut(
          putKey,
          internalCacheResponse(canonical.representation, top.publicationId),
        ),
      ).catch(() => undefined);
      try {
        (top.schedule as ModelDetailCacheReadInput["schedule"])(put);
      } catch {
        // A scheduler fault cannot change the canonical public representation.
      }
    } catch {
      // A synchronous cache fault cannot change the canonical representation.
    }
  }
  return canonical.outcome;
};

/**
 * Resolver-first cache orchestration. Only a resolver-classified stable ID can
 * reach Cache API; every slug continues directly through the opaque canonical
 * read capability.
 */
export const readModelDetailFromQueryWithCacheV2 = async (
  input: ModelDetailCachedQueryV2Input,
): Promise<ModelDetailApiV2Outcome> => {
  const top = snapshotOwnRecord(input, [
    "cache",
    "protectedOrigin",
    "query",
    "schedule",
    "subtle",
  ]);
  if (
    top === null ||
    typeof top.protectedOrigin !== "string" ||
    typeof top.schedule !== "function"
  )
    return { success: false, code: "invalid_input" };
  const protectedOrigin = top.protectedOrigin;
  return executeAfterModelDetailPublicationResolutionV2(
    top.query as ModelDetailApiV2Input,
    (resolved) =>
      resolved.lookup.kind === "stable_id"
        ? readModelDetailThroughCache({
            cache: top.cache as ModelDetailCache,
            modelId: resolved.lookup.value,
            protectedOrigin,
            publicationId: resolved.publicationId,
            readCanonical: resolved.readCanonical,
            schedule: top.schedule as ModelDetailCacheReadInput["schedule"],
            subtle: top.subtle as SubtleCrypto,
          })
        : resolved.readCanonical(),
  );
};
