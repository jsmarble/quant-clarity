# Phase 5I-B: Local named query service binding proof

## Status

Local Wrangler configuration and multi-Worker workerd verification complete under [ADR 0032](../decisions/0032-local-named-query-service-binding.md). This slice proves only the actual local API-to-query named-entrypoint JSRPC boundary. It does not expose public search, bind D1 to the API, configure remote resources, deploy a Worker, or advance any traceability status beyond `Planned`.

## Slice objective

Connect the existing storage-free API Worker to the existing closed `CatalogQueryService` through the exact local named service binding intended by the approved trust boundary, then prove that path in current workerd without changing public request behavior.

## Fixed boundary

| Concern | Phase 5I-B result |
|---|---|
| API binding | `CATALOG_QUERY` service binding only |
| Local target | `quant-clarity-query-local` |
| Entrypoint | Named `CatalogQueryService` |
| Transport | Local workerd JSRPC; no HTTP compatibility route |
| API storage | No D1, R2, Vectorize, AI, or pipeline binding |
| Query storage | Isolated auxiliary-worker D1 used only to prove the real call boundary |
| Public handler | Unchanged; `/v1/search` remains closed |
| Build artifact | Pinned Wrangler dry-run JavaScript bundle under ignored `apps/query/dist-worker/` output |
| Privacy | No cookies, persistence, request telemetry, visitor cache key, correlation ID, or visitor-derived durable state |
| Remote state | No account ID, resource ID, secret, provisioning, deployment, or production/preview binding claim |

## Runtime proof

`npm run test:workers:api` first compiles `apps/query/src/index.ts` with the pinned query Wrangler configuration in dry-run mode. The API Vitest configuration then loads that exact bundle as an auxiliary Worker with the service name referenced by `apps/api/wrangler.jsonc`, an isolated `SERVING_DB`, and local deployment environment.

The focused test calls both `resolvePublicationV2` and `readMergedExactSearchV2` through `env.CATALOG_QUERY`, typed with the shared internal `CatalogQueryRpcV2` interface that the named `CatalogQueryService` explicitly implements. Its `unknown` inputs and outputs preserve detached hostile-boundary validation rather than asserting trust across JSRPC. A mismatched protected environment is rejected before storage access. Valid local resolver and merged-read envelopes reach the real query implementation and its isolated, intentionally unmigrated D1 binding, which returns the static closed `read_failure` outcome. Together these outcomes prove the named RPC methods without a handwritten mock. Cloudflare's service-binding fetch capability still exists, but this slice adds and tests no query HTTP compatibility endpoint.

The same suite retains the existing public API runtime checks. No code path in `apps/api/src/request.ts` consumes `CATALOG_QUERY`; the incomplete `/v1/search` path remains a `404` with `private, no-store` and no visitor identifiers.

## Acceptance evidence

- Installed Wrangler `4.118.0` schema accepts the service `entrypoint` field and describes it as the named export of the bound service.
- Generated API Worker types include `CATALOG_QUERY: Service` and retain only the existing two rate-limit bindings; the manually supplied HMAC test secret remains local-only.
- The API workerd suite runs the actual dry-run query bundle as an auxiliary Worker and passes the named JSRPC calls.
- The blocking API-specific privacy policy accepts only the exact current local root and nested configuration shapes, including fully disabled observability, `CATALOG_QUERY`, `READ_LIMITER`, and `ROTATION_LIMITER`. Mutation tests reject missing and future roots, environment/preview/route/unsafe/secrets/cache/module/blob alternatives, nested additions, direct D1 and other capabilities, wrong/multiple services, and altered limiter values. This local API closed schema is not applied to the private query Worker; later production/preview shapes need an explicit reviewed update.
- Static configuration and privacy gates must continue to prove no direct API data binding, public observability, cookies, visitor persistence, request telemetry, or privileged capability.

## Remaining blockers

- Complete public search semantics, including all filters and later exact/keyword/semantic tiers.
- Public request/response composition, dedicated search limiting, production CPU/subrequest ceilings, and full conformance/failure acceptance.
- Distinct production and preview service names and data/search resources, remote binding proof, deployment, multi-PoP, load, and operational evidence.
- Semantic/Vectorize retained-hot namespace lifecycle and all release/legal/privacy accountability gates.

Every mapped requirement remains `Planned` until its complete local, remote, deployed, and release evidence is satisfied.
