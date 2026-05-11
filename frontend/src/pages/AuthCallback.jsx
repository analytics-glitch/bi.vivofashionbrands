import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser, refresh } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const hash = window.location.hash || "";
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) {
      navigate("/login", { replace: true });
      return;
    }
    const session_id = decodeURIComponent(m[1]);

    (async () => {
      try {
        const r = await api.post("/auth/session", { session_id });
        // Strip the hash so we don't re-process and so AuthContext doesn't keep skipping /me
        window.history.replaceState(null, "", "/dashboard");
        // CRITICAL: hydrate the auth context immediately. Otherwise ProtectedRoutes
        // sees user=null & loading=false and redirects back to /login.
        if (r.data?.user) {
          setUser(r.data.user);
        } else {
          await refresh();
        }
        navigate("/dashboard", { replace: true });
      } catch (e) {
        console.error("Auth exchange failed", e);
        // Surface the 403 domain-block message back to the login page.
        const detail = e?.response?.data?.detail;
        const reason = e?.response?.status === 403 && detail ? detail : null;
        if (reason) {
          navigate(`/login?error=${encodeURIComponent(reason)}`, { replace: true });
        } else {
          navigate("/login", { replace: true });
        }
      }
    })();
  }, [navigate, setUser, refresh]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--vivo-bg)]">
      <div className="text-center">
        <div className="eyebrow mb-3">VIVO · CLIENTELING</div>
        <p className="text-[var(--vivo-muted)]">Signing you in…</p>
      </div>
    </div>
  );
}
