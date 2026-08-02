import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import type {
  PublicationRecord,
  ServingReadinessReceiptRows,
  StoredPublicationHead,
} from "@quant-clarity/publication-core";

import { applyServingSwitch } from "./serving-switch.js";
import { applyReadinessCommit } from "./readiness-commit.js";
import {
  createActivationProjection,
  createReadyPublicationFixture,
  createRollbackProjection,
  type ReadyPublicationFixture,
} from "../test/serving-switch-fixture.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const PUBLICATION_A = `pub_${UUID_A}` as const;
const PUBLICATION_B = `pub_${UUID_B}` as const;
const iso = (value: number): string => new Date(value).toISOString();

const statement = (
  database: D1Database,
  sql: string,
  values: readonly unknown[],
): D1PreparedStatement => database.prepare(sql).bind(...values);

const insertReceiptStatements = (
  database: D1Database,
  rows: ServingReadinessReceiptRows,
): D1PreparedStatement[] => {
  const statements: D1PreparedStatement[] = [];
  for (const row of rows.bindings)
    statements.push(
      statement(
        database,
        "INSERT INTO publication_readiness_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          row.publication_id,
          row.kind,
          row.receipt_version,
          row.receipt_hash,
          row.environment,
          row.closure_hash,
          row.bundle_hash,
          row.schema_version,
          row.build_commit,
          row.observed_at_ms,
        ],
      ),
    );
  for (const row of rows.archives)
    statements.push(
      statement(
        database,
        "INSERT INTO publication_archive_receipt VALUES (?, ?, ?, ?)",
        [row.publication_id, row.kind, row.retained_bundle_hash, row.immutable],
      ),
    );
  for (const row of rows.servings)
    statements.push(
      statement(
        database,
        "INSERT INTO publication_serving_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          row.publication_id,
          row.kind,
          row.enabled_provider_count,
          row.enabled_provider_scope_hash,
          row.provider_slice_count,
          row.provider_slice_hash,
          row.provider_attribution_count,
          row.provider_attribution_hash,
          row.resource_count,
          row.exact_document_count,
          row.resource_inventory_hash,
          row.exact_search_inventory_hash,
          row.fts_build_version,
          row.fts_document_count,
          row.fts_queryable,
          row.foreign_keys_valid,
          row.content_hashes_valid,
          row.unavailable_provider_isolation_valid,
        ],
      ),
    );
  for (const row of rows.vectors)
    statements.push(
      statement(
        database,
        "INSERT INTO publication_vector_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          row.publication_id,
          row.kind,
          row.vector_namespace,
          row.document_count,
          row.verified_document_count,
          row.vector_inventory_hash,
          row.visibility_probe_version,
          row.mutation_id,
          row.all_ids_present,
          row.all_namespaces_match,
          row.queryable,
        ],
      ),
    );
  for (const row of rows.probes)
    statements.push(
      statement(
        database,
        "INSERT INTO publication_probe_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          row.publication_id,
          row.kind,
          row.probe_set_version,
          row.integrity_passed,
          row.evidence_coverage_passed,
          row.exact_search_passed,
          row.semantic_search_passed,
          row.structured_filter_passed,
          row.neutrality_passed,
          row.version_isolation_passed,
        ],
      ),
    );
  return statements;
};

const seedReadyPublication = async (
  database: D1Database,
  fixture: ReadyPublicationFixture,
): Promise<void> => {
  const { rows, manifest, seal, receipts, attestation } = fixture;
  const staged = [
    statement(
      database,
      "INSERT INTO publication VALUES (?, 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, 'vector@1', ?, '[]', ?)",
      [
        manifest.publicationId,
        manifest.versions.schema,
        manifest.versions.methodology,
        manifest.versions.precisionNormalization,
        manifest.versions.precisionDisplayOrder,
        manifest.versions.pricePolicy,
        manifest.versions.sourcePolicy,
        manifest.versions.embedding,
        manifest.versions.buildCommit,
        manifest.sourceRunId,
        Date.parse(manifest.generatedAt),
        manifest.resources.length,
        manifest.searchDocuments.length,
        manifest.vectors.length,
        manifest.exactSearchInventoryHash,
        manifest.closureHash,
        Date.parse(manifest.generatedAt),
      ],
    ),
    ...rows.providerSlices.flatMap((row) => [
      statement(
        database,
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, ?, ?)",
        [
          row.provider_slice_id,
          manifest.publicationId,
          row.provider_id,
          row.provider_run_id,
          row.carried_forward,
          row.freshness_state,
        ],
      ),
      statement(
        database,
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.provider_id,
          row.adapter_version,
          row.roster_version,
          row.source_register_version,
        ],
      ),
    ]),
    ...rows.resources.map((row) =>
      statement(
        database,
        "INSERT INTO publication_resource VALUES (?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.resource_type,
          row.resource_id,
          row.resource_json,
          row.content_hash,
        ],
      ),
    ),
    ...rows.providerAttributions.map((row) =>
      statement(
        database,
        "INSERT INTO publication_provider_attribution VALUES (?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.resource_type,
          row.resource_id,
          row.provider_id,
        ],
      ),
    ),
    ...rows.searchDocuments.map((row) =>
      statement(
        database,
        "INSERT INTO publication_search_document VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.document_id,
          row.resource_type,
          row.resource_id,
          row.normalized_name,
          row.aliases_json,
          row.publisher_name,
          row.provider_model_ids_json,
          row.document_text,
          row.content_hash,
        ],
      ),
    ),
    ...rows.vectors.map((row) =>
      statement(
        database,
        "INSERT INTO publication_vector_inventory VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.vector_namespace,
          row.vector_id,
          row.resource_type,
          row.resource_id,
          row.search_document_content_hash,
          row.embedding_input_hash,
        ],
      ),
    ),
    ...rows.chunks.map((row) =>
      statement(
        database,
        "INSERT INTO publication_inventory_chunk VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.kind,
          row.ordinal,
          row.first_key,
          row.last_key,
          row.item_count,
          row.content_hash,
        ],
      ),
    ),
  ];
  await database.batch(staged);
  await database.batch([
    statement(
      database,
      "INSERT INTO publication_closure_seal VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        seal.publication_id,
        seal.staging_revision,
        seal.manifest_contract_version,
        seal.hash_domain,
        seal.hash_encoding_version,
        seal.enabled_provider_scope_version,
        seal.enabled_provider_count,
        seal.provider_slice_count,
        seal.provider_attribution_count,
        seal.resource_count,
        seal.exact_document_count,
        seal.vector_document_count,
        seal.chunk_count,
        seal.bundle_hash,
        seal.enabled_provider_scope_hash,
        seal.provider_slice_hash,
        seal.provider_attribution_hash,
        seal.resource_inventory_hash,
        seal.exact_search_inventory_hash,
        seal.vector_inventory_hash,
        seal.chunk_root_hash,
        seal.closure_hash,
        seal.sealed_at_ms,
      ],
    ),
  ]);
  await database.batch([
    ...insertReceiptStatements(database, receipts),
    statement(
      database,
      "INSERT INTO publication_readiness_attestation VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        attestation.publication_id,
        attestation.environment,
        attestation.closure_hash,
        attestation.bundle_hash,
        attestation.evaluator_version,
        attestation.ready_at_ms,
        attestation.maximum_receipt_age_ms,
        attestation.effective_valid_until_ms,
        attestation.archive_observed_at_ms,
        attestation.serving_observed_at_ms,
        attestation.vector_observed_at_ms,
        attestation.probes_observed_at_ms,
        attestation.archive_receipt_hash,
        attestation.serving_receipt_hash,
        attestation.vector_receipt_hash,
        attestation.probes_receipt_hash,
        attestation.attestation_hash,
      ],
    ),
    statement(
      database,
      "UPDATE publication SET state = 'ready', ready_at_ms = ? WHERE publication_id = ?",
      [attestation.ready_at_ms, manifest.publicationId],
    ),
  ]);
};

type MutationFault =
  | Readonly<{ kind: "lose_response" }>
  | Readonly<{ kind: "abort_after"; statement: 1 | 2 | 3 }>;

const withOneMutationFault = (
  database: D1Database,
  fault: MutationFault,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          if (injected || statements.length !== 3)
            return session.batch(statements);
          injected = true;
          if (fault.kind === "lose_response") {
            await session.batch(statements);
            throw new Error("synthetic response loss");
          }
          const index = fault.statement;
          return session.batch([
            ...statements.slice(0, index),
            session.prepare("SELECT json('')"),
            ...statements.slice(index),
          ]);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const one = async <T>(
  database: D1Database,
  sql: string,
  ...values: unknown[]
): Promise<T> => {
  const row = await database
    .prepare(sql)
    .bind(...values)
    .first<T>();
  if (row === null) throw new Error("expected one D1 row");
  return row;
};

beforeAll(async () => {
  await applyD1Migrations(
    env.SERVING_DB,
    env.TEST_MIGRATIONS.filter(
      (migration) => migration.name <= "0006_exact_generation_activation.sql",
    ),
  );
});

describe("fixed serving switch transaction in workerd (PIPE-044, PIPE-050–PIPE-056, QA-006)", () => {
  it("activates, reconciles response loss, and atomically rolls back failures after every mutation statement", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixtureA = await createReadyPublicationFixture(
      PUBLICATION_A,
      now - 10 * 60_000,
    );
    await seedReadyPublication(env.SERVING_DB, fixtureA);
    const activationAAt = now - 90_000;
    const activationA = await createActivationProjection(
      fixtureA,
      activationAAt,
    );
    await expect(
      applyServingSwitch(env.SERVING_DB, activationA),
    ).resolves.toMatchObject({ outcome: "applied", generation: 1 });
    await expect(
      applyReadinessCommit(env.SERVING_DB, fixtureA.readinessCommit),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    await expect(
      applyServingSwitch(env.SERVING_DB, activationA),
    ).resolves.toMatchObject({ outcome: "idempotent_success", generation: 1 });

    const fixtureB = await createReadyPublicationFixture(
      PUBLICATION_B,
      now - 9 * 60_000,
    );
    await seedReadyPublication(env.SERVING_DB, fixtureB);
    const headA: StoredPublicationHead = {
      activePublicationId: PUBLICATION_A,
      rollbackCandidatePublicationId: null,
      switchedAt: iso(activationAAt),
      generation: 1,
    };
    const activeA: PublicationRecord = {
      ...fixtureA.record,
      state: "active",
      firstActivatedAt: iso(activationAAt),
      lastHeadReferencedAt: iso(activationAAt),
    };
    const activationBAt = now - 60_000;
    const activationB = await createActivationProjection(
      fixtureB,
      activationBAt,
      headA,
      activeA,
    );
    await expect(
      applyServingSwitch(
        withOneMutationFault(env.SERVING_DB, { kind: "lose_response" }),
        activationB,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success", generation: 2 });

    const headB: StoredPublicationHead = {
      activePublicationId: PUBLICATION_B,
      rollbackCandidatePublicationId: PUBLICATION_A,
      switchedAt: iso(activationBAt),
      generation: 2,
    };
    const activeB: PublicationRecord = {
      ...fixtureB.record,
      state: "active",
      firstActivatedAt: iso(activationBAt),
      lastHeadReferencedAt: iso(activationBAt),
    };
    const rollback = await createRollbackProjection(
      fixtureA,
      iso(activationAAt),
      headB,
      activeB,
      now - 30_000,
    );

    for (const mutationStatement of [1, 2, 3] as const) {
      await expect(
        applyServingSwitch(
          withOneMutationFault(env.SERVING_DB, {
            kind: "abort_after",
            statement: mutationStatement,
          }),
          rollback,
        ),
      ).rejects.toMatchObject({
        code: "not_applied",
        retrySameProjection: true,
      });
      await expect(
        one<{
          active_publication_id: string;
          rollback_candidate_publication_id: string;
          switched_at_ms: number;
          generation: number;
        }>(
          env.SERVING_DB,
          "SELECT active_publication_id, rollback_candidate_publication_id, switched_at_ms, generation FROM publication_head WHERE singleton = 1",
        ),
      ).resolves.toEqual({
        active_publication_id: PUBLICATION_B,
        rollback_candidate_publication_id: PUBLICATION_A,
        switched_at_ms: activationBAt,
        generation: 2,
      });
      await expect(
        one<{ count: number }>(
          env.SERVING_DB,
          "SELECT (SELECT count(*) FROM publication_switch_preflight WHERE new_generation = 3) + (SELECT count(*) FROM publication_switch_history WHERE new_generation = 3) AS count",
        ),
      ).resolves.toEqual({ count: 0 });
      await expect(
        one<{ state: string; activated_at_ms: number }>(
          env.SERVING_DB,
          "SELECT state, activated_at_ms FROM publication WHERE publication_id = ?",
          PUBLICATION_A,
        ),
      ).resolves.toEqual({
        state: "superseded",
        activated_at_ms: activationAAt,
      });
      await expect(
        one<{ state: string; activated_at_ms: number }>(
          env.SERVING_DB,
          "SELECT state, activated_at_ms FROM publication WHERE publication_id = ?",
          PUBLICATION_B,
        ),
      ).resolves.toEqual({
        state: "active",
        activated_at_ms: activationBAt,
      });
    }

    await expect(
      applyServingSwitch(env.SERVING_DB, rollback),
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
    await expect(
      one<{ state: string; activated_at_ms: number }>(
        env.SERVING_DB,
        "SELECT state, activated_at_ms FROM publication WHERE publication_id = ?",
        PUBLICATION_A,
      ),
    ).resolves.toEqual({
      state: "active",
      activated_at_ms: activationAAt,
    });
    await expect(
      one<{ state: string; activated_at_ms: number }>(
        env.SERVING_DB,
        "SELECT state, activated_at_ms FROM publication WHERE publication_id = ?",
        PUBLICATION_B,
      ),
    ).resolves.toEqual({
      state: "rolled_back",
      activated_at_ms: activationBAt,
    });
  });
});
