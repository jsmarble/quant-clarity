import { describe, expect, it, vi } from "vitest";

import {
  PUBLICATION_RUN_PLAN_AUTHORITY_SQL,
  PUBLICATION_RUN_PLAN_ERROR_CODES,
  PublicationRunPlanAuthorityError,
  authorizePublicationRunPlanRows,
  hashPublicationRunPlan,
  resolveAuthorizedPublicationRunPlan,
  type PublicationRunPlanHashInput,
} from "./publication-run-plan-authority.js";

const RUN_PLAN_ID = "rpl_11111111-1111-4111-8111-111111111111";
const PROVIDER_A = "prv_11111111-1111-4111-8111-111111111111";
const PROVIDER_B = "prv_22222222-2222-4222-8222-222222222222";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;
const SCHEDULED_AT = "2026-08-03T05:00:00.000Z";
const EFFECTIVE_FROM_MS = Date.parse(SCHEDULED_AT);
const EFFECTIVE_TO_MS = Date.parse("2026-09-01T00:00:00.000Z");
const CREATED_AT_MS = Date.parse("2026-08-01T00:00:00.000Z");
const SEALED_AT_MS = Date.parse("2026-08-01T01:00:00.000Z");
const APPROVED_AT_MS = Date.parse("2026-08-01T02:00:00.000Z");

const providers: PublicationRunPlanHashInput["providers"] = [
  {
    ordinal: 0,
    providerId: PROVIDER_A,
    adapterVersion: "adapter-a@1",
    rosterVersion: "roster-a@1",
    rosterContentHash: HASH_A,
    sourceRegisterVersion: "source-a@1",
    sourceRegisterArtifactHash: HASH_B,
    requestCeiling: 10,
    byteCeiling: 20,
    aiTokenCeiling: 0,
    browserMillisecondCeiling: 0,
    elapsedMillisecondCeiling: 30,
    costMicrousdCeiling: 40,
    retryPolicyHash: HASH_C,
  },
  {
    ordinal: 1,
    providerId: PROVIDER_B,
    adapterVersion: "adapter-b@1",
    rosterVersion: "roster-b@1",
    rosterContentHash: HASH_B,
    sourceRegisterVersion: "source-b@1",
    sourceRegisterArtifactHash: HASH_C,
    requestCeiling: 11,
    byteCeiling: 21,
    aiTokenCeiling: 0,
    browserMillisecondCeiling: 0,
    elapsedMillisecondCeiling: 31,
    costMicrousdCeiling: 41,
    retryPolicyHash: HASH_D,
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

const planInput = (): PublicationRunPlanHashInput => ({
  runPlanId: RUN_PLAN_ID,
  environment: "preview",
  effectiveFromMs: EFFECTIVE_FROM_MS,
  effectiveToMs: EFFECTIVE_TO_MS,
  canonicalSchemaVersion: "1.0.0",
  pipelineContractVersion: "pipeline-run-contract@1",
  createdAtMs: CREATED_AT_MS,
  providers,
  policies,
});

const rows = async () => {
  const hashes = await hashPublicationRunPlan(planInput());
  return {
    hashes,
    capabilityRows: [{ capability: "publication-run-plan-authority@1" }],
    headerRows: [
      {
        run_plan_id: RUN_PLAN_ID,
        contract_version: "publication-run-plan@1",
        environment: "preview",
        schedule_name: "provider-refresh-v1",
        schedule_expression: "0 5 * * 1,4",
        effective_from_ms: EFFECTIVE_FROM_MS,
        effective_to_ms: EFFECTIVE_TO_MS,
        canonical_schema_version: "1.0.0",
        pipeline_contract_version: "pipeline-run-contract@1",
        provider_count: providers.length,
        provider_scope_hash: hashes.providerScopeHash,
        policy_set_hash: hashes.policySetHash,
        plan_hash: hashes.planHash,
        created_at_ms: CREATED_AT_MS,
        sealed_contract_version: "publication-run-plan@1",
        sealed_provider_count: providers.length,
        sealed_provider_scope_hash: hashes.providerScopeHash,
        sealed_policy_count: policies.length,
        sealed_policy_set_hash: hashes.policySetHash,
        sealed_plan_hash: hashes.planHash,
        sealed_at_ms: SEALED_AT_MS,
        approval_artifact_path:
          "docs/compliance/run-plans/preview-plan-approval.json",
        approval_artifact_hash: HASH_D,
        approver_roles_json:
          '["legal_source_owner","platform_owner","product_owner"]',
        approved_at_ms: APPROVED_AT_MS,
        revocation_reason_code: null,
        revocation_effective_at_ms: null,
      },
    ],
    providerRows: providers.map((provider) => ({
      run_plan_id: RUN_PLAN_ID,
      ordinal: provider.ordinal,
      provider_id: provider.providerId,
      adapter_version: provider.adapterVersion,
      roster_version: provider.rosterVersion,
      roster_content_hash: provider.rosterContentHash,
      source_register_version: provider.sourceRegisterVersion,
      source_register_artifact_hash: provider.sourceRegisterArtifactHash,
      request_ceiling: provider.requestCeiling,
      byte_ceiling: provider.byteCeiling,
      ai_token_ceiling: provider.aiTokenCeiling,
      browser_millisecond_ceiling: provider.browserMillisecondCeiling,
      elapsed_millisecond_ceiling: provider.elapsedMillisecondCeiling,
      cost_microusd_ceiling: provider.costMicrousdCeiling,
      retry_policy_hash: provider.retryPolicyHash,
      actual_roster_content_hash: provider.rosterContentHash,
      actual_source_artifact_hash: provider.sourceRegisterArtifactHash,
      source_reviewed_at_ms: Date.parse("2026-07-01T00:00:00.000Z"),
      source_next_review_at_ms: Date.parse("2026-10-01T00:00:00.000Z"),
      source_approval_state: "approved",
      source_access_permitted: 1,
      source_retention_permitted: 1,
      source_excerpt_permitted: 1,
      source_publication_permitted: 1,
    })),
    policyRows: policies.map((policy) => ({
      run_plan_id: RUN_PLAN_ID,
      policy_role: policy.role,
      policy_version: policy.version,
      content_hash: policy.contentHash,
    })),
  };
};

const authorize = async (
  mutate?: (fixture: Awaited<ReturnType<typeof rows>>) => void,
) => {
  const fixture = await rows();
  mutate?.(fixture);
  return authorizePublicationRunPlanRows({
    capabilityRows: fixture.capabilityRows,
    headerRows: fixture.headerRows,
    providerRows: fixture.providerRows,
    policyRows: fixture.policyRows,
    expectedRunPlanId: RUN_PLAN_ID,
    expectedPlanHash: fixture.hashes.planHash,
    expectedEnvironment: "preview",
    expectedCanonicalSchemaVersion: "1.0.0",
    expectedPipelineContractVersion: "pipeline-run-contract@1",
    scheduledAt: SCHEDULED_AT,
  });
};

const expectCode = async (
  promise: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({
    name: "PublicationRunPlanAuthorityError",
    code,
    message: code,
  });
};

describe("publication run-plan authority hash (PIPE-003, PIPE-004, PIPE-037)", () => {
  it("binds exact provider membership, policy versions, and typed ceilings", async () => {
    const first = await hashPublicationRunPlan(planInput());
    const second = await hashPublicationRunPlan(planInput());
    const changed = await hashPublicationRunPlan({
      ...planInput(),
      providers: [{ ...providers[0]!, requestCeiling: 11 }, providers[1]!],
    });
    expect(second).toEqual(first);
    expect(first.providerScopeHash).toBe(
      "sha256:0cac433bce255d4c4e0ab981dfeb54e7e390ec4f248cd2cdff3b16637a5325c9",
    );
    expect(first.policySetHash).toBe(
      "sha256:d5ddbbce003e953bb46de5dc48963fd73322f55a0f72b47bd4bd6651ecafe0b4",
    );
    expect(first.planHash).toBe(
      "sha256:bc243a1e29d0918a2d96d0885a469cb7d0c15e4c5ea3c102d97f0f5e76d3bb90",
    );
    expect(changed.planHash).not.toBe(first.planHash);
    expect(Object.isFrozen(first)).toBe(true);
  });
});

describe("closed authorized publication run plan (PIPE-003, PIPE-004)", () => {
  it("returns one frozen, lossless, scheduled-instant-scoped authority", async () => {
    const plan = await authorize();
    expect(plan).toMatchObject({
      contractVersion: "publication-run-plan@1",
      runPlanId: RUN_PLAN_ID,
      environment: "preview",
      scheduleName: "provider-refresh-v1",
      scheduleExpression: "0 5 * * 1,4",
      scheduledAt: SCHEDULED_AT,
      providers: [
        { providerId: PROVIDER_A, requestCeiling: 10 },
        { providerId: PROVIDER_B, requestCeiling: 11 },
      ],
      policies,
      approval: {
        artifactPath: "docs/compliance/run-plans/preview-plan-approval.json",
        approverRoles: [
          "legal_source_owner",
          "platform_owner",
          "product_owner",
        ],
      },
    });
    expect(plan.providerScopeHash).toMatch(/^sha256:/);
    expect(plan.policySetHash).toMatch(/^sha256:/);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.providers)).toBe(true);
    expect(Object.isFrozen(plan.providers[0])).toBe(true);
    expect(Object.isFrozen(plan.policies)).toBe(true);
    expect(Object.isFrozen(plan.approval)).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("instance");
    expect(JSON.stringify(plan)).not.toContain("visitor");
  });

  it("binds authority to the protected environment and runtime versions", async () => {
    const fixture = await rows();
    const base = {
      capabilityRows: fixture.capabilityRows,
      headerRows: fixture.headerRows,
      providerRows: fixture.providerRows,
      policyRows: fixture.policyRows,
      expectedRunPlanId: RUN_PLAN_ID,
      expectedPlanHash: fixture.hashes.planHash,
      expectedCanonicalSchemaVersion: "1.0.0",
      expectedPipelineContractVersion: "pipeline-run-contract@1",
      scheduledAt: SCHEDULED_AT,
    } as const;
    await expectCode(
      authorizePublicationRunPlanRows({
        ...base,
        expectedEnvironment: "production",
      }),
      "environment_mismatch",
    );
    await expectCode(
      authorizePublicationRunPlanRows({
        ...base,
        expectedEnvironment: "preview",
        expectedCanonicalSchemaVersion: "2.0.0",
      }),
      "version_mismatch",
    );
    await expectCode(
      authorizePublicationRunPlanRows({
        ...base,
        expectedEnvironment: "preview",
        expectedPipelineContractVersion: "pipeline-run-contract@2",
      }),
      "version_mismatch",
    );
  });

  it("rejects absent capability, unsorted scope, stale source approval, and tampering", async () => {
    await expectCode(
      authorize((fixture) => fixture.capabilityRows.splice(0)),
      "integrity_capability_missing",
    );
    await expectCode(
      authorize((fixture) => fixture.providerRows.reverse()),
      "provider_authority_invalid",
    );
    await expectCode(
      authorize((fixture) => {
        fixture.providerRows[0]!.source_next_review_at_ms = EFFECTIVE_FROM_MS;
      }),
      "source_authority_invalid",
    );
    await expectCode(
      authorize((fixture) => {
        fixture.providerRows[0]!.request_ceiling = 999;
      }),
      "plan_hash_mismatch",
    );
  });

  it("rejects ineffective, revoked, malformed, and non-scheduled authority", async () => {
    await expectCode(
      authorize((fixture) => {
        fixture.headerRows[0]!.effective_from_ms = Date.parse(
          "2026-08-04T00:00:00.000Z",
        );
      }),
      "plan_not_effective",
    );
    await expectCode(
      authorize((fixture) => {
        const header: Record<string, unknown> = fixture.headerRows[0]!;
        header.revocation_reason_code = "platform_authority_revoked";
        header.revocation_effective_at_ms = EFFECTIVE_FROM_MS;
      }),
      "plan_revoked",
    );
    await expectCode(
      authorize((fixture) => {
        Object.defineProperty(fixture.headerRows[0]!, "plan_hash", {
          enumerable: true,
          get: () => fixture.hashes.planHash,
        });
      }),
      "database_result_invalid",
    );
    await expectCode(
      authorize((fixture) => {
        fixture.headerRows[0]!.approval_artifact_path =
          "docs/compliance/run-plans/../../private";
      }),
      "approval_invalid",
    );
    await expectCode(
      authorize((fixture) => {
        const header: Record<string, unknown> = fixture.headerRows[0]!;
        header.revocation_reason_code = "superseded";
        header.revocation_effective_at_ms = SEALED_AT_MS;
      }),
      "plan_invalid",
    );
    await expectCode(
      authorize((fixture) => {
        const header: Record<string, unknown> = fixture.headerRows[0]!;
        header.revocation_reason_code = "superseded";
        header.revocation_effective_at_ms = Number.MAX_SAFE_INTEGER;
      }),
      "plan_invalid",
    );
    const fixture = await rows();
    const thursday = "2026-08-06T05:00:00.000Z";
    fixture.headerRows[0]!.effective_to_ms = Date.parse(thursday);
    await expectCode(
      authorizePublicationRunPlanRows({
        capabilityRows: fixture.capabilityRows,
        headerRows: fixture.headerRows,
        providerRows: fixture.providerRows,
        policyRows: fixture.policyRows,
        expectedRunPlanId: RUN_PLAN_ID,
        expectedPlanHash: fixture.hashes.planHash,
        expectedEnvironment: "preview",
        expectedCanonicalSchemaVersion: "1.0.0",
        expectedPipelineContractVersion: "pipeline-run-contract@1",
        scheduledAt: thursday,
      }),
      "plan_not_effective",
    );
    const scheduleFixture = await rows();
    await expectCode(
      authorizePublicationRunPlanRows({
        capabilityRows: scheduleFixture.capabilityRows,
        headerRows: scheduleFixture.headerRows,
        providerRows: scheduleFixture.providerRows,
        policyRows: scheduleFixture.policyRows,
        expectedRunPlanId: RUN_PLAN_ID,
        expectedPlanHash: scheduleFixture.hashes.planHash,
        expectedEnvironment: "preview",
        expectedCanonicalSchemaVersion: "1.0.0",
        expectedPipelineContractVersion: "pipeline-run-contract@1",
        scheduledAt: "2026-08-04T05:00:00.000Z",
      }),
      "scheduled_time_invalid",
    );
    await expectCode(
      authorizePublicationRunPlanRows({
        capabilityRows: scheduleFixture.capabilityRows,
        headerRows: scheduleFixture.headerRows,
        providerRows: scheduleFixture.providerRows,
        policyRows: scheduleFixture.policyRows,
        expectedRunPlanId: RUN_PLAN_ID,
        expectedPlanHash: scheduleFixture.hashes.planHash,
        expectedEnvironment: "preview",
        expectedCanonicalSchemaVersion: "1.0.0",
        expectedPipelineContractVersion: "pipeline-run-contract@1",
        scheduledAt: "+010000-01-03T05:00:00.000Z",
      }),
      "plan_not_effective",
    );
    await expectCode(
      authorizePublicationRunPlanRows({
        capabilityRows: scheduleFixture.capabilityRows,
        headerRows: scheduleFixture.headerRows,
        providerRows: scheduleFixture.providerRows,
        policyRows: scheduleFixture.policyRows,
        expectedRunPlanId: RUN_PLAN_ID,
        expectedPlanHash: scheduleFixture.hashes.planHash,
        expectedEnvironment: "preview",
        expectedCanonicalSchemaVersion: "1.0.0",
        expectedPipelineContractVersion: "pipeline-run-contract@1",
        scheduledAt: "1969-12-29T05:00:00.000Z",
      }),
      "scheduled_time_invalid",
    );
  });

  it("uses a fixed exact-read SQL inventory without writes or latest-row selection", () => {
    expect(Object.keys(PUBLICATION_RUN_PLAN_AUTHORITY_SQL)).toEqual([
      "metadata",
      "header",
      "providers",
      "policies",
    ]);
    for (const sql of Object.values(PUBLICATION_RUN_PLAN_AUTHORITY_SQL)) {
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|exec)\b/i);
      expect(sql).not.toMatch(
        /ORDER BY[^\n]*(?:created|approved|sealed).*DESC/i,
      );
    }
    expect(PUBLICATION_RUN_PLAN_AUTHORITY_SQL.header).toContain(
      "plan.run_plan_id = ?1",
    );
    expect(PUBLICATION_RUN_PLAN_AUTHORITY_SQL.header).toContain(
      "seal.plan_hash = ?2",
    );
    expect(PUBLICATION_RUN_PLAN_AUTHORITY_SQL.providers).toContain("LIMIT 17");
    expect(PUBLICATION_RUN_PLAN_AUTHORITY_SQL.policies).toContain("LIMIT 4");
  });

  it("keeps a closed non-sensitive error vocabulary", () => {
    expect(new Set(PUBLICATION_RUN_PLAN_ERROR_CODES).size).toBe(
      PUBLICATION_RUN_PLAN_ERROR_CODES.length,
    );
    for (const code of PUBLICATION_RUN_PLAN_ERROR_CODES) {
      const error = new PublicationRunPlanAuthorityError(code);
      expect(error.message).toBe(code);
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("rejects malformed inputs before D1 and closes database exceptions", async () => {
    const withSession = vi.fn();
    const database = { withSession } as unknown as D1Database;
    await expectCode(
      resolveAuthorizedPublicationRunPlan({
        database,
        runPlanId: "not-a-plan",
        planHash: HASH_A,
        expectedEnvironment: "preview",
        expectedCanonicalSchemaVersion: "1.0.0",
        expectedPipelineContractVersion: "pipeline-run-contract@1",
        scheduledAt: SCHEDULED_AT,
      }),
      "plan_invalid",
    );
    expect(withSession).not.toHaveBeenCalled();

    withSession.mockImplementation(() => {
      throw new Error("sensitive database detail");
    });
    await expectCode(
      resolveAuthorizedPublicationRunPlan({
        database,
        runPlanId: RUN_PLAN_ID,
        planHash: HASH_A,
        expectedEnvironment: "preview",
        expectedCanonicalSchemaVersion: "1.0.0",
        expectedPipelineContractVersion: "pipeline-run-contract@1",
        scheduledAt: SCHEDULED_AT,
      }),
      "database_result_invalid",
    );
  });
});
