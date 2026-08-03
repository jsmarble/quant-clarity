# Phase 5O-A: Publication-pinned stable-ID Model detail read seam

## Status

Design is accepted under [ADR 0038](../decisions/0038-publication-pinned-model-detail-read-seam.md), and the internal implementation is complete and independently reviewed. The full repository verification gate passed on 2026-08-03. This phase remains internal and unrouted: `/v1/models/{model_id_or_slug}` stays closed, the public request handler is unchanged, and no Cache API, remote resource, migration, provisioning, or deployment is authorized.

## Slice objective

Add the smallest complete canonical detail-read boundary behind the existing named API-to-query service binding: select one exact stable-ID Model from one already resolved active or retained-hot publication, rehydrate and verify it, and return one hostile-output-validated `ModelDetail` value to an internal API adapter.

## Fixed semantics

- Accept only an exact lowercase `mdl_` UUIDv4. Slugs and all other resource IDs are invalid for this operation.
- Accept only already normalized internal GET or HEAD detail requests with no query string, cursor, filter, search plan, or caller-selected sort.
- Resolve active or exact eligible retained-hot publication state once through resolver V2 with the existing fresh `now + 15 minutes` horizon.
- Continue from the resolver bookmark and identical horizon through one `readModelDetailV1` named RPC.
- Return the selected publication's canonical Model for any valid status Fact. Do not hide inactive, unknown, unavailable, or historical state.
- Preserve every canonical Fact, checkpoint, source-format field, evidence ID, `cataloged_provider_count`, and refresh time exactly. Add no Offering/provider/price/serving-precision/affiliate/recommendation field.
- Construct exactly the existing `ModelDetail` envelope with empty filters and canonical Model default sort `name,stable_id`.
- Return internal `not_found` only when a valid selected publication exists and its exact Model primary key does not.
- Treat every malformed, duplicate, cross-publication, hash-drifted, contract-invalid, horizon-ineligible, or unexpected row/result as an integrity failure.

## API-to-query sequence

1. Snapshot and validate the complete internal input before effects, including exact operation/route agreement and the stable Model ID.
2. Call `resolvePublicationV2` once with the optional exact publication pin and required-availability horizon.
3. Build the closed query-service envelope with the selected publication, null continuation, empty filters, null search plan, and canonical Model-detail metadata.
4. Call `readModelDetailV1` once with the resolver bookmark and identical horizon.
5. In one bookmark-continuous D1 Session, execute one fixed SELECT-only statement that emits one retained-hot sentinel and zero or one exact Model resource row.
6. Validate row shape and byte counts, parse and validate the complete Model contract, verify exact IDs/type/publication, and recompute the publication-resource content hash.
7. Snapshot the RPC output as hostile input, validate the complete canonical Model, construct the closed `ModelDetail` envelope, serialize exact UTF-8 bytes, and enforce the injected representation ceiling without truncation.

No request URL, Host/forwarded header, header block, source address, rate-limit actor key, arbitrary resource type, SQL fragment, table name, cache key, or correlation identifier enters the RPC.

## Fixed query boundary

The read uses the ADR 0031 retained-reference CTE and protected D1 clock. It joins the selected publication to its exact closure seal, then probes `publication_resource` by:

```text
publication_id = selected publication
resource_type = literal "model"
resource_id = validated mdl_ UUIDv4
```

The existing primary key and `publication_resource_lookup_idx` are sufficient. The local workerd query-plan test proves that the intact current schema chooses an exact indexed lookup and rejects an observed scan plan; this slice neither forces a named index nor claims missing/malformed-index failure injection. The statement returns bounded byte length separately and returns JSON only within the 1,000,000-byte canonical publication-resource ceiling. It uses bound values for publication ID, horizon, stable Model ID, and byte ceiling; it interpolates no runtime identifier, JSON path, or SQL expression.

Exactly one hot sentinel with no resource is `not_found`. One sentinel plus one exact resource is a candidate. Any other cardinality is integrity failure. A D1 error is read failure; neither path exposes internal text.

## Contract and byte boundary

The reader verifies the exact outer content hash with the common publication-resource hash function, not a plain JSON digest. The Model must pass the complete Worker-safe contract and its `model_id` must equal both the row ID and requested stable ID. The selected publication supplies `publication_id` and `schema_version`; the canonical Model supplies only `data`.

The API-side adapter then validates the complete canonical Model, constructs the fixed `ModelDetail` envelope, and checks its exact serialized byte length against the injected API limit. The current local public limit is 65,536 bytes, while a canonical publication resource may be as large as 1,000,000 bytes. Phase 5O-A cannot claim public completeness until a later route phase either:

1. adds publication admission proving every ModelDetail response fits the retained public ceiling; or
2. records current Cloudflare-limit and controlled load evidence for a larger response/RPC/cache/CPU ceiling.

Neither option may truncate canonical data or silently omit a large Model.

## Schema and compatibility

Serving schema remains `1.11.0`. No migration, table, column, index, trigger, projection, proof version, receipt, switch phase, backup profile, restore transcript, environment binding, or generated public contract changes in 5O-A. The existing `Model` and `ModelDetail` contracts are reused without field or meaning changes.

ADR 0035 remains the publication-time authority for Model-to-ModelFamily relationship closure. This reader does not duplicate that whole-publication validator in request SQL.

## Explicit route, slug, and cache nonclaims

The approved resource route remains conceptually `/v1/models/{model_id_or_slug}`, but no part of that public path opens in 5O-A. The current public handler continues to return its bounded closed-route response for both stable IDs and slugs.

Before routing, a separate accepted decision must create a complete immutable current-and-historical Model-slug projection from canonical Model and `slug_history` authority, define collision and historical behavior, persist and index it with publication proof/restore coverage, and resolve a slug to a canonical stable ID before any cache decision. Search names and aliases are not slug authority.

Phase 5O-A does not call `cacheDecision`, `caches.default`, `Cache.match`, or `Cache.put`; it creates no ETag or public `Response`. A future route/cache phase must resolve the publication before cache lookup and may key only exact public representation bytes by trusted environment origin, cache-format version, publication ID, resource type, canonical stable Model ID, and representation. It may not use raw URL, request host, slug, headers, source address, actor key, or query data.

## Recorded local acceptance

1. **Input closure:** exact stable ID; Model-only resource type; GET/HEAD; no query/filter/cursor/search plan; canonical default sort; hostile shape rejection before resolver effects.
2. **Selection:** active, rollback candidate, displaced retained-hot, unknown/never-public/insufficient-horizon, exact cutoff, and selection/read race with identical horizon and bookmark.
3. **D1:** one fixed SELECT, exact binds, one Session, sentinel cardinality, found/not-found, observed exact indexed plan on the intact schema, no observed scan, DML, dynamic SQL, FTS, Vectorize, or semantic call.
4. **Integrity:** outer/inner/request ID agreement; exact publication; closure-seal agreement in the fixed query; complete Model contract; inactive/unavailable/unknown status; resource content-hash recomputation; malformed, duplicate, oversized, and drifted negatives.
5. **API seam:** bounded hostile RPC shapes, accessors/proxies/prototypes/symbols/oversized keys and strings, selected publication/schema agreement, exact `ModelDetail` meta, UTF-8 serialization, output detachment, and the injected response ceiling.
6. **Compatibility:** unchanged schema `1.11.0`, generated contracts, metadata behavior, explicit stable-ID and slug route closure, and named binding topology.
7. **Privacy/security:** no public route, Cache API, D1 on the API Worker, DML, cookies, browser persistence, logs, traces, metrics, analytics, telemetry, correlation IDs, request/header/source-address echo, bookmark leakage, or visitor-derived durable key.

Explicit large-checkpoint and every-Fact-state fixtures, exact 1,000,000-byte reader-ceiling acceptance, closure-seal-drift failure injection, migration/readiness/switch/backup/restore identity inventories, controlled performance evidence, and public cache/CORS/ETag behavior remain later route-release acceptance. They are not claimed by this internal slice.

## Requirement handoff and nonclaims

- `DATA-001`–`DATA-015`, `DATA-060`, `DATA-065`, `API-002`–`API-005`: contributes one canonical selected-publication Model detail read; presentation, evidence-detail traversal, slug routing, and complete API conformance remain pending.
- `API-011`–`API-013`, `API-015`, `BE-003`, `BE-007`, `BE-011`: reuses read-only typed publication selection and bounded static failures internally; no public method/CORS/ETag/cache behavior advances.
- `NFR-002`: defines indexed O(1)-row lookup and explicit byte ceilings; controlled uncached-detail latency evidence remains pending.
- `SEC-001`, `SEC-007`: fixes the operation to SELECT-only exact lookup through the non-routable query Worker; public penetration and deployed binding evidence remain pending.
- `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`: all identifiers and continuity fields remain transient with no cache or telemetry; deployed zero-visitor-data evidence remains pending.
- `QA-004`, `QA-006`, `QA-014`: defines local contract, workerd, failure, and privacy acceptance; implementation and complete public/deployed evidence remain pending.

Local unit, hostile-boundary, named-service-binding, and pinned-workerd D1 suites prove the current schema's exact indexed plan, the query's required closure-seal join, retained-hot bookmark continuity, found/not-found behavior, canonical hash/contract validation, the injected response bound, and unchanged route/privacy boundary. The deferred cases listed above and every mapped traceability row remain `Planned` because public ID-or-slug routing, cache/CORS/ETag behavior, controlled load, remote, and deployed evidence are still pending.
