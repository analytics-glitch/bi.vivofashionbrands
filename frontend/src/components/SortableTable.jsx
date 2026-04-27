import React, { useMemo, useState } from "react";
import { CaretUp, CaretDown, Download } from "@phosphor-icons/react";
import { toast } from "sonner";

/** Download rows as CSV and show a success toast. */
export const exportCSV = (rows, columns, filename = "export.csv") => {
  const header = columns.map((c) => `"${(c.label || c.key).replace(/"/g, '""')}"`).join(",");
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const v = typeof c.csv === "function" ? c.csv(r) : r[c.key];
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
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
}) => {
  const [sort, setSort] = useState(initialSort || null); // { key, dir }
  const [limit, setLimit] = useState(pageSize || null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    const getVal = (r) => (col.sortValue ? col.sortValue(r) : r[sort.key]);
    return [...rows].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, columns]);

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
              {columns.map((c, ci) => {
                const isFirst = ci === 0 && stickyFirstCol;
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
                <td colSpan={columns.length} className="text-center text-muted py-8">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {visible.map((r, i) => (
              <tr
                key={i}
                className={onRowClick ? "cursor-pointer hover:bg-panel" : undefined}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map((c, ci) => {
                  const isFirst = ci === 0 && stickyFirstCol;
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
            ))}
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
