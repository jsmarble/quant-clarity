import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const MIGRATION_0015 = "0015_model_slug_projection.sql";
const MIGRATION_0016 = "0016_model_slug_lifecycle.sql";
const through = (name: string) =>
  env.TEST_MIGRATIONS.filter((migration) => migration.name <= name);
const only = (name: string) =>
  env.TEST_MIGRATIONS.filter((migration) => migration.name === name);

describe("schema-1.13 migration rollback in pinned workerd", () => {
  it("rejects an unexpected metadata trigger before every schema mutation", async () => {
    await applyD1Migrations(env.SERVING_DB, through(MIGRATION_0015));
    await env.SERVING_DB.prepare(
      `CREATE TRIGGER test_reject_schema_1_13
       BEFORE UPDATE ON serving_schema_metadata
       WHEN NEW.schema_version = '1.13.0'
       BEGIN SELECT RAISE(ABORT, 'injected schema advance failure'); END`,
    ).run();
    await expect(
      applyD1Migrations(env.SERVING_DB, only(MIGRATION_0016)),
    ).rejects.toThrow("malformed JSON");
    await expect(
      env.SERVING_DB.prepare(
        `SELECT schema_version,
          (SELECT count(*) FROM sqlite_schema WHERE name IN (
            'publication_model_slug_current_model_idx',
            'publication_switch_history_model_slug_index_guard'
          )) AS v5_object_count,
          instr((SELECT sql FROM sqlite_schema WHERE type = 'trigger'
                 AND name = 'publication_closure_seal_insert_guard'),
                'archive-bound Model slug projection') AS v5_seal_guard
         FROM serving_schema_metadata WHERE singleton = 1`,
      ).first(),
    ).resolves.toEqual({
      schema_version: "1.12.0",
      v5_object_count: 0,
      v5_seal_guard: 0,
    });

    await env.SERVING_DB.exec("DROP TRIGGER test_reject_schema_1_13");
    await applyD1Migrations(env.SERVING_DB, only(MIGRATION_0016));
    await expect(
      env.SERVING_DB.prepare(
        "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
      ).first(),
    ).resolves.toEqual({ schema_version: "1.13.0" });
  });
});
