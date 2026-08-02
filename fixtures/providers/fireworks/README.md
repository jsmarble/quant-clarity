# Fireworks adapter fixtures

These fixtures are hand-authored synthetic records shaped from the public Fireworks API and pricing documentation. They are not provider responses, authenticated payloads, or production facts, and they must never be published as QuantClarity data.

The first provider slice remains enabled only for `local` and `test`. Production access, retention, and publication are blocked until an authorized owner or legal reviewer accepts a dated source-compliance register.

Fixture controls (`DATA-063`, `PIPE-017`–`PIPE-019`, `LEG-001`–`LEG-002`):

- No credentials, account identifiers, visitor information, or personal data.
- One invented model and exact offering used only to exercise schema and applicability behavior.
- Base-object `defaultPrecision` is deliberately present, while exact-offering precision remains unknown.
- Prices are representative invented decimal values and are not current provider prices.
- Parser and policy versions are pinned in the adapter package.
