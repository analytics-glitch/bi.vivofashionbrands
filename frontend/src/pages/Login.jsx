import React, { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { GoogleLogo, Envelope, Lock, SignIn, Warning } from "@phosphor-icons/react";
import { api } from "@/lib/api";

const GOOGLE_AUTH_URL = "https://auth.emergentagent.com/";

const Login = () => {
  const { user, loginWithPassword } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [domains, setDomains] = useState([]);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => {
    api.get("/auth/allowed-domains").then((r) => setDomains(r.data.domains || [])).catch(() => {});
  }, []);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // iOS Safari password-manager autofill often sets input.value WITHOUT
      // firing React's onChange, so state is stale/empty. Read the live DOM
      // value as a fallback before submitting.
      const em = (email.trim() || emailRef.current?.value?.trim() || "").trim();
      const pw = password || passwordRef.current?.value || "";
      if (!em || !pw) {
        setError("Please enter both email and password.");
        return;
      }
      await loginWithPassword(em, pw);
      navigate("/", { replace: true });
    } catch (err) {
      // Surface the ACTUAL failure cause so iOS Safari issues are debuggable
      // instead of a generic "Login failed". Pick the most specific source
      // available, in priority order.
      let msg;
      if (err?.name === "QuotaExceededError") {
        msg = "Your browser is blocking session storage (iOS Safari Private mode). Turn off Private Browsing and try again.";
      } else if (err?.response?.data?.detail) {
        // Backend replied with a structured error — trust it.
        msg = err.response.data.detail;
      } else if (err?.response) {
        // Backend replied but with no detail field.
        msg = `Server returned HTTP ${err.response.status}. Please try again or contact support.`;
      } else if (err?.code === "ERR_NETWORK" || err?.message?.includes("Network Error")) {
        // Most common iOS failure: browser blocked the request at the network
        // layer (CORS / certificate / ITP). Give the user something actionable.
        msg = "Cannot reach the server from this browser. On iOS: turn off Private Browsing, check your network, and reload the page. If the issue persists, please screenshot this and send to IT.";
      } else if (err?.code === "ECONNABORTED") {
        msg = "The server took too long to respond. Check your connection and try again.";
      } else {
        msg = `Login failed: ${err?.message || "unknown error"}`;
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const googleSignIn = () => {
    // Emergent redirect flow — returns to /auth/callback with #session_id=…
    const redirect = `${window.location.origin}/auth/callback`;
    window.location.href = `${GOOGLE_AUTH_URL}?redirect=${encodeURIComponent(redirect)}`;
  };

  return (
    <div className="min-h-screen bg-background grid place-items-center p-4" data-testid="login-page">
      <div className="w-full max-w-md card-white p-8 shadow-md">
        <div className="flex items-center gap-3 mb-6">
          <img src="/brand/vivo-logo.png" alt="Vivo Fashion Group" className="h-11 w-auto rounded-md shrink-0" />
          <div>
            <div className="font-bold tracking-tight">Vivo Fashion Group</div>
            <div className="text-[11px] text-muted uppercase tracking-wider">BI · East Africa</div>
          </div>
        </div>

        <h1 className="font-extrabold text-[22px] tracking-tight mb-1">Sign in</h1>
        <p className="text-muted text-[13px] mb-6">
          Access is restricted to {domains.map((d, i) => (
            <span key={d} className="font-semibold text-foreground">
              {i > 0 && " or "}@{d}
            </span>
          ))} email domains.
        </p>

        <button
          type="button"
          onClick={googleSignIn}
          data-testid="google-signin-btn"
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl border border-border hover:border-brand hover:bg-brand-soft transition-colors font-semibold text-[14px]"
        >
          <GoogleLogo size={18} weight="bold" />
          Sign in with Google
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] text-muted uppercase tracking-wider">or email</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={onSubmit} className="space-y-3" data-testid="login-form">
          <div>
            <label htmlFor="login-email" className="text-[11px] font-semibold text-muted uppercase tracking-wider">Email</label>
            <div className="mt-1 relative">
              <Envelope size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="login-email"
                name="email"
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                data-testid="login-email"
                // font-size 16px prevents iOS auto-zoom on focus.
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border focus:border-brand outline-none text-[16px]"
                autoComplete="username email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                enterKeyHint="next"
              />
            </div>
          </div>
          <div>
            <label htmlFor="login-password" className="text-[11px] font-semibold text-muted uppercase tracking-wider">Password</label>
            <div className="mt-1 relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="login-password"
                name="password"
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                data-testid="login-password"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border focus:border-brand outline-none text-[16px]"
                autoComplete="current-password"
                enterKeyHint="go"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 text-danger px-3 py-2 text-[12.5px] flex items-start gap-2" data-testid="login-error">
              <Warning size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            data-testid="login-submit"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand text-white font-semibold text-[14px] hover:bg-brand-deep disabled:opacity-60"
          >
            <SignIn size={15} weight="bold" />
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-5 text-[11.5px] text-muted leading-relaxed">
          Email/password accounts are created by your administrator. Contact them if you need access.
        </p>

        <div className="mt-6 pt-4 border-t border-border/60 flex items-center justify-center gap-2 text-[11px] text-muted">
          <span>Powered by</span>
          <img src="/brand/vivo-logo.png" alt="Vivo BI" className="h-4 w-auto rounded-sm" />
          <span className="font-semibold text-foreground/70">BI</span>
        </div>
      </div>
    </div>
  );
};

export default Login;
