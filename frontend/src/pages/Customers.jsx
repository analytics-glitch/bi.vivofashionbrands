import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtPct, fmtDate } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import {
  Users, UserPlus, ArrowsCounterClockwise, UserMinus, Coins,
  MagnifyingGlass, X, UserCircle,
} from "@phosphor-icons/react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip, LabelList,
} from "recharts";

const UpstreamNotReady = ({ label }) => (
  <div className="rounded-lg border border-dashed border-border bg-panel/60 p-4 text-[12.5px] text-muted">
    {label || "Upstream endpoint is currently unavailable — data will appear once the Vivo BI team enables it."}
  </div>
);

// Mask phone to "0705***589" style — keep first 4 and last 3 digits visible,
// replace middle with ***. Leaves already-masked strings (containing •) alone.
const maskPhone = (p) => {
  if (!p) return "—";
  const s = String(p);
  if (s.includes("•") || s.includes("*")) return s; // already masked upstream
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return s;
  return `${digits.slice(0, 4)}***${digits.slice(-3)}`;
};

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
  const [freqPrev, setFreqPrev] = useState([]);
  const [byLoc, setByLoc] = useState([]);
  const [churned, setChurned] = useState([]);
  const [newProducts, setNewProducts] = useState([]);
  const [crosswalk, setCrosswalk] = useState([]);

  // comparison period
  const [custPrev, setCustPrev] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // search
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Days-inactive filter for the churned customers list. Upstream supports
  // any integer; UI offers 60 / 90 / 120 / 180 day presets. Default 90.
  const [churnDays, setChurnDays] = useState(90);
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

    // Load the primary /customers payload FIRST so KPIs render immediately,
    // then fan out the rest of the slower calls without blocking each other.
    api.get("/customers", { params: dateP })
      .then((c) => {
        if (cancelled) return;
        setCust(c.data);
        setLoading(false);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message));

    const rest = [
      ["top", api.get("/top-customers", { params: { ...dateP, limit: 20 } }).catch(() => ({ data: [] }))],
      ["freq", api.get("/customer-frequency", { params: { date_from: dateFrom, date_to: dateTo } }).catch(() => ({ data: [] }))],
      ["byLoc", api.get("/customers-by-location", { params: { date_from: dateFrom, date_to: dateTo, channel } }).catch(() => ({ data: [] }))],
      ["churned", api.get("/churned-customers", { params: { days: churnDays, limit: 500 } }).catch(() => ({ data: [] }))],
      ["np", api.get("/new-customer-products", { params: { date_from: dateFrom, date_to: dateTo, limit: 20 } }).catch(() => ({ data: [] }))],
      ["cw", api.get("/analytics/customer-crosswalk", { params: { date_from: dateFrom, date_to: dateTo, top: 15 } }).catch(() => ({ data: [] }))],
      ["prev", prevRange ? api.get("/customers", { params: { ...prevRange, country, channel } }).catch(() => ({ data: null })) : Promise.resolve({ data: null })],
      ["freqPrev", prevRange ? api.get("/customer-frequency", { params: { date_from: prevRange.date_from, date_to: prevRange.date_to } }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] })],
    ];
    const setters = {
      top: setTop, freq: setFreq, byLoc: setByLoc, churned: setChurned,
      np: setNewProducts, cw: setCrosswalk, prev: setCustPrev, freqPrev: setFreqPrev,
    };
    for (const [key, p] of rest) {
      p.then((r) => { if (!cancelled) setters[key](r.data || (key === "prev" ? null : [])); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode, dataVersion, churnDays]);

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
    return byLoc.map((r) => {
      const t = r.total_customers || 0;
      return {
        ...r,
        pct_of_total: r.pct_of_total != null ? r.pct_of_total : (t / total) * 100,
        pct_new: t ? ((r.new_customers || 0) / t) * 100 : 0,
        pct_returning: t ? ((r.returning_customers || 0) / t) * 100 : 0,
      };
    });
  }, [byLoc]);

  const compareLbl = compareMode === "last_month" ? "vs Last Month" : compareMode === "last_year" ? "vs Last Year" : null;

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
                        <div className="text-[11.5px] text-muted truncate">{r.phone ? maskPhone(r.phone) : (r.email || "—")}</div>
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
                    {[selectedCustomer.phone ? maskPhone(selectedCustomer.phone) : null, selectedCustomer.email, selectedCustomer.city].filter(Boolean).join(" · ") || "—"}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div
              className="card-accent p-3.5 sm:p-5"
              data-testid="kpi-total"
              title="Active customers in period = customers with at least one transaction in the selected date range. Changes day-to-day with the filter."
            >
              <div className="flex items-center gap-2">
                <Users size={16} />
                <div className="eyebrow text-white/80">Active customers (in period)</div>
                <span title="Customers with at least one transaction in the selected period. Differs from 'customers on file' (stock count — not yet wired upstream)." className="text-white/60 text-[10px] cursor-help">ⓘ</span>
              </div>
              <div className="mt-2 text-[22px] sm:text-[28px] font-extrabold num leading-tight">{fmtNum(cust.total_customers)}</div>
              {compareLbl && <div className="mt-1"><Delta curr={cust.total_customers} prev={custPrev?.total_customers} /></div>}
            </div>
            {(() => {
              // Mix = New share of Active (NEW + RETURN sum to 100% of active).
              const active = cust.total_customers || 0;
              const newCount = cust.new_customers || 0;
              const returningCount = (cust.returning_customers || 0) + (cust.repeat_customers || 0);
              const newShare = active ? (newCount / active) * 100 : 0;
              const returningShare = active ? (returningCount / active) * 100 : 0;
              const prevActive = custPrev?.total_customers || 0;
              const prevNewShare = prevActive ? ((custPrev?.new_customers || 0) / prevActive) * 100 : 0;
              const prevReturningShare = prevActive ? (((custPrev?.returning_customers || 0) + (custPrev?.repeat_customers || 0)) / prevActive) * 100 : 0;
              const newSharePp = newShare - prevNewShare;
              const returningSharePp = returningShare - prevReturningShare;
              const ppPill = (pp, invert) => {
                if (!compareLbl || prevActive === 0) return null;
                const good = invert ? pp < 0 : pp > 0;
                const neutral = Math.abs(pp) < 0.1;
                const cls = neutral ? "text-muted" : good ? "text-brand" : "text-danger";
                return (
                  <span className={`text-[10.5px] font-semibold ${cls}`}>
                    {pp >= 0 ? "▲" : "▼"} {Math.abs(pp).toFixed(1)}pp share
                  </span>
                );
              };
              return (
                <>
                  <div
                    className="card-white p-3.5 sm:p-5"
                    data-testid="kpi-new"
                    title="First-time buyers in the selected period. Share = % of active customers who are new."
                  >
                    <div className="flex items-center gap-2">
                      <UserPlus size={16} className="text-brand" />
                      <div className="eyebrow">New</div>
                      <span title="First-time buyers in the selected period. Share = % of active customers who are new." className="text-muted text-[10px] cursor-help">ⓘ</span>
                    </div>
                    <div className="mt-2 text-[18px] sm:text-[24px] font-bold num leading-tight">
                      {fmtNum(newCount)}
                      <span className="text-[13px] text-muted font-semibold ml-1">({newShare.toFixed(1)}%)</span>
                    </div>
                    <div className="text-[10.5px] text-muted mt-0.5">{newShare.toFixed(1)}% of active</div>
                    {compareLbl && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Delta curr={newCount} prev={custPrev?.new_customers} />
                        {ppPill(newSharePp, false)}
                        <span className="text-[10px] text-muted">{compareLbl}</span>
                      </div>
                    )}
                  </div>
                  <div
                    className="card-white p-3.5 sm:p-5"
                    data-testid="kpi-return"
                    title="Returning customers = customers with 2 or more orders. Share = % of active customers who are returning."
                  >
                    <div className="flex items-center gap-2">
                      <ArrowsCounterClockwise size={16} className="text-brand" />
                      <div className="eyebrow">Returning</div>
                      <span title="Returning customers = customers with 2 or more orders. Share = % of active customers who are returning." className="text-muted text-[10px] cursor-help">ⓘ</span>
                    </div>
                    <div className="mt-2 text-[18px] sm:text-[24px] font-bold num leading-tight">
                      {fmtNum(returningCount)}
                      <span className="text-[13px] text-muted font-semibold ml-1">({returningShare.toFixed(1)}%)</span>
                    </div>
                    <div className="text-[10.5px] text-muted mt-0.5">customers with ≥2 orders</div>
                    {compareLbl && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Delta curr={returningCount} prev={(custPrev?.returning_customers || 0) + (custPrev?.repeat_customers || 0)} />
                        {ppPill(returningSharePp, false)}
                        <span className="text-[10px] text-muted">{compareLbl}</span>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
            <KPICard testId="kpi-avg-spend" label="Avg Spend" value={fmtKES(cust.avg_customer_spend)} icon={Coins} showDelta={false} />
            <KPICard
              testId="kpi-churned-count"
              label="Churned Customers"
              sub={`no purchase in ${churnDays}+ days`}
              formula={`Count of customers whose LAST purchase was more than ${churnDays} days ago (as of today). Source: /churned-customers?days=${churnDays}.`}
              value={fmtNum(cust.churned_last_90d || cust.churned_customers || 0)}
              icon={UserMinus}
              higherIsBetter={false}
              showDelta={false}
            />
            <KPICard
              testId="kpi-churn"
              label="Churn Rate"
              sub="in selected period · 90-day cutoff"
              formula={
                `Churn Rate = churned_in_period ÷ total_customers × 100.\n\n` +
                `A customer is counted as CHURNED if their last purchase falls INSIDE the ` +
                `selected date range AND they have not bought anything in the ` +
                `${churnDays} days up to today. For an in-progress period (ends today) ` +
                `this number is naturally near-zero; for historical periods it rises.`
              }
              value={fmtPct(cust.churn_rate, 2)}
              icon={UserMinus}
              higherIsBetter={false}
              showDelta={false}
            />
          </div>

          {/* ---- Customer Trends narrative table ---- */}
          {compareLbl && custPrev && (() => {
            // Helpers ------------------------------------------------------
            const cur = cust; const prev = custPrev;
            const curActive = cur.total_customers || 0;
            const prevActive = prev.total_customers || 0;
            const curNew = cur.new_customers || 0;
            const prevNew = prev.new_customers || 0;
            const curRet = (cur.returning_customers || 0) + (cur.repeat_customers || 0);
            const prevRet = (prev.returning_customers || 0) + (prev.repeat_customers || 0);
            const pctNewCur = curActive ? (curNew / curActive) * 100 : 0;
            const pctNewPrev = prevActive ? (prevNew / prevActive) * 100 : 0;
            const pctRetCur = curActive ? (curRet / curActive) * 100 : 0;
            const pctRetPrev = prevActive ? (prevRet / prevActive) * 100 : 0;

            // Row factory. `mode` drives formatting:
            //  - "num"  : integer, diff shown as +/- integer
            //  - "kes"  : KES currency, diff shown as ±KES
            //  - "dec"  : 2dp decimal, diff shown as ±dec
            //  - "pct"  : percentage VALUE (not pp) — diff is relative %
            //  - "pp"   : percentage-point diff (for shares, rates)
            //  - "pctInv": percentage metric where LOWER is BETTER (churn)
            //  - "ppInv" : pp metric where LOWER is BETTER (churn rate)
            // Returns <tr>. `tip` shows on row hover.
            const fmtKesPos = (v) => (v >= 0 ? "+" : "−") + fmtKES(Math.abs(v));
            const fmtDecPos = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
            const fmtNumPos = (v) => (v >= 0 ? "+" : "−") + fmtNum(Math.abs(v));
            const row = (label, c, p, mode, tip) => {
              const diff = (c || 0) - (p || 0);
              // Determine business-good direction
              const invert = mode === "pctInv" || mode === "ppInv" || mode === "numInv";
              const isGood = invert ? diff < 0 : diff > 0;
              const near = Math.abs(diff) < 1e-9;
              const color = near ? "text-muted" : isGood ? "text-brand" : "text-danger";
              const arrow = near ? "●" : diff > 0 ? "▲" : "▼";
              // Format current / previous cells
              let curCell, prevCell, changeAbs, changeRel;
              if (mode === "kes") {
                curCell = fmtKES(c); prevCell = fmtKES(p);
                changeAbs = fmtKesPos(diff);
                changeRel = p ? `${arrow} ${Math.abs((diff / p) * 100).toFixed(1)}%` : "—";
              } else if (mode === "dec") {
                curCell = (c || 0).toFixed(2); prevCell = (p || 0).toFixed(2);
                changeAbs = fmtDecPos(diff);
                changeRel = p ? `${arrow} ${Math.abs((diff / p) * 100).toFixed(1)}%` : "—";
              } else if (mode === "pct" || mode === "pctInv") {
                curCell = `${(c || 0).toFixed(2)}%`; prevCell = `${(p || 0).toFixed(2)}%`;
                // For straight rate metrics we also show pp diff (more useful)
                changeAbs = `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(2)}pp`;
                changeRel = p ? `${arrow} ${Math.abs((diff / p) * 100).toFixed(1)}%` : "—";
              } else if (mode === "pp" || mode === "ppInv") {
                curCell = `${(c || 0).toFixed(1)}%`; prevCell = `${(p || 0).toFixed(1)}%`;
                changeAbs = `${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)}pp`;
                changeRel = `${arrow}`;
              } else {
                // "num" or "numInv"
                curCell = fmtNum(c); prevCell = fmtNum(p);
                changeAbs = fmtNumPos(diff);
                changeRel = p ? `${arrow} ${Math.abs((diff / p) * 100).toFixed(1)}%` : "—";
              }
              return (
                <tr key={label} title={tip}>
                  <td className="font-medium">
                    {label}
                    {tip && <span className="ml-1 text-muted text-[10px] cursor-help" title={tip}>ⓘ</span>}
                  </td>
                  <td className="text-right num font-semibold">{curCell}</td>
                  <td className="text-right num text-muted">{prevCell}</td>
                  <td className={`text-right num font-semibold ${color}`}>{changeAbs}</td>
                  <td className={`text-right num font-semibold ${color}`}>{changeRel}</td>
                </tr>
              );
            };

            // Section header row
            const groupHeader = (label) => (
              <tr key={`grp-${label}`} className="bg-brand-soft/30">
                <td colSpan={5} className="font-bold text-[11px] uppercase tracking-wider text-brand-deep py-1.5">{label}</td>
              </tr>
            );

            // CSV export — preserves narrative order with group labels
            const csvRows = [
              ["Group", "Metric", "Current", "Previous", "Change", "Change %"],
              ["Customer Volume", "Total Active Customers", curActive, prevActive, curActive - prevActive, prevActive ? ((curActive - prevActive) / prevActive * 100).toFixed(2) + "%" : ""],
              ["Customer Volume", "New Customers", curNew, prevNew, curNew - prevNew, prevNew ? ((curNew - prevNew) / prevNew * 100).toFixed(2) + "%" : ""],
              ["Customer Volume", "Returning Customers", curRet, prevRet, curRet - prevRet, prevRet ? ((curRet - prevRet) / prevRet * 100).toFixed(2) + "%" : ""],
              ["Customer Mix", "% New (of active)", pctNewCur.toFixed(2) + "%", pctNewPrev.toFixed(2) + "%", (pctNewCur - pctNewPrev).toFixed(2) + "pp", ""],
              ["Customer Mix", "% Returning (of active)", pctRetCur.toFixed(2) + "%", pctRetPrev.toFixed(2) + "%", (pctRetCur - pctRetPrev).toFixed(2) + "pp", ""],
              ["Spend Behavior", "Avg Spend / Customer (KES)", cur.avg_customer_spend || 0, prev.avg_customer_spend || 0, (cur.avg_customer_spend || 0) - (prev.avg_customer_spend || 0), ""],
              ["Order Behavior", "Avg Orders / Customer", (cur.avg_orders_per_customer || 0).toFixed(2), (prev.avg_orders_per_customer || 0).toFixed(2), ((cur.avg_orders_per_customer || 0) - (prev.avg_orders_per_customer || 0)).toFixed(2), ""],
              ["Retention Signals", "Churn Rate (selected period)", (cur.churn_rate || 0).toFixed(2) + "%", (prev.churn_rate || 0).toFixed(2) + "%", ((cur.churn_rate || 0) - (prev.churn_rate || 0)).toFixed(2) + "pp", ""],
              ["Retention Signals", "Churned Customers", cur.churned_customers || 0, prev.churned_customers || 0, (cur.churned_customers || 0) - (prev.churned_customers || 0), ""],
            ];
            const exportCsv = () => {
              const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
              const csv = csvRows.map((r) => r.map(esc).join(",")).join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const iso = new Date().toISOString().slice(0, 10);
              const lbl = compareMode === "yesterday" ? "vs-yesterday" : compareMode === "last_year" ? "vs-last-year" : "vs-last-month";
              const a = document.createElement("a");
              a.href = url; a.download = `customer-trends_${lbl}_${iso}.csv`;
              document.body.appendChild(a); a.click(); a.remove();
              URL.revokeObjectURL(url);
            };

            return (
              <div className="card-white p-5" data-testid="period-comparison">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <SectionTitle
                    title={`Customer Trends ${compareLbl}`}
                    subtitle="Track how customer acquisition, retention, and spending behavior have shifted between the current period and the comparison period."
                  />
                  <button
                    type="button"
                    onClick={exportCsv}
                    data-testid="export-period-comparison"
                    className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border border-border hover:border-brand/40 hover:bg-brand-soft/50 bg-white"
                  >
                    Export CSV
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full data">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th className="text-right">Current</th>
                        <th className="text-right">Previous</th>
                        <th className="text-right">Change</th>
                        <th className="text-right">Change %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupHeader("Customer Volume")}
                      {row("Total Active Customers", curActive, prevActive, "num", "Customers with at least one transaction in the period. Green ▲ = growing base.")}
                      {row("New Customers", curNew, prevNew, "num", "First-time buyers in the period. Green ▲ = acquisition improving.")}
                      {row("Returning Customers", curRet, prevRet, "num", "Customers with ≥2 orders in the period. Green ▲ = retention improving.")}

                      {groupHeader("Customer Mix")}
                      {row("% New (of active)", pctNewCur, pctNewPrev, "pp", "Share of active customers who are new. Healthy mix depends on growth stage — early-stage should lean new; mature business should lean returning.")}
                      {row("% Returning (of active)", pctRetCur, pctRetPrev, "pp", "Share of active customers who are returning. Green ▲ = stronger retention mix.")}

                      {groupHeader("Spend Behavior")}
                      {row("Avg Spend / Customer", cur.avg_customer_spend, prev.avg_customer_spend, "kes", "Total sales ÷ active customers. Green ▲ = customers spending more per head.")}

                      {groupHeader("Order Behavior")}
                      {row("Avg Orders / Customer", cur.avg_orders_per_customer, prev.avg_orders_per_customer, "dec", "Total orders ÷ active customers. Green ▲ = customers buying more frequently.")}

                      {groupHeader("Retention Signals")}
                      {row("Churn Rate (selected period)", cur.churn_rate, prev.churn_rate, "pctInv", "% of customers who bought in the period but have not returned in 90+ days. Green ▼ = retention improving. Red ▲ = retention weakening.")}
                      {row("Churned Customers", cur.churned_customers, prev.churned_customers, "numInv", "Count of churned customers in the selected period (90-day cutoff). Lower is better — green ▼.")}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted mt-3">
                  pp = percentage points. Color follows business meaning, not math: lower churn is green, higher returning share is green.
                </p>
              </div>
            );
          })()}

          {/* Projection card moved to Overview page */}

          {/* ---- Customer Loyalty Distribution (replaces raw frequency chart) ---- */}
          {(() => {
            // Always render all 5 buckets — fill zeros if upstream omits any.
            const BUCKETS = [
              { key: "1 order",   label: "1 order",   meaning: "One-time buyer",       color: "#f59e0b" }, // amber
              { key: "2 orders",  label: "2 orders",  meaning: "Early repeat",         color: "#86efac" }, // light green
              { key: "3 orders",  label: "3 orders",  meaning: "Emerging loyal",       color: "#22c55e" }, // medium green
              { key: "4 orders",  label: "4 orders",  meaning: "Loyal",                color: "#15803d" }, // darker green
              { key: "5+ orders", label: "5+ orders", meaning: "VIP / super-loyal",    color: "#14532d" }, // darkest green
            ];
            const lookup = (arr, k) => (arr || []).find((r) => r.frequency_bucket === k)?.customer_count || 0;
            const curTotal = BUCKETS.reduce((s, b) => s + lookup(freq, b.key), 0);
            const prevTotal = BUCKETS.reduce((s, b) => s + lookup(freqPrev, b.key), 0);
            const data = BUCKETS.map((b) => {
              const c = lookup(freq, b.key);
              const p = lookup(freqPrev, b.key);
              const curPct = curTotal ? (c / curTotal) * 100 : 0;
              const prevPct = prevTotal ? (p / prevTotal) * 100 : 0;
              return { ...b, count: c, prev: p, pct: curPct, prevPct, ppDelta: curPct - prevPct };
            });
            const oneOrderShare = data[0]?.pct || 0;
            const repeatRate = 100 - oneOrderShare;
            const prevOneOrderShare = data[0]?.prevPct || 0;
            const prevRepeatRate = 100 - prevOneOrderShare;
            const repeatRateDelta = repeatRate - prevRepeatRate; // pp
            const hasCompare = compareLbl && prevTotal > 0;
            const avgOrdersPerReturning = (() => {
              const retTotal = curTotal - (data[0]?.count || 0); // customers with ≥2 orders
              if (!retTotal) return 0;
              const ordersFromReturning = data.slice(1).reduce((s, b, i) => {
                // Use midpoint for 5+ bucket (conservative: 5)
                const n = i === 3 ? 5 : i + 2; // i=0→2, i=1→3, i=2→4, i=3→5+
                return s + b.count * n;
              }, 0);
              return ordersFromReturning / retTotal;
            })();

            const insight = (() => {
              if (curTotal === 0) return "No customer orders in the selected window.";
              const parts = [
                `${oneOrderShare.toFixed(1)}% of active customers made only 1 purchase this period.`,
                `Repeat rate: ${repeatRate.toFixed(1)}%.`,
              ];
              if (hasCompare) {
                const arrow = repeatRateDelta >= 0 ? "▲" : "▼";
                const verdict = Math.abs(repeatRateDelta) < 0.1 ? "stable" : (repeatRateDelta > 0 ? "retention strengthening" : "retention weakening");
                parts.push(`${compareLbl}: ${arrow} ${Math.abs(repeatRateDelta).toFixed(1)}pp — ${verdict}.`);
              }
              return parts.join(" ");
            })();

            return (
              <div className="card-white p-5" data-testid="customer-frequency-chart">
                <SectionTitle
                  title="Customer Loyalty Distribution"
                  subtitle="Distribution of customers by order frequency in the selected period. Higher-frequency segments indicate stronger loyalty and lifetime value."
                />

                {/* ---- Summary insight bar ---- */}
                {curTotal > 0 && (
                  <div
                    className={`mb-4 rounded-xl p-3 text-[12.5px] border ${
                      repeatRate < 10
                        ? "bg-amber-50 border-amber-300 text-amber-900"
                        : "bg-brand-soft/40 border-brand/30 text-brand-deep"
                    }`}
                    data-testid="frequency-insight"
                  >
                    <strong>{insight}</strong>
                  </div>
                )}

                {curTotal === 0 ? <UpstreamNotReady /> : (
                  <>
                    {/* ---- Supporting KPI strip ---- */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                      <div className="rounded-xl border border-border p-3" data-testid="kpi-repeat-rate">
                        <div className="eyebrow">Repeat Purchase Rate</div>
                        <div className="font-extrabold text-[18px] num mt-0.5">{repeatRate.toFixed(1)}%</div>
                        {hasCompare && (
                          <div className={`text-[11px] font-semibold mt-0.5 ${repeatRateDelta >= 0 ? "text-brand" : "text-danger"}`}>
                            {repeatRateDelta >= 0 ? "▲" : "▼"} {Math.abs(repeatRateDelta).toFixed(1)}pp {compareLbl}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-border p-3" data-testid="kpi-orders-per-returning">
                        <div className="eyebrow">Avg Orders / Returning Customer</div>
                        <div className="font-extrabold text-[18px] num mt-0.5">{avgOrdersPerReturning.toFixed(2)}</div>
                        <div className="text-[11px] text-muted mt-0.5">customers with ≥2 orders</div>
                      </div>
                      <div className="rounded-xl border border-border p-3" data-testid="kpi-vip-count">
                        <div className="eyebrow">VIP (5+ orders)</div>
                        <div className="font-extrabold text-[18px] num mt-0.5">{fmtNum(data[4]?.count || 0)}</div>
                        <div className="text-[11px] text-muted mt-0.5">
                          {curTotal ? ((data[4]?.count || 0) / curTotal * 100).toFixed(1) : "0.0"}% of base
                        </div>
                      </div>
                    </div>

                    {/* ---- Grouped / single bar chart ---- */}
                    <div style={{ width: "100%", height: 320 }}>
                      <ResponsiveContainer>
                        <BarChart data={data} margin={{ top: 32, right: 20, left: 10, bottom: 10 }}>
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                          <YAxis tickFormatter={(v) => fmtNum(v)} tick={{ fontSize: 11 }} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const d = payload[0].payload;
                              return (
                                <div className="rounded-lg shadow-lg bg-white border border-border p-3 text-[12px] min-w-[180px]">
                                  <div className="font-bold text-[13px]">{d.label}</div>
                                  <div className="text-muted text-[11px] mb-1.5">{d.meaning}</div>
                                  <div className="flex justify-between gap-4"><span className="text-muted">Customers</span><span className="font-semibold num">{fmtNum(d.count)}</span></div>
                                  <div className="flex justify-between gap-4"><span className="text-muted">Share of base</span><span className="font-semibold num">{d.pct.toFixed(1)}%</span></div>
                                  {hasCompare && (
                                    <div className="flex justify-between gap-4 mt-1 pt-1 border-t border-border">
                                      <span className="text-muted">{compareLbl}</span>
                                      <span className={`font-semibold num ${d.ppDelta >= 0 ? "text-brand" : "text-danger"}`}>
                                        {d.ppDelta >= 0 ? "▲" : "▼"} {Math.abs(d.ppDelta).toFixed(1)}pp
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            }}
                          />
                          {hasCompare ? (
                            <>
                              <Bar dataKey="prev" name="Previous" fill="#e5e7eb" radius={[4, 4, 0, 0]}>
                                <LabelList dataKey="prev" position="top" formatter={(v) => v ? fmtNum(v) : ""} style={{ fontSize: 10, fill: "#9ca3af" }} />
                              </Bar>
                              <Bar dataKey="count" name="Current" radius={[4, 4, 0, 0]}>
                                {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                                <LabelList
                                  dataKey="count"
                                  position="top"
                                  formatter={(v) => v ? fmtNum(v) : ""}
                                  style={{ fontSize: 11, fill: "#111827", fontWeight: 700 }}
                                />
                              </Bar>
                            </>
                          ) : (
                            <Bar dataKey="count" name="Customers" radius={[5, 5, 0, 0]}>
                              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                              <LabelList
                                dataKey="count"
                                position="top"
                                formatter={(v, entry) => {
                                  const rec = data.find((x) => x.count === v);
                                  return v ? `${fmtNum(v)} (${rec ? rec.pct.toFixed(1) : "0"}%)` : "0";
                                }}
                                style={{ fontSize: 11, fill: "#111827", fontWeight: 700 }}
                              />
                            </Bar>
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* ---- Color legend ---- */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#f59e0b" }} /> One-time buyer (retention risk)
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#86efac" }} /> Early repeat
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#15803d" }} /> Loyal
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#14532d" }} /> VIP / super-loyal
                      </span>
                      {hasCompare && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#e5e7eb" }} /> Previous period
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

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
                  { key: "customer_id", label: "Customer ID", align: "left", render: (r) => <span className="text-muted num text-[11px]">{r.customer_id || "—"}</span>, csv: (r) => r.customer_id },
                  { key: "customer_name", label: "Name", align: "left", render: (r) => <span className="font-medium break-words max-w-[200px] inline-block">{r.customer_name || "—"}</span> },
                  { key: "phone", label: "Phone", align: "left", render: (r) => <span className="text-muted">{maskPhone(r.phone)}</span>, csv: (r) => maskPhone(r.phone) },
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
            <SectionTitle
              title="Customers by POS"
              subtitle="New vs returning customer mix at each location. % New and % Returning show the split within each store; % Share of Customers shows each store's contribution to total customer count."
            />
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
                  {
                    key: "pct_new",
                    label: "% New",
                    numeric: true,
                    render: (r) => <span className="pill-green">{(r.pct_new || 0).toFixed(1)}%</span>,
                    csv: (r) => (r.pct_new || 0).toFixed(2),
                  },
                  {
                    key: "pct_returning",
                    label: "% Returning",
                    numeric: true,
                    render: (r) => <span className="pill-neutral" style={{ background: "#dbeafe", color: "#1e40af" }}>{(r.pct_returning || 0).toFixed(1)}%</span>,
                    csv: (r) => (r.pct_returning || 0).toFixed(2),
                  },
                  {
                    key: "pct_of_total",
                    label: "% Share of Customers",
                    numeric: true,
                    render: (r) => fmtPct(r.pct_of_total, 1),
                    csv: (r) => r.pct_of_total?.toFixed(2),
                  },
                ]}
                rows={byLocWithPct}
              />
            )}
          </div>

          {/* ---- Churned customers ---- */}
          <div className="card-white p-5 border-l-4 border-danger" data-testid="churned-customers-section">
            <SectionTitle
              title={`Churned Customers (no purchase in ${churnDays}+ days)`}
              subtitle={`${fmtNum(churned.length)}${churned.length >= 500 ? "+" : ""} customers · sorted by Lifetime Spend descending. Paginated · 25 rows per page.`}
              action={
                <div className="inline-flex items-center gap-1.5 text-[11.5px]" data-testid="churn-days-filter">
                  <span className="text-muted font-medium">Days inactive:</span>
                  {[60, 90, 120, 180].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setChurnDays(d)}
                      data-testid={`churn-days-${d}`}
                      className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${
                        churnDays === d
                          ? "bg-brand text-white"
                          : "bg-panel text-foreground/70 hover:bg-white border border-border"
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              }
            />
            {churned.length === 0 ? (
              <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-[12.5px] text-amber-900">
                ⚠️ Upstream <code>/churned-customers?days={churnDays}</code> returned no rows. The aggregated count ({fmtNum(cust.churned_last_90d || cust.churned_customers || 0)}) from <code>/customers</code> is used for the KPI above.
              </div>
            ) : (
              <SortableTable
                testId="churned-customers"
                exportName={`churned-customers-${churnDays}d.csv`}
                initialSort={{ key: "lifetime_spend", dir: "desc" }}
                pageSize={25}
                columns={[
                  { key: "customer_name", label: "Name", align: "left", render: (r) => <span className="font-medium break-words max-w-[220px] inline-block">{r.customer_name || "—"}</span> },
                  { key: "phone", label: "Phone", align: "left", render: (r) => <span className="text-muted">{maskPhone(r.phone)}</span>, csv: (r) => maskPhone(r.phone) },
                  { key: "last_purchase_date", label: "Last Purchase Date", render: (r) => fmtDate(r.last_purchase_date) || "—" },
                  { key: "days_since_last_purchase", label: "Days Since Last Purchase", numeric: true, render: (r) => <span className={(r.days_since_last_purchase || 0) > 180 ? "pill-red" : "pill-amber"}>{fmtNum(r.days_since_last_purchase)}d</span>, csv: (r) => r.days_since_last_purchase },
                  { key: "total_orders", label: "Total Orders", numeric: true, render: (r) => fmtNum(r.total_orders) },
                  { key: "lifetime_spend", label: "Lifetime Spend KES", numeric: true, render: (r) => <span className="text-brand font-bold">{fmtKES(r.lifetime_spend)}</span>, csv: (r) => r.lifetime_spend },
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
