import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtDate } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import MultiSelect from "@/components/MultiSelect";
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react";

/**
 * SOR Report — catalog-wide style sell-through report. One row per
 * style with the 19 columns finance + buying ops use (matches the
 * legacy PowerBI SOR report layout):
 *   Style Name, Category, Sub Category, Style Number,
 *   Sales Last 6 Months, Units Sold, Units Last 6 Months,
 *   Units Last 3 Weeks, SOH, SOH Warehouse, % In WH,
 *   ASP 6 Months, Original Price, Days Since Last Sale,
 *   6 Months SOR, Style Launch Date, Weekly Average,
 *   Weeks of Cover, Style Age (Weeks)
 *
 * Data source: /api/analytics/sor-all-styles (catalog-wide; 1.7K rows;
 * cached server-side for 30 minutes). Honours the country / channel /
 * brand filters from the global filter bar.
 */
const SORReport = () => {
  const { applied } = useFilters();
  const { countries, channels } = applied;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Local filters for this tab.
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [catSel, setCatSel] = useState([]);
  const [subcatSel, setSubcatSel] = useState([]);
  const [brandSel, setBrandSel] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = {};
    if (countries?.length) params.country = countries.map((c) => c.toLowerCase()).join(",");
    if (channels?.length) params.channel = channels.join(",");
    api.get("/analytics/sor-all-styles", { params })
      .then((r) => { if (!cancelled) setRows(Array.isArray(r.data) ? r.data : []); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.detail || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [JSON.stringify(countries), JSON.stringify(channels)]); // eslint-disable-line

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

  // Summary KPIs.
  const stats = useMemo(() => {
    const totalSales = filtered.reduce((s, r) => s + (r.sales_6m || 0), 0);
    const totalUnits = filtered.reduce((s, r) => s + (r.units_6m || 0), 0);
    const totalSOH = filtered.reduce((s, r) => s + (r.soh_total || 0), 0);
    const wSor =
      filtered.reduce((s, r) => s + (r.units_6m || 0), 0) /
      Math.max(1, filtered.reduce((s, r) => s + ((r.units_6m || 0) + (r.soh_total || 0)), 0));
    return { totalSales, totalUnits, totalSOH, wSor: wSor * 100, n: filtered.length };
  }, [filtered]);

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
        r.style_name || "",
        r.category || "",
        r.subcategory || "",
        r.style_number || "",
        r.sales_6m ?? "",
        r.units_6m ?? "",
        r.units_6m ?? "",
        r.units_3w ?? "",
        r.soh_total ?? "",
        r.soh_wh ?? "",
        r.pct_in_wh ?? "",
        r.asp_6m ?? "",
        r.original_price ?? "",
        r.days_since_last_sale ?? "",
        r.sor_6m ?? "",
        r.launch_date || "",
        r.weekly_avg ?? "",
        r.woc ?? "",
        r.style_age_weeks ?? "",
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

        {/* Summary tiles */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Tile label="Styles" value={fmtNum(stats.n)} />
          <Tile label="Total Sales" value={fmtKES(stats.totalSales)} />
          <Tile label="Units Sold" value={fmtNum(stats.totalUnits)} />
          <Tile label="SOH" value={fmtNum(stats.totalSOH)} />
          <Tile label="Weighted SOR" value={`${stats.wSor.toFixed(1)}%`} />
        </div>

        {/* Filters */}
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
          <SortableTable
            testId="sor-report-table"
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
          />
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

export default SORReport;
