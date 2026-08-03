# Phase 5K: Canonical family filter for composed exact search

## Status

Design and local implementation are accepted under [ADR 0034](../decisions/0034-canonical-family-filtering.md), with independent architecture, adversarial QA, and security/privacy review complete. This boundary is non-routable, deployment-neutral, and zero-visitor-data. No requirement status advances in this slice.

## Slice objective

Add one complete canonical family filter to composed exact Model/Variant search. The filter changes target membership only, reads the required `family_id` from canonical Model and Variant resources, composes with provider eligibility and record type, and adds no serving schema or publication artifact.

## Fixed behavior

- Accept no family filter or one lowercase canonical `fam_` UUIDv4 stable ID.
- Permit `record_type=model` or `record_type=variant`; reject `record_type=provider` with family.
- Permit family, provider eligibility, and a compatible record type together with conjunctive semantics.
- Apply family equality identically to canonical-name and provider-model-ID target candidates before ordering, limit, deduplication, and cross-tier winner suppression.
- Skip the canonical Provider-name class while family is active.
- Return an empty collection for a well-formed family ID with no qualifying target.
- Preserve every existing known-active target and Offering lifecycle predicate; family does not reactivate historical or stale data.
- Preserve exact class order, stable-resource-ID order, compact cursor tuple, canonical result facts, full-publication cataloged-provider counts, and `semantic_degraded=disabled`.
- Authenticate the canonical family filter in the existing cursor without retaining query text, family display names, resource JSON, Offering witnesses, or bookmarks.

## Storage and query boundary

Serving schema remains `1.9.0`. No migration, projection, index, readiness proof, switch preflight, backup artifact, or restore procedure changes. Both exact target readers already join the selected publication's canonical target resource, whose Model and Variant contracts require `family_id`.

Implementation adds fixed SQL variants that compare `json_extract(target.resource_json, '$.family_id')` with the validated family ID while retaining the existing forced exact-name or provider-model-ID index. The predicate runs before each reader's order and limit. The durable exact projections remain capped at 2,000 rows per publication, the composed read retains its one bookmark-continuous D1 Session and at-most-four post-resolution SELECT ceiling, and malformed canonical JSON or contract/link drift fails closed through the existing integrity boundary.

The API normalizer, search plan, closed RPC envelope, query service input, response metadata, and authenticated cursor must agree on exactly the same optional `family` value. No layer may accept a slug, list, display name, arbitrary resource ID, or filter not represented at every other layer.

## Acceptance matrix

1. **Validation:** exact lowercase `fam_` UUIDv4 syntax; reject uppercase, wrong prefix/version/variant, empty/list/slug values, accessors, proxies, inherited properties, excess keys, and incompatible Provider record type before effects.
2. **Canonical membership:** qualifying Model and Variant `family_id` equality; wrong-family, malformed target, type/ID mismatch, cross-publication row, hash drift, and missing required family field fail closed or do not qualify as applicable.
3. **Composition:** family-only, family plus each compatible record type, family plus provider, and all three filters apply before limit in both target tiers; Provider tier is skipped.
4. **Traversal:** filtered higher-tier winner suppression, every-page traversal, empty first/later pages, cursor continuation, and no duplicate or omitted stable target.
5. **Neutrality:** family display name, publisher, provider/Offering order or count, price, precision, affiliate state, and insertion permutations cannot alter common-target facts or order.
6. **Protocol:** exact request/plan/envelope filter agreement, hostile RPC handling, one resolver/RPC/Session, fixed SELECT-only statements, bounded results/bytes, and unchanged schema and statement ceilings.
7. **Cursor:** add/remove/change/tamper/expiry/rotation/publication/query/sort/limit cases, original-expiry preservation, canonical filter order, and no resource JSON or witness fields.
8. **Privacy:** no public route, DML, cookie, storage, Cache API use, log, trace, analytics, telemetry, request-correlation ID, visitor-derived durable key, or query/filter echo.

Local acceptance evidence includes descriptor-safe validation, fixed-SQL structural assertions, Model and Variant membership, unknown-family emptiness, provider conjunction, raw and normalized exact-index plans, and an idempotent real-D1 collision fixture proving wrong-family exclusion before `LIMIT` plus two-page traversal in both canonical-name and raw provider-model-ID paths. The readers intentionally validate only the contract-valid canonical target's `family_id`; existence of the referenced ModelFamily and agreement with its `model_ids` remain publication-closure work and are not claimed by this slice.

## Requirement handoff and nonclaims

- `DATA-002`, `DATA-003`: uses the canonical family relationship already required by the contracts; does not complete family/variant publication or UI acceptance.
- `SRCH-004`, `API-008`, `API-010`: contributes one stable-ID family filter; the separate model filter, offering-derived filters, later search classes, and public conformance remain pending.
- `SRCH-006`, `SRCH-008`, `API-003`: contributes publication-pinned canonical target membership and rehydration without duplicating family facts in an index.
- `API-007`, `API-009`, `API-013`, `SEC-001`, `SEC-007`: contributes authenticated deterministic local traversal and closed bounded failures without changing the cursor tuple.
- `PRIV-006`, `PRIV-007`, `PRIV-011`: contributes transient storage-free local design evidence; deployed privacy proof remains pending.

No traceability status advances in this slice. The `model` filter is deferred until Model-versus-child-Variant semantics are accepted explicitly. Normalized precision, status, freshness/stale, currency, and price remain deferred because their exact Offering/claim/price applicability and serving projections require separate decisions. Prefix/keyword, aliases, semantic retrieval, public Request/Response routing, dedicated public rate limiting, remote resources, deployment, operational restore, and release acceptance also remain pending.
