# ADR 0008: Default to Workers AI and gate external inference through AI Gateway

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, data lead, security and privacy lead
- Related requirements: G-09, PIPE-030–PIPE-039C, CF-004, CF-009, CF-024, QA-007, QA-010–QA-012, SEC-006, PRIV-005
- Supersedes: None

## Context

AI may help locate and normalize facts in unstructured provider or publisher content, but a generative extraction cannot be canonical on schema conformance alone. Source text is untrusted, may contain prompt injection, and may include authenticated or irrelevant content. Cloudflare-native processing is required unless Workers AI demonstrably cannot satisfy an approved extraction requirement.

## Decision

Prefer deterministic parsers for authoritative structured sources. Use Workers AI as the default for approved unstructured extraction and search embeddings. Every extraction invocation must:

- send only the minimum redacted source span;
- frame source material as untrusted quoted data;
- request schema-constrained output;
- retain source locator/span, model identifier, model version, prompt/policy version, token/cost data, and observation ID;
- pass deterministic schema, applicability, provenance, anomaly, and entailment validation;
- obtain an independent verification path where PIPE-039 requires one;
- publish unknown or quarantine on silence, conflict, or unsupported inference.

An external inference provider is permitted only after a versioned Workers AI evaluation fails a documented accuracy, context, structured-output, or capability threshold on the approved golden set. Record the evaluation and selected exception in an ADR amendment. Route every external call through a dedicated Cloudflare AI Gateway. Require a processor contract prohibiting training on submitted data and defining retention, deletion, subprocessors, and incident handling.

AI Gateway request/response logging is enabled by default and can retain prompts. For this workload, payload logging is prohibited: disable it at gateway level and send `cf-aig-collect-log-payload: false` on every request. Production AI dispatch fails closed unless a deployed seeded-payload canary verifies that Gateway logs contain metadata only. Do not enable cache for authenticated or changing evidence unless a privacy review approves a content-hash-only cache design. Store provider keys through Cloudflare secret facilities/BYOK and never in prompts or application logs.

Official references:

- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)
- [AI Gateway features and controls](https://developers.cloudflare.com/ai-gateway/features/)

## Consequences

- Most inference remains Cloudflare-native and observable by run/provider.
- Model or prompt changes cannot silently enter production without golden replay.
- External inference is an explicit, evidence-backed exception rather than an implementation shortcut.
- Independent verification increases cost and latency for unstructured facts.
- AI Gateway defaults require deliberate privacy configuration before production use.
- No AI output bypasses deterministic validation or exact-offering applicability checks.

## Alternatives considered

- Never use AI: rejected because some approved provider sources may require unstructured extraction, though deterministic parsing remains preferred.
- Use an external model directly: rejected by CF-009 and because it bypasses centralized privacy, cost, and audit controls.
- Accept one schema-valid generative result: rejected by PIPE-038 and PIPE-039.
- Use a second sample of the same model and prompt as verification: rejected because it is not an independent path.
- Send full pages or authenticated catalog responses: rejected by data-minimization, source-license, and credential rules.

## Validation

- Each extraction-policy version reaches 100% precision and at least 98% recall on the approved golden dataset.
- Prompt-injection fixtures prove source content cannot alter instructions, schema, tool access, or publication policy.
- Credential/PII scanners run before prompt construction and evidence retention.
- Audit AI Gateway settings and processor terms and run the no-payload deployed canary before enabling an external model.
- Enforce per-invocation, per-provider-run, and monthly token/cost ceilings with fail-closed behavior.
- Replay model, prompt, parser, and policy changes before production deployment.
