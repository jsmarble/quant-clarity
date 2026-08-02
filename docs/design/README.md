# Design documentation

This directory contains implementation decisions derived from the approved product requirements. It must not redefine product goals or silently weaken requirements.

## Primary artifact

[`system-design.md`](system-design.md) is the approved design baseline. Product-owner approval and the zero-visitor-data amendment were recorded on 2026-08-01; implementation evidence remains separate.

The current model/variant exact-name follow-up is split by [ADR 0026](../decisions/0026-blob-model-variant-exact-search-cutover.md). [Phase 5G-A1](phase-5g-a1-model-variant-durable-proof-core.md) implements only the runtime-neutral storage-row, revision-bound staging, and dormant artifact-proof core. [Phase 5G-A2](phase-5g-a2-model-variant-search-cutover.md) locally implements the atomic D1/v3 cutover, capacity and queryability evidence, and local restore-rebuild boundary. [Phase 5G-B](phase-5g-b-model-variant-exact-reader.md) locally implements the bounded canonical reader, tier-local continuation, bookmark-continuous local RPC, internal API seam, and exact acceptance evidence. It still creates no public route or merged cursor. [ADR 0027](../decisions/0027-trusted-provider-model-id-projection.md) and [Phase 5H-A1](phase-5h-a1-provider-model-id-projection.md) define the locally implemented runtime-neutral provider-model-ID derivation. [ADR 0028](../decisions/0028-provider-model-id-durable-storage-cutover.md) and [Phase 5H-A2](phase-5h-a2-provider-model-id-storage.md) locally implement the dual-BLOB schema, bounded writer, v4 proof cutover, and restore-rebuild boundary. [ADR 0029](../decisions/0029-provider-model-id-exact-reader.md) and [Phase 5H-B1](phase-5h-b1-provider-model-id-reader.md) locally implement the literal raw-first provider-ID reader, canonical target mapping, same-witness filters, neutral tier-local order, fourth local RPC method, and internal API seam. Phase 5H-B2 owns multi-tier exact composition and its authenticated public cursor; prefix/keyword, semantic, and public route integration remain later work. Remote resources, service bindings, deployment, operational restore, complete search, full verification, and release evidence remain pending.

## Design rules

- Trace each component and consequential behavior to PRD requirement IDs.
- Clearly separate facts, decisions, assumptions, constraints, open questions, and rejected alternatives.
- Record hard-to-reverse or cross-cutting decisions as ADRs under `docs/decisions/`.
- Verify current Cloudflare APIs, limits, pricing, compatibility requirements, and Wrangler configuration before relying on them.
- Implement only accepted decisions and preserve explicit unresolved compatibility or legal gates rather than silently changing product semantics.
- Preserve the PRD's neutrality, evidence, privacy, security, accessibility, publication, and public-access invariants.
