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

// ---------------------------------------------------------------------------
// Cache-busting + inflight de-dup + short-lived response cache
// ---------------------------------------------------------------------------
// Two effects in the same component mount, React 18 StrictMode double-fires,
// or a parent + child both calling /kpis/data-freshness used to result in
// 5–15 duplicate concurrent requests per page load — saturating the upstream
// connection pool and surfacing as PoolTimeouts.
//
// `_inflight` collapses concurrent identical GETs into a single Promise:
// the second caller subscribes to the first call's response.
//
// `_respCache` then memoises the resolved data for `RESP_TTL_MS` so a
// component that mounts shortly after another (e.g. quick navigation back
// to a recently-viewed page) gets an instant hit. Keep TTL short — these
// are LIVE business numbers, not static.
const _inflight = new Map();   // key -> Promise<resp>
const _respCache = new Map();  // key -> { ts, data }
// 5 minutes — dashboard reads are 99% idempotent (BI numbers refresh on
// the order of minutes, not seconds). A 5-minute cache means navigating
// between pages re-uses identical KPI/sales/inventory payloads instead
// of paying the upstream cost every time, which dramatically smooths
// perceived performance even when upstream is degraded. Refresh button
// still bumps `dataVersion` which forces a fresh fetch.
const RESP_TTL_MS = 5 * 60_000;
const RESP_CACHE_MAX = 600;
// Hot endpoints whose values change every few seconds (notification
// counts, late-transfer pings, freshness pulses) should bypass the long
// 5-min cache — they get a tighter 30s window so the UI stays fresh.
const FAST_TTL_PATHS = [
  "/notifications/unread-count",
  "/ibt/late-count",
  "/data-freshness",
];
// Auth endpoints MUST NEVER be cached. When an admin flips a user's
// role, status (pending → active), or `active` flag, the next read of
// /auth/me must reflect the change immediately — otherwise the affected
// user keeps the stale role / "awaiting approval" screen for up to the
// full RESP_TTL_MS window (5 min) even across hard refresh, because the
// sessionStorage rehydrate restores the stale payload on page load.
// Listed here so both the cache short-circuit AND the persistence layer
// skip them in lockstep.
const NO_CACHE_PATHS = [
  "/auth/me",
  "/auth/me/status",
  "/auth/login",
  "/auth/logout",
  "/auth/google/callback",
];
const _shouldSkipCache = (url) =>
  NO_CACHE_PATHS.some((p) => url.includes(p));
const _ttlFor = (url) =>
  FAST_TTL_PATHS.some((p) => url.includes(p)) ? 30_000 : RESP_TTL_MS;

// sessionStorage persistence — survives page navigations, BFCache
// restores, and (critically) hard refreshes within the same tab. Keyed
// per logged-in user via a salt that's set on login. Wiped on logout.
const SS_KEY = "_vivo_respcache_v2";
const _safeSS = () => {
  try { return typeof window !== "undefined" ? window.sessionStorage : null; }
  catch { return null; }
};
const _hydrateFromSS = () => {
  const ss = _safeSS();
  if (!ss) return;
  try {
    const raw = ss.getItem(SS_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    const now = Date.now();
    for (const [k, v] of arr) {
      // Defensively drop any auth payloads that may have leaked into
      // the persisted blob from older builds — these endpoints are now
      // strictly bypass-cache (see NO_CACHE_PATHS). Without this guard
      // a long-running tab can still serve a stale role/status from
      // session storage on the next refresh.
      if (NO_CACHE_PATHS.some((p) => k.includes(p))) continue;
      // Skip entries already past their (per-key) TTL on rehydrate.
      if (v && v.ts && (now - v.ts) < RESP_TTL_MS) {
        _respCache.set(k, v);
      }
    }
  } catch { /* corrupted blob — ignore */ }
};
let _ssFlushTimer = null;
const _scheduleSSFlush = () => {
  const ss = _safeSS();
  if (!ss) return;
  if (_ssFlushTimer) return;
  // Debounce so a burst of cache writes only pays one stringify cost.
  _ssFlushTimer = setTimeout(() => {
    _ssFlushTimer = null;
    try {
      const arr = [..._respCache.entries()];
      ss.setItem(SS_KEY, JSON.stringify(arr));
    } catch (e) {
      // QuotaExceeded — drop the oldest 20% and retry once.
      try {
        const sorted = [..._respCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
        const drop = Math.ceil(sorted.length * 0.2);
        for (let i = 0; i < drop; i++) _respCache.delete(sorted[i][0]);
        ss.setItem(SS_KEY, JSON.stringify([..._respCache.entries()]));
      } catch { ss.removeItem(SS_KEY); }
    }
  }, 250);
};
_hydrateFromSS();

const _cacheKey = (url, params) => {
  const p = { ...(params || {}) };
  delete p._t;
  const ordered = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("&");
  return `get ${url}?${ordered}`;
};

// Cache-busting interceptor — appends `_t` to every GET so the browser /
// upstream CDN can't return stale responses. Only added at the wire layer
// (the dedup key strips `_t` before hashing).
api.interceptors.request.use((cfg) => {
  if ((cfg.method || "get").toLowerCase() === "get") {
    cfg.params = { ...(cfg.params || {}), _t: Date.now() };
  }
  return cfg;
});

// Response-side retry interceptor. Transient upstream wobbles (network
// blip, 5xx, ECONNABORTED) used to surface as "failed refresh" toasts
// even though a single retry would have succeeded. We now retry up to
// 2 extra times with exponential backoff (500ms → 1500ms) before
// bubbling the error to the caller. Idempotent paths only (GET) — POST
// / PATCH / DELETE never auto-retry to avoid double-writes.
const _RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
api.interceptors.response.use(undefined, async (error) => {
  const cfg = error?.config;
  if (!cfg) return Promise.reject(error);
  const status = error?.response?.status;
  const url = cfg.url || "";
  // Iter 78 — 401 redirect-to-login interceptor.
  // If the JWT has expired mid-session, every subsequent call returns
  // 401. Without this guard the user just sees red error boxes until
  // their next route change (when /auth/me fails and the auth provider
  // resets). With it, we wipe the token + bounce to /login the first
  // time we see 401 on a non-auth path. The auth endpoints themselves
  // are excluded so the login form can render its own validation
  // error instead of looping.
  const isAuthPath = NO_CACHE_PATHS.some((p) => url.includes(p));
  if (status === 401 && !isAuthPath) {
    try {
      // Clear the stored token + persisted response cache so the next
      // tab/refresh starts clean.
      if (typeof window !== "undefined") {
        try { window.localStorage.removeItem("vivo_token"); } catch { /* noop */ }
        const ss = _safeSS();
        if (ss) try { ss.removeItem(SS_KEY); } catch { /* noop */ }
      }
      _respCache.clear();
      _inflight.clear();
      // Hard redirect — React Router would keep the in-memory user
      // state and we want a clean slate.
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.assign("/login?session_expired=1");
      }
    } catch { /* defensive — never break the rejection path */ }
    return Promise.reject(error);
  }
  const method = (cfg.method || "get").toLowerCase();
  if (method !== "get") return Promise.reject(error);
  // Don't retry auth — those are sensitive and the FE already polls.
  if (NO_CACHE_PATHS.some((p) => (cfg.url || "").includes(p))) {
    return Promise.reject(error);
  }
  const transient =
    !error.response ||  // network error
    status === undefined ||
    _RETRYABLE_STATUS.has(status) ||
    error.code === "ECONNABORTED" ||
    error.code === "ERR_NETWORK";
  if (!transient) return Promise.reject(error);
  cfg.__retryCount = (cfg.__retryCount || 0) + 1;
  if (cfg.__retryCount > 2) return Promise.reject(error);
  const backoff = cfg.__retryCount === 1 ? 500 : 1500;
  await new Promise((res) => setTimeout(res, backoff));
  return _origGet ? _origGet(cfg.url, cfg) : api.request(cfg);
});

// Wrap api.get to provide inflight de-dup + a 5-s response cache. The
// wrapper computes the key from (url, params), then short-circuits with
// the cached value, attaches to an existing inflight Promise, or fires a
// new request and registers it.
const _origGet = api.get.bind(api);
api.get = (url, config = {}) => {
  const params = (config && config.params) || {};
  const key = _cacheKey(url, params);
  // Auth endpoints bypass the response cache entirely. See NO_CACHE_PATHS
  // — role / status / active changes must be picked up on the next read,
  // not in 5 minutes.
  if (_shouldSkipCache(url)) {
    return _origGet(url, config);
  }
  // Caller can force-bypass the response cache by passing
  // `forceFresh: true` in config. Used when an action just mutated
  // server state and we need the next read to actually hit the wire
  // (e.g. saving the replenishment owner roster, then refetching the
  // distributed list).
  const force = !!config.forceFresh;
  if (force) {
    _respCache.delete(key);
    _inflight.delete(key);
  }

  const cached = !force && _respCache.get(key);
  if (cached && (Date.now() - cached.ts) < _ttlFor(url)) {
    return Promise.resolve({
      data: cached.data,
      status: 200,
      statusText: "OK (client-cache)",
      headers: {},
      config,
    });
  }
  const existing = !force && _inflight.get(key);
  if (existing) return existing;

  const p = _origGet(url, config)
    .then((resp) => {
      _respCache.set(key, { ts: Date.now(), data: resp.data });
      // Bound the response cache size (LRU-ish — drop oldest entries).
      if (_respCache.size > RESP_CACHE_MAX) {
        const oldest = [..._respCache.entries()]
          .sort((a, b) => a[1].ts - b[1].ts)
          .slice(0, _respCache.size - RESP_CACHE_MAX);
        for (const [k] of oldest) _respCache.delete(k);
      }
      _scheduleSSFlush();
      return resp;
    })
    .finally(() => {
      _inflight.delete(key);
    });
  _inflight.set(key, p);
  return p;
};

/** Force-clear the response/inflight caches. Called on logout so the
 * next user's session never reads the previous user's data. */
export const clearApiCache = () => {
  _inflight.clear();
  _respCache.clear();
  const ss = _safeSS();
  if (ss) { try { ss.removeItem(SS_KEY); } catch { /* ignore */ } }
};

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
