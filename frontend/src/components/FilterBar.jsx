import React, { useEffect, useState, useMemo } from "react";
import { useFilters } from "@/lib/filters";
import { api, datePresets } from "@/lib/api";
import MultiSelect from "@/components/MultiSelect";
import { CalendarBlank, Globe, Storefront } from "@phosphor-icons/react";

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
      f.countries.length === 0
        ? locations
        : locations.filter((l) => f.countries.includes(l.country));
    return filtered.map((l) => ({
      value: l.channel,
      label: l.channel,
      group: l.country,
    }));
  }, [locations, f.countries]);

  const countryOptions = COUNTRIES.map((c) => ({ value: c, label: c }));

  return (
    <div
      className="sticky top-[64px] z-30 bg-white border-b border-border px-6 lg:px-10 py-3 no-print"
      data-testid="filter-bar"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1 mr-1">
          {presetKeys.map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`preset-${k}`}
              onClick={() => f.setPreset(k)}
              className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                f.preset === k
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
            onClick={() => f.setPresetKey("custom")}
            className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              f.preset === "custom"
                ? "bg-brand text-white"
                : "text-foreground/70 hover:bg-panel"
            }`}
          >
            Custom
          </button>
        </div>

        <div className="flex items-center gap-1.5 input-pill">
          <CalendarBlank size={14} className="text-muted" />
          <input
            type="date"
            value={f.dateFrom}
            onChange={(e) => {
              f.setDateFrom(e.target.value);
              f.setPresetKey("custom");
            }}
            data-testid="filter-date-from"
            className="bg-transparent text-[13px] font-medium outline-none"
          />
          <span className="text-muted text-[12px]">→</span>
          <input
            type="date"
            value={f.dateTo}
            onChange={(e) => {
              f.setDateTo(e.target.value);
              f.setPresetKey("custom");
            }}
            data-testid="filter-date-to"
            className="bg-transparent text-[13px] font-medium outline-none"
          />
        </div>

        <MultiSelect
          testId="filter-countries"
          label="Country"
          icon={Globe}
          options={countryOptions}
          value={f.countries}
          onChange={(v) => {
            f.setCountries(v);
            f.setChannels([]);
          }}
          placeholder="All countries"
          width={195}
        />

        <MultiSelect
          testId="filter-channels"
          label="Channel"
          icon={Storefront}
          options={channelOptions}
          value={f.channels}
          onChange={f.setChannels}
          placeholder="All channels"
          width={240}
        />

        <div className="flex items-center gap-1 ml-2">
          <span className="text-[11px] text-muted uppercase tracking-wider mr-1">
            Compare:
          </span>
          {[
            ["none", "None"],
            ["last_month", "vs Last Month"],
            ["last_year", "vs Last Year"],
          ].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              data-testid={`compare-${k}`}
              onClick={() => f.setCompareMode(k)}
              className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                f.compareMode === k
                  ? "bg-brand-soft text-brand-deep border border-brand/30"
                  : "text-foreground/70 border border-transparent hover:bg-panel"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FilterBar;
