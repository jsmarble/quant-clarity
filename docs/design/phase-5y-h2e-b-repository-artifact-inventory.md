# Phase 5Y-H2e-b: Repository artifact path inventory

| Field | Value |
| --- | --- |
| Status | Locally implemented dormant review evidence; five required files, two approval-row path sources, the complete reviewed build manifest and every authority surface remain pending |
| Governing decision | [Proposed ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Requirements | DATA-060, PIPE-033, PIPE-040, PIPE-050, BE-005, SEC-005, PRIV-001 |

## Outcome

The generated `provenance-v2-repository-artifact-inventory@1` artifact enumerates all ten `repository_artifact` bindings in the reviewed root-binding plan. Independent Node and actual-workerd tests execute all five registration-document path programs and all three literal path programs, preserve the paired-null prompt result, and leave the two approval-intent row-column programs explicitly unresolved because no approval row exists. Every non-null path must be an ASCII repository-relative logical path beneath its exact allowlisted prefix; absolute paths, URLs, backslashes, dot segments, repeated separators, query or fragment text and prefix lookalikes fail.

The audit corrected the deterministic-procedure binding to the compliance namespace already named by the canonical synthetic document: `docs/compliance/provenance-v2/`. It also made the current repository state explicit:

- the registration semantic-policy artifact is the sole present file. Its 1,108 exact tracked bytes and SHA-256 digest are independently verified in Node and workerd and rechecked by `contracts:check` as a non-symlink regular file inside the repository root;
- five resolved paths are absent: the synthetic relationship and endpoint approval records, verifier implementation, deterministic procedure and oracle implementation; and
- two approval artifact bindings have no source row and therefore no path to resolve.

The missing approval records are not created by this slice. Creating plausible files would manufacture evidence that no owner has approved. The missing verifier and oracle implementations remain substantive later work rather than placeholder authority.

## Authority boundary

This phase proves a complete binding/path inventory and one exact-byte comparison witness. It does **not** prove a complete or reviewed repository build manifest. The artifact is `review_candidate`, `outcome: authority_refused`, `authority_eligible: false`, `persisted: false`, `available_repository_path_programs_executed: true`, `repository_path_resolver_executed: false`, `repository_artifact_resolver_executed: false` and `reviewed_build_manifest_complete: false`. The aggregate path resolver remains false because two row-column sources do not exist. Every root-plan repository binding still says `pending_reviewed_manifest`; the partial witness has no exact VCS commit/build identity and cannot authorize registration, approval, source use or a public fact. `contracts:check` fails if a declared-missing path or approval source row appears, if the present witness stops being a regular tracked file, or if its exact bytes change.

No Worker handler, route, binding, D1 operation, migration, remote resource, writer, seal, approval, permit, source effect, log, trace, telemetry or deployment surface is added. The artifact remains outside the public OpenAPI allowlist and contains no credential value, authenticated payload or visitor data.

## Remaining gates

Before repository artifacts can support authority, the project still needs:

- real, reviewed relationship/endpoint approval records supplied through the compliance process rather than synthetic construction;
- the independent verifier and semantic-oracle implementations plus the deterministic-procedure artifact;
- approval-intent and approval rows whose path/hash identity is protected and applicable;
- a complete manifest that pins every required regular tracked file to exact bytes and an exact build identity, then independently rehashes each file;
- persisted predecessor lookup, complete document-output and semantic parity, migration-0010 schema/guard parity and frozen D1 enumeration;
- accepted aggregate CPU, memory, D1 statement/page/call and byte evidence; and
- protected registration, oracle, approval, revocation and bundle-opening writers.

No requirement status advances in this phase.
