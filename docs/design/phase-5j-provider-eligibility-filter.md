# Phase 5J: Provider eligibility filter for composed exact search

## Status

Local implementation is complete and independently reviewed under [ADR 0033](../decisions/0033-provider-eligibility-filtering.md). The full repository verification gate passed on 2026-08-02. This boundary remains non-routable, deployment-neutral, and zero-visitor-data.

## Slice objective

Add the first complete provider filter to composed exact Model/Variant search. The filter changes only target membership, uses canonical active/non-stale Offering evidence, preserves canonical facts and neutral exact order, and never overloads ADR 0029's same-matching-Offering filter.

## Fixed behavior

- Accept no provider filter or one lowercase canonical `prv_` UUIDv4 stable ID.
- Permit `record_type=model` or `record_type=variant` with provider eligibility; reject `record_type=provider` with it.
- Apply the same independent target-eligibility predicate to canonical-name and provider-model-ID candidates before limit and deduplication.
- Skip the canonical Provider-name class while provider eligibility is active.
- Preserve exact class order, stable-resource-ID order, compact cursor tuple, canonical result facts, full-publication cataloged-provider counts, and `semantic_degraded=disabled`.
- Authenticate the canonical provider filter in the existing cursor without retaining query text, Offering IDs, witnesses, display names, or bookmarks.

## Storage and query boundary

Serving schema `1.9.0` adds `publication_provider_model_id_eligibility_idx` over publication, provider, target type, target ID, and Offering ID. The source table remains the complete closure-bound `provider-model-id@1` projection with its 2,000-document publication ceiling. Every eligibility predicate forces the new index and verifies the selected canonical Offering's hash, links, active status, and non-stale state without returning Offering JSON or provider facts.

The API resolves one publication, calls one V2 merged RPC, and the query Worker uses one bookmark-continuous D1 Session with the existing at-most-four post-resolution SELECT ceiling. The standalone provider-model-ID reader keeps its ADR 0029 same-witness `providerId`; composed search uses a separate `eligibilityProviderId`.

## Acceptance matrix

This is the cumulative acceptance matrix for the provider-filter capability, not a claim that every release-level adversarial permutation is closed by this local slice. The implementation closes exact migration/index guards, base-schema compatibility, provider-A text/provider-B eligibility, stale/inactive/unknown exclusion, filter propagation across composed pages, and filtered cross-tier winner suppression. Runtime injection of otherwise storage-invalid wrong-target, cross-publication, malformed, or hash/link-drift witnesses and exhaustive provider/Offering insertion permutations remain part of the pending full search-release acceptance set.

1. **Migration:** clean `1.8.0` to `1.9.0`, exact existing-schema preflight, collision/rollback safety, exact named-index shape, switch failure on missing/malformed index, and local restore compatibility.
2. **Eligibility:** active/non-stale witness qualifies; stale, inactive, unknown-status, wrong-provider, wrong-target, cross-publication, hash/link drift, and malformed witness do not.
3. **Semantics:** provider-A provider-model-ID text match plus provider-B eligibility qualifies through the independent B Offering; same-witness standalone behavior remains unchanged.
4. **Neutrality:** provider/Offering count, name, tier, region, price, precision, affiliate state, freshness timestamp, and insertion permutation cannot alter common-target facts or order.
5. **Composition:** both target tiers filter before limit, Provider tier is skipped, winner suppression remains filter-aware, and pagination has no duplicate or omission.
6. **Protocol:** exact request/plan/envelope filters, compatible record types, stable provider IDs, hostile shapes, one resolver/RPC/Session, bounded statements/results/bytes, and static failures.
7. **Cursor:** add/remove/change/tamper/expiry/rotation/publication/query/sort/limit cases, original-expiry preservation, and no private ordering/witness fields.
8. **Privacy:** no public route, DML, cookies, storage, Cache API, logs, traces, analytics, telemetry, correlation IDs, visitor-derived durable keys, or query/filter echo.

## Requirement handoff and nonclaims

- `FE-023`, `FE-025`, `FE-026`, `RULE-017`: contributes model-only membership filtering and provider-neutral order evidence.
- `SRCH-004`, `API-008`, `API-010`: contributes one stable-ID provider filter; the remaining required filters and public conformance remain pending.
- `SRCH-006`, `SRCH-008`, `API-003`: contributes canonical Offering-backed eligibility and canonical target rehydration.
- `API-007`, `API-009`, `API-013`, `SEC-001`, `SEC-007`: contributes authenticated deterministic local traversal and closed bounded failures.
- `PRIV-006`, `PRIV-007`, `PRIV-011`: contributes transient storage-free local evidence; deployed privacy proof remains pending.

No traceability status advances in this slice. Prefix/keyword, aliases, semantic retrieval, remaining filters, public Request/Response routing, dedicated public rate limiting, remote resources, deployment, operational restore, and release acceptance remain blocked.
