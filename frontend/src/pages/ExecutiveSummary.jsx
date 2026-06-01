import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import ExecutiveSummarySnapshot from "@/components/ExecutiveSummarySnapshot";
import DateWindowSelector from "@/components/DateWindowSelector";
import StyleStatusToggle from "@/components/StyleStatusToggle";
import { Loading, ErrorBox, Empty, SectionTitle } from "@/components/common";
import { useTableSort, SortableTh } from "@/lib/useTableSort";
import { categoryFor } from "@/lib/productCategory";
import {
  ArrowUp, ArrowDown, Minus, Warning,
  TrendUp, Footprints, Coins, UsersThree, UserPlus, ArrowsClockwise,
  Briefcase, Tag, Package, DownloadSimple,
} from "@phosphor-icons/react";

/**
 * Executive Summary — single-page leadership scorecard.
 *
 * Loads everything from a single `GET /api/exec-summary` call which
 * returns both YTD and MTD blocks (current + same-period-last-year).
 * No date pickers — windows are computed server-side and always end
 * at *yesterday* (UTC) so the page can't show a partial-day or empty
 * "today is fresh" anomaly.
 *
 * The page shows BOTH YTD and MTD simultaneously (per leadership
 * preference) — no toggle. KPI cards stack the two views; the store
 * table has both columns side by side; the category section uses a
 * compact in-section view selector.
 */
const fmtPct = (v) => {
  if (v == null || !isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
};

const DeltaPill = ({ value, testId, size = "sm" }) => {
  // The directional pill that lives next to every comparison number.
  // We deliberately bias UP=green / DOWN=red (no neutral "down is fine"
  // case) because every number on this page is one where higher is
  // better (revenue, footfall, basket, customer count).
  if (value == null) {
    return <span className={`inline-flex items-center gap-0.5 text-muted ${size === "sm" ? "text-[11px]" : "text-[12px]"}`} data-testid={testId}><Minus size={12} weight="bold" />—</span>;
  }
  const positive = value >= 0;
  const cls = positive ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-rose-700 bg-rose-50 border-rose-200";
  const Icon = positive ? ArrowUp : ArrowDown;
  const px = size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1";
  const tx = size === "sm" ? "text-[10.5px]" : "text-[12px]";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md border font-bold ${tx} ${px} ${cls}`} data-testid={testId}>
      <Icon size={size === "sm" ? 11 : 13} weight="bold" />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
};

/**
 * KPI card — two stacked rows (YTD + MTD) per metric so leadership
 * can read both views without scrolling. Each row shows current
 * value, last-year value, and the percent delta pill.
 */
const KpiCard = ({ icon: Icon, label, fmt, ytd, mtd, testId, tone }) => {
  const fmtVal = fmt || ((v) => fmtNum(Math.round(v)));
  const ring =
    tone === "warn"
      ? "border-amber-300 bg-gradient-to-br from-amber-50/60 to-white"
      : tone === "danger"
      ? "border-rose-300 bg-gradient-to-br from-rose-50/60 to-white"
      : "border-border bg-white";
  return (
    <div className={`rounded-xl border-2 ${ring} p-3 sm:p-3.5 shadow-sm`} data-testid={testId}>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={15} weight="duotone" className="text-brand" />}
        <div className="text-[10.5px] uppercase font-bold tracking-wider opacity-80">{label}</div>
      </div>
      <div className="space-y-2">
        <div data-testid={`${testId}-ytd`}>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[9.5px] uppercase font-bold text-muted tracking-widest">YTD</div>
            <DeltaPill value={ytd?.delta_pct} testId={`${testId}-ytd-delta`} />
          </div>
          <div className="font-extrabold text-[18px] sm:text-[20px] leading-tight mt-0.5 tabular-nums" data-testid={`${testId}-ytd-value`}>
            {fmtVal(ytd?.cur || 0)}
          </div>
          <div className="text-[10.5px] text-muted mt-0.5">
            LY: <span className="tabular-nums">{fmtVal(ytd?.ly || 0)}</span>
          </div>
        </div>
        <div className="h-px bg-border/60" />
        <div
          data-testid={`${testId}-mtd`}
          className="rounded-md border-l-[3px] border-amber-500 bg-amber-50/40 px-2 py-1 -mx-1 mt-1.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[9.5px] uppercase font-extrabold tracking-widest text-amber-800">MTD</div>
            <DeltaPill value={mtd?.delta_pct} testId={`${testId}-mtd-delta`} />
          </div>
          <div className="font-extrabold text-[18px] sm:text-[20px] leading-tight mt-0.5 tabular-nums" data-testid={`${testId}-mtd-value`}>
            {fmtVal(mtd?.cur || 0)}
          </div>
          <div className="text-[10.5px] text-muted mt-0.5">
            LY: <span className="tabular-nums">{fmtVal(mtd?.ly || 0)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * CountryBreakdown — 4 cards (Kenya / Uganda / Rwanda / Online) each
 * stacking the four primary metrics for both YTD and MTD. Helps
 * leadership spot a single country that's pulling the group up or
 * down without scrolling to the store table.
 */
const COUNTRY_FLAGS = { Kenya: "🇰🇪", Uganda: "🇺🇬", Rwanda: "🇷🇼", Online: "🌐" };

const CountryMetricRow = ({ label, cur, ly, fmt, delta }) => {
  // Iter 89h — show LY value inline so leadership can read "what
  // changed" without doing the math: cur ↔ LY ↔ Δ%. Compact layout:
  // current value bold + delta pill on row 1, "LY: <value>" muted on
  // row 2 so the eye reads top-down without crowding the card.
  const fmtVal = fmt || ((v) => fmtNum(Math.round(v)));
  return (
    <div className="grid grid-cols-[58px_1fr_auto] items-baseline gap-2 text-[11.5px]">
      <span className="text-muted shrink-0 row-span-2 self-center">{label}</span>
      <span className="font-bold tabular-nums">{fmtVal(cur || 0)}</span>
      <DeltaPill value={delta} size="sm" />
      <span className="text-[10px] text-muted tabular-nums col-span-2 -mt-0.5">LY: {fmtVal(ly || 0)}</span>
    </div>
  );
};

/**
 * TargetDayPill — small line directly under the Avg/Day row that
 * compares actual daily run-rate to the target daily run-rate
 * (pro-rata target ÷ days elapsed). Shown only when we have both a
 * target and a day-count for the country.
 */
const TargetDayPill = ({ actual, targetTotal, days, label = "Target" }) => {
  if (!targetTotal || !days) return null;
  const targetDaily = targetTotal / days;
  const gapPct = targetDaily > 0 ? ((actual - targetDaily) / targetDaily) * 100 : null;
  // Hit-the-target colour: green at/above pace, amber 90–100%, rose < 90%.
  const pct = targetDaily > 0 ? (actual / targetDaily) * 100 : 0;
  const tone =
    pct >= 100 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : pct >= 90 ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-rose-700 bg-rose-50 border-rose-200";
  return (
    <div className="grid grid-cols-[58px_1fr_auto] items-center gap-2 mt-0.5">
      <span className="text-[9.5px] uppercase font-bold text-muted tracking-wider">{label}</span>
      <span className="text-[10.5px] tabular-nums text-muted">
        Need <span className="font-bold text-foreground">{fmtKES(targetDaily)}</span>/day
      </span>
      <span className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md border ${tone}`} title={`Daily run-rate vs target daily run-rate. Pro-rata target ${fmtKES(targetTotal)} ÷ ${days}d.`}>
        {gapPct != null ? `${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(1)}%` : "—"}
      </span>
    </div>
  );
};

const CountryCard = ({ ytd, mtd, targets, selected, onClick }) => {
  const country = ytd?.country || mtd?.country;
  // Country tile tone — if both YTD and MTD revenue are down vs LY,
  // tint the whole card amber so it stands out at a glance.
  const ytdDown = (ytd?.revenue?.delta_pct ?? 0) < 0;
  const mtdDown = (mtd?.revenue?.delta_pct ?? 0) < 0;
  const baseRing = ytdDown && mtdDown
    ? "border-rose-300 bg-gradient-to-br from-rose-50/60 to-white"
    : ytdDown || mtdDown
    ? "border-amber-300 bg-gradient-to-br from-amber-50/60 to-white"
    : "border-emerald-300 bg-gradient-to-br from-emerald-50/60 to-white";
  // Iter 89g — selected state: thicker brand-coloured ring + subtle
  // lift so it's obvious the card is the active filter.
  const selectedRing = selected
    ? "ring-4 ring-brand/40 ring-offset-2 ring-offset-panel border-brand shadow-lg -translate-y-0.5"
    : "hover:shadow-md hover:-translate-y-0.5";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border-2 ${baseRing} ${selectedRing} transition-all duration-150 p-3.5 shadow-sm w-full`}
      data-testid={`exec-country-${country}`}
      aria-pressed={selected}
      title={selected ? `Click again to clear filter (${country})` : `Filter Store Performance + Categories to ${country}`}
    >
      <div className="text-[15px] font-extrabold mb-2 flex items-center gap-2">
        <span className="text-[18px]">{COUNTRY_FLAGS[country] || "🌍"}</span>
        {country}
        {selected && <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase font-bold text-brand bg-brand/10 px-1.5 py-0.5 rounded">Filter on</span>}
      </div>
      <div className="space-y-2.5">
        <div data-testid={`exec-country-${country}-ytd`}>
          <div className="text-[9.5px] uppercase font-bold text-muted tracking-widest mb-1">YTD</div>
          <CountryMetricRow label="Revenue"   fmt={fmtKES} cur={ytd?.revenue?.cur}    ly={ytd?.revenue?.ly}    delta={ytd?.revenue?.delta_pct} />
          <CountryMetricRow label="Avg/Day"   fmt={fmtKES} cur={ytd?.avg_sales_per_day?.cur} ly={ytd?.avg_sales_per_day?.ly} delta={ytd?.avg_sales_per_day?.delta_pct} />
          <TargetDayPill actual={ytd?.avg_sales_per_day?.cur} targetTotal={targets?.ytd} days={ytd?.avg_sales_per_day?.days} />
          <CountryMetricRow label="Units"                   cur={ytd?.units?.cur}      ly={ytd?.units?.ly}      delta={ytd?.units?.delta_pct} />
          <CountryMetricRow label="Orders"                  cur={ytd?.orders?.cur}     ly={ytd?.orders?.ly}     delta={ytd?.orders?.delta_pct} />
          <CountryMetricRow label="Footfall"                cur={ytd?.footfall?.cur}   ly={ytd?.footfall?.ly}   delta={ytd?.footfall?.delta_pct} />
          <CountryMetricRow label="Basket"   fmt={fmtKES}  cur={ytd?.avg_basket?.cur} ly={ytd?.avg_basket?.ly} delta={ytd?.avg_basket?.delta_pct} />
          <CountryMetricRow label="ASP"      fmt={fmtKES}  cur={ytd?.asp?.cur}        ly={ytd?.asp?.ly}        delta={ytd?.asp?.delta_pct} />
        </div>
        {/* Iter 89r — visually distinguish MTD from YTD using an
            amber/warm accent (not blue) per leadership pref so MTD
            stands apart from the cool brand palette. */}
        <div
          data-testid={`exec-country-${country}-mtd`}
          className="rounded-md border-l-[3px] border-amber-500 bg-amber-50/50 px-2 py-1.5 -mx-1"
        >
          <div className="mb-1">
            <span className="inline-block text-[9.5px] uppercase font-extrabold tracking-widest text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">MTD</span>
          </div>
          <CountryMetricRow label="Revenue"   fmt={fmtKES} cur={mtd?.revenue?.cur}    ly={mtd?.revenue?.ly}    delta={mtd?.revenue?.delta_pct} />
          <CountryMetricRow label="Avg/Day"   fmt={fmtKES} cur={mtd?.avg_sales_per_day?.cur} ly={mtd?.avg_sales_per_day?.ly} delta={mtd?.avg_sales_per_day?.delta_pct} />
          <TargetDayPill actual={mtd?.avg_sales_per_day?.cur} targetTotal={targets?.mtd} days={mtd?.avg_sales_per_day?.days} />
          <CountryMetricRow label="Units"                   cur={mtd?.units?.cur}      ly={mtd?.units?.ly}      delta={mtd?.units?.delta_pct} />
          <CountryMetricRow label="Orders"                  cur={mtd?.orders?.cur}     ly={mtd?.orders?.ly}     delta={mtd?.orders?.delta_pct} />
          <CountryMetricRow label="Footfall"                cur={mtd?.footfall?.cur}   ly={mtd?.footfall?.ly}   delta={mtd?.footfall?.delta_pct} />
          <CountryMetricRow label="Basket"   fmt={fmtKES}  cur={mtd?.avg_basket?.cur} ly={mtd?.avg_basket?.ly} delta={mtd?.avg_basket?.delta_pct} />
          <CountryMetricRow label="ASP"      fmt={fmtKES}  cur={mtd?.asp?.cur}        ly={mtd?.asp?.ly}        delta={mtd?.asp?.delta_pct} />
        </div>
      </div>
    </button>
  );
};

/**
 * StorePerformanceTable — physical stores only (server already
 * stripped Staff / Online). Sorted by MTD delta ascending so the
 * worst-performing rows surface at the top — leadership's
 * "needs-immediate-attention" queue.
 */
const StorePerformanceTable = ({ ytdStores, mtdStores, countryFilter }) => {
  // Join YTD + MTD on channel so we can show all six columns in one row.
  const merged = useMemo(() => {
    const ytdMap = new Map((ytdStores || []).map((s) => [s.channel, s]));
    const mtdMap = new Map((mtdStores || []).map((s) => [s.channel, s]));
    const channels = Array.from(new Set([...ytdMap.keys(), ...mtdMap.keys()]));
    const rows = channels.map((ch) => {
      const m = mtdMap.get(ch) || { cur: 0, ly: 0, delta_pct: null };
      const y = ytdMap.get(ch) || { cur: 0, ly: 0, delta_pct: null };
      // Iter 89g — country carried on each store row so the
      // country-card click filter can scope the table client-side.
      const country = y.country || m.country || "";
      return {
        channel: ch,
        country,
        mtd_cur: m.cur || 0,
        mtd_ly: m.ly || 0,
        mtd_delta: m.delta_pct,
        ytd_cur: y.cur || 0,
        ytd_ly: y.ly || 0,
        ytd_delta: y.delta_pct,
        // Iter 89k — per-store 2026 budget target (annual + pro-rata
        // YTD) carried on the row so we can show progress without an
        // extra request.
        target_annual: y.target_annual || m.target_annual || 0,
        target_ytd: y.target_ytd || m.target_ytd || 0,
      };
    });
    return rows.sort((a, b) => {
      const av = a.mtd_delta == null ? 9999 : a.mtd_delta;
      const bv = b.mtd_delta == null ? 9999 : b.mtd_delta;
      return av - bv;
    });
  }, [ytdStores, mtdStores]);

  // Iter 89g — country filter (click on a country card to scope).
  // Online has no physical stores in this table, so the filter yields
  // an empty list and we surface a friendly empty state.
  const filtered = useMemo(
    () => (countryFilter ? merged.filter((r) => r.country === countryFilter) : merged),
    [merged, countryFilter],
  );

  // Iter 89k — % contribution to revenue for the visible (post-filter)
  // rows. We compute against the total of what's on screen so when
  // leadership filters to Kenya, contribution % re-bases to Kenya
  // total. Two columns: MTD share and YTD share.
  const { mtdTotal, ytdTotal } = useMemo(() => {
    let m = 0, y = 0;
    for (const r of filtered) {
      m += r.mtd_cur || 0;
      y += r.ytd_cur || 0;
    }
    return { mtdTotal: m, ytdTotal: y };
  }, [filtered]);

  const enriched = useMemo(() => filtered.map((r) => ({
    ...r,
    mtd_share: mtdTotal > 0 ? (r.mtd_cur / mtdTotal) * 100 : 0,
    ytd_share: ytdTotal > 0 ? (r.ytd_cur / ytdTotal) * 100 : 0,
    target_pct: r.target_ytd > 0 ? (r.ytd_cur / r.target_ytd) * 100 : null,
  })), [filtered, mtdTotal, ytdTotal]);

  const { sort, toggleSort, sortRows } = useTableSort();
  const displayed = sort ? sortRows(enriched, {
    channel: (r) => r.channel,
    mtd_cur: (r) => r.mtd_cur,
    mtd_share: (r) => r.mtd_share,
    mtd_ly: (r) => r.mtd_ly,
    mtd_delta: (r) => (r.mtd_delta == null ? 9999 : r.mtd_delta),
    ytd_cur: (r) => r.ytd_cur,
    ytd_share: (r) => r.ytd_share,
    ytd_ly: (r) => r.ytd_ly,
    ytd_delta: (r) => (r.ytd_delta == null ? 9999 : r.ytd_delta),
    target_pct: (r) => (r.target_pct == null ? -1 : r.target_pct),
  }) : enriched;

  const rowTone = (mtdDelta) => {
    // Highlight the MTD column on each row based on user-spec
    // thresholds. Other columns stay neutral so the row stays readable.
    if (mtdDelta == null) return "";
    if (mtdDelta < -10) return "bg-rose-50/70";
    if (mtdDelta < 0) return "bg-amber-50/70";
    return "bg-emerald-50/40";
  };

  if (!filtered.length) {
    return (
      <Empty label={
        countryFilter
          ? `No ${countryFilter} stores in the comparison window. (Online has no physical stores in this table.)`
          : "No physical-store sales in the comparison window."
      } />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-white" data-testid="exec-store-table-scroll">
      <table className="w-full min-w-max text-[12.5px]" data-testid="exec-store-table">
        <thead className="bg-panel sticky top-0 z-10">
          <tr className="text-left">
            <th className="px-2 py-2 w-6"></th>
            <SortableTh sortKey="channel" sort={sort} onSort={toggleSort} className="px-3 py-2.5 font-semibold whitespace-nowrap">Store</SortableTh>
            <SortableTh sortKey="mtd_cur" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">MTD Revenue</SortableTh>
            <SortableTh sortKey="mtd_share" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">MTD %</SortableTh>
            <SortableTh sortKey="mtd_ly" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">MTD LY</SortableTh>
            <SortableTh sortKey="mtd_delta" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">MTD Δ%</SortableTh>
            <SortableTh sortKey="ytd_cur" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">YTD Revenue</SortableTh>
            <SortableTh sortKey="ytd_share" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">YTD %</SortableTh>
            <SortableTh sortKey="ytd_ly" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">YTD LY</SortableTh>
            <SortableTh sortKey="ytd_delta" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">YTD Δ%</SortableTh>
            <SortableTh sortKey="target_pct" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap" title="YTD revenue ÷ YTD pro-rata target (2026 budget)">vs Target</SortableTh>
          </tr>
        </thead>
        <tbody>
          {displayed.map((r) => {
            const dot =
              r.mtd_delta == null ? "bg-muted"
                : r.mtd_delta < 0 ? "bg-rose-500"
                : "bg-emerald-500";
            const needsAttention = r.mtd_delta != null && r.mtd_delta < -10;
            const tgt = r.target_pct;
            const tgtCls =
              tgt == null ? "text-muted"
                : tgt >= 100 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                : tgt >= 90 ? "text-amber-700 bg-amber-50 border-amber-200"
                : "text-rose-700 bg-rose-50 border-rose-200";
            return (
              <tr key={r.channel} className={`border-t border-border/50 ${rowTone(r.mtd_delta)}`} data-testid={`exec-store-row-${r.channel}`}>
                <td className="px-2 py-2"><span className={`inline-block w-2 h-2 rounded-full ${dot}`} title={r.mtd_delta == null ? "no comparison data" : r.mtd_delta < 0 ? "down vs LY" : "up vs LY"} /></td>
                <td className="px-3 py-2 font-semibold whitespace-nowrap">
                  {needsAttention && <Warning size={13} weight="fill" className="inline -mt-0.5 mr-1 text-rose-600" data-testid={`exec-store-warn-${r.channel}`} />}
                  {r.channel}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtKES(r.mtd_cur)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-brand">{r.mtd_share.toFixed(1)}%</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtKES(r.mtd_ly)}</td>
                <td className="px-3 py-2 text-right"><DeltaPill value={r.mtd_delta} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtKES(r.ytd_cur)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-brand">{r.ytd_share.toFixed(1)}%</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtKES(r.ytd_ly)}</td>
                <td className="px-3 py-2 text-right"><DeltaPill value={r.ytd_delta} /></td>
                <td className="px-3 py-2 text-right">
                  {tgt == null ? (
                    <span className="text-[10px] text-muted">—</span>
                  ) : (
                    <span
                      className={`inline-flex items-center justify-end gap-1 rounded-md border font-bold text-[11px] px-1.5 py-0.5 tabular-nums ${tgtCls}`}
                      title={`YTD target (2026 budget): KES ${Math.round(r.target_ytd).toLocaleString()} · Annual: KES ${Math.round(r.target_annual).toLocaleString()}`}
                      data-testid={`exec-store-target-${r.channel}`}
                    >
                      {tgt.toFixed(0)}%
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        {/* Total row so leadership can read the visible-rows total at the bottom of the table */}
        <tfoot className="bg-panel/70 border-t-2 border-border">
          <tr className="font-bold">
            <td className="px-2 py-2"></td>
            <td className="px-3 py-2 whitespace-nowrap">{countryFilter ? `${countryFilter} total` : "Total"} ({displayed.length})</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtKES(mtdTotal)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-brand">100%</td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtKES(ytdTotal)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-brand">100%</td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

/**
 * CategoryBars — grouped bar chart: current period (solid brand-green)
 * vs LY (lighter shade) per category. Plain CSS bars (no chart lib)
 * so the page stays light and the bars render synchronously on first
 * paint.
 */
/**
 * HotNotCallout — auto-narrative banner that surfaces the 3 best and
 * 3 worst subcategories of the period at a glance. "Hot" requires
 * both revenue AND units up significantly (so a price-driven spike
 * doesn't mask a unit-shortfall). "Not" requires both revenue AND
 * units down. Tiny subcategories (< KES 200K in the period) are
 * filtered out as noise. Computed off the same `subcategories` array
 * already in the payload — zero extra fetch cost.
 */
const HOT_NOT_MIN_REV = 200_000;       // KES — drop micro-subcategories
const HOT_NOT_MIN_LY_REV = 50_000;     // KES — need a meaningful LY base to compute % delta

const HotNotCallout = ({ subcategories, view }) => {
  const { hot, not } = useMemo(() => {
    if (!subcategories || !subcategories.length) return { hot: [], not: [] };
    // Build candidate pool with revenue + units deltas already attached.
    const enriched = subcategories
      .filter((sc) => sc.cur >= HOT_NOT_MIN_REV && sc.ly >= HOT_NOT_MIN_LY_REV)
      .map((sc) => {
        const unitsDelta = sc.ly_units ? ((sc.cur_units - sc.ly_units) / sc.ly_units) * 100 : null;
        return { ...sc, units_delta_pct: unitsDelta };
      });
    // "Hot" — both revenue and units significantly up. Sort by rev delta desc.
    const hotPool = enriched
      .filter((sc) => (sc.delta_pct ?? -Infinity) >= 20 && (sc.units_delta_pct ?? -Infinity) >= 10)
      .sort((a, b) => (b.delta_pct ?? 0) - (a.delta_pct ?? 0))
      .slice(0, 3);
    // "Not" — both revenue and units significantly down. Sort by rev delta asc (worst first).
    const notPool = enriched
      .filter((sc) => (sc.delta_pct ?? Infinity) <= -20 && (sc.units_delta_pct ?? Infinity) <= -10)
      .sort((a, b) => (a.delta_pct ?? 0) - (b.delta_pct ?? 0))
      .slice(0, 3);
    return { hot: hotPool, not: notPool };
  }, [subcategories]);

  if (!hot.length && !not.length) return null;

  const fmtItem = (sc, isHot) => {
    const rev = (sc.delta_pct || 0);
    const units = (sc.units_delta_pct || 0);
    const sign = (v) => (v >= 0 ? "+" : "");
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap" key={sc.subcategory}>
        <span className="font-extrabold">{sc.subcategory}:</span>
        <span className={isHot ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
          {sign(rev)}{rev.toFixed(0)}% rev
        </span>
        <span className="opacity-70">on</span>
        <span className={isHot ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
          {sign(units)}{units.toFixed(0)}% units
        </span>
      </span>
    );
  };

  return (
    <div className="card-white p-3 sm:p-4 border-2 border-amber-200 bg-gradient-to-br from-amber-50/40 to-white" data-testid="exec-hot-not-callout">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[10.5px] uppercase font-extrabold tracking-widest text-amber-700 inline-flex items-center gap-1.5">
          <span>What's hot · What's not</span>
          <span className="text-[10px] text-muted font-normal normal-case tracking-normal">— {view.toUpperCase()} vs same period last year</span>
        </div>
        <span className="text-[10px] text-muted">Subcategories ≥ KES 200K · both rev & units moved meaningfully</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
        <div data-testid="exec-hot-list">
          <div className="text-[11px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1">🔥 Hot</div>
          {hot.length === 0 ? (
            <div className="text-[11.5px] text-muted italic">Nothing standing out as a hot mover this period.</div>
          ) : (
            <div className="space-y-1">
              {hot.map((sc, i) => (
                <div key={sc.subcategory} className="flex items-baseline gap-1.5" data-testid={`exec-hot-${i}`}>
                  <span className="text-emerald-600 font-bold tabular-nums text-[10px] w-3">{i + 1}.</span>
                  {fmtItem(sc, true)}
                </div>
              ))}
            </div>
          )}
        </div>
        <div data-testid="exec-not-list">
          <div className="text-[11px] font-bold text-rose-700 mb-1.5 flex items-center gap-1">🚨 Not</div>
          {not.length === 0 ? (
            <div className="text-[11.5px] text-muted italic">No subcategory is meaningfully behind LY this period.</div>
          ) : (
            <div className="space-y-1">
              {not.map((sc, i) => (
                <div key={sc.subcategory} className="flex items-baseline gap-1.5" data-testid={`exec-not-${i}`}>
                  <span className="text-rose-600 font-bold tabular-nums text-[10px] w-3">{i + 1}.</span>
                  {fmtItem(sc, false)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CategoryBars = ({ subcategories, view }) => {
  // Roll up subcategories → top-level category via shared productCategory map.
  const { cats, totalRev } = useMemo(() => {
    const buckets = new Map();
    let totalRev = 0;
    for (const sc of subcategories || []) {
      const cat = categoryFor(sc.subcategory) || "Other";
      const b = buckets.get(cat) || { name: cat, cur: 0, ly: 0, cur_units: 0, ly_units: 0 };
      b.cur += sc.cur || 0;
      b.ly += sc.ly || 0;
      b.cur_units += sc.cur_units || 0;
      b.ly_units += sc.ly_units || 0;
      totalRev += sc.cur || 0;
      buckets.set(cat, b);
    }
    const arr = Array.from(buckets.values()).map((b) => ({
      ...b,
      delta_pct: b.ly ? ((b.cur - b.ly) / b.ly) * 100 : null,
      share_pct: totalRev > 0 ? (b.cur / totalRev) * 100 : 0,
    }));
    // Iter 89n — sort by biggest decline first so leadership sees the
    // categories bleeding revenue at the top. Categories with no LY
    // baseline (`delta_pct == null`) and growing categories sink to
    // the bottom (sorted by current revenue desc within their groups).
    arr.sort((a, b) => {
      const ad = a.delta_pct;
      const bd = b.delta_pct;
      const aDecline = ad != null && ad < 0;
      const bDecline = bd != null && bd < 0;
      if (aDecline && bDecline) return ad - bd;        // worst decline first
      if (aDecline) return -1;
      if (bDecline) return 1;
      // Both not declining (growing or no LY) → bigger revenue first
      return (b.cur || 0) - (a.cur || 0);
    });
    return { cats: arr, totalRev };
  }, [subcategories]);

  const max = useMemo(
    () => Math.max(1, ...cats.flatMap((c) => [c.cur, c.ly])),
    [cats]
  );

  if (!cats.length) return <Empty label="No category data." />;

  return (
    <div className="space-y-2.5" data-testid="exec-category-bars">
      {cats.map((c) => {
        const curPct = (c.cur / max) * 100;
        const lyPct = (c.ly / max) * 100;
        return (
          <div key={c.name} className="grid grid-cols-[120px_1fr_92px] items-center gap-2.5">
            <div>
              <div className="text-[11.5px] font-semibold truncate" title={c.name}>{c.name}</div>
              {/* Iter 89j — share-of-revenue + units sold per category.
                  Lets leadership see "Dresses = 35% of revenue, 8.4K
                  units" without scrolling to the subcategory list. */}
              <div className="text-[10px] text-muted mt-0.5">
                <span className="font-bold text-foreground">{c.share_pct.toFixed(1)}%</span> · {fmtNum(c.cur_units)}u
              </div>
            </div>
            <div className="space-y-1">
              <div className="relative h-2.5 bg-panel rounded">
                <div className="absolute inset-y-0 left-0 bg-brand rounded" style={{ width: `${curPct}%` }} />
              </div>
              <div className="relative h-2 bg-panel rounded">
                <div className="absolute inset-y-0 left-0 bg-brand/30 rounded" style={{ width: `${lyPct}%` }} />
              </div>
            </div>
            <div className="text-right">
              <div className="font-extrabold text-[11.5px] tabular-nums">{fmtKES(c.cur)}</div>
              <div className="text-[10px] text-muted tabular-nums">LY: {fmtKES(c.ly)}</div>
              <DeltaPill value={c.delta_pct} />
            </div>
          </div>
        );
      })}
      <div className="text-[10px] text-muted mt-2 flex items-center gap-3">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-brand" /> {view === "ytd" ? "YTD" : "MTD"} current</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-brand/30" /> Same period last year</span>
        <span className="ml-auto">Total: <span className="font-bold text-foreground">{fmtKES(totalRev)}</span></span>
      </div>
    </div>
  );
};

/**
 * AllSubcategories — full subcategory list, sorted by current revenue
 * desc. Scrollable when the list runs deep so the section keeps a
 * predictable height. Each row shows cur · LY · Δ% plus ASP (cur/LY/Δ).
 */
const AllSubcategories = ({ subcategories }) => {
  // Iter 89n — sort by biggest decline first so the worst revenue
  // bleeders surface at the top of the scroll list. Subcategories
  // with no LY baseline or with positive deltas drop below, sorted
  // by current revenue desc within those groups.
  const rows = useMemo(() => {
    const arr = [...(subcategories || [])];
    arr.sort((a, b) => {
      const ad = a.delta_pct;
      const bd = b.delta_pct;
      const aDecline = ad != null && ad < 0;
      const bDecline = bd != null && bd < 0;
      if (aDecline && bDecline) return ad - bd;
      if (aDecline) return -1;
      if (bDecline) return 1;
      return (b.cur || 0) - (a.cur || 0);
    });
    return arr;
  }, [subcategories]);
  // Iter 89j — pre-compute totals so each row can display its share %
  // of period revenue + show the period grand-total in the footer.
  const { totalRev, totalUnits } = useMemo(() => {
    let rev = 0, units = 0;
    for (const r of rows) {
      rev += r.cur || 0;
      units += r.cur_units || 0;
    }
    return { totalRev: rev, totalUnits: units };
  }, [rows]);
  const max = useMemo(
    () => Math.max(1, ...rows.flatMap((sc) => [sc.cur, sc.ly])),
    [rows]
  );
  if (!rows.length) return <Empty label="No subcategory data." />;
  return (
    <div className="max-h-[640px] overflow-y-auto pr-1" data-testid="exec-all-subcategories">
      <ol className="space-y-2">
        {rows.map((sc, i) => {
          const curPct = (sc.cur / max) * 100;
          const positive = (sc.delta_pct ?? 0) >= 0;
          const barColor = positive ? "bg-emerald-500" : "bg-rose-500";
          const needsAttention = sc.delta_pct != null && sc.delta_pct < -10;
          const asp = sc.asp || {};
          const sharePct = totalRev > 0 ? (sc.cur / totalRev) * 100 : 0;
          return (
            <li key={sc.subcategory} className="grid grid-cols-[18px_1fr] items-start gap-2 text-[12px]" data-testid={`exec-subcat-${i}`}>
              <span className="text-muted font-bold tabular-nums text-[11px] pt-0.5">{i + 1}</span>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate" title={sc.subcategory}>
                    {needsAttention && <Warning size={11} weight="fill" className="inline -mt-0.5 mr-1 text-rose-600" />}
                    {sc.subcategory}
                  </span>
                  <span className="text-[10.5px] tabular-nums shrink-0 font-bold">{fmtKES(sc.cur)}</span>
                </div>
                <div className="relative h-1.5 bg-panel rounded mt-1">
                  <div className={`absolute inset-y-0 left-0 ${barColor} rounded`} style={{ width: `${curPct}%` }} />
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <div className="text-[10px] text-muted">
                    {/* Iter 89j — share-of-revenue + units sold up front;
                        ASP and LY follow on the same line. */}
                    <span className="font-bold text-foreground">{sharePct.toFixed(1)}%</span>
                    <span className="mx-1.5 opacity-50">·</span>
                    <span className="font-semibold text-foreground tabular-nums">{fmtNum(sc.cur_units)}u</span>
                    <span className="opacity-50 ml-0.5">(LY {fmtNum(sc.ly_units)}u)</span>
                    <span className="mx-1.5 opacity-50">·</span>
                    LY: <span className="tabular-nums">{fmtKES(sc.ly)}</span>
                    <span className="mx-1.5 opacity-50">·</span>
                    ASP: <span className="tabular-nums font-semibold">{fmtKES(asp.cur || 0)}</span>
                    <span className="opacity-50 ml-0.5">(LY {fmtKES(asp.ly || 0)})</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[9.5px] uppercase text-muted font-bold">Rev</span>
                    <DeltaPill value={sc.delta_pct} />
                    <span className="text-[9.5px] uppercase text-muted font-bold ml-1">ASP</span>
                    <DeltaPill value={asp.delta_pct} />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="text-[10px] text-muted mt-3 pt-2 border-t border-border/60 flex items-center justify-between sticky bottom-0 bg-white">
        <span>Total subcategories: <span className="font-bold text-foreground">{rows.length}</span></span>
        <span>Period total: <span className="font-bold text-foreground">{fmtKES(totalRev)}</span> · <span className="font-bold text-foreground">{fmtNum(totalUnits)} units</span></span>
      </div>
    </div>
  );
};

/**
 * CategorySubcatTable — Iter 89o. Replaces the side-by-side bars +
 * subcategory list with a single unified, scannable table.  Each
 * category renders as a header row (rolled up rev/units/ASP across
 * its subcategories) with the subcategories listed underneath,
 * indented and visually subordinate.  All columns colour-coded so
 * growth / decline jumps off the page; default sort puts declines on
 * top within each category — but the *categories themselves* are
 * sorted by their own Rev Δ% so the worst-bleeding bucket is at the
 * top of the page.
 */
const DeltaCell = ({ value }) => {
  if (value == null || !isFinite(value)) {
    return <span className="text-muted text-[10.5px]">—</span>;
  }
  const positive = value >= 0;
  const cls = positive ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50";
  const arrow = positive ? "▲" : "▼";
  return (
    <span className={`inline-flex items-center justify-end gap-0.5 rounded-md px-1.5 py-0.5 font-bold text-[11px] tabular-nums ${cls}`}>
      <span className="text-[8px]">{arrow}</span>
      {Math.abs(value).toFixed(1)}%
    </span>
  );
};

const CategorySubcatTable = ({ subcategories, view }) => {
  // Build (category → rolled-up totals + sub-rows). Use the shared
  // categoryFor() map so this matches every other page.
  const { categories, totalRev, totalUnits } = useMemo(() => {
    const buckets = new Map();
    let totalRev = 0;
    let totalUnits = 0;
    for (const sc of subcategories || []) {
      const cat = categoryFor(sc.subcategory) || "Other";
      const b = buckets.get(cat) || {
        name: cat,
        cur: 0, ly: 0, cur_units: 0, ly_units: 0, subs: [],
      };
      b.cur += sc.cur || 0;
      b.ly += sc.ly || 0;
      b.cur_units += sc.cur_units || 0;
      b.ly_units += sc.ly_units || 0;
      b.subs.push(sc);
      totalRev += sc.cur || 0;
      totalUnits += sc.cur_units || 0;
      buckets.set(cat, b);
    }
    const cats = Array.from(buckets.values()).map((b) => ({
      ...b,
      rev_delta: b.ly ? ((b.cur - b.ly) / b.ly) * 100 : null,
      units_delta: b.ly_units ? ((b.cur_units - b.ly_units) / b.ly_units) * 100 : null,
      asp_cur: b.cur_units ? b.cur / b.cur_units : 0,
      asp_ly:  b.ly_units  ? b.ly  / b.ly_units  : 0,
      share_pct: totalRev > 0 ? (b.cur / totalRev) * 100 : 0,
    })).map((b) => ({
      ...b,
      asp_delta: b.asp_ly ? ((b.asp_cur - b.asp_ly) / b.asp_ly) * 100 : null,
    }));
    // Sort categories by biggest decline first; growers / no-LY
    // cats sink to the bottom (sub-sorted by current revenue desc).
    cats.sort((a, b) => {
      const ad = a.rev_delta;
      const bd = b.rev_delta;
      const aDec = ad != null && ad < 0;
      const bDec = bd != null && bd < 0;
      if (aDec && bDec) return ad - bd;
      if (aDec) return -1;
      if (bDec) return 1;
      return (b.cur || 0) - (a.cur || 0);
    });
    // Sort subcategories within each category the same way.
    for (const c of cats) {
      c.subs = [...c.subs].map((sc) => ({
        ...sc,
        share_pct: totalRev > 0 ? (sc.cur / totalRev) * 100 : 0,
        units_delta: sc.ly_units ? ((sc.cur_units - sc.ly_units) / sc.ly_units) * 100 : null,
      })).sort((a, b) => {
        const ad = a.delta_pct;
        const bd = b.delta_pct;
        const aDec = ad != null && ad < 0;
        const bDec = bd != null && bd < 0;
        if (aDec && bDec) return ad - bd;
        if (aDec) return -1;
        if (bDec) return 1;
        return (b.cur || 0) - (a.cur || 0);
      });
    }
    return { categories: cats, totalRev, totalUnits };
  }, [subcategories]);

  // Decline / grower counts (declared before the early return so the
  // hooks underneath keep their stable order across renders).
  const declineCount = categories.filter((c) => (c.rev_delta ?? 0) < 0).length;
  const growCount = categories.filter((c) => (c.rev_delta ?? 0) > 0).length;
  const subDecline = categories.reduce(
    (s, c) => s + c.subs.filter((sc) => (sc.delta_pct ?? 0) < 0).length, 0,
  );
  const subGrow = categories.reduce(
    (s, c) => s + c.subs.filter((sc) => (sc.delta_pct ?? 0) > 0).length, 0,
  );

  // Iter 89v — clickable headline chips. Filter modes:
  //  • `all`          (default — show everything)
  //  • `cat-decline`  (only categories whose own Δ% < 0 + their subs)
  //  • `cat-grow`     (only categories whose Δ% > 0 + their subs)
  //  • `sub-decline`  (all categories, but only declining subs underneath)
  //  • `sub-grow`     (all categories, but only growing subs underneath)
  // Sub-filter modes also drop categories with zero matching subs so
  // the table doesn't show empty parent rows.
  const [filter, setFilter] = useState("all");
  const filteredCategories = useMemo(() => {
    if (filter === "all") return categories;
    if (filter === "cat-decline") return categories.filter((c) => (c.rev_delta ?? 0) < 0);
    if (filter === "cat-grow")    return categories.filter((c) => (c.rev_delta ?? 0) > 0);
    if (filter === "sub-decline" || filter === "sub-grow") {
      const want = filter === "sub-decline" ? -1 : 1;
      return categories
        .map((c) => ({
          ...c,
          subs: c.subs.filter((sc) => {
            const d = sc.delta_pct ?? 0;
            return want < 0 ? d < 0 : d > 0;
          }),
        }))
        .filter((c) => c.subs.length > 0);
    }
    return categories;
  }, [categories, filter]);

  // Recompute visible totals so the table footer reflects the filtered view.
  const visibleTotals = useMemo(() => {
    let rev = 0, units = 0;
    for (const c of filteredCategories) {
      if (filter === "sub-decline" || filter === "sub-grow") {
        for (const sc of c.subs) {
          rev += sc.cur || 0;
          units += sc.cur_units || 0;
        }
      } else {
        rev += c.cur || 0;
        units += c.cur_units || 0;
      }
    }
    return { rev, units };
  }, [filteredCategories, filter]);

  if (!categories.length) {
    return <Empty label="No category data." />;
  }

  const Chip = ({ id, count, label, tone }) => {
    const active = filter === id;
    const base = "inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer select-none";
    const toneCls = tone === "decline"
      ? (active ? "bg-rose-600 text-white border-rose-600" : "bg-white text-rose-700 border-rose-200 hover:bg-rose-50")
      : (active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50");
    return (
      <button
        type="button"
        className={`${base} ${toneCls}`}
        onClick={() => setFilter((cur) => (cur === id ? "all" : id))}
        data-testid={`exec-cat-chip-${id}`}
        aria-pressed={active}
        title={active ? "Click again to clear filter" : `Click to show only ${label}`}
      >
        <span className="font-extrabold tabular-nums">{count}</span>
        <span>{label}</span>
        {active && <span className="ml-0.5 opacity-90">×</span>}
      </button>
    );
  };

  return (
    <div data-testid={`exec-catsubcat-table-${view}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px] mb-2.5 px-1">
        <Chip id="cat-decline" count={declineCount} label="categories declining" tone="decline" />
        <Chip id="cat-grow"    count={growCount}    label="growing"             tone="grow" />
        <span className="text-muted px-0.5">·</span>
        <Chip id="sub-decline" count={subDecline}   label="subcats declining"   tone="decline" />
        <Chip id="sub-grow"    count={subGrow}      label="growing"             tone="grow" />
        {filter !== "all" && (
          <button
            type="button"
            onClick={() => setFilter("all")}
            className="text-[10.5px] underline text-muted hover:text-foreground ml-0.5"
            data-testid="exec-cat-clear"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-muted">
          {filter === "all"
            ? <>Total: <span className="font-bold text-foreground tabular-nums">{fmtKES(totalRev)}</span> · <span className="font-bold text-foreground tabular-nums">{fmtNum(totalUnits)}u</span></>
            : <>Filtered: <span className="font-bold text-foreground tabular-nums">{fmtKES(visibleTotals.rev)}</span> · <span className="font-bold text-foreground tabular-nums">{fmtNum(visibleTotals.units)}u</span></>
          }
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-max text-[12px]">
          <thead className="bg-panel sticky top-0 z-10">
            <tr className="text-left">
              <th className="px-3 py-2 font-bold whitespace-nowrap">Category / Subcategory</th>
              <th className="px-3 py-2 font-bold whitespace-nowrap text-right">Revenue</th>
              <th className="px-3 py-2 font-bold whitespace-nowrap text-right">LY</th>
              <th className="px-3 py-2 font-bold whitespace-nowrap text-right">Rev Δ%</th>
              <th className="px-3 py-2 font-bold whitespace-nowrap text-right">Share %</th>
              <th className="px-3 py-2 font-bold whitespace-nowrap text-right">Units</th>
              <th className="px-3 py-2 font-bold whitespace-nowrap text-right">LY Units</th>
              <th className="px-3 py-2 font-bold whitespace-nowrap text-right">Units Δ%</th>
              <th className="px-3 py-2 font-bold whitespace-nowrap text-right">ASP</th>
              <th className="px-3 py-2 font-bold whitespace-nowrap text-right">ASP Δ%</th>
            </tr>
          </thead>
          <tbody>
            {filteredCategories.length === 0 && (
              <tr>
                <td colSpan="10" className="px-3 py-6 text-center text-muted text-[12px]">
                  No rows match the current filter.
                </td>
              </tr>
            )}
            {filteredCategories.map((c) => {
              const catBg =
                (c.rev_delta ?? 0) < -10 ? "bg-rose-50/80"
                : (c.rev_delta ?? 0) < 0 ? "bg-amber-50/80"
                : "bg-emerald-50/40";
              return (
                <React.Fragment key={c.name}>
                  {/* Category roll-up row */}
                  <tr className={`border-t-2 border-border font-bold ${catBg}`} data-testid={`exec-cat-row-${c.name}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px]">{c.name}</span>
                        <span className="text-[10px] font-normal text-muted">({c.subs.length})</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtKES(c.cur)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted font-normal">{fmtKES(c.ly)}</td>
                    <td className="px-3 py-2.5 text-right"><DeltaCell value={c.rev_delta} /></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.share_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(c.cur_units)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted font-normal">{fmtNum(c.ly_units)}</td>
                    <td className="px-3 py-2.5 text-right"><DeltaCell value={c.units_delta} /></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtKES(c.asp_cur)}</td>
                    <td className="px-3 py-2.5 text-right"><DeltaCell value={c.asp_delta} /></td>
                  </tr>
                  {/* Subcategory rows */}
                  {c.subs.map((sc) => {
                    const aspCur = sc.asp?.cur || 0;
                    const aspDelta = sc.asp?.delta_pct;
                    return (
                      <tr key={`${c.name}-${sc.subcategory}`} className="border-t border-border/50 hover:bg-panel/40 transition-colors" data-testid={`exec-subcat-row-${sc.subcategory}`}>
                        <td className="px-3 py-1.5 pl-8 text-muted text-[11.5px]">
                          <span className="text-foreground">{sc.subcategory}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtKES(sc.cur)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted">{fmtKES(sc.ly)}</td>
                        <td className="px-3 py-1.5 text-right"><DeltaCell value={sc.delta_pct} /></td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{sc.share_pct.toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(sc.cur_units)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted">{fmtNum(sc.ly_units)}</td>
                        <td className="px-3 py-1.5 text-right"><DeltaCell value={sc.units_delta} /></td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtKES(aspCur)}</td>
                        <td className="px-3 py-1.5 text-right"><DeltaCell value={aspDelta} /></td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-panel/70 border-t-2 border-border">
            <tr className="font-bold">
              <td className="px-3 py-2">
                {filter === "all" ? `Total (${view.toUpperCase()})` : `Filtered Total (${view.toUpperCase()})`}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtKES(filter === "all" ? totalRev : visibleTotals.rev)}</td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-right tabular-nums">{filter === "all" ? "100%" : `${totalRev > 0 ? ((visibleTotals.rev / totalRev) * 100).toFixed(1) : 0}%`}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(filter === "all" ? totalUnits : visibleTotals.units)}</td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

const _fmtRange = (range) => {
  if (!range) return "";
  const [from, to] = range;
  try {
    const opts = { day: "numeric", month: "short", year: "numeric" };
    const f = new Date(from + "T00:00:00").toLocaleDateString("en-GB", opts);
    const t = new Date(to + "T00:00:00").toLocaleDateString("en-GB", opts);
    return `${f} – ${t}`;
  } catch {
    return `${from} – ${to}`;
  }
};

/**
 * YearlyTargets — YTD revenue progress vs the 2026 budget targets
 * supplied by finance. Each country gets a row (Kenya, Uganda, Rwanda,
 * Online) plus a grand-total row. Progress bar reads (YTD revenue ÷
 * pro-rata YTD target). The annual target is also surfaced so leadership
 * can see "we need X more to hit the full year".
 */
const TargetRow = ({ label, ytdActual, ytdTarget, annualTarget, flag }) => {
  // Iter 89o — focus this row on YTD-actual-vs-YTD-pro-rata-target.
  // The annual figure is shown only for reference (no "% achieved"
  // against annual — that was misleading because Kenya at 89% of
  // YTD-pace was reading as "31% achieved" against annual which made
  // it look catastrophically behind when it's only modestly behind).
  const pct = ytdTarget > 0 ? (ytdActual / ytdTarget) * 100 : 0;
  // Tone — green at/above pace, amber 90-100%, rose under 90%.
  const tone =
    pct >= 100 ? "bg-emerald-500" : pct >= 90 ? "bg-amber-500" : "bg-rose-500";
  const pillTone =
    pct >= 100 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : pct >= 90 ? "text-amber-700 bg-amber-50 border-amber-200"
      : "text-rose-700 bg-rose-50 border-rose-200";
  const gap = ytdTarget - ytdActual;
  return (
    <div
      className="grid grid-cols-[150px_1fr_120px] items-center gap-3 py-2.5 border-b border-border/50 last:border-b-0"
      data-testid={`exec-target-row-${label}`}
    >
      <div className="flex items-center gap-2">
        {flag && <span className="text-[16px]">{flag}</span>}
        <span className="font-bold text-[13px]">{label}</span>
      </div>
      <div>
        <div className="relative h-3 bg-panel rounded-full overflow-hidden">
          <div className={`absolute inset-y-0 left-0 ${tone} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
          {/* On-pace marker at 100% */}
          <div className="absolute inset-y-0 right-0 w-px bg-foreground/40" title="On-pace target (100%)" />
        </div>
        <div className="flex items-baseline justify-between mt-1 text-[10.5px] text-muted">
          <span className="tabular-nums">
            <span className="font-bold text-foreground">{fmtKES(ytdActual)}</span>
            <span className="opacity-60"> · YTD target </span>
            <span className="font-bold tabular-nums text-foreground">{fmtKES(ytdTarget)}</span>
          </span>
          <span className="tabular-nums">
            {gap > 0
              ? <span className="text-rose-700">Behind YTD by <span className="font-bold">{fmtKES(gap)}</span></span>
              : <span className="text-emerald-700">Ahead of YTD by <span className="font-bold">{fmtKES(-gap)}</span></span>
            }
          </span>
        </div>
        <div className="flex items-baseline justify-between mt-0.5 text-[9.5px] text-muted/80">
          <span>Annual budget (reference): <span className="tabular-nums">{fmtKES(annualTarget)}</span></span>
        </div>
      </div>
      <div className="text-right">
        <span className={`inline-flex items-center justify-end gap-1 rounded-md border font-extrabold text-[14px] px-2 py-1 tabular-nums ${pillTone}`} data-testid={`exec-target-pct-${label}`}>
          {pct.toFixed(0)}%
        </span>
        <div className="text-[9.5px] uppercase tracking-wider text-muted mt-1 font-bold">YTD vs YTD-target</div>
      </div>
    </div>
  );
};

const YearlyTargets = ({ targets, ytdCountries, ytdKpis }) => {
  // Build country → ytd actual map from the existing exec-summary
  // country block (no extra fetch). Total ytd actual is the top-level
  // KPI revenue YTD (all channels).
  const actualMap = useMemo(() => {
    const m = {};
    for (const c of ytdCountries || []) m[c.country] = c.revenue?.cur || 0;
    return m;
  }, [ytdCountries]);
  if (!targets || !targets.countries) return null;
  const totalActual = ytdKpis?.revenue?.cur || 0;
  return (
    <div className="card-white p-4 sm:p-5" data-testid="exec-targets-section">
      <SectionTitle
        title="YTD vs Yearly Target (2026 budget)"
        subtitle="YTD revenue vs the day-based prorate of monthly targets — sum of full elapsed months + (current month × day_in_month ÷ days_in_month). Source: finance team budget sheet."
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="rounded-lg border border-border bg-white px-3.5">
          {targets.countries.map((c) => (
            <TargetRow
              key={c.country}
              label={c.country}
              flag={COUNTRY_FLAGS[c.country]}
              ytdActual={actualMap[c.country] || 0}
              ytdTarget={c.ytd}
              annualTarget={c.annual}
            />
          ))}
          <div className="bg-gradient-to-r from-brand/5 to-transparent -mx-3.5 px-3.5">
            <TargetRow
              label="GROUP TOTAL"
              ytdActual={totalActual}
              ytdTarget={targets.total?.ytd || 0}
              annualTarget={targets.total?.annual || 0}
            />
          </div>
        </div>
        {/* Side card — quick scorecard for the group total */}
        <div className="rounded-xl border-2 border-brand/30 bg-gradient-to-br from-brand/5 to-white p-4 flex flex-col justify-center" data-testid="exec-target-group-card">
          <div className="text-[10.5px] uppercase font-extrabold tracking-widest text-brand mb-1">Group YTD pace</div>
          <div className="text-[38px] font-extrabold leading-none tabular-nums">
            {targets.total?.ytd > 0 ? ((totalActual / targets.total.ytd) * 100).toFixed(0) : 0}%
          </div>
          <div className="text-[11px] text-muted mt-1">YTD revenue ÷ YTD-pro-rata target</div>
          <div className="h-px bg-border/60 my-3" />
          <div className="text-[11px] text-muted">YTD revenue (actual)</div>
          <div className="text-[15px] font-bold tabular-nums">{fmtKES(totalActual)}</div>
          <div className="text-[11px] text-muted mt-2">YTD target (pro-rata)</div>
          <div className="text-[15px] font-bold tabular-nums">{fmtKES(targets.total?.ytd || 0)}</div>
          <div className="h-px bg-border/60 my-3" />
          <div className="text-[10px] text-muted">Annual target (reference only)</div>
          <div className="text-[12px] font-bold tabular-nums opacity-80">{fmtKES(targets.total?.annual || 0)}</div>
        </div>
      </div>
    </div>
  );
};

/**
 * StockMix — "What's selling vs what we have" by Category.
 * Side-by-side comparison of inventory mix (% of units on hand) vs
 * sales mix (% of units sold MTD). The Gap column makes mismatches
 * obvious: positive gap ⇒ we're over-stocked relative to sales,
 * negative gap ⇒ hot demand the floor can't supply.
 */
/**
 * StockMix — "What's selling vs what we have" by Category +
 * Subcategory.  Side-by-side comparison of inventory mix (% of units
 * on hand) vs sales mix (% of units sold MTD), with weeks-of-cover
 * derived from the MTD daily run-rate.  The Gap column makes
 * mismatches obvious; the Cover column turns each row into an
 * actionable buy/markdown trigger.
 */
const CoverPill = ({ weeks, bold = false, stockUnits, soldUnits, weeksInWindow, windowDays }) => {
  if (weeks == null) {
    return <span className="text-muted text-[10px] italic" title="No in-window sales — idle stock">Idle</span>;
  }
  // Thresholds (in weeks): <4 restock · 4–17 healthy · >17 markdown.
  // 17 wks ≈ 120 days, 4 wks = 28 days — matches the original day-based
  // trigger semantics requested by leadership.
  const tone =
    weeks < 4 ? "text-rose-700 bg-rose-50 border-rose-200"
    : weeks > 17 ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-emerald-700 bg-emerald-50 border-emerald-200";
  const label =
    weeks < 4 ? "Restock"
    : weeks > 17 ? "Markdown"
    : "Healthy";
  // Build a formula-aware tooltip when caller passes the inputs so the
  // user can hover any cover number and see exactly how it was derived.
  let title = `${weeks.toFixed(1)} weeks of cover · ${label.toLowerCase()} candidate (<4w restock · 4–17w healthy · >17w markdown)`;
  if (
    stockUnits != null && soldUnits != null &&
    weeksInWindow && soldUnits > 0
  ) {
    const weekly = soldUnits / weeksInWindow;
    const winLbl = windowDays ? `${windowDays}d` : `${weeksInWindow}w`;
    title =
      `Weeks of Cover = Stock ÷ (Sold in ${winLbl} ÷ ${weeksInWindow.toFixed(1)} weeks)\n` +
      `= ${fmtNum(stockUnits)} ÷ (${fmtNum(soldUnits)} ÷ ${weeksInWindow.toFixed(1)})\n` +
      `= ${fmtNum(stockUnits)} ÷ ${weekly.toFixed(1)} units/week\n` +
      `= ${weeks.toFixed(1)} weeks  →  ${label}`;
  }
  return (
    <span
      className={`inline-flex items-center justify-end gap-1 rounded-md border ${bold ? "font-bold text-[11px]" : "font-semibold text-[10.5px]"} px-1.5 py-0.5 tabular-nums ${tone} cursor-help`}
      title={title}
      data-testid="exec-stockmix-cover-pill"
    >
      {weeks.toFixed(1)}w
    </span>
  );
};

/**
 * QuickActions — auto-aggregates subcategory rows from Stock Mix into
 * three actionable buckets: markdown candidates (cover > 17w),
 * restock priorities (cover < 4w), and idle stock (no MTD sales).
 * Includes a CSV export button so the merch team can hand the lists
 * straight to ops without manually filtering the full table.
 */
const _csvEscape = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const _downloadCsv = (filename, rows) => {
  const csv = rows.map((r) => r.map(_csvEscape).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const QuickActions = ({ stockMix }) => {
  const windowDays = stockMix?.window_days || 30;
  const buckets = useMemo(() => {
    const markdown = [];
    const restock = [];
    const idle = [];
    for (const c of stockMix?.categories || []) {
      for (const s of c.subcategories || []) {
        const row = { category: c.category, ...s };
        if (s.weeks_of_cover == null) {
          if (s.stock_units > 0) idle.push(row);
        } else if (s.weeks_of_cover > 17) {
          markdown.push(row);
        } else if (s.weeks_of_cover < 4) {
          restock.push(row);
        }
      }
    }
    // Markdown — biggest tied-up KES first (where the cash is stuck).
    markdown.sort((a, b) => (b.tied_up_kes || 0) - (a.tied_up_kes || 0));
    // Restock — fewest weeks of cover first (most urgent).
    restock.sort((a, b) => (a.weeks_of_cover || 0) - (b.weeks_of_cover || 0));
    // Idle — biggest unit pile first.
    idle.sort((a, b) => (b.stock_units || 0) - (a.stock_units || 0));
    const tied = markdown.reduce((s, r) => s + (r.tied_up_kes || 0), 0);
    const mdUnits = markdown.reduce((s, r) => s + (r.stock_units || 0), 0);
    const rsUnits = restock.reduce((s, r) => s + (r.stock_units || 0), 0);
    return { markdown, restock, idle, tied, mdUnits, rsUnits };
  }, [stockMix]);

  const exportCsv = () => {
    const ts = new Date().toISOString().slice(0, 10);
    const soldLbl = `Sold (${windowDays}d)`;
    const head = ["Bucket", "Category", "Subcategory", "Stock Units", "Stock %", soldLbl, "Sold %", "Gap (pp)", "Weeks of Cover", "ASP (KES)", "Tied-up KES"];
    const rows = [head];
    const fmtRow = (bucket, r) => [
      bucket,
      r.category,
      r.subcategory,
      Math.round(r.stock_units || 0),
      r.stock_pct?.toFixed(2) || "",
      Math.round(r.sold_units || 0),
      r.sold_pct?.toFixed(2) || "",
      r.gap_pct?.toFixed(2) || "",
      r.weeks_of_cover != null ? r.weeks_of_cover.toFixed(2) : "",
      r.asp_mtd != null ? r.asp_mtd.toFixed(0) : "",
      r.tied_up_kes != null ? Math.round(r.tied_up_kes) : "",
    ];
    for (const r of buckets.markdown) rows.push(fmtRow("Markdown", r));
    for (const r of buckets.restock)  rows.push(fmtRow("Restock",  r));
    for (const r of buckets.idle)     rows.push(fmtRow("Idle",     r));
    _downloadCsv(`stock-mix-actions-${windowDays}d-${ts}.csv`, rows);
  };

  const hasAnything = buckets.markdown.length || buckets.restock.length || buckets.idle.length;
  if (!hasAnything) return null;

  return (
    <div
      className="rounded-xl border-2 border-amber-300 bg-gradient-to-br from-amber-50/70 via-rose-50/30 to-white p-3 sm:p-3.5 mb-3"
      data-testid="exec-stockmix-quick-actions"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <div className="text-[10.5px] uppercase font-extrabold tracking-widest text-amber-800 mb-1.5">
            Quick Actions
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-[12.5px]">
            {buckets.markdown.length > 0 && (
              <span data-testid="exec-quickact-markdown">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5 -mb-px" />
                <span className="font-extrabold text-amber-800 tabular-nums">{buckets.markdown.length}</span>
                <span className="text-foreground"> markdown candidates · </span>
                <span className="font-bold tabular-nums">{fmtNum(buckets.mdUnits)}</span> units
                <span className="text-muted"> · </span>
                <span className="font-extrabold tabular-nums">{fmtKES(buckets.tied)}</span>
                <span className="text-muted"> tied up</span>
              </span>
            )}
            {buckets.restock.length > 0 && (
              <span data-testid="exec-quickact-restock">
                <span className="inline-block w-2 h-2 rounded-full bg-rose-500 mr-1.5 -mb-px" />
                <span className="font-extrabold text-rose-700 tabular-nums">{buckets.restock.length}</span>
                <span className="text-foreground"> restock {buckets.restock.length === 1 ? "priority" : "priorities"} · </span>
                <span className="font-bold tabular-nums">{fmtNum(buckets.rsUnits)}</span> units left
              </span>
            )}
            {buckets.idle.length > 0 && (
              <span data-testid="exec-quickact-idle">
                <span className="inline-block w-2 h-2 rounded-full bg-muted/70 mr-1.5 -mb-px" />
                <span className="font-extrabold text-muted tabular-nums">{buckets.idle.length}</span>
                <span className="text-foreground"> idle (no MTD sales)</span>
              </span>
            )}
          </div>
          {/* Top examples (max 3 of each, comma-separated) so the
              callout is actionable without scrolling the table. */}
          {(buckets.markdown.length > 0 || buckets.restock.length > 0) && (
            <div className="mt-1.5 text-[10.5px] text-muted">
              {buckets.markdown.length > 0 && (
                <span>
                  <span className="font-bold text-amber-800">Markdown:</span>{" "}
                  {buckets.markdown.slice(0, 3).map((r, i) => (
                    <span key={r.subcategory}>
                      {i > 0 && <span className="opacity-50"> · </span>}
                      <span className="text-foreground">{r.subcategory}</span>
                      <span className="opacity-70"> ({r.weeks_of_cover.toFixed(0)}w · {fmtKES(r.tied_up_kes)})</span>
                    </span>
                  ))}
                  {buckets.markdown.length > 3 && <span className="opacity-60"> · +{buckets.markdown.length - 3} more</span>}
                </span>
              )}
              {buckets.markdown.length > 0 && buckets.restock.length > 0 && <span className="block h-0.5" />}
              {buckets.restock.length > 0 && (
                <span>
                  <span className="font-bold text-rose-700">Restock:</span>{" "}
                  {buckets.restock.slice(0, 3).map((r, i) => (
                    <span key={r.subcategory}>
                      {i > 0 && <span className="opacity-50"> · </span>}
                      <span className="text-foreground">{r.subcategory}</span>
                      <span className="opacity-70"> ({r.weeks_of_cover.toFixed(1)}w)</span>
                    </span>
                  ))}
                  {buckets.restock.length > 3 && <span className="opacity-60"> · +{buckets.restock.length - 3} more</span>}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-lg border-2 border-amber-400 bg-white hover:bg-amber-50 transition-colors px-3 py-1.5 text-[11.5px] font-bold text-amber-800 whitespace-nowrap"
          data-testid="exec-stockmix-export-csv"
          title="Download all action lists (markdown / restock / idle) as a CSV"
        >
          <DownloadSimple size={14} weight="bold" />
          Export to CSV
        </button>
      </div>
    </div>
  );
};

const StockMix = ({ stockMix, windowDays, onWindowChange, windowLoading = false, styleStatus = "all", onStyleStatusChange, customRange, onCustomRangeChange }) => {
  if (!stockMix || !stockMix.categories || stockMix.categories.length === 0) {
    return null;
  }
  const rows = stockMix.categories;
  const wd = stockMix.window_days || windowDays || 30;
  const wiw = stockMix.weeks_in_window || (wd / 7);
  const soldLbl = `Sold (last ${wd}d)`;

  // Full-table CSV export — every category roll-up + every nested
  // subcategory, with every visible column. This is the "everything
  // from the table" export leadership asked for (vs the bucketed
  // Quick Actions CSV which only includes Markdown / Restock / Idle).
  const exportFullCsv = () => {
    const ts = new Date().toISOString().slice(0, 10);
    const head = [
      "Level", "Category", "Subcategory",
      "Stock Units", "Stock %",
      "Warehouse Units", "Warehouse %",
      "Stores Units", "Stores %",
      soldLbl, "Sold %",
      "Gap (pp)",
      "Weeks of Cover", "Cover Tier",
      "ASP (KES)", "Tied-up KES",
      "Read",
    ];
    const out = [head];
    const tier = (w) => w == null ? "Idle" : w < 4 ? "Restock" : w > 17 ? "Markdown" : "Healthy";
    const read = (gap) => gap > 5 ? "Over-stocked" : gap < -5 ? "Hot — restock" : "Balanced";
    for (const r of rows) {
      out.push([
        "Category", r.category, "",
        Math.round(r.stock_units || 0), (r.stock_pct ?? 0).toFixed(2),
        Math.round(r.stock_units_warehouse || 0), (r.stock_pct_warehouse ?? 0).toFixed(2),
        Math.round(r.stock_units_stores || 0), (r.stock_pct_stores ?? 0).toFixed(2),
        Math.round(r.sold_units || 0), (r.sold_pct ?? 0).toFixed(2),
        (r.gap_pct ?? 0).toFixed(2),
        r.weeks_of_cover != null ? r.weeks_of_cover.toFixed(2) : "",
        tier(r.weeks_of_cover),
        r.asp_mtd != null ? Math.round(r.asp_mtd) : "",
        r.tied_up_kes != null ? Math.round(r.tied_up_kes) : "",
        read(r.gap_pct ?? 0),
      ]);
      for (const sc of (r.subcategories || [])) {
        out.push([
          "Subcategory", r.category, sc.subcategory,
          Math.round(sc.stock_units || 0), (sc.stock_pct ?? 0).toFixed(2),
          Math.round(sc.stock_units_warehouse || 0), (sc.stock_pct_warehouse ?? 0).toFixed(2),
          Math.round(sc.stock_units_stores || 0), (sc.stock_pct_stores ?? 0).toFixed(2),
          Math.round(sc.sold_units || 0), (sc.sold_pct ?? 0).toFixed(2),
          (sc.gap_pct ?? 0).toFixed(2),
          sc.weeks_of_cover != null ? sc.weeks_of_cover.toFixed(2) : "",
          tier(sc.weeks_of_cover),
          sc.asp_mtd != null ? Math.round(sc.asp_mtd) : "",
          sc.tied_up_kes != null ? Math.round(sc.tied_up_kes) : "",
          read(sc.gap_pct ?? 0),
        ]);
      }
    }
    // Footer total row
    out.push([
      "Total", "All categories", "",
      Math.round(stockMix.total_stock_units || 0), "100.00",
      Math.round(stockMix.total_stock_units_warehouse || 0), (stockMix.total_stock_pct_warehouse ?? 0).toFixed(2),
      Math.round(stockMix.total_stock_units_stores || 0), (stockMix.total_stock_pct_stores ?? 0).toFixed(2),
      Math.round(stockMix.total_sold_units_mtd || 0), "100.00",
      "", stockMix.total_weeks_of_cover != null ? stockMix.total_weeks_of_cover.toFixed(2) : "",
      tier(stockMix.total_weeks_of_cover),
      "", "", "",
    ]);
    _downloadCsv(`stock-mix-full-${wd}d-${ts}.csv`, out);
  };

  return (
    <div className="card-white p-4 sm:p-5" data-testid="exec-stockmix-section">
      <SectionTitle
        title="Stock Mix — What's selling vs what we have"
        subtitle={
          <span>
            Share of units on hand (group-wide inventory) compared with share of units sold over the selected window, by category. A positive gap means we're carrying more stock than the sell-through justifies; a negative gap means demand outpaces supply.
            <span className="ml-1.5">Total on hand: <span className="font-bold text-foreground tabular-nums">{fmtNum(stockMix.total_stock_units)}u</span>
            <span className="text-muted"> (</span><span className="font-semibold tabular-nums">{fmtNum(stockMix.total_stock_units_warehouse)}u</span><span className="text-muted"> warehouse · </span><span className="font-semibold tabular-nums">{fmtNum(stockMix.total_stock_units_stores)}u</span><span className="text-muted"> stores)</span>
            <span> · Sold ({wd}d): <span className="font-bold text-foreground tabular-nums">{fmtNum(stockMix.total_sold_units_mtd)}u</span></span>
            {stockMix.total_weeks_of_cover != null && (
              <span> · Group cover: <span className="font-bold text-foreground tabular-nums">{stockMix.total_weeks_of_cover.toFixed(1)}w</span></span>
            )}
            </span>
          </span>
        }
      />

      {/* Toolbar — window selector + style-status filter + custom range + full-table CSV export + formula */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <DateWindowSelector
            value={customRange?.from && customRange?.to ? -1 : wd}
            onChange={(v) => {
              // Clear any custom range whenever the user picks a preset
              if (customRange?.from || customRange?.to) {
                onCustomRangeChange?.({ from: "", to: "" });
              }
              onWindowChange?.(v);
            }}
            presets={[
              { v: 30, l: "30d" },
              { v: 60, l: "60d" },
              { v: 90, l: "90d" },
            ]}
            testId="exec-stockmix-window"
            label="Sales window"
          />
          {/* Custom date range — feeds `date_from` / `date_to` to the
              endpoint. When both fields are populated, the preset
              selector becomes a no-op and the formula caption shows
              the actual span. */}
          <div
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2 py-1"
            data-testid="exec-stockmix-custom-range"
            title="Override the preset window with an explicit date range. Both From and To required."
          >
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted">Custom</span>
            <input
              type="date"
              value={customRange?.from || ""}
              onChange={(e) => onCustomRangeChange?.({ ...(customRange || {}), from: e.target.value })}
              data-testid="exec-stockmix-custom-from"
              className="text-[10.5px] font-semibold bg-transparent focus:outline-none border-0 px-1 py-0.5"
            />
            <span className="text-[10.5px] text-muted">→</span>
            <input
              type="date"
              value={customRange?.to || ""}
              onChange={(e) => onCustomRangeChange?.({ ...(customRange || {}), to: e.target.value })}
              data-testid="exec-stockmix-custom-to"
              className="text-[10.5px] font-semibold bg-transparent focus:outline-none border-0 px-1 py-0.5"
            />
            {(customRange?.from || customRange?.to) && (
              <button
                type="button"
                onClick={() => onCustomRangeChange?.({ from: "", to: "" })}
                data-testid="exec-stockmix-custom-clear"
                className="text-[10.5px] text-rose-600 hover:text-rose-700 font-bold px-1"
                title="Clear custom range, revert to preset window"
              >×</button>
            )}
          </div>
          {onStyleStatusChange && (
            <StyleStatusToggle
              value={styleStatus}
              onChange={onStyleStatusChange}
              size="xs"
              testIdPrefix="exec-stockmix-style-status"
            />
          )}
          {windowLoading && (
            <span className="text-[10.5px] text-muted italic" data-testid="exec-stockmix-window-loading">re-windowing…</span>
          )}
        </div>
        <button
          type="button"
          onClick={exportFullCsv}
          data-testid="exec-stockmix-export-full-btn"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-white text-[11px] font-semibold hover:border-brand/60 hover:text-brand transition-colors"
          title="Download the full Stock Mix table — every category, subcategory, and column — as CSV"
        >
          <DownloadSimple size={13} weight="bold" />
          Export full table CSV
        </button>
      </div>

      {/* Formula caption — explicit, so leadership sees exactly how
          Weeks of Cover is derived without having to hover. */}
      <div
        className="rounded-md border border-border bg-panel/40 px-3 py-2 mb-3 text-[11.5px] text-foreground"
        data-testid="exec-stockmix-formula-caption"
      >
        <span className="font-bold text-muted uppercase tracking-wide text-[10px] mr-2">Formula</span>
        <span className="tabular-nums">
          Weeks of Cover&nbsp;=&nbsp;Stock Units&nbsp;÷&nbsp;(Sold in {wd}d&nbsp;÷&nbsp;{wiw.toFixed(1)} weeks)
        </span>
        {stockMix.sold_window?.from && stockMix.sold_window?.to && (
          <span className="text-muted ml-2" data-testid="exec-stockmix-window-span">
            · range <span className="font-semibold text-foreground tabular-nums">{stockMix.sold_window.from}</span> → <span className="font-semibold text-foreground tabular-nums">{stockMix.sold_window.to}</span>
          </span>
        )}
        <span className="text-muted ml-2">— hover any Cover pill to see the row-level calculation.</span>
        {styleStatus && styleStatus !== "all" && (
          <span
            className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-50 border border-amber-200 text-amber-800"
            data-testid="exec-stockmix-filter-note"
            title="The style-status filter only narrows the inventory side of the comparison; subcategory sales remain unfiltered because they're aggregated above the style grain."
          >
            Note: filter narrows stock only — Sold% uses full sales.
          </span>
        )}
      </div>

      <QuickActions stockMix={stockMix} />
      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-max text-[12.5px]" data-testid="exec-stockmix-table">
          <thead className="bg-panel">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Category</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Stock Units</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Stock %</th>
              <th
                className="px-3 py-2 font-semibold whitespace-nowrap text-right cursor-help"
                title="Units sitting in central warehouse locations (Warehouse Finished Goods, Vivo Warehouse, etc.). Stock Units = Warehouse + Stores."
              >Warehouse</th>
              <th
                className="px-3 py-2 font-semibold whitespace-nowrap text-right cursor-help"
                title="Share of this row's stock that sits in the warehouse."
              >WH %</th>
              <th
                className="px-3 py-2 font-semibold whitespace-nowrap text-right cursor-help"
                title="Units sitting on shop floors (all non-warehouse POS locations)."
              >Stores</th>
              <th
                className="px-3 py-2 font-semibold whitespace-nowrap text-right cursor-help"
                title="Share of this row's stock that sits on shop floors."
              >Store %</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">{soldLbl}</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Sold %</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Gap (pp)</th>
              <th
                className="px-3 py-2 font-semibold whitespace-nowrap text-right cursor-help"
                title={`Weeks of Cover = Stock Units ÷ (Sold in ${wd}d ÷ ${wiw.toFixed(1)} weeks). <4w restock · 4–17w healthy · >17w markdown.`}
              >Cover (wks)</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Read</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gap = r.gap_pct;
              const oversupply = gap > 5;
              const undersupply = gap < -5;
              const rowTone = oversupply ? "bg-amber-50/60"
                : undersupply ? "bg-rose-50/60"
                : "";
              const gapCls = oversupply ? "text-amber-700 bg-amber-50 border-amber-200"
                : undersupply ? "text-rose-700 bg-rose-50 border-rose-200"
                : "text-emerald-700 bg-emerald-50 border-emerald-200";
              const read = oversupply
                ? "Over-stocked"
                : undersupply
                ? "Hot — restock"
                : "Balanced";
              return (
                <React.Fragment key={r.category}>
                  {/* Category roll-up row */}
                  <tr className={`border-t-2 border-border font-bold ${rowTone}`} data-testid={`exec-stockmix-row-${r.category}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{r.category}</span>
                        {r.subcategories?.length > 0 && (
                          <span className="text-[10px] font-normal text-muted">({r.subcategories.length})</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.stock_units)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.stock_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.stock_units_warehouse)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{(r.stock_pct_warehouse ?? 0).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.stock_units_stores)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{(r.stock_pct_stores ?? 0).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.sold_units)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.sold_pct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`inline-flex items-center gap-0.5 rounded-md border font-bold text-[11px] px-1.5 py-0.5 tabular-nums ${gapCls}`}>
                        {gap > 0 ? "+" : ""}{gap.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CoverPill
                        weeks={r.weeks_of_cover}
                        bold
                        stockUnits={r.stock_units}
                        soldUnits={r.sold_units}
                        weeksInWindow={wiw}
                        windowDays={wd}
                      />
                    </td>
                    <td className="px-3 py-2 text-[11px] font-semibold whitespace-nowrap">
                      {oversupply && <span className="text-amber-700">{read}</span>}
                      {undersupply && <span className="text-rose-700">{read}</span>}
                      {!oversupply && !undersupply && <span className="text-emerald-700">{read}</span>}
                    </td>
                  </tr>
                  {/* Subcategory rows nested underneath the parent */}
                  {(r.subcategories || []).map((sc) => {
                    const sgap = sc.gap_pct;
                    const sOver = sgap > 5;
                    const sUnder = sgap < -5;
                    const sGapCls = sOver ? "text-amber-700 bg-amber-50 border-amber-200"
                      : sUnder ? "text-rose-700 bg-rose-50 border-rose-200"
                      : "text-emerald-700 bg-emerald-50 border-emerald-200";
                    const sRead = sOver ? "Over-stocked" : sUnder ? "Hot — restock" : "Balanced";
                    return (
                      <tr key={`${r.category}-${sc.subcategory}`} className="border-t border-border/50 hover:bg-panel/40 transition-colors" data-testid={`exec-stockmix-sub-${sc.subcategory}`}>
                        <td className="px-3 py-1.5 pl-8 text-[11.5px]">
                          <span className="text-muted">{sc.subcategory}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px]">{fmtNum(sc.stock_units)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px]">{sc.stock_pct.toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px]">{fmtNum(sc.stock_units_warehouse)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px] text-muted">{(sc.stock_pct_warehouse ?? 0).toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px]">{fmtNum(sc.stock_units_stores)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px] text-muted">{(sc.stock_pct_stores ?? 0).toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px]">{fmtNum(sc.sold_units)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11.5px]">{sc.sold_pct.toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-right">
                          <span className={`inline-flex items-center gap-0.5 rounded-md border font-bold text-[10.5px] px-1.5 py-0.5 tabular-nums ${sGapCls}`}>
                            {sgap > 0 ? "+" : ""}{sgap.toFixed(1)}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <CoverPill
                            weeks={sc.weeks_of_cover}
                            stockUnits={sc.stock_units}
                            soldUnits={sc.sold_units}
                            weeksInWindow={wiw}
                            windowDays={wd}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-[10.5px] font-semibold whitespace-nowrap">
                          {sOver && <span className="text-amber-700">{sRead}</span>}
                          {sUnder && <span className="text-rose-700">{sRead}</span>}
                          {!sOver && !sUnder && <span className="text-emerald-700">{sRead}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-panel/70 border-t-2 border-border">
            <tr className="font-bold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(stockMix.total_stock_units)}</td>
              <td className="px-3 py-2 text-right tabular-nums">100%</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(stockMix.total_stock_units_warehouse)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{(stockMix.total_stock_pct_warehouse ?? 0).toFixed(1)}%</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(stockMix.total_stock_units_stores)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-muted">{(stockMix.total_stock_pct_stores ?? 0).toFixed(1)}%</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(stockMix.total_sold_units_mtd)}</td>
              <td className="px-3 py-2 text-right tabular-nums">100%</td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-right">
                <CoverPill
                  weeks={stockMix.total_weeks_of_cover}
                  bold
                  stockUnits={stockMix.total_stock_units}
                  soldUnits={stockMix.total_sold_units_mtd}
                  weeksInWindow={wiw}
                  windowDays={wd}
                />
              </td>
              <td className="px-3 py-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="text-[10.5px] text-muted mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
        <span>Gap &gt; +5pp = over-stocked · Gap &lt; -5pp = hot demand</span>
        <span className="opacity-70">·</span>
        <span>Cover &lt; 4w = restock · 4–17w = healthy · &gt; 17w = markdown candidate</span>
      </div>
    </div>
  );
};


const ExecutiveSummary = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Category section view toggle. KPIs + Store table always show both
  // YTD and MTD; only this single chart pair is too wide to show both
  // simultaneously so a compact in-section selector decides which to
  // render. Default is MTD because the charts answer "what's happening
  // right now".
  // Iter 89q — default the cat/subcat breakdown to YTD per leadership
  // pref (gives the longer signal); MTD is still one click away.
  const [catView, setCatView] = useState("ytd");
  // Iter 89g — click-a-country-to-drill-down state. `selectedCountry`
  // is one of "Kenya" / "Uganda" / "Rwanda" / "Online" or null.
  // - Store Performance table filters client-side.
  // - Category section re-fetches `/api/exec-summary?country=X` (lazy)
  //   and overlays the country-scoped categories without re-painting
  //   the rest of the page. The full payload is cached per country.
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [countryData, setCountryData] = useState(null); // payload of the country-filtered fetch
  const [countryLoading, setCountryLoading] = useState(false);

  // Iter 91 — Stock Mix sales window. 30 / 60 / 90 day rolling window
  // that drives BOTH the Sold column and Weeks of Cover. Re-fetch the
  // exec-summary endpoint with `window_days` when it changes; the
  // result is cached client-side so flipping between presets is fast
  // after the first hit. `stockMixOverride` lets us swap *just* the
  // stock_mix block without re-painting the rest of the page.
  const [stockWindowDays, setStockWindowDays] = useState(30);
  const [stockStyleStatus, setStockStyleStatus] = useState("all");
  const [stockCustomRange, setStockCustomRange] = useState({ from: "", to: "" });
  const [stockMixOverride, setStockMixOverride] = useState(null);
  const [stockMixLoading, setStockMixLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    api
      .get("/exec-summary", { timeout: 90000 })
      .then(({ data: d }) => { if (!cancel) setData(d); })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, []);

  // Iter 89g — lazy fetch for country-scoped categories. We only ask
  // when a country is selected. api.js caches the response so toggling
  // back to a previously-selected country is instant.
  useEffect(() => {
    if (!selectedCountry) {
      setCountryData(null);
      return;
    }
    let cancel = false;
    setCountryLoading(true);
    api
      .get("/exec-summary", { params: { country: selectedCountry }, timeout: 90000 })
      .then(({ data: d }) => { if (!cancel) setCountryData(d); })
      .catch(() => { if (!cancel) setCountryData(null); })
      .finally(() => { if (!cancel) setCountryLoading(false); });
    return () => { cancel = true; };
  }, [selectedCountry]);

  // Iter 91 — re-fetch exec-summary with the chosen `window_days` so
  // the Stock Mix Sold% / Cover columns re-window without altering the
  // YTD/MTD KPI cards above. Only `stock_mix` from the returned payload
  // is consumed; everything else is ignored. Country filter, if set,
  // tags along so the window-scoped numbers stay consistent with the
  // country-scoped view.
  useEffect(() => {
    const hasCustom = !!(stockCustomRange.from && stockCustomRange.to);
    // Default 30d + All + no-custom-range ships in the initial fetch.
    if (stockWindowDays === 30 && stockStyleStatus === "all" && !selectedCountry && !hasCustom) {
      setStockMixOverride(null);
      return;
    }
    let cancel = false;
    setStockMixLoading(true);
    const params = {};
    if (hasCustom) {
      params.date_from = stockCustomRange.from;
      params.date_to = stockCustomRange.to;
    } else {
      params.window_days = stockWindowDays;
    }
    if (stockStyleStatus && stockStyleStatus !== "all") params.style_status = stockStyleStatus;
    if (selectedCountry) params.country = selectedCountry;
    api
      .get("/exec-summary", { params, timeout: 90000 })
      .then(({ data: d }) => { if (!cancel) setStockMixOverride(d?.stock_mix || null); })
      .catch(() => { if (!cancel) setStockMixOverride(null); })
      .finally(() => { if (!cancel) setStockMixLoading(false); });
    return () => { cancel = true; };
  }, [stockWindowDays, stockStyleStatus, selectedCountry, stockCustomRange.from, stockCustomRange.to]);

  // Mobile snapshot — full-screen overlay (same pattern as Overview):
  // page swaps to a stripped compact view, "Save image" downloads a
  // PNG. Hooks declared BEFORE the early returns so React sees them
  // in the same order on every render.
  const [snapshot, setSnapshot] = useState(false);

  // Iter 91m — Canonical Units Sold (Vivo merchandise only). Fetched
  // for all 4 windows (YTD cur/LY, MTD cur/LY) so the headline "Units
  // Sold" KPI tile reads the same single source of truth as the rest
  // of the dashboard. Falls back to upstream data.kpis.units while
  // in-flight.
  const [canonUnits, setCanonUnits] = useState(null);
  useEffect(() => {
    if (!data?.windows) return;
    let cancel = false;
    const fetch1 = (range) => {
      const [from, to] = range || [];
      if (!from || !to) return Promise.resolve(null);
      const params = { date_from: from, date_to: to };
      if (selectedCountry) params.country = selectedCountry;
      return api.get("/analytics/canonical-units-sold", { params })
        .then((r) => r.data?.units_sold ?? null)
        .catch(() => null);
    };
    const ytd = data.windows.ytd || {};
    const mtd = data.windows.mtd || {};
    Promise.all([
      fetch1(ytd.current), fetch1(ytd.ly),
      fetch1(mtd.current), fetch1(mtd.ly),
    ]).then(([yCur, yLy, mCur, mLy]) => {
      if (cancel) return;
      setCanonUnits({ ytd_cur: yCur, ytd_ly: yLy, mtd_cur: mCur, mtd_ly: mLy });
    });
    return () => { cancel = true; };
  }, [data, selectedCountry]);

  if (loading) return <Loading label="Loading executive summary…" />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Empty label="No data available." />;

  // When a country is selected, render the *country-scoped* categories
  // section (lazy-fetched). Until that arrives, keep the group-wide
  // categories visible so the user never sees a blank panel.
  const catSource = countryData || data;

  const ytdRange = data.windows?.ytd;
  const mtdRange = data.windows?.mtd;
  const k = (key) => ({
    ytd: data.ytd.kpis[key],
    mtd: data.mtd.kpis[key],
  });
  // Iter 91m — Canonical Units Sold override. When the canonical fetch
  // has resolved, replace the upstream units KPI block with merch-only
  // values + recomputed delta_pct so the KPI tile + delta both reflect
  // the canonical truth.
  const _pct = (cur, ly) => {
    if (cur == null || ly == null || ly === 0) return null;
    return ((cur - ly) / ly) * 100;
  };
  const unitsKpi = (() => {
    if (!canonUnits) return k("units");
    const yCur = canonUnits.ytd_cur, yLy = canonUnits.ytd_ly;
    const mCur = canonUnits.mtd_cur, mLy = canonUnits.mtd_ly;
    const upstream = k("units");
    return {
      ytd: yCur != null
        ? { cur: yCur, ly: yLy ?? upstream.ytd?.ly ?? 0, delta_pct: _pct(yCur, yLy) }
        : upstream.ytd,
      mtd: mCur != null
        ? { cur: mCur, ly: mLy ?? upstream.mtd?.ly ?? 0, delta_pct: _pct(mCur, mLy) }
        : upstream.mtd,
    };
  })();

  if (snapshot) {
    return <ExecutiveSummarySnapshot data={data} onClose={() => setSnapshot(false)} />;
  }

  return (
    <div className="space-y-5" data-testid="exec-summary-page">
      {/* Page header — title + dynamic date subtitle */}
      <div className="card-white p-4 sm:p-5">
        <div className="flex items-start gap-3 flex-wrap justify-between">
          <div>
            <h1 className="text-[22px] sm:text-[26px] font-extrabold leading-tight flex items-center gap-2">
              <Briefcase size={22} weight="duotone" className="text-brand" />
              Executive Summary
            </h1>
            <div className="text-[12px] text-muted mt-1 space-y-0.5">
              <div data-testid="exec-mtd-window">
                <span className="font-bold text-foreground">MTD:</span> {_fmtRange(mtdRange?.current)} <span className="text-muted">vs</span> {_fmtRange(mtdRange?.ly)}
              </div>
              <div data-testid="exec-ytd-window">
                <span className="font-bold text-foreground">YTD:</span> {_fmtRange(ytdRange?.current)} <span className="text-muted">vs</span> {_fmtRange(ytdRange?.ly)}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setSnapshot(true)}
              data-testid="exec-open-snapshot-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-semibold border border-border bg-white hover:border-brand/60 hover:text-brand transition-colors whitespace-nowrap shrink-0"
              title="Compact mobile-friendly view of the headline KPIs — perfect for one screenshot"
            >
              <DownloadSimple size={14} weight="bold" />
              Mobile snapshot
            </button>
            <div className="text-[11px] text-muted text-right">
              <div className="font-semibold text-foreground">As of</div>
              <div>{_fmtRange([data.as_of, data.as_of]).split(" – ")[0]}</div>
              <div className="mt-1">Auto-refreshing daily · ends yesterday</div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1 — Top KPI scorecard */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard testId="kpi-revenue"   label="Total Revenue"        icon={TrendUp}       fmt={fmtKES} ytd={k("revenue").ytd}   mtd={k("revenue").mtd} />
        <KpiCard testId="kpi-avgday"    label="Avg Sales / Day"      icon={Coins}         fmt={fmtKES} ytd={k("avg_sales_per_day").ytd} mtd={k("avg_sales_per_day").mtd} />
        <KpiCard testId="kpi-units"     label="Units Sold"           icon={Package}                   ytd={unitsKpi.ytd}     mtd={unitsKpi.mtd} />
        <KpiCard testId="kpi-footfall"  label="Footfall"             icon={Footprints}                ytd={k("footfall").ytd}  mtd={k("footfall").mtd} />
        <KpiCard testId="kpi-basket"    label="Avg Basket"           icon={Coins}         fmt={fmtKES} ytd={k("avg_basket").ytd} mtd={k("avg_basket").mtd} />
        <KpiCard testId="kpi-asp"       label="ASP"                  icon={Tag}           fmt={fmtKES} ytd={k("asp").ytd}        mtd={k("asp").mtd} />
        <KpiCard testId="kpi-customers" label="Total Customers"      icon={UsersThree}                ytd={k("total_customers").ytd} mtd={k("total_customers").mtd} />
        <KpiCard testId="kpi-new"       label="New Customers"        icon={UserPlus}                  ytd={k("new_customers").ytd}   mtd={k("new_customers").mtd} />
        <KpiCard testId="kpi-returning" label="Returning Customers"  icon={ArrowsClockwise}           ytd={k("returning_customers").ytd} mtd={k("returning_customers").mtd} />
      </div>

      {/* SECTION 1.5 — Country breakdown */}
      <div className="card-white p-4 sm:p-5">
        <SectionTitle
          title="By Country"
          subtitle={
            <span>
              Revenue · Orders · Footfall · Avg Basket per country (Kenya, Uganda, Rwanda, Online) vs same period last year.
              <span className="ml-1.5 text-[11px] font-semibold text-brand">Click a card to filter the Store Performance + Category sections below.</span>
            </span>
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(data.ytd.countries || []).map((c) => {
            const mtdCountry = (data.mtd.countries || []).find((x) => x.country === c.country);
            // Match the per-country target on country name. `targets`
            // payload uses the same {Kenya, Uganda, Rwanda, Online}
            // buckets so the join is a direct find().
            const tgt = (data.targets?.countries || []).find((t) => t.country === c.country);
            return (
              <CountryCard
                key={c.country}
                ytd={c}
                mtd={mtdCountry}
                targets={tgt}
                selected={selectedCountry === c.country}
                onClick={() => setSelectedCountry((cur) => cur === c.country ? null : c.country)}
              />
            );
          })}
        </div>
      </div>

      {/* SECTION 2 — YTD vs Yearly Target (2026 budget). Promoted
          to right after the Country cards so leadership sees the
          headline pace before drilling into category / store detail. */}
      <YearlyTargets
        targets={data.targets}
        ytdCountries={data.ytd.countries}
        ytdKpis={data.ytd.kpis}
      />

      {/* SECTION 3 — Category + Subcategory */}
      <div className="card-white p-4 sm:p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <SectionTitle
            title="Category & Subcategory Breakdown"
            subtitle={
              <span>
                Categories rolled up vs same period last year, with each subcategory listed underneath. Sorted worst-decline first so the bleeding buckets surface at the top. Color-coded Δ% cells make growth (green) and decline (red) instantly readable.
                {selectedCountry && (
                  <span className="ml-1.5 text-[11px] font-bold text-brand">
                    Filtered to {COUNTRY_FLAGS[selectedCountry]} {selectedCountry}{countryLoading ? " — loading…" : ""}
                  </span>
                )}
              </span>
            }
          />
          <div className="flex items-center gap-2">
            {selectedCountry && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-brand/10 text-brand border border-brand/30 hover:bg-brand/15 transition"
                onClick={() => setSelectedCountry(null)}
                data-testid="exec-cat-clear-filter"
              >
                Clear country filter ×
              </button>
            )}
            <div className="inline-flex rounded-md border border-border overflow-hidden text-[11.5px] font-semibold" data-testid="exec-cat-view-toggle">
              <button
                type="button"
                className={`px-3 py-1.5 ${catView === "mtd" ? "bg-brand text-white" : "bg-white text-foreground hover:bg-panel"}`}
                onClick={() => setCatView("mtd")}
                data-testid="exec-cat-toggle-mtd"
              >MTD</button>
              <button
                type="button"
                className={`px-3 py-1.5 ${catView === "ytd" ? "bg-brand text-white" : "bg-white text-foreground hover:bg-panel"}`}
                onClick={() => setCatView("ytd")}
                data-testid="exec-cat-toggle-ytd"
              >YTD</button>
            </div>
          </div>
        </div>
        <div data-testid="exec-cat-table-pane">
          <CategorySubcatTable
            subcategories={catSource[catView].categories.subcategories}
            view={catView}
          />
        </div>
      </div>

      {/* SECTION 4 — Stock Mix: what's selling vs what we have */}
      <StockMix
        stockMix={stockMixOverride || (countryData?.stock_mix) || data.stock_mix}
        windowDays={stockWindowDays}
        onWindowChange={setStockWindowDays}
        windowLoading={stockMixLoading}
        styleStatus={stockStyleStatus}
        onStyleStatusChange={setStockStyleStatus}
        customRange={stockCustomRange}
        onCustomRangeChange={setStockCustomRange}
      />

      {/* SECTION 5 — Store performance (moved to bottom per leadership
          pref — the per-store grain reads last after the higher-level
          country / target / category / stock sections). */}
      <div className="card-white p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <SectionTitle
            title="Store Performance"
            subtitle={
              <span>
                Physical stores only (Staff & Online channels excluded). Sorted worst-first by MTD Δ%. Rows highlighted: <span className="text-rose-700 font-semibold">red</span> &lt; -10%, <span className="text-amber-700 font-semibold">amber</span> -10–0%, <span className="text-emerald-700 font-semibold">green</span> &gt; 0%.
              </span>
            }
          />
          {selectedCountry && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-brand/10 text-brand border border-brand/30 hover:bg-brand/15 transition shrink-0"
              onClick={() => setSelectedCountry(null)}
              data-testid="exec-store-clear-filter"
            >
              <span>{COUNTRY_FLAGS[selectedCountry]} {selectedCountry}</span>
              <span className="opacity-70">×</span>
            </button>
          )}
        </div>
        <StorePerformanceTable
          ytdStores={data.ytd.stores}
          mtdStores={data.mtd.stores}
          countryFilter={selectedCountry}
        />
      </div>

      {/* SECTION 6 — What's Hot / What's Not narrative banner. */}
      <HotNotCallout
        subcategories={catSource.mtd.categories.subcategories}
        view="mtd"
      />
    </div>
  );
};

export default ExecutiveSummary;
