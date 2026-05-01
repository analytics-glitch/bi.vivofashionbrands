import { useEffect, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api } from "@/lib/api";

/**
 * Single source of truth for headline KPI numbers.
 *
 * Every page that displays Total Sales / Net Sales / Orders / Units /
 * Avg Basket / Return Rate MUST read from this hook (or from `fetchKpis`)
 * so that numbers agree byte-for-byte across every screen.
 *
 * An in-memory cache keyed on (date_from, date_to, country, channel, dataVersion)
 * de-duplicates concurrent / back-to-back requests. The cache is cleared when
 * the user clicks Refresh (which also bumps `dataVersion`).
 */
const kpiCache = new Map(); // key -> { promise?, data?, ts? }
// 60 s TTL — long enough to dedupe a burst of concurrent component
// mounts (Overview, AppHeader, KpiTrendChart all consume the same
// payload) but short enough that a fresh deploy / data-pipeline update
// upstream reaches users within ~1 minute even if they don't click
// Refresh. The hard cache-clear (`invalidateKpis()`) on Refresh button
// is still in place; this TTL is an additional self-healing safety net.
const KPI_CACHE_TTL_MS = 60_000;

const cacheKey = (p) =>
  [p.date_from, p.date_to, p.country || "", p.channel || "", p._v || 0].join("|");

const buildKpiParams = (applied) => {
  const country = applied.countries && applied.countries.length
    ? applied.countries.join(",")
    : undefined;
  const channel = applied.channels && applied.channels.length
    ? applied.channels.join(",")
    : undefined;
  return {
    date_from: applied.dateFrom,
    date_to: applied.dateTo,
    country,
    channel,
    _v: applied.dataVersion,
  };
};

export function fetchKpis(params) {
  const key = cacheKey(params);
  if (kpiCache.has(key)) {
    const entry = kpiCache.get(key);
    const fresh = entry.ts && (Date.now() - entry.ts) < KPI_CACHE_TTL_MS;
    if (entry.data && fresh) return Promise.resolve(entry.data);
    if (entry.promise && fresh) return entry.promise;
    // Stale entry — drop it so we re-fetch below.
    if (!fresh) kpiCache.delete(key);
  }
  const promise = api
    .get("/kpis", {
      params: {
        date_from: params.date_from,
        date_to: params.date_to,
        country: params.country,
        channel: params.channel,
      },
    })
    .then((r) => {
      kpiCache.set(key, { data: r.data, ts: Date.now() });
      return r.data;
    })
    .catch((e) => {
      kpiCache.delete(key);
      throw e;
    });
  kpiCache.set(key, { promise, ts: Date.now() });
  return promise;
}

export function invalidateKpis() {
  kpiCache.clear();
}

function computePrevRange(dateFrom, dateTo, mode) {
  if (!mode || mode === "none") return null;
  const f = new Date(dateFrom);
  const t = new Date(dateTo);
  let df;
  let dt;
  if (mode === "yesterday") {
    df = new Date(f); df.setDate(f.getDate() - 1);
    dt = new Date(t); dt.setDate(t.getDate() - 1);
  } else if (mode === "last_month") {
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

/**
 * Standard hook — returns { kpis, prevKpis, loading, error } for the current
 * filter state. Pass `{ compare: true }` to also fetch the previous period.
 */
export function useKpis({ compare = false } = {}) {
  const { applied } = useFilters();
  const [kpis, setKpis] = useState(null);
  const [prevKpis, setPrevKpis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = buildKpiParams(applied);
    const calls = [fetchKpis(params)];
    if (compare) {
      const prev = computePrevRange(applied.dateFrom, applied.dateTo, applied.compareMode);
      calls.push(prev ? fetchKpis({ ...params, ...prev }) : Promise.resolve(null));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    applied.dateFrom,
    applied.dateTo,
    JSON.stringify(applied.countries),
    JSON.stringify(applied.channels),
    applied.compareMode,
    applied.dataVersion,
    compare,
  ]);

  // Auto-recovery poll — when the backend is currently serving stale
  // values (`stale === true` flag on the /kpis payload), we silently
  // re-fetch every 30 s in the background. The fresh fetch invalidates
  // the in-process kpiCache (via `_v`-bumped key) when upstream
  // recovers, so the staleness banner clears within ~30 s of upstream
  // coming back online — no user action / page refresh needed.
  // Stops as soon as `stale === false` so we don't pin upstream when
  // everything's healthy.
  useEffect(() => {
    if (!kpis || !kpis.stale) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        // Force a fresh upstream call by bumping the cache key — the
        // shared cache module exposes invalidateKpis() for this exact
        // purpose (clears the entire kpiCache).
        invalidateKpis();
        const params = buildKpiParams(applied);
        const fresh = await fetchKpis(params);
        if (!cancelled && fresh && !fresh.stale) {
          setKpis(fresh);
        }
      } catch {
        // Upstream still down — keep polling silently.
      }
    };
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpis?.stale, applied.dateFrom, applied.dateTo,
      JSON.stringify(applied.countries), JSON.stringify(applied.channels)]);

  return { kpis, prevKpis, loading, error };
}

/**
 * CEO-report oriented hook — fetches current + last-month + last-year KPIs
 * in parallel using the shared cache, so numbers match Overview exactly.
 */
export function useKpisLMLY() {
  const { applied } = useFilters();
  const [kpis, setKpis] = useState(null);
  const [kpisLM, setKpisLM] = useState(null);
  const [kpisLY, setKpisLY] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = buildKpiParams(applied);
    const lm = computePrevRange(applied.dateFrom, applied.dateTo, "last_month");
    const ly = computePrevRange(applied.dateFrom, applied.dateTo, "last_year");
    Promise.all([
      fetchKpis(params),
      lm ? fetchKpis({ ...params, ...lm }) : Promise.resolve(null),
      ly ? fetchKpis({ ...params, ...ly }) : Promise.resolve(null),
    ])
      .then(([k, klm, kly]) => {
        if (cancelled) return;
        setKpis(k);
        setKpisLM(klm);
        setKpisLY(kly);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    applied.dateFrom,
    applied.dateTo,
    JSON.stringify(applied.countries),
    JSON.stringify(applied.channels),
    applied.dataVersion,
  ]);

  return { kpis, kpisLM, kpisLY, loading, error };
}

export { invalidateKpis as invalidateSharedKpis };
