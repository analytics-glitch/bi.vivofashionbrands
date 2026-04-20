import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtDec, fmtPct, fmtAxisKES, COUNTRY_FLAGS, buildParams } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { ChartTooltip } from "@/components/ChartHelpers";
import {
  Package,
  Warning,
  Storefront,
  MagnifyingGlass,
  Buildings,
  TrendDown,
  Cube,
  Timer,
} from "@phosphor-icons/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from "recharts";

const Inventory = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;

  const [summary, setSummary] = useState(null);
  const [inv, setInv] = useState([]);
  const [sts, setSts] = useState([]);
  const [subcatSS, setSubcatSS] = useState([]);
  const [stsByCat, setStsByCat] = useState([]);
  const [weeksOfCover, setWeeksOfCover] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const country = countries.length === 1 ? countries[0].toLowerCase() : undefined;
    const location = channels.length === 1 ? channels[0] : undefined;
    const params = { country, location, product: search || undefined };
    // On manual refresh, bust the 60s backend cache.
    const refreshParams = dataVersion > 0 ? { ...params, refresh: true } : params;
    const dateParams = { date_from: dateFrom, date_to: dateTo,
      country: countries.length ? countries.join(",") : undefined,
      channel: channels.length ? channels.join(",") : undefined };
    Promise.all([
      api.get("/analytics/inventory-summary", { params: refreshParams }),
      api.get("/inventory", { params: refreshParams }),
      api.get("/stock-to-sales", { params: { date_from: dateFrom, date_to: dateTo, country: countries.length ? countries.join(",") : undefined } }),
      api.get("/analytics/stock-to-sales-by-subcat", { params: dateParams }),
      api.get("/analytics/stock-to-sales-by-category", { params: dateParams }),
      api.get("/analytics/weeks-of-cover", { params: {
        country: countries.length ? countries.join(",") : undefined,
        channel: channels.length ? channels.join(",") : undefined,
      } }),
    ])
      .then(([s, i, st, sc, cat, woc]) => {
        if (cancelled) return;
        setSummary(s.data);
        setInv(i.data || []);
        setSts(st.data || []);
        setSubcatSS(sc.data || []);
        setStsByCat(cat.data || []);
        setWeeksOfCover(woc.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), search, dataVersion]);

  const brands = useMemo(
    () => [...new Set(inv.map((r) => r.brand).filter(Boolean))].sort(),
    [inv]
  );
  const types = useMemo(
    () => [...new Set(inv.map((r) => r.product_type).filter(Boolean))].sort(),
    [inv]
  );

  const filteredInv = useMemo(() => {
    return inv.filter((r) => {
      if (countries.length > 1 && !countries.map((c) => c.toLowerCase()).includes((r.country || "").toLowerCase())) return false;
      if (channels.length && !channels.includes(r.location_name)) return false;
      if (brandFilter && r.brand !== brandFilter) return false;
      if (typeFilter && r.product_type !== typeFilter) return false;
      return true;
    });
  }, [inv, countries, channels, brandFilter, typeFilter]);

  const lowStockByStyle = useMemo(() => {
    const m = new Map();
    for (const r of filteredInv) {
      const style = r.style_name || r.product_name;
      if (!style) continue;
      if (!m.has(style)) {
        m.set(style, {
          style_name: style,
          brand: r.brand,
          product_type: r.product_type,
          collection: r.collection,
          available: 0,
          sku_count: 0,
          locations: new Set(),
        });
      }
      const e = m.get(style);
      e.available += r.available || 0;
      e.sku_count += 1;
      if (r.location_name) e.locations.add(r.location_name);
    }
    const rows = [...m.values()]
      .filter((e) => e.available <= 10)
      .map((e) => ({ ...e, locations: e.locations.size }))
      .sort((a, b) => a.available - b.available);
    return rows;
  }, [filteredInv]);

  // Understocked subcategories = % of total stock is LESS than % of total units sold.
  // understock_pct = pct_of_total_sold − pct_of_total_stock (positive = understocked magnitude).
  const understockedSubcats = useMemo(() => {
    return [...subcatSS]
      .map((r) => ({
        ...r,
        understock_pct: (r.pct_of_total_sold || 0) - (r.pct_of_total_stock || 0),
      }))
      .filter((r) => r.understock_pct > 0.5)
      .sort((a, b) => b.understock_pct - a.understock_pct);
  }, [subcatSS]);

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <div>
        <div className="eyebrow">Dashboard · Inventory</div>
        <h1 className="font-extrabold text-[28px] tracking-tight mt-1">
          Inventory
        </h1>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              testId="inv-kpi-units"
              accent
              label="Total Available Units"
              value={fmtNum(summary.total_units)}
              icon={Package}
              showDelta={false}
            />
            <KPICard
              testId="inv-kpi-store-stock"
              label="Stock in Stores"
              sub="Customer-facing units (excl. warehouse / holding)"
              value={fmtNum(summary.store_units)}
              icon={Storefront}
              showDelta={false}
            />
            <KPICard
              testId="inv-kpi-warehouse-stock"
              label="Stock in Warehouse"
              sub="Warehouse, wholesale, holding, staging"
              value={fmtNum(summary.warehouse_units)}
              icon={Cube}
              showDelta={false}
            />
            <KPICard
              testId="inv-kpi-lowstock"
              label="Low-Stock Styles (≤10)"
              value={fmtNum(lowStockByStyle.length)}
              icon={Warning}
              showDelta={false}
            />
          </div>

          <div className="card-white p-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 input-pill flex-1 min-w-[200px]">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search product name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="inv-search"
                className="bg-transparent outline-none text-[13px] w-full"
              />
            </div>
            <select
              className="input-pill"
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              data-testid="inv-brand"
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <select
              className="input-pill"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              data-testid="inv-type"
            >
              <option value="">All product types</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="card-white p-5" data-testid="chart-inv-location">
            <SectionTitle
              title={`Stock by location · ${summary.by_location.length} locations`}
              subtitle="All locations sorted by stock descending"
            />
            <div style={{ width: "100%", height: 24 + summary.by_location.length * 22 }}>
              <ResponsiveContainer>
                <BarChart data={summary.by_location} layout="vertical" margin={{ left: 10, right: 60, top: 4 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="location" width={170} tick={{ fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip formatters={{ units: (v) => `${fmtNum(v)} units` }} />} />
                  <Bar dataKey="units" fill="#1a5c38" radius={[0, 5, 5, 0]}>
                    <LabelList dataKey="units" position="right" formatter={(v) => fmtNum(v)} style={{ fontSize: 10, fill: "#4b5563" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card-white p-5" data-testid="chart-inv-category">
              <SectionTitle title="Inventory by category" subtitle="Grouped (Dresses, Tops, Bottoms, …)" />
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={stsByCat} margin={{ bottom: 60 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="category" interval={0} angle={-20} textAnchor="end" height={70} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip formatters={{ current_stock: (v) => `${fmtNum(v)} units`, units_sold: (v) => `${fmtNum(v)} units` }} />} />
                    <Bar dataKey="current_stock" fill="#1a5c38" radius={[5, 5, 0, 0]} name="Inventory">
                      <LabelList dataKey="current_stock" position="top" formatter={(v) => fmtNum(v)} style={{ fontSize: 10, fill: "#4b5563" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card-white p-5" data-testid="chart-inv-subcat">
              <SectionTitle title="Inventory by subcategory" subtitle="Top 15 subcategories" />
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={summary.by_product_type.slice(0, 15)} margin={{ bottom: 80 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="product_type" interval={0} angle={-30} textAnchor="end" height={90} tick={{ fontSize: 9 }} />
                    <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip formatters={{ units: (v) => `${fmtNum(v)} units` }} />} />
                    <Bar dataKey="units" fill="#00c853" radius={[5, 5, 0, 0]} name="Inventory" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {summary.by_subcategory_split && summary.by_subcategory_split.length > 0 && (
            <div className="card-white p-5" data-testid="stores-vs-warehouse">
              <SectionTitle
                title="Stock per subcategory · Stores vs Warehouse"
                subtitle={`Stores = ${fmtNum(summary.store_units)} units · Warehouse = ${fmtNum(summary.warehouse_units)} units`}
              />
              <div style={{ width: "100%", height: 32 + summary.by_subcategory_split.length * 28 }}>
                <ResponsiveContainer>
                  <BarChart
                    data={summary.by_subcategory_split}
                    layout="vertical"
                    margin={{ left: 20, right: 20 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="subcategory" width={170} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => fmtNum(v)} />
                    <Legend />
                    <Bar dataKey="store_units" stackId="a" fill="#1a5c38" name="Stores" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="warehouse_units" stackId="a" fill="#4b7bec" name="Warehouse" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full data" data-testid="stores-vs-warehouse-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Subcategory</th>
                      <th className="text-right">Stores</th>
                      <th className="text-right">Warehouse</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Store Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.by_subcategory_split.map((r, i) => {
                      const share = r.total_units ? (r.store_units / r.total_units) * 100 : 0;
                      return (
                        <tr key={(r.subcategory || "") + i}>
                          <td className="text-muted num">{i + 1}</td>
                          <td className="font-medium">{r.subcategory}</td>
                          <td className="text-right num font-semibold">{fmtNum(r.store_units)}</td>
                          <td className="text-right num">{fmtNum(r.warehouse_units)}</td>
                          <td className="text-right num font-bold text-brand">{fmtNum(r.total_units)}</td>
                          <td className="text-right num">{share.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-panel font-bold">
                      <td></td>
                      <td>TOTAL</td>
                      <td className="text-right num">{fmtNum(summary.store_units)}</td>
                      <td className="text-right num">{fmtNum(summary.warehouse_units)}</td>
                      <td className="text-right num">{fmtNum(summary.total_units)}</td>
                      <td className="text-right num">
                        {summary.total_units
                          ? ((summary.store_units / summary.total_units) * 100).toFixed(1)
                          : 0}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {summary.warehouse_units === 0 && (
                <p className="mt-3 text-[12px] text-muted italic">
                  Note: Upstream inventory API currently returns 0 units from warehouse / wholesale / holding locations.
                  All stock is live in stores.
                </p>
              )}
            </div>
          )}

          <div className="card-white p-5" data-testid="weeks-of-cover">
            <SectionTitle
              title={`Weeks of Cover · ${weeksOfCover.length} styles`}
              subtitle="Weeks = current stock ÷ (units sold in last 4 weeks ÷ 4). Red <2w · Amber 2–4w · Green >4w."
            />
            <SortableTable
              testId="woc"
              exportName="weeks-of-cover.csv"
              pageSize={25}
              initialSort={{ key: "weeks_of_cover", dir: "asc" }}
              columns={[
                { key: "style_name", label: "Style Name", align: "left" },
                { key: "subcategory", label: "Subcategory", align: "left" },
                { key: "current_stock", label: "Current Stock", numeric: true, render: (r) => fmtNum(r.current_stock) },
                { key: "avg_weekly_sales", label: "Avg Weekly Sales", numeric: true, render: (r) => fmtNum(Math.round(r.avg_weekly_sales)), csv: (r) => r.avg_weekly_sales?.toFixed(2) },
                {
                  key: "weeks_of_cover",
                  label: "Weeks of Cover",
                  numeric: true,
                  sortValue: (r) => r.weeks_of_cover == null ? 9999 : r.weeks_of_cover,
                  render: (r) => {
                    if (r.weeks_of_cover == null) return <span className="pill-neutral">— (no sales)</span>;
                    if (r.avg_weekly_sales === 0) return <span className="pill-neutral">∞</span>;
                    const w = r.weeks_of_cover;
                    const cls = w < 2 ? "pill-red" : w <= 4 ? "pill-amber" : "pill-green";
                    return <span className={cls}>{w.toFixed(1)}w</span>;
                  },
                  csv: (r) => r.weeks_of_cover == null ? "" : r.weeks_of_cover.toFixed(2),
                },
              ]}
              rows={weeksOfCover}
            />
          </div>

          <div className="card-white p-5" data-testid="sts-by-category-table">
            <SectionTitle title="Stock-to-Sales · by Category" subtitle="Aggregated groups (Dresses, Tops, Bottoms, …)" />
            <SortableTable
              testId="inv-sts-cat"
              exportName="inventory-sts-by-category.csv"
              initialSort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "category", label: "Category", align: "left" },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                { key: "current_stock", label: "Inventory", numeric: true, render: (r) => fmtNum(r.current_stock) },
                { key: "pct_of_total_sold", label: "% of Total Sales", numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2) },
                { key: "pct_of_total_stock", label: "% of Total Inventory", numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2) },
                {
                  key: "variance", label: "Variance", numeric: true,
                  render: (r) => (
                    <span className={r.variance >= 2 ? "pill-green" : r.variance >= -2 ? "pill-neutral" : "pill-red"}>
                      {r.variance >= 0 ? "+" : ""}{r.variance.toFixed(2)} pts
                    </span>
                  ),
                  csv: (r) => r.variance?.toFixed(2),
                },
              ]}
              rows={stsByCat}
            />
          </div>

          <div className="card-white p-5" data-testid="sts-by-subcategory-table">
            <SectionTitle title="Stock-to-Sales · by Subcategory" subtitle="Granular view — one row per subcategory" />
            <SortableTable
              testId="inv-sts-subcat"
              exportName="inventory-sts-by-subcategory.csv"
              pageSize={15}
              initialSort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "subcategory", label: "Subcategory", align: "left" },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                { key: "current_stock", label: "Inventory", numeric: true, render: (r) => fmtNum(r.current_stock) },
                { key: "pct_of_total_sold", label: "% of Total Sales", numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2) },
                { key: "pct_of_total_stock", label: "% of Total Inventory", numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2) },
                {
                  key: "variance", label: "Variance", numeric: true,
                  render: (r) => (
                    <span className={r.variance >= 2 ? "pill-green" : r.variance >= -2 ? "pill-neutral" : "pill-red"}>
                      {r.variance >= 0 ? "+" : ""}{r.variance.toFixed(2)} pts
                    </span>
                  ),
                  csv: (r) => r.variance?.toFixed(2),
                },
              ]}
              rows={subcatSS}
            />
          </div>

          {understockedSubcats.length > 0 && (
            <div className="card-white p-5 border-l-4 border-brand-strong" data-testid="understocked-subcats">
              <SectionTitle
                title={`Understocked subcategories · ${understockedSubcats.length}`}
                subtitle="Selling more than their share of inventory. Understock % = % of Units Sold − % of Total Stock."
              />
              <SortableTable
                testId="understocked"
                exportName="understocked-subcategories.csv"
                initialSort={{ key: "understock_pct", dir: "desc" }}
                columns={[
                  { key: "rank", label: "#", align: "left", sortable: false, render: (_r, i) => <span className="text-muted num">{i + 1}</span> },
                  { key: "subcategory", label: "Subcategory", align: "left", render: (r) => <span className="font-medium">{r.subcategory}</span> },
                  { key: "pct_of_total_sold", label: "% of Sales", numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2), csv: (r) => r.pct_of_total_sold?.toFixed(2) },
                  { key: "pct_of_total_stock", label: "% of Stock", numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2), csv: (r) => r.pct_of_total_stock?.toFixed(2) },
                  {
                    key: "understock_pct", label: "Understock %", numeric: true,
                    render: (r) => <span className={r.understock_pct >= 3 ? "pill-red" : r.understock_pct >= 1 ? "pill-amber" : "pill-neutral"}>{r.understock_pct.toFixed(2)}%</span>,
                    csv: (r) => r.understock_pct?.toFixed(2),
                  },
                  { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                  { key: "current_stock", label: "Current Stock", numeric: true, render: (r) => fmtNum(r.current_stock) },
                  { key: "sor_percent", label: "SOR", numeric: true, render: (r) => fmtPct(r.sor_percent), csv: (r) => r.sor_percent?.toFixed(2) },
                ]}
                rows={understockedSubcats}
              />
            </div>
          )}

          {lowStockByStyle.length > 0 && (
            <div className="card-white p-5 border-l-4 border-danger" data-testid="low-stock-section">
              <SectionTitle
                title={`Low-stock alerts · ${lowStockByStyle.length} styles`}
                subtitle="Styles with ≤10 total available units across all SKUs in the current scope"
              />
              <SortableTable
                testId="low-stock"
                exportName="low-stock-alerts.csv"
                pageSize={80}
                initialSort={{ key: "available", dir: "asc" }}
                columns={[
                  { key: "style_name", label: "Style", align: "left", render: (r) => <span className="font-medium max-w-[300px] truncate inline-block" title={r.style_name}>{r.style_name || "—"}</span> },
                  { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                  { key: "product_type", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.product_type || "—"}</span> },
                  { key: "sku_count", label: "SKUs", numeric: true, render: (r) => fmtNum(r.sku_count) },
                  { key: "locations", label: "Locations", numeric: true, render: (r) => fmtNum(r.locations) },
                  {
                    key: "available", label: "Total Available", numeric: true,
                    render: (r) => <span className={r.available <= 3 ? "pill-red" : r.available <= 6 ? "pill-amber" : "pill-neutral"}>{fmtNum(r.available)}</span>,
                    csv: (r) => r.available,
                  },
                ]}
                rows={lowStockByStyle}
              />
            </div>
          )}

          <div className="card-white p-5" data-testid="stock-to-sales-section">
            <SectionTitle
              title="Stock-to-Sales ratio by location"
              subtitle="Weeks of cover proxy — red >10× (overstocked), amber 3–10×, green 1–3×, blue <1× (understocked)"
            />
            <SortableTable
              testId="sts-location"
              exportName="stock-to-sales-by-location.csv"
              initialSort={{ key: "stock_to_sales_ratio", dir: "desc" }}
              columns={[
                { key: "location", label: "Location", align: "left", render: (r) => <span className="font-medium">{r.location}</span> },
                { key: "country", label: "Country", align: "left", render: (r) => <span>{COUNTRY_FLAGS[r.country] || "🌍"} {r.country}</span>, csv: (r) => r.country },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                { key: "current_stock", label: "Current Stock", numeric: true, render: (r) => fmtNum(r.current_stock) },
                { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="font-semibold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                {
                  key: "stock_to_sales_ratio", label: "Ratio", numeric: true,
                  render: (r) => {
                    const v = r.stock_to_sales_ratio || 0;
                    const pill = v > 10 ? "pill-red" : v >= 3 ? "pill-amber" : v >= 1 ? "pill-green" : "pill-neutral";
                    return <span className={pill}>{fmtDec(v, 2)}×</span>;
                  },
                  csv: (r) => r.stock_to_sales_ratio?.toFixed(2),
                },
              ]}
              rows={sts}
            />
          </div>

          <div className="card-white p-5" data-testid="inventory-table">
            <SectionTitle
              title="Inventory"
              subtitle={`${fmtNum(filteredInv.length)} rows · sortable, exportable`}
            />
            <SortableTable
              testId="inventory-rows"
              exportName="inventory.csv"
              pageSize={300}
              initialSort={{ key: "available", dir: "desc" }}
              columns={[
                { key: "product_name", label: "Product", align: "left", render: (r) => <span className="font-medium max-w-[280px] truncate inline-block" title={r.product_name}>{r.product_name || "—"}</span> },
                { key: "size", label: "Size", align: "left", render: (r) => r.size || "—" },
                { key: "sku", label: "SKU", align: "left", render: (r) => <span className="font-mono text-[11px] text-muted">{r.sku || "—"}</span>, csv: (r) => r.sku },
                { key: "barcode", label: "Barcode", align: "left", render: (r) => <span className="font-mono text-[11px] text-muted">{r.barcode || "—"}</span>, csv: (r) => r.barcode },
                { key: "location_name", label: "Location", align: "left", render: (r) => <span className="text-muted">{r.location_name || "—"}</span>, csv: (r) => r.location_name },
                { key: "country", label: "Country", align: "left", render: (r) => <span className="capitalize">{r.country || "—"}</span>, csv: (r) => r.country },
                {
                  key: "available", label: "Available", numeric: true,
                  render: (r) => <span className={`font-semibold ${(r.available || 0) <= 2 ? "text-danger" : ""}`}>{fmtNum(r.available)}</span>,
                  csv: (r) => r.available,
                },
              ]}
              rows={filteredInv}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default Inventory;
