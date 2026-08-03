import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { applyModelVariantNameSearchStagingV1 } from "./model-variant-name-search-staging.js";
import {
  createModelVariantNameSearchFixture,
  seedModelVariantNameSearchBuildingPublication,
} from "../test/model-variant-name-search-fixture.js";

const MODEL_INDEX = "publication_model_variant_name_exact_idx";
const PROVIDER_INDEX = "publication_provider_search_exact_idx";
const PUBLICATION_ID = "pub_fefefefe-0000-4000-8000-000000000001" as const;

describe("serving migrations 0010 and 0011 structural preflights", () => {
  it("rejects portable semantic corruption and accepts exact repair", async () => {
    await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(0, -2));
    const originals = new Map<string, string>();
    for (const indexName of [MODEL_INDEX, PROVIDER_INDEX]) {
      const row = await env.SERVING_DB.prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?",
      )
        .bind(indexName)
        .first<{ sql: string }>();
      expect(row).not.toBeNull();
      originals.set(indexName, row!.sql);
    }

    const modelSql = originals.get(MODEL_INDEX)!;
    const sameLengthPartial = `${modelSql
      .replaceAll("\n  ", "\n")
      .replace("(\npublication_id", "(publication_id")
      .replace(/\n\)$/u, ")")} WHERE 0`;
    expect(sameLengthPartial).toHaveLength(modelSql.length);

    const corruptions = [
      {
        indexName: MODEL_INDEX,
        sql: sameLengthPartial,
      },
      {
        indexName: PROVIDER_INDEX,
        sql: `CREATE UNIQUE INDEX ${PROVIDER_INDEX}
          ON publication_provider_search_document(
            publication_id,
            normalized_name COLLATE NOCASE DESC,
            provider_id
          )`,
      },
    ];

    for (const corruption of corruptions) {
      await env.SERVING_DB.exec(`DROP INDEX ${corruption.indexName}`);
      await env.SERVING_DB.prepare(corruption.sql).run();

      await expect(
        applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-2, -1)),
      ).rejects.toThrow();
      await expect(
        env.SERVING_DB.prepare(
          `SELECT schema_version,
            (SELECT count(*) FROM sqlite_schema
             WHERE name LIKE 'publication_provider_model_id_%') AS v4_object_count
           FROM serving_schema_metadata WHERE singleton = 1`,
        ).first(),
      ).resolves.toEqual({ schema_version: "1.6.0", v4_object_count: 0 });

      await env.SERVING_DB.exec(`DROP INDEX ${corruption.indexName}`);
      await env.SERVING_DB.prepare(originals.get(corruption.indexName)!).run();
    }

    for (const triggerName of [
      "publication_provider_search_document_insert_guard",
      "publication_provider_search_fts_insert",
    ]) {
      const original = await env.SERVING_DB.prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?",
      )
        .bind(triggerName)
        .first<{ sql: string }>();
      expect(original).not.toBeNull();
      await env.SERVING_DB.exec(`DROP TRIGGER ${triggerName}`);
      await expect(
        applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-2, -1)),
      ).rejects.toThrow();
      await expect(
        env.SERVING_DB.prepare(
          `SELECT schema_version,
            (SELECT count(*) FROM sqlite_schema
             WHERE name LIKE 'publication_provider_model_id_%') AS v4_object_count
           FROM serving_schema_metadata WHERE singleton = 1`,
        ).first(),
      ).resolves.toEqual({ schema_version: "1.6.0", v4_object_count: 0 });
      await env.SERVING_DB.prepare(original!.sql).run();
    }

    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_ID,
      Date.UTC(2026, 7, 2),
    );
    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    await applyModelVariantNameSearchStagingV1(env.SERVING_DB, fixture.staging);
    const immutableTrigger =
      "publication_model_variant_name_search_document_immutable_update";
    const canonicalTrigger = await env.SERVING_DB.prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?",
    )
      .bind(immutableTrigger)
      .first<{ sql: string }>();
    expect(canonicalTrigger).not.toBeNull();
    await env.SERVING_DB.exec(`DROP TRIGGER ${immutableTrigger}`);
    await env.SERVING_DB.prepare(
      `CREATE TRIGGER ${immutableTrigger}
      BEFORE UPDATE ON publication_model_variant_name_search_document
      WHEN 0
      BEGIN SELECT RAISE(ABORT, 'model/variant name search document is immutable'); END`,
    ).run();

    await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-2, -1));
    await expect(
      env.SERVING_DB.prepare(
        "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
      ).first(),
    ).resolves.toEqual({ schema_version: "1.7.0" });
    await expect(
      env.SERVING_DB.prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?",
      )
        .bind(immutableTrigger)
        .first(),
    ).resolves.toEqual(canonicalTrigger);
    await expect(
      env.SERVING_DB.prepare(
        `UPDATE publication_model_variant_name_search_document
         SET normalized_name_utf8 = normalized_name_utf8
         WHERE publication_id = ?`,
      )
        .bind(PUBLICATION_ID)
        .run(),
    ).rejects.toThrow("model/variant name search document is immutable");

    const historyTrigger =
      "publication_switch_history_immutable_update" as const;
    const canonicalHistoryTrigger = await env.SERVING_DB.prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = ?",
    )
      .bind(historyTrigger)
      .first<{ sql: string }>();
    expect(canonicalHistoryTrigger).not.toBeNull();
    await env.SERVING_DB.exec(`DROP TRIGGER ${historyTrigger}`);
    await expect(
      applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-1)),
    ).rejects.toThrow();
    await expect(
      env.SERVING_DB.prepare(
        `SELECT schema_version,
          (SELECT count(*) FROM sqlite_schema
           WHERE type = 'index' AND name LIKE 'publication_switch_history_%_retained_hot_idx') AS retained_hot_index_count
         FROM serving_schema_metadata WHERE singleton = 1`,
      ).first(),
    ).resolves.toEqual({
      schema_version: "1.7.0",
      retained_hot_index_count: 0,
    });
    await env.SERVING_DB.prepare(canonicalHistoryTrigger!.sql).run();

    await env.SERVING_DB.exec(`DROP TRIGGER ${historyTrigger}`);
    await env.SERVING_DB.prepare(
      `CREATE TRIGGER ${historyTrigger}
      BEFORE UPDATE ON publication BEGIN SELECT 1; END`,
    ).run();
    await expect(
      applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-1)),
    ).rejects.toThrow();
    await env.SERVING_DB.exec(`DROP TRIGGER ${historyTrigger}`);
    await env.SERVING_DB.prepare(
      `CREATE TRIGGER ${historyTrigger}
      BEFORE UPDATE ON publication_switch_history WHEN 0
      BEGIN SELECT RAISE(ABORT, 'switch history is append-only'); END`,
    ).run();
    await expect(
      applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-1)),
    ).rejects.toThrow();
    await env.SERVING_DB.exec(`DROP TRIGGER ${historyTrigger}`);
    await env.SERVING_DB.prepare(canonicalHistoryTrigger!.sql).run();

    await expect(
      env.SERVING_DB.prepare(
        `SELECT schema_version,
          (SELECT count(*) FROM sqlite_schema
           WHERE type = 'index' AND name LIKE 'publication_switch_history_%_retained_hot_idx') AS retained_hot_index_count
         FROM serving_schema_metadata WHERE singleton = 1`,
      ).first(),
    ).resolves.toEqual({
      schema_version: "1.7.0",
      retained_hot_index_count: 0,
    });

    await env.SERVING_DB.exec(
      "CREATE TABLE publication_switch_history_from_retained_hot_idx(fake INTEGER)",
    );
    await expect(
      applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-1)),
    ).rejects.toThrow();
    await expect(
      env.SERVING_DB.prepare(
        "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
      ).first(),
    ).resolves.toEqual({ schema_version: "1.7.0" });
    await env.SERVING_DB.exec(
      "DROP TABLE publication_switch_history_from_retained_hot_idx",
    );

    await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-1));
    await expect(
      env.SERVING_DB.prepare(
        "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
      ).first(),
    ).resolves.toEqual({ schema_version: "1.8.0" });
    const indexes = await env.SERVING_DB.prepare(
      `SELECT name, "unique" AS is_unique, origin, partial
       FROM pragma_index_list('publication_switch_history')
       WHERE name IN (
         'publication_switch_history_from_retained_hot_idx',
         'publication_switch_history_prior_rollback_retained_hot_idx'
       )
       ORDER BY name`,
    ).all();
    expect(indexes.results).toEqual([
      {
        name: "publication_switch_history_from_retained_hot_idx",
        is_unique: 0,
        origin: "c",
        partial: 1,
      },
      {
        name: "publication_switch_history_prior_rollback_retained_hot_idx",
        is_unique: 0,
        origin: "c",
        partial: 1,
      },
    ]);
  });
});
