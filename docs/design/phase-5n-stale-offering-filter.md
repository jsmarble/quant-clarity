# Phase 5N: Explicit stale Offering filter for composed exact search

## Status

Design is accepted under [ADR 0037](../decisions/0037-stale-offering-eligibility-filtering.md), and the closed internal slice is locally implemented and independently reviewed. Public and deployed release evidence remain pending. This boundary remains non-routable, deployment-neutral, and zero-visitor-data; no public-route requirement status advances from this slice alone.

## Slice objective

Add one complete explicit `stale=true|false` filter to composed exact Model/Variant search. The filter changes membership only, makes provider and stale predicates exact to one target-eligibility Offering, permits stale exact provider-model-ID discovery only when requested, preserves canonical facts and neutral order, and keeps `/v1/search` closed.

## Fixed behavior

- Accept no stale filter or one canonical boolean. Absence preserves current behavior and is not `false`.
- Explicit stale eligibility requires a canonical known-active Offering with the exact selected stale boolean and exact target.
- When provider is present, that same eligibility Offering must satisfy provider and stale.
- The provider-model-ID matching Offering remains separate from target eligibility, but an explicit stale filter changes its stale predicate to the selected boolean; absence retains active/non-stale matching.
- Permit stale with family, provider, and `record_type=model|variant`; reject `record_type=provider` with stale before effects.
- Skip the Provider-name class whenever stale is present.
- Apply canonical family, matching-Offering stale, and target Offering eligibility before limit, deduplication, and cross-tier winner suppression.
- Preserve exact class order, stable-resource-ID order, cursor tuple, canonical result facts, full-publication cataloged-provider counts, and `semantic_degraded=disabled`.
- Treat stale as selected-publication data. Do not recompute it from request time or provider-slice state.

## Witness model

`W_M` is the provider-model-ID Offering whose raw or normalized provider model ID matches the query. It must remain a contract-valid, hash-bound, known-active Offering for the exact selected publication and target. Without `stale`, it must be non-stale. With `stale=S`, it must have `stale===S`.

`W_E` is the target-eligibility Offering used by both canonical-name and provider-model-ID result classes. With explicit `stale=S`, it must be contract-valid, hash-bound, known-active, target the exact candidate, and have `stale===S`. If provider is present, `W_E.provider_id` must equal that provider. `W_M` and `W_E` may be different Offerings, preserving the accepted provider-A text/provider-B eligibility behavior, but provider and stale can never be split across two `W_E` witnesses.

Family is read from the canonical target and is not inferred from either Offering. Record type applies to the canonical target. Inactive, deleted, unavailable, and unknown-status Offerings remain out of scope even when stale is true.

## Storage and migration boundary

Serving migration `0014` advances exact schema `1.10.0` to `1.11.0` and adds:

```sql
CREATE INDEX publication_provider_model_id_target_eligibility_idx
ON publication_provider_model_id_search_document(
  publication_id,
  target_resource_type,
  target_resource_id,
  offering_id
);
```

The migration must reject dirty predecessors and same-name objects, validate the exact non-unique BINARY ascending index shape, prove forced queryability, and install a switch-time guard. Tests inject failure after every statement boundary and prove retryability. Restore/rebuild moves to the next versioned boundary and recreates the index from the existing canonical rebuild inputs.

The existing restore source profile `backup-v1-restore-source@2` and transcript
`serving-restore-rebuild@4` remain semantic commitments to schema `1.10.0`.
The schema `1.11.0` recovery boundary is versioned separately as source profile
`backup-v1-restore-source@3` and transcript `serving-restore-rebuild@5`. V5
reuses the same canonical source tables, provider-model-ID v4 reconstruction
proof, readiness and switch phase versions, closure facts, and excluded
derived-table policy; migration `0014` creates the new index and the switch
guard proves it.

No table, column, projection version, readiness suffix, closure field, backup payload, or canonical schema changes. The existing provider-first index remains used for provider-only and provider-plus-stale eligibility. The target-first index serves stale-only eligibility. Canonical Offering JSON remains the status/stale authority, and the complete projection retains its 2,000-row publication cap.

## Query and transport changes

Implementation adds nullable boolean stale state to:

1. normalized exact-search filters and plan;
2. authenticated cursor filters;
3. the closed query-service envelope and hostile RPC parser;
4. the composed search input;
5. canonical-name target eligibility; and
6. provider-model-ID matching and target eligibility.

Envelope and search-plan filters must be exact canonical matches. Cursor version 1 already supports boolean values; no cursor wire version or tuple changes. A cursor-only continuation inherits the original authenticated stale filter, while an explicitly added or changed stale value fails before query execution.

SQL remains a closed set of fixed SELECT-only variants. Stale-only eligibility forces the target-first index; provider-plus-stale forces the existing provider-first index. Every eligibility row joins the canonical Offering, verifies projection/version/content hashes and exact links, and checks known-active status plus exact stale equality inside the same `EXISTS`. No Offering or witness data crosses the query-service result.

The current ceilings remain: one resolver, one V2 merged RPC, one bookmark-continuous Session, at most four post-resolution SELECTs, limit `1..20`, `limit + 1` lookahead, 2,000 projection rows, and existing resource/result/transfer bytes. Any reader or integrity failure fails the page; there is no partial lower-tier success.

## Acceptance matrix

1. **Validation:** absent/true/false, exact lowercase URL values, duplicate/list/empty/invalid values, compatible filter conjunctions, Provider incompatibility, hostile accessors/proxies/prototypes/keys, and rejection before resolver/D1 effects.
2. **Matching witness:** absent and false require active/non-stale; true requires active/stale; inactive/unknown, wrong publication/target/provider-model-ID, malformed JSON, hash/link drift, and raw/normalized mismatch fail closed.
3. **Eligibility witness:** stale-only true/false; provider-plus-stale same-witness success; split provider/stale witness rejection; multiple same-target Offerings; wrong target/publication/provider/status/stale/hash/link exclusion.
4. **Composition:** stale with each Model/Variant record type, family, provider, and all compatible conjunctions; both target classes filter before limit; Provider class is skipped.
5. **Retrieval:** stale exact provider ID discovery, fresh exact provider ID discovery, raw/normalized collisions, canonical/provider-ID collision, filter-aware winner suppression, and target deduplication.
6. **Traversal:** first and later pages at limits 1 and 20, every class boundary, empty pages, no duplicate or omission, and unchanged class/stable-ID order.
7. **Schema:** atomic `1.10.0` to `1.11.0`, collision/rollback/retry, exact index shape/queryability, forced stale-only and provider-plus-stale plans, switch guard, and restore/rebuild parity.
8. **Protocol:** request/plan/envelope/RPC/read agreement, one resolver/RPC/Session, statement and byte ceilings, hostile RPC output, static errors, and no dynamic SQL.
9. **Cursor:** stale cursor-only inheritance, explicit add/change rejection, tamper, current/next key rotation, expiry/skew, publication/query/filter/sort/limit mismatch, original-expiry preservation, and no query, Offering, witness, display, or bookmark fields.
10. **Neutrality:** common-result facts, cataloged-provider count, semantic state, class, and order remain invariant under provider/Offering multiplicity, name, tier, region, price, precision, affiliate state, observation time, and insertion permutation.
11. **Privacy/security:** no route, DML, cookie, persistence, Cache API, log, trace, analytics, telemetry, correlation ID, filter/query echo, witness leakage, or visitor-derived durable key.

## Requirement handoff and nonclaims

- `DATA-066`, `DATA-067`, `SRCH-004`, `API-008`: contributes one explicit stale boolean filter over active Offering eligibility; it does not implement freshness ranges or inactive status.
- `SRCH-006`, `SRCH-008`, `API-003`: preserves selected-publication canonical Offering/target rehydration and default stale exclusion while allowing explicitly selected stale data.
- `FE-020`, `FE-023`, `FE-025`, `FE-026`, `RULE-017`, `API-009`: changes membership only; cards, provider counts, facts, and neutral order remain unchanged.
- `API-007`, `API-010`, `API-013`, `SEC-001`, `SEC-007`: preserves authenticated deterministic traversal, fixed bounds, and static fail-closed errors.
- `PRIV-006`, `PRIV-007`, `PRIV-011`: preserves transient no-store processing and no visitor telemetry; deployed privacy proof remains pending.
- `QA-004`, `QA-005`, `QA-013`, `QA-014`: local migration, filter, pagination, adversarial, neutrality, privacy, and Workers-runtime evidence is implemented and passing; complete public and deployed acceptance remains pending.

No public route, remote migration, service configuration, provisioning, deployment, requirement completion, or release evidence is claimed. Status, observation/update time, normalized precision, currency, price, model-filter semantics, alias, prefix/keyword, semantic retrieval and retention, public Request/Response wiring, load, and production acceptance remain pending.
