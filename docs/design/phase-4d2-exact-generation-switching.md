# Phase 4D2 exact-generation switching evidence

Status: local schema and kernel implemented and verified; deployed D1, R2, Vectorize, reader, backup, chaos, and release evidence pending.

Related requirements: `SRCH-007`, `API-003`, `API-015`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-010`–`BE-012`, `CF-022`, `QA-006`.

## Local boundary

[ADR 0020](../decisions/0020-exact-generation-publication-switching.md) defines a fresh typed switch preflight, append-only event history, exact-generation head mutation, database-clock activation validity, and immediate-`superseded` rollback. Serving migration 0006 advances schema 1.3 to 1.4 without inserting a head or making any publication public.

The runtime-neutral projector recomputes persisted seals, readiness receipts, activation attestations, preflight hashes, and event hashes. Both activation and rollback require current archive, FTS, complete-vector, and fixed-probe evidence. Activation binds the unexpired exact readiness attestation; rollback uses a fresh generation-bound preflight and preserves first activation time. Bounded authorization references accept only fixed pipeline/operator identities and never visitor inputs.

The database remains the final local authority for lifecycle, exact-generation head, event immutability, database-clock bounds, and bidirectional FTS/source parity. A controlled runtime must execute the fixed operation as one prepared D1 batch with aborting equality assertions. Separate autocommitted writes, generic SQL, and JavaScript-only post-commit checks are prohibited.

## Safety resolution

Ordinary rollback targets only the exact current rollback candidate while it is `superseded`. A `rolled_back` publication was previously declared defective and cannot become active through an integrity proof alone. Explicit reapproval is deferred. The exact current rollback candidate nevertheless remains readable by publication-pinned clients during hot retention; unrelated rolled-back publications return the generic expired result.

## Nonclaims

This slice provides no deployed D1 binding or batch, exhaustive statement-position batch fault injection, remote concurrency/failure-injection result, R2 archive proof, real Vectorize mutation or visibility proof, reader Session/bookmark, public API or SSR response, cache behavior, backup/restore, pruning, multi-PoP chaos, rollback-time measurement, alerting, provisioning, deployment, provider publication, or release evidence. Local tests cover a representative late nested failure and prove the enclosing transaction restores preflight, history, lifecycle, and head state; the deployed adapter must extend that matrix across every prepared-batch statement and ambiguous retry boundary. ADR 0021 plus [Phase 4F](phase-4f-provider-search-v2-proofs.md) close the provider-name preflight design/core gap, but the v1 schema and adapter remain intentionally unchanged until migration 0007 and the writer cutover land atomically. Every related traceability status remains `Planned`.
