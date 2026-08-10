# ADR 0045: Bind recoverable embedding bytes to each publication

- Status: Proposed — product-owner decision required for the `BE-011` authority clarification below
- Date: 2026-08-10
- Decision owners: Product owner (pending), staff engineer, search lead, recovery lead, security and privacy lead
- Related requirements: `SRCH-001`–`SRCH-011`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `BE-003`, `BE-007`, `BE-010`–`BE-012`, `CF-003`, `CF-004`, `CF-008`, `CF-009`, `CF-021`, `CF-022`, `SEC-011`, `SEC-012`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `OPS-006`, `OPS-008`, `QA-005`, `QA-006`, `QA-013`
- Would supersede if accepted: The two-artifact recovery set and re-inference-only Vectorize rebuild portions of ADR 0043

## Context

ADR 0043 intentionally blocked `backup-v2@1` and `serving-restore-rebuild@6` until an embedding-rebuild decision fixed the document input, model revision, dimensions, metric, normalization, vector identity, namespace, and metadata. The existing publication closure stores an `embedding_version` and embedding-input hashes, but not the vector values. Those facts can prove which text should have been embedded; they cannot reproduce the resulting floating-point bytes.

Workers AI is still the approved Cloudflare-native default. The current catalog exposes `@cf/qwen/qwen3-embedding-0.6b` as a Cloudflare-hosted embedding model, and Cloudflare documents 1,024 dimensions with cosine distance. It does not expose an immutable model-weight or inference-runtime revision to a Worker invocation. Cloudflare documents that catalog aliases can be redirected during model deprecation and that hosted embedding behavior can change under a public catalog identifier. There is no evidence that this specific Qwen alias has already changed; the absence of a documented immutability guarantee is sufficient. Treating the public alias as a durable revision would therefore make disaster recovery depend on an unverifiable assumption.

Re-embedding with a changed model behind the same alias could produce a self-consistent but different semantic index while preserving the old publication ID and closure. Merely comparing counts, IDs, input hashes, or semantic probes would not detect every change. Requiring byte equality against a few sentinels would fail closed after provider drift but would not satisfy the 24-hour recovery objective. Running a privately pinned model would add an unapproved model-hosting system and would not restore an already published Vectorize namespace unless the original output were retained.

The safer recovery source is the exact finite Float32 vector payload that passed publication acceptance. Vector metadata is derived and remains rebuildable, but the values must be independently recoverable. This changes the B2C-B recovery set from two artifacts to three and requires a lifecycle binding before route release.

This exposes a requirement-authority question that engineering cannot approve alone. `BE-011` requires search indexes to be reproducible from canonical publication data. The proposed interpretation is that the byte-authentic sidecar is **canonical publication recovery data** for the sole purpose of reproducing an accepted search index, while remaining neither a public fact, canonical fact evidence, nor the semantic index itself. Product-owner acceptance of that narrow meaning is required before this ADR can become `Accepted` or any dependent codec, schema, Workflow, catalog, or restore implementation begins. If that meaning is rejected, `BE-011` requires an explicit PRD amendment or a different immutable inference design.

Official Cloudflare references were rechecked on 2026-08-10:

- [Qwen3 embedding model](https://developers.cloudflare.com/workers-ai/models/qwen3-embedding-0.6b/)
- [Qwen3 dimensions and metric announcement](https://developers.cloudflare.com/changelog/post/2026-04-09-new-workers-ai-models/)
- [Workers AI model deprecation and alias behavior](https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/)
- [Workers AI changelog](https://developers.cloudflare.com/workers-ai/changelog/)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Vectorize insert, namespace, and Float32 behavior](https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/)
- [Vectorize client API](https://developers.cloudflare.com/vectorize/reference/client-api/)
- [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/)

## Decision

### Embedding policy `quantclarity-qwen3-document-v1`

New semantic publications use this complete policy identity:

| Field | Fixed value |
|---|---|
| Workers AI binding model | `@cf/qwen/qwen3-embedding-0.6b` |
| Provider revision authority | unavailable; the alias is not treated as immutable |
| Source records | every and only closure-bound `publication_search_document` row for `model` or `variant` |
| Document input | the exact NFC `document_text` UTF-8 bytes, with no prefix, suffix, templating, trimming, case folding, provider fact, Offering fact, or generated prose |
| Document API member | one-element `documents` array; never the query or generic text member |
| Maximum input | 4,096 UTF-8 bytes per document, rejected before inference; no truncation |
| Output | one exact dense vector containing exactly 1,024 finite numbers |
| Accepted stored value | validate the Workers AI JS-number output for exact length and finite values, convert each value once to little-endian IEEE-754 binary32 through `DataView`, decode those bytes back to the exact binary32 JS numbers, then reject the `0x80000000` negative-zero bit pattern and a zero vector norm before constructing the `Float32Array` passed to Vectorize |
| Vectorize metric | `cosine` |
| Vector normalization | no application L2 normalization; exact accepted model output after binary32 conversion |
| Vector ID | ADR 0013 `quantclarity-vector-v1` digest |
| Namespace | exact publication ID |
| Metadata | exact closed object `{ resource_id, resource_type }`; no provider, Offering, price, precision, popularity, ranking, visitor, or evidence fields |
| Indexed metadata | `resource_id` as string; all structured eligibility is computed and rechecked in D1 |
| Write operation | deterministic stable-ID batches of at most 1,000 through Vectorize `insert` into a proven-unused publication namespace; outcome-unknown inserts are never blindly reissued and incomplete reconciliation abandons the namespace |

The embedding-input hash is the domain-separated SHA-256 of the policy version plus the exact length-prefixed document bytes. It is computed before inference and must equal the closure inventory. Changing any table field, API member, byte ceiling, model alias, dimension, conversion, metric, normalization, ID, namespace, or metadata shape creates a new embedding-policy version and a new candidate publication. A vendor-side alias change also requires a new policy version after golden-set replay even if the public alias string is unchanged.

Public query embedding remains disabled until the separate `CF-009` privacy and legal review authorizes current processor, retention, logging, and training terms. If authorized later, query text uses a separately versioned policy and is never written to the publication artifact, R2, D1, Vectorize metadata, a log, trace, metric, alert, fixture, or cache. This ADR authorizes document embeddings only.

The reserved query policy is `quantclarity-qwen3-query-v1`: one exact `queries` member containing the API-v1 NFC-normalized query unchanged, no trim or case fold, at most 200 UTF-8 bytes, and the explicitly supplied instruction `Given a web search query, retrieve relevant passages that answer the query`. It uses the same model alias, output validation, binary32 conversion, dimensions, metric, and no-normalization rule as the document policy. It is defined for compatibility testing only and remains disabled for visitor traffic until `CF-009` is approved. Cloudflare defaults are never policy authority.

### Byte-authentic `publication-embedding-artifact@1`

The publication pipeline writes a private, create-only, content-addressed embedding sidecar from the exact accepted binary32 values before those same decoded bytes are inserted into Vectorize and before readiness can be committed. It is never exported from Vectorize as backup authority. The sidecar is neither a public dataset resource nor canonical fact evidence. It is recovery material for one immutable publication.

The artifact is a canonical root manifest plus ordered binary chunks. Chunk bytes begin with exact ASCII `publication-embedding-chunk@1` plus LF. Rows use `[u32be header length][canonical UTF-8 JSON header][u32be value length = 4096][4096 little-endian binary32 payload bytes]`. The exact closed header is at most 1 KiB and contains these snake-case keys and JSON types:

1. `publication_id`: string;
2. `embedding_policy_version`: string;
3. `resource_type`: exact string enum `model | variant`;
4. `resource_id`: string;
5. `vector_id`: string using ADR 0013;
6. `resource_content_hash`: repository `sha256:<64 lowercase hex>` string;
7. `search_document_content_hash`: repository `sha256:<64 lowercase hex>` string;
8. `embedding_input_hash`: repository `sha256:<64 lowercase hex>` string;
9. `metadata`: exact closed canonical JSON object `{ "resource_id": string, "resource_type": "model" | "variant" }`;
10. `value_byte_count`: integer `4096`; and
11. `value_digest`: repository `sha256:<64 lowercase hex>` string over the separately framed payload.

The raw vector payload occurs only after the second unsigned 32-bit length; it is never embedded in the JSON header. Every header object uses the repository canonical JSON serializer with lexicographically ordered keys and no insignificant whitespace. The value digest input is its named domain, NUL, `u32be(4096)`, then the exact 4,096 payload bytes.

Rows are ordered by resource type and stable resource ID. Chunk framing, hashes, conditional-create behavior, hostile streaming verification, exact-key access, environment-qualified private keys, `private, no-store` metadata, and independent readback follow the domain-separated `publication-recovery-base@1` principles without sharing its trust brand or object namespace.

Version 1 admits at most 50,000 vectors, 63 chunks plus one root, 4 MiB per chunk, 256 KiB for the root, 256 MiB across chunks plus root, 256 canonical metadata bytes per row, and 1,024 nonempty stream chunks per object. Packing is greedy and deterministic: start with the magic, append the next complete framed row only if the body remains at or below 4 MiB, otherwise close the nonempty chunk and continue at the next contiguous zero-based ordinal. The root contains only fixed policy facts, aggregate counts, a domain-separated ordered vector-inventory digest, and ordered chunk descriptors; it never enumerates all vector rows. Verification validates lengths before allocation, streams values, and never retains the whole artifact in one Worker isolate.

The value, inventory, chunk, and root domains are respectively `quantclarity:publication-embedding-value:v1`, `quantclarity:publication-embedding-inventory:v1`, `quantclarity:publication-embedding-chunk:v1`, and `quantclarity:publication-embedding-manifest:v1`, each followed by NUL and its exact versioned bytes. Every digest field uses the repository's exact 71-byte `sha256:<64 lowercase hex>` representation. Each `chunk_digest` is domain-separated over the complete magic-plus-row bytes. The inventory digest covers a canonical JSON array of ordered descriptors `{ ordinal, chunk_digest, byte_count, row_count, first_resource_type, first_resource_id, last_resource_type, last_resource_id }`; it never hashes one monolithic value stream. The root digest covers canonical root JSON without a self-digest field. The root records `total_chunk_byte_count`; its external locator records `root_byte_count`; aggregate admission verifies their sum. The embedding-input domain is `quantclarity:publication-embedding-input:v1`, NUL, a four-byte unsigned big-endian policy-version length and bytes, then an eight-byte unsigned big-endian document length and exact document bytes. Independent golden vectors freeze every length and byte-order rule.

The three-artifact catalog admits only the minimum count/byte profile accepted by all three formats. B1's 50,000-row total includes resources, search documents, vector inventory, and other relations, so it is tighter than the sidecar's standalone 50,000-vector codec ceiling. The separate 200,000-vector scale profile is intentionally not admitted; successors to both B1 and this artifact, with sharding/content-deduplication and new recovery/cost evidence, are required before that profile can pass. Increasing a ceiling requires new Worker-memory, CPU, subrequest, R2, and cost evidence.

The root binds the exact publication, closure and bundle identities; policy version and model alias; dimension, metric, conversion and normalization rules; a new output-value inventory digest distinct from the existing ID/input-only `vector_inventory_hash`; total vector/value/object/chunk-byte counts; and every ordered chunk descriptor and digest. It must reproduce the closure's vector IDs, resource identities, canonical-resource hashes, search-document hashes, and embedding-input hashes exactly. The verifier independently derives `{ resource_id, resource_type }` metadata from the verified base search rows and policy, then compares its canonical bytes; the sidecar never authors canonical metadata. Missing, extra, duplicate, reordered, cross-publication, wrong-environment, non-finite, negative-zero, metadata-drifted, or digest-drifted rows fail closed.

Generating as many as 50,000 one-document embedding calls, writing the sidecar, and populating Vectorize is a bounded resumable Workflow with fixed batch, step, retry, token, mutation, and cost ceilings. It cannot run in one ordinary Worker invocation. Each inference step covers at most 200 ordered documents and persists exact binary32 bytes as either a no-more-than-1-MiB `Uint8Array` result or a byte-stream result whose complete bytes remain within the paid instance's 1-GiB state ceiling. Engine retry before a step result is durably accepted may repeat inference because no output has yet become publication authority; the first durably accepted result is final for that batch. Later steps may only read those persisted bytes. The configured 25,000-step and greater-than-50,000-subrequest ceilings, instance-state use, retry policy, and cost breaker are infrastructure as code and require remote proof. After exact root read-verification and immutable proof staging, no retry path may invoke Workers AI for that publication.

### Lifecycle and recovery binding

Serving schema `1.14.0` and lifecycle v6 add the embedding-artifact digest, byte count, vector count, policy version, and exact read-verification result to the publication's immutable search/readiness authority. Activation and rollback must prove that binding and current Vectorize byte/index parity. Normal candidate activation and rollback additionally require current semantic compatibility. This is a cumulative lifecycle cutover; legacy readiness families cannot activate the new schema. The migration, writer, readback verifier, readiness, switch, `backup-v3`, and restore-rebuild changes land as one reviewed boundary before the Model-detail route can open.

The unimplemented `backup-v2@1` format `2.0.0` is abandoned so an older reader cannot accept a catalog under the superseded two-artifact meaning. `backup-v3@1` format `3.0.0` is the protected **three-artifact** catalog over:

1. `publication-recovery-base@1`;
2. `model-slug-history-artifact@1`; and
3. `publication-embedding-artifact@1`.

The independently protected catalog digest binds every exact locator and digest. `backup-v3-restore-source@1` is minted only after all three artifacts pass byte, semantic, cross-artifact, environment, publication, closure, bundle, canonical-resource, search-document, and vector-inventory checks. The search documents and embedding-input hashes are recomputed from the verified base archive rather than trusted from the sidecar. No destination capability is acquired or invoked before that complete verification.

`serving-restore-rebuild@6` describes a newly created isolated restore index before use, requires the exact 1,024-dimension cosine configuration, zero aggregate vectors, and exact metadata-index schema, and creates metadata indexes before values. A normal publication build separately requires a create-only publication-namespace claim/mutation ledger before its first insert; `getByIds` alone cannot prove that a namespace contains no unknown extra vector. Restore streams the verified artifact in stable `insert` batches, waits for mutation visibility, and proves the index's expected aggregate count, complete paginated ID set, plus exact bounded `getByIds` Float32/metadata parity, namespace, filters, and neutrality. An explicitly failed pre-mutation call may retry. An outcome-unknown asynchronous `insert` is never blindly reissued. If a mutation ID was returned, bounded reconciliation also waits until that exact ID is processed. If the response was lost before a mutation ID was received, the proven-unused namespace, exclusive mutation ledger, and complete exact ID/value/metadata/namespace readback are the only success proof. Partial, wrong, or still absent content at the deadline permanently abandons the fresh restore index or quarantines the normal publication namespace and selects a new destination/publication ID. Absence is never proof that the asynchronous mutation cannot appear later. Restore does not invoke Workers AI to reconstruct document values and does not treat Vectorize readback as a backup. Model-detail publication admission runs after all deterministic serving projections and immediately before any separately authorized head mutation. Head selection remains default-off.

Restored document bytes do not prove compatibility with the current model behind the Workers AI alias. Semantic search therefore begins disabled after recovery. Immutable recovery inputs bind the exact version and digest of the synthetic query set and expected-result/quality policy. The current alias must pass the complete `SM-06`, `SM-12`, and `QA-013` acceptance set against the restored corpus before a `semantic-compatibility@1` receipt can be minted. The receipt binds the publication, index, document/query policies, alias, input-set/policy digests, complete result digest, observed-at time, and an expiry no more than 24 hours later. Only the protected non-visitor search-control identity may mint or renew it; lifecycle activation atomically verifies the receipt and all full-readiness proofs. Scheduled synthetic control-plane checks renew it at least daily, but scheduling is not the expiry safety mechanism. Before every semantic dispatch, the query resolver compares the protected receipt expiry with trusted request-time Worker/D1 time; a missing, expired, mismatched, or invalid receipt returns exact/structured fallback with `semantic_degraded=disabled` before any Workers AI or Vectorize call. A control-plane transaction may also clear mutable semantic state after failure, but a stale enabled bit can never override the per-request expiry check. Public requests emit no telemetry.

Normal candidate activation and rollback remain prohibited without a current compatibility receipt. During an explicitly declared disaster where no full-readiness active or rollback generation remains usable, a separately authorized `recovery-exact-only@1` receipt may select an otherwise complete lifecycle-v6 restore as head with semantic dispatch disabled. That receipt binds the incident, a bounded non-personal control-authorization reference, restored publication/index, complete exact/readiness proofs, failed compatibility evidence, and a maximum 24-hour expiry; it cannot enable semantic work. The serving resolver checks that expiry against trusted request-time Worker/D1 time on every applicable read. Exact, keyword, browse, filter, and detail remain live with `semantic_degraded=disabled` only while the receipt is current; a missing, expired, mismatched, or invalid emergency receipt fails closed and serves nothing from that emergency head until it is renewed or replaced. Recovery automation keeps seeking full compatibility or a prior full-readiness generation. This never mixes a new query space with only part of the archived corpus. Exact semantic continuity would require a separately approved immutable inference runtime for arbitrary queries, which Workers AI does not currently expose.

After an artifact is create/read-verified and its output-value proof is immutably staged, every retry reads that exact content address and never calls Workers AI again. Before complete artifact proof staging, each durably accepted inference-step result is immutable batch authority and may be packed again without inference; only a step with no durably accepted output may retry inference. Conflicting durable output, an indeterminate step-commit result, or a process loss whose durable status cannot be proven quarantines that publication attempt; retry uses a new publication ID and cannot overwrite, relabel, or silently orphan an accepted artifact.

### Privacy, security, and operations

- The artifact contains only public Model/Variant search-document derivations, stable public IDs, hashes, closed scalar metadata, and vector values. It contains no visitor query, query vector, source address, header, cookie, referrer, user agent, actor key, request URL, correlation ID, credential, authenticated source payload, or operator identity.
- Public API, frontend, and query Workers receive no R2, catalog, artifact, mutation, or restore binding. Only the unrouted pipeline/recovery identity can write or read these objects.
- Object keys are computed outputs. The reader has exact-key `get` only; the writer has conditional create and reread only. Neither port accepts a URL, arbitrary key, list, delete, copy, redirect, or public-development endpoint.
- Production and preview artifacts, roots, buckets, indexes, and identities are distinct. Bucket locks, public-access disablement, protected expected digests, drift checks, redacted control-plane receipts, and break-glass procedures remain release gates.
- The proposed artifact has a 256 MiB admission ceiling per retained publication; 50,000 raw value arrays alone occupy 204,800,000 bytes before record framing. No R2 compression is assumed. The cost model and remote recovery profile include active, rollback, retained-hot, and protected fallback copies. Cleanup or deduplication is unauthorized until a separately fenced, catalog-reachability design proves it cannot remove any retained dependency.

If explicitly accepted by the product owner, this decision resolves ADR 0043's embedding-policy prerequisite. In proposed state it authorizes no implementation. It does not by itself complete B2C-B2, authorize provisioning or deployment, advance release traceability or `PRIV-005` accountability evidence, claim that current Workers AI output is revision-pinned, or approve the 200,000-vector scale profile.

## Consequences

- Recovery can reproduce the exact accepted document-vector values without trusting a mutable model alias or retaining visitor searches; semantic query compatibility remains an explicit fail-closed acceptance gate.
- The protected catalog grows from two artifacts to three, and lifecycle schema/readiness authority must bind the new sidecar before public routing.
- Recovery becomes less dependent on Workers AI availability and model retention, while R2 storage and implementation complexity increase.
- The semantic index remains non-canonical: the sidecar is proposed as canonical publication recovery data only, public facts still come from D1, structured filters are still rechecked, and provider/Offering facts cannot influence vector grain or weight.
- A normal model upgrade produces a new policy and publication; it cannot silently mutate an existing publication's semantic meaning.
- `backup-v3@1` and `serving-restore-rebuild@6` remain blocked until product-owner acceptance, then may proceed only with the three-artifact authority defined here.

## Alternatives considered

- **Re-infer from the Workers AI alias and accept new bytes:** rejected because the alias is not an immutable revision and would silently change an existing publication.
- **Fail recovery when a small sentinel fingerprint changes:** rejected because it detects some drift but cannot meet recovery objectives after legitimate vendor changes.
- **Treat semantic probes as equivalent to vector identity:** rejected because bounded probes cannot prove every vector or every future ranking is unchanged.
- **Store only vector hashes:** rejected because hashes detect drift but cannot reconstruct values.
- **Read Vectorize values during disaster recovery:** rejected because the damaged or unavailable service cannot be its own independent backup.
- **Run a private pinned embedding model:** deferred because it adds a model-serving supply chain and still would not recover already accepted output unless exact values were retained.
- **Add vector bytes to `publication-recovery-base@1`:** rejected because that would invalidate the accepted bounded B1 format and mix canonical reconstruction sources with a larger independently streamable derived artifact.

## Validation

- Independent golden vectors prove document/query framing, explicit query instruction, input hashes, little-endian binary32 conversion (including positive zero and subnormal cases), row/chunk/root domains, metadata bytes, and exact artifact digests.
- Hostile tests reject absent, extra, duplicate, crossed, reordered, truncated, extended, noncanonical, non-finite, negative-zero, wrong-dimension, wrong-policy, wrong-publication, wrong-environment, metadata, checksum, and digest cases.
- Accepted-profile Worker tests stream the maximum object, vector, and aggregate-byte profiles without whole-artifact retention; remote tests measure CPU, memory, subrequests, R2 operations, and full rebuild time.
- Schema-`1.14.0` lifecycle-v6 tests prove no seal, archive/vector/serving/probe receipt, readiness, activation, rollback, recovery head mutation, or public route opening can bypass the exact artifact binding and fresh hostile read verification; every legacy family fails closed.
- Recovery failure injection proves the destination is inaccessible before three-artifact verification, incomplete Vectorize writes never become queryable public authority, exact retry is idempotent, and the current head remains unchanged.
- Vectorize tests prove exact index configuration, namespace, ID, Float32 values, metadata, count, visibility, structured-filter behavior, D1 rehydration, neutrality, and active/rollback isolation.
- Privacy scans and canaries prove no visitor or authenticated-source value can enter the artifact, key, metadata, receipt, error, fixture, log, trace, metric, alert, or build output.
- The full semantic acceptance set and cost model are rerun for every policy change, model alias drift, Vectorize configuration change, or format-limit increase.
