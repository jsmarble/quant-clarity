import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyModelVariantNameSearchStagingV1 } from "./model-variant-name-search-staging.js";
import { applyProviderSearchStagingV2 } from "./provider-search-staging.js";
import {
  ReadinessCommitV3Error,
  applyReadinessCommitV3,
} from "./readiness-commit-v3.js";
import { seedModelVariantNameSearchBuildingPublication } from "../test/model-variant-name-search-fixture.js";
import {
  createServingV3Fixture,
  sealServingV3Fixture,
  type ServingV3Fixture,
} from "../test/serving-switch-v3-fixture.js";

const PUBLICATION_A = "pub_cccccccc-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_cccccccc-0000-4000-8000-000000000002" as const;
const PUBLICATION_C = "pub_cccccccc-0000-4000-8000-000000000003" as const;

const CORRUPT_HASH = `sha256:${"0".repeat(64)}`;

const prepareSealed = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
): Promise<ServingV3Fixture> => {
  const fixture = await createServingV3Fixture(publicationId, generatedAtMs);
  await seedModelVariantNameSearchBuildingPublication(
    env.SERVING_DB,
    fixture.base,
  );
  await applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging);
  await applyModelVariantNameSearchStagingV1(
    env.SERVING_DB,
    fixture.base.staging,
  );
  await sealServingV3Fixture(env.SERVING_DB, fixture);
  return fixture;
};

const withLostReadinessResponse = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          const results = await session.batch(statements);
          if (!injected && statements.length === 12) {
            injected = true;
            throw new Error("simulated lost readiness response");
          }
          return results;
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withAbortedReadiness = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        batch(statements: D1PreparedStatement[]) {
          if (injected || statements.length !== 12)
            return session.batch(statements);
          injected = true;
          return session.batch([
            ...statements.slice(0, 6),
            session.prepare("SELECT json('')"),
            ...statements.slice(6),
          ]);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withCorruptedReadiness = (
  database: D1Database,
  insertPrefix: string,
  corruptSql: (sql: string) => string,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare(sql: string) {
          if (!injected && sql.startsWith(insertPrefix)) {
            injected = true;
            return session.prepare(corruptSql(sql));
          }
          return session.prepare(sql);
        },
        batch: (statements: D1PreparedStatement[]) => session.batch(statements),
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

beforeAll(async () => {
  await applyD1Migrations(
    env.SERVING_DB,
    env.TEST_MIGRATIONS.filter(
      (migration) =>
        migration.name <= "0009_model_variant_name_exact_projection.sql",
    ),
  );
});

describe("schema-1.6 readiness transaction in pinned workerd", () => {
  it("atomically persists v3 evidence and transitions building to ready", async () => {
    const fixture = await prepareSealed(
      PUBLICATION_A,
      Date.parse("2026-08-02T06:00:00.000Z"),
    );
    await expect(
      applyReadinessCommitV3(env.SERVING_DB, fixture.readinessCommit),
    ).resolves.toMatchObject({ outcome: "applied" });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state, candidate.ready_at_ms,
          count(binding.kind) AS binding_count,
          max(binding.receipt_version) AS receipt_version,
          serving.provider_search_document_count,
          serving.model_variant_name_storage_document_count,
          serving.model_variant_name_storage_queryable,
          serving.model_variant_name_storage_exact_parity,
          probes.probe_set_version,
          attestation.evaluator_version
        FROM publication AS candidate
        JOIN publication_readiness_receipt AS binding USING (publication_id)
        JOIN publication_serving_receipt AS serving USING (publication_id)
        JOIN publication_probe_receipt AS probes USING (publication_id)
        JOIN publication_readiness_attestation AS attestation USING (publication_id)
        WHERE candidate.publication_id = ?
        GROUP BY candidate.publication_id`,
      )
        .bind(PUBLICATION_A)
        .first(),
    ).resolves.toMatchObject({
      state: "ready",
      binding_count: 4,
      receipt_version: "3.0.0",
      provider_search_document_count: 1,
      model_variant_name_storage_document_count: 1,
      model_variant_name_storage_queryable: 1,
      model_variant_name_storage_exact_parity: 1,
      probe_set_version: "search-gold@3",
      evaluator_version: "3.0.0",
    });
    await expect(
      applyReadinessCommitV3(env.SERVING_DB, fixture.readinessCommit),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("reconciles a committed transaction after response loss", async () => {
    const fixture = await prepareSealed(
      PUBLICATION_B,
      Date.parse("2026-08-02T07:00:00.000Z"),
    );
    await expect(
      applyReadinessCommitV3(
        withLostReadinessResponse(env.SERVING_DB),
        fixture.readinessCommit,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("observes an injected transactional rollback as retryable", async () => {
    const fixture = await prepareSealed(
      PUBLICATION_C,
      Date.parse("2026-08-02T08:00:00.000Z"),
    );
    await expect(
      applyReadinessCommitV3(
        withAbortedReadiness(env.SERVING_DB),
        fixture.readinessCommit,
      ),
    ).rejects.toEqual(new ReadinessCommitV3Error("not_applied"));
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state, count(binding.kind) AS binding_count
        FROM publication AS candidate
        LEFT JOIN publication_readiness_receipt AS binding USING (publication_id)
        WHERE candidate.publication_id = ?
        GROUP BY candidate.publication_id`,
      )
        .bind(PUBLICATION_C)
        .first(),
    ).resolves.toEqual({ state: "building", binding_count: 0 });
  });

  it.each([
    {
      publicationId: "pub_cccccccc-0000-4000-8000-000000000011" as const,
      insertPrefix: "INSERT INTO publication_archive_receipt (",
      corruptSql: (sql: string) =>
        sql.replace("?3,?4)", "?3,CASE WHEN ?4 = 1 THEN 0 ELSE ?4 END)"),
    },
    {
      publicationId: "pub_cccccccc-0000-4000-8000-000000000012" as const,
      insertPrefix: "INSERT INTO publication_serving_receipt (",
      corruptSql: (sql: string) =>
        sql.replace(
          "?20,?21,?22",
          `?20,CASE WHEN ?21 IS NOT NULL THEN '${CORRUPT_HASH}' ELSE ?21 END,?22`,
        ),
    },
    {
      publicationId: "pub_cccccccc-0000-4000-8000-000000000013" as const,
      insertPrefix: "INSERT INTO publication_serving_receipt (",
      corruptSql: (sql: string) =>
        sql.replace(
          "?27,?28,?29",
          `?27,CASE WHEN ?28 IS NOT NULL THEN '${CORRUPT_HASH}' ELSE ?28 END,?29`,
        ),
    },
    {
      publicationId: "pub_cccccccc-0000-4000-8000-000000000014" as const,
      insertPrefix: "INSERT INTO publication_vector_receipt (",
      corruptSql: (sql: string) =>
        sql.replace(
          "?7,?8,?9",
          "?7,CASE WHEN ?8 IS NOT NULL THEN 'corrupt-mutation' ELSE ?8 END,?9",
        ),
    },
    {
      publicationId: "pub_cccccccc-0000-4000-8000-000000000015" as const,
      insertPrefix: "INSERT INTO publication_probe_receipt (",
      corruptSql: (sql: string) =>
        sql.replace("?3,?4,?5", "?3,CASE WHEN ?4 = 1 THEN 0 ELSE ?4 END,?5"),
    },
  ])(
    "rolls the complete batch back for a corrupt $insertPrefix subtype",
    async ({ publicationId, insertPrefix, corruptSql }) => {
      const fixture = await prepareSealed(
        publicationId,
        Date.parse("2026-08-02T10:00:00.000Z") +
          Number(publicationId.slice(-3)) * 60_000,
      );
      await expect(
        applyReadinessCommitV3(
          withCorruptedReadiness(env.SERVING_DB, insertPrefix, corruptSql),
          fixture.readinessCommit,
        ),
      ).rejects.toEqual(new ReadinessCommitV3Error("not_applied"));
      await expect(
        env.SERVING_DB.prepare(
          `SELECT candidate.state,
            (SELECT count(*) FROM publication_readiness_receipt WHERE publication_id = candidate.publication_id) AS binding_count,
            (SELECT count(*) FROM publication_archive_receipt WHERE publication_id = candidate.publication_id) AS archive_count,
            (SELECT count(*) FROM publication_serving_receipt WHERE publication_id = candidate.publication_id) AS serving_count,
            (SELECT count(*) FROM publication_vector_receipt WHERE publication_id = candidate.publication_id) AS vector_count,
            (SELECT count(*) FROM publication_probe_receipt WHERE publication_id = candidate.publication_id) AS probe_count,
            (SELECT count(*) FROM publication_readiness_attestation WHERE publication_id = candidate.publication_id) AS attestation_count
          FROM publication AS candidate WHERE candidate.publication_id = ?`,
        )
          .bind(publicationId)
          .first(),
      ).resolves.toEqual({
        state: "building",
        binding_count: 0,
        archive_count: 0,
        serving_count: 0,
        vector_count: 0,
        probe_count: 0,
        attestation_count: 0,
      });
    },
  );
});
