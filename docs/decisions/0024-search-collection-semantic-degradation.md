# ADR 0024: Make semantic degradation a search-collection invariant

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Staff engineer, API lead, search lead, security and privacy lead
- Related requirements: `API-004`, `API-010`, `API-014`, `API-016`, `API-017`, `SRCH-001`, `SRCH-003`, `SRCH-010`, `NFR-006`, `PRIV-006`, `QA-004`, `QA-005`
- Supersedes: None; resolves the empty-result contract blocker recorded by ADR 0023 and clarifies ADR 0016

## Context

ADR 0016 requires exact/structured fallback to expose semantic disablement, and the search design requires explicit degradation when semantic work cannot run completely. The initial public contract placed `semantic_degraded` on each `SearchResult`. That representation cannot communicate a search-wide condition when `data` is empty, and a client must not infer a missing semantic state from the absence of result items.

The public `/v1/search` route remains closed. This prelaunch contract correction must not be mistaken for complete exact/structured/semantic search, provider-only semantic applicability, merged cursor pagination, privacy approval for public query embeddings, or release authorization.

## Decision

### Authoritative collection state

Every `SearchCollection` requires `meta.semantic_degraded`, including an empty collection. The field is a non-null, bounded extensible string with no JSON Schema or application default. Producers must choose and serialize a state; omission does not imply `none`.

The known values have these exact meanings:

- `none`: the applicable semantic plan completed without degradation.
- `disabled`: applicable semantic work was intentionally not attempted because it is disabled by an approved runtime, privacy, legal, or cost-control decision; exact/structured discovery is the returned fallback.
- `eligibility_limit`: complete semantic eligibility exceeded an approved bounded plan, so semantic retrieval was not attempted over an incomplete subset and exact/structured discovery is the returned fallback.
- `temporarily_unavailable`: applicable semantic work could not complete because a semantic dependency failed transiently; partial semantic candidates were discarded while exact/structured discovery remained available.

`meta.semantic_degraded` is authoritative for the whole response. An empty result with `disabled`, `eligibility_limit`, or `temporarily_unavailable` means that the fallback completed and found no exact/structured records; it is not an implicit error and does not claim that semantic retrieval found no matches. If exact/structured fallback cannot safely satisfy the route, the API uses its bounded error contract rather than returning a misleading collection.

### Compatibility mirror and unknown tolerance

The existing required `SearchResult.semantic_degraded` remains in `/v1` as a compatibility mirror. Every producer must copy the exact collection value to every result, and contract semantics reject any item/collection mismatch. Consumers treat `meta.semantic_degraded` as authoritative.

Both locations use the same bounded extensible-string contract. Clients must recursively ignore additive unknown object fields and tolerate bounded unknown enum values in both collection metadata and result items. A future state therefore does not require a `/v2`, but removal of the result mirror or a semantic change still follows `API-017` through a new major version or the approved deprecation period.

This additive prelaunch correction does not change the OpenAPI version from `1.0.0`. It adds no default, and `none` is an explicit value rather than a default.

### Deferred applicability and transport

This ADR does not decide whether a provider-only search, which has no applicable model/variant semantic corpus, should use a future `not_applicable` state or another explicitly designed representation. It does not add `not_applicable` to the known values. That decision remains coupled to complete search composition and acceptance cases.

The merged public search cursor tuple also remains unresolved. This contract change neither issues nor consumes a cursor and does not alter the Phase 5D first-page-only RPC.

### Privacy and release boundary

The state describes a bounded execution outcome; it never contains or derives a durable visitor identifier. Search requests and responses remain `private, no-store`. Query text, filters, cursors, headers, bookmarks, source addresses, or navigation context may not enter application caches, logs, traces, metrics, analytics, alerts, fixtures derived from traffic, or durable storage.

The public request handler remains unchanged and unavailable for catalog search. This ADR enables no public query embedding, Workers AI or Vectorize query, cookie, browser persistence, telemetry, service binding, remote resource, deployment, provisioning, or Cloudflare configuration mutation.

## Consequences

- Empty exact/structured fallback can state semantic degradation unambiguously.
- Search-wide state has one authoritative location while the existing result field remains compatible within `/v1`.
- Producers must enforce collection/item equality and reject semantic result items under known fallback-only states; schema-valid but contradictory or partial output is not publishable.
- Future bounded degradation values remain additive, and clients must tolerate them recursively.
- Provider-only applicability, merged cursor pagination, complete search composition, public semantic processing, deployed runtime behavior, and release evidence remain pending.
- This is an implementation decision, not a PRD amendment. All related traceability statuses remain `Planned`.

## Alternatives considered

- Infer `disabled` when an empty response has no state: rejected because absence is ambiguous and does not distinguish successful semantic execution from fallback.
- Keep degradation only on each result: rejected because an empty collection has no result from which to recover a collection-wide condition.
- Remove the result field immediately: rejected because retaining an exact mirror is the smaller additive `/v1` change and avoids an unnecessary `API-017` compatibility question.
- Make the field optional with a default of `none`: rejected because defaults can conceal a missing producer decision or semantic failure.
- Add `not_applicable` for provider-only requests in this slice: rejected because provider-only semantic applicability belongs to the still-incomplete global search-composition decision.
- Return a `503` for every empty degraded fallback: rejected because an exact/structured fallback that safely completed with zero results is a valid search collection.

## Validation

- Validate an empty collection with each known state and reject omission, null, empty, and overlong values.
- Validate a bounded future state and publish the `API-016` client rule for recursive additive-field and bounded unknown-value tolerance; consumer-specific tolerance tests remain part of future client integration.
- Reject every non-empty collection whose result mirror differs from `meta.semantic_degraded`.
- Reject semantic `match_kind` results under `disabled`, `eligibility_limit`, and `temporarily_unavailable`.
- Validate the generated empty `disabled` OpenAPI example against `SearchCollection` while keeping OpenAPI at `1.0.0`.
- Constrain query-response `Cache-Control` to `private, no-store` in OpenAPI and verify that the generated example/schema contains no query echo, bookmark, request-correlation identifier, visitor-derived cache value, cookie, telemetry, or persistence field. Runtime enforcement remains a public-integration gate.
- Keep `/v1/search`, service bindings, semantic query processing, remote configuration, deployment, and every linked acceptance/release status closed or `Planned`.
