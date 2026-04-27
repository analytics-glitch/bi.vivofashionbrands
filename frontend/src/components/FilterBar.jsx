import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, datePresets, fmtDate } from "@/lib/api";
import MultiSelect from "@/components/MultiSelect";
import {
  CalendarBlank,
  Globe,
  Storefront,
  ShareNetwork,
  Check,
  CaretDown,
  ArrowsLeftRight,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const COUNTRIES = ["Kenya", "Uganda", "Rwanda", "Online"];

// ---------- Date Range Picker (left presets + dual-month calendar) ----------
const PRESET_GROUPS = [
  {
    label: null,
    items: [
      ["today", "Today"],
      ["yesterday", "Yesterday"],
    ],
  },
  {
    label: "Last",
    items: [
      ["last_7d", "Last 7 days"],
      ["last_30d", "Last 30 days"],
      ["last_90d", "Last 90 days"],
      ["last_365d", "Last 365 days"],
      ["last_week", "Last week"],
      ["last_month", "Last month"],
      ["last_quarter", "Last quarter"],
      ["last_12_months", "Last 12 months"],
      ["last_year", "Last year"],
    ],
  },
  {
    label: "Period to date",
    items: [
      ["mtd", "Month to date"],
      ["qtd", "Quarter to date"],
      ["ytd", "Year to date"],
    ],
  },
];

const DateRangeButton = () => {
  const f = useFilters();
  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState(null);
  const [draftFromInput, setDraftFromInput] = useState(f.dateFrom);
  const [draftToInput, setDraftToInput] = useState(f.dateTo);

  // Sync drafts when popover opens.
  useEffect(() => {
    if (open) {
      setDraftRange({
        from: f.dateFrom ? new Date(f.dateFrom + "T00:00:00") : undefined,
        to: f.dateTo ? new Date(f.dateTo + "T00:00:00") : undefined,
      });
      setDraftFromInput(f.dateFrom);
      setDraftToInput(f.dateTo);
    }
  }, [open, f.dateFrom, f.dateTo]);

  const presets = datePresets();
  const activeLabel = useMemo(() => {
    if (f.preset && f.preset !== "custom" && presets[f.preset]) {
      return presets[f.preset].label;
    }
    if (f.dateFrom && f.dateTo) {
      if (f.dateFrom === f.dateTo) return fmtDate(f.dateFrom);
      return `${fmtDate(f.dateFrom)} → ${fmtDate(f.dateTo)}`;
    }
    return "Select range";
  }, [f.preset, f.dateFrom, f.dateTo, presets]);

  const choosePreset = (key) => {
    if (key === "custom") {
      f.setPresetKey("custom");
      return;
    }
    f.setPreset(key);
    setOpen(false);
  };

  const fmtCalInput = (d) => {
    if (!d) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  };

  const apply = () => {
    if (draftRange?.from) {
      const from = isoOf(draftRange.from);
      const to = isoOf(draftRange.to || draftRange.from);
      f.setDateFrom(from);
      f.setDateTo(to);
      f.setPresetKey("custom");
    } else if (draftFromInput && draftToInput) {
      f.setDateFrom(draftFromInput);
      f.setDateTo(draftToInput);
      f.setPresetKey("custom");
    }
    setOpen(false);
  };

  const today = new Date();
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="date-range-pill"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-white pl-3 pr-2.5 py-1.5 text-[12.5px] font-medium text-foreground/85 hover:border-brand/40 hover:bg-brand-soft/30 transition-colors shadow-sm"
        >
          <CalendarBlank size={14} weight="bold" className="text-brand-deep" />
          <span className="max-w-[180px] truncate">{activeLabel}</span>
          <CaretDown size={12} weight="bold" className="text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="p-0 w-[640px] max-w-[95vw] border border-border bg-white rounded-xl shadow-2xl overflow-hidden"
        data-testid="date-range-panel"
      >
        <div className="flex flex-col sm:flex-row max-h-[80vh]">
          {/* Left preset list */}
          <div className="w-full sm:w-[200px] border-b sm:border-b-0 sm:border-r border-border bg-[#fffaf3] py-2 overflow-y-auto max-h-[300px] sm:max-h-none">
            {PRESET_GROUPS.map((group, gi) => (
              <div key={gi} className="py-1">
                {group.label && (
                  <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                    {group.label}
                  </div>
                )}
                {group.items.map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    data-testid={`preset-${k}`}
                    onClick={() => choosePreset(k)}
                    className={`w-full text-left px-3 py-1.5 text-[12.5px] transition-colors ${
                      f.preset === k
                        ? "bg-brand text-white font-semibold"
                        : "text-foreground/80 hover:bg-brand-soft/60"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            ))}
            <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
              Custom
            </div>
            <button
              type="button"
              data-testid="preset-custom"
              onClick={() => choosePreset("custom")}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] transition-colors ${
                f.preset === "custom"
                  ? "bg-brand text-white font-semibold"
                  : "text-foreground/80 hover:bg-brand-soft/60"
              }`}
            >
              Custom range
            </button>
          </div>
          {/* Right calendar panel */}
          <div className="flex-1 p-3 sm:p-4">
            {/* Date inputs */}
            <div className="flex items-center gap-2 mb-3">
              <input
                type="date"
                value={draftFromInput}
                onChange={(e) => {
                  setDraftFromInput(e.target.value);
                  if (e.target.value) {
                    setDraftRange((r) => ({ ...r, from: new Date(e.target.value + "T00:00:00") }));
                  }
                }}
                data-testid="date-input-from"
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-border text-[12px] outline-none focus:border-brand"
              />
              <span className="text-muted text-[14px]">→</span>
              <input
                type="date"
                value={draftToInput}
                onChange={(e) => {
                  setDraftToInput(e.target.value);
                  if (e.target.value) {
                    setDraftRange((r) => ({ ...r, to: new Date(e.target.value + "T00:00:00") }));
                  }
                }}
                data-testid="date-input-to"
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-border text-[12px] outline-none focus:border-brand"
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled
                      className="p-1.5 rounded-lg border border-border text-muted opacity-50 cursor-not-allowed"
                      aria-label="Time picker"
                    >
                      <ClockCounterClockwise size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Time picker coming soon
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {/* Dual-month calendar */}
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draftRange}
              defaultMonth={lastMonth}
              onSelect={(r) => {
                setDraftRange(r);
                if (r?.from) setDraftFromInput(isoOf(r.from));
                if (r?.to) setDraftToInput(isoOf(r.to));
              }}
              disabled={{ after: today }}
              className="p-0"
            />
            {/* Footer */}
            <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-border">
              <button
                type="button"
                data-testid="date-range-cancel"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-foreground/70 hover:bg-panel"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="date-range-apply"
                onClick={apply}
                className="px-4 py-1.5 rounded-lg text-[12.5px] font-semibold bg-brand text-white hover:bg-brand-deep transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

const isoOf = (d) => {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// ---------- Comparison Period Button ----------
const COMPARE_OPTIONS = [
  ["none", "No comparison"],
  ["yesterday", "Yesterday"],
  ["last_year", "Previous year"],
  ["last_year_dow", "Previous year (match day of week)"],
  ["custom", "Custom"],
];

const CompareButton = () => {
  const f = useFilters();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(f.compareDateFrom || "");
  const [draftTo, setDraftTo] = useState(f.compareDateTo || "");

  useEffect(() => {
    if (open) {
      setDraftFrom(f.compareDateFrom || "");
      setDraftTo(f.compareDateTo || "");
    }
  }, [open, f.compareDateFrom, f.compareDateTo]);

  const activeLabel =
    COMPARE_OPTIONS.find(([k]) => k === f.compareMode)?.[1] || "No comparison";

  const choose = (k) => {
    if (k === "custom") {
      f.setCompareMode("custom");
      // Don't close — let user pick dates
      return;
    }
    f.setCompareMode(k);
    setOpen(false);
  };

  const applyCustom = () => {
    if (draftFrom && draftTo) {
      f.setCompareDateFrom(draftFrom);
      f.setCompareDateTo(draftTo);
      f.setCompareMode("custom");
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="compare-pill"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-white pl-3 pr-2.5 py-1.5 text-[12.5px] font-medium text-foreground/85 hover:border-brand/40 hover:bg-brand-soft/30 transition-colors shadow-sm"
        >
          <CalendarBlank size={14} weight="bold" className="text-brand-deep" />
          <span className="max-w-[200px] truncate">{activeLabel}</span>
          <CaretDown size={12} weight="bold" className="text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="p-1.5 w-[280px] border border-border bg-white rounded-xl shadow-2xl"
        data-testid="compare-panel"
      >
        {COMPARE_OPTIONS.map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            data-testid={`compare-option-${k}`}
            onClick={() => choose(k)}
            className={`w-full text-left px-3 py-2 rounded-md text-[12.5px] transition-colors ${
              f.compareMode === k
                ? "bg-brand text-white font-semibold"
                : "text-foreground/80 hover:bg-brand-soft/60"
            }`}
          >
            {lbl}
          </button>
        ))}
        {f.compareMode === "custom" && (
          <div className="border-t border-border mt-1.5 pt-2 px-2 pb-1 space-y-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">
              Compare against
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                data-testid="compare-custom-from"
                className="flex-1 min-w-0 px-2 py-1 rounded-md border border-border text-[12px] outline-none focus:border-brand"
              />
              <span className="text-muted">→</span>
              <input
                type="date"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                data-testid="compare-custom-to"
                className="flex-1 min-w-0 px-2 py-1 rounded-md border border-border text-[12px] outline-none focus:border-brand"
              />
            </div>
            <button
              type="button"
              data-testid="compare-custom-apply"
              onClick={applyCustom}
              disabled={!draftFrom || !draftTo}
              className="w-full px-3 py-1.5 rounded-md text-[12px] font-semibold bg-brand text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-deep transition-colors"
            >
              Apply custom range
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

// ---------- Currency Selector (cosmetic only — locked to KES for now) ----------
const CurrencyButton = () => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="currency-pill"
            disabled
            className="inline-flex items-center gap-2 rounded-full border border-border bg-white pl-3 pr-2.5 py-1.5 text-[12.5px] font-semibold text-foreground/85 opacity-90 cursor-not-allowed shadow-sm"
          >
            <ArrowsLeftRight size={14} weight="bold" className="text-brand-deep" />
            <span>KES</span>
            <CaretDown size={12} weight="bold" className="text-muted" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          Multi-currency coming soon — KES locked for now
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// ---------- Mobile filters trigger (collapses everything into a sheet) ----------
const MobileFiltersSheet = ({ children }) => {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          data-testid="mobile-filters-button"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1.5 text-[12.5px] font-medium text-foreground/85 hover:border-brand/40 transition-colors shadow-sm"
        >
          <CalendarBlank size={14} weight="bold" className="text-brand-deep" />
          Filters
          <CaretDown size={12} weight="bold" className="text-muted" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl pt-4"
        data-testid="mobile-filters-sheet"
      >
        <SheetTitle className="text-[15px] font-bold mb-3">Filters</SheetTitle>
        <div className="space-y-3 pb-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
};

// ---------- Main FilterBar ----------
const FilterBar = () => {
  const f = useFilters();
  const [locations, setLocations] = useState([]);
  const [shareCopied, setShareCopied] = useState(false);

  const handleShare = async () => {
    const url = f.buildShareableLink?.() || window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1600);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  useEffect(() => {
    api
      .get("/analytics/active-pos")
      .then((r) => setLocations(r.data || []))
      .catch(() => setLocations([]));
  }, []);

  const channelOptions = useMemo(() => {
    const ONLINE_CHANNELS = [
      { channel: "Online - Shop Zetu", country: "Online" },
      { channel: "Online - Vivo", country: "Online" },
    ];
    const merged = [...locations];
    for (const oc of ONLINE_CHANNELS) {
      if (!merged.some((l) => l.channel === oc.channel)) merged.push(oc);
    }
    const filtered =
      f.countries.length === 0
        ? merged
        : merged.filter((l) => f.countries.includes(l.country));
    return filtered.map((l) => ({
      value: l.channel,
      label: l.channel,
      group: l.country,
    }));
  }, [locations, f.countries]);

  const countryOptions = COUNTRIES.map((c) => ({ value: c, label: c }));

  // Inner controls — used both inline (desktop) and inside the mobile sheet.
  const ControlsInline = (
    <>
      <DateRangeButton />
      <CompareButton />
      <CurrencyButton />
      <MultiSelect
        testId="filter-countries"
        label="Country"
        icon={Globe}
        options={countryOptions}
        value={f.countries}
        onChange={(v) => {
          f.setCountries(v);
          f.setChannels([]);
        }}
        placeholder="All countries"
        width={170}
      />
      <MultiSelect
        testId="filter-channels"
        label="POS"
        icon={Storefront}
        options={channelOptions}
        value={f.channels}
        onChange={f.setChannels}
        placeholder="All POS"
        width={200}
      />
    </>
  );

  return (
    <div
      className="bg-[#fed7aa] border-b border-border px-3 sm:px-5 lg:px-10 py-2 sm:py-3 no-print"
      data-testid="filter-bar"
    >
      {/* Desktop layout */}
      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
        {ControlsInline}
        <button
          type="button"
          onClick={handleShare}
          data-testid="share-filter-link"
          title="Copy a shareable link to this filtered view."
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all ml-auto ${
            shareCopied
              ? "bg-[#059669] text-white border border-[#059669]"
              : "bg-white text-foreground/80 border border-border hover:border-brand/40 hover:bg-brand-soft/50"
          }`}
        >
          {shareCopied ? (
            <>
              <Check size={13} weight="bold" /> Copied
            </>
          ) : (
            <>
              <ShareNetwork size={13} weight="bold" /> Share view
            </>
          )}
        </button>
      </div>

      {/* Mobile layout — single Filters button + Share */}
      <div className="flex md:hidden items-center gap-2">
        <MobileFiltersSheet>{ControlsInline}</MobileFiltersSheet>
        <button
          type="button"
          onClick={handleShare}
          data-testid="share-filter-link-mobile"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11.5px] font-semibold transition-all ml-auto ${
            shareCopied
              ? "bg-[#059669] text-white border border-[#059669]"
              : "bg-white text-foreground/80 border border-border"
          }`}
        >
          {shareCopied ? (
            <>
              <Check size={12} weight="bold" /> Copied
            </>
          ) : (
            <>
              <ShareNetwork size={12} weight="bold" /> Share
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default FilterBar;
