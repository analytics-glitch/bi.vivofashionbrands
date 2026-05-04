import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import RecommendationActionPill from "@/components/RecommendationActionPill";
import ProductThumbnail from "@/components/ProductThumbnail";
import IBTSkuBreakdown from "@/components/IBTSkuBreakdown";
import WarehouseToStoreIBT from "@/components/WarehouseToStoreIBT";
import { useThumbnails } from "@/lib/useThumbnails";
import { useRecommendationState } from "@/lib/useRecommendationState";
import { ArrowRight, Truck, Coins, Package, MagnifyingGlass, CaretDown, CaretRight } from "@phosphor-icons/react";

const ibtKey = (r) => `${r.style_name}||${r.from_store}||${r.to_store}`;

const IBT = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, dataVersion } = applied;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const { stateByKey, setState } = useRecommendationState("ibt");

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

  // Hide resolved moves unless the user explicitly asks to see them.
  const visible = useMemo(() => {
    if (showResolved) return filtered;
    return filtered.filter((r) => {
      const s = stateByKey.get(ibtKey(r))?.status;
      return !s || s === "pending";
    });
  }, [filtered, stateByKey, showResolved]);

  const kpis = useMemo(() => {
    const totalUplift = filtered.reduce((s, r) => s + (r.estimated_uplift || 0), 0);
    const totalUnits = filtered.reduce((s, r) => s + (r.units_to_move || 0), 0);
    const storesInvolved = new Set();
    filtered.forEach((r) => { storesInvolved.add(r.from_store); storesInvolved.add(r.to_store); });
    const resolved = filtered.filter((r) => {
      const s = stateByKey.get(ibtKey(r))?.status;
      return s && s !== "pending";
    }).length;
    return {
      moves: filtered.length,
      totalUnits,
      totalUplift,
      storesInvolved: storesInvolved.size,
      resolved,
    };
  }, [filtered, stateByKey]);

  const { urlFor } = useThumbnails(useMemo(() => visible.map((r) => r.style_name), [visible]));

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
            <KPICard testId="ibt-kpi-moves" accent label="Open moves"
              sub={kpis.resolved > 0 ? `${kpis.resolved} already actioned` : "All pending review"}
              value={fmtNum(kpis.moves - kpis.resolved)} icon={Truck} showDelta={false} />
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
            <button
              type="button"
              onClick={async () => {
                // Detailed CSV: one row per (IBT suggestion × SKU) so
                // the picker team gets color + size on every line.
                // Fetch the SKU breakdown for each visible row in
                // parallel (bounded to 6 at a time so we don't
                // hammer the upstream) and flatten.
                const CONCURRENCY = 6;
                const out = [];
                const header = [
                  "Style", "Brand", "Subcategory", "From Store", "To Store",
                  "SKU", "Color", "Size", "Stock at FROM", "Stock at TO",
                  "Suggested Qty", "Row Uplift (KES)",
                ];
                out.push(header);
                const queue = visible.slice();
                const worker = async () => {
                  while (queue.length) {
                    const r = queue.shift();
                    if (!r) return;
                    try {
                      const { data } = await api.get("/analytics/ibt-sku-breakdown", {
                        params: {
                          style_name: r.style_name,
                          from_store: r.from_store,
                          to_store: r.to_store,
                          units_to_move: r.units_to_move,
                        },
                        timeout: 60000,
                      });
                      const skus = (data?.skus || []).filter((s) => s.suggested_qty > 0);
                      if (skus.length === 0) {
                        out.push([
                          r.style_name, r.brand || "", r.subcategory || "",
                          r.from_store, r.to_store, "", "", "",
                          "", "", r.units_to_move, Math.round(r.estimated_uplift || 0),
                        ]);
                      } else {
                        skus.forEach((s) => {
                          out.push([
                            r.style_name, r.brand || "", r.subcategory || "",
                            r.from_store, r.to_store, s.sku, s.color || "",
                            s.size || "", s.from_available, s.to_available,
                            s.suggested_qty,
                            // Pro-rata the row uplift across SKUs by suggested qty.
                            Math.round(
                              (r.estimated_uplift || 0) *
                              (s.suggested_qty / Math.max(1, r.units_to_move))
                            ),
                          ]);
                        });
                      }
                    } catch { /* ignore this row — partial export is better than nothing */ }
                  }
                };
                await Promise.all(Array.from({ length: CONCURRENCY }, worker));
                const csv = out.map((row) =>
                  row.map((cell) => {
                    const v = cell == null ? "" : String(cell);
                    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
                  }).join(",")
                ).join("\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `ibt-detailed-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(link.href);
              }}
              className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white bg-brand hover:bg-brand-deep px-3 py-2 rounded-md disabled:opacity-50"
              disabled={visible.length === 0}
              data-testid="ibt-export-detailed"
              title="Export every IBT suggestion expanded to its SKUs — includes color, size, barcode-ready stock-at-FROM / stock-at-TO and per-SKU suggested move qty."
            >
              Export with color & size
            </button>
          </div>

          <div className="card-white p-5" data-testid="ibt-table-card">
            <SectionTitle
              title={`Transfer list · ${visible.length} of ${filtered.length} suggested moves${showResolved ? "" : " pending"}`}
              subtitle="Proposed inter-branch transfers — move surplus stock from source stores to understocked destinations. Mark each move as dispatched / dismissed so tomorrow's list only shows what's still open."
              action={
                <label className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-brand-deep cursor-pointer" data-testid="ibt-show-resolved">
                  <input
                    type="checkbox"
                    checked={showResolved}
                    onChange={(e) => setShowResolved(e.target.checked)}
                    className="accent-brand"
                  />
                  Show resolved ({kpis.resolved})
                </label>
              }
            />
            {visible.length === 0 ? (
              <Empty label={filtered.length === 0
                ? "No transfer opportunities found for the current window. Try widening the date range."
                : "🎉 All transfer moves have been actioned. Toggle 'Show resolved' to review."} />
            ) : (
              <SortableTable
                testId="ibt-table"
                exportName="ibt-suggestions.csv"
                pageSize={50}
                mobileCards
                initialSort={{ key: "estimated_uplift", dir: "desc" }}
                rowKey={(r) => ibtKey(r)}
                renderExpanded={(r) => <IBTSkuBreakdown row={r} />}
                columns={[
                  {
                    key: "thumb",
                    label: "",
                    align: "left",
                    sortable: false,
                    mobileHidden: true,
                    render: (r) => <ProductThumbnail style={r.style_name} url={urlFor(r.style_name)} size={36} />,
                    csv: () => "",
                  },
                  {
                    key: "style_name",
                    label: "Style",
                    align: "left",
                    mobilePrimary: true,
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
                  {
                    key: "__action", label: "Action", align: "left", sortable: false,
                    render: (r) => {
                      const k = ibtKey(r);
                      return (
                        <span onClick={(e) => e.stopPropagation()}>
                          <RecommendationActionPill
                            itemKey={k}
                            state={stateByKey.get(k)}
                            onChange={(status, opts) => setState(k, status, opts)}
                            label="transfer"
                          />
                        </span>
                      );
                    },
                    csv: (r) => stateByKey.get(ibtKey(r))?.status || "pending",
                  },
                ]}
                rows={visible}
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

          <WarehouseToStoreIBT dateFrom={dateFrom} dateTo={dateTo} countries={countries} />
        </>
      )}
    </div>
  );
};

export default IBT;
