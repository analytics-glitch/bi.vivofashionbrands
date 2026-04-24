import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";

/**
 * useRecommendationState — per-user persisted action state for
 * Re-Order and IBT rows (audit recommendation #5: close the loop).
 *
 * Usage:
 *   const { stateByKey, setState, loading } = useRecommendationState("reorder");
 *   const row = stateByKey.get(style.style_name); // undefined means "pending"
 *   setState(style.style_name, "po_raised", { note: "draft to factory" });
 *
 * The backend treats `pending` as absence-of-record, so we mirror that
 * on the frontend: `stateByKey.get(key)` returns undefined for pending.
 */
export const useRecommendationState = (itemType) => {
  const [stateByKey, setStateByKey] = useState(new Map());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    return api.get("/recommendations", { params: { item_type: itemType } })
      .then(({ data }) => {
        const m = new Map();
        (data || []).forEach((r) => m.set(r.item_key, r));
        setStateByKey(m);
      })
      .catch(() => { /* decorative — pending is the default */ })
      .finally(() => setLoading(false));
  }, [itemType]);

  useEffect(() => { refresh(); }, [refresh]);

  const setState = useCallback(async (itemKey, status, { note } = {}) => {
    // Optimistic — update UI first, rollback on failure.
    const prev = new Map(stateByKey);
    const next = new Map(stateByKey);
    if (status === "pending") next.delete(itemKey);
    else next.set(itemKey, { item_type: itemType, item_key: itemKey, status, note });
    setStateByKey(next);
    try {
      await api.post("/recommendations", {
        item_type: itemType, item_key: itemKey, status, note: note || null,
      });
      const labels = {
        po_raised: "PO raised",
        dismissed: "Dismissed",
        done: "Marked done",
        pending: "Reset to pending",
      };
      toast.success(`${labels[status] || status} · ${itemKey.slice(0, 40)}${itemKey.length > 40 ? "…" : ""}`);
    } catch (e) {
      setStateByKey(prev);
      toast.error("Couldn't save — try again");
    }
  }, [itemType, stateByKey]);

  return { stateByKey, setState, loading, refresh };
};

export const STATUS_CONFIG = {
  pending:   { label: "Pending",    chip: "bg-brand/10 text-brand-deep border-brand/30" },
  po_raised: { label: "PO raised",  chip: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  dismissed: { label: "Dismissed",  chip: "bg-neutral-100 text-neutral-600 border-neutral-300" },
  done:      { label: "Done",       chip: "bg-sky-100 text-sky-800 border-sky-300" },
};
