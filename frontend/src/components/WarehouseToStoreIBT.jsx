import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import IBTSkuBreakdown from "@/components/IBTSkuBreakdown";
import { Warehouse, MagnifyingGlass, CheckCircle } from "@phosphor-icons/react";

/**
 * Warehouse → Store replenishment suggestions.
 *
 * Companion to the store-to-store IBT table above it. Lists (style × store)
 * pairs where the store is SELLING but the shop-floor stock is below
 * the 3-day safety floor, while warehouse stock for that style is
 * available. Different from store-to-store IBT because the warehouse
 * side has zero sales by construction — the signal is pure velocity
 * vs. shop-floor shortage.
 *
 * Rendered as its own section so users can action warehouse picks
 * separately from floor-to-floor moves (different ops team, different
 * dock door).
 */
const WarehouseToStoreIBT = ({ dateFrom, dateTo, countries = [], onMarkDone, completedKeys = new Set() }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const country = countries.length === 1 ? countries[0] : undefined;
    api
      .get("/analytics/ibt-warehouse-to-store", {
        params: { date_from: dateFrom, date_to: dateTo, country, limit: 300 },
        timeout: 240000,
      })
      .then(({ data }) => { if (!cancelled) setRows(data || []); })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, JSON.stringify(countries)]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // Hide rows already actioned via Mark-as-Done.
      if (completedKeys.has(`${r.style_name}||${r.to_store}`)) return false;
      if (!q) return true;
      return (
        (r.style_name || "").toLowerCase().includes(q) ||
        (r.to_store || "").toLowerCase().includes(q) ||
        (r.brand || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, completedKeys]);

  const totals = useMemo(() => {
    const units = filtered.reduce((s, r) => s + (r.suggested_qty || 0), 0);
    const stores = new Set(filtered.map((r) => r.to_store)).size;
    return { units, stores, rows: filtered.length };
  }, [filtered]);

  return (
    <div className="card-white p-5 mt-6" data-testid="warehouse-to-store-ibt">
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <Warehouse size={16} weight="duotone" className="text-brand-deep" />
            Warehouse → Store suggestions
          </span>
        }
        subtitle={
          <>
            Styles that are <b>selling</b> at a store but shop-floor stock
            is below a 3-day safety floor, and the warehouse has inventory.
            Suggested qty fills toward a 4-week cover target, capped by
            warehouse availability.
          </>
        }
        aside={
          <div className="flex items-center gap-3 text-[11.5px] text-muted">
            <span className="font-semibold">{fmtNum(totals.rows)}</span> pairs ·
            <span className="font-semibold ml-1">{fmtNum(totals.units)}</span> units
            across <span className="font-semibold ml-1">{totals.stores}</span> stores
          </div>
        }
      />
      {loading && <Loading label="Scanning warehouse coverage gaps…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && (
        <>
          <div className="flex items-center gap-2 input-pill max-w-sm mb-3">
            <MagnifyingGlass size={14} className="text-muted" />
            <input
              placeholder="Search style, store or brand…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="wh-ibt-search"
              className="bg-transparent outline-none text-[13px] w-full"
            />
          </div>
          {filtered.length === 0 ? (
            <Empty label="No warehouse→store gaps detected — shop-floors are covered for the next 3 days." />
          ) : (
            <SortableTable
              testId="wh-ibt-table"
              exportName="warehouse-to-store-ibt.csv"
              pageSize={50}
              mobileCards
              initialSort={{ key: "missed_sales_risk", dir: "desc" }}
              rowKey={(r) => `${r.style_name}||${r.to_store}`}
              renderExpanded={(r) => (
                <IBTSkuBreakdown
                  row={{
                    style_name: r.style_name,
                    from_store: "Warehouse Finished Goods",
                    to_store: r.to_store,
                    units_to_move: r.suggested_qty,
                  }}
                />
              )}
              columns={[
                {
                  key: "style_name", label: "Style", align: "left", mobilePrimary: true,
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
                },
                { key: "to_store", label: "Store", align: "left" },
                { key: "units_sold", label: "Sold (window)", numeric: true, render: (r) => fmtNum(r.units_sold) },
                {
                  key: "weekly_velocity", label: "Weekly velocity", numeric: true,
                  render: (r) => <span className="num">{r.weekly_velocity.toFixed(1)}/wk</span>,
                  csv: (r) => r.weekly_velocity,
                },
                {
                  key: "store_soh", label: "Shop-floor SOH", numeric: true,
                  render: (r) => {
                    const v = r.store_soh;
                    const cls = v === 0 ? "pill-red" : v < 3 ? "pill-amber" : "pill-neutral";
                    return <span className={cls}>{fmtNum(v)}</span>;
                  },
                },
                {
                  key: "days_of_cover", label: "Days of cover", numeric: true,
                  render: (r) => r.days_of_cover == null ? "—" : <span className="num">{r.days_of_cover.toFixed(1)}d</span>,
                  csv: (r) => r.days_of_cover,
                },
                {
                  key: "warehouse_available", label: "Warehouse SOH", numeric: true,
                  render: (r) => <span className="pill-green">{fmtNum(r.warehouse_available)}</span>,
                },
                {
                  key: "suggested_qty", label: "Move qty", numeric: true,
                  render: (r) => <span className="num font-bold">{fmtNum(r.suggested_qty)}</span>,
                },
                {
                  key: "missed_sales_risk", label: "Risk score", numeric: true,
                  render: (r) => <span className="num text-muted">{r.missed_sales_risk.toFixed(2)}</span>,
                  csv: (r) => r.missed_sales_risk,
                },
                onMarkDone && {
                  key: "__mark_done", label: "", sortable: false, align: "left",
                  render: (r) => (
                    <span onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onMarkDone({
                          ...r,
                          from_store: "Warehouse Finished Goods",
                          units_to_move: r.suggested_qty,
                          flow: "warehouse_to_store",
                        })}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 px-2 py-0.5 rounded-full"
                        title="Mark this transfer as completed — log PO# and date"
                        data-testid={`wh-ibt-mark-done-${(r.style_name || "").slice(0,15)}`}
                      >
                        <CheckCircle size={11} weight="fill" /> Done
                      </button>
                    </span>
                  ),
                  csv: () => "",
                },
              ].filter(Boolean)}
              rows={filtered}
            />
          )}
        </>
      )}
    </div>
  );
};

export default WarehouseToStoreIBT;
