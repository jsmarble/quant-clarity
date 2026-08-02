# Phase 5A local API/query kernel boundary

| Attribute | Value |
|---|---|
| Status | Accepted local decision boundary; implementation and all runtime/release evidence remain pending until separately verified |
| Decision | [ADR 0016](../decisions/0016-bounded-local-api-read-protocol.md) |
| Requirements | `API-001`–`API-018`, `API-020`–`API-026`, `SRCH-002`, `SRCH-004`–`SRCH-009`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`–`QA-006`, `QA-014` |

## Slice objective

Phase 5A establishes a pure, local, storage-free decision kernel for the public edge and non-routable query boundary. It turns the approved route, validation, publication, cursor, CORS, conditional-response, neutrality, cache-eligibility, and privacy rules into deterministic plans with injected effects. It does not bind or call D1, R2, Vectorize, Workers AI, Cache API, Workflows, Queues, Browser Rendering, provider sources, or deployment controls.

The generated OpenAPI JSON and YAML documents are equivalent contract surfaces. They include the approved versioned methodology-metadata route, contract routes, fixed conditional/publication CORS headers, and all collection/detail resources. `Model Facts` and `Offering Facts` remain presentation projections, never canonical resource types.

## Acceptance specification

| Area | Local acceptance | Primary trace anchors |
|---|---|---|
| Closed protocol | Recognize only the approved `/v1` GET, HEAD, and OPTIONS resource routes; plan `405` for every mutation method and reject unknown paths/parameters without arbitrary operation dispatch | `ACT-API-001`, `ACT-API-002`, `ACT-API-002A`, `ACT-API-011`, `SST-SEC-001` |
| Effect order | Produce a bounded validation/error plan before limiter effects; consume the applicable request-lifetime limiter before returning that error or resolving a head; prove head, cache, and query are unreachable on failure | `ACT-API-020`–`ACT-API-024`, `ACT-API-026`, `QGA-QA-014` |
| Request bounds | Require explicit injected ceilings; enforce approved page, cursor, query, filter, result, and semantic-planning maxima; fail closed when any required unapproved runtime ceiling is absent or inconsistent | `ACT-API-007`, `ACT-API-008`, `ACT-API-021`, `ACT-API-025`, `SST-SEC-007` |
| Cursor | Authenticate the fixed-order ADR 0016 cursor with current/next HMAC keys; bind publication, operation, normalized filters/sort/query hash, limit, complete continuation tuple, stable ID, issued time, and expiry | `ACT-API-003`, `ACT-API-007`, `ACT-API-013` |
| Publication continuity | Reconcile the publication header and cursor; select one active or hot publication; map all unavailable public pins to one bounded `409 publication_expired`; carry an opaque bookmark only through the injected head/read call chain | `ACT-API-003`, `ACT-API-012`, `ACT-API-015`, `QGA-QA-006` |
| Typed query boundary | Emit only a closed normalized read envelope for metadata, methodologies, collections, details, related offerings, evidence, and search; reject raw URLs, raw query strings, arbitrary SQL/operations, headers, actor keys, and mutation/control capabilities | `ACT-API-002`–`ACT-API-010`, `ACT-API-015`, `ACT-API-018`, `SST-SEC-001` |
| Public representation | Validate JSON output against generated schemas; preserve explicit unknowns, exact decimal strings, UTC timestamps, evidence-bearing facts, active neutral filters/sorts, and stable bounded errors without request IDs or raw input echo | `ACT-API-004`–`ACT-API-006`, `ACT-API-009`, `ACT-API-013`, `ACT-API-016`–`ACT-API-018`, `QGA-QA-004` |
| Conditional reads | Derive ETag v1 from publication plus exact representation hash; keep GET and HEAD validators equal; permit `304` only after validation, rate limiting, and publication/representation selection | `ACT-API-012`, `ACT-API-024` |
| Cache decision | Mark errors, metadata, collections, search, cursors, and every query-string request `private, no-store`; synthesize a key only for an exact path-only stable-ID detail at the fixed trusted origin after limiter and head decisions | `ACT-API-012`, `ACT-API-024`, `ACT-API-024A`, `PVT-PRIV-003`, `PVT-PRIV-006` |
| Search fallback | Normalize ingress text to NFC, plan exact/structured discovery with complete filters and exact-first ordering, preserve canonical rehydration, and return explicit semantic disablement without calling a public query processor | `ACT-API-010`, `SAT-SRCH-002`, `SAT-SRCH-004`–`SAT-SRCH-006`, `SAT-SRCH-008`, `SAT-SRCH-009` |
| Zero visitor data | Prove source-address and derived keys reach only the injected limiter; no live input enters a log, trace, metric, event, alert, cache key, correlation ID, cookie, browser store, fixture, or durable object | `ACT-API-013`, `ACT-API-026`, `SST-SEC-011`, `PVT-PRIV-003`, `PVT-PRIV-004`, `PVT-PRIV-006`, `PVT-PRIV-007`, `PVT-PRIV-011` |

All error details are drawn from bounded parameter/reason allowlists and never repeat a submitted value. Every offering-bearing response preserves equal factual values and exposes the active neutral sort/filter parameters. Affiliate state, provider input order, or provider/offering count cannot affect model facts, model relevance, or factual ties.

## Contract alignment

- `GET|HEAD|OPTIONS /v1/methodologies/{version}` returns versioned methodology metadata without creating a canonical methodology fact entity.
- `GET|HEAD|OPTIONS /v1/openapi.json` and `/v1/openapi.yaml` expose semantically identical generated OpenAPI 3.1 documents. The checked-in YAML representation uses JSON-compatible YAML 1.2 serialization so one deterministic object cannot drift between formats.
- Read operations accept optional `If-None-Match` and `X-QuantClarity-Publication`. CORS preflight allows exactly those two request headers and exposes exactly `ETag` and `X-QuantClarity-Publication`; credentials remain disabled.
- Every generated detail or collection response retains the publication header, ETag declaration, visitor-safe cache policy, and schema reference appropriate to its representation.

## Explicitly pending evidence

- The local slice does not satisfy `ACT-API-003`, `ACT-API-007`–`ACT-API-010`, `ACT-API-012`, `ACT-API-015`, `ACT-API-018`, any `SAT-SRCH-*`, or `QGA-QA-006` using fake heads, rows, bookmarks, vectors, or caches alone. These anchors require the complete declared integration and acceptance artifacts.
- The API-to-query transport, no-public-route configuration, serving-D1 SELECT-only statements, D1 Session/bookmark continuity, replica-lag behavior, Vectorize namespace reads, and public Cache API remain unimplemented runtime evidence.
- `packages/api-core` is not yet a dependency of the metadata-only `apps/api` runtime stub. Its injected ceilings, closed routes, cursor, envelope, conditional-response, and cache decisions therefore remain local decision evidence, not Worker integration evidence.
- Production URL/body, response-byte, CPU, ordinary subrequest, and upstream-call ceilings require current Cloudflare verification and controlled load tests. ADR 0016 intentionally supplies no guessed production values.
- The existing public Worker rate-limit bindings do not yet implement the complete cheap-read, exact-search, semantic-search, and IPv6 rotation policy. `GATE-api-abuse` and `QA-014` remain pending deployed multi-PoP, NAT, IPv6 privacy/rotation, cache-hit, failure, and false-positive cases.
- Public query embeddings remain disabled pending `GATE-public-query-ai-privacy`. Exact/structured degradation does not satisfy `SRCH-001`, `SRCH-003`, or the semantic portion of `API-010` and cannot authorize release.
- `API-019`, `API-027`, `NFR-001`–`NFR-003`, `GATE-api-contract`, `GATE-api-abuse`, `GATE-performance`, `GATE-zero-visitor-data`, `GATE-cost-fail-safe`, and the GDPR/legal release gates require their separately owned terms, capacity, deployed, load, privacy, processor, and authorized-review artifacts.

No public dataset, provider fact, live D1 row, vector, cache entry, deployment, Cloudflare resource, visitor record, production ceiling, semantic query, or release approval is claimed. Every linked traceability row remains `Planned` until its full declared gate passes.
