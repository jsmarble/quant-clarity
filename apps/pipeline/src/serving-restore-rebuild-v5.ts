import type {
  BackupClosureExpectation,
  BackupManifest,
} from "@quant-clarity/publication-core";

import type {
  RestoreClosureSourceV1,
  RestoreSourceTableV1,
} from "./serving-restore-rebuild-v3.js";
import {
  RESTORE_EXCLUDED_TABLES_V4,
  RESTORE_REBUILD_PHASES_V4,
  RESTORE_SOURCE_TABLES,
  createVerifiedRestoreSourceProfileV4,
  runLocalServingRestoreRebuildV4,
  type ProviderModelIdRestorePhaseCallbackResultV4,
  type RestorePhaseCallbackResultV4,
  type RestorePhaseReceiptV4,
  type RestoreRebuildPortsV4,
  type RestoreRebuildRunV4,
  type VerifiedRestoreSourceProfileV4,
} from "./serving-restore-rebuild-v4.js";

export const RESTORE_SOURCE_PROFILE_VERSION_V5 =
  "backup-v1-restore-source@3" as const;
export const RESTORE_REBUILD_TRANSCRIPT_VERSION_V5 =
  "serving-restore-rebuild@5" as const;
export const RESTORE_SOURCE_PROFILE_VERSION = RESTORE_SOURCE_PROFILE_VERSION_V5;
export const RESTORE_REBUILD_TRANSCRIPT_VERSION =
  RESTORE_REBUILD_TRANSCRIPT_VERSION_V5;

export { RESTORE_SOURCE_TABLES };

export const RESTORE_EXCLUDED_TABLES_V5 = RESTORE_EXCLUDED_TABLES_V4;
export const RESTORE_EXCLUDED_TABLES = RESTORE_EXCLUDED_TABLES_V5;

export const RESTORE_SYNTHETIC_PROBE_IDS_V5 = Object.freeze([
  "restore-v5-provider-exact-match",
  "restore-v5-provider-exact-miss",
  "restore-v5-model-variant-exact-match",
  "restore-v5-model-variant-exact-miss",
  "restore-v5-provider-model-id-raw-exact-match",
  "restore-v5-provider-model-id-raw-exact-miss",
  "restore-v5-provider-model-id-normalized-exact-match",
  "restore-v5-provider-model-id-normalized-exact-miss",
  "restore-v5-version-isolation",
] as const);
export const RESTORE_SYNTHETIC_PROBE_IDS = RESTORE_SYNTHETIC_PROBE_IDS_V5;

const verifiedRestoreSourceProfileV5Brand: unique symbol = Symbol(
  "VerifiedRestoreSourceProfileV5",
);

export type VerifiedRestoreSourceProfileV5 = Readonly<{
  profileVersion: typeof RESTORE_SOURCE_PROFILE_VERSION_V5;
  backupFormatVersion: "1.0.0";
  backupRootHash: string;
  closureSource: RestoreClosureSourceV1;
  materialization: Readonly<{
    destinationSchemaVersion: "1.11.0";
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
  readonly [verifiedRestoreSourceProfileV5Brand]: true;
}>;

const trustedRestoreSourceProfilesV5 = new WeakMap<
  object,
  VerifiedRestoreSourceProfileV4
>();

export const createVerifiedRestoreSourceProfileV5 = async (
  manifest: BackupManifest,
  expectedClosure: BackupClosureExpectation,
  source: unknown,
): Promise<VerifiedRestoreSourceProfileV5> => {
  const validatedV4 = await createVerifiedRestoreSourceProfileV4(
    manifest,
    expectedClosure,
    source,
  );
  const profile = {
    profileVersion: RESTORE_SOURCE_PROFILE_VERSION_V5,
    backupFormatVersion: validatedV4.backupFormatVersion,
    backupRootHash: validatedV4.backupRootHash,
    closureSource: validatedV4.closureSource,
    materialization: Object.freeze({
      destinationSchemaVersion: "1.11.0" as const,
      destinationIsolation: "fresh-local-schema" as const,
      publicationState: "building" as const,
      readyAtMs: null,
      activatedAtMs: null,
      failureCodesJson: "[]" as const,
      closureSealImported: false as const,
      stagingRevisionImported: false as const,
      providerModelIdProjectionImported: false as const,
    }),
    selectedSources: validatedV4.selectedSources,
    selectedRowCount: validatedV4.selectedRowCount,
  };
  Object.defineProperty(profile, verifiedRestoreSourceProfileV5Brand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedRestoreSourceProfilesV5.set(profile, validatedV4);
  return Object.freeze(profile) as VerifiedRestoreSourceProfileV5;
};

export const assertVerifiedRestoreSourceProfileV5: (
  value: unknown,
) => asserts value is VerifiedRestoreSourceProfileV5 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !trustedRestoreSourceProfilesV5.has(value)
  )
    throw new TypeError("verified v5 restore source profile is required");
};

export const RESTORE_REBUILD_PHASES_V5 = RESTORE_REBUILD_PHASES_V4;
export const RESTORE_REBUILD_PHASES = RESTORE_REBUILD_PHASES_V5;
export type RestoreRebuildPhaseV5 = (typeof RESTORE_REBUILD_PHASES_V5)[number];
export type RestoreRebuildPhaseOrSwitchV5 = RestoreRebuildPhaseV5 | "switch";

export type RestorePhaseCallbackResultV5 = RestorePhaseCallbackResultV4;
export type ProviderModelIdRestorePhaseCallbackResultV5 =
  ProviderModelIdRestorePhaseCallbackResultV4;
export type RestorePhaseReceiptV5 = RestorePhaseReceiptV4;

export type RestoreRebuildPhaseContextV5 = Readonly<{
  profile: VerifiedRestoreSourceProfileV5;
  completed: readonly RestorePhaseReceiptV5[];
}>;

type RestorePhaseCallbackV5 = (
  context: RestoreRebuildPhaseContextV5,
) => Promise<unknown>;

export type RestoreRebuildPortsV5 = Readonly<{
  importSelectedSources: RestorePhaseCallbackV5;
  compareClosure: RestorePhaseCallbackV5;
  rebuildProviderSearch: RestorePhaseCallbackV5;
  rebuildModelSearch: RestorePhaseCallbackV5;
  rebuildProviderModelIdSearch: RestorePhaseCallbackV5;
  createSeal: RestorePhaseCallbackV5;
  rebuildDatasetMetadataSummary: RestorePhaseCallbackV5;
  commitReadinessV4: RestorePhaseCallbackV5;
  switchLocalV5?: RestorePhaseCallbackV5;
}>;

type FailedPhaseV5 = Readonly<{
  phase: RestoreRebuildPhaseOrSwitchV5;
  outcome: "failed";
  phaseVersion: string;
  failureCode:
    "phase_callback_failed" | "phase_result_invalid" | "configuration_invalid";
}>;

export type RestoreRebuildTranscriptV5 = Readonly<{
  transcriptVersion: typeof RESTORE_REBUILD_TRANSCRIPT_VERSION_V5;
  profileVersion: typeof RESTORE_SOURCE_PROFILE_VERSION_V5;
  backupFormatVersion: "1.0.0";
  destinationSchemaVersion: "1.11.0";
  backupRootHash: string;
  closureHash: string;
  selectedTableCount: number;
  selectedRowCount: number;
  syntheticProbeIds: typeof RESTORE_SYNTHETIC_PROBE_IDS_V5;
  phases: readonly (RestorePhaseReceiptV5 | FailedPhaseV5)[];
}>;

export type RestoreRebuildRunV5 = Readonly<{
  outcome: "succeeded" | "failed";
  transcript: RestoreRebuildTranscriptV5;
}>;

const portFieldsV5 = [
  "importSelectedSources",
  "compareClosure",
  "rebuildProviderSearch",
  "rebuildModelSearch",
  "rebuildProviderModelIdSearch",
  "createSeal",
  "rebuildDatasetMetadataSummary",
  "commitReadinessV4",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type V5Configuration = Readonly<{
  callbacks: Readonly<
    Record<(typeof portFieldsV5)[number], RestorePhaseCallbackV5>
  >;
  switchCallback: RestorePhaseCallbackV5 | undefined;
  enableLocalSwitch: boolean;
}>;

const snapshotV5Configuration = (
  ports: unknown,
  options: unknown,
): V5Configuration | null => {
  try {
    if (!isRecord(ports) || !isRecord(options)) return null;
    const optionKeys = Object.keys(options);
    if (
      optionKeys.some((key) => key !== "enableLocalSwitch") ||
      (Object.hasOwn(options, "enableLocalSwitch") &&
        typeof options.enableLocalSwitch !== "boolean")
    )
      return null;
    const enableLocalSwitch = options.enableLocalSwitch === true;
    const actualPortKeys = Object.keys(ports);
    if (
      actualPortKeys.some(
        (key) =>
          !portFieldsV5.includes(key as (typeof portFieldsV5)[number]) &&
          key !== "switchLocalV5",
      ) ||
      portFieldsV5.some((field) => !actualPortKeys.includes(field))
    )
      return null;
    const callbackValues = Object.fromEntries(
      portFieldsV5.map((field) => [field, ports[field]]),
    ) as Record<(typeof portFieldsV5)[number], unknown>;
    const switchCallback = Object.hasOwn(ports, "switchLocalV5")
      ? ports.switchLocalV5
      : undefined;
    if (
      !portFieldsV5.every(
        (field) => typeof callbackValues[field] === "function",
      ) ||
      (switchCallback !== undefined && typeof switchCallback !== "function") ||
      (enableLocalSwitch && typeof switchCallback !== "function")
    )
      return null;
    return Object.freeze({
      callbacks: Object.freeze(
        callbackValues as Record<
          (typeof portFieldsV5)[number],
          RestorePhaseCallbackV5
        >,
      ),
      switchCallback: switchCallback as RestorePhaseCallbackV5 | undefined,
      enableLocalSwitch,
    });
  } catch {
    return null;
  }
};

const mapV4Run = (run: RestoreRebuildRunV4): RestoreRebuildRunV5 =>
  Object.freeze({
    outcome: run.outcome,
    transcript: Object.freeze({
      transcriptVersion: RESTORE_REBUILD_TRANSCRIPT_VERSION_V5,
      profileVersion: RESTORE_SOURCE_PROFILE_VERSION_V5,
      backupFormatVersion: run.transcript.backupFormatVersion,
      destinationSchemaVersion: "1.11.0" as const,
      backupRootHash: run.transcript.backupRootHash,
      closureHash: run.transcript.closureHash,
      selectedTableCount: run.transcript.selectedTableCount,
      selectedRowCount: run.transcript.selectedRowCount,
      syntheticProbeIds: RESTORE_SYNTHETIC_PROBE_IDS_V5,
      phases: Object.freeze([...run.transcript.phases]),
    }),
  });

/** Schema-1.11 recovery boundary; v4 remains pinned to schema 1.10. */
export const runLocalServingRestoreRebuildV5 = async (
  profile: VerifiedRestoreSourceProfileV5,
  ports: RestoreRebuildPortsV5,
  options: Readonly<{ enableLocalSwitch?: boolean }> = Object.freeze({}),
): Promise<RestoreRebuildRunV5> => {
  assertVerifiedRestoreSourceProfileV5(profile);
  const v4Profile = trustedRestoreSourceProfilesV5.get(profile);
  if (v4Profile === undefined)
    throw new TypeError("verified v5 restore source profile is required");

  const configuration = snapshotV5Configuration(ports, options);
  if (configuration === null)
    return mapV4Run(
      await runLocalServingRestoreRebuildV4(
        v4Profile,
        {} as RestoreRebuildPortsV4,
      ),
    );

  const adapt =
    (callback: RestorePhaseCallbackV5) =>
    (context: Readonly<{ completed: readonly RestorePhaseReceiptV4[] }>) =>
      callback(
        Object.freeze({
          profile,
          completed: context.completed,
        }),
      );
  const v4Ports: RestoreRebuildPortsV4 = {
    importSelectedSources: adapt(configuration.callbacks.importSelectedSources),
    compareClosure: adapt(configuration.callbacks.compareClosure),
    rebuildProviderSearch: adapt(configuration.callbacks.rebuildProviderSearch),
    rebuildModelSearch: adapt(configuration.callbacks.rebuildModelSearch),
    rebuildProviderModelIdSearch: adapt(
      configuration.callbacks.rebuildProviderModelIdSearch,
    ),
    createSeal: adapt(configuration.callbacks.createSeal),
    rebuildDatasetMetadataSummary: adapt(
      configuration.callbacks.rebuildDatasetMetadataSummary,
    ),
    commitReadinessV4: adapt(configuration.callbacks.commitReadinessV4),
    ...(configuration.switchCallback === undefined
      ? {}
      : { switchLocalV4: adapt(configuration.switchCallback) }),
  };
  return mapV4Run(
    await runLocalServingRestoreRebuildV4(v4Profile, v4Ports, {
      enableLocalSwitch: configuration.enableLocalSwitch,
    }),
  );
};
