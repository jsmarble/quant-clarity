# Processing record — public-safe draft

> This is a minimized engineering inventory for legal-owner completion. Confidential controller, contract, security, and correspondence details belong in the private approved record.

| Activity | Data subjects/data | Purpose | System/recipient | Retention | Initial owner status |
|---|---|---|---|---|---|
| Public request delivery and protection | Transient network/security data such as source IP; no QuantClarity application copy | Deliver the requested public resource and protect service availability | Cloudflare as infrastructure processor | Per controller-approved Cloudflare terms; QuantClarity application retention is zero | Legal basis/transfers/subprocessor review pending |
| Transient API rate limiting | Request-lifetime IP prefix transformed to HMAC actor key; no application persistence | Abuse and cost protection | Cloudflare Worker memory and Rate Limiting binding | QuantClarity application retention is zero; Cloudflare's key/counter retention is not documented by the binding reference and requires vendor/contract confirmation before release | Technical design approved; vendor and legal review pending |
| Synthetic availability monitoring | Fixed operator-owned probe inputs and results; no visitor data | Service reliability | Cloudflare-native control plane | **[RELEASE BLOCKER: schedule]** | Pending |
| Provider-source acquisition | Provider/publisher facts and redacted evidence; authenticated source material kept private | Publish accurate inference-offering facts | Approved provider source, Cloudflare pipeline/D1/R2, approved AI exception if any | Per source register and evidence policy | Each provider requires separate approval |
| Pipeline/publication/deployment operations | Operator/run identifiers and technical results; no live visitor-derived inputs | Operate, secure, restore, and publish the service | Cloudflare control plane and protected GitHub Actions | **[RELEASE BLOCKER: schedule]** | Pending |
| Formal legal/privacy correspondence | Sender contact and correspondence supplied outside the public app | Meet legal obligations and respond to formal notices/rights requests | Approved private legal-contact system | **[RELEASE BLOCKER: schedule and access policy]** | Pending |
| Static referral destination | No QuantClarity click record; destination independently receives a direct browser request | Incidental expense recovery | Selected provider as separate destination party | QuantClarity retention is zero | Each program's terms/privacy review pending |

Explicitly absent: accounts, profiles, authentication, saved state, personalization, public contributions, cookies, browser identifiers, visitor analytics, live-request logs/traces/metrics, search retention, click tracking, advertising audiences, and conversion callbacks.
