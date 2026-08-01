# QuantClarity

> See the precision behind the price.

QuantClarity is a free, public catalog and read-only API for comparing the facts behind hosted model-inference offerings. It is designed to make provider serving precision, token pricing, source-checkpoint lineage, evidence, and freshness visible without provider rankings or recommendations.

The usefulness and correctness of the public data are the project's sole justification. Revenue is secondary, and the service is intended to remain free and public even if it operates at a net financial loss.

## Status

**System design — pre-implementation.**

The product requirements are approved. Runtime architecture, canonical schema, concrete API contract, pipeline design, and implementation layout have not yet been selected. This repository intentionally contains no application scaffold or production dependencies.

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
├── contracts/                        API, schema, adapter, and publication contracts
├── docs/
│   ├── decisions/                    Architecture decision records
│   ├── design/                       System-design baseline and design work
│   └── product/
│       ├── decision-log.md           Durable record of accepted product decisions
│       └── requirements.md           Approved product requirements
└── fixtures/                         Redacted provider and pipeline test fixtures
```

## Source of truth

The approved PRD is [`docs/product/requirements.md`](docs/product/requirements.md). Product behavior must trace back to its requirement IDs.

Accepted product decisions and later approved amendments belong in [`docs/product/decision-log.md`](docs/product/decision-log.md). Implementation choices belong in the system design or an architecture decision record, not in the PRD.

## Next phase

The next project task is to complete [`docs/design/system-design.md`](docs/design/system-design.md). That work must produce:

1. System context, component boundaries, and data flows
2. Cloudflare service decisions and deployment environments
3. Canonical model, offering, observation, evidence, and publication schemas
4. Pipeline orchestration, validation, quarantine, and rollback behavior
5. OpenAPI and provider-adapter contracts
6. Exact, structured, and semantic search design
7. Security, privacy, rate-limit, cache, observability, backup, and cost controls
8. Requirement-to-design and requirement-to-test traceability
9. A one-provider vertical-slice implementation plan

Application implementation should begin only after that design is reviewed and approved.

## Open as a Codex project

In the Codex desktop app:

1. Create or edit a local project.
2. Add this repository folder:

   ```text
   /Users/joshua/personal/git/quant-clarity
   ```

3. Make it the project's primary folder.
4. Start a new task for the system-design outcome.

Codex will discover [`AGENTS.md`](AGENTS.md) from the repository root. No project-specific `.codex/config.toml` or local-environment actions are included yet because the runtime and toolchain have not been selected.

Suggested first task:

> Convert the approved QuantClarity PRD into an implementation-ready system design. Produce the architecture, canonical data model, pipeline state machine, publication model, Cloudflare service decisions, OpenAPI contract, provider-adapter contract, search design, security model, observability plan, and requirement-to-test traceability. Do not implement application code. Record consequential choices as ADRs and preserve every product invariant in AGENTS.md.

## Repository policy

This project is expected to publish its implementation as open source, but the code license and dataset terms have not yet been finalized. Do not assume that source-code licensing also covers the dataset or retained evidence.

The public repository will not solicit contributions or operate public GitHub Issues or Discussions. Private operator task tracking may be configured separately.

