# Phase 5U: Publication-pinned local Model Facts

| Attribute | Value |
|---|---|
| Status | Implementation in progress; shared identity/path and `ModelDetail` contract boundary complete; no public Model API route or remote authority |
| Decision | [ADR 0052](../decisions/0052-publication-pinned-frontend-model-detail.md) |
| Requirements | `FE-030`, `FE-031`, `FE-060`, `FE-061`, `API-003`, `API-004`, `API-005`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-009` |

## Objective

Replace the fixed local Model-page `404` with one server-rendered canonical Model Facts slice over the existing V2 Model-detail authority. The frontend pins the detail read to its canonical metadata publication and sends no visitor identity across the service binding. Public API Model routing, Variants, offerings, preview, production, and deployment remain closed.

## Implemented prerequisite boundary

The contracts package now exports the static `ModelDetail` type and one closed Worker-safe `checkModelDetailContract` guard. A 65,536-node/32-depth acyclic JSON-data snapshot copies every outer, metadata, Model, Fact, checkpoint, and lineage property through own enumerable data descriptors before validation; accessors are rejected without invocation, proxy `get` traps are not used, symbol keys and non-JSON values fail closed, and reflection-trap failures are caught. The guard then requires exact outer and metadata keys, delegates the complete canonical Model validation, and fixes resource, publication-ID, schema-version, empty-filter, and `name`/`stable_id` sort semantics.

The API core now owns the exact Model stable-ID/strict-slug classifier, 128-character ASCII slug ceiling, canonical `/v1/models/{identifier}` builder, and single-segment API-path parser. It performs no decoding, coercion, Unicode normalization, or case folding. The existing B3 request planner consumes the shared classifier/parser instead of maintaining a second regex boundary, while preserving its established response status and effect-free behavior. The Worker receives the platform-normalized `Request.url`; original request-target alias rejection cannot be established at this layer and remains pending at the raw frontend/ingress acceptance boundary.

Unit tests cover stable IDs, boundary-length slugs, malformed UUID versions/variants/case, punctuation, Unicode, percent encodings that remain visible after platform parsing, extra/trailing segments, query-bearing paths, exact path construction, frozen classification results, complete Model-detail envelopes, additive/wrong metadata, invalid canonical Models, nested accessors/proxy gets/symbol and `__proto__` keys, and hostile outer accessors. This increment opens no route, creates no service call, and changes no cache, binding, environment, or successful response behavior.

## Implementation boundary

The frontend first obtains the existing ADR 0051 publication snapshot. Only a published snapshot may authorize one additional query-free signed `GET` to the unrouted internal Model path. The selected publication ID is mandatory in the canonical signature and API publication header. The public frontend's two transient limiter buckets are the only visitor-derived admission; the new request is reconstructed from protected and validated public-data identity alone.

The raw frontend route must be exactly one stable-ID-or-strict-slug segment. Encoded aliases or separators, case-folded IDs, invalid UTF-8, empty/additional segments, and trailing-slash aliases do not call Model detail. A frontend query never enters or changes the signed request or rendered facts; the response remains `private, no-store` and the canonical URL omits it.

The API must factor the existing Model-detail flow into authenticated admission and a shared post-admission executor. The internal path authenticates the exact local environment/method/path/query/pin tuple before any source-address capability is read. The future direct public path retains ADR 0044's independent limiter-before-cache ordering but remains unrouted in this phase. Rejected internal tuples produce static `404` with no resolver, Cache API, or query effect.

The executor keeps the existing resolver V2 horizon, publication-pinned V2 lookup, exact-byte response, response-size admission, ETag calculation, and stable-ID-only protected manual-cache key. No visitor, authentication, public-host, slug, or query material enters that key or the query envelope.

## Frontend response matrix

| Condition | Frontend result |
|---|---|
| Stable ID or current slug, exact selected publication | SSR `200` Model Facts |
| Historical slug, exact selected publication | bodyless `308` to `/models/{stable-model-id}` after validated pinned `200` with a known canonical slug Fact |
| Initial metadata snapshot is `not_published` | accessible `404` without a detail call |
| Exact publication-bound canonical not found after a published snapshot | accessible `404` only for the complete expected status/header/body matrix |
| Publication expiry/race | generic `503`; never fall forward |
| Timeout, signature, dependency, encoding, media-type, size, header, contract, or publication mismatch | generic `503` |
| Any `304` or `308` from the pinned internal API channel | generic `503` contract failure |

The client uses a 500-millisecond whole-operation deadline, no retry, no conditional request, fatal UTF-8 decoding, an exact 65,536-byte ceiling, strict JSON media type, the closed `ModelDetail` contract, and exact response-publication equality. Only an exact publication-bound Model-detail `404` with the complete expected status/header/body matrix is not found; generic or publication-free closure/authentication `404`s are unavailable. A published metadata snapshot followed by `publication_not_ready` is a race and therefore unavailable. Model pages perform at most the existing metadata call plus one detail call.

## Model Facts representation

The SSR page exposes the canonical Model's identity and slug, publisher, architecture, parameter facts, checkpoints, source formats and quantization, context/output limits, modalities, release date, license, lifecycle status, cataloged-provider count, evidence references, observation times, and refresh fact. Every canonical Fact state remains explicit and no unknown value is inferred.

The summary contains no provider names, provider prices, serving precision, ranking, recommendation, affiliate action, or provider order. The cataloged-provider count is the sole provider-derived fact. The page may state that offering comparison is not present in this local slice, but it may not claim zero offerings.

The stable Model ID owns frontend canonical identity. Stable-ID and verified current-slug requests may both render `200`, while validated success sets canonical and Open Graph URLs to the protected public frontend origin plus `/models/{stable-model-id}`. Title, description, and share text come only from validated current Model facts. Historical slugs redirect to the stable-ID path. Error and unavailable pages do not reflect request paths into canonical or Open Graph URLs.

## Local acceptance target

- API cryptographic and effect-order tests for the exact signed pinned tuple and every rejection class;
- frontend bounded-client tests for status, bytes, encoding, media type, contract, and publication continuity;
- actual web-to-API-to-query Worker-runtime cases for stable/current/historical/not-found/race/dependency outcomes;
- a dedicated or parameterized local-only browser stack for successful Model Facts journeys while the existing preview browser stack remains unchanged and proves closure;
- raw SSR semantic, hostile-value-escaping, exact route/query behavior, stable-ID canonical/share identity, and error-page non-reflection checks;
- automated accessibility, no-script, zero-cookie, zero-browser-persistence, no-third-party, and privacy evidence; and
- full repository verification with all mapped traceability statuses unchanged.

## Non-claims and remaining gates

This phase does not implement Variant pages, Model cards, EvidenceSummary pages, offering lists or comparisons, sorting/filtering, referral links, public Model API routing, remote secrets or protected configuration, real publication data, portable recovery, protected pre-open audit evidence, load/multi-PoP tests, manual/deployed accessibility, GDPR accountability acceptance, deployment, or release. ADR 0045 still requires product-owner acceptance before its recovery work. All mapped rows remain `Planned`.
