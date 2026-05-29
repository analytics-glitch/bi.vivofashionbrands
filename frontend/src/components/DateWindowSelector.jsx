import React from "react";

/**
 * DateWindowSelector — Iter 89w-h
 *
 * Compact preset selector for "look back N days" windows. Used by the
 * stock-to-sales / SOR tables across Inventory, Products, Marketing
 * and Range Mgmt so each table can be re-windowed independently of
 * the global filter bar.
 *
 * value: integer days (e.g. 30)
 * onChange(days: number): void
 *
 * The presets are intentionally conservative: 7/14/30/60/90 days
 * map cleanly to "week / fortnight / month / 2 months / quarter" —
 * which is how the merch team thinks about velocity.
 */
const PRESETS = [
  { v: 7,  l: "7d"  },
  { v: 14, l: "14d" },
  { v: 30, l: "30d" },
  { v: 60, l: "60d" },
  { v: 90, l: "90d" },
];

export default function DateWindowSelector({
  value = 30,
  onChange,
  presets = PRESETS,
  testId = "date-window",
  label = "Window",
}) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-2 py-1"
      data-testid={`${testId}-wrap`}
      title="Re-windows just THIS table — global filter bar dates are not affected."
    >
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted">{label}</span>
      <div className="inline-flex rounded-md overflow-hidden border border-border">
        {presets.map((p) => (
          <button
            key={p.v}
            type="button"
            onClick={() => onChange?.(p.v)}
            data-testid={`${testId}-${p.v}`}
            className={`text-[10.5px] font-bold px-2 py-0.5 transition-colors ${
              value === p.v
                ? "bg-[#1a5c38] text-white"
                : "bg-white text-[#1a5c38] hover:bg-[#fef3e0]"
            }`}
          >
            {p.l}
          </button>
        ))}
      </div>
    </div>
  );
}
