# Phase 5P-D: unrouted Model-detail protected runtime

| Attribute | Value |
|---|---|
| Status | Locally implemented and Worker-runtime tested; public route, remote configuration, and deployment unauthorized |
| Decision | [ADR 0048](../decisions/0048-unrouted-model-detail-protected-runtime.md) |
| Requirements | `API-003`, `API-012`, `API-013`, `API-020`, `API-022`, `API-024`, `API-024A`, `BE-003`, `CF-005`, `CF-006`, `CF-008`, `SEC-001`, `SEC-007`, `SEC-008`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-014` |
| Release gates | Local prerequisite only; every affected traceability row remains `Planned` |

## Purpose

Bind the already closed Phase 5O-B3 Model-detail composition to real local Worker configuration and runtime primitives without changing the live API handler. This closes a local assembly gap only: it does not open `/v1/models/{model_id_or_slug}`, select any remote origin or transport policy, or satisfy recovery and release acceptance.

## Closed local configuration

The local API owns exactly:

| Binding | Local value | Use |
|---|---|---|
| `DEPLOYMENT_ENV` | `local` | API/query environment continuity and local policy identity |
| `PUBLIC_API_ORIGIN` | `https://api.example.test` | protected origin for the headerless publication/stable-ID Cache API key |
| `API_TRANSPORT_POLICY` | `local_test` | local response policy; HSTS omitted |

Runtime accepts the tuple only byte-for-byte. It does not normalize, coerce, default, or derive any member from a request, hostname, forwarded value, service target, or public route. The zero-visitor-data configuration gate rejects a missing, additional, or crossed variable. Wrangler-generated declarations bind the exact literals, and the predeployment manifest binds the parsed configuration digest.

The preview API retains `null` origin and transport values in the inert proposal, and production configuration remains absent. A successor authority must select exact HTTPS origins and their environment-matched transport policies only after the applicable zone/hostname, smoke-ingress, noindex, privacy, HSTS, permission, and isolation gates pass. The proposal adds the explicit `preview_api_public_origin_transport_and_remote_conformance` pending gate; the existing protected preview API/query environment configuration and remote mismatch probe also remains pending.

## Unrouted runtime seam

The internal adapter supplies the closed B3 composition with the exact protected tuple, named `CATALOG_QUERY` service, both transient limiter bindings, HMAC secret, Cache API, Web Crypto, execution-context scheduler, and bounded clock. Protected values and callable capabilities are captured and validated once before asynchronous effects without exposing them to the request planner or query envelope. A limiter fault remains the first released `503`; invalid global environment/transport policy is then a fixed private `503` ahead of a clean denial; otherwise a clean denial is `429`. A captured downstream capability/configuration failure—invalid origin or clock, or absent cache, scheduler, or query capability—is acted on only after limiter admission and a valid read plan, when it becomes the fixed private `503`. Once those capabilities are valid, ADR 0044 still treats Cache API read faults as canonical misses and prevents cache-write or scheduling faults from replacing a valid canonical representation. Only an admitted Model-detail operation may read the clock, resolve a publication, look up a stable-ID cache entry, call the SELECT-only query service, or schedule a cache write.

The cache origin is never the visitor origin. The adapter constructs no key from the request host, forwarded headers, raw URL, slug, query marker, conditional value, source address, actor key, cookie, authorization value, user agent, referrer, or request identifier. The API still has no D1 or other mutable/data-plane storage binding; `caches.default` remains optional, data-center-local, corruption-prone acceleration behind canonical validation.

The adapter is not imported by `apps/api/src/index.ts`. The exported Worker continues to serve only the metadata route; Model stable-ID and slug requests retain the existing static, no-RPC `404`. No dormant flag or configuration-only switch can open the route.

## Local proof

Unit coverage exercises exact and hostile binding values, single-read capture, environment/transport crossing, malformed origins, limiter/configuration precedence, request-host isolation, fixed errors, and the absence of cache, query, clock, and scheduling effects before the admitted boundary. Runtime coverage assembles the internal seam from actual workerd variables, limiter bindings, Cache API, Web Crypto, execution context, and named query Worker, exercises the named query boundary separately, and proves the public fetch export remains closed.

The local configuration validator owns the exact three-variable shape alongside the existing named query service, two limiters, disabled pre-invocation Workers Caching, disabled observability, and negative storage/AI/pipeline capability inventory. Generated-type drift, privacy, predeployment, preview-plan, documentation, and traceability checks keep those claims fail-closed.

## Gate disposition and non-claims

This slice completes only the local protected runtime-assembly prerequisite in Phase 5O-B3. It does not complete `API-002`, `API-012`, `API-020`–`API-027`, `CF-008`, `CF-023`, `NFR-001`, `NFR-002`, `QA-004`, `QA-008`, `QA-014`, or any release gate.

The inert preview proposal retains every false authority flag and absent remote identifier. Its API `PUBLIC_API_ORIGIN` and `API_TRANSPORT_POLICY` values remain `null`, and exact preview selection plus remote conformance remain machine-owned pending work. ADR 0045/product-owner recovery approval, schema-`1.14.0` recovery admission, protected audit invocation, remote D1/service/cache behavior, multi-PoP and load evidence, NAT/IPv6 acceptance, account privacy evidence, legal/GDPR accountability decisions, exact hosts/routes, provisioning, deployment, and release acceptance all remain pending. No traceability status advances.
