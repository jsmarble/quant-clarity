import Decimal from "decimal.js";

export { sourcePrefixes, type SourcePrefixes } from "./source-address.js";

export const KNOWN_PRECISION_FORMATS = [
  "BF16",
  "FP16",
  "FP8",
  "FP6",
  "FP4",
  "NVFP4",
  "MXFP4",
  "INT8",
  "INT4",
  "MIXED",
  "OTHER",
  "UNKNOWN",
] as const;

export type PrecisionFormat = (typeof KNOWN_PRECISION_FORMATS)[number];

const PRECISION_ALIASES: Readonly<Record<string, PrecisionFormat>> = {
  BF16: "BF16",
  BFLOAT16: "BF16",
  FP16: "FP16",
  FLOAT16: "FP16",
  HALF: "FP16",
  FP8: "FP8",
  FLOAT8: "FP8",
  FP6: "FP6",
  FP4: "FP4",
  NVFP4: "NVFP4",
  MXFP4: "MXFP4",
  INT8: "INT8",
  INTEGER8: "INT8",
  INT4: "INT4",
  INTEGER4: "INT4",
  MIXED: "MIXED",
  MIXEDPRECISION: "MIXED",
};

export function normalizePrecision(
  raw: string | null | undefined,
): PrecisionFormat {
  if (raw === null || raw === undefined || raw.trim() === "") return "UNKNOWN";
  const key = raw.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  return PRECISION_ALIASES[key] ?? "OTHER";
}

export function compareExactDecimal(left: string, right: string): number {
  return new Decimal(assertNonNegativeDecimal(left)).comparedTo(
    new Decimal(assertNonNegativeDecimal(right)),
  );
}

export function decimalSortKey(value: string): string {
  const normalized = assertNonNegativeDecimal(value);
  const [integer = "0", fractional = ""] = normalized.split(".");
  return `${integer.padStart(24, "0")}.${fractional.padEnd(18, "0")}`;
}

export function assertNonNegativeDecimal(value: string): string {
  const match = /^(0|[1-9][0-9]{0,23})(?:\.([0-9]{1,18}))?$/u.exec(value);
  if (match === null) {
    throw new RangeError(
      "Price must use unsigned plain-decimal syntax with at most 24 integer and 18 fractional digits.",
    );
  }
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new RangeError("Price must be a finite non-negative decimal string.");
  }
  return decimal.toFixed();
}

export function compareStableText(left: string, right: string): number {
  const normalizedLeft = left.normalize("NFKC").toLowerCase();
  const normalizedRight = right.normalize("NFKC").toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function isStale(
  observedAt: string,
  now: string,
  thresholdHours: number,
): boolean {
  if (!Number.isFinite(thresholdHours) || thresholdHours < 0) {
    throw new RangeError("Staleness threshold must be non-negative.");
  }
  const timestampPattern =
    /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
  const observed = Date.parse(observedAt);
  const current = Date.parse(now);
  if (
    !timestampPattern.test(observedAt) ||
    !timestampPattern.test(now) ||
    Number.isNaN(observed) ||
    Number.isNaN(current) ||
    new Date(observed).toISOString() !== observedAt ||
    new Date(current).toISOString() !== now
  ) {
    throw new RangeError("Staleness timestamps must be valid RFC 3339 values.");
  }
  return current - observed > thresholdHours * 60 * 60 * 1000;
}
