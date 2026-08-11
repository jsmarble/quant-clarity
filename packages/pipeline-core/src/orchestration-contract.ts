/**
 * Phase 7.2-C runtime-neutral orchestration decisions.
 *
 * This module performs no I/O and intentionally cannot carry request, visitor,
 * source-response, credential, or arbitrary error data into durable records.
 */

import {
  BUDGET_FIELDS,
  sha256AsciiDigest,
  type BudgetAmounts,
} from "./index.js";

export const ORCHESTRATION_POLICY_ROLES = [
  "provider_retry",
  "run_budget",
  "terminal_deadline",
] as const;
export type OrchestrationPolicyRole =
  (typeof ORCHESTRATION_POLICY_ROLES)[number];

export const PUBLICATION_SCHEDULE_EXPRESSION = "0 5 * * 1,4" as const;
export const PUBLICATION_SCHEDULE_NAME = "provider-refresh-v1" as const;
export const PUBLICATION_WORKFLOW_NAMES = Object.freeze({
  preview: "quant-clarity-publication-preview",
  production: "quant-clarity-publication-production",
});

const RUN_PLAN_ID_PATTERN =
  /^rpl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OCCURRENCE_ID_PATTERN =
  /^occ_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RUN_ID_PATTERN =
  /^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROVIDER_ID_PATTERN =
  /^prv_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROVIDER_SLICE_ID_PATTERN =
  /^prn_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PUBLICATION_ID_PATTERN =
  /^pub_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODE_VERSION_PATTERN = /^git:[0-9a-f]{6,64}$/;

export type RunBudgetPolicyV1 = Readonly<{
  schema: "run-budget@1";
  maximumProviders: 16;
  maximumRunCeilings: Readonly<{
    requests: 10_000;
    bytes: 750_000_000;
    aiTokens: 1_000_000;
    browserMilliseconds: 7_200_000;
    elapsedMilliseconds: 172_800_000;
    costMicrousd: 25_000_000;
  }>;
  monthlyPlatformCostCeilingMicrousd: 25_000_000;
  alertPercents: readonly [50, 75];
  expensiveWorkBreakerPercent: 100;
  providerCeilingAggregation: "sum";
  overflowAction: "reject_firing";
}>;

export type ProviderRetryPolicyV1 = Readonly<{
  schema: "provider-retry@1";
  maximumTotalAttempts: 4;
  baseDelayMs: 1_000;
  maximumBackoffMs: 8_000;
  providerMinimumDelayMs: 500;
  maximumRetryAfterMs: 300_000;
  permanentErrorAction: "quarantine_provider";
}>;

export type TerminalDeadlinePolicyV1 = Readonly<{
  schema: "terminal-deadline@1";
  anchor: "scheduled_at";
  durationMs: 43_200_000;
  elapsedAction: "block_publication";
}>;

export type OrchestrationPolicy =
  RunBudgetPolicyV1 | ProviderRetryPolicyV1 | TerminalDeadlinePolicyV1;

export type PolicyReference = Readonly<{
  role: OrchestrationPolicyRole;
  version: string;
  contentHash: string;
}>;

type PolicyRegistryEntry = Readonly<{
  role: OrchestrationPolicyRole;
  version: string;
  contentHash: string;
  policy: OrchestrationPolicy;
}>;

const assertPlainRecord: (
  value: unknown,
  label: string,
) => asserts value is Readonly<Record<string, unknown>> = (value, label) => {
  if (typeof value !== "object" || value === null)
    throw new TypeError(`${label} must be a plain record`);
  let arrayValue: boolean;
  let prototype: object | null;
  try {
    arrayValue = Array.isArray(value);
    prototype = Reflect.getPrototypeOf(value);
  } catch {
    throw new TypeError(`${label} must be a plain record`);
  }
  if (arrayValue || (prototype !== Object.prototype && prototype !== null))
    throw new TypeError(`${label} must be a plain record`);
};

const assertExactRecord: (
  value: unknown,
  keys: readonly string[],
  label: string,
) => asserts value is Readonly<Record<string, unknown>> = (
  value,
  keys,
  label,
) => {
  assertPlainRecord(value, label);
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError(`${label} does not have the exact closed fields`);
  }
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    ownKeys.length !== keys.length ||
    keys.some((key) => !ownKeys.includes(key))
  )
    throw new TypeError(`${label} does not have the exact closed fields`);
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`${label} contains a non-data field`);
    }
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    )
      throw new TypeError(`${label} contains a non-data field`);
  }
};

const assertCanonicalId = (
  value: string,
  pattern: RegExp,
  label: string,
): void => {
  if (!pattern.test(value))
    throw new TypeError(`${label} is not a canonical identifier`);
};

interface CanonicalRecord {
  readonly [key: string]: CanonicalValue;
}

type CanonicalArray = readonly CanonicalValue[];

type CanonicalValue =
  null | string | boolean | number | CanonicalArray | CanonicalRecord;

type UnknownDataDescriptor = Readonly<{
  configurable?: boolean;
  enumerable?: boolean;
  value: unknown;
  writable?: boolean;
}>;

const asDataDescriptor = (
  descriptor: PropertyDescriptor | undefined,
): UnknownDataDescriptor | undefined =>
  descriptor !== undefined &&
  Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? (descriptor as UnknownDataDescriptor)
    : undefined;

const canonicalArrayError = (): TypeError =>
  new TypeError("canonical arrays must contain only dense data items");

const canonicalRecordError = (): TypeError =>
  new TypeError(
    "canonical records must contain only own enumerable data fields",
  );

const MAX_CANONICAL_ARRAY_ITEMS = 1_024;

/**
 * Takes one descriptor-only snapshot of an untrusted canonical value. The
 * resulting graph contains no accessors or proxies and is deeply frozen, so a
 * later validation/encoding pass cannot observe different field values.
 */
const projectCanonicalValue = (value: unknown): CanonicalValue => {
  if (value === null) return null;
  if (typeof value === "string") {
    if (!/^[\x20-\x7e]*$/.test(value))
      throw new TypeError(
        "canonical strings must contain printable ASCII only",
      );
    return value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new TypeError("canonical numbers must be safe integers");
    return value;
  }
  if (typeof value !== "object")
    throw new TypeError("canonical values must be JSON data values");
  let arrayValue: boolean;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    throw canonicalArrayError();
  }
  if (arrayValue) {
    let prototype: object | null;
    let lengthDescriptor: PropertyDescriptor | undefined;
    let ownKeys: readonly PropertyKey[];
    try {
      prototype = Reflect.getPrototypeOf(value);
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      ownKeys = Reflect.ownKeys(value);
    } catch {
      throw canonicalArrayError();
    }
    const lengthDataDescriptor = asDataDescriptor(lengthDescriptor);
    const lengthValue = lengthDataDescriptor?.value;
    if (
      prototype !== Array.prototype ||
      lengthDataDescriptor === undefined ||
      !Number.isSafeInteger(lengthValue) ||
      (lengthValue as number) < 0 ||
      lengthDataDescriptor.enumerable
    )
      throw canonicalArrayError();
    const length = lengthValue as number;
    if (
      length > MAX_CANONICAL_ARRAY_ITEMS ||
      ownKeys.length !== length + 1 ||
      ownKeys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" &&
            (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)),
      )
    )
      throw canonicalArrayError();
    const snapshot: CanonicalValue[] = [];
    for (let index = 0; index < length; index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      } catch {
        throw canonicalArrayError();
      }
      const dataDescriptor = asDataDescriptor(descriptor);
      if (!dataDescriptor?.enumerable) throw canonicalArrayError();
      snapshot.push(projectCanonicalValue(dataDescriptor.value));
    }
    return Object.freeze(snapshot);
  }
  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
  } catch {
    throw canonicalRecordError();
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.some((key) => typeof key !== "string")
  )
    throw canonicalRecordError();
  const snapshot: Record<string, CanonicalValue> = {};
  const stringKeys = ownKeys.filter(
    (key): key is string => typeof key === "string",
  );
  for (const key of [...stringKeys].sort()) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw canonicalRecordError();
    }
    const dataDescriptor = asDataDescriptor(descriptor);
    if (dataDescriptor?.enumerable !== true) throw canonicalRecordError();
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: projectCanonicalValue(dataDescriptor.value),
      writable: false,
    });
  }
  return Object.freeze(snapshot);
};

const encodeCanonicalProjection = (value: CanonicalValue): string => {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (
    (Array.isArray as (candidate: unknown) => candidate is CanonicalArray)(
      value,
    )
  )
    return `[${value.map((item) => encodeCanonicalProjection(item)).join(",")}]`;
  const record = value;
  return `{${Object.keys(record)
    .sort()
    .map((key) => {
      const item = record[key];
      if (item === undefined) throw canonicalRecordError();
      return `${encodeCanonicalProjection(key)}:${encodeCanonicalProjection(item)}`;
    })
    .join(",")}}`;
};

const canonicalJson = (value: unknown): string =>
  encodeCanonicalProjection(projectCanonicalValue(value));

export const policyContentHash = (policy: OrchestrationPolicy): string => {
  const projection = projectCanonicalValue(policy);
  assertPlainRecord(projection, "orchestration policy");
  return sha256AsciiDigest(
    canonicalJson({
      domain: "quantclarity:orchestration-policy@1",
      schema: projection.schema,
      policy: projection,
    }),
  );
};

export const publicationPlanProviderScopeHash = (
  providerIds: readonly string[],
): string =>
  sha256AsciiDigest(
    canonicalJson({
      domain: "publication-run-plan-provider-scope@1",
      provider_ids: providerIds,
    }),
  );

const register = (
  role: OrchestrationPolicyRole,
  version: string,
  policy: OrchestrationPolicy,
): PolicyRegistryEntry => {
  const frozen = Object.freeze(policy);
  return Object.freeze({
    role,
    version,
    contentHash: policyContentHash(frozen),
    policy: frozen,
  });
};

const RUN_BUDGET_POLICY = Object.freeze<RunBudgetPolicyV1>({
  schema: "run-budget@1",
  maximumProviders: 16,
  maximumRunCeilings: Object.freeze({
    requests: 10_000,
    bytes: 750_000_000,
    aiTokens: 1_000_000,
    browserMilliseconds: 7_200_000,
    elapsedMilliseconds: 172_800_000,
    costMicrousd: 25_000_000,
  }),
  monthlyPlatformCostCeilingMicrousd: 25_000_000,
  alertPercents: Object.freeze([50, 75]),
  expensiveWorkBreakerPercent: 100,
  providerCeilingAggregation: "sum",
  overflowAction: "reject_firing",
});

const PROVIDER_RETRY_POLICY = Object.freeze<ProviderRetryPolicyV1>({
  schema: "provider-retry@1",
  maximumTotalAttempts: 4,
  baseDelayMs: 1_000,
  maximumBackoffMs: 8_000,
  providerMinimumDelayMs: 500,
  maximumRetryAfterMs: 300_000,
  permanentErrorAction: "quarantine_provider",
});

const TERMINAL_DEADLINE_POLICY = Object.freeze<TerminalDeadlinePolicyV1>({
  schema: "terminal-deadline@1",
  anchor: "scheduled_at",
  durationMs: 43_200_000,
  elapsedAction: "block_publication",
});

export const ORCHESTRATION_POLICY_REGISTRY = Object.freeze({
  provider_retry: register("provider_retry", "retry@1", PROVIDER_RETRY_POLICY),
  run_budget: register("run_budget", "budget@1", RUN_BUDGET_POLICY),
  terminal_deadline: register(
    "terminal_deadline",
    "deadline@1",
    TERMINAL_DEADLINE_POLICY,
  ),
});

const REGISTERED_POLICY_REFERENCES = Object.freeze(
  ORCHESTRATION_POLICY_ROLES.map((role) => {
    const { version, contentHash } = ORCHESTRATION_POLICY_REGISTRY[role];
    return Object.freeze({ role, version, contentHash });
  }),
);

export type ResolvedOrchestrationPolicies = Readonly<{
  runBudget: RunBudgetPolicyV1;
  providerRetry: ProviderRetryPolicyV1;
  terminalDeadline: TerminalDeadlinePolicyV1;
  references: readonly PolicyReference[];
  policySetHash: string;
}>;

const isPolicyRole = (value: string): value is OrchestrationPolicyRole =>
  ORCHESTRATION_POLICY_ROLES.includes(value as OrchestrationPolicyRole);

/** Exact-set lookup: no fallback, latest selection, or caller-defined policy. */
export const resolveOrchestrationPolicies = (
  references: readonly Readonly<{
    role: string;
    version: string;
    contentHash: string;
  }>[],
): ResolvedOrchestrationPolicies => {
  if (references.length !== ORCHESTRATION_POLICY_ROLES.length)
    throw new TypeError("policy reference set is not exact");
  const byRole = new Map<OrchestrationPolicyRole, PolicyReference>();
  for (const [index, reference] of references.entries()) {
    assertExactRecord(
      reference,
      ["role", "version", "contentHash"],
      "policy reference",
    );
    if (!isPolicyRole(reference.role))
      throw new TypeError("policy reference contains an unknown role");
    if (reference.role !== ORCHESTRATION_POLICY_ROLES[index])
      throw new TypeError("policy references are not in canonical role order");
    if (byRole.has(reference.role))
      throw new TypeError("policy reference contains a duplicate role");
    const registered = ORCHESTRATION_POLICY_REGISTRY[reference.role];
    if (
      reference.version !== registered.version ||
      reference.contentHash !== registered.contentHash
    )
      throw new TypeError(
        "policy reference does not match the closed registry",
      );
    byRole.set(
      reference.role,
      Object.freeze({
        role: reference.role,
        version: reference.version,
        contentHash: reference.contentHash,
      }),
    );
  }
  const sorted = ORCHESTRATION_POLICY_ROLES.map((role) => {
    const reference = byRole.get(role);
    if (reference === undefined)
      throw new TypeError("policy reference set is incomplete");
    return reference;
  });
  return Object.freeze({
    runBudget: RUN_BUDGET_POLICY,
    providerRetry: PROVIDER_RETRY_POLICY,
    terminalDeadline: TERMINAL_DEADLINE_POLICY,
    references: Object.freeze(sorted),
    policySetHash: sha256AsciiDigest(
      JSON.stringify({
        domain: "publication-run-plan-policy-set@1",
        policies: sorted.map((reference) => ({
          policy_role: reference.role,
          policy_version: reference.version,
          content_hash: reference.contentHash,
        })),
      }),
    ),
  });
};

const canonicalInstant = (value: string, label: string): string => {
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    new Date(milliseconds).toISOString() !== value
  )
    throw new TypeError(`${label} must be a canonical nonnegative UTC instant`);
  return value;
};

const assertHash = (value: string, label: string): void => {
  if (!/^sha256:[0-9a-f]{64}$/.test(value))
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
};

const assertPrintableAscii = (
  value: string,
  minimum: number,
  maximum: number,
  label: string,
): void => {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    !/^[\x20-\x7e]+$/.test(value)
  )
    throw new TypeError(`${label} must be bounded printable ASCII`);
};

const assertEnvironment: (
  value: string,
) => asserts value is "preview" | "production" = (value) => {
  if (value !== "preview" && value !== "production")
    throw new TypeError("environment is unsupported");
};

export const terminalDeadlineAt = (
  scheduledAt: string,
  policy: Readonly<{
    schema: string;
    anchor: string;
    durationMs: number;
    elapsedAction: string;
  }> = TERMINAL_DEADLINE_POLICY,
): string => {
  if (
    policy.schema !== "terminal-deadline@1" ||
    policy.anchor !== "scheduled_at" ||
    policy.durationMs !== 43_200_000 ||
    policy.elapsedAction !== "block_publication"
  )
    throw new TypeError("terminal deadline policy is not registered");
  const scheduled = Date.parse(canonicalInstant(scheduledAt, "scheduled time"));
  const deadline = scheduled + policy.durationMs;
  if (!Number.isSafeInteger(deadline))
    throw new RangeError("terminal deadline overflows its supported range");
  return new Date(deadline).toISOString();
};

export type RegisteredRetryDecision =
  | Readonly<{ action: "retry"; delayMs: number; retryAt: string }>
  | Readonly<{
      action: "failed" | "quarantine";
      reason:
        | "attempts_exhausted"
        | "terminal_deadline_elapsed"
        | "retry_after_exceeds_policy"
        | "permanent_error";
    }>;

const retryAfterDelay = (value: string | undefined, nowMs: number): number => {
  if (value === undefined) return 0;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds)
      ? seconds * 1_000
      : Number.POSITIVE_INFINITY;
  }
  const target = Date.parse(value);
  if (!Number.isFinite(target)) throw new TypeError("Retry-After is invalid");
  return Math.max(0, target - nowMs);
};

/** Registered retry policy plus the immutable run terminal deadline. */
export const decideRegisteredProviderRetry = (input: {
  policy: ProviderRetryPolicyV1;
  completedAttempt: number;
  errorKind: "transient" | "rate_limited" | "permanent";
  now: string;
  terminalDeadlineAt: string;
  retryAfter?: string;
}): RegisteredRetryDecision => {
  if (
    policyContentHash(input.policy) !== policyContentHash(PROVIDER_RETRY_POLICY)
  )
    throw new TypeError("provider retry policy is not registered");
  if (
    !Number.isSafeInteger(input.completedAttempt) ||
    input.completedAttempt < 1
  )
    throw new RangeError(
      "completed retry attempt is outside its supported range",
    );
  const errorKind: unknown = input.errorKind;
  if (
    errorKind !== "transient" &&
    errorKind !== "rate_limited" &&
    errorKind !== "permanent"
  )
    throw new TypeError("provider retry error kind is invalid");
  const nowMs = Date.parse(canonicalInstant(input.now, "retry decision time"));
  const deadlineMs = Date.parse(
    canonicalInstant(input.terminalDeadlineAt, "terminal deadline"),
  );
  if (nowMs >= deadlineMs)
    return Object.freeze({
      action: "failed",
      reason: "terminal_deadline_elapsed",
    });
  if (input.errorKind === "permanent")
    return Object.freeze({ action: "quarantine", reason: "permanent_error" });
  if (input.completedAttempt >= input.policy.maximumTotalAttempts)
    return Object.freeze({ action: "failed", reason: "attempts_exhausted" });
  const retryAfterMs = retryAfterDelay(input.retryAfter, nowMs);
  if (retryAfterMs > input.policy.maximumRetryAfterMs)
    return Object.freeze({
      action: "failed",
      reason: "retry_after_exceeds_policy",
    });
  const backoff = Math.min(
    input.policy.maximumBackoffMs,
    input.policy.baseDelayMs * 2 ** Math.min(input.completedAttempt - 1, 52),
  );
  const delayMs = Math.max(
    backoff,
    input.policy.providerMinimumDelayMs,
    retryAfterMs,
  );
  if (!Number.isSafeInteger(delayMs) || nowMs + delayMs >= deadlineMs)
    return Object.freeze({
      action: "failed",
      reason: "terminal_deadline_elapsed",
    });
  return Object.freeze({
    action: "retry",
    delayMs,
    retryAt: new Date(nowMs + delayMs).toISOString(),
  });
};

export const ADMISSION_REJECTION_CODES = [
  "event_not_scheduled",
  "event_payload_not_empty",
  "workflow_name_mismatch",
  "schedule_mismatch",
  "scheduled_time_invalid",
  "scheduled_time_in_future",
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
] as const;
export type AdmissionRejectionCode = (typeof ADMISSION_REJECTION_CODES)[number];

/**
 * Only failures reached after the exact platform envelope has been admitted
 * are durable admission receipts. Envelope/workflow/cron/time-shape failures
 * stop before D1 and cannot manufacture an occurrence record.
 */
export const DURABLE_ADMISSION_REJECTION_CODES = [
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
] as const satisfies readonly AdmissionRejectionCode[];
export type DurableAdmissionRejectionCode =
  (typeof DURABLE_ADMISSION_REJECTION_CODES)[number];

export type AuthorizedPlanProviderV1 = Readonly<{
  ordinal: number;
  providerId: string;
  adapterVersion: string;
  rosterVersion: string;
  rosterContentHash: string;
  sourceRegisterVersion: string;
  sourceRegisterArtifactHash: string;
  requestCeiling: number;
  byteCeiling: number;
  aiTokenCeiling: number;
  browserMillisecondCeiling: number;
  elapsedMillisecondCeiling: number;
  costMicrousdCeiling: number;
  retryPolicyHash: string;
}>;

export type PlanAdmissionState =
  | Readonly<{
      state:
        | "unavailable"
        | "invalid"
        | "not_effective"
        | "revoked"
        | "source_authority_invalid"
        | "runtime_version_mismatch";
    }>
  | Readonly<{
      state: "authorized";
      contractVersion: "publication-run-plan@1";
      runPlanId: string;
      planHash: string;
      environment: "preview" | "production";
      scheduleName: string;
      scheduleExpression: string;
      effectiveFrom: string;
      effectiveTo: string;
      scheduledAt: string;
      canonicalSchemaVersion: string;
      pipelineContractVersion: string;
      providerScopeHash: string;
      policySetHash: string;
      providers: readonly AuthorizedPlanProviderV1[];
      policies: readonly PolicyReference[];
      approval: Readonly<{
        artifactPath: string;
        artifactHash: string;
        approvedAt: string;
        approverRoles: readonly [
          "legal_source_owner",
          "platform_owner",
          "product_owner",
        ];
      }>;
    }>;

export type NonVisitorBudgetState = Readonly<{
  monthlyUsedCostMicrousd: number;
  monthlyReservedCostMicrousd: number;
  expensiveWorkBreakerTripped: boolean;
}>;

export type RunBudgetAdmissionDecision =
  | Readonly<{
      admitted: false;
      reason: "budget_exceeded" | "expensive_work_breaker";
    }>
  | Readonly<{
      admitted: true;
      runCeilings: BudgetAmounts;
      projectedMonthlyCostMicrousd: number;
      alertPercent: 50 | 75 | null;
      providerScope: readonly string[];
    }>;

const PLAN_PROVIDER_FIELDS = [
  "ordinal",
  "providerId",
  "adapterVersion",
  "rosterVersion",
  "rosterContentHash",
  "sourceRegisterVersion",
  "sourceRegisterArtifactHash",
  "requestCeiling",
  "byteCeiling",
  "aiTokenCeiling",
  "browserMillisecondCeiling",
  "elapsedMillisecondCeiling",
  "costMicrousdCeiling",
  "retryPolicyHash",
] as const;

const providerBudget = (provider: AuthorizedPlanProviderV1): BudgetAmounts => ({
  requests: provider.requestCeiling,
  bytes: provider.byteCeiling,
  aiTokens: provider.aiTokenCeiling,
  browserMilliseconds: provider.browserMillisecondCeiling,
  elapsedMilliseconds: provider.elapsedMillisecondCeiling,
  costMicrousd: provider.costMicrousdCeiling,
});

export const decideRunBudgetAdmission = (input: {
  policy: RunBudgetPolicyV1;
  providers: readonly AuthorizedPlanProviderV1[];
  state: NonVisitorBudgetState;
}): RunBudgetAdmissionDecision => {
  if (policyContentHash(input.policy) !== policyContentHash(RUN_BUDGET_POLICY))
    throw new TypeError("run budget policy is not registered");
  assertExactRecord(
    input.state,
    [
      "monthlyUsedCostMicrousd",
      "monthlyReservedCostMicrousd",
      "expensiveWorkBreakerTripped",
    ],
    "non-visitor budget state",
  );
  if (
    !Number.isSafeInteger(input.state.monthlyUsedCostMicrousd) ||
    input.state.monthlyUsedCostMicrousd < 0 ||
    !Number.isSafeInteger(input.state.monthlyReservedCostMicrousd) ||
    input.state.monthlyReservedCostMicrousd < 0 ||
    typeof input.state.expensiveWorkBreakerTripped !== "boolean"
  )
    throw new TypeError("non-visitor budget state is invalid");
  if (
    input.providers.length < 1 ||
    input.providers.length > input.policy.maximumProviders
  )
    throw new RangeError(
      "run plan Provider scope is outside its supported range",
    );
  const totals = Object.fromEntries(
    BUDGET_FIELDS.map((field) => [field, 0]),
  ) as Record<(typeof BUDGET_FIELDS)[number], number>;
  const providerScope: string[] = [];
  for (const [index, provider] of input.providers.entries()) {
    assertExactRecord(provider, PLAN_PROVIDER_FIELDS, "run plan Provider");
    if (provider.ordinal !== index)
      throw new TypeError("run plan Provider ordinal is not canonical");
    assertCanonicalId(provider.providerId, PROVIDER_ID_PATTERN, "Provider ID");
    if (
      index > 0 &&
      (providerScope[index - 1] ?? "").localeCompare(provider.providerId) >= 0
    )
      throw new TypeError("run plan Provider scope is not strictly sorted");
    for (const [value, label] of [
      [provider.adapterVersion, "adapter version"],
      [provider.rosterVersion, "roster version"],
      [provider.sourceRegisterVersion, "source-register version"],
    ] as const)
      assertPrintableAscii(value, 1, 128, label);
    for (const [value, label] of [
      [provider.rosterContentHash, "roster content hash"],
      [provider.sourceRegisterArtifactHash, "source artifact hash"],
      [provider.retryPolicyHash, "Provider retry hash"],
    ] as const)
      assertHash(value, label);
    if (
      provider.retryPolicyHash !==
      ORCHESTRATION_POLICY_REGISTRY.provider_retry.contentHash
    )
      throw new TypeError("run plan Provider retry policy is not registered");
    const amounts = providerBudget(provider);
    for (const field of BUDGET_FIELDS) {
      const amount = amounts[field];
      if (!Number.isSafeInteger(amount) || amount < 0)
        throw new RangeError(`run plan Provider ${field} ceiling is invalid`);
      const total = totals[field] + amount;
      if (!Number.isSafeInteger(total))
        throw new RangeError(`summed run ${field} ceiling overflows`);
      totals[field] = total;
    }
    providerScope.push(provider.providerId);
  }
  if (input.state.expensiveWorkBreakerTripped)
    return Object.freeze({
      admitted: false,
      reason: "expensive_work_breaker",
    });
  if (
    BUDGET_FIELDS.some(
      (field) => totals[field] > input.policy.maximumRunCeilings[field],
    )
  )
    return Object.freeze({ admitted: false, reason: "budget_exceeded" });
  const projectedMonthlyCostMicrousd =
    input.state.monthlyUsedCostMicrousd +
    input.state.monthlyReservedCostMicrousd +
    totals.costMicrousd;
  if (
    !Number.isSafeInteger(projectedMonthlyCostMicrousd) ||
    projectedMonthlyCostMicrousd >
      input.policy.monthlyPlatformCostCeilingMicrousd
  )
    return Object.freeze({ admitted: false, reason: "budget_exceeded" });
  const percentage =
    (projectedMonthlyCostMicrousd /
      input.policy.monthlyPlatformCostCeilingMicrousd) *
    100;
  const alertPercent =
    percentage >= input.policy.alertPercents[1]
      ? input.policy.alertPercents[1]
      : percentage >= input.policy.alertPercents[0]
        ? input.policy.alertPercents[0]
        : null;
  return Object.freeze({
    admitted: true,
    runCeilings: Object.freeze(totals),
    projectedMonthlyCostMicrousd,
    alertPercent,
    providerScope: Object.freeze(providerScope),
  });
};

export type FiringAdmissionDecision =
  | Readonly<{
      decision: "rejected";
      runAction: "none";
      reason: AdmissionRejectionCode;
    }>
  | Readonly<{
      decision: "admitted";
      runAction: "create_or_reconcile_attempt_1";
      attemptNumber: 1;
      scheduledAt: string;
      terminalDeadlineAt: string;
      runPlanId: string;
      runPlanHash: string;
      environment: "preview" | "production";
      canonicalSchemaVersion: string;
      pipelineContractVersion: string;
      policySetHash: string;
      providerScope: readonly string[];
      providers: readonly AuthorizedPlanProviderV1[];
      runCeilings: BudgetAmounts;
      projectedMonthlyCostMicrousd: number;
      budgetAlertPercent: 50 | 75 | null;
      policies: ResolvedOrchestrationPolicies;
    }>;

export type AdmittedFiringDecision = Extract<
  FiringAdmissionDecision,
  Readonly<{ decision: "admitted" }>
>;
export type RejectedFiringDecision = Extract<
  FiringAdmissionDecision,
  Readonly<{ decision: "rejected" }>
>;

export type RejectedFiringAuthorityContext = Readonly<{
  scheduleName: string;
  scheduleExpression: string;
  scheduledAt: string;
  observedAt: string;
  requestedPlan: Readonly<{
    runPlanId: string;
    runPlanHash: string;
    environment: "preview" | "production";
  }>;
}>;

const trustedRejectedFiringDecisions = new WeakMap<
  object,
  RejectedFiringAuthorityContext
>();

const rejectFiring = (
  reason: AdmissionRejectionCode,
  authority?: RejectedFiringAuthorityContext,
): RejectedFiringDecision => {
  const decision = Object.freeze({
    decision: "rejected" as const,
    runAction: "none" as const,
    reason,
  });
  if (authority !== undefined)
    trustedRejectedFiringDecisions.set(decision, authority);
  return decision;
};

/**
 * Nominal admission authority for durable rejection persistence. Structural
 * report verification cannot prove that a rejection reason was actually
 * produced by the closed admission oracle.
 */
export const verifyRejectedFiringDecision = (
  value: unknown,
  expected?: RejectedFiringAuthorityContext,
): value is RejectedFiringDecision => {
  if (typeof value !== "object" || value === null) return false;
  const authority = trustedRejectedFiringDecisions.get(value);
  if (authority === undefined) return false;
  if (expected === undefined) return true;
  try {
    return canonicalJson(authority) === canonicalJson(expected);
  } catch {
    return false;
  }
};

/**
 * Closed admission oracle. Rejections never manufacture an occurrence/run and
 * never echo event, plan, database, or visitor-controlled values.
 */
export const decideFiringAdmission = (input: {
  event: Readonly<{
    kind: string;
    workflowName: string;
    scheduleExpression: string;
    scheduledAt: string;
    payload: unknown;
  }>;
  protectedContext: Readonly<{
    workflowName: string;
    scheduleName: string;
    scheduleExpression: string;
    environment: "preview" | "production";
    runPlanId: string;
    runPlanHash: string;
    canonicalSchemaVersion: string;
    pipelineContractVersion: string;
  }>;
  plan: PlanAdmissionState;
  budgetState: NonVisitorBudgetState;
  now: string;
}): FiringAdmissionDecision => {
  if (input.event.kind !== "scheduled")
    return rejectFiring("event_not_scheduled");
  try {
    if (input.event.payload !== undefined && input.event.payload !== null)
      assertExactRecord(input.event.payload, [], "event payload");
  } catch {
    return rejectFiring("event_payload_not_empty");
  }
  if (
    input.protectedContext.scheduleName !== PUBLICATION_SCHEDULE_NAME ||
    input.protectedContext.scheduleExpression !==
      PUBLICATION_SCHEDULE_EXPRESSION ||
    input.protectedContext.workflowName !==
      PUBLICATION_WORKFLOW_NAMES[input.protectedContext.environment]
  )
    return rejectFiring("plan_context_mismatch");
  if (input.event.workflowName !== input.protectedContext.workflowName)
    return rejectFiring("workflow_name_mismatch");
  if (
    input.event.scheduleExpression !== input.protectedContext.scheduleExpression
  )
    return rejectFiring("schedule_mismatch");
  let scheduledAt: string;
  let now: string;
  try {
    scheduledAt = canonicalInstant(input.event.scheduledAt, "scheduled time");
    now = canonicalInstant(input.now, "admission time");
  } catch {
    return rejectFiring("scheduled_time_invalid");
  }
  if (Date.parse(scheduledAt) > Date.parse(now))
    return rejectFiring("scheduled_time_in_future");
  const scheduled = new Date(scheduledAt);
  if (
    (scheduled.getUTCDay() !== 1 && scheduled.getUTCDay() !== 4) ||
    scheduled.getUTCHours() !== 5 ||
    scheduled.getUTCMinutes() !== 0 ||
    scheduled.getUTCSeconds() !== 0 ||
    scheduled.getUTCMilliseconds() !== 0
  )
    return rejectFiring("scheduled_time_invalid");
  let rejectionAuthority: RejectedFiringAuthorityContext | undefined;
  try {
    assertCanonicalId(
      input.protectedContext.runPlanId,
      RUN_PLAN_ID_PATTERN,
      "protected plan ID",
    );
    assertHash(input.protectedContext.runPlanHash, "protected plan hash");
    assertEnvironment(input.protectedContext.environment);
    rejectionAuthority = Object.freeze({
      scheduleName: PUBLICATION_SCHEDULE_NAME,
      scheduleExpression: PUBLICATION_SCHEDULE_EXPRESSION,
      scheduledAt,
      observedAt: now,
      requestedPlan: Object.freeze({
        runPlanId: input.protectedContext.runPlanId,
        runPlanHash: input.protectedContext.runPlanHash,
        environment: input.protectedContext.environment,
      }),
    });
  } catch {
    // An invalid protected identity cannot authorize a durable receipt.
  }
  const rejectDurable = (
    reason: AdmissionRejectionCode,
  ): RejectedFiringDecision => rejectFiring(reason, rejectionAuthority);
  if (input.plan.state !== "authorized") {
    const reasonByState = {
      unavailable: "plan_unavailable",
      invalid: "plan_invalid",
      not_effective: "plan_not_effective",
      revoked: "plan_revoked",
      source_authority_invalid: "source_authority_invalid",
      runtime_version_mismatch: "runtime_version_mismatch",
    } as const;
    const planState: unknown = input.plan.state;
    if (typeof planState !== "string" || !(planState in reasonByState))
      return rejectDurable("plan_invalid");
    return rejectDurable(
      reasonByState[planState as keyof typeof reasonByState],
    );
  }
  try {
    assertExactRecord(
      input.plan,
      [
        "state",
        "contractVersion",
        "runPlanId",
        "planHash",
        "environment",
        "scheduleName",
        "scheduleExpression",
        "effectiveFrom",
        "effectiveTo",
        "scheduledAt",
        "canonicalSchemaVersion",
        "pipelineContractVersion",
        "providerScopeHash",
        "policySetHash",
        "providers",
        "policies",
        "approval",
      ],
      "authorized run plan",
    );
    const planContractVersion: string = input.plan.contractVersion;
    if (planContractVersion !== "publication-run-plan@1")
      throw new TypeError("authorized run plan contract is unsupported");
    assertEnvironment(input.plan.environment);
    const effectiveFrom = Date.parse(
      canonicalInstant(input.plan.effectiveFrom, "plan effective start"),
    );
    const effectiveTo = Date.parse(
      canonicalInstant(input.plan.effectiveTo, "plan effective end"),
    );
    const planScheduled = Date.parse(
      canonicalInstant(input.plan.scheduledAt, "plan scheduled time"),
    );
    if (
      effectiveFrom >= effectiveTo ||
      planScheduled < effectiveFrom ||
      planScheduled >= effectiveTo
    )
      throw new TypeError(
        "authorized run plan is outside its effective interval",
      );
    assertExactRecord(
      input.plan.approval,
      ["artifactPath", "artifactHash", "approvedAt", "approverRoles"],
      "run plan approval",
    );
    const approval = input.plan.approval;
    assertPrintableAscii(
      approval.artifactPath,
      28,
      512,
      "approval artifact path",
    );
    if (
      !approval.artifactPath.startsWith("docs/compliance/run-plans/") ||
      ["..", "?", "#", "@"].some((part) => approval.artifactPath.includes(part))
    )
      throw new TypeError("run plan approval path is invalid");
    assertHash(approval.artifactHash, "approval artifact hash");
    canonicalInstant(approval.approvedAt, "plan approval time");
    const approverRoles: readonly unknown[] = approval.approverRoles;
    if (
      approverRoles.length !== 3 ||
      approverRoles[0] !== "legal_source_owner" ||
      approverRoles[1] !== "platform_owner" ||
      approverRoles[2] !== "product_owner"
    )
      throw new TypeError("run plan approval roles are not exact");
  } catch {
    return rejectDurable("plan_invalid");
  }
  try {
    assertCanonicalId(
      input.protectedContext.runPlanId,
      RUN_PLAN_ID_PATTERN,
      "protected plan ID",
    );
    assertHash(input.protectedContext.runPlanHash, "protected plan hash");
    assertPrintableAscii(
      input.protectedContext.canonicalSchemaVersion,
      1,
      64,
      "protected canonical schema version",
    );
    assertPrintableAscii(
      input.protectedContext.pipelineContractVersion,
      1,
      128,
      "protected pipeline contract version",
    );
  } catch {
    return rejectDurable("plan_context_mismatch");
  }
  if (
    input.plan.runPlanId !== input.protectedContext.runPlanId ||
    input.plan.planHash !== input.protectedContext.runPlanHash ||
    input.plan.environment !== input.protectedContext.environment ||
    input.plan.scheduleName !== input.protectedContext.scheduleName ||
    input.plan.scheduleExpression !==
      input.protectedContext.scheduleExpression ||
    input.plan.scheduledAt !== scheduledAt ||
    input.plan.canonicalSchemaVersion !==
      input.protectedContext.canonicalSchemaVersion ||
    input.plan.pipelineContractVersion !==
      input.protectedContext.pipelineContractVersion
  )
    return rejectDurable("plan_context_mismatch");
  let policies: ResolvedOrchestrationPolicies;
  try {
    policies = resolveOrchestrationPolicies(input.plan.policies);
  } catch {
    return rejectDurable("policy_mismatch");
  }
  if (input.plan.policySetHash !== policies.policySetHash)
    return rejectDurable("policy_mismatch");
  let budget: RunBudgetAdmissionDecision;
  try {
    budget = decideRunBudgetAdmission({
      policy: policies.runBudget,
      providers: input.plan.providers,
      state: input.budgetState,
    });
  } catch {
    return rejectDurable("plan_invalid");
  }
  if (!budget.admitted) return rejectDurable(budget.reason);
  if (
    input.plan.providerScopeHash !==
    publicationPlanProviderScopeHash(budget.providerScope)
  )
    return rejectDurable("plan_invalid");
  const deadline = terminalDeadlineAt(scheduledAt, policies.terminalDeadline);
  if (Date.parse(now) >= Date.parse(deadline))
    return rejectDurable("terminal_deadline_elapsed");
  return Object.freeze({
    decision: "admitted",
    runAction: "create_or_reconcile_attempt_1",
    attemptNumber: 1,
    scheduledAt,
    terminalDeadlineAt: deadline,
    runPlanId: input.plan.runPlanId,
    runPlanHash: input.plan.planHash,
    environment: input.plan.environment,
    canonicalSchemaVersion: input.plan.canonicalSchemaVersion,
    pipelineContractVersion: input.plan.pipelineContractVersion,
    policySetHash: input.plan.policySetHash,
    providerScope: budget.providerScope,
    providers: Object.freeze(
      input.plan.providers.map((provider) => Object.freeze({ ...provider })),
    ),
    runCeilings: budget.runCeilings,
    projectedMonthlyCostMicrousd: budget.projectedMonthlyCostMicrousd,
    budgetAlertPercent: budget.alertPercent,
    policies,
  });
};

export type AdjacentReplayDecision = Readonly<{
  decision: "admit_replay";
  occurrenceId: string;
  attemptNumber: number;
  replayOfRunId: string;
  runPlanId: string;
  runPlanHash: string;
}>;

/** Domain replay is an explicit protected action, never a Workflow retry. */
export const validateAdjacentExplicitReplay = (input: {
  authority: string;
  occurrenceId: string;
  requestedAttemptNumber: number;
  replayOfRunId: string;
  runPlanId: string;
  runPlanHash: string;
  adjacentPrior: Readonly<{
    occurrenceId: string;
    runId: string;
    attemptNumber: number;
    terminal: boolean;
    outcome: RunTerminalOutcome;
    runPlanId: string;
    runPlanHash: string;
  }>;
}): AdjacentReplayDecision => {
  assertExactRecord(
    input,
    [
      "authority",
      "occurrenceId",
      "requestedAttemptNumber",
      "replayOfRunId",
      "runPlanId",
      "runPlanHash",
      "adjacentPrior",
    ],
    "explicit replay request",
  );
  assertExactRecord(
    input.adjacentPrior,
    [
      "occurrenceId",
      "runId",
      "attemptNumber",
      "terminal",
      "outcome",
      "runPlanId",
      "runPlanHash",
    ],
    "adjacent prior run",
  );
  if (input.authority !== "protected_operator")
    throw new TypeError(
      "explicit replay requires protected operator authority",
    );
  assertCanonicalId(input.occurrenceId, OCCURRENCE_ID_PATTERN, "occurrence ID");
  assertCanonicalId(input.replayOfRunId, RUN_ID_PATTERN, "replayed run ID");
  assertCanonicalId(input.runPlanId, RUN_PLAN_ID_PATTERN, "run plan ID");
  assertHash(input.runPlanHash, "run plan hash");
  const priorTerminal: unknown = input.adjacentPrior.terminal;
  if (priorTerminal !== true)
    throw new TypeError("explicit replay requires a terminal adjacent run");
  const priorOutcome: unknown = input.adjacentPrior.outcome;
  if (!RUN_TERMINAL_OUTCOMES.includes(priorOutcome as RunTerminalOutcome))
    throw new TypeError("adjacent prior run outcome is invalid");
  if (priorOutcome === "succeeded")
    throw new TypeError("a successful run cannot be replayed");
  if (
    input.adjacentPrior.occurrenceId !== input.occurrenceId ||
    input.adjacentPrior.runId !== input.replayOfRunId ||
    input.adjacentPrior.runPlanId !== input.runPlanId ||
    input.adjacentPrior.runPlanHash !== input.runPlanHash ||
    !Number.isSafeInteger(input.adjacentPrior.attemptNumber) ||
    input.adjacentPrior.attemptNumber < 1 ||
    !Number.isSafeInteger(input.requestedAttemptNumber) ||
    input.requestedAttemptNumber < 2 ||
    input.requestedAttemptNumber !== input.adjacentPrior.attemptNumber + 1
  )
    throw new TypeError("explicit replay must link the adjacent prior attempt");
  return Object.freeze({
    decision: "admit_replay",
    occurrenceId: input.occurrenceId,
    attemptNumber: input.requestedAttemptNumber,
    replayOfRunId: input.replayOfRunId,
    runPlanId: input.runPlanId,
    runPlanHash: input.runPlanHash,
  });
};

export type ProviderFence = Readonly<{
  environment: "preview" | "production";
  providerId: string;
  holderRunId: string;
  holderOccurrenceId: string;
  generation: number;
  state: "active" | "released";
  deadlineAt: string;
}>;

export type FencedProviderStartDecision =
  | Readonly<{ action: "start"; fenceGeneration: number }>
  | Readonly<{ action: "resume"; fenceGeneration: number }>
  | Readonly<{
      action: "wait";
      reason: "provider_active_in_other_occurrence";
      fenceGeneration: number;
    }>
  | Readonly<{
      action: "reconcile";
      reason: "requested_deadline_elapsed" | "holder_deadline_elapsed";
      fenceGeneration?: number;
    }>;

/**
 * Fence expiry never grants takeover. An expired owner must be terminally
 * reconciled and released before a later generation may start.
 */
export const decideFencedProviderStart = (input: {
  environment: "preview" | "production";
  providerId: string;
  runId: string;
  occurrenceId: string;
  now: string;
  terminalDeadlineAt: string;
  latestFence?: ProviderFence;
}): FencedProviderStartDecision => {
  assertEnvironment(input.environment);
  assertCanonicalId(input.providerId, PROVIDER_ID_PATTERN, "Provider ID");
  assertCanonicalId(input.runId, RUN_ID_PATTERN, "run ID");
  assertCanonicalId(input.occurrenceId, OCCURRENCE_ID_PATTERN, "occurrence ID");
  const nowMs = Date.parse(canonicalInstant(input.now, "provider start time"));
  const requestedDeadlineMs = Date.parse(
    canonicalInstant(input.terminalDeadlineAt, "requested run deadline"),
  );
  const fence = input.latestFence;
  if (fence === undefined)
    return nowMs >= requestedDeadlineMs
      ? Object.freeze({
          action: "reconcile",
          reason: "requested_deadline_elapsed",
        })
      : Object.freeze({ action: "start", fenceGeneration: 1 });
  assertExactRecord(
    fence,
    [
      "environment",
      "providerId",
      "holderRunId",
      "holderOccurrenceId",
      "generation",
      "state",
      "deadlineAt",
    ],
    "Provider fence",
  );
  if (
    fence.environment !== input.environment ||
    fence.providerId !== input.providerId ||
    !Number.isSafeInteger(fence.generation) ||
    fence.generation < 1
  )
    throw new TypeError("provider fence does not match the request authority");
  assertCanonicalId(fence.holderRunId, RUN_ID_PATTERN, "fence holder run ID");
  assertCanonicalId(
    fence.holderOccurrenceId,
    OCCURRENCE_ID_PATTERN,
    "fence holder occurrence ID",
  );
  const fenceState: unknown = fence.state;
  if (fenceState !== "active" && fenceState !== "released")
    throw new TypeError("Provider fence state is invalid");
  if (nowMs >= requestedDeadlineMs)
    return Object.freeze({
      action: "reconcile",
      reason: "requested_deadline_elapsed",
      fenceGeneration: fence.generation,
    });
  const holderDeadlineMs = Date.parse(
    canonicalInstant(fence.deadlineAt, "provider fence deadline"),
  );
  if (fence.state === "active") {
    if (nowMs >= holderDeadlineMs)
      return Object.freeze({
        action: "reconcile",
        reason: "holder_deadline_elapsed",
        fenceGeneration: fence.generation,
      });
    if (
      fence.holderRunId === input.runId &&
      fence.holderOccurrenceId === input.occurrenceId
    ) {
      if (fence.deadlineAt !== input.terminalDeadlineAt)
        throw new TypeError("provider fence holder deadline is inconsistent");
      return Object.freeze({
        action: "resume",
        fenceGeneration: fence.generation,
      });
    }
    return Object.freeze({
      action: "wait",
      reason: "provider_active_in_other_occurrence",
      fenceGeneration: fence.generation,
    });
  }
  if (fence.generation === Number.MAX_SAFE_INTEGER)
    throw new RangeError("provider fence generation is exhausted");
  return Object.freeze({
    action: "start",
    fenceGeneration: fence.generation + 1,
  });
};

export const RUN_TERMINAL_OUTCOMES = [
  "succeeded",
  "completed_with_provider_failures",
  "failed",
  "quarantined",
] as const;
export type RunTerminalOutcome = (typeof RUN_TERMINAL_OUTCOMES)[number];
export type PublicationDisposition =
  "publish_new" | "retain_current" | "blocked";

export type TerminalProviderOutcome = Readonly<{
  providerId: string;
  state: "ready" | "failed" | "quarantined";
  usableSlice: "new" | "last_known_good" | "none";
  errorCodes: readonly ProviderTerminalReportCode[];
}>;

export const TERMINAL_REPORT_CODES = [
  "provider_failed",
  "provider_quarantined",
  "provider_unavailable",
  "partial_provider_refresh",
  "last_known_good_only",
  "zero_usable_providers",
  "run_wide_quarantine",
  "terminal_deadline_elapsed",
] as const;
export type TerminalReportCode = (typeof TERMINAL_REPORT_CODES)[number];

export const PROVIDER_TERMINAL_REPORT_CODES = [
  "provider_failed",
  "provider_quarantined",
  "provider_unavailable",
  "terminal_deadline_elapsed",
] as const satisfies readonly TerminalReportCode[];
export type ProviderTerminalReportCode =
  (typeof PROVIDER_TERMINAL_REPORT_CODES)[number];

const isProviderTerminalReportCode = (
  value: unknown,
): value is ProviderTerminalReportCode =>
  (PROVIDER_TERMINAL_REPORT_CODES as readonly unknown[]).includes(value);

export type TerminalRunDecision = Readonly<{
  runOutcome: RunTerminalOutcome;
  publicationDisposition: PublicationDisposition;
  reasonCodes: readonly TerminalReportCode[];
}>;

const frozenReportCodes = (
  codes: readonly TerminalReportCode[],
): readonly TerminalReportCode[] => Object.freeze([...codes]);

const frozenProviderReportCodes = (
  codes: readonly ProviderTerminalReportCode[],
): readonly ProviderTerminalReportCode[] => Object.freeze([...codes]);

export const decideTerminalRun = (input: {
  providers: readonly TerminalProviderOutcome[];
  runWideQuarantine: boolean;
  terminalDeadlineElapsed: boolean;
}): TerminalRunDecision => {
  if (
    typeof input.runWideQuarantine !== "boolean" ||
    typeof input.terminalDeadlineElapsed !== "boolean"
  )
    throw new TypeError("terminal run flags must be Boolean");
  if (input.providers.length < 1 || input.providers.length > 16)
    throw new RangeError(
      "terminal provider scope must contain 1 to 16 providers",
    );
  const seen = new Set<string>();
  for (const provider of input.providers) {
    assertCanonicalId(provider.providerId, PROVIDER_ID_PATTERN, "Provider ID");
    const providerState: unknown = provider.state;
    if (
      providerState !== "ready" &&
      providerState !== "failed" &&
      providerState !== "quarantined"
    )
      throw new TypeError("terminal provider state is invalid");
    const usableSlice: unknown = provider.usableSlice;
    if (
      usableSlice !== "new" &&
      usableSlice !== "last_known_good" &&
      usableSlice !== "none"
    )
      throw new TypeError("terminal provider usable-slice state is invalid");
    if (seen.has(provider.providerId))
      throw new TypeError("terminal provider outcome is duplicated");
    seen.add(provider.providerId);
    if (provider.state === "ready" && provider.usableSlice !== "new")
      throw new TypeError("ready provider must produce a new usable slice");
    if (provider.state === "ready" && provider.errorCodes.length !== 0)
      throw new TypeError("ready provider cannot carry terminal error codes");
    if (provider.state !== "ready" && provider.usableSlice === "new")
      throw new TypeError("failed provider cannot produce a new usable slice");
    for (const code of provider.errorCodes)
      if (!isProviderTerminalReportCode(code))
        throw new TypeError(
          "provider outcome contains a non-Provider terminal code",
        );
    if (
      provider.state === "failed" &&
      !provider.errorCodes.some(
        (code) =>
          code === "provider_failed" || code === "terminal_deadline_elapsed",
      )
    )
      throw new TypeError("failed Provider outcome lacks its terminal code");
    if (
      provider.state === "failed" &&
      provider.errorCodes.includes("provider_quarantined")
    )
      throw new TypeError(
        "failed Provider outcome cannot carry the quarantine terminal code",
      );
    if (
      provider.state === "quarantined" &&
      !provider.errorCodes.includes("provider_quarantined")
    )
      throw new TypeError(
        "quarantined Provider outcome lacks its terminal code",
      );
  }
  if (input.runWideQuarantine)
    return Object.freeze({
      runOutcome: "quarantined",
      publicationDisposition: "blocked",
      reasonCodes: frozenReportCodes(["run_wide_quarantine"]),
    });
  if (input.terminalDeadlineElapsed)
    return Object.freeze({
      runOutcome: "failed",
      publicationDisposition: "blocked",
      reasonCodes: frozenReportCodes(["terminal_deadline_elapsed"]),
    });
  const newCount = input.providers.filter(
    ({ usableSlice }) => usableSlice === "new",
  ).length;
  const lastKnownGoodCount = input.providers.filter(
    ({ usableSlice }) => usableSlice === "last_known_good",
  ).length;
  const failedCount = input.providers.filter(
    ({ state }) => state !== "ready",
  ).length;
  if (newCount > 0)
    return Object.freeze({
      runOutcome:
        failedCount === 0 ? "succeeded" : "completed_with_provider_failures",
      publicationDisposition: "publish_new",
      reasonCodes: frozenReportCodes(
        failedCount === 0 ? [] : ["partial_provider_refresh"],
      ),
    });
  if (lastKnownGoodCount > 0)
    return Object.freeze({
      runOutcome: "completed_with_provider_failures",
      publicationDisposition: "retain_current",
      reasonCodes: frozenReportCodes(["last_known_good_only"]),
    });
  return Object.freeze({
    runOutcome: "failed",
    publicationDisposition: "blocked",
    reasonCodes: frozenReportCodes(["zero_usable_providers"]),
  });
};

export type ProviderReportV2 = Readonly<{
  providerId: string;
  adapterVersion: string;
  rosterVersion: string;
  sourceRegisterVersion: string;
  state: "ready" | "failed" | "quarantined";
  rosterComplete: boolean;
  publicationDisposition: "new" | "carried_forward" | "unavailable";
  sliceId?: string;
  cost: BudgetAmounts;
  errorCodes: readonly ProviderTerminalReportCode[];
}>;

export type ProviderTerminalReportInputV2 = Readonly<{
  providerId: string;
  state: "ready" | "failed" | "quarantined";
  rosterComplete: boolean;
  publicationDisposition: "new" | "carried_forward" | "unavailable";
  sliceId?: string;
  cost: BudgetAmounts;
  errorCodes: readonly ProviderTerminalReportCode[];
}>;

export type RetainedPublicationAuthorityV2 = Readonly<{
  authoritySchema: "retained-publication-head@1";
  environment: "preview" | "production";
  publicationId: string;
  closureHash: string;
}>;

export type TerminalRunIdentityAuthorityV2 =
  | Readonly<{
      kind: "attempt_1";
      occurrenceId: string;
      runId: string;
      codeVersion: string;
    }>
  | Readonly<{
      kind: "explicit_replay";
      runId: string;
      codeVersion: string;
      replay: AdjacentReplayDecision;
    }>;

type RejectedFiringReportBodyV2 = Readonly<{
  reportSchemaVersion: "publication-run-report@2";
  kind: "rejected_firing";
  scheduleName: string;
  scheduleExpression: string;
  occurrenceId: string;
  scheduledAt: string;
  observedAt: string;
  rejectionCode: AdmissionRejectionCode;
  requestedPlan: Readonly<{
    runPlanId: string;
    runPlanHash: string;
    environment: "preview" | "production";
  }>;
}>;

type TerminalRunReportBodyV2 = Readonly<{
  reportSchemaVersion: "publication-run-report@2";
  kind: "terminal_run";
  scheduleName: string;
  scheduleExpression: string;
  environment: "preview" | "production";
  occurrenceId: string;
  runId: string;
  attemptNumber: number;
  replayOfRunId?: string;
  runPlanId: string;
  runPlanHash: string;
  policySetHash: string;
  codeVersion: string;
  canonicalSchemaVersion: string;
  pipelineContractVersion: string;
  providerScope: readonly string[];
  scheduledAt: string;
  startedAt: string;
  terminalDeadlineAt: string;
  endedAt: string;
  runOutcome: RunTerminalOutcome;
  publicationDisposition: PublicationDisposition;
  retainedPublication?: RetainedPublicationAuthorityV2;
  cost: BudgetAmounts;
  errorCodes: readonly TerminalReportCode[];
  providers: readonly ProviderReportV2[];
}>;

type ReportSealV2 = Readonly<{
  algorithm: "sha256";
  contentHash: string;
}>;

export type RejectedFiringReportV2 = RejectedFiringReportBodyV2 &
  Readonly<{ seal: ReportSealV2 }>;
export type TerminalRunReportV2 = TerminalRunReportBodyV2 &
  Readonly<{ seal: ReportSealV2 }>;
export type OrchestrationReportV2 =
  RejectedFiringReportV2 | TerminalRunReportV2;

const MAX_REPORT_ASCII_BYTES = 16_384;

const sealReport = <
  T extends RejectedFiringReportBodyV2 | TerminalRunReportBodyV2,
>(
  body: T,
): T & Readonly<{ seal: ReportSealV2 }> => {
  const hashInput = canonicalJson({
    domain: "quantclarity:publication-run-report@2",
    body,
  });
  const sealed = Object.freeze({
    ...body,
    seal: Object.freeze({
      algorithm: "sha256" as const,
      contentHash: sha256AsciiDigest(hashInput),
    }),
  });
  if (
    hashInput.length > MAX_REPORT_ASCII_BYTES ||
    canonicalJson(sealed).length > MAX_REPORT_ASCII_BYTES
  )
    throw new RangeError("report exceeds its bounded representation");
  return sealed as unknown as T & Readonly<{ seal: ReportSealV2 }>;
};

const validateBudget = (value: BudgetAmounts, label: string): BudgetAmounts => {
  const copy = {} as Record<(typeof BUDGET_FIELDS)[number], number>;
  for (const field of BUDGET_FIELDS) {
    const amount = value[field];
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new RangeError(`${label} ${field} is outside its supported range`);
    copy[field] = amount;
  }
  return Object.freeze(copy);
};

export const buildRejectedFiringReportV2 = (input: {
  scheduleName: string;
  scheduleExpression: string;
  occurrenceId: string;
  scheduledAt: string;
  observedAt: string;
  rejectionCode: AdmissionRejectionCode;
  requestedPlan: Readonly<{
    runPlanId: string;
    runPlanHash: string;
    environment: string;
  }>;
}): RejectedFiringReportV2 => {
  if (input.scheduleName !== PUBLICATION_SCHEDULE_NAME)
    throw new TypeError(
      "schedule name is not the accepted publication schedule",
    );
  if (input.scheduleExpression !== PUBLICATION_SCHEDULE_EXPRESSION)
    throw new TypeError(
      "schedule expression is not the accepted publication schedule",
    );
  assertCanonicalId(input.occurrenceId, OCCURRENCE_ID_PATTERN, "occurrence ID");
  if (!ADMISSION_REJECTION_CODES.includes(input.rejectionCode))
    throw new TypeError("rejected firing report code is unknown");
  assertCanonicalId(
    input.requestedPlan.runPlanId,
    RUN_PLAN_ID_PATTERN,
    "requested plan ID",
  );
  assertHash(input.requestedPlan.runPlanHash, "requested plan hash");
  assertEnvironment(input.requestedPlan.environment);
  const requestedPlan = Object.freeze({
    runPlanId: input.requestedPlan.runPlanId,
    runPlanHash: input.requestedPlan.runPlanHash,
    environment: input.requestedPlan.environment,
  });
  const scheduledAt = canonicalInstant(input.scheduledAt, "scheduled time");
  const observedAt = canonicalInstant(input.observedAt, "observation time");
  if (Date.parse(observedAt) < Date.parse(scheduledAt))
    throw new TypeError("admission observation precedes scheduled time");
  return sealReport(
    Object.freeze({
      reportSchemaVersion: "publication-run-report@2",
      kind: "rejected_firing",
      scheduleName: input.scheduleName,
      scheduleExpression: input.scheduleExpression,
      occurrenceId: input.occurrenceId,
      scheduledAt,
      observedAt,
      rejectionCode: input.rejectionCode,
      requestedPlan,
    }),
  );
};

const buildTerminalRunReportFromProjectedAuthorityV2 = (input: {
  scheduleName: string;
  scheduleExpression: string;
  environment: string;
  occurrenceId: string;
  runId: string;
  attemptNumber: number;
  replayOfRunId?: string;
  runPlanId: string;
  runPlanHash: string;
  policySetHash: string;
  codeVersion: string;
  canonicalSchemaVersion: string;
  pipelineContractVersion: string;
  providerScope: readonly string[];
  scheduledAt: string;
  startedAt: string;
  terminalDeadlineAt: string;
  endedAt: string;
  providers: readonly ProviderReportV2[];
  retainedPublication?: RetainedPublicationAuthorityV2;
  runWideQuarantine: boolean;
}): TerminalRunReportV2 => {
  if (typeof input.runWideQuarantine !== "boolean")
    throw new TypeError("run-wide quarantine flag must be Boolean");
  if (!CODE_VERSION_PATTERN.test(input.codeVersion))
    throw new TypeError("code version must be a canonical Git revision");
  assertPrintableAscii(
    input.canonicalSchemaVersion,
    1,
    64,
    "canonical schema version",
  );
  assertPrintableAscii(
    input.pipelineContractVersion,
    1,
    128,
    "pipeline contract version",
  );
  if (input.scheduleName !== PUBLICATION_SCHEDULE_NAME)
    throw new TypeError(
      "schedule name is not the accepted publication schedule",
    );
  assertCanonicalId(input.occurrenceId, OCCURRENCE_ID_PATTERN, "occurrence ID");
  assertCanonicalId(input.runId, RUN_ID_PATTERN, "run ID");
  assertCanonicalId(input.runPlanId, RUN_PLAN_ID_PATTERN, "run plan ID");
  if (input.scheduleExpression !== PUBLICATION_SCHEDULE_EXPRESSION)
    throw new TypeError(
      "schedule expression is not the accepted publication schedule",
    );
  assertEnvironment(input.environment);
  if (input.replayOfRunId !== undefined)
    assertCanonicalId(input.replayOfRunId, RUN_ID_PATTERN, "replayed run ID");
  assertHash(input.runPlanHash, "run plan hash");
  assertHash(input.policySetHash, "policy set hash");
  const registeredPolicies = resolveOrchestrationPolicies(
    REGISTERED_POLICY_REFERENCES,
  );
  if (input.policySetHash !== registeredPolicies.policySetHash)
    throw new TypeError("report policy set is not registered");
  if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1)
    throw new RangeError("run attempt is outside its supported range");
  if (
    (input.attemptNumber === 1 && input.replayOfRunId !== undefined) ||
    (input.attemptNumber > 1 && input.replayOfRunId === undefined)
  )
    throw new TypeError("run report replay identity is inconsistent");
  const scheduledAt = canonicalInstant(input.scheduledAt, "scheduled time");
  const startedAt = canonicalInstant(input.startedAt, "run start time");
  const deadlineAt = canonicalInstant(
    input.terminalDeadlineAt,
    "terminal deadline",
  );
  const endedAt = canonicalInstant(input.endedAt, "run end time");
  if (
    Date.parse(startedAt) < Date.parse(scheduledAt) ||
    Date.parse(deadlineAt) !==
      Date.parse(
        terminalDeadlineAt(scheduledAt, registeredPolicies.terminalDeadline),
      ) ||
    Date.parse(endedAt) < Date.parse(startedAt)
  )
    throw new TypeError("run report timeline is inconsistent");
  if (input.providerScope.length < 1 || input.providerScope.length > 16)
    throw new RangeError(
      "report provider scope must contain 1 to 16 providers",
    );
  const providerScope = Object.freeze([...input.providerScope]);
  if (
    new Set(providerScope).size !== providerScope.length ||
    providerScope.some((id, index) => {
      assertCanonicalId(id, PROVIDER_ID_PATTERN, "provider scope ID");
      return (
        index > 0 && (providerScope[index - 1] ?? "").localeCompare(id) >= 0
      );
    })
  )
    throw new TypeError(
      "report provider scope must be exact, unique, and sorted",
    );
  if (
    input.providers.length !== providerScope.length ||
    input.providers.some(
      (provider, index) => provider.providerId !== providerScope[index],
    )
  )
    throw new TypeError("provider reports do not exactly match provider scope");
  const providers = Object.freeze(
    input.providers.map((provider): ProviderReportV2 => {
      for (const [value, label] of [
        [provider.adapterVersion, "adapter version"],
        [provider.rosterVersion, "roster version"],
        [provider.sourceRegisterVersion, "source register version"],
      ] as const)
        assertPrintableAscii(value, 1, 128, label);
      assertCanonicalId(
        provider.providerId,
        PROVIDER_ID_PATTERN,
        "Provider ID",
      );
      const rosterComplete: unknown = provider.rosterComplete;
      if (rosterComplete !== true)
        throw new TypeError("terminal provider report requires roster closure");
      const providerState: unknown = provider.state;
      if (
        providerState !== "ready" &&
        providerState !== "failed" &&
        providerState !== "quarantined"
      )
        throw new TypeError("terminal provider report state is invalid");
      const providerDisposition: unknown = provider.publicationDisposition;
      if (
        providerDisposition !== "new" &&
        providerDisposition !== "carried_forward" &&
        providerDisposition !== "unavailable"
      )
        throw new TypeError(
          "terminal provider publication disposition is invalid",
        );
      const ready = provider.state === "ready";
      if (
        (ready && provider.publicationDisposition !== "new") ||
        (!ready && provider.publicationDisposition === "new") ||
        (provider.publicationDisposition === "unavailable" &&
          provider.sliceId !== undefined) ||
        (provider.publicationDisposition !== "unavailable" &&
          provider.sliceId === undefined)
      )
        throw new TypeError("provider publication disposition is inconsistent");
      if (provider.sliceId !== undefined)
        assertCanonicalId(
          provider.sliceId,
          PROVIDER_SLICE_ID_PATTERN,
          "provider slice ID",
        );
      for (const code of provider.errorCodes)
        if (!isProviderTerminalReportCode(code))
          throw new TypeError(
            "provider report contains a non-Provider terminal code",
          );
      if (!ready && provider.errorCodes.length === 0)
        throw new TypeError(
          "failed or quarantined provider report requires an error code",
        );
      if (ready && provider.errorCodes.length !== 0)
        throw new TypeError(
          "ready Provider report cannot carry terminal error codes",
        );
      if (
        provider.state === "failed" &&
        !provider.errorCodes.some(
          (code) =>
            code === "provider_failed" || code === "terminal_deadline_elapsed",
        )
      )
        throw new TypeError("failed Provider report lacks its terminal code");
      if (
        provider.state === "failed" &&
        provider.errorCodes.includes("provider_quarantined")
      )
        throw new TypeError(
          "failed Provider report cannot carry the quarantine terminal code",
        );
      if (
        provider.state === "quarantined" &&
        !provider.errorCodes.includes("provider_quarantined")
      )
        throw new TypeError(
          "quarantined Provider report lacks its terminal code",
        );
      if (
        provider.publicationDisposition === "unavailable" &&
        !provider.errorCodes.some(
          (code) =>
            code === "provider_unavailable" ||
            code === "terminal_deadline_elapsed",
        )
      )
        throw new TypeError(
          "unavailable Provider report lacks its terminal code",
        );
      return Object.freeze({
        providerId: provider.providerId,
        adapterVersion: provider.adapterVersion,
        rosterVersion: provider.rosterVersion,
        sourceRegisterVersion: provider.sourceRegisterVersion,
        state: provider.state,
        rosterComplete: true,
        publicationDisposition: provider.publicationDisposition,
        ...(provider.sliceId === undefined
          ? {}
          : { sliceId: provider.sliceId }),
        cost: validateBudget(provider.cost, "provider report cost"),
        errorCodes: frozenProviderReportCodes(
          [...new Set(provider.errorCodes)].sort(),
        ),
      });
    }),
  );
  const hasCarriedForward = providers.some(
    ({ publicationDisposition }) =>
      publicationDisposition === "carried_forward",
  );
  let retainedPublication: RetainedPublicationAuthorityV2 | undefined;
  if (input.retainedPublication !== undefined) {
    assertExactRecord(
      input.retainedPublication,
      ["authoritySchema", "environment", "publicationId", "closureHash"],
      "retained publication authority",
    );
    const retainedAuthoritySchema: unknown =
      input.retainedPublication.authoritySchema;
    if (
      retainedAuthoritySchema !== "retained-publication-head@1" ||
      input.retainedPublication.environment !== input.environment
    )
      throw new TypeError(
        "retained publication authority does not match the run environment",
      );
    assertCanonicalId(
      input.retainedPublication.publicationId,
      PUBLICATION_ID_PATTERN,
      "retained publication ID",
    );
    assertHash(
      input.retainedPublication.closureHash,
      "retained publication closure hash",
    );
    retainedPublication = Object.freeze({ ...input.retainedPublication });
  }
  if (hasCarriedForward !== (retainedPublication !== undefined))
    throw new TypeError(
      "carried-forward Providers require exact retained publication authority",
    );
  const decision = decideTerminalRun({
    providers: providers.map((provider) => ({
      providerId: provider.providerId,
      state: provider.state,
      usableSlice:
        provider.publicationDisposition === "new"
          ? "new"
          : provider.publicationDisposition === "carried_forward"
            ? "last_known_good"
            : "none",
      errorCodes: provider.errorCodes,
    })),
    runWideQuarantine: input.runWideQuarantine,
    terminalDeadlineElapsed: Date.parse(endedAt) >= Date.parse(deadlineAt),
  });
  const errorCodes = frozenReportCodes(
    [
      ...new Set([
        ...decision.reasonCodes,
        ...providers.flatMap((provider) => provider.errorCodes),
      ]),
    ].sort(),
  );
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
  ) as Record<(typeof BUDGET_FIELDS)[number], number>;
  return sealReport(
    Object.freeze({
      reportSchemaVersion: "publication-run-report@2",
      kind: "terminal_run",
      scheduleName: input.scheduleName,
      scheduleExpression: input.scheduleExpression,
      environment: input.environment,
      occurrenceId: input.occurrenceId,
      runId: input.runId,
      attemptNumber: input.attemptNumber,
      ...(input.replayOfRunId === undefined
        ? {}
        : { replayOfRunId: input.replayOfRunId }),
      runPlanId: input.runPlanId,
      runPlanHash: input.runPlanHash,
      policySetHash: input.policySetHash,
      codeVersion: input.codeVersion,
      canonicalSchemaVersion: input.canonicalSchemaVersion,
      pipelineContractVersion: input.pipelineContractVersion,
      providerScope,
      scheduledAt,
      startedAt,
      terminalDeadlineAt: deadlineAt,
      endedAt,
      runOutcome: decision.runOutcome,
      publicationDisposition: decision.publicationDisposition,
      ...(retainedPublication === undefined ? {} : { retainedPublication }),
      cost: Object.freeze(cost),
      errorCodes,
      providers,
    }),
  );
};

const budgetsEqual = (left: BudgetAmounts, right: BudgetAmounts): boolean =>
  BUDGET_FIELDS.every((field) => left[field] === right[field]);

const validateAdmittedReportAuthority = (
  admission: AdmittedFiringDecision,
): void => {
  assertExactRecord(
    admission,
    [
      "decision",
      "runAction",
      "attemptNumber",
      "scheduledAt",
      "terminalDeadlineAt",
      "runPlanId",
      "runPlanHash",
      "environment",
      "canonicalSchemaVersion",
      "pipelineContractVersion",
      "policySetHash",
      "providerScope",
      "providers",
      "runCeilings",
      "projectedMonthlyCostMicrousd",
      "budgetAlertPercent",
      "policies",
    ],
    "admitted firing authority",
  );
  const decision: unknown = admission.decision;
  const runAction: unknown = admission.runAction;
  const attemptNumber: unknown = admission.attemptNumber;
  if (
    decision !== "admitted" ||
    runAction !== "create_or_reconcile_attempt_1" ||
    attemptNumber !== 1
  )
    throw new TypeError("terminal report requires admitted firing authority");
  assertCanonicalId(admission.runPlanId, RUN_PLAN_ID_PATTERN, "run plan ID");
  assertHash(admission.runPlanHash, "run plan hash");
  assertEnvironment(admission.environment);
  const scheduledAt = canonicalInstant(admission.scheduledAt, "scheduled time");
  const deadlineAt = canonicalInstant(
    admission.terminalDeadlineAt,
    "terminal deadline",
  );
  const resolved = resolveOrchestrationPolicies(admission.policies.references);
  if (
    admission.policySetHash !== resolved.policySetHash ||
    admission.policies.policySetHash !== resolved.policySetHash ||
    policyContentHash(admission.policies.providerRetry) !==
      ORCHESTRATION_POLICY_REGISTRY.provider_retry.contentHash ||
    policyContentHash(admission.policies.runBudget) !==
      ORCHESTRATION_POLICY_REGISTRY.run_budget.contentHash ||
    policyContentHash(admission.policies.terminalDeadline) !==
      ORCHESTRATION_POLICY_REGISTRY.terminal_deadline.contentHash ||
    deadlineAt !== terminalDeadlineAt(scheduledAt, resolved.terminalDeadline)
  )
    throw new TypeError("admitted firing policy authority is inconsistent");
  const budget = decideRunBudgetAdmission({
    policy: resolved.runBudget,
    providers: admission.providers,
    state: {
      monthlyUsedCostMicrousd: 0,
      monthlyReservedCostMicrousd: 0,
      expensiveWorkBreakerTripped: false,
    },
  });
  if (
    !budget.admitted ||
    budget.providerScope.length !== admission.providerScope.length ||
    budget.providerScope.some(
      (providerId, index) => providerId !== admission.providerScope[index],
    ) ||
    !budgetsEqual(budget.runCeilings, admission.runCeilings) ||
    !Number.isSafeInteger(admission.projectedMonthlyCostMicrousd) ||
    admission.projectedMonthlyCostMicrousd < budget.runCeilings.costMicrousd ||
    admission.projectedMonthlyCostMicrousd >
      resolved.runBudget.monthlyPlatformCostCeilingMicrousd ||
    ![null, 50, 75].includes(admission.budgetAlertPercent)
  )
    throw new TypeError("admitted firing budget authority is inconsistent");
};

/** Runtime validation for persistence adapters that receive an unknown value. */
export const verifyAdmittedFiringDecision = (
  value: unknown,
): value is AdmittedFiringDecision => {
  try {
    validateAdmittedReportAuthority(value as AdmittedFiringDecision);
    return true;
  } catch {
    return false;
  }
};

/** Terminal reports derive all plan facts from the immutable admission result. */
export const buildTerminalRunReportV2 = (input: {
  admission: AdmittedFiringDecision;
  runAuthority: TerminalRunIdentityAuthorityV2;
  startedAt: string;
  endedAt: string;
  providers: readonly ProviderTerminalReportInputV2[];
  retainedPublication?: RetainedPublicationAuthorityV2;
  runWideQuarantine: boolean;
}): TerminalRunReportV2 => {
  const hasRetainedPublication = Object.prototype.hasOwnProperty.call(
    input,
    "retainedPublication",
  );
  assertExactRecord(
    input,
    [
      "admission",
      "runAuthority",
      "startedAt",
      "endedAt",
      "providers",
      ...(hasRetainedPublication ? ["retainedPublication"] : []),
      "runWideQuarantine",
    ],
    "terminal report input",
  );
  validateAdmittedReportAuthority(input.admission);
  let occurrenceId: string;
  let attemptNumber: number;
  let replayOfRunId: string | undefined;
  const runAuthorityKind: unknown = input.runAuthority.kind;
  if (runAuthorityKind === "attempt_1") {
    const runAuthority = input.runAuthority as Extract<
      TerminalRunIdentityAuthorityV2,
      Readonly<{ kind: "attempt_1" }>
    >;
    assertExactRecord(
      runAuthority,
      ["kind", "occurrenceId", "runId", "codeVersion"],
      "initial run authority",
    );
    occurrenceId = runAuthority.occurrenceId;
    attemptNumber = 1;
  } else if (runAuthorityKind === "explicit_replay") {
    const runAuthority = input.runAuthority as Extract<
      TerminalRunIdentityAuthorityV2,
      Readonly<{ kind: "explicit_replay" }>
    >;
    assertExactRecord(
      runAuthority,
      ["kind", "runId", "codeVersion", "replay"],
      "replay run authority",
    );
    assertExactRecord(
      runAuthority.replay,
      [
        "decision",
        "occurrenceId",
        "attemptNumber",
        "replayOfRunId",
        "runPlanId",
        "runPlanHash",
      ],
      "admitted replay decision",
    );
    const replayDecision: unknown = runAuthority.replay.decision;
    if (
      replayDecision !== "admit_replay" ||
      runAuthority.replay.runPlanId !== input.admission.runPlanId ||
      runAuthority.replay.runPlanHash !== input.admission.runPlanHash ||
      !Number.isSafeInteger(runAuthority.replay.attemptNumber) ||
      runAuthority.replay.attemptNumber < 2
    )
      throw new TypeError("terminal report replay authority is inconsistent");
    occurrenceId = runAuthority.replay.occurrenceId;
    attemptNumber = runAuthority.replay.attemptNumber;
    replayOfRunId = runAuthority.replay.replayOfRunId;
  } else {
    throw new TypeError("terminal report run authority is invalid");
  }
  assertCanonicalId(occurrenceId, OCCURRENCE_ID_PATTERN, "occurrence ID");
  assertCanonicalId(input.runAuthority.runId, RUN_ID_PATTERN, "run ID");
  if (
    input.providers.length !== input.admission.providers.length ||
    input.providers.some(
      (provider, index) =>
        provider.providerId !== input.admission.providers[index]?.providerId,
    )
  )
    throw new TypeError(
      "provider reports do not match admitted plan authority",
    );
  const providers = input.providers.map((provider, index): ProviderReportV2 => {
    const authority = input.admission.providers[index];
    if (authority === undefined)
      throw new TypeError("provider report lacks admitted plan authority");
    const ceiling = providerBudget(authority);
    if (BUDGET_FIELDS.some((field) => provider.cost[field] > ceiling[field]))
      throw new RangeError("provider report cost exceeds admitted ceiling");
    return {
      providerId: authority.providerId,
      adapterVersion: authority.adapterVersion,
      rosterVersion: authority.rosterVersion,
      sourceRegisterVersion: authority.sourceRegisterVersion,
      state: provider.state,
      rosterComplete: provider.rosterComplete,
      publicationDisposition: provider.publicationDisposition,
      ...(provider.sliceId === undefined ? {} : { sliceId: provider.sliceId }),
      cost: provider.cost,
      errorCodes: provider.errorCodes,
    };
  });
  if (
    BUDGET_FIELDS.some(
      (field) =>
        providers.reduce((sum, provider) => sum + provider.cost[field], 0) >
        input.admission.runCeilings[field],
    )
  )
    throw new RangeError("run report cost exceeds admitted ceiling");
  return buildTerminalRunReportFromProjectedAuthorityV2({
    scheduleName: PUBLICATION_SCHEDULE_NAME,
    scheduleExpression: PUBLICATION_SCHEDULE_EXPRESSION,
    environment: input.admission.environment,
    occurrenceId,
    runId: input.runAuthority.runId,
    attemptNumber,
    ...(replayOfRunId === undefined ? {} : { replayOfRunId }),
    runPlanId: input.admission.runPlanId,
    runPlanHash: input.admission.runPlanHash,
    policySetHash: input.admission.policySetHash,
    codeVersion: input.runAuthority.codeVersion,
    canonicalSchemaVersion: input.admission.canonicalSchemaVersion,
    pipelineContractVersion: input.admission.pipelineContractVersion,
    providerScope: input.admission.providerScope,
    scheduledAt: input.admission.scheduledAt,
    startedAt: input.startedAt,
    terminalDeadlineAt: input.admission.terminalDeadlineAt,
    endedAt: input.endedAt,
    providers,
    ...(input.retainedPublication === undefined
      ? {}
      : { retainedPublication: input.retainedPublication }),
    runWideQuarantine: input.runWideQuarantine,
  });
};

export const verifyOrchestrationReportV2 = (
  value: unknown,
  admittedAuthority?: AdmittedFiringDecision,
  runAuthority?: TerminalRunIdentityAuthorityV2,
): boolean => {
  try {
    const projection = projectCanonicalValue(value);
    assertPlainRecord(projection, "orchestration report");
    const report = projection as OrchestrationReportV2;
    const { seal: typedSeal, ...body } = report;
    const seal: Readonly<{ algorithm: string; contentHash: string }> =
      typedSeal;
    if (!(
      seal.algorithm === "sha256" &&
      /^sha256:[0-9a-f]{64}$/.test(seal.contentHash) &&
      seal.contentHash ===
        sha256AsciiDigest(
          canonicalJson({
            domain: "quantclarity:publication-run-report@2",
            body,
          }),
        )
    ))
      return false;
    let rebuilt: OrchestrationReportV2;
    if (report.kind === "rejected_firing") {
      rebuilt = buildRejectedFiringReportV2({
        scheduleName: report.scheduleName,
        scheduleExpression: report.scheduleExpression,
        occurrenceId: report.occurrenceId,
        scheduledAt: report.scheduledAt,
        observedAt: report.observedAt,
        rejectionCode: report.rejectionCode,
        requestedPlan: report.requestedPlan,
      });
    } else {
      if (admittedAuthority === undefined || runAuthority === undefined)
        return false;
      rebuilt = buildTerminalRunReportV2({
        admission: admittedAuthority,
        runAuthority,
        startedAt: report.startedAt,
        endedAt: report.endedAt,
        providers: report.providers.map((provider) => ({
          providerId: provider.providerId,
          state: provider.state,
          rosterComplete: provider.rosterComplete,
          publicationDisposition: provider.publicationDisposition,
          ...(provider.sliceId === undefined
            ? {}
            : { sliceId: provider.sliceId }),
          cost: provider.cost,
          errorCodes: provider.errorCodes,
        })),
        ...(report.retainedPublication === undefined
          ? {}
          : { retainedPublication: report.retainedPublication }),
        runWideQuarantine: report.runOutcome === "quarantined",
      });
    }
    return canonicalJson(rebuilt) === canonicalJson(report);
  } catch {
    return false;
  }
};

/**
 * Returns the one deterministic bounded persistence representation only after
 * the report has been rebuilt from its immutable authority. Object insertion
 * order therefore cannot create a second durable representation of the same
 * sealed report.
 */
export const encodeOrchestrationReportV2 = (
  value: unknown,
  admittedAuthority?: AdmittedFiringDecision,
  runAuthority?: TerminalRunIdentityAuthorityV2,
): string => {
  let projection: CanonicalValue;
  try {
    projection = projectCanonicalValue(value);
  } catch {
    throw new TypeError(
      "orchestration report does not match its immutable authority",
    );
  }
  if (!verifyOrchestrationReportV2(projection, admittedAuthority, runAuthority))
    throw new TypeError(
      "orchestration report does not match its immutable authority",
    );
  return encodeCanonicalProjection(projection);
};
