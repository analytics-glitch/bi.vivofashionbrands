import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API, timeout: 120000 });

// --- formatters ---
export const fmtKES = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "KES 0";
  return "KES " + Math.round(Number(n)).toLocaleString("en-US");
};

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

  return {
    yesterday: { date_from: toISO(yesterday), date_to: toISO(yesterday), label: "Yesterday" },
    today: { date_from: toISO(today), date_to: toISO(today), label: "Today" },
    this_week: { date_from: toISO(weekStart), date_to: toISO(weekEnd), label: "This Week" },
    this_month: { date_from: toISO(monthStart), date_to: toISO(monthEnd), label: "This Month" },
    last_month: { date_from: toISO(lastMonthStart), date_to: toISO(lastMonthEnd), label: "Last Month" },
    this_year: { date_from: toISO(yearStart), date_to: toISO(yearEnd), label: "This Year" },
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

export const comparePeriod = (from, to, mode) => {
  if (!mode || mode === "none") return null;
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
      label: "vs Last Year",
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
