# ADR 0042: Require archived Model-slug authority for publication lifecycle changes

- Status: Accepted
- Date: 2026-08-03
- Decision owners: Staff engineer, publication lead, data-integrity lead
- Related requirements: `DATA-001`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-002`–`BE-007`, `BE-010`–`BE-012`, `CF-022`, `SEC-011`, `SEC-012`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-006`
- Extends: ADRs 0015, 0018–0020, 0031, and 0039–0041

## Context

ADR 0041 establishes a portable Model-slug authority: a content-addressed private R2 sidecar is fully read-verified against the separately digest-bound base publication, and its exact current and historical route mapping is staged in serving D1. Serving schema `1.12.0` is intentionally dormant. It does not bind that authority to the closure seal, readiness ledger, activation, or rollback.

That dormancy is a compatibility boundary, not a state that may be deployed with legacy writers. The cumulative v4 lifecycle tables and triggers predate the sidecar. If they remained usable after migration 0015, a privileged legacy writer could seal, mark ready, or switch a publication without proving complete Model-slug history. Migration 0015 rejects proof-bearing lifecycle state at migration time, but that alone does not prevent a later v4 write. Schema `1.13.0`, the v5 proof family, and the corresponding fixed writers therefore must land as one hard cutover before any publication is staged.

Cloudflare documents that `D1Database.batch()` executes prepared statements sequentially as a SQL transaction and rolls the sequence back when a statement fails. A zero-row compare-and-swap is not itself an error, so the lifecycle adapters still require explicit aborting assertions inside the same batch. Cloudflare also documents that `withSession("first-primary")` anchors the first query at the primary and provides sequential consistency for later Session queries; bookmarks can start a later Session at least as new as the supplied database version. Those guarantees support bounded reconciliation and read continuity, but they do not create a transaction across canonical D1, serving D1, R2, or Vectorize.

## Decision

### Split the remaining B2C work into three reviewable boundaries

ADR 0042 fixes the complete direction while retaining three independently reviewable implementation slices:

1. **B2C-A lifecycle authority:** serving schema `1.13.0`, Model-slug-aware closure sealing, readiness v5, activation and rollback switch v5, and fresh archive verification for rollback.
2. **B2C-B portable recovery:** a new backup format and protected recovery authority that carry the sidecar beside the base bundle, plus a read-only isolated restore/rebuild transcript.
3. **B2C-C internal read:** an additive publication-pinned stable-ID/current-slug/historical-slug query operation over the exact serving indexes.

B2C-A must not claim backup, disaster recovery, internal lookup, public routing, deployment, or release acceptance. B2C-B must not import a current serving projection as truth or consult present canonical D1 for an old publication. B2C-C must not decide HTTP redirect, cache, CORS, or ETag behavior; Phase 5O-B3 owns those public semantics.

### Pristine schema 1.13 hard cutover

Migration `0016` advances only exact serving schema `1.12.0` with no closure seal, readiness receipt, attestation, switch preflight, switch-history event, head, Model-slug proof, or Model-slug mapping row. Every publication must still be `building` or `failed`. This is intentional: migration 0015 and its B2B staging implementation are a reviewed format boundary, not an intermediate remote deployment. The B2B staging adapter becomes compatible with the unchanged tables under schema `1.13.0`; all real staging occurs after migration 0016.

Before DDL, migration 0016 proves the exact retained foundational tables, columns, indexes, and triggers needed by schema `1.12.0`, and rejects every target-name collision. It then replaces the empty v4 readiness and switch family with v5 and recreates the complete cumulative lifecycle trigger set. The migration is applied only through the lockfile-pinned atomic Wrangler migration path. A failed statement must leave schema `1.12.0` unchanged and retryable.

The Model-slug tables remain immutable and retain the existing exact slug index:

```text
publication_model_slug_exact_idx
  (publication_id, slug, model_id)
```

Migration 0016 adds a partial unique reverse index:

```text
publication_model_slug_current_model_idx
  (publication_id, model_id)
  WHERE resolution = 'current'
```

The new index makes at-most-one current slug per Model structural and supplies a bounded current-mapping path. Closure validation still proves at-least-one current mapping for every exact Model resource, no extra mapping, content-hash equality, and exact current-slug bytes.

### Seal only after exact sidecar staging

Model-slug staging remains the final closure-bearing saga step. The artifact proof records its exact `publication_staging_revision`; every mapping and proof stays attached only to an unsealed `building` publication. The closure-seal insert guard now additionally requires:

- exactly one artifact proof for the same publication;
- proof revision equal to the seal revision;
- proof closure hash equal to the seal closure hash;
- proof base bundle hash equal to the seal bundle hash;
- proof boundary equal to `publication.generated_at_ms`;
- exact Model, source-history, total-mapping, current-mapping, and historical-mapping counts;
- complete bidirectional parity among current mappings, exact Model resources, canonical current slug bytes, and target content hashes; and
- both required named indexes with the accepted ordinary/partial, uniqueness, column-order, collation, and predicate semantics.

The controlled sealer reconstructs and validates the persisted proof and mapping roots before it requests the seal. SQL independently proves every equality and cardinality it can establish. The database does not pretend to recompute the domain-separated SHA-256 roots.

Any later closure-bearing write advances the staging revision and makes the staged proof ineligible to seal. No repair, replacement, delete, or implicit restaging path is added.

### V5 archive, serving, probe, readiness, and switch authority

The v5 family uses receipt version `5.0.0`, evaluator version `5.0.0`, preflight version `5.0.0`, and probe set `search-gold@5`. Switch-history event version remains `1.0.0` because the event already binds the complete versioned preflight hash.

The archive receipt preserves its existing base-bundle fields and adds one closed Model-slug suffix:

1. artifact version;
2. acquisition version;
3. projection version;
4. artifact digest;
5. artifact byte count;
6. source-history count;
7. source-history inventory hash; and
8. Model count;
9. total mapping count;
10. current mapping count;
11. historical mapping count;
12. mapping inventory hash;
13. read-verified Boolean; and
14. sidecar-immutable Boolean.

The archive receipt is valid only when these values exactly equal the staged artifact proof, the retained bundle equals the closure seal bundle, and both base-bundle and sidecar objects were independently read-verified through controlled private R2 bindings. `immutable=true` remains necessary but is not self-authenticating; production also requires separately verified private-bucket access, indefinite lock-policy coverage for both prefixes, and least-privilege identities. No R2 ETag, object timestamp, request identifier, or vendor-generated version becomes publication authority.

The serving receipt preserves the complete v4 field order and appends this Model-slug suffix:

1. storage version `model-slug-serving@1`;
2. artifact digest;
3. projection version `model-slug@1`;
4. Model count;
5. total mapping count;
6. current mapping count;
7. historical mapping count;
8. mapping inventory hash;
9. storage queryable Boolean; and
10. exact storage parity Boolean.

The probe receipt adds `model_slug_lookup_passed`. Gold probes cover deterministic hit and miss behavior for the exact slug index and current-Model reverse index without defining public redirect semantics.

Readiness accepts only nominal trusted base readiness evidence, a nominal ADR 0041 read-verified archive proof, and a nominal persisted Model-slug serving proof. The runtime-neutral v5 constructor recomputes every receipt and attestation hash. One fixed `D1Database.batch()` rechecks the exact seal, staged proof, mapping cardinality/parity, named-index semantics and probes; inserts or verifies all receipts and the attestation; transitions `building` to `ready`; and ends with an aborting exact postcondition. Partial, stale, legacy, structurally similar, reflected, caller-authored, or cross-publication proof objects cannot gain nominal authority.

### Exact-generation activation and rollback

Every activation or rollback uses a fresh v5 preflight whose canonical hash order is the unchanged complete v4 prefix, the fourteen-field Model-slug archive subtype, the exact v5 archive receipt hash, and then the ten-field Model-slug serving suffix. Initial and replacement activation additionally bind an unexpired v5 readiness attestation. The fixed switch batch rechecks the exact head generation and former-head fields, target lifecycle, closure seal, staged artifact proof, mapping parity, both named indexes, preflight, and activation attestation where required. It then persists or verifies the preflight, applies the lifecycle/head transition, appends or verifies one immutable history event, and aborts unless the complete poststate matches.

Rollback does not reuse the original readiness age. It is limited to the exact immediate `superseded` rollback candidate and requires fresh bounded proof that the retained target remains intact:

- read the exact content-addressed sidecar key derived from the protected expected digest;
- validate the hostile R2 object, exact bytes, versions, counts, roots, and canonical encoding;
- replay `model-slug@1` against the separately trusted retained base bundle;
- compare the result to the retained serving proof and mappings;
- force both named D1 indexes through deterministic hit/miss probes; and
- retain all existing fresh FTS, Vectorize, integrity, filter, neutrality, and version-isolation checks.

B2C-A adds the read-only sidecar verifier needed by this rollback preflight. It accepts nominal retained-base authority and a protected expected artifact identity, exposes no create, overwrite, delete, list, redirect, public fetch, or arbitrary key, and applies ADR 0041's hostile-input, UTF-8, byte, count, and conservative retained-heap limits. Present-day canonical D1 is never a rollback oracle.

Exact retry, stale generation, same-switch-ID conflict, ambiguous outcome, and corruption semantics remain those of ADR 0020. Reconciliation starts with a fresh primary-anchored Session and classifies only exact applied, exact not applied and retryable, conflict/stale, corruption, or outcome unknown. It never synthesizes a new authorization from the observed head.

### Recovery and internal-read deferrals remain hard gates

B2C-A freezes backup format `1.0.0`, its restore-source profiles, and restore transcripts as historical schema-through-`1.11.0` contracts. They must reject schema `1.13.0`; silently appending the sidecar tables would change a closed backup root and still fail to provide independent R2 recovery authority.

The original B2C-B forecast was `backup-v2@1` format `2.0.0`, `backup-v2-restore-source@1`, and `serving-restore-rebuild@6` over base plus Model-slug bytes. Proposed ADR 0045 would supersede that forecast before implementation with a three-artifact, schema-`1.14.0` lifecycle-v6 boundary if the product owner accepts its `BE-011` interpretation; the addendum below records the conditional successor. The unchanged principle is that export may inventory ordinary proof/mapping rows for migration-away completeness, but restore never imports them as truth. Cloudflare's D1 virtual-table export limitation still reinforces the writer-drained, ordinary-source, rebuild-index design.

B2C-C adds an internal SELECT-only V2 Model-detail lookup by exact stable ID, current slug, or historical slug relative to one already selected publication and one bookmark-continuous Session. It must verify canonical Model bytes and the staged artifact/seal authority and return lookup provenance without echoing hostile input. It remains unrouted. Phase 5O-B3 alone decides current/historical HTTP behavior, canonicalization, CORS, ETag, Cache API, response admission, and public conformance.

The accepted B2C-C implementation contract is recorded in [Phase 5O-B2C-C](../design/phase-5o-b2c-c-model-slug-internal-read.md). Its closed success provenance contains `matchedBy`, the verified canonical current slug, and projection version only; it never returns the submitted historical slug. This names the minimal internal result promised above without deciding B3's public behavior.

### Privacy, security, and deployment boundary

All B2C inputs are immutable publication facts, protected configuration, controlled writer identity, or version-controlled synthetic probes. No visitor path, query, URL, header, address, user agent, referrer, cookie, actor key, correlation identifier, click, telemetry event, or visitor-derived cache key enters a receipt, preflight, history event, R2 key, D1 row, log, metric, trace, alert, or artifact.

Public and query Workers receive no R2 write capability, canonical D1 binding, lifecycle mutation, generic SQL, pipeline trigger, or privileged diagnostic method. Public Workers remain without invocation logs, traces, analytics, custom telemetry, cookies, or browser persistence. No provisioning, remote migration, preview deployment, production deployment, or first publication is authorized by this ADR.

## Consequences

- No publication can seal, become ready, activate, or roll back without exact archived Model-slug authority and serving parity.
- The dormant schema `1.12.0` interval cannot become a legacy bypass because schema `1.13.0` accepts no v4 lifecycle writer or preexisting proof-bearing state.
- The second artifact digest becomes part of readiness and every switch authorization without changing the already closed base bundle hash.
- Rollback remains available after the original readiness evidence ages out, but only after fresh read-only verification of both retained archive components and current serving/index state.
- Backup v1 cannot falsely claim schema `1.13.0` completeness. Portable restore and internal slug reads remain explicit subsequent gates.
- Local lifecycle evidence still does not prove remote D1 behavior, bucket-lock enforcement, Vectorize visibility, RPO/RTO, multi-PoP behavior, public routing, or release readiness.

## Alternatives considered

- **Keep v4 lifecycle rows and add an optional slug receipt:** rejected because a legacy writer could omit the optional proof and still select a publication.
- **Backfill or reinterpret existing ready/active rows:** rejected because no deployed publication exists and missing archived history cannot be invented.
- **Include the sidecar digest in the existing base bundle hash:** rejected because capture occurs after base-manifest closure and would create a construction cycle.
- **Trust serving mappings without rereading R2:** rejected because serving projection alone is not portable archive or rollback authority.
- **Trust only R2 key, ETag, metadata, size, or lock configuration:** rejected because none independently proves the canonical body and its projection.
- **Use current canonical D1 during rollback or restore:** rejected because canonical history may have advanced and is not an old publication's recovery oracle.
- **Extend backup v1 in place:** rejected because it would silently change a closed manifest/table allowlist and still omit the independently protected sidecar identity.
- **Combine lifecycle, operational restore, internal query, and public HTTP in one implementation:** rejected because each has a distinct authority, failure, and acceptance boundary.

## Validation

- Apply migration 0016 only to an exact pristine schema `1.12.0`; reject every proof-bearing/lifecycle/head row, Model-slug staged row, wrong foundational object, target collision, malformed index, or legacy state without advancing metadata.
- Prove all-statement migration rollback, exact retry after repair, v4 writer rejection, and schema-`1.13.0` B2B staging compatibility.
- Reject sealing without exact proof/revision/closure/bundle/boundary/count/root parity, one current mapping per Model, bidirectional Model equality, or both accepted named indexes.
- Prove independent v5 archive, serving, attestation, preflight, and history hash vectors; exact suffix order; and v1–v4 rejection.
- Commit readiness and activation/rollback through fixed batches with injected failure at every statement; prove the prior head remains exact after every rejected or ambiguous path.
- Exercise initial activation, replacement activation, exact retry, competing generation, immediate rollback, expired original readiness, corrupted sidecar, wrong protected digest, base-bundle mismatch, mapping drift, index drift, and stale/corrupt retained targets.
- Prove the read-only R2 verifier has no write/delete/list operation, rejects hostile metadata/body/BOM/encoding/size/count/root cases, and does not consult canonical D1.
- Prove backup-v1 and current restore profiles reject schema `1.13.0`; B2C-B owns complete backup-v2 and isolated restore evidence.
- Prove the API/query/public route surface is unchanged and no visitor data, logs, traces, analytics, telemetry, cookie, cache key, request identifier, or public mutation is introduced.

## References

- [ADR 0019: seal-bound readiness](0019-seal-bound-readiness-ledger.md)
- [ADR 0020: exact-generation switching](0020-exact-generation-publication-switching.md)
- [ADR 0041: Model-slug sidecar archive and staging](0041-model-slug-sidecar-archive-and-staging.md)
- [Phase 5O-B2C-A implementation contract](../design/phase-5o-b2c-a-model-slug-lifecycle.md)
- [Cloudflare D1 Database API: batches and Sessions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare D1 import/export limitations](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## Addendum: lifecycle v6 recovery successor

[Proposed ADR 0045](0045-publication-bound-embedding-recovery.md) would supersede only this ADR's future-recovery assumption that schema `1.13.0` lifecycle v5 plus the base and Model-slug artifacts is sufficient restore authority. Existing schema-`1.13.0` implementation evidence remains valid for its closed local boundary. If product-owner-approved, public route opening would additionally require schema `1.14.0` lifecycle v6 to seal and prove the publication-time byte-authentic embedding artifact and its distinct output-value inventory digest. Legacy v5 authority cannot activate or restore a schema-`1.14.0` publication.
