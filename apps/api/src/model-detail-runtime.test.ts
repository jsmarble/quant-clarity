import { describe, expect, it, vi } from "vitest";

import {
  captureModelDetailRuntimeCapabilities,
  type ModelDetailRuntimePrimitives,
} from "./model-detail-runtime.js";

const SECRET = "test-only-hmac-key-with-at-least-32-characters";

const noEffect = (name: string) =>
  vi.fn(() => {
    throw new Error(`${name} must not be called during capture`);
  });

const primitives = (): ModelDetailRuntimePrimitives => ({
  cache: { match: noEffect("cache.match"), put: noEffect("cache.put") },
  context: { waitUntil: noEffect("waitUntil") },
  nowMs: noEffect("clock"),
  subtle: crypto.subtle,
});

describe("unrouted Model detail runtime assembly", () => {
  it("snapshots every protected capability exactly once without effects", () => {
    const reads = new Map<string, number>();
    const read = <Value>(name: string, value: Value): Value => {
      reads.set(name, (reads.get(name) ?? 0) + 1);
      return value;
    };
    const queryConnect = noEffect("query.connect");
    const queryFetch = noEffect("query.fetch");
    const readLimit = noEffect("read limiter");
    const rotationLimit = noEffect("rotation limiter");
    const bindings = {
      get API_TRANSPORT_POLICY() {
        return read("API_TRANSPORT_POLICY", "local_test");
      },
      get CATALOG_QUERY() {
        return read("CATALOG_QUERY", {
          connect: queryConnect,
          fetch: queryFetch,
        });
      },
      get DEPLOYMENT_ENV() {
        return read("DEPLOYMENT_ENV", "local");
      },
      get PUBLIC_API_ORIGIN() {
        return read("PUBLIC_API_ORIGIN", "https://api.example.test");
      },
      get RATE_LIMIT_HMAC_KEY() {
        return read("RATE_LIMIT_HMAC_KEY", SECRET);
      },
      get READ_LIMITER() {
        return read("READ_LIMITER", { limit: readLimit });
      },
      get ROTATION_LIMITER() {
        return read("ROTATION_LIMITER", { limit: rotationLimit });
      },
    };
    const runtime = primitives();
    const captured = captureModelDetailRuntimeCapabilities(bindings, runtime);

    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.fromEntries(reads)).toEqual(
      Object.fromEntries(Object.keys(bindings).map((name) => [name, 1])),
    );
    expect(captured.environment).toBe("local");
    expect(captured.protectedCacheOrigin).toBe("https://api.example.test");
    expect(captured.transportPolicy).toBe("local_test");
    expect(runtime.cache.match).not.toHaveBeenCalled();
    expect(runtime.cache.put).not.toHaveBeenCalled();
    expect(runtime.context.waitUntil).not.toHaveBeenCalled();
    expect(runtime.nowMs).not.toHaveBeenCalled();
    expect(queryFetch).not.toHaveBeenCalled();
    expect(queryConnect).not.toHaveBeenCalled();
    expect(readLimit).not.toHaveBeenCalled();
    expect(rotationLimit).not.toHaveBeenCalled();
  });

  it("preserves independently captured limiter authority when downstream getters fail", () => {
    const readLimiter = { limit: vi.fn() };
    const rotationLimiter = { limit: vi.fn() };
    const bindings = {
      API_TRANSPORT_POLICY: "local_test",
      get CATALOG_QUERY(): Service {
        throw new Error("private query diagnostic");
      },
      DEPLOYMENT_ENV: "local",
      get PUBLIC_API_ORIGIN(): string {
        throw new Error("private origin diagnostic");
      },
      RATE_LIMIT_HMAC_KEY: SECRET,
      READ_LIMITER: readLimiter,
      ROTATION_LIMITER: rotationLimiter,
    };

    const captured = captureModelDetailRuntimeCapabilities(
      bindings,
      primitives(),
    );

    expect(captured.queryService).toBeNull();
    expect(captured.protectedCacheOrigin).toBeNull();
    expect(captured.rateLimitSecret).toBe(SECRET);
    expect(captured.readLimiter).toBe(readLimiter);
    expect(captured.rotationLimiter).toBe(rotationLimiter);
  });

  it.each([
    ["wrong environment", "preview", "https://api.example.test", "local_test"],
    ["padded environment", " local", "https://api.example.test", "local_test"],
    ["wrong origin", "local", "https://other.example.test", "local_test"],
    ["origin path", "local", "https://api.example.test/", "local_test"],
    ["crossed policy", "local", "https://api.example.test", "preview_https"],
    ["padded policy", "local", "https://api.example.test", "local_test "],
  ] as const)(
    "fails closed for %s without coercion",
    (_label, environment, origin, policy) => {
      const captured = captureModelDetailRuntimeCapabilities(
        {
          API_TRANSPORT_POLICY: policy,
          CATALOG_QUERY: {} as Service,
          DEPLOYMENT_ENV: environment,
          PUBLIC_API_ORIGIN: origin,
          RATE_LIMIT_HMAC_KEY: SECRET,
          READ_LIMITER: { limit: vi.fn() },
          ROTATION_LIMITER: { limit: vi.fn() },
        },
        primitives(),
      );

      expect(
        captured.environment === "local" &&
          captured.protectedCacheOrigin === "https://api.example.test" &&
          captured.transportPolicy === "local_test",
      ).toBe(false);
    },
  );
});
