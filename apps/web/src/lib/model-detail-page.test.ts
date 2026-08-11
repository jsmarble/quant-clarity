import { describe, expect, it } from "vitest";

import type { DatasetMetadata, ModelDetail } from "@quant-clarity/contracts";

import type { PublicationState } from "./dataset-metadata.js";
import type { ModelDetailState } from "./model-detail.js";
import {
  modelDetailPageMetadata,
  planModelDetailPageRead,
  resolveModelDetailPageState,
} from "./model-detail-page.js";

const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const PUBLICATION_ID = "pub_11111111-1111-4111-8111-111111111111";

const metadata: DatasetMetadata = {
  api_version: "1",
  counts: { active_models: 1, active_offerings: 1, active_providers: 1 },
  degradation_notices: [],
  generated_at: "2026-08-01T00:30:00.000Z",
  methodology_effective_at: "2026-08-01T00:00:00.000Z",
  methodology_url: "https://api.example.test/v1/methodologies/1.0.0",
  methodology_version: "1.0.0",
  next_refresh_window: {
    ends_at: "2026-08-02T01:00:00.000Z",
    starts_at: "2026-08-02T00:00:00.000Z",
  },
  precision_display_order_version: "precision-display-order@1",
  precision_normalization_version: "precision-normalization@1",
  price_policy_version: "price-policy@1",
  publication_id: PUBLICATION_ID,
  published_at: "2026-08-01T01:00:00.000Z",
  schema_version: "1.13.0",
};

const published: PublicationState = { kind: "published", metadata };

const found = (
  slug:
    | Readonly<{
        evidence_ids: readonly string[];
        observed_at: string;
        state: "known";
        value: string;
      }>
    | Readonly<{
        evidence_ids: readonly string[];
        observed_at: string | null;
        state: "unknown";
        value: null;
      }>,
  modelId = MODEL_ID,
): ModelDetailState =>
  ({
    detail: { data: { model_id: modelId, slug } } as ModelDetail,
    kind: "found",
  }) as const;

describe("Model-detail SSR page planning (FE-030, FE-060, PRIV-006)", () => {
  it.each([
    "/models/",
    "/models/example-model/",
    "/models/example/model",
    "/models/%65xample-model",
    "/models/example%2Fmodel",
    "/models/example%5Cmodel",
    "/models/Example-Model",
    "/models/mdl_11111111-1111-4111-8111-111111111111/extra",
    "/providers/example-model",
  ])(
    "rejects a noncanonical post-platform pathname without a read: %s",
    (pathname) => {
      expect(planModelDetailPageRead(pathname, "local", published)).toEqual({
        kind: "not_found",
      });
    },
  );

  it("admits only exact local or test paths over a published snapshot", () => {
    expect(
      planModelDetailPageRead(`/models/${MODEL_ID}`, "local", published),
    ).toEqual({
      identifier: { kind: "stable_id", value: MODEL_ID },
      kind: "read",
      metadata,
    });
    expect(
      planModelDetailPageRead("/models/example-model", "test", published),
    ).toEqual({
      identifier: { kind: "slug", value: "example-model" },
      kind: "read",
      metadata,
    });
  });

  it.each(["preview", "production"] as const)(
    "keeps the %s Model route closed even when metadata is published",
    (environment) => {
      expect(
        planModelDetailPageRead(
          "/models/example-model",
          environment,
          published,
        ),
      ).toEqual({ kind: "not_found" });
    },
  );

  it("distinguishes initial non-publication from dependency unavailability", () => {
    expect(
      planModelDetailPageRead("/models/example-model", "local", {
        kind: "not_published",
      }),
    ).toEqual({ kind: "not_found" });
    expect(
      planModelDetailPageRead("/models/example-model", "local", {
        kind: "unavailable",
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("renders stable IDs and current slugs with stable-ID canonical identity", () => {
    const stablePlan = planModelDetailPageRead(
      `/models/${MODEL_ID}`,
      "local",
      published,
    );
    const slugPlan = planModelDetailPageRead(
      "/models/example-model",
      "local",
      published,
    );
    expect(stablePlan.kind).toBe("read");
    expect(slugPlan.kind).toBe("read");
    if (stablePlan.kind !== "read" || slugPlan.kind !== "read") return;
    const result = found({
      evidence_ids: ["evd_11111111-1111-4111-8111-111111111111"],
      observed_at: "2026-08-01T00:00:00.000Z",
      state: "known",
      value: "example-model",
    });
    expect(resolveModelDetailPageState(stablePlan.identifier, result)).toEqual(
      expect.objectContaining({
        canonicalPath: `/models/${MODEL_ID}`,
        kind: "found",
      }),
    );
    expect(resolveModelDetailPageState(slugPlan.identifier, result)).toEqual(
      expect.objectContaining({
        canonicalPath: `/models/${MODEL_ID}`,
        kind: "found",
      }),
    );
  });

  it("redirects a verified historical slug to the stable ID", () => {
    const plan = planModelDetailPageRead(
      "/models/old-model",
      "local",
      published,
    );
    expect(plan.kind).toBe("read");
    if (plan.kind !== "read") return;
    expect(
      resolveModelDetailPageState(
        plan.identifier,
        found({
          evidence_ids: ["evd_11111111-1111-4111-8111-111111111111"],
          observed_at: "2026-08-01T00:00:00.000Z",
          state: "known",
          value: "current-model",
        }),
      ),
    ).toEqual({
      kind: "redirect",
      location: `/models/${MODEL_ID}`,
    });
  });

  it("fails unavailable for a slug whose canonical slug Fact is not known", () => {
    const plan = planModelDetailPageRead(
      "/models/example-model",
      "local",
      published,
    );
    expect(plan.kind).toBe("read");
    if (plan.kind !== "read") return;
    expect(
      resolveModelDetailPageState(
        plan.identifier,
        found({
          evidence_ids: [],
          observed_at: null,
          state: "unknown",
          value: null,
        }),
      ),
    ).toEqual({ kind: "unavailable" });
  });

  it("allows an exact stable ID with an unknown slug but rejects crossed identity", () => {
    const plan = planModelDetailPageRead(
      `/models/${MODEL_ID}`,
      "local",
      published,
    );
    expect(plan.kind).toBe("read");
    if (plan.kind !== "read") return;
    const unknownSlug = {
      evidence_ids: [],
      observed_at: null,
      state: "unknown" as const,
      value: null,
    };
    expect(
      resolveModelDetailPageState(plan.identifier, found(unknownSlug)),
    ).toEqual(
      expect.objectContaining({
        canonicalPath: `/models/${MODEL_ID}`,
        kind: "found",
      }),
    );
    expect(
      resolveModelDetailPageState(
        plan.identifier,
        found(unknownSlug, "mdl_22222222-2222-4222-8222-222222222222"),
      ),
    ).toEqual({ kind: "unavailable" });
  });

  it.each([{ kind: "not_found" }, { kind: "unavailable" }] as const)(
    "preserves the closed client state $kind",
    (result) => {
      const plan = planModelDetailPageRead(
        "/models/example-model",
        "local",
        published,
      );
      expect(plan.kind).toBe("read");
      if (plan.kind !== "read") return;
      expect(resolveModelDetailPageState(plan.identifier, result)).toEqual(
        result,
      );
    },
  );
});

describe("Model-detail success metadata (FE-061)", () => {
  it("disambiguates duplicate display names with the stable Model ID", () => {
    const first = modelDetailPageMetadata(MODEL_ID, "Duplicate name");
    const second = modelDetailPageMetadata(
      "mdl_22222222-2222-4222-8222-222222222222",
      "Duplicate name",
    );

    expect(first.title).not.toBe(second.title);
    expect(first.description).not.toBe(second.description);
    expect(first.title).toContain(MODEL_ID);
    expect(first.description).toContain(MODEL_ID);
  });

  it.each([null, "", "   "])(
    "uses stable canonical identity for an absent or empty display name: %j",
    (displayName) => {
      const metadata = modelDetailPageMetadata(MODEL_ID, displayName);

      expect(metadata).toEqual({
        description: `Publisher and source facts for Canonical model include evidence and observation times. QuantClarity canonical Model ID: ${MODEL_ID}.`,
        title: `Canonical model (${MODEL_ID}) Model Facts — QuantClarity`,
      });
    },
  );

  it("describes the stable ID as QuantClarity routing identity, not an evidence-backed Fact", () => {
    const metadata = modelDetailPageMetadata(MODEL_ID, "Example model");

    expect(metadata.description).toContain(
      "include evidence and observation times",
    );
    expect(metadata.description).toContain(
      `QuantClarity canonical Model ID: ${MODEL_ID}`,
    );
    expect(metadata.description).not.toContain(`evidence-backed ${MODEL_ID}`);
  });
});
