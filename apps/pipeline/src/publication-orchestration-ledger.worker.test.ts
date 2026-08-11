import { env, exports } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createPipelineRun,
  createProviderSlice,
  createScheduleOccurrence,
} from "@quant-clarity/pipeline-core";

import {
  ORCHESTRATION_POLICY_REGISTRY,
  buildRejectedFiringReportV2,
  buildTerminalRunReportV2,
  decideFiringAdmission,
  publicationPlanProviderScopeHash,
  validateAdjacentExplicitReplay,
  type AdmittedFiringDecision,
  type PlanAdmissionState,
  type PolicyReference,
  type TerminalRunIdentityAuthorityV2,
} from "@quant-clarity/pipeline-core/orchestration-contract";

import {
  hashPublicationRunPlan,
  type PublicationRunPlanHashInput,
} from "./publication-run-plan-authority.js";
import {
  PublicationOrchestrationLedgerError,
  claimPublicationProviderFence,
  initializePublicationOrchestrationEnvironment,
  persistAdmittedPublicationRun,
  persistPublicationAdmissionRejection,
  persistPublicationRunTerminal,
  persistSourceFreeRosterOutcome,
  readPublicationBudgetAuthority,
  terminalizePublicationProvider,
  type PublicationBudgetAuthority,
} from "./publication-orchestration-ledger.js";

const RUN_PLAN_ID = "rpl_70000000-0000-4000-8000-000000000001";
const PROVIDER_ID = "prv_70000000-0000-4000-8000-000000000002";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;
const SCHEDULED_AT = "2026-08-03T05:00:00.000Z";
const DEADLINE_AT = "2026-08-03T17:00:00.000Z";
const EFFECTIVE_FROM = "2026-08-02T00:00:00.000Z";
const EFFECTIVE_TO = "2026-09-01T00:00:00.000Z";
const CREATED_AT = "2026-08-01T00:00:00.000Z";
const CODE_VERSION = "git:abcdef1";
const RUN_COST_MICROUSD = 6_000_000;
const later = (instant: string, milliseconds: number): string =>
  new Date(Date.parse(instant) + milliseconds).toISOString();
const TEST_SCHEDULE = Object.freeze({
  name: "provider-refresh-v1",
  utcWeekdays: Object.freeze([1, 4]),
  utcHour: 5,
  utcMinute: 0,
});
const LEDGER_WRITER = Object.freeze({
  kind: "pipeline" as const,
  identityId: "publication-orchestration-ledger@1",
});

const deterministicIdentity = (input: {
  scheduledAt: string;
  observedAt: string;
  startedAt: string;
  attemptNumber?: number;
  replayOfRunId?: string;
}) => {
  const occurrence = createScheduleOccurrence({
    config: TEST_SCHEDULE,
    scheduledAt: input.scheduledAt,
    createdAt: input.observedAt,
  });
  const attemptNumber = input.attemptNumber ?? 1;
  const run = createPipelineRun({
    writer: LEDGER_WRITER,
    occurrence,
    attemptNumber,
    ...(input.replayOfRunId === undefined
      ? {}
      : { replayOfRunId: input.replayOfRunId }),
    codeVersion: CODE_VERSION,
    schemaVersion: "1.0.0",
    providerScope: [PROVIDER_ID],
    startedAt: input.startedAt,
  });
  const provider = createProviderSlice({
    run,
    occurrence,
    providerId: PROVIDER_ID,
  });
  return {
    occurrenceId: occurrence.occurrenceId,
    runId: run.runId,
    providerRunId: provider.providerSliceId,
    scheduledAt: input.scheduledAt,
    observedAt: input.observedAt,
    startedAt: input.startedAt,
  };
};

const providerAuthority = {
  ordinal: 0,
  providerId: PROVIDER_ID,
  adapterVersion: "adapter@1",
  rosterVersion: "roster@1",
  rosterContentHash: HASH_A,
  sourceRegisterVersion: "register@1",
  sourceRegisterArtifactHash: HASH_B,
  requestCeiling: 10,
  byteCeiling: 1_000,
  aiTokenCeiling: 0,
  browserMillisecondCeiling: 0,
  elapsedMillisecondCeiling: 60_000,
  costMicrousdCeiling: RUN_COST_MICROUSD,
  retryPolicyHash: ORCHESTRATION_POLICY_REGISTRY.provider_retry.contentHash,
} as const;

const policyReferences = (): readonly PolicyReference[] =>
  Object.values(ORCHESTRATION_POLICY_REGISTRY).map(
    ({ role, version, contentHash }) => ({ role, version, contentHash }),
  );

const planInput: PublicationRunPlanHashInput = {
  runPlanId: RUN_PLAN_ID,
  environment: "preview",
  effectiveFromMs: Date.parse(EFFECTIVE_FROM),
  effectiveToMs: Date.parse(EFFECTIVE_TO),
  canonicalSchemaVersion: "1.0.0",
  pipelineContractVersion: "pipeline-run-contract@1",
  createdAtMs: Date.parse(CREATED_AT),
  providers: [providerAuthority],
  policies: policyReferences(),
};

let planHash = "";
let policySetHash = "";

const statement = (
  sql: string,
  values: readonly unknown[],
): D1PreparedStatement => env.CANONICAL_DB.prepare(sql).bind(...values);

const authorizedPlan = (scheduledAt: string): PlanAdmissionState => ({
  state: "authorized",
  contractVersion: "publication-run-plan@1",
  runPlanId: RUN_PLAN_ID,
  planHash,
  environment: "preview",
  scheduleName: "provider-refresh-v1",
  scheduleExpression: "0 5 * * 1,4",
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: EFFECTIVE_TO,
  scheduledAt,
  canonicalSchemaVersion: "1.0.0",
  pipelineContractVersion: "pipeline-run-contract@1",
  providerScopeHash: publicationPlanProviderScopeHash([PROVIDER_ID]),
  policySetHash,
  providers: [providerAuthority],
  policies: policyReferences(),
  approval: {
    artifactPath: "docs/compliance/run-plans/fixture.json",
    artifactHash: HASH_D,
    approvedAt: "2026-08-01T02:00:00.000Z",
    approverRoles: ["legal_source_owner", "platform_owner", "product_owner"],
  },
});

const admissionFor = (
  budget: PublicationBudgetAuthority,
  scheduledAt: string,
  observedAt: string,
): AdmittedFiringDecision => {
  const decision = decideFiringAdmission({
    event: {
      kind: "scheduled",
      workflowName: "quant-clarity-publication-preview",
      scheduleExpression: "0 5 * * 1,4",
      scheduledAt,
      payload: {},
    },
    protectedContext: {
      workflowName: "quant-clarity-publication-preview",
      scheduleName: "provider-refresh-v1",
      scheduleExpression: "0 5 * * 1,4",
      environment: "preview",
      runPlanId: RUN_PLAN_ID,
      runPlanHash: planHash,
      canonicalSchemaVersion: "1.0.0",
      pipelineContractVersion: "pipeline-run-contract@1",
    },
    plan: authorizedPlan(scheduledAt),
    budgetState: {
      monthlyUsedCostMicrousd: budget.monthlyUsedCostMicrousd,
      monthlyReservedCostMicrousd: budget.monthlyReservedCostMicrousd,
      expensiveWorkBreakerTripped: budget.expensiveWorkBreakerTripped,
    },
    now: observedAt,
  });
  if (decision.decision !== "admitted")
    throw new Error("fixture admission was unexpectedly rejected");
  return decision;
};

const admitAttemptOne = async (
  scheduledAt: string,
  observedAt: string,
  startedAt: string,
  budget?: PublicationBudgetAuthority,
) => {
  const budgetAuthority =
    budget ??
    (await readPublicationBudgetAuthority({
      database: env.CANONICAL_DB,
      environment: "preview",
      budgetMonth: "2026-08",
    }));
  const identity = deterministicIdentity({
    scheduledAt,
    observedAt,
    startedAt,
  });
  const admission = admissionFor(budgetAuthority, scheduledAt, observedAt);
  const result = await persistAdmittedPublicationRun({
    database: env.CANONICAL_DB,
    admission,
    identity: {
      kind: "attempt_1",
      occurrenceId: identity.occurrenceId,
      runId: identity.runId,
    },
    providerRunIds: [identity.providerRunId],
    budget: budgetAuthority,
    codeVersion: CODE_VERSION,
    observedAt,
    startedAt,
  }).catch((error: unknown) => {
    if (error instanceof PublicationOrchestrationLedgerError)
      throw new Error(`fixture admission failed: ${error.code}`);
    throw error;
  });
  return { ...identity, admission, result, observedAt, startedAt };
};

const expectLedgerCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(PublicationOrchestrationLedgerError);
  expect(error).toMatchObject({ code });
};

beforeAll(async () => {
  await applyD1Migrations(env.CANONICAL_DB, env.CANONICAL_MIGRATIONS);
  const hashes = await hashPublicationRunPlan(planInput);
  planHash = hashes.planHash;
  policySetHash = hashes.policySetHash;

  await env.CANONICAL_DB.batch([
    statement("INSERT INTO resource_identity VALUES (?1, 'provider', ?2)", [
      PROVIDER_ID,
      Date.parse(CREATED_AT),
    ]),
    statement(
      "INSERT INTO provider VALUES (?1, NULL, 'ledger-fixture', 'Ledger Fixture', 'ledger fixture', 'active', NULL, '[]', ?2)",
      [PROVIDER_ID, Date.parse(CREATED_AT)],
    ),
    statement("INSERT INTO provider_roster VALUES (?1, ?2, ?3, ?4)", [
      PROVIDER_ID,
      "roster@1",
      HASH_A,
      Date.parse(CREATED_AT),
    ]),
    statement(
      "INSERT INTO provider_roster_item VALUES (?1, 'roster@1', 'model-a', 'fixture-model', 'default', 'chat', '', NULL)",
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
        Date.parse(CREATED_AT),
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
        'provider-refresh-v1', '0 5 * * 1,4', ?2, ?3, '1.0.0',
        'pipeline-run-contract@1', 1, ?4, ?5, ?6, ?7)`,
      [
        RUN_PLAN_ID,
        Date.parse(EFFECTIVE_FROM),
        Date.parse(EFFECTIVE_TO),
        hashes.providerScopeHash,
        hashes.policySetHash,
        hashes.planHash,
        Date.parse(CREATED_AT),
      ],
    ),
    statement(
      `INSERT INTO publication_run_plan_provider VALUES (
        ?1, 0, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
      )`,
      [
        RUN_PLAN_ID,
        PROVIDER_ID,
        providerAuthority.adapterVersion,
        providerAuthority.rosterVersion,
        providerAuthority.rosterContentHash,
        providerAuthority.sourceRegisterVersion,
        providerAuthority.sourceRegisterArtifactHash,
        providerAuthority.requestCeiling,
        providerAuthority.byteCeiling,
        providerAuthority.aiTokenCeiling,
        providerAuthority.browserMillisecondCeiling,
        providerAuthority.elapsedMillisecondCeiling,
        providerAuthority.costMicrousdCeiling,
        providerAuthority.retryPolicyHash,
      ],
    ),
    ...policyReferences().map((policy) =>
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
        Date.parse("2026-08-01T01:00:00.000Z"),
      ],
    ),
    statement(
      `INSERT INTO publication_run_plan_approval VALUES (
        ?1, '["legal_source_owner","platform_owner","product_owner"]',
        'docs/compliance/run-plans/fixture.json', ?2, ?3
      )`,
      [RUN_PLAN_ID, HASH_D, Date.parse("2026-08-01T02:00:00.000Z")],
    ),
  ]);
});

describe("publication orchestration ledger in workerd/D1", () => {
  it("closes a source-free lifecycle and enforces budget, fence, replay, and legacy isolation", async () => {
    await expect(
      initializePublicationOrchestrationEnvironment({
        database: env.CANONICAL_DB,
        environment: "preview",
        monthlyAllocationMicrousd: 25_000_000,
        budgetMonth: "2026-08",
        initializedAtMs: Date.parse(CREATED_AT),
      }),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      initializePublicationOrchestrationEnvironment({
        database: env.CANONICAL_DB,
        environment: "preview",
        monthlyAllocationMicrousd: 25_000_000,
        budgetMonth: "2026-08",
        initializedAtMs: Date.parse(CREATED_AT),
      }),
    ).resolves.toEqual({ outcome: "idempotent_success" });

    const rejectionObservedAt = "2026-08-03T05:00:01.000Z";
    const rejectedOccurrence = createScheduleOccurrence({
      config: TEST_SCHEDULE,
      scheduledAt: SCHEDULED_AT,
      createdAt: rejectionObservedAt,
    });
    const rejectionAuthority = decideFiringAdmission({
      event: {
        kind: "scheduled",
        workflowName: "quant-clarity-publication-preview",
        scheduleExpression: "0 5 * * 1,4",
        scheduledAt: SCHEDULED_AT,
        payload: {},
      },
      protectedContext: {
        workflowName: "quant-clarity-publication-preview",
        scheduleName: "provider-refresh-v1",
        scheduleExpression: "0 5 * * 1,4",
        environment: "preview",
        runPlanId: RUN_PLAN_ID,
        runPlanHash: planHash,
        canonicalSchemaVersion: "1.0.0",
        pipelineContractVersion: "pipeline-run-contract@1",
      },
      plan: { state: "invalid" },
      budgetState: {
        monthlyUsedCostMicrousd: 0,
        monthlyReservedCostMicrousd: 0,
        expensiveWorkBreakerTripped: false,
      },
      now: rejectionObservedAt,
    });
    if (
      rejectionAuthority.decision !== "rejected" ||
      rejectionAuthority.reason !== "plan_invalid"
    )
      throw new Error("fixture rejection was unexpectedly admitted");
    const rejectionReport = buildRejectedFiringReportV2({
      scheduleName: "provider-refresh-v1",
      scheduleExpression: "0 5 * * 1,4",
      occurrenceId: rejectedOccurrence.occurrenceId,
      scheduledAt: SCHEDULED_AT,
      observedAt: rejectionObservedAt,
      rejectionCode: "plan_invalid",
      requestedPlan: {
        runPlanId: RUN_PLAN_ID,
        runPlanHash: planHash,
        environment: "preview",
      },
    });
    await expectLedgerCode(
      persistPublicationAdmissionRejection({
        database: env.CANONICAL_DB,
        rejectionAuthority,
        report: rejectionReport,
      }),
      "authority_missing",
    );
    await expect(
      env.CANONICAL_DB.prepare(
        "SELECT count(*) AS rows FROM publication_admission_rejection",
      ).first(),
    ).resolves.toEqual({ rows: 0 });

    const lifecycle = await admitAttemptOne(
      SCHEDULED_AT,
      "2026-08-03T05:00:01.000Z",
      "2026-08-03T05:00:02.000Z",
    );
    const fenceCandidateA = await admitAttemptOne(
      "2026-08-06T05:00:00.000Z",
      "2026-08-06T05:00:01.000Z",
      "2026-08-06T05:00:02.000Z",
    );
    const fenceCandidateB = await admitAttemptOne(
      "2026-08-10T05:00:00.000Z",
      "2026-08-10T05:00:01.000Z",
      "2026-08-10T05:00:02.000Z",
    );
    expect([
      lifecycle.result.outcome,
      fenceCandidateA.result.outcome,
      fenceCandidateB.result.outcome,
    ]).toEqual(["applied", "applied", "applied"]);
    const providerAdmissionTimes = await env.CANONICAL_DB.prepare(
      `SELECT provider_run_id, admitted_at_ms
       FROM publication_coordination_provider_run
       WHERE provider_run_id IN (?1, ?2, ?3)
       ORDER BY provider_run_id`,
    )
      .bind(
        lifecycle.providerRunId,
        fenceCandidateA.providerRunId,
        fenceCandidateB.providerRunId,
      )
      .all<{ provider_run_id: string; admitted_at_ms: number }>();
    expect(
      Object.fromEntries(
        providerAdmissionTimes.results.map((row) => [
          row.provider_run_id,
          row.admitted_at_ms,
        ]),
      ),
    ).toEqual({
      [lifecycle.providerRunId]: Date.parse(lifecycle.startedAt),
      [fenceCandidateA.providerRunId]: Date.parse(fenceCandidateA.startedAt),
      [fenceCandidateB.providerRunId]: Date.parse(fenceCandidateB.startedAt),
    });

    const staleBudget = await readPublicationBudgetAuthority({
      database: env.CANONICAL_DB,
      environment: "preview",
      budgetMonth: "2026-08",
    });
    expect(staleBudget.monthlyReservedCostMicrousd).toBe(18_000_000);
    const budgetRaceA = deterministicIdentity({
      scheduledAt: "2026-08-13T05:00:00.000Z",
      observedAt: "2026-08-13T05:00:01.000Z",
      startedAt: "2026-08-13T05:00:02.000Z",
    });
    const budgetRaceB = deterministicIdentity({
      scheduledAt: "2026-08-17T05:00:00.000Z",
      observedAt: "2026-08-17T05:00:01.000Z",
      startedAt: "2026-08-17T05:00:02.000Z",
    });
    const raceInput = (identity: ReturnType<typeof deterministicIdentity>) =>
      persistAdmittedPublicationRun({
        database: env.CANONICAL_DB,
        admission: admissionFor(
          staleBudget,
          identity.scheduledAt,
          identity.observedAt,
        ),
        identity: {
          kind: "attempt_1" as const,
          occurrenceId: identity.occurrenceId,
          runId: identity.runId,
        },
        providerRunIds: [identity.providerRunId],
        budget: staleBudget,
        codeVersion: CODE_VERSION,
        observedAt: identity.observedAt,
        startedAt: identity.startedAt,
      });
    const budgetRace = await Promise.allSettled([
      raceInput(budgetRaceA),
      raceInput(budgetRaceB),
    ]);
    expect(
      budgetRace.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    const budgetLoser = budgetRace.find(({ status }) => status === "rejected");
    expect(budgetLoser).toMatchObject({
      status: "rejected",
      reason: { code: "conflict" },
    });
    const raceRows = await env.CANONICAL_DB.prepare(
      "SELECT run_id FROM publication_coordination_run WHERE run_id IN (?1, ?2) ORDER BY run_id",
    )
      .bind(budgetRaceA.runId, budgetRaceB.runId)
      .all<{ run_id: string }>();
    expect(raceRows.results).toHaveLength(1);
    const budgetLoserId =
      raceRows.results[0]?.run_id === budgetRaceA.runId
        ? budgetRaceB
        : budgetRaceA;
    const budgetWinner =
      raceRows.results[0]?.run_id === budgetRaceA.runId
        ? budgetRaceA
        : budgetRaceB;
    const budgetLoserClosure = await env.CANONICAL_DB.prepare(
      `SELECT
        (SELECT count(*) FROM schedule_occurrence WHERE occurrence_id = ?1) AS occurrences,
        (SELECT count(*) FROM publication_coordination_run WHERE run_id = ?2) AS runs,
        (SELECT count(*) FROM publication_coordination_provider_run WHERE provider_run_id = ?3) AS provider_runs,
        (SELECT count(*) FROM publication_run_budget_reservation WHERE run_id = ?2) AS reservations`,
    )
      .bind(
        budgetLoserId.occurrenceId,
        budgetLoserId.runId,
        budgetLoserId.providerRunId,
      )
      .first();
    expect(budgetLoserClosure).toEqual({
      occurrences: 0,
      runs: 0,
      provider_runs: 0,
      reservations: 0,
    });

    const lifecycleClaim = {
      environment: "preview" as const,
      providerId: PROVIDER_ID,
      generation: 1,
      providerRunId: lifecycle.providerRunId,
      runId: lifecycle.runId,
      occurrenceId: lifecycle.occurrenceId,
      deadlineAt: DEADLINE_AT,
      claimedAt: "2026-08-03T05:01:00.000Z",
    };
    await expect(
      claimPublicationProviderFence({
        database: env.CANONICAL_DB,
        ...lifecycleClaim,
      }),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      claimPublicationProviderFence({
        database: env.CANONICAL_DB,
        ...lifecycleClaim,
      }),
    ).resolves.toEqual({ outcome: "idempotent_success" });

    await expect(
      persistSourceFreeRosterOutcome({
        database: env.CANONICAL_DB,
        fenceClaim: lifecycleClaim,
        rosterItemId: "model-a",
        status: "failed",
        errorCode: "provider_failed",
        attemptCount: 0,
        createdAt: "2026-08-03T05:02:00.000Z",
      }),
    ).resolves.toEqual({ outcome: "applied" });
    const providerTerminal = {
      database: env.CANONICAL_DB,
      environment: "preview" as const,
      providerId: PROVIDER_ID,
      providerRunId: lifecycle.providerRunId,
      fenceGeneration: 1,
      terminal: {
        state: "failed" as const,
        rosterComplete: true as const,
        publicationDisposition: "unavailable" as const,
        cost: {
          requests: 0,
          bytes: 0,
          aiTokens: 0,
          browserMilliseconds: 0,
          elapsedMilliseconds: 0,
          costMicrousd: 0,
        },
        errorCodes: ["provider_failed", "provider_unavailable"] as const,
      },
      endedAt: "2026-08-03T05:10:00.000Z",
      reconciledAt: "2026-08-03T05:11:00.000Z",
      releasedAt: "2026-08-03T05:12:00.000Z",
      reconciliationResult: "terminal_confirmed" as const,
    };
    await expect(
      terminalizePublicationProvider(providerTerminal),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      terminalizePublicationProvider(providerTerminal),
    ).resolves.toEqual({ outcome: "idempotent_success" });

    const runAuthority: TerminalRunIdentityAuthorityV2 = {
      kind: "attempt_1",
      occurrenceId: lifecycle.occurrenceId,
      runId: lifecycle.runId,
      codeVersion: CODE_VERSION,
    };
    const report = buildTerminalRunReportV2({
      admission: lifecycle.admission,
      runAuthority,
      startedAt: lifecycle.startedAt,
      endedAt: "2026-08-03T05:13:00.000Z",
      providers: [
        {
          providerId: PROVIDER_ID,
          state: "failed",
          rosterComplete: true,
          publicationDisposition: "unavailable",
          cost: {
            requests: 0,
            bytes: 0,
            aiTokens: 0,
            browserMilliseconds: 0,
            elapsedMilliseconds: 0,
            costMicrousd: 0,
          },
          errorCodes: ["provider_failed", "provider_unavailable"],
        },
      ],
      runWideQuarantine: false,
    });
    await expect(
      persistPublicationRunTerminal({
        database: env.CANONICAL_DB,
        admission: lifecycle.admission,
        runAuthority,
        report,
      }),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      persistPublicationRunTerminal({
        database: env.CANONICAL_DB,
        admission: lifecycle.admission,
        runAuthority,
        report,
      }),
    ).resolves.toEqual({ outcome: "idempotent_success" });

    const previous = {
      generation: 1,
      providerRunId: lifecycle.providerRunId,
      runId: lifecycle.runId,
      occurrenceId: lifecycle.occurrenceId,
      deadlineAt: DEADLINE_AT,
      claimedAt: lifecycleClaim.claimedAt,
    };
    const fenceRaceInput = (candidate: typeof fenceCandidateA) =>
      claimPublicationProviderFence({
        database: env.CANONICAL_DB,
        environment: "preview",
        providerId: PROVIDER_ID,
        generation: 2,
        providerRunId: candidate.providerRunId,
        runId: candidate.runId,
        occurrenceId: candidate.occurrenceId,
        deadlineAt: candidate.admission.terminalDeadlineAt,
        claimedAt: later(candidate.startedAt, 60_000),
        previous,
      });
    const fenceRace = await Promise.allSettled([
      fenceRaceInput(fenceCandidateA),
      fenceRaceInput(fenceCandidateB),
    ]);
    expect(
      fenceRace.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(fenceRace.find(({ status }) => status === "rejected")).toMatchObject(
      {
        status: "rejected",
        reason: { code: "integrity_failure" },
      },
    );
    const generationTwoClaims = await env.CANONICAL_DB.prepare(
      `SELECT claim.provider_run_id, head.provider_run_id AS head_provider_run_id
       FROM publication_provider_fence_claim AS claim
       JOIN publication_provider_fence_head AS head
         ON head.environment = claim.environment AND head.provider_id = claim.provider_id
       WHERE claim.environment = 'preview' AND claim.provider_id = ?1
         AND claim.generation = 2 AND head.generation = 2`,
    )
      .bind(PROVIDER_ID)
      .all<{ provider_run_id: string; head_provider_run_id: string }>();
    expect(generationTwoClaims.results).toHaveLength(1);
    expect(generationTwoClaims.results[0]?.provider_run_id).toBe(
      generationTwoClaims.results[0]?.head_provider_run_id,
    );
    const fenceLoser =
      generationTwoClaims.results[0]?.provider_run_id ===
      fenceCandidateA.providerRunId
        ? fenceCandidateB
        : fenceCandidateA;
    const fenceWinner =
      generationTwoClaims.results[0]?.provider_run_id ===
      fenceCandidateA.providerRunId
        ? fenceCandidateA
        : fenceCandidateB;
    await expectLedgerCode(
      persistSourceFreeRosterOutcome({
        database: env.CANONICAL_DB,
        fenceClaim: {
          environment: "preview",
          providerId: PROVIDER_ID,
          generation: 2,
          providerRunId: fenceLoser.providerRunId,
          runId: fenceLoser.runId,
          occurrenceId: fenceLoser.occurrenceId,
          deadlineAt: fenceLoser.admission.terminalDeadlineAt,
          claimedAt: later(fenceLoser.startedAt, 60_000),
        },
        rosterItemId: "model-a",
        status: "failed",
        errorCode: "provider_failed",
        attemptCount: 0,
        createdAt: new Date(
          Date.parse(fenceLoser.startedAt) + 120_000,
        ).toISOString(),
      }),
      "integrity_failure",
    );
    const loserFenceClosure = await env.CANONICAL_DB.prepare(
      `SELECT
        (SELECT count(*) FROM publication_provider_fence_claim
          WHERE provider_run_id = ?1) AS claims,
        (SELECT count(*) FROM publication_roster_operational_outcome
          WHERE provider_run_id = ?1) AS outcomes`,
    )
      .bind(fenceLoser.providerRunId)
      .first();
    expect(loserFenceClosure).toEqual({ claims: 0, outcomes: 0 });

    const fenceWinnerClaim = {
      environment: "preview" as const,
      providerId: PROVIDER_ID,
      generation: 2,
      providerRunId: fenceWinner.providerRunId,
      runId: fenceWinner.runId,
      occurrenceId: fenceWinner.occurrenceId,
      deadlineAt: fenceWinner.admission.terminalDeadlineAt,
      claimedAt: later(fenceWinner.startedAt, 60_000),
    };
    const delayedClaimTiming = await env.CANONICAL_DB.prepare(
      `SELECT provider_run.admitted_at_ms, claim.claimed_at_ms,
              prior_release.released_at_ms AS prior_released_at_ms
       FROM publication_provider_fence_claim AS claim
       JOIN publication_coordination_provider_run AS provider_run
         ON provider_run.provider_run_id = claim.provider_run_id
       JOIN publication_provider_fence_release AS prior_release
         ON prior_release.environment = claim.environment
        AND prior_release.provider_id = claim.provider_id
        AND prior_release.generation = claim.generation - 1
       WHERE claim.environment = 'preview' AND claim.provider_id = ?1
         AND claim.generation = 2`,
    )
      .bind(PROVIDER_ID)
      .first<{
        admitted_at_ms: number;
        claimed_at_ms: number;
        prior_released_at_ms: number;
      }>();
    expect(delayedClaimTiming).not.toBeNull();
    expect(delayedClaimTiming!.claimed_at_ms).toBeGreaterThan(
      delayedClaimTiming!.admitted_at_ms,
    );
    expect(delayedClaimTiming!.claimed_at_ms).toBeGreaterThan(
      delayedClaimTiming!.prior_released_at_ms,
    );

    const fenceWinnerOutcomeAt = later(fenceWinnerClaim.claimedAt, 60_000);
    await expect(
      persistSourceFreeRosterOutcome({
        database: env.CANONICAL_DB,
        fenceClaim: fenceWinnerClaim,
        rosterItemId: "model-a",
        status: "failed",
        errorCode: "provider_failed",
        attemptCount: 0,
        createdAt: fenceWinnerOutcomeAt,
      }),
    ).resolves.toEqual({ outcome: "applied" });
    const fenceWinnerTerminal = {
      database: env.CANONICAL_DB,
      environment: "preview" as const,
      providerId: PROVIDER_ID,
      providerRunId: fenceWinner.providerRunId,
      fenceGeneration: 2,
      terminal: {
        state: "failed" as const,
        rosterComplete: true as const,
        publicationDisposition: "unavailable" as const,
        cost: {
          requests: 0,
          bytes: 0,
          aiTokens: 0,
          browserMilliseconds: 0,
          elapsedMilliseconds: 0,
          costMicrousd: 0,
        },
        errorCodes: ["provider_failed", "provider_unavailable"] as const,
      },
      endedAt: later(fenceWinnerClaim.claimedAt, 120_000),
      reconciledAt: later(fenceWinnerClaim.claimedAt, 180_000),
      releasedAt: later(fenceWinnerClaim.claimedAt, 240_000),
      reconciliationResult: "terminal_confirmed" as const,
    };
    await expectLedgerCode(
      terminalizePublicationProvider({
        ...fenceWinnerTerminal,
        terminal: {
          ...fenceWinnerTerminal.terminal,
          errorCodes: [
            "provider_failed",
            "provider_quarantined",
            "provider_unavailable",
          ],
        },
      }),
      "invalid_input",
    );
    await expect(
      terminalizePublicationProvider(fenceWinnerTerminal),
    ).resolves.toEqual({ outcome: "applied" });

    const generationThreeClaim = {
      database: env.CANONICAL_DB,
      environment: "preview" as const,
      providerId: PROVIDER_ID,
      generation: 3,
      providerRunId: budgetWinner.providerRunId,
      runId: budgetWinner.runId,
      occurrenceId: budgetWinner.occurrenceId,
      deadlineAt: later(budgetWinner.scheduledAt, 43_200_000),
      claimedAt: later(budgetWinner.startedAt, 60_000),
      previous: {
        generation: 2,
        providerRunId: fenceWinner.providerRunId,
        runId: fenceWinner.runId,
        occurrenceId: fenceWinner.occurrenceId,
        deadlineAt: fenceWinner.admission.terminalDeadlineAt,
        claimedAt: fenceWinnerClaim.claimedAt,
      },
    };
    await expect(
      claimPublicationProviderFence(generationThreeClaim),
    ).resolves.toEqual({ outcome: "applied" });

    await expect(
      claimPublicationProviderFence({
        database: env.CANONICAL_DB,
        environment: "preview",
        providerId: PROVIDER_ID,
        generation: 1,
        providerRunId: lifecycle.providerRunId,
        runId: lifecycle.runId,
        occurrenceId: lifecycle.occurrenceId,
        deadlineAt: DEADLINE_AT,
        claimedAt: lifecycleClaim.claimedAt,
      }),
    ).resolves.toEqual({ outcome: "idempotent_success" });
    await expect(
      claimPublicationProviderFence({
        database: env.CANONICAL_DB,
        environment: "preview",
        providerId: PROVIDER_ID,
        generation: 2,
        providerRunId: fenceWinner.providerRunId,
        runId: fenceWinner.runId,
        occurrenceId: fenceWinner.occurrenceId,
        deadlineAt: fenceWinner.admission.terminalDeadlineAt,
        claimedAt: fenceWinnerClaim.claimedAt,
        previous,
      }),
    ).resolves.toEqual({ outcome: "idempotent_success" });

    await expectLedgerCode(
      persistSourceFreeRosterOutcome({
        database: env.CANONICAL_DB,
        fenceClaim: fenceWinnerClaim,
        rosterItemId: "model-a",
        status: "unavailable",
        errorCode: "provider_unavailable",
        attemptCount: 0,
        createdAt: later(generationThreeClaim.claimedAt, 60_000),
      }),
      "integrity_failure",
    );
    await expectLedgerCode(
      terminalizePublicationProvider({
        ...fenceWinnerTerminal,
        endedAt: later(fenceWinnerTerminal.endedAt, 1_000),
        reconciledAt: later(fenceWinnerTerminal.reconciledAt, 1_000),
        releasedAt: later(fenceWinnerTerminal.releasedAt, 1_000),
      }),
      "integrity_failure",
    );

    await expect(
      env.CANONICAL_DB.prepare(
        `INSERT INTO publication_roster_operational_outcome (
          provider_run_id, roster_item_id, status, evidence_id, offering_id,
          error_code, attempt_count, created_at_ms
        ) VALUES (?1, 'model-a', 'published_candidate', ?2, ?3, NULL, 1, ?4)`,
      )
        .bind(
          budgetWinner.providerRunId,
          "evd_70000000-0000-4000-8000-000000000007",
          "off_70000000-0000-4000-8000-000000000008",
          Date.parse(later(generationThreeClaim.claimedAt, 60_000)),
        )
        .run(),
    ).rejects.toThrow(/source-backed outcomes require provenance-v2 authority/);

    const generationThreeFence = {
      environment: "preview" as const,
      providerId: PROVIDER_ID,
      generation: 3,
      providerRunId: budgetWinner.providerRunId,
      runId: budgetWinner.runId,
      occurrenceId: budgetWinner.occurrenceId,
      deadlineAt: generationThreeClaim.deadlineAt,
      claimedAt: generationThreeClaim.claimedAt,
    };
    const generationThreeOutcomeAt = later(
      generationThreeClaim.claimedAt,
      60_000,
    );
    await expect(
      persistSourceFreeRosterOutcome({
        database: env.CANONICAL_DB,
        fenceClaim: generationThreeFence,
        rosterItemId: "model-a",
        status: "quarantined",
        errorCode: "provider_quarantined",
        attemptCount: 0,
        createdAt: generationThreeOutcomeAt,
      }),
    ).resolves.toEqual({ outcome: "applied" });
    const generationThreeTerminalTimes = {
      endedAt: later(generationThreeOutcomeAt, 60_000),
      reconciledAt: later(generationThreeOutcomeAt, 120_000),
      releasedAt: later(generationThreeOutcomeAt, 180_000),
    };
    await expectLedgerCode(
      terminalizePublicationProvider({
        database: env.CANONICAL_DB,
        environment: "preview",
        providerId: PROVIDER_ID,
        providerRunId: budgetWinner.providerRunId,
        fenceGeneration: 3,
        terminal: {
          state: "failed",
          rosterComplete: true,
          publicationDisposition: "unavailable",
          cost: {
            requests: 0,
            bytes: 0,
            aiTokens: 0,
            browserMilliseconds: 0,
            elapsedMilliseconds: 0,
            costMicrousd: 0,
          },
          errorCodes: ["provider_failed", "provider_unavailable"],
        },
        ...generationThreeTerminalTimes,
        reconciliationResult: "terminal_confirmed",
      }),
      "conflict",
    );
    await expect(
      terminalizePublicationProvider({
        database: env.CANONICAL_DB,
        environment: "preview",
        providerId: PROVIDER_ID,
        providerRunId: budgetWinner.providerRunId,
        fenceGeneration: 3,
        terminal: {
          state: "quarantined",
          rosterComplete: true,
          publicationDisposition: "unavailable",
          cost: {
            requests: 0,
            bytes: 0,
            aiTokens: 0,
            browserMilliseconds: 0,
            elapsedMilliseconds: 0,
            costMicrousd: 0,
          },
          errorCodes: ["provider_quarantined", "provider_unavailable"],
        },
        ...generationThreeTerminalTimes,
        reconciliationResult: "terminal_confirmed",
      }),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      env.CANONICAL_DB.prepare(
        "SELECT state, error_codes_json FROM publication_provider_terminal WHERE provider_run_id = ?1",
      )
        .bind(budgetWinner.providerRunId)
        .first(),
    ).resolves.toEqual({
      state: "quarantined",
      error_codes_json: '["provider_quarantined","provider_unavailable"]',
    });

    const replayBudget = await readPublicationBudgetAuthority({
      database: env.CANONICAL_DB,
      environment: "preview",
      budgetMonth: "2026-08",
    });
    expect(replayBudget).toMatchObject({
      monthlyUsedCostMicrousd: 0,
      monthlyReservedCostMicrousd: 18_000_000,
    });
    const replayAdmission = admissionFor(
      replayBudget,
      SCHEDULED_AT,
      lifecycle.observedAt,
    );
    const replay = validateAdjacentExplicitReplay({
      authority: "protected_operator",
      occurrenceId: lifecycle.occurrenceId,
      requestedAttemptNumber: 2,
      replayOfRunId: lifecycle.runId,
      runPlanId: RUN_PLAN_ID,
      runPlanHash: planHash,
      adjacentPrior: {
        occurrenceId: lifecycle.occurrenceId,
        runId: lifecycle.runId,
        attemptNumber: 1,
        terminal: true,
        outcome: "failed",
        runPlanId: RUN_PLAN_ID,
        runPlanHash: planHash,
      },
    });
    const replayIdentity = deterministicIdentity({
      scheduledAt: SCHEDULED_AT,
      observedAt: lifecycle.observedAt,
      startedAt: "2026-08-03T05:40:00.000Z",
      attemptNumber: 2,
      replayOfRunId: lifecycle.runId,
    });
    const persistReplay = () =>
      persistAdmittedPublicationRun({
        database: env.CANONICAL_DB,
        admission: replayAdmission,
        identity: {
          kind: "explicit_replay",
          runId: replayIdentity.runId,
          replay,
          replayAuthorizationHash: HASH_C,
        },
        providerRunIds: [replayIdentity.providerRunId],
        budget: replayBudget,
        codeVersion: CODE_VERSION,
        observedAt: lifecycle.observedAt,
        startedAt: "2026-08-03T05:40:00.000Z",
      });
    await expectLedgerCode(persistReplay(), "authority_missing");
    await expect(
      env.CANONICAL_DB.prepare(
        "SELECT attempt_number, replay_of_run_id FROM publication_coordination_run WHERE run_id = ?1",
      )
        .bind(replayIdentity.runId)
        .first(),
    ).resolves.toBeNull();

    await expect(
      env.CANONICAL_DB.prepare(
        `INSERT INTO publication_run_plan_revocation(
          run_plan_id, reason_code, effective_at_ms
        ) VALUES (?1, 'integrity_failure', ?2)`,
      )
        .bind(RUN_PLAN_ID, Date.parse(SCHEDULED_AT))
        .run(),
    ).rejects.toThrow(/cannot rewrite resolved scheduled history/u);
    await expect(
      env.CANONICAL_DB.prepare(
        `SELECT count(*) AS rows FROM publication_run_plan_revocation
         WHERE run_plan_id = ?1`,
      )
        .bind(RUN_PLAN_ID)
        .first(),
    ).resolves.toEqual({ rows: 0 });

    const isolation = await env.CANONICAL_DB.prepare(
      `SELECT
        (SELECT count(*) FROM pipeline_run) AS legacy_runs,
        (SELECT count(*) FROM provider_run) AS legacy_provider_runs,
        (SELECT count(*) FROM acquisition_run) AS acquisition_runs,
        (SELECT count(*) FROM roster_outcome) AS legacy_roster_outcomes,
        (SELECT count(*) FROM observation) AS observations,
        (SELECT count(*) FROM evidence) AS evidence_rows,
        (SELECT count(*) FROM field_claim) AS field_claims,
        (SELECT count(*) FROM offering) AS offerings,
        (SELECT count(*) FROM publication_retained_publication_authority) AS retained_authorities,
        (SELECT count(*) FROM publication_roster_operational_outcome
          WHERE evidence_id IS NOT NULL OR offering_id IS NOT NULL OR attempt_count <> 0)
          AS source_backed_outcomes`,
    ).first();
    expect(isolation).toEqual({
      legacy_runs: 0,
      legacy_provider_runs: 0,
      acquisition_runs: 0,
      legacy_roster_outcomes: 0,
      observations: 0,
      evidence_rows: 0,
      field_claims: 0,
      offerings: 0,
      retained_authorities: 0,
      source_backed_outcomes: 0,
    });
  });

  it("keeps the private control-plane fetch surface unchanged", async () => {
    const response = await exports.default.fetch(
      new Request("https://pipeline.invalid/"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "private_control_plane",
        message: "This service has no public route.",
      },
    });
  });
});
