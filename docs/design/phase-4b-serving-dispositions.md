# Phase 4B serving provider-disposition persistence

| Attribute | Value |
|---|---|
| Status | Local migration evidence complete; runtime publication remains blocked |
| Decision | [ADR 0017](../decisions/0017-provider-disposition-persistence.md) |
| Requirements | `PIPE-005`, `PIPE-019`, `PIPE-043`, `PIPE-044`, `PIPE-050`–`PIPE-052`, `QA-006` |

## Implemented local boundary

Migration `migrations/serving/0003_publication_provider_dispositions.sql` replaces the incorrect global/non-null provider-slice identity with one immutable disposition per publication/provider. It represents unavailable providers with an exact run and null content identity, preserves selected slice identity across publications, checks carried-forward lineage against a temporally prior queryable publication, permits failed/building retries without burning identity, rechecks concurrency at readiness, validates exact UUIDv4 grammar, and keeps the physical table name used by logical backup inventories.

The readiness trigger now fails closed unless a candidate has at least one selected-content disposition and one public resource. Existing closure counts, model/variant search parity, building-only inserts, immutable rows, state transitions, and head guards remain in force.

Local SQLite tests cover the complete state matrix, legacy selected/unavailable migration, pre-mutation legacy/schema-drift rejection, duplicate and mutation rejection, temporal prior-queryable lineage, failed/building retry and readiness races, provider/run mismatch, UUID grammar, index and trigger reconstruction, foreign keys, schema-version advancement, incomplete closures, and all-unavailable last-known-good preservation.

## Explicit nonclaims and remaining gates

This slice does not persist the complete ADR 0015 closure. Adapter, roster, source-register, provider-attribution, vector, chunk, and root inventories still need a sealed writer/projection migration sourced from validated canonical input; they are never backfilled with invented values.

It provides no publication writer, append-only switch history, compare-and-swap execution, query Worker, D1 binding, D1 Session/bookmark, public route, FTS5 index, Vectorize operation, cache entry, backup, restore, pruning, deployment, provider publication, or release evidence. All related traceability rows retain their existing status. The next slice is sealed closure and switch-history persistence; closed indexed SELECT planning follows only after that schema settles.
