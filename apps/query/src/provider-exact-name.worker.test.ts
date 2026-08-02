import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyProviderSearchStagingV2 } from "../../pipeline/src/provider-search-staging.js";
import { applyReadinessCommitV2 } from "../../pipeline/src/readiness-commit-v2.js";
import { applyServingSwitchV2 } from "../../pipeline/src/serving-switch.js";
import {
  createActivationProjectionV2,
  createReadyPublicationFixture,
  createRollbackProjectionV2,
} from "../../pipeline/test/serving-switch-fixture.js";
import {
  sealPublicationV2,
  seedBuildingPublicationV2,
} from "../../pipeline/test/provider-search-d1-fixture.js";

import {
  PROVIDER_EXACT_NAME_SELECT_SQL,
  readProviderExactNamePage,
} from "./provider-exact-name.js";
import type { QueryServiceEnvelope } from "@quant-clarity/api-core";

const PUBLICATION_A = "pub_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" as const;
const PUBLICATION_B = "pub_ffffffff-ffff-4fff-8fff-ffffffffffff" as const;
const PUBLICATION_C = "pub_12345678-1234-4123-8123-123456789abc" as const;

const rpcEnvelope = (
  publicationId: string,
  query: string,
): QueryServiceEnvelope => ({
  audience: "quantclarity-catalog-query-v1",
  continuation: null,
  environment: "local",
  filters: { record_type: "provider" },
  limit: 20,
  operation: { kind: "search" },
  publicationId,
  searchPlan: {
    filters: { record_type: "provider" },
    kind: "exact_structured",
    limit: 20,
    query,
    semanticCalls: 0,
    semanticCandidates: 0,
    semanticDegraded: "disabled",
  },
  sort: ["relevance", "stable_id"],
  version: 1,
});

const publish = async (
  fixture: Awaited<ReturnType<typeof createReadyPublicationFixture>>,
): Promise<void> => {
  await seedBuildingPublicationV2(env.SERVING_DB, fixture);
  await applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging);
  await sealPublicationV2(env.SERVING_DB, fixture);
  await applyReadinessCommitV2(env.SERVING_DB, fixture.readinessCommitV2);
};

beforeAll(async () => {
  await applyD1Migrations(
    env.SERVING_DB,
    env.TEST_MIGRATIONS.filter(
      (migration) => migration.name <= "0008_provider_name_nul_guard.sql",
    ),
  );
});

describe("provider exact-name reader in workerd/D1 (SRCH-002, SRCH-006, SRCH-008, QA-006)", () => {
  it("pins the active head, uses the exact index, and excludes inactive providers", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixtureA = await createReadyPublicationFixture(
      PUBLICATION_A,
      now - 30 * 60_000,
      { providerDisplayName: "Fixture—Provider" },
    );
    await publish(fixtureA);
    const activatedAtA = now - 3 * 60_000;
    await applyServingSwitchV2(
      env.SERVING_DB,
      await createActivationProjectionV2(fixtureA, activatedAtA),
    );

    const selected = await exports.CatalogQueryService.resolvePublicationV1({
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "local",
      requestedPublicationId: null,
    });
    expect(selected).toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION_A,
    });
    expect(selected).toHaveProperty("bookmark");
    if (selected.outcome !== "selected") throw new Error("selection failed");
    await expect(
      exports.CatalogQueryService.readProviderExactNameTierV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: selected.bookmark,
        envelope: rpcEnvelope(PUBLICATION_A, "Fixture Provider"),
      }),
    ).resolves.toMatchObject({
      outcome: "page",
      page: {
        publicationId: PUBLICATION_A,
        results: [{ resourceType: "provider", matchKind: "provider_name" }],
      },
    });
    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "preview",
        requestedPublicationId: null,
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION_C,
      }),
    ).resolves.toEqual({
      outcome: "publication_expired",
      currentPublicationId: PUBLICATION_A,
    });
    const publicResponse = await exports.default.fetch(
      new Request("https://query.example.test/v1/search?q=Fixture"),
    );
    expect(publicResponse.status).toBe(404);
    expect(publicResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );

    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION_A,
        query: "  FIXTURE provider ",
      }),
    ).resolves.toMatchObject({
      publicationId: PUBLICATION_A,
      nextAfterProviderId: null,
      results: [
        {
          tier: 3,
          resourceType: "provider",
          matchKind: "provider_name",
          semanticDegraded: "disabled",
          displayName: { state: "known", value: "Fixture—Provider" },
        },
      ],
    });
    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION_A,
        query: "MATCH * OR provider_id",
      }),
    ).resolves.toMatchObject({ results: [], nextAfterProviderId: null });
    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION_C,
        query: "Fixture Provider",
      }),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    const plan = await env.SERVING_DB.prepare(
      `EXPLAIN QUERY PLAN ${PROVIDER_EXACT_NAME_SELECT_SQL}`,
    )
      .bind(PUBLICATION_A, "fixture provider", "", 1_000_000, 21)
      .all<{ detail: string }>();
    expect(plan.success).toBe(true);
    expect(plan.results.map((row) => row.detail).join("\n")).toContain(
      "publication_provider_search_exact_idx",
    );

    const fixtureB = await createReadyPublicationFixture(
      PUBLICATION_B,
      now - 18 * 60_000,
      {
        providerDisplayName: "Inactive Provider",
        providerStatus: "inactive",
      },
    );
    await publish(fixtureB);
    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION_B,
      }),
    ).resolves.toEqual({
      outcome: "publication_expired",
      currentPublicationId: PUBLICATION_A,
    });
    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION_B,
        query: "Inactive Provider",
      }),
    ).rejects.toMatchObject({ code: "integrity_failure" });
    const headA = {
      activePublicationId: PUBLICATION_A,
      rollbackCandidatePublicationId: null,
      switchedAt: new Date(activatedAtA).toISOString(),
      generation: 1,
    } as const;
    const activeA = {
      ...fixtureA.record,
      state: "active" as const,
      firstActivatedAt: headA.switchedAt,
      lastHeadReferencedAt: headA.switchedAt,
    };
    await applyServingSwitchV2(
      env.SERVING_DB,
      await createActivationProjectionV2(
        fixtureB,
        now - 2 * 60_000,
        headA,
        activeA,
      ),
    );
    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION_A,
      }),
    ).resolves.toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION_A,
    });
    await expect(
      exports.CatalogQueryService.readProviderExactNameTierV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: selected.bookmark,
        envelope: rpcEnvelope(PUBLICATION_A, "Fixture Provider"),
      }),
    ).resolves.toMatchObject({
      outcome: "page",
      page: {
        publicationId: PUBLICATION_A,
        results: [{ resourceType: "provider" }],
      },
    });

    const selectedBBeforeRollback =
      await exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION_B,
      });
    expect(selectedBBeforeRollback).toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION_B,
    });
    if (selectedBBeforeRollback.outcome !== "selected")
      throw new Error("pre-rollback selection failed");

    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION_B,
        query: "Inactive Provider",
      }),
    ).resolves.toEqual({
      publicationId: PUBLICATION_B,
      results: [],
      nextAfterProviderId: null,
    });
    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION_A,
        query: "Fixture Provider",
      }),
    ).resolves.toMatchObject({
      publicationId: PUBLICATION_A,
      results: [{ resourceType: "provider", matchKind: "provider_name" }],
    });

    const activatedAtB = now - 2 * 60_000;
    const headB = {
      activePublicationId: PUBLICATION_B,
      rollbackCandidatePublicationId: PUBLICATION_A,
      switchedAt: new Date(activatedAtB).toISOString(),
      generation: 2,
    } as const;
    const activeB = {
      ...fixtureB.record,
      state: "active" as const,
      firstActivatedAt: headB.switchedAt,
      lastHeadReferencedAt: headB.switchedAt,
    };
    await applyServingSwitchV2(
      env.SERVING_DB,
      await createRollbackProjectionV2(
        fixtureA,
        headA.switchedAt,
        headB,
        activeB,
        now - 60_000,
      ),
    );
    await expect(
      exports.CatalogQueryService.resolvePublicationV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: PUBLICATION_B,
      }),
    ).resolves.toMatchObject({
      outcome: "selected",
      publicationId: PUBLICATION_B,
    });
    await expect(
      exports.CatalogQueryService.readProviderExactNameTierV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: selectedBBeforeRollback.bookmark,
        envelope: rpcEnvelope(PUBLICATION_B, "Inactive Provider"),
      }),
    ).resolves.toEqual({
      outcome: "page",
      page: {
        publicationId: PUBLICATION_B,
        results: [],
        nextAfterProviderId: null,
      },
    });
    await expect(
      readProviderExactNamePage(env.SERVING_DB, {
        publicationId: PUBLICATION_B,
        query: "Inactive Provider",
      }),
    ).resolves.toEqual({
      publicationId: PUBLICATION_B,
      results: [],
      nextAfterProviderId: null,
    });
  });
});
