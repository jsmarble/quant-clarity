# Phase 5C: provider-name NUL contract and storage boundary

| Attribute | Value |
|---|---|
| Status | Implemented locally; deployed acceptance remains pending |
| Decision | [ADR 0022](../decisions/0022-forbid-nul-provider-display-names.md) |
| Requirements | `DATA-060`, `SRCH-002`, `SRCH-006`, `SRCH-009`, `PIPE-033`, `PIPE-039A`, `PIPE-044`, `BE-005`, `BE-011`, `SEC-005`, `SEC-007`, `QA-001`, `QA-005`, `QA-006` |

## Slice boundary

This slice resolves only the Phase 5B U+0000 mismatch. A known, evidence-backed
canonical provider display name and an exact provider-name query may not contain
U+0000. It does not ban other Unicode controls, sanitize provider text, change
`exact-search-normalization@1`, infer a replacement name, or add a public route.

The canonical schema, generated contract artifact, and shared Worker-safe
validator reject U+0000 before projection construction. The exact provider-name
reader rejects it before normalization or D1. Errors remain static and do not
echo or retain input.

## Serving migration 0008

Migration 0008 accepts only serving schema `1.5.0`, validates existing state,
adds insert-time `instr(CAST(... AS BLOB), CAST(char(0) AS BLOB)) = 0` guards
for provider projection `display_name` and `normalized_name`, preserves the
canonical-resource applicability check, and advances the physical serving
schema to `1.5.1` last.
It performs no data repair or publication rewrite. Any pre-existing mismatch
fails atomically and leaves schema `1.5.0` and the last-known-good head intact.

Serving schema `1.5.1` is not the canonical/public schema-contract version,
publication manifest version, adapter contract version, projection version, or
normalization version. None of those objects receives `1.5.1`.

## Implementation and verification plan

1. Add the exact U+0000 exclusion to `ProviderSchema`, generated contracts, and
   the shared scalar-aware validator; test known/unknown, placement, BMP/astral
   boundaries, and unchanged non-NUL Unicode acceptance.
2. Reject U+0000 in the closed exact-provider query input before normalization
   and D1; test zero database calls and static non-echoing errors.
3. Add migration 0008 with clean-state preflight, ordinary insert guards, the
   canonical-resource applicability guard, and last-step `1.5.1` metadata.
4. Prove atomic retryability on corrupt legacy state in portable SQLite and
   confirm the migration is limited to its trigger and schema-metadata change;
   prove the clean migration and insert guards in real workerd/D1; then re-run
   projection, readiness, switch, rollback, reader, Unicode-conformance,
   privacy, and full local/CI-equivalent gates.

The implementation and all local/real-workerd evidence above pass as of
2026-08-02. Remote D1 and deployed acceptance remain gated with the rest of the
release environment.

## Non-claims and traceability

This design authorizes no Cloudflare resource, binding, deployment,
provisioning, or production-data operation. It does not complete public search,
historical status selection, model/variant tiers, aliases, API/query RPC,
visitor-canary audits, or deployed acceptance. Every linked requirement remains
at its existing traceability status: `DATA-060` and `QA-001` remain
`Implemented`; the other mapped requirements remain `Planned` until their
complete acceptance evidence exists.
