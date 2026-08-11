# ADR 0052: Add a publication-pinned frontend Model-detail read

- Status: Accepted for local implementation
- Date: 2026-08-10
- Decision owners: Staff engineer, privacy and security lead
- Related requirements: `FE-030`, `FE-031`, `FE-060`, `FE-061`, `API-003`, `API-004`, `API-005`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-009`
- Extends: ADRs 0011, 0012, 0013, 0042, 0044, 0048, and 0051

## Context

The query Worker and API already contain a complete, bounded Model-detail reader, stable/current/historical slug authority, response planner, and stable-ID-only manual-cache composition. ADR 0048 deliberately left that composition outside the live API handler. The frontend Model route therefore remains a fixed `404`, and ADR 0051 authenticates only an unpinned metadata read.

The approved frontend design requires Astro to select one publication at request start and pin every canonical read to it. Reusing the public API limiter for the service-binding call would require forwarding or recreating visitor identity, which is forbidden. Broadening the metadata bypass without a closed route and publication contract would instead create an accidental internal read authority.

This decision defines the smallest local-only Model Facts slice. It does not open the public Model API route, supersede the portable-recovery prerequisites, authorize preview or production configuration, or claim the provider-offering comparison required by `FE-032` through `FE-039`.

## Decision

### Exact signed authority

After the frontend Worker has applied both applicable transient visitor-derived limiter buckets, Astro may create one fresh service-binding request for a Model page. The request is an exact query-free `GET` to the unrouted internal origin and `/v1/models/{identifier}` path. It carries the ADR 0051 canonical HMAC envelope and the selected metadata publication ID as its mandatory publication pin.

The frontend validates the raw route as exactly one `/models/{identifier}` segment before signing. Percent-encoded aliases, encoded separators, case-folded stable IDs, invalid UTF-8, empty or additional segments, and trailing-slash aliases perform no detail read. The identifier must be either one exact lowercase Model stable ID or one strict slug. It constructs the request from the protected internal origin, validated identifier, and canonical publication ID only. It forwards no visitor request header, address, actor key, cookie, referrer, conditional header, query, correlation ID, browser state, or public host material. A frontend query string never changes or enters canonical facts or the signed detail request; the HTML response remains `private, no-store` and its canonical metadata omits the query. The Model read adds no retries; together with the existing metadata read, a Model-page render performs at most two sequential service-binding calls.

The API authenticates the internal origin, canonical envelope, environment, exact method/path/query digest, lifetime, signature, and mandatory publication pin before reading any source-address or public-limiter capability. Only the closed local environment may admit this tuple. A forged, altered, expired, future, unpinned, query-bearing, non-GET, non-Model, preview, or production tuple receives a fixed `404` and performs no resolver, cache, or query operation. Reserved authentication headers on a public origin retain ADR 0051 behavior: the normal public limiter settles before the fixed `400`.

An admitted internal request enters a factored Model-detail executor only after frontend limiter admission and API authentication. The direct public path, when separately authorized in the future, must enter the same executor only after the ADR 0044 public limiter. Internal authentication headers are never forwarded to the query Worker or incorporated into cache identity.

### Publication and cache continuity

The mandatory publication pin must equal the publication selected by the frontend metadata snapshot. The API preserves ADR 0044's exact retained-hot selection, canonical V2 read, 65,536-byte response ceiling, and stable-ID-only manual Cache API behavior. Cache keys remain protected-origin plus publication ID, stable Model ID, and representation format; they contain no visitor, signature, host, slug, or query material. Current and historical slugs bypass Cache API.

Because every frontend read is explicitly pinned, a historical slug produces the pinned canonical `200` rather than ADR 0044's unpinned API `308`. After strict response validation, Astro compares the requested identifier with the returned stable ID and current canonical slug. Slug classification additionally requires that the returned canonical slug Fact is `known` and contract-valid; any other state is unavailable. A verified historical slug becomes a bodyless frontend `308` to `/models/{stable-model-id}`. A stable ID or verified current slug renders directly. Any API `308` on the pinned internal channel is a contract failure, not a redirect target.

A publication that expires between metadata selection and detail resolution returns the existing bounded conflict. The frontend maps that race, dependency failures, signature failures, malformed responses, timeouts, and publication mismatches to a generic `503`; it never falls forward to the new head or converts uncertainty into `404` or zero.

### Response admission and Model Facts

The frontend detail client has one 500-millisecond whole-operation deadline and a 65,536-byte body ceiling. It accepts only exact JSON media type and encoding, bounded canonical length, `200`, the selected publication header, and the complete closed `ModelDetail` contract. It sends no `If-None-Match`; `304`, `308`, an unexpected status/header, invalid UTF-8, truncated/oversized bytes, additive contract data, or body/header/publication disagreement fails unavailable. A `404` maps to the accessible not-published page only when its complete status/header/body matrix is the exact bounded Model-detail `resource_not_found` representation, including the selected publication header and required publication `Vary`. A generic or publication-free `404` is unavailable so authentication or environment closure cannot masquerade as canonical absence. An initial metadata `not_published` snapshot may render the same accessible `404` without making a detail call; `publication_not_ready` or any transition outcome after a published snapshot is a race and maps to `503`.

The server-rendered page begins with a Model Facts label and renders only the canonical Model resource: identity, publisher, architecture, total and active parameters, checkpoints, source weight format and source-provided quantization, context/output limits, modalities, release date, license, status, cataloged-provider count, evidence references, observation times, and freshness. Known, unknown, unavailable, and not-applicable Fact states stay visibly distinct. Values use Astro's normal escaping; no provider price, serving precision, provider name, ranking, recommendation, affiliate call to action, script, raw HTML injection, or evidence/referral outbound link is added.

This slice contributes only the canonical-Model portion of `FE-030` and the Model-only summary in `FE-031`. Explicit Variant pages, Offering Facts, active/historical offering rows, filters, sorts, and comparisons remain pending. Model-card requirements `FE-020` through `FE-027` are separate and receive no completion claim.

The stable-ID frontend path is the canonical URL for this slice. Both a stable ID and verified current slug may render `200`, but successful raw HTML sets `<link rel="canonical">` and `og:url` to the protected public frontend origin plus `/models/{stable-model-id}`. Title, description, and share metadata are derived only from the validated current Model facts and contain no provider-derived claim beyond the allowed provider count. Historical slugs redirect to that stable-ID path. Error and unavailable pages emit no request-derived canonical or Open Graph URL. Production origin, indexing, link-unfurl, and duplicate-control acceptance remain pending.

## Consequences

- The local frontend can exercise one publication-pinned canonical Model read through the real signed web-to-API-to-query chain without propagating visitor identity.
- A Model render has two bounded sequential internal reads and no retries. Performance acceptance must measure that amplification before remote routing.
- Public Model API routing remains closed. Preview and production remain fixed closed even if a signature is presented.
- ADR 0044's protected pre-open audit, ADR 0045 product-owner decision, portable recovery, remote configuration, load/multi-PoP evidence, GDPR accountability, and release authorization remain prerequisites to public routing or deployment.
- All mapped traceability rows remain `Planned`; local implementation is prerequisite evidence only.

## Alternatives considered

- **Forward the visitor address to reuse the API limiter:** rejected because the receiving API does not need visitor identity after frontend admission.
- **Call the existing Model HTTP composition unchanged:** rejected because it requires a source address and would either fail every service-binding read or tempt identity fabrication.
- **Allow an unpinned internal Model read:** rejected because it can mix metadata and detail publications during a head switch.
- **Trust or automatically follow API redirects:** rejected because the pinned channel must not redirect and an untrusted absolute location could cross the service boundary.
- **Open the public local Model API route in the same slice:** rejected because recovery admission, protected pre-open evidence, and remote release controls remain unresolved.
- **Render offering rows from the Model contract:** rejected because `ModelDetail` contains canonical Model facts only and cannot prove `FE-032` through `FE-039`.

## Validation

- Cryptographic/API tests cover valid, forged, expired, future, cross-environment, altered method/path/query/pin, unpinned, key-rotation, and public reserved-header cases.
- Effect-order tests prove frontend limiting precedes signing, API authentication precedes the admitted executor, and rejected requests cause no resolver, cache, or query effect.
- Client tests cover the deadline, body ceiling, fatal decoding, exact media type, closed contract, publication equality, status matrix, and pinned-channel redirect rejection.
- Worker-runtime tests cover stable ID, current slug, historical slug, not found, publication expiry, dependency failure, and exact metadata/detail publication equality through the real service bindings. A dedicated or parameterized local-only browser stack exercises success; the existing preview browser stack remains preview and proves the route stays closed.
- Raw SSR/browser tests cover semantic Model Facts, explicit Fact states, hostile-value escaping, exact raw-route rejection, query non-influence, stable-ID canonical/OG identity, canonical frontend redirect, no error-page request-derived canonical, no JavaScript, no cookies or browser persistence, no third-party requests, automated accessibility, and existing privacy gates.
- Full contract, type, lint, Worker-runtime, browser, accessibility, environment, privacy, build, and repository verification remain required.
