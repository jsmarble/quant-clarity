import { describe, expect, it } from "vitest";

import {
  assertImmutablePublicationManifest,
  assertModelFamilyClosureCapacity,
  buildImmutableManifestFromPersistedContent,
  derivePublicationVectorId,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  hashPublicationSearchChunk,
  hashPublicationSearchDocumentContent,
  hashPublicationVectorChunk,
  MODEL_FAMILY_CLOSURE_MAX_MEMBERSHIP_EDGES,
  MODEL_FAMILY_CLOSURE_MAX_RELEVANT_RESOURCES,
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

const knownFact = <T>(value: T) => ({
  state: "known" as const,
  value,
  observed_at: observedAt,
  evidence_ids: [evidenceId],
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
        providerSliceId: null,
        providerRunId: "pvr_00000000-0000-4000-8000-000000000001",
        adapterVersion: "adapter@1",
        rosterVersion: "roster@1",
        sourceRegisterVersion: "register@1",
        carriedForward: false,
        freshnessState: "unavailable",
      },
    ],
    providerAttributions: [],
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

  it("rejects an oversized relevant inventory before parsing or hashing its content", async () => {
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
    ).rejects.toThrow(/resource input is too large/u);
  });
});
