# Phase 5H-A2: provider-model-ID durable storage and v4 proof cutover

| Attribute | Value |
|---|---|
| Status | Locally implemented; remote and release evidence pending |
| Decision | [ADR 0028](../decisions/0028-provider-model-id-durable-storage-cutover.md) |
| Prerequisite | [Phase 5H-A1](phase-5h-a1-provider-model-id-projection.md) |
| Requirements | `DATA-001`, `DATA-004`, `DATA-020`, `DATA-021`, `DATA-025`, `RULE-004`, `RULE-017`, `FE-010`, `FE-013`, `FE-023`, `FE-025`, `FE-026`, `API-003`, `API-010`, `SRCH-002`, `SRCH-006`–`SRCH-010`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-010`–`BE-012`, `CF-022`, `SEC-005`, `SEC-007`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006` |

## Outcome and boundary

Phase 5H-A2 is the locally implemented compatibility cutover from serving schema `1.6.0` and v3 proofs to serving schema `1.7.0` and provider-model-ID-aware v4 proofs. Migration `0010`, the dual-BLOB table and indexes, bounded writer, all-Offering seal guard, storage/queryability evidence, readiness commit, activation and rollback preflight, backup exclusion, and local restore rebuild land together. No partial combination is compatible.

This document remains the implementation contract and now records local code and test evidence for the cutover. It adds no remote resource or deployment evidence. Every mapped traceability row and release gate retains its current status.

## Fixed storage contract

The `STRICT` table `publication_provider_model_id_search_document` has one primary-keyed row per `(publication_id, offering_id)`. Each row carries the fixed Offering resource type, attributed provider, target Model or Variant type and ID, `provider-model-id@1`, exact raw UTF-8 BLOB, exact `exact-search-normalization@1` UTF-8 BLOB, and Offering and target content hashes.

| BLOB | Accepted byte length | Empty allowed |
|---|---:|---|
| `raw_provider_model_id_utf8` | 1–1,024 | No |
| `normalized_provider_model_id_utf8` | 0–18,432 | Yes, as `X''` |

The required ordinary indexes are:

```text
publication_provider_model_id_raw_exact_idx
  (publication_id, raw_provider_model_id_utf8, offering_id)

publication_provider_model_id_normalized_exact_idx
  (publication_id, normalized_provider_model_id_utf8, offering_id)
```

Both indexes are non-unique. Offering ID is a stable storage/probe tie only. Same raw bytes, same normalized bytes, same provider, or same target never merge rows. The storage version `provider-model-id-utf8-blob@1` means the complete table representation plus both named indexes; an implementation with only one index is not that version.

Foreign keys bind the publication, Offering, provider slice, and target resource where the existing parent keys permit it. Insert and seal triggers independently require exact Offering attribution, canonical provider and target linkage, raw bytes, and both hashes. Normalized bytes and the ADR 0027 inventory remain trusted-core/post-write proof responsibilities because SQLite does not implement the pinned normalizer.

## Runtime-neutral staging and proof core

Before D1 access, publication core must expose:

1. frozen structural storage rows whose raw and normalized fields are detached byte-number arrays;
2. a nominal staging projection derived only from the nominal ADR 0027 projection and same nominal manifest; and
3. a nominal storage-artifact proof derived from exact lower-trust observed rows compared against that staging projection.

The staging projection contains:

```text
publicationId
closureHash
projectionVersion = provider-model-id@1
storageVersion = provider-model-id-utf8-blob@1
stagingRevision
documentCount
inventoryHash
rows
```

The artifact proof contains exactly six non-queryability fields:

```text
provider_model_id_projection_version
provider_model_id_document_count
provider_model_id_inventory_hash
provider_model_id_storage_version
provider_model_id_storage_document_count
provider_model_id_storage_exact_parity
```

The proof reconstructs every A1 field and the complete inventory in ASCII Offering-ID order. A copied staging object, caller-authored root, broad search document, reordered row, or structurally matching proof cannot gain nominal trust. Queryability is deliberately absent until real D1 probes pass.

## Migration and all-Offering seal

Migration `0010_provider_model_id_exact_projection.sql` must fail before mutation unless schema metadata is exactly `1.6.0` and the database is pristine for a proof-family cutover. Metadata is not sufficient: before any DDL, the migration structurally validates the retained provider-name table and exact index, the model/variant BLOB table and exact index, and the complete retained exact-search trigger inventory: model/variant insert, update, delete, and seal guards plus provider insert, FTS insert, update, delete, and U+0000 guards. It verifies each table's columns and each current exact reader index's portable semantic shape: ordinary non-unique non-partial origin and exactly three ascending `BINARY` key columns with the required order and column IDs. It intentionally does not depend on engine-specific stored SQL formatting or auxiliary `index_xinfo` rows. A missing trigger, table, or index, or a partial, unique, collated, descending, or otherwise malformed index aborts atomically at `1.6.0`; after exact repair, the same migration is retryable. After all version, structure, lifecycle, proof, and collision preflights pass, the migration transaction drops and recreates all nine retained triggers from their canonical definitions. Thus a same-name message-preserving `WHEN 0` or no-op body is repaired before v4 DDL and cannot survive the cutover; any later failure rolls the repair back with the whole migration. It also rejects any publication outside `building` or `failed`, every closure seal, readiness binding or subtype receipt, readiness attestation, publication head, switch preflight or history event, and every colliding v4 table, index, or trigger name.

The table is insert-only while the matching candidate is `building` and unsealed. Update and delete always reject. The insert path requires the expected closure and staging revision, exact resource identity and hash, exact provider attribution, exact target link, and exact canonical raw BLOB.

The new seal guard extends rather than replaces the provider and model/variant checks. For the candidate publication it proves:

- every canonical Offering has exactly one provider-model-ID row;
- every row maps to an exact canonical Offering and its enabled attributed provider;
- target type/ID and target hash match the Offering and canonical target;
- raw bytes and Offering hash match canonical Offering bytes;
- no extra row exists; and
- all earlier provider-name and model/variant-name projections still close.

Completeness includes active, inactive, stale, non-stale, and every other contract-valid Offering status. The seal does not implement default search eligibility. Empty storage closes only when the live canonical Offering count is zero.

## Bounded writer contract

The writer detaches nominal rows, encodes each BLOB as lowercase even-length hex, measures final JSON in UTF-8, and uses fixed `json_each` plus `unhex` SQL. It must validate every limit before opening a D1 session:

| Limit | Initial ceiling |
|---|---:|
| Offering rows | 2,000 |
| Raw plus normalized bytes | 2,097,152 |
| One JSON payload | 1,500,000 bytes |
| Retained JSON aggregate | 8,388,608 bytes |
| Insert chunks | 34 |
| Invocation D1 queries | 50 |
| Retained-heap estimate | 67,108,864 bytes |
| Insert bound parameters | 4 |

Sixteen fixed statements are reserved: two initial snapshot statements, the mutation precondition and postcondition, six statements for the first complete reconstruction and dual-index reconciliation, and six for the catch-path reconciliation needed when durability remains uncertain. Exact ordered index-definition checks run inside the raw indexed probes without adding a statement. Combined with the 50-query ceiling, at most 34 insert chunks are possible. The query/heap accounting is invocation-wide, including the failure path. The exact 2,000-document/2 MiB envelope produces four insert payloads, twenty total writer queries, 5,368,308 retained JSON bytes, a 1,499,798-byte largest payload, and a 39,450,238-byte conservative retained-heap estimate.

These limits sit below the official constraints reviewed on 2026-08-02: 2,000,000-byte D1 BLOB/row, 100,000-byte SQL statement, 100 bound parameters, 30-second D1 query/batch execution, 128 MB Worker memory, 50 Free or 10,000 Paid subrequests, and 50 Free or 1,000 Paid D1 queries. The fixed SQL text, not a bound JSON value, is checked against the SQL statement ceiling.

The maximum accepted planner output must run in pinned workerd with the real retained object graph and adequate time/memory margin. Evidence may lower any initial cap before implementation is accepted. It may not raise one. Multiple mutation transactions, restart state, or a larger envelope require a new ADR with a completion ledger and repair/abandon protocol.

### Outcome classification

The complete projection is one `D1Database.batch()` mutation. Current D1 semantics execute that batch sequentially as one SQL transaction and roll back the entire sequence when any statement fails. Durability reads use `withSession("first-primary")` so the first query is primary-anchored and subsequent queries are sequentially consistent. The writer never truncates, skips a status, or paginates across transactions.

| Observed outcome | Classification |
|---|---|
| Exact rows already durable under the same revision and both probes pass | `idempotent_success` |
| Mutation confirmed absent and candidate still eligible | retryable `not_applied` |
| Partial, extra, conflicting, wrong-revision, wrong-byte, wrong-hash, or wrong-link rows | fatal conflict/integrity failure |
| Durability cannot be classified after bounded reconciliation | `outcome_unknown` |
| Stale lifecycle, closure, seal, or revision | stale, not retried as the same write |

A valid empty projection inserts no sentinel. Once canonical and stored counts are both proven zero and both miss probes pass, every assertion is idempotent success.

## Dual-index queryability evidence

The writer reconstructs persisted rows in ASCII Offering-ID order, verifies exact storage parity, then runs four fixed forced-index query shapes:

1. raw index, selected persisted raw BLOB;
2. raw index, `X'FF'`;
3. normalized index, selected persisted normalized BLOB; and
4. normalized index, `X'FF'`.

For each selected value, the result must equal the complete expected Offering-ID-ordered collision set. It is not enough to find the first row. For each `X'FF'` value, no row may return. Exact parity has already established strict UTF-8 storage, so standalone byte `FF` cannot be a raw value, normalized value, or empty normalized BLOB.

An empty publication first proves zero canonical Offerings and zero stored rows, then runs both no-result index probes. Every SQL query names its index with `INDEXED BY`; missing or unusable index state fails directly without parsing `EXPLAIN QUERY PLAN` text.

`provider_model_id_storage_queryable` becomes true only when exact storage parity, both match probes, both no-result probes, and `search-gold@4` evidence all pass. Gold fixtures must include U+0000 at every position, empty normalized bytes, raw duplicates, normalized collisions, repeated targets/providers, all Offering status/stale states, corrupt bytes and hashes, and both index names.

## Readiness, activation, and rollback

Schema `1.7.0` uses only:

```text
readiness receipt       4.0.0
readiness evaluator     4.0.0
readiness attestation   4.0.0
probe set               search-gold@4
switch preflight        4.0.0
switch history event    1.0.0
```

The v4 serving receipt and preflight retain the entire v3 sequence, then append exactly:

```text
provider_model_id_projection_version
provider_model_id_document_count
provider_model_id_inventory_hash
provider_model_id_storage_version
provider_model_id_storage_document_count
provider_model_id_storage_queryable
provider_model_id_storage_exact_parity
```

All seven fields participate in receipt and preflight hashes in that order. Both boolean fields are true. Primary-anchored reconstruction protects classification and idempotent paths. The mutation fence is stronger: readiness and switch each prepend the same two fixed assertions to their D1 batch. A 34-slot, `[]`-padded JSON/unhex CTE reconstructs every proof-bound row and proves bidirectional scalar/BLOB parity; each payload is an independent `VALUES` row expanded separately, avoiding any combined multi-megabyte SQLite value. A second statement validates both exact ordered index definitions with table-valued `pragma_index_info(...)` and proves raw and normalized collision sets plus forced `X'FF'` misses through `INDEXED BY`. The readiness batch has fourteen statements and the switch batch five, so drift introduced after the external check aborts before any durable readiness or head state. The pinned-workerd exact 2,000-document/2 MiB fixture executes the two atomic assertions within the 30-second D1 batch/query ceiling while retaining the documented memory and query accounting. The readiness-attestation and switch-history triggers repeat exact definition and forced-miss checks as defense in depth.

Activation requires the exact fresh v4 attestation. Rollback targets the immediate superseded publication and requires a fresh v4 preflight over its current table even though rollback carries no readiness attestation. Switch history stays `1.0.0` and transitively binds the v4 fields through the preflight hash. Any failure preserves the previous head.

V1–v3 constructors remain historical. Schema `1.7.0` rejects them as incompatible. The canonical publication schema version remains separate from serving D1 `1.7.0`.

## Backup and restore rebuild

The provider-model-ID table is excluded from portable backup because canonical Offerings and targets are sufficient to reproduce it. Backup format `1.0.0` and its closed selected-table allowlist remain unchanged; tests must reject the projection table if it appears.

The v4 restore-source profile imports no schema metadata, staging revision, projection table, FTS copy, seal, readiness evidence, switch evidence, or head. It validates the complete backup before transforming selected canonical rows into a fresh isolated schema `1.7.0` candidate in `building` state.

The local transcript order is fixed:

```text
import
closure comparison
provider-name rebuild
model/variant-name rebuild
provider-model-ID rebuild
seal
readiness v4
optional local switch v4
```

The provider-model-ID rebuild derives all Offering and referenced-target rows again, proves the ADR 0027 root and exact BLOB parity, runs both index match/miss probes, and stops on any mismatch before seal. The trusted proof persistence must match the restore candidate's publication ID, closure hash, document count, inventory hash, and every ordered projection row; an identical publication-independent inventory from another candidate is invalid. The coordinator stops before switch by default. Its versions, counts, hashes, phase receipts, and synthetic probe IDs contain no visitor input.

This seam is not a production exporter/importer, R2 or Time Travel restore, Vectorize rebuild, migration-away test, operational authorization, RPO/RTO result, or disaster-recovery exercise. Those release gates remain planned.

## Acceptance matrix

| Area | Required evidence |
|---|---|
| Migration | Exact `1.6.0` pristine gate, name-collision rejection, rollback after every statement, resulting `1.7.0` inventory |
| Storage | `STRICT` BLOBs, raw 1–1,024, normalized 0–18,432, U+0000, empty normalized, lowercase hex and `unhex` |
| Completeness | Exactly one row for every Offering across all status/stale values; no missing, extra, or duplicate rows |
| Referential integrity | Exact provider attribution, Offering identity/hash/raw bytes, target type/ID/hash, enabled-provider scope |
| Collisions | Duplicate raw and normalized values retained; both complete Offering-ID-ordered collision sets pass |
| Queryability | Both `INDEXED BY` match probes and both `X'FF'` miss probes, including empty publication |
| Bounds | Below/at/above every cap before D1; maximum-envelope pinned-workerd time and retained-memory proof |
| Staging | Nominal trust, revision fence, atomicity, idempotence, response loss, malformed D1, every statement failure |
| Proof v4 | Independent receipt/attestation/preflight/history hashes, exact suffix order, old-proof rejection |
| Switching | Initial/replacement activation, immediate rollback, expiry, stale generation, concurrent change, last-known-good preservation |
| Restore | Closed backup allowlist, explicit exclusion, deterministic rebuild order, corruption stopped before seal/head |
| Privacy | No request surface, visitor values, logs/traces/telemetry, payload echoes, cookies, browser storage, cache, or public route |
| Nonclaims | No reader/RPC/API, public matching, collision policy, filter composition, merged cursor, remote resource, deployment, or operational restore claim |

## Zero-visitor-data boundary

Phase 5H-A2 is an offline controlled-pipeline surface. Its inputs are nominal manifests, canonical resources, controlled lifecycle state, and version-controlled synthetic probes. It accepts no visitor request object or derivative and emits no request log, trace, metric, alert detail, cache entry, correlation ID, or analytics event. Fixed errors never echo provider-controlled bytes.

New production pipeline modules require a focused privacy scan for `console.*`, request/header/cookie types, source addresses, user agents, referrers, visitor identifiers, telemetry, and payload echo. Existing public Workers and `private, no-store` behavior remain unchanged.

## Explicit nonclaims and Phase 5H-B handoff

A2's two indexes are storage capabilities, not a search contract. Phase 5H-B must separately decide and test:

- stale-active and other Offering eligibility;
- raw, normalized, or combined public equality;
- reachability under the 200-byte public query ceiling and reserved syntax;
- returned resource type and `match_kind`;
- collision deduplication and neutral tier ordering;
- provider-filter and structured-filter composition; and
- the complete merged exact/prefix/semantic cursor.

Offering-ID order is valid only for storage reconciliation and collision-set probes. A future reader must rehydrate canonical resources and cannot expose the projection BLOBs as facts. A2 adds no reader, RPC method, API adapter, service binding, public route, or complete-search claim.

## Implementation sequence

1. Add the runtime-neutral storage rows, nominal staging projection, six-field artifact proof, and independent vectors.
2. Add migration `0010` with table, dual indexes, immutability, all-Offering seal, and pristine v4 cutover.
3. Add the bounded hex/unhex writer, post-write reconstruction, dual-index probes, failure classification, and maximum-envelope workerd benchmark.
4. Add cumulative v4 readiness, attestation, preflight, history guards, independent hashes, and all-statement failure tests.
5. Extend backup exclusion and the isolated restore coordinator with the provider-model-ID rebuild phase.
6. Run full local verification and record only local implementation evidence; leave Phase 5H-B and all remote/release gates pending.
