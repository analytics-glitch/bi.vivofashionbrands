import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// iOS Safari CORS resilience: if the configured backend shares an origin
// with the page (common in production where /api/* is proxied via the
// same domain), use a RELATIVE base URL. Same-origin requests bypass
// CORS entirely — no preflight, no Origin header games, no ITP edge
// cases. Falls back to the full URL when they differ (e.g. the preview
// env where BACKEND_URL is a different subdomain).
const sameOrigin = (() => {
  try {
    if (!BACKEND_URL || typeof window === "undefined") return false;
    const u = new URL(BACKEND_URL);
    return u.host === window.location.host && u.protocol === window.location.protocol;
  } catch {
    return false;
  }
})();

export const API = sameOrigin ? "/api" : `${BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API, timeout: 120000 });

// Cache-busting interceptor — appends `_t` param to every GET so the
// browser / upstream CDN can't return stale responses.
api.interceptors.request.use((cfg) => {
  if ((cfg.method || "get").toLowerCase() === "get") {
    cfg.params = { ...(cfg.params || {}), _t: Date.now() };
  }
  return cfg;
});

// --- formatters ---
// Currency formatter — prefixes every value with "KES " so the unit is
// unambiguous on screen / in exports.
export const fmtKES = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "KES 0";
  return "KES " + Math.round(Number(n)).toLocaleString("en-US");
};

export const fmtKESLong = fmtKES;

export const fmtNum = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "0";
  return Math.round(Number(n)).toLocaleString("en-US");
};

export const fmtDec = (n, d = 2) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "0";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};

export const fmtPct = (n, d = 1) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "0%";
  return `${Number(n).toFixed(d)}%`;
};

export const fmtAxisKES = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "0";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (abs >= 1_000) return (v / 1_000).toFixed(0) + "K";
  return String(Math.round(v));
};

/** Compact 2-decimal currency for mobile. Examples:
 *   354_985_308  -> "KES 354.99M"
 *   1_310_617    -> "KES 1.31M"
 *   8_818        -> "KES 8.82K"
 *   985          -> "KES 985"
 * The 2-decimal precision matches the user's request for "2 decimal places"
 * on mobile while keeping the value short enough to fit a phone screen. */
export const fmtKESMobile = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "KES 0";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return "KES " + (v / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return "KES " + (v / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return "KES " + (v / 1_000).toFixed(2) + "K";
  return "KES " + Math.round(v).toLocaleString("en-US");
};

export const fmtDate = (d) => {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const fmtDelta = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  // Cap extreme values to prevent layout breaks on narrow cards.
  if (n > 999) return ">+999%";
  if (n < -999) return "<-999%";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
};

export const pctDelta = (current, prev) => {
  if (prev === null || prev === undefined || prev === 0) return null;
  return ((Number(current) - Number(prev)) / Number(prev)) * 100;
};

// --- date helpers ---
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => toISO(new Date());

export const datePresets = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const today = new Date(y, m, d);
  const yesterday = new Date(y, m, d - 1);

  // This week (Mon-Sun), ending today (live data)
  const weekDay = today.getDay() || 7;
  const weekStart = new Date(y, m, d - (weekDay - 1));
  const weekEnd = today;

  const monthStart = new Date(y, m, 1);
  // Month-to-date, ending today (live data)
  const monthEnd = today;

  const lastMonthStart = new Date(y, m - 1, 1);
  const lastMonthEnd = new Date(y, m, 0); // day 0 of this month = last day of previous month
  const yearStart = new Date(y, 0, 1);
  const yearEnd = today;

  // Trailing windows (always end today, exclude today's partial when noted).
  const minus = (days) => new Date(y, m, d - days);

  // Last full week (Mon-Sun) before this week.
  const lastWeekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 1);
  const lastWeekStart = new Date(lastWeekEnd.getFullYear(), lastWeekEnd.getMonth(), lastWeekEnd.getDate() - 6);

  // Last full quarter.
  const curQ = Math.floor(m / 3); // 0..3
  const lastQEndMonth = curQ * 3; // first month of current quarter
  const lastQStart = new Date(y, lastQEndMonth - 3, 1);
  const lastQEnd = new Date(y, lastQEndMonth, 0);

  // Quarter-to-date.
  const qtdStart = new Date(y, curQ * 3, 1);

  // Last full calendar year.
  const lastYearStart = new Date(y - 1, 0, 1);
  const lastYearEnd = new Date(y - 1, 11, 31);

  return {
    // Spec-named presets (preferred).
    today: { date_from: toISO(today), date_to: toISO(today), label: "Today" },
    yesterday: { date_from: toISO(yesterday), date_to: toISO(yesterday), label: "Yesterday" },
    last_7d: { date_from: toISO(minus(6)), date_to: toISO(today), label: "Last 7 days" },
    last_30d: { date_from: toISO(minus(29)), date_to: toISO(today), label: "Last 30 days" },
    last_90d: { date_from: toISO(minus(89)), date_to: toISO(today), label: "Last 90 days" },
    last_365d: { date_from: toISO(minus(364)), date_to: toISO(today), label: "Last 365 days" },
    last_week: { date_from: toISO(lastWeekStart), date_to: toISO(lastWeekEnd), label: "Last week" },
    last_month: { date_from: toISO(lastMonthStart), date_to: toISO(lastMonthEnd), label: "Last month" },
    last_quarter: { date_from: toISO(lastQStart), date_to: toISO(lastQEnd), label: "Last quarter" },
    last_12_months: { date_from: toISO(new Date(y, m - 12, d + 1)), date_to: toISO(today), label: "Last 12 months" },
    last_year: { date_from: toISO(lastYearStart), date_to: toISO(lastYearEnd), label: "Last year" },
    // Period-to-date.
    mtd: { date_from: toISO(monthStart), date_to: toISO(monthEnd), label: "Month to date" },
    qtd: { date_from: toISO(qtdStart), date_to: toISO(today), label: "Quarter to date" },
    ytd: { date_from: toISO(yearStart), date_to: toISO(yearEnd), label: "Year to date" },
    // Legacy names kept as aliases for URL backward compatibility.
    this_week: { date_from: toISO(weekStart), date_to: toISO(weekEnd), label: "This week" },
    this_month: { date_from: toISO(monthStart), date_to: toISO(monthEnd), label: "This month" },
    this_year: { date_from: toISO(yearStart), date_to: toISO(yearEnd), label: "This year" },
  };
};

// Shift ISO by years/months; used for compare windows
export const shiftISO = (iso, years, months) => {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  const total = y * 12 + (m - 1) + months;
  let ny = Math.floor(total / 12);
  let nm = (total % 12) + 1;
  ny += years;
  // clamp day to month end
  const lastDay = new Date(ny, nm, 0).getDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${pad(nm)}-${pad(nd)}`;
};

export const comparePeriod = (from, to, mode, custom) => {
  if (!mode || mode === "none") return null;
  const shiftDays = (iso, days) => {
    const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  };
  if (mode === "yesterday") {
    return {
      date_from: shiftDays(from, -1),
      date_to: shiftDays(to, -1),
      label: "vs Yesterday",
    };
  }
  if (mode === "last_month") {
    return {
      date_from: shiftISO(from, 0, -1),
      date_to: shiftISO(to, 0, -1),
      label: "vs Last Month",
    };
  }
  if (mode === "last_year") {
    return {
      date_from: shiftISO(from, -1, 0),
      date_to: shiftISO(to, -1, 0),
      label: "vs Previous Year",
    };
  }
  if (mode === "last_year_dow") {
    // Shift back 52 weeks (364 days) so day-of-week aligns. Some calendar
    // years require 53 weeks; we pick 52 because POS / footfall analysis
    // is dominated by weekday rhythm — Mon-to-Mon comparison.
    return {
      date_from: shiftDays(from, -364),
      date_to: shiftDays(to, -364),
      label: "vs Prev Year (DoW aligned)",
    };
  }
  if (mode === "custom") {
    if (!custom || !custom.date_from || !custom.date_to) return null;
    return {
      date_from: custom.date_from,
      date_to: custom.date_to,
      label: "vs Custom",
    };
  }
  return null;
};

// --- misc ---
export const COUNTRY_FLAGS = {
  Kenya: "🇰🇪",
  Uganda: "🇺🇬",
  Rwanda: "🇷🇼",
  Online: "🌐",
  Other: "🌍",
};

// Build query params; countries/channels are arrays → join w/ comma
export const buildParams = (filters, extra = {}) => {
  const p = {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    ...extra,
  };
  if (filters.countries && filters.countries.length) {
    p.country = filters.countries.join(",");
  }
  if (filters.channels && filters.channels.length) {
    p.channel = filters.channels.join(",");
  }
  return p;
};
