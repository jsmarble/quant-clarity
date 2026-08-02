# ADR 0023: Integrate the first query tier through a closed local RPC boundary

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Staff engineer, API lead, search lead, security and privacy lead
- Related requirements: API-003, API-007, API-010, API-013, API-015, API-020, API-021, API-025, API-026, SRCH-002, SRCH-004, SRCH-006, SRCH-008, NFR-006, CF-002, CF-005, CF-006, CF-020, CF-023, SEC-001, SEC-007, PRIV-003, PRIV-006, PRIV-007, PRIV-011, QA-004, QA-005, QA-006
- Supersedes: None; implements a narrow local portion of ADRs 0013, 0016, and 0021 and narrows Phase 5B reader eligibility to the active head or current rollback candidate

## Context

ADR 0013 requires publication selection and the following serving read to preserve D1 Session bookmark continuity. ADR 0016 defines a closed API-to-query envelope but deliberately leaves its Worker transport unimplemented. ADR 0021 and Phase 5B add one canonical-rehydrating provider exact-name tier, but its caller previously supplied an already selected publication and no runtime boundary proved where that selection or bookmark came from.

The first integration slice must prove the query-side RPC entrypoint and the separate API adapter seam without widening the public API stub, inventing a service binding or production resource identifiers, or implying that one provider tier completes public exact, structured, or semantic search. A real API-Worker-to-query-Worker service-binding call remains pending. The slice also must not expose a generic fetch proxy, extensible method dispatcher, arbitrary SQL, or visitor-derived telemetry.

## Decision

### Named, two-method RPC surface

The non-routable query Worker exports one named `WorkerEntrypoint` for Cloudflare RPC. Its application protocol has exactly two callable methods:

```text
resolvePublicationV1(input)
readProviderExactNameTierV1(input)
```

Each method validates an own, plain, closed object and rejects missing, extra, inherited, malformed, or wrong-version fields with a static non-echoing result. The entrypoint has no public route and is not a generic fetch tunnel. The protocol admits no raw URL, query string, header block, source address, actor key, arbitrary operation name, SQL, mutation, pipeline control, credential, log context, or request-correlation identifier.

This slice is local-only: it adds no remote service binding, Worker name, D1 identifier, route, environment resource, secret, deployment, or provisioning action. The existing internet-facing `apps/api/src/request.ts` behavior remains unchanged and unavailable for catalog reads.

### Publication-resolution method

`resolvePublicationV1` accepts exactly:

```text
{
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: local | test | preview | production,
  requestedPublicationId: null | exact publication ID
}
```

The supplied environment must equal the query Worker's protected deployment environment. The method creates one D1 Session with `withSession("first-primary")` and executes one fixed, bound, SELECT-only statement. With no requested ID it may select only the active head. With an explicit ID it may select only the active head or the current rollback candidate. This is a deliberately conservative ADR 0013 hot subset; arbitrary `superseded` publications remain ineligible even though a later, separately proven hot-inventory policy may retain them.

The closed result is exactly one of:

- `selected`, carrying only the selected publication ID and the opaque Session bookmark;
- `publication_expired`, carrying only the current public publication ID;
- `publication_not_ready`;
- `integrity_failure`; or
- `read_failure`.

Malformed input and malformed or contradictory database results fail closed. A syntactically valid but unavailable explicit pin does not reveal its lifecycle or existence. The bookmark is obtained from the same Session after its selection query and is live-call-only.

### Bookmark-continuous provider exact tier

`readProviderExactNameTierV1` accepts exactly the protocol version, audience, environment, opaque bookmark, and one ADR 0016 `QueryServiceEnvelope`. It validates the outer method input independently and then accepts only an envelope that:

- selects the same environment and one exact publication;
- contains the closed `search` operation;
- has either no filters or exactly `record_type=provider`;
- uses the public neutral search sort `relevance, stable_id`;
- supplies the pinned exact/structured search plan with identical query, filters, and limit;
- sets semantic calls and candidates to zero and semantic degradation to `disabled`; and
- contains no unknown fields and has `continuation=null`.

The method anchors a new D1 Session with `withSession(bookmark)`, invokes only the Phase 5B fixed provider exact-name SELECT, and returns its bounded empty or provider page or a static closed error. The reader may fetch its existing one-row internal lookahead, but the RPC is first-page-only: it rejects every non-null envelope continuation and neither issues nor resumes an API/public cursor. It does not add model, variant, provider-model-ID, alias, prefix, keyword, filter-merge, semantic, offering, price, facet, or historical-status tiers. It neither reorders providers inside a model comparison nor trusts search projection facts without canonical rehydration.

The service result and bookmark remain inside the live RPC call chain. Neither may enter a public response, Cache API key or value, log, trace, metric, alert, analytics event, fixture derived from traffic, or durable visitor record.

### API adapter remains non-public

The API-side adapter accepts only an already constructed `NormalizedRequest`. It does not parse a raw `Request`, perform rate limiting, choose production ceilings, or alter `apps/api/src/request.ts`. It calls publication resolution, builds the closed ADR 0016 envelope, and calls the one provider exact tier only after successful selection. This establishes a local adapter seam without making `/v1/search` reachable.

## Consequences

- The query entrypoint and separate API adapter share a concrete, versioned RPC shape with no generic dispatch capability; an actual inter-Worker service binding remains unconfigured and unproven.
- A `first-primary` head decision and bookmark-anchored read can be exercised in real workerd/D1 while the bookmark stays out of every public and durable surface.
- The hot-publication policy is safe but intentionally incomplete: active and rollback candidate are supported; retained superseded publications await a complete inventory and expiry design.
- One exact provider-name tier can return canonical provider search records without suggesting that complete exact-first search, structured filters, semantic search, or public API conformance exists.
- The public API remains unavailable because its existing request runtime is unchanged and the adapter is not routed.
- All linked traceability statuses remain unchanged. This ADR is an implementation decision, not a PRD amendment or release approval.

## Blocking follow-up decisions and gates

Three P1 contract/product-integration blockers must be resolved before a public search route can use this slice:

1. **Incomplete search composition:** the global model-name, variant-name, provider-model-ID, alias, prefix/keyword, complete structured-filter, and exact-tier merge is absent. Provider exact-name results alone cannot satisfy `SRCH-001`–`SRCH-005`, `SRCH-009`, `API-008`, or `API-010`.
2. **Cursor tuple mismatch:** ADR 0016 public search cursors bind the public `relevance, stable_id` ordering, while the exact-tier continuation requires its tier, normalized-name ordering key, and stable ID. A follow-up ADR must define a complete merged-search continuation tuple and prove no duplicate, omission, or cross-publication continuation. Until then the RPC is first-page-only, rejects every non-null envelope continuation, and issues no API/public cursor.
3. **Empty-result degradation gap:** `semantic_degraded` currently exists on each `SearchResult`, not on `SearchCollection`. An empty exact result therefore cannot communicate the required disabled semantic state. A contract decision and generated-schema/OpenAPI change are required before an empty public search response can claim explicit degradation.

In addition, the dedicated exact/semantic search limiter policy, approved production CPU/subrequest/upstream/result/response ceilings, remote environment IDs and isolation inventory, public-query AI privacy gate, protected deployment configuration, deployed no-route proof, and zero-visitor-data/load/abuse acceptance remain pending. No production or preview values may be guessed in this ADR.

## Alternatives considered

- Add a generic `fetch` service binding or operation-name dispatcher: rejected because it would widen the query capability beyond two reviewed reads and make raw protocol forwarding easier.
- Resolve the head and perform the read on unrelated Sessions: rejected because it would not prove ADR 0013 replica continuity.
- Accept every `superseded` publication that happens to have rows: rejected because database presence is not a proven hot-inventory/expiry policy.
- Wire the adapter directly into the public API stub: rejected because the required limiter classes, production ceilings, complete search contract, cursor policy, and degradation representation are unresolved.
- Treat an empty collection as implicit semantic disablement: rejected because clients cannot infer a collection-level condition from absent result items.
- Reuse the provider-tier continuation as the public cursor tuple: rejected because the two orderings have different semantics and an implicit conversion could skip or duplicate results after tier merging.

## Validation

- The implementation exports only the two versioned methods on the named entrypoint and no generic dispatcher; source and type tests prove its no-public-route behavior, fixed SELECT-only statements, and rejection of DML, extra fields, forged environments, and visitor/credential fields. Explicit callable-surface enumeration remains pending with the inter-Worker binding test.
- Real workerd/D1 tests resolve an active head on `first-primary`, pass its actual bookmark into a second Session through the query Worker's named RPC export, read the exact provider tier, exercise an active switch and rollback, and reject unknown and ready-only pins without revealing their states. Unit/source evidence proves arbitrary superseded IDs are outside the closed SQL policy; a multi-activation workerd rejection and real API-to-query service-binding call remain pending.
- Adapter tests prove only an already normalized search request can cross the boundary, bookmark and publication values remain in the injected call chain, static errors do not echo inputs, and no query call occurs after resolution failure.
- Search-tier tests preserve the Phase 5B canonical/hash/integrity, normalization, bounds, neutrality, inactive exclusion, stable-page, and corruption checks.
- Privacy/source scans reject `console.*`, telemetry, cookies, browser persistence, raw query/header propagation, request IDs, arbitrary cache keys, and bookmark serialization in public-serving code.
- The local evidence above does not satisfy remote service-binding, production D1 replica, multi-PoP limiter, load, deployment, privacy/legal, semantic, or release acceptance. Every related traceability row retains its prior status.

Official references verified on 2026-08-02:

- [Cloudflare Workers RPC over service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Cloudflare D1 read replication, Sessions, and bookmarks](https://developers.cloudflare.com/d1/best-practices/read-replication/)
