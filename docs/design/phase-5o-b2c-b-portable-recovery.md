# Phase 5O-B2C-B: byte-authentic portable publication recovery

| Attribute | Decision |
|---|---|
| Status | B1 codec/verifier locally implemented; accepted-bound workerd evidence, B2, and B3 planned |
| Governing ADRs | [ADR 0042](../decisions/0042-model-slug-lifecycle-authority.md), [ADR 0043](../decisions/0043-byte-authentic-publication-recovery.md) |
| Requirements | `DATA-001`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-007`, `BE-010`–`BE-012`, `CF-008`, `SEC-011`, `SEC-012`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `OPS-006`, `OPS-008`, `QA-006` |
| Serving schema | Exact fresh `1.13.0` target only |
| Public surface | None |

## Purpose and scope

B2C-B closes the gap between publication descriptor hashes and recoverable bytes. The complete serving recovery set is one byte-verified base archive plus the independently byte-verified `model-slug-history-artifact@1` sidecar, selected by one independently protected backup-v2 catalog digest.

This phase is deliberately split. B1 makes base bytes authentic and portable. B2 binds both artifacts and reconstructs one serving publication in an isolated target. B3 supplies the canonical/evidence, migration-away, protected-access-audit, remote R2/D1/Vectorize, and measured exercise evidence required for full disaster-recovery acceptance. Local B1 or B2 evidence does not advance `BE-010`, `OPS-008`, `REL-AC-21`, `REL-AC-23`, or `GATE-restore-and-rebuild`.

The B1 codec and verifier are implemented locally with independent byte/hash vectors, hostile fake-R2 coverage, and pinned-workerd R2 round-trip/corruption evidence. The maximum accepted 24 MiB/50,000-row decoded-set exercise is not yet present, so B1's configured upper bound is not operationally accepted and the phase remains open.

## B1: `publication-recovery-base@1`

### Authority input

The writer accepts only a nominal trusted immutable manifest plus the exact persisted closure rows from which that manifest was built. Before serialization it reruns the existing persisted-content and serving-closure projectors. Caller-supplied `bundleHash`, closure hash, row content hashes, or success flags never authorize output by themselves.

The closed source relations and stable order are:

| Relation | Canonical order | Purpose |
|---|---|---|
| `publication` | singleton | publication identity, versions, generated boundary, closure |
| `publication_provider_slice` | provider ID | enabled-provider and acquisition slice closure |
| `publication_provider_slice_metadata` | provider ID | per-provider adapter, roster, and source-register versions |
| `publication_provider_attribution` | resource type, resource ID | provider ownership closure |
| `publication_resource` | resource type, resource ID | exact canonical public resource JSON and content hash |
| `publication_search_document` | resource type, resource ID | exact deterministic search source bytes |
| `publication_vector_inventory` | resource type, resource ID | reproducible vector IDs and embedding-input hashes |
| `publication_inventory_chunk` | kind, ordinal | closure chunk descriptors |

Every row uses a version-specific exact object shape. Objects must be own, plain, dense data; inherited, accessor, proxy-observable, sparse, duplicate, extra, or missing fields fail before persistence. Text is UTF-8 without a BOM. Integers are JSON safe integers. JSON number coercion is never used for larger database values.

The B1 row allowlists are normative:

| Relation | Exact archived fields |
|---|---|
| `publication` | `publication_id`, `source_run_id`, `parent_publication_id`, `generated_at_ms`, `schema_version`, `methodology_version`, `precision_normalization_version`, `precision_display_order_version`, `price_policy_version`, `source_policy_version`, `embedding_version`, `build_commit`, `closure_hash` |
| `publication_provider_slice` | `provider_id`, `provider_slice_id`, `provider_run_id`, `carried_forward`, `freshness_state` |
| `publication_provider_slice_metadata` | `provider_id`, `adapter_version`, `roster_version`, `source_register_version` |
| `publication_provider_attribution` | `resource_type`, `resource_id`, `provider_id` |
| `publication_resource` | `resource_type`, `resource_id`, `resource_json`, `content_hash` |
| `publication_search_document` | `document_id`, `resource_type`, `resource_id`, `normalized_name`, `aliases_json`, `publisher_name`, `provider_model_ids_json`, `document_text`, `content_hash` |
| `publication_vector_inventory` | `vector_namespace`, `vector_id`, `resource_type`, `resource_id`, `search_document_content_hash`, `embedding_input_hash` |
| `publication_inventory_chunk` | `kind`, `ordinal`, `first_key`, `last_key`, `item_count`, `content_hash` |

The `publication` object is the immutable closure projection, not the full mutable D1 row. B2 maps it to a new D1 row with controlled `state='building'`, null ready/activation times, recomputed resource/exact/vector counts and exact-index hash, a vector-index version supplied only by the accepted embedding policy, controlled empty failure codes, and a controlled non-visitor creation time. No backed-up mutable lifecycle value crosses that mapping.

### Byte and address contract

Each chunk begins with exact ASCII bytes `publication-recovery-chunk@1` plus LF. Each row is an unsigned 64-bit big-endian byte length followed immediately by that many canonical UTF-8 JSON bytes. There is no delimiter, terminal data, or zero-length row. Canonical JSON recursively sorts object keys by ASCII code-unit order; uses JSON string escaping; permits only strings, booleans, null, and safe base-10 integers other than negative zero; uses dense arrays; and emits no insignificant whitespace. Archive rows are already exact-shape snapshots, so canonicalization never traverses inherited or accessor properties.

Chunk artifact digest is lowercase `sha256:` plus SHA-256 of ASCII `quantclarity:publication-recovery-chunk:v1`, NUL, and the exact chunk body. Manifest artifact digest uses ASCII `quantclarity:publication-recovery-manifest:v1`, NUL, and exact manifest bytes. Each object also carries the ordinary SHA-256 of its body for the R2 transport checksum. The private key grammar is `private/publication-recovery-base/v1/{environment}/{publication_id}/{relation}/{six-digit-ordinal}/{artifact-hex}.{bin|json}`; the manifest relation is literal `manifest`, ordinal `000000`, and extension `json`. Keys are computed outputs, never arbitrary caller inputs.

HTTP metadata is exactly root content type `application/vnd.quantclarity.publication-recovery-base+json` or binary-chunk content type `application/vnd.quantclarity.publication-recovery-chunk`, plus `Cache-Control: private, no-store`. Custom metadata is exactly `artifact-format`, `artifact-digest`, `body-sha256`, `byte-count`, `environment`, `object-kind`, `ordinal`, `publication-id`, `relation`, and `retention-class`. Object kind is `source_chunk` or `root_manifest`; retention class is `publication-rebuild-input-lifetime`.

The canonical manifest is a closed UTF-8 JSON object with `publication-recovery-base@1`, publication/closure/bundle identity, manifest contract and serving schema versions, enabled-provider-scope version, ordered relation summaries, ordered chunk descriptors, aggregate counts/bytes, and a root over that exact inventory. The manifest contract version, enabled-provider-scope version, and base bundle hash are explicit reconstruction context from the already trusted closure projection; they are not imported closure-seal or staging state. The manifest key is likewise derived only from its independently computed digest.

Version 1 admits at most 64 objects including the root, 50,000 rows total, 1 MiB canonical bytes per row, 2 MiB per object, 24 MiB across source chunks plus root, and 1,024 stream chunks per object. Its conservative retained-heap admission ceiling is 96 MiB, including an 8 MiB fixed reserve, twice the encoded source bytes, and 512 bytes per decoded row. These limits remain below the 128 MiB Worker isolate limit and are part of the reviewed format; increasing one requires new heap evidence. Transport never constructs one unbounded monolithic backup body. The existing semantic projector is array-based, so B1 may materialize the complete decoded source set only within these ceilings, with accepted-bound workerd evidence.

### Writer and verifier capabilities

The writer port exposes only conditional create and exact read. It has no overwrite-success path, delete, list, copy, multipart, public URL, or arbitrary remote fetch. Every computed object is conditionally created and then reread through the verifier. Precondition failure and ambiguous write reconciliation succeed only when the existing exact object verifies completely.

The B1 verifier port exposes exact-key `get` only. It receives one exact structural locator containing the manifest digest/byte count and environment/publication/closure/bundle identity. It validates the manifest before deriving the complete expected chunk-key set. It then streams and independently checks every object, rejecting absence, bodyless objects, metadata drift, declared/actual byte drift, checksum/domain-digest drift, invalid encoding, noncanonical bytes, key/range/order/count drift, and cross-object substitution. B2 alone compares the locator and verified inventory to the independently protected catalog.

Only after every byte passes does the verifier decode the eight relations and rerun:

1. resource and search-document content hashes;
2. persisted chunk coverage and hashes;
3. immutable manifest construction;
4. full ModelFamily/Model/Variant relationship closure;
5. serving closure/seal projection; and
6. exact locator publication, closure, and bundle equality.

That final replay mints a nominal `VerifiedPublicationRecoveryBase`. It proves bytes and semantics only. B2 must match it to the independently protected catalog root before it can mint restore authority; the B1 value is neither stored nor a durable trust root.

### B1 failure contract

Failures use closed static classes such as invalid input, limit exceeded, conflict, object absent, transport unavailable, integrity failure, and semantic closure failure. They do not contain raw keys, bytes, imported text, credentials, vendor request IDs, exception messages, or visitor-derived values. Failure before complete verification returns no verified value. The writer may leave only immutable content-addressed objects; it never mutates serving or canonical D1.

## B2: `backup-v2@1` and isolated serving rebuild

### Protected catalog

Format `2.0.0` binds exact environment, schema, publication, closure, base bundle, B1 manifest and chunk inventory, sidecar key/digest/bytes, writer-drained source boundary, all 26 application-owned ordinary serving-table export summaries for migration-away completeness, and one fixed non-visitor backup run identity. B2C logical export explicitly selects those 26 tables. It never selects the two FTS virtual tables, their ten shadow tables, or runtime control tables such as `_cf_METADATA` and `d1_migrations`; native full D1 export cannot be used while the FTS virtual tables exist.

The catalog is canonical, content-addressed, create-only, and fully reread. Restore accepts it only against a separately protected expected digest from the release/backup registry. It does not use list, `latest`, ETag, R2 timestamps, current D1, or a self-declared digest to select authority. A fallback catalog must itself be present in the protected registry and explicitly authorized.

The eight B1 source relations are selected for reconstruction. These categories are explicitly excluded as restore truth even if present in migration-away inventory:

- schema and migration metadata;
- staging revision and closure seal;
- provider/Model/Variant/provider-model-ID derived projections;
- dataset summary;
- Model-slug proof and mapping;
- readiness/archive/serving/vector/probe receipts and attestation;
- switch preflight/history and publication head;
- FTS/Vectorize data and all engine shadow state.

### Restore source and phase order

`backup-v2-restore-source@1` is nominal authority over one fully preverified catalog, base archive, sidecar, and complete protected parent-publication identity chain. The destination capability cannot be acquired or invoked during source verification. The catalog distinguishes publications selected for complete active/rollback reconstruction from older parents needed only for referential closure. Selected publications are rebuilt completely. Earlier parents become fixed unreachable failed dependency anchors derived from independently verified immutable parent-base authority; no unverified identifier or backed-up mutable state can satisfy the foreign key. `serving-restore-rebuild@6` then uses one exact run/catalog/environment/destination binding and this fixed phase order:

1. prove an unused isolated destination and acquire a restore lease;
2. apply reviewed migrations to exact schema `1.13.0`;
3. import the eight verified source relations with fixed prepared statements into one unreachable `building` publication;
4. reproject provider search, Model/Variant names, provider-model IDs, dataset summary, and Model slugs from trusted source bytes;
5. rebuild both FTS indexes and a clean publication-qualified Vectorize namespace;
6. read back and verify closure, projection, index, version-isolation, filter, neutrality, and deterministic hit/miss parity;
7. seal and create fresh v5 archive, serving, vector, probe, readiness, and attestation evidence; and
8. return a read-only transcript with head selection omitted by default.

Every phase returns a concrete-adapter-minted nominal proof bound to the exact restore run and destination. Callbacks cannot authorize progress by echoing expected hashes. Mutation between preverification and import is prevented by immutable content addresses and rechecked identity. Failure injection at every phase must leave only an isolated, unsealed/unready/unrouted target and must preserve current production state.

B2 code may not begin its Vectorize phase until a separate accepted embedding-rebuild ADR freezes exact document-to-input derivation, model/revision, dimensions, metric, normalization, vector IDs, namespace, and metadata. `embedding_version` plus a stored input hash cannot reproduce vector bytes, and a fake port cannot close that gap.

## B3: operational recovery and migration-away evidence

B3 adds the parts outside one serving publication:

- writer-drained logical canonical D1 and authenticated evidence/evidence-link archives;
- a Cloudflare-independent downloaded package and deterministic offline verifier;
- exact least-privilege backup writer, restore reader, lock administrator, deployment, public, and query identities;
- indefinite lock/public-access drift evidence for base, sidecar, and catalog prefixes;
- immutable non-visitor attempted/completed archive-access receipts and a documented direct-S3/break-glass audit path;
- cold isolated canonical, serving, R2, and Vectorize recovery, including active and rollback-required generations;
- corrupt-newest protected fallback, dependency-outage, and worst-accepted-size exercises; and
- fixed-clock evidence that the newest fully verified recovery point and complete end-to-end recovery satisfy the 24-hour RPO/RTO twice yearly.

D1 Time Travel remains a separate in-place operational recovery tool, not the isolation-test mechanism or sole portable backup. R2 native account Audit Logs are not claimed as object data-access evidence.

## Security and privacy acceptance

- Imported bytes are inert data passed only to fixed migrations and prepared statements.
- Public and query Workers have no archive, canonical, mutation, lifecycle, lock, or audit binding.
- Production, preview, test, and local keys, buckets, registries, databases, and Vectorize indexes are distinct.
- No component accepts or persists a visitor request, path, query, header, address, user agent, referrer, cookie, identifier, correlation ID, click, beacon, analytics event, or telemetry event.
- No `console.*`, request log/trace, raw exception, object key, credential, source payload, or visitor-derived key is introduced.
- Access receipts use only static service/control authorization references; actor emails, addresses, and vendor request metadata stay outside QuantClarity storage.

## Verification matrix

| Boundary | Required local evidence | Required remote/operational evidence |
|---|---|---|
| B1 bytes | Independent golden hash vectors; hostile shape/encoding/metadata/body/key/range/count tests; create-only retry and ambiguous-write reconciliation | Private bucket binding, exact prefix, indefinite lock/public-access drift checks |
| B1 semantics | Full persisted-content, inventory, family, closure, and bundle replay from downloaded bytes only | Worst-accepted-size Worker limits and R2 readback |
| B2 catalog | Independent catalog/two-artifact-root vectors; protected-root substitution and fallback rejection | Protected registry and recovery authorization controls |
| B2 restore | No destination access before verification; fixed-SQL inertness; failure injection; exact retry; complete D1/FTS/Vectorize/projection/readiness parity | Fresh isolated D1/R2/Vectorize behavior and eventual-visibility measurements |
| B3 portability | Offline non-Cloudflare round trip with corrupt/missing file rejection | Full canonical/evidence/publication recovery and migration-away exercise |
| Privacy/audit | Canary scans and static-error tests; no visitor inputs/capabilities | Redacted immutable access receipts and documented break-glass audit evidence |
| RPO/RTO | No local timing claim | Complete cold exercise ≤24 hours from newest verified point ≤24 hours old, twice yearly |

## Deferred boundary

B2C-C remains the unrouted publication-pinned slug lookup. Phase 5O-B3 remains the public HTTP/cache contract. Frontend topology, provisioning, remote migrations, deployment, and release acceptance remain blocked by their existing gates.
