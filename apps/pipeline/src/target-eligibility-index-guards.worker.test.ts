import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const PUBLICATION_ID = "pub_fbbbbbbb-0000-4000-8000-000000000001";
const HASH = `sha256:${"1".repeat(64)}`;
const OTHER_HASH = `sha256:${"2".repeat(64)}`;
const INDEX = "publication_provider_model_id_target_eligibility_idx";
const COLUMNS = [
  "publication_id",
  "target_resource_type",
  "target_resource_id",
  "offering_id",
] as const;

const switchStatement = (action: "activate" | "rollback") =>
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
    ) VALUES (?1, '1.0.0', ?2, ?3, ?4, 0, NULL, NULL, 1,
      NULL, NULL, ?5, ?2, ?3, NULL, 0,
      'pipeline', 'pipeline:target-index-guard')`,
  ).bind(
    `switch-target-index-${action}`,
    HASH,
    OTHER_HASH,
    action,
    PUBLICATION_ID,
  );

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
});

describe("schema-1.11 target eligibility switch guards in pinned workerd", () => {
  for (const action of ["activate", "rollback"] as const) {
    it(`atomically rejects and restores a malformed index before ${action}`, async () => {
      await expect(
        env.SERVING_DB.batch([
          env.SERVING_DB.prepare(`DROP INDEX ${INDEX}`),
          env.SERVING_DB.prepare(
            `CREATE INDEX ${INDEX}
             ON publication_provider_model_id_search_document(
               publication_id, provider_id, offering_id
             )`,
          ),
          switchStatement(action),
        ]),
      ).rejects.toThrow(
        "switch-time target eligibility index is missing malformed or unqueryable",
      );

      await expect(
        env.SERVING_DB.prepare(
          `SELECT name FROM pragma_index_info('${INDEX}') ORDER BY seqno`,
        ).all<{ name: string }>(),
      ).resolves.toMatchObject({
        results: COLUMNS.map((name) => ({ name })),
      });
      await expect(
        env.SERVING_DB.prepare(
          "SELECT count(*) AS count FROM publication_switch_history",
        ).first<{ count: number }>(),
      ).resolves.toEqual({ count: 0 });
    });

    it(`atomically rejects and restores a missing index before ${action}`, async () => {
      await expect(
        env.SERVING_DB.batch([
          env.SERVING_DB.prepare(`DROP INDEX ${INDEX}`),
          switchStatement(action),
        ]),
      ).rejects.toThrow(INDEX);

      await expect(
        env.SERVING_DB.prepare(
          `SELECT name FROM pragma_index_info('${INDEX}') ORDER BY seqno`,
        ).all<{ name: string }>(),
      ).resolves.toMatchObject({
        results: COLUMNS.map((name) => ({ name })),
      });
    });
  }
});
