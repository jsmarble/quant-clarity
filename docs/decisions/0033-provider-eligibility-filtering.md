# ADR 0033: Filter model and variant search by provider eligibility

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Product owner, staff engineer, search lead, API lead, security and privacy lead
- Related requirements: `RULE-017`, `FE-015`, `FE-023`, `FE-025`, `FE-026`, `SRCH-002`, `SRCH-004`, `SRCH-006`, `SRCH-008`, `SRCH-010`, `API-003`, `API-007`–`API-010`, `API-013`, `API-025`, `API-026`, `BE-003`, `BE-008`, `BE-011`, `CF-006`, `CF-020`, `CF-023`, `NFR-006`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`–`QA-006`, `QA-013`, `QA-014`
- Extends: ADRs 0016, 0027–0032
- Supersedes: ADR 0030's record-type-only filter boundary for the provider filter described here; all other filter exclusions remain accepted

## Context

ADR 0030 rejected partially applying a provider filter only to provider-model-ID matches. A complete model-first provider filter must make both canonical-name and provider-model-ID target candidates eligible by the same rule without changing their canonical facts or neutral order.

ADR 0029's standalone `providerId` has different semantics: it requires the Offering whose provider model ID matched the query to belong to that provider. General search eligibility is target-level. A query may match provider A's model ID while provider B independently makes the same Model or Variant eligible through another active, non-stale Offering. Conflating these meanings would create false negatives.

The complete one-row-per-Offering `provider-model-id@1` projection is already closure-bound and capped at 2,000 documents per publication, but its two indexes begin with provider-model-ID bytes. They cannot bound lookup by provider and target.

## Decision

The composed exact-search seam accepts at most one `provider` value, represented only as a canonical lowercase `prv_` UUIDv4 stable ID. It may be combined with `record_type=model` or `record_type=variant`. `provider` with `record_type=provider`, provider slugs, lists, empty values, and every other still-unsupported filter are rejected before publication resolution or D1 access.

When `provider` is present, search returns only eligible Model and Variant resources. It invokes canonical-name and provider-model-ID classes and skips the canonical Provider-name class. A target is eligible exactly when the selected publication contains at least one canonical Offering for the selected provider that targets that resource, has known active status, and is not stale. The eligibility witness is independent of the Offering whose provider model ID matched the query.

Serving schema `1.9.0` adds the named non-unique index `publication_provider_model_id_eligibility_idx` over `(publication_id, provider_id, target_resource_type, target_resource_id, offering_id)`. Candidate SQL forces that index, joins the canonical Offering resource, and verifies publication, provider, target, projection/content hashes, canonical links, active status, and `stale=false` inside an existential predicate before ordering, deduplication, and limit. The existing 2,000-document publication ceiling remains the absolute eligibility-probe bound. Migration preflight, switch-time shape/queryability checks, local restore expectations, and query-plan tests fail closed if the index is absent or malformed.

The standalone ADR 0029 same-witness filter remains unchanged. Its merged reader receives a separate `eligibilityProviderId`; the existing matching `providerId` remains null in composed search. Cross-tier canonical winner suppression therefore uses the same target-eligibility rule in both target classes.

Provider filtering changes membership only. Exact-class precedence, stable-resource-ID ordering, compact cursor tuple, canonical facts, display names, cataloged-provider counts, and semantic state remain unchanged. Provider display name, prices, precision, affiliate state, Offering count, tier, region, and insertion order are never sort inputs.

ADR 0016 already authenticates canonical filters, so no cursor version or tuple change is needed. The provider ID is present only as an explicit public filter value inside the returned authenticated cursor; query text, Offering IDs, witness data, display names, and bookmarks remain absent.

The public request handler remains unchanged and `/v1/search` remains closed. No route, remote resource, secret, deployment, visitor persistence, request telemetry, log, trace, cache key, or provider-derived durable state is authorized by this decision.

## Consequences

- Exact model/variant search can apply its first complete provider eligibility filter without provider ranking or model-card mutation.
- Provider-name results are intentionally inapplicable while a provider eligibility filter is active.
- The filter remains independently meaningful when a provider-model-ID text match comes from a different provider.
- Serving schema and query plans gain one additive bounded index; no new canonical entity or duplicated public fact is created.
- Model/family, precision, status, freshness, currency, price, alias, prefix/keyword, semantic, and public integration work remains pending.

## Alternatives considered

- Reuse ADR 0029's same-matching-Offering provider filter: rejected because it drops targets eligible through another Offering from the selected provider.
- Filter only provider-model-ID candidates: rejected because canonical-name candidates would violate the same filter.
- Keep Provider results under the filter: rejected because one value would ambiguously mean target eligibility and Provider identity.
- Scan the existing raw or normalized exact index: rejected because neither begins with provider and target.
- Rewrite model facts or cataloged-provider count for the selected provider: rejected by `FE-023`, `FE-025`, and the canonical publication contract.
- Persist filtered result order or visitor state: rejected because membership can be computed from publication data and order must remain provider-neutral.

## Validation

- Prove schema `1.9.0` atomic migration, collision rejection, exact index shape, forced query plans, switch-time failure, and restore-boundary compatibility.
- Prove active/non-stale same-publication eligibility and reject stale, inactive, unknown-status, wrong-provider, wrong-target, cross-publication, hash/link-drifted, or malformed witnesses.
- Prove provider-A text match/provider-B eligibility, filter-before-limit, cross-tier deduplication, every-page traversal, empty results, and unchanged common-result order under Offering/provider permutations.
- Prove exact request/search-plan/envelope agreement, stable-ID validation, incompatible-filter rejection before effects, hostile RPC handling, cursor filter reconciliation/tamper/rotation/expiry, and static non-echoing failures.
- Prove canonical results contain no provider facts, provider tier is skipped, semantic degradation stays `disabled`, and `/v1/search` remains closed with zero visitor data and telemetry.
