import { describe, expect, it } from "vitest";
import type { Model } from "@quant-clarity/contracts";

import {
  attachedModelCardView,
  attachModelCardView,
  projectModelCardView,
} from "./model-card-view.js";

const MODEL = "mdl_11111111-1111-4111-8111-111111111111";
const FAMILY = "fam_22222222-2222-4222-8222-222222222222";
const EVIDENCE = "evd_33333333-3333-4333-8333-333333333333";
const OBSERVED = "2026-08-01T00:00:00.000Z";
const known = <T>(value: T) => ({
  state: "known" as const,
  value,
  observed_at: OBSERVED,
  evidence_ids: [EVIDENCE],
});
const unknown = {
  state: "unknown" as const,
  value: null,
  observed_at: null,
  evidence_ids: [],
};
const model = {
  model_id: MODEL,
  family_id: FAMILY,
  display_name: known("Fixture Model"),
  publisher: known("Fixture Publisher"),
  total_parameters: known({
    raw_value: "8B",
    normalized_decimal: "8000000000",
    approximation: "exact" as const,
  }),
  active_parameters: unknown,
  source_weight_format: known("BF16"),
  source_quantization: unknown,
  cataloged_provider_count: {
    value: 2,
    observed_at: OBSERVED,
    derivation_version: "provider-count@1",
  },
  last_model_data_refresh: known(OBSERVED),
} as unknown as Model;

describe("closed canonical Model-card projection", () => {
  it("copies only allowed Model facts and detaches nested mutable values", () => {
    const card = projectModelCardView(model);
    expect(Object.keys(card)).toEqual([
      "model_id",
      "display_name",
      "publisher",
      "total_parameters",
      "active_parameters",
      "source_weight_format",
      "source_quantization",
      "cataloged_provider_count",
      "last_model_data_refresh",
    ]);
    expect(card.total_parameters).not.toBe(model.total_parameters);
    if (card.total_parameters.state === "known")
      expect(card.total_parameters.value).not.toBe(
        model.total_parameters.value,
      );
    expect(card.display_name.evidence_ids).not.toBe(
      model.display_name.evidence_ids,
    );
    expect(card.active_parameters).toEqual(unknown);
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.total_parameters)).toBe(true);
  });

  it("attaches without changing the generic result's observable keys", () => {
    const result = Object.freeze({ resourceId: MODEL });
    expect(attachModelCardView(result, model)).toBe(result);
    expect(Object.keys(result)).toEqual(["resourceId"]);
    expect(attachedModelCardView(result)?.model_id).toBe(MODEL);
  });

  it("ignores provider, Offering, affiliate, and input-order material", () => {
    const baseline = projectModelCardView(model);
    const contaminatedInput = {
      ...model,
      affiliate_relationship_present: true,
      provider_names: ["Provider B", "Provider A"],
      offering_witnesses: ["off_b", "off_a"],
    };
    const contaminated = contaminatedInput as unknown as Model;
    const permuted = {
      ...contaminatedInput,
      provider_names: [...contaminatedInput.provider_names].reverse(),
      offering_witnesses: [...contaminatedInput.offering_witnesses].reverse(),
    } as unknown as Model;

    expect(JSON.stringify(projectModelCardView(contaminated))).toBe(
      JSON.stringify(baseline),
    );
    expect(JSON.stringify(projectModelCardView(permuted))).toBe(
      JSON.stringify(baseline),
    );
    expect(Object.keys(baseline)).not.toEqual(
      expect.arrayContaining([
        "affiliate_relationship_present",
        "offering_witnesses",
        "provider_names",
      ]),
    );
  });
});
