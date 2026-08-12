# Phase 5Y-H2d-b: Connected registration document and retained bytes

| Field | Value |
|---|---|
| Status | Locally implemented synthetic canonical-document, safe-preimage occurrence, document-count and retained-byte evidence; cascade, anchors, semantics, D1 and authority remain pending |
| Decision | [Proposed ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-030`–`PIPE-045`, `SEC-003`–`SEC-006`, `QA-006`, `QA-007`, `QA-010`–`QA-012` |

## Outcome

This slice supplies the complete synthetic document that H2d-a deliberately left out. The generated review artifact pins one closed-schema `ProvenanceV2RegistrationPlan@1`, its exact 47,485 canonical UTF-8 bytes and SHA-256, and a converged fixed point for the document-visible byte and chunk counts. Candidate inspection reports exactly the repository-pinned `benchmark_pending` authority refusal and no other structural error.

Node and actual workerd implementations independently execute the checked root-binding plan against the H2a row identities. They resolve all 31 document-value occurrences: 30 SHA-256 preimages and the one nullable parameter-pattern result that has no hashable bytes. Those occurrences produce 26 distinct digest values because the legacy manifest and endpoint path each intentionally feed three normalized rows. The count inventory contains 39 checked resolver executions plus seven explicitly enumerated zero-scope witnesses across the 27 document-backed count programs. [Phase 5Y-H2d-c](phase-5y-h2d-c-connected-document-cascade.md) now closes the safe-preimage target overlay and downstream cascade; complete document-output, scoped-count and semantic parity remain pending.

The document is split into twelve deterministic 4,096-byte-or-smaller chunks. Each chunk has a dense ordinal, contiguous offset, exact length and SHA-256. Independent reassembly proves every byte, total length and whole-document digest, then re-admits the reconstructed canonical bytes through the strict H2d-a parser. This is synthetic in-memory retained-byte evidence; it is not D1 persistence evidence.

## Exact boundary

This increment closes the schema-valid synthetic document, document-backed safe-preimage occurrence, document-count and retained-byte fixture boundaries. It does not yet overlay the 30 resolved digests onto all H2a rows or regenerate the H2b/H2c leaf, successor, collection, synthetic authority and refused-receipt cascade. That topological regeneration remains the next review slice.

The document's `normalized_rows: 371` is an artifact-local H2a inventory count, not a normative migration-0010 definition. `root_input_bytes` also lacks an approved accounting formula. Both remain machine-readable pending, as do all ten external and repository-backed anchor occurrences, the reviewed build manifest, complete independent semantic-oracle checks, migration 0010, frozen fresh-primary D1 enumeration, accepted aggregate limits and protected writers. The `.invalid` fixture host is intentionally synthetic and does not establish endpoint acquisition eligibility.

## Authority and privacy firewall

The artifact remains `review_candidate`, `authority_eligible: false`, `outcome: authority_refused`, `persisted: false`, `retained_resolver_executed: false` and `semantic_oracle_executed: false`. Document occurrence resolution and retained chunk-fixture verification are marked complete only for this bounded synthetic in-memory fixture; typed retained-row resolver execution remains pending. [Phase 5Y-H2d-c](phase-5y-h2d-c-connected-document-cascade.md) now applies these document commitments to the immutable H2a graph and independently regenerates the successor, leaf, collection, document-bound authority and refused-receipt cascade. No Worker handler, route, binding, migration, D1 operation, remote resource, seal, approval, permit, public response, source effect, log, trace, telemetry or deployment surface is added.

The fixture contains credential binding names and redacted purposes only—never credential values, Authorization contents, authenticated payloads or visitor data. The generated schema remains outside the public OpenAPI component allowlist.
