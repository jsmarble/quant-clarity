import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  createModelVariantNameSearchFixture,
  seedModelVariantNameSearchBuildingPublication,
} from "../test/model-variant-name-search-fixture.js";

const MIGRATION_0015 = "0015_model_slug_projection.sql";
const MIGRATION_0016 = "0016_model_slug_lifecycle.sql";
const PUBLICATION_ID = "pub_96969696-0000-4000-8000-000000000001";
const GENERATED_AT_MS = Date.UTC(2026, 7, 3, 4);
const HASH = `sha256:${"a".repeat(64)}`;
const through = (name: string) =>
  env.TEST_MIGRATIONS.filter((migration) => migration.name <= name);
const only = (name: string) =>
  env.TEST_MIGRATIONS.filter((migration) => migration.name === name);

describe("schema-1.13 staged-evidence refusal in pinned workerd", () => {
  it("leaves schema 1.12 and every staged proof intact", async () => {
    await applyD1Migrations(env.SERVING_DB, through(MIGRATION_0015));
    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_ID,
      GENERATED_AT_MS,
      "Legacy Model",
    );
    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    const model = fixture.closureRows.resources.find(
      (resource) => resource.resource_type === "model",
    );
    if (model === undefined)
      throw new Error("fixture lacks its Model resource");
    const resource = JSON.parse(model.resource_json) as {
      slug: { value: string };
    };
    await env.SERVING_DB.prepare(
      `INSERT INTO publication_model_slug_mapping VALUES (
        ?, ?, 'model', ?, 'model-slug@1', 'current', ?
      )`,
    )
      .bind(
        fixture.manifest.publicationId,
        resource.slug.value,
        model.resource_id,
        model.content_hash,
      )
      .run();
    const revision = await env.SERVING_DB.prepare(
      `SELECT revision FROM publication_staging_revision
       WHERE publication_id = ?`,
    )
      .bind(fixture.manifest.publicationId)
      .first<{ revision: number }>();
    if (revision === null)
      throw new Error("fixture lacks its staging revision");
    await env.SERVING_DB.prepare(
      `INSERT INTO publication_model_slug_artifact_proof VALUES (
        ?, ?, 'model-slug-history-artifact@1',
        'model-slug-history-canonical@1', 'model-slug@1', ?, ?, ?, ?, 1,
        1, 1, ?, 1, 1, 0, ?
      )`,
    )
      .bind(
        fixture.manifest.publicationId,
        revision.revision,
        fixture.manifest.bundleHash,
        fixture.manifest.closureHash,
        Date.parse(fixture.manifest.generatedAt),
        HASH,
        HASH,
        HASH,
      )
      .run();

    await expect(
      applyD1Migrations(env.SERVING_DB, only(MIGRATION_0016)),
    ).rejects.toThrow();
    await expect(
      env.SERVING_DB.prepare(
        `SELECT schema_version,
          (SELECT count(*) FROM publication_model_slug_artifact_proof)
            AS proof_count,
          (SELECT count(*) FROM sqlite_schema
           WHERE name = 'publication_model_slug_current_model_idx')
            AS v5_object_count
         FROM serving_schema_metadata WHERE singleton = 1`,
      ).first(),
    ).resolves.toEqual({
      schema_version: "1.12.0",
      proof_count: 1,
      v5_object_count: 0,
    });
  });
});
