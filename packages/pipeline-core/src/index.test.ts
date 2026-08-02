import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BUDGET_FIELDS,
  VALIDATION_CHECKS,
  admitBudget,
  admitCanonicalWrite,
  applyProviderEvent,
  buildRunReport,
  coordinateRun,
  createPipelineRun,
  createProviderSlice,
  createScheduleOccurrence,
  decideCandidate,
  decideProviderStart,
  decideRetry,
  describeSchedule,
  deterministicKey,
  evaluateRosterCoverage,
  recordSideEffectReceipt,
  scheduleExpression,
  shouldExecuteSideEffect,
  sideEffectKey,
  type BudgetAmounts,
  type PipelineRun,
  type ProviderCompletion,
  type ProviderSliceSnapshot,
  type ScheduleOccurrence,
  type ValidationResults,
} from "./index.js";

const schedule = {
  name: "provider-refresh",
  utcWeekdays: [1, 4],
  utcHour: 5,
  utcMinute: 0,
} as const;

const writer = { kind: "pipeline", identityId: "pipeline-local-test" } as const;
const newHash = `sha256:${"a".repeat(64)}`;
const malformedHash = "sha256:malformed";

const budget = (value = 0): BudgetAmounts => ({
  requests: value,
  bytes: value,
  aiTokens: value,
  browserMilliseconds: value,
  elapsedMilliseconds: value,
  costMicrousd: value,
});

const validChecks = (
  override: Partial<ValidationResults> = {},
): ValidationResults =>
  Object.fromEntries(
    VALIDATION_CHECKS.map((check) => [check, override[check] ?? true]),
  ) as unknown as ValidationResults;

const occurrence = (): ScheduleOccurrence =>
  createScheduleOccurrence({
    config: schedule,
    scheduledAt: "2026-08-03T05:00:00.000Z",
    createdAt: "2026-08-03T05:00:01.000Z",
  });

const run = (): PipelineRun =>
  createPipelineRun({
    writer,
    occurrence: occurrence(),
    attemptNumber: 1,
    codeVersion: "git:abc123",
    schemaVersion: "1.0.0",
    providerScope: ["prv_b", "prv_a"],
    startedAt: "2026-08-03T05:00:02.000Z",
  });

const slice = (): ProviderSliceSnapshot =>
  createProviderSlice({
    run: run(),
    occurrence: occurrence(),
    providerId: "prv_a",
  });

const expectedRosterItemIds = ["model-a"] as const;
const completeRosterOutcomes = [
  { rosterItemId: "model-a", status: "published", evidenceId: "ev_1" },
] as const;

describe("schedule and immutable identities (PIPE-001–PIPE-004)", () => {
  it("documents the approved configurable Monday/Thursday UTC schedule", () => {
    expect(scheduleExpression(schedule)).toBe("0 5 * * 1,4");
    expect(describeSchedule(schedule)).toBe("Monday and Thursday at 05:00 UTC");
  });

  it("derives occurrence identity only from schedule name and scheduled UTC time", () => {
    const first = occurrence();
    const laterDeployment = createScheduleOccurrence({
      config: schedule,
      scheduledAt: "2026-08-03T05:00:00Z",
      createdAt: "2026-08-03T08:00:00Z",
    });
    expect(laterDeployment.occurrenceKey).toBe(first.occurrenceKey);
    expect(laterDeployment.occurrenceId).toBe(first.occurrenceId);
    expect(first.occurrenceId).toMatch(
      /^occ_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const expectedBytes = Uint8Array.from(
      createHash("sha256")
        .update(first.occurrenceKey, "utf8")
        .digest()
        .subarray(0, 16),
    );
    expectedBytes[6] = ((expectedBytes[6] ?? 0) & 0x0f) | 0x40;
    expectedBytes[8] = ((expectedBytes[8] ?? 0) & 0x3f) | 0x80;
    const expectedHex = Buffer.from(expectedBytes).toString("hex");
    expect(first.occurrenceId).toBe(
      `occ_${expectedHex.slice(0, 8)}-${expectedHex.slice(8, 12)}-${expectedHex.slice(12, 16)}-${expectedHex.slice(16, 20)}-${expectedHex.slice(20)}`,
    );
    expect(first.occurrenceKey).not.toContain("abc123");
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("rejects local-time drift, duplicate weekdays, and duplicate provider scope", () => {
    expect(() =>
      createScheduleOccurrence({
        config: schedule,
        scheduledAt: "2026-08-03T05:00:01Z",
        createdAt: "2026-08-03T05:00:01Z",
      }),
    ).toThrow(/does not match/);
    expect(() =>
      scheduleExpression({ ...schedule, utcWeekdays: [1, 1] }),
    ).toThrow(/duplicate/);
    expect(() =>
      createPipelineRun({
        writer,
        occurrence: occurrence(),
        attemptNumber: 1,
        codeVersion: "v1",
        schemaVersion: "v1",
        providerScope: ["prv_a", "prv_a"],
        startedAt: "2026-08-03T05:00:02Z",
      }),
    ).toThrow(/duplicate/);
  });

  it("requires explicit audit linkage for intentional replays", () => {
    expect(() =>
      createPipelineRun({
        writer,
        occurrence: occurrence(),
        attemptNumber: 2,
        codeVersion: "v2",
        schemaVersion: "v1",
        providerScope: ["prv_a"],
        startedAt: "2026-08-03T06:00:00Z",
      }),
    ).toThrow(/link/);
    expect(
      createPipelineRun({
        writer,
        occurrence: occurrence(),
        attemptNumber: 2,
        replayOfRunId: run().runId,
        codeVersion: "v2",
        schemaVersion: "v1",
        providerScope: ["prv_a"],
        startedAt: "2026-08-03T06:00:00Z",
      }).runKey,
    ).not.toBe(run().runKey);
  });

  it("rejects cross-occurrence, non-adjacent, and pre-schedule replay metadata", () => {
    const thursday = createScheduleOccurrence({
      config: schedule,
      scheduledAt: "2026-08-06T05:00:00Z",
      createdAt: "2026-08-06T05:00:01Z",
    });
    expect(() =>
      createPipelineRun({
        writer,
        occurrence: thursday,
        attemptNumber: 2,
        replayOfRunId: run().runId,
        codeVersion: "v2",
        schemaVersion: "v1",
        providerScope: ["prv_a"],
        startedAt: "2026-08-06T06:00:00Z",
      }),
    ).toThrow(/adjacent prior attempt/);
    expect(() =>
      createPipelineRun({
        writer,
        occurrence: occurrence(),
        attemptNumber: 3,
        replayOfRunId: run().runId,
        codeVersion: "v3",
        schemaVersion: "v1",
        providerScope: ["prv_a"],
        startedAt: "2026-08-03T07:00:00Z",
      }),
    ).toThrow(/adjacent prior attempt/);
    expect(() =>
      createPipelineRun({
        writer,
        occurrence: occurrence(),
        attemptNumber: 1,
        codeVersion: "v1",
        schemaVersion: "v1",
        providerScope: ["prv_a"],
        startedAt: "2026-08-03T04:59:59Z",
      }),
    ).toThrow(/precedes/);
  });

  it("uses an unambiguous length-prefixed idempotency tuple", () => {
    expect(deterministicKey("x", ["ab", "c"])).not.toBe(
      deterministicKey("x", ["a", "bc"]),
    );
  });

  it("derives canonical v4-shaped run and provider-attempt IDs from stable keys", () => {
    const pipelineRun = run();
    const providerSlice = slice();
    expect(pipelineRun.runId).toMatch(
      /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(providerSlice.providerSliceId).toMatch(
      /^pvr_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(run().runId).toBe(pipelineRun.runId);
    expect(slice().providerSliceId).toBe(providerSlice.providerSliceId);
  });
});

describe("restart-safe provider reducer (PIPE-004–PIPE-006, BE-004)", () => {
  it("applies monotone events once and rejects terminal regression", () => {
    const event = {
      eventId: "evt_budget",
      nextState: "budget_admitted" as const,
      recordedAt: "2026-08-03T05:00:03Z",
    };
    const admitted = applyProviderEvent(slice(), event);
    expect(applyProviderEvent(admitted, event)).toBe(admitted);
    const failed = applyProviderEvent(admitted, {
      eventId: "evt_failed",
      nextState: "failed",
      recordedAt: "2026-08-03T05:00:04Z",
      code: "acquisition_failed",
    });
    expect(() =>
      applyProviderEvent(failed, {
        eventId: "evt_regress",
        nextState: "acquiring",
        recordedAt: "2026-08-03T05:00:05Z",
      }),
    ).toThrow(/invalid provider transition/);
  });

  it("resumes the same nonterminal occurrence/provider and no-ops after terminal", () => {
    const initial = slice();
    const providerSliceId = initial.providerSliceId;
    expect(decideProviderStart(initial, [])).toEqual({
      action: "start",
    });
    expect(decideProviderStart(initial, [initial])).toEqual({
      action: "resume",
      providerSliceId,
    });
    const terminal = applyProviderEvent(initial, {
      eventId: "evt_failed",
      nextState: "failed",
      recordedAt: "2026-08-03T05:00:04Z",
      code: "acquisition_failed",
    });
    expect(decideProviderStart(initial, [terminal])).toEqual({
      action: "noop_terminal",
      providerSliceId,
    });
  });

  it("starts an explicitly linked replay while deduplicating the same attempt", () => {
    const first = slice();
    const failed = applyProviderEvent(first, {
      eventId: "evt_first_failed",
      nextState: "failed",
      recordedAt: "2026-08-03T05:00:04Z",
      code: "acquisition_failed",
    });
    const replayRun = createPipelineRun({
      writer,
      occurrence: occurrence(),
      attemptNumber: 2,
      replayOfRunId: run().runId,
      codeVersion: "git:def456",
      schemaVersion: "1.0.0",
      providerScope: ["prv_a"],
      startedAt: "2026-08-03T06:00:00Z",
    });
    const replay = createProviderSlice({
      run: replayRun,
      occurrence: occurrence(),
      providerId: "prv_a",
    });
    expect(replay.providerSliceKey).not.toBe(first.providerSliceKey);
    expect(decideProviderStart(replay, [first])).toEqual({
      action: "resume",
      providerSliceId: first.providerSliceId,
    });
    expect(decideProviderStart(replay, [failed])).toEqual({
      action: "start",
    });
    expect(decideProviderStart(replay, [failed, replay])).toEqual({
      action: "resume",
      providerSliceId: replay.providerSliceId,
    });
  });

  it("repeats the same idempotent effect before receipt and skips it after receipt", () => {
    const initial = slice();
    const key = sideEffectKey(initial, "canonical-write", "off_1");
    expect(shouldExecuteSideEffect(initial, key)).toBe(true);
    // Interruption before the external call: durable state is unchanged.
    expect(shouldExecuteSideEffect(initial, key)).toBe(true);
    // Interruption after the external call but before receipt repeats the same key.
    expect(sideEffectKey(initial, "canonical-write", "off_1")).toBe(key);
    const completed = recordSideEffectReceipt(initial, {
      key,
      completedAt: "2026-08-03T05:00:10Z",
      resultHash: `sha256:${"a".repeat(64)}`,
    });
    expect(shouldExecuteSideEffect(completed, key)).toBe(false);
    expect(
      recordSideEffectReceipt(completed, {
        key,
        completedAt: "2026-08-03T05:00:10Z",
        resultHash: `sha256:${"a".repeat(64)}`,
      }),
    ).toBe(completed);
  });

  it("rejects cross-slice effects and new receipts after terminal state", () => {
    const first = slice();
    const otherRun = createPipelineRun({
      writer,
      occurrence: createScheduleOccurrence({
        config: schedule,
        scheduledAt: "2026-08-06T05:00:00Z",
        createdAt: "2026-08-06T05:00:01Z",
      }),
      attemptNumber: 1,
      codeVersion: "v1",
      schemaVersion: "v1",
      providerScope: ["prv_a"],
      startedAt: "2026-08-06T05:00:02Z",
    });
    const other = createProviderSlice({
      run: otherRun,
      occurrence: createScheduleOccurrence({
        config: schedule,
        scheduledAt: "2026-08-06T05:00:00Z",
        createdAt: "2026-08-06T05:00:01Z",
      }),
      providerId: "prv_a",
    });
    const foreignKey = sideEffectKey(other, "canonical-write", "off_1");
    expect(() => shouldExecuteSideEffect(first, foreignKey)).toThrow(/belong/);
    const terminal = applyProviderEvent(first, {
      eventId: "evt_terminal",
      nextState: "failed",
      recordedAt: "2026-08-03T05:00:04Z",
      code: "acquisition_failed",
    });
    expect(() =>
      recordSideEffectReceipt(terminal, {
        key: sideEffectKey(terminal, "canonical-write", "off_1"),
        completedAt: "2026-08-03T05:00:05Z",
        resultHash: `sha256:${"b".repeat(64)}`,
      }),
    ).toThrow(/terminal/);
    expect(() =>
      shouldExecuteSideEffect(
        terminal,
        sideEffectKey(terminal, "canonical-write", "off_2"),
      ),
    ).toThrow(/terminal/);
  });
});

describe("bounded retry decisions (PIPE-007–PIPE-008)", () => {
  const policy = {
    maximumTotalAttempts: 4,
    baseDelayMs: 1_000,
    maximumBackoffMs: 8_000,
    providerMinimumDelayMs: 500,
    deadlineAt: "2026-08-03T05:10:00Z",
  } as const;

  it("uses bounded exponential backoff and honors delta-seconds Retry-After", () => {
    expect(
      decideRetry({
        policy,
        completedAttempt: 2,
        errorKind: "rate_limited",
        now: "2026-08-03T05:00:00Z",
        retryAfter: "7",
      }),
    ).toEqual({
      action: "retry",
      delayMs: 7_000,
      retryAt: "2026-08-03T05:00:07.000Z",
    });
  });

  it("honors an HTTP-date Retry-After", () => {
    expect(
      decideRetry({
        policy,
        completedAttempt: 1,
        errorKind: "rate_limited",
        now: "2026-08-03T05:00:00Z",
        retryAfter: "Mon, 03 Aug 2026 05:00:09 GMT",
      }),
    ).toMatchObject({ action: "retry", delayMs: 9_000 });
  });

  it("terminates permanent, exhausted, and out-of-window retries without loops", () => {
    expect(
      decideRetry({
        policy,
        completedAttempt: 1,
        errorKind: "permanent",
        now: "2026-08-03T05:00:00Z",
      }),
    ).toEqual({ action: "quarantine", reason: "permanent_error" });
    expect(
      decideRetry({
        policy,
        completedAttempt: 4,
        errorKind: "transient",
        now: "2026-08-03T05:00:00Z",
      }),
    ).toEqual({ action: "failed", reason: "attempts_exhausted" });
    expect(
      decideRetry({
        policy,
        completedAttempt: 1,
        errorKind: "rate_limited",
        now: "2026-08-03T05:00:00Z",
        retryAfter: "999999999999999999999999999",
      }),
    ).toEqual({ action: "failed", reason: "deadline_exceeded" });
  });
});

describe("aggregate budget admission (PIPE-003, PIPE-007)", () => {
  it("checks every aggregate ceiling and never partially admits an operation", () => {
    const used = budget(2);
    const requested = { ...budget(1), bytes: 9 };
    const decision = admitBudget({
      used,
      requested,
      ceilings: budget(10),
      operation: "acquisition",
      expensiveWorkBreakerTripped: false,
    });
    expect(decision).toMatchObject({
      admitted: false,
      exceeded: ["bytes"],
      reason: "ceiling_exceeded",
    });
    expect(decision.projected.bytes).toBe(11);
  });

  it("stops expensive work at the breaker while preserving core control decisions", () => {
    expect(
      admitBudget({
        used: budget(),
        requested: budget(),
        ceilings: budget(),
        operation: "browser",
        expensiveWorkBreakerTripped: true,
      }).admitted,
    ).toBe(false);
    expect(
      admitBudget({
        used: budget(),
        requested: budget(),
        ceilings: budget(),
        operation: "core",
        expensiveWorkBreakerTripped: true,
      }).admitted,
    ).toBe(true);
  });

  it("rejects negative values and safe-integer overflow", () => {
    expect(() =>
      admitBudget({
        used: { ...budget(), requests: -1 },
        requested: budget(),
        ceilings: budget(),
        operation: "core",
        expensiveWorkBreakerTripped: false,
      }),
    ).toThrow(/range/);
    expect(() =>
      admitBudget({
        used: { ...budget(), bytes: Number.MAX_SAFE_INTEGER },
        requested: { ...budget(), bytes: 1 },
        ceilings: { ...budget(), bytes: Number.MAX_SAFE_INTEGER },
        operation: "core",
        expensiveWorkBreakerTripped: false,
      }),
    ).toThrow(/overflows/);
    expect(BUDGET_FIELDS).toHaveLength(6);
  });
});

describe("validation, anomaly recheck, and last-known-good (PIPE-040–PIPE-044)", () => {
  it("accepts validated non-anomalous candidates", () => {
    expect(
      decideCandidate({
        affectedRecordId: "off_1",
        candidateHash: newHash,
        validation: validChecks(),
      }),
    ).toMatchObject({ action: "accept_candidate", acceptedHash: newHash });
  });

  it("rejects a malformed hash before it can become accepted", () => {
    expect(() =>
      decideCandidate({
        affectedRecordId: "off_1",
        candidateHash: malformedHash,
        validation: validChecks(),
      }),
    ).toThrow(/SHA-256/);
  });

  it("requires a recheck before accepting an anomaly", () => {
    expect(
      decideCandidate({
        affectedRecordId: "off_1",
        candidateHash: newHash,
        validation: validChecks(),
        anomaly: { kind: "price_change" },
        lastKnownGoodRecordId: "off_1@old",
      }).action,
    ).toBe("recheck_required");
  });

  it("accepts confirmed rechecks and quarantines only the affected record on conflict", () => {
    expect(
      decideCandidate({
        affectedRecordId: "off_1",
        candidateHash: newHash,
        validation: validChecks(),
        anomaly: {
          kind: "precision_change",
          recheck: { outcome: "confirmed", candidateHash: newHash },
        },
      }).action,
    ).toBe("accept_reverified");
    expect(
      decideCandidate({
        affectedRecordId: "off_1",
        candidateHash: newHash,
        validation: validChecks(),
        anomaly: {
          kind: "precision_change",
          recheck: { outcome: "conflict" },
        },
        lastKnownGoodRecordId: "off_1@old",
      }),
    ).toMatchObject({
      action: "quarantine_and_carry",
      affectedRecordId: "off_1",
      carriedRecordId: "off_1@old",
    });
  });

  it("rejects a malformed candidate and preserves last-known-good", () => {
    const decision = decideCandidate({
      affectedRecordId: "off_1",
      candidateHash: malformedHash,
      validation: validChecks({
        decimal_prices: false,
        required_evidence: false,
      }),
      lastKnownGoodRecordId: "off_1@old",
    });
    expect(decision).toMatchObject({
      action: "reject_and_carry",
      carriedRecordId: "off_1@old",
      failedChecks: ["decimal_prices", "required_evidence"],
    });
  });
});

describe("provider isolation and roster terminality (PIPE-005, PIPE-019, PIPE-043)", () => {
  const completion = (
    providerId: string,
    state: ProviderCompletion["state"],
    overrides: Partial<ProviderCompletion> = {},
  ): ProviderCompletion => ({
    providerId,
    adapterVersion: "adapter-v1",
    rosterVersion: "roster-v1",
    sourceRegisterVersion: "register-v1",
    state,
    expectedRosterItemIds,
    rosterOutcomes: completeRosterOutcomes,
    cost: budget(1),
    errorCodes: [],
    ...overrides,
  });

  it("detects missing, unexpected, and duplicate roster outcomes", () => {
    expect(
      evaluateRosterCoverage(
        ["a", "b"],
        [
          { rosterItemId: "a", status: "published", evidenceId: "ev_a" },
          {
            rosterItemId: "a",
            status: "failed",
            evidenceId: "ev_a_failure",
            errorCode: "duplicate_outcome",
          },
          { rosterItemId: "c", status: "unavailable", evidenceId: "ev_c" },
        ],
      ),
    ).toEqual({
      complete: false,
      missing: ["b"],
      unexpected: ["c"],
      duplicate: ["a"],
    });
  });

  it("fails closed for empty rosters and outcomes without machine evidence", () => {
    expect(evaluateRosterCoverage([], []).complete).toBe(false);
    expect(() =>
      evaluateRosterCoverage(
        ["a"],
        [{ rosterItemId: "a", status: "published" }],
      ),
    ).toThrow(/evidence/);
    expect(() =>
      evaluateRosterCoverage(
        ["a"],
        [
          {
            rosterItemId: "a",
            status: "failed",
            evidenceId: "ev_failure",
          },
        ],
      ),
    ).toThrow(/error code/);
    expect(() =>
      evaluateRosterCoverage(
        ["a"],
        [
          {
            rosterItemId: "a",
            status: "invented" as "failed",
            evidenceId: "ev_failure",
            errorCode: "source_failed",
          },
        ],
      ),
    ).toThrow(/unknown runtime status/);
  });

  it("does not allow parent success with a nonterminal child or incomplete roster", () => {
    expect(
      coordinateRun(
        ["prv_a"],
        [completion("prv_a", "validating", { newSliceId: "slice_a" })],
      ),
    ).toMatchObject({ terminal: false, publishable: false, status: "running" });
    expect(
      coordinateRun(
        ["prv_a"],
        [
          completion("prv_a", "ready", {
            newSliceId: "slice_a",
            expectedRosterItemIds: ["a"],
            rosterOutcomes: [],
          }),
        ],
      ).terminal,
    ).toBe(false);
  });

  it("publishes successful providers and carries failed provider last-known-good independently", () => {
    expect(
      coordinateRun(
        ["prv_b", "prv_a"],
        [
          completion("prv_a", "ready", { newSliceId: "slice_a_new" }),
          completion("prv_b", "quarantined", {
            lastKnownGoodSliceId: "slice_b_old",
            errorCodes: ["anomaly_conflict"],
          }),
        ],
      ),
    ).toEqual({
      terminal: true,
      publishable: true,
      status: "completed_with_provider_failures",
      providers: [
        { providerId: "prv_a", disposition: "new", sliceId: "slice_a_new" },
        {
          providerId: "prv_b",
          disposition: "carried_forward",
          sliceId: "slice_b_old",
        },
      ],
    });
  });

  it("completes but cannot publish an empty replacement when no provider has usable data", () => {
    expect(
      coordinateRun(
        ["prv_a"],
        [completion("prv_a", "failed", { errorCodes: ["source_failed"] })],
      ),
    ).toMatchObject({
      terminal: true,
      publishable: false,
      status: "completed_with_provider_failures",
    });
  });
});

describe("controlled canonical writes (BE-003–BE-006)", () => {
  const batch = {
    writer,
    runId: "run_01",
    providerSliceKey: "provider-slice|occurrence-a|prv-a",
    providerId: "prv_a",
    offerings: [{ offeringId: "off_1", providerId: "prv_a" }],
    observations: [
      { observationId: "obs_1", runId: "run_01", providerId: "prv_a" },
    ],
    evidence: [{ evidenceId: "ev_1", observationId: "obs_1" }],
    facts: [
      {
        factId: "fact_1",
        subjectId: "off_1",
        fieldName: "price_input",
        scopeId: "scope_1",
        offeringId: "off_1",
        observationId: "obs_1",
        evidenceId: "ev_1",
      },
    ],
  } as const;

  it("admits a complete graph with deterministic run/provider/resource keys", () => {
    const first = admitCanonicalWrite(batch);
    const replay = admitCanonicalWrite(batch);
    expect(first.admitted).toBe(true);
    expect(replay.idempotencyKeys).toEqual(first.idempotencyKeys);
    expect(first.idempotencyKeys).toHaveLength(4);
  });

  it("rejects a public writer and orphan/mismatched graph records", () => {
    expect(() =>
      admitCanonicalWrite({
        ...batch,
        writer: { kind: "public" as "pipeline", identityId: "visitor" },
      }),
    ).toThrow(/controlled/);
    expect(
      admitCanonicalWrite({
        ...batch,
        evidence: [{ evidenceId: "ev_1", observationId: "obs_missing" }],
      }).errors,
    ).toContain("orphan_evidence:ev_1");
  });

  it("requires append-oriented scoped supersession linkage", () => {
    const correction = {
      ...batch,
      observations: [
        { observationId: "obs_2", runId: "run_01", providerId: "prv_a" },
      ],
      evidence: [{ evidenceId: "ev_2", observationId: "obs_2" }],
      facts: [
        {
          factId: "fact_2",
          subjectId: "off_1",
          fieldName: "price_input",
          scopeId: "scope_1",
          offeringId: "off_1",
          observationId: "obs_2",
          evidenceId: "ev_2",
          supersedesFactId: "fact_1",
        },
      ],
    } as const;
    expect(admitCanonicalWrite(correction, batch.facts).admitted).toBe(true);
    expect(
      admitCanonicalWrite(
        {
          ...correction,
          facts: [{ ...correction.facts[0], supersedesFactId: "missing" }],
        },
        batch.facts,
      ).errors,
    ).toContain("missing_superseded_fact:fact_2");
  });

  it("rejects prior identity collisions and cross-scope supersession", () => {
    expect(
      admitCanonicalWrite(
        {
          ...batch,
          facts: [{ ...batch.facts[0], evidenceId: "different" }],
        },
        batch.facts,
      ).errors,
    ).toContain("fact_identity_conflict:fact_1");
    const correction = {
      ...batch,
      facts: [
        {
          ...batch.facts[0],
          factId: "fact_2",
          fieldName: "price_output",
          supersedesFactId: "fact_1",
        },
      ],
    } as const;
    expect(admitCanonicalWrite(correction, batch.facts).errors).toContain(
      "supersession_scope_mismatch:fact_2",
    );
  });

  it("rejects self-supersession and cycles among new facts", () => {
    const cyclic = {
      ...batch,
      facts: [
        { ...batch.facts[0], factId: "fact_2", supersedesFactId: "fact_3" },
        { ...batch.facts[0], factId: "fact_3", supersedesFactId: "fact_2" },
      ],
    } as const;
    expect(admitCanonicalWrite(cyclic).errors).toContain(
      "supersession_cycle:fact_2",
    );
    expect(
      admitCanonicalWrite({
        ...batch,
        facts: [{ ...batch.facts[0], supersedesFactId: batch.facts[0].factId }],
      }).errors,
    ).toContain("supersession_cycle:fact_1");
  });
});

describe("machine-readable non-visitor reports (PIPE-003, PIPE-045)", () => {
  it("refuses to stamp a final report while any provider is nonterminal", () => {
    expect(() =>
      buildRunReport({
        run: run(),
        completions: [],
        endedAt: "2026-08-03T05:05:00Z",
      }),
    ).toThrow(/terminal provider outcomes/);
  });

  it("is deterministic, schema-shaped, aggregated, and sanitized", () => {
    const completions: ProviderCompletion[] = [
      {
        providerId: "prv_b",
        adapterVersion: "adapter-v1",
        rosterVersion: "roster-v1",
        sourceRegisterVersion: "register-v1",
        state: "failed",
        expectedRosterItemIds,
        rosterOutcomes: completeRosterOutcomes,
        lastKnownGoodSliceId: "slice_b_old",
        cost: { ...budget(2), bytes: 20 },
        errorCodes: ["timeout", "timeout"],
      },
      {
        providerId: "prv_a",
        adapterVersion: "adapter-v1",
        rosterVersion: "roster-v1",
        sourceRegisterVersion: "register-v1",
        state: "ready",
        expectedRosterItemIds,
        rosterOutcomes: completeRosterOutcomes,
        newSliceId: "slice_a",
        cost: { ...budget(1), bytes: 10 },
        errorCodes: [],
      },
    ];
    const report = buildRunReport({
      run: run(),
      completions,
      endedAt: "2026-08-03T05:05:00Z",
    });
    expect(report.reportSchemaVersion).toBe("1.0.0");
    expect(report.providers.map(({ providerId }) => providerId)).toEqual([
      "prv_a",
      "prv_b",
    ]);
    expect(report.cost.bytes).toBe(30);
    expect(report.providers[1]?.errorCodes).toEqual(["timeout"]);
    expect(report.providers[0]).toMatchObject({
      adapterVersion: "adapter-v1",
      rosterVersion: "roster-v1",
      sourceRegisterVersion: "register-v1",
    });
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      "ipAddress",
      "cookie",
      "authorization",
      "userAgent",
      "queryString",
      "correlationId",
    ])
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it("rejects grammar-valid but unapproved error payloads", () => {
    const completions: ProviderCompletion[] = [
      {
        providerId: "prv_a",
        adapterVersion: "adapter-v1",
        rosterVersion: "roster-v1",
        sourceRegisterVersion: "register-v1",
        state: "ready",
        expectedRosterItemIds,
        rosterOutcomes: completeRosterOutcomes,
        newSliceId: "slice_a",
        cost: budget(),
        errorCodes: ["thislookssecretsafe123" as "timeout"],
      },
      {
        providerId: "prv_b",
        adapterVersion: "adapter-v1",
        rosterVersion: "roster-v1",
        sourceRegisterVersion: "register-v1",
        state: "ready",
        expectedRosterItemIds,
        rosterOutcomes: completeRosterOutcomes,
        newSliceId: "slice_b",
        cost: budget(),
        errorCodes: [],
      },
    ];
    expect(() =>
      buildRunReport({
        run: run(),
        completions,
        endedAt: "2026-08-03T05:05:00Z",
      }),
    ).toThrow(/approved pipeline error code/);
  });

  it("rejects report cost overflow", () => {
    const completions: ProviderCompletion[] = [
      {
        providerId: "prv_a",
        adapterVersion: "adapter-v1",
        rosterVersion: "roster-v1",
        sourceRegisterVersion: "register-v1",
        state: "ready",
        expectedRosterItemIds,
        rosterOutcomes: completeRosterOutcomes,
        newSliceId: "slice_a",
        cost: { ...budget(), bytes: Number.MAX_SAFE_INTEGER },
        errorCodes: [],
      },
      {
        providerId: "prv_b",
        adapterVersion: "adapter-v1",
        rosterVersion: "roster-v1",
        sourceRegisterVersion: "register-v1",
        state: "ready",
        expectedRosterItemIds,
        rosterOutcomes: completeRosterOutcomes,
        newSliceId: "slice_b",
        cost: { ...budget(), bytes: 1 },
        errorCodes: [],
      },
    ];
    expect(() =>
      buildRunReport({
        run: run(),
        completions,
        endedAt: "2026-08-03T05:05:00Z",
      }),
    ).toThrow(/overflows/);
  });
});
