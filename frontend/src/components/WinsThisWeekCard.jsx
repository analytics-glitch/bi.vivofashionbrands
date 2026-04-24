import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Trophy, Sparkle } from "@phosphor-icons/react";

/**
 * WinsThisWeekCard — a quiet celebration of the user's workflow habits.
 *
 * Shows on Overview when the user has resolved ≥ 1 recommendation in
 * the last 7 days. Pure dopamine: no drill-downs, no corrective tone,
 * just "you did N things this week, nice". The number is scoped to the
 * authenticated user only — each team member sees their own tally.
 *
 * Auto-hides when total_actions === 0 so new users / quiet weeks never
 * see a demoralising "0 wins" tile.
 *
 * Copy rotates weekly-ish so Stephen doesn't see the same sentence
 * seven Mondays in a row.
 */

const firstName = (u) => {
  if (!u) return null;
  const name = (u.name || "").trim();
  if (name) return name.split(/\s+/)[0];
  const email = (u.email || "").trim();
  if (email) return email.split("@")[0].split(/[._-]/)[0];
  return null;
};

// Pick a headline variant based on the ISO week — gentle variation that
// rotates ~weekly without needing backend state.
const variants = [
  "Nice week of closing the loop",
  "You've been busy this week",
  "This week's clean-up run",
  "Good rhythm this week",
  "This week in workflow",
];

const isoWeekKey = () => {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-${week}`;
};

const WinsThisWeekCard = () => {
  const { user } = useAuth();
  const [wins, setWins] = useState(null);

  useEffect(() => {
    let cancel = false;
    api.get("/recommendations/wins", { params: { window_days: 7 } })
      .then((r) => { if (!cancel) setWins(r.data || null); })
      .catch(() => { /* decorative — hide on failure */ });
    return () => { cancel = true; };
  }, []);

  const headline = useMemo(() => {
    const key = isoWeekKey();
    const idx = Math.abs(
      [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) % variants.length
    );
    return variants[idx];
  }, []);

  if (!wins || wins.total_actions === 0) return null;

  const name = firstName(user);
  const bits = [];
  if (wins.reorder_closed > 0)
    bits.push(`${fmtNum(wins.reorder_closed)} re-order${wins.reorder_closed === 1 ? "" : "s"} raised`);
  if (wins.ibt_closed > 0)
    bits.push(`${fmtNum(wins.ibt_closed)} IBT move${wins.ibt_closed === 1 ? "" : "s"} actioned`);
  const dismissed = (wins.reorder_dismissed || 0) + (wins.ibt_dismissed || 0);
  if (dismissed > 0)
    bits.push(`${fmtNum(dismissed)} dismissed with reason`);

  if (bits.length === 0) return null;

  return (
    <div
      className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-amber-50/60 p-4 sm:p-5 shadow-sm relative overflow-hidden"
      data-testid="wins-this-week"
    >
      {/* Decorative sparkles — small, confined to the right edge */}
      <div className="absolute top-2 right-3 text-amber-400/50 pointer-events-none" aria-hidden="true">
        <Sparkle size={12} weight="fill" />
      </div>
      <div className="absolute bottom-3 right-8 text-emerald-400/40 pointer-events-none" aria-hidden="true">
        <Sparkle size={10} weight="fill" />
      </div>
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-amber-200 to-emerald-200 flex items-center justify-center shadow-sm">
          <Trophy size={16} weight="fill" className="text-amber-700" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12px] font-bold uppercase tracking-wider text-emerald-900/80">
              Wins this week
            </div>
            {wins.action_streak >= 2 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-br from-orange-100 to-red-100 text-red-700 text-[10.5px] font-bold border border-orange-300"
                title={`You've closed at least one recommendation ${wins.action_streak} days in a row — build the habit!`}
                data-testid="action-streak-chip"
              >
                🔥 {wins.action_streak}-day close-the-loop streak
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[14px] font-bold text-brand-deep leading-snug">
            {headline}{name ? `, ${name}` : ""}.
          </div>
          <div className="mt-1 text-[12.5px] text-foreground/85 leading-snug">
            You closed <span className="font-bold text-emerald-800">{fmtNum(wins.total_actions)}</span>{" "}
            {wins.total_actions === 1 ? "recommendation" : "recommendations"} in the last 7 days
            {bits.length > 0 && " — "}
            {bits.map((b, i) => (
              <span key={i}>
                <span className="font-semibold text-brand-deep">{b}</span>
                {i < bits.length - 1 ? <span className="text-muted"> · </span> : "."}
              </span>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-muted/90">
            Every closed loop keeps tomorrow's list honest. Nice rhythm.
          </div>
        </div>
      </div>
    </div>
  );
};

export default WinsThisWeekCard;
