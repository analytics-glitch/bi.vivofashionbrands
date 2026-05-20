import { useEffect, useState, useCallback } from "react";

/**
 * useAutoRefresh — drives a "tick" counter that flips every `intervalMs`
 * milliseconds when the tab is visible. Pages can include the tick in
 * their effect dependency array to re-fetch on a fixed cadence.
 *
 * Why this and not a raw `setInterval` inline:
 *   1. Pauses when the tab is backgrounded (no point burning Redis quota
 *      while the user has switched away).
 *   2. Exposes a `manualRefresh()` that bumps the tick immediately so a
 *      button click and the cadence share one re-fetch code path — no
 *      double-fetch race.
 *   3. Returns `lastRefreshed` so the page header can show "Refreshed
 *      14:18:35 EAT" — matches the Overview page convention.
 *
 * Default cadence is 30 s, mirroring Overview's behaviour so users get a
 * consistent feel across the dashboard.
 */
export function useAutoRefresh(intervalMs = 30000) {
  const [tick, setTick] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState(() => new Date());

  // Manual override — used by the page's "Refresh" button. Increments
  // the tick exactly once and stamps a fresh `lastRefreshed`.
  const manualRefresh = useCallback(() => {
    setTick((t) => t + 1);
    setLastRefreshed(new Date());
  }, []);

  useEffect(() => {
    let id = null;
    const start = () => {
      if (id != null) return;
      id = setInterval(() => {
        // Skip the tick when the tab is hidden — saves a 30s round-trip
        // every minute the user has the dashboard in a background tab.
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        setTick((t) => t + 1);
        setLastRefreshed(new Date());
      }, intervalMs);
    };
    const stop = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    start();
    // Pause when the tab is hidden, resume when it returns. This is the
    // standard "Page Visibility API" pattern — no extra deps required.
    const onVisChange = () => {
      if (document.visibilityState === "hidden") stop();
      else {
        start();
        // Bump immediately on return so the user doesn't see 30s-old
        // numbers when they come back to the tab.
        setTick((t) => t + 1);
        setLastRefreshed(new Date());
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisChange);
    }
    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisChange);
      }
    };
  }, [intervalMs]);

  return { tick, manualRefresh, lastRefreshed };
}

export default useAutoRefresh;
