# ADR 0017: Persist provider dispositions without fabricated slice identity

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Staff engineer, data lead, publication lead
- Related requirements: PIPE-005, PIPE-019, PIPE-043, PIPE-044, PIPE-050–PIPE-052, QA-006
- Supersedes: The `publication_provider_slice` row identity and readiness interpretation in migrations 0001–0002; clarifies ADR 0015

## Context

ADR 0015 requires one explicit disposition for every enabled provider. Selected content has a stable `prn_` identity and exact provider/run lineage. An unavailable disposition has no selected content and therefore has a null slice identity, an exact current provider-run ID, `carried_forward=false`, and `freshness=unavailable`.

The initial serving schema cannot represent that union. It makes `provider_slice_id` a global non-null primary key, which both forces an unavailable provider to mint a fictitious content identity and prevents a real selected slice from retaining the same identity when carried into a later publication. The schema also permits a zero-resource, all-unavailable candidate to become ready. The PRD does not define an empty active publication, while `PIPE-044` and `PIPE-052` require malformed or failed work to preserve the last known-good dataset.

## Decision

`publication_provider_slice` remains the physical table name for backup compatibility, but its row identity becomes `(publication_id, provider_id)`. `provider_slice_id` is nullable and unique within one publication when present.

The persisted state matrix is closed:

| Freshness | Slice identity | Carried forward |
|---|---|---|
| `unavailable` | null | false |
| `fresh` | non-null `prn_` | false or true |
| `stale` | non-null `prn_` | true |

The same non-null slice may occur in later publications only with its original provider and provider-run lineage. A new carried-forward row requires an already queryable `active`, `superseded`, or `rolled_back` occurrence of that exact tuple whose activation is no later than the candidate generation time. Reusing a queryable known slice without the carried-forward flag is rejected. Failed/building occurrences do not burn the content identity: a retry may insert the same exact tuple as non-carried while no queryable occurrence exists. Readiness rechecks these race-sensitive rules so competing candidates cannot both reinterpret the same slice. A candidate may not acquire a slice occurrence from a publication generated after it. Unavailable rows are exempt because they intentionally have no content identity.

Readiness requires at least one selected-content disposition and at least one public resource in addition to the existing closure-count and search-parity checks. An all-unavailable candidate remains non-ready and cannot replace the last known-good head. Supporting an intentionally empty first public publication would require a separate explicit product/design decision.

Migration 0003 preserves existing non-carried selected row values. If an old row says `unavailable`, its schema-required non-null `prn_` value is discarded to null because ADR 0015 establishes that value as fictitious, not content lineage. Before any schema mutation, the migration rejects unexpected schema metadata, a legacy queryable empty/all-unavailable publication, or a legacy carried claim without an exact queryable prior occurrence. Existing rows are migration input only; they are not complete serving receipts. The migration does not invent adapter, roster, source-register, attribution, vector, or closure-root values that the old schema cannot recover.

This decision changes no public API, deploys no database, and authorizes no publication switch.

## Consequences

- Unavailable provider outcomes can be persisted without claiming nonexistent content.
- Carried-forward content keeps one stable slice identity across publications and cannot silently change provider or producing run.
- All-provider failure preserves the last known-good publication instead of making an empty candidate ready.
- Failed/building candidate retries can reuse their exact slice identity without creating a false carry-forward claim; publication readiness closes the concurrency race.
- The physical table name and backup inventory remain stable.
- A later sealed-closure migration and writer must persist the remaining ADR 0015 inputs before any runtime activation receipt is truthful.
- Append-only switch history, exact-generation compare-and-swap, indexed public projections, FTS, D1 Sessions, and query-Worker integration remain separate blockers.

## Alternatives considered

- Keep a global non-null slice primary key: rejected because it fabricates unavailable content and prevents stable carried-forward identity.
- Mint a sentinel `prn_` value for unavailable: rejected because it misrepresents absence as selected content.
- Infer unavailable from a missing row: rejected because every enabled provider requires an explicit terminal disposition and exact current run.
- Add nullable or invented legacy version fields now: rejected because the old table has no truthful backfill source.
- Allow an all-unavailable publication to become ready: rejected because no empty-publication behavior is approved and it could replace the last known-good dataset.
- Combine this migration with the full query Worker: rejected because the serving closure, switch history, indexed projections, and runtime bindings are not yet complete.

## Validation

- Upgrade populated legacy selected/unavailable rows and verify exact selected values, null unavailable identity, row counts, schema version, indexes, foreign keys, and trigger targets; reject schema drift and unsafe legacy queryable/carried states before mutation.
- Accept every valid state-matrix row and reject every invalid slice/freshness/carried combination.
- Reuse one selected slice only after a temporally prior queryable occurrence and only with identical provider/run lineage; prove failed/building retries remain possible and readiness closes competing-candidate races.
- Reject malformed slice/provider/run UUIDv4 identities.
- Reject duplicate provider dispositions, post-readiness inserts, updates, and deletes.
- Reject all-unavailable zero-resource readiness and preserve the current head.
- Keep the traceability rows `Planned` until full writer, D1, query, publication-chaos, backup/restore, and deployed evidence passes.
