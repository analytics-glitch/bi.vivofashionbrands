import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, fmtKES, fmtNum, fmtPct, fmtDate } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import {
  Sun, CalendarBlank, ArrowClockwise, Sparkle, Storefront, Package as PackageIcon,
  TrendUp, TrendDown, Warning, Pulse, Coins, ShoppingBag, Users,
} from "@phosphor-icons/react";

/**
 * Morning Brief — AI-generated daily narrative + supporting data tables.
 *
 * Fetches /api/morning-brief?brief_date=YYYY-MM-DD&country=Kenya — a thin
 * proxy to the standalone Cloud Run service. The backend caches the
 * response for 1 hour (the upstream LLM regenerates once per day).
 *
 * Layout:
 *   1. Header — date picker, country selector, refresh button
 *   2. AI Narrative card — full markdown render of `brief` field
 *   3. KPI strip — `sales[0]` (orders / sales / units / avg basket / customers)
 *   4. Two-column grid:
 *      • Category mix (left)        • Top styles (right)
 *      • Stock alerts (left)        • Dead stock (right)
 *      • Declining (left)           • New styles (right)
 *      • Store performance (full width)
 *   5. Customers + Zero-sales footer
 */

const todayISO = () => new Date().toISOString().slice(0, 10);
const COUNTRIES = ["Kenya", "Uganda", "Rwanda"];

const formatBriefDate = (d) => {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  } catch {
    return d;
  }
};

// Tailwind classes for the markdown narrative — keeps it readable and
// branded without bringing in a heavy typography plugin.
const mdComponents = {
  h1: ({ node, ...p }) => <h1 className="text-[22px] font-extrabold text-brand-deep mt-0 mb-3" {...p} />,
  h2: ({ node, ...p }) => <h2 className="text-[16px] font-bold text-brand-deep mt-5 mb-2 pb-1 border-b border-[#fcd9b6]" {...p} />,
  h3: ({ node, ...p }) => <h3 className="text-[14px] font-semibold text-foreground/90 mt-4 mb-1.5" {...p} />,
  p:  ({ node, ...p }) => <p className="text-[13.5px] leading-relaxed text-foreground/85 mb-2" {...p} />,
  ul: ({ node, ...p }) => <ul className="list-disc pl-5 mb-3 space-y-1" {...p} />,
  ol: ({ node, ...p }) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...p} />,
  li: ({ node, ...p }) => <li className="text-[13px] leading-relaxed text-foreground/85" {...p} />,
  strong: ({ node, ...p }) => <strong className="font-semibold text-brand-deep" {...p} />,
  em: ({ node, ...p }) => <em className="italic text-foreground/80" {...p} />,
  code: ({ node, ...p }) => <code className="bg-[#fef3e3] text-brand-deep px-1.5 py-0.5 rounded text-[12px] font-mono" {...p} />,
  blockquote: ({ node, ...p }) => (
    <blockquote className="border-l-4 border-brand pl-3 my-2 italic text-foreground/75" {...p} />
  ),
};

// Compact KPI tile used in the headline strip.
const KpiPill = ({ icon: Icon, label, value, sub, testId }) => (
  <div
    className="rounded-xl border border-[#fcd9b6] bg-white p-3 flex flex-col gap-1"
    data-testid={testId}
  >
    <div className="flex items-center gap-1.5 text-[10.5px] uppercase font-bold tracking-wider text-brand-deep/70">
      {Icon ? <Icon size={12} weight="bold" /> : null}
      {label}
    </div>
    <div className="text-[20px] font-extrabold num text-brand-deep leading-none">{value}</div>
    {sub && <div className="text-[10.5px] text-muted">{sub}</div>}
  </div>
);

const MorningBrief = () => {
  const [briefDate, setBriefDate] = useState(todayISO());
  const [country, setCountry] = useState("Kenya");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    api.get("/morning-brief", { params: { brief_date: briefDate, country }, timeout: 90000 })
      .then(({ data }) => { if (!cancel) setData(data); })
      .catch((e) => {
        if (cancel) return;
        const detail = e?.response?.data?.detail || e.message || "Failed to load brief";
        const status = e?.response?.status;
        if (status === 404) {
          setError(`No brief has been generated for ${formatBriefDate(briefDate)} in ${country} yet. Try an earlier date.`);
        } else if (status === 503) {
          setError(detail || "Morning Brief service is temporarily unavailable. Please try again in a few minutes.");
        } else {
          setError(detail);
        }
        setData(null);
      })
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [briefDate, country, refreshKey]);

  const d = data?.data || {};
  const sales = (d.sales && d.sales[0]) || null;
  const customers = (d.customers && d.customers[0]) || null;
  const stores = d.stores || [];
  const categoryMix = d.category_mix || [];
  const topStyles = d.top_styles || [];
  const declining = d.declining || [];
  const newStyles = d.new_styles || [];
  const stockAlerts = d.stock_alerts || [];
  const deadStock = d.dead_stock || [];
  const zeroSales = d.zero_sales || [];

  return (
    <div className="space-y-4" data-testid="morning-brief-page">
      {/* ---- Header ---- */}
      <div className="rounded-2xl bg-gradient-to-br from-[#1a5c38] via-[#0f3d24] to-[#0a2917] p-5 text-white" data-testid="morning-brief-header">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sun size={20} weight="fill" className="text-amber-300" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-amber-200/90">
                Morning Brief
              </span>
            </div>
            <h1 className="text-[26px] sm:text-[30px] font-extrabold leading-tight" data-testid="morning-brief-title">
              {formatBriefDate(briefDate)}
            </h1>
            <div className="text-[12.5px] text-white/70 mt-1">
              {country} · AI-generated narrative + supporting data · refreshed hourly
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 backdrop-blur-sm">
              <CalendarBlank size={14} weight="bold" className="text-amber-200" />
              <input
                type="date"
                value={briefDate}
                max={todayISO()}
                onChange={(e) => setBriefDate(e.target.value)}
                data-testid="morning-brief-date-picker"
                className="bg-transparent text-[12.5px] font-semibold text-white outline-none [color-scheme:dark]"
              />
            </div>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              data-testid="morning-brief-country-select"
              className="px-3 py-2 rounded-lg bg-white/10 text-white text-[12.5px] font-semibold outline-none border border-white/15 hover:bg-white/15 focus:bg-white/15 [color-scheme:dark]"
            >
              {COUNTRIES.map((c) => <option key={c} value={c} className="text-foreground">{c}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              data-testid="morning-brief-refresh-btn"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-400 text-[#0a2917] text-[12px] font-bold hover:bg-amber-300 transition-colors"
              title="Force-refresh (busts the 1-hour cache)"
            >
              <ArrowClockwise size={13} weight="bold" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ---- Loading / Error states ---- */}
      {loading && <Loading label="Loading morning brief…" />}
      {!loading && error && (
        <div data-testid="morning-brief-error">
          <ErrorBox message={error} />
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* ---- KPI Strip ---- */}
          {sales && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="morning-brief-kpis">
              <KpiPill icon={Coins} label="Total Sales" value={fmtKES(sales.total_sales || 0)}
                sub={`${fmtNum(sales.orders || 0)} orders`} testId="kpi-mb-sales" />
              <KpiPill icon={ShoppingBag} label="Units" value={fmtNum(sales.units || 0)}
                sub={`${(sales.orders ? (sales.units / sales.orders) : 0).toFixed(2)} per order`} testId="kpi-mb-units" />
              <KpiPill icon={Pulse} label="Avg Basket" value={fmtKES(sales.avg_basket || 0)}
                sub="spend per order" testId="kpi-mb-abv" />
              <KpiPill icon={Users} label="Customers" value={fmtNum(sales.customers || 0)}
                sub={customers ? `${fmtNum(customers.walk_ins || 0)} walk-in` : null} testId="kpi-mb-customers" />
              <KpiPill icon={Storefront} label="Stores Active" value={fmtNum(stores.length)}
                sub={`${country}`} testId="kpi-mb-stores" />
            </div>
          )}

          {/* ---- AI Narrative ---- */}
          {data.brief && (
            <div className="rounded-2xl border-2 border-[#fcd9b6] bg-[#fffaf3] p-5 sm:p-6" data-testid="morning-brief-narrative">
              <div className="flex items-center gap-2 mb-3">
                <Sparkle size={16} weight="fill" className="text-amber-500" />
                <span className="text-[10.5px] font-bold uppercase tracking-widest text-brand-deep/70">
                  AI Narrative
                </span>
              </div>
              <ReactMarkdown components={mdComponents}>
                {data.brief}
              </ReactMarkdown>
            </div>
          )}

          {/* ---- Two-column data grid ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Category mix */}
            <div className="card-white p-4" data-testid="mb-category-mix-card">
              <SectionTitle title="Category Mix" subtitle="Sales contribution by product category — yesterday." />
              {categoryMix.length === 0 ? <Empty label="No category data" /> : (
                <SortableTable
                  testId="mb-category-mix-table"
                  exportName={`morning-brief-${briefDate}-category-mix.csv`}
                  initialSort={{ key: "sales", dir: "desc" }}
                  columns={[
                    { key: "category", label: "Category", align: "left",
                      render: (r) => (
                        <div className="flex flex-col">
                          <span className="font-medium">{r.category}</span>
                          {r.broad_category && <span className="text-[10.5px] text-muted">{r.broad_category}</span>}
                        </div>
                      ) },
                    { key: "units", label: "Units", numeric: true, render: (r) => fmtNum(r.units) },
                    { key: "orders", label: "Orders", numeric: true, render: (r) => fmtNum(r.orders) },
                    { key: "sales", label: "Sales", numeric: true,
                      render: (r) => <span className="font-semibold text-brand-deep">{fmtKES(r.sales)}</span>,
                      csv: (r) => r.sales },
                    { key: "pct_of_sales", label: "% Mix", numeric: true,
                      render: (r) => fmtPct(r.pct_of_sales || 0, 1), csv: (r) => r.pct_of_sales },
                  ]}
                  rows={categoryMix}
                />
              )}
            </div>

            {/* Top styles */}
            <div className="card-white p-4" data-testid="mb-top-styles-card">
              <SectionTitle title="Top Selling Styles" subtitle="Best-selling SKUs by units yesterday." />
              {topStyles.length === 0 ? <Empty label="No top styles" /> : (
                <SortableTable
                  testId="mb-top-styles-table"
                  exportName={`morning-brief-${briefDate}-top-styles.csv`}
                  initialSort={{ key: "units_sold", dir: "desc" }}
                  columns={[
                    { key: "style_name", label: "Style", align: "left",
                      render: (r) => (
                        <div className="flex flex-col">
                          <span className="font-medium break-words">{r.style_name}</span>
                          {r.product_type && <span className="text-[10.5px] text-muted">{r.product_type}</span>}
                        </div>
                      ) },
                    { key: "brand", label: "Brand", align: "left",
                      render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                    { key: "units_sold", label: "Units", numeric: true, render: (r) => fmtNum(r.units_sold) },
                    { key: "sales", label: "Sales", numeric: true,
                      render: (r) => <span className="font-semibold text-brand-deep">{fmtKES(r.sales)}</span>,
                      csv: (r) => r.sales },
                    { key: "stores_selling", label: "Stores", numeric: true, render: (r) => fmtNum(r.stores_selling) },
                  ]}
                  rows={topStyles}
                />
              )}
            </div>

            {/* Stock alerts */}
            <div className="card-white p-4 border-l-4 border-l-rose-400" data-testid="mb-stock-alerts-card">
              <SectionTitle
                title={<span className="inline-flex items-center gap-1.5"><Warning size={15} weight="bold" className="text-rose-500" />Stock Alerts</span>}
                subtitle="High-velocity SKUs running thin at a store. Stockout risk."
              />
              {stockAlerts.length === 0 ? <Empty label="No stock alerts" /> : (
                <SortableTable
                  testId="mb-stock-alerts-table"
                  exportName={`morning-brief-${briefDate}-stock-alerts.csv`}
                  initialSort={{ key: "days_of_cover", dir: "asc" }}
                  columns={[
                    { key: "product_name", label: "Product", align: "left",
                      render: (r) => (
                        <div className="flex flex-col">
                          <span className="font-medium break-words max-w-[260px]">{r.product_name}</span>
                          {r.sku && <span className="text-[10.5px] text-muted font-mono">{r.sku}</span>}
                        </div>
                      ) },
                    { key: "location_name", label: "Store", align: "left",
                      render: (r) => <span className="text-[12px]">{r.location_name}</span> },
                    { key: "stock", label: "Stock", numeric: true,
                      render: (r) => <span className="font-semibold text-rose-600">{fmtNum(r.stock)}</span> },
                    { key: "units_sold_7d", label: "Sold 7d", numeric: true, render: (r) => fmtNum(r.units_sold_7d) },
                    { key: "days_of_cover", label: "Days Cover", numeric: true,
                      render: (r) => {
                        const d = r.days_of_cover;
                        if (d === null || d === undefined) return "—";
                        const cls = d < 3 ? "text-rose-600 font-bold" : d < 7 ? "text-amber-600 font-semibold" : "text-foreground";
                        return <span className={cls}>{Number(d).toFixed(1)}</span>;
                      },
                      csv: (r) => r.days_of_cover },
                  ]}
                  rows={stockAlerts}
                />
              )}
            </div>

            {/* Dead stock */}
            <div className="card-white p-4 border-l-4 border-l-slate-400" data-testid="mb-dead-stock-card">
              <SectionTitle
                title={<span className="inline-flex items-center gap-1.5"><PackageIcon size={15} weight="bold" className="text-slate-500" />Dead Stock</span>}
                subtitle="SKUs sitting in the warehouse with no recent off-take. Markdown / re-allocate candidates."
              />
              {deadStock.length === 0 ? <Empty label="No dead stock" /> : (
                <SortableTable
                  testId="mb-dead-stock-table"
                  exportName={`morning-brief-${briefDate}-dead-stock.csv`}
                  initialSort={{ key: "warehouse_stock", dir: "desc" }}
                  columns={[
                    { key: "product_name", label: "Product", align: "left",
                      render: (r) => (
                        <div className="flex flex-col">
                          <span className="font-medium break-words max-w-[280px]">{r.product_name}</span>
                          {r.sku && <span className="text-[10.5px] text-muted font-mono">{r.sku}</span>}
                        </div>
                      ) },
                    { key: "brand", label: "Brand", align: "left",
                      render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                    { key: "product_type", label: "Type", align: "left",
                      render: (r) => <span className="text-[11.5px] text-muted">{r.product_type || "—"}</span> },
                    { key: "warehouse_stock", label: "Warehouse", numeric: true,
                      render: (r) => <span className="font-semibold text-slate-700">{fmtNum(r.warehouse_stock)}</span> },
                  ]}
                  rows={deadStock}
                />
              )}
            </div>

            {/* Declining */}
            <div className="card-white p-4" data-testid="mb-declining-card">
              <SectionTitle
                title={<span className="inline-flex items-center gap-1.5"><TrendDown size={15} weight="bold" className="text-rose-500" />Declining Styles</span>}
                subtitle="SKUs whose weekly velocity has dropped sharply vs the previous week."
              />
              {declining.length === 0 ? <Empty label="No declining styles" /> : (
                <SortableTable
                  testId="mb-declining-table"
                  exportName={`morning-brief-${briefDate}-declining.csv`}
                  initialSort={{ key: "pct_change", dir: "asc" }}
                  columns={[
                    { key: "style_name", label: "Style", align: "left",
                      render: (r) => (
                        <div className="flex flex-col">
                          <span className="font-medium break-words max-w-[260px]">{r.style_name}</span>
                          {r.product_type && <span className="text-[10.5px] text-muted">{r.product_type}</span>}
                        </div>
                      ) },
                    { key: "this_week_units", label: "This Wk", numeric: true,
                      render: (r) => fmtNum(r.this_week_units) },
                    { key: "last_week_units", label: "Last Wk", numeric: true,
                      render: (r) => fmtNum(r.last_week_units) },
                    { key: "pct_change", label: "Δ %", numeric: true,
                      render: (r) => (
                        <span className="font-semibold text-rose-600">
                          ▼ {Math.abs(r.pct_change).toFixed(1)}%
                        </span>
                      ),
                      csv: (r) => r.pct_change },
                  ]}
                  rows={declining}
                />
              )}
            </div>

            {/* New styles */}
            <div className="card-white p-4" data-testid="mb-new-styles-card">
              <SectionTitle
                title={<span className="inline-flex items-center gap-1.5"><TrendUp size={15} weight="bold" className="text-emerald-600" />New Styles</span>}
                subtitle="SKUs that registered their first-ever sale in the last few days."
              />
              {newStyles.length === 0 ? <Empty label="No new styles" /> : (
                <SortableTable
                  testId="mb-new-styles-table"
                  exportName={`morning-brief-${briefDate}-new-styles.csv`}
                  initialSort={{ key: "first_sale_date", dir: "desc" }}
                  columns={[
                    { key: "style_name", label: "Style", align: "left",
                      render: (r) => (
                        <div className="flex flex-col">
                          <span className="font-medium break-words max-w-[260px]">{r.style_name}</span>
                          {r.product_type && <span className="text-[10.5px] text-muted">{r.product_type}</span>}
                        </div>
                      ) },
                    { key: "brand", label: "Brand", align: "left",
                      render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                    { key: "first_sale_date", label: "First Sale",
                      render: (r) => <span className="text-[12px] text-emerald-700 font-semibold">{fmtDate(r.first_sale_date) || "—"}</span>,
                      csv: (r) => r.first_sale_date },
                  ]}
                  rows={newStyles}
                />
              )}
            </div>
          </div>

          {/* ---- Store performance (full width) ---- */}
          <div className="card-white p-4" data-testid="mb-stores-card">
            <SectionTitle
              title={<span className="inline-flex items-center gap-1.5"><Storefront size={15} weight="bold" className="text-brand-deep" />Store Performance</span>}
              subtitle={`${stores.length} stores active in ${country} yesterday. Click any column to sort.`}
            />
            {stores.length === 0 ? <Empty label="No store activity" /> : (
              <SortableTable
                testId="mb-stores-table"
                exportName={`morning-brief-${briefDate}-stores.csv`}
                initialSort={{ key: "sales", dir: "desc" }}
                columns={[
                  { key: "store", label: "Store", align: "left", render: (r) => <span className="font-medium">{r.store}</span> },
                  { key: "country", label: "Country", align: "left",
                    render: (r) => <span className="text-[11.5px] text-muted">{r.country}</span> },
                  { key: "orders", label: "Orders", numeric: true, render: (r) => fmtNum(r.orders) },
                  { key: "units", label: "Units", numeric: true, render: (r) => fmtNum(r.units) },
                  { key: "customers", label: "Customers", numeric: true, render: (r) => fmtNum(r.customers) },
                  { key: "sales", label: "Sales", numeric: true,
                    render: (r) => <span className="font-semibold text-brand-deep">{fmtKES(r.sales)}</span>,
                    csv: (r) => r.sales },
                  { key: "abv", label: "ABV", numeric: true,
                    render: (r) => fmtKES(r.orders ? (r.sales / r.orders) : 0),
                    csv: (r) => (r.orders ? r.sales / r.orders : 0) },
                ]}
                rows={stores}
              />
            )}
          </div>

          {/* ---- Footer: customers + zero sales ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {customers && (
              <div className="card-white p-4" data-testid="mb-customers-card">
                <SectionTitle title="Customer Snapshot" subtitle="Yesterday's identified shopper activity." />
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="rounded-lg border border-border p-3">
                    <div className="eyebrow">Identified</div>
                    <div className="text-[18px] font-extrabold num">{fmtNum(customers.total_customers || 0)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="eyebrow">Walk-ins</div>
                    <div className="text-[18px] font-extrabold num">{fmtNum(customers.walk_ins || 0)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="eyebrow">Orders</div>
                    <div className="text-[18px] font-extrabold num">{fmtNum(customers.orders || 0)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="eyebrow">Avg Basket</div>
                    <div className="text-[18px] font-extrabold num">{fmtKES(customers.avg_basket || 0)}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="card-white p-4" data-testid="mb-zero-sales-card">
              <SectionTitle
                title={<span className="inline-flex items-center gap-1.5"><Warning size={15} weight="bold" className={zeroSales.length ? "text-rose-500" : "text-emerald-600"} />Zero-Sales Stores</span>}
                subtitle="Stores that recorded NO transactions yesterday. Coaching signal."
              />
              {zeroSales.length === 0 ? (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 text-[12.5px] text-emerald-800">
                  All stores transacted yesterday.
                </div>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {zeroSales.map((s, i) => (
                    <li key={`${s.store || i}`} className="text-[12.5px] flex items-center justify-between border border-rose-200 bg-rose-50/40 rounded-md px-3 py-1.5">
                      <span className="font-medium">{s.store || s.location_name || s.name || "Unknown store"}</span>
                      <span className="text-[11px] text-rose-700 font-semibold">0 orders</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MorningBrief;
