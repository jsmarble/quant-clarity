import {
  canonicalExactVariantSearchQuery,
  parseCanonicalExactVariantSearchQuery,
  type CanonicalExactVariantSearchQuery,
  type FrontendApiEnvironment,
} from "@quant-clarity/api-core";
import {
  parsePublicationPin,
  type PublicationId,
} from "@quant-clarity/domain/publication-consistency";

import type { PublicationState } from "./dataset-metadata.js";

export type ExactVariantSearchPagePlan =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{
      kind: "closed";
      search: CanonicalExactVariantSearchQuery;
    }>
  | Readonly<{
      kind: "not_published";
      search: CanonicalExactVariantSearchQuery;
    }>
  | Readonly<{
      kind: "unavailable";
      search: CanonicalExactVariantSearchQuery;
    }>
  | Readonly<{
      apiQuery: string;
      expectedPublicationId: string;
      kind: "read";
      search: CanonicalExactVariantSearchQuery;
    }>;

const publicSearchInput = (
  rawSearch: unknown,
): Readonly<{
  apiQuery: string;
  publicationId: PublicationId | null;
  search: CanonicalExactVariantSearchQuery;
}> | null => {
  try {
    if (
      typeof rawSearch !== "string" ||
      !rawSearch.startsWith("?") ||
      rawSearch.length < 3
    )
      return null;
    const parameters = new URLSearchParams(rawSearch.slice(1));
    const keys = [...parameters.keys()];
    const hasCursor = parameters.has("cursor");
    const expected = hasCursor ? ["q", "cursor", "publication"] : ["q"];
    if (
      keys.length !== expected.length ||
      keys.some((key, index) => key !== expected[index])
    )
      return null;
    const query = parameters.get("q");
    const cursor = parameters.get("cursor");
    const publication = parameters.get("publication");
    if (query === null) return null;
    if ((cursor === null) !== (publication === null)) return null;
    const publicationId = parsePublicationPin(publication);
    const apiQuery = canonicalExactVariantSearchQuery(query, cursor);
    if (apiQuery === null) return null;
    const search = parseCanonicalExactVariantSearchQuery(apiQuery);
    return search === null ? null : { apiQuery, publicationId, search };
  } catch {
    return null;
  }
};

/**
 * Plans one local-only exact explicit-Variant search from the public URL. Only
 * q and an optional opaque cursor plus its publication pin are visitor
 * controlled; the Variant record type and result limit are rebuilt from the
 * shared closed contract.
 */
export const planExactVariantSearchPage = (
  rawSearch: unknown,
  environment: FrontendApiEnvironment,
  publicationState: PublicationState,
): ExactVariantSearchPagePlan => {
  if (rawSearch === "") return { kind: "idle" };
  try {
    if (typeof rawSearch === "string" && rawSearch.startsWith("?")) {
      const parameters = new URLSearchParams(rawSearch.slice(1));
      const keys = [...parameters.keys()];
      if (
        keys.length === 1 &&
        keys[0] === "q" &&
        parameters.get("q")?.trim() === ""
      )
        return { kind: "idle" };
    }
  } catch {
    return { kind: "invalid" };
  }
  const input = publicSearchInput(rawSearch);
  if (input === null) return { kind: "invalid" };
  if (environment !== "local") return { kind: "closed", search: input.search };
  if (input.search.cursor !== null && input.publicationId !== null)
    return {
      apiQuery: input.apiQuery,
      expectedPublicationId: input.publicationId,
      kind: "read",
      search: input.search,
    };
  if (publicationState.kind === "not_published")
    return { kind: "not_published", search: input.search };
  if (publicationState.kind === "unavailable")
    return { kind: "unavailable", search: input.search };
  return {
    apiQuery: input.apiQuery,
    expectedPublicationId: publicationState.metadata.publication_id,
    kind: "read",
    search: input.search,
  };
};

/** Builds public URL state without exposing the fixed Variant API parameters. */
export const exactVariantSearchPageHref = (
  query: unknown,
  cursor: unknown = null,
  publicationId: unknown = null,
): `/variants?${string}` | null => {
  const apiQuery = canonicalExactVariantSearchQuery(query, cursor);
  if (apiQuery === null) return null;
  const parsed = parseCanonicalExactVariantSearchQuery(apiQuery);
  if (parsed === null) return null;
  if ((parsed.cursor === null) !== (publicationId === null)) return null;
  let publication: PublicationId | null;
  try {
    publication = parsePublicationPin(
      typeof publicationId === "string" ? publicationId : null,
    );
  } catch {
    return null;
  }
  if (parsed.cursor !== null && publication === null) return null;
  const parameters = new URLSearchParams();
  parameters.append("q", parsed.query);
  if (parsed.cursor !== null) parameters.append("cursor", parsed.cursor);
  if (publication !== null) parameters.append("publication", publication);
  return `/variants?${parameters.toString()}`;
};

export const exactVariantMatchLabel = (
  matchKind: "canonical_name" | "provider_model_id",
): "Exact explicit Variant name" | "Exact provider model ID" =>
  matchKind === "canonical_name"
    ? "Exact explicit Variant name"
    : "Exact provider model ID";
