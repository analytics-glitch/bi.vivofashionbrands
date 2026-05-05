import React, { useEffect, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

/**
 * 2026 annual targets vs YTD actuals + run-rate projection.
 * Two layouts: `compact` (Overview KPI strip) and `full` (CEO Report
 * deep-dive with per-quarter and per-channel breakdown).
 */
export default function AnnualTargetsCard({ variant = "compact", year = 2026 }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    api.get("/analytics/annual-targets", { params: { year } })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.detail || e.message); });
    return () => { cancelled = true; };
  }, [year]);

  if (err) {
    return (
      <div className="card-white p-4 text-[12px] text-rose-600" data-testid="annual-targets-error">
        Annual targets unavailable: {err}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card-white p-4 text-[12px] text-muted" data-testid="annual-targets-loading">
        Loading annual targets…
      </div>
    );
  }

  const { total, buckets, completion_pct, days_elapsed, days_total, as_of } = data;

  // Status colour: ahead = green, on-track = amber, behind = rose.
  const status = (pct) => {
    if (pct >= 100) return "text-emerald-600";
    if (pct >= 95) return "text-emerald-500";
    if (pct >= 85) return "text-amber-600";
    return "text-rose-600";
  };

  if (variant === "compact") {
    return (
      <div className="card-white p-5" data-testid="annual-targets-compact">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="eyebrow">Annual Target {year}</div>
            <div className="font-extrabold text-[20px] num mt-0.5">{fmtKES(total.target_annual)}</div>
          </div>
          <div className="text-right">
            <div className="eyebrow">YTD Actual</div>
            <div className={`font-extrabold text-[20px] num mt-0.5 ${status(total.pct_of_target_ytd / (completion_pct / 100 || 1))}`}>
              {fmtKES(total.actual_ytd)}
            </div>
            <div className="text-[11px] text-muted">{total.pct_of_target_ytd.toFixed(1)}% of annual · day {days_elapsed}/{days_total}</div>
          </div>
        </div>
        <ProgressBar pct={total.pct_of_target_ytd} pace={completion_pct} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          {buckets.map((b) => (
            <div key={b.bucket} className="rounded-lg border border-border p-2.5">
              <div className="text-[10px] font-bold uppercase text-muted truncate">{b.bucket}</div>
              <div className="font-bold text-[13px] num mt-0.5">{fmtKES(b.actual_ytd)}</div>
              <div className="text-[10px] text-muted">{b.pct_of_target_ytd.toFixed(1)}% of {fmtKES(b.target_annual)}</div>
              <ProgressBar pct={b.pct_of_target_ytd} pace={completion_pct} mini />
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-2 text-[11px] text-muted">
          <div>
            <span className="font-bold text-[12px] text-foreground">Projection:</span>{" "}
            <span className={`font-bold ${status(total.pct_of_target_projected)}`}>{fmtKES(total.projected_year)}</span>{" "}
            ({total.pct_of_target_projected.toFixed(1)}% of target,{" "}
            <span className={total.variance_projected >= 0 ? "text-emerald-600" : "text-rose-600"}>
              {total.variance_projected >= 0 ? "+" : ""}{fmtKES(total.variance_projected)}
            </span>)
          </div>
          <div>as of {as_of}</div>
        </div>
      </div>
    );
  }

  // Full variant — CEO Report.
  return (
    <div className="card-white p-5" data-testid="annual-targets-full">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="eyebrow">Annual Targets {year}</div>
          <div className="font-extrabold text-[26px] num mt-0.5">{fmtKES(total.target_annual)}</div>
          <div className="text-[12px] text-muted mt-1">
            Year {completion_pct.toFixed(1)}% complete · day {days_elapsed} of {days_total} · as of {as_of}
          </div>
        </div>
        <div className="text-right">
          <div className="eyebrow">Projection vs Target</div>
          <div className={`font-extrabold text-[26px] num mt-0.5 ${status(total.pct_of_target_projected)}`}>
            {total.pct_of_target_projected.toFixed(1)}%
          </div>
          <div className={`text-[12px] font-bold ${total.variance_projected >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {total.variance_projected >= 0 ? "+" : ""}{fmtKES(total.variance_projected)} vs target
          </div>
        </div>
      </div>

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi label="YTD Actual" value={fmtKES(total.actual_ytd)} sub={`${total.pct_of_target_ytd.toFixed(1)}% of annual target`} />
        <Kpi label="Pace (year %)" value={`${completion_pct.toFixed(1)}%`} sub={`Day ${days_elapsed} of ${days_total}`} />
        <Kpi label="Projected Year" value={fmtKES(total.projected_year)} sub={`Run-rate × remaining days`} status={status(total.pct_of_target_projected)} />
        <Kpi label="Gap to Target" value={fmtKES(Math.abs(total.variance_projected))} sub={total.variance_projected >= 0 ? "ahead of target" : "behind target"} status={total.variance_projected >= 0 ? "text-emerald-600" : "text-rose-600"} />
      </div>

      <ProgressBar pct={total.pct_of_target_ytd} pace={completion_pct} />

      {/* Per-channel breakdown */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-[12px]" data-testid="annual-targets-table">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="py-2 pr-3">Channel</th>
              <th className="py-2 pr-3 text-right">Annual Target</th>
              <th className="py-2 pr-3 text-right">YTD Actual</th>
              <th className="py-2 pr-3 text-right">% YTD</th>
              <th className="py-2 pr-3 text-right">Projected Year</th>
              <th className="py-2 pr-3 text-right">% Projected</th>
              <th className="py-2 pr-0 text-right">Gap</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.bucket} className="border-b border-border/40">
                <td className="py-2 pr-3 font-bold">{b.bucket}</td>
                <td className="py-2 pr-3 text-right num">{fmtKES(b.target_annual)}</td>
                <td className="py-2 pr-3 text-right num font-semibold">{fmtKES(b.actual_ytd)}</td>
                <td className={`py-2 pr-3 text-right num font-bold ${status(b.pct_of_target_ytd / (completion_pct / 100 || 1))}`}>
                  {b.pct_of_target_ytd.toFixed(1)}%
                </td>
                <td className="py-2 pr-3 text-right num">{fmtKES(b.projected_year)}</td>
                <td className={`py-2 pr-3 text-right num font-bold ${status(b.pct_of_target_projected)}`}>
                  {b.pct_of_target_projected.toFixed(1)}%
                </td>
                <td className={`py-2 pr-0 text-right num font-bold ${b.variance_projected >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {b.variance_projected >= 0 ? "+" : ""}{fmtKES(b.variance_projected)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border bg-muted/10 font-bold">
              <td className="py-2 pr-3">Total</td>
              <td className="py-2 pr-3 text-right num">{fmtKES(total.target_annual)}</td>
              <td className="py-2 pr-3 text-right num">{fmtKES(total.actual_ytd)}</td>
              <td className={`py-2 pr-3 text-right num ${status(total.pct_of_target_ytd / (completion_pct / 100 || 1))}`}>
                {total.pct_of_target_ytd.toFixed(1)}%
              </td>
              <td className="py-2 pr-3 text-right num">{fmtKES(total.projected_year)}</td>
              <td className={`py-2 pr-3 text-right num ${status(total.pct_of_target_projected)}`}>
                {total.pct_of_target_projected.toFixed(1)}%
              </td>
              <td className={`py-2 pr-0 text-right num ${total.variance_projected >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {total.variance_projected >= 0 ? "+" : ""}{fmtKES(total.variance_projected)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Quarterly breakdown */}
      <div className="mt-5">
        <div className="text-[11px] font-bold uppercase text-muted mb-2">Quarterly progress</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" data-testid="annual-targets-quarters">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="py-1 pr-3">Channel</th>
                {QUARTERS.map((q) => (
                  <th key={q} className="py-1 pr-3 text-right">{q} Target / Actual</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.bucket} className="border-b border-border/40">
                  <td className="py-1 pr-3 font-bold">{b.bucket}</td>
                  {QUARTERS.map((q) => {
                    const t = b.quarters[q] || 0;
                    const a = (b.actual_quarters || {})[q] || 0;
                    const pct = t ? a / t * 100 : 0;
                    return (
                      <td key={q} className="py-1 pr-3 text-right num">
                        <div className="text-[10.5px] text-muted">{fmtKES(t)}</div>
                        <div className={`font-bold ${a > 0 ? status(pct) : "text-muted"}`}>
                          {a > 0 ? `${fmtKES(a)} (${pct.toFixed(0)}%)` : "—"}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, status: statusClass }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="eyebrow">{label}</div>
      <div className={`font-extrabold text-[18px] num mt-0.5 ${statusClass || ""}`}>{value}</div>
      {sub && <div className="text-[10.5px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function ProgressBar({ pct, pace, mini }) {
  // Two-layer: filled bar (actual) + a vertical line at "pace" (year%).
  const w = Math.min(100, pct);
  const paceW = Math.min(100, pace);
  const ahead = pct >= pace;
  const fill = ahead ? "bg-emerald-500" : "bg-amber-500";
  return (
    <div className={`relative w-full ${mini ? "h-1.5" : "h-3"} rounded-full bg-muted/30 overflow-hidden`}>
      <div className={`absolute left-0 top-0 bottom-0 ${fill}`} style={{ width: `${w}%` }} />
      <div
        className="absolute top-0 bottom-0 w-[2px] bg-foreground/60"
        style={{ left: `${paceW}%` }}
        title={`Year pace: ${pace.toFixed(1)}%`}
      />
    </div>
  );
}
