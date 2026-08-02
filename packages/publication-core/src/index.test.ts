import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildBackupRootHash,
  buildImmutableManifest,
  decideHotRetention,
  deriveNormalizedPublicationHead,
  evaluateReadiness,
  hashCanonicalTuple,
  planActivation,
  planRollback,
  selectPublication,
  validateBackupManifest,
  validateManifestInput,
  verifyImmutableManifest,
  type ArtifactBinding,
  type BackupManifest,
  type ImmutablePublicationManifest,
  type StoredPublicationHead,
  type PublicationManifestInput,
  type PublicationRecord,
  type ReadinessReceipt,
  type SwitchAuthorization,
} from "./index.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
const UUID_E = "55555555-5555-4555-8555-555555555555";
const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;
const VECTOR_A =
  "005355ece853f66dfb82aca841ddfd1ee7aad59ba93be96ee481abdf98635a8a";
const VECTOR_B =
  "fd5c2daf17463b6a91c214570b59b90c28a45b9677703faf6a8851b7353c00f6";
const NOW = "2026-08-01T12:00:00.000Z";
const AUTHORIZATION = {
  kind: "pipeline" as const,
  identityId: "pipeline-publication-test",
};

const manifestInput = (): PublicationManifestInput => ({
  contractVersion: "1.0.0",
  publicationId: `pub_${UUID_B}`,
  sourceRunId: `run_${UUID_A}`,
  parentPublicationId: `pub_${UUID_A}`,
  generatedAt: "2026-08-01T11:00:00.000Z",
  versions: {
    schema: "1.0.0",
    methodology: "methodology@1",
    precisionNormalization: "precision@1",
    precisionDisplayOrder: "display@1",
    pricePolicy: "price@1",
    sourcePolicy: "source@1",
    embedding: "embedding@1",
    buildCommit: "git:abc123",
  },
  enabledProviderScopeVersion: "launch-scope@1",
  enabledProviderIds: [`prv_${UUID_A}`, `prv_${UUID_B}`],
  providerSlices: [
    {
      providerId: `prv_${UUID_A}`,
      providerSliceId: `prn_${UUID_A}`,
      providerRunId: `pvr_${UUID_A}`,
      adapterVersion: "adapter@1",
      rosterVersion: "roster@1",
      sourceRegisterVersion: "source-register@1",
      carriedForward: false,
      freshnessState: "fresh",
    },
    {
      providerId: `prv_${UUID_B}`,
      providerSliceId: null,
      providerRunId: `pvr_${UUID_B}`,
      adapterVersion: "adapter@1",
      rosterVersion: "roster@1",
      sourceRegisterVersion: "source-register@1",
      carriedForward: false,
      freshnessState: "unavailable",
    },
  ],
  providerAttributions: [
    {
      resourceType: "provider",
      resourceId: `prv_${UUID_A}`,
      providerId: `prv_${UUID_A}`,
    },
  ],
  resources: [
    {
      resourceType: "provider",
      resourceId: `prv_${UUID_A}`,
      contentHash: HASH_A,
    },
    {
      resourceType: "model",
      resourceId: `mdl_${UUID_A}`,
      contentHash: HASH_B,
    },
    {
      resourceType: "variant",
      resourceId: `var_${UUID_B}`,
      contentHash: HASH_C,
    },
  ],
  searchDocuments: [
    {
      resourceType: "model",
      resourceId: `mdl_${UUID_A}`,
      documentId: VECTOR_A,
      contentHash: HASH_A,
    },
    {
      resourceType: "variant",
      resourceId: `var_${UUID_B}`,
      documentId: VECTOR_B,
      contentHash: HASH_B,
    },
  ],
  vectors: [
    {
      resourceType: "model",
      resourceId: `mdl_${UUID_A}`,
      vectorId: VECTOR_A,
      searchDocumentContentHash: HASH_A,
      embeddingInputHash: HASH_C,
    },
    {
      resourceType: "variant",
      resourceId: `var_${UUID_B}`,
      vectorId: VECTOR_B,
      searchDocumentContentHash: HASH_B,
      embeddingInputHash: HASH_C,
    },
  ],
  chunks: [
    {
      kind: "resources",
      ordinal: 0,
      firstKey: `model:mdl_${UUID_A}`,
      lastKey: `variant:var_${UUID_B}`,
      itemCount: 3,
      contentHash: HASH_A,
    },
    {
      kind: "exact_search",
      ordinal: 0,
      firstKey: `model:mdl_${UUID_A}`,
      lastKey: `variant:var_${UUID_B}`,
      itemCount: 2,
      contentHash: HASH_B,
    },
    {
      kind: "vectors",
      ordinal: 0,
      firstKey: `model:mdl_${UUID_A}`,
      lastKey: `variant:var_${UUID_B}`,
      itemCount: 2,
      contentHash: HASH_C,
    },
  ],
  bundleHash: HASH_C,
});

const record = (
  publicationId: `pub_${string}`,
  state: PublicationRecord["state"],
  overrides: Partial<PublicationRecord> = {},
): PublicationRecord => ({
  publicationId,
  closureHash: HASH_A,
  state,
  generatedAt: "2026-08-01T09:00:00.000Z",
  readyAt:
    state === "building" || state === "failed"
      ? null
      : "2026-08-01T09:30:00.000Z",
  firstActivatedAt:
    state === "active" || state === "superseded" || state === "rolled_back"
      ? "2026-08-01T10:00:00.000Z"
      : null,
  lastHeadReferencedAt: "2026-08-01T10:00:00.000Z",
  ...overrides,
});

const head = (): StoredPublicationHead => ({
  activePublicationId: `pub_${UUID_A}`,
  rollbackCandidatePublicationId: null,
  switchedAt: "2026-08-01T10:00:00.000Z",
  generation: 1,
});

describe("immutable publication closure (PIPE-050, PIPE-051, BE-011)", () => {
  it("encodes true uint64be UTF-8 byte lengths including multibyte text", async () => {
    const fields = [
      "hash_domain",
      "text",
      "golden",
      "encoding_version",
      "integer",
      "1",
      "accent",
      "text",
      "é",
      "ideograph",
      "text",
      "界",
    ];
    const bytes: Buffer[] = [];
    for (const field of fields) {
      const value = Buffer.from(field, "utf8");
      const length = Buffer.alloc(8);
      length.writeBigUInt64BE(BigInt(value.length));
      bytes.push(length, value);
    }
    const expected = `sha256:${createHash("sha256")
      .update(Buffer.concat(bytes))
      .digest("hex")}`;
    await expect(
      hashCanonicalTuple("golden", [
        { name: "accent", type: "text", value: "é" },
        { name: "ideograph", type: "text", value: "界" },
      ]),
    ).resolves.toBe(expected);
  });

  it("hashes all policy versions and inventories with deterministic ordering", async () => {
    const input = manifestInput();
    const first = await buildImmutableManifest(input);
    const permuted = await buildImmutableManifest({
      ...input,
      providerSlices: [...input.providerSlices].reverse(),
      enabledProviderIds: [...input.enabledProviderIds].reverse(),
      providerAttributions: [...input.providerAttributions].reverse(),
      resources: [...input.resources].reverse(),
      searchDocuments: [...input.searchDocuments].reverse(),
      vectors: [...input.vectors].reverse(),
      chunks: [...input.chunks].reverse(),
    });
    expect(first.closureHash).toBe(permuted.closureHash);
    expect(first.resources.map((value) => value.resourceType)).toEqual([
      "model",
      "provider",
      "variant",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.resources)).toBe(true);

    const changed = await buildImmutableManifest({
      ...input,
      versions: { ...input.versions, methodology: "methodology@2" },
    });
    expect(changed.closureHash).not.toBe(first.closureHash);
    const changedSlice = await buildImmutableManifest({
      ...input,
      providerSlices: input.providerSlices.map((slice, index) =>
        index === 0 ? { ...slice, providerSliceId: `prn_${UUID_C}` } : slice,
      ),
    });
    expect(changedSlice.closureHash).not.toBe(first.closureHash);
  });

  it("detects altered derived hashes instead of trusting manifest claims", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    expect(await verifyImmutableManifest(manifest)).toEqual([]);
    expect(
      await verifyImmutableManifest({
        ...manifest,
        vectorInventoryHash: HASH_C,
      }),
    ).toContain("vectorInventoryHash does not match immutable content");
  });

  it("requires exact search and vector inventories to map every model and variant once", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        vectors: [
          { ...input.vectors[0]!, vectorId: VECTOR_B },
          input.vectors[1]!,
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "vector IDs contains a duplicate",
        "search document and vector IDs disagree",
      ]),
    );
    expect(
      validateManifestInput({
        ...input,
        searchDocuments: input.searchDocuments.slice(0, 1),
      }),
    ).toContain(
      "exact-search inventory does not close over models and variants",
    );
  });

  it("recomputes publication-qualified vector IDs instead of trusting 64 hex", async () => {
    const input = manifestInput();
    await expect(
      buildImmutableManifest({
        ...input,
        searchDocuments: input.searchDocuments.map((document, index) =>
          index === 0 ? { ...document, documentId: "f".repeat(64) } : document,
        ),
        vectors: input.vectors.map((vector, index) =>
          index === 0 ? { ...vector, vectorId: "f".repeat(64) } : vector,
        ),
      }),
    ).rejects.toThrow(/publication-qualified identity/u);
  });

  it("represents unavailable provider outcomes explicitly without selected content", () => {
    const input = manifestInput();
    expect(validateManifestInput(input)).toEqual([]);
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.map((slice) =>
          slice.freshnessState === "unavailable"
            ? { ...slice, carriedForward: true }
            : slice,
        ),
      }),
    ).toContain("unavailable provider cannot carry selected content");
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.map((slice) =>
          slice.freshnessState === "unavailable"
            ? { ...slice, providerSliceId: `prn_${UUID_B}` }
            : { ...slice, providerSliceId: null },
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        "provider selected-slice identity is inconsistent",
      ]),
    );
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.map((slice, index) =>
          index === 0
            ? { ...slice, carriedForward: false, freshnessState: "stale" }
            : slice,
        ),
      }),
    ).toContain("stale provider slice must be carried forward");
  });

  it("enforces contract length ceilings for closure and provider versions", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        versions: { ...input.versions, methodology: "m".repeat(65) },
        providerSlices: input.providerSlices.map((slice, index) =>
          index === 0 ? { ...slice, adapterVersion: "a".repeat(129) } : slice,
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        "methodology version is invalid",
        "provider slice version is invalid",
      ]),
    );
  });

  it("rejects unknown runtime provider freshness discriminants", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.map((slice, index) =>
          index === 0
            ? ({
                ...slice,
                freshnessState: "banana",
              } as unknown as typeof slice)
            : slice,
        ),
      }),
    ).toContain("provider freshness state is invalid");
  });

  it("closure-binds exact enabled-provider coverage and attribution isolation", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        providerSlices: input.providerSlices.slice(0, 1),
      }),
    ).toContain("provider slices do not exactly cover enabled provider scope");
    expect(
      validateManifestInput({
        ...input,
        enabledProviderIds: [...input.enabledProviderIds, `prv_${UUID_C}`],
      }),
    ).toContain("provider slices do not exactly cover enabled provider scope");
    expect(
      validateManifestInput({
        ...input,
        providerAttributions: input.providerAttributions.map((attribution) => ({
          ...attribution,
          providerId: `prv_${UUID_B}`,
        })),
      }),
    ).toEqual(
      expect.arrayContaining([
        "unavailable provider owns attributed public resources",
        "provider resource attribution does not match its identity",
      ]),
    );
  });

  it("rejects unknown chunk kinds before closure hashing", async () => {
    const input = manifestInput();
    const hostile = {
      ...input,
      chunks: [
        ...input.chunks,
        {
          ...input.chunks[0]!,
          kind: "telemetry",
          ordinal: 0,
          itemCount: 1,
        } as unknown as (typeof input.chunks)[number],
      ],
    };
    expect(validateManifestInput(hostile)).toContain("chunk kind is invalid");
    await expect(buildImmutableManifest(hostile)).rejects.toThrow(
      /chunk kind/u,
    );
  });

  it("rejects chunk gaps, overlap, count drift, self-parenting, and prefix mismatch", () => {
    const input = manifestInput();
    expect(
      validateManifestInput({
        ...input,
        parentPublicationId: input.publicationId,
        resources: [
          { ...input.resources[0]!, resourceType: "model" },
          ...input.resources.slice(1),
        ],
        chunks: [
          { ...input.chunks[0]!, itemCount: 2 },
          ...input.chunks.slice(1),
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "parent publication ID is invalid",
        "resource type and ID prefix disagree",
        "resources chunk count does not match its inventory",
      ]),
    );
  });
});

const receipts = (
  manifest: ImmutablePublicationManifest,
): ReadinessReceipt[] => {
  const binding: ArtifactBinding = {
    environment: "test",
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    bundleHash: manifest.bundleHash,
    schemaVersion: manifest.versions.schema,
    buildCommit: manifest.versions.buildCommit,
  };
  return [
    {
      kind: "archive",
      binding,
      observedAt: "2026-08-01T11:30:00.000Z",
      retainedBundleHash: manifest.bundleHash,
      immutable: true,
    },
    {
      kind: "serving",
      binding,
      observedAt: "2026-08-01T11:31:00.000Z",
      enabledProviderCount: manifest.enabledProviderIds.length,
      enabledProviderScopeHash: manifest.enabledProviderScopeHash,
      providerSliceCount: manifest.providerSlices.length,
      providerSliceHash: manifest.providerSliceHash,
      providerAttributionCount: manifest.providerAttributions.length,
      providerAttributionHash: manifest.providerAttributionHash,
      resourceCount: manifest.resources.length,
      exactDocumentCount: manifest.searchDocuments.length,
      resourceInventoryHash: manifest.resourceInventoryHash,
      exactSearchInventoryHash: manifest.exactSearchInventoryHash,
      foreignKeysValid: true,
      contentHashesValid: true,
      unavailableProviderIsolationValid: true,
    },
    {
      kind: "vectors",
      binding,
      observedAt: "2026-08-01T11:32:00.000Z",
      namespace: manifest.publicationId,
      documentCount: manifest.vectors.length,
      vectorInventoryHash: manifest.vectorInventoryHash,
      queryable: true,
    },
    {
      kind: "probes",
      binding,
      observedAt: "2026-08-01T11:33:00.000Z",
      probeSetVersion: "search-gold@1",
      integrityPassed: true,
      evidenceCoveragePassed: true,
      exactSearchPassed: true,
      semanticSearchPassed: true,
      structuredFilterPassed: true,
      neutralityPassed: true,
      versionIsolationPassed: true,
    },
  ];
};

describe("adapter-supplied readiness evidence (SRCH-007, PIPE-044, PIPE-050–PIPE-052, QA-006)", () => {
  it("accepts only a complete, fresh, consistently bound receipt set", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    await expect(
      evaluateReadiness({
        manifest,
        receipts: receipts(manifest),
        environment: "test",
        now: NOW,
        maximumReceiptAgeMs: 60 * 60 * 1000,
      }),
    ).resolves.toEqual({
      decision: "ready",
      readyAt: NOW,
      closureHash: manifest.closureHash,
    });
  });

  it("blocks missing, duplicate, stale, or cross-environment receipts", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    const evidence = receipts(manifest);
    const serving = evidence.find((receipt) => receipt.kind === "serving")!;
    const probes = evidence.find((receipt) => receipt.kind === "probes")!;
    const result = await evaluateReadiness({
      manifest,
      receipts: [
        ...evidence.filter(
          (receipt) => receipt.kind !== "archive" && receipt.kind !== "probes",
        ),
        serving,
        { ...probes, binding: { ...probes.binding, environment: "preview" } },
      ],
      environment: "test",
      now: "2026-08-02T12:00:00.000Z",
      maximumReceiptAgeMs: 60 * 60 * 1000,
    });
    expect(result).toMatchObject({ decision: "blocked" });
    if (result.decision === "blocked")
      expect(result.failureCodes).toEqual(
        expect.arrayContaining([
          "receipt_missing",
          "receipt_duplicate",
          "receipt_binding_mismatch",
          "receipt_stale",
        ]),
      );
  });

  it("fails closed on count/hash/queryability or acceptance-probe drift", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    const evidence = receipts(manifest).map((receipt) => {
      if (receipt.kind === "serving")
        return {
          ...receipt,
          providerSliceCount: 0,
          providerAttributionHash: HASH_A,
          foreignKeysValid: false,
        };
      if (receipt.kind === "vectors") return { ...receipt, queryable: false };
      if (receipt.kind === "probes")
        return { ...receipt, neutralityPassed: false };
      return receipt;
    });
    const result = await evaluateReadiness({
      manifest,
      receipts: evidence,
      environment: "test",
      now: NOW,
      maximumReceiptAgeMs: 60 * 60 * 1000,
    });
    expect(result.decision).toBe("blocked");
    if (result.decision === "blocked")
      expect(result.failureCodes).toEqual(
        expect.arrayContaining([
          "serving_invalid",
          "vectors_invalid",
          "probes_failed",
        ]),
      );
  });

  it("blocks hostile receipt shapes without throwing", async () => {
    const manifest = await buildImmutableManifest(manifestInput());
    const evidence = receipts(manifest);
    const hostile = evidence.map((receipt): ReadinessReceipt => {
      if (receipt.kind === "archive")
        return {
          ...receipt,
          immutable: "false",
        } as unknown as ReadinessReceipt;
      if (receipt.kind === "vectors")
        return {
          ...receipt,
          binding: { ...receipt.binding, environment: "staging" },
        } as unknown as ReadinessReceipt;
      if (receipt.kind === "probes")
        return {
          ...receipt,
          probeSetVersion: "probe\u0000set",
        };
      return receipt;
    });
    const result = await evaluateReadiness({
      manifest,
      receipts: hostile,
      environment: "test",
      now: NOW,
      maximumReceiptAgeMs: 60 * 60 * 1000,
    });
    expect(result.decision).toBe("blocked");
    if (result.decision === "blocked")
      expect(result.failureCodes).toContain("receipt_invalid");
  });
});

describe("closed activation and rollback plans (PIPE-050–PIPE-056, QA-006)", () => {
  it("plans initial activation and a generation-CAS switch with an aborting postcondition", () => {
    const candidate = record(`pub_${UUID_B}`, "ready", {
      closureHash: HASH_B,
      readyAt: "2026-08-01T11:00:00.000Z",
    });
    const first = planActivation({
      candidate,
      currentHead: null,
      currentActive: null,
      switchedAt: NOW,
      authorizedBy: AUTHORIZATION,
    });
    expect(first.steps.map((step) => step.kind)).toEqual([
      "assert_candidate_ready",
      "activate_candidate",
      "compare_and_swap_head",
      "append_switch_history",
      "assert_head_postcondition",
    ]);
    expect(first.steps[2]).toMatchObject({ next: { generation: 1 } });

    const current = record(`pub_${UUID_A}`, "active");
    const next = planActivation({
      candidate,
      currentHead: head(),
      currentActive: current,
      switchedAt: NOW,
      authorizedBy: AUTHORIZATION,
    });
    expect(next.steps.map((step) => step.kind)).toEqual([
      "assert_candidate_ready",
      "activate_candidate",
      "compare_and_swap_head",
      "demote_previous",
      "append_switch_history",
      "assert_head_postcondition",
    ]);
    expect(next.steps[2]).toMatchObject({
      expected: head(),
      next: {
        activePublicationId: candidate.publicationId,
        rollbackCandidatePublicationId: current.publicationId,
        generation: 2,
      },
    });
    expect(next.steps[4]).toMatchObject({
      kind: "append_switch_history",
      action: "activate",
      expectedPriorGeneration: 1,
      newGeneration: 2,
      fromPublicationId: current.publicationId,
      fromClosureHash: current.closureHash,
      toPublicationId: candidate.publicationId,
      toClosureHash: candidate.closureHash,
      resultingRollbackCandidatePublicationId: current.publicationId,
      authorizedBy: AUTHORIZATION,
    });
  });

  it("rejects activation when lifecycle and head evidence disagree", () => {
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "building"),
        currentHead: head(),
        currentActive: record(`pub_${UUID_C}`, "active"),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/not ready/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready"),
        currentHead: head(),
        currentActive: record(`pub_${UUID_C}`, "active"),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/does not select/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready"),
        currentHead: { ...head(), switchedAt: NOW },
        currentActive: record(`pub_${UUID_A}`, "active"),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/precedes the current head/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready", {
          firstActivatedAt: "2026-08-01T11:30:00.000Z",
        }),
        currentHead: null,
        currentActive: null,
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/lifecycle timestamps/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_A}`, "ready"),
        currentHead: head(),
        currentActive: record(`pub_${UUID_A}`, "active"),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/already active/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready"),
        currentHead: null,
        currentActive: null,
        switchedAt: NOW,
        authorizedBy: {
          kind: "admin",
          identityId: "invalid-authority",
        } as unknown as SwitchAuthorization,
      }),
    ).toThrow(/authorization identity/u);
    expect(() =>
      planActivation({
        candidate: record(`pub_${UUID_B}`, "ready"),
        currentHead: head(),
        currentActive: record(`pub_${UUID_A}`, "active", {
          firstActivatedAt: "2026-08-01T10:30:00.000Z",
        }),
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/switch predates first activation/u);
  });

  it("rolls back only to the immediate retained superseded publication", () => {
    const defective = record(`pub_${UUID_B}`, "active", {
      closureHash: HASH_B,
    });
    const target = record(`pub_${UUID_A}`, "superseded", {
      closureHash: HASH_A,
    });
    const currentHead: StoredPublicationHead = {
      activePublicationId: defective.publicationId,
      rollbackCandidatePublicationId: target.publicationId,
      switchedAt: "2026-08-01T11:00:00.000Z",
      generation: 8,
    };
    const plan = planRollback({
      currentHead,
      defective,
      target,
      switchedAt: NOW,
      authorizedBy: AUTHORIZATION,
    });
    expect(plan.operation).toBe("rollback");
    expect(plan.steps.slice(0, 2)).toEqual([
      {
        kind: "assert_rollback_target",
        publicationId: target.publicationId,
        closureHash: target.closureHash,
        expectedState: "superseded",
      },
      {
        kind: "reactivate_rollback_target",
        publicationId: target.publicationId,
        preserveFirstActivatedAt: target.firstActivatedAt,
      },
    ]);
    expect(plan.steps[2]).toMatchObject({
      kind: "compare_and_swap_head",
      expected: currentHead,
      next: {
        activePublicationId: target.publicationId,
        rollbackCandidatePublicationId: defective.publicationId,
        generation: 9,
      },
    });
    expect(plan.steps[3]).toEqual({
      kind: "demote_previous",
      publicationId: defective.publicationId,
      toState: "rolled_back",
    });
    expect(plan.steps[4]).toMatchObject({
      kind: "append_switch_history",
      action: "rollback",
      expectedPriorGeneration: 8,
      newGeneration: 9,
      authorizedBy: AUTHORIZATION,
    });
    expect(() =>
      planRollback({
        currentHead,
        defective,
        target: { ...target, state: "rolled_back" },
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).not.toThrow();
    expect(() =>
      planRollback({
        currentHead: { ...currentHead, switchedAt: NOW },
        defective,
        target,
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/precedes the current head/u);
    expect(() =>
      planRollback({
        currentHead,
        defective,
        target: {
          ...target,
          firstActivatedAt: "2026-08-01T12:30:00.000Z",
        },
        switchedAt: NOW,
        authorizedBy: AUTHORIZATION,
      }),
    ).toThrow(/follows switch time/u);
  });

  it("derives contract-facing head fields from one stored head and active closure", () => {
    const active = record(`pub_${UUID_A}`, "active", { closureHash: HASH_B });
    expect(deriveNormalizedPublicationHead(head(), active)).toEqual({
      activePublicationId: active.publicationId,
      vectorNamespace: active.publicationId,
      manifestHash: active.closureHash,
      publishedAt: active.firstActivatedAt,
      rollbackCandidatePublicationId: null,
      switchedAt: head().switchedAt,
      generation: 1,
    });
    expect(() =>
      deriveNormalizedPublicationHead(head(), {
        ...active,
        state: "superseded",
      }),
    ).toThrow(/derive/u);
    expect(() =>
      deriveNormalizedPublicationHead(
        { ...head(), switchedAt: "2026-08-01T09:59:59.000Z" },
        active,
      ),
    ).toThrow(/predates/u);
  });
});

describe("publication selection and hot retention (API-003, API-024A, PIPE-052, PIPE-056)", () => {
  it("selects active or hot pins and gives one generic result for other pins", () => {
    const active = record(`pub_${UUID_A}`, "active");
    const previous = record(`pub_${UUID_B}`, "superseded");
    const currentHead = {
      ...head(),
      rollbackCandidatePublicationId: previous.publicationId,
    };
    expect(
      selectPublication({
        requestedPublicationId: null,
        head: currentHead,
        hotPublications: [active, previous],
      }),
    ).toEqual({
      outcome: "selected",
      publicationId: active.publicationId,
      source: "active",
    });
    expect(
      selectPublication({
        requestedPublicationId: previous.publicationId,
        head: currentHead,
        hotPublications: [active, previous],
      }),
    ).toEqual({
      outcome: "selected",
      publicationId: previous.publicationId,
      source: "pin",
    });
    expect(
      selectPublication({
        requestedPublicationId: `pub_${UUID_C}`,
        head: currentHead,
        hotPublications: [active, previous],
      }),
    ).toEqual({
      outcome: "publication_expired",
      currentPublicationId: active.publicationId,
    });
    expect(
      selectPublication({
        requestedPublicationId: `pub_${UUID_C}`,
        head: currentHead,
        hotPublications: [
          active,
          previous,
          record(`pub_${UUID_C}`, "rolled_back"),
        ],
      }),
    ).toEqual({
      outcome: "publication_expired",
      currentPublicationId: active.publicationId,
    });
    expect(() =>
      selectPublication({
        requestedPublicationId: null,
        head: currentHead,
        hotPublications: [
          active,
          record(`pub_${UUID_C}`, "building", {
            readyAt: "2026-08-01T11:00:00.000Z",
          }),
        ],
      }),
    ).toThrow(/non-ready publication/u);
  });

  it("never prunes active, rollback, or building state and observes safety intervals", () => {
    const active = record(`pub_${UUID_A}`, "active");
    const previous = record(`pub_${UUID_B}`, "superseded");
    const building = record(`pub_${UUID_C}`, "building");
    const old = record(`pub_${UUID_D}`, "rolled_back", {
      lastHeadReferencedAt: "2026-07-01T00:00:00.000Z",
    });
    const rolledHot = record(`pub_${UUID_E}`, "rolled_back", {
      lastHeadReferencedAt: "2026-08-01T11:59:00.000Z",
    });
    const decisions = decideHotRetention({
      now: NOW,
      head: {
        ...head(),
        rollbackCandidatePublicationId: previous.publicationId,
      },
      publications: [old, rolledHot, building, previous, active],
      minimumHotMs: 7 * 24 * 60 * 60 * 1000,
      cursorTtlMs: 15 * 60 * 1000,
      maximumClockSkewMs: 60 * 1000,
    });
    expect(decisions).toEqual(
      expect.arrayContaining([
        {
          publicationId: active.publicationId,
          action: "retain_hot",
          reason: "active",
        },
        {
          publicationId: previous.publicationId,
          action: "retain_hot",
          reason: "rollback_candidate",
        },
        {
          publicationId: building.publicationId,
          action: "retain_hot",
          reason: "building",
        },
        {
          publicationId: old.publicationId,
          action: "archive_only_eligible",
          reason: "expired",
        },
        {
          publicationId: rolledHot.publicationId,
          action: "retain_hot",
          reason: "safety_interval",
        },
      ]),
    );
  });
});

describe("portable backup manifest validation (BE-010–BE-012, OPS-008)", () => {
  const trustedClosure = {
    publicationId: `pub_${UUID_A}` as const,
    closureHash: HASH_A,
    providerSliceCount: 2,
    resourceCount: 3,
    searchDocumentCount: 2,
  };
  const validateBackup = (manifest: BackupManifest) =>
    validateBackupManifest(manifest, trustedClosure);

  const backup = async (): Promise<BackupManifest> => {
    const withoutRoot = {
      formatVersion: "1.0.0" as const,
      publicationId: `pub_${UUID_A}` as const,
      closureHash: HASH_A,
      canonicalStartBoundary: "bookmark:42",
      canonicalEndBoundary: "bookmark:42",
      writerLeaseDrained: true,
      ordinaryTablesOnly: true,
      searchDocumentsIncluded: true,
      expectedProviderSliceCount: 2,
      expectedResourceCount: 3,
      expectedSearchDocumentCount: 2,
      tables: [
        {
          table: "publication",
          chunkCount: 1,
          rowCount: 1,
          byteCount: 64,
        },
        {
          table: "publication_provider_slice",
          chunkCount: 1,
          rowCount: 2,
          byteCount: 80,
        },
        {
          table: "publication_resource",
          chunkCount: 1,
          rowCount: 3,
          byteCount: 128,
        },
        {
          table: "publication_search_document",
          chunkCount: 1,
          rowCount: 2,
          byteCount: 96,
        },
      ],
      chunks: [
        {
          table: "publication",
          ordinal: 0,
          firstKey: "publication",
          lastKey: "publication",
          rowCount: 1,
          byteCount: 64,
          contentHash: HASH_A,
        },
        {
          table: "publication_provider_slice",
          ordinal: 0,
          firstKey: "a",
          lastKey: "z",
          rowCount: 2,
          byteCount: 80,
          contentHash: HASH_A,
        },
        {
          table: "publication_resource",
          ordinal: 0,
          firstKey: "a",
          lastKey: "z",
          rowCount: 3,
          byteCount: 128,
          contentHash: HASH_B,
        },
        {
          table: "publication_search_document",
          ordinal: 0,
          firstKey: "a",
          lastKey: "z",
          rowCount: 2,
          byteCount: 96,
          contentHash: HASH_C,
        },
      ],
    };
    return { ...withoutRoot, rootHash: await buildBackupRootHash(withoutRoot) };
  };

  it("accepts one stable drained boundary over ordinary rows and search sources", async () => {
    expect(await validateBackup(await backup())).toEqual([]);
  });

  it("rejects boundary drift, virtual-index backup, missing search sources, and hash drift", async () => {
    const manifest = await backup();
    const errors = await validateBackup({
      ...manifest,
      canonicalEndBoundary: "bookmark:43",
      writerLeaseDrained: false,
      ordinaryTablesOnly: false,
      searchDocumentsIncluded: false,
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "canonical writer lease was not drained",
        "canonical backup boundary drifted",
        "backup includes a non-portable index table",
        "backup omits search document sources",
        "backup root hash does not match immutable content",
      ]),
    );
  });

  it("rejects missing, duplicate, unexpected, and count-drifted table inventories", async () => {
    const manifest = await backup();
    const errors = await validateBackup({
      ...manifest,
      tables: [
        ...manifest.tables.filter(
          (table) => table.table !== "publication_search_document",
        ),
        manifest.tables[0]!,
        {
          table: "fts_publication_search",
          chunkCount: 0,
          rowCount: 0,
          byteCount: 0,
        },
        { ...manifest.tables[2]!, rowCount: 4 },
      ],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "backup table inventory contains a duplicate",
        "backup table inventory is missing publication_search_document",
        "backup table inventory contains unexpected table fts_publication_search",
        "publication_resource backup table totals do not match chunks",
        "backup root hash does not match immutable content",
      ]),
    );
  });

  it("rejects a self-consistent truncated export against trusted closure facts", async () => {
    const manifest = await backup();
    const tables = manifest.tables.map((table) =>
      table.table === "publication_resource"
        ? { ...table, rowCount: 2 }
        : table,
    );
    const chunks = manifest.chunks.map((chunk) =>
      chunk.table === "publication_resource"
        ? { ...chunk, rowCount: 2 }
        : chunk,
    );
    const truncatedWithoutTrustedCount = {
      ...manifest,
      expectedResourceCount: 2,
      tables,
      chunks,
    };
    const truncated = {
      ...truncatedWithoutTrustedCount,
      rootHash: await buildBackupRootHash(truncatedWithoutTrustedCount),
    };

    expect(await validateBackup(truncated)).toContain(
      "backup declared counts do not match the trusted closure",
    );
  });

  it("rejects hostile booleans, boundaries, and empty or closure-mismatched backups", async () => {
    const manifest = await backup();
    const hostileBoolean = await validateBackup({
      ...manifest,
      writerLeaseDrained: "false",
    } as unknown as BackupManifest);
    expect(hostileBoolean).toEqual(
      expect.arrayContaining([
        "backup Boolean fields are invalid",
        "backup root hash does not match immutable content",
      ]),
    );
    for (const boundary of ["", "bad\u0001boundary", "x".repeat(257)]) {
      const errors = await validateBackup({
        ...manifest,
        canonicalStartBoundary: boundary,
        canonicalEndBoundary: boundary,
      });
      expect(errors).toContain("canonical backup boundary is invalid");
    }
    const empty = await validateBackup({
      ...manifest,
      tables: [],
      chunks: [],
    });
    expect(empty).toEqual(
      expect.arrayContaining([
        "backup table inventory is missing publication",
        "backup table inventory is missing publication_provider_slice",
        "backup must contain exactly one publication row",
        "backup provider-slice count does not match closure",
      ]),
    );
    const mismatched = await validateBackup({
      ...manifest,
      expectedResourceCount: 4,
      expectedSearchDocumentCount: 3,
      tables: manifest.tables.map((table) =>
        table.table === "publication"
          ? { ...table, rowCount: 0 }
          : table.table === "publication_provider_slice"
            ? { ...table, rowCount: 0 }
            : table,
      ),
    });
    expect(mismatched).toEqual(
      expect.arrayContaining([
        "backup must contain exactly one publication row",
        "backup provider-slice count does not match closure",
        "backup resource count does not match closure",
        "backup search-document count does not match closure",
      ]),
    );
  });
});
