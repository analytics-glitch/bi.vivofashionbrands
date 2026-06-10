# Vivo Fashion Group · BI Dashboard — Engineering & Business Documentation

> **Live production:** https://bi.vivofashionbrands.com
> **Tech stack:** React 18 (Vite) · FastAPI · MongoDB Atlas · Upstash Redis · Hosted on Emergent
> **Upstream data source:** Vivo BI API on Google Cloud Run (`vivo-bi-api-666430550422.europe-west1.run.app`)

This documentation is the single source of truth for how the dashboard works — every metric, every endpoint, every business rule, every snapshot policy.

## Document index

| # | Document | What's inside |
|---|---|---|
| 01 | [`01_architecture.md`](./01_architecture.md) | System architecture, request flow, caching layers, deployment model, environment separation |
| 02 | [`02_data_sources.md`](./02_data_sources.md) | The 23 upstream Vivo BI endpoints, MongoDB collections, Redis usage, external integrations |
| 03 | [`03_metrics.md`](./03_metrics.md) | Every business metric — formulas, source endpoints, edge cases, semantic-layer rules |
| 04 | [`04_pages.md`](./04_pages.md) | All 24 dashboard pages — what they show, who they're for, which endpoints power them |
| 05 | [`05_api_reference.md`](./05_api_reference.md) | All 102 internal API endpoints — params, responses, caching behavior |
| 06 | [`06_business_rules.md`](./06_business_rules.md) | Returns netting · Corrupt-entry registry · Range Mgmt tier classification · IBT rules · Replenishment logic |
| 07 | [`07_operations.md`](./07_operations.md) | Ops runbook — circuit breakers, heal sweeps, snapshot warmup, emergency commands |
| 08 | [`08_glossary.md`](./08_glossary.md) | Domain terms — SOR, WoC, MSI, IBT, ABV, ASP, attach rate, etc. |

## Quick links

| I want to … | Read |
|---|---|
| Understand how data flows from upstream to a page | [01 → Architecture](./01_architecture.md) |
| Know exactly how a number on the dashboard is calculated | [03 → Metrics](./03_metrics.md) |
| Find which upstream endpoint a page depends on | [04 → Pages](./04_pages.md) |
| Debug a 504 / breaker-open issue | [07 → Operations](./07_operations.md) |
| Understand why a returns adjustment was applied | [06 → Business rules § Net Sales](./06_business_rules.md) |

## Versioning

This doc set tracks the codebase at the time of writing (June 2026, iter 91v). If a behaviour described here ever diverges from production, **the code is authoritative** — update the doc to match, never the other way around. Each section flags the iter where it was introduced so you can trace it back via `git log`.

## Status legend

Throughout these docs you'll see:
- ✅ **Stable** — battle-tested in production for 30+ days
- 🧪 **Beta** — shipped but still being refined
- 🚧 **In progress** — being built; partial behaviour
- ⚠️ **Mocked** — placeholder or non-functional in production (e.g., Resend email integration when `RESEND_API_KEY` is unset)
- 📦 **Snapshot-served** — read from Mongo `analytics_snapshots`, live fallback secondary
- 🔄 **Auto-healed** — background sweep keeps the data fresh; no manual intervention needed
