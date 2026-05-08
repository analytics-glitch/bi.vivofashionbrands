"""Store peer-clustering job (Phase 1 — surface only, no IBT logic change).

Builds 90-day behavioural features per store, tier-classifies by 12-month
revenue percentile, then runs an explainable k-means inside each tier.

Designed per the spec in /app/memory/IBT_PEER_CLUSTERING_DESIGN.md.

Public entry-points:
    await run_clustering(orders_90d, orders_12mo, *, persist=True) -> dict
    await get_current_clusters() -> dict
"""
from __future__ import annotations

import math
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# Ordinal weights for the size centre-of-gravity feature. Anything not in
# this map is ignored (free-size, one-size, NA, etc).
_SIZE_WEIGHTS: Dict[str, float] = {
    "XS": 0, "XS/S": 0.5,
    "S": 1, "S/M": 1.5,
    "M": 2,
    "L": 3, "M/L": 2.5,
    "XL": 4, "L/XL": 3.5,
    "2XL": 5, "XXL": 5,
    "3XL": 6, "XXXL": 6,
}

# Three category buckets used for the category-mix features. Anything else
# rolls into "other" and is dropped from the share calculation.
_TOPS_KEYS = ("top", "blouse", "shirt", "kaftan", "dress", "kimono", "jumpsuit")
_BOTTOMS_KEYS = ("pant", "trouser", "skirt", "short", "jean", "leggings")
_ACCESSORIES_KEYS = ("accessor", "scarf", "bag", "belt", "jewel", "shoe", "footwear", "earring", "necklace")


def _bucket_for(category: str) -> Optional[str]:
    c = (category or "").lower()
    if any(k in c for k in _TOPS_KEYS):
        return "tops"
    if any(k in c for k in _BOTTOMS_KEYS):
        return "bottoms"
    if any(k in c for k in _ACCESSORIES_KEYS):
        return "accessories"
    return None


def _is_excluded_store(name: str) -> bool:
    if not name:
        return True
    n = name.lower()
    if "warehouse" in n or "online" in n or "shop zetu" in n or "studio" in n:
        return True
    if "wholesale" in n:
        return True
    return False


def compute_features(orders_90d: Iterable[dict], orders_12mo: Iterable[dict]) -> Dict[str, Dict[str, float]]:
    """Aggregate per-store features used by the cluster job.

    Returns:
        {store_name: {asp, avg_basket_units, pct_tops, pct_bottoms,
                      pct_accessories, size_cog, revenue_12mo,
                      revenue_90d, units_90d, orders_90d}}
    """
    # 90-day window — drives the behavioural features.
    by_store_units: Dict[str, float] = defaultdict(float)
    by_store_sales: Dict[str, float] = defaultdict(float)
    by_store_orders: Dict[str, set] = defaultdict(set)
    by_store_cat: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    by_store_size_units: Dict[str, float] = defaultdict(float)
    by_store_size_weighted: Dict[str, float] = defaultdict(float)

    for r in orders_90d or []:
        store = r.get("pos_location_name") or r.get("channel") or ""
        if _is_excluded_store(store):
            continue
        try:
            qty = float(r.get("quantity") or 0)
            sales = float(r.get("total_sales_kes") or 0)
        except Exception:
            continue
        if qty <= 0 and sales <= 0:
            continue
        by_store_units[store] += qty
        by_store_sales[store] += sales
        oid = r.get("order_id") or r.get("order_number")
        if oid:
            by_store_orders[store].add(str(oid))
        cat = r.get("product_type") or r.get("subcategory") or ""
        bucket = _bucket_for(cat)
        if bucket:
            by_store_cat[store][bucket] += sales
        size = (r.get("size") or "").strip().upper()
        w = _SIZE_WEIGHTS.get(size)
        if w is not None and qty > 0:
            by_store_size_units[store] += qty
            by_store_size_weighted[store] += qty * w

    # 12-month window — drives the A/B/C tier assignment.
    revenue_12mo: Dict[str, float] = defaultdict(float)
    for r in orders_12mo or []:
        store = r.get("pos_location_name") or r.get("channel") or ""
        if _is_excluded_store(store):
            continue
        try:
            revenue_12mo[store] += float(r.get("total_sales_kes") or 0)
        except Exception:
            pass

    out: Dict[str, Dict[str, float]] = {}
    all_stores = set(by_store_sales) | set(revenue_12mo)
    for s in all_stores:
        units = by_store_units.get(s, 0.0)
        sales = by_store_sales.get(s, 0.0)
        n_orders = len(by_store_orders.get(s, ()))
        cat_total = sum(by_store_cat[s].values())
        size_units = by_store_size_units.get(s, 0.0)
        size_w = by_store_size_weighted.get(s, 0.0)
        out[s] = {
            "asp": (sales / units) if units > 0 else 0.0,
            "avg_basket_units": (units / n_orders) if n_orders > 0 else 0.0,
            "pct_tops": (by_store_cat[s].get("tops", 0.0) / cat_total) if cat_total > 0 else 0.0,
            "pct_bottoms": (by_store_cat[s].get("bottoms", 0.0) / cat_total) if cat_total > 0 else 0.0,
            "pct_accessories": (by_store_cat[s].get("accessories", 0.0) / cat_total) if cat_total > 0 else 0.0,
            "size_cog": (size_w / size_units) if size_units > 0 else 0.0,
            "revenue_90d": sales,
            "units_90d": units,
            "orders_90d": float(n_orders),
            "revenue_12mo": revenue_12mo.get(s, 0.0),
        }
    return out


def assign_tiers(features: Dict[str, Dict[str, float]]) -> Dict[str, str]:
    """Bucket each store into A (top 20% by 12-month revenue), B (middle 60%),
    or C (bottom 20%). Stores with zero 12-month revenue go to C.
    """
    sorted_pairs = sorted(features.items(), key=lambda x: x[1].get("revenue_12mo", 0.0), reverse=True)
    n = len(sorted_pairs)
    if n == 0:
        return {}
    a_cut = max(1, int(round(n * 0.20)))
    c_cut_start = max(a_cut, int(round(n * 0.80)))
    out: Dict[str, str] = {}
    for i, (store, _) in enumerate(sorted_pairs):
        if i < a_cut:
            out[store] = "A"
        elif i >= c_cut_start:
            out[store] = "C"
        else:
            out[store] = "B"
    return out


# 4 mandatory features for the within-tier k-means (matches the design doc).
_FEATURE_KEYS = ("asp", "avg_basket_units", "pct_tops", "pct_bottoms",
                 "pct_accessories", "size_cog")


def _zscore_matrix(rows: List[List[float]]) -> np.ndarray:
    arr = np.asarray(rows, dtype=float)
    if arr.size == 0:
        return arr
    mean = arr.mean(axis=0)
    std = arr.std(axis=0)
    std = np.where(std < 1e-9, 1.0, std)  # avoid div-by-zero on flat features
    return (arr - mean) / std


def _kmeans(matrix: np.ndarray, k: int, max_iter: int = 50, seed: int = 7) -> np.ndarray:
    """Hand-rolled k-means with deterministic seed-based init.

    Kept readable on purpose — merchandising team must be able to follow
    the algorithm. No sklearn dependency.
    """
    rng = np.random.default_rng(seed)
    n = matrix.shape[0]
    if k >= n:
        return np.arange(n)  # one store per cluster
    # Init: pick k random distinct rows as initial centroids.
    init_idx = rng.choice(n, size=k, replace=False)
    centroids = matrix[init_idx].copy()
    labels = np.zeros(n, dtype=int)
    for _ in range(max_iter):
        # Assign: nearest centroid (Euclidean).
        dists = np.linalg.norm(matrix[:, None, :] - centroids[None, :, :], axis=2)
        new_labels = dists.argmin(axis=1)
        if np.array_equal(new_labels, labels):
            break
        labels = new_labels
        # Update: per-cluster mean (handle empty clusters by re-seeding).
        for c in range(k):
            members = matrix[labels == c]
            centroids[c] = members.mean(axis=0) if members.size > 0 else matrix[rng.integers(0, n)]
    return labels


def cluster_within_tier(
    features: Dict[str, Dict[str, float]],
    tiers: Dict[str, str],
) -> Tuple[Dict[str, str], Dict[str, Dict[str, Any]]]:
    """Return ({store: cluster_id_like_'A2'}, {cluster_id: {centroid, members}}).

    Cluster ids are stable within a tier — `<tier_letter><1-based index>`.
    Smaller tiers (<6 stores) are kept as a single cluster (no sub-split).
    """
    cluster_ids: Dict[str, str] = {}
    cluster_meta: Dict[str, Dict[str, Any]] = {}
    for tier in ("A", "B", "C"):
        members_in_tier = [s for s, t in tiers.items() if t == tier]
        if not members_in_tier:
            continue
        n = len(members_in_tier)
        # k = stores // 6, capped at 5, floored at 1 (single-cluster tiers
        # for small chains). Spec: target ~6 stores per cluster.
        k = max(1, min(5, n // 6))
        if k == 1:
            cluster_id = f"{tier}1"
            for s in members_in_tier:
                cluster_ids[s] = cluster_id
            centroid = _centroid_for(features, members_in_tier)
            cluster_meta[cluster_id] = {
                "tier": tier, "k": 1, "size": n, "members": sorted(members_in_tier),
                "centroid": centroid, "explainer": _explain_centroid(centroid),
            }
            continue
        rows = [
            [features[s][k] for k in _FEATURE_KEYS]
            for s in members_in_tier
        ]
        z = _zscore_matrix(rows)
        labels = _kmeans(z, k=k)
        # Re-order labels so cluster #1 is the largest, #2 second, etc.
        # Makes "A1" feel like "the biggest cluster in tier A" over time.
        order = sorted(range(k), key=lambda c: -np.sum(labels == c))
        remap = {old: new + 1 for new, old in enumerate(order)}
        for store, lab in zip(members_in_tier, labels):
            cluster_id = f"{tier}{remap[int(lab)]}"
            cluster_ids[store] = cluster_id
        for new_idx, old_lab in enumerate(order):
            cluster_id = f"{tier}{new_idx + 1}"
            mem = [s for s, lab in zip(members_in_tier, labels) if int(lab) == old_lab]
            centroid = _centroid_for(features, mem)
            cluster_meta[cluster_id] = {
                "tier": tier, "k": k, "size": len(mem), "members": sorted(mem),
                "centroid": centroid, "explainer": _explain_centroid(centroid),
            }
    return cluster_ids, cluster_meta


def _centroid_for(features: Dict[str, Dict[str, float]], stores: List[str]) -> Dict[str, float]:
    if not stores:
        return {k: 0.0 for k in _FEATURE_KEYS}
    out = {}
    for k in _FEATURE_KEYS:
        out[k] = round(float(np.mean([features[s][k] for s in stores])), 4)
    return out


def _explain_centroid(centroid: Dict[str, float]) -> str:
    """Plain-English description of a cluster's centre — used in tooltips."""
    asp = centroid.get("asp", 0)
    basket = centroid.get("avg_basket_units", 0)
    cog = centroid.get("size_cog", 0)
    tops = centroid.get("pct_tops", 0) * 100
    bot = centroid.get("pct_bottoms", 0) * 100
    acc = centroid.get("pct_accessories", 0) * 100
    size_label = (
        "skews S/M" if cog < 1.8
        else "skews M/L" if cog < 2.8
        else "skews L/XL" if cog < 4.0
        else "skews XL+"
    )
    return (f"ASP KES {asp:,.0f} · basket {basket:.1f}u · {size_label} · "
            f"{tops:.0f}% tops, {bot:.0f}% bottoms, {acc:.0f}% accessories")


async def run_clustering(orders_90d, orders_12mo, *, db=None, persist: bool = True) -> Dict[str, Any]:
    """Full pipeline. Caller passes pre-fetched orders so this module
    stays decoupled from server.py's upstream-fetch helpers (testability)."""
    features = compute_features(orders_90d, orders_12mo)
    if not features:
        return {"ok": False, "reason": "no_data", "stores": 0}
    tiers = assign_tiers(features)
    cluster_ids, cluster_meta = cluster_within_tier(features, tiers)
    run_doc = {
        "_id": "current",
        "computed_at": datetime.now(timezone.utc),
        "n_stores": len(features),
        "by_store": {
            s: {
                "tier": tiers.get(s),
                "cluster_id": cluster_ids.get(s),
                **{k: round(features[s].get(k, 0.0), 4) for k in _FEATURE_KEYS},
                "revenue_90d": round(features[s].get("revenue_90d", 0.0), 0),
                "revenue_12mo": round(features[s].get("revenue_12mo", 0.0), 0),
            }
            for s in features
        },
        "clusters": cluster_meta,
    }
    if persist and db is not None:
        try:
            await db.store_clusters.replace_one(
                {"_id": "current"}, run_doc, upsert=True
            )
        except Exception as e:
            logger.warning("[cluster_stores] could not persist: %s", e)
    # Don't ship _id back to API callers.
    out = {**run_doc}
    out.pop("_id", None)
    out["computed_at"] = run_doc["computed_at"].isoformat()
    return out


async def get_current_clusters(db) -> Dict[str, Any]:
    """Cheap read of the latest persisted cluster run, scrubbed of _id."""
    if db is None:
        return {"ok": False, "reason": "no_db"}
    doc = await db.store_clusters.find_one({"_id": "current"}, {"_id": 0})
    if not doc:
        return {"ok": False, "reason": "no_run_yet"}
    if isinstance(doc.get("computed_at"), datetime):
        doc["computed_at"] = doc["computed_at"].isoformat()
    return doc


async def cluster_id_for(db, store_name: str) -> Optional[str]:
    """Helper called from analytics endpoints — returns the cached cluster id
    for a store, or None if no run exists or the store wasn't clustered.
    Cheap (single hash lookup against the cached `current` doc)."""
    cache = await get_current_clusters(db)
    bs = cache.get("by_store") or {}
    row = bs.get(store_name)
    return row.get("cluster_id") if isinstance(row, dict) else None
