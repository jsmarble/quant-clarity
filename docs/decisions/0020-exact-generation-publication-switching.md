# ADR 0020 — authorize publication switching with fresh generation-bound preflights

| Attribute | Value |
|---|---|
| Status | Accepted |
| Date | 2026-08-02 |
| Requirements | `SRCH-007`, `API-003`, `API-015`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-010`–`BE-012`, `CF-022`, `QA-006` |
| Extends | ADRs 0007, 0013, 0015, 0018, and 0019 |

## Context

ADR 0019 permits a sealed candidate to become ready but deliberately keeps the singleton head closed. Readiness alone cannot authorize a later switch: its attestation can expire, the privileged writer can alter the reproducible FTS virtual table, and rollback must prove the retained target is still queryable without pretending that its original readiness receipts are fresh.

D1 batches roll back after a statement error, but a compare-and-swap update that affects zero rows is not itself an error. The switching protocol therefore needs generation-bound persisted authorization plus aborting database assertions, not a JavaScript row-count check after commit.

The existing local kernel allowed rollback to a `rolled_back` publication. That state means the release was previously declared defective, so artifact integrity alone cannot restore its known-good status. This decision restricts ordinary rollback to the exact immediate `superseded` publication. Reactivating a `rolled_back` release is deferred to a distinct operator-reapproval decision and is not silently treated as rollback.

## Decision

### Fresh typed switch preflight

Every activation or rollback uses one immutable preflight bound to the exact expected head generation, former and target publication identities and closure hashes, target environment, switch time, and next generation. Its typed fields retain a fresh archive check, bidirectional FTS/source parity, full Vectorize ID/count/namespace/queryability evidence, and fixed integrity, exact, semantic, structured-filter, neutrality, and version-isolation probes. A domain-separated hash covers the complete projection.

Activation additionally binds the exact persisted readiness-attestation hash. The database checks the attestation deadline against its own current clock and checks that the proposed switch time is current and monotone; backdating cannot revive expired evidence. Rollback does not reuse the original receipt-age window. It requires a fresh bounded preflight for the immediate `superseded` target and preserves that target's first activation timestamp.

The pure kernel rereads and recomputes the seal, readiness receipts, attestation, preflight hash, and event hash before a controlled writer may construct a switch. SQL independently rechecks values it can prove, including seal identity, counts, lifecycle, head generation, attestation binding, database-clock validity, and exact FTS/source parity. Real R2 immutability and Vectorize visibility remain deployed-adapter evidence rather than database claims.

### Exact-generation switch and immutable history

Initial activation creates generation 1 only when the head is absent. Later activation and rollback compare every prior head field: singleton, generation, active publication, rollback candidate with exact null semantics, and switch time. A zero-row compare-and-swap must be followed by an aborting assertion within the same D1 batch.

The controlled batch performs these logical steps:

1. recognize either the exact pre-switch state or an exact already-committed retry;
2. persist or verify the immutable preflight;
3. recheck the target, attestation or rollback proof, seal, and FTS parity;
4. activate or reactivate the target;
5. insert or compare-and-swap the singleton head;
6. demote the former active publication to `superseded` for activation or `rolled_back` for rollback;
7. append one immutable switch-history event at the new generation; and
8. abort unless the exact head, lifecycle, seal, history, and FTS postconditions hold.

The event records the preflight hash, action, prior/new generations, from/to publications and closure hashes, activation attestation when applicable, resulting rollback candidate, switch time, and a bounded pipeline/operator identity reference. This is non-visitor control-plane audit metadata, not a credential and never a public-request field.

An exact retry that finds the identical event and complete post-state returns idempotent success without advancing the generation. A changed head without that event is stale; the same switch ID with different fields is a conflict; an event whose head or lifecycle does not match is corruption. A stale operation may not be regenerated against the new head under the same authorization.

### Local boundary

Migration 0006 creates the preflight and history schema and opens the local head capability. It inserts no head and publishes no data. No public Worker receives write access or a generic SQL surface. Physical deletion remains prohibited.

The first deployed switch remains blocked on a fixed prepared-statement `D1Database.batch()` adapter, remote failure/race/retry evidence, real R2 and Vectorize proof, protected environment and writer identities, reader Session/bookmark consistency, backup/restore, populated-cache multi-PoP chaos, legal/source/privacy gates, and explicit deployment authorization.

## Consequences

- Partial, stale, replayed, wrong-generation, expired, FTS-divergent, or artifact-incomplete switches fail closed locally.
- Switch history is append-only and preserves repeated lifecycle transitions that the singleton head cannot reconstruct.
- The current rollback candidate remains queryable for pinned reads even after it is marked `rolled_back`; unrelated rolled-back generations remain unavailable.
- Ordinary rollback cannot reactivate a release already declared defective.
- The local schema and kernel still do not prove D1 remote transaction behavior, R2 retention, Vectorize visibility, public read coherence, or release readiness.

## Alternatives considered

- Authorize switching from readiness state alone: rejected because the attestation can expire and FTS can drift after readiness.
- Check compare-and-swap row counts after `batch()`: rejected because a zero-row update can commit before JavaScript observes it.
- Reuse original readiness age for rollback: rejected because retained known-good recovery would eventually become impossible.
- Permit rollback to a `rolled_back` target: rejected because a formerly defective release requires explicit reapproval, not an integrity-only preflight.
- Store only the singleton head: rejected because it loses authorization, retry, rollback, and repeated-transition history.
- Add a public or generic administrative switch endpoint: rejected because publication mutation belongs only to controlled pipeline/operator identities.

## Validation

- Apply migration 0006 only from exact schema 1.3 and prove malformed metadata, legacy state, and object collisions roll back atomically.
- Exercise initial activation, later activation, one-step rollback, exact retry, stale competing switches, wrong former-head fields, generation overflow, and immutable history.
- Expire readiness against database time, backdate and future-date switches, and corrupt each FTS parity dimension before switching.
- Reject missing, stale, cross-environment, wrong-namespace, count-drifted, incomplete-vector, or failed-probe preflights.
- Inject failure after every transaction statement and prove head, lifecycle, preflight, and history return to the exact prior state.
- Preserve the first activation timestamp across rollback and keep only the exact current rollback candidate pin-queryable.
- Keep all related traceability rows `Planned` until deployed D1, R2, Vectorize, reader-consistency, backup/restore, chaos, privacy, and release gates pass.
