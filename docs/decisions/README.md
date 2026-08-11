# Architecture decision records

Use this directory for consequential technical decisions that are difficult to reverse, affect multiple components, or constrain future implementation.

## Naming

```text
NNNN-short-kebab-case-title.md
```

Start at `0001`. Never reuse an ADR number.

## Required structure

```markdown
# ADR NNNN: Title

- Status: Proposed | Accepted | Superseded | Rejected
- Date: YYYY-MM-DD
- Decision owners: names or roles
- Related requirements: PRD IDs
- Supersedes: ADR number, if applicable

## Context

## Decision

## Consequences

## Alternatives considered

## Validation
```

Accepted ADRs describe implementation choices; they do not amend product requirements. If a technical constraint requires a product change, obtain explicit approval and amend the PRD and product decision log separately.

## Decision index

- [ADR 0001](0001-typescript-npm-astro-pages.md) — TypeScript npm workspaces and the original Astro topology
- [ADR 0002](0002-public-edge-and-internal-query-workers.md) — public edge and non-routable query Workers
- [ADR 0003](0003-d1-and-r2-storage-topology.md) — canonical D1, serving D1, and private R2
- [ADR 0004](0004-stable-identities-and-field-claims.md) — stable IDs, field claims, and exact-offering applicability
- [ADR 0005](0005-d1-fts5-and-vectorize-search.md) — D1 FTS5 and Vectorize publication namespaces
- [ADR 0006](0006-scheduled-workflows-without-initial-queues.md) — scheduled Workflows without initial Queues
- [ADR 0007](0007-atomic-publication-pointer-and-rollback.md) — atomic publication pointer and versioned caches
- [ADR 0008](0008-workers-ai-and-ai-gateway-exception.md) — Workers AI and the gated external-inference exception
- [ADR 0009](0009-rate-limit-privacy-observability-cost-controls.md) — abuse, privacy, observability, and cost controls
- [ADR 0010](0010-decimal-prices-and-neutral-sorting.md) — exact decimal prices and neutral scoped sorting
- [ADR 0011](0011-zero-visitor-data-and-gdpr-controls.md) — zero visitor data and GDPR release controls
- [ADR 0012](0012-astro-workers-static-assets.md) — Astro SSR on Workers with Static Assets
- [ADR 0013](0013-publication-consistent-read-transport.md) — publication-consistent read transport and vector IDs
- [ADR 0014](0014-deterministic-operational-identities.md) — deterministic operational identities
- [ADR 0015](0015-publication-closure-and-lifecycle.md) — immutable publication closure, lifecycle, search inventory, and deferred pruning
- [ADR 0016](0016-bounded-local-api-read-protocol.md) — bounded local API decisions, cursors, service envelopes, conditional reads, and cache origin
- [ADR 0017](0017-provider-disposition-persistence.md) — provider dispositions, carried-forward lineage, and non-empty readiness
- [ADR 0018](0018-sealed-serving-closure-persistence.md) — sealed serving-closure persistence and fail-closed readiness ordering
- [ADR 0019](0019-seal-bound-readiness-ledger.md) — seal-bound readiness receipts, exact-search FTS, and closed switching order
- [ADR 0020](0020-exact-generation-publication-switching.md) — fresh switch preflights, exact-generation head changes, and append-only history
- [ADR 0021](0021-canonical-provider-exact-search.md) — canonical provider exact-search documents without provider-derived model ranking
- [ADR 0022](0022-forbid-nul-provider-display-names.md) — forbid NUL in canonical provider display names and exact-name queries
- [ADR 0023](0023-local-query-rpc-and-bookmark-continuity.md) — closed local query RPC and D1 bookmark continuity for the first provider exact tier
- [ADR 0024](0024-search-collection-semantic-degradation.md) — authoritative search-collection semantic degradation with a compatible result mirror
- [ADR 0025](0025-trusted-model-variant-name-projection.md) — trusted canonical model/variant exact-name projection derived from complete publication resources
- [ADR 0026](0026-blob-model-variant-exact-search-cutover.md) — UTF-8 BLOB persistence and split durable-proof/query cutover for model/variant exact names
- [ADR 0027](0027-trusted-provider-model-id-projection.md) — trusted one-row-per-Offering provider-model-ID projection and deferred reader semantics
- [ADR 0028](0028-provider-model-id-durable-storage-cutover.md) — dual-index UTF-8 BLOB persistence and v4 proof cutover for provider model IDs
- [ADR 0029](0029-provider-model-id-exact-reader.md) — literal raw-first provider-model-ID equality mapped to canonical Model or Variant targets
- [ADR 0030](0030-composed-exact-search-and-compact-cursor.md) — composed exact tiers with a compact authenticated cursor and no visitor state
- [ADR 0031](0031-retained-hot-publication-continuity.md) — retained-hot publication continuity from indexed immutable head history
- [ADR 0032](0032-local-named-query-service-binding.md) — local API-to-query named service binding and actual multi-Worker JSRPC proof
- [ADR 0033](0033-provider-eligibility-filtering.md) — model/variant search membership filtered by independent active non-stale provider eligibility
- [ADR 0034](0034-canonical-family-filtering.md) — model/variant exact-search membership filtered by canonical family identity without a schema change
- [ADR 0035](0035-canonical-family-model-variant-publication-closure.md) — bounded persisted-publication closure for ModelFamily, Model, and Variant relationships
- [ADR 0036](0036-publication-pinned-dataset-metadata.md) — publication-pinned public dataset metadata through the storage-free API and SELECT-only query service
- [ADR 0037](0037-stale-offering-eligibility-filtering.md) — explicit stale Offering eligibility across exact Model/Variant search without provider-derived ordering
- [ADR 0038](0038-publication-pinned-model-detail-read-seam.md) — publication-pinned stable-ID Model detail read seam without public routing
- [ADR 0039](0039-publication-model-slug-projection-core.md) — schema-neutral publication Model-slug ownership and proof derivation
- [ADR 0040](0040-canonical-model-slug-history-capture.md) — drained canonical Model-slug history capture and saga handoff
- [ADR 0041](0041-model-slug-sidecar-archive-and-staging.md) — locked content-addressed Model-slug sidecar and dormant serving staging
- [ADR 0042](0042-model-slug-lifecycle-authority.md) — archive-bound Model-slug seal, readiness v5, and exact-generation lifecycle authority
- [ADR 0043](0043-byte-authentic-publication-recovery.md) — byte-authentic base publication archive and isolated rebuild prerequisite
- [ADR 0044](0044-public-model-detail-http-cache.md) — public Model detail HTTP semantics, stable-ID-only Cache API, and response admission
- [ADR 0045](0045-publication-bound-embedding-recovery.md) — proposed publication-bound byte-authentic embedding recovery; product-owner `BE-011` decision pending
- [ADR 0046](0046-inert-preview-topology-and-split-authority.md) — proposed inert preview topology, dedicated account, and split future authority
- [ADR 0047](0047-api-query-environment-continuity.md) — validated API-to-query deployment-environment continuity
- [ADR 0048](0048-unrouted-model-detail-protected-runtime.md) — exact protected local Model-detail runtime assembly without public routing
- [ADR 0049](0049-public-methodology-detail.md) — exact historical methodology metadata over a dedicated publication-context read and shared immutable registry
- [ADR 0050](0050-gdpr-accountability-readiness.md) — deterministic pending-only GDPR accountability readiness without engineering compliance authority
- [ADR 0051](0051-signed-frontend-api-metadata.md) — signed identity-free frontend-to-API metadata reads and SSR publication state
- [ADR 0052](0052-publication-pinned-frontend-model-detail.md) — publication-pinned identity-free frontend Model-detail read without public API routing
- [ADR 0053](0053-publication-pinned-exact-model-discovery.md) — publication-pinned local exact Model discovery without public API routing or partial Model cards
- [ADR 0054](0054-canonical-model-card-projection.md) — canonical exact Model-card projection from already-read Models without N+1 reads
- [ADR 0055](0055-publication-pinned-exact-variant-cards.md) — publication-pinned local exact Variant cards from already-read canonical Variants
- [ADR 0056](0056-offering-relationship-closure.md) — bounded persisted-content hard cutover for complete Offering relationship closure
- [ADR 0057](0057-selection-free-offering-observation-set.md) — byte-authentic selection-free Offering observation sets with Provider display evidence closure
- [ADR 0058](0058-dormant-unbound-publication-workflow-planner.md) — actual unbound PublicationWorkflow class with a pure scheduled-occurrence planner and no execution authority
