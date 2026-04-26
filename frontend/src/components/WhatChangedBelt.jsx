import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { Clock, ArrowRight } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";

/**
 * WhatChangedBelt — audit recommendation #4: warm-start the user.
 *
 * When a user's last authenticated visit was ≥ 2h ago, we summarise what
 * has shifted since then. Three lightweight deltas max, phrased as
 * narrative. Stays quiet (renders nothing) for the active session or
 * first-ever visit.
 *
 * Inputs come from `kpis` (already fetched by Overview — no new calls
 * just for this belt) plus the backend /api/user/last-visit probe.
 * We fetch /api/kpis for a second window anchored on the day of the
 * last visit so we can tell a "since you left" story.
 *
 * The belt is decorative — any fetch failure silently hides it.
 */

// Pluralise human-readable time.
const humanGap = (hours) => {
  if (hours == null) return "a while";
  if (hours < 6)  return `${Math.round(hours)} hours`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  const d = Math.round(hours / 24);
  if (d === 1) return "yesterday";
  if (d < 7)   return `${d} days`;
  if (d < 14)  return "about a week";
  if (d < 31)  return `${Math.round(d / 7)} weeks`;
  return "a month";
};

const fmtSignedPct = (pct) => {
  if (pct == null || !isFinite(pct)) return null;
  const s = pct >= 0 ? "+" : "−";
  return `${s}${Math.abs(pct).toFixed(1)}%`;
};

// Build 2–3 bullets. Each bullet is { emoji, text, tone, to }.
const buildBullets = ({ kpis, kpisSince, gapLabel }) => {
  if (!kpis || !kpisSince) return [];
  const out = [];

  // Sales delta.
  const sNow = kpis.total_sales || 0;
  const sThen = kpisSince.total_sales || 0;
  if (sThen > 0) {
    const diff = sNow - sThen;
    const pct = (diff / sThen) * 100;
    const up = diff >= 0;
    out.push({
      emoji: up ? "📈" : "📉",
      text: `Sales ${up ? "added" : "down"} ${fmtKES(Math.abs(diff))} since ${gapLabel} — ${fmtSignedPct(pct)}.`,
      tone: up ? "good" : "watch",
      to: "/locations",
      cta: "See by location",
    });
  }

  // Orders delta.
  const oNow = kpis.total_orders || 0;
  const oThen = kpisSince.total_orders || 0;
  if (oThen > 0) {
    const diff = oNow - oThen;
    const up = diff >= 0;
    if (Math.abs(diff) >= 1) {
      out.push({
        emoji: up ? "🛍️" : "🛒",
        text: `${up ? "+" : "−"}${fmtNum(Math.abs(diff))} orders landed while you were away.`,
        tone: up ? "good" : "watch",
        to: "/exports",
        cta: "Order-level view",
      });
    }
  }

  // Return-rate delta.
  const rNow = kpis.return_rate || 0;
  const rThen = kpisSince.return_rate || 0;
  if (rThen > 0 || rNow > 0) {
    const diff = rNow - rThen;
    if (Math.abs(diff) >= 0.25) {
      const up = diff > 0;
      out.push({
        emoji: up ? "⚠️" : "✅",
        text: `Return rate ${up ? "rose" : "improved"} ${Math.abs(diff).toFixed(2)}pp — now ${rNow.toFixed(2)}%.`,
        tone: up ? "bad" : "good",
        to: "/ceo-report",
        cta: "Investigate",
      });
    }
  }

  return out.slice(0, 3);
};

const TONE_CLS = {
  good: "bg-emerald-50 border-emerald-200 text-emerald-900",
  watch: "bg-amber-50 border-amber-200 text-amber-900",
  bad:  "bg-red-50 border-red-200 text-red-900",
};

const WhatChangedBelt = ({ kpis, dateFrom, dateTo }) => {
  const navigate = useNavigate();
  const [lastVisit, setLastVisit] = useState(null);
  const [kpisSince, setKpisSince] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get("/user/last-visit")
      .then((r) => { if (!cancelled) setLastVisit(r.data); })
      .catch(() => { /* quiet */ });
    return () => { cancelled = true; };
  }, []);

  // Only fetch a comparison KPI set if we have a warm return AND a usable
  // last-visit timestamp. We query KPIs for date_from..last_visit_date so
  // the comparison is "what the group had achieved by the moment you
  // last logged in".
  useEffect(() => {
    if (!lastVisit?.is_warm_return || !lastVisit?.last_visit_at) return;
    if (!dateFrom || !dateTo) return;
    let cancelled = false;
    const sinceDate = lastVisit.last_visit_at.slice(0, 10);
    // If the last visit was before the current window starts, the belt
    // isn't meaningful (we'd be comparing apples to oranges). Skip.
    if (sinceDate < dateFrom) return;
    // If the last visit was today (ignoreRecent already filtered out the
    // current session but server clock drift can still let today leak
    // through), skip — same day comparison is too narrow to tell a story.
    if (sinceDate === dateTo) return;
    api.get("/kpis", { params: { date_from: dateFrom, date_to: sinceDate } })
      .then((r) => { if (!cancelled) setKpisSince(r.data); })
      .catch(() => { /* quiet */ });
    return () => { cancelled = true; };
  }, [lastVisit, dateFrom, dateTo]);

  const bullets = useMemo(() => {
    if (!lastVisit?.is_warm_return) return [];
    return buildBullets({
      kpis,
      kpisSince,
      gapLabel: humanGap(lastVisit.hours_since),
    });
  }, [kpis, kpisSince, lastVisit]);

  if (!lastVisit?.is_warm_return) return null;
  if (bullets.length === 0) return null;

  return (
    <div
      className="rounded-2xl border border-brand/25 bg-gradient-to-r from-white via-brand-soft/50 to-amber-50/60 p-3.5 sm:p-4 shadow-sm"
      data-testid="what-changed-belt"
    >
      <div className="flex items-center gap-2 mb-2">
        <Clock size={14} weight="fill" className="text-brand-deep" />
        <div className="text-[11.5px] font-bold uppercase tracking-wider text-brand-deep">
          Since you were last here
          <span className="ml-1 text-muted font-normal normal-case tracking-normal">
            · {humanGap(lastVisit.hours_since)} ago
          </span>
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5" data-testid="what-changed-list">
        {bullets.map((b, i) => (
          <li
            key={i}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[12px] ${TONE_CLS[b.tone] || TONE_CLS.watch}`}
          >
            <span aria-hidden="true">{b.emoji}</span>
            <span className="flex-1">{b.text}</span>
            {b.to && (
              <button
                type="button"
                onClick={() => navigate(b.to)}
                className="inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded-full bg-white/80 hover:bg-white border border-current/30 text-[10.5px] font-semibold transition-all"
                data-testid={`what-changed-cta-${i}`}
              >
                {b.cta} <ArrowRight size={10} weight="bold" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default WhatChangedBelt;
