# Phase 5O-B2B: Model-slug sidecar archive and serving staging

## Status

Design is accepted under [ADR 0041](../decisions/0041-model-slug-sidecar-archive-and-staging.md). Implementation evidence may be recorded only after the canonical serializer, hostile R2 read verification, serving migration 0015, staging adapter, native SQLite tests, pinned-workerd tests, independent review, and full repository gate pass. No provisioning or deployment is authorized.

## Outcome

Turn the B2A candidate into portable immutable authority by writing and fully read-verifying one content-addressed private R2 sidecar. Then stage only that verified projection under serving schema `1.12.0`. Leave publication sealing, readiness, switching, backup/restore activation, internal query RPC, every public route, and deployment closed for B2C/B3.

## Artifact boundary

`model-slug-history-artifact@1` uses one exact canonical UTF-8 encoding. Its allowlisted body binds:

- artifact, acquisition, projection, and canonical-JSON versions;
- publication ID, closure hash, base bundle hash, and publication boundary;
- exact same-statement canonical current-slug rows and boundary-adjusted canonical history rows; and
- complete source/mapping roots and all model/history/mapping/current/historical counts.

The sidecar deliberately omits the trusted manifest, Model resource JSON, and derived mappings already reproducible from the base bundle. Archive verification and later restore require that separately digest-bound base bundle, rerun `model-slug@1` with the sidecar history, and require exact census, mapping, root, and count agreement. This keeps the recovery boundary explicit while avoiding duplicate retained Worker heap and R2 bytes.

The body does not contain the B2A D1 bookmark, R2 key, ETag, vendor version, vendor timestamps, credentials, request data, or error details. Serialization accepts only the nominal trusted B2A capture and copies fields through closed allowlists; it never spreads or stringifies the capture object generically. Arrays use deterministic ASCII/interval order. Numbers are nonnegative safe decimal integers. A fatal UTF-8 decoder, closed schema parser, canonical reserialization equality, raw SHA-256, and domain-separated artifact digest jointly detect alternate or corrupt encodings.

The R2 key is derived from a fixed versioned prefix plus the computed digest. Before serialization or R2 access, the implementation applies a conservative 80 MiB retained-heap admission bound: 4 MiB fixed overhead, 1,024 bytes per retained object/array entry, and a UTF-16 estimate for every retained string across the complete manifest, Model resources, canonical history, and projection. This operational bound is intentionally stricter than the wire contract and rejects maximum-plus-one before mutation.

## R2 protocol

1. Serialize, bound, and hash the trusted candidate before calling R2.
2. Perform exactly one conditional create-only `put` with `If-None-Match: *` semantics, exact content type/cache metadata, closed custom metadata, and the raw SHA-256 upload checksum.
3. Whether the put creates the object, reports a failed precondition, or throws ambiguously, reconcile through an exact read of the same computed key. Never choose a random or alternate key and never overwrite.
4. Validate the hostile object shape and exact metadata. Reject an absent or metadata-only body, oversize declaration, unsafe size, unexpected metadata, or wrong key before reading.
5. Consume bounded stream chunks with an independent counter, require exact declared/actual bytes, and independently recompute the raw and domain-separated digests.
6. Decode and validate the closed artifact, reserialize it identically, rerun `model-slug@1` from the archived manifest/resources/history, and require exact current census, mappings, roots, and counts.
7. Mint a private nominal read-verified proof only after all checks pass.

A concurrent identical writer is idempotent. Any different object at the same address, unreadable ambiguous outcome, or projection disagreement is corruption. No archive method exposes delete, list, multipart, copy, public fetch, redirect, logging, analytics, or visitor-derived inputs.

## Serving schema 1.12

Migration 0015 advances only the exact clean `1.11.0` schema and adds:

- `publication_model_slug_artifact_proof`: one immutable proof row per publication binding artifact format/digest/bytes, acquisition/projection versions, base publication/closure/bundle/boundary identity, all counts, and both roots; and
- `publication_model_slug_mapping`: one immutable exact current or historical slug-to-Model row per publication, bound to the exact Model publication resource and content hash.

The tables are STRICT. IDs, digests, versions, counts, boundary, slug grammar, NUL absence, resolution, foreign keys, Model content, and exact current-slug agreement are storage constraints or insert guards. Named BINARY indexes support exact publication-plus-slug reads. Same-name schema objects, drift, UPDATE, DELETE, and every `INSERT OR REPLACE` conflict path fail.

Serving D1 stores no bookmark, R2 key, ETag, object version, custom metadata, upload timestamp, request data, or visitor-derived value. The deterministic key is reproducible later from the stored artifact digest.

## Staging protocol

Staging accepts only a nominal archive proof produced by a fresh verified R2 body. Before D1 it validates the exact `building`, unsealed publication identity, closure hash, base bundle hash, and staging revision; applies the complete schema `1.12.0` foundational-object preflight; plans bounded fixed-SQL JSON chunks; and freezes every expected mapping. Planning keeps only aggregate statistics; execution regenerates deterministic chunks and retains at most one 750,000-byte JSON payload at a time under the same 80 MiB conservative heap policy.

Each chunk inserts only absent rows and asserts that all existing rows are byte-for-byte identical. A chunk failure may leave immutable rows attached only to the unreachable `building` publication. Retry uses the same proof and rows; a conflict fails permanently without delete or repair. After every mapping exists, the final guarded statement proves complete bidirectional parity and inserts the singleton artifact proof. It must not seal or change publication state.

The adapter rereads the proof and every mapping in deterministic order through 256-row slug-keyset pages, reconstructs both roots/counts without retaining a second complete mapping set, and performs named-index current/historical hit and deterministic miss probes. Only exact agreement returns a nominal staged proof. Ambiguous D1 outcomes reconcile to exact applied, exact not-applied/retryable, conflict, or unknown; errors are static and redact D1/R2 internals and payloads.

## Acceptance and traceability

| Requirements | B2B evidence | Still required |
| --- | --- | --- |
| `DATA-001`, `PIPE-044`, `PIPE-050`–`PIPE-052`, `QA-006` | Canonical sidecar digest, create-only R2 write/read proof, exact immutable D1 staging and indexed parity | B2C readiness/switch/rollback and deployed chaos |
| `PIPE-054`, `PIPE-055`, `BE-002`–`BE-007`, `BE-010`–`BE-012` | Publication/closure/base-bundle/digest roots bind portable history and serving rows | Locked remote bucket, backup, isolated restore, RPO/RTO exercise |
| `SEC-011`, `SEC-012`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011` | Closed controlled inputs, bounded hostile R2 read, static errors, no public binding/route/telemetry, bookmark non-retention | Infrastructure inventory and deployed privacy verification |

No traceability row advances to complete solely from B2B local evidence. Public `/v1/models/{model_id_or_slug}` and its redirect-versus-direct-read, cache, CORS, ETag, and response semantics remain Phase 5O-B3 work.

## Failure boundary

- An R2 failure leaves no authoritative artifact or an unreachable identical sidecar; it cannot change serving state.
- Partial serving rows remain unreachable under an unsealed `building` publication and are retryable only with identical authority.
- The proof row is absent until exact complete parity exists.
- B2B never mutates readiness, the head, switch history, rollback state, public routes, or current canonical D1.
- B2C must use the archived sidecar—not present-day canonical D1—for lifecycle, backup, and restore proofs, and will advance the serving schema to `1.13.0`.
