# Phase 5O-B3: Public Model detail HTTP and stable-ID cache

Status: implementation in progress; B3-A admission and pre-open audit plus pure, unrouted B3-B Model-detail request and publication-bound response planners implemented locally; protected audit invocation/evidence, recovery admission, public rendering/routing, limiter integration, and cache increments pending

Primary requirements: `DATA-001`–`DATA-015`, `DATA-060`–`DATA-065`, `API-001`–`API-005`, `API-011`–`API-014`, `API-016`, `API-017`, `API-020`–`API-027`, `BE-002`, `BE-003`, `BE-007`–`BE-009`, `CF-008`, `CF-020`, `CF-021`, `CF-023`, `NFR-001`, `NFR-002`, `SEC-001`, `SEC-007`, `SEC-008`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `OPS-001`–`OPS-003`, `QA-004`, `QA-006`–`QA-008`, `QA-014`

Decision: [ADR 0044](../decisions/0044-public-model-detail-http-cache.md)

## Scope

B3 is the first public canonical Model detail vertical slice. It integrates the existing resolver V2 and `readModelDetailV2` authority into exact `GET|HEAD|OPTIONS /v1/models/{model_id_or_slug}` behavior, stable conditional JSON, a stable-ID-only Cache API boundary, and serveable-publication response admission.

The slice opens no collection, related-Offering, search, Variant, Provider, pipeline, operator, diagnostic, or mutation route. It provisions and deploys nothing. B2C-B recovery, remote resources, production origins and HSTS, controlled multi-PoP/load evidence, legal terms, GDPR accountability artifacts, and release acceptance remain separate gates.

## Required implementation increments

### B3-A — representation admission and API adapter

1. Add one deterministic exact validator that serializes the `ModelDetail` envelope for every canonical Model in a publication using that publication ID and schema version.
2. Accept at most 65,536 UTF-8 bytes per representation and fail the full-publication guard atomically at 65,537 without truncation.
3. Before route opening, audit every currently serveable active, rollback, and retained-hot publication with that guard.
4. Invoke a fresh guard inside the only activation/rollback head-mutation path immediately before mutation; run it for every recovery/rebuild target before any head mutation can make that target serveable.
5. Extend the API-side hostile-output adapter to `readModelDetailV2`, including strict stable-ID/slug input discrimination and exact provenance/model/canonical-slug validation.
6. Preserve V1 compatibility for its internal callers while the public route uses V2 only.

The guard applies to the only authorized application activation/rollback path. Privileged direct D1 administration remains break-glass authority outside the application-correctness boundary because D1 has no per-statement application ACL and the fixed switch-history trigger can apply a valid direct insert. B3-A must prove that the public API has no D1 binding; the non-routable query Worker has only the disposable serving D1 binding and fixed SELECT-only code with no mutation or arbitrary-SQL operation; the pipeline is unrouted and accepts no caller-supplied SQL; routine switches use the guarded fixed adapter; and query, pipeline-deployment, and direct-administration identities are separated. It must not claim database-enforced non-bypass or persist an admission receipt.

Local implementation evidence as of 2026-08-03: `packages/api-core/src/index.test.ts` proves the shared hostile-safe canonical snapshot and exact encoder boundary; `apps/pipeline/src/model-detail-admission.test.ts` proves bounded keyset scanning, count/hash/identity/contract checks, exact 65,536/65,537 behavior, and static hostile-D1 failure; and `apps/pipeline/src/serving-switch-v5.worker.test.ts` proves a corrupt candidate cannot mutate the head. The same Workers test now proves an actual A-to-B-to-C lifecycle audit covers C active, B rollback, and A retained-hot on one first-primary session. `apps/pipeline/src/model-detail-pre-open-audit.test.ts` proves bounded inventory, aggregate capacity rejection, head-drift rejection, and hostile-D1 failure classification. This closes the local implementation portion of B3-A item 3 and the authorized V5 application-path portion of items 1, 2, and 4. Recovery/rebuild parity, remote query/CPU evidence, and protected identity/configuration gates remain open.

The pre-open audit takes one D1 clock and exact head sentinel, validates a contiguous newest-first switch-history tail, selects the active, rollback, and complete literal seven-day retained-hot set (including publications reachable by a still-valid continuation horizon), preflights aggregate work, scans every selected publication through the identical admission path, and rejects head drift before returning. The local implementation ceilings are 64 publications, 1,024 recent switches plus one lookahead, 50,000 Models, 64 MiB of Model resource JSON, and 900 D1 statements. Any ceiling or incomplete history fails closed; catalogs that exceed a ceiling require a sharded protected orchestrator with a separately reviewed consistency design. These values are operational ceilings, not product coverage limits.

The function returning `passed` is ephemeral local evidence only. It persists no admission receipt and does not authorize opening the route. A later protected non-visitor release gate must invoke and record the result, and remote Paid-plan query, CPU, memory, and consistency evidence must pass before release.

### B3-B — public protocol and cache

1. Extend the existing bounded API request planner for exactly one Model identifier segment and no query marker or body.
2. Preserve validation-plan then primary/rotation limiter then response/publication/cache/query ordering on every method and failure path.
3. Return stable-ID/current-slug `200`, explicitly pinned historical-slug `200`, unpinned historical-slug `308` to the verified stable-ID path, and unmatched `404` with fixed non-reflective errors.
4. Generate exact JSON once, enforce 65,536 bytes, derive ADR 0016 ETag bytes, and share representation identity across GET/HEAD and stable/current/explicit-pin-historical forms.
5. Add stable-ID-only manual Cache API lookup/write at the protected origin after limiter and resolver effects. Treat the application-authorized cache as optional, corruption-prone storage and every cache failure as a canonical-query miss.
6. Explicitly disable pre-invocation Workers Caching for the public gateway. Keep invocation logs, traces, Logpush/Tail, analytics, cookies, correlation IDs, and custom telemetry disabled.
7. Align generated OpenAPI, CORS, response headers, errors, examples, privacy checks, and environment policy with ADR 0044.

Local request-planning evidence as of 2026-08-03: `apps/api/src/model-detail-request-plan.test.ts` proves exact GET/HEAD lookup plans, bodyless OPTIONS, lowercase Model stable-ID and 1–128-byte slug classification, explicit rejection of a bare query marker, bounded body/path/conditional failures, and fixed closure of unrelated routes.

Local publication-bound response-planning evidence as of 2026-08-10: `apps/api/src/model-detail-response-plan.test.ts` proves stable-ID/current-slug/explicitly-pinned-historical `200`, weak/list/star conditional `304`, unpinned-historical bodyless relative `308`, publication-bound `404`, current-publication `409`, and closed `503` outcome plans. It proves exact GET/HEAD representation identity, strong ETag reuse, cache-policy separation, fixed CORS/security headers, truthful publication-plus-`Vary` continuity, no identifier or diagnostic reflection, bounded-byte detachment, and fail-closed provenance, identity, byte-ceiling, and digest failures. The V1/V2 API adapters now preserve the already verified selected publication ID on `not_found` so the eventual `404` can remain publication-bound.

Both planners are pure and are not imported by the live Worker handler. Existing handler tests continue to prove Model stable-ID and slug paths return `404` without an RPC call. Environment-owned HSTS/Response rendering, limiter integration, public routing, Cache API behavior, workerd protocol evidence, generated OpenAPI alignment, and deployment remain pending.

## Fixed response matrix

| Outcome | Status | Body | ETag | Cache-Control | Publication | Location |
|---|---:|---|---|---|---|---|
| Stable ID found | `200` | canonical `ModelDetail` on GET; none on HEAD | strong | `private, max-age=0, must-revalidate` | selected | none |
| Current slug found | `200` | same bytes on GET; none on HEAD | same as stable ID | `private, no-store` | selected | none |
| Unpinned historical slug found | `308` | none | none | `private, no-store` | selected | relative stable-ID path |
| Explicitly pinned historical slug found | `200` | canonical `ModelDetail` on GET; none on HEAD | same as stable ID | `private, no-store` | selected | none |
| Conditional stable/current/pinned-historical match | `304` | none | strong | policy of originating identifier form | selected | none |
| CORS preflight | `204` | none | none | `private, no-store` | none | none |
| Invalid syntax, pin, query, or body | `400` | bounded error except on HEAD | none | `private, no-store` | none | none |
| Unknown identifier | `404` | bounded error on GET; none on HEAD | none | `private, no-store` | selected | none |
| Unsupported method | `405` | bounded error and `Allow: GET, HEAD, OPTIONS` | none | `private, no-store` | none | none |
| Expired/unavailable exact pin | `409` | bounded error on GET; none on HEAD | none | `private, no-store` | current only | none |
| Oversized request | `413` | bounded error except on HEAD | none | `private, no-store` | none | none |
| Rate denied | `429` | bounded error on GET; none on HEAD | none | `private, no-store` | none | none |
| Limiter/publication/query/integrity unavailable | `503` | bounded error on GET; none on HEAD | none | `private, no-store` | only when truthful | none |

All rows include the fixed CORS and security headers appropriate to their status. Every outcome that includes a truthful selected/current publication also includes `Vary: X-QuantClarity-Publication`. `OPTIONS` fixes `Access-Control-Max-Age: 600`; no response enables credentials or sets a cookie. Public production and preview HTTPS responses carry their environment-owned HSTS policy; only local `.test` omits it.

## Cache contract

- Pre-invocation Workers Caching: explicitly disabled for every public-gateway environment.
- Manual Cache API: data-center local, optional, stable-ID detail only.
- Key: protected exact HTTPS origin plus format version, publication ID, `model`, canonical stable ID, and `json`.
- Lookup request: newly constructed headerless GET; never cloned from public input.
- Internal object policy: `public, max-age=300, must-revalidate`.
- Public stable-ID policy: `private, max-age=0, must-revalidate`.
- Public slug/redirect/error/preflight policy: `private, no-store`.
- Forbidden object inputs: raw URL, request host, forwarded headers, slug, query, conditional value, cookie, authorization, address/prefix/key, user agent, referrer, correlation ID, or cache telemetry.
- No stale-on-error, stale-while-revalidate, purge dependency, hit/miss response header, redirect caching, or negative caching.

## Verification matrix

| Evidence | Required acceptance |
|---|---|
| Contract/OpenAPI | Stable/current/pinned-historical `200`, unpinned historical `308`, all fixed error rows, exact examples, CORS max age, header/status parity, JSON/YAML generation equality |
| Pure protocol | Strict path grammar, no query/body, bounded errors, GET/HEAD/OPTIONS only, exact effect-order spies |
| Limiter/privacy | IPv4 `/32`, IPv6 `/64` and `/48`, fail-closed keying, cache-hit limiting, no key/address beyond limiter capability |
| Publication | Active, rollback, retained-hot, exact pin, cutoff, switch, no fall-forward, one bookmark/horizon |
| Query adapter | V2 stable/current/historical, hostile provenance/model output, V1 compatibility, no submitted slug echo |
| Response admission | Pre-open every-serveable-publication audit, exact 65,536 acceptance, 65,537 activation/rollback rejection, recovery-target parity, no head mutation |
| Cache unit | Canonical key, host/header/query isolation, corruption validation, GET/HEAD sharing, no slug/error/redirect write, exception fallback |
| Pinned workerd | Real Cache API cold/warm, corrupted/oversized entry miss, conditional hit, failed put, switch/rollback namespace isolation |
| HTTP | Exact content lengths, bodyless HEAD/304/308/OPTIONS, ETag vectors, weak/list/star conditionals, stable/current/pinned-historical byte identity |
| Security/privacy | No D1 on API, no DML/public query route, no cookies/logs/traces/telemetry/correlation IDs, fixed security headers, privacy canaries absent from sinks |
| Repository gate | Format, lint, types, generated contracts, docs, environment, supply chain, unit/workerd/browser/build/privacy all pass |

## Non-claims and release blockers

Local B3 completion does not by itself complete `API-002`, `API-012`, `API-020`–`API-027`, `CF-008`, `CF-023`, `NFR-001`, `NFR-002`, `QA-004`, `QA-008`, `QA-014`, or any release gate. The complete resource set, remote D1/service/cache behavior, controlled cold/warm and tenfold profiles, multi-PoP cache-filled switch/rollback, NAT/IPv6 limiter evidence, production account privacy audit, DPA/transfer/subprocessor review, ROPA and other GDPR accountability decisions, legal/dataset terms, B2C-B recovery, RPO/RTO, protected configuration, provisioning, and deployment remain pending.
