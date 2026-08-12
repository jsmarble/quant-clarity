# ADR 0067: Activate provenance registration through a frozen graph and independent oracle

- Status: Proposed activation architecture; normative contracts and implementation pending
- Date: 2026-08-11
- Decision owners: Staff engineer, data-architecture reviewer, security/privacy reviewer
- Related requirements: `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-010`–`PIPE-022`, `PIPE-030`–`PIPE-045`, `PIPE-050`–`PIPE-056`, `BE-005`, `SEC-003`–`SEC-006`, `SEC-011`, `SEC-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `LEG-001`, `LEG-002`, `QA-002`, `QA-006`, `QA-007`, `QA-010`–`QA-012`
- Extends: ADRs 0059–0066
- Supersedes: None

## Context

Migration 0009 installs the complete normalized provenance-v2 registration vocabulary, but every runtime insert remains blocked. ADR 0066 requires the successor to activate protected installation initialization, registration, independent root verification, authority-plan approval and revocation, and guarded Provider-bundle opening as one authorization boundary. Acquisition permits, response admission, source effects, source-backed outcomes, artifacts, publication, serving, remote resources, and deployment must remain blocked.

The activation cannot be one unbounded D1 batch. A maximum plan can contain hundreds of endpoints and thousands of normalized children. D1 batches are transactional, but transaction duration, Worker CPU and memory, request size, and result size are finite. Cloudflare documents `batch()` as a sequential transaction that rolls the whole sequence back when a statement fails; it does not provide a Worker-binding API for a caller-managed transaction spanning requests. D1 Sessions provide sequential consistency, and `withSession("first-primary")` starts from current primary state, but a session is not a cross-request lock.

The safe distinction is between **staged definition** and **trusted authority**. Append-only rows may be installed over bounded batches while they have no seal or approval. A registration close then permanently freezes the exact plan graph. Only an independent oracle over that closed graph may create the base seal and approval. This preserves ADR 0066's one authority transition without requiring one oversized write.

## Proposed decision

### One migration activates the complete protected surface

Migration 0010 is legacy-additive but performs an atomic empty-state rebuild of the still-dormant provenance-v2 vocabulary/precedence portion. Before creating or replacing any object it proves the exact migration-0009 schema, both static capability rows, the unchanged canonical public schema version, every dormant activation blocker and append-only guard, the complete relied-upon legacy/publication guard inventory, and zero runtime provenance-v2 rows. It rejects missing, extra, renamed, wrong-kind, wrong-target, conditional, inert, pre-seeded, or colliding state atomically.

The migration first installs:

- a static `fenced-provenance-v2-registration-activation@1` capability;
- the exact closed initial field-path vocabulary as migration-owned rows, followed by a permanent insert guard that prevents runtime vocabulary extension;
- an empty-state rebuild of the precedence-class/admission portion plus `provenance_v2_field_policy_precedence_class_source`, because migration 0009's one-source-class-per-class row cannot place API and authenticated catalog in the same class and a missing edge means incomparability, not equality;
- private bounded registration-document and chunk tables that retain the complete canonical safe preimage bytes needed by the independent oracle, with exact contract version, content hash, byte length, chunk count/order/length/hash, and authority-plan identity;
- active semantic guards for installation, plan and registration staging, registration close, oracle receipt, approval, revocation, and bundle opening;
- a post-close `BEFORE INSERT` guard on **every** plan-scoped normalized registration/member table;
- exact closure guards that reject missing, extra, duplicate, non-contiguous, orphaned, unreferenced, or declared-count-mismatched rows;
- active no-replacement and append-only guards for every newly writable row; and
- the fixed private D1 writer and independent root-oracle contracts described below.

The field vocabulary and its complete transitive empty foreign-key-dependent closure are built under replacement names with their final corpus and permanent guards, then atomically swapped as part of the exact empty-state rebuild. That closure explicitly includes endpoint expected fields, field policies, precedence classes and source memberships, edges, admissions/exclusions, and every recreated index/trigger; SQLite rename-side effects are not trusted to retarget foreign keys implicitly. The migration never exposes a writable global vocabulary and never needs to drop its blocker to seed the corpus. Only after all replacement objects exist does migration 0010 drop the corresponding unconditional runtime blockers. It removes the blockers for:

1. installation initialization;
2. authority-plan and normalized registration staging;
3. registration close, oracle receipt, base authority-plan seal and approval;
4. endpoint and authority-plan revocation; and
5. guarded Provider-bundle opening.

It does **not** remove or weaken the acquisition-permit, admitted-response, retained-object, source-effect, bundle-effect seal, source-backed roster-outcome, artifact, selection, publication, or serving blockers. It adds no binding, schedule, route, remote resource, data, or deployment configuration.

### A closed graph, not a staging batch, is the authority candidate

The protected registrar accepts one canonical `ProvenanceV2RegistrationPlan@1` document whose top-level roots bind all intended rows. Its nested `ProvenanceV2AdapterReceipt@1` distinguishes three commitments: `adapter_manifest_hash` is the digest of the exact validated legacy `AdapterManifest@1` canonical bytes; `successor_manifest_hash` is the digest of the normalized successor manifest plus explicit owner/register/authority-class additions; and `manifest_content_hash` is the receipt digest binding both hashes, versions, admitted run-plan ceilings, and normalized child roots. The safe document contains definitions and hashes but no credential value or authenticated payload. Its exact canonical bytes are stored in bounded private D1 chunks and bound to the plan before any semantic row. The registrar validates the whole document before the first write, then stages the document and exact immutable rows in dependency order through fixed prepared statements and bounded pages. A staged plan is inert: it has no registration close, oracle receipt, seal, approval, acquisition authority, or public meaning.

The writer may resume only the same canonical plan after an interrupted page. An existing key with identical canonical columns is idempotent; an existing key with any differing column is a terminal mismatch. It may not delete, replace, renumber, repair, or reinterpret a partial plan. A different plan uses a different authority-plan ID and roots.

Registration close is a separate atomic D1 batch. Its first mutation inserts `provenance_v2_authority_plan_registration_close`. Active guards then freeze every plan-scoped table. The insertion succeeds only if SQL closure checks prove all of the following at the primary serialization point:

- exactly one source-register and successor adapter-manifest receipt exists for every run-plan Provider and no other Provider;
- receipt-declared document chunks/bytes, environment, credential, source, endpoint, field, implementation, verifier-policy, class, edge, admission, exclusion, and member counts equal exact table counts;
- all ordinals are zero-based, contiguous, unique, and below their physical ceilings;
- every source-register member is represented by exactly one manifest source and endpoint, and no manifest source or endpoint is outside the register;
- every endpoint has exactly one request, approval, owner, source, and manifest relationship; child counts match all parameter, enum, header, redirect-host, content-type, and expected-field rows;
- every used field path is in the fixed vocabulary, every field policy references a complete verifier policy, and no implementation, policy, class, edge, admission, or vocabulary member is unreferenced;
- every approved endpoint/expected-field pair has exactly one admission or one explicit closed exclusion disposition; omission is never a lower-authority shortcut; every field in one record group has the same group identity, policy version, endpoint disposition, precedence graph and effective interval, and the complete group is admitted or excluded together;
- every precedence class has at least one source-class membership, every admitted endpoint references an exact class/source membership, edges exist only between actual classes, the class graph is acyclic, and every initial primary policy is a total order of classes; a later partial-order contract must define and commit a closed maximal-set conflict algorithm before it can be admitted, and incomparability can never choose a source or cause fallback;
- the initial Price and serving-Precision policy places `provider_exact_api` and `provider_exact_authenticated_catalog` in the **same** class with the same primary semantics; every eligible same-class claim enters the same later conflict universe, and source type, recency, or admission role cannot break a tie;
- Provider-controlled public documentation occupies the next lower class; exact Provider support/changelog material occupies a separately approved lower class; publisher checkpoint and independent material cannot be admitted as primary Price, serving-Precision, or applicability authority anywhere in the initial vocabulary;
- verifier profiles contain the exact required roles, family independence, score semantics, and minimum member/family counts; and
- plan, register, endpoint, policy, and approval effective intervals cover the plan interval and precede its first eligible scheduled occurrence.

If any check fails, the close row rolls back. Once it commits, all plan-scoped definition rows are permanently immutable and no later insertion is accepted. A closed plan that fails oracle verification is intentionally stranded and can never gain authority.

### Endpoint validation is executable and fail closed

Before an endpoint base row is staged, the runtime-neutral registrar validates the same canonical value that the independent oracle later hashes:

- scheme is exactly `https`, method is exactly `GET`, no userinfo, port, fragment, literal query value, or full request URL is accepted;
- host and redirect hosts are lowercase ASCII DNS A-labels with total and per-label limits, no empty label, leading/trailing hyphen, wildcard, trailing dot, percent escape, or Unicode confusable;
- IPv4, IPv6, IPv4-mapped IPv6, integer/hex/octal IP spellings, localhost, single-label hosts, and special-use/private/reserved names are rejected;
- every resolved address must later be revalidated immediately before each acquisition connection; registration never treats a DNS name as a permanent proof against rebinding;
- the exact host, redirect-host set, path template, parameter names/locations/types, header names, credential class/injection shape, content types, and locator-template hash match the normalized manifest source;
- path templates start with one `/`, contain no authority, backslash, control, dot segment, empty segment ambiguity, or encoded separator, and every placeholder maps once to a declared path parameter;
- query parameters are declared names and types only; no request value is stored or hashed as registration authority;
- credential references are environment-scoped binding names only; values are never accepted; `Authorization` is permitted only for bearer injection and cookie, forwarding, proxy, referrer, tracing, request-ID, and visitor-derived headers are forbidden; and
- compressed/uncompressed bytes, timeout, redirects, pages, requests, browser use, AI tokens, elapsed time, and cost stay within both manifest and admitted run-plan ceilings.

The source-register tuple, manifest source, explicit owner organization and relationship, permission interval, and field authority class must match structurally. Hostname or Provider branding never proves ownership. Provider APIs and authenticated catalogs remain equal-authority structured Provider sources. Publisher checkpoints cannot become serving Price/Precision/applicability authority, and independent sources remain conflict-detection or corroboration inputs only throughout the initial vocabulary.

### Field paths cannot split one factual tuple

The migration-owned vocabulary is accompanied by closed record-group membership and raw-provider-field mapping contracts. Every group has one immutable group key and ordered membership; every member carries that group key through expected-field mapping, field policy, endpoint admission or exclusion, claim scope and later candidate-field commitment. A group-level guard requires one policy version, precedence graph, endpoint disposition and effective interval across the complete membership. Scalar paths are policy addresses, not permission to splice one fact from unrelated sources.

- Offering applicability is one roster-bound tuple of Provider model ID, tier, endpoint/availability class, material region, and component scope where applicable.
- A Price tuple atomically binds role, class, exact decimal amount, unit, currency and currency provenance, every condition/qualifier, effective interval, exact applicability, observation, evidence, endpoint, and policy.
- A Precision tuple atomically binds raw value, Provider field and definition, normalized format, variant, summary or component identity and exact component label, exact applicability, observation, evidence, endpoint, and policy.
- Known, unknown, null, absent, zero, and not-applicable states are distinct. A missing cached-input price is not zero; unknown is not a claim; a missing component cannot inherit from a sibling or scalar summary.

Every manifest expected field commits both the bounded raw Provider field locator/label and its canonical field path plus record group. The mapping is lossless and deterministic; a label, name resemblance, or generative suggestion cannot establish equivalence. The exact seed corpus—ordinal, path, group, value kind, scope, enum domain, required/conditional status, record group, and allowed authority roles—is a normative machine-readable contract and remains a blocker prerequisite rather than being invented in implementation.

### Root encoding is versioned and independently recomputed

`provenance-v2-authority-root@1` uses SHA-256 over binary frames. A frame begins with ASCII `QCPV2` and version byte `0x01`, then an unsigned 16-bit big-endian ASCII-domain byte length and exact domain, then an unsigned 32-bit big-endian field count. Each field is encoded in registry order without its name as a one-byte tag, an unsigned 64-bit big-endian payload length and payload. Tags are `0x00` null, `0x01` exact NFC UTF-8 text, `0x02` minimal base-10 safe-integer ASCII, `0x03` Boolean with one payload byte `0x00` or `0x01`, and `0x04` raw bytes. A digest uses tag `0x04` and exactly the decoded 32-byte SHA-256 value, not its 71-byte textual spelling. Collections contain their fixed parent context, exact count and ordered repeated child-digest fields, so streaming is possible from a declared count. The codec rejects accessors, prototypes other than plain records/arrays, sparse arrays, non-NFC non-ASCII text, negative zero, floating point, unsafe integers, duplicate keys, and unrecognized fields.

`quantclarity-canonical-json@1` requires duplicate-detecting strict JSON parsing before ordinary object materialization, schema and semantic validation, NFC strings and safe-integer-only numbers, then RFC 8785/JCS UTF-8 serialization with no BOM, trailing whitespace or trailing bytes. These bytes define the exact legacy `AdapterManifest@1` commitment and the retained registration-document witness; an existing fixture hash or implementation-specific `JSON.stringify` result does not.

Every table has a distinct leaf domain. The registry designates zero or one digest-output column for a leaf. A leaf digest is recomputed from every declared authority-bearing column except that designated output. Every other hash-valued column is classified as either a safe-preimage digest, which the oracle recomputes from exact canonical document bytes, or an externally anchored digest, which the oracle verifies against the named pre-existing approved artifact/row and includes as an input. An unclassified hash is a contract failure and no stored or caller-supplied digest can confer authority by itself. When a digest output exists, the oracle requires exact equality. Collection roots are computed from recomputed child digests ordered by the table's complete declared ordinal/key tuple, not caller order or a database's incidental row order. Set roots include their exact count and ordered members. The four plan roots are:

- adapter-manifest set: owner and source-register receipts/members, successor manifest receipt, environments, credential handles, and normalized sources;
- endpoint set: endpoint base/registration, request schema and all children, expected fields, each raw-Provider-field-to-canonical-path mapping, permission approval, and owner/manifest/register bindings;
- verifier-policy set: every verifier implementation, policy, required member/role, family, threshold, independence, disagreement, and quarantine rule; and
- field-policy set: the used field vocabulary and record-group memberships, each field policy, precedence classes and their source-class memberships, precedence edges, endpoint admissions or explicit exclusions, authority roles, equality/conflict rules, and effective interval.

The implementation must ship reviewed machine-readable schemas for `ProvenanceV2RegistrationPlan@1`, `ProvenanceV2AdapterReceipt@1`, the initial field corpus/mapping, and `provenance-v2-authority-root@1` before either hashing implementation. They fix exact keys/types/bounds, Unicode and null/absence rules, duplicate rejection, deterministic order for every collection, legacy `AdapterManifest@1` canonical bytes, successor additions, the three manifest preimages, and every root domain. For every leaf and collection the root registry fixes the exact included columns, column type and nullability, field order, ordinal/key order, child collections, count source, and zero-or-one digest output. Globally unique digests include the installation or authority-plan identity in their preimage except the single migration-owned global vocabulary corpus. The registries are generated from neither runtime implementation and are checked against the migration schema. Registrar and oracle may consume these normative registries but may not share encoder, traversal, hashing, or row-validation code. A missing/extra schema column or registry entry fails the contract check. Migration 0010 cannot replace a blocker until the schemas, exact field corpus, raw mapping and independent golden vectors are present.

The canonical registration-document witness is committed only in the top-level authority root, which binds its contract/hash/byte length, installation/environment, authority-plan and admitted run-plan IDs/hashes, plan interval, all four counts and roots, and the closed-at instant. Every authority surface therefore appears in exactly one leaf/set root or this top-level slot. Revocations are append-only lifecycle overlays and are not rewritten into the historical authority root.

The independent oracle reads only frozen database state for canonical authority, through bounded keyset-paged `SELECT`s on a fresh `first-primary` session. It reads the private canonical registration-document chunks itself, verifies chunk order/length/hash and whole-document length/hash, independently parses the document, recomputes every plan-specific safe preimage, and requires exact parity with every normalized row and digest-only commitment. It independently repeats every endpoint host/path/header/credential, manifest/register/owner, source-class, precedence, record-group, verifier, effective-interval and aggregate-ceiling semantic check rather than treating registrar acceptance as proof. Caller bytes or claimed hashes confer no authority. It recomputes every leaf, count, set root, and the authority root without calling registrar hashing helpers. It fails on a missing, extra, duplicate, reordered, malformed, unreferenced, post-ceiling, document-mismatched, row-mismatched, semantically invalid or unclassified-hash value. An independent Node test oracle and WebCrypto/workerd implementation share only normative registries and published byte vectors, not encoding, traversal, hashing, or validation code.

### Approval is the single authority-minting transaction

Closing does not mint authority. It only inserts the close row after exhaustive SQL assertions and thereby activates every post-close insertion guard. The oracle starts **after** exact close readback, so all bounded pages are read from an immutable plan graph. This avoids both an unbounded transaction and a pre-freeze oracle snapshot.

After the closed graph is independently recomputed, one fresh-primary D1 batch performs the only authority transition. It reasserts the exact capability, installation/environment, run-plan/hash and approval, Provider set, closed graph/counts/roots, absence of an oracle receipt/seal/approval/revocation, applicable source permissions, policy intervals, first-occurrence timing, and expected authority root. It then inserts, in order:

1. the oracle receipt with the pinned oracle implementation hash;
2. the base `provenance_v2_authority_plan_seal` with identical counts and authority root;
3. the approval intent with exact repository-safe artifact path/hash and fixed role set; and
4. the base `provenance_v2_authority_plan_approval` with the same artifact hash, roles, and approved instant.

Any failure rolls back all four rows. The batch result is untrusted until exact fresh-primary readback proves every stored column and the continued absence of revocation. Approval time cannot be backdated, must be no later than the plan's effective start, and must precede the first occurrence that can reference the run plan. Repository fixtures and pending compliance artifacts cannot satisfy production approval.

Authority-plan and endpoint revocation are separate append-only transactions. They require an existing exact approval, a closed reason code, an effective instant no earlier than approval, and fresh-primary readback. A revocation never deletes or mutates historical rows and immediately prevents later bundle opening when effective.

### Guards are stage specific

ADR 0066's requirement to reassert the live occurrence, Provider run and fence applies to mutations that reference them, not to pre-schedule authority registration. Installation initialization proves the exact environment, initialized orchestration boundary, legacy quiescence and guard set. Registration, close and approval prove the installation, admitted run plan/hash, Provider/roster/source authority, effective intervals, and that no occurrence has yet referenced the plan. Bundle opening proves the full occurrence/attempt, Provider run, current unreleased fence, no-terminal and deadline boundary. No earlier stage fabricates a future occurrence or fence.

### Bundle opening reasserts live fence authority

Opening a Provider bundle is one fixed atomic batch and fresh-primary readback. At its serialization point it reasserts:

- the exact installation ID and deployment environment;
- admitted run-plan ID/hash, authority-plan approval/root, and no effective plan revocation;
- occurrence, attempt, run, Provider membership, Provider run, roster version/hash, source-register tuple, and successor manifest receipt;
- scheduled/opened time within run-plan, authority-plan, source approval, endpoint approval, and deadline intervals;
- the current unreleased Provider fence with the same environment, Provider, generation, and Provider run;
- no terminal run/provider outcome, no competing bundle, and no expired deadline; and
- at least one approved, unrevoked endpoint for the Provider, while every Provider endpoint remains part of the approved closed root.

The bundle row still cannot mint a permit, admit a response, fetch a source, write an effect, seal a source outcome, create an artifact, publish, or serve.

### D1 ambiguity has a closed state machine

All reads and writes use fixed prepared statements through `withSession("first-primary")`; the writer uses neither dynamic SQL nor `exec()`. Every input is fully validated before database access. Database errors and public/provider-controlled values are never echoed or logged.

After any thrown error, malformed result, false success, timeout, or response loss, the writer opens a **fresh** first-primary session and classifies the exact immutable operation:

- `applied`: every expected row exists with every expected column and all dependent closure rows agree;
- `absent`: none of the operation's keys exists; the identical operation may be retried;
- `partial`: for multi-page staging only, an exact prefix/subset exists and no unexpected key or value exists; only the exact missing rows may resume;
- `mismatched`: any key exists with a different value, an unexpected dependent row exists, or closure state contradicts the request; terminal integrity failure; or
- `outcome_unknown`: reconciliation itself cannot establish one of the other states; retry is forbidden until the same operation is explicitly reconciled.

Atomic close, approval, revocation, and bundle-open batches can reconcile only to `applied`, `absent`, `mismatched`, or `outcome_unknown`; a `partial` result for an atomic batch is corruption. Result metadata, affected-row counts, returned bookmarks, and a success boolean are never authority by themselves. Bookmarks are private transient transport details and are not persisted in canonical rows, artifacts, logs, public responses, or browser state.

### Limits and zero visitor data remain structural

Per-table ceilings are not an accepted-scale budget: their Cartesian product permits millions of parameter-enum rows. The contract therefore sets one aggregate plan ceiling before implementation for total normalized rows, canonical document bytes, hashing bytes, endpoints, total parameter enums, precedence edges, verifier members, D1 statement pages, result pages, D1 calls, and elapsed CPU. Those values must be derived from accepted-scale workerd evidence and remain below physical maxima. The registrar validates the complete input against them before the first staging write; SQL close independently recomputes and enforces the aggregate row/document limits; and the oracle independently enforces its row/byte/page/CPU ceilings. Root computation is streaming and keyset-paged, retains only bounded accumulator/state, and rejects a continuation past the declared count.

The writer is private control-plane code with the sole canonical write binding. Public frontend, API, and query Workers receive no registration method or D1 write binding. Inputs and rows contain no visitor address/key, cookie, authorization value, user agent, referrer, request URL/query, search text, navigation context, correlation ID, D1 bookmark, or public-request telemetry. Static failures reveal no rejected value. Invocation logs, traces, Tail/Logpush, Analytics Engine request events, and custom request telemetry remain disabled.

## Verification required before implementation status may advance

The implementation is incomplete until all of the following pass in Node SQLite and real workerd/D1 where applicable:

- exact-predecessor, collision, rollback-at-every-statement, blocker-replacement, and unchanged-acquisition/effect-blocker tests;
- accepted minimum and accepted-scale plans plus every vocabulary and physical/application ceiling;
- malformed host, IP-literal obfuscation, special-use/private/reserved name, redirect, path, parameter, header, credential, content-type, timeout, and manifest-binding vectors;
- missing/extra/duplicate/reordered/orphaned/unreferenced rows and every declared-count mismatch;
- precedence self-edge/cycle/total-order gap, equal-authority conflict, publisher/independent misuse, verifier-role/family/threshold/independence, and effective-interval failures;
- independent golden byte vectors for every leaf family, set root, authority root, and oracle receipt, including non-ASCII byte lengths and null/zero distinctions;
- mutation attempts before close, after close, between oracle pages, and during approval; stale installation, run-plan, occurrence, attempt, Provider run, roster, source register, manifest, revocation, deadline, terminal, and fence races;
- D1 `applied`, `absent`, `partial`, `mismatched`, malformed-result, response-loss, and reconciliation-failure outcomes for every operation class;
- accepted-scale workerd CPU/memory/query/result evidence below configured ceilings; and
- privacy/credential/secret scans proving no public binding, route, log, telemetry, visitor-derived field, credential value, authenticated payload, or D1 bookmark persistence.

Independent architecture, data-integrity/neutrality, and security/privacy reviews must report no unresolved P0–P2 finding before the blockers are replaced.

## Consequences

- Large plans can stage safely without granting partial authority.
- Registration close creates a permanent immutable snapshot that an independent oracle can read without a cross-request lock.
- Only the final approval batch mints authority, and it rechecks the complete closed state.
- Direct D1 access remains a privileged capability; least-privilege binding separation and the fixed writer are part of correctness because D1 has no per-table application role model.
- A malformed or unverifiable closed plan is abandoned under a new authority-plan ID rather than repaired.
- Activation advances private registration and bundle-opening readiness only. It does not authorize acquisition, facts, publication, public behavior, remote migration, or deployment.

## Alternatives considered

- **One batch containing every plan row:** rejected because accepted-scale plans cannot depend on an unproven oversized D1/Worker transaction.
- **Approve an open graph and compare roots later:** rejected because post-approval append would drift authority.
- **Trust stored member hashes:** rejected because a caller could make internally consistent roots over false leaf commitments.
- **Represent API/catalog equality as two classes with no edge:** rejected because a missing edge represents incomparability in a partial order and cannot prove equal authority. Both source classes must be members of one precedence class.
- **Compute roots before freezing and rely on row counts alone:** rejected because post-snapshot inserts can change child authority unless every table is frozen and exhaustively counted.
- **Use a D1 bookmark as durable proof:** rejected because bookmarks are transport consistency hints, not canonical content authority, and must not enter retained artifacts.
- **Resolve DNS once at registration:** rejected because it does not prevent later DNS rebinding; acquisition must independently revalidate each connection target.
- **Enable permits with bundle opening:** rejected because no retained-response, effect, seal, or source-outcome boundary is implemented by this decision.

## Follow-up sequence

1. Fix the exact initial field vocabulary, multi-source precedence-class schema, normative root registry, independent vectors, and evidence-derived aggregate plan ceilings.
2. Implement migration 0010, the fixed private registrar, independent oracle, approval/revocation and bundle-opening writers, and the complete adversarial suite above.
3. Add dormant fenced observation/evidence/claim/verification physical effects with non-null admitted-response and fence dependencies.
4. Activate bounded permits, response admission, retained-object verification, complete bundle sealing, and source-backed outcomes only as their own reviewed authority boundary.
5. Build the cumulative claim-authority artifact, current selector, serving/readiness/recovery cutover, remote resources, and deployment in the approved order.
