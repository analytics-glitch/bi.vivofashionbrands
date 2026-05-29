import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, Empty, SectionTitle } from "@/components/common";
import { useTableSort, SortableTh } from "@/lib/useTableSort";
import { categoryFor } from "@/lib/productCategory";
import {
  ArrowUp, ArrowDown, Minus, Warning,
  TrendUp, Footprints, Coins, UsersThree, UserPlus, ArrowsClockwise,
  Briefcase,
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
  const fmtVal = fmt || ((v) => fmtNum(Math.round(v)));
  return (
    <div className="flex items-center justify-between gap-2 text-[11.5px]">
      <span className="text-muted shrink-0 w-[58px]">{label}</span>
      <span className="font-bold tabular-nums">{fmtVal(cur || 0)}</span>
      <DeltaPill value={delta} size="sm" />
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
          <CountryMetricRow label="Orders"                  cur={ytd?.orders?.cur}     ly={ytd?.orders?.ly}     delta={ytd?.orders?.delta_pct} />
          <CountryMetricRow label="Footfall"                cur={ytd?.footfall?.cur}   ly={ytd?.footfall?.ly}   delta={ytd?.footfall?.delta_pct} />
          <CountryMetricRow label="Basket"   fmt={fmtKES}  cur={ytd?.avg_basket?.cur} ly={ytd?.avg_basket?.ly} delta={ytd?.avg_basket?.delta_pct} />
        </div>
        <div className="h-px bg-border/60" />
        <div data-testid={`exec-country-${country}-mtd`}>
          <div className="text-[9.5px] uppercase font-bold text-muted tracking-widest mb-1">MTD</div>
          <CountryMetricRow label="Revenue"   fmt={fmtKES} cur={mtd?.revenue?.cur}    ly={mtd?.revenue?.ly}    delta={mtd?.revenue?.delta_pct} />
          <CountryMetricRow label="Orders"                  cur={mtd?.orders?.cur}     ly={mtd?.orders?.ly}     delta={mtd?.orders?.delta_pct} />
          <CountryMetricRow label="Footfall"                cur={mtd?.footfall?.cur}   ly={mtd?.footfall?.ly}   delta={mtd?.footfall?.delta_pct} />
          <CountryMetricRow label="Basket"   fmt={fmtKES}  cur={mtd?.avg_basket?.cur} ly={mtd?.avg_basket?.ly} delta={mtd?.avg_basket?.delta_pct} />
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

  const { sort, toggleSort, sortRows } = useTableSort();
  const displayed = sort ? sortRows(filtered, {
    channel: (r) => r.channel,
    mtd_cur: (r) => r.mtd_cur,
    mtd_ly: (r) => r.mtd_ly,
    mtd_delta: (r) => (r.mtd_delta == null ? 9999 : r.mtd_delta),
    ytd_cur: (r) => r.ytd_cur,
    ytd_ly: (r) => r.ytd_ly,
    ytd_delta: (r) => (r.ytd_delta == null ? 9999 : r.ytd_delta),
  }) : filtered;

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
            <SortableTh sortKey="mtd_ly" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">MTD LY</SortableTh>
            <SortableTh sortKey="mtd_delta" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">MTD Δ%</SortableTh>
            <SortableTh sortKey="ytd_cur" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">YTD Revenue</SortableTh>
            <SortableTh sortKey="ytd_ly" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">YTD LY</SortableTh>
            <SortableTh sortKey="ytd_delta" sort={sort} onSort={toggleSort} numeric className="px-3 py-2.5 font-semibold whitespace-nowrap">YTD Δ%</SortableTh>
          </tr>
        </thead>
        <tbody>
          {displayed.map((r) => {
            const dot =
              r.mtd_delta == null ? "bg-muted"
                : r.mtd_delta < 0 ? "bg-rose-500"
                : "bg-emerald-500";
            const needsAttention = r.mtd_delta != null && r.mtd_delta < -10;
            return (
              <tr key={r.channel} className={`border-t border-border/50 ${rowTone(r.mtd_delta)}`} data-testid={`exec-store-row-${r.channel}`}>
                <td className="px-2 py-2"><span className={`inline-block w-2 h-2 rounded-full ${dot}`} title={r.mtd_delta == null ? "no comparison data" : r.mtd_delta < 0 ? "down vs LY" : "up vs LY"} /></td>
                <td className="px-3 py-2 font-semibold whitespace-nowrap">
                  {needsAttention && <Warning size={13} weight="fill" className="inline -mt-0.5 mr-1 text-rose-600" data-testid={`exec-store-warn-${r.channel}`} />}
                  {r.channel}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtKES(r.mtd_cur)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtKES(r.mtd_ly)}</td>
                <td className="px-3 py-2 text-right"><DeltaPill value={r.mtd_delta} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtKES(r.ytd_cur)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtKES(r.ytd_ly)}</td>
                <td className="px-3 py-2 text-right"><DeltaPill value={r.ytd_delta} /></td>
              </tr>
            );
          })}
        </tbody>
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
const CategoryBars = ({ subcategories, view }) => {
  // Roll up subcategories → top-level category via shared productCategory map.
  const cats = useMemo(() => {
    const buckets = new Map();
    for (const sc of subcategories || []) {
      const cat = categoryFor(sc.subcategory) || "Other";
      const b = buckets.get(cat) || { name: cat, cur: 0, ly: 0 };
      b.cur += sc.cur || 0;
      b.ly += sc.ly || 0;
      buckets.set(cat, b);
    }
    const arr = Array.from(buckets.values()).map((b) => ({
      ...b,
      delta_pct: b.ly ? ((b.cur - b.ly) / b.ly) * 100 : null,
    }));
    arr.sort((a, b) => b.cur - a.cur);
    return arr;
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
          <div key={c.name} className="grid grid-cols-[120px_1fr_72px] items-center gap-2.5">
            <div className="text-[11.5px] font-semibold truncate" title={c.name}>{c.name}</div>
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
              <DeltaPill value={c.delta_pct} />
            </div>
          </div>
        );
      })}
      <div className="text-[10px] text-muted mt-2 flex items-center gap-3">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-brand" /> {view === "ytd" ? "YTD" : "MTD"} current</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-brand/30" /> Same period last year</span>
      </div>
    </div>
  );
};

/**
 * TopSubcategories — top-10 list with inline delta. Each row's right
 * edge shows a sparkline-style bar comparing current to LY width-wise
 * (filled by ratio of LY-to-Cur or Cur-to-LY, whichever is larger).
 */
const TopSubcategories = ({ subcategories }) => {
  const top10 = useMemo(
    () => (subcategories || []).slice(0, 10),
    [subcategories]
  );
  const max = useMemo(
    () => Math.max(1, ...top10.flatMap((sc) => [sc.cur, sc.ly])),
    [top10]
  );
  if (!top10.length) return <Empty label="No subcategory data." />;
  return (
    <ol className="space-y-2" data-testid="exec-top-subcategories">
      {top10.map((sc, i) => {
        const curPct = (sc.cur / max) * 100;
        const positive = (sc.delta_pct ?? 0) >= 0;
        const barColor = positive ? "bg-emerald-500" : "bg-rose-500";
        const needsAttention = sc.delta_pct != null && sc.delta_pct < -10;
        return (
          <li key={sc.subcategory} className="grid grid-cols-[18px_1fr_56px] items-center gap-2 text-[12px]" data-testid={`exec-top-subcat-${i}`}>
            <span className="text-muted font-bold tabular-nums text-[11px]">{i + 1}</span>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold truncate" title={sc.subcategory}>
                  {needsAttention && <Warning size={11} weight="fill" className="inline -mt-0.5 mr-1 text-rose-600" />}
                  {sc.subcategory}
                </span>
                <span className="text-[10.5px] text-muted tabular-nums shrink-0">{fmtKES(sc.cur)}</span>
              </div>
              <div className="relative h-1.5 bg-panel rounded mt-1">
                <div className={`absolute inset-y-0 left-0 ${barColor} rounded`} style={{ width: `${curPct}%` }} />
              </div>
            </div>
            <div className="text-right"><DeltaPill value={sc.delta_pct} /></div>
          </li>
        );
      })}
    </ol>
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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard testId="kpi-revenue"   label="Total Revenue"        icon={TrendUp}       fmt={fmtKES} ytd={k("revenue").ytd}   mtd={k("revenue").mtd} />
        <KpiCard testId="kpi-footfall"  label="Footfall"             icon={Footprints}                ytd={k("footfall").ytd}  mtd={k("footfall").mtd} />
        <KpiCard testId="kpi-basket"    label="Avg Basket"           icon={Coins}         fmt={fmtKES} ytd={k("avg_basket").ytd} mtd={k("avg_basket").mtd} />
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
                Top-level rollup vs same period last year, plus top 10 subcategories.
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div data-testid="exec-cat-bars-pane">
            <div className="text-[11px] font-bold uppercase text-muted mb-2 tracking-wider">Revenue by Category — {catView.toUpperCase()}</div>
            <CategoryBars subcategories={catSource[catView].categories.subcategories} view={catView} />
          </div>
          <div data-testid="exec-top-subcats-pane">
            <div className="text-[11px] font-bold uppercase text-muted mb-2 tracking-wider">Top 10 Subcategories — {catView.toUpperCase()}</div>
            <TopSubcategories subcategories={catSource[catView].categories.subcategories} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExecutiveSummary;
