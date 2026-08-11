# Phase 5Y-E: Fenced provenance-v2 authority design

| Field | Value |
|---|---|
| Status | Designed; first guarded schema/writer increment is next |
| Decision | [ADR 0065](../decisions/0065-fenced-provenance-v2-authority.md) |
| Requirements | `DATA-008`, `DATA-009`, `DATA-021`, `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-061`, `PIPE-010`–`PIPE-022`, `PIPE-030`–`PIPE-045`, `PIPE-050`–`PIPE-056`, `RULE-010`–`RULE-017`, `BE-005`, `SEC-011`, `SEC-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `OPS-006`, `OPS-008`, `QA-006`, `QA-010`, `QA-012` |

## Outcome

The provenance-v2 trust boundary is implementable without inventing publication authority. One immutable Provider bundle is bound to the exact admitted run and current fence. Normalized endpoint, policy, observation, evidence, claim, verification, resolution, conflict, supersession, and projection rows remain inert until an exact closure seal proves the whole set.

This preserves unknowns and complete historical audit data while preventing partial batches, stale leases, caller labels, fixture approvals, or legacy rows from becoming current-fact authority. The graph stores commitments and approved private references, never authenticated payloads, credentials, unsafe locators, or visitor-derived data.

## Implementation slices

1. Exact-predecessor migration, static capability, empty protected installation identity, dormant authority-plan/bundle/permit/response shapes, unconditional approval/open/permit/response/effect blockers, and refusal tests.
2. Protected normalized source endpoint, exact owner identity, adapter-manifest receipt, field/verifier-policy roots, plan approval, and guarded bundle opening.
3. Fenced observation, evidence, claim, and verification chunks with structural same-bundle/fence admitted-response dependencies; every effect remains blocked.
4. Exhaustive eligibility, conflict/supersession, and candidate-field commitments without current selection.
5. Bounded acquisition permits, redacted-object verification, bundle seal, root oracle, adversarial closure tests, and separately reviewed source-backed roster-outcome activation.

Every slice stays dormant until slice 5. No source request, trusted artifact, public route, remote resource, or deployment is part of this phase.

## Review gates

- Architecture: exact predecessor and fence ownership, append-only staging, bounded D1 protocol, no competing lifecycle generation.
- Data integrity: typed vocabularies, verification independence, complete resolution/conflict/supersession, and Price/PrecisionObservation projection coverage.
- Security/release: allowlist commitments, permission validity, credential/payload exclusion, zero visitor data, stale-writer races, and no premature activation.

The existing run-plan policy root is not provenance authority, `AdapterManifest@1` is not a sufficient manifest commitment, and unfenced legacy Offering rows are not trusted subjects. Slice 1 installs blocked shapes only; it cannot approve nominal roots or open bundles. Stable Offering IDs await a protected successor identity registry, and current-fact selection remains after the artifact cutover.

The next independently publishable change is slice 1. Its plan approval, bundle opening, acquisition, and source-effect paths are unconditionally blocked, and it must leave migration 0006's source-backed roster-outcome blocker intact.
