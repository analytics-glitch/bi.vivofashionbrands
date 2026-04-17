import React, { createContext, useContext, useState, useMemo } from "react";
import { firstOfMonthISO, todayISO } from "@/lib/api";

const FiltersContext = createContext(null);

export const FiltersProvider = ({ children }) => {
  const [dateFrom, setDateFrom] = useState(firstOfMonthISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [country, setCountry] = useState("all");
  const [location, setLocation] = useState("all");

  const value = useMemo(
    () => ({
      dateFrom,
      setDateFrom,
      dateTo,
      setDateTo,
      country,
      setCountry,
      location,
      setLocation,
    }),
    [dateFrom, dateTo, country, location]
  );
  return (
    <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
  );
};

export const useFilters = () => {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
};
