import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle } from "@/components/common";
import IBTFlatTable from "@/components/IBTFlatTable";
import { Warehouse } from "@phosphor-icons/react";

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
 * Now uses the same flat SKU-level table as the store-to-store list,
 * with Color / Size / SKU / Barcode columns inline plus an actual-
 * transferred input on every row.
 */
const WarehouseToStoreIBT = ({ dateFrom, dateTo, countries = [], onMarkDone, completedSkuKeys = new Set() }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
  }, [dateFrom, dateTo, JSON.stringify(countries)]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const units = rows.reduce((s, r) => s + (r.suggested_qty || 0), 0);
    const stores = new Set(rows.map((r) => r.to_store)).size;
    return { units, stores, rows: rows.length };
  }, [rows]);

  // Adapt warehouse rows to look like store-to-store suggestions for the flat table.
  const adaptedSuggestions = useMemo(
    () => rows.map((r) => ({
      ...r,
      from_store: "Warehouse Finished Goods",
      // the flat table reads `units_to_move` for store-to-store, but for
      // warehouse flow it reads `suggested_qty`; keep both for safety.
      units_to_move: r.suggested_qty,
    })),
    [rows]
  );

  return (
    <div className="card-white p-4 sm:p-5 mt-6" data-testid="warehouse-to-store-ibt">
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <Warehouse size={16} weight="duotone" className="text-brand-deep" />
            Warehouse → Store transfer list
          </span>
        }
        subtitle={
          <>
            Styles that are <b>selling</b> at a store but shop-floor stock
            is below a 3-day safety floor, and the warehouse has inventory.
            Each row is one SKU — type the units actually transferred and
            tap Mark As Done.
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
        <IBTFlatTable
          suggestions={adaptedSuggestions}
          flow="warehouse_to_store"
          onMarkDone={(payload) => onMarkDone?.(payload)}
          completedSkuKeys={completedSkuKeys}
          testId="wh-ibt-table"
          emptyLabel="No warehouse→store gaps detected — shop-floors are covered for the next 3 days."
        />
      )}
    </div>
  );
};

export default WarehouseToStoreIBT;
