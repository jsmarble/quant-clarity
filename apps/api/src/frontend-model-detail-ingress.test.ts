import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRONTEND_API_ENVELOPE_HEADER,
  FRONTEND_API_INTERNAL_ORIGIN,
  signFrontendApiRequest,
  type ModelDetailQueryRpcV2,
} from "@quant-clarity/api-core";

import { handleRequest } from "./request.js";

const FRONTEND_SECRET = "frontend-test-secret-with-at-least-32-characters";
const LIMITER_SECRET = "limiter-test-secret-with-at-least-32-characters";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const OTHER_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const FAMILY_ID = "fam_11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const NOW_MS = 1_786_339_200_000;

const known = (value: unknown) => ({
  evidence_ids: [EVIDENCE_ID],
  observed_at: OBSERVED_AT,
  state: "known",
  value,
});

const unknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown",
  value: null,
});

const model = () => ({
  active_parameters: unknown(),
  architecture: unknown(),
  authoritative_checkpoint_ids: [],
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: OBSERVED_AT,
    value: 0,
  },
  checkpoints: [],
  context_window_tokens: unknown(),
  display_name: known("Signed Model"),
  family_id: FAMILY_ID,
  last_model_data_refresh: known(OBSERVED_AT),
  license: unknown(),
  maximum_output_tokens: unknown(),
  modalities: unknown(),
  model_id: MODEL_ID,
  publisher: known("Fixture Publisher"),
  release_date: unknown(),
  slug: known("signed-model"),
  source_quantization: unknown(),
  source_weight_format: unknown(),
  status: known("active"),
  total_parameters: unknown(),
});

const service = () =>
  ({
    readModelDetailV1: vi.fn(),
    resolvePublicationV2: vi.fn((input: unknown) => {
      const requiredAvailableUntilMs = (
        input as { requiredAvailableUntilMs: number }
      ).requiredAvailableUntilMs;
      return Promise.resolve({
        bookmark: "bookmark-signed-model",
        outcome: "selected",
        publicationId: PUBLICATION,
        requiredAvailableUntilMs,
      });
    }),
    readModelDetailV2: vi.fn((input: unknown) => {
      void input;
      return Promise.resolve({
        lookupProvenance: {
          canonicalSlug: "signed-model",
          matchedBy: "stable_id",
          projectionVersion: "model-slug@1",
        },
        model: model(),
        outcome: "model",
        publicationId: PUBLICATION,
        schemaVersion: "1.13.0",
      });
    }),
  }) satisfies ModelDetailQueryRpcV2;

type DeploymentEnvironment = "local" | "test" | "preview" | "production";

const guardedEnvironment = (
  deploymentEnvironment: DeploymentEnvironment = "local",
) => {
  let limiterCapabilityReads = 0;
  const queryService = service();
  const env = {
    API_TRANSPORT_POLICY: "local_test",
    CATALOG_QUERY: queryService,
    DEPLOYMENT_ENV: deploymentEnvironment,
    FRONTEND_API_HMAC_CURRENT: FRONTEND_SECRET,
    PUBLIC_API_ORIGIN: "https://api.example.test",
  } as Record<string, unknown>;
  for (const name of [
    "RATE_LIMIT_HMAC_KEY",
    "READ_LIMITER",
    "ROTATION_LIMITER",
  ])
    Object.defineProperty(env, name, {
      enumerable: true,
      get() {
        limiterCapabilityReads += 1;
        throw new Error(`${name} must not be read for internal ingress`);
      },
    });
  return {
    env: env as unknown as Parameters<typeof handleRequest>[1],
    limiterCapabilityReads: () => limiterCapabilityReads,
    queryService,
  };
};

type SignedRequestOptions = Readonly<{
  bareQueryMarker?: boolean;
  bodyPresent?: boolean;
  deploymentEnvironment?: DeploymentEnvironment;
  extraHeaders?: Readonly<Record<string, string>>;
  fragment?: string;
  method?: "GET" | "HEAD";
  path?: string;
  publicationHeader?: string | null;
  publicationId?: string | null;
  rawQuery?: string;
}>;

const signedRequest = async (
  options: SignedRequestOptions = {},
): Promise<Request> => {
  const path = options.path ?? `/v1/models/${MODEL_ID}`;
  const method = options.method ?? "GET";
  const publicationId =
    options.publicationId === undefined ? PUBLICATION : options.publicationId;
  const rawQuery = options.rawQuery ?? "";
  const headers = await signFrontendApiRequest({
    environment: options.deploymentEnvironment ?? "local",
    method,
    nowMs: NOW_MS,
    path,
    publicationId,
    rawQuery,
    secret: FRONTEND_SECRET,
    subtle: crypto.subtle,
  });
  if (headers === null) throw new Error("test signing failed");
  const publicationHeader =
    options.publicationHeader === undefined
      ? publicationId
      : options.publicationHeader;
  if (publicationHeader !== null)
    headers.set("X-QuantClarity-Publication", publicationHeader);
  for (const [name, value] of Object.entries(options.extraHeaders ?? {}))
    headers.set(name, value);
  const query =
    rawQuery === ""
      ? options.bareQueryMarker === true
        ? "?"
        : ""
      : `?${rawQuery}`;
  const native = new Request(
    `${FRONTEND_API_INTERNAL_ORIGIN}${path}${query}${options.fragment ?? ""}`,
    { headers, method },
  );
  if (options.bodyPresent !== true) return native;
  return {
    body: {},
    headers: native.headers,
    method: native.method,
    url: native.url,
  } as unknown as Request;
};

const guardSourceAddress = (request: Request) => {
  let sourceAddressReads = 0;
  const headers = request.headers;
  const guarded = {
    get body() {
      return request.body;
    },
    headers: {
      get(name: string) {
        if (name.toLowerCase() === "cf-connecting-ip") {
          sourceAddressReads += 1;
          throw new Error("source address must not be read before admission");
        }
        return headers.get(name);
      },
      keys() {
        return headers.keys();
      },
    },
    method: request.method,
    url: request.url,
  } as unknown as Request;
  return { guarded, sourceAddressReads: () => sourceAddressReads };
};

const context = (scheduled: Promise<void>[]): ExecutionContext =>
  ({
    waitUntil(promise: Promise<unknown>) {
      scheduled.push(Promise.resolve(promise).then(() => undefined));
    },
  }) as unknown as ExecutionContext;

const expectClosed = async (
  request: Request,
  deploymentEnvironment: DeploymentEnvironment = "local",
) => {
  const runtime = guardedEnvironment(deploymentEnvironment);
  const guarded = guardSourceAddress(request);
  const response = await handleRequest(guarded.guarded, runtime.env);
  expect(response.status).toBe(404);
  if (request.method === "HEAD") expect(await response.text()).toBe("");
  else
    expect(await response.json()).toEqual({
      error: {
        code: "resource_not_found",
        message: "The requested resource does not exist.",
      },
    });
  expect(response.headers.get("X-QuantClarity-Publication")).toBeNull();
  expect(response.headers.get("Vary")).toBeNull();
  expect(guarded.sourceAddressReads()).toBe(0);
  expect(runtime.limiterCapabilityReads()).toBe(0);
  expect(runtime.queryService.resolvePublicationV2).not.toHaveBeenCalled();
  expect(runtime.queryService.readModelDetailV2).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("signed frontend Model-detail ingress (FE-030, API-003, SEC-001, SEC-011, PRIV-006)", () => {
  it("admits one signed, pinned local Model read without source-address or limiter capability access", async () => {
    const runtime = guardedEnvironment();
    const incoming = guardSourceAddress(await signedRequest());
    const cache = {
      match: vi.fn(() => Promise.resolve(undefined)),
      put: vi.fn(() => Promise.resolve()),
    };
    vi.stubGlobal("caches", { default: cache });
    const scheduled: Promise<void>[] = [];

    const response = await handleRequest(
      incoming.guarded,
      runtime.env,
      context(scheduled),
    );
    await Promise.all(scheduled);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      PUBLICATION,
    );
    expect(response.headers.get("Vary")).toBe("X-QuantClarity-Publication");
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=0, must-revalidate",
    );
    expect(
      (await response.json<{ data: { model_id: string } }>()).data.model_id,
    ).toBe(MODEL_ID);
    expect(incoming.sourceAddressReads()).toBe(0);
    expect(runtime.limiterCapabilityReads()).toBe(0);
    expect(runtime.queryService.resolvePublicationV2).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "local",
        requestedPublicationId: PUBLICATION,
      }),
    );
    expect(runtime.queryService.readModelDetailV2).toHaveBeenCalledOnce();
    const queryInput =
      runtime.queryService.readModelDetailV2.mock.calls[0]?.[0];
    expect(queryInput).toEqual(
      expect.objectContaining({
        environment: "local",
        lookup: { kind: "stable_id", value: MODEL_ID },
      }),
    );
    expect(JSON.stringify(queryInput)).not.toContain(FRONTEND_SECRET);
    expect(JSON.stringify(queryInput)).not.toContain("cf-connecting-ip");
    expect(cache.match).toHaveBeenCalledOnce();
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it("rejects a forged signed envelope without source, limiter, or canonical-read effects", async () => {
    const request = await signedRequest();
    request.headers.set(FRONTEND_API_ENVELOPE_HEADER, "forged");
    await expectClosed(request);
  });

  it("rejects an unpinned Model request without effects", async () => {
    await expectClosed(
      await signedRequest({ publicationHeader: null, publicationId: null }),
    );
  });

  it.each(["test", "preview", "production"] as const)(
    "keeps signed Model ingress closed in %s",
    async (deploymentEnvironment) => {
      await expectClosed(
        await signedRequest({ deploymentEnvironment }),
        deploymentEnvironment,
      );
    },
  );

  it.each([
    ["query", { rawQuery: "q=visitor" }],
    ["bare query marker", { bareQueryMarker: true }],
    ["fragment", { fragment: "#visitor" }],
    ["body", { bodyPresent: true }],
    ["conditional", { extraHeaders: { "If-None-Match": '"opaque"' } }],
    ["malformed identifier", { path: "/v1/models/bad_identifier" }],
    ["trailing segment", { path: `/v1/models/${MODEL_ID}/extra` }],
    ["HEAD", { method: "HEAD" }],
  ] as const)(
    "rejects a signed %s shape without effects",
    async (_label, options) => {
      await expectClosed(await signedRequest(options));
    },
  );

  it("rejects a signed publication/header mismatch without effects", async () => {
    await expectClosed(
      await signedRequest({ publicationHeader: OTHER_PUBLICATION }),
    );
  });

  it("preserves public Model closure behind the public limiter", async () => {
    const limiterKeys: string[] = [];
    const limiter: RateLimit = {
      limit({ key }) {
        limiterKeys.push(key);
        return Promise.resolve({ success: true });
      },
    };
    const queryService = service();
    const response = await handleRequest(
      new Request(`https://api.example.test/v1/models/${MODEL_ID}`, {
        headers: { "CF-Connecting-IP": "203.0.113.9" },
      }),
      {
        API_TRANSPORT_POLICY: "local_test",
        CATALOG_QUERY: queryService as unknown as Service,
        DEPLOYMENT_ENV: "local",
        FRONTEND_API_HMAC_CURRENT: FRONTEND_SECRET,
        PUBLIC_API_ORIGIN: "https://api.example.test",
        RATE_LIMIT_HMAC_KEY: LIMITER_SECRET,
        READ_LIMITER: limiter,
        ROTATION_LIMITER: limiter,
      },
    );

    expect(response.status).toBe(404);
    expect(limiterKeys).toHaveLength(1);
    expect(queryService.resolvePublicationV2).not.toHaveBeenCalled();
    expect(queryService.readModelDetailV2).not.toHaveBeenCalled();
  });
});
