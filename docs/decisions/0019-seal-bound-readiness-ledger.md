# ADR 0019 — persist seal-bound readiness before publication switching

| Attribute | Value |
|---|---|
| Status | Accepted |
| Date | 2026-08-02 |
| Requirements | `SRCH-001`, `SRCH-002`, `SRCH-006`, `SRCH-007`, `PIPE-044`, `PIPE-050`–`PIPE-053`, `BE-003`, `BE-011`, `CF-022`, `QA-006` |
| Extends | ADRs 0013, 0015, 0017, and 0018 |

## Context

ADR 0018 makes every closure input reproducible from serving rows and rejects readiness and head mutation. The runtime-neutral readiness kernel already requires archive, serving, vector, and acceptance-probe receipts, but those values were not persisted and the exact-search FTS representation did not exist. A stored count or `queryable` Boolean cannot prove that the sealed resource, FTS, and Vectorize inventories agree or that the required probes ran.

Cloudflare D1 currently supports SQLite FTS5, while D1 export excludes virtual tables. FTS is therefore a reproducible serving index, never the canonical or portable store. D1 otherwise autocommits, but `D1Database.batch()` is a transaction and rolls the whole batch back after a statement error. The controlled writer must use that property; application code checking a zero-row update after commit is not an atomic assertion.

The existing search-document projection contains publisher names and provider model IDs, but it does not contain provider display names. `SRCH-002` nevertheless requires exact provider names. This is an implementation gap, not permission to omit the requirement or infer provider aliases. Complete `SRCH-002` acceptance remains blocked until a follow-up ADR defines a deterministic provider-name search projection.

## Decision

### Reproducible exact-search representation

Serving migration 0005 creates a publication-scoped FTS5 index with `unicode61 remove_diacritics 2`. Publication and document IDs are unindexed selectors. Indexed fields are normalized name, canonical alias JSON, publisher name, provider-model-ID JSON, and document text. Inserts are derived from immutable `publication_search_document` rows. The build identity recorded by the serving receipt is `fts5-unicode61@1`.

The FTS index is outside the immutable closure because it is reproducible from closure-bound ordinary rows. Readiness nevertheless requires exact row parity, a matching source inventory, a successful queryability result, and version-controlled exact-search probes. Backup and restore export ordinary search-document rows, recreate FTS, and rerun probes; they never claim a portable FTS virtual table.

### Four immutable receipts

Each sealed candidate has exactly one receipt binding for each kind: `archive`, `serving`, `vectors`, and `probes`. A binding contains receipt version `1.0.0`, environment, publication ID, closure hash, bundle hash, schema version, build commit, observation time, and a domain-separated receipt hash. Kind-specific typed tables retain the exact evidence evaluated by the kernel. Updates and deletes are prohibited.

Receipts may be inserted only for a sealed publication that remains `building`, and observation must be at or after seal time. The controlled writer constructs hashes from the typed closed shape; it does not accept independent digest fields from callers. Public and query identities have no write operation, arbitrary SQL input, receipt import, or pipeline trigger.

The vector receipt is not satisfied by mutation acknowledgement or one sentinel. It records the declared and independently verified counts, closure inventory hash, visibility-probe version, bounded mutation identity, complete-ID presence, namespace agreement, and queryability. Production readiness still requires real bounded `getByIds` inventory verification plus namespace-scoped semantic/filter probes after the asynchronous mutation is processed.

### Readiness attestation and validity

One immutable attestation binds the exact four receipt hashes to the seal, environment, evaluator version `1.0.0`, evaluation time, configured maximum receipt age, and effective validity deadline. The deadline is the oldest observation plus the configured maximum age. No production age constant is approved here; protected environment configuration supplies it and the chosen value is persisted. The database rejects an evaluation time more than five minutes ahead of its own clock to prevent a far-future candidate from fencing later switches.

The `building` to `ready` transition requires the exact attestation and matching ready timestamp. Before accepting it, SQL rechecks four-kind cardinality, common binding, post-seal and freshness ordering, all closure counts and roots, complete FTS row parity, archive immutability, complete vector inventory evidence, and every acceptance-probe Boolean. Missing, partial, stale, future, cross-environment, altered, or failed evidence aborts.

Receipt rows, the attestation, and the lifecycle transition must be one rollback-capable controlled-writer D1 batch. Exact retry uses idempotent inserts followed by aborting equality assertions inside that same batch; a conflicting retry aborts. Raw `exec()`, separate autocommitted writes, and JavaScript-only post-commit checks are prohibited. Migration application retains ADR 0018's pinned atomic Wrangler path.

Initial activation must occur before the attestation deadline. Rollback does not reuse the original receipt-age limit because that would defeat the retained known-good recovery guarantee; the future rollback transaction instead revalidates the immediate candidate's sealed D1/FTS/Vectorize representation through a bounded rollback preflight.

Because SQLite does not prohibit the privileged writer identity from addressing an FTS virtual table directly, Phase 4D2 activation must recheck exact FTS source parity inside the head-switch transaction. The runtime writer must expose no generic SQL path and must reject any post-readiness FTS mutation before activation. An attestation alone cannot authorize a head switch after its indexed representation drifts.

### Closed switching boundary

Migration 0005 does not open the singleton head. All head inserts, updates, and deletes remain rejected. A follow-up migration must add immutable switch history and execute initial activation, later activation, and rollback with exact-generation compare-and-swap, aborting in-transaction assertions, lifecycle changes, history append, and final postconditions in one D1 batch.

### Privacy boundary

Readiness inputs are fixed control-plane facts and version-controlled synthetic probes. They contain no visitor query, URL, header, address-derived key, user agent, referrer, cookie, request/correlation ID, or public-request telemetry. Public semantic queries remain outside this slice. Public logs, traces, analytics, browser persistence, and telemetry remain disabled.

## Consequences

- A sealed candidate can become locally `ready` only through four typed, fresh, environment-consistent receipts and one exact attestation.
- FTS corruption or source/index mismatch aborts readiness and leaves the last-known-good head untouched.
- Receipt and attestation hashes provide stable switch/backup audit anchors, subject to the controlled-writer boundary because SQLite does not recompute SHA-256.
- Failed or partial receipt work must roll back; an unreachable external Vectorize/R2 candidate artifact may remain for reconciliation but cannot affect the head.
- Complete `SRCH-002`, remote D1 transaction behavior, remote Vectorize visibility, switching, read-replica consistency, backup/restore, multi-PoP chaos, and release gates remain `Planned`.

## Rejected alternatives

- Treat `queryable = true` as vector proof: rejected because mutation processing, complete ID presence, namespace agreement, and real probes are distinct facts.
- Store one opaque receipt JSON document: rejected because readiness-critical values need closed typed columns and database comparisons rather than caller-controlled shape.
- Hash FTS implementation bytes into the publication closure: rejected because the virtual index is reproducible, nonportable, and not the canonical source.
- Permit readiness receipts in separate autocommitted calls: rejected because partial evidence would become durable after a failed decision.
- Add inferred provider names to the current search document: rejected because provider-name projection is an unresolved deterministic design choice and facts may not be inferred.
- Open head switching in the same migration: rejected so the receipt/FTS integrity boundary can be independently reviewed before lifecycle authority changes.

## Verification

- Prove fixed receipt and attestation hashes, exact persisted-row round trips, hostile shape/hash rejection, and full vector/FTS evidence requirements.
- Apply migration 0005 atomically; reject malformed metadata and target-object collisions without advancing schema 1.2.
- Rebuild and query publication-scoped FTS, then corrupt it during a readiness transaction and prove the full receipt batch rolls back.
- Reject readiness without an exact attestation and every receipt/attestation update or delete.
- Keep every head mutation closed until switch-history migration and D1 batch failure-injection evidence exist.

## References

- [Cloudflare D1 supported SQL and FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [Cloudflare D1 import/export limitations](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Cloudflare D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/)
