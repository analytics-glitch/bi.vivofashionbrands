import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import ProductThumbnail from "@/components/ProductThumbnail";
import { useThumbnails } from "@/lib/useThumbnails";
import { categoryFor } from "@/lib/productCategory";
import { Calendar, MagnifyingGlass, Palette, Ruler, X } from "@phosphor-icons/react";

/**
 * Reusable SOR table — powers both the L-10 (new styles) and the All-
 * Styles tabs. Provides:
 *   • a Style-Name search box (live, case-insensitive, multi-word AND)
 *   • toggle buttons to add `Color/Print` and/or `Size` columns. When ON,
 *     each style row splits into one row per SKU variant
 *     (color × size), lazy-loaded from /analytics/style-sku-breakdown
 *     and cached at the backend for 30 min.
 *
 * The base style-level columns and summary tiles are owned by the parent
 * (`SorNewStylesL10` / `SorAllStyles`) — this component only handles the
 * filter UI, the toggle UI, and the row expansion.
 */
const SorStylesTable = ({
  rows,                    // style-level rows (already enriched with category, etc.)
  testId,                  // base testId for the table
  exportName,              // CSV export filename
  initialSort = { key: "sor_6m", dir: "desc" },
  showLaunchDate = true,   // L-10 has it; All-Styles can hide
  pageSize = 25,
}) => {
  const [search, setSearch] = useState("");
  const [showColor, setShowColor] = useState(false);
  const [showSize, setShowSize] = useState(false);
  // SKU drill-down cache: style_name -> { skus: [...], loading, error }.
  const [skuMap, setSkuMap] = useState({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    const tokens = q.split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      const hay = `${r.style_name || ""} ${r.brand || ""} ${r.collection || ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [rows, search]);

  // When either toggle is on, fetch SKU breakdown for the first
  // `pageSize` visible rows that haven't been fetched yet. Uses the
  // BULK endpoint so 25 styles share a single 6-month /orders fan-out
  // instead of 25 independent calls (saves ~30s × 25 cold).
  useEffect(() => {
    if (!showColor && !showSize) return;
    const visible = filtered.slice(0, pageSize);
    const toFetch = visible.filter((r) => !skuMap[r.style_name]);
    if (!toFetch.length) return;
    // Mark all as loading immediately so we don't double-fetch on the
    // next render cycle.
    setSkuMap((m) => {
      const next = { ...m };
      for (const r of toFetch) next[r.style_name] = { loading: true, skus: [] };
      return next;
    });
    api
      .get("/analytics/style-sku-breakdown-bulk", {
        params: { style_names: toFetch.map((r) => r.style_name).join(",") },
        timeout: 240000,
      })
      .then(({ data }) => {
        const styles = data?.styles || {};
        setSkuMap((m) => {
          const next = { ...m };
          for (const r of toFetch) {
            next[r.style_name] = { loading: false, skus: styles[r.style_name] || [] };
          }
          return next;
        });
      })
      .catch((e) => {
        setSkuMap((m) => {
          const next = { ...m };
          for (const r of toFetch) {
            next[r.style_name] = { loading: false, error: e?.message, skus: [] };
          }
          return next;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showColor, showSize, filtered]);

  // Build the visible row list. When toggles are off this is just the
  // filtered style rows. When ON we fan out one row per SKU variant.
  // Aggregation rule for split-mode:
  //   • color ON, size OFF → group SKUs by color; sum units / SOH per color
  //   • size ON, color OFF → group SKUs by size; sum
  //   • both ON           → one row per SKU
  const tableRows = useMemo(() => {
    if (!showColor && !showSize) return filtered;
    const out = [];
    for (const r of filtered) {
      const entry = skuMap[r.style_name];
      if (!entry) {
        out.push({ ...r, _sku_loading: true });
        continue;
      }
      if (entry.loading) {
        out.push({ ...r, _sku_loading: true });
        continue;
      }
      const skus = entry.skus || [];
      if (!skus.length) {
        out.push({ ...r, _no_skus: true });
        continue;
      }
      // Group key
      const keyFn = showColor && showSize
        ? (s) => `${s.color}|${s.size}|${s.sku}`
        : showColor
          ? (s) => s.color
          : (s) => s.size;
      const buckets = new Map();
      for (const s of skus) {
        const k = keyFn(s);
        if (!buckets.has(k)) {
          buckets.set(k, {
            color: s.color, size: s.size, sku: s.sku,
            units_6m: 0, units_3w: 0, sales_6m: 0,
            soh_total: 0, soh_store: 0, soh_wh: 0,
          });
        }
        const b = buckets.get(k);
        b.units_6m += s.units_6m || 0;
        b.units_3w += s.units_3w || 0;
        b.sales_6m += s.sales_6m || 0;
        b.soh_total += s.soh_total || 0;
        b.soh_store += s.soh_store || 0;
        b.soh_wh += s.soh_wh || 0;
      }
      const sorted = [...buckets.values()].sort((a, b) => b.units_6m - a.units_6m);
      for (let i = 0; i < sorted.length; i++) {
        const v = sorted[i];
        const denom = (v.units_6m || 0) + (v.soh_total || 0);
        const sor_6m = denom > 0 ? (v.units_6m / denom) * 100 : 0;
        const pct_in_wh = v.soh_total > 0 ? (v.soh_wh / v.soh_total) * 100 : 0;
        out.push({
          ...r,
          _is_variant: true,
          _is_first_variant: i === 0,
          _variant_count: sorted.length,
          variant_color: v.color,
          variant_size: v.size,
          variant_sku: v.sku,
          sales_6m: v.sales_6m,
          units_6m: v.units_6m,
          units_3w: v.units_3w,
          soh_total: v.soh_total,
          soh_store: v.soh_store,
          soh_wh: v.soh_wh,
          pct_in_wh,
          sor_6m,
          asp_6m: v.units_6m > 0 ? v.sales_6m / v.units_6m : 0,
          // weekly_avg / WOC don't carry to variants — use parent value
        });
      }
    }
    return out;
  }, [filtered, showColor, showSize, skuMap]);

  const styleNames = useMemo(() => filtered.map((r) => r.style_name), [filtered]);
  const { urlFor } = useThumbnails(styleNames);

  const baseColumns = useMemo(() => {
    const cols = [
      {
        key: "thumb", label: "", align: "left", sortable: false,
        mobileHidden: true,
        render: (r) => (
          // For variants, render a small color swatch instead of the style thumbnail.
          r._is_variant && !r._is_first_variant
            ? null
            : <ProductThumbnail style={r.style_name} url={urlFor(r.style_name)} size={36} />
        ),
        csv: () => "",
      },
      {
        key: "style_name", label: "Style Name", align: "left", mobilePrimary: true,
        render: (r) => (
          <div className="max-w-[220px]">
            {/* Clamp style name to 2 lines so very long names don't blow up
                row height. Tooltip shows the full name on hover. */}
            <div
              className="font-medium leading-snug overflow-hidden"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                wordBreak: "break-word",
              }}
              title={r.style_name}
            >
              {r.style_name}
            </div>
            <div className="text-[10.5px] text-muted mt-0.5 truncate" title={`${r.brand || "—"} · ${r.collection || "—"}`}>
              {r.brand || "—"} · {r.collection || "—"}
            </div>
            {r._sku_loading && <div className="text-[10.5px] text-muted italic mt-0.5">loading SKUs…</div>}
            {r._no_skus && <div className="text-[10.5px] text-muted italic mt-0.5">no SKU data</div>}
          </div>
        ),
        csv: (r) => r.style_name,
      },
    ];
    if (showColor) {
      cols.push({
        key: "variant_color", label: "Color/Print", align: "left",
        render: (r) => r.variant_color
          ? <span className="pill-neutral">{r.variant_color}</span>
          : <span className="text-muted text-[10.5px]">—</span>,
        csv: (r) => r.variant_color || "",
      });
    }
    if (showSize) {
      cols.push({
        key: "variant_size", label: "Size", align: "left",
        render: (r) => r.variant_size
          ? <span className="pill-neutral">{r.variant_size}</span>
          : <span className="text-muted text-[10.5px]">—</span>,
        csv: (r) => r.variant_size || "",
      });
    }
    cols.push(
      { key: "category",     label: "Category",     align: "left", render: (r) => <span className="pill-neutral">{r.category}</span>, csv: (r) => r.category },
      { key: "subcategory",  label: "Sub Category", align: "left", render: (r) => <span className="text-muted">{r.subcategory || "—"}</span>, csv: (r) => r.subcategory },
      { key: "style_number", label: "Style #",      align: "left", render: (r) => <span className="font-mono text-[11px] text-muted">{r._is_variant ? (r.variant_sku || r.style_number) : (r.style_number || "—")}</span>, csv: (r) => r._is_variant ? (r.variant_sku || "") : (r.style_number || "") },
      { key: "sales_6m",     label: "Sales 6M",     numeric: true, render: (r) => <span className="font-bold">{fmtKES(r.sales_6m)}</span>, csv: (r) => r.sales_6m },
      { key: "units_6m",     label: "Units 6M",     numeric: true, render: (r) => fmtNum(r.units_6m) },
      { key: "units_3w",     label: "Units 3W",     numeric: true, render: (r) => <span className={r.units_3w === 0 ? "text-red-700" : ""}>{fmtNum(r.units_3w)}</span>, csv: (r) => r.units_3w },
      { key: "soh_total",    label: "SOH",          numeric: true, render: (r) => fmtNum(Math.round(r.soh_total)), csv: (r) => r.soh_total },
      { key: "soh_wh",       label: "SOH W/H",      numeric: true, render: (r) => fmtNum(Math.round(r.soh_wh)), csv: (r) => r.soh_wh },
      {
        key: "pct_in_wh", label: "% In WH", numeric: true,
        sortValue: (r) => r.pct_in_wh,
        render: (r) => {
          const p = r.pct_in_wh || 0;
          const cls = p >= 50 ? "pill-red" : p >= 25 ? "pill-amber" : "pill-green";
          return <span className={cls}>{p.toFixed(1)}%</span>;
        },
        csv: (r) => r.pct_in_wh,
      },
      { key: "asp_6m",       label: "ASP 6M",       numeric: true, render: (r) => fmtKES(r.asp_6m), csv: (r) => r.asp_6m },
    );
    if (showLaunchDate) {
      cols.push(
        {
          key: "days_since_last_sale", label: "Days Since Last", numeric: true,
          render: (r) => {
            const d = r.days_since_last_sale || 0;
            const cls = d > 21 ? "pill-red" : d > 7 ? "pill-amber" : "pill-green";
            return <span className={cls}>{d}d</span>;
          },
          csv: (r) => r.days_since_last_sale,
        },
      );
    }
    cols.push(
      {
        key: "sor_6m", label: "6M SOR", numeric: true,
        render: (r) => {
          const s = r.sor_6m || 0;
          const cls = s >= 50 ? "pill-green" : s >= 25 ? "pill-amber" : "pill-red";
          return <span className={cls}>{s.toFixed(1)}%</span>;
        },
        csv: (r) => r.sor_6m,
      },
    );
    if (showLaunchDate) {
      cols.push({
        key: "launch_date", label: "Launch Date", align: "left",
        render: (r) => <span className="text-muted text-[11.5px]"><Calendar size={11} className="inline -mt-0.5 mr-1" />{r.launch_date || "—"}</span>,
        csv: (r) => r.launch_date,
      });
    }
    cols.push(
      { key: "weekly_avg",      label: "Weekly Avg",      numeric: true, render: (r) => (r.weekly_avg || 0).toFixed(1), csv: (r) => r.weekly_avg },
      {
        key: "woc", label: "WOC", numeric: true,
        sortValue: (r) => r.woc == null ? 9999 : r.woc,
        render: (r) => {
          if (r.woc == null) return <span className="pill-neutral text-[10px]">∞</span>;
          const cls = r.woc < 4 ? "pill-green" : r.woc < 12 ? "pill-amber" : "pill-red";
          return <span className={cls}>{r.woc.toFixed(1)}w</span>;
        },
        csv: (r) => r.woc,
      },
      { key: "style_age_weeks", label: "Style Age (W)",   numeric: true, render: (r) => `${(r.style_age_weeks || 0).toFixed(1)}w`, csv: (r) => r.style_age_weeks },
    );
    return cols;
  }, [showColor, showSize, showLaunchDate, urlFor]);

  if (!rows.length) {
    return <Empty label="No styles available." />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="search"
            placeholder="Filter by style name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid={`${testId}-search`}
            className="input-pill pl-7 pr-7 w-full"
            aria-label="Filter by style name"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              data-testid={`${testId}-search-clear`}
              aria-label="Clear search"
            >
              <X size={13} weight="bold" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowColor((v) => !v)}
          data-testid={`${testId}-toggle-color`}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all border ${
            showColor
              ? "bg-brand text-white border-brand"
              : "bg-white text-foreground/80 border-border hover:border-brand/60"
          }`}
        >
          <Palette size={13} weight={showColor ? "fill" : "regular"} />
          {showColor ? "Color/Print on" : "+ Color/Print"}
        </button>
        <button
          type="button"
          onClick={() => setShowSize((v) => !v)}
          data-testid={`${testId}-toggle-size`}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all border ${
            showSize
              ? "bg-brand text-white border-brand"
              : "bg-white text-foreground/80 border-border hover:border-brand/60"
          }`}
        >
          <Ruler size={13} weight={showSize ? "fill" : "regular"} />
          {showSize ? "Size on" : "+ Size"}
        </button>
        <span className="text-[11px] text-muted ml-auto">
          {filtered.length === rows.length
            ? `${rows.length} styles`
            : `${filtered.length} of ${rows.length} styles`}
          {(showColor || showSize) && filtered.length > pageSize && (
            <span className="ml-1 italic">· SKU split shown for first {pageSize}</span>
          )}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty label="No styles match the filter." />
      ) : (
        <SortableTable
          testId={testId}
          exportName={exportName}
          pageSize={pageSize}
          mobileCards
          initialSort={initialSort}
          columns={baseColumns}
          rows={tableRows}
        />
      )}
    </>
  );
};

export default SorStylesTable;
