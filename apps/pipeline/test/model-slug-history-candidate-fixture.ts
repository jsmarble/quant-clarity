import {
  acquireModelSlugHistoryCandidate,
  type ModelSlugHistoryPublicationAssembly,
  type TrustedModelSlugHistoryCandidateCapture,
} from "../src/model-slug-history-acquisition.js";
import {
  buildImmutableManifest,
  type ModelSlugHistorySourceRow,
} from "@quant-clarity/publication-core";
import { createModelVariantNameSearchFixture } from "./model-variant-name-search-fixture.js";

export const MODEL_SLUG_HISTORY_FIXTURE_PUBLICATION_ID =
  "pub_81111111-1111-4111-8111-111111111111" as const;
export const MODEL_SLUG_HISTORY_FIXTURE_BOUNDARY_MS = Date.parse(
  "2026-08-03T00:00:00.000Z",
);

type AcquisitionRow = Readonly<Record<string, unknown>>;

export const createModelSlugHistoryCandidateFixture = async (
  historicalSlugCount = 0,
  extraManifestResourceCount = 0,
): Promise<TrustedModelSlugHistoryCandidateCapture> => {
  if (
    !Number.isSafeInteger(historicalSlugCount) ||
    historicalSlugCount < 0 ||
    historicalSlugCount > 49_999
  )
    throw new Error("fixture historical slug count is invalid");
  if (
    !Number.isSafeInteger(extraManifestResourceCount) ||
    extraManifestResourceCount < 0 ||
    extraManifestResourceCount > 150_000
  )
    throw new Error("fixture manifest resource count is invalid");
  const fixture = await createModelVariantNameSearchFixture(
    MODEL_SLUG_HISTORY_FIXTURE_PUBLICATION_ID,
    MODEL_SLUG_HISTORY_FIXTURE_BOUNDARY_MS,
    "Alpha Model",
  );
  const resources = fixture.closureRows.resources.filter(
    (resource) => resource.resource_type === "model",
  );
  const extraResources = Array.from(
    { length: extraManifestResourceCount },
    (_, index) => ({
      resourceType: "model_family" as const,
      resourceId: `fam_${(index + 256)
        .toString(16)
        .padStart(8, "0")}-0000-4000-8000-000000000001`,
      contentHash:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const,
    }),
  );
  const manifestResources = [...fixture.manifest.resources, ...extraResources];
  const manifest =
    extraManifestResourceCount === 0
      ? fixture.manifest
      : await buildImmutableManifest({
          contractVersion: fixture.manifest.contractVersion,
          publicationId: fixture.manifest.publicationId,
          sourceRunId: fixture.manifest.sourceRunId,
          parentPublicationId: fixture.manifest.parentPublicationId,
          generatedAt: fixture.manifest.generatedAt,
          versions: fixture.manifest.versions,
          enabledProviderScopeVersion:
            fixture.manifest.enabledProviderScopeVersion,
          enabledProviderIds: fixture.manifest.enabledProviderIds,
          providerSlices: fixture.manifest.providerSlices,
          providerAttributions: fixture.manifest.providerAttributions,
          resources: manifestResources,
          searchDocuments: fixture.manifest.searchDocuments,
          vectors: fixture.manifest.vectors,
          chunks: [
            {
              kind: "resources",
              ordinal: 0,
              firstKey: "a",
              lastKey: "z",
              itemCount: manifestResources.length,
              contentHash:
                "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            },
            ...fixture.manifest.chunks.filter(
              (chunk) => chunk.kind !== "resources",
            ),
          ],
          bundleHash: fixture.manifest.bundleHash,
        });
  const assembly: ModelSlugHistoryPublicationAssembly = Object.freeze({
    manifest,
    resources,
  });
  const resource = resources[0];
  if (resource === undefined) throw new Error("fixture model is missing");
  const parsed = JSON.parse(resource.resource_json) as {
    slug: { value: string };
  };
  const historyRows: readonly ModelSlugHistorySourceRow[] = Object.freeze([
    ...Array.from({ length: historicalSlugCount }, (_, index) =>
      Object.freeze({
        slug_history_id: `slg_${(index + 1)
          .toString(16)
          .padStart(8, "0")}-0000-4000-8000-000000000001`,
        resource_id: resource.resource_id,
        resource_type: "model" as const,
        slug: `alpha-old-${index.toString(36).padStart(4, "0")}`,
        valid_from_ms: index,
        valid_to_ms: index + 1,
      }),
    ),
    Object.freeze({
      slug_history_id: `slg_${(historicalSlugCount + 1)
        .toString(16)
        .padStart(8, "0")}-0000-4000-8000-000000000001`,
      resource_id: resource.resource_id,
      resource_type: "model" as const,
      slug: parsed.slug.value,
      valid_from_ms: historicalSlugCount,
      valid_to_ms: null,
    }),
  ]);
  const emptySentinelFields = {
    slug_history_id: null,
    resource_id: null,
    resource_type: null,
    slug: null,
    valid_from_ms: null,
    valid_to_ms: null,
  };
  const rows: AcquisitionRow[] = [
    {
      row_kind: "sentinel",
      guard_version: "model-slug-history-guard@1",
      guard_row_count: 1,
      requested_model_count: resources.length,
      canonical_model_count: resources.length,
      source_history_count: historyRows.length,
      ...emptySentinelFields,
    },
    {
      row_kind: "model",
      guard_version: null,
      guard_row_count: null,
      requested_model_count: null,
      canonical_model_count: null,
      source_history_count: null,
      slug_history_id: null,
      resource_id: resource.resource_id,
      resource_type: resource.resource_type,
      slug: parsed.slug.value,
      valid_from_ms: null,
      valid_to_ms: null,
    },
    ...historyRows.map((row) => ({
      row_kind: "history",
      guard_version: null,
      guard_row_count: null,
      requested_model_count: null,
      canonical_model_count: null,
      source_history_count: null,
      ...row,
    })),
  ];
  const database = {
    withSession() {
      return {
        prepare() {
          return {
            bind() {
              return {
                all() {
                  return Promise.resolve({
                    success: true,
                    results: rows,
                    meta: { served_by_primary: true },
                  });
                },
              };
            },
          };
        },
        getBookmark() {
          return "bookmark-private-fixture";
        },
      };
    },
  } as unknown as D1Database;

  return acquireModelSlugHistoryCandidate(database, {
    async withWriterDrain<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    },
    assemblePublication() {
      return Promise.resolve(assembly);
    },
  });
};

export const createModelSlugHistoryCandidateForAssembly = async (
  assembly: ModelSlugHistoryPublicationAssembly,
  historyRows: readonly ModelSlugHistorySourceRow[],
): Promise<TrustedModelSlugHistoryCandidateCapture> => {
  const resources = assembly.resources.filter(
    (resource) => resource.resource_type === "model",
  );
  const canonicalModels = resources.map((resource) => {
    const parsed = JSON.parse(resource.resource_json) as {
      slug: { state: string; value: string | null };
    };
    if (parsed.slug.state !== "known" || parsed.slug.value === null)
      throw new TypeError("fixture Model slug is invalid");
    return {
      resource_id: resource.resource_id,
      resource_type: "model" as const,
      slug: parsed.slug.value,
    };
  });
  const empty = {
    slug_history_id: null,
    resource_id: null,
    resource_type: null,
    slug: null,
    valid_from_ms: null,
    valid_to_ms: null,
  };
  const rows: AcquisitionRow[] = [
    {
      row_kind: "sentinel",
      guard_version: "model-slug-history-guard@1",
      guard_row_count: 1,
      requested_model_count: resources.length,
      canonical_model_count: resources.length,
      source_history_count: historyRows.length,
      ...empty,
    },
    ...canonicalModels.map((model) => ({
      row_kind: "model",
      guard_version: null,
      guard_row_count: null,
      requested_model_count: null,
      canonical_model_count: null,
      source_history_count: null,
      slug_history_id: null,
      ...model,
      valid_from_ms: null,
      valid_to_ms: null,
    })),
    ...historyRows.map((row) => ({
      row_kind: "history",
      guard_version: null,
      guard_row_count: null,
      requested_model_count: null,
      canonical_model_count: null,
      source_history_count: null,
      ...row,
    })),
  ];
  const database = {
    withSession() {
      return {
        prepare() {
          return {
            bind() {
              return {
                all() {
                  return Promise.resolve({
                    success: true,
                    results: rows,
                    meta: { served_by_primary: true },
                  });
                },
              };
            },
          };
        },
        getBookmark() {
          return "bookmark-private-assembly-fixture";
        },
      };
    },
  } as unknown as D1Database;
  return acquireModelSlugHistoryCandidate(database, {
    async withWriterDrain<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    },
    assemblePublication() {
      return Promise.resolve(assembly);
    },
  });
};
