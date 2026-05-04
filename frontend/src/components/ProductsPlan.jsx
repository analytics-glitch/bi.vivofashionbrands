import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum, fmtKES, fmtPct } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";

/**
 * Stock to Sales — Products Plan
 *
 * Sub-category composition view for merchandisers. Each row is one
 * sub-category with sales, SOR, units-sold, and SOH split across
 * stores vs warehouse — each alongside its % of the group total.
 *
 * Design choices:
 *   • Grand-total strip at the bottom of the card shows the absolute
 *     totals used as the % denominators, so the user can double-check
 *     math at a glance.
 *   • "% columns" sit right after each absolute column (not
 *     end-of-table) so the eye can read absolute+share together.
 *   • Category cell sticks — group-by-category visual cue without
 *     needing an accordion (there are < 50 rows typically).
 */
const ProductsPlan = () => {
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries = [], channels = [] } = applied || {};
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get("/analytics/products-plan", {
        params: {
          date_from: dateFrom,
          date_to: dateTo,
          country: countries.length === 1 ? countries[0] : undefined,
          channel: channels.length ? channels.join(",") : undefined,
        },
        timeout: 180000,
      })
      .then(({ data }) => { if (!cancelled) setRows(data || []); })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels)]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        total_sales: acc.total_sales + (r.total_sales || 0),
        qty_sold: acc.qty_sold + (r.qty_sold || 0),
        total_soh: acc.total_soh + (r.total_soh || 0),
        stores_soh: acc.stores_soh + (r.stores_soh || 0),
        wh_soh: acc.wh_soh + (r.wh_soh || 0),
      }),
      { total_sales: 0, qty_sold: 0, total_soh: 0, stores_soh: 0, wh_soh: 0 }
    );
  }, [rows]);

  const groupSor =
    totals.qty_sold + totals.total_soh > 0
      ? (totals.qty_sold / (totals.qty_sold + totals.total_soh)) * 100
      : 0;

  return (
    <div className="card-white p-5" data-testid="products-plan">
      <SectionTitle
        title="Stock to Sales — Products Plan"
        subtitle={
          <>
            Sub-category composition in the current window. Each % column
            shows that sub-cat's share of the corresponding group total —
            useful to spot mismatches (e.g. 17% of sales but only 8% of
            warehouse backstock).
          </>
        }
      />
      {loading && <Loading label="Aggregating plan…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && (
        rows.length === 0 ? (
          <Empty label="No product-plan data for the selected window." />
        ) : (
          <>
            <SortableTable
              testId="products-plan-table"
              exportName="products-plan.csv"
              pageSize={50}
              mobileCards
              initialSort={{ key: "qty_sold", dir: "desc" }}
              columns={[
                {
                  key: "category", label: "Category", align: "left",
                  mobilePrimary: true,
                  render: (r) => (
                    <span className="font-semibold text-brand-deep">
                      {r.category}
                    </span>
                  ),
                },
                { key: "subcategory", label: "Subcategory", align: "left" },
                {
                  key: "total_sales", label: "Total Sales", numeric: true,
                  render: (r) => <span className="num">{fmtKES(r.total_sales)}</span>,
                  csv: (r) => r.total_sales,
                },
                {
                  key: "sor", label: "SOR",
                  numeric: true,
                  render: (r) => {
                    const v = r.sor;
                    const cls = v >= 30 ? "pill-green" : v >= 20 ? "pill-amber" : "pill-red";
                    return <span className={cls}>{v.toFixed(1)}%</span>;
                  },
                  csv: (r) => r.sor,
                },
                {
                  key: "qty_sold", label: "Qty Sold", numeric: true,
                  render: (r) => <span className="num">{fmtNum(r.qty_sold)}</span>,
                },
                {
                  key: "pct_qty", label: "% Qty", numeric: true,
                  render: (r) => <span className="text-muted num">{fmtPct(r.pct_qty, 1)}</span>,
                  csv: (r) => r.pct_qty,
                },
                {
                  key: "total_soh", label: "Total SOH", numeric: true,
                  render: (r) => <span className="num">{fmtNum(r.total_soh)}</span>,
                },
                {
                  key: "pct_total_soh", label: "% Total SOH", numeric: true,
                  render: (r) => <span className="text-muted num">{fmtPct(r.pct_total_soh, 1)}</span>,
                  csv: (r) => r.pct_total_soh,
                },
                {
                  key: "stores_soh", label: "Stores SOH", numeric: true,
                  render: (r) => <span className="num">{fmtNum(r.stores_soh)}</span>,
                },
                {
                  key: "pct_stores_soh", label: "% Stores SOH", numeric: true,
                  render: (r) => <span className="text-muted num">{fmtPct(r.pct_stores_soh, 1)}</span>,
                  csv: (r) => r.pct_stores_soh,
                },
                {
                  key: "wh_soh", label: "W/H SOH", numeric: true,
                  render: (r) => <span className="num">{fmtNum(r.wh_soh)}</span>,
                },
                {
                  key: "pct_wh_soh", label: "W/H % SOH", numeric: true,
                  render: (r) => <span className="text-muted num">{fmtPct(r.pct_wh_soh, 1)}</span>,
                  csv: (r) => r.pct_wh_soh,
                },
              ]}
              rows={rows}
            />

            <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-[12px]" data-testid="products-plan-totals">
              <div className="rounded-lg border border-border bg-panel px-3 py-2">
                <div className="eyebrow">Total sales</div>
                <div className="font-semibold num">{fmtKES(totals.total_sales)}</div>
              </div>
              <div className="rounded-lg border border-border bg-panel px-3 py-2">
                <div className="eyebrow">Qty sold</div>
                <div className="font-semibold num">{fmtNum(totals.qty_sold)}</div>
              </div>
              <div className="rounded-lg border border-border bg-panel px-3 py-2">
                <div className="eyebrow">Group SOR</div>
                <div className="font-semibold num">{groupSor.toFixed(1)}%</div>
              </div>
              <div className="rounded-lg border border-border bg-panel px-3 py-2">
                <div className="eyebrow">Stores SOH</div>
                <div className="font-semibold num">{fmtNum(totals.stores_soh)}</div>
              </div>
              <div className="rounded-lg border border-border bg-panel px-3 py-2">
                <div className="eyebrow">W/H SOH</div>
                <div className="font-semibold num">{fmtNum(totals.wh_soh)}</div>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
};

export default ProductsPlan;
