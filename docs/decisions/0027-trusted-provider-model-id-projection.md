# ADR 0027: Derive provider model IDs from trusted Offering resources

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Staff engineer, search lead, data-integrity lead
- Related requirements: `DATA-001`, `DATA-004`, `DATA-020`, `DATA-021`, `DATA-025`, `RULE-004`, `RULE-017`, `FE-010`, `FE-013`, `FE-023`, `FE-025`, `FE-026`, `SRCH-002`, `SRCH-006`–`SRCH-010`, `BE-003`, `BE-011`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006`
- Extends: ADRs 0015, 0017, 0021, 0025, and 0026

## Context

The approved search design places an exact provider-model-ID tier after exact canonical model/variant names and before exact provider names. The sealed broad `publication_search_document` currently contains a caller-supplied provider-model-ID array, but closure and FTS parity prove only that those supplied bytes are immutable and reproducible. They do not prove that every canonical Offering contributed its exact `provider_model_id`, that the ID is linked to the Offering's exact Model or Variant target, or that the Offering belongs to its attributed enabled provider.

A future reader could rehydrate an Offering and reject a selected false-positive row, but it could not discover an Offering omitted by a wrong broad search document. Read-time validation therefore cannot close the false-negative gap. Treating the broad array or its tokenized FTS representation as the tier-2 authority would silently weaken canonical-data, exact-first, and reconstructibility requirements.

ADR 0025 establishes the applicable trust pattern for canonical model and variant names. Provider model IDs need a similarly complete, closure-bound derivation, while preserving an important difference: the same raw ID can legitimately occur in multiple Offerings, and this phase does not decide whether or how later readers collapse those rows into public Model or Variant results.

## Decision

### Runtime-neutral Offering projection

The publication core defines a reconstructible projection with version `provider-model-id@1`. It is the only accepted future authority for determining which canonical Offerings supplied provider model IDs to the exact provider-model-ID tier. The existing broad search-document array and FTS tokens are not reinterpreted as this authority.

Every complete, contract-valid Offering produces exactly one projected row containing:

- projection version `provider-model-id@1`;
- stable Offering ID;
- attributed provider ID;
- target `resourceType`, exactly `model` or `variant`;
- stable target `resourceId`;
- the Offering's exact raw `provider_model_id` as `rawProviderModelId`;
- the `exact-search-normalization@1` output as `normalizedProviderModelId`;
- recomputed `offeringContentHash`; and
- recomputed target `targetContentHash`.

The raw provider model ID remains a canonical fact only in the Offering. The normalized value is reconstructible search metadata, not a replacement fact. Projection strings preserve their exact validated Unicode scalar values, including U+0000 when admitted by the Offering contract; deterministic hashing uses their exact UTF-8 bytes.

Offering-local status, stale state, display name, evidence, and linked price or precision ID arrays are not match or ordering fields. Changes to those Offering fields can legitimately change `offeringContentHash`, but A1 does not use them to filter, boost, collapse, or select a row. Separate Provider, Price, PrecisionObservation, and affiliate facts are outside the exact derivation input; changing them leaves A1 rows and `inventoryHash` unchanged unless an Offering's own linked IDs change, while the enclosing manifest `closureHash` may change. One row is retained for each Offering for every contract-valid `status` value and either `stale` value.

### Exact complete trusted derivation

The projector accepts only a nominal immutable publication manifest produced by the publication core together with the exact complete set of canonical resource bytes needed for this derivation:

1. every Offering resource declared by the manifest, exactly once; and
2. every distinct Model or Variant resource referenced by those Offerings, exactly once.

It rejects missing, duplicate, extra, substituted, or unrelated resources within that derivation input. A referenced target must also be declared by the same manifest. Serialized, copied, reflected, structurally similar, or caller-hashed manifests and projections are not trusted.

The incremental A1 input is capped at 10,000 supplied resources, 1,000,000 UTF-8 bytes per canonical resource JSON value, and 8 MiB of canonical resource JSON in aggregate. During parsing and normalization, a streaming necessary-condition check rejects as soon as retained raw-plus-normalized provider-ID UTF-8 bytes exceed 8 MiB. Before the first asynchronous content hash, checked non-allocating UTF-8 size arithmetic also caps the complete exact encoded inventory at 8 MiB. The later inventory hash retains encoded rows plus one flat digest input, so this cap bounds those allocations to about 16 MiB before any Web Crypto implementation copy. These are conservative offline projection limits, not a claim that the already-trusted nominal manifest fits a 128 MiB Worker; the manifest has a separate pre-existing envelope.

Before returning a projection, the core:

1. validates the complete nominal manifest, including its enabled-provider scope, immutable provider dispositions, resource inventory, and provider-attribution inventory;
2. recomputes every supplied resource content hash and binds the bytes to the manifest descriptor;
3. fully validates each Offering and referenced Model or Variant against its canonical contract, including closed shape, stable identity, nested fact/evidence rules, canonical observation timestamps, and all bounds;
4. requires each Offering's `model_resource_id` prefix and identity to agree with the supplied target resource;
5. requires exactly one manifest Offering attribution whose provider ID equals the Offering's canonical `provider_id`;
6. requires that provider to be in the enabled scope; the already-trusted manifest invariant independently forbids an unavailable provider from owning any attributed public resource;
7. retains the raw provider model ID and applies the checked-in `exact-search-normalization@1` implementation, including retaining an empty normalized output when the contract-valid raw value consists only of removed punctuation or separators; and
8. proves exactly one output row for every declared Offering.

The projector never substitutes an Offering display name, canonical model name, variant name, slug, alias, publisher, provider name, or broad search-document token. A publication containing no Offerings yields a valid empty projection only when its complete manifest declares none.

Repeated raw or normalized provider model IDs remain independent rows. Multiple Offerings that point to the same target remain independent rows. A normalized collision does not choose a winner, erase multiplicity, merge providers, or imply that the colliding raw values are canonically equal.

### Pinned normalization without reader semantics

`provider-model-id@1` reuses the checked-in Unicode 17.0.0 implementation of `exact-search-normalization@1`. It does not call host normalization, locale, case, or Unicode-category APIs, and it does not synthesize aliases or organization-prefix variants. An unpaired surrogate fails closed. An empty normalized value is retained for a contract-valid raw ID; A1 does not silently omit it or decide whether it is publicly queryable.

Retaining this normalized value makes the derivation reproducible; it does not decide which value a public reader accepts or compares. The approved system design currently names pinned normalization for exact retrieval, but the public raw-versus-normalized match contract and collision semantics remain a follow-up reader decision.

### Deterministic inventory identity

The projection binds publication ID, closure hash, projection version, normalization version `exact-search-normalization@1`, complete row count, deterministic rows, and a lowercase `sha256:` inventory root. It uses ADR 0015's version-1 length-prefixed tuple encoding. The normalization version is projection metadata; the row tuple retains both exact raw and normalized values, while `provider-model-id@1` fixes how those values were derived.

The root tuple begins with domain `publication-provider-model-id-search-inventory` and encoding version `1`, followed by collection field `provider_model_id_search_documents`, type `list`, and the minimal base-10 row count. Rows sort only by Offering ID using ASCII bytes; duplicate Offering IDs reject.

Each nested tuple begins with domain `publication-provider-model-id-search-document` and encoding version `1`, followed in this exact order by:

1. `projection_version` / `text`;
2. `offering_id` / `identifier`;
3. `provider_id` / `identifier`;
4. `target_resource_type` / `text` from `resourceType`;
5. `target_resource_id` / `identifier` from `resourceId`;
6. `raw_provider_model_id` / `text` from `rawProviderModelId`;
7. `normalized_provider_model_id` / `text` from `normalizedProviderModelId`;
8. `offering_content_hash` / `digest` from `offeringContentHash`; and
9. `target_content_hash` / `digest` from `targetContentHash`.

Text fields use their exact validated UTF-8 bytes. An empty inventory uses count `0` and no sentinel row. The projection and every nested object are frozen and detached from caller-owned inputs. Nominal trust remains out of band so copying, serialization, or reconstruction cannot authorize a later writer or readiness proof.

### Boundary and required follow-ups

This accepted A1 decision is runtime-neutral only. It adds no D1 or FTS schema, migration, table, index, durable proof, staging revision, writer, readiness receipt, switch field, restore procedure, reader, RPC method, API adapter, service binding, composition policy, cursor, public route, remote resource, provisioning, or deployment.

The follow-up work is deliberately split:

- **Phase 5H-A1:** implement only this trusted runtime-neutral projection and local acceptance evidence.
- **Phase 5H-A2:** separately decide and implement durable schema, writer, completeness/queryability proof, readiness and switch binding, and restore/rebuild cutover. A2 requires its own reviewed durable-format decision before implementation.
- **Phase 5H-B:** separately decide and implement reader, RPC, and multi-tier composition. B requires one or more follow-up ADRs because the public matching, eligibility, result, ordering, deduplication, and cursor semantics below are unresolved.

This ADR makes no decision about:

- whether stale active Offerings are eligible in the default reader;
- whether public equality compares the raw or normalized provider model ID;
- how the Offering contract's allowed length and syntax relate to the public 200-byte query limit and reserved syntax;
- how duplicate or colliding Offering rows are deduplicated or ordered;
- which `SearchResult` resource types and `match_kind` values tier 2 may return;
- how provider filtering or other structured eligibility composes with this tier; or
- the complete deterministic merged cursor across exact, prefix/keyword, and semantic tiers.

No visitor request reaches A1. It performs no source acquisition, D1 access, network I/O, logging, tracing, analytics, metrics, beacons, caching, browser persistence, request correlation, or durable visitor processing.

## Consequences

- Every canonical Offering becomes independently discoverable by a future exact-ID implementation; a wrong broad search-document array can no longer be the trusted authority.
- The target identity and both resource hashes make the projection reconstructible and closure-bound without turning it into a second canonical store.
- Duplicate raw IDs and normalized collisions remain visible as data rather than being resolved by an accidental implementation order.
- Every contract-valid Offering status and stale value is retained in the projection without prejudging default reader eligibility.
- Durable storage, query behavior, public result semantics, and complete search remain blocked on explicit follow-up decisions.
- All linked traceability statuses remain unchanged; this ADR does not complete any requirement or release gate.

## Alternatives considered

- Trust `publication_search_document.provider_model_ids_json`: rejected because sealing proves stored-byte integrity, not complete derivation from canonical Offerings.
- Rehydrate only equality-query hits: rejected because that can reject false positives but cannot discover omitted Offerings.
- Tokenize the JSON array in the existing FTS table: rejected because tokenization cannot prove exact element identity or complete Offering coverage.
- Emit one row per unique raw or normalized ID: rejected because it destroys Offering identity and silently introduces deduplication semantics.
- Emit one row per target resource: rejected because multiple Offerings can legitimately reference the same Model or Variant and retain different provider-specific facts.
- Filter inactive or stale Offerings during projection: rejected because projection completeness and reader eligibility are separate concerns and historical facts must remain reconstructible.
- Add storage and the reader in this decision: rejected because physical representation and public collision/eligibility/cursor semantics require independent review.

## Validation

- Prove exactly one row for every declared contract-valid Offering and a valid empty result only when the complete manifest declares no Offerings.
- Reject missing, duplicate, extra, substituted, wrong-hash, contract-invalid, evidence-invalid, timestamp-invalid, identity-mismatched, wrong-target, wrong-provider, unattributed, out-of-scope, and unavailable-provider resources.
- Prove raw and normalized provider model IDs against an independent oracle, including case, punctuation, separators, compatibility forms, combining marks, Hangul, U+0000, unpaired-surrogate rejection, and retention of empty normalized output for contract-valid punctuation/separator-only raw IDs.
- Retain every row under duplicate raw IDs, duplicate normalized IDs, different providers, repeated targets, and normalization collisions; prove no deduplication or winner selection occurs.
- Prove ASCII Offering-ID order, input-permutation invariance, exact fixed inventory hashes, and the empty inventory hash.
- Prove copied manifests/projections, caller-authored rows/roots, hostile object shapes, later input mutation, and detached copies cannot acquire nominal trust or mutate returned data.
- Enforce the 10,000-resource, 1,000,000-byte per-resource, 8 MiB aggregate-resource, streaming 8 MiB retained provider-ID text, and 8 MiB exact-inventory bounds before asynchronous hashing; prove exact-at-limit, one-byte-over/high-expansion, and hostile-array behavior.
- Prove Offering-local status, stale state, display, evidence, and linked-ID changes cannot become match or ordering inputs; separate Provider, Price, PrecisionObservation, and affiliate changes leave rows and inventory unchanged. Offering multiplicity is not a ranking key: unchanged rows retain Offering-ID-only relative order, while adding or removing an Offering adds or removes only its own row and legitimate closure/inventory identity.
- Run focused documentation and repository verification without adding any storage, Worker, public-route, remote-resource, or deployment surface.

## References

- [ADR 0015: immutable publication closure and lifecycle](0015-publication-closure-and-lifecycle.md)
- [ADR 0017: provider disposition persistence](0017-provider-disposition-persistence.md)
- [ADR 0021: canonical provider exact search](0021-canonical-provider-exact-search.md)
- [ADR 0025: trusted model/variant name projection](0025-trusted-model-variant-name-projection.md)
- [ADR 0026: model/variant durable proof and reader split](0026-blob-model-variant-exact-search-cutover.md)
