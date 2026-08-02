import {
  buildImmutableManifestFromPersistedContent,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  projectServingClosureSeal,
  projectServingReadinessAttestation,
  projectServingReadinessReceiptRows,
  projectServingSwitch,
  type ImmutablePublicationManifest,
  type PublicationRecord,
  type ReadinessReceipt,
  type ServingClosureRows,
  type ServingReadinessAttestationProjection,
  type ServingReadinessReceiptRows,
  type ServingSwitchArtifactProof,
  type ServingSwitchProjection,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

const HASH_C = `sha256:${"c".repeat(64)}` as const;
const UUID_PROVIDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_MODEL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MAXIMUM_AGE_MS = 60 * 60 * 1000;

export type ReadyPublicationFixture = Readonly<{
  rows: ServingClosureRows;
  manifest: ImmutablePublicationManifest;
  seal: Awaited<ReturnType<typeof projectServingClosureSeal>>["seal"];
  receipts: ServingReadinessReceiptRows;
  attestation: ServingReadinessAttestationProjection;
  record: PublicationRecord;
  proof: ServingSwitchArtifactProof;
}>;

const iso = (value: number): string => new Date(value).toISOString();

export const createReadyPublicationFixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
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
  const resources = [
    {
      ...resourceBase,
      contentHash: await hashPublicationResourceContent(resourceBase),
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
      lastKey: `model:${modelId}`,
      itemCount: 1,
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
    providerAttributions: [],
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
    providerAttributions: [],
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
    stagingRevision: 8,
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
  const decision = await projectServingReadinessAttestation({
    closureRows: rows,
    persistedSeal: seal,
    receiptRows: receipts,
    environment: "local",
    readyAtMs,
    maximumReceiptAgeMs: MAXIMUM_AGE_MS,
  });
  if (decision.decision !== "ready")
    throw new Error("fixture readiness was unexpectedly blocked");
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
  return {
    rows,
    manifest,
    seal,
    receipts,
    attestation: decision.attestation,
    record,
    proof,
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
