# Phase 5L: Canonical publication relationship closure

## Status

Design is accepted under [ADR 0035](../decisions/0035-canonical-family-model-variant-publication-closure.md). The slice is locally implemented and has passed independent architecture and security/privacy review; complete repository verification is recorded with the implementation handoff. This slice is runtime-neutral, non-routable, schema-neutral, and zero-visitor-data. No requirement status advances from this local implementation.

## Slice objective

Close the persisted-publication trust gap among ModelFamily, Model, and Variant resources before adding more search filters or public navigation. A content-aware manifest may become trusted only when every forward and reverse ModelFamily/Model relationship agrees and every Variant resolves a Model in the same family.

## Fixed semantics

- Every relevant resource must pass its complete canonical contract and match its outer publication resource type and stable ID.
- Every Model must resolve its `family_id` to a ModelFamily and occur exactly once in that family's `model_ids`.
- Every ModelFamily `model_ids` entry must resolve a Model whose `family_id` is that family.
- Every Variant must resolve its `model_id` to a Model and carry the same `family_id` as that Model.
- ModelFamily `model_ids` is an unordered set. Input permutations cannot change acceptance.
- An empty ModelFamily is valid.
- Structural closure applies to all lifecycle states; inactive, stale, historical, or unknown records cannot be orphaned.
- Reverse Model-to-Variant navigation is derived from the complete set of Variants with matching `model_id`. No duplicated `variant_ids` list is introduced.

These semantics establish publication integrity only. They do not select which lifecycle states appear by default, define Model-filter inclusion of child Variants, create family or Variant routes, merge canonical and Variant provider comparisons, or complete `DATA-003` or `RULE-003` acceptance.

## Implementation boundary

### Contracts

Export a `ModelFamily` static type and a worker-safe `checkModelFamilyContract` from `packages/contracts`, preserving the same complete Fact, canonical date, Unicode-scalar, additional-property, stable-ID, and unique-item semantics as the existing Model and Variant validators. Do not create a relationship-aware schema or embed publication lookups in the contracts package.

### Runtime-neutral validator

Add one pure publication-core validator over the complete snapshotted persisted resource descriptors. It accepts only the already bounded canonical JSON strings and the descriptor-validated manifest identity.

The validator builds, at most:

- a family-ID set;
- a Model-ID-to-family-ID map;
- a Model-ID-to-listed-family-ID membership map; and
- bounded Variant relationship tuples, unless the implementation chooses an equivalent bounded second pass.

It verifies relevant resource contracts and outer/inner identities while constructing those inventories, then proves both ModelFamily/Model directions and every Variant/Model family equality. Duplicate relevant resource identities remain the existing manifest builder's responsibility; the relationship validator must not define a competing duplicate policy.

### Bounds

Reject before relationship-map construction when the combined number of ModelFamily, Model, and Variant resources exceeds 100,000. Reject when the sum of all ModelFamily `model_ids` entries exceeds 100,000. Preserve the existing 500,000-per-manifest-collection, 1,500,000 aggregate top-level item, 1,000,000-byte field/resource, 256 MiB aggregate string, canonical-JSON, and maximum-depth limits.

For `F` families, `M` Models, `V` Variants, and `E` family membership entries, the required algorithm is `O(F + M + V + E)` time and `O(F + M + V + E)` worst-case space. Error collection must also be bounded; fail fast with stable non-sensitive error classes rather than accumulating one message per hostile edge.

### Trust-boundary order

`buildImmutableManifestFromPersistedContent` remains the sole integration seam:

1. Snapshot the persisted manifest input and enforce existing collection/string budgets.
2. Canonicalize, recompute, and compare every persisted resource and search-document content hash.
3. Invoke `buildImmutableManifest` with descriptors and await its existing resource uniqueness, attribution, exact/vector inventory, chunk, identity, and hash validation.
4. Validate the complete persisted ModelFamily/Model/Variant relationship closure against that result.
5. Return the trusted immutable manifest only after step 4 succeeds.

The trusted object constructed during step 3 stays internal on failure. No caller may receive a manifest from the persisted-content builder before step 4.

Do not change descriptor-only `buildImmutableManifest`; it lacks canonical bytes and retains its current nominal descriptor contract. Do not add JSON relationship triggers, tables, columns, indexes, migrations, proof fields, readiness suffixes, backup fields, or public read-time validation. Do not modify the search readers, query RPC, API handler, web application, routes, cursor, cache, or privacy boundary.

## Compatibility and cutover

This is a pre-release hard cutover with no legacy mode. After implementation, every content-aware seal, readiness, switch, retained-publication, reconstruction, backup, restore, and test projection that reaches the persisted-content builder must provide a closed resource set.

Update shared fixture builders before leaf tests so every fixture containing a Model or Variant also contains the required ModelFamily resource and correct `model_ids`. Recompute content hashes, resource counts, chunk inventories, bundle/closure hashes, and expected seal values through existing deterministic helpers; do not hand-edit derived digests.

Serving schema remains `1.9.0`. Manifest contract `1.0.0`, readiness/switch proof versions, seal shape, backup-v1 shape, restore coordinator contract, and public OpenAPI remain unchanged. Because no production publication exists, no old relationship-invalid closure is retained or grandfathered.

## Acceptance matrix

1. **Contracts and identity:** valid ModelFamily/Model/Variant resources; malformed JSON, excess keys, invalid facts, wrong resource type, and outer/inner stable-ID disagreement fail closed.
2. **ModelFamily/Model closure:** empty family; one and many Models; missing family; omitted Model; dangling `model_ids`; wrong-family Model; duplicate membership; Model listed by the wrong or multiple families.
3. **Variant closure:** zero and many Variants; missing Model; wrong Model ID; Variant/Model family mismatch; Variant whose Model resolves through a valid family.
4. **Lifecycle independence:** the same relationship rules for active, inactive, stale, historical, conditional, and unknown fact states.
5. **Bounds:** relevant-resource and membership-edge limits at `limit - 1`, `limit`, and `limit + 1`; existing aggregate byte, resource byte, canonical JSON, and depth bounds remain effective.
6. **Determinism:** resource and `model_ids` permutations preserve acceptance; failures are bounded and static; the validator uses no provider, Offering, precision, price, affiliate, search score, insertion order, clock, randomness, network, or storage input.
7. **Boundary order:** bad content hashes and descriptor closure fail before relationship validation; relationship failure prevents the persisted builder from returning its internally constructed trusted manifest.
8. **Integration inheritance:** seal/readiness/switch/retained/backup/restore projections fail closed through the common builder, with the prior known-good publication unchanged where an operation can affect a head.
9. **Compatibility:** descriptor-only manifests retain their current behavior; schema `1.9.0` and existing seal/readiness/switch/backup shapes pass drift checks unchanged.
10. **Privacy and security:** no public route, D1 DML, cookie, persistence, Cache API, request input, visitor identifier, log, trace, analytics, telemetry, or correlation ID is introduced.

## Requirement handoff and nonclaims

- `DATA-002`: contributes exact Model-to-ModelFamily referential integrity but not complete canonical fact or public acceptance.
- `DATA-003`: contributes explicit Variant-to-Model/family integrity and a complete derived reverse relationship, but not page navigation or full bidirectional presentation acceptance.
- `RULE-003`: supplies a trustworthy canonical relationship prerequisite only; Model/Variant pages, explanatory copy, and separate provider comparisons remain pending.
- `BE-003`, `BE-005`, `BE-011`: contributes a controlled, reproducible, content-aware publication constraint without moving validation to a public reader or search index.
- `QA-006`, `QA-010`: provides local failure-path, canonical-versus-Variant, and known-good-head preservation evidence; remote deployment and full release acceptance remain pending.

No traceability status advances from this local implementation. Complete canonical data, page navigation, public API/web integration, remote deployment, operational restore, and release gates remain pending.
