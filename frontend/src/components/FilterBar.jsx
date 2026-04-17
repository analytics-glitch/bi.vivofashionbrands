import React, { useEffect, useState, useMemo } from "react";
import { useFilters } from "@/lib/filters";
import { api, datePresets } from "@/lib/api";
import MultiSelect from "@/components/MultiSelect";
import {
  CalendarBlank,
  Globe,
  Storefront,
  Check,
  ArrowsClockwise,
} from "@phosphor-icons/react";

const COUNTRIES = ["Kenya", "Uganda", "Rwanda", "Online"];

const FilterBar = () => {
  const f = useFilters();
  const [locations, setLocations] = useState([]);

  useEffect(() => {
    api
      .get("/locations")
      .then((r) => setLocations(r.data || []))
      .catch(() => setLocations([]));
  }, []);

  const presets = datePresets();
  const presetKeys = ["today", "this_week", "this_month", "last_month", "this_year"];

  const channelOptions = useMemo(() => {
    const filtered =
      f.pendingCountries.length === 0
        ? locations
        : locations.filter((l) => f.pendingCountries.includes(l.country));
    return filtered.map((l) => ({
      value: l.channel,
      label: l.channel,
      group: l.country,
    }));
  }, [locations, f.pendingCountries]);

  const countryOptions = COUNTRIES.map((c) => ({ value: c, label: c }));

  return (
    <div
      className="sticky top-[64px] z-30 bg-white border-b border-border px-6 lg:px-10 py-3 no-print"
      data-testid="filter-bar"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Quick presets */}
        <div className="flex items-center gap-1 mr-1">
          {presetKeys.map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`preset-${k}`}
              onClick={() => f.setPreset(k)}
              className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                f.pendingPreset === k
                  ? "bg-brand text-white"
                  : "text-foreground/70 hover:bg-panel"
              }`}
            >
              {presets[k].label}
            </button>
          ))}
          <button
            type="button"
            data-testid="preset-custom"
            onClick={() => f.setPendingPreset("custom")}
            className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              f.pendingPreset === "custom"
                ? "bg-brand text-white"
                : "text-foreground/70 hover:bg-panel"
            }`}
          >
            Custom
          </button>
        </div>

        {/* Date range inputs */}
        <div className="flex items-center gap-1.5 input-pill">
          <CalendarBlank size={14} className="text-muted" />
          <input
            type="date"
            value={f.pendingDateFrom}
            onChange={(e) => {
              f.setPendingDateFrom(e.target.value);
              f.setPendingPreset("custom");
            }}
            data-testid="filter-date-from"
            className="bg-transparent text-[13px] font-medium outline-none"
          />
          <span className="text-muted text-[12px]">→</span>
          <input
            type="date"
            value={f.pendingDateTo}
            onChange={(e) => {
              f.setPendingDateTo(e.target.value);
              f.setPendingPreset("custom");
            }}
            data-testid="filter-date-to"
            className="bg-transparent text-[13px] font-medium outline-none"
          />
        </div>

        {/* Country multi-select */}
        <MultiSelect
          testId="filter-countries"
          label="Country"
          icon={Globe}
          options={countryOptions}
          value={f.pendingCountries}
          onChange={(v) => {
            f.setPendingCountries(v);
            // Reset channel selection when country changes
            if (f.pendingChannels.length) {
              const allowed = new Set(
                v.length === 0
                  ? []
                  : v
              );
              // keep channels whose country is still included
              // (we don't have country-per-channel in current state, so drop all)
              f.setPendingChannels([]);
            }
          }}
          placeholder="All countries"
          width={195}
        />

        {/* Channel multi-select */}
        <MultiSelect
          testId="filter-channels"
          label="Channel"
          icon={Storefront}
          options={channelOptions}
          value={f.pendingChannels}
          onChange={f.setPendingChannels}
          placeholder="All channels"
          width={240}
        />

        {/* Compare */}
        <div className="flex items-center gap-1 ml-2">
          <span className="text-[11px] text-muted uppercase tracking-wider mr-1">
            Compare:
          </span>
          {[
            ["none", "None"],
            ["last_month", "Last Month"],
            ["last_year", "Last Year"],
          ].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              data-testid={`compare-${k}`}
              onClick={() => f.setPendingCompareMode(k)}
              className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                f.pendingCompareMode === k
                  ? "bg-brand-soft text-brand-deep border border-brand/30"
                  : "text-foreground/70 border border-transparent hover:bg-panel"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={f.applyFilters}
          data-testid="apply-filters"
          className={`btn-primary flex items-center gap-1.5 ${
            f.isDirty ? "" : "opacity-80"
          }`}
        >
          {f.isDirty ? (
            <ArrowsClockwise size={14} weight="bold" />
          ) : (
            <Check size={14} weight="bold" />
          )}
          Apply Filters
        </button>
      </div>
    </div>
  );
};

export default FilterBar;
