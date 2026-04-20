import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import {
  api,
  fmtKES,
  fmtNum,
  fmtPct,
  fmtDate,
  fmtDelta,
  pctDelta,
  comparePeriod,
  shiftISO,
  COUNTRY_FLAGS,
} from "@/lib/api";
import { Loading, ErrorBox } from "@/components/common";
import { Printer, CalendarBlank } from "@phosphor-icons/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

const KPIBox = ({ label, value, deltaLM, deltaLY, invert = false, testId }) => {
  const cls = (d) => {
    if (d === null || d === undefined) return "delta-flat";
    const good = invert ? d < 0 : d > 0;
    const bad = invert ? d > 0 : d < 0;
    if (Math.abs(d) < 0.05) return "delta-flat";
    return good ? "delta-up" : bad ? "delta-down" : "delta-flat";
  };
  const arrow = (d) => {
    if (d === null || d === undefined) return "";
    if (Math.abs(d) < 0.05) return "◆";
    return d > 0 ? "▲" : "▼";
  };
  return (
    <div
      className="border border-border rounded-xl p-4 bg-white"
      data-testid={testId}
    >
      <div className="eyebrow">{label}</div>
      <div className="mt-2 kpi-value num text-[20px]">{value}</div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className={cls(deltaLM)}>
          <span className="text-muted font-normal mr-1">LM</span>
          {arrow(deltaLM)} {deltaLM !== null && deltaLM !== undefined ? fmtDelta(deltaLM) : "—"}
        </span>
        <span className={cls(deltaLY)}>
          <span className="text-muted font-normal mr-1">LY</span>
          {arrow(deltaLY)} {deltaLY !== null && deltaLY !== undefined ? fmtDelta(deltaLY) : "—"}
        </span>
      </div>
    </div>
  );
};

const SectionHeader = ({ n, title }) => (
  <div className="mt-8 mb-3">
    <h2 className="accent-heading font-bold text-[16px] text-brand-deep border-b-2 border-brand/35 pb-1.5">
      {n} · {title}
    </h2>
  </div>
);

const CEOReport = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, dataVersion } = applied;

  const [kpi, setKpi] = useState(null);
  const [kpiLM, setKpiLM] = useState(null);
  const [kpiLY, setKpiLY] = useState(null);
  const [countries, setCountries] = useState([]);
  const [countriesLM, setCountriesLM] = useState([]);
  const [countriesLY, setCountriesLY] = useState([]);
  const [sales, setSales] = useState([]);
  const [salesLM, setSalesLM] = useState([]);
  const [top, setTop] = useState([]);
  const [sor, setSor] = useState([]);
  const [insights, setInsights] = useState(null);
  const [subcats, setSubcats] = useState([]);
  const [footfall, setFootfall] = useState([]);
  const [newStyles, setNewStyles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const lm = comparePeriod(dateFrom, dateTo, "last_month");
    const ly = comparePeriod(dateFrom, dateTo, "last_year");
    const base = { date_from: dateFrom, date_to: dateTo };
    const lmP = { date_from: lm.date_from, date_to: lm.date_to };
    const lyP = { date_from: ly.date_from, date_to: ly.date_to };

    Promise.all([
      api.get("/kpis", { params: base }),
      api.get("/kpis", { params: lmP }),
      api.get("/kpis", { params: lyP }),
      api.get("/country-summary", { params: base }),
      api.get("/country-summary", { params: lmP }),
      api.get("/country-summary", { params: lyP }),
      api.get("/sales-summary", { params: base }),
      api.get("/sales-summary", { params: lmP }),
      api.get("/top-skus", { params: { ...base, limit: 20 } }),
      api.get("/sor", { params: base }),
      api.get("/analytics/insights", { params: base }),
      api.get("/subcategory-stock-sales", { params: base }),
      api.get("/footfall", { params: base }),
      api.get("/analytics/new-styles", { params: base }),
    ])
      .then(([k, klm, kly, cs, cslm, csly, s, slm, t, r, ins, sc, ff, ns]) => {
        if (cancelled) return;
        setKpi(k.data);
        setKpiLM(klm.data);
        setKpiLY(kly.data);
        setCountries(cs.data || []);
        setCountriesLM(cslm.data || []);
        setCountriesLY(csly.data || []);
        setSales(s.data || []);
        setSalesLM(slm.data || []);
        setTop(t.data || []);
        setSor(r.data || []);
        setInsights(ins.data);
        setSubcats(sc.data || []);
        setFootfall(ff.data || []);
        setNewStyles(ns.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, dataVersion]);

  const delta = (k, prev) => {
    if (!kpi || !prev) return null;
    return pctDelta(kpi[k], prev[k]);
  };

  const cMap = (arr) => {
    const m = new Map();
    for (const r of arr) m.set(r.country, r);
    return m;
  };
  const cLMm = useMemo(() => cMap(countriesLM), [countriesLM]);
  const cLYm = useMemo(() => cMap(countriesLY), [countriesLY]);
  const salesLMm = useMemo(() => {
    const m = new Map();
    for (const r of salesLM) m.set(r.channel, r);
    return m;
  }, [salesLM]);

  const top10Loc = useMemo(() => {
    return [...sales]
      .sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0))
      .slice(0, 10);
  }, [sales]);

  const totalsRow = useMemo(() => {
    const acc = { country: "TOTAL", total_sales: 0, orders: 0, units_sold: 0, total_returns: 0 };
    const acc_prev_lm = { total_sales: 0 };
    const acc_prev_ly = { total_sales: 0 };
    for (const c of countries) {
      acc.total_sales += c.total_sales || 0;
      acc.orders += c.orders || 0;
      acc.units_sold += c.units_sold || 0;
      acc.total_returns += c.returns || 0;
    }
    for (const c of countriesLM) acc_prev_lm.total_sales += c.total_sales || 0;
    for (const c of countriesLY) acc_prev_ly.total_sales += c.total_sales || 0;
    acc.avg_basket = acc.orders ? acc.total_sales / acc.orders : 0;
    acc.return_rate = kpi?.return_rate ?? 0;
    acc.lm = acc_prev_lm.total_sales ? pctDelta(acc.total_sales, acc_prev_lm.total_sales) : null;
    acc.ly = acc_prev_ly.total_sales ? pctDelta(acc.total_sales, acc_prev_ly.total_sales) : null;
    return acc;
  }, [countries, countriesLM, countriesLY, kpi]);

  const sortedSor = useMemo(
    () => [...sor].sort((a, b) => (b.sor_percent || 0) - (a.sor_percent || 0)),
    [sor]
  );
  const bestSor = sortedSor.slice(0, 10);
  const worstSor = sortedSor.slice(-10).reverse();
  const starsCount = sor.filter((r) => (r.sor_percent || 0) > 80).length;
  const slowCount = sor.filter((r) => (r.sor_percent || 0) < 20).length;
  const avgSor = sor.length
    ? sor.reduce((s, r) => s + (r.sor_percent || 0), 0) / sor.length
    : 0;

  // SOR distribution buckets
  const distBuckets = useMemo(() => {
    const buckets = [
      { range: "0–20%", count: 0, color: "#dc2626" },
      { range: "20–40%", count: 0, color: "#ea580c" },
      { range: "40–60%", count: 0, color: "#d97706" },
      { range: "60–80%", count: 0, color: "#059669" },
      { range: "80–100%", count: 0, color: "#1a5c38" },
    ];
    for (const r of sor) {
      const p = r.sor_percent || 0;
      if (p < 20) buckets[0].count++;
      else if (p < 40) buckets[1].count++;
      else if (p < 60) buckets[2].count++;
      else if (p < 80) buckets[3].count++;
      else buckets[4].count++;
    }
    return buckets;
  }, [sor]);

  const top5Returns = useMemo(() => {
    return [...sales]
      .filter((r) => (r.returns || 0) > 0)
      .sort((a, b) => (b.returns || 0) - (a.returns || 0))
      .slice(0, 5);
  }, [sales]);

  // Top 3 new-style rising stars by period sales; flag those with SOR > 60%
  const risingStars = useMemo(() => {
    return [...newStyles]
      .sort((a, b) => (b.total_sales_period || 0) - (a.total_sales_period || 0))
      .slice(0, 3)
      .map((r) => ({
        ...r,
        doubleDown: (r.sor_percent || 0) > 60,
      }));
  }, [newStyles]);

  return (
    <div data-testid="ceo-report-page">
      <div className="flex items-center justify-between pb-4 border-b border-border no-print mb-4">
        <div>
          <div className="eyebrow">Dashboard · Executive</div>
          <h1 className="font-extrabold text-[26px] tracking-tight mt-1">
            CEO Report
          </h1>
        </div>
        <button
          onClick={() => window.print()}
          className="btn-primary flex items-center gap-1.5"
          data-testid="print-report-btn"
        >
          <Printer size={14} weight="bold" /> Print / Export PDF
        </button>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && kpi && (
        <div
          className="print-page bg-white border border-border rounded-2xl p-8 md:p-10 max-w-[1000px] mx-auto"
          data-testid="ceo-report-content"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-6 pb-5 border-b border-border">
            <div>
              <div className="eyebrow text-brand-deep">Vivo Fashion Group</div>
              <h1 className="font-extrabold text-[26px] tracking-tight mt-1">
                Executive Sales Report
              </h1>
              <div className="text-[12.5px] text-muted mt-2 flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <CalendarBlank size={13} />
                  {fmtDate(dateFrom)} → {fmtDate(dateTo)}
                </span>
                <span>· Generated {fmtDate(new Date().toISOString())}</span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-xl bg-brand text-white grid place-items-center font-extrabold text-xl">
              V
            </div>
          </div>

          {/* Section 1 — Group Performance Scorecard */}
          <SectionHeader n="1" title="Group Performance Scorecard" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <KPIBox
              label="Total Sales"
              value={fmtKES(kpi.total_sales)}
              deltaLM={delta("total_sales", kpiLM)}
              deltaLY={delta("total_sales", kpiLY)}
              testId="ceo-k-total"
            />
            <KPIBox
              label="Net Sales"
              value={fmtKES(kpi.net_sales)}
              deltaLM={delta("net_sales", kpiLM)}
              deltaLY={delta("net_sales", kpiLY)}
              testId="ceo-k-net"
            />
            <KPIBox
              label="Returns"
              value={fmtKES(kpi.total_returns)}
              deltaLM={delta("total_returns", kpiLM)}
              deltaLY={delta("total_returns", kpiLY)}
              invert
              testId="ceo-k-returns"
            />
            <KPIBox
              label="Total Orders"
              value={fmtNum(kpi.total_orders)}
              deltaLM={delta("total_orders", kpiLM)}
              deltaLY={delta("total_orders", kpiLY)}
              testId="ceo-k-orders"
            />
            <KPIBox
              label="Total Units"
              value={fmtNum(kpi.total_units)}
              deltaLM={delta("total_units", kpiLM)}
              deltaLY={delta("total_units", kpiLY)}
              testId="ceo-k-units"
            />
            <KPIBox
              label="Avg Basket Size"
              value={fmtKES(kpi.avg_basket_size)}
              deltaLM={delta("avg_basket_size", kpiLM)}
              deltaLY={delta("avg_basket_size", kpiLY)}
              testId="ceo-k-basket"
            />
            <KPIBox
              label="Avg Selling Price"
              value={fmtKES(kpi.avg_selling_price)}
              deltaLM={delta("avg_selling_price", kpiLM)}
              deltaLY={delta("avg_selling_price", kpiLY)}
              testId="ceo-k-asp"
            />
            <KPIBox
              label="Return Rate"
              value={fmtPct(kpi.return_rate, 2)}
              deltaLM={delta("return_rate", kpiLM)}
              deltaLY={delta("return_rate", kpiLY)}
              invert
              testId="ceo-k-rr"
            />
          </div>

          {/* Section 2 — Country Performance */}
          <SectionHeader n="2" title="Country Performance" />
          <div className="overflow-x-auto">
            <table className="w-full data" data-testid="ceo-country-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th className="text-right">Total Sales</th>
                  <th className="text-right">vs LM</th>
                  <th className="text-right">vs LY</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Units</th>
                  <th className="text-right">Avg Basket</th>
                  <th className="text-right">Returns</th>
                </tr>
              </thead>
              <tbody>
                {["Kenya", "Uganda", "Rwanda", "Online"].map((cname) => {
                  const c = countries.find((x) => x.country === cname);
                  const lm = cLMm.get(cname);
                  const ly = cLYm.get(cname);
                  const dLM = c && lm ? pctDelta(c.total_sales, lm.total_sales) : null;
                  const dLY = c && ly ? pctDelta(c.total_sales, ly.total_sales) : null;
                  return (
                    <tr key={cname}>
                      <td className="font-medium">
                        {COUNTRY_FLAGS[cname] || "🌍"} {cname}
                      </td>
                      <td className="text-right num font-bold">{fmtKES(c?.total_sales)}</td>
                      <td className={`text-right num ${dLM > 0 ? "delta-up" : dLM < 0 ? "delta-down" : "delta-flat"}`}>
                        {dLM !== null ? `${dLM > 0 ? "▲" : "▼"} ${fmtDelta(dLM)}` : "—"}
                      </td>
                      <td className={`text-right num ${dLY > 0 ? "delta-up" : dLY < 0 ? "delta-down" : "delta-flat"}`}>
                        {dLY !== null ? `${dLY > 0 ? "▲" : "▼"} ${fmtDelta(dLY)}` : "—"}
                      </td>
                      <td className="text-right num">{fmtNum(c?.orders)}</td>
                      <td className="text-right num">{fmtNum(c?.units_sold)}</td>
                      <td className="text-right num">{fmtKES(c?.avg_basket_size)}</td>
                      <td className="text-right num">{fmtKES(c?.returns)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-panel font-bold">
                  <td>TOTAL</td>
                  <td className="text-right num">{fmtKES(totalsRow.total_sales)}</td>
                  <td className={`text-right num ${totalsRow.lm > 0 ? "delta-up" : totalsRow.lm < 0 ? "delta-down" : "delta-flat"}`}>
                    {totalsRow.lm !== null ? `${totalsRow.lm > 0 ? "▲" : "▼"} ${fmtDelta(totalsRow.lm)}` : "—"}
                  </td>
                  <td className={`text-right num ${totalsRow.ly > 0 ? "delta-up" : totalsRow.ly < 0 ? "delta-down" : "delta-flat"}`}>
                    {totalsRow.ly !== null ? `${totalsRow.ly > 0 ? "▲" : "▼"} ${fmtDelta(totalsRow.ly)}` : "—"}
                  </td>
                  <td className="text-right num">{fmtNum(totalsRow.orders)}</td>
                  <td className="text-right num">{fmtNum(totalsRow.units_sold)}</td>
                  <td className="text-right num">{fmtKES(totalsRow.avg_basket)}</td>
                  <td className="text-right num">{fmtKES(totalsRow.total_returns)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Section 3 — Top 10 Locations */}
          <SectionHeader n="3" title="Top 10 Locations" />
          <div className="overflow-x-auto">
            <table className="w-full data" data-testid="ceo-locations-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Location</th>
                  <th>Country</th>
                  <th className="text-right">Total Sales</th>
                  <th className="text-right">vs LM</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Units</th>
                  <th className="text-right">Avg Basket</th>
                </tr>
              </thead>
              <tbody>
                {top10Loc.map((l, i) => {
                  const prev = salesLMm.get(l.channel);
                  const d = prev ? pctDelta(l.total_sales, prev.total_sales) : null;
                  const basket = l.orders ? l.total_sales / l.orders : l.avg_basket_size;
                  return (
                    <tr key={l.channel + i}>
                      <td className="text-muted num">{i + 1}</td>
                      <td className="font-medium">{l.channel}</td>
                      <td className="text-muted">
                        {COUNTRY_FLAGS[l.country] || "🌍"} {l.country}
                      </td>
                      <td className="text-right num font-bold">{fmtKES(l.total_sales)}</td>
                      <td className={`text-right num ${d > 0 ? "delta-up" : d < 0 ? "delta-down" : "delta-flat"}`}>
                        {d !== null ? `${d > 0 ? "▲" : "▼"} ${fmtDelta(d)}` : "—"}
                      </td>
                      <td className="text-right num">{fmtNum(l.orders)}</td>
                      <td className="text-right num">{fmtNum(l.units_sold)}</td>
                      <td className="text-right num">{fmtKES(basket)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Section 4 — Top 20 Best-Selling Styles */}
          <SectionHeader n="4" title="Top 20 Best-Selling Styles" />
          <div className="overflow-x-auto">
            <table className="w-full data" data-testid="ceo-top-skus">
              <thead>
                <tr>
                  <th className="text-left">Rank</th>
                  <th className="text-left">Style Name</th>
                  <th className="text-left">Subcategory</th>
                  <th className="text-right">Units Sold</th>
                  <th className="text-right">Total Sales KES</th>
                  <th className="text-right">Avg Price KES</th>
                </tr>
              </thead>
              <tbody>
                {top.slice(0, 20).map((s, i) => (
                  <tr key={(s.style_name || "") + i}>
                    <td className="text-muted num">{i + 1}</td>
                    <td className="font-medium max-w-[340px] truncate" title={s.style_name}>
                      {s.style_name || "—"}
                    </td>
                    <td className="text-muted">{s.product_type || "—"}</td>
                    <td className="text-right num font-semibold">{fmtNum(s.units_sold)}</td>
                    <td className="text-right num font-bold">{fmtKES(s.total_sales)}</td>
                    <td className="text-right num">{fmtKES(s.avg_price || (s.units_sold ? (s.total_sales || 0) / s.units_sold : 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Section 5 — Subcategory */}
          <SectionHeader n="5" title="Subcategory Analysis · Head of Products" />
          <div className="overflow-x-auto">
            <table className="w-full data" data-testid="ceo-subcat-table">
              <thead>
                <tr>
                  <th>Subcategory</th>
                  <th className="text-right">Units Sold</th>
                  <th className="text-right">% of Sold</th>
                  <th className="text-right">Current Stock</th>
                  <th className="text-right">% of Stock</th>
                  <th className="text-right">SOR</th>
                </tr>
              </thead>
              <tbody>
                {subcats.slice(0, 15).map((r, i) => {
                  const pill = (r.sor_percent || 0) < 30 ? "pill-red" : (r.sor_percent || 0) < 60 ? "pill-amber" : "pill-green";
                  return (
                    <tr key={r.subcategory + i}>
                      <td className="font-medium">{r.subcategory}</td>
                      <td className="text-right num">{fmtNum(r.units_sold)}</td>
                      <td className="text-right num">{fmtPct(r.pct_of_total_sold)}</td>
                      <td className="text-right num">{fmtNum(r.current_stock)}</td>
                      <td className="text-right num">{fmtPct(r.pct_of_total_stock)}</td>
                      <td className="text-right"><span className={pill}>{fmtPct(r.sor_percent)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Section 6 — SOR */}
          <SectionHeader n="6" title="SOR: Stars & Slow Movers" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
            <KPIBox label="Styles tracked" value={fmtNum(sor.length)} testId="ceo-sor-tracked" />
            <KPIBox label="Avg SOR" value={fmtPct(avgSor)} testId="ceo-sor-avg" />
            <KPIBox label="⭐ Stars (>80%)" value={fmtNum(starsCount)} testId="ceo-sor-stars" />
            <KPIBox label="🐌 Slow (<20%)" value={fmtNum(slowCount)} invert testId="ceo-sor-slow" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-bold text-[13px] mb-2 text-brand-deep">Top 10 Best SOR</h3>
              <table className="w-full data">
                <thead>
                  <tr>
                    <th>Style</th>
                    <th>Collection</th>
                    <th className="text-right">Units</th>
                    <th className="text-right">Stock</th>
                    <th className="text-right">SOR</th>
                  </tr>
                </thead>
                <tbody>
                  {bestSor.map((r, i) => (
                    <tr key={(r.style_name || "") + i}>
                      <td className="font-medium max-w-[180px] truncate" title={r.style_name}>
                        {r.style_name}
                      </td>
                      <td className="text-muted text-[11.5px]">{r.collection}</td>
                      <td className="text-right num">{fmtNum(r.units_sold)}</td>
                      <td className="text-right num">{fmtNum(r.current_stock)}</td>
                      <td className="text-right"><span className="pill-green">{fmtPct(r.sor_percent)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="font-bold text-[13px] mb-2 text-danger">Bottom 10 Worst SOR</h3>
              <table className="w-full data">
                <thead>
                  <tr>
                    <th>Style</th>
                    <th>Collection</th>
                    <th className="text-right">Units</th>
                    <th className="text-right">Stock</th>
                    <th className="text-right">SOR</th>
                  </tr>
                </thead>
                <tbody>
                  {worstSor.map((r, i) => (
                    <tr key={(r.style_name || "") + i} style={{ background: "rgba(220,38,38,0.04)" }}>
                      <td className="font-medium max-w-[180px] truncate" title={r.style_name}>
                        {r.style_name}
                      </td>
                      <td className="text-muted text-[11.5px]">{r.collection}</td>
                      <td className="text-right num">{fmtNum(r.units_sold)}</td>
                      <td className="text-right num">{fmtNum(r.current_stock)}</td>
                      <td className="text-right"><span className="pill-red">{fmtPct(r.sor_percent)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-5 border border-border rounded-xl p-4 bg-white">
            <h3 className="font-bold text-[13px] mb-2">SOR distribution</h3>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={distBuckets} margin={{ top: 10, left: 0, right: 10, bottom: 10 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmtNum(v)} />
                  <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                    {distBuckets.map((b, i) => (
                      <Cell key={i} fill={b.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Section 7 — Returns */}
          <SectionHeader n="7" title="Returns Analysis" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-3">
            <KPIBox label="Total Returns" value={fmtKES(kpi.total_returns)} invert testId="ceo-ret-total" />
            <KPIBox label="Return Rate" value={fmtPct(kpi.return_rate, 2)} invert testId="ceo-ret-rate" />
            <KPIBox
              label="Returned Share of Gross"
              value={fmtPct(
                kpi.gross_sales
                  ? (kpi.total_returns / kpi.gross_sales) * 100
                  : 0,
                2
              )}
              invert
              testId="ceo-ret-share"
            />
          </div>
          <h3 className="font-bold text-[13px] mb-2">Top 5 locations by returns</h3>
          <table className="w-full data" data-testid="ceo-returns-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Location</th>
                <th>Country</th>
                <th className="text-right">Returns</th>
                <th className="text-right">Total Sales</th>
                <th className="text-right">Return Rate</th>
              </tr>
            </thead>
            <tbody>
              {top5Returns.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-muted text-center py-4">
                    No returns recorded in this period.
                  </td>
                </tr>
              )}
              {top5Returns.map((l, i) => {
                const rr = l.gross_sales ? (l.returns / l.gross_sales) * 100 : 0;
                return (
                  <tr key={l.channel + i}>
                    <td className="text-muted num">{i + 1}</td>
                    <td className="font-medium">{l.channel}</td>
                    <td className="text-muted">
                      {COUNTRY_FLAGS[l.country] || "🌍"} {l.country}
                    </td>
                    <td className="text-right num font-bold text-danger">{fmtKES(l.returns)}</td>
                    <td className="text-right num">{fmtKES(l.total_sales)}</td>
                    <td className="text-right num">{fmtPct(rr, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Section 8 — Footfall */}
          <SectionHeader n="8" title="Footfall & Conversion · Top 10" />
          <div className="overflow-x-auto">
            <table className="w-full data" data-testid="ceo-footfall-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Location</th>
                  <th className="text-right">Footfall</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Conversion</th>
                  <th className="text-right">Sales / Visitor</th>
                </tr>
              </thead>
              <tbody>
                {footfall
                  .filter((r) => (r.conversion_rate || 0) <= 50)
                  .sort((a, b) => (b.total_footfall || 0) - (a.total_footfall || 0))
                  .slice(0, 10)
                  .map((r, i) => {
                    const pill = (r.conversion_rate || 0) > 15 ? "pill-green" : (r.conversion_rate || 0) >= 10 ? "pill-amber" : "pill-red";
                    return (
                      <tr key={r.location + i}>
                        <td className="text-muted num">{i + 1}</td>
                        <td className="font-medium">{r.location}</td>
                        <td className="text-right num">{fmtNum(r.total_footfall)}</td>
                        <td className="text-right num">{fmtNum(r.orders)}</td>
                        <td className="text-right"><span className={pill}>{fmtPct(r.conversion_rate)}</span></td>
                        <td className="text-right num">{fmtKES(r.sales_per_visitor)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Section 9 — New Styles: Rising Stars */}
          <SectionHeader n="9" title="New Styles · Rising Stars" />
          <p className="text-[12.5px] text-muted -mt-1 mb-3">
            Top 3 new styles (first sale within last 90 days) ranked by period sales.
            Styles with SOR &gt; 60% are flagged <span className="font-semibold text-brand-deep">⚡ double-down candidates</span> —
            demand is outstripping supply, consider doubling production.
          </p>
          {risingStars.length === 0 ? (
            <div className="text-muted text-[13px] py-4 text-center border border-dashed border-border rounded-xl">
              No new-style launches in the selected period.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="ceo-rising-stars">
                {risingStars.map((r, i) => (
                  <div
                    key={(r.style_name || "") + i}
                    className={`rounded-xl p-4 border ${r.doubleDown ? "border-brand bg-brand-soft" : "border-border bg-white"}`}
                    data-testid={`rising-star-${i + 1}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="eyebrow text-brand-deep">#{i + 1} Rising star</div>
                      {r.doubleDown && (
                        <span className="pill-green text-[10px]" data-testid={`double-down-${i + 1}`}>
                          ⚡ Double-down
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 font-bold text-[14px] leading-tight" title={r.style_name}>
                      {r.style_name}
                    </div>
                    <div className="text-[11.5px] text-muted mt-0.5">
                      {r.brand || "—"} · {r.collection || "—"}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                      <div>
                        <div className="eyebrow">Sales (period)</div>
                        <div className="num font-bold text-brand-deep">{fmtKES(r.total_sales_period)}</div>
                      </div>
                      <div>
                        <div className="eyebrow">Units</div>
                        <div className="num font-semibold">{fmtNum(r.units_sold_period)}</div>
                      </div>
                      <div>
                        <div className="eyebrow">Current Stock</div>
                        <div className="num">{fmtNum(r.current_stock)}</div>
                      </div>
                      <div>
                        <div className="eyebrow">SOR</div>
                        <div>
                          <span className={(r.sor_percent || 0) >= 60 ? "pill-green" : (r.sor_percent || 0) >= 30 ? "pill-amber" : "pill-red"}>
                            {fmtPct(r.sor_percent)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {risingStars.some((r) => r.doubleDown) && (
                <div className="mt-3 p-3 rounded-lg bg-brand-soft border border-brand/30 text-[12.5px] text-foreground">
                  <span className="font-bold text-brand-deep">Action for merchandising: </span>
                  {risingStars
                    .filter((r) => r.doubleDown)
                    .map((r) => r.style_name)
                    .join(", ")}
                  {" — SOR already above 60% and climbing. Worth doubling production before stockout."}
                </div>
              )}
            </>
          )}

          {/* Section 10 — Insights */}
          <SectionHeader n="10" title="Executive Insights" />
          <div
            className="border border-brand/30 bg-brand-soft rounded-xl p-5 text-[13.5px] leading-relaxed text-foreground"
            data-testid="ceo-insights"
          >
            {insights?.text || "Generating insights…"}
          </div>

          <div className="mt-8 pt-4 border-t border-border text-[11px] text-muted text-center">
            Confidential · Vivo Fashion Group · Prepared for CEO & Head of Products
          </div>
        </div>
      )}
    </div>
  );
};

export default CEOReport;
