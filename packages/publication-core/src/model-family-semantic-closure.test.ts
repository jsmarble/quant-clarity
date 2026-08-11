import { describe, expect, it } from "vitest";

import {
  assertImmutablePublicationManifest,
  assertModelFamilyClosureCapacity,
  assertOfferingClosureCapacity,
  buildImmutableManifestFromPersistedContent,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  MODEL_FAMILY_CLOSURE_MAX_MEMBERSHIP_EDGES,
  MODEL_FAMILY_CLOSURE_MAX_RELEVANT_RESOURCES,
  OFFERING_CLOSURE_MAX_REFERENCE_EDGES,
  OFFERING_CLOSURE_MAX_RELEVANT_RESOURCES,
  OFFERING_CLOSURE_MAX_TOTAL_RESOURCE_BYTES,
  type PersistedPublicationManifestInput,
  type PublicationId,
  type ResourceType,
  type Sha256,
} from "./index.js";

const publicationId =
  "pub_00000000-0000-4000-8000-000000000001" as PublicationId;
const providerId = "prv_00000000-0000-4000-8000-000000000001";
const observedAt = "2026-08-02T00:00:00.000Z";
const evidenceId = "evd_00000000-0000-4000-8000-000000000001";
const digest: Sha256 = `sha256:${"a".repeat(64)}`;

const id = (prefix: "fam" | "mdl" | "var", value: number): string =>
  `${prefix}_00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;

const graphId = (
  prefix: "off" | "pcs" | "prc" | "evd",
  value: number,
): string =>
  `${prefix}_00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;

const knownFact = <T>(value: T) => ({
  state: "known" as const,
  value,
  observed_at: observedAt,
  evidence_ids: [evidenceId],
});

const knownWithEvidence = <T>(value: T, evidence: string) => ({
  state: "known" as const,
  value,
  observed_at: observedAt,
  evidence_ids: [evidence],
});

const evidenceSummary = (evidence: string, subject: string) => ({
  evidence_id: evidence,
  subject_resource_id: subject,
  field: "test_fact",
  value: "Synthetic retained test evidence",
  source_type: "fixture",
  source_owner: "QuantClarity test suite",
  source_url: null,
  source_locator: "/redacted/test",
  authenticated_only: false,
  observed_at: observedAt,
  extraction_method: "deterministic_fixture",
  extraction_version: "fixture@1",
  integrity_hash: digest,
});

const offeringGraph = () => {
  const familyId = id("fam", 20);
  const modelId = id("mdl", 20);
  const offeringId = graphId("off", 20);
  const priceId = graphId("pcs", 20);
  const precisionId = graphId("prc", 20);
  const offeringEvidence = graphId("evd", 20);
  const priceEvidence = graphId("evd", 21);
  const precisionEvidence = graphId("evd", 22);
  return [
    {
      resourceType: "model_family" as const,
      resourceId: familyId,
      value: family(familyId, [modelId]),
    },
    {
      resourceType: "model" as const,
      resourceId: modelId,
      value: model(modelId, familyId),
    },
    {
      resourceType: "provider" as const,
      resourceId: providerId,
      value: {
        provider_id: providerId,
        slug: knownFact("synthetic-provider"),
        display_name: knownFact("Synthetic Provider"),
        official_site: knownFact("https://provider.example"),
        affiliate_relationship_present: false,
        status: knownFact("active"),
        active_offering_count: {
          value: 1,
          observed_at: observedAt,
          derivation_version: "provider-count@1",
        },
        precision_coverage: {
          known_count: 1,
          unknown_count: 0,
          known_proportion_decimal: "1",
          derivation_version: "precision-coverage@1",
        },
        last_successful_refresh: knownFact(observedAt),
      },
    },
    {
      resourceType: "offering" as const,
      resourceId: offeringId,
      value: {
        offering_id: offeringId,
        provider_id: providerId,
        model_resource_id: modelId,
        provider_model_id: "publisher/model",
        display_name: knownWithEvidence("Synthetic Offering", offeringEvidence),
        tier_key: "standard",
        endpoint_class: "serverless",
        material_region_key: "",
        supported_regions: knownWithEvidence(["global"], offeringEvidence),
        status: knownWithEvidence("active", offeringEvidence),
        stale: false,
        stale_reason: null,
        first_observed_at: observedAt,
        last_observed_at: observedAt,
        last_successful_refresh: knownWithEvidence(
          observedAt,
          offeringEvidence,
        ),
        source_locator: knownWithEvidence(
          "https://provider.example/catalog",
          offeringEvidence,
        ),
        precision_observation_ids: [precisionId],
        price_ids: [priceId],
        evidence_ids: [offeringEvidence],
      },
    },
    {
      resourceType: "price" as const,
      resourceId: priceId,
      value: {
        price_id: priceId,
        offering_id: offeringId,
        role: "input",
        price_class: "standard",
        amount_decimal: "1.25",
        currency: "USD",
        currency_provenance: "provider_stated",
        unit: "per_million_tokens",
        conditions: [],
        is_standard_comparable: true,
        effective_from: null,
        effective_to: null,
        observed_at: observedAt,
        evidence_ids: [priceEvidence],
      },
    },
    {
      resourceType: "precision_observation" as const,
      resourceId: precisionId,
      value: {
        precision_id: precisionId,
        offering_id: offeringId,
        normalized_format: knownWithEvidence("BF16", precisionEvidence),
        summary_format: knownWithEvidence("BF16", precisionEvidence),
        raw_field_name: "precision",
        raw_precision: knownWithEvidence("bf16", precisionEvidence),
        provider_definition: knownWithEvidence(
          "Provider-stated BF16",
          precisionEvidence,
        ),
        format_variant: unknownFact,
        components: [],
        applicability: {
          provider_id: providerId,
          provider_model_id: "publisher/model",
          tier_key: "standard",
          endpoint_class: "serverless",
          material_region_key: "",
          component_scope: null,
        },
        observed_at: observedAt,
        evidence_ids: [precisionEvidence],
      },
    },
    {
      resourceType: "evidence_summary" as const,
      resourceId: offeringEvidence,
      value: evidenceSummary(offeringEvidence, offeringId),
    },
    {
      resourceType: "evidence_summary" as const,
      resourceId: priceEvidence,
      value: evidenceSummary(priceEvidence, priceId),
    },
    {
      resourceType: "evidence_summary" as const,
      resourceId: precisionEvidence,
      value: evidenceSummary(precisionEvidence, precisionId),
    },
  ] satisfies readonly ResourceValue[];
};

describe("persisted Offering comparison relationship closure", () => {
  it("accepts a complete graph independent of input order", async () => {
    const graph = offeringGraph();
    const forward = await buildImmutableManifestFromPersistedContent(
      await createInput(graph),
    );
    const reversed = await buildImmutableManifestFromPersistedContent(
      await createInput([...graph].reverse()),
    );
    assertImmutablePublicationManifest(forward);
    assertImmutablePublicationManifest(reversed);
    expect(reversed.closureHash).toBe(forward.closureHash);
  });

  it.each([
    ["provider", providerId, /missing provider/u],
    ["price", graphId("pcs", 20), /price membership does not close/u],
    [
      "precision observation",
      graphId("prc", 20),
      /precision membership does not close/u,
    ],
    ["evidence", graphId("evd", 21), /references missing evidence/u],
  ])("rejects a missing %s resource", async (_label, resourceId, error) => {
    const graph = offeringGraph().filter(
      (resource) => resource.resourceId !== resourceId,
    );
    await expect(
      createInput(graph).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(error);
  });

  it("rejects an Offering that references a missing target", async () => {
    const graph = replaceValue(
      offeringGraph(),
      graphId("off", 20),
      (value) => ({ ...value, model_resource_id: id("mdl", 99) }),
    );
    await expect(
      createInput(graph).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(/missing target/u);
  });

  it("rejects forward/reverse child drift", async () => {
    const graph = replaceValue(
      offeringGraph(),
      graphId("off", 20),
      (value) => ({ ...value, price_ids: [] }),
    );
    await expect(
      createInput(graph).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(/price membership does not close/u);
  });

  it.each([
    ["provider_id", "prv_00000000-0000-4000-8000-000000000099"],
    ["provider_model_id", "publisher/other"],
    ["tier_key", "batch"],
    ["endpoint_class", "dedicated"],
    ["material_region_key", "eu-west"],
  ])("rejects precision applicability drift in %s", async (field, drift) => {
    const graph = replaceValue(
      offeringGraph(),
      graphId("prc", 20),
      (value) => ({
        ...value,
        applicability: {
          ...(value.applicability as Record<string, unknown>),
          [field]: drift,
        },
      }),
    );
    await expect(
      createInput(graph).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(/precision applicability does not match/u);
  });

  it("accepts Variant targets, component scope/evidence, and lifecycle states without inference", async () => {
    const familyId = id("fam", 20);
    const modelId = id("mdl", 20);
    const variantId = id("var", 20);
    const precisionEvidence = graphId("evd", 22);
    let graph: readonly ResourceValue[] = [
      ...offeringGraph(),
      {
        resourceType: "variant",
        resourceId: variantId,
        value: variant(variantId, modelId, familyId),
      },
    ];
    graph = replaceValue(graph, graphId("off", 20), (value) => ({
      ...value,
      model_resource_id: variantId,
      stale: true,
      stale_reason: "Provider refresh pending",
      status: knownWithEvidence("inactive", graphId("evd", 20)),
    }));
    graph = replaceValue(graph, graphId("prc", 20), (value) => ({
      ...value,
      applicability: {
        ...(value.applicability as Record<string, unknown>),
        component_scope: "weights",
      },
      components: [
        {
          component: "weights",
          normalized_format: knownWithEvidence("BF16", precisionEvidence),
          raw_precision: knownWithEvidence("bf16", precisionEvidence),
        },
      ],
    }));
    await expect(
      createInput(graph).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).resolves.toBeDefined();
  });

  it("accepts unordered multi-Price membership and equal effective endpoints", async () => {
    const firstPriceId = graphId("pcs", 20);
    const secondPriceId = graphId("pcs", 21);
    const secondEvidenceId = graphId("evd", 23);
    const graph = offeringGraph();
    const firstPrice = graph.find(
      (resource) => resource.resourceId === firstPriceId,
    );
    if (firstPrice?.value === undefined)
      throw new Error("missing first Price fixture");
    let expanded: readonly ResourceValue[] = [
      ...graph,
      {
        resourceType: "price",
        resourceId: secondPriceId,
        value: {
          ...(firstPrice.value as Record<string, unknown>),
          price_id: secondPriceId,
          role: "output",
          effective_from: observedAt,
          effective_to: observedAt,
          evidence_ids: [secondEvidenceId],
        },
      },
      {
        resourceType: "evidence_summary",
        resourceId: secondEvidenceId,
        value: evidenceSummary(secondEvidenceId, secondPriceId),
      },
    ];
    expanded = replaceValue(expanded, graphId("off", 20), (value) => ({
      ...value,
      price_ids: [secondPriceId, firstPriceId],
    }));
    await expect(
      createInput(expanded).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).resolves.toBeDefined();
  });

  it.each([
    [
      "orphan Price",
      graphId("pcs", 20),
      { offering_id: graphId("off", 99) },
      /missing offering/u,
    ],
    [
      "Price identity",
      graphId("pcs", 20),
      { price_id: graphId("pcs", 99) },
      /identity does not match/u,
    ],
    [
      "Offering attribution",
      graphId("off", 20),
      { provider_id: "prv_00000000-0000-4000-8000-000000000099" },
      /attribution does not match/u,
    ],
  ])("rejects %s drift", async (_label, resourceId, override, error) => {
    const graph = replaceValue(offeringGraph(), resourceId, (value) => ({
      ...value,
      ...override,
    }));
    await expect(
      createInput(graph).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(error);
  });

  it("rejects evidence subject drift and invalid temporal intervals", async () => {
    const subjectDrift = replaceValue(
      offeringGraph(),
      graphId("evd", 21),
      (value) => ({ ...value, subject_resource_id: graphId("off", 20) }),
    );
    await expect(
      createInput(subjectDrift).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(/evidence subject does not match/u);

    const invalidInterval = replaceValue(
      offeringGraph(),
      graphId("pcs", 20),
      (value) => ({
        ...value,
        effective_from: "2026-08-03T00:00:00.000Z",
        effective_to: "2026-08-02T00:00:00.000Z",
      }),
    );
    await expect(
      createInput(invalidInterval).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(/price effective interval is invalid/u);

    const offeringInterval = replaceValue(
      offeringGraph(),
      graphId("off", 20),
      (value) => ({
        ...value,
        first_observed_at: "2026-08-03T00:00:00.000Z",
        last_observed_at: "2026-08-02T00:00:00.000Z",
      }),
    );
    await expect(
      createInput(offeringInterval).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(/offering observation interval is invalid/u);
  });

  it("rejects aggregate Offering-graph bytes before parsing invalid JSON", async () => {
    const input = await createInput(offeringGraph());
    const invalidJson = "x".repeat(999_000);
    await expect(
      buildImmutableManifestFromPersistedContent({
        ...input,
        resources: Array.from({ length: 34 }, (_, index) => ({
          resourceType: "evidence_summary" as const,
          resourceId: graphId("evd", 1_000 + index),
          resourceJson: invalidJson,
          contentHash: digest,
        })),
      }),
    ).rejects.toThrow(/resource bytes are too large/u);
  });

  it("enforces exported resource, edge, and UTF-8 byte ceilings", () => {
    expect(OFFERING_CLOSURE_MAX_RELEVANT_RESOURCES).toBe(100_000);
    expect(OFFERING_CLOSURE_MAX_REFERENCE_EDGES).toBe(500_000);
    expect(OFFERING_CLOSURE_MAX_TOTAL_RESOURCE_BYTES).toBe(32 * 1_024 * 1_024);
    expect(() => {
      assertOfferingClosureCapacity(100_000, 500_000, 32 * 1_024 * 1_024);
    }).not.toThrow();
    expect(() => {
      assertOfferingClosureCapacity(100_001, 500_000, 32 * 1_024 * 1_024);
    }).toThrow(/resource input is too large/u);
    expect(() => {
      assertOfferingClosureCapacity(100_000, 500_001, 32 * 1_024 * 1_024);
    }).toThrow(/reference input is too large/u);
    expect(() => {
      assertOfferingClosureCapacity(100_000, 500_000, 32 * 1_024 * 1_024 + 1);
    }).toThrow(/resource bytes are too large/u);
  });
});

const unknownFact = {
  state: "unknown" as const,
  value: null,
  observed_at: null,
  evidence_ids: [],
};

const unavailableFact = {
  state: "unavailable" as const,
  value: null,
  observed_at: null,
  evidence_ids: [],
};

const notApplicableFact = {
  state: "not_applicable" as const,
  value: null,
  observed_at: null,
  evidence_ids: [],
};

const derivedCount = {
  value: 0,
  observed_at: observedAt,
  derivation_version: "cataloged-provider-count@1",
};

const family = (familyId: string, modelIds: readonly string[]) => ({
  family_id: familyId,
  slug: knownFact(`family-${familyId.slice(-4)}`),
  display_name: knownFact(`Family ${familyId.slice(-4)}`),
  publisher: knownFact("Publisher"),
  model_ids: [...modelIds],
  last_model_data_refresh: knownFact(observedAt),
});

const model = (
  modelId: string,
  familyId: string,
  status:
    | typeof unknownFact
    | typeof unavailableFact
    | typeof notApplicableFact
    | ReturnType<typeof knownFact> = knownFact("active"),
) => ({
  model_id: modelId,
  family_id: familyId,
  slug: knownFact(`model-${modelId.slice(-4)}`),
  display_name: knownFact(`Model ${modelId.slice(-4)}`),
  publisher: knownFact("Publisher"),
  release_date: unknownFact,
  modalities: unknownFact,
  context_window_tokens: unknownFact,
  maximum_output_tokens: unknownFact,
  license: unknownFact,
  architecture: unknownFact,
  total_parameters: unknownFact,
  active_parameters: unknownFact,
  authoritative_checkpoint_ids: [],
  checkpoints: [],
  source_weight_format: unknownFact,
  source_quantization: unknownFact,
  status,
  cataloged_provider_count: derivedCount,
  last_model_data_refresh: knownFact(observedAt),
});

const variant = (variantId: string, modelId: string, familyId: string) => ({
  variant_id: variantId,
  model_id: modelId,
  family_id: familyId,
  slug: knownFact(`variant-${variantId.slice(-4)}`),
  display_name: knownFact(`Variant ${variantId.slice(-4)}`),
  variant_kind: knownFact("publisher_variant"),
  selection_evidence: knownFact("Explicit publisher selection"),
  publisher: knownFact("Publisher"),
  release_date: unknownFact,
  modalities: unknownFact,
  context_window_tokens: unknownFact,
  maximum_output_tokens: unknownFact,
  license: unknownFact,
  architecture: unknownFact,
  total_parameters: unknownFact,
  active_parameters: unknownFact,
  source_weight_format: unknownFact,
  source_quantization: unknownFact,
  checkpoint_ids: [],
  checkpoints: [],
  status: unavailableFact,
  cataloged_provider_count: derivedCount,
  last_model_data_refresh: knownFact(observedAt),
});

type ResourceValue = Readonly<{
  resourceType: ResourceType;
  resourceId: string;
  value?: unknown;
  resourceJson?: string;
}>;

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const createInput = async (
  values: readonly ResourceValue[],
): Promise<PersistedPublicationManifestInput> => {
  const resources = await Promise.all(
    values.map(async (resource) => {
      const resourceJson =
        resource.resourceJson ?? canonicalJson(resource.value);
      const descriptor = {
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        resourceJson,
      };
      return {
        ...descriptor,
        contentHash: await hashPublicationResourceContent(descriptor),
      };
    }),
  );
  const searchDocuments = await Promise.all(
    values
      .filter(
        (resource) =>
          resource.resourceType === "model" ||
          resource.resourceType === "variant",
      )
      .map(async (resource) => {
        const documentId = await derivePublicationVectorId(
          publicationId,
          resource.resourceType as "model" | "variant",
          resource.resourceId,
        );
        const descriptor = {
          resourceType: resource.resourceType as "model" | "variant",
          resourceId: resource.resourceId,
          documentId,
          normalizedName: resource.resourceId,
          aliasesJson: "[]",
          publisherName: "Publisher",
          providerModelIdsJson: "[]",
          documentText: resource.resourceId,
        };
        return {
          ...descriptor,
          contentHash: await hashPublicationSearchDocumentContent(descriptor),
        };
      }),
  );
  const vectors = searchDocuments.map((document) => ({
    resourceType: document.resourceType,
    resourceId: document.resourceId,
    vectorId: document.documentId,
    searchDocumentContentHash: document.contentHash,
    embeddingInputHash: digest,
  }));
  const resourceDescriptors = resources
    .map(({ resourceType, resourceId, contentHash }) => ({
      resourceType,
      resourceId,
      contentHash,
    }))
    .sort((left, right) =>
      `${left.resourceType}:${left.resourceId}`.localeCompare(
        `${right.resourceType}:${right.resourceId}`,
      ),
    );
  const documentDescriptors = [...searchDocuments].sort((left, right) =>
    `${left.resourceType}:${left.resourceId}`.localeCompare(
      `${right.resourceType}:${right.resourceId}`,
    ),
  );
  const vectorDescriptors = [...vectors].sort((left, right) =>
    `${left.resourceType}:${left.resourceId}`.localeCompare(
      `${right.resourceType}:${right.resourceId}`,
    ),
  );
  const firstResource = resourceDescriptors[0];
  const lastResource = resourceDescriptors.at(-1);
  const firstDocument = documentDescriptors[0];
  const lastDocument = documentDescriptors.at(-1);
  const firstVector = vectorDescriptors[0];
  const lastVector = vectorDescriptors.at(-1);
  if (
    firstResource === undefined ||
    lastResource === undefined ||
    firstDocument === undefined ||
    lastDocument === undefined ||
    firstVector === undefined ||
    lastVector === undefined
  )
    throw new Error("model family closure fixture inventory is empty");
  const chunks = [
    {
      kind: "resources" as const,
      ordinal: 0,
      firstKey: `${firstResource.resourceType}:${firstResource.resourceId}`,
      lastKey: `${lastResource.resourceType}:${lastResource.resourceId}`,
      itemCount: resourceDescriptors.length,
      contentHash: await hashPublicationResourceChunk(resourceDescriptors),
    },
    {
      kind: "exact_search" as const,
      ordinal: 0,
      firstKey: `${firstDocument.resourceType}:${firstDocument.resourceId}`,
      lastKey: `${lastDocument.resourceType}:${lastDocument.resourceId}`,
      itemCount: documentDescriptors.length,
      contentHash: await hashPublicationSearchChunk(documentDescriptors),
    },
    {
      kind: "vectors" as const,
      ordinal: 0,
      firstKey: `${firstVector.resourceType}:${firstVector.resourceId}`,
      lastKey: `${lastVector.resourceType}:${lastVector.resourceId}`,
      itemCount: vectorDescriptors.length,
      contentHash: await hashPublicationVectorChunk(
        publicationId,
        vectorDescriptors,
      ),
    },
  ];
  const providerAttributions = values
    .filter(
      (resource) =>
        resource.resourceType === "provider" ||
        resource.resourceType === "offering" ||
        resource.resourceType === "price" ||
        resource.resourceType === "precision_observation",
    )
    .map((resource) => ({
      resourceType: resource.resourceType as
        "provider" | "offering" | "price" | "precision_observation",
      resourceId: resource.resourceId,
      providerId,
    }));
  const hasProviderContent = providerAttributions.length > 0;
  return {
    contractVersion: "1.0.0",
    publicationId,
    sourceRunId: "run_00000000-0000-4000-8000-000000000001",
    parentPublicationId: null,
    generatedAt: observedAt,
    versions: {
      schema: "1.9.0",
      methodology: "methodology@1",
      precisionNormalization: "precision@1",
      precisionDisplayOrder: "display@1",
      pricePolicy: "price@1",
      sourcePolicy: "source@1",
      embedding: "embedding@1",
      buildCommit: "git:test",
    },
    enabledProviderScopeVersion: "test@1",
    enabledProviderIds: [providerId],
    providerSlices: [
      {
        providerId,
        providerSliceId: hasProviderContent
          ? "prn_00000000-0000-4000-8000-000000000001"
          : null,
        providerRunId: "pvr_00000000-0000-4000-8000-000000000001",
        adapterVersion: "adapter@1",
        rosterVersion: "roster@1",
        sourceRegisterVersion: "register@1",
        carriedForward: false,
        freshnessState: hasProviderContent ? "fresh" : "unavailable",
      },
    ],
    providerAttributions,
    resources,
    searchDocuments,
    vectors,
    chunks,
    bundleHash: digest,
  };
};

const familyA = id("fam", 1);
const familyB = id("fam", 2);
const familyEmpty = id("fam", 3);
const modelA = id("mdl", 1);
const modelB = id("mdl", 2);
const modelC = id("mdl", 3);
const variantA = id("var", 1);
const variantB = id("var", 2);

const validGraph = (): ResourceValue[] => [
  {
    resourceType: "model_family",
    resourceId: familyA,
    value: family(familyA, [modelB, modelA]),
  },
  {
    resourceType: "model_family",
    resourceId: familyB,
    value: family(familyB, [modelC]),
  },
  {
    resourceType: "model_family",
    resourceId: familyEmpty,
    value: family(familyEmpty, []),
  },
  {
    resourceType: "model",
    resourceId: modelA,
    value: model(modelA, familyA),
  },
  {
    resourceType: "model",
    resourceId: modelB,
    value: model(modelB, familyA, unknownFact),
  },
  {
    resourceType: "model",
    resourceId: modelC,
    value: model(modelC, familyB, notApplicableFact),
  },
  {
    resourceType: "variant",
    resourceId: variantA,
    value: variant(variantA, modelA, familyA),
  },
  {
    resourceType: "variant",
    resourceId: variantB,
    value: variant(variantB, modelA, familyA),
  },
];

const replaceValue = (
  values: readonly ResourceValue[],
  resourceId: string,
  update: (value: Record<string, unknown>) => unknown,
): ResourceValue[] =>
  values.map((resource) =>
    resource.resourceId === resourceId
      ? {
          ...resource,
          value: update(resource.value as Record<string, unknown>),
        }
      : resource,
  );

describe("persisted ModelFamily/Model/Variant semantic closure", () => {
  it("accepts multiple families, an empty family, multiple Variants, Models in every Fact state, and zero-Variant Models", async () => {
    const manifest = await buildImmutableManifestFromPersistedContent(
      await createInput(validGraph()),
    );
    expect(() => {
      assertImmutablePublicationManifest(manifest);
    }).not.toThrow();
  });

  it.each(["active", "inactive", "stale", "historical", "conditional"])(
    "applies the same relationship closure to a known %s lifecycle value",
    async (lifecycle) => {
      const graph = replaceValue(validGraph(), modelA, (value) => ({
        ...value,
        status: knownFact(lifecycle),
      }));
      await expect(
        createInput(graph).then((input) =>
          buildImmutableManifestFromPersistedContent(input),
        ),
      ).resolves.toBeDefined();
    },
  );

  it("treats resource and family membership order as nonsemantic", async () => {
    const base = validGraph();
    await expect(
      buildImmutableManifestFromPersistedContent(
        await createInput([...base].reverse()),
      ),
    ).resolves.toBeDefined();
    await expect(
      buildImmutableManifestFromPersistedContent(
        await createInput(
          replaceValue(base, familyA, (value) => ({
            ...value,
            model_ids: [modelA, modelB],
          })),
        ),
      ),
    ).resolves.toBeDefined();
  });

  it.each([
    [
      "a Model whose family is absent",
      () =>
        replaceValue(validGraph(), modelA, (value) => ({
          ...value,
          family_id: id("fam", 99),
        })),
      /model references a missing family/u,
    ],
    [
      "a family that omits one of its Models",
      () =>
        replaceValue(validGraph(), familyA, (value) => ({
          ...value,
          model_ids: [modelA],
        })),
      /family model membership does not close/u,
    ],
    [
      "a family that lists a nonexistent Model",
      () =>
        replaceValue(validGraph(), familyA, (value) => ({
          ...value,
          model_ids: [modelA, modelB, id("mdl", 99)],
        })),
      /family model membership does not close/u,
    ],
    [
      "a family that lists a Model assigned to another family",
      () =>
        replaceValue(validGraph(), familyB, (value) => ({
          ...value,
          model_ids: [modelC, modelA],
        })),
      /family model membership does not close/u,
    ],
    [
      "a Variant whose Model is absent",
      () =>
        replaceValue(validGraph(), variantA, (value) => ({
          ...value,
          model_id: id("mdl", 99),
        })),
      /variant references a missing model/u,
    ],
    [
      "a Variant whose family differs from its Model",
      () =>
        replaceValue(validGraph(), variantA, (value) => ({
          ...value,
          family_id: familyB,
        })),
      /variant family does not match/u,
    ],
  ])("rejects %s", async (_label, graph, error) => {
    await expect(
      createInput(graph()).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(error);
  });

  it("rejects malformed JSON and contract-invalid canonical content", async () => {
    const malformed = validGraph();
    malformed[0] = { ...malformed[0]!, resourceJson: "{" };
    await expect(createInput(malformed)).rejects.toThrow(/JSON is invalid/u);

    const malformedPersistedInput = await createInput(validGraph());
    await expect(
      buildImmutableManifestFromPersistedContent({
        ...malformedPersistedInput,
        resources: malformedPersistedInput.resources.map((resource, index) =>
          index === 0
            ? { ...resource, resourceJson: "{", contentHash: digest }
            : resource,
        ),
      }),
    ).rejects.toThrow(/JSON is invalid/u);

    const invalid = replaceValue(validGraph(), familyA, (value) => ({
      ...value,
      unexpected: true,
    }));
    await expect(
      createInput(invalid).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(/model family resource is not contract-valid/u);
  });

  it("rejects duplicate family membership through the canonical contract", async () => {
    const duplicateMembership = replaceValue(
      validGraph(),
      familyA,
      (value) => ({
        ...value,
        model_ids: [modelA, modelA, modelB],
      }),
    );
    await expect(
      createInput(duplicateMembership).then((input) =>
        buildImmutableManifestFromPersistedContent(input),
      ),
    ).rejects.toThrow(/model family resource is not contract-valid/u);
  });

  it("checks persisted hashes and descriptor uniqueness before relationship closure", async () => {
    const brokenGraph = replaceValue(validGraph(), modelA, (value) => ({
      ...value,
      family_id: id("fam", 99),
    }));
    const badHashInput = await createInput(brokenGraph);
    await expect(
      buildImmutableManifestFromPersistedContent({
        ...badHashInput,
        resources: badHashInput.resources.map((resource) =>
          resource.resourceId === modelA
            ? { ...resource, contentHash: digest }
            : resource,
        ),
      }),
    ).rejects.toThrow(/resource content hash does not match/u);

    const duplicateDescriptorInput = await createInput([
      ...brokenGraph,
      brokenGraph.find((resource) => resource.resourceId === modelA)!,
    ]);
    await expect(
      buildImmutableManifestFromPersistedContent(duplicateDescriptorInput),
    ).rejects.toThrow(/resource inventory contains a duplicate/u);
  });

  it.each([
    ["model_family" as const, familyA, "family_id", id("fam", 98)],
    ["model" as const, modelA, "model_id", id("mdl", 98)],
    ["variant" as const, variantA, "variant_id", id("var", 98)],
  ])(
    "rejects a %s outer/inner identity mismatch",
    async (_resourceType, resourceId, identityField, wrongIdentity) => {
      const graph = replaceValue(validGraph(), resourceId, (value) => ({
        ...value,
        [identityField]: wrongIdentity,
      }));
      await expect(
        createInput(graph).then((input) =>
          buildImmutableManifestFromPersistedContent(input),
        ),
      ).rejects.toThrow(/resource identity does not match/u);
    },
  );

  it("enforces both exported closure ceilings without constructing oversized manifests", () => {
    expect(MODEL_FAMILY_CLOSURE_MAX_RELEVANT_RESOURCES).toBe(100_000);
    expect(MODEL_FAMILY_CLOSURE_MAX_MEMBERSHIP_EDGES).toBe(100_000);
    expect(() => {
      assertModelFamilyClosureCapacity(99_999, 99_999);
    }).not.toThrow();
    expect(() => {
      assertModelFamilyClosureCapacity(100_000, 100_000);
    }).not.toThrow();
    expect(() => {
      assertModelFamilyClosureCapacity(100_001, 100_000);
    }).toThrow(/resource input is too large/u);
    expect(() => {
      assertModelFamilyClosureCapacity(100_000, 100_001);
    }).toThrow(/membership input is too large/u);
  });

  it("rejects duplicate outer descriptors before parsing or hashing content", async () => {
    const input = await createInput(validGraph());
    const oversizedResource = {
      ...input.resources[0]!,
      resourceJson: "{",
      contentHash: digest,
    };
    await expect(
      buildImmutableManifestFromPersistedContent({
        ...input,
        resources: Array.from(
          { length: MODEL_FAMILY_CLOSURE_MAX_RELEVANT_RESOURCES + 1 },
          () => oversizedResource,
        ),
      }),
    ).rejects.toThrow(/resource inventory contains a duplicate/u);
  });
});
