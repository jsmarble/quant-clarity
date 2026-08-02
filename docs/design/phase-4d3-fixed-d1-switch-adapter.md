# Phase 4D3 fixed local D1 switch adapter evidence

Status: local implementation and workerd/D1 verification complete; remote D1, artifact, reader, backup, chaos, and release evidence pending.

Related requirements: `SRCH-007`, `API-003`, `API-015`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-010`–`BE-012`, `CF-022`, `QA-006`.

## Local boundary

[ADR 0020](../decisions/0020-exact-generation-publication-switching.md) requires a fixed prepared-statement D1 adapter after the local schema and projector. This slice implements that persistence boundary without adding a deployable D1 binding or changing the public Worker surface. The pipeline fetch handler remains an unconditional private-control-plane `404`, and the adapter is exercised only through a test-only Miniflare D1 binding loaded with the checked-in serving migrations.

Cloudflare's current D1 contract executes a `D1DatabaseSession.batch()` sequentially as one transaction and rolls the complete sequence back when a statement fails. The adapter starts each observation and reconciliation from a new `withSession("first-primary")` session, uses only module-owned literal SQL with bound values, and never calls `exec()`.

## Fixed operation

The adapter reads the exact head, target/former lifecycle, generation-bound preflight, and generation-bound history before classifying the operation. A preflight without history is corruption rather than resumable work. An exact committed preflight, event, head, and lifecycle is idempotent success; changed immutable rows are conflicts; changed head state is stale; inconsistent lifecycle or a missing committed preflight is an integrity failure.

Only an exact untouched pre-state may execute. One awaited three-statement batch inserts the complete projected preflight, inserts the complete history event whose migration trigger applies lifecycle and head changes, and runs an aborting postcondition over the exact preflight, history, head, lifecycle, closure seal, and bidirectional FTS/source parity. JavaScript result inspection is supplemental and cannot turn a failed database assertion into success.

If the batch throws, the adapter does not blindly retry or regenerate evidence. It opens a fresh primary-anchored session and reclassifies the same projection. An exact post-state is recovered idempotent success; an exact untouched pre-state becomes a closed not-applied error that permits an orchestrator to retry only that same projection; an unreadable reconciliation becomes an unknown-outcome error. Raw D1 errors, SQL, bind arrays, results, and metadata are neither logged nor returned.

## Trust boundary

This adapter accepts only a runtime-trusted projection produced by the publication kernel. The projection carries a private nominal brand and must also be present in the kernel's private in-memory registry; structural objects, serialized projections, and reflected-brand copies fail closed. The adapter verifies that trust marker at entry. Because serialization deliberately removes trust, the future composition layer must invoke the projector and adapter in the same JavaScript isolate rather than passing a projected command across a Workflow step boundary.

The adapter exposes no HTTP, RPC, arbitrary SQL, identity, timestamp, environment, or proof-input surface. It is not wired to a Workflow or deployment entrypoint in this slice. A later composition layer must reread D1 evidence, obtain real R2 and Vectorize proof, construct fixed scheduled-pipeline or protected-operator identities, and invoke the projector immediately before this adapter. The distinct `pipeline-core` deployment identity is not silently mapped to a switch operator.

The projector synchronously detaches its complete caller input before its first asynchronous digest. Mutation-during-digest tests prove that later changes to caller-owned artifact proof and head objects cannot alter the hashed rows or compare-and-swap expectation. The returned compare-and-swap head is independently cloned and frozen.

## Local verification

The test-only Worker configuration applies the checked-in serving migrations to an isolated Miniflare D1 database. It proves initial activation, exact idempotent retry, a committed switch whose response is lost, successful one-step rollback, preservation of first-activation timestamps, and transaction rollback after a forced failure following each of the three mutation statements. Every injected failure leaves the exact prior head and lifecycle in place and leaves no generation preflight or history row.

## Nonclaims

This slice provides no configured preview or production D1 resource, remote race or failure evidence, protected writer identity, real R2 immutability or Vectorize visibility proof, reader Session/bookmark handoff, public API or SSR response, cache behavior, backup/restore, pruning, multi-PoP chaos, rollback-time measurement, alerting, provisioning, deployment, provider publication, or release evidence. Test-only Miniflare behavior does not establish remote D1 behavior. Every related traceability status remains `Planned`.

[Phase 4G](phase-4g-provider-search-schema-writers.md) keeps this schema-1.4 adapter unchanged for historical tests and adds a distinct schema-1.5 provider-aware switch adapter. It does not broaden either nominal type across schema versions.
