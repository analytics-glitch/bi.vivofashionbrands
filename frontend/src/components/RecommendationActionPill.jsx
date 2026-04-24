import React, { useState } from "react";
import { Check, X, ArrowCounterClockwise, CaretDown } from "@phosphor-icons/react";
import { STATUS_CONFIG } from "@/lib/useRecommendationState";

/**
 * Per-row action pill for Re-Order / IBT lists.
 *
 * Props:
 *   state    — object from the hook (or undefined for pending)
 *   onChange — (status, {note}) => Promise | void
 *   compact  — if true, renders as a small single-button pill with dropdown;
 *              otherwise renders inline status + action buttons
 */
export const RecommendationActionPill = ({ state, onChange, itemKey, label = "action" }) => {
  const [open, setOpen] = useState(false);
  const status = state?.status || "pending";
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  const act = (s) => {
    setOpen(false);
    let note = null;
    if (s === "dismissed") {
      const reason = window.prompt("Reason for dismissing? (optional)") || "";
      note = reason.trim() || null;
    }
    onChange(s, { note });
  };

  return (
    <div className="relative inline-flex items-center gap-1" data-testid={`reco-action-${itemKey}`}>
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${cfg.chip}`}
        title={state?.note || undefined}
      >
        {status === "po_raised" && <Check size={10} weight="bold" />}
        {status === "dismissed" && <X size={10} weight="bold" />}
        {status === "done" && <Check size={10} weight="bold" />}
        {cfg.label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold bg-white border border-border hover:border-brand/60 transition-colors"
        data-testid={`reco-toggle-${itemKey}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Change ${label} status`}
      >
        Change <CaretDown size={10} weight="bold" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 min-w-[150px] rounded-lg bg-white shadow-lg border border-border py-1"
          role="menu"
        >
          {status !== "po_raised" && (
            <MenuItem onClick={() => act("po_raised")} testId={`reco-${itemKey}-po`}>
              <Check size={11} /> Mark PO raised
            </MenuItem>
          )}
          {status !== "done" && (
            <MenuItem onClick={() => act("done")} testId={`reco-${itemKey}-done`}>
              <Check size={11} /> Mark done
            </MenuItem>
          )}
          {status !== "dismissed" && (
            <MenuItem onClick={() => act("dismissed")} testId={`reco-${itemKey}-dismiss`}>
              <X size={11} /> Dismiss…
            </MenuItem>
          )}
          {status !== "pending" && (
            <MenuItem onClick={() => act("pending")} testId={`reco-${itemKey}-reset`}>
              <ArrowCounterClockwise size={11} /> Reset
            </MenuItem>
          )}
        </div>
      )}
    </div>
  );
};

const MenuItem = ({ onClick, testId, children }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11.5px] text-foreground/90 hover:bg-brand/10 transition-colors"
    role="menuitem"
  >
    {children}
  </button>
);

export default RecommendationActionPill;
