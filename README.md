# QuantClarity

> See the precision behind the price.

QuantClarity is a free, public catalog and read-only API for comparing the facts behind hosted model-inference offerings. It is designed to make provider serving precision, token pricing, source-checkpoint lineage, evidence, and freshness visible without provider rankings or recommendations.

The usefulness and correctness of the public data are the project's sole justification. Revenue is secondary, and the service is intended to remain free and public even if it operates at a net financial loss.

## Status

**Implementation — approved vertical slice in progress.**

The product requirements and system design are approved. The repository now contains a pinned TypeScript/npm foundation, generated schema/OpenAPI artifacts, strict domain rules, privacy-enforcing checks, Cloudflare Worker dry-run surfaces, tests, and CI. No Cloudflare resources have been provisioned and no production dataset is published yet.

QuantClarity stores no visitor information and runs no visitor analytics or request telemetry. It sets no cookies or visitor-specific browser state, retains no searches/clicks/IPs/user agents/referrers, and permits only static no-referrer referral links with no per-user tracking. Cloudflare necessarily processes limited network/security data to deliver and protect requests under its processor terms; QuantClarity does not copy that data into application storage.

## Product boundaries

- Search and browse are model-first.
- Model cards show model facts only, apart from a cataloged-provider count.
- Model and explicit-variant pages begin with evidence-backed Model Facts.
- Provider precision and pricing appear in a neutral, user-sortable and filterable offering comparison.
- Offering Facts expose complete applicability, provenance, and freshness for an exact provider offering.
- QuantClarity publishes facts, not winners, scores, recommendations, or preferred providers.
- Pricing remains separated into input, output, and cached input in the stated currency, without foreign-exchange conversion.
- The website and API are public, anonymous, read-only, and free.

## Repository map

```text
.
├── AGENTS.md                         Durable instructions for Codex and other coding agents
├── README.md                         Project orientation
├── apps/                             Public API, private query, and pipeline Workers
├── config/                           Logical environment inventory (unprovisioned)
├── contracts/                        API, schema, adapter, and publication contracts
├── docs/
│   ├── decisions/                    Architecture decision records
│   ├── design/                       System-design baseline and design work
│   ├── compliance/                   Privacy notice and GDPR accountability drafts
│   └── product/
│       ├── decision-log.md           Durable record of accepted product decisions
│       └── requirements.md           Approved product requirements
├── fixtures/                         Redacted provider and pipeline test fixtures
├── packages/                         Shared contracts, domain rules, and test support
└── tools/                            Contract, documentation, privacy, and policy checks
```

## Source of truth

The approved PRD is [`docs/product/requirements.md`](docs/product/requirements.md). Product behavior must trace back to its requirement IDs.

Accepted product decisions and later approved amendments belong in [`docs/product/decision-log.md`](docs/product/decision-log.md). Implementation choices belong in the system design or an architecture decision record, not in the PRD.

## Current delivery focus

Implementation follows [`docs/design/implementation-plan.md`](docs/design/implementation-plan.md): machine contracts and canonical rules first, then one lawful structured-provider slice through atomic publication, API, and web delivery. ADR 0012 resolves the former Pages conflict: the web runtime uses current Astro SSR on Cloudflare Workers with Static Assets while preserving the separate API/query boundaries.

## Open as a Codex project

In the Codex desktop app:

1. Create or edit a local project.
2. Add this repository folder:

   ```text
   /Users/joshua/personal/git/quant-clarity
   ```

3. Make it the project's primary folder.
4. Start a new task for the next implementation-plan outcome.

Codex will discover [`AGENTS.md`](AGENTS.md) from the repository root. The pinned runtime, exact verification commands, privacy invariants, and current implementation gate are documented there.

Suggested first task:

> Continue the approved QuantClarity implementation plan with the next incomplete vertical-slice phase. Preserve zero visitor data, evidence, neutrality, exact-offering applicability, atomic publication, and every release gate. Run the full verification command and request independent review before advancing a phase.

## Repository policy

Source code is MPL-2.0. Dataset/API terms remain a separate pre-release decision; the code license does not cover retained evidence or automatically determine dataset rights.

The public repository will not solicit contributions or operate public GitHub Issues or Discussions. Private operator task tracking may be configured separately.
