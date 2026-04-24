import React, { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { fmtKES, fmtNum } from "@/lib/api";
import { Sun, Moon, SunHorizon } from "@phosphor-icons/react";

/**
 * DailyBriefing — the top-of-Overview narrative card.
 *
 * Not a dashboard; a *greeting*. Surfaces 2–4 business-ready headlines
 * derived from the KPIs the page already fetches (no new API calls).
 * Lives or dies on its copy — keep it warm, specific, and actionable.
 *
 * Inputs are optional and defensive: if any signal is missing we skip
 * that bullet rather than render placeholder noise.
 */

const firstName = (u) => {
  if (!u) return null;
  const name = (u.name || "").trim();
  if (name) return name.split(/\s+/)[0];
  const email = (u.email || "").trim();
  if (email) return email.split("@")[0].split(/[._-]/)[0];
  return null;
};

const greetingFor = (hour) => {
  if (hour < 5)  return { text: "Still up",       Icon: Moon };
  if (hour < 12) return { text: "Good morning",   Icon: Sun };
  if (hour < 17) return { text: "Good afternoon", Icon: Sun };
  if (hour < 22) return { text: "Good evening",   Icon: SunHorizon };
  return { text: "Good night", Icon: Moon };
};

// Build a signed percentage-change bullet from KPI payload + prev payload.
const salesBullet = (kpis, prev, compareLbl) => {
  if (!kpis || !prev || !prev.total_sales) return null;
  const curr = kpis.total_sales || 0;
  const last = prev.total_sales || 0;
  const pct = ((curr - last) / last) * 100;
  if (!isFinite(pct)) return null;
  const up = pct >= 0;
  const mag = Math.abs(pct);
  // Qualitative framing: small changes feel different than big swings.
  let verdict;
  if (mag < 2) verdict = up ? "holding steady" : "holding steady";
  else if (mag < 10) verdict = up ? "ahead" : "behind";
  else if (mag < 25) verdict = up ? "strong day" : "slow day";
  else verdict = up ? "big swing up" : "big swing down";
  const emoji = up ? (mag >= 10 ? "🚀" : "📈") : (mag >= 25 ? "🔴" : "⚠️");
  return {
    emoji,
    text: `Total sales ${up ? "up" : "down"} ${mag.toFixed(0)}% ${compareLbl || ""} — ${verdict} at ${fmtKES(curr)}.`,
    tone: up ? "good" : mag >= 10 ? "bad" : "watch",
  };
};

// Sales-projection bullet: if we have a "on-pace for / behind pace" hint,
// turn it into encouragement or warning.
const paceBullet = (kpis) => {
  if (!kpis) return null;
  const so = kpis.stale_old || kpis.stale; // legacy flag name safety
  if (so) return null; // skip if data is stale
  const pct = kpis.pct_of_target; // 0–100 if a monthly target is wired; undefined today
  if (pct == null) return null;
  if (pct >= 100) return { emoji: "🏆", text: `Monthly target smashed — ${pct.toFixed(0)}% of goal delivered.`, tone: "good" };
  if (pct >= 85)  return { emoji: "🎯", text: `You're ${pct.toFixed(0)}% of the way to this month's target — almost there.`, tone: "good" };
  if (pct >= 60)  return { emoji: "⏱️", text: `${pct.toFixed(0)}% of monthly target — on pace, keep it steady.`, tone: "watch" };
  return null;
};

// Risk bullet: flag low-stock / overstock signals when meaningfully large.
const riskBullet = (inventory) => {
  if (!inventory) return null;
  const low = inventory.low_stock_styles || inventory.low_stock_count || 0;
  if (low >= 5) return { emoji: "⚠️", text: `${fmtNum(low)} styles flagged for urgent re-order — best to replenish before the weekend rush.`, tone: "watch" };
  return null;
};

// Conversion bullet: hero a single location if conversion is notable.
const locationBullet = (sales) => {
  if (!Array.isArray(sales) || sales.length === 0) return null;
  // Prefer the top location by total_sales.
  const sorted = [...sales].filter((r) => r.channel && r.total_sales).sort((a, b) => b.total_sales - a.total_sales);
  const top = sorted[0];
  if (!top) return null;
  return { emoji: "🏪", text: `${top.channel} is leading the pack with ${fmtKES(top.total_sales)} in sales today.`, tone: "good" };
};

const TONE_CLS = {
  good: "text-emerald-800 bg-emerald-50 border-emerald-200",
  watch: "text-amber-900 bg-amber-50 border-amber-200",
  bad:  "text-red-900 bg-red-50 border-red-200",
};

const DailyBriefing = ({ kpis, prevKpis, sales, inventory, compareLbl }) => {
  const { user } = useAuth();
  const { text: hello, Icon } = useMemo(() => greetingFor(new Date().getHours()), []);
  const name = firstName(user);

  const bullets = useMemo(() => {
    const out = [];
    const s = salesBullet(kpis, prevKpis, compareLbl);
    if (s) out.push(s);
    const p = paceBullet(kpis);
    if (p) out.push(p);
    const l = locationBullet(sales);
    if (l) out.push(l);
    const r = riskBullet(inventory);
    if (r) out.push(r);
    return out.slice(0, 4);
  }, [kpis, prevKpis, sales, inventory, compareLbl]);

  if (bullets.length === 0) return null;

  return (
    <div
      className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand-soft/70 via-white to-amber-50 p-4 sm:p-5 shadow-sm"
      data-testid="daily-briefing"
    >
      <div className="flex items-center gap-2 text-brand-deep">
        <Icon size={18} weight="fill" />
        <div className="text-[13px] sm:text-[14px] font-bold tracking-tight">
          {hello}{name ? `, ${name}` : ""}. Here's what matters right now:
        </div>
      </div>
      <ul className="mt-2.5 sm:mt-3 space-y-1.5" data-testid="daily-briefing-list">
        {bullets.map((b, i) => (
          <li
            key={i}
            className={`inline-flex items-start gap-2 w-full rounded-xl border px-3 py-1.5 text-[12.5px] ${TONE_CLS[b.tone] || TONE_CLS.watch}`}
          >
            <span className="text-[14px] leading-none mt-0.5" aria-hidden="true">{b.emoji}</span>
            <span className="flex-1">{b.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DailyBriefing;
