import {
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  projectProviderModelIdSearchProjection,
  projectProviderModelIdSearchStagingV1,
  readProviderModelIdSearchStagingPersistenceV1,
  type ChunkDescriptor,
  type PersistedResourceDescriptor,
  type PersistedSearchDocumentDescriptor,
  type ProviderAttributionDescriptor,
  type ProviderModelIdSearchStagingPersistenceV1,
  type ProviderModelIdSearchStagingProjectionV1,
  type ProviderSliceDescriptor,
  type SearchResourceType,
  type ServingClosureRows,
  type Sha256,
  type TrustedImmutablePublicationManifest,
  type VectorDescriptor,
} from "@quant-clarity/publication-core";

import { createModelVariantNameSearchFixture } from "./model-variant-name-search-fixture.js";

const id = (prefix: string, sequence: number): string =>
  `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;

const knownFact = (value: unknown, observedAt: string, evidence: number) => ({
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

export type ProviderModelIdOfferingFixture = Readonly<{
  rawProviderModelId: string;
  providerSequence?: number;
  status?: "active" | "inactive" | "unavailable" | null;
  stale?: boolean;
}>;

export type ProviderModelIdSearchFixture = Readonly<{
  manifest: TrustedImmutablePublicationManifest;
  closureRows: ServingClosureRows;
  staging: ProviderModelIdSearchStagingProjectionV1;
  persistence: ProviderModelIdSearchStagingPersistenceV1;
}>;

const statement = (
  database: D1Database,
  sql: string,
  values: readonly unknown[],
): D1PreparedStatement => database.prepare(sql).bind(...values);

export const seedProviderModelIdSearchBuildingPublication = async (
  database: D1Database,
  fixture: ProviderModelIdSearchFixture,
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

export const createProviderModelIdSearchFixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
  offerings: readonly ProviderModelIdOfferingFixture[] = [
    { rawProviderModelId: "accounts/provider/models/Alpha\u0000Model" },
  ],
  includeVariant = false,
  modelDisplayNames: string | readonly string[] = "Alpha Model",
  targetResourceType: "model" | "variant" = "model",
): Promise<ProviderModelIdSearchFixture> => {
  const base = await createModelVariantNameSearchFixture(
    publicationId,
    generatedAtMs,
    modelDisplayNames,
    includeVariant,
    true,
  );
  const observedAt = new Date(generatedAtMs).toISOString();
  const provider = base.closureRows.providerSlices[0];
  const providerResource = base.closureRows.resources.find(
    (resource) => resource.resource_type === "provider",
  );
  const target = base.closureRows.resources.find(
    (resource) => resource.resource_type === targetResourceType,
  );
  if (
    provider === undefined ||
    providerResource === undefined ||
    target === undefined
  )
    throw new Error("provider model ID fixture base is incomplete");
  const providerSequences = [
    ...new Set([
      1,
      ...offerings.map((offering) => offering.providerSequence ?? 1),
    ]),
  ].sort((left, right) => left - right);
  if (
    providerSequences.some(
      (sequence) => !Number.isSafeInteger(sequence) || sequence < 1,
    )
  )
    throw new Error("provider model ID fixture provider sequence is invalid");
  const providerFixtures = await Promise.all(
    providerSequences.map(async (sequence) => {
      if (sequence === 1)
        return {
          providerId: provider.provider_id,
          resource: {
            resourceType: "provider" as const,
            resourceId: providerResource.resource_id,
            resourceJson: providerResource.resource_json,
            contentHash: providerResource.content_hash as Sha256,
          },
          slice: provider,
        };
      const providerId = id("prv", sequence);
      const providerValue = JSON.parse(
        providerResource.resource_json,
      ) as Record<string, unknown>;
      const displayName = providerValue.display_name as Record<string, unknown>;
      const slug = providerValue.slug as Record<string, unknown>;
      const officialSite = providerValue.official_site as Record<
        string,
        unknown
      >;
      const resourceJson = canonicalizePublicationJson(
        canonicalJson({
          ...providerValue,
          display_name: {
            ...displayName,
            value: `Fixture Provider ${String(sequence)}`,
          },
          official_site: {
            ...officialSite,
            value: `https://provider-${String(sequence)}.example`,
          },
          provider_id: providerId,
          slug: { ...slug, value: `fixture-provider-${String(sequence)}` },
        }),
        "object",
      );
      return {
        providerId,
        resource: {
          resourceType: "provider" as const,
          resourceId: providerId,
          resourceJson,
          contentHash: await hashPublicationResourceContent({
            resourceType: "provider",
            resourceId: providerId,
            resourceJson,
          }),
        },
        slice: {
          ...provider,
          provider_id: providerId,
          provider_slice_id: id("prn", sequence),
          provider_run_id: id("pvr", sequence),
        },
      };
    }),
  );
  const providerBySequence = new Map(
    providerSequences.map((sequence, index) => {
      const entry = providerFixtures[index];
      if (entry === undefined)
        throw new Error("provider model ID fixture provider map is incomplete");
      return [sequence, entry] as const;
    }),
  );
  const catalogedProviderCount = new Set(
    offerings
      .filter(
        (offering) =>
          (offering.status === undefined || offering.status === "active") &&
          offering.stale !== true,
      )
      .map((offering) => offering.providerSequence ?? 1),
  ).size;
  const targetValue = JSON.parse(target.resource_json) as Record<
    string,
    unknown
  >;
  const catalogedProviderCountValue = targetValue.cataloged_provider_count as
    Record<string, unknown> | undefined;
  const targetResourceJson = canonicalizePublicationJson(
    canonicalJson({
      ...targetValue,
      cataloged_provider_count: {
        ...catalogedProviderCountValue,
        observed_at: observedAt,
        value: catalogedProviderCount,
      },
    }),
    "object",
  );
  const targetResource = {
    resourceType: targetResourceType,
    resourceId: target.resource_id,
    resourceJson: targetResourceJson,
    contentHash: await hashPublicationResourceContent({
      resourceType: targetResourceType,
      resourceId: target.resource_id,
      resourceJson: targetResourceJson,
    }),
  };
  const offeringResources = await Promise.all(
    offerings.map(async (offering, index) => {
      const offeringProvider = providerBySequence.get(
        offering.providerSequence ?? 1,
      );
      if (offeringProvider === undefined)
        throw new Error("provider model ID fixture provider is missing");
      const offeringId = id("off", index + 1);
      const status =
        offering.status === null
          ? {
              evidence_ids: [],
              observed_at: null,
              state: "unknown",
              value: null,
            }
          : knownFact(offering.status ?? "active", observedAt, 40 + index);
      const resourceJson = canonicalizePublicationJson(
        canonicalJson({
          display_name: knownFact(
            `Offering ${String(index + 1)}`,
            observedAt,
            60 + index,
          ),
          endpoint_class: "serverless",
          evidence_ids: [id("evd", 80 + index)],
          first_observed_at: observedAt,
          last_observed_at: observedAt,
          last_successful_refresh: knownFact(
            observedAt,
            observedAt,
            100 + index,
          ),
          material_region_key: "",
          model_resource_id: targetResource.resourceId,
          offering_id: offeringId,
          precision_observation_ids: [],
          price_ids: [],
          provider_id: offeringProvider.providerId,
          provider_model_id: offering.rawProviderModelId,
          source_locator: knownFact(
            "https://provider.example/catalog",
            observedAt,
            120 + index,
          ),
          stale: offering.stale ?? false,
          stale_reason:
            (offering.stale ?? false) ? "provider marked stale" : null,
          status,
          supported_regions: knownFact(["global"], observedAt, 140 + index),
          tier_key: "standard",
        }),
        "object",
      );
      return {
        resourceType: "offering" as const,
        resourceId: offeringId,
        resourceJson,
        contentHash: await hashPublicationResourceContent({
          resourceType: "offering",
          resourceId: offeringId,
          resourceJson,
        }),
      };
    }),
  );
  const baseResources: PersistedResourceDescriptor[] =
    base.closureRows.resources
      .filter((resource) => resource.resource_type !== "provider")
      .map((resource) =>
        resource.resource_type === targetResourceType &&
        resource.resource_id === targetResource.resourceId
          ? targetResource
          : {
              resourceType: resource.resource_type,
              resourceId: resource.resource_id,
              resourceJson: resource.resource_json,
              contentHash: resource.content_hash,
            },
      ) as PersistedResourceDescriptor[];
  const resources = [
    ...baseResources,
    ...providerFixtures.map((entry) => entry.resource),
    ...offeringResources,
  ].sort((left, right) => {
    const leftKey = `${left.resourceType}:${left.resourceId}`;
    const rightKey = `${right.resourceType}:${right.resourceId}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const resourceKeys = resources.map(
    (resource) => `${resource.resourceType}:${resource.resourceId}`,
  );
  const firstResourceKey = resourceKeys[0];
  const lastResourceKey = resourceKeys.at(-1);
  if (firstResourceKey === undefined || lastResourceKey === undefined)
    throw new Error("provider model ID fixture lacks resources");
  const resourceChunkHash = await hashPublicationResourceChunk(resources);
  const chunks: ChunkDescriptor[] = base.closureRows.chunks.map((chunk) =>
    chunk.kind === "resources"
      ? {
          kind: "resources",
          ordinal: chunk.ordinal,
          firstKey: firstResourceKey,
          lastKey: lastResourceKey,
          itemCount: resources.length,
          contentHash: resourceChunkHash,
        }
      : {
          kind: chunk.kind as ChunkDescriptor["kind"],
          ordinal: chunk.ordinal,
          firstKey: chunk.first_key,
          lastKey: chunk.last_key,
          itemCount: chunk.item_count,
          contentHash: chunk.content_hash as Sha256,
        },
  );
  const providerAttributions: ProviderAttributionDescriptor[] = [
    ...providerFixtures.map((entry) => ({
      resourceType: "provider" as const,
      resourceId: entry.providerId,
      providerId: entry.providerId,
    })),
    ...offeringResources.map((resource, index) => ({
      resourceType: "offering" as const,
      resourceId: resource.resourceId,
      providerId:
        providerBySequence.get(offerings[index]?.providerSequence ?? 1)
          ?.providerId ?? provider.provider_id,
    })),
  ];
  const searchDocuments: PersistedSearchDocumentDescriptor[] =
    base.closureRows.searchDocuments.map((row) => ({
      documentId: row.document_id,
      resourceType: row.resource_type as SearchResourceType,
      resourceId: row.resource_id,
      normalizedName: row.normalized_name,
      aliasesJson: row.aliases_json,
      publisherName: row.publisher_name,
      providerModelIdsJson: row.provider_model_ids_json,
      documentText: row.document_text,
      contentHash: row.content_hash as Sha256,
    }));
  const vectors: VectorDescriptor[] = base.closureRows.vectors.map((row) => ({
    vectorId: row.vector_id,
    resourceType: row.resource_type as SearchResourceType,
    resourceId: row.resource_id,
    searchDocumentContentHash: row.search_document_content_hash as Sha256,
    embeddingInputHash: row.embedding_input_hash as Sha256,
  }));
  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: "1.0.0",
    publicationId,
    sourceRunId: base.manifest.sourceRunId,
    parentPublicationId: null,
    generatedAt: observedAt,
    versions: base.manifest.versions,
    enabledProviderScopeVersion: base.manifest.enabledProviderScopeVersion,
    enabledProviderIds: providerFixtures.map((entry) => entry.providerId),
    providerSlices: providerFixtures.map((entry): ProviderSliceDescriptor => ({
      providerId: entry.slice.provider_id,
      providerSliceId: entry.slice.provider_slice_id,
      providerRunId: entry.slice.provider_run_id,
      adapterVersion: entry.slice.adapter_version,
      rosterVersion: entry.slice.roster_version,
      sourceRegisterVersion: entry.slice.source_register_version,
      carriedForward: entry.slice.carried_forward === 1,
      freshnessState: entry.slice
        .freshness_state as ProviderSliceDescriptor["freshnessState"],
    })),
    providerAttributions,
    resources,
    searchDocuments,
    vectors,
    chunks,
    bundleHash: base.manifest.bundleHash,
  });
  const closureRows: ServingClosureRows = {
    publication: {
      ...base.closureRows.publication,
      closure_hash: manifest.closureHash,
    },
    providerSlices: providerFixtures.map((entry) => entry.slice),
    providerAttributions: providerAttributions.map((row) => ({
      resource_type: row.resourceType,
      resource_id: row.resourceId,
      provider_id: row.providerId,
    })),
    resources: resources.map((resource) => ({
      resource_type: resource.resourceType,
      resource_id: resource.resourceId,
      resource_json: resource.resourceJson,
      content_hash: resource.contentHash,
    })),
    searchDocuments: base.closureRows.searchDocuments,
    vectors: base.closureRows.vectors,
    chunks: chunks.map((chunk) => ({
      kind: chunk.kind,
      ordinal: chunk.ordinal,
      first_key: chunk.firstKey,
      last_key: chunk.lastKey,
      item_count: chunk.itemCount,
      content_hash: chunk.contentHash,
    })),
    manifestContractVersion: base.closureRows.manifestContractVersion,
    enabledProviderScopeVersion: base.closureRows.enabledProviderScopeVersion,
    bundleHash: base.closureRows.bundleHash,
    stagingRevision:
      base.closureRows.stagingRevision +
      offeringResources.length * 2 +
      (providerFixtures.length - 1) * 4,
    sealedAtMs: base.closureRows.sealedAtMs,
  };
  const projection = await projectProviderModelIdSearchProjection({
    manifest,
    resources: closureRows.resources.filter(
      (resource) =>
        resource.resource_type === "offering" ||
        (offeringResources.length > 0 &&
          resource.resource_type === targetResourceType &&
          resource.resource_id === targetResource.resourceId),
    ),
  });
  const staging = await projectProviderModelIdSearchStagingV1({
    projection,
    closureRows,
  });
  return Object.freeze({
    manifest,
    closureRows,
    staging,
    persistence: readProviderModelIdSearchStagingPersistenceV1(staging),
  });
};

/** Builds a real provider-only closure with no Model, Offering, search, or vector rows. */
export const createZeroModelProviderModelIdSearchFixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
): Promise<ProviderModelIdSearchFixture> => {
  const source = await createModelVariantNameSearchFixture(
    publicationId,
    generatedAtMs,
    "discarded model",
    false,
    true,
  );
  const providerSlice = source.closureRows.providerSlices[0];
  const providerResource = source.closureRows.resources.find(
    (row) => row.resource_type === "provider",
  );
  if (providerSlice === undefined || providerResource === undefined)
    throw new TypeError("zero-Model fixture lacks its provider closure");
  const resources: readonly PersistedResourceDescriptor[] = [
    {
      resourceType: "provider",
      resourceId: providerResource.resource_id,
      resourceJson: providerResource.resource_json,
      contentHash: providerResource.content_hash as Sha256,
    },
  ];
  const resourceKey = `provider:${providerResource.resource_id}`;
  const chunks: readonly ChunkDescriptor[] = [
    {
      kind: "resources",
      ordinal: 0,
      firstKey: resourceKey,
      lastKey: resourceKey,
      itemCount: 1,
      contentHash: await hashPublicationResourceChunk(resources),
    },
  ];
  const providerSlices: readonly ProviderSliceDescriptor[] = [
    {
      providerId: providerSlice.provider_id,
      providerSliceId: providerSlice.provider_slice_id,
      providerRunId: providerSlice.provider_run_id,
      adapterVersion: providerSlice.adapter_version,
      rosterVersion: providerSlice.roster_version,
      sourceRegisterVersion: providerSlice.source_register_version,
      carriedForward: providerSlice.carried_forward === 1,
      freshnessState: providerSlice.freshness_state as "fresh",
    },
  ];
  const providerAttributions: readonly ProviderAttributionDescriptor[] = [
    {
      resourceType: "provider",
      resourceId: providerResource.resource_id,
      providerId: providerSlice.provider_id,
    },
  ];
  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: "1.0.0",
    publicationId,
    sourceRunId: source.manifest.sourceRunId,
    parentPublicationId: null,
    generatedAt: new Date(generatedAtMs).toISOString(),
    versions: source.manifest.versions,
    enabledProviderScopeVersion: source.manifest.enabledProviderScopeVersion,
    enabledProviderIds: [providerSlice.provider_id],
    providerSlices,
    providerAttributions,
    resources,
    searchDocuments: [],
    vectors: [],
    chunks,
    bundleHash: source.manifest.bundleHash,
  });
  const closureRows: ServingClosureRows = Object.freeze({
    publication: Object.freeze({
      ...source.closureRows.publication,
      closure_hash: manifest.closureHash,
    }),
    providerSlices: Object.freeze([providerSlice]),
    providerAttributions: Object.freeze([
      {
        resource_type: "provider",
        resource_id: providerResource.resource_id,
        provider_id: providerSlice.provider_id,
      },
    ]),
    resources: Object.freeze([providerResource]),
    searchDocuments: Object.freeze([]),
    vectors: Object.freeze([]),
    chunks: Object.freeze(
      chunks.map((chunk) =>
        Object.freeze({
          kind: chunk.kind,
          ordinal: chunk.ordinal,
          first_key: chunk.firstKey,
          last_key: chunk.lastKey,
          item_count: chunk.itemCount,
          content_hash: chunk.contentHash,
        }),
      ),
    ),
    manifestContractVersion: "1.0.0",
    enabledProviderScopeVersion: manifest.enabledProviderScopeVersion,
    bundleHash: manifest.bundleHash,
    stagingRevision: 5,
    sealedAtMs: generatedAtMs + 60_000,
  });
  const projection = await projectProviderModelIdSearchProjection({
    manifest,
    resources: [],
  });
  const staging = await projectProviderModelIdSearchStagingV1({
    projection,
    closureRows,
  });
  return Object.freeze({
    manifest,
    closureRows,
    staging,
    persistence: readProviderModelIdSearchStagingPersistenceV1(staging),
  });
};
