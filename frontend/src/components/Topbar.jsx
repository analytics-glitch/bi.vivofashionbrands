import React, { useEffect, useState, useMemo } from "react";
import { useFilters } from "@/lib/filters";
import { api, storeToCountry } from "@/lib/api";
import { CalendarBlank, Globe, Storefront } from "@phosphor-icons/react";

const COUNTRIES = ["all", "Kenya", "Uganda", "Rwanda"];

const Topbar = ({
  title,
  subtitle,
  showCountry = true,
  showLocation = true,
  showDates = true,
  right = null,
}) => {
  const {
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    country,
    setCountry,
    location,
    setLocation,
  } = useFilters();

  const [locations, setLocations] = useState([]);

  useEffect(() => {
    if (!showLocation) return;
    api
      .get("/locations")
      .then((r) => setLocations(r.data || []))
      .catch(() => {});
  }, [showLocation]);

  const filteredLocations = useMemo(() => {
    if (country === "all") return locations;
    return locations.filter((l) => l.country === country);
  }, [locations, country]);

  return (
    <header
      className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 pb-6 border-b border-border"
      data-testid="topbar"
    >
      <div>
        <div className="eyebrow" data-testid="topbar-breadcrumb">
          Dashboard · {title}
        </div>
        <h1 className="font-sans font-extrabold text-[30px] md:text-[36px] tracking-tight mt-1 leading-[1.05] text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="text-muted mt-1.5 text-sm max-w-2xl">{subtitle}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {showCountry && (
          <div className="flex items-center gap-2 input-pill">
            <Globe size={15} className="text-muted" />
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setLocation("all");
              }}
              data-testid="filter-country"
              className="bg-transparent text-sm font-medium outline-none cursor-pointer pr-1"
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? "All countries" : c}
                </option>
              ))}
            </select>
          </div>
        )}
        {showLocation && (
          <div className="flex items-center gap-2 input-pill">
            <Storefront size={15} className="text-muted" />
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              data-testid="filter-location"
              className="bg-transparent text-sm font-medium outline-none cursor-pointer pr-1 max-w-[200px]"
            >
              <option value="all">All locations</option>
              {filteredLocations.map((l) => (
                <option key={l.location} value={l.location}>
                  {l.location}
                </option>
              ))}
            </select>
          </div>
        )}
        {showDates && (
          <div className="flex items-center gap-2 input-pill">
            <CalendarBlank size={15} className="text-muted" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              data-testid="filter-date-from"
              className="bg-transparent text-sm font-medium outline-none"
            />
            <span className="text-muted">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              data-testid="filter-date-to"
              className="bg-transparent text-sm font-medium outline-none"
            />
          </div>
        )}
        {right}
      </div>
    </header>
  );
};

export default Topbar;
