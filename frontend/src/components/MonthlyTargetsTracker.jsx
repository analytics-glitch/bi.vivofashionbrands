import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { Loading } from "@/components/common";
import { CaretDown, CaretRight, ChartLine } from "@phosphor-icons/react";

/**
 * Per-store daily target tracker — Sarit-style table per store.
 *
 * One collapsible row per store with monthly summary; expand to reveal
 * the day-by-day Date / Day / Ratio / Daily Budget / Actual / Variance
 * % / Ksh Variance (Daily) / Ksh Variance (Cumulative) table. Future
 * dates are grayed out (no actual yet).
 */

function fmtSignedKES(v) {
  if (v == null) return "—";
  if (v < 0) return `(KES ${Math.abs(v).toLocaleString("en-KE", { maximumFractionDigits: 0 })})`;
  return `KES ${Math.round(v).toLocaleString("en-KE")}`;
}

function StoreCard({ store }) {
  const [open, setOpen] = useState(false);
  const target = store.sales_target;
  const projected = store.projected_landing;
  const proj_pct = store.pct_of_target_projected;
  const onPace = proj_pct >= 100;
  const ringColor = onPace ? "#00c853" : proj_pct >= 70 ? "#d97706" : "#dc2626";

  return (
    <div className="card-white p-0 overflow-hidden" data-testid={`monthly-store-${store.channel}`}>
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-3 cursor-pointer hover:bg-panel/50 border-b border-border"
        onClick={() => setOpen(!open)}
      >
        {open ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
        <div className="font-bold text-[14px] flex-1 min-w-[180px]">{store.channel}</div>
        <div className="text-[11px] flex flex-wrap gap-x-4 gap-y-1">
          <Stat label="Monthly target" value={fmtKES(target)} />
          <Stat label="MTD actual" value={fmtKES(store.mtd_actual)} />
          <Stat label="MTD target" value={fmtKES(store.mtd_target)} />
          <Stat label="Projected" value={fmtKES(projected)} valueClass={`font-bold ${onPace ? "text-[#00c853]" : proj_pct >= 70 ? "text-[#d97706]" : "text-[#dc2626]"}`} />
          <Stat label="% of target" value={`${proj_pct.toFixed(1)}%`} valueClass={`font-bold`} valueColor={ringColor} />
          <Stat label="Variance MTD" value={fmtSignedKES(store.ksh_variance_total)}
                valueClass={store.ksh_variance_total >= 0 ? "text-[#00c853]" : "text-[#dc2626]"} />
          <Stat label="Days" value={`${store.days_complete}/${store.days_in_month}`} />
          {store.avg_suggested_remaining != null && store.days_remaining > 0 && (
            <Stat
              label="Need / day"
              value={fmtKES(store.avg_suggested_remaining)}
              valueClass={`font-bold ${store.gap_to_target > 0 ? "text-[#dc2626]" : "text-[#166534]"}`}
            />
          )}
          {store.asp > 0 && (
            <Stat label="ASP" value={fmtKES(store.asp)} valueClass="text-[#0f3d24]" />
          )}
          {store.basket_kes > 0 && (
            <Stat label="Avg basket" value={fmtKES(store.basket_kes)} valueClass="text-[#0f3d24]" />
          )}
        </div>
      </div>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" data-testid={`monthly-daily-table-${store.channel}`}>
            <thead>
              <tr className="bg-[#fde7c5] text-[#5b3a00]">
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Day</th>
                <th className="text-right px-3 py-2">Ratio</th>
                <th className="text-right px-3 py-2">Daily Budget</th>
                <th
                  className="text-right px-3 py-2 bg-amber-200/70"
                  title="What you need to do per day on remaining days to still hit the monthly target — re-weighted by the day-of-week pattern."
                >
                  Suggested Daily Need
                </th>
                <th
                  className="text-right px-3 py-2 bg-amber-100/70"
                  title="Suggested Daily Need ÷ store ASP — units to sell that day to land the target."
                >
                  Suggested Quantity
                </th>
                <th
                  className="text-right px-3 py-2 bg-amber-100/70"
                  title="Suggested Daily Need ÷ store's daily-orders pace — avg basket KES each transaction needs to be."
                >
                  Suggested Basket Size
                </th>
                <th className="text-right px-3 py-2">Actual</th>
                <th className="text-right px-3 py-2">Variance %</th>
                <th className="text-right px-3 py-2">Ksh variance (Daily)</th>
                <th className="text-right px-3 py-2">Ksh variance (Cumulative)</th>
              </tr>
            </thead>
            <tbody>
              {store.daily.map((r) => {
                const future = r.is_future;
                const today = r.is_today;
                const negVar = (r.variance_pct ?? 0) < 0 && !future;
                const veryBad = (r.variance_pct ?? 0) < -25 && !future;
                return (
                  <tr key={r.date} className={`border-b border-border/40 ${today ? "bg-amber-100/50" : future ? "text-muted/60" : ""}`}>
                    <td className="px-3 py-1.5 tabular-nums">{r.date}</td>
                    <td className="px-3 py-1.5">{r.day_of_week}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.ratio.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[#dc2626]">
                      {fmtKES(r.daily_target)}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${
                      future
                        ? r.suggested_daily_target > r.daily_target * 1.5
                          ? "bg-rose-200 text-rose-900 font-bold"
                          : r.suggested_daily_target > r.daily_target
                            ? "bg-amber-100 text-amber-900 font-semibold"
                            : "bg-emerald-50 text-emerald-900 font-semibold"
                        : "text-muted/60"
                    }`}>
                      {future && r.suggested_daily_target != null ? fmtKES(r.suggested_daily_target) : "—"}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${future ? "" : "text-muted/60"}`}>
                      {future && r.suggested_daily_quantity != null ? fmtNum(r.suggested_daily_quantity) : "—"}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${future ? "" : "text-muted/60"}`}>
                      {future && r.suggested_basket_size != null ? fmtKES(r.suggested_basket_size) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {future ? <span className="text-muted/60">—</span> : fmtKES(r.actual)}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${
                      future ? "" : veryBad ? "bg-rose-500 text-white" : negVar ? "bg-rose-200 text-rose-900" : "bg-emerald-100 text-emerald-900"
                    }`}>
                      {future ? "—" : `${r.variance_pct >= 0 ? "+" : ""}${r.variance_pct.toFixed(0)}%`}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${
                      future ? "text-muted/60" : (r.ksh_variance ?? 0) < 0 ? "text-[#9f1239]" : "text-[#166534]"
                    }`}>
                      {future ? "—" : fmtSignedKES(r.ksh_variance)}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${
                      future ? "text-muted/60" : (r.ksh_variance_cumulative ?? 0) < 0 ? "text-[#9f1239]" : "text-[#166534]"
                    }`}>
                      {future ? "—" : fmtSignedKES(r.ksh_variance_cumulative)}
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
}

function Stat({ label, value, valueClass = "", valueColor }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted">{label}:</span>
      <span className={`tabular-nums ${valueClass}`} style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}

export default function MonthlyTargetsTracker({ month }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get("/analytics/monthly-targets", { params: { month }, timeout: 240000 })
      .then((r) => { if (!cancelled) setData(r.data); })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.detail || e.message || "Failed to load");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month]);

  if (loading) return <div data-testid="monthly-targets-tracker"><Loading label="Loading monthly targets…" /></div>;
  if (error) return <div className="card-white p-4 text-rose-600 text-[12px]" data-testid="monthly-targets-tracker">{error}</div>;
  if (!data?.stores?.length) return <div className="card-white p-4 text-muted text-[12px]" data-testid="monthly-targets-tracker">No monthly targets configured for {month}.</div>;

  return (
    <div className="space-y-3" data-testid="monthly-targets-tracker">
      <div className="flex items-center gap-2 mb-1">
        <ChartLine size={18} weight="duotone" className="text-[#1a5c38]" />
        <h3 className="text-[15px] font-extrabold text-[#0f3d24]">Monthly Sales Target Tracker</h3>
        <span className="text-[10.5px] font-bold uppercase tracking-wide bg-[#fed7aa] text-[#7c2d12] px-1.5 py-0.5 rounded-full">{data.month}</span>
        <span className="text-[11px] text-muted">· daily budgets weighted by 6-month DOW sales pattern · click any store to expand</span>
      </div>
      {data.stores.map((s) => (
        <StoreCard key={s.channel} store={s} />
      ))}
    </div>
  );
}
