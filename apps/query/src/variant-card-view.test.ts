import { describe, expect, it } from "vitest";
import type { Variant } from "@quant-clarity/contracts";

import {
  attachedVariantCardView,
  attachVariantCardView,
  projectVariantCardView,
} from "./variant-card-view.js";

const VARIANT = "var_11111111-1111-4111-8111-111111111111";
const MODEL = "mdl_22222222-2222-4222-8222-222222222222";
const FAMILY = "fam_33333333-3333-4333-8333-333333333333";
const EVIDENCE = "evd_44444444-4444-4444-8444-444444444444";
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
const variant = {
  variant_id: VARIANT,
  model_id: MODEL,
  family_id: FAMILY,
  display_name: known("Fixture Variant FP8"),
  variant_kind: known("publisher_precision_variant"),
  publisher: known("Fixture Publisher"),
  total_parameters: known({
    raw_value: "8B",
    normalized_decimal: "8000000000",
    approximation: "exact" as const,
  }),
  active_parameters: unknown,
  source_weight_format: known("FP8"),
  source_quantization: known("publisher-provided FP8"),
  cataloged_provider_count: {
    value: 2,
    observed_at: OBSERVED,
    derivation_version: "provider-count@1",
  },
  last_model_data_refresh: known(OBSERVED),
} as unknown as Variant;

describe("closed canonical Variant-card projection", () => {
  it("copies only Variant facts and structural family relationships", () => {
    const card = projectVariantCardView(variant);
    expect(Object.keys(card)).toEqual([
      "variant_id",
      "model_id",
      "family_id",
      "display_name",
      "variant_kind",
      "publisher",
      "total_parameters",
      "active_parameters",
      "source_weight_format",
      "source_quantization",
      "cataloged_provider_count",
      "last_model_data_refresh",
    ]);
    expect(card.model_id).toBe(MODEL);
    expect(card.family_id).toBe(FAMILY);
    expect(card.total_parameters).not.toBe(variant.total_parameters);
    if (card.total_parameters.state === "known")
      expect(card.total_parameters.value).not.toBe(
        variant.total_parameters.value,
      );
    expect(card.display_name.evidence_ids).not.toBe(
      variant.display_name.evidence_ids,
    );
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.total_parameters)).toBe(true);
  });

  it("attaches without changing the generic result's observable keys", () => {
    const result = Object.freeze({ resourceId: VARIANT });
    expect(attachVariantCardView(result, variant)).toBe(result);
    expect(Object.keys(result)).toEqual(["resourceId"]);
    expect(attachedVariantCardView(result)?.variant_id).toBe(VARIANT);
  });

  it("preserves unavailable and not-applicable states without inference", () => {
    const unavailable = {
      state: "unavailable" as const,
      value: null,
      observed_at: OBSERVED,
      evidence_ids: [],
    };
    const notApplicable = {
      state: "not_applicable" as const,
      value: null,
      observed_at: OBSERVED,
      evidence_ids: [],
    };
    const card = projectVariantCardView({
      ...variant,
      publisher: unavailable,
      source_quantization: notApplicable,
    });
    expect(card.publisher).toEqual(unavailable);
    expect(card.source_quantization).toEqual(notApplicable);
    expect(card.publisher).not.toBe(unavailable);
    expect(card.source_quantization).not.toBe(notApplicable);
  });

  it("ignores Model, provider, Offering, affiliate, and input-order material", () => {
    const baseline = projectVariantCardView(variant);
    const contaminatedInput = {
      ...variant,
      inherited_model_publisher: "Do not inherit",
      affiliate_relationship_present: true,
      provider_names: ["Provider B", "Provider A"],
      offering_witnesses: ["off_b", "off_a"],
    };
    const contaminated = contaminatedInput as unknown as Variant;
    const permuted = {
      ...contaminatedInput,
      provider_names: [...contaminatedInput.provider_names].reverse(),
      offering_witnesses: [...contaminatedInput.offering_witnesses].reverse(),
    } as unknown as Variant;

    expect(JSON.stringify(projectVariantCardView(contaminated))).toBe(
      JSON.stringify(baseline),
    );
    expect(JSON.stringify(projectVariantCardView(permuted))).toBe(
      JSON.stringify(baseline),
    );
  });
});
