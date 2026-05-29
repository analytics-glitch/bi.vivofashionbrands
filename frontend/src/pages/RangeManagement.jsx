import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import MultiSelect from "@/components/MultiSelect";
import SortableTable from "@/components/SortableTable";
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

const TierKpiCard = ({ tier, count, target, rag, testId }) => {
  const tone = RAG[rag] || RAG.amber;
  const t = TIER_STYLES[tier] || TIER_STYLES["Tier 4"];
  const [lo, hi] = target || [0, 0];
  return (
    <div
      className="rounded-xl p-4 border"
      style={{ background: t.bg, borderColor: t.text + "22" }}
      data-testid={testId}
    >
      <div className="text-[10.5px] uppercase tracking-wide font-bold" style={{ color: t.text, opacity: 0.7 }}>
        {tier}
      </div>
      <div className="font-extrabold mt-1 num leading-none" style={{ color: t.text, fontSize: "26px" }}>
        {fmtNum(count)}
      </div>
      <div className="mt-1.5 text-[11px]" style={{ color: t.text, opacity: 0.85 }}>
        Target: {lo}–{hi}
      </div>
      <div className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${tone.bg} ${tone.text}`}>
        {tone.label}
      </div>
    </div>
  );
};

const RangeManagement = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { countries, channels, dataVersion } = applied;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [tierFilter, setTierFilter] = useState([]);
  const [brandFilter, setBrandFilter] = useState([]);
  const [subcatFilter, setSubcatFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

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
  }, [JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  const rows = data?.rows || [];
  const summary = data?.summary;
  const retirement = data?.retirement_pipeline || [];
  const movements = data?.recent_movements || [];

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="tier-kpi-row">
              {["Tier 1", "Tier 2", "Tier 3", "Tier 4"].map((t) => (
                <TierKpiCard
                  key={t}
                  tier={t}
                  count={summary.tier_counts?.[t] ?? 0}
                  target={summary.targets?.[t]}
                  rag={summary.rag?.[t]}
                  testId={`tier-card-${t.replace(/\s+/g, "-")}`}
                />
              ))}
            </div>
          </div>

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
                  {
                    key: "style_name", label: "Style", align: "left",
                    render: (r) => (
                      <div className="max-w-[240px]">
                        <div className="font-medium truncate" title={r.style_name}>{r.style_name}</div>
                        <div className="text-[10.5px] text-muted">{r.brand}</div>
                      </div>
                    ),
                    csv: (r) => r.style_name,
                  },
                  { key: "subcategory", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.subcategory || "—"}</span> },
                  { key: "tier", label: "Tier", align: "left", render: (r) => <TierPill tier={r.tier} /> },
                  {
                    key: "style_age_weeks", label: "Age (wks)", numeric: true,
                    render: (r) => fmtNum(r.style_age_weeks),
                  },
                  {
                    key: "lifetime_sor_pct", label: "Lifetime SOR %", numeric: true,
                    render: (r) => r.lifetime_sor_pct == null ? "—" : `${r.lifetime_sor_pct.toFixed(1)}%`,
                  },
                  {
                    key: "woc", label: "WOC", numeric: true,
                    render: (r) => r.woc == null ? "—" : r.woc.toFixed(1),
                  },
                  {
                    key: "last_sale_days", label: "Last Sale", numeric: true,
                    render: (r) => r.last_sale_days == null ? "—" : `${r.last_sale_days}d`,
                  },
                  {
                    key: "reorder_count", label: "Reorders", numeric: true,
                    render: (r) => fmtNum(r.reorder_count),
                  },
                  {
                    key: "full_price_pct", label: "FP %", numeric: true,
                    render: (r) => r.full_price_pct == null ? "—" : `${r.full_price_pct.toFixed(0)}%`,
                  },
                  { key: "current_stock", label: "Stock", numeric: true, render: (r) => fmtNum(r.current_stock) },
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
    </div>
  );
};

export default RangeManagement;
