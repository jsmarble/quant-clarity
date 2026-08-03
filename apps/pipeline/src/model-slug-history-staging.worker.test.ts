import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import type { ModelSlugMappingProjection } from "@quant-clarity/publication-core";

import {
  acquireModelSlugHistoryCandidate,
  type ModelSlugHistoryAcquisitionPorts,
  type ModelSlugHistoryPublicationAssembly,
} from "./model-slug-history-acquisition.js";
import { archiveModelSlugHistoryCandidate } from "./model-slug-history-archive.js";
import {
  ModelSlugHistoryStagingError,
  MODEL_SLUG_HISTORY_STAGING_MAX_RETAINED_HEAP_BYTES,
  assertModelSlugServingProof,
  estimateModelSlugHistoryStagingRetainedHeapBytes,
  stageModelSlugHistoryArchive,
} from "./model-slug-history-staging.js";
import {
  createModelVariantNameSearchFixture,
  seedModelVariantNameSearchBuildingPublication,
} from "../test/model-variant-name-search-fixture.js";

const PUBLICATION_ID = "pub_83333333-3333-4333-8333-333333333333";
const BOUNDARY_MS = Date.parse("2026-08-03T03:00:00.000Z");
const MODEL_ID = "mdl_00000001-0000-4000-8000-000000000001";
const FAMILY_ID = "fam_00000001-0000-4000-8000-000000000001";
const CURRENT_HISTORY_ID = "slg_00000001-0000-4000-8000-000000000001";
const HISTORICAL_HISTORY_ID = "slg_00000002-0000-4000-8000-000000000001";
const archiveBucket = (
  env as typeof env & Readonly<{ MODEL_SLUG_ARCHIVE_BUCKET: R2Bucket }>
).MODEL_SLUG_ARCHIVE_BUCKET;

let assembly: ModelSlugHistoryPublicationAssembly;

const statement = (
  database: D1Database,
  sql: string,
  values: readonly unknown[] = [],
): D1PreparedStatement => database.prepare(sql).bind(...values);

const acquisitionPorts = (): ModelSlugHistoryAcquisitionPorts => ({
  async withWriterDrain<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  },
  assemblePublication() {
    return Promise.resolve(assembly);
  },
});

const withLostFirstMappingResponse = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare(sql: string) {
          const prepared = session.prepare(sql);
          if (
            injected ||
            !sql.startsWith("INSERT INTO publication_model_slug_mapping")
          )
            return prepared;
          return {
            bind(...values: unknown[]) {
              const bound = prepared.bind(...values);
              return {
                async run() {
                  await bound.run();
                  injected = true;
                  throw new Error("simulated lost mapping response");
                },
              } as unknown as D1PreparedStatement;
            },
          } as D1PreparedStatement;
        },
        batch(statements: D1PreparedStatement[]) {
          return session.batch(statements);
        },
        getBookmark() {
          return session.getBookmark();
        },
      };
    },
  } as D1Database;
};

beforeAll(async () => {
  await applyD1Migrations(env.CANONICAL_DB, env.CANONICAL_MIGRATIONS);
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
  const fixture = await createModelVariantNameSearchFixture(
    PUBLICATION_ID,
    BOUNDARY_MS,
    "Alpha Model",
  );
  assembly = Object.freeze({
    manifest: fixture.manifest,
    resources: fixture.closureRows.resources.filter(
      (resource) => resource.resource_type === "model",
    ),
  });
  await seedModelVariantNameSearchBuildingPublication(env.SERVING_DB, fixture);
  await env.CANONICAL_DB.batch([
    statement(
      env.CANONICAL_DB,
      "INSERT INTO resource_identity (resource_id, resource_type, created_at_ms) VALUES (?, 'model_family', 0)",
      [FAMILY_ID],
    ),
    statement(
      env.CANONICAL_DB,
      "INSERT INTO resource_identity (resource_id, resource_type, created_at_ms) VALUES (?, 'model', 0)",
      [MODEL_ID],
    ),
    statement(
      env.CANONICAL_DB,
      `INSERT INTO model_family
        (family_id, slug, display_name, normalized_name, created_at_ms)
       VALUES (?, 'alpha-family', 'Alpha Family', 'alpha family', 0)`,
      [FAMILY_ID],
    ),
    statement(
      env.CANONICAL_DB,
      `INSERT INTO model
        (model_id, family_id, slug, display_name, normalized_name, status,
         created_at_ms)
       VALUES (?, ?, 'alpha-model', 'Alpha Model', 'alpha model', 'active', 0)`,
      [MODEL_ID, FAMILY_ID],
    ),
    statement(
      env.CANONICAL_DB,
      `INSERT INTO slug_history
        (slug_history_id, resource_id, slug, valid_from_ms, valid_to_ms)
       VALUES (?, ?, 'previous-alpha', 0, ?)`,
      [HISTORICAL_HISTORY_ID, MODEL_ID, BOUNDARY_MS - 1_000],
    ),
    statement(
      env.CANONICAL_DB,
      `INSERT INTO slug_history
        (slug_history_id, resource_id, slug, valid_from_ms, valid_to_ms)
       VALUES (?, ?, 'alpha-model', ?, NULL)`,
      [CURRENT_HISTORY_ID, MODEL_ID, BOUNDARY_MS - 1_000],
    ),
  ]);
});

describe("schema-1.12 Model slug-history staging in pinned workerd", () => {
  it("admits the maximum contractual mapping shape below the retained-heap ceiling", () => {
    const mappings: ModelSlugMappingProjection[] = Array.from(
      { length: 50_000 },
      (_, index) => ({
        slug: `${index.toString().padStart(5, "0")}-${"a".repeat(122)}`,
        modelId: "mdl_00000001-0000-4000-8000-000000000001",
        projectionVersion: "model-slug@1",
        resolution: "historical",
        targetContentHash: `sha256:${"a".repeat(64)}`,
      }),
    );
    const estimate = estimateModelSlugHistoryStagingRetainedHeapBytes(mappings);
    expect(estimate).toBeGreaterThan(
      MODEL_SLUG_HISTORY_STAGING_MAX_RETAINED_HEAP_BYTES - 4 * 1024 * 1024,
    );
    expect(estimate).toBeLessThanOrEqual(
      MODEL_SLUG_HISTORY_STAGING_MAX_RETAINED_HEAP_BYTES,
    );
  });

  it("stages only a read-verified archive, resumes an exact partial state, and proves indexed hit/miss", async () => {
    const candidate = await acquireModelSlugHistoryCandidate(
      env.CANONICAL_DB,
      acquisitionPorts(),
    );
    const archive = await archiveModelSlugHistoryCandidate(
      archiveBucket,
      candidate,
    );

    await expect(
      stageModelSlugHistoryArchive(
        withLostFirstMappingResponse(env.SERVING_DB),
        archive,
      ),
    ).rejects.toEqual(new ModelSlugHistoryStagingError("not_applied"));
    await expect(
      env.SERVING_DB.prepare(
        "SELECT count(*) AS count FROM publication_model_slug_mapping WHERE publication_id = ?",
      )
        .bind(PUBLICATION_ID)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 2 });
    await expect(
      env.SERVING_DB.prepare(
        "SELECT count(*) AS count FROM publication_model_slug_artifact_proof WHERE publication_id = ?",
      )
        .bind(PUBLICATION_ID)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });

    const applied = await stageModelSlugHistoryArchive(env.SERVING_DB, archive);
    expect(applied.outcome).toBe("applied");
    expect(() => {
      assertModelSlugServingProof(applied.proof);
    }).not.toThrow();
    await expect(
      env.SERVING_DB.prepare(
        "SELECT count(*) AS count FROM publication_closure_seal WHERE publication_id = ?",
      )
        .bind(PUBLICATION_ID)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
    expect(applied.proof.projection.mappings).toEqual([
      expect.objectContaining({
        modelId: MODEL_ID,
        resolution: "current",
        slug: "alpha-model",
      }),
      expect.objectContaining({
        modelId: MODEL_ID,
        resolution: "historical",
        slug: "previous-alpha",
      }),
    ]);

    await expect(
      env.SERVING_DB.prepare(
        `SELECT model_id, resolution
         FROM publication_model_slug_mapping
         INDEXED BY publication_model_slug_exact_idx
         WHERE publication_id = ? AND slug = 'alpha-model'`,
      )
        .bind(PUBLICATION_ID)
        .all(),
    ).resolves.toMatchObject({
      success: true,
      results: [{ model_id: MODEL_ID, resolution: "current" }],
    });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT model_id
         FROM publication_model_slug_mapping
         INDEXED BY publication_model_slug_exact_idx
         WHERE publication_id = ? AND slug = 'does-not-exist'`,
      )
        .bind(PUBLICATION_ID)
        .all(),
    ).resolves.toMatchObject({ success: true, results: [] });

    const current = applied.proof.projection.mappings.find(
      (mapping) => mapping.resolution === "current",
    );
    if (current === undefined) throw new Error("fixture lacks current mapping");
    await expect(
      env.SERVING_DB.prepare(
        `INSERT INTO publication_model_slug_mapping VALUES (
          ?, 'post-proof-alias', 'model', ?, 'model-slug@1', 'historical', ?
        )`,
      )
        .bind(PUBLICATION_ID, current.modelId, current.targetContentHash)
        .run(),
    ).rejects.toThrow(
      "publication Model slug mappings are closed by their artifact proof",
    );
    await expect(
      env.SERVING_DB.prepare(
        `SELECT
          (SELECT count(*) FROM publication_model_slug_mapping
           WHERE publication_id = ?) AS mapping_count,
          (SELECT mapping_count FROM publication_model_slug_artifact_proof
           WHERE publication_id = ?) AS proven_mapping_count`,
      )
        .bind(PUBLICATION_ID, PUBLICATION_ID)
        .first(),
    ).resolves.toEqual({ mapping_count: 2, proven_mapping_count: 2 });

    await expect(
      stageModelSlugHistoryArchive(env.SERVING_DB, archive),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });
});
