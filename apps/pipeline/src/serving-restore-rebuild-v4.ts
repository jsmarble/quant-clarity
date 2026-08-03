import {
  SERVING_BACKUP_TABLES,
  assertProviderModelIdSearchProjection,
  assertProviderModelIdSearchQueryableArtifactProofV4,
  readProviderModelIdSearchQueryablePersistenceV4,
  type BackupClosureExpectation,
  type BackupManifest,
  type ProviderModelIdSearchQueryableArtifactProofV4,
  type TrustedProviderModelIdSearchProjection,
} from "@quant-clarity/publication-core";

import {
  RESTORE_EXCLUDED_TABLES as RESTORE_EXCLUDED_TABLES_V3,
  RESTORE_SOURCE_TABLES,
  createVerifiedRestoreSourceProfileV1,
  type RestoreClosureSourceV1,
  type RestoreSourceTableV1,
} from "./serving-restore-rebuild-v3.js";

export const RESTORE_SOURCE_PROFILE_VERSION_V4 =
  "backup-v1-restore-source@2" as const;
export const RESTORE_REBUILD_TRANSCRIPT_VERSION_V4 =
  "serving-restore-rebuild@4" as const;
export const RESTORE_SOURCE_PROFILE_VERSION = RESTORE_SOURCE_PROFILE_VERSION_V4;
export const RESTORE_REBUILD_TRANSCRIPT_VERSION =
  RESTORE_REBUILD_TRANSCRIPT_VERSION_V4;

export { RESTORE_SOURCE_TABLES };

export const RESTORE_EXCLUDED_TABLES_V4 = Object.freeze([
  ...RESTORE_EXCLUDED_TABLES_V3,
  "publication_provider_model_id_search_document",
] as const);
export const RESTORE_EXCLUDED_TABLES = RESTORE_EXCLUDED_TABLES_V4;

export const RESTORE_SYNTHETIC_PROBE_IDS_V4 = Object.freeze([
  "restore-v4-provider-exact-match",
  "restore-v4-provider-exact-miss",
  "restore-v4-model-variant-exact-match",
  "restore-v4-model-variant-exact-miss",
  "restore-v4-provider-model-id-raw-exact-match",
  "restore-v4-provider-model-id-raw-exact-miss",
  "restore-v4-provider-model-id-normalized-exact-match",
  "restore-v4-provider-model-id-normalized-exact-miss",
  "restore-v4-version-isolation",
] as const);
export const RESTORE_SYNTHETIC_PROBE_IDS = RESTORE_SYNTHETIC_PROBE_IDS_V4;

const HASH = /^sha256:[0-9a-f]{64}$/u;

const verifiedRestoreSourceProfileV4Brand: unique symbol = Symbol(
  "VerifiedRestoreSourceProfileV4",
);

export type VerifiedRestoreSourceProfileV4 = Readonly<{
  profileVersion: typeof RESTORE_SOURCE_PROFILE_VERSION_V4;
  backupFormatVersion: "1.0.0";
  backupRootHash: string;
  closureSource: RestoreClosureSourceV1;
  materialization: Readonly<{
    destinationSchemaVersion: "1.10.0";
    destinationIsolation: "fresh-local-schema";
    publicationState: "building";
    readyAtMs: null;
    activatedAtMs: null;
    failureCodesJson: "[]";
    closureSealImported: false;
    stagingRevisionImported: false;
    providerModelIdProjectionImported: false;
  }>;
  selectedSources: readonly RestoreSourceTableV1[];
  selectedRowCount: number;
  readonly [verifiedRestoreSourceProfileV4Brand]: true;
}>;

const trustedRestoreSourceProfilesV4 = new WeakSet<object>();

export const createVerifiedRestoreSourceProfileV4 = async (
  manifest: BackupManifest,
  expectedClosure: BackupClosureExpectation,
  source: unknown,
): Promise<VerifiedRestoreSourceProfileV4> => {
  const validated = await createVerifiedRestoreSourceProfileV1(
    manifest,
    expectedClosure,
    source,
  );
  const selected = new Set<string>(RESTORE_SOURCE_TABLES);
  const excluded = new Set<string>(RESTORE_EXCLUDED_TABLES_V4);
  if (
    SERVING_BACKUP_TABLES.some(
      (table) => !selected.has(table) && !excluded.has(table),
    ) ||
    selected.has("publication_provider_model_id_search_document") ||
    !excluded.has("publication_provider_model_id_search_document")
  )
    throw new TypeError("v4 restore table policy is invalid");

  const profile = {
    profileVersion: RESTORE_SOURCE_PROFILE_VERSION_V4,
    backupFormatVersion: validated.backupFormatVersion,
    backupRootHash: validated.backupRootHash,
    closureSource: validated.closureSource,
    materialization: Object.freeze({
      destinationSchemaVersion: "1.10.0" as const,
      destinationIsolation: "fresh-local-schema" as const,
      publicationState: "building" as const,
      readyAtMs: null,
      activatedAtMs: null,
      failureCodesJson: "[]" as const,
      closureSealImported: false as const,
      stagingRevisionImported: false as const,
      providerModelIdProjectionImported: false as const,
    }),
    selectedSources: validated.selectedSources,
    selectedRowCount: validated.selectedRowCount,
  };
  Object.defineProperty(profile, verifiedRestoreSourceProfileV4Brand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedRestoreSourceProfilesV4.add(profile);
  return Object.freeze(profile) as VerifiedRestoreSourceProfileV4;
};

export const assertVerifiedRestoreSourceProfileV4: (
  value: unknown,
) => asserts value is VerifiedRestoreSourceProfileV4 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !trustedRestoreSourceProfilesV4.has(value)
  )
    throw new TypeError("verified v4 restore source profile is required");
};

export const RESTORE_REBUILD_PHASES_V4 = Object.freeze([
  "import",
  "closure",
  "provider_search",
  "model_search",
  "provider_model_id_search",
  "seal",
  "metadata_summary",
  "readiness",
] as const);
export const RESTORE_REBUILD_PHASES = RESTORE_REBUILD_PHASES_V4;
export type RestoreRebuildPhaseV4 = (typeof RESTORE_REBUILD_PHASES_V4)[number];
export type RestoreRebuildPhaseOrSwitchV4 = RestoreRebuildPhaseV4 | "switch";

const PHASE_VERSIONS_V4 = Object.freeze({
  import: "backup-v1-selected-import@1",
  closure: "publication-closure-compare@1",
  provider_search: "provider-search-rebuild@2",
  model_search: "model-variant-name-rebuild@3",
  provider_model_id_search: "provider-model-id-rebuild@4",
  seal: "publication-closure-seal@1",
  metadata_summary: "publication-dataset-metadata-summary@1",
  readiness: "serving-readiness@4",
  switch: "serving-switch@4",
} as const);

export type RestorePhaseCallbackResultV4 = Readonly<{
  outcome: "succeeded";
  phaseVersion: string;
  backupRootHash: string;
  closureHash: string;
  artifactCount: number;
  artifactHash: string;
}>;

export type RestorePhaseReceiptV4 = Readonly<{
  phase: RestoreRebuildPhaseOrSwitchV4;
  outcome: "succeeded";
  phaseVersion: string;
  artifactCount: number;
  artifactHash: string;
}>;

export type ProviderModelIdRestorePhaseCallbackResultV4 =
  RestorePhaseCallbackResultV4 &
    Readonly<{
      projection: TrustedProviderModelIdSearchProjection;
      proof: ProviderModelIdSearchQueryableArtifactProofV4;
    }>;

export type RestoreRebuildPhaseContextV4 = Readonly<{
  profile: VerifiedRestoreSourceProfileV4;
  completed: readonly RestorePhaseReceiptV4[];
}>;

type RestorePhaseCallbackV4 = (
  context: RestoreRebuildPhaseContextV4,
) => Promise<unknown>;

export type RestoreRebuildPortsV4 = Readonly<{
  importSelectedSources: RestorePhaseCallbackV4;
  compareClosure: RestorePhaseCallbackV4;
  rebuildProviderSearch: RestorePhaseCallbackV4;
  rebuildModelSearch: RestorePhaseCallbackV4;
  rebuildProviderModelIdSearch: RestorePhaseCallbackV4;
  createSeal: RestorePhaseCallbackV4;
  rebuildDatasetMetadataSummary: RestorePhaseCallbackV4;
  commitReadinessV4: RestorePhaseCallbackV4;
  switchLocalV4?: RestorePhaseCallbackV4;
}>;

type FailedPhaseV4 = Readonly<{
  phase: RestoreRebuildPhaseOrSwitchV4;
  outcome: "failed";
  phaseVersion: string;
  failureCode:
    "phase_callback_failed" | "phase_result_invalid" | "configuration_invalid";
}>;

export type RestoreRebuildTranscriptV4 = Readonly<{
  transcriptVersion: typeof RESTORE_REBUILD_TRANSCRIPT_VERSION_V4;
  profileVersion: typeof RESTORE_SOURCE_PROFILE_VERSION_V4;
  backupFormatVersion: "1.0.0";
  destinationSchemaVersion: "1.10.0";
  backupRootHash: string;
  closureHash: string;
  selectedTableCount: number;
  selectedRowCount: number;
  syntheticProbeIds: typeof RESTORE_SYNTHETIC_PROBE_IDS_V4;
  phases: readonly (RestorePhaseReceiptV4 | FailedPhaseV4)[];
}>;

export type RestoreRebuildRunV4 = Readonly<{
  outcome: "succeeded" | "failed";
  transcript: RestoreRebuildTranscriptV4;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const baseResultFields = [
  "outcome",
  "phaseVersion",
  "backupRootHash",
  "closureHash",
  "artifactCount",
  "artifactHash",
] as const;

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const ownDataSnapshot = (
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | null => {
  if (!isRecord(value) || !hasExactKeys(value, fields)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    )
      return null;
    snapshot[field] = descriptor.value;
  }
  return Object.freeze(snapshot);
};

const utf8 = new TextEncoder();

const exactUtf8 = (actual: readonly number[], expected: string): boolean => {
  const encoded = utf8.encode(expected);
  if (actual.length !== encoded.byteLength) return false;
  for (let index = 0; index < encoded.byteLength; index += 1)
    if (actual[index] !== encoded[index]) return false;
  return true;
};

const providerModelIdProofMatchesProjection = (
  projection: TrustedProviderModelIdSearchProjection,
  proof: ProviderModelIdSearchQueryableArtifactProofV4,
  profile: VerifiedRestoreSourceProfileV4,
  artifactCount: number,
  artifactHash: string,
): boolean => {
  const persistence =
    readProviderModelIdSearchQueryablePersistenceV4(
      proof,
    ).providerModelIdSearch;
  if (
    persistence.publicationId !== profile.closureSource.publicationId ||
    persistence.closureHash !== profile.closureSource.closureHash ||
    persistence.publicationId !== projection.publicationId ||
    persistence.closureHash !== projection.closureHash ||
    persistence.documentCount !== artifactCount ||
    persistence.documentCount !== projection.documentCount ||
    persistence.inventoryHash !== artifactHash ||
    persistence.inventoryHash !== projection.inventoryHash ||
    persistence.rows.length !== projection.documents.length
  )
    return false;
  for (let index = 0; index < persistence.rows.length; index += 1) {
    const row = persistence.rows[index];
    const document = projection.documents[index];
    if (
      row === undefined ||
      document === undefined ||
      row.publication_id !== profile.closureSource.publicationId ||
      row.offering_id !== document.offeringId ||
      row.provider_id !== document.providerId ||
      row.target_resource_type !== document.resourceType ||
      row.target_resource_id !== document.resourceId ||
      !exactUtf8(row.raw_provider_model_id_utf8, document.rawProviderModelId) ||
      !exactUtf8(
        row.normalized_provider_model_id_utf8,
        document.normalizedProviderModelId,
      ) ||
      row.offering_content_hash !== document.offeringContentHash ||
      row.target_content_hash !== document.targetContentHash
    )
      return false;
  }
  return true;
};

const validatePhaseResultV4 = (
  value: unknown,
  phase: RestoreRebuildPhaseOrSwitchV4,
  profile: VerifiedRestoreSourceProfileV4,
): RestorePhaseReceiptV4 | null => {
  const providerModelIdPhase = phase === "provider_model_id_search";
  const fields = providerModelIdPhase
    ? [...baseResultFields, "projection", "proof"]
    : baseResultFields;
  const candidate = ownDataSnapshot(value, fields);
  if (candidate === null) return null;
  const count = candidate.artifactCount;
  const hash = candidate.artifactHash;
  if (
    candidate.outcome !== "succeeded" ||
    candidate.phaseVersion !== PHASE_VERSIONS_V4[phase] ||
    candidate.backupRootHash !== profile.backupRootHash ||
    candidate.closureHash !== profile.closureSource.closureHash ||
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    typeof hash !== "string" ||
    !HASH.test(hash)
  )
    return null;
  if (
    (phase === "import" &&
      (count !== profile.selectedRowCount ||
        hash !== profile.closureSource.manifestInputHash)) ||
    (phase === "closure" &&
      (count !== 1 || hash !== profile.closureSource.closureHash)) ||
    ((phase === "provider_search" || phase === "model_search") &&
      count > profile.closureSource.resourceCount) ||
    ((phase === "seal" ||
      phase === "metadata_summary" ||
      phase === "readiness" ||
      phase === "switch") &&
      count !== 1) ||
    (phase === "seal" && hash !== profile.closureSource.closureHash)
  )
    return null;
  if (providerModelIdPhase) {
    try {
      assertProviderModelIdSearchProjection(candidate.projection);
      assertProviderModelIdSearchQueryableArtifactProofV4(candidate.proof);
    } catch {
      return null;
    }
    const projection = candidate.projection;
    const proof = candidate.proof;
    if (
      projection.publicationId !== profile.closureSource.publicationId ||
      projection.closureHash !== profile.closureSource.closureHash ||
      projection.documentCount !== count ||
      projection.inventoryHash !== hash ||
      proof.provider_model_id_document_count !== count ||
      proof.provider_model_id_storage_document_count !== count ||
      proof.provider_model_id_inventory_hash !== hash ||
      !providerModelIdProofMatchesProjection(
        projection,
        proof,
        profile,
        count,
        hash,
      )
    )
      return null;
  }
  return Object.freeze({
    phase,
    outcome: "succeeded" as const,
    phaseVersion: PHASE_VERSIONS_V4[phase],
    artifactCount: count,
    artifactHash: hash,
  });
};

const transcriptV4 = (
  profile: VerifiedRestoreSourceProfileV4,
  phases: RestoreRebuildTranscriptV4["phases"],
): RestoreRebuildTranscriptV4 =>
  Object.freeze({
    transcriptVersion: RESTORE_REBUILD_TRANSCRIPT_VERSION_V4,
    profileVersion: RESTORE_SOURCE_PROFILE_VERSION_V4,
    backupFormatVersion: "1.0.0",
    destinationSchemaVersion: "1.10.0",
    backupRootHash: profile.backupRootHash,
    closureHash: profile.closureSource.closureHash,
    selectedTableCount: profile.selectedSources.length,
    selectedRowCount: profile.selectedRowCount,
    syntheticProbeIds: RESTORE_SYNTHETIC_PROBE_IDS_V4,
    phases: Object.freeze([...phases]),
  });

const portFieldsV4 = [
  "importSelectedSources",
  "compareClosure",
  "rebuildProviderSearch",
  "rebuildModelSearch",
  "rebuildProviderModelIdSearch",
  "createSeal",
  "rebuildDatasetMetadataSummary",
  "commitReadinessV4",
] as const;

const configurationFailureV4 = (
  profile: VerifiedRestoreSourceProfileV4,
): RestoreRebuildRunV4 =>
  Object.freeze({
    outcome: "failed",
    transcript: transcriptV4(profile, [
      Object.freeze({
        phase: "switch" as const,
        outcome: "failed" as const,
        phaseVersion: PHASE_VERSIONS_V4.switch,
        failureCode: "configuration_invalid" as const,
      }),
    ]),
  });

/** Deterministic local recovery seam. It imports no literal derived state. */
export const runLocalServingRestoreRebuildV4 = async (
  profile: VerifiedRestoreSourceProfileV4,
  ports: RestoreRebuildPortsV4,
  options: Readonly<{ enableLocalSwitch?: boolean }> = Object.freeze({}),
): Promise<RestoreRebuildRunV4> => {
  assertVerifiedRestoreSourceProfileV4(profile);
  const completed: RestorePhaseReceiptV4[] = [];
  const portRecord: unknown = ports;
  const optionRecord: unknown = options;
  let callbacks: Readonly<
    Record<RestoreRebuildPhaseOrSwitchV4, RestorePhaseCallbackV4 | undefined>
  >;
  let enableLocalSwitch: boolean;
  try {
    if (!isRecord(portRecord) || !isRecord(optionRecord))
      return configurationFailureV4(profile);
    const optionKeys = Object.keys(optionRecord);
    if (
      optionKeys.some((key) => key !== "enableLocalSwitch") ||
      (Object.hasOwn(optionRecord, "enableLocalSwitch") &&
        typeof optionRecord.enableLocalSwitch !== "boolean")
    )
      return configurationFailureV4(profile);
    enableLocalSwitch = optionRecord.enableLocalSwitch === true;
    const actualPortKeys = Object.keys(portRecord);
    if (
      actualPortKeys.some(
        (key) =>
          !portFieldsV4.includes(key as (typeof portFieldsV4)[number]) &&
          key !== "switchLocalV4",
      ) ||
      portFieldsV4.some((field) => !actualPortKeys.includes(field))
    )
      return configurationFailureV4(profile);
    const callbackValues = Object.fromEntries(
      portFieldsV4.map((field) => [field, portRecord[field]]),
    ) as Record<(typeof portFieldsV4)[number], unknown>;
    const switchCallback = Object.hasOwn(portRecord, "switchLocalV4")
      ? portRecord.switchLocalV4
      : undefined;
    if (
      !portFieldsV4.every(
        (field) => typeof callbackValues[field] === "function",
      ) ||
      (switchCallback !== undefined && typeof switchCallback !== "function") ||
      (enableLocalSwitch && typeof switchCallback !== "function")
    )
      return configurationFailureV4(profile);
    callbacks = Object.freeze({
      import: callbackValues.importSelectedSources as RestorePhaseCallbackV4,
      closure: callbackValues.compareClosure as RestorePhaseCallbackV4,
      provider_search:
        callbackValues.rebuildProviderSearch as RestorePhaseCallbackV4,
      model_search: callbackValues.rebuildModelSearch as RestorePhaseCallbackV4,
      provider_model_id_search:
        callbackValues.rebuildProviderModelIdSearch as RestorePhaseCallbackV4,
      seal: callbackValues.createSeal as RestorePhaseCallbackV4,
      metadata_summary:
        callbackValues.rebuildDatasetMetadataSummary as RestorePhaseCallbackV4,
      readiness: callbackValues.commitReadinessV4 as RestorePhaseCallbackV4,
      switch: switchCallback as RestorePhaseCallbackV4 | undefined,
    });
  } catch {
    return configurationFailureV4(profile);
  }

  const phases: readonly RestoreRebuildPhaseOrSwitchV4[] = enableLocalSwitch
    ? [...RESTORE_REBUILD_PHASES_V4, "switch"]
    : RESTORE_REBUILD_PHASES_V4;
  for (const phase of phases) {
    const callback = callbacks[phase];
    if (callback === undefined) return configurationFailureV4(profile);
    let rawResult: unknown;
    try {
      rawResult = await callback(
        Object.freeze({
          profile,
          completed: Object.freeze([...completed]),
        }),
      );
    } catch {
      return Object.freeze({
        outcome: "failed",
        transcript: transcriptV4(profile, [
          ...completed,
          Object.freeze({
            phase,
            outcome: "failed" as const,
            phaseVersion: PHASE_VERSIONS_V4[phase],
            failureCode: "phase_callback_failed" as const,
          }),
        ]),
      });
    }
    let receipt: RestorePhaseReceiptV4 | null;
    try {
      receipt = validatePhaseResultV4(rawResult, phase, profile);
    } catch {
      receipt = null;
    }
    if (receipt === null)
      return Object.freeze({
        outcome: "failed",
        transcript: transcriptV4(profile, [
          ...completed,
          Object.freeze({
            phase,
            outcome: "failed" as const,
            phaseVersion: PHASE_VERSIONS_V4[phase],
            failureCode: "phase_result_invalid" as const,
          }),
        ]),
      });
    completed.push(receipt);
  }
  return Object.freeze({
    outcome: "succeeded",
    transcript: transcriptV4(profile, completed),
  });
};
