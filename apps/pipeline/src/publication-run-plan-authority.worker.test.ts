import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  hashPublicationRunPlan,
  resolveAuthorizedPublicationRunPlan,
  type PublicationRunPlanHashInput,
} from "./publication-run-plan-authority.js";

const RUN_PLAN_ID = "rpl_11111111-1111-4111-8111-111111111111";
const PROVIDER_ID = "prv_11111111-1111-4111-8111-111111111111";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;
const MONDAY = "2026-08-03T05:00:00.000Z";
const THURSDAY = "2026-08-06T05:00:00.000Z";
const EFFECTIVE_FROM_MS = Date.parse(MONDAY);
const EFFECTIVE_TO_MS = Date.parse("2026-09-01T00:00:00.000Z");
const CREATED_AT_MS = Date.parse("2026-08-01T00:00:00.000Z");
const SEALED_AT_MS = Date.parse("2026-08-01T01:00:00.000Z");
const APPROVED_AT_MS = Date.parse("2026-08-01T02:00:00.000Z");
const EXPECTED_RUNTIME = {
  expectedEnvironment: "preview",
  expectedCanonicalSchemaVersion: "1.0.0",
  expectedPipelineContractVersion: "pipeline-run-contract@1",
} as const;

const providers: PublicationRunPlanHashInput["providers"] = [
  {
    ordinal: 0,
    providerId: PROVIDER_ID,
    adapterVersion: "adapter@1",
    rosterVersion: "roster@1",
    rosterContentHash: HASH_A,
    sourceRegisterVersion: "register@1",
    sourceRegisterArtifactHash: HASH_B,
    requestCeiling: 10,
    byteCeiling: 20,
    aiTokenCeiling: 0,
    browserMillisecondCeiling: 0,
    elapsedMillisecondCeiling: 30,
    costMicrousdCeiling: 40,
    retryPolicyHash: HASH_C,
  },
];

const policies: PublicationRunPlanHashInput["policies"] = [
  { role: "provider_retry", version: "retry@1", contentHash: HASH_A },
  { role: "run_budget", version: "budget@1", contentHash: HASH_B },
  {
    role: "terminal_deadline",
    version: "deadline@1",
    contentHash: HASH_C,
  },
];

const planInput: PublicationRunPlanHashInput = {
  runPlanId: RUN_PLAN_ID,
  environment: "preview",
  effectiveFromMs: EFFECTIVE_FROM_MS,
  effectiveToMs: EFFECTIVE_TO_MS,
  canonicalSchemaVersion: "1.0.0",
  pipelineContractVersion: "pipeline-run-contract@1",
  createdAtMs: CREATED_AT_MS,
  providers,
  policies,
};

let planHash = "";

const statement = (
  sql: string,
  values: readonly unknown[],
): D1PreparedStatement => env.CANONICAL_DB.prepare(sql).bind(...values);

beforeAll(async () => {
  await applyD1Migrations(env.CANONICAL_DB, env.CANONICAL_MIGRATIONS);
  const hashes = await hashPublicationRunPlan(planInput);
  planHash = hashes.planHash;
  await env.CANONICAL_DB.batch([
    statement("INSERT INTO resource_identity VALUES (?1, 'provider', ?2)", [
      PROVIDER_ID,
      CREATED_AT_MS,
    ]),
    statement(
      "INSERT INTO provider VALUES (?1, NULL, 'fixture-provider', 'Fixture Provider', 'fixture provider', 'active', NULL, '[]', ?2)",
      [PROVIDER_ID, CREATED_AT_MS],
    ),
    statement("INSERT INTO provider_roster VALUES (?1, ?2, ?3, ?4)", [
      PROVIDER_ID,
      "roster@1",
      HASH_A,
      CREATED_AT_MS,
    ]),
    statement(
      "INSERT INTO provider_roster_item VALUES (?1, 'roster@1', 'fixture-item', 'fixture-model', 'default', 'chat', '', NULL)",
      [PROVIDER_ID],
    ),
    statement(
      "INSERT INTO source_compliance_record VALUES (?1, ?2, ?3, ?4, '[\"catalog\"]', 'legal_source_owner', ?5, ?6, 'approved', 1, 1, 1, 1, '', '', ?7)",
      [
        PROVIDER_ID,
        "register@1",
        "docs/compliance/sources/fixture.json",
        HASH_B,
        Date.parse("2026-07-01T00:00:00.000Z"),
        Date.parse("2026-10-01T00:00:00.000Z"),
        CREATED_AT_MS,
      ],
    ),
  ]);
  await env.CANONICAL_DB.batch([
    statement(
      `INSERT INTO publication_run_plan (
        run_plan_id, contract_version, environment, schedule_name,
        schedule_expression, effective_from_ms, effective_to_ms,
        canonical_schema_version, pipeline_contract_version, provider_count,
        provider_scope_hash, policy_set_hash, plan_hash, created_at_ms
      ) VALUES (?1, 'publication-run-plan@1', 'preview',
        'provider-refresh-v1', '0 5 * * 1,4', ?2, ?3, ?4, ?5, 1,
        ?6, ?7, ?8, ?9)`,
      [
        RUN_PLAN_ID,
        EFFECTIVE_FROM_MS,
        EFFECTIVE_TO_MS,
        "1.0.0",
        "pipeline-run-contract@1",
        hashes.providerScopeHash,
        hashes.policySetHash,
        hashes.planHash,
        CREATED_AT_MS,
      ],
    ),
    statement(
      `INSERT INTO publication_run_plan_provider VALUES (
        ?1, 0, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
      )`,
      [
        RUN_PLAN_ID,
        PROVIDER_ID,
        "adapter@1",
        "roster@1",
        HASH_A,
        "register@1",
        HASH_B,
        10,
        20,
        0,
        0,
        30,
        40,
        HASH_C,
      ],
    ),
    ...policies.map((policy) =>
      statement(
        "INSERT INTO publication_run_plan_policy VALUES (?1, ?2, ?3, ?4)",
        [RUN_PLAN_ID, policy.role, policy.version, policy.contentHash],
      ),
    ),
  ]);
  await env.CANONICAL_DB.batch([
    statement(
      "INSERT INTO publication_run_plan_seal VALUES (?1, 'publication-run-plan@1', 1, ?2, 3, ?3, ?4, ?5)",
      [
        RUN_PLAN_ID,
        hashes.providerScopeHash,
        hashes.policySetHash,
        hashes.planHash,
        SEALED_AT_MS,
      ],
    ),
    statement(
      `INSERT INTO publication_run_plan_approval VALUES (
        ?1, '["legal_source_owner","platform_owner","product_owner"]',
        'docs/compliance/run-plans/fixture.json', ?2, ?3
      )`,
      [RUN_PLAN_ID, HASH_D, APPROVED_AT_MS],
    ),
  ]);
});

describe("publication run-plan authority in workerd/D1 (PIPE-003, PIPE-004, QA-005)", () => {
  it("resolves the same exact authority through first-primary fixed reads", async () => {
    const first = await resolveAuthorizedPublicationRunPlan({
      database: env.CANONICAL_DB,
      runPlanId: RUN_PLAN_ID,
      planHash,
      ...EXPECTED_RUNTIME,
      scheduledAt: MONDAY,
    });
    await expect(
      env.CANONICAL_DB.prepare(
        "INSERT INTO provider_roster_item VALUES (?1, 'roster@1', 'late-item', 'late-model', 'default', 'chat', '', NULL)",
      )
        .bind(PROVIDER_ID)
        .run(),
    ).rejects.toThrow(/run-plan-referenced provider roster cannot grow/);
    const second = await resolveAuthorizedPublicationRunPlan({
      database: env.CANONICAL_DB,
      runPlanId: RUN_PLAN_ID,
      planHash,
      ...EXPECTED_RUNTIME,
      scheduledAt: MONDAY,
    });
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      runPlanId: RUN_PLAN_ID,
      planHash,
      environment: "preview",
      scheduledAt: MONDAY,
      providers: [{ providerId: PROVIDER_ID, rosterVersion: "roster@1" }],
    });
    const counts = await env.CANONICAL_DB.prepare(
      `SELECT
        (SELECT count(*) FROM schedule_occurrence) AS occurrences,
        (SELECT count(*) FROM pipeline_run) AS runs,
        (SELECT count(*) FROM provider_run) AS provider_runs`,
    ).first();
    expect(counts).toEqual({ occurrences: 0, runs: 0, provider_runs: 0 });
  });

  it("distinguishes an existing plan with the wrong hash and rejects post-seal authority mutation", async () => {
    await expect(
      resolveAuthorizedPublicationRunPlan({
        database: env.CANONICAL_DB,
        runPlanId: "rpl_70000000-0000-4000-8000-000000000098",
        planHash: HASH_C,
        ...EXPECTED_RUNTIME,
        scheduledAt: MONDAY,
      }),
    ).rejects.toMatchObject({ code: "plan_not_found" });
    await expect(
      resolveAuthorizedPublicationRunPlan({
        database: env.CANONICAL_DB,
        runPlanId: RUN_PLAN_ID,
        planHash: HASH_D,
        ...EXPECTED_RUNTIME,
        scheduledAt: MONDAY,
      }),
    ).rejects.toMatchObject({
      code: "plan_invalid",
    });
    const incompleteRunPlanId = "rpl_70000000-0000-4000-8000-000000000099";
    await env.CANONICAL_DB.prepare(
      `INSERT INTO publication_run_plan(
        run_plan_id, contract_version, environment, schedule_name,
        schedule_expression, effective_from_ms, effective_to_ms,
        canonical_schema_version, pipeline_contract_version, provider_count,
        provider_scope_hash, policy_set_hash, plan_hash, created_at_ms
      ) VALUES (?1, 'publication-run-plan@1', 'preview',
        'provider-refresh-v1', '0 5 * * 1,4', ?2, ?3, '1.0.0',
        'pipeline-run-contract@1', 1, ?4, ?5, ?6, ?7)`,
    )
      .bind(
        incompleteRunPlanId,
        EFFECTIVE_FROM_MS,
        EFFECTIVE_TO_MS,
        HASH_A,
        HASH_B,
        HASH_D,
        CREATED_AT_MS,
      )
      .run();
    await expect(
      resolveAuthorizedPublicationRunPlan({
        database: env.CANONICAL_DB,
        runPlanId: incompleteRunPlanId,
        planHash: HASH_D,
        ...EXPECTED_RUNTIME,
        scheduledAt: MONDAY,
      }),
    ).rejects.toMatchObject({ code: "plan_invalid" });
    await expect(
      env.CANONICAL_DB.prepare(
        "UPDATE publication_run_plan_provider SET request_ceiling = 999 WHERE run_plan_id = ?1",
      )
        .bind(RUN_PLAN_ID)
        .run(),
    ).rejects.toThrow(/immutable/);
    await expect(
      env.CANONICAL_DB.prepare(
        "INSERT INTO publication_run_plan_policy VALUES (?1, 'run_budget', 'other', ?2)",
      )
        .bind(RUN_PLAN_ID, HASH_D)
        .run(),
    ).rejects.toThrow(/sealed|replace/);
  });

  it("honors append-only revocation at the scheduled instant", async () => {
    await env.CANONICAL_DB.prepare(
      "INSERT INTO publication_run_plan_revocation VALUES (?1, 'platform_authority_revoked', ?2)",
    )
      .bind(RUN_PLAN_ID, Date.parse(THURSDAY))
      .run();
    await expect(
      resolveAuthorizedPublicationRunPlan({
        database: env.CANONICAL_DB,
        runPlanId: RUN_PLAN_ID,
        planHash,
        ...EXPECTED_RUNTIME,
        scheduledAt: MONDAY,
      }),
    ).resolves.toMatchObject({ scheduledAt: MONDAY });
    await expect(
      resolveAuthorizedPublicationRunPlan({
        database: env.CANONICAL_DB,
        runPlanId: RUN_PLAN_ID,
        planHash,
        ...EXPECTED_RUNTIME,
        scheduledAt: THURSDAY,
      }),
    ).rejects.toMatchObject({
      code: "plan_revoked",
    });
  });
});
