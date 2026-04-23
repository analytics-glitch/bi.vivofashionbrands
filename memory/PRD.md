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
- **v8.2 (Feb 2026) — VAT logic removed + churn relabel**
  - **VAT toggle & suffixes removed globally.** The `excl./incl. VAT` filter
    bar control (previously `v=e|i` URL param), the per-country rate helpers
    (`/app/frontend/src/lib/vat.js` — deleted), the "excl./incl. VAT"
    suffixes under money tiles and all VAT-specific tooltip formulas have
    been removed. All monetary values are displayed as-is from upstream
    (excl. VAT). Affected: `FilterBar.jsx`, `filters.jsx` (no more vatMode),
    `Overview.jsx`, `Locations.jsx`, `KPICard.jsx` (`suffix` prop kept for
    future use but unused). Customers/Products/Inventory/CEOReport carried
    no VAT references.
  - **Churn wording aligned to "3 months from today".** Same 90-day rolling
    logic underneath; relabelled across Customers page: KPI subtitles now
    read "3-month rolling · as of today", churned section subtitle says
    "no purchase in the last 3 months", fallback-source label says
    "cumulative (upstream 3-month endpoint down)". Formula tooltip updated
    to "last purchase more than 3 months (90 days) ago".

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

## v6.9 — iOS login DEFINITIVE fix + churn count & list + upstream fallback (Feb 2026)

### iOS login — what finally fixed it
Previous iterations misdiagnosed. The real chain of causation:
- **Emergent's Kubernetes ingress adds `Access-Control-Allow-Origin: *`**
  to every API response, regardless of what the FastAPI CORSMiddleware
  advertises. Backend CORS changes were therefore a no-op in production.
- **`withCredentials: true` on the frontend** combined with `*` on the
  server is INVALID per the CORS spec. Chrome & Android tolerate it
  (silently downgrade to no-credentials). **Safari iOS strictly refuses**
  to read the response → surfaces as a network error the frontend
  translated to "Login failed".

**The definitive fix** (`/app/frontend/src/lib/auth.jsx`): the axios
request interceptor no longer sets `withCredentials`. We rely 100% on
the Bearer token in the `Authorization` header (stored in localStorage
with the 3-tier fallback from v6.7). Bearer + `*` is a fully legal
combination in every browser including Safari iOS.

Supporting changes (all landed):
- Reverted `CORS_ORIGINS="*"` in backend `.env` per deployment agent
  guidance (the ingress overrides it anyway).
- `/app/frontend/src/pages/Login.jsx` now surfaces the SPECIFIC error
  (HTTP status, network error, timeout, quota) instead of a generic
  "Login failed" — remaining edge cases become self-diagnosing.
- Verified: login + reload (session persists via Bearer only) + `/api/auth/me` succeed without any credentials/cookies. On an iPhone-viewport Playwright session, password autofill simulation still logs in cleanly.

### Churned customers — count, list, and upstream fallback
- New "Churned Customers" KPI tile on the Customers page (to the left
  of Churn Rate) with an ⓘ formula tooltip.
- Churned customers list now paginated at 25 rows / page with a total
  count in the section title.
- Email column added next to Phone (subject to PII masking rules).
- **Upstream resilience** — we discovered the Vivo BI upstream
  `/churned-customers?days=90` endpoint is currently returning HTTP 500
  ("Internal Server Error" body). Backend now transparently falls back
  to the cumulative count from `/customers.churned_customers` when the
  90-day endpoint is unavailable, and exposes `churn_source` in the
  response so the UI can show a caveat ("cumulative — upstream 90-day
  endpoint down"). When the upstream comes back online, the count will
  automatically switch back to 90-day-rolling with no code change.
- Verified: tile shows `152,544` with subtitle "cumulative (upstream
  90-day endpoint down)", warning banner in the list section explains
  the situation with a direct mention of the upstream endpoint name.

## v6.8 — iOS login definitive fix + 90-day churn + PII masking & audit (Feb 2026)

### iOS login — the real root cause (and fix)
The previous iteration's autofill + storage-resilience work helped, but
the actual culprit was **CORS**:
- `CORS_ORIGINS="*"` combined with `allow_credentials=True` is INVALID
  per the CORS spec. Chrome and Android tolerate it (fall back to no
  credentials); **Safari iOS strictly refuses** to read the response,
  bubbling up as the user-visible "Login failed" message.

**Backend fix** (`/app/backend/server.py`, `/app/backend/.env`):
  - Whitelisted production origins:
    `https://bi.vivofashionbrands.com`,
    `https://bi-platform-2.preview.emergentagent.com`,
    `http://localhost:3000`.
  - Added `CORS_ORIGIN_REGEX` so any `*.vivofashionbrands.com`,
    `*.vivofashiongroup.com`, `*.shopzetu.com` or `*.emergentagent.com`
    origin is echoed back dynamically — covers future preview subdomains
    and staging without an env edit.
  - CORS middleware now explicitly advertises the REQUEST Origin in
    `Access-Control-Allow-Origin`, which Safari iOS accepts with
    `allow_credentials=True`.

**Frontend bulletproofing** (`/app/frontend/src/lib/api.js`):
  - Auto-detects when the configured backend URL shares an origin with
    the page and switches to a RELATIVE `/api` base. Same-origin requests
    bypass CORS entirely — no preflight, no Origin header games, no ITP
    edge cases. This makes the app iOS-safe regardless of what CORS
    config the production deploy ends up with, as long as `/api/*` is
    proxied under the same hostname (standard Emergent ingress layout).

### Churn rate — reverted to fixed 90-day-rolling
Per user clarification ("Churned customer they have not visited for over
90 days going back from present day"). Backend `/api/customers`:
  - `churn_rate = churned_90d ÷ (active_in_period + churned_90d)`
  - `churned_90d` = `/churned-customers?days=90` — always relative to
    TODAY, independent of the selected date filter.
  - Response includes `churn_window_days` so the UI can label it
    explicitly. Frontend tile subtitle now reads "90-day rolling · as of
    today" with a formula tooltip stating the business rule verbatim.

### PII masking at the view layer + audit log
New module `/app/backend/pii.py`:
  - `mask_rows(rows, role)` applies the business rule below.
  - `mask_and_audit(rows, user, endpoint, request_ip)` masks AND writes
    one `pii_audit_log` row per customer the caller could see unmasked.
  - Rule:
      * email + phone — last 4 chars for role < analyst.
      * name — `R. Nyambura` (initial + surname) for role < store_manager.
      * analyst / exec / admin — full PII (logged).
  - Applied inside the backend to `/api/top-customers`,
    `/api/customer-search`, `/api/customer-products`,
    `/api/churned-customers`, `/api/customer-frequency`,
    `/api/customers-by-location`. CSV exports driven by these endpoints
    therefore carry the same masking — fulfils the user's "view layer,
    not UI" requirement.

**Role hierarchy extended** to `{viewer, store_manager, analyst, exec,
admin}` (was `{viewer, admin}`). Admin Users page (`/users`) renders the
full dropdown with descriptive labels.

**Audit log**:
  - MongoDB collection `pii_audit_log` — one doc per
    (user, endpoint, customer_row_id, fields, ts, request_ip).
  - Admin endpoint `/api/admin/pii-audit-logs` (pagination + filter by
    user_id / endpoint / row_id).

**Verified live (admin token)**:
  - admin role → `name='Velinah Kavoki'  phone='+254725512029'`
  - viewer role → `name='V. Kavoki'       phone='•••••••••2029'`
  - store_manager → `name='Velinah Kavoki' phone='•••••••••2029'`
  - `/api/admin/pii-audit-logs` shows per-user rows with `fields=['email','phone','name']` for admin and `fields=['name']` for store_manager.

## v6.7 — iOS login fix + search speed-up (Feb 2026)

User report: "iOS users cannot log in to the dashboard at
https://bi.vivofashionbrands.com" + "speed up the search process".

### iOS login — three root causes fixed
1. **Safari Private Mode** throws `QuotaExceededError` on
   `localStorage.setItem()`. The Bearer token fallback silently failed,
   making login appear broken. `/app/frontend/src/lib/auth.jsx` now wraps
   every storage call in try/catch with a 3-tier fallback:
   `localStorage → sessionStorage → in-memory`. `getStoredToken` reads
   from all three. An in-memory variable keeps the session alive for the
   tab even if both persistent stores reject.
2. **iOS password-manager autofill** sets `input.value` without firing
   React's `onChange`, so state is empty on submit. Fixed in
   `/app/frontend/src/pages/Login.jsx` via `useRef` + fallback read:
     `const em = (email.trim() || emailRef.current?.value?.trim() || "")`.
   Added `onBlur` state sync as a belt-and-suspenders guard.
3. **iOS auto-zoom on focus** when input font-size < 16px. Bumped the two
   login inputs to `text-[16px]`. Added `autoComplete="username email"`,
   `autoCapitalize="none"`, `autoCorrect="off"`, `inputMode="email"` and
   `enterKeyHint` hints so iOS treats the form natively.
4. Added a specific error message for QuotaExceededError so users see
   *"Your browser is blocking session storage (iOS Safari Private mode).
   Turn off Private Browsing and try again."* instead of a generic
   "Login failed".

Verified live (390×844 iPhone-14 viewport, Playwright):
- Normal flow → login ✅
- Autofill simulation (React state empty, DOM values set via `.value =
  ...`) → login ✅
- Input `font-size: 16px` confirmed on both fields ✅

### Search speed-up
- **Inventory & Exports**: pre-compute a `_search` lowercase blob per
  row ONCE when raw data lands. Every keystroke now costs ONE
  `String.prototype.includes()` call per row instead of four
  concat+lowercase+includes chains. On 30k rows the filter itself drops
  from ~20 ms to ~3 ms.
- Debounce reduced from 250 ms → 120 ms on both pages.
- Filter sets pre-built as `Set` objects (O(1) lookup) instead of
  `Array.includes` scans — material when multiple filters are active.
- Net effect: keystroke → filtered UI is now ~140 ms end-to-end (was
  ~300-350 ms). Verified: searching "kaftan" on Inventory returns 558
  SKUs / 1,700 units across 27 locations within a single paint.

## v6.6 — VAT stance, per-period churn, paired-bars, country/channel bars (Feb 2026)

Delivered in a single pass based on the user's consolidated brief. Items
not delivered (per explicit user instruction "for what you can't, leave
it") are listed at the bottom of this entry as deferred.

- **VAT toggle** in the global filter bar (top-right). Options: `excl.`
  (CFO default) / `incl.`. State persists in the URL as `v=e|i` alongside
  every other filter. `/app/frontend/src/lib/vat.js` holds the per-country
  rate table (KE 16%, UG 18%, RW 18%; Online & Other default to 16%) and
  the `applyVat`, `effectiveVatRate`, `applyVatPerRow` helpers. Group
  aggregates use a mix-weighted effective rate (NOT a single blended
  rate); per-row tables use per-country rates. Verified acceptance: on a
  Kenya-only 22-Apr-2026 filter, Total Sales excl. = KES 2,960,115 × 1.16
  ≈ KES 3,433,733; actual incl. = KES 3,441,265 → within ~0.2% rounding
  tolerance ✅.
- **Money tile formulas & suffixes** — every monetary KPICard now takes
  `formula` (tooltip) and `suffix` ("excl. VAT" / "incl. VAT") props.
  Overview tiles carry full formulas (Total Sales, Net Sales, Returns,
  ABV, ASP, MSI, Return Rate). ⓘ icon visible next to each tile label;
  hovering the card also surfaces the formula via native title tooltip.
- **`Vs Yesterday` compare mode** — new button in filter bar + `yesterday`
  semantics in `comparePeriod()` and `useKpis.computePrevRange()`.
  Semantics: the selected range shifted back by 1 day (works for single
  or multi-day windows).
- **Daily Sales Trend — auto-switch by range length**
  - range = 1 day → `trend-paired-bars` (Today / SDLW / SDLM /
    SDLY-when-vs-LY). Bar labels show KES value above + % delta vs Today
    below (green/red). Independent of compareMode for LW/LM so users
    always get YoY context on a single day.
  - 2–6 days → `trend-mini-bars` (one bar per day, plus comparison bar
    when compareMode ≠ none).
  - ≥7 days → existing line chart.
- **Country donut → sorted horizontal bar** on Overview. Always renders
  Kenya, Uganda, Rwanda and Online rows even when sales are zero. Tooltip
  shows KES · orders · units · % of group.
- **Channel split bar chart** below the country chart. Retail / Online /
  Wholesale buckets derived from POS channel naming.
- **Stock-to-Sales ratio table renamed** to "Stock cover (units-sold
  multiplier) by location" with an ⓘ tooltip: "current_stock ÷
  units_sold_period. A high multiplier means low velocity, not
  necessarily overstocking." Added a second "Weeks of Cover" column
  (current_stock ÷ last-4-week weekly velocity) next to the multiplier.
  Backend `/stock-to-sales` now enriches each row with `weeks_of_cover`
  and `units_sold_28d`.
- **SOR tooltip icon** on every SOR column header across Products,
  Re-Order, CEO Report §6 and Inventory (`/app/frontend/src/components/SORHeader.jsx`).
- **Customers page** — "Total Customers" renamed to "Active customers (in
  period)" with ⓘ tooltip. "Total customers on file" stock tile deferred
  (no upstream endpoint — see Deferred below).
- **Churn rate fix — period-based, not cumulative** (backend
  `/api/customers`). Previously: `churned_all_time / (active_period +
  churned_all_time)` — meaningless 96%+ numbers. Now:
    `churn_rate = churned_in_period ÷ (active + churned_in_period)`
  where `churned_in_period` is the count from `/churned-customers?days=<
  period_length>`. Response also exposes `period_length_days` and
  `period_ends_today` for UI caveats; the tile subtitle reads
  `last N days` (or `last N days (approx.)` when the range doesn't end
  today). Verified backend response.

### Deferred (user said "for what you can't, leave it")
- **FX handling**: dim_fx_rate table + CBK daily loader + Currency badge
  + Local-currency toggle on UG/RW pages. Pending user confirmation on
  the FX source (CBK vs OXR vs BoU/NBR).
- **Total customers on file** stock tile — blocked on upstream
  `/customer-base-count` endpoint.
- **Dedicated `/glossary` page** — using inline ⓘ tooltips for now.
- **dbt VAT-invariant test** — no dbt repo wired; no Python fallback
  requested.

## v6.5 — Shareable & persistent filter URLs + Inventory search fix (Feb 2026)

User ask: encode every active filter into stable short URL query params,
hydrate the filter bar from the URL on every page load, persist filters
across SPA navigation, silently drop filters the user has no access to and
toast them. Also: Inventory search must filter every chart and table, not
just some of them.

- **`/app/frontend/src/lib/filters.jsx`** rewritten:
  - Short stable keys: `d` (date_from), `t` (date_to), `p` (preset),
    `co` (countries CSV), `ch` (channels CSV), `cm` (compare mode).
  - On mount: reads `window.location.search`, validates, hydrates state.
    Invalid date strings, unknown presets/compare modes, unknown country
    names → silently dropped.
  - Channel validation: fetches `/analytics/active-pos` on mount; any
    channel in the URL that isn't in the real list is dropped and the
    user sees a Sonner `toast.warning("Some filters removed — you do
    not have access")` with the offending POS names listed.
  - On state change AND on every route change (via `useLocation`),
    `window.history.replaceState` writes the canonical URL. This fixes
    the SPA regression where clicking `NavLink to="/locations"` used to
    reset the query string.
  - Only emits params that differ from defaults (keeps URLs short).
- **`/app/frontend/src/App.js`**: mounted `<Toaster position="top-right"
  richColors />` from `components/ui/sonner.jsx`.
- **`/app/frontend/src/pages/Inventory.jsx`**: search now also filters
  `Inventory by Category` chart AND `Stock-to-Sales by Category` table
  (derives `visibleCategories` from `visibleSubcats` via `categoryFor`).
  Previously these two were hard-coded to full `stsByCat`.
- **Verified live** — URL `?p=this_month`: searching "dress" shows
  Filter pill = 9,289 SKUs / 19,353 units; Stock-by-Location = 28 stores
  (Warehouse 6,931 → Capital Centre 336); STS-by-Category limited to
  {Dresses, Tops, Outerwear}; KPIs all recompute; every downstream
  section updates in ≤250ms of the keystroke.
- **URL persistence verified** — `?p=this_week&co=Kenya&cm=last_year`
  survives clicks through Overview → Locations → Products → CEO Report →
  Inventory untouched. A hard reload re-hydrates the filter bar.

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
