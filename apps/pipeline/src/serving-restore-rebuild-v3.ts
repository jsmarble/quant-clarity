import {
  SERVING_BACKUP_TABLES,
  validateBackupManifest,
  type BackupChunk,
  type BackupClosureExpectation,
  type BackupManifest,
  type BackupTableSummary,
} from "@quant-clarity/publication-core";

export const RESTORE_SOURCE_PROFILE_VERSION =
  "backup-v1-restore-source@1" as const;
export const RESTORE_REBUILD_TRANSCRIPT_VERSION =
  "serving-restore-rebuild@3" as const;

export const RESTORE_SOURCE_TABLES = Object.freeze([
  "publication",
  "publication_provider_slice",
  "publication_provider_slice_metadata",
  "publication_provider_attribution",
  "publication_resource",
  "publication_search_document",
  "publication_vector_inventory",
  "publication_inventory_chunk",
] as const);

export const RESTORE_EXCLUDED_TABLES = Object.freeze([
  "serving_schema_metadata",
  "publication_closure_seal",
  "publication_dataset_metadata_summary",
  "publication_readiness_receipt",
  "publication_archive_receipt",
  "publication_serving_receipt",
  "publication_vector_receipt",
  "publication_probe_receipt",
  "publication_readiness_attestation",
  "publication_switch_preflight",
  "publication_switch_history",
  "publication_head",
  "publication_search_fts",
  "publication_provider_search_document",
  "publication_provider_search_fts",
  "publication_model_variant_name_search_document",
  "publication_staging_revision",
] as const);

export const RESTORE_SYNTHETIC_PROBE_IDS = Object.freeze([
  "restore-v3-provider-exact-match",
  "restore-v3-provider-exact-miss",
  "restore-v3-model-variant-exact-match",
  "restore-v3-model-variant-exact-miss",
  "restore-v3-version-isolation",
] as const);

const HASH = /^sha256:[0-9a-f]{64}$/u;
const PUBLICATION_ID =
  /^pub_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const restoreSourceFields = [
  "sourceSchemaVersion",
  "manifestContractVersion",
  "hashDomain",
  "hashEncodingVersion",
  "enabledProviderScopeVersion",
  "publicationId",
  "closureHash",
  "bundleHash",
  "enabledProviderScopeHash",
  "providerSliceHash",
  "providerAttributionHash",
  "resourceInventoryHash",
  "exactSearchInventoryHash",
  "vectorInventoryHash",
  "chunkRootHash",
  "manifestInputHash",
  "providerSliceCount",
  "providerSliceMetadataCount",
  "providerAttributionCount",
  "resourceCount",
  "searchDocumentCount",
  "vectorDocumentCount",
  "inventoryChunkCount",
] as const;

export type RestoreClosureSourceV1 = Readonly<{
  sourceSchemaVersion: string;
  manifestContractVersion: string;
  hashDomain: "publication-closure";
  hashEncodingVersion: string;
  enabledProviderScopeVersion: string;
  publicationId: string;
  closureHash: string;
  bundleHash: string;
  enabledProviderScopeHash: string;
  providerSliceHash: string;
  providerAttributionHash: string;
  resourceInventoryHash: string;
  exactSearchInventoryHash: string;
  vectorInventoryHash: string;
  chunkRootHash: string;
  manifestInputHash: string;
  providerSliceCount: number;
  providerSliceMetadataCount: number;
  providerAttributionCount: number;
  resourceCount: number;
  searchDocumentCount: number;
  vectorDocumentCount: number;
  inventoryChunkCount: number;
}>;

export type RestoreSourceTableV1 = Readonly<{
  table: (typeof RESTORE_SOURCE_TABLES)[number];
  chunkCount: number;
  rowCount: number;
  byteCount: number;
  chunks: readonly Readonly<{
    ordinal: number;
    firstKey: string;
    lastKey: string;
    rowCount: number;
    byteCount: number;
    contentHash: string;
  }>[];
}>;

const verifiedRestoreSourceProfileBrand: unique symbol = Symbol(
  "VerifiedRestoreSourceProfileV1",
);

export type VerifiedRestoreSourceProfileV1 = Readonly<{
  profileVersion: typeof RESTORE_SOURCE_PROFILE_VERSION;
  backupFormatVersion: "1.0.0";
  backupRootHash: string;
  closureSource: RestoreClosureSourceV1;
  materialization: Readonly<{
    destinationSchemaVersion: "1.6.0";
    destinationIsolation: "fresh-local-schema";
    publicationState: "building";
    readyAtMs: null;
    activatedAtMs: null;
    failureCodesJson: "[]";
    closureSealImported: false;
    stagingRevisionImported: false;
  }>;
  selectedSources: readonly RestoreSourceTableV1[];
  selectedRowCount: number;
  readonly [verifiedRestoreSourceProfileBrand]: true;
}>;

const verifiedRestoreSourceProfiles = new WeakSet<object>();

export class RestoreSourceProfileError extends Error {
  readonly code: "backup_manifest_invalid" | "restore_source_invalid";

  constructor(code: "backup_manifest_invalid" | "restore_source_invalid") {
    super(code);
    this.name = "RestoreSourceProfileError";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

const isSafeCount = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;

const isAsciiVersion = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 128 &&
  /^[\x20-\x7e]+$/u.test(value);

const copyClosureSource = (
  value: unknown,
  expected: BackupClosureExpectation,
  tableRows: ReadonlyMap<string, number>,
): RestoreClosureSourceV1 => {
  if (!isRecord(value) || !hasExactKeys(value, restoreSourceFields))
    throw new RestoreSourceProfileError("restore_source_invalid");
  const candidate = Object.fromEntries(
    restoreSourceFields.map((field) => [field, value[field]]),
  ) as Record<(typeof restoreSourceFields)[number], unknown>;
  const strings = restoreSourceFields.slice(0, 16);
  for (const field of strings)
    if (typeof candidate[field] !== "string")
      throw new RestoreSourceProfileError("restore_source_invalid");
  for (const field of restoreSourceFields.slice(16))
    if (!isSafeCount(candidate[field]))
      throw new RestoreSourceProfileError("restore_source_invalid");
  if (
    !isAsciiVersion(candidate.sourceSchemaVersion) ||
    !isAsciiVersion(candidate.manifestContractVersion) ||
    candidate.hashDomain !== "publication-closure" ||
    !isAsciiVersion(candidate.hashEncodingVersion) ||
    !isAsciiVersion(candidate.enabledProviderScopeVersion) ||
    !PUBLICATION_ID.test(candidate.publicationId as string) ||
    !restoreSourceFields
      .slice(6, 16)
      .every((field) => HASH.test(candidate[field] as string)) ||
    candidate.publicationId !== expected.publicationId ||
    candidate.closureHash !== expected.closureHash ||
    candidate.providerSliceCount !== expected.providerSliceCount ||
    candidate.resourceCount !== expected.resourceCount ||
    candidate.searchDocumentCount !== expected.searchDocumentCount ||
    candidate.vectorDocumentCount !== candidate.searchDocumentCount ||
    candidate.providerSliceMetadataCount !== candidate.providerSliceCount ||
    (candidate.inventoryChunkCount as number) < 1 ||
    tableRows.get("publication") !== 1 ||
    tableRows.get("publication_provider_slice") !==
      candidate.providerSliceCount ||
    tableRows.get("publication_provider_slice_metadata") !==
      candidate.providerSliceMetadataCount ||
    tableRows.get("publication_provider_attribution") !==
      candidate.providerAttributionCount ||
    tableRows.get("publication_resource") !== candidate.resourceCount ||
    tableRows.get("publication_search_document") !==
      candidate.searchDocumentCount ||
    tableRows.get("publication_vector_inventory") !==
      candidate.vectorDocumentCount ||
    tableRows.get("publication_inventory_chunk") !==
      candidate.inventoryChunkCount
  )
    throw new RestoreSourceProfileError("restore_source_invalid");
  return Object.freeze({
    sourceSchemaVersion: candidate.sourceSchemaVersion,
    manifestContractVersion: candidate.manifestContractVersion,
    hashDomain: "publication-closure",
    hashEncodingVersion: candidate.hashEncodingVersion,
    enabledProviderScopeVersion: candidate.enabledProviderScopeVersion,
    publicationId: candidate.publicationId,
    closureHash: candidate.closureHash,
    bundleHash: candidate.bundleHash as string,
    enabledProviderScopeHash: candidate.enabledProviderScopeHash as string,
    providerSliceHash: candidate.providerSliceHash as string,
    providerAttributionHash: candidate.providerAttributionHash as string,
    resourceInventoryHash: candidate.resourceInventoryHash as string,
    exactSearchInventoryHash: candidate.exactSearchInventoryHash as string,
    vectorInventoryHash: candidate.vectorInventoryHash as string,
    chunkRootHash: candidate.chunkRootHash as string,
    manifestInputHash: candidate.manifestInputHash as string,
    providerSliceCount: candidate.providerSliceCount,
    providerSliceMetadataCount: candidate.providerSliceMetadataCount,
    providerAttributionCount: candidate.providerAttributionCount as number,
    resourceCount: candidate.resourceCount,
    searchDocumentCount: candidate.searchDocumentCount,
    vectorDocumentCount: candidate.vectorDocumentCount,
    inventoryChunkCount: candidate.inventoryChunkCount as number,
  });
};

const copyTableSummary = (
  summary: BackupTableSummary,
  chunks: readonly BackupChunk[],
): RestoreSourceTableV1 =>
  Object.freeze({
    table: summary.table as (typeof RESTORE_SOURCE_TABLES)[number],
    chunkCount: summary.chunkCount,
    rowCount: summary.rowCount,
    byteCount: summary.byteCount,
    chunks: Object.freeze(
      chunks.map((chunk) =>
        Object.freeze({
          ordinal: chunk.ordinal,
          firstKey: chunk.firstKey,
          lastKey: chunk.lastKey,
          rowCount: chunk.rowCount,
          byteCount: chunk.byteCount,
          contentHash: chunk.contentHash,
        }),
      ),
    ),
  });

/**
 * Validates backup-v1 in full before reading the restore-source descriptor.
 * A second validation over detached backup metadata closes mutation/getter races.
 */
export const createVerifiedRestoreSourceProfileV1 = async (
  manifest: BackupManifest,
  expectedClosure: BackupClosureExpectation,
  source: unknown,
): Promise<VerifiedRestoreSourceProfileV1> => {
  try {
    const firstErrors = await validateBackupManifest(manifest, expectedClosure);
    if (firstErrors.length > 0)
      throw new RestoreSourceProfileError("backup_manifest_invalid");
  } catch (error) {
    if (error instanceof RestoreSourceProfileError) throw error;
    throw new RestoreSourceProfileError("backup_manifest_invalid");
  }

  let detachedManifest: BackupManifest;
  let detachedExpected: BackupClosureExpectation;
  try {
    detachedExpected = Object.freeze({
      servingSchemaVersion: expectedClosure.servingSchemaVersion,
      publicationId: expectedClosure.publicationId,
      closureHash: expectedClosure.closureHash,
      providerSliceCount: expectedClosure.providerSliceCount,
      resourceCount: expectedClosure.resourceCount,
      searchDocumentCount: expectedClosure.searchDocumentCount,
    });
    detachedManifest = Object.freeze({
      formatVersion: manifest.formatVersion,
      publicationId: manifest.publicationId,
      closureHash: manifest.closureHash,
      canonicalStartBoundary: manifest.canonicalStartBoundary,
      canonicalEndBoundary: manifest.canonicalEndBoundary,
      writerLeaseDrained: manifest.writerLeaseDrained,
      ordinaryTablesOnly: manifest.ordinaryTablesOnly,
      searchDocumentsIncluded: manifest.searchDocumentsIncluded,
      expectedProviderSliceCount: manifest.expectedProviderSliceCount,
      expectedResourceCount: manifest.expectedResourceCount,
      expectedSearchDocumentCount: manifest.expectedSearchDocumentCount,
      tables: Object.freeze(
        manifest.tables.map((table) => Object.freeze({ ...table })),
      ),
      chunks: Object.freeze(
        manifest.chunks.map((chunk) => Object.freeze({ ...chunk })),
      ),
      rootHash: manifest.rootHash,
    });
    const detachedErrors = await validateBackupManifest(
      detachedManifest,
      detachedExpected,
    );
    if (detachedErrors.length > 0)
      throw new RestoreSourceProfileError("backup_manifest_invalid");
  } catch (error) {
    if (error instanceof RestoreSourceProfileError) throw error;
    throw new RestoreSourceProfileError("backup_manifest_invalid");
  }

  const tableByName = new Map(
    detachedManifest.tables.map((table) => [table.table, table]),
  );
  const selectedNames = new Set<string>(RESTORE_SOURCE_TABLES);
  const excludedNames = new Set<string>(RESTORE_EXCLUDED_TABLES);
  if (
    SERVING_BACKUP_TABLES.some(
      (table) => !selectedNames.has(table) && !excludedNames.has(table),
    ) ||
    RESTORE_SOURCE_TABLES.some((table) => excludedNames.has(table))
  )
    throw new RestoreSourceProfileError("restore_source_invalid");
  const chunksByName = new Map<string, BackupChunk[]>();
  for (const chunk of detachedManifest.chunks) {
    const chunks = chunksByName.get(chunk.table) ?? [];
    chunks.push(chunk);
    chunksByName.set(chunk.table, chunks);
  }
  const selectedSources = Object.freeze(
    RESTORE_SOURCE_TABLES.map((table) => {
      const summary = tableByName.get(table);
      if (summary === undefined)
        throw new RestoreSourceProfileError("restore_source_invalid");
      return copyTableSummary(
        summary,
        [...(chunksByName.get(table) ?? [])].sort(
          (left, right) => left.ordinal - right.ordinal,
        ),
      );
    }),
  );
  const tableRows = new Map(
    selectedSources.map((table) => [table.table, table.rowCount]),
  );
  let closureSource: RestoreClosureSourceV1;
  try {
    closureSource = copyClosureSource(source, detachedExpected, tableRows);
  } catch {
    throw new RestoreSourceProfileError("restore_source_invalid");
  }
  const selectedRowCount = selectedSources.reduce(
    (total, table) => total + table.rowCount,
    0,
  );
  if (!Number.isSafeInteger(selectedRowCount))
    throw new RestoreSourceProfileError("restore_source_invalid");

  const profile = {
    profileVersion: RESTORE_SOURCE_PROFILE_VERSION,
    backupFormatVersion: "1.0.0" as const,
    backupRootHash: detachedManifest.rootHash,
    closureSource,
    materialization: Object.freeze({
      destinationSchemaVersion: "1.6.0" as const,
      destinationIsolation: "fresh-local-schema" as const,
      publicationState: "building" as const,
      readyAtMs: null,
      activatedAtMs: null,
      failureCodesJson: "[]" as const,
      closureSealImported: false as const,
      stagingRevisionImported: false as const,
    }),
    selectedSources,
    selectedRowCount,
  };
  Object.defineProperty(profile, verifiedRestoreSourceProfileBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  verifiedRestoreSourceProfiles.add(profile);
  return Object.freeze(profile) as VerifiedRestoreSourceProfileV1;
};

export const assertVerifiedRestoreSourceProfileV1: (
  value: unknown,
) => asserts value is VerifiedRestoreSourceProfileV1 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !verifiedRestoreSourceProfiles.has(value)
  )
    throw new TypeError("verified restore source profile is required");
};

export const RESTORE_REBUILD_PHASES = Object.freeze([
  "import",
  "closure",
  "provider_search",
  "model_search",
  "seal",
  "readiness",
] as const);
export type RestoreRebuildPhase = (typeof RESTORE_REBUILD_PHASES)[number];
export type RestoreRebuildPhaseOrSwitch = RestoreRebuildPhase | "switch";

const PHASE_VERSIONS = Object.freeze({
  import: "backup-v1-selected-import@1",
  closure: "publication-closure-compare@1",
  provider_search: "provider-search-rebuild@2",
  model_search: "model-variant-name-rebuild@3",
  seal: "publication-closure-seal@1",
  readiness: "serving-readiness@3",
  switch: "serving-switch@3",
} as const);

export type RestorePhaseCallbackResult = Readonly<{
  outcome: "succeeded";
  phaseVersion: string;
  backupRootHash: string;
  closureHash: string;
  artifactCount: number;
  artifactHash: string;
}>;

export type RestorePhaseReceipt = Readonly<{
  phase: RestoreRebuildPhaseOrSwitch;
  outcome: "succeeded";
  phaseVersion: string;
  artifactCount: number;
  artifactHash: string;
}>;

export type RestoreRebuildPhaseContext = Readonly<{
  profile: VerifiedRestoreSourceProfileV1;
  completed: readonly RestorePhaseReceipt[];
}>;

export type RestoreRebuildPortsV3 = Readonly<{
  importSelectedSources: (
    context: RestoreRebuildPhaseContext,
  ) => Promise<unknown>;
  compareClosure: (context: RestoreRebuildPhaseContext) => Promise<unknown>;
  rebuildProviderSearch: (
    context: RestoreRebuildPhaseContext,
  ) => Promise<unknown>;
  rebuildModelSearch: (context: RestoreRebuildPhaseContext) => Promise<unknown>;
  createSeal: (context: RestoreRebuildPhaseContext) => Promise<unknown>;
  commitReadinessV3: (context: RestoreRebuildPhaseContext) => Promise<unknown>;
  switchLocalV3?: (context: RestoreRebuildPhaseContext) => Promise<unknown>;
}>;

export type RestoreRebuildTranscriptV3 = Readonly<{
  transcriptVersion: typeof RESTORE_REBUILD_TRANSCRIPT_VERSION;
  profileVersion: typeof RESTORE_SOURCE_PROFILE_VERSION;
  backupFormatVersion: "1.0.0";
  destinationSchemaVersion: "1.6.0";
  backupRootHash: string;
  closureHash: string;
  selectedTableCount: number;
  selectedRowCount: number;
  syntheticProbeIds: typeof RESTORE_SYNTHETIC_PROBE_IDS;
  phases: readonly (
    | RestorePhaseReceipt
    | Readonly<{
        phase: RestoreRebuildPhaseOrSwitch;
        outcome: "failed";
        phaseVersion: string;
        failureCode:
          | "phase_callback_failed"
          | "phase_result_invalid"
          | "configuration_invalid";
      }>
  )[];
}>;

export type RestoreRebuildRunV3 = Readonly<{
  outcome: "succeeded" | "failed";
  transcript: RestoreRebuildTranscriptV3;
}>;

const callbackResultFields = [
  "outcome",
  "phaseVersion",
  "backupRootHash",
  "closureHash",
  "artifactCount",
  "artifactHash",
] as const;

const validatePhaseResult = (
  value: unknown,
  phase: RestoreRebuildPhaseOrSwitch,
  profile: VerifiedRestoreSourceProfileV1,
): RestorePhaseReceipt | null => {
  if (!isRecord(value) || !hasExactKeys(value, callbackResultFields))
    return null;
  const candidate = Object.fromEntries(
    callbackResultFields.map((field) => [field, value[field]]),
  ) as Record<(typeof callbackResultFields)[number], unknown>;
  if (
    candidate.outcome !== "succeeded" ||
    candidate.phaseVersion !== PHASE_VERSIONS[phase] ||
    candidate.backupRootHash !== profile.backupRootHash ||
    candidate.closureHash !== profile.closureSource.closureHash ||
    !isSafeCount(candidate.artifactCount) ||
    typeof candidate.artifactHash !== "string" ||
    !HASH.test(candidate.artifactHash)
  )
    return null;
  if (
    (phase === "import" &&
      (candidate.artifactCount !== profile.selectedRowCount ||
        candidate.artifactHash !== profile.closureSource.manifestInputHash)) ||
    (phase === "closure" &&
      (candidate.artifactCount !== 1 ||
        candidate.artifactHash !== profile.closureSource.closureHash)) ||
    (phase === "model_search" &&
      candidate.artifactCount > profile.closureSource.resourceCount) ||
    ((phase === "seal" || phase === "readiness" || phase === "switch") &&
      candidate.artifactCount !== 1) ||
    (phase === "seal" &&
      candidate.artifactHash !== profile.closureSource.closureHash)
  )
    return null;
  return Object.freeze({
    phase,
    outcome: "succeeded",
    phaseVersion: PHASE_VERSIONS[phase],
    artifactCount: candidate.artifactCount,
    artifactHash: candidate.artifactHash,
  });
};

const transcript = (
  profile: VerifiedRestoreSourceProfileV1,
  phases: RestoreRebuildTranscriptV3["phases"],
): RestoreRebuildTranscriptV3 =>
  Object.freeze({
    transcriptVersion: RESTORE_REBUILD_TRANSCRIPT_VERSION,
    profileVersion: RESTORE_SOURCE_PROFILE_VERSION,
    backupFormatVersion: "1.0.0",
    destinationSchemaVersion: profile.materialization.destinationSchemaVersion,
    backupRootHash: profile.backupRootHash,
    closureHash: profile.closureSource.closureHash,
    selectedTableCount: profile.selectedSources.length,
    selectedRowCount: profile.selectedRowCount,
    syntheticProbeIds: RESTORE_SYNTHETIC_PROBE_IDS,
    phases: Object.freeze([...phases]),
  });

const portFields = [
  "importSelectedSources",
  "compareClosure",
  "rebuildProviderSearch",
  "rebuildModelSearch",
  "createSeal",
  "commitReadinessV3",
] as const;

type RestorePhaseCallback = (
  context: RestoreRebuildPhaseContext,
) => Promise<unknown>;

const configurationFailure = (
  profile: VerifiedRestoreSourceProfileV1,
): RestoreRebuildRunV3 => {
  const failed = Object.freeze({
    phase: "switch" as const,
    outcome: "failed" as const,
    phaseVersion: PHASE_VERSIONS.switch,
    failureCode: "configuration_invalid" as const,
  });
  return Object.freeze({
    outcome: "failed",
    transcript: transcript(profile, [failed]),
  });
};

/** Runs only the local deterministic seam. It is not an importer or deploy path. */
export const runLocalServingRestoreRebuildV3 = async (
  profile: VerifiedRestoreSourceProfileV1,
  ports: RestoreRebuildPortsV3,
  options: Readonly<{ enableLocalSwitch: boolean }>,
): Promise<RestoreRebuildRunV3> => {
  assertVerifiedRestoreSourceProfileV1(profile);
  const completed: RestorePhaseReceipt[] = [];
  const portRecord: unknown = ports;
  const optionRecord: unknown = options;
  let callbacks: Readonly<
    Record<RestoreRebuildPhaseOrSwitch, RestorePhaseCallback | undefined>
  >;
  let enableLocalSwitch: boolean;
  try {
    if (
      !isRecord(portRecord) ||
      !isRecord(optionRecord) ||
      !hasExactKeys(optionRecord, ["enableLocalSwitch"])
    )
      return configurationFailure(profile);
    const enableLocalSwitchInput: unknown = optionRecord.enableLocalSwitch;
    if (typeof enableLocalSwitchInput !== "boolean")
      return configurationFailure(profile);
    enableLocalSwitch = enableLocalSwitchInput;

    const actualPortKeys = Object.keys(portRecord);
    if (
      actualPortKeys.some(
        (key) =>
          !portFields.includes(key as (typeof portFields)[number]) &&
          key !== "switchLocalV3",
      ) ||
      portFields.some((field) => !actualPortKeys.includes(field))
    )
      return configurationFailure(profile);
    const callbackValues = Object.fromEntries(
      portFields.map((field) => [field, portRecord[field]]),
    ) as Record<(typeof portFields)[number], unknown>;
    const switchCallbackInput: unknown = Object.hasOwn(
      portRecord,
      "switchLocalV3",
    )
      ? portRecord.switchLocalV3
      : undefined;
    if (
      !portFields.every(
        (field) => typeof callbackValues[field] === "function",
      ) ||
      (switchCallbackInput !== undefined &&
        typeof switchCallbackInput !== "function") ||
      (enableLocalSwitch && typeof switchCallbackInput !== "function")
    )
      return configurationFailure(profile);
    callbacks = Object.freeze({
      import: callbackValues.importSelectedSources as RestorePhaseCallback,
      closure: callbackValues.compareClosure as RestorePhaseCallback,
      provider_search:
        callbackValues.rebuildProviderSearch as RestorePhaseCallback,
      model_search: callbackValues.rebuildModelSearch as RestorePhaseCallback,
      seal: callbackValues.createSeal as RestorePhaseCallback,
      readiness: callbackValues.commitReadinessV3 as RestorePhaseCallback,
      switch: switchCallbackInput as RestorePhaseCallback | undefined,
    });
  } catch {
    return configurationFailure(profile);
  }
  const phases: readonly RestoreRebuildPhaseOrSwitch[] = enableLocalSwitch
    ? [...RESTORE_REBUILD_PHASES, "switch"]
    : RESTORE_REBUILD_PHASES;

  for (const phase of phases) {
    const callback = callbacks[phase];
    if (callback === undefined) return configurationFailure(profile);
    let rawResult: unknown;
    try {
      rawResult = await callback(
        Object.freeze({
          profile,
          completed: Object.freeze([...completed]),
        }),
      );
    } catch {
      const failed = Object.freeze({
        phase,
        outcome: "failed" as const,
        phaseVersion: PHASE_VERSIONS[phase],
        failureCode: "phase_callback_failed" as const,
      });
      return Object.freeze({
        outcome: "failed",
        transcript: transcript(profile, [...completed, failed]),
      });
    }
    let receipt: RestorePhaseReceipt | null;
    try {
      receipt = validatePhaseResult(rawResult, phase, profile);
    } catch {
      receipt = null;
    }
    if (receipt === null) {
      const failed = Object.freeze({
        phase,
        outcome: "failed" as const,
        phaseVersion: PHASE_VERSIONS[phase],
        failureCode: "phase_result_invalid" as const,
      });
      return Object.freeze({
        outcome: "failed",
        transcript: transcript(profile, [...completed, failed]),
      });
    }
    completed.push(receipt);
  }
  return Object.freeze({
    outcome: "succeeded",
    transcript: transcript(profile, completed),
  });
};
