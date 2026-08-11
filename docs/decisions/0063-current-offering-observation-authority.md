# ADR 0063: Require manifest-bound claim authority before current Offering selection

- Status: Accepted design constraint; implementation pending
- Date: 2026-08-11
- Decision owners: Staff engineer, product/data architecture reviewer, security/privacy reviewer
- Related requirements: `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-061`, `PIPE-020`–`PIPE-022`, `PIPE-039`–`PIPE-039B`, `RULE-010`–`RULE-017`, `API-002A`, `BE-005`, `BE-011`, `QA-006`, `QA-010`, `QA-012`
- Extends: ADRs 0004, 0010, 0015, 0018, 0056, and 0057
- Supersedes: None

## Context

ADR 0057 preserves every Price, PrecisionObservation, and applicable EvidenceSummary for an Offering but deliberately provides no current-value authority. A reviewed Phase 5Y-C prototype attempted to derive that authority from `EvidenceSummary.source_type`, subject, field, value, and observation time.

Independent data-neutrality, architecture, and security reviews rejected that boundary. `EvidenceSummary.source_type` is an extensible public label. The Phase 5Y-B trusted manifest proves exact persisted bytes, relationship closure, and evidence-reference/subject agreement, but it does not prove that a source belongs to the Offering's Provider, appears in the approved source register, passed the applicable deterministic/independent verification policy, or was assigned a precedence class by canonical claim authority. A mislabeled summary could therefore be promoted into a current public fact.

The prototype was removed before commit. This ADR records the missing authority rather than weakening source provenance or silently treating a label as proof.

## Decision

### Evidence summaries are not selection authority

No current Price or serving/component-precision selector may derive source control, verification state, policy admission, or precedence from `EvidenceSummary.source_type`, `source_owner`, URL, or locator alone. Those fields remain public provenance summaries, not capability tokens.

Phase 5Y-B remains selection-free and unbranded with `claim_authority = "unproven"`. Stable-ID order, set hashes, and its inventory hash authenticate retained content but do not authorize a current fact.

### Required manifest-bound authority artifact

Before current Offering selection, a successor publication-format decision must define one bounded, immutable `OfferingClaimAuthorityArtifact` generated from the exact canonical publication input. For every Price and PrecisionObservation candidate it must bind at least:

- publication ID, candidate resource type/ID/content hash, Offering ID, Provider ID, and exact Offering/component applicability;
- canonical claim ID, observation ID, evidence ID or verified evidence bundle, and source-register/source-endpoint identity;
- exact field group, value state, raw and normalized value commitments, effective interval, observation time, and supersession/conflict state;
- the versioned field-specific source-precedence policy, assigned precedence class, verification state, and required deterministic/independent verification receipt;
- approved source-register version and artifact hash matching the Provider slice; and
- one domain-separated artifact root included in the immutable publication closure, readiness proofs, backup/restore inventory, and rebuild equality checks.

The artifact must be derived before serving projection from fenced provenance authority, not reconstructed from public summaries. Its source vocabulary must use the closed adapter contract (`provider_api`, `authenticated_catalog`, `public_static_page`, `public_rendered_page`, and `publisher_checkpoint_repository`) plus only later contract-versioned additions. Field-specific policy determines which of those types can establish exact Offering price or serving precision; source type alone never does.

The artifact format must account for every candidate exactly once and remain bounded under the accepted 100,000-resource/500,000-membership envelope without JavaScript argument-spread or unbounded temporary collections. A valid artifact is still not current selection; it is the trusted input to that later deterministic policy.

### Later current-selection policy

Only after the artifact is implemented may a selector:

1. use the trusted manifest generation time, never caller or wall-clock time;
2. validate exact applicability, artifact integrity, verification, and policy authority;
3. apply field-specific precedence before recency;
4. apply half-open Price effective intervals;
5. keep Price roles/classes/currencies/conditions and precision summary/component scopes separate;
6. preserve equal-authority material disagreement as explicit unknown/conflict; and
7. emit one receipt for every candidate, including ineligible, not-effective, superseded, corroborating, selected, and conflict-member states.

Component-scoped precision must be supported by the exact matching component claim and evidence; summary or sibling components cannot fill it. Material equality must include effective intervals and every consumed Fact's own observation time. Any nested Fact or evidence time after the publication boundary fails closed.

### Explicit deferrals

This decision does not choose the artifact's durable schema/version family, D1/R2 representation, writer transaction/saga, readiness/switch suffix, backup format, or query representation. Those hard-to-reverse choices require the next implementation ADR and complete migration/cutover review.

It implements no selector, comparison row, Offering Facts projection, D1 reader, RPC, API/OpenAPI, UI, source access, remote configuration, migration, provisioning, publication, deployment, or release authority. All mapped traceability rows remain unchanged.

## Consequences

- The comparison path has an explicit prerequisite instead of an unsafe evidence-label shortcut.
- Canonical verification and precedence remain the authority; public evidence summaries remain explanatory projections.
- Publication closure, backup, and restore must eventually carry and reproduce current-selection authority, increasing the scope of the next format cutover.
- Product-facing comparison remains blocked until this authority and the later selector are implemented and reviewed.

## Alternatives considered

- **Trust `EvidenceSummary.source_type`:** rejected because the label is extensible and not proof of provider ownership, source approval, verification, or precedence.
- **Require only matching provider name or URL host:** rejected because display names are not identities and approved API/catalog hosts may differ from an official-site host.
- **Treat the adapter manifest as sufficient at query time:** rejected because the selected publication must remain self-contained, versioned, restorable, and reproducible independently of deployed code drift.
- **Select latest and retain evidence afterward:** rejected because applicability, verification, and precedence must precede recency.
- **Continue the prototype as non-public code:** rejected because a trusted-looking local type would invite accidental promotion and would not close a release dependency.

## Validation required by the successor

- Exact canonical claim/scope/observation/evidence/policy/source-register binding and artifact hashing.
- Missing, forged, wrong-Provider, wrong-source, wrong-policy, generative-only, future-dated, sibling-component, and equal-authority conflict cases.
- Full candidate accounting, permutation stability, deterministic rebuild, backup/restore equality, and accepted-bound Worker tests.
- Independent data-neutrality/correctness, security/privacy, and architecture review before any current-fact authority is exposed.
