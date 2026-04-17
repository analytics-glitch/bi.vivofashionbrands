import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, timeout: 45000 });

export const fmtMoney = (n, currency = "USD") => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const suffix = abs >= 1_000_000 ? "M" : abs >= 1_000 ? "K" : "";
  const value = abs >= 1_000_000 ? n / 1_000_000 : abs >= 1_000 ? n / 1_000 : n;
  return (
    (currency === "USD" ? "$" : "") +
    value.toLocaleString(undefined, {
      minimumFractionDigits: suffix ? 1 : 0,
      maximumFractionDigits: suffix ? 2 : 0,
    }) +
    suffix
  );
};

export const fmtNumber = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
};

export const fmtPct = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return `${Number(n).toFixed(1)}%`;
};

export const COUNTRY_FLAGS = {
  Kenya: "🇰🇪",
  Uganda: "🇺🇬",
  Rwanda: "🇷🇼",
  Other: "🌍",
};
