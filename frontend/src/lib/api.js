import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

// Convenience date helpers — all timezone-aware for Africa/Nairobi (UTC+3).
function nairobiNow() {
  // Returns a Date object whose UTC components reflect Nairobi local time.
  const offsetMs = 3 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs);
}

export function today() {
  return nairobiNow().toISOString().slice(0, 10);
}
export function daysAgo(n) {
  const d = nairobiNow();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
export function mtdStart() {
  const d = nairobiNow();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}
export function ytdStart() {
  const d = nairobiNow();
  return `${d.getUTCFullYear()}-01-01`;
}
export function prevMonthRange() {
  const d = nairobiNow();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();  // 0-indexed; previous month = m-1
  const firstPrev = new Date(Date.UTC(y, m - 1, 1));
  const lastPrev = new Date(Date.UTC(y, m, 0));  // day 0 = last day prev
  return { from: firstPrev.toISOString().slice(0, 10), to: lastPrev.toISOString().slice(0, 10) };
}

export function formatKES(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

export function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-KE").format(Number(n));
}

export function formatDate(s) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return s;
  }
}

export function timeAgo(s) {
  if (!s) return "";
  const ms = Date.now() - new Date(s).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function normalisePhoneKenya(phone) {
  if (!phone) return phone;
  let p = String(phone).replace(/\s+/g, "");
  if (p.startsWith("+254")) return p;
  if (p.startsWith("254")) return "+" + p;
  if (p.startsWith("0")) return "+254" + p.slice(1);
  return p;
}
