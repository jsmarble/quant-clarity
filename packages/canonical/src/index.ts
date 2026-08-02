import {
  assertNonNegativeDecimal,
  decimalSortKey,
} from "@quant-clarity/domain";

export const RESOURCE_PREFIXES = {
  organization: "org",
  model_family: "fam",
  model: "mdl",
  model_variant: "var",
  model_alias: "als",
  slug_history: "slg",
  checkpoint: "chk",
  model_checkpoint: "mck",
  checkpoint_edge: "edg",
  parameter_fact: "par",
  provider: "prv",
  offering: "off",
  claim_scope: "scp",
  affiliate_destination: "aff",
  acquisition_run: "src",
  observation: "obs",
  evidence: "evd",
  field_claim: "clm",
  claim_conflict: "cfl",
  precision_observation: "prc",
  precision_component: "cmp",
  price_schedule: "pcs",
  schedule_occurrence: "occ",
  pipeline_run: "run",
  provider_run: "pvr",
  roster_outcome: "out",
  anomaly: "anm",
  quarantine: "qrn",
  policy_version: "pol",
  publication_provider_slice: "prn",
  publication: "pub",
} as const;

export type CanonicalResourceType = keyof typeof RESOURCE_PREFIXES;

export function createResourceId(
  resourceType: CanonicalResourceType,
  randomUUID: () => `${string}-${string}-${string}-${string}-${string}`,
): string {
  return `${RESOURCE_PREFIXES[resourceType]}_${randomUUID()}`;
}

export function canonicalPrice(
  amount: string,
  statedCurrency: string | null,
): {
  amountDecimal: string;
  amountSortKey: string;
  currency: string;
  currencyProvenance: "provider_stated" | "system_default";
} {
  const currency = statedCurrency ?? "USD";
  if (!/^[A-Z]{3}$/u.test(currency))
    throw new RangeError("Currency must be a three-letter uppercase code.");
  return {
    amountDecimal: assertNonNegativeDecimal(amount),
    amountSortKey: decimalSortKey(amount),
    currency,
    currencyProvenance:
      statedCurrency === null ? "system_default" : "provider_stated",
  };
}

export function offeringIsStale(input: {
  lastSuccessfulObservationMs: number;
  publicationTimeMs: number;
  consecutiveMissedCompletedOpportunities: number;
}): boolean {
  if (
    !Number.isSafeInteger(input.lastSuccessfulObservationMs) ||
    !Number.isSafeInteger(input.publicationTimeMs) ||
    input.publicationTimeMs < input.lastSuccessfulObservationMs ||
    !Number.isSafeInteger(input.consecutiveMissedCompletedOpportunities) ||
    input.consecutiveMissedCompletedOpportunities < 0
  )
    throw new RangeError("Invalid staleness inputs.");
  return (
    input.consecutiveMissedCompletedOpportunities >= 2 ||
    input.publicationTimeMs - input.lastSuccessfulObservationMs >
      8 * 24 * 60 * 60 * 1000
  );
}
