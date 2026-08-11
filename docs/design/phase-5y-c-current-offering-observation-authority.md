# Phase 5Y-C: Manifest-bound Offering claim authority prerequisite

| Attribute | Value |
|---|---|
| Status | Design constraint accepted; prototype rejected and implementation pending |
| Decision | [ADR 0063](../decisions/0063-current-offering-observation-authority.md) |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-061`, `PIPE-020`–`PIPE-022`, `PIPE-039`–`PIPE-039B`, `RULE-010`–`RULE-017`, `API-002A`, `BE-005`, `BE-011`, `QA-006`, `QA-010`, `QA-012` |

## Objective

Close the authority gap between Phase 5Y-B's complete public observation bytes and a future deterministic current-fact selector. Public EvidenceSummary labels must never substitute for canonical verified claim, approved source-register, applicability, and precedence authority.

## Review outcome

The first prototype correctly attempted publication-time evaluation, precedence before recency, half-open Price intervals, scope separation, explicit conflict, nominal in-memory authority, and complete candidate receipts. Three independent reviews nevertheless found one blocking architectural defect: the persisted publication does not carry the canonical authority needed to prove that an EvidenceSummary source is provider-controlled, approved, verified, and assigned the applicable field-specific precedence class.

The prototype also exposed required successor cases for nested Fact times, exact component evidence, material effective-interval equality, closed source vocabulary, accepted-bound iteration, and non-bypassable nominal construction. No prototype code or tests remain in the branch.

## Required next implementation boundary

1. Design a versioned `OfferingClaimAuthorityArtifact` derived from fenced canonical claim/source-policy authority.
2. Bind every Price and PrecisionObservation to exact Offering/Provider/applicability, claim/observation/evidence, approved source-register, verification, policy, precedence, value, time, and conflict state.
3. Include the artifact root in immutable publication closure, readiness/switch proofs, backup/restore, and deterministic rebuild.
4. Add bounded controlled persistence and exact reconstruction proof under a reviewed publication-format cutover.
5. Only then implement nominal current selection and comparison projection.

## Explicit deferrals

Artifact schema/version, migration, writer, readiness/switch proof family, restore cutover, current selector, comparison rows, Offering Facts, API/UI, source access, remote resources, deployment, and release acceptance remain pending. Every traceability row retains its current status.
