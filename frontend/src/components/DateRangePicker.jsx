import React, { useMemo, useState } from "react";
import { Calendar as CalendarIcon, History } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---- helpers ---------------------------------------------------------------

const PAD = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
const fromISO = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const todayDate = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const minusDays = (days) => {
  const d = todayDate();
  d.setDate(d.getDate() - days);
  return d;
};

const startOfWeek = (d) => {
  // ISO week starts Mon
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  x.setDate(x.getDate() + diff);
  return x;
};
const endOfWeek = (d) => {
  const s = startOfWeek(d);
  s.setDate(s.getDate() + 6);
  return s;
};
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfQuarter = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const endOfQuarter = (d) => {
  const s = startOfQuarter(d);
  return new Date(s.getFullYear(), s.getMonth() + 3, 0);
};
const startOfYear = (d) => new Date(d.getFullYear(), 0, 1);
const endOfYear = (d) => new Date(d.getFullYear(), 11, 31);

const PRESETS = [
  { id: "today",      label: "Today",         build: () => { const t = todayDate(); return { from: t, to: t }; } },
  { id: "yesterday",  label: "Yesterday",     build: () => { const y = minusDays(1); return { from: y, to: y }; }, group: "" },
  // LAST
  { id: "last_7",     label: "Last 7 days",   group: "LAST", build: () => ({ from: minusDays(6), to: todayDate() }) },
  { id: "last_30",    label: "Last 30 days",  group: "LAST", build: () => ({ from: minusDays(29), to: todayDate() }) },
  { id: "last_90",    label: "Last 90 days",  group: "LAST", build: () => ({ from: minusDays(89), to: todayDate() }) },
  { id: "last_365",   label: "Last 365 days", group: "LAST", build: () => ({ from: minusDays(364), to: todayDate() }) },
  { id: "last_week",  label: "Last week",     group: "LAST", build: () => {
      const lw = minusDays(7);
      return { from: startOfWeek(lw), to: endOfWeek(lw) };
  } },
  { id: "last_month", label: "Last month",    group: "LAST", build: () => {
      const t = todayDate();
      const lm = new Date(t.getFullYear(), t.getMonth() - 1, 15);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
  } },
  { id: "last_quarter", label: "Last quarter", group: "LAST", build: () => {
      const t = todayDate();
      const lq = new Date(t.getFullYear(), t.getMonth() - 3, 15);
      return { from: startOfQuarter(lq), to: endOfQuarter(lq) };
  } },
  { id: "last_12m",   label: "Last 12 months", group: "LAST", build: () => {
      const t = todayDate();
      const start = new Date(t.getFullYear(), t.getMonth() - 12, t.getDate());
      return { from: start, to: t };
  } },
  { id: "last_year",  label: "Last year",     group: "LAST", build: () => {
      const t = todayDate();
      const ly = new Date(t.getFullYear() - 1, 0, 1);
      return { from: ly, to: new Date(t.getFullYear() - 1, 11, 31) };
  } },
  // PERIOD TO DATE
  { id: "mtd",        label: "Month to date",   group: "PERIOD TO DATE", build: () => ({ from: startOfMonth(todayDate()), to: todayDate() }) },
  { id: "qtd",        label: "Quarter to date", group: "PERIOD TO DATE", build: () => ({ from: startOfQuarter(todayDate()), to: todayDate() }) },
  { id: "ytd",        label: "Year to date",    group: "PERIOD TO DATE", build: () => ({ from: startOfYear(todayDate()), to: todayDate() }) },
];

function presetMatchesLabel(presetId) {
  return PRESETS.find((p) => p.id === presetId)?.label || null;
}

function detectPreset(from, to) {
  if (!from || !to) return "custom";
  for (const p of PRESETS) {
    const r = p.build();
    if (toISO(r.from) === toISO(from) && toISO(r.to) === toISO(to)) return p.id;
  }
  return "custom";
}

// ---- component -------------------------------------------------------------

/**
 * Reusable date range picker matching enterprise dashboards.
 * Props:
 *   value: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }   (strings)
 *   onChange: ({ from, to, label }) => void
 *   defaultPreset: 'today' | 'last_30' | 'mtd' | ... (used if value is empty)
 *   align: 'start' | 'end'   (popover alignment)
 *   testid: string
 *   buttonClassName: string
 */
export function DateRangePicker({
  value,
  onChange,
  defaultPreset = "today",
  align = "start",
  testid = "date-range-picker",
  buttonClassName = "",
  minDate,
  maxDate,
}) {
  const initial = useMemo(() => {
    if (value?.from && value?.to) return { from: fromISO(value.from), to: fromISO(value.to) };
    const preset = PRESETS.find((p) => p.id === defaultPreset) || PRESETS[0];
    return preset.build();
  }, [value?.from, value?.to, defaultPreset]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [activePreset, setActivePreset] = useState(() => detectPreset(initial.from, initial.to));

  const applyPreset = (preset) => {
    const r = preset.build();
    setDraft(r);
    setActivePreset(preset.id);
  };

  const apply = () => {
    if (!draft?.from || !draft?.to) return;
    const from = toISO(draft.from);
    const to = toISO(draft.to);
    const label = presetMatchesLabel(activePreset) || "Custom";
    onChange?.({ from, to, label });
    setOpen(false);
  };

  const cancel = () => {
    setDraft(initial);
    setActivePreset(detectPreset(initial.from, initial.to));
    setOpen(false);
  };

  // Display string for the button
  const buttonLabel = (() => {
    const fromStr = value?.from || toISO(initial.from);
    const toStr = value?.to || toISO(initial.to);
    const matched = PRESETS.find((p) => {
      const r = p.build();
      return toISO(r.from) === fromStr && toISO(r.to) === toStr;
    });
    if (matched) return matched.label;
    if (fromStr === toStr) return fromStr;
    return `${fromStr} → ${toStr}`;
  })();

  const grouped = useMemo(() => {
    const out = { top: [], LAST: [], "PERIOD TO DATE": [] };
    for (const p of PRESETS) {
      if (!p.group) out.top.push(p);
      else out[p.group].push(p);
    }
    return out;
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          className={`inline-flex items-center gap-2 h-10 px-3 text-sm rounded-sm border border-[var(--vivo-border)] bg-white hover:bg-[var(--vivo-bg)] transition ${buttonClassName}`}
        >
          <CalendarIcon className="h-4 w-4 text-[var(--vivo-navy)]" />
          <span className="font-medium truncate max-w-[260px]">{buttonLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="p-0 w-auto rounded-sm" data-testid={`${testid}-popover`}>
        <div className="flex">
          {/* Presets sidebar */}
          <div className="w-44 max-h-[440px] overflow-y-auto border-r border-[var(--vivo-border)] py-3 text-sm">
            {grouped.top.map((p) => (
              <PresetRow key={p.id} preset={p} active={activePreset === p.id} onClick={() => applyPreset(p)} />
            ))}
            <GroupLabel>LAST</GroupLabel>
            {grouped.LAST.map((p) => (
              <PresetRow key={p.id} preset={p} active={activePreset === p.id} onClick={() => applyPreset(p)} />
            ))}
            <GroupLabel>PERIOD TO DATE</GroupLabel>
            {grouped["PERIOD TO DATE"].map((p) => (
              <PresetRow key={p.id} preset={p} active={activePreset === p.id} onClick={() => applyPreset(p)} />
            ))}
            <GroupLabel>CUSTOM</GroupLabel>
            <PresetRow
              preset={{ id: "custom", label: "Custom range" }}
              active={activePreset === "custom"}
              onClick={() => setActivePreset("custom")}
            />
          </div>

          {/* Calendar */}
          <div className="p-4 min-w-[560px]">
            <div className="flex items-center gap-2 mb-3">
              <Input
                type="date"
                value={draft.from ? toISO(draft.from) : ""}
                onChange={(e) => {
                  const d = fromISO(e.target.value);
                  if (d) {
                    setDraft((s) => ({ ...s, from: d, to: s.to && d > s.to ? d : s.to }));
                    setActivePreset("custom");
                  }
                }}
                className="rounded-sm h-9"
                data-testid={`${testid}-from`}
              />
              <span className="text-[var(--vivo-muted)]">→</span>
              <Input
                type="date"
                value={draft.to ? toISO(draft.to) : ""}
                onChange={(e) => {
                  const d = fromISO(e.target.value);
                  if (d) {
                    setDraft((s) => ({ ...s, to: d, from: s.from && d < s.from ? d : s.from }));
                    setActivePreset("custom");
                  }
                }}
                className="rounded-sm h-9"
                data-testid={`${testid}-to`}
              />
              <button
                type="button"
                title="Reset to today"
                className="h-9 w-9 inline-flex items-center justify-center rounded-sm border border-[var(--vivo-border)] text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)]"
                onClick={() => applyPreset(PRESETS[0])}
                data-testid={`${testid}-reset`}
              >
                <History className="h-4 w-4" />
              </button>
            </div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={(range) => {
                if (range) {
                  setDraft({ from: range.from, to: range.to || range.from });
                  setActivePreset("custom");
                }
              }}
              defaultMonth={draft.from || todayDate()}
              disabled={(date) => (minDate && date < fromISO(minDate)) || (maxDate && date > fromISO(maxDate))}
              data-testid={`${testid}-calendar`}
            />
            <div className="flex items-center justify-end gap-2 mt-3">
              <Button variant="ghost" onClick={cancel} className="rounded-sm" data-testid={`${testid}-cancel`}>
                Cancel
              </Button>
              <Button
                onClick={apply}
                className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy)]/90 text-white"
                data-testid={`${testid}-apply`}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PresetRow({ preset, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`preset-${preset.id}`}
      className={`w-full text-left px-4 py-2 transition ${
        active
          ? "bg-[var(--vivo-navy)] text-white font-medium"
          : "text-[var(--vivo-text)] hover:bg-[var(--vivo-bg)]"
      }`}
    >
      {preset.label}
    </button>
  );
}

function GroupLabel({ children }) {
  return (
    <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">
      {children}
    </div>
  );
}

export default DateRangePicker;
