# Vivo Fashion Group BI Dashboard — PRD (v4)

## Theme
Bloomberg-terminal-style clean white (#ffffff background, #f8f9fa panel
cards), dark green #1a5c38 accents + bright #00c853 highlights, dark grey
#1a1a1a text, 12px rounded corners, subtle drop shadows, Plus Jakarta Sans.

## Navigation — Top bar (horizontal tabs)
- Overview · Locations · Inventory · SOR · CEO Report
- Persistent filter bar below with:
  - Quick presets (Today / This Week / This Month / Last Month / This Year / Custom)
  - Date range inputs
  - Country multi-select with checkboxes (Kenya / Uganda / Rwanda / Online)
  - Channel multi-select with checkboxes, grouped by country
  - Compare toggle (None / Last Month / Last Year)
  - Apply Filters button (pending vs applied state)

## Upstream API
`https://vivo-bi-api-666430550422.europe-west1.run.app`
Endpoints used: `/`, `/locations`, `/kpis`, `/sales-summary`, `/top-skus`,
`/sor`, `/daily-trend`, `/inventory`, `/country-summary`. Query params:
`country`, `channel`, `date_from`, `date_to`, `limit`.

## Backend (FastAPI)
- Proxies all 9 upstream endpoints. Accepts **comma-separated** country &
  channel values and aggregates with parallel upstream calls:
  - KPI aggregation recomputes avg_basket_size, avg_selling_price, return_rate.
  - SKU aggregation merges same-SKU rows and recomputes avg_price.
  - SOR aggregation merges same-style rows and recomputes sor_percent.
- Analytics: `/inventory-summary`, `/low-stock`, `/returns` (top channels by
  returns KES), `/insights` (auto-generated CEO paragraph: top country %,
  top store, RR vs last month, basket size change).

## Pages

**Overview** — 4 big KPIs + 5 smaller + 3 green highlight cards (Return
Rate · Top Country · Top Location), Top-15 channels horizontal bar, country
donut w/ KES + %, daily trend line with prior-period dashed overlay, Top 20
SKUs sortable table.

**Locations** — 4 summary KPIs, sort chips, store cards color-coded green
(above avg) / red (below avg), comparison delta badge per card. Click card →
drill-down to that channel's top 10 SKUs.

**Inventory** — 4 KPIs (Total Units, Active SKUs, Low Stock ≤2, Warehouse
FG Stock), brand/type/product filters, Stock by location bar, Stock by
product type bar, Low-stock alerts table, full inventory table (first 300).

**SOR** — 4 tier KPIs (Avg / >60% / 30–60% / <30%), search & brand/type
filters, color-coded Top-20 units bar chart, sortable SOR table with red /
amber / green pills.

**CEO Report** — 7-section executive report, white print-ready layout:
1. Group Performance Scorecard (8 KPIs with vs LM + vs LY)
2. Country Performance table (Kenya / Uganda / Rwanda / Online + TOTAL)
3. Top 10 Locations ranked (with vs LM column)
4. Top 10 Best-Selling SKUs
5. SOR analysis with Best 10, Worst 10 (highlighted red), SOR distribution bar
6. Returns Analysis — totals + Top 5 locations by returns
7. Auto-generated Executive Insights text box
Print / Export PDF button applies black-on-white print styles.

## Verified (iteration 4 · 2026-04-17)
- ✅ 26/26 backend tests passing.
- ✅ Multi-value aggregation verified (Kenya+Uganda = Kenya sum + Uganda sum).
- ✅ All 5 pages render. Screenshots taken.
- ✅ Sort fixes applied to single-country /top-skus and /sor.

## Backlog
- P1: CSV export for all data tables.
- P2: Channel-level compare metrics in Locations (not just total_sales).
- P2: Hover tooltip on charts showing more context.
- P3: Schedule CEO Report email export.
