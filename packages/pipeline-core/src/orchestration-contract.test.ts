import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { type BudgetAmounts } from "./index.js";
import {
  DURABLE_ADMISSION_REJECTION_CODES,
  ORCHESTRATION_POLICY_REGISTRY,
  PROVIDER_TERMINAL_REPORT_CODES,
  buildRejectedFiringReportV2,
  buildTerminalRunReportV2,
  decideFencedProviderStart,
  decideFiringAdmission,
  decideRegisteredProviderRetry,
  decideRunBudgetAdmission,
  decideTerminalRun,
  encodeOrchestrationReportV2,
  policyContentHash,
  publicationPlanProviderScopeHash,
  resolveOrchestrationPolicies,
  terminalDeadlineAt,
  validateAdjacentExplicitReplay,
  verifyAdmittedFiringDecision,
  verifyOrchestrationReportV2,
  verifyRejectedFiringDecision,
  type AdmittedFiringDecision,
  type PlanAdmissionState,
  type PolicyReference,
  type ProviderTerminalReportCode,
  type ProviderTerminalReportInputV2,
} from "./orchestration-contract.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const PLAN_ID = "rpl_00000000-0000-4000-8000-000000000001";
const OCCURRENCE_ID = "occ_00000000-0000-4000-8000-000000000002";
const RUN_ID = "run_00000000-0000-4000-8000-000000000003";
const PRIOR_RUN_ID = "run_00000000-0000-4000-8000-000000000004";
const PROVIDER_A = "prv_00000000-0000-4000-8000-000000000005";
const PROVIDER_B = "prv_00000000-0000-4000-8000-000000000006";
const SLICE_A = "prn_00000000-0000-4000-8000-000000000008";
const SLICE_B = "prn_00000000-0000-4000-8000-000000000009";
const SLICE_OLD = "prn_00000000-0000-4000-8000-00000000000a";
const RETAINED_PUBLICATION_ID = "pub_00000000-0000-4000-8000-00000000000b";
const SCHEDULED_AT = "2026-08-03T05:00:00.000Z";
const DEADLINE_AT = "2026-08-03T17:00:00.000Z";

const budget = (value = 0): BudgetAmounts => ({
  requests: value,
  bytes: value,
  aiTokens: value,
  browserMilliseconds: value,
  elapsedMilliseconds: value,
  costMicrousd: value,
});

const canonicalJsonForTest = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJsonForTest(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonForTest(record[key])}`)
    .join(",")}}`;
};

const policyReferences = (): readonly PolicyReference[] =>
  Object.values(ORCHESTRATION_POLICY_REGISTRY).map(
    ({ role, version, contentHash }) => ({ role, version, contentHash }),
  );

const authorizedProvider = (providerId: string, ordinal: number) => ({
  ordinal,
  providerId,
  adapterVersion: "adapter-v1",
  rosterVersion: "roster-v1",
  rosterContentHash: HASH_A,
  sourceRegisterVersion: "source-v1",
  sourceRegisterArtifactHash: HASH_A,
  requestCeiling: 10,
  byteCeiling: 1_000,
  aiTokenCeiling: 100,
  browserMillisecondCeiling: 1_000,
  elapsedMillisecondCeiling: 10_000,
  costMicrousdCeiling: 1_000,
  retryPolicyHash: ORCHESTRATION_POLICY_REGISTRY.provider_retry.contentHash,
});

const authorizedPlan = (
  providerIds: readonly string[] = [PROVIDER_A],
): PlanAdmissionState => {
  const providers = providerIds.map(authorizedProvider);
  const policies = resolveOrchestrationPolicies(policyReferences());
  return {
    state: "authorized",
    contractVersion: "publication-run-plan@1",
    runPlanId: PLAN_ID,
    planHash: HASH_A,
    environment: "preview",
    scheduleName: "provider-refresh-v1",
    scheduleExpression: "0 5 * * 1,4",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: "2026-09-01T00:00:00.000Z",
    scheduledAt: SCHEDULED_AT,
    canonicalSchemaVersion: "canonical-v1",
    pipelineContractVersion: "pipeline-v1",
    providerScopeHash: publicationPlanProviderScopeHash(providerIds),
    policySetHash: policies.policySetHash,
    providers,
    policies: policyReferences(),
    approval: {
      artifactPath: "docs/compliance/run-plans/plan.json",
      artifactHash: HASH_A,
      approvedAt: "2026-08-01T00:00:00.000Z",
      approverRoles: ["legal_source_owner", "platform_owner", "product_owner"],
    },
  };
};

const admissionInput = () => ({
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
    environment: "preview" as const,
    runPlanId: PLAN_ID,
    runPlanHash: HASH_A,
    canonicalSchemaVersion: "canonical-v1",
    pipelineContractVersion: "pipeline-v1",
  },
  plan: authorizedPlan(),
  budgetState: {
    monthlyUsedCostMicrousd: 0,
    monthlyReservedCostMicrousd: 0,
    expensiveWorkBreakerTripped: false,
  },
  now: "2026-08-03T05:00:01.000Z",
});

const provider = (
  providerId: string,
  override: Partial<ProviderTerminalReportInputV2> = {},
): ProviderTerminalReportInputV2 => ({
  providerId,
  state: "ready",
  rosterComplete: true,
  publicationDisposition: "new",
  sliceId: providerId === PROVIDER_A ? SLICE_A : SLICE_B,
  cost: budget(1),
  errorCodes: [],
  ...override,
});

const reportAdmission = (): AdmittedFiringDecision => {
  const base = admissionInput();
  const decision = decideFiringAdmission({
    ...base,
    plan: authorizedPlan([PROVIDER_A, PROVIDER_B]),
  });
  if (decision.decision !== "admitted")
    throw new Error("test report authority was not admitted");
  return decision;
};

const terminalReportInput = () => {
  return {
    admission: reportAdmission(),
    runAuthority: {
      kind: "attempt_1" as const,
      occurrenceId: OCCURRENCE_ID,
      runId: RUN_ID,
      codeVersion: "git:abc123",
    },
    startedAt: "2026-08-03T05:00:01.000Z",
    endedAt: "2026-08-03T06:00:00.000Z",
    providers: [provider(PROVIDER_A), provider(PROVIDER_B)],
    runWideQuarantine: false,
  };
};

describe("closed executable orchestration policies", () => {
  it("resolves the exact three references and verifies every content hash", () => {
    const resolved = resolveOrchestrationPolicies(policyReferences());
    expect(resolved.references.map(({ role }) => role)).toEqual([
      "provider_retry",
      "run_budget",
      "terminal_deadline",
    ]);
    expect(resolved.policySetHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(policyContentHash(resolved.terminalDeadline)).toBe(
      ORCHESTRATION_POLICY_REGISTRY.terminal_deadline.contentHash,
    );
    expect(
      Object.fromEntries(
        Object.entries(ORCHESTRATION_POLICY_REGISTRY).map(([role, entry]) => [
          role,
          entry.contentHash,
        ]),
      ),
    ).toEqual({
      run_budget:
        "sha256:6a4b4082dd4360f664cb6e570722a2ffdfa4ef81e5db8a367bfa46ebf3bc231d",
      provider_retry:
        "sha256:592579289a2bae9944400183886424689613f231bbeb3d9e5cd81162c4e32bc8",
      terminal_deadline:
        "sha256:ac00e539305233293ab811da938d6e7cc32ece34f723c4e9b295a657480c10b3",
    });
    expect(resolved.policySetHash).toBe(
      "sha256:0398dab5efeaf1456be43dffeb74140d2bbd5020700d5370295c311d37027b7f",
    );
  });

  it("fails closed without reflecting hostile policy content", () => {
    const secret = "authorization:Bearer-do-not-reflect";
    const references = policyReferences().map((reference) =>
      reference.role === "provider_retry"
        ? { ...reference, contentHash: secret }
        : reference,
    );
    let message = "";
    try {
      resolveOrchestrationPolicies(references);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/closed registry/);
    expect(message).not.toContain(secret);
    expect(() => resolveOrchestrationPolicies(references.slice(1))).toThrow(
      /not exact/,
    );
    expect(() =>
      resolveOrchestrationPolicies([...policyReferences()].reverse()),
    ).toThrow(/canonical role order/);
    expect(() =>
      resolveOrchestrationPolicies(
        policyReferences().map((reference, index) =>
          index === 0 ? { ...reference, cookie: "visitor-canary" } : reference,
        ),
      ),
    ).toThrow(/exact closed fields/);
  });

  it("canonicalizes one descriptor-only policy snapshot", () => {
    const registered = ORCHESTRATION_POLICY_REGISTRY.run_budget.policy;
    if (registered.schema !== "run-budget@1")
      throw new Error("run budget policy registry is inconsistent");
    const expected = policyContentHash(registered);
    const nullPrototypeCeilings = { ...registered.maximumRunCeilings };
    Reflect.setPrototypeOf(nullPrototypeCeilings, null);
    const nullPrototypePolicy = {
      ...registered,
      maximumRunCeilings: nullPrototypeCeilings,
    };
    Reflect.setPrototypeOf(nullPrototypePolicy, null);
    expect(policyContentHash(nullPrototypePolicy)).toBe(expected);

    let getterCalls = 0;
    const accessorPolicy = { ...registered };
    Object.defineProperty(accessorPolicy, "schema", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "run-budget@1";
      },
    });
    expect(() =>
      policyContentHash(
        accessorPolicy as Parameters<typeof policyContentHash>[0],
      ),
    ).toThrow(/own enumerable data fields/);
    expect(getterCalls).toBe(0);

    const nonEnumerablePolicy = { ...registered };
    Object.defineProperty(nonEnumerablePolicy, "visitor", {
      enumerable: false,
      value: "visitor-canary",
    });
    expect(() =>
      policyContentHash(
        nonEnumerablePolicy as Parameters<typeof policyContentHash>[0],
      ),
    ).toThrow(/own enumerable data fields/);

    const symbolPolicy = { ...registered };
    Object.defineProperty(symbolPolicy, Symbol("visitor-canary"), {
      enumerable: true,
      value: "visitor-canary",
    });
    expect(() =>
      policyContentHash(
        symbolPolicy as Parameters<typeof policyContentHash>[0],
      ),
    ).toThrow(/own enumerable data fields/);

    let schemaDescriptorReads = 0;
    const statefulPolicy = new Proxy(
      { ...registered },
      {
        getOwnPropertyDescriptor(target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
          if (property !== "schema" || descriptor === undefined)
            return descriptor;
          schemaDescriptorReads += 1;
          return {
            ...descriptor,
            value:
              schemaDescriptorReads === 1 ? "run-budget@1" : "visitor-canary",
          };
        },
      },
    );
    expect(
      policyContentHash(
        statefulPolicy as Parameters<typeof policyContentHash>[0],
      ),
    ).toBe(expected);
    expect(schemaDescriptorReads).toBe(1);

    const reflectionCanary = "authorization:reflection-canary";
    const hostileProxy = new Proxy(
      { ...registered },
      {
        ownKeys() {
          throw new Error(reflectionCanary);
        },
      },
    );
    let reflectedMessage = "";
    try {
      policyContentHash(hostileProxy);
    } catch (error) {
      reflectedMessage = String(error);
    }
    expect(reflectedMessage).toMatch(/own enumerable data fields/);
    expect(reflectedMessage).not.toContain(reflectionCanary);

    const oversizedSparseArray = new Array(100_000_000);
    expect(() =>
      policyContentHash({
        ...registered,
        alertPercents: oversizedSparseArray,
      } as unknown as Parameters<typeof policyContentHash>[0]),
    ).toThrow(/canonical arrays must contain only dense data items/);
  });

  it("anchors the terminal deadline to scheduled time and caps Retry-After", () => {
    const policies = resolveOrchestrationPolicies(policyReferences());
    expect(terminalDeadlineAt(SCHEDULED_AT, policies.terminalDeadline)).toBe(
      DEADLINE_AT,
    );
    expect(
      decideRegisteredProviderRetry({
        policy: policies.providerRetry,
        completedAttempt: 1,
        errorKind: "rate_limited",
        now: "2026-08-03T05:00:01.000Z",
        terminalDeadlineAt: DEADLINE_AT,
        retryAfter: "301",
      }),
    ).toEqual({ action: "failed", reason: "retry_after_exceeds_policy" });
    expect(
      decideRegisteredProviderRetry({
        policy: policies.providerRetry,
        completedAttempt: 1,
        errorKind: "transient",
        now: "2026-08-03T16:59:59.500Z",
        terminalDeadlineAt: DEADLINE_AT,
      }),
    ).toEqual({ action: "failed", reason: "terminal_deadline_elapsed" });
    expect(() =>
      decideRegisteredProviderRetry({
        policy: policies.providerRetry,
        completedAttempt: 1,
        errorKind: "credential_canary" as "transient",
        now: "2026-08-03T05:00:01.000Z",
        terminalDeadlineAt: DEADLINE_AT,
      }),
    ).toThrow(/error kind is invalid/);
    expect(
      decideRegisteredProviderRetry({
        policy: policies.providerRetry,
        completedAttempt: 1,
        errorKind: "permanent",
        now: DEADLINE_AT,
        terminalDeadlineAt: DEADLINE_AT,
      }),
    ).toEqual({ action: "failed", reason: "terminal_deadline_elapsed" });
    expect(
      decideRegisteredProviderRetry({
        policy: policies.providerRetry,
        completedAttempt: 1,
        errorKind: "transient",
        now: "2026-08-03T16:59:59.000Z",
        terminalDeadlineAt: DEADLINE_AT,
      }),
    ).toEqual({ action: "failed", reason: "terminal_deadline_elapsed" });
  });

  it("sums plan ceilings and enforces breaker and monthly reservation", () => {
    const policy = resolveOrchestrationPolicies(policyReferences()).runBudget;
    expect(
      decideRunBudgetAdmission({
        policy,
        providers: [authorizedProvider(PROVIDER_A, 0)],
        state: {
          monthlyUsedCostMicrousd: 12_500_000,
          monthlyReservedCostMicrousd: 0,
          expensiveWorkBreakerTripped: false,
        },
      }),
    ).toMatchObject({ admitted: true, alertPercent: 50 });
    expect(
      decideRunBudgetAdmission({
        policy,
        providers: [authorizedProvider(PROVIDER_A, 0)],
        state: {
          monthlyUsedCostMicrousd: 25_000_000,
          monthlyReservedCostMicrousd: 0,
          expensiveWorkBreakerTripped: false,
        },
      }),
    ).toEqual({ admitted: false, reason: "budget_exceeded" });
    expect(
      decideRunBudgetAdmission({
        policy,
        providers: [authorizedProvider(PROVIDER_A, 0)],
        state: {
          monthlyUsedCostMicrousd: 0,
          monthlyReservedCostMicrousd: 0,
          expensiveWorkBreakerTripped: true,
        },
      }),
    ).toEqual({ admitted: false, reason: "expensive_work_breaker" });
    expect(() =>
      decideRunBudgetAdmission({
        policy,
        providers: Array.from({ length: 17 }, () =>
          authorizedProvider(PROVIDER_A, 0),
        ),
        state: {
          monthlyUsedCostMicrousd: 0,
          monthlyReservedCostMicrousd: 0,
          expensiveWorkBreakerTripped: false,
        },
      }),
    ).toThrow(/outside its supported range/);
    expect(() =>
      decideRunBudgetAdmission({
        policy,
        providers: [
          {
            ...authorizedProvider(PROVIDER_A, 0),
            byteCeiling: Number.MAX_SAFE_INTEGER,
          },
          { ...authorizedProvider(PROVIDER_B, 1), byteCeiling: 1 },
        ],
        state: {
          monthlyUsedCostMicrousd: 0,
          monthlyReservedCostMicrousd: 0,
          expensiveWorkBreakerTripped: false,
        },
      }),
    ).toThrow(/ceiling overflows/);
    expect(
      decideRunBudgetAdmission({
        policy,
        providers: [
          {
            ...authorizedProvider(PROVIDER_A, 0),
            requestCeiling: policy.maximumRunCeilings.requests + 1,
          },
        ],
        state: {
          monthlyUsedCostMicrousd: 0,
          monthlyReservedCostMicrousd: 0,
          expensiveWorkBreakerTripped: false,
        },
      }),
    ).toEqual({ admitted: false, reason: "budget_exceeded" });
  });
});

describe("scheduled admission and explicit replay", () => {
  it("keeps malformed platform-envelope failures outside durable admission", () => {
    expect(DURABLE_ADMISSION_REJECTION_CODES).toEqual([
      "plan_unavailable",
      "plan_invalid",
      "plan_not_effective",
      "plan_revoked",
      "source_authority_invalid",
      "runtime_version_mismatch",
      "plan_context_mismatch",
      "policy_mismatch",
      "budget_exceeded",
      "expensive_work_breaker",
      "terminal_deadline_elapsed",
    ]);
    for (const envelopeCode of [
      "event_not_scheduled",
      "event_payload_not_empty",
      "workflow_name_mismatch",
      "schedule_mismatch",
      "scheduled_time_invalid",
      "scheduled_time_in_future",
    ])
      expect(DURABLE_ADMISSION_REJECTION_CODES).not.toContain(envelopeCode);
  });

  it("mints nominal authority for durable rejection persistence", () => {
    const decision = decideFiringAdmission({
      ...admissionInput(),
      plan: { state: "revoked" },
    });
    expect(decision).toEqual({
      decision: "rejected",
      runAction: "none",
      reason: "plan_revoked",
    });
    expect(verifyRejectedFiringDecision(decision)).toBe(true);
    expect(
      verifyRejectedFiringDecision({
        decision: "rejected",
        runAction: "none",
        reason: "plan_revoked",
      }),
    ).toBe(false);
  });

  it("runtime-validates an admitted persistence authority", () => {
    const admission = reportAdmission();
    expect(verifyAdmittedFiringDecision(admission)).toBe(true);
    expect(
      verifyAdmittedFiringDecision({
        ...admission,
        runPlanHash: `sha256:${"b".repeat(64)}`,
      }),
    ).toBe(true);
    expect(
      verifyAdmittedFiringDecision({
        ...admission,
        projectedMonthlyCostMicrousd: 25_000_001,
      }),
    ).toBe(false);
    expect(
      verifyAdmittedFiringDecision({ ...admission, cookie: "visitor-canary" }),
    ).toBe(false);
  });

  it("admits attempt one with the schedule-anchored deadline", () => {
    expect(decideFiringAdmission(admissionInput())).toMatchObject({
      decision: "admitted",
      runAction: "create_or_reconcile_attempt_1",
      attemptNumber: 1,
      runPlanId: PLAN_ID,
      terminalDeadlineAt: DEADLINE_AT,
    });
    for (const payload of [undefined, null, {}])
      expect(
        decideFiringAdmission({
          ...admissionInput(),
          event: { ...admissionInput().event, payload },
        }),
      ).toMatchObject({ decision: "admitted" });
  });

  it("accepts the full printable Phase B version grammar", () => {
    const canonicalVersion = "canonical version".padEnd(64, " x").slice(0, 64);
    const pipelineVersion = "pipeline contract".padEnd(128, " y").slice(0, 128);
    const plan = authorizedPlan() as Extract<
      PlanAdmissionState,
      { state: "authorized" }
    >;
    expect(
      decideFiringAdmission({
        ...admissionInput(),
        plan: {
          ...plan,
          canonicalSchemaVersion: canonicalVersion,
          pipelineContractVersion: pipelineVersion,
        },
        protectedContext: {
          ...admissionInput().protectedContext,
          canonicalSchemaVersion: canonicalVersion,
          pipelineContractVersion: pipelineVersion,
        },
      }),
    ).toMatchObject({ decision: "admitted" });
  });

  it("rejects missing, hostile-payload, and elapsed firings without a run", () => {
    const symbolPayload = { [Symbol("visitor")]: "visitor-canary" };
    const hiddenPayload = {};
    Object.defineProperty(hiddenPayload, "cookie", {
      value: "visitor-canary",
      enumerable: false,
    });
    for (const input of [
      { ...admissionInput(), plan: { state: "unavailable" as const } },
      {
        ...admissionInput(),
        plan: { state: "corrupt" } as unknown as PlanAdmissionState,
      },
      {
        ...admissionInput(),
        event: { ...admissionInput().event, payload: { ip: "192.0.2.1" } },
      },
      {
        ...admissionInput(),
        event: { ...admissionInput().event, payload: symbolPayload },
      },
      {
        ...admissionInput(),
        event: { ...admissionInput().event, payload: hiddenPayload },
      },
      { ...admissionInput(), now: DEADLINE_AT },
    ]) {
      const decision = decideFiringAdmission(input);
      expect(decision.decision).toBe("rejected");
      expect(decision).toHaveProperty("runAction", "none");
      expect(decision).not.toHaveProperty("runId");
      expect(JSON.stringify(decision)).not.toContain("192.0.2.1");
    }
    expect(
      decideFiringAdmission({
        ...admissionInput(),
        plan: { state: "corrupt" } as unknown as PlanAdmissionState,
      }),
    ).toEqual({
      decision: "rejected",
      runAction: "none",
      reason: "plan_invalid",
    });
  });

  it("rejects mutually consistent unauthorized schedule, occurrence, runtime, and budget", () => {
    const evil = admissionInput();
    expect(
      decideFiringAdmission({
        ...evil,
        event: {
          ...evil.event,
          workflowName: "evil-workflow",
          scheduleExpression: "* * * * *",
        },
        protectedContext: {
          ...evil.protectedContext,
          workflowName: "evil-workflow",
          scheduleName: "evil-schedule",
          scheduleExpression: "* * * * *",
        },
        plan: {
          ...(authorizedPlan() as Extract<
            PlanAdmissionState,
            { state: "authorized" }
          >),
          scheduleName: "evil-schedule",
          scheduleExpression: "* * * * *",
        },
      }),
    ).toMatchObject({ decision: "rejected" });
    expect(
      decideFiringAdmission({
        ...admissionInput(),
        event: {
          ...admissionInput().event,
          scheduledAt: "2026-08-04T05:00:00.000Z",
        },
        now: "2026-08-04T05:00:01.000Z",
      }),
    ).toEqual({
      decision: "rejected",
      runAction: "none",
      reason: "scheduled_time_invalid",
    });
    expect(
      decideFiringAdmission({
        ...admissionInput(),
        protectedContext: {
          ...admissionInput().protectedContext,
          canonicalSchemaVersion: "canonical-v2",
        },
      }),
    ).toMatchObject({ decision: "rejected", reason: "plan_context_mismatch" });
    expect(
      decideFiringAdmission({
        ...admissionInput(),
        budgetState: {
          monthlyUsedCostMicrousd: 25_000_000,
          monthlyReservedCostMicrousd: 0,
          expensiveWorkBreakerTripped: false,
        },
      }),
    ).toMatchObject({ decision: "rejected", reason: "budget_exceeded" });
  });

  it("requires a failed adjacent attempt with the exact same plan", () => {
    const input = {
      authority: "protected_operator",
      occurrenceId: OCCURRENCE_ID,
      requestedAttemptNumber: 2,
      replayOfRunId: RUN_ID,
      runPlanId: PLAN_ID,
      runPlanHash: HASH_A,
      adjacentPrior: {
        occurrenceId: OCCURRENCE_ID,
        runId: RUN_ID,
        attemptNumber: 1,
        terminal: true,
        outcome: "failed" as const,
        runPlanId: PLAN_ID,
        runPlanHash: HASH_A,
      },
    };
    expect(validateAdjacentExplicitReplay(input)).toMatchObject({
      decision: "admit_replay",
      attemptNumber: 2,
      runPlanId: PLAN_ID,
    });
    expect(() =>
      validateAdjacentExplicitReplay({
        ...input,
        adjacentPrior: { ...input.adjacentPrior, outcome: "succeeded" },
      }),
    ).toThrow(/successful/);
    expect(() =>
      validateAdjacentExplicitReplay({
        ...input,
        runPlanHash: `sha256:${"b".repeat(64)}`,
      }),
    ).toThrow(/adjacent prior/);
    expect(() =>
      validateAdjacentExplicitReplay({
        ...input,
        adjacentPrior: {
          ...input.adjacentPrior,
          terminal: "yes" as unknown as true,
        },
      }),
    ).toThrow(/terminal adjacent run/);
    expect(() =>
      validateAdjacentExplicitReplay({
        ...input,
        adjacentPrior: {
          ...input.adjacentPrior,
          outcome: "running" as "failed",
        },
      }),
    ).toThrow(/outcome is invalid/);
  });
});

describe("fenced provider exclusion", () => {
  const base = {
    environment: "preview" as const,
    providerId: PROVIDER_A,
    runId: RUN_ID,
    occurrenceId: OCCURRENCE_ID,
    now: "2026-08-03T05:05:00.000Z",
    terminalDeadlineAt: DEADLINE_AT,
  };
  const activeFence = {
    environment: "preview" as const,
    providerId: PROVIDER_A,
    holderRunId: PRIOR_RUN_ID,
    holderOccurrenceId: "occ_00000000-0000-4000-8000-000000000007",
    generation: 7,
    state: "active" as const,
    deadlineAt: "2026-08-03T06:00:00.000Z",
  };

  it("waits across occurrences and never steals an expired active fence", () => {
    expect(
      decideFencedProviderStart({ ...base, latestFence: activeFence }),
    ).toEqual({
      action: "wait",
      reason: "provider_active_in_other_occurrence",
      fenceGeneration: 7,
    });
    expect(
      decideFencedProviderStart({
        ...base,
        now: "2026-08-03T06:00:00.000Z",
        latestFence: activeFence,
      }),
    ).toEqual({
      action: "reconcile",
      reason: "holder_deadline_elapsed",
      fenceGeneration: 7,
    });
  });

  it("refuses new or resumed work at the requested run deadline", () => {
    expect(decideFencedProviderStart({ ...base, now: DEADLINE_AT })).toEqual({
      action: "reconcile",
      reason: "requested_deadline_elapsed",
    });
    expect(
      decideFencedProviderStart({
        ...base,
        runId: activeFence.holderRunId,
        occurrenceId: activeFence.holderOccurrenceId,
        now: DEADLINE_AT,
        latestFence: activeFence,
      }),
    ).toMatchObject({ action: "reconcile" });
  });

  it("rejects forged fence states and extra fields", () => {
    expect(() =>
      decideFencedProviderStart({
        ...base,
        environment: "staging" as "preview",
      }),
    ).toThrow(/environment is unsupported/);
    expect(() =>
      decideFencedProviderStart({
        ...base,
        latestFence: { ...activeFence, state: "corrupt" as "active" },
      }),
    ).toThrow(/state is invalid/);
    expect(() =>
      decideFencedProviderStart({
        ...base,
        latestFence: {
          ...activeFence,
          cookie: "visitor-canary",
        } as unknown as typeof activeFence,
      }),
    ).toThrow(/exact closed fields/);
    expect(() =>
      decideFencedProviderStart({
        ...base,
        runId: activeFence.holderRunId,
        occurrenceId: activeFence.holderOccurrenceId,
        latestFence: activeFence,
      }),
    ).toThrow(/deadline is inconsistent/);
  });
});

describe("terminal outcome and sealed publication-run-report@2", () => {
  it("keeps run outcome separate from all publication dispositions", () => {
    expect(
      decideTerminalRun({
        providers: [
          {
            providerId: PROVIDER_A,
            state: "ready",
            usableSlice: "new",
            errorCodes: [],
          },
        ],
        runWideQuarantine: false,
        terminalDeadlineElapsed: false,
      }),
    ).toMatchObject({
      runOutcome: "succeeded",
      publicationDisposition: "publish_new",
    });
    expect(
      decideTerminalRun({
        providers: [
          {
            providerId: PROVIDER_A,
            state: "ready",
            usableSlice: "new",
            errorCodes: [],
          },
          {
            providerId: PROVIDER_B,
            state: "failed",
            usableSlice: "none",
            errorCodes: ["provider_failed"],
          },
        ],
        runWideQuarantine: false,
        terminalDeadlineElapsed: false,
      }),
    ).toMatchObject({
      runOutcome: "completed_with_provider_failures",
      publicationDisposition: "publish_new",
    });
    expect(
      decideTerminalRun({
        providers: [
          {
            providerId: PROVIDER_A,
            state: "failed",
            usableSlice: "last_known_good",
            errorCodes: ["provider_failed"],
          },
        ],
        runWideQuarantine: false,
        terminalDeadlineElapsed: false,
      }),
    ).toMatchObject({ publicationDisposition: "retain_current" });
    expect(
      decideTerminalRun({
        providers: [
          {
            providerId: PROVIDER_A,
            state: "failed",
            usableSlice: "none",
            errorCodes: ["provider_failed"],
          },
        ],
        runWideQuarantine: false,
        terminalDeadlineElapsed: false,
      }),
    ).toMatchObject({
      runOutcome: "failed",
      publicationDisposition: "blocked",
    });
    expect(
      decideTerminalRun({
        providers: [
          {
            providerId: PROVIDER_A,
            state: "ready",
            usableSlice: "new",
            errorCodes: [],
          },
        ],
        runWideQuarantine: true,
        terminalDeadlineElapsed: false,
      }),
    ).toMatchObject({
      runOutcome: "quarantined",
      publicationDisposition: "blocked",
    });
  });

  it.each([
    "partial_provider_refresh",
    "last_known_good_only",
    "zero_usable_providers",
    "run_wide_quarantine",
  ] as const)(
    "rejects the run-derived %s code at every Provider boundary",
    (runDerivedCode) => {
      const hostileCodes = [
        "provider_failed",
        runDerivedCode,
      ] as unknown as readonly ProviderTerminalReportCode[];
      expect(() =>
        decideTerminalRun({
          providers: [
            {
              providerId: PROVIDER_A,
              state: "failed",
              usableSlice: "none",
              errorCodes: hostileCodes,
            },
          ],
          runWideQuarantine: false,
          terminalDeadlineElapsed: false,
        }),
      ).toThrow(/non-Provider terminal code/);
      expect(() =>
        buildTerminalRunReportV2({
          ...terminalReportInput(),
          providers: [
            {
              providerId: PROVIDER_A,
              state: "failed",
              rosterComplete: true,
              publicationDisposition: "unavailable",
              cost: budget(1),
              errorCodes: hostileCodes,
            },
            provider(PROVIDER_B),
          ],
        }),
      ).toThrow(/non-Provider terminal code/);
    },
  );

  it("binds the quarantine code to quarantined Provider state", () => {
    const contradictoryCodes = [
      "provider_failed",
      "provider_quarantined",
      "provider_unavailable",
    ] as const;
    expect(() =>
      decideTerminalRun({
        providers: [
          {
            providerId: PROVIDER_A,
            state: "failed",
            usableSlice: "none",
            errorCodes: contradictoryCodes,
          },
        ],
        runWideQuarantine: false,
        terminalDeadlineElapsed: false,
      }),
    ).toThrow(/cannot carry the quarantine terminal code/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        providers: [
          {
            providerId: PROVIDER_A,
            state: "failed",
            rosterComplete: true,
            publicationDisposition: "unavailable",
            cost: budget(1),
            errorCodes: contradictoryCodes,
          },
          provider(PROVIDER_B),
        ],
      }),
    ).toThrow(/cannot carry the quarantine terminal code/);

    expect(
      decideTerminalRun({
        providers: [
          {
            providerId: PROVIDER_A,
            state: "quarantined",
            usableSlice: "none",
            errorCodes: contradictoryCodes,
          },
        ],
        runWideQuarantine: false,
        terminalDeadlineElapsed: false,
      }),
    ).toMatchObject({
      runOutcome: "failed",
      reasonCodes: ["zero_usable_providers"],
    });
    const mixedRosterReport = buildTerminalRunReportV2({
      ...terminalReportInput(),
      providers: [
        {
          providerId: PROVIDER_A,
          state: "quarantined",
          rosterComplete: true,
          publicationDisposition: "unavailable",
          cost: budget(1),
          errorCodes: contradictoryCodes,
        },
        provider(PROVIDER_B),
      ],
    });
    expect(mixedRosterReport.providers[0]?.errorCodes).toEqual([
      "provider_failed",
      "provider_quarantined",
      "provider_unavailable",
    ]);
    expect(mixedRosterReport.errorCodes).toContain("partial_provider_refresh");
    expect(mixedRosterReport.errorCodes).toContain("provider_failed");
    expect(mixedRosterReport.errorCodes).toContain("provider_quarantined");
  });

  it("builds a deterministic, complete, privacy-closed terminal report", () => {
    const hostile = {
      ...terminalReportInput(),
      providers: terminalReportInput().providers.map((entry) => ({
        ...entry,
        adapterVersion: "authorization-secret-canary",
        rawError: "authorization-secret-canary",
      })),
    };
    const first = buildTerminalRunReportV2(hostile);
    const second = buildTerminalRunReportV2(terminalReportInput());
    expect(first.reportSchemaVersion).toBe("publication-run-report@2");
    expect(first.seal).toEqual(second.seal);
    expect(first.cost).toEqual(budget(2));
    expect(
      verifyOrchestrationReportV2(
        first,
        hostile.admission,
        hostile.runAuthority,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(first).toLowerCase();
    for (const canary of [
      "visitor-cookie-canary",
      "authorization-secret-canary",
      "cookie",
      "rawerror",
      "ipaddress",
      "querystring",
      "useragent",
    ])
      expect(serialized).not.toContain(canary);
    const withVisitorField = {
      ...terminalReportInput(),
      cookie: "visitor-cookie-canary",
    };
    expect(() =>
      buildTerminalRunReportV2(
        withVisitorField as Parameters<typeof buildTerminalRunReportV2>[0],
      ),
    ).toThrow(/exact closed fields/);
  });

  it("blocks publication at the terminal deadline", () => {
    const report = buildTerminalRunReportV2({
      ...terminalReportInput(),
      endedAt: DEADLINE_AT,
    });
    expect(report).toMatchObject({
      runOutcome: "failed",
      publicationDisposition: "blocked",
      errorCodes: ["terminal_deadline_elapsed"],
    });
  });

  it("requires exact sorted scope and enforces admitted cost ceilings", () => {
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        admission: {
          ...terminalReportInput().admission,
          providerScope: [PROVIDER_B, PROVIDER_A],
        },
      }),
    ).toThrow(/budget authority is inconsistent/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        providers: [
          provider(PROVIDER_A, {
            cost: { ...budget(), bytes: Number.MAX_SAFE_INTEGER },
          }),
          provider(PROVIDER_B, { cost: { ...budget(), bytes: 1 } }),
        ],
      }),
    ).toThrow(/exceeds admitted ceiling/);
    const looseAttempt = { ...terminalReportInput(), attemptNumber: 2 };
    expect(() =>
      buildTerminalRunReportV2(
        looseAttempt as Parameters<typeof buildTerminalRunReportV2>[0],
      ),
    ).toThrow(/exact closed fields/);
    const looseReplay = {
      ...terminalReportInput(),
      replayOfRunId: PRIOR_RUN_ID,
    };
    expect(() =>
      buildTerminalRunReportV2(
        looseReplay as Parameters<typeof buildTerminalRunReportV2>[0],
      ),
    ).toThrow(/exact closed fields/);
  });

  it("derives replay metadata only from an adjacent replay decision", () => {
    const admission = reportAdmission();
    const replay = validateAdjacentExplicitReplay({
      authority: "protected_operator",
      occurrenceId: OCCURRENCE_ID,
      requestedAttemptNumber: 2,
      replayOfRunId: RUN_ID,
      runPlanId: admission.runPlanId,
      runPlanHash: admission.runPlanHash,
      adjacentPrior: {
        occurrenceId: OCCURRENCE_ID,
        runId: RUN_ID,
        attemptNumber: 1,
        terminal: true,
        outcome: "failed",
        runPlanId: admission.runPlanId,
        runPlanHash: admission.runPlanHash,
      },
    });
    expect(
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        admission,
        runAuthority: {
          kind: "explicit_replay",
          runId: PRIOR_RUN_ID,
          codeVersion: "git:abc123",
          replay,
        },
      }),
    ).toMatchObject({ attemptNumber: 2, replayOfRunId: RUN_ID });
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        admission,
        runAuthority: {
          kind: "explicit_replay",
          runId: PRIOR_RUN_ID,
          codeVersion: "git:abc123",
          replay: {
            ...replay,
            runPlanHash: `sha256:${"b".repeat(64)}`,
          },
        },
      }),
    ).toThrow(/replay authority is inconsistent/);
  });

  it("aggregates closed Provider errors and requires failure evidence", () => {
    const report = buildTerminalRunReportV2({
      ...terminalReportInput(),
      retainedPublication: {
        authoritySchema: "retained-publication-head@1",
        environment: "preview",
        publicationId: RETAINED_PUBLICATION_ID,
        closureHash: HASH_A,
      },
      providers: [
        provider(PROVIDER_A),
        provider(PROVIDER_B, {
          state: "failed",
          publicationDisposition: "carried_forward",
          sliceId: SLICE_OLD,
          errorCodes: ["provider_failed"],
        }),
      ],
    });
    expect(report.errorCodes).toEqual([
      "partial_provider_refresh",
      "provider_failed",
    ]);
    expect(report.retainedPublication).toEqual({
      authoritySchema: "retained-publication-head@1",
      environment: "preview",
      publicationId: RETAINED_PUBLICATION_ID,
      closureHash: HASH_A,
    });
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        retainedPublication: {
          authoritySchema: "retained-publication-head@1",
          environment: "production",
          publicationId: RETAINED_PUBLICATION_ID,
          closureHash: HASH_A,
        },
        providers: [
          provider(PROVIDER_A),
          provider(PROVIDER_B, {
            state: "failed",
            publicationDisposition: "carried_forward",
            sliceId: SLICE_OLD,
            errorCodes: ["provider_failed"],
          }),
        ],
      }),
    ).toThrow(/run environment/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        retainedPublication: {
          authoritySchema: "retained-publication-head@1",
          environment: "preview",
          publicationId: RETAINED_PUBLICATION_ID,
          closureHash: HASH_A,
        },
        providers: [
          provider(PROVIDER_A),
          provider(PROVIDER_B, {
            state: "failed",
            publicationDisposition: "carried_forward",
            sliceId: "pvr_00000000-0000-4000-8000-00000000000a",
            errorCodes: ["provider_failed"],
          }),
        ],
      }),
    ).toThrow(/provider slice ID/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        providers: [
          provider(PROVIDER_A),
          provider(PROVIDER_B, {
            state: "failed",
            publicationDisposition: "carried_forward",
            errorCodes: [],
          }),
        ],
      }),
    ).toThrow(/requires an error code/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        providers: [
          provider(PROVIDER_A),
          provider(PROVIDER_B, {
            state: "failed",
            publicationDisposition: "carried_forward",
            sliceId: SLICE_OLD,
            errorCodes: ["provider_failed"],
          }),
        ],
      }),
    ).toThrow(/retained publication authority/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        providers: [
          provider(PROVIDER_A),
          provider(PROVIDER_B, {
            state: "corrupt" as "failed",
            publicationDisposition: "corrupt" as "unavailable",
          }),
        ],
      }),
    ).toThrow(/state is invalid/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        providers: [
          provider(PROVIDER_A, {
            rosterComplete: "yes" as unknown as true,
          }),
          provider(PROVIDER_B),
        ],
      }),
    ).toThrow(/requires roster closure/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        providers: [
          provider(PROVIDER_A, {
            errorCodes: [
              "run_wide_quarantine",
            ] as unknown as readonly ProviderTerminalReportCode[],
          }),
          provider(PROVIDER_B),
        ],
      }),
    ).toThrow(/non-Provider terminal code/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        runAuthority: {
          ...terminalReportInput().runAuthority,
          codeVersion: "authorization:credential-canary",
        },
      }),
    ).toThrow(/canonical Git revision/);
    expect(() =>
      buildTerminalRunReportV2({
        ...terminalReportInput(),
        providers: [
          provider(PROVIDER_A, { sliceId: "credential-canary" }),
          provider(PROVIDER_B),
        ],
      }),
    ).toThrow(/canonical identifier/);
  });

  it("seals rejected firings with occurrence and protected plan but no run", () => {
    const report = buildRejectedFiringReportV2({
      scheduleName: "provider-refresh-v1",
      scheduleExpression: "0 5 * * 1,4",
      occurrenceId: OCCURRENCE_ID,
      scheduledAt: SCHEDULED_AT,
      observedAt: "2026-08-03T05:00:01.000Z",
      rejectionCode: "plan_revoked",
      requestedPlan: {
        runPlanId: PLAN_ID,
        runPlanHash: HASH_A,
        environment: "preview",
      },
    });
    expect(report).not.toHaveProperty("runId");
    expect(report.requestedPlan.runPlanId).toBe(PLAN_ID);
    expect(verifyOrchestrationReportV2(report)).toBe(true);
    expect(
      verifyOrchestrationReportV2({
        ...report,
        rejectionCode: "plan_invalid",
      }),
    ).toBe(false);
  });

  it("encodes one deterministic persistence representation after authority verification", () => {
    const input = terminalReportInput();
    const report = buildTerminalRunReportV2(input);
    const { seal, ...body } = report;
    const reordered = { seal, ...body };
    const encoded = encodeOrchestrationReportV2(
      report,
      input.admission,
      input.runAuthority,
    );
    expect(
      encodeOrchestrationReportV2(
        reordered,
        input.admission,
        input.runAuthority,
      ),
    ).toBe(encoded);
    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThanOrEqual(
      16_384,
    );
    expect(encoded).toContain(
      '"reportSchemaVersion":"publication-run-report@2"',
    );
    expect(() => encodeOrchestrationReportV2(report)).toThrow(
      /immutable authority/,
    );

    const providerScopeWithCanary = [...report.providerScope];
    Object.defineProperty(providerScopeWithCanary, "cookie", {
      value: "visitor-canary",
      enumerable: true,
    });
    expect(() =>
      encodeOrchestrationReportV2(
        { ...report, providerScope: providerScopeWithCanary },
        input.admission,
        input.runAuthority,
      ),
    ).toThrow(/immutable authority/);

    const rejected = buildRejectedFiringReportV2({
      scheduleName: "provider-refresh-v1",
      scheduleExpression: "0 5 * * 1,4",
      occurrenceId: OCCURRENCE_ID,
      scheduledAt: SCHEDULED_AT,
      observedAt: "2026-08-03T05:00:01.000Z",
      rejectionCode: "plan_revoked",
      requestedPlan: {
        runPlanId: PLAN_ID,
        runPlanHash: HASH_A,
        environment: "preview",
      },
    });
    expect(encodeOrchestrationReportV2(rejected)).toContain(
      '"kind":"rejected_firing"',
    );
  });

  it("rejects hidden report fields and encodes one immutable proxy snapshot", () => {
    const input = terminalReportInput();
    const report = buildTerminalRunReportV2(input);
    const expected = encodeOrchestrationReportV2(
      report,
      input.admission,
      input.runAuthority,
    );

    let getterCalls = 0;
    const accessorReport = { ...report };
    Object.defineProperty(accessorReport, "kind", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "terminal_run";
      },
    });
    expect(() =>
      encodeOrchestrationReportV2(
        accessorReport,
        input.admission,
        input.runAuthority,
      ),
    ).toThrow(/immutable authority/);
    expect(getterCalls).toBe(0);

    const nonEnumerableReport = { ...report };
    Object.defineProperty(nonEnumerableReport, "visitor", {
      enumerable: false,
      value: "visitor-canary",
    });
    expect(() =>
      encodeOrchestrationReportV2(
        nonEnumerableReport,
        input.admission,
        input.runAuthority,
      ),
    ).toThrow(/immutable authority/);

    const symbolReport = { ...report };
    Object.defineProperty(symbolReport, Symbol("visitor-canary"), {
      enumerable: true,
      value: "visitor-canary",
    });
    expect(() =>
      encodeOrchestrationReportV2(
        symbolReport,
        input.admission,
        input.runAuthority,
      ),
    ).toThrow(/immutable authority/);

    let kindDescriptorReads = 0;
    let propertyReads = 0;
    const statefulReport = new Proxy(report, {
      get() {
        propertyReads += 1;
        return "visitor-canary";
      },
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === "kind") kindDescriptorReads += 1;
        return descriptor;
      },
    });
    expect(
      encodeOrchestrationReportV2(
        statefulReport,
        input.admission,
        input.runAuthority,
      ),
    ).toBe(expected);
    expect(kindDescriptorReads).toBe(1);
    expect(propertyReads).toBe(0);

    const reflectionCanary = "authorization:reflection-canary";
    const hostileProxy = new Proxy(report, {
      ownKeys() {
        throw new Error(reflectionCanary);
      },
    });
    let reflectedMessage = "";
    try {
      encodeOrchestrationReportV2(
        hostileProxy,
        input.admission,
        input.runAuthority,
      );
    } catch (error) {
      reflectedMessage = String(error);
    }
    expect(reflectedMessage).toMatch(/immutable authority/);
    expect(reflectedMessage).not.toContain(reflectionCanary);
  });

  it("enforces the byte ceiling against the final sealed report", () => {
    const providerIds = Array.from(
      { length: 16 },
      (_, index) =>
        `prv_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    let largestEncoding = "";
    let largestReport: ReturnType<typeof buildTerminalRunReportV2> | undefined;
    let firstRejectedWidth: number | undefined;
    for (let width = 1; width <= 128; width += 1) {
      const base = admissionInput();
      const plan = authorizedPlan(providerIds);
      if (plan.state !== "authorized")
        throw new Error("boundary plan was not authorized");
      const canonicalSchemaVersion = "c".repeat(64);
      const pipelineContractVersion = "p".repeat(128);
      const decision = decideFiringAdmission({
        ...base,
        protectedContext: {
          ...base.protectedContext,
          canonicalSchemaVersion,
          pipelineContractVersion,
        },
        plan: {
          ...plan,
          canonicalSchemaVersion,
          pipelineContractVersion,
          providers: plan.providers.map((entry) => ({
            ...entry,
            adapterVersion: "a".repeat(width),
            rosterVersion: "r".repeat(width),
            sourceRegisterVersion: "s".repeat(width),
            requestCeiling: 625,
            byteCeiling: 46_875_000,
            aiTokenCeiling: 62_500,
            browserMillisecondCeiling: 450_000,
            elapsedMillisecondCeiling: 10_800_000,
            costMicrousdCeiling: 1_562_500,
          })),
        },
      });
      if (decision.decision !== "admitted")
        throw new Error("boundary report authority was not admitted");
      try {
        const report = buildTerminalRunReportV2({
          admission: decision,
          runAuthority: {
            kind: "attempt_1",
            occurrenceId: OCCURRENCE_ID,
            runId: RUN_ID,
            codeVersion: `git:${"a".repeat(64)}`,
          },
          startedAt: "2026-08-03T05:00:01.000Z",
          endedAt: "2026-08-03T06:00:00.000Z",
          retainedPublication: {
            authoritySchema: "retained-publication-head@1",
            environment: "preview",
            publicationId: RETAINED_PUBLICATION_ID,
            closureHash: HASH_A,
          },
          providers: providerIds.map((providerId) =>
            provider(providerId, {
              state: "quarantined",
              publicationDisposition: "carried_forward",
              sliceId: SLICE_OLD,
              cost: {
                requests: 625,
                bytes: 46_875_000,
                aiTokens: 62_500,
                browserMilliseconds: 450_000,
                elapsedMilliseconds: 10_800_000,
                costMicrousd: 1_562_500,
              },
              errorCodes: PROVIDER_TERMINAL_REPORT_CODES,
            }),
          ),
          runWideQuarantine: false,
        });
        largestEncoding = encodeOrchestrationReportV2(report, decision, {
          kind: "attempt_1",
          occurrenceId: OCCURRENCE_ID,
          runId: RUN_ID,
          codeVersion: `git:${"a".repeat(64)}`,
        });
        largestReport = report;
      } catch (error) {
        expect(String(error)).toMatch(/bounded representation/);
        firstRejectedWidth = width;
        break;
      }
    }
    expect(
      new TextEncoder().encode(largestEncoding).byteLength,
    ).toBeLessThanOrEqual(16_384);
    expect(firstRejectedWidth).toBeDefined();
    if (largestReport === undefined || firstRejectedWidth === undefined)
      throw new Error("boundary report transition was not established");
    const { seal, ...largestBody } = largestReport;
    expect(seal.algorithm).toBe("sha256");
    const rejectedBody = {
      ...largestBody,
      providers: largestBody.providers.map((entry) => ({
        ...entry,
        adapterVersion: "a".repeat(firstRejectedWidth),
        rosterVersion: "r".repeat(firstRejectedWidth),
        sourceRegisterVersion: "s".repeat(firstRejectedWidth),
      })),
    };
    const rejectedHashInput = canonicalJsonForTest({
      domain: "quantclarity:publication-run-report@2",
      body: rejectedBody,
    });
    const rejectedFinalEncoding = canonicalJsonForTest({
      ...rejectedBody,
      seal: {
        algorithm: "sha256",
        contentHash: `sha256:${createHash("sha256").update(rejectedHashInput).digest("hex")}`,
      },
    });
    expect(
      new TextEncoder().encode(rejectedHashInput).byteLength,
    ).toBeLessThanOrEqual(16_384);
    expect(
      new TextEncoder().encode(rejectedFinalEncoding).byteLength,
    ).toBeGreaterThan(16_384);
  });

  it("rejects a correctly re-sealed report with an extra visitor field", () => {
    const input = terminalReportInput();
    const report = buildTerminalRunReportV2(input);
    expect(verifyOrchestrationReportV2(report)).toBe(false);
    expect(verifyOrchestrationReportV2(report, input.admission)).toBe(false);
    expect(
      verifyOrchestrationReportV2(report, input.admission, input.runAuthority),
    ).toBe(true);
    const { seal, ...body } = report;
    expect(seal.algorithm).toBe("sha256");
    const hostileBody = { ...body, cookie: "visitor-cookie-canary" };
    const hashInput = canonicalJsonForTest({
      domain: "quantclarity:publication-run-report@2",
      body: hostileBody,
    });
    const hostile = {
      ...hostileBody,
      seal: {
        algorithm: "sha256" as const,
        contentHash: `sha256:${createHash("sha256").update(hashInput).digest("hex")}`,
      },
    };
    expect(
      verifyOrchestrationReportV2(
        hostile as unknown as ReturnType<typeof buildTerminalRunReportV2>,
        input.admission,
        input.runAuthority,
      ),
    ).toBe(false);

    const wrongCodeBody = { ...body, codeVersion: "git:def456" };
    const wrongCodeHashInput = canonicalJsonForTest({
      domain: "quantclarity:publication-run-report@2",
      body: wrongCodeBody,
    });
    expect(
      verifyOrchestrationReportV2(
        {
          ...wrongCodeBody,
          seal: {
            algorithm: "sha256",
            contentHash: `sha256:${createHash("sha256").update(wrongCodeHashInput).digest("hex")}`,
          },
        },
        input.admission,
        input.runAuthority,
      ),
    ).toBe(false);

    const forgedReplayBody = {
      ...body,
      attemptNumber: 2,
      replayOfRunId: PRIOR_RUN_ID,
    };
    const forgedReplayHashInput = canonicalJsonForTest({
      domain: "quantclarity:publication-run-report@2",
      body: forgedReplayBody,
    });
    expect(
      verifyOrchestrationReportV2(
        {
          ...forgedReplayBody,
          seal: {
            algorithm: "sha256",
            contentHash: `sha256:${createHash("sha256").update(forgedReplayHashInput).digest("hex")}`,
          },
        },
        input.admission,
        input.runAuthority,
      ),
    ).toBe(false);

    const overCeilingBody = {
      ...body,
      cost: { ...body.cost, requests: 12 },
      providers: body.providers.map((provider, index) =>
        index === 0
          ? { ...provider, cost: { ...provider.cost, requests: 11 } }
          : provider,
      ),
    };
    const overCeilingHashInput = canonicalJsonForTest({
      domain: "quantclarity:publication-run-report@2",
      body: overCeilingBody,
    });
    expect(
      verifyOrchestrationReportV2(
        {
          ...overCeilingBody,
          seal: {
            algorithm: "sha256",
            contentHash: `sha256:${createHash("sha256").update(overCeilingHashInput).digest("hex")}`,
          },
        },
        input.admission,
        input.runAuthority,
      ),
    ).toBe(false);

    const credentialBody = {
      ...body,
      providers: body.providers.map((provider, index) =>
        index === 0
          ? { ...provider, adapterVersion: "authorization:credential-canary" }
          : provider,
      ),
    };
    const credentialHashInput = canonicalJsonForTest({
      domain: "quantclarity:publication-run-report@2",
      body: credentialBody,
    });
    expect(
      verifyOrchestrationReportV2(
        {
          ...credentialBody,
          seal: {
            algorithm: "sha256",
            contentHash: `sha256:${createHash("sha256").update(credentialHashInput).digest("hex")}`,
          },
        },
        input.admission,
        input.runAuthority,
      ),
    ).toBe(false);

    const contradictoryBody = {
      ...body,
      errorCodes: ["run_wide_quarantine"],
    };
    const contradictoryHashInput = canonicalJsonForTest({
      domain: "quantclarity:publication-run-report@2",
      body: contradictoryBody,
    });
    expect(
      verifyOrchestrationReportV2(
        {
          ...contradictoryBody,
          seal: {
            algorithm: "sha256",
            contentHash: `sha256:${createHash("sha256").update(contradictoryHashInput).digest("hex")}`,
          },
        },
        input.admission,
        input.runAuthority,
      ),
    ).toBe(false);
  });
});
