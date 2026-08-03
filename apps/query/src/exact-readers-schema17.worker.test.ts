import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  projectServingSwitchPreflightProofV4,
  projectServingSwitchV4,
  normalizeExactSearchName,
  readProviderModelIdSearchStagingPersistenceV1,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV4,
  type PublicationRecord,
  type ServingSwitchProjectionV4,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";
import type * as PublicationCoreModule from "@quant-clarity/publication-core";
import type { QueryServiceEnvelope } from "@quant-clarity/api-core";

import { applyModelVariantNameSearchStagingV1 } from "../../pipeline/src/model-variant-name-search-staging.js";
import { applyProviderModelIdSearchStagingV1 } from "../../pipeline/src/provider-model-id-search-staging.js";
import { applyProviderSearchStagingV2 } from "../../pipeline/src/provider-search-staging.js";
import { applyReadinessCommitV4 } from "../../pipeline/src/readiness-commit-v4.js";
import { applyServingSwitchV4 } from "../../pipeline/src/serving-switch.js";
import { seedModelVariantNameSearchBuildingPublication } from "../../pipeline/test/model-variant-name-search-fixture.js";
import type * as ModelFixtureModule from "../../pipeline/test/model-variant-name-search-fixture.js";
import {
  createServingV4Fixture,
  sealServingV4Fixture,
  type ServingV4Fixture,
} from "../../pipeline/test/serving-switch-v4-fixture.js";
import { RESOLVE_PUBLICATION_V2_SELECT_SQL } from "./catalog-query-rpc.js";
import {
  MODEL_VARIANT_EXACT_NAME_ELIGIBILITY_SELECT_SQL,
  readModelVariantExactNamePage,
} from "./model-variant-exact-name.js";
import {
  EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
  readMergedExactSearchPage,
} from "./merged-exact-search.js";
import { readProviderExactNamePage } from "./provider-exact-name.js";
import {
  PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL,
  readMergedProviderModelIdExactPage,
  readProviderModelIdExactPage,
} from "./provider-model-id-exact.js";
import {
  RETAINED_HOT_FROM_INDEX,
  RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS,
  RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS,
  RETAINED_HOT_PUBLICATION_WINDOW_MS,
  RETAINED_HOT_ROLLBACK_INDEX,
} from "./retained-hot-publication.js";

vi.mock("@quant-clarity/publication-core", async (importOriginal) => {
  const actual = await importOriginal<typeof PublicationCoreModule>();
  const projectProviderModelIdSearchProjection: typeof actual.projectProviderModelIdSearchProjection =
    (input) => {
      const targetIds = new Set(
        input.resources
          .filter((resource) => resource.resource_type === "offering")
          .map((resource) => {
            const value = JSON.parse(resource.resource_json) as {
              model_resource_id?: unknown;
            };
            return value.model_resource_id;
          })
          .filter((value): value is string => typeof value === "string"),
      );
      return actual.projectProviderModelIdSearchProjection({
        ...input,
        resources: input.resources.filter(
          (resource) =>
            resource.resource_type === "offering" ||
            ((resource.resource_type === "model" ||
              resource.resource_type === "variant") &&
              targetIds.has(resource.resource_id)),
        ),
      });
    };
  return { ...actual, projectProviderModelIdSearchProjection };
});

vi.mock(
  "../../pipeline/test/model-variant-name-search-fixture.js",
  async (importOriginal) => {
    const actual = await importOriginal<typeof ModelFixtureModule>();
    const createFixture: typeof actual.createModelVariantNameSearchFixture = (
      ...args
    ) => {
      const [
        publicationId,
        generatedAtMs,
        ,
        ,
        availableProvider = false,
        ,
        neutrality = {},
      ] = args;
      return actual.createModelVariantNameSearchFixture(
        publicationId,
        generatedAtMs,
        ["Schema 17\u0000Model", "Beta Variant"],
        true,
        availableProvider,
        ["active", "active"],
        neutrality,
      );
    };
    return { ...actual, createModelVariantNameSearchFixture: createFixture };
  },
);

const PUBLICATION = "pub_17171717-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_17171717-0000-4000-8000-000000000002" as const;
const PUBLICATION_C = "pub_17171717-0000-4000-8000-000000000003" as const;
const NOW = Math.floor(Date.now() / 1_000) * 1_000;
const GENERATED_AT = NOW - 20 * 60_000;
const SWITCHED_AT = NOW - 60_000;
let fixture: ServingV4Fixture;

const artifactProof = (value: ServingV4Fixture, switchedAtMs: number) => ({
  environment: "local" as const,
  observedAtMs: switchedAtMs - 1_000,
  maximumAgeMs: 60 * 60 * 1_000,
  ftsBuildVersion: "fts5-unicode61@1",
  ftsSourceDocumentCount: value.base.manifest.searchDocuments.length,
  ftsIndexDocumentCount: value.base.manifest.searchDocuments.length,
  ftsSourceInventoryHash: value.base.manifest.exactSearchInventoryHash,
  ftsExactParity: true as const,
  archiveBundleHash: value.base.manifest.bundleHash,
  archiveImmutable: true as const,
  vectorNamespace: value.base.manifest.publicationId,
  vectorDocumentCount: value.base.manifest.vectors.length,
  vectorVerifiedDocumentCount: value.base.manifest.vectors.length,
  vectorInventoryHash: value.base.manifest.vectorInventoryHash,
  vectorVisibilityProbeVersion: "vector-visibility@1",
  vectorMutationId: `query-schema17-${value.base.manifest.publicationId}`,
  vectorAllIdsPresent: true as const,
  vectorAllNamespacesMatch: true as const,
  vectorQueryable: true as const,
  probeSetVersion: "search-gold@4" as const,
  integrityPassed: true as const,
  exactSearchPassed: true as const,
  semanticSearchPassed: true as const,
  structuredFilterPassed: true as const,
  neutralityPassed: true as const,
  versionIsolationPassed: true as const,
});

const activation = async (
  value: ServingV4Fixture,
  switchedAtMs = SWITCHED_AT,
  currentHead: StoredPublicationHead | null = null,
  currentActive: PublicationRecord | null = null,
): Promise<ServingSwitchProjectionV4> => {
  const provider = readProviderSearchStagingPersistenceV2(
    value.providerStaging,
  );
  const providerModel = readProviderModelIdSearchStagingPersistenceV1(
    value.providerModelIdStaging,
  );
  const readiness = readServingReadinessCommitPersistenceV4(
    value.readinessCommit,
  );
  const generation = (currentHead?.generation ?? 0) + 1;
  const preflight = await projectServingSwitchPreflightProofV4({
    manifest: value.base.manifest,
    providerProof: value.providerProof,
    modelVariantNameProof: value.modelProof,
    providerModelIdProof: value.providerModelIdProof,
    readinessProof: value.readinessProof,
    context: {
      switchId: `publication-switch|activate|${String(generation)}|${value.base.manifest.publicationId}|${value.base.manifest.closureHash}`,
      action: "activate",
      expectedPriorGeneration: currentHead?.generation ?? 0,
      expectedPriorRollbackCandidatePublicationId:
        currentHead?.rollbackCandidatePublicationId ?? null,
      expectedPriorSwitchedAtMs:
        currentHead === null ? null : Date.parse(currentHead.switchedAt),
      newGeneration: generation,
      fromPublicationId: currentActive?.publicationId ?? null,
      fromClosureHash: currentActive?.closureHash ?? null,
      toPublicationId: value.base.manifest.publicationId,
      toClosureHash: value.base.manifest.closureHash,
      switchedAtMs,
    },
    artifactProof: artifactProof(value, switchedAtMs),
  });
  return projectServingSwitchV4({
    preflight,
    target: publicationRecord(value),
    currentHead,
    currentActive,
    authorizedBy: {
      kind: "pipeline",
      identityId: "pipeline.query-schema17-reader",
    },
    closureRows: value.base.closureRows,
    persistedSeal: value.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: value.base.persistence.rows,
    persistedProviderModelIdRows: providerModel.rows,
    persistedReceiptRows: readiness.receiptRows,
    persistedAttestation: readiness.attestation,
  });
};

const publicationRecord = (
  value: ServingV4Fixture,
  state: PublicationRecord["state"] = "ready",
  firstActivatedAt: string | null = null,
  lastHeadReferencedAt: string | null = firstActivatedAt,
): PublicationRecord => {
  const readiness = readServingReadinessCommitPersistenceV4(
    value.readinessCommit,
  );
  return {
    publicationId: value.base.manifest.publicationId,
    closureHash: value.base.manifest.closureHash,
    state,
    generatedAt: value.base.manifest.generatedAt,
    readyAt: new Date(readiness.transition.ready_at_ms).toISOString(),
    firstActivatedAt,
    lastHeadReferencedAt,
  };
};

const publish = async (value: ServingV4Fixture): Promise<void> => {
  await seedModelVariantNameSearchBuildingPublication(
    env.SERVING_DB,
    value.base,
  );
  await applyProviderSearchStagingV2(env.SERVING_DB, value.providerStaging);
  await applyModelVariantNameSearchStagingV1(
    env.SERVING_DB,
    value.base.staging,
  );
  await applyProviderModelIdSearchStagingV1(
    env.SERVING_DB,
    value.providerModelIdStaging,
  );
  await sealServingV4Fixture(env.SERVING_DB, value);
  await applyReadinessCommitV4(env.SERVING_DB, value.readinessCommit);
};

const rpcEnvelope = (
  publicationId: string,
  query: string,
): QueryServiceEnvelope => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "local",
  operation: { kind: "search" },
  publicationId,
  filters: {},
  sort: ["relevance", "stable_id"],
  limit: 20,
  continuation: null,
  searchPlan: {
    kind: "exact_structured",
    query,
    filters: {},
    limit: 20,
    semanticCandidates: 0,
    semanticCalls: 0,
    semanticDegraded: "disabled",
  },
});

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
  fixture = await createServingV4Fixture(PUBLICATION, GENERATED_AT, [
    { rawProviderModelId: "\u0000" },
    { rawProviderModelId: "\u0000", status: "inactive", stale: true },
    { rawProviderModelId: "   ", status: "inactive", stale: true },
    { rawProviderModelId: "Accounts/Alpha" },
    { rawProviderModelId: "ACCOUNTS/ALPHA", status: "unavailable" },
    { rawProviderModelId: "ACCOUNTS/ALPHA" },
    { rawProviderModelId: "Schema 17\u0000Model" },
    { rawProviderModelId: "Independent/Active", providerSequence: 2 },
    {
      rawProviderModelId: "Independent/Stale",
      providerSequence: 3,
      stale: true,
    },
    {
      rawProviderModelId: "Independent/Inactive",
      providerSequence: 4,
      status: "inactive",
    },
    {
      rawProviderModelId: "Independent/Unknown",
      providerSequence: 5,
      status: null,
    },
  ]);
  await publish(fixture);
  await applyServingSwitchV4(env.SERVING_DB, await activation(fixture));
});

describe("schema-1.8 current exact readers (SRCH-002, SRCH-006, SRCH-009, QA-005, QA-006)", () => {
  it("orders normalized-name BLOBs by unsigned UTF-8 bytes across BMP and supplementary planes", async () => {
    const bmp = new TextEncoder().encode("\uE000");
    const supplementary = new TextEncoder().encode("\u{10000}");
    const result = await env.SERVING_DB.prepare(
      `SELECT label
       FROM (
         SELECT 'supplementary' AS label, ?1 AS normalized_name_utf8
         UNION ALL
         SELECT 'bmp' AS label, ?2 AS normalized_name_utf8
       )
       ORDER BY normalized_name_utf8 ASC`,
    )
      .bind(supplementary, bmp)
      .all();
    expect(result.results).toEqual([
      { label: "bmp" },
      { label: "supplementary" },
    ]);
  });

  it("selects the real v4 head and returns canonical provider facts without admitting NUL", async () => {
    await expect(
      env.SERVING_DB.prepare(
        "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
      ).first(),
    ).resolves.toEqual({ schema_version: "1.9.0" });
    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: null,
      }),
    ).resolves.toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION,
    });

    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "  fixture provider  ",
      }),
    ).resolves.toMatchObject({
      publicationId: PUBLICATION,
      nextAfterProviderId: null,
      results: [
        {
          tier: 3,
          resourceType: "provider",
          matchKind: "provider_name",
          semanticDegraded: "disabled",
          displayName: { state: "known", value: "Fixture Provider" },
        },
      ],
    });
    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Fixture\u0000Provider",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("round-trips model NUL bytes and preserves canonical collision ordering and pagination", async () => {
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Schema 17\u0000Model",
        recordType: null,
        afterResourceId: null,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      publicationId: PUBLICATION,
      nextAfterResourceId: null,
      results: [
        {
          tier: 1,
          resourceType: "model",
          resourceId: "mdl_00000001-0000-4000-8000-000000000001",
          matchKind: "canonical_name",
          semanticDegraded: "disabled",
          displayName: { state: "known", value: "Schema 17\u0000Model" },
        },
      ],
    });

    const first = await readModelVariantExactNamePage(env.SERVING_DB, {
      publicationId: PUBLICATION,
      query: "beta variant",
      recordType: null,
      afterResourceId: null,
      limit: 1,
    });
    expect(first.results.map((result) => result.resourceId)).toEqual([
      "mdl_00000002-0000-4000-8000-000000000001",
    ]);
    expect(first.nextAfterResourceId).toBe(
      "mdl_00000002-0000-4000-8000-000000000001",
    );
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "beta variant",
        recordType: null,
        afterResourceId: first.nextAfterResourceId,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      nextAfterResourceId: null,
      results: [
        {
          resourceType: "variant",
          resourceId: "var_00000001-0000-4000-8000-000000000001",
          matchKind: "canonical_name",
          displayName: { state: "known", value: "Beta Variant" },
        },
      ],
    });
  });

  it("reads a canonical target through the schema-1.7 provider-model-ID BLOB indexes", async () => {
    const persisted = readProviderModelIdSearchStagingPersistenceV1(
      fixture.providerModelIdStaging,
    );
    const first = persisted.rows[0];
    if (first === undefined)
      throw new Error("provider-model-ID fixture missing");
    const query = new TextDecoder().decode(
      new Uint8Array(first.raw_provider_model_id_utf8),
    );
    await expect(
      readProviderModelIdExactPage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query,
        providerId: null,
        recordType: null,
        continuation: null,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      publicationId: PUBLICATION,
      nextContinuation: null,
      results: [
        {
          tier: 2,
          resourceType: first.target_resource_type,
          resourceId: first.target_resource_id,
          matchKind: "provider_model_id",
          semanticDegraded: "disabled",
          displayName: { state: "known" },
        },
      ],
    });
  });

  it("proves normalized-only dedupe, eligibility, and same-witness filters in real D1", async () => {
    const encode = (value: string): Uint8Array =>
      new TextEncoder().encode(value);
    const candidateRows = async (query: string) =>
      env.SERVING_DB.prepare(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL)
        .bind(
          PUBLICATION,
          encode(query),
          encode(normalizeExactSearchName(query)),
          null,
          null,
          -1,
          new Uint8Array(),
          "",
          21,
          1_048_576,
          0,
          0,
          null,
        )
        .all();

    const normalizedWitnesses = await env.SERVING_DB.prepare(
      `SELECT
         count(*) AS total_count,
         sum(CASE
           WHEN json_extract(resource.resource_json, '$.status.state') = 'known'
            AND json_extract(resource.resource_json, '$.status.value') = 'active'
            AND json_extract(resource.resource_json, '$.stale') = 0
           THEN 1 ELSE 0 END) AS eligible_count
       FROM publication_provider_model_id_search_document AS document
       JOIN publication_resource AS resource
         ON resource.publication_id = document.publication_id
        AND resource.resource_type = 'offering'
        AND resource.resource_id = document.offering_id
       WHERE document.publication_id = ?1
         AND document.normalized_provider_model_id_utf8 = ?2`,
    )
      .bind(PUBLICATION, encode(normalizeExactSearchName("accounts/alpha")))
      .first();
    expect(normalizedWitnesses).toEqual({
      total_count: 3,
      eligible_count: 2,
    });

    const normalizedOnly = await candidateRows("accounts/alpha");
    expect(normalizedOnly.results).toHaveLength(2);
    expect(normalizedOnly.results[1]).toMatchObject({
      row_kind: "candidate",
      match_mode: 1,
      offering_id: "off_00000004-0000-4000-8000-000000000001",
      target_resource_type: "model",
    });

    const rawWithExcludedDuplicate = await candidateRows("\u0000");
    expect(rawWithExcludedDuplicate.results).toHaveLength(2);
    expect(rawWithExcludedDuplicate.results[1]).toMatchObject({
      row_kind: "candidate",
      match_mode: 0,
      offering_id: "off_00000001-0000-4000-8000-000000000001",
    });
    const rawWitnesses = await env.SERVING_DB.prepare(
      `SELECT
         count(*) AS total_count,
         sum(CASE
           WHEN json_extract(resource.resource_json, '$.status.state') = 'known'
            AND json_extract(resource.resource_json, '$.status.value') = 'active'
            AND json_extract(resource.resource_json, '$.stale') = 0
           THEN 1 ELSE 0 END) AS eligible_count
       FROM publication_provider_model_id_search_document AS document
       JOIN publication_resource AS resource
         ON resource.publication_id = document.publication_id
        AND resource.resource_type = 'offering'
        AND resource.resource_id = document.offering_id
       WHERE document.publication_id = ?1
         AND document.raw_provider_model_id_utf8 = ?2`,
    )
      .bind(PUBLICATION, encode("\u0000"))
      .first();
    expect(rawWitnesses).toEqual({ total_count: 2, eligible_count: 1 });

    const persisted = readProviderModelIdSearchStagingPersistenceV1(
      fixture.providerModelIdStaging,
    );
    const providerId = persisted.rows[0]?.provider_id;
    if (providerId === undefined) throw new Error("provider fixture missing");
    const eligibilityPlan = await env.SERVING_DB.prepare(
      `EXPLAIN QUERY PLAN ${MODEL_VARIANT_EXACT_NAME_ELIGIBILITY_SELECT_SQL}`,
    )
      .bind(
        PUBLICATION,
        encode(normalizeExactSearchName("Schema 17\u0000Model")),
        null,
        "",
        1_048_576,
        21,
        null,
        providerId,
      )
      .all<{ detail: string }>();
    expect(
      eligibilityPlan.results.map((row) => row.detail).join("\n"),
    ).toContain("publication_provider_model_id_eligibility_idx");
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Schema 17\u0000Model",
        recordType: null,
        eligibilityProviderId: providerId,
        afterResourceId: null,
        limit: 20,
      }),
    ).resolves.toMatchObject({ results: [{ resourceType: "model" }] });
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Beta Variant",
        recordType: null,
        eligibilityProviderId: providerId,
        afterResourceId: null,
        limit: 20,
      }),
    ).resolves.toMatchObject({ results: [] });
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Schema 17\u0000Model",
        recordType: null,
        eligibilityProviderId: "prv_99999999-9999-4999-8999-999999999999",
        afterResourceId: null,
        limit: 20,
      }),
    ).resolves.toMatchObject({ results: [] });
    const base = {
      publicationId: PUBLICATION,
      query: "accounts/alpha",
      continuation: null,
      limit: 20,
    } as const;
    await expect(
      readProviderModelIdExactPage(env.SERVING_DB, {
        ...base,
        providerId,
        recordType: "model",
      }),
    ).resolves.toMatchObject({
      matchModes: ["normalized"],
      results: [{ resourceType: "model" }],
    });
    await expect(
      readProviderModelIdExactPage(env.SERVING_DB, {
        ...base,
        providerId: "prv_99999999-9999-4999-8999-999999999999",
        recordType: "model",
      }),
    ).resolves.toMatchObject({ results: [], matchModes: [] });
    await expect(
      readProviderModelIdExactPage(env.SERVING_DB, {
        ...base,
        providerId,
        recordType: "variant",
      }),
    ).resolves.toMatchObject({ results: [], matchModes: [] });
    await expect(
      readMergedProviderModelIdExactPage(env.SERVING_DB, {
        ...base,
        providerId: null,
        eligibilityProviderId: providerId,
        recordType: "model",
      }),
    ).resolves.toMatchObject({
      matchModes: ["normalized"],
      results: [{ resourceType: "model" }],
    });
  });

  it("merges exact tiers and serves the merged RPC through one pinned workerd session", async () => {
    const preparedSql: string[] = [];
    const countedDatabase = {
      prepare: (sql: string) => {
        preparedSql.push(sql);
        return env.SERVING_DB.prepare(sql);
      },
    };
    const direct = await readMergedExactSearchPage(countedDatabase, {
      publicationId: PUBLICATION,
      query: "\u0000",
      recordType: null,
      eligibilityProviderId: null,
      continuation: null,
      limit: 20,
    });
    expect(preparedSql).toHaveLength(3);
    expect(preparedSql.every((sql) => /^\s*(?:WITH|SELECT)\b/u.test(sql))).toBe(
      true,
    );
    expect(direct).toMatchObject({
      publicationId: PUBLICATION,
      semanticDegraded: "disabled",
      nextContinuation: null,
      results: [
        {
          tierMarker: EXACT_PROVIDER_MODEL_ID_RAW_MARKER,
          resourceType: "model",
          matchKind: "provider_model_id",
        },
      ],
    });

    preparedSql.length = 0;
    const deduplicated = await readMergedExactSearchPage(countedDatabase, {
      publicationId: PUBLICATION,
      query: "Schema 17\u0000Model",
      recordType: null,
      eligibilityProviderId: null,
      continuation: null,
      limit: 20,
    });
    expect(deduplicated.results).toHaveLength(1);
    expect(deduplicated.results[0]).toMatchObject({
      tierMarker: "exact-v1:c",
      resourceId: "mdl_00000001-0000-4000-8000-000000000001",
      matchKind: "canonical_name",
    });
    expect(preparedSql).toHaveLength(2);

    const selected = await exports.CatalogQueryService.resolvePublicationV1({
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "local",
      requestedPublicationId: null,
    });
    if (selected.outcome !== "selected")
      throw new Error("publication selection failed");
    await expect(
      exports.CatalogQueryService.readMergedExactSearchV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: selected.bookmark,
        envelope: {
          version: 1,
          audience: "quantclarity-catalog-query-v1",
          environment: "local",
          operation: { kind: "search" },
          publicationId: PUBLICATION,
          filters: {},
          sort: ["relevance", "stable_id"],
          limit: 20,
          continuation: null,
          searchPlan: {
            kind: "exact_structured",
            query: "\u0000",
            filters: {},
            limit: 20,
            semanticCandidates: 0,
            semanticCalls: 0,
            semanticDegraded: "disabled",
          },
        },
      }),
    ).resolves.toMatchObject({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [{ tierMarker: EXACT_PROVIDER_MODEL_ID_RAW_MARKER }],
      },
    });
  });

  it("uses an independent provider witness and rejects stale, inactive, and unknown witnesses", async () => {
    const providerA = "prv_00000001-0000-4000-8000-000000000001";
    const providerB = "prv_00000002-0000-4000-8000-000000000001";
    const ineligibleProviders = [
      "prv_00000003-0000-4000-8000-000000000001",
      "prv_00000004-0000-4000-8000-000000000001",
      "prv_00000005-0000-4000-8000-000000000001",
    ] as const;
    const input = {
      publicationId: PUBLICATION,
      query: "accounts/alpha",
      providerId: null,
      recordType: "model" as const,
      continuation: null,
      limit: 20,
    };
    await expect(
      env.SERVING_DB.prepare(
        `SELECT json_extract(resource_json, '$.cataloged_provider_count.value') AS provider_count
         FROM publication_resource
         WHERE publication_id = ?1
           AND resource_type = 'model'
           AND resource_id = 'mdl_00000001-0000-4000-8000-000000000001'`,
      )
        .bind(PUBLICATION)
        .first(),
    ).resolves.toEqual({ provider_count: 2 });
    const matchingProvider = await readMergedProviderModelIdExactPage(
      env.SERVING_DB,
      { ...input, eligibilityProviderId: providerA },
    );
    const independentProvider = await readMergedProviderModelIdExactPage(
      env.SERVING_DB,
      { ...input, eligibilityProviderId: providerB },
    );
    expect(independentProvider.results).toEqual(matchingProvider.results);
    expect(independentProvider).toMatchObject({
      matchModes: ["normalized"],
      results: [{ resourceType: "model", matchKind: "provider_model_id" }],
    });
    for (const eligibilityProviderId of ineligibleProviders) {
      await expect(
        readMergedProviderModelIdExactPage(env.SERVING_DB, {
          ...input,
          eligibilityProviderId,
        }),
      ).resolves.toMatchObject({ results: [], matchModes: [] });
    }

    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Schema 17\u0000Model",
        recordType: "model",
        eligibilityProviderId: providerB,
        afterResourceId: null,
        limit: 20,
      }),
    ).resolves.toMatchObject({ results: [{ resourceType: "model" }] });
    await expect(
      readModelVariantExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION,
        query: "Schema 17\u0000Model",
        recordType: "model",
        eligibilityProviderId: ineligibleProviders[0],
        afterResourceId: null,
        limit: 20,
      }),
    ).resolves.toMatchObject({ results: [] });
  });

  it("retains a displaced rollback candidate across A-to-B-to-C for v2 and fails closed after retention", async () => {
    const fixtureB = await createServingV4Fixture(
      PUBLICATION_B,
      NOW - 15 * 60_000,
    );
    const fixtureC = await createServingV4Fixture(
      PUBLICATION_C,
      NOW - 10 * 60_000,
    );
    await publish(fixtureB);
    await publish(fixtureC);

    const firstActivatedAtA = new Date(SWITCHED_AT).toISOString();
    const headA: StoredPublicationHead = {
      activePublicationId: PUBLICATION,
      rollbackCandidatePublicationId: null,
      switchedAt: firstActivatedAtA,
      generation: 1,
    };
    const switchedAtB = NOW - 50_000;
    await applyServingSwitchV4(
      env.SERVING_DB,
      await activation(
        fixtureB,
        switchedAtB,
        headA,
        publicationRecord(fixture, "active", firstActivatedAtA),
      ),
    );

    const requiredAvailableUntilMs = NOW + 5 * 60_000;
    await expect(
      exports.CatalogQueryService.resolvePublicationV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION,
        requiredAvailableUntilMs,
      }),
    ).resolves.toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs,
    });

    const firstActivatedAtB = new Date(switchedAtB).toISOString();
    const headB: StoredPublicationHead = {
      activePublicationId: PUBLICATION_B,
      rollbackCandidatePublicationId: PUBLICATION,
      switchedAt: firstActivatedAtB,
      generation: 2,
    };
    const switchedAtC = NOW - 40_000;
    await applyServingSwitchV4(
      env.SERVING_DB,
      await activation(
        fixtureC,
        switchedAtC,
        headB,
        publicationRecord(fixtureB, "active", firstActivatedAtB),
      ),
    );

    const plan = await env.SERVING_DB.prepare(
      `EXPLAIN QUERY PLAN ${RESOLVE_PUBLICATION_V2_SELECT_SQL}`,
    )
      .bind(PUBLICATION, requiredAvailableUntilMs)
      .all<{ detail: string }>();
    const planDetails = plan.results.map((row) => row.detail).join("\n");
    expect(planDetails).toContain(RETAINED_HOT_FROM_INDEX);
    expect(planDetails).toContain(RETAINED_HOT_ROLLBACK_INDEX);

    const retained = await exports.CatalogQueryService.resolvePublicationV2({
      version: 2,
      audience: "quantclarity-catalog-query-v1",
      environment: "local",
      requestedPublicationId: PUBLICATION,
      requiredAvailableUntilMs,
    });
    expect(retained).toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs,
    });
    if (retained.outcome !== "selected")
      throw new Error("retained publication selection failed");
    await expect(
      exports.CatalogQueryService.readMergedExactSearchV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: retained.bookmark,
        requiredAvailableUntilMs,
        envelope: rpcEnvelope(PUBLICATION, "Schema 17\u0000Model"),
      }),
    ).resolves.toMatchObject({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [{ tierMarker: "exact-v1:c" }],
      },
    });

    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION,
      }),
    ).resolves.toEqual({
      outcome: "publication_expired",
      currentPublicationId: PUBLICATION_C,
    });
    await expect(
      exports.CatalogQueryService.readMergedExactSearchV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: retained.bookmark,
        envelope: rpcEnvelope(PUBLICATION, "Schema 17\u0000Model"),
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    await expect(
      exports.CatalogQueryService.resolvePublicationV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION,
        requiredAvailableUntilMs:
          NOW + RETAINED_HOT_PUBLICATION_MAX_HORIZON_MS + 60_000,
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    await expect(
      exports.CatalogQueryService.readMergedExactSearchV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: retained.bookmark,
        requiredAvailableUntilMs: 0,
        envelope: rpcEnvelope(PUBLICATION, "Schema 17\u0000Model"),
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    // Workerd's SQLite clock cannot be advanced. Rewrite only the two immutable
    // reference facts under test, restoring the canonical guard before reads.
    const immutableTrigger = await env.SERVING_DB.prepare(
      `SELECT sql FROM sqlite_schema
       WHERE type = 'trigger'
         AND name = 'publication_switch_history_immutable_update'`,
    ).first<{ sql: string }>();
    if (immutableTrigger === null)
      throw new Error("switch-history immutable trigger missing");
    const rewriteReferences = async (
      activeDepartureMs: number,
      rollbackDepartureMs: number,
    ): Promise<void> => {
      await env.SERVING_DB.exec(
        "DROP TRIGGER publication_switch_history_immutable_update",
      );
      await env.SERVING_DB.prepare(
        `UPDATE publication_switch_history
         SET switched_at_ms = ?1
         WHERE new_generation = 2 AND from_publication_id = ?2`,
      )
        .bind(activeDepartureMs, PUBLICATION)
        .run();
      await env.SERVING_DB.prepare(
        `UPDATE publication_switch_history
         SET switched_at_ms = ?1
         WHERE new_generation = 3
           AND expected_prior_rollback_candidate_publication_id = ?2`,
      )
        .bind(rollbackDepartureMs, PUBLICATION)
        .run();
      await env.SERVING_DB.prepare(immutableTrigger.sql).run();
    };
    const resolveA = () =>
      exports.CatalogQueryService.resolvePublicationV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION,
        requiredAvailableUntilMs,
      });
    const cutoffReferenceMs =
      requiredAvailableUntilMs +
      RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS -
      RETAINED_HOT_PUBLICATION_WINDOW_MS;

    await rewriteReferences(cutoffReferenceMs - 1, cutoffReferenceMs + 1);
    await expect(resolveA()).resolves.toMatchObject({ outcome: "selected" });
    await rewriteReferences(cutoffReferenceMs + 1, cutoffReferenceMs - 1);
    await expect(resolveA()).resolves.toMatchObject({ outcome: "selected" });
    await rewriteReferences(cutoffReferenceMs, cutoffReferenceMs);
    await expect(resolveA()).resolves.toMatchObject({
      outcome: "publication_expired",
    });
    await rewriteReferences(cutoffReferenceMs + 1, cutoffReferenceMs + 1);
    await expect(resolveA()).resolves.toMatchObject({ outcome: "selected" });
    await rewriteReferences(cutoffReferenceMs - 1, cutoffReferenceMs - 1);
    await expect(
      env.SERVING_DB.prepare(
        `UPDATE publication_switch_history
         SET switched_at_ms = switched_at_ms
         WHERE from_publication_id = ?1`,
      )
        .bind(PUBLICATION)
        .run(),
    ).rejects.toThrow("switch history is append-only");

    await expect(
      exports.CatalogQueryService.resolvePublicationV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION,
        requiredAvailableUntilMs,
      }),
    ).resolves.toEqual({
      outcome: "publication_expired",
      currentPublicationId: PUBLICATION_C,
    });
    const current = await exports.CatalogQueryService.resolvePublicationV2({
      version: 2,
      audience: "quantclarity-catalog-query-v1",
      environment: "local",
      requestedPublicationId: null,
      requiredAvailableUntilMs,
    });
    if (current.outcome !== "selected")
      throw new Error("current publication selection failed");
    expect(current.requiredAvailableUntilMs).toBe(requiredAvailableUntilMs);
    await expect(
      exports.CatalogQueryService.readMergedExactSearchV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: current.bookmark,
        requiredAvailableUntilMs,
        envelope: rpcEnvelope(PUBLICATION, "Schema 17\u0000Model"),
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    await expect(
      exports.CatalogQueryService.readMergedExactSearchV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: retained.bookmark,
        requiredAvailableUntilMs,
        envelope: rpcEnvelope(PUBLICATION, "Schema 17\u0000Model"),
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    await env.SERVING_DB.exec(`DROP INDEX ${RETAINED_HOT_FROM_INDEX}`);
    await expect(
      exports.CatalogQueryService.resolvePublicationV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: null,
        requiredAvailableUntilMs,
      }),
    ).resolves.toEqual({ outcome: "read_failure" });
    await env.SERVING_DB.prepare(
      `CREATE INDEX ${RETAINED_HOT_FROM_INDEX}
      ON publication_switch_history(
        from_publication_id, switched_at_ms DESC, new_generation DESC
      ) WHERE from_publication_id IS NOT NULL`,
    ).run();
  });
});
