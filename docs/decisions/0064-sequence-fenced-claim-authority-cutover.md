# ADR 0064: Sequence fenced provenance before the Offering authority cutover

- Status: Accepted sequencing constraint; implementation blocked on the decisions below
- Date: 2026-08-11
- Decision owners: Staff engineer, data-integrity reviewer, security/release reviewer, architecture reviewer
- Related requirements: `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-061`, `PIPE-020`–`PIPE-022`, `PIPE-039`–`PIPE-039C`, `PIPE-044`, `PIPE-050`–`PIPE-056`, `RULE-010`–`RULE-017`, `BE-005`, `BE-011`, `SEC-011`, `SEC-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `OPS-006`, `OPS-008`, `QA-006`, `QA-010`, `QA-012`
- Extends: ADRs 0015, 0043, 0056, 0057, 0061, and 0063
- Related proposed dependency: ADR 0045
- Supersedes: None

## Context

ADR 0063 requires manifest-bound canonical authority before any Price or serving/component-precision observation can become a current public fact. A repository audit tested whether the existing canonical graph could safely supply that artifact.

It cannot. The legacy graph proves useful relationships among claims, exact Offering scopes, evidence, observations, Provider runs, and source-register versions, but it lacks four authorities required for deterministic selection:

1. `policy_version` stores a kind, version, and hash, but not typed field-specific admission rules, precedence classes, or their ordering.
2. `field_claim.verification_state = 'verified'` is a label without an immutable receipt binding verifier, method, inputs, result, independence, and generative-extraction constraints.
3. the source-compliance row stores an opaque source-ID array and artifact hash, but the selected publication cannot reproduce the exact approved endpoint, source type, owner, and adapter-manifest binding.
4. canonical fact tables do not prove that every consumed public Price and PrecisionObservation field, nested component Fact, evidence reference, interval, and observation time equals the authority claim graph.

Canonical migration 0006 installs an initialization-gated freeze for the legacy source graph. Once an exact `publication_orchestration_environment` is initialized, new source effects must use a provenance-v2 design bound to the active coordination fence. The additive provenance-v2 schema may install dormant in a pristine or isolated-recovery database, but no authority row may be admitted, source execution enabled, or trusted authority minted until initialization, legacy-graph quiescence, every legacy guard, and the current fence are proven. Adding authority through an uninitialized or unfrozen path would create an unfenced writer. No production-enabled, source-approved launch-provider input currently exists, so fixtures cannot substitute for this authority.

Finally, proposed ADR 0045 would consume serving schema `1.14.0`, lifecycle v6, and a cumulative recovery-format cutover but still requires a product-owner `BE-011` decision. Claim authority also needs a cumulative closure/readiness/recovery cutover. Allocating a competing schema or proof family before that decision would make the two designs incompatible.

## Decision

### No artifact codec or nominal authority before provenance-v2

Do not implement an `OfferingClaimAuthorityArtifact` builder, trusted brand, persistence layer, current selector, or serving projection from caller-supplied rows, legacy verification labels, EvidenceSummary fields, or fixture approvals. Structural validation is not authority.

The implementation order is fixed:

1. fenced provenance-v2 authority;
2. immutable claim-authority artifact projection;
3. one cumulative manifest/serving/readiness/recovery cutover;
4. deterministic current-fact selection; and
5. neutral comparison transport and presentation.

Each step remains non-authoritative until its predecessor is implemented and independently verified.

### Provenance-v2 prerequisite

The next implementation ADR must define an additive canonical provenance-v2 graph that is immutable and bound to exact environment, admitted run plan, occurrence, attempt, Provider lease generation, Provider run, and active coordination fence. It must add:

- normalized, content-addressed source-endpoint authority binding Provider, approved register version/hash, source ID/type/owner, exact host and path-template commitment, adapter-manifest commitment, permissions, and approval-validity interval;
- content-addressed field-policy authority with a closed field group, admissible source classes, typed precedence-class vocabulary and total/partial order, verification requirements, conflict rule, version, effective interval, and content hash;
- immutable verification receipts binding claim, primary observation/evidence, exact scope, source endpoint, policy, verifier implementation/version, method, output commitment, input hash, and fence; when independence or re-extraction is required, the receipt must also bind the ordered secondary observation/evidence/source-endpoint IDs, extraction/verifier family and output commitments, or one immutable verified-bundle root, plus the policy evaluation proving independence and agreement;
- exact projection commitments for every Price and PrecisionObservation field consumed publicly, including each component claim, nested Fact/evidence time, effective interval, currency provenance/default, qualifiers, supersession, and conflict membership; and
- complete, bounded conflict and supersession accounting rather than optional pairwise rows treated as exhaustive.

The migration must not thaw, backfill, reinterpret, or shadow-write the legacy provenance graph. It installs no writer authority; admissions, writers, source execution, and trusted minting fail closed if a legacy source owner remains active, initialization or guards are absent, or the coordination fence changes.

### Artifact boundary after provenance-v2

Only a controlled projection from the fenced graph may mint the trusted artifact. The artifact uses stable identities and commitments, not private evidence bodies, authenticated payloads, credentials, unsafe locators, or visitor-derived data. It binds every candidate exactly once and every component claim separately under the accepted 100,000-resource and 500,000-membership limits. Its domain-separated root is permutation-stable and mutation-sensitive.

The complete artifact remains private, content-addressed, create-only, and pipeline/control-plane readable. Public/query Workers receive only the later minimized fact projection and public EvidenceSummary material.

### One cumulative lifecycle cutover

Claim authority must not introduce a proof family parallel to the unresolved ADR 0045 embedding-recovery cutover. Provenance-v2 may be designed and implemented independently after its own schema/writer ADR and fence review. Before the authority-artifact durable format or lifecycle cutover is implemented, the product owner must resolve ADR 0045's `BE-011` interpretation and engineering must record one of these choices in a successor ADR:

- combine embedding recovery and claim authority into one cumulative next serving schema, closure domain, lifecycle, backup catalog, and restore/rebuild family; or
- reject/defer ADR 0045 and allocate the next generation solely to claim authority, with an explicit later compatibility path.

The chosen cutover is pristine/dormant only. Existing sealed, ready, active, headed, retained-hot, or rollback publications never receive backfilled authority. Old readiness receipts cannot admit the new schema. Activation and rollback require fresh byte-authentic artifact verification and exact projection replay. The successor cutover ADR must define the first-generation rollback transition; the safe default is to require two independently ready new-generation publications before the first head switch, unless the product owner explicitly accepts a bounded no-rollback or separately proven bridge state.

### Required cutover surface

The cumulative implementation must extend all of the following as one reviewed boundary:

- immutable manifest inputs, closure domain, resource/count inventory, serving seal, and building-only revision rules;
- private artifact storage plus minimized serving-D1 projection and exact coverage constraints;
- readiness receipts, attestation, activation preflight, rollback compatibility, and retained-hot audit;
- backup catalog, recoverable artifact bytes, hostile readback, isolated restore, deterministic rebuild equality, and post-restore probes;
- environment/binding inventory, least-privilege pipeline identities, and protected artifact/backup access-audit design and verification that does not treat native R2 account Audit Logs as proof of object reads or writes; and
- bounded unit, SQLite, workerd, corruption, forgery, migration, rollback, and accepted-scale tests.

No public route, selector, API schema, UI, remote resource, deployment, or release authority is created by this sequencing decision.

## Consequences

- The next code starts at the actual provenance trust boundary instead of encoding untrusted labels into a convincing artifact shape.
- The comparison path and real Provider publication remain blocked, but the dependency order and cutover surface are now explicit.
- ADR 0045's pending product decision becomes a shared lifecycle dependency instead of an independent recovery-only question.
- Implementing provenance-v2 is larger than a local selector helper, but it avoids fabricated verification, incompatible proof families, and irreversible publication backfill.

## Alternatives considered

- **Build an untrusted artifact codec now:** rejected because its deferred shape would prejudge source, policy, verification, and lifecycle semantics and invite accidental nominal promotion.
- **Use the legacy claim graph read-only:** rejected because verification, endpoint, policy, completeness, and fence authority are absent.
- **Add receipts to legacy tables:** rejected because migration 0006 installs an environment-initialization-gated freeze for that writer graph and the initialized path requires fenced provenance-v2.
- **Allocate a separate lifecycle generation now:** rejected because proposed ADR 0045 would consume the next cumulative generation and remains owner-pending.
- **Backfill existing publications:** rejected because retrospective authority would fabricate provenance and invalidate rollback meaning.

## Validation required before implementation

- Before artifact/lifecycle implementation, product-owner disposition of ADR 0045's `BE-011` interpretation and one recorded cumulative-version choice.
- Independent review of the provenance-v2 migration for exact fence ownership, append-only history, source approval, policy bytes, verification receipts, and no legacy bypass.
- Independent hash oracle and adversarial tests for missing/extra/duplicate candidates; wrong publication/resource/provider/scope/component/source/register/policy/receipt/fence; future times; incomplete conflicts; supersession cycles; and public-versus-canonical drift.
- Worker-bound tests at the accepted ceilings without argument spread, monolithic artifact buffering, or unbounded temporary collections.
- Recovery proof that exact artifact bytes and projections rebuild in a fresh isolated environment before any switch authority exists.
