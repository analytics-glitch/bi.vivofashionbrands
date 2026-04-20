import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
    ])
      .then(([f, p, l]) => {
        if (cancelled) return;
        setRows(f.data || []);
        setPrev(p.data || []);
        setLocations(l.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, compareMode, dataVersion]);

  const channelCountry = useMemo(() => {
    const m = {};
    for (const l of locations) m[l.channel] = l.country;
    return m;
  }, [locations]);

  // Filter by country + channel selection, exclude >50% conversion (data-quality rule)
  const scoped = useMemo(() => {
    return rows
      .filter((r) => (r.conversion_rate || 0) <= 50)
      .filter((r) => {
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
    const footfall = scoped.reduce((s, r) => s + (r.total_footfall || 0), 0);
    const orders = scoped.reduce((s, r) => s + (r.orders || 0), 0);
    const sales = scoped.reduce((s, r) => s + (r.total_sales || 0), 0);
    const conv = footfall ? (orders / footfall) * 100 : 0;
    const abv = orders ? sales / orders : 0; // Avg Basket Value = Sales / Orders
    return { footfall, orders, sales, conv, abv };
  }, [scoped]);

  const prevTotals = useMemo(() => {
    const scopedPrev = prev
      .filter((r) => (r.conversion_rate || 0) <= 50)
      .filter((r) => {
        if (countries.length) {
          const c = channelCountry[r.location];
          if (!c || !countries.includes(c)) return false;
        }
        if (channels.length && !channels.includes(r.location)) return false;
        return true;
      });
    const footfall = scopedPrev.reduce((s, r) => s + (r.total_footfall || 0), 0);
    const orders = scopedPrev.reduce((s, r) => s + (r.orders || 0), 0);
    const sales = scopedPrev.reduce((s, r) => s + (r.total_sales || 0), 0);
    const conv = footfall ? (orders / footfall) * 100 : 0;
    const abv = orders ? sales / orders : 0;
    return { footfall, orders, sales, conv, abv };
  }, [prev, countries, channels, channelCountry]);

  const compareLbl = compareMode === "last_month" ? "vs LM" : compareMode === "last_year" ? "vs LY" : null;
  const delta = (a, b) => (compareMode !== "none" && b ? pctDelta(a, b) : null);

  const groupAvgConv = totals.conv;

  // Scoped rows enriched with previous-period footfall + ABV + delta.
  const scopedEnriched = useMemo(() => {
    return scoped.map((r) => {
      const prevR = prevMap.get(r.location);
      const abv = r.orders ? (r.total_sales || 0) / r.orders : 0;
      const prevFootfall = prevR?.total_footfall || 0;
      const footfallDelta = prevFootfall ? ((r.total_footfall - prevFootfall) / prevFootfall) * 100 : null;
      return { ...r, abv, prev_footfall: prevFootfall, footfall_delta: footfallDelta };
    });
  }, [scoped, prevMap]);

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

  // Excluded locations (data-quality) — always Vivo Junction + anyone >50% conversion
  const excluded = useMemo(
    () => rows.filter((r) => (r.conversion_rate || 0) > 50),
    [rows]
  );

  return (
    <div className="space-y-6" data-testid="footfall-page">
      <div>
        <div className="eyebrow">Dashboard · Footfall Analysis</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">Footfall Analysis</h1>
        <p className="text-muted text-[13px] mt-0.5">
          {fmtDate(dateFrom)} → {fmtDate(dateTo)} · locations with conversion rate &gt;50% excluded (data-quality)
        </p>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
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
              value={fmtNum(totals.orders)}
              icon={ShoppingCart}
              delta={delta(totals.orders, prevTotals.orders)}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              testId="ff-kpi-conv"
              label="Group Conversion"
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
