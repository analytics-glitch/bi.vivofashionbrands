import React, { createContext, useContext, useState, useMemo, useCallback } from "react";
import { datePresets } from "@/lib/api";
import { api } from "@/lib/api";
import { invalidateKpis } from "@/lib/useKpis";

const FiltersContext = createContext(null);

export const FiltersProvider = ({ children }) => {
  const presets = datePresets();
  const [dateFrom, setDateFrom] = useState(presets.today.date_from);
  const [dateTo, setDateTo] = useState(presets.today.date_to);
  const [preset, setPresetKey] = useState("today");
  const [countries, setCountries] = useState([]); // [] = all
  const [channels, setChannels] = useState([]); // [] = all
  const [compareMode, setCompareMode] = useState("last_month");
  const [dataVersion, setDataVersion] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  const setPreset = (key) => {
    if (key === "custom") {
      setPresetKey("custom");
      return;
    }
    const p = datePresets()[key];
    if (!p) return;
    setPresetKey(key);
    setDateFrom(p.date_from);
    setDateTo(p.date_to);
  };

  const refresh = useCallback(async () => {
    // Bust server-side caches (inventory fan-out etc.), clear the shared
    // in-memory KPI cache, then bump the client-side dataVersion to force
    // every page to re-fetch.
    try {
      await api.post("/admin/cache-clear");
    } catch {
      /* non-fatal — still bump dataVersion */
    }
    invalidateKpis();
    setDataVersion((v) => v + 1);
  }, []);
  const touchLastUpdated = useCallback(() => setLastUpdated(new Date()), []);

  // Applied object (same as live values — auto-apply)
  const applied = useMemo(
    () => ({ dateFrom, dateTo, countries, channels, compareMode, dataVersion }),
    [dateFrom, dateTo, countries, channels, compareMode, dataVersion]
  );

  const value = useMemo(
    () => ({
      dateFrom, setDateFrom,
      dateTo, setDateTo,
      preset, setPresetKey, setPreset,
      countries, setCountries,
      channels, setChannels,
      compareMode, setCompareMode,
      dataVersion, refresh,
      lastUpdated, touchLastUpdated,
      applied,
    }),
    [dateFrom, dateTo, preset, countries, channels, compareMode, dataVersion, refresh, lastUpdated, touchLastUpdated, applied]
  );
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
};

export const useFilters = () => {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
};
