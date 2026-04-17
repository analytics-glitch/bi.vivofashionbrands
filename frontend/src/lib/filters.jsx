import React, { createContext, useContext, useState, useMemo } from "react";

const FiltersContext = createContext(null);

export const FiltersProvider = ({ children }) => {
  // Default matches API default range where data exists
  const [dateFrom, setDateFrom] = useState("2026-04-01");
  const [dateTo, setDateTo] = useState("2026-04-17");
  const [country, setCountry] = useState("all");

  const value = useMemo(
    () => ({ dateFrom, setDateFrom, dateTo, setDateTo, country, setCountry }),
    [dateFrom, dateTo, country]
  );
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
};

export const useFilters = () => {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
};
