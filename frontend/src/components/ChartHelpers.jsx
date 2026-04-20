import React from "react";

/** Custom Recharts tooltip that shows all payload values formatted */
export const ChartTooltip = ({ active, payload, label, formatters = {}, labelFormat }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-md text-[11.5px]">
      {label != null && (
        <div className="font-semibold text-foreground mb-1">
          {labelFormat ? labelFormat(label) : label}
        </div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ background: p.color || p.fill }}
          />
          <span className="text-muted">{p.name || p.dataKey}:</span>
          <span className="font-semibold num">
            {formatters[p.name || p.dataKey]
              ? formatters[p.name || p.dataKey](p.value, p.payload)
              : p.value}
          </span>
        </div>
      ))}
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

export default ChartTooltip;
