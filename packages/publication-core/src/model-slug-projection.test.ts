import { describe, expect, it } from "vitest";

import {
  MODEL_SLUG_MAX_MAPPING_INVENTORY_BYTES,
  MODEL_SLUG_MAX_HISTORY_ROWS,
  MODEL_SLUG_MAX_MODELS,
  MODEL_SLUG_MAX_RESOURCE_BYTES,
  MODEL_SLUG_MAX_SOURCE_HISTORY_INVENTORY_BYTES,
  MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES,
  MODEL_SLUG_PROJECTION_VERSION,
  advanceModelSlugMappingInventoryByteBudget,
  advanceModelSlugResourceByteBudget,
  advanceModelSlugSourceHistoryInventoryByteBudget,
  assertModelSlugProjection,
  assertModelSlugResourceByteBudget,
  buildImmutableManifest,
  canonicalizePublicationJson,
  derivePublicationVectorId,
  hashPublicationResourceContent,
  initializeModelSlugMappingInventoryByteBudget,
  initializeModelSlugSourceHistoryInventoryByteBudget,
  projectModelSlugProjection,
  type ModelSlugHistorySourceRow,
  type ModelSlugMappingProjection,
  type ModelSlugProjectionInput,
  type ServingResourceClosureRow,
} from "./index.js";

const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const PUBLICATION_BOUNDARY_MS = Date.parse(OBSERVED_AT);
const HASH = `sha256:${"a".repeat(64)}` as const;
const OTHER_HASH = `sha256:${"b".repeat(64)}` as const;

function id(prefix: string, sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
}

function known<T>(value: T, evidenceSequence = 1) {
  return {
    evidence_ids: [id("evd", evidenceSequence)],
    observed_at: OBSERVED_AT,
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

function model(
  sequence: number,
  slug: string,
  status = "active",
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    active_parameters: nonKnown("unknown"),
    architecture: nonKnown("unknown"),
    authoritative_checkpoint_ids: [],
    cataloged_provider_count: {
      derivation_version: "cataloged-provider-count@1",
      observed_at: OBSERVED_AT,
      value: 0,
    },
    checkpoints: [],
    context_window_tokens: nonKnown("unknown"),
    display_name: known(`Model ${String(sequence)}`),
    family_id: id("fam", 1),
    last_model_data_refresh: known(OBSERVED_AT, 2),
    license: nonKnown("unknown"),
    maximum_output_tokens: nonKnown("unknown"),
    modalities: nonKnown("unknown"),
    model_id: id("mdl", sequence),
    publisher: known("Example Publisher", 3),
    release_date: known("2026-08-03", 4),
    slug: known(slug, 5),
    source_quantization: nonKnown("unknown"),
    source_weight_format: nonKnown("unknown"),
    status: known(status, 6),
    total_parameters: nonKnown("unknown"),
    ...overrides,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "string")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

type ModelSource = Readonly<{
  sequence: number;
  slug: string;
  status?: string;
  overrides?: Readonly<Record<string, unknown>>;
}>;

function history(
  sequence: number,
  modelSequence: number,
  slug: string,
  validFromMs: number,
  validToMs: number | null,
): ModelSlugHistorySourceRow {
  return {
    slug_history_id: id("slg", sequence),
    resource_id: id("mdl", modelSequence),
    resource_type: "model",
    slug,
    valid_from_ms: validFromMs,
    valid_to_ms: validToMs,
  };
}

function defaultHistory(models: readonly ModelSource[]) {
  return models.flatMap((source, index) => [
    history(
      index * 2 + 1,
      source.sequence,
      `old-${source.slug}`,
      PUBLICATION_BOUNDARY_MS - 2_000,
      PUBLICATION_BOUNDARY_MS - 1_000,
    ),
    history(
      index * 2 + 2,
      source.sequence,
      source.slug,
      PUBLICATION_BOUNDARY_MS - 1_000,
      null,
    ),
  ]);
}

async function fixture(
  modelSources: readonly ModelSource[] = [
    { sequence: 1, slug: "current-model" },
  ],
  historyRows?: readonly ModelSlugHistorySourceRow[],
): Promise<ModelSlugProjectionInput> {
  const resources = await Promise.all(
    modelSources.map(async (source): Promise<ServingResourceClosureRow> => {
      const resourceJson = canonicalizePublicationJson(
        canonicalJson(
          model(source.sequence, source.slug, source.status, source.overrides),
        ),
        "object",
      );
      const resourceId = id("mdl", source.sequence);
      return {
        resource_type: "model",
        resource_id: resourceId,
        resource_json: resourceJson,
        content_hash: await hashPublicationResourceContent({
          resourceType: "model",
          resourceId,
          resourceJson,
        }),
      };
    }),
  );
  const searchable = [...resources].sort((left, right) =>
    left.resource_id < right.resource_id ? -1 : 1,
  );
  const searchDocuments = await Promise.all(
    searchable.map(async (resource) => ({
      resourceType: "model" as const,
      resourceId: resource.resource_id,
      documentId: await derivePublicationVectorId(
        id("pub", 1) as `pub_${string}`,
        "model",
        resource.resource_id,
      ),
      contentHash: HASH,
    })),
  );
  const vectors = searchDocuments.map((document) => ({
    resourceType: "model" as const,
    resourceId: document.resourceId,
    vectorId: document.documentId,
    searchDocumentContentHash: document.contentHash,
    embeddingInputHash: OTHER_HASH,
  }));
  const first = `model:${searchable[0]!.resource_id}`;
  const last = `model:${searchable.at(-1)!.resource_id}`;
  const manifest = await buildImmutableManifest({
    contractVersion: "1.0.0",
    publicationId: id("pub", 1) as `pub_${string}`,
    sourceRunId: id("run", 1),
    parentPublicationId: null,
    generatedAt: OBSERVED_AT,
    versions: {
      schema: "1.11.0",
      methodology: "methodology@1",
      precisionNormalization: "precision@1",
      precisionDisplayOrder: "display@1",
      pricePolicy: "price@1",
      sourcePolicy: "source@1",
      embedding: "embedding@1",
      buildCommit: "test-commit",
    },
    enabledProviderScopeVersion: "scope@1",
    enabledProviderIds: [id("prv", 1)],
    providerSlices: [
      {
        providerId: id("prv", 1),
        providerSliceId: null,
        providerRunId: id("pvr", 1),
        adapterVersion: "adapter@1",
        rosterVersion: "roster@1",
        sourceRegisterVersion: "source-register@1",
        carriedForward: false,
        freshnessState: "unavailable",
      },
    ],
    providerAttributions: [],
    resources: resources.map((resource) => ({
      resourceType: "model" as const,
      resourceId: resource.resource_id,
      contentHash: resource.content_hash as `sha256:${string}`,
    })),
    searchDocuments,
    vectors,
    chunks: [
      {
        kind: "resources",
        ordinal: 0,
        firstKey: first,
        lastKey: last,
        itemCount: resources.length,
        contentHash: HASH,
      },
      {
        kind: "exact_search",
        ordinal: 0,
        firstKey: first,
        lastKey: last,
        itemCount: resources.length,
        contentHash: HASH,
      },
      {
        kind: "vectors",
        ordinal: 0,
        firstKey: first,
        lastKey: last,
        itemCount: resources.length,
        contentHash: HASH,
      },
    ],
    bundleHash: OTHER_HASH,
  });
  return {
    manifest,
    resources,
    historyRows: historyRows ?? defaultHistory(modelSources),
  };
}

async function rejects(
  mutate: (input: ModelSlugProjectionInput) => ModelSlugProjectionInput,
  error = /slug|history|projection|resource|input/u,
) {
  const input = await fixture();
  await expect(projectModelSlugProjection(mutate(input))).rejects.toThrow(
    error,
  );
}

describe("trusted publication Model slug projection (DATA-001, API-002, PRIV-006)", () => {
  it("projects a rename into one current and one historical mapping with deterministic hashes (CT-DATA-001 stable public slug rename determinism)", async () => {
    const projection = await projectModelSlugProjection(await fixture());

    expect(() => {
      assertModelSlugProjection(projection);
    }).not.toThrow();
    expect(projection).toMatchObject({
      publicationBoundaryMs: PUBLICATION_BOUNDARY_MS,
      projectionVersion: MODEL_SLUG_PROJECTION_VERSION,
      modelCount: 1,
      sourceHistoryCount: 2,
      mappingCount: 2,
      currentMappingCount: 1,
      historicalMappingCount: 1,
      mappings: [
        {
          modelId: id("mdl", 1),
          projectionVersion: MODEL_SLUG_PROJECTION_VERSION,
          resolution: "current",
          slug: "current-model",
        },
        {
          modelId: id("mdl", 1),
          projectionVersion: MODEL_SLUG_PROJECTION_VERSION,
          resolution: "historical",
          slug: "old-current-model",
        },
      ],
    });
    expect(projection.sourceHistoryHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(projection.mappingInventoryHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(projection.sourceHistoryHash).toBe(
      "sha256:c23ec58d747e48631f1261872a393e803ebb24029dcd640be7089cd4bf165947",
    );
    expect(projection.mappingInventoryHash).toBe(
      "sha256:3ebe8861f1cd56c0e060b3da0d75962b771328ff02dd9df8ade59de315bae88a",
    );
    expect(() => {
      assertModelSlugProjection({ ...projection });
    }).toThrow(/not trusted/u);
  });

  it("is independent of resource and history input order", async () => {
    const input = await fixture([
      { sequence: 2, slug: "z-model" },
      { sequence: 1, slug: "a-model" },
    ]);
    const forward = await projectModelSlugProjection(input);
    const reversed = await projectModelSlugProjection({
      ...input,
      resources: [...input.resources].reverse(),
      historyRows: [...input.historyRows].reverse(),
    });
    expect(reversed.mappings).toEqual(forward.mappings);
    expect(reversed.sourceHistoryHash).toBe(forward.sourceHistoryHash);
    expect(reversed.mappingInventoryHash).toBe(forward.mappingInventoryHash);
  });

  it.each(["inactive", "unavailable", "unknown"])(
    "includes a Model whose canonical status is %s",
    async (status) => {
      const projection = await projectModelSlugProjection(
        await fixture([{ sequence: 1, slug: "status-model", status }]),
      );
      expect(projection.mappings.map((mapping) => mapping.slug)).toEqual([
        "old-status-model",
        "status-model",
      ]);
    },
  );

  it.each(["unknown", "not_applicable", "unavailable"] as const)(
    "rejects a %s current slug Fact",
    async (state) => {
      const input = await fixture([
        {
          sequence: 1,
          slug: "ignored",
          overrides: { slug: nonKnown(state) },
        },
      ]);
      await expect(projectModelSlugProjection(input)).rejects.toThrow(
        /slug|contract/u,
      );
    },
  );

  it.each(["a", "a".repeat(128)])(
    "accepts a known current slug at the contract boundary %s",
    async (slug) => {
      const rows = [
        history(
          1,
          1,
          "prior",
          PUBLICATION_BOUNDARY_MS - 2_000,
          PUBLICATION_BOUNDARY_MS - 1_000,
        ),
        history(2, 1, slug, PUBLICATION_BOUNDARY_MS - 1_000, null),
      ];
      const projection = await projectModelSlugProjection(
        await fixture([{ sequence: 1, slug }], rows),
      );
      expect(projection.mappings).toContainEqual(
        expect.objectContaining({ resolution: "current", slug }),
      );
    },
  );

  it.each([
    "",
    "Uppercase",
    "two--separators",
    "-leading",
    "trailing-",
    "nonascii-é",
    "under_score",
    "percent%2dencoded",
    "a".repeat(129),
  ])("rejects malformed canonical slug %j", async (slug) => {
    const input = await fixture([{ sequence: 1, slug }]);
    await expect(projectModelSlugProjection(input)).rejects.toThrow(
      /slug|contract/u,
    );
  });

  it("rejects malformed history slugs", async () => {
    for (const slug of [
      "",
      "Uppercase",
      "two--separators",
      "-leading",
      "trailing-",
      "nonascii-é",
      "under_score",
      "percent%2dencoded",
      "a".repeat(129),
    ]) {
      await rejects((input) => ({
        ...input,
        historyRows: input.historyRows.map((row, index) =>
          index === 0 ? { ...row, slug } : row,
        ),
      }));
    }
  });

  it("rejects current/current collisions across Models", async () => {
    const input = await fixture([
      { sequence: 1, slug: "shared" },
      { sequence: 2, slug: "shared" },
    ]);
    await expect(projectModelSlugProjection(input)).rejects.toThrow(
      /collision|slug/u,
    );
  });

  it("rejects current/history collisions across Models", async () => {
    const models = [
      { sequence: 1, slug: "shared" },
      { sequence: 2, slug: "other" },
    ] as const;
    const rows = defaultHistory(models).map((row) =>
      row.resource_id === id("mdl", 2) && row.valid_to_ms !== null
        ? { ...row, slug: "shared" }
        : row,
    );
    const input = await fixture(models, rows);
    await expect(projectModelSlugProjection(input)).rejects.toThrow(
      /collision|slug/u,
    );
  });

  it("rejects history/history collisions across Models", async () => {
    const models = [
      { sequence: 1, slug: "first" },
      { sequence: 2, slug: "second" },
    ] as const;
    const rows = defaultHistory(models).map((row) =>
      row.valid_to_ms === null ? row : { ...row, slug: "shared-old" },
    );
    const input = await fixture(models, rows);
    await expect(projectModelSlugProjection(input)).rejects.toThrow(
      /collision|slug/u,
    );
  });

  it("deduplicates same-target slug recurrence while hashing every source row", async () => {
    const rows = [
      history(
        1,
        1,
        "reused",
        PUBLICATION_BOUNDARY_MS - 4_000,
        PUBLICATION_BOUNDARY_MS - 3_000,
      ),
      history(
        2,
        1,
        "middle",
        PUBLICATION_BOUNDARY_MS - 3_000,
        PUBLICATION_BOUNDARY_MS - 2_000,
      ),
      history(
        3,
        1,
        "reused",
        PUBLICATION_BOUNDARY_MS - 2_000,
        PUBLICATION_BOUNDARY_MS - 1_000,
      ),
      history(4, 1, "current", PUBLICATION_BOUNDARY_MS - 1_000, null),
    ];
    const projection = await projectModelSlugProjection(
      await fixture([{ sequence: 1, slug: "current" }], rows),
    );
    expect(projection).toMatchObject({
      modelCount: 1,
      sourceHistoryCount: 4,
      mappingCount: 3,
      currentMappingCount: 1,
      historicalMappingCount: 2,
    });
    expect(
      projection.mappings.map(({ slug, resolution }) => ({ slug, resolution })),
    ).toEqual([
      { resolution: "current", slug: "current" },
      { resolution: "historical", slug: "middle" },
      { resolution: "historical", slug: "reused" },
    ]);
  });

  it("binds history identity and intervals without changing equal route mappings", async () => {
    const input = await fixture();
    const first = await projectModelSlugProjection(input);
    const changed = await projectModelSlugProjection({
      ...input,
      historyRows: input.historyRows.map((row, index) =>
        index === 0
          ? {
              ...row,
              slug_history_id: id("slg", 99),
              valid_from_ms: row.valid_from_ms - 1_000,
            }
          : row,
      ),
    });
    expect(changed.mappings).toEqual(first.mappings);
    expect(changed.mappingInventoryHash).toBe(first.mappingInventoryHash);
    expect(changed.sourceHistoryHash).not.toBe(first.sourceHistoryHash);
  });

  it("changes the mapping root when route semantics change", async () => {
    const input = await fixture();
    const first = await projectModelSlugProjection(input);
    const changed = await projectModelSlugProjection({
      ...input,
      historyRows: input.historyRows.map((row, index) =>
        index === 0 ? { ...row, slug: "another-old-slug" } : row,
      ),
    });
    expect(changed.sourceHistoryHash).not.toBe(first.sourceHistoryHash);
    expect(changed.mappingInventoryHash).not.toBe(first.mappingInventoryHash);
    expect(changed.mappings).not.toEqual(first.mappings);
  });

  it("binds target canonical content independently of equal slug history", async () => {
    const active = await projectModelSlugProjection(
      await fixture([{ sequence: 1, slug: "content-bound", status: "active" }]),
    );
    const inactive = await projectModelSlugProjection(
      await fixture([
        { sequence: 1, slug: "content-bound", status: "inactive" },
      ]),
    );
    expect(inactive.sourceHistoryHash).toBe(active.sourceHistoryHash);
    expect(inactive.mappings[0]?.targetContentHash).not.toBe(
      active.mappings[0]?.targetContentHash,
    );
    expect(inactive.mappingInventoryHash).not.toBe(active.mappingInventoryHash);
  });

  it("is independent of top-level and row object construction order", async () => {
    const input = await fixture();
    const nominal = await projectModelSlugProjection(input);
    const reverseRecord = <T extends object>(value: T): T =>
      Object.fromEntries(Object.entries(value).reverse()) as T;
    const reordered = reverseRecord({
      historyRows: input.historyRows.map(reverseRecord),
      manifest: input.manifest,
      resources: input.resources.map(reverseRecord),
    });
    const projected = await projectModelSlugProjection(reordered);
    expect(projected.mappings).toEqual(nominal.mappings);
    expect(projected.sourceHistoryHash).toBe(nominal.sourceHistoryHash);
    expect(projected.mappingInventoryHash).toBe(nominal.mappingInventoryHash);
  });

  it("accepts exact half-open interval boundaries", async () => {
    const rows = [
      history(
        1,
        1,
        "oldest",
        PUBLICATION_BOUNDARY_MS - 3_000,
        PUBLICATION_BOUNDARY_MS - 2_000,
      ),
      history(
        2,
        1,
        "older",
        PUBLICATION_BOUNDARY_MS - 2_000,
        PUBLICATION_BOUNDARY_MS - 1_000,
      ),
      history(3, 1, "current", PUBLICATION_BOUNDARY_MS - 1_000, null),
    ];
    const projection = await projectModelSlugProjection(
      await fixture([{ sequence: 1, slug: "current" }], rows),
    );
    expect(projection.historicalMappingCount).toBe(2);
  });

  it("treats an interval ending at the publication boundary as historical", async () => {
    const rows = [
      history(
        1,
        1,
        "prior",
        PUBLICATION_BOUNDARY_MS - 1_000,
        PUBLICATION_BOUNDARY_MS,
      ),
      history(2, 1, "current", PUBLICATION_BOUNDARY_MS, null),
    ];
    const projection = await projectModelSlugProjection(
      await fixture([{ sequence: 1, slug: "current" }], rows),
    );
    expect(
      projection.mappings.map(({ resolution, slug }) => ({ resolution, slug })),
    ).toEqual([
      { resolution: "current", slug: "current" },
      { resolution: "historical", slug: "prior" },
    ]);
  });

  it("rejects overlapping intervals for one Model", async () => {
    const rows = [
      history(
        1,
        1,
        "old-a",
        PUBLICATION_BOUNDARY_MS - 3_000,
        PUBLICATION_BOUNDARY_MS - 1_000,
      ),
      history(
        2,
        1,
        "old-b",
        PUBLICATION_BOUNDARY_MS - 2_000,
        PUBLICATION_BOUNDARY_MS - 500,
      ),
      history(3, 1, "current", PUBLICATION_BOUNDARY_MS - 500, null),
    ];
    await expect(
      projectModelSlugProjection(
        await fixture([{ sequence: 1, slug: "current" }], rows),
      ),
    ).rejects.toThrow(/overlap|history/u);
  });

  it("rejects zero-length intervals", async () => {
    await rejects((input) => ({
      ...input,
      historyRows: input.historyRows.map((row, index) =>
        index === 0 ? { ...row, valid_from_ms: row.valid_to_ms! } : row,
      ),
    }));
  });

  it("rejects current-history disagreement", async () => {
    await rejects((input) => ({
      ...input,
      historyRows: input.historyRows.map((row) =>
        row.valid_to_ms === null ? { ...row, slug: "disagrees" } : row,
      ),
    }));
  });

  it("rejects future and post-boundary history", async () => {
    await rejects((input) => ({
      ...input,
      historyRows: input.historyRows.map((row, index) =>
        index === 0
          ? {
              ...row,
              valid_from_ms: PUBLICATION_BOUNDARY_MS + 1,
              valid_to_ms: PUBLICATION_BOUNDARY_MS + 2,
            }
          : row,
      ),
    }));
    await rejects((input) => ({
      ...input,
      historyRows: input.historyRows.map((row, index) =>
        index === 0
          ? { ...row, valid_to_ms: PUBLICATION_BOUNDARY_MS + 1 }
          : row,
      ),
    }));
  });

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a %s valid_from timestamp", async (_label, timestamp) => {
    await rejects((input) => ({
      ...input,
      historyRows: input.historyRows.map((row, index) =>
        index === 0 ? { ...row, valid_from_ms: timestamp } : row,
      ),
    }));
  });

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a %s valid_to timestamp", async (_label, timestamp) => {
    await rejects((input) => ({
      ...input,
      historyRows: input.historyRows.map((row, index) =>
        index === 0 ? { ...row, valid_to_ms: timestamp } : row,
      ),
    }));
  });

  it("rejects missing, extra, and wrong-type targets", async () => {
    await rejects((input) => ({ ...input, resources: [] }));
    const input = await fixture();
    const unrelated = await fixture([{ sequence: 2, slug: "extra-model" }]);
    await expect(
      projectModelSlugProjection({
        ...input,
        resources: [...input.resources, unrelated.resources[0]!],
      }),
    ).rejects.toThrow(/exactly match|resource/u);
    await rejects((input) => ({
      ...input,
      historyRows: [
        ...input.historyRows,
        history(99, 99, "extra-target", 0, PUBLICATION_BOUNDARY_MS - 1),
      ],
    }));
    await rejects((input) => ({
      ...input,
      historyRows: input.historyRows.map((row, index) =>
        index === 0
          ? ({
              ...row,
              resource_type: "variant",
            } as unknown as ModelSlugHistorySourceRow)
          : row,
      ),
    }));
  });

  it("rejects duplicate resources and history identities", async () => {
    await rejects((input) => ({
      ...input,
      resources: [input.resources[0]!, input.resources[0]!],
    }));
    await rejects((input) => ({
      ...input,
      historyRows: [input.historyRows[0]!, input.historyRows[0]!],
    }));
  });

  it("rejects wrong outer identity, manifest hash, and content hash", async () => {
    await rejects((input) => ({
      ...input,
      resources: input.resources.map((resource) => ({
        ...resource,
        resource_id: id("mdl", 2),
      })),
    }));
    await rejects((input) => ({
      ...input,
      resources: input.resources.map((resource) => ({
        ...resource,
        content_hash: OTHER_HASH,
      })),
    }));
    await rejects((input) => ({
      ...input,
      resources: input.resources.map((resource) => ({
        ...resource,
        resource_json: resource.resource_json.replace(
          id("mdl", 1),
          id("mdl", 2),
        ),
      })),
    }));
  });

  it("enforces model and history-row capacity ceilings before row work", async () => {
    expect(MODEL_SLUG_MAX_MODELS).toBeGreaterThan(0);
    expect(MODEL_SLUG_MAX_HISTORY_ROWS).toBeGreaterThanOrEqual(
      MODEL_SLUG_MAX_MODELS,
    );
    await rejects(
      (input) => ({
        ...input,
        resources: Array.from(
          { length: MODEL_SLUG_MAX_MODELS + 1 },
          () => input.resources[0]!,
        ),
      }),
      /large|limit|models/u,
    );
    await rejects(
      (input) => ({
        ...input,
        historyRows: Array.from(
          { length: MODEL_SLUG_MAX_HISTORY_ROWS + 1 },
          () => input.historyRows[0]!,
        ),
      }),
      /large|limit|history/u,
    );
  });

  it("enforces exact and over-limit resource byte budgets with safe arithmetic", () => {
    expect(
      advanceModelSlugResourceByteBudget(
        MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES - MODEL_SLUG_MAX_RESOURCE_BYTES,
        MODEL_SLUG_MAX_RESOURCE_BYTES,
      ),
    ).toBe(MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES);
    expect(() => {
      advanceModelSlugResourceByteBudget(
        MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES - MODEL_SLUG_MAX_RESOURCE_BYTES + 1,
        MODEL_SLUG_MAX_RESOURCE_BYTES,
      );
    }).toThrow(/large|budget|resource/u);
    expect(() => {
      advanceModelSlugResourceByteBudget(0, MODEL_SLUG_MAX_RESOURCE_BYTES + 1);
    }).toThrow(/large|budget|resource/u);
    expect(() => {
      advanceModelSlugResourceByteBudget(Number.MAX_SAFE_INTEGER, 1);
    }).toThrow(/large|budget|resource/u);

    const exactLengths = Array.from(
      {
        length: Math.floor(
          MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES / MODEL_SLUG_MAX_RESOURCE_BYTES,
        ),
      },
      () => MODEL_SLUG_MAX_RESOURCE_BYTES,
    );
    const remainder =
      MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES -
      exactLengths.length * MODEL_SLUG_MAX_RESOURCE_BYTES;
    if (remainder > 0) exactLengths.push(remainder);
    expect(() => {
      assertModelSlugResourceByteBudget(exactLengths);
    }).not.toThrow();
    expect(() => {
      assertModelSlugResourceByteBudget([
        ...exactLengths.slice(0, -1),
        exactLengths.at(-1)! + 1,
      ]);
    }).toThrow(/large|budget|resource/u);
  });

  it("enforces exact and over-limit source-history encoded-byte budgets", () => {
    const row = history(1, 1, "a", 0, null);
    const rowBytes = advanceModelSlugSourceHistoryInventoryByteBudget(0, row);
    expect(
      advanceModelSlugSourceHistoryInventoryByteBudget(
        MODEL_SLUG_MAX_SOURCE_HISTORY_INVENTORY_BYTES - rowBytes,
        row,
      ),
    ).toBe(MODEL_SLUG_MAX_SOURCE_HISTORY_INVENTORY_BYTES);
    expect(() => {
      advanceModelSlugSourceHistoryInventoryByteBudget(
        MODEL_SLUG_MAX_SOURCE_HISTORY_INVENTORY_BYTES - rowBytes + 1,
        row,
      );
    }).toThrow(/large|budget|history/u);
    expect(() => {
      advanceModelSlugSourceHistoryInventoryByteBudget(
        Number.MAX_SAFE_INTEGER,
        row,
      );
    }).toThrow(/large|budget|history/u);
    expect(
      advanceModelSlugSourceHistoryInventoryByteBudget(0, {
        ...row,
        slug: "é",
      }),
    ).toBe(rowBytes + 1);
    expect(() => {
      initializeModelSlugSourceHistoryInventoryByteBudget(
        MODEL_SLUG_MAX_HISTORY_ROWS,
      );
    }).not.toThrow();
    expect(() => {
      initializeModelSlugSourceHistoryInventoryByteBudget(
        MODEL_SLUG_MAX_HISTORY_ROWS + 1,
      );
    }).toThrow(/large|budget|history/u);
  });

  it("enforces exact and over-limit mapping encoded-byte budgets", () => {
    const mapping: ModelSlugMappingProjection = {
      projectionVersion: MODEL_SLUG_PROJECTION_VERSION,
      slug: "a",
      modelId: id("mdl", 1),
      resolution: "current",
      targetContentHash: HASH,
    };
    const mappingBytes = advanceModelSlugMappingInventoryByteBudget(0, mapping);
    expect(
      advanceModelSlugMappingInventoryByteBudget(
        MODEL_SLUG_MAX_MAPPING_INVENTORY_BYTES - mappingBytes,
        mapping,
      ),
    ).toBe(MODEL_SLUG_MAX_MAPPING_INVENTORY_BYTES);
    expect(() => {
      advanceModelSlugMappingInventoryByteBudget(
        MODEL_SLUG_MAX_MAPPING_INVENTORY_BYTES - mappingBytes + 1,
        mapping,
      );
    }).toThrow(/large|budget|mapping/u);
    expect(() => {
      advanceModelSlugMappingInventoryByteBudget(
        Number.MAX_SAFE_INTEGER,
        mapping,
      );
    }).toThrow(/large|budget|mapping/u);
    expect(
      advanceModelSlugMappingInventoryByteBudget(0, {
        ...mapping,
        slug: "é",
      }),
    ).toBe(mappingBytes + 1);
    expect(() => {
      initializeModelSlugMappingInventoryByteBudget(
        MODEL_SLUG_MAX_HISTORY_ROWS,
      );
    }).not.toThrow();
    expect(() => {
      initializeModelSlugMappingInventoryByteBudget(
        MODEL_SLUG_MAX_HISTORY_ROWS + 1,
      );
    }).toThrow(/large|budget|mapping/u);
  });

  it("rejects accessors and proxies without retaining their values", async () => {
    const input = await fixture();
    let reads = 0;
    const accessor = { ...input.historyRows[0] } as Record<string, unknown>;
    Object.defineProperty(accessor, "slug", {
      enumerable: true,
      get() {
        reads += 1;
        return "visitor-canary";
      },
    });
    await expect(
      projectModelSlugProjection({
        ...input,
        historyRows: [
          accessor as unknown as ModelSlugHistorySourceRow,
          ...input.historyRows.slice(1),
        ],
      }),
    ).rejects.toThrow();
    expect(reads).toBe(0);

    const hostile = new Proxy(input.historyRows[0]!, {
      ownKeys() {
        throw new Error("proxy trap");
      },
    });
    await expect(
      projectModelSlugProjection({
        ...input,
        historyRows: [hostile, ...input.historyRows.slice(1)],
      }),
    ).rejects.toThrow();
  });

  it("rejects sparse, accessor-indexed, extra-key, and symbol-key arrays", async () => {
    const input = await fixture();
    const sparse = new Array<ModelSlugHistorySourceRow>(2);
    sparse[1] = input.historyRows[1]!;
    await expect(
      projectModelSlugProjection({ ...input, historyRows: sparse }),
    ).rejects.toThrow();

    let reads = 0;
    const accessorIndexed = [...input.historyRows];
    Object.defineProperty(accessorIndexed, "0", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return input.historyRows[0];
      },
    });
    await expect(
      projectModelSlugProjection({
        ...input,
        historyRows: accessorIndexed,
      }),
    ).rejects.toThrow();
    expect(reads).toBe(0);

    const extra = [...input.historyRows] as ModelSlugHistorySourceRow[] & {
      extra?: string;
    };
    extra.extra = "unexpected";
    await expect(
      projectModelSlugProjection({ ...input, historyRows: extra }),
    ).rejects.toThrow();

    const symbol = [...input.historyRows];
    Object.defineProperty(symbol, Symbol("unexpected"), { value: true });
    await expect(
      projectModelSlugProjection({ ...input, historyRows: symbol }),
    ).rejects.toThrow();
  });

  it("rejects extra, symbol, non-enumerable, and accessor fields at every record boundary", async () => {
    const input = await fixture();
    const topExtra = { ...input, extra: true };
    await expect(
      projectModelSlugProjection(
        topExtra as unknown as ModelSlugProjectionInput,
      ),
    ).rejects.toThrow();
    const topSymbol = { ...input };
    Object.defineProperty(topSymbol, Symbol("unexpected"), { value: true });
    await expect(projectModelSlugProjection(topSymbol)).rejects.toThrow();

    for (const key of ["historyRows", "resources"] as const) {
      const nonEnumerable = { ...input };
      Object.defineProperty(nonEnumerable, key, {
        value: input[key],
        enumerable: false,
      });
      await expect(projectModelSlugProjection(nonEnumerable)).rejects.toThrow();
    }

    let topReads = 0;
    const topAccessor = { ...input };
    Object.defineProperty(topAccessor, "historyRows", {
      enumerable: true,
      get() {
        topReads += 1;
        return input.historyRows;
      },
    });
    await expect(projectModelSlugProjection(topAccessor)).rejects.toThrow();
    expect(topReads).toBe(0);

    const resourceExtra = { ...input.resources[0], extra: true };
    await expect(
      projectModelSlugProjection({
        ...input,
        resources: [resourceExtra as unknown as ServingResourceClosureRow],
      }),
    ).rejects.toThrow();
    const resourceSymbol = { ...input.resources[0] };
    Object.defineProperty(resourceSymbol, Symbol("unexpected"), {
      value: true,
    });
    await expect(
      projectModelSlugProjection({
        ...input,
        resources: [resourceSymbol as unknown as ServingResourceClosureRow],
      }),
    ).rejects.toThrow();
    const resourceNonEnumerable = { ...input.resources[0] };
    Object.defineProperty(resourceNonEnumerable, "resource_json", {
      value: input.resources[0]!.resource_json,
      enumerable: false,
    });
    await expect(
      projectModelSlugProjection({
        ...input,
        resources: [
          resourceNonEnumerable as unknown as ServingResourceClosureRow,
        ],
      }),
    ).rejects.toThrow();
    let resourceReads = 0;
    const resourceAccessor = { ...input.resources[0] };
    Object.defineProperty(resourceAccessor, "resource_json", {
      enumerable: true,
      get() {
        resourceReads += 1;
        return input.resources[0]!.resource_json;
      },
    });
    await expect(
      projectModelSlugProjection({
        ...input,
        resources: [resourceAccessor as unknown as ServingResourceClosureRow],
      }),
    ).rejects.toThrow();
    expect(resourceReads).toBe(0);

    const historyExtra = { ...input.historyRows[0], extra: true };
    await expect(
      projectModelSlugProjection({
        ...input,
        historyRows: [
          historyExtra as unknown as ModelSlugHistorySourceRow,
          ...input.historyRows.slice(1),
        ],
      }),
    ).rejects.toThrow();
    const historySymbol = { ...input.historyRows[0] };
    Object.defineProperty(historySymbol, Symbol("unexpected"), { value: true });
    await expect(
      projectModelSlugProjection({
        ...input,
        historyRows: [
          historySymbol as unknown as ModelSlugHistorySourceRow,
          ...input.historyRows.slice(1),
        ],
      }),
    ).rejects.toThrow();
    const historyNonEnumerable = { ...input.historyRows[0] };
    Object.defineProperty(historyNonEnumerable, "slug", {
      value: input.historyRows[0]!.slug,
      enumerable: false,
    });
    await expect(
      projectModelSlugProjection({
        ...input,
        historyRows: [
          historyNonEnumerable as unknown as ModelSlugHistorySourceRow,
          ...input.historyRows.slice(1),
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects a many-key hostile record before reading any property descriptor", async () => {
    let descriptorReads = 0;
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          return Array.from(
            { length: 20_000 },
            (_, index) => `hostile-${String(index).padStart(5, "0")}`,
          );
        },
        getOwnPropertyDescriptor() {
          descriptorReads += 1;
          return {
            value: "visitor-canary",
            enumerable: true,
            configurable: true,
            writable: false,
          };
        },
      },
    );
    await expect(
      projectModelSlugProjection(
        hostile as unknown as ModelSlugProjectionInput,
      ),
    ).rejects.toThrow();
    expect(descriptorReads).toBe(0);
  });

  it("returns a recursively immutable trusted result", async () => {
    const projection = await projectModelSlugProjection(await fixture());
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.mappings)).toBe(true);
    for (const mapping of projection.mappings)
      expect(Object.isFrozen(mapping)).toBe(true);

    const original = projection.mappings[0];
    expect(() => {
      (projection.mappings as ModelSlugMappingProjectionForMutation).push(
        original!,
      );
    }).toThrow();
    expect(() => {
      (original as { slug: string }).slug = "mutated";
    }).toThrow();
    expect(projection.mappings[0]?.slug).toBe("current-model");
  });

  it("exposes only the route-safe projection inventory", async () => {
    const projection = await projectModelSlugProjection(await fixture());
    expect(Object.keys(projection).sort()).toEqual([
      "closureHash",
      "currentMappingCount",
      "historicalMappingCount",
      "mappingCount",
      "mappingInventoryHash",
      "mappings",
      "modelCount",
      "projectionVersion",
      "publicationBoundaryMs",
      "publicationId",
      "sourceHistoryCount",
      "sourceHistoryHash",
    ]);
    for (const mapping of projection.mappings)
      expect(Object.keys(mapping).sort()).toEqual([
        "modelId",
        "projectionVersion",
        "resolution",
        "slug",
        "targetContentHash",
      ]);
    expect(JSON.stringify(projection)).not.toMatch(
      /slug_history_id|valid_from_ms|valid_to_ms/u,
    );
  });
});

type ModelSlugMappingProjectionForMutation = Awaited<
  ReturnType<typeof projectModelSlugProjection>
>["mappings"][number][];
