import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, Empty, SectionTitle } from "@/components/common";
import { useTableSort, SortableTh } from "@/lib/useTableSort";
import { categoryFor } from "@/lib/productCategory";
import {
  ArrowUp, ArrowDown, Minus, Warning,
  TrendUp, Footprints, Coins, UsersThree, UserPlus, ArrowsClockwise,
  Briefcase, Tag, Package,
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
        <div data-testid={`${testId}-mtd`}>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[9.5px] uppercase font-bold text-muted tracking-widest">MTD</div>
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

const CountryCard = ({ ytd, mtd, selected, onClick }) => {
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
          <CountryMetricRow label="Units"                   cur={ytd?.units?.cur}      ly={ytd?.units?.ly}      delta={ytd?.units?.delta_pct} />
          <CountryMetricRow label="Orders"                  cur={ytd?.orders?.cur}     ly={ytd?.orders?.ly}     delta={ytd?.orders?.delta_pct} />
          <CountryMetricRow label="Footfall"                cur={ytd?.footfall?.cur}   ly={ytd?.footfall?.ly}   delta={ytd?.footfall?.delta_pct} />
          <CountryMetricRow label="Basket"   fmt={fmtKES}  cur={ytd?.avg_basket?.cur} ly={ytd?.avg_basket?.ly} delta={ytd?.avg_basket?.delta_pct} />
          <CountryMetricRow label="ASP"      fmt={fmtKES}  cur={ytd?.asp?.cur}        ly={ytd?.asp?.ly}        delta={ytd?.asp?.delta_pct} />
        </div>
        {/* Iter 89n — visually distinguish MTD from YTD: tinted block
            with a left accent border and a coloured "MTD" badge so the
            two windows don't bleed into each other at a glance. */}
        <div
          data-testid={`exec-country-${country}-mtd`}
          className="rounded-md border-l-[3px] border-indigo-400 bg-indigo-50/50 px-2 py-1.5 -mx-1"
        >
          <div className="mb-1">
            <span className="inline-block text-[9.5px] uppercase font-extrabold tracking-widest text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">MTD</span>
          </div>
          <CountryMetricRow label="Revenue"   fmt={fmtKES} cur={mtd?.revenue?.cur}    ly={mtd?.revenue?.ly}    delta={mtd?.revenue?.delta_pct} />
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

  if (!categories.length) {
    return <Empty label="No category data." />;
  }

  // Decline / grower counts to surface a one-line headline above the table.
  const declineCount = categories.filter((c) => (c.rev_delta ?? 0) < 0).length;
  const growCount = categories.filter((c) => (c.rev_delta ?? 0) > 0).length;
  const subDecline = categories.reduce(
    (s, c) => s + c.subs.filter((sc) => (sc.delta_pct ?? 0) < 0).length, 0,
  );
  const subGrow = categories.reduce(
    (s, c) => s + c.subs.filter((sc) => (sc.delta_pct ?? 0) > 0).length, 0,
  );

  return (
    <div data-testid={`exec-catsubcat-table-${view}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] mb-2.5 px-1">
        <span><span className="font-bold text-rose-700 tabular-nums">{declineCount}</span> categories declining</span>
        <span><span className="font-bold text-emerald-700 tabular-nums">{growCount}</span> growing</span>
        <span className="text-muted">·</span>
        <span><span className="font-bold text-rose-700 tabular-nums">{subDecline}</span> subcats declining</span>
        <span><span className="font-bold text-emerald-700 tabular-nums">{subGrow}</span> growing</span>
        <span className="ml-auto text-muted">Total: <span className="font-bold text-foreground tabular-nums">{fmtKES(totalRev)}</span> · <span className="font-bold text-foreground tabular-nums">{fmtNum(totalUnits)}u</span></span>
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
            {categories.map((c) => {
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
              <td className="px-3 py-2">Total ({view.toUpperCase()})</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtKES(totalRev)}</td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-right tabular-nums">100%</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(totalUnits)}</td>
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
        subtitle="YTD revenue against the pro-rata budget (full months + day-of-month pro-rata of the current month). Source: finance team budget sheet."
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
const StockMix = ({ stockMix }) => {
  if (!stockMix || !stockMix.categories || stockMix.categories.length === 0) {
    return null;
  }
  const rows = stockMix.categories;
  return (
    <div className="card-white p-4 sm:p-5" data-testid="exec-stockmix-section">
      <SectionTitle
        title="Stock Mix — What's selling vs what we have"
        subtitle={
          <span>
            Share of units on hand (group-wide inventory) compared with share of units sold MTD, by category. A positive gap means we're carrying more stock than the sell-through justifies; a negative gap means demand outpaces supply.
            <span className="ml-1.5">Total on hand: <span className="font-bold text-foreground tabular-nums">{fmtNum(stockMix.total_stock_units)}u</span> · Sold MTD: <span className="font-bold text-foreground tabular-nums">{fmtNum(stockMix.total_sold_units_mtd)}u</span></span>
          </span>
        }
      />
      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-max text-[12.5px]" data-testid="exec-stockmix-table">
          <thead className="bg-panel">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Category</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Stock Units</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Stock %</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Sold MTD</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Sold %</th>
              <th className="px-3 py-2 font-semibold whitespace-nowrap text-right">Gap (pp)</th>
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
                <tr key={r.category} className={`border-t border-border/50 ${rowTone}`} data-testid={`exec-stockmix-row-${r.category}`}>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap">{r.category}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.stock_units)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">{r.stock_pct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.sold_units)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">{r.sold_pct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-flex items-center gap-0.5 rounded-md border font-bold text-[11px] px-1.5 py-0.5 tabular-nums ${gapCls}`}>
                      {gap > 0 ? "+" : ""}{gap.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px] font-semibold whitespace-nowrap">
                    {oversupply && <span className="text-amber-700">{read}</span>}
                    {undersupply && <span className="text-rose-700">{read}</span>}
                    {!oversupply && !undersupply && <span className="text-emerald-700">{read}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-panel/70 border-t-2 border-border">
            <tr className="font-bold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(stockMix.total_stock_units)}</td>
              <td className="px-3 py-2 text-right tabular-nums">100%</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(stockMix.total_sold_units_mtd)}</td>
              <td className="px-3 py-2 text-right tabular-nums">100%</td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="text-[10.5px] text-muted mt-2 flex items-center justify-end gap-4">
        <span>Gap &gt; +5pp = over-stocked · Gap &lt; -5pp = hot demand · |Gap| ≤ 5pp = balanced</span>
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
  const [catView, setCatView] = useState("mtd");
  // Iter 89g — click-a-country-to-drill-down state. `selectedCountry`
  // is one of "Kenya" / "Uganda" / "Rwanda" / "Online" or null.
  // - Store Performance table filters client-side.
  // - Category section re-fetches `/api/exec-summary?country=X` (lazy)
  //   and overlays the country-scoped categories without re-painting
  //   the rest of the page. The full payload is cached per country.
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [countryData, setCountryData] = useState(null); // payload of the country-filtered fetch
  const [countryLoading, setCountryLoading] = useState(false);

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
          <div className="text-[11px] text-muted text-right">
            <div className="font-semibold text-foreground">As of</div>
            <div>{_fmtRange([data.as_of, data.as_of]).split(" – ")[0]}</div>
            <div className="mt-1">Auto-refreshing daily · ends yesterday</div>
          </div>
        </div>
      </div>

      {/* SECTION 1 — Top KPI scorecard */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard testId="kpi-revenue"   label="Total Revenue"        icon={TrendUp}       fmt={fmtKES} ytd={k("revenue").ytd}   mtd={k("revenue").mtd} />
        <KpiCard testId="kpi-units"     label="Units Sold"           icon={Package}                   ytd={k("units").ytd}     mtd={k("units").mtd} />
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
            return (
              <CountryCard
                key={c.country}
                ytd={c}
                mtd={mtdCountry}
                selected={selectedCountry === c.country}
                onClick={() => setSelectedCountry((cur) => cur === c.country ? null : c.country)}
              />
            );
          })}
        </div>
      </div>

      {/* SECTION 2 — Store performance */}
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

      {/* SECTION 4 — YTD vs Yearly Target (2026 budget) */}
      <YearlyTargets
        targets={data.targets}
        ytdCountries={data.ytd.countries}
        ytdKpis={data.ytd.kpis}
      />

      {/* SECTION 5 — Stock Mix: what's selling vs what we have */}
      <StockMix stockMix={data.stock_mix} />

      {/* SECTION 6 — What's Hot / What's Not narrative banner (moved
          to the bottom per leadership pref so the data scorecard reads
          first and the narrative call-out closes the page). */}
      <HotNotCallout
        subcategories={catSource.mtd.categories.subcategories}
        view="mtd"
      />
    </div>
  );
};

export default ExecutiveSummary;
