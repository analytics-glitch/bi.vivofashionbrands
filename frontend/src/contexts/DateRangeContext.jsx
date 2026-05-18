import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { daysAgo, today } from "@/lib/api";

const STORAGE_KEY = "vivo.globalDateRange.v1";

const defaultRange = () => ({
  from: daysAgo(89),
  to: today(),
  label: "Last 90 days",
});

// Auto-compute the previous-period compare range for a given main range.
export function priorPeriod(from, to) {
  const f = new Date(from);
  const t = new Date(to);
  const span = Math.max(1, Math.round((t - f) / 86400000) + 1);
  const prevTo = new Date(f);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (span - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo), label: "Previous period" };
}

const loadFromStorage = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const r = defaultRange();
      return { range: r, compare: priorPeriod(r.from, r.to), compareOn: false };
    }
    const v = JSON.parse(raw);
    if (v?.range?.from && v?.range?.to) {
      return {
        range: { from: v.range.from, to: v.range.to, label: v.range.label || "Custom" },
        compare: v.compare?.from && v.compare?.to
          ? { from: v.compare.from, to: v.compare.to, label: v.compare.label || "Previous period" }
          : priorPeriod(v.range.from, v.range.to),
        compareOn: !!v.compareOn,
      };
    }
  } catch { /* ignore */ }
  const r = defaultRange();
  return { range: r, compare: priorPeriod(r.from, r.to), compareOn: false };
};

const DateRangeContext = createContext(null);

export function DateRangeProvider({ children }) {
  const [state, setState] = useState(loadFromStorage);

  const persist = useCallback((next) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const setRange = useCallback((next) => {
    setState((prev) => {
      const merged = { ...prev.range, ...next };
      // Auto-shift compare to "previous period" of the new main range.
      const compare = priorPeriod(merged.from, merged.to);
      const out = { ...prev, range: merged, compare };
      persist(out);
      return out;
    });
  }, [persist]);

  const setCompare = useCallback((next) => {
    setState((prev) => {
      const merged = { ...prev.compare, ...next };
      const out = { ...prev, compare: merged };
      persist(out);
      return out;
    });
  }, [persist]);

  const setCompareOn = useCallback((on) => {
    setState((prev) => {
      const out = { ...prev, compareOn: !!on };
      persist(out);
      return out;
    });
  }, [persist]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try { setState(JSON.parse(e.newValue)); } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => {
    const from = new Date(state.range.from);
    const to = new Date(state.range.to);
    const days = Math.max(1, Math.round((to - from) / 86400000) + 1);
    return {
      range: state.range,
      compare: state.compare,
      compareOn: state.compareOn,
      windowDays: days,
      setRange,
      setCompare,
      setCompareOn,
    };
  }, [state, setRange, setCompare, setCompareOn]);

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) {
    const r = defaultRange();
    return {
      range: r,
      compare: priorPeriod(r.from, r.to),
      compareOn: false,
      windowDays: 90,
      setRange: () => {},
      setCompare: () => {},
      setCompareOn: () => {},
    };
  }
  return ctx;
}
