import React, { useEffect, useState } from "react";
import { fmtDelta } from "@/lib/api";

/** Returns true when viewport is < 768 px (Tailwind `md` breakpoint). Re-fires
 * on window resize. Used to flip chart labels/tooltips into compact mode. */
export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
};

/** Custom Recharts tooltip that shows all payload values formatted.
 * Formatter lookup prefers dataKey (matches chart code conventions) and
 * falls back to name. Tooltip auto-constrains within viewport on mobile.
 * `labelKey` overrides the header — pulls from payload[0].payload[labelKey]
 * (useful when the Y-axis uses a shortened label but we want the full
 * name in the tooltip). */
export const ChartTooltip = ({ active, payload, label, formatters = {}, labelFormat, labelKey }) => {
  if (!active || !payload || !payload.length) return null;
  const displayLabel = labelKey && payload[0]?.payload?.[labelKey] != null
    ? payload[0].payload[labelKey]
    : label;
  return (
    <div
      className="rounded-lg border border-border bg-white px-3 py-2 shadow-lg text-[11.5px] max-w-[80vw] sm:max-w-none pointer-events-none"
      role="tooltip"
    >
      {displayLabel != null && (
        <div className="font-semibold text-foreground mb-1 truncate">
          {labelFormat ? labelFormat(displayLabel) : displayLabel}
        </div>
      )}
      {payload.map((p, i) => {
        const fmt = formatters[p.dataKey] || formatters[p.name];
        return (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: p.color || p.fill }}
            />
            <span className="text-muted truncate">{p.name || p.dataKey}:</span>
            <span className="font-semibold num whitespace-nowrap">
              {fmt ? fmt(p.value, p.payload) : p.value}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** Delta pill — green up arrow / red down arrow for % changes */
export const Delta = ({ value, suffix = "%", precision = 1, testId }) => {
  if (value == null || isNaN(value)) {
    return <span className="text-muted text-[12px]">—</span>;
  }
  const isUp = value > 0;
  const isZero = value === 0;
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-0.5 font-semibold num text-[12px] ${
        isZero ? "text-muted" : isUp ? "text-[#16a34a]" : "text-[#dc2626]"
      }`}
    >
      {!isZero && <span aria-hidden="true">{isUp ? "▲" : "▼"}</span>}
      {Math.abs(value).toFixed(precision)}{suffix}
    </span>
  );
};

/** Inline per-metric growth/decline indicator shown below a metric value.
 *  - delta: pct change (null → nothing, unless showNA)
 *  - higherIsBetter: default true. For metrics where higher = worse (Returns,
 *    Return Rate, Churn), pass `false` — arrow+color reverses so rising
 *    Returns are red, falling Returns are green.
 *  - prevValue + prevLabel: optionally append "vs KES 2,187,340 yesterday"
 *    style context (auto-hidden on narrow screens to save space).
 *  - compact: drops the prev context entirely (use in tight grids).
 */
export const InlineDelta = ({ delta, higherIsBetter = true, prevValue = null, prevLabel = null, showNA = false, compact = false, testId }) => {
  if (delta === null || delta === undefined || isNaN(delta)) {
    if (!showNA) return null;
    return (
      <span className="text-[11px] text-muted" data-testid={testId}>— n/a</span>
    );
  }
  const pos = delta > 0.05;
  const neg = delta < -0.05;
  const zero = !pos && !neg;
  const good = higherIsBetter ? pos : neg;
  const bad = higherIsBetter ? neg : pos;
  const cls = good ? "text-[#059669]" : bad ? "text-[#dc2626]" : "text-muted";
  const arrow = pos ? "▲" : neg ? "▼" : "—";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold ${cls} whitespace-nowrap`}
      data-testid={testId}
    >
      <span aria-hidden="true">{arrow}</span>
      <span className="num">{zero ? "0.0%" : fmtDelta(delta)}</span>
      {!compact && prevValue != null && (
        <span className="text-muted font-normal hidden sm:inline">
          {prevLabel ? prevLabel : "prev"} {prevValue}
        </span>
      )}
    </span>
  );
};

export default ChartTooltip;
