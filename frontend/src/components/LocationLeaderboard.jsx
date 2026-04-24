import React, { useMemo } from "react";
import { fmtKES } from "@/lib/api";

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

    const topCr = [...rows].filter((r) => r.ff >= 200).sort((a, b) => b.cr - a.cr)[0];
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
    }

    return badges;
  }, [sales, prevSales, footfall, compareMode, compareLbl]);
};

/**
 * Compact winners strip. Set `onWinnerClick(channel)` to make each chip
 * navigate / scroll to the winner's detail view.
 */
export const LocationLeaderboard = ({ badges, onWinnerClick, className = "" }) => {
  if (!badges || badges.size === 0) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-gradient-to-r from-amber-50 via-emerald-50 to-brand-soft/60 border border-brand/20 ${className}`}
      data-testid="leaderboard-strip"
    >
      <span className="text-[11px] font-bold uppercase tracking-wider text-brand-deep mr-1">
        🎉 This period's winners:
      </span>
      {Array.from(badges.entries()).map(([channel, b]) => (
        <button
          key={`lb-${channel}-${b.label}`}
          type="button"
          onClick={() => onWinnerClick && onWinnerClick(channel)}
          title={b.tip}
          data-testid={`leader-badge-${b.label.replace(/\s+/g, "-").toLowerCase()}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-full border border-brand/30 shadow-sm hover:shadow-md hover:border-brand/60 transition-all text-[11.5px] font-semibold text-brand-deep"
        >
          <span aria-hidden="true">{b.icon}</span>
          <span>{b.label}:</span>
          <span className="text-foreground/90 font-bold truncate max-w-[180px]">{channel}</span>
        </button>
      ))}
    </div>
  );
};

export default LocationLeaderboard;
