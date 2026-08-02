import { describe, expect, it } from "vitest";

import { canonicalPrice, createResourceId, offeringIsStale } from "./index.js";

describe("canonical identity and policy helpers", () => {
  it("generates persisted opaque prefixed IDs", () => {
    expect(
      createResourceId("model", () => "00000000-0000-4000-8000-000000000001"),
    ).toBe("mdl_00000000-0000-4000-8000-000000000001");
  });

  it("applies the visible USD system default only when currency is omitted", () => {
    expect(canonicalPrice("0.20", null)).toMatchObject({
      currency: "USD",
      currencyProvenance: "system_default",
    });
    expect(canonicalPrice("0.20", "EUR")).toMatchObject({
      currency: "EUR",
      currencyProvenance: "provider_stated",
    });
    expect(() => canonicalPrice("0.20", "usd")).toThrow(RangeError);
  });

  it("uses the earlier of two missed completed opportunities or eight days", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(
      offeringIsStale({
        lastSuccessfulObservationMs: 0,
        publicationTimeMs: day,
        consecutiveMissedCompletedOpportunities: 2,
      }),
    ).toBe(true);
    expect(
      offeringIsStale({
        lastSuccessfulObservationMs: 0,
        publicationTimeMs: 8 * day,
        consecutiveMissedCompletedOpportunities: 1,
      }),
    ).toBe(false);
    expect(
      offeringIsStale({
        lastSuccessfulObservationMs: 0,
        publicationTimeMs: 8 * day + 1,
        consecutiveMissedCompletedOpportunities: 0,
      }),
    ).toBe(true);
  });
});
