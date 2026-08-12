# Phase 5Y-H2e-a: Synthetic external-row resolvers

| Field | Value |
| --- | --- |
| Status | Locally implemented dormant review evidence; persisted predecessor rows, approval/revocation semantics, repository artifacts, semantic-oracle closure, migration/D1 parity, accepted limits and authority remain pending |
| Governing decision | [Proposed ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Requirements | DATA-060, PIPE-033, PIPE-040, PIPE-050, BE-005, SEC-005, PRIV-001 |

## Outcome

The generated `provenance-v2-external-row-resolver-vectors@1` artifact freezes all seven `external_row_digest` programs in the reviewed root-binding plan. Six programs resolve fields already present in the 371-row H2a graph and one resolves the synthetic authority-frame run-plan hash. The exact occurrence partition is:

- five source-compliance resolutions, each requiring exact Provider/register joins plus `approval_state = approved`, access, retention and publication permission predicates;
- one publication-run-plan Provider roster resolution with exact run-plan and Provider joins; and
- one publication-run-plan seal resolution with an exact run-plan join.

The five source-compliance occurrences execute twenty predicate comparisons over four distinct predicate columns. Every resolution validates typed source and witness fields, requires exactly one matching predecessor witness, checks a lowercase SHA-256 digest and compares the independently selected digest with the stored normalized-row claim. Independent Node and actual-workerd tests derive the seven live programs from the binding plan, execute the complete join/predicate/cardinality logic without a shared resolver, ignore caller order and reject missing, duplicate, shadowed, mistyped, cross-join, predicate and digest mutations.

## Authority boundary

The three predecessor witness projections are deterministic synthetic values containing only the columns consumed by the reviewed programs, not complete, approved or persisted D1 rows. The artifact is `review_candidate`, `outcome: authority_refused`, `authority_eligible: false`, `persisted: false` and `d1_read_executed: false`. Its `synthetic_external_row_resolver_executed: true` flag describes only the bounded fixture proof. Stored digests remain comparison claims and the resolver result remains review evidence; neither can authorize registration, source access, retention, publication or a public fact.

This slice adds no Worker handler, route, binding, D1 operation, migration, repository file, build manifest, remote resource, writer, seal, approval, permit, source effect, log, trace, telemetry or deployment surface. The fixture contains no credential value, authenticated payload or visitor data and remains outside the public OpenAPI schema allowlist.

## Remaining gates

Before any authority-capable implementation, the project still needs:

- persisted predecessor-row lookup under migration-0010 scope plus complete approval, revocation and applicable-time semantics;
- all repository-artifact resolvers and a reviewed build manifest pinned to exact tracked bytes;
- complete document-output projection and the independent semantic oracle;
- normative normalized-row and root-input-byte accounting;
- migration-0010 schema/guard parity and frozen fresh-primary D1 enumeration;
- accepted workerd/D1 aggregate, CPU and memory evidence; and
- protected registration, close, oracle-receipt, seal, approval, revocation and bundle-opening writers.

No requirement status advances in this phase.
