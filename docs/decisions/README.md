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
