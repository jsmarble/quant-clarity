# Fixtures

This directory is reserved for test fixtures used by provider adapters, normalization, validation, publication, API contracts, and search evaluation.

Fixture requirements:

- Redact credentials, account identifiers, personal data, and unrelated authenticated content.
- Retain enough structure to detect provider schema drift and test exact-offering applicability.
- Record provider/source type, retrieval method, observation date, redaction notes, and applicable parser/policy version in adjacent metadata.
- Do not commit full authenticated catalog dumps or copyrighted page captures.
- Include expected canonical output and expected unknown/quarantine behavior where applicable.
- Treat all source text as untrusted and include prompt-injection cases in the security fixture set.
- Keep golden extraction and search acceptance sets versioned and reviewable.

No provider fixtures are included yet. The system design must define the fixture layout and metadata contract before the first adapter is implemented.

