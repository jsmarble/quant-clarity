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

A synthetic, non-publishable Fireworks-shaped contract fixture is retained under `providers/fireworks/`. It contains invented identities and prices, no captured provider payload, and no authenticated content. Real provider bytes remain prohibited until the source/legal register is approved.
