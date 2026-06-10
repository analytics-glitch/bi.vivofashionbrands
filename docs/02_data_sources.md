# 02 · Data Sources

## 2.1 Upstream — Vivo BI API

**Base URL:** `https://vivo-bi-api-666430550422.europe-west1.run.app`
**Owner:** Vivo's internal data engineering team (BigQuery → Cloud Run)
**Configured via:** `VIVO_API_BASE` env var in `backend/.env`

All monetary fields returned by upstream are **already converted to KES**. FX is applied in BigQuery (UGX→KES at 28.79, RWF→KES at 11.27 — values hard-coded upstream). The dashboard MUST NOT apply any further conversion.

### 2.1.1 The 23 upstream endpoints

| # | Path | What it returns | Cardinality / cost |
|---|---|---|---|
| 1 | `/kpis` | Aggregate KPIs (sales, units, ABV, ASP, MSI, conversion, return rate) per window × country × channel | Cheap (~50ms upstream) |
| 2 | `/sales-summary` | Per-channel sales totals over a window | Cheap |
| 3 | `/daily-trend` | Per-day sales/units/orders rollup | Cheap |
| 4 | `/orders` | Row-level order data, **1,000-row default cap** (pass `limit=10000` to override). 30-day windows are the practical chunk for ≤5,000 row queries | Heavy |
| 5 | `/top-skus` | Top-N styles by sales over a window | Medium |
| 6 | `/sor` | Sell-Out Rate report (style × stock × sales × cover) | Heavy |
| 7 | `/inventory` | Live on-hand snapshot — every (location × SKU × style × brand × subcategory) | Heavy (~10k+ rows) |
| 8 | `/locations` | Master list of stores + channels + countries | Tiny, ~50 rows |
| 9 | `/footfall` | Daily walk-ins per location | Medium |
| 10 | `/stock-to-sales` | Per-location stock-cover multiplier | Medium |
| 11 | `/subcategory-sales` | Sales rolled up by subcategory | Cheap |
| 12 | `/subcategory-stock-sales` | Joined stock + sales per subcategory | Cheap |
| 13 | `/country-summary` | Per-country roll-up of KPIs | Cheap |
| 14 | `/customers` | Customer lifetime value, RFM, country totals | Medium |
| 15 | `/customer-search` | Search by phone/name/email | Cheap (paged) |
| 16 | `/customer-trend` | A customer's purchase history over time | Cheap (per customer) |
| 17 | `/customer-products` | Products a specific customer bought | Cheap (per customer) |
| 18 | `/customer-frequency` | Visit frequency distribution | Medium |
| 19 | `/customer-type-spend` | New vs returning customer spend split | Cheap |
| 20 | `/customers-by-location` | Where each customer's transactions happened | Cheap (per customer) |
| 21 | `/new-customer-products` | What first-time customers bought | Medium |
| 22 | `/top-customers` | Highest-LTV customers (with PII gating per role) | Medium |
| 23 | `/churned-customers` | Customers who stopped buying in a window | Medium |

### 2.1.2 Upstream gotchas

- **/orders default 1000-row cap** — silently truncates without warning. Always pass `limit=10000` for historical sweeps; otherwise launch-date and net-sales aggregates miss data.
- **Per-day chunks for /orders** — large windows must be chunked (typically 7-day for years-back sweeps, 1-day for daily aggregates) to avoid the 50k-row hard limit.
- **/sor windows** — upstream caps the look-back at 26 weeks. For older history use `/orders` with `style_status` filter.
- **Channel naming** — upstream uses both "Retail" / "Online" group labels and per-store channel strings ("Junction Mall", "Online - Shop Zetu"). The backend normalises via `_normalize_channel_group()`.
- **Excluded locations** — warehouses, holding, online wholesale, third-party are filtered via `is_excluded_location()` for any "active POS" or velocity calculation.

### 2.1.3 Per-path circuit breaker

`server.py` tracks failures per first-path-segment (e.g., all `/orders/*` share one breaker). Defaults:
- `_CB_FAIL_THRESHOLD = 2` consecutive failures → breaker opens
- `_CB_RECOVERY_S = 30 s` cooldown
- One success while open → breaker closes; failure during cooldown → re-opens

Exposed at:
- `GET /api/admin/circuit-breaker` — read state
- `POST /api/admin/circuit-breaker/reset` — force-close all

---

## 2.2 MongoDB collections

Database name: `test_database` (preview) / per-deployment (production).

### 2.2.1 Snapshot / cache collections

| Collection | Schema sketch | Purpose |
|---|---|---|
| `kpi_snapshots` | `_id: "kpis|<df>|<dt>|<country>|<channel>"`, `data: {…kpis…}`, `snapshot_at` | Pre-computed `/kpis` results |
| `analytics_snapshots` | Same shape, key prefixed with analytics path | Generic snapshot for any GET endpoint |
| `orders_daily_snapshots` | Per-day order-line aggregate by (date, country, channel) | Source of truth for backfilled trend charts |
| `stale_cache_disk` | List of (endpoint, params) → response | Survives pod restarts, rehydrated on boot |

### 2.2.2 Business-state collections

| Collection | What it stores |
|---|---|
| `style_launch_dates_by_number` | `style_number → {first_sale_iso, last_sale_iso, last_observed_at}` (canonical) |
| `style_launch_dates` | `style_name → {first_sale_iso, …}` (legacy fallback for renamed SKUs) |
| `first_sale_price_ke` | `style_number → {first_sale_iso, unit_price_kes}` — Kenya's first-sale price = Full Price |
| `first_sale_price_ke_by_name` | Same, keyed by style_name |
| `returns_daily_by_product` | `(date, style) → {units_returned, sales_returned_kes}` |
| `returns_history` | Aggregated returns for net-sales calcs |
| `replenishment_state` | Action states per (style, store) — manually closed by ops |
| `replenishment_first_seen` | When a (style, store) first appeared on the picker sheet |
| `ibt_completed` | History of IBT moves marked done |
| `marketing_candidates` | Marketing Action Tracker rows |
| `audit_logs` | Mutations + auth events |

### 2.2.3 User & access collections

| Collection | What it stores |
|---|---|
| `users` | `{email, name, role, hashed_password?, google_id?}` |
| `pending_approvals` | OAuth users awaiting admin approval |
| `feedback` | User-submitted feedback from the in-app widget |

### 2.2.4 Index strategy

Indexes are audited at startup (`[indexes] Mongo index audit complete` log line). Hot indexes:
- `kpi_snapshots._id` (default PK, fastest path)
- `style_launch_dates_by_number.style_number` (unique)
- `replenishment_first_seen.(style_name, location)` (compound)
- `audit_logs.timestamp` (descending — for log views)

---

## 2.3 Upstash Redis

**Configured via:** `REDIS_URL` / Upstash REST URL in `backend/.env`
**Used for:** L1 response cache (per-path TTL).

Cache key shape: `vivo_bi_cache:<sha1(method+path+params)>:<version>`
TTLs vary by endpoint, typically 5-30 minutes. The dashboard's "CACHE x%" header pill reports the **L1 hit rate** over the last 5 minutes (`/api/admin/cache-stats`).

Quota awareness: `/api/admin/redis-quota` returns Upstash usage; the dashboard auto-disables L1 when quota > 90 % to avoid runaway billing.

---

## 2.4 Local files / static data

| File | Purpose |
|---|---|
| `/app/backend/data/VFG_Warehouse_Bin_Locations.xlsx` | Source XLSX for barcode→bin mapping. Refresh via `POST /api/admin/refresh-bins`. |
| `/app/backend/products_category_map.py` (mirror: `frontend/src/lib/productCategory.js`) | The canonical `SUBCATEGORY_TO_CATEGORY` dict that drives merch vs non-merch classification. |
| `frontend/public/locations/*.png` | Per-store hero images for the Locations page. |

---

## 2.5 External integrations

| Service | Used for | Config | Status |
|---|---|---|---|
| **Emergent Google OAuth** | End-user login | Emergent platform secret | ✅ Live |
| **Resend** | Weekly Marketing email digest | `RESEND_API_KEY` (currently unset → mocked) | ⚠️ MOCKED in production |
| **Vivo BI API** (Cloud Run) | All retail data | `VIVO_API_BASE` env var | ✅ Live (subject to upstream uptime) |
| **MongoDB Atlas** (prod only) | Persistence | `MONGO_URL` env var | ✅ Live |
| **Upstash Redis** | L1 cache | Redis URL env var | ✅ Live |
| **Google Sheets** | (Legacy) Bin lookup | Deprecated — replaced by local XLSX | Retired |
| **Google Calendar / Sheets (Training)** | Training Page Dashboard | Awaiting Sheets auth | 🚧 Blocked |
