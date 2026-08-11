import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalExactModelSearchQuery,
  canonicalExactVariantSearchQuery,
  encodeExactVariantCardCollectionRepresentation,
  EXACT_MODEL_SEARCH_API_PATH,
  EXACT_VARIANT_SEARCH_API_PATH,
  FRONTEND_API_INTERNAL_ORIGIN,
  signFrontendApiRequest,
} from "@quant-clarity/api-core";

import { handleRequest } from "./request.js";

const FRONTEND_SECRET = "frontend-test-secret-with-at-least-32-characters";
const LIMITER_SECRET = "limiter-test-secret-with-at-least-32-characters";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const OTHER_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const FAMILY_ID = "fam_11111111-1111-4111-8111-111111111111";
const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const VARIANT_ID = "var_11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const NOW_MS = 1_786_339_200_000;

type DeploymentEnvironment = "local" | "test" | "preview" | "production";

const variantCard = (variantId = VARIANT_ID) => ({
  variant_id: variantId,
  model_id: MODEL_ID,
  family_id: FAMILY_ID,
  variant_kind: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "quantized-checkpoint",
  },
  display_name: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "Exact Variant",
  },
  publisher: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "Fixture Publisher",
  },
  total_parameters: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  active_parameters: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  source_weight_format: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "BF16",
  },
  source_quantization: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "INT4",
  },
  cataloged_provider_count: {
    value: 1,
    observed_at: OBSERVED_AT,
    derivation_version: "cataloged-provider-count@1",
  },
  last_model_data_refresh: {
    evidence_ids: [EVIDENCE_ID],
    observed_at: OBSERVED_AT,
    state: "known",
    value: OBSERVED_AT,
  },
});

const result = (variantId = VARIANT_ID) => ({
  matchKind: "canonical_name",
  tierMarker: "exact-v1:c",
  variantCard: variantCard(variantId),
});

const service = () => ({
  resolvePublicationV2: vi.fn((input: unknown): Promise<unknown> => {
    const requiredAvailableUntilMs = (
      input as { requiredAvailableUntilMs: number }
    ).requiredAvailableUntilMs;
    return Promise.resolve({
      bookmark: "bookmark-exact-variant-search",
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs,
    });
  }),
  readExactVariantCardSearchV1: vi.fn((input: unknown): Promise<unknown> => {
    void input;
    return Promise.resolve({
      outcome: "page",
      page: {
        nextContinuation: null,
        publicationId: PUBLICATION,
        results: [result()],
        semanticDegraded: "disabled",
      },
    });
  }),
  readExactModelCardSearchV1: vi.fn(() =>
    Promise.reject(new Error("Model-card RPC must not be called")),
  ),
  readMergedExactSearchV2: vi.fn(() =>
    Promise.reject(new Error("generic RPC must not be called")),
  ),
});

const guardedEnvironment = (
  deploymentEnvironment: DeploymentEnvironment = "local",
) => {
  let limiterCapabilityReads = 0;
  let queryCapabilityReads = 0;
  const queryService = service();
  const env = {
    API_TRANSPORT_POLICY: "local_test",
    DEPLOYMENT_ENV: deploymentEnvironment,
    FRONTEND_API_HMAC_CURRENT: FRONTEND_SECRET,
    PUBLIC_API_ORIGIN: "https://api.example.test",
  } as Record<string, unknown>;
  Object.defineProperty(env, "CATALOG_QUERY", {
    enumerable: true,
    get() {
      queryCapabilityReads += 1;
      return queryService;
    },
  });
  for (const name of [
    "RATE_LIMIT_HMAC_KEY",
    "READ_LIMITER",
    "ROTATION_LIMITER",
  ])
    Object.defineProperty(env, name, {
      enumerable: true,
      get() {
        limiterCapabilityReads += 1;
        throw new Error(`${name} must not be read for signed ingress`);
      },
    });
  return {
    env: env as unknown as Parameters<typeof handleRequest>[1],
    limiterCapabilityReads: () => limiterCapabilityReads,
    queryCapabilityReads: () => queryCapabilityReads,
    queryService,
  };
};

type SignedRequestOptions = Readonly<{
  bodyPresent?: boolean;
  deploymentEnvironment?: DeploymentEnvironment;
  extraHeaders?: Readonly<Record<string, string>>;
  method?: "GET" | "HEAD";
  path?: string;
  publicationHeader?: string | null;
  publicationId?: string | null;
  rawQuery?: string;
}>;

const signedRequest = async (
  options: SignedRequestOptions = {},
): Promise<Request> => {
  const rawQuery =
    options.rawQuery ?? canonicalExactVariantSearchQuery("Exact Variant");
  if (rawQuery === null) throw new Error("test query is invalid");
  const path = options.path ?? EXACT_VARIANT_SEARCH_API_PATH;
  const method = options.method ?? "GET";
  const publicationId =
    options.publicationId === undefined ? PUBLICATION : options.publicationId;
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
  const native = new Request(
    `${FRONTEND_API_INTERNAL_ORIGIN}${path}?${rawQuery}`,
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
  return {
    guarded: {
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
    } as unknown as Request,
    sourceAddressReads: () => sourceAddressReads,
  };
};

const expectClosed = async (
  request: Request,
  environment: DeploymentEnvironment = "local",
) => {
  const runtime = guardedEnvironment(environment);
  const incoming = guardSourceAddress(request);
  const response = await handleRequest(incoming.guarded, runtime.env);
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(incoming.sourceAddressReads()).toBe(0);
  expect(runtime.limiterCapabilityReads()).toBe(0);
  expect(runtime.queryCapabilityReads()).toBe(0);
  expect(runtime.queryService.resolvePublicationV2).not.toHaveBeenCalled();
  expect(
    runtime.queryService.readExactVariantCardSearchV1,
  ).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("purpose-separated signed exact-Variant ingress (FE-010, API-010, SEC-001/007/011, PRIV-006)", () => {
  it.each(["local", "test"] as const)(
    "admits exact signed pinned Variant bytes in %s before visitor capabilities",
    async (environment) => {
      const runtime = guardedEnvironment(environment);
      const incoming = guardSourceAddress(
        await signedRequest({ deploymentEnvironment: environment }),
      );
      const response = await handleRequest(incoming.guarded, runtime.env);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("ETag")).toBeNull();
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(response.headers.get("X-QuantClarity-Publication")).toBe(
        PUBLICATION,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
      const encoded = encodeExactVariantCardCollectionRepresentation(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      expect(encoded?.representationBytes).toEqual(bytes);
      expect(encoded?.collection.data[0]).toMatchObject({
        variant: {
          variant_id: VARIANT_ID,
          model_id: MODEL_ID,
          family_id: FAMILY_ID,
        },
      });
      expect(incoming.sourceAddressReads()).toBe(0);
      expect(runtime.limiterCapabilityReads()).toBe(0);
      expect(runtime.queryCapabilityReads()).toBe(1);
      expect(
        runtime.queryService.readExactVariantCardSearchV1,
      ).toHaveBeenCalledOnce();
      expect(
        runtime.queryService.readExactModelCardSearchV1,
      ).not.toHaveBeenCalled();
      expect(
        runtime.queryService.readMergedExactSearchV2,
      ).not.toHaveBeenCalled();
      expect(
        runtime.queryService.readExactVariantCardSearchV1.mock.calls[0]?.[0],
      ).toMatchObject({
        environment,
        version: 1,
        envelope: {
          filters: { record_type: "variant" },
          limit: 20,
          publicationId: PUBLICATION,
        },
      });
    },
  );

  it.each([
    ["wrong record type", "q=Exact+Variant&record_type=model&limit=20"],
    ["wrong order", "record_type=variant&q=Exact+Variant&limit=20"],
    ["wrong limit", "q=Exact+Variant&record_type=variant&limit=19"],
    [
      "extra parameter",
      "q=Exact+Variant&record_type=variant&limit=20&sort=relevance",
    ],
    ["duplicate query", "q=Exact+Variant&q=Other&record_type=variant&limit=20"],
  ])("rejects signed %s before every capability", async (_label, rawQuery) => {
    await expectClosed(await signedRequest({ rawQuery }));
  });

  it.each([
    ["unpin", { publicationHeader: null, publicationId: null }],
    ["publication mismatch", { publicationHeader: OTHER_PUBLICATION }],
    ["HEAD", { method: "HEAD" }],
    ["body", { bodyPresent: true }],
    ["conditional", { extraHeaders: { "If-None-Match": '"opaque"' } }],
    ["visitor header", { extraHeaders: { "X-Visitor": "identity" } }],
    ["wrong path", { path: `${EXACT_VARIANT_SEARCH_API_PATH}/` }],
  ] as const)("rejects signed %s before effects", async (_label, options) => {
    await expectClosed(await signedRequest(options));
  });

  it.each(["preview", "production"] as const)(
    "keeps exact Variant ingress closed in %s",
    async (environment) => {
      await expectClosed(
        await signedRequest({ deploymentEnvironment: environment }),
        environment,
      );
    },
  );

  it("rejects path/query signature tampering before every capability", async () => {
    const signed = await signedRequest();
    const tampered = new Request(
      `${FRONTEND_API_INTERNAL_ORIGIN}${EXACT_VARIANT_SEARCH_API_PATH}?q=Other&record_type=variant&limit=20`,
      { headers: signed.headers },
    );
    await expectClosed(tampered);
  });

  it("authenticates an invalid cursor before reading the query binding", async () => {
    const rawQuery = canonicalExactVariantSearchQuery(
      "Exact Variant",
      "tampered",
    );
    if (rawQuery === null) throw new Error("cursor fixture is invalid");
    const runtime = guardedEnvironment();
    const response = await handleRequest(
      await signedRequest({ rawQuery }),
      runtime.env,
    );
    expect(response.status).toBe(400);
    expect(runtime.queryCapabilityReads()).toBe(0);
    expect(runtime.limiterCapabilityReads()).toBe(0);
  });

  it("issues and accepts only the Variant-purpose continuation key", async () => {
    const runtime = guardedEnvironment();
    const results = Array.from({ length: 20 }, (_, index) =>
      result(
        `var_00000000-0000-4000-8000-${(index + 1)
          .toString(16)
          .padStart(12, "0")}`,
      ),
    );
    const last = results.at(-1);
    if (last === undefined) throw new Error("page fixture is empty");
    runtime.queryService.readExactVariantCardSearchV1
      .mockImplementationOnce(() =>
        Promise.resolve({
          outcome: "page",
          page: {
            nextContinuation: {
              resourceId: last.variantCard.variant_id,
              tierMarker: last.tierMarker,
            },
            publicationId: PUBLICATION,
            results,
            semanticDegraded: "disabled",
          },
        }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          outcome: "page",
          page: {
            nextContinuation: null,
            publicationId: PUBLICATION,
            results: [],
            semanticDegraded: "disabled",
          },
        }),
      );
    const first = await handleRequest(await signedRequest(), runtime.env);
    const firstBody = await first.json<{
      page: { next_cursor: string | null };
    }>();
    expect(firstBody.page.next_cursor).toEqual(expect.any(String));
    const continuedQuery = canonicalExactVariantSearchQuery(
      "Exact Variant",
      firstBody.page.next_cursor,
    );
    if (continuedQuery === null) throw new Error("issued cursor is invalid");
    const continued = await handleRequest(
      await signedRequest({ rawQuery: continuedQuery }),
      runtime.env,
    );
    expect(continued.status).toBe(200);

    const modelQuery = canonicalExactModelSearchQuery(
      "Exact Variant",
      firstBody.page.next_cursor,
    );
    if (modelQuery === null) throw new Error("model query fixture is invalid");
    const modelPathRequest = await signedRequest({
      path: EXACT_MODEL_SEARCH_API_PATH,
      rawQuery: modelQuery,
    });
    const crossed = await handleRequest(modelPathRequest, runtime.env);
    expect(crossed.status).toBe(400);
    expect(runtime.queryCapabilityReads()).toBe(2);
    expect(
      runtime.queryService.readExactModelCardSearchV1,
    ).not.toHaveBeenCalled();
  });

  it("fails static and no-store on malformed RPC output", async () => {
    const runtime = guardedEnvironment();
    runtime.queryService.readExactVariantCardSearchV1.mockResolvedValueOnce({
      outcome: "page",
      visitor_query: "must-not-echo",
    });
    const response = await handleRequest(await signedRequest(), runtime.env);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("ETag")).toBeNull();
    const text = await response.text();
    expect(text).not.toContain("must-not-echo");
    expect(text).not.toContain(FRONTEND_SECRET);
  });

  it("maps publication expiry without leaking the requested query", async () => {
    const runtime = guardedEnvironment();
    runtime.queryService.resolvePublicationV2.mockResolvedValueOnce({
      currentPublicationId: OTHER_PUBLICATION,
      outcome: "publication_expired",
    });
    const response = await handleRequest(await signedRequest(), runtime.env);
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-QuantClarity-Publication")).toBe(
      OTHER_PUBLICATION,
    );
    expect(await response.json()).toEqual({
      error: {
        code: "publication_expired",
        message: "The requested publication is no longer available.",
      },
    });
    expect(
      runtime.queryService.readExactVariantCardSearchV1,
    ).not.toHaveBeenCalled();
  });

  it.each(["publication_not_ready", "read_failure"] as const)(
    "maps resolver %s to a static no-store unavailable response",
    async (outcome) => {
      const runtime = guardedEnvironment();
      runtime.queryService.resolvePublicationV2.mockResolvedValueOnce({
        outcome,
      });
      const rawQuery = canonicalExactVariantSearchQuery("Visitor Canary");
      if (rawQuery === null) throw new Error("test query is invalid");
      const response = await handleRequest(
        await signedRequest({ rawQuery }),
        runtime.env,
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const text = await response.text();
      expect(text).not.toContain("Visitor Canary");
      expect(text).not.toContain(FRONTEND_SECRET);
      expect(
        runtime.queryService.readExactVariantCardSearchV1,
      ).not.toHaveBeenCalled();
    },
  );

  it("keeps the public purpose path closed behind bounded limiting", async () => {
    const keys: string[] = [];
    const limiter: RateLimit = {
      limit({ key }) {
        keys.push(key);
        return Promise.resolve({ success: true });
      },
    };
    const queryService = service();
    const response = await handleRequest(
      new Request(
        `https://api.example.test${EXACT_VARIANT_SEARCH_API_PATH}?q=Exact+Variant&record_type=variant&limit=20`,
        { headers: { "CF-Connecting-IP": "203.0.113.9" } },
      ),
      {
        API_TRANSPORT_POLICY: "local_test",
        CATALOG_QUERY: queryService,
        DEPLOYMENT_ENV: "local",
        RATE_LIMIT_HMAC_KEY: LIMITER_SECRET,
        READ_LIMITER: limiter,
        ROTATION_LIMITER: limiter,
      } as unknown as Parameters<typeof handleRequest>[1],
    );
    expect(response.status).toBe(404);
    expect(keys).toHaveLength(1);
    expect(queryService.resolvePublicationV2).not.toHaveBeenCalled();
    expect(queryService.readExactVariantCardSearchV1).not.toHaveBeenCalled();
  });
});
