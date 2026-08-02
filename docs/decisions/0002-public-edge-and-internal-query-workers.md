# ADR 0002: Separate the public edge API Worker from a non-routable query Worker

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, security lead
- Related requirements: API-001–API-027, BE-003, BE-007–BE-009, CF-002, CF-005–CF-008, SEC-001–SEC-003, SEC-007, OPS-001
- Supersedes: None

## Context

The public API must be anonymous and read-only, apply validation and abuse controls before cache lookup, and have no pipeline trigger or data-mutation capability. Directly binding the public entry Worker to D1, R2, Vectorize, Workflows, or Queues would enlarge its capability set. Cloudflare resource bindings are capabilities and D1 and Vectorize bindings do not expose a storage-level read-only mode to Worker code.

## Decision

Deploy two Worker services with separate code, configuration, identities, and bindings:

1. `api-edge` is the only publicly routed API Worker. It performs method and query validation, request-lifetime source-address rate limiting, CORS, asks the internal service for the active publication head, selects an eligible publication-and-stable-resource-keyed cache entry, response-size enforcement, security headers, and stable error mapping. It assigns no retained request ID and emits no public-request telemetry. It has no D1, R2, Vectorize, Workflow, Queue, Browser Rendering, provider credential, affiliate credential, or pipeline-control binding.
2. `catalog-query` has no public route or `workers.dev` exposure and is reachable only through a service binding. It implements an allowlisted, typed read interface over serving D1, publication-scoped Vectorize queries, and Workers AI query embeddings. Its source contains no mutation statements or vector mutation operations.

The frontend Worker applies the same validation and transient rate-limit policy at its public ingress before making a service-bound request to `api-edge`; the internal envelope contains no source address or actor key. Browser API calls exercise the public API boundary directly. Pipeline and publication Workers are separate deployments and share no service entry point with either read service.

Because Cloudflare D1 bindings remain technically read/write capabilities, compensate with isolation: bind `catalog-query` only to a disposable serving projection database, lint and test its SQL as SELECT-only, protect its deployment identity, and never bind it to canonical, evidence, or operational data. Revisit this decision if Cloudflare provides read-only data-plane bindings.

Official references:

- [Cloudflare bindings as capabilities](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Workers service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

## Consequences

- Compromise of the public API entry code does not directly expose storage or pipeline bindings.
- The query service remains replaceable and independently testable.
- Public caching and rate limiting stay centralized and cannot be bypassed by frontend SSR.
- There is one internal service hop, although service bindings avoid a public network round trip.
- The query Worker still has coarse D1/Vectorize capabilities; code and deployment isolation mitigate but do not eliminate that platform limitation.
- Contract compatibility between the two Workers becomes a release gate.

## Alternatives considered

- One public Worker with all read bindings: simpler, but grants the internet-facing service unnecessary mutation-capable bindings.
- Query D1 through the REST API with a read-only token: stronger storage ACLs, but adds a secret and network hop, loses binding and Sessions API advantages, and contradicts Cloudflare binding-first guidance.
- Serve all API data as R2 JSON: strongly read-oriented, but arbitrary filtering, sorting, pagination, and exact search at 100,000 offerings would be inefficient.
- Frontend Worker querying D1 directly: rejected because it duplicates public API policy and broadens the public trust boundary.

## Validation

- Assert from generated Wrangler types and configuration that `api-edge` has only approved bindings.
- Verify no public route or `workers.dev` endpoint exists for `catalog-query`.
- Static-analyze query SQL and Vectorize use to reject write operations.
- Test unsupported methods and internal operation names from the public network.
- Verify rate limiting and validation occur before any cache lookup or service-binding call.
- Run penetration tests proving the public Worker cannot trigger a Workflow, write a serving record, mutate a vector, or access canonical/evidence storage.
