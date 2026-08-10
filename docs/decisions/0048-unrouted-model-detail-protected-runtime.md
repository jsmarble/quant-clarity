# ADR 0048: Assemble the protected Model-detail runtime without routing it

- Status: Accepted
- Date: 2026-08-10
- Decision owners: Staff engineer, API lead, security and privacy lead
- Related requirements: `API-003`, `API-012`, `API-013`, `API-020`, `API-022`, `API-024`, `API-024A`, `BE-003`, `CF-005`, `CF-006`, `CF-008`, `SEC-001`, `SEC-007`, `SEC-008`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-014`
- Extends: ADRs 0011, 0013, 0016, 0032, 0044, and 0047, plus proposed ADR 0046

## Context

ADR 0044 and Phase 5O-B3 locally implement a closed Model-detail HTTP, limiter, query, response, and manual Cache API composition. That composition remains deliberately absent from the live API Worker export. Before route-opening can even be considered, the composition needs one non-request-derived runtime seam that supplies its environment, exact Cache API origin, transport policy, named query service, transient limiter capabilities, request-lifetime scheduler, clock, Web Crypto, and Cache API capability.

ADR 0047 already makes `DEPLOYMENT_ENV` an exact environment-owned API binding. It does not select the protected origin used to construct the headerless stable-ID cache key or the transport policy that controls HSTS. Supplying either value from the visitor URL, `Host`, a forwarded header, an alias, or a fallback would violate ADRs 0016 and 0044. Conversely, importing the Model-detail composition into the live Worker handler would open a public route before recovery, protected configuration, remote cache/service, load, privacy-accountability, and release evidence exists.

## Decision

The local API configuration owns one exact closed triplet:

- `DEPLOYMENT_ENV=local`;
- `PUBLIC_API_ORIGIN=https://api.example.test`;
- `API_TRANSPORT_POLICY=local_test`.

Runtime snapshots each value without trimming, case-folding, coercion, aliasing, hostname inference, or a default. The only accepted local tuple is the complete tuple above. Missing, inaccessible, additional, malformed, or crossed values fail closed. `PUBLIC_API_ORIGIN` is the protected exact HTTPS origin used only to construct the ADR 0016/0044 internal Cache API key; no visitor-controlled origin, URL, host, header, slug, query, or conditional value can modify it. `API_TRANSPORT_POLICY` selects the already accepted local/test renderer behavior and is checked against `DEPLOYMENT_ENV`; local responses omit HSTS as ADR 0044 requires.

An internal runtime adapter assembles the existing closed Model-detail composition from the validated triplet plus the API Worker's existing `CATALOG_QUERY`, `READ_LIMITER`, `ROTATION_LIMITER`, and `RATE_LIMIT_HMAC_KEY` capabilities, the runtime Cache API and Web Crypto implementations, one request-lifetime `waitUntil` scheduler, and one bounded clock read. It preserves the accepted order: request and protected capabilities are captured and validated once before asynchronous effects, and applicable transient limiters settle before any response. Limiter faults return the static limiter `503`; a global environment/transport mismatch then returns the static configuration `503` ahead of a clean denial; otherwise a clean denial returns `429`. A captured downstream capability/configuration failure—invalid origin or clock, or absent cache, scheduler, or query capability—is acted on only after limiter admission and a valid read plan, when it returns the static `503`. Once those capabilities are valid, ADR 0044's degradation rules remain unchanged: Cache API read faults become canonical misses, and cache-write or scheduling faults cannot replace a valid canonical representation. Only an admitted Model-detail read may resolve a publication, access Cache API, call the query service, read the clock, or schedule a cache write. Exceptions and malformed capabilities expose no private detail.

The adapter is internal and unrouted. `apps/api/src/index.ts` continues to export only the existing metadata handler, and live Model stable-ID and slug requests continue to return the existing closed `404` without Model-detail RPC or Cache API effects. There is no feature flag or configuration-only route switch.

Preview and production do not receive guessed values. The preview API's `PUBLIC_API_ORIGIN` and `API_TRANSPORT_POLICY` values remain `null` in the inert proposal; production configuration remains absent. A successor authority must select exact hosts/routes and prove the corresponding preview or production transport policy. A production policy cannot be selected before the custom-hostname and HSTS gate. A preview policy cannot be selected before the approved smoke-ingress, noindex, privacy, and exact-origin gates. The proposal adds `preview_api_public_origin_transport_and_remote_conformance` as a machine-owned pending gate, while the existing preview API/query environment-mismatch gate remains pending independently.

## Consequences

- The complete local Model-detail composition can be exercised with actual Worker bindings and runtime primitives without making it internet-routable.
- The trusted cache origin and HSTS decision cannot drift with request host material or an independently supplied call-site value.
- The API Worker retains no D1, R2, Vectorize, AI, Workflow, pipeline, mutation, credential-validation, or privileged diagnostic capability.
- The exact local Wrangler variables, generated declarations, zero-visitor-data validator, and predeployment digest remain one reviewed unit.
- Preview and production origin/transport selection, protected configuration, remote crossed-binding/cache probes, custom-hostname readiness, recovery admission, route opening, load evidence, provisioning, deployment, and release acceptance remain pending; the preview proposal records this through `preview_api_public_origin_transport_and_remote_conformance` without removing any earlier gate.
- This decision advances no traceability status and grants no owner, legal, spending, provisioning, migration, deployment, publication, or public-route authority.

## Alternatives considered

- **Use the visitor request origin or host for Cache API identity:** rejected because request-controlled values must not enter a reusable cache key.
- **Pass transport policy independently at each call site:** rejected because a crossed policy could emit the wrong HSTS behavior for the deployed environment.
- **Infer policy from a public hostname:** rejected because the request is not deployment authority and preview/production host decisions remain pending.
- **Open the Model route while adding the bindings:** rejected because recovery, remote, privacy, load, protected-configuration, and release gates remain incomplete.
- **Add a disabled route feature flag:** rejected because changing one configuration value would become an implicit, insufficiently reviewed route-opening authority.
- **Guess preview or production origins now:** rejected because the inert topology intentionally has no selected zone, host, route, or smoke mechanism.

## Validation

- Unit tests accept only the exact local triplet and reject omission, hostile accessors, additional values, coercible values, malformed HTTPS origins, and crossed environment/transport tuples without reflecting configuration.
- Effect-order tests prove limiter fault and protected-configuration precedence, one-shot capture, no request-host influence, no pre-admission cache/query/scheduler effect, and the unchanged static response boundary.
- Worker-runtime tests assemble the internal adapter's capabilities from the actual local variables, named query service, limiter bindings, Web Crypto, Cache API, and execution context, exercise the named query boundary separately, and prove the exported public Model path remains closed.
- Configuration checks require the exact local tuple, disabled pre-invocation cache and observability, no added storage capability, current generated types, and the reviewed predeployment digest.
- Format, lint, type, unit, Worker-runtime, privacy, predeployment, preview-plan, documentation, traceability, and full repository verification must pass. Remote preview/production and public-route evidence remain pending.
