import {
  modelDetailFrontendPath,
  parseModelDetailFrontendPath,
  type FrontendApiEnvironment,
  type ModelDetailIdentifier,
} from "@quant-clarity/api-core";
import type { DatasetMetadata, ModelDetail } from "@quant-clarity/contracts";

import type { PublicationState } from "./dataset-metadata.js";
import type { ModelDetailState } from "./model-detail.js";

export type ModelDetailPageReadPlan =
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{
      identifier: ModelDetailIdentifier;
      kind: "read";
      metadata: DatasetMetadata;
    }>;

export type ModelDetailPageState =
  | Readonly<{
      canonicalPath: `/models/${string}`;
      detail: ModelDetail;
      kind: "found";
    }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{
      kind: "redirect";
      location: `/models/${string}`;
    }>
  | Readonly<{ kind: "unavailable" }>;

export type ModelDetailPageMetadata = Readonly<{
  description: string;
  title: string;
}>;

/**
 * Builds unique success metadata from validated canonical Model facts. The
 * stable ID disambiguates duplicate display names and remains authoritative
 * when a display name is unavailable.
 */
export const modelDetailPageMetadata = (
  modelId: string,
  displayName: string | null,
): ModelDetailPageMetadata => {
  const label =
    displayName !== null && displayName.trim().length > 0
      ? displayName
      : "Canonical model";
  const identity = `${label} (${modelId})`;
  return {
    description: `Publisher and source facts for ${label} include evidence and observation times. QuantClarity canonical Model ID: ${modelId}.`,
    title: `${identity} Model Facts — QuantClarity`,
  };
};

/**
 * Plans the local-only Model read from the post-platform pathname. It accepts
 * no query, host, header, source address, or other visitor context.
 */
export const planModelDetailPageRead = (
  pathname: unknown,
  environment: FrontendApiEnvironment,
  publicationState: PublicationState,
): ModelDetailPageReadPlan => {
  const identifier = parseModelDetailFrontendPath(pathname);
  if (identifier === null) return { kind: "not_found" };
  if (environment !== "local" && environment !== "test")
    return { kind: "not_found" };
  if (publicationState.kind === "not_published") return { kind: "not_found" };
  if (publicationState.kind === "unavailable") return { kind: "unavailable" };
  return {
    identifier,
    kind: "read",
    metadata: publicationState.metadata,
  };
};

/**
 * Converts one closed client result into a page state. Slugs are admitted only
 * when the canonical slug Fact is known; a different known slug is historical
 * and redirects to the stable-ID frontend identity.
 */
export const resolveModelDetailPageState = (
  identifier: ModelDetailIdentifier,
  result: ModelDetailState,
): ModelDetailPageState => {
  if (result.kind !== "found") return result;
  const canonicalPath = modelDetailFrontendPath(result.detail.data.model_id);
  if (canonicalPath === null) return { kind: "unavailable" };
  if (identifier.kind === "stable_id")
    return result.detail.data.model_id === identifier.value
      ? { canonicalPath, detail: result.detail, kind: "found" }
      : { kind: "unavailable" };

  const canonicalSlug = result.detail.data.slug;
  if (canonicalSlug.state !== "known") return { kind: "unavailable" };
  return canonicalSlug.value === identifier.value
    ? { canonicalPath, detail: result.detail, kind: "found" }
    : { kind: "redirect", location: canonicalPath };
};
