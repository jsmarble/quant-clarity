# ADR 0035: Validate canonical family, model, and variant publication closure

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Product owner, staff engineer, data architecture lead, pipeline lead, security and privacy lead
- Related requirements: `DATA-002`, `DATA-003`, `RULE-003`, `BE-003`, `BE-005`, `BE-011`, `QA-006`, `QA-010`
- Extends: ADRs 0004, 0015, 0018, 0025, and 0034
- Supersedes: None

## Context

The canonical contracts require every Model to carry `family_id`, every Variant to carry `model_id` and `family_id`, and every ModelFamily to carry a unique `model_ids` array. The persisted publication manifest already commits the canonical resource bytes, but its descriptor-level closure proves inventory and content hashes rather than these cross-resource relationships.

[ADR 0034](0034-canonical-family-filtering.md) and Phase 5K deliberately read only a contract-valid target's structural `family_id`. They fail closed on malformed targets but do not prove that the referenced ModelFamily exists, that both directions of the ModelFamily/Model relationship agree, or that a Variant resolves a Model in the same family. A sealed publication can therefore be internally self-consistent at the descriptor/hash layer while carrying orphaned or contradictory family relationships.

`DATA-003` requires bidirectional family/variant links but does not require duplicated `variant_ids` arrays in Model or ModelFamily. Duplicating that derived relationship would create a second canonical inventory that could drift. The complete set of Variant resources can instead provide the reverse Model-to-Variant relationship by exact `Variant.model_id` lookup. This decision fixes that storage interpretation without claiming the public navigation and explanatory behavior required by `RULE-003`.

QuantClarity has not deployed a production publication. Compatibility with family-less development fixtures is therefore less valuable than establishing one canonical publication-validity rule before launch.

## Decision

A persisted publication is family/model/variant closed only when all of the following hold:

1. Every ModelFamily, Model, and Variant resource is contract-valid, and its embedded `family_id`, `model_id`, or `variant_id` identity, as applicable, equals the outer publication resource ID.
2. Every Model's `family_id` resolves exactly one ModelFamily, and that Model's `model_id` appears exactly once in the family's `model_ids`.
3. Every entry in a ModelFamily's `model_ids` resolves exactly one Model whose `family_id` equals that family.
4. Every Variant's `model_id` resolves exactly one Model, and the Variant's `family_id` equals that Model's `family_id`. The Model rule then proves that the shared family exists.

The ModelFamily contract's `uniqueItems` rule makes `model_ids` an unordered set for closure purposes. Array order is neither validated nor used as a display, publication, or query ordering input. A ModelFamily with an empty `model_ids` array is valid. Relationship closure applies to every published ModelFamily, Model, and Variant regardless of active, inactive, stale, historical, or unknown lifecycle facts; lifecycle does not weaken referential integrity.

The complete Variant inventory is the canonical forward relationship from Variant to Model. Reverse Model-to-Variant navigation is derived by selecting every Variant whose `model_id` equals the Model ID. No `variant_ids` field or other duplicated reverse inventory is added by this decision.

The validator is runtime-neutral and bounded before any input-dependent relationship allocation can grow beyond the accepted envelope:

- at most 100,000 ModelFamily, Model, and Variant resources in aggregate;
- at most 100,000 total entries across every ModelFamily `model_ids` array; and
- the existing persisted-manifest item, per-field, aggregate-byte, canonical-JSON depth, and resource-byte ceilings remain in force.

The relevant-resource cap is checked before relevant JSON parsing. The membership-edge counter is checked incrementally while each contract-valid ModelFamily is processed and before an over-limit edge is retained.

For `F` ModelFamilies, `M` Models, `V` Variants, and `E` ModelFamily membership entries, validation is `O(F + M + V + E)` time and `O(F + M + V + E)` worst-case space. Implementations may avoid retaining Variant tuples with a bounded second pass, but must not replace the stated ceilings with an input-dependent scan or query.

The only integration point is `buildImmutableManifestFromPersistedContent`. It snapshots the caller input, recomputes and verifies canonical resource hashes, and invokes the existing descriptor-level immutable-manifest builder first. Only after that manifest has validated resource shape, uniqueness, inventories, vectors, and hashes does the persisted-content builder validate the complete family/model/variant resource set. The trusted manifest is returned to the caller only after relationship closure succeeds. An internally constructed manifest that fails relationship validation does not escape the function.

The descriptor-only `buildImmutableManifest` remains unchanged because it does not receive canonical resource bytes and cannot prove these relationships. SQL constraints and closure-seal triggers remain unchanged; duplicating JSON-contract relationship logic in D1 would create a second validator and require avoidable migration/version coupling. Public readers, RPCs, API routes, search ordering, filters, and result facts remain unchanged.

This is a pre-release hard cutover. All persisted-content builder callers, including seal projection, readiness, retained-publication verification, backup/restore projections, and tests, accept only relationship-closed publications after implementation. Family-less or contradictory fixtures are updated to canonical closed fixtures with deterministically regenerated hashes and counts. There is no grandfathered legacy path.

Serving schema remains `1.9.0`; manifest contract version, readiness proof version, closure-seal shape, backup format, and restore protocol version do not change. The existing closure hash already commits the validated resource bytes, and the build commit identifies the validating implementation. No separate durable relationship proof is introduced.

## Consequences

- A persisted publication cannot be sealed, reprojected, considered ready, switched, or restored through the common content-aware boundary with an orphaned or contradictory family/model/variant relationship.
- Phase 5K's family predicate can rely on a stronger publication invariant once this decision is implemented, while its fixed SQL and serving schema remain unchanged.
- The contracts package needs a ModelFamily static type and worker-safe contract checker equivalent to the existing Model and Variant checkers.
- Existing development fixtures that contain Models or Variants without ModelFamily resources become invalid and must be regenerated as closed fixtures.
- Empty families, historical records, and multiple Models in one family remain supported.
- This decision contributes to `DATA-002` and `DATA-003` but does not complete canonical-data acceptance, Model/Variant pages, reverse-link presentation, provider-comparison separation, or `RULE-003`.
- No D1 migration, proof-version cascade, public route, deployment, resource provisioning, visitor state, request log, trace, analytics, telemetry, or cache behavior is introduced.

## Alternatives considered

- Validate relationships in descriptor-only manifest construction: rejected because descriptors contain no canonical resource JSON.
- Add D1 triggers using `json_extract`: rejected because this would duplicate contract semantics, couple publication validity to a serving migration, and still leave non-D1 persisted projections with a different trust boundary.
- Add a separate durable closure-proof version: rejected for the pre-release cutover because the existing closure hash commits the resource bytes and no deployed legacy publication must coexist. A future compatibility requirement would need a new decision.
- Grandfather family-less publications: rejected because there is no production dataset and every retained or restored publication should satisfy the same invariant before launch.
- Add `variant_ids` to Model or ModelFamily: rejected because the complete Variant inventory already provides the reverse relation and a second canonical list could drift.
- Require every ModelFamily to contain a Model: rejected because the contract permits an empty `model_ids` array and the requirements do not forbid empty families.
- Treat lifecycle state as permission for broken links: rejected because history and inactive records remain canonical published resources.
- Sort `model_ids`: rejected because closure requires set equality, not presentation order.

## Validation

- Prove exact acceptance for closed empty-family, one-family/one-model, multi-model family, zero-Variant, and multiple-Variant publications.
- Prove rejection of malformed relevant resources, outer/embedded identity mismatch, missing family, missing Model, omitted forward membership, dangling reverse membership, cross-family membership, duplicate family membership, and Variant/Model family disagreement.
- Prove relationship validation covers inactive, stale, historical, and unknown fact states identically.
- Prove the 100,000 relevant-resource and 100,000 membership-edge boundaries at `limit - 1`, `limit`, and `limit + 1`, plus existing JSON and manifest byte/depth limits.
- Prove permutation invariance for resource order and `model_ids` order, deterministic static failures, and no provider, Offering, price, precision, affiliate, or search-ranking inputs.
- Prove descriptor-only manifest construction remains compatible and cannot be presented as relationship validation.
- Prove persisted-content construction validates hashes and descriptor closure before relationships and never returns a trusted manifest after relationship failure.
- Prove seal, readiness, switch, retained-publication, backup/restore, and fixture call paths inherit the common failure boundary without a D1 schema or proof-version change.
- Run contract, publication-core, worker-runtime, privacy, format, lint, type, build, and full verification gates before accepting implementation.
