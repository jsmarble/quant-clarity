import { WorkerEntrypoint } from "cloudflare:workers";

import {
  readProviderExactNameTierV1,
  resolvePublicationV1,
  type ReadProviderExactNameTierV1Outcome,
  type ResolvePublicationV1Outcome,
} from "./catalog-query-rpc.js";

type CatalogQueryEnv = CloudflareEnv & {
  SERVING_DB: D1Database;
  DEPLOYMENT_ENVIRONMENT: string;
};

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

function fetch(): Response {
  return Response.json(
    {
      error: {
        code: "service_binding_required",
        message: "This service has no public route.",
      },
    },
    { status: 404, headers: SECURITY_HEADERS },
  );
}

export class CatalogQueryService extends WorkerEntrypoint<CatalogQueryEnv> {
  resolvePublicationV1(input: unknown): Promise<ResolvePublicationV1Outcome> {
    return resolvePublicationV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }

  readProviderExactNameTierV1(
    input: unknown,
  ): Promise<ReadProviderExactNameTierV1Outcome> {
    return readProviderExactNameTierV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }
}

export default { fetch } satisfies ExportedHandler<CloudflareEnv>;
