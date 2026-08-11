import { WorkerEntrypoint } from "cloudflare:workers";

import type {
  CatalogQueryRpcV6,
  ReadDatasetMetadataV1Outcome,
  ReadMethodologyContextV1Outcome,
  ReadModelDetailV1Outcome,
  ReadModelDetailV2Outcome,
} from "@quant-clarity/api-core";

import {
  readDatasetMetadataV1,
  readExactModelCardSearchV1,
  readExactVariantCardSearchV1,
  readMethodologyContextV1,
  readModelDetailV1,
  readModelDetailV2,
  readModelVariantExactNameTierV1,
  readMergedExactSearchV1,
  readMergedExactSearchV2,
  readProviderModelIdExactTierV1,
  readProviderExactNameTierV1,
  resolvePublicationV1,
  resolvePublicationV2,
  type ReadModelVariantExactNameTierV1Outcome,
  type ReadExactModelCardSearchV1Outcome,
  type ReadExactVariantCardSearchV1Outcome,
  type ReadMergedExactSearchV1Outcome,
  type ReadMergedExactSearchV2Outcome,
  type ReadProviderModelIdExactTierV1Outcome,
  type ReadProviderExactNameTierV1Outcome,
  type ResolvePublicationV1Outcome,
  type ResolvePublicationV2Outcome,
} from "./catalog-query-rpc.js";

type CatalogQueryEnv = CloudflareEnv & {
  SERVING_DB: D1Database;
  DEPLOYMENT_ENVIRONMENT: string;
  PUBLIC_API_ORIGIN: string;
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

export class CatalogQueryService
  extends WorkerEntrypoint<CatalogQueryEnv>
  implements CatalogQueryRpcV6
{
  resolvePublicationV1(input: unknown): Promise<ResolvePublicationV1Outcome> {
    return resolvePublicationV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }

  resolvePublicationV2(input: unknown): Promise<ResolvePublicationV2Outcome> {
    return resolvePublicationV2(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }

  readDatasetMetadataV1(input: unknown): Promise<ReadDatasetMetadataV1Outcome> {
    return readDatasetMetadataV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      this.env.PUBLIC_API_ORIGIN,
      Date.now(),
      input,
    );
  }

  readMethodologyContextV1(
    input: unknown,
  ): Promise<ReadMethodologyContextV1Outcome> {
    return readMethodologyContextV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      this.env.PUBLIC_API_ORIGIN,
      input,
    );
  }

  readModelDetailV1(input: unknown): Promise<ReadModelDetailV1Outcome> {
    return readModelDetailV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }

  readModelDetailV2(input: unknown): Promise<ReadModelDetailV2Outcome> {
    return readModelDetailV2(
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

  readModelVariantExactNameTierV1(
    input: unknown,
  ): Promise<ReadModelVariantExactNameTierV1Outcome> {
    return readModelVariantExactNameTierV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }

  readProviderModelIdExactTierV1(
    input: unknown,
  ): Promise<ReadProviderModelIdExactTierV1Outcome> {
    return readProviderModelIdExactTierV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }

  readMergedExactSearchV1(
    input: unknown,
  ): Promise<ReadMergedExactSearchV1Outcome> {
    return readMergedExactSearchV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }

  readMergedExactSearchV2(
    input: unknown,
  ): Promise<ReadMergedExactSearchV2Outcome> {
    return readMergedExactSearchV2(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }

  readExactModelCardSearchV1(
    input: unknown,
  ): Promise<ReadExactModelCardSearchV1Outcome> {
    return readExactModelCardSearchV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }

  readExactVariantCardSearchV1(
    input: unknown,
  ): Promise<ReadExactVariantCardSearchV1Outcome> {
    return readExactVariantCardSearchV1(
      this.env.SERVING_DB,
      this.env.DEPLOYMENT_ENVIRONMENT,
      input,
    );
  }
}

export default { fetch } satisfies ExportedHandler<CloudflareEnv>;
