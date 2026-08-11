# ADR 0057: Project selection-free Offering observation sets

- Status: Accepted for local implementation
- Date: 2026-08-11
- Decision owners: Staff engineer, data architecture lead, pipeline lead, data-neutrality reviewer, security and privacy lead
- Related requirements: `DATA-003`, `DATA-020`, `DATA-021`, `DATA-025`, `DATA-030`–`DATA-035`, `DATA-039`–`DATA-046`, `DATA-048`, `DATA-050`, `DATA-051`, `DATA-055`–`DATA-058`, `DATA-060`, `DATA-061`, `DATA-065`–`DATA-067`, `RULE-010`, `RULE-011`, `RULE-014`, `RULE-015`, `RULE-017`, `API-002A`, `BE-005`, `BE-011`, `QA-006`, `QA-010`, `QA-012`
- Extends: ADRs 0004, 0010, 0015, 0018, 0035, 0055, and 0056
- Supersedes: None

## Context

ADR 0056 makes the persisted publication a complete structural authority for each Offering, its Provider and Model-or-Variant target, every Price and PrecisionObservation child, and the EvidenceSummary records referenced by the Offering and its children. That closure deliberately does not choose a current Price or precision claim. The next policy decision therefore needs a lossless, deterministic input that cannot hide a historical, conditional, promotional, overlapping, unknown, or component-scoped observation.

Using parsed caller objects, provider-model-ID search witnesses, child arrays supplied independently of the sealed publication, or a convenient “latest” row would reopen authority that the persisted-content boundary just closed. It could also omit the Provider display-name Fact required for neutral provider identification, or admit its evidence without proving that the EvidenceSummary belongs to the Provider.

This decision defines a runtime-neutral, selection-free `OfferingObservationSet` projection over one already trusted publication. It is an internal data-correctness artifact for the later current-value and comparison-policy design. It is not a comparison row, Offering Facts representation, API response, or UI model.

## Decision

### Trusted persisted-content authority

The projector accepts only both:

1. a branded `TrustedImmutablePublicationManifest` returned by the content-aware persisted-content builder; and
2. the complete persisted resource inventory whose exact canonical `resource_json` bytes and descriptors reconcile to that manifest.

The projector snapshots bounded input and requires exact equality between the manifest resource inventory and the supplied persisted rows by resource type, stable resource ID, and content hash. It recomputes each selected resource content hash from the exact persisted canonical UTF-8 bytes before parsing it. A missing, additional, duplicated, reordered-as-authority, non-canonical, hash-mismatched, or cross-publication resource fails closed. The projector does not accept a descriptor-only manifest, a structural-cast manifest, a previously parsed resource graph, search documents, serving index rows, or provider-search witnesses as fact authority.

ADR 0056's trusted-manifest brand establishes that the reconciled bytes passed complete Offering relationship closure. Reconciliation establishes that the projector is using those same bytes. The projector then applies the additional Provider display-name evidence closure below. It does not silently rerun a weaker subset of publication validation.

### Exact observation-set content

For each canonical Offering, version 1 projects exactly:

- `projection_version = "offering-observation-set@1"`;
- explicit `selection_free_observations` projection authority and `unproven` claim authority;
- publication ID, trusted manifest closure hash, and resource-inventory hash at the containing projection;
- Offering ID, Provider ID, and Model-or-Variant target ID;
- the Provider `display_name` Fact copied exactly, without fallback or normalization;
- the complete canonical Offering parsed from its exact persisted bytes;
- every complete canonical Price owned by the Offering;
- every complete canonical PrecisionObservation owned by the Offering;
- every complete canonical EvidenceSummary referenced from the Offering, its Facts, each Price, each PrecisionObservation and component Fact, or the Provider display-name Fact; and
- a versioned observation-set SHA-256 hash.

Every projected canonical object is parsed only after the original canonical `resource_json` string has been reconciled to the trusted descriptor and its domain-separated content hash has been recomputed. The projector snapshots, validates, detaches, and freezes the complete parsed value; it does not reconstruct, truncate, merge, or expose an independently supplied object. The exact persisted bytes remain the input authority, and their verified content hashes remain the byte-authentic commitment. Provider display name is the sole copied Provider Fact because later neutral comparison needs it but does not need the Provider's affiliate, coverage, status, or other fields as observation-selection inputs. The complete Provider resource remains a hash-verified source dependency, and its content hash is committed by the observation-set hash.

Price resources are ordered by `price_id`, PrecisionObservation resources by `precision_id`, and EvidenceSummary resources by `evidence_id`, using ASCII byte order. Evidence referenced more than once appears once. The fixed outer order is serialization order only; it does not imply recency, precedence, quality, fidelity, value, or rank. Caller resource-array order cannot change the projection. Array order inside an exact canonical resource remains byte-authentic content: changing it changes that resource hash and therefore the applicable set and inventory hashes even when the separately emitted child-resource arrays retain stable-ID order.

The set preserves every Price role, class, amount, currency and provenance, unit, condition, comparability flag, effective interval, observation time, and evidence reference. It preserves every PrecisionObservation summary and normalized Fact, raw field and value, provider definition, format variant, applicability member, component Fact, observation time, and evidence reference. Known, unknown, unavailable, and not-applicable Fact states remain distinct. No missing cached-input Price is synthesized, no currency is converted, and no precision component or historical observation is collapsed.

### Provider display Fact and evidence-subject closure

The complete Provider resource must resolve by the Offering's exact `provider_id`, pass the Provider contract, and have matching outer and embedded identity as already required by ADR 0056. The projector copies only its complete `display_name` Fact. It must not derive display text from slug, provider model ID, source owner, affiliate destination, or another Offering.

Every evidence ID enumerated by the Provider display-name Fact must resolve exactly one contract-valid EvidenceSummary in the same trusted persisted inventory. Its embedded and outer evidence IDs must agree, and `subject_resource_id` must equal the Provider ID. Provider-owned evidence cannot substantiate an Offering, Price, or PrecisionObservation Fact, and evidence owned by those resources cannot substantiate Provider display name.

The existing ADR 0056 rules continue to require Offering evidence to have the Offering subject, Price evidence to have the Price subject, and PrecisionObservation or component evidence to have the enclosing PrecisionObservation subject. The projection includes the union of those already closed evidence records and the newly closed Provider-display evidence records. It does not include unrelated publication evidence merely because it shares a source, owner, locator, value, or timestamp.

This remains identity closure, not evidence interpretation. Version 1 does not compare EvidenceSummary `field` or `value` text with the referencing Fact, choose one of several evidence records, establish source precedence, decide entailment, or reinterpret claim applicability.

### Version, counts, and hashes

Each observation-set hash uses a dedicated `offering-observation-set` domain and commits, in fixed framed order:

1. projection version, `selection_free_observations` projection authority, `unproven` claim authority, publication ID, and Offering ID; and
2. the fixed-role, stable-ID-ordered resource type, ID, and recomputed content hash for the Provider, Model-or-Variant target, Offering, every Price, every PrecisionObservation, and every included EvidenceSummary.

The containing projection exposes exact Offering-set, Price-membership, PrecisionObservation-membership, and EvidenceSummary-membership counts computed from the completed immutable arrays. Evidence referenced by two Offerings is counted in each set membership because the count describes emitted observation-set membership, not a deduplicated publication inventory. It also exposes the trusted publication closure hash and resource-inventory hash.

A separate `offering-observation-set-inventory` hash begins with one mandatory header committing the projection version, both authority literals, publication ID, trusted closure hash, trusted resource-inventory hash, and all four aggregate membership counts. Stable-ID-ordered rows then commit each Offering ID and observation-set hash. The header exists even when there are zero Offerings, so empty projections from different publication authority cannot share a domain-only hash. Offering-ID order is deterministic serialization only and is not the Provider display-name default order defined later by `RULE-011`.

Any selected source byte, identity, membership, or projection-version change changes the applicable resource content hash and therefore the set and inventory hashes. Any publication closure or resource-inventory change also changes the mandatory inventory header. Hash equality is content identity for this internal projection only. It is not evidence that an observation is current, correct, preferred, publicly releasable, or successfully presented.

The projection and its hashes carry no trusted brand and cannot be passed where a `TrustedImmutablePublicationManifest` is required. Their explicit `claim_authority = "unproven"` state remains fixed until a separately accepted current-value policy consumes and proves a successor artifact.

### Selection-free boundary

The projector has no clock, publication-effective-time argument, “as of” argument, current-value flag, overlap resolver, source-precedence table, precision-display-order input, price-policy input, currency scope, affiliate input, user filter, or sort key. It performs no source, network, database, cache, AI, or browser call.

It does not:

- select latest, current, active, standard, comparable, non-promotional, or non-stale Price or PrecisionObservation records;
- resolve overlapping effective intervals or conflicting equal-authority claims;
- choose a serving-precision summary, primary component, or primary evidence record;
- calculate a blended price, normalized score, winner, cheapest label, fidelity/value/trust rank, or recommendation;
- order Offerings by Provider display name or any fact value; fixed Offering-ID inventory serialization is not presentation order;
- construct comparison rows, Offering Facts, collection metadata, pagination, filters, or user selection state; or
- expose a query RPC, API/OpenAPI contract, public route, cache object, or frontend component.

The later current-value policy must consume the complete set and make every exclusion or selected output explainable against its hash. This ADR intentionally does not approve that policy.

### Bounds and failure behavior

The projector inherits ADR 0056's pre-parse ceiling of 100,000 relevant resources, 32 MiB aggregate relevant UTF-8, 500,000 relationship edges, and the existing 1,000,000-byte per-resource ceiling. It separately admits at most 500,000 emitted graph memberships, counting the Provider, target, Offering, every Price, every PrecisionObservation, and every EvidenceSummary in each set; evidence repeated across Offering sets counts repeatedly. The projector increments and checks that output-specific ceiling before hashing or retaining each completed set. Shared canonical objects remain references rather than serialized copies. It may build shared bounded indexes once and project all Offerings in `O(R + E)` validation/indexing time plus the bounded emitted memberships. It must use bounded, non-sensitive diagnostics.

A failure in manifest reconciliation, exact-byte hashing, contract validation, identity, child membership, Provider display evidence closure, evidence deduplication, count agreement, or hash construction rejects the complete projection operation. There is no partial set, evidence dropping, history trimming, guessed Provider label, or best-effort fallback.

### Explicit deferrals

This decision does not define or implement:

- EvidenceSummary field/value equivalence, source precedence, factual entailment, or legal/source approval;
- current-value selection, supersession, overlap/conflict resolution, or publication-time evaluation;
- comparison-row fields, neutral default order, currency scope, sorting, filtering, pagination, or side-by-side selection;
- Offering Facts, provider comparison, provider pages, Model/Variant reverse-link presentation, or any web surface;
- query RPC, D1 read protocol, API route, OpenAPI response, cursor, cache, public ingress, or remote binding;
- provider acquisition, source access, pipeline execution, schema migration, provisioning, publication, deployment, or release authority.

All mapped traceability statuses remain unchanged.

## Consequences

- Later policy work receives one complete, byte-authentic observation inventory per Offering and cannot erase inconvenient history while assembling its input.
- Provider display name becomes available for later neutral presentation with the same explicit Fact state and evidence-subject guarantees as Offering observations.
- Deterministic aggregate counts, per-set hashes, and an inventory hash make projection identity independently testable without treating it as a durable or public contract.
- The projection deliberately carries more data than a comparison row; later bounded readers and response contracts must define their own smaller representations.
- No public behavior, current-fact claim, rank, API/UI surface, schema version, remote resource, or deployment authority changes.

## Alternatives considered

- **Choose current observations while building the set:** rejected because selection policy is unresolved and could silently hide conflicts, conditions, promotions, or history.
- **Use Offering child arrays without the complete persisted inventory:** rejected because omitted reverse-owned children would be invisible and the exact trusted-byte relationship would be lost.
- **Use the trusted manifest without exact persisted bytes:** rejected because descriptors authenticate content hashes but cannot supply or preserve the observation facts.
- **Accept already parsed canonical objects:** rejected because callers could pair altered values with trusted descriptors or lose exact canonical-byte identity. Parsed output is produced only inside the projector after exact-byte reconciliation.
- **Project only standard comparable Prices and summary precision:** rejected because that is selection and would discard required public history, conditions, and component detail.
- **Use Provider slug or source owner as display text:** rejected because neither is the canonical Provider display-name Fact.
- **Copy the complete Provider into every set:** rejected because unrelated Provider facts, coverage, and affiliate state are not inputs to observation selection and would widen the neutrality boundary.
- **Include all publication EvidenceSummary resources:** rejected because unrelated evidence is not part of one Offering's provenance closure and would create accidental cross-resource coupling.
- **Sort sets by Provider display name:** rejected because this projection has no multi-Offering presentation order and must not preempt `RULE-011` policy or imply rank.
- **Add an API or Offering Facts contract now:** rejected because current-value, comparison, transport, response-size, and presentation policies remain unresolved.

## Validation

- Reject untrusted, descriptor-only, structurally forged, or cross-publication manifests and incomplete, additional, duplicate, non-canonical, or content-hash-mismatched persisted inventories.
- Prove exact Provider, Offering, Price, PrecisionObservation, and EvidenceSummary contract/identity admission from the persisted bytes.
- Preserve zero, one, and many Prices and PrecisionObservations across every role, class, currency provenance, effective interval, Fact state, applicability, component, and evidence combination.
- Prove Provider display-name Fact copying and exact Provider-subject evidence closure, including known/unknown/unavailable/not-applicable states, missing evidence, cross-subject evidence, duplicate references, and evidence shared only within its valid subject.
- Prove that every ADR 0056-enumerated Offering, Price, PrecisionObservation, and component evidence reference is included exactly once and no unrelated evidence enters the set.
- Prove caller resource-array permutation invariance and stable-ID outer Price, PrecisionObservation, EvidenceSummary, and Offering-set order. Mutating valid internal array byte order must change the applicable exact-resource, set, and inventory hashes rather than being normalized away.
- Freeze deterministic version, aggregate membership counts, observation-set hashes, and inventory-hash fixtures; mutate every selected exact source byte, identity, or membership and require a changed hash or failure. Prove the mandatory inventory header distinguishes empty projections and binds closure/resource-inventory authority.
- Exercise the emitted-membership ceiling at and above its accepted bound, including repeated Provider display evidence across Offering sets.
- Prove no current/latest selection, history removal, overlap resolution, currency conversion, precision collapse, affiliate effect, score, rank, comparison order, API shape, or UI behavior is reachable.
- Exercise inherited resource/byte/edge limits and fail-closed behavior without partial output or unbounded diagnostics.
- Run the full local verification gate and independent data-correctness/neutrality and security/privacy reviews before marking Phase 5Y-B locally implemented. No review may advance traceability or grant public, remote, publication, or deployment authority.
