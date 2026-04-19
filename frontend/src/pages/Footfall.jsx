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
} from "recharts";

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
    const spv = footfall ? sales / footfall : 0;
    return { footfall, orders, sales, conv, spv };
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
    const spv = footfall ? sales / footfall : 0;
    return { footfall, orders, sales, conv, spv };
  }, [prev, countries, channels, channelCountry]);

  const compareLbl = compareMode === "last_month" ? "vs LM" : compareMode === "last_year" ? "vs LY" : null;
  const delta = (a, b) => (compareMode !== "none" && b ? pctDelta(a, b) : null);

  const groupAvgConv = totals.conv;

  const byFootfall = useMemo(
    () => [...scoped].sort((a, b) => (b.total_footfall || 0) - (a.total_footfall || 0)),
    [scoped]
  );

  const byConversion = useMemo(
    () => [...scoped].sort((a, b) => (b.conversion_rate || 0) - (a.conversion_rate || 0)),
    [scoped]
  );

  const bySPV = useMemo(
    () => [...scoped].sort((a, b) => (b.sales_per_visitor || 0) - (a.sales_per_visitor || 0)),
    [scoped]
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
        <h1 className="font-extrabold text-[28px] tracking-tight mt-1">Footfall Analysis</h1>
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
              testId="ff-kpi-spv"
              label="Sales / Visitor"
              value={fmtKES(totals.spv)}
              icon={Coins}
              delta={delta(totals.spv, prevTotals.spv)}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card-white p-5" data-testid="ff-chart-footfall">
              <SectionTitle
                title="Footfall by location"
                subtitle={`Total visits per store (top ${Math.min(byFootfall.length, 20)})`}
              />
              {byFootfall.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: 28 + byFootfall.slice(0, 20).length * 26 }}>
                  <ResponsiveContainer>
                    <BarChart data={byFootfall.slice(0, 20)} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="location" width={150} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtNum(v)} />
                      <Bar dataKey="total_footfall" fill="#1a5c38" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card-white p-5" data-testid="ff-chart-conversion">
              <SectionTitle
                title="Conversion rate by location"
                subtitle="Red = below group average · Green = at or above"
                action={
                  <span className="text-[11.5px] text-muted">
                    Group avg: <span className="font-bold text-brand">{fmtPct(groupAvgConv, 2)}</span>
                  </span>
                }
              />
              {byConversion.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: 28 + byConversion.slice(0, 20).length * 26 }}>
                  <ResponsiveContainer>
                    <BarChart data={byConversion.slice(0, 20)} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="location" width={150} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                      <ReferenceLine x={groupAvgConv} stroke="#9ca3af" strokeDasharray="4 4" />
                      <Bar dataKey="conversion_rate" radius={[0, 5, 5, 0]}>
                        {byConversion.slice(0, 20).map((r, i) => (
                          <Cell key={i} fill={(r.conversion_rate || 0) >= groupAvgConv ? "#00c853" : "#ef4444"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="card-white p-5" data-testid="ff-chart-spv">
            <SectionTitle title="Sales per visitor by location" subtitle="Revenue divided by footfall — how much each walk-in yields" />
            {bySPV.length === 0 ? <Empty /> : (
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={bySPV.slice(0, 20)} margin={{ bottom: 80 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="location" interval={0} angle={-30} textAnchor="end" height={90} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => fmtKES(v)} />
                    <Bar dataKey="sales_per_visitor" fill="#00c853" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card-white p-5" data-testid="ff-table">
            <SectionTitle
              title="Location-level breakdown"
              subtitle={`${scoped.length} locations · sorted by footfall`}
              action={
                <span className="pill-neutral flex items-center gap-1.5">
                  <TrendUp size={12} /> Conversion benchmark: {fmtPct(groupAvgConv, 2)}
                </span>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full data" data-testid="ff-breakdown-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Location</th>
                    <th>Country</th>
                    <th className="text-right">Footfall</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">Conversion</th>
                    <th className="text-right">Sales / Visitor</th>
                    <th className="text-right">Total Sales</th>
                    {compareMode !== "none" && <th className="text-right">Δ Footfall</th>}
                  </tr>
                </thead>
                <tbody>
                  {scoped.length === 0 && <tr><td colSpan={compareMode !== "none" ? 9 : 8}><Empty /></td></tr>}
                  {byFootfall.map((r, i) => {
                    const c = channelCountry[r.location] || "—";
                    const prevR = prevMap.get(r.location);
                    const d = prevR ? pctDelta(r.total_footfall, prevR.total_footfall) : null;
                    const cr = r.conversion_rate || 0;
                    const pill = cr >= groupAvgConv + 3 ? "pill-green" : cr >= groupAvgConv - 2 ? "pill-amber" : "pill-red";
                    return (
                      <tr key={r.location + i}>
                        <td className="text-muted num">{i + 1}</td>
                        <td className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            <Storefront size={14} className="text-muted" />
                            {r.location}
                          </span>
                        </td>
                        <td>{COUNTRY_FLAGS[c] || "🌍"} {c}</td>
                        <td className="text-right num font-semibold">{fmtNum(r.total_footfall)}</td>
                        <td className="text-right num">{fmtNum(r.orders)}</td>
                        <td className="text-right"><span className={pill}>{fmtPct(cr, 2)}</span></td>
                        <td className="text-right num">{fmtKES(r.sales_per_visitor)}</td>
                        <td className="text-right num font-bold text-brand">{fmtKES(r.total_sales)}</td>
                        {compareMode !== "none" && (
                          <td className={`text-right num font-semibold ${d == null ? "text-muted" : d > 0 ? "delta-up" : "delta-down"}`}>
                            {d == null ? "—" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}%`}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
