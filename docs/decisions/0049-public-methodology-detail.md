# ADR 0049: Serve exact methodology metadata from the shared registry

- Status: Accepted for local implementation
- Date: 2026-08-10
- Decision owners: Staff engineer, API lead, query lead, security and privacy lead
- Related requirements: `FE-051`, `API-001`, `API-003`, `API-004`, `API-011`–`API-017`, `API-020`–`API-024`, `API-024A`, `API-025`, `API-026`, `BE-003`, `BE-007`, `BE-008`, `SEC-001`, `SEC-007`, `SEC-008`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-014`
- Extends: ADRs 0013, 0016, 0031, 0032, 0036, and 0047
- Supersedes: only the local/test `404` for exact registered GET/HEAD/OPTIONS on `/v1/methodologies/{version}`; unregistered versions, preview/production, and every other closed route remain unchanged

## Context

`FE-051` requires stable historical methodology versions, and the generated API contract already includes `MethodologyDetail` at `/v1/methodologies/{version}`. At decision time the route was closed. `DatasetMetadata` already publishes the selected publication's methodology version, effective time, and API URL from a closed methodology registry, but that registry had lived inside the query Worker while the detail encoder needs the identical authority. Duplicating it would allow metadata and the methodology detail route to disagree.

The existing `MethodologyDetail` contract is deliberately metadata-only: version, effective time, and stable API URL inside the ordinary detail envelope. It does not contain the human-readable methodology body, Model Facts, Offering Facts, or another canonical entity. The versioned Astro methodology page and material-change log remain the human-readable `FE-050`–`FE-052` surfaces.

The detail envelope also requires `publication_id` and `schema_version`. Those values cannot be invented by the API Worker or taken from the request. The implemented dataset-metadata route has a broader RPC that also reads publication summary counts, provider-slice notices, schedule data, and current policy versions. Reusing that broad operation for a methodology request would violate the closed-operation boundary and unnecessarily expose unrelated data to the adapter. The methodology route instead needs its own narrow publication-context read while retaining the identical resolver V2 eligibility rules.

## Decision

### One immutable registry

Move the existing code-owned methodology entries to one immutable registry in `@quant-clarity/api-core`. Both dataset-metadata assembly and methodology-detail encoding use the same exact lookup. Each entry contains only:

- the exact 1–64-character version accepted by the existing route grammar;
- one canonical RFC 3339 millisecond effective time; and
- the exact self path `/v1/methodologies/<version>`.

Lookup accepts only an own exact key and returns `null` for malformed, inherited, or unregistered values. Entries are immutable and append-only after a publication references them. Reusing a version for changed semantics, effective time, or path is forbidden; a material methodology change adds a version and the corresponding stable human-readable page/change-log entry. The registry is policy metadata, not a canonical fact table, and it stores no visitor or provider data.

### Exact local route

Only the registered form of this exact methodology route class is functional in the local and test environments:

| Request | Result after applicable validation and limiting |
|---|---|
| registered `GET /v1/methodologies/{version}` in local/test | exact `MethodologyDetail` JSON |
| registered `HEAD /v1/methodologies/{version}` in local/test | identical status and representation headers, no body |
| registered `OPTIONS /v1/methodologies/{version}` in local/test | existing fixed non-credentialed CORS preflight, no resolver or query read |
| syntactically valid but unregistered GET/HEAD/OPTIONS in every environment | static `404 resource_not_found` after limiting, with no resolver or query RPC |
| registered GET/HEAD/OPTIONS in preview/production | static `404 resource_not_found` after limiting, with no resolver or query RPC |
| query string, cursor, body, trailing slash, percent encoding, malformed path, or duplicate/malformed publication control | existing bounded static error |
| unsupported method | static `405` with `Allow: GET, HEAD, OPTIONS` |

The version is exact and case-sensitive. It is not normalized, decoded from percent encoding, trimmed, aliased, redirected, or interpreted as a canonical dataset identifier. The route accepts no filter, sort, page limit, cursor, request body, or visitor-selected representation. The existing optional exact `X-QuantClarity-Publication` and `If-None-Match` controls remain the only request controls for GET and HEAD.

ADR 0016 effect order remains binding. Bounded planning first validates the complete request and relevant headers, then performs an exact own-key registry-existence lookup and the environment gate to create a withheld response plan. Planning retains the validated version, not a live registry entry. No validation, registry, environment, or method error is released until the request-lifetime source-address limiter settles. A limiter fault returns the fixed limiter `503`; a clean denial returns `429` with `Retry-After`. Once admitted, an unregistered version or a methodology request in preview/production releases the fixed `404 resource_not_found` without resolver, query RPC, or Cache API. Registered local/test OPTIONS releases the fixed preflight without resolver or query RPC. Only registered local/test GET and HEAD proceed to publication resolution and the dedicated context read. Thus route closure is decided before publication work while limiter ordering prevents an early response bypass.

### Dedicated selected-publication context

An admitted registered local/test GET or HEAD preserves the requested publication pin, computes the same fresh `now + 15 minutes` horizon, and resolves through V2. Active, current rollback-candidate, retained-hot, expiration, cutoff, switch-race, and failure behavior remain exactly Phase 5M behavior.

After selection, the API invokes one dedicated `readMethodologyContextV1` named RPC with exactly the protected environment, service audience/version, selected publication ID, resolver bookmark, identical required-availability horizon, and the closed normalized methodology operation. The operation carries the exact already-registered version so the query service can validate it as part of the closed envelope and reject cross-operation or cross-version envelope reuse; the query service does not make the registry-existence decision. The request URL, headers, source address, actor key, conditional value, and other visitor material do not enter the context RPC.

The query Worker validates the exact already-registered methodology version as part of the operation envelope, fixed `sort=["version"]`, empty filters, null continuation/search plan, and closed one-item limit. It then opens one bookmark-continuous D1 Session and executes one fixed, parameter-bound, SELECT-only statement. Only publication ID and required horizon are bound; the methodology version never enters SQL. The statement rechecks the selected publication's retained-hot eligibility against the identical horizon and returns exactly one bounded context containing selected `publication_id`, selected `schema_version`, and the query Worker's protected exact public API origin. The origin comes from environment configuration, not D1. The query method rejects wrong audience/version/environment or operation, bookmark or horizon disagreement, missing/duplicate/ineligible publication state, malformed schema/origin, D1 failure, and changed publication with static closed outcomes. The context method does not consult the shared registry and cannot decide whether the requested historical version exists.

After the resolver and context read, the API treats the context as hostile: it snapshots an exact own-property shape, validates and detaches the publication ID and schema version, requires agreement with the resolver selection, and accepts only an exact HTTPS origin with no credentials, path, query, or fragment. The encoder then performs a fresh exact own-key lookup that revalidates the immutable registry entry before constructing the existing `MethodologyDetail` contract. It does not trust the earlier existence result as an entry, the public host, forwarded headers, the requested path as a registry record, or an independently supplied origin.

The requested historical methodology version is intentionally independent of the selected publication's own `methodology_version`. The selected publication supplies the envelope's current or explicitly pinned publication/schema context; the exact path selects an immutable historical policy record. Requiring equality would make old methodology URLs disappear when their last retained-hot dataset ages out, contradicting `FE-051`. A registered version may be returned only while a safe selected public publication exists, because the contract requires truthful publication/schema metadata. No safe active publication is `503 publication_not_ready`; an unavailable exact pin is the existing generic `409 publication_expired` with only the current publication header.

The response is exactly:

- `data.methodology_version`, `data.methodology_effective_at`, and `data.methodology_url` from the requested shared-registry entry plus the protected origin;
- `meta.resource="methodologies"`;
- the selected publication ID and schema version;
- exact `meta.sort=["version"]`; and
- exact empty `meta.filters`.

No prose body, change log, provider fact, canonical resource, evidence record, request value, or internal lookup detail is added. Unknown registered-field values are impossible; a malformed registry or hostile metadata result fails closed.

### Representation, conditional reads, and privacy

One shared encoder serializes exact UTF-8 JSON and fails closed above 4,096 bytes and the injected API response ceiling. After successful validation and encoding, the existing strong publication-qualified JSON ETag is computed from the selected publication and exact bytes. `If-None-Match` is evaluated only after limiting, publication resolution/read, registry validation, and representation construction. A match returns bodyless `304`; HEAD and GET share status and representation headers.

Every methodology outcome, including successful `200`, matching `304`, errors, and OPTIONS, uses exact `Cache-Control: private, no-store`. Successful `200`/`304` retain the generated methodology policy's `Vary: X-QuantClarity-Publication`; OPTIONS uses only the generated fixed preflight `Vary` dimensions. No outcome authorizes QuantClarity Cache API storage. CORS remains non-credentialed and fixed, and security headers follow the exact environment transport policy. No code logs, traces, measures, application-caches, stores, or echoes source addresses, actor keys, raw headers, request targets, conditional values, bookmarks, horizons, or errors. Public Worker observability and telemetry remain disabled.

### Authority boundary

This decision permits only local and test implementation of the registered methodology route. Preview and production deliberately retain the fixed `404`. It does not approve a remote origin, route, resource, migration, deployment, public publication, legal artifact, or traceability advancement. It does not open Model, search, OpenAPI, collection, or other detail routes and does not depend on or change ADR 0045.

## Consequences

- Dataset metadata and methodology detail cannot drift because one registry owns both.
- Historical methodology metadata remains addressable independently of retained-hot dataset age while still carrying truthful selected-publication envelope context.
- The storage-free API gains no D1 binding and the query Worker gains no DML, dynamic SQL, or new public ingress.
- The dedicated context RPC avoids exposing metadata-summary fields to a methodology operation while retaining one resolver plus one bounded SELECT-only read for GET/HEAD.
- The methodology API remains metadata-only; the versioned Astro prose and public change log remain separate frontend work.
- Local implementation evidence cannot satisfy full API, accessibility, remote abuse, privacy-accountability, deployment, or release acceptance.

## Alternatives considered

- **Keep separate API and query registries:** rejected because the same version could acquire different time/path semantics.
- **Return methodology prose in `MethodologyDetail`:** rejected because it changes the existing contract and duplicates the versioned human-readable surface.
- **Require requested version to equal the selected publication's version:** rejected because historical versions would cease to be addressable after publication retention.
- **Return registry data without selecting a publication:** rejected because `MethodologyDetail.meta` requires a truthful publication and schema.
- **Reuse the dataset-metadata RPC:** rejected because its counts, notices, schedule, and current policy values exceed the methodology operation's least-data boundary.
- **Resolve a publication before checking registry/environment closure:** rejected because unregistered or remotely closed routes must not perform resolver or query effects.
- **Derive the API origin from the visitor request:** rejected because request-controlled host material cannot create a public fact or representation identity.
- **Cache the response in Cache API or permit private revalidation storage:** rejected; every methodology response is `private, no-store`.
- **Redirect unknown or aliased versions:** rejected because exact historical version identity must not be silently reinterpreted.

## Validation target

- Prove exact registered local/test GET/HEAD behavior, registered local/test OPTIONS behavior, valid-but-unregistered and malformed `404`, preview/production `404`, empty-query/body enforcement, fixed CORS, bounded errors, and unchanged closure of every unrelated route.
- Prove complete request/header validation and registry/environment planning occur before limiting but remain withheld; limiter fault/denial precede every planned response; unregistered or preview/production GET/HEAD/OPTIONS perform no resolver/query/cache effect.
- Prove active, rollback-candidate, retained-hot, expired, unavailable, exact-cutoff, and switch-race behavior through resolver V2 plus one dedicated bookmark-continuous context read with the identical horizon.
- Prove registered local/test GET/HEAD perform resolver V2 then exactly one dedicated context RPC, while registered local/test OPTIONS performs neither operation.
- Prove the requested historical version need not equal the selected publication methodology, while the selected publication/schema fields remain exact.
- Prove one registry drives both dataset metadata and methodology detail; reject unknown, inherited, malformed, mutated, accessor, proxy, path/version mismatch, noncanonical timestamp, and duplicate semantic versions.
- Prove the exact closed methodology envelope includes and validates the already-registered version, one fixed SELECT-only context statement, one Session, exact two-bind order/count, no version bind, retained-hot query plan, no metadata-summary join, no dynamic SQL/DML, and protected-origin return.
- Prove trusted-origin isolation from request URL, Host, forwarded headers, publication data, registry input, and an independently supplied call-site value.
- Prove the existing `MethodologyDetail` schema/OpenAPI example, exact fixed meta fields, hostile encoder-input code-unit ceilings, the composed methodology-URL cap, exact UTF-8 bytes, the defensive 4,096-byte encoded-representation cap plus the injected response ceiling, strong ETag, GET/HEAD identity, bodyless HEAD/304, methodology-specific successful `private, no-store` headers/`Vary`, and `private, no-store` errors/preflight.
- Scan source, generated bundles, runtime configuration, and effect tests for API D1, DML, Cache API, cookies, public logs/traces, analytics, custom telemetry, correlation IDs, and visitor-derived durable values.
- Keep every affected traceability row `Planned`; local implementation is prerequisite evidence only.
