# ADR 0015 — separate publication closure from lifecycle

| Attribute | Value |
|---|---|
| Status | Accepted |
| Date | 2026-08-01 |
| Requirements | `SRCH-006`, `SRCH-007`, `API-003`, `PIPE-050`–`PIPE-056`, `BE-010`–`BE-012`, `CF-022`, `QA-006` |
| Supersedes | ADR 0005 only where it permits physical vector deletion before a separately accepted fenced-pruning design; otherwise clarifies ADRs 0005, 0007, and 0013 |

## Context

The approved design treats each public dataset as an immutable publication but also gives a publication mutable lifecycle states and timestamps. Hashing a serialized lifecycle record would make the publication closure change when it moves from `building` to `ready`, `active`, `superseded`, or `rolled_back`. It would also make a rollback appear to change the facts being restored.

The first serving schema establishes the required integrity boundary but deliberately does not prove all Phase 4 runtime properties. It stores lifecycle and immutable metadata together, accepts a non-empty search `document_id`, represents search readiness with counts and versions, retains only the current singleton head, and prohibits physical deletion. The local publication kernel needs one deterministic interpretation of those fields before runtime migrations or Cloudflare integration can safely proceed.

This ADR is an implementation decision within the approved PRD and system design. It does not relax publication atomicity, search readiness, backup, retention, neutrality, privacy, or release requirements.

## Decision

### Immutable closure and mutable lifecycle

A publication has two related but distinct records:

- The **immutable closure** contains the publication ID; schema, methodology, precision-normalization, precision-display-order, price-policy, source-policy, and embedding versions; build commit; source run and parent publication IDs; generated time; normalized provider-slice inventory; normalized public-resource inventory; exact-search inventory; exact vector inventory; and their counts and hashes.
- The **mutable lifecycle** contains state, readiness time, activation time, and bounded failure codes. Lifecycle transitions never alter the closure hash.

Staging work is not an authoritative closure merely because storage has reserved manifest columns. The closure becomes authoritative only after candidate assembly is sealed and the kernel has recomputed its inventories and hashes. Readiness and activation are separate attestations over that immutable closure. A failed, superseded, rolled-back, or reactivated publication keeps the same closure hash.

Content hashes for individual public resources and search documents remain part of the closure. Runtime integration must recompute them from canonical bytes before readiness; trusting a caller-supplied digest is not readiness evidence.

### Canonical hash encoding

All new publication hashes use a domain-separated, versioned, length-prefixed byte encoding. They never hash incidental object insertion order, raw `JSON.stringify` output, delimiter-joined text, provider order, or database row order.

For hash format version 1, a tuple is encoded as an ordered sequence of UTF-8 fields. Every field is `uint64be(byte_length) || field_bytes`. The first fields are the hash domain and encoding version. Each following scalar is encoded as its field name, a closed type tag, and its canonical value. Null, Boolean, integer, timestamp, identifier, digest, and text values have distinct type tags. Integers use minimal base-10 text, timestamps use canonical UTC ISO 8601 with milliseconds, identifiers and digests use their validated lowercase public grammar, and text is used exactly after the field's existing validation/normalization rule.

A collection encodes its field name, the `list` type tag, its minimal base-10 item count, and each item as a domain-specific nested tuple. Items are sorted by their specified immutable identity tuple before encoding. Duplicate identities reject the closure rather than being resolved by sort order. Optional values encode an explicit null value; omission and an empty string are never equivalent.

The result is SHA-256, exposed as lowercase `sha256:` plus 64 hexadecimal characters. The domain and encoding version are durable manifest inputs. Any encoding change requires a new version and compatibility/rebuild decision; it must not silently change an existing publication's digest.

### Provider-slice identity and unavailable providers

Every enabled provider has one explicit closure disposition. A selected-content disposition includes the provider ID, exact `prn_` slice ID, provider-run ID that produced the selected content, carried-forward flag, and freshness state. The persistent `prn_` ID is the stable identity of actual selected slice content; the remaining fields bind that identity to its lineage and publication-time state.

An unavailable disposition represents a current terminal provider run that supplied no selected public content. It contains the provider ID and that exact current provider-run ID, but its slice ID is explicitly null, `carried_forward=false`, and freshness is `unavailable`. It contributes no provider-attributable resources. It may not mint a fictitious `prn_` identity, use a placeholder or prior successful run, or imply that unavailable is a content-bearing slice.

If prior known-good content is selected, the closure records a selected-content disposition instead of unavailable. Its slice and provider-run IDs identify the prior content actually selected; `carried_forward=true`; and freshness is recomputed at the candidate publication time as `fresh` or `stale` under the approved missed-opportunity/eight-day rule. The failed current attempt remains in canonical run history and is not misrepresented as the source of the carried-forward content.

The initial serving schema requires a non-null `provider_slice_id` on every `publication_provider_slice` row and therefore cannot yet persist the unavailable disposition faithfully. Runtime publication remains blocked on a reviewed migration/contract update that represents the closed disposition without fabricating an identity.

### Exact search and vector inventory

`publication_search_document.document_id` is exactly the lowercase 64-character Vectorize ID derived by ADR 0013 from publication ID, resource type, and stable model or variant ID. It is not an arbitrary document label. The same value is the Vectorize object ID; the publication ID is the Vectorize namespace.

The exact vector inventory contains one entry for every and only every publication-scoped `model` or explicit `variant` search document. Each entry contains publication namespace, document/vector ID, resource type, stable resource ID, search-document content hash, and the versioned embedding-input hash required by the embedding policy. The inventory is sorted by resource type then resource ID before hashing. Offerings, provider counts, provider names, affiliate state, or repeated provider availability never create extra vectors or alter vector input.

Closure validation requires a one-to-one match among searchable public resources, search documents, and vector-inventory entries. Duplicate vector IDs, missing or extra entries, wrong-publication IDs, unsupported resource types, or count-only agreement reject the candidate. Runtime readiness additionally requires that every declared vector is queryable in the declared namespace and passes the exact, semantic, filter, and neutrality probes; the local inventory is not proof of Vectorize visibility.

### Normalized publication head and switch history

The singleton stored head remains the minimal mutable authority: active publication ID, optional rollback candidate ID, switch time, and generation. The complete head described by ADR 0007 is a normalized same-snapshot derivation:

- `vector_namespace` is the active publication ID;
- `manifest_hash` is that publication's immutable closure hash; and
- `published_at` is that publication's non-null activation time.

These values are never caller-supplied duplicates. A query or switch receipt derives them by joining the stored head to the selected closure and lifecycle within one transactionally consistent D1 view. Missing, mismatched, non-active, or unready derivations fail closed.

Every activation and rollback must also append a switch-history event in the same transaction that changes the singleton head. The event records a stable switch ID, action, expected prior generation, new generation, from/to publication IDs and closure hashes, resulting rollback candidate, switch time, and the authorized pipeline/operator control-plane identity. Generation advances by exactly one. The switch plan uses compare-and-swap semantics and binds the rollback candidate to the exact former head; a stale, replayed, or competing plan cannot silently replace it.

The current migration has no append-only switch-history table, so runtime head mutation remains pending a reviewed migration and D1 transaction tests. Lifecycle state alone cannot reconstruct repeated activation/rollback history.

### Physical pruning is deferred

Phase 4 local work performs no physical deletion from serving D1, canonical D1, R2, FTS source rows, or Vectorize. Logical retirement may exclude older generations from ordinary hot-public selection, but the immutable rows and vector namespaces receive extra retention until a separate ADR and reviewed migration define a fenced pruning protocol.

That future design must prove backup and restore, evidence/observation minimum retention, active/rollback/building and cursor-pin protection, switch-generation fencing, exact manifest targeting, interruption recovery, D1/FTS/Vectorize/R2 ordering, and operator authorization. Production-destructive paths remain absent. Until then, the existing deletion guards stay in place, storage growth is measured, and the approved 50% warning/60% publication-block threshold fails closed rather than authorizing cleanup.

## Consequences

- Publication facts and search identity retain one closure hash across lifecycle transitions and rollback.
- Hashes are reproducible across JavaScript runtimes, database row order, and object construction order.
- Search-document and Vectorize identities have one exact mapping that can be inventoried, backed up, probed, and rebuilt.
- An unavailable provider has no fictitious content-slice identity, cannot masquerade as a carried-forward successful slice, and carried-forward content retains its actual slice/run lineage.
- The normalized head exposes ADR 0007's full identity without mutable duplicate columns.
- Append-only switch history and exact-generation compare-and-swap are mandatory before runtime activation or rollback.
- Extra storage retention is accepted temporarily in preference to an unsafe cleanup path; the capacity gate may stop new publication work.
- Local tests can prove deterministic decisions, but they cannot satisfy multi-PoP, D1 transaction/replica, Vectorize visibility, backup/restore, or Cloudflare runtime gates.

## Alternatives considered

- Hash the complete mutable manifest object: rejected because lifecycle transitions would change publication identity without changing public facts.
- Canonicalize with sorted JSON keys alone: rejected because it leaves type, omission/null, number, Unicode, and nested-collection rules too implicit for a durable cross-runtime hash.
- Keep arbitrary search document IDs and a separate implicit vector mapping: rejected because parity, cleanup, restore, and wrong-namespace detection would depend on convention rather than one declared identity.
- Store vector namespace, manifest hash, and published time as independent mutable head columns: rejected because they could tear from the selected publication.
- Infer unavailable slices from missing rows: rejected because every enabled provider needs an explicit terminal disposition and exact run lineage.
- Use only singleton-head and lifecycle mutations as history: rejected because repeated rollback/reactivation destroys the prior transition record.
- Implement best-effort asynchronous cleanup now: rejected because no accepted fencing design yet protects the active, rollback, building, cursor-pinned, backup, and retention boundaries across all stores.

## Validation

- Reorder every closure input and object construction order and obtain the same digest; alter any typed value, field presence, list membership, content hash, policy version, or identity and obtain a different digest.
- Exercise delimiter-like text, empty values, explicit nulls, multi-byte UTF-8, large lengths, duplicate identities, and type-confusable values against independent hash vectors.
- Move one closure through every valid lifecycle transition and rollback/reactivation while its closure hash remains unchanged.
- Reject unavailable dispositions with a non-null/fictitious slice ID, carried-forward content, prior/placeholder run IDs, or provider-attributable resources; verify carried-forward freshness and exact slice/run lineage.
- Prove one-to-one searchable-resource, search-document, and vector-inventory parity; reject provider/offering vectors, duplicate IDs, wrong namespaces, and mismatched embedding-input hashes.
- Race two activation plans and activation against rollback; only the exact expected-generation switch may append history and advance the head by one.
- Derive normalized heads within one consistent snapshot and reject missing closures, null activation times, state mismatch, hash mismatch, or stale generations.
- Attempt pruning against every store and prove the local design has no physical-delete command. Runtime pruning remains blocked until its separate ADR, migration, recovery tests, and authorization exist.
