# Phase 5Y-H1: Independent composite-frame composition evidence

| Field | Value |
|---|---|
| Status | Locally implemented isolated-family structural review candidate; coherent row traversal, authority, semantic-oracle, migration and aggregate acceptance remain blocked |
| Decision | [Proposed ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-030`–`PIPE-045`, `SEC-003`–`SEC-006`, `QA-006`, `QA-007`, `QA-010`–`QA-012` |

## Outcome

This slice composes the previously independent provenance-v2 leaf vectors through the proposed family-projection and record-frame topology. The generated `provenance-v2-composite-root-vectors@1` artifact covers all 33 root-member leaf families, 38 isolated-family projections, five Provider-shaped frames, four plan-shaped frames, a detached successor-claim shape, the authority-root frame and a candidate receipt frame. Numeric order and binary UTF-8 order remain explicit codec examples; they are not row-traversal evidence.

The evidence is deliberately synthetic and post-resolution. It proves that two independently written codecs—Node `Buffer`/`createHash` and workerd `Uint8Array`/WebCrypto—produce the same reviewed leaf bytes, family projections, family-ordinal-composed frame bytes, four plan-shaped digests, authority-root bytes and candidate-receipt bytes. Input family order is reversed before fixed family-ordinal ordering is applied.

The contract checker regenerates and validates the artifact and schema, requires exact family coverage of the reviewed root-binding-plan singleton, and rejects missing families, source-family substitutions, digest drift, accessors, hostile property reads, exotic prototypes, cycles and sparse arrays without evaluating getters.

## Authority firewall

This is structural family-projection/frame evidence, not a connected registration graph, executable traversal, composite-root oracle or the ADR 0067 semantic oracle. The artifact is permanently shaped as `review_candidate`, `authority_eligible: false` and `outcome: authority_refused`. It cannot create an oracle receipt, seal, approval, bundle, permit, response, source effect, publication artifact or public fact. It adds no Worker handler, D1 access, route, binding, migration, remote resource, logging, telemetry or deployment configuration.

The candidate receipt frame uses fixed vector inputs only. Its `verified_at_ms` is not current-time authority. Stored or caller-provided roots remain comparison claims, and none drives recomputation. The reused leaf vectors were intentionally authored as isolated codec witnesses: their plan/provider identities and embedded child counts/roots do not form one coherent graph. The detached successor claim shape therefore proves field/frame composition only and is not compared with an adapter receipt or successor-manifest preimage.

Five independent promotion prerequisites remain encoded as `pending`:

1. a coherent multi-row registration fixture plus scope filtering, typed within-family ordering, duplicate-key rejection, child-count/root parity and complete traversal accounting;
2. the complete independent semantic oracle, including lifecycle and current-authority checks;
3. a reviewed build manifest that pins repository artifacts to an exact build;
4. migration-0010 schema/guard parity and frozen-row traversal; and
5. accepted aggregate limits backed by the real D1/workerd registration path and an approved CPU-evidence method.

Because every current repository-artifact binding is still `pending_reviewed_manifest`, no structurally verified or authority-capable result is representable. The checked-in field corpus and root-binding plan are compiled review constants, not caller-selected programs.

## Verification boundary

Focused contract tests validate the closed generated artifact and hostile data boundary. The independent Node and workerd suites each rebuild the binary frames and SHA-256 values without importing a shared encoder, hash helper or traversal executor. Contract drift generation keeps the artifact deterministic and outside the public OpenAPI allowlist.

This evidence closes only independent family-projection and higher-frame codec composition. The earlier independent connected composite traversal/root-vector gap remains open. Exact registration-document byte ingestion, resolver witnesses, coherent multi-row fixtures, typed row ordering, D1 row enumeration and scope closure, successor parity, semantic endpoint/owner/policy/verifier/interval checks, accepted-scale evidence, migration 0010, protected private writers and every runtime or deployment authority remain pending. No traceability status or release gate advances.
