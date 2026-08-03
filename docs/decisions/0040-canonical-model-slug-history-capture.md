# ADR 0040: Capture canonical Model slug history under one drained publication boundary

- Status: Accepted
- Date: 2026-08-03
- Decision owners: Product owner, staff engineer, data lead, API lead, security and privacy lead
- Related requirements: `DATA-001`, `DATA-002`, `DATA-004`, `RULE-004`, `API-002`–`API-004`, `PIPE-044`, `PIPE-050`–`PIPE-055`, `BE-002`, `BE-003`, `BE-005`–`BE-007`, `BE-010`–`BE-012`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-001`, `QA-004`, `QA-006`, `QA-007`
- Extends: ADRs 0003, 0004, 0015, 0018, 0035, and 0039
- Supersedes: None

## Context

ADR 0039 deliberately accepts caller-supplied `slug_history`. Its two roots prove the exact supplied rows and their resolved route meaning, but cannot prove that a caller omitted no canonical row. Those roots therefore cannot authorize publication readiness, switching, rollback, restore, or a public slug lookup.

Canonical D1 and serving D1 are distinct databases. A transaction on either database cannot make their combined state atomic. Treating a read from canonical D1 followed by a serving write as one transaction would create an unrecorded gap in which canonical history, the publication manifest, or the serving candidate could disagree. Reading current canonical state during restore would create a second, time-dependent interpretation of an old publication.

The existing canonical `slug_history` schema is also too permissive for Model route authority. It accepts zero-duration intervals, a broader slug grammar, deletion and arbitrary update, overlapping intervals for one Model, and reuse of an ended Model slug by another Model. A later projection-time tie-break would hide those defects rather than preserve stable identity.

## Decision

### Split Phase 5O-B2 at the durable handoff

Phase 5O-B2 is split into three reviewable boundaries:

1. **B2A** hardens canonical Model-only history and implements the fixed canonical acquisition described below.
2. **B2B** writes and read-verifies one immutable, content-addressed private R2 capture artifact, then stages its exact projection in serving schema `1.12.0`.
3. **B2C** binds the archived artifact and serving projection to closure, readiness, switch, rollback, backup, restore, and an internal indexed read seam.

B2A does not make a capture authoritative for readiness. The trust handoff is complete only after B2B writes the capture artifact at its deterministic content address, reads it back, revalidates its closed contract and digest, and proves that the archived bytes reproduce the capture and both ADR 0039 roots. B2C must consume that archived object rather than reread mutable canonical state.

### One continuous canonical writer drain

The controlled publication coordinator must acquire the canonical single-writer lease and drain in-flight canonical writers before assembling the manifest and its exact canonical Model resources. It must hold that same lease continuously through Model-slug acquisition. A release and reacquisition between resource assembly and acquisition invalidates the candidate; retry starts from manifest/resource assembly.

The trusted manifest is the sole publication boundary: its `generatedAt` supplies the ADR 0039 boundary time. The acquisition scope is exactly the manifest's complete set of Model stable IDs. The caller may not add IDs, omit a manifest Model, substitute a resource type, or choose a second timestamp. Models outside that manifest are not added to the publication capture. This is a publication-scoped authority decision, not a deletion or reassignment of durable canonical history.

The coordinator-held drain is a control-plane precondition. A function argument or boolean cannot attest that it exists. B2A therefore returns a candidate capture and cannot independently assert publication readiness.

### Fixed primary-anchored acquisition

The pipeline opens a canonical D1 Session with `first-primary` and runs one fixed, bounded, prepared SELECT statement for the complete acquisition. Manifest Model IDs are supplied as validated data to that statement; they never change SQL text or identifiers. The statement:

- validates the exact `model-slug-history-guard@1` canonical capability marker and the requested-to-canonical Model-ID census through exact identity and Model-table joins;
- joins only exact requested IDs through `resource_identity`, `model`, and Model-target `slug_history`;
- returns every current canonical `model.slug` and each scoped history row whose assignment began no later than `manifest.generatedAt`;
- reconstructs interval state at the publication boundary: an end later than the boundary is represented as open at that boundary, while a row beginning later than the boundary is excluded;
- makes a missing/wrong marker, missing/duplicate/wrong-type target, malformed current slug or history, count overflow, truncation, or unexpected result shape fatal; and
- admits at most the ADR 0039 Model/history/byte ceilings, using overflow detection rather than silently truncating.

One statement, rather than a count query followed by a row query, prevents an internally split view. `first-primary` anchors the Session at the primary. The continuously held writer drain binds that statement to the same canonical publication assembly. The exact boundary rows and already assembled manifest-bound Model resources are then passed without repair or inference to `model-slug@1`. The adapter verifies three-way current-slug agreement among the trusted Model resource, the canonical `model.slug` returned by the statement, and the exactly one boundary-current history mapping. The acquisition result carries the source-history and resolved-mapping roots and counts.

After the statement completes, the pipeline obtains a private D1 bookmark from the same Session. The bookmark is a private operational locator and must never appear in a public resource, hash root, error, log, metric, trace, or request-derived key. It is not a substitute for the writer drain, a portable database snapshot, or the B2B archived artifact.

### Model-only canonical history guards

A forward canonical migration adds Model-only semantic preflight and guards without changing other resource route namespaces. Because the shared canonical `schema_metadata` version remains `1.0.0`, the migration also creates one immutable singleton `model_slug_history_integrity_metadata` capability row with exact `guard_version = 'model-slug-history-guard@1'`; acquisition requires that marker in its fixed statement:

- a Model history slug is 1–128 lowercase ASCII characters and matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`;
- `valid_to_ms` is null or strictly greater than `valid_from_ms`;
- intervals for one Model are non-overlapping and at most one is open;
- once a slug has appeared in Model history it remains owned by that same Model, including after closure;
- Model history rows cannot be deleted;
- an existing Model history row is immutable except for one close transition from null `valid_to_ms` to a valid later end, with identity, target, slug, and start unchanged; and
- inserting or closing a row cannot create overlap, transfer permanent ownership, or violate the strict grammar.

The migration must fail if pre-existing Model rows violate these rules; it must not delete, rewrite, normalize, choose a winner, or repair them. Guards determine Model membership through canonical resource identity and do not impose Model-route semantics on organization, family, variant, provider, offering, or other history. Agreement between the current `model.slug`, the trusted manifest Model resource, and the exactly one boundary-active history row remains a capture-time whole-publication check because those values participate in one publication assembly.

### Cross-database saga and fail-closed ordering

The canonical capture, R2 archive, serving stage, readiness commit, and head switch form a saga with immutable receipts and retry/reconciliation points. They are never described or implemented as a cross-D1 transaction.

Failure before the B2B R2 read-after-write verification leaves no authoritative slug capture. Failure after archival but before serving readiness may leave an unreachable immutable artifact for deterministic retry or reconciliation, but it cannot change the active head. Failure while staging serving `1.12.0` must leave the prior known-good publication selected. B2C must require exact publication, closure, artifact digest, source-history root/count, mapping root/count, and serving reconstruction agreement before readiness or switch.

### Closed route and privacy boundary

Serving schema remains `1.11.0` in B2A. B2A adds no serving row, closure field, receipt, readiness proof, switch proof, backup format, restore path, query RPC, public handler, Cache API entry, cookie, telemetry, remote binding, resource, provision, or deployment.

`/v1/models/{model_id_or_slug}` remains wholly closed. Redirect-versus-direct-read semantics remain a Phase 5O-B3 decision. All B2A inputs are controlled publication data; no visitor path, query, source address, actor key, or correlation identifier is accepted or retained.

## Consequences

- An ADR 0039 projection can be derived from one omission-detectable canonical acquisition scope rather than an arbitrary history array.
- Canonical Model history becomes append-oriented, non-overlapping, strictly encoded, and permanently owned without changing other resource namespaces.
- The publication writer drain is longer because it spans manifest/resource assembly and the single acquisition statement.
- A B2A result is still a candidate. Durable authority, serving schema `1.12.0`, lifecycle gates, restore, and internal reads remain explicit later work.
- The R2 artifact becomes the durable cross-database handoff and restore input; current canonical D1 is never the restore oracle for an old publication.
- The private bookmark assists controlled reconciliation but is neither public provenance nor proof of a cross-database transaction.

## Alternatives considered

- **Read history after releasing the canonical writer lease:** rejected because the manifest, current Model resources, and history could describe different canonical states.
- **Use separate count and row statements:** rejected because their results could form a split view and omission detection would depend on session timing.
- **Use a D1 bookmark as the durable authority:** rejected because the publication requires portable immutable rebuild input and the bookmark alone does not bind archived bytes or serving reconstruction.
- **Write serving D1 directly from the canonical query:** rejected because a failure between databases has no atomic rollback and restore would lack the original authoritative input.
- **Make all resource types obey Model slug rules:** rejected because ADR 0039 defines only the Model route namespace and other route semantics remain undecided.
- **Repair legacy invalid rows during migration:** rejected because silent normalization, deletion, or winner selection would destroy identity evidence.
- **Open the slug route after acquisition:** rejected because storage, lifecycle proofs, restore, internal lookup, HTTP semantics, and public acceptance remain incomplete.

## Validation

Phase 5O-B2A acceptance must prove:

- the migration aborts on malformed, zero-duration, overlapping, multiply open, transferred-ownership, and otherwise invalid pre-existing Model history without mutating it;
- Model inserts and the sole permitted close transition enforce strict grammar, half-open non-overlap, one open interval, permanent same-Model ownership, and immutable identity fields, while Model deletes and arbitrary updates fail;
- non-Model `slug_history` behavior is not silently redefined by the Model-only guards;
- acquisition prepares one fixed statement through one `first-primary` Session, obtains its bookmark privately, and uses no caller-generated SQL;
- exact `model-slug-history-guard@1` capability, manifest Model-ID census, identity/type membership, canonical-current/resource/history agreement, publication-boundary filtering and later-end clamping, complete row counts, deterministic ordering, and ADR 0039 roots are checked;
- missing, extra, duplicate, wrong-type, malformed, over-limit, truncated, inconsistent, or hostile D1 results fail closed without a partial capture;
- the canonical writer drain is an explicit coordinator precondition spanning manifest/resource assembly through acquisition, and no B2A type or result claims to attest the lease;
- serving schema `1.11.0`, readiness, switching, backup, restore, RPC, public routes, caches, privacy configuration, remote resources, and deployment remain unchanged; and
- documentation and traceability keep all affected release acceptance rows `Planned` until complete local and deployed evidence exists.

## References

- [ADR 0003: D1 and R2 storage topology](0003-d1-and-r2-storage-topology.md)
- [ADR 0015: Publication closure and lifecycle](0015-publication-closure-and-lifecycle.md)
- [ADR 0035: Canonical family/model/variant publication closure](0035-canonical-family-model-variant-publication-closure.md)
- [ADR 0039: Publication Model-slug projection core](0039-publication-model-slug-projection-core.md)
- [Phase 5O-B2A design contract](../design/phase-5o-b2a-canonical-model-slug-capture.md)
