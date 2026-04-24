import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { ArrowRight, Truck, Coins, Package, MagnifyingGlass } from "@phosphor-icons/react";

const IBT = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, dataVersion } = applied;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const country = countries.length === 1 ? countries[0] : undefined;
    api
      .get("/analytics/ibt-suggestions", {
        params: { date_from: dateFrom, date_to: dateTo, country, limit: 300 },
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
  }, [dateFrom, dateTo, JSON.stringify(countries), dataVersion]);

  const brands = useMemo(
    () => Array.from(new Set(rows.map((r) => r.brand).filter(Boolean))).sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (brandFilter && r.brand !== brandFilter) return false;
      if (!q) return true;
      return (
        (r.style_name || "").toLowerCase().includes(q) ||
        (r.from_store || "").toLowerCase().includes(q) ||
        (r.to_store || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, brandFilter]);

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
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">
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
            <KPICard testId="ibt-kpi-moves" accent label="Moves Suggested" value={fmtNum(kpis.moves)} icon={Truck} showDelta={false} />
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
          </div>

          <div className="card-white p-5" data-testid="ibt-table-card">
            <SectionTitle
              title={`Transfer list · ${filtered.length} suggested moves`}
              subtitle="Proposed inter-branch transfers — move surplus stock from source stores to understocked destinations to prevent lost sales. Sorted by estimated revenue uplift descending. Export to your logistics workflow."
            />
            {filtered.length === 0 ? (
              <Empty label="No transfer opportunities found for the current window. Try widening the date range." />
            ) : (
              <SortableTable
                testId="ibt-table"
                exportName="ibt-suggestions.csv"
                pageSize={50}
                initialSort={{ key: "estimated_uplift", dir: "desc" }}
                columns={[
                  {
                    key: "style_name",
                    label: "Style",
                    align: "left",
                    render: (r) => (
                      <div className="max-w-[260px]">
                        <div className="font-medium break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                          {r.style_name}
                        </div>
                        <div className="text-[10.5px] text-muted mt-0.5">
                          {r.brand} · {r.subcategory}
                        </div>
                      </div>
                    ),
                    csv: (r) => r.style_name,
                  },
                  {
                    key: "from_store",
                    label: "From",
                    align: "left",
                    render: (r) => (
                      <div>
                        <div className="font-semibold text-[12.5px]">{r.from_store}</div>
                        <div className="text-[10.5px] text-muted num">
                          {r.from_available} in stock · {r.from_units_sold} sold
                        </div>
                      </div>
                    ),
                    csv: (r) => r.from_store,
                  },
                  {
                    key: "arrow", label: "", sortable: false, align: "left",
                    render: () => <ArrowRight size={14} className="text-brand" weight="bold" />,
                  },
                  {
                    key: "to_store",
                    label: "To",
                    align: "left",
                    render: (r) => (
                      <div>
                        <div className="font-semibold text-[12.5px] text-brand">{r.to_store}</div>
                        <div className="text-[10.5px] text-muted num">
                          {r.to_available} in stock · {r.to_units_sold} sold
                        </div>
                      </div>
                    ),
                    csv: (r) => r.to_store,
                  },
                  {
                    key: "units_to_move",
                    label: "Qty",
                    numeric: true,
                    render: (r) => <span className="pill-green font-bold">{fmtNum(r.units_to_move)}</span>,
                    csv: (r) => r.units_to_move,
                  },
                  {
                    key: "estimated_uplift",
                    label: "Est. Uplift",
                    numeric: true,
                    render: (r) => <span className="text-brand font-bold">{fmtKES(r.estimated_uplift)}</span>,
                    csv: (r) => r.estimated_uplift,
                  },
                ]}
                rows={filtered}
              />
            )}
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
              excluded.
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default IBT;
