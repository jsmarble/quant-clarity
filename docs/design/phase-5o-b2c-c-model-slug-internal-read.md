# Phase 5O-B2C-C: publication-pinned Model slug internal read

Status: locally implemented

Decision authority: [ADR 0042](../decisions/0042-model-slug-lifecycle-authority.md)
Primary requirements: `DATA-001`, `API-002`–`API-005`, `BE-002`, `BE-003`, `BE-007`, `BE-008`, `BE-011`, `NFR-002`, `SEC-001`, `SEC-007`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-006`

## Outcome and boundary

B2C-C adds one internal, additive `readModelDetailV2` query operation over serving schema `1.13.0`. Relative to one publication already selected by resolver V2, one bookmark-continuous D1 Session resolves an exact stable Model ID, exact current slug, or exact historical slug to the unchanged canonical Model. It verifies the selected Model row against the immutable closure, staged Model-slug artifact proof, exact mapping rows, and canonical resource hash before returning closed lookup provenance.

The operation remains service-binding-only and unrouted. It adds no public path, redirect, HTTP status choice, CORS, ETag, Cache API use, response admission, remote binding, migration, provisioning, or deployment. Phase 5O-B3 owns every public `/v1/models/{model_id_or_slug}` semantic.

## Closed input

The outer V2 input contains only `audience`, `bookmark`, `environment`, `envelope`, `lookup`, `requiredAvailableUntilMs`, and `version`. `version` is `2`; the audience remains `quantclarity-catalog-query-v1`; the environment must equal the protected Worker binding; and the non-reserved bookmark is at most 4,096 characters. The availability horizon is a nonnegative safe integer and must be identical to the resolver V2 horizon.

`lookup` is exactly one of:

- `{ kind: "stable_id", value: <lowercase mdl_ UUIDv4> }`; or
- `{ kind: "slug", value: <strict 1–128 character lowercase ASCII slug> }`.

The slug grammar is `[a-z0-9]+(?:-[a-z0-9]+)*`. The reader performs no case folding, percent decoding, Unicode normalization, alias expansion, or search normalization. The existing closed detail envelope remains publication-pinned, unpaginated, unfiltered, and unsearched; its identifier must equal `lookup.value`. Prototypes, accessors, symbols, extra keys, malformed arrays, and other hostile shapes fail before D1 access.

## Fixed read and authority

The reader performs exactly one `database.withSession(bookmark)`, one fixed prepared SELECT, and one bounded `.all()`. The statement returns an authority sentinel and zero or one candidate, ordered by a fixed ordinal and limited to two rows.

The authority sentinel exists only when all of these conditions hold:

- the selected publication is active, the exact rollback candidate, or retained hot at the supplied horizon under the existing retained-publication rules;
- `publication.closure_hash` equals `publication_closure_seal.closure_hash`;
- exactly one Model-slug artifact proof joins the publication and seal;
- proof staging revision, closure hash, base bundle hash, and publication boundary equal the seal/publication values; and
- artifact, acquisition, and projection versions are respectively `model-slug-history-artifact@1`, `model-slug-history-canonical@1`, and `model-slug@1`.

The statement does not rescan or recompute the complete mapping inventory per request. Migration 0016, the immutable seal guard, readiness v5, and switch v5 already establish the global proof. The reader instead re-proves the selected path:

- slug lookup is forced through `publication_model_slug_exact_idx`;
- stable-ID resolution and every resolved Model's canonical current slug are forced through `publication_model_slug_current_model_idx`;
- the exact publication/type/Model resource is joined by its composite identity;
- selected and current mappings have the expected projection, Model, and resource content hash; and
- the current mapping slug bytes equal the canonical Model JSON slug bytes.

Missing or drifted authority is an integrity failure, not a normal identifier miss. An exact authority sentinel with no candidate is `not_found`. D1/session/transport failure is `read_failure`. The query uses no dynamic SQL, DML, FTS, Vectorize, R2, provider source, canonical D1, retry, or fall-forward publication.

## Canonical validation and provenance

JavaScript snapshots every row and result envelope, checks the separate UTF-8 byte count against the 1,000,000-byte canonical resource ceiling, parses one JSON value, validates the complete Model contract, recomputes the publication-resource content hash, and verifies that the trusted current mapping slug equals the Model's known current slug.

The success outcome returns the existing canonical Model, publication ID, schema version, and exactly this provenance union:

```text
{
  matchedBy: "stable_id" | "current_slug" | "historical_slug",
  canonicalSlug: string,
  projectionVersion: "model-slug@1"
}
```

`canonicalSlug` comes only from the verified current mapping. The operation never returns a separate submitted-lookup field or a historical matched slug; a stable ID or current slug may still appear as an independently verified canonical Model fact. Static integrity/read outcomes contain no identifier, slug, bookmark, SQL, object key, digest, request identity, or infrastructure detail.

## Bounds and privacy

One invocation uses one Session, one SELECT, at most two rows, at most one canonical JSON body, and no fan-out, pagination, semantic work, or mutation. Stable IDs are exactly 40 ASCII characters; slugs are at most 128 ASCII characters; schema-version and resource-byte ceilings remain those of the V1 reader.

The query receives transient controlled RPC input only. It writes no D1/R2/KV/Vectorize state and creates no log, trace, metric, analytics event, cookie, browser state, request correlation ID, click record, durable cache key, or visitor-derived artifact. The public API Worker remains unchanged and the operation is not reachable through a public Request.

## Acceptance evidence

Local acceptance requires:

1. stable-ID, current-slug, historical-slug, and both identifier-miss cases;
2. exact input grammar and hostile own-data-shape rejection before effects;
3. one fixed SELECT, one bookmark Session, exact binds, bounded rows, and query-plan evidence for both named indexes and exact resource access;
4. missing/mismatched seal, proof, revision, bundle, boundary, version, mapping, current mapping, content hash, canonical slug, and cross-publication rejection;
5. malformed, oversized, byte-drifted, noncanonical, contract-invalid, hash-invalid, duplicate, and extra result rejection;
6. active, rollback-candidate, displaced retained-hot, cutoff, and bookmark-continuity workerd cases;
7. V1 compatibility, named service-binding availability, and unchanged public route/OpenAPI/privacy surfaces; and
8. format, lint, type, contract drift, Cloudflare type drift, privacy, unit, pinned-workerd, build, and full repository verification.

Passing local evidence does not advance public API, performance, remote D1, multi-PoP, deployment, or release status. B2C-B recovery remains independent and incomplete; B3 remains the public HTTP/cache gate.

Local result: complete. Unit, hostile-shape, actual schema-`1.13.0` D1, named-index query-plan, active/rollback/displaced-retained continuity, strict-cutoff, corruption, named service-binding, V1-compatibility, build, browser/accessibility, supply-chain, and zero-visitor-data checks pass. No public route, remote resource, migration, provisioning, deployment, or release gate is claimed.
