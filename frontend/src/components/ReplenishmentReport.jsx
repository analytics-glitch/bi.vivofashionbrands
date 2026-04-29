import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { Calendar as CalendarIcon, CheckSquare, Square } from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * Daily Replenishment Report — Exports tab.
 *
 * Columns: Owner · POS Location · Product Name · Size · Barcode · Bin ·
 * Units Sold · SOH WH · Replenish · Replenished. Defaults to YESTERDAY's
 * units sold; date range picker lets the operator widen the window.
 *
 * Each row carries a `replenished` checkbox that persists per-window to
 * MongoDB so each owner's progress is shared across users without losing
 * state on refresh.
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
  const [dateFrom, setDateFrom] = useState(yesterday);
  const [dateTo, setDateTo] = useState(yesterday);
  const [data, setData] = useState({ rows: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Local map keyed on `${pos}|${barcode}` so toggles render instantly while
  // the network call is in flight (optimistic UI).
  const [marked, setMarked] = useState({});

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    api
      .get("/analytics/replenishment-report", {
        params: { date_from: dateFrom, date_to: dateTo },
        timeout: 240000,
      })
      .then(({ data: d }) => {
        if (cancel) return;
        const rows = d?.rows || [];
        setData(d || { rows: [], summary: null });
        // Seed the local map from the server overlay so a fresh load shows
        // the persisted state immediately.
        const m = {};
        for (const r of rows) m[`${r.pos_location}|${r.barcode}`] = !!r.replenished;
        setMarked(m);
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [dateFrom, dateTo]);

  const toggleMark = async (row) => {
    const key = `${row.pos_location}|${row.barcode}`;
    const next = !marked[key];
    // Optimistic flip — revert on error.
    setMarked((m) => ({ ...m, [key]: next }));
    try {
      await api.post("/analytics/replenishment-report/mark", {
        date_from: dateFrom,
        date_to: dateTo,
        pos_location: row.pos_location,
        barcode: row.barcode,
        replenished: next,
      });
    } catch (e) {
      setMarked((m) => ({ ...m, [key]: !next }));
      toast.error("Couldn't save — " + (e?.response?.data?.detail || e.message));
    }
  };

  const rows = data.rows || [];
  const summary = data.summary;
  const completed = useMemo(
    () => Object.values(marked).filter(Boolean).length,
    [marked]
  );

  const dateLabel = dateFrom === dateTo
    ? dateFrom
    : `${dateFrom} → ${dateTo}`;

  const columns = useMemo(() => [
    { key: "owner", label: "Owner", align: "left",
      render: (r) => <span className="pill-neutral">{r.owner}</span>, csv: (r) => r.owner },
    { key: "pos_location", label: "POS Location", align: "left" },
    { key: "product_name", label: `Product Name (${dateLabel})`, align: "left",
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
    { key: "replenished", label: "Replenished", align: "left", sortable: false,
      sortValue: (r) => (marked[`${r.pos_location}|${r.barcode}`] ? 1 : 0),
      render: (r) => {
        const k = `${r.pos_location}|${r.barcode}`;
        const on = !!marked[k];
        return (
          <button
            type="button"
            onClick={() => toggleMark(r)}
            data-testid={`replen-mark-${r.barcode}-${r.pos_location.replace(/\s+/g, '-')}`}
            data-replenished={on ? "true" : "false"}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-semibold transition-colors ${
              on
                ? "bg-emerald-600 text-white border border-emerald-700"
                : "bg-white border border-border hover:border-brand/60 text-muted"
            }`}
            aria-label={on ? "Mark as not replenished" : "Mark as replenished"}
          >
            {on ? <CheckSquare size={13} weight="fill" /> : <Square size={13} weight="bold" />}
            {on ? "Done" : "Mark"}
          </button>
        );
      },
      csv: (r) => marked[`${r.pos_location}|${r.barcode}`] ? "Yes" : "No",
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [dateLabel, marked]);

  return (
    <div className="card-white p-5" data-testid="replenishment-report">
      <SectionTitle
        title="Daily Replenishment Report"
        subtitle={
          <span>
            For each POS where stock &lt; 2 AND units sold &gt; 1 in the window we recommend
            a top-up to <b>2</b> units per SKU, drawn from warehouse finished-goods (only
            when WH stock &gt; 1). <b>Online channels are excluded.</b> Lines are
            distributed across four owners with equal-or-near-equal pick volume — a
            single store can be co-owned by multiple operators when needed. Bins
            resolved from the latest Stock-take sheet (H-bins excluded). Default window
            = <b>yesterday</b>. Tap <b>Mark</b> to record a pick — state persists across
            users and refreshes.
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mt-3 mb-4">
        <label className="inline-flex items-center gap-2 text-[12px] font-semibold">
          <CalendarIcon size={14} weight="bold" className="text-brand" />
          From
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={(e) => setDateFrom(e.target.value)}
            data-testid="replen-date-from"
            className="input-pill text-[12px] py-1.5 px-3"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-[12px] font-semibold">
          To
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            max={fmtDateInput(new Date())}
            onChange={(e) => setDateTo(e.target.value)}
            data-testid="replen-date-to"
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
            <span
              className={completed === summary.total_rows && summary.total_rows > 0 ? "pill-green" : "pill-amber"}
              data-testid="replen-completed-pill"
            >
              ✓ {fmtNum(completed)}/{fmtNum(summary.total_rows)} replenished
            </span>
          </div>
        )}
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        rows.length === 0 ? (
          <Empty label="Nothing to replenish — no in-store SKU sold > 1 unit with stock < 2 in this window (online excluded)." />
        ) : (
          <SortableTable
            testId="replen-table"
            exportName={`replenishment-report_${dateFrom}_to_${dateTo}.csv`}
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
