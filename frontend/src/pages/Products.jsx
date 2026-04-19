import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtPct, buildParams } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import {
  Gauge, Star, TrendDown, Tag, Package, Coins, MagnifyingGlass,
} from "@phosphor-icons/react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip, Cell,
} from "recharts";

const sorPillClass = (p) => {
  if (p == null) return "pill-neutral";
  if (p < 30) return "pill-red";
  if (p < 60) return "pill-amber";
  return "pill-green";
};

const Products = () => {
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries, channels } = applied;
  const filters = { dateFrom, dateTo, countries, channels };

  const [sor, setSor] = useState([]);
  const [stockSales, setStockSales] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [top, setTop] = useState([]);
  const [newStyles, setNewStyles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = buildParams(filters);
    Promise.all([
      api.get("/sor", { params: p }),
      api.get("/subcategory-stock-sales", { params: p }),
      api.get("/kpis", { params: p }),
      api.get("/top-skus", { params: { ...p, limit: 20 } }),
      api.get("/analytics/new-styles", { params: p }),
    ])
      .then(([s, ss, k, t, ns]) => {
        if (cancelled) return;
        setSor(s.data || []);
        setStockSales(ss.data || []);
        setKpis(k.data);
        setTop(t.data || []);
        setNewStyles(ns.data || []);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels)]);

  const avgSor = sor.length ? sor.reduce((s, r) => s + (r.sor_percent || 0), 0) / sor.length : 0;
  const hi = sor.filter((r) => (r.sor_percent || 0) > 60).length;
  const mid = sor.filter((r) => (r.sor_percent || 0) >= 30 && (r.sor_percent || 0) <= 60).length;
  const lo = sor.filter((r) => (r.sor_percent || 0) < 30).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? sor.filter((r) =>
          (r.style_name || "").toLowerCase().includes(q) ||
          (r.collection || "").toLowerCase().includes(q) ||
          (r.brand || "").toLowerCase().includes(q)
        )
      : sor;
    return [...base].sort((a, b) => (b.units_sold || 0) - (a.units_sold || 0));
  }, [sor, search]);

  // Tornado chart data — stock % (left negative) vs sales % (right positive) per subcategory
  const tornado = useMemo(() => {
    return [...stockSales]
      .sort((a, b) => (b.pct_of_total_sold || 0) - (a.pct_of_total_sold || 0))
      .map((r) => ({
        subcategory: r.subcategory,
        stock_neg: -(r.pct_of_total_stock || 0),
        stock: r.pct_of_total_stock || 0,
        sold: r.pct_of_total_sold || 0,
        sor: r.sor_percent || 0,
      }));
  }, [stockSales]);

  return (
    <div className="space-y-6" data-testid="products-page">
      <div>
        <div className="eyebrow">Dashboard · Products</div>
        <h1 className="font-extrabold text-[28px] tracking-tight mt-1">Products</h1>
        <p className="text-muted text-[13px] mt-0.5">For Head of Products — style & subcategory performance</p>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && kpis && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard testId="pr-kpi-styles" accent label="Styles Tracked" value={fmtNum(sor.length)} icon={Tag} showDelta={false} />
            <KPICard testId="pr-kpi-units" label="Total Units Sold" value={fmtNum(kpis.total_units)} icon={Package} showDelta={false} />
            <KPICard testId="pr-kpi-sales" label="Total Sales" value={fmtKES(kpis.total_sales)} icon={Coins} showDelta={false} />
            <KPICard testId="pr-kpi-asp" label="Avg Selling Price" value={fmtKES(kpis.avg_selling_price)} showDelta={false} />
          </div>

          <div className="card-white p-5" data-testid="tornado-chart">
            <SectionTitle title="Subcategory: Stock vs Sales" subtitle="% of total stock (blue, left) vs % of total units sold (green, right)" />
            {tornado.length === 0 ? <Empty /> : (
              <div style={{ width: "100%", height: 28 + tornado.length * 28 }}>
                <ResponsiveContainer>
                  <BarChart data={tornado} layout="vertical" stackOffset="sign" margin={{ left: 20, right: 60 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => `${Math.abs(v).toFixed(0)}%`} tick={{ fontSize: 11 }} domain={[-30, 30]} />
                    <YAxis type="category" dataKey="subcategory" width={180} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v, name) => {
                        if (name === "stock_neg") return [`${Math.abs(v).toFixed(2)}%`, "Stock %"];
                        if (name === "sold") return [`${Number(v).toFixed(2)}%`, "Sold %"];
                        return v;
                      }}
                    />
                    <Bar dataKey="stock_neg" fill="#4b7bec" stackId="a" />
                    <Bar dataKey="sold" fill="#00c853" stackId="b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex gap-5 mt-3 text-[12px] text-muted">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: "#4b7bec" }} /> % of total stock</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-brand-strong" /> % units sold</span>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard testId="sor-k-avg" accent label="Avg Group SOR" value={fmtPct(avgSor)} icon={Gauge} showDelta={false} />
            <KPICard testId="sor-k-hi" label="Styles > 60%" value={fmtNum(hi)} icon={Star} showDelta={false} />
            <KPICard testId="sor-k-mid" label="Styles 30-60%" value={fmtNum(mid)} showDelta={false} />
            <KPICard testId="sor-k-lo" label="Styles < 30%" value={fmtNum(lo)} icon={TrendDown} showDelta={false} higherIsBetter={false} />
          </div>

          <div className="card-white p-5" data-testid="sor-table-card">
            <SectionTitle
              title={`SOR by style · ${filtered.length} items`}
              subtitle="Sorted by units sold descending"
              action={
                <div className="flex items-center gap-2 input-pill min-w-[260px]">
                  <MagnifyingGlass size={14} className="text-muted" />
                  <input
                    placeholder="Search style, collection, brand…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="products-search"
                    className="bg-transparent outline-none text-[13px] w-full"
                  />
                </div>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full data" data-testid="sor-table">
                <thead>
                  <tr>
                    <th>Style</th><th>Collection</th><th>Brand</th><th>Subcategory</th>
                    <th className="text-right">Units</th><th className="text-right">Current Stock</th>
                    <th className="text-right">Total Sales</th><th className="text-right">SOR</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={8}><Empty /></td></tr>}
                  {filtered.slice(0, 200).map((r, i) => (
                    <tr key={(r.style_name || "") + i}>
                      <td className="font-medium max-w-[280px] truncate" title={r.style_name}>{r.style_name}</td>
                      <td className="text-muted">{r.collection || "—"}</td>
                      <td><span className="pill-neutral">{r.brand || "—"}</span></td>
                      <td className="text-muted">{r.product_type || "—"}</td>
                      <td className="text-right num font-semibold">{fmtNum(r.units_sold)}</td>
                      <td className="text-right num">{fmtNum(r.current_stock)}</td>
                      <td className="text-right num font-bold text-brand">{fmtKES(r.total_sales)}</td>
                      <td className="text-right"><span className={sorPillClass(r.sor_percent)}>{fmtPct(r.sor_percent)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card-white p-5" data-testid="products-top-skus">
            <SectionTitle title="Top 20 SKUs" subtitle="Best-selling products across the scope — Product Name & SKU (style key)" />
            <div className="overflow-x-auto">
              <table className="w-full data">
                <thead>
                  <tr>
                    <th>#</th><th>Product Name</th><th>SKU</th><th>Brand</th><th>Subcategory</th>
                    <th className="text-right">Units</th><th className="text-right">Total Sales</th><th className="text-right">Avg Price</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((s, i) => (
                    <tr key={(s.style_name || "") + i}>
                      <td className="text-muted num">{i + 1}</td>
                      <td className="font-medium max-w-[280px] truncate" title={s.style_name}>{s.style_name}</td>
                      <td className="font-mono text-[11px] text-muted">{s.collection || "—"}</td>
                      <td><span className="pill-neutral">{s.brand || "—"}</span></td>
                      <td className="text-muted">{s.product_type || "—"}</td>
                      <td className="text-right num font-semibold">{fmtNum(s.units_sold)}</td>
                      <td className="text-right num font-bold text-brand">{fmtKES(s.total_sales)}</td>
                      <td className="text-right num">{fmtKES(s.avg_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card-white p-5" data-testid="new-styles-section">
            <SectionTitle
              title={`New styles performance · ${newStyles.length} styles`}
              subtitle="Styles whose first ever sale is within the last 3 months. Performance shown for the selected period."
            />
            {newStyles.length === 0 ? <Empty label="No new styles launched in the last 90 days." /> : (
              <div className="overflow-x-auto">
                <table className="w-full data" data-testid="new-styles-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product Name</th>
                      <th>Collection</th>
                      <th>Brand</th>
                      <th>Subcategory</th>
                      <th className="text-right">Units (Period)</th>
                      <th className="text-right">Sales (Period)</th>
                      <th className="text-right">Units (Since Launch)</th>
                      <th className="text-right">Sales (Since Launch)</th>
                      <th className="text-right">Current Stock</th>
                      <th className="text-right">SOR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newStyles.slice(0, 100).map((r, i) => (
                      <tr key={(r.style_name || "") + i}>
                        <td className="text-muted num">{i + 1}</td>
                        <td className="font-medium max-w-[260px] truncate" title={r.style_name}>{r.style_name}</td>
                        <td className="text-muted">{r.collection || "—"}</td>
                        <td><span className="pill-neutral">{r.brand || "—"}</span></td>
                        <td className="text-muted">{r.product_type || "—"}</td>
                        <td className="text-right num font-semibold">{fmtNum(r.units_sold_period)}</td>
                        <td className="text-right num font-bold text-brand">{fmtKES(r.total_sales_period)}</td>
                        <td className="text-right num">{fmtNum(r.units_sold_launch)}</td>
                        <td className="text-right num">{fmtKES(r.total_sales_launch)}</td>
                        <td className="text-right num">{fmtNum(r.current_stock)}</td>
                        <td className="text-right"><span className={sorPillClass(r.sor_percent)}>{fmtPct(r.sor_percent)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Products;
