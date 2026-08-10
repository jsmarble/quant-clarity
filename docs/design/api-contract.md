# Public API contract design

| Attribute | Value |
|---|---|
| Status | Approved design baseline; OpenAPI 3.1 generation is an implementation task |
| Base path | `/v1` |
| Parent design | [`system-design.md`](system-design.md) |
| Related requirements | `API-*`, `DATA-*`, `RULE-*`, `SRCH-*`, `SEC-001`, `SEC-007`, `QA-004`–`QA-005` |

## Protocol

- JSON uses UTF-8 and `application/json`; OpenAPI is JSON and YAML. GET and HEAD are resource methods, OPTIONS provides non-credentialed CORS, and every mutation method returns `405` with `Allow`.
- Every data `GET` and `HEAD` accepts optional `If-None-Match` and `X-QuantClarity-Publication` request headers. Without the publication header or an authenticated cursor, the API resolves the active publication. A cursor implicitly pins its publication and must agree with the header when both are present. Every successful representation response (`200` or `304`) includes its strong `ETag`; redirects and errors do not. Every outcome with a truthful selected/current publication includes that publication and varies on the validated publication header and representation dimensions only. Public responses do not expose a retained request-correlation identifier.
- A malformed pin is rejected. An expired, insufficient-horizon, unavailable, unknown, or never-public pin returns the same generic `409 publication_expired` with the current publication header and no candidate-state detail. CORS allows exactly `If-None-Match` and the publication request header and exposes exactly `ETag` and the publication response header.
- Clients must ignore additive fields and tolerate unknown enum values. A removed field or changed meaning requires `/v2` or at least six months of published deprecation.
- Unknown scalar facts are `null`; state-bearing fields use documented extensible enums. Zero is numeric string `"0"`, never null. Collections are always arrays.
- Decimal amounts are strings; timestamps are RFC 3339 UTC; IDs and slugs are strings.

## Resource routes

Every collection supports deterministic cursor pagination where meaningful; every detail resource has a stable ID route.

### Phase 5O-A Model detail boundary

[ADR 0038](../decisions/0038-publication-pinned-model-detail-read-seam.md) defines an unrouted stable-ID Model detail reader and API/query adapter seam. The closed operation accepts only an exact lowercase `mdl_` UUIDv4, selects active or exact retained-hot publication state through resolver V2, continues from the resolver bookmark with the identical availability horizon, and returns the selected publication's unchanged canonical Model in the existing `ModelDetail` contract. It uses one fixed SELECT-only exact publication-resource lookup, recomputes the canonical resource hash, and validates the complete Model and envelope contracts. It does not filter by active status or join Offering facts.

This does **not** open any public Model path. `/v1/models/{model_id_or_slug}` remains wholly closed until a complete immutable publication-scoped projection covers both current canonical Model slugs and retained historical slug resolution, including collisions, readiness, and restore. Search names and aliases are not slug authority. Phase 5O-A also performs no Cache API, ETag, CORS, public response, remote binding, migration, or deployment work; serving schema stays `1.11.0`.

### Phase 5O-B1 Model slug projection boundary

[ADR 0039](../decisions/0039-publication-model-slug-projection-core.md) defines a pure, unrouted `model-slug@1` projector. It accepts one trusted immutable manifest, exact canonical Models whose current slug Facts are known, and caller-supplied Model `slug_history` for that publication. The publication boundary is derived exclusively from trusted `manifest.generatedAt`; there is no separate boundary input. Slugs are exact 1–128-character lowercase ASCII route values; no alias, search normalization, or inferred value is authority. Every begun assignment remains reserved to its Model, same-Model repetitions deduplicate, and a multi-Model collision or current-interval mismatch fails. Separate hashes bind the complete supplied history and the resolved current/historical mapping.

B1 does not authenticate that its caller supplied every canonical D1 history row, so it cannot gate readiness or answer a request. Phase 5O-B2 must add fixed canonical extraction or an archived authoritative input plus serving schema `1.12.0`, exact indexed storage, closure/readiness/switch proofs, and backup/restore. `/v1/models/{model_id_or_slug}`, query RPC, Cache API, CORS/ETag handling, and remote deployment remain closed. [ADR 0044](../decisions/0044-public-model-detail-http-cache.md) later resolves B3: stable IDs, current slugs, and explicitly pinned historical slugs return the same canonical `200`, while unpinned historical slugs redirect with a bodyless `308` to the verified stable-ID path.

### Phase 5O-B2A canonical Model slug capture boundary

[ADR 0040](../decisions/0040-canonical-model-slug-history-capture.md) fixes the controlled acquisition prerequisite without adding an API operation. While one canonical single-writer drain remains continuously held from trusted manifest/resource assembly through acquisition, the pipeline requires canonical capability `model-slug-history-guard@1` and reads exactly that manifest's Model IDs, canonical current slugs, and boundary-adjusted history in one fixed `first-primary` statement. It proves trusted-resource/canonical-current/history agreement and derives unchanged `model-slug@1` roots and mappings. The candidate capture also carries a private D1 bookmark that is never part of a public contract or response.

B2A is not readiness authority. B2B must first write and read-verify an immutable content-addressed private R2 artifact and stage serving schema `1.12.0`; B2C must bind it to lifecycle/backup/restore and add an internal indexed lookup. `/v1/models/{model_id_or_slug}` therefore remains closed, and Phase 5O-B3 still owns redirect-versus-direct-read and HTTP/cache semantics.

### Phase 5O-B2B private archive and staging boundary

[ADR 0041](../decisions/0041-model-slug-sidecar-archive-and-staging.md) defines a private `model-slug-history-artifact@1` sidecar bound to the existing base publication bundle. It contains the exact controlled current-slug census, boundary history, and projection roots/counts, never the private D1 bookmark or visitor data. A conditional create-only R2 write becomes authority only after bounded exact readback, independent digest verification, closed decoding, and `model-slug@1` replay against the separately trusted base bundle reproduce every mapping and proof.

Serving schema `1.12.0` is a dormant staging boundary only. Its immutable proof and exact publication-plus-slug mapping rows add no query RPC or public operation and do not authorize readiness, sealing, switching, rollback, or cache use. B2C-A/C locally own schema `1.13.0` lifecycle and indexed-read authority; proposed ADR 0045 would require product-owner-approved schema `1.14.0` lifecycle-v6 three-artifact restore authority before routing. B3 still owns redirect-versus-direct-read and HTTP semantics. The public `/v1/models/{model_id_or_slug}` route remains closed.

### Phase 5O-B2C-C internal Model slug read boundary

[ADR 0042](../decisions/0042-model-slug-lifecycle-authority.md) and [Phase 5O-B2C-C](phase-5o-b2c-c-model-slug-internal-read.md) define additive `readModelDetailV2`. One closed lookup discriminates an exact lowercase Model stable ID from a strict 1–128-character lowercase ASCII slug. Relative to a resolver-V2-selected publication, the query Worker uses one bookmark-continuous Session and one fixed SELECT to require the immutable closure and staged artifact proof, force the exact-slug and current-Model indexes, validate the selected mapping/resource/hash/current-slug path, and return the unchanged canonical Model with `stable_id`, `current_slug`, or `historical_slug` provenance. The returned canonical slug comes from the verified current mapping; the historical submitted slug is never returned.

This operation remains internal and unrouted. The V1 stable-ID operation stays compatible, and the public handler, OpenAPI, Cache API, CORS, ETag, redirect/direct-response decision, remote configuration, and deployment remain unchanged. Phase 5O-B3 owns those public semantics and their load/conformance evidence.

### Phase 5O-B3 public Model HTTP/cache boundary

[ADR 0044](../decisions/0044-public-model-detail-http-cache.md) and [Phase 5O-B3](phase-5o-b3-model-detail-http-cache.md) fix the implementation boundary before routing. Stable IDs, current slugs, and explicitly pinned historical slugs return byte-identical canonical `ModelDetail` JSON; unpinned historical slugs return a bodyless relative `308` to the verified stable-ID path. Only a query-free stable-ID request may use the manual Cache API, under a publication-qualified canonical key after validation, transient limiting, and resolver V2. Public-gateway pre-invocation Workers Caching remains explicitly disabled. A pre-open audit must prove every currently serveable publication fits the 65,536-byte Model-detail ceiling, and the only activation/rollback head-mutation path must repeat that exact guard for every future target. Implementation, remote/load evidence, production configuration, deployment, and release acceptance remain pending.

| Resource | Collection | Detail / related routes |
|---|---|---|
| Models | `GET /models` | `GET /models/{model_id_or_slug}`, `GET /models/{id}/offerings` |
| Variants | `GET /variants` | `GET /variants/{variant_id_or_slug}`, `GET /variants/{id}/offerings` |
| Model families | `GET /model-families` | `GET /model-families/{family_id_or_slug}` |
| Providers | `GET /providers` | `GET /providers/{provider_id_or_slug}`, `GET /providers/{id}/offerings` |
| Offerings | `GET /offerings` | `GET /offerings/{offering_id}` |
| Prices | `GET /prices` | `GET /prices/{price_id}` |
| Precision observations | `GET /precision-observations` | `GET /precision-observations/{precision_id}` |
| Evidence summaries | `GET /evidence` | `GET /evidence/{evidence_id}` |
| Search | `GET /search` | none |
| Dataset metadata | `GET /metadata` | `GET /methodologies/{version}` |
| Contract | `GET /openapi.json`, `GET /openapi.yaml` | human docs at `/docs` on the site |

`Model Facts` and `Offering Facts` are response projections assembled from these resources. They are not addressable canonical resource types.

The exact methodology-detail route is metadata-only and functional only for registered versions in local/test. Bounded request and header validation first performs exact own-key registry-existence validation and records the environment decision in a withheld plan; it retains the validated version, not a live registry entry. The limiter settles before any planned response is released. Unregistered GET/HEAD/OPTIONS and every preview/production methodology request then return fixed `404` without resolver or query RPC, while registered local/test OPTIONS returns fixed preflight without either operation. Registered local/test GET and HEAD use resolver V2 followed by exactly one dedicated bookmark-continuous `readMethodologyContextV1` SELECT-only operation. The context method validates the already-registered version as part of the closed methodology envelope but does not consult the registry or bind its version to SQL; it returns only selected publication ID, schema version, and the query Worker's protected exact API origin. During post-resolver encoding, a fresh exact own-key lookup revalidates the immutable registry entry before representation construction. No raw visitor material enters the method. Every methodology outcome, including successful `200`/`304`, uses `private, no-store`; successful responses retain the generated methodology-specific publication `Vary`. Cache API is never used. The JSON does not duplicate the human-readable methodology body or material-change log.

## Common shapes

Collection envelope:

```json
{
  "data": [],
  "page": {
    "next_cursor": null,
    "limit": 25
  },
  "meta": {
    "publication_id": "pub_...",
    "schema_version": "1.0.0",
    "sort": ["display_name", "id"],
    "filters": {}
  }
}
```

Search collections additionally require `meta.semantic_degraded`. It is the authoritative response-wide state and has no default. Known values are `none` when the applicable semantic plan completed without degradation, `disabled` when applicable semantic work was intentionally not attempted and exact/structured discovery is the fallback, `eligibility_limit` when complete eligibility exceeded the bounded semantic plan and no incomplete semantic subset was queried, `temporarily_unavailable` when a semantic dependency failed transiently, partial semantic candidates were discarded, and exact/structured discovery is the fallback, and `not_applicable` when an explicit provider-only request has no applicable Provider semantic corpus. The existing `SearchResult.semantic_degraded` remains a required `/v1` compatibility mirror and must equal the metadata value for every item. Known fallback-only states cannot contain a `semantic` match kind. Untyped and Model/Variant exact-only fallback uses `disabled` while applicable semantic work is intentionally off; ADR 0030 limits `not_applicable` to explicit `record_type=provider` composition.

An empty degraded collection means exact/structured fallback completed with no matching records; it does not claim that semantic retrieval found no matches. If exact/structured fallback cannot safely satisfy the request, the API returns its bounded error rather than a misleading collection. Both locations use the same bounded extensible-string contract. Clients recursively ignore additive unknown fields and tolerate bounded unknown enum values. There is no implicit `none`, and the prelaunch additive correction does not change OpenAPI version `1.0.0`. ADR 0030 resolves explicit provider-only exact composition as `not_applicable`; applicability for future resource classes must still be designed explicitly.

```json
{
  "data": [],
  "page": {
    "next_cursor": null,
    "limit": 20
  },
  "meta": {
    "resource": "search",
    "publication_id": "pub_00000000-0000-4000-8000-000000000001",
    "schema_version": "1.0.0",
    "sort": ["relevance", "stable_id"],
    "filters": {},
    "semantic_degraded": "disabled"
  }
}
```

Detail envelope uses the same `meta` and a single object in `data`. Offering-bearing responses also include the exact active neutral sort and filters; they never contain a recommendation, winner, score, rank, or affiliate commission value.

Evidence summary:

```json
{
  "evidence_id": "evd_...",
  "field": "serving_precision",
  "value": "FP8",
  "source_type": "provider_api",
  "source_owner": "Provider name",
  "source_url": "https://public.example/path",
  "authenticated_only": false,
  "observed_at": "2026-08-01T00:00:00.000Z",
  "extraction_method": "deterministic_json",
  "extraction_version": "adapter@1.0.0",
  "integrity_hash": "sha256:..."
}
```

Private R2 keys, prompts, raw authenticated payloads, source credentials, account identifiers, and unrelated excerpts are never public fields.

### Normative resource fields

Every evidence-backed public scalar uses `Fact<T>`:

```text
Fact<T> = { state, value, observed_at, evidence_ids[] }
state = known | unknown | not_applicable | unavailable
known => value non-null, observed_at non-null, evidence_ids non-empty
otherwise => value null; zero is the decimal string "0"
```

IDs, resource type, publication ID, and relationship IDs are structural fields; every non-null factual field below is a `Fact<T>` or has the same observation/evidence members. Additive unknown enum values remain displayable as `other` with the raw label.

| Shape | Required public fields |
|---|---|
| `ModelFamily` | `family_id`, `slug`, `display_name`, publisher fact, model IDs, `last_model_data_refresh` |
| `Model` | `model_id`, `family_id`, `slug`, `display_name`, publisher, release date, modalities, context window, output limit, license, architecture, total parameters, active parameters, authoritative checkpoint IDs, source-format/quantization facts, status, `cataloged_provider_count`, `last_model_data_refresh` |
| `Variant` | `variant_id`, `model_id`, `family_id`, `slug`, `display_name`, variant kind/selection evidence, publisher, parameter/source-format facts, checkpoint IDs, status, provider count, refresh time |
| `Provider` | `provider_id`, `slug`, `display_name`, official site, status, supported active offering count, known/unknown serving-precision counts and proportions, last successful refresh, affiliate relationship present boolean (no commission/program data) |
| `Offering` | `offering_id`, `provider_id`, model/variant target ID, exact provider model ID, tier, endpoint class, material region, status, stale boolean/reason, first/last observation, precision observation IDs, price IDs, evidence IDs |
| `Price` | `price_id`, `offering_id`, role, price class, `amount_decimal`, currency, currency provenance, unit, conditions, `is_standard_comparable`, effective interval, observed time, evidence IDs |
| `PrecisionObservation` | `precision_id`, `offering_id`, normalized format, summary format, raw field/value/definition, optional format variant, component facts, exact applicability tuple, observed time, evidence IDs |
| `EvidenceSummary` | the evidence summary shape above, plus subject resource ID and applicability-safe field name; never private payload/key |
| `Metadata` | selected publication/dataset ID, schema version, API version, methodology version/effective date/URL, independent precision-normalization and precision-display-order versions, price-policy version, immutable first-publication time, next planned refresh window start/end, generated time, active provider/offering/model counts, degradation notices |
| `Methodology` | methodology version, effective time, and stable human-readable methodology URL; this versioned policy metadata is not a duplicate canonical fact entity |

`total_parameters` and `active_parameters` include raw value, normalized decimal string, and `exact|approximate|unknown`. Checkpoint relationships expose publisher organization, repository/artifact URL and ID, revision/commit, publication date, declared weight format, quantization, file/checkpoint format, role, and evidenced lineage edges. Model Facts projects only model/variant/checkpoint fields. Offering Facts projects the exact offering scope, serving/component precision, three independent price roles, status/freshness, observations, and evidence. Neither view duplicates canonical entities.

## Filters and sorts

Unknown parameters are rejected. Multiple values are comma-separated only for allowlisted enum/ID filters and count toward the maximum of ten total filter values.

| Collection | Filters | Sorts |
|---|---|---|
| Models/variants | family, publisher, provider eligibility, normalized source precision, status, stale-offering eligibility, updated since | name, release date, model refresh, stable ID |
| Providers | status, updated since | display name, refresh, stable ID |
| Offerings | model/variant/family, provider, normalized precision, currency, status, stale, observed since, tier, endpoint class, material region, price class | provider, precision display label, input/output/cached-input standard price, freshness, status, stable ID |
| Prices | offering, model, provider, role, currency, price class, standard comparable, promotional, effective/observed since | amount within one currency, observed time, stable ID |
| Precision observations | offering, model, provider, normalized format, component, observed since | display label, observed time, stable ID |
| Evidence | entity, field, source type, source owner, observed since | observed time, stable ID |

Default model ordering is active search/browse ordering independent of provider eligibility. Default offering ordering is provider display name ascending then offering ID ascending.

Numeric price sort requires exactly one currency scope. If omitted and matching USD records exist, scope is USD. Otherwise use the first matching ISO currency in ascending code order and return it visibly in `meta.filters.currency`. Only `is_standard_comparable=true` records participate in default price sorts. Conditional or promotional classes enter only when the caller explicitly selects them. No currencies are converted or interleaved.

Precision sort uses the public versioned organizational display order and exact labels. Mixed, other, and unknown remain separate buckets. BF16 and FP16 are never documented as a universal quality order.

## Pagination and cursors

- Default limit 25; maximum 100. Search returns at most 20 public results. An unfiltered semantic request makes one Vectorize call with at most 50 candidates; a filtered request makes at most eight calls returning ten candidates each, for at most 80 aggregate candidates before merge.
- Cursor payload: the fixed-order ADR 0016 version and key ID, publication ID, resource, normalized query hash and filters, normalized sort list, immutable page limit, last complete sort tuple, stable ID, issued-at, and expiry.
- Cursor text is NFC-normalized before canonical comparison. The cursor is authenticated with HMAC-SHA-256 current/next overlap keys, is opaque to clients, expires after at most 15 minutes, and is rejected if tampered, expired, or used with different parameters or a different page limit.
- Active and current rollback-candidate snapshots are always eligible. Every other requested D1 publication is retained exactly seven days from its latest immutable departure from either head slot. A fresh request requires availability through `now + 15 minutes`; a cursor continuation requires availability through its original authenticated expiry. The historical cutoff must be strictly greater than the required horizon plus the 30-second skew allowance. Retained references outside the nonnegative through D1-time-plus-five-minutes switch-guard interval fail closed; SQL uses the algebraically equivalent subtraction-form threshold so an invalid stored timestamp cannot overflow cutoff addition.

For the ADR 0030 exact-only composition seam, the two search sort-tuple scalars are a closed `exact-v1` class marker and the globally prefixed stable resource ID. This is the complete actual order: exact class followed by stable ID, with no hidden display-name key. Display text, raw provider model IDs, query text, and bookmarks never enter the cursor. Accepted follow-on designs add one canonical provider eligibility ID, one canonical family ID, and one explicit stale boolean while preserving only `relevance,stable_id`; a global stable-ID-only order across relevance classes remains closed before public routing. ADR 0031 defines the V2 retained-hot D1 resolver/read horizon across repeated switches; it does not itself open the public route.

### Explicit stale Offering eligibility

[ADR 0037](../decisions/0037-stale-offering-eligibility-filtering.md) defines the locally implemented exact-only `stale=true|false` behavior. Absence preserves the existing corpus. An explicit value requires a known-active canonical Offering for the target whose immutable publication-time `stale` boolean equals the request. When `provider` is also present, that same target-eligibility Offering must satisfy both provider and stale; predicates from two Offerings cannot be combined.

The provider-model-ID class retains a separate matching Offering. An explicit stale filter applies the selected boolean to that matching Offering, while absence retains active/non-stale matching. This permits stale exact IDs only when requested without reversing the independent provider-eligibility semantics. Family and Model/Variant record type remain target predicates, Provider results are inapplicable, and inactive/status and observation-time behavior remain deferred.

The normalized request, search plan, service envelope, query input, and cursor carry the same nullable boolean. Cursor version and sort tuple do not change. A cursor-only continuation omits request filters and inherits the cursor's authenticated stale value; explicitly adding or changing stale is invalid. All query-string responses remain `private, no-store`.

## Search query planning

`q` is required, trimmed and NFC-normalized Unicode, 1–200 UTF-8 bytes after normalization. Filter count is at most ten, response count 20, and no regex/wildcard syntax is accepted. One user semantic request may consume one unfiltered or at most eight filtered Vectorize query calls.

Vector grain is one document per canonical model or explicit variant per publication. No offering-derived duplication is allowed. Every `SRCH-004` filter has a complete D1 eligibility plan before semantic retrieval:

| Filter | Exact path | Semantic path |
|---|---|---|
| record type, exact model, family | D1 resource predicate | D1 emits eligible model IDs; scalar resource/model/family metadata may narrow Vectorize |
| provider, normalized precision, status | D1 offering/claim joins | D1 emits the complete eligible model-ID set |
| freshness/stale | D1 timestamp/stale predicate | D1 emits the complete eligible model-ID set |
| currency, price role/class/range | D1 exact-decimal price predicate | D1 emits the complete eligible model-ID set |

Eligible IDs are encoded into deterministic Vectorize `$in` batches below the 2,048-byte filter limit. A batch contains at most 40 prefixed UUID IDs including JSON/operator overhead, returns at most ten candidates, and the service merges at most 80 by similarity and stable ID with one score per model. Limits are eight batches and 320 eligible IDs. If the complete set exceeds either, the API returns exact/structured results with `SearchCollection.meta.semantic_degraded=eligibility_limit`; it never silently post-filters an incomplete top-K. Acceptance fixtures put valid records below unfiltered rank 50 and vary offerings-per-model to prove recall and provider-count neutrality.

## Publication-pinned caching

Validation and route-cost rate limiting run first. The edge Worker then asks the query service for the small active-head record before selecting any eligible data cache entry. Only path-only detail resources with a validated stable resource ID are cacheable. Their synthesized internal cache identity is:

```text
publication_id + resource_type + validated_stable_resource_id + representation
```

The public active URL is only a resolver; it is never copied into the cache object identity. The candidate pointer switch therefore creates a new cache namespace without relying on purge. Old HTML or JSON may still be served only when its request is explicitly pinned to that old publication. Free-text search, collections, filters, sorts, cursors, and every request containing a query string are `private, no-store` and never enter the application Cache API. The internal Cache API key is a synthesized same-origin, non-routable reserved path at a fixed environment-owned trusted HTTPS origin. It contains only cache-format version, validated publication ID, resource type, validated canonical stable resource ID, and representation. It never derives its origin from the request and never contains the raw URL, slug, query, cursor, request headers, or source-address material.

Astro SSR resolves one publication ID at request start, passes it to every API read, and embeds it as `data-publication-id` and page metadata. Client requests from that page pin to the embedded ID. If that publication has aged beyond hot retention, the API returns `409 publication_expired` with the current publication so the client can reload rather than mix versions. SSR HTML cache keys contain the publication ID; stale-while-revalidate never crosses a publication key. Chaos tests populate multiple PoPs, switch and roll back the pointer, and assert every rendered page/API sequence stays entirely on one version.

Suggested cache directives:

| Response | Browser/CDN policy |
|---|---|
| Stable-ID path-only detail | `private, max-age=0, must-revalidate`; internal Cache API by publication plus stable resource ID for 5 minutes |
| Current-slug detail | `private, no-store`; no Cache API |
| Unpinned historical redirect or explicitly pinned historical detail | `private, no-store`; no Cache API |
| Collections, lists, filters, sorts, cursors, any query string | `private, no-store` |
| Metadata | `private, no-store`; strong representation ETag only, with no Cache API or edge microcache |
| Search | `private, no-store` to prevent verbatim query persistence |
| Errors/429 | `private, no-store` |

ADR 0013 selects the optional `X-QuantClarity-Publication` header rather than a query parameter or duplicate publication-prefixed route tree. Public immutable versioned URLs remain deferred; safe application caching uses only the synthesized internal key above. The validated header value is public canonical state and is not visitor identity or telemetry.

The query service resolves the active or requested hot publication through one D1 Session and returns its opaque bookmark with the head result. Resolver V2 receives only a safe-integer `requiredAvailableUntilMs`: `now + 15 minutes` for fresh work or the authenticated cursor's original expiry for continuation. It selects the current active/current rollback publication, or a historical publication whose later indexed departure from the active or rollback slot yields a seven-day cutoff strictly beyond that horizon plus 30 seconds. The same horizon enters merged-read V2 and every exact-reader publication sentinel on the bookmarked-or-newer snapshot. Resolver V1 remains compatibility-only and recognizes just the current pair. If the API misses its publication-qualified cache entry, its typed data call resumes from that bookmark so another replica cannot be older than the head already observed. The bookmark and horizon remain inside the live API-to-query call chain and are never returned, logged, traced, metered, alerted, cached, or stored. A single head-joined query is an allowed equivalent.

Phase 5O-A reuses that continuity contract for its internal Model stable-ID read but intentionally stops before cache lookup or public routing. Its reader accepts the existing 1,000,000-byte canonical resource ceiling and its API adapter separately enforces the injected representation ceiling without truncation. A later public-route decision must supply publication-admission or controlled load/platform evidence showing every admitted `ModelDetail` representation fits the selected response, RPC, CPU, and latency limits.

ADR 0044 selects the existing 65,536-byte public ceiling. Before route opening, B3 audits every Model in every currently serveable publication. Thereafter, the only activation/rollback head-mutation path serializes every target Model's exact `ModelDetail` envelope and rejects any target with an oversized representation before mutation; recovery/rebuild targets pass the same guard before they can serve. Runtime overflow after that admission is a publication-integrity failure, never a truncated response or a request-size `413`.

## Frontend-to-API internal request

The frontend Worker rate-limits and validates the original public request at its own ingress, then uses a service binding and an unrouted audience host. Its internal fetch signs a canonical envelope containing version, audience, environment, method, path, canonical query hash, optional validated publication pin, issued-at, and expiry (30 seconds), but no source address or actor key. The API rejects internal fields on public-route requests, wrong audience/environment, clock skew/expiry, pin alteration, or signature mismatch. Secrets are environment-scoped, rotatable with overlapping current/next keys, and never logged. An identical captured envelope may replay only the same non-mutating read inside the short validity window; this bounded residual risk is accepted instead of adding state to the public edge. Tests cover cross-route, cross-environment, exact replay-window behavior, query or pin alteration, expiry, and key rotation.

## Errors and status codes

```json
{
  "error": {
    "code": "invalid_parameter",
    "message": "The request contains an invalid parameter.",
    "details": [{ "parameter": "limit", "reason": "maximum is 100" }]
  }
}
```

| Status | Stable codes |
|---|---|
| 400 | `invalid_parameter`, `invalid_cursor`, `unsupported_filter`, `currency_scope_required` |
| 404 | `resource_not_found` |
| 405 | `method_not_allowed` |
| 409 | `publication_expired` |
| 413 | `query_too_large`, `response_limit_exceeded` |
| 429 | `rate_limited`, with `Retry-After` |
| 500 | `internal_error` without stack/configuration |
| 503 | `publication_not_ready`, `search_degraded`, `temporarily_unavailable` where exact fallback cannot satisfy the route |

## Telemetry and privacy

Automatic invocation logs, traces, Tail Worker/Logpush export, Analytics Engine request events, Web Analytics, and custom events/spans are disabled Worker-wide for the frontend, public API, and query Workers. They produce no live-request logs, metrics, request counters, correlation IDs, error events, or security datasets. Source-address keys exist only in request memory and the Cloudflare rate-limiting facility. CI and deployed tests prove those sinks and bindings are absent, crawl success and failure paths for cookies/browser storage/beacons, and search every allowed control-plane sink for seeded visitor canaries. Public query embeddings remain disabled until current Workers AI processor, retention, and training terms receive privacy/legal approval; exact and structured search are the fallback.
