# ADR 0066: Install provenance-v2 registration authority as dormant physical shapes

- Status: Accepted implementation design
- Date: 2026-08-11
- Decision owners: Staff engineer, data-integrity reviewer, security/release reviewer, architecture reviewer
- Related requirements: `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-010`–`PIPE-022`, `PIPE-030`–`PIPE-045`, `PIPE-050`–`PIPE-056`, `BE-005`, `SEC-003`–`SEC-006`, `SEC-011`, `SEC-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `LEG-001`, `LEG-002`, `QA-002`, `QA-006`, `QA-007`, `QA-010`–`QA-012`
- Extends: ADRs 0010, 0059, 0064, and 0065
- Supersedes: None

## Context

ADR 0065 requires a protected registrar to bind normalized endpoint, source-owner, source-register, adapter-manifest, field-policy, precedence, and verifier definitions into one approved provenance authority plan. Migration 0008 deliberately provides only blocked parent shapes. Its endpoint row cannot by itself prove the complete request schema, exact manifest membership, field-specific precedence graph, verification profile, or independently recomputed set roots.

Activating registration while those definitions are being introduced would create an irreversible mixed state: a partial registrar could approve a plan or open a Provider bundle before all members and roots were present. Dropping any migration-0008 blocker in the same increment that first defines the physical graph would also make review of schema closure inseparable from review of protected writer authorization, D1 ambiguity handling, and fence races.

The safe implementation split is therefore narrower than ADR 0065's logical second increment. Migration 0009 may install the complete dormant registration and oracle-related physical vocabulary, but it does not activate any writer. A later exact-successor slice must add the protected registrar, independent root recomputation, approval and bundle-opening transactions, and only then replace the specific blockers as one atomic authority boundary.

## Decision

### Migration 0009 remains wholly dormant

Migration 0009 is additive. It installs normalized `STRICT`, append-only shapes for:

- successor adapter-manifest receipts and exact source membership;
- source-endpoint request, redirect, parameter, header, content-type, crawl, permission, owner, approval, and revocation commitments;
- closed Offering price and serving-precision field groups and paths;
- endpoint admission, typed precedence classes, and normalized precedence edges;
- verifier implementations and profiles, required member roles, explicit parts-per-million thresholds, independence requirements, conflict/equality behavior, and quarantine behavior;
- set membership, counts, content hashes, and independently recomputable endpoint, field-policy, verifier-policy, and adapter-manifest roots; and
- the physical history needed for later authority-plan approval and revocation validation.

The migration installs no registration row, source approval, authority-plan seal or approval, installation identity, Provider bundle, acquisition permit, admitted response, observation, evidence, claim, verification receipt, roster outcome, artifact, current selection, or publication. Every migration-0008 runtime insert blocker remains installed with its exact body. In particular, migration 0009 does not enable installation initialization, plan or endpoint registration, plan sealing or approval, bundle opening, permit minting, response admission, or source-backed roster outcomes.

The static migration-0009 capability may be the only row it creates. It does not advance the canonical public schema version and is not public fact authority.

### Exact predecessor and collision boundary

Before creating an object, migration 0009 must prove the exact supported migration-0008 state. The proof includes:

- the exact migration-0008 provenance capability values, the unchanged public schema version, and singleton cardinalities;
- the closed 42-object `provenance_v2_*` predecessor inventory by SQLite object type, name, and target table;
- fail-closed semantics for all eight migration-0008 activation blockers: each remains an unconditional `BEFORE INSERT` abort guard on the expected table with its expected refusal; and
- the complete normalized-SQL fingerprint of those 42 objects, the inherited 105-object legacy/publication guard fingerprint, and zero rows in every migration-0008 runtime table; and
- absence of every migration-0009 table, index, trigger, or other reserved name regardless of SQLite object type.

Missing, extra, renamed, wrong-kind, wrong-target, conditional, inert, semantically weakened, or pre-seeded predecessor state rejects atomically. Four independent rolling lanes bind the normalized `sqlite_schema.sql`; the supported Node SQLite and workerd/D1 versions produce the same migration-0008 profile. Migration 0009 neither repairs nor accepts a weakened predecessor.

### Closed endpoint vocabulary

Registration shapes reuse the existing `AdapterManifest` acquisition vocabulary rather than create a competing source taxonomy:

- source type: `provider_api`, `authenticated_catalog`, `public_static_page`, `public_rendered_page`, or `publisher_checkpoint_repository`;
- scheme `https` and method `GET` only;
- authentication class `none`, `api_key`, or `bearer`;
- credential injection `authorization_bearer`, `header`, or not applicable;
- parameter location `path` or `query`, with value type `string`, `integer`, or `boolean`; and
- source-owner relationship `provider_controlled`, `publisher_controlled`, or `independent`.

Source type describes acquisition mechanics; it is not a precedence label. Static and rendered provider pages have equal evidentiary authority unless a separately approved field policy states otherwise. A source URL, hostname, display label, or caller assertion never proves ownership or precedence.

The physical ceilings do not exceed the existing contract and run-plan limits: 16 Provider manifests per plan; four environments, 16 credential handles, and 32 sources per manifest; therefore 512 endpoints per plan; 64 parameters per endpoint; 128 enumerated values per parameter; 16 allowed header names; eight content types; eight redirect hosts; redirect limit zero through three; 64 declared precision fields; 64 declared price fields; 128 registered field paths and field policies; 512 verifier implementations and verifier policies; 64 members per verifier policy; 512 precedence classes, 4,096 precedence edges, and 512 endpoint admissions per field policy; 10,000 requests per run; 1,000,000,000 bytes per run; and 43,200,000 milliseconds per run. Text and collection members retain their existing `AdapterManifest` byte or character ceilings. A request timeout must fit the exact Provider/run duration; the registrar cannot use the manifest's otherwise open-ended integer as unbounded authority.

Only request schemas, credential class/injection shape, and header names may enter canonical registration. Credential values, authorization or cookie values, arbitrary request values, full URLs, query strings, userinfo, fragments, IP literals, localhost/private destinations, request identifiers, and visitor-derived material are forbidden. Host and redirect membership, path templates, parameter schemas, and header names require deterministic canonicalization and SSRF validation before later registration can be activated.

The exact Provider, source-register version and artifact hash remain structurally bound to `source_compliance_record`. Normalized source membership must additionally prove that the source ID belongs to the approved register and exact successor manifest receipt; the legacy opaque `source_ids_json` is not registration authority by itself. Source owner is an explicit stable `organization` identity. `provider_controlled` requires the exact Provider organization rather than inference from a hostname. Approval is usable only while access, retention, and publication are permitted and the review interval is current. Excerpt permission remains separate and governs whether an excerpt may be exposed. Approval and revocation history is append-only.

### Closed initial field and verification vocabulary

The field-path registry uses the closed groups `offering_applicability`, `price`, `precision_summary`, and `precision_component`, with value kinds `text`, `decimal`, `currency`, `timestamp`, `boolean`, and `enum`, and scopes `offering`, `price_role`, `precision_summary`, and `precision_component`. The registry is bounded physical input, not a complete claim-value vocabulary. The protected registrar and later claim contracts must allow only explicitly approved paths and the Price/Precision values below before any blocker is replaced. Exact Offering applicability—Provider model ID, tier, endpoint class, material region, and component scope where applicable—is mandatory authority input, not a selectable fact.

Known precision values are `BF16`, `FP16`, `FP8`, `FP6`, `FP4`, `NVFP4`, `MXFP4`, `INT8`, `INT4`, `mixed`, and `other`. `unknown` is a later selector result and is never fabricated as a provenance-v2 claim. Component kinds are `stored_weights`, `weight_computation`, `activations`, `accumulation`, `kv_cache`, `attention`, `experts`, `shared_layers`, and `other`; `other` requires the exact bounded observed component label. Policies cover the raw value, provider field and definition, normalized format, format variant, summary/component identity, scope, and observation time without allowing a scalar summary to replace component facts.

Price roles are `input`, `output`, and `cached_input`. Price classes are `standard`, `promotional`, `batch`, `subscription`, `committed`, `volume`, `dedicated`, `region_tiered`, `context_tiered`, and `other_conditional`. Currency provenance is `provider_stated` or `system_default`; `system_default` permits only USD after evidenced provider omission. Unit is `per_million_tokens`. Amounts use ADR 0010's exact non-negative decimal domain of at most 24 integer and 18 fractional digits. A Price has at most 32 bounded condition members. Standard-comparability and USD defaulting are named deterministic derivations, never source or caller assertions.

Initial precedence keeps exact Provider API and authenticated-catalog facts in one equal-authority structured class, followed by exact Provider-controlled public documentation. Provider support or changelog material may be represented only by an explicitly approved semantic policy role over an allowed acquisition type. Publisher-checkpoint sources are upstream lineage authority, not serving-price or serving-precision authority. Independent structured sources are audit/conflict inputs in the initial policy and community discussion is never canonical evidence. Equal-authority material disagreement remains unresolved and cannot be hidden through source-type ordering or recency.

Verifier profiles are closed to:

- deterministic structured parsing after schema, exact-applicability, provenance, and anomaly validation;
- source-span entailment plus an independent extraction-model family;
- source-span entailment plus an independent deterministic procedure; and
- source-span entailment plus a second authoritative source.

A second stochastic sample from the same model/prompt family is not independent. Migration 0009 stores verifier and field-policy thresholds as explicit integers from zero through 1,000,000 parts per million. The later registrar must treat a deterministic profile's score as not applicable in policy semantics and must require an explicitly approved threshold for scored verification; the schema value is not permission to invent a default. The `QA-011` gold-set acceptance percentages are not claim-confidence values. Missing span, missing qualifying corroboration, disagreement, failed applicability/provenance, or an unresolved anomaly cannot become eligible.

Equality is exact canonical-byte equality. The `exact_price_tuple` rule includes role, class, amount, currency and provenance, unit, conditions, and effective scope; it can never compare amount and unit alone. Precision equality includes normalized format, variant, component identity, and exact Offering applicability. The initial policy defines no fuzzy price tolerance, precision bit ranking, BF16-versus-FP16 quality order, currency conversion, sibling-component fill, or newest-source universal winner.

### Root shapes are proof inputs, not an oracle result

The adapter-manifest set contains exactly one successor receipt per run-plan Provider. The endpoint set covers every approved manifest source and every normalized child. Field-policy and verifier-policy sets cover every declared group, path, endpoint admission, precedence class/edge, verification rule, and effective interval. Counts and roots use domain-separated, length-prefixed canonical bytes with deterministic byte ordering and reject missing, extra, duplicate, or reordered membership.

Migration 0009 may store the member and seal shapes required for an independent oracle, but it does not trust a caller-supplied root and does not activate approval. The later activation slice must ship a separately implemented root oracle, compare every recomputed set root and count with the authority plan in one protected transaction, and prove the oracle against independent vectors and accepted-scale workerd tests.

### Zero visitor data remains structural

All new rows are private pipeline/control-plane definitions. They cannot be derived from a live public request and contain no visitor IP address, source-address key, cookie or authorization value, user agent, referrer, request URL/query, search text, navigation context, correlation ID, or public-request telemetry. No public, frontend, API, or query Worker gains a binding or method for these tables. Migration and tests use only static or synthetic non-visitor values. Errors are static and do not echo rejected material.

### Later activation is one atomic successor boundary

A later ADR and exact-successor migration must activate registration, authority-plan approval, and guarded bundle opening together with the fixed private D1 writer. That slice must:

1. exact-match migration 0009 and prove every dormant blocker;
2. install protected installation initialization, registrar, root oracle, approval/revocation, and bundle-opening guards before removing any blocker;
3. remove only the installation, registration, authority-plan seal/approval, and bundle-opening blockers whose active replacements are already installed;
4. reassert installation, environment, run plan/hash, Provider membership, occurrence/attempt, Provider run, roster, source register, manifest, policy roots, current unreleased fence, no terminal, no revocation, and deadline in each mutation transaction; and
5. implement exact readback and fresh-primary reconciliation for applied, absent, mismatched, partial, or outcome-unknown D1 results.

Before replacing an endpoint blocker, the protected registrar must also validate exact canonical DNS labels and public-route eligibility, reject IP literals and local/private/reserved destinations, and bind the executable host/path templates to the normalized manifest receipt. The SQL host checks in the dormant parents are conservative syntax checks, not an SSRF decision procedure.

Acquisition permits, response admission, retained-object writes, every source effect, bundle sealing, source-backed roster outcomes, artifacts, selection, serving, bindings, schedules, remote resources, migration of a deployed database, and deployment remain blocked after that activation slice. They require the later ADR 0065 increments and independent review.

## Consequences

- The complete registration vocabulary can be reviewed and tested without granting authority to a partially implemented writer.
- Existing migration-0008 refusal remains the effective runtime behavior.
- Root and membership schemas cannot be mistaken for independently verified authority.
- The later activation change is larger, but it has one auditable before/after authorization boundary and no intermediate partially enabled state.
- No public behavior, data, privacy posture, deployment readiness, or requirement status advances.

## Alternatives considered

- **Drop selected migration-0008 blockers in migration 0009:** rejected because schema installation is not protected registration or root verification.
- **Activate endpoint registration but defer policy/verifier closure:** rejected because a source-effect writer could later consume incomplete authority.
- **Trust AdapterManifest or source-register hashes without normalized membership:** rejected because neither proves complete endpoint, owner, policy, or source applicability.
- **Treat API labels as higher authority than authenticated catalogs by default:** rejected because the PRD groups them as exact Provider structured sources and equal-class conflict must remain visible.
- **Use `QA-011` acceptance rates as confidence thresholds:** rejected because dataset-level precision/recall is not a per-claim verifier score.
- **Add public or deployment wiring for future convenience:** rejected because dormant canonical shapes confer no serving or operational authority.

## Follow-up sequence

1. Implement migration 0009 as the exact-predecessor, collision-safe, fully dormant registration/oracle physical graph with SQLite and workerd refusal tests.
2. Design and implement the atomic protected registrar, independent root oracle, authority-plan approval/revocation, guarded bundle opening, and D1 ambiguity reconciliation; replace only the corresponding blockers.
3. Add fenced acquisition/observation/evidence/claim/verification effects while permit, response, seal, source-outcome, artifact, and publication authority remain blocked until their complete activation boundaries.
4. Continue ADR 0065's sealed-bundle and cumulative artifact/serving/readiness/recovery sequence.
