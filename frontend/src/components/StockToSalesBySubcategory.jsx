import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum, fmtPct } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, ErrorBox, SectionTitle } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import CategoryAccordionTable from "@/components/CategoryAccordionTable";
import { isMerchandise, categoryFor, MERCH_CATEGORIES, subcategoriesFor } from "@/lib/productCategory";
import { VarianceCell, varianceFlag } from "@/lib/variance";

/**
 * Stock-to-Sales · by Subcategory — self-contained, drop-in component.
 *
 * Pulls `/analytics/stock-to-sales-by-subcat` and renders either a flat
 * sortable table or a category-grouped accordion. Internal toggle.
 *
 * Used by:
 *   • /products  — original location
 *   • /locations — duplicated per leadership ask (iter 65)
 */
const StockToSalesBySubcategory = ({
  testIdPrefix = "sts-subcat",
  exportNameFlat = "stock-to-sales-by-subcategory.csv",
  exportNameGrouped = "stock-to-sales-by-subcategory-grouped.csv",
  subtitleOverride,
}) => {
  const { dateFrom, dateTo, countries, channels, categories, dataVersion } = useFilters();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Iter 78 — Default to the category-grouped view per leadership ask.
  // The flat layout is still one click away via the toggle for users
  // who want the row-per-subcategory drill.
  const [view, setView] = useState("grouped");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const params = {
      date_from: dateFrom, date_to: dateTo,
      country: countries.length === 1 ? countries[0] : undefined,
      channel: channels.length === 1 ? channels[0] : undefined,
    };
    api.get("/analytics/stock-to-sales-by-subcat", { params, timeout: 240000 })
      .then(({ data }) => { if (!cancel) setRows(data || []); })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  // Honour the global Category filter + drop non-merchandise rows so
  // we match the parent Products page's behaviour exactly.
  const filtered = useMemo(() => {
    const catSet = (categories && categories.length > 0)
      ? new Set(categories.filter((c) => c && c !== "All categories"))
      : null;
    const allowedSubcats = catSet
      ? new Set([...catSet].flatMap((c) => subcategoriesFor(c)))
      : null;
    return (rows || []).filter((r) => {
      const sub = r.subcategory || "";
      if (!isMerchandise(sub)) return false;
      if (allowedSubcats && !allowedSubcats.has(sub)) return false;
      return true;
    });
  }, [rows, categories]);

  if (loading) return (
    <div className="card-white p-5" data-testid={`${testIdPrefix}-card`}>
      <SectionTitle
        title="Stock-to-Sales · by Subcategory"
        subtitle={subtitleOverride || "Granular view — one row per merchandise subcategory."}
      />
      <Loading label="Loading subcategory mix…" />
    </div>
  );
  if (error) return (
    <div className="card-white p-5" data-testid={`${testIdPrefix}-card`}>
      <SectionTitle title="Stock-to-Sales · by Subcategory" />
      <ErrorBox message={error} />
    </div>
  );

  return (
    <div className="card-white p-5" data-testid={`${testIdPrefix}-card`}>
      <SectionTitle
        title="Stock-to-Sales · by Subcategory"
        subtitle={subtitleOverride || "Granular view — one row per merchandise subcategory. Switch to Grouped to fold rows under collapsible category headers. Red = action needed (stockout or overstock risk). Green = healthy balance."}
      />
      <div className="flex justify-end mb-2 -mt-1">
        <div className="inline-flex rounded-md overflow-hidden border border-[#fcd9b6]" data-testid={`${testIdPrefix}-view-toggle`}>
          <button
            onClick={() => setView("flat")}
            data-testid={`${testIdPrefix}-view-flat`}
            className={`text-[11px] font-bold px-2.5 py-1 transition-colors ${view === "flat" ? "bg-[#1a5c38] text-white" : "bg-white text-[#1a5c38] hover:bg-[#fef3e0]"}`}
          >
            Flat table
          </button>
          <button
            onClick={() => setView("grouped")}
            data-testid={`${testIdPrefix}-view-grouped`}
            className={`text-[11px] font-bold px-2.5 py-1 transition-colors ${view === "grouped" ? "bg-[#1a5c38] text-white" : "bg-white text-[#1a5c38] hover:bg-[#fef3e0]"}`}
          >
            Grouped by category
          </button>
        </div>
      </div>
      {view === "grouped" ? (
        <CategoryAccordionTable
          rows={filtered}
          categoryFor={categoryFor}
          testId={`${testIdPrefix}-grouped`}
          exportName={exportNameGrouped}
        />
      ) : (
        <SortableTable
          testId={testIdPrefix}
          exportName={exportNameFlat}
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
          rows={filtered}
        />
      )}
    </div>
  );
};

// Avoid unused-import lint when MERCH_CATEGORIES is absent.
void MERCH_CATEGORIES;

export default StockToSalesBySubcategory;
