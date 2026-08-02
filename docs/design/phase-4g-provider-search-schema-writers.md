# Phase 4G: provider-search schema and trusted writers

- Status: implemented with local SQLite, unit, fake-D1, and workerd evidence; remote/deployment evidence pending
- Decision: [ADR 0021](../decisions/0021-canonical-provider-exact-search.md)
- Requirements: `SRCH-002`, `SRCH-006`, `SRCH-007`, `PIPE-044`, `PIPE-050`–`PIPE-053`, `BE-003`, `BE-011`, `QA-006`

## Atomic release boundary

Schema `1.5.0`, the pre-seal provider projection writer, and the v2 readiness and switch writers form one release boundary. No intermediate state may expose schema `1.5.0` to a v1 writer or allow a v2 writer to run against schema `1.4.0`. Migration 0007 therefore rejects any legacy sealed, readiness, head, preflight, or switch-history state instead of fabricating provider evidence. It preserves only unsealed `building` and `failed` publications and advances the serving schema from exactly `1.4.0` to `1.5.0` as its final step.

The canonical publication `schema_version` remains distinct from the serving D1 migration level in `serving_schema_metadata`. Migration 0007 does not rewrite publication contract versions.

## Physical provider projection

The reconstructible ordinary projection uses one row per known canonical provider display name:

`publication_provider_search_document(publication_id, provider_id, projection_version, display_name, normalized_name, provider_resource_content_hash)`

Its primary key is `(publication_id, provider_id)`, and its exact-lookup index is `(publication_id, normalized_name, provider_id)`, so normalized-name collisions use only the stable provider ID as their tie break. A separate FTS5 table, `publication_provider_search_fts(publication_id UNINDEXED, provider_id UNINDEXED, display_name)`, is populated only from the ordinary projection and uses `unicode61 remove_diacritics 2`. Projection versions, normalized names, and source hashes remain ordinary-table integrity fields rather than keyword-index content. The FTS build identity is `provider-name-fts5-unicode61@1`; exact provider-name classification continues to use bound equality on the ordinary indexed `normalized_name`, never visitor-controlled `MATCH` syntax or BM25 rank.

The Provider contract defines a known display name as 1–200 Unicode scalars; the unknown fact state represents a missing name. The canonical runtime preserves JSON Schema scalar semantics at this field-specific boundary even though TypeBox `Value.Check` counts JavaScript UTF-16 code units, while retaining full TypeBox validation for the rest of `ProviderSchema`. The exported `PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS` constant and contract tests pin 200 astral scalars as valid, 201 as invalid, and an empty known name as invalid.

The ordinary `normalized_name` ceiling is 3,600 Unicode scalars: `PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS` multiplied by `EXACT_SEARCH_NORMALIZATION_MAX_UNICODE_SCALAR_EXPANSION`, the generated maximum of 18 from the pinned Unicode 17 NFKC_Casefold table. U+FDFA is the maximum-expansion mapping. The generated constant, core derived bound, migration `CHECK`, portable SQLite test, and real-workerd regressions must remain aligned so every contract-valid known provider display name remains publishable.

SQLite does not permit triggers on virtual tables, and D1 exposes no per-table writer ACL. The database cannot structurally reject a direct mutation of the provider FTS virtual table. Write authority is therefore confined to the controlled pipeline identity and its fixed staging statements; the separately deployed public Worker contains only fixed `SELECT` paths, while exact-name reads use only the ordinary projection. This is an application-identity and code boundary, not a nonexistent read-only D1 binding or a claim of FTS immutability. Count and bidirectional row parity are rechecked at sealing, readiness, switch preflight, and switch-history application, so direct FTS drift before any of those gates fails closed without changing the head. Out-of-band privileged FTS corruption after activation is not structurally prevented or continuously detected by this local slice; production control-plane access, later read-path rehydration, and operational integrity monitoring must preserve that boundary.

The insert guard proves an unsealed `building` publication, a selected fresh or carried-stale provider slice, exact provider attribution, and the matching canonical provider resource/hash and known display-name bytes. Unknown and unavailable providers produce no row. Ordinary rows are immutable, normalized-name collisions retain every provider ID, and zero rows require no sentinel. Sealing, readiness, and switching each require complete bidirectional ordinary/FTS parity.

The staging adapter expands bound `JSON.stringify` arrays through D1's supported `json_each(?1)` table function, so insertion remains one fixed statement per deterministic chunk and every inserted ordinary row still executes the database triggers. It validates all limits before opening D1: at most 1,000 nominal documents, fewer than 2,000,000 UTF-8 bytes per JSON binding and serialized row, four parameters per insert statement, at most 42 insert chunks, and at most 50 queries for the complete three-query snapshot + precondition + inserts + postcondition + three-query reconciliation path. These conservative ceilings fit both D1's 50-query Free and 1,000-query Paid invocation limits, 2,000,000-byte string/BLOB/row limit, and 100-bound-parameter limit. Current official references are [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [D1 JSON query support](https://developers.cloudflare.com/d1/sql-api/query-json/). Any row, byte, chunk, parameter, or total-query overflow fails before acquiring a D1 session.

## Trusted writer order

The pipeline order is fixed:

1. Build a complete nominal `provider-name@1` projection from closure-shaped canonical provider-resource bytes.
2. Stage only that nominal projection through fixed prepared statements while the publication is unsealed and `building`; prove exact ordinary/FTS poststate, including the empty projection case.
3. Seal the publication only after provider projection completeness and parity hold.
4. Build and commit nominal v2 readiness rows and attestation. Receipt and evaluator versions are `2.0.0`; provider probes are `search-gold@2`.
5. Activate or roll back only through a nominal v2 switch projection whose `2.0.0` preflight binds the provider proof. The switch-history event remains `1.0.0` and binds the new preflight hash.

The three adapters reject caller-supplied rows, caller-supplied hashes, bare v2 proof primitives, copied or reflected nominal objects, and every v1 composite. Restart-safe activation reconstructs and verifies the persisted v2 ledger rather than relying on an in-memory proof from an earlier isolate. Ambiguous writes reconcile through a fresh primary session; partial or conflicting immutable state fails closed. Local tests cover response loss, every staging/readiness/switch batch position in the deterministic adapter harness, all readiness and switch batch positions in workerd/D1, two successive activations, one-step rollback, provider-FTS corruption, staging-revision drift, and real-workerd `json_each` insertion at both the 200-astral-scalar contract boundary and the worst-case Unicode expansion. A separate pure adapter-planner test proves exact byte/chunk/parameter/query accounting and lossless serialization for the 1,000-document maximum; it does not claim to execute 1,000 rows in workerd.

## Failure and privacy boundaries

Migration application is atomic and retryable. Staging, readiness, and switch transactions assert their complete prestate and poststate. Any missing, extra, or corrupt provider ordinary/FTS row; mismatched provider inventory root; stale evidence; generation conflict; or injected statement failure leaves the existing head unchanged. A failed candidate remains nonqueryable and cannot replace the last known-good publication.

This slice adds no public query route and processes no visitor input. It adds no cookie, browser storage, request log, trace, analytics event, metric, correlation identifier, click record, visitor-derived cache key, Cloudflare resource, credential, or deployment configuration.

## Portable and remaining work

Portable backups continue to omit both provider projection tables. Restore must rebuild them from canonical provider resources before sealing, then regenerate and compare the v2 readiness proof. This local slice does not prove deployed D1 behavior, R2 archive immutability, Vectorize visibility, reader sessions/bookmarks, cache behavior, multi-PoP chaos, protected deployment configuration, or a production release. Traceability therefore remains `Planned` until each requirement's full acceptance evidence exists.
