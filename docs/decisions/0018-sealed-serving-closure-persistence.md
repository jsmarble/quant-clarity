# ADR 0018: Persist a sealed serving closure before readiness

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Staff engineer, publication lead
- Related requirements: `SRCH-006`, `SRCH-007`, `API-003`, `PIPE-044`, `PIPE-050`–`PIPE-052`, `PIPE-054`, `PIPE-055`, `BE-011`, `BE-012`, `CF-022`, `QA-006`
- Supersedes: The count-only readiness interpretation in serving migrations 0001–0003; clarifies ADRs 0015 and 0017

## Context

ADR 0015 defines an immutable publication closure and a separate mutable lifecycle. The local publication kernel can derive and verify that closure, but serving D1 currently persists only part of its inputs. In particular, it omits provider adapter/roster/source-register versions, provider-resource attribution, the exact vector inventory, chunk inventory, and several root hashes. The reserved `publication.closure_hash` can therefore be caller supplied before D1 can reproduce the represented closure.

Readiness and head switching must not rely on that incomplete persistence boundary. Phase 4B correctly persists closed provider dispositions, but its structural count checks are not archive, search-visibility, or acceptance-probe evidence. A switch ledger would merely preserve an unsealed claim if implemented first.

## Decision

Phase 4C adds a migration-backed, immutable sealed-closure ledger before implementing readiness or head switching. It uses sidecar tables so it does not fabricate values absent from the existing schema:

| Table | Purpose and required key |
|---|---|
| `publication_provider_slice_metadata` | Exact adapter, roster, and source-register versions for one persisted disposition; primary/foreign key `(publication_id, provider_id)` |
| `publication_provider_attribution` | Exact provider owner for every provider-attributable public resource; primary key `(publication_id, resource_type, resource_id)`, with foreign keys to the resource and disposition |
| `publication_vector_inventory` | Exact publication namespace, document/vector ID, stable resource identity, search-document hash, and embedding-input hash; primary key `(publication_id, vector_id)`, unique resource identity, and foreign keys to the matching search document/resource |
| `publication_inventory_chunk` | Contiguous, non-overlapping resource, exact-search, and vector chunks; primary key `(publication_id, kind, ordinal)` |
| `publication_staging_revision` | Monotone revision for all closure-bearing inserts; one row per publication |
| `publication_closure_seal` | Manifest/hash-encoding versions, enabled-provider scope version/hash, declared counts, bundle hash, every inventory/root hash, closure hash, matched staging revision, and seal time; one immutable row per publication |

Every closure-bearing insert occurs only while the publication is `building` and unsealed and advances its staging revision. The sealing writer reads one revision, reconstructs the full manifest from persisted rows, recomputes canonical resource and search-document hashes from exact bytes, calls the ADR 0015 kernel, and inserts the seal only if the revision is unchanged. A concurrent insert changes the revision and makes the seal compare-and-swap fail. The seal must equal the immutable scalar metadata and reserved closure hash already associated with the publication.

The writer uses one closed row projection whose fields map exactly to the six sidecar tables and the immutable `publication` row. That projection derives the publication-qualified Vectorize ID, every inventory root, the closure hash, and the exact seal values. The writer verifies the projection again before its atomic insert; callers cannot supply independent root fields. Direct SQL is restricted to the controlled pipeline identity, while public/query identities have no write binding. A manual revision increment can only invalidate a candidate conservatively; it cannot create content or authorize a seal. Revision changes are rejected outside `building` and after sealing.

### Content-hash and chunk encoding version 1

Persisted resource JSON and the two JSON arrays in a search document must already be one canonical UTF-8 representation. Objects have printable-ASCII keys sorted by code point with no duplicate members; arrays preserve order; strings use ECMAScript JSON escaping without Unicode normalization; null and Booleans use their JSON literals; and numbers are limited to safe integers in minimal JSON form. Exact decimals remain strings. Whitespace variants, reordered keys, duplicate keys, `-0`, fractional/exponent forms, unsafe integers, non-ASCII keys, invalid/wrong containers, inputs above 1,000,000 UTF-8 bytes, and nesting beyond 64 levels reject. Resource and search content hashes use the ADR 0015 length-prefixed tuple encoding under `publication-resource-content` and `publication-search-document-content` respectively.

Each inventory chunk covers one contiguous slice of the corresponding inventory sorted by `resource_type:resource_id`. Its first/last keys and item count must match that exact slice. Chunk content hashes use the same length-prefixed record fields as the resource, exact-search, or vector inventory under `publication-resources-chunk`, `publication-exact_search-chunk`, or `publication-vectors-chunk`. A fabricated range, changed member, wrong publication-qualified vector ID, altered embedding-input hash, gap, overlap, or reordered chunk therefore fails the controlled projection before a seal insert.

Database constraints and sealing checks enforce exact enabled-provider coverage, disposition metadata coverage, provider-attribution closure and unavailable-provider isolation, one-to-one searchable-resource/search-document/vector parity, exact publication namespace and vector identity, contiguous chunk coverage, and declared count parity. SQL does not pretend to implement the canonical SHA-256 encoding; the controlled writer recomputes it, while stored roots make the result reproducible and auditable.

Migration preflight requires exactly serving schema `1.1.0` and rejects any legacy `ready`, `active`, `superseded`, or `rolled_back` publication or existing head before DDL. The missing closure inputs cannot be truthfully backfilled. Existing `building` or `failed` rows may remain, but only a complete building candidate can seal.

Migration 0004 may be applied only through the lockfile-pinned Wrangler `d1 migrations apply` path, which executes the migration statements plus its migration-record insert as one rollback-capable D1 batch. Raw `exec()` application is prohibited. Local migration tests wrap each file in an explicit SQLite transaction and inject schema collisions/malformed metadata to prove a failed file leaves schema `1.1.0` unchanged and retryable.

Sealing does not mean ready. Phase 4C rejects `building` to `ready`, head insertion, and head update. Phase 4D must next persist all four ADR 0015 readiness-receipt kinds, bind them to the exact seal, and only then implement append-only switch history plus exact-generation transactional activation and rollback. FTS and remote Vectorize visibility remain additional Phase 4D/runtime evidence.

## Consequences

- Serving D1 can reproduce the immutable closure from ordinary portable rows rather than trusting a reserved digest.
- A staging race, partial seal, invented legacy value, unavailable-provider attribution, or vector/count-only agreement cannot become a ready publication.
- Sealed candidates remain immutable and may transition only to `failed` until Phase 4D replaces the explicit readiness fence.
- Existing queryable legacy data is rejected rather than silently blessed. Supporting an intentionally empty publication or inventing a legacy backfill requires explicit product-owner approval.
- Traceability remains `Planned`; local persistence evidence does not prove D1 runtime transactions, FTS, Vectorize visibility, public consistency, backup/restore, or release readiness.

## Alternatives considered

- Implement switch history first: rejected because its closure hashes would not yet be reproducible from serving storage.
- Add nullable columns directly to existing rows and backfill placeholders: rejected because unknown adapter, roster, source-register, vector, attribution, and root values cannot be invented.
- Treat structural counts or a stored `queryable` Boolean as readiness: rejected because neither proves archive retention, exact/semantic visibility, filters, neutrality, or version isolation.
- Permit post-seal staging and recompute later: rejected because the seal would not identify one immutable candidate assembly.
- Combine closure persistence, readiness, switching, FTS, and Vectorize runtime in one change: rejected because it would merge independently reviewable integrity and external-visibility boundaries.

## Validation

- Upgrade an empty or building/failed schema 1.1 database and verify schema version, tables, indexes, foreign keys, and trigger targets; reject schema drift, a legacy queryable publication, or an existing head before mutation.
- Seal a complete selected-plus-unavailable candidate by selecting every ordinary row, reconstructing the exact ADR 0015 manifest, projecting every exact root/seal field, inserting it, and reading the same values back.
- Reject missing/duplicate disposition metadata, enabled-provider mismatch, unavailable/out-of-inventory attribution, missing/extra/wrong-namespace vectors, vector/document identity or hash mismatch, and invalid chunk coverage.
- Reorder stored inventories without changing the closure; change any typed value, content byte, membership, policy/version, identity, derived vector ID, chunk range, chunk member, or projected seal field and reject the declared closure.
- Race a staging insert against sealing and prove revision compare-and-swap failure with no partial seal; inject failure at every write boundary and prove deterministic retry.
- Reject every post-seal insert, update, and delete, plus every readiness/head mutation; preserve the current last-known-good authority after malformed, partial, failed, or stale-revision work.
- Preserve every Phase 4B provider-disposition and carried-lineage test.
