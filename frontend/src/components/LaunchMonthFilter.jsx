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
/** Sentinel prefix for whole-year selections (e.g. `__YEAR__:2024`).
 *  When present in the selection, filters include any row whose
 *  launch_date falls anywhere in that year — convenience shortcut
 *  so users can pick "all of 2024" without ticking 12 month boxes. */
export const YEAR_PREFIX = "__YEAR__:";

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

/** Build a year-grouped option list from a set of rows. Each year
 *  group starts with a "Whole year YYYY" toggle (sentinel value
 *  `__YEAR__:YYYY`) so users can pick a whole year in one click,
 *  followed by months sorted newest-first within that year. Years
 *  themselves are listed newest-first; "Unknown" anchors the bottom. */
export const getMonthOptions = (rows) => {
  const seen = new Set();
  let hasUnknown = false;
  for (const r of rows || []) {
    const ym = isoToYM(r?.launch_date);
    if (ym) seen.add(ym);
    else hasUnknown = true;
  }
  const months = Array.from(seen).sort((a, b) => b.localeCompare(a));
  // Bucket months by year so we can emit a "Whole year" sentinel at the
  // top of each year section.
  const byYear = new Map();
  for (const ym of months) {
    const [y] = ym.split("-");
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(ym);
  }
  const opts = [];
  // Years iterate in the same newest-first order as `months`.
  const years = Array.from(byYear.keys()); // already newest-first from `months`
  for (const y of years) {
    opts.push({
      value: `${YEAR_PREFIX}${y}`,
      label: `Whole year ${y}`,
      group: y,
    });
    for (const ym of byYear.get(y)) {
      const [, m] = ym.split("-");
      opts.push({
        value: ym,
        label: `${MONTH_LABELS[parseInt(m, 10) - 1]} ${y}`,
        group: y,
      });
    }
  }
  if (hasUnknown) {
    opts.push({
      value: UNKNOWN_LAUNCH,
      label: "Unknown launch date",
      group: "Other",
    });
  }
  return opts;
};

/** Apply a launch-month / launch-year selection to a row list. Empty
 *  selection = no filtering. */
export const filterByLaunchMonths = (rows, selection) => {
  if (!selection || !selection.length) return rows;
  const wantsUnknown = selection.includes(UNKNOWN_LAUNCH);
  const monthSet = new Set();
  const yearSet = new Set();
  for (const v of selection) {
    if (v === UNKNOWN_LAUNCH) continue;
    if (typeof v === "string" && v.startsWith(YEAR_PREFIX)) {
      yearSet.add(v.slice(YEAR_PREFIX.length));
    } else {
      monthSet.add(v);
    }
  }
  if (!monthSet.size && !yearSet.size && !wantsUnknown) return rows;
  return (rows || []).filter((r) => {
    const ym = isoToYM(r?.launch_date);
    if (!ym) return wantsUnknown;
    if (monthSet.has(ym)) return true;
    const [y] = ym.split("-");
    return yearSet.has(y);
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
