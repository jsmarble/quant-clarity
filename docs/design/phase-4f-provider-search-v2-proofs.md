# Phase 4F: dormant provider-search v2 proofs

- Status: local proof primitives implemented; migration, persistence, writers, query, and deployment pending
- Decision: [ADR 0021](../decisions/0021-canonical-provider-exact-search.md)
- Requirements: `SRCH-002`, `SRCH-007`, `PIPE-050`, `PIPE-051`, `PIPE-053`, `BE-011`

## Implemented local boundary

The runtime-neutral publication core now projects three distinct nominal v2 proof types without granting lifecycle or persistence authority:

- a provider artifact proof derived only from a trusted complete-manifest-bound `provider-name@1` projection plus closed provider-FTS observations;
- `2.0.0` readiness-receipt hashes and a `2.0.0` evaluator attestation that require `search-gold@2` and transitively bind the provider serving receipt;
- a fresh `2.0.0` activation or rollback preflight hash that binds the same provider proof, with activation requiring the exact unexpired v2 attestation and rollback forbidding one.

The provider artifact proof contains exactly the seven fields listed by ADR 0021. The implementation records the previously unspecified canonical placement choice: the seven fields are one contiguous suffix after the unchanged v1 serving-receipt or switch-preflight field sequence, in ADR order. This preserves an auditable v1 prefix while giving v2 a distinct digest. The normalization version is not an eighth durable field: only the nominal `provider-name@1` projection is accepted, and its trusted constructor fixes `exact-search-normalization@1` while its inventory hash covers every normalized name.

All externally supplied observation and context objects require closed key sets and are copied by declared field before the first asynchronous digest. Provider source count and inventory hash come from the nominal projection, not the FTS observer. Provider publication and closure identity must match the exact trusted manifest. Copied or reflected proof objects do not retain trust.

The tests preserve every v1 fixed vector and independently encode the v2 serving-receipt, attestation, activation-preflight, and rollback-preflight vectors with a separate uint64be/UTF-8 tuple encoder. They also cover cross-closure substitution, copied normalization/proofs, wrong FTS version/count, false queryability/parity, extra keys, v1 probes, missing or forbidden attestations, and a genuine zero-provider inventory.

## Version distinction

`ArtifactBinding.schemaVersion` and `publication.versions.schema` identify the canonical publication contract already covered by the closure. They are not the D1 `serving_schema_metadata` migration level. This slice does not require or claim a schema-1.5 database. Migration 0007 must separately require serving schema `1.4.0` and advance it atomically to `1.5.0` with the only adapters allowed to consume these v2 proofs.

## Nonclaims and next boundary

No v2 proof can transition a publication, create or replace a head, create switch history, emit a prepared statement, or be accepted by the existing v1 D1 adapters. This slice adds no table, migration, binding, route, cache, resource, or deployment. Traceability remains `Planned`.

Before a D1 writer is implemented, the kernel must wrap these primitives in complete nominal `ServingReadinessCommitProjectionV2` and `ServingSwitchProjectionV2` (or equivalent) values. Those values must expose only trusted typed persistence rows and bind the readiness transition or lifecycle/head/history plan; adapters must reject the bare proof primitives and must never accept the original caller receipts/context beside them.

The next slice must land those complete nominal projections, migration 0007, and the readiness/switch writer cutover together. It must add the provider projection and FTS schema, persist and reread these exact v2 proofs, retain the switch-event `1.0.0` shape through its bound preflight hash, reject legacy populated state, prove `PIPE-052`/`QA-006` transactional failure behavior, and preserve the last known-good head before any query path is added.
