import type { Variant } from "@quant-clarity/contracts";

type VariantFact<Key extends keyof Variant> = Variant[Key];

export type VariantCardView = Readonly<{
  variant_id: Variant["variant_id"];
  model_id: Variant["model_id"];
  family_id: Variant["family_id"];
  display_name: VariantFact<"display_name">;
  variant_kind: VariantFact<"variant_kind">;
  publisher: VariantFact<"publisher">;
  total_parameters: VariantFact<"total_parameters">;
  active_parameters: VariantFact<"active_parameters">;
  source_weight_format: VariantFact<"source_weight_format">;
  source_quantization: VariantFact<"source_quantization">;
  cataloged_provider_count: Variant["cataloged_provider_count"];
  last_model_data_refresh: VariantFact<"last_model_data_refresh">;
}>;

const attachedCards = new WeakMap<object, VariantCardView>();

const cloneFact = <
  T extends { evidence_ids: readonly string[]; value: unknown },
>(
  fact: T,
): T =>
  Object.freeze({
    ...fact,
    value:
      typeof fact.value === "object" && fact.value !== null
        ? Object.freeze({ ...fact.value })
        : fact.value,
    evidence_ids: Object.freeze([...fact.evidence_ids]),
  });

/**
 * Derives a compact card strictly from an already contract-, identity-,
 * relationship-, and content-hash-verified canonical Variant. No Model,
 * Offering, Provider, or affiliate input is accepted at this boundary.
 */
export const projectVariantCardView = (variant: Variant): VariantCardView =>
  Object.freeze({
    variant_id: variant.variant_id,
    model_id: variant.model_id,
    family_id: variant.family_id,
    display_name: cloneFact(variant.display_name),
    variant_kind: cloneFact(variant.variant_kind),
    publisher: cloneFact(variant.publisher),
    total_parameters: cloneFact(variant.total_parameters),
    active_parameters: cloneFact(variant.active_parameters),
    source_weight_format: cloneFact(variant.source_weight_format),
    source_quantization: cloneFact(variant.source_quantization),
    cataloged_provider_count: Object.freeze({
      value: variant.cataloged_provider_count.value,
      observed_at: variant.cataloged_provider_count.observed_at,
      derivation_version: variant.cataloged_provider_count.derivation_version,
    }),
    last_model_data_refresh: cloneFact(variant.last_model_data_refresh),
  });

/** Keeps canonical hydration out of the observable generic result shape. */
export const attachVariantCardView = <T extends object>(
  result: T,
  variant: Variant,
): T => {
  attachedCards.set(result, projectVariantCardView(variant));
  return result;
};

export const attachExistingVariantCardView = <T extends object>(
  result: T,
  card: VariantCardView,
): T => {
  attachedCards.set(result, card);
  return result;
};

export const attachedVariantCardView = (
  value: object,
): VariantCardView | null => attachedCards.get(value) ?? null;
