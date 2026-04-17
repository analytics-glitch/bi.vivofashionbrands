# Vivo Fashion Group BI Dashboard — PRD

## Theme (current): Light / White
- Background #fafaf7, cards white, accent green #00a34a / #00c853.
- Plus Jakarta Sans, 16px rounded cards, subtle shadows.

## Pages (6 tabs)
1. Overview — KPIs (with vs last month & vs last year deltas), highlights, bar/donut/line, top-20 SKUs.
2. Locations — card grid with drill-down to a store's top-20 SKUs.
3. Inventory — KPIs, stock charts, low-stock alerts (≤ 2).
4. Sell-Out Rate — filterable/sortable styles with red/amber/green tiers.
5. **New Styles** (new) — styles launched in the last N months (SKU-decoded). Default N=3.
6. CEO Report — simplified: Headline KPIs · Country Performance · Top 5 Locations, print-friendly.

## Global Filters
- Date range (default current month 1st → today)
- Country (drives `store_id` on all backend calls)
- Location (drives `location` param)

## Backend (FastAPI)
- Proxies: `/api/locations`, `/api/kpis`, `/api/sales-summary`, `/api/top-skus`,
  `/api/sor`, `/api/daily-trend`, `/api/inventory`.
- Analytics: `/api/analytics/kpis-plus` (adds units_clean, units_per_order,
  return_rate, sell_through_rate), `highlights`, `by-country`,
  `inventory-summary`, `low-stock`, **`new-styles`** (SKU-date heuristic).

## Implemented (updated 2026-04-17, iteration 3)
- ✅ Light/white theme swap (CSS variables, Tailwind config).
- ✅ KPI cards show vs last month & vs last year delta rows with colored arrows
  (green = good, red = bad; inverted for return_rate).
- ✅ Country filter now correctly drives `store_id` on `/kpis-plus` and `/sor`
  and `/daily-trend` (bug fix).
- ✅ New Styles page + backend endpoint `/api/analytics/new-styles?months=N`.
- ✅ CEO Report simplified (removed Top 10 SKUs / Top 10 SOR tables).
- ✅ 24/24 backend tests passing.

## Verified KPI by country (Apr 1-17, 2026)
- Group: KES 45,223,375
- Kenya (vivofashiongroup): KES 39,815,393
- Uganda (vivo-uganda): KES 3,805,746
- Rwanda (vivo-rwanda): KES 1,602,236

## Backlog
- P1: CSV export on SOR / Low-stock / New-Styles tables.
- P1: Store first-sale date when upstream adds it (replaces SKU heuristic).
- P2: Compare-range toggle for charts (current vs previous).
- P2: Multi-currency toggle (KES / UGX / RWF).
- P3: Auto re-order suggestion panel.
