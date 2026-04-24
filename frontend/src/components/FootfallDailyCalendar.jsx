import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { Loading } from "@/components/common";
import { CalendarBlank } from "@phosphor-icons/react";

/**
 * FootfallDailyCalendar — GitHub-style calendar heatmap of daily group
 * footfall (summed across locations) for the selected window.
 *
 * Renders a grid of Mon..Sun columns × week rows. Cell intensity scales
 * linearly with that day's footfall vs the window max. Hover reveals
 * exact counts + conversion. Handles the "upstream has no hour-of-day
 * data" gap honestly (the audit's P3 "time-of-day heatmap" — see the
 * footnote).
 *
 * Data source: `/api/footfall/daily-calendar` (1h server-side cache).
 */

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Cream → brand green gradient (matches the weekday heatmap palette).
const COLD = [252, 245, 230];
const HOT  = [26, 92, 56];
const mix = (a, b, t) => {
  const c = Math.min(1, Math.max(0, t));
  const lerp = (x, y) => Math.round(x + (y - x) * c);
  return `rgb(${lerp(a[0], b[0])}, ${lerp(a[1], b[1])}, ${lerp(a[2], b[2])})`;
};

const buildWeeks = (days) => {
  if (!days || days.length === 0) return [];
  // Pad the leading/trailing cells so every week row has 7 slots aligned
  // to Mon..Sun. days[].weekday is 0=Mon..6=Sun.
  const padded = [];
  const leadPad = days[0].weekday;
  for (let i = 0; i < leadPad; i++) padded.push(null);
  padded.push(...days);
  while (padded.length % 7 !== 0) padded.push(null);
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return weeks;
};

const FootfallDailyCalendar = ({ dateFrom, dateTo, country }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    api
      .get("/footfall/daily-calendar", {
        params: { date_from: dateFrom, date_to: dateTo, country },
        timeout: 120000,
      })
      .then(({ data: d }) => {
        if (cancel) return;
        setData(d);
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [dateFrom, dateTo, country]);

  const weeks = useMemo(() => buildWeeks(data?.days || []), [data]);
  const max = data?.max_footfall || 0;

  if (loading) return <Loading />;
  if (error) return <div className="text-[12px] text-muted italic">{error}</div>;
  if (!data || !data.days || data.days.length === 0) {
    return <div className="text-[12px] text-muted italic">No footfall data for the selected window.</div>;
  }

  // Aggregate summary across the window
  const totals = data.days.reduce(
    (acc, d) => {
      acc.ff += d.footfall || 0;
      acc.or += d.orders || 0;
      acc.sa += d.total_sales || 0;
      return acc;
    },
    { ff: 0, or: 0, sa: 0 }
  );
  const cr = totals.ff > 0 ? (totals.or / totals.ff) * 100 : 0;

  // Pick hottest + coldest days for storytelling
  const sorted = [...data.days].sort((a, b) => (b.footfall || 0) - (a.footfall || 0));
  const hottest = sorted[0];
  const coldest = sorted[sorted.length - 1];

  return (
    <div data-testid="footfall-daily-calendar">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="text-[11.5px] text-muted">
          <CalendarBlank size={12} className="inline -mt-0.5 mr-1" />
          Window: <b className="text-foreground">{data.window.start}</b> → <b className="text-foreground">{data.window.end}</b> · {data.window.days} days
        </div>
        <div className="flex items-center gap-4 text-[11.5px] text-muted">
          <div>Total footfall: <b className="text-foreground num">{fmtNum(totals.ff)}</b></div>
          <div>Orders: <b className="text-foreground num">{fmtNum(totals.or)}</b></div>
          <div>Sales: <b className="text-foreground num">{fmtKES(totals.sa)}</b></div>
          <div>Avg conversion: <b className="text-foreground num">{cr.toFixed(1)}%</b></div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-grid gap-1" style={{ gridTemplateColumns: `auto repeat(${weeks.length}, minmax(16px, 20px))` }}>
          {/* empty top-left cell */}
          <div />
          {weeks.map((_, i) => (
            <div key={`wh-${i}`} className="text-[9.5px] text-muted text-center">W{i + 1}</div>
          ))}
          {WEEKDAY_LABELS.map((wl, wi) => (
            <React.Fragment key={wl}>
              <div className="text-[10.5px] text-muted uppercase tracking-wider pr-2 self-center">{wl}</div>
              {weeks.map((week, ci) => {
                const cell = week[wi];
                if (!cell) {
                  return (
                    <div
                      key={`${wl}-${ci}`}
                      className="h-5 w-5 rounded-sm border border-dashed border-border/40 bg-white/20"
                    />
                  );
                }
                const ratio = max > 0 ? (cell.footfall || 0) / max : 0;
                const bg = mix(COLD, HOT, ratio);
                const tip = `${cell.date}\nFootfall ${fmtNum(cell.footfall)} · Orders ${fmtNum(cell.orders)}\nConversion ${cell.conversion_rate != null ? cell.conversion_rate.toFixed(1) + "%" : "—"}`;
                return (
                  <div
                    key={`${wl}-${ci}`}
                    className="h-5 w-5 rounded-sm border border-border/30"
                    style={{ background: bg }}
                    title={tip}
                    data-testid={`calendar-cell-${cell.date}`}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {hottest && coldest && hottest.footfall > 0 && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11.5px]">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-900">
            🔥 Busiest: <b>{hottest.date}</b> — {fmtNum(hottest.footfall)} visitors · {hottest.conversion_rate != null ? `${hottest.conversion_rate.toFixed(1)}% CR` : "—"}
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-slate-700">
            🪶 Quietest: <b>{coldest.date}</b> — {fmtNum(coldest.footfall)} visitors · {coldest.conversion_rate != null ? `${coldest.conversion_rate.toFixed(1)}% CR` : "—"}
          </div>
        </div>
      )}

      <p className="text-[10.5px] text-muted italic mt-3">
        ℹ Upstream exposes daily aggregates only — true time-of-day (hourly) heatmap requires hour-level POS timestamps, which aren't published yet. This calendar view surfaces the intra-window cadence instead.
      </p>
    </div>
  );
};

export default FootfallDailyCalendar;
