# Public API contract design

| Attribute | Value |
|---|---|
| Status | Approved design baseline; OpenAPI 3.1 generation is an implementation task |
| Base path | `/v1` |
| Parent design | [`system-design.md`](system-design.md) |
| Related requirements | `API-*`, `DATA-*`, `RULE-*`, `SRCH-*`, `SEC-001`, `SEC-007`, `QA-004`–`QA-005` |

## Protocol

- JSON uses UTF-8 and `application/json`; OpenAPI is JSON and YAML. GET and HEAD are resource methods, OPTIONS provides non-credentialed CORS, and every mutation method returns `405` with `Allow`.
- Every data response includes `X-QuantClarity-Publication`. Data responses include `ETag`; active-version responses include `Vary` only on validated representation dimensions. Public responses do not expose a retained request-correlation identifier.
- Clients must ignore additive fields and tolerate unknown enum values. A removed field or changed meaning requires `/v2` or at least six months of published deprecation.
- Unknown scalar facts are `null`; state-bearing fields use documented extensible enums. Zero is numeric string `"0"`, never null. Collections are always arrays.
- Decimal amounts are strings; timestamps are RFC 3339 UTC; IDs and slugs are strings.

## Resource routes

Every collection supports deterministic cursor pagination where meaningful; every detail resource has a stable ID route.

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
| `Metadata` | publication/dataset ID, schema version, API version, methodology version/effective date/URL, precision-vocabulary version, price-policy version, published time, next planned refresh window start/end, generated time, active provider/offering/model counts, degradation notices |

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
- Cursor payload: publication ID, resource, normalized filters, normalized sort list, last complete sort tuple, stable ID, issued-at, and expiry.
- Cursor is authenticated with HMAC-SHA-256, is opaque to clients, expires after 15 minutes, and is rejected if tampered, expired, or used with different parameters.
- Active and rollback-candidate snapshots remain hot for at least seven days, longer than every cursor TTL.

## Search query planning

`q` is required, trimmed Unicode, 1–200 bytes after normalization. Filter count is at most ten, response count 20, and no regex/wildcard syntax is accepted. One user semantic request may consume one unfiltered or at most eight filtered Vectorize query calls.

Vector grain is one document per canonical model or explicit variant per publication. No offering-derived duplication is allowed. Every `SRCH-004` filter has a complete D1 eligibility plan before semantic retrieval:

| Filter | Exact path | Semantic path |
|---|---|---|
| record type, exact model, family | D1 resource predicate | D1 emits eligible model IDs; scalar resource/model/family metadata may narrow Vectorize |
| provider, normalized precision, status | D1 offering/claim joins | D1 emits the complete eligible model-ID set |
| freshness/stale | D1 timestamp/stale predicate | D1 emits the complete eligible model-ID set |
| currency, price role/class/range | D1 exact-decimal price predicate | D1 emits the complete eligible model-ID set |

Eligible IDs are encoded into deterministic Vectorize `$in` batches below the 2,048-byte filter limit. A batch contains at most 40 prefixed UUID IDs including JSON/operator overhead, returns at most ten candidates, and the service merges at most 80 candidates by similarity and stable ID with one score per model. Limits are eight batches and 320 eligible IDs. If the complete set exceeds either, the API returns exact/structured results plus `semantic_degraded=eligibility_limit`; it never silently post-filters an incomplete top-K. Acceptance fixtures put valid records below unfiltered rank 50 and vary offerings-per-model to prove recall and provider-count neutrality.

## Publication-pinned caching

Validation and route-cost rate limiting run first. The edge Worker then asks the query service for the small active-head record before selecting any eligible data cache entry. Only path-only detail resources with a validated stable resource ID are cacheable. Their synthesized internal cache identity is:

```text
publication_id + resource_type + validated_stable_resource_id + representation
```

The public active URL is only a resolver; it is never copied into the cache object identity. The candidate pointer switch therefore creates a new cache namespace without relying on purge. Old HTML or JSON may still be served only when its request is explicitly pinned to that old publication. Free-text search, collections, filters, sorts, cursors, and every request containing a query string are `private, no-store` and never enter the application Cache API.

Astro SSR resolves one publication ID at request start, passes it to every API read, and embeds it as `data-publication-id` and page metadata. Client requests from that page pin to the embedded ID. If that publication has aged beyond hot retention, the API returns `409 publication_expired` with the current publication so the client can reload rather than mix versions. SSR HTML cache keys contain the publication ID; stale-while-revalidate never crosses a publication key. Chaos tests populate multiple PoPs, switch and roll back the pointer, and assert every rendered page/API sequence stays entirely on one version.

Suggested cache directives:

| Response | Browser/CDN policy |
|---|---|
| Immutable version-pinned detail | `public, max-age=60, s-maxage=86400, immutable` where URL/edge key includes version |
| Active path-only detail | browser `max-age=0, must-revalidate`; internal CDN cache by publication plus stable resource ID for 5 minutes |
| Collections, lists, filters, sorts, cursors, any query string | `private, no-store` |
| Metadata head | `no-store` to browsers; edge microcache at most 5 seconds only if the whole request remains pinned to the resolved value |
| Search | `private, no-store` to prevent verbatim query persistence |
| Errors/429 | `no-store` |

## Frontend-to-API internal request

The frontend Worker rate-limits and validates the original public request at its own ingress, then uses a service binding and an unrouted audience host. Its internal fetch signs a canonical envelope containing version, audience, environment, method, path, canonical query hash, issued-at, and expiry (30 seconds), but no source address or actor key. The API rejects internal fields on public-route requests, wrong audience/environment, clock skew/expiry, or signature mismatch. Secrets are environment-scoped, rotatable with overlapping current/next keys, and never logged. An identical captured envelope may replay only the same non-mutating read inside the short validity window; this bounded residual risk is accepted instead of adding state to the public edge. Tests cover cross-route, cross-environment, exact replay-window behavior, query alteration, expiry, and key rotation.

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
