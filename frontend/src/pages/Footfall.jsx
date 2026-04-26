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
import { ChartTooltip, Delta } from "@/components/ChartHelpers";
import SortableTable from "@/components/SortableTable";

const Footfall = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode, dataVersion } = applied;

  const [rows, setRows] = useState([]);
  const [prev, setPrev] = useState([]);
  const [locations, setLocations] = useState([]);
  const [salesRows, setSalesRows] = useState([]); // /sales-summary — authoritative per-location sales
  const [prevSalesRows, setPrevSalesRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Shared authoritative KPIs — identical across all pages.
  const { kpis: authoritativeKpis, prevKpis: authoritativePrevKpis, loading: kpisLoading, error: kpisError } = useKpis({ compare: true });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const prevP = comparePeriod(dateFrom, dateTo, compareMode);
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
  }, [dateFrom, dateTo, compareMode, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

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
    const footfall = scoped.reduce((s, r) => s + (r.total_footfall || 0), 0);
    let scopedOrders = 0;
    let scopedSales = 0;
    for (const r of scoped) {
      const s = salesMap.get(r.location);
      if (s) {
        scopedOrders += s.orders || s.total_orders || 0;
        scopedSales += s.total_sales || 0;
      }
    }
    const conv = footfall ? (scopedOrders / footfall) * 100 : 0;
    // Headline values come from shared KPI response:
    const orders = authoritativeKpis?.total_orders || 0;
    const sales = authoritativeKpis?.total_sales || 0;
    const abv = orders ? sales / orders : (authoritativeKpis?.avg_basket_size || 0);
    return { footfall, orders, sales, conv, abv, scopedOrders, scopedSales };
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
    for (const r of scopedPrev) {
      const s = prevSalesMap.get(r.location);
      if (s) scopedOrders += s.orders || s.total_orders || 0;
    }
    const conv = footfall ? (scopedOrders / footfall) * 100 : 0;
    const orders = authoritativePrevKpis?.total_orders || 0;
    const sales = authoritativePrevKpis?.total_sales || 0;
    const abv = orders ? sales / orders : (authoritativePrevKpis?.avg_basket_size || 0);
    return { footfall, orders, sales, conv, abv, scopedOrders };
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
      const convDeltaPp = prevConv != null ? conversion - prevConv : null;

      return {
        ...r,
        orders,                  // authoritative
        total_sales: sales,      // authoritative
        conversion_rate: conversion,
        abv,
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
    () => [...scopedEnriched].sort((a, b) => (b.total_footfall || 0) - (a.total_footfall || 0)),
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
    () => [...enrichedWithFlag].sort((a, b) => (b.conversion_rate || 0) - (a.conversion_rate || 0)),
    [enrichedWithFlag]
  );

  // No excluded list — user requested we include all locations.
  const excluded = useMemo(() => [], []);

  return (
    <div className="space-y-6" data-testid="footfall-page">
      <div>
        <div className="eyebrow">Dashboard · Footfall Analysis</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">Footfall Analysis</h1>
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              testId="ff-kpi-total"
              accent
              label="Total Footfall"
              value={fmtNum(totals.footfall)}
              icon={Footprints}
              delta={delta(totals.footfall, prevTotals.footfall)}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
              action={{ label: "By store", onClick: () => document.querySelector('[data-testid="ff-chart-footfall"]')?.scrollIntoView({ behavior: "smooth" }) }}
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
              subtitle="All locations sorted by footfall descending — identify your busiest stores and cross-check against conversion to spot locations leaking potential sales."
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
                      <LabelList dataKey="total_footfall" position="right" formatter={(v) => fmtNum(v)} style={{ fontSize: 9, fill: "#4b5563" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card-white p-5" data-testid="ff-chart-conversion">
            <SectionTitle
              title={`Conversion rate by location · ${byConversion.length}`}
              subtitle="Visitor-to-buyer conversion by location. Green = at or above group average · Red = below (coach the floor) · Amber = data-quality outlier (verify counter)."
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
                      <LabelList dataKey="conversion_rate" position="right" formatter={(v) => `${Number(v).toFixed(1)}%`} style={{ fontSize: 9, fill: "#4b5563" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
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
              initialSort={{ key: "total_footfall", dir: "desc" }}
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
                { key: "total_footfall", label: "Footfall", numeric: true, render: (r) => fmtNum(r.total_footfall) },
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
                      <th>Location</th>
                      <th className="text-right">Footfall</th>
                      <th className="text-right">Orders</th>
                      <th className="text-right">Conversion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excluded.map((r, i) => (
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
