import { describe, expect, it, vi } from "vitest";

import {
  encodeModelDetailRepresentation,
  FRONTEND_API_INTERNAL_ORIGIN,
  representationEtag,
  verifyFrontendApiRequest,
} from "@quant-clarity/api-core";
import {
  checkDatasetMetadataContract,
  checkModelDetailContract,
  type DatasetMetadata,
  type ModelDetail,
} from "@quant-clarity/contracts";

import { readModelDetailState, type ModelDetailEnv } from "./model-detail.js";

const SECRET = "model-detail-test-secret-with-at-least-32-characters";
const NOW = 1_786_339_200_000;
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const OTHER_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const OTHER_MODEL_ID = "mdl_22222222-2222-4222-8222-222222222222";
const FAMILY_ID = "fam_11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const SCHEMA_VERSION = "1.13.0";
const UTF8 = new TextEncoder();

const COMMON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

const NOT_FOUND_BYTES = UTF8.encode(
  JSON.stringify({
    error: {
      code: "resource_not_found",
      message: "The requested resource does not exist.",
    },
  }),
);

const known = <Value>(value: Value) => ({
  evidence_ids: [EVIDENCE_ID],
  observed_at: OBSERVED_AT,
  state: "known" as const,
  value,
});

const unknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown" as const,
  value: null,
});

const model = (
  modelId = MODEL_ID,
  slug = "fixture-model",
): ModelDetail["data"] => ({
  active_parameters: unknown(),
  architecture: known("Fixture Architecture"),
  authoritative_checkpoint_ids: [],
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: OBSERVED_AT,
    value: 2,
  },
  checkpoints: [],
  context_window_tokens: known("131072"),
  display_name: known("Fixture Model"),
  family_id: FAMILY_ID,
  last_model_data_refresh: known(OBSERVED_AT),
  license: unknown(),
  maximum_output_tokens: unknown(),
  modalities: known(["text"]),
  model_id: modelId,
  publisher: known("Fixture Publisher"),
  release_date: known("2026-08-01"),
  slug: known(slug),
  source_quantization: unknown(),
  source_weight_format: unknown(),
  status: known("active"),
  total_parameters: unknown(),
});

const metadata = (
  publicationId = PUBLICATION,
  schemaVersion = SCHEMA_VERSION,
): DatasetMetadata => ({
  api_version: "1",
  counts: { active_models: 2, active_offerings: 3, active_providers: 1 },
  degradation_notices: [],
  generated_at: "2026-08-01T00:30:00.000Z",
  methodology_effective_at: "2026-08-01T00:00:00.000Z",
  methodology_url: "https://api.example.test/v1/methodologies/1.0.0",
  methodology_version: "1.0.0",
  next_refresh_window: {
    ends_at: "2026-08-02T01:00:00.000Z",
    starts_at: "2026-08-02T00:00:00.000Z",
  },
  precision_display_order_version: "precision-display-order@1",
  precision_normalization_version: "precision-normalization@1",
  price_policy_version: "price-policy@1",
  publication_id: publicationId,
  published_at: "2026-08-01T01:00:00.000Z",
  schema_version: schemaVersion,
});

const representation = (
  selectedModel = model(),
  publicationId = PUBLICATION,
  schemaVersion = SCHEMA_VERSION,
) =>
  encodeModelDetailRepresentation({
    model: selectedModel,
    publicationId,
    schemaVersion,
  });

type HeaderMutation = (headers: Headers) => void;

function exactResponse(
  bodyBytes: Uint8Array,
  options: Readonly<{
    identifierKind?: "slug" | "stable_id";
    mutateHeaders?: HeaderMutation;
    publicationId?: string;
    status?: 200 | 404;
  }> = {},
): Response {
  const status = options.status ?? 200;
  const headers = new Headers({
    ...COMMON_HEADERS,
    "Cache-Control":
      status === 404 || options.identifierKind === "slug"
        ? "private, no-store"
        : "private, max-age=0, must-revalidate",
    "Content-Length": String(bodyBytes.byteLength),
    "Content-Type": "application/json; charset=utf-8",
    Vary: "X-QuantClarity-Publication",
    "X-QuantClarity-Publication": options.publicationId ?? PUBLICATION,
    ...(status === 200 ? { ETag: `"${"a".repeat(64)}"` } : {}),
  });
  options.mutateHeaders?.(headers);
  return new Response(bodyBytes, { headers, status });
}

async function exactSuccessResponse(
  bodyBytes: Uint8Array,
  options: Readonly<{
    identifierKind?: "slug" | "stable_id";
    mutateHeaders?: HeaderMutation;
    publicationId?: string;
  }> = {},
): Promise<Response> {
  const publicationId = options.publicationId ?? PUBLICATION;
  const response = exactResponse(bodyBytes, {
    ...(options.identifierKind === undefined
      ? {}
      : { identifierKind: options.identifierKind }),
    publicationId,
  });
  response.headers.set(
    "ETag",
    await representationEtag(publicationId, "json", bodyBytes, crypto.subtle),
  );
  options.mutateHeaders?.(response.headers);
  return response;
}

function environment(response: Response): ModelDetailEnv & {
  fetch: ReturnType<typeof vi.fn<(input: Request) => Promise<Response>>>;
} {
  const fetch = vi.fn<(input: Request) => Promise<Response>>(() =>
    Promise.resolve(response),
  );
  return {
    API: { fetch },
    DEPLOYMENT_ENV: "local",
    FRONTEND_API_HMAC_CURRENT: SECRET,
    fetch,
  };
}

describe("publication-pinned frontend Model-detail client (FE-030, API-003–API-005, SEC-007, PRIV-006)", () => {
  it("constructs one fresh exact four-header signed and publication-pinned request", async () => {
    const encoded = representation();
    const suppliedResponse = await exactSuccessResponse(
      encoded.representationBytes,
    );
    const env = environment(suppliedResponse);

    expect(checkDatasetMetadataContract(metadata())).toBe(true);
    expect(checkModelDetailContract(encoded.detail)).toBe(true);
    const decoded: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        encoded.representationBytes,
      ),
    );
    expect(checkModelDetailContract(decoded)).toBe(true);
    if (!checkModelDetailContract(decoded))
      throw new Error("canonical fixture did not decode as ModelDetail");
    expect(
      encodeModelDetailRepresentation({
        model: decoded.data,
        publicationId: decoded.meta.publication_id,
        schemaVersion: decoded.meta.schema_version,
      }).representationBytes,
    ).toEqual(encoded.representationBytes);

    const state = await readModelDetailState(env, MODEL_ID, metadata(), NOW);
    expect(suppliedResponse.bodyUsed).toBe(true);
    expect(state).toEqual({ detail: encoded.detail, kind: "found" });

    expect(env.fetch).toHaveBeenCalledOnce();
    const request = env.fetch.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect(request?.url).toBe(
      `${FRONTEND_API_INTERNAL_ORIGIN}/v1/models/${MODEL_ID}`,
    );
    expect(request?.method).toBe("GET");
    expect(request?.redirect).toBe("manual");
    expect(request?.body).toBeNull();
    expect([...request!.headers.keys()].sort()).toEqual([
      "x-quantclarity-internal-envelope",
      "x-quantclarity-internal-key-slot",
      "x-quantclarity-internal-signature",
      "x-quantclarity-publication",
    ]);
    for (const forbidden of [
      "authorization",
      "cf-connecting-ip",
      "cf-ipcountry",
      "cookie",
      "forwarded",
      "if-none-match",
      "referer",
      "user-agent",
      "x-forwarded-for",
      "x-request-id",
    ])
      expect(request?.headers.has(forbidden), forbidden).toBe(false);
    await expect(
      verifyFrontendApiRequest({
        environment: "local",
        nowMs: NOW,
        request: request!,
        secrets: { current: SECRET },
        subtle: crypto.subtle,
      }),
    ).resolves.toMatchObject({
      envelope: {
        environment: "local",
        method: "GET",
        path: `/v1/models/${MODEL_ID}`,
        publication_id: PUBLICATION,
      },
      keySlot: "current",
    });
  });

  it.each([
    ["stable ID", MODEL_ID, "stable_id"],
    ["current slug", "fixture-model", "slug"],
    ["historical slug", "former-fixture-model", "slug"],
  ] as const)(
    "accepts canonical bytes for a %s response while preserving returned identity",
    async (_label, identifier, identifierKind) => {
      const encoded = representation();
      const env = environment(
        await exactSuccessResponse(encoded.representationBytes, {
          identifierKind,
        }),
      );

      await expect(
        readModelDetailState(env, identifier, metadata(), NOW),
      ).resolves.toEqual({ detail: encoded.detail, kind: "found" });
      const request = env.fetch.mock.calls[0]?.[0];
      expect(request?.url).toBe(
        `${FRONTEND_API_INTERNAL_ORIGIN}/v1/models/${identifier}`,
      );
      expect(encoded.detail.data.model_id).toBe(MODEL_ID);
      expect(encoded.detail.data.slug.value).toBe("fixture-model");
    },
  );

  it("maps only the exact publication-bound static 404 representation to not found", async () => {
    const env = environment(exactResponse(NOT_FOUND_BYTES, { status: 404 }));
    await expect(
      readModelDetailState(env, MODEL_ID, metadata(), NOW),
    ).resolves.toEqual({ kind: "not_found" });

    for (const body of [
      UTF8.encode(
        JSON.stringify({
          error: {
            code: "resource_not_found",
            message: "different",
          },
        }),
      ),
      UTF8.encode(
        JSON.stringify({
          error: {
            code: "resource_not_found",
            message: "The requested resource does not exist.",
            extra: true,
          },
        }),
      ),
    ]) {
      await expect(
        readModelDetailState(
          environment(exactResponse(body, { status: 404 })),
          MODEL_ID,
          metadata(),
          NOW,
        ),
      ).resolves.toEqual({ kind: "unavailable" });
    }
  });

  it.each([
    [
      "missing publication",
      (headers: Headers) => {
        headers.delete("X-QuantClarity-Publication");
      },
    ],
    [
      "wrong publication",
      (headers: Headers) => {
        headers.set("X-QuantClarity-Publication", OTHER_PUBLICATION);
      },
    ],
    [
      "missing vary",
      (headers: Headers) => {
        headers.delete("Vary");
      },
    ],
    [
      "unexpected validator",
      (headers: Headers) => {
        headers.set("ETag", `"${"a".repeat(64)}"`);
      },
    ],
    [
      "non-private cache policy",
      (headers: Headers) => {
        headers.set("Cache-Control", "private, max-age=0, must-revalidate");
      },
    ],
    [
      "unexpected header",
      (headers: Headers) => {
        headers.set("X-Request-ID", "forbidden");
      },
    ],
  ] as const)(
    "does not turn a 404 with %s into canonical absence",
    async (_label, mutateHeaders) => {
      await expect(
        readModelDetailState(
          environment(
            exactResponse(NOT_FOUND_BYTES, { mutateHeaders, status: 404 }),
          ),
          MODEL_ID,
          metadata(),
          NOW,
        ),
      ).resolves.toEqual({ kind: "unavailable" });
    },
  );

  it.each([
    [
      "missing content type",
      (headers: Headers) => {
        headers.delete("Content-Type");
      },
    ],
    [
      "loose content type",
      (headers: Headers) => {
        headers.set("Content-Type", "application/json");
      },
    ],
    [
      "wrong publication",
      (headers: Headers) => {
        headers.set("X-QuantClarity-Publication", OTHER_PUBLICATION);
      },
    ],
    [
      "missing vary",
      (headers: Headers) => {
        headers.delete("Vary");
      },
    ],
    [
      "crossed vary",
      (headers: Headers) => {
        headers.set("Vary", "Accept-Encoding");
      },
    ],
    [
      "missing ETag",
      (headers: Headers) => {
        headers.delete("ETag");
      },
    ],
    [
      "weak ETag",
      (headers: Headers) => {
        headers.set("ETag", `W/"${"a".repeat(64)}"`);
      },
    ],
    [
      "mismatched ETag",
      (headers: Headers) => {
        headers.set("ETag", `"${"b".repeat(64)}"`);
      },
    ],
    [
      "shared-cache declaration",
      (headers: Headers) => {
        headers.set("Cache-Control", "public, max-age=60");
      },
    ],
    [
      "leading-zero length",
      (headers: Headers) => {
        headers.set("Content-Length", "01");
      },
    ],
    [
      "length mismatch",
      (headers: Headers) => {
        headers.set("Content-Length", "1");
      },
    ],
    [
      "content encoding",
      (headers: Headers) => {
        headers.set("Content-Encoding", "gzip");
      },
    ],
    [
      "unexpected header",
      (headers: Headers) => {
        headers.set("Server-Timing", "private");
      },
    ],
  ] as const)(
    "rejects the %s response-header variation",
    async (_label, mutateHeaders) => {
      const bytes = representation().representationBytes;
      await expect(
        readModelDetailState(
          environment(await exactSuccessResponse(bytes, { mutateHeaders })),
          MODEL_ID,
          metadata(),
          NOW,
        ),
      ).resolves.toEqual({ kind: "unavailable" });
    },
  );

  it.each([201, 204, 206, 304, 308, 409, 429, 500, 503])(
    "rejects unexpected HTTP status %i",
    async (status) => {
      const bytes = representation().representationBytes;
      const response = new Response(
        status === 204 || status === 304 ? null : bytes,
        {
          headers: { "Content-Type": "application/json; charset=utf-8" },
          status,
        },
      );
      await expect(
        readModelDetailState(environment(response), MODEL_ID, metadata(), NOW),
      ).resolves.toEqual({ kind: "unavailable" });
    },
  );

  it("rejects noncanonical, additive, publication-crossed, schema-crossed, and identity-crossed JSON", async () => {
    const canonical = representation();
    const cases = [
      UTF8.encode(JSON.stringify(canonical.detail, null, 2)),
      UTF8.encode(
        JSON.stringify({ ...canonical.detail, unexpected: "closed" }),
      ),
      representation(model(), OTHER_PUBLICATION).representationBytes,
      representation(model(), PUBLICATION, "1.14.0").representationBytes,
      representation(model(OTHER_MODEL_ID, "other-model")).representationBytes,
    ];
    for (const bytes of cases) {
      await expect(
        readModelDetailState(
          environment(await exactSuccessResponse(bytes)),
          MODEL_ID,
          metadata(),
          NOW,
        ),
      ).resolves.toEqual({ kind: "unavailable" });
    }
  });

  it.each([
    ["invalid UTF-8", new Uint8Array([0xc3, 0x28])],
    [
      "UTF-8 BOM",
      new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        ...representation().representationBytes,
      ]),
    ],
    ["truncated JSON", representation().representationBytes.slice(0, -1)],
  ] as const)("rejects %s bytes", async (_label, bytes) => {
    await expect(
      readModelDetailState(
        environment(await exactSuccessResponse(bytes)),
        MODEL_ID,
        metadata(),
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("rejects declared and streamed oversize responses and cancels the stream", async () => {
    const canonical = representation().representationBytes;
    const declared = exactResponse(canonical, {
      mutateHeaders(headers) {
        headers.set("Content-Length", "65537");
      },
    });
    await expect(
      readModelDetailState(environment(declared), MODEL_ID, metadata(), NOW),
    ).resolves.toEqual({ kind: "unavailable" });

    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
    });
    const headers = new Headers({
      ...COMMON_HEADERS,
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Length": "1",
      "Content-Type": "application/json; charset=utf-8",
      ETag: `"${"a".repeat(64)}"`,
      Vary: "X-QuantClarity-Publication",
      "X-QuantClarity-Publication": PUBLICATION,
    });
    await expect(
      readModelDetailState(
        environment(new Response(stream, { headers })),
        MODEL_ID,
        metadata(),
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("contains hostile Response properties, headers, bodies, readers, and proxies", async () => {
    class ThrowingStatusResponse extends Response {
      override get status(): number {
        throw new Error("private status detail");
      }
    }
    class ThrowingHeadersResponse extends Response {
      override get headers(): Headers {
        throw new Error("private header detail");
      }
    }
    class ThrowingBodyResponse extends Response {
      override get body(): ReadableStream<Uint8Array> {
        throw new Error("private body detail");
      }
    }
    const revoked = Proxy.revocable(
      exactResponse(representation().representationBytes),
      {},
    );
    revoked.revoke();
    const hostile = [
      new ThrowingStatusResponse(),
      new ThrowingHeadersResponse(),
      new ThrowingBodyResponse(),
      revoked.proxy,
    ];
    for (const response of hostile) {
      await expect(
        readModelDetailState(environment(response), MODEL_ID, metadata(), NOW),
      ).resolves.toEqual({ kind: "unavailable" });
    }
  });

  it("contains a rejecting binding and non-Response binding output", async () => {
    const rejecting: ModelDetailEnv = {
      API: {
        fetch: vi.fn(() => Promise.reject(new Error("private binding detail"))),
      },
      DEPLOYMENT_ENV: "local",
      FRONTEND_API_HMAC_CURRENT: SECRET,
    };
    const nonResponse: ModelDetailEnv = {
      API: {
        fetch: vi.fn(() => Promise.resolve({}) as Promise<Response>),
      },
      DEPLOYMENT_ENV: "local",
      FRONTEND_API_HMAC_CURRENT: SECRET,
    };
    for (const env of [rejecting, nonResponse])
      await expect(
        readModelDetailState(env, MODEL_ID, metadata(), NOW),
      ).resolves.toEqual({ kind: "unavailable" });
  });

  it("contains hostile stream-reader failures without using unbounded Response helpers", async () => {
    const calls = {
      arrayBuffer: vi.fn(),
      clone: vi.fn(),
      json: vi.fn(),
      text: vi.fn(),
    };
    class HostileReaderResponse extends Response {
      override get body(): ReadableStream<Uint8Array> {
        return {
          getReader() {
            return {
              cancel: () => Promise.resolve(),
              read: () => Promise.reject(new Error("private read detail")),
              releaseLock: () => undefined,
            };
          },
        } as unknown as ReadableStream<Uint8Array>;
      }

      override arrayBuffer(): Promise<ArrayBuffer> {
        calls.arrayBuffer();
        return Promise.reject(new Error("forbidden"));
      }

      override clone(): Response {
        calls.clone();
        throw new Error("forbidden");
      }

      override json<T>(): Promise<T> {
        calls.json();
        return Promise.reject(new Error("forbidden"));
      }

      override text(): Promise<string> {
        calls.text();
        return Promise.reject(new Error("forbidden"));
      }
    }
    const canonical = representation().representationBytes;
    const headers = exactResponse(canonical).headers;
    const response = new HostileReaderResponse(null, { headers });
    await expect(
      readModelDetailState(environment(response), MODEL_ID, metadata(), NOW),
    ).resolves.toEqual({ kind: "unavailable" });
    for (const call of Object.values(calls))
      expect(call).not.toHaveBeenCalled();
  });

  it("uses one whole-operation deadline, aborts stalled fetch and body work, and never retries", async () => {
    let fetchRequest: Request | undefined;
    const fetch = vi.fn((request: Request) => {
      fetchRequest = request;
      return new Promise<Response>(() => undefined);
    });
    const stalledFetchEnv: ModelDetailEnv = {
      API: { fetch },
      DEPLOYMENT_ENV: "local",
      FRONTEND_API_HMAC_CURRENT: SECRET,
    };
    await expect(
      readModelDetailState(
        stalledFetchEnv,
        MODEL_ID,
        metadata(),
        NOW,
        crypto.subtle,
        5,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetchRequest?.signal.aborted).toBe(true);

    const cancel = vi.fn();
    const stalledBody = new ReadableStream<Uint8Array>({
      cancel,
      pull: () => new Promise<void>(() => undefined),
    });
    const canonical = representation().representationBytes;
    const headers = exactResponse(canonical).headers;
    const bodyEnv = environment(new Response(stalledBody, { headers }));
    await expect(
      readModelDetailState(
        bodyEnv,
        MODEL_ID,
        metadata(),
        NOW,
        crypto.subtle,
        5,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(bodyEnv.fetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds signing inside the same deadline and never starts the binding call", async () => {
    const subtle = Object.create(crypto.subtle) as SubtleCrypto;
    Object.defineProperty(subtle, "importKey", {
      value: () => new Promise<CryptoKey>(() => undefined),
    });
    const env = environment(
      exactResponse(representation().representationBytes),
    );
    await expect(
      readModelDetailState(env, MODEL_ID, metadata(), NOW, subtle, 5),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(env.fetch).not.toHaveBeenCalled();
  });

  it.each(["preview", "production"] as const)(
    "keeps %s detail reads closed without signing or calling the API binding",
    async (deploymentEnvironment) => {
      const env = environment(
        exactResponse(representation().representationBytes),
      );
      env.DEPLOYMENT_ENV = deploymentEnvironment;
      await expect(
        readModelDetailState(env, MODEL_ID, metadata(), NOW),
      ).resolves.toEqual({ kind: "unavailable" });
      expect(env.fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed identity, metadata, deadline, and key inputs before the binding call", async () => {
    const cases: readonly (readonly [unknown, unknown, number, unknown])[] = [
      ["Fixture-Model", metadata(), 500, SECRET],
      ["fixture%2Dmodel", metadata(), 500, SECRET],
      [MODEL_ID, { ...metadata(), unexpected: true }, 500, SECRET],
      [MODEL_ID, metadata(), 0, SECRET],
      [MODEL_ID, metadata(), 5_001, SECRET],
      [MODEL_ID, metadata(), 500, "weak"],
    ];
    for (const [identifier, metadataValue, deadlineMs, secret] of cases) {
      const env = environment(
        await exactSuccessResponse(representation().representationBytes),
      );
      env.FRONTEND_API_HMAC_CURRENT = secret;
      await expect(
        readModelDetailState(
          env,
          identifier,
          metadataValue,
          NOW,
          crypto.subtle,
          deadlineMs,
        ),
      ).resolves.toEqual({ kind: "unavailable" });
      expect(env.fetch).not.toHaveBeenCalled();
    }
  });
});
