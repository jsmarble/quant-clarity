# Phase 5H-A1: trusted provider-model-ID projection

- Status: locally implemented; durable/query/release evidence pending
- Date: 2026-08-02
- Decision: [ADR 0027](../decisions/0027-trusted-provider-model-id-projection.md)
- Scope: runtime-neutral publication-core derivation and local acceptance evidence only
- Requirement status: unchanged

## Purpose

Phase 5H-A1 closes the derivation trust gap for exact provider model IDs before any durable or query implementation begins. The broad search document can contain provider model IDs, but its caller-supplied array cannot prove complete derivation from canonical Offerings. A1 creates a nominal, closure-bound `provider-model-id@1` projection with exactly one row per Offering.

This document records the approved and locally implemented A1 boundary. It does not claim that exact provider-model-ID search is durable or queryable, or that any mapped requirement is complete.

## Inputs and authority

The only authoritative input is:

1. a nominal immutable publication manifest created by the publication core;
2. the exact bytes for every Offering resource declared by that manifest; and
3. the exact bytes for every distinct Model or Variant referenced by those Offerings.

The derivation input must contain that set exactly: no missing, duplicate, substituted, or unrelated resources. It is capped at 10,000 supplied resources, 1,000,000 UTF-8 bytes per canonical resource JSON value, and 8 MiB of canonical resource JSON in aggregate. A streaming necessary-condition check rejects while parsing as soon as retained raw-plus-normalized provider-ID UTF-8 bytes exceed 8 MiB. Checked non-allocating arithmetic then caps the complete exact encoded inventory at 8 MiB before tuple allocation or hashing; encoded rows plus the flat digest input therefore consume about 16 MiB before any Web Crypto implementation copy. This bounds A1's incremental offline work and does not claim that the separately bounded, already-trusted manifest fits a 128 MiB Worker. Every content hash is recomputed. Full canonical contracts, closed shapes, identities, evidence references, timestamps, and nested bounds are validated before output is trusted.

For each Offering, the projector verifies:

- the Offering ID and resource descriptor agree;
- `provider_id` is in the manifest's enabled-provider scope and the Offering has exactly one manifest attribution to that same provider;
- the nominal manifest's existing disposition invariant already rejects unavailable-provider attributed resources;
- `model_resource_id` identifies a manifest-declared `model` or `variant` resource;
- the exact supplied target's type, stable ID, bytes, contract, and recomputed hash agree; and
- the raw `provider_model_id` is retained exactly and normalized only by `exact-search-normalization@1`.

The manifest's existing complete attribution and provider-disposition checks remain authoritative. A1 does not invent provider ownership from resource proximity, ID naming, search documents, or target relationships.

## Output contract

The nominal projection is frozen, detached, and versioned `provider-model-id@1`. It binds:

```text
publicationId
closureHash
projectionVersion
normalizationVersion
documentCount
documents[]
inventoryHash
```

Each frozen document contains exactly:

```text
projectionVersion
offeringId
providerId
resourceType
resourceId
rawProviderModelId
normalizedProviderModelId
offeringContentHash
targetContentHash
```

There is exactly one document per Offering. Every contract-valid Offering `status` and either `stale` value remain present. Same-ID, same-normalized-ID, same-provider, and same-target rows remain separate when their Offering IDs differ. A1 has no collapse or deduplication step.

Raw strings retain their exact Unicode scalar values. Deterministic identity encodes their exact UTF-8 bytes, including leading, interior, or trailing U+0000. The checked-in Unicode 17.0.0 normalizer is the sole normalization implementation; host normalization, locale, case, and Unicode-category behavior are forbidden as authorities.

## Deterministic inventory

Documents sort by ASCII Offering ID only. The ADR 0015 version-1 length-prefixed root uses:

- root domain `publication-provider-model-id-search-inventory`;
- collection `provider_model_id_search_documents`; and
- nested domain `publication-provider-model-id-search-document`.

The nested field order is projection version, Offering ID, provider ID, target resource type, target resource ID, raw provider model ID, normalized provider model ID, Offering content hash, and target content hash. Empty complete input yields count zero and no sentinel.

Fixed independent hash vectors must cover at least:

- empty inventory;
- one Model-targeted Offering;
- one Variant-targeted Offering;
- multiple Offerings in permuted input order;
- duplicate raw and normalized IDs retained under distinct Offering IDs; and
- leading, interior, and trailing U+0000.

## Implementation targets

- Add Worker-safe complete Offering validation suitable for projection input without weakening canonical fact, evidence, timestamp, identity, or closed-shape rules.
- Reuse complete Model and Variant validation for exact referenced targets.
- Add frozen structural document/projection types and separate nominal trust guards to `packages/publication-core`.
- Add bounded exact-resource reconciliation for every Offering plus only its distinct referenced targets, manifest attribution checks, normalization, and inventory hashing.
- Reuse the checked-in `exact-search-normalization@1` implementation and Unicode tables; do not create a second normalizer.
- Add focused independent-oracle, adversarial, mutation, bound, neutrality, and deterministic-hash tests.
- Update traceability links while leaving every requirement status unchanged.

## Acceptance matrix

| Area | Required evidence |
|---|---|
| Completeness | Exactly one row for every manifest Offering; valid empty projection only for a manifest with no Offerings |
| Canonical validation | Full Offering and referenced target contracts, hashes, identities, evidence, timestamps, and closed shapes pass |
| Attribution | Enabled scope, the trusted manifest's disposition invariant, exact Offering attribution, and canonical Offering provider all agree |
| Target binding | Target type/ID/prefix, manifest descriptor, supplied bytes, canonical identity, and target hash all agree |
| Rejection | Missing, duplicate, extra, substituted, malformed, wrong-hash, wrong-target, wrong-provider, unavailable-provider, and untrusted inputs fail closed |
| Normalization | Raw value is exact; normalized value matches the independent Unicode 17 oracle; unpaired surrogates reject and contract-valid punctuation/separator-only raw IDs retain empty normalized output |
| Collision retention | Duplicate raw IDs, normalized IDs, providers, and targets remain one row per Offering with no winner |
| Lifecycle neutrality | Every contract-valid Offering status and stale value remains projected; A1 performs no reader eligibility filtering |
| Fact neutrality | Offering-local lifecycle/display/evidence/linked-ID fields are not match or ordering inputs; separate Provider, Price, PrecisionObservation, and affiliate changes leave rows/inventory unchanged; Offering multiplicity only adds/removes its own ID-sorted row |
| Determinism | ASCII Offering-ID order, permutation invariance, exact fixed roots, and empty root pass |
| Nominal trust | Copies, serialization, reflection, hostile getters/proxies, forged roots, later mutation, and detached outputs cannot gain authority |
| Bounds | 10,000-resource, 1,000,000-byte per-resource, 8 MiB aggregate-resource, streaming 8 MiB retained provider-ID text, and 8 MiB exact-inventory limits reject before async hashing, including exact-at-limit, one-byte-over/high-expansion, and hostile-array cases |
| Privacy | No request input, source calls, storage, network, logs, telemetry, cache, cookies, or visitor-derived state |
| Repository | Focused tests and the full applicable verification gate pass without storage, Worker, route, or deployment changes |

## Explicit non-claims

Phase 5H-A1 adds no FTS or ordinary D1 schema, migration, index, writer, storage observation, staging revision, readiness receipt, switch/preflight family, seal rule, restore seam, reader, query operation, RPC, API adapter, public route, service binding, composition policy, or cursor.

It also makes no decision about:

- stale-active Offering eligibility in default results;
- raw versus normalized public equality, despite the approved design's current pinned-normalization language;
- whether all canonical provider model IDs are publicly reachable under the 200-byte query ceiling and reserved-syntax rules;
- collision deduplication, result identity, or neutral tier ordering;
- the allowed `SearchResult` resource/match-kind matrix for this tier;
- provider-filter qualification or cross-tier composition; or
- the merged cursor tuple.

These are not implementation details that A1 may choose implicitly.

## Follow-up sequence

1. **Phase 5H-A1 — current:** runtime-neutral projection and local evidence in this document.
2. **Phase 5H-A2 — future decision required:** durable schema and exact byte representation, bounded writer, completeness/queryability proof, readiness/switch version family, seal binding, and restore/rebuild cutover.
3. **Phase 5H-B — future decision required:** bounded canonical reader, RPC/API seam, eligibility, public match semantics, result mapping, collision behavior, composition, and cursor integration.

A2 and B must not infer their unresolved choices from A1's row shape. The runtime-neutral projection is reconstructible input, not a pre-approval of a physical schema or public API.

## Non-claims and traceability

Phase 5H-A1 does not complete `DATA-021`, `DATA-025`, `FE-010`, `FE-013`, `FE-023`, `FE-025`, `FE-026`, `SRCH-002`, `SRCH-006`–`SRCH-010`, `BE-003`, `BE-011`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, or `QA-006`. Previously implemented requirement rows remain implemented; planned rows remain planned. A1 makes no PRD amendment, stores no visitor data, and authorizes no Cloudflare mutation or deployment.
