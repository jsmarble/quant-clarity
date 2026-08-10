# ADR 0005: Combine D1 FTS5 with direct Vectorize publication namespaces

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, search lead
- Related requirements: SM-06, SM-12, SRCH-001–SRCH-011, API-010, CF-003, CF-005, CF-021, CF-022, NFR-003, NFR-006, QA-005, QA-013
- Supersedes: None

## Context

Search must prioritize exact identities and names, support keyword and natural-language retrieval, enforce structured filters without leakage, degrade when semantic search is unavailable, and remain version-consistent with canonical public resources. Vectorize mutations are asynchronous, metadata indexing is deliberately limited, and vector metadata cannot be canonical evidence.

## Decision

Implement hybrid retrieval directly:

- Use indexed serving-D1 columns and FTS5 documents for exact provider model IDs, canonical names, aliases, publisher/provider names, prefixes, normalized punctuation forms, and keyword retrieval.
- Use Workers AI to embed natural-language queries and direct Vectorize for semantic candidates.
- Store exactly one vector per canonical model or explicit variant in a namespace associated with an immutable publication version. Additional providers/offerings never duplicate the vector or increase search weight. The active publication pointer identifies the corresponding Vectorize namespace.
- For structured filters, have D1 compute the complete eligible model-ID set, then query deterministic scalar-ID `$in` batches that remain below Vectorize's 2,048-byte filter limit. Bound each batch to 40 prefixed UUIDs and ten results, and a request to eight batches/320 IDs/80 aggregate candidates; above the bound, return exact/structured results with an explicit semantic-degradation indicator.
- Reapply every structured filter against serving D1 after candidates return. Never claim complete semantic recall by merely post-filtering a bounded top-K result.
- Fetch public facts from serving D1 by stable canonical ID; never return vector metadata as canonical fact data.
- Merge results by explicit tiers: exact identity/name, alias/prefix/keyword, then semantic similarity. Semantic scores cannot order offerings inside a model comparison.
- If embedding or Vectorize fails, return exact/keyword/structured results with a documented degraded indicator.

Vector insert, upsert, and delete operations are publication-pipeline capabilities only. Publication waits for the candidate namespace to become queryable and pass acceptance probes before activation. Retain active, previous, and building namespaces; delete older vector IDs asynchronously from a tracked manifest.

Official references:

- [D1 supported SQL and FTS5](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [Vectorize client API](https://developers.cloudflare.com/vectorize/reference/client-api/)
- [Vectorize metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)
- [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/)

## Consequences

- Exact-first relevance remains deterministic and independently testable.
- Semantic failure does not make browse or detail resources unavailable.
- Publication namespaces prevent new vectors from contaminating active search results.
- Canonical rehydration and filter rechecks prevent stale or out-of-filter vector results from leaking.
- The team owns hybrid merge logic and search evaluation rather than delegating it to AI Search.
- Vector dimensions and distance metric are hard-to-change index decisions and require an ADR amendment plus rebuild.
- Namespace/vector cleanup and async visibility checks become operational responsibilities; storage cost includes active, previous, and building generations.

## Alternatives considered

- Cloudflare AI Search: viable managed hybrid retrieval, but rejected initially because deterministic exact-first merge, publication versioning, filter rechecks, and canonical record control are central requirements.
- Vectorize-only search: rejected because embeddings should not decide exact IDs or structured price filters.
- D1-only search: rejected because the PRD requires Vectorize-backed semantic retrieval.
- One mutable vector corpus without publication scoping: rejected because it can expose mixed publication versions.

## Validation

- Version-controlled sets satisfy SM-06 and SM-12 with zero structured-filter violations.
- Test exact IDs, aliases, punctuation, provider names, precision phrases, natural-language intent, inactive/stale exclusion, and empty results.
- Inject stale, wrong-publication, and out-of-filter vector candidates and prove D1 rehydration rejects them.
- Place a qualifying record below an unfiltered top-50 boundary and prove prefiltering, D1 preselection, or explicit degradation prevents a false empty result.
- Permute the number of providers/offerings per model and prove vector count, semantic score, and ordering do not change.
- Measure mutation-to-query visibility and enforce a bounded publication timeout/quarantine path.
- Simulate Workers AI and Vectorize failure and confirm exact/structured discovery remains available.
- Rebuild all search data from one immutable publication bundle and compare candidate IDs and filters.

## Addendum: publication-qualified vector identity

ADR 0013 resolves the vector-identity detail left implicit here. The publication ID is the Vectorize namespace, while the index-wide vector ID is the SHA-256 of a versioned publication/resource tuple and maps back to the stable canonical model or variant through serving D1. Stable canonical IDs are not reused directly as vector IDs across namespaces. This addendum changes no retrieval, neutrality, or canonical-evidence rule in this ADR.

## Addendum: embedding-output recovery

[Proposed ADR 0045](0045-publication-bound-embedding-recovery.md) would resolve the recovery detail left implicit here after product-owner acceptance of its `BE-011` interpretation. New publications would bind exact accepted document-vector bytes as canonical publication recovery data before Vectorize insertion; disaster recovery would restore those bytes instead of re-inferencing through a mutable hosted alias. Semantic querying remains disabled until the current query policy passes the complete acceptance set against the restored corpus. Exact/keyword/structured fallback, D1 canonical rehydration, and neutrality remain unchanged.
