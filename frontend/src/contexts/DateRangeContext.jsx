import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { daysAgo, today } from "@/lib/api";

const STORAGE_KEY = "vivo.globalDateRange.v1";

const defaultRange = () => ({
  from: daysAgo(89),
  to: today(),
  label: "Last 90 days",
});

const loadFromStorage = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultRange();
    const v = JSON.parse(raw);
    if (v && v.from && v.to) return { from: v.from, to: v.to, label: v.label || "Custom" };
  } catch { /* ignore */ }
  return defaultRange();
};

const DateRangeContext = createContext(null);

export function DateRangeProvider({ children }) {
  const [range, setRangeState] = useState(loadFromStorage);

  const setRange = useCallback((next) => {
    setRangeState((prev) => {
      const merged = { ...prev, ...next };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  }, []);

  // Sync across browser tabs.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try { setRangeState(JSON.parse(e.newValue)); } catch { /* ignore */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(() => {
    const from = new Date(range.from);
    const to = new Date(range.to);
    const days = Math.max(1, Math.round((to - from) / 86400000) + 1);
    return { range, setRange, windowDays: days };
  }, [range, setRange]);

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) {
    // Fallback in case provider isn't mounted (defensive — shouldn't happen in app)
    return { range: defaultRange(), setRange: () => {}, windowDays: 90 };
  }
  return ctx;
}
