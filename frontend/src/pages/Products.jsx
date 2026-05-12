import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { useKpis } from "@/lib/useKpis";
import { isMerchandise, categoryFor, MERCH_CATEGORIES, subcategoriesFor } from "@/lib/productCategory";
import { api, fmtKES, fmtNum, fmtPct, buildParams } from "@/lib/api";
import { VarianceCell, varianceFlag } from "@/lib/variance";
import SORHeader from "@/components/SORHeader";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import MultiSelect from "@/components/MultiSelect";
import SortableTable from "@/components/SortableTable";
import CategoryAccordionTable from "@/components/CategoryAccordionTable";
import ProductThumbnail from "@/components/ProductThumbnail";
import SorNewStylesL10 from "@/components/SorNewStylesL10";
import SorAllStyles from "@/components/SorAllStyles";
import NewStylesSalesCurve from "@/components/NewStylesSalesCurve";
import CategoryCountryMatrix from "@/components/CategoryCountryMatrix";
import ProductsPlan from "@/components/ProductsPlan";
import { useThumbnails } from "@/lib/useThumbnails";
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
  const { dateFrom, dateTo, countries, channels, compareMode, dataVersion } = applied;
  const [brands, setBrands] = useState([]);
  const [merchCats, setMerchCats] = useState([]);
  const [merchSubs, setMerchSubs] = useState([]);
  const [stsView, setStsView] = useState("flat"); // "flat" | "grouped"
  const filters = { dateFrom, dateTo, countries, channels };

  const [sor, setSor] = useState([]);
  const [stockSales, setStockSales] = useState([]);
  const [stsByCat, setStsByCat] = useState([]);
  const [stockSalesPrev, setStockSalesPrev] = useState([]);
  const [stsByCatPrev, setStsByCatPrev] = useState([]);
  const [top, setTop] = useState([]);
  const [newStyles, setNewStyles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  // Shared KPI state — identical to Overview / Locations / CEO Report.
  const { kpis, loading: kpisLoading, error: kpisError } = useKpis();

  const compareLbl = compareMode === "last_month" ? "vs Last Month"
    : compareMode === "last_year" ? "vs Last Year"
    : compareMode === "yesterday" ? "vs Yesterday" : null;

  // Previous-period range — mirror of the logic on Customers page.
  const prevRange = useMemo(() => {
    if (!compareMode || compareMode === "none") return null;
    const f = new Date(dateFrom); const t = new Date(dateTo);
    let fromPrev, toPrev;
    if (compareMode === "last_month") {
      fromPrev = new Date(f); fromPrev.setMonth(f.getMonth() - 1);
      toPrev = new Date(t); toPrev.setMonth(t.getMonth() - 1);
    } else if (compareMode === "last_year") {
      fromPrev = new Date(f); fromPrev.setFullYear(f.getFullYear() - 1);
      toPrev = new Date(t); toPrev.setFullYear(t.getFullYear() - 1);
    } else {
      // yesterday
      fromPrev = new Date(f); fromPrev.setDate(f.getDate() - 1);
      toPrev = new Date(t); toPrev.setDate(t.getDate() - 1);
    }
    const iso = (d) => d.toISOString().slice(0, 10);
    return { date_from: iso(fromPrev), date_to: iso(toPrev) };
  }, [compareMode, dateFrom, dateTo]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = buildParams(filters);
    const prevP = prevRange ? { ...p, ...prevRange } : null;
    // Brand filter is applied client-side (upstream `product` does prefix match
    // on product_name, not brand, so server-side filtering is unreliable).
    Promise.all([
      api.get("/sor", { params: p }),
      api.get("/analytics/stock-to-sales-by-subcat", { params: p }),
      api.get("/analytics/stock-to-sales-by-category", { params: p }),
      api.get("/top-skus", { params: { ...p, limit: 200 } }),
      api.get("/analytics/new-styles", { params: p }),
      prevP ? api.get("/analytics/stock-to-sales-by-subcat", { params: prevP }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      prevP ? api.get("/analytics/stock-to-sales-by-category", { params: prevP }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ])
      .then(([s, ss, cat, t, ns, ssPrev, catPrev]) => {
        if (cancelled) return;
        setSor(s.data || []);
        // Merchandise-only: exclude Accessories, Sale, Sample & Sale Items, null.
        setStockSales((ss.data || []).filter((r) => isMerchandise(r.subcategory)));
        setStsByCat((cat.data || []).filter((r) => r.category && !["Accessories", "Sale", "Other"].includes(r.category)));
        setStockSalesPrev((ssPrev.data || []).filter((r) => isMerchandise(r.subcategory)));
        setStsByCatPrev((catPrev.data || []).filter((r) => r.category && !["Accessories", "Sale", "Other"].includes(r.category)));
        setTop(t.data || []);
        setNewStyles(ns.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), JSON.stringify(brands), compareMode, dataVersion]);

  // Client-side filter on results when multiple brands picked (upstream `product`
  // is a single-value filter).
  const filterByBrand = (rows) => {
    if (!brands.length) return rows;
    const bs = new Set(brands.map((b) => b.toLowerCase()));
    return rows.filter((r) => bs.has((r.brand || "").toLowerCase()));
  };

  // Merch-taxonomy filter applied client-side. `subcategory` is present on
  // SOR rows, top-skus, new styles AND stock-sales rows. Categories are
  // resolved via `categoryFor` (uses the SUBCATEGORY_TO_CATEGORY map).
  const filterByMerch = (rows) => {
    if (!merchCats.length && !merchSubs.length) return rows;
    const catSet = merchCats.length ? new Set(merchCats) : null;
    const subSet = merchSubs.length ? new Set(merchSubs) : null;
    return rows.filter((r) => {
      const sub = r.subcategory || r.product_type || "";
      if (subSet && !subSet.has(sub)) return false;
      if (catSet && !catSet.has(categoryFor(sub))) return false;
      return true;
    });
  };

  const filterByBrandAndMerch = (rows) => filterByMerch(filterByBrand(rows));

  const avgSor = sor.length ? sor.reduce((s, r) => s + (r.sor_percent || 0), 0) / sor.length : 0;
  const hi = sor.filter((r) => (r.sor_percent || 0) > 60).length;
  const mid = sor.filter((r) => (r.sor_percent || 0) >= 30 && (r.sor_percent || 0) <= 60).length;
  const lo = sor.filter((r) => (r.sor_percent || 0) < 30).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base0 = filterByBrandAndMerch(sor);
    const base = q
      ? base0.filter((r) =>
          (r.style_name || "").toLowerCase().includes(q) ||
          (r.collection || "").toLowerCase().includes(q) ||
          (r.brand || "").toLowerCase().includes(q)
        )
      : base0;
    return [...base].sort((a, b) => (b.units_sold || 0) - (a.units_sold || 0));
    // eslint-disable-next-line
  }, [sor, search, brands, merchCats, merchSubs]);

  // Tornado data removed — charts replaced by sortable tables.
  const topFiltered = useMemo(() => filterByBrandAndMerch(top).slice(0, 20), [top, brands, merchCats, merchSubs]); // eslint-disable-line
  const newStylesFiltered = useMemo(() => filterByBrandAndMerch(newStyles), [newStyles, brands, merchCats, merchSubs]); // eslint-disable-line

  // Stock-Sales by subcat + by category get the merch filter too.
  const filteredStockSales = useMemo(() => filterByMerch(stockSales), [stockSales, merchCats, merchSubs]); // eslint-disable-line
  const filteredStsByCat = useMemo(() => {
    if (!merchCats.length) return stsByCat;
    const set = new Set(merchCats);
    return stsByCat.filter((r) => set.has(r.category));
  }, [stsByCat, merchCats]);

  // Batch-fetch thumbnails for every visible style across all three tables.
  const thumbStyles = useMemo(() => {
    const set = new Set();
    topFiltered.forEach((r) => r.style_name && set.add(r.style_name));
    newStylesFiltered.forEach((r) => r.style_name && set.add(r.style_name));
    filtered.slice(0, 200).forEach((r) => r.style_name && set.add(r.style_name));
    return Array.from(set);
  }, [topFiltered, newStylesFiltered, filtered]);
  const { urlFor } = useThumbnails(thumbStyles);

  // Sub-tab — keeps the existing Products view intact and adds the
  // L-10 launch-window report alongside.
  const [tab, setTab] = useState("catalog");
  const brandCsv = brands.length ? brands.join(",") : "";

  return (
    <div className="space-y-6" data-testid="products-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Dashboard · Products</div>
          <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(18px,2.2vw,26px)]">Products</h1>
          <p className="text-muted text-[13px] mt-0.5">For Head of Products — style & subcategory performance</p>
        </div>
        <div className="flex flex-wrap items-end gap-3" data-testid="products-filters">
          <div className="w-full sm:w-44">
            <div className="eyebrow mb-1">Category</div>
            <MultiSelect
              testId="products-cat-multi"
              options={MERCH_CATEGORIES.map((c) => ({ value: c, label: c }))}
              value={merchCats}
              onChange={(v) => {
                setMerchCats(v);
                if (v.length) {
                  const allowed = new Set(subcategoriesFor(v));
                  setMerchSubs((subs) => subs.filter((s) => allowed.has(s)));
                }
              }}
              placeholder="All categories"
              width={176}
            />
          </div>
          <div className="w-full sm:w-56">
            <div className="eyebrow mb-1">Subcategory</div>
            <MultiSelect
              testId="products-subcat-multi"
              options={subcategoriesFor(merchCats).map((s) => ({ value: s, label: s }))}
              value={merchSubs}
              onChange={setMerchSubs}
              placeholder="All subcategories"
              width={224}
            />
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
      </div>

      {/* sub-tabs */}
      <div className="inline-flex rounded-lg border border-border overflow-hidden" role="tablist" data-testid="products-subtabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "catalog"}
          onClick={() => setTab("catalog")}
          className={`px-4 py-2 text-[12.5px] font-medium ${tab === "catalog" ? "bg-brand text-white" : "bg-white hover:bg-panel"}`}
          data-testid="subtab-catalog"
        >
          Catalog
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "l10"}
          onClick={() => setTab("l10")}
          className={`px-4 py-2 text-[12.5px] font-medium border-l border-border ${tab === "l10" ? "bg-brand text-white" : "bg-white hover:bg-panel"}`}
          data-testid="subtab-l10"
        >
          SOR New Styles L-10
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "all-styles"}
          onClick={() => setTab("all-styles")}
          className={`px-4 py-2 text-[12.5px] font-medium border-l border-border ${tab === "all-styles" ? "bg-brand text-white" : "bg-white hover:bg-panel"}`}
          data-testid="subtab-all-styles"
        >
          SOR All Styles
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sales-curve"}
          onClick={() => setTab("sales-curve")}
          className={`px-4 py-2 text-[12.5px] font-medium border-l border-border ${tab === "sales-curve" ? "bg-brand text-white" : "bg-white hover:bg-panel"}`}
          data-testid="subtab-sales-curve"
        >
          New Styles Curve
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "matrix"}
          onClick={() => setTab("matrix")}
          className={`px-4 py-2 text-[12.5px] font-medium border-l border-border ${tab === "matrix" ? "bg-brand text-white" : "bg-white hover:bg-panel"}`}
          data-testid="subtab-matrix"
        >
          Country Matrix
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "products-plan"}
          onClick={() => setTab("products-plan")}
          className={`px-4 py-2 text-[12.5px] font-medium border-l border-border ${tab === "products-plan" ? "bg-brand text-white" : "bg-white hover:bg-panel"}`}
          data-testid="subtab-products-plan"
        >
          Products Plan
        </button>
      </div>

      {tab === "l10" && <SorNewStylesL10 brand={brandCsv} />}
      {tab === "all-styles" && <SorAllStyles brand={brandCsv} />}
      {tab === "sales-curve" && <NewStylesSalesCurve />}
      {tab === "matrix" && <CategoryCountryMatrix />}
      {tab === "products-plan" && <ProductsPlan />}

      {tab === "catalog" && (<>

      {(loading || kpisLoading) && <Loading />}
      {(error || kpisError) && <ErrorBox message={error || kpisError} />}

      {!loading && !kpisLoading && !error && kpis && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard testId="pr-kpi-styles" accent label="Styles Tracked" value={fmtNum(sor.length)} icon={Tag} showDelta={false}
              action={{ label: "SOR table", onClick: () => document.querySelector('[data-testid="sor-table-card"]')?.scrollIntoView({ behavior: "smooth" }) }} />
            <KPICard testId="pr-kpi-units" label="Total Units Sold" value={fmtNum(kpis.total_units)} icon={Package} showDelta={false}
              action={{ label: "Top sellers", onClick: () => document.querySelector('[data-testid="sor-table-card"]')?.scrollIntoView({ behavior: "smooth" }) }} />
            <KPICard testId="pr-kpi-sales" label="Total Sales" value={fmtKES(kpis.total_sales)} icon={Coins} showDelta={false}
              action={{ label: "See by category", onClick: () => document.querySelector('[data-testid="sts-category-table"]')?.scrollIntoView({ behavior: "smooth" }) }} />
            <KPICard testId="pr-kpi-asp" label="Avg Selling Price" value={fmtKES(kpis.avg_selling_price)} showDelta={false}
              action={{ label: "Export pricing CSV", to: "/exports" }} />
          </div>

          <div className="card-white p-5" data-testid="sts-category-table">
            <SectionTitle
              title="Stock-to-Sales · by Category"
              subtitle={(() => {
                const catUnits = (filteredStsByCat || []).reduce((s, r) => s + (r.units_sold || 0), 0);
                const kpiUnits = kpis?.total_units || 0;
                const diff = kpiUnits - catUnits;
                const note = diff !== 0
                  ? ` · ${fmtNum(Math.abs(diff))} unit${Math.abs(diff) === 1 ? '' : 's'} in ${diff > 0 ? 'excluded categories (Accessories, Sale, Other)' : 'overlapping breakdown'}`
                  : '';
                return `Variance compares sales share vs stock share. Red = action needed; green = healthy. Σ here = ${fmtNum(catUnits)} units across categories${note}.`;
              })()}
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
              rows={filteredStsByCat}
            />
          </div>

          <div className="card-white p-5" data-testid="sts-subcat-table">
            <SectionTitle
              title="Stock-to-Sales · by Subcategory"
              subtitle="Granular view — one row per merchandise subcategory. Switch to Grouped to fold rows under collapsible category headers. Red = action needed (stockout or overstock risk). Green = healthy balance."
            />
            <div className="flex justify-end mb-2 -mt-1">
              <div className="inline-flex rounded-md overflow-hidden border border-[#fcd9b6]" data-testid="sts-view-toggle">
                <button
                  onClick={() => setStsView("flat")}
                  data-testid="sts-view-flat"
                  className={`text-[11px] font-bold px-2.5 py-1 transition-colors ${stsView === "flat" ? "bg-[#1a5c38] text-white" : "bg-white text-[#1a5c38] hover:bg-[#fef3e0]"}`}
                >
                  Flat table
                </button>
                <button
                  onClick={() => setStsView("grouped")}
                  data-testid="sts-view-grouped"
                  className={`text-[11px] font-bold px-2.5 py-1 transition-colors ${stsView === "grouped" ? "bg-[#1a5c38] text-white" : "bg-white text-[#1a5c38] hover:bg-[#fef3e0]"}`}
                >
                  Grouped by category
                </button>
              </div>
            </div>
            {stsView === "grouped" ? (
              <CategoryAccordionTable
                rows={filteredStockSales}
                categoryFor={categoryFor}
                testId="sts-subcat-grouped"
                exportName="stock-to-sales-by-subcategory-grouped.csv"
              />
            ) : (
            <SortableTable
              testId="sts-subcat"
              exportName="stock-to-sales-by-subcategory.csv"
              initialSort={{ key: "variance", dir: "desc" }}
              secondarySort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "category", label: "Category", align: "left",
                  sortValue: (r) => categoryFor(r.subcategory) || "",
                  render: (r) => <span className="pill-neutral">{categoryFor(r.subcategory) || "—"}</span>,
                  csv: (r) => categoryFor(r.subcategory) || "" },
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
              rows={filteredStockSales}
            />
            )}
          </div>

          {/* ---- Product Performance by Category / Subcategory ---- */}
          <ProductPerformance
            title="Product Performance · by Category"
            testId="perf-category"
            nameKey="category"
            nameLabel="Category"
            rows={filteredStsByCat}
            prevRows={stsByCatPrev}
            compareLbl={compareLbl}
            csvName="performance-by-category.csv"
            subtitle="Commercial performance per category — sales, orders, avg basket value (ABV), avg selling price (ASP), multiple selling index (MSI). Margin % and return rate deferred — pending upstream cost/returns data."
          />

          <ProductPerformance
            title="Product Performance · by Subcategory"
            testId="perf-subcat"
            nameKey="subcategory"
            nameLabel="Subcategory"
            rows={filteredStockSales}
            prevRows={stockSalesPrev}
            compareLbl={compareLbl}
            csvName="performance-by-subcategory.csv"
            subtitle="Granular view — one row per merchandise subcategory. Period deltas shown beneath each metric when a comparison window is selected."
          />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard testId="sor-k-avg" accent label="Avg Group SOR" value={fmtPct(avgSor)} icon={Gauge} showDelta={false}
              action={{ label: "Full SOR table", onClick: () => document.querySelector('[data-testid="sor-table-card"]')?.scrollIntoView({ behavior: "smooth" }) }} />
            <KPICard testId="sor-k-hi" label="Styles > 60%" sub="High-velocity — check stock" value={fmtNum(hi)} icon={Star} showDelta={false}
              action={{ label: "Re-Order list", to: "/re-order" }} />
            <KPICard testId="sor-k-mid" label="Styles 30-60%" value={fmtNum(mid)} showDelta={false}
              action={{ label: "See styles", onClick: () => document.querySelector('[data-testid="sor-table-card"]')?.scrollIntoView({ behavior: "smooth" }) }} />
            <KPICard testId="sor-k-lo" label="Styles < 30%" sub="Slow movers — markdown?" value={fmtNum(lo)} icon={TrendDown} showDelta={false} higherIsBetter={false}
              action={{ label: "IBT candidates", to: "/ibt" }} />
          </div>

          <div className="card-white p-5" data-testid="products-top-skus">
            <SectionTitle title="Top 20 Styles" subtitle="Best-selling styles across the scope" />
            <SortableTable
              testId="top20-styles"
              exportName="top-20-styles.csv"
              initialSort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "rank", label: "#", align: "left", sortable: false, render: (_r, i) => <span className="text-muted num">{i + 1}</span> },
                { key: "thumb", label: "", align: "left", sortable: false, render: (r) => <ProductThumbnail style={r.style_name} url={urlFor(r.style_name)} size={36} />, csv: () => "" },
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
                  { key: "thumb", label: "", align: "left", sortable: false, render: (r) => <ProductThumbnail style={r.style_name} url={urlFor(r.style_name)} size={36} />, csv: () => "" },
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
              mobileCards
              initialSort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "thumb", label: "", align: "left", sortable: false, mobileHidden: true, render: (r) => <ProductThumbnail style={r.style_name} url={urlFor(r.style_name)} size={36} />, csv: () => "" },
                { key: "style_name", label: "Style", align: "left", mobilePrimary: true, render: (r) => <span className="font-medium max-w-[280px] truncate inline-block" title={r.style_name}>{r.style_name}</span> },
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
      </>)}
    </div>
  );
};

export default Products;

// ─────────────────────────────────────────────────────────────────────────────
// Product Performance sub-component — reused for both Category and Subcategory.
// Renders Units / Sales / Orders / ABV / ASP / MSI with period-delta cells when
// a previous-period dataset is supplied. Pure presentation; parent owns data.
// ─────────────────────────────────────────────────────────────────────────────
const pctChange = (c, p) => (p ? ((c - p) / p) * 100 : null);
const MetricCell = ({ curr, prev, format, invert }) => {
  const pc = pctChange(curr, prev);
  const arrow = pc == null ? null : pc > 0 ? "▲" : pc < 0 ? "▼" : "●";
  const good = invert ? (pc < 0) : (pc > 0);
  const color = pc == null ? "text-muted" : Math.abs(pc) < 0.1 ? "text-muted" : good ? "text-brand" : "text-danger";
  return (
    <div className="inline-flex flex-col items-end leading-tight">
      <span className="num font-semibold">{format(curr)}</span>
      {pc != null && (
        <span className={`text-[10px] font-semibold ${color}`}>{arrow} {Math.abs(pc).toFixed(1)}%</span>
      )}
    </div>
  );
};

const ProductPerformance = ({ title, subtitle, testId, nameKey, nameLabel, rows, prevRows, compareLbl, csvName }) => {
  // Ensure every row has pct_of_total_sales (category endpoint supplies it,
  // subcategory endpoint does not — compute from the local total so both
  // cases render consistently).
  const totalSales = (rows || []).reduce((s, r) => s + (r.total_sales || 0), 0);
  const prevMap = new Map((prevRows || []).map((r) => [r[nameKey], r]));
  const decorated = (rows || []).map((r) => {
    const units = r.units_sold || 0;
    const sales = r.total_sales || 0;
    const orders = r.orders || 0;
    const pctSales = r.pct_of_total_sales != null ? r.pct_of_total_sales : (totalSales ? (sales / totalSales) * 100 : 0);
    const abv = orders ? sales / orders : 0;
    const asp = units ? sales / units : 0;
    const msi = orders ? units / orders : 0;
    const p = prevMap.get(r[nameKey]) || {};
    const pUnits = p.units_sold || 0;
    const pSales = p.total_sales || 0;
    const pOrders = p.orders || 0;
    return {
      ...r, abv, asp, msi, pct_of_total_sales: pctSales,
      _prev: {
        units: pUnits, sales: pSales, orders: pOrders,
        abv: pOrders ? pSales / pOrders : 0,
        asp: pUnits ? pSales / pUnits : 0,
        msi: pOrders ? pUnits / pOrders : 0,
      },
    };
  });

  const hasCompare = Boolean(compareLbl) && (prevRows || []).length > 0;

  return (
    <div className="card-white p-5" data-testid={testId}>
      <SectionTitle
        title={title}
        subtitle={subtitle + (hasCompare ? ` Deltas ${compareLbl}.` : "")}
      />
      <SortableTable
        testId={testId + "-table"}
        exportName={csvName}
        initialSort={{ key: "total_sales", dir: "desc" }}
        columns={[
          { key: nameKey, label: nameLabel, align: "left" },
          { key: "units_sold", label: "Units Sold", numeric: true,
            render: hasCompare
              ? (r) => <MetricCell curr={r.units_sold} prev={r._prev.units} format={fmtNum} />
              : (r) => fmtNum(r.units_sold),
            csv: (r) => r.units_sold },
          { key: "total_sales", label: "Sales", numeric: true,
            render: hasCompare
              ? (r) => <MetricCell curr={r.total_sales} prev={r._prev.sales} format={fmtKES} />
              : (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>,
            csv: (r) => r.total_sales },
          { key: "pct_of_total_sales", label: "% of Sales", numeric: true,
            render: (r) => fmtPct(r.pct_of_total_sales, 1),
            csv: (r) => r.pct_of_total_sales?.toFixed(2) },
          { key: "orders", label: "Orders", numeric: true,
            render: hasCompare
              ? (r) => <MetricCell curr={r.orders} prev={r._prev.orders} format={fmtNum} />
              : (r) => fmtNum(r.orders),
            csv: (r) => r.orders },
          { key: "abv", label: "ABV", numeric: true,
            render: hasCompare
              ? (r) => <MetricCell curr={r.abv} prev={r._prev.abv} format={fmtKES} />
              : (r) => fmtKES(r.abv),
            csv: (r) => r.abv?.toFixed(0) },
          { key: "asp", label: "ASP", numeric: true,
            render: hasCompare
              ? (r) => <MetricCell curr={r.asp} prev={r._prev.asp} format={fmtKES} />
              : (r) => fmtKES(r.asp),
            csv: (r) => r.asp?.toFixed(0) },
          { key: "msi", label: "MSI", numeric: true,
            render: hasCompare
              ? (r) => <MetricCell curr={r.msi} prev={r._prev.msi} format={(v) => v.toFixed(2)} />
              : (r) => r.msi.toFixed(2),
            csv: (r) => r.msi?.toFixed(3) },
          { key: "variance", label: "Variance %", numeric: true,
            sortValue: (r) => Math.abs(r.variance || 0),
            render: (r) => <VarianceCell value={r.variance} />,
            csv: (r) => r.variance?.toFixed(2) },
        ]}
        rows={decorated}
      />
      <p className="text-[11px] text-muted italic mt-2">
        ABV = Sales ÷ Orders · ASP = Sales ÷ Units Sold · MSI = Units ÷ Orders. Margin % and Return Rate columns deferred — pending upstream cost / returns data feed.
      </p>
    </div>
  );
};
