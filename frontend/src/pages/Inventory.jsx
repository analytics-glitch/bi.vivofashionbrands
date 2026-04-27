import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtDec, fmtPct, fmtAxisKES, COUNTRY_FLAGS } from "@/lib/api";
import { varianceStyle, VarianceCell } from "@/lib/variance";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import RecommendationActionPill from "@/components/RecommendationActionPill";
import { useRecommendationState } from "@/lib/useRecommendationState";
import { ChartTooltip, makePctDeltaLabel } from "@/components/ChartHelpers";
import { categoryFor, isMerchandise } from "@/lib/productCategory";
import SORHeader from "@/components/SORHeader";
import {
  Package,
  Warning,
  Storefront,
  MagnifyingGlass,
  TrendDown,
  Cube,
  Gauge,
} from "@phosphor-icons/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  LabelList,
} from "recharts";

const Inventory = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;

  const { stateByKey: dqByKey, setState: setDqState } = useRecommendationState("dq");

  const [summary, setSummary] = useState(null);
  const [inv, setInv] = useState([]);
  const [sts, setSts] = useState([]);
  const [subcatSS, setSubcatSS] = useState([]);
  const [stsByCat, setStsByCat] = useState([]);
  const [weeksOfCover, setWeeksOfCover] = useState([]);
  const [sellThrough, setSellThrough] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Live search — debounced via useEffect below to avoid re-render storms.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  // Include warehouse / wholesale / holding stock in the POS-scoped STS
  // tables. Off by default — most users want pure shop-floor stock.
  const [includeWarehouse, setIncludeWarehouse] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 120);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const countryCsv = countries.length ? countries.map((c) => c.toLowerCase()).join(",") : undefined;
    const locationsCsv = channels.length ? channels.join(",") : undefined;
    const invParams = { country: countryCsv, locations: locationsCsv };
    const refreshParams = dataVersion > 0 ? { ...invParams, refresh: true } : invParams;
    const dateParams = {
      date_from: dateFrom, date_to: dateTo,
      country: countryCsv, locations: locationsCsv,
      include_warehouse: includeWarehouse ? 1 : undefined,
    };
    Promise.all([
      api.get("/analytics/inventory-summary", { params: refreshParams }),
      api.get("/inventory", { params: refreshParams }),
      api.get("/stock-to-sales", { params: { date_from: dateFrom, date_to: dateTo, country: countryCsv, locations: locationsCsv } }),
      api.get("/analytics/stock-to-sales-by-subcat", { params: dateParams }),
      api.get("/analytics/stock-to-sales-by-category", { params: dateParams }),
      api.get("/analytics/weeks-of-cover", { params: { country: countryCsv, locations: locationsCsv } }),
      api.get("/analytics/sell-through-by-location", { params: { date_from: dateFrom, date_to: dateTo, country: countryCsv } })
        .catch(() => ({ data: [] })),
    ])
      .then(([s, i, st, sc, cat, woc, str]) => {
        if (cancelled) return;
        setSummary(s.data);
        setInv(i.data || []);
        setSts(st.data || []);
        setSubcatSS(sc.data || []);
        setStsByCat(cat.data || []);
        setWeeksOfCover(woc.data || []);
        setSellThrough(str.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), dataVersion, includeWarehouse]);

  // --- Merchandise-only raw inventory ---
  // Hard rule: exclude Accessories, Sale, Belts/Scarves/Fragrances/Sample &
  // Sale Items, and any row with a null/empty product_type across the app.
  const merchInv = useMemo(
    () => inv.filter((r) => isMerchandise(r.product_type)),
    [inv]
  );

  const brands = useMemo(
    () => [...new Set(merchInv.map((r) => r.brand).filter(Boolean))].sort(),
    [merchInv]
  );
  const types = useMemo(
    () => [...new Set(merchInv.map((r) => r.product_type).filter(Boolean))].sort(),
    [merchInv]
  );

  // Dedupe style → canonical subcategory (style with multiple product_types
  // gets the one with the most units).
  const styleCanonicalType = useMemo(() => {
    const counts = new Map();
    for (const r of merchInv) {
      const style = r.style_name || r.product_name;
      const pt = r.product_type;
      if (!style || !pt) continue;
      if (!counts.has(style)) counts.set(style, {});
      const m = counts.get(style);
      m[pt] = (m[pt] || 0) + (r.available || 1);
    }
    const out = new Map();
    for (const [style, m] of counts) {
      const best = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
      if (best) out.set(style, best[0]);
    }
    return out;
  }, [merchInv]);

  // Pre-enriched rows with a pre-computed lowercase `_search` blob so every
  // keystroke costs ONE String.includes call per row instead of four.
  const enrichedInv = useMemo(() => {
    return merchInv.map((r) => {
      const style = r.style_name || r.product_name;
      const canonicalType = styleCanonicalType.get(style);
      const _search = (
        (r.product_name || "") + "\t" +
        (r.style_name || "") + "\t" +
        (r.sku || "") + "\t" +
        (r.barcode || "")
      ).toLowerCase();
      return canonicalType ? { ...r, product_type: canonicalType, _search } : { ...r, _search };
    });
  }, [merchInv, styleCanonicalType]);

  // Apply country, location, brand, product-type AND search (product / sku /
  // style / barcode) filters. This drives every downstream aggregate.
  const filteredInv = useMemo(() => {
    const q = search.toLowerCase();
    const hasCountryFilter = countries.length > 1;
    const countriesLC = hasCountryFilter ? countries.map((c) => c.toLowerCase()) : null;
    const channelsSet = channels.length ? new Set(channels) : null;
    return enrichedInv.filter((r) => {
      if (countriesLC && !countriesLC.includes((r.country || "").toLowerCase())) return false;
      if (channelsSet && !channelsSet.has(r.location_name)) return false;
      if (brandFilter && r.brand !== brandFilter) return false;
      if (typeFilter && r.product_type !== typeFilter) return false;
      if (!q) return true;
      return r._search.includes(q);
    });
  }, [enrichedInv, countries, channels, brandFilter, typeFilter, search]);

  // When any filter (search/brand/type) is active, derive the visible
  // location & subcategory set and restrict the aggregated charts/tables to
  // match. When no filters are active we show the raw merchandise aggregates.
  const filtersActive = Boolean(search || brandFilter || typeFilter);
  const visibleLocations = useMemo(
    () => new Set(filteredInv.map((r) => r.location_name).filter(Boolean)),
    [filteredInv]
  );
  const visibleSubcats = useMemo(
    () => new Set(filteredInv.map((r) => r.product_type).filter(Boolean)),
    [filteredInv]
  );
  const visibleStyles = useMemo(
    () => new Set(filteredInv.map((r) => r.style_name || r.product_name).filter(Boolean)),
    [filteredInv]
  );

  // Stock by location — from filteredInv when filters active, else from
  // summary (backend merchandise-filtered aggregate if available).
  const stockByLocation = useMemo(() => {
    if (filtersActive) {
      const m = new Map();
      for (const r of filteredInv) {
        const loc = r.location_name || "—";
        m.set(loc, (m.get(loc) || 0) + (r.available || 0));
      }
      return [...m.entries()]
        .map(([location, units]) => ({ location, units }))
        .sort((a, b) => b.units - a.units);
    }
    // Filter summary.by_location to only include merchandise units — we don't
    // have a per-subcat breakdown in by_location, so re-derive from merchInv.
    const m = new Map();
    for (const r of merchInv) {
      const loc = r.location_name || "—";
      m.set(loc, (m.get(loc) || 0) + (r.available || 0));
    }
    return [...m.entries()]
      .map(([location, units]) => ({ location, units }))
      .sort((a, b) => b.units - a.units);
  }, [filtersActive, filteredInv, merchInv]);

  const totalFilteredUnits = useMemo(
    () => filteredInv.reduce((s, r) => s + (r.available || 0), 0),
    [filteredInv]
  );

  // Store vs Warehouse split derived from filtered rows.
  const storeVsWarehouse = useMemo(() => {
    const isWarehouse = (loc) => {
      const s = (loc || "").toLowerCase();
      return /warehouse|wholesale|holding|staging|sale stock/.test(s);
    };
    let store = 0;
    let warehouse = 0;
    for (const r of filteredInv) {
      if (isWarehouse(r.location_name)) warehouse += r.available || 0;
      else store += r.available || 0;
    }
    return { store, warehouse };
  }, [filteredInv]);

  const lowStockByStyle = useMemo(() => {
    const m = new Map();
    for (const r of filteredInv) {
      const style = r.style_name || r.product_name;
      if (!style) continue;
      // Extra guard: filter out any non-merchandise that slipped through.
      if (!isMerchandise(r.product_type)) continue;
      if (!m.has(style)) {
        m.set(style, {
          style_name: style,
          brand: r.brand,
          product_type: r.product_type,
          category: categoryFor(r.product_type),
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
    return [...m.values()]
      .filter((e) => e.available <= 10)
      .map((e) => ({ ...e, locations: e.locations.size }))
      .sort((a, b) => a.available - b.available);
  }, [filteredInv]);

  const understockedSubcats = useMemo(() => {
    return subcatSS
      .filter((r) => isMerchandise(r.subcategory))
      .filter((r) => !filtersActive || visibleSubcats.has(r.subcategory))
      .map((r) => ({
        ...r,
        understock_pct: (r.pct_of_total_sold || 0) - (r.pct_of_total_stock || 0),
      }))
      .filter((r) => r.understock_pct > 0.5)
      .sort((a, b) => b.understock_pct - a.understock_pct);
  }, [subcatSS, filtersActive, visibleSubcats]);

  // Set of visible categories (derived from visible subcats) — used to
  // restrict the Inventory-by-Category chart and Stock-to-Sales-by-Category
  // table when a search / brand / subcategory filter is active.
  const visibleCategories = useMemo(() => {
    if (!filtersActive) return null;
    const s = new Set();
    for (const sc of visibleSubcats) {
      const c = categoryFor(sc);
      if (c) s.add(c);
    }
    return s;
  }, [filtersActive, visibleSubcats]);

  const invByCategory = useMemo(() => {
    let src = stsByCat.filter((r) => !["Accessories", "Sale", "Other"].includes(r.category) && r.category);
    if (visibleCategories) src = src.filter((r) => visibleCategories.has(r.category));
    const total = src.reduce((s, r) => s + (r.current_stock || 0), 0) || 1;
    return [...src]
      .sort((a, b) => (b.current_stock || 0) - (a.current_stock || 0))
      .map((r) => {
        const pct = ((r.current_stock || 0) / total) * 100;
        return { ...r, pct, cat_label: `${fmtNum(r.current_stock)} · ${pct.toFixed(1)}%` };
      });
  }, [stsByCat, visibleCategories]);

  const invBySubcat = useMemo(() => {
    const raw = summary?.by_product_type || [];
    const merch = raw
      .filter((r) => isMerchandise(r.product_type))
      .filter((r) => !filtersActive || visibleSubcats.has(r.product_type));
    const sorted = [...merch].sort((a, b) => (b.units || 0) - (a.units || 0));
    const total = sorted.reduce((s, r) => s + (r.units || 0), 0) || 1;
    return sorted.slice(0, 15).map((r) => {
      const pct = ((r.units || 0) / total) * 100;
      return { ...r, pct, subcat_label: `${pct.toFixed(1)}%` };
    });
  }, [summary, filtersActive, visibleSubcats]);

  const filteredWeeksOfCover = useMemo(
    () => weeksOfCover
      .filter((r) => isMerchandise(r.subcategory))
      .filter((r) => !filtersActive || visibleStyles.has(r.style_name)),
    [weeksOfCover, filtersActive, visibleStyles]
  );

  // ─── Stock aging classification ──────────────────────────────────
  // Buckets derived from weeks_of_cover + last-28-day units:
  //   Fresh     < 4w   (stock is flowing)
  //   Healthy   4–8w   (normal replenishment cadence)
  //   Aging     8–16w  (slow, keep eye)
  //   Stale     > 16w  (markdown candidate)
  //   Phantom   stock ≥ 30 AND zero sales in the last 4 weeks
  //             (dead money — IBT or clearance immediately)
  const bucketFor = (r) => {
    const stock = r.current_stock || 0;
    const sold28 = r.units_sold_28d || 0;
    if (stock >= 30 && sold28 === 0) return "phantom";
    const w = r.weeks_of_cover;
    if (w == null) return "phantom"; // no sales but not enough stock to call phantom
    if (w < 4)  return "fresh";
    if (w < 8)  return "healthy";
    if (w < 16) return "aging";
    return "stale";
  };
  const agingRows = useMemo(
    () => filteredWeeksOfCover.map((r) => ({ ...r, _bucket: bucketFor(r) })),
    [filteredWeeksOfCover]
  );
  const agingSummary = useMemo(() => {
    const init = { fresh: 0, healthy: 0, aging: 0, stale: 0, phantom: 0 };
    const byBucket = agingRows.reduce((acc, r) => {
      acc[r._bucket] = (acc[r._bucket] || 0) + 1;
      return acc;
    }, init);
    const phantomStockUnits = agingRows
      .filter((r) => r._bucket === "phantom")
      .reduce((s, r) => s + (r.current_stock || 0), 0);
    return { byBucket, phantomStockUnits };
  }, [agingRows]);
  const phantomRows = useMemo(
    () => agingRows
      .filter((r) => r._bucket === "phantom")
      .sort((a, b) => (b.current_stock || 0) - (a.current_stock || 0)),
    [agingRows]
  );

  const filteredSts = useMemo(
    () => (filtersActive ? sts.filter((r) => visibleLocations.has(r.location)) : sts),
    [sts, filtersActive, visibleLocations]
  );

  const filteredStsByCat = useMemo(() => {
    let src = stsByCat.filter((r) => !["Accessories", "Sale", "Other"].includes(r.category) && r.category);
    if (visibleCategories) src = src.filter((r) => visibleCategories.has(r.category));
    return src;
  }, [stsByCat, visibleCategories]);

  const filteredSubcatSS = useMemo(
    () => subcatSS
      .filter((r) => isMerchandise(r.subcategory))
      .filter((r) => !filtersActive || visibleSubcats.has(r.subcategory)),
    [subcatSS, filtersActive, visibleSubcats]
  );

  const kpiTotal = filtersActive ? totalFilteredUnits : (summary?.total_units || 0);
  const kpiStore = filtersActive ? storeVsWarehouse.store : (summary?.store_units || 0);
  const kpiWarehouse = filtersActive ? storeVsWarehouse.warehouse : (summary?.warehouse_units || 0);

  // Export filename slug reflecting the active filters — makes traceability
  // obvious when sharing CSVs via email/chat.
  const exportSlug = useMemo(() => {
    const parts = [];
    if (channels.length) parts.push(channels.map((c) => c.replace(/\s+/g, "-").toLowerCase()).join("+"));
    else if (countries.length) parts.push(countries.map((c) => c.toLowerCase()).join("+"));
    else parts.push("all");
    parts.push(new Date().toISOString().slice(0, 10));
    return parts.join("_");
  }, [channels, countries]);

  // Variance classifier & cell live in `/app/frontend/src/lib/variance.jsx`
  // so Products page and any future views (Re-Order, IBT, CEO Report) use
  // identical thresholds and flags. Do not re-implement locally.
  // VarianceCell renders icon + "±X.XX pts" with hover tip; varianceStyle
  // returns { cls, icon, flag, tip } for custom layouts.
  // Keep the "pts" suffix here (instead of "%") since Inventory displays
  // variance in points while the page text talks "pp". Products page uses
  // default "%" suffix.
  const VarianceCellPts = ({ value }) => <VarianceCell value={value} suffix=" pts" />;

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <div>
        <div className="eyebrow">Dashboard · Inventory</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">
          Inventory
        </h1>
        <p className="text-muted text-[13px] mt-0.5">
          Merchandise only — Accessories, Sample &amp; Sale Items and
          uncategorised products are excluded from every section below.
        </p>
        {(countries.length > 0 || channels.length > 0) && (
          <div
            className="mt-2 flex flex-wrap items-center gap-2"
            data-testid="inv-filter-row"
          >
            <div
              className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1 text-[11.5px] font-semibold text-brand-deep"
              data-testid="inv-active-filter-banner"
            >
              <span className="text-muted font-normal">Showing inventory for:</span>
              {countries.map((c) => (
                <span key={`c-${c}`} className="pill-neutral">{c}</span>
              ))}
              {channels.map((p) => (
                <span key={`p-${p}`} className="pill-green">POS · {p}</span>
              ))}
            </div>
            {channels.length > 0 && (
              <label
                className="inline-flex items-center gap-1.5 cursor-pointer rounded-lg border border-border bg-white px-2.5 py-1 text-[11.5px] font-semibold hover:border-brand/40 select-none"
                data-testid="inv-include-warehouse-toggle"
                title="When ON, the POS-scoped Stock-to-Sales tables ADD warehouse / wholesale / holding inventory on top of shop-floor stock. Useful when you need to see total allocable units, not just what's on the floor. OFF (default) = shop-floor stock only."
              >
                <input
                  type="checkbox"
                  checked={includeWarehouse}
                  onChange={(e) => setIncludeWarehouse(e.target.checked)}
                  className="accent-brand"
                  data-testid="inv-include-warehouse-checkbox"
                />
                <span>Include warehouse stock</span>
                {includeWarehouse && <span className="pill-amber">+ warehouse</span>}
              </label>
            )}
          </div>
        )}
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KPICard
              testId="inv-kpi-units"
              accent
              label="Total Available Units"
              sub={filtersActive ? "Filtered" : "All merchandise"}
              value={fmtNum(kpiTotal)}
              icon={Package}
              showDelta={false}
              action={{ label: "Export inventory CSV", to: "/exports" }}
            />
            <KPICard
              testId="inv-kpi-store-stock"
              label="Stock in Stores"
              sub="Customer-facing units (excl. warehouse / holding)"
              value={fmtNum(kpiStore)}
              icon={Storefront}
              showDelta={false}
              action={{ label: "IBT candidates", to: "/ibt" }}
            />
            <KPICard
              testId="inv-kpi-warehouse-stock"
              label="Stock in Warehouse"
              sub="Warehouse, wholesale, holding, staging"
              value={fmtNum(kpiWarehouse)}
              icon={Cube}
              showDelta={false}
              action={{ label: "Plan distribution", to: "/ibt" }}
            />
            {(() => {
              // Overall Weeks of Cover = Σ(current_stock) ÷ Σ(weekly units sold).
              // Weekly units = Σ(units_sold_28d) ÷ 4. Computed across the
              // current scope (filters apply via filteredWeeksOfCover).
              const totalStock = filteredWeeksOfCover.reduce((s, r) => s + (r.current_stock || 0), 0);
              const totalWeekly = filteredWeeksOfCover.reduce((s, r) => s + (r.units_sold_28d || 0), 0) / 4;
              const woc = totalWeekly > 0 ? totalStock / totalWeekly : null;
              const sub = woc == null
                ? "Not enough sales history"
                : woc < 4 ? "Healthy — stock is moving"
                : woc < 8 ? "Watch — slowing"
                : woc < 16 ? "Heavy — markdown candidates"
                : "Stale — clearance now";
              return (
                <KPICard
                  testId="inv-kpi-weeks-of-cover"
                  label="Overall Weeks of Cover"
                  sub={sub}
                  formula={
                    "Overall WoC = Σ current_stock ÷ Σ weekly_units_sold.\n" +
                    "Weekly units = units_sold_28d ÷ 4. Lower is better — high WoC means stock is sitting too long."
                  }
                  value={woc == null ? "—" : `${woc.toFixed(1)} wks`}
                  icon={Gauge}
                  higherIsBetter={false}
                  showDelta={false}
                  action={{ label: "See aging buckets", onClick: () => document.querySelector('[data-testid="weeks-of-cover"]')?.scrollIntoView({ behavior: "smooth" }) }}
                />
              );
            })()}
            <KPICard
              testId="inv-kpi-lowstock"
              label="Low-Stock Styles (≤10)"
              sub="Risk of stockout — act fast"
              value={fmtNum(lowStockByStyle.length)}
              icon={Warning}
              showDelta={false}
              higherIsBetter={false}
              action={{ label: "Triage now", onClick: () => document.querySelector('[data-testid="low-stock-section"]')?.scrollIntoView({ behavior: "smooth" }) }}
            />
          </div>

          <div className="card-white p-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 input-pill flex-1 min-w-[260px]">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search product name, style or SKU — filters every chart & table"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                data-testid="inv-search"
                className="bg-transparent outline-none text-[13px] w-full"
              />
            </div>
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                data-testid="inv-search-clear"
                className="px-2.5 py-1.5 rounded-lg text-[12px] text-muted hover:bg-panel"
              >
                Clear
              </button>
            )}
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
              <option value="">All subcategories</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {filtersActive && (
              <span className="pill-neutral text-[11px]">
                Filtered — {fmtNum(filteredInv.length)} SKUs · {fmtNum(totalFilteredUnits)} units
              </span>
            )}
          </div>

          <div className="card-white p-5" data-testid="chart-inv-location">
            <SectionTitle
              title={`Stock by location · ${stockByLocation.length} locations`}
              subtitle="All locations sorted by stock-on-hand descending — spot which warehouses and stores are holding the bulk of your inventory and whether the distribution matches sales demand."
            />
            {stockByLocation.length === 0 ? <Empty /> : (
              <div style={{ width: "100%", height: 24 + stockByLocation.length * 22 }}>
                <ResponsiveContainer>
                  <BarChart data={stockByLocation} layout="vertical" margin={{ left: 10, right: 60, top: 4 }}>
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
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card-white p-5" data-testid="chart-inv-category">
              <SectionTitle title="Inventory by Category" subtitle="How much stock you have in each category right now." />
              {invByCategory.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: 340 }}>
                  <ResponsiveContainer>
                    <BarChart data={invByCategory} margin={{ top: 24, bottom: 60 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="category" interval={0} angle={-20} textAnchor="end" height={70} tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip formatters={{
                        Inventory: (v, p) => `${fmtNum(v)} units · ${(p?.pct || 0).toFixed(1)}% of total`,
                        current_stock: (v, p) => `${fmtNum(v)} units · ${(p?.pct || 0).toFixed(1)}% of total`,
                      }} />} />
                      <Bar dataKey="current_stock" fill="#1a5c38" radius={[5, 5, 0, 0]} name="Inventory">
                        <LabelList
                          dataKey="current_stock"
                          content={makePctDeltaLabel({
                            data: invByCategory,
                            valueKey: "current_stock",
                            formatValue: (v) => fmtNum(v),
                            position: "top",
                            offset: 8,
                            fontSize: 10,
                            hideDelta: true, // Inventory is a snapshot — no period delta.
                            labelTestId: "inv-cat-bar-label",
                          })}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="card-white p-5" data-testid="chart-inv-subcat">
              <SectionTitle title="Inventory by Subcategory" subtitle="Stock-on-hand for the top 15 subcategories. Compare with Sales by Subcategory to spot overstock or thin cover on best-sellers." />
              {invBySubcat.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: 340 }}>
                  <ResponsiveContainer>
                    <BarChart data={invBySubcat} margin={{ top: 24, bottom: 80 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="product_type" interval={0} angle={-30} textAnchor="end" height={90} tick={{ fontSize: 9 }} />
                      <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip formatters={{
                        Inventory: (v, p) => `${fmtNum(v)} units · ${(p?.pct || 0).toFixed(1)}% of total`,
                        units: (v, p) => `${fmtNum(v)} units · ${(p?.pct || 0).toFixed(1)}% of total`,
                      }} />} />
                      <Bar dataKey="units" fill="#00c853" radius={[5, 5, 0, 0]} name="Inventory">
                        <LabelList
                          dataKey="units"
                          content={makePctDeltaLabel({
                            data: invBySubcat,
                            valueKey: "units",
                            formatValue: (v) => fmtNum(v),
                            position: "top",
                            offset: 8,
                            fontSize: 9,
                            hideDelta: true, // Inventory is a snapshot — no period delta.
                            labelTestId: "inv-subcat-bar-label",
                          })}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="card-white p-5" data-testid="sts-by-category-table">
            <SectionTitle
              title="Stock-to-Sales · by Category"
              subtitle="Aggregated groups (Dresses, Tops, Bottoms, …). Variance compares sales share vs stock share. Red = action needed (stockout or overstock risk). Green = healthy balance."
            />
            <SortableTable
              testId="inv-sts-cat"
              exportName={`inventory-sts-by-category_${exportSlug}.csv`}
              initialSort={{ key: "variance_abs", dir: "desc" }}
              columns={[
                { key: "category", label: "Category", align: "left" },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                { key: "current_stock", label: "Inventory", numeric: true, render: (r) => fmtNum(r.current_stock) },
                { key: "pct_of_total_sold", label: "% of Total Sales", numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2) },
                { key: "pct_of_total_stock", label: "% of Total Inventory", numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2) },
                {
                  key: "variance", label: "Variance", numeric: true,
                  sortValue: (r) => Math.abs(r.variance || 0), // sort by magnitude → biggest risks top
                  render: (r) => <VarianceCellPts value={r.variance} />,
                  csv: (r) => r.variance?.toFixed(2),
                },
                {
                  key: "risk_flag", label: "Risk Flag", align: "left",
                  render: (r) => <span className="text-[11px] text-muted">{varianceStyle(r.variance).flag}</span>,
                  csv: (r) => varianceStyle(r.variance).flag,
                },
              ]}
              rows={filteredStsByCat}
            />
          </div>

          <div className="card-white p-5" data-testid="sts-by-subcategory-table">
            <SectionTitle
              title="Stock-to-Sales · by Subcategory"
              subtitle="Granular view — one row per merchandise subcategory. Red = action needed (stockout or overstock risk). Green = healthy balance."
            />
            <SortableTable
              testId="inv-sts-subcat"
              exportName={`inventory-sts-by-subcategory_${exportSlug}.csv`}
              pageSize={15}
              initialSort={{ key: "variance_abs", dir: "desc" }}
              columns={[
                { key: "category", label: "Category", align: "left", render: (r) => <span className="pill-neutral">{categoryFor(r.subcategory) || "—"}</span>, csv: (r) => categoryFor(r.subcategory) },
                { key: "subcategory", label: "Subcategory", align: "left" },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                { key: "current_stock", label: "Inventory", numeric: true, render: (r) => fmtNum(r.current_stock) },
                { key: "pct_of_total_sold", label: "% of Total Sales", numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2) },
                { key: "pct_of_total_stock", label: "% of Total Inventory", numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2) },
                {
                  key: "variance", label: "Variance", numeric: true,
                  sortValue: (r) => Math.abs(r.variance || 0),
                  render: (r) => <VarianceCellPts value={r.variance} />,
                  csv: (r) => r.variance?.toFixed(2),
                },
                {
                  key: "risk_flag", label: "Risk Flag", align: "left",
                  render: (r) => <span className="text-[11px] text-muted">{varianceStyle(r.variance).flag}</span>,
                  csv: (r) => varianceStyle(r.variance).flag,
                },
              ]}
              rows={filteredSubcatSS}
            />
          </div>

          {understockedSubcats.length > 0 && (
            <div className="card-white p-5 border-l-4 border-brand-strong" data-testid="understocked-subcats">
              <SectionTitle
                title={`Understocked subcategories · ${understockedSubcats.length}`}
                subtitle="Subcategories where sales share exceeds inventory share. These are your replenishment priorities — re-order before they go fully out of stock."
              />
              <SortableTable
                testId="understocked"
                exportName="understocked-subcategories.csv"
                initialSort={{ key: "understock_pct", dir: "desc" }}
                columns={[
                  { key: "rank", label: "#", align: "left", sortable: false, render: (_r, i) => <span className="text-muted num">{i + 1}</span> },
                  { key: "category", label: "Category", align: "left", render: (r) => <span className="pill-neutral">{categoryFor(r.subcategory) || "—"}</span>, csv: (r) => categoryFor(r.subcategory) },
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
                  { key: "sor_percent", label: <SORHeader />, numeric: true, render: (r) => fmtPct(r.sor_percent), csv: (r) => r.sor_percent?.toFixed(2) },
                ]}
                rows={understockedSubcats}
              />
            </div>
          )}

          {lowStockByStyle.length > 0 && (
            <div className="card-white p-5 border-l-4 border-danger" data-testid="low-stock-section">
              <SectionTitle
                title={`Low-stock alerts · ${lowStockByStyle.length} styles`}
                subtitle="Merchandise styles with ≤10 total available units across all SKUs in the current scope — imminent stockout risk. Review re-order list and fast-track POs."
              />
              <SortableTable
                testId="low-stock"
                exportName="low-stock-alerts.csv"
                pageSize={80}
                initialSort={{ key: "available", dir: "asc" }}
                columns={[
                  { key: "style_name", label: "Style", align: "left", render: (r) => <span className="font-medium max-w-[300px] truncate inline-block" title={r.style_name}>{r.style_name || "—"}</span> },
                  { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                  { key: "category", label: "Category", align: "left", render: (r) => <span className="pill-neutral">{r.category || "—"}</span>, csv: (r) => r.category },
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
              title="Stock cover (units-sold multiplier) by location"
              subtitle="Stock-to-units-sold multiplier — a HIGH value means low velocity (potential overstock). Weeks of Cover (next table) uses last-4-week velocity and is more actionable for replenishment decisions."
            />
            <SortableTable
              testId="sts-location"
              exportName={`stock-cover-by-location_${exportSlug}.csv`}
              initialSort={{ key: "stock_to_sales_ratio", dir: "desc" }}
              columns={[
                { key: "location", label: "Location", align: "left", render: (r) => <span className="font-medium">{r.location}</span> },
                { key: "country", label: "Country", align: "left", render: (r) => <span>{COUNTRY_FLAGS[r.country] || "🌍"} {r.country}</span>, csv: (r) => r.country },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                { key: "current_stock", label: "Current Stock", numeric: true, render: (r) => fmtNum(r.current_stock) },
                { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="font-semibold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                {
                  key: "stock_to_sales_ratio",
                  label: (
                    <span title="Stock cover (units-sold multiplier) = current_stock ÷ units_sold_in_period.  High multiplier = low velocity, not necessarily overstocking.">
                      Cover multiplier ⓘ
                    </span>
                  ),
                  numeric: true,
                  sortValue: (r) => r.stock_to_sales_ratio || 0,
                  render: (r) => {
                    const v = r.stock_to_sales_ratio || 0;
                    const pill = v > 10 ? "pill-red" : v >= 3 ? "pill-amber" : v >= 1 ? "pill-green" : "pill-neutral";
                    return <span className={pill}>{fmtDec(v, 2)}×</span>;
                  },
                  csv: (r) => r.stock_to_sales_ratio?.toFixed(2),
                },
                {
                  key: "weeks_of_cover",
                  label: (
                    <span title="Weeks of Cover = current_stock ÷ (units sold in last 4 weeks ÷ 4). Lower is faster turnover.">
                      Weeks of Cover ⓘ
                    </span>
                  ),
                  numeric: true,
                  sortValue: (r) => {
                    const v = r.weeks_of_cover;
                    return v == null ? 9999 : v;
                  },
                  render: (r) => {
                    if (r.weeks_of_cover == null) return <span className="pill-neutral">—</span>;
                    const w = r.weeks_of_cover;
                    const cls = w < 2 ? "pill-red" : w <= 4 ? "pill-amber" : "pill-green";
                    return <span className={cls}>{w.toFixed(1)}w</span>;
                  },
                  csv: (r) => (r.weeks_of_cover == null ? "" : r.weeks_of_cover.toFixed(2)),
                },
              ]}
              rows={filteredSts}
            />
          </div>

          <div className="card-white p-5" data-testid="sell-through-by-location">
            <SectionTitle
              title={`Sell-Through Rate · by Location · ${(sellThrough || []).filter((r) => r.sell_through_pct != null).length} POS`}
              subtitle="Sell-through % = units sold in window ÷ (units sold + current stock). Higher = stock is actually moving. 25%+ = strong · 12–25% = healthy · 5–12% = slow · <5% = stuck. Use this alongside Weeks-of-Cover to spot overstocked stores."
            />
            {(!sellThrough || sellThrough.length === 0) ? (
              <Empty label="No sell-through data for the selected window." />
            ) : (
              <SortableTable
                testId="sell-through-table"
                exportName={`sell-through_${exportSlug}.csv`}
                pageSize={25}
                mobileCards
                initialSort={{ key: "sell_through_pct", dir: "desc" }}
                columns={[
                  { key: "location", label: "Location", align: "left", mobilePrimary: true, render: (r) => <span className="font-medium">{r.location}</span> },
                  { key: "country", label: "Country", align: "left", render: (r) => <span>{COUNTRY_FLAGS[r.country] || "🌍"} {r.country || "—"}</span>, csv: (r) => r.country },
                  { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                  { key: "current_stock", label: "Current Stock", numeric: true, render: (r) => fmtNum(Math.round(r.current_stock || 0)) },
                  { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="font-semibold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                  {
                    key: "sell_through_pct", label: "Sell-Through %", numeric: true,
                    sortValue: (r) => r.sell_through_pct ?? -1,
                    render: (r) => {
                      if (r.sell_through_pct == null) return <span className="pill-neutral text-[10px]">no stock data</span>;
                      const p = r.sell_through_pct;
                      const cls = p >= 25 ? "pill-green" : p >= 12 ? "pill-amber" : p >= 5 ? "pill-amber" : "pill-red";
                      return <span className={cls}>{p.toFixed(1)}%</span>;
                    },
                    csv: (r) => r.sell_through_pct,
                  },
                  {
                    key: "health", label: "Health", align: "left",
                    render: (r) => {
                      const map = {
                        strong:        { label: "Strong",  cls: "pill-green" },
                        healthy:       { label: "Healthy", cls: "pill-green" },
                        slow:          { label: "Slow",    cls: "pill-amber" },
                        stuck:         { label: "Stuck",   cls: "pill-red" },
                        no_stock_data: { label: "No stock", cls: "pill-neutral" },
                      };
                      const m = map[r.health] || map.stuck;
                      return <span className={m.cls}>{m.label}</span>;
                    },
                    csv: (r) => r.health,
                  },
                ]}
                rows={sellThrough}
              />
            )}
            <p className="text-[11px] text-muted italic mt-2">
              ℹ Stock-at-start-of-period is approximated as (current_stock + units_sold) — upstream doesn't keep historical on-hand; mid-period receipts aren't modelled yet.
            </p>
          </div>

          <div className="card-white p-5" data-testid="stock-aging-summary">
            <SectionTitle
              title="Stock Aging · buckets by weeks-on-hand"
              subtitle="Classifies every merchandise style by how long current stock will last at the last-4-week velocity. Phantom = stock ≥ 30 with zero sales in 4 weeks — dead money, transfer or clear immediately."
            />
            {(() => {
              const b = agingSummary.byBucket;
              const total = b.fresh + b.healthy + b.aging + b.stale + b.phantom || 1;
              const tile = (label, count, cls, sub, testId) => {
                const pct = ((count / total) * 100).toFixed(1);
                return (
                  <div className={`rounded-lg p-3 ${cls}`} data-testid={testId}>
                    <div className="text-[10.5px] uppercase tracking-wider opacity-80">{label}</div>
                    <div className="font-extrabold text-[22px] leading-tight mt-0.5">{fmtNum(count)}</div>
                    <div className="text-[10.5px] opacity-80 mt-0.5">{pct}% · {sub}</div>
                  </div>
                );
              };
              return (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                  {tile("Fresh",   b.fresh,   "bg-emerald-50 text-emerald-900 border border-emerald-200", "< 4w cover",      "aging-bucket-fresh")}
                  {tile("Healthy", b.healthy, "bg-green-50 text-green-900 border border-green-200",       "4–8w cover",      "aging-bucket-healthy")}
                  {tile("Aging",   b.aging,   "bg-amber-50 text-amber-900 border border-amber-200",       "8–16w cover",     "aging-bucket-aging")}
                  {tile("Stale",   b.stale,   "bg-orange-50 text-orange-900 border border-orange-200",    "> 16w cover",     "aging-bucket-stale")}
                  {tile("Phantom", b.phantom, "bg-red-50 text-red-900 border border-red-200",             "≥30 stock · 0 sales/4w", "aging-bucket-phantom")}
                </div>
              );
            })()}
          </div>

          {phantomRows.length > 0 && (
            <div className="card-white p-5" data-testid="phantom-stock-card">
              <SectionTitle
                title={`👻 Phantom Stock · ${phantomRows.length} styles · ${fmtNum(agingSummary.phantomStockUnits)} units locked up`}
                subtitle="Styles carrying ≥ 30 units with zero sales in the last 4 weeks. These are dead money — move them out or clear them. Acting on this list pays for itself within a quarter."
                action={
                  <button
                    type="button"
                    className="text-[11px] text-brand hover:text-brand-deep underline decoration-dotted"
                    onClick={() => window.open('/ibt', '_self')}
                    data-testid="phantom-open-ibt"
                  >
                    IBT candidates →
                  </button>
                }
              />
              <SortableTable
                testId="phantom-stock-table"
                exportName={`phantom-stock_${exportSlug}.csv`}
                pageSize={25}
                mobileCards
                initialSort={{ key: "current_stock", dir: "desc" }}
                columns={[
                  { key: "style_name", label: "Style", align: "left", mobilePrimary: true, render: (r) => <span className="font-medium break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{r.style_name}</span> },
                  { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                  { key: "subcategory", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.subcategory || "—"}</span> },
                  { key: "current_stock", label: "Stock", numeric: true, render: (r) => <span className="pill-red">{fmtNum(r.current_stock)}</span> },
                  { key: "units_sold_28d", label: "Sold (28d)", numeric: true, render: (r) => <span className="text-muted num">{fmtNum(r.units_sold_28d)}</span> },
                  {
                    key: "_action", label: "Action", align: "left", sortable: false,
                    render: (r) => {
                      const key = `phantom::${r.style_name}`;
                      return (
                        <RecommendationActionPill
                          itemKey={key}
                          state={dqByKey.get(key)}
                          onChange={(status, opts) => setDqState(key, status, opts)}
                          label="phantom"
                        />
                      );
                    },
                    csv: (r) => dqByKey.get(`phantom::${r.style_name}`)?.status || "pending",
                  },
                ]}
                rows={phantomRows}
              />
            </div>
          )}

          <div className="card-white p-5" data-testid="weeks-of-cover">
            <SectionTitle
              title={`Weeks of Cover · ${filteredWeeksOfCover.length} styles`}
              subtitle="Weeks of stock cover = current stock ÷ average weekly velocity (last 4 weeks). Red <2w = urgent replenishment · Amber 2–4w = watch · Green >4w = safe. Act on reds before the next shipment cycle."
            />
            <SortableTable
              testId="woc"
              exportName={`weeks-of-cover_${exportSlug}.csv`}
              pageSize={25}
              mobileCards
              initialSort={{ key: "weeks_of_cover", dir: "asc" }}
              columns={[
                { key: "style_name", label: "Style Name", align: "left", mobilePrimary: true },
                { key: "category", label: "Category", align: "left", render: (r) => <span className="pill-neutral">{categoryFor(r.subcategory) || "—"}</span>, csv: (r) => categoryFor(r.subcategory) },
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
                {
                  key: "_bucket", label: "Aging", align: "left",
                  sortValue: (r) => ({ fresh: 1, healthy: 2, aging: 3, stale: 4, phantom: 5 }[bucketFor(r)] || 0),
                  render: (r) => {
                    const b = bucketFor(r);
                    const map = {
                      fresh:   { label: "Fresh",   cls: "pill-green" },
                      healthy: { label: "Healthy", cls: "pill-green" },
                      aging:   { label: "Aging",   cls: "pill-amber" },
                      stale:   { label: "Stale",   cls: "pill-red"   },
                      phantom: { label: "Phantom", cls: "pill-red"   },
                    };
                    const m = map[b];
                    return <span className={m.cls}>{m.label}</span>;
                  },
                  csv: (r) => bucketFor(r),
                },
              ]}
              rows={agingRows}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default Inventory;
