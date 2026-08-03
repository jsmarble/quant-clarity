# ADR 0043: Require byte-authentic publication recovery before backup-v2 restore

- Status: Accepted
- Date: 2026-08-03
- Decision owners: Staff engineer, recovery lead, security lead
- Related requirements: `DATA-001`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-007`, `BE-010`–`BE-012`, `CF-008`, `SEC-011`, `SEC-012`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `OPS-006`, `OPS-008`, `QA-006`
- Extends: ADRs 0003, 0015, 0041, and 0042

## Context

ADR 0042 requires backup format `2.0.0` to restore serving schema `1.13.0` from an independently verified base publication bundle plus the Model-slug sidecar. Repository review found that the existing `bundleHash`, backup-v1 manifest, and restore callbacks do not establish retrievable base bytes. They bind descriptors, counts, or caller-reported hashes. No current component serializes, writes, rereads, bounds, decodes, independently hashes, and semantically replays a base publication archive from private R2.

A backup-v2 catalog layered directly on that seam could therefore be internally consistent while its base bytes were absent, substituted, or corrupt. It could also select itself as the newest trusted catalog. Content addressing and bucket locks do not solve that trust-bootstrap problem: an actor allowed to create objects could create a different self-consistent catalog, and a sufficiently privileged configuration actor could remove a lock.

Cloudflare also documents material operational limits. D1 cannot export a database while it contains virtual tables such as FTS5, and a running export blocks other database requests. D1 Time Travel is an in-place destructive restore rather than an isolated clone. R2 account Audit Logs exclude object `GetObject` and `PutObject` data operations. Workers have finite subrequest, CPU, and memory limits. These constraints require a bounded application-owned logical archive, independently protected catalog selection, fresh isolated targets, rebuilt indexes, and an explicit non-visitor control-plane audit design.

## Decision

### Split B2C-B at the missing authority boundary

B2C-B is implemented in independently reviewable slices:

1. **B2C-B1 — byte-authentic base archive.** Define `publication-recovery-base@1`, its closed chunk codec, content-addressed create-only private-R2 writer, and exact-key get-only hostile reader. Complete readback and semantic closure replay mint a nominal byte-and-semantic verification result. It becomes trusted restore authority only when B2 matches it to the independently protected catalog root.
2. **B2C-B2 — protected two-artifact catalog and isolated restore.** Define `backup-v2@1`, format `2.0.0`, an independently protected expected catalog digest, `backup-v2-restore-source@1`, and `serving-restore-rebuild@6`. The restore verifies every base object and the existing Model-slug sidecar before it can access the destination.
3. **B2C-B3 — operational portability evidence.** Complete canonical D1 and evidence-link recovery, offline migration-away verification, protected access auditing, remote D1/R2/Vectorize exercises, and measured RPO/RTO. Only this operational slice can advance `BE-010`, `OPS-008`, or the restore-and-rebuild release gate.

The split refines, but does not weaken or amend, ADR 0042. No B2C-B slice adds a public route, visitor input, deployment, provisioning, or production mutation.

### Closed base archive and canonical source set

`publication-recovery-base@1` is a manifest plus content-addressed chunks. It carries only the eight publication-scoped source relations required to reconstruct the immutable serving closure:

1. publication;
2. provider slices;
3. provider-slice metadata;
4. provider attribution;
5. canonical resource bytes;
6. exact-search source-document bytes;
7. vector inventory; and
8. publication inventory chunks.

Each relation has a fixed versioned row schema, primary sort key, maximum row count, maximum encoded row size, and maximum chunk size. A chunk contains a fixed ASCII format/domain prefix followed by canonical length-prefixed UTF-8 JSON row bytes. Object keys derive only from the environment-qualified fixed prefix, publication ID, relation, ordinal, and independently computed domain-separated digest. The canonical manifest fixes the ordered relation inventory and every chunk key, ordinal, first/last key, row count, byte count, and digest. The manifest is itself canonical, content-addressed, and create-only.

The base archive does not carry DDL, SQL, object names supplied by data, FTS virtual/shadow tables, Vectorize contents, derived search projections, Model-slug proof or mapping rows, closure seals, staging revisions, readiness receipts, switch preflights/history, or head state as restore truth. Migration-away inventory may retain ordinary operational rows later, but the isolated serving restore refuses to import them as authority.

The existing publication `bundleHash` remains a separately computed immutable-manifest field; it is not redefined. B1 verification requires both byte and semantic agreement: exact chunk and manifest hashes must pass, then the decoded rows must independently reproduce resource/search content hashes, inventory chunk hashes, immutable manifest, closure hash, and the locator's exact bundle hash. B2 separately matches that complete result to the protected catalog before minting recovery authority.

### Hostile read, streaming, and nominal trust

Archive object metadata, streams, lengths, keys, encodings, JSON, and row values are hostile. The reader:

- accepts one exact structural locator containing environment, publication, closure, bundle, root digest, and root byte count, plus an exact-key `get` capability;
- has no list, create, overwrite, delete, copy, multipart, redirect, arbitrary key, global fetch, D1, or Vectorize capability;
- enforces fixed object-count, per-object, row-count, total-byte, subrequest, CPU-aware, and conservative retained-heap ceilings below the Worker memory limit;
- streams and hashes each exact body, rejects bodyless/truncated/extended data, invalid UTF-8, BOM, noncanonical JSON, sparse/inherited/accessor/extra fields, unsafe integers, range gaps/overlap, metadata drift, checksum drift, and digest drift;
- decodes only fixed data fields and never executes imported text as SQL, DDL, a path, URL, key, or source request; and
- completes all object verification and semantic closure replay before minting one process-local nominal verification result.

B1 may materialize the complete decoded source set because the existing closure projector is array-based, but only inside an accepted, format-fixed total encoded-byte ceiling and a conservative retained-heap ceiling below the Worker limit. It never constructs or reads one unbounded monolithic backup body. Workerd tests at the accepted bound are mandatory; increasing a limit requires new heap evidence.

The writer receives a nominal trusted immutable manifest plus the exact publication closure rows that must reproduce it before the first write. It emits exact bytes, conditionally creates each computed key, and rereads through the same hostile verification boundary. A precondition failure or ambiguous write is successful only when the existing exact object independently verifies. Nominal TypeScript branding prevents accidental callback substitution inside one process; it is not the durable trust anchor.

### Protected catalog root and deterministic selection

`backup-v2@1` is another canonical content-addressed create-only object. It binds the environment, schema and format versions, publication/closure/bundle identity, base-manifest key/digest/bytes and every base chunk descriptor, sidecar key/digest/bytes, writer-drained export boundary, exact table inventory and counts, and non-visitor backup/exercise identity.

The catalog never authenticates itself. Restore accepts only an expected catalog digest from a separately protected release/backup registry or equivalent operator-controlled configuration. It does not discover authority through R2 listing order, object timestamps, ETags, metadata, a `latest` key, current canonical D1, current serving D1, or a digest contained only inside the catalog body. Selection is exact digest first. Any fallback to an older catalog requires a separately protected allowlisted digest and an explicit controlled recovery authorization; corrupt-newest fallback is never silent.

Production and rollback-required publications need protected catalog roots. Preview and production roots and buckets remain isolated. Exact base, sidecar, and catalog prefixes require indefinite bucket-lock rules, disabled public development access and custom domains, least-privilege identities, drift detection, and documented break-glass controls before release.

### Fresh isolated restore and rebuild

`backup-v2-restore-source@1` is minted only after the complete catalog, base archive, and Model-slug sidecar pass independent read verification and cross-artifact identity checks. Destination access is forbidden before that point. The restore binds an exact run, catalog, environment, and unused destination under a restore lease, then applies only fixed reviewed schema `1.13.0` migrations and prepared writes.

`serving-restore-rebuild@6` reconstructs an unreachable `building` publication from verified source rows. A protected catalog also binds the target's complete parent-publication identity chain. Selected active/rollback publications are fully rebuilt; any earlier parent needed only for referential closure is synthesized as an unreachable failed dependency anchor from independently verified immutable parent-base authority, never from an unverified ID or mutable backed-up lifecycle state. This avoids both dangling foreign keys and silently rewriting the target's closure-bound parent ID.

The restore derives provider, Model/Variant-name, provider-model-ID, dataset-summary, and Model-slug projections; rebuilds both FTS indexes and a clean publication-qualified Vectorize namespace; verifies exact counts, roots, named indexes, version isolation, filters, neutrality, and deterministic hit/miss probes; seals the closure; and creates fresh v5 archive, serving, vector, probe, readiness, and attestation evidence. It never imports backed-up lifecycle, proof, mapping, index, or head rows as truth. Head selection is default-off and requires separate operator authorization after complete acceptance.

B2 implementation is gated on a separate accepted embedding-rebuild decision that freezes the exact document-to-input derivation, model/revision, dimensions, distance metric, vector normalization, IDs, namespace, and metadata. The current opaque `embedding_version` and asserted input hash are not enough to reproduce vector bytes. Until that decision and adapter exist, a callback or fake Vectorize port cannot make B2 locally complete.

Failure leaves an isolated unsealed/unready/unrouted target and never mutates the current production head, D1, R2 objects, or Vectorize namespace. Exact retry is deterministic; cross-run, cross-catalog, cross-environment, and cross-destination replay fail closed.

### Recovery scope, audit, and zero visitor data

B2C-B1 and B2C-B2 recover one immutable serving publication and its reconstructible indexes. They do not by themselves cover canonical D1, authenticated evidence, all operational history, source retention, remote resource creation, or a measured exercise. `BE-010`, `OPS-008`, `REL-AC-21`, `REL-AC-23`, and `GATE-restore-and-rebuild` remain `Planned` until B2C-B3 demonstrates the complete required scope with a newest fully verified recovery point no older than 24 hours and end-to-end recovery within 24 hours, twice yearly.

Because R2 native Audit Logs omit object data operations, local content proofs cannot satisfy `SEC-012`. Normal archive access must use controlled non-public identities and immutable attempted/completed control-plane receipts containing only fixed environment, operation, static service/operator authorization reference, catalog/publication digest, controlled timestamp, and closed outcome. Receipts exclude credentials, bodies, raw object keys, raw exceptions, vendor request IDs, actor email/address, and all visitor/request data. Direct S3 and break-glass access plus its external audit method remain release gates.

No component in these slices accepts a public `Request`, URL, query, header, cookie, address, user agent, referrer, visitor ID, correlation ID, click, or telemetry event. No such data enters an artifact, key, receipt, log, metric, trace, alert, cache key, or test fixture. Public/query Workers receive none of the archive, canonical, mutation, lock, or audit capabilities.

## Consequences

- Backup-v2 cannot hide the absence or corruption of base publication bytes behind descriptor hashes or callbacks.
- The protected expected catalog digest, not object discovery, is the durable restore trust anchor.
- Serving projections, FTS, Vectorize, lifecycle proofs, and head state stay reproducible and non-authoritative in backup bytes.
- The recovery path remains portable, bounded, private, and independent of current canonical or serving state.
- Complete GDPR/zero-visitor-data behavior is preserved because only immutable publication and non-visitor control-plane facts cross the boundary.
- Full disaster-recovery and migration-away acceptance remain measurable remote work, not claims inferred from local tests.

## Alternatives considered

- **Extend backup-v1 and trust its chunk descriptors:** rejected because no backed bytes are independently read or semantically replayed.
- **Treat the existing `bundleHash` as an R2 object digest:** rejected because it is a caller-supplied immutable-manifest field with no defined retrievable byte codec.
- **Let the newest catalog object select itself:** rejected because a create-capable actor could add a self-consistent fraudulent catalog.
- **Import backed-up proof, mapping, FTS, Vectorize, or head rows:** rejected because they are derived authority or environment-local state and can be deterministically reconstructed.
- **Use D1 Time Travel for the isolation exercise:** rejected because restore is destructive and in-place rather than a fresh clone.
- **Claim R2 account audit logs cover archive reads/writes:** rejected because Cloudflare excludes those data operations.
- **Use one unbounded monolithic recovery object:** rejected because bounded objects and per-object verification provide safer admission under Worker limits; the current array projector may materialize only the format-bounded decoded source set under an independently tested heap ceiling.

## Validation

- Prove fixed byte/hash vectors for every row, chunk, base manifest, catalog, and two-artifact root with an independent oracle.
- Reject absent, bodyless, wrong-key, cross-environment, cross-publication, malformed metadata, BOM, invalid UTF-8, noncanonical, truncated, extended, checksum/digest, range, count, substitution, and mutation cases.
- Recompute every resource/search/chunk/inventory/closure/bundle fact from decoded bytes; no callback or Boolean can self-attest.
- Prove destination capability is untouched until complete base, sidecar, and catalog preverification succeeds.
- Prove fixed prepared inserts keep SQL-looking imported strings inert and refuse every non-source table as restore truth.
- Inject failure and ambiguous outcomes at every archive read/write and restore/rebuild phase; prove the production environment and active head remain exact.
- Rebuild and probe all deterministic projections, both FTS indexes, Model-slug indexes, Vectorize namespace, receipts, and v5 readiness in a fresh schema `1.13.0` target.
- Verify application capability separation, private/lock configuration, remote drift checks, and redacted immutable access receipts; document the native R2 audit limitation.
- Verify the downloaded migration-away package without Cloudflare services and run worst-case cold remote recovery with corrupt-newest/fallback and dependency-outage cases.
- Retain all release/traceability rows as `Planned` until complete remote RPO/RTO evidence exists.

## References

- [ADR 0042: Model-slug lifecycle authority](0042-model-slug-lifecycle-authority.md)
- [Cloudflare D1 import/export limitations](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare R2 Audit Logs](https://developers.cloudflare.com/r2/platform/audit-logs/)
- [Cloudflare R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
