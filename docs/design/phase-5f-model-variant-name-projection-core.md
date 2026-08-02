# Phase 5F: trusted model and variant canonical-name projection core

| Attribute | Value |
|---|---|
| Status | Implemented runtime-neutral core; persistence, query, public integration, deployed evidence, and release acceptance remain pending |
| Decision | [ADR 0025](../decisions/0025-trusted-model-variant-name-projection.md) |
| Requirements | `DATA-001`–`DATA-004`, `DATA-008`, `API-003`, `API-010`, `SRCH-002`, `SRCH-006`, `SRCH-009`, `PIPE-044`, `BE-003`, `BE-011`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006` |

## Problem and slice boundary

The current sealed model/variant search document retains a caller-supplied `normalized_name`. Readiness proves the bytes are sealed and its FTS copy has parity, but does not prove the value was derived from the canonical evidence-bearing display-name fact. A query-time canonical recheck cannot detect a false negative when that wrong value prevents the row from being selected.

Phase 5F therefore implements only a trusted, runtime-neutral `model-variant-name@1` projection in `packages/publication-core`. It derives the complete known-name subset from a nominal immutable manifest and the exact bytes for every model/variant resource declared by that manifest, validates those resources fully, recomputes their hashes, applies pinned `exact-search-normalization@1`, and returns a frozen nominal projection with a deterministic inventory root.

The slice deliberately adds no persistence or serving path. In particular, it does not add or change a migration, D1 table/index, FTS table, readiness receipt, switch preflight, writer, query reader, RPC method, API adapter, cursor, public `/v1/search`, service binding, binding identifier, remote resource, provisioning, or deployment configuration.

## Projection contract

For each declared model or variant whose canonical `display_name` fact is `known`, the projection emits exactly one document containing:

```text
projectionVersion = model-variant-name@1
resourceType = model | variant
resourceId = exact canonical stable ID
displayName = exact canonical fact bytes
normalizedName = exact-search-normalization@1(displayName)
resourceContentHash = recomputed canonical resource hash
```

A non-known display name (`unknown`, `not_applicable`, or `unavailable`) emits no document and no inferred replacement. A known name that cannot be normalized safely fails the whole projection. Normalized collisions remain separate. No provider, offering, affiliate, price, precision, popularity, provider-count, or operator-preference value participates in inclusion, displayed bytes, normalization, or ordering.

The projector must accept only the nominal immutable manifest and the exact complete resource-byte set declared by it. It rejects missing, duplicate, extra, substituted, hash-mismatched, contract-invalid, evidence-invalid, timestamp-invalid, or identity-mismatched resources before returning any trusted output. Copied or reflected manifests and projections, caller-authored rows, and caller-authored roots remain untrusted.

## NUL and normalization boundary

The projection reuses the checked-in Unicode 17.0.0 implementation of `exact-search-normalization@1`. It does not use host normalization or locale behavior and does not synthesize aliases.

ADR 0022 remains provider-specific. Phase 5F does not change Model or Variant schemas and preserves U+0000 in known display names, normalized output, tuple lengths, and hashes. The follow-up durable schema and reader must support those bytes explicitly or obtain a separate approved decision. They may not inherit the provider prohibition silently.

## Deterministic identity

The complete projection binds publication ID, closure hash, projection version, document count, frozen documents, and the ADR 0025 inventory hash. Documents sort by ASCII `resourceType` and then ASCII `resourceId`. The version-1 length-prefixed inventory uses:

- root domain `publication-model-variant-name-search-inventory`;
- collection `model_variant_name_search_documents`; and
- nested domain `publication-model-variant-name-search-document` with fields in exact order: projection version, resource type, resource ID, display name, normalized name, and resource content hash.

An empty complete known-name subset has count zero and no sentinel row. Nominal trust is retained out of band so serialization, copying, reflection, or reconstruction does not authorize later persistence.

## Implementation targets

- Add Model and Variant Worker-safe complete contract validation suitable for projection input without weakening canonical Unicode-scalar, evidence, timestamp, closed-shape, or nested-resource rules.
- Add the frozen nominal projection/document types, trusted-manifest binding, complete-resource reconciliation, exact normalization, and inventory hashing to `packages/publication-core`.
- Add focused independent-oracle and negative tests in `packages/publication-core` while reusing checked-in Unicode assets rather than creating a second normalizer.
- Update architecture and traceability documentation without changing the PRD or advancing any requirement status.

## Acceptance evidence

1. Every known canonical model/variant display name produces exactly one row; every unknown display name produces none.
2. Missing, duplicate, extra, substituted, malformed, hash-invalid, evidence-invalid, timestamp-invalid, and wrong-identity resources fail before a trusted projection exists.
3. Unicode normalization cases and normalized-name collisions match an independent oracle and remain deterministic under input permutation.
4. Leading, embedded, and trailing U+0000 survive projection and fixed hash vectors without truncation or replacement.
5. Unpaired-surrogate and normalization-to-empty known names fail closed rather than becoming inferred or unknown rows.
6. Copied nominal inputs/outputs, caller rows/hashes, and later input mutation cannot acquire trust or mutate output.
7. Provider/offering/affiliate/price/precision permutations do not affect row inclusion, display, normalized value, or ordering.
8. Format, lint, type-check, contract drift, privacy checks, unit tests, Worker tests, dry-run builds, and the full `verify` gate pass with no serving or deployment surface change.

## Follow-up boundary

Phase 5G must separately decide and implement durable projection persistence, exact completeness/readiness and switch binding, portable rebuild behavior, a U+0000-safe indexed equality representation, canonical rehydration, bounded pagination, and the bookmark-continuous query/RPC seam. A sealed wrong or missing canonical-name row must be impossible before Phase 5G claims exact model/variant retrieval.

Provider-model-ID, aliases, prefix/keyword ranking, structured eligibility, semantic retrieval, merged pagination, provider-only semantic applicability, dedicated public search limiting, public routing, real service bindings, remote resources, deployment, and every composite search/release gate remain outside Phase 5F.

## Non-claims and traceability

Phase 5F does not complete `SRCH-002`, `SRCH-006`, `SRCH-009`, `API-003`, `API-010`, `QA-005`, or `QA-006`. It provides local derivation evidence only, makes no PRD amendment, stores no visitor data, and authorizes no Cloudflare mutation. All linked traceability statuses remain `Planned`.
