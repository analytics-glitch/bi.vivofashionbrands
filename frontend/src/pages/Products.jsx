import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { useKpis } from "@/lib/useKpis";
import { isMerchandise } from "@/lib/productCategory";
import { api, fmtKES, fmtNum, fmtPct, buildParams } from "@/lib/api";
import { VarianceCell, varianceFlag } from "@/lib/variance";
import SORHeader from "@/components/SORHeader";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import MultiSelect from "@/components/MultiSelect";
import SortableTable from "@/components/SortableTable";
import {
  Gauge, Star, TrendDown, Tag, Package, Coins, MagnifyingGlass,
} from "@phosphor-icons/react";

const sorPillClass = (p) => {
  if (p == null) return "pill-neutral";
  if (p < 30) return "pill-red";
  if (p < 60) return "pill-amber";
  return "pill-green";
};

const BRAND_OPTIONS = ["Vivo", "Safari", "Zoya", "Sowairina", "Third Party Brands"];

const Products = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;
  const [brands, setBrands] = useState([]);
  const filters = { dateFrom, dateTo, countries, channels };

  const [sor, setSor] = useState([]);
  const [stockSales, setStockSales] = useState([]);
  const [stsByCat, setStsByCat] = useState([]);
  const [top, setTop] = useState([]);
  const [newStyles, setNewStyles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  // Shared KPI state — identical to Overview / Locations / CEO Report.
  const { kpis, loading: kpisLoading, error: kpisError } = useKpis();

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
      api.get("/top-skus", { params: { ...p, limit: 200 } }),
      api.get("/analytics/new-styles", { params: p }),
    ])
      .then(([s, ss, cat, t, ns]) => {
        if (cancelled) return;
        setSor(s.data || []);
        // Merchandise-only: exclude Accessories, Sale, Sample & Sale Items, null.
        setStockSales((ss.data || []).filter((r) => isMerchandise(r.subcategory)));
        setStsByCat((cat.data || []).filter((r) => r.category && !["Accessories", "Sale", "Other"].includes(r.category)));
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

  // Tornado data removed — charts replaced by sortable tables.
  const topFiltered = useMemo(() => filterByBrand(top).slice(0, 20), [top, brands]); // eslint-disable-line
  const newStylesFiltered = useMemo(() => filterByBrand(newStyles), [newStyles, brands]); // eslint-disable-line

  return (
    <div className="space-y-6" data-testid="products-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Dashboard · Products</div>
          <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">Products</h1>
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

      {(loading || kpisLoading) && <Loading />}
      {(error || kpisError) && <ErrorBox message={error || kpisError} />}

      {!loading && !kpisLoading && !error && kpis && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard testId="pr-kpi-styles" accent label="Styles Tracked" value={fmtNum(sor.length)} icon={Tag} showDelta={false} />
            <KPICard testId="pr-kpi-units" label="Total Units Sold" value={fmtNum(kpis.total_units)} icon={Package} showDelta={false} />
            <KPICard testId="pr-kpi-sales" label="Total Sales" value={fmtKES(kpis.total_sales)} icon={Coins} showDelta={false} />
            <KPICard testId="pr-kpi-asp" label="Avg Selling Price" value={fmtKES(kpis.avg_selling_price)} showDelta={false} />
          </div>

          <div className="card-white p-5" data-testid="sts-category-table">
            <SectionTitle
              title="Stock-to-Sales · by Category"
              subtitle="Variance compares sales share vs stock share. Red = action needed (stockout or overstock risk). Green = healthy balance. Sorted by risk magnitude — biggest gaps at the top."
            />
            <SortableTable
              testId="sts-category"
              exportName="stock-to-sales-by-category.csv"
              initialSort={{ key: "variance", dir: "desc" }}
              columns={[
                { key: "category", label: "Category", align: "left" },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold), csv: (r) => r.units_sold },
                { key: "current_stock", label: "Inventory", numeric: true, render: (r) => fmtNum(r.current_stock), csv: (r) => r.current_stock },
                { key: "pct_of_total_sold", label: "% of Total Sales", numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2), csv: (r) => r.pct_of_total_sold?.toFixed(2) },
                { key: "pct_of_total_stock", label: "% of Total Inventory", numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2), csv: (r) => r.pct_of_total_stock?.toFixed(2) },
                {
                  key: "variance",
                  label: "Variance %",
                  numeric: true,
                  sortValue: (r) => Math.abs(r.variance || 0),
                  render: (r) => <VarianceCell value={r.variance} />,
                  csv: (r) => r.variance?.toFixed(2),
                },
                {
                  key: "risk_flag",
                  label: "Risk Flag",
                  align: "left",
                  render: (r) => <span className="text-[11px] text-muted">{varianceFlag(r.variance)}</span>,
                  csv: (r) => varianceFlag(r.variance),
                },
              ]}
              rows={stsByCat}
            />
          </div>

          <div className="card-white p-5" data-testid="sts-subcat-table">
            <SectionTitle
              title="Stock-to-Sales · by Subcategory"
              subtitle="Granular view — one row per merchandise subcategory. Red = action needed (stockout or overstock risk). Green = healthy balance. Sorted by risk magnitude."
            />
            <SortableTable
              testId="sts-subcat"
              exportName="stock-to-sales-by-subcategory.csv"
              initialSort={{ key: "variance", dir: "desc" }}
              columns={[
                { key: "subcategory", label: "Subcategory", align: "left" },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold), csv: (r) => r.units_sold },
                { key: "current_stock", label: "Inventory", numeric: true, render: (r) => fmtNum(r.current_stock), csv: (r) => r.current_stock },
                { key: "pct_of_total_sold", label: "% of Total Sales", numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2), csv: (r) => r.pct_of_total_sold?.toFixed(2) },
                { key: "pct_of_total_stock", label: "% of Total Inventory", numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2), csv: (r) => r.pct_of_total_stock?.toFixed(2) },
                {
                  key: "variance",
                  label: "Variance %",
                  numeric: true,
                  sortValue: (r) => Math.abs(r.variance || 0),
                  render: (r) => <VarianceCell value={r.variance} />,
                  csv: (r) => r.variance?.toFixed(2),
                },
                {
                  key: "risk_flag",
                  label: "Risk Flag",
                  align: "left",
                  render: (r) => <span className="text-[11px] text-muted">{varianceFlag(r.variance)}</span>,
                  csv: (r) => varianceFlag(r.variance),
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

          <div className="card-white p-5" data-testid="products-top-skus">
            <SectionTitle title="Top 20 Styles" subtitle="Best-selling styles across the scope" />
            <SortableTable
              testId="top20-styles"
              exportName="top-20-styles.csv"
              initialSort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "rank", label: "#", align: "left", sortable: false, render: (_r, i) => <span className="text-muted num">{i + 1}</span> },
                { key: "style_name", label: "Product Name", align: "left", render: (r) => <span className="font-medium max-w-[280px] truncate inline-block" title={r.style_name}>{r.style_name}</span> },
                { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                { key: "product_type", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.product_type || "—"}</span> },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                { key: "avg_price", label: "Avg Price", numeric: true, render: (r) => fmtKES(r.avg_price), csv: (r) => r.avg_price },
              ]}
              rows={topFiltered}
            />
          </div>

          <div className="card-white p-5" data-testid="new-styles-section">
            <SectionTitle
              title={`New styles performance · ${newStylesFiltered.length} styles`}
              subtitle="Styles whose first ever sale is within the last 3 months. Click column headers to sort."
            />
            {newStylesFiltered.length === 0 ? <Empty label="No new styles launched in the last 90 days." /> : (
              <SortableTable
                testId="new-styles"
                exportName="new-styles.csv"
                pageSize={50}
                initialSort={{ key: "total_sales_period", dir: "desc" }}
                columns={[
                  { key: "rank", label: "#", align: "left", sortable: false, render: (_r, i) => <span className="text-muted num">{i + 1}</span> },
                  { key: "style_name", label: "Product Name", align: "left", render: (r) => <span className="font-medium max-w-[260px] truncate inline-block" title={r.style_name}>{r.style_name}</span> },
                  { key: "collection", label: "Collection", align: "left", render: (r) => <span className="text-muted">{r.collection || "—"}</span> },
                  { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                  { key: "product_type", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.product_type || "—"}</span> },
                  { key: "units_sold_period", label: "Units (Period)", numeric: true, render: (r) => fmtNum(r.units_sold_period) },
                  { key: "total_sales_period", label: "Sales (Period)", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales_period)}</span>, csv: (r) => r.total_sales_period },
                  { key: "units_sold_launch", label: "Units (Since Launch)", numeric: true, render: (r) => fmtNum(r.units_sold_launch) },
                  { key: "total_sales_launch", label: "Sales (Since Launch)", numeric: true, render: (r) => fmtKES(r.total_sales_launch), csv: (r) => r.total_sales_launch },
                  { key: "current_stock", label: "Current Stock", numeric: true, render: (r) => fmtNum(r.current_stock) },
                  { key: "sor_percent", label: <SORHeader />, numeric: true, render: (r) => <span className={sorPillClass(r.sor_percent)}>{fmtPct(r.sor_percent)}</span>, csv: (r) => r.sor_percent },
                ]}
                rows={newStylesFiltered}
              />
            )}
          </div>

          <div className="card-white p-5" data-testid="sor-table-card">
            <SectionTitle
              title={`SOR by style · TOP ${Math.min(filtered.length, 200)} items`}
              subtitle="Sortable on every column. Use search to narrow results."
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
            <SortableTable
              testId="sor-table"
              exportName="sor-by-style.csv"
              pageSize={50}
              initialSort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "style_name", label: "Style", align: "left", render: (r) => <span className="font-medium max-w-[280px] truncate inline-block" title={r.style_name}>{r.style_name}</span> },
                { key: "collection", label: "Collection", align: "left", render: (r) => <span className="text-muted">{r.collection || "—"}</span> },
                { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                { key: "product_type", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.product_type || "—"}</span> },
                { key: "units_sold", label: "Units", numeric: true, render: (r) => fmtNum(r.units_sold) },
                { key: "current_stock", label: "Current Stock", numeric: true, render: (r) => fmtNum(r.current_stock) },
                { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                { key: "sor_percent", label: <SORHeader />, numeric: true, render: (r) => <span className={sorPillClass(r.sor_percent)}>{fmtPct(r.sor_percent)}</span>, csv: (r) => r.sor_percent },
              ]}
              rows={filtered.slice(0, 200)}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default Products;
