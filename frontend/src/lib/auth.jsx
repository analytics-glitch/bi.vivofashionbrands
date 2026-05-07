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
      // Pending-approval users get a 403 on /me but their session is
      // still valid — fetch a status-only payload so we can render the
      // awaiting-approval screen instead of bouncing them to /login.
      if (err?.response?.status === 403 && err?.response?.data?.detail?.startsWith?.("account_")) {
        try {
          const s = await api.get("/auth/me/status");
          setUser({ ...s.data, _restricted: true, _restrictionReason: err.response.data.detail });
        } catch {
          setUser(false);
          setStoredToken(null);
        }
      } else {
        setUser(false);
        setStoredToken(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // CRITICAL: if returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

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
