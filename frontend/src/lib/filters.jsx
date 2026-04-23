import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { datePresets } from "@/lib/api";
import { api } from "@/lib/api";
import { invalidateKpis } from "@/lib/useKpis";

const FiltersContext = createContext(null);

// ---- URL serialisation helpers (short, stable keys) ----
// d  = date_from (ISO)
// t  = date_to   (ISO)
// p  = preset    (today|yesterday|this_week|this_month|last_month|this_year|custom)
// co = countries (comma-separated)
// ch = channels  (comma-separated, URL-encoded)
// cm = compareMode (none|last_month|last_year)
const VALID_PRESETS = new Set(["yesterday", "today", "this_week", "this_month", "last_month", "this_year", "custom"]);
const VALID_COMPARE = new Set(["none", "yesterday", "last_month", "last_year"]);
const VALID_VAT = new Set(["excl", "incl"]);
const ALL_COUNTRIES = new Set(["Kenya", "Uganda", "Rwanda", "Online"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readUrlParams() {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  const out = {};
  if (p.has("d")) out.d = p.get("d");
  if (p.has("t")) out.t = p.get("t");
  if (p.has("p")) out.p = p.get("p");
  if (p.has("co")) out.co = p.get("co");
  if (p.has("ch")) out.ch = p.get("ch");
  if (p.has("cm")) out.cm = p.get("cm");
  if (p.has("v")) out.v = p.get("v");
  return Object.keys(out).length ? out : null;
}

function writeUrlParams(state) {
  if (typeof window === "undefined") return;
  const defaults = datePresets().today;
  const next = new URLSearchParams(window.location.search);
  const put = (k, v, isDefault) => {
    if (v && !isDefault) next.set(k, v);
    else next.delete(k);
  };
  // Only emit params that differ from defaults (today preset, no countries,
  // no channels, compareMode=last_month).
  put("p", state.preset, state.preset === "today");
  put("d", state.dateFrom, state.preset === "today" && state.dateFrom === defaults.date_from);
  put("t", state.dateTo, state.preset === "today" && state.dateTo === defaults.date_to);
  put("co", state.countries.join(","), state.countries.length === 0);
  put("ch", state.channels.join(","), state.channels.length === 0);
  put("cm", state.compareMode, state.compareMode === "last_month");
  put("v", state.vatMode, state.vatMode === "excl");
  const qs = next.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
  window.history.replaceState(null, "", url);
}

export const FiltersProvider = ({ children }) => {
  const urlParams = useRef(readUrlParams()).current;
  const presets = datePresets();

  // Seed initial state from URL (if present) else defaults.
  const initialPreset = urlParams?.p && VALID_PRESETS.has(urlParams.p) ? urlParams.p : "today";
  const initialFrom = urlParams?.d && ISO_DATE.test(urlParams.d) ? urlParams.d :
    (initialPreset !== "custom" && presets[initialPreset]?.date_from) || presets.today.date_from;
  const initialTo = urlParams?.t && ISO_DATE.test(urlParams.t) ? urlParams.t :
    (initialPreset !== "custom" && presets[initialPreset]?.date_to) || presets.today.date_to;
  const initialCountries = urlParams?.co
    ? urlParams.co.split(",").map((s) => s.trim()).filter((c) => ALL_COUNTRIES.has(c))
    : [];
  const initialChannels = urlParams?.ch
    ? urlParams.ch.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const initialCompare = urlParams?.cm && VALID_COMPARE.has(urlParams.cm) ? urlParams.cm : "last_month";
  const initialVat = urlParams?.v && VALID_VAT.has(urlParams.v) ? urlParams.v : "excl";

  const [dateFrom, setDateFrom] = useState(initialFrom);
  const [dateTo, setDateTo] = useState(initialTo);
  const [preset, setPresetKey] = useState(initialPreset);
  const [countries, setCountries] = useState(initialCountries);
  const [channels, setChannels] = useState(initialChannels);
  const [compareMode, setCompareMode] = useState(initialCompare);
  const [vatMode, setVatMode] = useState(initialVat);
  const [dataVersion, setDataVersion] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Track which URL filters we validated-and-dropped so we toast the user
  // exactly once after the real location list comes back.
  const urlValidatedRef = useRef(false);

  // Validate URL-supplied channels against the real /analytics/active-pos
  // list. Silently drop anything the user can't / shouldn't see and toast.
  useEffect(() => {
    if (urlValidatedRef.current) return;
    if (!urlParams) { urlValidatedRef.current = true; return; }
    // No channels in URL → nothing to validate.
    if (!urlParams.ch) { urlValidatedRef.current = true; return; }

    api.get("/analytics/active-pos")
      .then((r) => {
        const ONLINE = ["Online - Shop Zetu", "Online - Vivo"];
        const known = new Set([...ONLINE, ...(r.data || []).map((l) => l.channel)]);
        const requested = urlParams.ch.split(",").map((s) => s.trim()).filter(Boolean);
        const valid = requested.filter((c) => known.has(c));
        const dropped = requested.filter((c) => !known.has(c));
        if (dropped.length) {
          setChannels(valid);
          toast.warning("Some filters removed — you do not have access", {
            description: dropped.length === 1
              ? `Dropped unknown POS: ${dropped[0]}`
              : `Dropped ${dropped.length} unknown POS locations`,
            duration: 5000,
          });
        }
      })
      .catch(() => { /* non-fatal — keep what we had */ })
      .finally(() => { urlValidatedRef.current = true; });
  }, [urlParams]);

  const setPreset = useCallback((key) => {
    if (key === "custom") {
      setPresetKey("custom");
      return;
    }
    const p = datePresets()[key];
    if (!p) return;
    setPresetKey(key);
    setDateFrom(p.date_from);
    setDateTo(p.date_to);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await api.post("/admin/cache-clear");
    } catch { /* non-fatal — still bump dataVersion */ }
    invalidateKpis();
    setDataVersion((v) => v + 1);
  }, []);
  const touchLastUpdated = useCallback(() => setLastUpdated(new Date()), []);

  // Sync state → URL on every meaningful change AND on every route change
  // (react-router's NavLink replaces the whole URL including the query
  // string, so we re-apply our params right after the pathname updates).
  const location = useLocation();
  useEffect(() => {
    writeUrlParams({ dateFrom, dateTo, preset, countries, channels, compareMode, vatMode });
  }, [dateFrom, dateTo, preset, countries, channels, compareMode, vatMode, location.pathname]);

  const applied = useMemo(
    () => ({ dateFrom, dateTo, countries, channels, compareMode, vatMode, dataVersion }),
    [dateFrom, dateTo, countries, channels, compareMode, vatMode, dataVersion]
  );

  const value = useMemo(
    () => ({
      dateFrom, setDateFrom,
      dateTo, setDateTo,
      preset, setPresetKey, setPreset,
      countries, setCountries,
      channels, setChannels,
      compareMode, setCompareMode,
      vatMode, setVatMode,
      dataVersion, refresh,
      lastUpdated, touchLastUpdated,
      applied,
    }),
    [dateFrom, dateTo, preset, countries, channels, compareMode, vatMode, dataVersion, refresh, lastUpdated, touchLastUpdated, applied, setPreset]
  );
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
};

export const useFilters = () => {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
};
