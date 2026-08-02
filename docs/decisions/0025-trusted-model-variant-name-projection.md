# ADR 0025: Derive canonical model and variant exact names from trusted publication resources

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Staff engineer, search lead, data-integrity lead
- Related requirements: `DATA-001`–`DATA-004`, `DATA-008`, `API-003`, `API-010`, `SRCH-002`, `SRCH-006`, `SRCH-009`, `PIPE-044`, `BE-003`, `BE-011`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006`
- Extends: ADRs 0015, 0019, 0021, and 0022

## Context

The sealed `publication_search_document` inventory closes over every model and explicit variant, but its stored `normalized_name` is caller-supplied broad search-document content. Current closure, readiness, and FTS-parity checks prove that the stored value is immutable and reproducible; they do not prove that it was derived from the evidence-bearing canonical `Model.display_name` or `Variant.display_name` fact with the pinned exact-search normalizer.

That distinction blocks an exact canonical-name reader. A reader can rehydrate and reject a selected row whose normalized name is wrong, but it cannot discover a canonical resource that a wrong index value omitted from the equality result. Read-time validation therefore prevents false positives but cannot prevent false negatives. Treating the current broad search field as the canonical-name authority would silently weaken `SRCH-002`, `SRCH-006`, and `BE-011`.

The provider projection in ADR 0021 establishes the applicable trust pattern: derive a complete, nominal projection from closure-bound resource bytes, recompute hashes, validate the complete canonical contract, and never accept caller-provided rows or roots. Models and variants need the same derivation without copying provider facts into model relevance, changing vector grain, or broadening ADR 0022's provider-only NUL prohibition.

## Decision

### Separate canonical-name projection

The runtime-neutral publication core defines a separate reconstructible projection with version `model-variant-name@1`. It is the only future authority for classifying tier-1 exact canonical model and variant names. The existing `publication_search_document.normalized_name` remains part of the broad exact/keyword/vector search-document input and is not silently reinterpreted as this projection.

Each projected document contains exactly:

- projection version `model-variant-name@1`;
- resource type `model` or `variant`;
- the stable canonical resource ID;
- the exact known canonical display-name bytes;
- the `exact-search-normalization@1` output; and
- the recomputed canonical resource content hash.

The display name remains a canonical fact only in the model or variant resource. The projection is an index input and may not become an alternative evidence store. Publisher, aliases, offering availability, provider model IDs, provider count, affiliate state, price, precision, popularity, or operator preference are not projection fields or ordering inputs. A change elsewhere in the enclosing resource may change its retained resource hash, but cannot change projected inclusion, display-name bytes, normalized name, or ordering unless the canonical display-name fact itself changes.

### Complete trusted derivation

The projector accepts only a nominal immutable publication manifest produced by the publication core and the exact model/variant resource bytes declared by that complete manifest. Serialized, copied, reflected, structurally similar, or caller-hashed manifests and projections are not trusted.

Before returning a projection, the core:

1. validates the manifest and its complete resource inventory;
2. requires exactly the declared bytes for every model and variant resource and rejects missing, duplicate, substituted, or resources outside that declared searchable subset;
3. recomputes every supplied resource content hash before using it;
4. fully validates every declared model and variant against its canonical contract, including stable identity, closed shape, fact state/value agreement, evidence references, canonical observation timestamps, and all nested bounds;
5. derives a document only when the canonical `display_name` fact is `known`;
6. retains the exact display-name bytes, applies the checked-in `exact-search-normalization@1` implementation, and rejects a known name that cannot produce a valid normalized result; and
7. proves that the returned document set is the complete derivation from all declared model and variant resources.

A non-known display name (`unknown`, `not_applicable`, or `unavailable`) produces no canonical-name document. The projector must not substitute a slug, alias, family name, publisher, provider model ID, search-document field, URL, or inferred label. Zero documents is valid only when the complete manifest contains no model or variant with a projectable known display name. Normalized-name collisions remain distinct documents; no winner is selected.

Models and explicit variants are both tier 1 under the approved search design. The projection does not merge them, infer family equivalence, or collapse materially distinct releases. Its deterministic order is resource type by ASCII bytes and then stable resource ID by ASCII bytes. This storage-independent order defines hashing only; future query ordering remains the approved normalized display name followed by stable resource ID.

### Pinned normalization and NUL preservation

`model-variant-name@1` uses the exact `exact-search-normalization@1` implementation and checked-in Unicode 17.0.0 tables already accepted by ADR 0021. It does not call host normalization, locale, case, or Unicode-category APIs and does not synthesize aliases or strip organization prefixes.

ADR 0022 forbids U+0000 only for canonical provider display names and matching provider exact-name queries. This decision does not broaden that prohibition. The existing Model and Variant contracts continue to admit U+0000, and the canonical-name projection preserves it through normalization and length-prefixed hashing. A future D1 schema, writer, or reader must either support those bytes without SQLite text-length ambiguity or obtain a separate approved contract decision; it may not silently reject, strip, replace, truncate, or map them.

Known input containing an unpaired surrogate or normalizing to an empty name fails the complete projection instead of being omitted as though it were unknown. Unknown remains a deliberate canonical fact state, not a recovery path for invalid known content.

### Deterministic inventory root

The projection includes its publication ID, closure hash, projection version, complete document count, deterministic document tuple, and lowercase `sha256:` inventory root. It uses ADR 0015's version-1 length-prefixed tuple encoding exactly.

The root tuple begins with domain `publication-model-variant-name-search-inventory` and encoding version `1`, followed by the collection field `model_variant_name_search_documents`, type `list`, and its minimal base-10 item count. Documents sort by `resource_type` and then `resource_id`, both by ASCII bytes. Duplicate `(resource_type, resource_id)` identities reject.

Each nested tuple begins with domain `publication-model-variant-name-search-document` and encoding version `1`, followed in this exact order by:

1. `projection_version` / `text`;
2. `resource_type` / `text`;
3. `resource_id` / `identifier`;
4. `display_name` / `text`;
5. `normalized_name` / `text`; and
6. `resource_content_hash` / `digest`.

Text fields use their already-validated UTF-8 bytes, including embedded U+0000. An empty inventory uses list count `0` with no nested tuple; it does not use null, an empty digest, or a sentinel document. The projection and every nested object are frozen and detached from caller-owned inputs. The core retains nominal trust out of band so a copied result cannot authorize a later writer or proof.

### Boundary of this decision

This phase implements only the runtime-neutral trusted projection and its local verification. It adds no D1 table, index, migration, FTS table, readiness receipt, switch-preflight field, writer, reader, query RPC method, API adapter, cursor, public route, service binding, remote resource, provisioning, or deployment.

A follow-up decision must bind the projection to durable schema, readiness, switching, restore, and an indexed equality reader before any exact canonical model/variant query claim. That decision must preserve U+0000 correctly, keep the existing broad search-document and vector counts semantically unchanged, and prove that no sealed wrong or missing normalized name can become active.

No visitor request reaches this core. It performs no logging, tracing, analytics, metrics, caching, browser persistence, request correlation, or durable visitor processing.

## Consequences

- A future exact-name reader can select from a complete canonical derivation instead of trusting an unverified broad search-document field.
- Unknown names remain honestly absent, while invalid known facts fail publication rather than causing silent false negatives.
- Model and variant exact-name relevance remains independent of provider, offering, affiliate, price, and precision facts.
- Existing model/variant U+0000 semantics remain unchanged and become an explicit constraint on the later persistence design.
- The additional projection is reconstructible and noncanonical; canonical resource bytes and evidence remain the source of truth.
- Search, API, publication, and quality traceability statuses remain `Planned` until durable proof, query integration, full acceptance, and release gates pass.

## Alternatives considered

- Trust `publication_search_document.normalized_name`: rejected because current sealing proves stored-byte integrity, not derivation from the canonical display-name fact; an incorrect value can cause an undetectable read-time omission.
- Recheck only rows returned by an equality query: rejected because this detects false positives but cannot discover false negatives.
- Rewrite the existing broad search-document projection in this slice: rejected because that document also carries aliases, publisher text, provider model IDs, keyword text, and vector bindings with different completeness and version semantics.
- Emit one document for every model and variant using a slug or alias when display name is unknown: rejected because unknown is valid and inferred labels are not canonical evidence.
- Copy provider or offering fields into the projection: rejected because provider eligibility may qualify models but may not alter model facts or relevance.
- Extend ADR 0022's NUL prohibition to models and variants: rejected because the provider storage conflict does not authorize a broader canonical-contract change.
- Add the equality index and reader now: rejected because persistence cannot be correct until the complete trusted projection and its inventory identity exist.

## Validation

- Prove exactly one document for every contract-valid model or variant with a known display name and none for an unknown display name.
- Reject missing, duplicate, substituted, extra, hash-mismatched, contract-invalid, evidence-invalid, timestamp-invalid, and identity-mismatched resources.
- Prove punctuation, case, separator, compatibility, combining-mark, Hangul, and collision behavior against the checked-in normalization oracle without host Unicode APIs.
- Preserve leading, embedded, and trailing U+0000 in otherwise-valid Model and Variant display names through normalized output and fixed inventory hashes.
- Reject known names with unpaired surrogates or empty normalized output; never convert those failures to unknown or omission.
- Prove deterministic rows and exact inventory hashes under every manifest/resource input permutation and for an empty complete derivation.
- Prove copied manifests, copied projections, caller-supplied documents, caller-supplied roots, and post-construction mutation cannot acquire nominal trust or alter returned bytes.
- Prove provider resources, provider attributions, offering multiplicity/order, affiliate fields, prices, precision facts, and provider-count changes cannot change inclusion, display name, normalized name, or document order; only the enclosing canonical resource hash may change when its canonical bytes change.
- Run the full repository verification gate while keeping all D1, Worker, public-route, remote-resource, and deployment surfaces unchanged.

## References

- [ADR 0015: immutable publication closure and lifecycle](0015-publication-closure-and-lifecycle.md)
- [ADR 0021: canonical provider exact search](0021-canonical-provider-exact-search.md)
- [ADR 0022: provider-only NUL prohibition](0022-forbid-nul-provider-display-names.md)
