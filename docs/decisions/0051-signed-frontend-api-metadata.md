# ADR 0051: Authenticate identity-free frontend metadata reads

- Status: Accepted for local implementation
- Date: 2026-08-10
- Decision owners: Staff engineer, privacy and security lead
- Related requirements: `FE-009`, `API-003`, `API-015`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-009`
- Extends: ADRs 0002, 0011, 0012, 0013, 0036, and 0047

## Context

The API already serves canonical publication metadata through `/v1/metadata`, but the Astro frontend displayed a hard-coded pending state. A normal service-binding fetch could not safely reuse the API's public limiter because the frontend must not forward a visitor address or derived actor key. Trusting the service binding alone would also leave no route-, environment-, or time-bound proof at the API ingress.

The approved API design requires an unrouted audience host and a signed, short-lived envelope containing no visitor identity. This slice implements that boundary for the first frontend canonical read without opening another data route, provisioning secrets, or deploying.

## Decision

The frontend rate-limits the original public request before Astro executes. Its SSR middleware then sends a new `GET https://frontend-api.internal/v1/metadata` request over the existing `API` service binding. That request contains only three reserved authentication headers. It never copies public request headers, source addresses, actor keys, cookies, referrers, queries, or correlation identifiers.

The canonical version-1 JSON envelope fixes key order and binds:

- audience `quantclarity-api` and the closed deployment environment;
- `GET` or `HEAD`, exact path, SHA-256 of the exact raw query, and optional validated publication ID;
- safe-integer issue and expiry milliseconds with an exact 30-second lifetime.

The UTF-8 envelope bytes are base64url encoded and authenticated with HMAC-SHA-256. The verifier accepts at most five seconds of future clock skew and accepts an identical non-mutating replay only through the inclusive expiry instant. Encoding is canonical and bounded; altered route, query, method, pin, audience, environment, timestamps, signature, origin, or noncanonical encoding fails closed. The separately bounded `current`/`next` slot header is an untrusted verification-order hint: changing it cannot grant authority and the API reports the slot that actually verified.

`FRONTEND_API_HMAC_CURRENT` is the web signing key and API primary verification key. API-only `FRONTEND_API_HMAC_NEXT` is an optional overlapping verification key. The API tries the header-selected slot first and the other installed slot second, returning which slot actually verified. Rotation stages B as API next while web/API current remain A, changes web current to B while the API accepts B through next, then makes B API current and may retain A as next through rollback. Values must be at least 32 UTF-8 bytes, shared only where required inside one environment, and distinct between environments. The existing local-only code constant permits deterministic local development; preview and production have no fallback. The inert inventories reserve only the binding names and still contain no secret value or deployment authority.

The API distinguishes the unrouted internal origin before reading any source-address or public-limiter capability. Only an unpinned, query-free `GET /v1/metadata` with a valid signature is admitted without a second source-address limiter because the public frontend already performed the applicable limiter and deliberately removed identity. Every other signed tuple and every invalid internal-origin request receives a static `404` and does not reach canonical data. Reserved internal headers on the public API origin remain public requests: they pass the normal public limiter first and then receive a static `400`.

Astro SSR validates the response as the closed `DatasetMetadata` contract under the existing 65,536-byte ceiling. The service-binding call has a 500-millisecond deadline and abort signal; non-HTML routes skip it. SSR renders three accessible global states: published with the canonical publication ID and UTC generation/refresh time, not yet published only for the exact closed API error, or temporarily unavailable. Model and provider pages distinguish those states and never turn unavailable into zero or contradict a valid publication. Every HTML page is SSR so the global state is not frozen into a build artifact. Dependency, timeout, signing, decoding, media-type, size, status, and contract failures degrade to unavailable without disclosing details.

## Consequences

- The website and API now have a locally implemented same-publication metadata seam without forwarding visitor identity.
- The internal call adds one bounded service-binding subrequest per SSR page. No cache, persistence, telemetry, cookie, browser script, or new public route is added.
- Static informational pages become SSR representations and retain `private, no-store` HTML behavior.
- Remote secret installation, route/topology conformance, deployed same-publication proof, real publication data, and production release remain blocked.

## Alternatives considered

- **Forward `CF-Connecting-IP` or a derived limiter key:** rejected because the API does not need visitor identity after frontend admission and the zero-visitor-data boundary forbids propagation.
- **Trust the service binding without an envelope:** rejected because it does not authenticate environment, route, query, pin, or freshness at the receiving Worker.
- **Call the public API hostname from SSR:** rejected because it leaves the private binding path, duplicates public ingress policy, and still requires visitor-address handling.
- **Persist replay nonces:** rejected because reads are non-mutating and the accepted 30-second residual replay window avoids adding public-edge state.
- **Keep a build-time pending banner:** rejected because it cannot represent the canonical active publication and would make website/API continuity untestable.

## Validation

- Unit tests cover canonical encoding, exact replay boundary, future skew, current/next rotation, weak keys, malformed encoding, signature failure, and method/path/query/pin/origin/environment alteration.
- API tests prove valid identity-free admission, fail-closed forgery, public reserved-header limiting, and no query-service effect on rejection.
- Worker-runtime tests execute the signed ingress through the real API-to-query service binding.
- Browser/runtime tests execute the full web-to-API-to-query chain for published nonzero, published zero, not-published, and dependency-unavailable states.
- Frontend tests prove bounded closed-contract parsing, exact three-header forwarding, no visitor headers, explicit pending/unavailable states, and failure degradation.
- Browser, accessibility, privacy, generated-type, environment-inventory, build, and full verification gates remain required.
