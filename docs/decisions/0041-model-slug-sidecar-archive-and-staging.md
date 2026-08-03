# ADR 0041: Archive Model-slug authority as a locked sidecar before serving staging

- Status: Accepted
- Date: 2026-08-02
- Owners: Product and engineering
- Extends: ADR 0003, ADR 0015, ADR 0039, ADR 0040
- Requirements: `DATA-001`, `PIPE-044`, `PIPE-050`–`PIPE-055`, `BE-002`–`BE-012`, `SEC-011`, `SEC-012`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-006`

## Context

ADR 0040 makes one drained canonical D1 statement the complete publication-scoped Model-slug source, but deliberately returns only a candidate. Canonical D1, private R2, and serving D1 cannot share a transaction. A D1 bookmark is neither portable recovery input nor public authority, and the existing publication `bundleHash` was fixed before the slug capture exists. Including a later artifact in that same bundle would create a hash dependency cycle.

Cloudflare documents that R2 Worker-binding reads are strongly read-after-write consistent and that a conditional `put` returns `null` when its precondition fails. Conditional application writes provide idempotence but do not prevent a separately privileged writer from overwriting or deleting an object later. Production immutability therefore also depends on a private bucket-lock rule and least-privilege identities.

## Decision

### Content-addressed private sidecar

The durable handoff is a closed, canonical UTF-8 JSON artifact with version `model-slug-history-artifact@1`. It is a sidecar bound to the already immutable base publication by publication ID, closure hash, base bundle hash, and `manifest.generatedAt`. The complete recovery set is the base publication bundle plus this sidecar digest; the sidecar is not retroactively included in the base `bundleHash`.

The artifact contains only explicit allowlisted publication facts required beside the base bundle to reproduce `model-slug@1`: format and derivation versions, publication/closure/base-bundle/boundary identity, the same-statement canonical current-slug census, boundary-adjusted source history, and the complete projection roots and counts. It does not duplicate the base manifest, Model resource JSON, or derived mappings. Verification and restore obtain those Model resources from the separately digest-bound base bundle, rerun the projector, and require exact census, mapping, root, and count agreement. Canonical encoding fixes object keys, array order, integer representation, and whitespace. Its content address is a domain-separated SHA-256 digest of the exact bytes. The R2 key is derived only from fixed ASCII prefixes and the computed digest. A raw SHA-256 checksum is also supplied to R2, but neither R2 ETag nor vendor metadata is authority.

The ephemeral D1 bookmark is excluded from artifact bytes, key, digest inputs, R2 metadata, serving D1, receipts, errors, logs, metrics, and traces. “Reproduce the capture” means all durable publication facts and both ADR 0039 roots/counts/mappings, never the bookmark.

### Create-only write and hostile read verification

The pipeline validates and serializes a nominal B2A candidate, computes the address, and performs one conditional create-only R2 `put`. It then reads the exact object back. A failed precondition is an idempotent retry only when the existing object passes the same full verification. An ambiguous write exception is reconciled by the same bounded read; absent, unreadable, or different content never becomes success.

The reader treats object metadata and bytes as hostile. It rejects an oversized declared or actual body, truncation, extra bytes, malformed UTF-8, BOM, noncanonical JSON, duplicate/extra/missing fields, unsafe integers, wrong versions, metadata drift, digest mismatch, or projection disagreement. It independently hashes the returned bytes, revalidates the separately trusted base manifest and exact Model rows, reruns `model-slug@1` with the archived history, and compares every census row, mapping, root, and count before minting a private nominal read-verified proof.

Application code exposes no archive delete, list, copy, multipart, redirect, or public fetch operation. Production and preview use distinct private buckets. The artifact prefix requires an indefinite bucket lock, no custom domain, and disabled `r2.dev` access. Those resources remain unprovisioned until the repository release gates authorize infrastructure work.

### Serving schema 1.12 staging

Serving migration 0015 advances only exact clean schema `1.11.0` to `1.12.0`. It adds immutable STRICT storage for one publication-scoped archived-artifact proof and the exact current/historical slug mapping. Mapping rows are publication-qualified, use exact BINARY slug semantics, reject NUL and invalid grammar, bind the target Model and content hash to the immutable publication resource, and have a named exact-lookup index. Update, delete, and SQLite replacement paths are denied.

Staging accepts only the nominal read-verified archive proof, never the B2A candidate or a caller-supplied digest/Boolean. It plans bounded fixed-SQL JSON chunks before D1 work. Identical immutable partial rows in an unsealed `building` publication are retryable; any difference is corruption. Partial chunks are an explicit unreachable staging generation, not public state. Only a final guarded D1 statement that proves publication/revision/closure identity and complete bidirectional mapping parity may insert the single proof row. Deterministic readback and named-index hit/miss probes are required before returning a nominal staged proof.

B2B does not seal, mark ready, switch, change the active head, add an RPC, or open an HTTP route. B2C will advance the serving schema again to `1.13.0` for closure/readiness/switch/rollback/backup/restore and internal lookup authority. Current canonical D1 is never an old publication’s restore oracle.

## Consequences

- R2 is the actual portable cross-database handoff rather than ceremonial duplicate storage.
- Identical retries are safe, while an object collision or partial serving disagreement fails closed without repair.
- The sidecar adds a second digest to publication recovery and later readiness receipts.
- Production activation is blocked until private bucket access, indefinite prefix lock, backup, and isolated restore are reproducibly verified.
- Serving schema `1.12.0` is intentionally dormant: active selection and public routing remain unchanged.

## Rejected alternatives

- **Use the D1 bookmark as archive authority:** not portable and does not bind recoverable bytes.
- **Add the sidecar to the existing base bundle hash:** creates a construction cycle because capture follows the trusted manifest.
- **Trust an R2 ETag, size, key, or custom metadata:** none independently proves the canonical body or projection.
- **Unconditional overwrite at a content address:** permits silent corruption and defeats immutable retry semantics.
- **Stage directly from the B2A candidate:** makes R2 ceremonial and leaves restore dependent on process memory or present canonical state.
- **Install readiness/switch behavior in schema 1.12:** combines archive/staging authority with lifecycle activation and makes review and rollback less bounded.

## References

- [ADR 0003: D1 and R2 storage topology](0003-d1-and-r2-storage-topology.md)
- [ADR 0015: Publication closure and lifecycle](0015-publication-closure-and-lifecycle.md)
- [ADR 0039: Publication Model-slug projection core](0039-publication-model-slug-projection-core.md)
- [ADR 0040: Canonical Model-slug history capture](0040-canonical-model-slug-history-capture.md)
- [Phase 5O-B2B design contract](../design/phase-5o-b2b-model-slug-archive-staging.md)
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare R2 consistency model](https://developers.cloudflare.com/r2/reference/consistency/)
- [Cloudflare R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
