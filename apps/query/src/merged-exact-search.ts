import { normalizeExactSearchName } from "@quant-clarity/publication-core";

import {
  attachExistingModelCardView,
  attachedModelCardView,
  type ModelCardView,
} from "./model-card-view.js";
import {
  attachExistingVariantCardView,
  attachedVariantCardView,
  type VariantCardView,
} from "./variant-card-view.js";
import {
  ModelVariantExactNameError,
  readModelVariantExactNamePage,
  type ModelVariantExactNameResult,
} from "./model-variant-exact-name.js";
import {
  ProviderExactNameError,
  readProviderExactNamePage,
  type ProviderExactNameResult,
} from "./provider-exact-name.js";
import {
  ProviderModelIdExactError,
  readMergedProviderModelIdExactPage,
  type MergedProviderModelIdExactContinuation,
  type ProviderModelIdExactResult,
} from "./provider-model-id-exact.js";
import { validRequiredAvailableUntilMs } from "./retained-hot-publication.js";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const MODEL_ID = new RegExp(`^mdl_${UUID_V4}$`, "u");
const VARIANT_ID = new RegExp(`^var_${UUID_V4}$`, "u");
const PROVIDER_ID = new RegExp(`^prv_${UUID_V4}$`, "u");
const FAMILY_ID = new RegExp(`^fam_${UUID_V4}$`, "u");
const UTF8 = new TextEncoder();

export const MERGED_EXACT_SEARCH_MAX_PAGE_SIZE = 20;
export const MERGED_EXACT_SEARCH_MAX_QUERY_BYTES = 200;

export const EXACT_CANONICAL_MARKER = "exact-v1:c" as const;
export const EXACT_PROVIDER_MODEL_ID_RAW_MARKER = "exact-v1:r" as const;
export const EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER = "exact-v1:n" as const;
export const EXACT_PROVIDER_MARKER = "exact-v1:p" as const;

export type MergedExactSearchTierMarker =
  | typeof EXACT_CANONICAL_MARKER
  | typeof EXACT_PROVIDER_MODEL_ID_RAW_MARKER
  | typeof EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER
  | typeof EXACT_PROVIDER_MARKER;

export type MergedExactSearchContinuation = Readonly<{
  tierMarker: MergedExactSearchTierMarker;
  resourceId: string;
}>;

export type MergedExactSearchInput = Readonly<{
  publicationId: string;
  query: string;
  recordType: "model" | "variant" | "provider" | null;
  eligibilityProviderId: string | null;
  eligibilityStale?: boolean | null;
  familyId?: string | null;
  continuation: MergedExactSearchContinuation | null;
  limit: number;
  requiredAvailableUntilMs?: number | null;
}>;

type DisplayName = ModelVariantExactNameResult["displayName"];

export type MergedExactSearchResult = Readonly<{
  tierMarker: MergedExactSearchTierMarker;
  resourceType: "model" | "variant" | "provider";
  resourceId: string;
  matchKind: "canonical_name" | "provider_model_id" | "provider_name";
  displayName: DisplayName;
}>;

export type MergedExactSearchPage = Readonly<{
  publicationId: string;
  results: readonly MergedExactSearchResult[];
  nextContinuation: MergedExactSearchContinuation | null;
  semanticDegraded: "disabled" | "not_applicable";
}>;

export type ExactModelCardSearchResult = Readonly<{
  tierMarker: MergedExactSearchTierMarker;
  matchKind: "canonical_name" | "provider_model_id";
  modelCard: ModelCardView;
}>;

export type ExactModelCardSearchPage = Readonly<{
  publicationId: string;
  results: readonly ExactModelCardSearchResult[];
  nextContinuation: MergedExactSearchContinuation | null;
  semanticDegraded: "disabled";
}>;

export type ExactVariantCardSearchResult = Readonly<{
  tierMarker: MergedExactSearchTierMarker;
  matchKind: "canonical_name" | "provider_model_id";
  variantCard: VariantCardView;
}>;

export type ExactVariantCardSearchPage = Readonly<{
  publicationId: string;
  results: readonly ExactVariantCardSearchResult[];
  nextContinuation: MergedExactSearchContinuation | null;
  semanticDegraded: "disabled";
}>;

export type MergedExactSearchErrorCode =
  "invalid_input" | "integrity_failure" | "read_failure";

export class MergedExactSearchError extends Error {
  readonly code: MergedExactSearchErrorCode;

  constructor(code: MergedExactSearchErrorCode) {
    super(
      code === "invalid_input"
        ? "The merged exact-search query is invalid."
        : code === "integrity_failure"
          ? "Published exact-search data failed integrity verification."
          : "Published exact-search data could not be read.",
    );
    this.name = "MergedExactSearchError";
    this.code = code;
  }
}

type ValidatedInput = Readonly<{
  publicationId: string;
  query: string;
  normalizedQuery: string;
  recordType: "model" | "variant" | "provider" | null;
  eligibilityProviderId: string | null;
  eligibilityStale: boolean | null;
  familyId: string | null;
  continuation: MergedExactSearchContinuation | null;
  limit: number;
  requiredAvailableUntilMs: number | null;
}>;

const plain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const snapshot = (value: unknown): Record<string, unknown> | null => {
  try {
    if (!plain(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as string];
      if (
        typeof key !== "string" ||
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      )
        return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
};

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index])
  );
};

const snapshotArray = (
  value: unknown,
  maximum: number,
): readonly unknown[] | null => {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    )
      return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    const length: unknown = lengthDescriptor?.value;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximum ||
      Reflect.ownKeys(descriptors).length !== length + 1
    )
      return null;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      )
        return null;
      output.push(descriptor.value);
    }
    return output;
  } catch {
    return null;
  }
};

const validTargetId = (value: unknown): value is string =>
  typeof value === "string" && (MODEL_ID.test(value) || VARIANT_ID.test(value));

const validMarkerId = (
  marker: MergedExactSearchTierMarker,
  value: unknown,
): value is string =>
  marker === EXACT_PROVIDER_MARKER
    ? typeof value === "string" && PROVIDER_ID.test(value)
    : validTargetId(value);

const validateInput = (value: unknown): ValidatedInput => {
  const input = snapshot(value);
  if (input === null) throw new MergedExactSearchError("invalid_input");
  const expectedKeys = [
    "continuation",
    "limit",
    "eligibilityProviderId",
    ...(Object.hasOwn(input, "eligibilityStale") ? ["eligibilityStale"] : []),
    ...(Object.hasOwn(input, "familyId") ? ["familyId"] : []),
    "publicationId",
    "query",
    "recordType",
  ];
  if (Object.hasOwn(input, "requiredAvailableUntilMs"))
    expectedKeys.push("requiredAvailableUntilMs");
  if (
    !exactKeys(input, expectedKeys) ||
    typeof input.publicationId !== "string" ||
    !PUBLICATION_ID.test(input.publicationId) ||
    typeof input.query !== "string" ||
    input.query !== input.query.normalize("NFC").trim() ||
    Array.from(input.query).length === 0 ||
    Array.from(input.query).some((scalar) => {
      const point = scalar.codePointAt(0);
      return point !== undefined && point >= 0xd800 && point <= 0xdfff;
    }) ||
    UTF8.encode(input.query).byteLength > MERGED_EXACT_SEARCH_MAX_QUERY_BYTES ||
    (input.recordType !== null &&
      input.recordType !== "model" &&
      input.recordType !== "variant" &&
      input.recordType !== "provider") ||
    (input.eligibilityProviderId !== null &&
      (typeof input.eligibilityProviderId !== "string" ||
        !PROVIDER_ID.test(input.eligibilityProviderId))) ||
    (input.eligibilityProviderId !== null && input.recordType === "provider") ||
    (Object.hasOwn(input, "eligibilityStale") &&
      input.eligibilityStale !== null &&
      typeof input.eligibilityStale !== "boolean") ||
    (Object.hasOwn(input, "eligibilityStale") &&
      input.eligibilityStale !== null &&
      input.recordType === "provider") ||
    (Object.hasOwn(input, "familyId") &&
      input.familyId !== null &&
      (typeof input.familyId !== "string" ||
        !FAMILY_ID.test(input.familyId))) ||
    (Object.hasOwn(input, "familyId") &&
      input.familyId !== null &&
      input.recordType === "provider") ||
    typeof input.limit !== "number" ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MERGED_EXACT_SEARCH_MAX_PAGE_SIZE
  )
    throw new MergedExactSearchError("invalid_input");
  const requiredAvailableUntilMs = Object.hasOwn(
    input,
    "requiredAvailableUntilMs",
  )
    ? input.requiredAvailableUntilMs
    : null;
  if (!validRequiredAvailableUntilMs(requiredAvailableUntilMs))
    throw new MergedExactSearchError("invalid_input");
  let normalizedQuery = "";
  try {
    normalizedQuery = normalizeExactSearchName(input.query);
  } catch (error) {
    if (!(error instanceof RangeError))
      throw new MergedExactSearchError("invalid_input");
  }

  let continuation: MergedExactSearchContinuation | null = null;
  if (input.continuation !== null) {
    const candidate = snapshot(input.continuation);
    if (
      candidate === null ||
      !exactKeys(candidate, ["resourceId", "tierMarker"]) ||
      (candidate.tierMarker !== EXACT_CANONICAL_MARKER &&
        candidate.tierMarker !== EXACT_PROVIDER_MODEL_ID_RAW_MARKER &&
        candidate.tierMarker !== EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER &&
        candidate.tierMarker !== EXACT_PROVIDER_MARKER) ||
      !validMarkerId(candidate.tierMarker, candidate.resourceId)
    )
      throw new MergedExactSearchError("invalid_input");
    continuation = Object.freeze({
      tierMarker: candidate.tierMarker,
      resourceId: candidate.resourceId,
    });
  }
  if (
    (input.recordType === "provider" &&
      continuation !== null &&
      continuation.tierMarker !== EXACT_PROVIDER_MARKER) ||
    (input.eligibilityProviderId !== null &&
      continuation?.tierMarker === EXACT_PROVIDER_MARKER) ||
    (Object.hasOwn(input, "familyId") &&
      input.familyId !== null &&
      continuation?.tierMarker === EXACT_PROVIDER_MARKER) ||
    (Object.hasOwn(input, "eligibilityStale") &&
      input.eligibilityStale !== null &&
      continuation?.tierMarker === EXACT_PROVIDER_MARKER) ||
    ((input.recordType === "model" || input.recordType === "variant") &&
      continuation?.tierMarker === EXACT_PROVIDER_MARKER) ||
    ((input.recordType === "model" || input.recordType === "variant") &&
      continuation !== null &&
      !new RegExp(
        `^${input.recordType === "model" ? `mdl_${UUID_V4}` : `var_${UUID_V4}`}$`,
        "u",
      ).test(continuation.resourceId))
  )
    throw new MergedExactSearchError("invalid_input");
  if (
    (continuation?.tierMarker === EXACT_CANONICAL_MARKER &&
      normalizedQuery.length === 0) ||
    (continuation?.tierMarker === EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER &&
      normalizedQuery.length === 0) ||
    (continuation?.tierMarker === EXACT_PROVIDER_MARKER &&
      (normalizedQuery.length === 0 || input.query.includes("\u0000")))
  )
    throw new MergedExactSearchError("invalid_input");
  return {
    publicationId: input.publicationId,
    query: input.query,
    normalizedQuery,
    recordType: input.recordType,
    eligibilityProviderId: input.eligibilityProviderId,
    eligibilityStale: Object.hasOwn(input, "eligibilityStale")
      ? (input.eligibilityStale as boolean | null)
      : null,
    familyId: Object.hasOwn(input, "familyId")
      ? (input.familyId as string | null)
      : null,
    continuation,
    limit: input.limit,
    requiredAvailableUntilMs,
  };
};

const cloneDisplayName = (value: unknown): DisplayName => {
  const display = snapshot(value);
  if (
    display === null ||
    !exactKeys(display, ["evidence_ids", "observed_at", "state", "value"]) ||
    display.state !== "known" ||
    typeof display.value !== "string" ||
    typeof display.observed_at !== "string" ||
    !Array.isArray(display.evidence_ids) ||
    Object.getPrototypeOf(display.evidence_ids) !== Array.prototype
  )
    throw new MergedExactSearchError("integrity_failure");
  const evidenceIds: string[] = [];
  for (const evidenceId of display.evidence_ids as readonly unknown[]) {
    if (typeof evidenceId !== "string")
      throw new MergedExactSearchError("integrity_failure");
    evidenceIds.push(evidenceId);
  }
  return Object.freeze({
    state: "known",
    value: display.value,
    observed_at: display.observed_at,
    evidence_ids: Object.freeze(evidenceIds),
  });
};

const appendResult = (
  output: MergedExactSearchResult[],
  value:
    | ModelVariantExactNameResult
    | ProviderModelIdExactResult
    | ProviderExactNameResult,
  marker: MergedExactSearchTierMarker,
): void => {
  const result = snapshot(value);
  const expectedKeys =
    marker === EXACT_PROVIDER_MARKER
      ? [
          "displayName",
          "matchKind",
          "normalizedOrderingKey",
          "resourceId",
          "resourceType",
          "semanticDegraded",
          "tier",
        ]
      : [
          "displayName",
          "matchKind",
          "resourceId",
          "resourceType",
          "semanticDegraded",
          "tier",
        ];
  if (
    result === null ||
    !exactKeys(result, expectedKeys) ||
    typeof result.resourceId !== "string" ||
    !validMarkerId(marker, result.resourceId) ||
    (result.resourceType !== "model" &&
      result.resourceType !== "variant" &&
      result.resourceType !== "provider") ||
    (result.resourceType === "provider") !==
      (marker === EXACT_PROVIDER_MARKER) ||
    result.semanticDegraded !== "disabled" ||
    (marker === EXACT_CANONICAL_MARKER &&
      (result.tier !== 1 || result.matchKind !== "canonical_name")) ||
    ((marker === EXACT_PROVIDER_MODEL_ID_RAW_MARKER ||
      marker === EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER) &&
      (result.tier !== 2 || result.matchKind !== "provider_model_id")) ||
    (marker === EXACT_PROVIDER_MARKER &&
      (result.tier !== 3 ||
        result.matchKind !== "provider_name" ||
        typeof result.normalizedOrderingKey !== "string"))
  )
    throw new MergedExactSearchError("integrity_failure");
  const merged = Object.freeze({
    tierMarker: marker,
    resourceType: result.resourceType,
    resourceId: result.resourceId,
    matchKind: result.matchKind,
    displayName: cloneDisplayName(result.displayName),
  }) as MergedExactSearchResult;
  const card = attachedModelCardView(value);
  if (card !== null && merged.resourceType === "model")
    attachExistingModelCardView(merged, card);
  const variantCard = attachedVariantCardView(value);
  if (variantCard !== null && merged.resourceType === "variant")
    attachExistingVariantCardView(merged, variantCard);
  output.push(merged);
};

const pageRecord = (
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> => {
  const page = snapshot(value);
  if (page === null || !exactKeys(page, keys))
    throw new MergedExactSearchError("integrity_failure");
  return page;
};

const mapReaderError = (error: unknown): never => {
  if (
    error instanceof ModelVariantExactNameError ||
    error instanceof ProviderModelIdExactError ||
    error instanceof ProviderExactNameError
  )
    throw new MergedExactSearchError(
      error.code === "read_failure" ? "read_failure" : "integrity_failure",
    );
  if (error instanceof MergedExactSearchError) throw error;
  throw new MergedExactSearchError("read_failure");
};

export const readMergedExactSearchPage = async (
  database: Pick<D1DatabaseSession, "prepare">,
  inputValue: unknown,
): Promise<MergedExactSearchPage> => {
  const input = validateInput(inputValue);
  const output: MergedExactSearchResult[] = [];
  let more = false;
  const startingMarker = input.continuation?.tierMarker ?? null;
  const targetRecordType =
    input.recordType === "model" || input.recordType === "variant"
      ? input.recordType
      : null;
  const capacity = (): number =>
    Math.min(
      MERGED_EXACT_SEARCH_MAX_PAGE_SIZE,
      input.limit + 1 - output.length,
    );

  try {
    if (
      input.recordType !== "provider" &&
      input.normalizedQuery.length > 0 &&
      (startingMarker === null || startingMarker === EXACT_CANONICAL_MARKER)
    ) {
      const page = pageRecord(
        await readModelVariantExactNamePage(database, {
          publicationId: input.publicationId,
          query: input.query,
          recordType: targetRecordType,
          eligibilityProviderId: input.eligibilityProviderId,
          ...(input.eligibilityStale === null
            ? {}
            : { eligibilityStale: input.eligibilityStale }),
          familyId: input.familyId,
          afterResourceId: input.continuation?.resourceId ?? null,
          limit: capacity(),
          requiredAvailableUntilMs: input.requiredAvailableUntilMs,
        }),
        ["nextAfterResourceId", "publicationId", "results"],
      );
      const results = snapshotArray(page.results, capacity());
      if (
        page.publicationId !== input.publicationId ||
        results === null ||
        (page.nextAfterResourceId !== null &&
          !validTargetId(page.nextAfterResourceId))
      )
        throw new MergedExactSearchError("integrity_failure");
      for (const result of results)
        appendResult(
          output,
          result as ModelVariantExactNameResult,
          EXACT_CANONICAL_MARKER,
        );
      if (page.nextAfterResourceId !== null) {
        if (
          results.at(-1) === undefined ||
          page.nextAfterResourceId !== output.at(-1)?.resourceId
        )
          throw new MergedExactSearchError("integrity_failure");
        more = true;
      }
    }

    if (
      !more &&
      output.length <= input.limit &&
      input.recordType !== "provider" &&
      (startingMarker === null ||
        startingMarker === EXACT_CANONICAL_MARKER ||
        startingMarker === EXACT_PROVIDER_MODEL_ID_RAW_MARKER ||
        startingMarker === EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER)
    ) {
      let continuation: MergedProviderModelIdExactContinuation | null = null;
      if (
        startingMarker === EXACT_PROVIDER_MODEL_ID_RAW_MARKER ||
        startingMarker === EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER
      ) {
        const compact = input.continuation;
        if (compact === null)
          throw new MergedExactSearchError("integrity_failure");
        continuation = Object.freeze({
          matchMode:
            compact.tierMarker === EXACT_PROVIDER_MODEL_ID_RAW_MARKER
              ? "raw"
              : "normalized",
          resourceId: compact.resourceId,
        });
      }
      const page = pageRecord(
        await readMergedProviderModelIdExactPage(database, {
          publicationId: input.publicationId,
          query: input.query,
          providerId: null,
          eligibilityProviderId: input.eligibilityProviderId,
          ...(input.eligibilityStale === null
            ? {}
            : { eligibilityStale: input.eligibilityStale }),
          familyId: input.familyId,
          recordType: targetRecordType,
          continuation,
          limit: capacity(),
          requiredAvailableUntilMs: input.requiredAvailableUntilMs,
        }),
        ["matchModes", "nextContinuation", "publicationId", "results"],
      );
      const results = snapshotArray(page.results, capacity());
      const matchModes = snapshotArray(page.matchModes, capacity());
      if (
        page.publicationId !== input.publicationId ||
        results === null ||
        matchModes === null
      )
        throw new MergedExactSearchError("integrity_failure");
      if (results.length !== matchModes.length)
        throw new MergedExactSearchError("integrity_failure");
      results.forEach((result, index) => {
        const mode = matchModes[index];
        if (mode !== "raw" && mode !== "normalized")
          throw new MergedExactSearchError("integrity_failure");
        appendResult(
          output,
          result as ProviderModelIdExactResult,
          mode === "raw"
            ? EXACT_PROVIDER_MODEL_ID_RAW_MARKER
            : EXACT_PROVIDER_MODEL_ID_NORMALIZED_MARKER,
        );
      });
      if (page.nextContinuation !== null) {
        const next = snapshot(page.nextContinuation);
        if (
          next === null ||
          !exactKeys(next, ["matchMode", "resourceId"]) ||
          (next.matchMode !== "raw" && next.matchMode !== "normalized") ||
          !validTargetId(next.resourceId) ||
          next.resourceId !== output.at(-1)?.resourceId ||
          next.matchMode !== matchModes.at(-1)
        )
          throw new MergedExactSearchError("integrity_failure");
        more = true;
      }
    }

    if (
      !more &&
      output.length <= input.limit &&
      input.normalizedQuery.length > 0 &&
      !input.query.includes("\u0000") &&
      input.eligibilityProviderId === null &&
      input.eligibilityStale === null &&
      input.familyId === null &&
      (input.recordType === null || input.recordType === "provider")
    ) {
      const page = pageRecord(
        await readProviderExactNamePage(database, {
          publicationId: input.publicationId,
          query: input.query,
          afterProviderId:
            startingMarker === EXACT_PROVIDER_MARKER
              ? (input.continuation?.resourceId ?? null)
              : null,
          limit: capacity(),
          requiredAvailableUntilMs: input.requiredAvailableUntilMs,
        }),
        ["nextAfterProviderId", "publicationId", "results"],
      );
      const results = snapshotArray(page.results, capacity());
      if (
        page.publicationId !== input.publicationId ||
        results === null ||
        (page.nextAfterProviderId !== null &&
          (typeof page.nextAfterProviderId !== "string" ||
            !PROVIDER_ID.test(page.nextAfterProviderId)))
      )
        throw new MergedExactSearchError("integrity_failure");
      for (const result of results)
        appendResult(
          output,
          result as ProviderExactNameResult,
          EXACT_PROVIDER_MARKER,
        );
      if (page.nextAfterProviderId !== null) {
        if (page.nextAfterProviderId !== output.at(-1)?.resourceId)
          throw new MergedExactSearchError("integrity_failure");
        more = true;
      }
    }
  } catch (error) {
    return mapReaderError(error);
  }

  if (output.length > input.limit) more = true;
  const results = Object.freeze(output.slice(0, input.limit));
  const last = results.at(-1);
  return Object.freeze({
    publicationId: input.publicationId,
    results,
    nextContinuation:
      more && last !== undefined
        ? Object.freeze({
            tierMarker: last.tierMarker,
            resourceId: last.resourceId,
          })
        : null,
    semanticDegraded:
      input.recordType === "provider" && input.eligibilityStale === null
        ? "not_applicable"
        : "disabled",
  });
};

/**
 * Dedicated Model-only composition over the generic exact ordering seam. Card
 * bytes come from canonical resources already hydrated by each tier; this
 * function performs no additional storage read.
 */
export const readExactModelCardSearchPage = async (
  database: Pick<D1DatabaseSession, "prepare">,
  inputValue: unknown,
): Promise<ExactModelCardSearchPage> => {
  const detached = snapshot(inputValue);
  if (detached?.recordType !== "model")
    throw new MergedExactSearchError("invalid_input");
  const page = await readMergedExactSearchPage(database, detached);
  const results: ExactModelCardSearchResult[] = [];
  for (const result of page.results) {
    const modelCard = attachedModelCardView(result);
    if (
      result.resourceType !== "model" ||
      result.resourceId !== modelCard?.model_id ||
      (result.matchKind !== "canonical_name" &&
        result.matchKind !== "provider_model_id")
    )
      throw new MergedExactSearchError("integrity_failure");
    results.push(
      Object.freeze({
        tierMarker: result.tierMarker,
        matchKind: result.matchKind,
        modelCard,
      }),
    );
  }
  return Object.freeze({
    publicationId: page.publicationId,
    results: Object.freeze(results),
    nextContinuation: page.nextContinuation,
    semanticDegraded: "disabled",
  });
};

/**
 * Dedicated Variant-only composition over the generic exact ordering seam.
 * Card bytes come from canonical Variants already hydrated by each tier; this
 * function performs no additional storage read.
 */
export const readExactVariantCardSearchPage = async (
  database: Pick<D1DatabaseSession, "prepare">,
  inputValue: unknown,
): Promise<ExactVariantCardSearchPage> => {
  const detached = snapshot(inputValue);
  if (detached?.recordType !== "variant")
    throw new MergedExactSearchError("invalid_input");
  const page = await readMergedExactSearchPage(database, detached);
  const results: ExactVariantCardSearchResult[] = [];
  for (const result of page.results) {
    const variantCard = attachedVariantCardView(result);
    if (
      result.resourceType !== "variant" ||
      result.resourceId !== variantCard?.variant_id ||
      (result.matchKind !== "canonical_name" &&
        result.matchKind !== "provider_model_id")
    )
      throw new MergedExactSearchError("integrity_failure");
    results.push(
      Object.freeze({
        tierMarker: result.tierMarker,
        matchKind: result.matchKind,
        variantCard,
      }),
    );
  }
  return Object.freeze({
    publicationId: page.publicationId,
    results: Object.freeze(results),
    nextContinuation: page.nextContinuation,
    semanticDegraded: "disabled",
  });
};
