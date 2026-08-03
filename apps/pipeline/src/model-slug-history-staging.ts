import {
  MODEL_SLUG_MAX_HISTORY_ROWS,
  MODEL_SLUG_MAX_MODELS,
  assertModelSlugProjection,
  type ModelSlugMappingProjection,
  type TrustedModelSlugProjection,
} from "@quant-clarity/publication-core";

import {
  MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES,
  assertModelSlugHistoryArchiveProof,
  type TrustedModelSlugHistoryArchiveProof,
} from "./model-slug-history-archive.js";
import { MODEL_SLUG_HISTORY_ARTIFACT_VERSION } from "@quant-clarity/contracts";

export const MODEL_SLUG_HISTORY_STORAGE_VERSION =
  "model-slug-serving@1" as const;
export const MODEL_SLUG_HISTORY_D1_MAX_PAYLOAD_BYTES = 750_000;
export const MODEL_SLUG_HISTORY_D1_MAX_CHUNKS = 64;
export const MODEL_SLUG_HISTORY_D1_MAX_TOTAL_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MODEL_SLUG_HISTORY_D1_READBACK_PAGE_ROWS = 256;
export const MODEL_SLUG_HISTORY_STAGING_MAX_RETAINED_HEAP_BYTES =
  80 * 1024 * 1024;
const MODEL_SLUG_HISTORY_STAGING_FIXED_HEAP_BYTES = 4 * 1024 * 1024;
const MODEL_SLUG_HISTORY_STAGING_MAPPING_OVERHEAD_BYTES = 1_024;

const SELECT_CONTEXT_SQL = `SELECT
  candidate.state, candidate.closure_hash, candidate.generated_at_ms,
  revision.revision AS staging_revision,
  CASE WHEN seal.publication_id IS NULL THEN 0 ELSE 1 END AS sealed
FROM publication AS candidate
JOIN publication_staging_revision AS revision USING (publication_id)
LEFT JOIN publication_closure_seal AS seal USING (publication_id)
WHERE candidate.publication_id = ?1`;

const SELECT_PROOF_SQL = `SELECT
  publication_id, staging_revision, artifact_version, acquisition_version,
  projection_version, base_bundle_hash, closure_hash, publication_boundary_ms,
  artifact_digest, artifact_byte_count, model_count, source_history_count,
  source_history_hash, mapping_count, current_mapping_count,
  historical_mapping_count, mapping_inventory_hash
FROM publication_model_slug_artifact_proof
WHERE publication_id = ?1`;

const SELECT_MAPPING_PAGE_SQL = `SELECT
  slug, model_id, projection_version, resolution, target_content_hash
FROM publication_model_slug_mapping
WHERE publication_id = ?1 AND slug > ?2
ORDER BY slug, model_id
LIMIT ${String(MODEL_SLUG_HISTORY_D1_READBACK_PAGE_ROWS + 1)}`;

const INSERT_MAPPINGS_SQL = `INSERT INTO publication_model_slug_mapping (
  publication_id, slug, target_resource_type, model_id,
  projection_version, resolution, target_content_hash
)
SELECT
  json_extract(payload.value, '$.publication_id'),
  json_extract(payload.value, '$.slug'),
  'model',
  json_extract(payload.value, '$.model_id'),
  json_extract(payload.value, '$.projection_version'),
  json_extract(payload.value, '$.resolution'),
  json_extract(payload.value, '$.target_content_hash')
FROM json_each(?1) AS payload
WHERE payload.type = 'object'
  AND json_type(payload.value, '$.publication_id') = 'text'
  AND json_type(payload.value, '$.slug') = 'text'
  AND json_type(payload.value, '$.model_id') = 'text'
  AND json_type(payload.value, '$.projection_version') = 'text'
  AND json_type(payload.value, '$.resolution') = 'text'
  AND json_type(payload.value, '$.target_content_hash') = 'text'
  AND json_extract(payload.value, '$.publication_id') = ?2
  AND json_extract(payload.value, '$.projection_version') = 'model-slug@1'
  AND EXISTS (
    SELECT 1 FROM publication AS candidate
    JOIN publication_staging_revision AS revision USING (publication_id)
    WHERE candidate.publication_id = ?2
      AND candidate.state = 'building'
      AND candidate.closure_hash = ?3
      AND candidate.generated_at_ms = ?4
      AND revision.revision = ?5
      AND NOT EXISTS (
        SELECT 1 FROM publication_closure_seal
        WHERE publication_id = candidate.publication_id
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM publication_model_slug_mapping AS existing
    WHERE existing.publication_id = ?2
      AND existing.slug = json_extract(payload.value, '$.slug')
  )`;

const INSERT_PROOF_SQL = `INSERT INTO publication_model_slug_artifact_proof (
  publication_id, staging_revision, artifact_version, acquisition_version,
  projection_version, base_bundle_hash, closure_hash, publication_boundary_ms,
  artifact_digest, artifact_byte_count, model_count, source_history_count,
  source_history_hash, mapping_count, current_mapping_count,
  historical_mapping_count, mapping_inventory_hash
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
  ?14, ?15, ?16, ?17)`;

const SELECT_INDEXED_SQL = `SELECT
  slug, model_id, projection_version, resolution, target_content_hash
FROM publication_model_slug_mapping
INDEXED BY publication_model_slug_exact_idx
WHERE publication_id = ?1 AND slug = ?2
ORDER BY model_id
LIMIT 2`;

export type ModelSlugHistoryStagingErrorCode =
  | "stale"
  | "conflict"
  | "integrity_failure"
  | "not_applied"
  | "outcome_unknown";

export class ModelSlugHistoryStagingError extends Error {
  readonly code: ModelSlugHistoryStagingErrorCode;
  readonly retrySameArchive: boolean;

  constructor(code: ModelSlugHistoryStagingErrorCode) {
    super("Archived Model slug history could not be staged safely.");
    this.name = "ModelSlugHistoryStagingError";
    this.code = code;
    this.retrySameArchive = code === "not_applied";
  }
}

const trustedFailureCodes = new WeakMap<
  object,
  ModelSlugHistoryStagingErrorCode
>();

const staticFailure = (
  code: ModelSlugHistoryStagingErrorCode,
): ModelSlugHistoryStagingError => {
  const error = new ModelSlugHistoryStagingError(code);
  trustedFailureCodes.set(error, code);
  return error;
};

const rethrowTrustedFailure = (value: unknown): never => {
  if (typeof value === "object" && value !== null) {
    const code = trustedFailureCodes.get(value);
    if (code !== undefined) throw staticFailure(code);
  }
  throw staticFailure("outcome_unknown");
};

const servingProofBrand: unique symbol = Symbol("ModelSlugServingProof");
const trustedServingProofs = new WeakSet<object>();

export type TrustedModelSlugServingProof = Readonly<{
  storageVersion: typeof MODEL_SLUG_HISTORY_STORAGE_VERSION;
  publicationId: string;
  stagingRevision: number;
  artifactDigest: string;
  projection: TrustedModelSlugProjection;
  readonly [servingProofBrand]: true;
}>;

export const assertModelSlugServingProof: (
  value: unknown,
) => asserts value is TrustedModelSlugServingProof = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !trustedServingProofs.has(value) ||
    !(servingProofBrand in value) ||
    value[servingProofBrand] !== true
  )
    throw new TypeError("Model slug serving proof is not trusted");
};

export type ModelSlugHistoryStagingResult = Readonly<{
  outcome: "applied" | "idempotent_success";
  proof: TrustedModelSlugServingProof;
}>;

export type ModelSlugMappingChunkPlan = Readonly<{
  chunkCount: number;
  maximumPayloadBytes: number;
  retainedHeapEstimateBytes: number;
  totalBytes: number;
}>;

const utf8 = new TextEncoder();

const mappingPayload = (
  publicationId: string,
  mapping: ModelSlugMappingProjection,
): Readonly<Record<string, string>> =>
  Object.freeze({
    model_id: mapping.modelId,
    projection_version: mapping.projectionVersion,
    publication_id: publicationId,
    resolution: mapping.resolution,
    slug: mapping.slug,
    target_content_hash: mapping.targetContentHash,
  });

export const estimateModelSlugHistoryStagingRetainedHeapBytes = (
  mappings: readonly ModelSlugMappingProjection[],
): number => {
  let estimate = MODEL_SLUG_HISTORY_STAGING_FIXED_HEAP_BYTES;
  for (const mapping of mappings) {
    const retainedCharacters =
      mapping.slug.length +
      mapping.modelId.length +
      mapping.projectionVersion.length +
      mapping.resolution.length +
      mapping.targetContentHash.length;
    estimate +=
      MODEL_SLUG_HISTORY_STAGING_MAPPING_OVERHEAD_BYTES +
      retainedCharacters * 2;
    if (!Number.isSafeInteger(estimate)) return Number.MAX_SAFE_INTEGER;
  }
  return estimate;
};

function* modelSlugMappingPayloads(
  publicationId: string,
  mappings: readonly ModelSlugMappingProjection[],
): Generator<string> {
  let chunk: string[] = [];
  let chunkBytes = 2;
  const flush = (): string => {
    const payload = `[${chunk.join(",")}]`;
    chunk = [];
    chunkBytes = 2;
    return payload;
  };
  for (const mapping of mappings) {
    const rowJson = JSON.stringify(mappingPayload(publicationId, mapping));
    const rowBytes = utf8.encode(rowJson).byteLength;
    if (rowBytes + 2 > MODEL_SLUG_HISTORY_D1_MAX_PAYLOAD_BYTES)
      throw staticFailure("integrity_failure");
    const nextBytes = chunkBytes + rowBytes + (chunk.length === 0 ? 0 : 1);
    if (chunk.length > 0 && nextBytes > MODEL_SLUG_HISTORY_D1_MAX_PAYLOAD_BYTES)
      yield flush();
    chunk.push(rowJson);
    chunkBytes += rowBytes + (chunk.length === 1 ? 0 : 1);
  }
  if (chunk.length > 0) yield flush();
}

export const planModelSlugMappingChunks = (
  archiveProof: TrustedModelSlugHistoryArchiveProof,
): ModelSlugMappingChunkPlan => {
  try {
    assertModelSlugHistoryArchiveProof(archiveProof);
    assertModelSlugProjection(archiveProof.projection);
  } catch {
    throw staticFailure("integrity_failure");
  }
  const retainedHeapEstimateBytes =
    estimateModelSlugHistoryStagingRetainedHeapBytes(
      archiveProof.projection.mappings,
    );
  if (
    retainedHeapEstimateBytes >
    MODEL_SLUG_HISTORY_STAGING_MAX_RETAINED_HEAP_BYTES
  )
    throw staticFailure("integrity_failure");
  let chunkCount = 0;
  let maximumPayloadBytes = 0;
  let totalBytes = 0;
  for (const payload of modelSlugMappingPayloads(
    archiveProof.publicationId,
    archiveProof.projection.mappings,
  )) {
    const bytes = utf8.encode(payload).byteLength;
    if (bytes > MODEL_SLUG_HISTORY_D1_MAX_PAYLOAD_BYTES)
      throw staticFailure("integrity_failure");
    totalBytes += bytes;
    maximumPayloadBytes = Math.max(maximumPayloadBytes, bytes);
    chunkCount += 1;
  }
  if (
    chunkCount > MODEL_SLUG_HISTORY_D1_MAX_CHUNKS ||
    totalBytes > MODEL_SLUG_HISTORY_D1_MAX_TOTAL_PAYLOAD_BYTES
  )
    throw staticFailure("integrity_failure");
  return Object.freeze({
    chunkCount,
    maximumPayloadBytes,
    retainedHeapEstimateBytes,
    totalBytes,
  });
};

const ownDataRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid D1 record");
  const prototype: unknown = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("invalid D1 record prototype");
  const keys = Reflect.ownKeys(value);
  const sortedExpected = [...expectedKeys].sort();
  if (
    keys.length !== sortedExpected.length ||
    keys.some((key) => typeof key !== "string") ||
    [...(keys as string[])]
      .sort()
      .some((key, index) => key !== sortedExpected[index])
  )
    throw new Error("invalid D1 record keys");
  const output: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor))
      throw new Error("invalid D1 record field");
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
};

const denseArraySnapshot = (
  value: unknown,
  maximum: number,
): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error("invalid D1 array");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.at(-1) !== "length" ||
    keys.slice(0, -1).some((key, index) => key !== String(index))
  )
    throw new Error("invalid D1 dense array");
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor?.enumerable !== true || !("value" in descriptor))
      throw new Error("invalid D1 array item");
    output.push(descriptor.value);
  }
  return Object.freeze(output);
};

const resultRows = (value: unknown, maximum: number): readonly unknown[] => {
  const result = ownDataRecord(value, ["meta", "results", "success"]);
  if (result.success !== true) throw new Error("unsuccessful D1 result");
  return denseArraySnapshot(result.results, maximum);
};

const CONTEXT_ROW_KEYS = Object.freeze([
  "closure_hash",
  "generated_at_ms",
  "sealed",
  "staging_revision",
  "state",
]);
const PROOF_ROW_KEYS = Object.freeze([
  "acquisition_version",
  "artifact_byte_count",
  "artifact_digest",
  "artifact_version",
  "base_bundle_hash",
  "closure_hash",
  "current_mapping_count",
  "historical_mapping_count",
  "mapping_count",
  "mapping_inventory_hash",
  "model_count",
  "projection_version",
  "publication_boundary_ms",
  "publication_id",
  "source_history_count",
  "source_history_hash",
  "staging_revision",
]);
const MAPPING_ROW_KEYS = Object.freeze([
  "model_id",
  "projection_version",
  "resolution",
  "slug",
  "target_content_hash",
]);

type Snapshot = Readonly<{
  context: Readonly<Record<string, unknown>>;
  proof: readonly Readonly<Record<string, unknown>>[];
}>;

const snapshot = async (
  database: D1Database,
  publicationId: string,
): Promise<Snapshot> => {
  const session = database.withSession("first-primary");
  const results = denseArraySnapshot(
    await session.batch([
      session.prepare(SELECT_CONTEXT_SQL).bind(publicationId),
      session.prepare(SELECT_PROOF_SQL).bind(publicationId),
    ]),
    2,
  );
  if (results.length !== 2) throw new Error("invalid D1 batch result");
  const contextRows = resultRows(results[0], 1);
  if (contextRows.length !== 1) throw staticFailure("stale");
  return Object.freeze({
    context: ownDataRecord(contextRows[0], CONTEXT_ROW_KEYS),
    proof: resultRows(results[1], 1).map((row) =>
      ownDataRecord(row, PROOF_ROW_KEYS),
    ),
  });
};

const mappingMatches = (
  row: Readonly<Record<string, unknown>>,
  expected: ModelSlugMappingProjection,
): boolean =>
  row.slug === expected.slug &&
  row.model_id === expected.modelId &&
  row.projection_version === expected.projectionVersion &&
  row.resolution === expected.resolution &&
  row.target_content_hash === expected.targetContentHash;

const contextRevision = (
  observed: Snapshot,
  archive: TrustedModelSlugHistoryArchiveProof,
): number => {
  const context = observed.context;
  if (
    context.state !== "building" ||
    context.closure_hash !== archive.closureHash ||
    context.generated_at_ms !== archive.publicationBoundaryMs ||
    context.sealed !== 0 ||
    typeof context.staging_revision !== "number" ||
    !Number.isSafeInteger(context.staging_revision) ||
    context.staging_revision < 0
  )
    throw staticFailure("stale");
  return context.staging_revision;
};

const exactProofRow = (
  value: Readonly<Record<string, unknown>>,
  archive: TrustedModelSlugHistoryArchiveProof,
  revision: number,
): boolean => {
  const projection = archive.projection;
  return (
    value.publication_id === archive.publicationId &&
    value.staging_revision === revision &&
    value.artifact_version === archive.artifactVersion &&
    value.acquisition_version === archive.acquisitionVersion &&
    value.projection_version === projection.projectionVersion &&
    value.base_bundle_hash === archive.baseBundleHash &&
    value.closure_hash === archive.closureHash &&
    value.publication_boundary_ms === archive.publicationBoundaryMs &&
    value.artifact_digest === archive.artifactDigest &&
    value.artifact_byte_count === archive.artifactByteCount &&
    value.model_count === projection.modelCount &&
    value.source_history_count === projection.sourceHistoryCount &&
    value.source_history_hash === projection.sourceHistoryHash &&
    value.mapping_count === projection.mappingCount &&
    value.current_mapping_count === projection.currentMappingCount &&
    value.historical_mapping_count === projection.historicalMappingCount &&
    value.mapping_inventory_hash === projection.mappingInventoryHash
  );
};

const readExactMappingPrefix = async (
  database: D1Database,
  archive: TrustedModelSlugHistoryArchiveProof,
): Promise<number> => {
  const expected = archive.projection.mappings;
  let expectedIndex = 0;
  let cursor = "";
  let complete = false;
  while (!complete) {
    const session = database.withSession("first-primary");
    const result = await session
      .prepare(SELECT_MAPPING_PAGE_SQL)
      .bind(archive.publicationId, cursor)
      .all();
    const rows = resultRows(
      result,
      MODEL_SLUG_HISTORY_D1_READBACK_PAGE_ROWS + 1,
    );
    const pageCount = Math.min(
      rows.length,
      MODEL_SLUG_HISTORY_D1_READBACK_PAGE_ROWS,
    );
    for (let index = 0; index < pageCount; index += 1) {
      const row = ownDataRecord(rows[index], MAPPING_ROW_KEYS);
      const expectedRow = expected.at(expectedIndex);
      if (
        expectedRow === undefined ||
        typeof row.slug !== "string" ||
        row.slug <= cursor ||
        !mappingMatches(row, expectedRow)
      )
        throw staticFailure("conflict");
      cursor = row.slug;
      expectedIndex += 1;
    }
    complete = rows.length <= MODEL_SLUG_HISTORY_D1_READBACK_PAGE_ROWS;
    if (!complete && pageCount === 0)
      throw new Error("mapping keyset page did not advance");
  }
  return expectedIndex;
};

type Classification = Readonly<{
  outcome: "execute" | "idempotent_success";
  mappingCount: number;
  revision: number;
}>;

const classify = async (
  database: D1Database,
  archive: TrustedModelSlugHistoryArchiveProof,
): Promise<Classification> => {
  const observed = await snapshot(database, archive.publicationId);
  const revision = contextRevision(observed, archive);
  const expected = archive.projection.mappings;
  const observedMappingCount = await readExactMappingPrefix(database, archive);
  if (observed.proof.length === 0)
    return Object.freeze({
      outcome: "execute",
      mappingCount: observedMappingCount,
      revision,
    });
  const observedProof = observed.proof.at(0);
  if (
    observed.proof.length !== 1 ||
    observedProof === undefined ||
    observedMappingCount !== expected.length ||
    !exactProofRow(observedProof, archive, revision)
  )
    throw staticFailure("conflict");
  return Object.freeze({
    outcome: "idempotent_success",
    mappingCount: observedMappingCount,
    revision,
  });
};

const indexedQueryability = async (
  database: D1Database,
  archive: TrustedModelSlugHistoryArchiveProof,
): Promise<void> => {
  const expected = archive.projection.mappings[0];
  const hasSlug = (slug: string): boolean => {
    let lower = 0;
    let upper = archive.projection.mappings.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      const observed = archive.projection.mappings.at(middle);
      if (observed === undefined) return false;
      if (observed.slug < slug) lower = middle + 1;
      else upper = middle;
    }
    return archive.projection.mappings.at(lower)?.slug === slug;
  };
  let miss = "queryability-miss-0";
  for (let sequence = 0; hasSlug(miss); sequence += 1) {
    if (sequence > MODEL_SLUG_MAX_HISTORY_ROWS)
      throw new Error("indexed miss could not be selected");
    miss = `queryability-miss-${String(sequence + 1)}`;
  }
  const session = database.withSession("first-primary");
  const statements = [
    session.prepare(SELECT_INDEXED_SQL).bind(archive.publicationId, miss),
  ];
  if (expected !== undefined)
    statements.unshift(
      session
        .prepare(SELECT_INDEXED_SQL)
        .bind(archive.publicationId, expected.slug),
    );
  const results = denseArraySnapshot(
    await session.batch(statements),
    statements.length,
  );
  if (results.length !== statements.length)
    throw new Error("indexed result is invalid");
  let offset = 0;
  if (expected !== undefined) {
    const hit = resultRows(results[0], 2).map((row) =>
      ownDataRecord(row, MAPPING_ROW_KEYS),
    );
    const hitRow = hit.at(0);
    if (
      hit.length !== 1 ||
      hitRow === undefined ||
      !mappingMatches(hitRow, expected)
    )
      throw new Error("indexed hit does not match");
    offset = 1;
  }
  if (resultRows(results[offset], 2).length !== 0)
    throw new Error("indexed miss unexpectedly matched");
};

const mintProof = (
  archive: TrustedModelSlugHistoryArchiveProof,
  revision: number,
): TrustedModelSlugServingProof => {
  const proof = {
    storageVersion: MODEL_SLUG_HISTORY_STORAGE_VERSION,
    publicationId: archive.publicationId,
    stagingRevision: revision,
    artifactDigest: archive.artifactDigest,
    projection: archive.projection,
  };
  Object.defineProperty(proof, servingProofBrand, {
    value: true,
    enumerable: false,
  });
  trustedServingProofs.add(proof);
  return Object.freeze(proof) as TrustedModelSlugServingProof;
};

const proofValues = (
  archive: TrustedModelSlugHistoryArchiveProof,
  revision: number,
): readonly unknown[] => {
  const projection = archive.projection;
  return [
    archive.publicationId,
    revision,
    MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
    archive.acquisitionVersion,
    projection.projectionVersion,
    archive.baseBundleHash,
    archive.closureHash,
    archive.publicationBoundaryMs,
    archive.artifactDigest,
    archive.artifactByteCount,
    projection.modelCount,
    projection.sourceHistoryCount,
    projection.sourceHistoryHash,
    projection.mappingCount,
    projection.currentMappingCount,
    projection.historicalMappingCount,
    projection.mappingInventoryHash,
  ];
};

export const stageModelSlugHistoryArchive = async (
  database: D1Database,
  archiveValue: unknown,
): Promise<ModelSlugHistoryStagingResult> => {
  try {
    assertModelSlugHistoryArchiveProof(archiveValue);
    assertModelSlugProjection(archiveValue.projection);
    if (
      archiveValue.artifactByteCount < 1 ||
      archiveValue.artifactByteCount > MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES ||
      archiveValue.projection.modelCount > MODEL_SLUG_MAX_MODELS ||
      archiveValue.projection.sourceHistoryCount >
        MODEL_SLUG_MAX_HISTORY_ROWS ||
      archiveValue.projection.mappingCount > MODEL_SLUG_MAX_HISTORY_ROWS
    )
      throw new Error("archive bounds are invalid");
  } catch {
    throw staticFailure("integrity_failure");
  }
  const archive = archiveValue;
  planModelSlugMappingChunks(archive);
  const initial = await classify(database, archive).catch((error: unknown) =>
    rethrowTrustedFailure(error),
  );
  if (initial.outcome === "idempotent_success") {
    try {
      await indexedQueryability(database, archive);
    } catch {
      throw staticFailure("conflict");
    }
    return Object.freeze({
      outcome: "idempotent_success",
      proof: mintProof(archive, initial.revision),
    });
  }

  try {
    for (const payload of modelSlugMappingPayloads(
      archive.publicationId,
      archive.projection.mappings,
    )) {
      const session = database.withSession("first-primary");
      const inserted = await session
        .prepare(INSERT_MAPPINGS_SQL)
        .bind(
          payload,
          archive.publicationId,
          archive.closureHash,
          archive.publicationBoundaryMs,
          initial.revision,
        )
        .run();
      resultRows(inserted, 0);
    }
    const staged = await classify(database, archive);
    if (staged.outcome !== "execute")
      throw new Error("proof appeared during mapping staging");
    if (staged.mappingCount !== archive.projection.mappings.length)
      throw new Error("staged mappings do not exactly match archive");
    const session = database.withSession("first-primary");
    const result = await session
      .prepare(INSERT_PROOF_SQL)
      .bind(...proofValues(archive, initial.revision))
      .run();
    resultRows(result, 0);
    const final = await classify(database, archive);
    if (final.outcome !== "idempotent_success")
      throw new Error("proof was not durable");
    await indexedQueryability(database, archive);
    return Object.freeze({
      outcome: "applied",
      proof: mintProof(archive, final.revision),
    });
  } catch {
    try {
      const final = await classify(database, archive);
      if (final.outcome === "idempotent_success") {
        await indexedQueryability(database, archive);
        return Object.freeze({
          outcome: "idempotent_success",
          proof: mintProof(archive, final.revision),
        });
      }
      throw staticFailure("not_applied");
    } catch (error) {
      return rethrowTrustedFailure(error);
    }
  }
};
