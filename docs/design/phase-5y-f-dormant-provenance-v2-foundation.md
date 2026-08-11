# Phase 5Y-F: Dormant provenance-v2 physical foundation

| Field | Value |
|---|---|
| Status | Implemented locally; every runtime path remains blocked |
| Decision | [ADR 0065](../decisions/0065-fenced-provenance-v2-authority.md) |
| Migration | `migrations/canonical/0008_dormant_fenced_provenance_v2.sql` |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-061`, `PIPE-010`–`PIPE-022`, `PIPE-030`–`PIPE-045`, `PIPE-050`–`PIPE-056`, `BE-005`, `SEC-011`, `SEC-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-006`, `QA-010`, `QA-012` |

## Implemented boundary

Canonical migration 0008 installs the static `fenced-provenance-v2@1` capability and empty `STRICT` shapes for the protected installation identity, authority plan/seal/approval, source endpoint, Provider bundle, acquisition permit, and admitted response. Composite foreign keys establish the bundle-to-plan-to-endpoint and response-to-permit-to-bundle relationships before any data can exist. The dormant endpoint base also pins its owner to `organization` and its exact Provider/register-version/artifact-hash tuple to `source_compliance_record`. Its `source_id` and `adapter_source_type` use the existing AdapterManifest grammar and closed vocabulary rather than introducing a parallel source taxonomy.

The endpoint base applies conservative ASCII hostname checks, but does not claim that SQLite alone implements the full `DNS_HOST` regular expression or per-label ceiling. Registration is unconditionally blocked in this slice. The next registrar must validate the exact AdapterManifest `DNS_HOST` contract, path and request shapes, normalized endpoint children, and content root in one protected transaction before replacing that blocker.

The private operational prefixes are registered in the canonical design but excluded from public resource-ID schemas. Dormant physical ceilings inherit existing approved contract maxima: 16 Providers times 32 sources gives 512 endpoint/policy slots, 16 adapter manifests, 10,000 request ordinals, and at most the existing 1,000,000,000-byte per-run limit for one minimized retained response. Later authority-plan admission may narrow these values but cannot exceed its exact Provider/run ceilings.

The migration proves the migration-0007 authority boundary with explicit canonical/orchestration capability and parent checks plus a closed count, aggregate length, and four-lane fingerprint over all 105 relied-upon publication, schedule-orchestration, run-plan source/roster freeze, and legacy guards. It pins the two exact `sqlite_schema` normalization profiles produced by the supported Node SQLite and workerd/D1 runtimes. This includes the admitted-plan revocation guard, source-compliance immutability after run-plan admission, all coordination/fence immutability guards, the full initialization-gated legacy freeze inventory, and the unchanged source-backed roster-outcome blocker. Same-name tables, views, indexes, or triggers fail before any object is created.

Every non-capability insert is unconditionally blocked. Capability replacement, updates, and deletes are blocked; all future runtime tables are append-only. This slice cannot initialize a physical identity, register or approve a plan or endpoint, open a bundle, mint a permit, admit a response, fetch a source, produce a claim, terminalize a source-backed roster outcome, create an artifact, publish, or serve data.

## Verification evidence

`packages/canonical/src/fenced-provenance-v2-foundation-migration.test.ts` covers pristine and initialized installation, empty runtime state, every insert blocker, capability immutability and `REPLACE` refusal, exact legacy-freeze and admitted-history definitions, inert or removed coordination/fence guards, missing source-compliance freeze authority, disabled/wrong-target outcome guards, an active legacy owner, cross-kind collision rollback, schema-version stability, grouped and ordered composite-FK inventory, and physical ceilings.

`apps/pipeline/src/fenced-provenance-v2-foundation.worker.test.ts` applies the real migration set in workerd/D1, reads the static capability, proves installation/permit/response refusal, inspects grouped and ordered bundle/permit/response dependencies, and confirms the legacy source-outcome blocker remains installed.

The existing canonical migration suite also applies migration 0008 across its complete behavior matrix. No remote migration, binding, resource, approval, source record, credential, or deployment is created.

## Next slice

Add protected normalized endpoint children, successor adapter-manifest receipts, field/verifier-policy membership, independent root oracles, and authority-plan approval. Only that complete slice may replace its specific registrar/approval blockers and enable guarded bundle opening. Permit, response, source effect, and source-backed roster-outcome blockers remain.
