import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, COUNTRY_FLAGS } from "@/lib/api";
import { Loading, ErrorBox } from "@/components/common";
import { Target, TrendUp } from "@phosphor-icons/react";

// Q2 2026: April 1 → June 30 (91 days). Targets are in KES.
const Q2_START = "2026-04-01";
const Q2_END = "2026-06-30";
const Q2_DAYS = 91;

// Hardcoded leadership targets (KES) — explicitly NOT subject to global filters.
const TARGETS = {
  Kenya: 269_000_000,
  Rwanda: 12_000_000,
  Uganda: 28_000_000,
  Online: 24_000_000,
};
const COUNTRIES_ORDER = ["Kenya", "Rwanda", "Uganda", "Online"];

// Days elapsed in Q2 today (clamped to 1..Q2_DAYS so projection is sane
// before/after the quarter window).
function daysElapsedInQ2() {
  const now = new Date();
  const start = new Date(`${Q2_START}T00:00:00Z`);
  const end = new Date(`${Q2_END}T23:59:59Z`);
  if (now < start) return 0;
  if (now > end) return Q2_DAYS;
  const ms = now - start;
  // +1 so the first day counts as day 1, not 0
  return Math.min(Q2_DAYS, Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24))));
}

// Compact KES — millions (M) for everything ≥ 1M, otherwise thousands (K).
function fmtKESCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `KES ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `KES ${(v / 1_000).toFixed(0)}K`;
  return `KES ${v.toFixed(0)}`;
}

function ProgressRing({ pct, size = 88, stroke = 8, color = "#00c853", trackColor = "#fde7c5" }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  const dash = (clamped / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={color} strokeWidth={stroke} fill="none"
        strokeDasharray={`${dash} ${c - dash}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 600ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      />
    </svg>
  );
}

// Single tile with progress ring, KES achieved, and projected landing.
function TargetTile({ label, achieved, target, projected, daysLeft, isOverall, testId }) {
  const achievedPct = target ? (achieved / target) * 100 : 0;
  const projectedPct = target ? (projected / target) * 100 : 0;
  const onPace = projectedPct >= 100;
  // Ring color: green when on/above pace, amber when 70–99%, red when <70%.
  const ringColor = onPace ? "#00c853" : projectedPct >= 70 ? "#d97706" : "#dc2626";
  const flag = !isOverall ? (COUNTRY_FLAGS?.[label] || "") : "";
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-4 transition-transform hover:-translate-y-0.5 ${
        isOverall
          ? "border-[#1a5c38] bg-gradient-to-br from-[#1a5c38] to-[#0f3d24] text-white shadow-lg"
          : "border-[#fdba74] bg-white"
      }`}
      data-testid={testId}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 min-w-0">
          {!isOverall && flag && <span className="text-base leading-none" aria-hidden>{flag}</span>}
          <span className={`text-[12px] font-bold uppercase tracking-wide truncate ${
            isOverall ? "text-white/90" : "text-[#1a5c38]"
          }`}>
            {label}
          </span>
        </div>
        {onPace && (
          <span className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            isOverall ? "bg-white/15 text-white" : "bg-[#dcfce7] text-[#166534]"
          }`}>
            <TrendUp size={10} weight="bold" /> ON PACE
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative shrink-0" style={{ width: 88, height: 88 }}>
          <ProgressRing
            pct={Math.min(100, projectedPct)}
            color={ringColor}
            trackColor={isOverall ? "rgba(255,255,255,0.15)" : "#fde7c5"}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className={`text-[16px] font-extrabold leading-none ${
              isOverall ? "text-white" : "text-[#1a5c38]"
            }`}>
              {projectedPct.toFixed(0)}%
            </div>
            <div className={`text-[9px] font-semibold uppercase mt-0.5 ${
              isOverall ? "text-white/70" : "text-[#6b7280]"
            }`}>
              proj.
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className={`text-[10px] font-semibold uppercase tracking-wide ${
            isOverall ? "text-white/65" : "text-[#6b7280]"
          }`}>Achieved</div>
          <div className={`text-[18px] font-extrabold leading-tight tabular-nums ${
            isOverall ? "text-white" : "text-[#0f3d24]"
          }`} data-testid={`${testId}-achieved`}>
            {fmtKESCompact(achieved)}
          </div>
          <div className={`text-[10.5px] mt-1 ${isOverall ? "text-white/65" : "text-[#6b7280]"}`}>
            {achievedPct.toFixed(1)}% of target
          </div>
        </div>
      </div>

      <div className={`mt-3 pt-3 border-t ${isOverall ? "border-white/15" : "border-[#fde0c2]"} space-y-1`}>
        <div className="flex items-center justify-between text-[11px]">
          <span className={isOverall ? "text-white/65" : "text-[#6b7280]"}>Target</span>
          <span className={`font-bold tabular-nums ${isOverall ? "text-white" : "text-[#0f3d24]"}`} data-testid={`${testId}-target`}>
            {fmtKESCompact(target)}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className={isOverall ? "text-white/65" : "text-[#6b7280]"}>Projected landing</span>
          <span className={`font-bold tabular-nums ${
            isOverall ? "text-white" : onPace ? "text-[#00c853]" : projectedPct >= 70 ? "text-[#d97706]" : "text-[#dc2626]"
          }`} data-testid={`${testId}-projected`}>
            {fmtKESCompact(projected)}
          </span>
        </div>
        {daysLeft != null && (
          <div className={`text-[10px] mt-1 ${isOverall ? "text-white/55" : "text-[#9ca3af]"}`}>
            {daysLeft > 0 ? `${daysLeft} days left in Q2` : "Q2 closed"}
          </div>
        )}
      </div>
    </div>
  );
}

const Q2TargetsCard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fixed Q2 window — explicitly bypass global filters per spec.
        const res = await api.get("/country-summary", {
          params: { date_from: Q2_START, date_to: Q2_END },
        });
        if (!cancelled) setData(res.data || []);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Failed to load Q2 targets");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const tiles = useMemo(() => {
    if (!data) return null;
    const elapsed = daysElapsedInQ2();
    const daysLeft = Math.max(0, Q2_DAYS - elapsed);
    const byCountry = Object.fromEntries((data || []).map((r) => [r.country, r]));
    const rows = COUNTRIES_ORDER.map((c) => {
      const achieved = Number(byCountry[c]?.total_sales) || 0;
      const target = TARGETS[c] || 0;
      // Pace-based: (achieved / days_elapsed) × 91. If quarter hasn't started,
      // projection = 0; if quarter is over, projection = achieved.
      const projected = elapsed > 0 && elapsed < Q2_DAYS
        ? (achieved / elapsed) * Q2_DAYS
        : achieved;
      return { country: c, achieved, target, projected, daysLeft };
    });
    const overall = rows.reduce(
      (acc, r) => ({
        achieved: acc.achieved + r.achieved,
        target: acc.target + r.target,
        projected: acc.projected + r.projected,
      }),
      { achieved: 0, target: 0, projected: 0 }
    );
    return { rows, overall, daysLeft };
  }, [data]);

  if (error) return <ErrorBox message={error} />;
  if (!tiles) return <Loading label="Loading Q2 targets…" />;

  const startLabel = "Apr 1";
  const endLabel = "Jun 30, 2026";

  return (
    <div className="card-white p-5" data-testid="q2-targets-card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Target size={18} weight="duotone" className="text-[#1a5c38]" />
            <h3 className="text-[15px] font-extrabold text-[#0f3d24]">Quarter 2 Targets</h3>
            <span className="text-[10px] font-bold uppercase tracking-wide bg-[#fed7aa] text-[#7c2d12] px-1.5 py-0.5 rounded-full">
              Fixed window
            </span>
          </div>
          <p className="text-[12px] text-[#6b7280] mt-0.5">
            {startLabel} – {endLabel} · pace-based projection · not affected by filters
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">Q2 Days left</div>
          <div className="text-[20px] font-extrabold text-[#0f3d24] tabular-nums">{tiles.daysLeft}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {tiles.rows.map((r) => (
          <TargetTile
            key={r.country}
            label={r.country}
            achieved={r.achieved}
            target={r.target}
            projected={r.projected}
            daysLeft={r.daysLeft}
            testId={`q2-tile-${r.country.toLowerCase()}`}
          />
        ))}
        <TargetTile
          label="Overall"
          achieved={tiles.overall.achieved}
          target={tiles.overall.target}
          projected={tiles.overall.projected}
          daysLeft={tiles.daysLeft}
          isOverall
          testId="q2-tile-overall"
        />
      </div>

      <div className="mt-4 text-[11px] text-[#6b7280] flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-[#00c853]" /> on pace
        <span className="inline-block w-2 h-2 rounded-full bg-[#d97706] ml-2" /> 70–99%
        <span className="inline-block w-2 h-2 rounded-full bg-[#dc2626] ml-2" /> below 70%
      </div>
    </div>
  );
};

export default Q2TargetsCard;
