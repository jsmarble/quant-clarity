# ADR 0026: Persist model and variant exact names as UTF-8 BLOBs and split proof cutover from query integration

- Status: Accepted
- Date: 2026-08-02
- Last clarified: 2026-08-02
- Decision owners: Staff engineer, search lead, data-integrity lead
- Related requirements: `DATA-001`–`DATA-004`, `DATA-008`, `API-003`, `API-010`, `SRCH-002`, `SRCH-006`, `SRCH-007`, `SRCH-009`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-010`–`BE-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006`
- Extends: ADRs 0015, 0019–0023, and 0025

## Clarification history

- **2026-08-01:** Closed the Phase 5G-B internal reader/RPC boundary: default known-active model/variant eligibility, stable-resource-ID collision order, canonical-only output, a third named local RPC method, and a tier-local keyset that remains distinct from the unresolved merged public cursor. This clarification changes no product requirement and makes no public route, service-binding, provider-model-ID, complete-search, resource, or deployment claim.
- **2026-08-02:** Froze the initial A2 operational envelope, separated per-publication runtime queryability from workerd semantic gold coverage, and defined the backup-v1 restore-source transformation used by the local rebuild seam. This clarification narrows implementation choices within the accepted design; it changes no product requirement and makes no backup, restore, backend, release, resource, or deployment claim.

## Context

ADR 0025 and Phase 5F establish a trusted, complete, closure-bound `model-variant-name@1` projection. They intentionally stop before persistence because Model and Variant display names continue to admit U+0000. SQLite text functions can treat embedded NUL differently from byte-oriented code, so storing these names as ordinary `TEXT` and validating them with text-length or text-prefix expressions would create a false completeness boundary. Unlike the provider-specific prohibition in ADR 0022, silently rejecting or rewriting those bytes is not allowed.

The durable projection also affects more than one component. A candidate must not seal, become ready, activate, or roll back unless its model/variant exact-name rows are complete, queryable, and bound into the same proof used by the switch. Restore must rebuild those rows from canonical resources. The existing v2 proof family and serving schema `1.5.1` do not contain that evidence and cannot be reinterpreted in place.

Adding the equality reader in the same change would mix an atomic publication-format cutover with a public-read protocol concern. It would also encourage premature claims about merged tiers, cursor ordering, provider-model-ID results, and `/v1/search`, none of which this decision resolves.

## Decision

### U+0000-safe physical representation

Serving migration `0009` will advance only an exact pristine schema `1.5.1` database to schema `1.6.0`. It will create an immutable, publication-scoped `STRICT` ordinary table named `publication_model_variant_name_search_document` with these logical columns:

| Column | Storage and invariant |
|---|---|
| `publication_id` | `TEXT`; references the candidate publication |
| `resource_type` | `TEXT`; exactly `model` or `variant` |
| `resource_id` | `TEXT`; stable ID whose prefix agrees with `resource_type` |
| `projection_version` | `TEXT`; exactly `model-variant-name@1` |
| `display_name_utf8` | `BLOB`; exact UTF-8 bytes, length 1–800 bytes |
| `normalized_name_utf8` | `BLOB`; exact pinned-normalization UTF-8 bytes, length 1–14,400 bytes |
| `resource_content_hash` | `TEXT`; recomputed lowercase `sha256:` digest |

The primary key is `(publication_id, resource_type, resource_id)`. A composite foreign key binds the row to the same canonical `publication_resource`. The exact lookup index is `(publication_id, normalized_name_utf8, resource_id)`. Because stable resource IDs are globally type-prefixed, `resource_id` is the neutral tie-break across a model/variant normalized-name collision; `resource_type` is selected and validated but is not a relevance key.

Both name columns must satisfy `typeof(column) = 'blob'`. Their bounds use BLOB byte length only. The bulk writer carries each byte string in JSON as validated lowercase, even-length ASCII hexadecimal and materializes the BLOB with SQLite `unhex(json_extract(...))`; it does not depend on JSON text-to-BLOB coercion. The exact reader binds an `ArrayBuffer` or `ArrayBufferView` directly. Writers and readers encode and decode strict UTF-8 and compare bytes; they never use SQLite text length, host Unicode normalization, locale collation, or lossy coercion as an authority. Leading, interior, and trailing U+0000 remain ordinary indexed bytes. Malformed UTF-8 fails closed.

This projection is for exact canonical-name equality only. It gets no second FTS table and does not replace or change `publication_search_document`, its FTS copy, exact-document counts, vector-document counts, or vector identities. Canonical display facts continue to live only in the model or variant resource; public results must rehydrate that canonical JSON and must not serialize projection BLOBs.

### Trusted staging and completeness

The controlled pipeline may derive persistence rows only from the nominal `model-variant-name@1` projection and the same nominal immutable manifest. The implemented runtime-neutral A1 slice defines frozen structural rows, a nominal staging projection, and a nominal model/variant storage-artifact proof before any database writer consumes them. Runtime-neutral rows retain exact UTF-8 as frozen byte-number arrays; A2 alone converts those bytes to validated lowercase even-length hexadecimal for bounded JSON transport. Structural or copied rows alone cannot authorize persistence or readiness, but an exact detached copy is intentionally accepted as a lower-trust storage observation and compared byte-for-byte with the nominal staging projection. Copied staging/proof lookalikes, caller-supplied roots, and raw broad search documents cannot acquire authority.

The staging plan binds publication ID, closure hash, projection version, staging revision, document count, inventory hash, and exact UTF-8 bytes. The A2 writer will take a pre-write candidate snapshot, require `building` and unsealed state, require the expected closure and staging revision, insert the entire bounded projection transactionally, and reconcile the committed rows and inventory after the write. Empty complete projections are valid and use no sentinel. Exact prior completion is an idempotent success; any partial, extra, conflicting, wrong-hash, wrong-byte, or wrong-revision state fails closed.

Migration triggers provide defense in depth: projection rows are insert-only while the candidate is unsealed and building; their identity and resource hash must agree with canonical resources; and sealing requires bidirectional completeness between canonical model/variant resources with known display names and projection rows. SQL cannot independently reproduce `exact-search-normalization@1`, so trusted derivation plus post-write byte/root reconstruction remains required rather than pretending a trigger can prove normalization.

The first writer is deliberately atomic and bounded. Its deterministic chunk planner measures the final JSON parameters in UTF-8 after hexadecimal expansion. One invocation accepts at most 2,000 documents, 2 MiB (2,097,152 bytes) of combined raw display-name and normalized-name bytes, 1,500,000 UTF-8 bytes per JSON payload, 8 MiB (8,388,608 bytes) of retained JSON payloads in aggregate, 40 insert chunks, 50 D1 queries across preflight/write/reconciliation, and a conservative retained-heap estimate of 64 MiB (67,108,864 bytes). The query budget reserves twelve fixed statements, including a second fail-closed reconciliation if the first durability read fails, so it independently limits the theoretical insert count to 38 chunks; the dominant raw-byte cap keeps that path unreachable. Every cap must pass before the writer acquires D1; crossing any one rejects the whole candidate without mutation. The estimate includes at least the trusted byte arrays, hexadecimal strings, retained JSON, fixed-envelope overhead, and reconstructed D1 rows rather than counting only the final binding.

These initial caps are acceptance ceilings, not capacity promises. A2 must benchmark the full maximum-envelope path in the repository's pinned workerd runtime with the same retained objects and prove adequate margin below D1's transaction-duration limit and the Worker memory limit. Implementation may lower a cap in response to evidence. Raising any cap, removing retained-object accounting, or allowing multiple mutation transactions requires ADR review. The writer may not truncate or silently page. A restart-safe multi-transaction staging protocol would require a separately accepted completion ledger and repair/abandon policy because current projection rows are immutable; that protocol is not implied by this ADR.

### Atomic v3 proof cutover

The physical schema, model/variant writer, seal guard, proof persistence, readiness adapter, switch adapter, and restore rebuild land as one A2 compatibility boundary. Serving schema `1.6.0` accepts only a new v3 proof family:

- readiness receipt version `3.0.0`;
- readiness evaluator/attestation version `3.0.0`;
- probe set `search-gold@3`; and
- switch-preflight version `3.0.0`.

The switch-history event stays `1.0.0` because it already binds the versioned preflight hash. The v3 serving receipt and switch preflight retain the unchanged v2 provider-search suffix, then append one contiguous model/variant suffix in this exact order:

1. `model_variant_name_projection_version`;
2. `model_variant_name_document_count`;
3. `model_variant_name_inventory_hash`;
4. `model_variant_name_storage_version`;
5. `model_variant_name_storage_document_count`;
6. `model_variant_name_storage_queryable`; and
7. `model_variant_name_storage_exact_parity`.

The storage version is exactly `model-variant-name-utf8-blob@1`, and both booleans must be true. Projection count/root must equal the trusted Phase 5F projection; storage count and exact parity must equal the nominal A1 storage-artifact proof and a strict A2 reconstruction of persisted BLOB rows. Exact parity is bidirectional and includes the exact canonical display bytes, normalized bytes, and resource content hash. The A1 artifact proof contains the other six fields but deliberately cannot claim queryability.

A2 appends `model_variant_name_storage_queryable` only after one fixed, SELECT-only runtime probe succeeds against the reconstructed persisted table. The probe names `publication_model_variant_name_exact_idx` with `INDEXED BY`. For a nonempty projection, it binds the normalized-name BLOB from the deterministic first persisted row and requires the complete expected stable-ID-ordered collision set for that exact BLOB. It then binds a fixed empty BLOB, which cannot equal a valid stored normalized name, and requires zero rows. An empty valid projection requires both the live canonical eligible-name count and persisted table count to be zero, runs the same forced-index no-result probe, and returns `idempotent_success` on every invocation because no durable row distinguishes first and repeated empty assertions. It inserts no sentinel and performs no empty-state mutation. These checks establish that this publication's exact persisted rows are reachable through the declared index without relying on unstable `EXPLAIN QUERY PLAN` prose.

Per-publication runtime probing does not manufacture NUL or collision data. Separate pinned-workerd `search-gold@3` fixtures prove leading, interior, and trailing U+0000 round trips, model/variant normalized-name collisions, unknown-name omission, malformed/corrupt-row rejection, and fixed-index behavior. Runtime queryability and semantic gold evidence are both required; neither substitutes for storage exact parity. All seven fields participate in serving-receipt and switch-preflight hashing in the declared order. Existing v1/v2 readiness constructors and hash vectors remain historical; adapters for schema `1.6.0` reject them.

Migration `0009` is a pristine-state cutover, like migration `0007`: it rejects legacy sealed publications, readiness attestations, heads, preflights, or switch history instead of fabricating v3 evidence for already published state. A future populated upgrade requires a separate rebuild plan and approval. The canonical publication `schema_version` remains distinct from serving D1 schema `1.6.0`.

### Backup and restore

The BLOB projection is reconstructible and noncanonical. Portable serving backup omits it, as it already omits the provider projection and FTS copy. A2 defines a local restore-source profile over a fully validated backup-format-`1.0.0` manifest; validation of the complete manifest, trusted closure, boundaries, chunks, counts, and root happens before transformation. The profile then selects only the target publication's canonical and deterministic rebuild-source rows: the publication record, provider dispositions and metadata, provider attribution, canonical resources, broad search documents, vector inventory, and inventory chunks. The fresh schema seeds the staging revision and deterministically advances it as those rows are imported; backup v1 does not import a revision row. The publication lifecycle is transformed into an isolated `building`, unsealed candidate while preserving the closure-bearing facts needed to reconstruct the same trusted manifest.

The restore-source profile excludes the backed-up `serving_schema_metadata`, closure seal, every readiness receipt and attestation, switch preflight/history, publication head, broad FTS virtual table, provider ordinary/FTS projections, and model/variant BLOB projection. Literal import of the full backup table inventory is forbidden: it would import stale schema and authorization state and bypass deterministic search reconstruction. Unexpected dependencies or a transformation that cannot reproduce the trusted closure fail before any seal or head write.

The local A2 restore-rebuild coordinator seam consumes only this verified profile in a fresh isolated schema, reconstructs the trusted manifest, rebuilds provider search and then model/variant exact-name search, verifies both inventories and queryability, seals, and regenerates v3 readiness/probe evidence. It stops before switching by default; any optional local switch still uses the ordinary v3 adapter. A missing, extra, malformed, byte-mismatched, normalization-mismatched, hash-mismatched, or nonqueryable rebuilt row blocks the transcript before the head can change.

The closed backup-v1 allowlist remains unchanged and must explicitly reject both provider and model/variant reconstructible projection tables. A2's local profile, coordinator interface, and deterministic transcript are not a real exporter/importer, R2 backup, Time Travel recovery, production restore, migration-away proof, RPO/RTO result, or disaster-recovery exercise. `BE-010`–`BE-012` and `GATE-restore-and-rebuild` remain `Planned` release gates until those complete operational paths run successfully.

### Delivery split

Phase 5G is split into three reviewable boundaries:

- **5G-A1:** runtime-neutral structural persistence rows, nominal revision-bound staging, nominal model/variant storage-artifact proof, focused negative tests, and design documentation. It adds no migration or I/O.
- **5G-A2:** migration `0009`, bounded atomic staging, schema `1.6.0`, v3 readiness/switch writers, completeness guards, and restore rebuild integration. These pieces are one atomic compatibility cutover and may not be partially activated.
- **5G-B:** a bounded SELECT-only indexed equality reader, canonical rehydration, bookmark-continuous query RPC method, and internal API adapter seam.

5G-B does not create `/v1/search`, configure a service binding, define the merged multi-tier cursor, add provider-model-ID search, or claim complete search. The reader binds normalized query UTF-8 as a BLOB, fetches by the exact index, orders by stable resource ID within the equality tier, revalidates canonical resource bytes and status, and returns facts from canonical JSON only.

The function reader accepts an exact publication, bounded query, nullable `model|variant` selector, nullable stable-resource-ID keyset, and limit `1..20`. Its tier-local `afterResourceId` is usable only with the identical publication, normalized query, selector, and limit; it is not an ADR 0016 token or a merged-search continuation. The RPC and API seams remain first-page-only, require `continuation=null`, and issue no public cursor. Default results require canonical `status.state=known` and `status.value=active`; every other or non-known status remains retained but absent from this operation.

The named local catalog-query entrypoint adds only `readModelVariantExactNameTierV1` to ADR 0023's Phase-5D surface. It accepts the same version, audience, protected environment, live-only bookmark, and closed search envelope; permits no filter or exactly `record_type=model|variant`; resumes a D1 Session from that bookmark; and calls only the fixed model/variant reader. The reader returns a tier-1 canonical-name candidate with stable ID and canonical display-name Fact, but no normalized projection bytes/key, score, provider fact, provider count, offering fact, or affiliate state. The separately reviewed acceptance contract is [Phase 5G-B](../design/phase-5g-b-model-variant-exact-reader.md).

No visitor-derived value is persisted, logged, traced, measured, cached, or added to proof state. A live query exists only long enough to validate, normalize, bind, and return the read result. Every query-string response remains `private, no-store` at the later public boundary.

## Consequences

- Model and Variant U+0000 behavior is preserved without depending on ambiguous SQLite text operations.
- A sealed or switched publication cannot claim canonical exact-name completeness using only the older broad search document or v2 provider proof.
- The model/variant projection remains reproducible from canonical closure data and is never a second canonical fact store.
- Schema `1.6.0` is an all-at-once compatibility boundary; partial deployment of its table, writers, proofs, seal guard, switch logic, or restore logic is prohibited.
- The initial bounded writer blocks any candidate above the frozen operational envelope. Pinned-workerd benchmarking may lower but cannot raise that envelope without ADR review.
- A2 proves only a local canonical-source transformation and rebuild seam. Full backup/export/import and disaster-recovery claims remain release work.
- Search traceability remains `Planned` until A2, B, public composition, full acceptance, and deployed evidence exist.

## Alternatives considered

- Store names as `TEXT`: rejected because embedded U+0000 makes SQL text functions an unsafe cross-runtime completeness authority.
- Extend ADR 0022 and forbid U+0000 in Model/Variant names: rejected because a provider storage constraint does not authorize a broader product-contract change.
- Base64-encode names into `TEXT`: rejected because it adds a second encoding/canonicalization surface and loses direct bytewise UTF-8 equality.
- Reuse `publication_search_document.normalized_name`: rejected by ADR 0025 because sealed caller-provided broad-search bytes can still produce false negatives.
- Add another FTS table: rejected because canonical exact classification needs indexed equality, while broad FTS already has separate keyword semantics.
- Mutate the v2 proof family: rejected because old digests and persisted rows must keep their exact meaning.
- Page writes across transactions without a completion ledger: rejected because a crash can leave an immutable partial projection that no existing seal/readiness proof can safely distinguish or repair.
- Ship the reader with the schema cutover: rejected because query/RPC compatibility and merged-search behavior are independently reviewable and not required to make publication durable and truthful.

## Validation

- In portable SQLite and real workerd/D1, prove `STRICT` BLOB enforcement, `unhex` materialization from lowercase even-length JSON hex, direct ArrayBuffer/View query binding, exact UTF-8 round trips, byte lengths, equality lookup, and index use for leading, interior, and trailing U+0000.
- Reject malformed UTF-8, invalid scalar input, empty normalized bytes, type/ID mismatch, unknown-name rows, wrong hashes, wrong revisions, duplicates, omissions, extras, and normalized collisions that are incorrectly collapsed.
- Prove migration atomicity, exact `1.5.1` precondition, pristine-state rejection, schema-name collision rollback, final `1.6.0` metadata, immutable rows, and seal-time bidirectional completeness.
- Prove the bounded writer enforces all seven frozen caps before D1, benchmarks the maximum retained-object envelope in pinned workerd, fails without mutation one unit above each cap, and reconciles exact committed state after ambiguous outcomes in both portable SQLite and workerd.
- Add independent v3 receipt/preflight hash oracles and prove the seven-field suffix order, A1's inability to claim queryability, v2 incompatibility, readiness failure, switch failure, rollback failure, and last-known-good head preservation at every statement boundary.
- Prove complete backup-v1 validation precedes the canonical/rebuild-source transformation; literal full import and every excluded proof, head, schema, or search-projection table are rejected; and the isolated local coordinator rebuilds exact v3 evidence or fails before switching for every row/byte/root corruption.
- In 5G-B, prove fixed SELECT-only source, active/default eligibility, strict canonical rehydration, byte parity, stable-ID ordering, bounded pagination, D1 bookmark continuation, and absence of a public route or visitor-data sink.
- Keep every mapped traceability status `Planned` until its complete local, preview, production, legal, privacy, and release evidence exists.

## References

- [ADR 0015: immutable publication closure and lifecycle](0015-publication-closure-and-lifecycle.md)
- [ADR 0019: seal-bound readiness ledger](0019-seal-bound-readiness-ledger.md)
- [ADR 0021: canonical provider exact search](0021-canonical-provider-exact-search.md)
- [ADR 0022: provider-only NUL prohibition](0022-forbid-nul-provider-display-names.md)
- [ADR 0023: local query RPC and bookmark continuity](0023-local-query-rpc-and-bookmark-continuity.md)
- [ADR 0025: trusted model/variant exact-name projection](0025-trusted-model-variant-name-projection.md)
- [Phase 5G-A2 cutover design](../design/phase-5g-a2-model-variant-search-cutover.md)
- [SQLite: NUL characters in strings](https://www.sqlite.org/nulinstr.html) — documents TEXT `length()` truncation at the first U+0000 and full-byte BLOB representation.
- [SQLite: built-in scalar functions](https://www.sqlite.org/lang_corefunc.html) — specifies BLOB byte length, `typeof`, and paired-hex-to-BLOB `unhex` behavior.
- [Cloudflare D1 Workers Binding API](https://developers.cloudflare.com/d1/worker-api/) — specifies `STRICT` guidance plus ArrayBuffer/View-to-BLOB writes and Array reads.
- [Cloudflare D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) — specifies sequential transactional batches and whole-sequence rollback on failure.
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/) — current query, value/row, statement, parameter, duration, and batch constraints used by A2's fail-closed capacity plan.
- [Cloudflare D1 supported SQL surface](https://developers.cloudflare.com/d1/sql-api/sql-statements/) and its [pinned workerd SQLite allowlist](https://github.com/cloudflare/workerd/blob/4c42a4a9d3390c88e9bd977091c9d3395a6cd665/src/workerd/util/sqlite.c%2B%2B#L248-L320) — identify JSON functions and `unhex` as allowed runtime functions; A2 must still prove them in the repository's pinned workerd runtime.
