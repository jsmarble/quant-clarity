# Design documentation

This directory contains implementation decisions derived from the approved product requirements. It must not redefine product goals or silently weaken requirements.

## Primary artifact

[`system-design.md`](system-design.md) is the approved design baseline. Product-owner approval and the zero-visitor-data amendment were recorded on 2026-08-01; implementation evidence remains separate.

## Design rules

- Trace each component and consequential behavior to PRD requirement IDs.
- Clearly separate facts, decisions, assumptions, constraints, open questions, and rejected alternatives.
- Record hard-to-reverse or cross-cutting decisions as ADRs under `docs/decisions/`.
- Verify current Cloudflare APIs, limits, pricing, compatibility requirements, and Wrangler configuration before relying on them.
- Implement only accepted decisions and preserve explicit unresolved compatibility or legal gates rather than silently changing product semantics.
- Preserve the PRD's neutrality, evidence, privacy, security, accessibility, publication, and public-access invariants.
