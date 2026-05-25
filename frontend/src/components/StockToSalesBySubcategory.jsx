import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum, fmtPct, fmtDate } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, ErrorBox, SectionTitle } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import CategoryAccordionTable from "@/components/CategoryAccordionTable";
import { isMerchandise, categoryFor, MERCH_CATEGORIES, subcategoriesFor } from "@/lib/productCategory";
import { VarianceCell, varianceFlag } from "@/lib/variance";
import { CalendarBlank } from "@phosphor-icons/react";

/**
 * Stock-to-Sales · by Subcategory — self-contained, drop-in component.
 *
 * Pulls `/analytics/stock-to-sales-by-subcat` and renders either a flat
 * sortable table or a category-grouped accordion. Internal toggle.
 *
 * Used by:
 *   • /products  — original location
 *   • /locations — duplicated per leadership ask (iter 65)
 *
 * Iter 88b — On the Locations page this component now runs in
 * `useOwnDates` mode: it has its OWN date filter (independent of the
 * page-wide one at the top) so users can scope subcategory mix to a
 * different window than the rest of the page. Default lookback: 30 days.
 */
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const StockToSalesBySubcategory = ({
  testIdPrefix = "sts-subcat",
  exportNameFlat = "stock-to-sales-by-subcategory.csv",
  exportNameGrouped = "stock-to-sales-by-subcategory-grouped.csv",
  subtitleOverride,
  // ── Iter 88b: standalone date-filter mode ─────────────────────────
  // When true, the component ignores the global FilterBar dates and
  // exposes its OWN date inputs (default lookback: `defaultLookbackDays`).
  // Country / channel / category filters still come from the global
  // bar — only the date window is independent.
  useOwnDates = false,
  defaultLookbackDays = 30,
}) => {
  const globalFilters = useFilters();
  const { countries, channels, categories, dataVersion } = globalFilters;

  // Local date state — only used when useOwnDates is true.
  const [localFrom, setLocalFrom] = useState(() => isoDaysAgo(defaultLookbackDays));
  const [localTo, setLocalTo] = useState(() => isoToday());
  const [presetKey, setPresetKey] = useState(`last_${defaultLookbackDays}`);

  // Effective dates fed to the API call.
  const dateFrom = useOwnDates ? localFrom : globalFilters.dateFrom;
  const dateTo = useOwnDates ? localTo : globalFilters.dateTo;

  const applyPreset = (key) => {
    setPresetKey(key);
    const today = isoToday();
    let days;
    switch (key) {
      case "last_7": days = 7; break;
      case "last_30": days = 30; break;
      case "last_60": days = 60; break;
      case "last_90": days = 90; break;
      case "ytd": {
        const y = new Date().getFullYear();
        setLocalFrom(`${y}-01-01`);
        setLocalTo(today);
        return;
      }
      default: return; // "custom" — leave inputs as-is
    }
    setLocalFrom(isoDaysAgo(days));
    setLocalTo(today);
  };

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
      {useOwnDates && (
        <DateFilterStrip
          testIdPrefix={testIdPrefix}
          presetKey={presetKey}
          applyPreset={applyPreset}
          localFrom={localFrom}
          localTo={localTo}
          setLocalFrom={(v) => { setPresetKey("custom"); setLocalFrom(v); }}
          setLocalTo={(v) => { setPresetKey("custom"); setLocalTo(v); }}
        />
      )}
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
      {useOwnDates && (
        <DateFilterStrip
          testIdPrefix={testIdPrefix}
          presetKey={presetKey}
          applyPreset={applyPreset}
          localFrom={localFrom}
          localTo={localTo}
          setLocalFrom={(v) => { setPresetKey("custom"); setLocalFrom(v); }}
          setLocalTo={(v) => { setPresetKey("custom"); setLocalTo(v); }}
        />
      )}
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
// fmtDate is reserved for a future "data through DD MMM" caption — silence
// the unused-import lint until then.
void fmtDate;

// ── Compact in-card date filter (iter 88b) ─────────────────────────
// Renders a row of preset chips (Last 7/30/60/90 days · YTD · Custom)
// alongside two native date inputs. Lives ONLY inside the card so it
// does not affect any sibling component on the page.
const PRESETS = [
  ["last_7", "Last 7 days"],
  ["last_30", "Last 30 days"],
  ["last_60", "Last 60 days"],
  ["last_90", "Last 90 days"],
  ["ytd", "YTD"],
];

const DateFilterStrip = ({
  testIdPrefix,
  presetKey,
  applyPreset,
  localFrom,
  localTo,
  setLocalFrom,
  setLocalTo,
}) => (
  <div
    className="mb-3 -mt-1 rounded-lg border border-[#fcd9b6] bg-[#fffaf3] px-3 py-2 flex flex-wrap items-center gap-2"
    data-testid={`${testIdPrefix}-date-filter`}
  >
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-brand-deep">
      <CalendarBlank size={13} weight="bold" />
      Date range
    </span>
    <div className="inline-flex flex-wrap gap-1">
      {PRESETS.map(([k, lbl]) => (
        <button
          key={k}
          type="button"
          data-testid={`${testIdPrefix}-preset-${k}`}
          onClick={() => applyPreset(k)}
          className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
            presetKey === k
              ? "bg-brand text-white border-brand"
              : "bg-white text-foreground/80 border-[#fcd9b6] hover:border-brand/40"
          }`}
        >
          {lbl}
        </button>
      ))}
    </div>
    <div className="inline-flex items-center gap-1.5 ml-auto">
      <input
        type="date"
        value={localFrom}
        onChange={(e) => setLocalFrom(e.target.value)}
        data-testid={`${testIdPrefix}-date-from`}
        className="px-2 py-1 rounded-md border border-[#fcd9b6] bg-white text-[11.5px] outline-none focus:border-brand"
      />
      <span className="text-muted text-[12px]">→</span>
      <input
        type="date"
        value={localTo}
        onChange={(e) => setLocalTo(e.target.value)}
        data-testid={`${testIdPrefix}-date-to`}
        className="px-2 py-1 rounded-md border border-[#fcd9b6] bg-white text-[11.5px] outline-none focus:border-brand"
      />
    </div>
  </div>
);

export default StockToSalesBySubcategory;
