# ADR 0032: Prove the local API-to-query boundary with a named service binding

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Product owner, staff engineer, API lead, query lead, security and privacy lead
- Related requirements: `API-003`, `API-010`, `API-013`, `API-025`, `CF-002`, `CF-005`, `CF-006`, `SEC-001`, `SEC-011`, `PRIV-006`, `PRIV-007`, `QA-004`
- Extends: ADRs 0002, 0011, 0016, 0023, 0030, and 0031

## Context

The API and query Workers already exist as separate source modules. `CatalogQueryService` is a closed named `WorkerEntrypoint`, and the API has storage-free adapter seams for its versioned methods, but no Wrangler service binding or multi-Worker runtime proof connected the two services. Unit tests and single-Worker query tests therefore could not prove that current workerd accepts the intended named-entrypoint JSRPC boundary.

This slice must not make incomplete search public. The API request handler does not yet compose the accepted local seams, `/v1/search` must remain closed, and the internet-facing API Worker must not receive D1 or any other data-store binding. Production and preview Worker names, remote resource identifiers, deployment, and release evidence are not authorized.

## Decision

The local API Wrangler configuration binds `CATALOG_QUERY` to service `quant-clarity-query-local` and explicitly selects the named export `CatalogQueryService`. The binding is the only API-to-query capability added by this decision. A blocking API-specific closed-schema policy requires the exact current local root fields and values, exact disabled observability objects, exact service object, and exact `READ_LIMITER`/`ROTATION_LIMITER` objects. Every other root field is rejected automatically, including environment overlays, routes/previews, unsafe or module/blob surfaces, secrets, caches, telemetry consumers, direct data/search bindings, AI, workflow, pipeline, and future unknown capabilities. The API Worker receives no D1 binding, and its request handler does not call the new capability in this slice. The closed schema applies only to the current local public API configuration; the query Worker retains its separate generic public controls and required private serving bindings, while future production/preview API shapes require an explicit reviewed policy update.

The generated API binding declaration records `CATALOG_QUERY` as a service binding. `@quant-clarity/api-core` owns the shared internal `CatalogQueryRpcV2` method surface, the query entrypoint explicitly implements it, and the API seam consumes it. Inputs and outputs intentionally remain `unknown` at this hostile serialization boundary; each side retains its existing detached validation. Runtime configuration fixes the concrete named entrypoint because Wrangler cannot infer another Worker's TypeScript class from a service name alone. Service bindings retain their platform fetch capability, but this slice adds no query HTTP compatibility endpoint and proves only the named RPC methods.

The API workerd suite compiles the actual query Worker with the pinned Wrangler using `deploy --dry-run`, then loads that JavaScript bundle as an auxiliary Miniflare Worker named `quant-clarity-query-local`. The main test Worker obtains the configured `CATALOG_QUERY` named-entrypoint binding and calls both `resolvePublicationV2` and `readMergedExactSearchV2` over JSRPC. The proof covers pre-D1 environment rejection plus valid local resolver/read envelopes reaching the auxiliary Worker's isolated, intentionally unmigrated D1 binding and failing closed. It is not a mock, in-process class call, network call, deployment, or remote-resource proof.

Wrangler telemetry is disabled for the dry-run command. Generated test bundles remain ignored local artifacts under the query Worker's `dist-worker/` tree. No request, cursor, query, source address, actor key, cookie, log, trace, metric, analytics event, telemetry event, cache key, correlation identifier, or durable visitor record is added.

## Consequences

- Current Wrangler schema and workerd now prove the exact local service name, binding name, and named entrypoint used by the intended trust boundary.
- The API remains unable to query D1 directly; only the auxiliary query Worker receives an isolated test D1 binding.
- Public behavior does not change. `/v1/search` remains unavailable until complete search, request/response composition, abuse controls, privacy gates, and public conformance are ready.
- Production and preview bindings still require distinct configured names and remote operational evidence before release.
- All mapped traceability rows remain `Planned` because this is local configuration and runtime evidence only.

## Alternatives considered

- Call `CatalogQueryService` directly in the API test process: rejected because it would not prove a service binding or JSRPC serialization boundary.
- Bind the API directly to serving D1: rejected because it violates the approved public/query Worker trust boundary.
- Add an HTTP route to the query Worker: rejected because the query Worker must remain non-routable and expose only allowlisted typed reads.
- Add a temporary public `/v1/search` route: rejected because exact-only local composition is not the complete approved public search product.
- Use a handwritten auxiliary mock: rejected because it would overclaim compatibility with the actual query Worker.
- Configure production/preview names or remote identifiers now: rejected because environment resources and deployment remain gated and unauthorized.

## Validation

- Validate `services[].binding`, `services[].service`, and `services[].entrypoint` against the installed Wrangler schema and regenerate API Worker types.
- Compile the actual query Worker with the pinned Wrangler in dry-run mode and load the output as a JavaScript auxiliary Worker.
- Call `resolvePublicationV2` and `readMergedExactSearchV2` through `env.CATALOG_QUERY` and prove named-entrypoint JSRPC reaches the real implementation and fails closed on environment mismatch and unavailable local schema.
- Prove the blocking API closed schema accepts the exact current local configuration and rejects missing/unknown roots, environment/preview/route/unsafe/secrets/cache/module/blob alternatives, nested observability additions, wrong or extended services, altered limiter namespaces/values/shapes, direct data/search/AI/workflow/pipeline capabilities, and future unknown fields without applying the API schema to the query Worker.
- Prove the API request handler is unchanged and `/v1/search` remains closed with `private, no-store`, no cookie, and no request identifier.
- Run type, generated-binding drift, environment, privacy, documentation, and focused worker-runtime checks.
- Keep remote-resource, deployment, multi-PoP, load, complete-search, operational, and release evidence explicitly unclaimed.
