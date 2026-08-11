import { describe, expect, it, vi } from "vitest";

import {
  APPROVED_PUBLICATION_SCHEDULE,
  DORMANT_PUBLICATION_WORKFLOW_NAME,
  DORMANT_PUBLICATION_WORKFLOW_PLAN_VERSION,
  DORMANT_PUBLICATION_WORKFLOW_STEP_NAME,
  runDormantPublicationWorkflow,
  type DormantPublicationWorkflowInputError,
  type PublicationWorkflowStepPort,
} from "./publication-workflow-plan.js";

const MONDAY = Date.parse("2026-08-03T05:00:00.000Z");
const THURSDAY = Date.parse("2026-08-06T05:00:00.000Z");

const event = (
  override: Partial<{
    payload: unknown;
    timestamp: Date;
    instanceId: string;
    workflowName: string;
    schedule: unknown;
  }> = {},
) => ({
  payload: {},
  timestamp: new Date(MONDAY + 1_000),
  instanceId: "platform-instance-a",
  workflowName: DORMANT_PUBLICATION_WORKFLOW_NAME,
  schedule: { cron: "0 5 * * 1,4", scheduledTime: MONDAY },
  ...override,
});

const recordingStep = (
  repeatCallback = false,
): {
  readonly port: PublicationWorkflowStepPort;
  readonly names: string[];
  callbackCount(): number;
} => {
  const names: string[] = [];
  let callbackCount = 0;
  return {
    names,
    callbackCount: () => callbackCount,
    port: {
      async do<T>(name: string, callback: () => Promise<T>): Promise<T> {
        names.push(name);
        callbackCount += 1;
        const first = await callback();
        if (repeatCallback) {
          callbackCount += 1;
          expect(await callback()).toEqual(first);
        }
        return first;
      },
    },
  };
};

const expectCode = async (
  promise: Promise<unknown>,
  code: DormantPublicationWorkflowInputError["code"],
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({
    name: "DormantPublicationWorkflowInputError",
    code,
    message: code,
  });
};

describe("dormant PublicationWorkflow planner (PIPE-001–PIPE-004, CF-005–CF-007)", () => {
  it("projects the approved Monday schedule into a closed non-authoritative plan", async () => {
    const step = recordingStep();
    const plan = await runDormantPublicationWorkflow(event(), step.port);

    expect(APPROVED_PUBLICATION_SCHEDULE).toEqual({
      name: "provider-refresh-v1",
      utcWeekdays: [1, 4],
      utcHour: 5,
      utcMinute: 0,
    });
    expect(plan).toEqual({
      plan_version: DORMANT_PUBLICATION_WORKFLOW_PLAN_VERSION,
      authority: "dormant_unbound_no_io",
      execution_authority: false,
      occurrence: {
        occurrenceId: "occ_bf9bd361-756b-4d0e-a22d-fa90081fc4e4",
        occurrenceKey:
          "occurrence|19:provider-refresh-v1|24:2026-08-03T05:00:00.000Z",
        scheduleName: "provider-refresh-v1",
        scheduleExpression: "0 5 * * 1,4",
        scheduledAt: "2026-08-03T05:00:00.000Z",
      },
    });
    expect(Reflect.ownKeys(plan)).toEqual([
      "plan_version",
      "authority",
      "execution_authority",
      "occurrence",
    ]);
    expect(Reflect.ownKeys(plan.occurrence)).toEqual([
      "occurrenceId",
      "occurrenceKey",
      "scheduleName",
      "scheduleExpression",
      "scheduledAt",
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.occurrence)).toBe(true);
    expect(JSON.stringify(plan).length).toBeLessThan(4_096);
    expect(step.names).toEqual([DORMANT_PUBLICATION_WORKFLOW_STEP_NAME]);
  });

  it("accepts the approved Thursday occurrence and changes its stable identity", async () => {
    const monday = await runDormantPublicationWorkflow(
      event(),
      recordingStep().port,
    );
    const thursday = await runDormantPublicationWorkflow(
      event({
        timestamp: new Date(THURSDAY + 1),
        schedule: { cron: "0 5 * * 1,4", scheduledTime: THURSDAY },
      }),
      recordingStep().port,
    );
    expect(thursday.occurrence.scheduledAt).toBe("2026-08-06T05:00:00.000Z");
    expect(thursday.occurrence.occurrenceId).not.toBe(
      monday.occurrence.occurrenceId,
    );
  });

  it("ignores delivery time and platform instance identity", async () => {
    const first = await runDormantPublicationWorkflow(
      event(),
      recordingStep().port,
    );
    const duplicateDelivery = await runDormantPublicationWorkflow(
      event({
        timestamp: new Date(MONDAY + 8 * 60 * 60 * 1_000),
        instanceId: "another-platform-instance",
      }),
      recordingStep().port,
    );
    expect(duplicateDelivery).toEqual(first);
    expect(JSON.stringify(duplicateDelivery)).not.toContain(
      "platform-instance",
    );
  });

  it("uses one deterministic pure step whose callback is replay-stable", async () => {
    const step = recordingStep(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await runDormantPublicationWorkflow(event(), step.port);
      expect(step.names).toEqual([DORMANT_PUBLICATION_WORKFLOW_STEP_NAME]);
      expect(step.callbackCount()).toBe(2);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it.each([
    ["missing schedule", { schedule: undefined }, "schedule_invalid"],
    [
      "wrong cron",
      { schedule: { cron: "1 5 * * 1,4", scheduledTime: MONDAY } },
      "schedule_not_approved",
    ],
    [
      "wrong day",
      {
        timestamp: new Date("2026-08-04T05:00:01.000Z"),
        schedule: {
          cron: "0 5 * * 1,4",
          scheduledTime: Date.parse("2026-08-04T05:00:00.000Z"),
        },
      },
      "schedule_not_approved",
    ],
    [
      "wrong hour",
      {
        timestamp: new Date("2026-08-03T06:00:01.000Z"),
        schedule: {
          cron: "0 5 * * 1,4",
          scheduledTime: Date.parse("2026-08-03T06:00:00.000Z"),
        },
      },
      "schedule_not_approved",
    ],
    [
      "sub-minute time",
      {
        schedule: { cron: "0 5 * * 1,4", scheduledTime: MONDAY + 1 },
      },
      "schedule_not_approved",
    ],
    [
      "negative time",
      { schedule: { cron: "0 5 * * 1,4", scheduledTime: -1 } },
      "scheduled_time_invalid",
    ],
    [
      "fractional time",
      { schedule: { cron: "0 5 * * 1,4", scheduledTime: MONDAY + 0.5 } },
      "scheduled_time_invalid",
    ],
    [
      "unsafe time",
      {
        schedule: {
          cron: "0 5 * * 1,4",
          scheduledTime: Number.MAX_SAFE_INTEGER + 1,
        },
      },
      "scheduled_time_invalid",
    ],
    [
      "delivery before schedule",
      { timestamp: new Date(MONDAY - 1) },
      "platform_timestamp_precedes_schedule",
    ],
  ] as const)(
    "rejects %s before entering a step",
    async (_name, override, code) => {
      const step = recordingStep();
      await expectCode(
        runDormantPublicationWorkflow(event(override), step.port),
        code,
      );
      expect(step.names).toEqual([]);
    },
  );

  it.each([
    "enabled",
    "authorized",
    "environment",
    "providers",
    "url",
    "stepName",
    "instanceId",
    "writer",
    "attempt",
    "replay",
  ])("rejects payload authority attempt %s", async (key) => {
    const step = recordingStep();
    await expectCode(
      runDormantPublicationWorkflow(
        event({ payload: { [key]: "hostile-value-that-must-not-escape" } }),
        step.port,
      ),
      "payload_not_empty",
    );
    expect(step.names).toEqual([]);
  });

  it("rejects the manual empty event and an unapproved Workflow name", async () => {
    await expectCode(
      runDormantPublicationWorkflow({}, recordingStep().port),
      "event_shape_invalid",
    );
    await expectCode(
      runDormantPublicationWorkflow(
        event({ workflowName: "unapproved-workflow" }),
        recordingStep().port,
      ),
      "workflow_name_not_approved",
    );
  });

  it("rejects additive, symbolic, and prototype-hostile event shapes", async () => {
    await expectCode(
      runDormantPublicationWorkflow(
        { ...event(), enable: true },
        recordingStep().port,
      ),
      "event_shape_invalid",
    );
    const symbolic = event() as ReturnType<typeof event> &
      Record<symbol, boolean>;
    symbolic[Symbol("authority")] = true;
    await expectCode(
      runDormantPublicationWorkflow(symbolic, recordingStep().port),
      "event_shape_invalid",
    );
    const inherited = Object.assign(
      Object.create({ enable: true }) as Record<string, unknown>,
      event(),
    );
    await expectCode(
      runDormantPublicationWorkflow(inherited, recordingStep().port),
      "event_invalid",
    );
  });

  it("rejects accessors without reading them", async () => {
    let reads = 0;
    const hostile = event();
    Object.defineProperty(hostile, "schedule", {
      enumerable: true,
      get() {
        reads += 1;
        return { cron: "0 5 * * 1,4", scheduledTime: MONDAY };
      },
    });
    await expectCode(
      runDormantPublicationWorkflow(hostile, recordingStep().port),
      "event_shape_invalid",
    );
    expect(reads).toBe(0);
  });

  it("uses fixed non-sensitive validation messages", async () => {
    const hostile = "secret-provider-url.example/private?token=do-not-copy";
    const promise = runDormantPublicationWorkflow(
      event({ payload: { url: hostile } }),
      recordingStep().port,
    );
    await expect(promise).rejects.not.toThrow(hostile);
    await expectCode(promise, "payload_not_empty");
  });
});
