import { WorkerEntrypoint } from "cloudflare:workers";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";

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
    return {
      outcome: "selected",
      publicationId: PUBLICATION,
      bookmark: "synthetic-browser-bookmark",
      requiredAvailableUntilMs: input.requiredAvailableUntilMs,
    };
  }

  async readDatasetMetadataV1() {
    const zero = publicationState(this.env) === "published_zero";
    return {
      outcome: "metadata",
      metadata: {
        publication_id: PUBLICATION,
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
}

export default {
  fetch(_request, env) {
    return new Response(
      `Synthetic query Worker ready: ${publicationState(env)}.`,
    );
  },
};
