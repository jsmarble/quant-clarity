# Phase 5Y-H2d-c: Connected document digest cascade

| Field | Value |
| --- | --- |
| Status | Locally implemented dormant review evidence; external/repository anchors, semantic-oracle closure, migration/D1 parity, accepted limits and authority remain pending |
| Governing decision | [Proposed ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Requirements | DATA-060, PIPE-033, PIPE-040, PIPE-050, BE-005, SEC-005, PRIV-001 |

## Outcome

The generated `provenance-v2-connected-document-cascade-vectors@1` artifact applies all 31 checked H2d-b document-value occurrences to the immutable 371-row H2a graph: 30 lowercase SHA-256 commitments and one typed null with no hash preimage. The baseline graph remains unchanged. The additive overlay records every target row/field and its exact before/after tag and value.

Independent Node and real-workerd implementations then execute the acyclic dependency graph in the required order:

1. hash all independent graph leaves after the 29 non-successor document commitments and the typed-null check;
2. resolve the three previously defined row/collection links;
3. recompute the five Provider child collections and source-register receipt;
4. construct and JCS-hash the successor manifest from those computed claims;
5. inject that computed successor digest into the adapter receipt before hashing it;
6. recompute all 371 leaf outputs, 386 projections, nine collections and four plan roots;
7. insert the successor and four roots into the final 47,485-byte canonical synthetic document and verify its 12 dense chunks; and
8. compose a document-bound 22-field synthetic authority frame and six-field refused receipt.

The tests also mutate one document-derived owner commitment and prove the change reaches the successor hash, adapter receipt, adapter collection, leaf manifest, authority frame and refused receipt while the unrelated verifier-policy root remains unchanged. Caller order, stored successor values and stored roots never drive the recomputation.

## Authority boundary

This is synthetic in-memory review evidence, not a registrar, semantic oracle, close, approval or public fact. The artifact is permanently shaped as `review_candidate`, `authority_eligible: false`, `outcome: authority_refused`, `persisted: false`, `retained_resolver_executed: false` and `semantic_oracle_executed: false`. It adds no Worker handler, route, binding, D1 operation, migration, remote resource, writer, seal, approval, permit, source effect, log, trace, telemetry or deployment surface.

The final document's document-visible digest-output fields are still synthetic claims because no complete document-to-normalized-output projection registry exists. The artifact therefore does not claim normalized plaintext/semantic parity. Its `371` normalized-row value is an artifact-local inventory count, not migration 0010's eventual normative metric, and `root_input_bytes` remains undefined for authority purposes. Ten external/repository inputs remain opaque.

## Remaining gates

Before any authority-capable implementation, the project still needs:

- exact external approved-row and repository-artifact resolvers plus a reviewed build manifest;
- a complete document-to-normalized-output projection and independent semantic oracle covering endpoint, owner, credential, tuple, policy, verifier and interval closure;
- normative normalized-row and root-input-byte accounting;
- migration 0010 schema/guard parity, frozen fresh-primary D1 enumeration and retained-row execution;
- accepted workerd/D1 aggregate, CPU and memory evidence; and
- protected registration, close, oracle-receipt, seal, approval, revocation and bundle-opening writers.

No requirement status advances in this phase.
