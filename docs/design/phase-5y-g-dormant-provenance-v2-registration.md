# Phase 5Y-G: Dormant provenance-v2 registration graph

| Field | Value |
|---|---|
| Status | Implemented locally as dormant physical authority shapes; runtime activation remains blocked |
| Decision | [ADR 0066](../decisions/0066-dormant-provenance-v2-registration.md) |
| Migration | `migrations/canonical/0009_dormant_provenance_v2_registration.sql` |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-010`–`PIPE-022`, `PIPE-030`–`PIPE-045`, `PIPE-050`–`PIPE-056`, `BE-005`, `SEC-003`–`SEC-006`, `SEC-011`, `SEC-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `LEG-001`, `LEG-002`, `QA-002`, `QA-006`, `QA-007`, `QA-010`–`QA-012` |

## Implemented boundary

Canonical migration 0009 adds only the dormant normalized registration and oracle-related physical graph required by ADR 0065 and ADR 0066. The graph represents successor adapter-manifest receipts and source membership; endpoint request, redirect, parameter, header, content-type, crawl, owner, permission, approval, and revocation commitments; Offering price and serving-precision field paths; endpoint admission and precedence edges; verifier profiles and independence requirements; and exact set membership/count/root shapes.

The schema reuses the existing AdapterManifest acquisition vocabulary and ceilings. It distinguishes acquisition source type from evidentiary precedence, binds each endpoint admission to its registered authority class, preserves API and authenticated catalog as equal-authority structured Provider sources in the initial policy, keeps publisher-checkpoint material out of serving-price/precision authority, and treats independent sources as audit/conflict inputs. The bounded field-path registry is not a complete Price or Precision claim vocabulary: the later protected registrar and claim contracts must enforce the approved roles, classes, decimals, currency provenance, conditions, formats, components, applicability, and `unknown` behavior before activation.

Every shape is private, `STRICT`, append-only, and empty after migration except the static migration capability. Set roots and counts are stored only as future oracle inputs; migration 0009 neither computes nor accepts a trusted approval root.

## Exact predecessor and dormancy

Migration 0009 installs only over the exact supported migration-0008 boundary. It verifies the exact predecessor capability and public schema version; the kind/name/target inventory and four-lane normalized-SQL fingerprint of all 42 migration-0008 `provenance_v2_*` objects; the inherited 105-object legacy/publication guard fingerprint; fail-closed semantics for all eight migration-0008 activation blockers; and zero rows in every migration-0008 runtime table. Node SQLite and workerd/D1 share the accepted 42-object profile. Missing, extra, wrong-kind, wrong-target, conditional, inert, pre-seeded, or same-name colliding state fails atomically before a capability can persist.

No migration-0008 blocker is removed or weakened. This slice therefore cannot:

- initialize the protected installation identity;
- register or approve an endpoint, manifest, policy, verifier, or authority plan;
- open a Provider bundle or mint an acquisition permit;
- admit a response, write retained bytes, fetch a source, or create any source effect;
- create an observation, evidence record, claim, verification receipt, disposition, conflict, supersession, or candidate-field commitment;
- seal Provider provenance or enable a source-backed roster outcome;
- create a claim-authority artifact, current selector, serving projection, binding, schedule, remote resource, or deployment; or
- change the canonical public schema version or any public route.

The existing Fireworks adapter and source-compliance material remains synthetic/pending and explicitly disallows production retention and publication. It cannot populate these tables or satisfy a production authority plan.

## Closed bounds and privacy

The physical graph cannot exceed 16 Provider manifest receipts, four environments and 16 credential handles per manifest, 32 sources per manifest, 512 endpoints, 128 field paths/policies, 512 verifier implementations/policies, or 64 members per verifier policy. Each field policy permits at most 512 precedence classes, 4,096 precedence edges, and 512 endpoint admissions. Endpoint child limits reuse AdapterManifest: 64 parameters, 128 enum values per parameter, 16 header names, eight content types, eight redirect hosts, redirect limit at most three, and 128 combined declared field paths. Run ceilings remain 10,000 requests, 1,000,000,000 bytes, and 43,200,000 milliseconds. The public Price limit of 32 conditions, ADR 0010 decimal domain, and public Precision component/string limits remain later claim-contract obligations; migration 0009 does not represent claim values.

The graph stores no credential value, authorization or cookie value, arbitrary full URL, request value, raw query, request identifier, visitor address/key, user agent, referrer, search text, navigation context, correlation ID, or public-request telemetry. No public Worker receives a binding. Static failure messages do not echo rejected data. Migration fixtures are synthetic and non-visitor-derived.

## Verification evidence

The current SQLite and workerd suites prove exact pristine installation, atomic rejection of representative predecessor tampering and pre-seeded runtime state, byte-stable preservation of the eight migration-0008 blockers, empty dormant tables, immutable capability, selected grouped foreign-key relationships, explicit physical ceilings, D1 applicability, and an empty foreign-key check. Repository-wide privacy, type, build, and test gates remain applicable.

The activation slice must add executable acceptance/rejection vectors for every vocabulary and exact boundary; DNS/SSRF and auth/header/parameter semantics; source-register, owner, authority-class, and permission drift; precedence graph and verifier independence rules; complete child-count and set-root closure; missing/extra/duplicate/reordered membership; D1 ambiguity outcomes; and zero-visitor-data/credential scans. Passing the current tests proves only dormant physical compatibility. It does not prove a protected registrar, root oracle, D1 ambiguity protocol, remote D1 migration, or deployment.

## Next slice

The next activation slice is one separately reviewed exact-successor migration plus fixed private D1 adapter. It must install protected initialization, normalized registration, independent root recomputation, approval/revocation, guarded bundle-opening transactions, and fresh-primary ambiguity reconciliation before atomically replacing only their corresponding migration-0008 blockers.

Even after that activation, acquisition permits, admitted responses, retained-object writes, observations/evidence/claims/verification, bundle sealing, source-backed roster outcomes, claim-authority artifacts, current selection, serving/readiness/switch/restore changes, remote resources, and deployment remain blocked.
