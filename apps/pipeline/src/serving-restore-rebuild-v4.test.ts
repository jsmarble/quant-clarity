import { describe, expect, it, vi } from "vitest";

import {
  SERVING_BACKUP_TABLES,
  buildBackupRootHash,
  projectProviderModelIdSearchArtifactProofV1,
  projectProviderModelIdSearchProjection,
  projectProviderModelIdSearchQueryabilityPlanV4,
  projectProviderModelIdSearchQueryableArtifactProofV4,
  type BackupClosureExpectation,
  type BackupManifest,
} from "@quant-clarity/publication-core";

import { createProviderModelIdSearchFixture } from "../test/provider-model-id-search-fixture.js";
import {
  RESTORE_EXCLUDED_TABLES_V4,
  RESTORE_REBUILD_PHASES_V4,
  RESTORE_SOURCE_TABLES,
  RESTORE_SYNTHETIC_PROBE_IDS_V4,
  createVerifiedRestoreSourceProfileV4,
  runLocalServingRestoreRebuildV4,
  type RestorePhaseCallbackResultV4,
  type RestoreRebuildPhaseContextV4,
  type RestoreRebuildPhaseOrSwitchV4,
  type RestoreRebuildPortsV4,
  type VerifiedRestoreSourceProfileV4,
} from "./serving-restore-rebuild-v4.js";
import {
  RESTORE_REBUILD_PHASES_V5,
  RESTORE_SYNTHETIC_PROBE_IDS_V5,
  createVerifiedRestoreSourceProfileV5,
  runLocalServingRestoreRebuildV5,
  type RestoreRebuildPhaseContextV5,
  type RestoreRebuildPhaseOrSwitchV5,
  type RestoreRebuildPortsV5,
  type VerifiedRestoreSourceProfileV5,
} from "./serving-restore-rebuild-v5.js";

const PUBLICATION_ID = "pub_00000000-0000-4000-8000-000000000001" as const;
const CROSS_PUBLICATION_ID =
  "pub_00000000-0000-4000-8000-000000000002" as const;
const GENERATED_AT_MS = Date.parse("2026-08-02T00:00:00.000Z");
const HASH_C = `sha256:${"c".repeat(64)}` as const;

const createRestoreFixture = async (
  publicationId: `pub_${string}` = PUBLICATION_ID,
) => {
  const source = await createProviderModelIdSearchFixture(
    publicationId,
    GENERATED_AT_MS,
  );
  const providerModelIdProjection =
    await projectProviderModelIdSearchProjection({
      manifest: source.manifest,
      resources: source.closureRows.resources.filter(
        (resource) =>
          resource.resource_type === "offering" ||
          resource.resource_type === "model" ||
          resource.resource_type === "variant",
      ),
    });
  const storageProof = projectProviderModelIdSearchArtifactProofV1({
    staging: source.staging,
    observation: {
      storageVersion: source.persistence.storageVersion,
      rows: source.persistence.rows,
    },
  });
  const providerModelIdProof =
    projectProviderModelIdSearchQueryableArtifactProofV4({
      storageProof,
      queryability:
        projectProviderModelIdSearchQueryabilityPlanV4(storageProof),
    });
  return Object.freeze({
    base: Object.freeze({
      manifest: source.manifest,
      closureRows: source.closureRows,
    }),
    providerModelIdProjection,
    providerModelIdProof,
  });
};

type Fixture = Awaited<ReturnType<typeof createRestoreFixture>>;

const backupFor = async (fixture: Fixture): Promise<BackupManifest> => {
  const rows: Readonly<Record<string, number>> = Object.freeze({
    publication: 1,
    publication_provider_slice: fixture.base.closureRows.providerSlices.length,
    publication_provider_slice_metadata:
      fixture.base.closureRows.providerSlices.length,
    publication_provider_attribution:
      fixture.base.closureRows.providerAttributions.length,
    publication_resource: fixture.base.closureRows.resources.length,
    publication_search_document:
      fixture.base.closureRows.searchDocuments.length,
    publication_vector_inventory: fixture.base.closureRows.vectors.length,
    publication_inventory_chunk: fixture.base.closureRows.chunks.length,
    publication_dataset_metadata_summary: 1,
  });
  const tables = SERVING_BACKUP_TABLES.map((table) => {
    const rowCount = rows[table] ?? 0;
    return {
      table,
      chunkCount: rowCount === 0 ? 0 : 1,
      rowCount,
      byteCount: rowCount * 10,
    };
  });
  const chunks = tables.flatMap((table) =>
    table.rowCount === 0
      ? []
      : [
          {
            table: table.table,
            ordinal: 0,
            firstKey: `${table.table}:first`,
            lastKey: `${table.table}:last`,
            rowCount: table.rowCount,
            byteCount: table.byteCount,
            contentHash: HASH_C,
          },
        ],
  );
  const manifest = fixture.base.manifest;
  const withoutRoot: Omit<BackupManifest, "rootHash"> = {
    formatVersion: "1.0.0",
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    canonicalStartBoundary: "bookmark:restore-v4",
    canonicalEndBoundary: "bookmark:restore-v4",
    writerLeaseDrained: true,
    ordinaryTablesOnly: true,
    searchDocumentsIncluded: true,
    expectedProviderSliceCount: manifest.providerSlices.length,
    expectedResourceCount: manifest.resources.length,
    expectedSearchDocumentCount: manifest.searchDocuments.length,
    tables,
    chunks,
  };
  return Object.freeze({
    ...withoutRoot,
    rootHash: await buildBackupRootHash(withoutRoot),
  });
};

const profileFor = async (
  fixture: Fixture,
  servingSchemaVersion = "1.11.0",
): Promise<VerifiedRestoreSourceProfileV4> => {
  const manifest = fixture.base.manifest;
  const expected: BackupClosureExpectation = {
    servingSchemaVersion,
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    providerSliceCount: manifest.providerSlices.length,
    resourceCount: manifest.resources.length,
    searchDocumentCount: manifest.searchDocuments.length,
  };
  return createVerifiedRestoreSourceProfileV4(
    await backupFor(fixture),
    expected,
    {
      sourceSchemaVersion: manifest.versions.schema,
      manifestContractVersion: manifest.contractVersion,
      hashDomain: "publication-closure",
      hashEncodingVersion: "1",
      enabledProviderScopeVersion: manifest.enabledProviderScopeVersion,
      publicationId: manifest.publicationId,
      closureHash: manifest.closureHash,
      bundleHash: manifest.bundleHash,
      enabledProviderScopeHash: manifest.enabledProviderScopeHash,
      providerSliceHash: manifest.providerSliceHash,
      providerAttributionHash: manifest.providerAttributionHash,
      resourceInventoryHash: manifest.resourceInventoryHash,
      exactSearchInventoryHash: manifest.exactSearchInventoryHash,
      vectorInventoryHash: manifest.vectorInventoryHash,
      chunkRootHash: manifest.chunkRootHash,
      manifestInputHash: HASH_C,
      providerSliceCount: manifest.providerSlices.length,
      providerSliceMetadataCount: manifest.providerSlices.length,
      providerAttributionCount: manifest.providerAttributions.length,
      resourceCount: manifest.resources.length,
      searchDocumentCount: manifest.searchDocuments.length,
      vectorDocumentCount: manifest.vectors.length,
      inventoryChunkCount: manifest.chunks.length,
    },
  );
};

const profileForV5 = async (
  fixture: Fixture,
  servingSchemaVersion = "1.11.0",
): Promise<VerifiedRestoreSourceProfileV5> => {
  const manifest = fixture.base.manifest;
  const expected: BackupClosureExpectation = {
    servingSchemaVersion,
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    providerSliceCount: manifest.providerSlices.length,
    resourceCount: manifest.resources.length,
    searchDocumentCount: manifest.searchDocuments.length,
  };
  return createVerifiedRestoreSourceProfileV5(
    await backupFor(fixture),
    expected,
    {
      sourceSchemaVersion: manifest.versions.schema,
      manifestContractVersion: manifest.contractVersion,
      hashDomain: "publication-closure",
      hashEncodingVersion: "1",
      enabledProviderScopeVersion: manifest.enabledProviderScopeVersion,
      publicationId: manifest.publicationId,
      closureHash: manifest.closureHash,
      bundleHash: manifest.bundleHash,
      enabledProviderScopeHash: manifest.enabledProviderScopeHash,
      providerSliceHash: manifest.providerSliceHash,
      providerAttributionHash: manifest.providerAttributionHash,
      resourceInventoryHash: manifest.resourceInventoryHash,
      exactSearchInventoryHash: manifest.exactSearchInventoryHash,
      vectorInventoryHash: manifest.vectorInventoryHash,
      chunkRootHash: manifest.chunkRootHash,
      manifestInputHash: HASH_C,
      providerSliceCount: manifest.providerSlices.length,
      providerSliceMetadataCount: manifest.providerSlices.length,
      providerAttributionCount: manifest.providerAttributions.length,
      resourceCount: manifest.resources.length,
      searchDocumentCount: manifest.searchDocuments.length,
      vectorDocumentCount: manifest.vectors.length,
      inventoryChunkCount: manifest.chunks.length,
    },
  );
};

const versions: Readonly<Record<RestoreRebuildPhaseOrSwitchV4, string>> =
  Object.freeze({
    import: "backup-v1-selected-import@1",
    closure: "publication-closure-compare@1",
    provider_search: "provider-search-rebuild@2",
    model_search: "model-variant-name-rebuild@3",
    provider_model_id_search: "provider-model-id-rebuild@4",
    seal: "publication-closure-seal@1",
    metadata_summary: "publication-dataset-metadata-summary@1",
    readiness: "serving-readiness@4",
    switch: "serving-switch@4",
  });

const resultFor = (
  profile: VerifiedRestoreSourceProfileV4 | VerifiedRestoreSourceProfileV5,
  fixture: Fixture,
  phase: RestoreRebuildPhaseOrSwitchV4,
): RestorePhaseCallbackResultV4 & Record<string, unknown> => {
  const providerModelId = phase === "provider_model_id_search";
  return {
    outcome: "succeeded",
    phaseVersion: versions[phase],
    backupRootHash: profile.backupRootHash,
    closureHash: profile.closureSource.closureHash,
    artifactCount:
      phase === "import"
        ? profile.selectedRowCount
        : providerModelId
          ? fixture.providerModelIdProjection.documentCount
          : 1,
    artifactHash:
      phase === "import"
        ? profile.closureSource.manifestInputHash
        : phase === "closure" || phase === "seal"
          ? profile.closureSource.closureHash
          : providerModelId
            ? fixture.providerModelIdProjection.inventoryHash
            : HASH_C,
    ...(providerModelId
      ? {
          projection: fixture.providerModelIdProjection,
          proof: fixture.providerModelIdProof,
        }
      : {}),
  };
};

const portsForV5 = (
  profile: VerifiedRestoreSourceProfileV5,
  fixture: Fixture,
  calls: RestoreRebuildPhaseOrSwitchV5[],
): RestoreRebuildPortsV5 => {
  const callback =
    (phase: RestoreRebuildPhaseOrSwitchV5) =>
    (context: RestoreRebuildPhaseContextV5): Promise<unknown> => {
      calls.push(phase);
      expect(context.profile).toBe(profile);
      expect(context.completed.map((receipt) => receipt.phase)).toEqual(
        calls.slice(0, -1),
      );
      return Promise.resolve(resultFor(profile, fixture, phase));
    };
  return {
    importSelectedSources: callback("import"),
    compareClosure: callback("closure"),
    rebuildProviderSearch: callback("provider_search"),
    rebuildModelSearch: callback("model_search"),
    rebuildProviderModelIdSearch: callback("provider_model_id_search"),
    createSeal: callback("seal"),
    rebuildDatasetMetadataSummary: callback("metadata_summary"),
    commitReadinessV4: callback("readiness"),
    switchLocalV5: callback("switch"),
  };
};

const portsFor = (
  profile: VerifiedRestoreSourceProfileV4,
  fixture: Fixture,
  calls: RestoreRebuildPhaseOrSwitchV4[],
  overrideProviderModelId?: () => unknown,
): RestoreRebuildPortsV4 => {
  const callback =
    (phase: RestoreRebuildPhaseOrSwitchV4) =>
    (context: RestoreRebuildPhaseContextV4): Promise<unknown> => {
      calls.push(phase);
      expect(context.profile).toBe(profile);
      expect(context.completed.map((receipt) => receipt.phase)).toEqual(
        calls.slice(0, -1),
      );
      if (phase === "provider_model_id_search" && overrideProviderModelId)
        return Promise.resolve(overrideProviderModelId());
      return Promise.resolve(resultFor(profile, fixture, phase));
    };
  return {
    importSelectedSources: callback("import"),
    compareClosure: callback("closure"),
    rebuildProviderSearch: callback("provider_search"),
    rebuildModelSearch: callback("model_search"),
    rebuildProviderModelIdSearch: callback("provider_model_id_search"),
    createSeal: callback("seal"),
    rebuildDatasetMetadataSummary: callback("metadata_summary"),
    commitReadinessV4: callback("readiness"),
    switchLocalV4: callback("switch"),
  };
};

describe("serving restore rebuild v4", () => {
  it.each(["1.12.0", "1.13.0"])(
    "rejects legacy v4 restore authority for serving schema %s",
    async (servingSchemaVersion) => {
      const fixture = await createRestoreFixture();
      await expect(
        profileFor(fixture, servingSchemaVersion),
      ).rejects.toMatchObject({ code: "backup_manifest_invalid" });
    },
  );

  it("keeps backup-v1 closed and explicitly excludes every derived table", async () => {
    const fixture = await createRestoreFixture();
    const profile = await profileFor(fixture);
    expect(profile.backupFormatVersion).toBe("1.0.0");
    expect(profile.materialization).toMatchObject({
      destinationSchemaVersion: "1.10.0",
      publicationState: "building",
      closureSealImported: false,
      stagingRevisionImported: false,
      providerModelIdProjectionImported: false,
    });
    expect(RESTORE_SOURCE_TABLES).not.toContain(
      "publication_provider_model_id_search_document",
    );
    expect(RESTORE_EXCLUDED_TABLES_V4).toContain(
      "publication_provider_model_id_search_document",
    );
    expect(RESTORE_EXCLUDED_TABLES_V4).toEqual(
      expect.arrayContaining([
        "serving_schema_metadata",
        "publication_closure_seal",
        "publication_dataset_metadata_summary",
        "publication_staging_revision",
        "publication_readiness_receipt",
        "publication_readiness_attestation",
        "publication_switch_preflight",
        "publication_switch_history",
        "publication_head",
      ]),
    );
  });

  it("runs the fixed v4 rebuild order and does not switch by default", async () => {
    const fixture = await createRestoreFixture();
    const profile = await profileFor(fixture);
    const calls: RestoreRebuildPhaseOrSwitchV4[] = [];
    const run = await runLocalServingRestoreRebuildV4(
      profile,
      portsFor(profile, fixture, calls),
    );
    expect(run.outcome).toBe("succeeded");
    expect(calls).toEqual(RESTORE_REBUILD_PHASES_V4);
    expect(run.transcript).toMatchObject({
      transcriptVersion: "serving-restore-rebuild@4",
      destinationSchemaVersion: "1.10.0",
      syntheticProbeIds: RESTORE_SYNTHETIC_PROBE_IDS_V4,
    });
    expect(run.transcript.phases.map((phase) => phase.phase)).not.toContain(
      "switch",
    );
  });

  it("rejects lower-trust byte, normalization, provider, target, and content-hash reports before seal", async () => {
    const fixture = await createRestoreFixture();
    const profile = await profileFor(fixture);
    const calls: RestoreRebuildPhaseOrSwitchV4[] = [];
    const valid = resultFor(profile, fixture, "provider_model_id_search");
    const run = await runLocalServingRestoreRebuildV4(
      profile,
      portsFor(profile, fixture, calls, () => ({
        ...valid,
        proof: { ...fixture.providerModelIdProof },
      })),
    );
    expect(run.outcome).toBe("failed");
    expect(run.transcript.phases.at(-1)).toMatchObject({
      phase: "provider_model_id_search",
      failureCode: "phase_result_invalid",
    });
    expect(calls).not.toContain("seal");
    expect(calls).not.toContain("switch");
  });

  it("rejects an identical-inventory proof from another publication before seal", async () => {
    const fixture = await createRestoreFixture();
    const crossPublication = await createRestoreFixture(CROSS_PUBLICATION_ID);
    const profile = await profileFor(fixture);
    expect(crossPublication.providerModelIdProjection.inventoryHash).toBe(
      fixture.providerModelIdProjection.inventoryHash,
    );
    const calls: RestoreRebuildPhaseOrSwitchV4[] = [];
    const valid = resultFor(profile, fixture, "provider_model_id_search");
    const ports = portsFor(profile, fixture, calls, () => ({
      ...valid,
      proof: crossPublication.providerModelIdProof,
    }));
    const createSeal = vi.fn(ports.createSeal);
    const run = await runLocalServingRestoreRebuildV4(profile, {
      ...ports,
      createSeal,
    });
    expect(run.outcome).toBe("failed");
    expect(run.transcript.phases.at(-1)).toMatchObject({
      phase: "provider_model_id_search",
      failureCode: "phase_result_invalid",
    });
    expect(createSeal).not.toHaveBeenCalled();
    expect(calls).not.toContain("seal");
  });

  it.each([
    [
      "missing row",
      (valid: Record<string, unknown>) => ({ ...valid, artifactCount: 0 }),
    ],
    [
      "extra row",
      (valid: Record<string, unknown>) => ({ ...valid, artifactCount: 2 }),
    ],
    [
      "inventory root mismatch",
      (valid: Record<string, unknown>) => ({ ...valid, artifactHash: HASH_C }),
    ],
    [
      "queryability failure",
      (valid: Record<string, unknown>) => ({
        ...valid,
        proof: { ...(valid.proof as object) },
      }),
    ],
  ] as const)(
    "stops %s before seal or head mutation",
    async (_label, corrupt) => {
      const fixture = await createRestoreFixture();
      const profile = await profileFor(fixture);
      const calls: RestoreRebuildPhaseOrSwitchV4[] = [];
      const valid = resultFor(profile, fixture, "provider_model_id_search");
      const run = await runLocalServingRestoreRebuildV4(
        profile,
        portsFor(profile, fixture, calls, () => corrupt(valid)),
      );
      expect(run.outcome).toBe("failed");
      expect(run.transcript.phases.at(-1)).toMatchObject({
        phase: "provider_model_id_search",
        failureCode: "phase_result_invalid",
      });
      expect(calls).not.toContain("seal");
      expect(calls).not.toContain("switch");
    },
  );

  it("stops callback failure before later phases and emits no payload", async () => {
    const fixture = await createRestoreFixture();
    const profile = await profileFor(fixture);
    const calls: RestoreRebuildPhaseOrSwitchV4[] = [];
    const ports = portsFor(profile, fixture, calls);
    const createSeal = vi.fn(() => Promise.resolve());
    const run = await runLocalServingRestoreRebuildV4(profile, {
      ...ports,
      rebuildProviderModelIdSearch: () =>
        Promise.reject(new Error("visitor secret payload")),
      createSeal,
    });
    expect(run.outcome).toBe("failed");
    expect(createSeal).not.toHaveBeenCalled();
    expect(JSON.stringify(run.transcript)).not.toMatch(
      /visitor|secret|payload/iu,
    );
  });

  it("runs the optional local switch only when explicitly enabled", async () => {
    const fixture = await createRestoreFixture();
    const profile = await profileFor(fixture);
    const calls: RestoreRebuildPhaseOrSwitchV4[] = [];
    const run = await runLocalServingRestoreRebuildV4(
      profile,
      portsFor(profile, fixture, calls),
      { enableLocalSwitch: true },
    );
    expect(run.outcome).toBe("succeeded");
    expect(calls.at(-1)).toBe("switch");
  });
});

describe("serving restore rebuild v5 schema boundary", () => {
  it.each(["1.12.0", "1.13.0"])(
    "rejects legacy v5 restore authority for serving schema %s",
    async (servingSchemaVersion) => {
      const fixture = await createRestoreFixture();
      await expect(
        profileForV5(fixture, servingSchemaVersion),
      ).rejects.toMatchObject({ code: "backup_manifest_invalid" });
    },
  );

  it("preserves v4 identities and advances only the v5 profile and transcript to schema 1.11", async () => {
    const fixture = await createRestoreFixture();
    const v4 = await profileFor(fixture);
    const v5 = await profileForV5(fixture);
    expect(v4).toMatchObject({
      profileVersion: "backup-v1-restore-source@2",
      materialization: { destinationSchemaVersion: "1.10.0" },
    });
    expect(v5).toMatchObject({
      profileVersion: "backup-v1-restore-source@3",
      materialization: { destinationSchemaVersion: "1.11.0" },
    });

    const calls: RestoreRebuildPhaseOrSwitchV5[] = [];
    const run = await runLocalServingRestoreRebuildV5(
      v5,
      portsForV5(v5, fixture, calls),
    );
    expect(run.outcome).toBe("succeeded");
    expect(calls).toEqual(RESTORE_REBUILD_PHASES_V5);
    expect(run.transcript).toMatchObject({
      transcriptVersion: "serving-restore-rebuild@5",
      profileVersion: "backup-v1-restore-source@3",
      destinationSchemaVersion: "1.11.0",
      syntheticProbeIds: RESTORE_SYNTHETIC_PROBE_IDS_V5,
    });
    expect(run.transcript.phases.map((phase) => phase.phase)).toEqual(
      RESTORE_REBUILD_PHASES_V5,
    );
  });

  it("keeps v5 failures in the v5 transcript domain without exposing callback payloads", async () => {
    const fixture = await createRestoreFixture();
    const profile = await profileForV5(fixture);
    const calls: RestoreRebuildPhaseOrSwitchV5[] = [];
    const ports = portsForV5(profile, fixture, calls);
    const run = await runLocalServingRestoreRebuildV5(profile, {
      ...ports,
      rebuildProviderModelIdSearch: () =>
        Promise.reject(new Error("visitor secret payload")),
    });
    expect(run.outcome).toBe("failed");
    expect(run.transcript).toMatchObject({
      transcriptVersion: "serving-restore-rebuild@5",
      destinationSchemaVersion: "1.11.0",
    });
    expect(run.transcript.phases.at(-1)).toMatchObject({
      phase: "provider_model_id_search",
      failureCode: "phase_callback_failed",
    });
    expect(JSON.stringify(run.transcript)).not.toMatch(
      /visitor|secret|payload/iu,
    );
  });
});
