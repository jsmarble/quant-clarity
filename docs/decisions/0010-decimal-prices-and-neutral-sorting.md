# ADR 0010: Store decimal prices exactly and enforce neutral scoped sorting

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, data lead, API lead
- Related requirements: DATA-040–DATA-050, DATA-055–DATA-058, RULE-010–RULE-017, API-004–API-009, API-018, QA-001, QA-004, QA-010
- Supersedes: None

## Context

Token prices require decimal-safe storage and serialization, three independent price categories, original currencies, explicit qualifiers, and deterministic sorting that never compares different currencies or promotes affiliate/commercial preferences. SQLite does not provide a fixed-precision decimal type, and JavaScript binary numbers can introduce artifacts.

## Decision

Represent every observed price with:

- canonical decimal string amount;
- decimal coefficient as an unsigned digit string and explicit scale;
- ISO 4217 currency code where defined;
- currency provenance enum `provider_stated` or `system_default`;
- unit fixed to per one million tokens for the launch contract;
- price category: input, output, or cached input;
- price class: `standard`, `promotional`, `batch`, `subscription`, `committed`, `volume`, `dedicated`, `region_tiered`, `context_tiered`, or `other_conditional`;
- applicability/effective/observation times, condition fields, source value, and evidence.

Never parse, calculate, compare, or serialize a canonical amount through JavaScript `number`. Validate and normalize with an exact decimal library in the pipeline and contract layer.

For efficient D1 sorting, derive a non-canonical 43-character lexicographic sort key from the validated non-negative decimal: 24 zero-padded integer digits, one separator, and exactly 18 fractional digits. Reject or quarantine values outside the accepted magnitude/scale instead of rounding. Retain the original decimal and coefficient/scale regardless of sort-key generation.

Numeric price sorting/filtering requires one explicit currency scope and one price role/class. Default sorting includes only `standard` comparable prices. If the caller omits currency and matching USD records exist, scope to USD; otherwise select the first matching ISO currency in ascending code order and return that scope visibly. Conditional, tiered, and promotional facts remain visible but enter sorting only by explicit user choice. A missing cached-input price remains null, not zero. Only a provider omission creates a visibly marked USD `system_default`; no exchange-rate conversion occurs.

Stable secondary ordering is provider display name ascending and stable offering ID ascending. It is navigation determinism, not a tie-break winner. Affiliate data is stored outside canonical provider/offering/price records and is unavailable to comparison and search sort functions.

## Consequences

- API amounts round-trip exactly as JSON strings without binary artifacts.
- D1 can index and sort non-negative prices predictably within validated bounds.
- Currency and price-class scoping prevents false cross-currency or promotional rankings.
- The chosen magnitude and 18-decimal scale bounds become a versioned contract that must be generous and tested against provider data.
- Clients must treat price amounts as decimals, not JSON numbers.
- Sort-key derivation is reproducible and testable but is not itself a public fact.

## Alternatives considered

- SQLite `REAL` or JavaScript `number`: rejected because binary floating point cannot preserve exact decimal values.
- ISO minor-unit integers: rejected because token prices may require more precision than a currency's ordinary cash minor unit.
- Arbitrary decimal strings sorted directly: rejected because variable-width lexicographic order is not numeric order.
- Convert prices to USD: rejected by the PRD.
- Composite or blended token price: rejected by DATA-047 and the neutrality requirements.
- Affiliate value as a secondary key: rejected because equal factual values must remain equal.

## Validation

- Round-trip boundary, trailing-zero, very small, large, and maximum-scale values through fixture, D1, API, and UI layers.
- Prove input, output, and cached-input remain independent and null differs from zero.
- Golden tests cover provider-stated currency, USD system default, mixed currencies, promotions, conditional/context/region tiers, and equal factual values.
- Property-test sort-key order against an exact decimal library within documented bounds.
- Reject cross-currency numeric sorting and out-of-bound amounts with stable API/pipeline errors.
- Mutate affiliate commission and destination data in tests and prove inclusion, relevance, ordering, filters, and price results do not change.
