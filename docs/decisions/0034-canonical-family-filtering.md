# ADR 0034: Filter exact model and variant search by canonical family

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Product owner, staff engineer, search lead, API lead, security and privacy lead
- Related requirements: `DATA-002`, `DATA-003`, `SRCH-002`, `SRCH-004`, `SRCH-006`, `SRCH-008`, `SRCH-010`, `API-003`, `API-007`–`API-010`, `API-013`, `API-025`, `API-026`, `BE-003`, `BE-008`, `BE-011`, `CF-006`, `CF-020`, `CF-023`, `NFR-006`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`–`QA-006`, `QA-013`, `QA-014`
- Extends: ADRs 0016 and 0025–0033
- Supersedes: ADR 0033's exclusion of the family filter; its provider-filter decision and all other filter exclusions remain accepted

## Context

`SRCH-004` and `API-008` require model-family filtering. The accepted canonical contracts already require both Model and Variant resources to carry a lowercase canonical `fam_` UUIDv4 `family_id`. The composed exact-search tiers already rehydrate those canonical target resources before returning results.

A family filter is therefore a canonical resource predicate, unlike provider, normalized precision, status, freshness, stale, currency, and price filters that may require Offering, precision-observation, or price applicability. It can be complete across the current canonical-name and provider-model-ID target tiers without adding a publication projection or serving index.

The separate `model` filter remains ambiguous at this boundary: the approved requirements and API contract do not yet state whether selecting a canonical Model ID includes only that Model or also its explicit Variants. This ADR does not silently choose that behavior.

## Decision

The composed exact-search seam accepts at most one `family` value, represented only as a canonical lowercase `fam_` UUIDv4 stable ID. It may be combined conjunctively with the accepted `provider` filter and with `record_type=model` or `record_type=variant`. `family` with `record_type=provider`, family slugs, lists, empty values, and every other still-unsupported filter are rejected before publication resolution or D1 access.

When `family` is present, search returns only Model and Variant resources whose required structural `family_id` exactly equals the requested ID. It invokes the canonical-name and provider-model-ID target classes and skips the canonical Provider-name class. `record_type` further narrows the qualifying target type. When `provider` is also present, the target must independently satisfy ADR 0033's active, non-stale provider eligibility rule. A syntactically valid family ID with no qualifying target returns an empty collection and does not produce a distinct existence signal.

The existing known-active target and Offering lifecycle predicates remain unchanged. A family filter neither reactivates a historical target nor changes the default stale or status policy.

Both target readers apply the family predicate to the selected publication's canonical target resource before ordering, deduplication, winner suppression, and limit. The canonical-name reader predicates its already joined Model or Variant resource; the provider-model-ID reader predicates its already joined canonical target. SQL remains a closed set of fixed SELECT variants and does not interpolate a filter, identifier, or expression.

Serving schema remains `1.9.0`. No table, column, index, migration, readiness suffix, publication proof, backup format, or restore procedure changes. Exact equality first uses the existing immutable exact indexes, and each publication's durable canonical-name and provider-model-ID projections remain capped at 2,000 rows. Query-plan evidence must show those existing exact indexes still bound candidate lookup when the canonical family predicate is active.

Family filtering changes membership only. Exact-class precedence, stable-resource-ID ordering, compact cursor tuple, canonical facts, display names, cataloged-provider counts, and semantic state remain unchanged. Family names, publisher facts, provider facts, Offering counts, prices, precision, affiliate state, and insertion order are never sort inputs.

ADR 0016 already authenticates canonical filters, so no cursor version or tuple change is needed. The family ID appears only as an explicit filter value inside the returned authenticated cursor. Query text, family display names, canonical resource JSON, Offering witnesses, and bookmarks remain absent.

The public request handler remains unchanged and `/v1/search` remains closed. No route, remote resource, secret, deployment, visitor persistence, request telemetry, log, trace, cache key, or visitor-derived durable state is authorized by this decision.

## Consequences

- Exact model/variant search gains one complete canonical family filter across both target exact classes.
- Family filtering can compose with provider eligibility without provider-derived ranking or canonical-result mutation.
- Provider-name results are intentionally inapplicable while a family filter is active.
- Serving schema and publication artifacts do not change; the implementation adds bounded validation, fixed query variants, propagation, and tests only.
- Model, normalized precision, status, freshness/stale, currency, price, alias, prefix/keyword, semantic, and public integration work remains pending.

## Alternatives considered

- Add `family_id` columns and indexes to both exact projections: rejected for this bounded equality slice because both readers already join the canonical target and existing exact indexes bound the candidate set.
- Filter only canonical-name candidates: rejected because provider-model-ID candidates would violate the same public filter.
- Keep Provider results under the filter: rejected because Provider resources have no canonical model-family membership.
- Accept family slugs or display names: rejected because `SRCH-006`, cursor canonicalization, and the current closed filter seam require stable canonical IDs.
- Bundle the `model` filter: rejected until its effect on explicit Variant membership is decided explicitly.
- Reuse Offering eligibility to infer family: rejected because family membership is a canonical Model/Variant relationship and must not depend on provider coverage.

## Validation

- Prove strict family-ID syntax, incompatible-filter and hostile-shape rejection before publication resolution or D1 access, and empty results for unknown-but-well-formed IDs.
- Prove both exact target classes apply family before limit, return qualifying Models and Variants, reject wrong-family and cross-publication targets, and skip the Provider class.
- Prove `family`, `record_type`, and `provider` conjunctions, filter-aware higher-tier winner suppression, every-page traversal, empty pages, and unchanged common-result order.
- Prove canonical target contract and structural `family_id` validation, fixed SELECT-only SQL, existing-index query plans, unchanged statement/result/byte ceilings, and schema-`1.9.0` compatibility.
- Prove exact request/search-plan/envelope agreement, cursor filter reconciliation/tamper/rotation/expiry behavior, static non-echoing failures, and no private fields in results or cursors.
- Prove semantic degradation remains `disabled`, `/v1/search` remains closed, and no cookie, persistence, cache, log, trace, analytics, correlation ID, or custom telemetry is introduced.
