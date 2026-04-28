import React, { useState, useRef, useEffect } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

/**
 * Multi-select dropdown with checkboxes.
 * value = [] means "All" (nothing selected == all).
 */
const MultiSelect = ({
  label,
  icon: Icon,
  options, // [{value, label, group?}]
  value, // string[]
  onChange,
  placeholder = "All",
  width = 220,
  testId,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) {
      // Listen for both mouse AND touch so the dropdown dismisses cleanly
      // on iOS/Android where synthetic mousedown can arrive late or be
      // swallowed by gesture handlers (Radix Sheet swipe-to-dismiss, etc.).
      document.addEventListener("mousedown", onClick);
      document.addEventListener("touchstart", onClick, { passive: true });
    }
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("touchstart", onClick);
    };
  }, [open]);

  const toggle = (v) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  const clearAll = () => onChange([]);
  const selectAll = () => onChange(options.map((o) => o.value));

  // Group by .group if present
  const grouped = options.reduce((acc, o) => {
    const g = o.group || "";
    (acc[g] = acc[g] || []).push(o);
    return acc;
  }, {});

  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
      ? value[0]
      : `${value.length} selected`;

  return (
    <div
      ref={ref}
      className="relative w-full md:w-auto"
      // Desktop width comes from the `width` prop; mobile stays full-width
      // so the dropdown can't overflow the Filters bottom-sheet and clip
      // options beneath the visible sheet area.
      style={typeof window !== "undefined" && window.innerWidth >= 768 ? { width } : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
        className="input-pill w-full flex items-center gap-2 justify-between"
      >
        <span className="flex items-center gap-2 min-w-0">
          {Icon && <Icon size={14} className="text-muted shrink-0" />}
          <span className="text-[12px] text-muted shrink-0">{label}:</span>
          <span
            className="text-[13px] font-medium truncate"
            title={value.join(", ")}
          >
            {summary}
          </span>
        </span>
        <CaretDown size={12} className="text-muted shrink-0" />
      </button>
      {open && (
        <div
          // Mobile: inline (flows with the sheet content — no clipping).
          // Desktop (md+): absolute so the dropdown floats above page content.
          className="relative md:absolute z-50 mt-1 md:left-0 md:right-0 card-white shadow-lg max-h-[60vh] md:max-h-[340px] overflow-y-auto"
          data-testid={`${testId}-dropdown`}
        >
          <div className="flex items-center justify-between p-2 border-b border-border text-[11px]">
            <button
              className="text-brand font-medium hover:underline"
              onClick={selectAll}
              type="button"
            >
              Select all
            </button>
            <button
              className="text-muted hover:underline"
              onClick={clearAll}
              type="button"
            >
              Clear
            </button>
          </div>
          {Object.entries(grouped).map(([g, opts]) => (
            <div key={g}>
              {g && (
                <div className="eyebrow px-3 pt-2 pb-1 bg-panel sticky top-0">
                  {g}
                </div>
              )}
              {opts.map((o) => {
                const sel = value.includes(o.value);
                return (
                  <button
                    type="button"
                    key={o.value}
                    onClick={() => toggle(o.value)}
                    data-testid={`${testId}-opt-${o.value}`}
                    // Bigger tap targets on mobile (py-2.5 ≈ 40px tall).
                    className={`flex items-center gap-2 px-3 py-2.5 md:py-1.5 w-full text-left text-[13px] hover:bg-panel active:bg-brand-soft ${
                      sel ? "text-brand-deep font-medium" : "text-foreground"
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded border grid place-items-center shrink-0 ${
                        sel
                          ? "bg-brand border-brand text-white"
                          : "border-border bg-white"
                      }`}
                    >
                      {sel && <Check size={11} weight="bold" />}
                    </span>
                    <span className="truncate" title={o.label}>
                      {o.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
