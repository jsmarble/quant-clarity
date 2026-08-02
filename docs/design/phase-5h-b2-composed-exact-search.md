# Phase 5H-B2: Composed exact search and compact authenticated cursor

## Status

Local implementation complete under [ADR 0030](../decisions/0030-composed-exact-search-and-compact-cursor.md). The completed boundary is local, storage-free, non-routable, and deployment-neutral.

## Slice objective

Compose the three trusted exact readers into one bookmark-continuous page and prove ADR 0016 cursor authentication without exposing public search. The slice closes the first-page-only gap from [Phase 5H-B1](phase-5h-b1-provider-model-id-reader.md) while preserving exact-tier neutrality, canonical rehydration, and zero visitor data.

## Fixed behavior

| Exact class | Marker | Resource | Applicability | Existing source |
|---|---|---|---|---|
| canonical name | `exact-v1:c` | Model or Variant | untyped, matching `record_type` | Phase 5G-B |
| provider model ID raw | `exact-v1:r` | Model or Variant | untyped, matching `record_type` | Phase 5H-B1 |
| provider model ID normalized-only | `exact-v1:n` | Model or Variant | untyped, matching `record_type` | Phase 5H-B1 |
| provider name | `exact-v1:p` | Provider | untyped or `record_type=provider` | Phase 5B/5D |

The composer uses one selected publication, one resolver bookmark, one composed RPC, and one D1 Session. The complete actual API cursor tuple is `[marker, stable_resource_id]`; every exact class orders only by stable resource ID. Cursor continuation never contains display text, and provider-model-ID resume requires no reconstruction read.

Cross-tier target deduplication is a query-plan property. Before limit, a provider-model-ID target is excluded when its active canonical name is an eligible exact match under the same query and record-type scope. No emitted-ID history is retained in the cursor or storage.

Only no filter or a single `record_type` is accepted. Sort is fixed to `relevance,stable_id`. Explicit provider-only search reports `semantic_degraded=not_applicable`; every other B2 exact-only response reports `disabled`. Collection metadata is authoritative and every result is an exact mirror.

## Component boundaries

### Query Worker

- Add one closed `readMergedExactSearchV1` RPC while preserving the three tier-local test seams.
- Validate the outer call, closed search envelope, marker/ID agreement, query, filter, limit, publication, and semantic ceilings before D1.
- Create one `withSession(bookmark)` Session and pass it sequentially to fixed SELECT-only readers.
- Skip classes before a valid continuation; use bounded cross-class lookahead; return at most the requested page and one compact continuation.
- Fail the complete page on any invoked reader or integrity failure.

### API Worker

- Accept only an already normalized internal request and injected service, cursor keyring, clock, skew, Web Crypto, ceilings, and protected environment.
- Verify and reconcile an optional cursor before resolution, preserving its publication and expiry.
- Resolve once and call only `readMergedExactSearchV1` once.
- Strictly validate and detach the RPC result, map canonical facts into the existing `SearchCollection` shape, strip internal markers, and issue the next cursor.
- Perform no Request parsing, response headers, rate limiting, caching, logging, configuration, binding, or deployment work in this slice.

## Bounded budgets

| Budget | B2 ceiling |
|---|---:|
| Public result limit | 20 |
| Lookahead | 1 candidate |
| Post-resolution RPC calls | 1 |
| D1 Sessions | 1 |
| Post-resolution SELECTs | 4 |
| Cursor characters | 4,096 |
| Cursor string scalar | 512 UTF-8 bytes |
| Cursor TTL | 15 minutes |
| Future-issued skew | 30 seconds |
| Semantic calls/candidates | 0 / 0 |

Existing tier resource, aggregate-transfer, query, and response ceilings continue to apply. Unsupported filters and sort modes reject before service access.

## Acceptance matrix

1. **Composition:** four-class precedence, raw-before-normalized, stable-ID-only within-class order, exact page fill, boundary lookahead, empty and terminal pages.
2. **Identity:** canonical/provider-ID collision, raw/normalized collision, provider/type distinction, dedupe before limit, every-page traversal, and permutation invariance.
3. **Continuation:** all markers, marker/ID-prefix mismatch, maximum display name, strict forward movement, and no hidden ordering-key leakage.
4. **Authentication:** current and overlap keys, rotation, tamper, unknown key, query/filter/sort/limit/publication mismatch, expiry/skew/oversize, and nonextended expiry.
5. **Filters and state:** untyped plus all three record types, unsupported/multi-value filter rejection, relevance-only sort, `disabled`, and provider-only `not_applicable` mirrors.
6. **Transport:** one resolver, one composed RPC, one Session, one bookmark, at most four SELECTs, hostile object graphs, detached outputs, and static failures.
7. **Publication:** active and current rollback candidate succeed; arbitrary older publication rejects; multiple-switch retained-hot continuity remains explicitly pending.
8. **Privacy/security:** SELECT-only fixed SQL and source scans for no public Request, cache, cookie, persistence, log, trace, metric, analytics, telemetry, correlation, raw-query echo, cursor echo, or bookmark leak.

## Requirement handoff and nonclaims

- `SRCH-002`, `SRCH-006`, `API-003`: B2 contributes the composed implemented exact classes and canonical results.
- `API-007`, `API-009`: B2 contributes compact authenticated deterministic traversal, but retained-hot multiple-switch continuity and the public route remain pending.
- `SRCH-004`, `API-010`: B2 supports only `record_type`; every other approved filter and every later search class remains pending.
- `API-013`, `SEC-001`, `SEC-007`: B2 contributes closed static failures, fixed SELECT-only work, and bounded local service use; deployed abuse/platform evidence remains pending.
- `PRIV-006`, `PRIV-007`, `PRIV-011`: B2 is transient and storage-free, but public-route and deployed zero-visitor-data evidence remain pending.
- `QA-004`–`QA-006`, `QA-013`, `QA-014`: focused local suites contribute evidence; full versioned acceptance, remote D1, load, privacy-canary, and release gates remain pending.

No traceability status advances in this slice. Prefix/keyword search, semantic retrieval, complete filters, retained-hot publication resolution, dedicated public search limiting, runtime cursor secrets/service bindings, public Request/Response handling, remote resources, deployment, and release acceptance remain blocked.
