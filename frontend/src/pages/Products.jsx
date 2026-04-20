import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtPct, buildParams } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import MultiSelect from "@/components/MultiSelect";
import SortableTable from "@/components/SortableTable";
import { ChartTooltip, Delta } from "@/components/ChartHelpers";
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

const BRAND_OPTIONS = ["Vivo", "Safari", "Zoya", "Sowairina", "Third Party Brands"];

const TornadoChart = ({ data, title, subtitle, testId }) => (
  <div className="card-white p-5" data-testid={testId}>
    <SectionTitle title={title} subtitle={subtitle} />
    {data.length === 0 ? <Empty /> : (
      <div style={{ width: "100%", height: 24 + data.length * 22 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" stackOffset="sign" margin={{ left: 10, right: 50, top: 4 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => `${Math.abs(v).toFixed(0)}%`} tick={{ fontSize: 10 }} domain={[-25, 25]} />
            <YAxis type="category" dataKey="subcategory" width={170} tick={{ fontSize: 10 }} />
            <Tooltip content={
              <ChartTooltip
                formatters={{
                  stock_neg: (v) => `${Math.abs(v).toFixed(2)}%`,
                  sold: (v) => `${Number(v).toFixed(2)}%`,
                  units_sold: (v) => fmtNum(v),
                }}
              />
            } />
            <Bar dataKey="stock_neg" fill="#4b7bec" stackId="a" name="Stock %" />
            <Bar dataKey="sold" fill="#00c853" stackId="b" name="Sold %" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )}
    <div className="flex gap-5 mt-3 text-[11px] text-muted">
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: "#4b7bec" }} /> % of total stock</span>
      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-brand-strong" /> % units sold</span>
    </div>
  </div>
);

const Products = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;
  const [brands, setBrands] = useState([]);
  const filters = { dateFrom, dateTo, countries, channels };

  const [sor, setSor] = useState([]);
  const [stockSales, setStockSales] = useState([]);
  const [stsByCat, setStsByCat] = useState([]);
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
    // Brand filter is applied client-side (upstream `product` does prefix match
    // on product_name, not brand, so server-side filtering is unreliable).
    Promise.all([
      api.get("/sor", { params: p }),
      api.get("/analytics/stock-to-sales-by-subcat", { params: p }),
      api.get("/analytics/stock-to-sales-by-category", { params: p }),
      api.get("/kpis", { params: p }),
      api.get("/top-skus", { params: { ...p, limit: 200 } }),
      api.get("/analytics/new-styles", { params: p }),
    ])
      .then(([s, ss, cat, k, t, ns]) => {
        if (cancelled) return;
        setSor(s.data || []);
        setStockSales(ss.data || []);
        setStsByCat(cat.data || []);
        setKpis(k.data);
        setTop(t.data || []);
        setNewStyles(ns.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), JSON.stringify(brands), dataVersion]);

  // Client-side filter on results when multiple brands picked (upstream `product`
  // is a single-value filter).
  const filterByBrand = (rows) => {
    if (!brands.length) return rows;
    const bs = new Set(brands.map((b) => b.toLowerCase()));
    return rows.filter((r) => bs.has((r.brand || "").toLowerCase()));
  };

  const avgSor = sor.length ? sor.reduce((s, r) => s + (r.sor_percent || 0), 0) / sor.length : 0;
  const hi = sor.filter((r) => (r.sor_percent || 0) > 60).length;
  const mid = sor.filter((r) => (r.sor_percent || 0) >= 30 && (r.sor_percent || 0) <= 60).length;
  const lo = sor.filter((r) => (r.sor_percent || 0) < 30).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const brandFiltered = filterByBrand(sor);
    const base = q
      ? brandFiltered.filter((r) =>
          (r.style_name || "").toLowerCase().includes(q) ||
          (r.collection || "").toLowerCase().includes(q) ||
          (r.brand || "").toLowerCase().includes(q)
        )
      : brandFiltered;
    return [...base].sort((a, b) => (b.units_sold || 0) - (a.units_sold || 0));
    // eslint-disable-next-line
  }, [sor, search, brands]);

  // Tornado split: Top 25 + Bottom 15 by units sold.
  const tornadoSorted = useMemo(() => {
    return [...stockSales]
      .sort((a, b) => (b.units_sold || 0) - (a.units_sold || 0))
      .map((r) => ({
        subcategory: r.subcategory,
        units_sold: r.units_sold || 0,
        stock_neg: -(r.pct_of_total_stock || 0),
        stock: r.pct_of_total_stock || 0,
        sold: r.pct_of_total_sold || 0,
        sor: r.sor_percent || 0,
      }));
  }, [stockSales]);
  const tornadoTop25 = useMemo(() => tornadoSorted.slice(0, 25), [tornadoSorted]);
  const tornadoBottom15 = useMemo(() => tornadoSorted.slice(-15).reverse(), [tornadoSorted]);

  const topFiltered = useMemo(() => filterByBrand(top).slice(0, 20), [top, brands]); // eslint-disable-line
  const newStylesFiltered = useMemo(() => filterByBrand(newStyles), [newStyles, brands]); // eslint-disable-line

  return (
    <div className="space-y-6" data-testid="products-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Dashboard · Products</div>
          <h1 className="font-extrabold text-[28px] tracking-tight mt-1">Products</h1>
          <p className="text-muted text-[13px] mt-0.5">For Head of Products — style & subcategory performance</p>
        </div>
        <div className="w-full sm:w-64" data-testid="products-brand-filter">
          <div className="eyebrow mb-1">Brand</div>
          <MultiSelect
            testId="brand-select"
            options={BRAND_OPTIONS.map((b) => ({ value: b, label: b }))}
            value={brands}
            onChange={setBrands}
            placeholder="All brands"
            width={256}
          />
        </div>
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

          <TornadoChart
            data={tornadoTop25}
            title="Subcategory: Stock vs Sales · Top 25"
            subtitle="% of total stock (blue, left) vs % of total units sold (green, right) — ranked by units sold"
            testId="tornado-chart-top"
          />

          <TornadoChart
            data={tornadoBottom15}
            title="Subcategory: Stock vs Sales · Bottom 15"
            subtitle="Slowest-moving subcategories — candidates for markdowns or reassortment"
            testId="tornado-chart-bottom"
          />

          <div className="card-white p-5" data-testid="sts-category-table">
            <SectionTitle
              title="Stock-to-Sales · by Category"
              subtitle="Variance = % of total units sold − % of total stock. Positive variance = outpacing stock."
            />
            <SortableTable
              testId="sts-category"
              exportName="stock-to-sales-by-category.csv"
              initialSort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "category", label: "Category", align: "left" },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold), csv: (r) => r.units_sold },
                { key: "current_stock", label: "Inventory", numeric: true, render: (r) => fmtNum(r.current_stock), csv: (r) => r.current_stock },
                { key: "pct_of_total_sold", label: "% of Total Sales", numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2), csv: (r) => r.pct_of_total_sold?.toFixed(2) },
                { key: "pct_of_total_stock", label: "% of Total Inventory", numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2), csv: (r) => r.pct_of_total_stock?.toFixed(2) },
                {
                  key: "variance",
                  label: "Variance",
                  numeric: true,
                  render: (r) => (
                    <span className={
                      r.variance >= 2 ? "pill-green" :
                      r.variance >= -2 ? "pill-neutral" : "pill-red"
                    }>
                      {r.variance >= 0 ? "+" : ""}{r.variance.toFixed(2)} pts
                    </span>
                  ),
                  csv: (r) => r.variance?.toFixed(2),
                },
              ]}
              rows={stsByCat}
            />
          </div>

          <div className="card-white p-5" data-testid="sts-subcat-table">
            <SectionTitle
              title="Stock-to-Sales · by Subcategory"
              subtitle="Granular view. Sort by Variance to surface biggest stock/sales gaps."
            />
            <SortableTable
              testId="sts-subcat"
              exportName="stock-to-sales-by-subcategory.csv"
              initialSort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "subcategory", label: "Subcategory", align: "left" },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold), csv: (r) => r.units_sold },
                { key: "current_stock", label: "Inventory", numeric: true, render: (r) => fmtNum(r.current_stock), csv: (r) => r.current_stock },
                { key: "pct_of_total_sold", label: "% of Total Sales", numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2), csv: (r) => r.pct_of_total_sold?.toFixed(2) },
                { key: "pct_of_total_stock", label: "% of Total Inventory", numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2), csv: (r) => r.pct_of_total_stock?.toFixed(2) },
                {
                  key: "variance",
                  label: "Variance",
                  numeric: true,
                  render: (r) => (
                    <span className={
                      r.variance >= 2 ? "pill-green" :
                      r.variance >= -2 ? "pill-neutral" : "pill-red"
                    }>
                      {r.variance >= 0 ? "+" : ""}{r.variance.toFixed(2)} pts
                    </span>
                  ),
                  csv: (r) => r.variance?.toFixed(2),
                },
              ]}
              rows={stockSales}
            />
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
                  {topFiltered.map((s, i) => (
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
              title={`New styles performance · ${newStylesFiltered.length} styles`}
              subtitle="Styles whose first ever sale is within the last 3 months. Performance shown for the selected period."
            />
            {newStylesFiltered.length === 0 ? <Empty label="No new styles launched in the last 90 days." /> : (
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
                    {newStylesFiltered.slice(0, 100).map((r, i) => (
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
