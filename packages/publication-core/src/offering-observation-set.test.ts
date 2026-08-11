import { describe, expect, it } from "vitest";

import {
  OFFERING_OBSERVATION_SET_MAX_EMITTED_MEMBERSHIPS,
  OFFERING_OBSERVATION_SET_VERSION,
  advanceOfferingObservationSetMemberships,
  advanceOfferingObservationSetOutputCapacity,
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  projectOfferingObservationSets,
  type PersistedPublicationManifestInput,
  type PersistedResourceDescriptor,
  type PublicationId,
  type ResourceType,
  type SearchResourceType,
} from "./index.js";

const OBSERVED_AT = "2026-08-11T00:00:00.000Z";
const PUBLICATION_ID = id("pub", 1) as PublicationId;
const PROVIDER_ID = id("prv", 1);
const FAMILY_ID = id("fam", 1);
const MODEL_ID = id("mdl", 1);
const VARIANT_ID = id("var", 1);
const PROVIDER_EVIDENCE_ID = id("evd", 1);
const OFFERING_A_ID = id("off", 1);
const OFFERING_B_ID = id("off", 2);
const PRICE_INPUT_ID = id("pcs", 1);
const PRICE_PROMOTIONAL_ID = id("pcs", 2);
const PRECISION_SCALAR_ID = id("prc", 1);
const PRECISION_COMPONENT_ID = id("prc", 2);
const OFFERING_A_EVIDENCE_ID = id("evd", 2);
const OFFERING_B_EVIDENCE_ID = id("evd", 3);
const PRICE_INPUT_EVIDENCE_ID = id("evd", 4);
const PRICE_PROMOTIONAL_EVIDENCE_ID = id("evd", 5);
const PRECISION_SCALAR_EVIDENCE_ID = id("evd", 6);
const PRECISION_COMPONENT_EVIDENCE_ID = id("evd", 7);
const DIGEST = `sha256:${"a".repeat(64)}` as const;

function id(prefix: string, sequence: number): string {
  return `${prefix}_00000000-0000-4000-8000-${sequence
    .toString(16)
    .padStart(12, "0")}`;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
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
    .sort(compareAscii)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function known<T>(value: T, evidenceId: string) {
  return {
    state: "known" as const,
    value,
    observed_at: OBSERVED_AT,
    evidence_ids: [evidenceId],
  };
}

const unknownFact = Object.freeze({
  state: "unknown" as const,
  value: null,
  observed_at: null,
  evidence_ids: [] as string[],
});

type ResourceValue = Readonly<{
  resourceType: ResourceType;
  resourceId: string;
  value: Record<string, unknown>;
}>;

function targetCommon(displayName: string, evidenceSequence: number) {
  const evidenceId = id("evd", evidenceSequence);
  return {
    active_parameters: unknownFact,
    architecture: unknownFact,
    cataloged_provider_count: {
      value: 1,
      observed_at: OBSERVED_AT,
      derivation_version: "cataloged-provider-count@1",
    },
    checkpoints: [],
    context_window_tokens: unknownFact,
    display_name: known(displayName, evidenceId),
    family_id: FAMILY_ID,
    last_model_data_refresh: known(OBSERVED_AT, evidenceId),
    license: unknownFact,
    maximum_output_tokens: unknownFact,
    modalities: unknownFact,
    publisher: known("Synthetic Publisher", evidenceId),
    release_date: unknownFact,
    slug: known(displayName.toLowerCase().replaceAll(" ", "-"), evidenceId),
    source_quantization: unknownFact,
    source_weight_format: unknownFact,
    status: known("active", evidenceId),
    total_parameters: unknownFact,
  };
}

function evidenceSummary(
  evidenceId: string,
  subjectResourceId: string,
  field: string,
) {
  return {
    authenticated_only: false,
    evidence_id: evidenceId,
    extraction_method: "deterministic_fixture",
    extraction_version: "offering-observation-set-test@1",
    field,
    integrity_hash: DIGEST,
    observed_at: OBSERVED_AT,
    source_locator: "/redacted/offering-observation-set-test",
    source_owner: "QuantClarity test suite",
    source_type: "fixture",
    source_url: null,
    subject_resource_id: subjectResourceId,
    value: "Synthetic retained evidence",
  };
}

function offering(
  offeringId: string,
  targetId: string,
  evidenceId: string,
  childIds: Readonly<{
    prices: readonly string[];
    precision: readonly string[];
  }>,
) {
  return {
    display_name: known(
      offeringId === OFFERING_A_ID ? "Model offering" : "Variant offering",
      evidenceId,
    ),
    endpoint_class: "serverless",
    evidence_ids: [evidenceId],
    first_observed_at: OBSERVED_AT,
    last_observed_at: OBSERVED_AT,
    last_successful_refresh: known(OBSERVED_AT, evidenceId),
    material_region_key: "",
    model_resource_id: targetId,
    offering_id: offeringId,
    precision_observation_ids: [...childIds.precision],
    price_ids: [...childIds.prices],
    provider_id: PROVIDER_ID,
    provider_model_id:
      offeringId === OFFERING_A_ID ? "publisher/model" : "publisher/model-fp8",
    source_locator: known("https://provider.example/catalog", evidenceId),
    stale: offeringId === OFFERING_B_ID,
    stale_reason:
      offeringId === OFFERING_B_ID ? "Provider refresh pending" : null,
    status: known(
      offeringId === OFFERING_B_ID ? "inactive" : "active",
      evidenceId,
    ),
    supported_regions: known(["global"], evidenceId),
    tier_key: "standard",
  };
}

function price(
  priceId: string,
  evidenceId: string,
  overrides: Record<string, unknown>,
) {
  return {
    amount_decimal: "1.25",
    conditions: [],
    currency: "USD",
    currency_provenance: "provider_stated",
    effective_from: null,
    effective_to: null,
    evidence_ids: [evidenceId],
    is_standard_comparable: true,
    observed_at: OBSERVED_AT,
    offering_id: OFFERING_A_ID,
    price_class: "standard",
    price_id: priceId,
    role: "input",
    unit: "per_million_tokens",
    ...overrides,
  };
}

function precision(
  precisionId: string,
  evidenceId: string,
  overrides: Record<string, unknown>,
) {
  return {
    applicability: {
      component_scope: null,
      endpoint_class: "serverless",
      material_region_key: "",
      provider_id: PROVIDER_ID,
      provider_model_id: "publisher/model",
      tier_key: "standard",
    },
    components: [],
    evidence_ids: [evidenceId],
    format_variant: unknownFact,
    normalized_format: known("BF16", evidenceId),
    observed_at: OBSERVED_AT,
    offering_id: OFFERING_A_ID,
    precision_id: precisionId,
    provider_definition: known("Provider-declared precision", evidenceId),
    raw_field_name: "precision",
    raw_precision: known("bf16", evidenceId),
    summary_format: known("BF16", evidenceId),
    ...overrides,
  };
}

function graph(): readonly ResourceValue[] {
  const provider = {
    active_offering_count: {
      derivation_version: "active-offering-count@1",
      observed_at: OBSERVED_AT,
      value: 2,
    },
    affiliate_relationship_present: false,
    display_name: known("Synthetic Provider", PROVIDER_EVIDENCE_ID),
    last_successful_refresh: known(OBSERVED_AT, id("evd", 102)),
    official_site: known("https://provider.example", id("evd", 103)),
    precision_coverage: {
      derivation_version: "precision-coverage@1",
      known_count: 1,
      known_proportion_decimal: "0.5",
      unknown_count: 1,
    },
    provider_id: PROVIDER_ID,
    slug: known("synthetic-provider", id("evd", 104)),
    status: known("active", id("evd", 105)),
  };
  const scalarPrecision = precision(
    PRECISION_SCALAR_ID,
    PRECISION_SCALAR_EVIDENCE_ID,
    {},
  );
  const componentPrecision = precision(
    PRECISION_COMPONENT_ID,
    PRECISION_COMPONENT_EVIDENCE_ID,
    {
      applicability: {
        component_scope: "weights",
        endpoint_class: "serverless",
        material_region_key: "",
        provider_id: PROVIDER_ID,
        provider_model_id: "publisher/model",
        tier_key: "standard",
      },
      components: [
        {
          component: "weights",
          normalized_format: known("FP8", PRECISION_COMPONENT_EVIDENCE_ID),
          raw_precision: known("fp8-e4m3", PRECISION_COMPONENT_EVIDENCE_ID),
        },
      ],
      normalized_format: known("mixed", PRECISION_COMPONENT_EVIDENCE_ID),
      raw_precision: known("mixed", PRECISION_COMPONENT_EVIDENCE_ID),
      summary_format: known("mixed", PRECISION_COMPONENT_EVIDENCE_ID),
    },
  );
  return [
    {
      resourceType: "model_family",
      resourceId: FAMILY_ID,
      value: {
        display_name: known("Synthetic Family", id("evd", 201)),
        family_id: FAMILY_ID,
        last_model_data_refresh: known(OBSERVED_AT, id("evd", 202)),
        model_ids: [MODEL_ID],
        publisher: known("Synthetic Publisher", id("evd", 203)),
        slug: known("synthetic-family", id("evd", 204)),
      },
    },
    {
      resourceType: "model",
      resourceId: MODEL_ID,
      value: {
        ...targetCommon("Synthetic Model", 301),
        authoritative_checkpoint_ids: [],
        model_id: MODEL_ID,
      },
    },
    {
      resourceType: "variant",
      resourceId: VARIANT_ID,
      value: {
        ...targetCommon("Synthetic Variant", 401),
        checkpoint_ids: [],
        model_id: MODEL_ID,
        selection_evidence: known("Explicit provider variant", id("evd", 402)),
        variant_id: VARIANT_ID,
        variant_kind: known("publisher_variant", id("evd", 403)),
      },
    },
    { resourceType: "provider", resourceId: PROVIDER_ID, value: provider },
    {
      resourceType: "offering",
      resourceId: OFFERING_A_ID,
      value: offering(OFFERING_A_ID, MODEL_ID, OFFERING_A_EVIDENCE_ID, {
        prices: [PRICE_PROMOTIONAL_ID, PRICE_INPUT_ID],
        precision: [PRECISION_COMPONENT_ID, PRECISION_SCALAR_ID],
      }),
    },
    {
      resourceType: "offering",
      resourceId: OFFERING_B_ID,
      value: offering(OFFERING_B_ID, VARIANT_ID, OFFERING_B_EVIDENCE_ID, {
        prices: [],
        precision: [],
      }),
    },
    {
      resourceType: "price",
      resourceId: PRICE_INPUT_ID,
      value: price(PRICE_INPUT_ID, PRICE_INPUT_EVIDENCE_ID, {}),
    },
    {
      resourceType: "price",
      resourceId: PRICE_PROMOTIONAL_ID,
      value: price(PRICE_PROMOTIONAL_ID, PRICE_PROMOTIONAL_EVIDENCE_ID, {
        amount_decimal: "0.75",
        conditions: ["Launch promotion"],
        currency: "EUR",
        effective_from: OBSERVED_AT,
        is_standard_comparable: false,
        price_class: "promotional",
        role: "output",
      }),
    },
    {
      resourceType: "precision_observation",
      resourceId: PRECISION_SCALAR_ID,
      value: scalarPrecision,
    },
    {
      resourceType: "precision_observation",
      resourceId: PRECISION_COMPONENT_ID,
      value: componentPrecision,
    },
    ...(
      [
        [PROVIDER_EVIDENCE_ID, PROVIDER_ID, "display_name"],
        [OFFERING_A_EVIDENCE_ID, OFFERING_A_ID, "offering_observation"],
        [OFFERING_B_EVIDENCE_ID, OFFERING_B_ID, "offering_observation"],
        [PRICE_INPUT_EVIDENCE_ID, PRICE_INPUT_ID, "amount_decimal"],
        [PRICE_PROMOTIONAL_EVIDENCE_ID, PRICE_PROMOTIONAL_ID, "amount_decimal"],
        [
          PRECISION_SCALAR_EVIDENCE_ID,
          PRECISION_SCALAR_ID,
          "normalized_format",
        ],
        [PRECISION_COMPONENT_EVIDENCE_ID, PRECISION_COMPONENT_ID, "components"],
      ] as const
    ).map(([evidenceId, subjectId, field]) => ({
      resourceType: "evidence_summary" as const,
      resourceId: evidenceId,
      value: evidenceSummary(evidenceId, subjectId, field),
    })),
  ];
}

async function persistedResources(
  values: readonly ResourceValue[],
): Promise<readonly PersistedResourceDescriptor[]> {
  const resources = await Promise.all(
    values.map(async (resource) => {
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
  return resources.sort((left, right) =>
    compareAscii(
      `${left.resourceType}:${left.resourceId}`,
      `${right.resourceType}:${right.resourceId}`,
    ),
  );
}

async function manifestInput(
  values: readonly ResourceValue[],
  publicationId: PublicationId = PUBLICATION_ID,
): Promise<PersistedPublicationManifestInput> {
  const resources = await persistedResources(values);
  const searchable = resources.filter(
    (resource) =>
      resource.resourceType === "model" || resource.resourceType === "variant",
  );
  const searchDocuments = await Promise.all(
    searchable.map(async (resource) => {
      const resourceSpec = values.find(
        (candidate) =>
          candidate.resourceType === resource.resourceType &&
          candidate.resourceId === resource.resourceId,
      );
      const displayName = (
        resourceSpec?.value.display_name as
          Readonly<{ value?: unknown }> | undefined
      )?.value;
      const documentId = await derivePublicationVectorId(
        publicationId,
        resource.resourceType as SearchResourceType,
        resource.resourceId,
      );
      const document = {
        resourceType: resource.resourceType as SearchResourceType,
        resourceId: resource.resourceId,
        documentId,
        normalizedName:
          typeof displayName === "string"
            ? displayName.toLowerCase()
            : "target",
        aliasesJson: "[]",
        publisherName: "Synthetic Publisher",
        providerModelIdsJson: "[]",
        documentText:
          typeof displayName === "string" ? displayName : resource.resourceId,
      };
      return {
        ...document,
        contentHash: await hashPublicationSearchDocumentContent(document),
      };
    }),
  );
  searchDocuments.sort((left, right) =>
    compareAscii(
      `${left.resourceType}:${left.resourceId}`,
      `${right.resourceType}:${right.resourceId}`,
    ),
  );
  const vectors = searchDocuments.map((document) => ({
    resourceType: document.resourceType,
    resourceId: document.resourceId,
    vectorId: document.documentId,
    searchDocumentContentHash: document.contentHash,
    embeddingInputHash: DIGEST,
  }));
  const chunks = [
    {
      kind: "resources" as const,
      ordinal: 0,
      firstKey: `${resources[0]!.resourceType}:${resources[0]!.resourceId}`,
      lastKey: `${resources.at(-1)!.resourceType}:${resources.at(-1)!.resourceId}`,
      itemCount: resources.length,
      contentHash: await hashPublicationResourceChunk(resources),
    },
    {
      kind: "exact_search" as const,
      ordinal: 0,
      firstKey: `${searchDocuments[0]!.resourceType}:${searchDocuments[0]!.resourceId}`,
      lastKey: `${searchDocuments.at(-1)!.resourceType}:${searchDocuments.at(-1)!.resourceId}`,
      itemCount: searchDocuments.length,
      contentHash: await hashPublicationSearchChunk(searchDocuments),
    },
    {
      kind: "vectors" as const,
      ordinal: 0,
      firstKey: `${vectors[0]!.resourceType}:${vectors[0]!.resourceId}`,
      lastKey: `${vectors.at(-1)!.resourceType}:${vectors.at(-1)!.resourceId}`,
      itemCount: vectors.length,
      contentHash: await hashPublicationVectorChunk(publicationId, vectors),
    },
  ];
  return {
    contractVersion: "1.0.0",
    publicationId,
    sourceRunId: id("run", 1),
    parentPublicationId: null,
    generatedAt: OBSERVED_AT,
    versions: {
      schema: "1.13.0",
      methodology: "1.0.0",
      precisionNormalization: "1.0.0",
      precisionDisplayOrder: "1.0.0",
      pricePolicy: "1.0.0",
      sourcePolicy: "1.0.0",
      embedding: "embedding@1",
      buildCommit: "test-commit",
    },
    enabledProviderScopeVersion: "provider-scope@1",
    enabledProviderIds: [PROVIDER_ID],
    providerSlices: [
      {
        providerId: PROVIDER_ID,
        providerSliceId: id("prn", 1),
        providerRunId: id("pvr", 1),
        adapterVersion: "adapter@1",
        rosterVersion: "roster@1",
        sourceRegisterVersion: "register@1",
        carriedForward: false,
        freshnessState: "fresh",
      },
    ],
    providerAttributions: resources
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
        providerId: PROVIDER_ID,
      })),
    resources,
    searchDocuments,
    vectors,
    chunks,
    bundleHash: DIGEST,
  };
}

async function fixture(
  values: readonly ResourceValue[] = graph(),
  publicationId: PublicationId = PUBLICATION_ID,
) {
  const input = await manifestInput(values, publicationId);
  const manifest = await buildImmutableManifestFromPersistedContent(input);
  return { input, manifest };
}

function keysDeep(value: unknown, output = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, output);
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    output.add(key);
    keysDeep(child, output);
  }
  return output;
}

describe("selection-free Offering observation sets", () => {
  it("is permutation-invariant and binds deterministic inventory authority", async () => {
    const { input, manifest } = await fixture();
    const forward = await projectOfferingObservationSets({
      manifest,
      resources: input.resources,
    });
    const reversed = await projectOfferingObservationSets({
      manifest,
      resources: [...input.resources].reverse(),
    });

    expect(forward).toEqual(reversed);
    expect(forward.projection_version).toBe(OFFERING_OBSERVATION_SET_VERSION);
    expect(forward.authority).toBe("selection_free_observations");
    expect(forward.claim_authority).toBe("unproven");
    expect(forward.publication_id).toBe(PUBLICATION_ID);
    expect(forward.closure_hash).toBe(manifest.closureHash);
    expect(forward.offering_set_count).toBe(2);
    expect(forward.price_count).toBe(2);
    expect(forward.precision_observation_count).toBe(2);
    expect(forward.evidence_summary_count).toBe(8);
    expect(forward.resource_inventory_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(forward.inventory_hash).toBe(
      "sha256:e1865a61a3d1dffc8b4daafe963a46e69d250d1f65bb22da5c425666df8cf71a",
    );
  });

  it("binds empty inventories to publication closure and resource authority", async () => {
    const emptyGraph = graph().filter(
      (resource) =>
        resource.resourceType !== "offering" &&
        resource.resourceType !== "price" &&
        resource.resourceType !== "precision_observation" &&
        resource.resourceType !== "evidence_summary",
    );
    const first = await fixture(emptyGraph, id("pub", 10) as PublicationId);
    const secondValues = emptyGraph.map((resource) =>
      resource.resourceType === "provider"
        ? {
            ...resource,
            value: {
              ...resource.value,
              affiliate_relationship_present: true,
            },
          }
        : resource,
    );
    const second = await fixture(secondValues, id("pub", 10) as PublicationId);
    const firstProjection = await projectOfferingObservationSets({
      manifest: first.manifest,
      resources: first.input.resources,
    });
    const secondProjection = await projectOfferingObservationSets({
      manifest: second.manifest,
      resources: second.input.resources,
    });

    expect(firstProjection.offering_set_count).toBe(0);
    expect(secondProjection.offering_set_count).toBe(0);
    expect(firstProjection.resource_inventory_hash).not.toBe(
      secondProjection.resource_inventory_hash,
    );
    expect(firstProjection.closure_hash).not.toBe(
      secondProjection.closure_hash,
    );
    expect(firstProjection.inventory_hash).not.toBe(
      secondProjection.inventory_hash,
    );
  });

  it("sorts outer members but hash-binds valid internal array byte order", async () => {
    const ordinary = await fixture();
    const reorderedValues = graph().map((resource) =>
      resource.resourceId === OFFERING_A_ID
        ? {
            ...resource,
            value: {
              ...resource.value,
              price_ids: [PRICE_INPUT_ID, PRICE_PROMOTIONAL_ID],
              precision_observation_ids: [
                PRECISION_SCALAR_ID,
                PRECISION_COMPONENT_ID,
              ],
            },
          }
        : resource,
    );
    const reordered = await fixture(reorderedValues);
    const ordinaryProjection = await projectOfferingObservationSets({
      manifest: ordinary.manifest,
      resources: ordinary.input.resources,
    });
    const reorderedProjection = await projectOfferingObservationSets({
      manifest: reordered.manifest,
      resources: reordered.input.resources,
    });

    expect(
      ordinaryProjection.offering_sets[0]?.prices.map(
        (price) => price.price_id,
      ),
    ).toEqual([PRICE_INPUT_ID, PRICE_PROMOTIONAL_ID]);
    expect(
      reorderedProjection.offering_sets[0]?.prices.map(
        (price) => price.price_id,
      ),
    ).toEqual([PRICE_INPUT_ID, PRICE_PROMOTIONAL_ID]);
    expect(ordinaryProjection.offering_sets[0]?.observation_set_hash).not.toBe(
      reorderedProjection.offering_sets[0]?.observation_set_hash,
    );
    expect(ordinaryProjection.inventory_hash).not.toBe(
      reorderedProjection.inventory_hash,
    );
  });

  it("checks the emitted-membership ceiling incrementally", () => {
    expect(
      advanceOfferingObservationSetOutputCapacity(
        OFFERING_OBSERVATION_SET_MAX_EMITTED_MEMBERSHIPS - 1,
        1,
      ),
    ).toBe(OFFERING_OBSERVATION_SET_MAX_EMITTED_MEMBERSHIPS);
    expect(() =>
      advanceOfferingObservationSetOutputCapacity(
        OFFERING_OBSERVATION_SET_MAX_EMITTED_MEMBERSHIPS,
        1,
      ),
    ).toThrow(/membership.*large/u);
    expect(() => advanceOfferingObservationSetOutputCapacity(-1, 1)).toThrow(
      /capacity.*invalid/u,
    );

    const firstProviderSet = advanceOfferingObservationSetMemberships(0, {
      priceCount: 0,
      precisionObservationCount: 0,
      evidenceSummaryCount: 1,
    });
    const secondProviderSet = advanceOfferingObservationSetMemberships(
      firstProviderSet,
      {
        priceCount: 0,
        precisionObservationCount: 0,
        evidenceSummaryCount: 1,
      },
    );
    expect(firstProviderSet).toBe(4);
    expect(secondProviderSet).toBe(8);
    expect(() =>
      advanceOfferingObservationSetMemberships(
        OFFERING_OBSERVATION_SET_MAX_EMITTED_MEMBERSHIPS - 3,
        {
          priceCount: 0,
          precisionObservationCount: 0,
          evidenceSummaryCount: 1,
        },
      ),
    ).toThrow(/membership.*large/u);
  });

  it("keeps Model and Variant targets distinct and retains zero/many children", async () => {
    const { input, manifest } = await fixture();
    const projection = await projectOfferingObservationSets({
      manifest,
      resources: input.resources,
    });
    expect(
      projection.offering_sets.map((set) => set.offering.offering_id),
    ).toEqual([OFFERING_A_ID, OFFERING_B_ID]);
    expect(projection.offering_sets[0]?.target).toEqual({
      resource_type: "model",
      resource_id: MODEL_ID,
    });
    expect(projection.offering_sets[1]?.target).toEqual({
      resource_type: "variant",
      resource_id: VARIANT_ID,
    });
    expect(
      projection.offering_sets[0]?.prices.map((row) => row.price_id),
    ).toEqual([PRICE_INPUT_ID, PRICE_PROMOTIONAL_ID]);
    expect(
      projection.offering_sets[0]?.precision_observations.map(
        (row) => row.precision_id,
      ),
    ).toEqual([PRECISION_SCALAR_ID, PRECISION_COMPONENT_ID]);
    expect(projection.offering_sets[1]?.prices).toEqual([]);
    expect(projection.offering_sets[1]?.precision_observations).toEqual([]);
  });

  it("preserves raw facts, lifecycle states, price classes/currencies, and components", async () => {
    const { input, manifest } = await fixture();
    const projection = await projectOfferingObservationSets({
      manifest,
      resources: input.resources,
    });
    const modelSet = projection.offering_sets[0];
    const variantSet = projection.offering_sets[1];
    expect(modelSet?.provider).toEqual({
      provider_id: PROVIDER_ID,
      display_name: known("Synthetic Provider", PROVIDER_EVIDENCE_ID),
    });
    expect(modelSet?.prices).toEqual([
      price(PRICE_INPUT_ID, PRICE_INPUT_EVIDENCE_ID, {}),
      price(PRICE_PROMOTIONAL_ID, PRICE_PROMOTIONAL_EVIDENCE_ID, {
        amount_decimal: "0.75",
        conditions: ["Launch promotion"],
        currency: "EUR",
        effective_from: OBSERVED_AT,
        is_standard_comparable: false,
        price_class: "promotional",
        role: "output",
      }),
    ]);
    expect(modelSet?.precision_observations[1]?.components).toEqual([
      {
        component: "weights",
        normalized_format: known("FP8", PRECISION_COMPONENT_EVIDENCE_ID),
        raw_precision: known("fp8-e4m3", PRECISION_COMPONENT_EVIDENCE_ID),
      },
    ]);
    expect(variantSet?.offering.status.value).toBe("inactive");
    expect(variantSet?.offering.stale).toBe(true);
    expect(variantSet?.offering.stale_reason).toBe("Provider refresh pending");
    expect(
      modelSet?.evidence_summaries.map((summary) => summary.evidence_id),
    ).toEqual([
      PROVIDER_EVIDENCE_ID,
      OFFERING_A_EVIDENCE_ID,
      PRICE_INPUT_EVIDENCE_ID,
      PRICE_PROMOTIONAL_EVIDENCE_ID,
      PRECISION_SCALAR_EVIDENCE_ID,
      PRECISION_COMPONENT_EVIDENCE_ID,
    ]);
  });

  it("contains no current-value, ranking, blending, or affiliate authority", async () => {
    const { input, manifest } = await fixture();
    const projection = await projectOfferingObservationSets({
      manifest,
      resources: input.resources,
    });
    const keys = keysDeep(projection);
    for (const forbidden of [
      "current",
      "is_current",
      "latest",
      "rank",
      "ranking",
      "winner",
      "best",
      "cheapest",
      "blended_price",
      "affiliate_relationship_present",
      "referral_url",
    ])
      expect(keys.has(forbidden), forbidden).toBe(false);
  });

  it("returns detached deeply frozen values", async () => {
    const { input, manifest } = await fixture();
    const projection = await projectOfferingObservationSets({
      manifest,
      resources: input.resources,
    });
    const before = JSON.stringify(projection);
    const resource = input.resources.find(
      (candidate) => candidate.resourceId === OFFERING_A_ID,
    );
    if (resource === undefined) throw new Error("missing Offering fixture");
    (resource as { resourceJson: string }).resourceJson = "{}";

    expect(JSON.stringify(projection)).toBe(before);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.offering_sets)).toBe(true);
    expect(Object.isFrozen(projection.offering_sets[0])).toBe(true);
    expect(Object.isFrozen(projection.offering_sets[0]?.offering)).toBe(true);
    expect(Object.isFrozen(projection.offering_sets[0]?.prices)).toBe(true);
    expect(Object.isFrozen(projection.offering_sets[0]?.prices[0])).toBe(true);
    expect(
      Object.isFrozen(
        projection.offering_sets[0]?.precision_observations[1]?.components[0],
      ),
    ).toBe(true);
  });

  it("rejects missing, extra, tampered, and hostile persisted inventories", async () => {
    const { input, manifest } = await fixture();
    await expect(
      projectOfferingObservationSets({
        manifest,
        resources: input.resources.slice(1),
      }),
    ).rejects.toThrow(/match|inventory/u);
    await expect(
      projectOfferingObservationSets({
        manifest,
        resources: [...input.resources, input.resources[0]!],
      }),
    ).rejects.toThrow(/match|duplicate|inventory/u);

    let mismatchedRowReads = 0;
    const mismatchedCount = [...input.resources, input.resources[0]!];
    Object.defineProperty(mismatchedCount, String(mismatchedCount.length - 1), {
      enumerable: true,
      get() {
        mismatchedRowReads += 1;
        return input.resources[0]!;
      },
    });
    await expect(
      projectOfferingObservationSets({
        manifest,
        resources: mismatchedCount,
      }),
    ).rejects.toThrow(/match.*manifest/u);
    expect(mismatchedRowReads).toBe(0);

    const tampered = input.resources.map((resource) =>
      resource.resourceId === OFFERING_A_ID
        ? { ...resource, resourceJson: "{}" }
        : resource,
    );
    await expect(
      projectOfferingObservationSets({ manifest, resources: tampered }),
    ).rejects.toThrow(/hash|contract|match/u);

    await expect(
      projectOfferingObservationSets({
        manifest,
        resources: input.resources,
        visitor_id: "forbidden",
      } as Parameters<typeof projectOfferingObservationSets>[0]),
    ).rejects.toThrow(/input|invalid|shape/u);

    await expect(
      projectOfferingObservationSets({
        manifest,
        resources: input.resources.map((resource, index) =>
          index === 0 ? { ...resource, visitor_id: "forbidden" } : resource,
        ),
      }),
    ).rejects.toThrow(/resource|invalid|shape/u);

    let getterReads = 0;
    const hostile = Object.defineProperty({}, "resources", {
      enumerable: true,
      get() {
        getterReads += 1;
        return input.resources;
      },
    });
    Object.defineProperty(hostile, "manifest", {
      enumerable: true,
      value: manifest,
    });
    await expect(
      projectOfferingObservationSets(
        hostile as Parameters<typeof projectOfferingObservationSets>[0],
      ),
    ).rejects.toThrow(/input|invalid/u);
    expect(getterReads).toBe(0);

    let rowGetterReads = 0;
    const first = input.resources[0];
    if (first === undefined) throw new Error("missing resource fixture");
    const hostileRow = { ...first } as Record<string, unknown>;
    Object.defineProperty(hostileRow, "resourceJson", {
      enumerable: true,
      get() {
        rowGetterReads += 1;
        return first.resourceJson;
      },
    });
    await expect(
      projectOfferingObservationSets({
        manifest,
        resources: [
          hostileRow as unknown as PersistedResourceDescriptor,
          ...input.resources.slice(1),
        ],
      }),
    ).rejects.toThrow(/resource|invalid/u);
    expect(rowGetterReads).toBe(0);
  });

  it("requires provider display-name evidence with the Provider as subject", async () => {
    const withoutEvidence = graph().filter(
      (resource) => resource.resourceId !== PROVIDER_EVIDENCE_ID,
    );
    const missing = await fixture(withoutEvidence);
    await expect(
      projectOfferingObservationSets({
        manifest: missing.manifest,
        resources: missing.input.resources,
      }),
    ).rejects.toThrow(/provider.*display|evidence/u);

    const wrongSubject = graph().map((resource) =>
      resource.resourceId === PROVIDER_EVIDENCE_ID
        ? {
            ...resource,
            value: evidenceSummary(
              PROVIDER_EVIDENCE_ID,
              OFFERING_A_ID,
              "display_name",
            ),
          }
        : resource,
    );
    const mismatched = await fixture(wrongSubject);
    await expect(
      projectOfferingObservationSets({
        manifest: mismatched.manifest,
        resources: mismatched.input.resources,
      }),
    ).rejects.toThrow(/provider.*display|subject/iu);
  });
});
