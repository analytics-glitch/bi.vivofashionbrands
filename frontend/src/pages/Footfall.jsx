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

  const compareLbl = compareMode === "last_month" ? "vs LM" : compareMode === "last_year" ? "vs LY" : null;
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
      const sales = auth ? (auth.total_sales || 0) : (r.total_sales || 0);
      const orders = auth ? (auth.orders || auth.total_orders || 0) : (r.orders || 0);
      const conversion = r.total_footfall ? (orders / r.total_footfall) * 100 : 0;
      const abv = orders ? sales / orders : 0;
      const prevFootfall = prevR?.total_footfall || 0;
      const footfallDelta = prevFootfall ? ((r.total_footfall - prevFootfall) / prevFootfall) * 100 : null;
      return {
        ...r,
        orders,                  // authoritative
        total_sales: sales,      // authoritative
        conversion_rate: conversion,
        abv,
        prev_footfall: prevFootfall,
        footfall_delta: footfallDelta,
      };
    });
  }, [scoped, salesMap, prevMap]);

  const byFootfall = useMemo(
    () => [...scopedEnriched].sort((a, b) => (b.total_footfall || 0) - (a.total_footfall || 0)),
    [scopedEnriched]
  );

  const byConversion = useMemo(
    () => [...scopedEnriched].sort((a, b) => (b.conversion_rate || 0) - (a.conversion_rate || 0)),
    [scopedEnriched]
  );

  const byABV = useMemo(
    () => [...scopedEnriched].sort((a, b) => (b.abv || 0) - (a.abv || 0)),
    [scopedEnriched]
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
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card-white p-5" data-testid="ff-chart-footfall">
            <SectionTitle
              title={`Footfall by location · ${byFootfall.length}`}
              subtitle="All locations sorted by footfall descending"
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
              subtitle="Red = below group avg · Green = at/above"
              action={
                <span className="text-[11px] text-muted">
                  Avg: <span className="font-bold text-brand">{fmtPct(groupAvgConv, 2)}</span>
                </span>
              }
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
                      {byConversion.map((r, i) => (
                        <Cell key={i} fill={(r.conversion_rate || 0) >= groupAvgConv ? "#00c853" : "#ef4444"} />
                      ))}
                      <LabelList dataKey="conversion_rate" position="right" formatter={(v) => `${Number(v).toFixed(1)}%`} style={{ fontSize: 9, fill: "#4b5563" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          </div>

          <div className="card-white p-5" data-testid="ff-chart-abv">
            <SectionTitle title="Avg Basket Value by location" subtitle="Total Sales ÷ Orders — how valuable each customer transaction is" />
            {byABV.length === 0 ? <Empty /> : (
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={byABV.slice(0, 25)} margin={{ bottom: 80 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="location" interval={0} angle={-30} textAnchor="end" height={90} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip formatters={{ abv: (v, p) => `${fmtKES(v)} · ${fmtNum(p?.orders || 0)} orders` }} />} />
                    <Bar dataKey="abv" fill="#00c853" radius={[5, 5, 0, 0]} name="ABV">
                      <LabelList dataKey="abv" position="top" formatter={(v) => fmtKES(v)} style={{ fontSize: 10, fill: "#4b5563" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card-white p-5" data-testid="ff-table">
            <SectionTitle
              title="Location-level breakdown"
              subtitle={`${scopedEnriched.length} locations · click any column to sort`}
              action={
                <span className="pill-neutral flex items-center gap-1.5">
                  <TrendUp size={12} /> Conversion benchmark: {fmtPct(groupAvgConv, 2)}
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
                    <span className="inline-flex items-center gap-2 font-medium">
                      <Storefront size={14} className="text-muted" />
                      {r.location}
                    </span>
                  ),
                },
                { key: "total_footfall", label: "Footfall", numeric: true, render: (r) => fmtNum(r.total_footfall) },
                ...(compareMode !== "none" ? [{
                  key: "prev_footfall",
                  label: compareMode === "last_month" ? "Footfall (LM)" : "Footfall (LY)",
                  numeric: true,
                  render: (r) => <span className="text-muted">{fmtNum(r.prev_footfall)}</span>,
                  csv: (r) => r.prev_footfall,
                }, {
                  key: "footfall_delta",
                  label: "Δ Footfall",
                  numeric: true,
                  sortValue: (r) => r.footfall_delta == null ? -9999 : r.footfall_delta,
                  render: (r) => <Delta value={r.footfall_delta} precision={1} />,
                  csv: (r) => r.footfall_delta == null ? "" : r.footfall_delta.toFixed(2),
                }] : []),
                { key: "orders", label: "Orders", numeric: true, render: (r) => fmtNum(r.orders) },
                {
                  key: "conversion_rate",
                  label: "Conversion",
                  numeric: true,
                  render: (r) => {
                    const cr = r.conversion_rate || 0;
                    const pill = cr >= groupAvgConv + 3 ? "pill-green" : cr >= groupAvgConv - 2 ? "pill-amber" : "pill-red";
                    return <span className={pill}>{fmtPct(cr, 2)}</span>;
                  },
                  csv: (r) => r.conversion_rate?.toFixed(2),
                },
                { key: "abv", label: "ABV", numeric: true, render: (r) => fmtKES(r.abv), csv: (r) => r.abv?.toFixed(2) },
                { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
              ]}
              rows={scopedEnriched}
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
