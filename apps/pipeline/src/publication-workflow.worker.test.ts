import {
  exports as workerExports,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { describe, expect, it } from "vitest";

import { PublicationWorkflow } from "./index.js";
import {
  DORMANT_PUBLICATION_WORKFLOW_NAME,
  DORMANT_PUBLICATION_WORKFLOW_STEP_NAME,
} from "./publication-workflow-plan.js";

const scheduledTime = Date.parse("2026-08-03T05:00:00.000Z");

const scheduledEvent = (): WorkflowEvent<Record<string, never>> => ({
  payload: {},
  timestamp: new Date(scheduledTime + 1_000),
  instanceId: "local-platform-instance",
  workflowName: DORMANT_PUBLICATION_WORKFLOW_NAME,
  schedule: {
    cron: "0 5 * * 1,4",
    scheduledTime,
  },
});

const step = (): WorkflowStep =>
  ({
    async do<T>(name: string, callback: () => Promise<T>): Promise<T> {
      expect(name).toBe(DORMANT_PUBLICATION_WORKFLOW_STEP_NAME);
      return callback();
    },
  }) as unknown as WorkflowStep;

describe("unbound PublicationWorkflow Worker shape", () => {
  it("runs the named entrypoint without reading an environment binding", async () => {
    const plan = await PublicationWorkflow.prototype.run.call(
      Object.create(PublicationWorkflow.prototype) as PublicationWorkflow,
      scheduledEvent(),
      step(),
    );
    expect(plan).toMatchObject({
      authority: "dormant_unbound_no_io",
      execution_authority: false,
      occurrence: {
        occurrenceId: "occ_bf9bd361-756b-4d0e-a22d-fa90081fc4e4",
      },
    });
  });

  it("converts invalid scheduled input into a fixed non-retryable error", async () => {
    let caught: unknown;
    try {
      await PublicationWorkflow.prototype.run.call(
        Object.create(PublicationWorkflow.prototype) as PublicationWorkflow,
        {
          ...scheduledEvent(),
          payload: { enabled: true },
        } as unknown as WorkflowEvent<Record<string, never>>,
        step(),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NonRetryableError);
    expect(caught).toMatchObject({
      name: "DormantPublicationWorkflowInputError",
      message: "payload_not_empty",
    });
  });

  it("preserves the private fixed 404 default fetch surface", async () => {
    const response = await workerExports.default.fetch(
      new Request("https://pipeline.invalid/"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "private_control_plane",
        message: "This service has no public route.",
      },
    });
  });
});
