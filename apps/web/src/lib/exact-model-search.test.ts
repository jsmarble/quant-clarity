import { describe, expect, it, vi } from "vitest";

import {
  canonicalExactModelSearchQuery,
  encodeExactModelSearchRepresentation,
  FRONTEND_API_INTERNAL_ORIGIN,
  verifyFrontendApiRequest,
} from "@quant-clarity/api-core";
import type { SearchCollection } from "@quant-clarity/contracts";

import {
  readExactModelSearchState,
  type ExactModelSearchEnv,
} from "./exact-model-search.js";

const SECRET = "exact-search-test-secret-with-at-least-32-characters";
const NOW = 1_786_339_200_000;
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const OTHER_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const MODEL = "mdl_11111111-1111-4111-8111-111111111111";
const EVIDENCE = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED = "2026-08-01T00:00:00.000Z";
const UTF8 = new TextEncoder();
const QUERY = canonicalExactModelSearchQuery("Fixture Model");
if (QUERY === null) throw new Error("test query must be canonical");

const COMMON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "X-QuantClarity-Publication",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

const collection = (publicationId = PUBLICATION): SearchCollection => {
  const encoded = encodeExactModelSearchRepresentation({
    data: [
      {
        display_name: {
          evidence_ids: [EVIDENCE],
          observed_at: OBSERVED,
          state: "known",
          value: "Fixture <Model>",
        },
        match_kind: "canonical_name",
        resource_id: MODEL,
        resource_type: "model",
        semantic_degraded: "disabled",
      },
    ],
    meta: {
      filters: { record_type: "model" },
      publication_id: publicationId,
      resource: "search",
      schema_version: "1.0.0",
      semantic_degraded: "disabled",
      sort: ["relevance", "stable_id"],
    },
    page: { limit: 20, next_cursor: null },
  });
  if (encoded === null) throw new Error("test collection must encode");
  return encoded.collection;
};

type HeaderMutation = (headers: Headers) => void;

const successResponse = (
  selected = collection(),
  mutateHeaders?: HeaderMutation,
  bytesOverride?: Uint8Array,
): Response => {
  const encoded = encodeExactModelSearchRepresentation(selected);
  if (encoded === null) throw new Error("test collection must encode");
  const bytes = bytesOverride ?? encoded.representationBytes;
  const headers = new Headers({
    ...COMMON_HEADERS,
    "Cache-Control": "private, no-store",
    "Content-Length": String(bytes.byteLength),
    "Content-Type": "application/json; charset=utf-8",
    Vary: "X-QuantClarity-Publication",
    "X-QuantClarity-Publication": selected.meta.publication_id,
  });
  mutateHeaders?.(headers);
  return new Response(bytes, { headers, status: 200 });
};

const invalidCursorResponse = (
  body = JSON.stringify({
    error: { code: "invalid_cursor", message: "The cursor is invalid." },
  }),
  mutateHeaders?: HeaderMutation,
): Response => {
  const bytes = UTF8.encode(body);
  const headers = new Headers({
    ...COMMON_HEADERS,
    "Cache-Control": "private, no-store",
    "Content-Length": String(bytes.byteLength),
    "Content-Type": "application/json; charset=utf-8",
  });
  mutateHeaders?.(headers);
  return new Response(bytes, { headers, status: 400 });
};

const environment = (
  response: Response,
): ExactModelSearchEnv & {
  fetch: ReturnType<typeof vi.fn<(input: Request) => Promise<Response>>>;
} => {
  const fetch = vi.fn<(input: Request) => Promise<Response>>(() =>
    Promise.resolve(response),
  );
  return {
    API: { fetch },
    DEPLOYMENT_ENV: "local",
    FRONTEND_API_HMAC_CURRENT: SECRET,
    fetch,
  };
};

describe("publication-pinned frontend exact Model search client (FE-013, API-003, PRIV-006)", () => {
  it("sends one fresh signed identity-free GET and admits exact canonical bytes", async () => {
    const response = successResponse();
    const env = environment(response);

    await expect(
      readExactModelSearchState(env, QUERY, PUBLICATION, NOW),
    ).resolves.toEqual({ collection: collection(), kind: "found" });
    expect(env.fetch).toHaveBeenCalledOnce();
    const request = env.fetch.mock.calls[0]?.[0];
    expect(request?.url).toBe(
      `${FRONTEND_API_INTERNAL_ORIGIN}/v1/search?${QUERY}`,
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
      "cookie",
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
        path: "/v1/search",
        publication_id: PUBLICATION,
      },
    });
  });

  it("pins a continuation to its explicit retained publication after the current head changes", async () => {
    const retained = collection(OTHER_PUBLICATION);
    const env = environment(successResponse(retained));

    await expect(
      readExactModelSearchState(env, QUERY, OTHER_PUBLICATION, NOW),
    ).resolves.toEqual({ collection: retained, kind: "found" });
    const request = env.fetch.mock.calls[0]?.[0];
    expect(request?.headers.get("X-QuantClarity-Publication")).toBe(
      OTHER_PUBLICATION,
    );
    await expect(
      verifyFrontendApiRequest({
        environment: "local",
        nowMs: NOW,
        request: request!,
        secrets: { current: SECRET },
        subtle: crypto.subtle,
      }),
    ).resolves.toMatchObject({
      envelope: { publication_id: OTHER_PUBLICATION },
    });
  });

  it("maps an expired retained publication to generic unavailable, never invalid cursor", async () => {
    await expect(
      readExactModelSearchState(
        environment(new Response(null, { status: 503 })),
        canonicalExactModelSearchQuery("Fixture Model", "opaque")!,
        OTHER_PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("admits only the fixed invalid-cursor 400 representation", async () => {
    await expect(
      readExactModelSearchState(
        environment(invalidCursorResponse()),
        canonicalExactModelSearchQuery("Fixture Model", "opaque")!,
        PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "invalid_cursor" });
    await expect(
      readExactModelSearchState(
        environment(
          invalidCursorResponse(
            JSON.stringify({
              error: { code: "invalid_parameter", message: "invalid" },
            }),
          ),
        ),
        QUERY,
        PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      readExactModelSearchState(
        environment(invalidCursorResponse()),
        QUERY,
        PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it.each([
    [
      "cache",
      (headers: Headers) => {
        headers.set("Cache-Control", "public");
      },
    ],
    [
      "media",
      (headers: Headers) => {
        headers.set("Content-Type", "text/json");
      },
    ],
    [
      "publication",
      (headers: Headers) => {
        headers.set("X-QuantClarity-Publication", OTHER_PUBLICATION);
      },
    ],
    [
      "vary",
      (headers: Headers) => {
        headers.delete("Vary");
      },
    ],
    [
      "extra",
      (headers: Headers) => {
        headers.set("X-Extra", "no");
      },
    ],
  ] as const)(
    "rejects a nonexact %s response header profile",
    async (_label, mutate) => {
      await expect(
        readExactModelSearchState(
          environment(successResponse(collection(), mutate)),
          QUERY,
          PUBLICATION,
          NOW,
        ),
      ).resolves.toEqual({ kind: "unavailable" });
    },
  );

  it.each([
    {
      ...collection(),
      meta: { ...collection().meta, publication_id: OTHER_PUBLICATION },
    },
    { ...collection(), meta: { ...collection().meta, filters: {} } },
    {
      ...collection(),
      meta: { ...collection().meta, semantic_degraded: "none" },
    },
    { ...collection(), page: { limit: 19, next_cursor: null } },
    {
      ...collection(),
      data: [
        {
          ...collection().data[0]!,
          match_kind: "alias",
        },
      ],
    },
  ])(
    "rejects a SearchCollection outside the exact Model slice",
    async (candidate) => {
      const bytes = UTF8.encode(JSON.stringify(candidate));
      await expect(
        readExactModelSearchState(
          environment(successResponse(collection(), undefined, bytes)),
          QUERY,
          PUBLICATION,
          NOW,
        ),
      ).resolves.toEqual({ kind: "unavailable" });
    },
  );

  it("rejects valid data encoded with noncanonical property order", async () => {
    const reversed = {
      meta: collection().meta,
      page: collection().page,
      data: collection().data,
    };
    const bytes = UTF8.encode(JSON.stringify(reversed));
    await expect(
      readExactModelSearchState(
        environment(successResponse(collection(), undefined, bytes)),
        QUERY,
        PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it.each(["test", "preview", "production"] as const)(
    "keeps %s closed before signing or calling the binding",
    async (deploymentEnvironment) => {
      const env = environment(successResponse());
      env.DEPLOYMENT_ENV = deploymentEnvironment;
      await expect(
        readExactModelSearchState(env, QUERY, PUBLICATION, NOW),
      ).resolves.toEqual({ kind: "unavailable" });
      expect(env.fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid inputs before calling the binding", async () => {
    const env = environment(successResponse());
    await expect(
      readExactModelSearchState(env, "q=not-canonical", PUBLICATION, NOW),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      readExactModelSearchState(env, QUERY, "not-a-publication", NOW),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(env.fetch).not.toHaveBeenCalled();
  });

  it("enforces one whole-operation deadline without retry", async () => {
    let request: Request | undefined;
    const fetch = vi.fn((input: Request) => {
      request = input;
      return new Promise<Response>(() => undefined);
    });
    await expect(
      readExactModelSearchState(
        {
          API: { fetch },
          DEPLOYMENT_ENV: "local",
          FRONTEND_API_HMAC_CURRENT: SECRET,
        },
        QUERY,
        PUBLICATION,
        NOW,
        crypto.subtle,
        5,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(request?.signal.aborted).toBe(true);
  });
});
