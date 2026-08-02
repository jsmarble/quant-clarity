# ADR 0028: Persist provider model IDs as dual-indexed UTF-8 BLOBs and cut serving proof to v4

- Status: Accepted
- Implementation: Locally implemented; remote and release evidence pending
- Date: 2026-08-02
- Decision owners: Staff engineer, search lead, data-integrity lead
- Related requirements: `DATA-001`, `DATA-004`, `DATA-020`, `DATA-021`, `DATA-025`, `RULE-004`, `RULE-017`, `FE-010`, `FE-013`, `FE-023`, `FE-025`, `FE-026`, `API-003`, `API-010`, `SRCH-002`, `SRCH-006`–`SRCH-010`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-010`–`BE-012`, `CF-022`, `SEC-005`, `SEC-007`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006`
- Extends: ADRs 0015, 0017, 0019–0021, and 0025–0027

## Context

ADR 0027 and Phase 5H-A1 establish a complete, closure-bound `provider-model-id@1` projection with exactly one row for every canonical Offering. The projection retains exact raw and normalized provider model IDs, Offering and provider identity, target Model or Variant identity, and both resource content hashes. It deliberately adds no durable representation, readiness evidence, or reader semantics.

Durability cannot reuse `publication_search_document.provider_model_ids_json` or its FTS copy. Those caller-supplied values do not prove that every Offering contributed an ID, and a reader can reject a false positive but cannot recover an omitted Offering. Provider model IDs also admit U+0000, and `exact-search-normalization@1` may produce an empty normalized value for a contract-valid punctuation- or separator-only raw ID. SQLite `TEXT` operations therefore cannot be the byte-integrity authority.

The physical choice must preserve, rather than decide, the Phase 5H-B questions. In particular, public equality may eventually use raw bytes, normalized bytes, or a separately approved combination. Persisting and indexing both forms keeps either reader contract possible without turning physical index order into public relevance, deduplication, or result semantics.

Adding this reconstructible projection changes the publication compatibility boundary. A candidate must not seal, become ready, activate, or roll back unless every Offering row is durably present, byte-exact, queryable through both declared indexes, and bound into the same proof used at the head switch. Restore must rebuild the rows from canonical resources. Serving schema `1.6.0` and the v3 proof family contain none of this evidence and cannot be reinterpreted in place.

## Decision

### U+0000-safe dual-index representation

Serving migration `0010` will advance only an exact pristine serving schema `1.6.0` database to `1.7.0`. It will create an immutable, publication-scoped `STRICT` ordinary table named `publication_provider_model_id_search_document` with these logical columns:

| Column | Storage and invariant |
|---|---|
| `publication_id` | `TEXT`; references the candidate publication |
| `offering_resource_type` | `TEXT`; exactly `offering`, used to bind the Offering resource |
| `offering_id` | `TEXT`; stable `off_` identity |
| `provider_id` | `TEXT`; exact enabled and attributed provider identity |
| `target_resource_type` | `TEXT`; exactly `model` or `variant` |
| `target_resource_id` | `TEXT`; stable ID whose prefix agrees with the target type |
| `projection_version` | `TEXT`; exactly `provider-model-id@1` |
| `raw_provider_model_id_utf8` | `BLOB`; exact canonical UTF-8 bytes, length 1–1,024 bytes |
| `normalized_provider_model_id_utf8` | `BLOB`; exact pinned-normalization UTF-8 bytes, length 0–18,432 bytes |
| `offering_content_hash` | `TEXT`; recomputed lowercase `sha256:` digest |
| `target_content_hash` | `TEXT`; recomputed lowercase `sha256:` digest |

The primary key is `(publication_id, offering_id)`, which permits exactly one row per Offering. Composite foreign keys bind the Offering and target to their exact `publication_resource` rows, and the provider binds to the same publication's provider slice. The insert and seal guards additionally require the Offering's exact provider attribution, canonical `provider_id`, `model_resource_id`, raw `provider_model_id` bytes, and both content hashes to agree. The fixed `offering_resource_type` is physical referential-integrity support; it is not a new projection fact or public field.

Two ordinary, non-`UNIQUE` equality indexes are mandatory:

1. `publication_provider_model_id_raw_exact_idx` on `(publication_id, raw_provider_model_id_utf8, offering_id)`; and
2. `publication_provider_model_id_normalized_exact_idx` on `(publication_id, normalized_provider_model_id_utf8, offering_id)`.

Repeated raw IDs, repeated normalized IDs, different providers, and repeated targets remain independent rows. `offering_id` supplies deterministic physical tie order for queryability evidence only. It is not an approved public result order, relevance key, winner, or deduplication rule.

Both ID columns must satisfy `typeof(column) = 'blob'`, and their bounds use BLOB byte length. Empty normalized bytes are valid and materialize as `X''`; no row or sentinel is omitted. The storage version is exactly `provider-model-id-utf8-blob@1`, which fixes both BLOB representations and both named indexes.

The bounded writer carries bytes in JSON only as validated lowercase, even-length ASCII hexadecimal and materializes BLOBs with SQLite `unhex(json_extract(...))`. It does not use JSON text-to-BLOB coercion for durable input. Writers and later readers must use strict UTF-8 byte encoding, direct `ArrayBuffer` or `ArrayBufferView` binding, and byte equality. SQLite text length, host normalization, locale collation, and lossy string coercion are not authorities. Leading, interior, and trailing U+0000 remain ordinary indexed bytes; malformed UTF-8 fails closed.

This table is reconstructible search metadata, not canonical storage. The raw provider model ID remains canonical only in the Offering resource. The table does not replace the broad search document, add FTS, change vectors, change target facts, or authorize projection bytes to appear in a public response.

### Trusted staging and all-Offering completeness

The controlled pipeline may derive persistence only from the nominal `provider-model-id@1` projection and its nominal immutable manifest. Phase 5H-A2 will add frozen structural storage rows, a nominal revision-bound staging projection, and a nominal six-field storage-artifact proof before any D1 writer consumes them. Raw and normalized values are frozen byte-number arrays. Copied projections, caller-authored roots, raw broad search documents, and structurally similar staging or proof objects cannot acquire nominal authority.

The staging plan binds publication ID, closure hash, projection version, storage version, staging revision, complete document count, inventory hash, and every byte-exact row. It requires the expected `building`, unsealed candidate, closure hash, and staging revision before mutation, inserts the entire bounded projection atomically, and reconstructs committed rows and the ADR 0027 inventory after mutation. The fixed mutation uses `D1Database.batch()`: current D1 behavior executes its statements sequentially as one SQL transaction and aborts and rolls back the sequence when any statement fails. Reconciliation uses `withSession("first-primary")`, whose first query is anchored at primary and whose later queries are sequentially consistent. Exact prior completion is idempotent success. A confirmed empty prestate after a failed mutation is retryable. Partial, extra, conflicting, wrong-byte, wrong-hash, wrong-target, wrong-provider, or wrong-revision state fails closed; uncertain durability is reported as outcome unknown.

Empty complete projections are valid only when the trusted manifest and live canonical storage contain no Offerings. They use no sentinel and require no empty-state mutation. Because no durable row distinguishes the first empty assertion from a repeated one, an exact empty assertion is idempotent success.

The seal guard is bidirectional and includes every canonical Offering, regardless of its status or `stale` value. Every Offering must have exactly its row, and every row must map to its exact Offering, enabled attributed provider, target type and ID, raw bytes, and both resource hashes. Inactive, unknown-status, stale, and historical Offerings remain complete durable input; reader eligibility is not a seal concern. SQL cannot independently reproduce `exact-search-normalization@1` or the inventory SHA-256 root, so nominal derivation and byte-for-byte post-write reconstruction remain mandatory rather than pretending that a trigger proves normalized correctness.

The first writer is deliberately atomic and bounded. Its deterministic planner measures final hex-expanded JSON parameters before acquiring D1 and accepts at most:

| Limit | Initial ceiling |
|---|---:|
| Offering documents | 2,000 |
| Combined raw and normalized UTF-8 | 2 MiB / 2,097,152 bytes |
| One final JSON payload | 1,500,000 UTF-8 bytes |
| All retained JSON payloads | 8 MiB / 8,388,608 bytes |
| Insert chunks | 34 |
| Total D1 queries in one invocation | 50 |
| Conservative retained-heap estimate | 64 MiB / 67,108,864 bytes |

The query budget reserves sixteen fixed statements: two initial snapshot statements, the mutation precondition and postcondition, six statements for the first full reconstruction and dual-index reconciliation, and six more for the catch-path reconciliation if durability remains uncertain. Exact ordered `pragma_index_info(...)` checks ride inside the existing raw indexed probes, so they strengthen both reconciliations without consuming another statement. The budget therefore independently limits the theoretical insert count to 34 chunks. Each bulk insert uses one fixed SQL statement below the 100,000-byte statement ceiling and no more than four bound parameters, below the 100-parameter ceiling. Individual BLOBs and rows remain far below D1's 2,000,000-byte BLOB/row ceiling. The exact 2,000-document/2 MiB envelope produces four insert payloads and twenty total writer queries, retains an estimated 39,450,238 bytes, and keeps its largest payload at 1,499,798 bytes.

The retained-heap estimate includes trusted byte arrays, hexadecimal strings, retained JSON, the largest UTF-8 measurement, fixed envelope overhead, and reconstructed D1 rows that coexist. Every cap must pass before `withSession` or another D1 operation. The writer never truncates and never pages one projection across mutation transactions.

Official limits reviewed on 2026-08-02 include D1's 2,000,000-byte BLOB/row, 100,000-byte SQL statement, 100 bound parameters, and 30-second query/batch ceilings; Workers' 128 MB memory limit and 50 Free or 10,000 Paid subrequests; and 50 Free or 1,000 Paid D1 queries per invocation. The project's lower ceilings are acceptance limits, not capacity promises. A2 must run the complete maximum-envelope path in the repository's pinned workerd runtime with the same retained objects and prove adequate time and memory margin. Implementation may lower a cap in response to evidence. Raising a cap, removing retained-object accounting, or adopting multi-transaction staging requires a new ADR. If measured launch data does not fit, work stops for a restart-safe completion-ledger and repair/abandon design; it does not silently omit Offerings.

### Dual-index runtime proof

The storage artifact proof contains these six non-queryability fields:

1. `provider_model_id_projection_version`;
2. `provider_model_id_document_count`;
3. `provider_model_id_inventory_hash`;
4. `provider_model_id_storage_version`;
5. `provider_model_id_storage_document_count`; and
6. `provider_model_id_storage_exact_parity`.

It proves exact row count, Offering-ID order, identities, raw and normalized bytes, provider and target links, both content hashes, and the complete ADR 0027 inventory root. It cannot claim queryability.

A2 adds `provider_model_id_storage_queryable` only after fixed SELECT-only probes name each required index with `INDEXED BY`. For a nonempty projection, each probe chooses the deterministic first Offering-ID row, binds that row's actual raw or normalized BLOB, and requires the complete expected Offering-ID-ordered collision set for that exact byte value. The two probes remain separate even when their selected byte values happen to be equal.

Each index also receives a fixed `X'FF'` miss probe and must return no rows. After exact storage parity has proved that all stored values are strict UTF-8 from the nominal projection, the invalid standalone UTF-8 byte `FF` cannot equal any valid raw value, any normalized value, or the valid empty normalized BLOB. For an empty projection, the runtime first proves that the live canonical Offering count and stored count are both zero, then executes both forced-index `X'FF'` probes. These probes establish actual reachability through both declared indexes without relying on version-sensitive `EXPLAIN QUERY PLAN` wording. They do not select a public comparison mode.

Pinned-workerd `search-gold@4` fixtures separately prove raw and normalized leading/interior/trailing U+0000 round trips, valid empty normalized `X''`, duplicate raw values, normalized collisions, repeated targets and providers, all-status completeness, malformed/corrupt-row rejection, and both named indexes. Runtime reachability, exact storage parity, and versioned gold evidence are all required; none substitutes for another.

### Atomic v4 proof cutover

The physical schema, writer, seal guard, proof persistence, readiness adapter, switch adapter, and restore rebuild land as one compatibility boundary. Serving schema `1.7.0` accepts only:

- readiness receipt version `4.0.0`;
- readiness evaluator and attestation version `4.0.0`;
- probe set `search-gold@4`; and
- switch-preflight version `4.0.0`.

Switch-history event version remains `1.0.0` because it already binds the versioned preflight hash. The v4 serving receipt and switch preflight preserve the complete v3 field sequence byte-for-byte, then append one contiguous provider-model-ID suffix in exactly this order:

1. `provider_model_id_projection_version`;
2. `provider_model_id_document_count`;
3. `provider_model_id_inventory_hash`;
4. `provider_model_id_storage_version`;
5. `provider_model_id_storage_document_count`;
6. `provider_model_id_storage_queryable`; and
7. `provider_model_id_storage_exact_parity`.

The storage version is `provider-model-id-utf8-blob@1`; both booleans must be true. All seven fields participate in serving-receipt and switch-preflight hashing in that order. Projection count and root must equal the nominal ADR 0027 projection; storage count and exact parity must equal the nominal storage-artifact proof and reconstructed persisted rows; queryability requires both named indexes and `search-gold@4` evidence.

Readiness and switch retain primary-anchored external reconstruction for classification and idempotent paths, but that check is not a transaction fence. Each mutation batch therefore begins with two fixed assertions derived from the proof-bound rows: one 34-slot, `[]`-padded JSON/unhex reconstruction that proves exact bidirectional scalar and BLOB parity, and one assertion that validates the exact ordered columns of both indexes through table-valued `pragma_index_info(...)` and proves the raw and normalized collision sets plus forced `X'FF'` misses through `INDEXED BY`. The parity CTE holds its 34 payloads as independent `VALUES` rows and expands each separately; it never combines the multi-megabyte envelope into one SQLite string or BLOB. These assertions share the same D1 transaction as the readiness ledger and state transition (fourteen statements total) or preflight, history, lifecycle, and head mutation (five statements total). Any row drift, missing index, or same-name wrong-column index introduced after the external check aborts the entire transaction. The pinned-workerd exact 2,000-document/2 MiB case executes both atomic assertions successfully within the 30-second D1 batch/query ceiling. The readiness-attestation and switch-history triggers repeat exact index-definition and forced-miss checks as defense in depth. Activation requires the exact unexpired v4 readiness attestation. Rollback carries no readiness attestation but still requires a fresh v4 preflight over the immediate superseded target and its current provider-model-ID storage. Generation compare-and-swap and last-known-good head behavior remain unchanged.

Existing v1–v3 constructors and fixed hashes remain historical. Schema `1.7.0` rejects old writers rather than reinterpreting or retrying them. Migration `0010` is a pristine cutover: it rejects publications outside `building` or `failed`, every seal or proof-bearing lifecycle row, wrong schema metadata, colliding schema objects, and missing required retained exact-search structures before mutation. Specifically, structural preflight validates the provider-name table/index, model/variant-name BLOB table/index, all four retained model/variant triggers, and all five retained provider triggers, while independently proving exact table columns and both current exact reader indexes' portable semantic shape: ordinary non-unique non-partial origin and exactly three ascending `BINARY` key columns with the required order and column IDs. It does not treat the `1.6.0` metadata row or a same-length SQL definition as sufficient, and does not depend on engine-specific stored SQL formatting or auxiliary `index_xinfo` rows. Once every non-mutating preflight has passed, the same transaction drops and recreates all nine retained triggers from canonical definitions; message-preserving `WHEN 0` and no-op bodies are therefore repaired rather than trusted, and any later failure rolls the repair back. A failed preflight leaves `1.6.0` unchanged and retryable after exact repair. A future populated upgrade requires a separate rebuild plan and approval. The canonical publication `schema_version` remains distinct from serving D1 schema `1.7.0`.

### Backup exclusion and restore rebuild

Provider-model-ID storage is reconstructible and noncanonical, so portable backup omits it. The closed backup-format-`1.0.0` table allowlist remains unchanged and explicitly rejects the new table if it appears in a backup inventory. The restore-source profile excludes the provider-model-ID table alongside serving schema metadata, seals, all readiness and switch evidence, the head, broad FTS, provider search projections, model/variant BLOB projection, and staging revision. Literal import of the full backup inventory remains forbidden.

After complete backup validation, the local v4 restore transform selects only the publication's canonical and deterministic rebuild sources and materializes an isolated `building`, unsealed candidate in a fresh schema `1.7.0`. The coordinator then:

1. imports selected canonical and rebuild-source rows;
2. reconstructs and compares the trusted manifest and closure;
3. rebuilds provider-name search;
4. rebuilds model/variant-name BLOB search;
5. rebuilds provider-model-ID BLOB storage from every Offering and its referenced target;
6. verifies the ADR 0027 inventory, exact raw/normalized storage, and both index probes;
7. creates the closure seal;
8. regenerates `search-gold@4` and v4 readiness evidence; and
9. stops before head mutation unless an explicit local test invokes the ordinary v4 switch adapter.

Any missing, extra, malformed, byte-mismatched, normalization-mismatched, attribution-mismatched, target-mismatched, hash-mismatched, root-mismatched, or nonqueryable row stops before seal or head mutation. The transcript contains only controlled versions, counts, hashes, phase outcomes, and synthetic probe identities.

This local seam is not a real exporter/importer, R2 backup, Time Travel recovery, Vectorize rebuild, migration-away proof, operational authorization, RPO/RTO result, or disaster-recovery exercise. `BE-010`–`BE-012` and the restore-and-rebuild release gate remain planned until those paths run successfully.

### Delivery boundary and deferred reader contract

Phase 5H remains split:

- **5H-A1:** trusted runtime-neutral `provider-model-id@1` derivation;
- **5H-A2:** this durable schema, bounded writer, dual-index proof, v4 readiness/switch cutover, and local restore-rebuild integration; and
- **5H-B:** separately reviewed reader, RPC/API seam, eligibility, public equality and reachability, result mapping, collision behavior, composition, and merged cursor.

A2 does not decide whether stale active Offerings qualify, whether public equality compares raw or normalized bytes, how the Offering contract relates to the 200-byte public query ceiling and reserved syntax, which resource and `match_kind` a result uses, how colliding Offerings deduplicate or order, how provider filters compose, or how the merged multi-tier cursor advances. Indexing both forms and sorting probe collisions by Offering ID preserve options; they do not answer these questions.

A2 adds no reader, RPC method, API adapter, service binding, public route, remote resource, provisioning, or deployment. It does not complete exact-first search or any mapped release gate.

### Zero-visitor-data boundary

A2 is controlled pipeline work over canonical publication data and version-controlled synthetic probes. It adds no public handler, request input, public mutation, browser code, cookie, browser persistence, visitor-derived cache key, referral behavior, analytics, beacon, request log or trace, live-request metric, or correlation identifier.

Staging, proof, readiness, switch, and restore inputs are closed nominal publication structures. They accept no `Request`, URL, query string, headers, cookie, source address, user agent, referrer, or arbitrary error payload. Fixed errors do not echo provider-controlled IDs or payloads. The `X'FF'` probes and workerd fixtures are version-controlled synthetic values. Proof and restore transcript rows contain publication facts and controlled synthetic identities only. Public Workers and their `private, no-store` query-string behavior remain unchanged.

## Consequences

- Every canonical Offering is durably represented without depending on the broad search-document array.
- Raw, normalized, U+0000-containing, and empty-normalized bytes remain lossless and independently queryable at the storage layer.
- Duplicate and colliding Offerings remain visible; physical tie order does not create a public winner.
- A sealed, readied, activated, or rolled-back publication cannot use v3 evidence that omits provider-model-ID storage.
- Schema `1.7.0` is an all-at-once compatibility boundary; partial deployment of its table, writer, proof, seal, switch, or restore logic is prohibited.
- The initial writer rejects candidates above its measured envelope. Workerd evidence may lower but cannot raise the accepted caps without ADR review.
- Full reader semantics, remote deployment, operational backup/restore, and complete search remain pending.

## Alternatives considered

- Reuse the broad provider-model-ID array or FTS tokens: rejected because they cannot prove complete Offering derivation.
- Store IDs as `TEXT`: rejected because U+0000 and byte-length behavior make text functions an unsafe integrity boundary.
- Store only normalized bytes: rejected because it discards exact raw identity and prejudges public matching.
- Store only raw bytes: rejected because it omits the pinned, reconstructible normalization and prejudges public matching.
- Add only one of the two indexes: rejected because it would privilege an unresolved reader mode and require a later format migration to make the other mode bounded.
- Deduplicate by raw ID, normalized ID, target, or provider: rejected because it destroys one-row-per-Offering completeness and silently creates reader semantics.
- Use a unique equality index: rejected because duplicate and colliding Offering IDs are legitimate.
- Use FTS instead of ordinary BLOB indexes: rejected because exact byte equality, including U+0000 and empty normalized bytes, is the durable requirement.
- Use an empty BLOB as the negative probe: rejected because empty normalized bytes are valid. `X'FF'` is impossible after strict-UTF-8 storage parity.
- Mutate v3 receipts or hashes: rejected because persisted historical digests must retain their exact meaning.
- Page writes across transactions without a completion ledger: rejected because a crash can leave immutable partial storage without an approved repair or abandonment protocol.
- Import the projection from backup: rejected because it is reconstructible and importing stale index/proof state would bypass canonical rebuild verification.
- Ship reader semantics in A2: rejected because eligibility, matching, reachability, result, collision, filter, and cursor policies remain Phase 5H-B decisions.

## Validation

- Prove migration rollback after every statement, exact pristine `1.6.0` preconditions, every legacy proof-bearing table, and every schema-name collision.
- Prove `STRICT` BLOB enforcement, exact raw and normalized byte lengths, lowercase even-length hex, `unhex`, U+0000, valid empty normalized `X''`, malformed UTF-8 rejection, ArrayBuffer/View binding, and D1 array decoding.
- Prove exactly one row for every Offering under every contract-valid status and stale value, and bidirectional rejection of missing, extra, duplicate, wrong-attribution, wrong-target, wrong-byte, or wrong-hash rows.
- Prove duplicate raw IDs and normalized collisions remain separate under Offering-ID tie order in both non-unique indexes.
- Prove both forced-index match collision sets and both `X'FF'` no-result probes, including an empty publication.
- Prove one unit below, exactly at, and one unit above every operational cap fails before D1 when over; run the maximum envelope in pinned workerd and lower caps if margin is inadequate.
- Prove every staging precondition, insert chunk, postcondition, reconciliation, response-loss, and malformed-D1 failure classification.
- Prove independent v4 receipt, attestation, preflight, and history hash vectors, exact seven-field suffix order, v1–v3 rejection, and corruption between readiness, preflight, and head mutation.
- Prove first and replacement activation, immediate rollback, stale/concurrent generations, expiry, last-known-good preservation, and all-statement failure injection.
- Prove complete backup validation, explicit projection exclusion, deterministic v4 rebuild order, and every corruption class stopping before seal or head mutation.
- Prove new production pipeline sources contain no visitor request surface, `console.*`, visitor identifier, telemetry, payload echo, cookie, cache, browser persistence, public route, or public Worker mutation.
- Run all applicable repository gates without claiming remote D1, R2, Vectorize, deployment, operational restore, or release evidence.

## References

- [ADR 0015: immutable publication closure and lifecycle](0015-publication-closure-and-lifecycle.md)
- [ADR 0021: canonical provider exact search](0021-canonical-provider-exact-search.md)
- [ADR 0025: trusted model/variant name projection](0025-trusted-model-variant-name-projection.md)
- [ADR 0026: model/variant durable proof and reader split](0026-blob-model-variant-exact-search-cutover.md)
- [ADR 0027: trusted provider-model-ID projection](0027-trusted-provider-model-id-projection.md)
