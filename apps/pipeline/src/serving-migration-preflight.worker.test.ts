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

describe("serving migration 0010 retained-index preflight", () => {
  it("rejects portable semantic corruption and accepts exact repair", async () => {
    await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(0, -1));
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
        applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-1)),
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
        applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-1)),
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

    await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS.slice(-1));
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
  });
});
