import type { Model } from "@quant-clarity/contracts";

type ModelFact<Key extends keyof Model> = Model[Key];

export type ModelCardView = Readonly<{
  model_id: Model["model_id"];
  display_name: ModelFact<"display_name">;
  publisher: ModelFact<"publisher">;
  total_parameters: ModelFact<"total_parameters">;
  active_parameters: ModelFact<"active_parameters">;
  source_weight_format: ModelFact<"source_weight_format">;
  source_quantization: ModelFact<"source_quantization">;
  cataloged_provider_count: Model["cataloged_provider_count"];
  last_model_data_refresh: ModelFact<"last_model_data_refresh">;
}>;

const attachedCards = new WeakMap<object, ModelCardView>();

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
 * Derives the compact Model-card presentation strictly from an already
 * contract- and content-hash-verified canonical Model. No Offering or Provider
 * input is accepted at this boundary.
 */
export const projectModelCardView = (model: Model): ModelCardView =>
  Object.freeze({
    model_id: model.model_id,
    display_name: cloneFact(model.display_name),
    publisher: cloneFact(model.publisher),
    total_parameters: cloneFact(model.total_parameters),
    active_parameters: cloneFact(model.active_parameters),
    source_weight_format: cloneFact(model.source_weight_format),
    source_quantization: cloneFact(model.source_quantization),
    cataloged_provider_count: Object.freeze({
      value: model.cataloged_provider_count.value,
      observed_at: model.cataloged_provider_count.observed_at,
      derivation_version: model.cataloged_provider_count.derivation_version,
    }),
    last_model_data_refresh: cloneFact(model.last_model_data_refresh),
  });

/** Keeps canonical hydration out of the observable generic result shape. */
export const attachModelCardView = <T extends object>(
  result: T,
  model: Model,
): T => {
  attachedCards.set(result, projectModelCardView(model));
  return result;
};

export const attachExistingModelCardView = <T extends object>(
  result: T,
  card: ModelCardView,
): T => {
  attachedCards.set(result, card);
  return result;
};

export const attachedModelCardView = (value: object): ModelCardView | null =>
  attachedCards.get(value) ?? null;
