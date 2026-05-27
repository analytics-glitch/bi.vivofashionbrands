import React, { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { Warning } from "@phosphor-icons/react";

/**
 * Backend URL Mismatch Warning pill (Iter 88m, May 2026).
 *
 * Detects the "wrong REACT_APP_BACKEND_URL after a fresh deploy" gotcha
 * documented by Emergent: each new deployment resets the system's
 * baked-in `REACT_APP_BACKEND_URL` env var to the preview URL, and if
 * the operator forgets to re-pin it to the custom domain in Secrets →
 * System keys, every browser request goes back to the preview pod.
 *
 * Compares `process.env.REACT_APP_BACKEND_URL` (baked into the bundle
 * at build time) against `window.location.origin` (the URL the user
 * is actually visiting). If they differ AND the user is on a real
 * custom domain (not localhost / preview), surface a loud red pill
 * pointing the admin straight at the fix.
 *
 * Visible to admin users only — viewers don't need to see it.
 */
const BackendUrlWarningPill = () => {
  const { user } = useAuth();

  const mismatch = useMemo(() => {
    if (typeof window === "undefined") return null;
    const expected = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "").toLowerCase();
    const current = window.location.origin.toLowerCase();
    if (!expected) return null;
    // Skip local dev + preview environments — there it's expected that
    // bundle backend URL != browser origin (e.g. localhost:3000 →
    // localhost:8001, or preview.emergentagent.com calls go to a
    // different ingress).
    if (current.includes("localhost") || current.includes("127.0.0.1")) return null;
    if (current.includes("emergentagent.com")) return null;
    if (expected === current) return null;
    // Extract just the hostname for the friendly message.
    let expectedHost = expected;
    try { expectedHost = new URL(expected).hostname; } catch { /* fall back to raw */ }
    return {
      expectedHost,
      currentHost: window.location.host,
    };
  }, []);

  if (!user || (user.role !== "admin" && user.role !== "exec")) return null;
  if (!mismatch) return null;

  const tooltip =
    `⚠️ Frontend bundle is pointing API calls at ${mismatch.expectedHost} ` +
    `but you're viewing the site as ${mismatch.currentHost}.\n\n` +
    `Fix:\n` +
    `1. Open the Emergent Deployments dashboard for this app\n` +
    `2. Secrets tab → System keys\n` +
    `3. Update REACT_APP_BACKEND_URL to https://${mismatch.currentHost}\n` +
    `4. Save and redeploy\n\n` +
    `This setting resets to the default on every fresh deploy — check it after each one.`;

  return (
    <div
      title={tooltip}
      data-testid="backend-url-mismatch-pill"
      className="hidden lg:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border bg-rose-50 text-rose-700 border-rose-300 text-[10.5px] font-bold animate-pulse"
      role="alert"
    >
      <Warning size={11} weight="fill" />
      <span>Backend URL mismatch</span>
    </div>
  );
};

export default BackendUrlWarningPill;
