import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  MODEL_VARIANT_NAME_SEARCH_EXACT_INDEX_NAME,
  MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCES,
  MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCE_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_RESOURCE_BYTES,
  MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION,
  MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
  assertModelVariantNameSearchArtifactProofV1,
  assertModelVariantNameSearchProjection,
  assertModelVariantNameSearchResourceByteBudget,
  assertModelVariantNameSearchStagingProjectionV1,
  assertModelVariantNameSearchQueryableArtifactProofV3,
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  projectModelVariantNameSearchArtifactProofV1,
  projectModelVariantNameSearchProjection,
  projectModelVariantNameSearchQueryabilityPlanV3,
  projectModelVariantNameSearchQueryableArtifactProofV3,
  projectModelVariantNameSearchStagingV1,
  readModelVariantNameSearchStagingPersistenceV1,
  type ModelVariantNameSearchStorageRowV1,
  type ModelVariantNameSearchProjectionInput,
  type ModelVariantNameSearchDocumentProjection,
  type PersistedResourceDescriptor,
  type SearchResourceType,
  type ServingClosureRows,
  type ServingResourceClosureRow,
} from "./index.js";

const observedAt = "2026-08-02T00:00:00.000Z";
const publicationId = id("pub", 1);

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

function known<T>(value: T, evidenceSequence = 1) {
  return {
    evidence_ids: [id("evd", evidenceSequence)],
    observed_at: observedAt,
    state: "known",
    value,
  } as const;
}

function nonKnown(state: "unknown" | "not_applicable" | "unavailable") {
  return {
    evidence_ids: [],
    observed_at: null,
    state,
    value: null,
  } as const;
}

function unknown() {
  return nonKnown("unknown");
}

function provider(affiliateRelationshipPresent: boolean) {
  return {
    active_offering_count: {
      derivation_version: "provider-count@1",
      observed_at: observedAt,
      value: affiliateRelationshipPresent ? 50 : 0,
    },
    affiliate_relationship_present: affiliateRelationshipPresent,
    display_name: known("Context Provider", 20),
    last_successful_refresh: known(observedAt, 21),
    official_site: known("https://provider.example", 22),
    precision_coverage: {
      derivation_version: "precision-coverage@1",
      known_count: affiliateRelationshipPresent ? 50 : 0,
      known_proportion_decimal: affiliateRelationshipPresent ? "1" : "0",
      unknown_count: 0,
    },
    provider_id: id("prv", 1),
    slug: known("context-provider", 23),
    status: known("active", 24),
  };
}

function relatedProviderResources(version: 1 | 2) {
  const evidenceId = id("evd", 30);
  const offeringId = id("off", 1);
  const priceId = id("pcs", 1);
  const precisionId = id("prc", 1);
  const applicability = {
    component_scope: null,
    endpoint_class: "chat",
    material_region_key: "",
    provider_id: id("prv", 1),
    provider_model_id: `provider-model-${String(version)}`,
    tier_key: "standard",
  };
  return [
    {
      resourceType: "offering" as const,
      resourceId: offeringId,
      value: {
        display_name: known(`Context Offering ${String(version)}`, 31),
        endpoint_class: "chat",
        evidence_ids: [evidenceId],
        first_observed_at: observedAt,
        last_observed_at: observedAt,
        last_successful_refresh: known(observedAt, 32),
        material_region_key: "",
        model_resource_id: id("mdl", 1),
        offering_id: offeringId,
        precision_observation_ids: [precisionId],
        price_ids: [priceId],
        provider_id: id("prv", 1),
        provider_model_id: applicability.provider_model_id,
        source_locator: known("https://provider.example/catalog", 33),
        stale: false,
        stale_reason: null,
        status: known("active", 34),
        supported_regions: known(version === 1 ? ["global"] : ["us", "eu"], 35),
        tier_key: "standard",
      },
    },
    {
      resourceType: "price" as const,
      resourceId: priceId,
      value: {
        amount_decimal: version === 1 ? "1" : "999",
        conditions: version === 1 ? [] : ["promotional context"],
        currency: "USD",
        currency_provenance: "provider_stated",
        effective_from: null,
        effective_to: null,
        evidence_ids: [evidenceId],
        is_standard_comparable: version === 1,
        observed_at: observedAt,
        offering_id: offeringId,
        price_class: version === 1 ? "standard" : "promotional",
        price_id: priceId,
        role: version === 1 ? "input" : "output",
        unit: "per_million_tokens",
      },
    },
    {
      resourceType: "precision_observation" as const,
      resourceId: precisionId,
      value: {
        applicability,
        components: [],
        evidence_ids: [evidenceId],
        format_variant: unknown(),
        normalized_format: known(version === 1 ? "BF16" : "FP8", 36),
        observed_at: observedAt,
        offering_id: offeringId,
        precision_id: precisionId,
        provider_definition: known("Provider-stated precision", 37),
        raw_field_name: "precision",
        raw_precision: known(version === 1 ? "bf16" : "fp8", 38),
        summary_format: known(version === 1 ? "BF16" : "FP8", 39),
      },
    },
  ];
}

function commonResource(displayName: string | null, sequence: number) {
  return {
    active_parameters: unknown(),
    architecture: unknown(),
    cataloged_provider_count: {
      derivation_version: "cataloged-provider-count@1",
      observed_at: observedAt,
      value: sequence,
    },
    checkpoints: [],
    context_window_tokens: unknown(),
    display_name: displayName === null ? unknown() : known(displayName),
    family_id: id("fam", 1),
    last_model_data_refresh: known(observedAt, 2),
    license: unknown(),
    maximum_output_tokens: unknown(),
    modalities: unknown(),
    publisher: known("Example Publisher", 3),
    release_date: known("2026-08-02", 4),
    slug: known(`resource-${String(sequence)}`, 5),
    source_quantization: unknown(),
    source_weight_format: unknown(),
    status: known("active", 6),
    total_parameters: unknown(),
  };
}

function model(
  sequence: number,
  displayName: string | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...commonResource(displayName, sequence),
    authoritative_checkpoint_ids: [],
    model_id: id("mdl", sequence),
    ...overrides,
  };
}

function variant(
  sequence: number,
  displayName: string | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...commonResource(displayName, sequence),
    checkpoint_ids: [],
    model_id: id("mdl", 1),
    selection_evidence: unknown(),
    variant_id: id("var", sequence),
    variant_kind: known("publisher_variant", 7),
    ...overrides,
  };
}

type CanonicalResource = Readonly<{
  resourceType: SearchResourceType;
  resourceId: string;
  value: Record<string, unknown>;
}>;

function resourceKey(resource: {
  resourceType: string;
  resourceId: string;
}): string {
  return `${resource.resourceType}:${resource.resourceId}`;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uint64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function independentTuple(
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
  documents: readonly ModelVariantNameSearchDocumentProjection[],
): string {
  const root = independentTuple(
    "publication-model-variant-name-search-inventory",
    [
      {
        name: "model_variant_name_search_documents",
        type: "list",
        value: String(documents.length),
      },
    ],
  );
  const rows = documents.map((document) =>
    independentTuple("publication-model-variant-name-search-document", [
      {
        name: "projection_version",
        type: "text",
        value: document.projectionVersion,
      },
      { name: "resource_type", type: "text", value: document.resourceType },
      {
        name: "resource_id",
        type: "identifier",
        value: document.resourceId,
      },
      { name: "display_name", type: "text", value: document.displayName },
      {
        name: "normalized_name",
        type: "text",
        value: document.normalizedName,
      },
      {
        name: "resource_content_hash",
        type: "digest",
        value: document.resourceContentHash,
      },
    ]),
  );
  const encoded = Buffer.concat([
    root,
    ...rows.map((row) => Buffer.concat([uint64(row.length), row])),
  ]);
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}

type ProjectionFixtureInput = ModelVariantNameSearchProjectionInput &
  Readonly<{ closureRows: ServingClosureRows }>;

async function projectionInput(
  source: readonly CanonicalResource[],
  options: Readonly<{
    providerAffiliate?: boolean;
    relatedContextVersion?: 1 | 2;
  }> = {},
): Promise<ProjectionFixtureInput> {
  const searchableResources = await Promise.all(
    source.map(async (resource) => {
      const resourceJson = canonicalizePublicationJson(
        canonicalJson(resource.value),
        "object",
      );
      return {
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        resourceJson,
        contentHash: await hashPublicationResourceContent({
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          resourceJson,
        }),
      };
    }),
  );
  const persistedResources: PersistedResourceDescriptor[] = [
    ...searchableResources,
  ];
  const hasProviderContext =
    options.providerAffiliate !== undefined ||
    options.relatedContextVersion !== undefined;
  if (hasProviderContext) {
    const resourceJson = canonicalizePublicationJson(
      canonicalJson(provider(options.providerAffiliate ?? false)),
      "object",
    );
    persistedResources.push({
      resourceType: "provider",
      resourceId: id("prv", 1),
      resourceJson,
      contentHash: await hashPublicationResourceContent({
        resourceType: "provider",
        resourceId: id("prv", 1),
        resourceJson,
      }),
    });
  }
  if (options.relatedContextVersion !== undefined) {
    for (const context of relatedProviderResources(
      options.relatedContextVersion,
    )) {
      const resourceJson = canonicalizePublicationJson(
        canonicalJson(context.value),
        "object",
      );
      persistedResources.push({
        resourceType: context.resourceType,
        resourceId: context.resourceId,
        resourceJson,
        contentHash: await hashPublicationResourceContent({
          resourceType: context.resourceType,
          resourceId: context.resourceId,
          resourceJson,
        }),
      });
    }
  }
  const searchDocuments = await Promise.all(
    searchableResources.map(async (resource) => {
      const documentId = await derivePublicationVectorId(
        publicationId as `pub_${string}`,
        resource.resourceType,
        resource.resourceId,
      );
      const document = {
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        documentId,
        normalizedName: "deliberately-untrusted-legacy-value",
        aliasesJson: "[]",
        publisherName: "Example Publisher",
        providerModelIdsJson: "[]",
        documentText: "Legacy broad search document",
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
  const sortedResources = [...persistedResources].sort((left, right) =>
    compareAscii(resourceKey(left), resourceKey(right)),
  );
  const sortedDocuments = [...searchDocuments].sort((left, right) =>
    compareAscii(resourceKey(left), resourceKey(right)),
  );
  const sortedVectors = [...vectors].sort((left, right) =>
    compareAscii(resourceKey(left), resourceKey(right)),
  );
  const firstKey = resourceKey(sortedResources[0]!);
  const lastKey = resourceKey(sortedResources.at(-1)!);
  const firstSearchKey = resourceKey(sortedDocuments[0]!);
  const lastSearchKey = resourceKey(sortedDocuments.at(-1)!);
  const chunks = [
    {
      kind: "resources" as const,
      ordinal: 0,
      firstKey,
      lastKey,
      itemCount: sortedResources.length,
      contentHash: await hashPublicationResourceChunk(sortedResources),
    },
    {
      kind: "exact_search" as const,
      ordinal: 0,
      firstKey: firstSearchKey,
      lastKey: lastSearchKey,
      itemCount: sortedDocuments.length,
      contentHash: await hashPublicationSearchChunk(sortedDocuments),
    },
    {
      kind: "vectors" as const,
      ordinal: 0,
      firstKey: firstSearchKey,
      lastKey: lastSearchKey,
      itemCount: sortedVectors.length,
      contentHash: await hashPublicationVectorChunk(
        publicationId as `pub_${string}`,
        sortedVectors,
      ),
    },
  ];
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
    enabledProviderIds: [id("prv", 1)],
    providerSlices: [
      !hasProviderContext
        ? {
            providerId: id("prv", 1),
            providerSliceId: null,
            providerRunId: id("pvr", 1),
            adapterVersion: "adapter@1",
            rosterVersion: "roster@1",
            sourceRegisterVersion: "sources@1",
            carriedForward: false,
            freshnessState: "unavailable" as const,
          }
        : {
            providerId: id("prv", 1),
            providerSliceId: id("prn", 1),
            providerRunId: id("pvr", 1),
            adapterVersion: "adapter@1",
            rosterVersion: "roster@1",
            sourceRegisterVersion: "sources@1",
            carriedForward: false,
            freshnessState: "fresh" as const,
          },
    ],
    providerAttributions: !hasProviderContext
      ? []
      : [
          {
            resourceType: "provider",
            resourceId: id("prv", 1),
            providerId: id("prv", 1),
          },
          ...(options.relatedContextVersion === undefined
            ? []
            : relatedProviderResources(options.relatedContextVersion).map(
                (resource) => ({
                  resourceType: resource.resourceType,
                  resourceId: resource.resourceId,
                  providerId: id("prv", 1),
                }),
              )),
        ],
    resources: persistedResources,
    searchDocuments,
    vectors,
    chunks,
    bundleHash: `sha256:${"b".repeat(64)}`,
  });
  const closureRows: ServingClosureRows = {
    publication: {
      publication_id: manifest.publicationId,
      source_run_id: manifest.sourceRunId,
      parent_publication_id: manifest.parentPublicationId,
      generated_at_ms: Date.parse(manifest.generatedAt),
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
    providerSlices: manifest.providerSlices.map((slice) => ({
      provider_id: slice.providerId,
      provider_slice_id: slice.providerSliceId,
      provider_run_id: slice.providerRunId,
      adapter_version: slice.adapterVersion,
      roster_version: slice.rosterVersion,
      source_register_version: slice.sourceRegisterVersion,
      carried_forward: slice.carriedForward ? 1 : 0,
      freshness_state: slice.freshnessState,
    })),
    providerAttributions: manifest.providerAttributions.map((attribution) => ({
      resource_type: attribution.resourceType,
      resource_id: attribution.resourceId,
      provider_id: attribution.providerId,
    })),
    resources: sortedResources.map((resource) => ({
      resource_type: resource.resourceType,
      resource_id: resource.resourceId,
      resource_json: resource.resourceJson,
      content_hash: resource.contentHash,
    })),
    searchDocuments: sortedDocuments.map((document) => ({
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
    vectors: sortedVectors.map((vector) => ({
      vector_namespace: manifest.publicationId,
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
    stagingRevision: 1,
    sealedAtMs: Date.parse(observedAt) + 60_000,
  };
  return {
    manifest,
    resources: searchableResources.map(
      (resource): ServingResourceClosureRow => ({
        resource_type: resource.resourceType,
        resource_id: resource.resourceId,
        resource_json: resource.resourceJson,
        content_hash: resource.contentHash,
      }),
    ),
    closureRows,
  };
}

function source(
  resourceType: SearchResourceType,
  sequence: number,
  value: Record<string, unknown>,
  outerId?: string,
): CanonicalResource {
  return {
    resourceType,
    resourceId:
      outerId ?? id(resourceType === "model" ? "mdl" : "var", sequence),
    value,
  };
}

describe("trusted model/variant canonical-name projection (SRCH-002, SRCH-006, SRCH-009)", () => {
  it("derives, sorts, freezes, and collision-preserves canonical names while ignoring legacy names", async () => {
    const input = await projectionInput([
      source("variant", 2, variant(2, "model-one")),
      source("model", 1, model(1, "ＭＯＤＥＬ-One")),
    ]);

    const projection = await projectModelVariantNameSearchProjection(input);

    expect(() => {
      assertModelVariantNameSearchProjection(projection);
    }).not.toThrow();
    expect(projection.projectionVersion).toBe(
      MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION,
    );
    expect(projection.documentCount).toBe(2);
    expect(
      projection.documents.map((document) => document.resourceType),
    ).toEqual(["model", "variant"]);
    expect(
      projection.documents.map((document) => document.normalizedName),
    ).toEqual(["model one", "model one"]);
    expect(projection.documents[0]?.displayName).toBe("ＭＯＤＥＬ-One");
    expect(projection.documents.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(projection.documents)).toBe(true);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(projection.inventoryHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("omits unknown names without inference and accepts an empty complete projection", async () => {
    const input = await projectionInput([
      source("model", 1, model(1, null)),
      source("variant", 1, variant(1, null)),
    ]);

    const projection = await projectModelVariantNameSearchProjection(input);

    expect(projection.documents).toEqual([]);
    expect(projection.documentCount).toBe(0);
    expect(projection.inventoryHash).toBe(
      independentInventoryHash(projection.documents),
    );
    expect(projection.inventoryHash).toBe(
      "sha256:8e2e3341b0f99a9134aac4e4669a4270e9078216cae1a8ec49565041797e9c96",
    );
  });

  it.each(["unknown", "not_applicable", "unavailable"] as const)(
    "omits %s model and variant names without inference",
    async (state) => {
      const input = await projectionInput([
        source("model", 1, model(1, null, { display_name: nonKnown(state) })),
        source(
          "variant",
          1,
          variant(1, null, { display_name: nonKnown(state) }),
        ),
      ]);

      const projection = await projectModelVariantNameSearchProjection(input);
      expect(projection.documents).toEqual([]);
    },
  );

  it("preserves NUL and pinned Unicode normalization through deterministic inventory identity", async () => {
    const resources = [
      source("variant", 2, variant(2, "Trailing\u0000")),
      source("model", 1, model(1, "\u0000A\u030A\t가\u0000Middle")),
    ];
    const forward = await projectModelVariantNameSearchProjection(
      await projectionInput(resources),
    );
    const reversed = await projectModelVariantNameSearchProjection(
      await projectionInput([...resources].reverse()),
    );

    expect(
      forward.documents.map((document) => document.normalizedName),
    ).toEqual(["\u0000å 가\u0000middle", "trailing\u0000"]);
    expect(reversed.documents).toEqual(forward.documents);
    expect(reversed.inventoryHash).toBe(forward.inventoryHash);
    expect(forward.inventoryHash).toBe(
      independentInventoryHash(forward.documents),
    );
    expect(forward.inventoryHash).toBe(
      "sha256:0948c7ebe50dc9321a3a2646344f902bed0be2776c190101a6594eebb1ecfd2c",
    );
  });

  it("keeps inclusion and ordering neutral when non-name canonical facts change", async () => {
    const first = await projectModelVariantNameSearchProjection(
      await projectionInput([
        source("model", 1, model(1, "Neutral Model")),
        source("variant", 1, variant(1, "Neutral Variant")),
      ]),
    );
    const second = await projectModelVariantNameSearchProjection(
      await projectionInput([
        source(
          "model",
          1,
          model(1, "Neutral Model", {
            cataloged_provider_count: {
              derivation_version: "cataloged-provider-count@2",
              observed_at: observedAt,
              value: 999,
            },
            status: known("inactive", 8),
          }),
        ),
        source("variant", 1, variant(1, "Neutral Variant")),
      ]),
    );

    expect(
      second.documents.map(
        ({ resourceType, resourceId, displayName, normalizedName }) => ({
          resourceType,
          resourceId,
          displayName,
          normalizedName,
        }),
      ),
    ).toEqual(
      first.documents.map(
        ({ resourceType, resourceId, displayName, normalizedName }) => ({
          resourceType,
          resourceId,
          displayName,
          normalizedName,
        }),
      ),
    );
    expect(second.documents[0]?.resourceContentHash).not.toBe(
      first.documents[0]?.resourceContentHash,
    );
  });

  it("keeps model facts and order neutral across provider, affiliate, offering, price, and precision context", async () => {
    const resources = [
      source("model", 1, model(1, "Neutral Model")),
      source("variant", 1, variant(1, "Neutral Variant")),
    ];
    const unaffiliated = await projectModelVariantNameSearchProjection(
      await projectionInput(resources, {
        providerAffiliate: false,
        relatedContextVersion: 1,
      }),
    );
    const affiliated = await projectModelVariantNameSearchProjection(
      await projectionInput(resources, {
        providerAffiliate: true,
        relatedContextVersion: 2,
      }),
    );

    expect(affiliated.documents).toEqual(unaffiliated.documents);
    expect(affiliated.inventoryHash).toBe(unaffiliated.inventoryHash);
    expect(affiliated.closureHash).not.toBe(unaffiliated.closureHash);
  });

  it("rejects incomplete, duplicate, extra, substituted, and post-seal mutated bytes", async () => {
    const input = await projectionInput([
      source("model", 1, model(1, "Model")),
      source("variant", 1, variant(1, "Variant")),
    ]);
    await expect(
      projectModelVariantNameSearchProjection({
        ...input,
        resources: input.resources.slice(1),
      }),
    ).rejects.toThrow(/exactly match/u);
    await expect(
      projectModelVariantNameSearchProjection({
        ...input,
        resources: [input.resources[0]!, input.resources[0]!],
      }),
    ).rejects.toThrow(/duplicate/u);
    const unrelated = await projectionInput([
      source("model", 2, model(2, "Extra Model")),
    ]);
    await expect(
      projectModelVariantNameSearchProjection({
        ...input,
        resources: [...input.resources, unrelated.resources[0]!],
      }),
    ).rejects.toThrow(/exactly match/u);

    const mutatedBytes = input.resources.map((resource, index) =>
      index === 0 ? { ...resource, resource_json: "{}" } : resource,
    );
    await expect(
      projectModelVariantNameSearchProjection({
        ...input,
        resources: mutatedBytes,
      }),
    ).rejects.toThrow(/content hash does not match/u);

    const substituted = input.resources.map((resource, index) =>
      index === 0
        ? { ...resource, content_hash: input.resources[1]!.content_hash }
        : resource,
    );
    await expect(
      projectModelVariantNameSearchProjection({
        ...input,
        resources: substituted,
      }),
    ).rejects.toThrow(/trusted manifest/u);
  });

  it("enforces count, per-resource UTF-8, and aggregate byte ceilings before hashing", async () => {
    const input = await projectionInput([
      source("model", 1, model(1, "Bounded Model")),
    ]);
    await expect(
      projectModelVariantNameSearchProjection({
        ...input,
        resources: Array.from(
          { length: MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCES + 1 },
          () => input.resources[0]!,
        ),
      }),
    ).rejects.toThrow(/too large/u);
    await expect(
      projectModelVariantNameSearchProjection({
        ...input,
        resources: [
          {
            ...input.resources[0]!,
            resource_json: "🙂".repeat(
              Math.floor(MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCE_BYTES / 4) + 1,
            ),
          },
        ],
      }),
    ).rejects.toThrow(/too large/u);

    expect(() => {
      assertModelVariantNameSearchResourceByteBudget(
        Array.from(
          {
            length:
              Math.floor(
                MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_RESOURCE_BYTES /
                  MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCE_BYTES,
              ) + 1,
          },
          () => MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCE_BYTES,
        ),
      );
    }).toThrow(/too large/u);
  });

  it.each([
    [
      "closed shape",
      model(1, "Model", { unexpected: true }),
      /contract-valid/u,
    ],
    [
      "evidence",
      model(1, "Model", {
        display_name: {
          evidence_ids: [],
          observed_at: observedAt,
          state: "known",
          value: "Model",
        },
      }),
      /contract-valid/u,
    ],
    [
      "timestamp",
      model(1, "Model", {
        display_name: {
          evidence_ids: [id("evd", 1)],
          observed_at: "2026-08-02T00:00:00Z",
          state: "known",
          value: "Model",
        },
      }),
      /contract-valid/u,
    ],
    [
      "unpaired surrogate",
      model(1, "bad\ud800name"),
      /contract-valid|cannot be normalized/u,
    ],
    ["normalization to empty", model(1, " \t\n"), /cannot be normalized/u],
  ])(
    "rejects invalid known-name %s resources",
    async (_label, value, error) => {
      const input = await projectionInput([source("model", 1, value)]);
      await expect(
        projectModelVariantNameSearchProjection(input),
      ).rejects.toThrow(error);
    },
  );

  it("rejects an outer/canonical identity mismatch", async () => {
    const input = await projectionInput([
      source("model", 1, model(2, "Wrong identity"), id("mdl", 1)),
    ]);
    await expect(
      projectModelVariantNameSearchProjection(input),
    ).rejects.toThrow(/identity does not match/u);
  });

  it("keeps nominal trust out of band and snapshots caller-owned rows before hashing", async () => {
    const input = await projectionInput([
      source("model", 1, model(1, "Snapshot Model")),
    ]);
    expect(() => {
      assertModelVariantNameSearchProjection({
        publicationId: input.manifest.publicationId,
        closureHash: input.manifest.closureHash,
        projectionVersion: MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION,
        normalizationVersion: "exact-search-normalization@1",
        documents: [],
        documentCount: 0,
        inventoryHash: `sha256:${"0".repeat(64)}`,
      });
    }).toThrow(/not trusted/u);

    const mutableRows = input.resources.map((resource) => ({ ...resource }));
    const pending = projectModelVariantNameSearchProjection({
      manifest: input.manifest,
      resources: mutableRows,
    });
    mutableRows[0]!.resource_json = "{}";
    const projection = await pending;
    expect(projection.documents[0]?.displayName).toBe("Snapshot Model");

    const copied = { ...projection };
    expect(() => {
      assertModelVariantNameSearchProjection(copied);
    }).toThrow(/not trusted/u);
    const copiedManifest = { ...input.manifest };
    await expect(
      projectModelVariantNameSearchProjection({
        manifest: copiedManifest,
        resources: input.resources,
      }),
    ).rejects.toThrow(/manifest is not trusted/u);
  });
});

describe("model/variant canonical-name storage proof (ADR 0026, PIPE-050)", () => {
  async function storageFixture() {
    const input = await projectionInput([
      source("variant", 2, variant(2, "Trailing🙂\u0000")),
      source("model", 1, model(1, "\u0000A\u030A\t가\u0000Middle")),
    ]);
    const projection = await projectModelVariantNameSearchProjection(input);
    const staging = await projectModelVariantNameSearchStagingV1({
      projection,
      closureRows: input.closureRows,
    });
    const persistence = readModelVariantNameSearchStagingPersistenceV1(staging);
    return { input, projection, staging, persistence };
  }

  function detachedRows(rows: readonly ModelVariantNameSearchStorageRowV1[]) {
    return rows.map((row) => ({
      ...row,
      display_name_utf8: [...row.display_name_utf8],
      normalized_name_utf8: [...row.normalized_name_utf8],
    }));
  }

  it("projects frozen detached UTF-8 BLOB-bind rows without a lossy string boundary", async () => {
    const { projection, staging, persistence } = await storageFixture();

    expect(() => {
      assertModelVariantNameSearchStagingProjectionV1(staging);
    }).not.toThrow();
    expect(persistence).toMatchObject({
      publicationId: projection.publicationId,
      closureHash: projection.closureHash,
      stagingRevision: 1,
      projectionVersion: MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION,
      storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
      documentCount: 2,
      inventoryHash: projection.inventoryHash,
    });
    expect(persistence.rows).toHaveLength(2);
    expect(persistence.rows[0]?.display_name_utf8).toEqual([
      0, 65, 204, 138, 9, 225, 132, 128, 225, 133, 161, 0, 77, 105, 100, 100,
      108, 101,
    ]);
    expect(persistence.rows[0]?.normalized_name_utf8).toEqual([
      0, 195, 165, 32, 234, 176, 128, 0, 109, 105, 100, 100, 108, 101,
    ]);
    expect(persistence.rows[1]?.display_name_utf8.at(-1)).toBe(0);
    expect(persistence.rows[1]?.normalized_name_utf8.at(-1)).toBe(0);
    for (const [index, row] of persistence.rows.entries()) {
      const document = projection.documents[index]!;
      expect(row).toEqual({
        publication_id: projection.publicationId,
        resource_type: document.resourceType,
        resource_id: document.resourceId,
        projection_version: MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION,
        display_name_utf8: Array.from(
          new TextEncoder().encode(document.displayName),
        ),
        normalized_name_utf8: Array.from(
          new TextEncoder().encode(document.normalizedName),
        ),
        resource_content_hash: document.resourceContentHash,
      });
      expect(row.display_name_utf8).toContain(0);
      expect(Object.keys(row)).not.toContain("display_name");
      expect(Object.keys(row)).not.toContain("normalized_name");
      expect(Object.isFrozen(row.display_name_utf8)).toBe(true);
      expect(Object.isFrozen(row.normalized_name_utf8)).toBe(true);
      expect(Object.isFrozen(row)).toBe(true);
    }
    expect(Object.isFrozen(persistence.rows)).toBe(true);
    expect(Object.isFrozen(persistence)).toBe(true);
  });

  it("derives exact storage parity from caller-observed rows and snapshots them", async () => {
    const { projection, staging, persistence } = await storageFixture();
    const observedRows = detachedRows(persistence.rows);
    const proof = projectModelVariantNameSearchArtifactProofV1({
      staging,
      observation: {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: observedRows,
      },
    });

    expect(() => {
      assertModelVariantNameSearchArtifactProofV1(proof);
    }).not.toThrow();
    expect(proof).toEqual({
      model_variant_name_projection_version:
        MODEL_VARIANT_NAME_SEARCH_PROJECTION_VERSION,
      model_variant_name_document_count: 2,
      model_variant_name_inventory_hash: projection.inventoryHash,
      model_variant_name_storage_version:
        MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
      model_variant_name_storage_document_count: 2,
      model_variant_name_storage_exact_parity: true,
    });
    observedRows[0]!.display_name_utf8[0] = 120;
    observedRows.splice(1);
    expect(() => {
      assertModelVariantNameSearchArtifactProofV1(proof);
    }).not.toThrow();
    expect(Object.isFrozen(proof)).toBe(true);
  });

  it("uses indexed snapshots without invoking caller map or iteration hooks", async () => {
    const { staging, persistence } = await storageFixture();
    const rows = detachedRows(persistence.rows);
    const forbidden = () => {
      throw new Error("caller iteration hook invoked");
    };
    for (const row of rows) {
      Object.defineProperty(row, Symbol.iterator, { value: forbidden });
      Object.defineProperty(row.display_name_utf8, "map", {
        value: forbidden,
      });
      Object.defineProperty(row.display_name_utf8, Symbol.iterator, {
        value: forbidden,
      });
      Object.defineProperty(row.normalized_name_utf8, "map", {
        value: forbidden,
      });
      Object.defineProperty(row.normalized_name_utf8, Symbol.iterator, {
        value: forbidden,
      });
    }
    Object.defineProperty(rows, "map", { value: forbidden });
    Object.defineProperty(rows, Symbol.iterator, { value: forbidden });

    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging,
        observation: {
          storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
          rows,
        },
      }),
    ).not.toThrow();
  });

  it("captures observation and byte-array getters and lengths exactly once", async () => {
    const { staging, persistence } = await storageFixture();
    const rows = detachedRows(persistence.rows);
    let observedRowsReads = 0;
    let observedRowsLengthReads = 0;
    let byteLengthReads = 0;
    const proxiedDisplayBytes = new Proxy(rows[0]!.display_name_utf8, {
      get(target, property, receiver) {
        if (property === "length") {
          byteLengthReads += 1;
          if (byteLengthReads > 1)
            throw new Error("byte length read more than once");
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    rows[0] = { ...rows[0]!, display_name_utf8: proxiedDisplayBytes };
    const proxiedRows = new Proxy(rows, {
      get(target, property, receiver) {
        if (property === "length") {
          observedRowsLengthReads += 1;
          if (observedRowsLengthReads > 1)
            throw new Error("row count read more than once");
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const observation = {} as Record<string, unknown>;
    Object.defineProperties(observation, {
      rows: {
        enumerable: true,
        get() {
          observedRowsReads += 1;
          if (observedRowsReads > 1)
            throw new Error("observation rows read more than once");
          return proxiedRows;
        },
      },
      storageVersion: {
        enumerable: true,
        value: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
      },
    });

    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging,
        observation: observation as Parameters<
          typeof projectModelVariantNameSearchArtifactProofV1
        >[0]["observation"],
      }),
    ).not.toThrow();
    expect(observedRowsReads).toBe(1);
    expect(observedRowsLengthReads).toBe(1);
    expect(byteLengthReads).toBe(1);
  });

  it("rejects wrong counts before row access and stops at the first mismatch", async () => {
    const { staging, persistence } = await storageFixture();
    const inaccessibleRows = new Array<unknown>(1);
    Object.defineProperty(inaccessibleRows, 0, {
      get() {
        throw new Error("row getter must not run after count mismatch");
      },
    });
    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging,
        observation: {
          storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
          rows: inaccessibleRows as readonly ModelVariantNameSearchStorageRowV1[],
        },
      }),
    ).toThrow(/does not exactly match/u);

    const rows = detachedRows(persistence.rows);
    rows[0] = { ...rows[0]!, resource_id: id("mdl", 99) };
    Object.defineProperty(rows, 1, {
      get() {
        throw new Error("later row getter must not run after mismatch");
      },
    });
    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging,
        observation: {
          storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
          rows,
        },
      }),
    ).toThrow(/does not exactly match/u);
  });

  it("keeps staging and artifact authority nominal and bound to the matching closure", async () => {
    const { staging, persistence, projection } = await storageFixture();
    expect(() => {
      assertModelVariantNameSearchStagingProjectionV1({ ...staging });
    }).toThrow(/not trusted/u);
    expect(() => {
      readModelVariantNameSearchStagingPersistenceV1({ ...staging });
    }).toThrow(/not trusted/u);
    const proof = projectModelVariantNameSearchArtifactProofV1({
      staging,
      observation: {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: detachedRows(persistence.rows),
      },
    });
    expect(() => {
      assertModelVariantNameSearchArtifactProofV1({ ...proof });
    }).toThrow(/not trusted/u);

    const unrelated = await projectionInput([
      source("model", 9, model(9, "Different closure")),
    ]);
    await expect(
      projectModelVariantNameSearchStagingV1({
        projection,
        closureRows: unrelated.closureRows,
      }),
    ).rejects.toThrow(/does not match projection/u);
    await expect(
      projectModelVariantNameSearchStagingV1({
        projection: { ...projection },
        closureRows: unrelated.closureRows,
      }),
    ).rejects.toThrow(/not trusted/u);
  });

  it("snapshots caller-owned closure rows before asynchronous sealing", async () => {
    const input = await projectionInput([
      source("model", 1, model(1, "Closure Snapshot")),
    ]);
    const projection = await projectModelVariantNameSearchProjection(input);
    const mutableClosureRows = structuredClone(input.closureRows);
    const pending = projectModelVariantNameSearchStagingV1({
      projection,
      closureRows: mutableClosureRows,
    });
    Object.assign(mutableClosureRows.publication, {
      closure_hash: `sha256:${"0".repeat(64)}`,
    });
    Object.assign(mutableClosureRows.resources[0]!, { resource_json: "{}" });

    const staging = await pending;
    expect(
      readModelVariantNameSearchStagingPersistenceV1(staging),
    ).toMatchObject({
      closureHash: projection.closureHash,
      stagingRevision: 1,
    });
  });

  it("fails closed on altered, reordered, malformed, or non-canonical observations", async () => {
    const { staging, persistence } = await storageFixture();
    const rows = detachedRows(persistence.rows);
    const first = rows[0]!;
    const second = rows[1]!;
    const malformedObservations: unknown[] = [
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: rows.slice(1),
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [...rows, detachedRows([first])[0]!],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [second, first],
      },
      {
        storageVersion: "model-variant-name-utf8-blob@2",
        rows,
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, publication_id: id("pub", 2) }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, resource_type: "variant" }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, resource_id: id("mdl", 99) }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [
          { ...first, projection_version: "model-variant-name@2" },
          second,
        ],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [
          { ...first, resource_content_hash: `sha256:${"0".repeat(64)}` },
          second,
        ],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, display_name_utf8: [120] }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, normalized_name_utf8: [120] }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, display_name_utf8: [] }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, display_name_utf8: [256] }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, display_name_utf8: [1.5] }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, display_name_utf8: [0xc3, 0x28] }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [
          {
            ...first,
            display_name_utf8: [
              0xed,
              0xa0,
              0x80,
              ...first.display_name_utf8.slice(3),
            ],
          },
          second,
        ],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [
          {
            ...first,
            display_name_utf8: [
              0xc0,
              0x80,
              ...first.display_name_utf8.slice(2),
            ],
          },
          second,
        ],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, normalized_name_utf8: [] }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, display_name_utf8: null }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [
          {
            ...first,
            display_name_utf8: Uint8Array.from(first.display_name_utf8),
          },
          second,
        ],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [{ ...first, unexpected: true }, second],
      },
      {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows,
        exactParity: true,
      },
    ];

    for (const observation of malformedObservations) {
      expect(() =>
        projectModelVariantNameSearchArtifactProofV1({
          staging,
          observation: observation as Parameters<
            typeof projectModelVariantNameSearchArtifactProofV1
          >[0]["observation"],
        }),
      ).toThrow(/storage|UTF-8/u);
    }
  });

  it("enforces byte and row-count ceilings before accepting observations", async () => {
    const { staging, persistence } = await storageFixture();
    const rows = detachedRows(persistence.rows);
    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging,
        observation: {
          storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
          rows: [
            {
              ...rows[0]!,
              display_name_utf8: Array.from(
                {
                  length:
                    MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES + 1,
                },
                () => 97,
              ),
            },
            rows[1]!,
          ],
        },
      }),
    ).toThrow(/UTF-8 bytes is invalid/u);
    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging,
        observation: {
          storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
          rows: [
            {
              ...rows[0]!,
              normalized_name_utf8: Array.from(
                {
                  length:
                    MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES +
                    1,
                },
                () => 97,
              ),
            },
            rows[1]!,
          ],
        },
      }),
    ).toThrow(/UTF-8 bytes is invalid/u);
    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging,
        observation: {
          storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
          rows: Array.from(
            { length: MODEL_VARIANT_NAME_SEARCH_MAX_RESOURCES + 1 },
            () => rows[0]!,
          ),
        },
      }),
    ).toThrow(/storage observation is invalid/u);
  });

  it("accepts the exact 800-byte display-name boundary without an off-by-one rejection", async () => {
    const displayName = "🙂".repeat(200);
    const input = await projectionInput([
      source("model", 1, model(1, displayName)),
    ]);
    const projection = await projectModelVariantNameSearchProjection(input);
    const staging = await projectModelVariantNameSearchStagingV1({
      projection,
      closureRows: input.closureRows,
    });
    const persistence = readModelVariantNameSearchStagingPersistenceV1(staging);

    expect(MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES).toBe(800);
    expect(persistence.rows[0]?.display_name_utf8).toHaveLength(800);
    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging,
        observation: {
          storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
          rows: detachedRows(persistence.rows),
        },
      }),
    ).not.toThrow();
  });

  it("preserves distinct model/variant rows when canonical names normalize to a collision", async () => {
    const input = await projectionInput([
      source("variant", 1, variant(1, "model_one")),
      source("model", 1, model(1, "ＭＯＤＥＬ-One")),
    ]);
    const projection = await projectModelVariantNameSearchProjection(input);
    const staging = await projectModelVariantNameSearchStagingV1({
      projection,
      closureRows: input.closureRows,
    });
    const persistence = readModelVariantNameSearchStagingPersistenceV1(staging);
    const proof = projectModelVariantNameSearchArtifactProofV1({
      staging,
      observation: {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: detachedRows(persistence.rows),
      },
    });

    expect(persistence.rows).toHaveLength(2);
    expect(persistence.rows[0]?.resource_type).toBe("model");
    expect(persistence.rows[1]?.resource_type).toBe("variant");
    expect(persistence.rows[0]?.normalized_name_utf8).toEqual(
      persistence.rows[1]?.normalized_name_utf8,
    );
    expect(proof.model_variant_name_storage_document_count).toBe(2);
    expect(proof.model_variant_name_storage_exact_parity).toBe(true);

    const queryability = projectModelVariantNameSearchQueryabilityPlanV3(proof);
    expect(queryability.indexName).toBe(
      MODEL_VARIANT_NAME_SEARCH_EXACT_INDEX_NAME,
    );
    expect(queryability.matchNormalizedNameUtf8).toEqual(
      persistence.rows[0]?.normalized_name_utf8,
    );
    expect(queryability.matchResourceIds).toEqual(
      persistence.rows.map((row) => row.resource_id).sort(),
    );
    expect(queryability.missResourceIds).toEqual([]);
    expect(queryability.missNormalizedNameUtf8).not.toEqual(
      queryability.matchNormalizedNameUtf8,
    );

    const queryableProof =
      projectModelVariantNameSearchQueryableArtifactProofV3({
        storageProof: proof,
        queryability: {
          indexName: queryability.indexName,
          matchNormalizedNameUtf8: [...queryability.matchNormalizedNameUtf8],
          matchResourceIds: [...queryability.matchResourceIds],
          missNormalizedNameUtf8: [...queryability.missNormalizedNameUtf8],
          missResourceIds: [],
        },
      });
    expect(() => {
      assertModelVariantNameSearchQueryableArtifactProofV3(queryableProof);
    }).not.toThrow();
    expect(Object.keys(queryableProof)).toEqual([
      "model_variant_name_projection_version",
      "model_variant_name_document_count",
      "model_variant_name_inventory_hash",
      "model_variant_name_storage_version",
      "model_variant_name_storage_document_count",
      "model_variant_name_storage_queryable",
      "model_variant_name_storage_exact_parity",
    ]);
    expect(queryableProof).toMatchObject({
      ...proof,
      model_variant_name_storage_queryable: true,
    });
    expect(() => {
      assertModelVariantNameSearchQueryableArtifactProofV3({
        ...queryableProof,
      });
    }).toThrow(/not trusted/u);
    expect(() =>
      projectModelVariantNameSearchQueryableArtifactProofV3({
        storageProof: proof,
        queryability: {
          ...queryability,
          matchResourceIds: queryability.matchResourceIds.slice(1),
        },
      }),
    ).toThrow(/trusted probe/u);
  });

  it("keeps storage rows and proof fields neutral across unrelated provider context", async () => {
    const resources = [
      source("model", 1, model(1, "Neutral Model")),
      source("variant", 1, variant(1, "Neutral Variant")),
    ];
    const firstInput = await projectionInput(resources, {
      providerAffiliate: false,
      relatedContextVersion: 1,
    });
    const secondInput = await projectionInput(resources, {
      providerAffiliate: true,
      relatedContextVersion: 2,
    });
    const firstProjection =
      await projectModelVariantNameSearchProjection(firstInput);
    const secondProjection =
      await projectModelVariantNameSearchProjection(secondInput);
    const firstStaging = await projectModelVariantNameSearchStagingV1({
      projection: firstProjection,
      closureRows: firstInput.closureRows,
    });
    const secondStaging = await projectModelVariantNameSearchStagingV1({
      projection: secondProjection,
      closureRows: secondInput.closureRows,
    });
    const firstPersistence =
      readModelVariantNameSearchStagingPersistenceV1(firstStaging);
    const secondPersistence =
      readModelVariantNameSearchStagingPersistenceV1(secondStaging);
    const firstProof = projectModelVariantNameSearchArtifactProofV1({
      staging: firstStaging,
      observation: {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: detachedRows(firstPersistence.rows),
      },
    });
    const secondProof = projectModelVariantNameSearchArtifactProofV1({
      staging: secondStaging,
      observation: {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: detachedRows(secondPersistence.rows),
      },
    });

    expect(secondPersistence.rows).toEqual(firstPersistence.rows);
    expect(secondPersistence.inventoryHash).toBe(
      firstPersistence.inventoryHash,
    );
    expect(secondPersistence.closureHash).not.toBe(
      firstPersistence.closureHash,
    );
    expect(secondProof).toEqual(firstProof);
  });

  it("proves an empty complete projection without inventing storage rows", async () => {
    const input = await projectionInput([
      source("model", 1, model(1, null)),
      source("variant", 1, variant(1, null)),
    ]);
    const projection = await projectModelVariantNameSearchProjection(input);
    const staging = await projectModelVariantNameSearchStagingV1({
      projection,
      closureRows: input.closureRows,
    });
    const persistence = readModelVariantNameSearchStagingPersistenceV1(staging);
    const proof = projectModelVariantNameSearchArtifactProofV1({
      staging,
      observation: {
        storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
        rows: [],
      },
    });

    expect(persistence.rows).toEqual([]);
    expect(proof.model_variant_name_document_count).toBe(0);
    expect(proof.model_variant_name_storage_document_count).toBe(0);
    expect(proof.model_variant_name_storage_exact_parity).toBe(true);
    const queryability = projectModelVariantNameSearchQueryabilityPlanV3(proof);
    expect(queryability.matchResourceIds).toEqual([]);
    expect(queryability.missResourceIds).toEqual([]);
    expect(queryability.matchNormalizedNameUtf8).toEqual([]);
    expect(queryability.missNormalizedNameUtf8).toEqual([]);
    expect(() =>
      projectModelVariantNameSearchQueryableArtifactProofV3({
        storageProof: proof,
        queryability,
      }),
    ).not.toThrow();
  });
});
