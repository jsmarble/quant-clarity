import {
  CANONICAL_COMBINING_CLASS_KEYS,
  CANONICAL_COMBINING_CLASS_VALUES,
  CANONICAL_COMPOSITION_FIRST,
  CANONICAL_COMPOSITION_SECOND,
  CANONICAL_COMPOSITION_VALUES,
  CANONICAL_DECOMPOSITION_KEYS,
  CANONICAL_DECOMPOSITION_OFFSETS,
  CANONICAL_DECOMPOSITION_VALUES,
  EXACT_SEARCH_SEPARATOR_RANGES,
  NFKC_CASEFOLD_MAPPING_OFFSETS,
  NFKC_CASEFOLD_MAPPING_VALUES,
  NFKC_CASEFOLD_RANGE_ENDS,
  NFKC_CASEFOLD_RANGE_STARTS,
  UNICODE_EXACT_SEARCH_DATA_VERSION,
  UNICODE_NFKC_CASEFOLD_MAX_UNICODE_SCALAR_EXPANSION,
} from "./unicode-17.generated.js";

export const EXACT_SEARCH_NORMALIZATION_VERSION =
  "exact-search-normalization@1";
export const EXACT_SEARCH_UNICODE_VERSION = UNICODE_EXACT_SEARCH_DATA_VERSION;
// Generated from the pinned Unicode NFKC_Casefold table. NFC and separator
// collapse cannot increase this per-input-scalar upper bound.
export const EXACT_SEARCH_NORMALIZATION_MAX_UNICODE_SCALAR_EXPANSION =
  UNICODE_NFKC_CASEFOLD_MAX_UNICODE_SCALAR_EXPANSION;

const S_BASE = 0xac00;
const L_BASE = 0x1100;
const V_BASE = 0x1161;
const T_BASE = 0x11a7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;

const at = (values: Uint8Array | Uint32Array, index: number): number => {
  const value = values[index];
  if (value === undefined)
    throw new Error("The checked-in Unicode table is corrupt.");
  return value;
};

const exactIndex = (values: Uint32Array, target: number): number => {
  let low = 0;
  let high = values.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const value = at(values, middle);
    if (value === target) return middle;
    if (value < target) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
};

const rangeIndex = (
  starts: Uint32Array,
  ends: Uint32Array,
  target: number,
): number => {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const start = at(starts, middle);
    if (target < start) {
      high = middle - 1;
      continue;
    }
    if (target > at(ends, middle)) {
      low = middle + 1;
      continue;
    }
    return middle;
  }
  return -1;
};

const appendNfkcCasefold = (codePoint: number, output: number[]): void => {
  const index = rangeIndex(
    NFKC_CASEFOLD_RANGE_STARTS,
    NFKC_CASEFOLD_RANGE_ENDS,
    codePoint,
  );
  if (index === -1) {
    output.push(codePoint);
    return;
  }
  const start = at(NFKC_CASEFOLD_MAPPING_OFFSETS, index);
  const end = at(NFKC_CASEFOLD_MAPPING_OFFSETS, index + 1);
  for (let offset = start; offset < end; offset += 1)
    output.push(at(NFKC_CASEFOLD_MAPPING_VALUES, offset));
};

const combiningClass = (codePoint: number): number => {
  const index = exactIndex(CANONICAL_COMBINING_CLASS_KEYS, codePoint);
  return index === -1 ? 0 : at(CANONICAL_COMBINING_CLASS_VALUES, index);
};

const appendCanonicalDecomposition = (
  codePoint: number,
  output: number[],
): void => {
  const syllableIndex = codePoint - S_BASE;
  if (syllableIndex >= 0 && syllableIndex < S_COUNT) {
    output.push(
      L_BASE + Math.floor(syllableIndex / N_COUNT),
      V_BASE + Math.floor((syllableIndex % N_COUNT) / T_COUNT),
    );
    const trailing = T_BASE + (syllableIndex % T_COUNT);
    if (trailing !== T_BASE) output.push(trailing);
    return;
  }

  const index = exactIndex(CANONICAL_DECOMPOSITION_KEYS, codePoint);
  if (index === -1) {
    output.push(codePoint);
    return;
  }
  const start = at(CANONICAL_DECOMPOSITION_OFFSETS, index);
  const end = at(CANONICAL_DECOMPOSITION_OFFSETS, index + 1);
  for (let offset = start; offset < end; offset += 1)
    appendCanonicalDecomposition(
      at(CANONICAL_DECOMPOSITION_VALUES, offset),
      output,
    );
};

const composition = (first: number, second: number): number | undefined => {
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

  let low = 0;
  let high = CANONICAL_COMPOSITION_FIRST.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const middleFirst = at(CANONICAL_COMPOSITION_FIRST, middle);
    const middleSecond = at(CANONICAL_COMPOSITION_SECOND, middle);
    if (middleFirst === first && middleSecond === second)
      return at(CANONICAL_COMPOSITION_VALUES, middle);
    if (middleFirst < first || (middleFirst === first && middleSecond < second))
      low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
};

const normalizeNfc = (input: readonly number[]): number[] => {
  const ordered: number[] = [];
  for (const codePoint of input) {
    const decomposition: number[] = [];
    appendCanonicalDecomposition(codePoint, decomposition);
    for (const value of decomposition) {
      const valueClass = combiningClass(value);
      let insertion = ordered.length;
      while (
        valueClass !== 0 &&
        insertion > 0 &&
        combiningClass(atFromArray(ordered, insertion - 1)) > valueClass
      )
        insertion -= 1;
      ordered.splice(insertion, 0, value);
    }
  }
  if (ordered.length === 0) return ordered;

  const first = atFromArray(ordered, 0);
  const output = [first];
  let starterIndex = 0;
  let starter = first;
  let previousClass = combiningClass(first);
  for (let index = 1; index < ordered.length; index += 1) {
    const value = atFromArray(ordered, index);
    const valueClass = combiningClass(value);
    const composite = composition(starter, value);
    if (
      composite !== undefined &&
      (previousClass === 0 || previousClass < valueClass)
    ) {
      output[starterIndex] = composite;
      starter = composite;
      continue;
    }
    if (valueClass === 0) {
      starterIndex = output.length;
      starter = value;
    }
    output.push(value);
    previousClass = valueClass;
  }
  return output;
};

const atFromArray = (values: readonly number[], index: number): number => {
  const value = values[index];
  if (value === undefined)
    throw new Error("Unicode normalization state is corrupt.");
  return value;
};

const isSeparator = (codePoint: number): boolean => {
  if (codePoint >= 0x09 && codePoint <= 0x0d) return true;
  let low = 0;
  let high = EXACT_SEARCH_SEPARATOR_RANGES.length / 2 - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const start = at(EXACT_SEARCH_SEPARATOR_RANGES, middle * 2);
    const end = at(EXACT_SEARCH_SEPARATOR_RANGES, middle * 2 + 1);
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return true;
  }
  return false;
};

const assertPairedSurrogates = (input: string): void => {
  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= input.length)
        throw new RangeError(
          "Exact-search input contains an unpaired surrogate.",
        );
      const trailing = input.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff)
        throw new RangeError(
          "Exact-search input contains an unpaired surrogate.",
        );
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new RangeError(
        "Exact-search input contains an unpaired surrogate.",
      );
    }
  }
};

const codePointsToString = (codePoints: readonly number[]): string => {
  const chunks: string[] = [];
  for (let index = 0; index < codePoints.length; index += 1024)
    chunks.push(String.fromCodePoint(...codePoints.slice(index, index + 1024)));
  return chunks.join("");
};

/** Implements ADR 0021's pinned `exact-search-normalization@1`. */
export const normalizeExactSearchName = (input: string): string => {
  assertPairedSurrogates(input);

  const mapped: number[] = [];
  for (const character of input) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined)
      throw new Error("Unicode iteration produced an empty character.");
    appendNfkcCasefold(codePoint, mapped);
  }

  const normalized = normalizeNfc(mapped);
  const collapsed: number[] = [];
  let previousWasSpace = true;
  for (const codePoint of normalized) {
    if (isSeparator(codePoint)) {
      if (!previousWasSpace) collapsed.push(0x20);
      previousWasSpace = true;
    } else {
      collapsed.push(codePoint);
      previousWasSpace = false;
    }
  }
  if (collapsed.at(-1) === 0x20) collapsed.pop();
  if (collapsed.length === 0)
    throw new RangeError("Exact-search normalization produced an empty value.");
  return codePointsToString(collapsed);
};
