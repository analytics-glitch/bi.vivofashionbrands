# Vivo Fashion Group — BI Dashboard PRD

## Original Problem Statement
Comprehensive BI dashboard for Vivo Fashion Group (East Africa). Proxies a third-party Vivo BI API and surfaces it through multiple authenticated, filterable tabs.

## Hard Product Rules
- **Theme**: Light orange background, dark/bright green accents.
- **Currency**: ALL currency shown in `KES` with thousands separators. Never use `$`.
- **Single source of truth**: Upstream API. KPIs across pages must agree (shared `/api/kpis` fetch).
- **Auth**: Emergent Google OAuth + JWT. PII masked by role.
- **Dopamine Design**: Streaks, badges, celebration micro-interactions, conversational briefings, actionable subtitles on every KPI (metric-action contract).
- **`total_sales`** is the canonical top-level revenue field (gross minus discounts). Do **not** swap to `net_sales` on global KPIs unless explicitly requested.

## Stack
- Frontend: React + Tailwind + Recharts
- Backend: FastAPI + httpx (single shared `AsyncClient` with `Limits(max_connections=200, max_keepalive_connections=50)` and `Timeout(read=45, connect=10, pool=15)`)
- DB: MongoDB (auth, notifications, recommendations state, leaderboard snapshots, activity logs)
- LLM: `emergentintegrations` + Claude (Emergent LLM Key) for `/api/ask` natural-language search

## Key Backend Modules
- `server.py` — FastAPI proxy + analytics (>2600 lines, refactor candidate)
- `auth.py`, `pii.py`, `chat.py`, `leaderboard.py`, `recommendations.py`, `user_activity.py`
- `thumbnails.py`, `notifications.py`, `search.py`, `ask.py`

## Key API Endpoints
`/api/kpis`, `/api/sales-summary`, `/api/inventory`, `/api/customers`, `/api/footfall`, `/api/data-freshness`, `/api/top-skus`, `/api/sor`, `/api/analytics/sor-new-styles-l10`, `/api/analytics/sales-projection`, `/api/analytics/ibt-suggestions`, `/api/analytics/sell-through-by-location`, `/api/analytics/weeks-of-cover`, `/api/analytics/inventory-summary`, `/api/analytics/churn`, `/api/analytics/new-styles`, `/api/notifications`, `/api/notifications/unread-count`, `/api/search`, `/api/ask`, `/api/recommendations/*`, `/api/thumbnails/*`

## Implemented (highlights)
- Authenticated dashboard, role-based PII masking, audit logs
- Overview, Locations, Footfall, Customers, Products, Inventory, Re-Order, IBT, Pricing, CEO Report, Data Quality, Exports
- Stock aging (weeks-on-hand) + phantom stock anomaly detection
- Mobile card-views for all wide tables (`SortableTable.jsx`)
- Notifications bell (stockouts, records, anomalies)
- ⌘K global search + "Ask anything" LLM-powered NLP query
- Sell-through rate per location, time-of-day footfall heatmap
- Pricing changes tracking page
- Product thumbnails (Products, Re-Order, IBT)
- SOR New Styles L-10 report (3–4 month-old styles)
- Streaks, leaderboard, daily briefing, dopamine micro-interactions
- Statistical outlier flagging (`useOutliers.js`)

## Recently Shipped (2026-04-26 / 27)
- **httpx pool fix**: Bumped shared client to `max_connections=200, max_keepalive_connections=50`, decoupled `pool=15s` from `read=45s` so transient pool saturation falls back to the `_kpi_stale_cache` instead of surfacing "PoolTimeout: timed out after 2 attempts" on the Overview banner.
- **Deployment readiness audit**: Passed via Deployer Agent (no blockers, no warnings).
- **Customers page latency fix**: Split slow upstream `/churned-customers?limit=100000` (≈30 s, frequent 503s) out of `/api/customers` into a dedicated non-blocking `/api/customers/churn-rate` endpoint with a 60 s negative cache. `/api/customers` cold: 38 s → 5.5 s. Churn tile shows "computing…" until ready.
- **Universal upstream response cache** in `fetch()` (TTL 120 s, bounded 2000 entries, cleared via `/api/admin/cache-clear`). Every page after first warm-up loads in <1 s end-to-end:
  - Overview: 1.17 s → **0.19 s**
  - Products: 4.51 s → **0.17 s**
  - Inventory: 15.54 s → **1.01 s**
  - Footfall: 2.01 s → **0.13 s**
  - Customers: 1.47 s → **0.14 s**

## Roadmap
### P1 — Refactor
- Break up `/app/backend/server.py` (>2600 lines) into routers: `routers/sales.py`, `routers/inventory.py`, `routers/analytics.py`, `routers/customers.py`.

### P2
- Margin reporting (gross margin at category & product level)
- Proper FX handling via `dim_fx_rate` for UGX / RWF → KES

### P3
- Wire L-10 SOR action choices `{Reorder · Markdown · IBT · Hold}` into `recommendations_state`
- In-memory caches (`_kpi_stale_cache`, `_churn_full_cache`) → migrate to Mongo / Redis if multi-replica deploy is planned (currently single-replica safe)

## Test Credentials
See `/app/memory/test_credentials.md`.
