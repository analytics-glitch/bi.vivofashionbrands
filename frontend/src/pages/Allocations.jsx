import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Loading, ErrorBox, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import AllocationRunsHistory from "@/components/AllocationRunsHistory";
import AllocationPendingQueue from "@/components/AllocationPendingQueue";
import { Stack, Calculator, Cube, FloppyDisk, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useFilters } from "@/lib/filters";

/**
 * Allocations — given a units pool + chosen sizes/colour, recommend
 * how many size packs each store should receive based on a blended
 * velocity (sales) + low-stock score. Sized in whole packs (size
 * ratios from leadership table). Online channels excluded.
 */

// Single weight slider used in the multi-criteria scoring panel.
const WeightSlider = ({ label, value, onChange, hint, testId }) => (
  <div className="flex items-center gap-2">
    <span className="text-[11.5px] font-semibold text-foreground w-20 shrink-0">
      {label}
    </span>
    <input
      type="range"
      min={0} max={1} step={0.05}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1"
      data-testid={testId}
    />
    <span className="tabular-nums text-[11.5px] font-bold w-10 text-right">
      {Math.round(value * 100)}%
    </span>
    {hint && (
      <span className="text-[10.5px] text-muted hidden md:inline truncate max-w-[160px]" title={hint}>
        {hint}
      </span>
    )}
  </div>
);

const Allocations = () => {
  const { applied } = useFilters();
  const { user } = useAuth();
  const { dateFrom, dateTo } = applied;
  const [packTable, setPackTable] = useState({});
  const [subcategory, setSubcategory] = useState("");
  const [color, setColor] = useState("");
  const [units, setUnits] = useState(400);
  const [selectedSizes, setSelectedSizes] = useState(["S", "M", "L"]);
  // Multi-criteria weights — Velocity / Stock / ASP. Default skews to
  // velocity which preserves pre-iter-61 behaviour. The form
  // renormalises them on submit so sliders don't have to sum to 1.
  const [velocityWeight, setVelocityWeight] = useState(0.5);
  const [stockWeight, setStockWeight] = useState(0.3);
  const [aspWeight, setAspWeight] = useState(0.2);
  // Off-the-top reservations (whole-number percent of buying total).
  // Warehouse first, online second, balance to physical stores.
  const [warehousePct, setWarehousePct] = useState(0);
  const [onlinePct, setOnlinePct] = useState(0);
  const [subcatOptions, setSubcatOptions] = useState([]);
  const [excludedStores, setExcludedStores] = useState([]);
  const [allStores, setAllStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [allocationType, setAllocationType] = useState("new"); // "new" | "replenishment"
  const [styleName, setStyleName] = useState("");
  const [styleOptions, setStyleOptions] = useState([]);
  const [stylesLoading, setStylesLoading] = useState(false);
  // Per-store overrides keyed by store name. Each value is the user-
  // typed pack count which overrides the auto-allocation.
  const [packOverrides, setPackOverrides] = useState({});
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [optimisticRun, setOptimisticRun] = useState(null);
  const [savingRun, setSavingRun] = useState(false);
  const [savedToast, setSavedToast] = useState(null);

  // Bootstrap: pack table + subcategory list + store list.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get("/allocations/sizes").catch(() => ({ data: { pack_table: {} } })),
      api.get("/allocations/stores").catch(() => ({ data: { stores: [] } })),
      api.get("/subcategory-sales", { params: { date_from: dateFrom, date_to: dateTo } })
        .catch(() => ({ data: [] })),
    ])
      .then(([sizes, stores, sc]) => {
        if (cancelled) return;
        setPackTable(sizes.data?.pack_table || {});
        setAllStores(stores.data?.stores || []);
        const opts = (sc.data || []).map((r) => r.subcategory).filter(Boolean).sort();
        setSubcatOptions(opts);
        if (!subcategory && opts.length) setSubcategory(opts[0]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo]);

  const packUnitSize = useMemo(
    () => selectedSizes.reduce((s, sz) => s + (packTable[sz] || 0), 0),
    [selectedSizes, packTable]
  );

  const previewPacks = packUnitSize > 0 ? Math.floor(units / packUnitSize) : 0;
  const previewUnits = previewPacks * packUnitSize;
  const leftover = units - previewUnits;

  const toggleSize = (sz) => {
    setSelectedSizes((prev) => prev.includes(sz) ? prev.filter((x) => x !== sz) : [...prev, sz]);
  };

  const toggleStoreExclusion = (s) => {
    setExcludedStores((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  const calculate = async () => {
    if (!subcategory || selectedSizes.length === 0 || units < 1) {
      setError("Pick a subcategory, at least one size, and a units total ≥ 1.");
      return;
    }
    if (allocationType === "replenishment" && !styleName.trim()) {
      setError("Pick the existing style you want to replenish.");
      return;
    }
    if (packUnitSize > units) {
      setError(`A pack of these sizes is ${packUnitSize} units — you only have ${units}.`);
      return;
    }
    setCalculating(true);
    setError(null);
    setResult(null);
    setPackOverrides({});
    try {
      const { data } = await api.post("/allocations/calculate", {
        subcategory,
        color: color || null,
        sizes: selectedSizes,
        units_total: Number(units),
        date_from: dateFrom,
        date_to: dateTo,
        velocity_weight: Number(velocityWeight),
        stock_weight: Number(stockWeight),
        asp_weight: Number(aspWeight),
        warehouse_pct: Number(warehousePct),
        online_pct: Number(onlinePct),
        excluded_stores: excludedStores,
        style_name: styleName.trim() || null,
        allocation_type: allocationType,
      }, { timeout: 120000 });
      setResult(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Calculation failed");
    } finally {
      setCalculating(false);
    }
  };

  // Load existing styles when user switches to "replenishment" or
  // changes the subcategory. Cached in styleOptions until subcat
  // changes.
  useEffect(() => {
    if (allocationType !== "replenishment" || !subcategory) {
      setStyleOptions([]);
      return;
    }
    let cancelled = false;
    setStylesLoading(true);
    api.get("/allocations/styles", { params: { subcategory } })
      .then((r) => { if (!cancelled) setStyleOptions(r.data?.styles || []); })
      .catch(() => { if (!cancelled) setStyleOptions([]); })
      .finally(() => { if (!cancelled) setStylesLoading(false); });
    return () => { cancelled = true; };
  }, [allocationType, subcategory]);

  // Effective rows = original rows merged with manual overrides.
  // Each row's packs_allocated, units_allocated and sizes are
  // recalculated when an override is present. The original auto-
  // suggestion is stashed under suggested_packs / suggested_units so
  // the export can show suggested vs allocated.
  const effectiveRows = useMemo(() => {
    if (!result?.rows) return [];
    const sizeKeys = Object.keys(result.pack_breakdown || {});
    return result.rows.map((r) => {
      const override = packOverrides[r.store];
      const finalPacks = override === undefined ? r.packs_allocated : Math.max(0, parseInt(override, 10) || 0);
      const sizes = {};
      sizeKeys.forEach((sz) => { sizes[sz] = finalPacks * (result.pack_breakdown[sz] || 0); });
      const units = Object.values(sizes).reduce((s, v) => s + v, 0);
      return {
        ...r,
        suggested_packs: r.packs_allocated,
        suggested_units: r.units_allocated,
        packs_allocated: finalPacks,
        units_allocated: units,
        sizes,
        is_overridden: override !== undefined && override !== r.packs_allocated,
      };
    });
  }, [result, packOverrides]);

  const overriddenCount = useMemo(
    () => effectiveRows.filter((r) => r.is_overridden).length,
    [effectiveRows]
  );
  const totalAllocatedAfterOverrides = useMemo(
    () => effectiveRows.reduce((s, r) => s + r.units_allocated, 0),
    [effectiveRows]
  );

  const setPackOverride = (store, value) => {
    setPackOverrides((prev) => {
      const next = { ...prev };
      if (value === "" || value == null) { delete next[store]; }
      else { next[store] = value; }
      return next;
    });
  };
  const resetOverrides = () => setPackOverrides({});

  const saveRun = async () => {
    if (!result || effectiveRows.length === 0) return;
    if (!styleName.trim()) {
      setError("Add a style name before saving the allocation run.");
      return;
    }
    setSavingRun(true);
    setError(null);
    try {
      const { data: saved } = await api.post("/allocations/save", {
        style_name: styleName.trim(),
        allocation_type: allocationType,
        subcategory,
        color: color || null,
        units_total: Number(units),
        pack_unit_size: result.pack_unit_size,
        pack_breakdown: result.pack_breakdown,
        velocity_weight: Number(velocityWeight),
        stock_weight: Number(stockWeight),
        asp_weight: Number(aspWeight),
        warehouse_pct: Number(warehousePct),
        online_pct: Number(onlinePct),
        date_from: dateFrom,
        date_to: dateTo,
        rows: effectiveRows.map((r) => ({
          store: r.store,
          suggested_packs: r.suggested_packs,
          suggested_units: r.suggested_units,
          allocated_packs: r.packs_allocated,
          allocated_units: r.units_allocated,
          sizes: r.sizes,
          delta_units: r.units_allocated - r.suggested_units,
        })),
      });
      // Optimistic prepend so the user sees their just-saved run
      // appear in the history table immediately. The history table
      // also re-fetches via refreshKey but that adds ~1-3s latency
      // in slow envs.
      setOptimisticRun(saved);
      setHistoryRefresh((n) => n + 1);
      setSavedToast("Sent to warehouse · check the Pending Fulfilment queue below");
      setTimeout(() => setSavedToast(null), 4000);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to save allocation");
    } finally {
      setSavingRun(false);
    }
  };

  const exportCsv = () => {
    if (!effectiveRows.length) return;
    const sizeKeys = Object.keys(result.pack_breakdown);
    const header = [
      "Store",
      "Suggested Packs", "Suggested Units",
      "Allocated Packs", "Allocated Units",
      "Delta Units",
      ...sizeKeys.map((s) => `${s} units`),
      "Velocity Score", "Low-Stock Score", "Sold (window)", "Current SOH",
    ];
    const lines = [
      `Style:,"${styleName.replace(/"/g, '""')}"`,
      `Type:,${allocationType}`,
      `Subcategory:,"${subcategory}"`,
      `Color:,"${color || "all"}"`,
      `Units total:,${units}`,
      `Pack size:,${result.pack_unit_size}`,
      `Generated:,${new Date().toISOString()}`,
      "",
      header.join(","),
    ];
    effectiveRows.forEach((r) => {
      lines.push([
        `"${r.store.replace(/"/g, '""')}"`,
        r.suggested_packs, r.suggested_units,
        r.packs_allocated, r.units_allocated,
        r.units_allocated - r.suggested_units,
        ...sizeKeys.map((s) => r.sizes[s] || 0),
        r.velocity_score?.toFixed?.(4) ?? r.velocity_score,
        r.low_stock_score?.toFixed?.(4) ?? r.low_stock_score,
        r.units_sold_window, r.current_soh,
      ].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `allocation_${subcategory}_${color || "all"}_${dateFrom}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(link.href);
  };

  if (loading) return <Loading label="Loading allocation tools…" />;

  return (
    <div className="space-y-6" data-testid="allocations-page">
      <div>
        <div className="eyebrow">Dashboard · Allocations</div>
        <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(18px,2.2vw,26px)] inline-flex items-center gap-2">
          <Stack size={22} weight="duotone" className="text-[#1a5c38]" />
          Allocation Planner
        </h1>
        <p className="text-muted text-[13px] mt-1 max-w-2xl">
          Distribute a pool of units across stores using a blended score of
          velocity (units sold) and low-stock need. Output is in whole size
          packs so the picker team always ships a complete size run.
        </p>
      </div>

      <div className="card-white p-5 space-y-4" data-testid="allocation-form">
        {/* Type toggle */}
        <div>
          <label className="eyebrow block mb-1.5">Allocation type</label>
          <div className="inline-flex rounded-full border border-border overflow-hidden" data-testid="alloc-type">
            {[
              { k: "new", label: "New style" },
              { k: "replenishment", label: "Replenishment (existing)" },
            ].map((opt) => {
              const active = allocationType === opt.k;
              return (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => { setAllocationType(opt.k); setStyleName(""); }}
                  data-testid={`alloc-type-${opt.k}`}
                  className={`px-3 py-1 text-[11.5px] font-semibold transition-colors ${
                    active ? "bg-[#1a5c38] text-white" : "bg-white text-[#374151] hover:bg-gray-100"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Style name */}
        <div>
          <label className="eyebrow block mb-1">
            Style name {allocationType === "replenishment" ? "(pick existing)" : "(free text)"}
          </label>
          {allocationType === "replenishment" ? (
            <select
              value={styleName}
              onChange={(e) => setStyleName(e.target.value)}
              disabled={!subcategory || stylesLoading}
              className="input-pill w-full"
              data-testid="alloc-style-select"
            >
              <option value="">{stylesLoading ? "Loading styles…" : `— pick from ${styleOptions.length} styles —`}</option>
              {styleOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input
              value={styleName}
              onChange={(e) => setStyleName(e.target.value)}
              placeholder="e.g. Vivo Linen Maxi Dress · Spring 26"
              className="input-pill w-full"
              data-testid="alloc-style-input"
            />
          )}
          {allocationType === "replenishment" && styleName && (
            <p className="text-[10.5px] text-muted mt-0.5">
              Velocity + low-stock score will be computed for <b>{styleName}</b> only (style-specific).
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="eyebrow block mb-1">Subcategory</label>
            <select
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className="input-pill w-full"
              data-testid="alloc-subcategory"
            >
              <option value="">— pick —</option>
              {subcatOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="eyebrow block mb-1">Color (optional)</label>
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. Black, Cream"
              className="input-pill w-full"
              data-testid="alloc-color"
            />
          </div>
          <div>
            <label className="eyebrow block mb-1">Units total</label>
            <input
              type="number"
              min={1}
              max={100000}
              value={units}
              onChange={(e) => setUnits(Math.max(1, Number(e.target.value) || 0))}
              className="input-pill w-full"
              data-testid="alloc-units"
            />
          </div>
          <div>
            <label className="eyebrow block mb-1.5">
              Scoring weights · sliders auto-renormalise
              <span className="ml-1 text-[10px] text-muted font-normal">
                (currently {Math.round(((velocityWeight + stockWeight + aspWeight) || 1) * 100) / 100})
              </span>
            </label>
            <div className="space-y-2" data-testid="alloc-weights">
              <WeightSlider
                label="Velocity"
                value={velocityWeight}
                onChange={setVelocityWeight}
                hint="Stores selling more get more"
                testId="alloc-velocity-weight"
              />
              <WeightSlider
                label="Stock-need"
                value={stockWeight}
                onChange={setStockWeight}
                hint="Stores with the lowest stock get more"
                testId="alloc-stock-weight"
              />
              <WeightSlider
                label="ASP"
                value={aspWeight}
                onChange={setAspWeight}
                hint="Stores selling at higher avg price get more"
                testId="alloc-asp-weight"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mt-3 p-3 rounded-md border border-amber-300 bg-amber-50/60">
          <div className="sm:col-span-2 text-[11.5px] text-amber-900 font-semibold">
            Off-the-top reservations (priority order: Warehouse → Online → Stores)
          </div>
          <div>
            <label className="eyebrow block mb-1">Warehouse %</label>
            <input
              type="number"
              min={0} max={100} step={1}
              value={warehousePct}
              onChange={(e) => setWarehousePct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="input-pill w-full"
              data-testid="alloc-warehouse-pct"
            />
            <div className="text-[10.5px] text-muted mt-0.5">
              {warehousePct > 0 ? `~${Math.round(units * warehousePct / 100)} units to warehouse first` : "0 units to warehouse"}
            </div>
          </div>
          <div>
            <label className="eyebrow block mb-1">Online %</label>
            <input
              type="number"
              min={0} max={100} step={1}
              value={onlinePct}
              onChange={(e) => setOnlinePct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="input-pill w-full"
              data-testid="alloc-online-pct"
            />
            <div className="text-[10.5px] text-muted mt-0.5">
              {onlinePct > 0 ? `~${Math.round(units * onlinePct / 100)} units to online next` : "0 units to online"}
            </div>
          </div>
          <div className="sm:col-span-2 text-[11px] text-amber-900">
            Balance to physical stores: <b>{Math.max(0, 100 - warehousePct - onlinePct)}%</b>
            {" "}(~{Math.max(0, units - Math.round(units * (warehousePct + onlinePct) / 100))} units)
            {(warehousePct + onlinePct) > 100 && (
              <span className="ml-2 text-rose-700 font-bold">⚠ Warehouse + Online exceed 100%</span>
            )}
          </div>
        </div>

        <div>
          <label className="eyebrow block mb-1.5">
            Sizes in this allocation · pack = {packUnitSize} units
          </label>
          <div className="flex flex-wrap gap-1.5" data-testid="alloc-sizes">
            {Object.entries(packTable).map(([sz, ratio]) => {
              const active = selectedSizes.includes(sz);
              return (
                <button
                  key={sz}
                  type="button"
                  onClick={() => toggleSize(sz)}
                  data-testid={`alloc-size-${sz}`}
                  className={`px-2.5 py-1 rounded-full text-[11.5px] font-bold border transition-colors ${
                    active
                      ? "bg-[#1a5c38] text-white border-[#1a5c38]"
                      : "bg-white text-[#374151] border-border hover:border-brand"
                  }`}
                  title={`${sz} = ${ratio} per pack`}
                >
                  {sz} <span className="opacity-70 font-normal">({ratio})</span>
                </button>
              );
            })}
          </div>
        </div>

        {previewPacks > 0 && (
          <div className="text-[11.5px] text-muted bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-flex items-center gap-2">
            <Cube size={12} weight="fill" className="text-amber-700" />
            With {units} units & this pack mix, you can ship <b className="mx-1 text-foreground">{previewPacks} full packs</b>
            ({previewUnits} units) · {leftover} units leftover.
          </div>
        )}

        {allStores.length > 0 && (
          <details className="text-[12px]">
            <summary className="cursor-pointer text-brand-deep font-semibold">
              Exclude stores ({excludedStores.length})
            </summary>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 mt-2" data-testid="alloc-exclude-stores">
              {allStores.map((s) => (
                <label key={s} className="inline-flex items-center gap-1.5 text-[11.5px]">
                  <input
                    type="checkbox"
                    checked={excludedStores.includes(s)}
                    onChange={() => toggleStoreExclusion(s)}
                    className="accent-brand"
                  />
                  <span className={excludedStores.includes(s) ? "line-through text-muted" : ""}>
                    {s}
                  </span>
                </label>
              ))}
            </div>
          </details>
        )}

        {error && <ErrorBox message={error} />}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={calculate}
            disabled={calculating || !subcategory || selectedSizes.length === 0}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-[#1a5c38] hover:bg-[#0f3d24] px-4 py-2 rounded-md disabled:opacity-50"
            data-testid="alloc-calculate"
          >
            <Calculator size={14} weight="bold" /> {calculating ? "Calculating…" : "Calculate allocation"}
          </button>
          {result && (
            <button
              type="button"
              onClick={exportCsv}
              className="text-[11.5px] font-semibold text-brand-deep border border-brand-deep/30 hover:bg-brand-deep/5 px-3 py-2 rounded-md"
              data-testid="alloc-export-csv"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {result && result.rows && (
        <>
        {/* Card 1 — Suggested allocation (read-only). The
            algorithm's recommendation. Shows score, sold, SOH so the
            user can see WHY each store gets what they get. */}
        <div className="card-white p-5" data-testid="allocation-result">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h2 className="font-extrabold text-[14px] text-[#0f3d24]">
              {styleName ? <>Suggested allocation for <span className="text-brand">{styleName}</span></> : "Suggested allocation"}
              {" · "}
              {result.allocated_units}/{result.requested_units} units
            </h2>
            <span className="text-[11px] text-muted">
              {result.available_packs} packs available · pack = {result.pack_unit_size} units
            </span>
          </div>
          {/* Tier breakdown — Warehouse → Online → Stores */}
          {(result.warehouse_units > 0 || result.online_units > 0) && (
            <div className="grid grid-cols-3 gap-2 mb-3 text-[12px]" data-testid="alloc-tier-breakdown">
              <div className="rounded-md border border-purple-300 bg-purple-50 px-3 py-2">
                <div className="eyebrow text-purple-800">1. Warehouse</div>
                <div className="font-extrabold text-[15px] num text-purple-900">
                  {fmtNum(result.warehouse_units || 0)} units
                </div>
              </div>
              <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2">
                <div className="eyebrow text-sky-800">2. Online</div>
                <div className="font-extrabold text-[15px] num text-sky-900">
                  {fmtNum(result.online_units || 0)} units
                </div>
              </div>
              <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2">
                <div className="eyebrow text-emerald-800">3. Stores</div>
                <div className="font-extrabold text-[15px] num text-emerald-900">
                  {fmtNum(result.store_units || 0)} units
                </div>
              </div>
            </div>
          )}
          {result.rows.length === 0 ? (
            <Empty label="No stores to allocate to with the current filters." />
          ) : (
            <SortableTable
              testId="allocation-suggestion-table"
              initialSort={{ key: "units_allocated", dir: "desc" }}
              rows={result.rows}
              columns={[
                {
                  key: "store", label: "Store", align: "left", mobilePrimary: true,
                  render: (r) => (
                    <span className="font-medium inline-flex items-center gap-1.5">
                      {r.channel === "warehouse" && (
                        <span className="text-[9.5px] font-bold uppercase tracking-wide bg-purple-100 text-purple-900 px-1.5 py-0.5 rounded">WH</span>
                      )}
                      {r.channel === "online" && (
                        <span className="text-[9.5px] font-bold uppercase tracking-wide bg-sky-100 text-sky-900 px-1.5 py-0.5 rounded">ONLINE</span>
                      )}
                      {r.store}
                    </span>
                  ),
                },
                {
                  key: "packs_allocated", label: "Packs", numeric: true,
                  render: (r) => <span className="pill-green font-bold">{r.packs_allocated}</span>,
                  csv: (r) => r.packs_allocated,
                },
                {
                  key: "units_allocated", label: "Units", numeric: true,
                  render: (r) => <span className="num font-bold">{fmtNum(r.units_allocated)}</span>,
                  csv: (r) => r.units_allocated,
                },
                ...Object.keys(result.pack_breakdown).map((sz) => ({
                  key: `size_${sz}`, label: sz, numeric: true,
                  render: (r) => fmtNum(r.sizes[sz] || 0),
                  sortValue: (r) => r.sizes[sz] || 0,
                  csv: (r) => r.sizes[sz] || 0,
                })),
                {
                  key: "units_sold_window", label: "Sold (window)", numeric: true,
                  render: (r) => fmtNum(r.units_sold_window),
                  csv: (r) => r.units_sold_window,
                },
                {
                  key: "current_soh", label: "Current SOH", numeric: true,
                  render: (r) => fmtNum(r.current_soh),
                  csv: (r) => r.current_soh,
                },
                {
                  key: "asp_kes", label: "ASP", numeric: true,
                  render: (r) => r.asp_kes > 0
                    ? <span className="num">{Math.round(r.asp_kes).toLocaleString("en-KE")}</span>
                    : <span className="text-muted">—</span>,
                  sortValue: (r) => r.asp_kes || 0,
                  csv: (r) => r.asp_kes,
                },
                {
                  key: "score", label: "Blend score", numeric: true,
                  render: (r) => <span className="num text-muted">{r.score.toFixed(3)}</span>,
                  csv: (r) => r.score,
                },
              ]}
            />
          )}
        </div>

        {/* Card 2 — Buying Plan. Buying team edits the per-store
            pack count, then sends to warehouse. The warehouse then
            does its own size-level fulfilment in the Pending queue
            below. */}
        <div className="card-white p-5" data-testid="warehouse-tracker">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h2 className="font-extrabold text-[14px] text-[#0f3d24]">
              Step 1 · Buying Plan
            </h2>
            <span className="text-[10.5px] font-bold uppercase tracking-wide bg-blue-100 text-blue-900 px-1.5 py-0.5 rounded">
              buying team
            </span>
            <span className="text-[11px] text-muted">
              Adjust packs per store · click "Send to Warehouse" to hand off
            </span>
          </div>
          <p className="text-[12px] text-muted mb-3">
            By default each row equals the suggestion above. Edit pack counts
            for any store you want to adjust, then send to warehouse. The
            warehouse team will fulfil at the size level in the queue below.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <div className="rounded-md border border-border bg-panel px-3 py-2">
              <div className="eyebrow">Suggested total</div>
              <div className="font-extrabold text-[16px] num">{fmtNum(result.allocated_units)} units</div>
            </div>
            <div className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2">
              <div className="eyebrow text-blue-800">Buying plan total</div>
              <div className="font-extrabold text-[16px] num text-blue-900">{fmtNum(totalAllocatedAfterOverrides)} units</div>
            </div>
            <div className={`rounded-md border px-3 py-2 ${
              totalAllocatedAfterOverrides === result.allocated_units
                ? "border-emerald-300 bg-emerald-50"
                : "border-amber-300 bg-amber-50"
            }`}>
              <div className="eyebrow">Variance</div>
              <div className={`font-extrabold text-[16px] num ${
                totalAllocatedAfterOverrides > result.allocated_units
                  ? "text-amber-700" : totalAllocatedAfterOverrides < result.allocated_units
                  ? "text-rose-700" : "text-emerald-700"
              }`}>
                {totalAllocatedAfterOverrides - result.allocated_units > 0 ? "+" : ""}
                {totalAllocatedAfterOverrides - result.allocated_units} units
                {overriddenCount > 0 && (
                  <span className="ml-2 text-[11px] font-semibold">
                    · {overriddenCount} store{overriddenCount === 1 ? "" : "s"} edited
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            {overriddenCount > 0 && (
              <button
                type="button"
                onClick={resetOverrides}
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700 border border-amber-300 hover:bg-amber-50 px-2.5 py-1.5 rounded-md"
                data-testid="alloc-reset-overrides"
              >
                <ArrowCounterClockwise size={12} weight="bold" /> Reset to suggested
              </button>
            )}
            <button
              type="button"
              onClick={saveRun}
              disabled={savingRun || !styleName.trim()}
              title={!styleName.trim() ? "Add a style name above before saving" : "Send this buying plan to the warehouse for size-level fulfilment"}
              className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white bg-[#1a5c38] hover:bg-[#0f3d24] px-3 py-2 rounded-md disabled:opacity-50"
              data-testid="alloc-save-run"
            >
              <FloppyDisk size={12} weight="bold" /> {savingRun ? "Sending…" : "Send to Warehouse"}
            </button>
          </div>

          {savedToast && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 mb-3">
              {savedToast}
            </div>
          )}
          {error && <ErrorBox message={error} />}

          <SortableTable
            testId="warehouse-tracker-table"
            initialSort={{ key: "suggested_packs", dir: "desc" }}
            rows={effectiveRows}
            columns={[
              {
                key: "store", label: "Store", align: "left", mobilePrimary: true,
                render: (r) => (
                  <span className="font-medium">
                    {r.store}
                    {r.is_overridden && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-900 px-1 py-0.5 rounded">
                        edited
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "suggested_packs", label: "Suggested packs", numeric: true,
                render: (r) => <span className="num text-muted">{r.suggested_packs}</span>,
              },
              {
                key: "actual_packs", label: "Buying packs (editable)", numeric: true, sortable: false,
                render: (r) => (
                  <input
                    type="number"
                    min={0}
                    value={packOverrides[r.store] ?? r.packs_allocated}
                    onChange={(e) => setPackOverride(r.store, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className={`w-16 px-1.5 py-0.5 text-right text-[12px] tabular-nums border rounded font-bold ${
                      r.is_overridden
                        ? "bg-amber-50 border-amber-400 text-amber-900"
                        : "bg-white border-border text-emerald-700"
                    }`}
                    data-testid={`alloc-packs-input-${r.store}`}
                  />
                ),
              },
              {
                key: "delta_packs", label: "Δ packs", numeric: true,
                render: (r) => {
                  const d = r.packs_allocated - r.suggested_packs;
                  if (d === 0) return <span className="text-muted">—</span>;
                  return (
                    <span className={`num font-semibold ${d > 0 ? "text-amber-700" : "text-rose-700"}`}>
                      {d > 0 ? `+${d}` : d}
                    </span>
                  );
                },
                sortValue: (r) => r.packs_allocated - r.suggested_packs,
              },
              {
                key: "actual_units", label: "Buying units", numeric: true,
                render: (r) => <span className="num font-bold">{fmtNum(r.units_allocated)}</span>,
                sortValue: (r) => r.units_allocated,
              },
              {
                key: "fulfil_pct", label: "Vs suggested", numeric: true,
                render: (r) => {
                  if (!r.suggested_units) return <span className="text-muted">—</span>;
                  const pct = (r.units_allocated / r.suggested_units) * 100;
                  const cls = pct >= 100 ? "pill-green" : pct >= 80 ? "pill-amber" : "pill-red";
                  return <span className={cls}>{pct.toFixed(0)}%</span>;
                },
                sortValue: (r) => r.suggested_units ? r.units_allocated / r.suggested_units : 0,
              },
              ...Object.keys(result.pack_breakdown).map((sz) => ({
                key: `size_${sz}`, label: sz, numeric: true,
                render: (r) => fmtNum(r.sizes[sz] || 0),
                sortValue: (r) => r.sizes[sz] || 0,
              })),
            ]}
          />
        </div>
        </>
      )}

      <AllocationPendingQueue
        refreshKey={historyRefresh}
        onFulfilled={() => setHistoryRefresh((n) => n + 1)}
      />

      <AllocationRunsHistory refreshKey={historyRefresh} optimisticRun={optimisticRun} />
    </div>
  );
};

export default Allocations;
