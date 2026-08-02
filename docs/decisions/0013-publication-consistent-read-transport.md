# ADR 0013: Use a publication header, D1 bookmark continuity, and publication-qualified vector IDs

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, API lead, data lead
- Related requirements: API-003, API-012, API-015, API-024, API-024A, SRCH-007, CF-008, CF-022, PRIV-003, PRIV-006, QA-006
- Supersedes: The unresolved public-pin transport and stable Vectorize-ID assumptions in ADR 0005 and ADR 0007

## Context

ADR 0007 requires Astro SSR and later API calls from one page to use one immutable publication. The approved API route table did not define how a public client supplies that pin. A query parameter would make every response `private, no-store` under `PRIV-006`, while duplicating every resource below a publication path would expand the public route surface solely for cache identity.

Resolving an active head and reading its data through separate query-service calls also creates a replica boundary. A second unconstrained D1 Session could be older than the replica that returned the head. In addition, Vectorize namespaces partition queries but vector IDs remain unique within the whole index. Reusing a stable model or variant ID in a new publication namespace would collide with the retained publication.

## Decision

Use `X-QuantClarity-Publication` as an optional request header on public `GET` and `HEAD` operations and as the publication response header already defined by the API:

- With no header and no authenticated cursor, resolve the active publication after request validation and rate limiting.
- A valid header pins the request to that exact hot publication. An authenticated cursor implicitly pins its publication; if both are present they must match.
- The value is an exact lowercase `pub_` UUIDv4. Malformed or conflicting pins return `400 invalid_parameter` or `400 invalid_cursor` as applicable. A syntactically valid pin that is expired, unavailable, unknown, or was never publicly activated returns the same generic `409 publication_expired`, with the current public publication in the response header. The response never reveals candidate or failure state.
- CORS permits the fixed request header and exposes the response header. The header is public canonical state, never identity or visitor telemetry.
- The frontend includes the optional pin in its signed service-binding envelope. The pin is covered by the signature alongside the method, path, canonical query hash, audience, environment, issued-at, and expiry.

The query service resolves a publication through one D1 Session and returns an opaque bookmark with the head record. On an API cache miss, the API passes that bookmark to the subsequent typed query call, which starts a new D1 Session from the bookmark. The bookmark exists only for the live service-binding call chain. It is never returned publicly or written to a cache, log, metric, trace, alert, or artifact. A single head-joined query remains an allowed equivalent.

Only validated path-only detail resources use the application Cache API. Their internal key is a synthesized same-origin, non-routable reserved path containing exactly:

```text
cache-format-version / publication-id / resource-type / stable-resource-id / representation
```

The raw request URL, slug, query string, header block, cursor, source-address material, or other visitor-controlled value is never copied into the key. Rate limiting and validation precede head resolution and cache lookup. The active public URL remains a resolver with `max-age=0, must-revalidate`; query-bearing and search responses remain `private, no-store`. Public immutable versioned URLs are deferred because they are unnecessary for the required safe edge cache.

Use the publication ID directly as the Vectorize namespace. Derive each Vectorize ID as the lowercase 64-character SHA-256 hex digest of a versioned canonical tuple:

```text
quantclarity-vector-v1 NUL publication-id NUL resource-type NUL stable-resource-id
```

The serving-D1 `publication_search_document` row maps that ID back to its canonical model or variant within the same publication. Query always supplies the publication namespace and rehydrates canonical data through that mapping. Publication manifests retain the exact vector IDs and namespace used for verification and cleanup. Vector metadata remains non-canonical.

Official references verified on 2026-08-01:

- [D1 Sessions and bookmarks](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [Vectorize namespaces and inserts](https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/)
- [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Workers service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

## Consequences

- SSR, browser API reads, cursors, D1 projections, application cache entries, and Vectorize queries can use one explicit publication without adding query parameters or cookies.
- Cross-origin clients that set the pin perform the standard CORS preflight for a non-safelisted header.
- Active detail responses receive safe edge-cache reuse without claiming immutable semantics for an unversioned public URL.
- D1 bookmark transport prevents a cache miss from following a newly observed head with an older replica read.
- Publication-qualified vector IDs allow active, previous, and building namespaces to coexist in one index and make ID-only cleanup unambiguous.
- The frontend/API envelope and internal query contract gain one versioned field each and require compatibility rollout tests.

## Alternatives considered

- `publication_id` query parameter: rejected because all query-string responses must remain `private, no-store` and the parameter would be easy to leak into raw cache keys.
- Publication-prefixed duplicate public routes: deferred because they multiply the contract surface without being required for safe application caching.
- Cookie, Web Storage, or service-worker publication state: prohibited by the zero-visitor-data requirements.
- Trusting `Vary` alone for publication caching: rejected because the application must construct and validate the exact cache identity after rate limiting.
- A second unconstrained D1 Session after resolving the head: rejected because it may select an older replica.
- Stable canonical IDs as Vectorize IDs in every namespace: rejected because IDs are unique within the index, not independently reusable per namespace.
- One Vectorize index per publication: rejected because data publication must not require Worker rebinding or code deployment.

## Validation

- Contract tests require the request/response header on every data `GET` and `HEAD`, fixed CORS allow/expose headers, no public publication query parameter, and the stable `409` response.
- Unit tests reject malformed, duplicated, and cursor-conflicting pins.
- Cache tests prove only validated publication and stable resource IDs enter a same-origin reserved key and that query strings, slugs, and request headers cannot enter it.
- D1 integration tests resolve a head on one Session, continue from its bookmark, inject replica lag, and prove no mixed or false-missing publication response.
- Publication chaos tests exercise active switch, old HTML, rollback, expired pins, cache hits/misses, and separate service calls.
- Vector tests prove deterministic 64-byte IDs, cross-publication separation, exact D1 rehydration, namespace isolation, manifest parity, and safe ID-only cleanup.
