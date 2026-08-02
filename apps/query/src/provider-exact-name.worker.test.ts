import { env } from "cloudflare:workers";
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

const PUBLICATION_A = "pub_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" as const;
const PUBLICATION_B = "pub_ffffffff-ffff-4fff-8fff-ffffffffffff" as const;
const PUBLICATION_C = "pub_12345678-1234-4123-8123-123456789abc" as const;

const publish = async (
  fixture: Awaited<ReturnType<typeof createReadyPublicationFixture>>,
): Promise<void> => {
  await seedBuildingPublicationV2(env.SERVING_DB, fixture);
  await applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging);
  await sealPublicationV2(env.SERVING_DB, fixture);
  await applyReadinessCommitV2(env.SERVING_DB, fixture.readinessCommitV2);
};

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
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
