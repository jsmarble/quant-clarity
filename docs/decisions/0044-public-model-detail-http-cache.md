# ADR 0044: Route public Model detail through a stable-ID cache boundary

- Status: Accepted
- Date: 2026-08-03
- Decision owners: Product owner, staff engineer, API lead, query lead, security and privacy lead
- Related requirements: `DATA-001`–`DATA-015`, `DATA-060`–`DATA-065`, `API-001`–`API-005`, `API-011`–`API-014`, `API-016`, `API-017`, `API-020`–`API-027`, `BE-002`, `BE-003`, `BE-007`–`BE-009`, `CF-008`, `CF-020`, `CF-021`, `CF-023`, `NFR-001`, `NFR-002`, `SEC-001`, `SEC-007`, `SEC-008`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `OPS-001`–`OPS-003`, `QA-004`, `QA-006`–`QA-008`, `QA-014`
- Extends: ADRs 0009, 0011, 0013, 0016, 0031, 0032, 0038, 0041, and 0042
- Supersedes: the statements in the API contract that leave public Model slug response behavior undecided; it does not supersede any product requirement

## Context

The public `/v1/models/{model_id_or_slug}` route remains closed even though the implementation now has all three internal identity paths. ADR 0038 supplies a bounded canonical stable-ID reader. ADRs 0039 through 0042 add complete canonical slug-history capture, an immutable private sidecar, schema-`1.13.0` readiness and lifecycle authority, and one publication-pinned `readModelDetailV2` operation that distinguishes a stable ID, current slug, and historical slug without returning the submitted historical value.

The remaining work is public protocol, not data authority. B3 must decide which identifier forms return a representation, which may redirect, how publication pins survive that behavior, when Cache API is allowed, and how every request remains behind bounded validation and transient rate limiting. It must also close the response-size gap recorded by ADR 0038: the internal canonical reader accepts a resource as large as 1,000,000 bytes, while the selected public representation ceiling is 65,536 UTF-8 bytes.

Two design notes conflict. The approved system design states that historical slugs redirect to the stable resource. Older API-contract notes say redirect versus direct response remains undecided, while generated OpenAPI prematurely describes only a direct `200`. This ADR makes the approved system-design rule operational for active-publication lookups while preserving ADR 0013's stronger guarantee that an explicit publication pin selects one complete response. It does not amend the PRD.

Cloudflare added configurable pre-invocation Workers Caching after the earlier API decisions. If enabled on the public gateway, a hit can be returned before Worker code executes, violating `API-024`. The explicit data-center-local Cache API remains suitable because the Worker invokes it itself after validation, limiting, and publication selection. The two mechanisms are separate and require separate configuration and response headers.

## Decision

### Closed route and identifier semantics

Only exact `GET`, `HEAD`, and `OPTIONS` requests to `/v1/models/{model_id_or_slug}` enter this operation. The path has exactly one identifier segment, no trailing slash, and no query marker, including a bare `?`. It accepts either an exact lowercase `mdl_` UUIDv4 or the existing strict 1–128-character lowercase ASCII slug grammar. Percent-encoded identifiers, decoding aliases, Unicode normalization, case folding, search aliases, extra segments, bodies, filters, sorts, cursors, and visitor-selected representations are rejected before downstream effects.

Relative to the selected publication:

- a stable Model ID returns `200` with the existing canonical `ModelDetail` JSON;
- a current slug returns byte-identical `200` canonical `ModelDetail` JSON;
- a historical slug without an explicit publication pin returns a bodyless `308 Permanent Redirect` whose relative `Location` is `/v1/models/<verified-model-stable-id>`;
- a historical slug with an explicit valid publication pin returns byte-identical `200` canonical `ModelDetail` JSON under that selected publication; and
- a valid but unmatched identifier returns the existing bounded `404 resource_not_found` envelope.

The redirect target comes only from the contract-validated canonical Model ID returned by the authoritative B2C-C lookup. It never uses the request host, raw URL, submitted slug, forwarded headers, query material, or canonical current slug. A redirect includes the selected `X-QuantClarity-Publication`, but correctness does not depend on a user agent preserving that non-safelisted request header across navigation: an explicitly pinned historical lookup returns the representation directly. QuantClarity does not encode the publication into a redirect query or create a second versioned route tree.

Lookup provenance remains internal. A `200` body contains neither `matchedBy`, submitted identifier, historical slug, redirect metadata, nor a duplicate Model Facts entity. Stable-ID and current-slug responses for the same selected publication are exact-byte identical and therefore have the same ETag.

### Effect order and publication continuity

Bounded protocol parsing first selects either a closed request plan or a bounded static response plan. No selected response is released yet. The API then:

1. reads the source address only to derive the approved request-lifetime `ip-v1` IPv4 `/32` or IPv6 `/64` primary HMAC actor key and, for IPv6, the `/48` rotation-bucket key;
2. consumes the configured cheap-read and applicable rotation bindings;
3. discards the address, prefixes, imported HMAC material, and actor keys;
4. returns a limiter denial, limiter failure, precomputed validation/method/path response, or `OPTIONS` response; and only on a valid `GET` or `HEAD`
5. resolves active or exact retained-hot publication state once through resolver V2; then
6. performs an eligible stable-ID Cache API lookup or one bookmark-continuous `readModelDetailV2` RPC.

Every public request, including malformed requests, `OPTIONS`, `404`, `405`, `429`, and cache hits, therefore reaches both applicable abuse controls before a response. Failure to obtain a safe address, key, or limiter result fails closed with generic `503 temporarily_unavailable`. A denial returns `429 rate_limited` and `Retry-After: 60`. The bindings remain permissive and location-local abuse controls, not exact quotas.

The resolver receives only the optional validated publication pin and the existing `now + 15 minutes` fresh-work horizon. A malformed pin is `400`; an unknown, unavailable, never-public, expired, or insufficient-horizon pin is generic `409 publication_expired` with the current publication header only; no safe active publication is `503 publication_not_ready`. A cache miss or any slug lookup continues from the resolver bookmark with the identical horizon. No fall-forward to another publication is permitted.

### Stable-ID-only application cache

Only a query-free exact stable-ID `GET` or `HEAD` that has passed limiting and publication resolution is eligible for application Cache API lookup. A conditional stable-ID request follows that ordinary lookup path, but its resulting `304` is never stored. Current and historical slug requests, redirects, errors, preflight, query-bearing requests, and malformed requests are never cache lookups or writes.

The API constructs a new headerless `GET` cache-key `Request`; it never clones the visitor request. Its exact HTTPS origin comes from protected environment configuration, and its reserved path contains only cache-format version, validated publication ID, literal resource type `model`, validated canonical stable ID, and representation `json`. The identity remains the ADR 0016/`publicationCacheKey` identity. Host, forwarded values, raw URL, slug, query marker, conditional header, cookie, authorization value, source address, actor key, user agent, referrer, and request identifier cannot affect it.

The manual cache namespace has only the authorized public application as a writer. It is an optional, corruption-prone performance copy rather than canonical authority; platform/account compromise is outside this cache-corruption model and is controlled through the protected origin, least-privilege deployment identity, and account controls. A hit is accepted only after bounded body reading, exact byte-count and 65,536-byte checks, complete `ModelDetail` validation, publication/model identity checks, fixed header checks, and recomputation of the strong ETag. Missing, expired, malformed, oversized, mismatched, exception-throwing, `Set-Cookie`-bearing, or `Vary: *` entries become canonical-query misses without surfacing cache detail.

After a successful canonical stable-ID read, the API may schedule one opportunistic `cache.put` through `waitUntil`. The stored internal response is an exact validated `200` JSON representation with fixed headers and `Cache-Control: public, max-age=300, must-revalidate`. Cache-write rejection or eviction never fails or delays the public representation, and no stale-on-error or stale-while-revalidate fallback is allowed. The public response is reconstructed separately; an internal cache-control header is never returned to the client by accident.

Cloudflare pre-invocation Workers Caching is explicitly `enabled: false` for the public gateway entrypoint in every environment. Disabling it prevents a cache hit from bypassing Worker validation and limiting. Deployment controls must also prove that no older pre-invocation cache entry remains eligible after any configuration transition. Cache API locality and eviction affect performance only; publication-qualified keys make correctness independent of replication or purge.

### Public response and conditional semantics

Successful stable-ID responses use `Cache-Control: private, max-age=0, must-revalidate`. This permits only the client's private standards-based cache to revalidate while the application uses its separate five-minute stable-ID cache. Current-slug `200`, explicitly pinned historical-slug `200`, unpinned historical-slug `308`, every error, `429`, and `OPTIONS` use `private, no-store` because their public URL identity contains a slug or is not a canonical representation identity.

Every `200` includes:

- `Content-Type: application/json; charset=utf-8`;
- exact `Content-Length`;
- the ADR 0016 strong quoted ETag over selected publication, `json`, and exact representation bytes;
- `X-QuantClarity-Publication`;
- `Vary: X-QuantClarity-Publication`;
- `Access-Control-Allow-Origin: *` and the fixed expose list; and
- the fixed API security headers.

GET and HEAD use the same representation bytes and ETag; HEAD has no body. `If-None-Match` is evaluated only after validation, limiting, publication selection, and exact cache/query representation recovery. Weak comparison, lists, and `*` follow ADR 0016. A match returns bodyless `304` with the same ETag, selected publication, `Vary`, CORS, security, and public cache-policy headers, but no separately cached `304` object.

The unpinned historical `308` includes only the relative stable-ID `Location`, selected publication, `Vary`, fixed CORS/security headers, `Content-Length: 0`, and `private, no-store`. It has no ETag or representation body. An explicitly pinned historical `200` has the ordinary representation headers and strong ETag but retains `private, no-store`. Errors include fixed CORS/security headers and `private, no-store`; only a truthful selected or current publication outcome may add the publication header. Errors never echo an identifier, slug, raw parameter value, pin, digest, bookmark, stack, cache state, or infrastructure detail.

`OPTIONS` remains bodyless `204` after limiting. It allows exactly `GET, HEAD, OPTIONS` and request headers `If-None-Match, X-QuantClarity-Publication`, exposes exactly `ETag, X-QuantClarity-Publication`, is noncredentialed with origin `*`, sets `Access-Control-Max-Age: 600`, and remains `private, no-store`. Generated OpenAPI must match this header matrix and include the historical `308`.

The existing CSP, permissions, no-referrer, no-sniff, and frame-denial headers remain. Every public HTTPS response includes environment-owned `Strict-Transport-Security`: production uses `max-age=31536000; includeSubDomains` only after the approved custom-hostname gate, while preview uses `max-age=300` without `includeSubDomains`. Only local `.test` responses omit HSTS. The protected environment policy, never request host material, selects the exact header.

### Response admission and runtime budgets

The public `ModelDetail` ceiling is exactly 65,536 UTF-8 JSON bytes. It is a pre-release contract and code constant, not caller input. The implementation never truncates a Model, Fact, evidence-reference array, checkpoint, or envelope.

Before the route may open, an exact audit serializes the `ModelDetail` representation for every Model in every currently serveable active, rollback, and retained-hot publication and must pass the 65,536-byte ceiling. Thereafter, the only activation/rollback head-mutation path runs the same deterministic full-publication guard immediately before each mutation; a recovery/rebuild target must pass it before any head mutation can make that target serveable. A ready but never-public candidate may exceed the ceiling, but it cannot activate or become rollback authority. This guard and the pre-open audit are the admission authority; this ADR does not claim a persisted self-authenticating admission receipt. A runtime overage after successful publication admission is an integrity failure and returns generic `503`; `413` remains reserved for an oversized public request, not a valid identifier whose stored canonical representation violates publication invariants.

“Only activation/rollback head-mutation path” means the only authorized application path. The serving migration's fixed switch-history trigger still permits a privileged direct D1 statement to apply an otherwise valid switch-history row without executing JavaScript admission. D1 does not provide a per-statement application ACL that could make a database-level non-bypass claim truthful. Direct administrative SQL and a malicious pipeline deployment are therefore protected break-glass/account-control authorities outside this application-correctness boundary. The public API has no D1 binding. The non-routable query Worker has only the disposable serving D1 binding, whose platform capability is technically read/write, but exposes fixed SELECT-only code with no mutation or arbitrary-SQL operation. The pipeline remains unrouted, accepts no caller-supplied SQL, and routine switching uses only the reviewed fixed adapter. Query, pipeline-deployment, and direct-D1 administration identities must be separated and protected before route opening. A future trigger defense may supplement this boundary, but it cannot replace the exact shared encoder, complete Model contract/hash checks, or recovery compatibility evidence. B3-A claims guarded authorized application switches, not database-enforced non-bypass.

The local implementation retains the existing public maxima of four subrequests, two upstream calls, zero semantic calls, and 50 planned CPU milliseconds. One stable-ID cache hit uses resolver plus Cache API for two subrequests. A stable-ID miss without a fill uses resolver, Cache API, and detail RPC for three; a successful miss plus `waitUntil(cache.put())` uses the fourth even though the put is not a response dependency. A slug uses resolver and detail RPC for two. The background put must start before the response completes, finish within Cloudflare's post-response lifetime, and catch and suppress its own rejection without logging. These settings do not complete `CF-023`, `NFR-001`, `NFR-002`, `QA-008`, or `QA-014`: approved remote cold/warm, tenfold, multi-PoP, cache-filled switch/rollback, NAT, IPv6 rotation, and false-positive evidence remains required before deployment.

### Zero visitor data and deployment boundary

The API sends only protected environment, publication/bookmark/horizon authority, canonical lookup kind/value, and the closed service envelope to the non-routable query Worker. Source address, derived actor keys, raw URL, header block, conditional value, cookie, authorization value, user agent, referrer, and request identity do not cross that boundary.

No path creates application logs, traces, custom or request-derived metrics, Analytics Engine events, alerts, request correlation IDs, cookies, browser state, beacons, or visitor-derived cache keys. There is no hit/miss response header or request telemetry. `console.*`, invocation logs, Workers traces, Tail/Logpush exports, Web Analytics, Zaraz, and equivalent public-request collection remain disabled. Cloudflare infrastructure may add ordinary transport/cache headers, surface unavoidable platform aggregates, and process limiter counters under its processor role. Except for the approved in-place aggregate billing and security controls, QuantClarity does not access, review, use, export, join, correlate, or copy those aggregates as operational, product, release, or visitor-level evidence.

This ADR authorizes local implementation and verification only. It does not authorize provisioning or deployment. Remote D1/service/cache behavior, multi-PoP evidence, public origins, production HSTS, account/zone privacy audit, DPA/transfer/subprocessor review, ROPA/DPIA/DPO/representative decisions, legal/dataset terms, B2C-B recovery gates, RPO/RTO, source approvals, and protected environment inventory remain release blockers.

## Consequences

- The first canonical Model detail route can use stable IDs and human-readable current slugs without creating alternate facts.
- Unpinned historical slugs follow the approved stable-resource redirect rule; explicit pins return the selected representation directly so publication continuity never depends on redirect-header preservation.
- Stable-ID cache hits still execute bounded validation, both transient limiter controls, and publication resolution.
- Cache eviction, locality, or write failure changes cost and latency only; it cannot change publication identity or availability.
- A deterministic publication-wide 65,536-byte admission rule prevents valid active Models from becoming unservable at runtime.
- Exact local evidence can advance implementation confidence, but remote performance, abuse, privacy-accountability, recovery, deployment, and release gates remain pending.

## Alternatives considered

- Return `200` for every historical slug: rejected because the approved system design selects redirect to the stable resource for the ordinary active-publication route. The narrow explicit-pin response is required to preserve the selected publication without a versioned URL or visitor-specific redirect state.
- Redirect current slugs: rejected because the current slug is a valid human-readable resource locator and direct canonical bytes avoid an unnecessary round trip.
- Cache slug requests under their raw path: rejected because slugs and visitor request URLs are forbidden cache-key material.
- Resolve a slug and then look up the stable-ID body cache in the same request: rejected for B3 because the authoritative slug read already returns and validates the exact Model; an additional Cache API lookup adds cost without avoiding D1 work.
- Enable pre-invocation Workers Caching: rejected because hits would bypass mandatory request validation and rate limiting.
- Return the internal `public, max-age=300` cache clone to clients: rejected because it could create an uncontrolled shared-cache path and confuse the application cache with browser policy.
- Use `private, no-store` for stable-ID success: rejected because `API-024A` and `API-012` call for safe caching and conditional validation where a path-only canonical stable ID permits it.
- Raise the public response ceiling toward the 1,000,000-byte internal reader bound: rejected without controlled RPC/CPU/latency evidence; publication admission makes the selected 65,536-byte ceiling safe.
- Return `413` when an active canonical Model exceeds the response ceiling: rejected because request size is valid and the state represents a publication-integrity failure that should have been impossible after admission.
- Add cache-hit telemetry for performance evidence: rejected because live request/cache telemetry is prohibited; performance evidence uses controlled synthetic profiles.

## Validation

- Prove exact stable-ID/current-slug `200`, explicit-pin historical-slug `200`, unpinned historical-slug `308`, unknown `404`, strict grammar, no query marker/body/trailing slash/extra segment, and no submitted identifier in bodies or errors.
- Prove stable/current/explicit-pin-historical exact-byte and ETag equality; the unpinned historical redirect targets only the verified stable ID and carries no body, ETag, raw slug, host, query, or forwarded value.
- Prove bounded planning, both applicable limiter effects, and actor-key disposal precede every error, preflight, publication, cache, and query outcome.
- Prove active, rollback, retained-hot, exact pin, expired/unknown pin, strict cutoff, switch, and no-fall-forward behavior with one bookmark/horizon chain.
- Prove pre-invocation Workers Caching is explicitly disabled and the manual cache key is a new headerless GET at the protected origin containing only format, publication, `model`, stable ID, and `json`.
- Prove GET/HEAD cache sharing, publication isolation, five-minute internal policy, stable-ID-only lookup/write, no error/redirect/slug/query caching, cache exception fallback, failed-put success preservation, and corruption-tolerant cache-entry validation.
- Prove exact success, HEAD, `304`, `308`, OPTIONS, `400`, `404`, `405` plus `Allow`, `409`, `413`, `429`, and `503` header/body matrices; fixed noncredentialed CORS; strong conditional vectors; and environment-owned production/preview/local HSTS behavior.
- Prove the pre-open audit across every currently serveable publication, 65,536-byte acceptance, 65,537-byte activation/rollback rejection before head mutation, recovery-target parity, runtime fail-closed behavior, and no truncation.
- Prove exact subrequest/RPC/cache-call budgets and local pinned-workerd cold, warm, conditional, cache-corruption, and switch/rollback cases.
- Run generated OpenAPI parity/examples, contract, unit, workerd, privacy-canary, secret, dependency, lint, type, build, browser, accessibility, and production-mode gates.
- Retain remote multi-PoP cache, controlled p95/tenfold load, rate-limit overshoot/NAT/IPv6 rotation, account privacy configuration, recovery, legal, provisioning, deployment, and release acceptance as explicit pending evidence.

## References

- [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Cloudflare Workers Caching configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- [Cloudflare Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Phase 5O-B3 implementation contract](../design/phase-5o-b3-model-detail-http-cache.md)
