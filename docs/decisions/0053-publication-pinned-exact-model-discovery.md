# ADR 0053: Add publication-pinned local exact Model discovery

- Status: Accepted for local implementation
- Date: 2026-08-10
- Decision owners: Staff engineer, frontend lead, API lead, security and privacy reviewer
- Related requirements: `FE-010`, `FE-013`, `FE-015`, `FE-016`, `SRCH-002`, `SRCH-006`, `SRCH-008`, `SRCH-009`, `API-003`, `API-007`, `API-010`, `API-013`, `API-025`, `API-026`, `BE-007`, `SEC-001`, `SEC-005`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-003`, `QA-004`, `QA-005`, `QA-009`, `QA-014`
- Extends: ADRs 0011, 0012, 0013, 0016, 0030, 0031, 0051, and 0052

## Context

The local query Worker and storage-free API already implement publication-continuous exact search over canonical Model and Variant names, provider model IDs, and Provider names. The composed operation validates hostile RPC output, uses one resolver bookmark, binds a maximum 15-minute cursor to the query, publication, filters, sort, limit, and complete exact-class/stable-ID continuation, and returns the closed `SearchCollection` contract with explicit semantic degradation. It remains outside the live API handler.

The website now obtains one canonical publication snapshot and can render canonical Model Facts by stable Model ID. Its home and Model-browse forms still terminate in a static “results unavailable” state. The existing search collection contains only identity, display-name provenance, match kind, and semantic-degradation state. It cannot satisfy the full evidence-backed Model-card projection in `FE-020` through `FE-027`; request-time per-result detail reads would introduce forbidden N+1 amplification.

This decision connects only the already-authoritative exact Model result seam to the local frontend. It does not call partial results Model cards, add a second search implementation, open public API search, introduce semantic retrieval, approve query embeddings, or authorize preview/production configuration.

## Decision

### Canonical local request

The first-page public Astro URL carries only `q`. A continuation URL carries exact `q`, opaque `cursor`, and the cursor page's stable `publication` ID in that order; cursor and publication are jointly required and neither is legal alone. The frontend normalizes the query to NFC and trims leading/trailing whitespace, requires 1–200 UTF-8 bytes with valid Unicode scalars, validates the publication ID with the shared closed grammar, and constructs one canonical internal raw query in this exact order:

1. `q`;
2. fixed `record_type=model`;
3. fixed `limit=20`; and
4. optional opaque cursor of 1–4,096 characters.

Shared API core owns internal query construction/parsing, while the shared domain publication boundary owns publication-ID validation. The platform `URLSearchParams` serialization must round trip exactly, so reordered keys, alternate encodings, duplicates, empty values, unknown parameters, an unpaired cursor/publication, a different record type or limit, and noncanonical query text fail closed. The raw internal query has no leading `?` and is at most 4,096 UTF-8 bytes, so that whole-query ceiling may impose a lower effective cursor length. Cursor tokens returned by this slice use the authenticated ASCII cursor grammar; arbitrary visitor cursor or publication text is never treated as authority. The frontend never forwards any other visitor query parameter, header, public URL, source address, actor key, cookie, referrer, user agent, or correlation value.

An empty public `q` performs no search read and retains the browse-placeholder state. An invalid or oversized `q` or cursor performs no search read and renders a one-action reset. These are local user-interface states, not canonical data absence.

### Signed admission and exact-search execution

After its normal transient public-ingress limiter, Astro may create one fresh `GET https://frontend-api.internal/v1/search?{canonical-query}` request. A first-page request carries the ADR 0051 three-header HMAC envelope plus the selected metadata publication ID. A continuation instead carries the exact validated publication ID paired with its cursor; the API's authenticated cursor reconciliation proves they agree before resolver or query effects. This preserves the retained old publication across a concurrent head rollover, while a no-longer-retained publication fails unavailable rather than being mislabeled as a bad link. The signature binds the exact raw query digest, path, method, environment, publication, and 30-second lifetime. Query, cursor, and continuation publication are live-call-only public read inputs; they are never logged, traced, measured, cached, persisted, or copied into an application artifact.

The API authenticates the internal origin, environment, signature, exact method/path/query/pin tuple, four-header shape, and empty body before reading source-address, public-limiter, resolver, cache, or query capabilities. Only `local` may admit this tuple; `test`, preview, and production remain closed at the live ingress and use local-mode harnesses for acceptance evidence. Every forgery, alteration, noncanonical query, missing pin, body, method, extra header, closed-environment attempt, or public-origin reserved header follows the existing fixed fail-closed boundary with no query effect.

After admission the API reconstructs a fresh identity-free Request containing only the canonical query and publication pin. It reuses `validateAndNormalizeRequest` and the existing `readMergedExactSearchFromQueryV1`; it does not create a parallel parser, resolver, cursor, or query path. Cursor HMAC uses a separate deterministic local-only keyring and never reuses the frontend-authentication key. Test, preview, and production have no fallback cursor key and remain closed pending protected secret inventory and rotation evidence.

The admitted executor performs no Cache API lookup or write, sends no conditional request, and emits no ETag. Every success and error is `private, no-store`. The exact response has a 65,536-byte ceiling, UTF-8 JSON, CORS/security headers, selected publication header and `Vary`, and one shared closed encoder. The encoder validates the complete `SearchCollection`, reconstructs its sole fixed key order, and supplies the exact detached bytes used by the API and rechecked by the frontend. Malformed or oversized output fails unavailable rather than returning a partial page.

### Frontend response and presentation

The frontend client has one 500-millisecond whole-operation deadline, no retry, no cache, bounded streaming, fatal UTF-8 decoding, strict header/status/body admission, complete `SearchCollection` validation, exact byte re-encoding, and exact expected-publication/filter/sort/limit/degradation equality. The fixed `SearchCollection` encoder, rather than newly current dataset metadata, owns the response schema contract. The client accepts only Model results, `record_type=model`, `relevance,stable_id`, limit 20, and semantic state `disabled`. A cursor failure is an invalid-link/reset state only when the complete fixed API error matrix proves it; an expired retained-publication window and every race, dependency, signature, media-type, byte, contract, publication, or unexpected-status failure is generic unavailable.

Successful SSR content is labeled “Exact Model matches” and visibly identifies the exact results publication. This prevents a retained continuation page from implying that old-pinned matches belong to a newly current site publication. Each item exposes only the evidence-backed display-name Fact, match class, observation time/evidence references where presented, and stable Model route identity. Its link is the already validated `/models/{stable-id}` path. The list is explicitly not a Model card and makes no `FE-020` through `FE-027` completion claim. It contains no provider name, provider price, serving precision, ranking, recommendation, affiliate action, or provider-derived order.

An empty exact result explains that no exact Model match was found and offers “Clear search.” A next-page link preserves only normalized `q`, the returned authenticated cursor, and that response's validated publication ID. Search, cursor, invalid, empty, and dependency states remain server rendered, keyboard reachable, script free, and `private, no-store`, with no cookie or browser persistence.

### Scope and continuation

This slice contributes local exact canonical-name and provider-model-ID discovery when they resolve to canonical Models. It does not claim aliases, publisher-name or Provider-name discovery, Variants, prefix/keyword search, punctuation-tolerance completion, semantic search, natural-language intent, complete filters, previous-page traversal, full Model cards, or search acceptance. Those remain visibly absent rather than simulated.

The next Model-card boundary must provide one bounded publication-time or batched canonical projection containing every `FE-020`–`FE-027` field and provenance without N+1 reads. Preview/production search additionally requires protected cursor-rotation secrets, retained recovery authority, remote conformance/load/privacy evidence, GDPR owner acceptance, and deployment authorization.

## Consequences

- Local users can traverse home/Model search to canonical Model Facts through the real web-to-API-to-query chain.
- Exact query text crosses only the transient signed service call and query operation required to answer it; it never becomes telemetry or cache identity.
- Existing exact ordering, winner suppression, eligibility, publication continuity, and cursor authority remain single sourced.
- The UI avoids presenting an under-specified search result as a compliant Model card.
- One search render performs the existing metadata call plus at most one search call; result selection performs a later independent Model-page request, not SSR N+1 hydration.
- Public API search, preview/production signed search, semantic retrieval, remote resources, deployment, and every traceability advancement remain closed.

## Alternatives considered

- **Render the current `SearchResult` as a Model card:** rejected because it lacks publisher, parameter, source-format, provider-count, and freshness Facts required by `FE-020` through `FE-027`.
- **Fetch Model detail once per result:** rejected because up to 20 additional service/D1 reads violate the bounded model-first read path and `BE-007`.
- **Open `/v1/search` publicly in the same slice:** rejected because dedicated public search limiting, remote cursor secrets, complete conformance/load evidence, and deployment gates are not satisfied.
- **Reuse the frontend HMAC as cursor authority:** rejected because authentication and public continuation rotation have distinct scope and compromise boundaries.
- **Cache query results:** rejected because raw free-text and every query/filter response must remain `private, no-store`.
- **Expose Provider or Variant results whose destination is incomplete:** rejected because selection must lead to a working canonical journey in this slice.
- **Pretend disabled exact fallback is complete search:** rejected because prefix/keyword, aliases, semantic retrieval, remaining filters, and full acceptance remain pending.

## Validation

- Shared-helper tests cover normalization, Unicode scalars, exact 1/200-byte query bounds, 201-byte rejection, empty/oversized cursors, the 4,096-byte whole-query ceiling, canonical URL serialization, reordered/alternate/duplicate/unknown parameters, and immutable detached parse output.
- API cryptographic and effect-order tests cover altered query/order/encoding/pin/cursor/signature, extra headers, body, method, environment closure, public reserved headers, and zero resolver/query effects on rejection.
- API/runtime tests cover exact canonical-name and provider-model-ID results, empty pages, pagination, cursor tamper/expiry/parameter mismatch, publication expiry, dependency failure, hostile JSRPC output, exact bytes, and the 65,536-byte ceiling through actual workerd bindings.
- Frontend tests cover canonical request construction, no visitor-context forwarding, 500-millisecond deadline, abort, no retry, bounded fatal decoding, exact status/header/body/contract/publication admission, cursor invalidity, empty/unavailable mapping, paired continuation state, and a current-publication rollover while an old publication remains retained.
- Browser tests cover home/Model exact search to stable-ID Model Facts, publication-continuous pagination, expired-old-publication failure, empty/reset, invalid/oversized inputs, hostile-value escaping, generic dependency failure, preview closure, keyboard accessibility, axe, 320-pixel reflow, no scripts, cookies, storage, service workers, or third-party requests.
- Full contract, type, lint, Worker-runtime, browser, privacy, environment, build, and repository verification is mandatory. Independent frontend/accessibility, security/API, correctness/architecture, and test reviewers approved the local implementation on 2026-08-10. This acceptance does not authorize public routing, remote configuration, provisioning, or deployment.
