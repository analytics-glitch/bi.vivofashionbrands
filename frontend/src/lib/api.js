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
