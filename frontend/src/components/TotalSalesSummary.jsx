import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES } from "@/lib/api";
import { Loading } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { Table } from "@phosphor-icons/react";

/**
 * Total Sales Summary table — one row per store, columns:
 *   Store | MTD | Projection | Target | May 2025 | April 2026 | %On/Off |
 *   Var May'26 vs April'26 | Var May'26 vs May'25
 */

const fmtPct = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

function colourPct(v) {
  if (v == null) return "";
  if (v >= 5) return "text-emerald-700 font-bold";
  if (v >= -5) return "text-amber-700";
  return "text-rose-700 font-bold";
}

function monthLabel(d) {
  // d is a YYYY-MM-01 string. Returns "May 2026" etc.
  if (!d) return "";
  const [y, m] = d.split("-");
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

function priorMonth(d) {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  return dt.toISOString().slice(0, 10);
}

function priorYear(d) {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCFullYear(dt.getUTCFullYear() - 1);
  return dt.toISOString().slice(0, 10);
}

export default function TotalSalesSummary({ month }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get("/analytics/total-sales-summary", { params: { month }, timeout: 60000 })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.detail || e.message || "Failed to load");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month]);

  // Build totals row.
  const rowsWithTotal = useMemo(() => {
    if (!data?.rows?.length) return [];
    const rows = [...data.rows];
    const tot = rows.reduce((a, r) => ({
      mtd_actual: a.mtd_actual + r.mtd_actual,
      projected_landing: a.projected_landing + r.projected_landing,
      sales_target: a.sales_target + r.sales_target,
      prior_year_full_month: a.prior_year_full_month + (r.prior_year_full_month || 0),
      prior_month_full: a.prior_month_full + (r.prior_month_full || 0),
      prior_year_same_window: a.prior_year_same_window + (r.prior_year_same_window || 0),
      prior_month_same_window: a.prior_month_same_window + (r.prior_month_same_window || 0),
    }), {
      mtd_actual: 0, projected_landing: 0, sales_target: 0,
      prior_year_full_month: 0, prior_month_full: 0,
      prior_year_same_window: 0, prior_month_same_window: 0,
    });
    const totalRow = {
      channel: "TOTAL",
      ...tot,
      pct_of_target_projected: tot.sales_target ? (tot.projected_landing / tot.sales_target * 100) : null,
      mom_variance_pct: tot.prior_month_same_window ? ((tot.mtd_actual - tot.prior_month_same_window) / tot.prior_month_same_window * 100) : null,
      yoy_variance_pct: tot.prior_year_same_window ? ((tot.mtd_actual - tot.prior_year_same_window) / tot.prior_year_same_window * 100) : null,
      _isTotal: true,
    };
    return [...rows, totalRow];
  }, [data]);

  if (loading) return <Loading label="Loading sales summary…" />;
  if (error) return <div className="card-white p-4 text-rose-600 text-[12px]">{error}</div>;
  if (!data?.rows?.length) return <div className="card-white p-4 text-muted text-[12px]">No data.</div>;

  const curr = monthLabel(data.month);
  const prevM = monthLabel(priorMonth(data.month));
  const prevY = monthLabel(priorYear(data.month));

  const columns = [
    { key: "channel", label: "Store", align: "left", sortable: true,
      render: (r) => <span className={r._isTotal ? "font-extrabold text-[#0f3d24]" : "font-medium"}>{r.channel}</span>,
      csv: (r) => r.channel },
    { key: "mtd_actual", label: `${curr} MTD`, align: "right", sortable: true,
      render: (r) => <span className="tabular-nums">{fmtKES(r.mtd_actual)}</span>,
      csv: (r) => r.mtd_actual },
    { key: "projected_landing", label: `${curr} Projection`, align: "right", sortable: true,
      render: (r) => <span className="tabular-nums font-semibold">{fmtKES(r.projected_landing)}</span>,
      csv: (r) => r.projected_landing },
    { key: "sales_target", label: `${curr} Target`, align: "right", sortable: true,
      render: (r) => <span className="tabular-nums">{fmtKES(r.sales_target)}</span>,
      csv: (r) => r.sales_target },
    { key: "prior_year_full_month", label: `${prevY} Actual`, align: "right", sortable: true,
      render: (r) => <span className="tabular-nums text-muted">{fmtKES(r.prior_year_full_month || 0)}</span>,
      csv: (r) => r.prior_year_full_month || 0 },
    { key: "prior_month_full", label: `${prevM} Actual`, align: "right", sortable: true,
      render: (r) => <span className="tabular-nums text-muted">{fmtKES(r.prior_month_full || 0)}</span>,
      csv: (r) => r.prior_month_full || 0 },
    { key: "pct_of_target_projected", label: "% On/Off Target", align: "right", sortable: true,
      render: (r) => {
        const v = r.pct_of_target_projected;
        if (v == null) return <span className="text-muted">—</span>;
        const delta = v - 100;
        const cls = delta >= 0 ? "text-emerald-700 font-bold" : delta >= -15 ? "text-amber-700 font-bold" : "text-rose-700 font-bold";
        return <span className={`tabular-nums ${cls}`}>{v.toFixed(1)}% ({delta >= 0 ? "+" : ""}{delta.toFixed(1)}pp)</span>;
      },
      csv: (r) => r.pct_of_target_projected ?? "" },
    { key: "mom_variance_pct", label: `${curr} vs ${prevM}`, align: "right", sortable: true,
      render: (r) => <span className={`tabular-nums ${colourPct(r.mom_variance_pct)}`}>{fmtPct(r.mom_variance_pct)}</span>,
      csv: (r) => r.mom_variance_pct ?? "" },
    { key: "yoy_variance_pct", label: `${curr} vs ${prevY}`, align: "right", sortable: true,
      render: (r) => <span className={`tabular-nums ${colourPct(r.yoy_variance_pct)}`}>{fmtPct(r.yoy_variance_pct)}</span>,
      csv: (r) => r.yoy_variance_pct ?? "" },
  ];

  return (
    <div className="card-white p-5" data-testid="total-sales-summary">
      <div className="flex items-center gap-2 mb-3">
        <Table size={18} weight="duotone" className="text-[#1a5c38]" />
        <h3 className="text-[15px] font-extrabold text-[#0f3d24]">Total Sales Summary</h3>
        <span className="text-[10.5px] font-bold uppercase tracking-wide bg-[#fed7aa] text-[#7c2d12] px-1.5 py-0.5 rounded-full">{curr}</span>
        <span className="text-[11px] text-muted">
          · {data.days_complete}/{data.days_in_month} days · MoM &amp; YoY use a like-for-like {data.days_complete}-day window
        </span>
      </div>
      <SortableTable
        data-testid="total-sales-summary-table"
        rows={rowsWithTotal}
        columns={columns}
        defaultSort={{ key: "mtd_actual", dir: "desc" }}
        exportName={`total-sales-summary_${data.month}.csv`}
      />
    </div>
  );
}
