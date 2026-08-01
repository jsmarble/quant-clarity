# ADR 0003: Use canonical D1, serving D1, and private R2 storage

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, data lead, security lead
- Related requirements: DATA-046, DATA-060–DATA-067, BE-001–BE-012, CF-004–CF-008, PIPE-003, PIPE-044, PIPE-050–PIPE-056, SEC-012, OPS-008
- Supersedes: None

## Context

QuantClarity must preserve relational identity and applicability constraints, append-oriented fact history, private evidence, immutable public snapshots, atomic publication, efficient model-first reads, rollback, and provider-independent export. A single mutable public database would couple pipeline writes to public reads and grant the read path access to sensitive operational records. R2 alone would not provide the relational constraints and queries required by the canonical model.

## Decision

Use three storage roles:

- `canonical` D1: private normalized identities, observations, field claims, evidence metadata, policy versions, pipeline/provider runs, anomaly and quarantine state, and current/superseding canonical facts. Only controlled pipeline and migration identities may write it.
- `serving` D1: disposable, denormalized, publication-version-keyed API and page projections plus exact/keyword search documents. It contains no credentials, raw authenticated payloads, or unrelated source content. Public reads access it only through the internal query Worker.
- Private R2 buckets: redacted raw evidence, immutable normalized observation archives, publication bundles and manifests, logical ordinary-table exports, fixture-source audit material, and disaster-recovery artifacts. Object metadata records integrity hashes and retention class.

Serving projections are reproducible from an integrity-hashed R2 publication bundle. Keep active and rollback-ready projections online; archive all completed publications to R2. Retain redacted evidence for at least 24 months and normalized price/precision history for the life of the service. Export ordinary base tables from both D1 databases to R2 on a tested schedule in addition to D1 Time Travel. Canonical export drains/acquires the single-writer lease and records one Time Travel bookmark/high-water boundary; serving export selects one immutable publication closure. Hash/count every chunk and retry if the ending boundary changes. Because D1 export does not support databases containing virtual tables, never treat the serving FTS5 index as portable backup data: export `publication_search_document` rows and rebuild FTS5 and Vectorize deterministically during restore.

Official references:

- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [D1 transactions with batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)

## Consequences

- Sensitive evidence and operational state are absent from the public serving database.
- Public read schemas may be optimized without changing canonical facts.
- Serving D1 can be rebuilt or migrated from an immutable publication bundle.
- D1 relational constraints enforce identity, evidence, and applicability integrity.
- Storage and migration logic must maintain two database schemas and R2 manifests.
- Long-lived history must be archived deliberately to avoid D1's per-database size ceiling.
- Recovery depends on continuously tested exports, manifests, and rebuild tooling rather than D1 Time Travel alone.

## Alternatives considered

- One D1 database for canonical and public data: rejected because it weakens least privilege and couples retention-heavy history to latency-sensitive reads.
- R2-only canonical and serving data: rejected because relational uniqueness, referential integrity, filtering, cursor pagination, and field-level supersession would become application-enforced.
- KV for the publication pointer or canonical facts: rejected because eventual consistency and limited query semantics complicate atomic publication and rollback.
- External PostgreSQL: rejected by the Cloudflare-native infrastructure requirement.

## Validation

- Prove database constraints reject orphan offerings, unsupported evidence links, duplicate active identities, and prices without offerings.
- Rebuild a blank serving D1 database from one R2 publication bundle and compare resource hashes.
- Restore canonical D1 through Time Travel and from an R2 logical export in separate exercises; restore serving D1 from base rows and prove FTS5/Vectorize rebuild parity.
- Demonstrate the 24-hour RPO/RTO and four-hour publication rollback objectives.
- Scan serving D1 and public bundles for credentials, personal data, and authenticated raw payloads.
- Model initial and 100-provider storage growth against current D1 and R2 limits and cost.
