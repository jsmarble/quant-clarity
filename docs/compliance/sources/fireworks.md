# Fireworks source-compliance register

| Attribute | State |
|---|---|
| Provider | Fireworks AI |
| Review status | **Pending — production disabled** |
| Prepared | 2026-08-01 |
| Authorized reviewer | Pending product-owner/legal assignment |
| Next review | Must be set by the authorized reviewer |

## Proposed sources

| Source | Purpose | Access | Retention/publication decision |
|---|---|---|---|
| `api.fireworks.ai/v1/accounts/{account_id}/models` | Structured model catalog and discovery metadata | Read-only bearer credential; account identifier supplied by protected configuration | Pending. No real response may be retained or published before approval. |
| `docs.fireworks.ai/serverless/pricing` | Provider-stated price roles, currency, unit, and tier conditions | Public HTTPS | Pending robots, Content Signals, terms, retention, and factual-excerpt review. |

The authenticated model catalog exposes a base-model `defaultPrecision` field. Under `DATA-051`, `PIPE-039A`, and `QA-012`, that field is model/base-object evidence only and cannot establish the serving precision of a live serverless offering without a separately evidenced exact-applicability link.

## Required approval record (`LEG-001`–`LEG-002`)

Before preview acquisition of real provider bytes or any production enablement, an authorized reviewer must date and sign decisions for:

- access method and credential authority;
- applicable API/site terms, robots policy, and Content Signals version;
- automated retrieval permission and declared crawl purpose;
- minimal excerpt retention for at least 24 months;
- publication of normalized facts and public evidence summaries;
- safe public locator format for authenticated-only evidence;
- review expiry and revocation procedure.

Until every decision is affirmative, the manifest retains `access_permitted=false`, `retention_permitted=false`, `publication_permitted=false`, and excludes `production` from enabled environments.
