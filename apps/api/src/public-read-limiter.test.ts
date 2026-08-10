import { describe, expect, it, vi } from "vitest";

import { limitPublicReadRequest } from "./public-read-limiter.js";

const SECRET = "test-only-hmac-key-with-at-least-32-characters";

const limiter = (
  calls: string[],
  result: unknown = { success: true },
): RateLimit => ({
  limit: vi.fn(({ key }: RateLimitOptions) => {
    calls.push(key);
    return Promise.resolve(result as RateLimitOutcome);
  }),
});

describe("ephemeral public read limiter (API-020–API-024, PRIV-006)", () => {
  it("derives one opaque IPv4 key and returns only an admission decision", async () => {
    const readKeys: string[] = [];
    const rotationKeys: string[] = [];
    const outcome = await limitPublicReadRequest({
      readLimiter: limiter(readKeys),
      rotationLimiter: limiter(rotationKeys),
      secret: SECRET,
      sourceAddress: "203.0.113.9",
      subtle: crypto.subtle,
    });

    expect(outcome).toBe("allowed");
    expect(readKeys).toHaveLength(1);
    expect(readKeys[0]).toMatch(/^[0-9a-f]{64}$/u);
    expect(readKeys[0]).not.toContain("203.0.113.9");
    expect(rotationKeys).toEqual([]);
  });

  it("settles both domain-separated IPv6 controls before returning denial", async () => {
    const readKeys: string[] = [];
    const rotationKeys: string[] = [];
    const outcome = await limitPublicReadRequest({
      readLimiter: limiter(readKeys, { success: false }),
      rotationLimiter: limiter(rotationKeys),
      secret: SECRET,
      sourceAddress: "2001:db8:abcd:12::99",
      subtle: crypto.subtle,
    });

    expect(outcome).toBe("rate_limited");
    expect(readKeys).toHaveLength(1);
    expect(rotationKeys).toHaveLength(1);
    expect(readKeys[0]).not.toBe(rotationKeys[0]);
    expect(readKeys[0]).not.toContain("2001:db8");
    expect(rotationKeys[0]).not.toContain("2001:db8");
  });

  it("gives either limiter fault precedence without skipping the other", async () => {
    const events: string[] = [];
    const readLimiter: RateLimit = {
      limit: vi.fn(() => {
        events.push("read");
        return Promise.reject(new Error("private diagnostic"));
      }),
    };
    const rotationLimiter: RateLimit = {
      limit: vi.fn(() => {
        events.push("rotation");
        return Promise.resolve({ success: false });
      }),
    };

    await expect(
      limitPublicReadRequest({
        readLimiter,
        rotationLimiter,
        secret: SECRET,
        sourceAddress: "2001:db8:abcd:12::99",
        subtle: crypto.subtle,
      }),
    ).resolves.toBe("unavailable");
    expect(events).toEqual(["read", "rotation"]);
  });

  it("uses every viable applicable capability when the other method is hostile", async () => {
    const events: string[] = [];
    const hostile = Object.defineProperty({}, "limit", {
      get() {
        events.push("hostile.get");
        throw new Error("revoked binding");
      },
    }) as RateLimit;
    const working: RateLimit = {
      limit: vi.fn(() => {
        events.push("working.call");
        return Promise.resolve({ success: true });
      }),
    };

    await expect(
      limitPublicReadRequest({
        readLimiter: hostile,
        rotationLimiter: working,
        secret: SECRET,
        sourceAddress: "2001:db8:abcd:12::99",
        subtle: crypto.subtle,
      }),
    ).resolves.toBe("unavailable");
    expect(events).toEqual(["hostile.get", "working.call"]);

    events.length = 0;
    await expect(
      limitPublicReadRequest({
        readLimiter: working,
        rotationLimiter: hostile,
        secret: SECRET,
        sourceAddress: "2001:db8:abcd:12::99",
        subtle: crypto.subtle,
      }),
    ).resolves.toBe("unavailable");
    expect(events).toEqual(["hostile.get", "working.call"]);
  });

  it("never inspects an inapplicable IPv4 rotation capability", async () => {
    const events: string[] = [];
    const hostileRotation = Object.defineProperty({}, "limit", {
      get() {
        events.push("rotation.get");
        throw new Error("must remain unused");
      },
    }) as RateLimit;
    const readLimiter: RateLimit = {
      limit: vi.fn(() => {
        events.push("read.call");
        return Promise.resolve({ success: true });
      }),
    };
    await expect(
      limitPublicReadRequest({
        readLimiter,
        rotationLimiter: hostileRotation,
        secret: SECRET,
        sourceAddress: "203.0.113.9",
        subtle: crypto.subtle,
      }),
    ).resolves.toBe("allowed");
    expect(events).toEqual(["read.call"]);
  });

  it.each([
    {},
    { success: 1 },
    { extra: true, success: true },
    Object.create({ success: true }) as unknown,
    Object.defineProperty({}, "success", { get: () => true }) as unknown,
  ])("rejects hostile limiter output %#", async (hostile) => {
    const calls: string[] = [];
    await expect(
      limitPublicReadRequest({
        readLimiter: limiter(calls, hostile),
        rotationLimiter: limiter([]),
        secret: SECRET,
        sourceAddress: "203.0.113.9",
        subtle: crypto.subtle,
      }),
    ).resolves.toBe("unavailable");
    expect(calls).toHaveLength(1);
  });

  it.each([0, 31, 33])(
    "rejects a malformed %s-byte HMAC result before limiting",
    async (length) => {
      const calls: string[] = [];
      const hostileSubtle = Object.create(crypto.subtle) as SubtleCrypto;
      Object.defineProperty(hostileSubtle, "sign", {
        value: vi.fn(() => Promise.resolve(new ArrayBuffer(length))),
      });
      await expect(
        limitPublicReadRequest({
          readLimiter: limiter(calls),
          rotationLimiter: limiter(calls),
          secret: SECRET,
          sourceAddress: "203.0.113.9",
          subtle: hostileSubtle,
        }),
      ).resolves.toBe("unavailable");
      expect(calls).toEqual([]);
    },
  );

  it.each([
    [null, SECRET],
    ["invalid-address", SECRET],
    ["203.0.113.9", "short"],
  ] as const)(
    "fails closed for unsafe address/key %#",
    async (address, secret) => {
      const calls: string[] = [];
      await expect(
        limitPublicReadRequest({
          readLimiter: limiter(calls),
          rotationLimiter: limiter(calls),
          secret,
          sourceAddress: address,
          subtle: crypto.subtle,
        }),
      ).resolves.toBe("unavailable");
      expect(calls).toEqual([]);
    },
  );
});
