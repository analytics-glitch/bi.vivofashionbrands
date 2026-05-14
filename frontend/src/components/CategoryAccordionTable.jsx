import React, { useMemo, useState } from "react";
import { exportCSV } from "@/components/SortableTable";
import { Plus, Minus, Download } from "@phosphor-icons/react";
import { fmtNum, fmtPct } from "@/lib/api";
import { VarianceCell, varianceFlag } from "@/lib/variance";

/**
 * Category-grouped accordion view of subcategory rows.
 *
 * Each category renders as a collapsible header row showing aggregated
 * totals (sum units_sold, sum current_stock, sum % shares, weighted variance).
 * Click the header to fold / unfold the inner table of subcategory rows.
 *
 * Props mirror SortableTable's columns API so callers can reuse the same
 * column definitions. Rows must include a `subcategory` field; `categoryFor`
 * is supplied by the caller (the merch taxonomy lookup).
 */
const CategoryAccordionTable = ({
  rows,
  categoryFor,
  testId,
  exportName,
  initialOpen = "all", // "all" | "none" | <Set of category names>
}) => {
  // Group rows by resolved category. Sort categories alphabetically.
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) {
      const cat = categoryFor(r.subcategory) || "Other";
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat).push(r);
    }
    const out = [];
    for (const [cat, items] of m.entries()) {
      // Within a group, rank subcategories by units_sold desc.
      items.sort((a, b) => (b.units_sold || 0) - (a.units_sold || 0));
      const units_sold = items.reduce((s, r) => s + (r.units_sold || 0), 0);
      const current_stock = items.reduce((s, r) => s + (r.current_stock || 0), 0);
      const pct_sales = items.reduce((s, r) => s + (r.pct_of_total_sold || 0), 0);
      const pct_stock = items.reduce((s, r) => s + (r.pct_of_total_stock || 0), 0);
      out.push({
        category: cat,
        items,
        units_sold,
        current_stock,
        pct_sales,
        pct_stock,
        variance: pct_sales - pct_stock,
      });
    }
    out.sort((a, b) => b.units_sold - a.units_sold);
    return out;
  }, [rows, categoryFor]);

  const [openSet, setOpenSet] = useState(() => {
    if (initialOpen === "all") return new Set(groups.map((g) => g.category));
    if (initialOpen === "none") return new Set();
    return new Set(initialOpen);
  });

  const toggle = (cat) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  const expandAll = () => setOpenSet(new Set(groups.map((g) => g.category)));
  const collapseAll = () => setOpenSet(new Set());

  // Synthetic columns mirroring the by-Subcategory layout for CSV export.
  // Iter 78 — added Risk Flag so CSV output matches the on-screen
  // table (Variance + Risk Flag are now both visible columns).
  const csvCols = useMemo(
    () => [
      { key: "category", label: "Category" },
      { key: "subcategory", label: "Subcategory" },
      { key: "units_sold", label: "Units Sold" },
      { key: "current_stock", label: "Inventory" },
      { key: "pct_of_total_sold", label: "% of Total Sales" },
      { key: "pct_of_total_stock", label: "% of Total Inventory" },
      { key: "variance", label: "Variance (pts)" },
      { key: "risk_flag", label: "Risk Flag" },
      { key: "sor_percent", label: "SOR %" },
      { key: "orders", label: "Orders" },
    ],
    []
  );
  const csvRows = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.map((r) => ({
          category: g.category,
          subcategory: r.subcategory,
          units_sold: r.units_sold,
          current_stock: r.current_stock,
          pct_of_total_sold: r.pct_of_total_sold?.toFixed?.(2) ?? r.pct_of_total_sold,
          pct_of_total_stock: r.pct_of_total_stock?.toFixed?.(2) ?? r.pct_of_total_stock,
          variance: r.variance?.toFixed?.(2) ?? r.variance,
          risk_flag: varianceFlag(r.variance),
          sor_percent: r.sor_percent?.toFixed?.(2) ?? r.sor_percent,
          orders: r.orders,
        }))
      ),
    [groups]
  );

  if (!groups.length) {
    return <div className="text-sm text-muted py-6 text-center">No data</div>;
  }

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-end gap-3 text-[11px] mb-2">
        <button
          onClick={expandAll}
          className="text-[#1a5c38] font-bold hover:underline"
          data-testid="accordion-expand-all"
        >
          Expand all
        </button>
        <span className="text-[#d6c5a8]">·</span>
        <button
          onClick={collapseAll}
          className="text-[#1a5c38] font-bold hover:underline"
          data-testid="accordion-collapse-all"
        >
          Collapse all
        </button>
        {exportName && (
          <>
            <span className="text-[#d6c5a8]">·</span>
            <button
              onClick={() => exportCSV(csvRows, csvCols, exportName)}
              className="inline-flex items-center gap-1 text-[#1a5c38] font-bold hover:underline"
              data-testid="accordion-export-csv"
            >
              <Download size={11} weight="bold" /> Export CSV
            </button>
          </>
        )}
      </div>

      <div className="space-y-2">
        {groups.map((g) => {
          const open = openSet.has(g.category);
          // Iter 78 — Risk Flag column uses the shared varianceFlag()
          // mapping so it stays in lock-step with the flat table's
          // <VarianceCell> tooltip / pill behaviour. Threshold cutoffs
          // live in /app/frontend/src/lib/variance.jsx.
          const flag = varianceFlag(g.variance);
          const flagClass =
            Math.abs(g.variance) <= 2 ? "pill-green" :
            Math.abs(g.variance) <= 5 ? "pill-amber" :
            "pill-red";
          return (
            <div
              key={g.category}
              className="rounded-lg border border-[#fcd9b6] overflow-hidden"
              data-testid={`acc-group-${g.category.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <button
                onClick={() => toggle(g.category)}
                className={`w-full grid grid-cols-[28px_1.3fr_0.9fr_0.9fr_0.9fr_0.9fr_1fr_1.1fr] gap-2 items-center px-3 py-2.5 text-left transition-colors ${
                  open ? "bg-[#fef3e0]" : "bg-[#fff8ee] hover:bg-[#fef3e0]"
                }`}
                data-testid={`acc-toggle-${g.category.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <span className="text-[#1a5c38]">
                  {open ? <Minus size={14} weight="bold" /> : <Plus size={14} weight="bold" />}
                </span>
                <span className="font-extrabold text-[13px] text-[#0f3d24]">
                  {g.category}
                  <span className="ml-2 text-[10px] font-semibold text-[#6b7280] uppercase tracking-wide">
                    {g.items.length} subcat{g.items.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="text-right tabular-nums font-bold text-[13px]">{fmtNum(g.units_sold)}</span>
                <span className="text-right tabular-nums text-[13px] text-[#0f3d24]">{fmtNum(g.current_stock)}</span>
                <span className="text-right tabular-nums text-[12px]">{fmtPct(g.pct_sales, 2)}</span>
                <span className="text-right tabular-nums text-[12px]">{fmtPct(g.pct_stock, 2)}</span>
                {/* Iter 78 — Variance column matches the flat-table
                    cell exactly so users see the same "✅ +1.23%"
                    treatment whether they're in flat or grouped view. */}
                <span className="text-right">
                  <VarianceCell value={g.variance} />
                </span>
                <span className="text-right">
                  <span className={flagClass} data-testid={`acc-risk-flag-${g.category.toLowerCase().replace(/\s+/g, '-')}`}>{flag}</span>
                </span>
              </button>

              {open && (
                <div className="bg-white">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-[#fef9f0] text-[10.5px] uppercase tracking-wide text-[#6b7280]">
                      <tr>
                        <th className="text-left py-2 pl-9 pr-2">Subcategory</th>
                        <th className="text-right py-2 px-2">Units Sold</th>
                        <th className="text-right py-2 px-2">Inventory</th>
                        <th className="text-right py-2 px-2">% Sales</th>
                        <th className="text-right py-2 px-2">% Inventory</th>
                        <th className="text-right py-2 px-3">Variance</th>
                        <th className="text-right py-2 px-3">Risk Flag</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#fce6cc]">
                      {g.items.map((r) => {
                        const v = r.variance ?? 0;
                        const subFlag = varianceFlag(v);
                        const subFlagClass =
                          Math.abs(v) <= 2 ? "pill-green" :
                          Math.abs(v) <= 5 ? "pill-amber" :
                          "pill-red";
                        return (
                          <tr key={r.subcategory} className="hover:bg-[#fff8ee]">
                            <td className="py-2 pl-9 pr-2 text-[#0f3d24]">{r.subcategory}</td>
                            <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtNum(r.units_sold)}</td>
                            <td className="py-2 px-2 text-right tabular-nums">{fmtNum(r.current_stock)}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-[#6b7280]">{fmtPct(r.pct_of_total_sold, 2)}</td>
                            <td className="py-2 px-2 text-right tabular-nums text-[#6b7280]">{fmtPct(r.pct_of_total_stock, 2)}</td>
                            {/* Iter 78 — match flat-table variance
                                rendering (uses %) so users don't see
                                two different formats on the same page. */}
                            <td className="py-2 px-3 text-right tabular-nums">
                              <VarianceCell value={v} />
                            </td>
                            <td className="py-2 px-3 text-right">
                              <span className={subFlagClass}>{subFlag}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CategoryAccordionTable;
