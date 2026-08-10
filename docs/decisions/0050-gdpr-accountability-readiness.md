# ADR 0050: Keep GDPR accountability readiness deterministic and pending-only

- Status: Accepted for local implementation
- Date: 2026-08-10
- Decision owners: Staff engineer, privacy and security lead, product owner; final gate authority remains the authorized legal/product owner
- Related requirements: `SEC-012`, `PRIV-005`, `PRIV-008`, `PRIV-009`, `PRIV-010`, `LEG-005`; `REL-AC-19` is noted only for the open mapping question below
- Extends: ADRs 0011 and 0014

## Context

The approved GDPR release gate combines engineering evidence with decisions that software cannot make. Source, configuration, browser, and network checks can prove the zero-visitor-data design. They cannot identify the controller, select a lawful basis, accept processor or transfer terms, decide territorial scope or DPIA/DPO/representative duties, approve a rights procedure, or certify legal compliance. Those decisions remain with an authorized legal/product owner.

The repository already contains a release-blocked working privacy page and three public-safe compliance drafts. Before this decision, their pending state and integrity were documented only in prose. The predeployment and privacy checks did not maintain a deterministic inventory of the exact accountability scope, reviewed draft bytes, or missing owner evidence. This left room for accidental drift or an engineering-only claim without changing the underlying approved requirements.

## Decision

### Pending-only manifest

Add [`config/gdpr-accountability.json`](../../config/gdpr-accountability.json) as the closed, public-safe version-1 readiness manifest for `GATE-gdpr-accountability`. Its exact scope is:

- `LEG-005`;
- `PRIV-005`;
- `PRIV-008`;
- `PRIV-009`;
- `PRIV-010`; and
- `SEC-012`.

Version 1 is deliberately incapable of representing approval. It requires `status="release_blocked"` and keeps `gate_passed`, `release_authorized`, and `compliance_claim_allowed` false. The owner role is fixed to `authorized_legal_product_owner`, and review cadence remains annual and on material change with a maximum 366-day interval. The manifest is an integrity and missing-evidence inventory, not the signed accountability packet or a release decision.

The manifest binds the exact bytes of four tracked, regular, non-symlink public artifacts by lowercase SHA-256:

- the Astro working privacy page;
- the GDPR accountability evidence index;
- the release-blocked privacy-notice draft; and
- the public-safe processing-record draft.

Each artifact is bounded to 256 KiB and their aggregate is bounded to 1 MiB. The hashes protect reviewed pending content from silent drift; they do not make that content legally complete or suitable for production.

### Closed missing-evidence categories

The code-owned version-1 inventory contains exactly six categories:

1. draft privacy notice and formal legal contact for `LEG-005` and `PRIV-005`;
2. pending Cloudflare processor terms, transfers, subprocessors, and locations for `PRIV-008`;
3. draft processing record and legal determinations for `PRIV-009`;
4. pending rights-request procedure for `PRIV-010`;
5. pending restricted and audited evidence access for `SEC-012`; and
6. pending authorized-owner sign-off over the complete scope.

Every private approval reference, approval date, and next-review date remains null. Confidential agreements, personal contact records, identity documents, correspondence, account identifiers, and private legal or security material stay outside the public repository. A future approved state requires a separately reviewed successor schema and authority; changing version-1 values cannot authorize it.

### Fail-closed checker

`npm run gdpr-accountability:check` runs the standalone checker. Before reading, it requires the manifest and artifacts to be tracked regular non-symlink files and preflights their individual and aggregate sizes. It then accepts at most 65,536 bytes of strict UTF-8 JSON; rejects comments, trailing commas, duplicate properties, hostile prototypes/accessors, additive or reordered authority, unsafe paths, digest drift, missing or oversized artifacts, altered release-blocker copy, explicit pending-state compliance/approval claims, scope drift, and any non-`Planned` status for the six mapped traceability rows.

The checker also requires the predeployment policy and inert preview plan to keep deployment unauthorized and requires the preview plan's `legal_privacy_review` blocker. It is included in `npm run verify`; the predeployment policy pins the resulting root package-script authority. Passing proves only that the repository honestly and deterministically remains release-blocked.

The technical `privacy:check` remains separate. It scans source, built artifacts, browser capabilities, and Worker configuration for prohibited visitor-data collection and telemetry. Neither technical privacy checks nor the pending-only accountability checker can pass `GATE-gdpr-accountability`. That gate still requires current internally consistent owner-approved records, a signed accountability packet, and the deployed privacy-notice hash defined by the verification plan.

### Requirements and release authority

This ADR implements the approved requirements without changing them. It does not amend the PRD or decision log, finalize the privacy page or compliance drafts, create a legal-contact system, approve DPA/transfer terms, determine legal duties, authorize deployment, or advance evidence or traceability. The version-1 verification-artifact registry is unchanged because it represents local `Implemented` evidence while every accountability row remains `Planned`.

## Consequences

- Reviewed pending accountability content and exact missing categories become deterministic and fail closed on drift.
- Engineering can prove that approval is absent without pretending to supply that approval.
- Technical zero-visitor-data evidence remains independently testable and cannot be confused with controller accountability.
- Any owner-approved or deployed state must replace version 1 with a separately reviewed successor authority rather than retaining or editing the permanently blocked manifest.
- Changes to any hash-bound draft require explicit manifest review and digest renewal.

## Alternatives considered

- **Treat `privacy:check` as GDPR acceptance:** rejected because technical absence of visitor storage cannot make legal or controller decisions.
- **Record signed agreements and personal contact material in Git:** rejected because the public repository is not the approved private legal/operations system.
- **Allow version 1 to carry approval fields:** rejected because no authorized owner identity/signature authority or deployed-notice evidence exists.
- **Add the rows to `config/verification-artifacts.json`:** rejected because its version-1 authority is limited to local `Implemented` test-source anchors and the accountability rows remain `Planned`.
- **Finalize the working notice as part of this slice:** rejected because its release blockers require authorized owner decisions and deployed-behavior review.

## Open question

The `REL-AC-19` traceability text lists `PVT-PRIV-001` through `PVT-PRIV-012`, including referral requirement `PVT-PRIV-012`. Its current verification-plan mapping names only `GATE-zero-visitor-data` and `GATE-gdpr-accountability`; neither gate contains `PVT-PRIV-012`, which is instead part of `GATE-referral-zero-tracking`. This document records the mismatch only. It does not remove `PRIV-012`, add a gate to the coordinator, reinterpret the release criterion, or amend the PRD. `REL-AC-19` remains `Planned` pending an authorized clarification.

## Validation

- Prove the strict manifest byte, JSON, duplicate-key, closed-object-schema, code-owned array-order, path, hash, per-artifact, and aggregate bounds.
- Prove every scope and evidence-category mutation, non-null approval field, true authority flag, compliance claim, or non-`Planned` trace status fails.
- Prove each reviewed public artifact is tracked, regular, non-symlinked, hash-identical, and still declares its pending/release-blocked state.
- Prove deployment remains unauthorized in both predeployment and preview authorities and that `legal_privacy_review` remains pending.
- Prove the standalone check is part of `verify` and its package-script authority is pinned by the predeployment policy.
- Keep `SEC-012`, `PRIV-005`, `PRIV-008`, `PRIV-009`, `PRIV-010`, `LEG-005`, `REL-AC-19`, and every composite gate `Planned`.
