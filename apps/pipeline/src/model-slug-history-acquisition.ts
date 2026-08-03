import {
  MODEL_SLUG_MAX_HISTORY_ROWS,
  MODEL_SLUG_MAX_MODELS,
  MODEL_SLUG_MAX_RESOURCE_BYTES,
  assertImmutablePublicationManifest,
  assertModelSlugResourceByteBudget,
  canonicalizePublicationJson,
  hashPublicationResourceContent,
  projectModelSlugProjection,
  type ModelSlugHistorySourceRow,
  type ServingResourceClosureRow,
  type TrustedImmutablePublicationManifest,
  type TrustedModelSlugProjection,
} from "@quant-clarity/publication-core";
import { checkModelContract } from "@quant-clarity/contracts";

export const MODEL_SLUG_HISTORY_ACQUISITION_VERSION =
  "model-slug-history-canonical@1" as const;

const MAXIMUM_RESULT_ROWS =
  1 + MODEL_SLUG_MAX_MODELS + MODEL_SLUG_MAX_HISTORY_ROWS;
const SELECT_ROW_LIMIT = MAXIMUM_RESULT_ROWS + 1;
const MODEL_SLUG_HISTORY_GUARD_VERSION = "model-slug-history-guard@1" as const;

/**
 * This is deliberately one fixed statement with one JSON parameter. The
 * manifest Model inventory is materialized by json_each inside D1; no broader
 * canonical result is fetched and narrowed in JavaScript.
 */
const SELECT_CANONICAL_MODEL_SLUG_HISTORY_SQL = `WITH requested_models(model_id) AS (
  SELECT value
  FROM json_each(?1)
  WHERE type = 'text'
), canonical_models(model_id, current_slug) AS (
  SELECT requested.model_id, canonical_model.slug
  FROM requested_models AS requested
  JOIN resource_identity AS identity
    ON identity.resource_id = requested.model_id
   AND identity.resource_type = 'model'
  JOIN model AS canonical_model
    ON canonical_model.model_id = requested.model_id
  WHERE typeof(canonical_model.slug) = 'text'
    AND length(canonical_model.slug) BETWEEN 1 AND 128
    AND instr(
      CAST(canonical_model.slug AS BLOB),
      CAST(char(0) AS BLOB)
    ) = 0
    AND canonical_model.slug NOT GLOB '*[^a-z0-9-]*'
    AND canonical_model.slug NOT GLOB '-*'
    AND canonical_model.slug NOT GLOB '*-'
    AND canonical_model.slug NOT GLOB '*--*'
), scoped_history_source AS (
  SELECT history.slug_history_id, history.resource_id,
    identity.resource_type, history.slug,
    history.valid_from_ms,
    CASE
      WHEN history.valid_to_ms > ?2 THEN NULL
      ELSE history.valid_to_ms
    END AS valid_to_ms
  FROM slug_history AS history
  JOIN canonical_models AS scoped
    ON scoped.model_id = history.resource_id
  JOIN resource_identity AS identity
    ON identity.resource_id = history.resource_id
   AND identity.resource_type = 'model'
  WHERE history.valid_from_ms <= ?2
), scoped_history AS (
  SELECT *
  FROM scoped_history_source
  WHERE typeof(slug) = 'text'
    AND length(slug) BETWEEN 1 AND 128
    AND instr(CAST(slug AS BLOB), CAST(char(0) AS BLOB)) = 0
    AND slug NOT GLOB '*[^a-z0-9-]*'
    AND slug NOT GLOB '-*'
    AND slug NOT GLOB '*-'
    AND slug NOT GLOB '*--*'
), acquisition_rows AS (
  SELECT 0 AS sort_group, 'sentinel' AS row_kind,
    (SELECT guard_version
     FROM model_slug_history_integrity_metadata
     WHERE singleton = 1) AS guard_version,
    (SELECT count(*)
     FROM model_slug_history_integrity_metadata) AS guard_row_count,
    (SELECT count(*) FROM requested_models) AS requested_model_count,
    (SELECT count(*) FROM canonical_models) AS canonical_model_count,
    (SELECT count(*) FROM scoped_history_source) AS source_history_count,
    NULL AS slug_history_id, NULL AS resource_id,
    NULL AS resource_type, NULL AS slug,
    NULL AS valid_from_ms, NULL AS valid_to_ms
  UNION ALL
  SELECT 1, 'model', NULL, NULL, NULL, NULL, NULL,
    NULL, model_id, 'model', current_slug,
    NULL, NULL
  FROM canonical_models
  UNION ALL
  SELECT 2, 'history', NULL, NULL, NULL, NULL, NULL,
    slug_history_id, resource_id, resource_type, slug,
    valid_from_ms, valid_to_ms
  FROM scoped_history
)
SELECT row_kind, guard_version, guard_row_count,
  requested_model_count, canonical_model_count,
  source_history_count, slug_history_id, resource_id, resource_type,
  slug, valid_from_ms, valid_to_ms
FROM acquisition_rows
ORDER BY sort_group, resource_id, valid_from_ms,
  CASE WHEN valid_to_ms IS NULL THEN 1 ELSE 0 END,
  valid_to_ms, slug, slug_history_id
LIMIT ${String(SELECT_ROW_LIMIT)}`;

const RESULT_ROW_KEYS = Object.freeze([
  "canonical_model_count",
  "guard_row_count",
  "guard_version",
  "requested_model_count",
  "resource_id",
  "resource_type",
  "row_kind",
  "slug",
  "slug_history_id",
  "source_history_count",
  "valid_from_ms",
  "valid_to_ms",
] as const);

export type ModelSlugHistoryPublicationAssembly = Readonly<{
  manifest: TrustedImmutablePublicationManifest;
  resources: readonly ServingResourceClosureRow[];
}>;

export type CanonicalModelCurrentSlugRow = Readonly<{
  resource_id: string;
  resource_type: "model";
  slug: string;
}>;

export type ModelSlugHistoryAcquisitionPorts = Readonly<{
  /**
   * The implementation MUST keep the writer-drain freeze held until the
   * supplied asynchronous operation settles. It must not return a substitute
   * value or invoke the operation more than once.
   */
  withWriterDrain: <T>(operation: () => Promise<T>) => Promise<T>;
  /** Assembles the trusted manifest and its exact Model resource closure. */
  assemblePublication: () => Promise<ModelSlugHistoryPublicationAssembly>;
}>;

export type ModelSlugHistoryAcquisitionErrorCode =
  | "configuration_invalid"
  | "assembly_failure"
  | "read_failure"
  | "integrity_failure";

export class ModelSlugHistoryAcquisitionError extends Error {
  readonly code: ModelSlugHistoryAcquisitionErrorCode;

  constructor(code: ModelSlugHistoryAcquisitionErrorCode) {
    super("Canonical Model slug history could not be acquired safely.");
    this.name = "ModelSlugHistoryAcquisitionError";
    this.code = code;
  }
}

const candidateCaptureBrand: unique symbol = Symbol(
  "ModelSlugHistoryCandidateCapture",
);
const trustedCandidateCaptures = new WeakSet<object>();

/**
 * Nominal trust proves only that this module produced and validated the
 * candidate. It cannot attest the caller's writer lease and is not an archive
 * receipt, publication-readiness proof, or switch authority.
 */
export type TrustedModelSlugHistoryCandidateCapture = Readonly<{
  acquisitionVersion: typeof MODEL_SLUG_HISTORY_ACQUISITION_VERSION;
  publicationId: TrustedImmutablePublicationManifest["publicationId"];
  closureHash: TrustedImmutablePublicationManifest["closureHash"];
  publicationBoundaryMs: number;
  modelIds: readonly string[];
  canonicalModels: readonly CanonicalModelCurrentSlugRow[];
  historyRows: readonly ModelSlugHistorySourceRow[];
  projection: TrustedModelSlugProjection;
  /** Private control-plane consistency token; never publish this value. */
  privateSessionBookmark: string;
  readonly [candidateCaptureBrand]: true;
}>;

export const assertModelSlugHistoryCandidateCapture: (
  value: unknown,
) => asserts value is TrustedModelSlugHistoryCandidateCapture = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !trustedCandidateCaptures.has(value) ||
    !(candidateCaptureBrand in value) ||
    value[candidateCaptureBrand] !== true
  )
    throw new TypeError("Model slug history candidate capture is not trusted");
};

const trustedFailureCodes = new WeakMap<
  object,
  ModelSlugHistoryAcquisitionErrorCode
>();

const staticFailure = (
  code: ModelSlugHistoryAcquisitionErrorCode,
): ModelSlugHistoryAcquisitionError => {
  const error = new ModelSlugHistoryAcquisitionError(code);
  trustedFailureCodes.set(error, code);
  return error;
};

const ownDataRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw staticFailure("integrity_failure");
  const prototype: unknown = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw staticFailure("integrity_failure");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string") ||
    [...(keys as string[])]
      .sort()
      .some((key, index) => key !== expectedKeys[index])
  )
    throw staticFailure("integrity_failure");
  const output: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor))
      throw staticFailure("integrity_failure");
    output[key] = descriptor.value;
  }
  return output;
};

const ownDataField = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null)
    throw staticFailure("integrity_failure");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor?.enumerable !== true || !("value" in descriptor))
    throw staticFailure("integrity_failure");
  return descriptor.value;
};

const denseArraySnapshot = (
  value: unknown,
  maximumLength: number,
): readonly unknown[] => {
  if (!Array.isArray(value)) throw staticFailure("integrity_failure");
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength
  )
    throw staticFailure("integrity_failure");
  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || !keys.includes("length"))
    throw staticFailure("integrity_failure");
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor))
      throw staticFailure("integrity_failure");
    output.push(descriptor.value);
  }
  return Object.freeze(output);
};

const safeCount = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw staticFailure("integrity_failure");
  return value;
};

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareHistoryRows = (
  left: ModelSlugHistorySourceRow,
  right: ModelSlugHistorySourceRow,
): number => {
  const resourceOrder = compareAscii(left.resource_id, right.resource_id);
  if (resourceOrder !== 0) return resourceOrder;
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

type CanonicalAcquisitionRows = Readonly<{
  canonicalModels: readonly CanonicalModelCurrentSlugRow[];
  historyRows: readonly ModelSlugHistorySourceRow[];
}>;

const snapshotHistoryResult = (
  result: unknown,
  requestedModelIds: readonly string[],
): CanonicalAcquisitionRows => {
  if (ownDataField(result, "success") !== true)
    throw staticFailure("integrity_failure");
  const rows = denseArraySnapshot(
    ownDataField(result, "results"),
    SELECT_ROW_LIMIT,
  );
  if (rows.length < 1) throw staticFailure("integrity_failure");

  const sentinel = ownDataRecord(rows[0], RESULT_ROW_KEYS);
  if (
    sentinel.row_kind !== "sentinel" ||
    sentinel.guard_version !== MODEL_SLUG_HISTORY_GUARD_VERSION ||
    safeCount(sentinel.guard_row_count) !== 1 ||
    safeCount(sentinel.requested_model_count) !== requestedModelIds.length ||
    safeCount(sentinel.canonical_model_count) !== requestedModelIds.length ||
    sentinel.slug_history_id !== null ||
    sentinel.resource_id !== null ||
    sentinel.resource_type !== null ||
    sentinel.slug !== null ||
    sentinel.valid_from_ms !== null ||
    sentinel.valid_to_ms !== null
  )
    throw staticFailure("integrity_failure");
  const canonicalModelCount = safeCount(sentinel.canonical_model_count);
  const sourceHistoryCount = safeCount(sentinel.source_history_count);
  if (
    canonicalModelCount > MODEL_SLUG_MAX_MODELS ||
    sourceHistoryCount > MODEL_SLUG_MAX_HISTORY_ROWS ||
    rows.length !== canonicalModelCount + sourceHistoryCount + 1 ||
    rows.length > MAXIMUM_RESULT_ROWS
  )
    throw staticFailure("integrity_failure");

  const canonicalModels: CanonicalModelCurrentSlugRow[] = [];
  for (let index = 1; index <= canonicalModelCount; index += 1) {
    const row = ownDataRecord(rows[index], RESULT_ROW_KEYS);
    if (
      row.row_kind !== "model" ||
      row.guard_version !== null ||
      row.guard_row_count !== null ||
      row.requested_model_count !== null ||
      row.canonical_model_count !== null ||
      row.source_history_count !== null ||
      row.slug_history_id !== null ||
      typeof row.resource_id !== "string" ||
      row.resource_type !== "model" ||
      typeof row.slug !== "string" ||
      row.valid_from_ms !== null ||
      row.valid_to_ms !== null ||
      row.resource_id !== requestedModelIds[index - 1]
    )
      throw staticFailure("integrity_failure");
    canonicalModels.push(
      Object.freeze({
        resource_id: row.resource_id,
        resource_type: "model" as const,
        slug: row.slug,
      }),
    );
  }

  const historyRows: ModelSlugHistorySourceRow[] = [];
  for (let index = canonicalModelCount + 1; index < rows.length; index += 1) {
    const row = ownDataRecord(rows[index], RESULT_ROW_KEYS);
    if (
      row.row_kind !== "history" ||
      row.guard_version !== null ||
      row.guard_row_count !== null ||
      row.requested_model_count !== null ||
      row.canonical_model_count !== null ||
      row.source_history_count !== null ||
      typeof row.slug_history_id !== "string" ||
      typeof row.resource_id !== "string" ||
      row.resource_type !== "model" ||
      typeof row.slug !== "string" ||
      typeof row.valid_from_ms !== "number" ||
      !Number.isSafeInteger(row.valid_from_ms) ||
      (row.valid_to_ms !== null &&
        (typeof row.valid_to_ms !== "number" ||
          !Number.isSafeInteger(row.valid_to_ms)))
    )
      throw staticFailure("integrity_failure");
    const snapshot = Object.freeze({
      slug_history_id: row.slug_history_id,
      resource_id: row.resource_id,
      resource_type: "model" as const,
      slug: row.slug,
      valid_from_ms: row.valid_from_ms,
      valid_to_ms: row.valid_to_ms,
    });
    const previous = historyRows.at(-1);
    if (previous !== undefined && compareHistoryRows(previous, snapshot) >= 0)
      throw staticFailure("integrity_failure");
    historyRows.push(snapshot);
  }
  return Object.freeze({
    canonicalModels: Object.freeze(canonicalModels),
    historyRows: Object.freeze(historyRows),
  });
};

const snapshotAssembly = (
  value: unknown,
): ModelSlugHistoryPublicationAssembly => {
  const record = ownDataRecord(value, ["manifest", "resources"]);
  assertImmutablePublicationManifest(record.manifest);
  return Object.freeze({
    manifest: record.manifest,
    resources: record.resources,
  }) as ModelSlugHistoryPublicationAssembly;
};

const MODEL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const utf8 = new TextEncoder();

const validateAssemblyResources = async (
  assembly: ModelSlugHistoryPublicationAssembly,
  modelIds: readonly string[],
): Promise<void> => {
  const resources = denseArraySnapshot(
    assembly.resources,
    MODEL_SLUG_MAX_MODELS,
  );
  if (resources.length !== modelIds.length)
    throw staticFailure("integrity_failure");
  const manifestModels = new Map(
    assembly.manifest.resources
      .filter((resource) => resource.resourceType === "model")
      .map((resource) => [resource.resourceId, resource.contentHash]),
  );
  const seen = new Set<string>();
  const byteLengths: number[] = [];
  for (const value of resources) {
    const resource = ownDataRecord(value, [
      "content_hash",
      "resource_id",
      "resource_json",
      "resource_type",
    ]);
    const resourceId = resource.resource_id;
    const resourceJson = resource.resource_json;
    const contentHash = resource.content_hash;
    if (
      resource.resource_type !== "model" ||
      typeof resourceId !== "string" ||
      typeof resourceJson !== "string" ||
      typeof contentHash !== "string" ||
      manifestModels.get(resourceId) !== contentHash ||
      seen.has(resourceId) ||
      resourceJson.length > MODEL_SLUG_MAX_RESOURCE_BYTES
    )
      throw staticFailure("integrity_failure");
    seen.add(resourceId);
    canonicalizePublicationJson(resourceJson, "object");
    const parsed: unknown = JSON.parse(resourceJson);
    if (
      !checkModelContract(parsed) ||
      parsed.model_id !== resourceId ||
      parsed.slug.state !== "known" ||
      typeof parsed.slug.value !== "string" ||
      parsed.slug.value.length < 1 ||
      parsed.slug.value.length > 128 ||
      !MODEL_SLUG.test(parsed.slug.value)
    )
      throw staticFailure("integrity_failure");
    byteLengths.push(utf8.encode(resourceJson).byteLength);
    const computedHash = await hashPublicationResourceContent({
      resourceType: "model",
      resourceId,
      resourceJson,
    });
    if (computedHash !== contentHash) throw staticFailure("integrity_failure");
  }
  if (
    seen.size !== manifestModels.size ||
    modelIds.some((modelId) => !seen.has(modelId))
  )
    throw staticFailure("integrity_failure");
  assertModelSlugResourceByteBudget(byteLengths);
};

/**
 * Acquires the exact canonical history behind a newly assembled publication.
 * The caller-provided writer drain must hold the same freeze from before
 * `assemblePublication` starts until this function's callback settles. The
 * resulting capture still requires independent durable archive and readiness
 * evidence before any serving switch or public route can be authorized.
 */
export const acquireModelSlugHistoryCandidate = async (
  database: D1Database,
  callerPorts: ModelSlugHistoryAcquisitionPorts,
): Promise<TrustedModelSlugHistoryCandidateCapture> => {
  let ports: Record<string, unknown>;
  try {
    ports = ownDataRecord(callerPorts, [
      "assemblePublication",
      "withWriterDrain",
    ]);
  } catch {
    throw staticFailure("configuration_invalid");
  }
  const unknownWithWriterDrain = ports.withWriterDrain;
  const unknownAssemblePublication = ports.assemblePublication;
  if (
    typeof unknownWithWriterDrain !== "function" ||
    typeof unknownAssemblePublication !== "function"
  )
    throw staticFailure("configuration_invalid");
  const withWriterDrain: ModelSlugHistoryAcquisitionPorts["withWriterDrain"] =
    unknownWithWriterDrain as ModelSlugHistoryAcquisitionPorts["withWriterDrain"];
  const assemblePublication: ModelSlugHistoryAcquisitionPorts["assemblePublication"] =
    unknownAssemblePublication as ModelSlugHistoryAcquisitionPorts["assemblePublication"];

  let operationCalls = 0;
  let returnedCapture: TrustedModelSlugHistoryCandidateCapture | undefined;
  const operation =
    async (): Promise<TrustedModelSlugHistoryCandidateCapture> => {
      operationCalls += 1;
      if (operationCalls !== 1) throw staticFailure("configuration_invalid");

      let assembly: ModelSlugHistoryPublicationAssembly;
      try {
        assembly = snapshotAssembly(await assemblePublication());
      } catch {
        throw staticFailure("assembly_failure");
      }
      const modelIds = assembly.manifest.resources
        .filter((resource) => resource.resourceType === "model")
        .map((resource) => resource.resourceId)
        .sort(compareAscii);
      if (modelIds.length > MODEL_SLUG_MAX_MODELS)
        throw staticFailure("integrity_failure");
      const frozenModelIds = Object.freeze(modelIds);
      const publicationBoundaryMs = Date.parse(assembly.manifest.generatedAt);
      if (
        !Number.isSafeInteger(publicationBoundaryMs) ||
        publicationBoundaryMs < 0
      )
        throw staticFailure("integrity_failure");
      try {
        await validateAssemblyResources(assembly, frozenModelIds);
      } catch {
        throw staticFailure("integrity_failure");
      }

      let canonicalModels: readonly CanonicalModelCurrentSlugRow[];
      let historyRows: readonly ModelSlugHistorySourceRow[];
      let privateSessionBookmark: string;
      let session: D1DatabaseSession;
      let result: unknown;
      try {
        session = database.withSession("first-primary");
        result = await session
          .prepare(SELECT_CANONICAL_MODEL_SLUG_HISTORY_SQL)
          .bind(JSON.stringify(frozenModelIds), publicationBoundaryMs)
          .all<unknown>();
      } catch {
        throw staticFailure("read_failure");
      }
      try {
        const acquisitionRows = snapshotHistoryResult(result, frozenModelIds);
        canonicalModels = acquisitionRows.canonicalModels;
        historyRows = acquisitionRows.historyRows;
      } catch {
        throw staticFailure("integrity_failure");
      }
      try {
        const bookmark = session.getBookmark();
        if (
          typeof bookmark !== "string" ||
          bookmark.length < 1 ||
          bookmark.length > 4_096 ||
          bookmark === "first-primary" ||
          bookmark === "first-unconstrained"
        )
          throw staticFailure("read_failure");
        privateSessionBookmark = bookmark;
      } catch {
        throw staticFailure("read_failure");
      }

      let projection: TrustedModelSlugProjection;
      try {
        projection = await projectModelSlugProjection({
          manifest: assembly.manifest,
          resources: assembly.resources,
          historyRows,
        });
      } catch {
        throw staticFailure("integrity_failure");
      }
      const currentMappings = projection.mappings.filter(
        (mapping) => mapping.resolution === "current",
      );
      if (
        projection.modelCount !== frozenModelIds.length ||
        projection.currentMappingCount !== frozenModelIds.length ||
        currentMappings.length !== canonicalModels.length
      )
        throw staticFailure("integrity_failure");
      const currentMappingsByModel = new Map(
        currentMappings.map((mapping) => [mapping.modelId, mapping]),
      );
      if (
        currentMappingsByModel.size !== canonicalModels.length ||
        canonicalModels.some(
          (model) =>
            currentMappingsByModel.get(model.resource_id)?.slug !== model.slug,
        )
      )
        throw staticFailure("integrity_failure");
      const capture = {
        acquisitionVersion: MODEL_SLUG_HISTORY_ACQUISITION_VERSION,
        publicationId: assembly.manifest.publicationId,
        closureHash: assembly.manifest.closureHash,
        publicationBoundaryMs,
        modelIds: frozenModelIds,
        canonicalModels,
        historyRows,
        projection,
      };
      Object.defineProperty(capture, "privateSessionBookmark", {
        value: privateSessionBookmark,
        enumerable: false,
        configurable: false,
        writable: false,
      });
      Object.defineProperty(capture, candidateCaptureBrand, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      });
      returnedCapture = Object.freeze(
        capture,
      ) as TrustedModelSlugHistoryCandidateCapture;
      return returnedCapture;
    };

  let result: unknown;
  try {
    result = await withWriterDrain(operation);
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      const code = trustedFailureCodes.get(error);
      if (code !== undefined) throw staticFailure(code);
    }
    throw staticFailure("configuration_invalid");
  }
  if (
    operationCalls !== 1 ||
    returnedCapture === undefined ||
    result !== returnedCapture
  )
    throw staticFailure("configuration_invalid");
  trustedCandidateCaptures.add(returnedCapture);
  return returnedCapture;
};
