# Phase 5P-A: predeployment embargo and configuration authority

| Attribute | Value |
|---|---|
| Status | Local policy and CI enforcement implemented; every preview/production authority and deployed gate remains pending |
| Requirements | `CF-005`–`CF-007`, `SEC-002`, `SEC-011`, `PRIV-007`, `PRIV-011` |
| Release gates | Local prerequisite only; no release-gate status advances |

## Purpose

QuantClarity has no authorized preview or production deployment topology. The logical environment inventory deliberately records every environment as unprovisioned, and the repository contains only local Workers configurations used for compile, workerd, and browser evidence. This phase turns that boundary into a CI-checked repository invariant before any protected deployment workflow or Cloudflare credential exists.

`config/predeployment-policy.json` is the closed, non-secret authority inventory. It fixes the complete parsed environment inventory; the exact scripts and `allowScripts` policy of every package manifest; the raw npm configuration and lockfile; the complete parsed contents of every local Wrangler configuration; and the exact contents of every GitHub workflow or local action. SHA-256 digests make dependency lifecycle authority, nested bindings, variables, commands, permissions, and credential-context changes explicit policy-review events instead of relying on an incomplete mutation blacklist. The validator independently discovers tracked and non-ignored untracked repository files before comparing them with that declaration, including nested workflows, action definitions anywhere in the repository, and named JSON, JSONC, or TOML Wrangler configurations, so adding an authority-bearing file cannot silently escape the inventory.

`deployment_authorized` is exactly `false`; changing that field cannot authorize deployment because the validator rejects it. A later owner-authorized design must replace this embargo with an exact protected workflow and resource inventory rather than weakening checks ad hoc. CI installs dependencies with lifecycle scripts disabled, invokes the checker directly outside npm lifecycle hooks, then rebuilds with npm's strict allow-scripts mode so only the digest-approved package allowlist can execute before `verify`. The official local setup and verification commands in `AGENTS.md` use the same bootstrap order.

## Enforced boundary

`npm run predeployment:check` fails closed when:

- the complete environment inventory differs from its approved digest, an environment is marked provisioned, a non-production environment can access production, or write identities are missing/shared;
- a package script or install-script allowlist differs from its approved digest, `.npmrc` or the lockfile changes, a script contains a non-allowlisted Wrangler deploy or resource mutation, or a script names the Cloudflare API directly;
- a Wrangler dry run does not disable Wrangler metrics;
- any parsed Wrangler configuration differs from its approved digest, including nested service targets, variables, rate limiters, assets, cache settings, entrypoints, dates, flags, or observability;
- a local Worker enables `workers.dev`, preview URLs, routes, logs, invocation logs, traces, persistence, export destinations, or unrecognized observability fields;
- a Wrangler configuration adds an unreviewed root field or privileged Cloudflare binding, including D1, R2, Vectorize, AI, Browser, Workflow, Pipeline, queue, KV, Hyperdrive, email, container, log, or Tail capability;
- a GitHub workflow or local action differs from its approved digest or adds a deployment environment, non-platform secret context, inherited secrets, Cloudflare credential/API reference, Cloudflare mutation, credential-persisting checkout, unpinned action, or write permission; or
- a package, Wrangler, or workflow file appears outside the exact checked-in inventory.

The only allowed Wrangler deployment-shaped command is a telemetry-disabled `wrangler deploy --dry-run`, which uploads nothing and is already used for build/type/runtime evidence. The validator does not execute commands from policy data.

## Verification

The hostile unit matrix mutates authorization, provisioning, the complete environment digest, environment identity/order, production access, package scripts, install-script authority, npm configuration, the lockfile, configuration digests, alternate deployment syntax, direct API access, routes, privileged bindings, observability shape, GitHub permissions, action pinning, credentials, inherited secrets, and inventory coverage. It also verifies discovery of root, nested, and elsewhere local actions. The real-state check parses every discovered input and scans every workflow. CI invokes it directly before enabling strictly allowlisted dependency lifecycle scripts and repeats it inside the full `verify` gate.

## Non-claims and next authority

This phase creates no Cloudflare or GitHub resource, route, credential, secret, environment, deployment, preview, production configuration, or legal/GDPR artifact. It constrains this repository's current automation inputs; it cannot prevent a person using external credentials or a coordinated reviewed change to the policy/validator, and it does not itself establish GitHub branch protection. It does not prove remote environment isolation, protected credentials, deployed zero-visitor-data behavior, or controller accountability. `GATE-environment-isolation`, `GATE-zero-visitor-data`, `GATE-gdpr-accountability`, and every release coordinator remain pending.

The next deployment step still requires an accepted resource inventory, least-privilege Cloudflare identities, protected GitHub environments, exact preview/production Wrangler configuration, privacy/config exports, rollback design, spending authority, and the explicit deployment authorization required by the implementation plan.
