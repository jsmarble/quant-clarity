import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { checkOfferingContract } from "@quant-clarity/contracts";

import {
  PROVIDER_MODEL_ID_SEARCH_MAX_INVENTORY_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCE_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCES,
  PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_RESOURCE_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_UTF8_BYTES,
  PROVIDER_MODEL_ID_SEARCH_PROJECTION_VERSION,
  advanceProviderModelIdSearchRetainedTextByteBudget,
  assertImmutablePublicationManifest,
  assertProviderModelIdSearchInventoryByteBudget,
  assertProviderModelIdSearchProjection,
  assertProviderModelIdSearchResourceByteBudget,
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  normalizeExactSearchName,
  projectProviderModelIdSearchProjection,
  type PersistedResourceDescriptor,
  type ProviderModelIdSearchDocumentProjection,
  type ProviderModelIdSearchProjectionInput,
  type ResourceType,
  type SearchResourceType,
  type ServingResourceClosureRow,
} from "./index.js";

const observedAt = "2026-08-02T00:00:00.000Z";
const publicationId = id("pub", 51);

function id(prefix: string, sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000051`;
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

function known<T>(value: T, sequence = 1) {
  return {
    evidence_ids: [id("evd", sequence)],
    observed_at: observedAt,
    state: "known",
    value,
  } as const;
}

function unknown() {
  return {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  } as const;
}

function commonTarget(displayName: string, sequence: number) {
  return {
    active_parameters: unknown(),
    architecture: unknown(),
    cataloged_provider_count: {
      derivation_version: "cataloged-provider-count@1",
      observed_at: observedAt,
      value: 1,
    },
    checkpoints: [],
    context_window_tokens: unknown(),
    display_name: known(displayName, sequence + 20),
    family_id: id("fam", 1),
    last_model_data_refresh: known(observedAt, sequence + 21),
    license: unknown(),
    maximum_output_tokens: unknown(),
    modalities: unknown(),
    publisher: known("Synthetic Publisher", sequence + 22),
    release_date: known("2026-08-02", sequence + 23),
    slug: known(`target-${String(sequence)}`, sequence + 24),
    source_quantization: unknown(),
    source_weight_format: unknown(),
    status: known("active", sequence + 25),
    total_parameters: unknown(),
  };
}

function model(sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    ...commonTarget(`Model ${String(sequence)}`, sequence),
    authoritative_checkpoint_ids: [],
    model_id: id("mdl", sequence),
    ...overrides,
  };
}

function variant(sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    ...commonTarget(`Variant ${String(sequence)}`, sequence),
    checkpoint_ids: [],
    model_id: id("mdl", 1),
    selection_evidence: known("Explicitly selectable", sequence + 30),
    variant_id: id("var", sequence),
    variant_kind: known("publisher_variant", sequence + 31),
    ...overrides,
  };
}

function offering(
  sequence: number,
  targetId: string,
  rawProviderModelId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    display_name: known(`Offering ${String(sequence)}`, sequence + 40),
    endpoint_class: "serverless",
    evidence_ids: [id("evd", sequence + 41)],
    first_observed_at: observedAt,
    last_observed_at: observedAt,
    last_successful_refresh: known(observedAt, sequence + 42),
    material_region_key: "",
    model_resource_id: targetId,
    offering_id: id("off", sequence),
    precision_observation_ids: [],
    price_ids: [],
    provider_id: id("prv", 1),
    provider_model_id: rawProviderModelId,
    source_locator: known("https://provider.example/catalog", sequence + 43),
    stale: false,
    stale_reason: null,
    status: known("active", sequence + 44),
    supported_regions: known(["global"], sequence + 45),
    tier_key: "standard",
    ...overrides,
  };
}

function provider(contextVersion: 1 | 2) {
  return {
    active_offering_count: {
      derivation_version: "provider-count@1",
      observed_at: observedAt,
      value: contextVersion,
    },
    affiliate_relationship_present: contextVersion === 2,
    display_name: known(`Provider Context ${String(contextVersion)}`, 70),
    last_successful_refresh: known(observedAt, 71),
    official_site: known(
      `https://provider${String(contextVersion)}.example`,
      72,
    ),
    precision_coverage: {
      derivation_version: "coverage@1",
      known_count: contextVersion,
      known_proportion_decimal: contextVersion === 1 ? "0.5" : "1",
      unknown_count: contextVersion === 1 ? 1 : 0,
    },
    provider_id: id("prv", 1),
    slug: known("provider-context", 73),
    status: known("active", 74),
  };
}

type ResourceSpec = Readonly<{
  resourceType: ResourceType;
  resourceId: string;
  value: Record<string, unknown>;
}>;

function spec(
  resourceType: ResourceType,
  resourceId: string,
  value: Record<string, unknown>,
): ResourceSpec {
  return { resourceType, resourceId, value };
}

function contextResources(version: 1 | 2, offeringId: string): ResourceSpec[] {
  const priceId = id("pcs", 1);
  const precisionId = id("prc", 1);
  return [
    spec("provider", id("prv", 1), provider(version)),
    spec("price", priceId, {
      amount_decimal: version === 1 ? "1" : "999",
      conditions: version === 1 ? [] : ["promotional context"],
      currency: "USD",
      currency_provenance: "provider_stated",
      effective_from: null,
      effective_to: null,
      evidence_ids: [id("evd", 80)],
      is_standard_comparable: version === 1,
      observed_at: observedAt,
      offering_id: offeringId,
      price_class: version === 1 ? "standard" : "promotional",
      price_id: priceId,
      role: "input",
      unit: "per_million_tokens",
    }),
    spec("precision_observation", precisionId, {
      applicability: {
        component_scope: null,
        endpoint_class: "serverless",
        material_region_key: "",
        provider_id: id("prv", 1),
        provider_model_id: "context-only",
        tier_key: "standard",
      },
      components: [],
      evidence_ids: [id("evd", 81)],
      format_variant: unknown(),
      normalized_format: known(version === 1 ? "BF16" : "FP8", 82),
      observed_at: observedAt,
      offering_id: offeringId,
      precision_id: precisionId,
      provider_definition: known(`Context ${String(version)}`, 83),
      raw_field_name: "precision",
      raw_precision: known(version === 1 ? "bf16" : "fp8", 84),
      summary_format: known(version === 1 ? "BF16" : "FP8", 85),
    }),
  ];
}

function resourceKey(resource: { resourceType: string; resourceId: string }) {
  return `${resource.resourceType}:${resource.resourceId}`;
}

function compareAscii(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

type FixtureOptions = Readonly<{
  offerings?: readonly ResourceSpec[];
  targets?: readonly ResourceSpec[];
  unrelatedTargets?: readonly ResourceSpec[];
  contextVersion?: 1 | 2;
  attributionProviderId?: string;
  enabledProviderIds?: readonly string[];
}>;

type Fixture = ProviderModelIdSearchProjectionInput &
  Readonly<{
    allRows: readonly ServingResourceClosureRow[];
    unrelatedRows: readonly ServingResourceClosureRow[];
  }>;

function exactInput(input: Fixture): ProviderModelIdSearchProjectionInput {
  return { manifest: input.manifest, resources: input.resources };
}

async function makeFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const targets = options.targets ?? [
    spec("model", id("mdl", 1), model(1)),
    spec("variant", id("var", 1), variant(1)),
  ];
  const offerings = options.offerings ?? [
    spec("offering", id("off", 2), offering(2, id("mdl", 1), "ACME/Model-One")),
    spec("offering", id("off", 1), offering(1, id("var", 1), "acme model_one")),
  ];
  const unrelatedTargets = options.unrelatedTargets ?? [
    spec("model", id("mdl", 9), model(9)),
  ];
  const context =
    options.contextVersion === undefined || offerings.length === 0
      ? []
      : contextResources(options.contextVersion, offerings[0]!.resourceId);
  const source = [...targets, ...offerings, ...unrelatedTargets, ...context];
  const persistedResources: PersistedResourceDescriptor[] = [];
  for (const resource of source) {
    const resourceJson = canonicalizePublicationJson(
      canonicalJson(resource.value),
      "object",
    );
    persistedResources.push({
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      resourceJson,
      contentHash: await hashPublicationResourceContent({
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        resourceJson,
      }),
    });
  }
  const searchable = persistedResources.filter(
    (
      resource,
    ): resource is PersistedResourceDescriptor & {
      resourceType: SearchResourceType;
    } =>
      resource.resourceType === "model" || resource.resourceType === "variant",
  );
  const searchDocuments = [];
  for (const resource of searchable) {
    const documentId = await derivePublicationVectorId(
      publicationId as `pub_${string}`,
      resource.resourceType,
      resource.resourceId,
    );
    const document = {
      aliasesJson: "[]",
      documentId,
      documentText: "broad search fixture",
      normalizedName: "untrusted-legacy-name",
      providerModelIdsJson: "[]",
      publisherName: "Synthetic Publisher",
      resourceId: resource.resourceId,
      resourceType: resource.resourceType,
    };
    searchDocuments.push({
      ...document,
      contentHash: await hashPublicationSearchDocumentContent(document),
    });
  }
  const vectors = searchDocuments.map((document) => ({
    embeddingInputHash: `sha256:${"e".repeat(64)}` as const,
    resourceId: document.resourceId,
    resourceType: document.resourceType,
    searchDocumentContentHash: document.contentHash,
    vectorId: document.documentId,
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
  const chunks = [
    {
      contentHash: await hashPublicationResourceChunk(sortedResources),
      firstKey: resourceKey(sortedResources[0]!),
      itemCount: sortedResources.length,
      kind: "resources" as const,
      lastKey: resourceKey(sortedResources.at(-1)!),
      ordinal: 0,
    },
    {
      contentHash: await hashPublicationSearchChunk(sortedDocuments),
      firstKey: resourceKey(sortedDocuments[0]!),
      itemCount: sortedDocuments.length,
      kind: "exact_search" as const,
      lastKey: resourceKey(sortedDocuments.at(-1)!),
      ordinal: 0,
    },
    {
      contentHash: await hashPublicationVectorChunk(
        publicationId as `pub_${string}`,
        sortedVectors,
      ),
      firstKey: resourceKey(sortedVectors[0]!),
      itemCount: sortedVectors.length,
      kind: "vectors" as const,
      lastKey: resourceKey(sortedVectors.at(-1)!),
      ordinal: 0,
    },
  ];
  const enabledProviderIds = options.enabledProviderIds ?? [id("prv", 1)];
  const providerAttributions = [
    ...offerings.map((resource) => ({
      providerId:
        options.attributionProviderId ?? String(resource.value.provider_id),
      resourceId: resource.resourceId,
      resourceType: "offering" as const,
    })),
    ...context.map((resource) => ({
      providerId: id("prv", 1),
      resourceId: resource.resourceId,
      resourceType: resource.resourceType as
        "provider" | "price" | "precision_observation",
    })),
  ];
  const manifest = await buildImmutableManifestFromPersistedContent({
    bundleHash: `sha256:${"b".repeat(64)}`,
    chunks,
    contractVersion: "1.0.0",
    enabledProviderIds,
    enabledProviderScopeVersion: "provider-scope@1",
    generatedAt: observedAt,
    parentPublicationId: null,
    providerAttributions,
    providerSlices: enabledProviderIds.map((providerId, index) => ({
      adapterVersion: "adapter@1",
      carriedForward: false,
      freshnessState: "fresh" as const,
      providerId,
      providerRunId: id("pvr", index + 1),
      providerSliceId: id("prn", index + 1),
      rosterVersion: "roster@1",
      sourceRegisterVersion: "sources@1",
    })),
    publicationId: publicationId as `pub_${string}`,
    resources: persistedResources,
    searchDocuments,
    sourceRunId: id("run", 1),
    vectors,
    versions: {
      buildCommit: "test-commit",
      embedding: "embedding@1",
      methodology: "1.0.0",
      precisionDisplayOrder: "1.0.0",
      precisionNormalization: "1.0.0",
      pricePolicy: "1.0.0",
      schema: "1.6.0",
      sourcePolicy: "1.0.0",
    },
  });
  const allRows = sortedResources.map(
    (resource): ServingResourceClosureRow => ({
      content_hash: resource.contentHash,
      resource_id: resource.resourceId,
      resource_json: resource.resourceJson,
      resource_type: resource.resourceType,
    }),
  );
  const referencedIds = new Set(
    offerings.map((resource) => String(resource.value.model_resource_id)),
  );
  const resources = allRows.filter(
    (resource) =>
      resource.resource_type === "offering" ||
      ((resource.resource_type === "model" ||
        resource.resource_type === "variant") &&
        referencedIds.has(resource.resource_id)),
  );
  return {
    allRows,
    manifest,
    resources,
    unrelatedRows: allRows.filter(
      (resource) =>
        (resource.resource_type === "model" ||
          resource.resource_type === "variant") &&
        !referencedIds.has(resource.resource_id),
    ),
  };
}

function uint64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function independentTuple(
  domain: string,
  fields: readonly Readonly<{ name: string; type: string; value: string }>[],
): Buffer {
  return Buffer.concat(
    [
      { name: "hash_domain", type: "text", value: domain },
      { name: "encoding_version", type: "integer", value: "1" },
      ...fields,
    ].flatMap((field) =>
      [field.name, field.type, field.value].flatMap((value) => {
        const bytes = Buffer.from(value, "utf8");
        return [uint64(bytes.length), bytes];
      }),
    ),
  );
}

function independentInventoryHash(
  documents: readonly ProviderModelIdSearchDocumentProjection[],
) {
  const root = independentTuple(
    "publication-provider-model-id-search-inventory",
    [
      {
        name: "provider_model_id_search_documents",
        type: "list",
        value: String(documents.length),
      },
    ],
  );
  const rows = documents.map((document) =>
    independentTuple("publication-provider-model-id-search-document", [
      {
        name: "projection_version",
        type: "text",
        value: document.projectionVersion,
      },
      { name: "offering_id", type: "identifier", value: document.offeringId },
      { name: "provider_id", type: "identifier", value: document.providerId },
      {
        name: "target_resource_type",
        type: "text",
        value: document.resourceType,
      },
      {
        name: "target_resource_id",
        type: "identifier",
        value: document.resourceId,
      },
      {
        name: "raw_provider_model_id",
        type: "text",
        value: document.rawProviderModelId,
      },
      {
        name: "normalized_provider_model_id",
        type: "text",
        value: document.normalizedProviderModelId,
      },
      {
        name: "offering_content_hash",
        type: "digest",
        value: document.offeringContentHash,
      },
      {
        name: "target_content_hash",
        type: "digest",
        value: document.targetContentHash,
      },
    ]),
  );
  const encoded = Buffer.concat([
    root,
    ...rows.map((row) => Buffer.concat([uint64(row.length), row])),
  ]);
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`;
}

function independentTupleByteLength(
  domain: string,
  fields: readonly Readonly<{ name: string; type: string; value: string }>[],
): number {
  return [
    { name: "hash_domain", type: "text", value: domain },
    { name: "encoding_version", type: "integer", value: "1" },
    ...fields,
  ].reduce(
    (total, field) =>
      total +
      [field.name, field.type, field.value].reduce(
        (fieldTotal, component) =>
          fieldTotal + 8 + Buffer.byteLength(component, "utf8"),
        0,
      ),
    0,
  );
}

function independentInventoryByteLength(
  documents: readonly ProviderModelIdSearchDocumentProjection[],
): number {
  return (
    independentInventoryRootByteLength(documents.length) +
    documents.reduce(
      (total, document) =>
        total + independentInventoryDocumentByteLength(document),
      0,
    )
  );
}

function independentInventoryRootByteLength(documentCount: number): number {
  return independentTupleByteLength(
    "publication-provider-model-id-search-inventory",
    [
      {
        name: "provider_model_id_search_documents",
        type: "list",
        value: String(documentCount),
      },
    ],
  );
}

function independentInventoryDocumentByteLength(
  document: ProviderModelIdSearchDocumentProjection,
): number {
  return (
    8 +
    independentTupleByteLength(
      "publication-provider-model-id-search-document",
      [
        {
          name: "projection_version",
          type: "text",
          value: document.projectionVersion,
        },
        {
          name: "offering_id",
          type: "identifier",
          value: document.offeringId,
        },
        {
          name: "provider_id",
          type: "identifier",
          value: document.providerId,
        },
        {
          name: "target_resource_type",
          type: "text",
          value: document.resourceType,
        },
        {
          name: "target_resource_id",
          type: "identifier",
          value: document.resourceId,
        },
        {
          name: "raw_provider_model_id",
          type: "text",
          value: document.rawProviderModelId,
        },
        {
          name: "normalized_provider_model_id",
          type: "text",
          value: document.normalizedProviderModelId,
        },
        {
          name: "offering_content_hash",
          type: "digest",
          value: document.offeringContentHash,
        },
        {
          name: "target_content_hash",
          type: "digest",
          value: document.targetContentHash,
        },
      ],
    )
  );
}

function inventoryBudgetDocument(
  sequence: number,
  rawBytes: number,
  normalizedBytes: number,
): ProviderModelIdSearchDocumentProjection {
  return {
    normalizedProviderModelId: utf8StringOfByteLength(normalizedBytes),
    offeringContentHash: `sha256:${"a".repeat(64)}`,
    offeringId: id("off", sequence),
    projectionVersion: PROVIDER_MODEL_ID_SEARCH_PROJECTION_VERSION,
    providerId: id("prv", 1),
    rawProviderModelId: utf8StringOfByteLength(rawBytes),
    resourceId: id("mdl", 1),
    resourceType: "model",
    targetContentHash: `sha256:${"b".repeat(64)}`,
  };
}

function utf8StringOfByteLength(bytes: number): string {
  const astralCount = Math.floor(bytes / 4);
  const remainder = bytes % 4;
  return `${"😀".repeat(astralCount)}${remainder === 0 ? "" : remainder === 1 ? "a" : remainder === 2 ? "¢" : "€"}`;
}

describe("trusted provider-model-ID projection", () => {
  it("derives one frozen row per Offering, sorts by Offering ID, normalizes, preserves NUL, and retains collisions/status/staleness", async () => {
    const offerings = [
      spec(
        "offering",
        id("off", 3),
        offering(3, id("mdl", 1), "ACME/Model-One", {
          stale: true,
          stale_reason: "missed refresh",
          status: known("inactive", 90),
        }),
      ),
      spec(
        "offering",
        id("off", 1),
        offering(1, id("var", 1), "acme model_one"),
      ),
      spec(
        "offering",
        id("off", 2),
        offering(2, id("mdl", 1), "ACME/Model\u0000One"),
      ),
    ];
    const input = await makeFixture({ offerings });
    const projection = await projectProviderModelIdSearchProjection(
      exactInput(input),
    );

    expect(() => {
      assertProviderModelIdSearchProjection(projection);
    }).not.toThrow();
    expect(projection.projectionVersion).toBe(
      PROVIDER_MODEL_ID_SEARCH_PROJECTION_VERSION,
    );
    expect(projection.documents.map((row) => row.offeringId)).toEqual([
      id("off", 1),
      id("off", 2),
      id("off", 3),
    ]);
    expect(projection.documents.map((row) => row.resourceType)).toEqual([
      "variant",
      "model",
      "model",
    ]);
    expect(projection.documents[0]?.normalizedProviderModelId).toBe(
      normalizeExactSearchName("acme model_one"),
    );
    expect(projection.documents[0]?.normalizedProviderModelId).toBe(
      projection.documents[2]?.normalizedProviderModelId,
    );
    expect(projection.documents[1]?.rawProviderModelId).toContain("\u0000");
    expect(projection.documents[1]?.normalizedProviderModelId).toContain(
      "\u0000",
    );
    expect(projection.inventoryHash).toBe(
      independentInventoryHash(projection.documents),
    );
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.documents)).toBe(true);
    expect(projection.documents.every(Object.isFrozen)).toBe(true);
    expect(Object.keys(projection.documents[0] ?? {})).toEqual([
      "projectionVersion",
      "offeringId",
      "providerId",
      "resourceType",
      "resourceId",
      "rawProviderModelId",
      "normalizedProviderModelId",
      "offeringContentHash",
      "targetContentHash",
    ]);
  });

  it("does not filter known or unknown lifecycle states or stale and non-stale Offerings", async () => {
    const lifecycleOfferings = [
      spec(
        "offering",
        id("off", 1),
        offering(1, id("mdl", 1), "lifecycle/active", {
          stale: false,
          status: known("active", 121),
        }),
      ),
      spec(
        "offering",
        id("off", 2),
        offering(2, id("mdl", 1), "lifecycle/inactive", {
          stale: true,
          stale_reason: "inactive upstream",
          status: known("inactive", 122),
        }),
      ),
      spec(
        "offering",
        id("off", 3),
        offering(3, id("mdl", 1), "lifecycle/unavailable", {
          stale: false,
          status: known("unavailable", 123),
        }),
      ),
      spec(
        "offering",
        id("off", 4),
        offering(4, id("mdl", 1), "lifecycle/unknown", {
          stale: true,
          stale_reason: "status not established",
          status: unknown(),
        }),
      ),
    ];
    const input = await makeFixture({
      offerings: lifecycleOfferings,
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    const projection = await projectProviderModelIdSearchProjection(
      exactInput(input),
    );

    expect(projection.documentCount).toBe(lifecycleOfferings.length);
    expect(projection.documents.map((row) => row.offeringId)).toEqual(
      lifecycleOfferings.map((row) => row.resourceId),
    );
  });

  it("retains exact raw and normalized duplicates across enabled attributed providers", async () => {
    const rawProviderModelId = "shared/provider-model-id";
    const input = await makeFixture({
      enabledProviderIds: [id("prv", 1), id("prv", 2)],
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("mdl", 1), rawProviderModelId),
        ),
        spec(
          "offering",
          id("off", 2),
          offering(2, id("mdl", 1), rawProviderModelId, {
            provider_id: id("prv", 2),
          }),
        ),
      ],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    const projection = await projectProviderModelIdSearchProjection(
      exactInput(input),
    );

    expect(projection.documents.map((row) => row.providerId)).toEqual([
      id("prv", 1),
      id("prv", 2),
    ]);
    expect(projection.documents.map((row) => row.rawProviderModelId)).toEqual([
      rawProviderModelId,
      rawProviderModelId,
    ]);
    expect(
      projection.documents.map((row) => row.normalizedProviderModelId),
    ).toEqual([
      normalizeExactSearchName(rawProviderModelId),
      normalizeExactSearchName(rawProviderModelId),
    ]);
  });

  it("uses the exact Offering plus distinct referenced-target subset and permits an empty derivation", async () => {
    const input = await makeFixture();
    expect(input.unrelatedRows.length).toBeGreaterThan(0);
    await expect(
      projectProviderModelIdSearchProjection(exactInput(input)),
    ).resolves.toMatchObject({ documentCount: 2 });
    await expect(
      projectProviderModelIdSearchProjection({
        manifest: input.manifest,
        resources: [...input.resources, input.unrelatedRows[0]!],
      }),
    ).rejects.toThrow(/exactly match/u);

    const empty = await makeFixture({ offerings: [], targets: [] });
    await expect(
      projectProviderModelIdSearchProjection({
        manifest: empty.manifest,
        resources: [],
      }),
    ).resolves.toMatchObject({ documentCount: 0, documents: [] });
  });

  it("rejects missing, extra, duplicate, substituted, and hash-mismatched resources", async () => {
    const input = await makeFixture();
    for (let index = 0; index < input.resources.length; index += 1) {
      await expect(
        projectProviderModelIdSearchProjection({
          manifest: input.manifest,
          resources: input.resources.filter(
            (_, candidate) => candidate !== index,
          ),
        }),
      ).rejects.toThrow(/exactly match|target is missing/u);
    }
    await expect(
      projectProviderModelIdSearchProjection({
        manifest: input.manifest,
        resources: [...input.resources, input.resources[0]!],
      }),
    ).rejects.toThrow(/duplicate/u);
    const second = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 2),
          offering(2, id("mdl", 1), "different-value"),
        ),
        spec(
          "offering",
          id("off", 1),
          offering(1, id("var", 1), "acme model_one"),
        ),
      ],
    });
    const substituted = input.resources.map((row) =>
      row.resource_id === id("off", 2)
        ? second.resources.find(
            (candidate) => candidate.resource_id === row.resource_id,
          )!
        : row,
    );
    await expect(
      projectProviderModelIdSearchProjection({
        manifest: input.manifest,
        resources: substituted,
      }),
    ).rejects.toThrow(/trusted manifest/u);
    const tampered = input.resources.map((row, index) =>
      index === 0
        ? {
            ...row,
            resource_json: row.resource_json.replace("active", "deleted"),
          }
        : row,
    );
    await expect(
      projectProviderModelIdSearchProjection({
        manifest: input.manifest,
        resources: tampered,
      }),
    ).rejects.toThrow(/content hash|contract-valid|must be canonical/u);
  });

  it("rejects attribution/provider disagreement, invalid Offering/target contracts, identity mismatch, and absent targets", async () => {
    const wrongProvider = await makeFixture({
      attributionProviderId: id("prv", 1),
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("mdl", 1), "provider/model", {
            provider_id: id("prv", 2),
          }),
        ),
      ],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    await expect(
      projectProviderModelIdSearchProjection(exactInput(wrongProvider)),
    ).rejects.toThrow(/attribution/u);

    const invalidOffering = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("mdl", 1), "provider/model", {
            evidence_ids: [],
          }),
        ),
      ],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    await expect(
      projectProviderModelIdSearchProjection(exactInput(invalidOffering)),
    ).rejects.toThrow(/contract-valid/u);

    const invalidTarget = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("mdl", 1), "provider/model"),
        ),
      ],
      targets: [
        spec("model", id("mdl", 1), model(1, { status: "not-a-fact" })),
      ],
    });
    await expect(
      projectProviderModelIdSearchProjection(exactInput(invalidTarget)),
    ).rejects.toThrow(/contract-valid/u);

    const wrongIdentity = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(2, id("mdl", 1), "provider/model"),
        ),
      ],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    await expect(
      projectProviderModelIdSearchProjection(exactInput(wrongIdentity)),
    ).rejects.toThrow(/identity/u);

    const absentTarget = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("mdl", 8), "provider/model"),
        ),
      ],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    await expect(
      projectProviderModelIdSearchProjection(exactInput(absentTarget)),
    ).rejects.toThrow(/trusted manifest/u);
  });

  it("preserves full JSON Schema Unicode-scalar boundaries and rejects malformed provider IDs before hashing", async () => {
    const astral = "😀".repeat(256);
    const value = offering(1, id("mdl", 1), astral, {
      display_name: known(astral, 101),
      endpoint_class: "😀".repeat(128),
      material_region_key: "😀".repeat(128),
      stale_reason: "😀".repeat(200),
      supported_regions: known(["😀".repeat(128)], 102),
      tier_key: "😀".repeat(128),
    });
    const before = canonicalJson(value);
    expect(checkOfferingContract(value)).toBe(true);
    expect(canonicalJson(value)).toBe(before);
    expect(Buffer.byteLength(astral)).toBe(
      PROVIDER_MODEL_ID_SEARCH_MAX_UTF8_BYTES,
    );
    const boundary = await makeFixture({
      offerings: [spec("offering", id("off", 1), value)],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    await expect(
      projectProviderModelIdSearchProjection(exactInput(boundary)),
    ).resolves.toMatchObject({
      documents: [{ rawProviderModelId: astral }],
    });
    expect(
      checkOfferingContract({ ...value, provider_model_id: `${astral}😀` }),
    ).toBe(false);
    expect(
      checkOfferingContract({ ...value, display_name: known(`${astral}😀`) }),
    ).toBe(false);

    const malformed = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("mdl", 1), "bad\ud800id"),
        ),
      ],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    await expect(
      projectProviderModelIdSearchProjection(exactInput(malformed)),
    ).rejects.toThrow(/contract-valid|invalid provider model ID/u);
  });

  it("rejects unpaired surrogates in every nested bounded Offering string", async () => {
    const malformed = "bad\ud800value";
    const cases: readonly Readonly<{
      label: string;
      override: Record<string, unknown>;
    }>[] = [
      { label: "display name", override: { display_name: known(malformed) } },
      { label: "tier key", override: { tier_key: malformed } },
      { label: "endpoint class", override: { endpoint_class: malformed } },
      {
        label: "material region key",
        override: { material_region_key: malformed },
      },
      {
        label: "supported region",
        override: { supported_regions: known([malformed]) },
      },
      { label: "status value", override: { status: known(malformed) } },
      { label: "stale reason", override: { stale_reason: malformed } },
      {
        label: "source locator",
        override: { source_locator: known(malformed) },
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const value = offering(
        index + 1,
        id("mdl", 1),
        `valid/provider-id-${String(index + 1)}`,
        testCase.override,
      );
      expect(checkOfferingContract(value), testCase.label).toBe(false);
      const input = await makeFixture({
        offerings: [spec("offering", id("off", index + 1), value)],
        targets: [spec("model", id("mdl", 1), model(1))],
      });
      await expect(
        projectProviderModelIdSearchProjection(exactInput(input)),
        testCase.label,
      ).rejects.toThrow(/contract-valid/u);
    }
  });

  it("snapshots hostile caller input without invoking accessors and rejects copied trust", async () => {
    const input = await makeFixture();
    let outerReads = 0;
    const hostileOuter = {
      get manifest() {
        outerReads += 1;
        return input.manifest;
      },
      resources: input.resources,
    };
    await expect(
      projectProviderModelIdSearchProjection(
        hostileOuter as unknown as ProviderModelIdSearchProjectionInput,
      ),
    ).rejects.toThrow(/input is invalid/u);
    expect(outerReads).toBe(0);

    let rowReads = 0;
    const first = input.resources[0]!;
    const hostileRow = {
      content_hash: first.content_hash,
      resource_id: first.resource_id,
      get resource_json() {
        rowReads += 1;
        return first.resource_json;
      },
      resource_type: first.resource_type,
    };
    await expect(
      projectProviderModelIdSearchProjection({
        manifest: input.manifest,
        resources: [hostileRow, ...input.resources.slice(1)],
      }),
    ).rejects.toThrow(/resource input is invalid/u);
    expect(rowReads).toBe(0);

    let lengthReads = 0;
    const changingLength = new Proxy([...input.resources], {
      get(target, property, receiver) {
        if (property === "length") lengthReads += 1;
        const result: unknown = Reflect.get(target, property, receiver);
        return result;
      },
    });
    await expect(
      projectProviderModelIdSearchProjection({
        manifest: input.manifest,
        resources: changingLength,
      }),
    ).resolves.toMatchObject({ documentCount: 2 });
    expect(lengthReads).toBe(0);

    const pending = projectProviderModelIdSearchProjection(exactInput(input));
    (input.resources as ServingResourceClosureRow[])[0] = {
      ...input.resources[0]!,
      resource_json: "{}",
    };
    const projection = await pending;
    expect(projection.documentCount).toBe(2);
    expect(() => {
      assertProviderModelIdSearchProjection({ ...projection });
    }).toThrow(/not trusted/u);
    await expect(
      projectProviderModelIdSearchProjection({
        manifest: { ...input.manifest },
        resources: input.resources,
      }),
    ).rejects.toThrow(/not trusted/u);

    let brandHasCalls = 0;
    let brandGetCalls = 0;
    const forged = new Proxy(
      {},
      {
        get() {
          brandGetCalls += 1;
          throw new Error("brand get trap must not run");
        },
        has() {
          brandHasCalls += 1;
          throw new Error("brand has trap must not run");
        },
      },
    );
    expect(() => {
      assertImmutablePublicationManifest(forged);
    }).toThrow(/not trusted/u);
    expect(() => {
      assertProviderModelIdSearchProjection(forged);
    }).toThrow(/not trusted/u);
    expect({ brandGetCalls, brandHasCalls }).toEqual({
      brandGetCalls: 0,
      brandHasCalls: 0,
    });
  });

  it("is permutation invariant and keeps unrelated provider/price/precision facts out of row identity", async () => {
    const first = await makeFixture({ contextVersion: 1 });
    const second = await makeFixture({ contextVersion: 2 });
    const left = await projectProviderModelIdSearchProjection(
      exactInput(first),
    );
    const right = await projectProviderModelIdSearchProjection(
      exactInput(second),
    );
    expect(right.documents).toEqual(left.documents);
    expect(right.inventoryHash).toBe(left.inventoryHash);
    expect(right.closureHash).not.toBe(left.closureHash);

    const permuted = await projectProviderModelIdSearchProjection({
      manifest: first.manifest,
      resources: [...first.resources].reverse(),
    });
    expect(permuted.documents).toEqual(left.documents);
    expect(permuted.inventoryHash).toBe(left.inventoryHash);

    const changedOffering = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 2),
          offering(2, id("mdl", 1), "ACME/Model-One", {
            display_name: known("Changed unrelated Offering display", 110),
          }),
        ),
        spec(
          "offering",
          id("off", 1),
          offering(1, id("var", 1), "acme model_one"),
        ),
      ],
    });
    const changed = await projectProviderModelIdSearchProjection(
      exactInput(changedOffering),
    );
    const identityWithoutOfferingHash = (
      document: ProviderModelIdSearchDocumentProjection,
    ) => ({
      normalizedProviderModelId: document.normalizedProviderModelId,
      offeringId: document.offeringId,
      projectionVersion: document.projectionVersion,
      providerId: document.providerId,
      rawProviderModelId: document.rawProviderModelId,
      resourceId: document.resourceId,
      resourceType: document.resourceType,
      targetContentHash: document.targetContentHash,
    });
    expect(changed.documents.map(identityWithoutOfferingHash)).toEqual(
      left.documents.map(identityWithoutOfferingHash),
    );
    expect(changed.documents[1]?.offeringContentHash).not.toBe(
      left.documents[1]?.offeringContentHash,
    );
    expect(changed.inventoryHash).not.toBe(left.inventoryHash);
  });

  it("preserves an empty normalized ID while the public exact-name normalizer remains strict", async () => {
    const rawProviderModelId = "/_-—";
    expect(() => normalizeExactSearchName(rawProviderModelId)).toThrow(
      /empty/u,
    );
    const input = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("mdl", 1), rawProviderModelId),
        ),
      ],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    await expect(
      projectProviderModelIdSearchProjection(exactInput(input)),
    ).resolves.toMatchObject({
      documents: [
        {
          normalizedProviderModelId: "",
          rawProviderModelId,
        },
      ],
    });
  });

  it("rejects an oversized serialized resource before JSON parsing", async () => {
    const input = await makeFixture();
    const oversized = [
      {
        ...input.resources[0]!,
        resource_json: " ".repeat(
          PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCE_BYTES + 1,
        ),
      },
      ...input.resources.slice(1),
    ];
    await expect(
      projectProviderModelIdSearchProjection({
        manifest: input.manifest,
        resources: oversized,
      }),
    ).rejects.toThrow(/too large/u);
  });

  it("rejects cumulative high-expansion provider IDs before retaining or hashing an over-budget inventory", async () => {
    const rawProviderModelId = "\uFDFA".repeat(200);
    const normalizedProviderModelId =
      normalizeExactSearchName(rawProviderModelId);
    const retainedBytesPerOffering =
      Buffer.byteLength(rawProviderModelId, "utf8") +
      Buffer.byteLength(normalizedProviderModelId, "utf8");
    const offeringCount =
      Math.floor(
        PROVIDER_MODEL_ID_SEARCH_MAX_INVENTORY_BYTES / retainedBytesPerOffering,
      ) + 1;
    expect(Buffer.byteLength(rawProviderModelId, "utf8")).toBeLessThanOrEqual(
      PROVIDER_MODEL_ID_SEARCH_MAX_UTF8_BYTES,
    );
    expect(
      Buffer.byteLength(normalizedProviderModelId, "utf8"),
    ).toBeLessThanOrEqual(PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES);
    expect(offeringCount + 1).toBeLessThanOrEqual(
      PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCES,
    );
    expect(retainedBytesPerOffering * offeringCount).toBeGreaterThan(
      PROVIDER_MODEL_ID_SEARCH_MAX_INVENTORY_BYTES,
    );

    const input = await makeFixture({
      offerings: Array.from({ length: offeringCount }, (_, index) =>
        spec(
          "offering",
          id("off", index + 1),
          offering(index + 1, id("mdl", 1), rawProviderModelId),
        ),
      ),
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    expect(
      input.resources.reduce(
        (total, row) => total + Buffer.byteLength(row.resource_json, "utf8"),
        0,
      ),
    ).toBeLessThanOrEqual(PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_RESOURCE_BYTES);

    await expect(
      projectProviderModelIdSearchProjection(exactInput(input)),
    ).rejects.toThrow(/inventory is too large/u);
  });

  it("pins literal inventory digests for empty, model, variant, mixed, duplicate/NUL, and permutation cases", async () => {
    const empty = await makeFixture({ offerings: [], targets: [] });
    const modelOnly = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("mdl", 1), "provider/model"),
        ),
      ],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    const variantOnly = await makeFixture({
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("var", 1), "provider/variant"),
        ),
      ],
      targets: [spec("variant", id("var", 1), variant(1))],
    });
    const mixed = await makeFixture();
    const duplicateNul = await makeFixture({
      enabledProviderIds: [id("prv", 1), id("prv", 2)],
      offerings: [
        spec(
          "offering",
          id("off", 1),
          offering(1, id("mdl", 1), "duplicate/raw"),
        ),
        spec(
          "offering",
          id("off", 2),
          offering(2, id("mdl", 1), "duplicate/raw", {
            provider_id: id("prv", 2),
          }),
        ),
        spec("offering", id("off", 3), offering(3, id("mdl", 1), "\u0000edge")),
        spec(
          "offering",
          id("off", 4),
          offering(4, id("mdl", 1), "edge\u0000case"),
        ),
        spec("offering", id("off", 5), offering(5, id("mdl", 1), "edge\u0000")),
      ],
      targets: [spec("model", id("mdl", 1), model(1))],
    });
    const projections = {
      empty: await projectProviderModelIdSearchProjection(exactInput(empty)),
      mixed: await projectProviderModelIdSearchProjection(exactInput(mixed)),
      model: await projectProviderModelIdSearchProjection(
        exactInput(modelOnly),
      ),
      duplicateNul: await projectProviderModelIdSearchProjection(
        exactInput(duplicateNul),
      ),
      permutation: await projectProviderModelIdSearchProjection({
        manifest: mixed.manifest,
        resources: [...mixed.resources].reverse(),
      }),
      variant: await projectProviderModelIdSearchProjection(
        exactInput(variantOnly),
      ),
    };
    expect(
      Object.fromEntries(
        Object.entries(projections).map(([name, projection]) => [
          name,
          projection.inventoryHash,
        ]),
      ),
    ).toEqual({
      empty:
        "sha256:bc21facd75d1eeca188409fe26f45da33d4d87182cefffa8d03baec43669a3bc",
      mixed:
        "sha256:6e7928ba78086c4b65a577db74e49df2810c2eeadb1ef2f52eddc349a5a9a9fa",
      model:
        "sha256:e3687167d9941041d549fd77e791f5e410ef20d6e3422e8648e20233362ffef0",
      duplicateNul:
        "sha256:01f992dddd50a921b64cc3d825fb9303ee782693464c2cb2d0d30dfe7eb26303",
      permutation:
        "sha256:6e7928ba78086c4b65a577db74e49df2810c2eeadb1ef2f52eddc349a5a9a9fa",
      variant:
        "sha256:5848e79f44b1558e53242fd3c61e34af561a409daa52840676cdf08346974e5b",
    });
    expect(
      projections.duplicateNul.documents.map(
        (document) => document.rawProviderModelId,
      ),
    ).toEqual([
      "duplicate/raw",
      "duplicate/raw",
      "\u0000edge",
      "edge\u0000case",
      "edge\u0000",
    ]);
    for (const projection of Object.values(projections))
      expect(projection.inventoryHash).toBe(
        independentInventoryHash(projection.documents),
      );
  });

  it("enforces the exact encoded-inventory byte ceiling", () => {
    let exact: ProviderModelIdSearchDocumentProjection[] | null = null;
    const fullDocument = inventoryBudgetDocument(
      1,
      PROVIDER_MODEL_ID_SEARCH_MAX_UTF8_BYTES,
      PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
    );
    const minimumDocument = inventoryBudgetDocument(1, 1, 0);
    const fullDocumentBytes =
      independentInventoryDocumentByteLength(fullDocument);
    const minimumDocumentBytes =
      independentInventoryDocumentByteLength(minimumDocument);
    for (
      let count = 1;
      count <= PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCES;
      count += 1
    ) {
      const minimumBytes =
        independentInventoryRootByteLength(count) +
        (count - 1) * fullDocumentBytes +
        minimumDocumentBytes;
      const variableCapacity =
        PROVIDER_MODEL_ID_SEARCH_MAX_UTF8_BYTES -
        1 +
        PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES;
      const remaining =
        PROVIDER_MODEL_ID_SEARCH_MAX_INVENTORY_BYTES - minimumBytes;
      if (remaining < 0 || remaining > variableCapacity) continue;
      const normalizedBytes = Math.min(
        remaining,
        PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
      );
      const rawBytes = 1 + remaining - normalizedBytes;
      const prefix = Array.from({ length: count - 1 }, (_, index) =>
        inventoryBudgetDocument(
          index + 1,
          PROVIDER_MODEL_ID_SEARCH_MAX_UTF8_BYTES,
          PROVIDER_MODEL_ID_SEARCH_MAX_NORMALIZED_UTF8_BYTES,
        ),
      );
      exact = [
        ...prefix,
        inventoryBudgetDocument(count, rawBytes, normalizedBytes),
      ];
      break;
    }
    expect(exact).not.toBeNull();
    if (exact === null)
      throw new Error("exact inventory fixture was not found");
    expect(independentInventoryByteLength(exact)).toBe(
      PROVIDER_MODEL_ID_SEARCH_MAX_INVENTORY_BYTES,
    );
    expect(() => {
      assertProviderModelIdSearchInventoryByteBudget(exact);
    }).not.toThrow();
    const final = exact.at(-1)!;
    const finalRawBytes = Buffer.byteLength(final.rawProviderModelId, "utf8");
    const finalNormalizedBytes = Buffer.byteLength(
      final.normalizedProviderModelId,
      "utf8",
    );
    const over = [
      ...exact.slice(0, -1),
      {
        ...final,
        ...(finalRawBytes < PROVIDER_MODEL_ID_SEARCH_MAX_UTF8_BYTES
          ? {
              rawProviderModelId: utf8StringOfByteLength(finalRawBytes + 1),
            }
          : {
              normalizedProviderModelId: utf8StringOfByteLength(
                finalNormalizedBytes + 1,
              ),
            }),
      },
    ];
    expect(independentInventoryByteLength(over)).toBe(
      PROVIDER_MODEL_ID_SEARCH_MAX_INVENTORY_BYTES + 1,
    );
    expect(() => {
      assertProviderModelIdSearchInventoryByteBudget(over);
    }).toThrow(/inventory is too large/u);

    let lengthReads = 0;
    const hostileArray = new Proxy([...exact], {
      get(target, property, receiver) {
        if (property === "length") lengthReads += 1;
        const result: unknown = Reflect.get(target, property, receiver);
        return result;
      },
    });
    expect(() => {
      assertProviderModelIdSearchInventoryByteBudget(hostileArray);
    }).not.toThrow();
    expect(lengthReads).toBe(0);

    let accessorReads = 0;
    const accessorDocument = [minimumDocument];
    Object.defineProperty(accessorDocument, "0", {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        return minimumDocument;
      },
    });
    expect(() => {
      assertProviderModelIdSearchInventoryByteBudget(accessorDocument);
    }).toThrow(/invalid/u);
    expect(accessorReads).toBe(0);
  });

  it("enforces exact count, per-resource, and aggregate resource byte budgets", () => {
    expect(() => {
      assertProviderModelIdSearchResourceByteBudget(
        Array<number>(PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCES).fill(0),
      );
    }).not.toThrow();
    expect(() => {
      assertProviderModelIdSearchResourceByteBudget(
        Array<number>(PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCES + 1).fill(0),
      );
    }).toThrow(/too large/u);
    expect(() => {
      assertProviderModelIdSearchResourceByteBudget([
        PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCE_BYTES,
      ]);
    }).not.toThrow();
    expect(() => {
      assertProviderModelIdSearchResourceByteBudget([
        PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCE_BYTES + 1,
      ]);
    }).toThrow(/too large/u);
    const full = Math.floor(
      PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_RESOURCE_BYTES /
        PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCE_BYTES,
    );
    const remainder =
      PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_RESOURCE_BYTES -
      full * PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCE_BYTES;
    const exact = [
      ...Array<number>(full).fill(PROVIDER_MODEL_ID_SEARCH_MAX_RESOURCE_BYTES),
      ...(remainder === 0 ? [] : [remainder]),
    ];
    expect(() => {
      assertProviderModelIdSearchResourceByteBudget(exact);
    }).not.toThrow();
    expect(() => {
      assertProviderModelIdSearchResourceByteBudget([...exact, 1]);
    }).toThrow(/too large/u);
    for (const invalid of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => {
        assertProviderModelIdSearchResourceByteBudget([invalid]);
      }).toThrow(/invalid|too large/u);

    let accessorReads = 0;
    const accessorLength = [0];
    Object.defineProperty(accessorLength, "0", {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        return 0;
      },
    });
    expect(() => {
      assertProviderModelIdSearchResourceByteBudget(accessorLength);
    }).toThrow(/invalid/u);
    expect(accessorReads).toBe(0);
  });

  it("enforces exact retained provider-ID text budget arithmetic", () => {
    expect(
      advanceProviderModelIdSearchRetainedTextByteBudget(
        0,
        PROVIDER_MODEL_ID_SEARCH_MAX_INVENTORY_BYTES,
        0,
      ),
    ).toBe(PROVIDER_MODEL_ID_SEARCH_MAX_INVENTORY_BYTES);
    expect(() =>
      advanceProviderModelIdSearchRetainedTextByteBudget(
        PROVIDER_MODEL_ID_SEARCH_MAX_INVENTORY_BYTES,
        1,
        0,
      ),
    ).toThrow(/inventory is too large/u);

    for (const invalid of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        advanceProviderModelIdSearchRetainedTextByteBudget(invalid, 0, 0),
      ).toThrow(/invalid/u);
      expect(() =>
        advanceProviderModelIdSearchRetainedTextByteBudget(0, invalid, 0),
      ).toThrow(/invalid/u);
      expect(() =>
        advanceProviderModelIdSearchRetainedTextByteBudget(0, 0, invalid),
      ).toThrow(/invalid/u);
    }
  });

  it("keeps the large-input implementation sequential and array length descriptor-bound", () => {
    const source = readFileSync(new URL("index.ts", import.meta.url), "utf8");
    const implementation = source.slice(
      source.indexOf("export const projectProviderModelIdSearchProjection"),
      source.indexOf("/**\n * Runtime-neutral persistence rows for ADR 0026"),
    );
    expect(implementation).not.toContain("Promise.all");
    expect(source).toContain(
      'Object.getOwnPropertyDescriptor(value, "length")',
    );
    expect(implementation).toContain("for (const resource of resources)");
    const retainedBudgetCheck = implementation.indexOf(
      "advanceProviderModelIdSearchRetainedTextByteBudget(",
    );
    const retainedResource = implementation.indexOf("resources.push(");
    const firstContentHash = implementation.indexOf(
      "await hashPublicationResourceContent",
    );
    expect(retainedBudgetCheck).toBeGreaterThan(-1);
    expect(retainedBudgetCheck).toBeLessThan(retainedResource);
    expect(retainedBudgetCheck).toBeLessThan(firstContentHash);
  });
});
