import React, { useState } from "react";
import { api } from "@/lib/api";
import { X, CheckCircle } from "@phosphor-icons/react";

/**
 * Mark-as-Done modal — captures PO#, transfer date, completed-by name
 * and actual units moved before sending to /api/ibt/complete.
 */
export default function IBTMarkAsDoneModal({ row, onClose, onSubmitted }) {
  const today = new Date().toISOString().slice(0, 10);
  const [poNumber, setPoNumber] = useState("");
  const [completedByName, setCompletedByName] = useState("");
  const [transferDate, setTransferDate] = useState(today);
  const [actualUnits, setActualUnits] = useState(
    row?.actual_units_moved
    ?? row?.units_to_move
    ?? row?.suggested_qty
    ?? 0
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!row) return null;
  const flow = row.flow || (row.from_store === "Warehouse Finished Goods" ? "warehouse_to_store" : "store_to_store");
  const fromStore = row.from_store || (flow === "warehouse_to_store" ? "Warehouse Finished Goods" : "");
  const toStore = row.to_store;
  const suggestedUnits = row.units_to_move ?? row.suggested_qty ?? 0;
  // SKU-level identifiers (when Mark-As-Done is fired from a flat-table row).
  const skuLine = [row.color, row.size, row.sku, row.barcode]
    .filter(Boolean)
    .join(" · ");

  const submit = async (e) => {
    e.preventDefault();
    if (!poNumber.trim() || !completedByName.trim() || !transferDate) {
      setError("PO number, completed-by name and transfer date are required.");
      return;
    }
    if (Number(actualUnits) < 1) {
      setError("Actual units must be at least 1.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/ibt/complete", {
        style_name: row.style_name,
        brand: row.brand || null,
        subcategory: row.subcategory || null,
        from_store: fromStore,
        to_store: toStore,
        units_to_move: Number(suggestedUnits),
        actual_units_moved: Number(actualUnits),
        po_number: poNumber.trim(),
        completed_by_name: completedByName.trim(),
        transfer_date: transferDate,
        flow,
        sku: row.sku || null,
        color: row.color || null,
        size: row.size || null,
        barcode: row.barcode || null,
      });
      onSubmitted?.();
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      data-testid="ibt-done-modal"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="size-9 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center">
            <CheckCircle size={20} weight="fill" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-extrabold text-[15px] text-[#0f3d24]">Mark transfer as done</h2>
            <p className="text-[12px] text-muted mt-0.5 break-words">
              <span className="font-semibold">{row.style_name}</span> · {fromStore} → <span className="text-brand font-semibold">{toStore}</span>
            </p>
            {skuLine && (
              <p className="text-[11px] text-brand-deep mt-0.5 font-mono break-words" data-testid="ibt-done-sku-line">
                {skuLine}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded" data-testid="ibt-done-modal-close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="eyebrow block mb-1">Transfer date</label>
              <input
                type="date"
                value={transferDate}
                max={today}
                onChange={(e) => setTransferDate(e.target.value)}
                className="input-pill w-full"
                data-testid="ibt-done-transfer-date"
                required
              />
            </div>
            <div>
              <label className="eyebrow block mb-1">Actual units moved</label>
              <input
                type="number"
                min={1}
                max={suggestedUnits || 9999}
                value={actualUnits}
                onChange={(e) => setActualUnits(Number(e.target.value) || 0)}
                className="input-pill w-full"
                data-testid="ibt-done-actual-units"
                required
              />
              <div className="text-[10.5px] text-muted mt-0.5">
                Suggested: {suggestedUnits}
              </div>
            </div>
          </div>
          <div>
            <label className="eyebrow block mb-1">PO number</label>
            <input
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="e.g. PO-2026-0451"
              className="input-pill w-full"
              data-testid="ibt-done-po"
              required
            />
          </div>
          <div>
            <label className="eyebrow block mb-1">Completed by (your name)</label>
            <input
              value={completedByName}
              onChange={(e) => setCompletedByName(e.target.value)}
              placeholder="Full name"
              className="input-pill w-full"
              data-testid="ibt-done-name"
              required
            />
          </div>

          {error && (
            <div className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] font-semibold text-muted hover:text-foreground px-3 py-2"
              data-testid="ibt-done-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-[#1a5c38] hover:bg-[#0f3d24] px-4 py-2 rounded-md disabled:opacity-50"
              data-testid="ibt-done-submit"
            >
              {submitting ? "Saving…" : "Mark as done"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
