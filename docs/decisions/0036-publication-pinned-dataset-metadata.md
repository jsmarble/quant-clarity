# ADR 0036: Route publication-pinned dataset metadata through the query service

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Product owner, staff engineer, API lead, query lead, security and privacy lead
- Related requirements: `DATA-053`, `API-001`, `API-003`, `API-004`, `API-011`–`API-017`, `API-020`–`API-026`, `BE-003`, `BE-007`, `BE-008`, `BE-011`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-006`, `QA-014`
- Extends: ADRs 0013, 0015, 0016, 0020, 0031, and 0032
- Supersedes: the Phase 5A metadata-only `503` stub for `/v1/metadata` after this decision is implemented; every other public data route remains closed

## Context

`API-015` requires public dataset metadata, while the current public API Worker exposes only a privacy-first `/v1/metadata` stub that always returns `503` after validation and abuse controls. The non-routable query Worker already has the accepted ADR 0031 V2 resolver, immutable publication rows, canonical publication resources, provider-slice dispositions, and one named ADR 0032 service binding. The API Worker therefore does not need, and must not receive, D1.

Two pre-release contract mismatches must be corrected in the implementation rather than encoded as false claims. First, `DATA-053` requires independent precision-normalization and precision-display-order versions, and the publication manifest already stores both, but `DatasetMetadata` currently exposes only `precision_vocabulary_version`. Second, generated OpenAPI describes only active metadata even though an exact retained-hot publication pin can select a superseded or rolled-back publication. No public dataset has been deployed, so replacing the underspecified field and correcting the selected-publication wording before release do not invoke the post-release compatibility path in `API-017`. They do not amend the PRD.

The public domain is not yet cleared. A truthful absolute `methodology_url` cannot be derived from a request host or filled with the generated `example.invalid` placeholder. Production routing therefore remains blocked on an approved environment-owned public API origin and its closed configuration policy.

## Decision

### Closed public route and effect order

Only `GET`, `HEAD`, and `OPTIONS` on exact path `/v1/metadata` become functional in this slice. The route accepts no query string, cursor, body, filter, sort, slug, or visitor-selected representation. `GET` and `HEAD` may receive only the existing optional `If-None-Match` and exact `X-QuantClarity-Publication` controls. `OPTIONS` exposes the existing fixed non-credentialed CORS contract. Every other public data route remains closed, mutation methods return the existing static `405`, and unknown paths and parameters retain their bounded static errors.

ADR 0016 effect order is unchanged: bounded protocol validation selects a response plan, the request-lifetime source-address limiter succeeds, and only then may the API resolve a publication or call the query service. Source addresses and actor keys remain transient limiter inputs and never enter the service call.

### V2 selection and one metadata read

For `GET` and `HEAD`, the API computes the accepted fresh-work availability horizon `now + 15 minutes` using its injected clock. It calls `resolvePublicationV2` exactly once with either `null` for the active publication or the validated exact publication pin. Active, current rollback-candidate, and retained-hot publications use ADR 0031 unchanged. A malformed pin is `400 invalid_parameter`; an unavailable, unknown, never-public, or insufficient-horizon exact pin is the generic `409 publication_expired` with only the current publication header; absence of a safe active publication is `503 publication_not_ready`.

After a selected result, the API invokes one closed `readDatasetMetadataV1` named RPC with exactly the protected environment, service audience/version, selected publication ID, resolver bookmark, and identical required-availability horizon. No raw URL, header block, source address, actor key, request host, query value, correlation ID, or arbitrary operation enters the RPC.

The query Worker opens one bookmark-continuous D1 Session and executes one fixed, parameter-bound, SELECT-only statement. That statement rechecks the selected publication's retained-hot eligibility against the same horizon and returns exactly one bounded row containing the selected immutable publication versions/times and its publication-time materialized dataset-metadata summary. The read joins that summary by publication primary key and requires exact closure hash, source-resource count, provider-slice count, and provider-slice hash agreement with the immutable publication and closure seal; publication-core then recomputes the summary's domain-separated hash over every authority field. The query Worker combines the verified row with its protected clock, protected exact API origin, and closed methodology registry to return one complete `DatasetMetadata` value. Dynamic SQL, DML, arbitrary table/resource selection, partial results, and fall-forward to another publication are forbidden. A missing or malformed summary, authority/hash disagreement, lifecycle/version disagreement, horizon disagreement, duplicate/missing singleton, unknown registry version, invalid protected configuration, or changed publication fails the read as a static integrity failure; D1 execution failure is a static read failure.

### Dataset metadata semantics

`publication_id` is the dataset version required by `API-015`. The response is for the selected publication, which need not be the currently active publication when the request carries an eligible exact pin.

The public response contains:

- selected publication `schema_version`, `methodology_version`, `precision_normalization_version`, `precision_display_order_version`, and `price_policy_version`;
- literal API major version `1`;
- selected publication `generated_at`;
- `published_at` equal to the publication's immutable first activation time, including after rollback or reactivation, never the current head switch time or request time;
- methodology effective time and URL from a closed version registry keyed by the selected publication's exact methodology version;
- one next refresh window;
- three canonical active counts; and
- a closed degradation-notice set.

The pre-release `precision_vocabulary_version` field is replaced by the two independently meaningful precision version fields. Neither may be synthesized from the other. The selected publication's bounded normalization, display-order, and price-policy version identifiers are preserved exactly. An unknown methodology version fails closed because its effective time and path require a closed registry entry; the metadata endpoint does not invent any default.

The counts are computed once during publication from the selected publication's complete, contract-validated canonical `publication_resource` rows, then stored in the immutable `publication_dataset_metadata_summary`; they do not come from search projections, provider-name documents, provider-model-ID multiplicity, or unverified count facts:

- `active_models`: Model resources only whose `status` Fact is `known` with exact value `active`; Variants are not Models for this count;
- `active_offerings`: Offering resources whose `status` Fact is `known` with exact value `active` and whose structural `stale` value is `false`; and
- `active_providers`: Provider resources whose `status` Fact is `known` with exact value `active`, independent of Offering count.

Unknown, unavailable, inactive, malformed, cross-publication, or wrong-type status values do not count. Publication activation and its content-aware closure seal remain the canonical whole-resource trust boundary. Summary construction and independent readiness checks validate the exact status/stale shapes and outer/inner identity needed by these aggregates. The query path is O(1): it verifies summary authority against the seal and recomputes the summary digest rather than rescanning visitor-facing canonical JSON.

Serving migration 0013 advances the physical serving schema from `1.9.0` to
`1.10.0` and adds exactly one `publication_dataset_metadata_summary` row per
publication. Its publication primary key, summary version, closure hash,
source-resource count, provider-slice count/hash, three counts, two disposition
flags, and summary hash are the complete stored authority. Publication-core
hashes every authority field in the
`publication-dataset-metadata-summary` domain. The controlled writer may insert
the row only after the exact closure seal and while the publication remains
`building`; updates and deletes are forbidden. D1 independently rederives the
counts and flags on insert and again on `building` to `ready`, while the
readiness adapter independently recomputes the domain-separated digest. Every
activation and rollback rechecks the summary-to-seal/source binding. Missing,
duplicate, malformed, or drifted state therefore fails before public head
mutation.

The summary is an ordinary portable serving-backup table and every
publication-scoped export must contain exactly one row. Restore never trusts
that literal derived row: the local rebuild coordinator excludes it from the
selected import, recreates seal then summary from restored canonical rows, and
runs readiness only after summary verification. Operational RPO/RTO evidence
and deployed restore remain release gates.

`degradation_notices` is the lexicographically sorted subset of these two exact static strings:

1. `One or more enabled provider slices are stale.` when at least one selected-publication `publication_provider_slice` has `freshness_state=stale`;
2. `One or more enabled provider slices are unavailable.` when at least one has `freshness_state=unavailable`.

The array contains neither Provider IDs, counts, source failures, dynamic text, nor visitor-derived state. Fresh-only publications return an empty array.

### Refresh-window calculation

The public schedule is Monday and Thursday from `05:00:00.000Z` through `17:00:00.000Z`. The window is half-open for selection: at or after its start and before its end, return the current window; before a scheduled start, return that upcoming window; at or after an end, return the next Monday or Thursday window. UTC calendar arithmetic is deterministic across month, year, leap-day, and daylight-saving boundaries. The non-routable query Worker's protected clock is the authority and is injectable only at the local function boundary for deterministic tests; no caller-supplied time enters the RPC. The response never reports a window ending before or equal to its start.

### Methodology URL and protected origin

The methodology registry supplies the selected version's effective time and fixed path. The non-routable query Worker constructs `methodology_url` as:

```text
<trusted environment-owned exact HTTPS API origin>/v1/methodologies/<validated version>
```

The origin must have no credentials, path, query, or fragment and must come from protected environment configuration or an equivalently reviewed compile-time environment registry. It is never derived from `Request.url`, `Host`, forwarded headers, a publication row, or provider content. The API treats the RPC result as hostile: it snapshots and validates the complete value, verifies the selected publication ID, and never reconstructs the URL from the public request. Local tests may inject `https://api.example.test`; `example.invalid` remains a generated example only. Adding the production/preview origin requires a reviewed environment-inventory and closed Wrangler/privacy-policy update before deployment. The referenced methodology route must also be live before the URL can be release evidence. This ADR does not authorize that deployment or claim a cleared production URL.

### Conditional response and privacy

Every `200`, `304`, error, and preflight response remains `private, no-store`; `/v1/metadata` never uses Cache API or a visitor-derived cache key. After the selected public body passes the corrected `DatasetMetadata` contract, ADR 0016 derives a **strong** quoted ETag from the exact JSON bytes, selected publication ID, and `json` representation. GET and HEAD share the same validator. `If-None-Match` is evaluated only after validation, limiting, publication resolution, the metadata read, contract validation, and exact representation selection; a match returns `304` with no body. `HEAD` returns the same status and representation headers as GET with no body.

No method logs, traces, measures, caches, stores, or echoes the request, publication header, `If-None-Match`, source address, actor key, D1 bookmark, horizon, selected count inputs, or error detail. Automatic public Worker logs/traces and custom telemetry remain disabled. The selected public publication ID and static metadata are response facts, not visitor state.

## Consequences

- The first real public data route can expose publication-consistent metadata without granting D1 to the API Worker.
- Exact retained-hot pins return the pinned dataset's own versions, first publication time, counts, notices, and validator rather than silently falling forward to active data.
- The metadata contract now has the two precision policy versions required by `DATA-053` before any public compatibility promise attaches.
- Strong ETags provide conditional validation without permitting storage or microcaching.
- A truthful methodology URL introduces a protected environment-origin configuration prerequisite; local completion does not make the product deployable.
- Search, collections, details, methodologies, OpenAPI routes, remote resources, public domain configuration, deployment, and release evidence remain pending.

## Alternatives considered

- Bind D1 directly to the API Worker: rejected because it violates the accepted least-capability public/query split.
- Return active metadata for every exact pin: rejected because it violates publication consistency and makes the publication header misleading.
- Read counts from search projections or stored derived count facts: rejected because metadata counts must describe canonical selected-publication resources and must not inherit projection multiplicity.
- Count stale active Offerings: rejected because the public active-offering count uses the already accepted active-and-non-stale eligibility meaning.
- Preserve one `precision_vocabulary_version`: rejected because it cannot satisfy independent normalization/display-order versioning.
- Use `generated_at`, head switch time, or request time as `published_at`: rejected because publication lifecycle already defines first activation as the publication time.
- Derive methodology URL from the request host: rejected because visitor-controlled host material cannot select a canonical public fact or cache/representation identity.
- Return a relative or placeholder methodology URL: rejected because the contract requires a URI and the metadata must be truthful.
- Weak ETag or Last-Modified only: rejected because ADR 0016 already specifies a strong exact-representation ETag and the existing public contract exposes it.
- Edge microcache metadata: rejected for this slice because the fixed privacy boundary is `private, no-store` and conditional validation is sufficient.

## Validation

- Prove only exact `GET|HEAD|OPTIONS /v1/metadata`, no query string, fixed CORS, bounded errors, method handling, and unchanged closure of every other public data route.
- Prove validation and both limiter buckets precede resolver/read effects, and that failures never call the query service.
- Prove active, current rollback, retained-hot, unknown, never-public, insufficient-horizon, exact cutoff, and switch-between-resolve-and-read cases through resolver V2 plus the same read horizon/bookmark.
- Prove one fixed SELECT-only metadata statement, one Session, exact bind count/order, no DML/dynamic SQL, bounded one-row output, primary-key summary access, no canonical-resource/provider-slice scan, and real-D1 query plans.
- Prove every version/time field, first-activation preservation, method-registry lookup, unknown-version failure, and independent normalization/display-order values.
- Prove all three canonical count definitions against active, inactive, unknown, stale, malformed, cross-publication, Variant, duplicate Offering/projection, and provider-with-zero-Offering cases.
- Prove empty, stale-only, unavailable-only, both-state, duplicate-state, and input-permuted degradation notices with exact static sorted strings and no IDs/counts.
- Prove Monday/Thursday before/start/inside/end/after cases, week/month/year/leap-day transitions, and DST independence in UTC.
- Prove trusted-origin validation, request-host/forwarded-host isolation, percent-safe version paths, local `.test` behavior, and production-origin absence as a deployment blocker.
- Prove corrected schema/OpenAPI JSON/YAML parity, selected-publication wording, GET/HEAD byte identity, strong ETag vectors, `304` effect order, `private, no-store`, response-byte bounds, and no body on HEAD/304.
- Scan public API/query code and configuration for D1 on the API, DML, public query routes, cookies, Cache API, request logs/traces, analytics, telemetry, correlation IDs, visitor-derived durable keys, raw header/query echo, bookmarks, and source-address leakage.
