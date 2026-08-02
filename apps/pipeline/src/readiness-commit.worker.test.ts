import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { projectServingReadinessCommit } from "@quant-clarity/publication-core";

import { applyReadinessCommit } from "./readiness-commit.js";
import {
  createReadyPublicationFixture,
  type ReadyPublicationFixture,
} from "../test/serving-switch-fixture.js";

const PUBLICATION_A = "pub_11111111-1111-4111-8111-111111111111" as const;
const PUBLICATION_B = "pub_22222222-2222-4222-8222-222222222222" as const;
const PUBLICATION_C = "pub_33333333-3333-4333-8333-333333333333" as const;
const PUBLICATION_D = "pub_44444444-4444-4444-8444-444444444444" as const;
const PUBLICATION_E = "pub_55555555-5555-4555-8555-555555555555" as const;
const PUBLICATION_F = "pub_66666666-6666-4666-8666-666666666666" as const;
const PUBLICATION_G = "pub_77777777-7777-4777-8777-777777777777" as const;
const CONFLICT_HASH = `sha256:${"f".repeat(64)}`;

const statement = (
  database: D1Database,
  sql: string,
  values: readonly unknown[],
): D1PreparedStatement => database.prepare(sql).bind(...values);

const seedSealedPublication = async (
  database: D1Database,
  fixture: ReadyPublicationFixture,
): Promise<void> => {
  const { rows, manifest, seal } = fixture;
  await database.batch([
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
  ]);
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
};

type MutationFault =
  | Readonly<{ kind: "abort_after"; statement: number }>
  | Readonly<{ kind: "lose_response" }>
  | Readonly<{
      kind: "insert_orphan";
      fixture: ReadyPublicationFixture;
    }>;

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
          if (injected || statements.length !== 14)
            return session.batch(statements);
          injected = true;
          if (fault.kind === "lose_response") {
            await session.batch(statements);
            throw new Error("synthetic response loss");
          }
          if (fault.kind === "insert_orphan") {
            const binding =
              fault.fixture.readinessCommit.receiptRows.bindings[0];
            if (binding === undefined)
              throw new Error("fixture lacks a readiness binding");
            await database
              .prepare(
                "INSERT INTO publication_readiness_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              )
              .bind(
                binding.publication_id,
                binding.kind,
                binding.receipt_version,
                binding.receipt_hash,
                binding.environment,
                binding.closure_hash,
                binding.bundle_hash,
                binding.schema_version,
                binding.build_commit,
                binding.observed_at_ms,
              )
              .run();
            return session.batch(statements);
          }
          return session.batch([
            ...statements.slice(0, fault.statement),
            session.prepare("SELECT json('')"),
            ...statements.slice(fault.statement),
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

const expectCleanBuilding = async (
  database: D1Database,
  publicationId: string,
): Promise<void> => {
  await expect(
    one<{ state: string; ready_at_ms: number | null }>(
      database,
      "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
      publicationId,
    ),
  ).resolves.toEqual({ state: "building", ready_at_ms: null });
  await expect(
    one<{ count: number }>(
      database,
      `SELECT
        (SELECT count(*) FROM publication_readiness_receipt WHERE publication_id = ?1) +
        (SELECT count(*) FROM publication_archive_receipt WHERE publication_id = ?1) +
        (SELECT count(*) FROM publication_serving_receipt WHERE publication_id = ?1) +
        (SELECT count(*) FROM publication_vector_receipt WHERE publication_id = ?1) +
        (SELECT count(*) FROM publication_probe_receipt WHERE publication_id = ?1) +
        (SELECT count(*) FROM publication_readiness_attestation WHERE publication_id = ?1)
        AS count`,
      publicationId,
    ),
  ).resolves.toEqual({ count: 0 });
};

beforeAll(async () => {
  await applyD1Migrations(
    env.SERVING_DB,
    env.TEST_MIGRATIONS.filter(
      (migration) => migration.name <= "0006_exact_generation_activation.sql",
    ),
  );
});

describe("atomic readiness commit in workerd (SRCH-007, PIPE-044, PIPE-050–PIPE-053, QA-006)", () => {
  it("rolls back after every statement, commits exactly, and retries idempotently", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_A,
      now - 10 * 60_000,
    );
    await seedSealedPublication(env.SERVING_DB, fixture);
    for (let ordinal = 1; ordinal <= 14; ordinal += 1) {
      await expect(
        applyReadinessCommit(
          withOneMutationFault(env.SERVING_DB, {
            kind: "abort_after",
            statement: ordinal,
          }),
          fixture.readinessCommit,
        ),
      ).rejects.toMatchObject({
        code: "not_applied",
        retrySameProjection: true,
      });
      await expectCleanBuilding(env.SERVING_DB, PUBLICATION_A);
    }
    await expect(
      applyReadinessCommit(env.SERVING_DB, fixture.readinessCommit),
    ).resolves.toMatchObject({
      outcome: "applied",
      publicationId: PUBLICATION_A,
    });
    await expect(
      applyReadinessCommit(env.SERVING_DB, fixture.readinessCommit),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    await expect(
      one<{ state: string; ready_at_ms: number }>(
        env.SERVING_DB,
        "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
        PUBLICATION_A,
      ),
    ).resolves.toEqual({
      state: "ready",
      ready_at_ms: fixture.readinessCommit.transition.ready_at_ms,
    });
  });

  it("reconciles a real commit whose response is lost", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_B,
      now - 9 * 60_000,
    );
    await seedSealedPublication(env.SERVING_DB, fixture);
    await expect(
      applyReadinessCommit(
        withOneMutationFault(env.SERVING_DB, { kind: "lose_response" }),
        fixture.readinessCommit,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    await expect(
      one<{ state: string }>(
        env.SERVING_DB,
        "SELECT state FROM publication WHERE publication_id = ?",
        PUBLICATION_B,
      ),
    ).resolves.toEqual({ state: "ready" });
  });

  it("rejects a post-snapshot orphan instead of healing it", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_C,
      now - 8 * 60_000,
    );
    await seedSealedPublication(env.SERVING_DB, fixture);
    await expect(
      applyReadinessCommit(
        withOneMutationFault(env.SERVING_DB, {
          kind: "insert_orphan",
          fixture,
        }),
        fixture.readinessCommit,
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
    await expect(
      one<{ state: string }>(
        env.SERVING_DB,
        "SELECT state FROM publication WHERE publication_id = ?",
        PUBLICATION_C,
      ),
    ).resolves.toEqual({ state: "building" });
    await expect(
      one<{ count: number }>(
        env.SERVING_DB,
        "SELECT count(*) AS count FROM publication_readiness_receipt WHERE publication_id = ?",
        PUBLICATION_C,
      ),
    ).resolves.toEqual({ count: 1 });
  });

  it("serializes exact concurrent commits into applied plus idempotent success", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_D,
      now - 8 * 60_000,
    );
    await seedSealedPublication(env.SERVING_DB, fixture);
    const outcomes = await Promise.allSettled([
      applyReadinessCommit(env.SERVING_DB, fixture.readinessCommit),
      applyReadinessCommit(env.SERVING_DB, fixture.readinessCommit),
    ]);
    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(
      true,
    );
    expect(
      outcomes
        .filter((outcome) => outcome.status === "fulfilled")
        .map((outcome) => outcome.value.outcome)
        .sort(),
    ).toEqual(["applied", "idempotent_success"]);
    await expect(
      one<{ bindings: number; details: number; attestations: number }>(
        env.SERVING_DB,
        `SELECT
          (SELECT count(*) FROM publication_readiness_receipt WHERE publication_id = ?1) AS bindings,
          (SELECT count(*) FROM publication_archive_receipt WHERE publication_id = ?1) +
          (SELECT count(*) FROM publication_serving_receipt WHERE publication_id = ?1) +
          (SELECT count(*) FROM publication_vector_receipt WHERE publication_id = ?1) +
          (SELECT count(*) FROM publication_probe_receipt WHERE publication_id = ?1) AS details,
          (SELECT count(*) FROM publication_readiness_attestation WHERE publication_id = ?1) AS attestations`,
        PUBLICATION_D,
      ),
    ).resolves.toEqual({ bindings: 4, details: 4, attestations: 1 });
  });

  it("keeps the winner intact when trusted concurrent projections conflict", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_E,
      now - 8 * 60_000,
    );
    await seedSealedPublication(env.SERVING_DB, fixture);
    const alternate = await projectServingReadinessCommit({
      closureRows: fixture.rows,
      persistedSeal: fixture.seal,
      receiptRows: fixture.receipts,
      environment: "local",
      readyAtMs: fixture.readinessCommit.transition.ready_at_ms + 1_000,
      maximumReceiptAgeMs:
        fixture.readinessCommit.attestation.maximum_receipt_age_ms,
    });
    if (alternate.decision !== "ready")
      throw new Error("alternate readiness projection was blocked");
    const outcomes = await Promise.allSettled([
      applyReadinessCommit(env.SERVING_DB, fixture.readinessCommit),
      applyReadinessCommit(env.SERVING_DB, alternate.projection),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const winner = outcomes.find((outcome) => outcome.status === "fulfilled");
    const loser = outcomes.find((outcome) => outcome.status === "rejected");
    if (winner?.status !== "fulfilled" || loser?.status !== "rejected")
      throw new Error("expected one readiness winner and one loser");
    expect(winner.value.outcome).toBe("applied");
    expect(loser.reason).toMatchObject({ code: "conflict" });
    await expect(
      one<{ ready_at_ms: number; count: number }>(
        env.SERVING_DB,
        `SELECT candidate.ready_at_ms,
          (SELECT count(*) FROM publication_readiness_attestation
           WHERE publication_id = candidate.publication_id) AS count
         FROM publication AS candidate WHERE publication_id = ?`,
        PUBLICATION_E,
      ),
    ).resolves.toEqual({ ready_at_ms: winner.value.readyAtMs, count: 1 });
  });

  it("rolls back all readiness rows when FTS parity is corrupt", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_F,
      now - 8 * 60_000,
    );
    await seedSealedPublication(env.SERVING_DB, fixture);
    await env.SERVING_DB.prepare(
      "DELETE FROM publication_search_fts WHERE publication_id = ?",
    )
      .bind(PUBLICATION_F)
      .run();
    await expect(
      applyReadinessCommit(env.SERVING_DB, fixture.readinessCommit),
    ).rejects.toMatchObject({
      code: "not_applied",
      retrySameProjection: true,
    });
    await expectCleanBuilding(env.SERVING_DB, PUBLICATION_F);
  });

  it("rejects a conflicting preexisting immutable binding", async () => {
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const fixture = await createReadyPublicationFixture(
      PUBLICATION_G,
      now - 8 * 60_000,
    );
    await seedSealedPublication(env.SERVING_DB, fixture);
    const binding = fixture.readinessCommit.receiptRows.bindings[0];
    if (binding === undefined) throw new Error("fixture lacks a binding");
    await env.SERVING_DB.prepare(
      "INSERT INTO publication_readiness_receipt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        binding.publication_id,
        binding.kind,
        binding.receipt_version,
        CONFLICT_HASH,
        binding.environment,
        binding.closure_hash,
        binding.bundle_hash,
        binding.schema_version,
        binding.build_commit,
        binding.observed_at_ms,
      )
      .run();
    await expect(
      applyReadinessCommit(env.SERVING_DB, fixture.readinessCommit),
    ).rejects.toMatchObject({ code: "conflict", retrySameProjection: false });
    await expect(
      one<{ state: string; count: number }>(
        env.SERVING_DB,
        `SELECT candidate.state,
          (SELECT count(*) FROM publication_readiness_receipt
           WHERE publication_id = candidate.publication_id) AS count
         FROM publication AS candidate WHERE publication_id = ?`,
        PUBLICATION_G,
      ),
    ).resolves.toEqual({ state: "building", count: 1 });
  });
});
