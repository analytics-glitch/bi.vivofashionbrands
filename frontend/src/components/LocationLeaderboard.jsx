import React, { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { api, fmtKES } from "@/lib/api";

/**
 * Fire a small, warm confetti burst targeted at a DOM element. Designed
 * to feel like a micro-reward — never a full-screen takeover. Brand
 * palette: dark green, bright green, amber, white.
 */
const fireRecordConfetti = (targetEl) => {
  if (!targetEl || typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const rect = targetEl.getBoundingClientRect();
  const origin = {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  };
  const colors = ["#1a5c38", "#00c853", "#f59e0b", "#ffffff"];
  try {
    confetti({
      particleCount: 36,
      spread: 55,
      startVelocity: 28,
      gravity: 0.9,
      scalar: 0.85,
      ticks: 120,
      origin,
      colors,
      disableForReducedMotion: true,
    });
    // Second, smaller sparkle slightly later for depth.
    setTimeout(() => {
      confetti({
        particleCount: 16,
        spread: 70,
        startVelocity: 22,
        gravity: 1.0,
        scalar: 0.7,
        ticks: 90,
        origin,
        colors,
        disableForReducedMotion: true,
      });
    }, 180);
  } catch {
    /* confetti is decorative — never break the app */
  }
};

/**
 * Returns { top_seller: { "Channel": 3 }, highest_abv: {...}, top_conversion: {...} }
 * computed from persisted monthly snapshots. Cached server-side for 1h so
 * calling this on every page render is cheap.
 */
export const useLeaderboardStreaks = () => {
  const [streaks, setStreaks] = useState({});
  useEffect(() => {
    let cancelled = false;
    api.get("/leaderboard/streaks", { params: { lookback_months: 6 } })
      .then((r) => { if (!cancelled) setStreaks(r.data || {}); })
      .catch(() => { /* streaks are nice-to-have, not required */ });
    return () => { cancelled = true; };
  }, []);
  return streaks;
};

/**
 * Shared leaderboard badges used on Locations + Overview.
 *
 * Awards each location at most one business-aligned badge (positive only —
 * we never surface "worst performer"-style framing, per the guiding design
 * principle). Priority order — higher wins when two badges overlap:
 *   🏆 Top Seller          — highest total_sales
 *   💰 Highest ABV         — highest avg basket, requires ≥ 50 orders
 *   ⚡ Top Conversion      — highest orders÷footfall, requires ≥ 200 visits
 *   📈 Biggest Mover       — biggest % sales growth vs compare period,
 *                             requires compare mode and ≥ 10 pp gain
 *
 * Thresholds act as statistical noise filters so tiny-volume stores cannot
 * accidentally lead the board.
 */
export const useLocationBadges = ({ sales, prevSales, footfall, compareMode, compareLbl }) => {
  return useMemo(() => {
    const badges = new Map();
    if (!Array.isArray(sales) || sales.length === 0) return badges;

    const prevMap = new Map((prevSales || []).map((r) => [r.channel, r]));
    const ffByLoc = new Map((footfall || []).map((r) => [r.location, r.total_footfall || 0]));

    const rows = sales.map((r) => {
      const sales_ = r.total_sales || 0;
      const orders = r.orders || r.total_orders || 0;
      const abv = orders ? sales_ / orders : 0;
      const ff = ffByLoc.get(r.channel) || 0;
      const cr = ff > 0 ? (orders / ff) * 100 : 0;
      const prev = prevMap.get(r.channel);
      const pSales = prev ? (prev.total_sales || 0) : 0;
      const pctGrowth = pSales > 0 ? ((sales_ - pSales) / pSales) * 100 : null;
      return { channel: r.channel, sales: sales_, orders, abv, ff, cr, pctGrowth };
    });

    const award = (channel, badge) => {
      if (!channel || badges.has(channel)) return;
      badges.set(channel, badge);
    };

    const topSales = [...rows].sort((a, b) => b.sales - a.sales)[0];
    if (topSales && topSales.sales > 0) {
      award(topSales.channel, {
        icon: "🏆", label: "Top Seller", tone: "gold",
        tip: `Leading the group with ${fmtKES(topSales.sales)} in total sales.`,
      });
    }

    const topAbv = [...rows].filter((r) => r.orders >= 50).sort((a, b) => b.abv - a.abv)[0];
    if (topAbv) {
      award(topAbv.channel, {
        icon: "💰", label: "Highest ABV", tone: "green",
        tip: `Biggest basket at ${fmtKES(topAbv.abv)} — customers spend more per visit here.`,
      });
    }

    // Top Conversion: floor at ≥200 visits, cap at ≤50% to filter
    // broken-counter rows (matches Footfall page's data-quality rule).
    const topCr = [...rows].filter((r) => r.ff >= 200 && r.cr <= 50).sort((a, b) => b.cr - a.cr)[0];
    if (topCr && topCr.cr > 0) {
      award(topCr.channel, {
        icon: "⚡", label: "Top Conversion", tone: "teal",
        tip: `Best visitor-to-buyer rate at ${topCr.cr.toFixed(1)}% — replicate what's working.`,
      });
    }

    if (compareMode && compareMode !== "none") {
      const movers = rows.filter((r) => r.pctGrowth != null && r.sales > 0);
      const topGain = [...movers].sort((a, b) => (b.pctGrowth || 0) - (a.pctGrowth || 0))[0];
      if (topGain && (topGain.pctGrowth || 0) >= 10) {
        award(topGain.channel, {
          icon: "📈", label: "Biggest Mover", tone: "brand",
          tip: `Sales up ${topGain.pctGrowth.toFixed(0)}% ${compareLbl} — momentum leader.`,
        });
      }

      // Most Improved Conversion: biggest absolute CR gain vs compare period.
      // Guards: current ≥ 200 footfall, CR ≤ 50% (noise filter), ≥ 5pp gain.
      const prevFFByLoc = new Map();  // compare-period footfall — optional,
      // if you want hard-matched comparison fetch it upstream; fall back to
      // comparing this-period CR against compare-period orders÷footfall we
      // can approximate from prev row if shape matches.
      const movers_cr = rows
        .map((r) => {
          const prev = prevMap.get(r.channel);
          if (!prev) return null;
          const pOrders = prev.orders || prev.total_orders || 0;
          const pFF = prevFFByLoc.get(r.channel) || prev.footfall || prev.total_footfall || 0;
          const pCR = pFF > 0 ? (pOrders / pFF) * 100 : null;
          if (pCR == null) return null;
          return { ...r, pCR, crGain: r.cr - pCR };
        })
        .filter((r) => r && r.ff >= 200 && r.cr <= 50 && r.crGain >= 5);
      const topCrGain = [...movers_cr].sort((a, b) => b.crGain - a.crGain)[0];
      if (topCrGain) {
        award(topCrGain.channel, {
          icon: "🎯", label: "Most Improved Conversion", tone: "teal",
          tip: `Conversion up ${topCrGain.crGain.toFixed(1)} pts ${compareLbl} — from ${topCrGain.pCR.toFixed(1)}% to ${topCrGain.cr.toFixed(1)}%.`,
        });
      }
    }

    return badges;
  }, [sales, prevSales, footfall, compareMode, compareLbl]);
};

/**
 * Compact winners strip. Set `onWinnerClick(channel)` to make each chip
 * navigate / scroll to the winner's detail view. `streaks` (optional) is
 * the payload from `useLeaderboardStreaks()` — when a winner has held
 * the same badge 2+ months running we surface a 🔥 flame with the count.
 */
export const LocationLeaderboard = ({ badges, onWinnerClick, className = "", streaks }) => {
  // Fire a confetti burst on first render per session for each record-breaker.
  // sessionStorage dedupes across route navigations; a tab refresh counts as
  // a fresh session (intentional — execs should re-see the celebration once).
  const recordRefs = useRef(new Map());
  useEffect(() => {
    if (!streaks?.records) return;
    Object.entries(streaks.records).forEach(([badgeKey, info]) => {
      if (!info || !info.winner) return;
      const key = `record_fired_${badgeKey}_${info.winner}`;
      try {
        if (sessionStorage.getItem(key)) return;
        const el = recordRefs.current.get(badgeKey);
        if (!el) return;
        // Defer to next frame so the DOM is painted before we target the rect.
        requestAnimationFrame(() => fireRecordConfetti(el));
        sessionStorage.setItem(key, "1");
      } catch { /* storage blocked — skip quietly */ }
    });
  }, [streaks]);

  if (!badges || badges.size === 0) return null;

  // Map UI badge label → backend streak key.
  const BADGE_STREAK_KEY = {
    "Top Seller": "top_seller",
    "Highest ABV": "highest_abv",
    "Top Conversion": "top_conversion",
    // "Biggest Mover" and "Most Improved Conversion" are intrinsically
    // per-period (they describe change vs comparison window); no streak.
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-gradient-to-r from-amber-50 via-emerald-50 to-brand-soft/60 border border-brand/20 ${className}`}
      data-testid="leaderboard-strip"
    >
      <span className="text-[11px] font-bold uppercase tracking-wider text-brand-deep mr-1">
        🎉 This period's winners:
      </span>
      {Array.from(badges.entries()).map(([channel, b]) => {
        const streakKey = BADGE_STREAK_KEY[b.label];
        const streak = streakKey && streaks?.[streakKey]?.[channel];
        const recordInfo = streakKey && streaks?.records?.[streakKey];
        const isRecord = !!(recordInfo && recordInfo.winner === channel);
        const tipParts = [b.tip];
        if (streak && streak >= 2) tipParts.push(`🔥 ${streak} months running`);
        if (isRecord) tipParts.push("🏆 New 12-month record!");
        return (
          <button
            key={`lb-${channel}-${b.label}`}
            type="button"
            onClick={() => onWinnerClick && onWinnerClick(channel)}
            title={tipParts.join(" · ")}
            data-testid={`leader-badge-${b.label.replace(/\s+/g, "-").toLowerCase()}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-full border border-brand/30 shadow-sm hover:shadow-md hover:border-brand/60 transition-all text-[11.5px] font-semibold text-brand-deep"
          >
            <span aria-hidden="true">{b.icon}</span>
            <span>{b.label}:</span>
            <span className="text-foreground/90 font-bold truncate max-w-[180px]">{channel}</span>
            {streak && streak >= 2 && (
              <span
                className="inline-flex items-center gap-0.5 ml-0.5 px-1.5 py-0.5 rounded-full bg-gradient-to-br from-orange-100 to-red-100 text-red-700 text-[10px] font-bold border border-orange-300"
                data-testid={`streak-${streakKey}`}
              >
                🔥 {streak}
              </span>
            )}
            {isRecord && (
              <span
                ref={(el) => {
                  if (el) recordRefs.current.set(streakKey, el);
                  else recordRefs.current.delete(streakKey);
                }}
                className="inline-flex items-center gap-0.5 ml-0.5 px-1.5 py-0.5 rounded-full bg-gradient-to-br from-amber-100 via-yellow-100 to-amber-200 text-amber-800 text-[10px] font-bold border border-amber-400 shadow-sm animate-pulse"
                data-testid={`record-${streakKey}`}
                title="New 12-month record"
              >
                🏆 NEW RECORD
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default LocationLeaderboard;
