import { useEffect, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api } from "@/lib/api";

/**
 * Single source of truth for headline KPI numbers.
 *
 * Every page that shows Total Sales / Net Sales / Orders / Units / Avg Basket /
 * Return Rate should use this hook so their values agree on every date range
 * and filter combination.
 *
 * An in-memory cache keyed on (date_from, date_to, country, channel, dataVersion)
 * de-duplicates concurrent / back-to-back requests. The cache is automatically
 * invalidated when the user clicks Refresh (bumps dataVersion).
 */
const kpiCache = new Map(); // key -> { promise, data }

const cacheKey = (p) =>
  [p.date_from, p.date_to, p.country || "", p.channel || "", p._v || 0].join("|");

export function fetchKpis(params) {
  const key = cacheKey(params);
  if (kpiCache.has(key)) {
    const entry = kpiCache.get(key);
    if (entry.data) return Promise.resolve(entry.data);
    if (entry.promise) return entry.promise;
  }
  const promise = api
    .get("/kpis", { params: { date_from: params.date_from, date_to: params.date_to, country: params.country, channel: params.channel } })
    .then((r) => {
      kpiCache.get(key).data = r.data;
      return r.data;
    })
    .catch((e) => {
      kpiCache.delete(key);
      throw e;
    });
  kpiCache.set(key, { promise });
  return promise;
}

export function invalidateKpis() {
  kpiCache.clear();
}

/**
 * React hook — returns { kpis, loading, error } for the current filter state.
 * compare=true also fetches the previous-period KPIs.
 */
export function useKpis({ compare = false, overrideFilters } = {}) {
  const { applied } = useFilters();
  const f = overrideFilters || applied;
  const [kpis, setKpis] = useState(null);
  const [prevKpis, setPrevKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const country = f.countries.length === 1 ? f.countries[0] : undefined;
    const channel = f.channels.length ? f.channels.join(",") : undefined;
    const params = {
      date_from: f.dateFrom, date_to: f.dateTo,
      country, channel, _v: f.dataVersion,
    };

    const calls = [fetchKpis(params)];
    if (compare && f.compareMode !== "none") {
      const prevP = computePrevRange(f.dateFrom, f.dateTo, f.compareMode);
      if (prevP) calls.push(fetchKpis({ ...params, date_from: prevP.date_from, date_to: prevP.date_to }));
      else calls.push(Promise.resolve(null));
    }

    Promise.all(calls)
      .then(([curr, prev]) => {
        if (cancelled) return;
        setKpis(curr);
        setPrevKpis(prev || null);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [f.dateFrom, f.dateTo, JSON.stringify(f.countries), JSON.stringify(f.channels), f.compareMode, f.dataVersion, compare]);

  return { kpis, prevKpis, loading, error };
}

function computePrevRange(dateFrom, dateTo, mode) {
  const f = new Date(dateFrom);
  const t = new Date(dateTo);
  let df, dt;
  if (mode === "last_month") {
    df = new Date(f); df.setMonth(f.getMonth() - 1);
    dt = new Date(t); dt.setMonth(t.getMonth() - 1);
  } else if (mode === "last_year") {
    df = new Date(f); df.setFullYear(f.getFullYear() - 1);
    dt = new Date(t); dt.setFullYear(t.getFullYear() - 1);
  } else {
    return null;
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  return { date_from: iso(df), date_to: iso(dt) };
}

// Export a helper so the refresh-button handler can clear the cache.
export { invalidateKpis as invalidateSharedKpis };
