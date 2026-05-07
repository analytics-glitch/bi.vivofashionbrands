import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { Stack, Calculator, Cube } from "@phosphor-icons/react";
import { useFilters } from "@/lib/filters";

/**
 * Allocations — given a units pool + chosen sizes/colour, recommend
 * how many size packs each store should receive based on a blended
 * velocity (sales) + low-stock score. Sized in whole packs (size
 * ratios from leadership table). Online channels excluded.
 */
const Allocations = () => {
  const { applied } = useFilters();
  const { dateFrom, dateTo } = applied;
  const [packTable, setPackTable] = useState({});
  const [subcategory, setSubcategory] = useState("");
  const [color, setColor] = useState("");
  const [units, setUnits] = useState(400);
  const [selectedSizes, setSelectedSizes] = useState(["S", "M", "L"]);
  const [velocityWeight, setVelocityWeight] = useState(0.5);
  const [subcatOptions, setSubcatOptions] = useState([]);
  const [excludedStores, setExcludedStores] = useState([]);
  const [allStores, setAllStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

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
    if (packUnitSize > units) {
      setError(`A pack of these sizes is ${packUnitSize} units — you only have ${units}.`);
      return;
    }
    setCalculating(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post("/allocations/calculate", {
        subcategory,
        color: color || null,
        sizes: selectedSizes,
        units_total: Number(units),
        date_from: dateFrom,
        date_to: dateTo,
        velocity_weight: Number(velocityWeight),
        excluded_stores: excludedStores,
      }, { timeout: 120000 });
      setResult(data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Calculation failed");
    } finally {
      setCalculating(false);
    }
  };

  const exportCsv = () => {
    if (!result?.rows?.length) return;
    const sizeKeys = Object.keys(result.pack_breakdown);
    const header = ["Store", "Packs", "Total Units", ...sizeKeys.map((s) => `${s} units`), "Velocity Score", "Low-Stock Score", "Sold (window)", "Current SOH"];
    const lines = [header.join(",")];
    result.rows.forEach((r) => {
      lines.push([
        `"${r.store.replace(/"/g, '""')}"`,
        r.packs_allocated, r.units_allocated,
        ...sizeKeys.map((s) => r.sizes[s] || 0),
        r.velocity_score.toFixed(4), r.low_stock_score.toFixed(4),
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
            <label className="eyebrow block mb-1">
              Velocity ↔ Low-stock weight ({velocityWeight.toFixed(2)})
            </label>
            <input
              type="range"
              min={0} max={1} step={0.05}
              value={velocityWeight}
              onChange={(e) => setVelocityWeight(Number(e.target.value))}
              className="w-full"
              data-testid="alloc-velocity-weight"
            />
            <div className="flex justify-between text-[10.5px] text-muted">
              <span>Pure low-stock</span>
              <span>50/50</span>
              <span>Pure velocity</span>
            </div>
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
        <div className="card-white p-5" data-testid="allocation-result">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h2 className="font-extrabold text-[14px] text-[#0f3d24]">
              Suggested allocation · {result.allocated_units}/{result.requested_units} units
            </h2>
            <span className="text-[11px] text-muted">
              {result.available_packs} packs · {result.leftover_units} units leftover
            </span>
          </div>
          {result.rows.length === 0 ? (
            <Empty label="No stores to allocate to with the current filters." />
          ) : (
            <SortableTable
              testId="allocation-table"
              initialSort={{ key: "units_allocated", dir: "desc" }}
              rows={result.rows}
              columns={[
                {
                  key: "store", label: "Store", align: "left", mobilePrimary: true,
                  render: (r) => <span className="font-medium">{r.store}</span>,
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
                  key: "score", label: "Blend score", numeric: true,
                  render: (r) => <span className="num text-muted">{r.score.toFixed(3)}</span>,
                  csv: (r) => r.score,
                },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default Allocations;
