# ADR 0037: Filter exact model and variant search by explicit stale Offering eligibility

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Product owner, staff engineer, search lead, API lead, security and privacy lead
- Related requirements: `DATA-066`, `DATA-067`, `RULE-017`, `FE-015`, `FE-020`, `FE-023`, `FE-025`, `FE-026`, `SRCH-004`, `SRCH-006`, `SRCH-008`, `SRCH-010`, `API-003`, `API-007`–`API-010`, `API-013`, `API-025`, `API-026`, `BE-003`, `BE-008`, `BE-011`, `CF-006`, `CF-020`, `CF-023`, `NFR-006`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`–`QA-006`, `QA-013`, `QA-014`
- Extends: ADRs 0016, 0027–0036
- Supersedes: ADR 0029's unconditional non-stale matching-Offering rule only when the composed exact-search request contains an explicit `stale` filter; all standalone-reader and unfiltered behavior remains accepted

## Context

`SRCH-004` and `API-008` require stale-status filtering. The composed exact-search seam already accepts canonical record-type, provider, and family filters, but it rejects `stale` before publication resolution. Its canonical-name tier can qualify a Model or Variant through Offering eligibility, while its provider-model-ID tier also has an exact Offering whose provider model ID matched the query. Those are different roles and must not be conflated.

ADR 0033 deliberately made the general provider filter target-level: a provider-model-ID match from provider A may qualify through an independently matching active, non-stale Offering from provider B. Requiring stale and provider predicates from different Offerings would nevertheless create false positives. A selected provider with only fresh Offerings must not satisfy `provider=A&stale=true` merely because another provider has a stale Offering for the same target.

ADR 0029 also excludes stale provider-model-ID match witnesses by default. Leaving that rule unconditional would make `stale=true` unable to discover an exact provider model ID that exists only on a stale Offering. Treating an absent filter as `false`, conversely, would remove active Models or Variants with no qualifying Offering from the existing unfiltered canonical-name corpus. This decision must preserve the absent case while defining both explicit booleans.

## Decision

### Public filter and applicability

The composed exact-search seam accepts an optional single `stale` boolean. Its only canonical URL values are `true` and `false`; lists, empty values, alternate spellings, and non-booleans are rejected before publication resolution or D1 access. Absence is a distinct state and preserves all existing unfiltered lifecycle behavior.

`stale` may compose conjunctively with one canonical `provider` ID, one canonical `family` ID, and `record_type=model|variant`. It is incompatible with `record_type=provider`. Whenever `stale` is present, the canonical Provider-name class is skipped. A syntactically valid filter with no qualifying target returns an empty collection and no existence oracle.

The stale value is the canonical boolean stored in the selected immutable publication. It is not recomputed from request time, provider availability, provider-slice state, or a visitor-supplied timestamp. This filter adds no freshness range or observation-time behavior.

### Target Offering eligibility witness

An explicit `stale=S` requires a target-level canonical Offering witness `W_E` that:

- belongs to the selected publication and targets the candidate's exact Model or Variant type and stable ID;
- has status exactly known `active`;
- has canonical `stale` exactly equal to `S`;
- agrees with the complete `provider-model-id@1` projection row on Offering, provider, target, raw provider model ID, projection version, and Offering/target content hashes; and
- joins the exact canonical Offering resource whose contract, links, and recomputed hash validate.

If `provider=P` is also present, the same `W_E` must have provider `P`. Provider and stale predicates cannot be satisfied by different Offerings. With no provider, any exact qualifying Offering for the target may be `W_E`. Family remains a separate canonical target predicate, and record type remains a separate exact target-type predicate.

Eligibility is existential. A target with one active fresh Offering and one active stale Offering may qualify independently for both explicit boolean filters. Inactive, unavailable, deleted, and unknown-status Offerings do not qualify in this slice even if their stale boolean matches. A later status-filter decision owns historical and inactive search semantics.

When no stale filter is present, ADR 0033's provider-only witness remains exactly known-active and non-stale. No provider and no stale filter adds no Offering-eligibility requirement to the canonical-name tier.

### Provider-model-ID matching witness

The provider-model-ID class keeps its exact matching witness `W_M` separate from target eligibility `W_E`. `W_M` still proves the selected publication, exact raw or normalized provider-model-ID equality, Offering and target links, projection and content hashes, known-active target, and known-active Offering.

Its stale predicate is:

- absent filter: `W_M.stale=false`, preserving ADR 0029;
- `stale=false`: `W_M.stale=false`; and
- `stale=true`: `W_M.stale=true`.

This is the only accepted supersession of ADR 0029. It permits explicit discovery of a stale exact provider model ID without adding stale results to the default corpus. When provider and stale are both present, `W_M` may belong to a different provider from `W_E`, preserving ADR 0033's target-level provider semantics, but both witnesses must independently carry the explicitly selected stale value. `W_E` alone must satisfy the provider-plus-stale conjunction.

### Schema 1.11 target-first eligibility index

Serving schema `1.11.0` adds one non-unique index:

```sql
publication_provider_model_id_target_eligibility_idx(
  publication_id,
  target_resource_type,
  target_resource_id,
  offering_id
)
```

The existing provider-first eligibility index remains authoritative for provider-only and provider-plus-stale probes. The new target-first index bounds stale-only eligibility by exact publication and target. Both paths join and validate canonical Offering JSON; stale and status are not duplicated into projection columns or trusted from an index.

The migration requires an exact clean `1.10.0` predecessor, same-name object collision rejection, exact BINARY ascending non-partial index shape, forced-index queryability, a switch-time guard, transactional rollback at every statement boundary, and local restore-rebuild support. It changes no table, column, projection version, readiness suffix, publication closure, backup payload, or canonical contract. The complete provider-model-ID projection remains capped at 2,000 rows per publication.

Durable restore identities are immutable. Restore source profile
`backup-v1-restore-source@2` and transcript `serving-restore-rebuild@4` remain
pinned to schema `1.10.0`. Schema `1.11.0` uses the new source profile
`backup-v1-restore-source@3` and transcript `serving-restore-rebuild@5` while
retaining the same canonical import set, rebuild phases, provider-model-ID v4
proof, readiness v4 receipt, switch v4 phase, closure, and backup exclusions.
The schema-only target index is created by migration and proved again by the
ordinary switch guard; it is not imported as durable authority.

### Fixed queries and bounds

Both target readers use a closed set of fixed SELECT-only variants. They never interpolate a filter, identifier, JSON path, index name, or SQL expression. The canonical-name reader applies target eligibility before stable-ID order and limit. The provider-model-ID reader applies its matching-witness stale predicate and independent target eligibility before raw/normalized deduplication, cross-tier winner suppression, order, and limit.

The existing limits remain unchanged: one publication resolution, one composed named RPC, one bookmark-continuous D1 Session, at most four post-resolution SELECTs, public limit `1..20`, `limit + 1` lookahead, the 2,000-row projection ceiling, and existing resource/result/transfer byte ceilings. `EXISTS` eligibility does not return Offering JSON, witness IDs, or extra rows across the RPC boundary. Missing sentinels, malformed resources, hash or link drift, an unavailable required index, or any invoked reader failure fails the complete page closed.

### Envelope, cursor, and ordering

The normalized request, exact structured search plan, closed service envelope, query RPC parser, compositor, and both target readers carry the same nullable boolean stale value. Their canonical filter objects must agree exactly. Hostile shapes, accessors, proxies, inherited data, unknown keys, and type drift are rejected without effects.

ADR 0016 cursor version 1 already supports canonical boolean filters. The authenticated cursor records `stale` only when explicitly present. A cursor-only continuation inherits its authenticated filter set, matching the established provider/family cursor contract; explicitly adding or changing `stale` fails reconciliation before effects. Because omission is the canonical cursor-only continuation form, it is inheritance rather than removal. The exact-class/stable-ID tuple, repeated stable ID, query hash, limit, publication, original expiry, HMAC rotation, token ceiling, and absence of query text and witness data remain unchanged.

Stale filtering changes membership only. It does not alter exact-class precedence, raw-before-normalized precedence, stable-resource-ID order, display-name facts, result identity, semantic state, or full-publication cataloged-provider counts. A stale-qualified model card may therefore have a cataloged-provider count of zero because that count continues to include only distinct active, non-stale providers. This is factual consistency, not a contradiction or a signal to rewrite the card.

### Privacy and integration boundary

The filter, query, continuation, bookmark, witnesses, and database rows remain live-call-only. They are never stored, logged, traced, measured, cached, alerted on, echoed in errors, or copied into a correlation identifier. Any later query-string response is `private, no-store` and never enters Cache API.

This decision does not open `/v1/search`, change the current public handler, configure a remote resource or secret, provision or deploy infrastructure, or authorize visitor telemetry. Provider-name results remain absent under Offering-derived filters, and semantic work remains intentionally disabled for this exact-only Model/Variant slice.

## Consequences

- Exact Model/Variant search gains one complete explicit stale-Offering eligibility filter across both target classes.
- `stale=true` can discover an exact provider model ID whose matching Offering is stale without changing default search.
- Provider and stale qualification is exact-Offering applicable and cannot be assembled from unrelated witnesses.
- Model cards remain canonical and provider-neutral; only membership changes.
- Serving schema advances to `1.11.0` for one target-first eligibility index, while projection and publication formats remain unchanged.
- Status, observation time, normalized precision, currency, price, model, prefix/keyword, alias, semantic, public route, remote, and release work remain pending.

## Alternatives considered

- Treat absence as `stale=false`: rejected because it would silently add an Offering-existence predicate to unfiltered canonical-name search.
- Keep provider-model-ID matches permanently non-stale: rejected because explicit `stale=true` could not discover a stale exact provider ID.
- Let any matching provider Offering and any matching stale Offering jointly qualify: rejected because it violates exact Offering applicability.
- Require the provider-model-ID matching witness to belong to the selected provider: rejected because it would reverse ADR 0033's accepted target-level provider semantics.
- Include inactive Offerings when `stale=true`: rejected because active status and stale state are orthogonal and the status-filter contract remains separately unresolved.
- Scan the provider-first index without a provider: rejected because it cannot bound stale-only target eligibility by exact target.
- Add stale and status columns to the provider-model-ID projection: rejected because canonical Offering JSON is already the verified authority and a target-first index supplies the missing bounded access path.
- Change cursor version or sort tuple: rejected because the current cursor already authenticates booleans and the filter does not change order.

## Validation

- Prove absent, `true`, and `false` as three distinct states; reject malformed, duplicate, list, incompatible Provider, hostile-shape, and unsupported-filter inputs before effects.
- Prove default non-stale matching behavior, explicit fresh and stale matching witnesses, raw/normalized equality, inactive/unknown exclusion, and exact Offering/target contract, hash, link, publication, provider-model-ID, and stale agreement.
- Prove stale-only and provider-plus-stale target eligibility, same-witness provider/stale conjunction, cross-Offering false-positive rejection, both booleans on a multi-Offering target, family/record-type composition, and unknown-but-well-formed empty results.
- Prove both target classes filter before limit, Provider class exclusion, filter-aware higher-tier winner suppression, raw/normalized target deduplication, every-page traversal at limits 1 and 20, and no duplicate or omission.
- Prove schema `1.11.0` atomic migration, collision and rollback safety, exact target-first index shape, forced plans, switch-time failure, and restore compatibility from canonical inputs.
- Prove unchanged exact-class/stable-ID order, result facts, cataloged-provider counts, semantic degradation, cursor tuple, statement/result/byte ceilings, and neutrality under provider/Offering count, name, price, precision, affiliate, timestamp, and insertion permutations.
- Prove exact request/plan/envelope/RPC agreement, authenticated stale inheritance/add/change/tamper/rotation/expiry behavior, original-expiry preservation, static non-echoing failures, one resolver/RPC/Session, and at most four post-resolution SELECTs.
- Scan code, configuration, fixtures, and artifacts for DML, dynamic SQL, public routing, cookies, browser persistence, Cache API, `console.*`, logs, traces, metrics, analytics, telemetry, correlation IDs, raw query/filter echo, witness leakage, and visitor-derived durable keys.

## References

- [ADR 0029: Provider model ID exact reader](0029-provider-model-id-exact-reader.md)
- [ADR 0030: Composed exact search and compact cursor](0030-composed-exact-search-and-compact-cursor.md)
- [ADR 0033: Provider eligibility filtering](0033-provider-eligibility-filtering.md)
- [ADR 0034: Canonical family filtering](0034-canonical-family-filtering.md)
- [Phase 5N design contract](../design/phase-5n-stale-offering-filter.md)
