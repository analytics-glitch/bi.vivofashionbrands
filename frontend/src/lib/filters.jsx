import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { datePresets } from "@/lib/api";
import { api, clearApiCache } from "@/lib/api";
import { invalidateKpis } from "@/lib/useKpis";
import { useAuth } from "@/lib/auth";

const FiltersContext = createContext(null);

// ---- URL serialisation helpers (short, stable keys) ----
// d  = date_from (ISO)
// t  = date_to   (ISO)
// p  = preset    (today|yesterday|last_7d|last_30d|last_90d|last_365d|last_week|last_month|last_quarter|last_12_months|last_year|mtd|qtd|ytd|this_week|this_month|this_year|custom)
// co = countries (comma-separated)
// ch = channels  (comma-separated, URL-encoded)
// cm = compareMode (none|yesterday|last_year|last_year_dow|last_month|custom)
// cd = compareDateFrom (ISO, only when cm=custom)
// ce = compareDateTo   (ISO, only when cm=custom)
// cu = currency code (default KES; cosmetic only for now)
// cg = channelGroup ('all'|'retail'|'online') — segments channels NOT LIKE / LIKE '%Online%'
const VALID_PRESETS = new Set([
  "today", "yesterday",
  "last_7d", "last_30d", "last_90d", "last_365d",
  "last_week", "last_month", "last_quarter", "last_12_months", "last_year",
  "mtd", "qtd", "ytd",
  "this_week", "this_month", "this_year",
  "custom",
]);
const VALID_COMPARE = new Set(["none", "yesterday", "last_month", "last_year", "last_year_dow", "custom"]);
const VALID_CHANNEL_GROUPS = new Set(["all", "retail", "online"]);
const ALL_COUNTRIES = new Set(["Kenya", "Uganda", "Rwanda", "Online"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_CURRENCIES = new Set(["KES", "USD", "UGX", "RWF"]);

function readUrlParams() {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  const out = {};
  // Accept both short (d/t/p/co/ch/cm — internal) and long (date_from, date_to,
  // period, country, pos, compare — shareable) URL param names.
  const pick = (short, long) => (p.has(short) ? p.get(short) : (p.has(long) ? p.get(long) : null));
  const d = pick("d", "date_from");
  const t = pick("t", "date_to");
  const preset = pick("p", "period");
  const co = pick("co", "country");
  const ch = pick("ch", "pos");
  const cm = pick("cm", "compare");
  const cd = pick("cd", "compare_from");
  const ce = pick("ce", "compare_to");
  const cu = pick("cu", "currency");
  const cg = pick("cg", "channel_group");
  if (d) out.d = d;
  if (t) out.t = t;
  if (preset) out.p = preset;
  if (co) out.co = co;
  if (ch) out.ch = ch;
  if (cm) out.cm = cm;
  if (cd) out.cd = cd;
  if (ce) out.ce = ce;
  if (cu) out.cu = cu;
  if (cg) out.cg = cg;
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
  // no channels, compareMode=none, currency=KES).
  put("p", state.preset, state.preset === "today");
  put("d", state.dateFrom, state.preset === "today" && state.dateFrom === defaults.date_from);
  put("t", state.dateTo, state.preset === "today" && state.dateTo === defaults.date_to);
  put("co", state.countries.join(","), state.countries.length === 0);
  put("ch", state.channels.join(","), state.channels.length === 0);
  put("cm", state.compareMode, state.compareMode === "last_month");
  put("cd", state.compareDateFrom, state.compareMode !== "custom" || !state.compareDateFrom);
  put("ce", state.compareDateTo, state.compareMode !== "custom" || !state.compareDateTo);
  put("cu", state.currency, state.currency === "KES");
  put("cg", state.channelGroup, state.channelGroup === "all");
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
  const initialCompareFrom = urlParams?.cd && ISO_DATE.test(urlParams.cd) ? urlParams.cd : "";
  const initialCompareTo = urlParams?.ce && ISO_DATE.test(urlParams.ce) ? urlParams.ce : "";
  const initialCurrency = urlParams?.cu && VALID_CURRENCIES.has(urlParams.cu) ? urlParams.cu : "KES";
  const initialChannelGroup = urlParams?.cg && VALID_CHANNEL_GROUPS.has(urlParams.cg) ? urlParams.cg : "all";

  const [dateFrom, setDateFrom] = useState(initialFrom);
  const [dateTo, setDateTo] = useState(initialTo);
  const [preset, setPresetKey] = useState(initialPreset);
  const [countries, setCountries] = useState(initialCountries);
  const [channels, setChannels] = useState(initialChannels);
  const [compareMode, setCompareMode] = useState(initialCompare);
  const [compareDateFrom, setCompareDateFrom] = useState(initialCompareFrom);
  const [compareDateTo, setCompareDateTo] = useState(initialCompareTo);
  const [currency, setCurrency] = useState(initialCurrency);
  const [channelGroup, setChannelGroup] = useState(initialChannelGroup);
  const [retailChannels, setRetailChannels] = useState([]);
  const [onlineChannels, setOnlineChannels] = useState([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Fetch the master list of active POS channels once so we can resolve the
  // channelGroup toggle (Retail = NOT LIKE '%Online%', Online = LIKE '%Online%').
  // Re-runs when the user transitions from anonymous → authenticated, since
  // /analytics/active-pos requires auth (so the initial pre-login fetch
  // would return 401 and leave retailChannels empty).
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return; // Wait until the user is logged in.
    let cancelled = false;
    api.get("/analytics/active-pos")
      .then((r) => {
        if (cancelled) return;
        const all = (r.data || []).map((l) => l.channel).filter(Boolean);
        // Always include the well-known online channels even if upstream
        // /analytics/active-pos hasn't returned them yet (cold start).
        const ONLINE_FALLBACK = ["Online - Shop Zetu", "Online - Vivo", "Online - Vivo Woman", "Online - Uganda", "Online - Rwanda"];
        const merged = Array.from(new Set([...all, ...ONLINE_FALLBACK]));
        setRetailChannels(merged.filter((c) => !/online/i.test(c)));
        setOnlineChannels(merged.filter((c) => /online/i.test(c)));
      })
      .catch(() => {
        // Fallback to known online channels only.
        setOnlineChannels(["Online - Shop Zetu", "Online - Vivo", "Online - Vivo Woman", "Online - Uganda", "Online - Rwanda"]);
        setRetailChannels([]);
      });
    return () => { cancelled = true; };
  }, [user]);

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
    clearApiCache();
    invalidateKpis();
    setDataVersion((v) => v + 1);
  }, []);
  const touchLastUpdated = useCallback(() => setLastUpdated(new Date()), []);

  /** Build a human-readable URL for sharing the current filter state.
   *  Keys (period, date_from, date_to, country, pos, compare) are self-
   *  describing so a recipient can read them in WhatsApp / email. The
   *  reader accepts both long AND short keys for backward compatibility
   *  with existing bookmarks. */
  const buildShareableLink = useCallback(() => {
    if (typeof window === "undefined") return "";
    const p = new URLSearchParams();
    const defs = datePresets().today;
    if (preset && preset !== "today") p.set("period", preset);
    if (preset === "custom" || (dateFrom && dateFrom !== defs.date_from)) p.set("date_from", dateFrom);
    if (preset === "custom" || (dateTo && dateTo !== defs.date_to)) p.set("date_to", dateTo);
    if (countries.length) p.set("country", countries.join(","));
    if (channels.length) p.set("pos", channels.join(","));
    if (compareMode && compareMode !== "last_month") p.set("compare", compareMode);
    if (compareMode === "custom" && compareDateFrom) p.set("compare_from", compareDateFrom);
    if (compareMode === "custom" && compareDateTo) p.set("compare_to", compareDateTo);
    if (currency && currency !== "KES") p.set("currency", currency);
    if (channelGroup && channelGroup !== "all") p.set("channel_group", channelGroup);
    const qs = p.toString();
    return window.location.origin + window.location.pathname + (qs ? `?${qs}` : "");
  }, [preset, dateFrom, dateTo, countries, channels, compareMode, compareDateFrom, compareDateTo, currency, channelGroup]);

  // Sync state → URL on every meaningful change AND on every route change
  // (react-router's NavLink replaces the whole URL including the query
  // string, so we re-apply our params right after the pathname updates).
  const location = useLocation();
  useEffect(() => {
    writeUrlParams({ dateFrom, dateTo, preset, countries, channels, compareMode, compareDateFrom, compareDateTo, currency, channelGroup });
  }, [dateFrom, dateTo, preset, countries, channels, compareMode, compareDateFrom, compareDateTo, currency, channelGroup, location.pathname]);

  // Derive the channel list that gets sent to the API. Manual multi-select
  // ALWAYS wins (user's explicit pick is honoured) — channelGroup only
  // applies when the user hasn't picked any channels manually.
  const effectiveChannels = useMemo(() => {
    if (channels && channels.length > 0) return channels;
    if (channelGroup === "retail") return retailChannels;
    if (channelGroup === "online") return onlineChannels;
    return [];
  }, [channels, channelGroup, retailChannels, onlineChannels]);

  const applied = useMemo(
    () => ({
      dateFrom, dateTo, countries,
      channels: effectiveChannels,
      manualChannels: channels,
      channelGroup,
      compareMode, compareDateFrom, compareDateTo,
      currency, dataVersion,
    }),
    [dateFrom, dateTo, countries, effectiveChannels, channels, channelGroup, compareMode, compareDateFrom, compareDateTo, currency, dataVersion]
  );

  const value = useMemo(
    () => ({
      dateFrom, setDateFrom,
      dateTo, setDateTo,
      preset, setPresetKey, setPreset,
      countries, setCountries,
      channels, setChannels,
      channelGroup, setChannelGroup,
      retailChannels, onlineChannels,
      compareMode, setCompareMode,
      compareDateFrom, setCompareDateFrom,
      compareDateTo, setCompareDateTo,
      currency, setCurrency,
      dataVersion, refresh,
      lastUpdated, touchLastUpdated,
      applied,
      buildShareableLink,
    }),
    [dateFrom, dateTo, preset, countries, channels, channelGroup, retailChannels, onlineChannels, compareMode, compareDateFrom, compareDateTo, currency, dataVersion, refresh, lastUpdated, touchLastUpdated, applied, setPreset, buildShareableLink]
  );
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
};

export const useFilters = () => {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
};
