import React, { useMemo } from "react";
import MultiSelect from "@/components/MultiSelect";

/**
 * Shared Launch-Date (Month + Year) multi-select for the SOR views.
 *
 * Builds the option list from the launch_date ISO strings already on
 * each row (no extra API call — every row carries `launch_date`, which
 * the backend hydrates from Mongo's style_launch_dates cache for older
 * styles). Months are grouped by year so the dropdown reads naturally
 * (e.g. "2024 → Jan 2024 / Feb 2024 / …").
 *
 * Sentinel value `__UNKNOWN__` represents "styles without a launch date"
 * — typically older catalog styles that pre-date the launch-date cache
 * or genuinely never sold a unit. Inclusion is opt-in via the option in
 * the dropdown itself (no separate toggle, keeps the UI compact).
 *
 * Filter semantics:
 *   • Empty selection = all rows pass through (back-compat default).
 *   • One or more months selected = only rows whose YYYY-MM falls in the
 *     selection are kept.
 *   • `__UNKNOWN__` in the selection = additionally include rows with
 *     no launch_date.
 *
 * Public helpers:
 *   - `getMonthOptions(rows)` — builds the option list from rows
 *   - `filterByLaunchMonths(rows, selection)` — applies the filter
 *
 * Both helpers are pure + memoisation-friendly so the parent can use
 * them inside `useMemo` without re-allocating on every render.
 */

export const UNKNOWN_LAUNCH = "__UNKNOWN__";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const isoToYM = (iso) => {
  if (!iso || typeof iso !== "string") return null;
  // Accept "2024-08", "2024-08-15", "2024-08-15T13:00:00Z", etc.
  // Reject anything that doesn't start with YYYY-MM.
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return null;
  const yr = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (!yr || !mo || mo < 1 || mo > 12) return null;
  return `${m[1]}-${m[2]}`;
};

/** Build a year-grouped option list from a set of rows. Months are
 *  sorted newest-first (most-recent year on top, December → January
 *  within each year). An "Unknown" option is appended at the bottom. */
export const getMonthOptions = (rows) => {
  const seen = new Set();
  let hasUnknown = false;
  for (const r of rows || []) {
    const ym = isoToYM(r?.launch_date);
    if (ym) seen.add(ym);
    else hasUnknown = true;
  }
  const months = Array.from(seen).sort((a, b) => b.localeCompare(a));
  const opts = months.map((ym) => {
    const [y, m] = ym.split("-");
    return {
      value: ym,
      label: `${MONTH_LABELS[parseInt(m, 10) - 1]} ${y}`,
      group: y,
    };
  });
  if (hasUnknown) {
    opts.push({
      value: UNKNOWN_LAUNCH,
      label: "Unknown launch date",
      group: "Other",
    });
  }
  return opts;
};

/** Apply a launch-month selection to a row list. Empty selection = no
 *  filtering (rows passed through unchanged). */
export const filterByLaunchMonths = (rows, selection) => {
  if (!selection || !selection.length) return rows;
  const wantsUnknown = selection.includes(UNKNOWN_LAUNCH);
  const monthSet = new Set(selection.filter((v) => v !== UNKNOWN_LAUNCH));
  if (!monthSet.size && !wantsUnknown) return rows;
  return (rows || []).filter((r) => {
    const ym = isoToYM(r?.launch_date);
    if (!ym) return wantsUnknown;
    return monthSet.has(ym);
  });
};

/** Drop-in MultiSelect that wires `rows → options` for the parent. */
const LaunchMonthFilter = ({
  rows,
  value,
  onChange,
  width = 240,
  testId = "launch-month-filter",
  placeholder = "All Launch Months",
}) => {
  const options = useMemo(() => getMonthOptions(rows), [rows]);
  return (
    <MultiSelect
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      width={width}
      testId={testId}
    />
  );
};

export default LaunchMonthFilter;
