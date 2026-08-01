# Design documentation

This directory contains implementation decisions derived from the approved product requirements. It must not redefine product goals or silently weaken requirements.

## Primary artifact

[`system-design.md`](system-design.md) is the design baseline. It remains unapproved until its acceptance checklist is complete and the product owner explicitly approves it.

## Design rules

- Trace each component and consequential behavior to PRD requirement IDs.
- Clearly separate facts, decisions, assumptions, constraints, open questions, and rejected alternatives.
- Record hard-to-reverse or cross-cutting decisions as ADRs under `docs/decisions/`.
- Verify current Cloudflare APIs, limits, pricing, compatibility requirements, and Wrangler configuration before relying on them.
- Do not write application code merely to make an undecided architecture appear settled. Small disposable proofs may be proposed, but require explicit approval before creation.
- Preserve the PRD's neutrality, evidence, privacy, security, accessibility, publication, and public-access invariants.

