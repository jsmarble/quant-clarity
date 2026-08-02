/* global process */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const unicodeDirectory = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(unicodeDirectory, "sources.json"), "utf8"),
);

const argumentsByName = new Map();
let checkOnly = false;
for (let index = 2; index < process.argv.length;) {
  const name = process.argv[index];
  if (name === "--check") {
    checkOnly = true;
    index += 1;
    continue;
  }
  const value = process.argv[index + 1];
  if (!name?.startsWith("--") || value === undefined)
    throw new Error("Arguments must be --name path pairs.");
  argumentsByName.set(name, value);
  index += 2;
}

const sourcePath = (name, localPath) =>
  resolve(argumentsByName.get(name) ?? resolve(unicodeDirectory, localPath));

const paths = {
  derived: sourcePath(
    "--derived",
    manifest.sources.derivedNormalizationProperties.localPath,
  ),
  normalizationTest: sourcePath(
    "--normalization-test",
    manifest.sources.normalizationTest.localPath,
  ),
  unicodeData: sourcePath(
    "--unicode-data",
    manifest.sources.unicodeData.localPath,
  ),
  output: resolve(
    argumentsByName.get("--output") ??
      resolve(unicodeDirectory, "../src/unicode/unicode-17.generated.ts"),
  ),
};

const sourceText = {
  derived: readFileSync(paths.derived, "utf8"),
  normalizationTest: readFileSync(paths.normalizationTest, "utf8"),
  unicodeData: readFileSync(paths.unicodeData, "utf8"),
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const licenseText = readFileSync(
  resolve(unicodeDirectory, manifest.license.localPath),
  "utf8",
);
if (sha256(licenseText) !== manifest.license.sha256)
  throw new Error(
    "The checked-in Unicode license digest does not match the pin.",
  );
const expectedHashes = {
  derived: manifest.sources.derivedNormalizationProperties.sha256,
  normalizationTest: manifest.sources.normalizationTest.sha256,
  unicodeData: manifest.sources.unicodeData.sha256,
};
for (const name of Object.keys(sourceText)) {
  const actual = sha256(sourceText[name]);
  if (actual !== expectedHashes[name])
    throw new Error(`${name} source digest ${actual} does not match the pin.`);
}

const parseRange = (text) => {
  const [firstText, lastText = firstText] = text.split("..");
  return [Number.parseInt(firstText, 16), Number.parseInt(lastText, 16)];
};
const parseCodePoints = (text) =>
  text.trim() === ""
    ? []
    : text
        .trim()
        .split(/\s+/u)
        .map((value) => Number.parseInt(value, 16));

const nfkcCasefoldRanges = [];
const compositionExclusions = new Set();
for (const rawLine of sourceText.derived.split(/\r?\n/u)) {
  const line = rawLine.split("#", 1)[0].trim();
  if (line === "") continue;
  const fields = line.split(";").map((field) => field.trim());
  if (fields[1] === "NFKC_CF") {
    const [first, last] = parseRange(fields[0]);
    nfkcCasefoldRanges.push({
      first,
      last,
      mapping: parseCodePoints(fields[2]),
    });
  } else if (fields[1] === "Full_Composition_Exclusion") {
    const [first, last] = parseRange(fields[0]);
    for (let codePoint = first; codePoint <= last; codePoint += 1)
      compositionExclusions.add(codePoint);
  }
}

const records = new Map();
let pendingRange = null;
for (const line of sourceText.unicodeData.trimEnd().split(/\r?\n/u)) {
  const fields = line.split(";");
  const codePoint = Number.parseInt(fields[0], 16);
  const name = fields[1];
  const record = {
    category: fields[2],
    combiningClass: Number.parseInt(fields[3], 10),
    decomposition:
      fields[5] === "" || fields[5].startsWith("<")
        ? []
        : parseCodePoints(fields[5]),
  };
  if (name.endsWith(", First>")) {
    if (pendingRange !== null) throw new Error("Nested UnicodeData range.");
    pendingRange = { first: codePoint, record };
  } else if (name.endsWith(", Last>")) {
    if (pendingRange === null)
      throw new Error("UnicodeData range end without start.");
    for (let value = pendingRange.first; value <= codePoint; value += 1)
      records.set(value, pendingRange.record);
    pendingRange = null;
  } else {
    records.set(codePoint, record);
  }
}
if (pendingRange !== null) throw new Error("Unclosed UnicodeData range.");

const combiningClasses = new Map();
const canonicalDecompositions = new Map();
const separatorCodePoints = [];
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
for (const [codePoint, record] of records) {
  if (record.combiningClass !== 0)
    combiningClasses.set(codePoint, record.combiningClass);
  if (record.decomposition.length !== 0)
    canonicalDecompositions.set(codePoint, record.decomposition);
  if (separatorCategories.has(record.category))
    separatorCodePoints.push(codePoint);
}

const compositions = new Map();
for (const [composite, decomposition] of canonicalDecompositions) {
  if (decomposition.length !== 2 || compositionExclusions.has(composite))
    continue;
  const [first, second] = decomposition;
  compositions.set(`${first}:${second}`, composite);
}

const S_BASE = 0xac00;
const L_BASE = 0x1100;
const V_BASE = 0x1161;
const T_BASE = 0x11a7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;

const canonicalDecompose = (codePoint, output) => {
  const syllableIndex = codePoint - S_BASE;
  if (syllableIndex >= 0 && syllableIndex < S_COUNT) {
    const leading = L_BASE + Math.floor(syllableIndex / N_COUNT);
    const vowel = V_BASE + Math.floor((syllableIndex % N_COUNT) / T_COUNT);
    const trailing = T_BASE + (syllableIndex % T_COUNT);
    output.push(leading, vowel);
    if (trailing !== T_BASE) output.push(trailing);
    return;
  }
  const decomposition = canonicalDecompositions.get(codePoint);
  if (decomposition === undefined) {
    output.push(codePoint);
    return;
  }
  for (const value of decomposition) canonicalDecompose(value, output);
};

const composePair = (first, second) => {
  const leadingIndex = first - L_BASE;
  if (leadingIndex >= 0 && leadingIndex < L_COUNT) {
    const vowelIndex = second - V_BASE;
    if (vowelIndex >= 0 && vowelIndex < V_COUNT)
      return S_BASE + (leadingIndex * V_COUNT + vowelIndex) * T_COUNT;
  }
  const syllableIndex = first - S_BASE;
  if (
    syllableIndex >= 0 &&
    syllableIndex < S_COUNT &&
    syllableIndex % T_COUNT === 0
  ) {
    const trailingIndex = second - T_BASE;
    if (trailingIndex > 0 && trailingIndex < T_COUNT)
      return first + trailingIndex;
  }
  return compositions.get(`${first}:${second}`);
};

const normalizeNfc = (input) => {
  const ordered = [];
  for (const codePoint of input) {
    const decomposition = [];
    canonicalDecompose(codePoint, decomposition);
    for (const value of decomposition) {
      const combiningClass = combiningClasses.get(value) ?? 0;
      let insertion = ordered.length;
      while (
        combiningClass !== 0 &&
        insertion > 0 &&
        (combiningClasses.get(ordered[insertion - 1]) ?? 0) > combiningClass
      )
        insertion -= 1;
      ordered.splice(insertion, 0, value);
    }
  }
  if (ordered.length === 0) return ordered;
  const output = [ordered[0]];
  let starterIndex = 0;
  let starter = ordered[0];
  let previousClass = combiningClasses.get(starter) ?? 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const value = ordered[index];
    const combiningClass = combiningClasses.get(value) ?? 0;
    const composite = composePair(starter, value);
    if (
      composite !== undefined &&
      (previousClass === 0 || previousClass < combiningClass)
    ) {
      output[starterIndex] = composite;
      starter = composite;
    } else {
      if (combiningClass === 0) {
        starterIndex = output.length;
        starter = value;
      }
      output.push(value);
      previousClass = combiningClass;
    }
  }
  return output;
};

const assertEqualCodePoints = (actual, expected, context) => {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  )
    throw new Error(`${context} failed.`);
};

let normalizationVectorCount = 0;
for (const rawLine of sourceText.normalizationTest.split(/\r?\n/u)) {
  const line = rawLine.split("#", 1)[0].trim();
  if (line === "" || line.startsWith("@")) continue;
  const columns = line.split(";").slice(0, 5).map(parseCodePoints);
  const [source, nfc, nfd, nfkc, nfkd] = columns;
  for (const candidate of [source, nfc, nfd])
    assertEqualCodePoints(
      normalizeNfc(candidate),
      nfc,
      "Unicode NFC invariant",
    );
  for (const candidate of [nfkc, nfkd])
    assertEqualCodePoints(
      normalizeNfc(candidate),
      nfkc,
      "Unicode NFC invariant",
    );
  normalizationVectorCount += 1;
}

for (const range of nfkcCasefoldRanges)
  assertEqualCodePoints(
    normalizeNfc(range.mapping),
    range.mapping,
    `NFKC_CF mapping U+${range.first.toString(16)}`,
  );

const flattenMappings = (entries, valueKey) => {
  const offsets = [0];
  const values = [];
  for (const entry of entries) {
    values.push(...entry[valueKey]);
    offsets.push(values.length);
  }
  return { offsets, values };
};

const nfkcMappings = flattenMappings(nfkcCasefoldRanges, "mapping");
const decompositionEntries = [...canonicalDecompositions]
  .sort(([left], [right]) => left - right)
  .map(([codePoint, mapping]) => ({ codePoint, mapping }));
const decompositionMappings = flattenMappings(decompositionEntries, "mapping");
const compositionEntries = [...compositions]
  .map(([pair, composite]) => {
    const [first, second] = pair.split(":").map(Number);
    return { first, second, composite };
  })
  .sort(
    (left, right) => left.first - right.first || left.second - right.second,
  );

const separatorRanges = [];
for (const codePoint of separatorCodePoints.sort(
  (left, right) => left - right,
)) {
  const previous = separatorRanges.at(-1);
  if (previous !== undefined && previous[1] + 1 === codePoint)
    previous[1] = codePoint;
  else separatorRanges.push([codePoint, codePoint]);
}

const values = (items, width = 12) => {
  const lines = [];
  for (let index = 0; index < items.length; index += width)
    lines.push(`  ${items.slice(index, index + width).join(", ")},`);
  return lines.join("\n");
};
const typedArray = (name, type, items) =>
  `// prettier-ignore\nexport const ${name} = new ${type}([\n${values(items)}\n]);`;

const generated = `/**
 * Generated from the pinned Unicode Character Database ${manifest.unicodeVersion} sources.
 * Do not edit by hand. See packages/publication-core/unicode/README.md.
 */

export const UNICODE_EXACT_SEARCH_DATA_VERSION = "${manifest.unicodeVersion}";
export const UNICODE_DERIVED_NORMALIZATION_SHA256 =
  "${expectedHashes.derived}";
export const UNICODE_NORMALIZATION_TEST_SHA256 =
  "${expectedHashes.normalizationTest}";
export const UNICODE_DATA_SHA256 =
  "${expectedHashes.unicodeData}";
export const UNICODE_LICENSE_SHA256 =
  "${manifest.license.sha256}";
export const UNICODE_NORMALIZATION_VECTOR_COUNT = ${normalizationVectorCount};

${typedArray(
  "NFKC_CASEFOLD_RANGE_STARTS",
  "Uint32Array",
  nfkcCasefoldRanges.map(({ first }) => first),
)}
${typedArray(
  "NFKC_CASEFOLD_RANGE_ENDS",
  "Uint32Array",
  nfkcCasefoldRanges.map(({ last }) => last),
)}
${typedArray("NFKC_CASEFOLD_MAPPING_OFFSETS", "Uint32Array", nfkcMappings.offsets)}
${typedArray("NFKC_CASEFOLD_MAPPING_VALUES", "Uint32Array", nfkcMappings.values)}

${typedArray(
  "CANONICAL_COMBINING_CLASS_KEYS",
  "Uint32Array",
  [...combiningClasses.keys()].sort((left, right) => left - right),
)}
${typedArray(
  "CANONICAL_COMBINING_CLASS_VALUES",
  "Uint8Array",
  [...combiningClasses]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value),
)}

${typedArray(
  "CANONICAL_DECOMPOSITION_KEYS",
  "Uint32Array",
  decompositionEntries.map(({ codePoint }) => codePoint),
)}
${typedArray("CANONICAL_DECOMPOSITION_OFFSETS", "Uint32Array", decompositionMappings.offsets)}
${typedArray("CANONICAL_DECOMPOSITION_VALUES", "Uint32Array", decompositionMappings.values)}

${typedArray(
  "CANONICAL_COMPOSITION_FIRST",
  "Uint32Array",
  compositionEntries.map(({ first }) => first),
)}
${typedArray(
  "CANONICAL_COMPOSITION_SECOND",
  "Uint32Array",
  compositionEntries.map(({ second }) => second),
)}
${typedArray(
  "CANONICAL_COMPOSITION_VALUES",
  "Uint32Array",
  compositionEntries.map(({ composite }) => composite),
)}

${typedArray("EXACT_SEARCH_SEPARATOR_RANGES", "Uint32Array", separatorRanges.flat())}
`;

if (checkOnly) {
  if (readFileSync(paths.output, "utf8") !== generated)
    throw new Error(`Generated Unicode table is stale: ${paths.output}`);
  process.stdout.write(
    `Verified ${paths.output} against ${normalizationVectorCount} Unicode normalization vectors.\n`,
  );
} else {
  writeFileSync(paths.output, generated, "utf8");
  process.stdout.write(
    `Generated ${paths.output} from ${normalizationVectorCount} Unicode normalization vectors.\n`,
  );
}
