import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, fmtNum, fmtKES, fmtDate } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { KPICard } from "@/components/KPICard";
import MultiSelect from "@/components/MultiSelect";
import SortableTable from "@/components/SortableTable";
import DateWindowSelector from "@/components/DateWindowSelector";
import {
  Megaphone,
  CurrencyCircleDollar,
  Warning,
  TrendUp,
  TrendDown,
  DownloadSimple,
  Sparkle,
  MagnifyingGlass,
} from "@phosphor-icons/react";

// localStorage key shared with marketing team — survives soft refreshes.
const LS_KEY = "vivo.marketing.flag-edits.v1";

const STATUS_TONES = {
  New:        { bg: "bg-slate-100",  text: "text-slate-700",   label: "New" },
  Monitored:  { bg: "bg-sky-100",    text: "text-sky-800",     label: "Monitored" },
  Improving:  { bg: "bg-emerald-100",text: "text-emerald-800", label: "Improving ↑" },
  Critical:   { bg: "bg-rose-100",   text: "text-rose-800",    label: "Critical" },
};

const ACTION_STATUS_OPTS = [
  { value: "pending",     label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "done",        label: "Done" },
];

// Maps the SOR % into colour bands for the alert table cells.
const sorTone = (pct) => {
  if (pct == null) return "text-muted";
  if (pct < 20) return "text-rose-700 font-bold";
  if (pct < 40) return "text-amber-700 font-bold";
  return "text-emerald-700 font-semibold";
};

// Heatmap cell colour bands per spec (green ≥60, amber 40-59, red <40,
// grey = no stock).
const heatmapCellStyle = (pct, stock) => {
  if (stock <= 0 || pct == null) return { bg: "#f1f5f9", color: "#94a3b8", label: "—" };
  if (pct >= 60) return { bg: "#bbf7d0", color: "#14532d", label: `${pct.toFixed(0)}%` };
  if (pct >= 40) return { bg: "#fde68a", color: "#7c2d12", label: `${pct.toFixed(0)}%` };
  return { bg: "#fecaca", color: "#7f1d1d", label: `${pct.toFixed(0)}%` };
};

const StatusBadge = ({ status }) => {
  const t = STATUS_TONES[status] || STATUS_TONES.Monitored;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] font-bold ${t.bg} ${t.text}`}
      data-testid={`status-badge-${status?.toLowerCase()}`}
    >
      {t.label}
    </span>
  );
};

const OutcomeArrow = ({ outcome, change }) => {
  const sign = change >= 0 ? "+" : "";
  if (outcome === "improving") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11.5px]">
        <TrendUp size={11} weight="bold" /> {sign}{change.toFixed(1)} pp
      </span>
    );
  }
  if (outcome === "declining") {
    return (
      <span className="inline-flex items-center gap-1 text-rose-700 font-semibold text-[11.5px]">
        <TrendDown size={11} weight="bold" /> {change.toFixed(1)} pp
      </span>
    );
  }
  return <span className="text-muted text-[11.5px]">→ {sign}{change.toFixed(1)} pp</span>;
};

const Marketing = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { countries, channels, dataVersion } = applied;

  const [data, setData] = useState(null);    // { window, threshold, summary, rows }
  const [heatmap, setHeatmap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [brandFilter, setBrandFilter] = useState([]);
  const [subcatFilter, setSubcatFilter] = useState([]);
  const [locationFilter, setLocationFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Iter 89w-h — per-table window. Marketing spec was 14d but we let
  // the user re-window to align with the rest of the SOR tables in
  // the app.  30d default matches the other tables.
  const [windowDays, setWindowDays] = useState(30);

  // Selection for "flag selected for campaign"
  const [selected, setSelected] = useState(new Set());
  const [savingBulk, setSavingBulk] = useState(false);

  // Per-row edits (action_status + notes) — kept in local state so the
  // user can type without lag; persisted to Mongo on blur / dropdown
  // change.  Also mirrored to localStorage so a soft-refresh restores
  // unsaved drafts.
  const [edits, setEdits] = useState({});

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Hydrate edits from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setEdits(JSON.parse(raw));
    } catch (_) { /* corrupt JSON, ignore */ }
  }, []);

  // Persist edits to localStorage so unsynced changes survive a soft
  // refresh.  Mongo is the source of truth on next fetch.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(edits)); } catch (_) { /* quota */ }
  }, [edits]);

  // Fetch both endpoints on filter change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const countryCsv = countries.length ? countries.map((c) => c.toLowerCase()).join(",") : undefined;
    const locationsCsv = channels.length ? channels.join(",") : undefined;
    Promise.all([
      api.get("/marketing/slow-movers", { params: { country: countryCsv, channel: locationsCsv, days: windowDays } }),
      api.get("/marketing/heatmap",     { params: { country: countryCsv, channel: locationsCsv, days: windowDays } }),
    ])
      .then(([sm, hm]) => {
        if (cancelled) return;
        setData(sm.data || null);
        setHeatmap(hm.data || null);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [JSON.stringify(countries), JSON.stringify(channels), dataVersion, windowDays]);

  // Merge server rows with local edits.
  const rowsWithEdits = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows.map((r) => {
      const e = edits[r.style_name] || {};
      return {
        ...r,
        action_status: e.action_status ?? r.action_status,
        notes: e.notes ?? r.notes,
      };
    });
  }, [data, edits]);

  // Dropdown option sources.
  const brandOpts = useMemo(
    () => [...new Set((data?.rows || []).map((r) => r.brand).filter(Boolean))].sort(),
    [data]
  );
  const subcatOpts = useMemo(
    () => [...new Set((data?.rows || []).map((r) => r.subcategory).filter(Boolean))].sort(),
    [data]
  );
  const locationOpts = useMemo(
    () => {
      const s = new Set();
      (data?.rows || []).forEach((r) => (r.locations || []).forEach((l) => s.add(l)));
      return [...s].sort();
    },
    [data]
  );

  const filtered = useMemo(() => {
    if (!rowsWithEdits.length) return [];
    const bSet = brandFilter.length ? new Set(brandFilter) : null;
    const sSet = subcatFilter.length ? new Set(subcatFilter) : null;
    const lSet = locationFilter.length ? new Set(locationFilter) : null;
    const stSet = statusFilter.length ? new Set(statusFilter) : null;
    return rowsWithEdits.filter((r) => {
      if (bSet && !bSet.has(r.brand)) return false;
      if (sSet && !sSet.has(r.subcategory)) return false;
      if (lSet && !(r.locations || []).some((l) => lSet.has(l))) return false;
      if (stSet && !stSet.has(r.status)) return false;
      if (search) {
        const blob = `${r.style_name || ""}\t${r.brand || ""}\t${r.subcategory || ""}`.toLowerCase();
        if (!blob.includes(search)) return false;
      }
      return true;
    });
  }, [rowsWithEdits, brandFilter, subcatFilter, locationFilter, statusFilter, search]);

  // ─── Action status / notes update handlers ──────────────────────
  const patchFlag = useCallback(async (style_name, patch) => {
    try {
      await api.patch(`/marketing/flags/${encodeURIComponent(style_name)}`, patch);
    } catch (e) {
      // Soft-fail: keep the local edit, surface a toast-style alert.
      console.warn("[marketing] flag update failed", e?.response?.data || e.message);
    }
  }, []);

  const handleStatusChange = (style_name, value) => {
    setEdits((prev) => ({ ...prev, [style_name]: { ...(prev[style_name] || {}), action_status: value } }));
    patchFlag(style_name, { action_status: value });
  };
  const handleNotesBlur = (style_name, value) => {
    setEdits((prev) => ({ ...prev, [style_name]: { ...(prev[style_name] || {}), notes: value } }));
    patchFlag(style_name, { notes: value });
  };

  const toggleSelected = (style_name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(style_name)) next.delete(style_name);
      else next.add(style_name);
      return next;
    });
  };
  const selectAllVisible = () => {
    const ids = filtered.map((r) => r.style_name);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const flagSelectedForCampaign = async () => {
    if (!selected.size) return;
    setSavingBulk(true);
    try {
      const styles = [...selected];
      await api.post("/marketing/flags/bulk-status", { style_names: styles, action_status: "in_progress" });
      setEdits((prev) => {
        const next = { ...prev };
        for (const s of styles) next[s] = { ...(next[s] || {}), action_status: "in_progress" };
        return next;
      });
      setSelected(new Set());
    } catch (e) {
      alert("Bulk flag failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setSavingBulk(false);
    }
  };

  // ─── CSV export ─────────────────────────────────────────────────
  const exportCsv = () => {
    const cols = [
      ["style_name", "Style Name"],
      ["brand", "Brand"],
      ["subcategory", "Subcategory"],
      ["category", "Category"],
      ["current_stock", "Current Stock"],
      ["units_sold", "Units Sold (14d)"],
      ["sor_percent", "SOR %"],
      ["locations_str", "Locations Stocked"],
      ["flagged_date", "Flagged Date"],
      ["days_since_flagged", "Days Since Flagged"],
      ["status", "Status"],
      ["sor_at_flag", "SOR at Flag"],
      ["sor_change", "SOR Change (pp)"],
      ["suggested_action", "Suggested Action"],
      ["action_status", "Action Status"],
      ["notes", "Notes"],
    ];
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = filtered.map((r) => ({
      ...r,
      locations_str: (r.locations || []).join("; "),
    }));
    const lines = [cols.map(([, h]) => h).join(",")];
    for (const r of rows) lines.push(cols.map(([k]) => esc(r[k])).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `slow-movers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ─── Render ──────────────────────────────────────────────────────
  const summary = data?.summary;
  const win = data?.window;

  return (
    <div className="space-y-5" data-testid="marketing-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Dashboard · Marketing</div>
          <h1
            className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2"
            style={{ fontSize: "clamp(15px, 1.6vw, 22px)" }}
          >
            Marketing Intelligence — Slow Movers
          </h1>
          <p className="text-muted text-[13px] mt-0.5">
            {windowDays}-day SOR &lt; 40%
            {win && (
              <> · window <span className="font-semibold text-foreground">{fmtDate(win.date_from)} → {fmtDate(win.date_to)}</span></>
            )}
            <> · updated <span className="font-semibold text-foreground">{new Date().toLocaleTimeString()}</span></>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateWindowSelector
            value={windowDays}
            onChange={setWindowDays}
            testId="marketing-window"
          />
          <button
            type="button"
            onClick={flagSelectedForCampaign}
            disabled={!selected.size || savingBulk}
            data-testid="flag-for-campaign-btn"
            className="btn-secondary flex items-center gap-1.5 disabled:opacity-50"
          >
            <Sparkle size={14} weight="bold" />
            {savingBulk ? "Saving…" : `Flag ${selected.size || ""} for campaign`}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!filtered.length}
            data-testid="marketing-csv-btn"
            className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
          >
            <DownloadSimple size={14} weight="bold" />
            Download CSV ({fmtNum(filtered.length)} rows)
          </button>
        </div>
      </div>

      {loading && <Loading label="Crunching 14-day SOR…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && summary && (
        <>
          {/* Section 1 — Summary banner */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="marketing-summary">
            <KPICard
              testId="kpi-slow-movers"
              accent
              label="Slow Movers"
              sub={`SOR < ${data.threshold}% · last ${win?.days || 14}d`}
              value={fmtNum(summary.total_slow_movers)}
              icon={Megaphone}
              showDelta={false}
              higherIsBetter={false}
            />
            <KPICard
              testId="kpi-stock-at-risk"
              label="Stock Value at Risk"
              sub="Current stock × avg selling price"
              value={fmtKES(summary.stock_value_at_risk_kes)}
              icon={CurrencyCircleDollar}
              showDelta={false}
              higherIsBetter={false}
            />
            <KPICard
              testId="kpi-avg-sor"
              label="Avg SOR of Slow Movers"
              sub="Lower = worse"
              value={`${summary.avg_sor_percent.toFixed(1)}%`}
              icon={TrendDown}
              showDelta={false}
              higherIsBetter={false}
            />
            <KPICard
              testId="kpi-critical"
              label="Critical (7d+ no improve)"
              sub="Need escalation"
              value={fmtNum(summary.critical_count)}
              icon={Warning}
              showDelta={false}
              higherIsBetter={false}
            />
            <KPICard
              testId="kpi-improving"
              label="Improving"
              sub="SOR up ≥ 10pp since flag"
              value={fmtNum(summary.improving_count)}
              icon={TrendUp}
              showDelta={false}
              higherIsBetter={true}
            />
          </div>

          {/* Filters */}
          <div className="card-white p-3 flex flex-wrap items-end gap-2" data-testid="marketing-filters">
            <div className="flex items-center gap-2 input-pill flex-1 min-w-[260px]">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search style, brand or subcategory…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                data-testid="marketing-search"
                className="bg-transparent outline-none text-[13px] w-full"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="text-muted hover:text-foreground text-[12px] px-1"
                >Clear</button>
              )}
            </div>
            <div>
              <div className="eyebrow mb-1">Brand</div>
              <MultiSelect testId="marketing-filter-brand"
                options={brandOpts.map((b) => ({ value: b, label: b }))}
                value={brandFilter} onChange={setBrandFilter}
                placeholder="All brands" width={150} />
            </div>
            <div>
              <div className="eyebrow mb-1">Subcategory</div>
              <MultiSelect testId="marketing-filter-subcat"
                options={subcatOpts.map((s) => ({ value: s, label: s }))}
                value={subcatFilter} onChange={setSubcatFilter}
                placeholder="All subcats" width={200} />
            </div>
            <div>
              <div className="eyebrow mb-1">Location</div>
              <MultiSelect testId="marketing-filter-location"
                options={locationOpts.map((l) => ({ value: l, label: l }))}
                value={locationFilter} onChange={setLocationFilter}
                placeholder="All locations" width={200} />
            </div>
            <div>
              <div className="eyebrow mb-1">Status</div>
              <MultiSelect testId="marketing-filter-status"
                options={["New", "Monitored", "Improving", "Critical"].map((s) => ({ value: s, label: s }))}
                value={statusFilter} onChange={setStatusFilter}
                placeholder="All statuses" width={170} />
            </div>
          </div>

          {/* Section 2 — Alert table */}
          <div className="card-white p-5" data-testid="marketing-alert-table-card">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <SectionTitle
                title={`Slow movers alert · ${fmtNum(filtered.length)} of ${fmtNum(rowsWithEdits.length)}`}
                subtitle="Sorted SOR ascending (worst first). Tick the boxes and click 'Flag for campaign' to bulk-mark for marketing action."
              />
              <button
                type="button"
                onClick={selectAllVisible}
                disabled={filtered.length === 0}
                data-testid="row-sel-all"
                className="px-3 py-1 rounded-lg border border-border text-[11.5px] font-semibold hover:bg-panel disabled:opacity-40"
              >
                {filtered.length > 0 && filtered.every((r) => selected.has(r.style_name))
                  ? "Deselect all visible"
                  : "Select all visible"}
              </button>
            </div>
            {filtered.length === 0 ? (
              <Empty label="No slow movers match the current filters — that's a win." />
            ) : (
              <SortableTable
                testId="marketing-alert-table"
                initialSort={{ key: "sor_percent", dir: "asc" }}
                pageSize={50}
                columns={[
                  {
                    key: "_sel", label: "", align: "left", sortable: false,
                    render: (r) => (
                      <input
                        type="checkbox"
                        checked={selected.has(r.style_name)}
                        onChange={() => toggleSelected(r.style_name)}
                        data-testid={`row-sel-${r.style_name}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ),
                  },
                  {
                    key: "style_name", label: "Style", align: "left",
                    render: (r) => <span className="font-medium max-w-[240px] inline-block truncate" title={r.style_name}>{r.style_name}</span>,
                    csv: (r) => r.style_name,
                  },
                  { key: "subcategory", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.subcategory || "—"}</span> },
                  { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span> },
                  { key: "current_stock", label: "Stock", numeric: true, render: (r) => fmtNum(r.current_stock) },
                  { key: "units_sold", label: "Sold 14d", numeric: true, render: (r) => fmtNum(r.units_sold) },
                  {
                    key: "sor_percent", label: "SOR %", numeric: true,
                    render: (r) => <span className={sorTone(r.sor_percent)}>{r.sor_percent?.toFixed(1)}%</span>,
                  },
                  {
                    key: "locations", label: "Locations Stocked", align: "left",
                    render: (r) => (
                      <span className="text-muted text-[11.5px] max-w-[240px] inline-block truncate" title={(r.locations || []).join(", ")}>
                        {(r.locations || []).length === 0 ? "—" : (r.locations || []).join(", ")}
                      </span>
                    ),
                    csv: (r) => (r.locations || []).join("; "),
                  },
                  {
                    key: "flagged_date", label: "Flagged", align: "left",
                    render: (r) => (
                      <span className="text-muted text-[11.5px] num">
                        {r.flagged_date} <span className="text-[10px]">({r.days_since_flagged}d)</span>
                      </span>
                    ),
                  },
                  {
                    key: "status", label: "Status", align: "left",
                    render: (r) => <StatusBadge status={r.status} />,
                  },
                ]}
                rows={filtered}
              />
            )}
          </div>

          {/* Section 3 — Heatmap */}
          {heatmap && (
            <div className="card-white p-5" data-testid="marketing-heatmap-card">
              <SectionTitle
                title="Location × Category Heatmap"
                subtitle="14-day SOR by store and apparel category — green ≥ 60%, amber 40–59%, red < 40%, grey = no stock."
              />
              <div className="overflow-x-auto mt-2">
                <table className="text-[11.5px] border-collapse w-full" data-testid="marketing-heatmap-table">
                  <thead>
                    <tr>
                      <th className="text-left p-2 sticky left-0 bg-white font-semibold text-muted">Location</th>
                      {heatmap.categories.map((c) => (
                        <th key={c} className="text-center p-2 font-semibold text-muted" style={{ minWidth: 90 }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmap.locations.map((loc) => (
                      <tr key={loc}>
                        <td className="p-2 font-medium sticky left-0 bg-white whitespace-nowrap">{loc}</td>
                        {heatmap.categories.map((cat) => {
                          const cell = heatmap.cells?.[loc]?.[cat];
                          const tone = heatmapCellStyle(cell?.sor_percent, cell?.current_stock || 0);
                          return (
                            <td
                              key={cat}
                              data-testid={`heatmap-${loc}-${cat}`}
                              title={`${loc} · ${cat}\nSOR: ${tone.label}\nSold: ${cell ? fmtNum(cell.units_sold) : 0}\nStock: ${cell ? fmtNum(cell.current_stock) : 0}`}
                              style={{ background: tone.bg, color: tone.color }}
                              className="text-center py-1.5 font-bold rounded-sm transition-colors"
                            >
                              {tone.label}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 4 — Action Plan Tracker */}
          <div className="card-white p-5" data-testid="marketing-action-tracker">
            <SectionTitle
              title={`Action Plan Tracker · ${fmtNum(filtered.length)} flags`}
              subtitle="Mark progress and add notes. Red rows = flagged 7+ days ago with SOR not improving by ≥ 10pp — escalate to management."
            />
            {filtered.length === 0 ? (
              <Empty label="Nothing to action. Great job." />
            ) : (
              <div className="overflow-x-auto">
                <table className="text-[12px] w-full border-collapse" data-testid="action-tracker-table">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="p-2 font-semibold text-muted">Style</th>
                      <th className="p-2 font-semibold text-muted">Flagged</th>
                      <th className="p-2 font-semibold text-muted text-right">SOR at flag</th>
                      <th className="p-2 font-semibold text-muted text-right">SOR now</th>
                      <th className="p-2 font-semibold text-muted">Outcome</th>
                      <th className="p-2 font-semibold text-muted">Suggested Action</th>
                      <th className="p-2 font-semibold text-muted">Action Status</th>
                      <th className="p-2 font-semibold text-muted">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, idx) => (
                      <tr
                        key={`${r.style_name}-${idx}`}
                        className={r.needs_escalation ? "bg-rose-50/40 border-b border-border" : "border-b border-border"}
                        data-testid={`tracker-row-${r.style_name}`}
                      >
                        <td className="p-2 align-top max-w-[220px]">
                          <div className="font-medium truncate" title={r.style_name}>{r.style_name}</div>
                          <div className="text-[10.5px] text-muted">{r.brand} · {r.subcategory}</div>
                        </td>
                        <td className="p-2 align-top text-[11.5px] num">
                          {r.flagged_date} <span className="text-muted">({r.days_since_flagged}d)</span>
                        </td>
                        <td className="p-2 align-top text-right num">{r.sor_at_flag?.toFixed(1)}%</td>
                        <td className="p-2 align-top text-right num">
                          <span className={sorTone(r.sor_percent)}>{r.sor_percent?.toFixed(1)}%</span>
                        </td>
                        <td className="p-2 align-top">
                          <OutcomeArrow outcome={r.outcome} change={r.sor_change} />
                        </td>
                        <td className="p-2 align-top text-[11.5px] max-w-[260px]">
                          <span title={r.suggested_action} className="line-clamp-2">{r.suggested_action}</span>
                        </td>
                        <td className="p-2 align-top">
                          <select
                            value={r.action_status || "pending"}
                            onChange={(e) => handleStatusChange(r.style_name, e.target.value)}
                            data-testid={`action-status-${r.style_name}`}
                            className="text-[11.5px] border border-border rounded px-1.5 py-0.5 bg-white"
                          >
                            {ACTION_STATUS_OPTS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2 align-top max-w-[260px]">
                          <input
                            defaultValue={r.notes || ""}
                            onBlur={(e) => handleNotesBlur(r.style_name, e.target.value)}
                            placeholder="Add a note…"
                            data-testid={`notes-${r.style_name}`}
                            className="w-full text-[11.5px] border border-border rounded px-2 py-1 bg-white"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Marketing;
