# GDPR accountability evidence index

| Attribute | Value |
|---|---|
| Gate | `GATE-gdpr-accountability` |
| Status | Release blocked — authorized owner artifacts pending |
| Last engineering review | 2026-08-01 |
| Review cadence | At least annually and on material processing change |

Engineering can enforce data minimization and prove deployed behavior, but it cannot choose legal bases, determine territorial scope, or certify GDPR compliance. The authorized controller/legal owner must complete and sign the following before public release.

| Evidence | Required decision/artifact | Public-repository record | Status |
|---|---|---|---|
| Controller | Legal entity/individual, jurisdiction, postal identity, formal contact | Approved notice version/hash | Pending |
| Territorial scope | GDPR/UK GDPR and other privacy-law applicability | Dated determination and approver | Pending |
| Lawful basis | Basis per processing purpose; legitimate-interest assessment if used | Dated determination and approver | Pending |
| Processor contract | Current Cloudflare DPA and applicable SCC/transfer terms accepted by authorized owner | DPA version/effective date, private-record locator, hash | Pending |
| Subprocessors/data locations | Current relevant list reviewed | Review date, scope, approver | Pending |
| Processing record | Article 30/organization-appropriate record completed | [`processing-record.md`](processing-record.md) plus private details | Draft |
| Retention | Cloudflare processor, legal-contact, operator/security, and pipeline schedules | Approved schedule version/hash | Pending |
| Rights procedure | Intake, verification, Article 11/no-data response, deadlines, escalation | Procedure version/hash | Pending |
| Security measures | Least privilege, encryption, zero-visitor-data tests, incident and breach procedures | Gate artifacts and approved security record | Pending |
| DPIA | Necessity determination and DPIA if required | Dated determination and approver | Pending |
| DPO | Appointment/consultation determination | Dated determination and approver | Pending |
| EU/UK representative | Appointment determination and details if required | Dated determination and approver | Pending |
| Breach procedure | Assessment, processor notification, authority/data-subject deadlines | Procedure version/hash | Pending |
| Privacy notice | Deployed behavior matches controller-approved notice | Deployed URL, content hash, approval | Pending |
| Zero visitor data | Source/config/browser/storage/network and canary checks pass | `GATE-zero-visitor-data` artifact manifest | Pending deployment |

No row may be marked complete from an agent assertion alone. Confidential or personal artifacts remain in the private legal/operations system; this file records only the minimum non-secret approval metadata.

