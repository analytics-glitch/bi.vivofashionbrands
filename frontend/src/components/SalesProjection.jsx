import React, { useEffect, useState } from "react";
import { api, fmtKES } from "@/lib/api";
import { SectionTitle } from "@/components/common";
import { TrendUp } from "@phosphor-icons/react";

/**
 * Compact projection card — shows actual vs run-rate vs projected KES
 * for the date range + POS filters currently applied.
 */
const SalesProjection = ({ dateFrom, dateTo, country, channel, dataVersion }) => {
  const [projection, setProjection] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/analytics/sales-projection", {
        params: { date_from: dateFrom, date_to: dateTo, country, channel },
      })
      .then((r) => !cancelled && setProjection(r.data))
      .catch(() => !cancelled && setProjection(null));
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, country, channel, dataVersion]);

  if (!projection || !projection.total_days) return null;

  return (
    <div className="card-white p-5" data-testid="sales-projection">
      <SectionTitle
        title="Projected period sales · run-rate view"
        subtitle={`Day ${projection.days_elapsed} of ${projection.total_days} (${(projection.completion_pct || 0).toFixed(0)}% through the window)`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <div className="eyebrow">Actual so far</div>
          <div className="text-[20px] sm:text-[24px] font-bold text-brand num">
            {fmtKES(projection.actual_sales)}
          </div>
        </div>
        <div>
          <div className="eyebrow">Daily run-rate</div>
          <div className="text-[18px] sm:text-[22px] font-bold num">
            {fmtKES(projection.daily_run_rate)}
          </div>
        </div>
        <div>
          <div className="eyebrow">Projected end-of-period</div>
          <div className="text-[20px] sm:text-[24px] font-extrabold text-brand-deep num">
            <TrendUp size={18} className="inline mr-1" weight="bold" />
            {fmtKES(projection.projected_sales)}
          </div>
        </div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-panel overflow-hidden">
        <div
          className="h-full bg-brand-strong transition-all"
          style={{ width: `${Math.min(100, projection.completion_pct || 0)}%` }}
        />
      </div>
    </div>
  );
};

export default SalesProjection;
