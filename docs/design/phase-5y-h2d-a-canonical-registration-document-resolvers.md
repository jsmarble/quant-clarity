# Phase 5Y-H2d-a: Canonical registration-document resolvers

| Field | Value |
|---|---|
| Status | Locally implemented strict canonical-byte and checked-selector engine evidence; H2d-b now supplies the complete synthetic document and retained occurrence evidence, while cascade and authority remain pending |
| Decision | [Proposed ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-030`–`PIPE-045`, `SEC-003`–`SEC-006`, `QA-006`, `QA-007`, `QA-010`–`QA-012` |

## Outcome

This slice implements a runtime-neutral, authority-refusing boundary for exact registration-document bytes. Admission copies a plain `Uint8Array` into an owned snapshot under a registrar-owned 1 MiB evidence ceiling before decoding, uses fatal UTF-8, rejects a BOM, detects decoded duplicate object keys before ordinary object materialization, rejects non-safe or non-integer JSON numbers, non-NFC text and lone surrogates, and requires an independent canonical serialization to equal every supplied byte. The ceiling is deliberately independent of the untrusted document's `declared_limits` and is evidence-only; it is not an accepted production aggregate limit.

The checked-in root-binding plan is the only selector program. The implementation validates dense wildcard ordinals and RFC 6901 escapes, uses exact own-property access, exact typed row/member equality, exactly-one array-object selection and bounded safe array ordinals. It distinguishes `nfc_utf8` scalar bytes from RFC 8785/JCS selected-value bytes. A nullable `pattern` resolves as typed null with no digest preimage; it is never hashed as the text `null`. The policy preimage remains a schema string, so its `rfc8785_jcs` preimage is the JCS JSON string including quotes, not parsed embedded JSON.

The generated `provenance-v2-registration-document-resolver@1` contract freezes the 18 document-value and 27 document-backed count binding inventories. Node tests execute every checked-in binding and count with constructed canonical probes. A separately written real-workerd parser, canonicalizer and selector compiler independently executes the same 45 pointer programs without importing the Node implementation.

## Exact boundary

H2d-a proves the byte codec and selector grammar, not a complete registration plan. It does not claim that a synthetic document is schema-valid or semantically eligible, does not replace H2a's remaining opaque safe-preimage hashes, and does not regenerate the H2a–H2c root cascade. Definitions for normalized-row count, root-input bytes, canonical-document fixed-point bytes and retained chunk planning remain pending. Five field-corpus count bindings and one row-derived count binding are outside this document-selector inventory.

[Phase 5Y-H2d-b](phase-5y-h2d-b-connected-registration-document.md) now supplies the schema-valid canonical synthetic document, independently executes every actual H2a safe-preimage occurrence, reconstructs retained chunks, and proves whole/chunk hashes and document-count parity. Overlaying those results onto the H2a graph and regenerating the dependent leaf/root cascade remains next. External approved-row and repository-artifact anchors, a reviewed build manifest, the complete semantic oracle, migration 0010, frozen D1 enumeration, accepted aggregate limits and protected writers remain later gates.

## Authority and privacy firewall

The artifact and results remain `review_candidate`, `authority_eligible: false`, non-persisted and non-semantic. Retained-byte execution is false. No Worker handler, route, binding, D1 operation, migration, remote resource, log, trace, telemetry, public schema, seal, approval, permit, source effect or deployment surface is added. Tests and generated artifacts contain only synthetic structure; no credential value, authenticated payload, visitor data, cookie, request identifier or query is retained.
