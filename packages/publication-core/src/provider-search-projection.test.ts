import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PROVIDER_SEARCH_PROJECTION_VERSION,
  assertProviderSearchProjection,
  buildImmutableManifest,
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  projectProviderSearchProjection,
  type ProviderSearchDocumentProjection,
  type ProviderSearchProjectionInput,
  type ServingProviderSliceClosureRow,
  type ServingResourceClosureRow,
} from "./index.js";

const publicationId = id("pub", 1);
const observedAt = "2026-08-02T00:00:00.000Z";

function id(prefix: string, sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function fact(value: string, evidenceSequence: number) {
  return {
    evidence_ids: [id("evd", evidenceSequence)],
    observed_at: observedAt,
    state: "known",
    value,
  } as const;
}

function unknownFact() {
  return {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  } as const;
}

function providerJson(
  providerId: string,
  displayName: string | null,
  affiliateRelationshipPresent = false,
  activeOfferingCount = 0,
  displayFactOverride?: unknown,
): string {
  return canonicalizePublicationJson(
    canonicalJson({
      active_offering_count: {
        derivation_version: "provider-count@1",
        observed_at: observedAt,
        value: activeOfferingCount,
      },
      affiliate_relationship_present: affiliateRelationshipPresent,
      display_name:
        displayFactOverride ??
        (displayName === null ? unknownFact() : fact(displayName, 1)),
      last_successful_refresh: fact(observedAt, 2),
      official_site: fact("https://provider.example", 3),
      precision_coverage: {
        derivation_version: "precision-coverage@1",
        known_count: 0,
        known_proportion_decimal: "0",
        unknown_count: 0,
      },
      provider_id: providerId,
      slug: fact(`provider-${providerId.slice(4, 12)}`, 4),
      status: fact("active", 5),
    }),
    "object",
  );
}

async function resource(
  providerId: string,
  displayName: string | null,
  affiliateRelationshipPresent = false,
  activeOfferingCount = 0,
  displayFactOverride?: unknown,
): Promise<ServingResourceClosureRow> {
  const resourceJson = providerJson(
    providerId,
    displayName,
    affiliateRelationshipPresent,
    activeOfferingCount,
    displayFactOverride,
  );
  const contentHash = await hashPublicationResourceContent({
    resourceType: "provider",
    resourceId: providerId,
    resourceJson,
  });
  return {
    resource_type: "provider",
    resource_id: providerId,
    resource_json: resourceJson,
    content_hash: contentHash,
  };
}

function slice(
  providerId: string,
  sequence: number,
  freshness: "fresh" | "stale" | "unavailable" = "fresh",
): ServingProviderSliceClosureRow {
  return {
    provider_id: providerId,
    provider_slice_id: freshness === "unavailable" ? null : id("prn", sequence),
    provider_run_id: id("pvr", sequence),
    adapter_version: "adapter@1",
    roster_version: "roster@1",
    source_register_version: "sources@1",
    carried_forward: freshness === "stale" ? 1 : 0,
    freshness_state: freshness,
  };
}

async function input(
  providers: readonly Readonly<{
    id: string;
    displayName: string | null;
    freshness?: "fresh" | "stale" | "unavailable";
    affiliate?: boolean;
    carriedForward?: boolean;
    offeringCount?: number;
    displayFactOverride?: unknown;
  }>[],
  options: Readonly<{ includeModel?: boolean }> = {},
): Promise<ProviderSearchProjectionInput> {
  const selected = providers.filter(
    (provider) => provider.freshness !== "unavailable",
  );
  const providerResources = await Promise.all(
    selected.map((provider) =>
      resource(
        provider.id,
        provider.displayName,
        provider.affiliate,
        provider.offeringCount,
        provider.displayFactOverride,
      ),
    ),
  );
  const modelId = id("mdl", 100);
  const modelResourceJson = "{}";
  const modelResourceHash = await hashPublicationResourceContent({
    resourceType: "model",
    resourceId: modelId,
    resourceJson: modelResourceJson,
  });
  const modelDocumentId = await derivePublicationVectorId(
    publicationId as `pub_${string}`,
    "model",
    modelId,
  );
  const modelDocument = {
    resourceType: "model" as const,
    resourceId: modelId,
    documentId: modelDocumentId,
    normalizedName: "unrelated model",
    aliasesJson: "[]",
    publisherName: "Publisher",
    providerModelIdsJson: "[]",
    documentText: "Unrelated model",
  };
  const modelDocumentHash =
    await hashPublicationSearchDocumentContent(modelDocument);
  const modelVector = {
    resourceType: "model" as const,
    resourceId: modelId,
    vectorId: modelDocumentId,
    searchDocumentContentHash: modelDocumentHash,
    embeddingInputHash: `sha256:${"e".repeat(64)}` as const,
  };
  const persistedResources = [
    ...providerResources.map((row) => ({
      resourceType: "provider" as const,
      resourceId: row.resource_id,
      resourceJson: row.resource_json,
      contentHash: row.content_hash as `sha256:${string}`,
    })),
    ...(options.includeModel
      ? [
          {
            resourceType: "model" as const,
            resourceId: modelId,
            resourceJson: modelResourceJson,
            contentHash: modelResourceHash,
          },
        ]
      : []),
  ];
  const resourceDescriptors = persistedResources
    .map(({ resourceType, resourceId, contentHash }) => ({
      resourceType,
      resourceId,
      contentHash,
    }))
    .sort((left, right) =>
      left.resourceId < right.resourceId
        ? -1
        : left.resourceId > right.resourceId
          ? 1
          : 0,
    );
  const resourceChunks =
    resourceDescriptors.length === 0
      ? []
      : [
          {
            kind: "resources" as const,
            ordinal: 0,
            firstKey: `provider:${resourceDescriptors[0]!.resourceId}`,
            lastKey: `provider:${resourceDescriptors.at(-1)!.resourceId}`,
            itemCount: resourceDescriptors.length,
            contentHash:
              await hashPublicationResourceChunk(resourceDescriptors),
          },
        ];
  const searchDocuments = options.includeModel
    ? [
        {
          ...modelDocument,
          contentHash: modelDocumentHash,
        },
      ]
    : [];
  const vectors = options.includeModel ? [modelVector] : [];
  const searchChunks = options.includeModel
    ? [
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
          contentHash: await hashPublicationVectorChunk(
            publicationId as `pub_${string}`,
            vectors,
          ),
        },
      ]
    : [];
  const servingSlices = providers.map((provider, index) => ({
    ...slice(provider.id, index + 1, provider.freshness),
    carried_forward:
      provider.carriedForward === undefined
        ? provider.freshness === "stale"
          ? 1
          : 0
        : provider.carriedForward
          ? 1
          : 0,
  }));
  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: "1.0.0",
    publicationId: publicationId as `pub_${string}`,
    sourceRunId: id("run", 1),
    parentPublicationId: null,
    generatedAt: observedAt,
    versions: {
      schema: "1.4.0",
      methodology: "1.0.0",
      precisionNormalization: "1.0.0",
      precisionDisplayOrder: "1.0.0",
      pricePolicy: "1.0.0",
      sourcePolicy: "1.0.0",
      embedding: "embedding@1",
      buildCommit: "test-commit",
    },
    enabledProviderScopeVersion: "provider-scope@1",
    enabledProviderIds: providers.map((provider) => provider.id),
    providerSlices: servingSlices.map((row) => ({
      providerId: row.provider_id,
      providerSliceId: row.provider_slice_id,
      providerRunId: row.provider_run_id,
      adapterVersion: row.adapter_version,
      rosterVersion: row.roster_version,
      sourceRegisterVersion: row.source_register_version,
      carriedForward: row.carried_forward === 1,
      freshnessState: row.freshness_state as "fresh" | "stale" | "unavailable",
    })),
    providerAttributions: selected.map((provider) => ({
      resourceType: "provider",
      resourceId: provider.id,
      providerId: provider.id,
    })),
    resources: persistedResources,
    searchDocuments,
    vectors,
    chunks: [...resourceChunks, ...searchChunks],
    bundleHash: `sha256:${"b".repeat(64)}`,
  });
  return {
    manifest,
    providerResources,
  };
}

function uint64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function tuple(
  domain: string,
  fields: readonly Readonly<{
    name: string;
    type: string;
    value: string;
  }>[],
): Buffer {
  const all = [
    { name: "hash_domain", type: "text", value: domain },
    { name: "encoding_version", type: "integer", value: "1" },
    ...fields,
  ];
  return Buffer.concat(
    all.flatMap((field) =>
      [field.name, field.type, field.value].flatMap((value) => {
        const bytes = Buffer.from(value, "utf8");
        return [uint64(bytes.length), bytes];
      }),
    ),
  );
}

function independentInventoryHash(
  documents: readonly ProviderSearchDocumentProjection[],
): string {
  const root = tuple("publication-provider-search-inventory", [
    {
      name: "provider_search_documents",
      type: "list",
      value: String(documents.length),
    },
  ]);
  const rows = documents.map((document) => {
    const row = tuple("publication-provider-search-document", [
      {
        name: "projection_version",
        type: "text",
        value: PROVIDER_SEARCH_PROJECTION_VERSION,
      },
      { name: "provider_id", type: "identifier", value: document.providerId },
      { name: "display_name", type: "text", value: document.displayName },
      { name: "normalized_name", type: "text", value: document.normalizedName },
      {
        name: "provider_resource_content_hash",
        type: "digest",
        value: document.providerResourceContentHash,
      },
    ]);
    return Buffer.concat([uint64(row.length), row]);
  });
  return `sha256:${createHash("sha256")
    .update(Buffer.concat([root, ...rows]))
    .digest("hex")}`;
}

describe("trusted provider search projection (SRCH-002, SRCH-006, BE-011)", () => {
  it("projects known fresh and carried-stale names and skips honest unknowns (FE-023, FE-025)", async () => {
    const freshId = id("prv", 1);
    const staleId = id("prv", 2);
    const unknownId = id("prv", 3);
    const unavailableId = id("prv", 4);
    const projection = await projectProviderSearchProjection(
      await input([
        { id: staleId, displayName: "Same—Name", freshness: "stale" },
        { id: unknownId, displayName: null },
        { id: unavailableId, displayName: null, freshness: "unavailable" },
        { id: freshId, displayName: "Same Name" },
      ]),
    );

    expect(projection.documents.map((document) => document.providerId)).toEqual(
      [freshId, staleId],
    );
    expect(
      projection.documents.map((document) => document.normalizedName),
    ).toEqual(["same name", "same name"]);
    expect(projection.documentCount).toBe(2);
    expect(projection.inventoryHash).toBe(
      independentInventoryHash(projection.documents),
    );
    expect(projection.inventoryHash).toBe(
      "sha256:690ecf074496ba5310c42d48c3087a3a0581538ba3cfd71f9a3a0622ab346642",
    );
    expect(() => {
      assertProviderSearchProjection(projection);
    }).not.toThrow();
    expect(Object.isFrozen(projection.documents[0])).toBe(true);
  });

  it("is permutation-invariant while affiliate and count facts never affect identity or order (AFF-004, FE-026)", async () => {
    const firstId = id("prv", 5);
    const secondId = id("prv", 6);
    const first = await input([
      { id: firstId, displayName: "First" },
      { id: secondId, displayName: "Second" },
    ]);
    const reversed = {
      ...first,
      providerResources: [...first.providerResources].reverse(),
    };
    const [left, right] = await Promise.all([
      projectProviderSearchProjection(first),
      projectProviderSearchProjection(reversed),
    ]);
    expect(right.documents).toEqual(left.documents);
    expect(right.inventoryHash).toBe(left.inventoryHash);

    const affiliateChanged = await projectProviderSearchProjection(
      await input([
        { id: firstId, displayName: "First", affiliate: true },
        { id: secondId, displayName: "Second" },
      ]),
    );
    expect(
      affiliateChanged.documents.map(({ displayName }) => displayName),
    ).toEqual(["First", "Second"]);
    expect(affiliateChanged.documents[0]?.providerResourceContentHash).not.toBe(
      left.documents[0]?.providerResourceContentHash,
    );
    expect(affiliateChanged.inventoryHash).not.toBe(left.inventoryHash);

    const offeringCountChanged = await projectProviderSearchProjection(
      await input([
        { id: firstId, displayName: "First", offeringCount: 999 },
        { id: secondId, displayName: "Second", offeringCount: 42 },
      ]),
    );
    expect(
      offeringCountChanged.documents.map(({ providerId, displayName }) => ({
        providerId,
        displayName,
      })),
    ).toEqual(
      left.documents.map(({ providerId, displayName }) => ({
        providerId,
        displayName,
      })),
    );
    expect(offeringCountChanged.inventoryHash).not.toBe(left.inventoryHash);

    const withUnrelatedModel = await projectProviderSearchProjection(
      await input(
        [
          { id: firstId, displayName: "First" },
          { id: secondId, displayName: "Second" },
        ],
        { includeModel: true },
      ),
    );
    expect(withUnrelatedModel.documents).toEqual(left.documents);
    expect(withUnrelatedModel.inventoryHash).toBe(left.inventoryHash);
    expect(withUnrelatedModel.closureHash).not.toBe(left.closureHash);
  });

  it("rejects copied projections and dishonest persisted linkage", async () => {
    const providerId = id("prv", 7);
    const source = await input([{ id: providerId, displayName: "Provider" }]);
    const projection = await projectProviderSearchProjection(source);
    expect(() => {
      assertProviderSearchProjection({ ...projection });
    }).toThrow("not trusted");
    expect(() => {
      assertProviderSearchProjection(
        JSON.parse(JSON.stringify(projection)) as unknown,
      );
    }).toThrow("not trusted");

    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: source.providerResources.map((row) => ({
          ...row,
          content_hash: `sha256:${"0".repeat(64)}`,
        })),
      }),
    ).rejects.toThrow("does not match the trusted manifest");
    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: [],
      }),
    ).rejects.toThrow("do not exactly match the trusted manifest");
    await expect(
      projectProviderSearchProjection({
        manifest: { ...source.manifest },
        providerResources: source.providerResources,
      }),
    ).rejects.toThrow("manifest is not trusted");

    const mutationSource = await input([
      { id: id("prv", 11), displayName: "Snapshot" },
    ]);
    const pending = projectProviderSearchProjection(mutationSource);
    (
      mutationSource.providerResources[0] as { resource_json: string }
    ).resource_json = "{}";
    await expect(pending).resolves.toMatchObject({
      documents: [{ displayName: "Snapshot" }],
    });
  });

  it("fails closed on duplicate, orphaned, and wrong-identity provider closure rows", async () => {
    const providerId = id("prv", 40);
    const otherProviderId = id("prv", 41);
    const source = await input([{ id: providerId, displayName: "Provider" }]);
    const providerRow = source.providerResources[0]!;

    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: [providerRow, providerRow],
      }),
    ).rejects.toThrow("contain a duplicate");

    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: [
          providerRow,
          {
            ...providerRow,
            resource_id: otherProviderId,
          },
        ],
      }),
    ).rejects.toThrow("do not exactly match the trusted manifest");

    const wrongIdentityJson = providerJson(otherProviderId, "Wrong Identity");
    const wrongIdentityHash = await hashPublicationResourceContent({
      resourceType: "provider",
      resourceId: providerId,
      resourceJson: wrongIdentityJson,
    });
    const wrongIdentityResources = [
      {
        resourceType: "provider" as const,
        resourceId: providerId,
        contentHash: wrongIdentityHash,
      },
    ];
    const wrongIdentityManifest = await buildImmutableManifest({
      ...source.manifest,
      resources: wrongIdentityResources,
      chunks: [
        {
          ...source.manifest.chunks[0]!,
          contentHash: await hashPublicationResourceChunk(
            wrongIdentityResources,
          ),
        },
      ],
    });
    await expect(
      projectProviderSearchProjection({
        manifest: wrongIdentityManifest,
        providerResources: [
          {
            resource_type: "provider",
            resource_id: providerId,
            resource_json: wrongIdentityJson,
            content_hash: wrongIdentityHash,
          },
        ],
      }),
    ).rejects.toThrow("identity does not match");

    await expect(
      buildImmutableManifest({
        ...source.manifest,
        providerSlices: [
          {
            ...source.manifest.providerSlices[0]!,
            providerSliceId: null,
            freshnessState: "unavailable",
          },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      buildImmutableManifest({
        ...source.manifest,
        providerAttributions: [
          ...source.manifest.providerAttributions,
          {
            resourceType: "provider",
            resourceId: otherProviderId,
            providerId: otherProviderId,
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("uses the exact empty-inventory tuple and rejects invalid dispositions", async () => {
    const unavailableId = id("prv", 8);
    const projection = await projectProviderSearchProjection(
      await input([
        { id: unavailableId, displayName: null, freshness: "unavailable" },
      ]),
    );
    expect(projection.documents).toEqual([]);
    expect(projection.inventoryHash).toBe(
      independentInventoryHash(projection.documents),
    );
    expect(projection.inventoryHash).toBe(
      "sha256:15b3de8d9c92735a8d5379c3f5dfee54ed5e47026c57f0ad4f41acd497cb89e3",
    );

    const invalid = await input([
      {
        id: id("prv", 9),
        displayName: "Invalid",
        carriedForward: true,
      },
    ]);
    await expect(projectProviderSearchProjection(invalid)).rejects.toThrow(
      "disposition is invalid",
    );

    const bounded = await input([
      { id: id("prv", 10), displayName: "Bounded" },
    ]);
    await expect(
      projectProviderSearchProjection({
        ...bounded,
        providerResources: Array.from(
          { length: 1_001 },
          () => bounded.providerResources[0]!,
        ),
      }),
    ).rejects.toThrow("invalid or too large");
  });

  it("bounds declared manifest and projection data before taking snapshots", async () => {
    const providerId = id("prv", 50);
    const source = await input([{ id: providerId, displayName: "Bounded" }]);
    const withIgnoredProperty = { ...source.manifest };
    Object.defineProperty(withIgnoredProperty, "ignored", {
      enumerable: true,
      get: () => {
        throw new Error("undeclared property was read");
      },
    });
    await expect(
      buildImmutableManifest(withIgnoredProperty),
    ).resolves.toBeDefined();

    await expect(
      buildImmutableManifest({
        ...source.manifest,
        enabledProviderIds: Array.from({ length: 500_001 }, () => providerId),
      }),
    ).rejects.toThrow("manifest item limit");

    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: [
          {
            ...source.providerResources[0]!,
            resource_id: "prv_" + "x".repeat(1_000_001),
          },
        ],
      }),
    ).rejects.toThrow("input is invalid");

    const nearLimitJson = "x".repeat(999_000);
    await expect(
      projectProviderSearchProjection({
        ...source,
        providerResources: Array.from({ length: 17 }, (_, index) => ({
          ...source.providerResources[0]!,
          resource_id: id("prv", 60 + index),
          resource_json: nearLimitJson,
        })),
      }),
    ).rejects.toThrow("input is too large");
  });

  it("rejects malformed fact evidence, timestamps, unknown values, and empty normalized names", async () => {
    const malformedFacts = [
      {
        evidence_ids: [],
        observed_at: observedAt,
        state: "known",
        value: "No Evidence",
      },
      {
        evidence_ids: [id("evd", 1)],
        observed_at: null,
        state: "known",
        value: "No Timestamp",
      },
      {
        evidence_ids: [],
        observed_at: null,
        state: "unknown",
        value: "Invented",
      },
    ];
    for (const [index, displayFactOverride] of malformedFacts.entries()) {
      const source = await input([
        {
          id: id("prv", 20 + index),
          displayName: "Ignored",
          displayFactOverride,
        },
      ]);
      await expect(projectProviderSearchProjection(source)).rejects.toThrow(
        "not contract-valid",
      );
    }

    await expect(
      projectProviderSearchProjection(
        await input([{ id: id("prv", 30), displayName: "—_( )" }]),
      ),
    ).rejects.toThrow("empty value");
  });
});
