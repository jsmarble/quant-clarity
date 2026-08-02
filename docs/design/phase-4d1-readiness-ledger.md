# Phase 4D1 — sealed readiness ledger and exact-search FTS

| Attribute | Value |
|---|---|
| Status | Local migration and projection evidence complete; D1, R2, and Vectorize runtime evidence pending |
| Decision | [ADR 0019](../decisions/0019-seal-bound-readiness-ledger.md) |
| Requirements | `SRCH-001`, `SRCH-002`, `SRCH-006`, `SRCH-007`, `PIPE-044`, `PIPE-050`–`PIPE-053`, `BE-003`, `BE-011`, `CF-022`, `QA-006` |

## Implemented local boundary

Serving migration 0005 advances schema `1.2.0` to `1.3.0`. It creates publication-scoped FTS5, immutable common and typed receipt tables, and one immutable readiness attestation. The readiness transition is reopened only for a sealed `building` publication with exact archive, serving, complete-vector, and probe evidence. The singleton head remains closed.

`packages/publication-core` now projects each closed receipt shape into exact serving rows, hashes its typed content, rereads and verifies persisted hashes, rebuilds the closure from ordinary rows, verifies the stored seal, reevaluates readiness, and emits the only accepted attestation shape and validity deadline. The database independently rechecks the receipt-to-seal facts, FTS parity, freshness, environment, Boolean evidence, clock bound, and attestation-to-lifecycle timestamp.

Focused integration evidence stages a selected-plus-unavailable closure, queries derived FTS, projects and rereads all four receipts, rejects a tampered receipt hash, removes an FTS row inside the candidate transaction, proves attestation failure rolls every receipt back, then persists the complete set and transitions exactly once to `ready`. Receipt mutation and head insertion remain rejected. Migration tests prove malformed metadata and a colliding target object roll back atomically to schema `1.2.0`.

## Runtime sequence still required

The protected pipeline must seal and reread the closure; rebuild and probe FTS; persist the immutable R2 archive; write the publication-qualified Vectorize namespace; wait for mutation processing; verify every declared ID and namespace; run fixed exact, semantic, filter, neutrality, evidence, integrity, and version-isolation probes; then execute receipt inserts, aborting equality assertions, attestation insert, and `building` to `ready` in one `D1Database.batch()`.

ADR 0021 and [Phase 4E](phase-4e-provider-search-core.md) resolve the provider-name projection and normalization design; [Phase 4F](phase-4f-provider-search-v2-proofs.md) adds the isolated v2 receipt/attestation proof primitives. This historical schema-1.3 ledger remains v1 and does not satisfy complete `SRCH-002`; [Phase 4G](phase-4g-provider-search-schema-writers.md) subsequently lands migration 0007 and the active v2 writers together.

Phase 4D2 must add append-only switch history and exact-generation transactional activation/rollback. Initial activation must use an unexpired attestation. Rollback targets only the immediate candidate and revalidates retained serving/search artifacts rather than applying the original receipt age.

The privileged writer can technically address an FTS virtual table, so Phase 4D2 must recheck exact FTS/source parity inside the activation transaction and expose no generic SQL path. Likewise, autocommitted receipt insertion can leave a fail-closed partial candidate; the deployed adapter must make all receipt rows, equality assertions, attestation, and readiness one batch before any runtime claim is accepted.

## Nonclaims

This slice provides no D1 binding or deployed batch adapter, R2 archive, Vectorize mutation or visibility proof, complete provider-name search, switch event, head change, public query route, D1 Session/bookmark evidence, cache behavior, backup/restore, multi-PoP chaos, provisioning, deployment, provider publication, or release evidence. Traceability remains `Planned` until each complete runtime and operational gate passes.
