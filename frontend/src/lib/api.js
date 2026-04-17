import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API, timeout: 60000 });

// Full numbers with commas, no K/M abbreviations
export const fmtKES = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "KES 0";
  return "KES " + Math.round(Number(n)).toLocaleString("en-US");
};

export const fmtKESDec = (n, decimals = 0) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "KES 0";
  return (
    "KES " +
    Number(n).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
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

export const fmtDate = (d) => {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const firstOfMonthISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

// Compact formatter — ONLY for chart axis labels where full numbers are too wide.
// NOT used for KPI values, highlight cards, or tables (those always use fmtKES).
export const fmtAxisKES = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "0";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (abs >= 1_000) return (v / 1_000).toFixed(0) + "K";
  return String(Math.round(v));
};

export const COUNTRY_FLAGS = {
  Kenya: "🇰🇪",
  Uganda: "🇺🇬",
  Rwanda: "🇷🇼",
  Other: "🌍",
};

export const storeToCountry = (sid) => {
  if (!sid) return "Other";
  const s = String(sid).toLowerCase();
  if (s.includes("uganda")) return "Uganda";
  if (s.includes("rwanda")) return "Rwanda";
  if (s.includes("vivofashiongroup") || s.includes("kenya")) return "Kenya";
  return "Other";
};

export const countryToStoreId = (country) => {
  if (!country || country === "all") return undefined;
  const c = String(country).toLowerCase();
  if (c === "kenya") return "vivofashiongroup";
  if (c === "uganda") return "vivo-uganda";
  if (c === "rwanda") return "vivo-rwanda";
  return undefined;
};

// Compute comparable previous periods (same window length).
// Shift both from & to back by N months / years; clamp day to end of month if overflow.
const shiftISO = (iso, years, months) => {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCFullYear(base.getUTCFullYear() + years);
  base.setUTCMonth(base.getUTCMonth() + months);
  // if overflowed (e.g. shifting mar 31 by -1 month -> mar 3), pin to last of target month
  if (base.getUTCDate() !== d) base.setUTCDate(0);
  return base.toISOString().slice(0, 10);
};

export const prevMonthRange = (from, to) => ({
  date_from: shiftISO(from, 0, -1),
  date_to: shiftISO(to, 0, -1),
});

export const prevYearRange = (from, to) => ({
  date_from: shiftISO(from, -1, 0),
  date_to: shiftISO(to, -1, 0),
});

export const pctDelta = (current, prev) => {
  if (prev === null || prev === undefined || prev === 0) return null;
  return ((current - prev) / prev) * 100;
};

export const fmtDelta = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
};
