import React, { useMemo, useState } from "react";
import { CaretUp, CaretDown, CaretRight, Download } from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * Convert any React element / value into a flat string (used as a fallback
 * when a column has no explicit `csv:` callback). Walks children recursively
 * and joins their text content. This is what lets a column rendered as
 * `<span className="pill-green">29.76%</span>` export as `29.76%` to CSV
 * without each callsite having to write a custom csv() callback.
 */
const _flattenToText = (node) => {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(_flattenToText).join("");
  if (typeof node === "object" && node.props) {
    return _flattenToText(node.props.children);
  }
  return "";
};

/** Download rows as CSV and show a success toast. */
export const exportCSV = (rows, columns, filename = "export.csv") => {
  const header = columns.map((c) => `"${(c.label || c.key).replace(/"/g, '""')}"`).join(",");
  // Auto-detect percentage columns by checking the rendered text of the first
  // row. Any column whose render output ends with `%`, ` pp`, ` pts`, or ` pt`
  // is treated as a percentage and gets a `%` suffix in CSV (variance
  // "pp"/"pts" gets normalised to "%" too — keeps the export uniform).
  const sample = rows[0];
  const pctCols = new Set();
  if (sample) {
    columns.forEach((c, i) => {
      if (c.pct === false) return;
      if (c.pct === true) { pctCols.add(i); return; }
      if (typeof c.render !== "function") return;
      try {
        const txt = _flattenToText(c.render(sample, 0)).trim();
        if (/(%|\bpp|\bpts?)\s*$/i.test(txt)) pctCols.add(i);
      } catch (_e) { /* ignore */ }
    });
  }
  const lines = rows.map((r, idx) =>
    columns
      .map((c, ci) => {
        let v;
        if (typeof c.csv === "function") {
          v = c.csv(r, idx);
        } else if (typeof c.render === "function") {
          // Auto-derive CSV from the rendered cell so percentages, KES-
          // formatted values, and pills export with their unit suffix
          // intact instead of as a bare number.
          try {
            v = _flattenToText(c.render(r, idx)).trim();
          } catch (_e) {
            v = r[c.key];
          }
        } else {
          v = r[c.key];
        }
        if (v == null) return "";
        let s = String(v);
        if (pctCols.has(ci)) {
          // Normalise variance "pp" / "pts" / "pt" → "%" and add "%" if a
          // bare number snuck through (typical of legacy explicit csv
          // callbacks like `r.x?.toFixed(2)`).
          s = s.replace(/\s*(pp|pts?)\s*$/i, "%").trim();
          if (s && !/%\s*$/.test(s)) {
            const n = Number(s);
            if (!Number.isNaN(n)) s = `${n.toFixed(2)}%`;
          }
        }
        s = s.replace(/"/g, '""');
        return `"${s}"`;
      })
      .join(",")
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  // Friendly confirmation — small acknowledgements matter (dopamine design).
  try {
    toast.success(`${rows.length} row${rows.length === 1 ? "" : "s"} exported`, {
      description: filename,
      duration: 2800,
    });
  } catch (_err) { /* silent */ }
};

/**
 * Reusable sortable table with CSV export.
 * columns = [{ key, label, align, sortable = true, render, csv, width, numeric, mobilePrimary, mobileHidden }]
 *
 * When `mobileCards` is true, screens < 768px render a stacked card list
 * instead of a horizontally-scrollable table. Set `mobilePrimary: true`
 * on the column you want to use as each card's headline, and
 * `mobileHidden: true` on columns that should be omitted on mobile.
 */
export const SortableTable = ({
  columns,
  rows,
  initialSort,
  exportName,
  testId,
  pageSize,
  emptyLabel = "No data",
  onRowClick,
  mobileCards = false,
  /** Freezes the LEFT-most column horizontally (always visible during
   * horizontal scroll). Defaults to true. The header row is always sticky
   * vertically against the page scroll. */
  stickyFirstCol = true,
  /** Optional max-height for the scroll container (e.g. "60vh" or 480).
   * Defaults to "70vh" so very long tables become inner-scrollable with a
   * sticky thead + frozen first column. Short tables don't reach the cap
   * and render naturally. Pass `maxHeight={null}` to disable. */
  maxHeight = "70vh",
  /** Optional <td> array rendered as a sticky bottom row (e.g. column
   * totals). Only shown on the desktop table view. Pass an array of
   * <td>…</td> nodes whose count matches `columns.length`. */
  footerRow = null,
  /** When provided, each row gets a chevron column and clicking it (or
   * the row itself) toggles an inline expanded panel that renders
   * `renderExpanded(row)` spanning all columns. */
  renderExpanded = null,
  /** Stable key getter for expanded-state tracking. Defaults to row index. */
  rowKey = null,
  /** Optional tiebreaker sort applied after the primary `sort`. Useful for
   * grouped views like "sort by Category, then Units Sold desc within each
   * category" — set `secondarySort={{ key: 'units_sold', dir: 'desc' }}` and
   * the Category click does the rest. Resolved against `columns` like the
   * primary sort, so `sortValue` callbacks are honoured. */
  secondarySort = null,
}) => {
  const [sort, setSort] = useState(initialSort || null); // { key, dir }
  const [expanded, setExpanded] = useState(() => new Set());
  const [limit, setLimit] = useState(pageSize || null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    const getVal = (r) => (col.sortValue ? col.sortValue(r) : r[sort.key]);
    // Tiebreaker — only applied when (a) caller provided `secondarySort`,
    // (b) it points at a real column, and (c) it's not the same key as the
    // primary sort (otherwise the primary already orders those rows).
    const sec = secondarySort && secondarySort.key !== sort.key
      ? columns.find((c) => c.key === secondarySort.key)
      : null;
    const secDir = sec && secondarySort?.dir === "asc" ? 1 : -1;
    const getSec = sec
      ? (r) => (sec.sortValue ? sec.sortValue(r) : r[secondarySort.key])
      : null;
    const cmp = (av, bv, d) => {
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * d;
      return String(av).localeCompare(String(bv)) * d;
    };
    return [...rows].sort((a, b) => {
      const primary = cmp(getVal(a), getVal(b), dir);
      if (primary !== 0 || !getSec) return primary;
      return cmp(getSec(a), getSec(b), secDir);
    });
  }, [rows, sort, columns, secondarySort]);

  const visible = limit ? sorted.slice(0, limit) : sorted;

  const toggleSort = (key) => {
    const col = columns.find((c) => c.key === key);
    if (!col || col.sortable === false) return;
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: col.numeric ? "desc" : "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  return (
    <div data-testid={testId}>
      <div className="flex justify-end mb-2 gap-2">
        {pageSize && sorted.length > pageSize && (
          <button
            type="button"
            className="text-[11.5px] text-muted hover:text-brand underline"
            onClick={() => setLimit((l) => (l ? null : pageSize))}
          >
            {limit ? `Show all (${sorted.length})` : `Show first ${pageSize}`}
          </button>
        )}
        {renderExpanded && sorted.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Toggle: if every row is already open, collapse all;
              // else expand every currently-sorted row. Uses the
              // existing `rowKey` resolver so it honours the same
              // stable keys used for single-row toggles.
              const allKeys = sorted.map((r, i) => (rowKey ? rowKey(r, i) : i));
              const allOpen = allKeys.every((k) => expanded.has(k));
              setExpanded(allOpen ? new Set() : new Set(allKeys));
            }}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-muted hover:text-brand px-2 py-1 rounded border border-border hover:border-brand"
            data-testid={testId ? `${testId}-expand-all` : undefined}
          >
            {sorted.every((r, i) => expanded.has(rowKey ? rowKey(r, i) : i))
              ? "Collapse all"
              : "Expand all"}
          </button>
        )}
        {exportName && (
          <button
            type="button"
            onClick={() => exportCSV(sorted, columns, exportName)}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-muted hover:text-brand px-2 py-1 rounded border border-border hover:border-brand"
            data-testid={testId ? `${testId}-export` : undefined}
          >
            <Download size={13} weight="bold" /> Export CSV
          </button>
        )}
      </div>
      <div
        className={`overflow-auto ${mobileCards ? "hidden md:block" : ""}`}
        style={maxHeight ? { maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight } : undefined}
      >
        <table className={`w-full data ${stickyFirstCol ? "sticky-first-col" : ""}`}>
          <thead
            className="sticky top-0 z-20 bg-white shadow-[0_1px_0_rgba(0,0,0,0.06)]"
          >
            <tr>
              {renderExpanded && <th className="w-7" />}
              {columns.map((c, ci) => {
                const isFirst = ci === 0 && stickyFirstCol && !renderExpanded;
                return (
                  <th
                    key={c.key}
                    className={`${c.align === "right" || c.numeric ? "text-right" : "text-left"} ${c.sortable === false ? "" : "cursor-pointer hover:text-brand"} select-none ${isFirst ? "sticky left-0 z-30 bg-white" : ""}`}
                    onClick={() => toggleSort(c.key)}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sort && sort.key === c.key && (sort.dir === "asc" ? <CaretUp size={11} /> : <CaretDown size={11} />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + (renderExpanded ? 1 : 0)} className="text-center text-muted py-8">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {visible.map((r, i) => {
              const key = rowKey ? rowKey(r) : i;
              const isOpen = expanded.has(key);
              return (
                <React.Fragment key={key}>
                  <tr
                    className={`${onRowClick || renderExpanded ? "cursor-pointer hover:bg-panel" : ""} ${isOpen ? "bg-panel/60" : ""}`}
                    onClick={
                      renderExpanded
                        ? () => setExpanded((s) => {
                            const n = new Set(s);
                            if (n.has(key)) n.delete(key); else n.add(key);
                            return n;
                          })
                        : (onRowClick ? () => onRowClick(r) : undefined)
                    }
                  >
                    {renderExpanded && (
                      <td className="text-center text-muted">
                        {isOpen ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
                      </td>
                    )}
                    {columns.map((c, ci) => {
                      const isFirst = ci === 0 && stickyFirstCol && !renderExpanded;
                      return (
                        <td
                          key={c.key}
                          className={`${c.align === "right" || c.numeric ? "text-right num" : "text-left"} ${c.className || ""} ${isFirst ? "sticky left-0 z-10 bg-white" : ""}`}
                        >
                          {c.render ? c.render(r, i) : r[c.key]}
                        </td>
                      );
                    })}
                  </tr>
                  {renderExpanded && isOpen && (
                    <tr className="bg-panel/40">
                      <td colSpan={columns.length + 1} className="p-0">
                        <div className="px-4 py-3 border-y border-brand/30">
                          {renderExpanded(r)}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {footerRow && (
            <tfoot className="sticky bottom-0 z-20 bg-panel border-t-2 border-brand/40">
              <tr className="font-semibold">
                {footerRow}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {mobileCards && (
        <MobileCardList
          visible={visible}
          columns={columns}
          emptyLabel={emptyLabel}
          onRowClick={onRowClick}
          sort={sort}
          setSort={setSort}
        />
      )}
    </div>
  );
};

export default SortableTable;

/** Mobile card list — renders each row as a stacked card with the
 * `mobilePrimary` column as headline and remaining (non-hidden) columns
 * as label/value pairs. Only shown on screens < md (768px). Sort is
 * controlled via a compact select so users can still pivot on the go. */
const MobileCardList = ({ visible, columns, emptyLabel, onRowClick, sort, setSort }) => {
  const cardCols = columns.filter((c) => !c.mobileHidden);
  const primaryCol = cardCols.find((c) => c.mobilePrimary) || cardCols[0];
  const detailCols = cardCols.filter((c) => c !== primaryCol);
  const sortableCols = columns.filter((c) => c.sortable !== false && c.label);

  return (
    <div className="md:hidden" data-testid="mobile-card-list">
      {sortableCols.length > 0 && (
        <div className="flex items-center gap-2 mb-2 text-[11.5px]">
          <span className="text-muted">Sort:</span>
          <select
            value={sort ? `${sort.key}|${sort.dir}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) { setSort(null); return; }
              const [key, dir] = v.split("|");
              setSort({ key, dir });
            }}
            className="border border-border rounded px-2 py-1 text-[12px] bg-white"
            data-testid="mobile-sort-select"
          >
            <option value="">Default</option>
            {sortableCols.map((c) => (
              <React.Fragment key={c.key}>
                <option value={`${c.key}|desc`}>{typeof c.label === "string" ? c.label : c.key} · high → low</option>
                <option value={`${c.key}|asc`}>{typeof c.label === "string" ? c.label : c.key} · low → high</option>
              </React.Fragment>
            ))}
          </select>
        </div>
      )}
      {visible.length === 0 ? (
        <div className="text-center text-muted py-8 text-[13px]">{emptyLabel}</div>
      ) : (
        <div className="space-y-2">
          {visible.map((r, i) => (
            <div
              key={i}
              className={`card-white p-3 ${onRowClick ? "cursor-pointer active:bg-panel" : ""}`}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              data-testid="mobile-card"
            >
              <div className="font-semibold text-[13.5px] mb-1.5 break-words">
                {primaryCol.render ? primaryCol.render(r, i) : r[primaryCol.key]}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                {detailCols.map((c) => {
                  const val = c.render ? c.render(r, i) : r[c.key];
                  if (val == null || val === "" || val === false) return null;
                  return (
                    <React.Fragment key={c.key}>
                      <dt className="text-muted uppercase tracking-wider text-[10.5px] self-center">
                        {typeof c.label === "string" ? c.label : c.key}
                      </dt>
                      <dd className={`${c.numeric ? "text-right num" : "text-left"} self-center`}>{val}</dd>
                    </React.Fragment>
                  );
                })}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
