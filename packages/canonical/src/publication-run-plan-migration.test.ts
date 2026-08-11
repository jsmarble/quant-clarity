import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

const MIGRATION = "0005_publication_run_plan_authority.sql";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;
const APPROVAL_ROLES =
  '["legal_source_owner","platform_owner","product_owner"]';

const AUTHORITY_OBJECTS = [
  "publication_run_plan_authority_integrity_metadata",
  "publication_run_plan",
  "publication_run_plan_provider",
  "publication_run_plan_policy",
  "publication_run_plan_seal",
  "publication_run_plan_approval",
  "publication_run_plan_revocation",
  "publication_run_plan_effective_idx",
  "publication_run_plan_provider_ordinal_uq",
  "publication_run_plan_authority_integrity_metadata_insert_guard",
  "publication_run_plan_authority_integrity_metadata_immutable_update",
  "publication_run_plan_authority_integrity_metadata_immutable_delete",
  "publication_run_plan_insert_guard",
  "publication_run_plan_immutable_update",
  "publication_run_plan_immutable_delete",
  "publication_run_plan_provider_insert_guard",
  "publication_run_plan_provider_immutable_update",
  "publication_run_plan_provider_immutable_delete",
  "provider_roster_item_run_plan_frozen_insert",
  "provider_roster_run_plan_frozen_update",
  "provider_roster_run_plan_frozen_delete",
  "provider_roster_item_run_plan_frozen_update",
  "provider_roster_item_run_plan_frozen_delete",
  "source_compliance_run_plan_frozen_update",
  "source_compliance_run_plan_frozen_delete",
  "publication_run_plan_policy_insert_guard",
  "publication_run_plan_policy_immutable_update",
  "publication_run_plan_policy_immutable_delete",
  "publication_run_plan_seal_insert_guard",
  "publication_run_plan_seal_immutable_update",
  "publication_run_plan_seal_immutable_delete",
  "publication_run_plan_approval_insert_guard",
  "publication_run_plan_approval_immutable_update",
  "publication_run_plan_approval_immutable_delete",
  "publication_run_plan_revocation_insert_guard",
  "publication_run_plan_revocation_immutable_update",
  "publication_run_plan_revocation_immutable_delete",
] as const;

function id(prefix: string, sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
}

function migrationSql(filename = MIGRATION): string {
  return readFileSync(resolve("migrations", "canonical", filename), "utf8");
}

function applyAtomicMigration(database: DatabaseSync, sql: string): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(sql);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function predecessor(through = "0004_model_slug_history_integrity.sql") {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const filename of readdirSync(
    resolve("migrations", "canonical"),
  ).sort()) {
    if (filename > through) continue;
    applyAtomicMigration(database, migrationSql(filename));
  }
  return database;
}

function applyAuthorityMigration(database: DatabaseSync): void {
  applyAtomicMigration(database, migrationSql());
}

function expectConstraint(action: () => unknown, message?: string): void {
  expect(action).toThrow(
    message ?? /constraint|immutable|cannot|lacks|incomplete/iu,
  );
}

function seedProvider(
  database: DatabaseSync,
  sequence: number,
  options: { sourceApproval?: "approved" | "pending" } = {},
) {
  const providerId = id("prv", sequence);
  const rosterVersion = `roster@${String(sequence)}`;
  const sourceRegisterVersion = `sources@${String(sequence)}`;
  const rosterHash = sequence % 2 === 0 ? HASH_A : HASH_B;
  const sourceHash = sequence % 2 === 0 ? HASH_C : HASH_D;
  database
    .prepare(
      "INSERT INTO resource_identity(resource_id, resource_type, created_at_ms) VALUES (?, 'provider', 1)",
    )
    .run(providerId);
  database
    .prepare(
      "INSERT INTO provider(provider_id, slug, display_name, normalized_name, status, aliases_json, created_at_ms) VALUES (?, ?, ?, ?, 'active', '[]', 1)",
    )
    .run(
      providerId,
      `provider-${String(sequence)}`,
      `Provider ${String(sequence)}`,
      `provider ${String(sequence)}`,
    );
  database
    .prepare(
      "INSERT INTO provider_roster(provider_id, roster_version, content_hash, created_at_ms) VALUES (?, ?, ?, 1)",
    )
    .run(providerId, rosterVersion, rosterHash);
  database
    .prepare(
      `INSERT INTO source_compliance_record(
        provider_id, register_version, artifact_path, artifact_hash,
        source_ids_json, reviewer_role, reviewed_at_ms, next_review_at_ms,
        approval_state, access_permitted, retention_permitted,
        excerpt_permitted, publication_permitted,
        attribution_requirements, restrictions, created_at_ms
      ) VALUES (?, ?, ?, ?, '["catalog"]', 'legal_source_owner', 1, 100,
        ?, ?, ?, ?, ?, '', '', 1)`,
    )
    .run(
      providerId,
      sourceRegisterVersion,
      `docs/compliance/sources/provider-${String(sequence)}.md`,
      sourceHash,
      options.sourceApproval ?? "approved",
      options.sourceApproval === "pending" ? 0 : 1,
      options.sourceApproval === "pending" ? 0 : 1,
      options.sourceApproval === "pending" ? 0 : 1,
      options.sourceApproval === "pending" ? 0 : 1,
    );
  return {
    providerId,
    rosterVersion,
    rosterHash,
    sourceRegisterVersion,
    sourceHash,
  };
}

function insertPlan(
  database: DatabaseSync,
  input: {
    sequence?: number;
    providerCount?: number;
    providerScopeHash?: string;
    policySetHash?: string;
    planHash?: string;
  } = {},
) {
  const sequence = input.sequence ?? 1;
  const runPlanId = id("rpl", sequence);
  const providerScopeHash = input.providerScopeHash ?? HASH_A;
  const policySetHash = input.policySetHash ?? HASH_B;
  const planHash = input.planHash ?? HASH_C;
  database
    .prepare(
      `INSERT INTO publication_run_plan(
        run_plan_id, contract_version, canonical_schema_version,
        pipeline_contract_version, environment, schedule_name,
        schedule_expression, effective_from_ms, effective_to_ms,
        provider_count, provider_scope_hash, policy_set_hash, plan_hash,
        created_at_ms
      ) VALUES (?, 'publication-run-plan@1', '1.0.0',
        'pipeline-contract@1', 'preview',
        'provider-refresh-v1', '0 5 * * 1,4', 20, 40, ?, ?, ?, ?, 10)`,
    )
    .run(
      runPlanId,
      input.providerCount ?? 1,
      providerScopeHash,
      policySetHash,
      planHash,
    );
  return { runPlanId, providerScopeHash, policySetHash, planHash };
}

function insertPlanProvider(
  database: DatabaseSync,
  runPlanId: string,
  ordinal: number,
  provider: ReturnType<typeof seedProvider>,
): void {
  database
    .prepare(
      `INSERT INTO publication_run_plan_provider(
        run_plan_id, ordinal, provider_id, adapter_version,
        roster_version, roster_content_hash,
        source_register_version, source_artifact_hash,
        request_ceiling, byte_ceiling, ai_token_ceiling,
        browser_millisecond_ceiling, elapsed_millisecond_ceiling,
        cost_microusd_ceiling, retry_policy_hash
      ) VALUES (?, ?, ?, '1.0.0+sha256.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ?, ?, ?, ?, 10, 1000, 100, 0, 43200000, 1000000, ?)`,
    )
    .run(
      runPlanId,
      ordinal,
      provider.providerId,
      provider.rosterVersion,
      provider.rosterHash,
      provider.sourceRegisterVersion,
      provider.sourceHash,
      HASH_D,
    );
}

function insertPolicies(database: DatabaseSync, runPlanId: string): void {
  const statement = database.prepare(
    "INSERT INTO publication_run_plan_policy VALUES (?, ?, '1.0.0', ?)",
  );
  statement.run(runPlanId, "run_budget", HASH_A);
  statement.run(runPlanId, "provider_retry", HASH_B);
  statement.run(runPlanId, "terminal_deadline", HASH_C);
}

function insertSeal(
  database: DatabaseSync,
  plan: ReturnType<typeof insertPlan>,
  sealedAt = 15,
): void {
  database
    .prepare(
      `INSERT INTO publication_run_plan_seal(
        run_plan_id, contract_version, provider_count, provider_scope_hash,
        policy_count, policy_set_hash, plan_hash, sealed_at_ms
      ) SELECT run_plan_id, contract_version, provider_count,
        provider_scope_hash, 3, policy_set_hash, plan_hash, ?
      FROM publication_run_plan WHERE run_plan_id = ?`,
    )
    .run(sealedAt, plan.runPlanId);
}

function insertApproval(
  database: DatabaseSync,
  runPlanId: string,
  approvedAt = 18,
): void {
  database
    .prepare(
      `INSERT INTO publication_run_plan_approval(
        run_plan_id, approval_roles_json, artifact_path,
        artifact_hash, approved_at_ms
      ) VALUES (?, ?, 'docs/compliance/run-plans/preview-plan.md', ?, ?)`,
    )
    .run(runPlanId, APPROVAL_ROLES, HASH_D, approvedAt);
}

describe("canonical publication run-plan authority migration (PIPE-001–PIPE-004, PIPE-045)", () => {
  it("seals and approves one exact normalized plan without changing operational run tables", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    const provider = seedProvider(database, 2);
    const plan = insertPlan(database);
    insertPlanProvider(database, plan.runPlanId, 0, provider);
    insertPolicies(database, plan.runPlanId);
    insertSeal(database, plan);
    insertApproval(database, plan.runPlanId);

    expect(
      database
        .prepare(
          `SELECT plan.run_plan_id, plan.contract_version,
             plan.canonical_schema_version, plan.pipeline_contract_version,
             plan.environment,
             plan.schedule_name, plan.schedule_expression,
             plan.effective_from_ms, plan.effective_to_ms,
             seal.provider_count, seal.policy_count,
             approval.approval_roles_json
           FROM publication_run_plan AS plan
           JOIN publication_run_plan_seal AS seal USING (run_plan_id)
           JOIN publication_run_plan_approval AS approval USING (run_plan_id)`,
        )
        .get(),
    ).toEqual({
      run_plan_id: plan.runPlanId,
      contract_version: "publication-run-plan@1",
      canonical_schema_version: "1.0.0",
      pipeline_contract_version: "pipeline-contract@1",
      environment: "preview",
      schedule_name: "provider-refresh-v1",
      schedule_expression: "0 5 * * 1,4",
      effective_from_ms: 20,
      effective_to_ms: 40,
      provider_count: 1,
      policy_count: 3,
      approval_roles_json: APPROVAL_ROLES,
    });
    expect(
      database
        .prepare(
          "SELECT capability FROM publication_run_plan_authority_integrity_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ capability: "publication-run-plan-authority@1" });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ('schedule_occurrence', 'pipeline_run', 'provider_run')",
        )
        .get(),
    ).toEqual({ count: 3 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("enforces a nonempty complete canonically ordered provider scope", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    const lower = seedProvider(database, 2);
    const higher = seedProvider(database, 3);

    const empty = insertPlan(database, { sequence: 10 });
    insertPolicies(database, empty.runPlanId);
    expectConstraint(() => {
      insertSeal(database, empty);
    }, "publication run-plan provider scope is incomplete");

    const incomplete = insertPlan(database, {
      sequence: 11,
      providerCount: 2,
      planHash: HASH_D,
    });
    insertPlanProvider(database, incomplete.runPlanId, 0, lower);
    insertPolicies(database, incomplete.runPlanId);
    expectConstraint(() => {
      insertSeal(database, incomplete);
    }, "publication run-plan provider scope is incomplete");

    const duplicate = insertPlan(database, {
      sequence: 12,
      providerCount: 2,
      providerScopeHash: HASH_B,
      policySetHash: HASH_C,
      planHash: `sha256:${"e".repeat(64)}`,
    });
    insertPlanProvider(database, duplicate.runPlanId, 0, lower);
    expectConstraint(() => {
      insertPlanProvider(database, duplicate.runPlanId, 1, lower);
    }, "publication run-plan provider cannot be replaced");
    expectConstraint(() => {
      insertPlanProvider(database, duplicate.runPlanId, 0, higher);
    }, "publication run-plan provider cannot be replaced");

    const unsorted = insertPlan(database, {
      sequence: 13,
      providerCount: 2,
      providerScopeHash: HASH_C,
      policySetHash: HASH_D,
      planHash: `sha256:${"f".repeat(64)}`,
    });
    insertPlanProvider(database, unsorted.runPlanId, 0, higher);
    insertPlanProvider(database, unsorted.runPlanId, 1, lower);
    insertPolicies(database, unsorted.runPlanId);
    expectConstraint(() => {
      insertSeal(database, unsorted);
    }, "publication run-plan providers are not canonically ordered");
  });

  it("requires exact existing roster and source-register versions and hashes", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    const provider = seedProvider(database, 2, { sourceApproval: "pending" });
    const plan = insertPlan(database);
    const insert = database.prepare(
      `INSERT INTO publication_run_plan_provider VALUES (
        ?, 0, ?, 'adapter@1', ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?
      )`,
    );
    expectConstraint(
      () =>
        insert.run(
          plan.runPlanId,
          provider.providerId,
          "missing-roster",
          provider.rosterHash,
          provider.sourceRegisterVersion,
          provider.sourceHash,
          HASH_D,
        ),
      "publication run-plan provider lacks exact roster",
    );
    expectConstraint(
      () =>
        insert.run(
          plan.runPlanId,
          provider.providerId,
          provider.rosterVersion,
          provider.rosterHash,
          "missing-source",
          provider.sourceHash,
          HASH_D,
        ),
      "publication run-plan provider lacks exact source register",
    );
    insertPlanProvider(database, plan.runPlanId, 0, provider);
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_run_plan_provider WHERE run_plan_id = ?",
        )
        .get(plan.runPlanId),
    ).toEqual({ count: 1 });
  });

  it("freezes an exact roster as soon as a plan references it", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    const provider = seedProvider(database, 2);
    database
      .prepare(
        `INSERT INTO provider_roster_item VALUES (
          ?, ?, 'before-plan', 'model-a', 'default', 'chat', '', NULL
        )`,
      )
      .run(provider.providerId, provider.rosterVersion);
    const plan = insertPlan(database);
    insertPlanProvider(database, plan.runPlanId, 0, provider);
    expectConstraint(
      () =>
        database
          .prepare(
            `INSERT INTO provider_roster_item VALUES (
              ?, ?, 'after-reference', 'model-b', 'default', 'chat', '', NULL
            )`,
          )
          .run(provider.providerId, provider.rosterVersion),
      "run-plan-referenced provider roster cannot grow",
    );
    insertPolicies(database, plan.runPlanId);
    insertSeal(database, plan);
    insertApproval(database, plan.runPlanId);
    expectConstraint(
      () =>
        database
          .prepare(
            `INSERT INTO provider_roster_item VALUES (
              ?, ?, 'after-approval', 'model-c', 'default', 'chat', '', NULL
            )`,
          )
          .run(provider.providerId, provider.rosterVersion),
      "run-plan-referenced provider roster cannot grow",
    );
  });

  it("independently freezes referenced roster and source rows", () => {
    const database = predecessor();
    for (const trigger of [
      "provider_roster_immutable_update",
      "provider_roster_immutable_delete",
      "provider_roster_item_immutable_update",
      "provider_roster_item_immutable_delete",
      "source_compliance_immutable_update",
      "source_compliance_immutable_delete",
    ]) {
      database.exec(`DROP TRIGGER ${trigger}`);
    }
    applyAuthorityMigration(database);
    const provider = seedProvider(database, 2);
    database
      .prepare(
        `INSERT INTO provider_roster_item VALUES (
          ?, ?, 'frozen-item', 'model-a', 'default', 'chat', '', NULL
        )`,
      )
      .run(provider.providerId, provider.rosterVersion);
    const plan = insertPlan(database);
    insertPlanProvider(database, plan.runPlanId, 0, provider);

    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE provider_roster SET content_hash = ? WHERE provider_id = ? AND roster_version = ?",
          )
          .run(HASH_D, provider.providerId, provider.rosterVersion),
      "run-plan-referenced provider roster is immutable",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "DELETE FROM provider_roster WHERE provider_id = ? AND roster_version = ?",
          )
          .run(provider.providerId, provider.rosterVersion),
      "run-plan-referenced provider roster cannot be deleted",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE provider_roster_item SET provider_model_id = 'changed' WHERE provider_id = ? AND roster_version = ?",
          )
          .run(provider.providerId, provider.rosterVersion),
      "run-plan-referenced provider roster item is immutable",
    );
    database
      .prepare("INSERT INTO provider_roster VALUES (?, 'unreferenced@1', ?, 1)")
      .run(provider.providerId, HASH_D);
    database
      .prepare(
        `INSERT INTO provider_roster_item VALUES (
          ?, 'unreferenced@1', 'moving-item', 'model-b', 'default', 'chat', '', NULL
        )`,
      )
      .run(provider.providerId);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE provider_roster_item SET roster_version = ? WHERE provider_id = ? AND roster_version = 'unreferenced@1'",
          )
          .run(provider.rosterVersion, provider.providerId),
      "run-plan-referenced provider roster item is immutable",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "DELETE FROM provider_roster_item WHERE provider_id = ? AND roster_version = ?",
          )
          .run(provider.providerId, provider.rosterVersion),
      "run-plan-referenced provider roster item cannot be deleted",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE source_compliance_record SET approval_state = 'pending' WHERE provider_id = ? AND register_version = ?",
          )
          .run(provider.providerId, provider.sourceRegisterVersion),
      "run-plan-referenced source compliance is immutable",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "DELETE FROM source_compliance_record WHERE provider_id = ? AND register_version = ?",
          )
          .run(provider.providerId, provider.sourceRegisterVersion),
      "run-plan-referenced source compliance cannot be deleted",
    );
  });

  it("rejects provider-count overflow, malformed versions, and every malformed ceiling", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    expectConstraint(() => {
      insertPlan(database, { sequence: 30, providerCount: 17 });
    });

    const provider = seedProvider(database, 31);
    const insert = database.prepare(
      `INSERT INTO publication_run_plan_provider(
        run_plan_id, ordinal, provider_id, adapter_version,
        roster_version, roster_content_hash,
        source_register_version, source_artifact_hash,
        request_ceiling, byte_ceiling, ai_token_ceiling,
        browser_millisecond_ceiling, elapsed_millisecond_ceiling,
        cost_microusd_ceiling, retry_policy_hash
      ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ceilings = [0, 0, 0, 0, 0, 0];
    for (let index = 0; index < ceilings.length; index += 1) {
      const plan = insertPlan(database, {
        sequence: 40 + index,
        planHash: `sha256:${(index + 1).toString(16).repeat(64)}`,
      });
      const invalidCeilings = [...ceilings];
      invalidCeilings[index] = -1;
      expectConstraint(() =>
        insert.run(
          plan.runPlanId,
          provider.providerId,
          "adapter@1",
          provider.rosterVersion,
          provider.rosterHash,
          provider.sourceRegisterVersion,
          provider.sourceHash,
          ...invalidCeilings,
          HASH_D,
        ),
      );
    }

    const malformed = insertPlan(database, {
      sequence: 50,
      planHash: `sha256:${"f".repeat(64)}`,
    });
    expectConstraint(() =>
      insert.run(
        malformed.runPlanId,
        provider.providerId,
        "adapter\nversion",
        provider.rosterVersion,
        provider.rosterHash,
        provider.sourceRegisterVersion,
        provider.sourceHash,
        ...ceilings,
        HASH_D,
      ),
    );
  });

  it("requires the exact three-role policy set and matching seal hashes", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    const provider = seedProvider(database, 2);
    const plan = insertPlan(database);
    insertPlanProvider(database, plan.runPlanId, 0, provider);
    database
      .prepare(
        "INSERT INTO publication_run_plan_policy VALUES (?, 'run_budget', '1', ?)",
      )
      .run(plan.runPlanId, HASH_A);
    expectConstraint(() => {
      insertSeal(database, plan);
    }, "publication run-plan policy set is incomplete");
    database
      .prepare(
        "INSERT INTO publication_run_plan_policy VALUES (?, 'provider_retry', '1', ?), (?, 'terminal_deadline', '1', ?)",
      )
      .run(plan.runPlanId, HASH_B, plan.runPlanId, HASH_C);
    expectConstraint(
      () =>
        database
          .prepare(
            `INSERT INTO publication_run_plan_seal VALUES (
              ?, 'publication-run-plan@1', 1, ?, 3, ?, ?, 15
            )`,
          )
          .run(plan.runPlanId, HASH_D, plan.policySetHash, plan.planHash),
      "publication run-plan seal does not match its plan",
    );
    insertSeal(database, plan);
  });

  it("rejects alternate-key replacement of an unsealed plan", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    const plan = insertPlan(database);
    expectConstraint(
      () =>
        database
          .prepare(
            `INSERT OR REPLACE INTO publication_run_plan(
              run_plan_id, contract_version, canonical_schema_version,
              pipeline_contract_version, environment, schedule_name,
              schedule_expression, effective_from_ms, effective_to_ms,
              provider_count, provider_scope_hash, policy_set_hash, plan_hash,
              created_at_ms
            ) VALUES (?, 'publication-run-plan@1', '1.0.0',
              'pipeline-contract@1', 'preview', 'provider-refresh-v1',
              '0 5 * * 1,4', 20, 40, 1, ?, ?, ?, 10)`,
          )
          .run(id("rpl", 2), HASH_B, HASH_C, plan.planHash),
      "publication run plan cannot be replaced",
    );
    expect(
      database
        .prepare(
          "SELECT run_plan_id FROM publication_run_plan WHERE plan_hash = ?",
        )
        .get(plan.planHash),
    ).toEqual({ run_plan_id: plan.runPlanId });
  });

  it("prohibits child insertion and every authority mutation after sealing", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    const provider = seedProvider(database, 2);
    const secondProvider = seedProvider(database, 3);
    const plan = insertPlan(database);
    insertPlanProvider(database, plan.runPlanId, 0, provider);
    insertPolicies(database, plan.runPlanId);
    insertSeal(database, plan);
    insertApproval(database, plan.runPlanId);
    database
      .prepare(
        "INSERT INTO publication_run_plan_revocation VALUES (?, 'superseded', 19)",
      )
      .run(plan.runPlanId);

    expectConstraint(() => {
      insertPlanProvider(database, plan.runPlanId, 1, secondProvider);
    }, "sealed publication run plan cannot accept providers");
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_run_plan_policy VALUES (?, 'run_budget', '2', ?)",
          )
          .run(plan.runPlanId, HASH_D),
      "sealed publication run plan cannot accept policies",
    );

    for (const [table, key] of [
      ["publication_run_plan_authority_integrity_metadata", "singleton = 1"],
      ["publication_run_plan", `run_plan_id = '${plan.runPlanId}'`],
      ["publication_run_plan_provider", `run_plan_id = '${plan.runPlanId}'`],
      ["publication_run_plan_policy", `run_plan_id = '${plan.runPlanId}'`],
      ["publication_run_plan_seal", `run_plan_id = '${plan.runPlanId}'`],
      ["publication_run_plan_approval", `run_plan_id = '${plan.runPlanId}'`],
      ["publication_run_plan_revocation", `run_plan_id = '${plan.runPlanId}'`],
    ] as const) {
      expectConstraint(() =>
        database.prepare(`UPDATE ${table} SET ${key} WHERE ${key}`).run(),
      );
      expectConstraint(() =>
        database.prepare(`DELETE FROM ${table} WHERE ${key}`).run(),
      );
    }
  });

  it("requires sealing before exact timely approval", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    const provider = seedProvider(database, 2);
    const plan = insertPlan(database);
    insertPlanProvider(database, plan.runPlanId, 0, provider);
    insertPolicies(database, plan.runPlanId);
    expectConstraint(() => {
      insertApproval(database, plan.runPlanId);
    }, "publication run-plan approval lacks a timely seal");
    insertSeal(database, plan);
    expectConstraint(() => {
      insertApproval(database, plan.runPlanId, 14);
    }, "publication run-plan approval lacks a timely seal");
    expectConstraint(() => {
      insertApproval(database, plan.runPlanId, 21);
    }, "publication run-plan approval lacks a timely seal");
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO publication_run_plan_approval VALUES (?, '[\"product_owner\"]', 'docs/compliance/run-plans/x.md', ?, 18)",
        )
        .run(plan.runPlanId, HASH_D),
    );
    insertApproval(database, plan.runPlanId);
  });

  it("allows at most one append-only post-approval revocation with a closed reason", () => {
    const database = predecessor();
    applyAuthorityMigration(database);
    const provider = seedProvider(database, 2);
    const plan = insertPlan(database);
    insertPlanProvider(database, plan.runPlanId, 0, provider);
    insertPolicies(database, plan.runPlanId);
    insertSeal(database, plan);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_run_plan_revocation VALUES (?, 'superseded', 18)",
          )
          .run(plan.runPlanId),
      "publication run-plan revocation precedes approval",
    );
    insertApproval(database, plan.runPlanId);
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO publication_run_plan_revocation VALUES (?, 'operator_note', 19)",
        )
        .run(plan.runPlanId),
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_run_plan_revocation VALUES (?, 'superseded', 17)",
          )
          .run(plan.runPlanId),
      "publication run-plan revocation precedes approval",
    );
    database
      .prepare(
        "INSERT INTO publication_run_plan_revocation VALUES (?, 'superseded', 19)",
      )
      .run(plan.runPlanId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT OR REPLACE INTO publication_run_plan_revocation VALUES (?, 'integrity_failure', 20)",
          )
          .run(plan.runPlanId),
      "publication run-plan revocation cannot be replaced",
    );
  });

  it("rejects a dirty predecessor and every authority-object collision atomically", () => {
    const oldSchema = predecessor("0003_integrity_triggers.sql");
    expect(() => {
      applyAuthorityMigration(oldSchema);
    }).toThrow();
    expect(
      oldSchema
        .prepare(
          "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'publication_run_plan'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const incomplete = predecessor();
    incomplete.exec("DROP TRIGGER slug_history_model_insert_guard");
    expect(() => {
      applyAuthorityMigration(incomplete);
    }).toThrow("malformed JSON");
    expect(
      incomplete
        .prepare(
          "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'publication_run_plan'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const dirty = predecessor();
    dirty.exec(`
      DROP TRIGGER model_slug_history_integrity_metadata_immutable_update;
      DROP TRIGGER model_slug_history_integrity_metadata_immutable_delete;
      DROP TABLE model_slug_history_integrity_metadata;
      CREATE TABLE model_slug_history_integrity_metadata(
        singleton INTEGER PRIMARY KEY,
        guard_version TEXT NOT NULL
      );
      INSERT INTO model_slug_history_integrity_metadata VALUES (1, 'dirty');
    `);
    expect(() => {
      applyAuthorityMigration(dirty);
    }).toThrow("malformed JSON");
    expect(
      dirty
        .prepare(
          "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'publication_run_plan'",
        )
        .get(),
    ).toEqual({ count: 0 });

    for (const name of AUTHORITY_OBJECTS) {
      const collision = predecessor();
      collision.exec(`CREATE TABLE ${name}(fake INTEGER)`);
      expect(() => {
        applyAuthorityMigration(collision);
      }).toThrow("malformed JSON");
      expect(
        collision
          .prepare(
            "SELECT count(*) AS count FROM sqlite_schema WHERE name IN ('publication_run_plan', 'publication_run_plan_seal')",
          )
          .get(),
      ).toEqual({
        count:
          name === "publication_run_plan" ||
          name === "publication_run_plan_seal"
            ? 1
            : 0,
      });
      collision.close();
    }
  });

  it("rolls back a late migration failure completely and remains retryable", () => {
    const database = predecessor();
    expect(() => {
      applyAtomicMigration(
        database,
        `${migrationSql()}\nSELECT * FROM __injected_late_failure__;`,
      );
    }).toThrow();
    expect(
      database
        .prepare(
          `SELECT count(*) AS count FROM sqlite_schema
           WHERE name IN (${AUTHORITY_OBJECTS.map(() => "?").join(",")})`,
        )
        .get(...AUTHORITY_OBJECTS),
    ).toEqual({ count: 0 });
    applyAuthorityMigration(database);
    expect(
      database
        .prepare(
          "SELECT capability FROM publication_run_plan_authority_integrity_metadata",
        )
        .get(),
    ).toEqual({ capability: "publication-run-plan-authority@1" });
  });
});
