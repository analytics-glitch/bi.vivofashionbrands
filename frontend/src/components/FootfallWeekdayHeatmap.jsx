import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum, fmtPct } from "@/lib/api";
import { Loading } from "@/components/common";
import { CalendarBlank } from "@phosphor-icons/react";

/**
 * FootfallWeekdayHeatmap — audit recommendation: a time-of-day heatmap.
 *
 * Upstream exposes only daily aggregates (no hourly). The realistic
 * equivalent is a LOCATION × WEEKDAY heatmap over a trailing 28-day
 * window. Backed by /api/footfall/weekday-pattern (1h cached on the
 * backend, fans out 28 parallel upstream calls).
 *
 * The user can toggle between Footfall-intensity and Conversion-
 * intensity colour maps — two meaningfully different stories.
 *
 * Renders nothing on error — the page still has the per-day charts.
 */

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Interpolate between two colours by a 0..1 ratio. Returns "rgb(...)".
const mix = (a, b, t) => {
  const lerp = (x, y) => Math.round(x + (y - x) * Math.min(1, Math.max(0, t)));
  return `rgb(${lerp(a[0], b[0])}, ${lerp(a[1], b[1])}, ${lerp(a[2], b[2])})`;
};
// Soft cream → brand-deep green, honours the app palette.
const COLD = [252, 245, 230];  // warm cream
const HOT_FOOTFALL = [26, 92, 56];     // brand-deep green
const HOT_CONVERSION = [245, 158, 11]; // amber — different story, different warmth
const HOT_SHARE = [90, 58, 176];       // indigo — share-of-week is its own story

const hotForMode = (mode) =>
  mode === "conversion" ? HOT_CONVERSION
  : mode === "share" ? HOT_SHARE
  : HOT_FOOTFALL;

const Cell = ({ value, maxValue, mode, days, loc, weekdayLabel, absoluteFootfall }) => {
  if (days === 0) {
    return (
      <div
        className="h-7 rounded-sm border border-dashed border-border/60 bg-white/40"
        title={`${loc} · ${weekdayLabel}: no data`}
      />
    );
  }
  const max = Math.max(mode === "share" ? 0.5 : 1, maxValue);
  const ratio = Math.min(1, value / max);
  const color = mix(COLD, hotForMode(mode), ratio);
  const textLight = ratio > 0.55;
  // Tooltip shows both absolute + share of week for the `share` mode
  // so the user never loses the raw number context.
  const tipValue =
    mode === "conversion" ? `${value.toFixed(1)}%` :
    mode === "share"      ? `${(value * 100).toFixed(1)}% of week (${fmtNum(absoluteFootfall)} avg)` :
                            fmtNum(value);
  const cellLabel =
    mode === "conversion" ? `${value.toFixed(1)}%` :
    mode === "share"      ? `${Math.round(value * 100)}%` :
                            (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value));
  return (
    <div
      className="h-7 rounded-sm flex items-center justify-center text-[10.5px] font-bold transition-transform hover:scale-[1.04]"
      style={{ background: color, color: textLight ? "white" : "#1f2937" }}
      title={`${loc} · ${weekdayLabel}\n${mode === "conversion" ? "CR" : mode === "share" ? "Share" : "Footfall"}: ${tipValue}`}
      data-testid={`wkd-cell-${loc}-${weekdayLabel}`}
    >
      {cellLabel}
    </div>
  );
};

const FootfallWeekdayHeatmap = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // "footfall" = absolute avg, "share" = % of each store's own weekly total,
  // "conversion" = avg conversion rate. "share" was added because absolute
  // numbers mask the real question: does this store skew harder toward
  // weekends / weekdays than others? Normalising each row to 100% makes
  // that skew jump out even when two stores have very different volumes.
  const [mode, setMode] = useState("footfall");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api.get("/footfall/weekday-pattern")
      .then((r) => { if (!cancel) setData(r.data || null); })
      .catch(() => { /* silent — page still has per-day charts */ })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  const { rows, groupByWkd, windowMeta, maxValue } = useMemo(() => {
    if (!data || !Array.isArray(data.rows)) {
      return { rows: [], groupByWkd: [], windowMeta: null, maxValue: 1 };
    }
    // Iter 78 — show every location instead of the top 15. The
    // backend payload is small (~25 rows × 7 weekdays of integers) so
    // the heatmap still scrolls comfortably and the user's question
    // ("where are MY stores in this pattern?") is now answerable
    // without leaving the page.
    const top = data.rows;
    // For share mode, pre-compute each row's weekly total so the
    // per-cell value = day_avg / weekly_sum (each row sums to 1.0).
    if (mode === "share") {
      let maxShare = 0;
      top.forEach((r) => {
        const weekTotal = r.by_weekday.reduce((s, w) => s + (w.avg_footfall || 0), 0) || 1;
        r._weekly_total = weekTotal;
        r.by_weekday.forEach((w) => {
          const v = (w.avg_footfall || 0) / weekTotal;
          if (v > maxShare) maxShare = v;
        });
      });
      return {
        rows: top,
        groupByWkd: data.group_avg_by_weekday || [],
        windowMeta: data.window,
        maxValue: maxShare || 0.3, // e.g. a store with 30% of week on one day
      };
    }
    const key = mode === "conversion" ? "avg_conversion_rate" : "avg_footfall";
    let m = 0;
    top.forEach((r) => r.by_weekday.forEach((w) => {
      const v = w[key] || 0;
      if (v > m) m = v;
    }));
    return {
      rows: top,
      groupByWkd: data.group_avg_by_weekday || [],
      windowMeta: data.window,
      maxValue: m || 1,
    };
  }, [data, mode]);

  if (loading) {
    return (
      <div className="card-white p-5" data-testid="weekday-heatmap-loading">
        <div className="flex items-center gap-2 mb-2 text-brand-deep">
          <CalendarBlank size={16} weight="fill" />
          <div className="text-[13px] font-bold">Weekday pattern · Loading 4-week sample…</div>
        </div>
        <Loading label="Aggregating footfall across 28 days…" />
      </div>
    );
  }

  if (!data || rows.length === 0) return null;

  const peakWkd = [...groupByWkd].sort((a, b) => (b.avg_footfall || 0) - (a.avg_footfall || 0))[0];
  const softestWkd = [...groupByWkd].sort((a, b) => (a.avg_footfall || 0) - (b.avg_footfall || 0))[0];
  const peakCrWkd = [...groupByWkd].sort((a, b) => (b.avg_conversion_rate || 0) - (a.avg_conversion_rate || 0))[0];

  return (
    <div className="card-white p-5" data-testid="weekday-heatmap">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="flex items-center gap-2 text-brand-deep">
            <CalendarBlank size={16} weight="fill" />
            <h3 className="text-[14px] font-bold tracking-tight">
              Weekday pattern per store
            </h3>
          </div>
          <div className="text-[11.5px] text-muted mt-0.5">
            28-day rolling window · each weekday sampled {rows[0]?.by_weekday?.[0]?.days || 4}×.
            {windowMeta && (
              <span className="ml-1">
                {windowMeta.start} → {windowMeta.end}.
              </span>
            )}
            {mode === "share" ? (
              <span className="ml-1">
                Each row = 100%. Cells show that store's share of its own weekly footfall
                — reveals weekday skew independent of store volume.
              </span>
            ) : peakWkd && softestWkd ? (
              <span className="ml-1">
                Group peak: <strong className="text-brand-deep">{WEEKDAY_SHORT[peakWkd.weekday]}</strong> ({fmtNum(peakWkd.avg_footfall)} avg).
                Softest: <strong>{WEEKDAY_SHORT[softestWkd.weekday]}</strong>.
                Best CR day: <strong>{WEEKDAY_SHORT[peakCrWkd.weekday]}</strong> ({fmtPct(peakCrWkd.avg_conversion_rate, 1)}).
              </span>
            ) : null}
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-border p-0.5 bg-panel" data-testid="heatmap-mode-switch">
          {[
            ["footfall", "Footfall"],
            ["share", "% of week"],
            ["conversion", "Conversion"],
          ].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              data-testid={`heatmap-mode-${k}`}
              className={`px-2.5 py-1 rounded-md text-[11.5px] font-semibold transition-colors ${
                mode === k ? "bg-brand text-white" : "text-foreground/70 hover:bg-white"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px] grid gap-1" style={{ gridTemplateColumns: "minmax(140px, 1.5fr) repeat(7, minmax(52px, 1fr))" }}>
          <div /> {/* top-left corner */}
          {WEEKDAY_SHORT.map((w) => (
            <div key={w} className="text-[10.5px] text-muted font-semibold uppercase tracking-wider text-center pb-1">
              {w}
            </div>
          ))}
          {rows.map((r) => (
            <React.Fragment key={r.location}>
              <div className="text-[11.5px] font-medium truncate pr-2 flex items-center" title={r.location}>
                <span className="truncate">{r.location}</span>
              </div>
              {r.by_weekday.map((w, i) => {
                const weekTotal = r._weekly_total || r.by_weekday.reduce((s, x) => s + (x.avg_footfall || 0), 0) || 1;
                const cellValue =
                  mode === "conversion" ? (w.avg_conversion_rate || 0) :
                  mode === "share"      ? ((w.avg_footfall || 0) / weekTotal) :
                                          (w.avg_footfall || 0);
                return (
                  <Cell
                    key={i}
                    value={cellValue}
                    maxValue={maxValue}
                    mode={mode}
                    days={w.days}
                    loc={r.location}
                    weekdayLabel={WEEKDAY_SHORT[w.weekday]}
                    absoluteFootfall={w.avg_footfall || 0}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10.5px] text-muted">
        <span>{mode === "conversion" ? "Low CR" : mode === "share" ? "Low share" : "Quiet day"}</span>
        <div
          className="h-2.5 w-28 rounded-full"
          style={{
            background: `linear-gradient(to right, rgb(${COLD.join(",")}), rgb(${hotForMode(mode).join(",")}))`
          }}
        />
        <span>{mode === "conversion" ? "High CR" : mode === "share" ? "High share" : "Peak day"}</span>
        <span className="ml-auto">Dashed cell = no data</span>
      </div>
    </div>
  );
};

export default FootfallWeekdayHeatmap;
