import {
  MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES,
  MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
  checkModelSlugHistoryArtifactContract,
  type ModelSlugHistoryArtifact,
} from "@quant-clarity/contracts";
import {
  MODEL_SLUG_MAX_MODELS,
  assertImmutablePublicationManifest,
  assertModelSlugArchiveArtifactProofV5,
  assertModelSlugProjection,
  projectModelSlugProjection,
  type ModelSlugArchiveArtifactProofV5,
  type ServingResourceClosureRow,
  type Sha256,
  type TrustedImmutablePublicationManifest,
  type TrustedModelSlugProjection,
} from "@quant-clarity/publication-core";

import {
  MODEL_SLUG_HISTORY_ACQUISITION_VERSION,
  assertModelSlugHistoryCandidateCapture,
  type TrustedModelSlugHistoryCandidateCapture,
} from "./model-slug-history-acquisition.js";

export { MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES } from "@quant-clarity/contracts";

export const MODEL_SLUG_HISTORY_ARCHIVE_RETENTION_CLASS =
  "publication-rebuild-input-lifetime" as const;
export const MODEL_SLUG_HISTORY_ARCHIVE_CONTENT_TYPE =
  "application/vnd.quantclarity.model-slug-history+json" as const;
const MODEL_SLUG_HISTORY_GUARD_VERSION = "model-slug-history-guard@1" as const;
const ARCHIVE_KEY_PREFIX = "private/model-slug-history/v1/sha256/" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const utf8 = new TextEncoder();
const ARTIFACT_DIGEST_DOMAIN = utf8.encode(
  "quantclarity:publication-model-slug-artifact:v1\0",
);
const MAX_ARCHIVE_STREAM_CHUNKS = 1_024;
export const MODEL_SLUG_HISTORY_ARCHIVE_RETAINED_HEAP_BUDGET =
  80 * 1_024 * 1_024;
const RETAINED_HEAP_FIXED_RESERVE = 8 * 1_024 * 1_024;
const RETAINED_HEAP_OBJECT_OVERHEAD = 512;
const RETAINED_HEAP_ARTIFACT_MULTIPLIER = 10;

export type ModelSlugHistoryArchiveErrorCode =
  | "configuration_invalid"
  | "integrity_failure"
  | "not_applied"
  | "conflict"
  | "outcome_unknown";

export class ModelSlugHistoryArchiveError extends Error {
  readonly code: ModelSlugHistoryArchiveErrorCode;
  readonly retrySameArtifact: boolean;

  constructor(code: ModelSlugHistoryArchiveErrorCode) {
    super("Model slug history archive could not be persisted safely.");
    this.name = "ModelSlugHistoryArchiveError";
    this.code = code;
    this.retrySameArtifact = code === "not_applied";
  }
}

const trustedFailureCodes = new WeakMap<
  object,
  ModelSlugHistoryArchiveErrorCode
>();

const staticFailure = (
  code: ModelSlugHistoryArchiveErrorCode,
): ModelSlugHistoryArchiveError => {
  const error = new ModelSlugHistoryArchiveError(code);
  trustedFailureCodes.set(error, code);
  return error;
};

const archiveProofBrand: unique symbol = Symbol("ModelSlugHistoryArchiveProof");
const trustedArchiveProofs = new WeakSet<object>();
const freshRollbackProofBrand: unique symbol = Symbol(
  "FreshModelSlugRollbackProof",
);

export type ModelSlugHistoryArchiveBucket = Pick<R2Bucket, "get" | "put">;
export type ModelSlugHistoryArchiveReadBucket = Pick<R2Bucket, "get">;

export type ModelSlugHistoryRollbackBase = Readonly<{
  manifest: TrustedImmutablePublicationManifest;
  resources: readonly ServingResourceClosureRow[];
}>;

export type ModelSlugHistoryRollbackFreshness = Readonly<{
  observedAtMs: number;
  maximumAgeMs: number;
}>;

export type TrustedModelSlugHistoryArchiveProof = Readonly<{
  artifactVersion: typeof MODEL_SLUG_HISTORY_ARTIFACT_VERSION;
  acquisitionVersion: typeof MODEL_SLUG_HISTORY_ACQUISITION_VERSION;
  publicationId: TrustedModelSlugHistoryCandidateCapture["publicationId"];
  baseBundleHash: Sha256;
  closureHash: Sha256;
  publicationBoundaryMs: number;
  artifactDigest: Sha256;
  artifactByteCount: number;
  projection: TrustedModelSlugProjection;
  readonly [archiveProofBrand]: true;
}>;

export type TrustedFreshModelSlugRollbackProof = Readonly<{
  archiveProof: TrustedModelSlugHistoryArchiveProof;
  observedAtMs: number;
  maximumAgeMs: number;
  readonly [freshRollbackProofBrand]: true;
}>;

const trustedFreshRollbackProofs = new WeakMap<
  object,
  ModelSlugHistoryRollbackFreshness &
    Readonly<{ archiveProof: TrustedModelSlugHistoryArchiveProof }>
>();

export const assertModelSlugHistoryArchiveProof: (
  value: unknown,
) => asserts value is TrustedModelSlugHistoryArchiveProof = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !trustedArchiveProofs.has(value) ||
    !(archiveProofBrand in value) ||
    value[archiveProofBrand] !== true
  )
    throw new TypeError("Model slug history archive proof is not trusted");
};

export const assertFreshModelSlugRollbackProof: (
  value: unknown,
) => asserts value is TrustedFreshModelSlugRollbackProof = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !trustedFreshRollbackProofs.has(value) ||
    !(freshRollbackProofBrand in value) ||
    value[freshRollbackProofBrand] !== true
  )
    throw new TypeError("Fresh Model slug rollback proof is not trusted");
};

export const readFreshModelSlugRollbackProof = (
  value: TrustedFreshModelSlugRollbackProof,
): ModelSlugHistoryRollbackFreshness &
  Readonly<{ archiveProof: TrustedModelSlugHistoryArchiveProof }> => {
  assertFreshModelSlugRollbackProof(value);
  const binding = trustedFreshRollbackProofs.get(value);
  if (binding === undefined)
    throw new TypeError("Fresh Model slug rollback proof is not trusted");
  return binding;
};

export const modelSlugHistoryArchiveKey = (digest: unknown): string => {
  if (typeof digest !== "string" || !SHA256.test(digest))
    throw staticFailure("configuration_invalid");
  return `${ARCHIVE_KEY_PREFIX}${digest.slice("sha256:".length)}.json`;
};

const ownDataRecordSnapshot = (
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw staticFailure("configuration_invalid");
    const prototype: unknown = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw staticFailure("configuration_invalid");
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string")
    )
      throw staticFailure("configuration_invalid");
    const expected = [...expectedKeys].sort();
    const actual = [...(keys as string[])].sort();
    const snapshot: Record<string, unknown> = {};
    for (let index = 0; index < expected.length; index += 1) {
      const key = expected[index];
      if (key === undefined || actual[index] !== key)
        throw staticFailure("configuration_invalid");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor?.enumerable !== true ||
        !("value" in descriptor) ||
        descriptor.writable === undefined
      )
        throw staticFailure("configuration_invalid");
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    throw staticFailure("configuration_invalid");
  }
};

const denseOwnDataArraySnapshot = (
  value: unknown,
  maximumItems: number,
): readonly unknown[] => {
  try {
    if (!Array.isArray(value)) throw staticFailure("configuration_invalid");
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length: unknown = lengthDescriptor?.value;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumItems
    )
      throw staticFailure("configuration_invalid");
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== length + 1 ||
      keys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" ||
            !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
            Number(key) >= length),
      )
    )
      throw staticFailure("configuration_invalid");
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor?.enumerable !== true || !("value" in descriptor))
        throw staticFailure("configuration_invalid");
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    throw staticFailure("configuration_invalid");
  }
};

const snapshotRollbackBase = (value: unknown): ModelSlugHistoryRollbackBase => {
  const record = ownDataRecordSnapshot(value, ["manifest", "resources"]);
  try {
    assertImmutablePublicationManifest(record.manifest);
  } catch {
    throw staticFailure("configuration_invalid");
  }
  const resources = denseOwnDataArraySnapshot(
    record.resources,
    MODEL_SLUG_MAX_MODELS,
  ).map((value) => {
    const resource = ownDataRecordSnapshot(value, [
      "content_hash",
      "resource_id",
      "resource_json",
      "resource_type",
    ]);
    if (
      resource.resource_type !== "model" ||
      typeof resource.resource_id !== "string" ||
      typeof resource.resource_json !== "string" ||
      typeof resource.content_hash !== "string"
    )
      throw staticFailure("configuration_invalid");
    return Object.freeze({
      resource_type: "model" as const,
      resource_id: resource.resource_id,
      resource_json: resource.resource_json,
      content_hash: resource.content_hash as Sha256,
    });
  });
  return Object.freeze({
    manifest: record.manifest,
    resources: Object.freeze(resources),
  });
};

const snapshotRollbackFreshness = (
  value: unknown,
): ModelSlugHistoryRollbackFreshness => {
  const record = ownDataRecordSnapshot(value, ["maximumAgeMs", "observedAtMs"]);
  const observedAtMs = record.observedAtMs;
  const maximumAgeMs = record.maximumAgeMs;
  if (
    typeof observedAtMs !== "number" ||
    !Number.isSafeInteger(observedAtMs) ||
    observedAtMs < 0 ||
    typeof maximumAgeMs !== "number" ||
    !Number.isSafeInteger(maximumAgeMs) ||
    maximumAgeMs < 0 ||
    !Number.isSafeInteger(observedAtMs + maximumAgeMs)
  )
    throw staticFailure("configuration_invalid");
  return Object.freeze({ observedAtMs, maximumAgeMs });
};

const artifactFromCandidate = (
  candidate: TrustedModelSlugHistoryCandidateCapture,
): ModelSlugHistoryArtifact => ({
  acquisition_version: candidate.acquisitionVersion,
  artifact_version: MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
  base_bundle_hash: candidate.bundleHash,
  canonical_guard_version: MODEL_SLUG_HISTORY_GUARD_VERSION,
  canonical_models: candidate.canonicalModels.map((model) => ({
    resource_id: model.resource_id,
    resource_type: "model" as const,
    slug: model.slug,
  })),
  closure_hash: candidate.closureHash,
  current_mapping_count: candidate.projection.currentMappingCount,
  historical_mapping_count: candidate.projection.historicalMappingCount,
  history_rows: candidate.historyRows.map((row) => ({
    resource_id: row.resource_id,
    resource_type: "model" as const,
    slug: row.slug,
    slug_history_id: row.slug_history_id,
    valid_from_ms: row.valid_from_ms,
    valid_to_ms: row.valid_to_ms,
  })),
  mapping_count: candidate.projection.mappingCount,
  mapping_inventory_hash: candidate.projection.mappingInventoryHash,
  model_count: candidate.projection.modelCount,
  projection_version: candidate.projection.projectionVersion,
  publication_boundary_ms: candidate.publicationBoundaryMs,
  publication_id: candidate.publicationId,
  source_history_count: candidate.projection.sourceHistoryCount,
  source_history_hash: candidate.projection.sourceHistoryHash,
});

/**
 * The object property order is the artifact's canonical JSON order. The closed
 * contract admits only ASCII strings and safe integers, so JSON.stringify has
 * one deterministic UTF-8 representation for an accepted artifact.
 */
const serializeArtifact = (artifact: ModelSlugHistoryArtifact): string =>
  JSON.stringify({
    artifact_version: artifact.artifact_version,
    acquisition_version: artifact.acquisition_version,
    canonical_guard_version: artifact.canonical_guard_version,
    projection_version: artifact.projection_version,
    publication_id: artifact.publication_id,
    closure_hash: artifact.closure_hash,
    base_bundle_hash: artifact.base_bundle_hash,
    publication_boundary_ms: artifact.publication_boundary_ms,
    canonical_models: artifact.canonical_models.map((model) => ({
      resource_id: model.resource_id,
      resource_type: model.resource_type,
      slug: model.slug,
    })),
    history_rows: artifact.history_rows.map((row) => ({
      slug_history_id: row.slug_history_id,
      resource_id: row.resource_id,
      resource_type: row.resource_type,
      slug: row.slug,
      valid_from_ms: row.valid_from_ms,
      valid_to_ms: row.valid_to_ms,
    })),
    model_count: artifact.model_count,
    source_history_count: artifact.source_history_count,
    source_history_hash: artifact.source_history_hash,
    mapping_count: artifact.mapping_count,
    current_mapping_count: artifact.current_mapping_count,
    historical_mapping_count: artifact.historical_mapping_count,
    mapping_inventory_hash: artifact.mapping_inventory_hash,
  });

const admitsRetainedHeap = (
  candidate: TrustedModelSlugHistoryCandidateCapture,
  artifactByteCount: number,
): boolean => {
  let estimate =
    RETAINED_HEAP_FIXED_RESERVE +
    artifactByteCount * RETAINED_HEAP_ARTIFACT_MULTIPLIER;
  const add = (bytes: number): boolean => {
    estimate += bytes;
    return (
      Number.isSafeInteger(estimate) &&
      estimate <= MODEL_SLUG_HISTORY_ARCHIVE_RETAINED_HEAP_BUDGET
    );
  };
  const addString = (value: string): boolean => add(value.length * 2);
  const addRow = (...values: readonly string[]): boolean =>
    add(RETAINED_HEAP_OBJECT_OVERHEAD) && values.every(addString);

  if (
    !Number.isSafeInteger(estimate) ||
    estimate > MODEL_SLUG_HISTORY_ARCHIVE_RETAINED_HEAP_BUDGET
  )
    return false;
  for (const id of candidate.modelIds) if (!addRow(id)) return false;
  for (const model of candidate.canonicalModels)
    if (!addRow(model.resource_id, model.resource_type, model.slug))
      return false;
  for (const row of candidate.historyRows)
    if (
      !addRow(row.slug_history_id, row.resource_id, row.resource_type, row.slug)
    )
      return false;
  for (const resource of candidate.resources)
    if (
      !addRow(
        resource.resource_id,
        resource.resource_type,
        resource.resource_json,
        resource.content_hash,
      )
    )
      return false;
  for (const resource of candidate.manifest.resources)
    if (
      !addRow(resource.resourceId, resource.resourceType, resource.contentHash)
    )
      return false;
  if (
    !addRow(
      candidate.manifest.contractVersion,
      candidate.manifest.publicationId,
      candidate.manifest.sourceRunId,
      candidate.manifest.parentPublicationId ?? "",
      candidate.manifest.generatedAt,
      candidate.manifest.enabledProviderScopeVersion,
      candidate.manifest.bundleHash,
      candidate.manifest.resourceInventoryHash,
      candidate.manifest.exactSearchInventoryHash,
      candidate.manifest.vectorInventoryHash,
      candidate.manifest.enabledProviderScopeHash,
      candidate.manifest.providerSliceHash,
      candidate.manifest.providerAttributionHash,
      candidate.manifest.chunkRootHash,
      candidate.manifest.closureHash,
      candidate.manifest.versions.schema,
      candidate.manifest.versions.methodology,
      candidate.manifest.versions.precisionNormalization,
      candidate.manifest.versions.precisionDisplayOrder,
      candidate.manifest.versions.pricePolicy,
      candidate.manifest.versions.sourcePolicy,
      candidate.manifest.versions.embedding,
      candidate.manifest.versions.buildCommit,
    )
  )
    return false;
  for (const providerId of candidate.manifest.enabledProviderIds)
    if (!addRow(providerId)) return false;
  for (const slice of candidate.manifest.providerSlices)
    if (
      !addRow(
        slice.providerId,
        slice.providerSliceId ?? "",
        slice.providerRunId,
        slice.adapterVersion,
        slice.rosterVersion,
        slice.sourceRegisterVersion,
        slice.freshnessState,
      )
    )
      return false;
  for (const attribution of candidate.manifest.providerAttributions)
    if (
      !addRow(
        attribution.resourceType,
        attribution.resourceId,
        attribution.providerId,
      )
    )
      return false;
  for (const document of candidate.manifest.searchDocuments)
    if (
      !addRow(
        document.resourceType,
        document.resourceId,
        document.documentId,
        document.contentHash,
      )
    )
      return false;
  for (const vector of candidate.manifest.vectors)
    if (
      !addRow(
        vector.resourceType,
        vector.resourceId,
        vector.vectorId,
        vector.searchDocumentContentHash,
        vector.embeddingInputHash,
      )
    )
      return false;
  for (const chunk of candidate.manifest.chunks)
    if (!addRow(chunk.kind, chunk.firstKey, chunk.lastKey, chunk.contentHash))
      return false;
  for (const mapping of candidate.projection.mappings)
    if (
      !addRow(
        mapping.projectionVersion,
        mapping.slug,
        mapping.modelId,
        mapping.resolution,
        mapping.targetContentHash,
      )
    )
      return false;
  return estimate <= MODEL_SLUG_HISTORY_ARCHIVE_RETAINED_HEAP_BUDGET;
};

const admitsRollbackRetainedHeap = (
  base: ModelSlugHistoryRollbackBase,
  expected: ModelSlugArchiveArtifactProofV5,
): boolean => {
  let estimate =
    RETAINED_HEAP_FIXED_RESERVE +
    expected.artifact_byte_count * RETAINED_HEAP_ARTIFACT_MULTIPLIER;
  const add = (bytes: number): boolean => {
    estimate += bytes;
    return (
      Number.isSafeInteger(estimate) &&
      estimate <= MODEL_SLUG_HISTORY_ARCHIVE_RETAINED_HEAP_BUDGET
    );
  };
  const addString = (value: string): boolean => add(value.length * 2);
  const addRow = (...values: readonly string[]): boolean =>
    add(RETAINED_HEAP_OBJECT_OVERHEAD) && values.every(addString);

  if (
    !Number.isSafeInteger(estimate) ||
    estimate > MODEL_SLUG_HISTORY_ARCHIVE_RETAINED_HEAP_BUDGET
  )
    return false;
  for (const resource of base.resources)
    if (
      !addRow(
        resource.resource_id,
        resource.resource_type,
        resource.resource_json,
        resource.content_hash,
      )
    )
      return false;
  const manifest = base.manifest;
  if (
    !addRow(
      manifest.contractVersion,
      manifest.publicationId,
      manifest.sourceRunId,
      manifest.parentPublicationId ?? "",
      manifest.generatedAt,
      manifest.enabledProviderScopeVersion,
      manifest.bundleHash,
      manifest.resourceInventoryHash,
      manifest.exactSearchInventoryHash,
      manifest.vectorInventoryHash,
      manifest.enabledProviderScopeHash,
      manifest.providerSliceHash,
      manifest.providerAttributionHash,
      manifest.chunkRootHash,
      manifest.closureHash,
      manifest.versions.schema,
      manifest.versions.methodology,
      manifest.versions.precisionNormalization,
      manifest.versions.precisionDisplayOrder,
      manifest.versions.pricePolicy,
      manifest.versions.sourcePolicy,
      manifest.versions.embedding,
      manifest.versions.buildCommit,
    )
  )
    return false;
  for (const providerId of manifest.enabledProviderIds)
    if (!addRow(providerId)) return false;
  for (const slice of manifest.providerSlices)
    if (
      !addRow(
        slice.providerId,
        slice.providerSliceId ?? "",
        slice.providerRunId,
        slice.adapterVersion,
        slice.rosterVersion,
        slice.sourceRegisterVersion,
        slice.freshnessState,
      )
    )
      return false;
  for (const attribution of manifest.providerAttributions)
    if (
      !addRow(
        attribution.resourceType,
        attribution.resourceId,
        attribution.providerId,
      )
    )
      return false;
  for (const resource of manifest.resources)
    if (
      !addRow(resource.resourceType, resource.resourceId, resource.contentHash)
    )
      return false;
  for (const document of manifest.searchDocuments)
    if (
      !addRow(
        document.resourceType,
        document.resourceId,
        document.documentId,
        document.contentHash,
      )
    )
      return false;
  for (const vector of manifest.vectors)
    if (
      !addRow(
        vector.resourceType,
        vector.resourceId,
        vector.vectorId,
        vector.searchDocumentContentHash,
        vector.embeddingInputHash,
      )
    )
      return false;
  for (const chunk of manifest.chunks)
    if (!addRow(chunk.kind, chunk.firstKey, chunk.lastKey, chunk.contentHash))
      return false;
  return (
    addRow(
      expected.publication_id,
      expected.closure_hash,
      expected.base_bundle_hash,
      expected.artifact_version,
      expected.acquisition_version,
      expected.projection_version,
      expected.artifact_digest,
      expected.source_history_hash,
      expected.mapping_inventory_hash,
    ) && estimate <= MODEL_SLUG_HISTORY_ARCHIVE_RETAINED_HEAP_BUDGET
  );
};

const conservativeArtifactByteUpperBound = (
  candidate: TrustedModelSlugHistoryCandidateCapture,
): number => {
  const estimate =
    4_096 +
    candidate.canonicalModels.length * 512 +
    candidate.historyRows.length * 768;
  return Number.isSafeInteger(estimate)
    ? estimate
    : MODEL_SLUG_HISTORY_ARCHIVE_RETAINED_HEAP_BUDGET;
};

const digestBytes = async (
  bytes: Uint8Array,
): Promise<Readonly<{ digest: Sha256; raw: ArrayBuffer }>> => {
  const raw = await crypto.subtle.digest("SHA-256", bytes);
  const encoded = `sha256:${[...new Uint8Array(raw)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
  if (!SHA256.test(encoded)) throw staticFailure("integrity_failure");
  const digest = encoded as Sha256;
  return Object.freeze({ digest, raw });
};

interface DigestAccumulator {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<Readonly<{ digest: Sha256; raw: ArrayBuffer }>>;
}

type DigestStreamConstructor = new (algorithm: string) => {
  readonly digest: Promise<ArrayBuffer>;
  getWriter(): WritableStreamDefaultWriter<ArrayBuffer | ArrayBufferView>;
};

const digestResult = (
  raw: ArrayBuffer,
): Readonly<{
  digest: Sha256;
  raw: ArrayBuffer;
}> => {
  const encoded = `sha256:${[...new Uint8Array(raw)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
  if (!SHA256.test(encoded)) throw staticFailure("integrity_failure");
  return Object.freeze({ digest: encoded as Sha256, raw });
};

const createDigestAccumulator = (): DigestAccumulator => {
  const unknownConstructor: unknown = Reflect.get(crypto, "DigestStream");
  if (typeof unknownConstructor === "function") {
    const stream = new (unknownConstructor as DigestStreamConstructor)(
      "SHA-256",
    );
    const writer = stream.getWriter();
    let finished = false;
    return {
      write(chunk) {
        if (finished) return Promise.reject(staticFailure("integrity_failure"));
        return writer.write(chunk);
      },
      async finish() {
        if (finished) throw staticFailure("integrity_failure");
        finished = true;
        await writer.close();
        return digestResult(await stream.digest);
      },
    };
  }

  // Node's unit-test Web Crypto lacks Workers DigestStream. Production is
  // pinned-workerd tested and always takes the bounded streaming branch above.
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  let finished = false;
  return {
    write(chunk) {
      if (finished) return Promise.reject(staticFailure("integrity_failure"));
      total += chunk.byteLength;
      if (
        !Number.isSafeInteger(total) ||
        total >
          MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES +
            ARTIFACT_DIGEST_DOMAIN.byteLength
      )
        return Promise.reject(staticFailure("integrity_failure"));
      chunks.push(Uint8Array.from(chunk));
      return Promise.resolve();
    },
    async finish() {
      if (finished) throw staticFailure("integrity_failure");
      finished = true;
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return digestBytes(bytes);
    },
  };
};

const digestArtifact = async (
  body: Uint8Array,
): Promise<Readonly<{ digest: Sha256; raw: ArrayBuffer }>> => {
  const accumulator = createDigestAccumulator();
  await accumulator.write(ARTIFACT_DIGEST_DOMAIN);
  await accumulator.write(body);
  return accumulator.finish();
};

const equalBytes = (
  left: ArrayBuffer | ArrayBufferView,
  right: Uint8Array,
): boolean => {
  const candidate = ArrayBuffer.isView(left)
    ? new Uint8Array(left.buffer, left.byteOffset, left.byteLength)
    : new Uint8Array(left);
  if (candidate.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < right.byteLength; index += 1) {
    const leftByte = candidate[index];
    const rightByte = right[index];
    if (leftByte === undefined || rightByte === undefined) return false;
    difference |= leftByte ^ rightByte;
  }
  return difference === 0;
};

const exactStringMetadata = (
  value: unknown,
  expected: Readonly<Record<string, string>>,
): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype: unknown = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  const expectedKeys = Object.keys(expected).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string")
  )
    return false;
  const actualKeys = [...(keys as string[])].sort();
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys.at(index);
    if (key === undefined) return false;
    if (actualKeys[index] !== key) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor?.enumerable !== true ||
      !("value" in descriptor) ||
      descriptor.value !== expected[key]
    )
      return false;
  }
  return true;
};

const exactHttpMetadata = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype: unknown = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const expected: Readonly<Record<string, string | undefined>> = {
    cacheControl: "private, no-store",
    cacheExpiry: undefined,
    contentDisposition: undefined,
    contentEncoding: undefined,
    contentLanguage: undefined,
    contentType: MODEL_SLUG_HISTORY_ARCHIVE_CONTENT_TYPE,
  };
  const keys = Reflect.ownKeys(value);
  const expectedKeys = Object.keys(expected).sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string")
  )
    return false;
  const actualKeys = [...(keys as string[])].sort();
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys.at(index);
    if (key === undefined) return false;
    if (actualKeys[index] !== key) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor?.enumerable !== true ||
      !("value" in descriptor) ||
      descriptor.value !== expected[key]
    )
      return false;
  }
  return true;
};

const readAndHashBoundedBody = async (
  object: R2ObjectBody,
  expectedBytes: Uint8Array,
  expectedBodyDigest: Sha256,
  expectedArtifactDigest: Sha256,
  maximumBytes: number,
): Promise<string> => {
  const size = object.size;
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > maximumBytes ||
    size !== expectedBytes.byteLength
  )
    throw staticFailure("integrity_failure");
  const reader = object.body.getReader();
  const decoder = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false,
  });
  const textParts: string[] = [];
  const rawDigest = createDigestAccumulator();
  const artifactDigest = createDigestAccumulator();
  let total = 0;
  let chunkCount = 0;
  try {
    await artifactDigest.write(ARTIFACT_DIGEST_DOMAIN);
    let reading = true;
    while (reading) {
      const result = await reader.read();
      if (result.done) {
        reading = false;
        continue;
      }
      const chunk: unknown = result.value as unknown;
      if (!(chunk instanceof Uint8Array))
        throw staticFailure("integrity_failure");
      chunkCount += 1;
      if (
        chunk.byteLength === 0 ||
        !Number.isSafeInteger(chunkCount) ||
        chunkCount > MAX_ARCHIVE_STREAM_CHUNKS
      )
        throw staticFailure("integrity_failure");
      const nextTotal = total + chunk.byteLength;
      if (
        !Number.isSafeInteger(nextTotal) ||
        nextTotal > maximumBytes ||
        nextTotal > size
      )
        throw staticFailure("integrity_failure");
      for (let index = 0; index < chunk.byteLength; index += 1) {
        const observed = chunk[index];
        const expected = expectedBytes[total + index];
        if (
          observed === undefined ||
          expected === undefined ||
          observed !== expected
        )
          throw staticFailure("conflict");
      }
      await Promise.all([rawDigest.write(chunk), artifactDigest.write(chunk)]);
      textParts.push(decoder.decode(chunk, { stream: true }));
      total = nextTotal;
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The static archive failure below remains the only exposed detail.
    }
    if (typeof error === "object" && error !== null) {
      const code = trustedFailureCodes.get(error);
      if (code !== undefined) throw staticFailure(code);
    }
    throw staticFailure("integrity_failure");
  }
  if (total !== size) throw staticFailure("integrity_failure");
  let trailingText: string;
  try {
    trailingText = decoder.decode();
  } catch {
    throw staticFailure("integrity_failure");
  }
  if (trailingText !== "") textParts.push(trailingText);
  let observedBodyDigest: Readonly<{ digest: Sha256; raw: ArrayBuffer }>;
  let observedArtifactDigest: Readonly<{ digest: Sha256; raw: ArrayBuffer }>;
  try {
    [observedBodyDigest, observedArtifactDigest] = await Promise.all([
      rawDigest.finish(),
      artifactDigest.finish(),
    ]);
  } catch {
    throw staticFailure("integrity_failure");
  }
  if (
    observedBodyDigest.digest !== expectedBodyDigest ||
    observedArtifactDigest.digest !== expectedArtifactDigest
  )
    throw staticFailure("integrity_failure");
  return textParts.join("");
};

const projectionMatches = (
  left: TrustedModelSlugProjection,
  right: TrustedModelSlugProjection,
): boolean =>
  left.publicationId === right.publicationId &&
  left.closureHash === right.closureHash &&
  left.publicationBoundaryMs === right.publicationBoundaryMs &&
  left.modelCount === right.modelCount &&
  left.sourceHistoryCount === right.sourceHistoryCount &&
  left.sourceHistoryHash === right.sourceHistoryHash &&
  left.mappingCount === right.mappingCount &&
  left.currentMappingCount === right.currentMappingCount &&
  left.historicalMappingCount === right.historicalMappingCount &&
  left.mappingInventoryHash === right.mappingInventoryHash &&
  JSON.stringify(left.mappings) === JSON.stringify(right.mappings);

const verifyArchiveObject = async (
  object: R2ObjectBody,
  key: string,
  expectedBytes: Uint8Array,
  expectedBodyDigest: Sha256,
  expectedBodyRaw: ArrayBuffer,
  expectedArtifactDigest: Sha256,
): Promise<string> => {
  const expectedCustomMetadata = {
    "artifact-format": MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
    "body-sha256": expectedBodyDigest,
    "retention-class": MODEL_SLUG_HISTORY_ARCHIVE_RETENTION_CLASS,
  };
  const httpMetadata = object.httpMetadata;
  if (
    object.key !== key ||
    !exactStringMetadata(object.customMetadata, expectedCustomMetadata) ||
    !exactHttpMetadata(httpMetadata)
  )
    throw staticFailure("integrity_failure");
  const checksum = object.checksums.sha256;
  if (!(checksum instanceof ArrayBuffer))
    throw staticFailure("integrity_failure");
  if (!equalBytes(checksum, new Uint8Array(expectedBodyRaw)))
    throw staticFailure("integrity_failure");

  const text = await readAndHashBoundedBody(
    object,
    expectedBytes,
    expectedBodyDigest,
    expectedArtifactDigest,
    MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES,
  );
  if (modelSlugHistoryArchiveKey(expectedArtifactDigest) !== key)
    throw staticFailure("integrity_failure");
  return text;
};

const verifyArtifactMeaning = async (
  text: string,
  candidate: TrustedModelSlugHistoryCandidateCapture,
): Promise<TrustedModelSlugProjection> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw staticFailure("integrity_failure");
  }
  if (!checkModelSlugHistoryArtifactContract(parsed))
    throw staticFailure("integrity_failure");
  const artifact = parsed;
  if (serializeArtifact(artifact) !== text)
    throw staticFailure("integrity_failure");

  if (
    artifact.publication_id !== candidate.publicationId ||
    artifact.base_bundle_hash !== candidate.bundleHash ||
    artifact.closure_hash !== candidate.closureHash ||
    artifact.publication_boundary_ms !== candidate.publicationBoundaryMs ||
    artifact.model_count !== candidate.projection.modelCount ||
    artifact.source_history_count !== candidate.projection.sourceHistoryCount ||
    artifact.source_history_hash !== candidate.projection.sourceHistoryHash ||
    artifact.mapping_count !== candidate.projection.mappingCount ||
    artifact.current_mapping_count !==
      candidate.projection.currentMappingCount ||
    artifact.historical_mapping_count !==
      candidate.projection.historicalMappingCount ||
    artifact.mapping_inventory_hash !==
      candidate.projection.mappingInventoryHash ||
    artifact.canonical_models.length !== candidate.canonicalModels.length ||
    artifact.history_rows.length !== candidate.historyRows.length ||
    artifact.canonical_models.some((model, index) => {
      const expected = candidate.canonicalModels[index];
      return (
        model.resource_id !== expected?.resource_id ||
        model.slug !== expected.slug
      );
    }) ||
    artifact.history_rows.some((row, index) => {
      const expected = candidate.historyRows[index];
      return (
        row.slug_history_id !== expected?.slug_history_id ||
        row.resource_id !== expected.resource_id ||
        row.slug !== expected.slug ||
        row.valid_from_ms !== expected.valid_from_ms ||
        row.valid_to_ms !== expected.valid_to_ms
      );
    })
  )
    throw staticFailure("conflict");
  let replayed: TrustedModelSlugProjection;
  try {
    replayed = await projectModelSlugProjection({
      manifest: candidate.manifest,
      resources: candidate.resources,
      historyRows: artifact.history_rows,
    });
    assertModelSlugProjection(replayed);
  } catch {
    throw staticFailure("integrity_failure");
  }
  if (!projectionMatches(replayed, candidate.projection))
    throw staticFailure("conflict");
  return replayed;
};

const compareAscii = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

const compareArchivedHistoryRows = (
  left: ModelSlugHistoryArtifact["history_rows"][number],
  right: ModelSlugHistoryArtifact["history_rows"][number],
): number => {
  const modelOrder = compareAscii(left.resource_id, right.resource_id);
  if (modelOrder !== 0) return modelOrder;
  if (left.valid_from_ms !== right.valid_from_ms)
    return left.valid_from_ms < right.valid_from_ms ? -1 : 1;
  if (left.valid_to_ms !== right.valid_to_ms) {
    if (left.valid_to_ms === null) return 1;
    if (right.valid_to_ms === null) return -1;
    return left.valid_to_ms < right.valid_to_ms ? -1 : 1;
  }
  const slugOrder = compareAscii(left.slug, right.slug);
  return slugOrder === 0
    ? compareAscii(left.slug_history_id, right.slug_history_id)
    : slugOrder;
};

const verifyRollbackArtifactMeaning = async (
  text: string,
  base: ModelSlugHistoryRollbackBase,
  expected: ModelSlugArchiveArtifactProofV5,
): Promise<TrustedModelSlugProjection> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw staticFailure("integrity_failure");
  }
  if (!checkModelSlugHistoryArtifactContract(parsed))
    throw staticFailure("integrity_failure");
  const artifact = parsed;
  if (
    serializeArtifact(artifact) !== text ||
    artifact.publication_id !== expected.publication_id ||
    artifact.closure_hash !== expected.closure_hash ||
    artifact.base_bundle_hash !== expected.base_bundle_hash ||
    artifact.publication_boundary_ms !== expected.publication_boundary_ms ||
    artifact.model_count !== expected.model_count ||
    artifact.source_history_count !== expected.source_history_count ||
    artifact.source_history_hash !== expected.source_history_hash ||
    artifact.mapping_count !== expected.mapping_count ||
    artifact.current_mapping_count !== expected.current_mapping_count ||
    artifact.historical_mapping_count !== expected.historical_mapping_count ||
    artifact.mapping_inventory_hash !== expected.mapping_inventory_hash
  )
    throw staticFailure("integrity_failure");
  for (let index = 1; index < artifact.canonical_models.length; index += 1) {
    const previous = artifact.canonical_models[index - 1];
    const current = artifact.canonical_models[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareAscii(previous.resource_id, current.resource_id) >= 0
    )
      throw staticFailure("integrity_failure");
  }
  for (let index = 1; index < artifact.history_rows.length; index += 1) {
    const previous = artifact.history_rows[index - 1];
    const current = artifact.history_rows[index];
    if (
      previous === undefined ||
      current === undefined ||
      compareArchivedHistoryRows(previous, current) >= 0
    )
      throw staticFailure("integrity_failure");
  }
  let replayed: TrustedModelSlugProjection;
  try {
    replayed = await projectModelSlugProjection({
      manifest: base.manifest,
      resources: base.resources,
      historyRows: artifact.history_rows,
    });
    assertModelSlugProjection(replayed);
  } catch {
    throw staticFailure("integrity_failure");
  }
  if (
    replayed.publicationId !== expected.publication_id ||
    replayed.closureHash !== expected.closure_hash ||
    replayed.publicationBoundaryMs !== expected.publication_boundary_ms ||
    replayed.modelCount !== expected.model_count ||
    replayed.sourceHistoryCount !== expected.source_history_count ||
    replayed.sourceHistoryHash !== expected.source_history_hash ||
    replayed.mappingCount !== expected.mapping_count ||
    replayed.currentMappingCount !== expected.current_mapping_count ||
    replayed.historicalMappingCount !== expected.historical_mapping_count ||
    replayed.mappingInventoryHash !== expected.mapping_inventory_hash
  )
    throw staticFailure("integrity_failure");
  const currentMappings = replayed.mappings.filter(
    (mapping) => mapping.resolution === "current",
  );
  const currentByModel = new Map(
    currentMappings.map((mapping) => [mapping.modelId, mapping.slug]),
  );
  if (
    currentByModel.size !== artifact.canonical_models.length ||
    artifact.canonical_models.some(
      (model) => currentByModel.get(model.resource_id) !== model.slug,
    )
  )
    throw staticFailure("integrity_failure");
  return replayed;
};

const readRollbackObject = async (
  bucket: ModelSlugHistoryArchiveReadBucket,
  expected: ModelSlugArchiveArtifactProofV5,
): Promise<string> => {
  const key = modelSlugHistoryArchiveKey(expected.artifact_digest);
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch {
    throw staticFailure("outcome_unknown");
  }
  if (object === null) throw staticFailure("integrity_failure");
  if (
    object.key !== key ||
    !Number.isSafeInteger(object.size) ||
    object.size !== expected.artifact_byte_count ||
    object.size < 1 ||
    object.size > MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES ||
    !exactHttpMetadata(object.httpMetadata)
  )
    throw staticFailure("integrity_failure");

  const reader = object.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const textParts: string[] = [];
  const rawDigest = createDigestAccumulator();
  const artifactDigest = createDigestAccumulator();
  const prefix: number[] = [];
  let total = 0;
  let chunkCount = 0;
  try {
    await artifactDigest.write(ARTIFACT_DIGEST_DOMAIN);
    let reading = true;
    while (reading) {
      const result = await reader.read();
      if (result.done) {
        reading = false;
        continue;
      }
      const chunk: unknown = result.value as unknown;
      if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0)
        throw staticFailure("integrity_failure");
      chunkCount += 1;
      const nextTotal = total + chunk.byteLength;
      if (
        !Number.isSafeInteger(chunkCount) ||
        chunkCount > MAX_ARCHIVE_STREAM_CHUNKS ||
        !Number.isSafeInteger(nextTotal) ||
        nextTotal > object.size ||
        nextTotal > MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES
      )
        throw staticFailure("integrity_failure");
      for (
        let index = 0;
        index < chunk.byteLength && prefix.length < 3;
        index += 1
      ) {
        const value = chunk[index];
        if (value === undefined) throw staticFailure("integrity_failure");
        prefix.push(value);
      }
      if (
        prefix.length === 3 &&
        prefix[0] === 0xef &&
        prefix[1] === 0xbb &&
        prefix[2] === 0xbf
      )
        throw staticFailure("integrity_failure");
      await Promise.all([rawDigest.write(chunk), artifactDigest.write(chunk)]);
      textParts.push(decoder.decode(chunk, { stream: true }));
      total = nextTotal;
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the static verifier failure below.
    }
    if (typeof error === "object" && error !== null) {
      const code = trustedFailureCodes.get(error);
      if (code !== undefined) throw staticFailure(code);
    }
    throw staticFailure("integrity_failure");
  }
  if (total !== object.size) throw staticFailure("integrity_failure");
  let trailingText: string;
  try {
    trailingText = decoder.decode();
  } catch {
    throw staticFailure("integrity_failure");
  }
  if (trailingText !== "") textParts.push(trailingText);
  let observedBody: Readonly<{ digest: Sha256; raw: ArrayBuffer }>;
  let observedArtifact: Readonly<{ digest: Sha256; raw: ArrayBuffer }>;
  try {
    [observedBody, observedArtifact] = await Promise.all([
      rawDigest.finish(),
      artifactDigest.finish(),
    ]);
  } catch {
    throw staticFailure("integrity_failure");
  }
  if (observedArtifact.digest !== expected.artifact_digest)
    throw staticFailure("integrity_failure");
  if (
    !exactStringMetadata(object.customMetadata, {
      "artifact-format": MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
      "body-sha256": observedBody.digest,
      "retention-class": MODEL_SLUG_HISTORY_ARCHIVE_RETENTION_CLASS,
    })
  )
    throw staticFailure("integrity_failure");
  const checksum = object.checksums.sha256;
  if (
    !(checksum instanceof ArrayBuffer) ||
    !equalBytes(checksum, new Uint8Array(observedBody.raw))
  )
    throw staticFailure("integrity_failure");
  return textParts.join("");
};

const readAndVerify = async (
  bucket: ModelSlugHistoryArchiveBucket,
  key: string,
  bytes: Uint8Array,
  bodyDigest: Sha256,
  bodyRaw: ArrayBuffer,
  artifactDigest: Sha256,
): Promise<string | null> => {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch {
    throw staticFailure("outcome_unknown");
  }
  if (object === null) return null;
  try {
    return await verifyArchiveObject(
      object,
      key,
      bytes,
      bodyDigest,
      bodyRaw,
      artifactDigest,
    );
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      const code = trustedFailureCodes.get(error);
      if (code !== undefined) throw staticFailure(code);
    }
    throw staticFailure("integrity_failure");
  }
};

interface PreparedModelSlugHistoryArchive {
  bytes: Uint8Array;
  byteCount: number;
  bodyHash: Readonly<{ digest: Sha256; raw: ArrayBuffer }>;
  artifactHash: Readonly<{ digest: Sha256; raw: ArrayBuffer }>;
}

const prepareArchive = async (
  candidate: TrustedModelSlugHistoryCandidateCapture,
): Promise<PreparedModelSlugHistoryArchive> => {
  if (
    !admitsRetainedHeap(
      candidate,
      conservativeArtifactByteUpperBound(candidate),
    )
  )
    throw staticFailure("integrity_failure");
  const artifact = artifactFromCandidate(candidate);
  if (!checkModelSlugHistoryArtifactContract(artifact))
    throw staticFailure("integrity_failure");
  const bytes = utf8.encode(serializeArtifact(artifact));
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES ||
    !admitsRetainedHeap(candidate, bytes.byteLength)
  )
    throw staticFailure("integrity_failure");
  let bodyHash: Readonly<{ digest: Sha256; raw: ArrayBuffer }>;
  let artifactHash: Readonly<{ digest: Sha256; raw: ArrayBuffer }>;
  try {
    [bodyHash, artifactHash] = await Promise.all([
      digestBytes(bytes),
      digestArtifact(bytes),
    ]);
  } catch {
    throw staticFailure("integrity_failure");
  }
  return Object.freeze({
    bytes,
    byteCount: bytes.byteLength,
    bodyHash,
    artifactHash,
  });
};

interface ReadVerifiedModelSlugHistoryArchive {
  text: string;
  artifactDigest: Sha256;
  artifactByteCount: number;
}

const persistAndReadArchive = async (
  bucket: ModelSlugHistoryArchiveBucket,
  prepared: PreparedModelSlugHistoryArchive,
): Promise<ReadVerifiedModelSlugHistoryArchive> => {
  const key = modelSlugHistoryArchiveKey(prepared.artifactHash.digest);
  let putCompleted = false;
  let putWasConditionalConflict = false;
  try {
    const result = await bucket.put(key, prepared.bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: prepared.bodyHash.raw,
      httpMetadata: {
        contentType: MODEL_SLUG_HISTORY_ARCHIVE_CONTENT_TYPE,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        "artifact-format": MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
        "body-sha256": prepared.bodyHash.digest,
        "retention-class": MODEL_SLUG_HISTORY_ARCHIVE_RETENTION_CLASS,
      },
    });
    putCompleted = result !== null;
    putWasConditionalConflict = result === null;
  } catch {
    // A thrown write is ambiguous and is reconciled through the exact key.
  }

  let archivedText: string | null;
  try {
    archivedText = await readAndVerify(
      bucket,
      key,
      prepared.bytes,
      prepared.bodyHash.digest,
      prepared.bodyHash.raw,
      prepared.artifactHash.digest,
    );
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      const code = trustedFailureCodes.get(error);
      if (code !== undefined) throw staticFailure(code);
    }
    throw staticFailure("outcome_unknown");
  }
  if (archivedText === null) {
    if (!putCompleted && !putWasConditionalConflict)
      throw staticFailure("not_applied");
    throw staticFailure("outcome_unknown");
  }
  return Object.freeze({
    text: archivedText,
    artifactDigest: prepared.artifactHash.digest,
    artifactByteCount: prepared.byteCount,
  });
};

const mintArchiveProof = (input: {
  artifactDigest: Sha256;
  artifactByteCount: number;
  publicationId: TrustedModelSlugHistoryArchiveProof["publicationId"];
  baseBundleHash: Sha256;
  closureHash: Sha256;
  publicationBoundaryMs: number;
  projection: TrustedModelSlugProjection;
}): TrustedModelSlugHistoryArchiveProof => {
  const proof = {
    artifactVersion: MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
    acquisitionVersion: MODEL_SLUG_HISTORY_ACQUISITION_VERSION,
    publicationId: input.publicationId,
    baseBundleHash: input.baseBundleHash,
    closureHash: input.closureHash,
    publicationBoundaryMs: input.publicationBoundaryMs,
    artifactDigest: input.artifactDigest,
    artifactByteCount: input.artifactByteCount,
    projection: input.projection,
  };
  Object.defineProperty(proof, archiveProofBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedArchiveProofs.add(proof);
  return Object.freeze(proof) as TrustedModelSlugHistoryArchiveProof;
};

const mintFreshRollbackProof = (
  archiveProof: TrustedModelSlugHistoryArchiveProof,
  freshness: ModelSlugHistoryRollbackFreshness,
): TrustedFreshModelSlugRollbackProof => {
  assertModelSlugHistoryArchiveProof(archiveProof);
  const binding = Object.freeze({
    archiveProof,
    observedAtMs: freshness.observedAtMs,
    maximumAgeMs: freshness.maximumAgeMs,
  });
  const proof = { ...binding };
  Object.defineProperty(proof, freshRollbackProofBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedFreshRollbackProofs.set(proof, binding);
  return Object.freeze(proof) as TrustedFreshModelSlugRollbackProof;
};

/**
 * Re-verifies one already-authorized sidecar for rollback. The protected
 * nominal expected digest is the only address authority. This operation has
 * no R2 write/list/delete capability and never consults canonical D1.
 */
export const verifyArchivedModelSlugHistoryForRollback = async (
  bucket: ModelSlugHistoryArchiveReadBucket,
  callerBase: ModelSlugHistoryRollbackBase,
  expected: ModelSlugArchiveArtifactProofV5,
  freshnessValue: ModelSlugHistoryRollbackFreshness,
): Promise<TrustedFreshModelSlugRollbackProof> => {
  let freshness: ModelSlugHistoryRollbackFreshness;
  let base: ModelSlugHistoryRollbackBase;
  try {
    freshness = snapshotRollbackFreshness(freshnessValue);
    assertModelSlugArchiveArtifactProofV5(expected);
    base = snapshotRollbackBase(callerBase);
  } catch {
    throw staticFailure("configuration_invalid");
  }
  const boundaryMs = Date.parse(base.manifest.generatedAt);
  let manifestModelCount = 0;
  for (const resource of base.manifest.resources)
    if (resource.resourceType === "model") manifestModelCount += 1;
  if (
    base.manifest.publicationId !== expected.publication_id ||
    base.manifest.closureHash !== expected.closure_hash ||
    base.manifest.bundleHash !== expected.base_bundle_hash ||
    !Number.isSafeInteger(boundaryMs) ||
    boundaryMs !== expected.publication_boundary_ms ||
    manifestModelCount !== expected.model_count ||
    base.resources.length !== expected.model_count ||
    !admitsRollbackRetainedHeap(base, expected)
  )
    throw staticFailure("integrity_failure");

  let text: string;
  let replayed: TrustedModelSlugProjection;
  try {
    text = await readRollbackObject(bucket, expected);
    replayed = await verifyRollbackArtifactMeaning(text, base, expected);
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      const code = trustedFailureCodes.get(error);
      if (code !== undefined) throw staticFailure(code);
    }
    throw staticFailure("integrity_failure");
  }
  const archiveProof = mintArchiveProof({
    artifactDigest: expected.artifact_digest,
    artifactByteCount: expected.artifact_byte_count,
    publicationId: expected.publication_id,
    baseBundleHash: expected.base_bundle_hash,
    closureHash: expected.closure_hash,
    publicationBoundaryMs: expected.publication_boundary_ms,
    projection: replayed,
  });
  return mintFreshRollbackProof(archiveProof, freshness);
};

/**
 * Writes one immutable sidecar and promotes it to a nominal proof only after a
 * bounded full read verifies exact bytes, metadata, checksum, and replayed
 * model-slug@1 meaning. It never serializes the candidate bookmark.
 */
export const archiveModelSlugHistoryCandidate = async (
  bucket: ModelSlugHistoryArchiveBucket,
  candidate: TrustedModelSlugHistoryCandidateCapture,
): Promise<TrustedModelSlugHistoryArchiveProof> => {
  try {
    assertModelSlugHistoryCandidateCapture(candidate);
  } catch {
    throw staticFailure("configuration_invalid");
  }
  const archived = await persistAndReadArchive(
    bucket,
    await prepareArchive(candidate),
  );
  let replayed: TrustedModelSlugProjection;
  try {
    replayed = await verifyArtifactMeaning(archived.text, candidate);
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      const code = trustedFailureCodes.get(error);
      if (code !== undefined) throw staticFailure(code);
    }
    throw staticFailure("integrity_failure");
  }

  return mintArchiveProof({
    artifactDigest: archived.artifactDigest,
    artifactByteCount: archived.artifactByteCount,
    publicationId: candidate.publicationId,
    baseBundleHash: candidate.bundleHash,
    closureHash: candidate.closureHash,
    publicationBoundaryMs: candidate.publicationBoundaryMs,
    projection: replayed,
  });
};
