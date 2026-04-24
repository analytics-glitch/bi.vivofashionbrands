import React, { useEffect, useState } from "react";
import { api, fmtKES } from "@/lib/api";
import { Trophy } from "@phosphor-icons/react";

/**
 * Store of the Week — celebratory recap card for the Overview.
 *
 * Shows the winners of the last 7 completed days across the three
 * persistent badges (Top Seller, Highest ABV, Top Conversion) with
 * their WoW (week-over-week) delta. Purely celebratory — no action
 * prompts, no drill-downs. A dopamine confection, not a KPI tile.
 *
 * Gracefully hides on fetch error (decorative, not required).
 */

const formatDateRange = (w) => {
  if (!w || !w.start || !w.end) return "last 7 days";
  // "Apr 17 – Apr 23" — short, human.
  const fmt = (iso) => {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", {
      month: "short", day: "numeric", timeZone: "UTC",
    });
  };
  return `${fmt(w.start)} – ${fmt(w.end)}`;
};

const Delta = ({ pct }) => {
  if (pct == null || !isFinite(pct)) return null;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10.5px] font-bold ${
        up ? "text-emerald-700" : "text-red-600"
      }`}
      data-testid="sotw-delta"
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%{" "}
      <span className="font-normal text-brand-deep/60">WoW</span>
    </span>
  );
};

const Card = ({ icon, label, tone, winner, subline, pct, testid }) => {
  if (!winner) return null;
  const toneBg = {
    gold: "from-amber-50 to-yellow-50 border-amber-200",
    green: "from-emerald-50 to-teal-50 border-emerald-200",
    teal: "from-teal-50 to-cyan-50 border-teal-200",
  }[tone] || "from-brand-soft/60 to-white border-brand/20";
  return (
    <div
      className={`relative flex-1 min-w-[200px] rounded-xl border bg-gradient-to-br ${toneBg} p-3 shadow-sm`}
      data-testid={testid}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-brand-deep/80">
        <span aria-hidden="true">{icon}</span> {label}
      </div>
      <div className="mt-1 text-[13.5px] font-bold text-foreground/95 truncate">
        {winner}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
        <span className="text-[11.5px] text-brand-deep/75">{subline}</span>
        <Delta pct={pct} />
      </div>
    </div>
  );
};

const StoreOfTheWeek = () => {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancel = false;
    api.get("/leaderboard/store-of-the-week")
      .then((r) => { if (!cancel) { setData(r.data || null); setLoaded(true); } })
      .catch(() => { if (!cancel) setLoaded(true); });
    return () => { cancel = true; };
  }, []);

  if (!loaded) return null;
  if (!data) return null;
  const hasAny = data.top_seller || data.highest_abv || data.top_conversion;
  if (!hasAny) return null;

  return (
    <div
      className="rounded-2xl border border-amber-300/70 bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-4 sm:p-5 shadow-sm"
      data-testid="store-of-the-week"
    >
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={18} weight="fill" className="text-amber-600" />
        <div className="text-[12.5px] sm:text-[13.5px] font-bold tracking-tight text-brand-deep">
          Stores of the Week
        </div>
        <span className="text-[11px] text-brand-deep/60 font-medium">
          · {formatDateRange(data.window)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <Card
          icon="🏆"
          label="Top Seller"
          tone="gold"
          winner={data.top_seller?.winner}
          subline={data.top_seller ? fmtKES(data.top_seller.sales) : ""}
          pct={data.top_seller?.pct_vs_prev_week}
          testid="sotw-top-seller"
        />
        <Card
          icon="💰"
          label="Highest ABV"
          tone="green"
          winner={data.highest_abv?.winner}
          subline={data.highest_abv ? `${fmtKES(data.highest_abv.value)} basket` : ""}
          pct={data.highest_abv?.pct_vs_prev_week}
          testid="sotw-highest-abv"
        />
        <Card
          icon="⚡"
          label="Top Conversion"
          tone="teal"
          winner={data.top_conversion?.winner}
          subline={
            data.top_conversion?.value != null
              ? `${data.top_conversion.value.toFixed(1)}% CR`
              : ""
          }
          pct={data.top_conversion?.pct_vs_prev_week}
          testid="sotw-top-conversion"
        />
      </div>
    </div>
  );
};

export default StoreOfTheWeek;
