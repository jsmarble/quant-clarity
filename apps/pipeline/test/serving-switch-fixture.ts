import {
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  projectProviderSearchArtifactProofV2,
  projectProviderSearchProjection,
  projectProviderSearchStagingV2,
  projectReadinessReceiptProofV2,
  projectServingClosureSeal,
  projectServingReadinessCommit,
  projectServingReadinessCommitV2,
  projectServingReadinessProofV2,
  projectServingReadinessReceiptRows,
  projectServingSwitch,
  projectServingSwitchPreflightProofV2,
  projectServingSwitchV2,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV2,
  reconstructServingReadinessProofV2FromPersistence,
  type ProviderSearchStagingProjectionV2,
  type ProviderSearchArtifactProofV2,
  type PublicationRecord,
  type ReadinessReceipt,
  type ServingClosureRows,
  type ServingReadinessAttestationProjection,
  type ServingReadinessCommitProjection,
  type ServingReadinessCommitProjectionV2,
  type ServingReadinessProofV2,
  type ServingReadinessReceiptRows,
  type ServingSwitchArtifactProof,
  type ServingSwitchArtifactProofV2,
  type ServingSwitchProjection,
  type ServingSwitchProjectionV2,
  type StoredPublicationHead,
  type TrustedImmutablePublicationManifest,
  type TrustedProviderSearchProjection,
} from "@quant-clarity/publication-core";

const HASH_C = `sha256:${"c".repeat(64)}` as const;
const UUID_PROVIDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_MODEL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MAXIMUM_AGE_MS = 60 * 60 * 1000;

export type ReadyPublicationFixture = Readonly<{
  rows: ServingClosureRows;
  manifest: TrustedImmutablePublicationManifest;
  seal: Awaited<ReturnType<typeof projectServingClosureSeal>>["seal"];
  receipts: ServingReadinessReceiptRows;
  attestation: ServingReadinessAttestationProjection;
  readinessCommit: ServingReadinessCommitProjection;
  providerProjection: TrustedProviderSearchProjection;
  providerStaging: ProviderSearchStagingProjectionV2;
  providerProofV2: ProviderSearchArtifactProofV2;
  readinessProofV2: ServingReadinessProofV2;
  readinessCommitV2: ServingReadinessCommitProjectionV2;
  record: PublicationRecord;
  proof: ServingSwitchArtifactProof;
  proofV2: ServingSwitchArtifactProofV2;
}>;

const iso = (value: number): string => new Date(value).toISOString();

export const createReadyPublicationFixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
  options: Readonly<{
    providerDisplayName?: string;
    providerStatus?: string;
  }> = {},
): Promise<ReadyPublicationFixture> => {
  const providerId = `prv_${UUID_PROVIDER}`;
  const modelId = `mdl_${UUID_MODEL}`;
  const providerSliceId = `prn_${publicationId.slice(4)}`;
  const providerRunId = `pvr_${publicationId.slice(4)}`;
  const vectorId = await derivePublicationVectorId(
    publicationId,
    "model",
    modelId,
  );
  const resourceBase = {
    resourceType: "model" as const,
    resourceId: modelId,
    resourceJson: `{"name":"Model ${publicationId.slice(4, 8)}"}`,
  };
  const evidenceId = "evd_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const observedAt = iso(generatedAtMs);
  const providerResourceBase = {
    resourceType: "provider" as const,
    resourceId: providerId,
    resourceJson: canonicalizePublicationJson(
      JSON.stringify({
        active_offering_count: {
          derivation_version: "provider-count@1",
          observed_at: observedAt,
          value: 1,
        },
        affiliate_relationship_present: false,
        display_name: {
          evidence_ids: [evidenceId],
          observed_at: observedAt,
          state: "known",
          value: options.providerDisplayName ?? "Fixture Provider",
        },
        last_successful_refresh: {
          evidence_ids: [evidenceId],
          observed_at: observedAt,
          state: "known",
          value: observedAt,
        },
        official_site: {
          evidence_ids: [evidenceId],
          observed_at: observedAt,
          state: "known",
          value: "https://provider.example",
        },
        precision_coverage: {
          derivation_version: "precision-coverage@1",
          known_count: 0,
          known_proportion_decimal: "0",
          unknown_count: 1,
        },
        provider_id: providerId,
        slug: {
          evidence_ids: [evidenceId],
          observed_at: observedAt,
          state: "known",
          value: "fixture-provider",
        },
        status: {
          evidence_ids: [evidenceId],
          observed_at: observedAt,
          state: "known",
          value: options.providerStatus ?? "active",
        },
      }),
      "object",
    ),
  };
  const resources = [
    {
      ...resourceBase,
      contentHash: await hashPublicationResourceContent(resourceBase),
    },
    {
      ...providerResourceBase,
      contentHash: await hashPublicationResourceContent(providerResourceBase),
    },
  ];
  const documentBase = {
    resourceType: "model" as const,
    resourceId: modelId,
    documentId: vectorId,
    normalizedName: `model-${publicationId.slice(4, 8)}`,
    aliasesJson: "[]",
    publisherName: "Fixture Publisher",
    providerModelIdsJson: "[]",
    documentText: `fixture model ${publicationId.slice(4, 8)}`,
  };
  const searchDocument = {
    ...documentBase,
    contentHash: await hashPublicationSearchDocumentContent(documentBase),
  };
  const searchDocuments = [searchDocument];
  const vectors = [
    {
      resourceType: "model" as const,
      resourceId: modelId,
      vectorId,
      searchDocumentContentHash: searchDocument.contentHash,
      embeddingInputHash: HASH_C,
    },
  ];
  const chunks = [
    {
      kind: "resources" as const,
      ordinal: 0,
      firstKey: `model:${modelId}`,
      lastKey: `provider:${providerId}`,
      itemCount: resources.length,
      contentHash: await hashPublicationResourceChunk(resources),
    },
    {
      kind: "exact_search" as const,
      ordinal: 0,
      firstKey: `model:${modelId}`,
      lastKey: `model:${modelId}`,
      itemCount: 1,
      contentHash: await hashPublicationSearchChunk(searchDocuments),
    },
    {
      kind: "vectors" as const,
      ordinal: 0,
      firstKey: `model:${modelId}`,
      lastKey: `model:${modelId}`,
      itemCount: 1,
      contentHash: await hashPublicationVectorChunk(publicationId, vectors),
    },
  ];
  const providerSlices = [
    {
      providerId,
      providerSliceId,
      providerRunId,
      adapterVersion: "adapter@1",
      rosterVersion: "roster@1",
      sourceRegisterVersion: "source-register@1",
      carriedForward: false,
      freshnessState: "fresh" as const,
    },
  ];
  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: "1.0.0",
    publicationId,
    sourceRunId: `run_${publicationId.slice(4)}`,
    parentPublicationId: null,
    generatedAt: iso(generatedAtMs),
    versions: {
      schema: "1.0.0",
      methodology: "methodology@1",
      precisionNormalization: "precision@1",
      precisionDisplayOrder: "display@1",
      pricePolicy: "price@1",
      sourcePolicy: "source@1",
      embedding: "embedding@1",
      buildCommit: "git:fixture",
    },
    enabledProviderScopeVersion: "fixture@1",
    enabledProviderIds: [providerId],
    providerSlices,
    providerAttributions: [
      {
        resourceType: "provider",
        resourceId: providerId,
        providerId,
      },
    ],
    resources,
    searchDocuments,
    vectors,
    chunks,
    bundleHash: HASH_C,
  });
  const sealedAtMs = generatedAtMs + 60_000;
  const rows: ServingClosureRows = {
    publication: {
      publication_id: publicationId,
      source_run_id: manifest.sourceRunId,
      parent_publication_id: null,
      generated_at_ms: generatedAtMs,
      schema_version: manifest.versions.schema,
      methodology_version: manifest.versions.methodology,
      precision_normalization_version: manifest.versions.precisionNormalization,
      precision_display_order_version: manifest.versions.precisionDisplayOrder,
      price_policy_version: manifest.versions.pricePolicy,
      source_policy_version: manifest.versions.sourcePolicy,
      embedding_version: manifest.versions.embedding,
      build_commit: manifest.versions.buildCommit,
      closure_hash: manifest.closureHash,
    },
    providerSlices: providerSlices.map((slice) => ({
      provider_id: slice.providerId,
      provider_slice_id: slice.providerSliceId,
      provider_run_id: slice.providerRunId,
      adapter_version: slice.adapterVersion,
      roster_version: slice.rosterVersion,
      source_register_version: slice.sourceRegisterVersion,
      carried_forward: 0,
      freshness_state: slice.freshnessState,
    })),
    providerAttributions: [
      {
        resource_type: "provider",
        resource_id: providerId,
        provider_id: providerId,
      },
    ],
    resources: resources.map((resource) => ({
      resource_type: resource.resourceType,
      resource_id: resource.resourceId,
      resource_json: resource.resourceJson,
      content_hash: resource.contentHash,
    })),
    searchDocuments: searchDocuments.map((document) => ({
      document_id: document.documentId,
      resource_type: document.resourceType,
      resource_id: document.resourceId,
      normalized_name: document.normalizedName,
      aliases_json: document.aliasesJson,
      publisher_name: document.publisherName,
      provider_model_ids_json: document.providerModelIdsJson,
      document_text: document.documentText,
      content_hash: document.contentHash,
    })),
    vectors: vectors.map((vector) => ({
      vector_namespace: publicationId,
      vector_id: vector.vectorId,
      resource_type: vector.resourceType,
      resource_id: vector.resourceId,
      search_document_content_hash: vector.searchDocumentContentHash,
      embedding_input_hash: vector.embeddingInputHash,
    })),
    chunks: chunks.map((chunk) => ({
      kind: chunk.kind,
      ordinal: chunk.ordinal,
      first_key: chunk.firstKey,
      last_key: chunk.lastKey,
      item_count: chunk.itemCount,
      content_hash: chunk.contentHash,
    })),
    manifestContractVersion: "1.0.0",
    enabledProviderScopeVersion: "fixture@1",
    bundleHash: manifest.bundleHash,
    stagingRevision: 10,
    sealedAtMs,
  };
  const { seal } = await projectServingClosureSeal(rows);
  const archiveObservedAtMs = generatedAtMs + 2 * 60_000;
  const servingObservedAtMs = generatedAtMs + 3 * 60_000;
  const vectorObservedAtMs = generatedAtMs + 4 * 60_000;
  const probesObservedAtMs = generatedAtMs + 5 * 60_000;
  const binding = {
    environment: "local" as const,
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    bundleHash: manifest.bundleHash,
    schemaVersion: manifest.versions.schema,
    buildCommit: manifest.versions.buildCommit,
  };
  const evidence: ReadinessReceipt[] = [
    {
      kind: "archive",
      binding,
      observedAt: iso(archiveObservedAtMs),
      retainedBundleHash: manifest.bundleHash,
      immutable: true,
    },
    {
      kind: "serving",
      binding,
      observedAt: iso(servingObservedAtMs),
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
      ftsBuildVersion: "fts5-unicode61@1",
      ftsDocumentCount: manifest.searchDocuments.length,
      ftsQueryable: true,
      foreignKeysValid: true,
      contentHashesValid: true,
      unavailableProviderIsolationValid: true,
    },
    {
      kind: "vectors",
      binding,
      observedAt: iso(vectorObservedAtMs),
      namespace: manifest.publicationId,
      documentCount: manifest.vectors.length,
      verifiedDocumentCount: manifest.vectors.length,
      vectorInventoryHash: manifest.vectorInventoryHash,
      visibilityProbeVersion: "vector-visibility@1",
      mutationId: `fixture-${publicationId}`,
      allIdsPresent: true,
      allNamespacesMatch: true,
      queryable: true,
    },
    {
      kind: "probes",
      binding,
      observedAt: iso(probesObservedAtMs),
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
  const receipts = await projectServingReadinessReceiptRows(evidence);
  const readyAtMs = generatedAtMs + 6 * 60_000;
  const decision = await projectServingReadinessCommit({
    closureRows: rows,
    persistedSeal: seal,
    receiptRows: receipts,
    environment: "local",
    readyAtMs,
    maximumReceiptAgeMs: MAXIMUM_AGE_MS,
  });
  if (decision.decision !== "ready")
    throw new Error("fixture readiness was unexpectedly blocked");
  const providerProjection = await projectProviderSearchProjection({
    manifest,
    providerResources: rows.resources.filter(
      (resource) => resource.resource_type === "provider",
    ),
  });
  const providerStaging = await projectProviderSearchStagingV2({
    projection: providerProjection,
    closureRows: rows,
  });
  const providerPersistence =
    readProviderSearchStagingPersistenceV2(providerStaging);
  const providerProof = projectProviderSearchArtifactProofV2({
    manifest,
    projection: providerProjection,
    fts: {
      buildVersion: "provider-name-fts5-unicode61@1",
      documentCount: providerProjection.documentCount,
      queryable: true,
      exactParity: true,
    },
  });
  const evidenceV2 = evidence.map((receipt): ReadinessReceipt =>
    receipt.kind === "probes"
      ? { ...receipt, probeSetVersion: "search-gold@2" }
      : receipt,
  );
  const receiptProofsV2 = await Promise.all(
    evidenceV2.map((receipt) =>
      projectReadinessReceiptProofV2({
        receipt,
        providerProof: receipt.kind === "serving" ? providerProof : null,
      }),
    ),
  );
  const readinessProofV2 = await projectServingReadinessProofV2({
    manifest,
    receiptProofs: receiptProofsV2,
    environment: "local",
    readyAtMs,
    maximumReceiptAgeMs: MAXIMUM_AGE_MS,
  });
  const readinessCommitV2 = await projectServingReadinessCommitV2({
    proof: readinessProofV2,
    closureRows: rows,
    persistedSeal: seal,
    persistedProviderSearchDocuments: providerPersistence.documents,
    persistedProviderSearchFtsRows: providerPersistence.ftsRows,
  });
  const record: PublicationRecord = {
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    state: "ready",
    generatedAt: manifest.generatedAt,
    readyAt: iso(readyAtMs),
    firstActivatedAt: null,
    lastHeadReferencedAt: null,
  };
  const proof: ServingSwitchArtifactProof = {
    environment: "local",
    observedAtMs: generatedAtMs + 7 * 60_000,
    maximumAgeMs: MAXIMUM_AGE_MS,
    ftsBuildVersion: "fts5-unicode61@1",
    ftsSourceDocumentCount: manifest.searchDocuments.length,
    ftsIndexDocumentCount: manifest.searchDocuments.length,
    ftsSourceInventoryHash: manifest.exactSearchInventoryHash,
    ftsExactParity: true,
    archiveBundleHash: manifest.bundleHash,
    archiveImmutable: true,
    vectorNamespace: manifest.publicationId,
    vectorDocumentCount: manifest.vectors.length,
    vectorVerifiedDocumentCount: manifest.vectors.length,
    vectorInventoryHash: manifest.vectorInventoryHash,
    vectorVisibilityProbeVersion: "vector-visibility@1",
    vectorMutationId: `switch-${publicationId}`,
    vectorAllIdsPresent: true,
    vectorAllNamespacesMatch: true,
    vectorQueryable: true,
    probeSetVersion: "search-gold@1",
    integrityPassed: true,
    exactSearchPassed: true,
    semanticSearchPassed: true,
    structuredFilterPassed: true,
    neutralityPassed: true,
    versionIsolationPassed: true,
  };
  const proofV2: ServingSwitchArtifactProofV2 = {
    ...proof,
    probeSetVersion: "search-gold@2",
  };
  return {
    rows,
    manifest,
    seal,
    receipts,
    attestation: decision.projection.attestation,
    readinessCommit: decision.projection,
    providerProjection,
    providerStaging,
    providerProofV2: providerProof,
    readinessProofV2,
    readinessCommitV2,
    record,
    proof,
    proofV2,
  };
};

export const createActivationProjection = (
  fixture: ReadyPublicationFixture,
  switchedAtMs: number,
  currentHead: StoredPublicationHead | null = null,
  currentActive: PublicationRecord | null = null,
): Promise<ServingSwitchProjection> =>
  projectServingSwitch({
    action: "activate",
    target: fixture.record,
    currentHead,
    currentActive,
    switchedAt: iso(switchedAtMs),
    authorizedBy: { kind: "pipeline", identityId: "pipeline.fixture" },
    closureRows: fixture.rows,
    persistedSeal: fixture.seal,
    receiptRows: fixture.receipts,
    persistedAttestation: fixture.attestation,
    artifactProof: { ...fixture.proof, observedAtMs: switchedAtMs - 1_000 },
  });

export const createActivationProjectionV2 = async (
  fixture: ReadyPublicationFixture,
  switchedAtMs: number,
  currentHead: StoredPublicationHead | null = null,
  currentActive: PublicationRecord | null = null,
): Promise<ServingSwitchProjectionV2> => {
  const readiness = readServingReadinessCommitPersistenceV2(
    fixture.readinessCommitV2,
  );
  const generation = (currentHead?.generation ?? 0) + 1;
  const reconstructedReadiness =
    await reconstructServingReadinessProofV2FromPersistence({
      manifest: fixture.manifest,
      providerProjection: fixture.providerProjection,
      providerFts: {
        buildVersion: "provider-name-fts5-unicode61@1",
        documentCount: fixture.providerProjection.documentCount,
        queryable: true,
        exactParity: true,
      },
      providerSearchDocuments: readiness.providerSearch.documents,
      providerSearchFtsRows: readiness.providerSearch.ftsRows,
      receiptRows: readiness.receiptRows,
      attestation: readiness.attestation,
    });
  const preflight = await projectServingSwitchPreflightProofV2({
    manifest: fixture.manifest,
    providerProof: fixture.providerProofV2,
    readinessProof: reconstructedReadiness,
    context: {
      switchId: `publication-switch|activate|${String(generation)}|${fixture.record.publicationId}|${fixture.record.closureHash}`,
      action: "activate",
      expectedPriorGeneration: currentHead?.generation ?? 0,
      expectedPriorRollbackCandidatePublicationId:
        currentHead?.rollbackCandidatePublicationId ?? null,
      expectedPriorSwitchedAtMs:
        currentHead === null ? null : Date.parse(currentHead.switchedAt),
      newGeneration: generation,
      fromPublicationId: currentActive?.publicationId ?? null,
      fromClosureHash: currentActive?.closureHash ?? null,
      toPublicationId: fixture.record.publicationId,
      toClosureHash: fixture.record.closureHash,
      switchedAtMs,
    },
    artifactProof: { ...fixture.proofV2, observedAtMs: switchedAtMs - 1_000 },
  });
  const providerPersistence = readProviderSearchStagingPersistenceV2(
    fixture.providerStaging,
  );
  return projectServingSwitchV2({
    preflight,
    target: fixture.record,
    currentHead,
    currentActive,
    authorizedBy: { kind: "pipeline", identityId: "pipeline.fixture" },
    closureRows: fixture.rows,
    persistedSeal: fixture.seal,
    persistedProviderSearchDocuments: providerPersistence.documents,
    persistedProviderSearchFtsRows: providerPersistence.ftsRows,
    persistedReceiptRows: readiness.receiptRows,
    persistedAttestation: readiness.attestation,
  });
};

export const createRollbackProjection = (
  target: ReadyPublicationFixture,
  targetFirstActivatedAt: string,
  currentHead: StoredPublicationHead,
  currentActive: PublicationRecord,
  switchedAtMs: number,
): Promise<ServingSwitchProjection> =>
  projectServingSwitch({
    action: "rollback",
    target: {
      ...target.record,
      state: "superseded",
      firstActivatedAt: targetFirstActivatedAt,
      lastHeadReferencedAt: currentHead.switchedAt,
    },
    currentHead,
    currentActive,
    switchedAt: iso(switchedAtMs),
    authorizedBy: { kind: "pipeline", identityId: "pipeline.fixture" },
    closureRows: target.rows,
    persistedSeal: target.seal,
    receiptRows: null,
    persistedAttestation: null,
    artifactProof: { ...target.proof, observedAtMs: switchedAtMs - 1_000 },
  });

export const createRollbackProjectionV2 = async (
  target: ReadyPublicationFixture,
  targetFirstActivatedAt: string,
  currentHead: StoredPublicationHead,
  currentActive: PublicationRecord,
  switchedAtMs: number,
): Promise<ServingSwitchProjectionV2> => {
  const provider = readProviderSearchStagingPersistenceV2(
    target.providerStaging,
  );
  const targetRecord: PublicationRecord = {
    ...target.record,
    state: "superseded",
    firstActivatedAt: targetFirstActivatedAt,
    lastHeadReferencedAt: currentHead.switchedAt,
  };
  const generation = currentHead.generation + 1;
  const preflight = await projectServingSwitchPreflightProofV2({
    manifest: target.manifest,
    providerProof: target.providerProofV2,
    readinessProof: null,
    context: {
      switchId: `publication-switch|rollback|${String(generation)}|${target.record.publicationId}|${target.record.closureHash}`,
      action: "rollback",
      expectedPriorGeneration: currentHead.generation,
      expectedPriorRollbackCandidatePublicationId:
        currentHead.rollbackCandidatePublicationId,
      expectedPriorSwitchedAtMs: Date.parse(currentHead.switchedAt),
      newGeneration: generation,
      fromPublicationId: currentActive.publicationId,
      fromClosureHash: currentActive.closureHash,
      toPublicationId: target.record.publicationId,
      toClosureHash: target.record.closureHash,
      switchedAtMs,
    },
    artifactProof: {
      ...target.proofV2,
      observedAtMs: switchedAtMs - 1_000,
    },
  });
  return projectServingSwitchV2({
    preflight,
    target: targetRecord,
    currentHead,
    currentActive,
    authorizedBy: { kind: "operator", identityId: "operator.fixture" },
    closureRows: target.rows,
    persistedSeal: target.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedReceiptRows: null,
    persistedAttestation: null,
  });
};
