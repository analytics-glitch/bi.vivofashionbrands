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
  windowDays = 30,     // Iter 91i — drives Weeks of Cover math.
}) => {
  // Iter 91i — formulas surfaced as column header tooltips + cell hover.
  const wiw = Math.max(windowDays / 7, 1 / 7);
  const coverOf = (units, stock) => (units > 0 ? stock / (units / wiw) : null);
  const sorOf = (units, stock) => {
    const denom = units + stock;
    return denom > 0 ? (units / denom) * 100 : 0;
  };
  const coverFormula = `Weeks of Cover = Stock Units ÷ (Units Sold ÷ ${wiw.toFixed(1)} weeks)`;
  const sorFormula = "Sell-Out Rate (SOR) = Units Sold ÷ (Units Sold + Stock) × 100";
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
  // Iter 91i — added Cover (weeks) + SOR (already there), renamed
  // labels to match the on-screen header strip.
  const csvCols = useMemo(
    () => [
      { key: "category", label: "Category" },
      { key: "subcategory", label: "Subcategory" },
      { key: "units_sold", label: "Units Sold" },
      { key: "current_stock", label: "Inventory Units" },
      { key: "pct_of_total_sold", label: "% Units Sales" },
      { key: "pct_of_total_stock", label: "% Units Inventory" },
      { key: "weeks_of_cover", label: "Cover (wks)" },
      { key: "sor_percent", label: "SOR %" },
      { key: "variance", label: "Variance (pts)" },
      { key: "risk_flag", label: "Risk Flag" },
      { key: "orders", label: "Orders" },
    ],
    []
  );
  const csvRows = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.map((r) => {
          const cov = coverOf(r.units_sold || 0, r.current_stock || 0);
          const sor = sorOf(r.units_sold || 0, r.current_stock || 0);
          return {
            category: g.category,
            subcategory: r.subcategory,
            units_sold: r.units_sold,
            current_stock: r.current_stock,
            pct_of_total_sold: r.pct_of_total_sold?.toFixed?.(2) ?? r.pct_of_total_sold,
            pct_of_total_stock: r.pct_of_total_stock?.toFixed?.(2) ?? r.pct_of_total_stock,
            weeks_of_cover: cov != null ? cov.toFixed(2) : "",
            sor_percent: sor.toFixed(2),
            variance: r.variance?.toFixed?.(2) ?? r.variance,
            risk_flag: varianceFlag(r.variance),
            orders: r.orders,
          };
        })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, windowDays]
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
        {/* Top column-header strip — matches the 8-col grid used by the
            outer category-header buttons + inner sub-rows so EVERY
            column header / total / row value lines up vertically.
            Without this, users only saw column titles after expanding
            a group, leaving the totals row visually unlabeled. */}
        <div
          className="grid grid-cols-[28px_1.3fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_1fr_1.1fr] gap-2 items-center px-3 py-2 bg-[#fed7aa] text-[10.5px] uppercase tracking-wide text-[#6b7280] font-semibold rounded-md"
          data-testid="accordion-top-header"
        >
          <span />
          <span className="text-left">Category</span>
          <span className="text-right">Units Sold</span>
          <span className="text-right">Inventory Units</span>
          <span className="text-right">% Units Sales</span>
          <span className="text-right">% Units Inventory</span>
          <span className="text-right cursor-help" title={`${coverFormula}. <4w restock · 4–17w healthy · >17w markdown.`}>Cover (wks)</span>
          <span className="text-right cursor-help" title={sorFormula}>SOR %</span>
          <span className="text-right">Variance</span>
          <span className="text-right">Risk Flag</span>
        </div>
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
                className={`w-full grid grid-cols-[28px_1.3fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_1fr_1.1fr] gap-2 items-center px-3 py-2.5 text-left transition-colors ${
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
                <span
                  className="text-right tabular-nums text-[12px] cursor-help"
                  title={`${coverFormula}\n= ${fmtNum(g.current_stock)} ÷ (${fmtNum(g.units_sold)} ÷ ${wiw.toFixed(1)})\n= ${coverOf(g.units_sold, g.current_stock)?.toFixed(1) ?? "—"} weeks`}
                >
                  {coverOf(g.units_sold, g.current_stock) != null
                    ? `${coverOf(g.units_sold, g.current_stock).toFixed(1)}w`
                    : "—"}
                </span>
                <span
                  className="text-right tabular-nums text-[12px] cursor-help"
                  title={`${sorFormula}\n= ${fmtNum(g.units_sold)} ÷ ${fmtNum(g.units_sold + g.current_stock)}\n= ${sorOf(g.units_sold, g.current_stock).toFixed(1)}%`}
                >
                  {sorOf(g.units_sold, g.current_stock).toFixed(1)}%
                </span>
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
                <div className="bg-white" data-testid={`acc-rows-${g.category.toLowerCase().replace(/\s+/g, '-')}`}>
                  {/* Inner header — same 8-col grid as the outer
                      category-header button so every column lines up
                      vertically across header → category row → sub
                      rows. Previously this was an HTML <table> with
                      `auto` widths, which drifted out of alignment
                      with the outer CSS grid (visible as off-centre
                      numbers in the screenshot the user shared). */}
                  <div
                    className="grid grid-cols-[28px_1.3fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_1fr_1.1fr] gap-2 px-3 py-2 bg-[#fef9f0] text-[10.5px] uppercase tracking-wide text-[#6b7280] border-t border-[#fcd9b6]"
                    data-testid={`acc-rows-head-${g.category.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <span />
                    <span className="text-left">Subcategory</span>
                    <span className="text-right">Units Sold</span>
                    <span className="text-right">Inventory Units</span>
                    <span className="text-right">% Units Sales</span>
                    <span className="text-right">% Units Inventory</span>
                    <span className="text-right">Cover (wks)</span>
                    <span className="text-right">SOR %</span>
                    <span className="text-right">Variance</span>
                    <span className="text-right">Risk Flag</span>
                  </div>
                  <div className="divide-y divide-[#fce6cc]">
                    {g.items.map((r) => {
                      const v = r.variance ?? 0;
                      const subFlag = varianceFlag(v);
                      const subFlagClass =
                        Math.abs(v) <= 2 ? "pill-green" :
                        Math.abs(v) <= 5 ? "pill-amber" :
                        "pill-red";
                      const subCover = coverOf(r.units_sold || 0, r.current_stock || 0);
                      const subSor = sorOf(r.units_sold || 0, r.current_stock || 0);
                      return (
                        <div
                          key={r.subcategory}
                          className="grid grid-cols-[28px_1.3fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_1fr_1.1fr] gap-2 items-center px-3 py-2 text-[12.5px] hover:bg-[#fff8ee]"
                        >
                          <span />
                          <span className="text-left text-[#0f3d24]">{r.subcategory}</span>
                          <span className="text-right tabular-nums font-semibold">{fmtNum(r.units_sold)}</span>
                          <span className="text-right tabular-nums">{fmtNum(r.current_stock)}</span>
                          <span className="text-right tabular-nums text-[#6b7280]">{fmtPct(r.pct_of_total_sold, 2)}</span>
                          <span className="text-right tabular-nums text-[#6b7280]">{fmtPct(r.pct_of_total_stock, 2)}</span>
                          <span
                            className="text-right tabular-nums cursor-help"
                            title={subCover != null
                              ? `${coverFormula}\n= ${fmtNum(r.current_stock)} ÷ (${fmtNum(r.units_sold)} ÷ ${wiw.toFixed(1)})\n= ${subCover.toFixed(1)} weeks`
                              : "No in-window sales — idle stock"}
                          >
                            {subCover != null ? `${subCover.toFixed(1)}w` : <span className="text-muted italic">Idle</span>}
                          </span>
                          <span
                            className="text-right tabular-nums cursor-help"
                            title={`${sorFormula}\n= ${fmtNum(r.units_sold)} ÷ ${fmtNum((r.units_sold || 0) + (r.current_stock || 0))}\n= ${subSor.toFixed(2)}%`}
                          >
                            {subSor.toFixed(1)}%
                          </span>
                          <span className="text-right tabular-nums">
                            <VarianceCell value={v} />
                          </span>
                          <span className="text-right">
                            <span className={subFlagClass}>{subFlag}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {/* Iter 91i — grand-total footer row across ALL categories.
            Same 10-col grid as the headers so columns line up. */}
        {(() => {
          const tot = groups.reduce(
            (a, g) => {
              a.units += g.units_sold || 0;
              a.stock += g.current_stock || 0;
              a.pct_sold += g.pct_sales || 0;
              a.pct_stock += g.pct_stock || 0;
              return a;
            },
            { units: 0, stock: 0, pct_sold: 0, pct_stock: 0 }
          );
          const totCover = coverOf(tot.units, tot.stock);
          const totSor = sorOf(tot.units, tot.stock);
          const totVar = tot.pct_sold - tot.pct_stock;
          return (
            <div
              className="grid grid-cols-[28px_1.3fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_0.9fr_1fr_1.1fr] gap-2 items-center px-3 py-2.5 bg-[#1a5c38] text-white rounded-md font-extrabold text-[13px]"
              data-testid="accordion-total-row"
            >
              <span />
              <span className="text-left uppercase tracking-wide text-[11.5px]">Total</span>
              <span className="text-right tabular-nums">{fmtNum(tot.units)}</span>
              <span className="text-right tabular-nums">{fmtNum(tot.stock)}</span>
              <span className="text-right tabular-nums text-[12px]">{fmtPct(tot.pct_sold, 2)}</span>
              <span className="text-right tabular-nums text-[12px]">{fmtPct(tot.pct_stock, 2)}</span>
              <span className="text-right tabular-nums text-[12px]" title={coverFormula}>
                {totCover != null ? `${totCover.toFixed(1)}w` : "—"}
              </span>
              <span className="text-right tabular-nums text-[12px]" title={sorFormula}>
                {totSor.toFixed(1)}%
              </span>
              <span className="text-right tabular-nums text-[12px]">
                {totVar >= 0 ? "+" : ""}{totVar.toFixed(2)} pts
              </span>
              <span className="text-right text-[11px]">—</span>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default CategoryAccordionTable;
