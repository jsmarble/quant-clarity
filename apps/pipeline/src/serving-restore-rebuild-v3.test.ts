import { describe, expect, it, vi } from "vitest";

import {
  SERVING_BACKUP_TABLES,
  buildBackupRootHash,
  type BackupClosureExpectation,
  type BackupManifest,
} from "@quant-clarity/publication-core";

import {
  RESTORE_EXCLUDED_TABLES,
  RESTORE_REBUILD_PHASES,
  RESTORE_SOURCE_TABLES,
  RESTORE_SYNTHETIC_PROBE_IDS,
  createVerifiedRestoreSourceProfileV1,
  runLocalServingRestoreRebuildV3,
  type RestoreClosureSourceV1,
  type RestoreRebuildPhaseContext,
  type RestoreRebuildPhaseOrSwitch,
  type RestoreRebuildPortsV3,
  type VerifiedRestoreSourceProfileV1,
} from "./serving-restore-rebuild-v3.js";

const UUID = "00000000-0000-4000-8000-000000000001";
const PUBLICATION_ID = `pub_${UUID}` as const;
const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

const expectedClosure: BackupClosureExpectation = {
  servingSchemaVersion: "1.11.0",
  publicationId: PUBLICATION_ID,
  closureHash: HASH_A,
  providerSliceCount: 1,
  resourceCount: 2,
  searchDocumentCount: 1,
};

const selectedCounts: Readonly<Record<string, number>> = Object.freeze({
  publication: 1,
  publication_provider_slice: 1,
  publication_provider_slice_metadata: 1,
  publication_provider_attribution: 1,
  publication_resource: 2,
  publication_search_document: 1,
  publication_vector_inventory: 1,
  publication_inventory_chunk: 3,
});

const excludedCounts: Readonly<Record<string, number>> = Object.freeze({
  serving_schema_metadata: 1,
  publication_closure_seal: 1,
  publication_dataset_metadata_summary: 1,
  publication_readiness_receipt: 4,
  publication_archive_receipt: 1,
  publication_serving_receipt: 1,
  publication_vector_receipt: 1,
  publication_probe_receipt: 1,
  publication_readiness_attestation: 1,
  publication_switch_preflight: 1,
  publication_switch_history: 1,
  publication_head: 1,
});

const backup = async (): Promise<BackupManifest> => {
  const tables = SERVING_BACKUP_TABLES.map((table) => {
    const rowCount = selectedCounts[table] ?? excludedCounts[table] ?? 0;
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
            contentHash: HASH_B,
          },
        ],
  );
  const withoutRoot: Omit<BackupManifest, "rootHash"> = {
    formatVersion: "1.0.0",
    publicationId: PUBLICATION_ID,
    closureHash: HASH_A,
    canonicalStartBoundary: "bookmark:42",
    canonicalEndBoundary: "bookmark:42",
    writerLeaseDrained: true,
    ordinaryTablesOnly: true,
    searchDocumentsIncluded: true,
    expectedProviderSliceCount: 1,
    expectedResourceCount: 2,
    expectedSearchDocumentCount: 1,
    tables,
    chunks,
  };
  return Object.freeze({
    ...withoutRoot,
    rootHash: await buildBackupRootHash(withoutRoot),
  });
};

const closureSource = (): RestoreClosureSourceV1 => ({
  sourceSchemaVersion: "1.0.0",
  manifestContractVersion: "1.0.0",
  hashDomain: "publication-closure",
  hashEncodingVersion: "1",
  enabledProviderScopeVersion: "scope@1",
  publicationId: PUBLICATION_ID,
  closureHash: HASH_A,
  bundleHash: HASH_B,
  enabledProviderScopeHash: HASH_B,
  providerSliceHash: HASH_B,
  providerAttributionHash: HASH_B,
  resourceInventoryHash: HASH_B,
  exactSearchInventoryHash: HASH_B,
  vectorInventoryHash: HASH_B,
  chunkRootHash: HASH_B,
  manifestInputHash: HASH_C,
  providerSliceCount: 1,
  providerSliceMetadataCount: 1,
  providerAttributionCount: 1,
  resourceCount: 2,
  searchDocumentCount: 1,
  vectorDocumentCount: 1,
  inventoryChunkCount: 3,
});

const profile = async (): Promise<VerifiedRestoreSourceProfileV1> =>
  createVerifiedRestoreSourceProfileV1(
    await backup(),
    expectedClosure,
    closureSource(),
  );

const versions: Readonly<Record<RestoreRebuildPhaseOrSwitch, string>> =
  Object.freeze({
    import: "backup-v1-selected-import@1",
    closure: "publication-closure-compare@1",
    provider_search: "provider-search-rebuild@2",
    model_search: "model-variant-name-rebuild@3",
    seal: "publication-closure-seal@1",
    readiness: "serving-readiness@3",
    switch: "serving-switch@3",
  });

const resultFor = (
  verified: VerifiedRestoreSourceProfileV1,
  phase: RestoreRebuildPhaseOrSwitch,
) => ({
  outcome: "succeeded" as const,
  phaseVersion: versions[phase],
  backupRootHash: verified.backupRootHash,
  closureHash: verified.closureSource.closureHash,
  artifactCount:
    phase === "import"
      ? verified.selectedRowCount
      : phase === "provider_search" || phase === "model_search"
        ? 1
        : 1,
  artifactHash:
    phase === "import"
      ? verified.closureSource.manifestInputHash
      : phase === "closure" || phase === "seal"
        ? verified.closureSource.closureHash
        : HASH_C,
});

const ports = (
  verified: VerifiedRestoreSourceProfileV1,
  calls: RestoreRebuildPhaseOrSwitch[],
  fail?: RestoreRebuildPhaseOrSwitch,
): RestoreRebuildPortsV3 => {
  const callback =
    (phase: RestoreRebuildPhaseOrSwitch) =>
    (context: RestoreRebuildPhaseContext): Promise<unknown> => {
      calls.push(phase);
      expect(context.profile).toBe(verified);
      expect(context.completed.map((receipt) => receipt.phase)).toEqual(
        calls.slice(0, -1),
      );
      if (phase === fail)
        return Promise.reject(new Error("secret visitor value and payload"));
      return Promise.resolve(resultFor(verified, phase));
    };
  return {
    importSelectedSources: callback("import"),
    compareClosure: callback("closure"),
    rebuildProviderSearch: callback("provider_search"),
    rebuildModelSearch: callback("model_search"),
    createSeal: callback("seal"),
    commitReadinessV3: callback("readiness"),
    switchLocalV3: callback("switch"),
  };
};

describe("backup-v1 restore source profile", () => {
  it("fully validates backup-v1 before reading or creating the source profile", async () => {
    const invalid = { ...(await backup()), formatVersion: "9.0.0" };
    let sourceReads = 0;
    const hostileSource = new Proxy(
      {},
      {
        ownKeys: () => {
          sourceReads += 1;
          throw new Error("must not inspect source");
        },
      },
    );
    await expect(
      createVerifiedRestoreSourceProfileV1(
        invalid as BackupManifest,
        expectedClosure,
        hostileSource,
      ),
    ).rejects.toMatchObject({
      code: "backup_manifest_invalid",
    });
    expect(sourceReads).toBe(0);
  });

  it.each(["1.12.0", "1.13.0"])(
    "rejects legacy restore authority for serving schema %s before reading the source",
    async (servingSchemaVersion) => {
      let sourceReads = 0;
      const hostileSource = new Proxy(
        {},
        {
          ownKeys: () => {
            sourceReads += 1;
            throw new Error("must not inspect source");
          },
        },
      );
      await expect(
        createVerifiedRestoreSourceProfileV1(
          await backup(),
          { ...expectedClosure, servingSchemaVersion },
          hostileSource,
        ),
      ).rejects.toMatchObject({ code: "backup_manifest_invalid" });
      expect(sourceReads).toBe(0);
    },
  );

  it("selects only deterministic rebuild sources and excludes all schema, lifecycle, and projections", async () => {
    const verified = await profile();
    expect(verified.selectedSources.map((table) => table.table)).toEqual(
      RESTORE_SOURCE_TABLES,
    );
    expect(
      verified.selectedSources.some((table) =>
        RESTORE_EXCLUDED_TABLES.includes(
          table.table as (typeof RESTORE_EXCLUDED_TABLES)[number],
        ),
      ),
    ).toBe(false);
    expect(verified.selectedRowCount).toBe(11);
    expect(verified.materialization).toEqual({
      destinationSchemaVersion: "1.6.0",
      destinationIsolation: "fresh-local-schema",
      publicationState: "building",
      readyAtMs: null,
      activatedAtMs: null,
      failureCodesJson: "[]",
      closureSealImported: false,
      stagingRevisionImported: false,
    });
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.selectedSources)).toBe(true);

    const manifest = await backup();
    const withProjection = {
      ...manifest,
      tables: [
        ...manifest.tables,
        {
          table: "publication_model_variant_name_search_document",
          chunkCount: 0,
          rowCount: 0,
          byteCount: 0,
        },
      ],
    };
    await expect(
      createVerifiedRestoreSourceProfileV1(
        {
          ...withProjection,
          rootHash: await buildBackupRootHash(withProjection),
        },
        expectedClosure,
        closureSource(),
      ),
    ).rejects.toMatchObject({
      code: "backup_manifest_invalid",
    });
  });

  it("rejects source drift, extra keys, and non-nominal coordinator input", async () => {
    const manifest = await backup();
    for (const source of [
      { ...closureSource(), closureHash: HASH_B },
      { ...closureSource(), vectorDocumentCount: 2 },
      { ...closureSource(), literalBackupImport: true },
    ])
      await expect(
        createVerifiedRestoreSourceProfileV1(manifest, expectedClosure, source),
      ).rejects.toMatchObject({
        code: "restore_source_invalid",
      });

    const verified = await profile();
    await expect(
      runLocalServingRestoreRebuildV3({ ...verified }, ports(verified, []), {
        enableLocalSwitch: false,
      }),
    ).rejects.toThrow("verified restore source profile is required");
  });
});

describe("local deterministic restore rebuild coordinator", () => {
  it("runs the fixed phases in order and emits the same bounded transcript", async () => {
    const verified = await profile();
    const callsA: RestoreRebuildPhaseOrSwitch[] = [];
    const callsB: RestoreRebuildPhaseOrSwitch[] = [];
    const first = await runLocalServingRestoreRebuildV3(
      verified,
      ports(verified, callsA),
      { enableLocalSwitch: false },
    );
    const second = await runLocalServingRestoreRebuildV3(
      verified,
      ports(verified, callsB),
      { enableLocalSwitch: false },
    );
    expect(first.outcome).toBe("succeeded");
    expect(callsA).toEqual(RESTORE_REBUILD_PHASES);
    expect(callsB).toEqual(RESTORE_REBUILD_PHASES);
    expect(second.transcript).toEqual(first.transcript);
    expect(first.transcript.syntheticProbeIds).toEqual(
      RESTORE_SYNTHETIC_PROBE_IDS,
    );
    expect(Object.keys(first.transcript).sort()).toEqual(
      [
        "backupFormatVersion",
        "backupRootHash",
        "closureHash",
        "destinationSchemaVersion",
        "phases",
        "profileVersion",
        "selectedRowCount",
        "selectedTableCount",
        "syntheticProbeIds",
        "transcriptVersion",
      ].sort(),
    );
  });

  it.each([
    "import",
    "closure",
    "provider_search",
    "model_search",
    "seal",
    "readiness",
    "switch",
  ] as const)(
    "stops after a fixed private-safe %s callback failure",
    async (failure) => {
      const verified = await profile();
      const calls: RestoreRebuildPhaseOrSwitch[] = [];
      const outcome = await runLocalServingRestoreRebuildV3(
        verified,
        ports(verified, calls, failure),
        { enableLocalSwitch: failure === "switch" },
      );
      expect(outcome.outcome).toBe("failed");
      expect(outcome.transcript.phases.at(-1)).toEqual({
        phase: failure,
        outcome: "failed",
        phaseVersion: versions[failure],
        failureCode: "phase_callback_failed",
      });
      expect(JSON.stringify(outcome.transcript)).not.toContain("secret");
      expect(calls.at(-1)).toBe(failure);
      const failuresBeforeSeal: readonly RestoreRebuildPhaseOrSwitch[] = [
        "import",
        "closure",
        "provider_search",
        "model_search",
      ];
      if (failuresBeforeSeal.includes(failure)) {
        expect(calls).not.toContain("seal");
        expect(calls).not.toContain("switch");
      }
      if (failure !== "switch") expect(calls).not.toContain("switch");
    },
  );

  it("rejects corrupt callback results before seal or head mutation", async () => {
    const verified = await profile();
    const calls: RestoreRebuildPhaseOrSwitch[] = [];
    const base = ports(verified, calls);
    const corrupt: RestoreRebuildPortsV3 = {
      ...base,
      compareClosure: () =>
        Promise.resolve({
          ...resultFor(verified, "closure"),
          closureHash: HASH_B,
          arbitraryPayload: "visitor query",
        }),
    };
    const outcome = await runLocalServingRestoreRebuildV3(verified, corrupt, {
      enableLocalSwitch: true,
    });
    expect(outcome.outcome).toBe("failed");
    expect(outcome.transcript.phases.at(-1)).toMatchObject({
      phase: "closure",
      failureCode: "phase_result_invalid",
    });
    expect(calls).toEqual(["import"]);
    expect(JSON.stringify(outcome.transcript)).not.toContain("visitor");
  });

  it("snapshots hostile callback results exactly once before transcript use", async () => {
    const verified = await profile();
    const calls: RestoreRebuildPhaseOrSwitch[] = [];
    const base = ports(verified, calls);
    const raw = resultFor(verified, "import");
    const reads = new Map<string, number>();
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw))
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        get: () => {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return value;
        },
      });
    const outcome = await runLocalServingRestoreRebuildV3(
      verified,
      {
        ...base,
        importSelectedSources: vi.fn(() => {
          calls.push("import");
          return Promise.resolve(result);
        }),
      },
      { enableLocalSwitch: false },
    );
    expect(outcome.outcome, JSON.stringify(outcome.transcript)).toBe(
      "succeeded",
    );
    expect([...reads.values()]).toEqual(Array.from(reads, () => 1));
    Object.defineProperty(result, "artifactHash", {
      enumerable: true,
      value: HASH_A,
    });
    expect(outcome.transcript.phases[0]).toMatchObject({
      artifactHash: verified.closureSource.manifestInputHash,
    });
  });

  it("switches only after readiness when explicitly enabled for the local seam", async () => {
    const verified = await profile();
    const noSwitchCalls: RestoreRebuildPhaseOrSwitch[] = [];
    const noSwitch = await runLocalServingRestoreRebuildV3(
      verified,
      ports(verified, noSwitchCalls),
      { enableLocalSwitch: false },
    );
    expect(noSwitch.outcome).toBe("succeeded");
    expect(noSwitchCalls.at(-1)).toBe("readiness");

    const switchCalls: RestoreRebuildPhaseOrSwitch[] = [];
    const switched = await runLocalServingRestoreRebuildV3(
      verified,
      ports(verified, switchCalls),
      { enableLocalSwitch: true },
    );
    expect(switched.outcome).toBe("succeeded");
    expect(switchCalls.slice(-2)).toEqual(["readiness", "switch"]);

    const calls: RestoreRebuildPhaseOrSwitch[] = [];
    const withoutSwitch = ports(verified, calls);
    delete (withoutSwitch as { switchLocalV3?: unknown }).switchLocalV3;
    const rejected = await runLocalServingRestoreRebuildV3(
      verified,
      withoutSwitch,
      { enableLocalSwitch: true },
    );
    expect(rejected).toMatchObject({
      outcome: "failed",
      transcript: {
        phases: [
          {
            phase: "switch",
            outcome: "failed",
            failureCode: "configuration_invalid",
          },
        ],
      },
    });
    expect(calls).toEqual([]);

    const malformedCalls: RestoreRebuildPhaseOrSwitch[] = [];
    const malformed = {
      ...ports(verified, malformedCalls),
      switchLocalV3: "untrusted payload",
    } as unknown as RestoreRebuildPortsV3;
    const malformedRejected = await runLocalServingRestoreRebuildV3(
      verified,
      malformed,
      { enableLocalSwitch: false },
    );
    expect(malformedRejected).toMatchObject({
      outcome: "failed",
      transcript: {
        phases: [{ failureCode: "configuration_invalid" }],
      },
    });
    expect(malformedCalls).toEqual([]);

    const hostilePorts = { ...ports(verified, []) };
    Object.defineProperty(hostilePorts, "importSelectedSources", {
      enumerable: true,
      get: () => {
        throw new Error("private configuration payload");
      },
    });
    const hostileRejected = await runLocalServingRestoreRebuildV3(
      verified,
      hostilePorts,
      { enableLocalSwitch: false },
    );
    expect(hostileRejected).toMatchObject({
      outcome: "failed",
      transcript: {
        phases: [{ failureCode: "configuration_invalid" }],
      },
    });
    expect(JSON.stringify(hostileRejected.transcript)).not.toContain("private");
  });
});
