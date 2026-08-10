import { describe, expect, it } from "vitest";

import type { ApiLimits } from "@quant-clarity/api-core";

import {
  renderApiPreflight,
  renderModelDetailGateResponse,
  renderModelDetailResponse,
  type ApiTransportPolicy,
} from "./api-response-renderer.js";
import { planModelDetailRequest } from "./model-detail-request-plan.js";
import { planModelDetailResponse } from "./model-detail-response-plan.js";
import type { ModelDetailResponsePlan } from "./model-detail-response-plan.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL = "mdl_22222222-2222-4222-8222-222222222222";
const ETAG = `"${"a".repeat(64)}"`;
const BODY = new TextEncoder().encode(
  JSON.stringify({
    data: { model_id: MODEL },
    meta: { publication_id: PUBLICATION },
  }),
);
const LIMITS: ApiLimits = {
  defaultPageSize: 25,
  maxBodyBytes: 1024,
  maxCpuMilliseconds: 50,
  maxCursorCharacters: 4096,
  maxErrorDetails: 10,
  maxFilterValues: 10,
  maxPageSize: 100,
  maxPathBytes: 512,
  maxQueryBytes: 4096,
  maxQueryValueBytes: 512,
  maxResponseBytes: 65_536,
  maxSearchQueryBytes: 200,
  maxSearchResults: 20,
  maxSemanticCalls: 0,
  maxSemanticCandidates: 0,
  maxSubrequests: 4,
  maxUpstreamCalls: 2,
  maxUrlBytes: 8192,
};

const common = {
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

const representationHeaders = (cacheControl = "private, no-store") => ({
  ...common,
  "Cache-Control": cacheControl,
  "Content-Length": String(BODY.byteLength),
  "Content-Type": "application/json; charset=utf-8",
  ETag: ETAG,
  Vary: "X-QuantClarity-Publication",
  "X-QuantClarity-Publication": PUBLICATION,
});

const plan = (
  overrides: Partial<ModelDetailResponsePlan> = {},
): ModelDetailResponsePlan => ({
  bodyBytes: new Uint8Array(BODY),
  headers: representationHeaders("private, max-age=0, must-revalidate"),
  method: "GET",
  status: 200,
  ...overrides,
});

const errorPlan = (
  status: 404 | 409 | 503,
  method: "GET" | "HEAD" = "GET",
): ModelDetailResponsePlan => {
  const error =
    status === 404
      ? {
          code: "resource_not_found",
          message: "The requested resource does not exist.",
        }
      : status === 409
        ? {
            code: "publication_expired",
            message: "The requested publication is no longer available.",
          }
        : {
            code: "temporarily_unavailable",
            message: "The Model detail is temporarily unavailable.",
          };
  const bodyBytes = new TextEncoder().encode(JSON.stringify({ error }));
  return {
    bodyBytes: method === "HEAD" ? null : bodyBytes,
    headers: {
      ...common,
      "Cache-Control": "private, no-store",
      "Content-Length": String(bodyBytes.byteLength),
      "Content-Type": "application/json; charset=utf-8",
      ...(status === 503
        ? {}
        : {
            Vary: "X-QuantClarity-Publication",
            "X-QuantClarity-Publication": PUBLICATION,
          }),
    },
    method,
    status,
  };
};

const expectNoVisitorState = (response: Response) => {
  for (const name of [
    "Access-Control-Allow-Credentials",
    "Server-Timing",
    "Set-Cookie",
    "X-Cache",
    "X-Request-ID",
  ])
    expect(response.headers.has(name), name).toBe(false);
};

describe("API Worker response renderer (API-003, API-013, API-024)", () => {
  it.each([
    [
      {
        error: { code: "invalid_parameter", message: "canary", status: 400 },
        kind: "request_error",
      },
      400,
      null,
    ],
    [
      {
        error: { code: "method_not_allowed", message: "canary", status: 405 },
        kind: "request_error",
      },
      405,
      "GET, HEAD, OPTIONS",
    ],
    [{ kind: "rate_limited" }, 429, null],
    [{ kind: "unavailable" }, 503, null],
  ] as const)("renders closed gate outcome as %s", (outcome, status, allow) => {
    const response = renderModelDetailGateResponse(
      outcome,
      "GET",
      "preview_https",
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Allow")).toBe(allow);
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=300",
    );
    expectNoVisitorState(response);
  });

  it("keeps a HEAD gate error bodyless and rejects hostile error pairs", async () => {
    const response = renderModelDetailGateResponse(
      {
        error: {
          code: "invalid_parameter",
          message: "privacy-canary",
          status: 405,
        },
        kind: "request_error",
      },
      "HEAD",
      "local_test",
    );
    expect(response.status).toBe(503);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
    expect(response.headers.get("Content-Length")).not.toBeNull();
  });

  it("preserves exact GET bytes and detaches them from later plan mutation", async () => {
    const source = plan();
    const response = renderModelDetailResponse(source, "local_test");
    source.bodyBytes?.fill(0);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BODY);
    expect(response.headers.get("Content-Length")).toBe(
      String(BODY.byteLength),
    );
    expect(response.headers.get("ETag")).toBe(ETAG);
    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
    expectNoVisitorState(response);
  });

  it("keeps HEAD bodyless while preserving GET representation headers", async () => {
    const response = renderModelDetailResponse(
      plan({ bodyBytes: null, method: "HEAD" }),
      "preview_https",
    );

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
    expect(response.headers.get("Content-Length")).toBe(
      String(BODY.byteLength),
    );
    expect(response.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=300",
    );
  });

  it("renders bodyless conditional and redirect responses without entity drift", () => {
    const conditional = renderModelDetailResponse(
      plan({
        bodyBytes: null,
        headers: {
          ...common,
          "Cache-Control": "private, no-store",
          ETag: ETAG,
          Vary: "X-QuantClarity-Publication",
          "X-QuantClarity-Publication": PUBLICATION,
        },
        status: 304,
      }),
      "local_test",
    );
    expect(conditional.status).toBe(304);
    expect(conditional.body).toBeNull();
    expect(conditional.headers.has("Content-Length")).toBe(false);
    expect(conditional.headers.has("Content-Type")).toBe(false);

    const redirect = renderModelDetailResponse(
      plan({
        bodyBytes: null,
        headers: {
          ...common,
          "Cache-Control": "private, no-store",
          "Content-Length": "0",
          Location: `/v1/models/${MODEL}`,
          Vary: "X-QuantClarity-Publication",
          "X-QuantClarity-Publication": PUBLICATION,
        },
        status: 308,
      }),
      "local_test",
    );
    expect(redirect.status).toBe(308);
    expect(redirect.body).toBeNull();
    expect(redirect.headers.get("Location")).toBe(`/v1/models/${MODEL}`);
    expect(redirect.headers.get("Content-Length")).toBe("0");
    expect(redirect.headers.has("ETag")).toBe(false);
    expect(redirect.headers.has("Content-Type")).toBe(false);
  });

  it.each([404, 409] as const)(
    "renders publication-bound %s errors and bodyless HEAD variants",
    async (status) => {
      const get = renderModelDetailResponse(errorPlan(status), "local_test");
      expect(get.status).toBe(status);
      expect(await get.json()).toHaveProperty("error");
      expect(get.headers.get("X-QuantClarity-Publication")).toBe(PUBLICATION);

      const head = renderModelDetailResponse(
        errorPlan(status, "HEAD"),
        "local_test",
      );
      expect(head.status).toBe(status);
      expect(head.body).toBeNull();
      expect(head.headers.get("Content-Length")).toBe(
        get.headers.get("Content-Length"),
      );
    },
  );

  it("renders generic 503 plans without publication or validator headers", async () => {
    const response = renderModelDetailResponse(errorPlan(503), "local_test");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "The Model detail is temporarily unavailable.",
      },
    });
    expect(response.headers.has("X-QuantClarity-Publication")).toBe(false);
  });

  it.each([
    [
      "selected not found",
      null,
      { code: "not_found", publicationId: PUBLICATION, success: false },
      404,
    ],
    [
      "expired explicit pin",
      PUBLICATION,
      {
        code: "publication_expired",
        currentPublicationId: PUBLICATION,
        success: false,
      },
      409,
    ],
    [
      "publication not ready",
      null,
      { code: "publication_not_ready", success: false },
      503,
    ],
  ] as const)(
    "renders the actual response planner's %s envelope",
    async (_label, publicationHeader, outcome, status) => {
      const requestPlan = planModelDetailRequest(
        {
          bodyBytes: 0,
          hasQueryString: false,
          ifNoneMatch: null,
          method: "GET",
          pathname: `/v1/models/${MODEL}`,
          publicationHeader,
          rawQuery: "",
        },
        LIMITS,
      );
      if (requestPlan.kind !== "lookup")
        throw new Error("renderer integration fixture must produce lookup");
      const responsePlan = await planModelDetailResponse(
        { outcome, requestPlan },
        crypto.subtle,
      );
      const response = renderModelDetailResponse(responsePlan, "local_test");
      expect(response.status).toBe(status);
      expect(await response.json()).toHaveProperty("error");
    },
  );

  it.each([
    ["local_test", null],
    ["preview_https", "max-age=300"],
    ["production_https_custom_hostname", "max-age=31536000; includeSubDomains"],
  ] as const)("applies the closed %s HSTS policy", (policy, expected) => {
    for (const response of [
      renderModelDetailResponse(plan(), policy),
      renderApiPreflight(policy),
    ])
      expect(response.headers.get("Strict-Transport-Security")).toBe(expected);
  });

  it("renders the exact bodyless preflight without downstream state", () => {
    const response = renderApiPreflight("preview_https");
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "If-None-Match, X-QuantClarity-Publication",
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, HEAD, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Content-Length")).toBe(false);
    expect(response.headers.has("Content-Type")).toBe(false);
    expectNoVisitorState(response);
  });

  it("fails closed for hostile plans and an unapproved production policy", async () => {
    const hostileHeaders = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostileHeaders, "Cache-Control", {
      enumerable: true,
      get: () => {
        throw new Error("visitor-canary");
      },
    });
    const hostile = {
      bodyBytes: null,
      headers: hostileHeaders,
      method: "HEAD",
      status: 200,
    } as unknown as ModelDetailResponsePlan;
    const hostileResponse = renderModelDetailResponse(hostile, "local_test");
    expect(hostileResponse.status).toBe(503);
    expect(hostileResponse.body).toBeNull();

    const unapproved = renderModelDetailResponse(
      plan(),
      "production_https" as ApiTransportPolicy,
    );
    expect(unapproved.status).toBe(503);
    expect(unapproved.headers.get("Strict-Transport-Security")).toBeNull();
    expect(await unapproved.text()).not.toContain("visitor-canary");
  });

  it("contains revoked and throwing proxy traps inside the static failure path", async () => {
    const revoked = Proxy.revocable(plan(), {});
    revoked.revoke();
    const throwing = new Proxy(plan(), {
      getPrototypeOf: () => {
        throw new Error("visitor-canary proxy trap");
      },
    });
    for (const candidate of [revoked.proxy, throwing]) {
      const response = renderModelDetailResponse(candidate, "preview_https");
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Strict-Transport-Security")).toBe(
        "max-age=300",
      );
      expect(await response.text()).not.toContain("visitor-canary");
    }
  });

  it("rejects a forged error body instead of reflecting diagnostics", async () => {
    const bodyBytes = new TextEncoder().encode(
      JSON.stringify({
        error: {
          code: "resource_not_found",
          message: "visitor-canary pin bookmark stack",
        },
      }),
    );
    const forged = errorPlan(404);
    const response = renderModelDetailResponse(
      {
        ...forged,
        bodyBytes,
        headers: {
          ...forged.headers,
          "Content-Length": String(bodyBytes.byteLength),
        },
      },
      "local_test",
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("visitor-canary");
  });

  it("rejects crossed status headers and internal shared-cache policy", () => {
    for (const candidate of [
      plan({
        headers: {
          ...representationHeaders(),
          Location: `/v1/models/${MODEL}`,
        },
      }),
      plan({
        headers: representationHeaders("public, max-age=300, must-revalidate"),
      }),
      plan({ bodyBytes: null }),
    ]) {
      const response = renderModelDetailResponse(candidate, "local_test");
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });
});
