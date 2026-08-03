# Phase 5O-B1: Publication Model-slug projection core

## Status

Design is accepted under [ADR 0039](../decisions/0039-publication-model-slug-projection-core.md). The schema-neutral projector and adversarial tests are locally implemented, and the full local/CI-equivalent verification gate passed on 2026-08-03. This remains an offline, unrouted projection slice: serving schema stays `1.11.0`, `/v1/models/{model_id_or_slug}` stays closed, and no RPC, cache, remote resource, migration, provisioning, or deployment is authorized.

## Slice objective

Derive one deterministic `model-slug@1` ownership inventory from a trusted immutable publication manifest, its exact canonical Model resources, and caller-supplied canonical Model `slug_history`. Derive the boundary exclusively from the manifest's `generatedAt`; fail closed on unknown current slugs, malformed inputs, current-interval disagreement, or any permanent Model-route slug collision; and produce separate hashes for the complete supplied history and the deduplicated route mapping.

## Fixed semantics

- Stable Model IDs are immutable; Model slugs are mutable route attributes whose prior assignments remain permanently reserved to the same Model.
- Every supplied Model must pass the complete canonical contract and content-hash check. Its slug Fact must be `known`.
- Current and historical slug values are exact 1–128-character ASCII strings matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- Preserve exact bytes. Do not normalize case, Unicode, punctuation, separators, percent encodings, aliases, or search names.
- History intervals are half-open `[valid_from, valid_to)`; null `valid_to` is open-ended. Reject a `valid_from` or non-null `valid_to` beyond the publication boundary because B1 cannot authenticate future caller-provided rows.
- Intervals for one Model must not overlap. Each published Model requires exactly one interval active at the boundary, and it must equal that Model's current known slug.
- Every assignment beginning at or before the boundary remains a current or historical mapping even after its interval ends.
- The same Model may reuse a slug through non-overlapping intervals. Those rows collapse to one route mapping but remain distinct in the source-history inventory.
- The same slug mapping to different Models fails the entire projection regardless of interval overlap, current status, lifecycle state, or stable-ID order.
- Model status, Variant aliases, Offerings, provider facts, search relevance, and affiliate state are not inputs.

## Projection input and result

The caller supplies one closed object containing:

1. one trusted immutable publication manifest;
2. the complete canonical Model-resource inventory for that manifest, including content hashes; and
3. the caller-asserted complete canonical Model-target `slug_history` snapshot for the same publication.

The projector derives its publication-boundary timestamp exclusively from trusted `manifest.generatedAt`. The input has no separate boundary field, and neither the resources nor history rows may select or alter that time.

The projector validates closed own-data shapes, exact IDs and literal Model resource types, timestamps, byte lengths, counts, Model contracts, and hashes before trusting fields. A history target must exist exactly once as a Model in the supplied inventory. Every supplied row participates in interval, collision, mapping, and source-proof validation.

The result contains:

- projection version `model-slug@1`;
- publication-boundary timestamp;
- Model, source-history, total mapping, current mapping, and historical mapping counts;
- source-history inventory hash;
- resolved-mapping inventory hash; and
- immutable sorted mapping records of exact slug, stable Model ID, and `current|historical`.

Source history is sorted by `resource_id`, `valid_from_ms`, `valid_to_ms` with null last, `slug`, and `slug_history_id`. Its root tuple is `publication-model-slug-source-history:root` with `items:list`; each `publication-model-slug-source-history:record` tuple contains, in exact order, `slug_history_id:identifier`, `resource_id:identifier`, `resource_type:text`, `slug:text`, `valid_from_ms:integer`, and `valid_to_ms:null|integer`.

Route mappings are sorted by exact UTF-8 slug bytes and then Model ID. Their root tuple is `publication-model-slug-mappings:root` with `items:list`; each `publication-model-slug-mappings:record` tuple contains, in exact order, `projection_version:text`, `slug:text`, `model_id:identifier`, `resolution:text`, and `target_content_hash:digest`. Root `items` is the decimal record count; each record tuple is length-prefixed after its root header. A null `valid_to_ms` encodes type and value as `null`; a present value is an `integer` canonical decimal string. Every mapping preimage includes `projection_version = model-slug@1`.

The exact implementation ceilings are `MODEL_SLUG_MAX_MODELS = 25_000`, `MODEL_SLUG_MAX_HISTORY_ROWS = 50_000`, `MODEL_SLUG_MAX_RESOURCE_BYTES = 1_000_000`, `MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES = 16 * 1_024 * 1_024`, `MODEL_SLUG_MAX_SOURCE_HISTORY_INVENTORY_BYTES = 8 * 1_024 * 1_024`, and `MODEL_SLUG_MAX_MAPPING_INVENTORY_BYTES = 8 * 1_024 * 1_024`. The two counts are coarse hostile-input guards. Source encoded-byte admission is incremental before retaining, sorting, or mapping rows; exact deduplicated mapping bytes are checked before mapping sort and hash; and the two roots hash sequentially. These conservative guards leave headroom below the documented 128 MB Workers isolate-memory limit but do not alone prove peak runtime memory. Accepted-bound workerd/load evidence remains pending. Immediate overflow is tested; a later increase requires measured resource evidence.

## Explicit trust gap

B1 can prove only that the supplied Model and history inputs are internally complete and consistent with one another. It cannot prove that the caller included every canonical D1 history row. In particular, a caller can omit an ended row without violating the exact current-row rule. There is no fixed canonical query, canonical high-water attestation, archived authoritative history artifact, cross-database receipt, or serving reconstruction in this slice.

Therefore no B1 hash or record may enter publication readiness or answer a request. Phase 5O-B2 must:

1. define a fixed canonical extraction at an authenticated snapshot boundary or bind an archived authoritative history input to that boundary;
2. persist exact projection rows under serving schema `1.12.0` with forced indexed lookup and immutable guards;
3. bind source-history and mapping counts/hashes to closure, readiness, activation, rollback, and switch proofs; and
4. make the authoritative history input and deterministic projection rebuild part of backup and restore acceptance.

## Explicit HTTP and privacy nonclaims

Phase 5O-B1 does not decide whether an API request using a current or historical slug returns `200` directly or redirects. Phase 5O-B3 must decide API/web canonicalization together with OpenAPI, CORS, ETag, HEAD/OPTIONS, cache, stable-ID resolution, and response-size/load evidence.

No public path changes. The API and query Workers receive no new method. Cache API cannot consume a slug, and neither a raw request URL nor visitor-supplied path enters B1. No cookies, browser persistence, request logs/traces, analytics, telemetry, request correlation, click tracking, or visitor-derived state is introduced.

## Acceptance matrix

| Area | Required local evidence |
|---|---|
| Current slug | Known exact values at 1 and 128 characters; reject empty, 129 characters, malformed ASCII, non-ASCII, percent encoding, and non-known Facts |
| Models | Complete contract and content-hash checks; reject duplicate, wrong-type, absent, cross-linked, or mutated resources |
| History | Exact IDs/types/targets/timestamps; half-open boundary, rejected future endpoints, null-end, zero-length, non-overlap, and exactly-one active/current-agreement cases |
| Ownership | Preserve ended assignments; deduplicate non-overlapping same-Model reuse while hashing every source row; current wins only for the same mapping; reject every multi-Model collision |
| Proof | Independent deterministic source-history and resolved-mapping hashes across input and object-construction order; exact domains, field order, target-content binding, route-semantic changes, count, and classification agreement |
| Bounds | 25,000 Models; 50,000 history rows; 1,000,000 bytes per Model; 16 MiB retained Models; 8 MiB per encoded inventory at documented admission points; immediate count/byte overflow and hostile key-count bomb rejection; accepted-bound workerd/load remains pending |
| Compatibility | No serving-schema, migration, generated-contract, API/query Worker, public-route, cache, remote, or deployment diff |
| Privacy | Static scan proves no live request input, visitor data, logs, traces, metrics, analytics, telemetry, or durable visitor key |

## Requirements and traceability

- `DATA-001`: B1 contributes local `CT-DATA-001` evidence for stable Model ID and exact current/historical slug ownership without alias inference.
- `DATA-002`, `BE-002`, `BE-005`–`BE-007`, `BE-011`, `API-002`–`API-004`, `PIPE-050`–`PIPE-055`, and `QA-006` are future downstream prerequisites or acceptance relationships. B1 contributes no `ACT-API-*` or `PIT-PIPE-*` evidence.
- `PRIV-003`, `PRIV-006`, `PRIV-007`, and `PRIV-011` constrain the slice; B1 preserves their zero-visitor-data boundary but does not advance their pending acceptance status.
- `QA-001`, `QA-004`, and `QA-007` define later complete acceptance; B1 adds focused local tests but no public API conformance evidence.

No traceability status advances. `DATA-001` remains `Implemented` from prior evidence; every affected pending row remains `Planned`. The locally verified projector does not by itself satisfy public routing, deployed publication, API conformance, or release acceptance.

## Deferred work

- authenticated canonical history completeness or an exact archived authoritative input;
- serving schema `1.12.0`, storage, indexes, triggers, proof suffixes, and migration safety;
- readiness, activation, rollback, switch, backup, restore, and retained-hot lookup evidence;
- query RPC and API hostile-boundary composition;
- stable-ID/current-slug/historical-slug HTTP behavior;
- Cache API, ETag, CORS, HEAD/OPTIONS, error mapping, response admission, controlled load, remote configuration, deployment, and release gates.
