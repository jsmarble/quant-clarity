# ADR 0022: Forbid NUL in canonical provider display names and exact-name queries

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Staff engineer, data-contract owner, search/security reviewers
- Related requirements: `DATA-060`, `SRCH-002`, `SRCH-006`, `SRCH-009`, `PIPE-033`, `PIPE-039A`, `PIPE-044`, `BE-005`, `BE-011`, `SEC-005`, `SEC-007`, `QA-001`, `QA-005`, `QA-006`
- Extends: ADR 0021

## Context

The canonical `Provider` contract currently permits U+0000 in a known,
evidence-backed `display_name`. The serving projection introduced by migration
0007 uses SQLite `length(TEXT)` to enforce the one-to-200-scalar boundary.
SQLite `length(TEXT)` stops before the first U+0000, so a contract-valid name
containing NUL can be rejected by serving storage or measured differently from
the canonical validator. This behavior and the complementary `instr(X,Y)`
operation are documented by SQLite's
[built-in scalar-functions reference](https://www.sqlite.org/lang_corefunc.html#length).
The exact-search normalizer intentionally preserves
U+0000 because it is neither an ADR 0021 separator nor a Unicode normalization
mapping, which can carry the mismatch into `normalized_name` and query input.

This is a contract/storage inconsistency, not evidence that all Unicode control
characters are invalid. The PRD requires provider-controlled strings to be
validated and safely encoded, exact search to remain bounded, and every known
provider fact to retain evidence. It does not require accepting U+0000 or define
any replacement, stripping, or alias inference for it.

## Decision

### Canonical provider boundary

A known canonical provider `display_name` must contain one to 200 Unicode
scalars and must not contain U+0000. The machine-readable `ProviderSchema`, its
generated schema, and the shared Worker-safe validator enforce the same rule.
The Worker-safe validator checks for U+0000 before any scalar-length workaround
substitutes a validation candidate, so a long astral name cannot hide NUL from
schema validation.

Only U+0000 is newly forbidden. Other C0/C1 controls and all otherwise-valid
Unicode remain governed by the existing contract; this ADR does not introduce
a general control-character ban, ASCII-only policy, display sanitization, or
new normalization. A source value containing U+0000 is rejected or quarantined
as the affected known fact. The pipeline must not delete, replace, escape into a
different factual value, or infer around NUL. An independently evidenced clean
name may publish through the normal precedence and verification rules; otherwise
the field follows the existing unknown/conflict policy.

### Exact provider-name query boundary

The internal exact provider-name operation rejects a query containing U+0000
before normalization and before D1 access. It returns the existing static,
non-echoing invalid-input error and creates no log, trace, metric, cache entry,
or retained query artifact. All other input bounds remain unchanged.

`exact-search-normalization@1`, its Unicode 17 tables, hash, and outputs for every
otherwise-valid input remain unchanged. The generic normalizer is not redefined
to strip or reject NUL; the canonical-provider and exact-provider-query callers
enforce this narrower domain at their boundaries.

### Serving D1 defense in depth

Serving migration 0008 advances `serving_schema_metadata.schema_version` from
exactly `1.5.0` to `1.5.1`. Before changing metadata, it fails closed if an
existing provider projection row contains U+0000. It then installs ordinary-table
insert guards that require both
`instr(CAST(NEW.display_name AS BLOB), CAST(char(0) AS BLOB)) = 0` and
`instr(CAST(NEW.normalized_name AS BLOB), CAST(char(0) AS BLOB)) = 0`. BLOB
operands make the zero byte explicit while retaining SQLite's documented
`instr` semantics. The provider-resource/projection
applicability guard must likewise reject a known canonical provider display name
whose extracted value contains U+0000. Existing immutability, completeness,
parity, readiness, switch, and last-known-good-head controls remain unchanged.

Migration 0008 does not rewrite stored names, repair evidence, rebuild Unicode
tables, change projection version `provider-name@1`, or alter a publication. A
failed precondition leaves serving schema `1.5.0` retryable.

The serving migration version `1.5.1` is only the physical D1 schema level. It
is not an adapter `contract_version`, publication manifest `schema_version`,
public API schema version, normalization version, or projection version. The
canonical `ProviderSchema` contract and its generated artifact change together,
while those independently governed version fields change only under their own
release policies. Code must not write `1.5.1` into canonical or public objects.

## Consequences

- Every contract-valid known provider display name has consistent scalar and
  NUL semantics before it reaches canonical publication, projection staging,
  or exact-name lookup.
- NUL-bearing provider facts fail honestly without mutating evidence-backed
  text or broadening the set of rejected Unicode controls.
- Exact-search normalization version 1 remains stable; this decision narrows
  only the two approved caller domains.
- Serving D1 gains redundant fail-closed checks even if an upstream validator
  is bypassed.
- No public route, Cloudflare resource, binding identifier, deployment,
  provisioning, or production-data rewrite is authorized by this ADR.

## Alternatives considered

- Replace SQLite `length(TEXT)` with byte/scalar-safe storage validation while
  continuing to accept NUL: rejected because NUL remains an unsafe and
  operationally ambiguous provider display boundary across SQL, JSON, shells,
  terminals, and downstream presentation systems.
- Strip or map NUL to a space in `exact-search-normalization@1`: rejected because
  it would silently change evidence-backed facts and versioned normalization.
- Reject every Unicode control character: rejected as unnecessary scope growth
  that would exclude contract-valid international text without a requirement.
- Store escaped `\\u0000` as literal display text: rejected because it would no
  longer equal the observed canonical fact.
- Rely only on application validation: rejected because controlled-writer and
  database invariants should independently fail closed when practical.

## Validation

- Prove the JSON Schema validator and shared Worker-safe validator both reject
  U+0000 at the beginning, middle, and end of a known provider display name,
  including an otherwise-valid 200-scalar astral case; unknown facts remain
  valid and non-NUL 200-scalar names remain valid.
- Prove canonical projection building rejects NUL without stripping or changing
  the normalization output of any otherwise-valid golden vector.
- Prove exact provider-name query input containing NUL fails before D1 with the
  same static non-echoing error and leaves no retained visitor-derived artifact.
- In portable SQLite, preserve a clean pre-existing row, seed a pre-migration
  NUL row through a controlled test bypass, and inject a late failure; prove
  clean advancement plus atomic failure/retry at schema `1.5.0`. The migration
  contains no publication or head mutation.
- In real workerd/D1, apply through schema `1.5.1`, inspect both ordinary-column
  NUL guards and canonical applicability, and reject leading/embedded NUL at the
  insert boundary.
- Re-run provider projection, readiness, activation, rollback, reader,
  normalization-conformance, privacy, and full verification gates. Traceability
  statuses remain unchanged: `DATA-060` and `QA-001` retain their existing
  `Implemented` status, while the other mapped rows remain `Planned` until their
  complete acceptance and deployed evidence exist.

## References

- [SQLite built-in scalar functions: `length` and `instr`](https://www.sqlite.org/lang_corefunc.html#length)
