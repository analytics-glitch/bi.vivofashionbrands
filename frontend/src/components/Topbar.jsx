import React from "react";
import { useFilters } from "@/lib/filters";
import { CalendarBlank, Globe } from "@phosphor-icons/react";

const COUNTRIES = ["all", "Kenya", "Uganda", "Rwanda"];

const Topbar = ({ title, subtitle, showCountry = false }) => {
  const { dateFrom, setDateFrom, dateTo, setDateTo, country, setCountry } =
    useFilters();

  return (
    <header
      className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pb-6 border-b border-border"
      data-testid="topbar"
    >
      <div>
        <div className="eyebrow" data-testid="topbar-breadcrumb">
          Dashboard / {title}
        </div>
        <h1 className="font-display font-black text-3xl md:text-[38px] tracking-tight mt-1">
          {title}
        </h1>
        {subtitle && (
          <p className="text-muted-foreground mt-1 text-sm max-w-xl">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {showCountry && (
          <div className="flex items-center gap-2 card-surface px-3 py-2">
            <Globe size={16} className="text-muted-foreground" />
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              data-testid="filter-country"
              className="bg-transparent text-sm font-medium outline-none cursor-pointer pr-2"
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? "All countries" : c}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2 card-surface px-3 py-2">
          <CalendarBlank size={16} className="text-muted-foreground" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            data-testid="filter-date-from"
            className="bg-transparent text-sm font-medium outline-none"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            data-testid="filter-date-to"
            className="bg-transparent text-sm font-medium outline-none"
          />
        </div>
      </div>
    </header>
  );
};

export default Topbar;
