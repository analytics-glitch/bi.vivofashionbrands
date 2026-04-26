import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import ProductThumbnail from "@/components/ProductThumbnail";
import { useThumbnails } from "@/lib/useThumbnails";
import { categoryFor } from "@/lib/productCategory";
import { Sparkle, Calendar, Warehouse } from "@phosphor-icons/react";

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
    () => (rows || []).map((r) => ({
      ...r,
      category: categoryFor(r.subcategory) || "—",
    })),
    [rows]
  );

  const { urlFor } = useThumbnails(useMemo(() => enriched.map((r) => r.style_name), [enriched]));

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
              <SortableTable
                testId="l10-table"
                exportName="sor-new-styles-l10.csv"
                pageSize={25}
                mobileCards
                initialSort={{ key: "sor_6m", dir: "desc" }}
                columns={[
                  {
                    key: "thumb", label: "", align: "left", sortable: false,
                    mobileHidden: true,
                    render: (r) => <ProductThumbnail style={r.style_name} url={urlFor(r.style_name)} size={36} />,
                    csv: () => "",
                  },
                  {
                    key: "style_name", label: "Style Name", align: "left", mobilePrimary: true,
                    render: (r) => (
                      <div className="max-w-[260px]">
                        <div className="font-medium break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{r.style_name}</div>
                        <div className="text-[10.5px] text-muted mt-0.5">{r.brand || "—"} · {r.collection || "—"}</div>
                      </div>
                    ),
                    csv: (r) => r.style_name,
                  },
                  { key: "category",     label: "Category",     align: "left", render: (r) => <span className="pill-neutral">{r.category}</span>, csv: (r) => r.category },
                  { key: "subcategory",  label: "Sub Category", align: "left", render: (r) => <span className="text-muted">{r.subcategory || "—"}</span>, csv: (r) => r.subcategory },
                  { key: "style_number", label: "Style #",      align: "left", render: (r) => <span className="font-mono text-[11px] text-muted">{r.style_number || "—"}</span>, csv: (r) => r.style_number },
                  { key: "sales_6m",     label: "Sales 6M",     numeric: true, render: (r) => <span className="font-bold">{fmtKES(r.sales_6m)}</span>, csv: (r) => r.sales_6m },
                  { key: "units_6m",     label: "Units 6M",     numeric: true, render: (r) => fmtNum(r.units_6m) },
                  { key: "units_3w",     label: "Units 3W",     numeric: true, render: (r) => <span className={r.units_3w === 0 ? "text-red-700" : ""}>{fmtNum(r.units_3w)}</span>, csv: (r) => r.units_3w },
                  { key: "soh_total",    label: "SOH",          numeric: true, render: (r) => fmtNum(Math.round(r.soh_total)), csv: (r) => r.soh_total },
                  { key: "soh_wh",       label: "SOH W/H",      numeric: true, render: (r) => fmtNum(Math.round(r.soh_wh)), csv: (r) => r.soh_wh },
                  {
                    key: "pct_in_wh", label: "% In WH", numeric: true,
                    sortValue: (r) => r.pct_in_wh,
                    render: (r) => {
                      const p = r.pct_in_wh || 0;
                      const cls = p >= 50 ? "pill-red" : p >= 25 ? "pill-amber" : "pill-green";
                      return <span className={cls}>{p.toFixed(1)}%</span>;
                    },
                    csv: (r) => r.pct_in_wh,
                  },
                  { key: "asp_6m",       label: "ASP 6M",       numeric: true, render: (r) => fmtKES(r.asp_6m), csv: (r) => r.asp_6m },
                  {
                    key: "days_since_last_sale", label: "Days Since Last", numeric: true,
                    render: (r) => {
                      const d = r.days_since_last_sale || 0;
                      const cls = d > 21 ? "pill-red" : d > 7 ? "pill-amber" : "pill-green";
                      return <span className={cls}>{d}d</span>;
                    },
                    csv: (r) => r.days_since_last_sale,
                  },
                  {
                    key: "sor_6m", label: "6M SOR", numeric: true,
                    render: (r) => {
                      const s = r.sor_6m || 0;
                      const cls = s >= 50 ? "pill-green" : s >= 25 ? "pill-amber" : "pill-red";
                      return <span className={cls}>{s.toFixed(1)}%</span>;
                    },
                    csv: (r) => r.sor_6m,
                  },
                  {
                    key: "launch_date", label: "Launch Date", align: "left",
                    render: (r) => <span className="text-muted text-[11.5px]"><Calendar size={11} className="inline -mt-0.5 mr-1" />{r.launch_date}</span>,
                    csv: (r) => r.launch_date,
                  },
                  { key: "weekly_avg",      label: "Weekly Avg",      numeric: true, render: (r) => r.weekly_avg.toFixed(1), csv: (r) => r.weekly_avg },
                  {
                    key: "woc", label: "WOC", numeric: true,
                    sortValue: (r) => r.woc == null ? 9999 : r.woc,
                    render: (r) => {
                      if (r.woc == null) return <span className="pill-neutral text-[10px]">∞</span>;
                      const cls = r.woc < 4 ? "pill-green" : r.woc < 12 ? "pill-amber" : "pill-red";
                      return <span className={cls}>{r.woc.toFixed(1)}w</span>;
                    },
                    csv: (r) => r.woc,
                  },
                  { key: "style_age_weeks", label: "Style Age (W)",   numeric: true, render: (r) => `${r.style_age_weeks.toFixed(1)}w`, csv: (r) => r.style_age_weeks },
                ]}
                rows={enriched}
              />
            )}

            <p className="text-[11px] text-muted italic mt-3" data-testid="l10-footnote">
              <Sparkle size={11} weight="fill" className="inline -mt-0.5 mr-1 text-brand" />
              Launch date = first-ever sale across the catalog. Style number = primary SKU per style.
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
