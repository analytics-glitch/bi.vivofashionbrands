import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum, fmtKES } from "@/lib/api";
import { Loading, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { X } from "@phosphor-icons/react";

/**
 * Modal drill-down for a style. Fetches SKU-level stock from `/api/inventory`
 * filtered by `style_name` (upstream prefix-matches on product_name), shows
 * rows grouped by Color · Size · Location with Available units.
 *
 * Sales-per-variant is NOT available from upstream — only the style's total
 * units sold & sales figures are shown at the top as context.
 */
const VariantDrillDown = ({ style, onClose }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!style?.style_name) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get("/inventory", { params: { product: style.style_name } })
      .then((r) => {
        if (cancelled) return;
        // Upstream prefix-match can return unrelated styles — filter to exact style_name.
        const matched = (r.data || []).filter(
          (x) => (x.style_name || "").trim().toLowerCase() === style.style_name.trim().toLowerCase()
        );
        setRows(matched);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [style?.style_name]);

  const summary = useMemo(() => {
    const byColor = new Map();
    const bySize = new Map();
    let totalAvail = 0;
    for (const r of rows) {
      const color = r.color_print || "—";
      const size = r.size || "—";
      const av = r.available || 0;
      totalAvail += av;
      byColor.set(color, (byColor.get(color) || 0) + av);
      bySize.set(size, (bySize.get(size) || 0) + av);
    }
    return {
      totalAvail,
      colors: [...byColor.entries()].sort((a, b) => b[1] - a[1]),
      sizes: [...bySize.entries()].sort((a, b) => b[1] - a[1]),
      locations: new Set(rows.map((r) => r.location_name)).size,
    };
  }, [rows]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
      data-testid="variant-drilldown-overlay"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-8"
        onClick={(e) => e.stopPropagation()}
        data-testid="variant-drilldown"
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div className="min-w-0">
            <div className="eyebrow">SKU variant drill-down</div>
            <h3 className="font-extrabold text-[18px] sm:text-[20px] tracking-tight mt-1 break-words" data-testid="variant-drilldown-title">
              {style?.style_name || "—"}
            </h3>
            <div className="text-[12px] text-muted mt-1 flex flex-wrap items-center gap-2">
              {style?.brand && <span className="pill-neutral">{style.brand}</span>}
              {style?.product_type && <span className="pill-neutral">{style.product_type}</span>}
              {style?.category && <span className="pill-neutral">{style.category}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-panel shrink-0"
            data-testid="variant-drilldown-close"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-5 border-b border-border bg-panel/50">
          <div>
            <div className="eyebrow">Units Sold (launch)</div>
            <div className="font-bold text-[16px] num mt-0.5">{fmtNum(style?.units_sold_launch ?? style?.units_sold ?? 0)}</div>
          </div>
          <div>
            <div className="eyebrow">Sales (launch)</div>
            <div className="font-bold text-[16px] num mt-0.5 text-brand">{fmtKES(style?.total_sales_launch ?? style?.total_sales ?? 0)}</div>
          </div>
          <div>
            <div className="eyebrow">Total Available</div>
            <div className="font-bold text-[16px] num mt-0.5">{fmtNum(summary.totalAvail)}</div>
          </div>
          <div>
            <div className="eyebrow">Locations Carrying</div>
            <div className="font-bold text-[16px] num mt-0.5">{fmtNum(summary.locations)}</div>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {loading && <Loading label="Loading SKU variants…" />}
          {error && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-[12.5px] text-amber-900">
              ⚠️ {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <Empty label="No stock found for this style across any location." />
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <div className="eyebrow mb-2">Stock by Color / Print</div>
                  <div className="space-y-1.5" data-testid="variant-by-color">
                    {summary.colors.map(([c, n]) => (
                      <div key={c} className="flex items-center justify-between text-[12.5px]">
                        <span className="font-medium">{c}</span>
                        <span className="num font-semibold">{fmtNum(n)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="eyebrow mb-2">Stock by Size</div>
                  <div className="space-y-1.5" data-testid="variant-by-size">
                    {summary.sizes.map(([s, n]) => (
                      <div key={s} className="flex items-center justify-between text-[12.5px]">
                        <span className="font-medium">{s}</span>
                        <span className="num font-semibold">{fmtNum(n)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="eyebrow mb-2">Per-SKU breakdown · {fmtNum(rows.length)} rows</div>
                <SortableTable
                  testId="variant-sku-table"
                  exportName={`variants-${(style?.style_name || "style").replace(/\s+/g, "-").toLowerCase()}.csv`}
                  initialSort={{ key: "available", dir: "desc" }}
                  pageSize={25}
                  columns={[
                    { key: "location_name", label: "Location", align: "left", render: (r) => <span className="font-medium">{r.location_name || "—"}</span> },
                    { key: "country", label: "Country", align: "left", render: (r) => <span className="capitalize">{r.country || "—"}</span> },
                    { key: "color_print", label: "Color / Print", align: "left", render: (r) => r.color_print || "—" },
                    { key: "size", label: "Size", align: "left", render: (r) => r.size || "—" },
                    { key: "sku", label: "SKU", align: "left", render: (r) => <span className="font-mono text-[11px] text-muted">{r.sku || "—"}</span>, csv: (r) => r.sku },
                    { key: "available", label: "Available", numeric: true, render: (r) => <span className={`font-semibold ${(r.available || 0) <= 2 ? "text-danger" : ""}`}>{fmtNum(r.available)}</span>, csv: (r) => r.available },
                  ]}
                  rows={rows}
                />
              </div>

              <div className="rounded-lg border border-dashed border-border bg-panel/50 p-3 text-[11.5px] text-muted">
                <span className="font-semibold text-foreground">Note:</span> Upstream exposes
                units-sold at the style level only. Per-SKU (colour × size) sales data is not
                yet available from the BI API — this view shows current STOCK per variant alongside
                the style's total sell-out metrics.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VariantDrillDown;
