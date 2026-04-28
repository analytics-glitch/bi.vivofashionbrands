import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtNum, fmtKES } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import MultiSelect from "@/components/MultiSelect";
import { Tag } from "@phosphor-icons/react";

// ---------------------------------------------------------------------------
// Reusable formatters
// ---------------------------------------------------------------------------
const fmtPct = (v, digits = 2) => (v == null || isNaN(v) ? "—" : `${Number(v).toFixed(digits)}%`);

const DeltaCell = ({ value, suffix = "%" }) => {
  if (value == null || isNaN(value)) return <span className="text-muted">—</span>;
  const pos = value > 0;
  const neg = value < 0;
  const cls = pos ? "text-success" : neg ? "text-danger" : "text-muted";
  return (
    <span className={`num font-semibold ${cls}`}>
      {pos ? "▲ " : neg ? "▼ " : ""}
      {Math.abs(value).toFixed(2)}{suffix}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Table 1 — Store KPIs
// ---------------------------------------------------------------------------
export const StoreKpisExport = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, dataVersion } = applied;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get("/exports/store-kpis", { params: { date_from: dateFrom, date_to: dateTo } })
      .then((r) => {
        if (!cancelled) {
          setData(r.data || null);
          touchLastUpdated();
        }
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, dataVersion]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data || !data.rows?.length) return <Empty label="No store KPIs for this period." />;

  // 27 columns: stick the first (POS Location) so it stays visible while scrolling.
  const columns = [
    { key: "pos_location", label: "POS Location", align: "left",
      render: (r) => <span className="font-medium whitespace-nowrap">{r.pos_location}</span> },
    { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => fmtKES(r.total_sales) },
    { key: "total_sales_ly", label: "Total Sales LY", numeric: true, render: (r) => fmtKES(r.total_sales_ly) },
    { key: "yoy_revenue_pct", label: "YoY Rev Δ", numeric: true, render: (r) => <DeltaCell value={r.yoy_revenue_pct} /> },
    { key: "total_sales_lm", label: "Total Sales LM", numeric: true, render: (r) => fmtKES(r.total_sales_lm) },
    { key: "mom_revenue_pct", label: "MoM Rev Δ", numeric: true, render: (r) => <DeltaCell value={r.mom_revenue_pct} /> },
    { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
    { key: "units_sold_ly", label: "Units LY", numeric: true, render: (r) => fmtNum(r.units_sold_ly) },
    { key: "yoy_units_pct", label: "YoY Units Δ", numeric: true, render: (r) => <DeltaCell value={r.yoy_units_pct} /> },
    { key: "footfall", label: "Footfall", numeric: true, render: (r) => fmtNum(r.footfall) },
    { key: "footfall_ly", label: "Footfall LY", numeric: true, render: (r) => fmtNum(r.footfall_ly) },
    { key: "yoy_footfall_pct", label: "YoY Footfall Δ", numeric: true, render: (r) => <DeltaCell value={r.yoy_footfall_pct} /> },
    { key: "transactions", label: "Transactions", numeric: true, render: (r) => fmtNum(r.transactions) },
    { key: "transactions_ly", label: "Transactions LY", numeric: true, render: (r) => fmtNum(r.transactions_ly) },
    { key: "yoy_transactions_pct", label: "YoY Tx Δ", numeric: true, render: (r) => <DeltaCell value={r.yoy_transactions_pct} /> },
    { key: "basket_value", label: "B.Value", numeric: true, render: (r) => fmtKES(r.basket_value) },
    { key: "basket_value_ly", label: "B.Value LY", numeric: true, render: (r) => fmtKES(r.basket_value_ly) },
    { key: "yoy_basket_value_pct", label: "YoY B.Value Δ", numeric: true, render: (r) => <DeltaCell value={r.yoy_basket_value_pct} /> },
    { key: "asp", label: "ASP", numeric: true, render: (r) => fmtKES(r.asp) },
    { key: "asp_ly", label: "ASP LY", numeric: true, render: (r) => fmtKES(r.asp_ly) },
    { key: "yoy_asp_pct", label: "YoY ASP Δ", numeric: true, render: (r) => <DeltaCell value={r.yoy_asp_pct} /> },
    { key: "msi", label: "MSI", numeric: true, render: (r) => (r.msi ?? 0).toFixed(2) },
    { key: "msi_ly", label: "MSI LY", numeric: true, render: (r) => (r.msi_ly ?? 0).toFixed(2) },
    { key: "yoy_msi_pct", label: "YoY MSI Δ", numeric: true, render: (r) => <DeltaCell value={r.yoy_msi_pct} /> },
    { key: "conv_rate", label: "Conv Rate", numeric: true, render: (r) => fmtPct(r.conv_rate) },
    { key: "yoy_conv_pp", label: "YoY Conv (pp)", numeric: true, render: (r) => <DeltaCell value={r.yoy_conv_pp} suffix="pp" /> },
  ];

  return (
    <div className="card-white p-5" data-testid="exports-store-kpis-card">
      <SectionTitle
        title="Store KPIs"
        subtitle={
          `One row per POS location. Comparisons: LY = same window last year ` +
          `(${data.period_ly?.date_from} → ${data.period_ly?.date_to}), ` +
          `LM = previous equal-length window ` +
          `(${data.period_lm?.date_from} → ${data.period_lm?.date_to}). ` +
          `MSI = average units per transaction. Δ = YoY % unless suffixed pp.`
        }
      />
      <SortableTable
        testId="exports-store-kpis"
        exportName="store-kpis.csv"
        pageSize={50}
        stickyFirstCol
        initialSort={{ key: "total_sales", dir: "desc" }}
        columns={columns}
        rows={data.rows}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Table 2 — Period Performance (WTD / MTD / YTD)
// ---------------------------------------------------------------------------
const MODES = [
  { value: "wtd", label: "Week to date" },
  { value: "mtd", label: "Month to date" },
  { value: "ytd", label: "Year to date" },
];

// Compute the Monday of the ISO-week index (1..53) of `year`.
const dateOfIsoWeek = (year, week) => {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7; // 1..7 (Mon..Sun)
  const monday = new Date(simple);
  if (dow <= 4) monday.setUTCDate(simple.getUTCDate() - dow + 1);
  else monday.setUTCDate(simple.getUTCDate() + 8 - dow);
  return monday;
};

const isoWeekOf = (d) => {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
};

export const PeriodPerformanceExport = () => {
  const today = useMemo(() => new Date(), []);
  const currentYear = today.getFullYear();
  const currentWeek = useMemo(() => isoWeekOf(today), [today]);

  const [mode, setMode] = useState("wtd");
  const [week, setWeek] = useState(currentWeek);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Anchor date — for WTD this is the SUNDAY of the chosen week (or today
  // if it's the current week so we don't query the future).
  const anchor = useMemo(() => {
    if (mode !== "wtd") return today.toISOString().slice(0, 10);
    const monday = dateOfIsoWeek(currentYear, week);
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    const cap = sunday > today ? today : sunday;
    return cap.toISOString().slice(0, 10);
  }, [mode, week, currentYear, today]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api
      .get("/exports/period-performance", { params: { mode, anchor } })
      .then((r) => !cancelled && setData(r.data || null))
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [mode, anchor]);

  const rows = data?.rows || [];

  const columns = useMemo(() => [
    { key: "store_name", label: "Store", align: "left",
      render: (r) => <span className="font-medium whitespace-nowrap">{r.store_name}</span> },
    { key: "units_lly", label: "Units LLY", numeric: true, render: (r) => fmtNum(r.units_lly) },
    { key: "units_ly", label: "Units LY", numeric: true, render: (r) => fmtNum(r.units_ly) },
    { key: "units_cy", label: "Units CY", numeric: true, render: (r) => fmtNum(r.units_cy) },
    { key: "units_yoy_pct", label: "Δ LY", numeric: true, render: (r) => <DeltaCell value={r.units_yoy_pct} /> },
    { key: "units_lly_pct", label: "Δ LLY", numeric: true, render: (r) => <DeltaCell value={r.units_lly_pct} /> },
    { key: "revenue_lly", label: "Rev LLY", numeric: true, render: (r) => fmtKES(r.revenue_lly) },
    { key: "revenue_ly", label: "Rev LY", numeric: true, render: (r) => fmtKES(r.revenue_ly) },
    { key: "revenue_cy", label: "Rev CY", numeric: true, render: (r) => fmtKES(r.revenue_cy) },
    { key: "revenue_yoy_pct", label: "Δ LY", numeric: true, render: (r) => <DeltaCell value={r.revenue_yoy_pct} /> },
    { key: "revenue_lly_pct", label: "Δ LLY", numeric: true, render: (r) => <DeltaCell value={r.revenue_lly_pct} /> },
    { key: "asp_lly", label: "ASP LLY", numeric: true, render: (r) => fmtKES(r.asp_lly) },
    { key: "asp_ly", label: "ASP LY", numeric: true, render: (r) => fmtKES(r.asp_ly) },
    { key: "asp_cy", label: "ASP CY", numeric: true, render: (r) => fmtKES(r.asp_cy) },
    { key: "asp_yoy_pct", label: "Δ LY", numeric: true, render: (r) => <DeltaCell value={r.asp_yoy_pct} /> },
    { key: "asp_lly_pct", label: "Δ LLY", numeric: true, render: (r) => <DeltaCell value={r.asp_lly_pct} /> },
    { key: "contrib_revenue_pct", label: "% Contr Rev", numeric: true, render: (r) => fmtPct(r.contrib_revenue_pct) },
  ], []);

  return (
    <div className="card-white p-5" data-testid="exports-period-perf-card">
      <SectionTitle
        title={`${MODES.find((m) => m.value === mode)?.label || "Period"} Performance`}
        subtitle={
          `3-year comparison per store: Last-Last-Year, Last-Year, Current-Year. ` +
          (data
            ? `Window: ${data.period_current?.date_from} → ${data.period_current?.date_to}.`
            : "")
        }
      />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <div className="eyebrow mb-1">Performance mode</div>
          <select
            data-testid="period-perf-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="input-pill"
          >
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        {mode === "wtd" && (
          <div>
            <div className="eyebrow mb-1">ISO Week (current year)</div>
            <select
              data-testid="period-perf-week"
              value={week}
              onChange={(e) => setWeek(Number(e.target.value))}
              className="input-pill"
            >
              {Array.from({ length: currentWeek }, (_, i) => i + 1).reverse().map((w) => (
                <option key={w} value={w}>
                  Week {w} {w === currentWeek ? "(current)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {loading ? <Loading />
        : error ? <ErrorBox message={error} />
        : !rows.length ? <Empty label="No data for this period." />
        : (
          <SortableTable
            testId="exports-period-perf"
            exportName="period-performance.csv"
            pageSize={50}
            stickyFirstCol
            initialSort={{ key: "revenue_cy", dir: "desc" }}
            columns={columns}
            rows={rows}
          />
        )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Table 3 — Stock Rebalancing
// ---------------------------------------------------------------------------
export const StockRebalancingExport = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [catSel, setCatSel] = useState([]); // empty = all

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const params = catSel.length ? { categories: catSel.join(",") } : {};
    api
      .get("/exports/stock-rebalancing", { params, timeout: 60000 })
      .then((r) => !cancelled && setData(r.data || null))
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [JSON.stringify(catSel)]);  // eslint-disable-line

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data || !data.rows?.length) return <Empty label="No data available." />;

  const { years, current_quarter, rows, totals, available_categories } = data;

  // Build column groups dynamically from the years array.
  const columns = [
    { key: "category", label: "Category", align: "left",
      render: (r) => (
        r.is_total
          ? <span className="font-extrabold text-brand-deep">{r.category}</span>
          : <span className="text-muted text-[11.5px]">{r.category}</span>
      ),
    },
    { key: "subcategory", label: "Subcategory", align: "left",
      render: (r) => r.is_total ? <span className="text-muted italic">— total —</span> : <span className="font-medium">{r.subcategory}</span>,
    },
    ...years.flatMap((y) => [
      { key: `y${y}_units_sold`, label: `${y} Units`, numeric: true, render: (r) => fmtNum(r[`y${y}_units_sold`]) },
      { key: `y${y}_units_sold_pct`, label: `${y} %`, numeric: true, render: (r) => fmtPct(r[`y${y}_units_sold_pct`]) },
      { key: `y${y}_units_q`, label: `${y} Q${current_quarter}`, numeric: true, render: (r) => fmtNum(r[`y${y}_units_q`]) },
      { key: `y${y}_units_q_pct`, label: `${y} Q${current_quarter} %`, numeric: true, render: (r) => fmtPct(r[`y${y}_units_q_pct`]) },
    ]),
    { key: "soh", label: "SOH", numeric: true, render: (r) => fmtNum(r.soh) },
    { key: "soh_pct", label: "SOH %", numeric: true, render: (r) => fmtPct(r.soh_pct) },
  ];

  // Style category-total rows differently to match the reference layout.
  const enrichedRows = rows.map((r) => ({
    ...r,
    _rowClass: r.is_total ? "bg-brand-soft/40 font-semibold" : "",
  }));

  // Footer = grand total row.
  const footerRow = [
    <td key="cat" className="px-2 py-2 text-left font-extrabold text-brand-deep">Grand Total</td>,
    <td key="sub" className="px-2 py-2" />,
    ...years.flatMap((y) => [
      <td key={`${y}u`} className="px-2 py-2 text-right num font-bold">{fmtNum(totals[`y${y}_units_sold`])}</td>,
      <td key={`${y}up`} className="px-2 py-2 text-right num">100.00%</td>,
      <td key={`${y}q`} className="px-2 py-2 text-right num font-bold">{fmtNum(totals[`y${y}_units_q`])}</td>,
      <td key={`${y}qp`} className="px-2 py-2 text-right num">100.00%</td>,
    ]),
    <td key="soh" className="px-2 py-2 text-right num font-bold text-brand">{fmtNum(totals.soh)}</td>,
    <td key="sohp" className="px-2 py-2 text-right num">100.00%</td>,
  ];

  return (
    <div className="card-white p-5" data-testid="exports-stock-rebalancing-card">
      <SectionTitle
        title={`Stock Rebalancing · Q${current_quarter} comparison`}
        subtitle={
          `Per category × subcategory: full-year units sold (${years.join(", ")}) and units in the same calendar quarter (Q${current_quarter}) for each year, alongside live Stock-on-Hand. ` +
          `Use this to spot subcategories where SOH is over- or under-indexed vs historical run-rate.`
        }
      />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <MultiSelect
          testId="stock-reb-category"
          label="Product category"
          icon={Tag}
          width={260}
          value={catSel}
          options={(available_categories || []).map((c) => ({ value: c, label: c }))}
          onChange={setCatSel}
          placeholder="All categories"
        />
        {loading && <span className="text-[12px] text-muted animate-pulse">refreshing…</span>}
      </div>
      <SortableTable
        testId="exports-stock-rebalancing"
        exportName="stock-rebalancing.csv"
        pageSize={200}
        stickyFirstCol
        initialSort={null}
        columns={columns}
        rows={enrichedRows}
        footerRow={footerRow}
      />
    </div>
  );
};
