# Cloudflare capacity and cost model

| Attribute | Value |
|---|---|
| Status | Accepted planning model; USD 25 control target approved 2026-08-01 |
| Rate snapshot | Official Cloudflare pricing checked 2026-08-01 |
| Currency | USD; taxes and domain registration excluded |
| Parent design | [`system-design.md`](system-design.md) |
| Related requirements | `SM-09`, `API-021`, `API-025`–`API-027`, `CF-020`–`CF-025`, `NFR-008`, `PIPE-037`, `QA-008` |

## Current rates used

Rates must be rechecked before every production release and after announced Workflows billing begins on 2026-08-10.

| Service | Included / base | Overage used in model | Official source |
|---|---|---|---|
| Workers | USD 5 account minimum; 10M requests and 30M CPU-ms/month | USD 0.30/M requests; USD 0.02/M CPU-ms | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| D1 | 25B rows read, 50M rows written, 5 GB/month | USD 0.001/M reads; USD 1/M writes; USD 0.75/GB-month | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| R2 Standard | 10 GB-month, 1M Class A, 10M Class B | USD 0.015/GB-month; USD 4.50/M A; USD 0.36/M B | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Vectorize | 50M queried dimensions/month; 10M stored dimensions | USD 0.01/M queried dimensions; USD 0.05/100M stored dimensions | [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) |
| Workers AI query embeddings | 10k neurons/day free allocation | Qwen3 embedding: USD 0.012/M input tokens | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Workflows | 500k steps and 1 GB-month state on paid after billing starts | USD 0.80/100k steps; USD 0.20/GB-month; Worker CPU/request rates also apply | [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) |
| Browser Run | 10 browser hours/month paid inclusion | USD 0.09/additional browser hour | [Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/) |

Cloudflare's current queried-dimension formula is `(queries against an index + vectors stored in that queried index) × dimensions`; stored dimensions are all vectors across retained indexes times dimensions. Active vectors therefore enter queried usage, while previous/building generations enter stored usage only unless acceptance/rollback probes query them. All overages use `max(0, usage - included)`.

## Workload assumptions

| Input | Launch/base | Tenfold | Scale profile |
|---|---:|---:|---:|
| Providers | 4 | 40 | 100 |
| Active offerings | 80 | 800 | 100,000 |
| Monthly visitors | 10,000 | 100,000 | 1,000,000 |
| External API requests | 10,000 | 100,000 | 1,000,000 |
| Dynamic Worker requests | 50,000 | 500,000 | 5,000,000 |
| Average combined CPU | 10 ms/request | 10 ms/request | 12 ms/request |
| D1 rows read | 100/request | 100/request | 200/request |
| Publication writes/month | 250,000 | 2,500,000 | 40,000,000 |
| Active search vectors | 500 | 5,000 | 200,000 |
| Stored vector generations | 3 (active, previous, building) | 3 | 3 |
| Modeled semantic query requests/month (forecast and controlled tests only) | 10,000 | 100,000 | 1,000,000 |
| Nominal Vectorize calls/request | 1.2 | 1.2 | 1.2 |
| Worst filtered calls/request | 8 | 8 | 8 |
| Embedding dimensions | 768 provisional | 768 | 768 |
| Query embedding tokens | 50/query | 50/query | 60/query |
| Workflow steps/month | 4,000 | 40,000 | 400,000 |
| Browser hours/month | 0 structured-first | 5 | 10 |
| Redacted evidence growth/month | 0.35 GB | 3.5 GB | 4 GB (catalog batching required) |
| Evidence steady-state at 24 months | 8.4 GB | 84 GB | 96 GB |

Dynamic requests and semantic queries are planning forecasts, never production visitor counters imported into QuantClarity. They assume roughly four SSR/API calls per visitor plus external API traffic. Service-binding calls add combined CPU but no second paid inbound request under Workers Standard pricing. Publication-write assumptions include base rows and index amplification; D1 `meta.rows_written` is measured only on non-visitor pipeline/control-plane work.

Normalized price/precision history is retained for the life of the service and archived by provider/year as integrity-hashed logical rows in R2 after its indexed operational window. Using four normalized records per offering per refresh, 104 refreshes/year, and 500 compressed bytes/record gives:

| Horizon | Base | Tenfold | 100,000 offerings |
|---|---:|---:|---:|
| 1 year | 0.017 GB | 0.166 GB | 20.8 GB |
| 5 years | 0.083 GB | 0.832 GB | 104 GB |
| 10 years | 0.166 GB | 1.664 GB | 208 GB |

Growth is linear and never pruned by age. Annual capacity review verifies actual compressed bytes/record and approves partition/database changes before 50% D1 warning thresholds. The five-year history case is included below; ten-year scale would bring evidence-plus-history R2 to about 304 GB and roughly USD 4.41/month before operations.

The 100,000-offering profile is a contract/scale proof, not the initial USD 25 operating envelope. At that scale, source acquisition must use batched catalogs and content-deduplicated evidence; one large retained object per offering per refresh would fail the cost/storage design.

## Monthly projections

### Base

| Service | Calculation | Estimated charge |
|---|---|---:|
| Workers | 50k requests; 0.5M CPU-ms, both included | 5.00 minimum |
| D1 | 5M reads; 0.25M writes; <1 GB, included | 0.00 |
| R2 | 8.4 GB steady state; operations far below included | 0.00 |
| Vectorize | stored `3×500×768=1.152M`; nominal queried active `(12k calls+500 vectors)×768=9.6M`, included | 0.00 |
| Workers AI embeddings | `10k×50=0.5M` tokens × USD 0.012/M before daily free allocation | ≤0.01 |
| Workflows | 4k steps, <0.1 GB state, included | 0.00 |
| Browser Run | 0 hours | 0.00 |
| **Projected base** | rounded with no extraction model | **USD 5.01/month** |

### Tenfold

| Service | Calculation | Estimated charge |
|---|---|---:|
| Workers | 0.5M requests; 5M CPU-ms, included | 5.00 minimum |
| D1 | 50M reads; 2.5M writes; serving plus canonical storage assumed 3 GB, included | 0.00 |
| R2 | five-year evidence/history `(84+0.832-10)×0.015`; operations included | 1.12 |
| Vectorize | stored `3×5k×768=11.52M` (negligible storage overage); nominal queried active `(120k calls+5k vectors)×768=96M`; queried overage dominates | 0.46 |
| Workers AI embeddings | 5M tokens × USD 0.012/M | 0.06 |
| Workflows | 40k steps, <1 GB, included | 0.00 |
| Browser Run | 5 hours, included | 0.00 |
| **Projected tenfold** | excludes unapproved generative extraction | **USD 6.64/month** |

### 100,000-offering scale profile

| Service | Calculation | Estimated charge |
|---|---|---:|
| Workers | 5M requests, 60M CPU-ms; CPU overage `30M×0.02/M` | 5.60 |
| D1 | 1B reads included; 40M writes included; 8 GB across serving/canonical databases gives about 3 GB over included | 2.25 |
| R2 | five-year evidence/history `(96+104-10)×0.015` | 2.85 |
| Vectorize queried | nominal `(1.2M calls+200k vectors)×768=1.0752B`; overage `1.0252B×0.01/M` | 10.25 |
| Vectorize stored | `3×200k×768=460.8M`; overage `450.8M×0.05/100M` | 0.23 |
| Workers AI embeddings | 60M tokens × USD 0.012/M | 0.72 |
| Workflows | 400k steps, included | 0.00 |
| Browser Run | 10 hours, included | 0.00 |
| **Projected scale profile** | nominal 1.2 calls/request, before generative extraction and extra databases | **USD 21.90/month** |

Worst-case eight-batch filtered fan-out at scale is `(8M calls+200k vectors)×768=6.2976B` queried dimensions, or USD 62.48 after the included 50M. Replacing the nominal USD 10.25 queried charge with USD 62.48 yields an approximately USD 74.13 worst-case scale month. This is outside the initial budget. Static per-request ceilings and transient rate limits constrain amplification; Cloudflare account-level billing controls trigger operator semantic disablement without a QuantClarity monthly visitor counter.

The scale estimate is sensitive to forecast semantic volume, controlled-test batch factor, evidence growth, D1 storage split, and publication write amplification. It must be replaced with controlled test results and account-level cost review before claiming 100,000-offering readiness, never live visitor telemetry imported into the application.

## Stress and retry-storm ceiling

The initial production breaker is designed to keep a pathological month near the proposed USD 25 envelope:

| Driver | Hard local ceiling before new expensive work stops |
|---|---:|
| Provider fetch attempts | 3/source occurrence and 10/provider run |
| Retrieved bytes | 250 MB/provider run; 750 MB/global run |
| Browser Run | 30 minutes/provider run; 10 hours/month |
| Generative extraction | Disabled initially; when approved, USD 1/provider run and USD 5/month |
| Workflow steps | 10,000/global run and 100,000/month initial launch |
| Vector mutations | 5,000/global run launch; full rebuild requires dedicated budget reservation |
| D1 written rows | 5M/global run and 30M/month launch, based on returned D1 metadata |
| R2 evidence growth | 1 GB/global run and 5 GB/month launch |
| Public semantic work | 8/actor/minute in Cloudflare's transient limiter; at most 8 Vectorize calls/request, 40 IDs/call, 10 results/call, and 80 aggregate candidates; no application monthly counter |

Worst-case budget reservation is USD 5 Workers base + USD 5 approved generative allowance + USD 1 Browser overage + USD 2 Vectorize/rebuild + USD 2 R2/storage + USD 2 Workflows/control-plane observability + USD 8 contingency = USD 25. Pipeline limits are application admission controls; public protections are static per-request ceilings, transient rate limiting, and Cloudflare account-level billing controls reviewed in place. No delayed vendor alert is treated as an instantaneous hard cap. When a pipeline ceiling or operator cost control trips, new browser, AI, rebuild, provider fan-out, or semantic query work stops as applicable; the last-known-good exact/detail read path stays live. Re-enable is an audited operator action after cost reconciliation.

## Acceptance

The product owner accepted the USD 25 initial control target on 2026-08-01. Before production, controlled tests capture Workers CPU/requests, D1 row/storage metadata, R2 bytes/operations, Vectorize dimensions/mutations, AI tokens/neuron cost, Workflow steps/state, and Browser milliseconds for base and tenfold profiles. Account-level aggregate billing is reviewed in place and is not imported as visitor telemetry. A retry-storm and full-rebuild test must trip pipeline breakers without disabling last-known-good reads. Rates and formulas are revalidated after 2026-08-10 and at each major release.
