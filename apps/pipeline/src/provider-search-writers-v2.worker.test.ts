import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS } from "@quant-clarity/publication-core";

import { applyProviderSearchStagingV2 } from "./provider-search-staging.js";
import { applyReadinessCommitV2 } from "./readiness-commit-v2.js";
import { applyServingSwitchV2 } from "./serving-switch.js";
import {
  createActivationProjectionV2,
  createReadyPublicationFixture,
  createRollbackProjectionV2,
} from "../test/serving-switch-fixture.js";
import {
  sealPublicationV2,
  seedBuildingPublicationV2,
} from "../test/provider-search-d1-fixture.js";

const PUBLICATION_A = "pub_88888888-8888-4888-8888-888888888888" as const;
const PUBLICATION_B = "pub_99999999-9999-4999-8999-999999999999" as const;
const PUBLICATION_C = "pub_aaaaaaaa-0000-4000-8000-000000000001" as const;
const PUBLICATION_D = "pub_aaaaaaaa-0000-4000-8000-000000000002" as const;
const PUBLICATION_E = "pub_aaaaaaaa-0000-4000-8000-000000000003" as const;
const PUBLICATION_F = "pub_aaaaaaaa-0000-4000-8000-000000000004" as const;

const withAbortAfter = (
  database: D1Database,
  mutationLength: number,
  ordinal: number,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          if (injected || statements.length !== mutationLength)
            return session.batch(statements);
          injected = true;
          return session.batch([
            ...statements.slice(0, ordinal),
            session.prepare("SELECT json('')"),
            ...statements.slice(ordinal),
          ]);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const one = async <Row>(
  database: D1Database,
  sql: string,
  value?: unknown,
): Promise<Row> => {
  const statement = database.prepare(sql);
  const row = await (
    value === undefined ? statement : statement.bind(value)
  ).first<Row>();
  if (row === null) throw new Error("expected one D1 row");
  return row;
};

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
});

describe("schema-1.5 provider publication flow in workerd (PIPE-050–PIPE-053, QA-006)", () => {
  it("stages the 200-astral-scalar ProviderSchema boundary in real D1", async () => {
    const generatedAt = Math.floor(Date.now() / 1_000) * 1_000 - 21 * 60_000;
    const displayName = "\u{1f642}".repeat(200);
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_F,
      generatedAt,
      { providerDisplayName: displayName },
    );
    await seedBuildingPublicationV2(env.SERVING_DB, fixture);
    await expect(
      applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging),
    ).resolves.toMatchObject({ outcome: "applied", documentCount: 1 });
    await expect(
      one<{ display_length: number; normalized_length: number }>(
        env.SERVING_DB,
        `SELECT length(display_name) AS display_length,
          length(normalized_name) AS normalized_length
        FROM publication_provider_search_document
        WHERE publication_id = ?`,
        PUBLICATION_F,
      ),
    ).resolves.toEqual({ display_length: 200, normalized_length: 200 });
  });

  it("stages the worst-case contract-valid Unicode expansion in real D1", async () => {
    const generatedAt = Math.floor(Date.now() / 1_000) * 1_000 - 20 * 60_000;
    const displayName = "\ufdfa".repeat(200);
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_E,
      generatedAt,
      { providerDisplayName: displayName },
    );
    await seedBuildingPublicationV2(env.SERVING_DB, fixture);
    await expect(
      applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging),
    ).resolves.toMatchObject({ outcome: "applied", documentCount: 1 });
    await expect(
      one<{
        display_length: number;
        normalized_length: number;
        indexed_display_name: string;
      }>(
        env.SERVING_DB,
        `SELECT length(document.display_name) AS display_length,
          length(document.normalized_name) AS normalized_length,
          indexed.display_name AS indexed_display_name
        FROM publication_provider_search_document AS document
        JOIN publication_provider_search_fts AS indexed
          ON indexed.publication_id = document.publication_id
         AND indexed.provider_id = document.provider_id
        WHERE document.publication_id = ?`,
        PUBLICATION_E,
      ),
    ).resolves.toEqual({
      display_length: 200,
      normalized_length: PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS,
      indexed_display_name: displayName,
    });
  });

  it("stages, seals, readies, activates twice, then rolls back exactly", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixtureA = await createReadyPublicationFixture(
      PUBLICATION_A,
      now - 30 * 60_000,
    );
    await seedBuildingPublicationV2(env.SERVING_DB, fixtureA);
    await expect(sealPublicationV2(env.SERVING_DB, fixtureA)).rejects.toThrow();
    await expect(
      applyProviderSearchStagingV2(env.SERVING_DB, fixtureA.providerStaging),
    ).resolves.toMatchObject({ outcome: "applied", documentCount: 1 });
    await expect(
      applyProviderSearchStagingV2(env.SERVING_DB, fixtureA.providerStaging),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    await sealPublicationV2(env.SERVING_DB, fixtureA);
    await expect(
      applyReadinessCommitV2(env.SERVING_DB, fixtureA.readinessCommitV2),
    ).resolves.toMatchObject({ outcome: "applied" });

    const activatedAtA = now - 3 * 60_000;
    const activationA = await createActivationProjectionV2(
      fixtureA,
      activatedAtA,
    );
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await expect(
        applyServingSwitchV2(
          withAbortAfter(env.SERVING_DB, 3, ordinal),
          activationA,
        ),
      ).rejects.toMatchObject({
        code: "not_applied",
        retrySameProjection: true,
      });
      await expect(
        one<{ count: number }>(
          env.SERVING_DB,
          "SELECT count(*) AS count FROM publication_head",
        ),
      ).resolves.toEqual({ count: 0 });
    }
    await expect(
      applyServingSwitchV2(env.SERVING_DB, activationA),
    ).resolves.toMatchObject({ outcome: "applied", generation: 1 });

    const fixtureB = await createReadyPublicationFixture(
      PUBLICATION_B,
      now - 18 * 60_000,
    );
    await seedBuildingPublicationV2(env.SERVING_DB, fixtureB);
    await applyProviderSearchStagingV2(
      env.SERVING_DB,
      fixtureB.providerStaging,
    );
    await sealPublicationV2(env.SERVING_DB, fixtureB);
    await applyReadinessCommitV2(env.SERVING_DB, fixtureB.readinessCommitV2);
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
    const activatedAtB = now - 2 * 60_000;
    const activationB = await createActivationProjectionV2(
      fixtureB,
      activatedAtB,
      headA,
      activeA,
    );
    await expect(
      applyServingSwitchV2(env.SERVING_DB, activationB),
    ).resolves.toMatchObject({ outcome: "applied", generation: 2 });

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
    const rollback = await createRollbackProjectionV2(
      fixtureA,
      headA.switchedAt,
      headB,
      activeB,
      now - 60_000,
    );
    await expect(
      applyServingSwitchV2(env.SERVING_DB, rollback),
    ).resolves.toMatchObject({ outcome: "applied", generation: 3 });
    await expect(
      one<{
        active_publication_id: string;
        rollback_candidate_publication_id: string;
        generation: number;
      }>(
        env.SERVING_DB,
        "SELECT active_publication_id, rollback_candidate_publication_id, generation FROM publication_head WHERE singleton = 1",
      ),
    ).resolves.toEqual({
      active_publication_id: PUBLICATION_A,
      rollback_candidate_publication_id: PUBLICATION_B,
      generation: 3,
    });
  });

  it("fails closed on provider FTS corruption without replacing the head", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_C,
      now - 12 * 60_000,
    );
    await seedBuildingPublicationV2(env.SERVING_DB, fixture);
    await applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging);
    await sealPublicationV2(env.SERVING_DB, fixture);
    await env.SERVING_DB.prepare(
      "DELETE FROM publication_provider_search_fts WHERE publication_id = ?",
    )
      .bind(PUBLICATION_C)
      .run();
    await expect(
      applyReadinessCommitV2(env.SERVING_DB, fixture.readinessCommitV2),
    ).rejects.toMatchObject({ code: "not_applied", retrySameProjection: true });
    await expect(
      one<{ state: string }>(
        env.SERVING_DB,
        "SELECT state FROM publication WHERE publication_id = ?",
        PUBLICATION_C,
      ),
    ).resolves.toEqual({ state: "building" });
    await expect(
      one<{ active_publication_id: string; generation: number }>(
        env.SERVING_DB,
        "SELECT active_publication_id, generation FROM publication_head WHERE singleton = 1",
      ),
    ).resolves.toEqual({
      active_publication_id: PUBLICATION_A,
      generation: 3,
    });
  });

  it("rolls back every v2 readiness statement in real D1", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_D,
      now - 11 * 60_000,
    );
    await seedBuildingPublicationV2(env.SERVING_DB, fixture);
    await applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging);
    await sealPublicationV2(env.SERVING_DB, fixture);
    for (let ordinal = 1; ordinal <= 12; ordinal += 1) {
      await expect(
        applyReadinessCommitV2(
          withAbortAfter(env.SERVING_DB, 12, ordinal),
          fixture.readinessCommitV2,
        ),
      ).rejects.toMatchObject({
        code: "not_applied",
        retrySameProjection: true,
      });
      await expect(
        one<{ state: string; evidence_count: number }>(
          env.SERVING_DB,
          `SELECT candidate.state,
            (SELECT count(*) FROM publication_readiness_receipt
             WHERE publication_id = candidate.publication_id) AS evidence_count
           FROM publication AS candidate WHERE publication_id = ?`,
          PUBLICATION_D,
        ),
      ).resolves.toEqual({ state: "building", evidence_count: 0 });
    }
  });
});
