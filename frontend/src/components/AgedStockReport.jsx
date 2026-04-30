import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, SectionTitle } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { Hourglass } from "@phosphor-icons/react";

const PRESETS = [30, 60, 90, 180];

/**
 * Aged Stock Report — per-SKU view of inventory that has not been
 * selling in the selected look-back. Filterable by min days-since-
 * last-sale, POS location, and product search. Shipped on the Re-Order
 * page so the merchandiser can spot markdown / IBT candidates next to
 * the active replenishment list.
 */
const AgedStockReport = () => {
  const [minDays, setMinDays] = useState(60);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get("/analytics/aged-stock", {
      params: { min_days_since_sale: minDays },
      timeout: 240000,
    })
      .then((r) => { if (!cancelled) setRows(r.data || []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [minDays]);

  // POS dropdown is built from the current result set so the user only
  // sees stores that actually have aged stock.
  const allPos = useMemo(() => {
    const set = new Set();
    for (const r of rows) if (r.pos_location) set.add(r.pos_location);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (posFilter && r.pos_location !== posFilter) return false;
      if (!q) return true;
      const hay = `${r.product_name || ""} ${r.sku || ""} ${r.barcode || ""} ${r.color || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, posFilter]);

  const totals = useMemo(() => {
    const soh = filtered.reduce((s, r) => s + (r.soh || 0), 0);
    const wh = filtered.reduce((s, r) => s + (r.soh_warehouse || 0), 0);
    return { soh, wh, count: filtered.length };
  }, [filtered]);

  return (
    <div className="card-white p-5" data-testid="aged-stock-report">
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <Hourglass size={16} weight="duotone" className="text-amber-700" />
            Aged Stock Report
          </span>
        }
        subtitle={`Per-SKU stock that hasn't sold in ${minDays}+ days at its store. Use this to drive markdowns, IBT to high-velocity locations, or returns to warehouse. Warehouse SOH is shown so you know the full replenishable footprint of each style.`}
      />

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="eyebrow">Min days since last sale</span>
        <div className="inline-flex rounded-md overflow-hidden border border-border" data-testid="aged-days-toggle">
          {PRESETS.map((d) => (
            <button
              key={d}
              onClick={() => setMinDays(d)}
              data-testid={`aged-days-${d}`}
              className={`text-[11px] font-bold px-3 py-1.5 transition-colors ${minDays === d ? "bg-[#1a5c38] text-white" : "bg-white text-[#1a5c38] hover:bg-[#fef3e0]"}`}
            >
              {d} days
            </button>
          ))}
          <input
            type="number"
            min={0}
            max={365}
            value={minDays}
            onChange={(e) => {
              const v = Math.max(0, Math.min(365, parseInt(e.target.value || "0", 10)));
              setMinDays(v);
            }}
            className="text-[11px] font-bold px-2 py-1.5 w-16 outline-none border-l border-border"
            data-testid="aged-days-custom"
            aria-label="Custom days threshold"
          />
        </div>

        <select
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value)}
          className="input-pill text-[12px]"
          data-testid="aged-pos-filter"
        >
          <option value="">All POS ({allPos.length})</option>
          {allPos.map((p) => <option key={p}>{p}</option>)}
        </select>

        <input
          type="text"
          placeholder="Search product / SKU / barcode / color"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-pill text-[12px] flex-1 min-w-[220px]"
          data-testid="aged-search"
        />
      </div>

      {loading ? (
        <Loading label="Computing aged stock — first run takes ~60s, then 10-min cache." />
      ) : (
        <>
          <div className="text-[12px] text-muted mb-2" data-testid="aged-totals">
            <strong>{fmtNum(totals.count)}</strong> SKU-store rows ·
            <strong> {fmtNum(totals.soh)}</strong> units in store ·
            <strong> {fmtNum(totals.wh)}</strong> units in warehouse
          </div>
          <SortableTable
            testId="aged-stock-table"
            exportName={`aged-stock_${minDays}d.csv`}
            pageSize={25}
            initialSort={{ key: "days_since_last_sale", dir: "desc" }}
            secondarySort={{ key: "soh", dir: "desc" }}
            columns={[
              { key: "pos_location", label: "POS", align: "left",
                render: (r) => <span className="pill-neutral text-[10.5px]">{r.pos_location}</span> },
              { key: "product_name", label: "Product", align: "left",
                render: (r) => (
                  <div className="max-w-[260px]">
                    <div className="font-medium text-[12px] leading-snug overflow-hidden"
                         style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                         title={r.product_name}>
                      {r.product_name || "—"}
                    </div>
                    {r.color && <div className="text-[10px] text-muted truncate">{r.color}</div>}
                  </div>
                ),
                csv: (r) => r.product_name },
              { key: "size", label: "Size", align: "left",
                render: (r) => <span className="font-mono text-[11px]">{r.size || "—"}</span> },
              { key: "barcode", label: "Barcode", align: "left",
                render: (r) => <span className="font-mono text-[10.5px] text-muted">{r.barcode || "—"}</span> },
              { key: "units_sold_180d", label: "Units Sold (180d)", numeric: true,
                render: (r) => fmtNum(r.units_sold_180d) },
              { key: "soh", label: "SOH (store)", numeric: true,
                render: (r) => <span className="font-bold">{fmtNum(r.soh)}</span> },
              { key: "soh_warehouse", label: "SOH (warehouse)", numeric: true,
                render: (r) => <span className="text-muted">{fmtNum(r.soh_warehouse)}</span> },
              { key: "days_since_last_sale", label: "Days Since Last Sale", numeric: true,
                render: (r) => {
                  const d = r.days_since_last_sale;
                  const cls = d >= 180 ? "pill-red" : d >= 90 ? "pill-amber" : "pill-neutral";
                  const label = d >= 999 ? "Never (180d+)" : `${d} days`;
                  return <span className={cls}>{label}</span>;
                },
                csv: (r) => r.days_since_last_sale >= 999 ? "Never" : r.days_since_last_sale },
              { key: "last_sale_date", label: "Last Sale", align: "left",
                render: (r) => r.last_sale_date || <span className="text-muted text-[11px]">—</span> },
            ]}
            rows={filtered}
          />
        </>
      )}
    </div>
  );
};

export default AgedStockReport;
