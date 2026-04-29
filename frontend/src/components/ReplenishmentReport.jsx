import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { Calendar as CalendarIcon } from "@phosphor-icons/react";

/**
 * Daily Replenishment Report — Exports tab.
 *
 * Columns: Owner · POS Location · Product Name · Size · Barcode · Bin ·
 * Units Sold · SOH WH · Replenish · Replenished. Defaults to YESTERDAY's
 * units sold; date picker lets the operator move the window back day-by-day.
 *
 * The backend endpoint takes 30–90 s on cold call (chunked /orders fan-out
 * + 6-month perf rank), then is cached per-day for 30 min.
 */

const fmtDateInput = (d) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const ReplenishmentReport = () => {
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return fmtDateInput(d);
  }, []);
  const [date, setDate] = useState(yesterday);
  const [data, setData] = useState({ rows: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    api
      .get("/analytics/replenishment-report", { params: { date }, timeout: 240000 })
      .then(({ data: d }) => {
        if (cancel) return;
        setData(d || { rows: [], summary: null });
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [date]);

  const rows = data.rows || [];
  const summary = data.summary;

  const columns = useMemo(() => [
    { key: "owner", label: "Owner", align: "left",
      render: (r) => <span className="pill-neutral">{r.owner}</span>, csv: (r) => r.owner },
    { key: "pos_location", label: "POS Location", align: "left" },
    { key: "product_name", label: `Product Name (${date})`, align: "left",
      render: (r) => <span className="break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{r.product_name}</span> },
    { key: "size", label: "Size", align: "left" },
    { key: "barcode", label: "Barcode", align: "left" },
    { key: "bin", label: "Bin", align: "left",
      render: (r) => r.bin ? <span className="pill-amber">{r.bin}</span> : <span className="text-muted text-[11px]">—</span>,
      csv: (r) => r.bin || "" },
    { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
    { key: "soh_wh", label: "SOH WH", numeric: true, render: (r) => fmtNum(r.soh_wh) },
    { key: "replenish", label: "Replenish", numeric: true,
      render: (r) => <span className="font-bold text-emerald-700">{fmtNum(r.replenish)}</span> },
    { key: "replenished", label: "Replenished", align: "left",
      render: () => <span className="text-muted text-[11px]">☐</span>, csv: () => "" },
  ], [date]);

  return (
    <div className="card-white p-5" data-testid="replenishment-report">
      <SectionTitle
        title="Daily Replenishment Report"
        subtitle={
          <span>
            For each POS where stock &lt; 2 we recommend a top-up to <b>2</b> units, drawn from
            warehouse finished-goods (only when WH stock &gt; 1). Stores are split across four
            owners with equal-or-near-equal pick volume. Bins resolved from the latest
            Stock-take sheet (H-bins excluded). Default window = <b>yesterday</b>.
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mt-3 mb-4">
        <label className="inline-flex items-center gap-2 text-[12px] font-semibold">
          <CalendarIcon size={14} weight="bold" className="text-brand" />
          Units sold on
          <input
            type="date"
            value={date}
            max={fmtDateInput(new Date())}
            onChange={(e) => setDate(e.target.value)}
            data-testid="replen-date"
            className="input-pill text-[12px] py-1.5 px-3"
          />
        </label>
        {summary && (
          <div className="flex flex-wrap gap-1.5 text-[11px]" data-testid="replen-summary">
            {summary.by_owner.map((o) => (
              <span key={o.owner} className="pill-green" data-testid={`replen-owner-${o.owner.toLowerCase()}`}>
                {o.owner}: <b>{fmtNum(o.units)}</b> units · {fmtNum(o.stores)} stores
              </span>
            ))}
            <span className="pill-neutral">
              Total: <b>{fmtNum(summary.total_units)}</b> units · {fmtNum(summary.total_rows)} rows
            </span>
          </div>
        )}
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        rows.length === 0 ? (
          <Empty label="No replenishment needed for the selected date — every POS has stock ≥ 2." />
        ) : (
          <SortableTable
            testId="replen-table"
            exportName={`replenishment-report_${date}.csv`}
            pageSize={50}
            mobileCards
            initialSort={{ key: "owner", dir: "asc" }}
            columns={columns}
            rows={rows}
          />
        )
      )}
    </div>
  );
};

export default ReplenishmentReport;
