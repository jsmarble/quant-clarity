# Phase 5S: Signed frontend publication metadata

| Attribute | Value |
|---|---|
| Status | Locally implemented; remote secret, routing, publication, and deployment evidence pending |
| Decision | [ADR 0051](../decisions/0051-signed-frontend-api-metadata.md) |
| Requirements | `FE-009`, `API-003`, `API-015`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-009` |

## Objective

Replace the frontend's hard-coded dataset banner with canonical API metadata while preserving the rule that no visitor address, request data, or derived actor key crosses from the public frontend to the API service binding.

## Implemented boundary

The public frontend Worker keeps its existing source-prefix rate limit at ingress. Astro middleware then creates a fresh internal request rather than forwarding the sanitized public request. The internal request has a fixed unrouted origin and metadata path, no query, and exactly three reserved authentication headers. A canonical HMAC-SHA-256 envelope binds version, audience, environment, method, path, query digest, optional publication pin, issue time, and exact 30-second expiry.

The API validates the internal origin, canonical encoding, route tuple, clock window, environment, and current/next verification key before reading a source-address or public-limiter capability. The bypass is confined to an authenticated unpinned, query-free `GET /v1/metadata` that already passed frontend ingress control. Every other signed or invalid internal-origin tuple is a static `404`. A public-origin request carrying reserved headers remains subject to its normal limiter and then returns a static `400`.

No public request header, address, prefix, HMAC actor key, cookie, query, referrer, correlation ID, or telemetry value enters the envelope. The internal authentication fields are request-memory-only and are not returned, logged, traced, metered, cached, or persisted.

## SSR representation

The metadata client aborts and degrades after 500 milliseconds, accepts at most 65,536 response bytes, and validates the exact closed `DatasetMetadata` contract. Non-HTML routes skip the subrequest. The shared layout exposes:

- publication ID plus a semantic UTC generation/refresh `<time>` value when canonical metadata is available;
- an explicit not-yet-published state only for the exact bounded `publication_not_ready` error representation; or
- a static temporarily-unavailable state for every transport, authentication, decoding, size, status, or contract failure.

Models and providers render counts from the same middleware snapshot while distinguishing published zero, published nonzero with unavailable collection delivery, not published, and dependency unavailable. Informational pages now render through SSR so their global status cannot be frozen at build time. HTML remains script-free and `private, no-store` with the existing cookie stripping, security headers, no-index preview behavior, and browser-persistence tests.

## Secret and environment inventory

`FRONTEND_API_HMAC_CURRENT` is reserved on web and API. Optional overlap slot `FRONTEND_API_HMAC_NEXT` is API-only. Rotation stages a future key as API next, updates web current while either API slot can verify it, then promotes that key to API current and may retain the former key as next through rollback. No value may cross environments. Local development has one explicit local-only fallback. Preview and production fail closed until protected values are installed under separately authorized deployment work.

The preview plan and logical environment inventory continue to say unprovisioned and unauthorized. This phase neither writes secret values nor adds them to tracked Wrangler variables.

## Local acceptance evidence

- cryptographic unit matrix for canonical bytes, key rotation, tampering, skew, expiry, and bounded replay;
- frontend client matrix for identity-free headers, bounded parsing, contract validation, and three-state degradation;
- API handler matrix for authenticated bypass, public limiting, forgery rejection, and no canonical read on rejection;
- actual workerd web-to-API-to-query execution for published nonzero, published zero, not-published, and dependency-unavailable states;
- raw SSR/browser accessibility and zero-persistence coverage through the public-site suite; and
- environment, preview-plan, privacy, type, build, and full repository gates.

All mapped traceability rows remain `Planned`. Remote secret installation, authenticated web-to-API execution in preview, published dataset state, website/API publication equality, operational monitoring evidence, performance acceptance, and deployment remain pending.
