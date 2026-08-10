# ADR 0047: Bind API-to-query reads to one validated deployment environment

- Status: Accepted
- Date: 2026-08-10
- Decision owners: Staff engineer, API lead, security and privacy lead
- Related requirements: `API-003`, `API-013`, `API-015`, `API-020`–`API-024`, `BE-003`, `CF-002`, `CF-005`, `CF-006`, `SEC-001`, `SEC-011`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-014`
- Extends: ADRs 0009, 0011, 0013, 0016, 0032, 0036, and proposed ADR 0046

## Context

The local API Worker reaches the private query Worker through the accepted `CATALOG_QUERY` service binding, and the query RPC boundary rejects a caller environment that differs from its protected `DEPLOYMENT_ENVIRONMENT`. The API request handler nevertheless supplied the literal `local` rather than an environment-owned binding. A future preview API configured against the preview query Worker would therefore still send `local` and fail every read; worse, a crossed API service binding could not prove that the API intended its own deployed environment.

ADR 0046 reserves `DEPLOYMENT_ENV=preview` for a future preview API but explicitly blocks deployable preview configuration until the API consumes and mismatch-tests that value. The fix must not infer environment from a public hostname or request, default a missing value, create remote configuration, or weaken the zero-visitor-data boundary.

## Decision

Every API Worker receives one environment-owned `DEPLOYMENT_ENV` text binding. Runtime accepts only the exact closed values `local`, `test`, `preview`, or `production`. The handler never trims, case-folds, coerces, aliases, or defaults the value. It snapshots the binding exactly once at request start, before any asynchronous effect, so limiter latency cannot create a configuration time-of-check/time-of-use gap. It withholds any configuration-failure response until applicable transient abuse controls have settled, then passes the captured value unchanged to both publication resolution and the subsequent read envelope.

Limiter failure or malformed capability returns the existing static `503`. A missing, inaccessible, malformed, or unsupported environment then returns a separate static `503` before any query RPC. Protected-configuration failure takes precedence over a clean limiter denial, consistent with ADR 0044; a denial returns `429` only when the environment is valid. Planned validation, method, preflight, and not-found responses remain withheld until both boundaries have succeeded. Errors never echo the environment value, binding exception, source address, secret, actor key, or infrastructure detail.

The query Worker remains the second enforcement point: each RPC compares its input environment to the query Worker's protected `DEPLOYMENT_ENVIRONMENT` before D1 access. This equality is defense in depth, not proof of environment isolation by itself. Dedicated-account isolation, environment-specific Worker and service names, distinct data/search bindings, protected identities, and remote access probes remain required.

This decision's local configuration increment initially owned exactly `DEPLOYMENT_ENV=local`. Successor [ADR 0048](0048-unrouted-model-detail-protected-runtime.md) adds the separately validated local `PUBLIC_API_ORIGIN` and `API_TRANSPORT_POLICY` variables required by the still-unrouted Model-detail composition; it does not weaken this binding's exact value or environment/query continuity. The closed configuration validator rejects omission, any different local environment, crossed service names, and unapproved capability roots. Wrangler-generated declarations own the literal binding types. Preview and production deployable configuration remain absent and unauthorized.

The metadata handler now uses the existing hardened public-read limiter shared with Model detail. It bounds source and secret inputs, derives only request-lifetime HMAC actor keys, validates exact limiter outcomes, settles both applicable IPv6 controls, and gives a limiter fault precedence over denial. This creates no log, trace, metric, cookie, request identifier, browser state, visitor cache key, or durable visitor record.

## Consequences

- Local, test, preview, and production API builds can run the same source without a hidden `local` fallback.
- Crossed API/query environments fail before storage access and expose only the bounded public failure.
- The local Wrangler variables, generated types, privacy configuration policy, and predeployment digest are one reviewed unit; ADR 0048 owns the additive origin/transport tuple.
- ADR 0046's local `api_environment_plumbing` gate is replaced by the narrower `preview_api_query_environment_configuration_and_remote_mismatch_probe` gate. The topology remains non-provisionable, and its owner, legal, spending, jurisdiction, permission, smoke, rollback, limiter, retention, protected-environment, and deployment gates also remain pending.
- This decision authorizes local implementation and verification only. It creates no Cloudflare resource, route, secret, remote identifier, deployment workflow, production authority, or release evidence.

## Alternatives considered

- **Keep a source-code `local` constant:** rejected because it makes preview unusable and defeats environment continuity.
- **Infer environment from hostname, service target, request header, or query parameter:** rejected because request-derived deployment authority is spoofable and can introduce visitor input into a protected control.
- **Coerce or normalize arbitrary text:** rejected because aliases and whitespace/case repair hide configuration drift.
- **Rely only on service names or only on the query-side check:** rejected because both ends should state and verify the intended environment before D1 access.
- **Add deployable preview configuration now:** rejected because resource, identity, privacy, legal, spending, and deployment authorities remain closed.

## Validation

- Unit tests forward each exact environment through resolver and read envelopes, reject missing and hostile values without coercion, prove a single binding read, preserve protected-policy response precedence, and make no query call or clock read after invalid configuration.
- IPv4 and IPv6 tests exercise the shared transient limiter; both IPv6 controls settle, malformed/faulting outcomes fail closed, and no raw address or derived key escapes.
- At this increment the local configuration policy accepted only `DEPLOYMENT_ENV=local`; ADR 0048's successor policy preserves that exact value while adding exact local origin and transport literals. Wrangler type-drift checks require all generated literal bindings.
- Actual multi-Worker workerd tests prove the runtime API binding is `local`, a `preview` RPC into the local query Worker returns `integrity_failure`, and a matching `local` RPC proceeds to the expected storage-read failure in the empty fixture.
- Predeployment, privacy, type, Worker-runtime, documentation, traceability, and full verification gates must pass. Remote preview mismatch and cross-account isolation evidence remain pending.

Current Cloudflare references:

- [Environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
