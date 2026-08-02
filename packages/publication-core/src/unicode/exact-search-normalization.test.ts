import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXACT_SEARCH_NORMALIZATION_VERSION,
  EXACT_SEARCH_UNICODE_VERSION,
  normalizeExactSearchName,
} from "./exact-search-normalization.js";
import {
  UNICODE_DATA_SHA256,
  UNICODE_DERIVED_NORMALIZATION_SHA256,
  UNICODE_LICENSE_SHA256,
  UNICODE_NORMALIZATION_TEST_SHA256,
  UNICODE_NORMALIZATION_VECTOR_COUNT,
} from "./unicode-17.generated.js";

const unicodeDirectory = resolve(
  "packages",
  "publication-core",
  "unicode",
  "17.0.0",
);

const codePoints = (value: string): number[] =>
  value.trim() === ""
    ? []
    : value
        .trim()
        .split(/\s+/u)
        .map((item) => Number.parseInt(item, 16));

const referenceMappings = new Map<number, string>();
for (const rawLine of readFileSync(
  resolve(unicodeDirectory, "DerivedNormalizationProps.txt"),
  "utf8",
).split(/\r?\n/u)) {
  const line = (rawLine.split("#", 1)[0] ?? "").trim();
  if (line === "") continue;
  const fields = line.split(";").map((field) => field.trim());
  if (fields[1] !== "NFKC_CF") continue;
  const [firstText, lastText = firstText] = fields[0]!.split("..");
  const first = Number.parseInt(firstText!, 16);
  const last = Number.parseInt(lastText!, 16);
  const mapped = String.fromCodePoint(...codePoints(fields[2]!));
  for (let value = first; value <= last; value += 1)
    referenceMappings.set(value, mapped);
}

const separatorCategories = new Set([
  "Pc",
  "Pd",
  "Pe",
  "Pf",
  "Pi",
  "Po",
  "Ps",
  "Zl",
  "Zp",
  "Zs",
]);
const referenceSeparators = new Set<number>([9, 10, 11, 12, 13]);
let pendingSeparatorRange: Readonly<{
  first: number;
  category: string;
}> | null = null;
for (const line of readFileSync(
  resolve(unicodeDirectory, "UnicodeData.txt"),
  "utf8",
)
  .trimEnd()
  .split(/\r?\n/u)) {
  const fields = line.split(";");
  const value = Number.parseInt(fields[0]!, 16);
  const name = fields[1]!;
  const category = fields[2]!;
  if (name.endsWith(", First>")) {
    pendingSeparatorRange = { first: value, category };
  } else if (name.endsWith(", Last>")) {
    if (
      pendingSeparatorRange !== null &&
      separatorCategories.has(pendingSeparatorRange.category)
    )
      for (
        let member = pendingSeparatorRange.first;
        member <= value;
        member += 1
      )
        referenceSeparators.add(member);
    pendingSeparatorRange = null;
  } else if (separatorCategories.has(category)) {
    referenceSeparators.add(value);
  }
}

/** Independent test oracle: raw UCD parsing plus the separately pinned Node 24 Unicode 17 NFC. */
const referenceNormalize = (input: string): string => {
  let mapped = "";
  for (const character of input) {
    const value = character.codePointAt(0)!;
    mapped += referenceMappings.get(value) ?? character;
  }
  const output: string[] = [];
  let previousWasSpace = true;
  for (const character of mapped.normalize("NFC")) {
    const value = character.codePointAt(0)!;
    if (referenceSeparators.has(value)) {
      if (!previousWasSpace) output.push(" ");
      previousWasSpace = true;
    } else {
      output.push(character);
      previousWasSpace = false;
    }
  }
  if (output.at(-1) === " ") output.pop();
  if (output.length === 0) throw new RangeError("empty");
  return output.join("");
};

const compareWithReference = (input: string): void => {
  let expected: string | undefined;
  try {
    expected = referenceNormalize(input);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  if (expected === undefined) {
    try {
      normalizeExactSearchName(input);
      throw new Error("production normalization accepted empty output");
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  } else {
    const actual = normalizeExactSearchName(input);
    if (actual !== expected)
      throw new Error(
        `normalization mismatch for ${JSON.stringify(input)}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
      );
  }
};

describe("exact-search-normalization@1 (SRCH-002, QA-005)", () => {
  it("pins the Unicode release, official source digests, and conformance count", () => {
    expect(EXACT_SEARCH_NORMALIZATION_VERSION).toBe(
      "exact-search-normalization@1",
    );
    expect(EXACT_SEARCH_UNICODE_VERSION).toBe("17.0.0");
    expect(UNICODE_DERIVED_NORMALIZATION_SHA256).toBe(
      "71fd6a206a2c0cdd41feb6b7f656aa31091db45e9cedc926985d718397f9e488",
    );
    expect(UNICODE_DATA_SHA256).toBe(
      "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c",
    );
    expect(UNICODE_NORMALIZATION_TEST_SHA256).toBe(
      "5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db",
    );
    expect(UNICODE_LICENSE_SHA256).toBe(
      "e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96",
    );
    expect(UNICODE_NORMALIZATION_VECTOR_COUNT).toBe(20_034);
    expect(process.versions.unicode).toBe("17.0");
  });

  it("applies compatibility folding and full default case folding", () => {
    expect(normalizeExactSearchName("ＡＣＭＥ Straße K")).toBe(
      "acme strasse k",
    );
    expect(normalizeExactSearchName("İstanbul")).toBe("i\u0307stanbul");
  });

  it("performs the required NFC pass after per-code-point NFKC_CF mapping", () => {
    expect(normalizeExactSearchName("\u1e0a\u0323 Cloud")).toBe(
      "\u1e0d\u0307 cloud",
    );
    expect(normalizeExactSearchName("\u1100\u1161\u11a8")).toBe("각");
  });

  it("maps the closed punctuation, separator, and ASCII whitespace set", () => {
    expect(normalizeExactSearchName("  Acme—Cloud_Inc.\t(API)\n")).toBe(
      "acme cloud inc api",
    );
    expect(normalizeExactSearchName("Cloud☁GPU")).toBe("cloud☁gpu");
  });

  it("removes Unicode default-ignorables through NFKC_CF", () => {
    expect(normalizeExactSearchName("Ac\u200bme\ufe0f")).toBe("acme");
  });

  it("rejects empty output and either form of unpaired surrogate", () => {
    expect(() => normalizeExactSearchName("—___\t")).toThrow(RangeError);
    expect(() => normalizeExactSearchName("\u200b\ufe0f")).toThrow(RangeError);
    expect(() => normalizeExactSearchName("a\ud800b")).toThrow(
      "Exact-search input contains an unpaired surrogate.",
    );
    expect(() => normalizeExactSearchName("a\ud800")).toThrow(
      "Exact-search input contains an unpaired surrogate.",
    );
    expect(() => normalizeExactSearchName("a\udc00b")).toThrow(
      "Exact-search input contains an unpaired surrogate.",
    );
  });

  it("matches an independent raw-UCD oracle for every mapping/category scalar and 100,170 official normalization inputs", () => {
    const affected = new Set([
      ...referenceMappings.keys(),
      ...referenceSeparators,
    ]);
    for (const value of affected)
      compareWithReference(String.fromCodePoint(value));

    let compared = 0;
    for (const rawLine of readFileSync(
      resolve(unicodeDirectory, "NormalizationTest.txt"),
      "utf8",
    ).split(/\r?\n/u)) {
      const line = (rawLine.split("#", 1)[0] ?? "").trim();
      if (line === "" || line.startsWith("@")) continue;
      for (const column of line.split(";").slice(0, 5)) {
        compareWithReference(String.fromCodePoint(...codePoints(column)));
        compared += 1;
      }
    }
    expect(compared).toBe(100_170);
  });
});
