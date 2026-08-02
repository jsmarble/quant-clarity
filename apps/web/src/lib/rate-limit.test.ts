import { describe, expect, it, vi } from "vitest";

import { rateLimitDecision, type FrontendRateLimitEnv } from "./rate-limit.js";

function environment(
  readSuccess: boolean,
  deployment = "test",
  secret: string | undefined = "test-only-hmac-key-with-at-least-32-characters",
): FrontendRateLimitEnv {
  return {
    DEPLOYMENT_ENV: deployment,
    RATE_LIMIT_HMAC_KEY: secret,
    READ_LIMITER: {
      limit: vi.fn().mockResolvedValue({ success: readSuccess }),
    },
    ROTATION_LIMITER: {
      limit: vi.fn().mockResolvedValue({ success: true }),
    },
  };
}

describe("frontend transient rate limiting (API-020, API-022)", () => {
  it("distinguishes an exceeded limit from an unavailable limiter", async () => {
    const request = new Request("https://example.test/", {
      headers: { "CF-Connecting-IP": "203.0.113.8" },
    });
    await expect(rateLimitDecision(request, environment(false))).resolves.toBe(
      "limited",
    );
    const missingSecret = environment(true, "production");
    delete missingSecret.RATE_LIMIT_HMAC_KEY;
    await expect(rateLimitDecision(request, missingSecret)).resolves.toBe(
      "unavailable",
    );
    await expect(
      rateLimitDecision(
        new Request("https://example.test/"),
        environment(true),
      ),
    ).resolves.toBe("unavailable");
  });

  it("uses only a fixed local-only bootstrap key outside deployed environments", async () => {
    const request = new Request("https://example.test/", {
      headers: { "CF-Connecting-IP": "2001:db8::1" },
    });
    const local = environment(true, "local");
    delete local.RATE_LIMIT_HMAC_KEY;
    await expect(rateLimitDecision(request, local)).resolves.toBe("allowed");
  });
});
