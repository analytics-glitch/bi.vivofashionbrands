# Vivo BI Platform — UX Audit
*Walked 24 Apr 2026 by E1 (wearing UX-strategist + Stephen-the-CFOO hats)*

> **The standard I'm auditing against**: *A great BI platform is not a mirror of the data — it is a trusted colleague. It notices what matters, whispers what's urgent, celebrates what's working, and always, always suggests what to do next.*
>
> I walked every page, ran the 5-second test, the coffee-in-hand test, the "CEO just walked in" test, and the "So what?" interrogation. Below is the truth — ungentle, specific, and actionable.

---

## 🔑 Executive Summary — Top 10 Highest-Impact Fixes

Ordered by **impact ÷ effort**. If you do only these ten, the platform becomes demonstrably smarter.

| # | Fix | Pages | Effort | Why it matters |
|---|---|---|---|---|
| **1** | **Fix the Customer "Avg Spend" scale bug** (shows ▲ 880.7% — KES 117,080 vs KES 11,939 previous). This is the single largest trust-killer on the platform. A CFOO will spot it in 3 seconds and stop trusting every number that follows. | Customers | S | **Credibility** |
| **2** | **Kill or hide dead-zero tiles** ("Churn Rate 0.00%", "Sales / Visitor KES 0" on CEO report, "0 Churned Customers"). Either compute them or don't show them. A KPI that says 0 with no explanation is noise. | Overview, Customers, CEO | S | **Signal density** |
| **3** | **Every KPI card gets a primary action.** Today they're passive numbers. `1,609 New` → button "See the list". `50 styles to re-order` → button "Export PO draft". `578 low-stock` → button "Go to Re-Order". No metric without a next step. | All | M | **Observation → action** |
| **4** | **"What changed since you last visited?"** A top-of-Overview belt: new records, new churn, new stockouts, new records broken. Cold-start → warm-start. | Overview | M | **Retention / return visits** |
| **5** | **Action states on Re-Order & IBT** — "Sent to PO queue", "Dispatched", "Dismissed — reason:…". Currently static lists rot. A recommendation the user processed yesterday still appears today. | Re-Order, IBT | M | **Operational close-loop** |
| **6** | **Global search** — a ⌘K palette to jump to a style, a SKU, a customer, a store, or a page. Right now everything is a filter; nothing is "take me straight there". | Shell | M | **Speed-to-answer** |
| **7** | **Filter bar inconsistency** — CEO Report still shows the Compare toggle but the page hard-codes LM/LY regardless; Footfall page shows "Compare vs Yesterday" (meaningless for month views). Scope the filter bar per page. | All | S | **Trust / cohesion** |
| **8** | **Product page needs thumbnails.** Fashion teams cannot discuss "Vivo Zola V Neck Maxi Dress in Crepe" in a spreadsheet. One 48×48 image per row changes the entire review experience. | Products, Re-Order, IBT | M | **Domain fit** |
| **9** | **Footfall conversion outliers** (Vivo Junction 54.6%, Zoya Sarit 5.3%) — the Conversion chart doesn't flag broken counters or tiny-sample noise. Add a data-quality pill ("⚠ counter calibrating"). | Footfall | S | **Credibility** |
| **10** | **Every subtitle in every table ends in an action verb.** Today most are descriptive ("Showing top 20 customers ranked by…"). Make them directives: "Here are 20 customers worth a thank-you call today." | Customers, Products, Inventory, Re-Order | S | **Tone / dopamine** |

---

## 📑 Page-by-Page Reports

### 1 · 🏷️ Overview
**🎯 Goal**: "How are we today, at a glance." The landing page a CFOO opens at 6am.

**✅ What's working**
- Daily Briefing card with personalized greeting, visit-streak 🔥, day-of-week flavor, and 2–4 narrative bullets is genuinely the best thing on the platform. It answers "What matters right now?" in one breath.
- Leaderboard strip with streak + 🏆 NEW RECORD is delightful and defensible.
- Stores of the Week recap does exactly what the CEO-walked-in test needs.

**⚠️ What's confusing**
- Six KPI tiles (Sales / Orders / Units / ABV / ASP / MSI) at the top — after the briefing already synthesised the story. It's a second, colder version of the same news. Consider **one row of tiles above the fold, a "More KPIs" collapse below.**
- Compare deltas appear in two places (Briefing + tiles). The briefing wins emotionally, the tiles win precisely — but together they create déjà-vu.
- "Updated just now" / "Updated —" status is the only loading feedback for the whole page. If one API is slow the whole shell pretends nothing is happening.

**❌ What's failing**
- The KPI tiles don't drill down. Tapping "ORDERS 8,589" should go *somewhere*. It's a dead number.
- Sales Projection card is useful but silent when there's no target configured (which is always). Kill it until targets exist OR surface "📍 Set a target" CTA.

**🎬 Missing CTAs**
- Every KPI tile needs a secondary action: `Sales → Compare to target` · `Orders → Break down by channel` · `Units → Top movers`.
- Briefing bullets should link. "Total sales up 5% vs Last Month" should deep-link to Locations filtered to the period.

**💡 What's missing**
- **"What changed since you last logged in"** row. Delta-over-delta. The single highest-ROI addition on the whole platform.
- A **daily target progress ring**. Even a self-set "aim for KES 3M today" ring would make the page feel alive.
- **Anomaly flag row** — "3 stores are outside their normal band today". Quiet, unobtrusive, but the user knows instantly where to look.

**🧭 Navigation & flow**
- From Overview you can only navigate via the top tabs. No card says "see more" or "drill in". It's a poster, not a doorway.

**🎨 Visual & emotional read**
- Warm, clean, confident — this is the part of the platform that already feels like a colleague. Preserve the tone; it's the template for the rest.

**📱 Mobile reality check**
- Briefing works. KPI tiles wrap to 2-up and stay legible. Leaderboard strip wraps well. Good.
- Charts below are fine; the Recharts footfall bar label clipping was fixed in a prior session. ✓

**🏁 Headline recommendation**
> **Delete the six KPI tiles and replace them with one "What changed since yesterday" row + a one-line headline metric.** The briefing already told the story; the tiles dilute it.

---

### 2 · 🏷️ Locations
**🎯 Goal**: "Which stores are winning, which are slipping, what do I do about it." The store-ops page.

**✅ What's working**
- Winner chips with flame streaks + NEW RECORD pill is the best piece of gamification in the product.
- Sort-by pills (Total Sales / Orders / Units / ABV / ASP / MSI) are fast and thumb-reachable.
- Country flags + 🌐 for Online is clear.

**⚠️ What's confusing**
- 7 metrics per card × 31 stores = 217 numbers on one screen. The CFOO cannot hold them. **Collapse ABV / ASP / MSI behind a "Deep dive" toggle** — they matter to a buyer, not at a group glance.
- "MSI 2.03 ▼ -2.1%" — a CFO opens with "what's MSI again?" Add an inline ℹ tooltip consistently on every metric label.

**❌ What's failing**
- No map view. For 31 locations across 3 countries + online, a heat-map or at least a country-grouped accordion would beat a flat scrollable list.
- Clicking a store does nothing — no deep-drill into that store's own sub-dashboard. This is the single biggest missed opportunity on the platform. **Each store should open a slide-over with its sales trend, footfall trend, top styles, top customers, and staff leaderboard.**
- "Total Locations 31" tile: passive, never changes, should be removed or turned into "28 counted + 3 online".

**🎬 Missing CTAs**
- Each card needs an action row: `📞 Call manager` · `📋 Open store deep-dive` · `✉ Share snapshot to WhatsApp`.
- Leaderboard chips are clickable; good. But winners don't get a celebratory deep-dive — just scroll to their card. Give them a modal: *"Here's why Vivo Sarit is crushing it this month."*

**💡 What's missing**
- **Staff leaderboard** per store (if Vivo captures cashier IDs on tickets).
- **Store-level CR × ABV quadrant chart** — "high traffic, low converter" stores pop instantly.
- **"Manager's shift" view** — today's live pulse for that location.

**🧭 Navigation & flow**
- Doesn't cross-link to Footfall, Customers, or Products for the clicked store. Every store card should have `Footfall ↗ · Customers ↗ · Products ↗` tertiary links that carry the filter through.

**🎨 Visual & emotional read**
- Solid. Chips feel like reward. ▲/▼ ▼▲ color logic is consistent. The only anxious bit: "RETURNS ▲ +135.6%" at Vivo Sarit — shown in red, which is correct, but without a "so what" note, it just worries.

**📱 Mobile reality check**
- Cards stack well. 7 metrics per card get dense — another argument for collapsing the bottom three.

**🏁 Headline recommendation**
> **Make every location card open a 1-screen store deep-dive modal.** Right now the page is a leaderboard, not a workbench.

---

### 3 · 🏷️ Footfall
**🎯 Goal**: "How many people came in, how many converted, where's the leak." Store-ops conversion tool.

**✅ What's working**
- The header disclaimer ("Upstream footfall counters cover physical stores only…") is honest and well-placed.
- The conversion chart with group-average baseline is a genuinely good idea.
- Location-level breakdown table with Δ pp conversion is the most useful table on the platform.

**⚠️ What's confusing**
- **Vivo Junction 54.6%** conversion is ~4x the group average — clearly a broken counter or tiny sample, but the chart shows it as the top performer in green. **Any value outside 2σ should pill as "⚠ data-quality: verify counter".**
- "Zoya Sarit 5.25%" bottom — is that a low performer or a counter miscalibrated for a store that also sells wholesale? The dashboard doesn't say. Add **segment tags** (Retail / Wholesale / Hybrid).
- "AVG BASKET VALUE KES 8,741" on this page — why here? It's already on Overview and Locations. Remove; it doesn't tell a footfall story.

**❌ What's failing**
- No **time-of-day** heatmap. Every store manager wants "which hour is our peak". If the upstream API exposes per-hour footfall, this is one chart away.
- No **dwell time × conversion** scatter. Footfall without context is just foot traffic.
- "STORES CONVERSION RATE 12.84%" — fine number, but it's `orders ÷ footfall` for physical stores only. The tile doesn't say that; the subtitle does. Unify: KPI tile must tell its own story in one line.

**🎬 Missing CTAs**
- Each row of the conversion table should offer: `📞 Call manager` (low CR), `🎥 Replay staff coaching video` (if below benchmark by -3pp), `📈 See what high-CR stores do differently`.

**💡 What's missing**
- **Sales per visitor** (not just per order). Two stores with equal CR can have very different basket values.
- **Weekly pattern chart** — Tuesday is dead for everyone; which store breaks the pattern?
- **Anomaly alert**: "Vivo Eldoret had 2x its normal footfall yesterday — find out why."

**🧭 Navigation & flow**
- No deep link from a store's row to that store's Location card or Customers view.

**🎨 Visual & emotional read**
- Calm, readable. The green-above-average / red-below-average convention works. But Vivo Junction in green at 54.6% actually undermines trust — it feels like the dashboard isn't thinking.

**📱 Mobile reality check**
- The 29-store horizontal bar charts get cramped on mobile. Consider switching to a top-10 + "see all 29" collapse on narrow screens.

**🏁 Headline recommendation**
> **Add a time-of-day heatmap and flag data-quality outliers.** The conversion tool is the page with the most untapped operational value on the whole platform.

---

### 4 · 🏷️ Customers
**🎯 Goal**: "Who are our people, who's churning, who's worth calling today." CRM-lite.

**✅ What's working**
- Active / New / Returning split with share % and pp delta is an excellent KPI tile set.
- Customer Trends narrative table is a huge upgrade over raw numbers.
- Loyalty distribution chart with prior-period overlay is beautiful.
- Reactivation Opportunity (🔥 Hot / 🌡 Warm / ❄ Cold priority) is genuinely a CRM feature, not a report.

**❌ What's failing — and this is SERIOUS**
- **"Avg Spend / Customer ▲ 880.7%"** — KES 117,080 vs KES 11,939. This is visibly a data scaling bug (current window aggregation vs per-period average mismatch). Shown in green with a ▲. **Every sophisticated user will spot this in 3 seconds and lose faith in every number on the platform.** FIX BEFORE THIS PAGE IS SHOWN TO ANYONE SENIOR.
- **"Churn Rate 0.00%"** for the current window with a 90-day cutoff — mathematically will always read 0 or near-0. Kill the tile in the current-period view; show it only when the window ≥ 90 days. Or reframe it as "Customers at risk (55+ days since last order)".
- **"Stores sharing customers"** table — every row shows "1 shared · 2.0% overlap". That's noise, not insight. Either raise the threshold to show only overlaps ≥ 5 customers, or remove the section entirely. Right now it's a confidence-drain.

**⚠️ What's confusing**
- The ⚠️/✅ icon in the PROFILE column has no legend. Users guess it's "contact info present". Add a legend row above the table.
- "🆕" badge on EVERY row of Top 20 — if everyone's new then nobody is. The badge has no signal value. Make it conditional (e.g., "entered top 20 this period").
- "DAYS SINCE" column is great but the "LAST PURCHASE" date next to it is redundant. Pick one.

**🎬 Missing CTAs**
- **Top 20 needs bulk actions.** Select checkbox rows → "📧 Export to Mailchimp" / "📱 Send WhatsApp template" / "🎁 Add to VIP list".
- Every 🔥 Hot reactivation row should have a **big orange "Call now" button**, not just a 📞 emoji.

**💡 What's missing**
- **Customer cohort trend** — "Customers acquired in Jan are worth X vs Feb customers worth Y". Retailers live for this.
- **Customer segments filter** — "show me everyone who's a 4+ order VIP in Uganda".
- **"First-time customer" product-mix on hover** — hovering any store's "new customers %" should pop a top-3 styles mini-card.

**🧭 Navigation & flow**
- Customer lookup search promises "click a result to open their full purchase history" — a profile deep-dive exists. Good. But the profile drill is buried; surface it as a column button on every table instead of just the search box.

**🎨 Visual & emotional read**
- The best page on the platform *emotionally*: it treats customers as people, not rows. But the **scale bug and the churn=0 tile make it feel unfinished**. Fix the bug and this is the flagship page.

**📱 Mobile reality check**
- Top 20 table has 12 columns — unusable on mobile without a horizontal scroll. Switch to a card-per-customer layout below 768px.

**🏁 Headline recommendation**
> **Fix the Avg-Spend scaling bug today, retire the Churn-Rate-0 tile, and turn the Top 20 into a CRM action pane with bulk send-to-campaign.**

---

### 5 · 🏷️ Products
**🎯 Goal**: "What's flying, what's sinking, what's the mix." The buyer's page.

**✅ What's working**
- Category + subcategory performance tables with ABV/ASP/MSI deltas are commercially dense and well-organized.
- Stock-to-Sales variance tables with green/yellow/red tiering land immediately.
- Risk flags are colored by *business meaning* not math — great discipline.
- Rogue-category suppression is doing its job: I didn't see "Sets & Bodysuits" anywhere today. ✓

**⚠️ What's confusing**
- Two variance tables (Stock-to-Sales by Category + by Subcategory) live directly above two performance tables (by Category + by Subcategory) with similar headers. It reads like duplication until you squint. **Merge into one accordion** or put them in separate tabs.
- "MSI" is introduced mid-page without a glossary on this page — the legend sits only under the category-performance table.

**❌ What's failing — for a fashion retailer**
- **No image thumbnails.** A fashion buyer cannot discuss SKUs as text. One 48×48 swatch per row would double the engagement.
- **No "new vs in-line vs EOL" tags** — every row is undifferentiated.
- "STYLES TRACKED 200" tile is meaningless unless you know the denominator.

**🎬 Missing CTAs**
- Each row should have: `👁 View style` · `📦 Add to re-order` · `🏷 Plan markdown` · `💱 Check IBT candidates`.
- Understocked categories (Maxi Dresses +3.2% variance) need a one-click "Go to Re-Order filtered to Maxi Dresses" button.

**💡 What's missing**
- **Pricing changes tracking** (already on your P1 backlog — prioritize this; it's a known gap).
- **Margin %** per product (Phase 2; defer until Odoo cost feed lands).
- **New-style launch radar** — "these 5 styles launched last week, here's how they're trending".
- **Size/color deep-drill** — which color sold out first? Buyers live for this.

**🧭 Navigation & flow**
- Products ↔ Inventory ↔ Re-Order ↔ IBT is actually a coherent funnel in your head, but the pages don't know about each other. Cross-link: from Products, a critical low-stock style should show `→ Re-Order · → IBT candidates` inline.

**🎨 Visual & emotional read**
- A little spreadsheet-y. With no images it feels like SAP. Fashion teams will tolerate it; they won't *love* it.

**📱 Mobile reality check**
- Wide tables with 9 columns aren't usable on mobile. Either horizontal-scroll or drop 3 columns on small screens (keep Units, Sales, Variance).

**🏁 Headline recommendation**
> **Add image thumbnails. Everything else on this page ranks second to that.**

---

### 6 · 🏷️ Inventory
**🎯 Goal**: "Where is my stock sitting, what's over, what's under." The warehouse-and-floor view.

**✅ What's working**
- Header disclaimer (Accessories/Sample/uncategorised excluded) is honest and well-placed.
- Stock-by-location bar chart shows warehouse concentration (Warehouse Finished Goods 29,882) vs store-floor stock at a glance. Excellent.
- Low-stock alerts table is genuinely actionable.
- Understocked subcategories mini-table with SOR is exactly what a buyer wants.

**⚠️ What's confusing**
- **Inventory page loads slowly** (several seconds with "Counting the stock…" spinner). For a page the user opens multiple times per day, this is a retention killer. The skeleton is fine; consider a stale-while-revalidate pattern.
- Two Stock-to-Sales tables (Category + Subcategory) repeat content from the Products page. Pick one place to live.
- "LOW-STOCK STYLES (≤10) 578" — 578 is a big number. What should the user do with 578 styles? There should be an immediate "🛠 Start triage" button.

**❌ What's failing**
- "Inventory by Category" + "Inventory by Subcategory" as separate bar charts. Merge into one drill-down chart.
- No **aging** view (stock by weeks-on-hand). Merchandise that hasn't moved in 60+ days is the single most expensive signal in retail and it's absent here.
- No **SKU-level search** at the top to jump straight to a product's stock distribution.

**🎬 Missing CTAs**
- Each understocked row: `→ Replenish · → IBT candidates`.
- Each low-stock row: `→ Re-Order · 📞 Alert manager`.
- Each stock-by-location bar: `→ Show top styles here · → Transfer out`.

**💡 What's missing**
- **Stock aging / weeks-on-hand** (the single biggest gap).
- **Sell-through rate per location** (units sold ÷ stock-at-start-of-period).
- **"Phantom stock" flag** — stock-on-hand > 30 but units sold = 0 over 30 days.

**🧭 Navigation & flow**
- Doesn't bridge to Re-Order or IBT naturally. Each understocked subcategory should link into those pages pre-filtered.

**🎨 Visual & emotional read**
- Clean, a bit inventory-officer-y. The gradient ring on tiles could celebrate "100% of critical SKUs replenished" when that's achieved.

**📱 Mobile reality check**
- Table-heavy. Stock-by-location chart becomes unreadable under 600px. Use a top-10 collapse.

**🏁 Headline recommendation**
> **Add weeks-on-hand aging and link understock rows directly into Re-Order / IBT.** Turn this page from a snapshot into a triage console.

---

### 7 · 🏷️ Re-Order
**🎯 Goal**: "Which new styles are flying and need more stock NOW."

**✅ What's working**
- Focused, unambiguous rule (launched <90d, SOR ≥ 50%). The page does one thing.
- Urgency pills (CRITICAL / HIGH) with clear SOR thresholds — beautiful.
- Style-name click → SKU-level detail is a strong drill-down.

**⚠️ What's confusing**
- The tile "STYLES TO RE-ORDER 50" is capped at 50 — is that the total or a top-N? Say so.
- "CRITICAL · SOR ≥80% 11" and "HIGH · SOR 65–80% 22" add to 33, leaving 17 as Medium — but there's no Medium tile. Add one.

**❌ What's failing**
- **Nothing closes the loop.** Nothing says "which styles have we already re-ordered?" or "PO raised 2 days ago". The list is identical every session until SOR changes. The user has no memory of which recommendations they've acted on.
- No bulk select + "Export PO draft" / "Mark as processed".
- No estimated re-order quantity (just current stock). Buyers would kill for "suggested PO qty = units sold over last 30d × safety factor".

**🎬 Missing CTAs**
- Per-row: `✅ PO raised` · `📋 Draft PO` · `❌ Dismiss (reason)` — with a visible history.
- Bulk: `📄 Export selected as PO draft CSV` / `Mark selected as processed`.

**💡 What's missing**
- **Suggested re-order qty** per style.
- **Lead time × current stock runway** — "at current pace, stock lasts 6 days; supplier lead time is 14 days → gap".
- **Margin impact** of lost sales if we don't re-order.

**🧭 Navigation & flow**
- Click style → opens SKU-level drawer. Good. But where's the link to the IBT page to check "can we transfer from an overstocked store first before re-ordering new"? Cross-link.

**🎨 Visual & emotional read**
- Serviceable, a bit utilitarian. Critical/High pills in bold red/amber land well.

**📱 Mobile reality check**
- 9-column table = horizontal scroll on mobile. Consider collapsing to a card-per-style below 768px with the top 3 fields visible and a tap-to-expand.

**🏁 Headline recommendation**
> **Turn this from a list into a workflow. "PO raised / Draft PO / Dismissed" state on every row — persist it in Mongo per user.** Otherwise the page is a groundhog day.

---

### 8 · 🏷️ IBT (Inter-Branch Transfer)
**🎯 Goal**: "Move surplus stock where it'll sell." The operational redistribution page.

**✅ What's working**
- Rule statement at the top is crystal clear (from-store ≤ 20% avg, to-store ≥ 150% avg).
- "From" and "To" columns show both stores' stock + sold figures — the *reason* for the move, not just the move. Excellent.
- Est. revenue uplift tile (KES 12.47M) is a headline that sells the page's value instantly.

**⚠️ What's confusing**
- 300 suggested moves is a lot. The top 20 would move 50% of the value — surface that clearly.
- "Stores involved 26" — tile doesn't convert to action.

**❌ What's failing**
- **Same workflow gap as Re-Order**: no status per move. "Dispatched / Received / Rejected / Dismissed". Without it, the list never ages.
- No **logistics cost awareness** — moving 10 units from Rwanda to Nairobi may cost more than the uplift. A "net uplift after move cost" column would be gold.

**🎬 Missing CTAs**
- Per-row: `📦 Confirm move` · `🗓 Schedule dispatch` · `❌ Dismiss`.
- Bulk: `📄 Export consolidated move manifest by store`.

**💡 What's missing**
- **Stackable manifests** — group all moves from Vivo Kigali Heights into one dispatch list.
- **Time-to-impact** — "moving this today means Galleria stocks it by Friday".
- **Route optimization** — if KGL→Sarit and KGL→Galleria both pass Nairobi, consolidate.

**🧭 Navigation & flow**
- No cross-link to Re-Order. The decision tree ("transfer before re-ordering") must live somewhere.

**🎨 Visual & emotional read**
- The style-with-green-arrow-between-stores row design is *the best row design on the platform*. Keep it as a pattern.

**📱 Mobile reality check**
- From/To pair is hard to read on narrow screens. Stack vertically with a ↓ on mobile.

**🏁 Headline recommendation**
> **Add move state (`dispatched / received / dismissed`) persisted per user + a "Consolidated manifest by origin store" export.** Make the page close the loop.

---

### 9 · 🏷️ CEO Report
**🎯 Goal**: "A weekly one-pager Wandia reads before the leadership meeting."

**✅ What's working**
- Numbered sections (1–10) with clean headers read like a real report, not a dashboard.
- Country performance + returns section are exactly what a CEO wants.
- Rising Stars #1/#2/#3 card section with ⚡ Double-down tag is the best narrative device on the platform. Keep the pattern.
- Print/Export PDF button placed prominently. The page is print-shaped, which matters.

**❌ What's failing**
- **"Section 8 · Footfall & Conversion" shows Sales / Visitor = KES 0 on every row.** That's a visible bug and it lives in the CEO's report. Either compute it (total_sales ÷ footfall per store) or remove the column. This hurts credibility more than any other single issue.
- **Section 6 "SOR: Stars & Slow Movers"** shows `LM —` and `LY —` for every tile. That means "no comparison computed" — but the user reads it as "no change", which is different. Either compute or hide the comparison suffix.
- **Section 10 "Executive Insights"** is two sentences of heuristic text. Fine, but a CEO expects *interpretation*, not summary. Rewrite with GPT-generated narrative: "Kenya continues as the engine (80.5%). Uganda's 30% monthly lift is your fastest-compounding territory — worth a capital allocation conversation. Online basket-size drop is the one red flag; likely mix shift, confirm with marketing."

**⚠️ What's confusing**
- Compare toggle in the filter bar is still visible but this page hard-codes LM + LY. Either honor the toggle or hide it on this page.
- Uganda's ▲ +174.9% YoY — likely low-base effect (a store opened). Flag as "new store contribution" rather than celebrating a number that won't repeat.

**🎬 Missing CTAs**
- "📧 Email to exec list" button (one-click Monday 6am send to wandia@, stephen@, …).
- "📞 Book 15-min walkthrough" — small one-line CTA for Wandia to ask a question on any section.

**💡 What's missing**
- **Three-forecast scenarios** — low / mid / high end-of-month projection.
- **Risk register** — "returns at Online - Shop Zetu 17.3% is 5× group average, investigate".
- **Winner callouts** — a "Name & Number" sidebar: Top manager, Top new style launch, Top growth country.

**🧭 Navigation & flow**
- Deeply linkable sections (e.g., #ceo-returns, #ceo-rising-stars) would help executives share specific lines.

**🎨 Visual & emotional read**
- Formal, confident, but sterile. A CEO report is allowed to have warmth — one short headline per section ("Section 3 · Top 10: *Online keeps leading; physical gaining ground*.") would transform it.

**📱 Mobile reality check**
- It's print-shaped. On mobile it's a long scroll. That's acceptable for this specific page.

**🏁 Headline recommendation**
> **Fix the KES 0 Sales/Visitor column, rewrite Section 10 as real narrative, and add a one-click "📧 Send to leadership" button.** This becomes the page that makes the CEO recommend the tool.

---

### 10 · 🏷️ Exports
**🎯 Goal**: "Raw data for offline work / audit / Odoo reconciliation."

**✅ What's working**
- Honest scope ("Up to 5,000 lines per query") — respects the user.
- Tabs Sales / Inventory separate the two bulk exports.
- Per-line detail (order, SKU, color, size, customer kind) is complete.
- "Show all (809)" collapse is correct.

**⚠️ What's confusing**
- KPI tiles (Lines / Orders / Qty / Gross / Discount / Net) are useful but "DISCOUNT KES 0" in red suggests something's wrong when in fact it's an empty column because no discounts were applied. Neutralize the color.
- "Sale Kind: Orders & returns" vs just "orders" — the table column "KIND" shows "order" on every row. Where are the returns?

**❌ What's failing**
- No **column picker** — 18 columns always shown, many irrelevant to a given query.
- No **saved queries** — a finance user exports the same filters daily. Saving "My Month-end Sales export" would save real time.
- No **Odoo-reconciliation helper** — the one use case exports are clearly built for. A "Compare to Odoo" bar would be huge.

**🎬 Missing CTAs**
- Per-row: `📋 Copy order number to clipboard`.
- Header: `💾 Save this view as…` · `📧 Email when ready (async for > 5k rows)`.

**💡 What's missing**
- **Async export for > 5k rows** with an email link when ready.
- **Scheduled exports** — "send me yesterday's sales export every morning at 8am".
- **Column picker + column order persistence**.

**🧭 Navigation & flow**
- The Exports page should be the "final mile" of every other page. Every chart should have a "📥 Export this data" button that deep-links here with the filters pre-applied. Today it's a separate silo.

**🎨 Visual & emotional read**
- Honest, functional. A data page is allowed to feel like a data page. No complaint.

**📱 Mobile reality check**
- 18-column tables are unusable on mobile. That's fine — this is a desktop page. But put a "Better on desktop" pill at the top on narrow screens.

**🏁 Headline recommendation**
> **Add saved queries, column picker, and an async "email me when ready" for large exports.** These three things turn Exports from a feature into a daily habit.

---

## 🧵 Cross-Cutting Themes

### A. Observation-without-action
**Every single page is guilty.** KPI tiles, chart bars, table rows — almost none of them have a CTA beyond "export CSV". The dashboard *shows*; it doesn't *propose*. This is the single most repeated failure pattern. Fix in one pass by adopting **the Metric-Action Contract**: every metric component must accept an `action` prop and render a CTA pill.

### B. No memory
**The platform forgets everything.** It doesn't know what you looked at yesterday, which recommendations you've processed, whether you've acted on a re-order, or what you filtered to last time. This is the **second-largest UX gap**, behind the observation-without-action problem. Add per-user state for: last view, last filters, processed recommendations, dismissed alerts, pinned items.

### C. Inconsistent filter scope
- CEO Report shows Compare toggle but ignores it.
- Footfall shows "vs Yesterday" compare which is meaningless for month views.
- Products / Inventory / Re-Order all use the same global filter, but each page's semantics differ ("stock as-of today" vs "sales over window").
**Fix**: Each page registers which filter dimensions apply; the filter bar auto-hides the rest. And the filter bar should show a tiny "applies to: [Sales window]" tooltip.

### D. Data-quality opacity
Multiple places show numbers that are clearly wrong but not flagged:
- Customer Avg Spend ▲ 880.7%
- Footfall conversion 54.6% at Vivo Junction
- CEO Sales/Visitor all KES 0
- SOR `LM —` / `LY —` without explanation

**Fix**: every KPI value gets a confidence/quality state. If confidence is low, show a pale ⓘ pill on the number with a tooltip: "Low confidence — period data mid-refresh" or "Counter under calibration".

### E. Mobile is a second-class citizen
Most pages have wide tables that become horizontal-scroll on phone. The CFOO on the matatu **cannot** use those tables. Introduce a rule: **any table with > 5 columns gets a mobile card view below 768px**. The shell is already responsive; the tables are not.

### F. No celebration beyond the Overview
Overview got a proper "dopamine pass" (briefing, leaderboard, NEW RECORD, Stores of the Week, confetti). The rest of the platform is sober. Propagate:
- **Locations**: confetti on a store that broke its own record.
- **Customers**: a quiet "👑 New VIP unlocked" notice when a customer crosses 5+ orders.
- **Products**: a "⚡ Rising star" ribbon on new styles with SOR > 70% (exists on CEO Report — surface it on Products too).
- **Inventory**: a quiet "0 critical stockouts today" green-state celebration when the list is empty.

### G. Visual density — too many tiles
Every page opens with 4–8 KPI tiles. **Cut ruthlessly.** A user's eyes hit 3 tiles in 2 seconds. The 4th–8th tiles are ignored. Pick one headline + two supporting tiles per page.

### H. No notifications
No bell, no alerts, no "we noticed X happened". The platform is strictly *pull*. For retention — and for the "trusted colleague" standard — it must become *push* for a narrow, curated set of events: record broken, store slipping, new stockout, new VIP.

---

## 🎭 Persona Journey Maps

### Stephen — CFOO — 6 am, pre-board
*Needs in 30 seconds: Are we healthy? What's at risk? What do I tell the board?*

- ✅ Opens Overview — Daily Briefing gives him the answer in 3 bullets. **This works.**
- ❌ Wants to know: "did we hit our monthly target?" → no target is configured, no ring, no signal. **Break.**
- ❌ Wants to know: "what's new since yesterday?" → no delta-since-last-visit surface. **Break.**
- ✅ Scrolls to Leaderboard + Stores of the Week. Feels confidence.
- ❌ Jumps to CEO Report to print for the board. Sees "Sales / Visitor KES 0". **Trust break.**
- ❌ Tries to click "Total Orders 8,589" expecting a breakdown. Nothing happens. **Break.**

**Verdict**: 6/10 — Overview saves him, CEO Report embarrasses him.

### Vivo Sarit Store Manager — 9 am, opening
*Needs: How did we do yesterday? What's moving? Who's my big customer today?*

- ❌ Logs into a group-level dashboard. No "store manager" mode. Has to filter to their store every time. **Break.**
- ❌ Wants per-cashier leaderboard — doesn't exist. **Break.**
- ✅ Finds their location card on /locations with clear deltas.
- ❌ Can't click it to drill into store-specific trends. **Break.**
- ❌ Can't see a VIP list for *today's* expected visitors. **Break.**

**Verdict**: 3/10 — this page was designed for head office, not the floor.

### Buyer — mid-week, planning next order
*Needs: What flew, what flopped, what's new-customer-magnet, what's my margin?*

- ✅ Products page + Re-Order page + IBT page tell a coherent-ish story.
- ❌ No product thumbnails. **Break.** (Fashion buyer specifically.)
- ❌ No margin data. (Known — Phase 2.)
- ❌ No "tried-not-bought" signal (what did people pick up and put down?). **Break.**
- ✅ Rising Stars in CEO Report helps.
- ❌ No way to mark "PO drafted" so the re-order list regenerates clean. **Break.**

**Verdict**: 5/10 — all the data is here, none of the workflow.

### Marketing Lead — Friday, planning next campaign
*Needs: who are my VIPs, who's churning, who can I win back, who did new customers love?*

- ✅ Customers page is their page. Reactivation Opportunity with Hot/Warm/Cold is a real CRM feature.
- ❌ No bulk actions (export to campaign tool, send WhatsApp, etc.). **Break.**
- ❌ Scale bug on Avg Spend breaks trust. **Break.**
- ❌ No cohort view. **Break.**
- ✅ New-vs-Returning product mix with Acquisition Skew is clever.

**Verdict**: 6/10 — best tool on the platform for this persona, undermined by the scale bug.

### Wandia — CEO — Thursday evening
*Needs: Are big bets paying off? Where are we winning / bleeding?*

- ✅ CEO Report is structured for her.
- ❌ Section 10 "Executive Insights" is a two-sentence auto-summary, not real interpretation. **Break.**
- ❌ Sales/Visitor KES 0 column. **Break.**
- ❌ No forecast / scenario section. **Break.**
- ❌ No "send to exec team" button. **Break.**

**Verdict**: 7/10 — the bones are right; the narrative layer is missing.

### Internal Auditor — monthly
*Needs: does this tie to Odoo? any anomalies? can I trust it?*

- ✅ Exports page is complete and honest.
- ❌ No "vs Odoo" reconciliation helper. **Break.**
- ❌ No anomaly register / data-quality panel. **Break.**
- ❌ No audit log visibility from the finance side (exists for admin only).

**Verdict**: 5/10 — the data is exportable, the trust-scaffolding is absent.

---

## 🪜 Prioritized Action List

### 🔥 Do this week (P0)
1. **Fix the Customer Avg-Spend 880.7% scale bug.** Nothing else you do matters until a CFOO can trust the numbers.
2. **Fix CEO Report "Sales / Visitor KES 0"** column (compute or remove).
3. **Hide / reframe 0.00% Churn tile** when the selected window is shorter than the churn-cutoff.
4. **Remove or re-threshold the "Stores sharing customers"** table (currently always "1 shared · 2%").
5. **Flag footfall outliers** — Vivo Junction 54.6% CR needs a "⚠ verify counter" pill.

### 🎯 Do this sprint (P1)
6. **Metric-Action Contract.** Every KPI tile accepts an `action={{label,onClick}}` prop; every tile gets a primary CTA.
7. **Persistent state on Re-Order + IBT** — Mongo-backed `user_action_log` with `processed / dismissed / done` per recommendation row per user.
8. **"What changed since your last visit"** belt on Overview.
9. **Product thumbnails** on Products, Re-Order, IBT tables.
10. **Pricing Changes Tracking** (already on backlog — do it now, user asked for it ages ago).

### 💎 Do this quarter (P2)
11. **Global ⌘K search** across stores, styles, customers, pages.
12. **Store deep-dive modal** from any location card.
13. **Stock aging (weeks-on-hand)** on Inventory.
14. **Mobile card-views** for every table > 5 columns.
15. **Notifications bell** with a curated event set (records, stockouts, VIP unlocks, counter anomalies).

### 🔭 Nice to have (P3)
16. Time-of-day footfall heatmap.
17. Async email-when-ready for large exports.
18. Saved queries on Exports.
19. Per-cashier leaderboard (Store Manager mode).
20. Scenario forecasting on CEO Report.

---

## 🎁 Delight Debt Log — Where warmth is missing

| Page | Moment | Current | Could be |
|---|---|---|---|
| Overview | Empty-slate (new user, no data yet) | Blank | "Welcome, Stephen. Let's set your first daily target." |
| Locations | Store breaks its own record | nothing | Confetti + "🏆 Vivo Sarit just beat its Jan record!" |
| Customers | A customer crosses 5 orders | Nothing — they silently become "VIP" | Small toast: "👑 Maria Namusoke unlocked VIP today." |
| Products | New style hits SOR > 70 | Shows on CEO Report only | Ribbon on Products table + toast |
| Inventory | Critical list is empty | Empty state "—" | "🎉 Zero critical stockouts today. Nice." |
| Re-Order | User marks all 50 styles processed | nothing | Confetti + "50/50 recommendations closed. You're clear." |
| IBT | Dispatch manifest exported | toast "CSV downloaded" | toast "Manifest built — 300 moves across 26 stores. Safe travels 🚚" |
| CEO Report | Monday morning | nothing (user must open manually) | scheduled auto-email Monday 6am |
| All | First visit of the day | nothing | Briefing says "Welcome back — it's been 14 hours. Here's what moved." |
| All | Hitting a CSV export button | generic "download" | "✅ Export ready. Shared to you in Drive? [link]" |

---

## 🧭 The Final Word

The Vivo BI platform is already doing something most dashboards never manage: it has a **voice**. The Daily Briefing, the Leaderboard, the Stores of the Week — these are the early signs of a *trusted colleague*. What holds the rest back is observation-without-action and two or three serious data-quality bugs that erode trust the moment a senior user looks closely.

If you fix the five **P0** items this week and adopt the **Metric-Action Contract** across every page, this goes from "a solid dashboard" to "the one piece of software Stephen opens every morning before his coffee is poured."

That's the bar. It's reachable. It's within a month's work.

— E1
*Audited 24 Apr 2026*
