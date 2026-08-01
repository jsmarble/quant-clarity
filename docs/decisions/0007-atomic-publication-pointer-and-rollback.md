# ADR 0007: Activate publications with an atomic pointer and versioned caches

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, data lead, operations lead
- Related requirements: SRCH-007, API-003, API-012, API-015, API-024, API-024A, PIPE-044, PIPE-050–PIPE-056, BE-007, BE-010–BE-012, CF-008, CF-022, NFR-006, QA-006
- Supersedes: None

## Context

Canonical data, public projections, search vectors, cached API responses, and server-rendered pages must not expose incompatible versions. Vectorize mutations are asynchronous, D1 candidates may require many batches to load, and operators must preserve the last known-good release and roll back within four hours without editing individual records.

## Decision

Treat a public dataset as an immutable publication identified by a prefixed UUIDv4 publication ID and integrity-hashed manifest. Sort publications by explicit `published_at` then ID, never by UUID text.

Publication proceeds as follows:

1. Materialize a complete public bundle and manifest in private R2.
2. Load serving-D1 resources and FTS documents under the candidate publication ID. No active pointer references partial rows.
3. Write vectors under the candidate Vectorize namespace.
4. Verify counts, hashes, referential integrity, evidence coverage, exact and semantic search probes, filter agreement, and vector queryability.
5. Mark the candidate ready.
6. In one D1 transactional batch, change the singleton publication head from the current version to `{publication_id, vector_namespace, manifest_hash, published_at}` and retain the former head as the rollback target.

Every serving query obtains a publication ID first and constrains all D1 and Vectorize reads to it. Multi-query operations use one D1 Session or a single head-joined statement so replicas cannot create torn reads. Responses include the publication ID. Frontend Worker SSR resolves once at request start, embeds that ID, and pins every subsequent API request from the page to it.

The public API Worker applies request validation and route-cost rate limiting, asks the internal query service for the small active-head record, and only then selects an eligible data cache entry. Only path-only detail resources are cached, using a synthesized key containing publication ID, resource type, validated stable resource ID, and representation. Raw request URLs are never cache keys. Collections, filters, sorts, cursors, free-text search, and every request containing a query string are `private, no-store`. Activation therefore does not require unsafe global purges. The public active URL is a resolver, never the cache object identity.

Rollback is one transactional pointer update to the retained previous D1 version and Vectorize namespace. Preserve active, previous, and building versions/namespaces until the next release is accepted and the rollback safety interval has passed. Older versions remain rebuildable from R2.

Official references:

- [D1 transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [D1 Sessions and read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [Vectorize asynchronous mutations](https://developers.cloudflare.com/vectorize/reference/client-api/)
- [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)

## Consequences

- Readers may observe the old or new publication during propagation, but never a partially loaded candidate or cross-version search result.
- Defective publication rollback does not rewrite canonical facts.
- Versioned caches age out naturally and remain traceable.
- Serving D1 and Vectorize retain at least three publication generations temporarily.
- Publication is gated on search acceptance, which may delay freshness but preserves correctness.
- Long cached HTML may show an older coherent version; it must expose that version and use pinned follow-up reads.

## Alternatives considered

- Update public tables in place: rejected because partial batches and async search mutation expose mixed states.
- KV active pointer: rejected because its consistency model complicates atomic coordination with serving D1.
- Purge every cache on publication: rejected because purge failure is another partial-release mode and is unnecessary with versioned keys.
- Redeploy Workers to change Vectorize bindings per publication: rejected because code deployment and data publication must remain independent.
- Two publication generations: rejected because rebuilding the inactive generation could destroy the only rollback target.

## Validation

- Inject failure after every publication step and prove the current head remains unchanged.
- Concurrently issue reads during activation and assert each response contains one internally consistent publication ID.
- Delay Vectorize visibility and prove activation waits or fails closed.
- Populate old-version caches, activate a candidate, and prove new requests resolve the new key while pinned pages remain coherent.
- Execute rollback under load and meet the four-hour objective with no more than one completed publication at risk.
- Rebuild a removed serving generation and vector namespace solely from its R2 bundle.
