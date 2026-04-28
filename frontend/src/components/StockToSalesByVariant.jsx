import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { categoryFor } from "@/lib/productCategory";
import SorStylesTable from "@/components/SorStylesTable";

/**
 * Stock-to-Sales · by Variant (Color × Size)
 *
 * Lives on the Inventory page. Reuses the catalog-wide `/analytics/sor-all-styles`
 * payload (cached server-side for 30 min) and renders the shared `SorStylesTable`
 * with the L-10 hidden columns toggled off. Merch users can press
 * `+ Color/Print` and/or `+ Size` to drill any style into per-SKU rows so they
 * can flag understocked / overstocked variants — the same SKU breakdown is
 * served lazily from `/analytics/style-sku-breakdown`.
 *
 * The table columns (SOH, SOH W/H, % In WH, units 6m / 3w, ASP, WOC, weekly
 * avg, 6M SOR) ARE the stock-to-sales view at the variant level. No bespoke
 * endpoint required — this composes existing primitives.
 */
const StockToSalesByVariant = () => {
  const { applied } = useFilters();
  const { countries, channels, dataVersion } = applied;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const params = {};
    if (countries && countries.length) params.country = countries.join(",");
    if (channels && channels.length) params.channel = channels.join(",");
    api
      .get("/analytics/sor-all-styles", { params, timeout: 240000 })
      .then(({ data }) => {
        if (cancel) return;
        setRows(Array.isArray(data) ? data : []);
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
    // eslint-disable-next-line
  }, [JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  const enriched = useMemo(
    () => (rows || []).map((r) => ({ ...r, category: categoryFor(r.subcategory) || "—" })),
    [rows]
  );

  // Top-line tiles geared to stock-cover context (vs SOR All-Styles which leads
  // with sales). Lead with overstock / understock counts here.
  const summary = useMemo(() => {
    if (!enriched.length) return null;
    const total_stock = enriched.reduce((s, r) => s + (r.soh_total || 0), 0);
    const total_units = enriched.reduce((s, r) => s + (r.units_6m || 0), 0);
    const wh = enriched.reduce((s, r) => s + (r.soh_wh || 0), 0);
    const overstocked = enriched.filter((r) => (r.woc != null && r.woc > 12) || (r.sor_6m != null && r.sor_6m < 25)).length;
    const understocked = enriched.filter((r) => (r.woc != null && r.woc < 4) && (r.units_6m || 0) > 0).length;
    return {
      total_stock, total_units, wh,
      pct_in_wh: total_stock > 0 ? (wh / total_stock) * 100 : 0,
      overstocked, understocked,
    };
  }, [enriched]);

  return (
    <div className="card-white p-5" data-testid="sts-by-variant-section">
      <SectionTitle
        title="Stock-to-Sales · by Variant (Color × Size)"
        subtitle={
          <span>
            Spot understocked or overstocked SKUs at the variant level. Filter by style
            name and toggle <b>+ Color/Print</b> or <b>+ Size</b> to split each style
            into per-SKU rows. Look at <b>WOC</b> (weeks of cover) and <b>% In WH</b> to
            decide whether to <b>re-order</b>, <b>IBT</b> a variant, or <b>mark down</b>.
          </span>
        }
      />

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mt-2 mb-4">
              <Tile testId="sts-variant-tile-styles"   label="Active Styles"        value={fmtNum(enriched.length)}                  sub="sold ≥ 1 unit in last 6 months" />
              <Tile testId="sts-variant-tile-stock"    label="Stock on Hand"        value={fmtNum(Math.round(summary.total_stock))} sub={`${summary.pct_in_wh.toFixed(1)}% in warehouse`} />
              <Tile testId="sts-variant-tile-units"    label="Units Sold (6M)"      value={fmtNum(summary.total_units)}              sub="across all variants" />
              <Tile testId="sts-variant-tile-overstock" label="Overstocked Styles"  value={fmtNum(summary.overstocked)}              sub="WOC > 12w or SOR < 25%" tone={summary.overstocked > 0 ? "warn" : "good"} />
              <Tile testId="sts-variant-tile-understock" label="Understocked Styles" value={fmtNum(summary.understocked)}            sub="WOC < 4w with active sales" tone={summary.understocked > 0 ? "danger" : "good"} />
            </div>
          )}

          {enriched.length === 0 ? (
            <Empty label="No styles available." />
          ) : (
            <SorStylesTable
              rows={enriched}
              testId="sts-by-variant-table"
              exportName="stock-to-sales-by-variant.csv"
              showLaunchDate={false}
              initialSort={{ key: "woc", dir: "desc" }}
            />
          )}
        </>
      )}
    </div>
  );
};

const Tile = ({ testId, label, value, sub, tone }) => {
  const cls = tone === "warn"   ? "bg-amber-50 border-amber-200 text-amber-900"
           : tone === "danger" ? "bg-red-50 border-red-200 text-red-900"
           : tone === "good"   ? "bg-emerald-50 border-emerald-200 text-emerald-900"
           :                      "bg-panel/60 border-border text-foreground";
  return (
    <div className={`rounded-lg border p-3 ${cls}`} data-testid={testId}>
      <div className="text-[10.5px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="font-extrabold text-[20px] leading-tight mt-0.5">{value}</div>
      {sub && <div className="text-[10.5px] opacity-80 mt-0.5">{sub}</div>}
    </div>
  );
};

export default StockToSalesByVariant;
