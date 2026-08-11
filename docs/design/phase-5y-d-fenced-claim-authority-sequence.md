# Phase 5Y-D: Fenced claim-authority implementation sequence

| Attribute | Value |
|---|---|
| Status | Sequenced; provenance-v2 is next, while artifact/lifecycle work awaits the ADR 0045 owner decision |
| Decision | [ADR 0064](../decisions/0064-sequence-fenced-claim-authority-cutover.md) |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-061`, `PIPE-020`–`PIPE-022`, `PIPE-039`–`PIPE-039C`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `RULE-010`–`RULE-017`, `BE-005`, `BE-011`, `SEC-011`, `SEC-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `OPS-006`, `OPS-008`, `QA-006`, `QA-010`, `QA-012` |

## Outcome

Repository and independent-review audits prove the current canonical graph is not sufficient authority for the ADR 0063 artifact. The graph lacks typed precedence-policy content, immutable verification receipts, reproducible approved endpoint identity, complete public-field commitments, and a provenance-v2 coordination fence. Fireworks remains source-approval pending and production-disabled; fixtures are not release authority.

No artifact codec or selector is safe before those inputs exist. The accepted implementation sequence is:

1. provenance-v2 normalized source endpoints, typed policies, verification receipts, projection commitments, and complete conflict/supersession accounting;
2. bounded private claim-authority artifact and trusted controlled projection;
3. cumulative manifest/serving/readiness/backup/restore cutover coordinated with ADR 0045;
4. deterministic current Price and precision selection; and
5. neutral comparison transport and presentation.

## Provenance-v2 implementation entry criteria

- An accepted schema/writer ADR permits dormant installation in pristine and isolated-recovery databases but admits no authority row, source execution, or trusted minting until the initialized coordination environment, legacy-graph quiescence, all initialization-gated guards, and the current fence are proven.
- Source endpoint, policy, receipt, commitment, conflict, and supersession contracts have closed bounded representations.

## Artifact and lifecycle entry criteria

- Product owner resolves proposed ADR 0045's `BE-011` interpretation.
- A successor ADR assigns one cumulative serving schema, closure domain, lifecycle, recovery family, and explicit first-generation rollback transition.
- Protected object/backup access-audit design covers reads and writes without treating native R2 account Audit Logs as object-access evidence.

Until then, comparison, Offering Facts, source activation, real Provider data, public/remote behavior, provisioning, deployment, and every mapped traceability advancement remain blocked.
