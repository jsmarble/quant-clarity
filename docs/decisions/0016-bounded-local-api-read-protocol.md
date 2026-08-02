# ADR 0016: Bound the local API read protocol before runtime integration

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Staff engineer, API lead, security and privacy lead
- Related requirements: API-001–API-018, API-020–API-026, SRCH-002, SRCH-004–SRCH-009, CF-023, SEC-001, SEC-007, SEC-011, PRIV-003, PRIV-004, PRIV-006, PRIV-007, PRIV-011, QA-004, QA-005, QA-006, QA-014
- Supersedes: None; clarifies ADRs 0002, 0007, 0009, 0011, and 0013

## Context

The accepted public API design fixes the read-only routes, publication pin, cursor contents, cache boundary, source-address rate-limit policy, and public/query Worker separation. The first Worker skeleton proves a privacy-first failure boundary, but it performs rate limiting before bounded method, path, and parameter validation. The design also leaves the cursor wire encoding, service-binding envelope, conditional-response derivation, trusted cache origin, and unapproved runtime ceilings too implicit for independent implementations to remain compatible.

Phase 5A needs deterministic local decision code without pretending that a fake query service, local HMAC, or synthesized cache identity proves D1 Sessions, service bindings, Cache API behavior, Cloudflare rate limiting, or deployed privacy controls. Public semantic query processing remains separately privacy- and legal-gated.

## Decision

### Pure decision boundary and effect order

`packages/api-core` is a pure, storage-free decision kernel. It imports no Cloudflare storage, search, cache, AI, Workflow, Queue, Browser Rendering, provider credential, or pipeline-control capability. Runtime effects are supplied through narrow injected interfaces and remain owned by the separate edge and query Workers.

For every public request, the edge performs bounded parsing and validation first. Validation produces either a closed read plan or a bounded error plan; it does not immediately return the error. The edge then derives request-lifetime `ip-v1` limiter keys, consumes the applicable route-cost and IPv6 rotation buckets, and discards every reference to the source address, prefix, and actor keys. If the limiter succeeds, the edge returns the already-selected validation error or proceeds to publication-head resolution. Head resolution, cache selection, and the query service are therefore unreachable before both validation and rate limiting. If the source address, HMAC key, or limiter cannot be used safely, the request fails closed without a head, cache, or query call.

This preserves the requirement that every response path is abuse-controlled without allowing malformed requests to trigger unbounded parsing or downstream work. Local effect-order tests observe only named capability calls; live requests produce no telemetry.

### Normalization and authenticated cursors

User-supplied text accepted by the API is trimmed and normalized to Unicode NFC before UTF-8 byte bounds, allowlist validation, canonical comparison, or hashing. This normalization does not merge materially distinct model releases and is not the complete exact-search alias policy.

Cursor version 1 is `base64url(payload) + "." + base64url(HMAC-SHA-256(payload))`. The UTF-8 payload is a JSON array in this fixed order:

1. literal `quantclarity-cursor-v1`;
2. non-secret key ID;
3. publication ID;
4. closed resource operation;
5. query hash or null;
6. normalized filter entries sorted by filter name, each with its values in canonical order;
7. the complete normalized sort list;
8. page limit;
9. the complete last sort tuple;
10. the last stable resource ID;
11. issued-at UTC epoch seconds; and
12. expiry UTC epoch seconds.

The query hash is lowercase SHA-256 over the UTF-8 tuple `quantclarity-query-v1 NUL NFC-normalized-query`. A hash is not anonymization and grants no storage or telemetry permission. The live normalized query may pass to the query service, but the cursor contains only its hash and every query-bearing response remains `private, no-store`.

The signer uses the injected current key. Verification accepts only the injected current and next key IDs during an explicitly bounded deployment overlap; unknown key IDs fail closed. Promotion makes the former next key current through protected secret configuration, never through a public request. Secrets are not serialized, logged, or returned. Cursor expiry is at most 15 minutes and the encoded token is at most 4,096 characters. Verification permits at most 30 seconds of future-issued clock skew and never extends the encoded expiry time. A cursor's resource, publication, normalized filters, sort, query hash, and limit are immutable. A following request may omit filters, sort, and limit, in which case the verified cursor values are reused, or supply exact matches. Search must resubmit the normalized `q` value because the cursor deliberately retains only its hash; that value must hash to the cursor's exact query hash. The page limit remains within the route maximum and cannot be increased or decreased while continuing a cursor.

### Closed service-binding envelopes and bookmark continuity

The API-to-query call is a versioned, closed, normalized envelope. It contains the operation version, environment and audience, selected publication, one typed resource operation, canonical filters and sort, bounded limit, optional cursor continuation, and the normalized live query only for search. It never contains a raw URL, raw query string, arbitrary SQL or operation name, request header block, source address, prefix, actor key, authorization or cookie header, user agent, referrer, or request-correlation ID.

Publication resolution returns an opaque D1 bookmark beside the selected head. A cache-miss read passes that bookmark to exactly one subsequent typed query operation, as required by ADR 0013. The bookmark and service envelope exist only in the live call chain and may not enter a public response, cache, log, trace, metric, event, alert, fixture derived from live traffic, or durable store. The local kernel can validate and route envelopes but cannot claim D1 replica continuity or a non-routable deployed service.

### Conditional responses and trusted cache origin

ETag format version 1 is a quoted lowercase SHA-256 digest of the UTF-8 tuple `quantclarity-etag-v1 NUL publication-id NUL representation NUL exact-representation-sha256`. The representation hash is computed from the exact response bytes after contract validation. GET and HEAD for the same representation have the same ETag. A matching `If-None-Match` may produce `304` only after validation, rate limiting, publication selection, and representation identity are established.

CORS allows exactly `If-None-Match` and `X-QuantClarity-Publication` request headers and exposes exactly `ETag` and `X-QuantClarity-Publication`. It remains non-credentialed with origin `*`.

The Cache API origin is a fixed, environment-owned exact HTTPS origin supplied through protected configuration and validated independently of any request. The request `Host`, forwarded host, raw URL, slug, query, cursor, or other visitor-controlled field cannot select or modify it. Only an exact path-only stable-ID detail representation may use the ADR 0013 publication-qualified reserved key after validation, rate limiting, and head resolution. Phase 5A produces a cache decision and identity only; it performs no Cache API operation.

### Required ceilings and semantic disablement

The kernel requires an injected, validated ceiling set for URL and body bytes, query bytes, filter/value counts, page and cursor size, result count, response bytes, planned CPU work, subrequests, upstream calls, and semantic calls/candidates. Injected values cannot exceed the approved public maxima, and both semantic ceilings must be zero while public semantic processing is disabled. Missing, invalid, internally inconsistent, or platform-incompatible ceilings fail closed. Local tests use explicit fixture ceilings. This ADR selects no production ceiling where the approved design does not already supply one; production values require controlled load evidence, current Cloudflare-limit verification, and protected environment configuration under `API-025`, `CF-023`, and `SEC-007`.

Public semantic query processing remains disabled. Search produces exact and structured plans with an explicit `semantic_degraded=disabled` state. No visitor query is sent to Workers AI, AI Gateway, Vectorize embedding, or another processor until `GATE-public-query-ai-privacy` receives current authorized privacy/legal evidence. This fallback contributes to `NFR-006`; it does not satisfy the mandatory semantic-search acceptance requirements or authorize release.

## Consequences

- Request validation is bounded before limiter work, while invalid, preflight, method-error, and ordinary response paths remain rate-limited before a response is selected.
- Cursor tokens and internal envelopes are deterministic across implementations, rotation-compatible, publication-pinned, and storage-free.
- Query text and cursor-derived values remain live request data subject to `private, no-store`; hashing does not turn them into retainable telemetry.
- Conditional responses and cache identities cannot drift with a visitor-controlled host or raw URL.
- Local code can prove closed decisions, ordering, and negative capability boundaries without acquiring storage or search bindings.
- Missing production ceilings and public semantic-processing approval remain explicit blockers rather than guessed defaults.

## Alternatives considered

- Return a validation error before rate limiting: rejected because malformed and unsupported public paths would bypass the required abuse-control policy.
- Rate limit before parsing any bounds: rejected because route-cost selection and safe rejection require bounded validation, and malformed input must not trigger unbounded work.
- Encode cursors as extensible objects with incidental JSON key order: rejected because independent implementations and rotations could disagree on signatures or parameter identity.
- Store normalized free text in the cursor: rejected because only an equality binding is needed and query-bearing responses already require strict no-store handling.
- Accept the request origin as the Cache API origin: rejected because visitor-controlled host material must not enter application cache identity.
- Select provisional production CPU, response, or subrequest limits without load evidence: rejected because cost and platform ceilings are correctness inputs.
- Enable semantic embeddings for local completeness: rejected because public query processing lacks the required current privacy/legal approval.

## Validation

- Use effect spies to prove bounded validation precedes limiter calls and that no head, cache, or query effect occurs before a successful limiter decision or after a validation error.
- Verify current/next cursor rotation, fixed ordering, NFC normalization, query hashing, exact parameter and limit binding, 15-minute maximum expiry, tamper rejection, and 4,096-character maximum.
- Reject raw URLs, arbitrary operation names or SQL, header blocks, source-address material, and visitor telemetry fields from every service envelope; prove bookmarks remain live-call-only.
- Produce stable ETag vectors from exact representation bytes; verify GET/HEAD equivalence, mismatched publications and representations, conditional `304`, and fixed CORS allow/expose headers.
- Reject request-derived cache origins, slugs, mismatched ID/resource pairs, query-bearing requests, cursors, and raw headers from cache identities.
- Fail closed on every missing or inconsistent injected ceiling and prove exact/structured search remains usable with semantic processing disabled and explicit degradation.
- Keep all affected traceability rows `Planned` until their complete runtime, deployed, privacy, abuse, load, and legal artifacts pass.
