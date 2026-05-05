import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtDate } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import MultiSelect from "@/components/MultiSelect";
import { DownloadSimple, MagnifyingGlass, X } from "@phosphor-icons/react";

/**
 * SOR Report — catalog-wide style sell-through report.
 *
 * Master table: one row per style with the 19-column finance/buying-ops
 * layout. Each row expands to a Color × Size SKU breakdown (matches the
 * SOR L-10 drill-down pattern).
 *
 * Detail pane (right side): when a row is selected, shows a per-location
 * table with units sold (6m), SOH, and per-location SOR — so the user
 * can answer "where did this style sell, and where's it sitting now?"
 * in one view.
 */
const SORReport = () => {
  const { applied } = useFilters();
  const { countries, channels } = applied;
  const countryParam = countries?.length ? countries.map((c) => c.toLowerCase()).join(",") : undefined;
  const channelParam = channels?.length ? channels.join(",") : undefined;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [catSel, setCatSel] = useState([]);
  const [subcatSel, setSubcatSel] = useState([]);
  const [brandSel, setBrandSel] = useState([]);
  const [selectedStyle, setSelectedStyle] = useState(null);

  // Per-style SKU breakdown cache (for row expand). Keyed by style_name.
  const [skuCache, setSkuCache] = useState({});
  const [skuLoading, setSkuLoading] = useState({});

  // Per-style location breakdown cache (for the detail pane).
  const [locCache, setLocCache] = useState({});
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = {};
    if (countryParam) params.country = countryParam;
    if (channelParam) params.channel = channelParam;
    api.get("/analytics/sor-all-styles", { params })
      .then((r) => { if (!cancelled) setRows(Array.isArray(r.data) ? r.data : []); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.detail || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [countryParam, channelParam]);

  // Drop the per-style caches when the country/channel filters change so
  // we don't show a Kenya-scoped breakdown for an Online-scoped table.
  useEffect(() => {
    setSkuCache({});
    setLocCache({});
    setSelectedStyle(null);
  }, [countryParam, channelParam]);

  const categories = useMemo(() => {
    const s = new Set(rows.map((r) => r.category).filter(Boolean));
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [rows]);
  const subcategories = useMemo(() => {
    const s = new Set(rows.map((r) => r.subcategory).filter(Boolean));
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [rows]);
  const brands = useMemo(() => {
    const s = new Set(rows.map((r) => r.brand).filter(Boolean));
    return Array.from(s).sort().map((v) => ({ value: v, label: v }));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (catSel.length && !catSel.includes(r.category)) return false;
      if (subcatSel.length && !subcatSel.includes(r.subcategory)) return false;
      if (brandSel.length && !brandSel.includes(r.brand)) return false;
      if (search) {
        const hay = (
          (r.style_name || "") + " " + (r.style_number || "") + " " + (r.collection || "")
        ).toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [rows, search, catSel, subcatSel, brandSel]);

  const stats = useMemo(() => {
    const totalSales = filtered.reduce((s, r) => s + (r.sales_6m || 0), 0);
    const totalUnits = filtered.reduce((s, r) => s + (r.units_6m || 0), 0);
    const totalSOH = filtered.reduce((s, r) => s + (r.soh_total || 0), 0);
    const denom = filtered.reduce((s, r) => s + ((r.units_6m || 0) + (r.soh_total || 0)), 0);
    const wSor = denom > 0 ? totalUnits / denom * 100 : 0;
    return { totalSales, totalUnits, totalSOH, wSor, n: filtered.length };
  }, [filtered]);

  // Lazy-load SKU breakdown when a row expands. The endpoint may
  // return 202 `{computing: true}` for cold styles whose /orders scan
  // exceeds the 60s ingress timeout; we poll every 15s in that case.
  const loadSku = (style) => {
    if (!style || skuCache[style] || skuLoading[style]) return;
    setSkuLoading((s) => ({ ...s, [style]: true }));
    const tick = (attempt = 0) => {
      api.get("/analytics/style-sku-breakdown", {
        params: { style_name: style, country: countryParam, channel: channelParam },
      })
        .then((r) => {
          if (r.data?.computing && attempt < 8) {
            setTimeout(() => tick(attempt + 1), (r.data.retry_after || 15) * 1000);
          } else if (r.data?.computing) {
            setSkuCache((c) => ({ ...c, [style]: [] }));
            setSkuLoading((s) => ({ ...s, [style]: false }));
          } else {
            setSkuCache((c) => ({ ...c, [style]: r.data?.skus || [] }));
            setSkuLoading((s) => ({ ...s, [style]: false }));
          }
        })
        .catch(() => {
          setSkuCache((c) => ({ ...c, [style]: [] }));
          setSkuLoading((s) => ({ ...s, [style]: false }));
        });
    };
    tick();
  };

  // Lazy-load location breakdown when a style is selected. Same 202
  // poll pattern as SKU breakdown — both endpoints share the same
  // /orders scan on the backend so once one finishes the other warms
  // instantly.
  const loadLocations = (style) => {
    if (!style || locCache[style]) return;
    setLocLoading(true);
    setLocError(null);
    const tick = (attempt = 0) => {
      api.get("/analytics/style-location-breakdown", {
        params: { style_name: style, country: countryParam, channel: channelParam },
      })
        .then((r) => {
          if (r.data?.computing && attempt < 8) {
            setLocError(`Computing… (${attempt * 15}s elapsed; rare styles can take ~2 min)`);
            setTimeout(() => tick(attempt + 1), (r.data.retry_after || 15) * 1000);
          } else if (r.data?.computing) {
            setLocError("Still computing — try again in a minute. The result will be cached and instant once ready.");
            setLocLoading(false);
          } else {
            setLocCache((c) => ({ ...c, [style]: r.data?.locations || [] }));
            setLocError(null);
            setLocLoading(false);
          }
        })
        .catch((e) => {
          setLocError(e?.response?.data?.detail || e.message || "Could not load location breakdown");
          setLocLoading(false);
        });
    };
    tick();
  };

  // Note: auto-select on first render was removed — the cold /orders
  // fan-out for a randomly-picked first-row style is too slow and made
  // the SOR Report tab feel sluggish on open. Users now explicitly
  // click a row to populate the side pane.

  useEffect(() => {
    if (selectedStyle) loadLocations(selectedStyle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStyle]);

  const exportCsv = () => {
    const header = [
      "Style Name", "Category", "Sub Category", "Style Number",
      "Sales Last 6 Months", "Units Sold", "Units Last 6 Months",
      "Units Last 3 Weeks", "SOH", "SOH Warehouse", "% In WH",
      "ASP 6 Months", "Original Price", "Days Since Last Sale",
      "6 Months SOR", "Style Launch Date", "Weekly Average",
      "Weeks of Cover", "Style Age (Weeks)",
    ];
    const lines = [header];
    for (const r of filtered) {
      lines.push([
        r.style_name || "", r.category || "", r.subcategory || "", r.style_number || "",
        r.sales_6m ?? "", r.units_6m ?? "", r.units_6m ?? "", r.units_3w ?? "",
        r.soh_total ?? "", r.soh_wh ?? "", r.pct_in_wh ?? "",
        r.asp_6m ?? "", r.original_price ?? "", r.days_since_last_sale ?? "",
        r.sor_6m ?? "", r.launch_date || "", r.weekly_avg ?? "",
        r.woc ?? "", r.style_age_weeks ?? "",
      ]);
    }
    const csv = lines
      .map((row) => row.map((v) => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sor-report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4" data-testid="sor-report-tab">
      <div className="card-white p-4 sm:p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <SectionTitle>SOR Report — Catalog-wide</SectionTitle>
            <div className="text-[12px] text-muted mt-0.5">
              Every style with sales in the last 6 months. {stats.n.toLocaleString()} of {rows.length.toLocaleString()} styles after filters.
              Click any row to expand its Color × Size SKU breakdown, or select a style to see its per-location sales & stock on the right.
            </div>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!filtered.length}
            className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
            data-testid="sor-report-export-btn"
          >
            <DownloadSimple size={14} weight="bold" /> Export CSV
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Tile label="Styles" value={fmtNum(stats.n)} />
          <Tile label="Total Sales" value={fmtKES(stats.totalSales)} />
          <Tile label="Units Sold" value={fmtNum(stats.totalUnits)} />
          <Tile label="SOH" value={fmtNum(stats.totalSOH)} />
          <Tile label="Weighted SOR" value={`${stats.wSor.toFixed(1)}%`} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-3">
          <div className="md:col-span-3 relative">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-2.5 text-muted" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search style name, style number, collection…"
              className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-border bg-white text-[13px]"
              data-testid="sor-report-search"
            />
          </div>
          <div className="md:col-span-3">
            <MultiSelect options={categories} value={catSel} onChange={setCatSel} placeholder="All Categories" testId="sor-cat-filter" />
          </div>
          <div className="md:col-span-3">
            <MultiSelect options={subcategories} value={subcatSel} onChange={setSubcatSel} placeholder="All Subcategories" testId="sor-subcat-filter" />
          </div>
          <div className="md:col-span-3">
            <MultiSelect options={brands} value={brandSel} onChange={setBrandSel} placeholder="All Brands" testId="sor-brand-filter" />
          </div>
        </div>

        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} />
        ) : !filtered.length ? (
          <Empty>No styles match the current filters.</Empty>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Master table — 2 columns wide on xl */}
            <div className="xl:col-span-2 min-w-0">
              <SortableTable
                testId="sor-report-table"
                onRowClick={(row) => {
                  // Fire SKU first — its server handler also warms the
                  // location-breakdown cache from the same scan, so the
                  // location pane fetch below hits a warm cache after
                  // ~1ms instead of running a second cold scan.
                  loadSku(row.style_name);
                  setSelectedStyle(row.style_name);
                }}
                rowClassName={(row) => row.style_name === selectedStyle ? "bg-amber-50/60" : ""}
                columns={[
                  { key: "style_name", label: "Style Name", sortable: true,
                    render: (r) => <span className="font-semibold">{r.style_name}</span> },
                  { key: "category", label: "Category", sortable: true,
                    render: (r) => r.category || "—" },
                  { key: "subcategory", label: "Sub Category", sortable: true,
                    render: (r) => r.subcategory || "—" },
                  { key: "style_number", label: "Style #", sortable: true,
                    render: (r) => <span className="font-mono text-[11px]">{r.style_number || "—"}</span> },
                  { key: "sales_6m", label: "Sales 6M", sortable: true, align: "right",
                    render: (r) => fmtKES(r.sales_6m) },
                  { key: "units_6m", label: "Units 6M", sortable: true, align: "right",
                    render: (r) => fmtNum(r.units_6m) },
                  { key: "units_3w", label: "Units 3W", sortable: true, align: "right",
                    render: (r) => fmtNum(r.units_3w) },
                  { key: "soh_total", label: "SOH", sortable: true, align: "right",
                    render: (r) => fmtNum(r.soh_total) },
                  { key: "soh_wh", label: "SOH WH", sortable: true, align: "right",
                    render: (r) => fmtNum(r.soh_wh) },
                  { key: "pct_in_wh", label: "% In WH", sortable: true, align: "right",
                    render: (r) => `${r.pct_in_wh.toFixed(1)}%` },
                  { key: "asp_6m", label: "ASP 6M", sortable: true, align: "right",
                    render: (r) => fmtKES(r.asp_6m) },
                  { key: "original_price", label: "Orig Price", sortable: true, align: "right",
                    render: (r) => fmtKES(r.original_price) },
                  { key: "days_since_last_sale", label: "Days Since Sale", sortable: true, align: "right",
                    render: (r) => {
                      const d = r.days_since_last_sale;
                      const cls = d > 60 ? "text-rose-600 font-bold" : d > 30 ? "text-amber-600" : "";
                      return <span className={cls}>{d}d</span>;
                    } },
                  { key: "sor_6m", label: "6M SOR", sortable: true, align: "right",
                    render: (r) => {
                      const v = r.sor_6m || 0;
                      const cls = v >= 70 ? "text-emerald-600 font-bold" : v >= 50 ? "text-emerald-500" : v < 25 ? "text-rose-600" : "";
                      return <span className={cls}>{v.toFixed(1)}%</span>;
                    } },
                  { key: "launch_date", label: "Launch", sortable: true,
                    render: (r) => r.launch_date ? fmtDate(r.launch_date) : "—" },
                  { key: "weekly_avg", label: "Weekly Avg", sortable: true, align: "right",
                    render: (r) => (r.weekly_avg ?? 0).toFixed(1) },
                  { key: "woc", label: "WoC", sortable: true, align: "right",
                    render: (r) => {
                      if (r.woc == null) return "—";
                      const cls = r.woc < 12 ? "text-rose-600 font-bold" : r.woc < 26 ? "" : "text-amber-600";
                      return <span className={cls}>{r.woc.toFixed(1)}w</span>;
                    } },
                  { key: "style_age_weeks", label: "Age (W)", sortable: true, align: "right",
                    render: (r) => `${r.style_age_weeks.toFixed(1)}w` },
                ]}
                rows={filtered}
                defaultSort={{ key: "sales_6m", dir: "desc" }}
                pageSize={50}
                stickyFirstCol
                renderExpanded={(row) => (
                  <SkuBreakdown
                    rows={skuCache[row.style_name]}
                    loading={skuLoading[row.style_name]}
                  />
                )}
              />
            </div>

            {/* Location detail pane */}
            <div className="xl:col-span-1 min-w-0">
              <LocationPane
                style={selectedStyle}
                rows={locCache[selectedStyle]}
                loading={locLoading}
                error={locError}
                onClear={() => setSelectedStyle(null)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Tile = ({ label, value }) => (
  <div className="rounded-xl border border-border p-3">
    <div className="eyebrow">{label}</div>
    <div className="font-extrabold text-[16px] num mt-0.5">{value}</div>
  </div>
);

// ---- SKU breakdown (Color × Size) ----
const SkuBreakdown = ({ rows, loading }) => {
  if (loading && (!rows || rows.length === 0)) {
    return <div className="text-[12px] text-muted py-2">Loading SKU breakdown… (~30s on cold cache)</div>;
  }
  if (!rows || !rows.length) {
    return <div className="text-[12px] text-muted py-2">No SKU detail available for this style.</div>;
  }
  const totalUnits = rows.reduce((s, r) => s + (r.units_6m || 0), 0);
  return (
    <div className="px-2 py-1" data-testid="sor-sku-breakdown">
      <div className="text-[11px] font-bold uppercase text-muted mb-2">
        Color × Size — {rows.length} variant{rows.length === 1 ? "" : "s"}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="py-1 pr-3">Color</th>
              <th className="py-1 pr-3">Size</th>
              <th className="py-1 pr-3 font-mono">SKU</th>
              <th className="py-1 pr-3 text-right">Units 6M</th>
              <th className="py-1 pr-3 text-right">% of Style</th>
              <th className="py-1 pr-3 text-right">Units 3W</th>
              <th className="py-1 pr-3 text-right">SOH</th>
              <th className="py-1 pr-3 text-right">SOH WH</th>
              <th className="py-1 pr-0 text-right">% In WH</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.sku}-${i}`} className="border-b border-border/40 last:border-0">
                <td className="py-1 pr-3">{r.color || "—"}</td>
                <td className="py-1 pr-3">{r.size || "—"}</td>
                <td className="py-1 pr-3 font-mono text-[11px]">{r.sku || "—"}</td>
                <td className="py-1 pr-3 text-right num font-semibold">{fmtNum(r.units_6m)}</td>
                <td className="py-1 pr-3 text-right num text-muted">
                  {totalUnits ? ((r.units_6m / totalUnits) * 100).toFixed(1) : "0.0"}%
                </td>
                <td className="py-1 pr-3 text-right num">{fmtNum(r.units_3w)}</td>
                <td className="py-1 pr-3 text-right num">{fmtNum(r.soh_total)}</td>
                <td className="py-1 pr-3 text-right num">{fmtNum(r.soh_wh)}</td>
                <td className="py-1 pr-0 text-right num">{(r.pct_in_wh || 0).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---- Location pane (right side) ----
const LocationPane = ({ style, rows, loading, error, onClear }) => {
  if (!style) {
    return (
      <div className="rounded-xl border border-border p-4 text-[12px] text-muted text-center" data-testid="sor-location-pane-empty">
        Click any style on the left to see where it sold and where it's stocked.
      </div>
    );
  }
  const totals = (rows || []).reduce(
    (a, r) => ({
      units_6m: a.units_6m + (r.units_6m || 0),
      sales_6m: a.sales_6m + (r.sales_6m || 0),
      soh_total: a.soh_total + (r.soh_total || 0),
    }),
    { units_6m: 0, sales_6m: 0, soh_total: 0 },
  );
  return (
    <div className="rounded-xl border border-border bg-white" data-testid="sor-location-pane">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="eyebrow">Where did it sell?</div>
          <div className="font-bold text-[14px] truncate" title={style}>{style}</div>
          {(rows && rows.length > 0) && (
            <div className="text-[11px] text-muted mt-1">
              {rows.length} location{rows.length === 1 ? "" : "s"} ·{" "}
              {fmtNum(totals.units_6m)} units · {fmtKES(totals.sales_6m)} · {fmtNum(totals.soh_total)} SOH
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-muted hover:text-foreground p-1"
          aria-label="Clear selection"
          data-testid="sor-location-pane-clear"
        >
          <X size={14} weight="bold" />
        </button>
      </div>
      <div className="px-2 py-2 max-h-[640px] overflow-y-auto">
        {loading ? (
          <div className="text-[12px] text-muted px-2 py-3">Loading… (~30s on cold cache)</div>
        ) : error ? (
          <div className="text-[12px] text-rose-600 px-2 py-3">{error}</div>
        ) : (!rows || rows.length === 0) ? (
          <div className="text-[12px] text-muted px-2 py-3">No location data for this style.</div>
        ) : (
          <table className="w-full text-[12px]" data-testid="sor-location-table">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="py-1 pr-2">Location</th>
                <th className="py-1 pr-2 text-right">Units 6M</th>
                <th className="py-1 pr-2 text-right">SOH</th>
                <th className="py-1 pr-0 text-right">SOR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sor = r.sor_6m || 0;
                const sorCls = sor >= 70 ? "text-emerald-600 font-bold"
                  : sor >= 50 ? "text-emerald-500"
                  : sor < 25 ? "text-rose-600"
                  : "";
                return (
                  <tr key={r.location} className="border-b border-border/40 last:border-0">
                    <td className="py-1.5 pr-2 truncate max-w-[160px]" title={r.location}>{r.location}</td>
                    <td className="py-1.5 pr-2 text-right num">{fmtNum(r.units_6m)}</td>
                    <td className="py-1.5 pr-2 text-right num">{fmtNum(r.soh_total)}</td>
                    <td className={`py-1.5 pr-0 text-right num ${sorCls}`}>{sor.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default SORReport;
