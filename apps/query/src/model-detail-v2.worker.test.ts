import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  canonicalizePublicationJson,
  hashPublicationResourceContent,
} from "@quant-clarity/publication-core";

import {
  MODEL_DETAIL_MAX_RESOURCE_BYTES,
  MODEL_DETAIL_V2_SELECT_SQL,
  readModelDetailV2,
} from "./model-detail.js";

const PUBLICATION = "pub_c2000000-0000-4000-8000-000000000001";
const ROLLBACK_PUBLICATION = "pub_c2000000-0000-4000-8000-000000000002";
const RETAINED_PUBLICATION = "pub_c2000000-0000-4000-8000-000000000003";
const MODEL_ID = "mdl_c2000000-0000-4000-8000-000000000001";
const UNKNOWN_MODEL = "mdl_c2000000-0000-4000-8000-000000000099";
const FAMILY_ID = "fam_c2000000-0000-4000-8000-000000000001";
const EVIDENCE_ID = "evd_c2000000-0000-4000-8000-000000000001";
const CURRENT_SLUG = "runtime-model";
const HISTORICAL_SLUG = "legacy-runtime-model";
const PUBLICATION_SCHEMA = "1.6.0";
const HASH = `sha256:${"a".repeat(64)}`;
const BUNDLE_HASH = `sha256:${"b".repeat(64)}`;
const CLOSURE_HASH = `sha256:${"c".repeat(64)}`;
const NOW = Math.floor(Date.now() / 1_000) * 1_000;
const GENERATED_AT = NOW - 10 * 60_000;
const SWITCHED_AT = NOW - 60_000;
const HORIZON = NOW + 60_000;
const OBSERVED_AT = new Date(GENERATED_AT).toISOString();

let bookmark: string;

const known = (value: unknown) => ({
  evidence_ids: [EVIDENCE_ID],
  observed_at: OBSERVED_AT,
  state: "known",
  value,
});

const unknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown",
  value: null,
});

const canonicalJsonValue = (value: unknown): string => {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJsonValue(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key])}`)
    .join(",")}}`;
};

const modelJson = (): string =>
  canonicalizePublicationJson(
    canonicalJsonValue({
      active_parameters: unknown(),
      architecture: unknown(),
      authoritative_checkpoint_ids: [],
      cataloged_provider_count: {
        derivation_version: "cataloged-provider-count@1",
        observed_at: OBSERVED_AT,
        value: 0,
      },
      checkpoints: [],
      context_window_tokens: unknown(),
      display_name: known("Runtime Model"),
      family_id: FAMILY_ID,
      last_model_data_refresh: known(OBSERVED_AT),
      license: unknown(),
      maximum_output_tokens: unknown(),
      modalities: unknown(),
      model_id: MODEL_ID,
      publisher: known("Runtime Publisher"),
      release_date: known("2026-08-03"),
      slug: known(CURRENT_SLUG),
      source_quantization: unknown(),
      source_weight_format: unknown(),
      status: known("active"),
      total_parameters: unknown(),
    }),
    "object",
  );

const input = (
  identifier: string,
  requiredAvailableUntilMs = HORIZON,
  publicationId = PUBLICATION,
  sessionBookmark = bookmark,
) => ({
  audience: "quantclarity-catalog-query-v1",
  bookmark: sessionBookmark,
  environment: "local",
  envelope: {
    audience: "quantclarity-catalog-query-v1",
    continuation: null,
    environment: "local",
    filters: {},
    limit: 25,
    operation: { identifier, kind: "detail", resourceType: "model" },
    publicationId,
    searchPlan: null,
    sort: ["name", "stable_id"],
    version: 1,
  },
  lookup: {
    kind: identifier.startsWith("mdl_") ? "stable_id" : "slug",
    value: identifier,
  },
  requiredAvailableUntilMs,
  version: 2,
});

const triggerSql = async (names: readonly string[]) => {
  const placeholders = names.map((_, index) => `?${String(index + 1)}`);
  const result = await env.SERVING_DB.prepare(
    `SELECT name, sql FROM sqlite_master
     WHERE type = 'trigger' AND name IN (${placeholders.join(",")})
     ORDER BY name`,
  )
    .bind(...names)
    .all<{ name: string; sql: string }>();
  if (result.results.length !== names.length)
    throw new Error(
      `fixture trigger inventory is incomplete: ${result.results.map((row) => row.name).join(",")}`,
    );
  return new Map(result.results.map((row) => [row.name, row.sql]));
};

const restoreTriggers = async (
  names: readonly string[],
  definitions: ReadonlyMap<string, string>,
): Promise<void> => {
  for (const name of names) {
    const sql = definitions.get(name);
    if (sql === undefined) throw new Error(`missing trigger ${name}`);
    await env.SERVING_DB.prepare(sql).run();
  }
};

const seedActivePublication = async (): Promise<void> => {
  const bypassed = [
    "publication_resource_building_insert",
    "publication_resource_revision",
    "publication_model_slug_mapping_insert_guard",
    "publication_model_slug_artifact_proof_insert_guard",
    "publication_closure_seal_insert_guard",
    "publication_provider_model_id_search_seal_guard",
    "publication_head_switch_insert",
  ] as const;
  const definitions = await triggerSql(bypassed);
  for (const name of bypassed)
    await env.SERVING_DB.prepare(`DROP TRIGGER ${name}`).run();

  const resourceJson = modelJson();
  const contentHash = await hashPublicationResourceContent({
    resourceType: "model",
    resourceId: MODEL_ID,
    resourceJson,
  });
  try {
    await env.SERVING_DB.prepare(
      `INSERT INTO publication (
        publication_id, state, schema_version, methodology_version,
        precision_normalization_version, precision_display_order_version,
        price_policy_version, source_policy_version, embedding_version,
        build_commit, source_run_id, parent_publication_id, generated_at_ms,
        ready_at_ms, activated_at_ms, resource_count, exact_document_count,
        vector_document_count, exact_index_hash, vector_index_version,
        closure_hash, failure_codes_json, created_at_ms
      ) VALUES (
        ?1, 'active', ?2, 'methodology@1', 'precision-normalization@1',
        'precision-display-order@1', 'price-policy@1', 'source-policy@1',
        'embedding@1', 'test-commit',
        'run_c2000000-0000-4000-8000-000000000001', NULL, ?3, ?4, ?5,
        1, 0, 0, ?6, 'vector-index@1', ?7, '[]', ?3
      )`,
    )
      .bind(
        PUBLICATION,
        PUBLICATION_SCHEMA,
        GENERATED_AT,
        GENERATED_AT + 1,
        SWITCHED_AT,
        HASH,
        CLOSURE_HASH,
      )
      .run();
    await env.SERVING_DB.prepare(
      `INSERT INTO publication_resource (
        publication_id, resource_type, resource_id, resource_json, content_hash
      ) VALUES (?1, 'model', ?2, ?3, ?4)`,
    )
      .bind(PUBLICATION, MODEL_ID, resourceJson, contentHash)
      .run();
    const revision = await env.SERVING_DB.prepare(
      "SELECT revision FROM publication_staging_revision WHERE publication_id = ?1",
    )
      .bind(PUBLICATION)
      .first<{ revision: number }>();
    if (revision === null)
      throw new Error("fixture staging revision is missing");
    await env.SERVING_DB.prepare(
      `INSERT INTO publication_model_slug_mapping (
        publication_id, slug, target_resource_type, model_id,
        projection_version, resolution, target_content_hash
      ) VALUES
        (?1, ?2, 'model', ?4, 'model-slug@1', 'current', ?5),
        (?1, ?3, 'model', ?4, 'model-slug@1', 'historical', ?5)`,
    )
      .bind(PUBLICATION, CURRENT_SLUG, HISTORICAL_SLUG, MODEL_ID, contentHash)
      .run();
    await env.SERVING_DB.prepare(
      `INSERT INTO publication_model_slug_artifact_proof (
        publication_id, staging_revision, artifact_version,
        acquisition_version, projection_version, base_bundle_hash,
        closure_hash, publication_boundary_ms, artifact_digest,
        artifact_byte_count, model_count, source_history_count,
        source_history_hash, mapping_count, current_mapping_count,
        historical_mapping_count, mapping_inventory_hash
      ) VALUES (
        ?1, ?2, 'model-slug-history-artifact@1',
        'model-slug-history-canonical@1', 'model-slug@1', ?3, ?4, ?5, ?6,
        512, 1, 2, ?6, 2, 1, 1, ?6
      )`,
    )
      .bind(
        PUBLICATION,
        revision.revision,
        BUNDLE_HASH,
        CLOSURE_HASH,
        GENERATED_AT,
        HASH,
      )
      .run();
    await env.SERVING_DB.prepare(
      `INSERT INTO publication_closure_seal (
        publication_id, staging_revision, manifest_contract_version,
        hash_domain, hash_encoding_version, enabled_provider_scope_version,
        enabled_provider_count, provider_slice_count,
        provider_attribution_count, resource_count, exact_document_count,
        vector_document_count, chunk_count, bundle_hash,
        enabled_provider_scope_hash, provider_slice_hash,
        provider_attribution_hash, resource_inventory_hash,
        exact_search_inventory_hash, vector_inventory_hash, chunk_root_hash,
        closure_hash, sealed_at_ms
      ) VALUES (
        ?1, ?2, '1.0.0', 'publication-closure', '1', 'provider-scope@1',
        1, 1, 0, 1, 0, 0, 1, ?3, ?4, ?4, ?4, ?4, ?4, ?4, ?4, ?5, ?6
      )`,
    )
      .bind(
        PUBLICATION,
        revision.revision,
        BUNDLE_HASH,
        HASH,
        CLOSURE_HASH,
        GENERATED_AT + 2,
      )
      .run();
    for (const publicationId of [ROLLBACK_PUBLICATION, RETAINED_PUBLICATION]) {
      await env.SERVING_DB.prepare(
        `INSERT INTO publication
         SELECT ?2, 'superseded', schema_version, methodology_version,
           precision_normalization_version, precision_display_order_version,
           price_policy_version, source_policy_version, embedding_version,
           build_commit, source_run_id, NULL, generated_at_ms, ready_at_ms,
           activated_at_ms, resource_count, exact_document_count,
           vector_document_count, exact_index_hash, vector_index_version,
           closure_hash, failure_codes_json, created_at_ms
         FROM publication WHERE publication_id = ?1`,
      )
        .bind(PUBLICATION, publicationId)
        .run();
      await env.SERVING_DB.prepare(
        `INSERT INTO publication_resource
         SELECT ?2, resource_type, resource_id, resource_json, content_hash
         FROM publication_resource WHERE publication_id = ?1`,
      )
        .bind(PUBLICATION, publicationId)
        .run();
      await env.SERVING_DB.prepare(
        `INSERT INTO publication_model_slug_mapping
         SELECT ?2, slug, target_resource_type, model_id, projection_version,
           resolution, target_content_hash
         FROM publication_model_slug_mapping WHERE publication_id = ?1`,
      )
        .bind(PUBLICATION, publicationId)
        .run();
      await env.SERVING_DB.prepare(
        `INSERT INTO publication_model_slug_artifact_proof
         SELECT ?2, 0, artifact_version, acquisition_version,
           projection_version, base_bundle_hash, closure_hash,
           publication_boundary_ms, artifact_digest, artifact_byte_count,
           model_count, source_history_count, source_history_hash,
           mapping_count, current_mapping_count, historical_mapping_count,
           mapping_inventory_hash
         FROM publication_model_slug_artifact_proof WHERE publication_id = ?1`,
      )
        .bind(PUBLICATION, publicationId)
        .run();
      await env.SERVING_DB.prepare(
        `INSERT INTO publication_closure_seal
         SELECT ?2, 0, manifest_contract_version, hash_domain,
           hash_encoding_version, enabled_provider_scope_version,
           enabled_provider_count, provider_slice_count,
           provider_attribution_count, resource_count, exact_document_count,
           vector_document_count, chunk_count, bundle_hash,
           enabled_provider_scope_hash, provider_slice_hash,
           provider_attribution_hash, resource_inventory_hash,
           exact_search_inventory_hash, vector_inventory_hash,
           chunk_root_hash, closure_hash, sealed_at_ms
         FROM publication_closure_seal WHERE publication_id = ?1`,
      )
        .bind(PUBLICATION, publicationId)
        .run();
    }
    await env.SERVING_DB.prepare(
      `INSERT INTO publication_head (
        singleton, active_publication_id, rollback_candidate_publication_id,
        switched_at_ms, generation
      ) VALUES (1, ?1, ?2, ?3, 1)`,
    )
      .bind(PUBLICATION, ROLLBACK_PUBLICATION, SWITCHED_AT)
      .run();
  } finally {
    await restoreTriggers(bypassed, definitions);
  }

  const session = env.SERVING_DB.withSession("first-primary");
  await session.prepare("SELECT 1").first();
  const observedBookmark = session.getBookmark();
  if (observedBookmark === null)
    throw new Error("fixture bookmark was not advanced");
  bookmark = observedBookmark;
};

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
  await seedActivePublication();
});

describe("publication-pinned Model slug reader in schema-1.13 workerd/D1 (API-002, BE-002, SEC-001, QA-004)", () => {
  it("resolves stable ID, current slug, and historical slug and closes both misses", async () => {
    await expect(
      readModelDetailV2(env.SERVING_DB, "local", input(MODEL_ID)),
    ).resolves.toMatchObject({
      outcome: "model",
      publicationId: PUBLICATION,
      schemaVersion: PUBLICATION_SCHEMA,
      model: { model_id: MODEL_ID },
      lookupProvenance: {
        matchedBy: "stable_id",
        canonicalSlug: CURRENT_SLUG,
        projectionVersion: "model-slug@1",
      },
    });
    await expect(
      readModelDetailV2(env.SERVING_DB, "local", input(CURRENT_SLUG)),
    ).resolves.toMatchObject({
      outcome: "model",
      model: { model_id: MODEL_ID },
      lookupProvenance: {
        matchedBy: "current_slug",
        canonicalSlug: CURRENT_SLUG,
      },
    });
    await expect(
      readModelDetailV2(env.SERVING_DB, "local", input(HISTORICAL_SLUG)),
    ).resolves.toMatchObject({
      outcome: "model",
      model: { model_id: MODEL_ID },
      lookupProvenance: {
        matchedBy: "historical_slug",
        canonicalSlug: CURRENT_SLUG,
      },
    });
    for (const identifier of [UNKNOWN_MODEL, "absent-model-slug"])
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input(identifier)),
      ).resolves.toEqual({
        outcome: "not_found",
        publicationId: PUBLICATION,
        schemaVersion: PUBLICATION_SCHEMA,
      });
    await expect(
      readModelDetailV2(
        env.SERVING_DB,
        "local",
        input(MODEL_ID, HORIZON, ROLLBACK_PUBLICATION),
      ),
    ).resolves.toMatchObject({
      outcome: "model",
      publicationId: ROLLBACK_PUBLICATION,
      lookupProvenance: { matchedBy: "stable_id" },
    });
  });

  it("uses the exact bookmark, horizon, fixed statement, and five closed binds", async () => {
    const calls: Readonly<{
      constraint: unknown;
      sql: string;
      binds: unknown[];
    }>[] = [];
    const observed = {
      withSession(constraint?: D1SessionConstraint) {
        const session = env.SERVING_DB.withSession(constraint);
        return {
          prepare(sql: string) {
            const statement = session.prepare(sql);
            return {
              bind(...binds: unknown[]) {
                calls.push({ constraint, sql, binds });
                return statement.bind(...binds);
              },
            } as D1PreparedStatement;
          },
          getBookmark: () => session.getBookmark(),
        } as D1DatabaseSession;
      },
    } as D1Database;

    await expect(
      readModelDetailV2(observed, "local", input(CURRENT_SLUG)),
    ).resolves.toMatchObject({ outcome: "model" });
    expect(calls).toEqual([
      {
        constraint: bookmark,
        sql: MODEL_DETAIL_V2_SELECT_SQL,
        binds: [
          PUBLICATION,
          HORIZON,
          "slug",
          CURRENT_SLUG,
          MODEL_DETAIL_MAX_RESOURCE_BYTES,
        ],
      },
    ]);
    await expect(
      readModelDetailV2(
        env.SERVING_DB,
        "local",
        input(CURRENT_SLUG, NOW - 10 * 60_000),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
  });

  it("uses both named slug indexes and exact publication-resource access", async () => {
    const plan = await env.SERVING_DB.prepare(
      `EXPLAIN QUERY PLAN ${MODEL_DETAIL_V2_SELECT_SQL}`,
    )
      .bind(
        PUBLICATION,
        HORIZON,
        "slug",
        CURRENT_SLUG,
        MODEL_DETAIL_MAX_RESOURCE_BYTES,
      )
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toContain("publication_model_slug_exact_idx");
    expect(details).toContain("publication_model_slug_current_model_idx");
    expect(details).toContain("publication_resource_lookup_idx");
  });

  it("honors a resolver bookmark across a later exact head change", async () => {
    const resolverSession = env.SERVING_DB.withSession("first-primary");
    await resolverSession
      .prepare("SELECT generation FROM publication_head")
      .first();
    const resolverBookmark = resolverSession.getBookmark();
    if (resolverBookmark === null)
      throw new Error("resolver fixture bookmark was not advanced");
    const definitions = await triggerSql(["publication_head_switch_update"]);
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_head_switch_update",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        `UPDATE publication_head SET generation = 2, switched_at_ms = ?1
         WHERE singleton = 1`,
      )
        .bind(SWITCHED_AT + 1)
        .run();
      await expect(
        readModelDetailV2(
          env.SERVING_DB,
          "local",
          input(MODEL_ID, HORIZON, ROLLBACK_PUBLICATION, resolverBookmark),
        ),
      ).resolves.toMatchObject({
        outcome: "model",
        publicationId: ROLLBACK_PUBLICATION,
      });
      await env.SERVING_DB.prepare(
        `UPDATE publication_head SET generation = 1, switched_at_ms = ?1
         WHERE singleton = 1`,
      )
        .bind(SWITCHED_AT)
        .run();
    } finally {
      await restoreTriggers(["publication_head_switch_update"], definitions);
    }
  });

  it("fails closed for seal drift and artifact drift or absence", async () => {
    const names = [
      "publication_closure_seal_immutable_update",
      "publication_model_slug_artifact_proof_immutable_update",
      "publication_model_slug_artifact_proof_immutable_delete",
      "publication_model_slug_artifact_proof_insert_guard",
      "publication_model_slug_mapping_immutable_update",
      "publication_model_slug_mapping_immutable_delete",
      "publication_model_slug_mapping_insert_guard",
      "publication_resource_immutable_update",
    ] as const;
    const definitions = await triggerSql(names);

    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_closure_seal_immutable_update",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        `UPDATE publication_closure_seal SET bundle_hash = ?2
         WHERE publication_id = ?1`,
      )
        .bind(PUBLICATION, `sha256:${"0".repeat(64)}`)
        .run();
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input(CURRENT_SLUG)),
      ).resolves.toEqual({ outcome: "integrity_failure" });
      await env.SERVING_DB.prepare(
        `UPDATE publication_closure_seal SET bundle_hash = ?2
         WHERE publication_id = ?1`,
      )
        .bind(PUBLICATION, BUNDLE_HASH)
        .run();
    } finally {
      await restoreTriggers(
        ["publication_closure_seal_immutable_update"],
        definitions,
      );
    }

    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_model_slug_artifact_proof_immutable_update",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        `UPDATE publication_model_slug_artifact_proof
         SET base_bundle_hash = ?2 WHERE publication_id = ?1`,
      )
        .bind(PUBLICATION, `sha256:${"0".repeat(64)}`)
        .run();
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input(MODEL_ID)),
      ).resolves.toEqual({ outcome: "integrity_failure" });
      await env.SERVING_DB.prepare(
        `UPDATE publication_model_slug_artifact_proof
         SET base_bundle_hash = ?2 WHERE publication_id = ?1`,
      )
        .bind(PUBLICATION, BUNDLE_HASH)
        .run();
      for (const mutation of [
        ["staging_revision", 99, 0],
        ["closure_hash", `sha256:${"0".repeat(64)}`, CLOSURE_HASH],
        ["publication_boundary_ms", GENERATED_AT + 1, GENERATED_AT],
      ] as const) {
        await env.SERVING_DB.prepare(
          `UPDATE publication_model_slug_artifact_proof
           SET ${mutation[0]} = ?2 WHERE publication_id = ?1`,
        )
          .bind(PUBLICATION, mutation[1])
          .run();
        await expect(
          readModelDetailV2(env.SERVING_DB, "local", input(MODEL_ID)),
        ).resolves.toEqual({ outcome: "integrity_failure" });
        await env.SERVING_DB.prepare(
          `UPDATE publication_model_slug_artifact_proof
           SET ${mutation[0]} = ?2 WHERE publication_id = ?1`,
        )
          .bind(PUBLICATION, mutation[2])
          .run();
      }
      await env.SERVING_DB.exec("PRAGMA ignore_check_constraints = ON");
      try {
        for (const mutation of [
          ["artifact_version", "model-slug-history-artifact@1"],
          ["acquisition_version", "model-slug-history-canonical@1"],
          ["projection_version", "model-slug@1"],
        ] as const) {
          await env.SERVING_DB.prepare(
            `UPDATE publication_model_slug_artifact_proof
             SET ${mutation[0]} = 'wrong-version' WHERE publication_id = ?1`,
          )
            .bind(PUBLICATION)
            .run();
          await expect(
            readModelDetailV2(env.SERVING_DB, "local", input(MODEL_ID)),
          ).resolves.toEqual({ outcome: "integrity_failure" });
          await env.SERVING_DB.prepare(
            `UPDATE publication_model_slug_artifact_proof
             SET ${mutation[0]} = ?2 WHERE publication_id = ?1`,
          )
            .bind(PUBLICATION, mutation[1])
            .run();
        }
      } finally {
        await env.SERVING_DB.exec("PRAGMA ignore_check_constraints = OFF");
      }
    } finally {
      await restoreTriggers(
        ["publication_model_slug_artifact_proof_immutable_update"],
        definitions,
      );
    }

    const proof = await env.SERVING_DB.prepare(
      "SELECT * FROM publication_model_slug_artifact_proof WHERE publication_id = ?1",
    )
      .bind(PUBLICATION)
      .first();
    if (proof === null) throw new Error("fixture artifact proof is missing");
    const columns = Object.keys(proof);
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_model_slug_artifact_proof_immutable_delete",
    ).run();
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_model_slug_artifact_proof_insert_guard",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        "DELETE FROM publication_model_slug_artifact_proof WHERE publication_id = ?1",
      )
        .bind(PUBLICATION)
        .run();
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input(HISTORICAL_SLUG)),
      ).resolves.toEqual({ outcome: "integrity_failure" });
      await env.SERVING_DB.prepare(
        `INSERT INTO publication_model_slug_artifact_proof (${columns.join(",")})
         VALUES (${columns.map((_, index) => `?${String(index + 1)}`).join(",")})`,
      )
        .bind(...columns.map((column) => proof[column]))
        .run();
    } finally {
      await restoreTriggers(
        [
          "publication_model_slug_artifact_proof_insert_guard",
          "publication_model_slug_artifact_proof_immutable_delete",
        ],
        definitions,
      );
    }

    const current = await env.SERVING_DB.prepare(
      `SELECT * FROM publication_model_slug_mapping
       WHERE publication_id = ?1 AND resolution = 'current'`,
    )
      .bind(PUBLICATION)
      .first();
    if (current === null) throw new Error("fixture current mapping is missing");
    const historical = await env.SERVING_DB.prepare(
      `SELECT * FROM publication_model_slug_mapping
       WHERE publication_id = ?1 AND resolution = 'historical'`,
    )
      .bind(PUBLICATION)
      .first();
    if (historical === null)
      throw new Error("fixture historical mapping is missing");
    const mappingColumns = Object.keys(current);
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_model_slug_mapping_immutable_update",
    ).run();
    try {
      for (const mutation of [
        [
          "target_content_hash",
          `sha256:${"0".repeat(64)}`,
          current.target_content_hash,
        ],
        ["slug", "drifted-runtime-model", CURRENT_SLUG],
      ] as const) {
        await env.SERVING_DB.prepare(
          `UPDATE publication_model_slug_mapping SET ${mutation[0]} = ?2
           WHERE publication_id = ?1 AND resolution = 'current'`,
        )
          .bind(PUBLICATION, mutation[1])
          .run();
        await expect(
          readModelDetailV2(env.SERVING_DB, "local", input(MODEL_ID)),
        ).resolves.toEqual({ outcome: "integrity_failure" });
        await env.SERVING_DB.prepare(
          `UPDATE publication_model_slug_mapping SET ${mutation[0]} = ?2
           WHERE publication_id = ?1 AND resolution = 'current'`,
        )
          .bind(PUBLICATION, mutation[2])
          .run();
      }
      await env.SERVING_DB.prepare(
        `UPDATE publication_model_slug_mapping
         SET target_content_hash = ?2
         WHERE publication_id = ?1 AND resolution = 'historical'`,
      )
        .bind(PUBLICATION, `sha256:${"0".repeat(64)}`)
        .run();
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input(HISTORICAL_SLUG)),
      ).resolves.toEqual({ outcome: "integrity_failure" });
      await env.SERVING_DB.prepare(
        `UPDATE publication_model_slug_mapping
         SET target_content_hash = ?2
         WHERE publication_id = ?1 AND resolution = 'historical'`,
      )
        .bind(PUBLICATION, historical.target_content_hash)
        .run();
    } finally {
      await restoreTriggers(
        ["publication_model_slug_mapping_immutable_update"],
        definitions,
      );
    }

    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_model_slug_mapping_immutable_delete",
    ).run();
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_model_slug_mapping_insert_guard",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        `DELETE FROM publication_model_slug_mapping
         WHERE publication_id = ?1 AND resolution = 'current'`,
      )
        .bind(PUBLICATION)
        .run();
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input(MODEL_ID)),
      ).resolves.toEqual({ outcome: "integrity_failure" });
      await env.SERVING_DB.prepare(
        `INSERT INTO publication_model_slug_mapping (${mappingColumns.join(",")})
         VALUES (${mappingColumns.map((_, index) => `?${String(index + 1)}`).join(",")})`,
      )
        .bind(...mappingColumns.map((column) => current[column]))
        .run();
      await env.SERVING_DB.prepare(
        `DELETE FROM publication_model_slug_mapping
         WHERE publication_id = ?1 AND resolution = 'historical'`,
      )
        .bind(PUBLICATION)
        .run();
      await expect(
        env.SERVING_DB.prepare(
          `SELECT count(*) AS count FROM publication_model_slug_mapping
           WHERE publication_id = ?1 AND slug = ?2`,
        )
          .bind(ROLLBACK_PUBLICATION, HISTORICAL_SLUG)
          .first(),
      ).resolves.toEqual({ count: 1 });
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input(HISTORICAL_SLUG)),
      ).resolves.toEqual({
        outcome: "not_found",
        publicationId: PUBLICATION,
        schemaVersion: PUBLICATION_SCHEMA,
      });
      await env.SERVING_DB.prepare(
        `INSERT INTO publication_model_slug_mapping (${mappingColumns.join(",")})
         VALUES (${mappingColumns.map((_, index) => `?${String(index + 1)}`).join(",")})`,
      )
        .bind(...mappingColumns.map((column) => historical[column]))
        .run();
    } finally {
      await restoreTriggers(
        [
          "publication_model_slug_mapping_insert_guard",
          "publication_model_slug_mapping_immutable_delete",
        ],
        definitions,
      );
    }

    const resource = await env.SERVING_DB.prepare(
      `SELECT resource_json FROM publication_resource
       WHERE publication_id = ?1 AND resource_type = 'model'
         AND resource_id = ?2`,
    )
      .bind(PUBLICATION, MODEL_ID)
      .first<{ resource_json: string }>();
    if (resource === null) throw new Error("fixture Model resource is missing");
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_resource_immutable_update",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        `UPDATE publication_resource SET resource_json = ?3
         WHERE publication_id = ?1 AND resource_id = ?2`,
      )
        .bind(
          PUBLICATION,
          MODEL_ID,
          resource.resource_json.replace(CURRENT_SLUG, "drifted-runtime-model"),
        )
        .run();
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input(MODEL_ID)),
      ).resolves.toEqual({ outcome: "integrity_failure" });
      await env.SERVING_DB.prepare(
        `UPDATE publication_resource SET resource_json = ?3
         WHERE publication_id = ?1 AND resource_id = ?2`,
      )
        .bind(PUBLICATION, MODEL_ID, resource.resource_json)
        .run();
    } finally {
      await restoreTriggers(
        ["publication_resource_immutable_update"],
        definitions,
      );
    }
  });
});
