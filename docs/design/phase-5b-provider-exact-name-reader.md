# Phase 5B: internal provider exact-name reader

| Attribute | Value |
|---|---|
| Status | Implemented local decision and runtime evidence; public integration, deployed evidence, and release acceptance remain pending |
| Decision | [ADR 0021](../decisions/0021-canonical-provider-exact-search.md) |
| Requirements | `SRCH-002`, `SRCH-006`, `SRCH-008`, `SRCH-009`, `API-003`, `BE-003`, `BE-008`, `BE-011`, `SEC-001`, `SEC-007`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006` |

## Slice boundary

`apps/query` now contains one internal function-level provider exact-name operation. It does not add `/v1/search`, an API-to-query service RPC, a public route, a D1 binding identifier, a resource ID, or deploy/provision configuration. Its caller supplies an already selected and protocol-validated hot publication ID. The single fixed `SELECT` independently rechecks the lifecycle/head subset available in serving D1: `active` only when selected by the active head, caller-selected `superseded`, and `rolled_back` only when selected as the current rollback candidate. D1 does not perform ADR 0013 hot-retention inventory selection; the future selection/bookmark integration must prove the supplied superseded ID is still hot.

The same statement always emits one typed selected-publication sentinel before any candidate rows. A selected eligible-publication no-match therefore returns an empty page, while an unknown, wrongly stated, or non-selected active/rolled-back publication fails with a static integrity error. Candidate discovery uses bound equality on the schema-1.5 `(publication_id, normalized_name, provider_id)` index, never string interpolation, FTS `MATCH`, BM25, semantic ranking, provider fan-out, affiliate facts, offering counts, or provider-derived model ordering.

## Closed input, output, and bounds

The operation accepts exactly `publicationId`, `query`, optional `afterProviderId`, and optional `limit`. Unknown keys and status filters reject before D1. Raw text is bounded to 200 Unicode scalars and 800 UTF-8 bytes, then normalized with the pinned `exact-search-normalization@1` implementation and its 3,600-scalar derived ceiling. Page size is 1–20; D1 may return only the requested page plus one lookahead, ordered strictly by stable provider ID. The adapter rejects duplicate, descending, pre-cursor, wrong-publication, extra, or corrupt rows, including a corrupt lookahead.

Canonical provider JSON retains the existing publication-core ceiling of 1,000,000 UTF-8 bytes. SQL replaces an oversized JSON value with a null integrity sentinel rather than transferring it, and the adapter fails closed. The complete page-plus-lookahead transfer is bounded to 21,000,000 JSON bytes and checked before sequential parsing/hashing. This is a local correctness ceiling aligned to the existing canonical resource contract, not a production capacity claim.

Each candidate rehydrates the publication-scoped canonical `Provider` resource and rechecks the shared Worker-safe contract validator, canonical UTC timestamps, Unicode-scalar display-name bound, provider identity, known evidence-backed display-name fact, default known-active status, projection display bytes, pinned normalization, projection/resource hash equality, and a recomputed canonical resource hash. Only then does it emit a frozen, detached tier-3 candidate containing `resourceType = provider`, stable resource ID, canonical display-name Fact, `matchKind = provider_name`, `semanticDegraded = disabled`, and the normalized ordering key. The full provider resource is not exposed as a search candidate.

Inactive, unavailable, deleted, and unknown-status providers are absent from this default operation. An explicit historical/status-search policy remains unresolved and is not silently added here.

## Verification evidence

Unit tests cover punctuation/case/separator normalization, hostile FTS-like text, empty/overlong/extra-key input, exact parameter binding, canonical rehydration and hash checks, self-consistent contract-invalid resources, normalized-name collisions, stable pagination, non-hot and hot no-match behavior, strict row order, lookahead corruption, resource and aggregate byte ceilings, static non-echoing errors, frozen detached outputs, neutrality under unrelated affiliate/count/coverage/site changes, and a contract-valid provider resource larger than 48 KB.

The workerd test applies all serving migrations to real D1, publishes and activates the schema-1.5 provider projection through the trusted Phase 4G writers, verifies exact retrieval and a hostile no-result, proves the named exact index appears in `EXPLAIN QUERY PLAN`, rejects unknown and ready-but-non-hot publications, activates a second publication, proves a selected superseded publication remains readable, proves a canonical inactive provider remains absent by default, rolls back, and proves the resulting `rolled_back` rollback candidate remains eligible. A three-activation workerd proof for an older caller-inventoried superseded publication remains pending with general ADR 0013 selection/bookmark integration. Source tests prohibit DML, FTS `MATCH`, and SQL interpolation. The privacy gate continues to prohibit logs, traces, analytics, cookies, persistence, request IDs, and cache writes.

## Contract/storage follow-up

Review identified a pre-existing mismatch outside this reader: `ProviderSchema` admits C0 NUL in a known display name, while SQLite `length(TEXT)` stops at the first NUL and migration 0007's `display_name` length check can reject that otherwise contract-valid value. Phase 5B did not reinterpret the approved normalization or canonical contract; at that boundary, a dedicated ADR/control still had to choose between prohibiting NUL and replacing the storage check. Search requirements remained `Planned` while that decision and the complete acceptance gates were unresolved.

[ADR 0022](../decisions/0022-forbid-nul-provider-display-names.md) and [Phase 5C](phase-5c-provider-name-nul-boundary.md) now resolve the design choice narrowly: prohibit only U+0000 at the known canonical provider-name and matching exact-query boundaries, preserve normalization version 1, and add serving schema `1.5.1` defense in depth. Phase 5B remains a record of the finding; implementation and cross-runtime evidence belong to Phase 5C, and traceability remains `Planned`.

## Remaining evidence

This slice does not implement model/variant exact tiers, tier merging, aliases, prefix/keyword search, structured filters, status/history filters, semantic search, signed cursors, API/query RPC, D1 Sessions/bookmarks, replica behavior, public response schemas, cache behavior, abuse controls, visitor-canary audits, deployed limits, or production resources. It does not complete `SRCH-002`, `SRCH-006`, `SRCH-008`, `SRCH-009`, `QA-005`, or `QA-006`; traceability remains `Planned` until their full acceptance sets and release gates pass.
