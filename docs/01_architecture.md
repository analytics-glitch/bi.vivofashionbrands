# 01 · Architecture

## 1.1 High-level system topology

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Browser       │────▶│  React 18 + Vite │────▶│  FastAPI server  │
│   (any user)    │◀────│  served via CDN  │◀────│  (Uvicorn)       │
└─────────────────┘     └──────────────────┘     └─────────┬────────┘
                                                            │
                       ┌────────────────────────────────────┴───────────────┐
                       │                                                    │
                       ▼                                                    ▼
              ┌──────────────────┐                                  ┌──────────────────┐
              │  MongoDB Atlas   │                                  │  Vivo BI API     │
              │  (kpi_snapshots, │                                  │  (Google Cloud   │
              │   orders_daily,  │                                  │  Run, EU-West-1) │
              │   launch_dates,  │                                  │                  │
              │   users, …)      │                                  │  /kpis /orders   │
              └──────────────────┘                                  │  /sor /top-skus  │
                       ▲                                            │  /inventory …    │
                       │                                            └──────────────────┘
                       │                                                    ▲
                       │            ┌──────────────────┐                    │
                       └────────────┤  Upstash Redis   ├────────────────────┘
                                    │  (response cache)│
                                    └──────────────────┘
```

## 1.2 Two environments

| Environment | URL | MongoDB | Notes |
|---|---|---|---|
| **Preview** (dev) | dynamic — preview pods | `mongodb://localhost:27017` / `test_database` | Where developers + agents iterate |
| **Production** | https://bi.vivofashionbrands.com | Atlas `customer-apps.7kqgxr.mongodb.net` (separate cluster) | Live; updated only via redeploy |

**Critical fact:** preview and production use **separate MongoDB clusters by design**. Background sweeps run on preview do NOT propagate to production. The only way data sweeps land in production is to deploy code that runs them on the production pod, or to run a one-off migration script (see `/app/backend/scripts/sync_launch_dates_preview_to_prod.py`).

## 1.3 Request lifecycle (typical KPI tile)

1. **Browser** loads a page (e.g. `Overview.jsx`) at https://bi.vivofashionbrands.com/
2. React calls `api.get("/kpis", { params: { date_from, date_to, country, channel } })` via `lib/api.js`
3. Cloudflare → Emergent ingress → FastAPI pod on port 8001
4. FastAPI middleware checks JWT (admin) or Emergent OAuth session (user)
5. Endpoint `/api/kpis` is called → snapshot lookup in Mongo (`kpi_snapshots`)
   - **Hit (cache fresh):** return Mongo doc immediately, ~30 ms
   - **Hit (cache stale):** return stale doc + trigger background warmup
   - **Miss:** compute live by fanning out to upstream `/kpis` → cache → return
6. Result is JSON; React renders it into the KPI tile

## 1.4 The four caching layers (from fastest to slowest)

| Layer | Lives in | TTL | Purpose |
|---|---|---|---|
| **L0 — Process cache** | Python dict in the FastAPI pod | 5-10 min | Inflight dedup + ultra-hot endpoints (e.g. `/analytics/active-pos`, `/top-skus` live path) |
| **L1 — Upstash Redis** | External Redis | 5-60 min per path | Idempotent upstream-response cache, survives pod restarts |
| **L2 — Mongo `analytics_snapshots`** | MongoDB Atlas | Hours (warmed by background sweep) | Pre-computed canonical analytics — what 90% of dashboard reads serve from |
| **L3 — Live upstream call** | Vivo BI API | none | Only when L0/L1/L2 all miss; bounded by per-endpoint concurrency caps |

### Stale-fallback policy

When an upstream call fails, the cached version (even if expired) is preferred over a 500/504 error. This is what keeps the dashboard alive during upstream incidents. Implemented in `/api/analytics/active-pos`, `/api/top-skus`, and the snapshot-backed endpoints. See [07 § Stale fallback](./07_operations.md#stale-fallback).

## 1.5 Snapshot warming pattern

Every ~10 min a background task (`_refresh_analytics_snapshots`) re-computes the canonical analytics for the standard windows (Today, Yesterday, 7d, 30d, 90d, MTD, QTD, YTD) × each country × each channel, then writes the result to Mongo. This is why most pages load in ~50ms even when the underlying compute is expensive.

Snapshot endpoints currently warmed:
- `/kpis`, `/sales-summary`, `/daily-trend`, `/country-summary`
- `/top-skus` (default limit only)
- `/sor`, `/subcategory-sales`, `/subcategory-stock-sales`
- `/analytics/weeks-of-cover`, `/analytics/inventory-summary`
- `/analytics/ibt-warehouse-to-store`, `/analytics/ibt-suggestions`
- `/analytics/sor-new-styles-l10`, `/analytics/sor-all-styles`
- `/analytics/new-styles`, `/analytics/category-country-matrix`

## 1.6 Backend code organization

```
/app/backend/
  server.py                  # Core routing + business logic (~16k lines)
  range_mgmt.py              # Tier classification algorithm
  returns_aggregator.py      # Net-sales returns netting module
  marketing_report.py        # Weekly marketing email digest
  bins_lookup.py             # Warehouse barcode→bin mapping (from XLSX)
  services/
    metric_definitions.py    # Canonical "Units Sold" semantic layer
  routes/
    range_mgmt.py            # /api/range-mgmt/* endpoints
  scripts/
    sync_launch_dates_preview_to_prod.py  # One-off Mongo migration
    backfill_orders_aggregates.py
    heal_may_2026_snapshot.py
  data/
    VFG_Warehouse_Bin_Locations.xlsx      # Bin source-of-truth
  tests/
    test_iteration_78_batch.py
```

`server.py` is intentionally monolithic at this stage. Refactoring into `routes/`, `models/`, `services/` modules is on the roadmap but ships piece-by-piece (Marketing and Returns already lifted out).

## 1.7 Frontend code organization

```
/app/frontend/src/
  pages/                     # 24 pages, one per top-level route
  components/                # Reusable UI; ~100 files
    ui/                      # shadcn/ui primitives
    range-mgmt/              # Range Mgmt-specific composites
  lib/
    api.js                   # Axios wrapper; auto-attaches JWT, REACT_APP_BACKEND_URL
    filters.jsx              # Global FilterBar state (country/channel/dates)
    useKpis.js               # Shared hook for the KPI cards
    productCategory.js       # Subcategory→Category taxonomy mirror
    variance.js              # Variance/risk-flag thresholds
  App.jsx                    # Router + auth gates
```

Frontend never calls upstream Vivo BI directly. Every request goes through `REACT_APP_BACKEND_URL/api/*` so the FastAPI layer can apply caching, JWT auth, and business-rule enrichment.

## 1.8 Authentication & authorization

Two parallel auth paths:

1. **Emergent Google OAuth** — for end users (anyone with `@vivofashiongroup.com` or `@shopzetu.com`). Login button on `/login` redirects through Emergent's OAuth proxy. Approved users land in `User` collection.
2. **JWT email/password** — for admins. `POST /api/auth/login` with `email`+`password`. Bcrypt-verified, JWT issued with 7-day expiry.

**Role gating:** `User.role ∈ {"admin", "user", "viewer"}`. Sensitive endpoints (e.g. `/admin/*`, `/analytics/replenishment-report/mark`, `/refresh-bins`) are wrapped with `Depends(require_admin)`. Customer PII (phone, email) on `/top-customers` is masked unless the caller is admin.

## 1.9 Deployment

Built and deployed via **Emergent's "Save to GitHub" + Deploy** workflow. No CI pipeline of our own. Production redeploys are manual events; data sweeps that mutate prod Mongo therefore must either:

- Be part of code that runs at FastAPI startup on the prod pod (`asyncio.create_task` at the bottom of `server.py`), OR
- Be triggered manually via `POST /api/admin/heal-*` after a deploy, OR
- Be run as a one-off script with prod Mongo URI (gated by Atlas allowlist — see ops doc)

Hot reload is enabled in preview; in production a deploy = full pod restart, which means in-process caches (L0) and any in-flight heal tasks are lost.
