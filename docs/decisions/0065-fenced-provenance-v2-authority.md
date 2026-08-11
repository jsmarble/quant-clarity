# ADR 0065: Build provenance-v2 as a sealed fenced authority graph

- Status: Accepted implementation design
- Date: 2026-08-11
- Decision owners: Staff engineer, data-integrity reviewer, security/release reviewer, architecture reviewer
- Related requirements: `DATA-008`, `DATA-009`, `DATA-021`, `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-061`, `PIPE-010`–`PIPE-022`, `PIPE-030`–`PIPE-045`, `PIPE-050`–`PIPE-056`, `RULE-010`–`RULE-017`, `BE-005`, `SEC-011`, `SEC-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `OPS-006`, `OPS-008`, `QA-006`, `QA-010`, `QA-012`
- Extends: ADRs 0015, 0057, 0061, 0063, and 0064
- Supersedes: None

## Context

ADR 0064 requires canonical claim authority to be rebuilt on the active publication-coordination fence before an Offering claim-authority artifact or current-fact selector can exist. The legacy source graph cannot be upgraded in place: it has no reproducible endpoint authority, typed field-policy bytes, immutable verification receipts, exhaustive resolution accounting, or exact public-field commitments. Migration 0006 also freezes that graph after orchestration initialization.

The replacement must tolerate multi-batch D1 writes without treating a partial batch as authority. It must remain inert in a pristine or isolated-recovery database, reject a stale Provider writer after its fence changes, preserve unsuccessful evidence for audit, and make completeness mechanically provable before any downstream consumer can use the graph.

## Decision

### Authority exists only at a sealed bundle

Provenance-v2 is an additive graph rooted at one immutable Provider authority bundle. A bundle binds the exact environment, admitted run plan and hash, occurrence and attempt, Provider, Provider run, fence generation, adapter version and manifest hash, roster version and hash, approved source-register version and artifact hash, separately approved provenance authority-plan root, deadline, and observation interval. The existing `publication-run-plan@1` policy-set hash covers only budget, retry, and terminal-deadline policy; it is never represented as covering endpoint, precedence, or verification policy.

Rows may be staged in bounded ordinal chunks, but an unsealed or rejected bundle has no canonical-claim, roster-outcome, artifact, or publication authority. The only fact-bearing state is an immutable bundle seal created after database-enforced closure checks. There is no mutable `current`, `verified`, or `selected` flag.

Every staging mutation and the seal transaction recheck the exact initialized environment, admitted Provider run, unreleased current fence head, deadline, run-plan Provider inputs, and absence of a Provider terminal. New acquisition starts at or after the fence claim and strictly before the run deadline; retrieval, evidence, claim, verification, and disposition times are monotonic. A later fence generation makes the old graph historical and permanently unwritable.

After the complete graph and validator are deployed and a separate activation gate is approved, source acquisition may obtain one immutable, bounded, ordinal pre-request permit from the current fence and approved authority plan. It rechecks that permit and fence before admitting the response. The permit breaks the acquisition/seal dependency cycle but conveys no canonical fact authority: the response and all staged effects remain non-authoritative until bundle seal. A response alone never conveys authority.

Installation is dormant. The migration may run without an initialized orchestration environment, but no authority row may then be inserted. It does not initialize an environment, claim a fence, fetch a source, create a binding or schedule, or enable the currently blocked source-backed roster outcome.

### Closed normalized graph

The migration uses `STRICT`, append-only `provenance_v2_` tables. Relationships, order, and completeness are normalized rather than hidden in JSON.

| Authority | Required commitment |
|---|---|
| capability metadata | one static migration capability, predecessor capability, hash domain, and closed vocabulary versions |
| installation identity | an initially empty singleton, populated once by protected initialization with an immutable ID unique to the physical environment/database and exact-matched to the orchestration environment |
| authority plan/seal/approval | an immutable one-to-one extension of an existing run plan, registered and approved before its first scheduled occurrence, committing the endpoint set, field-policy set, verifier-policy set, and successor adapter-manifest receipt without altering the existing plan seal |
| bundle | complete coordination, Provider, plan, adapter, roster, source-register, policy-set, deadline, and fence identity |
| source endpoint | Provider, exact approved source ID and closed source type, stable source-owner organization ID and Provider/owner relationship class, exact register membership, lower-case ASCII host, safe path-template hash, retrieval method, credential class/injection shape, redirect/parameter/header/content-type sets, crawl controls, permissions, approval/revocation interval, adapter-manifest hash, and endpoint-set root |
| field policy | closed field group/path, version and effective interval, endpoint/source admission, typed precedence classes and order edges, verification profile, confidence threshold, conflict/equality rule, quarantine rule, canonical bytes, and content hash |
| observation | endpoint, exact Offering applicability, retrieval time, verified redacted/minimized retained-byte hash and approved content-addressed private object reference, parser/extractor identity, normalized-output hash, and bounded acquisition accounting |
| retained-object verification | protected environment installation ID, exact content-addressed key, redacted-byte digest and count, retention/DLP policy, hostile readback result, and immutable receipt root |
| Offering applicability | roster-bound exact Provider model ID, tier, endpoint class, material region, and tuple root; no stable Offering resource ID is allocated inside a run bundle |
| evidence | observation, safe locator commitment, retained span hash, observed time, applicability-scope hash, and content hash |
| claim | observation, evidence, policy, exact subject and Offering scope, closed typed field path, raw and normalized value commitments, precedence class, effective interval, observation time, qualifier root, and content hash |
| verification receipt | claim, primary observation/evidence/endpoint, policy, verifier implementation/version/family, method, input/output/span commitments, result/confidence, independence basis, exact scope/fence, and verification time |
| verification member | ordered independent/re-extraction observation, evidence, endpoint, extractor/verifier family and version, input/output/span commitments, result, and membership root |
| resolution | exactly one disposition for every claim: eligible, ineligible, corroborating, conflict-member, superseded, rejected, or audit-only, with a closed reason and policy-evaluation hash |
| conflict set/member | a complete eligible-claim universe and every unresolved equal-authority conflict; every conflicting claim belongs to exactly one set and every set has at least two same-field/scope claims |
| supersession edge | same-field/scope/source older-to-newer lineage with monotonic time; self-edges, branching parents, and cycles are rejected |
| candidate-field commitment | every eligible supporting claim or named deterministic derivation for each candidate Price or PrecisionObservation JSON field, nested component, Fact/evidence time, effective interval, currency provenance/default, qualifier, and scope; it does not select a current value |
| bundle seal | exact ordinal chunks, counts, roots, roster coverage, claim disposition, verification, conflict/supersession, and public-field coverage |

Resource IDs remain opaque prefixed UUIDv4 values; only roots and content digests derive from canonical bytes. Bounded canonical JSON is allowed only for closed leaf values. Evidence bodies, raw or authenticated payloads, pre-redaction hashes, credentials, arbitrary URLs or headers, request identifiers, and visitor-derived data are forbidden. Private objects contain only policy-permitted redacted/minimized bytes and use an environment-qualified conditional-create writer followed by bounded hostile exact-key readback. Bundle sealing requires its immutable byte-authenticity receipt and never trusts a caller-supplied key or hash.

Source and policy definitions come from a separate protected, hash-verified authority-plan registrar. A source-effect writer cannot invent endpoint approval, policy order, adapter identity, or verification rules in the request that asserts a claim. The authority plan must be sealed and approved before the first schedule occurrence can reference its base run plan; later backdating is rejected. Approval and revocation history is immutable, and bundle validation applies the interval effective at the scheduled and observation times. A successor canonical adapter-manifest receipt supplies the source owner and manifest hash that `AdapterManifest@1` does not contain.

Migration 0006 does not freeze every legacy entity table. Provenance-v2 therefore does not treat a legacy `resource_identity`, `offering`, or other mutable entity row as source authority. It commits only the exact Offering applicability tuple from approved roster and source observation. A later protected successor identity registry must assign or reuse one globally stable opaque Offering ID with unique tuple ownership and history before canonical projection; it may not bless an unfenced legacy insert. Before any other legacy source-derived entity can be consumed, its exact initialization-gated freeze or an equivalent v2 identity authority must be added and tested.

### Field, policy, and verification boundary

The first field vocabulary covers only public Offering price and serving-precision facts required by ADR 0063:

- price role, amount, unit, currency, currency provenance, condition/qualifier, effective interval, and promotional state;
- precision raw value, provider field, provider definition, normalized format, format variant, summary/component identity and scope, and observation time; and
- exact Offering applicability: Provider model ID, tier, endpoint class, and material region.

Unknown remains a later selector result, never a fabricated v2 claim. Cached-input price is independent from input price. BF16 and FP16 remain distinct. Component claims cannot be replaced by a scalar summary. `system_default` currency permits only USD and never overwrites a provider-stated currency.

The policy vocabulary is closed and field-specific. Precedence uses normalized directed edges and an explicit `total` or `partial` order. Seal validation rejects reflexive edges, cycles, missing classes, an incomplete total order, and any eligible claim whose endpoint, source/precedence class, verification, conflict disposition, or effective time fails its policy. Equal-authority material disagreement remains an unresolved conflict universe; only the post-artifact selector may produce current or unknown.

A verification receipt is derived authority, not a caller label. Deterministic parsing of structured authoritative data may use the closed deterministic profile after applicability, provenance, schema, and anomaly checks. Unstructured claims require source-span entailment plus qualifying independent re-extraction or deterministic/second-authoritative corroboration. When independence is required, ordered members prove materially different extractor/verifier families or an approved independent deterministic procedure. Another sample of the same model/prompt family does not qualify. Disagreement cannot produce an eligible candidate-field commitment.

### Writer protocol and ambiguity handling

The private pipeline surface is limited to:

1. a fresh-primary resolver returning a process-local branded exact fence authority;
2. opening one bundle under that authority;
3. appending one bounded deterministic ordinal chunk;
4. sealing the bundle; and
5. closing Provider-run provenance.

The brand is only a precheck. Protected initialization populates the initially empty installation-identity singleton once; the static migration never embeds or clones a database identity. The ID is bound into authority plans, bundles, resolver brands, mutations, retained-object receipts, and reconciliation. This distinguishes a wrong database or clone even when its logical environment string matches; D1 SQL is not assumed to introspect a resource ID. Restore creates a new destination installation ID and preserves any source IDs only inside imported historical receipts, never as destination write authority. Every authority insert independently reasserts the installation ID plus the plan, occurrence, attempt, Provider, Provider run, current fence head/claim, no release, deadline, source/policy membership, unsealed state, and no Provider terminal in the same D1 transaction. Operations accept exact plain inputs, use fixed prepared `INSERT` statements, and never use dynamic SQL, `REPLACE`, `IGNORE`, update, or delete.

Each mutation reads its complete projection back from a primary session. A thrown or malformed result is reconciled from a new primary session. Exact equality returns applied or idempotent success; proved absence permits one identical retry; partial, extra, or mismatched state is an integrity failure; unreadable state remains outcome-unknown. Retry identities and commitments never change.

The writer never returns trusted claim authority. A later projector must read a sealed bundle with a separate fixed query and independently verify roots and closure. Large Provider graphs are streamed as bounded chunks; final closure proves exact ordinals and totals without whole-graph buffering.

Fence loss during a mutation rolls back the complete D1 transaction. Any private bytes left by an ambiguous or failed cross-service operation remain content-addressed, quarantined, and non-authoritative; they are never relabeled. Source approval expiry or revocation blocks new acquisition and later publication admission without rewriting historical evidence. Publication eligibility rechecks approval at its cutoff and requires every consumed observation, evidence, and nested Fact time at or before the trusted manifest generation time. Provider terminal/root/count disagreement fails the whole new slice and preserves the last known-good publication.

### Migration and activation boundary

The migration installs only over exact migration 0007. Before creating any object it verifies the canonical and orchestration capabilities, revocation-history guard, complete migration-0006 legacy freeze/guard inventory, and absence of every new name regardless of SQLite object type. It neither changes canonical schema version nor mutates legacy rows. Installation with no environment remains valid for pristine/recovery setup, but insertion does not.

The first implementation increment adds only static capability, empty installation-identity, authority-plan/bundle, dormant source-endpoint base, acquisition-permit, and admitted-response shapes. The endpoint base exists only so the permit-to-approved-plan relationship is structurally foreign-keyed before data; normalized endpoint children and registration authority remain absent. Unconditional triggers block endpoint registration, plan approval, bundle opening, permit/response insertion, and every source effect until normalized members and validators exist. Every later observation, evidence, claim, and verification row has a non-null composite dependency on an admitted response under the same bundle and fence; that relationship exists before any data and is never retrofitted. The second increment adds and independently verifies endpoint children, policy, verifier, and successor-manifest roots before enabling endpoint registration, plan approval, and guarded bundle opening. Permit, response, and effect blockers remain until the full graph, seal validator, root oracle, protected activation gate, and adversarial review enable them together. Migration 0006's `publication_roster_outcome_source_execution_blocked` trigger remains intact until a later separately reviewed source-backed outcome activation.

Required SQLite and workerd tests include dormant refusal; exact predecessor/collision/guard checks; wrong installation/environment/plan/Provider/run/generation; active legacy runs; fence advance/release and terminal races; expired/revoked approval; endpoint/register/manifest/owner drift; unsafe paths/redirect/auth shapes; invalid precedence graphs; fake same-family independence; missing, extra, or reordered receipt members; missing/truncated/cross-environment retained objects; scope/component/price-partition drift; future times; duplicate/missing dispositions; supersession self/cycle/branch; incomplete conflicts; premature selection; candidate/evidence/time drift; ambiguous writes; hostile JavaScript inputs; accepted-scale bounds; recovery installation; and privacy scans.

This ADR allocates no artifact format, manifest field, serving schema, readiness receipt, recovery importer, selector, public route, binding, remote resource, or deployment.

## Consequences

- Multi-batch ingestion can progress without making partial data authoritative.
- Stale Workers cannot keep writing after fence transfer, even with caller-side state.
- Exact policy, endpoint, verification, resolution, and public-field commitments become reproducible inputs to the later ADR 0063 artifact.
- The graph stores more normalized private audit commitments but no visitor information or raw source payload.
- Current facts, comparison, acquisition permits, and deployment remain blocked.

## Alternatives considered

- **One transaction for the full Provider graph:** rejected because accepted ceilings exceed a safe D1 batch and make retry outcomes difficult to reconcile.
- **Treat each verified claim as immediate authority:** rejected because conflict, supersession, roster, and projection completeness belong to the closed set.
- **Opaque JSON policies, receipts, or conflicts:** rejected because typed membership, order, independence, and completeness could not be enforced.
- **Mutable current pointers:** rejected because fence history and immutable seals already provide temporal authority.
- **Thaw or dual-write legacy provenance:** rejected because it creates two source owners and contradicts ADR 0064.
- **Enable fetching with bundle opening:** rejected because opening proves no child or seal closure.

## Follow-up sequence

1. Implement exact-predecessor capability, empty installation identity, and dormant authority-plan/source-endpoint-base/bundle/permit/response shapes with unconditional registration/approval/open/permit/response/effect blockers and refusal tests.
2. Add protected normalized source children, policy/adapter-manifest registration, independent roots, plan approval, and guarded bundle opening.
3. Add fenced observations, retained-object receipts, evidence, claims, receipts, and exhaustive eligibility/candidate-field closure with non-null same-bundle/fence admitted-response dependencies while acquisition and every effect remain blocked.
4. Add bounded ordinal acquisition permits, bundle sealing, and an independent root oracle; only then replace the source-backed roster blocker with an exact sealed-bundle requirement in a separately reviewed activation.
5. After the owner resolves proposed ADR 0045's `BE-011` interpretation, define the single cumulative artifact/serving/readiness/recovery cutover required by ADR 0064.
