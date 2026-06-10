# 05 · API Reference

The dashboard exposes **102 internal endpoints** under `/api/*`. All are JSON. All caller-facing dates are ISO `YYYY-MM-DD`. All monetary values are KES.

Endpoints are grouped here by domain. Where an endpoint is a thin wrapper over a same-named upstream Vivo BI path, the upstream is noted in **Source**.

## 5.1 Core KPIs & sales

| Method | Path | Purpose | Source |
|---|---|---|---|
| GET | `/api/kpis` | Aggregate KPIs | snapshot `kpi_snapshots` → live `/kpis` |
| GET | `/api/sales-summary` | Per-channel sales totals | `/sales-summary` |
| GET | `/api/daily-trend` | Per-day sales/units/orders | `/daily-trend` |
| GET | `/api/country-summary` | Country roll-up | `/country-summary` |
| GET | `/api/exec-summary` | Executive board-pack summary | composite |
| GET | `/api/top-skus` | Top-N styles by sales | snapshot → live `/top-skus` |
| GET | `/api/sor` | Sell-Out Rate per style | snapshot → live `/sor` |
| GET | `/api/subcategory-sales` | Per-subcategory sales | `/subcategory-sales` |
| GET | `/api/subcategory-stock-sales` | Joined stock + sales by subcategory | `/subcategory-stock-sales` |
| GET | `/api/inventory` | Live SOH per location × SKU | `/inventory` |
| GET | `/api/inventory-style-counts` | Style counts in stock | join of `/inventory` |
| GET | `/api/locations` | Master location list | `/locations` |
| GET | `/api/footfall` | Walk-ins per location-day | `/footfall` |
| GET | `/api/stock-to-sales` | Per-location cover multiplier | `/stock-to-sales` |

**Common params:** `date_from`, `date_to`, `country`, `channel`, `locations` (comma-sep), `style_status` (`active`|`retired`|`all`).

---

## 5.2 Analytics (composite)

| Method | Path | Purpose | Caching |
|---|---|---|---|
| GET | `/api/analytics/active-pos` | Active physical-store locations (last N days) | L0 cache 600s + inflight dedup + stale fallback |
| GET | `/api/analytics/inventory-summary` | Inventory health summary | Snapshot |
| GET | `/api/analytics/weeks-of-cover` | Per-style WoC | Snapshot |
| GET | `/api/analytics/low-stock` | Styles with ≤10 units | Live |
| GET | `/api/analytics/new-styles` | Newly launched styles | Live |
| GET | `/api/analytics/new-styles-curve` | Sales velocity post-launch | Live |
| GET | `/api/analytics/sor-new-styles-l10` | Last 10 launches SOR | Snapshot |
| GET | `/api/analytics/sor-all-styles` | Full SOR roll-up | Snapshot |
| GET | `/api/analytics/stock-to-sales-by-{category, subcat, sku, attribute}` | STS variants | Live |
| GET | `/api/analytics/category-country-matrix` | Category × Country heatmap | Snapshot |
| GET | `/api/analytics/ibt-suggestions` | Store-to-store IBT recs | Snapshot |
| GET | `/api/analytics/ibt-warehouse-to-store` | Warehouse IBT recs | Snapshot |
| GET | `/api/analytics/ibt-sku-breakdown` | Per-style SKU split for an IBT row | Live |
| GET | `/api/analytics/replenishment-report` | Replenishment picker output | Live, cached 5min |
| GET | `/api/analytics/replenishment-completed` | History of marked-done rows | Mongo |
| POST | `/api/analytics/replenishment-report/mark` | Mark a row done | Mongo write |
| GET | `/api/analytics/style-{location, sku}-breakdown` | Per-style drill-down | Live |
| GET | `/api/analytics/style-sku-breakdown-bulk` | Same, batched | Live |
| GET | `/api/analytics/sell-through-by-location` | Per-location sell-through | Live |
| GET | `/api/analytics/products-plan` | Pre-publish merchandise plan | Live |
| GET | `/api/analytics/price-changes` | Detected price drops | Live |
| GET | `/api/analytics/returns` | Returns aggregated by window | `returns_daily_by_product` |
| GET | `/api/analytics/churn` | Per-customer churn flags | Snapshot + `/churned-customers` |
| GET | `/api/analytics/insights` | Auto-generated bullet insights | Composite |
| GET | `/api/analytics/canonical-units-sold` | Sanity-check helper for semantic-layer audits | `compute_merch_units_sold` |
| GET | `/api/analytics/sales-projection` | Pace / projection from MTD | Composite |
| GET | `/api/analytics/customer-crosswalk` | Customer ID → name lookup table | Mongo |
| GET | `/api/analytics/annual-targets` | Annual targets by month / quarter | `replenishment_config` (target store) |
| GET | `/api/analytics/kpi-trend` | KPI trend over N weeks | Snapshot |

---

## 5.3 Customers

| Method | Path | Purpose | Source |
|---|---|---|---|
| GET | `/api/customers` | RFM + customer list | `/customers` |
| GET | `/api/customer-search` | Search by phone/name/email | `/customer-search` |
| GET | `/api/customer-trend` | A customer's purchase history | `/customer-trend` |
| GET | `/api/customer-products` | Products bought by customer | `/customer-products` |
| GET | `/api/customer-frequency` | Visit frequency distribution | `/customer-frequency` |
| GET | `/api/customer-type-spend` | New vs returning spend split | `/customer-type-spend` |
| GET | `/api/customers-by-location` | Per-location customer mix | `/customers-by-location` |
| GET | `/api/customers/churn-rate` | Period-over-period churn % | Composite |
| GET | `/api/customers/walk-ins` | Walk-in count for the date window | `/footfall` + `/kpis` |
| GET | `/api/new-customer-products` | What first-time customers bought | `/new-customer-products` |
| GET | `/api/top-customers` | Highest-LTV (PII gated) | `/top-customers` |
| GET | `/api/churned-customers` | Customers not seen in 90+ days | `/churned-customers` |

---

## 5.4 Footfall

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/footfall/daily-calendar` | Day-by-day walk-in calendar |
| GET | `/api/footfall/weekday-pattern` | Per-weekday avg footfall + conversion |

---

## 5.5 Exports / Reports

| Method | Path | What's in the CSV |
|---|---|---|
| GET | `/api/exports/period-performance` | Window × store performance roll-up |
| GET | `/api/exports/store-kpis` | Per-store KPI snapshot |
| GET | `/api/exports/stock-rebalancing` | Stock-rebalance recommendations |
| GET | `/api/bootstrap/overview` | Single composite payload for first-load Overview page |
| GET | `/api/morning-brief` | Auto-generated morning briefing |
| GET | `/api/data-freshness` | Composite freshness pill data |

---

## 5.6 Store clustering

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/store-clusters` | Current clusters |
| POST | `/api/store-clusters/recluster` | Re-run clustering (admin) |

---

## 5.7 Replenishment config & leaderboard

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/replenishment-config` | Read current threshold config |
| POST | `/api/replenishment-config` | Update (admin) |
| GET | `/api/leaderboard/store-of-the-week` | Auto-picked top store |
| GET | `/api/leaderboard/streaks` | Stores on a winning streak |
| POST | `/api/admin/leaderboard/snapshot` | Force-snapshot today's leaderboard |

---

## 5.8 Admin / ops

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/audit-log` | Mutation log |
| GET | `/api/admin/cache-stats` | L1 (Redis) hit/miss/quota |
| GET | `/api/admin/circuit-breaker` | Open breakers + fail counts |
| POST | `/api/admin/circuit-breaker/reset` | Force-close all breakers |
| GET | `/api/admin/fanout-alerts` | High-fanout request alerts |
| POST | `/api/admin/fanout-self-heal` | Auto-correct fanout-related KPI drift |
| GET | `/api/admin/heal-launch-dates/status` | Heal-sweep status |
| POST | `/api/admin/heal-launch-dates` | Trigger 5-year `/orders` sweep |
| POST | `/api/admin/heal-launch-dates/stop` | Cooperative-abort the sweep (iter 91u) |
| GET | `/api/admin/launch-dates-stats` | Year distribution of launch-date docs |
| GET | `/api/admin/heal-returns-history/status` | Returns-history heal status |
| POST | `/api/admin/heal-returns-history` | Trigger returns-history rebuild |
| GET | `/api/admin/memory-breakdown` | Per-cache memory usage |
| GET | `/api/admin/redis-quota` | Upstash quota check |
| GET | `/api/admin/snapshot-count` | # of analytics_snapshot docs |
| GET | `/api/admin/snapshot-freshness` | Snapshot freshness for header pill |
| POST | `/api/admin/cache-clear` | Wipe L1 (Redis) cache |
| POST | `/api/admin/flush-kpi-cache` | Wipe stale-KPI in-process cache |
| POST | `/api/admin/full-snapshot-rebuild` | Re-warm all analytics snapshots |
| POST | `/api/admin/heal-kpi-snapshot` | Heal one window's KPI snapshot |
| POST | `/api/admin/reset-cache-counters` | Zero out hit/miss counters |
| POST | `/api/admin/run-audit-now` | Re-run the data audit immediately |
| POST | `/api/admin/send-daily-summary-now` | Send daily summary email |
| POST | `/api/admin/trim-memory` | Force garbage collect |
| POST | `/api/admin/warm-snapshots-now` | Re-warm canonical snapshots |
| POST | `/api/refresh-bins` | Reload the bin XLSX |

---

## 5.9 Range Mgmt & Marketing

Mounted under `/api/range-mgmt/*` (in `backend/routes/range_mgmt.py`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/range-mgmt/classify` | Tier 1-4 classification for all styles |
| GET | `/api/range-mgmt/marketing-candidates` | Tracker board state |
| POST | `/api/range-mgmt/marketing-candidates` | Add a candidate |
| PATCH | `/api/range-mgmt/marketing-candidates/{id}` | Update status / notes |
| DELETE | `/api/range-mgmt/marketing-candidates/{id}` | Remove |
| GET | `/api/range-mgmt/marketing-report/preview` | Render the Monday email HTML |
| POST | `/api/range-mgmt/marketing-report/send` | Trigger Resend send (or no-op if RESEND_API_KEY unset) |

---

## 5.10 Auth

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Email/password JWT login |
| POST | `/api/auth/google-callback` | Emergent OAuth landing |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/users` | List (admin) |
| POST | `/api/users/{id}/approve` | Approve pending OAuth user |
| POST | `/api/users/{id}/reject` | Reject |

---

## 5.11 Request shape

All endpoints accept query-string params. Common ones:

| Param | Type | Default | Meaning |
|---|---|---|---|
| `date_from`, `date_to` | `YYYY-MM-DD` | (page-defined) | Window |
| `country` | string | All | Country filter (`Kenya`, `Uganda`, `Rwanda`) |
| `channel` | string | All | Channel group or specific channel name |
| `locations` | comma-sep | All | Specific POS list |
| `brand` | string | All | Brand prefix filter |
| `limit` | int | 20 | Top-N cap |
| `style_status` | enum | `all` | `active` / `retired` / `all` |
| `compare_mode` | enum | none | `last_month` / `last_year` / `yesterday` |

## 5.12 Error semantics

| HTTP | When |
|---|---|
| **200** | Success (including empty arrays) |
| **401** | Unauthenticated or expired JWT |
| **403** | Authenticated but lacks role (e.g. user hitting `/admin/*`) |
| **404** | Resource not found (e.g. customer ID) |
| **422** | Validation error on params |
| **502/503** | Upstream Vivo BI returned non-2xx after retries |
| **504** | Upstream timeout (rare since stale-fallback added) |

Endpoints that have stale-fallback (`/analytics/active-pos`, `/top-skus`) prefer to return the previous good response with HTTP 200 rather than 5xx — making the dashboard resilient to upstream incidents.
