# Phase 5R: Deterministic GDPR accountability readiness

| Attribute | Value |
|---|---|
| Status | Local pending-only implementation; authorized-owner, deployed-notice, and release evidence remain pending |
| Decision | [ADR 0050](../decisions/0050-gdpr-accountability-readiness.md) |
| Requirements | `SEC-012`, `PRIV-005`, `PRIV-008`, `PRIV-009`, `PRIV-010`, `LEG-005`; `REL-AC-19` open question only |
| Release gate | Local integrity prerequisite to `GATE-gdpr-accountability`; every mapped row remains `Planned` |

## Objective

Make the repository's incomplete GDPR-accountability state deterministic and fail closed without supplying legal decisions or claiming compliance. Preserve the technical zero-visitor-data gate as a separate control and keep production release blocked until the authorized legal/product owner supplies the complete current accountability packet and deployed-notice evidence.

## Implemented boundary

This slice adds:

1. one strict pending-only manifest at [`config/gdpr-accountability.json`](../../config/gdpr-accountability.json);
2. one code-owned validation policy with hostile-input unit tests;
3. one standalone repository checker exposed as `npm run gdpr-accountability:check` and included in `npm run verify`;
4. exact digest authority for the working privacy page and three public-safe compliance drafts; and
5. an exact six-category inventory of draft, pending, and missing owner evidence.

Before any file read, the checker requires the manifest and four public artifacts to be tracked regular non-symlink files and preflights their individual and aggregate sizes. The manifest is limited to 65,536 bytes of strict UTF-8 JSON. It has an exact closed object schema and code-owned array order, rejects duplicate properties and additive authority, and contains the exact six requirement IDs owned by `GATE-gdpr-accountability`. The public artifacts must match their lowercase SHA-256 digests, remain within 256 KiB each and 1 MiB combined, retain their explicit working/draft/release-blocked copy, and contain no explicit pending-state compliance or approval claim.

## Pending-only state machine

Version 1 has exactly one legal/release state: blocked. It requires:

- `status="release_blocked"`;
- `gate_passed=false`;
- `release_authorized=false`;
- `compliance_claim_allowed=false`;
- the authorized legal/product owner role and annual/material-change review cadence;
- exact `draft` or `pending` state for every code-owned evidence category; and
- null private approval reference, approval date, and next-review date for every category.

The checker rejects a claim that any category, gate, release, or compliance state is approved. A separately reviewed successor schema must replace this permanently blocked version and define the protected authorized-owner and deployed-notice authority before any approved value can be represented. Confidential evidence remains in the approved private legal/operations system.

## Accountability inventory

| Category | Requirements | Version-1 state | Later gate evidence |
|---|---|---|---|
| Privacy notice and formal contact | `LEG-005`, `PRIV-005` | Draft | Controller-approved final notice, formal contact, deployed URL/hash |
| Cloudflare processor review | `PRIV-008` | Pending | Current DPA, transfers, subprocessors, locations, dated owner review |
| Processing record and determinations | `PRIV-009` | Draft | Complete RoPA, lawful bases, retention, security, DPIA/DPO/representative decisions |
| Rights procedure | `PRIV-010` | Pending | Jurisdiction-appropriate intake, verification, deadlines, and no-data procedure |
| Restricted/audited evidence access | `SEC-012` | Pending | Protected identities, access policy, and audited remote evidence |
| Authorized owner sign-off | Complete scope | Pending | Signed accountability packet and current review schedule |

The checker additionally requires `deployment_authorized=false` in the predeployment policy, the same false authority in the inert preview plan, and the preview plan's `legal_privacy_review` blocker. These are negative authority checks, not proof that a later deployed environment complies.

## Separate technical and legal gates

`privacy:check` remains the technical zero-visitor-data control. It detects prohibited public logging, tracing, analytics, cookies, browser persistence, AI/persistence bindings, visitor-derived values, and related source/configuration/build drift. `gdpr-accountability:check` instead validates the exact pending accountability inventory and absence of owner authority. Passing either or both local commands does not pass `GATE-gdpr-accountability`.

Only the verification plan's authorized legal/product owner can accept the current DPA/transfer/subprocessor/data-location review, controller/contact, processing record, lawful bases, retention, rights and security records, duty determinations, signed accountability packet, and deployed-notice hash. No engineering agent or CI result can substitute for that acceptance.

## Local acceptance evidence

Focused tests must prove:

- valid strict manifest parsing and exact current repository validation;
- the 65,536/65,537-byte manifest boundary, malformed UTF-8/JSON, duplicate keys, comments, and trailing commas;
- hostile object, array, accessor, proxy, extra/missing object field, reordered authority array, unsafe path, hash, inventory, status, scope, date, and approval mutations fail closed;
- missing, untracked, symlinked, changed, oversized, or unmarked public artifacts fail closed;
- every mapped traceability row must remain `Planned`;
- predeployment/preview authority remains false and the legal/privacy blocker remains present; and
- the root script and `verify` integration remain protected by the predeployment package-manifest digest.

This is local integrity evidence only. It does not advance any mapped traceability row or composite gate.

## Open question and non-claims

`REL-AC-19` names `PVT-PRIV-001`–`PVT-PRIV-012` in its concrete evidence, but its current verification-plan coordinator mapping omits the referral gate that owns `PVT-PRIV-012`. This phase records the text-versus-mapping mismatch without resolving it. It does not change the PRD, remove `PRIV-012`, or add `GATE-referral-zero-tracking` to `RGA-REL-AC-19`.

This phase does not finalize or edit the privacy page or hash-bound compliance drafts, add a public form or general feedback channel, execute a DPA, choose a lawful basis, approve transfers or retention, establish a private legal-contact system, provision resources, deploy, publish, or claim GDPR compliance. `config/verification-artifacts.json` remains unchanged, and every affected requirement and release coordinator remains `Planned`.
