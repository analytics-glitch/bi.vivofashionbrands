import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtNum, COUNTRY_FLAGS } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import MultiSelect from "@/components/MultiSelect";
import SortableTable from "@/components/SortableTable";
import { categoryFor, isMerchandise } from "@/lib/productCategory";
import { DownloadSimple, MagnifyingGlass, Warning } from "@phosphor-icons/react";

const PAGE_SIZE = 50;

const Exports = () => {
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
    <div className="space-y-5" data-testid="exports-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Dashboard · Exports</div>
          <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">
            Inventory Export
          </h1>
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

export default Exports;
