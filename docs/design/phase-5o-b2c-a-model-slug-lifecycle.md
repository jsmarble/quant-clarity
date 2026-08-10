# Phase 5O-B2C-A: Model-slug lifecycle authority

| Attribute | Value |
|---|---|
| Status | Locally implemented and verified; remote and release gates remain pending |
| Decision | [ADR 0042](../decisions/0042-model-slug-lifecycle-authority.md) |
| Prerequisites | [Phase 5O-B2A](phase-5o-b2a-canonical-model-slug-capture.md), [Phase 5O-B2B](phase-5o-b2b-model-slug-archive-staging.md) |
| Requirements | `DATA-001`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-002`–`BE-007`, `BE-010`–`BE-012`, `CF-022`, `SEC-011`, `SEC-012`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-006` |

## Outcome and release boundary

B2C-A makes the archived Model-slug sidecar a mandatory publication-lifecycle authority. Serving migration `0016`, closure-seal guards, the v5 proof core, fixed readiness and switch adapters, rollback's read-only sidecar verification, and the B2B writer's schema-`1.13.0` compatibility land together. No intermediate combination is compatible.

The slice remains local and controlled. It adds no portable exporter/restore (the former backup-v2 forecast is superseded), internal slug query RPC, public route, redirect, cache, Cloudflare resource, remote migration, provisioning, or deployment. A locally active test publication is not a production-ready publication.

## Atomic schema cutover

Migration `0016_model_slug_lifecycle.sql` advances exact pristine serving schema `1.12.0` to `1.13.0`. Before its first mutation it must reject:

- wrong or duplicate schema metadata;
- any publication state other than `building|failed`;
- any closure seal, readiness binding/subtype, attestation, switch preflight/history, or head;
- any Model-slug artifact-proof or mapping row;
- a missing, unexpected, malformed, renamed, or semantically different required schema-`1.12.0` logical table, FTS shadow table, column, index, or trigger;
- a present but noncanonical Wrangler/workerd control table; and
- every colliding schema-`1.13.0` object name.

After all preflights pass, the migration:

1. adds `publication_model_slug_current_model_idx` as a partial unique index on `(publication_id, model_id)` where `resolution='current'`;
2. replaces the empty cumulative v4 readiness/switch tables with v5 shapes;
3. recreates the complete lifecycle, seal, readiness, head, switch, retention, dataset-summary, projection, and immutability trigger inventory from canonical definitions; and
4. advances metadata to `1.13.0` last.

The migration must not infer, copy, repair, or grandfather lifecycle evidence. Local SQLite tests apply the whole file inside an explicit transaction and inject failure at every statement. Workerd tests apply it through the pinned runtime. The production path, when separately authorized, is the lockfile-pinned atomic Wrangler migration mechanism.

The preflight inventories all 28 logical tables, 16 named indexes, 103 triggers, and all ten FTS5 shadow tables. It exact-allows only the two observed canonical `d1_migrations` renderings from the lockfile-pinned Wrangler and workerd runtimes and the exact workerd `_cf_METADATA` table when those control tables are present. Migration 0016 contains 103 statements; its largest statement is 57,127 bytes, below the current 100,000-byte D1 statement limit. `publication_switch_preflight` uses 88 of D1's 100 columns, leaving 12 columns of schema headroom. Any future expansion must re-audit both ceilings against current official Cloudflare documentation and pinned runtime behavior.

Migration 0015 is not remotely deployed on its own. The existing B2B staging code must accept exact schema `1.12.0` in its historical tests and exact schema `1.13.0` for the live B2C path without weakening any table, revision, closure, count, mapping, or index check.

## Closure-seal extension

The artifact proof remains the final pre-seal row. A v5-capable sealer accepts only the nominal staged proof returned by B2B, reconstructs the complete persisted projection, and validates:

```text
publication + staging revision + closure seal plan
  == staged artifact publication/revision/closure/base bundle/boundary
  == exact persisted artifact proof
  == exact complete Model/current/history mapping projection
```

The SQL seal guard independently enforces exact identity, revision, closure, base bundle, boundary, declared counts, current-Model coverage, no extra mapping, resource hash equality, current slug equality, and both named indexes. `publication_model_slug_exact_idx` serves slug-to-Model equality. The partial unique current index enforces one current row per Model and serves Model-to-current-slug parity.

A row staged under revision N cannot seal after any revision N+1 closure-bearing mutation. The adapter does not update, delete, replace, or silently restage immutable rows.

## Runtime-neutral v5 proof core

The implementation retains every v4 field and hash order, then adds closed Model-slug evidence. Constants are:

```text
readiness receipt       5.0.0
readiness evaluator     5.0.0
switch preflight        5.0.0
probe set               search-gold@5
switch event            1.0.0
Model-slug storage      model-slug-serving@1
```

The archive subtype gains the fourteen ADR 0042 fields for artifact versions, digest, byte count, source-history count/root, complete projection counts/root, read verification, and sidecar immutability. The serving subtype gains the ten-field storage/digest/projection/count/root/queryability/parity suffix. The probe subtype gains `model_slug_lookup_passed`.

All new fields use the existing length-prefixed domain-separated hash encoding. Independent hash-oracle tests must prove fixed byte order and detect field swaps, omission, appended extras, wrong Boolean/type encoding, count drift, digest drift, and legacy v1–v4 values. Nominal constructors accept only the nominal B2B archive/staging proofs and existing nominal v4 prerequisites; no bare Boolean or digest can promote a structurally similar object.

## Archive-bound readiness protocol

The controlled pipeline order is fixed:

1. assemble and validate the immutable base publication;
2. capture canonical Model-slug history under the continuous writer drain;
3. conditionally create and fully read-verify the sidecar;
4. stage exact mappings and proof in schema `1.13.0`;
5. seal the complete publication;
6. collect base archive, serving, Vectorize, FTS, and synthetic probe evidence;
7. derive nominal v5 receipt rows and attestation; and
8. commit readiness in one fixed serving-D1 batch.

The readiness adapter validates and detaches all trusted inputs and resource bounds before D1. A fresh `first-primary` Session reconstructs the persisted seal, artifact proof, mappings, both indexes, and prior idempotent state. The mutation batch begins with aborting exact proof/mapping/index assertions, inserts or verifies the four bindings and typed receipts, inserts or verifies the attestation, changes `building` to `ready`, and asserts the exact poststate.

An exact retry is idempotent. A missing candidate prestate may retry. Partial immutable evidence, changed revision, wrong environment, stale receipt, legacy version, mapping/index drift, lifecycle drift, or an uncertain post-reconciliation state fails closed. No readiness path mutates the singleton head.

## V5 activation and rollback protocol

The v5 switch planner preserves ADR 0020's exact-generation compare-and-swap and ADR 0031's retained-hot semantics. Its 88-field preflight uses the unchanged complete v4 prefix followed by the fourteen-field Model-slug archive subtype, exact v5 archive receipt hash, and ten-field Model-slug serving suffix; the fixed batch rechecks the same authority.

Activation requires the exact unexpired v5 readiness attestation. Rollback ignores the old receipt age but accepts only the current head's immediate `superseded` rollback candidate. Before deriving rollback authority, the pipeline must freshly verify the retained target:

1. obtain nominal retained base-bundle authority from protected publication storage;
2. derive the sole allowed sidecar key from the protected expected digest;
3. read the private R2 object without writing;
4. apply ADR 0041's hostile metadata/body, exact UTF-8/canonical bytes, count, root, byte, and 80 MiB conservative retained-heap checks;
5. replay `model-slug@1` against the retained base Model resources;
6. compare every result to the retained serving proof/mappings; and
7. rerun both named-index hit/miss probes plus all existing FTS/Vectorize/synthetic checks.

The read-only verifier exposes no arbitrary key, create, overwrite, copy, multipart, list, delete, redirect, or public fetch method. Expected digest and base authority never come from the object being verified or present canonical D1.

The switch mutation is one fixed `D1Database.batch()` with in-transaction assertions before and after lifecycle/head/history mutation. Reconciliation uses a new `first-primary` Session and exact immutable identities. Response loss cannot produce a second generation; a stale or conflicting operation cannot be regenerated under the same switch ID.

## Bounded implementation work packages

### A. Migration and storage guards

- add migration 0016 and schema inventory checks;
- add the partial unique current-Model index;
- replace v4 lifecycle schemas/triggers with v5;
- extend seal guards and B2B staging compatibility;
- add native SQLite and pinned-workerd migration, index, and failure-ordinal tests.

### B. V5 proof kernel

- add closed v5 archive/serving/probe/attestation/preflight types;
- derive nominal proofs from B2B authority and existing v4 primitives;
- add independent hash oracles and legacy-version rejection;
- preserve all v1–v4 exports and fixed vectors as historical compatibility fixtures.

### C. Readiness adapter

- add one fixed v5 reconstruction and commit path;
- assert exact artifact/mapping/index parity inside the batch;
- classify exact retry, not applied, stale/conflict, corruption, and unknown outcomes;
- inject failure at every deterministic batch statement in fake-D1 and workerd.

### D. Switch and rollback adapter

- add v5 preflight and fixed activation/rollback batch;
- add read-only hostile R2 verification for retained rollback targets;
- retain generation, history, readiness-expiry, retained-hot, and ambiguity semantics;
- cover first/replacement activation, A-to-B-to-C displacement, immediate rollback, stale races, expired readiness, artifact/index drift, and response loss.

## Capacity and query bounds

B2C-A does not raise B2B's limits: 25,000 Models, 50,000 source-history rows/mappings, 24 MiB artifact bytes, 750,000-byte staging payloads, 256-row mapping readback pages, and 80 MiB conservative retained heap. Every new adapter must account for its complete success and catch-path D1 statements before D1 access and remain within the repository's accepted lower ceilings.

The readiness and switch batches use fixed prepared SQL and bound values only. SQL statement count, bound parameter count, largest bound payload, retained JSON, D1 query count, R2 reads, Vectorize operations, and peak retained-heap estimate must have explicit constants and accepted-bound tests. Implementation may lower a limit when evidence requires it. Raising a limit or paging one logical readiness/switch mutation across transactions requires a follow-up ADR.

## Failure, security, and privacy boundaries

- Canonical D1, serving D1, R2, and Vectorize remain a saga. An external orphan may exist, but no partial step changes the active head.
- Public/query identities cannot stage, seal, mark ready, switch, roll back, read private R2, run generic SQL, or trigger the pipeline.
- Static errors do not echo SQL, D1/R2 internals, object keys, digests not already public, bookmarks, payloads, paths, headers, or identifiers derived from a request.
- The new code receives no public Request, visitor path/query/header/address, cookie, actor key, correlation ID, click, telemetry, cache, or browser-storage input.
- Public Workers add no `console.*`, invocation logs/traces, analytics, custom telemetry, cookies, beacons, or visitor-derived durable key.
- No remote migration, resource mutation, deployment, or publication command is part of this slice.

## Acceptance matrix

| Requirement evidence | B2C-A local acceptance | Deferred boundary |
|---|---|---|
| `DATA-001`, `PIPE-044`, `PIPE-050`–`PIPE-052`, `QA-006` | Pristine 1.13 cutover, seal-bound artifact/mapping closure, v5 atomic readiness and switch failure injection | Remote D1/R2/Vectorize and deployed publication chaos |
| `PIPE-053`–`PIPE-056` | Fresh archive-bound activation/rollback, exact generation/history, retained-hot target checks, head preservation | Operational rollback timing and multi-PoP/cache evidence |
| `BE-002`–`BE-007` | Immutable indexed mapping, exact content parity, controlled writer/read-only verifier boundaries | Complete deployed database and identity evidence |
| `BE-010`–`BE-012` | Backup-v1 rejection at 1.13; proposed ADR 0045 would supersede the planned two-artifact authority after owner approval | B2C-B schema-1.14 lifecycle v6, backup-v3, isolated restore, migration-away, RPO/RTO evidence |
| `SEC-011`, `SEC-012` | Hostile bounded private-R2 read; no canonical query or public R2 surface | Remote egress/bucket-policy verification |
| `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011` | Controlled publication facts only; no visitor surface, persistence, cache, or telemetry | Deployed infrastructure/accountability verification |

No traceability status advances solely from B2C-A local evidence. `DATA-001` remains `Implemented`; all mapped pipeline, backend, security, privacy, quality, and release rows retain their current status until their complete acceptance sets pass.

## Explicit deferrals

### B2C-B: backup and isolated restore

Proposed ADR 0045 would supersede this phase's unimplemented B2C-B forecast after product-owner acceptance. B2C-B would then own publication-time `publication-embedding-artifact@1`, schema-`1.14.0` lifecycle v6, protected three-artifact `backup-v3@1`, `backup-v3-restore-source@1`, `serving-restore-rebuild@6`, independent sidecar read verification, FTS rebuild, exact accepted Vectorize-value restoration, fail-closed current-query-policy compatibility, and RPO/RTO exercise evidence. It must never treat backed-up proof/mapping rows, current Vectorize, or current canonical D1 as restore truth.

### B2C-C: internal publication-pinned lookup

B2C-C owns one additive V2 Model-detail operation that classifies exact stable IDs and strict slugs, uses one bookmark-continuous Session and fixed SELECT-only query, proves seal/artifact/current-mapping integrity, and returns stable/current/historical lookup provenance. It remains internal and unrouted.

### Phase 5O-B3: public route semantics

B3 owns `/v1/models/{model_id_or_slug}`, current versus historical HTTP behavior, canonicalization, GET/HEAD/OPTIONS, CORS, ETag, path-only canonical stable-ID caching, response-size/load admission, public error mapping, OpenAPI conformance, remote binding, and deployment gates.

## Required verification before implementation may be called local-complete

1. Migration/schema inventory and all-statement rollback in native SQLite and pinned workerd.
2. Seal rejection for every identity/revision/count/root/resource/current-slug/index mismatch.
3. Independent v5 hash vectors and v1–v4 compatibility/rejection suites.
4. Readiness and switch fake-D1 plus real-workerd success, exact retry, conflict, stale, corruption, ambiguous-response, and all-statement failure suites.
5. Hostile read-only R2 verification including absent body, wrong metadata, BOM, invalid UTF-8, noncanonical JSON, truncation/extra bytes, digest/root/count drift, overflow, and wrong base bundle.
6. Accepted-bound Model/history/artifact/mapping/heap/query-count tests without limit increases.
7. Backup-v1/schema-1.13 rejection and unchanged public/API/query surface tests.
8. `format`, `lint`, `typecheck`, contract drift, Cloudflare type drift, environment isolation, supply chain, build, zero-visitor-data, unit, worker-runtime, and full `verify` gates.

Local result: complete. The full repository `verify` gate passes with schema migration, lifecycle, hostile-input, failure-path, unit, pinned-workerd, build, browser/accessibility, supply-chain, and zero-visitor-data evidence. This result does not authorize or claim a remote migration, provisioned resource, deployment, or release gate.
