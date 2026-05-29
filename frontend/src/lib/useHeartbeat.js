import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/lib/api";

/**
 * useHeartbeat — Iter 89w-g
 *
 * Pings POST /api/auth/heartbeat every 2 minutes while at least one
 * tab of the app is open with an authenticated user.  The backend
 * upserts a row in `user_presence` so admins can see "who is using
 * the system right now" on the Activity Logs page.
 *
 * • Fires once immediately on mount so the user shows up without
 *   waiting 2 min after login.
 * • Restarts the timer whenever the route changes so the `page`
 *   field in the presence doc stays accurate.
 * • Silently swallows errors — presence is best-effort, never block
 *   the UI on it.
 */
const HEARTBEAT_MS = 2 * 60 * 1000;

export default function useHeartbeat(enabled) {
  const location = useLocation();
  const pageRef = useRef(location.pathname);
  pageRef.current = location.pathname;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const ping = () => {
      if (cancelled) return;
      api.post("/auth/heartbeat", { page: pageRef.current }).catch(() => {});
    };
    ping();                                  // immediate
    const id = setInterval(ping, HEARTBEAT_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  // Re-ping (cheap) whenever the route changes so the `page` field
  // updates promptly instead of waiting for the next 2-min tick.
  useEffect(() => {
    if (!enabled) return;
    api.post("/auth/heartbeat", { page: location.pathname }).catch(() => {});
  }, [enabled, location.pathname]);
}
