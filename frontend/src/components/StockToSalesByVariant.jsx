import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum, fmtPct } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { varianceStyle } from "@/lib/variance";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";

/**
 * Stock-to-Sales · by Color and · by Size.
 *
 * Two stacked variance tables matching the column shape of
 * `Stock-to-Sales · by Subcategory` (Inventory page) so users can switch
 * between attribute lenses without re-learning the layout. Both tables share
 * a single `/analytics/stock-to-sales-by-attribute` fetch (returns
 * `{by_color, by_size}`) so we don't pay the /orders fan-out twice.
 */

const VarianceCellPts = ({ value }) => {
  const { cls, icon, tip, flag } = varianceStyle(value);
  return (
    <span className={`${cls} inline-flex items-center gap-1`} title={tip} data-variance-flag={flag}>
      <span aria-hidden="true">{icon}</span>
      {value >= 0 ? "+" : ""}
      {(value || 0).toFixed(2)} pp
    </span>
  );
};

const buildColumns = (keyLabel, keyField) => [
  {
    key: keyField, label: keyLabel, align: "left",
    render: (r) => <span className="font-medium">{r[keyField] || "—"}</span>,
  },
  { key: "units_sold",         label: "Units Sold",          numeric: true, render: (r) => fmtNum(r.units_sold) },
  { key: "current_stock",      label: "Inventory",           numeric: true, render: (r) => fmtNum(Math.round(r.current_stock || 0)), csv: (r) => Math.round(r.current_stock || 0) },
  { key: "pct_of_total_sold",  label: "% of Total Sales",    numeric: true, render: (r) => fmtPct(r.pct_of_total_sold, 2) },
  { key: "pct_of_total_stock", label: "% of Total Inventory",numeric: true, render: (r) => fmtPct(r.pct_of_total_stock, 2) },
  {
    key: "variance", label: "Variance", numeric: true,
    sortValue: (r) => Math.abs(r.variance || 0),
    render: (r) => <VarianceCellPts value={r.variance} />,
    csv: (r) => r.variance?.toFixed(2),
  },
  {
    key: "risk_flag", label: "Risk Flag", align: "left",
    render: (r) => <span className="text-[11px] text-muted">{varianceStyle(r.variance).flag}</span>,
    csv: (r) => varianceStyle(r.variance).flag,
  },
];

const StockToSalesByVariant = ({ exportSlug }) => {
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;
  const [data, setData] = useState({ by_color: [], by_size: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const params = { date_from: dateFrom, date_to: dateTo };
    if (countries && countries.length) params.country = countries.map((c) => c.toLowerCase()).join(",");
    if (channels && channels.length) params.locations = channels.join(",");
    api
      .get("/analytics/stock-to-sales-by-attribute", { params, timeout: 240000 })
      .then(({ data: d }) => {
        if (cancel) return;
        setData(d || { by_color: [], by_size: [] });
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  const byColor = data.by_color || [];
  const bySize = data.by_size || [];

  const colorColumns = useMemo(() => buildColumns("Color/Print", "color"), []);
  const sizeColumns = useMemo(() => buildColumns("Size", "size"), []);

  const slug = exportSlug || `${dateFrom}_${dateTo}`;

  return (
    <>
      <div className="card-white p-5" data-testid="sts-by-color-table">
        <SectionTitle
          title="Stock-to-Sales · by Color"
          subtitle="One row per color/print across all merchandise. Variance = sales share − stock share. Red = action needed (stockout or overstock risk). Green = healthy balance."
        />
        {loading && <Loading />}
        {error && <ErrorBox message={error} />}
        {!loading && !error && (
          byColor.length === 0 ? (
            <Empty label="No color data in the selected window." />
          ) : (
            <SortableTable
              testId="inv-sts-color"
              exportName={`inventory-sts-by-color_${slug}.csv`}
              pageSize={15}
              initialSort={{ key: "variance", dir: "desc" }}
              columns={colorColumns}
              rows={byColor}
            />
          )
        )}
      </div>

      <div className="card-white p-5" data-testid="sts-by-size-table">
        <SectionTitle
          title="Stock-to-Sales · by Size"
          subtitle="One row per size across all merchandise. Spot sizes that consistently outsell their stock share (re-order) and sizes that are over-stocked (markdown / IBT)."
        />
        {loading && <Loading />}
        {error && <ErrorBox message={error} />}
        {!loading && !error && (
          bySize.length === 0 ? (
            <Empty label="No size data in the selected window." />
          ) : (
            <SortableTable
              testId="inv-sts-size"
              exportName={`inventory-sts-by-size_${slug}.csv`}
              pageSize={15}
              initialSort={{ key: "variance", dir: "desc" }}
              columns={sizeColumns}
              rows={bySize}
            />
          )
        )}
      </div>
    </>
  );
};

export default StockToSalesByVariant;
