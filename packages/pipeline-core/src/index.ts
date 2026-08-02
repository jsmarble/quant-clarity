/**
 * Runtime-neutral control-plane decisions for the durable pipeline.
 *
 * This package deliberately performs no I/O. A Workflow/D1 adapter must persist
 * each returned snapshot and use the stable side-effect keys when it performs
 * external work.
 */

export type WriterIdentity = Readonly<{
  kind: "pipeline" | "deployment";
  identityId: string;
}>;

export const PIPELINE_ERROR_CODES = [
  "acquisition_failed",
  "anomaly_conflict",
  "budget_exceeded",
  "catalog_drift",
  "duplicate_outcome",
  "evidence_missing",
  "permanent_source_error",
  "rate_limit_exhausted",
  "retry_deadline_exceeded",
  "source_failed",
  "timeout",
  "validation_failed",
] as const;
export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number];

export type ScheduleConfig = Readonly<{
  name: string;
  utcWeekdays: readonly number[];
  utcHour: number;
  utcMinute: number;
}>;

export type ScheduleOccurrence = Readonly<{
  occurrenceId: string;
  occurrenceKey: string;
  scheduleName: string;
  scheduleExpression: string;
  scheduledAt: string;
  createdAt: string;
}>;

export type PipelineRun = Readonly<{
  runId: string;
  runKey: string;
  occurrenceId: string;
  attemptNumber: number;
  replayOfRunId?: string;
  codeVersion: string;
  schemaVersion: string;
  providerScope: readonly string[];
  startedAt: string;
}>;

const assertNonEmpty = (value: string, label: string): void => {
  if (value.trim().length === 0)
    throw new TypeError(`${label} must not be empty`);
};

function assertMachineCode(
  value: string,
  label: string,
): asserts value is PipelineErrorCode {
  if (!PIPELINE_ERROR_CODES.includes(value as PipelineErrorCode))
    throw new TypeError(`${label} is not an approved pipeline error code`);
}

const assertSha256 = (value: string, label: string): void => {
  if (!/^sha256:[0-9a-f]{64}$/.test(value))
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
};

const assertIntegerInRange = (
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${label} is outside its supported range`);
};

const instantMilliseconds = (value: string, label: string): number => {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    throw new TypeError(`${label} is invalid`);
  return milliseconds;
};

const uniqueSorted = (values: readonly string[], label: string): string[] => {
  const normalized = values.map((value) => {
    assertNonEmpty(value, label);
    return value;
  });
  const result = [...new Set(normalized)].sort();
  if (result.length !== normalized.length)
    throw new TypeError(`${label} contains a duplicate`);
  return result;
};

/** A collision-free tuple encoding for already-stable identifiers. */
export const deterministicKey = (
  namespace: string,
  parts: readonly string[],
): string => {
  assertNonEmpty(namespace, "namespace");
  return `${namespace}|${parts.map((part) => `${String(part.length)}:${part}`).join("|")}`;
};

const deterministicCanonicalId = (
  prefix: "occ" | "run" | "pvr",
  key: string,
): string => {
  const bytes = sha256Ascii(key).slice(0, 16);
  // Canonical contracts require the UUIDv4 shape. The tuple hash supplies the
  // deterministic payload while these bits preserve the accepted ID grammar.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

/** Portable SHA-256 for the small ASCII-only identity tuple. */
const sha256Ascii = (value: string): Uint8Array => {
  if (!/^[\x20-\x7e]*$/.test(value))
    throw new TypeError("identity tuple must contain printable ASCII only");
  const byteLength = value.length;
  const paddedLength = Math.ceil((byteLength + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  for (let index = 0; index < byteLength; index += 1)
    bytes[index] = value.charCodeAt(index);
  bytes[byteLength] = 0x80;
  const bitLength = BigInt(byteLength) * 8n;
  for (let index = 0; index < 8; index += 1)
    bytes[paddedLength - 1 - index] = Number(
      (bitLength >> BigInt(index * 8)) & 0xffn,
    );
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const cursor = offset + index * 4;
      words[index] =
        (((bytes[cursor] ?? 0) << 24) |
          ((bytes[cursor + 1] ?? 0) << 16) |
          ((bytes[cursor + 2] ?? 0) << 8) |
          (bytes[cursor + 3] ?? 0)) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) +
          sigma0 +
          (words[index - 7] ?? 0) +
          sigma1) >>>
        0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 =
        rotateRight(e ?? 0, 6) ^
        rotateRight(e ?? 0, 11) ^
        rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temporary1 =
        ((h ?? 0) +
          bigSigma1 +
          choice +
          (SHA256_CONSTANTS[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const bigSigma0 =
        rotateRight(a ?? 0, 2) ^
        rotateRight(a ?? 0, 13) ^
        rotateRight(a ?? 0, 22);
      const majority =
        ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temporary2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    for (const [index, valuePart] of [a, b, c, d, e, f, g, h].entries())
      hash[index] = ((hash[index] ?? 0) + (valuePart ?? 0)) >>> 0;
  }
  const result = new Uint8Array(32);
  for (const [index, word] of hash.entries()) {
    result[index * 4] = word >>> 24;
    result[index * 4 + 1] = word >>> 16;
    result[index * 4 + 2] = word >>> 8;
    result[index * 4 + 3] = word;
  }
  return result;
};

export const scheduleExpression = (config: ScheduleConfig): string => {
  validateSchedule(config);
  return `${String(config.utcMinute)} ${String(config.utcHour)} * * ${[...config.utcWeekdays].sort().join(",")}`;
};

export const describeSchedule = (config: ScheduleConfig): string => {
  validateSchedule(config);
  const days = [...config.utcWeekdays]
    .sort()
    .map(
      (day) =>
        [
          "Sunday",
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
        ][day],
    )
    .join(" and ");
  return `${days} at ${String(config.utcHour).padStart(2, "0")}:${String(config.utcMinute).padStart(2, "0")} UTC`;
};

const validateSchedule = (config: ScheduleConfig): void => {
  assertNonEmpty(config.name, "schedule name");
  assertIntegerInRange(config.utcHour, 0, 23, "UTC hour");
  assertIntegerInRange(config.utcMinute, 0, 59, "UTC minute");
  if (config.utcWeekdays.length === 0)
    throw new TypeError("schedule must include at least one UTC weekday");
  const days = config.utcWeekdays.map((day) => {
    assertIntegerInRange(day, 0, 6, "UTC weekday");
    return day;
  });
  if (new Set(days).size !== days.length)
    throw new TypeError("schedule contains a duplicate UTC weekday");
};

export const createScheduleOccurrence = (input: {
  config: ScheduleConfig;
  scheduledAt: string;
  createdAt: string;
}): ScheduleOccurrence => {
  validateSchedule(input.config);
  const scheduled = new Date(
    instantMilliseconds(input.scheduledAt, "scheduled time"),
  );
  instantMilliseconds(input.createdAt, "occurrence creation time");
  if (
    !input.config.utcWeekdays.includes(scheduled.getUTCDay()) ||
    scheduled.getUTCHours() !== input.config.utcHour ||
    scheduled.getUTCMinutes() !== input.config.utcMinute ||
    scheduled.getUTCSeconds() !== 0 ||
    scheduled.getUTCMilliseconds() !== 0
  )
    throw new TypeError("scheduled time does not match the UTC schedule");
  const occurrenceKey = deterministicKey("occurrence", [
    input.config.name,
    scheduled.toISOString(),
  ]);
  return Object.freeze({
    occurrenceId: deterministicCanonicalId("occ", occurrenceKey),
    occurrenceKey,
    scheduleName: input.config.name,
    scheduleExpression: scheduleExpression(input.config),
    scheduledAt: scheduled.toISOString(),
    createdAt: new Date(Date.parse(input.createdAt)).toISOString(),
  });
};

export const createPipelineRun = (input: {
  writer: WriterIdentity;
  occurrence: ScheduleOccurrence;
  attemptNumber: number;
  replayOfRunId?: string;
  codeVersion: string;
  schemaVersion: string;
  providerScope: readonly string[];
  startedAt: string;
}): PipelineRun => {
  assertControlledWriter(input.writer);
  assertIntegerInRange(
    input.attemptNumber,
    1,
    Number.MAX_SAFE_INTEGER,
    "run attempt",
  );
  assertNonEmpty(input.codeVersion, "code version");
  assertNonEmpty(input.schemaVersion, "schema version");
  const providerScope = uniqueSorted(input.providerScope, "provider scope");
  if (providerScope.length === 0)
    throw new TypeError("provider scope is empty");
  if (input.attemptNumber === 1 && input.replayOfRunId !== undefined)
    throw new TypeError("a first attempt cannot be a replay");
  if (input.attemptNumber > 1 && input.replayOfRunId === undefined)
    throw new TypeError("a replay must link to its prior run");
  const startedAt = new Date(
    instantMilliseconds(input.startedAt, "run start time"),
  ).toISOString();
  if (Date.parse(startedAt) < Date.parse(input.occurrence.scheduledAt))
    throw new TypeError("run start precedes its scheduled occurrence");
  if (input.attemptNumber > 1) {
    const priorRunKey = deterministicKey("run", [
      input.occurrence.occurrenceKey,
      String(input.attemptNumber - 1),
    ]);
    const expectedPriorRunId = deterministicCanonicalId("run", priorRunKey);
    if (input.replayOfRunId !== expectedPriorRunId)
      throw new TypeError(
        "a replay must link to the adjacent prior attempt for this occurrence",
      );
  }
  const runKey = deterministicKey("run", [
    input.occurrence.occurrenceKey,
    String(input.attemptNumber),
  ]);
  return Object.freeze({
    runId: deterministicCanonicalId("run", runKey),
    runKey,
    occurrenceId: input.occurrence.occurrenceId,
    attemptNumber: input.attemptNumber,
    ...(input.replayOfRunId === undefined
      ? {}
      : { replayOfRunId: input.replayOfRunId }),
    codeVersion: input.codeVersion,
    schemaVersion: input.schemaVersion,
    providerScope,
    startedAt,
  });
};

export function assertControlledWriter(writer: {
  kind: string;
  identityId: string;
}): asserts writer is WriterIdentity {
  if (writer.kind !== "pipeline" && writer.kind !== "deployment")
    throw new TypeError(
      "writes require a controlled pipeline or deployment identity",
    );
  assertNonEmpty(writer.identityId, "writer identity ID");
}

export const PROVIDER_STATES = [
  "pending",
  "budget_admitted",
  "acquiring",
  "validating",
  "rechecking",
  "canonicalizing",
  "ready",
  "failed",
  "quarantined",
] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];
export type TerminalProviderState = Extract<
  ProviderState,
  "ready" | "failed" | "quarantined"
>;

export type ProviderEvent = Readonly<{
  eventId: string;
  nextState: ProviderState;
  recordedAt: string;
  code?: PipelineErrorCode;
}>;

export type SideEffectReceipt = Readonly<{
  key: string;
  completedAt: string;
  resultHash: string;
}>;

export type ProviderSliceSnapshot = Readonly<{
  providerSliceId: string;
  providerSliceKey: string;
  runId: string;
  occurrenceId: string;
  providerId: string;
  state: ProviderState;
  events: readonly ProviderEvent[];
  sideEffectReceipts: readonly SideEffectReceipt[];
}>;

export const createProviderSlice = (input: {
  run: PipelineRun;
  occurrence: ScheduleOccurrence;
  providerId: string;
}): ProviderSliceSnapshot => {
  if (input.run.occurrenceId !== input.occurrence.occurrenceId)
    throw new TypeError("run does not belong to the occurrence");
  if (!input.run.providerScope.includes(input.providerId))
    throw new TypeError("provider is outside the run scope");
  const providerAttemptKey = deterministicKey("provider-attempt", [
    input.run.runKey,
    input.providerId,
  ]);
  const providerSliceId = deterministicCanonicalId("pvr", providerAttemptKey);
  return Object.freeze({
    providerSliceId,
    providerSliceKey: deterministicKey("provider-slice", [
      input.run.runKey,
      input.providerId,
    ]),
    runId: input.run.runId,
    occurrenceId: input.occurrence.occurrenceId,
    providerId: input.providerId,
    state: "pending",
    events: Object.freeze([]),
    sideEffectReceipts: Object.freeze([]),
  });
};

const transitions: Readonly<Record<ProviderState, readonly ProviderState[]>> = {
  pending: ["budget_admitted", "failed", "quarantined"],
  budget_admitted: ["acquiring", "failed", "quarantined"],
  acquiring: ["validating", "failed", "quarantined"],
  validating: ["rechecking", "canonicalizing", "failed", "quarantined"],
  rechecking: ["canonicalizing", "failed", "quarantined"],
  canonicalizing: ["ready", "failed", "quarantined"],
  ready: [],
  failed: [],
  quarantined: [],
};

/** Append-only, monotone reducer. Replaying an event ID is a no-op. */
export const applyProviderEvent = (
  snapshot: ProviderSliceSnapshot,
  event: ProviderEvent,
): ProviderSliceSnapshot => {
  assertNonEmpty(event.eventId, "event ID");
  instantMilliseconds(event.recordedAt, "event time");
  const prior = snapshot.events.find(
    (candidate) => candidate.eventId === event.eventId,
  );
  if (prior !== undefined) {
    if (
      prior.nextState !== event.nextState ||
      prior.recordedAt !== event.recordedAt ||
      prior.code !== event.code
    )
      throw new TypeError(
        "an event ID cannot be reused with different content",
      );
    return snapshot;
  }
  const priorEvent = snapshot.events.at(-1);
  if (
    priorEvent !== undefined &&
    Date.parse(event.recordedAt) < Date.parse(priorEvent.recordedAt)
  )
    throw new TypeError("provider event time must be monotone");
  if (
    (event.nextState === "failed" || event.nextState === "quarantined") &&
    event.code === undefined
  )
    throw new TypeError(
      "terminal failure and quarantine events require a code",
    );
  if (event.code !== undefined)
    assertMachineCode(event.code, "provider event code");
  if (!transitions[snapshot.state].includes(event.nextState))
    throw new TypeError(
      `invalid provider transition ${snapshot.state} -> ${event.nextState}`,
    );
  return Object.freeze({
    ...snapshot,
    state: event.nextState,
    events: Object.freeze([...snapshot.events, Object.freeze({ ...event })]),
  });
};

export const sideEffectKey = (
  snapshot: ProviderSliceSnapshot,
  step: string,
  resourceId: string,
): string =>
  deterministicKey("side-effect", [
    snapshot.providerSliceKey,
    step,
    resourceId,
  ]);

export const shouldExecuteSideEffect = (
  snapshot: ProviderSliceSnapshot,
  key: string,
): boolean => {
  assertOwnedSideEffectKey(snapshot, key);
  if (
    snapshot.state === "ready" ||
    snapshot.state === "failed" ||
    snapshot.state === "quarantined"
  )
    throw new TypeError(
      "terminal provider state cannot execute a new side effect",
    );
  return !snapshot.sideEffectReceipts.some((receipt) => receipt.key === key);
};

const assertOwnedSideEffectKey = (
  snapshot: ProviderSliceSnapshot,
  key: string,
): void => {
  const ownedPrefix = `side-effect|${String(snapshot.providerSliceKey.length)}:${snapshot.providerSliceKey}|`;
  if (!key.startsWith(ownedPrefix))
    throw new TypeError(
      "side-effect key does not belong to this provider slice",
    );
};

/**
 * Persist this receipt only after the idempotently-keyed effect succeeds.
 * A crash before persistence safely repeats the same key; a crash after it is a no-op.
 */
export const recordSideEffectReceipt = (
  snapshot: ProviderSliceSnapshot,
  receipt: SideEffectReceipt,
): ProviderSliceSnapshot => {
  assertNonEmpty(receipt.key, "side-effect key");
  assertSha256(receipt.resultHash, "side-effect result hash");
  instantMilliseconds(receipt.completedAt, "side-effect completion time");
  const prior = snapshot.sideEffectReceipts.find(
    (candidate) => candidate.key === receipt.key,
  );
  if (prior !== undefined) {
    if (
      prior.resultHash !== receipt.resultHash ||
      prior.completedAt !== receipt.completedAt
    )
      throw new TypeError(
        "a side-effect key cannot be reused with a different receipt",
      );
    return snapshot;
  }
  assertOwnedSideEffectKey(snapshot, receipt.key);
  if (
    snapshot.state === "ready" ||
    snapshot.state === "failed" ||
    snapshot.state === "quarantined"
  )
    throw new TypeError(
      "terminal provider state cannot accept a new side-effect receipt",
    );
  return Object.freeze({
    ...snapshot,
    sideEffectReceipts: Object.freeze([
      ...snapshot.sideEffectReceipts,
      Object.freeze({ ...receipt }),
    ]),
  });
};

export type ProviderStartDecision =
  | Readonly<{ action: "start" }>
  | Readonly<{ action: "resume"; providerSliceId: string }>
  | Readonly<{ action: "noop_terminal"; providerSliceId: string }>;

export const decideProviderStart = (
  requested: ProviderSliceSnapshot,
  durableSlices: readonly ProviderSliceSnapshot[],
): ProviderStartDecision => {
  const matches = durableSlices.filter(
    (slice) => slice.providerSliceKey === requested.providerSliceKey,
  );
  if (matches.length > 1)
    throw new TypeError("durable state contains duplicate provider slices");
  const existing = matches[0];
  if (existing !== undefined)
    return existing.state === "ready" ||
      existing.state === "failed" ||
      existing.state === "quarantined"
      ? Object.freeze({
          action: "noop_terminal",
          providerSliceId: existing.providerSliceId,
        })
      : Object.freeze({
          action: "resume",
          providerSliceId: existing.providerSliceId,
        });
  const priorInFlight = durableSlices.filter(
    (slice) =>
      slice.occurrenceId === requested.occurrenceId &&
      slice.providerId === requested.providerId &&
      slice.state !== "ready" &&
      slice.state !== "failed" &&
      slice.state !== "quarantined",
  );
  if (priorInFlight.length > 1)
    throw new TypeError("durable state contains concurrent provider attempts");
  const prior = priorInFlight[0];
  return prior === undefined
    ? Object.freeze({ action: "start" })
    : Object.freeze({
        action: "resume",
        providerSliceId: prior.providerSliceId,
      });
};

export type RetryPolicy = Readonly<{
  maximumTotalAttempts: number;
  baseDelayMs: number;
  maximumBackoffMs: number;
  providerMinimumDelayMs: number;
  deadlineAt: string;
}>;

export type RetryDecision =
  | Readonly<{ action: "retry"; delayMs: number; retryAt: string }>
  | Readonly<{
      action: "failed" | "quarantine";
      reason: "attempts_exhausted" | "deadline_exceeded" | "permanent_error";
    }>;

const parseRetryAfter = (value: string | undefined, nowMs: number): number => {
  if (value === undefined) return 0;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds)) return Number.POSITIVE_INFINITY;
    return seconds * 1_000;
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) throw new TypeError("Retry-After is invalid");
  return Math.max(0, date - nowMs);
};

export const decideRetry = (input: {
  policy: RetryPolicy;
  completedAttempt: number;
  errorKind: "transient" | "rate_limited" | "permanent";
  now: string;
  retryAfter?: string;
}): RetryDecision => {
  assertIntegerInRange(
    input.policy.maximumTotalAttempts,
    1,
    1_000,
    "maximum total attempts",
  );
  assertIntegerInRange(input.completedAttempt, 1, 1_000, "completed attempt");
  for (const [label, value] of [
    ["base delay", input.policy.baseDelayMs],
    ["maximum backoff", input.policy.maximumBackoffMs],
    ["provider minimum delay", input.policy.providerMinimumDelayMs],
  ] as const)
    assertIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER, label);
  const nowMs = instantMilliseconds(input.now, "retry decision time");
  const deadlineMs = instantMilliseconds(
    input.policy.deadlineAt,
    "retry deadline",
  );
  if (input.errorKind === "permanent")
    return Object.freeze({ action: "quarantine", reason: "permanent_error" });
  if (input.completedAttempt >= input.policy.maximumTotalAttempts)
    return Object.freeze({ action: "failed", reason: "attempts_exhausted" });
  const exponent = Math.min(input.completedAttempt - 1, 52);
  const generatedBackoff = Math.min(
    input.policy.maximumBackoffMs,
    input.policy.baseDelayMs * 2 ** exponent,
  );
  const retryAfterMs = parseRetryAfter(input.retryAfter, nowMs);
  const delayMs = Math.max(
    generatedBackoff,
    input.policy.providerMinimumDelayMs,
    retryAfterMs,
  );
  if (!Number.isSafeInteger(delayMs) || nowMs + delayMs > deadlineMs)
    return Object.freeze({ action: "failed", reason: "deadline_exceeded" });
  return Object.freeze({
    action: "retry",
    delayMs,
    retryAt: new Date(nowMs + delayMs).toISOString(),
  });
};

export const BUDGET_FIELDS = [
  "requests",
  "bytes",
  "aiTokens",
  "browserMilliseconds",
  "elapsedMilliseconds",
  "costMicrousd",
] as const;
export type BudgetField = (typeof BUDGET_FIELDS)[number];
export type BudgetAmounts = Readonly<Record<BudgetField, number>>;

export type BudgetDecision = Readonly<{
  admitted: boolean;
  projected: BudgetAmounts;
  exceeded: readonly BudgetField[];
  reason?: "expensive_work_breaker" | "ceiling_exceeded";
}>;

const validateBudgetAmounts = (amounts: BudgetAmounts, label: string): void => {
  for (const field of BUDGET_FIELDS)
    assertIntegerInRange(
      amounts[field],
      0,
      Number.MAX_SAFE_INTEGER,
      `${label} ${field}`,
    );
};

export const admitBudget = (input: {
  used: BudgetAmounts;
  requested: BudgetAmounts;
  ceilings: BudgetAmounts;
  operation: "core" | "acquisition" | "ai" | "browser" | "rebuild";
  expensiveWorkBreakerTripped: boolean;
}): BudgetDecision => {
  validateBudgetAmounts(input.used, "used");
  validateBudgetAmounts(input.requested, "requested");
  validateBudgetAmounts(input.ceilings, "ceiling");
  const projected = Object.fromEntries(
    BUDGET_FIELDS.map((field) => {
      const value = input.used[field] + input.requested[field];
      if (!Number.isSafeInteger(value))
        throw new RangeError(`projected ${field} overflows a safe integer`);
      return [field, value];
    }),
  ) as Record<BudgetField, number>;
  const expensive = input.operation !== "core";
  if (input.expensiveWorkBreakerTripped && expensive)
    return Object.freeze({
      admitted: false,
      projected: Object.freeze(projected),
      exceeded: Object.freeze([]),
      reason: "expensive_work_breaker",
    });
  const exceeded = BUDGET_FIELDS.filter(
    (field) => projected[field] > input.ceilings[field],
  );
  return Object.freeze({
    admitted: exceeded.length === 0,
    projected: Object.freeze(projected),
    exceeded: Object.freeze(exceeded),
    ...(exceeded.length === 0 ? {} : { reason: "ceiling_exceeded" as const }),
  });
};

export const VALIDATION_CHECKS = [
  "identifiers",
  "enum_values",
  "decimal_prices",
  "currency_codes",
  "price_units",
  "parameter_relationships",
  "urls",
  "timestamps",
  "required_evidence",
  "referential_integrity",
] as const;
export type ValidationCheck = (typeof VALIDATION_CHECKS)[number];
export type ValidationResults = Readonly<Record<ValidationCheck, boolean>>;

export const ANOMALY_KINDS = [
  "price_change",
  "precision_change",
  "model_disappearance",
  "checkpoint_change",
  "catalog_size_change",
] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

export type CandidateDecision = Readonly<{
  action:
    | "accept_candidate"
    | "accept_reverified"
    | "recheck_required"
    | "reject_and_carry"
    | "reject_without_replacement"
    | "quarantine_and_carry"
    | "quarantine_without_replacement";
  affectedRecordId: string;
  acceptedHash?: string;
  carriedRecordId?: string;
  failedChecks: readonly ValidationCheck[];
}>;

export const decideCandidate = (input: {
  affectedRecordId: string;
  candidateHash: string;
  validation: ValidationResults;
  anomaly?: Readonly<{
    kind: AnomalyKind;
    recheck?: Readonly<{
      outcome: "confirmed" | "different_verified" | "unavailable" | "conflict";
      candidateHash?: string;
    }>;
  }>;
  lastKnownGoodRecordId?: string;
}): CandidateDecision => {
  assertNonEmpty(input.affectedRecordId, "affected record ID");
  assertNonEmpty(input.candidateHash, "candidate hash");
  const failedChecks = VALIDATION_CHECKS.filter(
    (check) => !input.validation[check],
  );
  const carried = input.lastKnownGoodRecordId;
  if (failedChecks.length > 0)
    return Object.freeze({
      action:
        carried === undefined
          ? "reject_without_replacement"
          : "reject_and_carry",
      affectedRecordId: input.affectedRecordId,
      ...(carried === undefined ? {} : { carriedRecordId: carried }),
      failedChecks: Object.freeze(failedChecks),
    });
  if (input.anomaly === undefined) {
    assertSha256(input.candidateHash, "accepted candidate hash");
    return Object.freeze({
      action: "accept_candidate",
      affectedRecordId: input.affectedRecordId,
      acceptedHash: input.candidateHash,
      failedChecks: Object.freeze([]),
    });
  }
  if (input.anomaly.recheck === undefined)
    return Object.freeze({
      action: "recheck_required",
      affectedRecordId: input.affectedRecordId,
      failedChecks: Object.freeze([]),
    });
  if (
    input.anomaly.recheck.outcome === "confirmed" &&
    input.anomaly.recheck.candidateHash === input.candidateHash
  ) {
    assertSha256(input.candidateHash, "reverified candidate hash");
    return Object.freeze({
      action: "accept_reverified",
      affectedRecordId: input.affectedRecordId,
      acceptedHash: input.candidateHash,
      failedChecks: Object.freeze([]),
    });
  }
  if (
    input.anomaly.recheck.outcome === "different_verified" &&
    input.anomaly.recheck.candidateHash !== undefined
  ) {
    assertSha256(
      input.anomaly.recheck.candidateHash,
      "reverified replacement hash",
    );
    return Object.freeze({
      action: "accept_reverified",
      affectedRecordId: input.affectedRecordId,
      acceptedHash: input.anomaly.recheck.candidateHash,
      failedChecks: Object.freeze([]),
    });
  }
  return Object.freeze({
    action:
      carried === undefined
        ? "quarantine_without_replacement"
        : "quarantine_and_carry",
    affectedRecordId: input.affectedRecordId,
    ...(carried === undefined ? {} : { carriedRecordId: carried }),
    failedChecks: Object.freeze([]),
  });
};

export const ROSTER_TERMINAL_STATES = [
  "published",
  "published_with_unknowns",
  "unavailable",
  "failed",
  "quarantined",
] as const;
export type RosterTerminalState = (typeof ROSTER_TERMINAL_STATES)[number];
export type RosterOutcome = Readonly<{
  rosterItemId: string;
  status: RosterTerminalState;
  evidenceId?: string;
  errorCode?: PipelineErrorCode;
}>;

export type RosterCoverage = Readonly<{
  complete: boolean;
  missing: readonly string[];
  unexpected: readonly string[];
  duplicate: readonly string[];
}>;

export const evaluateRosterCoverage = (
  expectedRosterItemIds: readonly string[],
  outcomes: readonly RosterOutcome[],
): RosterCoverage => {
  const expected = uniqueSorted(expectedRosterItemIds, "roster item ID");
  if (expected.length === 0)
    return Object.freeze({
      complete: false,
      missing: Object.freeze([]),
      unexpected: Object.freeze([]),
      duplicate: Object.freeze([]),
    });
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    assertNonEmpty(outcome.rosterItemId, "roster outcome item ID");
    if (!ROSTER_TERMINAL_STATES.includes(outcome.status))
      throw new TypeError("roster outcome has an unknown runtime status");
    if (outcome.evidenceId === undefined)
      throw new TypeError("every roster outcome requires machine evidence");
    assertNonEmpty(outcome.evidenceId, "roster outcome evidence ID");
    if (outcome.status === "failed" || outcome.status === "quarantined") {
      if (outcome.errorCode === undefined)
        throw new TypeError(
          "failed and quarantined roster outcomes require an error code",
        );
      assertMachineCode(outcome.errorCode, "roster outcome error code");
    }
    counts.set(
      outcome.rosterItemId,
      (counts.get(outcome.rosterItemId) ?? 0) + 1,
    );
  }
  const duplicate = [...counts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  const missing = expected.filter((id) => !counts.has(id));
  const expectedSet = new Set(expected);
  const unexpected = [...counts.keys()]
    .filter((id) => !expectedSet.has(id))
    .sort();
  return Object.freeze({
    complete:
      missing.length === 0 && unexpected.length === 0 && duplicate.length === 0,
    missing: Object.freeze(missing),
    unexpected: Object.freeze(unexpected),
    duplicate: Object.freeze(duplicate),
  });
};

export type ProviderCompletion = Readonly<{
  providerId: string;
  adapterVersion: string;
  rosterVersion: string;
  sourceRegisterVersion: string;
  state: ProviderState;
  expectedRosterItemIds: readonly string[];
  rosterOutcomes: readonly RosterOutcome[];
  newSliceId?: string;
  lastKnownGoodSliceId?: string;
  cost: BudgetAmounts;
  errorCodes: readonly PipelineErrorCode[];
}>;

export type ProviderPublicationDecision = Readonly<{
  providerId: string;
  disposition: "new" | "carried_forward" | "unavailable";
  sliceId?: string;
}>;

export type RunCoordination = Readonly<{
  terminal: boolean;
  publishable: boolean;
  status: "running" | "succeeded" | "completed_with_provider_failures";
  providers: readonly ProviderPublicationDecision[];
}>;

/** Provider failure is isolated; nonterminal or incomplete roster state blocks parent success. */
export const coordinateRun = (
  expectedProviderIds: readonly string[],
  completions: readonly ProviderCompletion[],
): RunCoordination => {
  const expected = uniqueSorted(expectedProviderIds, "provider ID");
  const byProvider = new Map<string, ProviderCompletion>();
  for (const completion of completions) {
    if (byProvider.has(completion.providerId))
      throw new TypeError("provider completion is duplicated");
    byProvider.set(completion.providerId, completion);
  }
  if ([...byProvider.keys()].some((id) => !expected.includes(id)))
    throw new TypeError("provider completion is outside the run scope");
  const terminal = expected.every((providerId) => {
    const completion = byProvider.get(providerId);
    return (
      completion !== undefined &&
      evaluateRosterCoverage(
        completion.expectedRosterItemIds,
        completion.rosterOutcomes,
      ).complete &&
      (completion.state === "ready" ||
        completion.state === "failed" ||
        completion.state === "quarantined")
    );
  });
  if (!terminal)
    return Object.freeze({
      terminal: false,
      publishable: false,
      status: "running",
      providers: Object.freeze([]),
    });
  const providers = expected.map((providerId): ProviderPublicationDecision => {
    const completion = byProvider.get(providerId);
    if (completion === undefined)
      throw new TypeError("terminal coordination lost a provider completion");
    if (completion.state === "ready") {
      if (completion.newSliceId === undefined)
        throw new TypeError("ready provider has no new slice");
      return Object.freeze({
        providerId,
        disposition: "new",
        sliceId: completion.newSliceId,
      });
    }
    if (completion.lastKnownGoodSliceId !== undefined)
      return Object.freeze({
        providerId,
        disposition: "carried_forward",
        sliceId: completion.lastKnownGoodSliceId,
      });
    return Object.freeze({ providerId, disposition: "unavailable" });
  });
  const hasFailures = completions.some(
    (completion) => completion.state !== "ready",
  );
  const usableSlices = providers.filter(
    (provider) => provider.disposition !== "unavailable",
  ).length;
  return Object.freeze({
    terminal: true,
    publishable: usableSlices > 0,
    status: hasFailures ? "completed_with_provider_failures" : "succeeded",
    providers: Object.freeze(providers),
  });
};

export type RunReport = Readonly<{
  reportSchemaVersion: "1.0.0";
  occurrenceId: string;
  runId: string;
  runAttempt: number;
  codeVersion: string;
  schemaVersion: string;
  status: RunCoordination["status"];
  startedAt: string;
  endedAt: string;
  cost: BudgetAmounts;
  providers: readonly Readonly<{
    providerId: string;
    adapterVersion: string;
    rosterVersion: string;
    sourceRegisterVersion: string;
    state: ProviderState;
    rosterComplete: boolean;
    errorCodes: readonly PipelineErrorCode[];
    cost: BudgetAmounts;
  }>[];
}>;

/** Fixed projection: it cannot copy request, visitor, cookie, or arbitrary error payloads. */
export const buildRunReport = (input: {
  run: PipelineRun;
  completions: readonly ProviderCompletion[];
  endedAt: string;
}): RunReport => {
  const endedAt = new Date(
    instantMilliseconds(input.endedAt, "run end time"),
  ).toISOString();
  if (Date.parse(endedAt) < Date.parse(input.run.startedAt))
    throw new TypeError("run end precedes run start");
  const coordination = coordinateRun(
    input.run.providerScope,
    input.completions,
  );
  if (!coordination.terminal)
    throw new TypeError(
      "a final run report requires terminal provider outcomes",
    );
  const providers = [...input.completions]
    .sort((left, right) => left.providerId.localeCompare(right.providerId))
    .map((completion) => {
      validateBudgetAmounts(
        completion.cost,
        `${completion.providerId} report cost`,
      );
      assertNonEmpty(completion.adapterVersion, "adapter version");
      assertNonEmpty(completion.rosterVersion, "roster version");
      assertNonEmpty(
        completion.sourceRegisterVersion,
        "source register version",
      );
      for (const code of completion.errorCodes)
        assertMachineCode(code, "run report error code");
      return Object.freeze({
        providerId: completion.providerId,
        adapterVersion: completion.adapterVersion,
        rosterVersion: completion.rosterVersion,
        sourceRegisterVersion: completion.sourceRegisterVersion,
        state: completion.state,
        rosterComplete: evaluateRosterCoverage(
          completion.expectedRosterItemIds,
          completion.rosterOutcomes,
        ).complete,
        errorCodes: Object.freeze([...new Set(completion.errorCodes)].sort()),
        cost: Object.freeze({ ...completion.cost }),
      });
    });
  const cost = Object.fromEntries(
    BUDGET_FIELDS.map((field) => {
      const total = providers.reduce(
        (sum, provider) => sum + provider.cost[field],
        0,
      );
      if (!Number.isSafeInteger(total))
        throw new RangeError(
          `run report ${field} total overflows a safe integer`,
        );
      return [field, total];
    }),
  ) as Record<BudgetField, number>;
  return Object.freeze({
    reportSchemaVersion: "1.0.0",
    occurrenceId: input.run.occurrenceId,
    runId: input.run.runId,
    runAttempt: input.run.attemptNumber,
    codeVersion: input.run.codeVersion,
    schemaVersion: input.run.schemaVersion,
    status: coordination.status,
    startedAt: input.run.startedAt,
    endedAt,
    cost: Object.freeze(cost),
    providers: Object.freeze(providers),
  });
};

export type CanonicalWriteBatch = Readonly<{
  writer: WriterIdentity;
  runId: string;
  providerSliceKey: string;
  providerId: string;
  offerings: readonly Readonly<{ offeringId: string; providerId: string }>[];
  observations: readonly Readonly<{
    observationId: string;
    runId: string;
    providerId: string;
  }>[];
  evidence: readonly Readonly<{ evidenceId: string; observationId: string }>[];
  facts: readonly Readonly<{
    factId: string;
    subjectId: string;
    fieldName: string;
    scopeId: string;
    offeringId: string;
    observationId: string;
    evidenceId: string;
    supersedesFactId?: string;
  }>[];
}>;

export type CanonicalWriteAdmission = Readonly<{
  admitted: boolean;
  idempotencyKeys: readonly string[];
  errors: readonly string[];
}>;

/**
 * BE-003–BE-006 application guard before the canonical D1 transaction.
 * The D1 schema remains authoritative for version, source, evidence, roster,
 * typed-scope, and foreign-key constraints.
 */
export const admitCanonicalWrite = (
  batch: CanonicalWriteBatch,
  priorFacts: readonly CanonicalWriteBatch["facts"][number][] = [],
): CanonicalWriteAdmission => {
  assertControlledWriter(batch.writer);
  assertNonEmpty(batch.providerSliceKey, "provider slice key");
  const errors: string[] = [];
  const offerings = new Map(
    batch.offerings.map((row) => [row.offeringId, row]),
  );
  const observations = new Map(
    batch.observations.map((row) => [row.observationId, row]),
  );
  const evidence = new Map(batch.evidence.map((row) => [row.evidenceId, row]));
  for (const [label, rows, ids] of [
    ["offering", batch.offerings, batch.offerings.map((row) => row.offeringId)],
    [
      "observation",
      batch.observations,
      batch.observations.map((row) => row.observationId),
    ],
    ["evidence", batch.evidence, batch.evidence.map((row) => row.evidenceId)],
    ["fact", batch.facts, batch.facts.map((row) => row.factId)],
  ] as const) {
    if (new Set(ids).size !== rows.length)
      errors.push(`duplicate_${label}_identity`);
  }
  for (const offering of batch.offerings)
    if (offering.providerId !== batch.providerId)
      errors.push(`offering_provider_mismatch:${offering.offeringId}`);
  for (const observation of batch.observations)
    if (
      observation.runId !== batch.runId ||
      observation.providerId !== batch.providerId
    )
      errors.push(`observation_scope_mismatch:${observation.observationId}`);
  for (const item of batch.evidence)
    if (!observations.has(item.observationId))
      errors.push(`orphan_evidence:${item.evidenceId}`);
  const priorFactsById = new Map(priorFacts.map((fact) => [fact.factId, fact]));
  const allFacts = new Map(
    [...priorFacts, ...batch.facts].map((fact) => [fact.factId, fact]),
  );
  const superseded = new Set(
    priorFacts.flatMap((fact) =>
      fact.supersedesFactId === undefined ? [] : [fact.supersedesFactId],
    ),
  );
  const newSupersession = new Map(
    batch.facts.flatMap((fact) =>
      fact.supersedesFactId === undefined
        ? []
        : ([[fact.factId, fact.supersedesFactId]] as const),
    ),
  );
  for (const fact of batch.facts) {
    const visited = new Set<string>();
    let cursor: string | undefined = fact.factId;
    while (cursor !== undefined) {
      if (visited.has(cursor)) {
        errors.push(`supersession_cycle:${fact.factId}`);
        break;
      }
      visited.add(cursor);
      cursor = newSupersession.get(cursor);
    }
  }
  for (const fact of batch.facts) {
    const identityCollision = priorFactsById.get(fact.factId);
    if (
      identityCollision !== undefined &&
      JSON.stringify(identityCollision) !== JSON.stringify(fact)
    )
      errors.push(`fact_identity_conflict:${fact.factId}`);
    if (!offerings.has(fact.offeringId))
      errors.push(`orphan_fact_offering:${fact.factId}`);
    const item = evidence.get(fact.evidenceId);
    if (
      item?.observationId !== fact.observationId ||
      !observations.has(fact.observationId)
    )
      errors.push(`fact_evidence_mismatch:${fact.factId}`);
    if (fact.supersedesFactId !== undefined) {
      const prior = allFacts.get(fact.supersedesFactId);
      if (prior === undefined)
        errors.push(`missing_superseded_fact:${fact.factId}`);
      else if (
        prior.subjectId !== fact.subjectId ||
        prior.fieldName !== fact.fieldName ||
        prior.scopeId !== fact.scopeId ||
        prior.offeringId !== fact.offeringId
      )
        errors.push(`supersession_scope_mismatch:${fact.factId}`);
      if (superseded.has(fact.supersedesFactId))
        errors.push(`fact_already_superseded:${fact.factId}`);
      superseded.add(fact.supersedesFactId);
    }
  }
  const idempotencyKeys = [
    ...batch.offerings.map((row) =>
      deterministicKey("canonical-offering", [
        batch.providerSliceKey,
        row.offeringId,
      ]),
    ),
    ...batch.observations.map((row) =>
      deterministicKey("canonical-observation", [
        batch.providerSliceKey,
        row.observationId,
      ]),
    ),
    ...batch.evidence.map((row) =>
      deterministicKey("canonical-evidence", [
        batch.providerSliceKey,
        row.evidenceId,
      ]),
    ),
    ...batch.facts.map((row) =>
      deterministicKey("canonical-fact", [
        batch.providerSliceKey,
        row.offeringId,
        row.subjectId,
        row.fieldName,
        row.scopeId,
        row.factId,
      ]),
    ),
  ].sort();
  return Object.freeze({
    admitted: errors.length === 0,
    idempotencyKeys: Object.freeze(idempotencyKeys),
    errors: Object.freeze([...new Set(errors)].sort()),
  });
};
