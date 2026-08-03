# ADR 0039: Derive a publication-scoped Model slug authority core

- Status: Accepted
- Date: 2026-08-03
- Decision owners: Product owner, staff engineer, data lead, API lead, security and privacy lead
- Related requirements: `DATA-001`, `DATA-002`, `DATA-004`, `RULE-004`, `FE-003`, `FE-061`, `API-002`–`API-004`, `PIPE-050`–`PIPE-055`, `BE-002`, `BE-005`–`BE-007`, `BE-011`, `BE-012`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-001`, `QA-004`, `QA-006`, `QA-007`
- Extends: ADRs 0004, 0015, 0018, 0035, and 0038
- Supersedes: None

## Context

ADR 0038 added an unrouted selected-publication Model reader for one exact stable ID and kept `/v1/models/{model_id_or_slug}` closed. The remaining slug prerequisite cannot use the current Model JSON alone: that resource contains only the current slug Fact, while canonical `slug_history` carries prior assignments. Search names, aliases, FTS, and normalized-name projections neither prove historical ownership nor preserve exact route bytes.

The approved identity design already fixes the product semantics. Stable IDs are immutable, public slugs are mutable attributes with redirect history, slug changes require uniqueness checks, and a historical slug resolves to one stable resource. The missing implementation boundary is a deterministic publication-scoped authority that preserves those rules without reading live canonical state on a public request.

The current canonical SQL is not sufficient authority by itself. It makes only open `slug_history` values unique, applies a weaker slug grammar than the public contract, and does not prove agreement between a Model resource's current slug Fact and its history intervals. A runtime scan or tie-break would therefore hide integrity defects rather than resolve them.

## Decision

### Schema-neutral projection core

Add a pure, runtime-neutral `model-slug@1` projection core. B1 accepts one bounded snapshot input and emits only deterministic proof material and immutable projection records. It does not read D1, write serving state, expose an RPC, or change a public route.

The closed input contains:

1. one trusted immutable publication manifest;
2. the exact complete canonical Model-resource inventory for that manifest, including each resource's existing content hash; and
3. the exact canonical Model-target `slug_history` snapshot asserted by the caller for the same publication, including `slug_history_id`, Model ID, slug, `valid_from`, and nullable `valid_to`.

The publication boundary is derived exclusively from the trusted manifest's `generatedAt`. There is no separately caller-supplied boundary field, and neither resource content nor history rows may select or alter it.

Every supplied Model is validated against the complete canonical contract and content hash. Its slug Fact must be `known`; `unknown`, `not_applicable`, or `unavailable` blocks projection because `DATA-001` requires a public Model slug. The exact value must contain 1–128 ASCII characters and match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.

Every supplied history row must have a unique exact `slg_` UUIDv4, literal resource type `model`, an exact Model target present in the supplied publication inventory, the same strict slug grammar, a nonnegative safe-integer `valid_from` no later than the publication boundary, and either null `valid_to` or a nonnegative safe integer strictly later than `valid_from` and no later than the boundary. B1 rejects zero-duration intervals and future endpoints because it cannot authenticate when a caller-provided row was created or became canonical. The projector performs no Unicode normalization, case folding, punctuation folding, percent decoding, alias expansion, inference, or search-name substitution.

### Time and current-slug agreement

History intervals are half-open: `[valid_from, valid_to)`, with null `valid_to` open-ended. The exact publication-boundary time comes only from the trusted manifest's `generatedAt`. Rows for one Model must not overlap. The same Model may return to a previously used slug only through a later non-overlapping interval.

Every supplied Model must have exactly one history interval containing the publication boundary, and that row's slug must agree exactly with the Model's current known slug. Zero or multiple boundary-active rows, an active row with another slug, overlap, or an absent target fails the whole projection.

Once a Model slug assignment has begun at or before the boundary, expiration does not free that exact slug for another Model. Closed rows remain historical route authority. This is permanent reservation within the Model route namespace. The decision neither relaxes nor redefines uniqueness across other independently routed resource types.

### Collision behavior and records

The projector combines each Model's current slug with every history assignment that began at or before the boundary. It emits at most one exact mapping for each slug:

```text
publication boundary + exact slug bytes -> stable Model ID + current|historical
```

When current and historical authority contain the same slug for the same Model, including a valid later recurrence after a non-overlapping interval, the single mapping is `current`. Repeated source rows for the same slug and Model remain present in the source-history proof but do not duplicate the route mapping. If one slug maps to two different Model IDs at any retained interval, projection fails. It never selects the current row, most recent interval, lowest stable ID, active Model, or any other winner. Model status and Offering facts are not inputs.

Mappings are sorted by exact UTF-8 slug bytes and then stable Model ID. Because the slug grammar is ASCII, this order is portable without locale or collation behavior. Slug bytes are retained exactly; the projection does not store a normalized duplicate.

### Two independent proof roots

B1 produces two domain-separated, versioned, length-prefixed hashes under the accepted ADR 0015 encoding:

- a **source-history inventory hash** over every supplied canonical history row, sorted by `resource_id`, `valid_from_ms`, `valid_to_ms` with null last, `slug`, and `slug_history_id`. The root tuple domain is `publication-model-slug-source-history:root` with the ordered typed field `items:list`; each record tuple domain is `publication-model-slug-source-history:record` with the exact ordered typed fields `slug_history_id:identifier`, `resource_id:identifier`, `resource_type:text`, `slug:text`, `valid_from_ms:integer`, and `valid_to_ms:null|integer`; and
- a **resolved-mapping inventory hash** over every deduplicated `model-slug@1` mapping, sorted by exact slug bytes and Model ID. The root tuple domain is `publication-model-slug-mappings:root` with the ordered typed field `items:list`; each record tuple domain is `publication-model-slug-mappings:record` with the exact ordered typed fields `projection_version:text`, `slug:text`, `model_id:identifier`, `resolution:text`, and `target_content_hash:digest`.

Each root's `items` value is the decimal record count. Each record tuple is individually length-prefixed after the root header. A null `valid_to_ms` is encoded with type `null` and value `null`; a present value uses type `integer` and its canonical decimal string. `projection_version` is always `model-slug@1` and is part of every mapping record preimage.

The result also records the projection version, publication-boundary time, Model count, source-history count, mapping count, current count, and historical count. Duplicate identities, unsafe counts, arithmetic overflow, values beyond the existing publication-resource/manifest envelopes, or configured count/encoded-byte ceilings fail before unbounded map or sort construction and before hashing. The exact B1 constants are:

- `MODEL_SLUG_MAX_MODELS = 25_000` and `MODEL_SLUG_MAX_HISTORY_ROWS = 50_000` as coarse hostile-input cardinality guards;
- `MODEL_SLUG_MAX_RESOURCE_BYTES = 1_000_000` and `MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES = 16 * 1_024 * 1_024` for individual and retained canonical Model JSON; and
- `MODEL_SLUG_MAX_SOURCE_HISTORY_INVENTORY_BYTES = 8 * 1_024 * 1_024` and `MODEL_SLUG_MAX_MAPPING_INVENTORY_BYTES = 8 * 1_024 * 1_024` for exact encoded hash inventories.

Source-history encoded-byte admission is incremental before row retention, sorting, or map construction. Mapping bytes are checked over the exact deduplicated inventory before mapping sort and hash, and the two roots hash sequentially rather than retaining both hash preimages concurrently. These are conservative allocation guards beneath the documented 128 MB Workers isolate-memory limit; they do not by themselves prove peak runtime memory. Accepted-bound workerd/load evidence remains pending. Immediate overflow is tested, and raising any ceiling requires recorded resource evidence rather than silent allocation growth.

The source-history root proves exactly what the caller supplied, including redundant intervals. The mapping root proves the route behavior derived from that supplied input. Neither root alone proves that the caller supplied every row present in canonical D1.

### Deliberate B1 trust boundary

B1 validates internal completeness and consistency only against its caller-provided history snapshot. No fixed canonical-D1 extraction, canonical high-water mark, archived authoritative input, cross-database attestation, or serving-D1 receipt authenticates that snapshot in this slice. A malicious or defective caller could omit an ended canonical history row and still obtain internally consistent B1 hashes; the exact current-row requirement does not detect that omission.

Accordingly, B1 proof material is non-authoritative and cannot satisfy publication readiness, activation, rollback, backup, restore, or public slug resolution. Phase 5O-B2 must close the gap by adding either a fixed canonical extraction at an authenticated snapshot boundary or an archived authoritative history input bound to that boundary. B2 must then persist and exactly reconstruct the projection in serving schema `1.12.0`, bind both proof roots and counts to closure/readiness/switch gates, include the authoritative input in backup and restore, and prove an exact indexed selected-publication lookup.

### Route, cache, and privacy boundary

Serving schema remains `1.11.0` in B1. No migration, table, index, trigger, closure field, receipt, query method, service-binding method, cache entry, ETag, CORS response, public `Request`/`Response`, remote resource, provision, or deployment changes.

The public `/v1/models/{model_id_or_slug}` route remains wholly closed for both stable IDs and slugs. Whether a future API request for a current or historical slug returns the canonical Model directly or redirects is intentionally undecided until Phase 5O-B3. B1 does not create a URL or status-code semantic by calling a mapping `current` or `historical`.

No raw visitor path or slug enters this offline projection. Projection inputs, hashes, and failures contain publication data only and are not derived from live requests. Existing zero-visitor-data controls remain unchanged.

## Consequences

- Model slug ownership and collision handling become deterministic before any storage or routing work.
- Unknown current slugs, malformed history, interval disagreement, wrong targets, and permanent multi-Model slug reuse fail closed.
- Current and historical mappings remain separate from aliases and search relevance.
- Two hashes distinguish complete supplied history from its deduplicated route meaning.
- B1 can be reviewed and tested without changing serving schema or exposing incomplete behavior.
- Caller-snapshot completeness remains an explicit blocker rather than an implied publication guarantee.
- B2 storage/authentication and B3 RPC/route/cache behavior remain separate reviewable decisions.

## Alternatives considered

- Scan canonical or publication JSON on each request: rejected as unbounded, history-incomplete, and incompatible with publication-pinned caching.
- Reuse Model/Variant exact-search names or aliases: rejected because their normalization and matching semantics are not slug ownership.
- Allow a retired slug to move to another Model: rejected because historical lookup would become ambiguous and violate the one-stable-resource rule.
- Resolve collisions by recency, activity, or stable ID: rejected because a deterministic winner would conceal conflicting canonical identity.
- Hash only deduplicated mappings: rejected because omitted, added, or altered source-history rows could leave route behavior unchanged while losing provenance completeness.
- Claim caller-supplied history is authoritative in B1: rejected because no canonical extraction, snapshot attestation, or archive binding exists yet.
- Choose redirect or direct-read semantics now: rejected because B1 has no HTTP surface and B3 must reconcile API, web canonical-URL, OpenAPI, cache, and conditional-response behavior together.

## Validation

Phase 5O-B1 acceptance must prove:

- exact known current-slug grammar at 1 and 128 characters and rejection at 0, 129, uppercase, repeated/trailing hyphens, non-ASCII, percent encoding, and every non-known Fact state;
- complete Model contract/content-hash validation and rejection of duplicate, wrong-type, absent, or mutated Model resources;
- exact history ID/type/target/slug/timestamp validation, half-open boundary cases, rejection of future endpoints, null ends, zero-length intervals, non-overlap, and exactly-one current-interval agreement;
- permanent same-Model non-overlapping reuse and mapping deduplication while every source row remains hashed, current-over-historical classification for the same Model, and failure for every multi-Model collision regardless of interval timing or lifecycle status;
- deterministic source-history and resolved-mapping hashes across input order and object construction order, with independent hash changes for source-only and route-semantic changes;
- the exact 25,000-Model, 50,000-history-row, 1,000,000-byte per-resource, 16 MiB retained-resource, and 8 MiB per-inventory encoded ceilings at their documented admission points, including immediate count/byte overflow, hostile arrays/objects and key-count bombs, unsafe integers, overflow, and multibyte byte accounting;
- schema `1.11.0`, generated contracts, migrations, query/API Workers, public routes, Cache API, remote resources, and privacy configuration remain unchanged; and
- documentation and traceability state that caller-snapshot completeness, serving `1.12.0`, readiness/switch/backup/restore, RPC/cache/HTTP semantics, deployment, and public acceptance remain pending.

## References

- [ADR 0004: Stable identities and field claims](0004-stable-identities-and-field-claims.md)
- [ADR 0015: Publication closure and lifecycle](0015-publication-closure-and-lifecycle.md)
- [ADR 0018: Sealed serving closure persistence](0018-sealed-serving-closure-persistence.md)
- [ADR 0035: Canonical family/model/variant publication closure](0035-canonical-family-model-variant-publication-closure.md)
- [ADR 0038: Publication-pinned Model detail read seam](0038-publication-pinned-model-detail-read-seam.md)
- [Phase 5O-B1 design contract](../design/phase-5o-b1-model-slug-projection-core.md)
