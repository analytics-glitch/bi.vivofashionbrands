import React, { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { api, fmtKES } from "@/lib/api";
import { Loading } from "@/components/common";
import { Table, DownloadSimple, FileCsv } from "@phosphor-icons/react";

/**
 * Total Sales Summary — PDF-style monthly snapshot.
 *
 * One row per store, grouped into:
 *   • Kenya retail stores  → TOTAL RETAIL KENYA subtotal
 *   • Other regions (Rwanda, Uganda)
 *   • Kenya online channels (Online Shop Zetu, Online Safari, Studio…)
 *   • Other (HQ outlet, Fabric printing, Wholesale)
 *   • TOTAL BUSINESS REVENUE grand total
 *
 * Columns (matches the customer's daily PDF):
 *   STORE | MTD | Projection | Target | Apr '25 | Mar '26 |
 *   % On/Off Target | Var vs Mar '26 | Var vs Apr '25
 *
 * "% On/Off Target" = (MTD - Target) / Target × 100 (negative = below target).
 * Variance columns use a like-for-like window for fair mid-month comparison
 * (May 1–12 MTD compared to April 1–12 / May 2025 1–12).
 *
 * Two export buttons:
 *   • CSV — full machine-readable export
 *   • PNG — html2canvas snapshot of the styled table for daily WhatsApp/email blasts
 */

const fmtPct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

const monthLabel = (d) => {
  if (!d) return "";
  const [y, m] = d.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m, 10) - 1]} '${y.slice(2)}`;
};

const monthLabelLong = (d) => {
  if (!d) return "";
  const [y, m] = d.split("-");
  const months = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
};

const priorMonth = (d) => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth() - 1);
  return dt.toISOString().slice(0, 10);
};

const priorYear = (d) => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCFullYear(dt.getUTCFullYear() - 1);
  return dt.toISOString().slice(0, 10);
};

// PDF colours.
const C_HEADER_BG = "#374151";        // dark gray
const C_HEADER_FG = "#ffffff";
const C_TOTAL_BG = "#d1fae5";         // light green
const C_TOTAL_FG = "#0f3d24";
const C_NEG = "#b91c1c";              // red text
const C_POS = "#15803d";              // green text
const C_NEUTRAL = "#111827";

// Render order for the row groups so the PDF flow matches the customer's report.
const GROUP_ORDER = ["kenya_retail", "rwanda", "uganda", "kenya_online", "other"];

const GROUP_LABELS = {
  kenya_retail: "TOTAL RETAIL KENYA",
  rwanda: "TOTAL RWANDA",
  uganda: "TOTAL UGANDA",
  kenya_online: "TOTAL ONLINE",
  other: "TOTAL OTHER",
};

function aggregate(rows) {
  return rows.reduce(
    (a, r) => ({
      mtd_actual: a.mtd_actual + (r.mtd_actual || 0),
      projected_landing: a.projected_landing + (r.projected_landing || 0),
      sales_target: a.sales_target + (r.sales_target || 0),
      prior_year_full_month: a.prior_year_full_month + (r.prior_year_full_month || 0),
      prior_month_full: a.prior_month_full + (r.prior_month_full || 0),
      prior_year_same_window: a.prior_year_same_window + (r.prior_year_same_window || 0),
      prior_month_same_window: a.prior_month_same_window + (r.prior_month_same_window || 0),
    }),
    {
      mtd_actual: 0, projected_landing: 0, sales_target: 0,
      prior_year_full_month: 0, prior_month_full: 0,
      prior_year_same_window: 0, prior_month_same_window: 0,
    }
  );
}

function withDerived(t) {
  const pct_off_target = t.sales_target ? ((t.mtd_actual - t.sales_target) / t.sales_target) * 100 : null;
  const mom = t.prior_month_same_window ? ((t.mtd_actual - t.prior_month_same_window) / t.prior_month_same_window) * 100 : null;
  const yoy = t.prior_year_same_window ? ((t.mtd_actual - t.prior_year_same_window) / t.prior_year_same_window) * 100 : null;
  return { ...t, pct_off_target, mom_variance_pct: mom, yoy_variance_pct: yoy };
}

const CELL_PAD = "py-1.5 px-2";

function StoreRow({ r, curr, prevM, prevY, testId }) {
  const off = r.pct_of_target_projected != null ? r.pct_of_target_projected - 100 : null;
  return (
    <tr className="border-b border-gray-200 hover:bg-amber-50/40" data-testid={testId}>
      <td className={`${CELL_PAD} text-left font-medium uppercase tracking-tight`} style={{ color: C_NEUTRAL }}>
        {r.display_name || r.channel}
      </td>
      <NumCell v={r.mtd_actual} bold />
      <NumCell v={r.projected_landing} />
      <NumCell v={r.sales_target} />
      <NumCell v={r.prior_year_full_month || 0} muted />
      <NumCell v={r.prior_month_full || 0} muted />
      <PctCell v={off} positiveColor={C_POS} negativeColor={C_NEG} />
      <PctCell v={r.mom_variance_pct} positiveColor={C_NEUTRAL} negativeColor={C_NEG} />
      <PctCell v={r.yoy_variance_pct} positiveColor={C_POS} negativeColor={C_NEG} />
    </tr>
  );
}

function TotalRow({ label, agg, isGrand, testId }) {
  const off = agg.sales_target ? ((agg.mtd_actual - agg.sales_target) / agg.sales_target) * 100 : null;
  return (
    <tr
      className="font-extrabold"
      style={{ background: C_TOTAL_BG, color: C_TOTAL_FG }}
      data-testid={testId}
    >
      <td className={`${CELL_PAD} text-left uppercase tracking-tight ${isGrand ? "text-[13px]" : "text-[12px]"}`}>
        {label}
      </td>
      <NumCell v={agg.mtd_actual} bold solid />
      <NumCell v={agg.projected_landing} solid />
      <NumCell v={agg.sales_target} solid />
      <NumCell v={agg.prior_year_full_month || 0} solid />
      <NumCell v={agg.prior_month_full || 0} solid />
      <PctCell v={off} positiveColor={C_POS} negativeColor={C_NEG} bold />
      <PctCell v={agg.mom_variance_pct} positiveColor={C_NEUTRAL} negativeColor={C_NEG} bold />
      <PctCell v={agg.yoy_variance_pct} positiveColor={C_POS} negativeColor={C_NEG} bold />
    </tr>
  );
}

function NumCell({ v, muted, bold, solid }) {
  const cls = `${CELL_PAD} text-right tabular-nums ${bold ? "font-bold" : ""} ${muted && !solid ? "text-gray-500" : ""}`;
  return <td className={cls}>{fmtKES(v || 0)}</td>;
}

function PctCell({ v, positiveColor, negativeColor, bold }) {
  if (v == null) return <td className={`${CELL_PAD} text-right text-gray-400`}>—</td>;
  const color = v >= 0 ? positiveColor : negativeColor;
  return (
    <td
      className={`${CELL_PAD} text-right tabular-nums ${bold ? "font-bold" : "font-semibold"}`}
      style={{ color }}
    >
      {fmtPct(v)}
    </td>
  );
}

export default function TotalSalesSummary({ month }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const tableRef = useRef(null);

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

  const { sections, grandTotal, kenyaSubtotal } = useMemo(() => {
    if (!data?.rows?.length) return { sections: [], grandTotal: null, kenyaSubtotal: null };
    const byGroup = {};
    data.rows.forEach((r) => {
      const g = r.group || "other";
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(r);
    });
    Object.values(byGroup).forEach((arr) =>
      arr.sort((a, b) => (b.mtd_actual || 0) - (a.mtd_actual || 0))
    );
    const _sections = [];
    GROUP_ORDER.forEach((g) => {
      if (byGroup[g] && byGroup[g].length) {
        _sections.push({
          key: g,
          label: GROUP_LABELS[g],
          rows: byGroup[g],
          totals: withDerived(aggregate(byGroup[g])),
        });
      }
    });
    const grand = withDerived(aggregate(data.rows));
    const kenyaOnly = byGroup["kenya_retail"] || [];
    const kenyaSub = kenyaOnly.length ? withDerived(aggregate(kenyaOnly)) : null;
    return { sections: _sections, grandTotal: grand, kenyaSubtotal: kenyaSub };
  }, [data]);

  const doDownloadCsv = () => {
    if (!data?.rows?.length) return;
    const curr = monthLabel(data.month);
    const prevM = monthLabel(priorMonth(data.month));
    const prevY = monthLabel(priorYear(data.month));
    const header = [
      "STORE", "GROUP",
      `${curr} MTD`, `${curr} Projection`, `${curr} Target`,
      `${prevY} Actual`, `${prevM} Actual`,
      "% On/Off Target", `Var ${curr} vs ${prevM}`, `Var ${curr} vs ${prevY}`,
    ];
    const lines = [header.join(",")];
    sections.forEach((sec) => {
      sec.rows.forEach((r) => {
        const off = r.pct_of_target_projected != null ? r.pct_of_target_projected - 100 : null;
        lines.push([
          `"${(r.display_name || r.channel).replace(/"/g, '""')}"`,
          sec.key,
          r.mtd_actual, r.projected_landing, r.sales_target,
          r.prior_year_full_month || 0, r.prior_month_full || 0,
          off?.toFixed(2) || "", r.mom_variance_pct?.toFixed(2) || "", r.yoy_variance_pct?.toFixed(2) || "",
        ].join(","));
      });
    });
    if (kenyaSubtotal) {
      const off = kenyaSubtotal.sales_target
        ? ((kenyaSubtotal.mtd_actual - kenyaSubtotal.sales_target) / kenyaSubtotal.sales_target) * 100
        : null;
      lines.push([
        '"TOTAL RETAIL KENYA"', "subtotal",
        kenyaSubtotal.mtd_actual, kenyaSubtotal.projected_landing, kenyaSubtotal.sales_target,
        kenyaSubtotal.prior_year_full_month, kenyaSubtotal.prior_month_full,
        off?.toFixed(2) || "", kenyaSubtotal.mom_variance_pct?.toFixed(2) || "", kenyaSubtotal.yoy_variance_pct?.toFixed(2) || "",
      ].join(","));
    }
    if (grandTotal) {
      const off = grandTotal.sales_target
        ? ((grandTotal.mtd_actual - grandTotal.sales_target) / grandTotal.sales_target) * 100
        : null;
      lines.push([
        '"TOTAL BUSINESS REVENUE"', "total",
        grandTotal.mtd_actual, grandTotal.projected_landing, grandTotal.sales_target,
        grandTotal.prior_year_full_month, grandTotal.prior_month_full,
        off?.toFixed(2) || "", grandTotal.mom_variance_pct?.toFixed(2) || "", grandTotal.yoy_variance_pct?.toFixed(2) || "",
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `total-sales-summary_${data.month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  const doDownloadPng = async () => {
    if (!tableRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(tableRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `sales-summary_${data?.month || "report"}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
      }, "image/png");
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <Loading label="Loading sales summary…" />;
  if (error) return <div className="card-white p-4 text-rose-600 text-[12px]">{error}</div>;
  if (!data?.rows?.length) return <div className="card-white p-4 text-muted text-[12px]">No data.</div>;

  const curr = monthLabel(data.month);
  const currLong = monthLabelLong(data.month);
  const prevM = monthLabel(priorMonth(data.month));
  const prevY = monthLabel(priorYear(data.month));

  return (
    <div className="card-white p-5" data-testid="total-sales-summary">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Table size={18} weight="duotone" className="text-[#1a5c38]" />
        <h3 className="text-[15px] font-extrabold text-[#0f3d24]">Total Sales Summary</h3>
        <span className="text-[10.5px] font-bold uppercase tracking-wide bg-[#fed7aa] text-[#7c2d12] px-1.5 py-0.5 rounded-full">
          {currLong}
        </span>
        <span className="text-[11px] text-muted">
          · {data.days_complete}/{data.days_in_month} days · variances use a like-for-like {data.days_complete}-day window
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={doDownloadCsv}
            data-testid="sales-summary-download-csv"
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-brand-deep border border-brand-deep/30 hover:bg-brand-deep/5 px-2.5 py-1.5 rounded-md"
            title="Download as CSV"
          >
            <FileCsv size={14} /> CSV
          </button>
          <button
            type="button"
            onClick={doDownloadPng}
            disabled={exporting}
            data-testid="sales-summary-download-png"
            className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white bg-[#1a5c38] hover:bg-[#0f3d24] px-2.5 py-1.5 rounded-md disabled:opacity-50"
            title="Download as PNG image — perfect for daily WhatsApp / email blasts"
          >
            <DownloadSimple size={14} /> {exporting ? "Capturing…" : "Download PNG"}
          </button>
        </div>
      </div>

      {/* Wrapped in a div so html2canvas can snapshot it cleanly. */}
      <div ref={tableRef} className="overflow-x-auto bg-white p-4 rounded-lg border border-gray-200">
        <div className="mb-3">
          <div className="text-[15px] font-extrabold text-[#0f3d24] uppercase tracking-tight">
            Sales Summary as at {currLong}
          </div>
          <div className="text-[10.5px] text-gray-600 mt-0.5">
            Day {data.days_complete} of {data.days_in_month} · Variance columns use a like-for-like {data.days_complete}-day window
          </div>
        </div>
        <table className="w-full text-[11.5px] border-collapse" data-testid="total-sales-summary-table">
          <thead>
            <tr style={{ background: C_HEADER_BG, color: C_HEADER_FG }} className="text-[10.5px] uppercase tracking-tight">
              <th className={`${CELL_PAD} text-left font-bold border-r border-gray-700`}>Store</th>
              <th className={`${CELL_PAD} text-right font-bold`}>{curr} Sales — MTD</th>
              <th className={`${CELL_PAD} text-right font-bold`}>{curr} Projection</th>
              <th className={`${CELL_PAD} text-right font-bold`}>{curr} Target</th>
              <th className={`${CELL_PAD} text-right font-bold`}>{prevY} Actual</th>
              <th className={`${CELL_PAD} text-right font-bold`}>{prevM} Actual</th>
              <th className={`${CELL_PAD} text-right font-bold`}>% On/Off Target</th>
              <th className={`${CELL_PAD} text-right font-bold`}>Var {curr} vs {prevM}</th>
              <th className={`${CELL_PAD} text-right font-bold`}>Var {curr} vs {prevY}</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((sec, idx) => (
              <React.Fragment key={sec.key}>
                {sec.rows.map((r) => (
                  <StoreRow
                    key={r.channel}
                    r={r}
                    curr={curr} prevM={prevM} prevY={prevY}
                    testId={`sales-row-${(r.display_name || r.channel).toLowerCase().replace(/\s+/g, "-")}`}
                  />
                ))}
                {/* Subtotal — only render TOTAL RETAIL KENYA inline (per the
                    PDF). Other groups roll straight into TOTAL BUSINESS
                    REVENUE without an interim subtotal row. */}
                {sec.key === "kenya_retail" && kenyaSubtotal && (
                  <TotalRow label="TOTAL RETAIL KENYA" agg={kenyaSubtotal} testId="sales-row-total-kenya" />
                )}
              </React.Fragment>
            ))}
            {grandTotal && (
              <TotalRow label="TOTAL BUSINESS REVENUE" agg={grandTotal} isGrand testId="sales-row-total-business" />
            )}
          </tbody>
        </table>
        <div className="mt-2 text-[9.5px] text-gray-500 italic">
          Generated from the Vivo BI dashboard · {currLong} · Day {data.days_complete}/{data.days_in_month}
        </div>
      </div>
    </div>
  );
}
