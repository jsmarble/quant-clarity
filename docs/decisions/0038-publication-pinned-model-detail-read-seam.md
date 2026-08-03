# ADR 0038: Add a publication-pinned stable-ID Model detail read seam

- Status: Accepted
- Date: 2026-08-03
- Decision owners: Product owner, staff engineer, API lead, query lead, security and privacy lead
- Related requirements: `DATA-001`–`DATA-015`, `DATA-060`, `DATA-065`, `API-002`–`API-005`, `API-011`–`API-013`, `API-015`, `BE-003`, `BE-007`, `BE-011`, `NFR-002`, `SEC-001`, `SEC-007`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-006`, `QA-014`
- Extends: ADRs 0013, 0015, 0016, 0031, 0032, 0035, and 0036
- Supersedes: None

## Context

The selected-publication resolver, retained-hot rules, named API-to-query service binding, and canonical Model contract already exist. The remaining gap for a Model detail resource is a closed read that retrieves one exact canonical Model by stable ID without granting D1 to the API Worker or confusing search projections with canonical data.

The approved API design eventually supports `/v1/models/{model_id_or_slug}`. A stable Model ID is already a complete, immutable lookup key. A slug is not: the current Model resource exposes only its current slug Fact, while the approved design requires mutable slugs and historical resolution. No complete current-and-historical publication-scoped slug projection, collision policy, or redirect/read behavior exists. Scanning Model JSON by slug would be unbounded and could produce false negatives or inconsistent historical behavior.

The public request handler currently routes only metadata. This decision deliberately creates an unrouted reader and typed API/query seam first. It does not make the stable-ID subset public, exercise Cache API, or imply that the complete ID-or-slug route is ready.

## Decision

### Closed operation

Add one internal operation for an exact lowercase `mdl_` UUIDv4 and no other identifier form. The API-side adapter accepts an already normalized `GET` or `HEAD` detail request whose operation, route, resource type, stable ID, empty filters, default Model sort, empty query, null cursor, environment, and optional exact publication pin all agree. It rejects slugs, percent-encoded identifiers, Variants, collections, related Offerings, query strings, filters, caller-selected SQL, and extra or hostile fields before calling the resolver.

The operation returns the selected publication's canonical `Model` resource unchanged. It does not require the Model status Fact to be active, derive a Model Facts duplicate, join Offerings, alter `cataloged_provider_count`, or add provider, price, serving-precision, ranking, recommendation, or affiliate data. Unknown and unavailable Facts retain their canonical contract states.

The internal response is the existing `ModelDetail` contract:

```json
{
  "data": "<the exact canonical Model>",
  "meta": {
    "resource": "models",
    "publication_id": "<selected publication ID>",
    "schema_version": "<selected publication schema version>",
    "sort": ["name", "stable_id"],
    "filters": {}
  }
}
```

The metadata sort is the contract's canonical Model default and is not an instruction to order or mutate a detail resource.

### Publication selection and one fixed read

For fresh internal work, the API-side adapter computes the accepted `now + 15 minutes` availability horizon and calls `resolvePublicationV2` exactly once with the optional validated publication pin. It then calls one new typed `readModelDetailV1` method on the existing named `CatalogQueryService`, carrying only the closed audience/version, protected environment, selected publication ID, resolver bookmark, identical horizon, and canonical query-service envelope.

The query Worker opens one bookmark-continuous D1 Session and executes one fixed, parameter-bound, SELECT-only statement. The statement:

1. rechecks the exact selected publication against ADR 0031 retained-hot eligibility and the identical horizon;
2. requires the publication closure seal to agree with the immutable publication closure;
3. retrieves at most one `publication_resource` row through the existing exact `(publication_id, resource_type, resource_id)` lookup with literal resource type `model`; and
4. returns a bounded hot-publication sentinel plus the optional Model row so absence is distinguishable from publication-integrity failure.

The query result is treated as hostile. The reader checks exact row shape and byte counts, parses the JSON, validates the complete `Model` contract, requires inner and outer Model IDs to match the requested stable ID, and recomputes the publication-resource content hash from the exact resource type, ID, and JSON bytes. Wrong publication, wrong type, duplicate rows, malformed JSON, excess fields, invalid Facts, content-hash disagreement, missing sentinel, lifecycle or horizon disagreement, and unexpected output fail closed. A well-formed absent Model yields only the internal `not_found` outcome. D1 execution failure remains a static read failure. No error includes the Model ID, publication pin, bookmark, or database detail.

### Bounds and schema

The read performs one resolver call, one detail RPC, one D1 Session, and one fixed SELECT after resolution. The canonical table primary key and existing `publication_resource_lookup_idx` provide the required access path. No scan, pagination, FTS, Vectorize, provider-model-ID projection, model-name projection, or semantic call is permitted.

The reader enforces the existing 1,000,000-byte publication-resource ceiling before returning JSON. The API-side adapter separately enforces its injected representation ceiling after building and validating the complete `ModelDetail` value. It never truncates a Model, checkpoint, Fact, or evidence-ID array. Before a public route is authorized, controlled fixtures and load evidence must prove that every admitted Model detail representation fits the chosen public response, RPC, CPU, and latency ceilings; if the current 65,536-byte response ceiling is retained, publication admission must reject a candidate that would exceed it. Raising that public ceiling requires recorded performance and platform-limit evidence, not an implicit change in this reader.

Serving schema stays exactly `1.11.0`. This decision adds no table, column, index, migration, projection, readiness/switch proof field, backup input, restore step, publication hash field, or canonical entity. The immutable closure already commits the selected Model bytes, and ADR 0035 already validates Model-to-ModelFamily publication relationships before trust.

### Slug boundary

The public `/v1/models/{model_id_or_slug}` route remains wholly closed, including its stable-ID form. A later decision must derive a complete immutable publication-scoped projection for current Model slugs and retained `slug_history`, define collision and historical-resolution behavior, bind it to publication readiness and restore, and prove exact indexed lookup before the public handler may expose either form as the completed route. Runtime scans of canonical JSON, search-name projections, aliases, or redirect guesses may not substitute for that work.

### Cache, route, and privacy boundary

This decision invokes neither the public request handler nor Cache API. It creates no public `Response`, CORS behavior, ETag, internal cache object, browser/CDN policy, cache TTL, route allowlist change, remote resource, migration, provision, or deployment. The existing metadata route remains the only functional public data route.

The stable Model ID, publication pin, horizon, bookmark, canonical resource, and result remain transient call data. They are not logged, traced, measured, alerted on, cached, persisted, echoed in failures, or copied into a correlation identifier. No source address or transient limiter actor key enters the query envelope. Public Worker invocation logs/traces, Web Analytics, Analytics Engine request events, Tail/Logpush exports, and custom request telemetry remain disabled. The seam adds no cookies, browser persistence, analytics, beacon, request-derived cache key, or visitor-derived durable state.

## Consequences

- A future public Model detail handler can reuse a bounded canonical stable-ID read instead of inventing a route-time D1 or search-projection lookup.
- Active, rollback-candidate, and retained-hot publication pins receive the exact Model from the selected publication without fall-forward.
- Model facts remain canonical and provider-neutral; the operation does not create a second Model Facts entity.
- Serving schema, publication proofs, backup, and restore remain unchanged at `1.11.0`.
- Public ID/slug routing, current/historical slug storage, Cache API, conditional responses, response-size admission, remote configuration, deployment, and complete API conformance remain pending.

## Alternatives considered

- Open only the stable-ID public path now: rejected for this slice because the approved public route also promises slug behavior, and route/cache/response-size evidence is intentionally separate from the canonical reader.
- Scan `publication_resource.resource_json` by slug: rejected as unbounded and incomplete for historical slugs.
- Reuse the exact-name search projection as slug authority: rejected because search normalization, aliases, and names do not encode current-versus-historical slug semantics.
- Bind D1 to the API Worker: rejected because the named query service already supplies the accepted least-privilege boundary.
- Return only a compact Model subset: rejected because `API-002`, `API-003`, and the existing `ModelDetail` contract require the canonical resource, and silent truncation would create conflicting facts.
- Require known-active status: rejected because stable detail identifies the selected publication resource, including historical or inactive state; status is a returned Fact rather than a hidden existence predicate.
- Add a new serving projection or index for stable IDs: rejected because the canonical publication-resource primary key already supplies exact bounded lookup.

## Validation

Phase 5O-A local acceptance records the following bounded evidence:

- Prove exact lowercase Model stable IDs, GET/HEAD-only internal requests, empty query/filter/cursor state, canonical default meta, and rejection of slugs, Variant IDs, percent encoding, query strings, hostile objects, accessors, proxies, prototypes, symbols, and extra fields before effects.
- Prove active, rollback-candidate, retained-hot, unknown, never-public, insufficient-horizon, exact-cutoff, and switch-between-resolve-and-read behavior through resolver V2 and the identical bookmark/horizon.
- Prove one fixed SELECT-only statement, exact bind count/order, one Session, exact publication-resource index lookup, bounded sentinel plus zero-or-one resource, no DML/dynamic SQL, no FTS/Vectorize, and no canonical-resource scan.
- Prove found and not-found outcomes; inactive, unavailable, and unknown status visibility; wrong publication/ID; malformed JSON; duplicate/missing/oversized rows; content-hash drift; and static read/integrity failures.
- Prove complete canonical Model validation, selected publication/schema metadata, exact UTF-8 serialization, injected response-ceiling rejection without truncation, bounded hostile RPC-output rejection, and detachment from later upstream mutation.
- Prove schema `1.11.0`, the named binding topology, metadata behavior, and explicit stable-ID and slug route closures remain behaviorally unchanged.
- Scan code, configuration, fixtures, and artifacts for public route changes, Cache API, DML, cookies, browser persistence, logs, traces, metrics, analytics, telemetry, correlation IDs, request/header/source-address echo, bookmarks, and visitor-derived durable keys.

Before public routing, later acceptance must add explicit large-checkpoint and every-Fact-state fixtures, exact 1,000,000-byte reader-ceiling acceptance, closure-seal-drift failure injection, migration/readiness/switch/backup/restore identity inventories, controlled response/RPC/CPU/latency evidence, and the complete route/cache/CORS/ETag matrix.

## References

- [ADR 0013: Publication-consistent read transport](0013-publication-consistent-read-transport.md)
- [ADR 0016: Bounded local API read protocol](0016-bounded-local-api-read-protocol.md)
- [ADR 0031: Retained-hot publication continuity](0031-retained-hot-publication-continuity.md)
- [ADR 0032: Local named query-service binding](0032-local-named-query-service-binding.md)
- [ADR 0035: Canonical family/model/variant publication closure](0035-canonical-family-model-variant-publication-closure.md)
- [Phase 5O-A design contract](../design/phase-5o-a-model-detail-read-seam.md)
