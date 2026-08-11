import { WorkerEntrypoint } from "cloudflare:workers";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const NEXT_PUBLICATION = "pub_88888888-8888-4888-8888-888888888888";
const MODEL = "mdl_22222222-2222-4222-8222-222222222222";
const FAMILY = "fam_33333333-3333-4333-8333-333333333333";
const EVIDENCE = "evd_44444444-4444-4444-8444-444444444444";
const CHECKPOINT = "chk_55555555-5555-4555-8555-555555555555";
const ORGANIZATION = "org_66666666-6666-4666-8666-666666666666";
const CURRENT_SLUG = "fixture-model";
const HISTORICAL_SLUG = "fixture-model-old";
const UNAVAILABLE_SLUG = "fixture-model-unavailable";
const OBSERVED_AT = "2026-08-01T00:20:00.000Z";
const SEARCH_EVIDENCE = "evd_77777777-7777-4777-8777-777777777777";
const SEARCH_QUERY = "Fixture <script> & Model";
const SEARCH_PROVIDER_MODEL_ID_QUERY = "fixture/provider-model-id";
const SEARCH_EMPTY_QUERY = "No exact fixture match";
const SEARCH_PAGED_QUERY = "Paged fixture models";
const SEARCH_FAILURE_QUERY = "Unavailable fixture search";
let currentPublication = PUBLICATION;
let retainedPublicationExpired = false;

const pagedModelId = (index) => {
  if (index === 0) return MODEL;
  return `mdl_${(0x22222222 + index).toString(16)}-2222-4222-8222-${(
    0x222222222222 + index
  )
    .toString(16)
    .padStart(12, "0")}`;
};

const SEARCH_MODELS = Array.from({ length: 21 }, (_, index) => ({
  displayName:
    index === 0
      ? "Fixture <script> & Model"
      : `Paged Fixture Model ${String(index + 1).padStart(2, "0")}`,
  resourceId: pagedModelId(index),
}));

const searchResult = ({
  displayName,
  matchKind = "canonical_name",
  resourceId,
  tierMarker = "exact-v1:c",
}) => ({
  tierMarker,
  resourceType: "model",
  resourceId,
  matchKind,
  displayName: {
    state: "known",
    value: displayName,
    observed_at: OBSERVED_AT,
    evidence_ids: [SEARCH_EVIDENCE],
  },
});

const known = (value) => ({
  state: "known",
  value,
  observed_at: OBSERVED_AT,
  evidence_ids: [EVIDENCE],
});
const absent = (state) => ({
  state,
  value: null,
  observed_at: null,
  evidence_ids: [],
});

const MODEL_RECORD = {
  model_id: MODEL,
  family_id: FAMILY,
  slug: known(CURRENT_SLUG),
  display_name: known("Fixture <script> & Model"),
  publisher: known("Fixture Publisher"),
  release_date: known("2026-07-31"),
  modalities: known(["text", "image"]),
  context_window_tokens: known("131072"),
  maximum_output_tokens: known("8192"),
  license: known("Fixture Public License"),
  architecture: absent("unavailable"),
  total_parameters: known({
    raw_value: "~70B",
    normalized_decimal: "70000000000",
    approximation: "approximate",
  }),
  active_parameters: absent("unknown"),
  authoritative_checkpoint_ids: [CHECKPOINT],
  checkpoints: [
    {
      checkpoint_id: CHECKPOINT,
      publisher_organization_id: ORGANIZATION,
      checkpoint_kind: known("base"),
      repository_locator: known("publisher/example<checkpoint>"),
      repository_id: known("example-checkpoint"),
      revision: known("abc123"),
      published_at: known("2026-07-31T00:00:00.000Z"),
      declared_weight_format: known("BF16"),
      quantization: absent("not_applicable"),
      file_format: known("safetensors"),
      role: known("authoritative_source"),
      lineage_edges: [],
    },
  ],
  source_weight_format: known("BF16"),
  source_quantization: absent("not_applicable"),
  status: known("active"),
  cataloged_provider_count: {
    value: 2,
    observed_at: OBSERVED_AT,
    derivation_version: "cataloged-provider-count@1",
  },
  last_model_data_refresh: known("2026-08-01T00:20:00.000Z"),
};

const publicationState = (env) => {
  const value = env.MOCK_PUBLICATION_STATE;
  return value === "published_zero" ||
    value === "not_published" ||
    value === "unavailable"
    ? value
    : "published";
};

export class CatalogQueryService extends WorkerEntrypoint {
  async resolvePublicationV2(input) {
    const state = publicationState(this.env);
    if (state === "not_published") return { outcome: "publication_not_ready" };
    if (state === "unavailable") return { outcome: "read_failure" };
    const requested = input?.requestedPublicationId;
    if (requested === PUBLICATION && retainedPublicationExpired)
      return {
        outcome: "publication_expired",
        currentPublicationId: currentPublication,
      };
    const selected = requested ?? currentPublication;
    if (selected !== PUBLICATION && selected !== NEXT_PUBLICATION)
      return {
        outcome: "publication_expired",
        currentPublicationId: currentPublication,
      };
    return {
      outcome: "selected",
      publicationId: selected,
      bookmark: "synthetic-browser-bookmark",
      requiredAvailableUntilMs: input.requiredAvailableUntilMs,
    };
  }

  async readDatasetMetadataV1(input) {
    const zero = publicationState(this.env) === "published_zero";
    const publicationId = input?.envelope?.publicationId;
    if (publicationId !== PUBLICATION && publicationId !== NEXT_PUBLICATION)
      return { outcome: "integrity_failure" };
    return {
      outcome: "metadata",
      metadata: {
        publication_id: publicationId,
        schema_version: "1.0.0",
        api_version: "1",
        methodology_version: "1.0.0",
        methodology_effective_at: "2026-08-01T00:00:00.000Z",
        methodology_url: "https://api.example.test/v1/methodologies/1.0.0",
        precision_normalization_version: "precision-normalization@1",
        precision_display_order_version: "precision-display-order@1",
        price_policy_version: "price-policy@1",
        published_at: "2026-08-01T01:00:00.000Z",
        generated_at: "2026-08-01T00:30:00.000Z",
        next_refresh_window: {
          starts_at: "2026-08-02T00:00:00.000Z",
          ends_at: "2026-08-02T01:00:00.000Z",
        },
        counts: {
          active_models: zero ? 0 : 2,
          active_offerings: zero ? 0 : 3,
          active_providers: zero ? 0 : 1,
        },
        degradation_notices: [],
      },
    };
  }

  async readModelDetailV2(input) {
    if (input?.envelope?.publicationId !== PUBLICATION)
      return { outcome: "integrity_failure" };
    const value = input?.lookup?.value;
    if (value === UNAVAILABLE_SLUG) return { outcome: "read_failure" };
    if (value !== MODEL && value !== CURRENT_SLUG && value !== HISTORICAL_SLUG)
      return {
        outcome: "not_found",
        publicationId: PUBLICATION,
        schemaVersion: "1.0.0",
      };
    return {
      outcome: "model",
      lookupProvenance: {
        matchedBy:
          value === MODEL
            ? "stable_id"
            : value === CURRENT_SLUG
              ? "current_slug"
              : "historical_slug",
        canonicalSlug: CURRENT_SLUG,
        projectionVersion: "model-slug@1",
      },
      model: MODEL_RECORD,
      publicationId: PUBLICATION,
      schemaVersion: "1.0.0",
    };
  }

  async readMergedExactSearchV2(input) {
    const envelope = input?.envelope;
    if (
      envelope?.publicationId !== PUBLICATION &&
      envelope?.publicationId !== NEXT_PUBLICATION
    )
      return { outcome: "integrity_failure" };
    const query = envelope?.searchPlan?.query;
    if (query === SEARCH_FAILURE_QUERY) return { outcome: "read_failure" };

    const allResults =
      query === SEARCH_QUERY
        ? SEARCH_MODELS.slice(0, 1)
        : query === SEARCH_PROVIDER_MODEL_ID_QUERY
          ? [
              {
                ...SEARCH_MODELS[0],
                matchKind: "provider_model_id",
                tierMarker: "exact-v1:r",
              },
            ]
          : query === SEARCH_PAGED_QUERY
            ? SEARCH_MODELS
            : query === SEARCH_EMPTY_QUERY
              ? []
              : [];
    const continuation = envelope?.continuation;
    let start = 0;
    if (continuation !== null && continuation !== undefined) {
      const priorIndex = allResults.findIndex(
        ({ resourceId }) => resourceId === continuation.stableId,
      );
      if (priorIndex < 0) return { outcome: "integrity_failure" };
      start = priorIndex + 1;
    }
    const limit =
      Number.isSafeInteger(envelope?.limit) && envelope.limit > 0
        ? envelope.limit
        : 20;
    const selected = allResults.slice(start, start + limit).map(searchResult);
    const last = selected.at(-1);
    const hasMore = start + selected.length < allResults.length;
    const response = {
      outcome: "page",
      page: {
        publicationId: envelope.publicationId,
        results: selected,
        nextContinuation:
          hasMore && last !== undefined
            ? {
                tierMarker: last.tierMarker,
                resourceId: last.resourceId,
              }
            : null,
        semanticDegraded: "disabled",
      },
    };
    if (query === SEARCH_PAGED_QUERY && continuation === null && hasMore)
      currentPublication = NEXT_PUBLICATION;
    else if (
      query === SEARCH_PAGED_QUERY &&
      continuation !== null &&
      envelope.publicationId === PUBLICATION
    )
      retainedPublicationExpired = true;
    return response;
  }
}

export default {
  fetch(_request, env) {
    return new Response(
      `Synthetic query Worker ready: ${publicationState(env)}.`,
    );
  },
};
