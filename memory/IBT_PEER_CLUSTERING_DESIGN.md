# IBT Peer-Cluster Model — Design

> Goal: replace the chain-wide "group average" used by the IBT engine with
> a **peer-cluster average** so a Vivo Sarit (high-traffic urban anchor) is
> compared to other Vivo Sarit-class stores, not to a small upcountry shop.

---

## 1 · Recommended approach — **hybrid: rule-based tier + k-means inside the tier**

Pure k-means is fast but un-explainable to merchandisers and prone to flipping a store between clusters when one outlier season lands. Pure rule-based tiers are explainable but rigid and miss "shape" similarity that drives true peer behaviour. We blend:

```
Layer 1 — Rule-based "structural tier" (3 tiers)
   ├── A · Anchor    : top quintile by 12-month gross revenue
   ├── B · Mid       : middle 60%
   └── C · Outpost   : bottom quintile
   (re-computed annually; merchandisers can override)

Layer 2 — k-means within each tier on a 6-feature behavioural vector
   (re-computed monthly with seasonal flag; cluster ids stable
    inside a season, may shift at season boundary)

Final cluster ID = Tier_letter + KMeans_cluster (e.g. A2, B1, C3).
```

**Why this works:**
- Tier is stable and obvious to merchandisers (revenue is the clearest currency).
- Within-tier k-means surfaces *behavioural* peers (Anchor stores that index small-size-heavy vs Anchor stores that index large-size-heavy don't get pooled).
- A new store joins via Tier rule + nearest-centroid assignment, no re-train needed.
- Cluster ids are short and quotable in trading reviews ("Sarit is in A2 — same as Junction and Yaya").

---

## 2 · Signal prioritisation

Prioritised list. Top 4 are the **mandatory** features used in production. Bottom 4 are **diagnostic** — surfaced in the cluster summary but not used in the distance metric (avoid noise / over-fitting).

### Mandatory features (k-means input vector — 6 dims, all z-scored)

| # | Signal | Why it matters | Data source |
|---|---|---|---|
| 1 | **ASP (avg selling price)** | Strongest single proxy for customer income tier. Two stores with the same ASP almost always serve the same socioeconomic segment regardless of geography. | `total_sales_kes / units_sold` over rolling 90 days |
| 2 | **Avg basket size (units / order)** | Separates "destination shopping" (3+ units) from "drop-in / single-piece" stores (≤1.5). Distinct customer mission. | `units_sold / unique_orders` over 90 days |
| 3 | **Category mix (top-3 categories' share of sales)** | A store that does 60% Loose Tops vs one that does 60% Wide Leg Pants has fundamentally different demand. Encoded as 3 separate features (% tops, % bottoms, % accessories) so two stores with similar splits cluster naturally. | Aggregate `total_sales_kes` per `product_type` over 90 days |
| 4 | **Size-curve centre-of-gravity** | Single number representing the "average size sold" — converts S/M/L/XL into ordinal weights (S=1, M=2, L=3, XL=4, 2XL=5) and computes the unit-weighted mean. A store at 2.2 indexes small; a store at 3.4 indexes large. Captures the physical demographic of the customer. | Aggregate `units_sold` per size bucket over 90 days |

### Diagnostic signals (NOT in distance metric — used for cluster validation only)

| # | Signal | Why diagnostic only |
|---|---|---|
| 5 | **Full-price sell-through %** | Strongly correlates with ASP and category mix already; adding it double-weights "premium-ness" and dilutes the other features. Use it to *describe* a cluster, not to define it. |
| 6 | **Days-to-first-sale** | Highly noisy on small samples (one slow style can swing a small store's average by 4 days). |
| 7 | **Return rate** | Often unavailable / unreliable upstream. |
| 8 | **Revenue seasonality (% Dec/Jan vs avg)** | Useful but autocorrelated with category mix in our dataset (bridal categories spike Nov/Dec; Loose Tops spike Apr–Aug). |

> **Rule of thumb**: 4 mandatory features over 90 days strikes the right balance — enough signal to find true peers, few enough that a trader can read the centroid and understand why a store landed in a cluster.

---

## 3 · How clusters feed the IBT rule

Today's rule (chain-wide average):
```
underperformer  := store_sell_rate ≤ 0.20 × chain_average_sell_rate
overperformer   := store_sell_rate ≥ 1.50 × chain_average_sell_rate
```

New rule (peer-cluster average):
```
peers           := stores in same cluster, excluding `store` itself
cluster_avg_sr  := median(peer.sell_rate)        # median, not mean — robust to outliers
underperformer  := store_sell_rate ≤ 0.20 × cluster_avg_sr
overperformer   := store_sell_rate ≥ 1.50 × cluster_avg_sr
```

**Sell rate per (style × store)** is computed exactly as today — `units_sold_in_window ÷ avg_inventory_in_window`. The only thing that changes is the denominator that we divide it by.

### Pair-eligibility check (additional guardrail)

When the engine pairs an underperformer with an overperformer for the actual move:

1. **Same cluster** is preferred. The pair gets a `cluster_match` flag = `True`.
2. If no overperformer exists in the same cluster, fall back to a "near cluster" — neighbouring tier letter (A↔B or B↔C) — and flag `cluster_match` = `False, cross_tier_pair` = `True`.
3. **Never pair across two tier jumps** (A↔C never happens). A bridal anchor's behaviour is too different from a satellite outpost's; transfers in either direction tend to dust-collect.

### Why median, not mean
A single outlier store (e.g. a brand-new Vivo Westgate ramping at 5× the cluster pace because it's launch month) would otherwise drag the cluster mean upward and falsely classify every other store in its cluster as an underperformer. Median is robust to this.

---

## 4 · Guardrails & edge cases

| Edge case | Behaviour |
|---|---|
| **Cluster has < 3 stores** | Auto-merge with the nearest cluster (smallest centroid distance) before computing the average. Re-tag the merged cluster as e.g. `A2+A3`. Flag in the IBT row so merchandisers know. |
| **Brand-new store (< 60 days of sales)** | Assigned to the cluster of its nearest tier-mate by ASP-only (single-feature k-NN). After 60 days it joins normal monthly re-clustering. |
| **Store that just changed format** (e.g. moved from concession to standalone) | Manual override flag in the `store_meta` collection — `force_cluster: "A2"`. Re-clustering job respects it. |
| **Closed / suspended store** | Excluded from cluster computation entirely so it doesn't pull the median. Read from existing `INVENTORY_EXCLUDED_LOCATIONS` constant. |
| **Online channels** | Already excluded from IBT; also excluded from clustering. |
| **A style sold in only one cluster** | If the underperformer's cluster has no overperformer for that style, escalate to the parent tier (A→A+B candidates) for the pairing step only. Never escalate the *classification* step. |
| **Cluster swap mid-month** | A store's `cluster_id` is frozen for a calendar month inside the IBT engine even if reclustering runs (to avoid "this morning the rule said move, this afternoon it doesn't" thrashing). New cluster takes effect on the 1st. |

---

## 5 · Refresh cadence

| Layer | Cadence | Rationale |
|---|---|---|
| **Tier (A/B/C)** | **Annually** | Aligns with ranges + lease cycle. Merchandisers can override in the `store_meta` collection any time. |
| **k-means within tier** | **Monthly**, with a soft season override | Behaviour shifts with seasons. Refreshing weekly causes thrash; quarterly is too slow for a fashion retailer. Monthly is the sweet spot. |
| **Season override** | First Monday of Mar / Jun / Sep / Dec | Seasonal feature window expands to **180 days** (instead of 90) at these refresh points so we don't lose memory of the previous season's pattern. |
| **Distance to centroid recomputed** | Daily (cheap) | Only the cluster *labels* are sticky; the per-store centroid distance is recomputed nightly so we can flag "drifting" stores in the trading review. |

### Stability test (commit-gate the re-cluster job)

Before swapping cluster ids, run a stability check:
- Compute Jaccard similarity between the new clusters and the old clusters (per-tier, per-pair).
- If any single store moved cluster AND > 30% of the cluster membership churned in one tier → halt, page the analytics owner. Almost always means a feature pipeline bug, not real behaviour change.

---

## 6 · Implementation plan (when you greenlight)

### 6a · Data layer
1. Nightly aggregation job → write per-store-per-day to `store_features_daily` collection. Fields: `asp_kes`, `avg_basket_units`, `pct_sales_tops`, `pct_sales_bottoms`, `pct_sales_accessories`, `size_centre_of_gravity`. Cheap: ~50 stores × 365 days × 6 floats.
2. Rolling 90-day aggregator → `store_features_90d` (one row per store). This is the matrix we cluster.

### 6b · Clustering job (`/app/backend/jobs/cluster_stores.py`)
1. Read `store_features_90d`, z-score each feature, drop closed stores.
2. Tier-assign by 12-month revenue percentile.
3. k-means inside each tier with `k = max(2, n_stores // 6)` so an A tier with 12 stores gets 2 clusters, with 24 stores gets 4. Cap at 5 per tier.
4. Stability check → if pass, write `cluster_id` per store to `store_meta` collection.
5. Persist a `cluster_run` audit doc with feature centroids, run timestamp, and Jaccard vs previous run.

### 6c · IBT integration
1. Replace `chain_avg_sell_rate` lookup in `analytics_ibt_suggestions` with a `cluster_avg_sell_rate` lookup from a join on `store_meta.cluster_id`.
2. New row fields surfaced on the IBT page: `cluster_id`, `cluster_match` (bool), `cross_tier_pair` (bool).
3. Add a small "Cluster" filter to the IBT page so a buyer can scope the list to one cluster.

### 6d · UX
- Cluster id (e.g. "A2") shown next to each store in the IBT table — small slate-coloured pill.
- Hover/tap reveals the cluster centroid in plain English: *"Cluster A2 · ASP KES 4,800 · basket 1.6 units · skews L/XL · 60% tops, 25% bottoms"*.
- A new admin route `/admin/store-clusters` to inspect the latest cluster run and override a store's tier.

---

## 7 · What to tell the merchandising team

> "From [date], the IBT recommendation engine compares each store against its true peers — same revenue tier, same customer pattern — instead of the chain average. A store is now flagged as underperforming on a style only if it's behind its peers, not behind the network's biggest stores. This means we'll move stock more accurately and avoid pulling slow-moving lines from genuinely-strong outposts."

---

## 8 · Open questions / decisions for the buying team

1. Do we want the cluster id to be visible on the **CEO Report** too (so the boss can scan top-performers within their cluster, not just chain-wide)? Recommended: yes.
2. Should a buyer be able to **override** a single IBT recommendation if they disagree with the cluster pairing? Recommended: yes — log the override to `recommendations_state` with reason text.
3. **First production cluster** — annual tier from FY-25 revenue. Spin up monthly k-means on first Mon of next month.

---

*Owner: BI / Analytics. Initial review with merchandising before any production cut-over.*
