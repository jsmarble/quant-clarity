# Phase 5G-A2: model/variant durable-search and v3 proof cutover

| Attribute | Value |
|---|---|
| Status | Locally implemented; remote and release evidence pending |
| Decision | [ADR 0026](../decisions/0026-blob-model-variant-exact-search-cutover.md) |
| Prerequisite | [Phase 5G-A1](phase-5g-a1-model-variant-durable-proof-core.md) |
| Requirements | `DATA-001`–`DATA-004`, `DATA-008`, `API-003`, `API-010`, `SRCH-002`, `SRCH-006`, `SRCH-007`, `SRCH-009`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-010`–`BE-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006` |

## Outcome and nonclaims

Phase 5G-A2 is one compatibility cutover from pristine serving schema `1.5.1` and provider-aware v2 proofs to serving schema `1.6.0` and model/variant-aware v3 proofs. The migration, BLOB projection, bounded writer, seal guard, readiness ledger, activation and rollback preflight, backup exclusion, and local restore-rebuild seam must land together. No intermediate combination is compatible.

This note records the locally implemented A2 boundary without amending the PRD. It implements the migration, bounded writers, v3 proof family and fixed D1 adapters, pinned-workerd queryability evidence, backup exclusion, and local restore-rebuild seam. It does not add the Phase 5G-B equality reader/RPC, create a public search route, configure a Worker binding, apply the migration to a remote database, provision a Cloudflare resource, deploy code, or prove a real backup/export/import or disaster-recovery path. Every mapped traceability row remains `Planned` because its complete acceptance set and deployed evidence remain outstanding.

## Atomic schema and proof boundary

Migration `0009_model_variant_name_exact_projection.sql` may advance only an exact pristine schema `1.5.1` database. Before any schema mutation it rejects:

- any publication outside `building` or `failed`;
- every closure seal, readiness binding or subtype receipt, readiness attestation, head, switch preflight, or switch-history row; and
- wrong schema metadata or a colliding table, index, or trigger name.

The migration creates the `STRICT` ordinary table and exact index fixed by ADR 0026. The model/variant insert guard requires an unsealed `building` publication, an exact model/variant type and stable ID, a matching canonical resource content hash, and a known canonical display name with observation and evidence. It compares canonical display-name UTF-8 using BLOB operands. It never treats SQLite TEXT length or host normalization as a byte-integrity oracle. Update and delete triggers make rows immutable.

The seal guard is bidirectional: every canonical model/variant resource with a known display name has exactly its corresponding projection identity, display bytes, and resource hash, and every projection row maps to such a canonical resource. Unknown, not-applicable, and unavailable names have no row. SQL cannot reproduce `exact-search-normalization@1` or the inventory SHA-256 root, so the controlled writer's nominal derivation and reconstruction remain required in addition to the trigger.

Migration `0009` rebuilds the closed readiness and switching schemas rather than fabricating evidence. The resulting compatibility family is:

- serving schema `1.6.0`;
- readiness receipt version `3.0.0`;
- readiness evaluator version `3.0.0`;
- probe set `search-gold@3`;
- switch-preflight version `3.0.0`; and
- switch-history event version `1.0.0`, unchanged because it binds the versioned preflight hash.

The v3 serving receipt and switch preflight retain the v2 provider suffix and append exactly:

1. `model_variant_name_projection_version`;
2. `model_variant_name_document_count`;
3. `model_variant_name_inventory_hash`;
4. `model_variant_name_storage_version`;
5. `model_variant_name_storage_document_count`;
6. `model_variant_name_storage_queryable`; and
7. `model_variant_name_storage_exact_parity`.

All seven fields participate in both hashes in that order. V1/v2 constructors and hash vectors retain their historical meaning. Schema-`1.6.0` dispatch rejects old writers as incompatible rather than classifying them as retryable work.

## Bounded atomic staging

The writer accepts only the nominal Phase 5G-A1 staging projection. It serializes detached rows to lowercase even-length hexadecimal and expands them through fixed `json_each(?1)` and `unhex(json_extract(...))` SQL. It validates the complete plan before acquiring D1 and requires all limits below simultaneously:

| Limit | Initial A2 ceiling |
|---|---:|
| Documents | 2,000 |
| Combined raw display and normalized UTF-8 | 2 MiB / 2,097,152 bytes |
| One final JSON payload | 1,500,000 UTF-8 bytes |
| All retained JSON payloads | 8 MiB / 8,388,608 bytes |
| Insert chunks | 40 |
| Total D1 queries in the invocation | 50 |
| Conservative retained-heap estimate | 64 MiB / 67,108,864 bytes |

The retained-heap estimate accounts for the trusted byte-number arrays, hexadecimal strings, JSON strings, envelope overhead, and reconstructed D1 rows that coexist. It is not merely the sum of D1 bindings. Exact query accounting reserves twelve fixed statements for initial classification, the transactional precondition/postcondition, the ordinary durability read, and a second fail-closed reconciliation when that first durability read itself fails. The 50-query ceiling therefore limits a theoretical invocation to 38 insert chunks even though the separate 40-chunk ceiling remains frozen and the dominant raw-byte cap makes either secondary limit unreachable.

Any overflow fails before `withSession` or another D1 access. Rows are never truncated and inserts are never paged across mutation transactions. The full maximum-envelope path must be benchmarked in the pinned workerd runtime with adequate margin below Worker memory and D1 transaction-duration limits. Evidence may lower a cap. Raising one or adopting multi-transaction staging requires ADR review.

The mutation transaction requires the expected publication ID, closure hash, staging revision, building/unsealed state, exact known-name count, and an empty projection. Empty complete projections use no insert statement or sentinel. The postcondition requires the unchanged revision, exact row count, and bidirectional canonical identity/display/hash parity.

After the transaction, a primary D1 session reads every persisted row in ASCII resource-type/resource-ID order. D1 BLOB values are accepted only as arrays of integer bytes from zero through 255. The A1 artifact-proof constructor then revalidates version, count, order, identities, exact display and normalized bytes, hashes, and inventory root. Exact prior completion with the same revision is idempotent success; no rows after a confirmed non-commit are retryable; partial, extra, conflicting, or wrong-revision state is fatal.

## Runtime queryability and semantic gold evidence

Runtime queryability uses one fixed SELECT shape containing:

```sql
FROM publication_model_variant_name_search_document
  INDEXED BY publication_model_variant_name_exact_idx
WHERE publication_id = ? AND normalized_name_utf8 = ?
ORDER BY resource_id
```

For a nonempty projection, the probe deterministically chooses the first reconstructed persisted row, binds that row's actual normalized-name BLOB, and requires the complete expected collision set in stable-resource-ID order. It then binds a fixed empty BLOB and requires no result; valid stored normalized names are nonempty. For a valid empty projection, it proves that the live canonical eligible-name count and table count are both zero and runs the same forced-index no-result query. Because no durable row or sentinel distinguishes a first empty assertion from a repeated one, every exact empty assertion returns `idempotent_success` without a mutation batch. No sentinel or synthetic row enters production data.

Naming the index with `INDEXED BY` makes a missing or unusable declared index fail instead of trusting version-sensitive `EXPLAIN QUERY PLAN` wording. These per-publication checks establish actual persisted reachability and deterministic no-result behavior. They do not pretend that every publication contains every Unicode edge case.

Pinned-workerd `search-gold@3` fixtures separately prove:

- leading, interior, and trailing U+0000 BLOB round trips and equality;
- model/variant rows sharing one normalized-name BLOB remain distinct and stably ordered;
- unknown-name resources are omitted;
- malformed UTF-8, wrong display/normalized bytes, wrong hashes, omissions, extras, and corruption fail closed; and
- the same fixed forced-index query works through workerd's SQLite/D1 implementation.

`model_variant_name_storage_queryable` becomes true only when runtime reachability, deterministic no-result behavior, exact storage parity, and the versioned gold evidence are all valid.

## Readiness, activation, and rollback

The v3 readiness projector consumes the trusted manifest, unchanged provider proof, A1 storage artifact proof, and A2 queryability result. The D1 commit adapter reconstructs persisted state through exact-key row decoders. Its precondition and postcondition independently compare the model table count and canonical/storage parity; its serving receipt carries the seven-field suffix. All four receipt bindings are version `3.0.0`, the probe subtype requires `search-gold@3`, and the final attestation uses evaluator `3.0.0`.

The complete readiness ledger, attestation, and `building → ready` transition remain one D1 batch. A missing or corrupt suffix field, old proof, row drift, failed statement, or ambiguous partial state cannot make the candidate ready. Exact committed state is an idempotent success; a confirmed empty prestate is retryable; conflicting immutable state is fatal.

Every v3 switch preflight binds the same provider and model proof fields and rechecks the target's actual projection. Activation additionally requires the exact unexpired v3 readiness attestation. Rollback intentionally carries no readiness attestation, but it requires a fresh v3 preflight over the immediate `superseded` target and its current exact model projection. The history-insert guard repeats parity checks before its event can mutate lifecycle state and the head. The event remains `1.0.0` and transitively binds all model evidence through the v3 preflight hash.

Generation compare-and-swap, response-loss reconciliation, and the last-known-good head behavior remain unchanged. Any stale generation, expired proof, statement failure, target corruption, or conflicting persisted event leaves the prior head authoritative.

## Backup-v1 restore-source profile

The existing backup-format-`1.0.0` artifact is validated in full before A2 derives any restore input. Boundary equality, writer-drained state, trusted publication/closure identity, table/chunk counts, content hashes, root hash, and the closed table allowlist remain mandatory. Both provider search projections and the new model/variant BLOB projection are reconstructible exclusions and are rejected if present in the backup inventory.

The A2 restore-source profile is a deterministic transform, not a literal import. From the validated target publication it selects:

- the publication's closure-bearing version, count, hash, and manifest-input fields;
- provider slices and slice metadata;
- provider attribution;
- canonical publication resources;
- broad search documents;
- vector inventory;
- inventory chunks.

The target publication is materialized in a fresh isolated schema as `building`, with readiness/activation lifecycle fields cleared and no seal. The fresh schema seeds revision zero and its existing insert triggers advance the staging revision as the selected rows are imported in the fixed dependency order; backup v1 supplies no revision row. The transform must preserve or independently reconstruct every field needed to reproduce the trusted manifest and closure; an unresolved reference or any changed root fails the transcript.

The profile excludes and never imports:

- backed-up `serving_schema_metadata`;
- closure seals;
- readiness bindings, subtype receipts, and attestations;
- switch preflights, switch history, and the publication head;
- the broad FTS virtual table;
- provider ordinary and FTS search projections; and
- model/variant BLOB search projections.

Literal import of the complete backup table inventory is forbidden because it would transplant stale schema, lifecycle, authorization, and index state. The local restore-rebuild coordinator accepts only the verified profile and executes:

1. import the isolated canonical/rebuild-source rows;
2. reconstruct and compare the trusted manifest and closure inputs;
3. rebuild and verify provider ordinary/FTS search;
4. rebuild and verify model/variant BLOB search and runtime queryability;
5. create the closure seal;
6. regenerate `search-gold@3` and v3 readiness evidence; and
7. stop before head mutation unless an explicit local test invokes the ordinary v3 switch adapter.

The coordinator emits a deterministic local transcript containing versions, counts, hashes, phase outcomes, and synthetic probe identities only. It contains no visitor values. A missing, extra, malformed, byte-mismatched, normalization-mismatched, hash-mismatched, root-mismatched, or nonqueryable row stops before seal or head mutation.

This seam does not implement the real writer-drained exporter, R2 chunk storage, Time Travel recovery, full importer, parent/dependency recovery, FTS/Vectorize remote reconstruction, migration-away export, operational authorization, RPO/RTO measurement, or disaster-recovery exercise. Those remain `BE-010`–`BE-012`, `OPS-006`, `OPS-008`, and `GATE-restore-and-rebuild` release work. No backend or restore traceability status advances from the local seam.

## Failure-injection acceptance

A2 implementation is incomplete until portable SQLite and pinned-workerd tests cover:

- rollback after every migration statement, exact-`1.5.1` preconditions, every legacy proof-bearing table, and schema-name collisions;
- `STRICT` BLOB enforcement, lowercase even-length hex, `unhex`, BLOB lengths, ArrayBuffer/View binding, and D1 Array reads;
- one unit below, exactly at, and one unit above every operational cap, with all overflow failures occurring before D1;
- every staging precondition, insert-chunk, postcondition, and reconciliation failure, including response loss and malformed D1 results;
- missing, extra, duplicate, reordered, wrong-type/ID/revision/version/hash/display/normalized rows and unknown-name leakage;
- all readiness statement positions, independent v3 receipt/attestation hash oracles, suffix order, and old-proof rejection;
- all preflight/history/postcondition positions, first and replacement activation, immediate rollback, stale/concurrent generations, expiry, response loss, and corruption between gates;
- last-known-good head preservation for every failure;
- complete-backup validation before transformation, rejection of every excluded table, deterministic rebuild ordering, and corruption failure before seal or head change; and
- maximum-envelope workerd time and retained-memory evidence, with caps lowered if margin is inadequate.

Remote D1 race behavior, R2 immutability, real Vectorize visibility/rebuild, multi-PoP behavior, and operational restore timing remain release evidence rather than local A2 claims.

## Zero-visitor-data boundary

A2 is a controlled pipeline operation over canonical publication data and version-controlled synthetic probes. It adds no public route, request handler, public mutation, browser code, cookie, browser persistence, cache key, referral behavior, analytics, beacon, live-request metric, request log/trace, or visitor correlation identifier.

The staging, readiness, switch, and restore seams accept closed nominal publication inputs. They do not accept `Request`, URL, query-string, headers, cookies, source address, user agent, referrer, or arbitrary error payloads. Errors are fixed and do not echo names or payloads. Queryability probes use persisted canonical rows plus a fixed empty BLOB; semantic fixtures are synthetic and version controlled. Durable proof and transcript rows contain only publication IDs, versions, counts, hashes, booleans, timestamps, controlled-operator identities where already required, and synthetic probe identities.

Tests must supplement the existing public-worker privacy gate with a focused production-source scan over new A2 pipeline modules for `console.*`, request objects and headers, visitor identifiers, telemetry, and payload-echo paths. Public Workers and their `private, no-store` query-string behavior remain unchanged.

## Exit evidence and handoff

A2 may be described as locally implemented only after migration, unit, fake-D1, pinned-workerd, all-statement failure, capacity, privacy, backup-exclusion, and local restore-rebuild tests pass together. Its documentation must still say that remote resources, deployment, full backup/export/import, disaster recovery, and every composite release gate remain pending.

Phase 5G-B may then add the bounded SELECT-only equality reader, canonical rehydration, D1 Session/bookmark continuity, and internal RPC seam. It may not reinterpret A2's queryability probe as a public reader, expose projection bytes as facts, or introduce a public route before the remaining exact-first search tiers and cursor contract are complete.
