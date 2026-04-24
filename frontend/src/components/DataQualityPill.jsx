import React from "react";

/**
 * DataQualityPill — the reusable "⚠ verify" chip.
 *
 * Props:
 *   flag       { kind, reason, severity }  (from useOutliers)
 *   label?     custom chip text (default: "verify")
 *   testId?    data-testid (default: `dq-pill`)
 *   size?      "sm" | "md" (default "sm")
 *
 * Returns null when flag is falsy — so callers can inline it without
 * conditionals:
 *   <span>{r.location} <DataQualityPill flag={r.outlier} /></span>
 */
const SIZE_CLS = {
  sm: "px-1.5 py-0.5 text-[9.5px]",
  md: "px-2 py-0.5 text-[10.5px]",
};

export const DataQualityPill = ({
  flag,
  label = "verify",
  testId,
  size = "sm",
}) => {
  if (!flag) return null;
  const severe = flag.severity === "severe";
  const bg = severe
    ? "bg-amber-200 text-amber-900 border-amber-400"
    : "bg-amber-100 text-amber-800 border-amber-300";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full font-bold border ${bg} ${SIZE_CLS[size] || SIZE_CLS.sm}`}
      title={flag.reason || ""}
      data-testid={testId || "dq-pill"}
      role="status"
      aria-label={flag.reason || label}
    >
      <span aria-hidden="true">⚠</span> {label}
    </span>
  );
};

/**
 * DataQualityBanner — the reusable "N stores flagged" banner that sits
 * above any table/chart with outliers. Auto-hides when count === 0.
 */
export const DataQualityBanner = ({
  count,
  statsLine,          // e.g. "group avg 14.2% ± 8.2pp"
  noun = "rows",      // "stores", "customers", etc.
  action = "verify the source before acting on the number.",
  testId = "dq-banner",
}) => {
  if (!count || count <= 0) return null;
  return (
    <div
      className="mt-1 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50/80 px-3 py-1.5 text-[11.5px] text-amber-900"
      data-testid={testId}
      role="status"
    >
      <span className="font-bold">
        ⚠ {count} {count === 1 ? noun.replace(/s$/, "") : noun} flagged
      </span>
      {statsLine && (
        <span className="text-amber-800/90">
          {statsLine} — {action}
        </span>
      )}
    </div>
  );
};

export default DataQualityPill;
