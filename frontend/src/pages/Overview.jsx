import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { useKpis } from "@/lib/useKpis";
import { isMerchandise, categoryFor as sharedCategoryFor } from "@/lib/productCategory";
import {
  api,
  fmtKES,
  fmtKESMobile,
  fmtNum,
  fmtPct,
  fmtAxisKES,
  fmtDate,
  buildParams,
  pctDelta,
  comparePeriod,
  COUNTRY_FLAGS,
} from "@/lib/api";
import { KPICard, HighlightCard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import DataFreshness from "@/components/DataFreshness";
// SalesProjection moved to /targets (Targets Tracker page).
import DailyBriefing from "@/components/DailyBriefing";
import StoreOfTheWeek from "@/components/StoreOfTheWeek";
import WinsThisWeekCard from "@/components/WinsThisWeekCard";
import OverviewSnapshot from "@/components/OverviewSnapshot";
// Q2TargetsCard + AnnualTargetsCard moved to /targets (Targets Tracker page).
import KpiTrendChart from "@/components/KpiTrendChart";
import { useLocationBadges, useLeaderboardStreaks } from "@/components/LocationLeaderboard";
import { useNavigate } from "react-router-dom";
import { ChartTooltip, useIsMobile, makePctDeltaLabel } from "@/components/ChartHelpers";
import {
  CurrencyCircleDollar,
  Coins,
  ShoppingCart,
  Package,
  Percent,
  ArrowUUpLeft,
  Basket,
  ChartBar,
  Storefront,
  Globe,
  TrendUp,
  Footprints,
  Target,
} from "@phosphor-icons/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  Cell,
  Line,
  LineChart,
  Legend,
  LabelList,
} from "recharts";

const DONUT_COLORS = ["#1a5c38", "#00c853", "#d97706", "#4b7bec"];
const COUNTRY_LINE_COLORS = {
  Kenya: "#1a5c38",
  Uganda: "#d97706",
  Rwanda: "#00c853",
  Online: "#4b7bec",
};

const ALL_COUNTRIES = ["Kenya", "Uganda", "Rwanda", "Online"];

const Overview = () => {
  const { applied, touchLastUpdated, lastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode, compareDateFrom, compareDateTo, channelGroup, dataVersion } = applied;
  const isOnlineOnly = channelGroup === "online";
  const filters = { dateFrom, dateTo, countries, channels };
  const isMobile = useIsMobile();
  // Snapshot mode — toggled via the "Mobile snapshot" button in the header.
  // Renders a stripped-down 2-col KPI grid sized for one mobile screenshot.
  const [snapshot, setSnapshot] = useState(false);
  // On mobile, switch every KPI-tile currency value to a compact 2-decimal
  // form (e.g. "KES 354.99M" instead of "KES 354,985,308") so headline
  // figures fit on a phone screen without wrapping. Charts/tables keep the
  // full format because they have horizontal room.
  const kfmt = isMobile ? fmtKESMobile : fmtKES;

  // Shared KPI state — identical values on every page for the same filters.
  const { kpis: rawKpis, prevKpis: rawKpisPrev, loading: kpisLoading, error: kpisError } = useKpis({ compare: true });

  const [countrySummary, setCountrySummary] = useState([]);
  const [countrySummaryPrev, setCountrySummaryPrev] = useState([]);
  const [sales, setSales] = useState([]);
  const [salesPrev, setSalesPrev] = useState([]);
  const [dailyByCountry, setDailyByCountry] = useState({});
  const [dailyByCountryPrev, setDailyByCountryPrev] = useState({});
  const [topStyles, setTopStyles] = useState([]);
  const [subcats, setSubcats] = useState([]);
  const [subcatsPrev, setSubcatsPrev] = useState([]);
  const [footfall, setFootfall] = useState([]);
  const [footfallPrev, setFootfallPrev] = useState([]);
  const [locations, setLocations] = useState([]);
  const [pairedDays, setPairedDays] = useState(null); // for single-day trend chart
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("units_sold");

  // VAT logic has been removed per product decision — all monetary values
  // rendered as-is from upstream (excl. VAT). `adj` is a no-op identity to
  // minimise diff in downstream aggregations / useMemo blocks.
  const adj = (v) => Number(v || 0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = buildParams(filters);
    const prev = comparePeriod(dateFrom, dateTo, compareMode, { date_from: compareDateFrom, date_to: compareDateTo });

    const countriesToChart = countries.length ? countries : ALL_COUNTRIES;

    const dailyCalls = countriesToChart.map((c) =>
      api.get("/daily-trend", { params: { date_from: dateFrom, date_to: dateTo, country: c } })
    );
    const dailyPrevCalls = prev
      ? countriesToChart.map((c) =>
          api.get("/daily-trend", { params: { date_from: prev.date_from, date_to: prev.date_to, country: c } })
        )
      : [];

    const safe = (pr) => pr.then((r) => ({ ok: true, data: r?.data })).catch((e) => ({ ok: false, error: e }));

    Promise.all([
      safe(api.get("/country-summary", { params: { date_from: dateFrom, date_to: dateTo } })),
      safe(api.get("/sales-summary", { params: p })),
      safe(api.get("/sor", { params: p })),
      safe(api.get("/subcategory-sales", { params: p })),
      safe(api.get("/footfall", { params: { date_from: dateFrom, date_to: dateTo } })),
      Promise.all(dailyCalls.map(safe)),
      Promise.all(dailyPrevCalls.map(safe)),
      prev
        ? safe(api.get("/footfall", { params: { date_from: prev.date_from, date_to: prev.date_to } }))
        : Promise.resolve({ ok: true, data: [] }),
      safe(api.get("/locations")),
      prev
        ? safe(api.get("/sales-summary", { params: { ...p, date_from: prev.date_from, date_to: prev.date_to } }))
        : Promise.resolve({ ok: true, data: [] }),
      prev
        ? safe(api.get("/country-summary", { params: { date_from: prev.date_from, date_to: prev.date_to } }))
        : Promise.resolve({ ok: true, data: [] }),
      prev
        ? safe(api.get("/subcategory-sales", { params: { ...p, date_from: prev.date_from, date_to: prev.date_to } }))
        : Promise.resolve({ ok: true, data: [] }),
    ])
      .then(([cs, s, sor, sc, ff, daily, dailyP, ffp, locs, sp, csPrev, scPrev]) => {
        if (cancelled) return;
        setCountrySummary(cs.ok ? cs.data || [] : []);
        setCountrySummaryPrev(csPrev?.ok ? csPrev.data || [] : []);
        setSales(s.ok ? s.data || [] : []);
        setSalesPrev(sp?.ok ? sp.data || [] : []);
        setTopStyles(sor.ok ? (sor.data || []).slice().sort((a, b) => (b.units_sold || 0) - (a.units_sold || 0)).slice(0, 20) : []);
        setSubcats(sc.ok ? sc.data || [] : []);
        setSubcatsPrev(scPrev?.ok ? scPrev.data || [] : []);
        setFootfall(ff.ok ? ff.data || [] : []);
        setFootfallPrev(ffp?.ok ? ffp.data || [] : []);
        setLocations(locs?.ok ? locs.data || [] : []);
        const dailyOk = countriesToChart.map((c, i) => [c, daily[i]?.ok ? daily[i].data : []]);
        const dailyPOk = dailyPrevCalls.length
          ? countriesToChart.map((c, i) => [c, dailyP[i]?.ok ? dailyP[i].data : []])
          : [];
        setDailyByCountry(Object.fromEntries(dailyOk));
        setDailyByCountryPrev(Object.fromEntries(dailyPOk));
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode, compareDateFrom, compareDateTo, dataVersion]);

  // --- Paired-bars data for single-day range ---
  // Fetches KPIs for:  Today, Same Day Last Week, Same Day Last Month,
  // Same Day Last Year. Independent of compareMode so users always see
  // YoY context when the range is a single day.
  useEffect(() => {
    if (dateFrom !== dateTo) { setPairedDays(null); return; }
    let cancelled = false;
    const iso = (d) => d.toISOString().slice(0, 10);
    const base = new Date(dateFrom);
    const sdlw = new Date(base); sdlw.setDate(base.getDate() - 7);
    const sdlm = new Date(base); sdlm.setMonth(base.getMonth() - 1);
    const sdly = new Date(base); sdly.setFullYear(base.getFullYear() - 1);
    const fetchOne = (d) => {
      const i = iso(d);
      return api
        .get("/kpis", { params: { date_from: i, date_to: i, country: countries.length ? countries.join(",") : undefined, channel: channels.length ? channels.join(",") : undefined } })
        .then((r) => ({ day: i, label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), total_sales: r.data?.total_sales || 0, orders: r.data?.total_orders || 0 }))
        .catch(() => ({ day: i, label: d.toLocaleDateString("en-GB"), total_sales: 0, orders: 0 }));
    };
    Promise.all([fetchOne(base), fetchOne(sdlw), fetchOne(sdlm), fetchOne(sdly)])
      .then(([td, w, m, y]) => {
        if (cancelled) return;
        setPairedDays({ today: td, sdlw: w, sdlm: m, sdly: y });
      });
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  const pairedBars = useMemo(() => {
    if (!pairedDays) return [];
    const rows = [
      { key: "today", subtitle: "Today",               short: "Today",    ...pairedDays.today },
      { key: "sdlw",  subtitle: "Same Day Last Week",  short: "SD LW",   ...pairedDays.sdlw },
      { key: "sdlm",  subtitle: "Same Day Last Month", short: "SD LM",   ...pairedDays.sdlm },
    ];
    if (compareMode === "last_year") {
      rows.push({ key: "sdly", subtitle: "Same Day Last Year", short: "SD LY", ...pairedDays.sdly });
    }
    const t = pairedDays.today.total_sales || 0;
    return rows.map((r) => ({
      ...r,
      total_sales: adj(r.total_sales),
      delta_pct: r.key === "today" || !t ? null : ((adj(r.total_sales) - adj(t)) / adj(t)) * 100,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairedDays, compareMode]);

  // Country sales — sorted descending bar chart. ALWAYS include Kenya, Uganda
  // and Rwanda (even with zero sales) so users can eyeball markets equally.
  const countryBars = useMemo(() => {
    const byCountry = new Map();
    for (const r of countrySummary) {
      byCountry.set(r.country, r);
    }
    const prevByCountry = new Map();
    for (const r of countrySummaryPrev) {
      if (r.country) prevByCountry.set(r.country, r.total_sales || 0);
    }
    const wanted = ["Kenya", "Uganda", "Rwanda", "Online"];
    const rows = wanted.map((c) => {
      const r = byCountry.get(c) || {};
      return {
        country: c,
        flag: COUNTRY_FLAGS[c] || "🌍",
        total_sales: adj(r.total_sales || 0),
        orders: r.orders || r.total_orders || 0,
        units_sold: r.units_sold || r.total_units || 0,
        prev_sales: adj(prevByCountry.get(c) || 0),
      };
    });
    // Add any unexpected country we might have (e.g. legacy "Other").
    for (const r of countrySummary) {
      if (!wanted.includes(r.country) && r.country) {
        rows.push({
          country: r.country,
          flag: COUNTRY_FLAGS[r.country] || "🌍",
          total_sales: adj(r.total_sales || 0),
          orders: r.orders || r.total_orders || 0,
          units_sold: r.units_sold || r.total_units || 0,
          prev_sales: adj(prevByCountry.get(r.country) || 0),
        });
      }
    }
    const total = rows.reduce((s, r) => s + r.total_sales, 0) || 1;
    return rows
      .map((r) => ({
        ...r,
        pct: (r.total_sales / total) * 100,
        delta_pct: compareMode !== "none" && r.prev_sales ? pctDelta(r.total_sales, r.prev_sales) : null,
      }))
      .sort((a, b) => b.total_sales - a.total_sales);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countrySummary, countrySummaryPrev, compareMode]);

  // Channel split — derives Retail / Online / Wholesale buckets from the
  // per-POS /sales-summary rows. Mapping rule is kept simple & explicit.
  const channelBars = useMemo(() => {
    const bucket = (ch) => {
      const s = (ch || "").toLowerCase();
      if (s.startsWith("online")) return "Online";
      if (s.includes("wholesale")) return "Wholesale";
      return "Retail";
    };
    const newBucket = () => ({ total_sales: 0, orders: 0, units_sold: 0, prev_sales: 0 });
    const b = { Retail: newBucket(), Online: newBucket(), Wholesale: newBucket() };
    for (const r of sales) {
      const k = bucket(r.channel);
      b[k].total_sales += r.total_sales || 0;
      b[k].orders += r.orders || r.total_orders || 0;
      b[k].units_sold += r.units_sold || r.total_units || 0;
    }
    for (const r of salesPrev || []) {
      const k = bucket(r.channel);
      if (b[k]) b[k].prev_sales += r.total_sales || 0;
    }
    const total = Object.values(b).reduce((s, x) => s + x.total_sales, 0) || 1;
    return Object.entries(b)
      .map(([name, v]) => ({
        channel: name,
        total_sales: adj(v.total_sales),
        orders: v.orders,
        units_sold: v.units_sold,
        prev_sales: adj(v.prev_sales),
        pct: (v.total_sales / total) * 100,
        delta_pct: compareMode !== "none" && v.prev_sales ? pctDelta(v.total_sales, v.prev_sales) : null,
      }))
      .sort((a, b2) => b2.total_sales - a.total_sales);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, salesPrev, compareMode]);

  const delta = (k) => (kpis && kpisPrev) ? pctDelta(kpis[k], kpisPrev[k]) : null;
  const prev = (k, formatter) => (kpis && kpisPrev && compareMode !== "none" && kpisPrev[k] != null) ? formatter(kpisPrev[k]) : null;
  const compareLbl = compareMode === "yesterday" ? "vs Yesterday" : compareMode === "last_month" ? "vs Last Month" : compareMode === "last_year" ? "vs Last Year" : null;
  // Two upstream-degraded states to surface to users:
  //   1. Hard error (kpisError set): the /kpis call failed and no
  //      cached value was returned. We auto-retry in the background.
  //   2. Soft stale (kpis.stale === true): backend served a cached
  //      value because upstream is slow; auto-refresh polls upstream.
  // In both cases we now use the same friendly copy — the technical
  // text ("circuit-breaker OPEN", "/kpis", etc.) is hidden from end
  // users and surfaced only via the title attribute for support staff.
  const degradedMessage = kpisError
    ? "KPIs are temporarily slow to load. Auto-refreshing in the background — you don't need to do anything."
    : null;
  const degradedTitle = kpisError ? `Tech detail (for support): ${kpisError}` : "";

  const kpis = useMemo(() => {
    if (!rawKpis) return null;
    return {
      ...rawKpis,
      total_sales: adj(rawKpis.total_sales),
      net_sales: adj(rawKpis.net_sales),
      total_returns: adj(rawKpis.total_returns),
      avg_basket_size: adj(rawKpis.avg_basket_size),
      avg_selling_price: adj(rawKpis.avg_selling_price),
      gross_sales: adj(rawKpis.gross_sales),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawKpis]);

  const kpisPrev = useMemo(() => {
    if (!rawKpisPrev) return null;
    return {
      ...rawKpisPrev,
      total_sales: adj(rawKpisPrev.total_sales),
      net_sales: adj(rawKpisPrev.net_sales),
      total_returns: adj(rawKpisPrev.total_returns),
      avg_basket_size: adj(rawKpisPrev.avg_basket_size),
      avg_selling_price: adj(rawKpisPrev.avg_selling_price),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawKpisPrev]);

  // --- Range-length driven chart type for Daily Sales Trend ---
  // ≤1 day → paired bars (Today / SDLW / SDLM / SDLY-if-LY).
  //  2–6 day → mini bar per day.
  // ≥7 day → existing multi-line chart.
  const rangeDays = useMemo(() => {
    if (!dateFrom || !dateTo) return 1;
    const f = new Date(dateFrom);
    const t = new Date(dateTo);
    return Math.max(1, Math.round((t - f) / 86400000) + 1);
  }, [dateFrom, dateTo]);

  const top15 = useMemo(() => {
    const sorted = [...sales].sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0));
    const total = sorted.reduce((s, r) => s + (r.total_sales || 0), 0) || 1;
    // Build a quick lookup of previous-period sales by channel name.
    const prevByChannel = new Map();
    for (const r of salesPrev || []) {
      if (r.channel) prevByChannel.set(r.channel, r.total_sales || 0);
    }
    // Detect a common prefix shared by every non-empty channel name (e.g.
    // "Vivo ", "Safari ") so we can strip it on mobile for readability.
    // Only stripped when ALL labels share it AND it's at least 4 chars.
    const names = sorted.map((r) => r.channel || "").filter(Boolean);
    let commonPrefix = "";
    if (names.length >= 2) {
      const first = names[0];
      let i = 0;
      while (i < first.length && names.every((n) => n[i] === first[i])) i++;
      // Trim back to last space so we don't cut mid-word
      const cand = first.slice(0, i);
      const lastSp = cand.lastIndexOf(" ");
      if (lastSp >= 4) commonPrefix = cand.slice(0, lastSp + 1);
    }
    return sorted.map((r) => {
      const raw = r.channel || "";
      const label = raw.length > 24 ? raw.slice(0, 23) + "…" : raw;
      const shortRaw = commonPrefix && raw.startsWith(commonPrefix) ? raw.slice(commonPrefix.length) : raw;
      const labelShort = shortRaw.length > 15 ? shortRaw.slice(0, 14) + "…" : shortRaw;
      const cur = r.total_sales || 0;
      const prv = prevByChannel.get(raw);
      const delta_pct = compareMode !== "none" && prv != null ? pctDelta(cur, prv) : null;
      return {
        ...r,
        label, labelShort, labelFull: raw,
        pct: (cur / total) * 100,
        delta_pct,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, salesPrev, compareMode]);

  const topCountry = useMemo(() => {
    if (!countrySummary.length) return null;
    return [...countrySummary].sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0))[0];
  }, [countrySummary]);

  const topChannel = useMemo(() => {
    if (!sales.length) return null;
    return [...sales].sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0))[0];
  }, [sales]);

  const bestConversionStore = useMemo(() => {
    // exclude Vivo Junction if >50% conversion
    const filtered = footfall.filter((r) => !(r.location === "Vivo Junction" && (r.conversion_rate || 0) > 50));
    const realistic = filtered.filter((r) => (r.conversion_rate || 0) <= 50);
    if (!realistic.length) return null;
    return [...realistic].sort((a, b) => (b.conversion_rate || 0) - (a.conversion_rate || 0))[0];
  }, [footfall]);

  // Channel -> country map for filtering footfall by country selection
  const channelCountryMap = useMemo(() => {
    const m = {};
    for (const l of locations) m[l.channel] = l.country;
    return m;
  }, [locations]);

  // Aggregate footfall (excluding Vivo Junction due to >50% conv rate data-quality rule)
  const aggFootfall = (rows) => {
    let fVisits = 0;
    let fOrders = 0;
    for (const r of rows || []) {
      if ((r.conversion_rate || 0) > 50) continue; // data-quality rule
      // Apply country filter if active
      if (countries.length) {
        const c = channelCountryMap[r.location];
        if (!c || !countries.includes(c)) continue;
      }
      // Apply channel filter if active
      if (channels.length && !channels.includes(r.location)) continue;
      fVisits += r.total_footfall || 0;
      fOrders += r.orders || 0;
    }
    const conv = fVisits > 0 ? (fOrders / fVisits) * 100 : 0;
    return { total_footfall: fVisits, orders: fOrders, conversion_rate: conv };
  };

  const footfallAgg = useMemo(() => aggFootfall(footfall), [footfall, countries, channels, channelCountryMap]);
  const footfallAggPrev = useMemo(() => aggFootfall(footfallPrev), [footfallPrev, countries, channels, channelCountryMap]);

  // merge daily by day; one key per country (current) + country_prev for previous
  const dailyMerged = useMemo(() => {
    const byDay = {};
    const ccToChart = countries.length ? countries : ALL_COUNTRIES;
    for (const c of ccToChart) {
      const rows = dailyByCountry[c] || [];
      for (const r of rows) {
        if (!byDay[r.day]) byDay[r.day] = { day: r.day };
        byDay[r.day][c] = r.total_sales ?? r.gross_sales ?? 0;
      }
      const prevRows = dailyByCountryPrev[c] || [];
      // align by index (same position as current rows)
      const curr = rows;
      curr.forEach((r, i) => {
        if (!byDay[r.day]) byDay[r.day] = { day: r.day };
        if (prevRows[i] !== undefined) {
          byDay[r.day][c + "_prev"] = prevRows[i].total_sales ?? prevRows[i].gross_sales ?? null;
        }
      });
    }
    return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
  }, [dailyByCountry, dailyByCountryPrev, countries]);

  const countriesToChart = countries.length ? countries : ALL_COUNTRIES;

  // Single-line Total Sales daily series: sum across all countries.
  const dailyTotalSeriesRaw = useMemo(() => {
    const byDay = {};
    for (const c of countriesToChart) {
      for (const r of dailyByCountry[c] || []) {
        const day = r.day;
        if (!byDay[day]) byDay[day] = { day, total: 0, total_prev: 0 };
        byDay[day].total += r.total_sales ?? r.gross_sales ?? 0;
      }
      const prev = dailyByCountryPrev[c] || [];
      (dailyByCountry[c] || []).forEach((r, i) => {
        const day = r.day;
        if (!byDay[day]) byDay[day] = { day, total: 0, total_prev: 0 };
        if (prev[i]) byDay[day].total_prev += prev[i].total_sales ?? prev[i].gross_sales ?? 0;
      });
    }
    return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
  }, [dailyByCountry, dailyByCountryPrev, countriesToChart]);

  const dailyTotalSeries = useMemo(
    () => dailyTotalSeriesRaw.map((r) => ({ ...r, total: adj(r.total), total_prev: adj(r.total_prev) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dailyTotalSeriesRaw]
  );

  const sortedStyles = useMemo(
    () => [...topStyles].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0)),
    [topStyles, sortKey]
  );

  // Top 15 subcategories with % of total sales (across ALL subcategories).
  // Merchandise-only — Accessories/Sale/null excluded from the chart.
  const merchSubcats = useMemo(() => subcats.filter((r) => isMerchandise(r.subcategory)), [subcats]);
  const merchSubcatsPrevByName = useMemo(() => {
    const m = new Map();
    for (const r of subcatsPrev || []) {
      if (isMerchandise(r.subcategory)) m.set(r.subcategory, r.total_sales || 0);
    }
    return m;
  }, [subcatsPrev]);
  const subcatTotalSales = useMemo(
    () => merchSubcats.reduce((s, r) => s + (r.total_sales || 0), 0),
    [merchSubcats]
  );
  const subcatTop = useMemo(
    () =>
      [...merchSubcats]
        .sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0))
        .map((r) => {
          const pct = subcatTotalSales ? ((r.total_sales || 0) / subcatTotalSales) * 100 : 0;
          const prv = merchSubcatsPrevByName.get(r.subcategory);
          const delta_pct = compareMode !== "none" && prv ? pctDelta(r.total_sales || 0, prv) : null;
          return {
            ...r,
            pct,
            delta_pct,
            subcat_label: `${fmtKES(r.total_sales)} · ${pct.toFixed(1)}%`,
          };
        }),
    [merchSubcats, subcatTotalSales, merchSubcatsPrevByName, compareMode]
  );
  const subcatTopTotal = useMemo(
    () => subcatTop.reduce((s, r) => s + (r.total_sales || 0), 0),
    [subcatTop]
  );

  // Sales by Category — map subcategory → high-level category.
  // Merchandise-only: Accessories, Sale and null are excluded from this chart.
  const categoryFor = sharedCategoryFor;
  const salesByCategory = useMemo(() => {
    const byCat = {};
    const byCatPrev = {};
    for (const r of subcats) {
      if (!isMerchandise(r.subcategory)) continue;
      const cat = categoryFor(r.subcategory);
      if (!cat) continue;
      if (!byCat[cat]) byCat[cat] = { category: cat, total_sales: 0, units_sold: 0, prev_sales: 0 };
      byCat[cat].total_sales += r.total_sales || 0;
      byCat[cat].units_sold += r.units_sold || 0;
    }
    for (const r of subcatsPrev || []) {
      if (!isMerchandise(r.subcategory)) continue;
      const cat = categoryFor(r.subcategory);
      if (!cat) continue;
      byCatPrev[cat] = (byCatPrev[cat] || 0) + (r.total_sales || 0);
    }
    const arr = Object.values(byCat).sort((a, b) => b.total_sales - a.total_sales);
    const total = arr.reduce((s, r) => s + r.total_sales, 0) || 1;
    return arr.map((r) => {
      const pct = (r.total_sales / total) * 100;
      const prv = byCatPrev[r.category];
      const delta_pct = compareMode !== "none" && prv ? pctDelta(r.total_sales, prv) : null;
      return {
        ...r, pct, delta_pct,
        cat_label: `${fmtKES(r.total_sales)} · ${pct.toFixed(1)}%`,
      };
    });
  }, [subcats, subcatsPrev, categoryFor, compareMode]);

  // Responsive-safe label renderer for the Sales-by-Category bars.
  // Renders the absolute KES on the first line and the % share on a
  // second line so labels never overlap on narrow (mobile) bars.
  // Recharts' LabelList `content` doesn't pass the full row, so we
  // index back into `salesByCategory` to get `pct`.
  const CategoryBarLabel = (props) => {
    const { x, y, width, value, index } = props;
    if (value == null) return null;
    const row = salesByCategory[index] || {};
    const sales = fmtAxisKES(row.total_sales ?? value);
    const pct = `${(row.pct || 0).toFixed(1)}%`;
    const cx = x + width / 2;
    return (
      <g style={{ pointerEvents: "none" }}>
        <text x={cx} y={y - 14} textAnchor="middle" style={{ fontSize: 10.5, fill: "#1f2937", fontWeight: 700 }}>
          {sales}
        </text>
        <text x={cx} y={y - 2} textAnchor="middle" style={{ fontSize: 10, fill: "#6b7280", fontWeight: 600 }}>
          {pct}
        </text>
      </g>
    );
  };

  return (
    <div className="space-y-6" data-testid="overview-page">
      {snapshot && kpis && (
        <OverviewSnapshot
          dateFrom={dateFrom}
          dateTo={dateTo}
          compareLbl={compareMode !== "none" ? compareLbl : null}
          kpis={kpis}
          kpisPrev={kpisPrev}
          footfallAgg={footfallAgg}
          footfallAggPrev={footfallAggPrev}
          subcatTop={subcatTop}
          topChannel={topChannel}
          bestConversionStore={bestConversionStore}
          isOnlineOnly={isOnlineOnly}
          onClose={() => setSnapshot(false)}
        />
      )}
      {snapshot ? null : (<>
      <div className="flex flex-wrap items-baseline gap-3">
        <div>
          <div className="eyebrow">Dashboard · Overview</div>
          <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(18px,2.2vw,26px)]">Overview</h1>
          <p className="text-muted text-[13px] mt-0.5">
            {fmtDate(dateFrom)} → {fmtDate(dateTo)}
            {compareMode !== "none" && compareLbl && (
              <span className="ml-2 pill-neutral">{compareLbl}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSnapshot(true)}
          data-testid="open-snapshot-btn"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold border border-border bg-white hover:border-brand/60 hover:text-brand transition-colors"
          title="Compact mobile-friendly view of every KPI — perfect for one screenshot"
        >
          📱 Mobile snapshot
        </button>
        {lastUpdated && (
          <div
            className="text-[11.5px] text-muted ml-auto"
            data-testid="last-refreshed"
            title={lastUpdated.toLocaleString()}
          >
            Last refreshed: {lastUpdated.toLocaleTimeString()}
          </div>
        )}
      </div>

      {(loading || kpisLoading) && !kpis && <Loading label="Aggregating group KPIs…" />}
      {error && <ErrorBox message={error} />}
      {degradedMessage && (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900 flex items-center gap-2"
          data-testid="degraded-banner"
          title={degradedTitle}
        >
          <svg className="animate-spin h-3.5 w-3.5 text-amber-700" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
          </svg>
          <span>{degradedMessage}</span>
        </div>
      )}
      {!degradedMessage && kpis?.stale && (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900 flex items-center gap-2"
          data-testid="stale-banner"
        >
          <svg className="animate-spin h-3.5 w-3.5 text-amber-700" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
          </svg>
          <span>
            Upstream KPI service is slow right now — showing values from {Math.max(1, Math.round((kpis.stale_age_sec || 0) / 60))} min ago. Auto-refreshes when upstream recovers.
          </span>
        </div>
      )}

      {!kpisLoading && !error && kpis && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KPICard testId="kpi-total-sales" accent label="Total Sales" value={kfmt(kpis.total_sales)} icon={CurrencyCircleDollar}
              formula="How much money came in this period (before subtracting returns)."
              delta={delta("total_sales")} deltaLabel={compareLbl} prevValue={prev("total_sales", kfmt)} showDelta={compareMode !== "none"}
              action={{ label: "See by location", to: "/locations" }} />
            <KPICard testId="kpi-net-sales" label="Net Sales" value={kfmt(kpis.net_sales)} icon={Coins}
              formula="Total Sales minus refunds. The cash you actually kept."
              delta={delta("net_sales")} deltaLabel={compareLbl} prevValue={prev("net_sales", kfmt)} showDelta={compareMode !== "none"}
              action={{ label: "Drill into returns", to: "/ceo-report#returns" }} />
            <KPICard testId="kpi-orders" label="Transactions" value={fmtNum(kpis.total_orders)} icon={ShoppingCart}
              formula="How many separate purchases were made."
              delta={delta("total_orders")} deltaLabel={compareLbl} prevValue={prev("total_orders", fmtNum)} showDelta={compareMode !== "none"}
              action={{ label: "Order-level export", to: "/exports" }} />
            <KPICard testId="kpi-units" label="Total Units Sold" value={fmtNum(kpis.total_units)} icon={Package}
              formula="How many individual items left the shelves."
              delta={delta("total_units")} deltaLabel={compareLbl} prevValue={prev("total_units", fmtNum)} showDelta={compareMode !== "none"}
              action={{ label: "Top styles", to: "/products" }} />
            {!isOnlineOnly && (
              <KPICard testId="kpi-footfall" label="Total Footfall" sub="Walk-ins counted at our store sensors" value={fmtNum(footfallAgg.total_footfall)} icon={Footprints}
                delta={compareMode !== "none" && footfallAggPrev.total_footfall ? pctDelta(footfallAgg.total_footfall, footfallAggPrev.total_footfall) : null}
                deltaLabel={compareLbl} showDelta={compareMode !== "none"}
                action={{ label: "Footfall by store", to: "/footfall" }} />
            )}
            {!isOnlineOnly && (
              <KPICard testId="kpi-conversion" label="Conversion Rate" sub="Out of every 100 walk-ins, how many bought" value={fmtPct(footfallAgg.conversion_rate, 2)} icon={Target}
                delta={compareMode !== "none" && footfallAggPrev.conversion_rate ? pctDelta(footfallAgg.conversion_rate, footfallAggPrev.conversion_rate) : null}
                deltaLabel={compareLbl} showDelta={compareMode !== "none"}
                action={{ label: "Which stores dropped?", to: "/footfall" }} />
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="sub-kpi-row">
            <KPICard small testId="kpi-abv" label="ABV" sub="Average Basket Value"
              formula="What a typical customer spends per visit. Higher means people are buying more in one go."
              value={kfmt(kpis.total_orders ? kpis.total_sales / kpis.total_orders : 0)} icon={Basket}
              delta={delta("avg_basket_size")} deltaLabel={compareLbl}
              prevValue={prev("avg_basket_size", kfmt)}
              showDelta={compareMode !== "none"} />
            <KPICard small testId="kpi-asp" label="ASP" sub="Average Selling Price"
              formula="The average price of every item sold. Tells you whether you're moving premium pieces or basics."
              value={kfmt(kpis.avg_selling_price)} icon={ChartBar}
              delta={delta("avg_selling_price")} deltaLabel={compareLbl}
              prevValue={prev("avg_selling_price", kfmt)}
              showDelta={compareMode !== "none"} />
            <KPICard small testId="kpi-msi" label="MSI" sub="Items per basket"
              formula="How many items the average customer takes home in one purchase."
              value={(kpis.total_orders ? kpis.total_units / kpis.total_orders : 0).toFixed(2)}
              delta={(() => {
                const cur = kpis.total_orders ? kpis.total_units / kpis.total_orders : 0;
                const pv = kpisPrev && kpisPrev.total_orders ? kpisPrev.total_units / kpisPrev.total_orders : null;
                return pctDelta(cur, pv);
              })()}
              deltaLabel={compareLbl}
              prevValue={kpisPrev && compareMode !== "none" && kpisPrev.total_orders ? (kpisPrev.total_units / kpisPrev.total_orders).toFixed(2) : null}
              showDelta={compareMode !== "none"} />
            <KPICard small testId="kpi-rr" label="Return Rate" sub="Share of sales sent back"
              formula="Out of every 100 KES we sold, how much came back as refunds. Lower is better."
              value={fmtPct(kpis.return_rate, 2)} icon={Percent}
              higherIsBetter={false} delta={delta("return_rate")} deltaLabel={compareLbl}
              prevValue={prev("return_rate", (v) => fmtPct(v, 2))}
              showDelta={compareMode !== "none"}
              action={{ label: "Locations w/ highest returns", to: "/locations" }} />
            <KPICard small testId="kpi-returns" label="Return Amount" sub="Refunds in cash" value={kfmt(kpis.total_returns)} icon={ArrowUUpLeft}
              formula="Total cash refunded to customers, counted on the day they originally bought it."
              higherIsBetter={false} delta={delta("total_returns")} deltaLabel={compareLbl}
              prevValue={prev("total_returns", kfmt)}
              showDelta={compareMode !== "none"}
              action={{ label: "Export returns CSV", to: "/exports" }} />
          </div>

          <div className={`grid grid-cols-1 ${isOnlineOnly ? "md:grid-cols-1" : "md:grid-cols-3"} gap-3`}>
            <HighlightCard testId="highlight-top-subcategory" label="Top Subcategory"
              name={subcatTop && subcatTop.length ? subcatTop[0].subcategory : "—"}
              amount={subcatTop && subcatTop.length ? `${fmtKES(subcatTop[0].total_sales)} · ${subcatTop[0].pct.toFixed(1)}%` : "—"} icon={ChartBar} />
            {!isOnlineOnly && (
              <HighlightCard testId="highlight-top-location" label="Top Location"
                name={topChannel ? topChannel.channel : "—"}
                amount={topChannel ? fmtKES(topChannel.total_sales) : "—"} icon={Storefront} />
            )}
            {!isOnlineOnly && (
              <HighlightCard testId="highlight-best-conversion" label="Best Conversion Rate"
                name={bestConversionStore ? bestConversionStore.location : "—"}
                amount={bestConversionStore ? fmtPct(bestConversionStore.conversion_rate) : "—"} icon={TrendUp} />
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card-white p-5 lg:col-span-2" data-testid="chart-top-channels">
              <SectionTitle title={`Sales by Location · ${top15.length}`} subtitle="How much each store sold this period. Numbers in brackets show that store's share of total sales." />
              {top15.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: Math.max(380, 40 + top15.length * 22) }}>
                  <ResponsiveContainer>
                    <BarChart data={top15} layout="vertical" margin={{ left: isMobile ? 2 : 20, right: isMobile ? 60 : 200, top: 4 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: isMobile ? 9 : 11 }} />
                      <YAxis
                        type="category"
                        dataKey={isMobile ? "labelShort" : "label"}
                        width={isMobile ? 130 : 150}
                        interval={0}
                        tick={{ fontSize: isMobile ? 10 : 11 }}
                      />
                      <Tooltip
                        allowEscapeViewBox={{ x: false, y: true }}
                        wrapperStyle={{ outline: "none", zIndex: 20 }}
                        content={
                          <ChartTooltip
                            labelKey="labelFull"
                            formatters={{
                              total_sales: (v, p) => `${fmtKES(v)} · ${(p?.pct || 0).toFixed(1)}% of total · ${fmtNum(p?.units_sold || 0)} units`,
                            }}
                          />
                        }
                      />
                      <Bar dataKey="total_sales" fill="#1a5c38" radius={[0, 5, 5, 0]} name="Total Sales">
                        <LabelList
                          dataKey="total_sales"
                          content={makePctDeltaLabel({
                            data: top15,
                            formatValue: (v) => isMobile ? fmtAxisKES(v) : fmtKES(v),
                            position: "right",
                            offset: 6,
                            fontSize: isMobile ? 9 : 10,
                            hideDelta: compareMode === "none",
                            labelTestId: "top-locations-bar-label",
                          })}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card-white p-5" data-testid="chart-country-split">
              <SectionTitle title="Country split" subtitle="Sales by country. Spot which markets are pulling weight." />
              {countryBars.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: 24 + countryBars.length * 56 }}>
                  <ResponsiveContainer>
                    <BarChart data={countryBars} layout="vertical" margin={{ left: isMobile ? 0 : 10, right: isMobile ? 80 : 200, top: 4 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: isMobile ? 9 : 10 }} />
                      <YAxis type="category" dataKey="country" width={isMobile ? 90 : 110}
                        tick={({ x, y, payload }) => {
                          const row = countryBars.find((r) => r.country === payload.value);
                          return (
                            <text x={x - 6} y={y + 4} fontSize={isMobile ? 10 : 11} textAnchor="end">
                              {row?.flag} {payload.value}
                            </text>
                          );
                        }} />
                      <Tooltip
                        allowEscapeViewBox={{ x: false, y: true }}
                        wrapperStyle={{ outline: "none", zIndex: 20 }}
                        content={
                          <ChartTooltip formatters={{
                            total_sales: (v, p) => `${fmtKES(v)} · ${fmtNum(p?.orders || 0)} orders · ${fmtNum(p?.units_sold || 0)} units · ${(p?.pct || 0).toFixed(1)}% of group`,
                          }} />
                        }
                      />
                      <Bar dataKey="total_sales" fill="#1a5c38" radius={[0, 5, 5, 0]} name="Total Sales">
                        <LabelList
                          dataKey="total_sales"
                          content={makePctDeltaLabel({
                            data: countryBars,
                            formatValue: (v) => isMobile ? fmtAxisKES(v) : fmtKES(v),
                            position: "right",
                            offset: 6,
                            fontSize: isMobile ? 9 : 10,
                            hideDelta: compareMode === "none",
                            labelTestId: "country-split-bar-label",
                          })}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="mt-6" data-testid="chart-channel-split">
                <SectionTitle title="Channel split" subtitle="How the Retail vs Online vs Wholesale mix is shaping up." />
                {channelBars.length === 0 ? <Empty /> : (
                  <div style={{ width: "100%", height: 24 + channelBars.length * 48 }}>
                    <ResponsiveContainer>
                      <BarChart data={channelBars} layout="vertical" margin={{ left: isMobile ? 0 : 10, right: isMobile ? 80 : 200, top: 4 }}>
                        <CartesianGrid horizontal={false} />
                        <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: isMobile ? 9 : 10 }} />
                        <YAxis type="category" dataKey="channel" width={isMobile ? 90 : 110} tick={{ fontSize: isMobile ? 10 : 11 }} />
                        <Tooltip
                          allowEscapeViewBox={{ x: false, y: true }}
                          wrapperStyle={{ outline: "none", zIndex: 20 }}
                          content={
                            <ChartTooltip formatters={{
                              total_sales: (v, p) => `${fmtKES(v)} · ${fmtNum(p?.orders || 0)} orders · ${fmtNum(p?.units_sold || 0)} units · ${(p?.pct || 0).toFixed(1)}% of group`,
                            }} />
                          }
                        />
                        <Bar dataKey="total_sales" fill="#00c853" radius={[0, 5, 5, 0]} name="Total Sales">
                          <LabelList
                            dataKey="total_sales"
                            content={makePctDeltaLabel({
                              data: channelBars,
                              formatValue: (v) => isMobile ? fmtAxisKES(v) : fmtKES(v),
                              position: "right",
                              offset: 6,
                              fontSize: isMobile ? 9 : 10,
                              hideDelta: compareMode === "none",
                              labelTestId: "channel-split-bar-label",
                            })}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card-white p-5" data-testid="chart-daily-trend">
            <SectionTitle
              title={rangeDays === 1 ? "Sales vs comparable days" : "Daily Sales Trend"}
              subtitle={
                rangeDays === 1
                  ? "Single-day view · bars compare Today to Same-Day-Last-Week / Month / Year"
                  : rangeDays <= 6
                  ? `One bar per day · ${dailyTotalSeries.length} days`
                  : compareMode === "none"
                  ? `Total Sales per day · ${dailyTotalSeries.length} days`
                  : `Solid = current · Dotted = ${compareMode === "last_month" ? "last month" : compareMode === "last_year" ? "last year" : "prior period"}`
              }
            />

            {rangeDays === 1 ? (
              // --- Single-day paired bars ---
              pairedBars.length === 0 ? (
                <Loading label="Loading comparison days…" />
              ) : (
                <div style={{ width: "100%", height: isMobile ? 360 : 280 }} data-testid="trend-paired-bars">
                  <ResponsiveContainer>
                    <BarChart
                      data={pairedBars}
                      margin={{ top: isMobile ? 64 : 40, right: isMobile ? 8 : 20, left: isMobile ? 0 : 10, bottom: isMobile ? 28 : 36 }}
                      barCategoryGap={isMobile ? "18%" : "24%"}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey={isMobile ? "short" : "subtitle"}
                        tick={{ fontSize: isMobile ? 10 : 11 }}
                        interval={0}
                      />
                      <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} width={isMobile ? 40 : 65} />
                      <Tooltip
                        cursor={{ fill: "rgba(26,92,56,0.06)" }}
                        allowEscapeViewBox={{ x: false, y: true }}
                        wrapperStyle={{ outline: "none", zIndex: 20 }}
                        content={
                          <ChartTooltip formatters={{
                            total_sales: (v, p) => `${fmtKES(v)} · ${fmtNum(p?.orders || 0)} orders${p?.delta_pct != null ? ` · ${p.delta_pct >= 0 ? "+" : ""}${p.delta_pct.toFixed(1)}% vs Today` : ""}`,
                          }} labelFormat={(l, p) => `${l}${p?.[0]?.payload?.subtitle && p[0].payload.subtitle !== l ? ` · ${p[0].payload.subtitle}` : ""}`} />
                        }
                      />
                      <Bar dataKey="total_sales" radius={[5, 5, 0, 0]} name="Total Sales">
                        {pairedBars.map((r) => (
                          <Cell key={r.key} fill={r.key === "today" ? "#1a5c38" : "#d97706"} />
                        ))}
                        <LabelList
                          dataKey="total_sales"
                          position="top"
                          formatter={(v) => (isMobile ? fmtAxisKES(v) : fmtKES(v))}
                          style={{ fontSize: isMobile ? 11 : 11, fill: "#1f2937", fontWeight: 700 }}
                          offset={isMobile ? 32 : 8}
                        />
                        <LabelList
                          dataKey="delta_pct"
                          position={isMobile ? "insideTop" : "top"}
                          offset={isMobile ? 8 : 22}
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            fill: isMobile ? "#ffffff" : "#059669",
                          }}
                          formatter={(v) => {
                            if (v == null) return "";
                            const pos = v > 0;
                            return `${pos ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`;
                          }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
            ) : rangeDays <= 6 ? (
              // --- 2-6 day mini bar chart ---
              dailyTotalSeries.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: 280 }} data-testid="trend-mini-bars">
                  <ResponsiveContainer>
                    <BarChart data={dailyTotalSeries} margin={{ top: 24, right: isMobile ? 8 : 20, left: isMobile ? 0 : 10, bottom: 10 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: isMobile ? 9 : 11 }}
                        angle={isMobile ? -20 : 0}
                        textAnchor={isMobile ? "end" : "middle"}
                        height={isMobile ? 48 : 30}
                        interval={0}
                        tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", isMobile ? { day: "2-digit", month: "short" } : { weekday: "short", day: "2-digit", month: "short" })}
                      />
                      <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} width={isMobile ? 48 : 65} />
                      <Tooltip
                        allowEscapeViewBox={{ x: false, y: true }}
                        wrapperStyle={{ outline: "none", zIndex: 20 }}
                        content={<ChartTooltip formatters={{ total: (v) => fmtKES(v), total_prev: (v) => fmtKES(v) }} labelFormat={(l) => fmtDate(l)} />}
                      />
                      <Bar dataKey="total" fill="#1a5c38" radius={[5, 5, 0, 0]} name="Total Sales">
                        <LabelList dataKey="total" position="top" formatter={(v) => (isMobile ? fmtAxisKES(v) : fmtKES(v))} style={{ fontSize: isMobile ? 9 : 10, fill: "#4b5563", fontWeight: 600 }} />
                      </Bar>
                      {compareMode !== "none" && (
                        <Bar dataKey="total_prev" fill="#d97706" radius={[5, 5, 0, 0]} name="Previous" opacity={0.7} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
            ) : (
              // --- ≥7 day line chart (original) ---
              dailyTotalSeries.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: 300 }} data-testid="trend-line-chart">
                  <ResponsiveContainer>
                    <LineChart data={dailyTotalSeries} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} />
                      <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} width={65} />
                      <Tooltip content={<ChartTooltip labelFormat={(l) => fmtDate(l)} formatters={{ "Total Sales": (v) => fmtKES(v), "Previous": (v) => fmtKES(v) }} />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="total" stroke="#1a5c38" strokeWidth={3} dot={{ r: 3, fill: "#1a5c38" }} activeDot={{ r: 5 }} name="Total Sales" isAnimationActive={false} />
                      {compareMode !== "none" && (
                        <Line type="monotone" dataKey="total_prev" stroke="#d97706" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Previous" isAnimationActive={false} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )
            )}
          </div>

          <div className="card-white p-5" data-testid="category-chart">
            <SectionTitle title="Sales by Category" subtitle="Where the money came from this period — by clothing category." />
            {salesByCategory.length === 0 ? <Empty /> : (
              isMobile ? (
                // ---- Mobile layout: horizontal bars (vertical reads better on
                // a phone — full category name fits, full inline label fits,
                // bars auto-grow with row count, no rotated x-axis ticks).
                <div style={{ width: "100%", height: Math.max(280, 40 + salesByCategory.length * 36) }}>
                  <ResponsiveContainer>
                    <BarChart data={salesByCategory} layout="vertical" margin={{ left: 0, right: 110, top: 4, bottom: 4 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 9 }} />
                      <YAxis type="category" dataKey="category" width={92} tick={{ fontSize: 10 }} />
                      <Tooltip content={
                        <ChartTooltip formatters={{
                          total_sales: (v, p) => `${fmtKES(v)} · ${fmtNum(p?.units_sold)} units · ${(p?.pct || 0).toFixed(1)}%`,
                        }} />
                      } />
                      <Bar dataKey="total_sales" fill="#1a5c38" radius={[0, 5, 5, 0]} name="Total Sales">
                        <LabelList
                          dataKey="total_sales"
                          content={makePctDeltaLabel({
                            data: salesByCategory,
                            formatValue: (v) => fmtAxisKES(v),
                            position: "right",
                            offset: 5,
                            fontSize: 9,
                            hideDelta: compareMode === "none",
                            labelTestId: "category-bar-label",
                          })}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={salesByCategory} margin={{ top: 28, right: 12, left: 0, bottom: 40 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="category"
                      tick={{ fontSize: 11 }}
                      interval={0}
                      tickFormatter={(v) => {
                        if (typeof window === "undefined") return v;
                        const m = window.innerWidth < 640;
                        const maxLen = m ? 8 : 22;
                        return v && v.length > maxLen ? v.slice(0, maxLen - 1) + "…" : v;
                      }}
                    />
                    <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} />
                    <Tooltip content={
                      <ChartTooltip formatters={{
                        total_sales: (v, p) => `${fmtKES(v)} · ${fmtNum(p?.units_sold)} units · ${(p?.pct || 0).toFixed(1)}%`,
                      }} />
                    } />
                    <Bar dataKey="total_sales" fill="#1a5c38" radius={[5, 5, 0, 0]} name="Total Sales">
                      <LabelList
                        dataKey="total_sales"
                        content={makePctDeltaLabel({
                          data: salesByCategory,
                          formatValue: (v) => isMobile ? fmtAxisKES(v) : fmtKES(v),
                          position: "top",
                          offset: 8,
                          fontSize: isMobile ? 9 : 10,
                          hideDelta: compareMode === "none",
                          labelTestId: "category-bar-label",
                        })}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              )
            )}
          </div>

          <div className="card-white p-5" data-testid="subcat-chart">
            <SectionTitle
              title={`Sales by Subcategory · ${subcatTop.length}`}
              subtitle={`Sales for every subcategory, biggest first. Total: ${fmtKES(subcatTopTotal)}`}
            />
            {subcatTop.length === 0 ? <Empty /> : (
              <div style={{ width: "100%", height: Math.max(360, 40 + subcatTop.length * 22) }}>
                <ResponsiveContainer>
                  <BarChart data={subcatTop} layout="vertical" margin={{ left: 4, right: 200, top: 4 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 10 }} />
                    <YAxis
                      type="category"
                      dataKey="subcategory"
                      width={typeof window !== "undefined" && window.innerWidth < 640 ? 100 : 170}
                      tick={{ fontSize: typeof window !== "undefined" && window.innerWidth < 640 ? 9 : 10 }}
                      tickFormatter={(v) => {
                        const maxLen = typeof window !== "undefined" && window.innerWidth < 640 ? 14 : 30;
                        return v && v.length > maxLen ? v.slice(0, maxLen - 1) + "…" : v;
                      }}
                    />
                    <Tooltip content={
                      <ChartTooltip formatters={{
                        total_sales: (v, p) => `${fmtKES(v)} · ${fmtNum(p?.units_sold)} units · ${(p?.pct || 0).toFixed(1)}%`,
                      }} />
                    } />
                    <Bar dataKey="total_sales" fill="#00c853" radius={[0, 5, 5, 0]} name="Total Sales">
                      <LabelList
                        dataKey="total_sales"
                        content={makePctDeltaLabel({
                          data: subcatTop,
                          formatValue: (v) => isMobile ? fmtAxisKES(v) : fmtKES(v),
                          position: "right",
                          offset: 6,
                          fontSize: isMobile ? 9 : 10,
                          hideDelta: compareMode === "none",
                          labelTestId: "subcat-bar-label",
                        })}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card-white p-5" data-testid="top-styles-section">
            <SectionTitle title="Top 20 Styles" subtitle="The 20 best-selling styles this period. Click any column to sort." />
            <SortableTable
              testId="top-styles"
              exportName="top-20-styles.csv"
              initialSort={{ key: "units_sold", dir: "desc" }}
              columns={[
                { key: "rank", label: "Rank", align: "left", sortable: false, render: (_r, i) => <span className="text-muted num">{i + 1}</span> },
                { key: "style_name", label: "Style Name", align: "left", render: (r) => <span className="font-medium max-w-[280px] truncate inline-block" title={r.style_name}>{r.style_name}</span> },
                { key: "product_type", label: "Subcategory", align: "left", render: (r) => r.product_type || "—" },
                { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                {
                  key: "current_stock",
                  label: "Inventory",
                  numeric: true,
                  render: (r) => fmtNum(r.current_stock),
                  sortValue: (r) => r.current_stock ?? -1,
                  csv: (r) => r.current_stock ?? "",
                },
                { key: "avg_price", label: "Avg Price", numeric: true, render: (r) => fmtKES(r.avg_price || (r.units_sold ? (r.total_sales || 0) / r.units_sold : 0)), csv: (r) => r.avg_price },
              ]}
              rows={topStyles}
            />
          </div>

          {/* ---- Below the fold: insights & projections ---- */}
          <div className="pt-2 border-t border-border/60" data-testid="insights-section">
            <div className="eyebrow mb-3 text-muted">Insights & Projections</div>
            <div className="space-y-6">
              <DailyBriefing
                kpis={kpis}
                prevKpis={kpisPrev}
                sales={sales}
                inventory={kpis}
                compareLbl={compareLbl}
              />
              <WinsThisWeekCard />
              {!isOnlineOnly && <StoreOfTheWeek />}
              <KpiTrendChart
                dateFrom={dateFrom}
                dateTo={dateTo}
                countries={countries}
                dataVersion={dataVersion}
              />
              <DataFreshness />
            </div>
          </div>
        </>
      )}
      </>)}
    </div>
  );
};

export default Overview;
