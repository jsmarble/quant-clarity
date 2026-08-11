import {
  createScheduleOccurrence,
  scheduleExpression,
  type ScheduleOccurrence,
} from "@quant-clarity/pipeline-core";

export const DORMANT_PUBLICATION_WORKFLOW_PLAN_VERSION =
  "dormant-publication-workflow-plan@1" as const;
export const DORMANT_PUBLICATION_WORKFLOW_NAME =
  "quant-clarity-publication-preview" as const;
export const DORMANT_PUBLICATION_WORKFLOW_STEP_NAME =
  "dormant-publication-plan-v1" as const;

export const APPROVED_PUBLICATION_SCHEDULE = Object.freeze({
  name: "provider-refresh-v1",
  utcWeekdays: Object.freeze([1, 4] as const),
  utcHour: 5,
  utcMinute: 0,
});

const APPROVED_SCHEDULE_EXPRESSION = scheduleExpression(
  APPROVED_PUBLICATION_SCHEDULE,
);

export type DormantPublicationWorkflowPlan = Readonly<{
  plan_version: typeof DORMANT_PUBLICATION_WORKFLOW_PLAN_VERSION;
  authority: "dormant_unbound_no_io";
  execution_authority: false;
  occurrence: Readonly<
    Pick<
      ScheduleOccurrence,
      | "occurrenceId"
      | "occurrenceKey"
      | "scheduleName"
      | "scheduleExpression"
      | "scheduledAt"
    >
  >;
}>;

export const DORMANT_PUBLICATION_WORKFLOW_ERROR_CODES = [
  "event_invalid",
  "event_shape_invalid",
  "payload_not_empty",
  "platform_timestamp_invalid",
  "platform_timestamp_precedes_schedule",
  "schedule_invalid",
  "schedule_not_approved",
  "scheduled_time_invalid",
  "workflow_identity_invalid",
  "workflow_name_not_approved",
] as const;

export type DormantPublicationWorkflowErrorCode =
  (typeof DORMANT_PUBLICATION_WORKFLOW_ERROR_CODES)[number];

export class DormantPublicationWorkflowInputError extends TypeError {
  readonly code: DormantPublicationWorkflowErrorCode;

  constructor(code: DormantPublicationWorkflowErrorCode) {
    super(code);
    this.name = "DormantPublicationWorkflowInputError";
    this.code = code;
  }
}

const fail = (code: DormantPublicationWorkflowErrorCode): never => {
  throw new DormantPublicationWorkflowInputError(code);
};

export type PublicationWorkflowStepPort = Readonly<{
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
}>;

type ScheduledWorkflowEvent = Readonly<{
  payload: unknown;
  timestamp: Date;
  instanceId: string;
  workflowName: string;
  schedule: Readonly<{
    cron: string;
    scheduledTime: number;
  }>;
}>;

const exactOwnDataRecord = (
  value: unknown,
  keys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail(
      label === "publication Workflow event"
        ? "event_invalid"
        : "schedule_invalid",
    );
  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return fail(
      label === "publication Workflow event"
        ? "event_invalid"
        : "schedule_invalid",
    );
  }
  if (prototype !== Object.prototype && prototype !== null)
    return fail(
      label === "publication Workflow event"
        ? "event_invalid"
        : "schedule_invalid",
    );
  if (
    ownKeys.some((key) => typeof key !== "string") ||
    ownKeys.length !== keys.length ||
    keys.some((key) => !ownKeys.includes(key))
  )
    return fail(
      label === "publication Workflow event"
        ? "event_shape_invalid"
        : "schedule_invalid",
    );
  const snapshot: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor))
      return fail(
        label === "publication Workflow event"
          ? "event_shape_invalid"
          : "schedule_invalid",
      );
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
};

const assertEmptyPayload = (payload: unknown): void => {
  if (payload === undefined || payload === null) return;
  try {
    exactOwnDataRecord(payload, [], "publication Workflow payload");
  } catch {
    fail("payload_not_empty");
  }
};

const assertBoundedAscii: (
  value: unknown,
  maximumLength: number,
) => asserts value is string = (value, maximumLength) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    !/^[\x20-\x7e]+$/u.test(value)
  )
    fail("workflow_identity_invalid");
};

const scheduledEvent = (value: unknown): ScheduledWorkflowEvent => {
  const event = exactOwnDataRecord(
    value,
    ["payload", "timestamp", "instanceId", "workflowName", "schedule"],
    "publication Workflow event",
  );
  assertEmptyPayload(event.payload);
  assertBoundedAscii(event.instanceId, 100);
  assertBoundedAscii(event.workflowName, 64);
  if (event.workflowName !== DORMANT_PUBLICATION_WORKFLOW_NAME)
    fail("workflow_name_not_approved");
  if (!(event.timestamp instanceof Date)) fail("platform_timestamp_invalid");
  let platformTimestamp: number;
  try {
    platformTimestamp = Date.prototype.getTime.call(event.timestamp);
    if (!Number.isFinite(platformTimestamp)) fail("platform_timestamp_invalid");
  } catch {
    return fail("platform_timestamp_invalid");
  }
  const schedule = exactOwnDataRecord(
    event.schedule,
    ["cron", "scheduledTime"],
    "publication Workflow schedule",
  );
  if (schedule.cron !== APPROVED_SCHEDULE_EXPRESSION)
    fail("schedule_not_approved");
  if (
    !Number.isSafeInteger(schedule.scheduledTime) ||
    (schedule.scheduledTime as number) < 0
  )
    fail("scheduled_time_invalid");
  const scheduledDate = new Date(schedule.scheduledTime as number);
  if (!Number.isFinite(scheduledDate.getTime())) fail("scheduled_time_invalid");
  if (platformTimestamp < (schedule.scheduledTime as number))
    fail("platform_timestamp_precedes_schedule");
  return Object.freeze({
    payload: event.payload,
    timestamp: event.timestamp,
    instanceId: event.instanceId,
    workflowName: event.workflowName,
    schedule: Object.freeze({
      cron: schedule.cron,
      scheduledTime: schedule.scheduledTime,
    }),
  }) as ScheduledWorkflowEvent;
};

const buildDormantPlan = (
  event: ScheduledWorkflowEvent,
): DormantPublicationWorkflowPlan => {
  const scheduledAt = new Date(event.schedule.scheduledTime).toISOString();
  let occurrence: ScheduleOccurrence;
  try {
    occurrence = createScheduleOccurrence({
      config: APPROVED_PUBLICATION_SCHEDULE,
      scheduledAt,
      // Planning is deliberately independent of platform delivery time and
      // instance identity. Durable admission will own the actual created time.
      createdAt: scheduledAt,
    });
  } catch {
    return fail("schedule_not_approved");
  }
  return Object.freeze({
    plan_version: DORMANT_PUBLICATION_WORKFLOW_PLAN_VERSION,
    authority: "dormant_unbound_no_io",
    execution_authority: false,
    occurrence: Object.freeze({
      occurrenceId: occurrence.occurrenceId,
      occurrenceKey: occurrence.occurrenceKey,
      scheduleName: occurrence.scheduleName,
      scheduleExpression: occurrence.scheduleExpression,
      scheduledAt: occurrence.scheduledAt,
    }),
  });
};

/**
 * Runtime-validates an exact direct-schedule event, then persists only a pure,
 * non-authoritative plan in one deterministic Workflow step. It cannot start a
 * run, write storage, fan out children, acquire sources, or express a replay.
 */
export const runDormantPublicationWorkflow = async (
  untrustedEvent: unknown,
  step: PublicationWorkflowStepPort,
): Promise<DormantPublicationWorkflowPlan> => {
  const event = scheduledEvent(untrustedEvent);
  const plan = buildDormantPlan(event);
  return step.do(DORMANT_PUBLICATION_WORKFLOW_STEP_NAME, () =>
    Promise.resolve(plan),
  );
};
