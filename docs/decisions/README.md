# Architecture decision records

Use this directory for consequential technical decisions that are difficult to reverse, affect multiple components, or constrain future implementation.

## Naming

```text
NNNN-short-kebab-case-title.md
```

Start at `0001`. Never reuse an ADR number.

## Required structure

```markdown
# ADR NNNN: Title

- Status: Proposed | Accepted | Superseded | Rejected
- Date: YYYY-MM-DD
- Decision owners: names or roles
- Related requirements: PRD IDs
- Supersedes: ADR number, if applicable

## Context

## Decision

## Consequences

## Alternatives considered

## Validation
```

Accepted ADRs describe implementation choices; they do not amend product requirements. If a technical constraint requires a product change, obtain explicit approval and amend the PRD and product decision log separately.

