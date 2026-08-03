import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const MIGRATION_0016 = "0016_model_slug_lifecycle.sql";
const through = (name: string) =>
  env.TEST_MIGRATIONS.filter((migration) => migration.name <= name);

describe("schema-1.13 Model-slug lifecycle migration in pinned workerd", () => {
  it("installs the exact v5 schema, two-column current index, and 14-field archive suffix", async () => {
    await applyD1Migrations(
      env.SERVING_DB,
      through("0015_model_slug_projection.sql"),
    );
    await applyD1Migrations(
      env.SERVING_DB,
      env.TEST_MIGRATIONS.filter(
        (migration) => migration.name === MIGRATION_0016,
      ),
    );

    await expect(
      env.SERVING_DB.prepare(
        "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
      ).first(),
    ).resolves.toEqual({ schema_version: "1.13.0" });
    const index = await env.SERVING_DB.prepare(
      `SELECT "unique" AS is_unique, origin, partial
       FROM pragma_index_list('publication_model_slug_mapping')
       WHERE name = 'publication_model_slug_current_model_idx'`,
    ).first();
    expect(index).toEqual({ is_unique: 1, origin: "c", partial: 1 });
    const indexColumns = await env.SERVING_DB.prepare(
      `SELECT seqno, name
       FROM pragma_index_info('publication_model_slug_current_model_idx')
       ORDER BY seqno`,
    ).all();
    expect(indexColumns.results).toEqual([
      { seqno: 0, name: "publication_id" },
      { seqno: 1, name: "model_id" },
    ]);

    const archiveColumns = await env.SERVING_DB.prepare(
      `SELECT name, type, "notnull" AS required
       FROM pragma_table_info('publication_archive_receipt')
       WHERE name LIKE 'model_slug_%' ORDER BY cid`,
    ).all();
    expect(archiveColumns.results).toEqual([
      { name: "model_slug_artifact_version", type: "TEXT", required: 1 },
      { name: "model_slug_acquisition_version", type: "TEXT", required: 1 },
      { name: "model_slug_projection_version", type: "TEXT", required: 1 },
      { name: "model_slug_artifact_digest", type: "TEXT", required: 1 },
      {
        name: "model_slug_artifact_byte_count",
        type: "INTEGER",
        required: 1,
      },
      {
        name: "model_slug_source_history_count",
        type: "INTEGER",
        required: 1,
      },
      { name: "model_slug_source_history_hash", type: "TEXT", required: 1 },
      { name: "model_slug_model_count", type: "INTEGER", required: 1 },
      { name: "model_slug_mapping_count", type: "INTEGER", required: 1 },
      {
        name: "model_slug_current_mapping_count",
        type: "INTEGER",
        required: 1,
      },
      {
        name: "model_slug_historical_mapping_count",
        type: "INTEGER",
        required: 1,
      },
      { name: "model_slug_mapping_inventory_hash", type: "TEXT", required: 1 },
      { name: "model_slug_read_verified", type: "INTEGER", required: 1 },
      { name: "model_slug_immutable", type: "INTEGER", required: 1 },
    ]);
    await expect(
      env.SERVING_DB.prepare(
        `SELECT
           instr((SELECT sql FROM sqlite_schema WHERE type = 'table'
                  AND name = 'publication_readiness_receipt'),
                 'receipt_version = ''5.0.0''') > 0 AS receipt_v5,
           instr((SELECT sql FROM sqlite_schema WHERE type = 'table'
                  AND name = 'publication_probe_receipt'),
                 'model_slug_lookup_passed') > 0 AS slug_probe,
           instr((SELECT sql FROM sqlite_schema WHERE type = 'table'
                  AND name = 'publication_switch_preflight'),
                 'preflight_version = ''5.0.0''') > 0 AS preflight_v5,
           instr((SELECT sql FROM sqlite_schema WHERE type = 'table'
                  AND name = 'publication_switch_preflight'),
                 'archive_receipt_hash') > 0 AS archive_receipt_bound`,
      ).first(),
    ).resolves.toEqual({
      receipt_v5: 1,
      slug_probe: 1,
      preflight_v5: 1,
      archive_receipt_bound: 1,
    });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT schema_version,
           instr((SELECT sql FROM sqlite_schema WHERE type = 'trigger'
                  AND name = 'publication_model_slug_mapping_insert_guard'),
                 'RAISE(ABORT') > 0 AS real_guard
         FROM serving_schema_metadata WHERE singleton = 1`,
      ).first(),
    ).resolves.toEqual({ schema_version: "1.13.0", real_guard: 1 });
  });
});
