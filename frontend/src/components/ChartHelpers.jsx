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

/** Compose the standard "KES X (Y%) ▲Z%" string used on bar labels.
 * - `value` — current period value (already in display currency).
 * - `pct` — % share of total (0–100). If null/undefined, omitted.
 * - `deltaPct` — % change vs comparison period. If null, arrow is hidden.
 * - `formatValue` — formatter for the leading numeric value (e.g. fmtKES).
 * - `compact` — when true, uses K/M abbreviations and skips delta on mobile.
 */
export const fmtBarLabel = (value, pct, deltaPct, formatValue, { compact = false, hideDelta = false } = {}) => {
  const valStr = formatValue ? formatValue(value) : String(value);
  const pctStr = pct != null && Number.isFinite(pct) ? ` (${pct.toFixed(1)}%)` : "";
  let deltaStr = "";
  if (!hideDelta && deltaPct != null && Number.isFinite(deltaPct)) {
    if (compact) {
      const a = deltaPct > 0.05 ? "▲" : deltaPct < -0.05 ? "▼" : "—";
      deltaStr = ` ${a}${Math.abs(deltaPct).toFixed(1)}%`;
    } else {
      const a = deltaPct > 0.05 ? "▲" : deltaPct < -0.05 ? "▼" : "—";
      deltaStr = ` ${a} ${Math.abs(deltaPct).toFixed(1)}%`;
    }
  }
  return `${valStr}${pctStr}${deltaStr}`;
};

/** Recharts `<LabelList content={...} />` renderer that paints
 * "KES X (Y%) ▲Z%" — with the delta segment colour-coded green/red/grey
 * — to the right of (vertical layout) or above (horizontal layout) a bar.
 *
 * Looks for `pct` and `delta_pct` on the row payload. Pass `formatValue`
 * for the numeric part. `position` defaults to "right".
 */
export const PctDeltaLabel = ({
  x, y, width, height, value, payload, index, viewBox,
  formatValue, position = "right", offset = 6, fontSize = 10, hideDelta = false,
}) => {
  // Recharts passes the row through `payload` only when the chart wires
  // it explicitly via Cell; for normal cases we read from <BarChart data>.
  // The real row sits at the rendered bar's index, but that's not directly
  // available here — we rely on `value` being the primary metric and
  // `payload` being supplied by caller via custom prop (we pass `data={...}`
  // through React closure instead). To keep this self-contained we accept
  // `pct` and `deltaPct` directly from the wrapper.
  return null; // placeholder — see makePctDeltaLabel below for the working version.
};

/** Factory: returns a Recharts <LabelList content={…}> that has access
 * to the full `data` array via closure. `position`: "right" (vertical
 * layout) or "top" (horizontal). */
export const makePctDeltaLabel = ({
  data,
  formatValue,
  position = "right",
  offset = 6,
  fontSize = 10,
  hideDelta = false,
  valueKey = "total_sales",
  pctKey = "pct",
  deltaKey = "delta_pct",
  /** Suffix appended to the delta number — defaults to "%". Pass "pp" for
   * percentage-point deltas (e.g. on conversion rate where the underlying
   * metric is already a %). */
  deltaSuffix = "%",
  labelTestId,
}) => (props) => {
  const { x = 0, y = 0, width = 0, height = 0, index } = props;
  const row = (data && data[index]) || {};
  const v = row[valueKey];
  if (v == null) return null;
  const pct = row[pctKey];
  const dlt = hideDelta ? null : row[deltaKey];

  const valStr = formatValue ? formatValue(v) : String(v);
  const pctStr = pct != null && Number.isFinite(pct) ? `(${pct.toFixed(1)}%)` : "";

  let arrow = "";
  let deltaStr = "";
  let deltaCls = "#6b7280";
  if (dlt != null && Number.isFinite(dlt)) {
    if (dlt > 0.05) { arrow = "▲"; deltaCls = "#059669"; }
    else if (dlt < -0.05) { arrow = "▼"; deltaCls = "#dc2626"; }
    else { arrow = "—"; deltaCls = "#6b7280"; }
    // For "pp" we keep the sign so a -0.4 pp shift still shows ▼ but the
    // number itself reads "0.4 pp" (the arrow conveys direction). Same
    // pattern as "%". Decimals stay at 1 for screen readability.
    deltaStr = `${Math.abs(dlt).toFixed(deltaSuffix === "pp" ? 2 : 1)} ${deltaSuffix}`.replace(" %", "%");
  }

  // Position: "right" → vertical bar, paint to the right of the bar tip.
  // "top" → horizontal bar, paint above the bar tip.
  let tx, ty, anchor;
  if (position === "right") {
    tx = x + width + offset;
    ty = y + height / 2 + fontSize / 3;
    anchor = "start";
  } else { // "top"
    tx = x + width / 2;
    ty = y - offset;
    anchor = "middle";
  }
  return (
    <g data-testid={labelTestId}>
      <text x={tx} y={ty} fontSize={fontSize} textAnchor={anchor} fill="#374151" fontWeight={600}>
        <tspan>{valStr}</tspan>
        {pctStr && (
          <tspan dx={4} fill="#6b7280" fontWeight={500}>{pctStr}</tspan>
        )}
        {arrow && (
          <>
            <tspan dx={6} fill={deltaCls} fontWeight={700}>{arrow}</tspan>
            <tspan dx={2} fill={deltaCls} fontWeight={700}>{deltaStr}</tspan>
          </>
        )}
      </text>
    </g>
  );
};


export default ChartTooltip;
