import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtNum, fmtKES, fmtDate, COUNTRY_FLAGS } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import MultiSelect from "@/components/MultiSelect";
import SortableTable from "@/components/SortableTable";
import { categoryFor, isMerchandise } from "@/lib/productCategory";
import { DownloadSimple, MagnifyingGlass, Warning } from "@phosphor-icons/react";

const PAGE_SIZE = 50;

const InventoryExport = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { countries, channels, dataVersion } = applied;

  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [locSel, setLocSel] = useState([]);
  const [countrySel, setCountrySel] = useState([]);
  const [brandSel, setBrandSel] = useState([]);
  const [catSel, setCatSel] = useState([]);
  const [subcatSel, setSubcatSel] = useState([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [includeNonMerch, setIncludeNonMerch] = useState(false);
  const [page, setPage] = useState(0);

  // Debounce search 120ms
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim().toLowerCase());
      setPage(0);
    }, 120);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const countryCsv = countries.length ? countries.map((c) => c.toLowerCase()).join(",") : undefined;
    const locationsCsv = channels.length ? channels.join(",") : undefined;
    const params = { country: countryCsv, locations: locationsCsv };
    const refreshParams = dataVersion > 0 ? { ...params, refresh: true } : params;
    api
      .get("/inventory", { params: refreshParams })
      .then((r) => {
        if (cancelled) return;
        setRaw(r.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  // Attach computed category AND a pre-computed lowercase search blob to
  // every row so search filtering costs ONE includes() per row per
  // keystroke (instead of concat+lowercase+3x-includes on 30k rows).
  const enriched = useMemo(
    () => raw.map((r) => ({
      ...r,
      category: categoryFor(r.product_type),
      _search: (
        (r.sku || "") + "\t" +
        (r.product_name || "") + "\t" +
        (r.style_name || "")
      ).toLowerCase(),
    })),
    [raw]
  );

  // Dropdown options — derived from the full (merchandise-by-default) dataset
  // so the user can still see Accessories/Sale if they toggle the opt-in.
  const scope = useMemo(
    () => (includeNonMerch ? enriched : enriched.filter((r) => isMerchandise(r.product_type))),
    [enriched, includeNonMerch]
  );

  const locations = useMemo(
    () => [...new Set(scope.map((r) => r.location_name).filter(Boolean))].sort(),
    [scope]
  );
  const countryList = useMemo(
    () => [...new Set(scope.map((r) => r.country).filter(Boolean))].sort(),
    [scope]
  );
  const brandList = useMemo(
    () => [...new Set(scope.map((r) => r.brand).filter(Boolean))].sort(),
    [scope]
  );
  const categoryList = useMemo(
    () => [...new Set(scope.map((r) => r.category).filter(Boolean))].sort(),
    [scope]
  );
  const subcatList = useMemo(
    () => [...new Set(scope.map((r) => r.product_type).filter(Boolean))].sort(),
    [scope]
  );

  const filtered = useMemo(() => {
    const q = search;
    const locSet = locSel.length ? new Set(locSel) : null;
    const countrySet = countrySel.length ? new Set(countrySel) : null;
    const brandSet = brandSel.length ? new Set(brandSel) : null;
    const catSet = catSel.length ? new Set(catSel) : null;
    const subcatSet = subcatSel.length ? new Set(subcatSel) : null;
    return scope.filter((r) => {
      if (locSet && !locSet.has(r.location_name)) return false;
      if (countrySet && !countrySet.has(r.country)) return false;
      if (brandSet && !brandSet.has(r.brand)) return false;
      if (catSet && !catSet.has(r.category)) return false;
      if (subcatSet && !subcatSet.has(r.product_type)) return false;
      if (q && !r._search.includes(q)) return false;
      return true;
    });
  }, [scope, locSel, countrySel, brandSel, catSel, subcatSel, search]);

  // Default sort: Location then Available descending.
  const sortedDefault = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          (a.location_name || "").localeCompare(b.location_name || "") ||
          (b.available || 0) - (a.available || 0)
      ),
    [filtered]
  );

  const totalUnits = useMemo(
    () => filtered.reduce((s, r) => s + (r.available || 0), 0),
    [filtered]
  );

  const pageCount = Math.max(1, Math.ceil(sortedDefault.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => sortedDefault.slice(pageSafe * PAGE_SIZE, (pageSafe + 1) * PAGE_SIZE),
    [sortedDefault, pageSafe]
  );

  const exportCsv = () => {
    const cols = [
      ["location_name", "POS Location"],
      ["country", "Country"],
      ["sku", "SKU"],
      ["barcode", "Barcode"],
      ["product_name", "Product Name"],
      ["style_name", "Style Name"],
      ["size", "Size"],
      ["color_print", "Color"],
      ["collection", "Collection"],
      ["brand", "Brand"],
      ["product_type", "Subcategory"],
      ["category", "Category"],
      ["available", "Available"],
    ];
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map(([, h]) => h).join(",")];
    for (const r of sortedDefault) {
      lines.push(cols.map(([k]) => esc(r[k])).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearAll = () => {
    setLocSel([]); setCountrySel([]); setBrandSel([]);
    setCatSel([]); setSubcatSel([]); setSearchInput(""); setSearch("");
    setPage(0);
  };

  const anyFilter =
    locSel.length || countrySel.length || brandSel.length ||
    catSel.length || subcatSel.length || search;

  return (
    <div className="space-y-5" data-testid="exports-page-inventory">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-extrabold text-[18px] sm:text-[20px] tracking-tight">
            Inventory Export
          </h2>
          <p className="text-muted text-[13px] mt-0.5">
            Detailed SKU-level export of every available unit across all POS
            locations. Filter, search, sort, paginate and export to CSV.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!sortedDefault.length}
          data-testid="exports-csv-btn"
          className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
        >
          <DownloadSimple size={14} weight="bold" />
          Download CSV ({fmtNum(sortedDefault.length)} rows)
        </button>
      </div>

      {loading && <Loading label="Loading inventory…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          <div className="card-white p-4 space-y-3" data-testid="exports-filters">
            <div className="flex items-center gap-2 input-pill">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search SKU, product name or style name…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                data-testid="exports-search"
                className="bg-transparent outline-none text-[13px] w-full"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  data-testid="exports-search-clear"
                  className="text-muted hover:text-foreground text-[12px] px-1"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <div className="eyebrow mb-1">POS Location</div>
                <MultiSelect
                  testId="exports-filter-location"
                  options={locations.map((l) => ({ value: l, label: l }))}
                  value={locSel}
                  onChange={(v) => { setLocSel(v); setPage(0); }}
                  placeholder="All locations"
                  width={220}
                />
              </div>
              <div>
                <div className="eyebrow mb-1">Country</div>
                <MultiSelect
                  testId="exports-filter-country"
                  options={countryList.map((c) => ({ value: c, label: `${COUNTRY_FLAGS[c.charAt(0).toUpperCase() + c.slice(1)] || "🌍"} ${c}` }))}
                  value={countrySel}
                  onChange={(v) => { setCountrySel(v); setPage(0); }}
                  placeholder="All countries"
                  width={180}
                />
              </div>
              <div>
                <div className="eyebrow mb-1">Brand</div>
                <MultiSelect
                  testId="exports-filter-brand"
                  options={brandList.map((b) => ({ value: b, label: b }))}
                  value={brandSel}
                  onChange={(v) => { setBrandSel(v); setPage(0); }}
                  placeholder="All brands"
                  width={180}
                />
              </div>
              <div>
                <div className="eyebrow mb-1">Category</div>
                <MultiSelect
                  testId="exports-filter-category"
                  options={categoryList.map((c) => ({ value: c, label: c }))}
                  value={catSel}
                  onChange={(v) => { setCatSel(v); setPage(0); }}
                  placeholder="All categories"
                  width={180}
                />
              </div>
              <div>
                <div className="eyebrow mb-1">Subcategory</div>
                <MultiSelect
                  testId="exports-filter-subcategory"
                  options={subcatList.map((s) => ({ value: s, label: s }))}
                  value={subcatSel}
                  onChange={(v) => { setSubcatSel(v); setPage(0); }}
                  placeholder="All subcategories"
                  width={220}
                />
              </div>
              <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer ml-auto">
                <input
                  type="checkbox"
                  checked={includeNonMerch}
                  onChange={(e) => { setIncludeNonMerch(e.target.checked); setPage(0); }}
                  data-testid="exports-include-nonmerch"
                />
                <Warning size={12} weight="bold" className="text-amber" />
                Include Accessories / Sale items
              </label>
              {anyFilter ? (
                <button
                  type="button"
                  onClick={clearAll}
                  data-testid="exports-clear-all"
                  className="px-3 py-1.5 rounded-lg text-[12px] text-muted hover:bg-panel"
                >
                  Clear all
                </button>
              ) : null}
            </div>
          </div>

          <div className="card-white p-5" data-testid="exports-table-card">
            <SectionTitle
              title={`${fmtNum(sortedDefault.length)} SKU rows · ${fmtNum(totalUnits)} units total`}
              subtitle={`Page ${pageSafe + 1} of ${pageCount} · showing ${fmtNum(pageRows.length)} rows · default sort: Location → Available desc`}
            />
            {sortedDefault.length === 0 ? (
              <Empty label="No SKUs match the current filters." />
            ) : (
              <>
                <SortableTable
                  testId="exports-table"
                  initialSort={{ key: "location_name", dir: "asc" }}
                  columns={[
                    { key: "location_name", label: "POS Location", align: "left", render: (r) => <span className="font-medium">{r.location_name || "—"}</span>, csv: (r) => r.location_name },
                    { key: "country", label: "Country", align: "left", render: (r) => <span className="capitalize">{r.country || "—"}</span>, csv: (r) => r.country },
                    { key: "sku", label: "SKU", align: "left", render: (r) => <span className="font-mono text-[11px] text-muted">{r.sku || "—"}</span>, csv: (r) => r.sku },
                    { key: "barcode", label: "Barcode", align: "left", render: (r) => <span className="font-mono text-[11px] text-muted">{r.barcode || "—"}</span>, csv: (r) => r.barcode },
                    { key: "product_name", label: "Product Name", align: "left", render: (r) => <span className="max-w-[260px] truncate inline-block" title={r.product_name}>{r.product_name || "—"}</span>, csv: (r) => r.product_name },
                    { key: "style_name", label: "Style Name", align: "left", render: (r) => <span className="max-w-[220px] truncate inline-block" title={r.style_name}>{r.style_name || "—"}</span>, csv: (r) => r.style_name },
                    { key: "size", label: "Size", align: "left", render: (r) => r.size || "—" },
                    { key: "color_print", label: "Color", align: "left", render: (r) => r.color_print || "—", csv: (r) => r.color_print },
                    { key: "collection", label: "Collection", align: "left", render: (r) => <span className="text-muted">{r.collection || "—"}</span>, csv: (r) => r.collection },
                    { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                    { key: "product_type", label: "Subcategory", align: "left", render: (r) => r.product_type || "—", csv: (r) => r.product_type },
                    { key: "category", label: "Category", align: "left", render: (r) => <span className="pill-neutral">{r.category || "—"}</span>, csv: (r) => r.category },
                    {
                      key: "available", label: "Available", numeric: true,
                      render: (r) => <span className={`font-semibold ${(r.available || 0) <= 2 ? "text-danger" : ""}`}>{fmtNum(r.available)}</span>,
                      csv: (r) => r.available,
                    },
                  ]}
                  rows={pageRows}
                />
                <div className="flex items-center justify-between mt-3 text-[12px] gap-3 flex-wrap">
                  <div className="text-muted">
                    Total across all filtered rows:{" "}
                    <span className="font-bold text-foreground">{fmtNum(totalUnits)}</span> units
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={pageSafe === 0}
                      data-testid="exports-page-prev"
                      className="px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium disabled:opacity-40 hover:bg-panel"
                    >
                      ← Previous
                    </button>
                    <span className="text-muted">
                      Page <span className="font-semibold text-foreground">{pageSafe + 1}</span> of {pageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      disabled={pageSafe >= pageCount - 1}
                      data-testid="exports-page-next"
                      className="px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium disabled:opacity-40 hover:bg-panel"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// --- Sales Export (style-level sales + SKU-level stock context) ---
const SalesExport = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [brandSel, setBrandSel] = useState([]);
  const [subcatSel, setSubcatSel] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 120);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const country = countries.length ? countries.join(",") : undefined;
    const channel = channels.length ? channels.join(",") : undefined;
    api
      .get("/sor", {
        params: { date_from: dateFrom, date_to: dateTo, country, channel, limit: 10000 },
      })
      .then((r) => {
        if (cancelled) return;
        const enriched = (r.data || []).map((row) => ({
          ...row,
          category: categoryFor(row.product_type),
          avg_price: row.units_sold ? (row.total_sales || 0) / row.units_sold : 0,
          _search: ((row.style_name || "") + "\t" + (row.collection || "") + "\t" + (row.brand || "")).toLowerCase(),
        }));
        setRows(enriched);
        touchLastUpdated();
      })
      .catch((e) => {
        if (cancelled) return;
        const detail = e?.response?.data?.detail;
        const msg = typeof detail === "string" ? detail : (e.message || "Request failed");
        setError(msg);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  const brandList = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort(), [rows]);
  const subcatList = useMemo(() => [...new Set(rows.map((r) => r.product_type).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    const brandSet = brandSel.length ? new Set(brandSel) : null;
    const subcatSet = subcatSel.length ? new Set(subcatSel) : null;
    return rows.filter((r) => {
      if (brandSet && !brandSet.has(r.brand)) return false;
      if (subcatSet && !subcatSet.has(r.product_type)) return false;
      if (search && !r._search.includes(search)) return false;
      return true;
    });
  }, [rows, brandSel, subcatSel, search]);

  const totals = useMemo(() => {
    let units = 0, sales = 0, stock = 0;
    for (const r of filtered) {
      units += r.units_sold || 0;
      sales += r.total_sales || 0;
      stock += r.current_stock || 0;
    }
    return { units, sales, stock, styles: filtered.length };
  }, [filtered]);

  const exportCsv = () => {
    const cols = [
      ["style_name", "Style Name"],
      ["collection", "Collection"],
      ["brand", "Brand"],
      ["category", "Category"],
      ["product_type", "Subcategory"],
      ["units_sold", "Units Sold"],
      ["total_sales", "Total Sales (KES)"],
      ["avg_price", "Avg Price (KES)"],
      ["current_stock", "Current Stock"],
      ["sor_percent", "Sell-out Rate %"],
    ];
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const metaLines = [
      `# Vivo BI · Sales Export`,
      `# Date range: ${dateFrom} to ${dateTo}`,
      `# Country: ${countries.length ? countries.join("; ") : "All"}`,
      `# POS: ${channels.length ? channels.join("; ") : "All"}`,
      `# Generated: ${new Date().toISOString()}`,
      "",
    ];
    const lines = [...metaLines, cols.map(([, h]) => h).join(",")];
    for (const r of filtered) {
      lines.push(cols.map(([k]) => esc(r[k])).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-export-${dateFrom}_${dateTo}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5" data-testid="exports-page-sales">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-extrabold text-[18px] sm:text-[20px] tracking-tight">
            Sales Export
          </h2>
          <p className="text-muted text-[13px] mt-0.5">
            Style-level sales for the period · {fmtDate(dateFrom)} → {fmtDate(dateTo)} · filtered by
            the global Country + POS filters. Download CSV below.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!filtered.length}
          data-testid="sales-export-csv-btn"
          className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
        >
          <DownloadSimple size={14} weight="bold" />
          Download CSV ({fmtNum(filtered.length)} styles)
        </button>
      </div>

      <div className="rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-[12px] text-amber-900" data-testid="sales-export-limitations">
        <span className="font-semibold">Data availability note:</span> the upstream Vivo BI API
        exposes sales aggregated at the <em>style</em> level. Order-level fields
        (Order&nbsp;ID, Customer reference, Payment method, Order status, per-order Discount/Tax,
        Colour, Size) are not yet published — we'll enable the richer export the moment the
        data team ships an <code>/orders</code> endpoint. For per-style SKU variant stock, use
        the Inventory tab or the Re-Order drill-down.
      </div>

      {loading && <Loading label="Loading style sales…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          <div className="card-white p-4 space-y-3" data-testid="sales-export-filters">
            <div className="flex items-center gap-2 input-pill">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search style, collection or brand…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                data-testid="sales-export-search"
                className="bg-transparent outline-none text-[13px] w-full"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="text-muted hover:text-foreground text-[12px] px-1"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <div>
                <div className="eyebrow mb-1">Brand</div>
                <MultiSelect
                  testId="sales-export-filter-brand"
                  options={brandList.map((b) => ({ value: b, label: b }))}
                  value={brandSel}
                  onChange={setBrandSel}
                  placeholder="All brands"
                  width={180}
                />
              </div>
              <div>
                <div className="eyebrow mb-1">Subcategory</div>
                <MultiSelect
                  testId="sales-export-filter-subcat"
                  options={subcatList.map((s) => ({ value: s, label: s }))}
                  value={subcatSel}
                  onChange={setSubcatSel}
                  placeholder="All subcategories"
                  width={220}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card-white p-4"><div className="eyebrow">Styles</div><div className="font-bold text-[18px] num mt-0.5">{fmtNum(totals.styles)}</div></div>
            <div className="card-white p-4"><div className="eyebrow">Units Sold</div><div className="font-bold text-[18px] num mt-0.5">{fmtNum(totals.units)}</div></div>
            <div className="card-white p-4"><div className="eyebrow">Total Sales</div><div className="font-bold text-[18px] num mt-0.5 text-brand">{fmtKES(totals.sales)}</div></div>
            <div className="card-white p-4"><div className="eyebrow">Current Stock</div><div className="font-bold text-[18px] num mt-0.5">{fmtNum(totals.stock)}</div></div>
          </div>

          <div className="card-white p-5" data-testid="sales-export-table-card">
            <SectionTitle
              title={`${fmtNum(filtered.length)} styles`}
              subtitle="Click any column to sort. Pagination below the table."
            />
            {filtered.length === 0 ? (
              <Empty label="No styles match the current filters." />
            ) : (
              <SortableTable
                testId="sales-export-table"
                exportName={`sales-export-${dateFrom}_${dateTo}.csv`}
                initialSort={{ key: "total_sales", dir: "desc" }}
                pageSize={50}
                columns={[
                  { key: "style_name", label: "Style Name", align: "left", render: (r) => <span className="font-medium break-words max-w-[260px] inline-block">{r.style_name || "—"}</span> },
                  { key: "collection", label: "Collection", align: "left", render: (r) => <span className="text-muted">{r.collection || "—"}</span>, csv: (r) => r.collection },
                  { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                  { key: "category", label: "Category", align: "left", render: (r) => <span className="pill-neutral">{r.category || "—"}</span>, csv: (r) => r.category },
                  { key: "product_type", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.product_type || "—"}</span> },
                  { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                  { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                  { key: "avg_price", label: "Avg Price", numeric: true, render: (r) => fmtKES(r.avg_price), csv: (r) => r.avg_price },
                  { key: "current_stock", label: "Stock", numeric: true, render: (r) => fmtNum(r.current_stock), csv: (r) => r.current_stock },
                  { key: "sor_percent", label: "Sell-out %", numeric: true, render: (r) => `${(r.sor_percent ?? 0).toFixed(1)}%`, csv: (r) => r.sor_percent },
                ]}
                rows={filtered}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

// Parent wrapper with Sales / Inventory tab switcher.
const Exports = () => {
  const [tab, setTab] = useState("sales");
  return (
    <div className="space-y-5" data-testid="exports-page">
      <div>
        <div className="eyebrow">Dashboard · Exports</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">
          Exports (Sales, Inventory)
        </h1>
      </div>
      <div className="inline-flex rounded-xl bg-panel p-1 border border-border" data-testid="exports-tabs">
        <button
          type="button"
          onClick={() => setTab("sales")}
          data-testid="exports-tab-sales"
          className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
            tab === "sales" ? "bg-brand text-white" : "text-foreground/70 hover:bg-white"
          }`}
        >
          Sales
        </button>
        <button
          type="button"
          onClick={() => setTab("inventory")}
          data-testid="exports-tab-inventory"
          className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
            tab === "inventory" ? "bg-brand text-white" : "text-foreground/70 hover:bg-white"
          }`}
        >
          Inventory
        </button>
      </div>
      {tab === "sales" ? <SalesExport /> : <InventoryExport />}
    </div>
  );
};

export default Exports;
