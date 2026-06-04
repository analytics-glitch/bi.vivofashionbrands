import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import MultiSelect from "@/components/MultiSelect";
import SortableTable from "@/components/SortableTable";
import WeeklySORHeatmap from "@/components/range-mgmt/WeeklySORHeatmap";
import {
  Stack,
  MagnifyingGlass,
  DownloadSimple,
  ArrowUp,
  ArrowDown,
  Warning,
} from "@phosphor-icons/react";

// Tier colour tokens — Gold / Green / Blue / Grey / Red per spec.
const TIER_STYLES = {
  "Tier 1": { bg: "#fef3c7", text: "#854d0e", label: "Tier 1 · Core Basics" },
  "Tier 2": { bg: "#dcfce7", text: "#166534", label: "Tier 2 · Core Performers" },
  "Tier 3": { bg: "#dbeafe", text: "#1e40af", label: "Tier 3 · Recent Performers" },
  "Tier 4": { bg: "#f1f5f9", text: "#334155", label: "Tier 4 · New / Test" },
  "Retire": { bg: "#fee2e2", text: "#991b1b", label: "Retire" },
};

const RAG = {
  green: { bg: "bg-emerald-100", text: "text-emerald-800", label: "In range" },
  amber: { bg: "bg-amber-100",   text: "text-amber-800",   label: "Near range" },
  red:   { bg: "bg-rose-100",    text: "text-rose-800",    label: "Out of range" },
};

const STATUS_TONES = {
  "On Track": { bg: "bg-emerald-50",  text: "text-emerald-700" },
  "At Risk":  { bg: "bg-amber-50",    text: "text-amber-700" },
  "Overdue":  { bg: "bg-rose-50",     text: "text-rose-700" },
  "Retire":   { bg: "bg-rose-100",    text: "text-rose-800" },
};

const TierPill = ({ tier }) => {
  const t = TIER_STYLES[tier] || TIER_STYLES["Tier 4"];
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap"
      style={{ background: t.bg, color: t.text }}
      data-testid={`tier-pill-${tier?.replace(/\s+/g, "-")}`}
    >
      {tier}
    </span>
  );
};

const StatusPill = ({ status }) => {
  const t = STATUS_TONES[status] || STATUS_TONES["At Risk"];
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] font-bold ${t.bg} ${t.text}`}>
      {status}
    </span>
  );
};

// Iter 91q — Calculated-field formula reveal. Native `title` keeps the
// implementation cheap (no Radix Portal per cell, no perf hit on 1k+
// rows) while still supporting multi-line formulas via "\n". Pattern:
//   `<FormulaCell title={`Formula\n= …\n= …`}>display value</FormulaCell>`
// `\u00A0` (NBSP) keeps the underline tight against the value when it
// wraps. Renders with a subtle dotted underline so users discover the
// hover affordance without visual noise.
const FormulaCell = ({ title, children }) => (
  <span
    title={title}
    className="cursor-help underline decoration-dotted decoration-muted/40 underline-offset-2"
  >
    {children}
  </span>
);

// Numeric helpers used inside formula tooltip strings.
const _n = (v, dp = 0) =>
  v == null || isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp });
const _pct = (v, dp = 1) => (v == null ? "—" : `${Number(v).toFixed(dp)}%`);
const _kes = (v) => (v == null ? "—" : `KES ${_n(Math.round(v))}`);

// Per-row formula builders. Each returns a multi-line string used as
// the cell's `title` so hovering reveals the exact calculation with
// substituted row values — leadership pref Jun 2026.
const fmt = {
  reorders: (r) => {
    const age = Number(r.style_age_weeks) || 0;
    return [
      "Reorders ≈ floor(Style Age in weeks ÷ 12)",
      `= floor(${age.toFixed(1)} ÷ 12)`,
      `= ${r.reorder_count ?? 0}`,
      "",
      "Approximates open-buy cycles (~12 weeks each).",
    ].join("\n");
  },
  revenueLifetime: (r) => [
    "Revenue Since Launch = Σ gross sales across the style's entire history",
    `= ${_kes(r.sales_since_launch)}`,
    "",
    "Scope honours the page-level Country/Channel filter.",
  ].join("\n"),
  revenue6m: (r) => [
    "Revenue (6m) = Σ gross sales in the last 180 days",
    `= ${_kes(r.sales_6m)}`,
  ].join("\n"),
  unitsLifetime: (r) => [
    "Units Since Launch = Σ units sold across the style's entire history",
    `= ${_n(r.units_since_launch)} units`,
  ].join("\n"),
  units6m: (r) => [
    "Units (6m) = Σ units sold in the last 180 days",
    `= ${_n(r.units_6m)} units`,
  ].join("\n"),
  sorLifetime: (r) => {
    const u = Number(r.units_since_launch) || 0;
    const stk = Number(r.current_stock) || 0;
    const denom = u + stk;
    return [
      "SOR Since Launch = Units Sold ÷ (Units Sold + Current Stock) × 100",
      `= ${_n(u)} ÷ (${_n(u)} + ${_n(stk)}) × 100`,
      `= ${_n(u)} ÷ ${_n(denom)} × 100`,
      `= ${_pct(r.sor_since_launch)}`,
    ].join("\n");
  },
  sor6m: (r) => {
    const u = Number(r.units_6m) || 0;
    const stk = Number(r.current_stock) || 0;
    const denom = u + stk;
    return [
      "SOR (6m) = Units Sold in 6m ÷ (Units Sold in 6m + Stock) × 100",
      `= ${_n(u)} ÷ (${_n(u)} + ${_n(stk)}) × 100`,
      `= ${_n(u)} ÷ ${_n(denom)} × 100`,
      `= ${_pct(r.sor_6m)}`,
    ].join("\n");
  },
  woc: (r) => {
    const stk = Number(r.current_stock) || 0;
    const wa = Number(r.weekly_avg) || 0;
    const units30d = +(wa * (30 / 7)).toFixed(0);
    return [
      "Weeks of Cover = Stock ÷ (Sold in 30d ÷ 4.3 weeks)",
      `= ${_n(stk)} ÷ (${_n(units30d)} ÷ 4.3)`,
      `= ${_n(stk)} ÷ ${_n(wa, 1)} units/week`,
      r.woc == null ? "= — (no recent sales)" : `= ${Number(r.woc).toFixed(1)} weeks`,
    ].join("\n");
  },
  age: (r) => [
    "Age (weeks) = (Today − Launch Date) ÷ 7",
    r.launch_date ? `= (Today − ${r.launch_date}) ÷ 7` : "= insufficient data",
    `= ${_n(r.style_age_weeks, 1)} weeks`,
  ].join("\n"),
  avgPrice: (r) => {
    const u = Number(r.units_since_launch) || 0;
    const sales = Number(r.sales_since_launch) || 0;
    return [
      "Avg Price (Kenya) = Revenue Since Launch ÷ Units Since Launch",
      `= ${_kes(sales)} ÷ ${_n(u)} units`,
      `= ${_kes(r.avg_price_since_launch)}`,
    ].join("\n");
  },
  fullPrice: (r) => [
    "Full Price (Kenya) = unit price of the FIRST Kenya sale for this style_number",
    `= ${_kes(r.original_price)}`,
    "",
    "Falls back to upstream MSRP when no historical Kenya observation exists.",
  ].join("\n"),
  fpPct: (r) => {
    const asp = Number(r.avg_price_since_launch || r.asp_6m) || 0;
    const fp = Number(r.original_price) || 0;
    return [
      "FP % = Avg Price ÷ Full Price × 100 (capped 100%)",
      fp > 0 ? `= ${_kes(asp)} ÷ ${_kes(fp)} × 100` : "= — (no full price recorded)",
      `= ${r.full_price_pct == null ? "—" : `${Number(r.full_price_pct).toFixed(0)}%`}`,
    ].join("\n");
  },
};

// Iter 91u — extended card.
// Iter 91v — also surfaces SOR % per bucket.
const TierKpiCard = ({ tier, count, pctStyles, revenueLifetime, unitsLifetime, sorPct, target, rag, testId, onClick, tone: customTone }) => {
  const tone = RAG[rag] || RAG.amber;
  const t = customTone || TIER_STYLES[tier] || TIER_STYLES["Tier 4"];
  const [lo, hi] = target || [0, 0];
  const isRetired = tier === "Retired";
  const isAgg = tier === "Total" || tier === "Active" || isRetired;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl p-4 border text-left hover:shadow-md transition-shadow cursor-pointer"
      style={{ background: t.bg, borderColor: t.text + "22" }}
      data-testid={testId}
    >
      <div className="text-[10.5px] uppercase tracking-wide font-bold" style={{ color: t.text, opacity: 0.7 }}>
        {tier}
      </div>
      <div className="font-extrabold mt-1 num leading-none" style={{ color: t.text, fontSize: "26px" }}>
        {fmtNum(count)}
      </div>
      <div className="mt-0.5 text-[10.5px]" style={{ color: t.text, opacity: 0.85 }}>
        {pctStyles == null ? "—" : `${pctStyles.toFixed(1)}% of styles`}
      </div>
      <div className="mt-2 space-y-0.5 text-[10.5px]" style={{ color: t.text }}>
        <div className="flex justify-between">
          <span style={{ opacity: 0.7 }}>Revenue</span>
          <span className="font-semibold num">KES {fmtNum(Math.round(revenueLifetime || 0))}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ opacity: 0.7 }}>Units</span>
          <span className="font-semibold num">{fmtNum(unitsLifetime || 0)}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ opacity: 0.7 }}>SOR</span>
          <span className="font-semibold num">{sorPct == null ? "—" : `${sorPct.toFixed(1)}%`}</span>
        </div>
      </div>
      {!isAgg && (
        <>
          <div className="mt-1.5 text-[10.5px]" style={{ color: t.text, opacity: 0.85 }}>
            Target: {lo}–{hi}
          </div>
          <div className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${tone.bg} ${tone.text}`}>
            {tone.label}
          </div>
        </>
      )}
    </button>
  );
};

const RangeManagement = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { countries, channels, dataVersion } = applied;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Iter 89w-f — bulk-promote workflow state.  Declared up-top so the
  // data-fetch useEffect below can react to `refreshToken` changes.
  const [promoting, setPromoting] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  // Filters
  const [tierFilter, setTierFilter] = useState([]);
  const [brandFilter, setBrandFilter] = useState([]);
  const [subcatFilter, setSubcatFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  // Iter 91u — drill-down modal state: when set to a tier name, the
  // modal renders the top performing styles for that tier (or the
  // physically-retired list when set to "Retired").
  const [drillTier, setDrillTier] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const countryCsv = countries.length ? countries.map((c) => c.toLowerCase()).join(",") : undefined;
    const locationsCsv = channels.length ? channels.join(",") : undefined;
    api
      .get("/range-mgmt/classify", { params: { country: countryCsv, channel: locationsCsv } })
      .then((r) => {
        if (cancelled) return;
        setData(r.data || null);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [JSON.stringify(countries), JSON.stringify(channels), dataVersion, refreshToken]);

  const rows = data?.rows || [];
  const summary = data?.summary;
  const retirement = data?.retirement_pipeline || [];
  const movements = data?.recent_movements || [];
  const candidates = data?.tier3_graduation_candidates || [];

  const promoteAllCandidates = async () => {
    if (!candidates.length) return;
    const n = candidates.length;
    const ok = window.confirm(
      `Promote ${n} Tier 3 style${n === 1 ? "" : "s"} to Tier 2?\n\n` +
      `This sets a manual override that survives across classifier runs. ` +
      `You can revert any individual style later via the API.`,
    );
    if (!ok) return;
    setPromoting(true);
    try {
      const r = await api.post("/range-mgmt/overrides/bulk-promote", {
        style_names: candidates.map((c) => c.style_name),
        override_tier: "Tier 2",
        reason: "Bulk graduation from Range Mgmt UI",
      });
      setRefreshToken((x) => x + 1);
      window.alert(`Promoted ${r.data?.upserted ?? n} styles to Tier 2.`);
    } catch (e) {
      window.alert("Bulk promote failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setPromoting(false);
    }
  };

  // Iter 91v — Promote a single style row via the candidates table.
  // Mirrors the bulk-promote API but for one style at a time so the
  // user can graduate selectively (e.g., promote the top performer
  // immediately, hold off on the bottom of the list).
  const [promotingOne, setPromotingOne] = useState(null); // style_name during in-flight
  const promoteOne = async (styleName) => {
    const ok = window.confirm(`Promote "${styleName}" to Tier 2?`);
    if (!ok) return;
    setPromotingOne(styleName);
    try {
      await api.post("/range-mgmt/overrides/bulk-promote", {
        style_names: [styleName],
        override_tier: "Tier 2",
        reason: "Individual promote from Range Mgmt UI",
      });
      setRefreshToken((x) => x + 1);
    } catch (e) {
      window.alert("Promote failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setPromotingOne(null);
    }
  };

  const brandOpts   = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort(), [rows]);
  const subcatOpts  = useMemo(() => [...new Set(rows.map((r) => r.subcategory).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    if (!rows.length) return [];
    const tSet = tierFilter.length ? new Set(tierFilter) : null;
    const bSet = brandFilter.length ? new Set(brandFilter) : null;
    const sSet = subcatFilter.length ? new Set(subcatFilter) : null;
    const stSet = statusFilter.length ? new Set(statusFilter) : null;
    return rows.filter((r) => {
      if (tSet && !tSet.has(r.tier)) return false;
      if (bSet && !bSet.has(r.brand)) return false;
      if (sSet && !sSet.has(r.subcategory)) return false;
      if (stSet && !stSet.has(r.status)) return false;
      if (search) {
        const blob = `${r.style_name || ""}\t${r.brand || ""}\t${r.subcategory || ""}`.toLowerCase();
        if (!blob.includes(search)) return false;
      }
      return true;
    });
  }, [rows, tierFilter, brandFilter, subcatFilter, statusFilter, search]);

  const exportCsv = () => {
    const cols = [
      ["style_name", "Style"],
      ["brand", "Brand"],
      ["subcategory", "Subcategory"],
      ["tier", "Tier"],
      ["status", "Status"],
      ["style_age_weeks", "Age (weeks)"],
      ["lifetime_sor_pct", "Lifetime SOR %"],
      ["woc", "WOC"],
      ["last_sale_days", "Last Sale (days)"],
      ["reorder_count", "Reorder Count"],
      ["full_price_pct", "Full Price %"],
      ["current_stock", "Current Stock"],
      ["style_number", "Style Number"],
      ["units_since_launch", "Units Since Launch"],
      ["sales_since_launch", "Revenue Since Launch (KES)"],
      ["original_price", "Full Price (Kenya)"],
      ["avg_price_since_launch", "Avg Price (Kenya)"],
      ["units_6m", "Units (6m)"],
      ["sales_6m", "Revenue (6m)"],
      ["sor_since_launch", "SOR Since Launch %"],
      ["sor_6m", "SOR (6m) %"],
      ["weekly_avg", "Weekly Avg"],
      ["launch_date", "Launch Date"],
      ["recommended_action", "Recommended Action"],
    ];
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map(([, h]) => h).join(",")];
    for (const r of filtered) lines.push(cols.map(([k]) => esc(r[k])).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `range-tier-classification-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const totalTarget = summary?.targets?.total || [500, 700];
  const totalProgress = summary ? Math.min(100, (summary.total_active_styles / totalTarget[1]) * 100) : 0;

  return (
    <div className="space-y-5" data-testid="range-mgmt-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Dashboard · Range Management</div>
          <h1
            className="font-extrabold tracking-tight mt-1 leading-[1.15]"
            style={{ fontSize: "clamp(15px, 1.6vw, 22px)" }}
          >
            Range Management — Product Tiers
          </h1>
          <p className="text-muted text-[13px] mt-0.5">
            Vivo 4-Tier Framework · Target: <span className="font-semibold text-foreground">{totalTarget[0]}–{totalTarget[1]} active styles</span>
            <> · updated <span className="font-semibold text-foreground">{new Date().toLocaleTimeString()}</span></>
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!filtered.length}
          data-testid="range-csv-btn"
          className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
        >
          <DownloadSimple size={14} weight="bold" />
          Download CSV ({fmtNum(filtered.length)} rows)
        </button>
      </div>

      {loading && <Loading label="Classifying every active style…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && summary && (
        <>
          {/* Section 1 — Summary banner */}
          <div className="card-white p-4 space-y-3" data-testid="range-summary-banner">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="eyebrow text-[10.5px] mb-0.5">Total active styles</div>
                <div className="flex items-baseline gap-3">
                  <span className="font-extrabold text-[28px] num leading-none">{fmtNum(summary.total_active_styles)}</span>
                  <span className="text-muted text-[12px]">
                    target {totalTarget[0]}–{totalTarget[1]}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${RAG[summary.rag?.total]?.bg || ""} ${RAG[summary.rag?.total]?.text || ""}`}>
                    {RAG[summary.rag?.total]?.label || "—"}
                  </span>
                </div>
                <div className="h-1.5 mt-2 w-[280px] rounded-full bg-panel overflow-hidden">
                  <div
                    className="h-full bg-brand transition-all"
                    style={{ width: `${totalProgress}%` }}
                    data-testid="range-progress-bar"
                  />
                </div>
              </div>
              <div className="flex gap-3 text-[12px] flex-wrap">
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5">
                  <div className="text-rose-700 font-bold num text-[18px] leading-none">{fmtNum(summary.flagged_for_retirement)}</div>
                  <div className="text-rose-700/80 text-[10.5px]">Flagged for retirement</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5">
                  <div className="text-amber-800 font-bold num text-[18px] leading-none">{fmtNum(summary.overdue_for_week8_read)}</div>
                  <div className="text-amber-800/80 text-[10.5px]">Overdue Week-8 read</div>
                </div>
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5">
                  <div className="text-sky-800 font-bold num text-[18px] leading-none">{fmtNum(summary.approaching_decision_gates)}</div>
                  <div className="text-sky-800/80 text-[10.5px]">Approaching gate</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3" data-testid="tier-kpi-row">
              {/* Iter 91v — Total + Active aggregate cards (left) */}
              <TierKpiCard
                key="Total"
                tier="Total"
                count={summary.tier_summary?.Total?.count ?? 0}
                pctStyles={summary.tier_summary?.Total?.pct_styles}
                revenueLifetime={summary.tier_summary?.Total?.revenue_lifetime}
                unitsLifetime={summary.tier_summary?.Total?.units_lifetime}
                sorPct={summary.tier_summary?.Total?.sor_lifetime_pct}
                tone={{ bg: "#e0e7ff", text: "#1e3a8a", label: "Total" }}
                testId="tier-card-Total"
                onClick={() => setDrillTier("Total")}
              />
              <TierKpiCard
                key="Active"
                tier="Active"
                count={summary.tier_summary?.Active?.count ?? 0}
                pctStyles={summary.tier_summary?.Active?.pct_styles}
                revenueLifetime={summary.tier_summary?.Active?.revenue_lifetime}
                unitsLifetime={summary.tier_summary?.Active?.units_lifetime}
                sorPct={summary.tier_summary?.Active?.sor_lifetime_pct}
                tone={{ bg: "#dcfce7", text: "#14532d", label: "Active" }}
                testId="tier-card-Active"
                onClick={() => setDrillTier("Active")}
              />
              {["Tier 1", "Tier 2", "Tier 3", "Tier 4"].map((t) => {
                const ts = summary.tier_summary?.[t] || {};
                return (
                  <TierKpiCard
                    key={t}
                    tier={t}
                    count={ts.count ?? summary.tier_counts?.[t] ?? 0}
                    pctStyles={ts.pct_styles}
                    revenueLifetime={ts.revenue_lifetime}
                    unitsLifetime={ts.units_lifetime}
                    sorPct={ts.sor_lifetime_pct}
                    target={summary.targets?.[t]}
                    rag={summary.rag?.[t]}
                    testId={`tier-card-${t.replace(/\s+/g, "-")}`}
                    onClick={() => setDrillTier(t)}
                  />
                );
              })}
              <TierKpiCard
                key="Retired"
                tier="Retired"
                count={summary.tier_summary?.Retired?.count ?? 0}
                pctStyles={summary.tier_summary?.Retired?.pct_styles}
                revenueLifetime={summary.tier_summary?.Retired?.revenue_lifetime}
                unitsLifetime={summary.tier_summary?.Retired?.units_lifetime}
                sorPct={summary.tier_summary?.Retired?.sor_lifetime_pct}
                tone={{ bg: "#fecaca", text: "#7f1d1d", label: "Retired" }}
                testId="tier-card-Retired"
                onClick={() => setDrillTier("Retired")}
              />
            </div>
            {/* Iter 89w-f — data-ceiling footer note */}
            <p
              className="text-[11px] text-muted mt-2 leading-snug"
              data-testid="range-data-ceiling-note"
            >
              <strong>Note on age:</strong> Style age is computed from the persisted first-sale
              date in <code className="text-[10px]">style_launch_dates_by_number</code> + the by-name
              fallback collection, which together cover the last 5 years of Kenya trading history
              (refreshed nightly). Tier assignments now reflect true catalog age — Tier 1 (24+ months
              core), Tier 2 (9–24 months), Tier 3 (3–9 months under review), Tier 4 (&lt; 3 months
              new). Use the graduation panel above to promote ready styles manually.
            </p>
          </div>

          {/* Section 1.5 — Tier 3 → Tier 2 graduation candidates */}
          {candidates.length > 0 && (
            <div
              className="card-white p-4 border-l-4"
              style={{ borderLeftColor: "#1e40af" }}
              data-testid="range-grad-candidates"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div>
                  <div className="eyebrow text-[10.5px] mb-0.5">Quick win · range health</div>
                  <h3 className="font-extrabold text-[15px] leading-tight">
                    {fmtNum(candidates.length)} Tier 3 styles ready to graduate to Tier 2
                  </h3>
                  <p className="text-muted text-[12px] mt-0.5">
                    Within 6 weeks of the 9-month gate AND already meeting all Tier 2 criteria
                    (reorders ≥ 3 · lifetime SOR &gt; 60 % · full price &gt; 90 %).
                    Promote these to clear the Tier 3 backlog (currently {fmtNum(summary?.tier_counts?.["Tier 3"] || 0)} vs target {summary?.targets?.["Tier 2"]?.[0]}–{summary?.targets?.["Tier 2"]?.[1]}).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={promoteAllCandidates}
                    disabled={promoting || !candidates.length}
                    data-testid="grad-promote-all-btn"
                    className="px-3 py-1 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-[11.5px] font-semibold disabled:opacity-50"
                    title="Sets a manual tier-2 override for every candidate"
                  >
                    {promoting
                      ? "Promoting…"
                      : `Promote all ${fmtNum(candidates.length)} to Tier 2`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTierFilter(["Tier 3"]);
                      document
                        .querySelector('[data-testid="range-table-card"]')
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                    data-testid="grad-candidates-jump-btn"
                    className="px-3 py-1 rounded-lg border border-border text-[11.5px] font-semibold hover:bg-panel"
                  >
                    See all Tier 3 →
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse" data-testid="grad-candidates-table">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-2 font-semibold text-muted">Style</th>
                      <th className="p-2 font-semibold text-muted">Subcategory</th>
                      <th className="p-2 font-semibold text-muted text-right">Weeks to gate</th>
                      <th className="p-2 font-semibold text-muted text-right">Lifetime SOR</th>
                      <th className="p-2 font-semibold text-muted text-right">FP %</th>
                      <th className="p-2 font-semibold text-muted text-right">Reorders</th>
                      <th className="p-2 font-semibold text-muted text-right">Stock</th>
                      <th className="p-2 font-semibold text-muted text-right">Last sale</th>
                      <th className="p-2 font-semibold text-muted text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.slice(0, 12).map((c, i) => (
                      <tr key={`${c.style_name}-${i}`} className="border-b border-border">
                        <td className="p-2">
                          <div className="font-medium truncate max-w-[260px]" title={c.style_name}>{c.style_name}</div>
                          <div className="text-muted text-[10.5px]">{c.brand}</div>
                        </td>
                        <td className="p-2 text-muted">{c.subcategory || "—"}</td>
                        <td className="p-2 text-right num">
                          <span className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-sky-100 text-sky-800">
                            {c.weeks_to_gate}w
                          </span>
                        </td>
                        <td className="p-2 text-right num text-emerald-700 font-semibold">
                          {c.lifetime_sor_pct == null ? "—" : `${c.lifetime_sor_pct.toFixed(1)}%`}
                        </td>
                        <td className="p-2 text-right num">
                          {c.full_price_pct == null ? "—" : `${c.full_price_pct.toFixed(0)}%`}
                        </td>
                        <td className="p-2 text-right num">{c.reorder_count}</td>
                        <td className="p-2 text-right num">{fmtNum(c.current_stock)}</td>
                        <td className="p-2 text-right num">{c.last_sale_days == null ? "—" : `${c.last_sale_days}d`}</td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={() => promoteOne(c.style_name)}
                            disabled={promotingOne === c.style_name}
                            className="px-2 py-0.5 rounded-md text-[10.5px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                            data-testid={`grad-promote-one-${i}`}
                          >
                            {promotingOne === c.style_name ? "…" : "Promote"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {candidates.length > 12 && (
                  <div className="text-center text-muted text-[11.5px] mt-2">
                    + {fmtNum(candidates.length - 12)} more candidates (use the Tier filter to see all)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="card-white p-3 flex flex-wrap items-end gap-2" data-testid="range-filters">
            <div className="flex items-center gap-2 input-pill flex-1 min-w-[260px]">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search style, brand or subcategory…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                data-testid="range-search"
                className="bg-transparent outline-none text-[13px] w-full"
              />
              {searchInput && (
                <button type="button" onClick={() => setSearchInput("")} className="text-muted hover:text-foreground text-[12px] px-1">Clear</button>
              )}
            </div>
            <div>
              <div className="eyebrow mb-1">Tier</div>
              <MultiSelect testId="range-filter-tier"
                options={["Tier 1", "Tier 2", "Tier 3", "Tier 4", "Retire"].map((t) => ({ value: t, label: t }))}
                value={tierFilter} onChange={setTierFilter} placeholder="All tiers" width={130} />
            </div>
            <div>
              <div className="eyebrow mb-1">Brand</div>
              <MultiSelect testId="range-filter-brand"
                options={brandOpts.map((b) => ({ value: b, label: b }))}
                value={brandFilter} onChange={setBrandFilter} placeholder="All brands" width={150} />
            </div>
            <div>
              <div className="eyebrow mb-1">Subcategory</div>
              <MultiSelect testId="range-filter-subcat"
                options={subcatOpts.map((s) => ({ value: s, label: s }))}
                value={subcatFilter} onChange={setSubcatFilter} placeholder="All subcats" width={200} />
            </div>
            <div>
              <div className="eyebrow mb-1">Status</div>
              <MultiSelect testId="range-filter-status"
                options={["On Track", "At Risk", "Overdue", "Retire"].map((s) => ({ value: s, label: s }))}
                value={statusFilter} onChange={setStatusFilter} placeholder="All statuses" width={160} />
            </div>
          </div>

          {/* Iter 91v — Tier filter pills above the table for quick-glance
              filtering. Reflects + drives the same `tierFilter` state as
              the MultiSelect above. Clicking a pill toggles its state. */}
          <div className="flex flex-wrap gap-2 mb-3" data-testid="tier-filter-pills">
            <button
              type="button"
              onClick={() => setTierFilter([])}
              className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                tierFilter.length === 0
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
              }`}
              data-testid="tier-pill-all"
            >
              All ({fmtNum(rows.length)})
            </button>
            {["Tier 1", "Tier 2", "Tier 3", "Tier 4", "Retire"].map((t) => {
              const active = tierFilter.includes(t);
              const count = summary?.tier_counts?.[t] ?? 0;
              const style = TIER_STYLES[t] || TIER_STYLES["Tier 4"];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    setTierFilter((prev) =>
                      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                    )
                  }
                  className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                    active ? "ring-2 ring-offset-1 ring-slate-900" : "hover:opacity-80"
                  }`}
                  style={{ background: style.bg, color: style.text, borderColor: style.text + "33" }}
                  data-testid={`tier-pill-${t.replace(/\s+/g, "-")}`}
                >
                  {t} ({fmtNum(count)})
                </button>
              );
            })}
          </div>

          {/* Section 2 — Classification table */}
          <div className="card-white p-5" data-testid="range-table-card">
            <SectionTitle
              title={`Tier Classification · ${fmtNum(filtered.length)} of ${fmtNum(rows.length)}`}
              subtitle="Auto-classified per the Vivo Product SOP — sort by SOR / WOC / Age / Status."
            />
            {filtered.length === 0 ? (
              <Empty label="No styles match the current filters." />
            ) : (
              <SortableTable
                testId="range-table"
                initialSort={{ key: "tier", dir: "asc" }}
                pageSize={75}
                columns={[
                  // Iter 91q — Column order per leadership spec
                  // (Jun 2026): identity → tier → cycles → revenue →
                  // units → sell-through → stock cover → dates →
                  // pricing → status. Calculated fields wrap their
                  // values in `FormulaCell` so a hover reveals the
                  // exact formula with substituted row values.
                  {
                    key: "style_name", label: "Style Name", align: "left",
                    render: (r) => (
                      <div className="max-w-[240px]">
                        <div className="font-medium truncate" title={r.style_name}>{r.style_name}</div>
                        <div className="text-[10.5px] text-muted">{r.brand}</div>
                      </div>
                    ),
                    csv: (r) => r.style_name,
                  },
                  { key: "style_number", label: "Style Number", align: "left",
                    render: (r) => <span className="font-mono text-[10.5px] text-muted">{r.style_number || "—"}</span> },
                  {
                    key: "tier", label: "Tier", align: "left",
                    render: (r) => (
                      <span className="inline-flex items-center gap-1">
                        <TierPill tier={r.tier} />
                        {r.auto_tier && r.auto_tier !== r.tier && (
                          <span
                            className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-violet-100 text-violet-800"
                            title={`Manual override · auto-tier was ${r.auto_tier}\n${r.override_reason || ""}`}
                            data-testid={`tier-override-badge-${r.style_name}`}
                          >
                            MANUAL
                          </span>
                        )}
                      </span>
                    ),
                  },
                  { key: "subcategory", label: "Subcategory", align: "left",
                    render: (r) => <span className="text-muted">{r.subcategory || "—"}</span> },
                  {
                    key: "reorder_count", label: "Reorders", numeric: true,
                    render: (r) => <FormulaCell title={fmt.reorders(r)}>{fmtNum(r.reorder_count)}</FormulaCell>,
                  },
                  { key: "sales_since_launch", label: "Revenue Since Launch", numeric: true,
                    render: (r) => r.sales_since_launch == null ? "—" : (
                      <FormulaCell title={fmt.revenueLifetime(r)}>{`KES ${fmtNum(Math.round(r.sales_since_launch))}`}</FormulaCell>
                    ) },
                  { key: "sales_6m", label: "Revenue (6m)", numeric: true,
                    render: (r) => r.sales_6m == null ? "—" : (
                      <FormulaCell title={fmt.revenue6m(r)}>{`KES ${fmtNum(Math.round(r.sales_6m))}`}</FormulaCell>
                    ) },
                  { key: "units_since_launch", label: "Units Since Launch", numeric: true,
                    render: (r) => <FormulaCell title={fmt.unitsLifetime(r)}>{fmtNum(r.units_since_launch)}</FormulaCell> },
                  { key: "units_6m", label: "Units (6m)", numeric: true,
                    render: (r) => <FormulaCell title={fmt.units6m(r)}>{fmtNum(r.units_6m)}</FormulaCell> },
                  { key: "sor_since_launch", label: "SOR Lifetime", numeric: true,
                    render: (r) => r.sor_since_launch == null ? "—" : (
                      <FormulaCell title={fmt.sorLifetime(r)}>{`${r.sor_since_launch.toFixed(1)}%`}</FormulaCell>
                    ) },
                  { key: "sor_6m", label: "SOR (6m)", numeric: true,
                    render: (r) => r.sor_6m == null ? "—" : (
                      <FormulaCell title={fmt.sor6m(r)}>{`${r.sor_6m.toFixed(1)}%`}</FormulaCell>
                    ) },
                  { key: "current_stock", label: "SoH", numeric: true, render: (r) => fmtNum(r.current_stock) },
                  // Iter 91q — Channel-split stock + units columns added
                  // per Jun 2026 leadership ask. Each one wraps a
                  // FormulaCell so hover reveals the source.
                  { key: "soh_stores", label: "Stock in Stores", numeric: true,
                    render: (r) => (
                      <FormulaCell title={`Stock in Stores = Σ available units across non-warehouse locations\n= ${fmtNum(r.soh_stores)} units`}>{fmtNum(r.soh_stores)}</FormulaCell>
                    ) },
                  { key: "soh_warehouse", label: "Stock in Warehouse", numeric: true,
                    render: (r) => (
                      <FormulaCell title={`Stock in Warehouse = Σ available units across warehouse / holding / staging locations\n= ${fmtNum(r.soh_warehouse)} units`}>{fmtNum(r.soh_warehouse)}</FormulaCell>
                    ) },
                  { key: "units_online", label: "Units Sold Online", numeric: true,
                    render: (r) => (
                      <FormulaCell title={`Units Sold Online (lifetime) = Σ units sold through the Online channel\n= ${fmtNum(r.units_online)} units`}>{fmtNum(r.units_online)}</FormulaCell>
                    ) },
                  { key: "units_stores", label: "Units Sold Stores", numeric: true,
                    render: (r) => (
                      <FormulaCell title={`Units Sold Stores (lifetime) = Σ units sold through Retail (in-store) channels\n= ${fmtNum(r.units_stores)} units`}>{fmtNum(r.units_stores)}</FormulaCell>
                    ) },
                  {
                    key: "woc", label: "WoC", numeric: true,
                    render: (r) => (
                      <FormulaCell title={fmt.woc(r)}>{r.woc == null ? "—" : r.woc.toFixed(1)}</FormulaCell>
                    ),
                  },
                  { key: "launch_date", label: "Launch Date", align: "left",
                    render: (r) => <span className="text-[11px]">{r.launch_date || "—"}</span> },
                  {
                    key: "style_age_weeks", label: "Age (wks)", numeric: true,
                    render: (r) => <FormulaCell title={fmt.age(r)}>{fmtNum(r.style_age_weeks)}</FormulaCell>,
                  },
                  { key: "original_price", label: "Full Price (Kenya)", numeric: true,
                    render: (r) => r.original_price == null ? "—" : (
                      <FormulaCell title={fmt.fullPrice(r)}>{`KES ${fmtNum(Math.round(r.original_price))}`}</FormulaCell>
                    ) },
                  { key: "avg_price_since_launch", label: "Avg Price (Kenya)", numeric: true,
                    render: (r) => r.avg_price_since_launch == null ? "—" : (
                      <FormulaCell title={fmt.avgPrice(r)}>{`KES ${fmtNum(Math.round(r.avg_price_since_launch))}`}</FormulaCell>
                    ) },
                  {
                    key: "full_price_pct", label: "FP %", numeric: true,
                    render: (r) => r.full_price_pct == null ? "—" : (
                      <FormulaCell title={fmt.fpPct(r)}>{`${r.full_price_pct.toFixed(0)}%`}</FormulaCell>
                    ),
                  },
                  {
                    key: "status", label: "Status", align: "left",
                    render: (r) => <StatusPill status={r.status} />,
                  },
                  {
                    key: "recommended_action", label: "Recommended Action", align: "left",
                    render: (r) => (
                      <span className="text-[11.5px] text-muted max-w-[300px] inline-block" title={r.recommended_action}>
                        {r.recommended_action}
                      </span>
                    ),
                  },
                ]}
                rows={filtered}
              />
            )}
          </div>

          {/* Section 3 — Tier movement tracker */}
          <div className="card-white p-5" data-testid="range-movement-tracker">
            <SectionTitle
              title={`Tier Movement Tracker · ${fmtNum(movements.length)} recent moves`}
              subtitle="Styles whose tier changed since the last classification pass. Up = graduation, down = demotion."
            />
            {movements.length === 0 ? (
              <Empty label="No tier movements yet — they'll appear here as styles graduate or get retired." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse" data-testid="movement-table">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-2 font-semibold text-muted">Style</th>
                      <th className="p-2 font-semibold text-muted">From</th>
                      <th className="p-2 font-semibold text-muted">To</th>
                      <th className="p-2 font-semibold text-muted">Direction</th>
                      <th className="p-2 font-semibold text-muted text-right">Age (wks)</th>
                      <th className="p-2 font-semibold text-muted text-right">Lifetime SOR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m, i) => (
                      <tr key={`${m.style_name}-${i}`} className="border-b border-border">
                        <td className="p-2">
                          <div className="font-medium">{m.style_name}</div>
                          <div className="text-muted text-[10.5px]">{m.brand} · {m.subcategory}</div>
                        </td>
                        <td className="p-2"><TierPill tier={m.from_tier} /></td>
                        <td className="p-2"><TierPill tier={m.to_tier} /></td>
                        <td className="p-2">
                          {m.direction === "up" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11.5px]">
                              <ArrowUp size={11} weight="bold" /> Graduated
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-semibold text-[11.5px]">
                              <ArrowDown size={11} weight="bold" /> Demoted
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-right num">{fmtNum(m.style_age_weeks)}</td>
                        <td className="p-2 text-right num">{m.lifetime_sor_pct == null ? "—" : `${m.lifetime_sor_pct.toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Iter 91q — Weekly SOR heatmap for new styles (< 14 wks) */}
          <WeeklySORHeatmap countries={countries} channels={channels} refreshToken={refreshToken} />

          {/* Section 4 — Retirement pipeline */}
          <div className="card-white p-5" data-testid="range-retirement-pipeline">
            <SectionTitle
              title={`Retirement Pipeline · ${fmtNum(retirement.length)} styles`}
              subtitle="Styles that missed their Week 8/12 gate or aged out without Tier 1 criteria. Outlet discount date follows the 4-week gap rule from the SOP."
            />
            {retirement.length === 0 ? (
              <Empty label="Nothing flagged for retirement. The range is healthy." />
            ) : (
              <SortableTable
                testId="retirement-pipeline-table"
                initialSort={{ key: "style_age_weeks", dir: "desc" }}
                pageSize={50}
                columns={[
                  {
                    key: "style_name", label: "Style", align: "left",
                    render: (r) => (
                      <div className="max-w-[240px]">
                        <div className="font-medium truncate" title={r.style_name}>{r.style_name}</div>
                        <div className="text-muted text-[10.5px]">{r.brand} · {r.subcategory}</div>
                      </div>
                    ),
                  },
                  { key: "style_age_weeks", label: "Age (wks)", numeric: true, render: (r) => fmtNum(r.style_age_weeks) },
                  {
                    key: "lifetime_sor_pct", label: "Lifetime SOR %", numeric: true,
                    render: (r) => r.lifetime_sor_pct == null ? "—" : `${r.lifetime_sor_pct.toFixed(1)}%`,
                  },
                  { key: "current_stock", label: "Remaining Stock", numeric: true, render: (r) => fmtNum(r.current_stock) },
                  {
                    key: "last_sale_days", label: "Last Sale", numeric: true,
                    render: (r) => r.last_sale_days == null ? "—" : `${r.last_sale_days}d`,
                  },
                  {
                    key: "recommended_retirement_date", label: "Recommended Retire", align: "left",
                    render: (r) => <span className="num text-rose-700 font-semibold">{r.recommended_retirement_date}</span>,
                  },
                  {
                    key: "outlet_discount_date", label: "Outlet Discount Date", align: "left",
                    render: (r) => <span className="num text-amber-700">{r.outlet_discount_date}</span>,
                  },
                  {
                    key: "reason", label: "Reason", align: "left",
                    render: (r) => <span className="text-muted text-[11.5px] max-w-[280px] inline-block" title={r.reason}>{r.reason}</span>,
                  },
                ]}
                rows={retirement}
              />
            )}
          </div>
        </>
      )}
      {/* Iter 91u — Tier drill-down modal */}
      {drillTier && (
        <TierDrillModal
          tier={drillTier}
          rows={
            drillTier === "Retired"
              ? (data?.retired_rows || [])
              : drillTier === "Active"
                ? (data?.rows || [])
                : drillTier === "Total"
                  ? ([...(data?.rows || []), ...(data?.retired_rows || [])])
                  : (data?.rows || []).filter((r) => r.tier === drillTier)
          }
          onClose={() => setDrillTier(null)}
        />
      )}
    </div>
  );
};

// Iter 91u — modal listing top-performing styles in the clicked tier.
// Sorts by lifetime revenue descending; shows the 8 columns most
// relevant to "how is this tier performing".
const TierDrillModal = ({ tier, rows, onClose }) => {
  const sorted = [...rows].sort(
    (a, b) => (b.sales_since_launch || 0) - (a.sales_since_launch || 0),
  );
  // Iter 91v — CSV export of the drill rows (top→bottom by revenue).
  // Saves the user from another export round-trip when they want to
  // share the tier breakdown via email/slack.
  const exportCsv = () => {
    const cols = [
      ["style_name", "Style"],
      ["style_number", "Style #"],
      ["brand", "Brand"],
      ["subcategory", "Subcategory"],
      ["tier", "Tier"],
      ["launch_date", "Launch Date"],
      ["style_age_weeks", "Age (weeks)"],
      ["units_since_launch", "Units Since Launch"],
      ["sales_since_launch", "Revenue Since Launch (KES)"],
      ["original_price", "Full Price (Kenya)"],
      ["avg_price_since_launch", "Avg Price (Kenya)"],
      ["lifetime_sor_pct", "SOR Lifetime %"],
      ["current_stock", "Current Stock"],
      ["woc", "Weeks of Cover"],
      ["last_sale_days", "Days Since Last Sale"],
    ];
    const esc = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.map((c) => c[1]).join(",");
    const body = sorted.map((r) => cols.map((c) => esc(r[c[0]])).join(",")).join("\n");
    const blob = new Blob([`\ufeff${header}\n${body}\n`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `range-mgmt-${tier.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="tier-drill-modal"
    >
      <div
        className="bg-white rounded-2xl max-w-6xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white">
          <div>
            <h3 className="font-extrabold text-[15px]" data-testid="tier-drill-title">{tier} · {fmtNum(sorted.length)} styles</h3>
            <p className="text-[11px] text-muted mt-0.5">Sorted by lifetime revenue. Click anywhere outside to close.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="px-3 py-1 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold hover:bg-emerald-800"
              data-testid="tier-drill-export"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:text-fg text-xl leading-none px-2"
              data-testid="tier-drill-close"
            >
              ×
            </button>
          </div>
        </div>
        <div className="p-3">
          {sorted.length === 0 ? (
            <p className="text-center text-muted py-8 text-[12px]">No styles in this tier.</p>
          ) : (
            <SortableTable
              testId="tier-drill-table"
              pageSize={50}
              initialSort={{ key: "sales_since_launch", dir: "desc" }}
              columns={[
                {
                  key: "style_name", label: "Style", align: "left",
                  render: (r) => (
                    <div className="max-w-[260px]">
                      <div className="font-medium truncate text-[11.5px]" title={r.style_name}>{r.style_name}</div>
                      <div className="text-muted text-[10px]">{r.brand} · {r.subcategory}</div>
                    </div>
                  ),
                },
                {
                  key: "style_number", label: "Style #", align: "left",
                  render: (r) => <span className="font-mono text-[10.5px] text-muted">{r.style_number || "—"}</span>,
                },
                { key: "launch_date", label: "Launch", align: "left",
                  render: (r) => <span className="text-[11px]">{r.launch_date || "—"}</span> },
                { key: "units_since_launch", label: "Units", numeric: true,
                  render: (r) => fmtNum(r.units_since_launch) },
                { key: "sales_since_launch", label: "Revenue", numeric: true,
                  render: (r) => r.sales_since_launch == null ? "—" : `KES ${fmtNum(Math.round(r.sales_since_launch))}` },
                { key: "lifetime_sor_pct", label: "SOR %", numeric: true,
                  render: (r) => r.lifetime_sor_pct == null ? "—" : `${r.lifetime_sor_pct.toFixed(1)}%` },
                { key: "current_stock", label: "Stock", numeric: true,
                  render: (r) => fmtNum(r.current_stock) },
                // Iter 91q — channel-split columns also surface in the
                // tier drill-down modal so leadership can act on
                // sub-segments (e.g. retire heavy-warehouse styles).
                { key: "soh_stores", label: "Stock Stores", numeric: true,
                  render: (r) => fmtNum(r.soh_stores) },
                { key: "soh_warehouse", label: "Stock Warehouse", numeric: true,
                  render: (r) => fmtNum(r.soh_warehouse) },
                { key: "units_online", label: "Units Online", numeric: true,
                  render: (r) => fmtNum(r.units_online) },
                { key: "units_stores", label: "Units Stores", numeric: true,
                  render: (r) => fmtNum(r.units_stores) },
                { key: "last_sale_days", label: "Last Sale", numeric: true,
                  render: (r) => r.last_sale_days == null ? "—" : `${r.last_sale_days}d` },
              ]}
              rows={sorted}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RangeManagement;
