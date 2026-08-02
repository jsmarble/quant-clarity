# Phase 5G-A1: model/variant durable-row and storage-proof core

| Attribute | Value |
|---|---|
| Status | Implemented runtime-neutral dormant primitives; A2 persistence/readiness and B query integration remain pending |
| Decision | [ADR 0026](../decisions/0026-blob-model-variant-exact-search-cutover.md) |
| Requirements | `DATA-001`–`DATA-004`, `DATA-008`, `API-003`, `API-010`, `SRCH-002`, `SRCH-006`, `SRCH-007`, `SRCH-009`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-010`–`BE-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006` |

## Outcome and boundary

Phase 5F implemented the complete trusted `model-variant-name@1` derivation but deliberately exposed no durable representation. Phase 5G-A1 adds the smallest runtime-neutral bridge from that nominal projection to the future schema-`1.6.0` publication boundary:

1. immutable persistence-row projections that carry exact display and normalized UTF-8 bytes as frozen byte-number arrays;
2. one revision-bound, deterministic, bounded staging plan derived only from the trusted manifest and trusted name projection; and
3. a dormant nominal model/variant storage-artifact proof containing the six non-queryability ADR 0026 fields needed by the future v3 readiness and switch families.

The implemented slice adds no D1 migration, SQL, Worker binding, I/O adapter, readiness write, switch write, restore operation, reader, RPC method, API adapter, cursor, public route, resource, provisioning, or deployment. Schema `1.5.1` and the active v2 writers remain unchanged until the atomic A2 cutover lands in full.

## Implemented core contracts

### Persistence rows

`packages/publication-core` defines a structural frozen row projection with exactly these enumerable fields:

```text
publication_id
resource_type = model | variant
resource_id
projection_version = model-variant-name@1
display_name_utf8
normalized_name_utf8
resource_content_hash
```

The two byte values are frozen `readonly number[]` snapshots containing integers from 0 through 255. Ordinary arrays are intentional: unlike a nonempty typed-array view, they can be detached from caller input and frozen at runtime. They encode the exact validated UTF-8 already bound by the trusted Phase 5F document. A2 converts them to validated lowercase even-length hexadecimal only at the fixed JSON/D1 adapter boundary, then uses SQLite `unhex(...)` to populate `STRICT` BLOB columns. No code may round-trip the names through host normalization, locale operations, C strings, or SQLite text-length semantics.

The staging projector accepts only the nominal trusted `model-variant-name@1` projection and complete serving-closure rows. It independently projects the trusted manifest and closure seal from a detached snapshot, then requires matching publication ID and closure hash before emitting persistence. Rows sort by ASCII `resource_type` and then ASCII `resource_id`, exactly like the Phase 5F inventory; duplicates and reordering cannot change or replace the trusted identity. Empty complete input emits an empty row list, not a sentinel.

### Revision-bound staging plan

The implemented `ModelVariantNameSearchStagingPersistenceV1` contains:

```text
publicationId
closureHash
projectionVersion = model-variant-name@1
storageVersion = model-variant-name-utf8-blob@1
stagingRevision
documentCount
inventoryHash
rows
```

`stagingRevision` is a nonnegative safe integer captured from `publication.staging_revision`. It is not part of the ADR 0025 inventory root; it is a compare-and-swap fence for the future writer. The staging constructor validates the serving-closure input through the existing closure projector, snapshots the revision, proves the rows are the exact complete projection, detaches every caller-owned value, freezes the persistence recursively, and retains nominal trust out of band. Serialization, copying, reflection, caller-authored bytes, or a caller-authored count/root cannot produce a trusted staging plan.

A1 performs no JSON serialization or D1 payload planning. The first A2 writer will convert and consume exactly one complete A1 plan in one D1 batch. A2 must measure the final hex-expanded JSON parameters, reserve headroom under all D1/Worker limits, and fail before mutation when the plan does not fit. A1 does not design or imply partial multi-transaction staging. If launch data cannot fit the measured atomic ceiling, implementation stops for a separately reviewed completion-ledger/repair design; it does not truncate the projection.

### Dormant model/variant storage-artifact proof v1

A1 defines a closed observation shape for rows supplied by a future persistence adapter:

```text
storageVersion = model-variant-name-utf8-blob@1
rows
```

It also defines a nominal `ModelVariantNameSearchArtifactProofV1` containing the six storage-integrity fields fixed by ADR 0026:

```text
model_variant_name_projection_version
model_variant_name_document_count
model_variant_name_inventory_hash
model_variant_name_storage_version
model_variant_name_storage_document_count
model_variant_name_storage_exact_parity
```

The artifact-proof constructor accepts only the trusted staging projection and an exact closed observation. It snapshots every observed row, requires storage version `model-variant-name-utf8-blob@1`, and compares row count, order, identity, exact display bytes, exact normalized bytes, projection version, and resource hash against the complete staging persistence. Its nominal binding retains the trusted manifest and Phase 5F projection out of band. The proof's `storage_exact_parity` can establish exact storage-row parity but not indexed queryability.

A1 does not define v3 receipt, evaluator, probe-set, attestation, commit, preflight, switch adapters, or their digests. A2 will append `model_variant_name_storage_queryable` after `model_variant_name_storage_document_count` and before `model_variant_name_storage_exact_parity`, producing the seven-field v3 suffix only after real indexed D1 probes pass. Existing v1/v2 readiness proofs remain byte-for-byte unchanged and cannot consume the A1 nominal artifact proof.

## Implemented files

The A1 implementation is limited to:

- `packages/publication-core/src/index.ts` — storage-version/bounds constants, structural persistence row, nominal revision-bound staging projection, lower-trust observation, nominal artifact proof, assertions, and exact row-parity logic;
- `packages/publication-core/src/model-variant-name-projection.test.ts` — exact row/byte/staging/artifact-proof unit and negative coverage; and
- architecture/traceability documentation for this slice.

If keeping the package entrypoint reviewable requires a focused internal module, that module may be added under `packages/publication-core/src/` and re-exported from `index.ts`; it must not create another normalizer, canonical validator, or trust registry.

A1 must not modify any file under `migrations/`, `apps/pipeline/`, `apps/query/`, or `apps/api/`. Those are A2 or B surfaces.

## Acceptance evidence

1. Project the expected `TextEncoder` byte-number arrays for ASCII, multibyte Unicode, combining sequences, and leading/interior/trailing U+0000, and prove the exact rows retain zero bytes without a lossy string field.
2. Reject empty, oversized, out-of-range, noninteger, malformed-UTF-8, unpaired-surrogate, and normalized-empty values wherever a copied or lower-trust input reaches an assertion boundary.
3. Preserve the exact Phase 5F document count, identities, ordering, resource hashes, and inventory root under every input permutation, including zero documents and normalized collisions.
4. Reject copied manifests, copied projections, copied staging/proof lookalikes, caller-authored roots, wrong closure/publication/revision, wrong count, duplicate/extra/missing rows, and post-construction mutation; accept exact detached structural row copies only as lower-trust observations against a nominal staging projection.
5. Prove storage-version mismatch, row reordering, count mismatch, identity substitution, byte mismatch, hash mismatch, and duplicate/extra/missing observed rows cannot produce the nominal six-field artifact proof.
6. Prove the six artifact fields have their exact names and canonical value types, and prove A1 has no queryability field or readiness/switch digest surface.
7. Prove provider/offering/affiliate/price/precision permutations cannot affect row membership, name bytes, ordering, inventory identity, or artifact-proof fields; the closure/staging binding may legitimately change with publication context, and a row resource hash may change only when that canonical model/variant resource changes.
8. The package remains Worker-safe and introduces no Node-only runtime dependency, I/O, logging, telemetry, visitor storage, or public route.

## A2 handoff contract

Phase 5G-A2 must consume A1 without redefining it. Its atomic boundary includes:

- `migrations/serving/0009_model_variant_name_exact_projection.sql`, exact `1.5.1` to `1.6.0` pristine migration, BLOB table/index, insert immutability, and seal completeness;
- `apps/pipeline/src/model-variant-name-search-staging.ts`, fixed preconditions, JSON-hex chunks materialized with allowlisted SQLite `unhex`, post-write reconstruction, idempotent reconciliation, and real workerd coverage;
- v3 readiness receipt/attestation commit and switch-preflight adapters that append all seven model/variant fields after the unchanged provider suffix, add queryability only after indexed probes, and reject v1/v2 on schema `1.6.0`;
- `search-gold@3` BLOB equality, U+0000, collision, omission, corruption, query-plan, readiness, activation, rollback, and all-statement failure probes; and
- portable-backup exclusion plus isolated canonical-resource restore/rebuild before seal and v3 readiness.

A2 acceptance requires a measured launch dataset to fit the declared atomic envelope with margin. The current Phase 5F logical maximum of 100,000 resources and 256 MiB is a validation ceiling, not evidence that one Worker invocation or D1 batch can stage that size. A2 must record its lower operational cap honestly or return for a separately accepted restart-safe staging design.

## B handoff contract

Phase 5G-B may begin only after A2 makes the projection a sealed, proof-bound invariant. It will add the fixed SELECT-only BLOB equality reader, strict canonical JSON rehydration and byte comparison, active/default eligibility, stable-ID tie-break, bounded first-page operation, D1 Session/bookmark RPC method, and internal API adapter seam.

B does not add the merged search cursor, other missing tiers, a configured service binding, a public route, or deployment. Exact model/variant results remain an internal tier until complete search composition can preserve the PRD's ordering, neutrality, privacy, and `private, no-store` behavior.

## Non-claims and open capacity gate

Phase 5G-A1 provides local dormant proof primitives only. It does not complete any mapped PRD row, create serving schema `1.6.0`, make model/variant exact search queryable, prove backup/restore, or authorize deployment. Every mapped traceability status remains `Planned` pending A2, B, public integration, deployed evidence, and the complete acceptance set.

Before A2 implementation is accepted, the team must measure representative and worst-approved launch inventories against D1 value/query/batch limits and the Worker 128 MiB memory limit, then freeze a fail-closed operational cap. If the product requires a larger single publication than the atomic design can support, the unresolved question is the pre-seal multi-transaction completion and repair protocol; no implementation may guess that policy.
