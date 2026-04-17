# Vivo Fashion Group BI Dashboard — PRD

## Original Problem Statement
Initial user input: `https://vivo-bi-api-666430550422.europe-west1.run.app`
Second request: full redesign to a dark-green/black theme with KES currency,
5 tabs (Overview / Locations / Inventory / SOR / CEO Report), and explicit
KPI layout.

## Architecture
- **Backend**: FastAPI (`/app/backend/server.py`). Proxies upstream endpoints
  `/`, `/locations`, `/kpis`, `/sales-summary`, `/top-skus`, `/sor`,
  `/daily-trend`, `/inventory`. Adds aggregation layers under `/api/analytics/*`:
  - `kpis-plus` (adds units_per_order, return_rate, sell_through_rate,
    units_clean excluding bags/vouchers)
  - `highlights` (top location / brand / collection)
  - `by-country` (Kenya vs Uganda vs Rwanda rollup)
  - `inventory-summary` (by country/location/product_type + `markets`)
  - `low-stock` (threshold ≤ 2)
- **Frontend**: React + TailwindCSS + Recharts + Phosphor Icons.
  FiltersProvider drives date range (default: first-of-month → today),
  country, and location filters globally.
- **Theme**: Dark green #1a3a2a / black #0d0d0d surfaces, white text,
  bright green #00c853 accent, 16px rounded cards, subtle shadows,
  Plus Jakarta Sans.
- **Currency**: All KES amounts formatted `KES 1,534,880` — no M/K
  abbreviations anywhere except chart axis labels (`fmtAxisKES`).

## User Personas
- CEO / Regional Director — CEO Report page, group KPIs, print/PDF.
- Country & Store managers — Locations page with drill-down to top SKUs.
- Merchandising — Inventory and SOR pages.

## Core Requirements (current)
- Overview: 4 KPI row 1 + 5 KPI row 2 + 3 highlight cards + top-15 bar +
  country donut + daily trend + top-20 SKU table.
- Locations: card grid with drill-down to top SKUs per store.
- Inventory: 4 KPIs, stock-by-location bar, stock-by-type bar, low-stock
  alerts table (product name search, country/location filters).
- SOR: searchable/sortable sell-out-rate table with red<30% / amber 30–60%
  / green >60% coding.
- CEO Report: printable one-page (A4-friendly) exec report with 5 sections
  + Print/Export PDF button.

## Implemented (updated 2026-04-17)
- ✅ Backend redesigned to match new upstream surface (8 proxy + 5 analytics
  endpoints). 21/21 backend tests passing.
- ✅ Frontend fully rebuilt around the dark-green theme with all 5 tabs.
- ✅ KES formatting with full numbers & commas.
- ✅ Location drill-down on Locations tab.
- ✅ SOR color coding.
- ✅ CEO Report print stylesheet (black-on-white with green section headings).
- ✅ Global filters with default current-month range.

## Prioritized Backlog
- **P1**: CSV export for SOR and Low-stock tables.
- **P2**: Auto re-order suggestion panel (days-of-stock threshold).
- **P2**: Multi-currency toggle (KES / UGX / RWF) if upstream exposes local
  currency.
- **P3**: Compare date ranges (this period vs previous).

## Next Tasks
- Gather user feedback on the dark-green theme / numeric formatting.
- If positive, ship CSV export as the first enhancement.
