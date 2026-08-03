import {
  checkEvidenceSummaryContract,
  checkProviderContract,
} from "@quant-clarity/contracts";
import {
  buildImmutableManifestFromPersistedContent,
  canonicalizePublicationJson,
  hashPublicationResourceChunk,
  hashPublicationResourceContent,
  type PersistedResourceDescriptor,
  type ServingClosureRows,
  type TrustedImmutablePublicationManifest,
} from "@quant-clarity/publication-core";

import { createReadyPublicationFixture } from "./serving-switch-fixture.js";

const EVIDENCE_RESOURCE_COUNT = 24_997;
const EVIDENCE_PADDING_CHARACTERS = 28;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

export type AcceptedBoundPublicationRecoveryFixture = Readonly<{
  manifest: TrustedImmutablePublicationManifest;
  rows: ServingClosureRows;
}>;

const evidenceId = (ordinal: number): string =>
  `evd_00000000-0000-4000-8000-${ordinal.toString(16).padStart(12, "0")}`;

const PROVIDER_EVIDENCE_ID =
  "evd_cccccccc-cccc-4ccc-8ccc-cccccccccccc" as const;

/**
 * Produces exactly 50,000 B1 source rows while keeping all bytes inside the
 * canonical publication and serving-closure contracts. Evidence summaries are
 * not provider-attributable and their inert canonical JSON is padded so the
 * resulting archive also exercises the 24 MiB admission dimension.
 */
export const createAcceptedBoundPublicationRecoveryFixture = async (
  publicationId: `pub_${string}`,
  generatedAtMs: number,
): Promise<AcceptedBoundPublicationRecoveryFixture> => {
  const base = await createReadyPublicationFixture(
    publicationId,
    generatedAtMs,
  );
  const providerResource = base.rows.resources.find(
    (resource) => resource.resource_type === "provider",
  );
  if (providerResource === undefined)
    throw new Error("accepted-bound fixture provider resource is missing");
  const provider = JSON.parse(providerResource.resource_json) as unknown;
  if (!checkProviderContract(provider))
    throw new Error("accepted-bound fixture provider is not contract-valid");
  const retainedProvider = {
    ...provider,
    active_offering_count: {
      ...provider.active_offering_count,
      value: 0,
    },
    precision_coverage: {
      ...provider.precision_coverage,
      known_count: 0,
      unknown_count: 0,
      known_proportion_decimal: "0",
    },
  };
  if (!checkProviderContract(retainedProvider))
    throw new Error(
      "accepted-bound fixture retained Provider is not contract-valid",
    );
  const retainedProviderJson = canonicalizePublicationJson(
    JSON.stringify(retainedProvider),
    "object",
  );
  const retainedProviderInput = {
    resourceType: "provider" as const,
    resourceId: providerResource.resource_id,
    resourceJson: retainedProviderJson,
  };

  const resourceInputs: PersistedResourceDescriptor[] = [
    {
      ...retainedProviderInput,
      contentHash: await hashPublicationResourceContent(retainedProviderInput),
    },
  ];
  const padding = "x".repeat(EVIDENCE_PADDING_CHARACTERS);
  const providerId = providerResource.resource_id;
  for (let ordinal = 1; ordinal <= EVIDENCE_RESOURCE_COUNT; ordinal += 1) {
    const resourceId =
      ordinal === 1 ? PROVIDER_EVIDENCE_ID : evidenceId(ordinal - 1);
    const evidenceSummary = {
      authenticated_only: false,
      evidence_id: resourceId,
      extraction_method: "x",
      extraction_version: "x",
      field: "x",
      integrity_hash: HASH_C,
      observed_at: new Date(generatedAtMs).toISOString(),
      source_locator: "x",
      source_owner: "x",
      source_type: "x",
      source_url: null,
      subject_resource_id: providerId,
      value: padding,
    };
    if (!checkEvidenceSummaryContract(evidenceSummary))
      throw new Error(
        "accepted-bound fixture evidence summary is not contract-valid",
      );
    const resourceJson = canonicalizePublicationJson(
      JSON.stringify(evidenceSummary),
      "object",
    );
    const resource = {
      resourceType: "evidence_summary" as const,
      resourceId,
      resourceJson,
    };
    resourceInputs.push({
      ...resource,
      contentHash: await hashPublicationResourceContent(resource),
    });
  }
  const offeringCount = resourceInputs.filter(
    (resource) => resource.resourceType === "offering",
  ).length;
  if (
    offeringCount !== 0 ||
    retainedProvider.active_offering_count.value !== offeringCount ||
    retainedProvider.precision_coverage.known_count +
      retainedProvider.precision_coverage.unknown_count !==
      offeringCount ||
    retainedProvider.precision_coverage.known_proportion_decimal !== "0"
  )
    throw new Error(
      "accepted-bound fixture Provider aggregates do not match Offerings",
    );
  const evidenceResourceIds = new Set(
    resourceInputs
      .filter((resource) => resource.resourceType === "evidence_summary")
      .map((resource) => resource.resourceId),
  );
  const providerEvidenceIds = [
    retainedProvider.slug,
    retainedProvider.display_name,
    retainedProvider.official_site,
    retainedProvider.status,
    retainedProvider.last_successful_refresh,
  ].flatMap((fact) => fact.evidence_ids);
  if (
    providerEvidenceIds.length === 0 ||
    providerEvidenceIds.some(
      (evidenceResourceId) => !evidenceResourceIds.has(evidenceResourceId),
    )
  )
    throw new Error(
      "accepted-bound fixture Provider evidence reference is missing",
    );
  resourceInputs.sort((left, right) => {
    const leftKey = `${left.resourceType}:${left.resourceId}`;
    const rightKey = `${right.resourceType}:${right.resourceId}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  const chunks = [];
  for (const [ordinal, resource] of resourceInputs.entries()) {
    const key = `${resource.resourceType}:${resource.resourceId}`;
    chunks.push({
      kind: "resources" as const,
      ordinal,
      firstKey: key,
      lastKey: key,
      itemCount: 1,
      contentHash: await hashPublicationResourceChunk([resource]),
    });
  }

  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: "1.0.0",
    publicationId,
    sourceRunId: base.manifest.sourceRunId,
    parentPublicationId: null,
    generatedAt: new Date(generatedAtMs).toISOString(),
    versions: base.manifest.versions,
    enabledProviderScopeVersion: base.manifest.enabledProviderScopeVersion,
    enabledProviderIds: base.manifest.enabledProviderIds,
    providerSlices: base.manifest.providerSlices,
    providerAttributions: base.manifest.providerAttributions,
    resources: resourceInputs,
    searchDocuments: [],
    vectors: [],
    chunks,
    bundleHash: HASH_C,
  });
  const providerSlice = base.rows.providerSlices[0];
  if (providerSlice === undefined)
    throw new Error("accepted-bound fixture provider slice is missing");
  const rows: ServingClosureRows = Object.freeze({
    publication: Object.freeze({
      publication_id: publicationId,
      source_run_id: manifest.sourceRunId,
      parent_publication_id: null,
      generated_at_ms: generatedAtMs,
      schema_version: manifest.versions.schema,
      methodology_version: manifest.versions.methodology,
      precision_normalization_version: manifest.versions.precisionNormalization,
      precision_display_order_version: manifest.versions.precisionDisplayOrder,
      price_policy_version: manifest.versions.pricePolicy,
      source_policy_version: manifest.versions.sourcePolicy,
      embedding_version: manifest.versions.embedding,
      build_commit: manifest.versions.buildCommit,
      closure_hash: manifest.closureHash,
    }),
    providerSlices: Object.freeze([Object.freeze({ ...providerSlice })]),
    providerAttributions: Object.freeze(
      base.rows.providerAttributions.map((row) => Object.freeze({ ...row })),
    ),
    resources: Object.freeze(
      resourceInputs.map((resource) =>
        Object.freeze({
          resource_type: resource.resourceType,
          resource_id: resource.resourceId,
          resource_json: resource.resourceJson,
          content_hash: resource.contentHash,
        }),
      ),
    ),
    searchDocuments: Object.freeze([]),
    vectors: Object.freeze([]),
    chunks: Object.freeze(
      chunks.map((chunk) =>
        Object.freeze({
          kind: chunk.kind,
          ordinal: chunk.ordinal,
          first_key: chunk.firstKey,
          last_key: chunk.lastKey,
          item_count: chunk.itemCount,
          content_hash: chunk.contentHash,
        }),
      ),
    ),
    manifestContractVersion: "1.0.0",
    enabledProviderScopeVersion: manifest.enabledProviderScopeVersion,
    bundleHash: manifest.bundleHash,
    stagingRevision: 0,
    sealedAtMs: generatedAtMs,
  });
  return Object.freeze({ manifest, rows });
};
