# Vivo Fashion Group BI Dashboard — PRD

## Original Problem Statement
User provided only an API URL: `https://vivo-bi-api-666430550422.europe-west1.run.app`
(Vivo Fashion Group BI API). User skipped clarifying questions, so we proceeded with
reasonable defaults: build a full dashboard that consumes this public read-only API.

## Architecture
- **Backend**: FastAPI (/app/backend/server.py). Proxies the upstream Vivo BI API and
  adds aggregation endpoints under `/api/analytics/*`. Shared httpx.AsyncClient.
- **Frontend**: React + TailwindCSS + Recharts + Phosphor Icons. Sidebar layout with
  4 pages (Overview / Sales / Inventory / Locations). Global filters: date range +
  country, held in a FiltersProvider context.
- **Design**: Earthy "Vivo" palette — terracotta #C84B31 primary, safari green
  #4A5340, warm bone background #F9F8F6. Cabinet Grotesk (display) + Satoshi (body)
  via Fontshare CDN.
- No database, no auth (public read-only API).

## User Personas
- Regional Director (Amara K.) — wants group-wide KPIs at a glance.
- Country/Store manager — needs per-country stock & sales detail.
- Merchandiser — needs top products, brand mix, low-stock alerts.

## Core Requirements
- Group KPIs: Gross, Net, Orders, Units, AOV, Discount rate.
- Per-country aggregation (Kenya / Uganda / Rwanda).
- Top stores, top products, top brands, product-type mix.
- Inventory: units by country/location/type, low-stock alerts.
- Store directory grouped by country.
- Date-range & country filters.

## Implemented (2026-01-17)
- ✅ Backend proxy + aggregation (`/api/locations`, `/api/sales`, `/api/inventory`,
  `/api/sales-summary`, `/api/analytics/overview`, `/api/analytics/by-country`,
  `/api/analytics/top-products`, `/api/analytics/top-brands`,
  `/api/analytics/product-types`, `/api/analytics/inventory-summary`,
  `/api/analytics/low-stock`).
- ✅ Overview page — 4 KPI cards, top-stores bar chart, country donut + list,
  top-5 products table.
- ✅ Sales page — 4 KPIs, brands horizontal bar, product-type bar, searchable &
  sortable line-items table (200 rows).
- ✅ Inventory page — 4 KPIs, stock by location/type charts, country cards,
  low-stock alerts table.
- ✅ Locations page — all 29 stores grouped by country with per-store KPIs.
- ✅ Responsive layout, hover lift, fade-in animations, data-testids everywhere.
- ✅ Backend testing: 100% (15/15 endpoints).

## Prioritized Backlog
- **P1**: Time-series chart (daily trend) — requires either upstream date bucketing
  or client-side grouping from /sales.
- **P1**: Export to CSV on sales & low-stock tables.
- **P2**: Drill-through from store card to filtered sales.
- **P2**: Multi-currency toggle (Vivo stores sell in KES/UGX/RWF).
- **P2**: Loading skeletons (currently uses spinner).
- **P3**: Dark mode.

## Next Tasks
- Gather user feedback on the default color palette / layout.
- If feedback is positive, implement P1 features (trend chart, CSV export).
