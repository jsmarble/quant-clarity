# Phase 5M: Publication-pinned public dataset metadata

## Status

Local implementation is complete and independently architecture- and security/privacy-reviewed under [ADR 0036](../decisions/0036-publication-pinned-dataset-metadata.md). The full repository verification gate passed on 2026-08-02. This slice opens only the local `/v1/metadata` route; it does not authorize deployment or make any other public data route available.

## Slice objective

Replace the privacy-first metadata `503` stub with one bounded, publication-consistent `DatasetMetadata` response over the existing named API-to-query service binding. The public API remains storage-free and the query Worker remains non-routable and SELECT-only.

## Contract correction

The implementation must make two pre-release corrections before claiming conformance:

- replace `precision_vocabulary_version` with independent `precision_normalization_version` and `precision_display_order_version` fields required by `DATA-053`; and
- describe the response as selected-publication metadata because an exact retained-hot pin may select a non-active publication.

Update the TypeBox contract, generated JSON Schema, OpenAPI JSON/YAML, examples, drift tests, and human API design together. No PRD amendment or API major-version change is needed before first public release. A partial compatibility alias is rejected because it would leave the required display-order version ambiguous.

## Public protocol

| Request | Result after validation and limiting |
|---|---|
| `GET /v1/metadata` | selected publication JSON metadata |
| `HEAD /v1/metadata` | identical status/headers and no body |
| `OPTIONS /v1/metadata` | existing fixed non-credentialed CORS preflight |
| query string, malformed/duplicate pin | static `400` |
| syntactically valid unavailable exact pin | generic `409 publication_expired` plus current publication header |
| unsupported method | static `405` with `Allow: GET, HEAD, OPTIONS` |
| no safe active publication | static `503 publication_not_ready` |
| query/integrity/runtime failure | static bounded `503`; no internal text |
| every other public data path | remains closed |

`If-None-Match` and `X-QuantClarity-Publication` are the only CORS-allowed request headers. `ETag` and `X-QuantClarity-Publication` are the only exposed response headers. All statuses are `private, no-store`, without cookies, credentials, a request ID, or Cache API.

## API-to-query sequence

1. Validate the bounded method, exact path, empty query, publication pin, and conditional header shape without effects.
2. Apply the request-lifetime read and IPv6-rotation limiter policy; discard source-address material and actor keys.
3. Compute fresh horizon `now + 15 minutes` and call `resolvePublicationV2` once.
4. Pass the selected publication, opaque bookmark, and identical horizon to one `readDatasetMetadataV1` RPC.
5. The query Worker opens one bookmark-continuous Session and executes one fixed parameterized SELECT that rechecks retained-hot eligibility and reads publication facts plus one primary-key `publication_dataset_metadata_summary` row. It requires exact closure hash, source-resource count, provider-slice count, and provider-slice hash agreement with the publication seal and does not scan canonical resources or provider slices.
6. The query Worker recomputes the summary's domain-separated hash over every stored authority field, then combines the verified row with its protected clock, closed methodology registry, and protected exact API origin, validates the complete contract, and returns one bounded `DatasetMetadata` value.
7. The API validates/detaches the hostile RPC result, verifies the selected publication ID, serializes deterministic JSON, and derives the ADR 0016 strong ETag.
8. Apply `If-None-Match`, then return GET bytes, a bodyless HEAD, or bodyless `304`.

Publication construction writes the schema-`1.10.0` summary only after sealing
and before readiness. Insert, readiness, and switch/rollback guards independently
rederive its structural authority; publication-core independently verifies its
domain-separated digest. Portable backup inventory requires one summary row,
while restore excludes the literal projection and rebuilds it from restored
canonical rows between seal and readiness.

No failure retries against another publication or a weaker V1 operation.

## Fixed metadata meanings

| Field | Authority |
|---|---|
| `publication_id` | selected publication; this is the dataset version |
| `schema_version` | selected immutable publication schema version |
| `api_version` | literal `1` |
| methodology version/effective time | selected version plus closed methodology registry |
| `methodology_url` | trusted exact environment API origin plus `/v1/methodologies/{version}` |
| precision normalization/display versions | two independent selected publication fields |
| `price_policy_version` | selected publication field |
| `published_at` | selected publication's immutable first activation |
| `generated_at` | selected publication generation time |
| next window | protected query-Worker-time-derived Monday/Thursday UTC schedule |
| active counts | immutable verified summary derived from complete canonical selected-publication resources |
| degradation notices | immutable verified summary derived from closed provider-slice states |

Active Models and Providers require a known `active` status Fact. Active Offerings additionally require `stale=false`. Variants do not contribute to `active_models`. Provider count is not conditioned on Offering count. Search documents, provider-model-ID rows, derived provider counts, prices, precision, affiliates, and ordering never affect these counts.

The notice array is the sorted subset of:

- `One or more enabled provider slices are stale.`
- `One or more enabled provider slices are unavailable.`

It never contains an identifier, count, error text, source locator, or visitor value.

## Refresh schedule

Windows are Monday and Thursday `05:00:00.000Z`–`17:00:00.000Z`. Return the current window while the non-routable query Worker's protected time is within `[start,end)`, otherwise the earliest future window. At exactly 17:00 UTC, advance to the next scheduled day. Use UTC calendar operations only. Time is injectable only at the local function boundary for deterministic tests and never enters the RPC.

## Methodology-origin gate

The public domain remains uncleared. The query Worker may use an injected `https://api.example.test` origin in local tests, but production/preview require an approved exact HTTPS API origin in the environment inventory and a reviewed closed Wrangler/privacy-policy configuration. Reject credentials, paths, queries, fragments, request-derived hosts, and unknown methodology versions. The API validates but never reconstructs the returned URL. Generated `example.invalid` content is illustrative, and the referenced methodology route must be live before either can be release evidence.

## Acceptance matrix

1. **Protocol/effects:** closed route and methods, empty query, pin/header bounds, both limiter buckets before resolver/read, no effects on validation/limiter failure.
2. **Publication:** active, rollback, retained-hot and exact-pin behavior; first-activation time; V2 horizon equality; no fall-forward between resolver and read.
3. **Query:** one Session, one fixed SELECT-only statement, exact parameters, one bounded row, O(1) summary primary-key access, seal/summary hash agreement, no resource/slice scan, and schema/index/lifecycle/integrity failure closure.
4. **Contract:** separate precision versions, selected wording, version registry, absolute trusted methodology URL, JSON Schema/OpenAPI parity.
5. **Counts:** exact resource/type/status/stale definitions; malformed, wrong-publication, Variant, duplicate-projection, and provider-zero-Offering cases.
6. **Notices:** empty/stale/unavailable/both/duplicates/permutations; exact static sort and no identifiers/counts.
7. **Schedule:** before/start/inside/end/after each window and UTC calendar edges.
8. **HTTP:** deterministic bytes, strong publication-qualified ETag, GET/HEAD equality, bodyless HEAD/304, conditional evaluation after all effects, fixed headers and static errors.
9. **Privacy/security:** API has no D1; no DML, other route, Cookie, Cache API, request persistence, log, trace, telemetry, correlation ID, raw header/query echo, request-host URL derivation, bookmark, or actor-key leakage.
10. **Compatibility/nonclaims:** existing search/read seams remain unchanged; no remote resource, public origin, deployment, complete API, load, legal, or release claim.

## Requirement handoff and nonclaims

- `DATA-053`: supplies the required separate public precision-policy version fields; production methodology/policy content acceptance remains separate.
- `API-003`, `API-015`: contributes one publication-pinned metadata representation through V2 and canonical selected-publication data.
- `API-011`–`API-014`, `API-016`, `API-017`: contributes one route's local protocol, conditional, error, and corrected generated-contract evidence.
- `API-020`–`API-026`, `SEC-001`, `SEC-007`, `SEC-011`: preserves bounded validation, limiter-first effects, least privilege, static failures, and no mutation.
- `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`: preserves no visitor storage/telemetry and `private, no-store`; deployed privacy evidence remains pending.

No traceability status advances from design alone. Production/preview origin configuration, remote resources, multi-PoP/load evidence, privacy/legal approvals, every other data route, deployment, and release gates remain pending.
