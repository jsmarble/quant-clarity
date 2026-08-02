# Phase 5D: local query RPC and bookmark continuity

| Attribute | Value |
|---|---|
| Status | Implemented local decision and runtime evidence; real inter-Worker binding, public integration, deployed evidence, and release acceptance remain pending |
| Decision | [ADR 0023](../decisions/0023-local-query-rpc-and-bookmark-continuity.md) |
| Requirements | `API-003`, `API-007`, `API-010`, `API-013`, `API-015`, `API-020`, `API-021`, `API-025`, `API-026`, `SRCH-002`, `SRCH-004`, `SRCH-006`, `SRCH-008`, `NFR-006`, `CF-002`, `CF-005`, `CF-006`, `CF-020`, `CF-023`, `SEC-001`, `SEC-007`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-005`, `QA-006` |

## Slice boundary

Phase 5D implements two separately tested seams: a query-side named RPC `WorkerEntrypoint` around the Phase 5B provider exact-name reader, and an API-side adapter from the Phase 5A normalized envelope to that closed RPC shape. No service binding connects the two Workers yet. The query protocol is closed to `resolvePublicationV1` and `readProviderExactNameTierV1`. Publication resolution uses a `first-primary` D1 Session and returns its live-only bookmark; the read starts a second Session from that bookmark.

The resolver accepts only the active head or current rollback candidate. That conservative subset does not claim a complete ADR 0013 hot-publication inventory and does not admit caller-selected arbitrary `superseded` rows. The provider operation remains the neutral tier-3 exact-name candidate path with canonical rehydration, default active-provider exclusion, fixed SELECT-only SQL, and semantic processing disabled.

The API adapter starts only from an already validated `NormalizedRequest`. It is not called by the internet-facing request handler. `apps/api/src/request.ts` remains the unavailable metadata stub, and this slice adds no public `/v1/search`, remote binding, resource identifier, route, secret, provisioning, migration, or deployment.

## Closed protocol

| Method | Closed input | Closed result |
|---|---|---|
| `resolvePublicationV1` | Version 1, fixed audience, exact environment, nullable exact publication pin | Selected publication plus opaque bookmark, generic expired plus current publication, not ready, integrity failure, or read failure |
| `readProviderExactNameTierV1` | Version 1, fixed audience/environment, opaque bookmark, one ADR 0016 search envelope | Bounded empty/provider page or static error |

The read envelope permits only search, no filter or `record_type=provider`, the exact public neutral search sort, zero semantic calls/candidates, explicit semantic disablement, and `continuation=null`. Unknown or inherited fields, arbitrary operations, SQL, URLs, raw query strings, headers, actor keys, credentials, mutation/control inputs, and telemetry context fail before D1. The environment is checked on both method input and envelope.

This slice is first-page-only. The Phase 5B reader may use its bounded one-row internal lookahead, but the RPC rejects every non-null envelope continuation and neither issues nor resumes an API/public cursor.

## Verification boundary

Local unit and workerd/D1 evidence for this slice must prove:

1. the named entrypoint exposes only the two RPC methods and no public application read route;
2. the resolver uses one fixed `first-primary` Session query and returns that Session's bookmark;
3. the reader anchors a new Session at the supplied bookmark before the fixed Phase 5B SELECT;
4. active selection, explicit active pin, rollback-candidate pin, switch, rollback, no-result, and canonical provider result behavior;
5. fail-closed handling for malformed inputs/results, unknown and ready-only pins, corrupt canonical/projection rows, extra fields, wrong environment, and D1/bookmark failures, plus unit/source proof that arbitrary-superseded IDs are ineligible;
6. the API adapter performs no read after resolution failure and never makes the existing public request handler reachable; and
7. bookmarks, query text, and internal envelopes remain live-call-only, with no logs, traces, analytics, correlation IDs, cookies, browser persistence, cache writes, or durable visitor artifacts.

Passing those tests is narrow local/runtime evidence only. A real API-to-query auxiliary or remote service-binding test, multi-activation arbitrary-superseded workerd rejection, remote service-binding configuration, real preview/production D1 bindings and replica behavior, multi-PoP behavior, production load, resource isolation, deployed no-route and observability settings, and every composite release gate remain pending.

## Phase 5E follow-up resolution

[ADR 0024](../decisions/0024-search-collection-semantic-degradation.md) and [Phase 5E](phase-5e-search-collection-degradation.md) resolve the empty-result representation blocker recorded by this slice. `SearchCollection.meta.semantic_degraded` is now the required authoritative collection state, including for empty fallback, and every `/v1` result retains an identical compatibility mirror. That contract-only resolution does not make the public route reachable, decide provider-only semantic applicability, or complete runtime degradation evidence.

## Remaining P1 blockers before public integration

- **Complete search tiers and filters:** model, variant, provider-model-ID, alias, prefix/keyword, structured-filter, and deterministic global tier-merge paths are not implemented. A provider exact-name tier is not the public exact-first search contract.
- **Cursor tuple:** the public `relevance, stable_id` cursor tuple and the exact-tier `tier, normalized-name, stable-ID` continuation are not interchangeable. A follow-up ADR must define merged pagination before a public cursor can be issued or consumed; Phase 5D therefore remains first-page-only.
Dedicated search limiter classes and thresholds, approved production ceilings, public-query AI privacy/legal approval, remote resource IDs, checked environment inventory, protected deployment configuration, and deployed abuse/privacy/load evidence are also blockers. These are correctness gates, not deferred polish.

## Non-claims and traceability

This slice does not complete public search, cursor pagination, complete structured filtering, semantic retrieval, API conformance, API capacity, caching, deployed rate limiting, production ceilings, or release acceptance. It makes no PRD amendment and authorizes no Cloudflare mutation. All linked traceability statuses remain unchanged.
