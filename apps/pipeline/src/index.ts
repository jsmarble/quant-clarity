import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import {
  DormantPublicationWorkflowInputError,
  runDormantPublicationWorkflow,
} from "./publication-workflow-plan.js";

export class PublicationWorkflow extends WorkflowEntrypoint<
  CloudflareEnv,
  Record<string, never>
> {
  override async run(
    event: WorkflowEvent<Record<string, never>>,
    step: WorkflowStep,
  ) {
    try {
      return await runDormantPublicationWorkflow(event, step);
    } catch (error) {
      if (error instanceof DormantPublicationWorkflowInputError)
        throw new NonRetryableError(error.code, error.name);
      throw error;
    }
  }
}

function fetch(): Response {
  return Response.json(
    {
      error: {
        code: "private_control_plane",
        message: "This service has no public route.",
      },
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export default { fetch } satisfies ExportedHandler<CloudflareEnv>;
