import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { categoryFor } from "@/lib/productCategory";
import SorStylesTable from "@/components/SorStylesTable";

/**
 * SOR All Styles — same column shape as L-10 but covers the entire active
 * catalog (every style that sold in the last 6 months). Use this for
 * catalog-wide SOR audits, markdown candidates, and IBT shortlists. Two
 * toggle buttons let merch drill into per-color or per-size mix.
 *
 * Data source: `/api/analytics/sor-all-styles` (server-side 30-min cached).
 */
const SorAllStyles = ({ brand, styleStatus = "all", windowDays = 180 }) => {
  const { applied } = useFilters();
  const { countries, channels, dataVersion } = applied;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const params = { brand: brand || undefined, style_status: styleStatus, window_days: windowDays };
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
  }, [brand, styleStatus, windowDays, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  const enriched = useMemo(
    () => (rows || []).map((r) => ({ ...r, category: categoryFor(r.subcategory) || "—" })),
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
    // Iter 89d — Catalog-wide Weeks-of-Cover tile.
    //   Aggregate WoC = total SOH ÷ catalog weekly burn rate
    //   where weekly burn = Σ(weekly_avg) — already 3-month based per
    //   the backend's WoC contract (Iter 89c). Falls back to "—" when
    //   the catalog has no recent burn (would be ∞).
    const total_weekly_burn = enriched.reduce((s, r) => s + (r.weekly_avg || 0), 0);
    const aggregate_woc = total_weekly_burn > 0 ? total_stock / total_weekly_burn : null;
    // How many styles are overstocked at the current pace? 26w is the
    // "half-a-year of cover" threshold — typical markdown trigger.
    const overstocked = enriched.filter((r) => r.woc != null && r.woc > 26).length;
    return { total_sales, total_units, total_stock,
      pct_in_wh: total_stock > 0 ? (wh / total_stock) * 100 : 0,
      avg_sor, stuck, aggregate_woc, overstocked };
  }, [enriched]);

  // WoC tile tone: green if catalog has < 12w of cover (lean),
  // amber if 12–26w (healthy), red if > 26w (overstocked).
  const wocTone = useMemo(() => {
    if (!summary || summary.aggregate_woc == null) return undefined;
    if (summary.aggregate_woc < 12) return "good";
    if (summary.aggregate_woc <= 26) return undefined;
    return "warn";
  }, [summary]);

  return (
    <div className="space-y-5" data-testid="sor-all-styles-tab">
      <div className="card-white p-5">
        <SectionTitle
          title="SOR · All Styles"
          subtitle={
            <span>
              Every style that sold a unit in the last 6 months — same columns as L-10 but
              catalog-wide. Filter by name and toggle <b>+ Color/Print</b> or <b>+ Size</b>
              to drill into the SKU mix per style.
            </span>
          }
        />

        {loading && <Loading />}
        {error && <ErrorBox message={error} />}

        {!loading && !error && (
          <>
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 mt-2 mb-4">
                <SummaryTile testId="all-tile-styles"  label="Styles in Catalog" value={fmtNum(enriched.length)} sub="active in last 6 months" />
                <SummaryTile testId="all-tile-sales"   label="6-Month Sales"     value={fmtKES(summary.total_sales)} sub={`${fmtNum(summary.total_units)} units`} />
                <SummaryTile testId="all-tile-stock"   label="Stock on Hand"     value={fmtNum(Math.round(summary.total_stock))} sub={`${summary.pct_in_wh.toFixed(1)}% in warehouse`} />
                <SummaryTile
                  testId="all-tile-woc"
                  label="Weeks of Cover"
                  value={summary.aggregate_woc == null ? "—" : `${summary.aggregate_woc.toFixed(1)}w`}
                  sub={summary.aggregate_woc == null ? "no recent burn rate" : `${fmtNum(summary.overstocked)} styles > 26w`}
                  tone={wocTone}
                />
                <SummaryTile testId="all-tile-sor"     label="Avg 6-Month SOR"   value={`${summary.avg_sor.toFixed(1)}%`} sub="units ÷ (units + stock)" />
                <SummaryTile testId="all-tile-stuck"   label="Slow Burners"      value={fmtNum(summary.stuck)} sub="SOR < 25%" tone={summary.stuck > 0 ? "warn" : "good"} />
              </div>
            )}

            {enriched.length === 0 ? (
              <Empty label="No styles found in the last 6 months." />
            ) : (
              <SorStylesTable
                rows={enriched}
                testId="sor-all-styles-table"
                exportName="sor-all-styles.csv"
                showLaunchDate
              />
            )}
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

export default SorAllStyles;
