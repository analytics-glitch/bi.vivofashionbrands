import React, { useMemo, useState } from "react";
import { CaretUp, CaretDown, Download } from "@phosphor-icons/react";

/** Download rows as CSV */
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
};

/**
 * Reusable sortable table with CSV export.
 * columns = [{ key, label, align, sortable = true, render, csv, width, numeric }]
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
      <div className="overflow-x-auto">
        <table className="w-full data">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.align === "right" || c.numeric ? "text-right" : "text-left"} ${c.sortable === false ? "" : "cursor-pointer hover:text-brand"} select-none`}
                  onClick={() => toggleSort(c.key)}
                  style={c.width ? { width: c.width } : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort && sort.key === c.key && (sort.dir === "asc" ? <CaretUp size={11} /> : <CaretDown size={11} />)}
                  </span>
                </th>
              ))}
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
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`${c.align === "right" || c.numeric ? "text-right num" : "text-left"} ${c.className || ""}`}
                  >
                    {c.render ? c.render(r, i) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SortableTable;
