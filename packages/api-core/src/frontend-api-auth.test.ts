import { describe, expect, it } from "vitest";

import {
  FRONTEND_API_ENVELOPE_HEADER,
  FRONTEND_API_INTERNAL_ORIGIN,
  FRONTEND_API_KEY_SLOT_HEADER,
  FRONTEND_API_SIGNATURE_HEADER,
  hasFrontendApiReservedHeaders,
  signFrontendApiRequest,
  verifyFrontendApiRequest,
} from "./frontend-api-auth.js";

const CURRENT = "current-test-secret-with-at-least-32-characters";
const NEXT = "next-test-secret-with-at-least-32-characters";
const NOW = 1_786_339_200_000;
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";

async function signedRequest(
  overrides: Partial<{
    environment: "local" | "test";
    keySlot: "current" | "next";
    method: "GET" | "HEAD";
    nowMs: number;
    path: string;
    publicationId: string | null;
    rawQuery: string;
    secret: string;
  }> = {},
): Promise<Request> {
  const method = overrides.method ?? "GET";
  const path = overrides.path ?? "/v1/metadata";
  const rawQuery = overrides.rawQuery ?? "";
  const publicationId = overrides.publicationId ?? null;
  const headers = await signFrontendApiRequest({
    environment: overrides.environment ?? "local",
    ...(overrides.keySlot === undefined ? {} : { keySlot: overrides.keySlot }),
    method,
    nowMs: overrides.nowMs ?? NOW,
    path,
    publicationId,
    rawQuery,
    secret: overrides.secret ?? CURRENT,
    subtle: crypto.subtle,
  });
  if (headers === null) throw new Error("test signing failed");
  if (publicationId !== null)
    headers.set("X-QuantClarity-Publication", publicationId);
  return new Request(
    `${FRONTEND_API_INTERNAL_ORIGIN}${path}${rawQuery === "" ? "" : `?${rawQuery}`}`,
    { headers, method },
  );
}

const verify = (request: Request, nowMs = NOW) =>
  verifyFrontendApiRequest({
    environment: "local",
    nowMs,
    request,
    secrets: { current: CURRENT, next: NEXT },
    subtle: crypto.subtle,
  });

describe("frontend/API signed read envelope (SEC-001, SEC-007, SEC-011, PRIV-006, PRIV-011)", () => {
  it("accepts the identical non-mutating request throughout the bounded replay window", async () => {
    const request = await signedRequest();
    await expect(verify(request, NOW)).resolves.toMatchObject({
      keySlot: "current",
      envelope: {
        audience: "quantclarity-api",
        environment: "local",
        expires_at_ms: NOW + 30_000,
        issued_at_ms: NOW,
        method: "GET",
        path: "/v1/metadata",
        publication_id: null,
        version: 1,
      },
    });
    await expect(verify(request.clone(), NOW + 30_000)).resolves.not.toBeNull();
    await expect(verify(request.clone(), NOW + 30_001)).resolves.toBeNull();
  });

  it("supports overlapping current/next key verification", async () => {
    const request = await signedRequest({ keySlot: "next", secret: NEXT });
    await expect(verify(request)).resolves.toMatchObject({ keySlot: "next" });
    await expect(
      verifyFrontendApiRequest({
        environment: "local",
        nowMs: NOW,
        request,
        secrets: { current: CURRENT },
        subtle: crypto.subtle,
      }),
    ).resolves.toBeNull();
  });

  it("bridges a staged A-to-B current-key rotation without changing the sender slot", async () => {
    const request = await signedRequest({ secret: NEXT });
    await expect(
      verifyFrontendApiRequest({
        environment: "local",
        nowMs: NOW,
        request,
        secrets: { current: CURRENT, next: NEXT },
        subtle: crypto.subtle,
      }),
    ).resolves.toMatchObject({ keySlot: "next" });
    await expect(
      verifyFrontendApiRequest({
        environment: "local",
        nowMs: NOW,
        request,
        secrets: { current: NEXT, next: CURRENT },
        subtle: crypto.subtle,
      }),
    ).resolves.toMatchObject({ keySlot: "current" });
  });

  it("treats the slot header only as a bounded verification-order hint", async () => {
    const request = await signedRequest();
    request.headers.set(FRONTEND_API_KEY_SLOT_HEADER, "next");
    await expect(verify(request)).resolves.toMatchObject({
      keySlot: "current",
    });
    request.headers.set(FRONTEND_API_KEY_SLOT_HEADER, "unknown");
    await expect(verify(request)).resolves.toBeNull();
  });

  it.each([
    ["route", "/v1/methodologies/1.0.0", ""],
    ["query", "/v1/metadata", "changed=1"],
  ] as const)("rejects %s alteration", async (_name, path, rawQuery) => {
    const original = await signedRequest();
    const altered = new Request(
      `${FRONTEND_API_INTERNAL_ORIGIN}${path}${rawQuery === "" ? "" : `?${rawQuery}`}`,
      { headers: original.headers },
    );
    await expect(verify(altered)).resolves.toBeNull();
  });

  it("rejects method, publication pin, environment, origin, signature, and future-clock alteration", async () => {
    const request = await signedRequest({ publicationId: PUBLICATION });
    const cases = [
      new Request(request.url, { headers: request.headers, method: "HEAD" }),
      new Request(request.url, { headers: request.headers }),
      new Request("https://api.example.test/v1/metadata", {
        headers: request.headers,
      }),
    ];
    cases[1]?.headers.delete("X-QuantClarity-Publication");
    for (const candidate of cases)
      await expect(verify(candidate)).resolves.toBeNull();
    await expect(
      verifyFrontendApiRequest({
        environment: "test",
        nowMs: NOW,
        request,
        secrets: { current: CURRENT, next: NEXT },
        subtle: crypto.subtle,
      }),
    ).resolves.toBeNull();
    const badSignature = new Request(request);
    badSignature.headers.set(FRONTEND_API_SIGNATURE_HEADER, "A".repeat(43));
    await expect(verify(badSignature)).resolves.toBeNull();
    await expect(verify(request, NOW - 5_001)).resolves.toBeNull();
  });

  it("rejects weak secrets, malformed inputs, and mutation methods without throwing", async () => {
    await expect(
      signFrontendApiRequest({
        environment: "local",
        method: "GET",
        nowMs: NOW,
        path: "/v1/metadata",
        secret: "weak",
        subtle: crypto.subtle,
      }),
    ).resolves.toBeNull();
    const malformed = new Request(
      `${FRONTEND_API_INTERNAL_ORIGIN}/v1/metadata`,
      {
        headers: {
          [FRONTEND_API_ENVELOPE_HEADER]: "***",
          [FRONTEND_API_KEY_SLOT_HEADER]: "current",
          [FRONTEND_API_SIGNATURE_HEADER]: "***",
        },
      },
    );
    await expect(verify(malformed)).resolves.toBeNull();
    await expect(
      signFrontendApiRequest({
        environment: "local",
        method: "GET",
        nowMs: Number.NaN,
        path: "/v1/metadata",
        secret: CURRENT,
        subtle: crypto.subtle,
      }),
    ).resolves.toBeNull();
  });

  it("contains hostile request and crypto capabilities behind a null result", async () => {
    const request = await signedRequest();
    const hostileRequest = Object.create(request) as Request;
    Object.defineProperty(hostileRequest, "headers", {
      get() {
        throw new Error("private hostile detail");
      },
    });
    await expect(verify(hostileRequest)).resolves.toBeNull();

    const hostileSubtle = Object.create(crypto.subtle) as SubtleCrypto;
    Object.defineProperty(hostileSubtle, "digest", {
      value: () => Promise.reject(new Error("private crypto detail")),
    });
    await expect(
      verifyFrontendApiRequest({
        environment: "local",
        nowMs: NOW,
        request,
        secrets: { current: CURRENT, next: NEXT },
        subtle: hostileSubtle,
      }),
    ).resolves.toBeNull();
  });

  it("detects every reserved header without treating ordinary headers as internal", () => {
    expect(
      hasFrontendApiReservedHeaders(new Request("https://example.test")),
    ).toBe(false);
    for (const name of [
      FRONTEND_API_ENVELOPE_HEADER,
      FRONTEND_API_KEY_SLOT_HEADER,
      FRONTEND_API_SIGNATURE_HEADER,
    ])
      expect(
        hasFrontendApiReservedHeaders(
          new Request("https://example.test", { headers: { [name]: "x" } }),
        ),
      ).toBe(true);
  });
});
