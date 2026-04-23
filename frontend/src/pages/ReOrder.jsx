import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtPct } from "@/lib/api";
import { isMerchandise, categoryFor } from "@/lib/productCategory";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { Package, ArrowsClockwise, Fire, TrendUp } from "@phosphor-icons/react";

const ReOrder = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;

  const [newStyles, setNewStyles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const country = countries.length === 1 ? countries[0] : undefined;
    const channel = channels.length ? channels.join(",") : undefined;
    api
      .get("/analytics/new-styles", {
        params: { date_from: dateFrom, date_to: dateTo, country, channel },
      })
      .then(({ data }) => {
        if (cancelled) return;
        setNewStyles(data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  // Re-order rule: new style (already filtered by backend ≤90 days) with SOR ≥ 50% in first 6 weeks.
  // Frontend layer adds: SOR ≥ 50% AND merchandise-only AND ranked by sales velocity.
  const reorderList = useMemo(() => {
    return [...newStyles]
      .filter((r) => isMerchandise(r.product_type))
      .filter((r) => (r.sor_percent || 0) >= 50)
      .map((r) => ({
        ...r,
        category: categoryFor(r.product_type),
        urgency:
          (r.sor_percent || 0) >= 80 ? "CRITICAL" :
          (r.sor_percent || 0) >= 65 ? "HIGH" : "MEDIUM",
      }))
      .sort((a, b) => (b.sor_percent || 0) - (a.sor_percent || 0));
  }, [newStyles]);

  const kpis = useMemo(() => {
    const critical = reorderList.filter((r) => r.urgency === "CRITICAL").length;
    const high = reorderList.filter((r) => r.urgency === "HIGH").length;
    const totalUnitsSold = reorderList.reduce((s, r) => s + (r.units_sold_launch || 0), 0);
    const totalSales = reorderList.reduce((s, r) => s + (r.total_sales_launch || 0), 0);
    return { total: reorderList.length, critical, high, totalUnitsSold, totalSales };
  }, [reorderList]);

  const pillFor = (u) => u === "CRITICAL" ? "pill-red" : u === "HIGH" ? "pill-amber" : "pill-neutral";

  return (
    <div className="space-y-6" data-testid="reorder-page">
      <div>
        <div className="eyebrow">Dashboard · Re-Order Recommendations</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">
          Styles to Re-Order
        </h1>
        <p className="text-muted text-[13px] mt-1">
          New styles (launched in the last 90 days) with Sell-Out Rate ≥ 50% — strong
          launch performance, likely to stock-out without replenishment.
        </p>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPICard testId="ro-kpi-count" accent label="Styles to Re-Order" value={fmtNum(kpis.total)} icon={ArrowsClockwise} showDelta={false} />
            <KPICard testId="ro-kpi-critical" label="CRITICAL · SOR ≥80%" value={fmtNum(kpis.critical)} icon={Fire} showDelta={false} />
            <KPICard testId="ro-kpi-high" label="HIGH · SOR 65-80%" value={fmtNum(kpis.high)} icon={TrendUp} showDelta={false} />
            <KPICard testId="ro-kpi-units" label="Units Sold Since Launch" value={fmtNum(kpis.totalUnitsSold)} icon={Package} showDelta={false} />
          </div>

          <div className="card-white p-5" data-testid="reorder-table-card">
            <SectionTitle
              title={`Re-Order list · ${reorderList.length} styles`}
              subtitle="Sorted by Sell-Out Rate descending — most urgent first. Export to PO workflow."
            />
            {reorderList.length === 0 ? (
              <Empty label="No styles currently meet the re-order criteria (new + SOR ≥ 50%)." />
            ) : (
              <SortableTable
                testId="reorder-table"
                exportName="reorder-recommendations.csv"
                pageSize={50}
                initialSort={{ key: "sor_percent", dir: "desc" }}
                columns={[
                  { key: "urgency", label: "Urgency", align: "left", render: (r) => <span className={pillFor(r.urgency)}>{r.urgency}</span>, csv: (r) => r.urgency },
                  { key: "style_name", label: "Style", align: "left", render: (r) => <span className="font-medium break-words max-w-[280px] inline-block" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{r.style_name}</span> },
                  { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                  { key: "category", label: "Category", align: "left", render: (r) => <span className="pill-neutral">{r.category || "—"}</span>, csv: (r) => r.category },
                  { key: "product_type", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.product_type || "—"}</span> },
                  { key: "sor_percent", label: "SOR", numeric: true, render: (r) => <span className={pillFor(r.urgency)}>{fmtPct(r.sor_percent)}</span>, csv: (r) => r.sor_percent?.toFixed(2) },
                  { key: "units_sold_launch", label: "Units Sold (Launch)", numeric: true, render: (r) => fmtNum(r.units_sold_launch) },
                  { key: "total_sales_launch", label: "Sales (Launch)", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales_launch)}</span>, csv: (r) => r.total_sales_launch },
                  { key: "current_stock", label: "Current Stock", numeric: true, render: (r) => <span className={(r.current_stock || 0) < 10 ? "pill-red" : "pill-neutral"}>{fmtNum(r.current_stock)}</span>, csv: (r) => r.current_stock },
                ]}
                rows={reorderList}
              />
            )}
          </div>

          <div className="card-white p-4 bg-panel">
            <div className="text-[12.5px] text-muted">
              <span className="font-semibold text-foreground">Re-order rule:</span>{" "}
              style must be a NEW style (first sale within last 90 days) AND its
              current Sell-Out Rate must be ≥ 50%. Urgency tiers are derived
              from SOR: <span className="pill-red ml-1">CRITICAL ≥80%</span>{" "}
              <span className="pill-amber ml-1">HIGH 65–80%</span>{" "}
              <span className="pill-neutral ml-1">MEDIUM 50–65%</span>.
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ReOrder;
