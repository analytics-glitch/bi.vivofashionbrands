import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, Empty } from "@/components/common";
import { ArrowRight } from "@phosphor-icons/react";
import { useTableSort, SortableTh } from "@/lib/useTableSort";

/**
 * SKU-level (color × size) breakdown for a single IBT recommendation.
 * Lazy-loaded when the user expands an IBT row — keeps the table snappy
 * because the upstream /inventory call is per-store and ~1–2 s cold.
 *
 * Allocation logic comes from the backend (`suggested_qty` per SKU).
 * Hidden zero-suggestion rows by default so the warehouse picker sees
 * the actionable list first; a small toggle reveals the rest.
 */
const IBTSkuBreakdown = ({ row }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // Iter 89 — Hooks must be called unconditionally before any
  // early return below.
  const { sort, toggleSort, sortRows } = useTableSort();

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    api
      .get("/analytics/ibt-sku-breakdown", {
        params: {
          style_name: row.style_name,
          from_store: row.from_store,
          to_store: row.to_store,
          units_to_move: row.units_to_move,
        },
        timeout: 60000,
      })
      .then((r) => { if (!cancel) setData(r.data || null); })
      .catch((e) => { if (!cancel) setError(e?.response?.data?.detail || e.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [row.style_name, row.from_store, row.to_store, row.units_to_move]);

  const visible = data && data.skus?.length
    ? (showAll ? data.skus : data.skus.filter((s) => s.suggested_qty > 0))
    : [];
  const sortedVisible = useMemo(
    () => sortRows(visible, {
      sku: (r) => r.sku,
      color: (r) => r.color,
      size: (r) => r.size,
      from_available: (r) => Number(r.from_available ?? 0),
      to_available: (r) => Number(r.to_available ?? 0),
      suggested_qty: (r) => Number(r.suggested_qty ?? 0),
    }),
    [sortRows, visible],
  );

  if (loading) return <Loading label="Loading SKU breakdown…" />;
  if (error) return <ErrorBox message={error} />;
  if (!data || !data.skus?.length) {
    return <Empty label="No SKU-level inventory available for this style at the source / destination." />;
  }

  const hiddenCount = data.skus.length - visible.length;

  return (
    <div data-testid={`ibt-sku-breakdown-${row.style_name}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[12px] text-muted">
          <span className="font-semibold text-foreground">{data.skus.length} SKUs</span> at <b>{data.from_store}</b> ({fmtNum(data.from_total)} total) ·
          <ArrowRight size={11} weight="bold" className="inline mx-1 text-brand" />
          <b>{data.to_store}</b> ({fmtNum(data.to_total)} total) · suggested transfer:
          <span className="ml-1 pill-green num font-bold">{fmtNum(data.suggested_total)} units</span>
        </div>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="text-[11px] text-brand-deep hover:text-brand underline"
            onClick={() => setShowAll((v) => !v)}
            data-testid="ibt-sku-toggle-all"
          >
            {showAll ? "Hide non-actionable SKUs" : `Show ${hiddenCount} more SKUs`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full data text-[12px]">
          <thead className="bg-white">
            <tr>
              <SortableTh sortKey="sku" sort={sort} onSort={toggleSort}>SKU</SortableTh>
              <SortableTh sortKey="color" sort={sort} onSort={toggleSort}>Color</SortableTh>
              <SortableTh sortKey="size" sort={sort} onSort={toggleSort}>Size</SortableTh>
              <SortableTh sortKey="from_available" sort={sort} onSort={toggleSort} numeric>Stock at FROM</SortableTh>
              <SortableTh sortKey="to_available" sort={sort} onSort={toggleSort} numeric>Stock at TO</SortableTh>
              <SortableTh sortKey="suggested_qty" sort={sort} onSort={toggleSort} numeric>Suggested Qty</SortableTh>
            </tr>
          </thead>
          <tbody>
            {sortedVisible.map((s) => (
              <tr key={s.sku} className={s.suggested_qty > 0 ? "" : "opacity-60"}>
                <td className="font-mono text-[11px]">{s.sku}</td>
                <td>{s.color}</td>
                <td>{s.size}</td>
                <td className="text-right num">{fmtNum(s.from_available)}</td>
                <td className="text-right num">{fmtNum(s.to_available)}</td>
                <td className="text-right num">
                  {s.suggested_qty > 0 ? (
                    <span className="pill-green font-bold">{fmtNum(s.suggested_qty)}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] text-muted italic mt-2">
        Allocation: fill SKUs that are out-of-stock at TO first, drawing from SKUs with the largest excess at FROM.
        Source keeps a 1-unit safety buffer when stock {">"}2.
      </p>
    </div>
  );
};

export default IBTSkuBreakdown;
