import React from "react";

/**
 * Shared 3-way Active / Retired / All toggle used across Inventory,
 * Products, Exports, SOR All Styles, and SOR L-10.  Value is a string
 * one of "active" | "retired" | "all".
 *
 * Default in callers should be "active" so the live catalog is what
 * leadership sees on first load; "all" stays available for audits.
 */
const ORDER = [
  { value: "active",  label: "Active",  cls: "data-active" },
  { value: "retired", label: "Retired", cls: "data-retired" },
  { value: "all",     label: "All",     cls: "data-all" },
];

const StyleStatusToggle = ({ value, onChange, size = "sm", testIdPrefix = "style-status" }) => {
  const v = value || "active";
  const pad = size === "xs" ? "px-2 py-0.5 text-[10.5px]" : "px-3 py-1 text-[11.5px]";
  return (
    <div
      className="inline-flex rounded-full border border-border overflow-hidden bg-white"
      role="group"
      data-testid={`${testIdPrefix}-toggle`}
      title="Filter rows by style status. Retired styles come from the merch team list (Feb 2026)."
    >
      {ORDER.map((opt) => {
        const active = v === opt.value;
        const tone = active
          ? (opt.value === "retired"
              ? "bg-amber-600 text-white"
              : opt.value === "active"
                ? "bg-emerald-600 text-white"
                : "bg-brand text-white")
          : "bg-white text-foreground hover:bg-panel";
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            data-testid={`${testIdPrefix}-${opt.value}`}
            aria-pressed={active}
            className={`${pad} font-bold ${tone} transition-colors`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default StyleStatusToggle;
