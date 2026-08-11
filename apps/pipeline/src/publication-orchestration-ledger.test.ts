import { describe, expect, it, vi } from "vitest";

import {
  ORCHESTRATION_POLICY_REGISTRY,
  buildRejectedFiringReportV2,
  buildTerminalRunReportV2,
  decideFiringAdmission,
  publicationPlanProviderScopeHash,
  resolveOrchestrationPolicies,
} from "@quant-clarity/pipeline-core/orchestration-contract";
import {
  createPipelineRun,
  createProviderSlice,
  createScheduleOccurrence,
} from "@quant-clarity/pipeline-core";

import {
  PUBLICATION_ORCHESTRATION_LEDGER_ERROR_CODES,
  PUBLICATION_ORCHESTRATION_LEDGER_SQL,
  PublicationOrchestrationLedgerError,
  claimPublicationProviderFence,
  initializePublicationOrchestrationEnvironment,
  persistAdmittedPublicationRun,
  persistPublicationAdmissionRejection,
  persistPublicationRunTerminal,
  persistSourceFreeRosterOutcome,
  readPublicationBudgetAuthority,
  terminalizePublicationProvider,
} from "./publication-orchestration-ledger.js";

const SCHEDULED_AT = "2026-08-03T05:00:00.000Z";
const OBSERVED_AT = "2026-08-03T05:00:01.000Z";
const RUN_PLAN_ID = "rpl_11111111-1111-4111-8111-111111111111";
const HASH_A = `sha256:${"a".repeat(64)}`;
const PROVIDER_ID = "prv_11111111-1111-4111-8111-111111111111";
const OTHER_PROVIDER_ID = "prv_22222222-2222-4222-8222-222222222222";
const TEST_SCHEDULE = Object.freeze({
  name: "provider-refresh-v1",
  utcWeekdays: Object.freeze([1, 4]),
  utcHour: 5,
  utcMinute: 0,
});
const OCCURRENCE = createScheduleOccurrence({
  config: TEST_SCHEDULE,
  scheduledAt: SCHEDULED_AT,
  createdAt: OBSERVED_AT,
});
const OCCURRENCE_ID = OCCURRENCE.occurrenceId;
const FIRST_RUN = createPipelineRun({
  writer: { kind: "pipeline", identityId: "test-ledger" },
  occurrence: OCCURRENCE,
  attemptNumber: 1,
  codeVersion: "git:abcdef",
  schemaVersion: "1.0.0",
  providerScope: [PROVIDER_ID],
  startedAt: "2026-08-03T05:00:02.000Z",
});
const RUN_ID = FIRST_RUN.runId;
const PROVIDER_RUN_ID = createProviderSlice({
  run: FIRST_RUN,
  occurrence: OCCURRENCE,
  providerId: PROVIDER_ID,
}).providerSliceId;

type StatementCapture = Readonly<{ sql: string; values: readonly unknown[] }>;
type Script =
  | readonly unknown[]
  | Readonly<{ throw: Error }>
  | ((statements: readonly StatementCapture[]) => readonly unknown[]);

const result = (rows: readonly unknown[] = []) => ({
  results: [...rows],
  success: true,
  meta: {},
});

const insertedRow = (statement: StatementCapture) => {
  const match = /INSERT INTO [^(]+\(([\s\S]*?)\)\s*VALUES/.exec(statement.sql);
  if (match?.[1] === undefined) throw new Error("expected fixed INSERT SQL");
  const columns = match[1].split(",").map((column) => column.trim());
  return Object.fromEntries(
    columns.map((column, index) => [column, statement.values[index]]),
  );
};

const admittedFixture = () => {
  const references = [
    ORCHESTRATION_POLICY_REGISTRY.provider_retry,
    ORCHESTRATION_POLICY_REGISTRY.run_budget,
    ORCHESTRATION_POLICY_REGISTRY.terminal_deadline,
  ].map(({ role, version, contentHash }) => ({ role, version, contentHash }));
  const policies = resolveOrchestrationPolicies(references);
  const providers = [
    {
      ordinal: 0,
      providerId: PROVIDER_ID,
      adapterVersion: "adapter-a@1",
      rosterVersion: "roster-a@1",
      rosterContentHash: HASH_A,
      sourceRegisterVersion: "source-a@1",
      sourceRegisterArtifactHash: `sha256:${"b".repeat(64)}`,
      requestCeiling: 2,
      byteCeiling: 100,
      aiTokenCeiling: 0,
      browserMillisecondCeiling: 0,
      elapsedMillisecondCeiling: 1_000,
      costMicrousdCeiling: 100,
      retryPolicyHash: ORCHESTRATION_POLICY_REGISTRY.provider_retry.contentHash,
    },
  ];
  const decision = decideFiringAdmission({
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
      runPlanHash: HASH_A,
      canonicalSchemaVersion: "1.0.0",
      pipelineContractVersion: "pipeline-run-contract@1",
    },
    plan: {
      state: "authorized",
      contractVersion: "publication-run-plan@1",
      runPlanId: RUN_PLAN_ID,
      planHash: HASH_A,
      environment: "preview",
      scheduleName: "provider-refresh-v1",
      scheduleExpression: "0 5 * * 1,4",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveTo: "2026-09-01T00:00:00.000Z",
      scheduledAt: SCHEDULED_AT,
      canonicalSchemaVersion: "1.0.0",
      pipelineContractVersion: "pipeline-run-contract@1",
      providerScopeHash: publicationPlanProviderScopeHash([PROVIDER_ID]),
      policySetHash: policies.policySetHash,
      providers,
      policies: references,
      approval: {
        artifactPath: "docs/compliance/run-plans/preview.json",
        artifactHash: `sha256:${"c".repeat(64)}`,
        approvedAt: "2026-08-01T00:00:00.000Z",
        approverRoles: [
          "legal_source_owner",
          "platform_owner",
          "product_owner",
        ],
      },
    },
    budgetState: {
      monthlyUsedCostMicrousd: 0,
      monthlyReservedCostMicrousd: 0,
      expensiveWorkBreakerTripped: false,
    },
    now: OBSERVED_AT,
  });
  if (decision.decision !== "admitted") throw new Error("fixture not admitted");
  return decision;
};

const database = (scripts: Script[]) => {
  const sessions: (D1SessionConstraint | undefined)[] = [];
  const batches: StatementCapture[][] = [];
  const withSession = vi.fn((constraint?: D1SessionConstraint) => {
    sessions.push(constraint);
    return {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return { sql, values } as unknown as D1PreparedStatement;
          },
        } as unknown as D1PreparedStatement;
      },
      batch(statements: D1PreparedStatement[]) {
        const captured = statements as unknown as StatementCapture[];
        batches.push(captured);
        const next = scripts.shift();
        if (next === undefined)
          return Promise.reject(new Error("unplanned D1 call"));
        if (typeof next === "function")
          return Promise.resolve(next(captured) as D1Result[]);
        if (!Array.isArray(next))
          return Promise.reject(new Error("scripted D1 failure"));
        return Promise.resolve(next as D1Result[]);
      },
    } as unknown as D1DatabaseSession;
  });
  return {
    value: { withSession } as unknown as D1Database,
    sessions,
    batches,
    withSession,
  };
};

const budgetFixture = async (monthlyAllocationMicrousd = 25_000_000) => {
  const fake = database([
    [
      result([
        {
          capability: "publication-orchestration-ledger@1",
          environment: "preview",
          monthly_allocation_microusd: monthlyAllocationMicrousd,
          generation: 1,
          tripped: 0,
          monthly_used_cost_microusd: 0,
          monthly_reserved_cost_microusd: 0,
        },
      ]),
    ],
  ]);
  return readPublicationBudgetAuthority({
    database: fake.value,
    environment: "preview",
    budgetMonth: "2026-08",
  });
};

const rejectionFixture = (
  code:
    | "plan_invalid"
    | "plan_unavailable"
    | "event_not_scheduled" = "plan_invalid",
) => {
  const authority = decideFiringAdmission({
    event: {
      kind: code === "event_not_scheduled" ? "manual" : "scheduled",
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
      runPlanHash: HASH_A,
      canonicalSchemaVersion: "1.0.0",
      pipelineContractVersion: "pipeline-run-contract@1",
    },
    plan:
      code === "plan_unavailable"
        ? { state: "unavailable" }
        : { state: "invalid" },
    budgetState: {
      monthlyUsedCostMicrousd: 0,
      monthlyReservedCostMicrousd: 0,
      expensiveWorkBreakerTripped: false,
    },
    now: OBSERVED_AT,
  });
  if (authority.decision !== "rejected" || authority.reason !== code)
    throw new Error("fixture rejection authority mismatch");
  const report = buildRejectedFiringReportV2({
    scheduleName: "provider-refresh-v1",
    scheduleExpression: "0 5 * * 1,4",
    occurrenceId: OCCURRENCE_ID,
    scheduledAt: SCHEDULED_AT,
    observedAt: OBSERVED_AT,
    rejectionCode: code,
    requestedPlan: {
      runPlanId: RUN_PLAN_ID,
      runPlanHash: HASH_A,
      environment: "preview",
    },
  });
  return { authority, report };
};

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({
    name: "PublicationOrchestrationLedgerError",
    code,
    message: "Publication orchestration state could not be persisted safely.",
  });
};

describe("publication orchestration ledger fixed D1 adapter", () => {
  it("initializes one environment and breaker in one transactional batch", async () => {
    const initializedAtMs = Date.parse("2026-08-01T00:00:00.000Z");
    const envRow = {
      singleton: 1,
      environment: "preview",
      monthly_allocation_microusd: 25_000_000,
      initialized_at_ms: initializedAtMs,
    };
    const breakerRow = {
      environment: "preview",
      budget_month: "2026-08",
      generation: 1,
      tripped: 0,
      observed_at_ms: initializedAtMs,
    };
    const fake = database([
      [result(), result(), result(), result([envRow]), result([breakerRow])],
    ]);
    await expect(
      initializePublicationOrchestrationEnvironment({
        database: fake.value,
        environment: "preview",
        monthlyAllocationMicrousd: 25_000_000,
        budgetMonth: "2026-08",
        initializedAtMs,
      }),
    ).resolves.toEqual({ outcome: "applied" });
    expect(fake.sessions).toEqual(["first-primary"]);
    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(5);
  });

  it("fails closed while any legacy run graph owner is active", async () => {
    const fake = database([
      { throw: new Error("legacy owner active") },
      [result(), result()],
      { throw: new Error("legacy owner still active") },
      [result(), result()],
    ]);
    await expectCode(
      initializePublicationOrchestrationEnvironment({
        database: fake.value,
        environment: "preview",
        monthlyAllocationMicrousd: 25_000_000,
        budgetMonth: "2026-08",
        initializedAtMs: Date.parse("2026-08-01T00:00:00.000Z"),
      }),
      "conflict",
    );
    expect(fake.batches.map((batch) => batch.length)).toEqual([5, 2, 5, 2]);
  });

  it("fails a valid nominal durable rejection closed before any D1 session", async () => {
    const fixture = rejectionFixture();
    const fake = database([]);
    await expectCode(
      persistPublicationAdmissionRejection({
        database: fake.value,
        rejectionAuthority: fixture.authority,
        report: fixture.report,
      }),
      "authority_missing",
    );
    expect(fake.withSession).not.toHaveBeenCalled();
  });

  it("rejects malformed or non-durable admission reports before D1", async () => {
    const fixture = rejectionFixture("event_not_scheduled");
    const fake = database([]);
    await expectCode(
      persistPublicationAdmissionRejection({
        database: fake.value,
        rejectionAuthority: fixture.authority,
        report: fixture.report,
      }),
      "invalid_input",
    );
    expect(fake.withSession).not.toHaveBeenCalled();
  });

  it("requires nominal rejection authority, exact reason, and deterministic occurrence", async () => {
    const fixture = rejectionFixture();
    const mismatchedAuthority = rejectionFixture("plan_unavailable").authority;
    const differentOccurrenceAuthority = decideFiringAdmission({
      event: {
        kind: "scheduled",
        workflowName: "quant-clarity-publication-preview",
        scheduleExpression: "0 5 * * 1,4",
        scheduledAt: "2026-08-06T05:00:00.000Z",
        payload: {},
      },
      protectedContext: {
        workflowName: "quant-clarity-publication-preview",
        scheduleName: "provider-refresh-v1",
        scheduleExpression: "0 5 * * 1,4",
        environment: "preview",
        runPlanId: RUN_PLAN_ID,
        runPlanHash: HASH_A,
        canonicalSchemaVersion: "1.0.0",
        pipelineContractVersion: "pipeline-run-contract@1",
      },
      plan: { state: "invalid" },
      budgetState: {
        monthlyUsedCostMicrousd: 0,
        monthlyReservedCostMicrousd: 0,
        expensiveWorkBreakerTripped: false,
      },
      now: "2026-08-06T05:00:01.000Z",
    });
    const arbitraryOccurrenceReport = buildRejectedFiringReportV2({
      scheduleName: "provider-refresh-v1",
      scheduleExpression: "0 5 * * 1,4",
      occurrenceId: "occ_11111111-1111-4111-8111-111111111111",
      scheduledAt: SCHEDULED_AT,
      observedAt: OBSERVED_AT,
      rejectionCode: "plan_invalid",
      requestedPlan: {
        runPlanId: RUN_PLAN_ID,
        runPlanHash: HASH_A,
        environment: "preview",
      },
    });
    for (const [label, authority, report] of [
      [
        "forged structural authority",
        { decision: "rejected", runAction: "none", reason: "plan_invalid" },
        fixture.report,
      ],
      ["mismatched reason", mismatchedAuthority, fixture.report],
      [
        "authority from another occurrence",
        differentOccurrenceAuthority,
        fixture.report,
      ],
      ["arbitrary occurrence ID", fixture.authority, arbitraryOccurrenceReport],
    ] as const) {
      const fake = database([]);
      const error = await persistPublicationAdmissionRejection({
        database: fake.value,
        rejectionAuthority: authority,
        report,
      }).catch((value: unknown) => value);
      expect(error, label).toMatchObject({
        name: "PublicationOrchestrationLedgerError",
        code: "invalid_input",
      });
      expect(fake.withSession, label).not.toHaveBeenCalled();
    }
  });

  it("returns a frozen branded budget authority from one primary snapshot", async () => {
    const fake = database([
      [
        result([
          {
            capability: "publication-orchestration-ledger@1",
            environment: "preview",
            monthly_allocation_microusd: 25_000_000,
            generation: 1,
            tripped: 0,
            monthly_used_cost_microusd: 100,
            monthly_reserved_cost_microusd: 200,
          },
        ]),
      ],
    ]);
    const authority = await readPublicationBudgetAuthority({
      database: fake.value,
      environment: "preview",
      budgetMonth: "2026-08",
    });
    expect(authority).toMatchObject({
      capability: "publication-orchestration-ledger@1",
      breakerGeneration: 1,
      monthlyUsedCostMicrousd: 100,
      monthlyReservedCostMicrousd: 200,
    });
    expect(Object.isFrozen(authority)).toBe(true);
    expect(fake.sessions).toEqual(["first-primary"]);
  });

  it("persists admitted attempt 1 and its exact Provider/budget closure", async () => {
    const admission = admittedFixture();
    const budget = await budgetFixture();
    const fake = database([
      (statements) => {
        const inserted = statements.slice(0, 5).map(insertedRow);
        return [
          ...Array.from({ length: 5 }, () => result()),
          result([inserted[0]]),
          result([inserted[1]]),
          result([inserted[2]]),
          result([inserted[3]]),
          result([inserted[4]]),
        ];
      },
    ]);
    await expect(
      persistAdmittedPublicationRun({
        database: fake.value,
        admission,
        identity: {
          kind: "attempt_1",
          occurrenceId: OCCURRENCE_ID,
          runId: RUN_ID,
        },
        providerRunIds: [PROVIDER_RUN_ID],
        budget,
        codeVersion: "git:abcdef",
        observedAt: OBSERVED_AT,
        startedAt: "2026-08-03T05:00:02.000Z",
      }),
    ).resolves.toEqual({ outcome: "applied" });
    expect(fake.batches[0]).toHaveLength(10);
  });

  it.each([
    [
      "occurrence",
      {
        identity: {
          kind: "attempt_1" as const,
          occurrenceId: "occ_11111111-1111-4111-8111-111111111111",
          runId: RUN_ID,
        },
        providerRunIds: [PROVIDER_RUN_ID],
      },
    ],
    [
      "run",
      {
        identity: {
          kind: "attempt_1" as const,
          occurrenceId: OCCURRENCE_ID,
          runId: "run_11111111-1111-4111-8111-111111111111",
        },
        providerRunIds: [PROVIDER_RUN_ID],
      },
    ],
    [
      "Provider run",
      {
        identity: {
          kind: "attempt_1" as const,
          occurrenceId: OCCURRENCE_ID,
          runId: RUN_ID,
        },
        providerRunIds: ["pvr_11111111-1111-4111-8111-111111111111"],
      },
    ],
  ])(
    "rejects an arbitrary canonical %s ID before D1",
    async (_label, authority) => {
      const fake = database([]);
      await expectCode(
        persistAdmittedPublicationRun({
          database: fake.value,
          admission: admittedFixture(),
          identity: authority.identity,
          providerRunIds: authority.providerRunIds,
          budget: await budgetFixture(),
          codeVersion: "git:abcdef",
          observedAt: OBSERVED_AT,
          startedAt: "2026-08-03T05:00:02.000Z",
        }),
        "invalid_input",
      );
      expect(fake.withSession).not.toHaveBeenCalled();
    },
  );

  it("rejects decorated, accessor-backed, and hostile Proxy arrays before D1", async () => {
    const cookieArray = [PROVIDER_RUN_ID];
    Object.defineProperty(cookieArray, "cookie", {
      value: "visitor-cookie-canary",
      enumerable: true,
    });
    const symbolArray = [PROVIDER_RUN_ID];
    Object.defineProperty(symbolArray, Symbol("visitor"), {
      value: "symbol-canary",
    });
    const accessorArray = new Array<string>(1);
    Object.defineProperty(accessorArray, "0", {
      get: () => {
        throw new Error("accessor-canary");
      },
      enumerable: true,
    });
    const proxyArray = new Proxy([PROVIDER_RUN_ID], {
      ownKeys() {
        throw new Error("proxy-canary");
      },
    });
    for (const hostile of [
      cookieArray,
      symbolArray,
      accessorArray,
      proxyArray,
    ]) {
      const fake = database([]);
      await expectCode(
        persistAdmittedPublicationRun({
          database: fake.value,
          admission: admittedFixture(),
          identity: {
            kind: "attempt_1",
            occurrenceId: OCCURRENCE_ID,
            runId: RUN_ID,
          },
          providerRunIds: hostile,
          budget: await budgetFixture(),
          codeVersion: "git:abcdef",
          observedAt: OBSERVED_AT,
          startedAt: "2026-08-03T05:00:02.000Z",
        }),
        "invalid_input",
      );
      expect(fake.withSession).not.toHaveBeenCalled();
    }
  });

  it("fails a caller-supplied replay closed before any D1 mutation", async () => {
    const admission = admittedFixture();
    const budget = await budgetFixture();
    const replayRun = createPipelineRun({
      writer: { kind: "pipeline", identityId: "test-ledger" },
      occurrence: OCCURRENCE,
      attemptNumber: 2,
      replayOfRunId: RUN_ID,
      codeVersion: "git:abcdef",
      schemaVersion: "1.0.0",
      providerScope: [PROVIDER_ID],
      startedAt: "2026-08-03T05:10:00.000Z",
    });
    const replayRunId = replayRun.runId;
    const replayProviderRunId = createProviderSlice({
      run: replayRun,
      occurrence: OCCURRENCE,
      providerId: PROVIDER_ID,
    }).providerSliceId;
    const fake = database([]);
    await expectCode(
      persistAdmittedPublicationRun({
        database: fake.value,
        admission,
        identity: {
          kind: "explicit_replay",
          runId: replayRunId,
          replay: {
            decision: "admit_replay",
            occurrenceId: OCCURRENCE_ID,
            attemptNumber: 2,
            replayOfRunId: RUN_ID,
            runPlanId: RUN_PLAN_ID,
            runPlanHash: HASH_A,
          },
          replayAuthorizationHash: `sha256:${"d".repeat(64)}`,
        },
        providerRunIds: [replayProviderRunId],
        budget,
        codeVersion: "git:abcdef",
        observedAt: OBSERVED_AT,
        startedAt: "2026-08-03T05:10:00.000Z",
      }),
      "authority_missing",
    );
    expect(fake.withSession).not.toHaveBeenCalled();
  });

  it("claims generation one with exact immutable claim and head closure", async () => {
    const deadlineAt = "2026-08-03T17:00:00.000Z";
    const claimedAt = "2026-08-03T05:00:02.000Z";
    const claim = {
      environment: "preview",
      provider_id: PROVIDER_ID,
      generation: 1,
      provider_run_id: PROVIDER_RUN_ID,
      run_id: RUN_ID,
      occurrence_id: OCCURRENCE_ID,
      deadline_at_ms: Date.parse(deadlineAt),
      claimed_at_ms: Date.parse(claimedAt),
    };
    const head = {
      environment: "preview",
      provider_id: PROVIDER_ID,
      generation: 1,
      provider_run_id: PROVIDER_RUN_ID,
    };
    const fake = database([
      [
        result(),
        result(),
        result([claim]),
        result([head]),
        result([
          {
            closed_history: 1,
            head_generation: 1,
            head_provider_run_id: PROVIDER_RUN_ID,
          },
        ]),
      ],
    ]);
    await expect(
      claimPublicationProviderFence({
        database: fake.value,
        environment: "preview",
        providerId: PROVIDER_ID,
        generation: 1,
        providerRunId: PROVIDER_RUN_ID,
        runId: RUN_ID,
        occurrenceId: OCCURRENCE_ID,
        deadlineAt,
        claimedAt,
      }),
    ).resolves.toEqual({ outcome: "applied" });
  });

  it("accepts an exact immutable claim replay after a closed descendant advances the head", async () => {
    const deadlineAt = "2026-08-03T17:00:00.000Z";
    const claimedAt = "2026-08-03T05:00:02.000Z";
    const claim = {
      environment: "preview",
      provider_id: PROVIDER_ID,
      generation: 1,
      provider_run_id: PROVIDER_RUN_ID,
      run_id: RUN_ID,
      occurrence_id: OCCURRENCE_ID,
      deadline_at_ms: Date.parse(deadlineAt),
      claimed_at_ms: Date.parse(claimedAt),
    };
    const descendantHead = {
      environment: "preview",
      provider_id: PROVIDER_ID,
      generation: 2,
      provider_run_id: "pvr_22222222-2222-4222-8222-222222222222",
    };
    const fake = database([
      { throw: new Error("immutable claim") },
      [
        result([claim]),
        result([descendantHead]),
        result([
          {
            closed_history: 1,
            head_generation: 2,
            head_provider_run_id: descendantHead.provider_run_id,
          },
        ]),
      ],
    ]);
    await expect(
      claimPublicationProviderFence({
        database: fake.value,
        environment: "preview",
        providerId: PROVIDER_ID,
        generation: 1,
        providerRunId: PROVIDER_RUN_ID,
        runId: RUN_ID,
        occurrenceId: OCCURRENCE_ID,
        deadlineAt,
        claimedAt,
      }),
    ).resolves.toEqual({ outcome: "idempotent_success" });
  });

  it("does not accept a generation advance under the wrong immutable prior owner", async () => {
    const nextOccurrence = createScheduleOccurrence({
      config: TEST_SCHEDULE,
      scheduledAt: "2026-08-06T05:00:00.000Z",
      createdAt: "2026-08-06T05:00:01.000Z",
    });
    const nextRun = createPipelineRun({
      writer: { kind: "pipeline", identityId: "test-ledger" },
      occurrence: nextOccurrence,
      attemptNumber: 1,
      codeVersion: "git:abcdef",
      schemaVersion: "1.0.0",
      providerScope: [PROVIDER_ID],
      startedAt: "2026-08-06T05:00:02.000Z",
    });
    const newProviderRunId = createProviderSlice({
      run: nextRun,
      occurrence: nextOccurrence,
      providerId: PROVIDER_ID,
    }).providerSliceId;
    const newRunId = nextRun.runId;
    const newOccurrenceId = nextOccurrence.occurrenceId;
    const wrongPriorRunId = "run_33333333-3333-4333-8333-333333333333";
    const deadlineAt = "2026-08-06T17:00:00.000Z";
    const claimedAt = "2026-08-06T05:10:00.000Z";
    const priorDeadlineAt = "2026-08-03T16:00:00.000Z";
    const priorClaimedAt = "2026-08-03T05:00:02.000Z";
    const newClaim = {
      environment: "preview",
      provider_id: PROVIDER_ID,
      generation: 2,
      provider_run_id: newProviderRunId,
      run_id: newRunId,
      occurrence_id: newOccurrenceId,
      deadline_at_ms: Date.parse(deadlineAt),
      claimed_at_ms: Date.parse(claimedAt),
    };
    const newHead = {
      environment: "preview",
      provider_id: PROVIDER_ID,
      generation: 2,
      provider_run_id: newProviderRunId,
    };
    const actualPriorClaim = {
      environment: "preview",
      provider_id: PROVIDER_ID,
      generation: 1,
      provider_run_id: PROVIDER_RUN_ID,
      run_id: RUN_ID,
      occurrence_id: OCCURRENCE_ID,
      deadline_at_ms: Date.parse(priorDeadlineAt),
      claimed_at_ms: Date.parse(priorClaimedAt),
    };
    const fake = database([
      { throw: new Error("ambiguous") },
      [
        result([newClaim]),
        result([newHead]),
        result([
          {
            closed_history: 1,
            head_generation: 2,
            head_provider_run_id: newProviderRunId,
          },
        ]),
        result([actualPriorClaim]),
      ],
    ]);
    await expectCode(
      claimPublicationProviderFence({
        database: fake.value,
        environment: "preview",
        providerId: PROVIDER_ID,
        generation: 2,
        providerRunId: newProviderRunId,
        runId: newRunId,
        occurrenceId: newOccurrenceId,
        deadlineAt,
        claimedAt,
        previous: {
          generation: 1,
          providerRunId: PROVIDER_RUN_ID,
          runId: wrongPriorRunId,
          occurrenceId: OCCURRENCE_ID,
          deadlineAt: priorDeadlineAt,
          claimedAt: priorClaimedAt,
        },
      }),
      "integrity_failure",
    );
  });

  it("persists a source-free zero-attempt roster outcome against the full claim", async () => {
    const claimedAt = "2026-08-03T05:00:02.000Z";
    const deadlineAt = "2026-08-03T17:00:00.000Z";
    const createdAt = "2026-08-03T05:00:03.000Z";
    const claim = {
      environment: "preview",
      provider_id: PROVIDER_ID,
      generation: 1,
      provider_run_id: PROVIDER_RUN_ID,
      run_id: RUN_ID,
      occurrence_id: OCCURRENCE_ID,
      deadline_at_ms: Date.parse(deadlineAt),
      claimed_at_ms: Date.parse(claimedAt),
    };
    const outcome = {
      provider_run_id: PROVIDER_RUN_ID,
      roster_item_id: "model-a",
      status: "failed",
      evidence_id: null,
      offering_id: null,
      error_code: "provider_failed",
      attempt_count: 0,
      created_at_ms: Date.parse(createdAt),
    };
    const fake = database([
      [result(), result(), result([claim]), result([outcome])],
    ]);
    await expect(
      persistSourceFreeRosterOutcome({
        database: fake.value,
        fenceClaim: {
          environment: "preview",
          providerId: PROVIDER_ID,
          generation: 1,
          providerRunId: PROVIDER_RUN_ID,
          runId: RUN_ID,
          occurrenceId: OCCURRENCE_ID,
          deadlineAt,
          claimedAt,
        },
        rosterItemId: "model-a",
        status: "failed",
        errorCode: "provider_failed",
        attemptCount: 0,
        createdAt,
      }),
    ).resolves.toEqual({ outcome: "applied" });
  });

  it("terminalizes, reconciles, and releases one unavailable Provider atomically", async () => {
    const fake = database([
      (statements) => {
        const terminal = insertedRow(statements[1]!);
        const reconciliation = insertedRow(statements[2]!);
        const release = insertedRow(statements[3]!);
        return [
          result(),
          result(),
          result(),
          result(),
          result([terminal]),
          result([reconciliation]),
          result([release]),
        ];
      },
    ]);
    await expect(
      terminalizePublicationProvider({
        database: fake.value,
        environment: "preview",
        providerId: PROVIDER_ID,
        providerRunId: PROVIDER_RUN_ID,
        fenceGeneration: 1,
        terminal: {
          state: "failed",
          rosterComplete: true,
          publicationDisposition: "unavailable",
          cost: {
            requests: 0,
            bytes: 0,
            aiTokens: 0,
            browserMilliseconds: 0,
            elapsedMilliseconds: 10,
            costMicrousd: 0,
          },
          errorCodes: ["provider_failed", "provider_unavailable"],
        },
        endedAt: "2026-08-03T05:01:00.000Z",
        reconciledAt: "2026-08-03T05:01:01.000Z",
        releasedAt: "2026-08-03T05:01:02.000Z",
        reconciliationResult: "terminal_confirmed",
      }),
    ).resolves.toEqual({ outcome: "applied" });
    expect(fake.batches[0]).toHaveLength(7);
  });

  it("fails closed before D1 for dormant source-backed terminal and malformed errors", async () => {
    const base = {
      database: database([]).value,
      environment: "preview" as const,
      providerId: PROVIDER_ID,
      providerRunId: PROVIDER_RUN_ID,
      fenceGeneration: 1,
      endedAt: "2026-08-03T05:01:00.000Z",
      reconciledAt: "2026-08-03T05:01:01.000Z",
      releasedAt: "2026-08-03T05:01:02.000Z",
      reconciliationResult: "terminal_confirmed" as const,
    };
    await expectCode(
      terminalizePublicationProvider({
        ...base,
        terminal: {
          state: "ready",
          rosterComplete: true,
          publicationDisposition: "new",
          sliceId: "prn_11111111-1111-4111-8111-111111111111",
          cost: {
            requests: 0,
            bytes: 0,
            aiTokens: 0,
            browserMilliseconds: 0,
            elapsedMilliseconds: 0,
            costMicrousd: 0,
          },
          errorCodes: [],
        },
      }),
      "authority_missing",
    );
    await expectCode(
      terminalizePublicationProvider({
        ...base,
        terminal: {
          state: "failed",
          rosterComplete: true,
          publicationDisposition: "new",
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
      }),
      "invalid_input",
    );
    await expectCode(
      terminalizePublicationProvider({
        ...base,
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
          errorCodes: null,
        },
      } as never),
      "invalid_input",
    );
  });

  it.each([
    "last_known_good_only",
    "partial_provider_refresh",
    "run_wide_quarantine",
    "zero_usable_providers",
  ])(
    "rejects run-derived Provider terminal code %s before D1",
    async (code) => {
      const fake = database([]);
      await expectCode(
        terminalizePublicationProvider({
          database: fake.value,
          environment: "preview",
          providerId: PROVIDER_ID,
          providerRunId: PROVIDER_RUN_ID,
          fenceGeneration: 1,
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
            errorCodes: [
              code,
              "provider_failed",
              "provider_unavailable",
            ].sort(),
          },
          endedAt: "2026-08-03T05:01:00.000Z",
          reconciledAt: "2026-08-03T05:01:01.000Z",
          releasedAt: "2026-08-03T05:01:02.000Z",
          reconciliationResult: "terminal_confirmed",
        }),
        "invalid_input",
      );
      expect(fake.withSession).not.toHaveBeenCalled();
    },
  );

  it("rejects a failed Provider terminal carrying quarantine semantics before D1", async () => {
    const fake = database([]);
    await expectCode(
      terminalizePublicationProvider({
        database: fake.value,
        environment: "preview",
        providerId: PROVIDER_ID,
        providerRunId: PROVIDER_RUN_ID,
        fenceGeneration: 1,
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
          errorCodes: [
            "provider_failed",
            "provider_quarantined",
            "provider_unavailable",
          ],
        },
        endedAt: "2026-08-03T05:01:00.000Z",
        reconciledAt: "2026-08-03T05:01:01.000Z",
        releasedAt: "2026-08-03T05:01:02.000Z",
        reconciliationResult: "terminal_confirmed",
      }),
      "invalid_input",
    );
    expect(fake.withSession).not.toHaveBeenCalled();
  });

  it("closes a sealed terminal run report from admitted authority", async () => {
    const admission = admittedFixture();
    const runAuthority = {
      kind: "attempt_1" as const,
      occurrenceId: OCCURRENCE_ID,
      runId: RUN_ID,
      codeVersion: "git:abcdef",
    };
    const report = buildTerminalRunReportV2({
      admission,
      runAuthority,
      startedAt: "2026-08-03T05:00:02.000Z",
      endedAt: "2026-08-03T05:01:00.000Z",
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
            elapsedMilliseconds: 10,
            costMicrousd: 0,
          },
          errorCodes: ["provider_failed", "provider_unavailable"],
        },
      ],
      runWideQuarantine: false,
    });
    const fake = database([
      (statements) => {
        const row = insertedRow(statements[0]!);
        return [result(), result([row])];
      },
    ]);
    await expect(
      persistPublicationRunTerminal({
        database: fake.value,
        admission,
        runAuthority,
        report,
      }),
    ).resolves.toEqual({ outcome: "applied" });
  });

  it("derives every terminal column from the encoded report snapshot", async () => {
    const admission = admittedFixture();
    const runAuthority = {
      kind: "attempt_1" as const,
      occurrenceId: OCCURRENCE_ID,
      runId: RUN_ID,
      codeVersion: "git:abcdef",
    };
    const report = buildTerminalRunReportV2({
      admission,
      runAuthority,
      startedAt: "2026-08-03T05:00:02.000Z",
      endedAt: "2026-08-03T05:01:00.000Z",
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
            elapsedMilliseconds: 10,
            costMicrousd: 0,
          },
          errorCodes: ["provider_failed", "provider_unavailable"],
        },
      ],
      runWideQuarantine: false,
    });
    let rootOwnKeyReads = 0;
    const statefulReport = new Proxy(
      { ...report },
      {
        ownKeys(target) {
          rootOwnKeyReads += 1;
          return Reflect.ownKeys(target);
        },
        get(target, property, receiver) {
          if (rootOwnKeyReads >= 1 && property === "runOutcome")
            return "quarantined";
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    let inserted: Readonly<Record<string, unknown>> | undefined;
    const fake = database([
      (statements) => {
        inserted = insertedRow(statements[0]!);
        return [result(), result([inserted])];
      },
    ]);
    await expect(
      persistPublicationRunTerminal({
        database: fake.value,
        admission,
        runAuthority,
        report: statefulReport,
      }),
    ).resolves.toEqual({ outcome: "applied" });
    expect(rootOwnKeyReads).toBeGreaterThanOrEqual(1);
    expect(inserted).toMatchObject({
      run_outcome: report.runOutcome,
      run_wide_quarantine: 0,
      report_hash: report.seal.contentHash,
    });
    expect(
      JSON.parse(inserted?.report_text as string) as { runOutcome: string },
    ).toMatchObject({ runOutcome: report.runOutcome });
  });

  it.each([
    ["providerRunIds", { providerRunIds: null }],
    ["identity", { identity: null }],
  ])("closes hostile nested %s inputs before D1", async (_label, override) => {
    const fake = database([]);
    const admission = admittedFixture();
    const budget = await budgetFixture();
    await expectCode(
      persistAdmittedPublicationRun({
        database: fake.value,
        admission,
        identity: {
          kind: "attempt_1",
          occurrenceId: OCCURRENCE_ID,
          runId: RUN_ID,
        },
        providerRunIds: [PROVIDER_RUN_ID],
        budget,
        codeVersion: "git:abcdef",
        observedAt: OBSERVED_AT,
        startedAt: "2026-08-03T05:00:02.000Z",
        ...override,
      } as never),
      "invalid_input",
    );
    expect(fake.withSession).not.toHaveBeenCalled();
  });

  it("refuses admitted persistence under an explicitly disabled zero allocation", async () => {
    const fake = database([]);
    await expectCode(
      persistAdmittedPublicationRun({
        database: fake.value,
        admission: admittedFixture(),
        identity: {
          kind: "attempt_1",
          occurrenceId: OCCURRENCE_ID,
          runId: RUN_ID,
        },
        providerRunIds: [PROVIDER_RUN_ID],
        budget: await budgetFixture(0),
        codeVersion: "git:abcdef",
        observedAt: OBSERVED_AT,
        startedAt: "2026-08-03T05:00:02.000Z",
      }),
      "invalid_input",
    );
    expect(fake.withSession).not.toHaveBeenCalled();
  });

  it.each([
    ["environment", { environment: "production" as const }],
    ["provider", { providerId: OTHER_PROVIDER_ID }],
    ["generation", { generation: 2 }],
  ])(
    "refuses an idempotent roster outcome under the wrong %s fence tuple",
    async (_label, override) => {
      const claimedAt = "2026-08-03T05:00:02.000Z";
      const deadlineAt = "2026-08-03T17:00:00.000Z";
      const createdAt = "2026-08-03T05:00:03.000Z";
      const outcome = {
        provider_run_id: PROVIDER_RUN_ID,
        roster_item_id: "model-a",
        status: "failed",
        evidence_id: null,
        offering_id: null,
        error_code: "provider_failed",
        attempt_count: 0,
        created_at_ms: Date.parse(createdAt),
      };
      const fake = database([
        { throw: new Error("ambiguous") },
        [result(), result([outcome])],
      ]);
      await expectCode(
        persistSourceFreeRosterOutcome({
          database: fake.value,
          fenceClaim: {
            environment: "preview",
            providerId: PROVIDER_ID,
            generation: 1,
            providerRunId: PROVIDER_RUN_ID,
            runId: RUN_ID,
            occurrenceId: OCCURRENCE_ID,
            deadlineAt,
            claimedAt,
            ...override,
          },
          rosterItemId: "model-a",
          status: "failed",
          errorCode: "provider_failed",
          attemptCount: 0,
          createdAt,
        }),
        "integrity_failure",
      );
    },
  );

  it("uses a closed error vocabulary and fixed privacy-safe SQL", () => {
    expect(new Set(PUBLICATION_ORCHESTRATION_LEDGER_ERROR_CODES).size).toBe(
      PUBLICATION_ORCHESTRATION_LEDGER_ERROR_CODES.length,
    );
    for (const code of PUBLICATION_ORCHESTRATION_LEDGER_ERROR_CODES) {
      const error = new PublicationOrchestrationLedgerError(code);
      expect(error.message).toBe(
        "Publication orchestration state could not be persisted safely.",
      );
      expect(error).not.toHaveProperty("cause");
    }
    for (const sql of Object.values(PUBLICATION_ORCHESTRATION_LEDGER_SQL)) {
      expect(sql).not.toMatch(/\b(?:OR\s+(?:IGNORE|REPLACE)|REPLACE|exec)\b/i);
      expect(sql).not.toMatch(
        /visitor|cookie|user[_ -]?agent|authorization[_ -]?header|telemetry|analytics|correlation|ip[_ -]?address/i,
      );
      expect(sql).not.toContain("sensitive-canary");
    }
  });
});
