import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtPct } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import ProductThumbnail from "@/components/ProductThumbnail";
import { useThumbnails } from "@/lib/useThumbnails";
import MultiSelect from "@/components/MultiSelect";
import {
  TrendUp, TrendDown, Coins, ChartBar, ArrowsVertical,
  ArrowUpRight, ArrowDownRight,
} from "@phosphor-icons/react";

/**
 * Pricing Changes — styles whose average selling price (ASP) has moved
 * materially vs the equal-length prior window. Surfaces increases,
 * decreases, volume impact, and rough elasticity so the buying team
 * can tell if a price move is helping or hurting.
 *
 * ASP is derived from upstream /top-skus (total_sales / units_sold).
 * Upstream does not yet expose a list-price history — this is the best
 * proxy available.
 */

const DIRECTION_FILTERS = [
  { value: "all",      label: "All changes" },
  { value: "increase", label: "Price up" },
  { value: "decrease", label: "Price down" },
];

const ElasticityPill = ({ value }) => {
  if (value == null) return <span className="text-muted text-[11px]">—</span>;
  // Elasticity interpretation:
  //   < -1  → elastic demand, strong volume response to price change
  //   -1..0 → inelastic (healthy pricing power)
  //    > 0  → unusual (volume moved same direction as price — watch for confounders)
  let cls = "pill-neutral";
  let hint = "";
  if (value > 0) {
    cls = "pill-amber";
    hint = "Volume moved same direction as price — check confounders (promo, stock, seasonality)";
  } else if (value >= -1) {
    cls = "pill-green";
    hint = "Inelastic demand — pricing power";
  } else {
    cls = "pill-red";
    hint = "Elastic demand — price change is costing / buying volume";
  }
  return (
    <span className={cls} title={hint} data-testid={`elasticity-${value}`}>
      {value.toFixed(2)}
    </span>
  );
};

const ChangePill = ({ pct, invertColor = false }) => {
  if (pct == null) return <span className="text-muted">—</span>;
  const up = pct > 0;
  // By default green=up, red=down. `invertColor` = true → red=up (e.g.
  // price up = customer-negative).
  const good = invertColor ? !up : up;
  const cls = Math.abs(pct) < 0.5
    ? "pill-neutral"
    : good ? "pill-green" : "pill-red";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`${cls} inline-flex items-center gap-0.5`}>
      <Icon size={11} weight="bold" />
      {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
};

const Pricing = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;

  const [resp, setResp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [direction, setDirection] = useState("all");
  const [brands, setBrands] = useState([]);
  const [minUnits, setMinUnits] = useState(10);
  const [minChange, setMinChange] = useState(2);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const country = countries.length === 1 ? countries[0] : undefined;
    const channel = channels.length ? channels.join(",") : undefined;
    api
      .get("/analytics/price-changes", {
        params: {
          date_from: dateFrom,
          date_to: dateTo,
          country,
          channel,
          min_units: minUnits,
          min_change_pct: minChange,
          limit: 400,
        },
        timeout: 180000,
      })
      .then(({ data }) => {
        if (cancel) return;
        setResp(data || null);
        touchLastUpdated();
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), dataVersion, minUnits, minChange]);

  const rows = resp?.rows || [];

  const brandOptions = useMemo(() => {
    const s = new Set();
    rows.forEach((r) => r.brand && s.add(r.brand));
    return Array.from(s).sort().map((b) => ({ value: b, label: b }));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (direction !== "all" && r.direction !== direction) return false;
      if (brands.length > 0 && !brands.includes(r.brand)) return false;
      return true;
    });
  }, [rows, direction, brands]);

  const { urlFor } = useThumbnails(useMemo(() => filtered.map((r) => r.style_name), [filtered]));

  const kpis = useMemo(() => {
    const up = rows.filter((r) => r.direction === "increase");
    const down = rows.filter((r) => r.direction === "decrease");
    const avgIncrease = up.length ? up.reduce((s, r) => s + r.price_change_pct, 0) / up.length : 0;
    const avgDecrease = down.length ? down.reduce((s, r) => s + r.price_change_pct, 0) / down.length : 0;
    // Net sales impact vs prev window (among changed styles only)
    const netSalesImpact = rows.reduce((s, r) => s + ((r.current_sales || 0) - (r.previous_sales || 0)), 0);
    return {
      tracked: rows.length,
      up: up.length,
      down: down.length,
      avgIncrease,
      avgDecrease,
      netSalesImpact,
    };
  }, [rows]);

  return (
    <div className="space-y-6" data-testid="pricing-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Dashboard · Pricing Changes</div>
          <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(18px,2.2vw,26px)]">
            Pricing Changes
          </h1>
          <p className="text-muted text-[13px] mt-1 max-w-3xl">
            Styles whose <b>average selling price</b> shifted materially
            between the selected window and the equal-length prior window.
            Helps the buying team see which price moves are boosting or
            hurting volume.
          </p>
          {resp && (
            <p className="text-[11px] text-muted mt-1" data-testid="pricing-window-note">
              Current: <b>{resp.current_from} → {resp.current_to}</b>
              &nbsp;·&nbsp; Previous: <b>{resp.previous_from} → {resp.previous_to}</b>
              &nbsp;·&nbsp; Window: {resp.window_days}d
              &nbsp;·&nbsp; Filters: ≥{resp.min_units} units both windows · |ASP Δ| ≥ {resp.min_change_pct}%
            </p>
          )}
        </div>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && resp && (
        <>
          {/* ---- KPI tiles ---- */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              testId="pr-kpi-tracked"
              accent
              label="Styles with changes"
              sub={`≥${resp.min_change_pct}% ASP shift`}
              value={fmtNum(kpis.tracked)}
              icon={ChartBar}
              showDelta={false}
              action={{ label: "See table", onClick: () => document.querySelector('[data-testid="pricing-table-card"]')?.scrollIntoView({ behavior: "smooth" }) }}
            />
            <KPICard
              testId="pr-kpi-up"
              label="Price increases"
              sub={kpis.up ? `Avg +${kpis.avgIncrease.toFixed(1)}%` : "None detected"}
              value={fmtNum(kpis.up)}
              icon={TrendUp}
              showDelta={false}
              action={{ label: "View increases", onClick: () => setDirection("increase") }}
            />
            <KPICard
              testId="pr-kpi-down"
              label="Price decreases"
              sub={kpis.down ? `Avg ${kpis.avgDecrease.toFixed(1)}%` : "None detected"}
              value={fmtNum(kpis.down)}
              icon={TrendDown}
              higherIsBetter={false}
              showDelta={false}
              action={{ label: "View decreases", onClick: () => setDirection("decrease") }}
            />
            <KPICard
              testId="pr-kpi-impact"
              label="Net sales impact"
              sub="Changed styles, this vs prev window"
              value={fmtKES(kpis.netSalesImpact)}
              icon={Coins}
              higherIsBetter={kpis.netSalesImpact >= 0}
              showDelta={false}
              action={{ label: "Export CSV", to: "/exports" }}
            />
          </div>

          {/* ---- Filters bar ---- */}
          <div className="card-white p-4 flex flex-wrap items-end gap-3" data-testid="pricing-filters">
            <div className="min-w-[160px]">
              <div className="eyebrow mb-1">Direction</div>
              <div className="inline-flex rounded-md border border-border overflow-hidden" role="tablist">
                {DIRECTION_FILTERS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDirection(d.value)}
                    className={`px-3 py-1.5 text-[12px] ${direction === d.value ? "bg-brand text-white" : "bg-white hover:bg-panel"}`}
                    data-testid={`dir-filter-${d.value}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="w-56">
              <div className="eyebrow mb-1">Brand</div>
              <MultiSelect
                testId="pricing-brand"
                options={brandOptions}
                value={brands}
                onChange={setBrands}
                placeholder="All brands"
                width={224}
              />
            </div>

            <div>
              <div className="eyebrow mb-1">Min units (each window)</div>
              <input
                type="number"
                min={1}
                max={500}
                value={minUnits}
                onChange={(e) => setMinUnits(Math.max(1, Math.min(500, Number(e.target.value) || 10)))}
                className="w-24 border border-border rounded px-2 py-1.5 text-[13px]"
                data-testid="pricing-min-units"
              />
            </div>

            <div>
              <div className="eyebrow mb-1">Min |ASP Δ| %</div>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={minChange}
                onChange={(e) => setMinChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="w-24 border border-border rounded px-2 py-1.5 text-[13px]"
                data-testid="pricing-min-change"
              />
            </div>

            <div className="ml-auto text-[11.5px] text-muted">
              Showing <b>{fmtNum(filtered.length)}</b> of {fmtNum(rows.length)} styles
            </div>
          </div>

          {/* ---- Main table ---- */}
          <div className="card-white p-5" data-testid="pricing-table-card">
            <SectionTitle
              title="Styles with price changes"
              subtitle="Sorted by largest absolute ASP change. Elasticity < −1 (red) means volume is reacting strongly to the price move; between −1 and 0 (green) means pricing power."
            />
            {filtered.length === 0 ? (
              <Empty label="No styles meet the current filters — try loosening 'Min |ASP Δ|' or widening the date window." />
            ) : (
              <SortableTable
                testId="pricing-table"
                exportName="pricing-changes.csv"
                pageSize={50}
                mobileCards
                initialSort={{ key: "abs_change", dir: "desc" }}
                columns={[
                  { key: "thumb", label: "", align: "left", sortable: false, mobileHidden: true, render: (r) => <ProductThumbnail style={r.style_name} url={urlFor(r.style_name)} size={36} />, csv: () => "" },
                  {
                    key: "style_name", label: "Style", align: "left", mobilePrimary: true,
                    render: (r) => (
                      <div className="max-w-[280px]">
                        <div className="font-medium break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                          {r.style_name}
                        </div>
                        <div className="text-[10.5px] text-muted mt-0.5">
                          {r.brand || "—"} · {r.product_type || "—"}
                        </div>
                      </div>
                    ),
                    csv: (r) => r.style_name,
                  },
                  {
                    key: "previous_avg_price", label: "Prev ASP", numeric: true,
                    render: (r) => <span className="text-muted">{fmtKES(r.previous_avg_price)}</span>,
                    csv: (r) => r.previous_avg_price,
                  },
                  {
                    key: "current_avg_price", label: "Current ASP", numeric: true,
                    render: (r) => <span className="font-bold">{fmtKES(r.current_avg_price)}</span>,
                    csv: (r) => r.current_avg_price,
                  },
                  {
                    key: "price_change_pct", label: "ASP Δ%", numeric: true,
                    sortValue: (r) => r.price_change_pct,
                    render: (r) => <ChangePill pct={r.price_change_pct} invertColor />,
                    csv: (r) => r.price_change_pct,
                  },
                  {
                    key: "abs_change", label: "|Δ%|", numeric: true,
                    sortValue: (r) => Math.abs(r.price_change_pct || 0),
                    render: (r) => <span className="text-muted num">{Math.abs(r.price_change_pct).toFixed(1)}%</span>,
                    csv: (r) => Math.abs(r.price_change_pct),
                  },
                  {
                    key: "previous_units", label: "Prev Units", numeric: true,
                    render: (r) => <span className="text-muted">{fmtNum(r.previous_units)}</span>,
                    csv: (r) => r.previous_units,
                  },
                  {
                    key: "current_units", label: "Current Units", numeric: true,
                    render: (r) => fmtNum(r.current_units),
                    csv: (r) => r.current_units,
                  },
                  {
                    key: "units_change_pct", label: "Units Δ%", numeric: true,
                    sortValue: (r) => r.units_change_pct,
                    render: (r) => <ChangePill pct={r.units_change_pct} />,
                    csv: (r) => r.units_change_pct,
                  },
                  {
                    key: "sales_change_pct", label: "Sales Δ%", numeric: true,
                    sortValue: (r) => r.sales_change_pct ?? 0,
                    render: (r) => <ChangePill pct={r.sales_change_pct} />,
                    csv: (r) => r.sales_change_pct,
                  },
                  {
                    key: "price_elasticity", label: "Elasticity", numeric: true,
                    sortValue: (r) => r.price_elasticity ?? 99,
                    render: (r) => <ElasticityPill value={r.price_elasticity} />,
                    csv: (r) => r.price_elasticity,
                  },
                ]}
                rows={filtered}
              />
            )}
            <p className="text-[11px] text-muted italic mt-3" data-testid="pricing-footnote">
              <ArrowsVertical size={11} className="inline mr-1" />
              ASP is derived as <code>total_sales ÷ units_sold</code> per style from upstream <code>/top-skus</code>.
              Upstream does not yet expose a list-price history, so mix-shifts between sizes / colours can move ASP even without a list-price change.
              Elasticity outside the [−5, 5] range is suppressed as statistically unreliable.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default Pricing;
