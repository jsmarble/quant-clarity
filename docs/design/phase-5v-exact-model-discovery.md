# Phase 5V: Publication-pinned local exact Model discovery

| Attribute | Value |
|---|---|
| Status | Local implementation complete; no public or remote authority |
| Decision | [ADR 0053](../decisions/0053-publication-pinned-exact-model-discovery.md) |
| Requirements | `FE-010`, `FE-013`, `FE-015`, `FE-016`, `SRCH-002`, `SRCH-006`, `SRCH-008`, `SRCH-009`, `API-003`, `API-007`, `API-010`, `API-013`, `API-025`, `API-026`, `BE-007`, `SEC-001`, `SEC-005`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-003`, `QA-004`, `QA-005`, `QA-009`, `QA-014` |

## Objective

Connect the existing local exact-search authority to the Model-first SSR journey through one signed publication-pinned request, without opening public API search or mislabeling the minimal `SearchResult` as a complete Model card. A user can submit an exact Model name or provider model ID, receive canonical Model identities in the selected publication, and navigate by stable ID to the existing Model Facts page.

## Fixed boundary

- First-page public URL state is normalized `q`; continuation state is exact `q`, returned `cursor`, and its validated stable publication ID. Cursor and publication are jointly required. Every query response is `private, no-store`.
- The internal query is exact canonical `q`, `record_type=model`, `limit=20`, then optional cursor, with no leading `?`.
- The signed request carries only canonical query/publication identity and authentication fields after frontend transient limiting.
- API authentication completes before any source-address, limiter, resolver, cache, or query capability is read.
- Live ingress is local-only; test, preview, and production remain closed. The executor reuses the existing normalized request and merged exact-search adapter with a distinct local-only cursor key.
- Search has no Cache API, ETag, retry, analytics, telemetry, request correlation, or persistence.
- API and frontend share one closed 65,536-byte `SearchCollection` encoder and exact-byte response boundary.
- Pagination remains on the cursor-selected retained publication across a newly current head; expiry fails unavailable. SSR visibly identifies that results publication and renders exact Model matches as a simple evidence-backed identity list linked to stable-ID Model Facts, not as Model cards.
- Public API, preview, production, remote secrets/resources, semantic search, Variants, Providers, full cards, deployment, and release remain closed.

## Acceptance matrix

| Input/outcome | Required local result |
|---|---|
| Empty `q` | no search call; browse placeholder |
| Invalid/oversized `q` or cursor | no search call; accessible one-action reset |
| Exact canonical Model name | SSR `200` exact Model match list |
| Exact provider model ID resolving to a Model | SSR `200` exact Model match list |
| No exact Model match | SSR `200` explicit empty state and reset |
| Valid next cursor | SSR `200` next exact page; original query preserved |
| Proven invalid/tampered/expired cursor | invalid-link state and reset |
| Publication expiry or dependency failure | generic `503`; never fall forward |
| Any malformed header, body, bytes, UTF-8, JSON, contract, publication, filter, sort, limit, or semantic state | generic `503` |
| Preview/production or public API search | fixed closed response with no query effect |

## Non-claims

This phase does not complete Model cards, browse ordering, aliases, publisher or Provider-name discovery, Variants, prefix/keyword retrieval, semantic retrieval, natural-language intent, complete structured filters, public API search, remote cursor rotation, deployment, search acceptance, or any release gate. Every mapped traceability row remains `Planned`; the implementation supplies only local prerequisite evidence.
