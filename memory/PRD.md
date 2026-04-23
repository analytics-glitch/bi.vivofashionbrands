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
- **v8.1 (Apr 2026) — bugfix + polish**
  - **Orange background bumped**: body bg is now `#fed7aa` (Tailwind orange-200,
    clearly visible), border `#fdba74`.
  - **Locations top row**: ABV, ASP, MSI are now part of the main 7-card KPI
    grid (no separate second row). Responsive: `grid-cols-2 sm:grid-cols-3
    lg:grid-cols-7`.
  - **Daily Sales Trend fix** — the chart was always showing the Empty
    placeholder because `dailyCalls` returned a tuple `[country, data]` which
    was then wrapped by `safe()` and `r?.data` returned undefined. Removed the
    inline `.then` — consumer already pairs country → data after the fetch.
    Also: strokeWidth 3, visible dots, previous-period line in amber dashed.
  - **Mobile-friendly**: TopNav collapses to a hamburger below lg breakpoint
    with a dropdown `[data-testid=mobile-menu]`; FilterBar pills wrap and use
    smaller text on mobile; page H1s scale `text-[22px] sm:text-[28px]`; Shell
    padding reduces on mobile; ChatWidget expands to nearly full-screen on
    small devices and FAB z-index bumped to 60.

- **v8 (Apr 2026) — AI Assistant + warm orange theme + UX polish**
  - **Theme**: Page background switched from `#f5f5f0` (warm grey) to
    `#fff4e6` (soft warm cream-orange); border color `#f3dcbf`.
  - **Overview**:
    - Sales by Subcategory label bug fixed (was showing `0.0%`) — now renders
      `KES X · Y%` using a preformatted `subcat_label` field.
    - New **Sales by Category** chart (Dresses/Tops/Bottoms/Outerwear/
      Accessories/Footwear/Intimates & Swim/Other).
    - Top locations chart now shows **ALL** POS (not just 15), bars labelled
      with total sales, tooltip includes units sold.
    - "Top 20 Styles" title cased consistently.
  - **Footfall**: Footfall-by-location and Conversion-by-location charts are
    now **side-by-side** in a 2-column grid (smaller width each).
  - **Products**:
    - Removed Top-25 and Bottom-15 tornado charts.
    - Variance column now suffixed with `%` (was `pts`).
    - **SOR-by-style** table is now a `SortableTable` (sort on every column,
      CSV export) and positioned as the **last** table on the page.
    - "Top 20 SKUs" → **Top 20 Styles** (SKU column removed, now sortable).
    - **New styles performance** table is now sortable with CSV export.
  - **Inventory**: Understocked Subcategories, Low-stock alerts,
    Stock-to-Sales by Location, and the main Inventory table all converted to
    `SortableTable` with CSV export.
  - **Table styling**: `table.data` header/td padding unified, right-aligned
    headers get `tabular-nums` so numeric columns line up properly.
  - **New**: **AI Chat Assistant** — floating bottom-right bubble on every
    authed page. Uses Emergent LLM key + Claude Sonnet 4.5 via
    `emergentintegrations`. Multi-turn conversations persisted in Mongo
    `chat_messages` collection + last 40 messages cached in localStorage.
    Sends current filters (date range, countries, POS) as context per turn.
    Endpoints: `POST /api/chat` and `GET /api/chat/history` (both auth-gated,
    activity-logged).

- **v7.1 (Apr 2026) — Authentication + Activity Logging**
  - All `/api/*` business endpoints now require a valid session (401 when anonymous).
  - **Google Sign-In (primary)** via Emergent OAuth. Domain whitelist enforced
    server-side: `@vivofashiongroup.com` and `@shopzetu.com` (configurable
    via `ALLOWED_EMAIL_DOMAINS` env). First login auto-provisions a `viewer`.
  - **Email/password (fallback)**. Admin-created accounts only (no self-signup).
    Bcrypt hashing via passlib. Seed admin on startup:
    `admin@vivofashiongroup.com` / `VivoAdmin!2026`
    (see `/app/memory/test_credentials.md`).
  - **Roles**: `admin` and `viewer`. Admins get a Users management page and an
    Activity Logs page in the user menu.
  - **Sessions**: `session_token` stored in an httpOnly cookie AND returned to
    the frontend; axios interceptor attaches `Authorization: Bearer` too.
    TTL 7 days. MongoDB TTL index on `expires_at` auto-cleans.
  - **Activity logging middleware** inserts one row per authed `/api/*`
    request into `activity_logs` with `{ts, user_id, email, method, path,
    query, status_code, duration_ms, ip, user_agent}`. Admin page lists +
    paginates + CSV-exports them with email/path filters.
  - **New endpoints**: `POST /api/auth/login`, `POST /api/auth/google/callback`,
    `GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/auth/allowed-domains`;
    `GET|POST /api/admin/users`, `PATCH|DELETE /api/admin/users/{id}`,
    `GET /api/admin/activity-logs`.
  - **New frontend**: `AuthProvider`, `ProtectedRoute`, `/login`,
    `/auth/callback`, `/admin/users`, `/admin/activity-logs`, user menu in
    TopNav with avatar + sign-out.
  - **v7 (Apr 2026) — Comprehensive dashboard refresh**
  - **Global**: Background changed to warm light grey `#f5f5f0`.
  - **Reusable primitives**: New `<SortableTable>` component (every column
    click-sortable, "Show first N / Show all" pagination, built-in CSV
    export button); `<ChartTooltip>` (all chart tooltips now show units
    alongside monetary values); `<Delta>` (green ▲ / red ▼ pill for %
    changes).
  - **Top nav** now has "Updated … ago" + manual refresh button globally.
  - **Filter bar**: `Channel` → `POS Locations`. Backed by new
    `/api/analytics/active-pos` endpoint which only returns physical store
    locations with at least one sale in the last 30 days (warehouse, online
    and third-party locations excluded).
  - **Overview**:
    - Daily trend collapsed to a single Total Sales line (with dotted
      compare line when vs-LM / vs-LY active).
    - Sales by Subcategory chart shows top 15 with KES + %-of-total labels.
    - Top 20 styles table is now sortable with CSV export; Brand & Collection
      columns removed; Inventory (current_stock) column added.
  - **Locations**: three new KPI cards — ABV · ASP · MSI; three new sort
    buttons (ABV / ASP / MSI).
  - **Footfall**:
    - KPI replaced: Sales per Visitor → **Avg Basket Value** (Sales ÷ Orders).
    - Country column removed from breakdown; table is now sortable with CSV
      export and shows **Last-period footfall + Δ Footfall** (green ▲ / red ▼)
      when a compare mode is selected.
    - Footfall-by-Location and Conversion-by-Location charts are now full
      horizontal bar charts with value labels for every location.
  - **Products**:
    - Added Brand multi-select (Vivo, Safari, Zoya, Sowairina, Third Party
      Brands) — client-side filter on SOR, Top 20, New Styles.
    - Subcategory tornado chart split into **Top 25** and **Bottom 15** by
      units sold.
    - Two new sortable + CSV-exportable tables: Stock-to-Sales **by Category**
      (Dresses / Tops / Bottoms / Outerwear / …) and **by Subcategory** with
      Variance column (% sold − % stock).
  - **Inventory**:
    - Stock-by-Location chart is now horizontal, shows ALL locations, with
      value labels.
    - New Inventory-by-Category and Inventory-by-Subcategory (top 15) bar
      charts.
    - New **Weeks of Cover** table: `current_stock ÷ (units_sold_last_28d ÷ 4)`
      per style, pageSize 25 with Show-all toggle, color-coded pills
      (red <2w · amber 2-4w · green >4w), CSV export.
    - Added Stock-to-Sales by Category + Subcategory tables (same shape as
      Products page).
  - **CEO Report**: Top 20 styles table (was Top 10) shows Rank · Style ·
    Subcategory · Units · Sales · Avg Price — Brand and Collection removed.
  - **Backend**: new endpoints `/api/analytics/active-pos`,
    `/api/analytics/stock-to-sales-by-subcat`,
    `/api/analytics/stock-to-sales-by-category`, `/api/analytics/weeks-of-cover`.
  - **Known gap**: Upstream `/customers` is aggregate-only (no individual
    customer IDs, names, phones, last-purchase dates), so the following
    items from the spec are **not implemented**: Top-20 Customers table,
    Churn list with customer IDs/names, Customers-by-POS breakdown, New
    Customer Products. These require a new upstream endpoint exposing
    per-customer records.
- **v6.5 (Apr 2026)**
  - Picked up upstream data cleanup: `/subcategory-sales` now returns one
    clean row per subcategory (no brand duplication). Backend merge key
    updated to subcategory-only.
  - Added **Brand multi-select filter on Products page** (Vivo, Safari,
    Zoya, Sowairina, Third Party Brands). Applied client-side to SOR table,
    Top 20 SKUs and New Styles. Upstream `product` param is a prefix-match
    on product_name (not brand), so server-side filtering isn't reliable.
  - Removed "Uncategorized" fallback bucket — rows without a product_type
    (phantom upstream rows) are now dropped from inventory aggregates.
  - **Shopping bag / gift voucher / gift card / VB00 SKUs** now excluded
    from all inventory data: KPIs, charts and the inventory table.
  - "Warehouse Finished Goods" stays as a separate **Warehouse Stock KPI**,
    fan-out through 61 product-prefix chunks (A-Z + 0-9 + top-brand 2-letter
    vowels), cache-busted on manual refresh.
  - New **"Updated … ago" indicator + Refresh button** in the top nav.
    Clicking the button increments a `dataVersion` counter in the filter
    context which triggers every page's useEffect to refetch. Inventory
    endpoints additionally accept `?refresh=true` to bust the backend 60s
    in-memory cache.
- **v6.4 (Apr 2026)**
  - Fixed Locations drill-down (top styles at a channel): removed SKU/Size
    columns (upstream `/top-skus` doesn't expose them); now shows Style,
    Collection, Brand, Subcategory, Units, Sales, Avg Price.
  - Inventory fan-out now **excludes non-inventory locations** (Shopping Bags,
    Bundling, Buying and Merchandise, Defectss, Mockup Store, Holding,
    Online Orders Location, Third-party App, Sale Stock, Vivo Wholesale,
    A Vivo Warehouse Location).
  - Dropped phantom upstream rows (null product_name AND null SKU).
  - Renamed the "Other" subcategory → "Uncategorized" (these are real SKUs
    that upstream didn't tag with a product_type).
  - **Third Party Brands removed** from inventory analysis entirely.
- **v6.3 (Apr 2026)**
  - Added "Warehouse Finished Goods" support. Location isn't in upstream
    `/locations` channel list, so it's injected as an extra known location.
    Upstream `/inventory` caps at 2000 rows, so this location is fetched via
    61 chunked product-prefix queries (A-Z, 0-9, + 2-letter prefixes for top
    brands V/S/A/T/Z + vowels) and deduped by (sku, barcode, size).
  - Result: **Warehouse Stock = 27,524 units across 8,043 unique SKUs**
    (~94% coverage of the 8,505 SKU ground truth).
  - "Warehouse Finished Goods" now selectable in the Channel filter.
  - Inventory table shows warehouse rows when the location is selected.
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

## v6.4 — Merchandise-only rule + Exports page (Feb 2026)
New business rule: Inventory, stock-to-sales and replenishment views
must only consider merchandise (apparel / footwear). Accessories, Sample
& Sale Items and rows with null/empty subcategory are excluded from every
inventory section across the app.

- **New shared lib `/app/frontend/src/lib/productCategory.js`** — single
  source of truth for `categoryFor(subcat)` and `isMerchandise(subcat)`;
  hard-coded exclusion list: {Accessories, Belts, Scarves, Fragrances,
  Bags, Jewellery, Jewelry, Sample & Sale Items, Sale}.
- **Inventory page**: search bar is now a LIVE debounced global filter
  across every chart, table and KPI (no Search button). The detailed
  per-SKU inventory table at the bottom has been removed (moved to the
  new Exports page). Low-stock + Weeks-of-Cover tables gained a Category
  column next to Subcategory.
- **Overview / Products / CEO Report / Re-Order**: every subcategory or
  stock-to-sales aggregate filtered through `isMerchandise`. Re-Order list
  also gained a Category column.
- **New `/exports` page** (between Inventory and Re-Order in nav):
  30k-row SKU-level export with filters (POS Location, Country, Brand,
  Category, Subcategory — all multi-select), search (SKU/Product/Style),
  sortable columns, Next/Previous pagination @ 50 rows/page, full-filtered
  CSV export, total-units footer, optional 'Include Accessories / Sale'
  opt-in checkbox. Default sort: Location → Available desc.
- **Verified (iteration 17)**: 30,398 merchandise SKUs (vs 30,998 with
  accessories opt-in = 600 non-merch rows excluded). Live search shrinks
  every Inventory section; Safari brand filter on Exports = 2,624 SKUs /
  5,633 units. CSV download works (5.57 MB, 30,398 rows). No console
  errors on any page.

## v6.3 — Cross-page KPI consistency (Feb 2026)
Critical data-consistency mandate: the API is the single source of truth; no
page may compute headline totals by summing per-location data.
- **New hook `/app/frontend/src/lib/useKpis.js`** — shared in-memory cache
  keyed on `(date_from, date_to, country, channel, dataVersion)`. Exposes
  `useKpis({ compare })` and `useKpisLMLY()` (for CEO Report).
- **Cache-busting**: axios request interceptor in `/app/frontend/src/lib/api.js`
  appends `_t=<timestamp>` to every GET, preventing stale CDN / browser cache.
- **Refresh button**: `filters.refresh()` now clears `kpiCache` in addition to
  bumping `dataVersion`.
- Pages wired: **Overview**, **Locations**, **Products**, **Footfall**,
  **CEO Report**. Removed:
  - Overview's fallback "derive KPIs from sales-summary sum".
  - Locations's `groupTotals` reduce over `enriched` rows.
  - CEO Report's `totalsRow` reduce over `countries` rows.
- **Verified (iteration 16)**: for both Today (2026-04-23) and MTD
  (2026-04-01 → 2026-04-23) ranges, `{total_sales, net_sales, total_orders,
  total_units}` agree byte-for-byte on Overview + Locations + Products +
  Footfall + CEO scorecard + CEO country TOTAL row.

### Vivo Junction 2026-04-22 — data discrepancy note
User validation target: "KES 462,793 / 33 orders".
Upstream `/kpis` returns for `channel=Vivo Junction, date=2026-04-22`:
```
total_sales   : 477,275   (gross)
gross_sales   : 411,444   (internal upstream name — actually = net)
net_sales     : 411,444
total_orders  : 33        ✅ matches
total_units   : 102
avg_basket    : 14,463
```
`/sales-summary` filtered to Vivo Junction on the same date returns the exact
same figures. 33 orders matches. Neither 477,275 (gross) nor 411,444 (net)
matches 462,793 — this figure does not appear in any upstream field. Possible
explanations for user to clarify: (a) different calc period/timezone
boundary, (b) a Vivo-internal adjusted number not exposed via the public BI
API, (c) figure from a different source system. Pending user confirmation.

## Backlog / P1
- CEO-report narrative: tune wording for new-styles + understock callouts.
- Pagination / virtualization for inventory & SOR tables when row count > 500.
- Persist filter state in URL query string (shareable links).
- Optional CSV export for the footfall & new-styles tables.
- **Persist filter state to localStorage/URL** so cross-page KPI consistency
  survives a full page reload (currently only survives SPA navigation).
- **Refactor `/app/backend/server.py`** (1800 lines) into modular routers:
  `routers/sales.py`, `routers/inventory.py`, `routers/customers.py`,
  `routers/analytics.py`.
- Fix remaining Recharts `width(-1)` ResponsiveContainer warnings.
