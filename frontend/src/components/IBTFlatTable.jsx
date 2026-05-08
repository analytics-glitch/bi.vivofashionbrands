import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, Empty } from "@/components/common";
import { ArrowRight, CheckCircle, MagnifyingGlass } from "@phosphor-icons/react";

/**
 * Flat SKU-level IBT table.
 *
 * Replaces the older "row → expand → SKU table" pattern. Every
 * (suggestion × SKU) becomes its own row with Color / Size / SKU /
 * Barcode columns visible inline plus a per-row "Actual transferred"
 * input. A single "Mark as Done" pill per row opens the existing
 * modal pre-populated with that SKU's totals.
 *
 * Tablet-friendly:
 *   • horizontal scroll only when the viewport actually can't hold the
 *     columns; the inner table uses `min-w-max` so columns size to
 *     content rather than getting squeezed
 *   • bigger touch targets (py-3 cells, 36px input height, 32px button)
 *   • sticky first column (Style) so users can scan across stores
 *     without losing context on iPad split-screen
 *
 * Props:
 *   suggestions   : array from /analytics/ibt-suggestions OR
 *                   /analytics/ibt-warehouse-to-store
 *   flow          : "store_to_store" | "warehouse_to_store"
 *   onMarkDone    : (skuRow) => void  — opens the parent modal
 *   completedKeys : Set of `${style}||${to_store}` already actioned
 *   testId        : root testid (default "ibt-flat-table")
 *   emptyLabel    : string when no rows
 */
const _isWh = (flow) => flow === "warehouse_to_store";

// In-memory cache of SKU breakdowns keyed by (style|from|to|qty) so
// switching filters / re-sorting doesn't refetch the same fan-out.
const _skuCache = new Map();

const useFlatRows = (suggestions, flow) => {
  const [skuByKey, setSkuByKey] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!suggestions?.length) {
      setSkuByKey(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setProgress(0);

    const next = new Map(skuByKey);
    let done = 0;
    const total = suggestions.length;

    const fetchOne = async (s) => {
      const fromStore = _isWh(flow) ? "Warehouse Finished Goods" : s.from_store;
      const units = _isWh(flow) ? s.suggested_qty : s.units_to_move;
      const cacheKey = `${s.style_name}||${fromStore}||${s.to_store}||${units}`;
      if (_skuCache.has(cacheKey)) {
        next.set(cacheKey, _skuCache.get(cacheKey));
        return;
      }
      try {
        const { data } = await api.get("/analytics/ibt-sku-breakdown", {
          params: {
            style_name: s.style_name,
            from_store: fromStore,
            to_store: s.to_store,
            units_to_move: units,
          },
          timeout: 60000,
        });
        const skus = (data?.skus || []).filter((x) => x.suggested_qty > 0);
        _skuCache.set(cacheKey, skus);
        next.set(cacheKey, skus);
      } catch {
        _skuCache.set(cacheKey, []);
        next.set(cacheKey, []);
      }
    };

    // Run with bounded concurrency so we don't hammer the upstream.
    const CONCURRENCY = 6;
    const queue = suggestions.slice();
    const worker = async () => {
      while (queue.length) {
        const s = queue.shift();
        if (!s || cancelled) return;
        await fetchOne(s);
        done += 1;
        if (!cancelled) setProgress(Math.round((done / total) * 100));
      }
    };
    Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() => {
      if (!cancelled) {
        setSkuByKey(next);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, flow]);

  return { skuByKey, loading, progress };
};

export default function IBTFlatTable({
  suggestions,
  flow,
  onMarkDone,
  completedSkuKeys = new Set(),
  testId = "ibt-flat-table",
  emptyLabel = "No transfer opportunities for the current window.",
}) {
  const visibleSuggestions = suggestions;

  const { skuByKey, loading, progress } = useFlatRows(visibleSuggestions, flow);

  // Per-(skuKey) state for the actual-transferred inline input.
  const [actuals, setActuals] = useState({}); // skuRowKey → number string
  const setActual = (k, v) => setActuals((prev) => ({ ...prev, [k]: v }));

  const [search, setSearch] = useState("");

  const flatRows = useMemo(() => {
    const out = [];
    for (const s of visibleSuggestions) {
      const fromStore = _isWh(flow) ? "Warehouse Finished Goods" : s.from_store;
      const units = _isWh(flow) ? s.suggested_qty : s.units_to_move;
      const cacheKey = `${s.style_name}||${fromStore}||${s.to_store}||${units}`;
      const skus = skuByKey.get(cacheKey) || [];
      if (skus.length === 0) {
        // Render a stub row even when SKU breakdown not yet ready, so
        // the table doesn't appear empty during the fan-out.
        out.push({
          __stub: true,
          rowKey: `${s.style_name}||${s.to_store}||__stub`,
          style_name: s.style_name,
          brand: s.brand,
          subcategory: s.subcategory,
          from_store: fromStore,
          to_store: s.to_store,
          color: "",
          size: "",
          sku: "",
          barcode: "",
          suggested_qty: units,
          parent: s,
        });
        continue;
      }
      for (const sk of skus) {
        out.push({
          rowKey: `${s.style_name}||${s.to_store}||${sk.sku}`,
          style_name: s.style_name,
          brand: s.brand,
          subcategory: s.subcategory,
          from_store: fromStore,
          to_store: s.to_store,
          color: sk.color || "—",
          size: sk.size || "—",
          sku: sk.sku,
          barcode: sk.barcode || "",
          from_available: sk.from_available,
          to_available: sk.to_available,
          suggested_qty: sk.suggested_qty,
          parent: s,
        });
      }
    }
    return out;
  }, [visibleSuggestions, skuByKey, flow]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flatRows.filter((r) => {
      // SKU-level hide for already-actioned rows.
      if (r.sku && completedSkuKeys.has(`${r.style_name}||${r.to_store}||${r.sku}`)) {
        return false;
      }
      if (!q) return true;
      return (
        (r.style_name || "").toLowerCase().includes(q)
        || (r.from_store || "").toLowerCase().includes(q)
        || (r.to_store || "").toLowerCase().includes(q)
        || (r.color || "").toLowerCase().includes(q)
        || (r.size || "").toLowerCase().includes(q)
        || (r.sku || "").toLowerCase().includes(q)
        || (r.barcode || "").toLowerCase().includes(q)
      );
    });
  }, [flatRows, search, completedSkuKeys]);

  const handleMarkDone = (r) => {
    const actual = actuals[r.rowKey];
    onMarkDone?.({
      ...r.parent,
      from_store: r.from_store,
      to_store: r.to_store,
      style_name: r.style_name,
      brand: r.brand,
      subcategory: r.subcategory,
      // Pre-fill the modal with the per-SKU detail.
      suggested_qty: r.suggested_qty,
      units_to_move: r.suggested_qty,
      actual_units_moved: actual !== undefined && actual !== ""
        ? Number(actual)
        : r.suggested_qty,
      sku: r.sku,
      color: r.color,
      size: r.size,
      barcode: r.barcode,
      flow: flow || (r.from_store === "Warehouse Finished Goods" ? "warehouse_to_store" : "store_to_store"),
    });
  };

  const exportCSV = () => {
    const header = ["Style", "Brand", "Subcategory", "From Store", "To Store",
      "Color", "Size", "SKU", "Barcode", "Stock at FROM", "Stock at TO",
      "Suggested Qty", "Actual Transferred"];
    const out = [header];
    for (const r of filteredRows) {
      out.push([
        r.style_name, r.brand || "", r.subcategory || "",
        r.from_store, r.to_store,
        r.color, r.size, r.sku, r.barcode,
        r.from_available ?? "", r.to_available ?? "",
        r.suggested_qty,
        actuals[r.rowKey] ?? "",
      ]);
    }
    const csv = out.map((row) =>
      row.map((cell) => {
        const v = cell == null ? "" : String(cell);
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(",")
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `ibt-${flow || "store-to-store"}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  if (visibleSuggestions.length === 0) {
    return <Empty label={emptyLabel} />;
  }

  return (
    <div data-testid={testId} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 input-pill flex-1 min-w-[220px]">
          <MagnifyingGlass size={14} className="text-muted" />
          <input
            placeholder="Search style, store, color, size, SKU, barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid={`${testId}-search`}
            className="bg-transparent outline-none text-[13px] w-full"
          />
        </div>
        <button
          type="button"
          onClick={exportCSV}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-brand hover:bg-brand-deep px-3 py-2 rounded-md"
          data-testid={`${testId}-export`}
        >
          Export CSV
        </button>
        {loading && (
          <span className="text-[11px] text-muted">
            Loading SKU details… {progress}%
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-white" data-testid={`${testId}-scroll`}>
        <table className="w-full min-w-max text-[12.5px]">
          <thead className="bg-panel sticky top-0 z-10">
            <tr className="text-left">
              <th className="px-3 py-2.5 font-semibold sticky left-0 bg-panel z-20 min-w-[180px] max-w-[260px]">Style</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">From</th>
              <th className="px-2 py-2.5"></th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">To</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Color</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Size</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">SKU</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Barcode</th>
              <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Suggested</th>
              <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Actual transferred</th>
              <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && !loading && (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-muted">No matches.</td></tr>
            )}
            {filteredRows.map((r, idx) => (
              <tr
                key={r.rowKey}
                className={`border-t border-border/50 ${idx % 2 === 0 ? "bg-white" : "bg-panel/30"} hover:bg-amber-50/40`}
                data-testid={`${testId}-row-${idx}`}
              >
                <td className="px-3 py-3 sticky left-0 bg-inherit z-[5] min-w-[180px] max-w-[260px]">
                  <div className="font-semibold text-[12.5px] break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                    {r.style_name}
                  </div>
                  <div className="text-[10.5px] text-muted mt-0.5">{r.brand} · {r.subcategory}</div>
                </td>
                <td className="px-3 py-3 whitespace-nowrap font-medium">{r.from_store}</td>
                <td className="px-2 py-3 text-brand"><ArrowRight size={14} weight="bold" /></td>
                <td className="px-3 py-3 whitespace-nowrap font-semibold text-brand">{r.to_store}</td>
                <td className="px-3 py-3 whitespace-nowrap">{r.color || "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap">{r.size || "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap font-mono text-[11px]">{r.sku || "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap font-mono text-[11px]">{r.barcode || "—"}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  <span className="pill-green font-bold">{fmtNum(r.suggested_qty || 0)}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder={String(r.suggested_qty || 0)}
                    value={actuals[r.rowKey] ?? ""}
                    onChange={(e) => setActual(r.rowKey, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-20 h-9 px-2 text-right tabular-nums border border-border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                    data-testid={`${testId}-actual-${idx}`}
                    aria-label={`Actual transferred for ${r.sku || r.style_name}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => handleMarkDone(r)}
                    disabled={r.__stub}
                    className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-md whitespace-nowrap"
                    data-testid={`${testId}-mark-as-done-${idx}`}
                    title="Mark this SKU's transfer as completed — log PO# and date"
                  >
                    <CheckCircle size={13} weight="fill" /> Mark As Done
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && (
        <div className="px-2 py-2"><Loading label={`Loading SKU details… ${progress}%`} /></div>
      )}
    </div>
  );
}
