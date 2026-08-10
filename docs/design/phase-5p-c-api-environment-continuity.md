# Phase 5P-C: local API/query environment continuity

| Attribute | Value |
|---|---|
| Status | Locally implemented and Worker-runtime tested; no remote or deployment authority |
| Decision | [ADR 0047](../decisions/0047-api-query-environment-continuity.md) |
| Requirements | `API-003`, `API-013`, `API-015`, `API-020`–`API-024`, `BE-003`, `CF-002`, `CF-005`, `CF-006`, `SEC-001`, `SEC-011`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-014` |
| Release gates | Local prerequisite only; all affected traceability rows remain `Planned` |

## Purpose

Close the source-code `local` fallback that blocked the reserved preview API topology. The storage-free API must state one protected deployment environment, forward it unchanged across every query RPC, and fail before query/storage access when configuration is missing, malformed, or crossed.

## Closed runtime contract

The API accepts only exact `local`, `test`, `preview`, and `production` binding values. It does not derive deployment identity from a public request, hostname, service name, or fallback. The protected binding is captured once at request start before any await, but no response is released until applicable request-lifetime abuse controls settle. Limiter faults fail with a static `503`; invalid protected environment then fails with a static `503`; a clean denial returns `429`; only then may a planned protocol response or query RPC be released.

The handler forwards one snapshot to `resolvePublicationV2.environment`, `readDatasetMetadataV1.environment`, and the read envelope's `environment`. The private query Worker compares it to its own protected value before D1. The API continues to hold no D1, R2, Vectorize, AI, Workflow, pipeline, mutation, credential-validation, or privileged diagnostic capability.

## Configuration and proof

The tracked local configuration defines only `DEPLOYMENT_ENV=local`. The zero-visitor-data policy owns that exact variable shape alongside the exact local `CATALOG_QUERY` target, two limiter bindings, disabled pre-invocation cache, and fully disabled public observability. The predeployment manifest binds the parsed configuration digest and root-key allowlist; generated Cloudflare declarations bind the literal local value.

Unit tests prove all four valid values propagate without coercion and missing, hostile, padded, case-varied, boxed, array, numeric, and unknown values cannot reach RPC or the protected clock. They cover bodyless HEAD failure, planned response suppression, IPv6 dual-limit settlement, binding-access exceptions, and configuration precedence without response detail leakage. Existing hardened limiter tests cover exact result shapes, capability faults, address/secret bounds, and request-lifetime opaque keys.

The Worker-runtime suite connects the generated API binding to actual workerd and the named query service. An actual `preview` resolver request against the local query Worker returns `integrity_failure` before D1; the corresponding `local` request reaches the intentionally empty local D1 and returns `read_failure`. Together with handler-level exact forwarding, this proves the local seam without creating a remote preview Worker.

## Gate disposition and non-claims

The narrow local `api_environment_plumbing` item is replaced in the inert preview proposal by `preview_api_query_environment_configuration_and_remote_mismatch_probe`. The local code/configuration/test prerequisite is complete, while protected preview configuration and remote proof remain explicit machine-enforced blockers. This transition grants no authority: the proposal still has no account, zone, host, route, resource identifier, jurisdiction/location, credential, secret value, selected smoke mechanism, protected GitHub environment, provisioned resource, workflow, or deployment command.

Remote preview API/query configuration, dedicated-account isolation, exact bindings, protected identities, access probes, privacy exports, smoke ingress, migrations, resources, rollback exercises, and deployment/release acceptance remain pending under `CF-005`, `CF-006`, ADR 0046, and Phase 7. No traceability status advances.
