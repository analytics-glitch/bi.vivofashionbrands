import React, { createContext, useContext, useState, useMemo, useCallback } from "react";
import { datePresets } from "@/lib/api";

const FiltersContext = createContext(null);

export const FiltersProvider = ({ children }) => {
  const presets = datePresets();
  // Pending = user-editing values; Applied = live values driving pages
  const [pendingDateFrom, setPendingDateFrom] = useState(presets.this_month.date_from);
  const [pendingDateTo, setPendingDateTo] = useState(presets.this_month.date_to);
  const [pendingPreset, setPendingPreset] = useState("this_month");
  const [pendingCountries, setPendingCountries] = useState([]); // [] = all
  const [pendingChannels, setPendingChannels] = useState([]); // [] = all
  const [pendingCompareMode, setPendingCompareMode] = useState("last_month");

  const [applied, setApplied] = useState({
    dateFrom: presets.this_month.date_from,
    dateTo: presets.this_month.date_to,
    preset: "this_month",
    countries: [],
    channels: [],
    compareMode: "last_month",
  });

  const applyFilters = useCallback(() => {
    setApplied({
      dateFrom: pendingDateFrom,
      dateTo: pendingDateTo,
      preset: pendingPreset,
      countries: pendingCountries,
      channels: pendingChannels,
      compareMode: pendingCompareMode,
    });
  }, [pendingDateFrom, pendingDateTo, pendingPreset, pendingCountries, pendingChannels, pendingCompareMode]);

  const setPreset = useCallback((key) => {
    if (key === "custom") {
      setPendingPreset("custom");
      return;
    }
    const p = datePresets()[key];
    if (!p) return;
    setPendingPreset(key);
    setPendingDateFrom(p.date_from);
    setPendingDateTo(p.date_to);
  }, []);

  const isDirty = useMemo(() => {
    return (
      pendingDateFrom !== applied.dateFrom ||
      pendingDateTo !== applied.dateTo ||
      pendingCompareMode !== applied.compareMode ||
      JSON.stringify(pendingCountries) !== JSON.stringify(applied.countries) ||
      JSON.stringify(pendingChannels) !== JSON.stringify(applied.channels)
    );
  }, [pendingDateFrom, pendingDateTo, pendingCountries, pendingChannels, pendingCompareMode, applied]);

  const value = useMemo(
    () => ({
      pendingDateFrom,
      setPendingDateFrom,
      pendingDateTo,
      setPendingDateTo,
      pendingPreset,
      setPendingPreset,
      setPreset,
      pendingCountries,
      setPendingCountries,
      pendingChannels,
      setPendingChannels,
      pendingCompareMode,
      setPendingCompareMode,
      applied,
      applyFilters,
      isDirty,
    }),
    [
      pendingDateFrom,
      pendingDateTo,
      pendingPreset,
      pendingCountries,
      pendingChannels,
      pendingCompareMode,
      applied,
      applyFilters,
      isDirty,
      setPreset,
    ]
  );

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
};

export const useFilters = () => {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
};
