import { describe, expect, it } from "vitest";

import {
  assertNonNegativeDecimal,
  compareExactDecimal,
  isStale,
  normalizePrecision,
  sourcePrefixes,
} from "./index.js";

describe("precision normalization (QA-001, QA-010)", () => {
  it("keeps BF16 and FP16 distinct", () => {
    expect(normalizePrecision("bfloat16")).toBe("BF16");
    expect(normalizePrecision("float16")).toBe("FP16");
  });

  it("keeps missing precision unknown and unfamiliar labels other", () => {
    expect(normalizePrecision(undefined)).toBe("UNKNOWN");
    expect(normalizePrecision("provider-special")).toBe("OTHER");
  });
});

describe("exact decimals (API-006, QA-001)", () => {
  it("sorts beyond IEEE-754 precision", () => {
    expect(compareExactDecimal("0.100000000000000001", "0.1")).toBeGreaterThan(
      0,
    );
  });

  it("normalizes non-negative decimal strings", () => {
    expect(assertNonNegativeDecimal("0.0100")).toBe("0.01");
    expect(() => assertNonNegativeDecimal("-0.01")).toThrow(RangeError);
    for (const invalid of [
      "1e3",
      "+1",
      ".5",
      "1.",
      "01",
      "0.0000000000000000001",
    ])
      expect(() => assertNonNegativeDecimal(invalid)).toThrow(RangeError);
  });
});

describe("staleness (QA-001)", () => {
  it("uses an explicit strict threshold", () => {
    expect(
      isStale("2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z", 24),
    ).toBe(false);
    expect(
      isStale("2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.001Z", 24),
    ).toBe(true);
  });

  it("rejects timestamps outside the UTC millisecond RFC 3339 profile", () => {
    for (const invalid of [
      "2026-08-01",
      "2026-08-01T00:00:00Z",
      "2026-08-01T00:00:00.000+00:00",
      "2026-02-30T00:00:00.000Z",
    ])
      expect(() => isStale(invalid, "2026-08-02T00:00:00.000Z", 24)).toThrow(
        RangeError,
      );
  });
});

describe("transient source-address policy (API-020, QA-014)", () => {
  it("uses exact IPv4 and stable IPv6 /64 plus rotation /48 prefixes", () => {
    expect(sourcePrefixes("203.0.113.9")).toEqual({
      primary: "v4:203.0.113.9/32",
      rotation: null,
    });
    expect(sourcePrefixes("2001:db8:abcd:12::99")).toEqual({
      primary: "v6:2001:0db8:abcd:0012/64",
      rotation: "v6:2001:0db8:abcd/48",
    });
    expect(sourcePrefixes("2001:db8:abcd:12::beef")).toEqual(
      sourcePrefixes("2001:db8:abcd:12::99"),
    );
    expect(sourcePrefixes("::ffff:203.0.113.9")).toEqual({
      primary: "v4:203.0.113.9/32",
      rotation: null,
    });
  });

  it("rejects malformed addresses rather than inventing a key", () => {
    expect(sourcePrefixes("999.0.0.1")).toBeNull();
    expect(sourcePrefixes("2001::db8::1")).toBeNull();
  });
});
