import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, clearApiCache } from "@/lib/api";

/**
 * Auth context — session_token stored in httpOnly cookie (set by backend)
 * AND in a resilient storage fallback for the Authorization: Bearer flow.
 *
 * iOS Safari notes:
 *   • Safari on iOS Private mode throws on `localStorage.setItem` (quota).
 *   • Safari ITP blocks third-party `SameSite=None` cookies aggressively,
 *     so the Bearer fallback is the REAL auth path on iOS. Losing the
 *     token to a silent storage error breaks login entirely.
 *
 * Strategy: localStorage → sessionStorage → in-memory. Always wrapped
 * in try/catch. `getStoredToken` reads from all three.
 *
 * REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
 */
const AuthContext = createContext(null);

const TOKEN_KEY = "vivo_bi_token";

// In-memory fallback for Safari Private mode where both localStorage AND
// sessionStorage setItem throw a QuotaExceededError.
let _memoryToken = null;

const safeSet = (store, key, value) => {
  try {
    if (value == null) store.removeItem(key);
    else store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const safeGet = (store, key) => {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
};

export const getStoredToken = () =>
  safeGet(window.localStorage, TOKEN_KEY) ||
  safeGet(window.sessionStorage, TOKEN_KEY) ||
  _memoryToken ||
  null;

export const setStoredToken = (t) => {
  _memoryToken = t || null;
  // Try persistent storage first, then session, then rely on in-memory.
  const ok = safeSet(window.localStorage, TOKEN_KEY, t);
  if (!ok) safeSet(window.sessionStorage, TOKEN_KEY, t);
};

// axios interceptor: attach Bearer header on every request.
//
// CRITICAL for iOS Safari: we do NOT set `withCredentials = true` here.
// When the server returns `Access-Control-Allow-Origin: *` (which the
// Emergent ingress does by default in production), Safari iOS STRICTLY
// refuses to read a credentialed response — it surfaces as a generic
// "Network Error" on the frontend, which users see as "Login failed".
// Chrome and Android tolerate this. By relying ONLY on the Bearer token
// in the Authorization header (which works cross-origin with `*`), we
// guarantee every browser — iOS Safari included — can read the response.
api.interceptors.request.use((config) => {
  const t = getStoredToken();
  if (t) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${t}`;
  }
  return config;
});

export const AuthProvider = ({ children }) => {
  // null = checking, false = anonymous, user obj = authed
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const r = await api.get("/auth/me");
      setUser(r.data);
    } catch (err) {
      const status = err?.response?.status;
      // Pending-approval users get a 403 on /me but their session is
      // still valid — fetch a status-only payload so we can render the
      // awaiting-approval screen instead of bouncing them to /login.
      if (status === 403 && err?.response?.data?.detail?.startsWith?.("account_")) {
        try {
          const s = await api.get("/auth/me/status");
          setUser({ ...s.data, _restricted: true, _restrictionReason: err.response.data.detail });
        } catch {
          setUser(false);
          setStoredToken(null);
        }
        return;
      }
      // 401 = the token is actually invalid (expired/revoked). Log out.
      if (status === 401) {
        setUser(false);
        setStoredToken(null);
        return;
      }
      // 5xx / network error / no response — treat as transient. The
      // user's session almost certainly still works; this is just a
      // backend hiccup (circuit-breaker open on a tangential
      // endpoint, brief 504 from the upstream BI proxy, brief
      // disconnection, etc.). Wiping the token here logs every
      // active user out for what is almost always a 30-second blip.
      // The 30 s polling effect (line 132) will retry automatically.
      // If we have NO existing user state yet (initial page load
      // before login), we have to surface "anonymous" so the Login
      // page renders — but we DO NOT clear a stored token, so the
      // very next /auth/me call from Login or after the user
      // intervenes will succeed without forcing a re-login.
      // eslint-disable-next-line no-console
      console.warn("[auth] /auth/me transient error — keeping session", err?.message || err);
      setUser((prev) => prev || false);
    }
  }, []);

  // Wrap the finally{setLoading(false)} separately so the early-
  // return branches above still resolve the loading state.
  const checkAuthAndStop = useCallback(async () => {
    try {
      await checkAuth();
    } finally {
      setLoading(false);
    }
  }, [checkAuth]);

  useEffect(() => {
    // CRITICAL: if returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuthAndStop();
  }, [checkAuthAndStop]);

  // Periodic auth re-validation. Without this, an admin who flips a
  // user's role / status / active flag has to wait until the user
  // manually refreshes (worst case: until their browser tab is
  // closed) for the change to take effect. We re-check every 30 s
  // when the tab is visible and once on every focus event, so any
  // change made in the Users admin propagates within seconds.
  // The /auth/me endpoint is exempt from the response cache (see
  // NO_CACHE_PATHS in api.js) so each poll always hits the wire.
  useEffect(() => {
    if (!user || user === false) return;
    let cancelled = false;
    const safeCheck = () => {
      if (cancelled || document.hidden) return;
      checkAuth();
    };
    const id = setInterval(safeCheck, 30000);
    const onFocus = () => safeCheck();
    const onVisibility = () => { if (!document.hidden) safeCheck(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, checkAuth]);

  const loginWithPassword = useCallback(async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    setStoredToken(r.data.token);
    setUser(r.data.user);
    return r.data.user;
  }, []);

  const completeGoogleLogin = useCallback(async (session_id) => {
    const r = await api.post("/auth/google/callback", { session_id });
    setStoredToken(r.data.token);
    // Newly-provisioned Google users come back with status="pending".
    // Mark them restricted so the app shell renders the awaiting-
    // approval screen instead of the dashboard.
    const incoming = r.data.user;
    if (incoming?.status === "pending" || incoming?.status === "rejected") {
      setUser({ ...incoming, _restricted: true, _restrictionReason: `account_${incoming.status}_approval` });
    } else {
      setUser(incoming);
    }
    return incoming;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch { /* ignore */ }
    setStoredToken(null);
    // Drop ALL cached responses — otherwise the next user that logs in on
    // this browser sees the previous user's data flash in for ~5 s while
    // the response cache TTL expires. Also clears any stuck inflight
    // promises so the new login starts from a clean slate.
    clearApiCache();
    setUser(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, loginWithPassword, completeGoogleLogin, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
