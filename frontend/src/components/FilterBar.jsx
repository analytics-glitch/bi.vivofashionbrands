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
    // Only active physical store POS locations — excludes online, warehouse,
    // and any location with no sales in last 30 days.
    api
      .get("/analytics/active-pos")
      .then((r) => setLocations(r.data || []))
      .catch(() => setLocations([]));
  }, []);

  const presets = datePresets();
  const presetKeys = ["yesterday", "today", "this_week", "this_month", "last_month", "this_year"];

  const channelOptions = useMemo(() => {
    // Always append the online channels since /analytics/active-pos only
    // returns physical stores.
    const ONLINE_CHANNELS = [
      { channel: "Online - Shop Zetu", country: "Online" },
      { channel: "Online - Vivo", country: "Online" },
    ];
    const merged = [...locations];
    for (const oc of ONLINE_CHANNELS) {
      if (!merged.some((l) => l.channel === oc.channel)) merged.push(oc);
    }
    const filtered =
      f.countries.length === 0
        ? merged
        : merged.filter((l) => f.countries.includes(l.country));
    return filtered.map((l) => ({
      value: l.channel,
      label: l.channel,
      group: l.country,
    }));
  }, [locations, f.countries]);

  const countryOptions = COUNTRIES.map((c) => ({ value: c, label: c }));

  return (
    <div
      className="fixed !top-[60px] sm:!top-[70px] lg:!top-[88px] !left-0 !right-0 z-30 bg-[#fed7aa] border-b border-border px-3 sm:px-5 lg:px-10 py-2 sm:py-3 no-print"
      data-testid="filter-bar"
    >
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
        <div className="flex items-center gap-1 flex-wrap">
          {presetKeys.map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`preset-${k}`}
              onClick={() => f.setPreset(k)}
              className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-[12px] font-medium transition-colors ${
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
            className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-[12px] font-medium transition-colors ${
              f.preset === "custom"
                ? "bg-brand text-white"
                : "text-foreground/70 hover:bg-panel"
            }`}
          >
            Custom
          </button>
        </div>

        <div className="flex items-center gap-1 input-pill">
          <CalendarBlank size={14} className="text-muted" />
          <input
            type="date"
            value={f.dateFrom}
            onChange={(e) => {
              f.setDateFrom(e.target.value);
              f.setPresetKey("custom");
            }}
            data-testid="filter-date-from"
            className="bg-transparent text-[12px] sm:text-[13px] font-medium outline-none"
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
            className="bg-transparent text-[12px] sm:text-[13px] font-medium outline-none"
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
          width={180}
        />

        <MultiSelect
          testId="filter-channels"
          label="POS"
          icon={Storefront}
          options={channelOptions}
          value={f.channels}
          onChange={f.setChannels}
          placeholder="All POS"
          width={220}
        />

        <div className="flex items-center gap-1">
          <span className="hidden sm:inline text-[11px] text-muted uppercase tracking-wider mr-1">
            Compare:
          </span>
          {[
            ["none", "None"],
            ["yesterday", "vs Yd"],
            ["last_month", "vs LM"],
            ["last_year", "vs LY"],
          ].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              data-testid={`compare-${k}`}
              onClick={() => f.setCompareMode(k)}
              className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-[12px] font-medium transition-colors ${
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
