import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { categoryFor } from "@/lib/productCategory";
import { Sparkle } from "@phosphor-icons/react";
import SorStylesTable from "@/components/SorStylesTable";

/**
 * SOR New Styles L-10 — styles whose first-ever sale was 90–122 days ago
 * (i.e. ≥3 months and ≤4 months old). Shows the 6-month performance
 * envelope + sell-out + warehouse penetration so buying teams can
 * decide which young styles to push, mark down, or transfer.
 *
 * Data source: `/api/analytics/sor-new-styles-l10` (server-side
 * 30-min cached because the launch-date detection fans out 17+
 * /orders chunks).
 */
const SorNewStylesL10 = ({ brand }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    api
      .get("/analytics/sor-new-styles-l10", {
        params: { brand: brand || undefined },
        timeout: 240000,
      })
      .then(({ data }) => {
        if (cancel) return;
        setRows(Array.isArray(data) ? data : []);
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [brand]);

  const enriched = useMemo(
    () => (rows || [])
      // Backend `/api/analytics/sor-new-styles-l10` already filters
      // out rows where `(units_6m + soh_total) < 20` — keep the map
      // here just to enrich with category.
      .map((r) => ({ ...r, category: categoryFor(r.subcategory) || "—" })),
    [rows]
  );

  const summary = useMemo(() => {
    if (!enriched.length) return null;
    const total_sales = enriched.reduce((s, r) => s + (r.sales_6m || 0), 0);
    const total_units = enriched.reduce((s, r) => s + (r.units_6m || 0), 0);
    const total_stock = enriched.reduce((s, r) => s + (r.soh_total || 0), 0);
    const wh = enriched.reduce((s, r) => s + (r.soh_wh || 0), 0);
    const avg_sor = enriched.reduce((s, r) => s + (r.sor_6m || 0), 0) / enriched.length;
    const stuck = enriched.filter((r) => (r.sor_6m || 0) < 25).length;
    return {
      total_sales, total_units, total_stock,
      pct_in_wh: total_stock > 0 ? (wh / total_stock) * 100 : 0,
      avg_sor,
      stuck,
    };
  }, [enriched]);

  return (
    <div className="space-y-5" data-testid="sor-new-styles-l10-tab">
      <div className="card-white p-5">
        <SectionTitle
          title="SOR New Styles L-10"
          subtitle={
            <span>
              Styles aged <b>3 to 4 months</b> (first-ever sale 90-122 days ago).
              Six-month sell-out, warehouse split, and weekly cadence in one view —
              so buyers can see early winners (high SOR, low stock) and slow burners
              (high % in warehouse, low units in last 3 weeks).
            </span>
          }
        />

        {loading && <Loading />}
        {error && <ErrorBox message={error} />}

        {!loading && !error && (
          <>
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mt-2 mb-4">
                <SummaryTile testId="l10-tile-styles"  label="Styles in Window"  value={fmtNum(enriched.length)} sub="3-4 months old" />
                <SummaryTile testId="l10-tile-sales"   label="6-Month Sales"     value={fmtKES(summary.total_sales)} sub={`${fmtNum(summary.total_units)} units`} />
                <SummaryTile testId="l10-tile-stock"   label="Stock on Hand"     value={fmtNum(Math.round(summary.total_stock))} sub={`${summary.pct_in_wh.toFixed(1)}% in warehouse`} />
                <SummaryTile testId="l10-tile-sor"     label="Avg 6-Month SOR"   value={`${summary.avg_sor.toFixed(1)}%`} sub="units ÷ (units + stock)" />
                <SummaryTile testId="l10-tile-stuck"   label="Slow Burners"      value={fmtNum(summary.stuck)} sub="SOR < 25%" tone={summary.stuck > 0 ? "warn" : "good"} />
              </div>
            )}

            {enriched.length === 0 ? (
              <Empty label="No styles match the L-10 window — nothing launched in the 3-4 month band, or upstream returned no data." />
            ) : (
              <SorStylesTable
                rows={enriched}
                testId="l10-table"
                exportName="sor-new-styles-l10.csv"
                showLaunchDate
              />
            )}

            <p className="text-[11px] text-muted italic mt-3" data-testid="l10-footnote">
              <Sparkle size={11} weight="fill" className="inline -mt-0.5 mr-1 text-brand" />
              Launch date = first-ever sale across the catalog. Style number = primary SKU per style.
              Click <b>+ Color/Print</b> or <b>+ Size</b> to drill into the SKU mix per style.
              Server-side cached for 30 minutes — pass <code>?refresh=true</code> to force a recompute.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const SummaryTile = ({ testId, label, value, sub, tone }) => {
  const cls = tone === "warn" ? "bg-amber-50 border-amber-200 text-amber-900"
            : tone === "good" ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-panel/60 border-border text-foreground";
  return (
    <div className={`rounded-lg border p-3 ${cls}`} data-testid={testId}>
      <div className="text-[10.5px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="font-extrabold text-[20px] leading-tight mt-0.5">{value}</div>
      {sub && <div className="text-[10.5px] opacity-80 mt-0.5">{sub}</div>}
    </div>
  );
};

export default SorNewStylesL10;
