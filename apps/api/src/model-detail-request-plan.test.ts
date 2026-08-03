import { describe, expect, it } from "vitest";

import type { ApiLimits, RequestInput } from "@quant-clarity/api-core";

import { planModelDetailRequest } from "./model-detail-request-plan.js";

const MODEL_ID = "mdl_00000000-0000-4000-8000-000000000001";
const PUBLICATION_ID = "pub_00000000-0000-4000-8000-000000000001";
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

const input = (
  pathname = `/v1/models/${MODEL_ID}`,
  overrides: Partial<RequestInput & { ifNoneMatch: string | null }> = {},
) => ({
  bodyBytes: 0,
  hasQueryString: false,
  ifNoneMatch: null,
  method: "GET",
  pathname,
  publicationHeader: null,
  rawQuery: "",
  ...overrides,
});

describe("Model detail pure request plan (API-002–API-004, API-013)", () => {
  it.each([
    ["GET", MODEL_ID, "stable_id"],
    ["HEAD", MODEL_ID, "stable_id"],
    ["GET", "a", "slug"],
    ["HEAD", "model-name-2", "slug"],
    ["GET", "a".repeat(128), "slug"],
  ] as const)("plans %s %s as %s", (method, identifier, identifierKind) => {
    const plan = planModelDetailRequest(
      input(`/v1/models/${identifier}`, {
        ifNoneMatch: 'W/"one", "two"',
        method,
        publicationHeader: PUBLICATION_ID,
      }),
      LIMITS,
    );
    expect(plan).toMatchObject({
      identifier,
      identifierKind,
      ifNoneMatch: 'W/"one", "two"',
      kind: "lookup",
      request: {
        hasQueryString: false,
        method,
        publicationHeader: PUBLICATION_ID,
      },
    });
  });

  it.each([MODEL_ID, "model-name", "a".repeat(128)])(
    "plans bodyless OPTIONS without lookup data for %s",
    (identifier) => {
      expect(
        planModelDetailRequest(
          input(`/v1/models/${identifier}`, {
            ifNoneMatch: "*",
            method: "OPTIONS",
            publicationHeader: PUBLICATION_ID,
          }),
          LIMITS,
        ),
      ).toEqual({ kind: "preflight" });
    },
  );

  it("rejects an overlong OPTIONS slug before preflight", () => {
    expect(
      planModelDetailRequest(
        input(`/v1/models/${"a".repeat(129)}`, { method: "OPTIONS" }),
        LIMITS,
      ),
    ).toMatchObject({
      error: { code: "invalid_parameter", status: 400 },
      kind: "error",
    });
  });

  it.each([
    "",
    "a".repeat(129),
    "Uppercase",
    "has_underscore",
    "has.dot",
    "-leading",
    "trailing-",
    "double--hyphen",
    "mødel",
    "mdl_00000000-0000-3000-8000-000000000001",
    "mdl_00000000-0000-4000-7000-000000000001",
    "mdl_00000000-0000-4000-8000-00000000000A",
    "%61",
    "%2f",
    "%252f",
    "bad/extra",
    "a/",
    "/a",
    "prv_00000000-0000-4000-8000-000000000001",
  ])("rejects malformed Model identifier %j", (identifier) => {
    expect(
      planModelDetailRequest(input(`/v1/models/${identifier}`), LIMITS),
    ).toMatchObject({
      error: { code: "invalid_parameter", status: 400 },
      kind: "error",
    });
  });

  it.each(["", "q=x", "sort=name"])(
    "rejects the query marker with %j",
    (rawQuery) => {
      expect(
        planModelDetailRequest(
          input(undefined, { hasQueryString: true, rawQuery }),
          LIMITS,
        ),
      ).toMatchObject({
        error: { code: "invalid_parameter", status: 400 },
        kind: "error",
      });
    },
  );

  it.each([
    ["malformed identifier", input("/v1/models/", { method: "OPTIONS" })],
    [
      "query marker",
      input(undefined, {
        hasQueryString: true,
        method: "OPTIONS",
        rawQuery: "",
      }),
    ],
    ["body", input(undefined, { bodyBytes: 1, method: "OPTIONS" })],
    [
      "publication pin",
      input(undefined, { method: "OPTIONS", publicationHeader: "invalid" }),
    ],
    [
      "conditional",
      input(undefined, { ifNoneMatch: "invalid", method: "OPTIONS" }),
    ],
  ])("rejects OPTIONS with %s before preflight", (_label, request) => {
    expect(planModelDetailRequest(request, LIMITS)).toMatchObject({
      error: { code: "invalid_parameter", status: 400 },
      kind: "error",
    });
  });

  it.each([
    "invalid",
    `${PUBLICATION_ID},${PUBLICATION_ID}`,
    "pub_00000000-0000-4000-7000-000000000001",
    "PUB_00000000-0000-4000-8000-000000000001",
    `pub_${"a".repeat(64)}`,
  ])("rejects malformed publication pin %j", (publicationHeader) => {
    expect(
      planModelDetailRequest(input(undefined, { publicationHeader }), LIMITS),
    ).toMatchObject({
      error: { code: "invalid_parameter", status: 400 },
      kind: "error",
    });
  });

  it("preserves bounded method, body, and path failures", () => {
    expect(
      planModelDetailRequest(input(undefined, { method: "POST" }), LIMITS),
    ).toMatchObject({
      error: { code: "method_not_allowed", status: 405 },
      kind: "error",
    });
    expect(
      planModelDetailRequest(input(undefined, { bodyBytes: 1 }), LIMITS),
    ).toMatchObject({
      error: { code: "invalid_parameter", status: 400 },
      kind: "error",
    });
    expect(
      planModelDetailRequest(input(undefined, { bodyBytes: 1025 }), LIMITS),
    ).toMatchObject({
      error: { code: "query_too_large", status: 413 },
      kind: "error",
    });
    expect(
      planModelDetailRequest(input(`/v1/models/${"a".repeat(502)}`), LIMITS),
    ).toMatchObject({
      error: { code: "query_too_large", status: 413 },
      kind: "error",
    });
  });

  it.each(["opaque", '"unterminated', `"${"a".repeat(255)}"`])(
    "rejects malformed or overlong If-None-Match %j",
    (ifNoneMatch) => {
      expect(
        planModelDetailRequest(input(undefined, { ifNoneMatch }), LIMITS),
      ).toMatchObject({
        error: { code: "invalid_parameter", status: 400 },
        kind: "error",
      });
    },
  );

  it.each([null, "*", '"opaque"', 'W/"weak"', '"one", W/"two"'])(
    "accepts bounded conditional %j",
    (ifNoneMatch) => {
      expect(
        planModelDetailRequest(input(undefined, { ifNoneMatch }), LIMITS),
      ).toMatchObject({ ifNoneMatch, kind: "lookup" });
    },
  );

  it.each(["/v1/models", "/v1/providers/a", "/v2/models/a"])(
    "keeps unopened or unrelated route %s closed",
    (pathname) => {
      expect(planModelDetailRequest(input(pathname), LIMITS)).toMatchObject({
        error: { code: "resource_not_found", status: 404 },
        kind: "error",
      });
    },
  );

  it("fails statically on hostile DTOs without invoking accessors", () => {
    let calls = 0;
    const accessor = input();
    Object.defineProperty(accessor, "pathname", {
      enumerable: true,
      get: () => {
        calls += 1;
        return `/v1/models/${MODEL_ID}`;
      },
    });
    expect(planModelDetailRequest(accessor, LIMITS)).toMatchObject({
      error: { code: "invalid_parameter", status: 400 },
      kind: "error",
    });
    expect(calls).toBe(0);

    const revoked = Proxy.revocable(input(), {});
    revoked.revoke();
    expect(planModelDetailRequest(revoked.proxy, LIMITS)).toMatchObject({
      error: { code: "invalid_parameter", status: 400 },
      kind: "error",
    });

    const coercion = input() as Record<string, unknown>;
    coercion.pathname = {
      toString: () => {
        calls += 1;
        return `/v1/models/${MODEL_ID}`;
      },
    };
    expect(
      planModelDetailRequest(
        coercion as unknown as ReturnType<typeof input>,
        LIMITS,
      ),
    ).toMatchObject({
      error: { code: "invalid_parameter", status: 400 },
      kind: "error",
    });
    expect(calls).toBe(0);
  });

  it("does not retain or reflect arbitrary query names", () => {
    const canary = "visitorcanary";
    const plan = planModelDetailRequest(
      input(undefined, {
        hasQueryString: true,
        rawQuery: `${canary}=x&${canary}=y`,
      }),
      LIMITS,
    );
    expect(plan).toEqual({
      error: {
        code: "invalid_parameter",
        message: "This route does not accept a query string.",
        status: 400,
      },
      kind: "error",
    });
    expect(JSON.stringify(plan)).not.toContain(canary);
  });
});
