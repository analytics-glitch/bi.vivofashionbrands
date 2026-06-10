# 04 · Pages — What Each Dashboard Page Does

The dashboard has **24 routes**. Each page is implemented as a single `.jsx` file under `frontend/src/pages/`. Pages share a common shell (`AppShell`, header pills, FilterBar) and pull their data through `api.js`.

The list below is in the order of the top-nav.

---

## 4.1 Overview — `/`
**File:** `pages/Overview.jsx`
**Audience:** Executive — daily glance.

**Shows:**
- KPI tiles (Total Sales, Total Units, ABV, ASP, MSI, Conversion Rate) with vs-last-period deltas
- Daily Trend chart (`/daily-trend`)
- Country split (`/country-summary`)
- Top SKUs preview
- Stock cover by location group
- Snapshot pill, Recon pill

**Endpoints:** `/kpis`, `/daily-trend`, `/country-summary`, `/top-skus`, `/analytics/weeks-of-cover`, `/analytics/active-pos`.

---

## 4.2 Executive Summary — `/executive-summary`
**File:** `pages/ExecutiveSummary.jsx`
**Audience:** Leadership — weekly board pack.

**Shows:**
- Curated KPI block with explicit numerator/denominator hover tooltips
- WoC Group Cover (same source as Inventory page — iter 91q unification)
- Country attribution
- Top movers (week-over-week)
- One-click "Mobile snapshot" PNG export

**Endpoints:** `/exec-summary`, `/analytics/weeks-of-cover`, `/api/analytics/sales-projection`.

---

## 4.3 Locations — `/locations`
**File:** `pages/Locations.jsx`
**Audience:** Retail ops — per-store performance.

**Shows:**
- Per-store leaderboard (sales, units, conversion, footfall)
- Store-of-the-Week + streaks (`/leaderboard/store-of-the-week`)
- Per-location footfall calendar
- Drill-down to a single store's hero card

**Endpoints:** `/sales-summary`, `/footfall`, `/leaderboard/streaks`, `/exports/store-kpis`.

---

## 4.4 Footfall — `/footfall`
**File:** `pages/Footfall.jsx`
**Audience:** Retail ops + marketing.

**Shows:**
- Per-day walk-ins (`/footfall/daily-calendar`)
- Weekday heatmap of avg footfall + conversion (`/footfall/weekday-pattern`)
- Per-location footfall vs conversion scatter

---

## 4.5 Customers — `/customers`
**File:** `pages/Customers.jsx`
**Audience:** CRM / marketing.

**Shows:**
- RFM segmentation tiles
- New vs returning split (`/customer-type-spend`)
- Visit frequency distribution
- Top customers (PII gated by role)
- Churn / reactivation buckets

---

## 4.6 Customer Details — `/customers/:id`
**File:** `pages/CustomerDetails.jsx`

**Shows:**
- Full lifetime spend, RFM scores
- Purchase history (`/customer-trend`)
- Products bought (`/customer-products`)
- Stores visited (`/customers-by-location`)
- Cross-store / cross-brand mix

---

## 4.7 Marketing — `/marketing`
**File:** `pages/Marketing.jsx` (rewritten in iter 91q)
**Audience:** Marketing team.

**Shows:**
- Marketing Action Tracker (the only content on this page now)
- Add/edit/move candidates between status columns
- Weekly Monday Resend email digest trigger
- Unit + stock splits per candidate

**Endpoints:** `/api/range-mgmt/marketing-candidates`, `/api/range-mgmt/marketing-report/preview`, `/api/range-mgmt/marketing-report/send`.

---

## 4.8 Products — `/products`
**File:** `pages/Products.jsx`
**Audience:** Head of Products.

**Sub-tabs:**
- **Catalog** — KPI tiles + Stock-to-Sales by Category + by Subcategory + SOR table + Top sellers / Bottom sellers + New styles
- **SOR New Styles L-10** — last 10 newly launched styles
- **SOR All Styles** — full SOR roll-up
- **New Styles Sales Curve** — week-by-week velocity post-launch
- **Country Matrix** — category × country sales heatmap
- **Products Plan** — pre-publish merchandise plan table

**Date Window:** iter 91v added a **page-level Date Window selector** (7d / 14d / 30d / 60d / 90d) that controls all Catalog-tab tables. KPI cards continue to follow the global filter bar.

---

## 4.9 Range Management — `/range-mgmt`
**File:** `pages/RangeManagement.jsx`
**Audience:** Buying / merchandise planners.

**Shows:**
- Tier-1/2/3/4 classification table (`/api/range-mgmt/classify`)
- Weekly SOR heatmap
- Formula tooltips on hover (iter 91q)
- Stock / channel splits per style

**Critical dependency:** Accurate `style_launch_dates_by_number` Mongo state. See [07 § Launch-date heal](./07_operations.md#launch-date-heal).

---

## 4.10 Inventory — `/inventory`
**File:** `pages/Inventory.jsx`
**Audience:** Inventory planners.

**Sections:**
- KPI tiles (Overall WoC, Low-Stock Styles, % Understocked Subcats, Aged Stock %)
- Stock-to-Sales by Subcategory (with own date window)
- Stock-to-Sales by Color (iter 91q — new isolated 30-day window)
- Stock-to-Sales by Size (same window)
- Aged Stock report (with N-day selector)

**Removed in iter 91q:** Low-stock alerts table, per-style Weeks-of-Cover table, Understocked subcategories table — re-pointed deep-link KPIs to STS-by-subcategory.

---

## 4.11 Re-Order — `/reorder`
**File:** `pages/ReOrder.jsx`
**Audience:** Buyers.

**Shows:**
- L-10 launch-window report (which new styles to re-order)
- Action states `{Reorder · Markdown · IBT · Hold}` (planned — P3 backlog)

---

## 4.12 IBT — `/ibt`
**File:** `pages/IBT.jsx`
**Audience:** Inventory + retail ops.

**Shows:**
- Store-to-store IBT suggestions (`/analytics/ibt-suggestions`)
- Warehouse-to-store IBT suggestions (`/analytics/ibt-warehouse-to-store`)
- Mark-as-done modal — writes to `ibt_completed`
- Completed-moves history
- Per-style SKU breakdown drill-down

---

## 4.13 Allocations — `/allocations`
**File:** `pages/Allocations.jsx`
**Audience:** Buyers / allocators.

**Shows:**
- Pending allocation queue
- Past allocation runs history
- Run details + bulk approve

---

## 4.14 Replenishments — `/replenishments`
**File:** `pages/Replenishments.jsx`
**Audience:** Warehouse pickers + replenishment team.

**Shows:**
- Daily replenishment report — what to ship today
- Bin column (from `bins_lookup.py` — refreshed via `POST /api/admin/refresh-bins`)
- Completed-replenishment history
- Owner column (who's actioning each row)

---

## 4.15 CEO Report — `/ceo-report`
**File:** `pages/CEOReport.jsx`
**Audience:** CEO — Monday pack.

**Shows:**
- One-page summary: top-line KPIs, biggest movers, biggest concerns
- Always pre-snapshotted for fastest load

---

## 4.16 Targets — `/targets`
**File:** `pages/TargetsTracker.jsx`
**Audience:** Annual planning.

**Shows:**
- Annual targets by month / quarter (`/analytics/annual-targets`)
- Pace / projection vs target

---

## 4.17 Data Quality — `/data-quality`
**File:** `pages/DataQuality.jsx`
**Audience:** Internal — data engineering.

**Shows:**
- Per-window recon (snapshot vs live)
- Corrupt-entry registry view
- Missing-data flags

---

## 4.18 Exports — `/exports`
**File:** `pages/Exports.jsx`
**Audience:** Anyone needing a CSV.

**Shows:**
- Bundled CSV downloads (sales by SKU, store KPIs, stock rebalancing, period performance)

---

## 4.19 Activity Logs — `/activity-logs`
**File:** `pages/ActivityLogs.jsx`
**Audience:** Admins.

**Shows:**
- Mutation audit log (`audit_logs` collection)
- Auth events
- Filterable by user / action / date

---

## 4.20 Store Clusters — `/store-clusters`
**File:** `pages/StoreClusters.jsx`
**Audience:** Buying — peer-cluster analysis.

**Shows:**
- Stores grouped into clusters by sales profile
- Re-cluster trigger (admin only)
- Per-cluster avg sell rate

**Planned (P3):** Wire IBT recommendation engine to use `cluster_avg_sell_rate` for peer-aware moves.

---

## 4.21 Admin Feedback — `/admin-feedback`
**File:** `pages/AdminFeedback.jsx`
**Audience:** Admins.

**Shows:**
- Submitted feedback from the in-app widget
- Mark-as-read / archive

---

## 4.22 Users — `/users`
**File:** `pages/Users.jsx`
**Audience:** Admins.

**Shows:**
- User list, roles, last login
- Approve / reject pending Google OAuth signups

---

## 4.23 Feedback — `/feedback`
**File:** `pages/Feedback.jsx`

User-facing single-form to submit a feedback note. Writes to `feedback` collection.

---

## 4.24 Login / Auth Callback / Awaiting Approval
- `/login` — `pages/Login.jsx` (Email/password + Sign-in-with-Google)
- `/auth/callback` — `pages/AuthCallback.jsx` (OAuth landing)
- `/awaiting-approval` — `pages/AwaitingApproval.jsx` (shown to OAuth users not yet approved)

---

## 4.25 Top-nav structure

```
Overview · Executive Summary · Locations · Footfall · Customers · Customer Details ·
Marketing · Products · Range Mgmt · Inventory · Re-Order · IBT · Allocations ·
Replenishments · CEO Report · Targets · Data Quality · Exports · Feedback
```

Pages NOT in the top nav (accessed via Admin menu / direct URL):
`Activity Logs`, `Store Clusters`, `Admin Feedback`, `Users`.
