import React, { useMemo } from "react";
import { fmtKES, fmtPct, fmtNum } from "@/lib/api";
import { Warning, TrendDown, ArrowUUpLeft, ArrowsLeftRight, Storefront } from "@phosphor-icons/react";

/**
 * Locations needing attention.
 *
 * Surfaces the stores most likely to need a manager-level conversation, by
 * tallying per-store flags across four signals:
 *   1. Sales DOWN materially vs the comparison period
 *   2. Conversion DOWN materially vs the comparison period
 *   3. Return rate ABOVE 2σ of the group (already in `return_outlier`)
 *   4. Below-group-average sales AND share < 1.5%
 *
 * Each store collects a list of reasons; we render the top 8 stores ranked
 * by reason count, then by the worst single signal.
 */
const REASONS = {
  sales_down: { icon: TrendDown, color: "text-red-600", label: "Sales down" },
  conv_down: { icon: ArrowsLeftRight, color: "text-amber-600", label: "Conversion down" },
  returns_high: { icon: ArrowUUpLeft, color: "text-orange-600", label: "Returns spiking" },
  weak_share: { icon: Storefront, color: "text-amber-700", label: "Underperforming" },
};

const SALES_DROP_THRESHOLD = -10; // %
const CONV_DROP_THRESHOLD = -1.5; // pp
const SHARE_THRESHOLD = 1.5; // %

const LocationsAttentionPanel = ({ rows, avgSales, totalSalesAll, compareMode }) => {
  const flagged = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const out = [];
    for (const r of rows) {
      const reasons = [];
      const detail = {};
      // 1. Sales drop
      if (compareMode !== "none" && r.d_sales != null && r.d_sales <= SALES_DROP_THRESHOLD) {
        reasons.push("sales_down");
        detail.sales_down = `${r.d_sales.toFixed(1)}% vs prior`;
      }
      // 2. Conversion drop (delta_pp)
      if (compareMode !== "none" && r.conv_delta_pp != null && r.conv_delta_pp <= CONV_DROP_THRESHOLD) {
        reasons.push("conv_down");
        detail.conv_down = `${r.conv_delta_pp.toFixed(2)}pp vs prior`;
      }
      // 3. Return rate outlier
      if (r.return_outlier) {
        reasons.push("returns_high");
        detail.returns_high = `${(r.return_rate || 0).toFixed(1)}% return rate`;
      }
      // 4. Weak share + below-avg sales
      const share = totalSalesAll ? ((r.total_sales || 0) / totalSalesAll) * 100 : 0;
      const belowAvg = (r.total_sales || 0) < avgSales;
      if (belowAvg && share < SHARE_THRESHOLD && (r.total_sales || 0) > 0) {
        reasons.push("weak_share");
        detail.weak_share = `${share.toFixed(2)}% share · below group avg`;
      }
      if (reasons.length) {
        out.push({ ...r, reasons, detail, share });
      }
    }
    // Rank by reason count desc, then by sales drop magnitude
    out.sort((a, b) => {
      if (b.reasons.length !== a.reasons.length) return b.reasons.length - a.reasons.length;
      return (a.d_sales || 0) - (b.d_sales || 0);
    });
    return out.slice(0, 8);
  }, [rows, avgSales, totalSalesAll, compareMode]);

  if (flagged.length === 0) {
    return (
      <div
        className="card-white p-5 mt-4"
        data-testid="locations-attention-panel"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center shrink-0">
            <Warning size={18} weight="duotone" />
          </div>
          <div>
            <h3 className="font-bold text-[15px] tracking-tight">Locations needing attention</h3>
            <p className="text-[12.5px] text-muted mt-0.5">
              Nothing is screaming for help right now. All stores are within healthy ranges on sales, conversion, returns, and share.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-white p-5 mt-4" data-testid="locations-attention-panel">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 grid place-items-center shrink-0">
          <Warning size={18} weight="duotone" />
        </div>
        <div>
          <h3 className="font-bold text-[15px] tracking-tight">Locations needing attention</h3>
          <p className="text-[12.5px] text-muted mt-0.5">
            These stores are showing one or more warning signs. Top of list = most signals stacked. Click a card above to drill in.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {flagged.map((r, i) => (
          <div
            key={`${r.channel}-${i}`}
            className="border border-border rounded-lg p-3 bg-[#fffaf3]"
            data-testid={`attention-row-${r.channel}`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <div className="font-bold text-[13px] truncate" title={r.channel}>{r.channel}</div>
              <div className="text-[11.5px] text-muted shrink-0">
                {fmtKES(r.total_sales)} · {r.share.toFixed(1)}%
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.reasons.map((rk) => {
                const cfg = REASONS[rk];
                if (!cfg) return null;
                const Icon = cfg.icon;
                return (
                  <span
                    key={rk}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-border text-[10.5px] font-semibold ${cfg.color}`}
                    title={r.detail[rk]}
                  >
                    <Icon size={11} weight="bold" />
                    <span>{cfg.label}</span>
                    <span className="text-muted font-normal">· {r.detail[rk]}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LocationsAttentionPanel;
