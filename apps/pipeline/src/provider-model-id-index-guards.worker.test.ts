import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const PUBLICATION_ID = "pub_faaaaaaa-0000-4000-8000-000000000001";
const HASH = `sha256:${"1".repeat(64)}`;
const OTHER_HASH = `sha256:${"2".repeat(64)}`;

const proofInsertions = [
  {
    proofTable: "publication_readiness_attestation",
    guardMessage:
      "provider model ID exact indexes are missing malformed or unqueryable",
    statement: () =>
      env.SERVING_DB.prepare(
        `INSERT INTO publication_readiness_attestation(
          publication_id, environment, closure_hash, bundle_hash,
          evaluator_version, ready_at_ms, maximum_receipt_age_ms,
          effective_valid_until_ms, archive_observed_at_ms,
          serving_observed_at_ms, vector_observed_at_ms,
          probes_observed_at_ms, archive_receipt_hash,
          serving_receipt_hash, vector_receipt_hash,
          probes_receipt_hash, attestation_hash
        ) VALUES (?1, 'local', ?2, ?3, '4.0.0', 0, 0, 0,
          0, 0, 0, 0, ?2, ?2, ?2, ?2, ?2)`,
      ).bind(PUBLICATION_ID, HASH, OTHER_HASH),
  },
  {
    proofTable: "publication_switch_history",
    guardMessage:
      "switch-time provider model ID exact indexes are missing malformed or unqueryable",
    statement: () =>
      env.SERVING_DB.prepare(
        `INSERT INTO publication_switch_history(
          switch_id, event_version, event_hash, preflight_hash, action,
          expected_prior_generation,
          expected_prior_rollback_candidate_publication_id,
          expected_prior_switched_at_ms, new_generation,
          from_publication_id, from_closure_hash, to_publication_id,
          to_closure_hash, to_attestation_hash,
          resulting_rollback_candidate_publication_id, switched_at_ms,
          authorized_by_kind, authorized_identity_id
        ) VALUES ('switch-workerd-index-guard', '1.0.0', ?1, ?2,
          'activate', 0, NULL, NULL, 1, NULL, NULL, ?3, ?1, ?2,
          NULL, 0, 'pipeline', 'pipeline:workerd-index-guard')`,
      ).bind(HASH, OTHER_HASH, PUBLICATION_ID),
  },
] as const;

const indexDefinitions = [
  {
    name: "publication_provider_model_id_raw_exact_idx",
    columns: ["publication_id", "raw_provider_model_id_utf8", "offering_id"],
    wrongColumns: ["publication_id", "provider_id", "offering_id"],
  },
  {
    name: "publication_provider_model_id_normalized_exact_idx",
    columns: [
      "publication_id",
      "normalized_provider_model_id_utf8",
      "offering_id",
    ],
    wrongColumns: ["publication_id", "target_resource_id", "offering_id"],
  },
] as const;

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
});

describe("schema-1.7 provider-model-ID proof index guards in pinned workerd", () => {
  for (const proof of proofInsertions) {
    for (const index of indexDefinitions) {
      it(`atomically rejects and rolls back a wrong ${index.name} before direct ${proof.proofTable} insertion`, async () => {
        await expect(
          env.SERVING_DB.batch([
            env.SERVING_DB.prepare(`DROP INDEX ${index.name}`),
            env.SERVING_DB.prepare(
              `CREATE INDEX ${index.name} ON publication_provider_model_id_search_document(${index.wrongColumns.join(", ")})`,
            ),
            proof.statement(),
          ]),
        ).rejects.toThrow(proof.guardMessage);

        await expect(
          env.SERVING_DB.prepare(
            `SELECT name FROM pragma_index_info('${index.name}') ORDER BY seqno`,
          ).all<{ name: string }>(),
        ).resolves.toMatchObject({
          results: index.columns.map((name) => ({ name })),
        });
        await expect(
          env.SERVING_DB.prepare(
            `SELECT count(*) AS count FROM ${proof.proofTable}`,
          ).first<{ count: number }>(),
        ).resolves.toEqual({ count: 0 });
      });

      it(`atomically rejects and rolls back a missing ${index.name} before direct ${proof.proofTable} insertion`, async () => {
        await expect(
          env.SERVING_DB.batch([
            env.SERVING_DB.prepare(`DROP INDEX ${index.name}`),
            proof.statement(),
          ]),
        ).rejects.toThrow(index.name);

        await expect(
          env.SERVING_DB.prepare(
            `SELECT name FROM pragma_index_info('${index.name}') ORDER BY seqno`,
          ).all<{ name: string }>(),
        ).resolves.toMatchObject({
          results: index.columns.map((name) => ({ name })),
        });
      });
    }
  }
});
