import { describe, expect, it } from "vitest";

import { configuredSiteOrigin } from "./site-origin.js";

describe("canonical site release gate (FE-061)", () => {
  it("omits canonical origins from local and preview builds", () => {
    expect(configuredSiteOrigin({})).toBeUndefined();
    expect(
      configuredSiteOrigin({ QUANTCLARITY_BUILD_ENV: "preview" }),
    ).toBeUndefined();
  });

  it("requires an exact HTTPS origin in production", () => {
    expect(() =>
      configuredSiteOrigin({ QUANTCLARITY_BUILD_ENV: "production" }),
    ).toThrow(/require/u);
    for (const origin of [
      "http://example.test",
      "https://example.test/",
      "https://example.test/path",
      "https://user@example.test",
    ])
      expect(() =>
        configuredSiteOrigin({
          QUANTCLARITY_BUILD_ENV: "production",
          QUANTCLARITY_SITE_ORIGIN: origin,
        }),
      ).toThrow(/HTTPS origin/u);

    expect(
      configuredSiteOrigin({
        QUANTCLARITY_BUILD_ENV: "production",
        QUANTCLARITY_SITE_ORIGIN: "https://quantclarity.example",
      }),
    ).toBe("https://quantclarity.example");
  });
});
