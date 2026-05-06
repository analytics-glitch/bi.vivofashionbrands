/**
 * usePiiReveal — small hook that encapsulates the PII reveal step-up flow.
 *
 * The PII reveal token is short-lived (~10 min), HMAC-signed against the
 * caller's user_id, and returned by `POST /api/auth/verify-password`.
 * Once obtained, it must be passed as `X-PII-Reveal-Token` on every
 * subsequent call to a `?reveal=true` endpoint (e.g.
 * /api/top-customers, /api/customer-search, /api/churned-customers,
 * /api/analytics/customer-details).
 *
 * Persisted in sessionStorage so navigating between the Customers page
 * and the Customer Details page within the same tab keeps the unlock
 * (still expires server-side after 10 min — we just stop sending an
 * expired token after the cookie's TTL elapses).
 *
 * Usage:
 *   const { revealToken, setRevealToken, modal, openModal } = usePiiReveal();
 *   <button onClick={openModal}>Show contacts</button>
 *   {modal}
 *   api.get(url, { params: { reveal: revealToken ? true : undefined },
 *                  headers: revealToken ? { "X-PII-Reveal-Token": revealToken } : {} });
 */
import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const SESSION_KEY = "piiRevealToken";
// Server-side TTL is 10 min; we expire on the client at 9.5 min to be safe.
const CLIENT_TTL_MS = 9.5 * 60 * 1000;

export function usePiiReveal() {
  const [revealToken, setRevealTokenState] = useState(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const { token, ts } = JSON.parse(raw);
      if (!token || !ts) return null;
      if (Date.now() - ts > CLIENT_TTL_MS) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return token;
    } catch { return null; }
  });

  const setRevealToken = useCallback((tok) => {
    setRevealTokenState(tok);
    try {
      if (tok) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: tok, ts: Date.now() }));
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch { /* sessionStorage disabled — degrade gracefully */ }
  }, []);

  // Auto-expire client-side; server will also reject after 10 min.
  useEffect(() => {
    if (!revealToken) return;
    const t = setTimeout(() => setRevealToken(null), CLIENT_TTL_MS);
    return () => clearTimeout(t);
  }, [revealToken, setRevealToken]);

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const openModal = useCallback(() => { setOpen(true); setErr(null); setPassword(""); }, []);

  const submit = useCallback(async () => {
    if (!password) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post("/auth/verify-password", { password });
      const tok = r?.data?.reveal_token;
      if (!tok) throw new Error("Server returned no reveal token");
      setRevealToken(tok);
      setOpen(false);
      setPassword("");
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || "Verification failed");
    } finally {
      setBusy(false);
    }
  }, [password, setRevealToken]);

  // Modal element — render unconditionally; visibility is gated below.
  const modal = open ? (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      data-testid="reveal-modal"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
        <div className="font-extrabold text-[16px] mb-1">Enter PII reveal password</div>
        <div className="text-[12px] text-muted mb-4">
          This is the shared ops password (not your login). Unmasks customer phone &amp; email for the next 10 minutes. Each access is audit-logged.
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="PII reveal password"
          autoFocus
          data-testid="reveal-password-input"
          className="w-full px-3 py-2 rounded-lg border border-border text-[13px] mb-3"
        />
        {err && <div className="text-[12px] text-rose-600 mb-3" data-testid="reveal-error">{err}</div>}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-md border border-border hover:bg-panel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !password}
            data-testid="reveal-submit-btn"
            className="btn-primary disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Show contacts"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return {
    revealToken,
    setRevealToken,
    openModal,
    modal,
  };
}

export function piiHeaders(revealToken) {
  return revealToken ? { "X-PII-Reveal-Token": revealToken } : {};
}

// Mask a phone number to "0705***589" style — keep first 4 and last 3 digits visible.
export function maskPhone(p) {
  if (!p) return "";
  const s = String(p);
  if (s.length <= 7) return s;
  return s.slice(0, 4) + "***" + s.slice(-3);
}

// Mask an email — keep first char + domain. "j***@vivo.com"
export function maskEmail(e) {
  if (!e) return "";
  const at = e.indexOf("@");
  if (at < 1) return e;
  return e[0] + "***" + e.slice(at);
}
