# Vivo Fashion Group BI Dashboard — PRD (v6)

A read-only, multi-country retail BI proxy on top of the Vivo BI API.
Proxies + aggregates 14+ upstream endpoints into 7 operating views.

## Theme
Clean white (#ffffff background, #f8f9fa panel cards), dark green #1a5c38
accents, bright #00c853 highlights, dark grey text, 12px radius, Plus Jakarta
Sans. Currency ALWAYS in KES (never $).

## Navigation (top bar, horizontal tabs)
1. Overview
2. Locations
3. **Footfall** *(new v6)*
4. Products
5. Inventory
6. Customers
7. CEO Report

## Filter bar (persistent, auto-applying)
Presets: **Yesterday** *(new v6)* · Today · This Week · This Month · Last
Month · This Year · Custom.
- `This Month` now ends at **yesterday** (data is not live).
- `Custom` uses date inputs.
- Country multi-select (Kenya / Uganda / Rwanda / Online).
- Channel multi-select, grouped by country.
- Compare toggle: None · vs Last Month · vs Last Year.

## Upstream API
`https://vivo-bi-api-666430550422.europe-west1.run.app`
Used: `/`, `/locations`, `/kpis`, `/sales-summary`, `/top-skus`, `/sor`,
`/daily-trend`, `/inventory`, `/country-summary`, `/stock-to-sales`,
`/customers`, `/customer-trend`, `/footfall`, `/subcategory-sales`,
`/subcategory-stock-sales`. Params: `country`, `channel`, `date_from`,
`date_to`, `limit`.

## Backend (FastAPI — `/app/backend/server.py`)
- All upstream endpoints proxied through `/api/*`.
- Accepts **comma-separated** country & channel values; fans out in parallel
  and aggregates (KPI avg recompute, SOR recompute, SKU merge, etc.).
- Analytics:
  - `/api/analytics/inventory-summary` — by country / location / product type.
  - `/api/analytics/low-stock` — threshold flag.
  - `/api/analytics/returns` — top channels by returns.
  - `/api/analytics/insights` — auto-generated CEO narrative.
  - **`/api/analytics/new-styles`** *(new v6)* — styles whose first-ever sale
    is within last 90 days (relative to `date_to`). Uses `/top-skus`
    `limit=10000` for historical existence check (bypasses `/sor` 200-row cap).

## Pages
### Overview
- Row 1 KPIs: Total Sales · Net Sales · Orders · Units.
- Row 2 KPIs: Basket · ASP · Return Rate · Return Amount.
- **Row 3 KPIs *(new v6)*: Total Footfall · Conversion Rate** (with LM/LY
  deltas; excludes locations with conv >50% — data-quality rule).
- Highlight cards: Top Country · Top Location · Best Conversion Rate.
- Top 15 locations bar chart, country split donut, daily trend (with compare
  dotted line), subcategory sales bar, Top 20 styles table.

### Locations
- KPIs, sortable location cards, drill-down to top 10 SKUs at a channel.
- Footfall table below (excludes conv >50%).

### Footfall *(new v6)*
- 4 KPIs: Total Footfall, Orders, Group Conversion, Sales/Visitor (with LM/LY
  deltas).
- Charts: Footfall by location, Conversion by location (red/green vs group
  avg), Sales/visitor bars.
- Location-level table with Δ Footfall vs compare period.
- Excluded-locations panel (conv >50% — e.g. Vivo Junction counter issue).

### Products
- 4 KPIs: Styles, Units, Sales, ASP.
- **Subcategory tornado chart: Stock (blue, LEFT) vs Sales (green, RIGHT)**
  *(re-ordered v6)*.
- SOR KPIs & style-level SOR table with search.
- Top 20 SKUs table — product name + collection (SKU identifier).
- **New Styles Performance *(new v6)*** — styles whose first sale is < 90 days
  old, with period + since-launch units & sales.

### Inventory
- 4 KPIs: Units, Active SKUs, **Low-Stock Styles (≤10)** *(v6)*, Locations.
- Brand / product-type / search filters.
- Stock by location + by product type charts.
- **Understocked subcategories panel *(new v6)*** — where % of total sales > %
  of total stock (red if gap ≥3 pts, amber ≥1 pt).
- **Low-stock alerts by STYLE *(new v6)*** — styles with ≤10 total available
  units summed across all their SKUs in the scope.
- Stock-to-Sales ratio table (red >10×, amber 3-10×, green 1-3×, blue <1×).
- Inventory drill-down table.

### Customers
- KPIs: Total · New · Repeat · Returning · Avg Spend · Avg Orders.
- **Conditional churn *(v6)*:**
  - Period ≥ 90 days → Churn KPI + Churn-box shown (churned / total with rate).
  - Period < 90 days → Churn hidden, "churn unavailable" note; donut shows
    only New vs Repeat.
- Daily new vs returning line chart, by-country bar chart.

### CEO Report
9 print-friendly sections with auto-generated narrative, including top
country, top store, return rate vs LM, avg basket delta.

## Data rules
- Currency: KES only with commas; never `$`.
- Footfall: exclude locations with conversion_rate > 50% (Vivo Junction data
  quality issue).
- Churn: purchased in period but no purchase in the last 3 months; require
  selected period ≥ 3 months.
- New Style: first-ever sale within last 90 days of `date_to`.
- Understocked Subcategory: `% units sold − % total stock > 0.5`.

## Architecture
```
/app
├── backend/
│   ├── .env                # VIVO_API_BASE, MONGO_URL
│   └── server.py           # Proxy + aggregation + analytics
└── frontend/src/
    ├── App.js              # Router
    ├── lib/{api.js,filters.jsx}
    ├── components/{Sidebar,FilterBar,KPICard,MultiSelect,common}.jsx
    └── pages/{Overview,Locations,Footfall,Products,Inventory,Customers,CEOReport}.jsx
```

## Changelog
- **v6.2 (Apr 2026)**
  - Fixed Inventory data completeness: upstream `/inventory` is hard-capped at
    2000 rows, only returning 5 of 51 locations. Backend now fans-out per
    location (with 60s in-memory cache) so Total Available Units, by-location,
    by-product-type charts reflect the true 62k+ units across 27 active stores.
  - Fixed upstream `country` param: must be lowercase (e.g. `kenya`) — was
    sending title-case, producing empty responses.
  - New KPIs on Inventory: **Stock in Stores** vs **Stock in Warehouse** (split
    by location name rules: warehouse/wholesale/holding/sale stock/etc.).
  - New section **"Stock per subcategory · Stores vs Warehouse"** with stacked
    bar chart + breakdown table showing store units, warehouse units, total,
    and store share per subcategory.
- **v6.1 (Apr 2026)**
  - CEO Report Section 4: removed empty SKU column (upstream doesn't expose
    SKU at style level); now shows Product Name, Brand, Collection,
    Subcategory, Units, Sales, Avg Price.
  - Added CEO Report Section 9 — **New Styles · Rising Stars**: top 3 new
    styles by period sales with ⚡ Double-down flags when SOR > 60% + auto
    merchandising action callout.
  - Rebuilt churn computation via new `/api/analytics/churn` endpoint.
    Definition: customers who shopped during selected period but did NOT
    return in the last 90 days of that period (set-math:
    `full - last_90d_of_period`). Returns `applicable=false` when period
    length < 90 days.
- **v6 (Apr 2026)**
  - Added Footfall + Conversion KPIs on Overview.
  - Added **Yesterday** preset; `This Month` ends yesterday.
  - Added Footfall Analysis page.
  - Added New Styles Performance section (Products).
  - Added Understocked Subcategories panel & Low-stock by Style (Inventory).
  - Reversed tornado chart order (Stock left, Sales right).
  - Churn logic gated on ≥90-day selected period.
  - New backend endpoint `/api/analytics/new-styles`.
- v5: complete rebuild — 6-page dashboard with auto-applying filters, KES
  formatting, comparison toggle.

## Backlog / P1
- CEO-report narrative: tune wording for new-styles + understock callouts.
- Pagination / virtualization for inventory & SOR tables when row count > 500.
- Persist filter state in URL query string (shareable links).
- Optional CSV export for the footfall & new-styles tables.
