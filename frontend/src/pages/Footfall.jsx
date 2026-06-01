import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { useKpis } from "@/lib/useKpis";
import {
  api,
  fmtKES,
  fmtNum,
  fmtPct,
  fmtAxisKES,
  fmtDate,
  pctDelta,
  comparePeriod,
  COUNTRY_FLAGS,
} from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { useOutliers } from "@/lib/useOutliers";
import { DataQualityPill, DataQualityBanner } from "@/components/DataQualityPill";
import FootfallWeekdayHeatmap from "@/components/FootfallWeekdayHeatmap";
import FootfallDailyCalendar from "@/components/FootfallDailyCalendar";
import {
  Footprints,
  Target,
  ShoppingCart,
  Coins,
  Storefront,
  TrendUp,
  Warning,
  UsersThree,
  ArrowsInLineHorizontal,
} from "@phosphor-icons/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  LabelList,
} from "recharts";
import { ChartTooltip, Delta, makePctDeltaLabel } from "@/components/ChartHelpers";
import SortableTable from "@/components/SortableTable";
import { useTableSort, SortableTh } from "@/lib/useTableSort";

const Footfall = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode, compareDateFrom, compareDateTo, dataVersion } = applied;

  // Iter 89 — Sort state for the plain tables on the page that aren't
  // already built on `<SortableTable>`. Each table gets its own hook.
  const bottomTurnInSort = useTableSort();
  const excludedSort = useTableSort();

  const [rows, setRows] = useState([]);
  const [prev, setPrev] = useState([]);
  // Auto-immediate-prior window — ALWAYS fetched (regardless of the
  // global compare-mode) so the Footfall Exploration Table always has
  // a "last period" column even when the page-wide comparison is OFF.
  // Window length = (date_to - date_from). Shift back by that length.
  const [explorationPrev, setExplorationPrev] = useState([]);
  const [locations, setLocations] = useState([]);
  const [salesRows, setSalesRows] = useState([]); // /sales-summary — authoritative per-location sales
  const [prevSalesRows, setPrevSalesRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Shared authoritative KPIs — identical across all pages.
  const { kpis: authoritativeKpis, prevKpis: authoritativePrevKpis, loading: kpisLoading, error: kpisError } = useKpis({ compare: true });

  // Compute the auto-immediate-prior window for the Exploration Table.
  // Independent of the page-wide compareMode so this table is ALWAYS
  // populated. Length = (date_to - date_from + 1) days.
  const explorationPrevRange = useMemo(() => {
    if (!dateFrom || !dateTo) return null;
    const [y1, m1, d1] = dateFrom.split("-").map((x) => parseInt(x, 10));
    const [y2, m2, d2] = dateTo.split("-").map((x) => parseInt(x, 10));
    const a = new Date(y1, m1 - 1, d1);
    const b = new Date(y2, m2 - 1, d2);
    const lenDays = Math.round((b - a) / 86_400_000) + 1;
    if (!Number.isFinite(lenDays) || lenDays < 1) return null;
    const pTo = new Date(a);
    pTo.setDate(pTo.getDate() - 1);
    const pFrom = new Date(pTo);
    pFrom.setDate(pFrom.getDate() - (lenDays - 1));
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { date_from: iso(pFrom), date_to: iso(pTo) };
  }, [dateFrom, dateTo]);

  // Dedicated fetch for the Exploration Table's "last period" column.
  // We re-use the page's `prev` array when compareMode happens to coincide
  // with the auto-immediate-prior window; otherwise fire a separate /footfall
  // call. Skipped entirely when compareMode already targets the same window.
  useEffect(() => {
    if (!explorationPrevRange) { setExplorationPrev([]); return; }
    let cancelled = false;
    api.get("/footfall", { params: explorationPrevRange })
      .then(({ data }) => { if (!cancelled) setExplorationPrev(data || []); })
      .catch(() => { if (!cancelled) setExplorationPrev([]); });
    return () => { cancelled = true; };
  }, [explorationPrevRange?.date_from, explorationPrevRange?.date_to]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const prevP = comparePeriod(dateFrom, dateTo, compareMode, { date_from: compareDateFrom, date_to: compareDateTo });
    Promise.all([
      api.get("/footfall", { params: { date_from: dateFrom, date_to: dateTo } }),
      prevP
        ? api.get("/footfall", { params: { date_from: prevP.date_from, date_to: prevP.date_to } })
        : Promise.resolve({ data: [] }),
      api.get("/locations"),
      api.get("/sales-summary", { params: { date_from: dateFrom, date_to: dateTo } }),
      prevP
        ? api.get("/sales-summary", { params: { date_from: prevP.date_from, date_to: prevP.date_to } })
        : Promise.resolve({ data: [] }),
    ])
      .then(([f, p, l, s, ps]) => {
        if (cancelled) return;
        setRows(f.data || []);
        setPrev(p.data || []);
        setLocations(l.data || []);
        setSalesRows(s.data || []);
        setPrevSalesRows(ps.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, compareMode, compareDateFrom, compareDateTo, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  // Authoritative per-location sales come from /sales-summary (matches
  // /kpis). Upstream /footfall returns a different `total_sales` per row —
  // same orders but different sales figure (e.g. Vivo Junction: 462,775 in
  // /footfall vs 477,275 in /sales-summary for 2026-04-22). We ignore
  // /footfall.total_sales entirely and always join by channel name.
  const salesMap = useMemo(() => {
    const m = new Map();
    for (const r of salesRows) m.set(r.channel, r);
    return m;
  }, [salesRows]);
  const prevSalesMap = useMemo(() => {
    const m = new Map();
    for (const r of prevSalesRows) m.set(r.channel, r);
    return m;
  }, [prevSalesRows]);

  const channelCountry = useMemo(() => {
    const m = {};
    for (const l of locations) m[l.channel] = l.country;
    return m;
  }, [locations]);

  // Filter by country + channel selection only. Conversion-rate outliers are
  // included (data-quality filter removed per user request).
  const scoped = useMemo(() => {
    return rows.filter((r) => {
      if (countries.length) {
        const c = channelCountry[r.location];
        if (!c || !countries.includes(c)) return false;
      }
      if (channels.length && !channels.includes(r.location)) return false;
      return true;
    });
  }, [rows, countries, channels, channelCountry]);

  const prevMap = useMemo(() => {
    const m = new Map();
    for (const r of prev) m.set(r.location, r);
    return m;
  }, [prev]);

  const totals = useMemo(() => {
    // Two concepts on this page:
    //  • Headline `orders` / `sales` / `abv` → shared /kpis so they match
    //    Overview / Locations / CEO Report exactly.
    //  • `footfall` total + conversion rate → must use the per-store
    //    SUBTOTAL (only stores with a footfall counter), because orders from
    //    online channels and footfall-less stores have no visitor denominator.
    //    The subtotal is computed from /sales-summary (authoritative) joined
    //    on store name, NOT from /footfall.total_sales (which disagrees with
    //    /sales-summary upstream — e.g. Junction 462,775 vs 477,275).
    //  • `outside_traffic` / `turn_in_rate` (Iter 84h) — same scoping as
    //    footfall. Turn-in % = Σ footfall ÷ Σ outside traffic across all
    //    stores that report an outside-traffic figure. Stores without a
    //    pavement counter (outside_traffic == 0 or null) are EXCLUDED
    //    from BOTH the numerator and denominator so they don't drag
    //    the rate down to a meaningless number.
    const footfall = scoped.reduce((s, r) => s + (r.total_footfall || 0), 0);
    let scopedOrders = 0;
    let scopedSales = 0;
    let outsideTraffic = 0;
    let footfallWithOutside = 0;
    for (const r of scoped) {
      const s = salesMap.get(r.location);
      if (s) {
        scopedOrders += s.orders || s.total_orders || 0;
        scopedSales += s.total_sales || 0;
      }
      const ot = Number(r.outside_traffic || 0);
      if (ot > 0) {
        outsideTraffic += ot;
        footfallWithOutside += Number(r.total_footfall || 0);
      }
    }
    const conv = footfall ? (scopedOrders / footfall) * 100 : 0;
    const turnIn = outsideTraffic ? (footfallWithOutside / outsideTraffic) * 100 : null;
    // Headline values come from shared KPI response:
    const orders = authoritativeKpis?.total_orders || 0;
    const sales = authoritativeKpis?.total_sales || 0;
    const abv = orders ? sales / orders : (authoritativeKpis?.avg_basket_size || 0);
    return { footfall, orders, sales, conv, abv, scopedOrders, scopedSales, outsideTraffic, turnIn };
  }, [scoped, salesMap, authoritativeKpis]);

  const prevTotals = useMemo(() => {
    const scopedPrev = prev.filter((r) => {
      if (countries.length) {
        const c = channelCountry[r.location];
        if (!c || !countries.includes(c)) return false;
      }
      if (channels.length && !channels.includes(r.location)) return false;
      return true;
    });
    const footfall = scopedPrev.reduce((s, r) => s + (r.total_footfall || 0), 0);
    let scopedOrders = 0;
    let outsideTraffic = 0;
    let footfallWithOutside = 0;
    for (const r of scopedPrev) {
      const s = prevSalesMap.get(r.location);
      if (s) scopedOrders += s.orders || s.total_orders || 0;
      const ot = Number(r.outside_traffic || 0);
      if (ot > 0) {
        outsideTraffic += ot;
        footfallWithOutside += Number(r.total_footfall || 0);
      }
    }
    const conv = footfall ? (scopedOrders / footfall) * 100 : 0;
    const turnIn = outsideTraffic ? (footfallWithOutside / outsideTraffic) * 100 : null;
    const orders = authoritativePrevKpis?.total_orders || 0;
    const sales = authoritativePrevKpis?.total_sales || 0;
    const abv = orders ? sales / orders : (authoritativePrevKpis?.avg_basket_size || 0);
    return { footfall, orders, sales, conv, abv, scopedOrders, outsideTraffic, turnIn };
  }, [prev, countries, channels, channelCountry, prevSalesMap, authoritativePrevKpis]);

  const compareLbl = compareMode === "last_month" ? "vs Last Month" : compareMode === "last_year" ? "vs Last Year" : null;
  const delta = (a, b) => (compareMode !== "none" && b ? pctDelta(a, b) : null);

  const groupAvgConv = totals.conv;

  // Scoped rows enriched with previous-period footfall + ABV + delta.
  // IMPORTANT: `total_sales`, `abv` and per-row orders are joined from
  // /sales-summary (authoritative), NOT from /footfall.total_sales which
  // disagrees with /kpis for the same store & date (see Junction example).
  const scopedEnriched = useMemo(() => {
    return scoped.map((r) => {
      const auth = salesMap.get(r.location);
      const prevR = prevMap.get(r.location);
      const prevAuth = prevSalesMap.get(r.location);
      const sales = auth ? (auth.total_sales || 0) : (r.total_sales || 0);
      const orders = auth ? (auth.orders || auth.total_orders || 0) : (r.orders || 0);
      const conversion = r.total_footfall ? (orders / r.total_footfall) * 100 : 0;
      const abv = orders ? sales / orders : 0;
      const prevFootfall = prevR?.total_footfall || 0;
      const footfallDelta = prevFootfall ? ((r.total_footfall - prevFootfall) / prevFootfall) * 100 : null;

      // Previous-period values from /sales-summary (authoritative).
      const prevSales = prevAuth ? (prevAuth.total_sales || 0) : 0;
      const prevOrders = prevAuth ? (prevAuth.orders || prevAuth.total_orders || 0) : 0;
      const prevAbv = prevOrders ? prevSales / prevOrders : 0;
      const prevConv = prevFootfall ? (prevOrders / prevFootfall) * 100 : null;

      // Conversion change is in PERCENTAGE POINTS (pp), not % change —
      // since conversion is itself a %.
      // ISS-004 — guard against impossible deltas. A conversion_rate
      // is bounded [0, 100]; either value > 100 indicates upstream
      // sensor data-quality issue (orders > footfall). When that
      // happens, suppress the Δ so the UI shows "—" instead of an
      // impossible value like ▼103.26pp.
      const convOutOfRange = (conversion != null && conversion > 100) || (prevConv != null && prevConv > 100);
      const convDeltaPp = (prevConv != null && !convOutOfRange) ? conversion - prevConv : null;

      // Iter 84h — Outside Traffic + Turn-in Rate.
      // Some stores have no pavement counter → outside_traffic=0/null →
      // turn-in is undefined; we render '—' downstream. We keep the
      // raw numbers on the row even when null so consumers can decide
      // how to display.
      const outside = Number(r.outside_traffic || 0);
      const turnIn = outside > 0
        ? ((r.total_footfall || 0) / outside) * 100
        : null;
      const prevOutside = Number(prevR?.outside_traffic || 0);
      const prevTurnIn = prevOutside > 0
        ? ((prevR?.total_footfall || 0) / prevOutside) * 100
        : null;
      // Turn-in change is in pp like conversion.
      // ISS-009 — same data-quality guard as conversion delta:
      // turn_in_rate > 100 means outside_traffic sensor undercounted.
      const turnInOutOfRange = (turnIn != null && turnIn > 100) || (prevTurnIn != null && prevTurnIn > 100);
      const turnInDeltaPp = (turnIn != null && prevTurnIn != null && !turnInOutOfRange)
        ? turnIn - prevTurnIn
        : null;
      const outsideDelta = prevOutside ? ((outside - prevOutside) / prevOutside) * 100 : null;

      return {
        ...r,
        orders,                  // authoritative
        total_sales: sales,      // authoritative
        conversion_rate: conversion,
        abv,
        outside_traffic: outside,
        turn_in_rate: turnIn,
        prev_outside_traffic: prevOutside,
        prev_turn_in_rate: prevTurnIn,
        outside_delta: outsideDelta,
        turn_in_delta_pp: turnInDeltaPp,
        prev_footfall: prevFootfall,
        prev_orders: prevOrders,
        prev_sales: prevSales,
        prev_abv: prevAbv,
        prev_conv: prevConv,
        footfall_delta: footfallDelta,
        orders_delta: prevOrders ? ((orders - prevOrders) / prevOrders) * 100 : null,
        sales_delta: prevSales ? ((sales - prevSales) / prevSales) * 100 : null,
        abv_delta: prevAbv ? ((abv - prevAbv) / prevAbv) * 100 : null,
        conv_delta_pp: convDeltaPp,
      };
    });
  }, [scoped, salesMap, prevMap, prevSalesMap]);

  const byFootfall = useMemo(
    () => {
      const sorted = [...scopedEnriched].sort((a, b) => (b.total_footfall || 0) - (a.total_footfall || 0));
      const total = sorted.reduce((s, r) => s + (r.total_footfall || 0), 0) || 1;
      return sorted.map((r) => ({
        ...r,
        pct: ((r.total_footfall || 0) / total) * 100,
        delta_pct: r.footfall_delta,
      }));
    },
    [scopedEnriched]
  );

  // Data-quality outlier detection (audit #9) — via the reusable
  // `useOutliers` hook so every table on the platform can adopt the
  // same math with one line. Here: conversion rate on physical stores
  // with ≥ 200 footfall, 2σ + structural caps.
  const { enriched: enrichedWithFlag, stats: outlierStats, count: outlierCount } = useOutliers(
    scopedEnriched,
    {
      valueKey: "conversion_rate",
      filter: (r) => r.physical !== false && (r.total_footfall || 0) >= 200,
      hardHi: { at: 50, reason: "Unusually high CR (≥50%) — likely counter miscalibration" },
      hardLo: { at: 1, reason: "Unusually low CR (<1%) — counter may be over-counting traffic" },
      label: "CR",
      valueFmt: (v) => `${v.toFixed(1)}%`,
      sigmas: 2,
    }
  );

  const byConversion = useMemo(
    () => {
      const sorted = [...enrichedWithFlag].sort((a, b) => (b.conversion_rate || 0) - (a.conversion_rate || 0));
      // For conversion we use the actual %-point delta (already computed
      // as conv_delta_pp). Expose it as `delta_pct` for the standard label.
      return sorted.map((r) => ({ ...r, delta_pct: r.conv_delta_pp }));
    },
    [enrichedWithFlag]
  );

  // No excluded list — user requested we include all locations.
  const excluded = useMemo(() => [], []);

  // Iter 84h — Turn-in color buckets (green ≥15%, orange 8-14%, red <8%).
  // Shared across the KPI card, table cell, weekday pattern, and the
  // bottom-5 drill-down so the visual language is consistent.
  // Iter 84h.1 — Anomaly badge for >100% rates. Upstream pavement
  // counters occasionally report a partial-day sample (a 5-h window
  // captured against a full-day footfall figure → derived turn-in
  // exceeds 100%). The math is correct but the cell is visually
  // misleading. We append a "⚠" suffix the user can hover to see the
  // raw number — so the data-quality issue stays visible without
  // silently capping it.
  const turnInPillClass = (val) => {
    if (val == null) return "pill-neutral";
    if (val > 100) return "pill-amber";  // anomaly — render with caveat
    if (val >= 15) return "pill-green";
    if (val >= 8) return "pill-amber";
    return "pill-red";
  };
  const fmtTurnIn = (val) => {
    if (val == null) return "—";
    if (val > 100) return `${val.toFixed(1)}% ⚠`;
    return `${val.toFixed(1)}%`;
  };
  const turnInTitle = (val) => {
    if (val == null) return "";
    if (val > 100) return `Raw turn-in: ${val.toFixed(1)}%. Likely a partial pavement-counter sample upstream (counter captured a shorter window than the footfall counter). Investigate counter calibration if persistent.`;
    return "";
  };

  // Bottom 5 stores by turn-in rate (worst performers — most actionable).
  // Excludes stores without an outside-traffic counter (turn_in_rate=null).
  const bottomFiveTurnIn = useMemo(() => {
    return [...scopedEnriched]
      .filter((r) => r.turn_in_rate != null)
      .sort((a, b) => (a.turn_in_rate || 0) - (b.turn_in_rate || 0))
      .slice(0, 5);
  }, [scopedEnriched]);

  const [showBottomTurnIn, setShowBottomTurnIn] = useState(false);

  // ---------------------------------------------------------------------
  // Footfall Exploration Table — POS · Footfall In · Footfall In (last
  // period) · Change % · Footfall Outside. Always shows a "last period"
  // column regardless of the page-wide compareMode, by sourcing from
  // `explorationPrev` (auto-immediate-prior window — see useEffect above).
  // Scoped by the same country/channel filters as the rest of the page.
  // ---------------------------------------------------------------------
  const explorationPrevMap = useMemo(() => {
    const m = new Map();
    for (const r of explorationPrev || []) m.set(r.location, r);
    return m;
  }, [explorationPrev]);

  const explorationRows = useMemo(() => {
    return scoped.map((r) => {
      const p = explorationPrevMap.get(r.location);
      const prevFootfall = p?.total_footfall || 0;
      const curr = r.total_footfall || 0;
      const change = prevFootfall > 0
        ? ((curr - prevFootfall) / prevFootfall) * 100
        : (curr > 0 ? null : 0);  // no prior data → "—" unless current also 0
      return {
        location: r.location,
        footfall_in: curr,
        footfall_in_prev: prevFootfall,
        change_pct: change,
        footfall_outside: Number(r.outside_traffic || 0),
      };
    });
  }, [scoped, explorationPrevMap]);

  return (
    <div className="space-y-6" data-testid="footfall-page">
      <div>
        <div className="eyebrow">Dashboard · Footfall Analysis</div>
        <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(15px,1.5vw,19px)]">Footfall Analysis</h1>
        <p className="text-muted text-[13px] mt-0.5">
          {fmtDate(dateFrom)} → {fmtDate(dateTo)} · all locations included
        </p>
        {authoritativeKpis && authoritativeKpis.total_orders && totals.scopedOrders !== authoritativeKpis.total_orders && (
          <div className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
            ℹ️ Upstream footfall counters cover physical stores only.
            Showing <b>{fmtNum(authoritativeKpis.total_orders)}</b> total
            orders (matches Overview / Locations);
            per-store footfall table below tracks <b>{fmtNum(totals.scopedOrders)}</b> orders
            from {rows.length} stores with a counter — the remaining {" "}
            <b>{fmtNum(authoritativeKpis.total_orders - totals.scopedOrders)}</b>{" "}
            come from online channels and stores without footfall counters.
          </div>
        )}
      </div>

      {(loading || kpisLoading) && <Loading />}
      {(error || kpisError) && <ErrorBox message={error || kpisError} />}

      {!loading && !kpisLoading && !error && (
        <>
          {/* Legend — sits above the KPI grid so first-time floor managers
              know what the arrows + pp mean without hovering for a tooltip. */}
          <div
            className="rounded-full border border-border bg-white/70 px-3 py-1.5 text-[11.5px] text-foreground/70 inline-flex flex-wrap items-center gap-x-3 gap-y-1"
            data-testid="ff-legend"
          >
            <span className="inline-flex items-center gap-1">
              <span className="text-[#059669] font-bold">▲</span>
              <span>improving</span>
            </span>
            <span className="text-border">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="text-[#dc2626] font-bold">▼</span>
              <span>declining</span>
            </span>
            <span className="text-border">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="text-muted">—</span>
              <span>flat</span>
            </span>
            <span className="text-border">·</span>
            <span><b>pp</b> = percentage points (used for conversion-rate changes)</span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <KPICard
              testId="ff-kpi-outside"
              label="Outside Traffic"
              sub="people who passed the store"
              value={fmtNum(totals.outsideTraffic)}
              icon={UsersThree}
              delta={delta(totals.outsideTraffic, prevTotals.outsideTraffic)}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
              action={{ label: "Lowest turn-in rates →", onClick: () => setShowBottomTurnIn(true) }}
            />
            <KPICard
              testId="ff-kpi-total"
              accent
              label="Footfall In"
              value={fmtNum(totals.footfall)}
              icon={Footprints}
              delta={delta(totals.footfall, prevTotals.footfall)}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
              action={{ label: "By store", onClick: () => document.querySelector('[data-testid="ff-chart-footfall"]')?.scrollIntoView({ behavior: "smooth" }) }}
            />
            <KPICard
              testId="ff-kpi-turnin"
              label="Turn-in Rate"
              sub="Footfall In ÷ Outside Traffic"
              formula="Percentage of people passing the store who walked in"
              value={
                totals.turnIn != null ? (
                  <span
                    className={`${turnInPillClass(totals.turnIn)} text-[16px] px-2.5 py-0.5`}
                    title={turnInTitle(totals.turnIn)}
                  >
                    {fmtTurnIn(totals.turnIn)}
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )
              }
              icon={ArrowsInLineHorizontal}
              delta={(() => {
                if (compareMode === "none" || totals.turnIn == null || prevTotals.turnIn == null) return null;
                // Turn-in is a %, so the meaningful delta is in pp.
                return totals.turnIn - prevTotals.turnIn;
              })()}
              deltaLabel={compareLbl ? `${compareLbl} (pp)` : null}
              showDelta={compareMode !== "none"}
              action={{ label: "Lowest performers →", onClick: () => setShowBottomTurnIn(true) }}
            />
            <KPICard
              testId="ff-kpi-orders"
              label="Orders"
              sub="all channels"
              value={fmtNum(authoritativeKpis?.total_orders ?? totals.scopedOrders)}
              icon={ShoppingCart}
              delta={delta(
                authoritativeKpis?.total_orders ?? totals.scopedOrders,
                authoritativePrevKpis?.total_orders ?? prevTotals.scopedOrders,
              )}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
              action={{ label: "Export orders CSV", to: "/exports" }}
            />
            <KPICard
              testId="ff-kpi-conv"
              label="Stores Conversion Rate"
              sub={`${fmtNum(totals.scopedOrders)} orders ÷ ${fmtNum(totals.footfall)} footfall`}
              value={fmtPct(totals.conv, 2)}
              icon={Target}
              delta={delta(totals.conv, prevTotals.conv)}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
              action={{ label: "Which stores dropped?", onClick: () => document.querySelector('[data-testid="ff-chart-conversion"]')?.scrollIntoView({ behavior: "smooth" }) }}
            />
            <KPICard
              testId="ff-kpi-abv"
              label="Avg Basket Value"
              sub="Total Sales ÷ Orders"
              value={fmtKES(totals.abv)}
              icon={Coins}
              delta={delta(totals.abv, prevTotals.abv)}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
              action={{ label: "Top ABV stores", to: "/locations" }}
            />
          </div>

          <FootfallWeekdayHeatmap />

          <div className="card-white p-5" data-testid="ff-daily-calendar">
            <SectionTitle
              title="Daily footfall calendar"
              subtitle="Per-day group footfall (summed across locations) for the selected window. Darker green = busier day. Hover any cell for exact visitors, orders, and conversion."
            />
            <FootfallDailyCalendar
              dateFrom={dateFrom}
              dateTo={dateTo}
              country={countries.length === 1 ? countries[0] : undefined}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card-white p-5" data-testid="ff-chart-footfall">
            <SectionTitle
              title={`Footfall by location · ${byFootfall.length}`}
              subtitle="How many people walked into each store this period. Sorted busiest first."
            />
            {byFootfall.length === 0 ? <Empty /> : (
              <div style={{ width: "100%", height: Math.max(320, 24 + byFootfall.length * 20) }}>
                <ResponsiveContainer>
                  <BarChart data={byFootfall} layout="vertical" margin={{ left: 6, right: 56, top: 4 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 9 }} />
                    <YAxis type="category" dataKey="location" width={120} tick={{ fontSize: 9 }} />
                    <Tooltip content={
                      <ChartTooltip formatters={{
                        total_footfall: (v, p) => `${fmtNum(v)} visits · ${fmtNum(p?.orders || 0)} orders`,
                      }} />
                    } />
                    <Bar dataKey="total_footfall" fill="#1a5c38" radius={[0, 5, 5, 0]} name="Footfall">
                      <LabelList
                        dataKey="total_footfall"
                        content={makePctDeltaLabel({
                          data: byFootfall,
                          valueKey: "total_footfall",
                          formatValue: (v) => fmtNum(v),
                          position: "right",
                          offset: 6,
                          fontSize: 9,
                          hideDelta: compareMode === "none",
                          labelTestId: "footfall-loc-bar-label",
                        })}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card-white p-5" data-testid="ff-chart-conversion">
            <SectionTitle
              title={`Conversion rate by location · ${byConversion.length}`}
              subtitle="Out of every 100 walk-ins, how many bought. Green ≥ group average · Red below it · Amber = data-quality concern (verify counter)."
              action={
                <span className="text-[11px] text-muted">
                  Avg: <span className="font-bold text-brand">{fmtPct(groupAvgConv, 2)}</span>
                </span>
              }
            />
            <DataQualityBanner
              count={outlierCount}
              noun="stores"
              statsLine={`conversion outside ±2σ (group avg ${outlierStats.mean.toFixed(1)}% ± ${outlierStats.sd.toFixed(1)}pp)`}
              action="verify the footfall counter before acting on the number."
              testId="outlier-banner"
            />
            {byConversion.length === 0 ? <Empty /> : (
              <div style={{ width: "100%", height: Math.max(320, 24 + byConversion.length * 20) }}>
                <ResponsiveContainer>
                  <BarChart data={byConversion} layout="vertical" margin={{ left: 6, right: 46, top: 4 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 9 }} />
                    <YAxis type="category" dataKey="location" width={120} tick={{ fontSize: 9 }} />
                    <Tooltip content={
                      <ChartTooltip formatters={{
                        conversion_rate: (v, p) => `${Number(v).toFixed(2)}% · ${fmtNum(p?.orders || 0)} orders ÷ ${fmtNum(p?.total_footfall || 0)} visits`,
                      }} />
                    } />
                    <ReferenceLine x={groupAvgConv} stroke="#9ca3af" strokeDasharray="4 4" />
                    <Bar dataKey="conversion_rate" radius={[0, 5, 5, 0]} name="Conversion rate">
                      {byConversion.map((r, i) => {
                        // Outliers get amber — data-quality signal trumps above/below-average.
                        const fill = r.outlier
                          ? "#f59e0b"
                          : (r.conversion_rate || 0) >= groupAvgConv ? "#00c853" : "#ef4444";
                        return <Cell key={i} fill={fill} />;
                      })}
                      <LabelList
                        dataKey="conversion_rate"
                        content={makePctDeltaLabel({
                          data: byConversion,
                          valueKey: "conversion_rate",
                          // Conversion is itself a %, so suppress the (Y%) share
                          // segment and show the delta in PERCENTAGE POINTS,
                          // not %, so floor managers don't conflate a small CR
                          // shift with a big sales swing.
                          pctKey: "__none__",
                          deltaSuffix: "pp",
                          formatValue: (v) => `${Number(v).toFixed(1)}%`,
                          position: "right",
                          offset: 6,
                          fontSize: 9,
                          hideDelta: compareMode === "none",
                          labelTestId: "ff-conversion-bar-label",
                        })}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          </div>

          {/* Iter 84h — Lowest turn-in rates drill-down. Triggered from
              the Outside Traffic and Turn-in KPI cards. Stores without a
              pavement counter are filtered out at the source so we don't
              show "—" rows here. */}
          {showBottomTurnIn && (
            <div className="card-white p-5 border-l-4 border-red" data-testid="ff-bottom-turnin">
              <SectionTitle
                title="Lowest turn-in rates — bottom 5 stores"
                subtitle="Stores converting the smallest share of pavement traffic into footfall. Action: investigate window display, signage, and welcome at the door."
                action={
                  <button
                    onClick={() => setShowBottomTurnIn(false)}
                    className="text-[11px] text-muted hover:text-foreground"
                    data-testid="ff-bottom-turnin-close"
                  >
                    Hide
                  </button>
                }
              />
              {bottomFiveTurnIn.length === 0 ? <Empty /> : (
                <div className="overflow-x-auto">
                  <table className="w-full data" data-testid="ff-bottom-turnin-table">
                    <thead>
                      <tr>
                        <SortableTh sortKey="location" sort={bottomTurnInSort.sort} onSort={bottomTurnInSort.toggleSort}>Store</SortableTh>
                        <SortableTh sortKey="outside_traffic" sort={bottomTurnInSort.sort} onSort={bottomTurnInSort.toggleSort} numeric>Outside Traffic</SortableTh>
                        <SortableTh sortKey="total_footfall" sort={bottomTurnInSort.sort} onSort={bottomTurnInSort.toggleSort} numeric>Footfall In</SortableTh>
                        <SortableTh sortKey="turn_in_rate" sort={bottomTurnInSort.sort} onSort={bottomTurnInSort.toggleSort} numeric>Turn-in Rate</SortableTh>
                        {compareMode !== "none" && (
                          <SortableTh sortKey="turn_in_delta_pp" sort={bottomTurnInSort.sort} onSort={bottomTurnInSort.toggleSort} numeric>vs Last Period</SortableTh>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {bottomTurnInSort.sortRows(bottomFiveTurnIn, {
                        location: (r) => r.location,
                        outside_traffic: (r) => Number(r.outside_traffic ?? 0),
                        total_footfall: (r) => Number(r.total_footfall ?? 0),
                        turn_in_rate: (r) => Number(r.turn_in_rate ?? 0),
                        turn_in_delta_pp: (r) => r.turn_in_delta_pp == null ? null : Number(r.turn_in_delta_pp),
                      }).map((r, i) => (
                        <tr key={r.location + i} data-testid={`ff-bottom-turnin-row-${i}`}>
                          <td className="font-medium">
                            <span className="inline-flex items-center gap-2">
                              <Storefront size={14} className="text-muted" />
                              {r.location}
                            </span>
                          </td>
                          <td className="text-right num">{fmtNum(r.outside_traffic)}</td>
                          <td className="text-right num">{fmtNum(r.total_footfall)}</td>
                          <td className="text-right">
                            <span className={turnInPillClass(r.turn_in_rate)} title={turnInTitle(r.turn_in_rate)}>
                              {fmtTurnIn(r.turn_in_rate)}
                            </span>
                          </td>
                          {compareMode !== "none" && (
                            <td className="text-right">
                              {r.turn_in_delta_pp == null ? (
                                <span className="text-muted text-[11px]">n/a</span>
                              ) : (() => {
                                const pp = r.turn_in_delta_pp;
                                const pos = pp > 0.05;
                                const neg = pp < -0.05;
                                const cls = pos ? "text-[#059669]" : neg ? "text-[#dc2626]" : "text-muted";
                                const arr = pos ? "▲" : neg ? "▼" : "—";
                                const sign = pp > 0 ? "+" : "";
                                return (
                                  <span className={`${cls} font-semibold text-[11.5px] num`}>
                                    {arr} {sign}{pp.toFixed(2)}pp
                                  </span>
                                );
                              })()}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="card-white p-5" data-testid="ff-exploration-table">
            <SectionTitle
              title={`Footfall Exploration · ${explorationRows.length} locations`}
              subtitle={`Side-by-side compare: footfall in for the selected window vs the immediately preceding period of the same length${explorationPrevRange ? ` (${explorationPrevRange.date_from} → ${explorationPrevRange.date_to})` : ""}, plus pavement-level outside traffic for context.`}
            />
            {explorationRows.length === 0 ? <Empty /> : (
              <SortableTable
                testId="ff-exploration"
                exportName="footfall-exploration.csv"
                pageSize={50}
                initialSort={{ key: "footfall_in", dir: "desc" }}
                columns={[
                  {
                    key: "location", label: "POS", align: "left",
                    render: (r) => (
                      <span className="inline-flex items-center gap-2 font-medium">
                        <Storefront size={14} className="text-muted" />
                        {r.location}
                      </span>
                    ),
                    csv: (r) => r.location,
                  },
                  {
                    key: "footfall_in", label: "Footfall In", numeric: true,
                    render: (r) => <span className="num">{fmtNum(r.footfall_in)}</span>,
                    csv: (r) => r.footfall_in,
                  },
                  {
                    key: "footfall_in_prev", label: "Footfall In (last period)", numeric: true,
                    render: (r) => r.footfall_in_prev
                      ? <span className="num text-muted">{fmtNum(r.footfall_in_prev)}</span>
                      : <span className="text-muted text-[11px]">—</span>,
                    csv: (r) => r.footfall_in_prev || "",
                  },
                  {
                    key: "change_pct", label: "Change %", numeric: true,
                    sortValue: (r) => r.change_pct == null ? -9999 : r.change_pct,
                    render: (r) => <Delta value={r.change_pct} precision={1} />,
                    csv: (r) => r.change_pct == null ? "" : r.change_pct.toFixed(2),
                  },
                  {
                    key: "footfall_outside", label: "Footfall Outside", numeric: true,
                    render: (r) => r.footfall_outside > 0
                      ? <span className="num">{fmtNum(r.footfall_outside)}</span>
                      : <span className="text-muted text-[11px]">—</span>,
                    csv: (r) => r.footfall_outside || "",
                  },
                ]}
                rows={explorationRows}
              />
            )}
          </div>

          <div className="card-white p-5" data-testid="ff-table">
            <SectionTitle
              title="Location-level breakdown"
              subtitle={`${scopedEnriched.length} locations · click any column to sort. Surface the best and worst conversion stores side-by-side, then act: coach low-conversion store managers, replicate high-conversion practices.`}
              action={
                <span className="pill-neutral flex items-center gap-1.5">
                  <TrendUp size={12} /> Conversion benchmark: {fmtPct(groupAvgConv, 2)}
                  {compareMode !== "none" && prevTotals.conv != null && (
                    <>
                      {(() => {
                        const pp = groupAvgConv - prevTotals.conv;
                        const cls = pp > 0.05 ? "text-[#059669]" : pp < -0.05 ? "text-[#dc2626]" : "text-muted";
                        const arr = pp > 0.05 ? "▲" : pp < -0.05 ? "▼" : "—";
                        const sign = pp > 0 ? "+" : "";
                        return (
                          <span className={`${cls} font-bold ml-1`} data-testid="ff-benchmark-delta">
                            {arr} {sign}{pp.toFixed(2)}pp
                          </span>
                        );
                      })()}
                      <span className="text-muted font-normal">{compareLbl?.toLowerCase()}</span>
                    </>
                  )}
                </span>
              }
            />
            <SortableTable
              testId="ff-breakdown"
              exportName="footfall-breakdown.csv"
              initialSort={{ key: "turn_in_rate", dir: "asc" }}
              columns={[
                {
                  key: "location",
                  label: "Location",
                  align: "left",
                  render: (r) => (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-2 font-medium">
                        <Storefront size={14} className="text-muted" />
                        {r.location}
                      </span>
                      <DataQualityPill
                        flag={r.outlier}
                        label="verify counter"
                        testId={r.outlier ? `outlier-pill-${r.location}` : undefined}
                      />
                    </div>
                  ),
                  csv: (r) => r.outlier ? `${r.location} [⚠ ${r.outlier.reason}]` : r.location,
                },
                {
                  key: "outside_traffic",
                  label: "Outside Traffic",
                  numeric: true,
                  // Sort stores without a pavement counter to the bottom by
                  // returning -1 so ascending sort puts them last.
                  sortValue: (r) => r.outside_traffic > 0 ? r.outside_traffic : -1,
                  render: (r) => r.outside_traffic > 0
                    ? <span className="num">{fmtNum(r.outside_traffic)}</span>
                    : <span className="text-muted text-[11px]">—</span>,
                  csv: (r) => r.outside_traffic || "",
                },
                { key: "total_footfall", label: "Footfall In", numeric: true, render: (r) => fmtNum(r.total_footfall) },
                {
                  key: "turn_in_rate",
                  label: "Turn-in",
                  numeric: true,
                  // Same sort trick — stores with no counter sink to the
                  // bottom on ascending sort (worst-first view).
                  sortValue: (r) => r.turn_in_rate == null ? 999999 : r.turn_in_rate,
                  render: (r) => r.turn_in_rate != null
                    ? <span className={turnInPillClass(r.turn_in_rate)} title={turnInTitle(r.turn_in_rate)}>{fmtTurnIn(r.turn_in_rate)}</span>
                    : <span className="text-muted text-[11px]">—</span>,
                  csv: (r) => r.turn_in_rate == null ? "" : r.turn_in_rate.toFixed(2),
                },
                ...(compareMode !== "none" ? [{
                  key: "footfall_delta",
                  label: "Δ Footfall",
                  numeric: true,
                  sortValue: (r) => r.footfall_delta == null ? -9999 : r.footfall_delta,
                  render: (r) => <Delta value={r.footfall_delta} precision={1} />,
                  csv: (r) => r.footfall_delta == null ? "" : r.footfall_delta.toFixed(2),
                }] : []),
                { key: "orders", label: "Orders", numeric: true, render: (r) => fmtNum(r.orders) },
                ...(compareMode !== "none" ? [{
                  key: "orders_delta",
                  label: "Δ Orders",
                  numeric: true,
                  sortValue: (r) => r.orders_delta == null ? -9999 : r.orders_delta,
                  render: (r) => <Delta value={r.orders_delta} precision={1} />,
                  csv: (r) => r.orders_delta == null ? "" : r.orders_delta.toFixed(2),
                }] : []),
                {
                  key: "conversion_rate",
                  label: "Conversion",
                  numeric: true,
                  render: (r) => {
                    const cr = r.conversion_rate || 0;
                    if (r.outlier) return <span className="pill-amber">{fmtPct(cr, 2)}</span>;
                    const pill = cr >= groupAvgConv + 3 ? "pill-green" : cr >= groupAvgConv - 2 ? "pill-amber" : "pill-red";
                    return <span className={pill}>{fmtPct(cr, 2)}</span>;
                  },
                  csv: (r) => r.conversion_rate?.toFixed(2),
                },
                ...(compareMode !== "none" ? [{
                  key: "conv_delta_pp",
                  label: "Δ Conv (pp)",
                  numeric: true,
                  sortValue: (r) => r.conv_delta_pp == null ? -9999 : r.conv_delta_pp,
                  render: (r) => {
                    const pp = r.conv_delta_pp;
                    if (pp == null || isNaN(pp)) return <span className="text-muted text-[11px]">n/a</span>;
                    const pos = pp > 0.05;
                    const neg = pp < -0.05;
                    const cls = pos ? "text-[#059669]" : neg ? "text-[#dc2626]" : "text-muted";
                    const arr = pos ? "▲" : neg ? "▼" : "—";
                    const sign = pp > 0 ? "+" : "";
                    return <span className={`${cls} font-semibold text-[11.5px] num`}>{arr} {sign}{pp.toFixed(2)}pp</span>;
                  },
                  csv: (r) => r.conv_delta_pp == null ? "" : r.conv_delta_pp.toFixed(2),
                }] : []),
                { key: "abv", label: "ABV", numeric: true, render: (r) => fmtKES(r.abv), csv: (r) => Math.round(r.abv || 0) },
                ...(compareMode !== "none" ? [{
                  key: "abv_delta",
                  label: "Δ ABV",
                  numeric: true,
                  sortValue: (r) => r.abv_delta == null ? -9999 : r.abv_delta,
                  render: (r) => <Delta value={r.abv_delta} precision={1} />,
                  csv: (r) => r.abv_delta == null ? "" : r.abv_delta.toFixed(2),
                }] : []),
                { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                ...(compareMode !== "none" ? [{
                  key: "sales_delta",
                  label: "Δ Sales",
                  numeric: true,
                  sortValue: (r) => r.sales_delta == null ? -9999 : r.sales_delta,
                  render: (r) => <Delta value={r.sales_delta} precision={1} />,
                  csv: (r) => r.sales_delta == null ? "" : r.sales_delta.toFixed(2),
                }] : []),
              ]}
              rows={enrichedWithFlag}
            />
          </div>

          {excluded.length > 0 && (
            <div className="card-white p-5 border-l-4 border-amber" data-testid="ff-excluded">
              <SectionTitle
                title={`Excluded from analysis · ${excluded.length}`}
                subtitle="Locations flagged with conversion rate >50% — likely data quality issue (e.g. Vivo Junction footfall counter)"
              />
              <div className="overflow-x-auto">
                <table className="w-full data">
                  <thead>
                    <tr>
                      <SortableTh sortKey="location" sort={excludedSort.sort} onSort={excludedSort.toggleSort}>Location</SortableTh>
                      <SortableTh sortKey="total_footfall" sort={excludedSort.sort} onSort={excludedSort.toggleSort} numeric>Footfall</SortableTh>
                      <SortableTh sortKey="orders" sort={excludedSort.sort} onSort={excludedSort.toggleSort} numeric>Orders</SortableTh>
                      <SortableTh sortKey="conversion_rate" sort={excludedSort.sort} onSort={excludedSort.toggleSort} numeric>Conversion</SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {excludedSort.sortRows(excluded, {
                      location: (r) => r.location,
                      total_footfall: (r) => Number(r.total_footfall ?? 0),
                      orders: (r) => Number(r.orders ?? 0),
                      conversion_rate: (r) => Number(r.conversion_rate ?? 0),
                    }).map((r, i) => (
                      <tr key={r.location + i}>
                        <td className="font-medium text-muted">
                          <span className="inline-flex items-center gap-2">
                            <Warning size={14} className="text-amber" />
                            {r.location}
                          </span>
                        </td>
                        <td className="text-right num text-muted">{fmtNum(r.total_footfall)}</td>
                        <td className="text-right num text-muted">{fmtNum(r.orders)}</td>
                        <td className="text-right"><span className="pill-amber">{fmtPct(r.conversion_rate, 2)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Footfall;
