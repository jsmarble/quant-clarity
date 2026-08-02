# Phase 4D4 fixed local D1 readiness adapter evidence

Status: local implementation and workerd/D1 verification complete; remote D1, artifact, protected-writer, and release evidence pending.

Related requirements: `SRCH-007`, `PIPE-044`, `PIPE-050`–`PIPE-053`, `BE-003`, `BE-011`, `CF-022`, `QA-006`.

## Local boundary

[ADR 0019](../decisions/0019-seal-bound-readiness-ledger.md) requires all four receipt bindings and typed details, the readiness attestation, and the `building` to `ready` transition to commit atomically. This slice implements that missing local persistence boundary without adding a deployable D1 binding or changing the private pipeline Worker's unconditional `404` surface.

The publication kernel synchronously detaches the complete caller input before asynchronous verification. It reconstructs the sealed manifest and typed receipts, verifies their hashes and applicability, evaluates readiness, and mints one in-memory projection protected by a private nominal brand and runtime registry. Serialized, copied, or reflected objects are not trusted. The future composition layer must therefore construct and commit the projection in one JavaScript isolate.

## Fixed transaction

The adapter observes publication lifecycle, all common and typed receipt rows, and the attestation through a fresh `withSession("first-primary")` session. Only an exact sealed `building` candidate with no readiness ledger may execute. Exact partial state is corruption, altered immutable state is conflict, lifecycle drift without a ledger is stale, and an exact complete ledger remains idempotent after legitimate later publication lifecycle transitions.

One fixed prepared-statement batch first aborts unless the candidate still has zero readiness rows. It then conditionally inserts the four common bindings and four typed details, asserts every receipt column, conditionally inserts and asserts the complete attestation, conditionally performs the lifecycle transition, and immediately verifies the full ledger, seal, FTS parity, and lifecycle postcondition. The final query reads SQLite `changes()` from the preceding lifecycle update and accepts only the closed `0` or `1` result; an ordinary exact concurrent winner aborts at the empty-ledger precondition and is recovered by reconciliation. Every provider-controlled value is bound; there is no dynamic SQL, `exec()`, log, trace, or generic mutation surface.

After any thrown or malformed batch result, the adapter opens a new primary-anchored session and reclassifies the same trusted projection. An exact complete state is idempotent success; an exact untouched prestate is a closed not-applied error that permits only the same projection to be retried; conflicts, corruption, stale state, and unreadable outcomes fail closed with stable redacted errors.

## Nonclaims

This slice provides no configured preview or production D1 resource, real R2 immutability or Vectorize visibility proof, protected writer identity or Workflow composition, remote D1 race evidence, provider-name exact-search projection, query/API reader, cache behavior, backup/restore, pruning, multi-PoP chaos, provisioning, deployment, provider publication, or release evidence. Synthetic Miniflare evidence cannot establish remote behavior. Related traceability rows remain `Planned`.
