# Phase 5Y-H2c: Connected successor-manifest vectors

| Field | Value |
|---|---|
| Status | Locally implemented synthetic successor-manifest preimage and adapter-receipt parity; authority remains refused and document, anchor, semantic, migration, D1 and aggregate gates remain pending |
| Decision | [Proposed ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-030`–`PIPE-045`, `SEC-003`–`SEC-006`, `QA-006`, `QA-007`, `QA-010`–`QA-012` |

## Outcome

This slice closes the synthetic fixture parity left by [H2b](phase-5y-h2b-connected-traversal-vectors.md). The generated `provenance-v2-connected-successor-manifest-vectors@1` artifact projects all 30 required `ProvenanceV2SuccessorManifest@1` properties from the reviewed H2a normalized rows and H2b's independently recomputed eleven Provider child claims. It includes all six admitted-ceiling members, preserves the required explicit `null` extraction-policy version, validates the closed schema, and pins the exact 2,008-byte RFC 8785/JCS UTF-8 preimage and SHA-256 digest.

The H2a adapter-receipt row now stores that computed successor digest rather than a placeholder. Node and real workerd independently rebuild the manifest, canonical bytes and digest, require stored parity, and then retain H2b's independent registry leaf, typed traversal, adapter-root, synthetic authority-root and refused-receipt cascade. The affected H2b leaf manifest and frame goldens are regenerated; the endpoint, verifier-policy and field-policy roots remain byte-identical.

## Exact boundary

The projection inventory is closed and machine-readable:

- two fixed contract-version properties;
- sixteen scalar normalized-row properties from exactly scoped adapter-receipt and source-owner rows;
- six safe-integer ceiling properties nested in `admitted_run_plan_ceilings`; and
- eleven count/root/receipt properties derived from every `successor_claim_bindings` entry.

This proves one synthetic Provider fixture. It does not execute the registration-document JSON pointer, parse untrusted registration bytes, resolve the legacy manifest, roster, source-compliance or repository artifacts, or establish that normalized rows equal a retained document. Twenty-nine other safe-preimage occurrences and all ten external-anchor occurrences remain opaque comparison inputs.

## Authority and privacy firewall

The artifact remains `review_candidate`, `authority_eligible: false`, `outcome: authority_refused`, `persisted: false`, `document_resolver_executed: false` and `semantic_oracle_executed: false`. It adds no Worker handler, route, binding, D1 operation, migration, resource, log, trace, telemetry, seal, approval, permit, public response, source effect or deployment surface. It contains only synthetic identifiers and credential counts/roots; no credential value, authenticated payload or visitor information is present.

Registration-document selector and duplicate-detecting byte ingestion, retained chunks and remaining safe-preimage resolution, external/repository anchors and the reviewed build manifest, complete semantic-oracle closure, migration 0010, frozen fresh-primary D1 enumeration, accepted aggregate limits and every protected writer remain machine-readable `pending`. No requirement status advances in this slice.

## Verification

The Node implementation uses its own recursive JCS serializer, `Buffer` and `node:crypto`; the actual workerd implementation separately uses its own serializer, `TextEncoder`, `Uint8Array` and WebCrypto. They share static reviewed contracts and expected vectors, not canonicalization or hashing helpers. Tests cover complete property/binding inventory, exact bytes/hash, caller row-order invariance, stored parity, downstream cascade, null/integer/NFC/lone-surrogate boundaries, incomplete or shadowed row inventories, unresolved-input mutation, and bounded hostile artifact validation without getter execution.

[Phase 5Y-H2d-a](phase-5y-h2d-a-canonical-registration-document-resolvers.md) implements strict duplicate-detecting canonical-byte admission and the 45 checked document selector programs. H2d-b must now build the complete schema-valid document, retained-chunk reconstruction and every safe-preimage occurrence parity before approved external and repository anchors can resolve against a reviewed build manifest. Semantic-oracle closure, migration/D1 guards and accepted-scale evidence remain later gates.
