import {
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  projectModelVariantNameSearchProjection,
  projectModelVariantNameSearchStagingV1,
  readModelVariantNameSearchStagingPersistenceV1,
  type ModelVariantNameSearchStagingPersistenceV1,
  type ModelVariantNameSearchStagingProjectionV1,
  type ServingClosureRows,
  type TrustedImmutablePublicationManifest,
} from "@quant-clarity/publication-core";

const id = (prefix: string, sequence: number): string =>
  `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;

const unknownFact = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown",
  value: null,
});

const knownFact = (value: unknown, observedAt: string, evidence = 1) => ({
  evidence_ids: [id("evd", evidence)],
  observed_at: observedAt,
  state: "known",
  value,
});

const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

export type ModelVariantNameSearchFixture = Readonly<{
  manifest: TrustedImmutablePublicationManifest;
  closureRows: ServingClosureRows;
  staging: ModelVariantNameSearchStagingProjectionV1;
  persistence: ModelVariantNameSearchStagingPersistenceV1;
}>;

type FixtureModelStatus =
  "active" | "inactive" | "unavailable" | "deleted" | null;

const statement = (
  database: D1Database,
  sql: string,
  values: readonly unknown[],
): D1PreparedStatement => database.prepare(sql).bind(...values);

export const seedModelVariantNameSearchBuildingPublication = async (
  database: D1Database,
  fixture: ModelVariantNameSearchFixture,
): Promise<void> => {
  const { closureRows: rows, manifest } = fixture;
  await database.batch([
    statement(
      database,
      "INSERT INTO publication VALUES (?, 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, 'vector@1', ?, '[]', ?)",
      [
        manifest.publicationId,
        manifest.versions.schema,
        manifest.versions.methodology,
        manifest.versions.precisionNormalization,
        manifest.versions.precisionDisplayOrder,
        manifest.versions.pricePolicy,
        manifest.versions.sourcePolicy,
        manifest.versions.embedding,
        manifest.versions.buildCommit,
        manifest.sourceRunId,
        Date.parse(manifest.generatedAt),
        manifest.resources.length,
        manifest.searchDocuments.length,
        manifest.vectors.length,
        manifest.exactSearchInventoryHash,
        manifest.closureHash,
        Date.parse(manifest.generatedAt),
      ],
    ),
    ...rows.providerSlices.flatMap((row) => [
      statement(
        database,
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, ?, ?)",
        [
          row.provider_slice_id,
          manifest.publicationId,
          row.provider_id,
          row.provider_run_id,
          row.carried_forward,
          row.freshness_state,
        ],
      ),
      statement(
        database,
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.provider_id,
          row.adapter_version,
          row.roster_version,
          row.source_register_version,
        ],
      ),
    ]),
    ...rows.resources.map((row) =>
      statement(
        database,
        "INSERT INTO publication_resource VALUES (?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.resource_type,
          row.resource_id,
          row.resource_json,
          row.content_hash,
        ],
      ),
    ),
    ...rows.providerAttributions.map((row) =>
      statement(
        database,
        "INSERT INTO publication_provider_attribution VALUES (?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.resource_type,
          row.resource_id,
          row.provider_id,
        ],
      ),
    ),
    ...rows.searchDocuments.map((row) =>
      statement(
        database,
        "INSERT INTO publication_search_document VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.document_id,
          row.resource_type,
          row.resource_id,
          row.normalized_name,
          row.aliases_json,
          row.publisher_name,
          row.provider_model_ids_json,
          row.document_text,
          row.content_hash,
        ],
      ),
    ),
    ...rows.vectors.map((row) =>
      statement(
        database,
        "INSERT INTO publication_vector_inventory VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.vector_namespace,
          row.vector_id,
          row.resource_type,
          row.resource_id,
          row.search_document_content_hash,
          row.embedding_input_hash,
        ],
      ),
    ),
    ...rows.chunks.map((row) =>
      statement(
        database,
        "INSERT INTO publication_inventory_chunk VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.kind,
          row.ordinal,
          row.first_key,
          row.last_key,
          row.item_count,
          row.content_hash,
        ],
      ),
    ),
  ]);
};

export const createModelVariantNameSearchFixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
  displayName: string | null | readonly string[] = "Älpha Model",
  includeVariant = false,
  availableProvider = false,
  modelStatus: FixtureModelStatus | readonly FixtureModelStatus[] = "active",
  neutrality: Readonly<{
    modelPublisher?: string;
    providerAffiliateRelationshipPresent?: boolean;
    providerOfficialSite?: string;
    providerPrecisionKnownCount?: number;
  }> = {},
): Promise<ModelVariantNameSearchFixture> => {
  const observedAt = new Date(generatedAtMs).toISOString();
  const modelDisplayNames = Array.isArray(displayName)
    ? displayName
    : [displayName];
  if (modelDisplayNames.length === 0)
    throw new Error("fixture requires at least one model");
  const modelStatuses: readonly FixtureModelStatus[] = Array.isArray(
    modelStatus,
  )
    ? (modelStatus as readonly FixtureModelStatus[])
    : modelDisplayNames.map(() => modelStatus as FixtureModelStatus);
  if (modelStatuses.length !== modelDisplayNames.length)
    throw new Error("fixture model status count must match its model count");
  const modelStatusAt = (index: number): FixtureModelStatus => {
    const value = modelStatuses[index];
    if (value === undefined) throw new Error("fixture model status is missing");
    return value;
  };
  const statusFact = (value: FixtureModelStatus) =>
    value === null ? unknownFact() : knownFact(value, observedAt, 6);
  const familyId = id("fam", 1);
  const modelId = id("mdl", 1);
  const variantId = id("var", 1);
  const providerId = id("prv", 1);
  const commonValue = {
    active_parameters: unknownFact(),
    architecture: unknownFact(),
    cataloged_provider_count: {
      derivation_version: "cataloged-provider-count@1",
      observed_at: observedAt,
      value: 0,
    },
    checkpoints: [],
    context_window_tokens: unknownFact(),
    family_id: familyId,
    last_model_data_refresh: knownFact(observedAt, observedAt, 2),
    license: unknownFact(),
    maximum_output_tokens: unknownFact(),
    modalities: unknownFact(),
    publisher: knownFact(
      neutrality.modelPublisher ?? "Fixture Publisher",
      observedAt,
      3,
    ),
    release_date: knownFact("2026-08-02", observedAt, 4),
    slug: knownFact("alpha-model", observedAt, 5),
    source_quantization: unknownFact(),
    source_weight_format: unknownFact(),
    status: statusFact(modelStatusAt(0)),
    total_parameters: unknownFact(),
  };
  const sources: {
    resourceType: "model" | "variant";
    resourceId: string;
    value: Record<string, unknown>;
  }[] = modelDisplayNames.map((modelDisplayName, index) => {
    const resourceId = id("mdl", index + 1);
    return {
      resourceType: "model",
      resourceId,
      value: {
        ...commonValue,
        authoritative_checkpoint_ids: [],
        display_name:
          modelDisplayName === null
            ? unknownFact()
            : knownFact(modelDisplayName, observedAt),
        model_id: resourceId,
        slug:
          index === 0
            ? commonValue.slug
            : knownFact(`alpha-model-${String(index + 1)}`, observedAt, 5),
        status: statusFact(modelStatusAt(index)),
      },
    };
  });
  if (includeVariant)
    sources.push({
      resourceType: "variant",
      resourceId: variantId,
      value: {
        ...commonValue,
        checkpoint_ids: [],
        display_name:
          displayName === null
            ? unknownFact()
            : knownFact("Beta Variant", observedAt, 7),
        model_id: modelId,
        selection_evidence: unknownFact(),
        slug: knownFact("beta-variant", observedAt, 8),
        variant_id: variantId,
        variant_kind: knownFact("publisher_variant", observedAt, 9),
      },
    });
  const searchableResources = await Promise.all(
    sources.map(async (source) => {
      const resourceJson = canonicalizePublicationJson(
        canonicalJson(source.value),
        "object",
      );
      return {
        resourceType: source.resourceType,
        resourceId: source.resourceId,
        resourceJson,
        contentHash: await hashPublicationResourceContent({
          resourceType: source.resourceType,
          resourceId: source.resourceId,
          resourceJson,
        }),
      };
    }),
  );
  const familyResourceJson = canonicalizePublicationJson(
    canonicalJson({
      display_name: knownFact("Fixture Family", observedAt, 25),
      family_id: familyId,
      last_model_data_refresh: knownFact(observedAt, observedAt, 26),
      model_ids: modelDisplayNames.map((_, index) => id("mdl", index + 1)),
      publisher: knownFact(
        neutrality.modelPublisher ?? "Fixture Publisher",
        observedAt,
        27,
      ),
      slug: knownFact("fixture-family", observedAt, 28),
    }),
    "object",
  );
  const familyResource = {
    resourceType: "model_family" as const,
    resourceId: familyId,
    resourceJson: familyResourceJson,
    contentHash: await hashPublicationResourceContent({
      resourceType: "model_family",
      resourceId: familyId,
      resourceJson: familyResourceJson,
    }),
  };
  const providerResourceJson = canonicalizePublicationJson(
    canonicalJson({
      active_offering_count: {
        derivation_version: "provider-count@1",
        observed_at: observedAt,
        value: 0,
      },
      affiliate_relationship_present:
        neutrality.providerAffiliateRelationshipPresent ?? false,
      display_name: knownFact("Fixture Provider", observedAt, 20),
      last_successful_refresh: knownFact(observedAt, observedAt, 21),
      official_site: knownFact(
        neutrality.providerOfficialSite ?? "https://provider.example",
        observedAt,
        22,
      ),
      precision_coverage: {
        derivation_version: "precision-coverage@1",
        known_count: neutrality.providerPrecisionKnownCount ?? 0,
        known_proportion_decimal:
          (neutrality.providerPrecisionKnownCount ?? 0) === 0 ? "0" : "1",
        unknown_count: 0,
      },
      provider_id: providerId,
      slug: knownFact("fixture-provider", observedAt, 23),
      status: knownFact("active", observedAt, 24),
    }),
    "object",
  );
  const providerResource = {
    resourceType: "provider" as const,
    resourceId: providerId,
    resourceJson: providerResourceJson,
    contentHash: await hashPublicationResourceContent({
      resourceType: "provider",
      resourceId: providerId,
      resourceJson: providerResourceJson,
    }),
  };
  const resources = [
    familyResource,
    ...searchableResources,
    ...(availableProvider ? [providerResource] : []),
  ].sort((left, right) =>
    left.resourceType < right.resourceType
      ? -1
      : left.resourceType > right.resourceType
        ? 1
        : 0,
  );
  const searchDocuments = await Promise.all(
    searchableResources.map(async (resource) => {
      const documentId = await derivePublicationVectorId(
        publicationId,
        resource.resourceType,
        resource.resourceId,
      );
      const document = {
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        documentId,
        normalizedName: "legacy-value-is-not-canonical",
        aliasesJson: "[]",
        publisherName: "Fixture Publisher",
        providerModelIdsJson: "[]",
        documentText: "legacy broad search fixture",
      };
      return {
        ...document,
        contentHash: await hashPublicationSearchDocumentContent(document),
      };
    }),
  );
  const vectors = searchDocuments.map((document) => ({
    resourceType: document.resourceType,
    resourceId: document.resourceId,
    vectorId: document.documentId,
    searchDocumentContentHash: document.contentHash,
    embeddingInputHash: `sha256:${"e".repeat(64)}` as const,
  }));
  const firstKey = `model:${modelId}`;
  const lastSearchSource = sources.at(-1);
  if (lastSearchSource === undefined)
    throw new Error("fixture lacks searchable resources");
  const lastSearchKey = `${lastSearchSource.resourceType}:${lastSearchSource.resourceId}`;
  const lastResource = resources.at(-1);
  if (lastResource === undefined) throw new Error("fixture lacks resources");
  const lastResourceKey = `${lastResource.resourceType}:${lastResource.resourceId}`;
  const chunks = [
    {
      kind: "resources" as const,
      ordinal: 0,
      firstKey,
      lastKey: lastResourceKey,
      itemCount: resources.length,
      contentHash: await hashPublicationResourceChunk(resources),
    },
    {
      kind: "exact_search" as const,
      ordinal: 0,
      firstKey,
      lastKey: lastSearchKey,
      itemCount: searchDocuments.length,
      contentHash: await hashPublicationSearchChunk(searchDocuments),
    },
    {
      kind: "vectors" as const,
      ordinal: 0,
      firstKey,
      lastKey: lastSearchKey,
      itemCount: vectors.length,
      contentHash: await hashPublicationVectorChunk(publicationId, vectors),
    },
  ];
  const providerSlice = {
    providerId,
    providerSliceId: availableProvider ? `prn_${publicationId.slice(4)}` : null,
    providerRunId: `pvr_${publicationId.slice(4)}`,
    adapterVersion: "adapter@1",
    rosterVersion: "roster@1",
    sourceRegisterVersion: "sources@1",
    carriedForward: false,
    freshnessState: availableProvider
      ? ("fresh" as const)
      : ("unavailable" as const),
  };
  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: "1.0.0",
    publicationId,
    sourceRunId: id("run", 1),
    parentPublicationId: null,
    generatedAt: observedAt,
    versions: {
      schema: "1.6.0",
      methodology: "1.0.0",
      precisionNormalization: "1.0.0",
      precisionDisplayOrder: "1.0.0",
      pricePolicy: "1.0.0",
      sourcePolicy: "1.0.0",
      embedding: "embedding@1",
      buildCommit: "test-commit",
    },
    enabledProviderScopeVersion: "provider-scope@1",
    enabledProviderIds: [providerId],
    providerSlices: [providerSlice],
    providerAttributions: availableProvider
      ? [{ resourceType: "provider", resourceId: providerId, providerId }]
      : [],
    resources,
    searchDocuments,
    vectors,
    chunks,
    bundleHash: `sha256:${"b".repeat(64)}`,
  });
  const closureRows: ServingClosureRows = {
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
    providerSlices: [
      {
        provider_id: providerId,
        provider_slice_id: providerSlice.providerSliceId,
        provider_run_id: providerSlice.providerRunId,
        adapter_version: providerSlice.adapterVersion,
        roster_version: providerSlice.rosterVersion,
        source_register_version: providerSlice.sourceRegisterVersion,
        carried_forward: 0,
        freshness_state: providerSlice.freshnessState,
      },
    ],
    providerAttributions: availableProvider
      ? [
          {
            resource_type: "provider",
            resource_id: providerId,
            provider_id: providerId,
          },
        ]
      : [],
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
    enabledProviderScopeVersion: manifest.enabledProviderScopeVersion,
    bundleHash: manifest.bundleHash,
    // Slice+metadata and three chunks contribute five revisions; the family
    // contributes one resource row, and every searchable resource contributes
    // its resource, broad-search, and vector rows.
    stagingRevision:
      6 + searchableResources.length * 3 + (availableProvider ? 2 : 0),
    sealedAtMs: generatedAtMs + 60_000,
  };
  const projection = await projectModelVariantNameSearchProjection({
    manifest,
    resources: closureRows.resources.filter(
      (resource) =>
        resource.resource_type === "model" ||
        resource.resource_type === "variant",
    ),
  });
  const staging = await projectModelVariantNameSearchStagingV1({
    projection,
    closureRows,
  });
  return Object.freeze({
    manifest,
    closureRows,
    staging,
    persistence: readModelVariantNameSearchStagingPersistenceV1(staging),
  });
};
