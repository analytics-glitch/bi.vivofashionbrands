import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFilters } from "@/lib/filters";
import { useAuth } from "@/lib/auth";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import IBTFlatTable from "@/components/IBTFlatTable";
import WarehouseToStoreIBT from "@/components/WarehouseToStoreIBT";
import IBTCompletedMoves from "@/components/IBTCompletedMoves";
import IBTMarkAsDoneModal from "@/components/IBTMarkAsDoneModal";
import { useRecommendationState } from "@/lib/useRecommendationState";
import { Truck, Coins, Package, MagnifyingGlass } from "@phosphor-icons/react";

const ibtKey = (r) => `${r.style_name}||${r.from_store}||${r.to_store}`;

const IBT = () => {
  const { applied, touchLastUpdated, setPreset } = useFilters();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { dateFrom, dateTo, countries, dataVersion } = applied;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [fromStoreFilter, setFromStoreFilter] = useState("");
  const [toStoreFilter, setToStoreFilter] = useState("");
  const [subcatFilter, setSubcatFilter] = useState("");
  const [showResolved, setShowResolved] = useState(false); // eslint-disable-line no-unused-vars
  const [completedKeys, setCompletedKeys] = useState(new Set());
  const [completedSkuKeys, setCompletedSkuKeys] = useState(new Set());
  const [completedRefresh, setCompletedRefresh] = useState(0);
  const [doneModalRow, setDoneModalRow] = useState(null);
  // Sensitivity preset for the FROM/TO velocity bands. Persists across
  // sessions so a buyer who likes the looser view doesn't have to
  // re-pick it every visit. Default = strict (matches pre-iter-64).
  const [sensitivity, setSensitivity] = useState(() => {
    try { return localStorage.getItem("vivo_ibt_sensitivity") || "strict"; }
    catch { return "strict"; }
  });
  // (low_pct, high_pct) for each preset.
  const SENSITIVITY = {
    strict:   { low: 20, high: 150, label: "Strict",   help: "≤20% / ≥150% of group avg — fewer rows, strongest signals" },
    balanced: { low: 30, high: 130, label: "Balanced", help: "≤30% / ≥130% — surfaces ~3× more stores" },
    wide:     { low: 40, high: 120, label: "Wide",     help: "≤40% / ≥120% — most stores visible, weakest signal" },
  };
  const setSensitivityPersist = (key) => {
    setSensitivity(key);
    try { localStorage.setItem("vivo_ibt_sensitivity", key); } catch { /* private browsing */ }
  };
  // Recommendation pill state retained at module level only because
  // useRecommendationState writes to MongoDB; we no longer surface the
  // pill UI per leadership request — Mark As Done is the single
  // workflow.
  // eslint-disable-next-line no-unused-vars
  const { stateByKey } = useRecommendationState("ibt");

  // ALWAYS force "Last 30 days" on this page — leadership directive so
  // store managers don't see stale narrow date windows. Runs once on
  // mount, then subsequent filter-bar changes are respected.
  const forcedRangeRef = useRef(false);
  useEffect(() => {
    if (forcedRangeRef.current) return;
    forcedRangeRef.current = true;
    setPreset("last_30d");
  }, [setPreset]);

  // Load the keys of already-completed suggestions
  // so we can hide them from the live table.
  useEffect(() => {
    let cancelled = false;
    api.get("/ibt/completed/keys")
      .then((r) => {
        if (cancelled) return;
        setCompletedKeys(new Set(r.data?.keys || []));
        setCompletedSkuKeys(new Set(r.data?.sku_keys || []));
      })
      .catch(() => {
        if (cancelled) return;
        setCompletedKeys(new Set());
        setCompletedSkuKeys(new Set());
      });
    return () => { cancelled = true; };
  }, [completedRefresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const country = countries.length === 1 ? countries[0] : undefined;
    const { low, high } = SENSITIVITY[sensitivity] || SENSITIVITY.strict;
    api
      .get("/analytics/ibt-suggestions", {
        params: {
          date_from: dateFrom, date_to: dateTo, country,
          limit: 300,
          low_pct: low, high_pct: high,
        },
        timeout: 180000,
      })
      .then(({ data }) => {
        if (cancelled) return;
        setRows(data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), dataVersion, sensitivity]);

  const brands = useMemo(
    () => Array.from(new Set(rows.map((r) => r.brand).filter(Boolean))).sort(),
    [rows]
  );
  const fromStores = useMemo(
    () => Array.from(new Set(rows.map((r) => r.from_store).filter(Boolean))).sort(),
    [rows]
  );
  const toStores = useMemo(
    () => Array.from(new Set(rows.map((r) => r.to_store).filter(Boolean))).sort(),
    [rows]
  );
  const subcats = useMemo(
    () => Array.from(new Set(rows.map((r) => r.subcategory).filter(Boolean))).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // Hide entire (style,to) only when a LEGACY (no-SKU) completion
      // exists for it — the new SKU-level keys are used per-row by
      // IBTFlatTable.
      if (completedKeys.has(`${r.style_name}||${r.to_store}||__all__`)) return false;
      if (brandFilter && r.brand !== brandFilter) return false;
      if (fromStoreFilter && r.from_store !== fromStoreFilter) return false;
      if (toStoreFilter && r.to_store !== toStoreFilter) return false;
      if (subcatFilter && r.subcategory !== subcatFilter) return false;
      if (!q) return true;
      return (
        (r.style_name || "").toLowerCase().includes(q) ||
        (r.from_store || "").toLowerCase().includes(q) ||
        (r.to_store || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, brandFilter, fromStoreFilter, toStoreFilter, subcatFilter, completedKeys]);

  // RecommendationActionPill removed per leadership; we just show the
  // pending list. Mark-as-Done filters via `completedKeys` further up.
  const visible = filtered;

  const kpis = useMemo(() => {
    const totalUplift = filtered.reduce((s, r) => s + (r.estimated_uplift || 0), 0);
    const totalUnits = filtered.reduce((s, r) => s + (r.units_to_move || 0), 0);
    const storesInvolved = new Set();
    filtered.forEach((r) => { storesInvolved.add(r.from_store); storesInvolved.add(r.to_store); });
    return {
      moves: filtered.length,
      totalUnits,
      totalUplift,
      storesInvolved: storesInvolved.size,
    };
  }, [filtered]);

  return (
    <div className="space-y-6" data-testid="ibt-page">
      <div>
        <div className="eyebrow">Dashboard · Inter-Branch Transfer</div>
        <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(18px,2.2vw,26px)]">
          Inter-Branch Transfer Recommendations
        </h1>
        <p className="text-muted text-[13px] mt-1 max-w-3xl">
          Moves a SKU from a store where it isn't selling to one where it is.
          Rule: the <b>from</b>-store sells at ≤ 20% of the group average for
          that style while having available stock; the <b>to</b>-store sells
          at ≥ 150% of average while running low. Warehouses are excluded —
          only store-to-store moves.
        </p>
      </div>

      {loading && <Loading label="Analyzing sell-through across stores…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPICard testId="ibt-kpi-moves" accent label="Open moves"
              sub="All pending review"
              value={fmtNum(kpis.moves)} icon={Truck} showDelta={false} />
            <KPICard testId="ibt-kpi-units" label="Units To Move" value={fmtNum(kpis.totalUnits)} icon={Package} showDelta={false} />
            <KPICard testId="ibt-kpi-uplift" label="Est. Revenue Uplift" value={fmtKES(kpis.totalUplift)} icon={Coins} showDelta={false} />
            <KPICard testId="ibt-kpi-stores" label="Stores Involved" value={fmtNum(kpis.storesInvolved)} showDelta={false} />
          </div>

          <div className="card-white p-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 input-pill flex-1 min-w-[200px]">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search style or store…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="ibt-search"
                className="bg-transparent outline-none text-[13px] w-full"
              />
            </div>
            <select
              className="input-pill"
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              data-testid="ibt-brand-filter"
            >
              <option value="">All brands</option>
              {brands.map((b) => <option key={b}>{b}</option>)}
            </select>
            <select
              className="input-pill"
              value={fromStoreFilter}
              onChange={(e) => setFromStoreFilter(e.target.value)}
              data-testid="ibt-from-store-filter"
              title="Show only moves leaving this store"
            >
              <option value="">All FROM stores</option>
              {fromStores.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select
              className="input-pill"
              value={toStoreFilter}
              onChange={(e) => setToStoreFilter(e.target.value)}
              data-testid="ibt-to-store-filter"
              title="Show only moves arriving at this store"
            >
              <option value="">All TO stores</option>
              {toStores.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select
              className="input-pill"
              value={subcatFilter}
              onChange={(e) => setSubcatFilter(e.target.value)}
              data-testid="ibt-subcat-filter"
              title="Show only moves for this subcategory"
            >
              <option value="">All subcategories</option>
              {subcats.map((s) => <option key={s}>{s}</option>)}
            </select>
            {(brandFilter || fromStoreFilter || toStoreFilter || subcatFilter || search) && (
              <button
                type="button"
                onClick={() => {
                  setBrandFilter("");
                  setFromStoreFilter("");
                  setToStoreFilter("");
                  setSubcatFilter("");
                  setSearch("");
                }}
                data-testid="ibt-clear-filters"
                className="text-[11px] text-muted underline hover:text-brand"
              >
                clear
              </button>
            )}
          </div>

          <div className="card-white p-4 sm:p-5" data-testid="ibt-table-card">
            <SectionTitle
              title={`Store → Store transfer list · ${visible.length} suggestions`}
              subtitle="Each row is one SKU (color × size). Type the units you actually transferred, then tap Mark As Done to log the PO and remove it from this list. Tablet-friendly — scroll horizontally to see all columns."
              action={
                <div className="inline-flex items-center gap-2 text-[11.5px]" data-testid="ibt-sensitivity">
                  <span className="font-semibold text-foreground/80">Sensitivity:</span>
                  <div className="inline-flex border border-border rounded-lg overflow-hidden">
                    {Object.entries(SENSITIVITY).map(([key, cfg]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSensitivityPersist(key)}
                        title={cfg.help}
                        data-testid={`ibt-sensitivity-${key}`}
                        className={`px-2.5 py-1 font-bold transition-colors ${
                          sensitivity === key
                            ? "bg-brand text-white"
                            : "bg-white text-foreground/70 hover:bg-panel"
                        }`}
                      >
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10.5px] text-muted">
                    ≤{SENSITIVITY[sensitivity].low}% / ≥{SENSITIVITY[sensitivity].high}%
                  </span>
                </div>
              }
            />
            <IBTFlatTable
              suggestions={visible}
              flow="store_to_store"
              onMarkDone={(payload) => setDoneModalRow(payload)}
              completedSkuKeys={completedSkuKeys}
              testId="ibt-table"
              emptyLabel={
                filtered.length === 0
                  ? "No transfer opportunities found for the current window. Try widening the date range."
                  : "All transfer moves have been actioned."
              }
            />
          </div>

          <div className="card-white p-4 bg-panel">
            <div className="text-[12.5px] text-muted">
              <span className="font-semibold text-foreground">How it works:</span>{" "}
              For each style that lives in at least two stores, the algorithm
              compares per-store sell-through to the group average. A move is
              suggested when a store with inventory isn't selling and another
              store is selling strongly but running low. Qty is bounded by the
              smaller of: <i>from-store buffer (2 units)</i> and
              <i> to-store 2-week cover target</i>. Warehouses are always
              excluded. Tap <b className="text-emerald-700">Mark As Done</b> on
              any row to log it to the Completed Moves table below and hide
              it from the live list.
            </div>
          </div>

          <WarehouseToStoreIBT
            dateFrom={dateFrom}
            dateTo={dateTo}
            countries={countries}
            onMarkDone={(r) => setDoneModalRow({ ...r, flow: "warehouse_to_store" })}
            completedSkuKeys={completedSkuKeys}
          />

          {isAdmin && (
            <IBTCompletedMoves refreshKey={completedRefresh} />
          )}

          {doneModalRow && (
            <IBTMarkAsDoneModal
              row={doneModalRow}
              onClose={() => setDoneModalRow(null)}
              onSubmitted={() => {
                setDoneModalRow(null);
                setCompletedRefresh((n) => n + 1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
};

export default IBT;
