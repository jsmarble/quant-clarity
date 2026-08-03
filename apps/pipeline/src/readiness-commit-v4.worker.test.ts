import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyModelVariantNameSearchStagingV1 } from "./model-variant-name-search-staging.js";
import { applyProviderSearchStagingV2 } from "./provider-search-staging.js";
import { applyProviderModelIdSearchStagingV1 } from "./provider-model-id-search-staging.js";
import {
  ReadinessCommitV4Error,
  applyReadinessCommitV4,
} from "./readiness-commit-v4.js";
import { seedModelVariantNameSearchBuildingPublication } from "../test/model-variant-name-search-fixture.js";
import {
  createServingV4Fixture,
  sealServingV4Fixture,
  type ServingV4Fixture,
} from "../test/serving-switch-v4-fixture.js";

const PUBLICATION_A = "pub_cccccccc-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_cccccccc-0000-4000-8000-000000000002" as const;
const PUBLICATION_C = "pub_cccccccc-0000-4000-8000-000000000003" as const;

const CORRUPT_HASH = `sha256:${"0".repeat(64)}`;

const prepareSealed = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
): Promise<ServingV4Fixture> => {
  const fixture = await createServingV4Fixture(publicationId, generatedAtMs);
  await seedModelVariantNameSearchBuildingPublication(
    env.SERVING_DB,
    fixture.base,
  );
  await applyProviderSearchStagingV2(env.SERVING_DB, fixture.providerStaging);
  await applyModelVariantNameSearchStagingV1(
    env.SERVING_DB,
    fixture.base.staging,
  );
  await applyProviderModelIdSearchStagingV1(
    env.SERVING_DB,
    fixture.providerModelIdStaging,
  );
  await sealServingV4Fixture(env.SERVING_DB, fixture);
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
          if (!injected && statements.length === 14) {
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

const withAbortedReadiness = (
  database: D1Database,
  ordinal: number,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        batch(statements: D1PreparedStatement[]) {
          if (injected || statements.length !== 14)
            return session.batch(statements);
          injected = true;
          return session.batch([
            ...statements.slice(0, ordinal),
            session.prepare("SELECT json('')"),
            ...statements.slice(ordinal + 1),
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

const withMutationBeforeReadinessBatch = (
  database: D1Database,
  mutate: () => Promise<void>,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          if (!injected && statements.length === 14) {
            injected = true;
            await mutate();
          }
          return session.batch(statements);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

beforeAll(async () => {
  await applyD1Migrations(
    env.SERVING_DB,
    env.TEST_MIGRATIONS.filter(
      (migration) => migration.name <= "0015_model_slug_projection.sql",
    ),
  );
});

describe("legacy v4 readiness transaction on schema 1.12 in pinned workerd", () => {
  it("atomically persists v4 evidence and transitions building to ready", async () => {
    const fixture = await prepareSealed(
      PUBLICATION_A,
      Date.parse("2026-08-02T06:00:00.000Z"),
    );
    await expect(
      applyReadinessCommitV4(env.SERVING_DB, fixture.readinessCommit),
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
          serving.provider_model_id_document_count,
          serving.provider_model_id_storage_document_count,
          serving.provider_model_id_storage_queryable,
          serving.provider_model_id_storage_exact_parity,
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
      receipt_version: "4.0.0",
      provider_search_document_count: 1,
      model_variant_name_storage_document_count: 1,
      model_variant_name_storage_queryable: 1,
      model_variant_name_storage_exact_parity: 1,
      provider_model_id_document_count:
        fixture.providerModelIdProof.provider_model_id_document_count,
      provider_model_id_storage_document_count:
        fixture.providerModelIdProof.provider_model_id_storage_document_count,
      provider_model_id_storage_queryable: 1,
      provider_model_id_storage_exact_parity: 1,
      probe_set_version: "search-gold@4",
      evaluator_version: "4.0.0",
    });
    await expect(
      applyReadinessCommitV4(env.SERVING_DB, fixture.readinessCommit),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    await expect(
      env.SERVING_DB.prepare(
        `UPDATE publication_dataset_metadata_summary
         SET active_model_count = active_model_count + 1
         WHERE publication_id = ?`,
      )
        .bind(PUBLICATION_A)
        .run(),
    ).rejects.toThrow("dataset metadata summary is immutable");
  });

  it.each([
    ["model", "status"],
    ["model", "status.state"],
    ["model", "status.value"],
    ["model", "model_id"],
    ["offering", "offering_id"],
    ["offering", "stale"],
    ["provider", "provider_id"],
  ] as const)(
    "rejects a counted %s resource missing %s before summary persistence",
    async (resourceType, path) => {
      const sequence =
        100 +
        [
          "status",
          "status.state",
          "status.value",
          "model_id",
          "offering_id",
          "stale",
          "provider_id",
        ].indexOf(path);
      const publicationId =
        `pub_cccccccc-0000-4000-8000-${sequence.toString().padStart(12, "0")}` as const;
      const fixture = await prepareSealed(
        publicationId,
        Date.parse("2026-08-02T09:00:00.000Z") + sequence,
      );
      let changed = false;
      const resources = fixture.base.closureRows.resources.map((resource) => {
        if (changed || resource.resource_type !== resourceType) return resource;
        let value = JSON.parse(resource.resource_json) as Record<
          string,
          unknown
        >;
        if (path.startsWith("status.")) {
          const status = value.status as Record<string, unknown>;
          const omitted = path.slice("status.".length);
          value.status = Object.fromEntries(
            Object.entries(status).filter(([key]) => key !== omitted),
          );
        } else {
          value = Object.fromEntries(
            Object.entries(value).filter(([key]) => key !== path),
          );
        }
        changed = true;
        return { ...resource, resource_json: JSON.stringify(value) };
      });
      expect(changed).toBe(true);
      const hostileResource = resources.find(
        (resource, index) =>
          resource.resource_json !==
          fixture.base.closureRows.resources[index]?.resource_json,
      );
      expect(hostileResource).toBeDefined();
      const immutableResourceTrigger = await env.SERVING_DB.prepare(
        `SELECT sql FROM sqlite_schema
         WHERE type = 'trigger' AND name = 'publication_resource_immutable_update'`,
      ).first<{ sql: string }>();
      const immutableSummaryDeleteTrigger = await env.SERVING_DB.prepare(
        `SELECT sql FROM sqlite_schema
         WHERE type = 'trigger'
           AND name = 'publication_dataset_metadata_summary_immutable_delete'`,
      ).first<{ sql: string }>();
      expect(immutableResourceTrigger).not.toBeNull();
      expect(immutableSummaryDeleteTrigger).not.toBeNull();
      await env.SERVING_DB.exec(
        `DROP TRIGGER publication_resource_immutable_update;
         DROP TRIGGER publication_dataset_metadata_summary_immutable_delete;`,
      );
      await env.SERVING_DB.prepare(
        `DELETE FROM publication_dataset_metadata_summary
         WHERE publication_id = ?`,
      )
        .bind(publicationId)
        .run();
      await env.SERVING_DB.prepare(
        `UPDATE publication_resource SET resource_json = ?
         WHERE publication_id = ? AND resource_type = ? AND resource_id = ?`,
      )
        .bind(
          hostileResource!.resource_json,
          publicationId,
          hostileResource!.resource_type,
          hostileResource!.resource_id,
        )
        .run();
      await env.SERVING_DB.prepare(immutableResourceTrigger!.sql).run();
      await env.SERVING_DB.prepare(immutableSummaryDeleteTrigger!.sql).run();
      const summary = fixture.datasetMetadataSummary;
      await expect(
        env.SERVING_DB.prepare(
          `INSERT INTO publication_dataset_metadata_summary VALUES
           (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            summary.publication_id,
            summary.summary_version,
            summary.closure_hash,
            summary.source_resource_count,
            summary.provider_slice_count,
            summary.provider_slice_hash,
            summary.active_model_count,
            summary.active_offering_count,
            summary.active_provider_count,
            summary.has_stale_provider_slices,
            summary.has_unavailable_provider_slices,
            summary.summary_hash,
          )
          .run(),
      ).rejects.toThrow("dataset metadata counted resource is malformed");
      await expect(
        env.SERVING_DB.prepare(
          `SELECT count(*) AS count
           FROM publication_dataset_metadata_summary
           WHERE publication_id = ?`,
        )
          .bind(publicationId)
          .first(),
      ).resolves.toEqual({ count: 0 });
    },
  );

  it("reconciles a committed transaction after response loss", async () => {
    const fixture = await prepareSealed(
      PUBLICATION_B,
      Date.parse("2026-08-02T07:00:00.000Z"),
    );
    await expect(
      applyReadinessCommitV4(
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
    for (let ordinal = 0; ordinal < 14; ordinal += 1)
      await expect(
        applyReadinessCommitV4(
          withAbortedReadiness(env.SERVING_DB, ordinal),
          fixture.readinessCommit,
        ),
      ).rejects.toEqual(new ReadinessCommitV4Error("not_applied"));
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
      insertPrefix: "INSERT INTO publication_serving_receipt (",
      corruptSql: (sql: string) =>
        sql.replace(
          "?34,?35,?36",
          `?34,CASE WHEN ?35 IS NOT NULL THEN '${CORRUPT_HASH}' ELSE ?35 END,?36`,
        ),
    },
    {
      publicationId: "pub_cccccccc-0000-4000-8000-000000000015" as const,
      insertPrefix: "INSERT INTO publication_vector_receipt (",
      corruptSql: (sql: string) =>
        sql.replace(
          "?7,?8,?9",
          "?7,CASE WHEN ?8 IS NOT NULL THEN 'corrupt-mutation' ELSE ?8 END,?9",
        ),
    },
    {
      publicationId: "pub_cccccccc-0000-4000-8000-000000000016" as const,
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
        applyReadinessCommitV4(
          withCorruptedReadiness(env.SERVING_DB, insertPrefix, corruptSql),
          fixture.readinessCommit,
        ),
      ).rejects.toEqual(new ReadinessCommitV4Error("not_applied"));
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

  it("fails closed before readiness mutation when a required exact index is absent", async () => {
    const publicationId = "pub_cccccccc-0000-4000-8000-000000000021" as const;
    const fixture = await prepareSealed(
      publicationId,
      Date.parse("2026-08-02T12:00:00.000Z"),
    );
    await env.SERVING_DB.prepare(
      "DROP INDEX publication_provider_model_id_normalized_exact_idx",
    ).run();
    try {
      await expect(
        applyReadinessCommitV4(env.SERVING_DB, fixture.readinessCommit),
      ).rejects.toMatchObject({
        code: "outcome_unknown",
        retrySameProjection: false,
      });
    } finally {
      await env.SERVING_DB.prepare(
        `CREATE INDEX publication_provider_model_id_normalized_exact_idx
         ON publication_provider_model_id_search_document(
           publication_id, normalized_provider_model_id_utf8, offering_id
         )`,
      ).run();
    }
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state,
          (SELECT count(*) FROM publication_readiness_receipt
           WHERE publication_id = candidate.publication_id) AS binding_count
         FROM publication AS candidate WHERE candidate.publication_id = ?`,
      )
        .bind(publicationId)
        .first(),
    ).resolves.toEqual({ state: "building", binding_count: 0 });
  });

  it("rejects normalized-byte drift before readiness mutation", async () => {
    const publicationId = "pub_cccccccc-0000-4000-8000-000000000022" as const;
    const fixture = await prepareSealed(
      publicationId,
      Date.parse("2026-08-02T13:00:00.000Z"),
    );
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_provider_model_id_search_document_immutable_update",
    ).run();
    await env.SERVING_DB.prepare(
      `UPDATE publication_provider_model_id_search_document
       SET normalized_provider_model_id_utf8 = X'01'
       WHERE publication_id = ? AND offering_id = (
         SELECT min(offering_id)
         FROM publication_provider_model_id_search_document
         WHERE publication_id = ?
       )`,
    )
      .bind(publicationId, publicationId)
      .run();
    await env.SERVING_DB.prepare(
      `CREATE TRIGGER publication_provider_model_id_search_document_immutable_update
       BEFORE UPDATE ON publication_provider_model_id_search_document
       BEGIN SELECT RAISE(ABORT, 'provider model ID search document is immutable'); END`,
    ).run();
    await expect(
      applyReadinessCommitV4(env.SERVING_DB, fixture.readinessCommit),
    ).rejects.toMatchObject({
      code: "integrity_failure",
      retrySameProjection: false,
    });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state,
          (SELECT count(*) FROM publication_readiness_receipt
           WHERE publication_id = candidate.publication_id) AS binding_count
         FROM publication AS candidate WHERE candidate.publication_id = ?`,
      )
        .bind(publicationId)
        .first(),
    ).resolves.toEqual({ state: "building", binding_count: 0 });
  });

  it("rejects normalized-byte drift introduced after precheck but before the atomic batch", async () => {
    const publicationId = "pub_cccccccc-0000-4000-8000-000000000023" as const;
    const fixture = await prepareSealed(
      publicationId,
      Date.parse("2026-08-02T14:00:00.000Z"),
    );
    const mutate = async () => {
      await env.SERVING_DB.prepare(
        "DROP TRIGGER publication_provider_model_id_search_document_immutable_update",
      ).run();
      await env.SERVING_DB.prepare(
        `UPDATE publication_provider_model_id_search_document
         SET normalized_provider_model_id_utf8 = X'02'
         WHERE publication_id = ? AND offering_id = (
           SELECT min(offering_id)
           FROM publication_provider_model_id_search_document
           WHERE publication_id = ?
         )`,
      )
        .bind(publicationId, publicationId)
        .run();
      await env.SERVING_DB.prepare(
        `CREATE TRIGGER publication_provider_model_id_search_document_immutable_update
         BEFORE UPDATE ON publication_provider_model_id_search_document
         BEGIN SELECT RAISE(ABORT, 'provider model ID search document is immutable'); END`,
      ).run();
    };
    await expect(
      applyReadinessCommitV4(
        withMutationBeforeReadinessBatch(env.SERVING_DB, mutate),
        fixture.readinessCommit,
      ),
    ).rejects.toMatchObject({
      code: "integrity_failure",
      retrySameProjection: false,
    });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state,
          (SELECT count(*) FROM publication_readiness_receipt
           WHERE publication_id = candidate.publication_id) AS binding_count
         FROM publication AS candidate WHERE candidate.publication_id = ?`,
      )
        .bind(publicationId)
        .first(),
    ).resolves.toEqual({ state: "building", binding_count: 0 });
  });

  it("rejects a same-name wrong-column index introduced after precheck without writing readiness state", async () => {
    const publicationId = "pub_cccccccc-0000-4000-8000-000000000024" as const;
    const fixture = await prepareSealed(
      publicationId,
      Date.parse("2026-08-02T15:00:00.000Z"),
    );
    const replaceWithWrongIndex = async () => {
      await env.SERVING_DB.prepare(
        "DROP INDEX publication_provider_model_id_raw_exact_idx",
      ).run();
      await env.SERVING_DB.prepare(
        `CREATE INDEX publication_provider_model_id_raw_exact_idx
         ON publication_provider_model_id_search_document(
           publication_id, offering_id, raw_provider_model_id_utf8
         )`,
      ).run();
    };
    try {
      await expect(
        applyReadinessCommitV4(
          withMutationBeforeReadinessBatch(
            env.SERVING_DB,
            replaceWithWrongIndex,
          ),
          fixture.readinessCommit,
        ),
      ).rejects.toMatchObject({
        code: "integrity_failure",
        retrySameProjection: false,
      });
    } finally {
      await env.SERVING_DB.prepare(
        "DROP INDEX publication_provider_model_id_raw_exact_idx",
      ).run();
      await env.SERVING_DB.prepare(
        `CREATE INDEX publication_provider_model_id_raw_exact_idx
         ON publication_provider_model_id_search_document(
           publication_id, raw_provider_model_id_utf8, offering_id
         )`,
      ).run();
    }
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state,
          (SELECT count(*) FROM publication_readiness_receipt
           WHERE publication_id = candidate.publication_id) AS binding_count
         FROM publication AS candidate WHERE candidate.publication_id = ?`,
      )
        .bind(publicationId)
        .first(),
    ).resolves.toEqual({ state: "building", binding_count: 0 });
  });
});
