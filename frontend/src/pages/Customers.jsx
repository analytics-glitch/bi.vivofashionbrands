import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtPct, fmtDate } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { ChartTooltip } from "@/components/ChartHelpers";
import {
  Users, UserPlus, ArrowsCounterClockwise, UserMinus, Coins,
  MagnifyingGlass, X, UserCircle, TrendUp, Crosshair,
} from "@phosphor-icons/react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip, LabelList,
} from "recharts";

const UpstreamNotReady = ({ label }) => (
  <div className="rounded-lg border border-dashed border-border bg-panel/60 p-4 text-[12.5px] text-muted">
    {label || "Upstream endpoint is currently unavailable — data will appear once the Vivo BI team enables it."}
  </div>
);

// Delta pill vs previous period
const Delta = ({ curr, prev, invert }) => {
  if (prev == null || curr == null) return null;
  const diff = curr - prev;
  const pct = prev ? (diff / prev) * 100 : 0;
  const good = invert ? diff < 0 : diff > 0;
  const neutral = Math.abs(pct) < 0.1;
  const cls = neutral ? "text-muted" : good ? "text-brand" : "text-danger";
  return (
    <span className={`text-[11px] font-semibold ${cls}`}>
      {diff >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
};

const Customers = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode, dataVersion } = applied;

  // primary period
  const [cust, setCust] = useState(null);
  const [top, setTop] = useState([]);
  const [freq, setFreq] = useState([]);
  const [byLoc, setByLoc] = useState([]);
  const [churned, setChurned] = useState([]);
  const [newProducts, setNewProducts] = useState([]);
  const [crosswalk, setCrosswalk] = useState([]);
  const [projection, setProjection] = useState(null);

  // comparison period
  const [custPrev, setCustPrev] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // search
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerProducts, setCustomerProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Compute the previous-period range
  const prevRange = useMemo(() => {
    if (compareMode === "none") return null;
    const f = new Date(dateFrom); const t = new Date(dateTo);
    let fromPrev, toPrev;
    if (compareMode === "last_month") {
      fromPrev = new Date(f); fromPrev.setMonth(f.getMonth() - 1);
      toPrev = new Date(t); toPrev.setMonth(t.getMonth() - 1);
    } else {
      fromPrev = new Date(f); fromPrev.setFullYear(f.getFullYear() - 1);
      toPrev = new Date(t); toPrev.setFullYear(t.getFullYear() - 1);
    }
    const iso = (d) => d.toISOString().slice(0, 10);
    return { date_from: iso(fromPrev), date_to: iso(toPrev) };
  }, [compareMode, dateFrom, dateTo]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const country = countries.length === 1 ? countries[0] : undefined;
    const channel = channels.length ? channels.join(",") : undefined;
    const dateP = { date_from: dateFrom, date_to: dateTo, country, channel };

    const calls = [
      api.get("/customers", { params: dateP }).catch(() => ({ data: null })),
      api.get("/top-customers", { params: { ...dateP, limit: 20 } }).catch(() => ({ data: [] })),
      api.get("/customer-frequency", { params: { date_from: dateFrom, date_to: dateTo } }).catch(() => ({ data: [] })),
      api.get("/customers-by-location", { params: { date_from: dateFrom, date_to: dateTo, channel } }).catch(() => ({ data: [] })),
      api.get("/churned-customers", { params: { days: 90, limit: 20 } }).catch(() => ({ data: [] })),
      api.get("/new-customer-products", { params: { date_from: dateFrom, date_to: dateTo, limit: 20 } }).catch(() => ({ data: [] })),
      api.get("/analytics/customer-crosswalk", { params: { date_from: dateFrom, date_to: dateTo, top: 15 } }).catch(() => ({ data: [] })),
      api.get("/analytics/sales-projection", { params: dateP }).catch(() => ({ data: null })),
      prevRange ? api.get("/customers", { params: { ...prevRange, country, channel } }).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
    ];

    Promise.all(calls)
      .then(([c, t, f, bl, ch, np, cw, sp, cPrev]) => {
        if (cancelled) return;
        setCust(c.data);
        setTop(t.data || []);
        setFreq(f.data || []);
        setByLoc(bl.data || []);
        setChurned(ch.data || []);
        setNewProducts(np.data || []);
        setCrosswalk(cw.data || []);
        setProjection(sp.data);
        setCustPrev(cPrev.data);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode, dataVersion]);

  // debounced search
  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get("/customer-search", { params: { q: searchQ.trim() } });
        setSearchResults(data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQ]);

  const openCustomer = async (c) => {
    setSelectedCustomer(c);
    setLoadingProducts(true);
    setCustomerProducts([]);
    try {
      const { data } = await api.get("/customer-products", {
        params: { customer_id: c.customer_id },
      });
      setCustomerProducts(data || []);
    } catch {
      setCustomerProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  const byLocWithPct = useMemo(() => {
    const total = byLoc.reduce((s, r) => s + (r.total_customers || 0), 0) || 1;
    return byLoc.map((r) => ({
      ...r,
      pct_of_total: r.pct_of_total != null ? r.pct_of_total : (r.total_customers / total) * 100,
    }));
  }, [byLoc]);

  const compareLbl = compareMode === "last_month" ? "vs LM" : compareMode === "last_year" ? "vs LY" : null;

  return (
    <div className="space-y-6" data-testid="customers-page">
      <div>
        <div className="eyebrow">Dashboard · Customers</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">
          Customers
        </h1>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && cust && (
        <>
          {/* ---- Search bar ---- */}
          <div className="card-white p-4" data-testid="customer-search-card">
            <SectionTitle
              title="Customer lookup"
              subtitle="Search by name or phone number. Click a result to open their full purchase history."
            />
            <div className="flex items-center gap-2 input-pill">
              <MagnifyingGlass size={16} className="text-muted" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Type a name or phone number…"
                data-testid="customer-search-input"
                className="bg-transparent outline-none text-[13.5px] w-full"
              />
              {searchQ && (
                <button
                  type="button"
                  onClick={() => { setSearchQ(""); setSearchResults([]); }}
                  className="p-1 rounded hover:bg-panel"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {searching && <div className="mt-2 text-[12px] text-muted">Searching…</div>}
            {searchQ && !searching && searchResults.length === 0 && (
              <div className="mt-2 text-[12px] text-muted">No customers found.</div>
            )}
            {searchResults.length > 0 && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {searchResults.slice(0, 24).map((r) => (
                  <button
                    key={r.customer_id || r.phone}
                    type="button"
                    onClick={() => openCustomer(r)}
                    data-testid="customer-result-card"
                    className="text-left card-white p-3 hover:border-brand transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <UserCircle size={20} className="text-brand" weight="fill" />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[13px] truncate">{r.customer_name || "—"}</div>
                        <div className="text-[11.5px] text-muted truncate">{r.phone || r.email || "—"}</div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-[11px]">
                      <div><div className="eyebrow">Orders</div><div className="num font-semibold">{fmtNum(r.total_orders)}</div></div>
                      <div><div className="eyebrow">Spend</div><div className="num font-semibold">{fmtKES(r.total_sales)}</div></div>
                      <div><div className="eyebrow">First</div><div className="num text-[10px]">{fmtDate(r.first_purchase_date) || "—"}</div></div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ---- Customer detail drawer ---- */}
          {selectedCustomer && (
            <div className="card-white p-5 border-l-4 border-brand" data-testid="customer-detail">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="eyebrow">Customer detail</div>
                  <div className="font-bold text-[16px] mt-0.5">{selectedCustomer.customer_name || "—"}</div>
                  <div className="text-[12px] text-muted">
                    {[selectedCustomer.phone, selectedCustomer.email, selectedCustomer.city].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <button type="button" onClick={() => { setSelectedCustomer(null); setCustomerProducts([]); }} className="p-1.5 rounded hover:bg-panel">
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <div><div className="eyebrow">Total Orders</div><div className="font-semibold num">{fmtNum(selectedCustomer.total_orders)}</div></div>
                <div><div className="eyebrow">Units</div><div className="font-semibold num">{fmtNum(selectedCustomer.total_units)}</div></div>
                <div><div className="eyebrow">Lifetime Spend</div><div className="font-semibold num text-brand">{fmtKES(selectedCustomer.total_sales)}</div></div>
                <div><div className="eyebrow">Avg Basket</div><div className="font-semibold num">{fmtKES(selectedCustomer.avg_basket)}</div></div>
                <div><div className="eyebrow">First Purchase</div><div className="text-[13px]">{fmtDate(selectedCustomer.first_purchase_date) || "—"}</div></div>
                <div><div className="eyebrow">Last Purchase</div><div className="text-[13px]">{fmtDate(selectedCustomer.last_purchase_date) || "—"}</div></div>
              </div>
              <div className="mt-5">
                <SectionTitle title="Top products bought" subtitle="Ranked by units purchased" />
                {loadingProducts ? <Loading /> : customerProducts.length === 0 ? (
                  <Empty label="No product history available for this customer." />
                ) : (
                  <SortableTable
                    testId="customer-products-table"
                    exportName={`customer-${selectedCustomer.customer_id}-products.csv`}
                    initialSort={{ key: "units_bought", dir: "desc" }}
                    columns={[
                      { key: "style_name", label: "Style", align: "left", render: (r) => <span className="font-medium break-words max-w-[280px] inline-block">{r.style_name}</span> },
                      { key: "subcategory", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.subcategory || "—"}</span> },
                      { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                      { key: "units_bought", label: "Units", numeric: true, render: (r) => fmtNum(r.units_bought) },
                      { key: "total_spend", label: "Spend", numeric: true, render: (r) => <span className="text-brand font-semibold">{fmtKES(r.total_spend)}</span>, csv: (r) => r.total_spend },
                      { key: "last_bought", label: "Last Bought", render: (r) => fmtDate(r.last_bought) || "—" },
                    ]}
                    rows={customerProducts}
                  />
                )}
              </div>
            </div>
          )}

          {/* ---- KPIs with vs LM / vs LY deltas ---- */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="card-accent p-3.5 sm:p-5" data-testid="kpi-total">
              <div className="flex items-center gap-2"><Users size={16} /><div className="eyebrow text-white/80">Total Customers</div></div>
              <div className="mt-2 text-[22px] sm:text-[28px] font-extrabold num leading-tight">{fmtNum(cust.total_customers)}</div>
              {compareLbl && <div className="mt-1"><Delta curr={cust.total_customers} prev={custPrev?.total_customers} /></div>}
            </div>
            <div className="card-white p-3.5 sm:p-5" data-testid="kpi-new">
              <div className="flex items-center gap-2"><UserPlus size={16} className="text-brand" /><div className="eyebrow">New</div></div>
              <div className="mt-2 text-[18px] sm:text-[24px] font-bold num leading-tight">{fmtNum(cust.new_customers)}</div>
              {compareLbl && <div className="mt-1 flex items-center gap-1"><Delta curr={cust.new_customers} prev={custPrev?.new_customers} /><span className="text-[10px] text-muted">{compareLbl}</span></div>}
            </div>
            <div className="card-white p-3.5 sm:p-5" data-testid="kpi-returning">
              <div className="flex items-center gap-2"><ArrowsCounterClockwise size={16} className="text-brand" /><div className="eyebrow">Returning</div></div>
              <div className="mt-2 text-[18px] sm:text-[24px] font-bold num leading-tight">{fmtNum(cust.returning_customers)}</div>
              {compareLbl && <div className="mt-1 flex items-center gap-1"><Delta curr={cust.returning_customers} prev={custPrev?.returning_customers} /><span className="text-[10px] text-muted">{compareLbl}</span></div>}
            </div>
            <KPICard testId="kpi-repeat" label="Repeat" sub="≥2 orders" value={fmtNum(cust.repeat_customers)} showDelta={false} />
            <KPICard testId="kpi-avg-spend" label="Avg Spend" value={fmtKES(cust.avg_customer_spend)} icon={Coins} showDelta={false} />
            <KPICard testId="kpi-churn" label="Churn Rate" sub={cust.churned_last_90d > 0 ? "last 90 days" : "all-time cumulative"} value={fmtPct(cust.churn_rate, 2)} icon={UserMinus} higherIsBetter={false} showDelta={false} />
          </div>

          {/* ---- Projection card ---- */}
          {projection && projection.total_days > 0 && (
            <div className="card-white p-5" data-testid="sales-projection">
              <SectionTitle
                title="Projected period sales · run-rate view"
                subtitle={`Day ${projection.days_elapsed} of ${projection.total_days} (${projection.completion_pct.toFixed(0)}% through the window)`}
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <div className="eyebrow">Actual so far</div>
                  <div className="text-[20px] sm:text-[24px] font-bold text-brand num">{fmtKES(projection.actual_sales)}</div>
                </div>
                <div>
                  <div className="eyebrow">Daily run-rate</div>
                  <div className="text-[18px] sm:text-[22px] font-bold num">{fmtKES(projection.daily_run_rate)}</div>
                </div>
                <div>
                  <div className="eyebrow">Projected end-of-period</div>
                  <div className="text-[20px] sm:text-[24px] font-extrabold text-brand-deep num">
                    <TrendUp size={18} className="inline mr-1" weight="bold" />
                    {fmtKES(projection.projected_sales)}
                  </div>
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-panel overflow-hidden">
                <div
                  className="h-full bg-brand-strong transition-all"
                  style={{ width: `${Math.min(100, projection.completion_pct)}%` }}
                />
              </div>
            </div>
          )}

          {/* ---- Frequency chart ---- */}
          <div className="card-white p-5" data-testid="customer-frequency-chart">
            <SectionTitle title="Customer purchase frequency" subtitle="How many times customers ordered in the window" />
            {freq.length === 0 ? <UpstreamNotReady /> : (
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <BarChart data={freq} margin={{ top: 24, right: 20, left: 10, bottom: 10 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="frequency_bucket" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(v) => fmtNum(v)} tick={{ fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip formatters={{ customer_count: (v) => `${fmtNum(v)} customers`, Customers: (v) => `${fmtNum(v)} customers` }} />} />
                    <Bar dataKey="customer_count" fill="#1a5c38" radius={[5, 5, 0, 0]} name="Customers">
                      <LabelList dataKey="customer_count" position="top" formatter={(v) => fmtNum(v)} style={{ fontSize: 11, fill: "#4b5563", fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* ---- Top 20 customers (with City) ---- */}
          <div className="card-white p-5" data-testid="top-customers-section">
            <SectionTitle title="Top 20 Customers" subtitle="Ranked by total sales in the selected window" />
            {top.length === 0 ? <UpstreamNotReady /> : (
              <SortableTable
                testId="top-customers"
                exportName="top-20-customers.csv"
                initialSort={{ key: "total_sales", dir: "desc" }}
                columns={[
                  { key: "rank", label: "#", align: "left", sortable: false, render: (_r, i) => <span className="text-muted num">{i + 1}</span> },
                  { key: "customer_name", label: "Name", align: "left", render: (r) => <span className="font-medium break-words max-w-[200px] inline-block">{r.customer_name || "—"}</span> },
                  { key: "phone", label: "Phone", align: "left", render: (r) => <span className="text-muted">{r.phone || "—"}</span>, csv: (r) => r.phone },
                  { key: "city", label: "City", align: "left", render: (r) => r.city || "—", csv: (r) => r.city },
                  { key: "total_orders", label: "Orders", numeric: true, render: (r) => fmtNum(r.total_orders) },
                  { key: "total_units", label: "Units", numeric: true, render: (r) => fmtNum(r.total_units) },
                  { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                  { key: "avg_basket", label: "Avg Basket", numeric: true, render: (r) => fmtKES(r.avg_basket), csv: (r) => r.avg_basket },
                  { key: "last_purchase_date", label: "Last Purchase", render: (r) => fmtDate(r.last_purchase_date) || "—" },
                ]}
                rows={top}
              />
            )}
          </div>

          {/* ---- Store cross-shop (customer-crosswalk) ---- */}
          <div className="card-white p-5" data-testid="customer-crosswalk-section">
            <SectionTitle
              title="Stores sharing customers"
              subtitle="Which POS locations attract the same shoppers — handy for cross-promotion and loyalty campaigns"
            />
            {crosswalk.length === 0 ? <UpstreamNotReady label="No cross-shop overlap detected in the selected window." /> : (
              <SortableTable
                testId="crosswalk-table"
                exportName="customer-crosswalk.csv"
                initialSort={{ key: "shared_customers", dir: "desc" }}
                columns={[
                  { key: "store_a", label: "Store A", align: "left" },
                  { key: "store_b", label: "Store B", align: "left" },
                  { key: "shared_customers", label: "Shared Customers", numeric: true, render: (r) => <span className="font-bold text-brand">{fmtNum(r.shared_customers)}</span> },
                  { key: "pct_overlap", label: "% Overlap", numeric: true, render: (r) => <span className="pill-neutral">{(r.pct_overlap || 0).toFixed(1)}%</span>, csv: (r) => r.pct_overlap?.toFixed(2) },
                ]}
                rows={crosswalk}
              />
            )}
            <p className="text-[11px] text-muted italic mt-2">
              Overlap is computed from each store's top-50 customer list — approximation (upstream doesn't expose per-customer store history yet).
            </p>
          </div>

          {/* ---- Customers by POS ---- */}
          <div className="card-white p-5" data-testid="customers-by-location-section">
            <SectionTitle title="Customers by POS" subtitle="New vs returning breakdown per location" />
            {byLocWithPct.length === 0 ? <UpstreamNotReady /> : (
              <SortableTable
                testId="customers-by-location"
                exportName="customers-by-location.csv"
                initialSort={{ key: "total_customers", dir: "desc" }}
                columns={[
                  { key: "pos_location", label: "POS Location", align: "left", render: (r) => <span className="font-medium">{r.pos_location}</span> },
                  { key: "country", label: "Country", align: "left" },
                  { key: "new_customers", label: "New", numeric: true, render: (r) => fmtNum(r.new_customers) },
                  { key: "returning_customers", label: "Returning", numeric: true, render: (r) => fmtNum(r.returning_customers) },
                  { key: "total_customers", label: "Total", numeric: true, render: (r) => <span className="font-semibold">{fmtNum(r.total_customers)}</span> },
                  { key: "pct_of_total", label: "% of Total", numeric: true, render: (r) => fmtPct(r.pct_of_total, 1), csv: (r) => r.pct_of_total?.toFixed(2) },
                ]}
                rows={byLocWithPct}
              />
            )}
          </div>

          {/* ---- Churned customers ---- */}
          <div className="card-white p-5 border-l-4 border-danger" data-testid="churned-customers-section">
            <SectionTitle
              title={`Churned customers · top ${churned.length}`}
              subtitle="Customers with no purchase in the last 90 days. Sorted by most recent churn first."
            />
            {churned.length === 0 ? <UpstreamNotReady /> : (
              <SortableTable
                testId="churned-customers"
                exportName="churned-customers.csv"
                initialSort={{ key: "days_since_last_purchase", dir: "asc" }}
                columns={[
                  { key: "customer_name", label: "Name", align: "left", render: (r) => <span className="font-medium break-words max-w-[220px] inline-block">{r.customer_name || "—"}</span> },
                  { key: "phone", label: "Phone", align: "left", render: (r) => <span className="text-muted">{r.phone || "—"}</span>, csv: (r) => r.phone },
                  { key: "last_purchase_date", label: "Last Purchase", render: (r) => fmtDate(r.last_purchase_date) || "—" },
                  { key: "days_since_last_purchase", label: "Days Since", numeric: true, render: (r) => <span className={(r.days_since_last_purchase || 0) > 180 ? "pill-red" : "pill-amber"}>{fmtNum(r.days_since_last_purchase)}d</span>, csv: (r) => r.days_since_last_purchase },
                  { key: "total_orders", label: "Orders", numeric: true, render: (r) => fmtNum(r.total_orders) },
                  { key: "lifetime_spend", label: "Lifetime Spend", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.lifetime_spend)}</span>, csv: (r) => r.lifetime_spend },
                ]}
                rows={churned}
              />
            )}
          </div>

          {/* ---- What new customers bought ---- */}
          <div className="card-white p-5" data-testid="new-customer-products-section">
            <SectionTitle
              title="What new customers bought"
              subtitle="Acquisition-driving styles — prioritize these for new-customer campaigns"
            />
            {newProducts.length === 0 ? <UpstreamNotReady /> : (
              <SortableTable
                testId="new-customer-products"
                exportName="new-customer-products.csv"
                initialSort={{ key: "total_sales", dir: "desc" }}
                columns={[
                  { key: "style_name", label: "Style", align: "left", render: (r) => <span className="font-medium break-words max-w-[280px] inline-block">{r.style_name}</span> },
                  { key: "subcategory", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.subcategory || "—"}</span> },
                  { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                  { key: "units_sold", label: "Units Sold", numeric: true, render: (r) => fmtNum(r.units_sold) },
                  { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
                  { key: "pct_of_new_customer_sales", label: "% of New-Cust Sales", numeric: true, render: (r) => fmtPct(r.pct_of_new_customer_sales, 2), csv: (r) => r.pct_of_new_customer_sales?.toFixed(2) },
                ]}
                rows={newProducts}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Customers;
