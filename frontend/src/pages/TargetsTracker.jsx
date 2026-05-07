import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, COUNTRY_FLAGS } from "@/lib/api";
import { Loading, ErrorBox } from "@/components/common";
import AnnualTargetsCard from "@/components/AnnualTargetsCard";
import MonthlyTargetsTracker from "@/components/MonthlyTargetsTracker";
import TotalSalesSummary from "@/components/TotalSalesSummary";
import CustomProjectionCard from "@/components/CustomProjectionCard";
import { Target, TrendUp, CalendarBlank } from "@phosphor-icons/react";

/**
 * Targets Tracker page.
 *
 * Three card stacks of tiles, then the existing detailed breakdown card:
 *   • Annual Target (full year — target_annual vs actual_ytd, run-rate
 *     projection × remaining days)
 *   • Current Quarter (auto-detected from today's date — same tile UI
 *     but scoped to that quarter's target / actual / pace)
 *   • Previous Quarter (closed quarter, projection = actual)
 *   • Detailed target breakdown (the existing AnnualTargetsCard "full"
 *     variant — per-channel table + per-quarter table)
 *
 * The 5-tile layout is deliberately identical to Q2TargetsCard: progress
 * ring, ON-PACE pill, achieved KES, target KES, projected landing,
 * days-remaining (or "closed" for the previous quarter). One tile per
 * country (Kenya / Rwanda / Uganda / Online), then a dark "Overall"
 * tile spanning the same KPIs aggregated.
 *
 * All data is loaded once from /api/analytics/annual-targets, which
 * already returns per-bucket, per-quarter target and actual maps. We
 * shadow the Q2 card's hard-coded country/Online split here for
 * consistency: Kenya bucket = "Kenya - Retail", and "Online" is
 * sourced from "Kenya - Online" (the only online channel in the
 * dataset). Uganda + Rwanda map 1:1.
 */

// ── Quarter window definitions ───────────────────────────────────────
//
// Hardcoded so the card always has a predictable window even if the
// backend `/analytics/annual-targets` schema lags behind. `daysIn` is
// the calendar-day length used for the pace projection denominator.
const QUARTER_WINDOWS = (year) => ({
  Q1: { start: new Date(`${year}-01-01T00:00:00Z`), end: new Date(`${year}-03-31T23:59:59Z`), daysIn: 90 },
  Q2: { start: new Date(`${year}-04-01T00:00:00Z`), end: new Date(`${year}-06-30T23:59:59Z`), daysIn: 91 },
  Q3: { start: new Date(`${year}-07-01T00:00:00Z`), end: new Date(`${year}-09-30T23:59:59Z`), daysIn: 92 },
  Q4: { start: new Date(`${year}-10-01T00:00:00Z`), end: new Date(`${year}-12-31T23:59:59Z`), daysIn: 92 },
});

// Canonical bucket labels (left side) → user-facing tile labels (right).
const BUCKETS = [
  { source: "Kenya - Retail", label: "Kenya" },
  { source: "Rwanda", label: "Rwanda" },
  { source: "Uganda", label: "Uganda" },
  { source: "Kenya - Online", label: "Online" },
];

// Find current quarter (1..4) from today.
const currentQuarter = (now = new Date()) => Math.floor(now.getUTCMonth() / 3) + 1;

// Days elapsed inside a window, clamped 0..daysIn.
const daysElapsedIn = (win, now = new Date()) => {
  if (now < win.start) return 0;
  if (now > win.end) return win.daysIn;
  const ms = now - win.start;
  return Math.min(win.daysIn, Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24))));
};

// Compact KES — millions / thousands. Mirrors Q2TargetsCard.
function fmtKESCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `KES ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `KES ${(v / 1_000).toFixed(0)}K`;
  return `KES ${v.toFixed(0)}`;
}

// ── Tile components (re-implemented locally to avoid coupling Q2 card
// internals — kept visually identical) ───────────────────────────────

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

function TargetTile({
  label, achieved, target, projected, daysLeft,
  isOverall, testId, daysLabel = "days left", closedLabel = "closed",
  // Comparison values (optional). All passed through from the page.
  // `paceExpected` is the expected achieved KES at today's pace
  // (target × elapsed/total) — used for the "ahead/behind pace" pill.
  // `prior` is the comparison-period absolute KES (last year for the
  // annual card, prior quarter for the quarter cards). When provided
  // we render a "+X% YoY" / "+X% vs Q1" line on the tile.
  paceExpected = null,
  prior = null,
  priorLabel = "vs prior",
}) {
  const achievedPct = target ? (achieved / target) * 100 : 0;
  const projectedPct = target ? (projected / target) * 100 : 0;
  const onPace = projectedPct >= 100;
  const ringColor = onPace ? "#00c853" : projectedPct >= 70 ? "#d97706" : "#dc2626";
  const flag = !isOverall ? (COUNTRY_FLAGS?.[label] || "") : "";
  // Delta vs target (percentage points). Positive = ahead of pace.
  const deltaPp = projectedPct - 100;
  // Delta vs prior period (% growth). Skip when prior is 0 or missing
  // (avoids "+infinity%" when the prior period had no sales recorded).
  const priorDeltaPct = (prior != null && prior > 0) ? ((achieved - prior) / prior) * 100 : null;
  // Pace-expected delta: how much ahead/behind today's pace.
  const paceDeltaPct = (paceExpected != null && paceExpected > 0)
    ? ((achieved - paceExpected) / paceExpected) * 100 : null;
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
            <div className={`text-[16px] font-extrabold leading-none ${isOverall ? "text-white" : "text-[#1a5c38]"}`}>
              {projectedPct.toFixed(0)}%
            </div>
            <div className={`text-[9px] font-semibold uppercase mt-0.5 ${isOverall ? "text-white/70" : "text-[#6b7280]"}`}>
              proj.
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className={`text-[10px] font-semibold uppercase tracking-wide ${isOverall ? "text-white/65" : "text-[#6b7280]"}`}>Achieved</div>
          <div className={`text-[18px] font-extrabold leading-tight tabular-nums ${isOverall ? "text-white" : "text-[#0f3d24]"}`} data-testid={`${testId}-achieved`}>
            {fmtKESCompact(achieved)}
          </div>
          <div className={`text-[10.5px] mt-1 ${isOverall ? "text-white/65" : "text-[#6b7280]"}`}>
            {achievedPct.toFixed(1)}% of target
          </div>
          {priorDeltaPct != null && (
            <div
              className={`text-[10.5px] mt-0.5 font-bold tabular-nums ${
                isOverall
                  ? "text-white/85"
                  : priorDeltaPct >= 0 ? "text-[#166534]" : "text-[#9f1239]"
              }`}
              data-testid={`${testId}-prior-delta`}
              title={`${priorLabel}: ${fmtKESCompact(prior)}`}
            >
              {priorDeltaPct >= 0 ? "▲" : "▼"} {priorDeltaPct >= 0 ? "+" : ""}{priorDeltaPct.toFixed(1)}% {priorLabel}
            </div>
          )}
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
        {paceDeltaPct != null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className={isOverall ? "text-white/65" : "text-[#6b7280]"}>vs Pace</span>
            <span
              className={`font-bold tabular-nums ${
                isOverall ? "text-white" : paceDeltaPct >= 0 ? "text-[#00c853]" : "text-[#dc2626]"
              }`}
              data-testid={`${testId}-pace-delta`}
              title={`Expected at today's pace: ${fmtKESCompact(paceExpected)}`}
            >
              {paceDeltaPct >= 0 ? "+" : ""}{paceDeltaPct.toFixed(1)}%
            </span>
          </div>
        )}
        {daysLeft != null && (
          <div className={`text-[10px] mt-1 ${isOverall ? "text-white/55" : "text-[#9ca3af]"}`}>
            {daysLeft > 0 ? `${daysLeft} ${daysLabel}` : closedLabel}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Card layouts ─────────────────────────────────────────────────────

function TargetsCardShell({ title, badge, subtitle, daysLeft, daysLabel, children, testId }) {
  return (
    <div className="card-white p-5" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Target size={18} weight="duotone" className="text-[#1a5c38]" />
            <h3 className="text-[15px] font-extrabold text-[#0f3d24]">{title}</h3>
            {badge && (
              <span className="text-[10px] font-bold uppercase tracking-wide bg-[#fed7aa] text-[#7c2d12] px-1.5 py-0.5 rounded-full">
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-[12px] text-[#6b7280] mt-0.5">{subtitle}</p>
          )}
        </div>
        {daysLeft != null && (
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">{daysLabel}</div>
            <div className="text-[20px] font-extrabold text-[#0f3d24] tabular-nums">{daysLeft}</div>
          </div>
        )}
      </div>
      {children}
      <div className="mt-4 text-[11px] text-[#6b7280] flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-[#00c853]" /> on pace
        <span className="inline-block w-2 h-2 rounded-full bg-[#d97706] ml-2" /> 70–99%
        <span className="inline-block w-2 h-2 rounded-full bg-[#dc2626] ml-2" /> below 70%
      </div>
    </div>
  );
}

function TileGrid({ rows, overall, daysLeft, daysLabel, closedLabel, slug, priorLabel }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {rows.map((r) => (
        <TargetTile
          key={r.label}
          label={r.label}
          achieved={r.achieved}
          target={r.target}
          projected={r.projected}
          paceExpected={r.paceExpected}
          prior={r.prior}
          priorLabel={priorLabel}
          daysLeft={daysLeft}
          daysLabel={daysLabel}
          closedLabel={closedLabel}
          testId={`${slug}-tile-${r.label.toLowerCase()}`}
        />
      ))}
      <TargetTile
        label="Overall"
        achieved={overall.achieved}
        target={overall.target}
        projected={overall.projected}
        paceExpected={overall.paceExpected}
        prior={overall.prior}
        priorLabel={priorLabel}
        daysLeft={daysLeft}
        daysLabel={daysLabel}
        closedLabel={closedLabel}
        isOverall
        testId={`${slug}-tile-overall`}
      />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function TargetsTracker() {
  const year = 2026;
  // Current month YYYY-MM-01 — drives the monthly tracker + summary.
  const currentMonthIso = useMemo(() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }, []);
  const [data, setData] = useState(null);
  const [priorYearData, setPriorYearData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // Fetch current + prior year in parallel. Prior year is best-effort
    // — if the endpoint has no targets / actuals for that year we just
    // skip the YoY column rather than blocking the page.
    Promise.all([
      api.get("/analytics/annual-targets", { params: { year } }),
      api.get("/analytics/annual-targets", { params: { year: year - 1 } })
        .catch(() => ({ data: null })),
    ]).then(([curr, prev]) => {
      if (cancelled) return;
      setData(curr.data);
      setPriorYearData(prev.data);
    }).catch((e) => {
      if (!cancelled) setError(e?.response?.data?.detail || e?.message || "Failed to load targets");
    });
    return () => { cancelled = true; };
  }, [year]);

  // Memoize the three derived tile sets: Annual / Current Q / Previous Q.
  const cards = useMemo(() => {
    if (!data || !Array.isArray(data.buckets)) return null;
    const byBucket = Object.fromEntries(data.buckets.map((b) => [b.bucket, b]));
    const byBucketPrev = priorYearData && Array.isArray(priorYearData.buckets)
      ? Object.fromEntries(priorYearData.buckets.map((b) => [b.bucket, b]))
      : {};
    const wins = QUARTER_WINDOWS(year);
    const now = new Date();
    const cq = currentQuarter(now);  // 1..4
    const prevQ = cq === 1 ? null : cq - 1;
    const cqLabel = `Q${cq}`;
    const prevLabel = prevQ ? `Q${prevQ}` : null;

    // Days elapsed across the year for the annual projection.
    const annualElapsed = data.days_elapsed || 0;
    const annualTotal = data.days_total || 365;
    const annualLeft = Math.max(0, annualTotal - annualElapsed);

    // Tile rows for one quarter or for the full year.
    //
    // Returns each row with `paceExpected` (target × elapsed/total) and
    // `prior` (the comparison-period absolute KES — last-year YTD for
    // annual cards, prior quarter actual for the quarter cards).
    const buildRows = (mode) => {
      let elapsed = 0, total = 0;
      if (mode === "annual") { elapsed = annualElapsed; total = annualTotal; }
      else {
        const w = wins[mode];
        elapsed = daysElapsedIn(w, now);
        total = w.daysIn;
      }
      const rows = BUCKETS.map(({ source, label }) => {
        const b = byBucket[source];
        if (!b) return { label, achieved: 0, target: 0, projected: 0, paceExpected: 0, prior: null };
        let target, achieved, prior = null;
        if (mode === "annual") {
          target = b.target_annual || 0;
          achieved = b.actual_ytd || 0;
          // YoY: compare to prior year's actual_ytd (same calendar date).
          // The /analytics/annual-targets endpoint returns actual_ytd
          // bounded by today's date even when looking up year-1, so
          // this is an apples-to-apples year-to-date comparison.
          const bp = byBucketPrev[source];
          prior = bp ? (bp.actual_ytd || 0) : null;
        } else {
          target = (b.quarters || {})[mode] || 0;
          achieved = (b.actual_quarters || {})[mode] || 0;
          // QoQ: compare to the prior quarter's full actual. For Q1 we
          // fall back to last year's Q4 to give the user something to
          // compare against on the quarter card.
          const priorQuarter = mode === "Q1" ? "Q4" : `Q${parseInt(mode.slice(1), 10) - 1}`;
          const sourceForPrior = mode === "Q1" ? byBucketPrev[source] : b;
          if (sourceForPrior) {
            prior = (sourceForPrior.actual_quarters || {})[priorQuarter] || 0;
          }
        }
        // Pace-based projection.
        let projected;
        if (elapsed <= 0) projected = 0;
        else if (elapsed >= total) projected = achieved;
        else projected = (achieved / elapsed) * total;
        // Expected at today's pace = target × completion fraction.
        const paceExpected = target * (Math.min(elapsed, total) / total);
        return { label, achieved, target, projected, paceExpected, prior };
      });
      const overall = rows.reduce(
        (a, r) => ({
          achieved: a.achieved + r.achieved,
          target: a.target + r.target,
          projected: a.projected + r.projected,
          paceExpected: a.paceExpected + (r.paceExpected || 0),
          prior: r.prior != null ? a.prior + r.prior : a.prior,
        }),
        { achieved: 0, target: 0, projected: 0, paceExpected: 0, prior: 0 }
      );
      return { rows, overall, elapsed, total, daysLeft: Math.max(0, total - elapsed) };
    };

    const priorQOf = (q) => q === "Q1" ? `Q4 ${year - 1}` : `Q${parseInt(q.slice(1), 10) - 1} ${year}`;

    return {
      annual: { ...buildRows("annual"), label: `${year}` },
      current: cq ? { ...buildRows(cqLabel), label: cqLabel, priorLabel: `vs ${priorQOf(cqLabel)}` } : null,
      previous: prevLabel ? { ...buildRows(prevLabel), label: prevLabel, priorLabel: `vs ${priorQOf(prevLabel)}` } : null,
      annualLeft,
      cqLabel, prevLabel,
    };
  }, [data, priorYearData, year]);

  if (error) return <ErrorBox message={error} />;
  if (!cards) return (
    <div className="space-y-6">
      <Header />
      <Loading label="Loading targets…" />
    </div>
  );

  return (
    <div className="space-y-6" data-testid="targets-tracker-page">
      <Header />

      {/* Annual */}
      <TargetsCardShell
        title={`Annual Target ${year}`}
        badge="Year-to-date pace"
        subtitle={`Jan 1 – Dec 31, ${year} · pace-based projection · YoY vs ${year - 1} YTD`}
        daysLeft={cards.annualLeft}
        daysLabel="days left in year"
        testId="annual-targets-card"
      >
        <TileGrid
          rows={cards.annual.rows}
          overall={cards.annual.overall}
          daysLeft={cards.annualLeft}
          daysLabel="days left in year"
          closedLabel="Year closed"
          slug="annual"
          priorLabel="YoY"
        />
      </TargetsCardShell>

      {/* Current quarter */}
      {cards.current && (
        <TargetsCardShell
          title={`Current Quarter — ${cards.cqLabel} ${year}`}
          badge="In progress"
          subtitle={`Pace-based projection · ${cards.current.elapsed}/${cards.current.total} days complete · ${cards.current.priorLabel}`}
          daysLeft={cards.current.daysLeft}
          daysLabel={`days left in ${cards.cqLabel}`}
          testId="current-quarter-targets-card"
        >
          <TileGrid
            rows={cards.current.rows}
            overall={cards.current.overall}
            daysLeft={cards.current.daysLeft}
            daysLabel={`days left in ${cards.cqLabel}`}
            closedLabel={`${cards.cqLabel} closed`}
            slug="current-q"
            priorLabel={cards.current.priorLabel}
          />
        </TargetsCardShell>
      )}

      {/* Previous quarter */}
      {cards.previous && (
        <TargetsCardShell
          title={`Previous Quarter — ${cards.prevLabel} ${year}`}
          badge="Closed"
          subtitle={`Final achieved figures (no projection — quarter has ended) · ${cards.previous.priorLabel}`}
          daysLeft={null}
          testId="previous-quarter-targets-card"
        >
          <TileGrid
            rows={cards.previous.rows}
            overall={cards.previous.overall}
            daysLeft={0}
            daysLabel=""
            closedLabel={`${cards.prevLabel} closed`}
            slug="previous-q"
            priorLabel={cards.previous.priorLabel}
          />
        </TargetsCardShell>
      )}

      {/* Detailed target breakdown — re-uses the existing component so
          the per-channel and per-quarter tables stay in lock-step with
          whatever's on the API response shape. */}
      <div data-testid="detailed-target-breakdown">
        <AnnualTargetsCard variant="full" year={year} />
      </div>

      {/* Total Sales Summary — current month per-store rollup. */}
      <TotalSalesSummary month={currentMonthIso} />

      {/* Custom-range projection — store teams can pick any window to forecast. */}
      <CustomProjectionCard />

      {/* Monthly daily-budget tracker per store. */}
      <MonthlyTargetsTracker month={currentMonthIso} />
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-start gap-3 flex-wrap">
      <div>
        <div className="eyebrow">Dashboard · Targets</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1 inline-flex items-center gap-2">
          <CalendarBlank size={22} weight="duotone" className="text-[#1a5c38]" />
          Targets Tracker
        </h1>
        <p className="text-muted text-[13px] mt-1 max-w-2xl">
          Annual + per-quarter target progress for each country / channel.
          Pace-based projection scales current achievement across the
          remaining days. Numbers are KES, sourced from the leadership
          targets sheet — independent of the page's global filter bar.
        </p>
      </div>
    </div>
  );
}
