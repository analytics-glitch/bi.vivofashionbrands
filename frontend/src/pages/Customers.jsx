import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { useKpis } from "@/lib/useKpis";
import { api, fmtKES, fmtNum, fmtPct, fmtDate } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import {
  Users, UserPlus, ArrowsCounterClockwise, UserMinus, Coins,
  MagnifyingGlass, X, UserCircle, Phone, Eye, Trophy, ArrowRight,
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

// Raw digits for tel: link. Returns null if unusable.
const telHref = (p) => {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, "");
  return digits.length >= 7 ? `tel:${digits}` : null;
};

// Loyalty segment classifier (from total_orders in the period).
// 1 order → New, 2 → Emerging, 3-4 → Loyal, 5+ → VIP.
const segmentFor = (orders) => {
  const n = orders || 0;
  if (n >= 5) return { key: "vip", label: "VIP", cls: "pill-green", icon: "★" };
  if (n >= 3) return { key: "loyal", label: "Loyal", cls: "pill-neutral", icon: "◆" };
  if (n === 2) return { key: "emerging", label: "Emerging", cls: "pill-amber", icon: "△" };
  if (n === 1) return { key: "new", label: "New", cls: "pill-neutral", icon: "○" };
  return { key: "unknown", label: "—", cls: "pill-neutral", icon: "" };
};

// Days since a YYYY-MM-DD or ISO date to today.
const daysSince = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
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
  // Shared KPIs — used to compute Top N's % share of total sales.
  const { kpis } = useKpis();

  // Walk-ins (anonymous transactions) — separate fetch, slow upstream.
  const [walkIns, setWalkIns] = useState(null);
  const [walkInsPrev, setWalkInsPrev] = useState(null);
  const [walkInsLoading, setWalkInsLoading] = useState(true);

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

  // Top N table controls. UI chip changes `topN`, which re-fetches.
  // `topSegment` is a client-side filter (VIP / Loyal / Emerging / New /
  // Lapsing). `showCustomerId` toggles visibility of the technical ID.
  const [topN, setTopN] = useState(20);
  const [topSegment, setTopSegment] = useState("all");
  const [showCustomerId, setShowCustomerId] = useState(false);
  const [topPrev, setTopPrev] = useState([]);

  // Client-side filter chip for the Reactivation Opportunity table.
  const [reactivationChip, setReactivationChip] = useState("all");

  // Previous-period byLoc for period comparisons on the POS table, and
  // /top-skus to compute Acquisition Skew on the "Product Mix" table.
  const [byLocPrev, setByLocPrev] = useState([]);
  const [topSkus, setTopSkus] = useState([]);
  const [retention, setRetention] = useState(null);
  const [spendByType, setSpendByType] = useState(null);
  const [unchurned, setUnchurned] = useState(null);
  const [unchurnedDays, setUnchurnedDays] = useState(90); // 30 / 60 / 90 / 180
  const [unchurnedLoading, setUnchurnedLoading] = useState(false);

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
      ["top", api.get("/top-customers", { params: { ...dateP, limit: topN } }).catch(() => ({ data: [] }))],
      ["freq", api.get("/customer-frequency", { params: { date_from: dateFrom, date_to: dateTo } }).catch(() => ({ data: [] }))],
      ["byLoc", api.get("/customers-by-location", { params: { date_from: dateFrom, date_to: dateTo, channel } }).catch(() => ({ data: [] }))],
      ["churned", api.get("/churned-customers", { params: { days: churnDays, limit: 500 } }).catch(() => ({ data: [] }))],
      ["np", api.get("/new-customer-products", { params: { date_from: dateFrom, date_to: dateTo, limit: 20 } }).catch(() => ({ data: [] }))],
      ["cw", api.get("/analytics/customer-crosswalk", { params: { date_from: dateFrom, date_to: dateTo, top: 15 } }).catch(() => ({ data: [] }))],
      ["prev", prevRange ? api.get("/customers", { params: { ...prevRange, country, channel } }).catch(() => ({ data: null })) : Promise.resolve({ data: null })],
      ["freqPrev", prevRange ? api.get("/customer-frequency", { params: { date_from: prevRange.date_from, date_to: prevRange.date_to } }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] })],
      ["topPrev", prevRange ? api.get("/top-customers", { params: { ...prevRange, country, channel, limit: topN } }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] })],
      ["byLocPrev", prevRange ? api.get("/customers-by-location", { params: { date_from: prevRange.date_from, date_to: prevRange.date_to, channel } }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] })],
      ["topSkus", api.get("/top-skus", { params: { ...dateP, limit: 200 } }).catch(() => ({ data: [] }))],
      // Identified-customer retention metrics (excludes walk-ins). Replaces
      // the upstream /customer-frequency repeat-rate which over-counts
      // anonymous foot traffic. Slow first call (~30 s) then cached 10 min.
      ["retention", api.get("/analytics/customer-retention", { params: { date_from: dateFrom, date_to: dateTo } }).catch(() => ({ data: null }))],
      ["spendByType", api.get("/analytics/avg-spend-by-customer-type", { params: { date_from: dateFrom, date_to: dateTo } }).catch(() => ({ data: null }))],
    ];
    const setters = {
      top: setTop, freq: setFreq, byLoc: setByLoc, churned: setChurned,
      np: setNewProducts, cw: setCrosswalk, prev: setCustPrev, freqPrev: setFreqPrev,
      topPrev: setTopPrev, byLocPrev: setByLocPrev, topSkus: setTopSkus,
      retention: setRetention, spendByType: setSpendByType,
    };
    for (const [key, p] of rest) {
      p.then((r) => { if (!cancelled) setters[key](r.data || (key === "prev" ? null : [])); });
    }

    // Churn rate is computed in a separate endpoint because its upstream
    // dependency (/churned-customers?limit=100000) is slow & flaky. Fetch
    // it in parallel and merge into the existing cust state when ready —
    // the churn KPI tile renders a spinner via churn_source === "computing"
    // until this resolves.
    api.get("/customers/churn-rate", { params: { date_from: dateFrom, date_to: dateTo } })
      .then((r) => {
        if (cancelled || !r.data) return;
        setCust((prev) => prev ? { ...prev, ...r.data, churned_last_90d: r.data.churned_customers } : prev);
      })
      .catch(() => {
        if (cancelled) return;
        setCust((prev) => prev ? { ...prev, churn_source: "upstream_down" } : prev);
      });

    // Walk-ins (anonymous transactions) — also slow on cold cache because
    // it fans /orders out per ≤30-day chunk. Fetch in parallel; tile shows
    // "computing…" until ready. Compare-period payload only fetched when
    // the user has chosen a comparison.
    setWalkIns(null);
    setWalkInsPrev(null);
    setWalkInsLoading(true);
    api.get("/customers/walk-ins", { params: dateP })
      .then((r) => { if (!cancelled) setWalkIns(r.data || null); })
      .catch(() => { if (!cancelled) setWalkIns({ _error: true }); })
      .finally(() => { if (!cancelled) setWalkInsLoading(false); });
    if (prevRange) {
      api.get("/customers/walk-ins", { params: { ...prevRange, country, channel } })
        .then((r) => { if (!cancelled) setWalkInsPrev(r.data || null); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode, dataVersion, churnDays, topN]);

  // Recently-unchurned table — re-fetches whenever the slider days change,
  // independent of the main page fetch since it can be slow (10-min cache).
  useEffect(() => {
    let cancelled = false;
    setUnchurnedLoading(true);
    api.get("/analytics/recently-unchurned", {
      params: { date_from: dateFrom, date_to: dateTo, min_gap_days: unchurnedDays },
      timeout: 120000,
    })
      .then((r) => { if (!cancelled) setUnchurned(r.data || []); })
      .catch(() => { if (!cancelled) setUnchurned([]); })
      .finally(() => { if (!cancelled) setUnchurnedLoading(false); });
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, unchurnedDays, dataVersion]);

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
                <SectionTitle title="Top products bought" subtitle="Ranked by units purchased by this customer — use to personalise next-visit recommendations and reactivation offers." />
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
            <div
              className="card-accent p-3.5 sm:p-5"
              data-testid="kpi-total"
              title="Total Customers in period = New + Returning + Walk-ins. Walk-ins are anonymous orders (no customer profile) — added so the headline reflects every shopper, not just identified ones."
            >
              <div className="flex items-center gap-2">
                <Users size={16} />
                <div className="eyebrow text-white/80">Total Customers (in period)</div>
                <span title="New + Returning + Walk-ins. Walk-ins are guest checkouts with no customer profile attached." className="text-white/60 text-[10px] cursor-help">ⓘ</span>
              </div>
              {(() => {
                const newC = cust.new_customers || 0;
                const retC = (cust.returning_customers || 0) + (cust.repeat_customers || 0);
                const wiC = walkIns?.walk_in_orders || 0;
                const totalC = newC + retC + wiC;
                const prevNewC = custPrev?.new_customers || 0;
                const prevRetC = (custPrev?.returning_customers || 0) + (custPrev?.repeat_customers || 0);
                const prevWiC = walkInsPrev?.walk_in_orders || 0;
                const prevTotalC = prevNewC + prevRetC + prevWiC;
                return (
                  <>
                    <div className="mt-2 text-[22px] sm:text-[28px] font-extrabold num leading-tight">
                      {fmtNum(totalC)}
                    </div>
                    <div className="mt-1 text-[10.5px] text-white/85 leading-snug">
                      {fmtNum(newC)} new · {fmtNum(retC)} returning · {fmtNum(wiC)} walk-in
                    </div>
                    {compareLbl && prevTotalC > 0 && (
                      <div className="mt-1"><Delta curr={totalC} prev={prevTotalC} /></div>
                    )}
                  </>
                );
              })()}
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
                    <button
                      type="button"
                      onClick={() => {
                        // Jump to Top 20 filtered to "New"; user can then bulk-action.
                        setTopSegment("new");
                        const el = document.querySelector('[data-testid="top-customers-section"]');
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      data-testid="kpi-new-action"
                      className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-brand/10 hover:bg-brand/20 border border-brand/30 text-brand-deep hover:border-brand/60 transition-all"
                    >
                      See who's new <ArrowRight size={11} weight="bold" />
                    </button>
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
                    <button
                      type="button"
                      onClick={() => {
                        setTopSegment("vip");
                        const el = document.querySelector('[data-testid="top-customers-section"]');
                        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      data-testid="kpi-return-action"
                      className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-brand/10 hover:bg-brand/20 border border-brand/30 text-brand-deep hover:border-brand/60 transition-all"
                    >
                      See VIPs <ArrowRight size={11} weight="bold" />
                    </button>
                  </div>
                </>
              );
            })()}
            <KPICard testId="kpi-avg-spend" label="Avg Spend" value={fmtKES(cust.avg_customer_spend)} icon={Coins} showDelta={false}
              action={{ label: "Top 20 customers", onClick: () => {
                const el = document.querySelector('[data-testid="top-customers-section"]');
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}}
            />
            {(() => {
              // Hide churn tiles when the selected period is shorter than the
              // churn cutoff. Mathematically a customer cannot both "purchase
              // in this window" AND "have been silent for ≥ churnDays" when
              // the window itself is < churnDays wide — the tile will always
              // read 0 and mislead. Surface an honest reframe instead.
              const windowDays = (dateFrom && dateTo)
                ? Math.max(1, Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1)
                : 0;
              const churnMeaningful = windowDays >= churnDays;
              if (!churnMeaningful) {
                return (
                  <div
                    className="rounded-2xl border border-border bg-panel p-3 sm:p-4 min-h-[110px] flex flex-col justify-between"
                    data-testid="churn-not-applicable"
                    title={`Selected window is ${windowDays} days — shorter than the ${churnDays}-day churn cutoff. Churn becomes meaningful at 90+ day windows or historical periods.`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="eyebrow">Churn watchlist</div>
                      <span className="text-muted text-[10px]">ⓘ</span>
                    </div>
                    <div className="mt-2">
                      <div className="text-[13px] font-bold text-brand-deep leading-tight">
                        N/A for {windowDays}-day window
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 leading-snug">
                        Churn needs ≥ {churnDays}-day window. Open{" "}
                        <span className="font-semibold text-brand">Reactivation Opportunity</span>{" "}
                        below to see at-risk customers.
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <>
                  <KPICard
                    testId="kpi-churned-count"
                    label="Churned Customers"
                    sub={cust.churn_source === "computing" ? "computing…" : `no purchase in ${churnDays}+ days`}
                    formula={`Count of customers whose LAST purchase was more than ${churnDays} days ago (as of today). Source: /churned-customers?days=${churnDays}.`}
                    value={cust.churn_source === "computing" ? "…" : fmtNum(cust.churned_last_90d || cust.churned_customers || 0)}
                    icon={UserMinus}
                    higherIsBetter={false}
                    showDelta={false}
                  />
                  <KPICard
                    testId="kpi-churn"
                    label="Churn Rate"
                    sub={cust.churn_source === "computing" ? "computing…" : "in selected period · 90-day cutoff"}
                    formula={
                      `Churn Rate = churned_in_period ÷ total_customers × 100.\n\n` +
                      `A customer is counted as CHURNED if their last purchase falls INSIDE the ` +
                      `selected date range AND they have not bought anything in the ` +
                      `${churnDays} days up to today. For an in-progress period (ends today) ` +
                      `this number is naturally near-zero; for historical periods it rises.`
                    }
                    value={cust.churn_source === "computing" ? "…" : fmtPct(cust.churn_rate, 2)}
                    icon={UserMinus}
                    higherIsBetter={false}
                    showDelta={false}
                  />
                </>
              );
            })()}
            {/* ---- Walk-ins (anonymous transactions) ---- */}
            <div
              className="card-white p-3.5 sm:p-5"
              data-testid="kpi-walk-ins"
              title="Walk-ins = orders with no customer profile attached (Guest checkout / no phone or email captured at POS). Use this as a coaching signal — every walk-in is a missed opportunity to capture a contact for re-engagement."
            >
              <div className="flex items-center gap-2">
                <UserCircle size={16} className="text-brand" />
                <div className="eyebrow">Walk-ins</div>
                <span title="Anonymous orders. Detected when customer_type = Guest OR customer_id is missing. Slow upstream — uses /api/customers/walk-ins (chunked /orders fan-out)." className="text-muted text-[10px] cursor-help">ⓘ</span>
              </div>
              {walkInsLoading || !walkIns ? (
                <div className="mt-2 text-[18px] sm:text-[24px] font-bold num leading-tight text-muted">…</div>
              ) : walkIns._error ? (
                <div className="mt-2 text-[12px] text-danger">Upstream unavailable</div>
              ) : (
                <>
                  <div className="mt-2 text-[18px] sm:text-[24px] font-bold num leading-tight">
                    {fmtNum(walkIns.walk_in_orders)}
                    <span className="text-[13px] text-muted font-semibold ml-1">
                      ({(walkIns.walk_in_share_orders_pct || 0).toFixed(2)}%)
                    </span>
                  </div>
                  <div className="text-[10.5px] text-muted mt-0.5 leading-snug">
                    {fmtKES(walkIns.walk_in_sales_kes)} · {(walkIns.walk_in_share_sales_pct || 0).toFixed(2)}% of sales
                  </div>
                  {compareLbl && walkInsPrev && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Delta curr={walkIns.walk_in_orders} prev={walkInsPrev.walk_in_orders} invert />
                      <span className="text-[10px] text-muted">{compareLbl}</span>
                    </div>
                  )}
                  {walkIns.truncated && (
                    <div className="mt-1 text-[10px] text-amber-600" title="Upstream /orders capped at 50k rows per chunk; numbers may be slightly under-reported in this period.">
                      ⚠ partial sample
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.querySelector('[data-testid="walk-ins-by-country-card"]');
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    data-testid="kpi-walk-ins-action"
                    className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-brand/10 hover:bg-brand/20 border border-brand/30 text-brand-deep hover:border-brand/60 transition-all"
                  >
                    By country <ArrowRight size={11} weight="bold" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ---- Walk-ins by country breakdown ---- */}
          {walkIns && !walkIns._error && (walkIns.by_country || []).length > 0 && (
            <div className="card-white p-5" data-testid="walk-ins-by-country-card">
              <SectionTitle
                title="Walk-ins · by country"
                subtitle={
                  `Anonymous orders (no customer profile) per country. Detection: ${walkIns.detection_rule}. ` +
                  `Use this to coach store teams on contact capture — every walk-in is a missed re-engagement opportunity.` +
                  (walkIns.truncated ? " ⚠ Period exceeds upstream sample cap; counts may be slightly under-reported." : "")
                }
              />
              <SortableTable
                testId="walk-ins-by-country"
                exportName="walk-ins-by-country.csv"
                initialSort={{ key: "walk_in_orders", dir: "desc" }}
                columns={[
                  { key: "country", label: "Country", align: "left" },
                  { key: "walk_in_orders", label: "Walk-in Orders", numeric: true,
                    render: (r) => fmtNum(r.walk_in_orders), csv: (r) => r.walk_in_orders },
                  { key: "total_orders", label: "Total Orders", numeric: true,
                    render: (r) => fmtNum(r.total_orders), csv: (r) => r.total_orders },
                  { key: "walk_in_share_orders_pct", label: "% of Orders", numeric: true,
                    render: (r) => `${(r.walk_in_share_orders_pct || 0).toFixed(2)}%`,
                    csv: (r) => r.walk_in_share_orders_pct?.toFixed(2) },
                  { key: "walk_in_sales", label: "Walk-in Sales", numeric: true,
                    render: (r) => <span className="text-brand font-bold">{fmtKES(r.walk_in_sales)}</span>,
                    csv: (r) => r.walk_in_sales },
                  { key: "walk_in_share_sales_pct", label: "% of Sales", numeric: true,
                    render: (r) => `${(r.walk_in_share_sales_pct || 0).toFixed(2)}%`,
                    csv: (r) => r.walk_in_share_sales_pct?.toFixed(2) },
                  { key: "walk_in_avg_basket_kes", label: "Avg Basket", numeric: true,
                    render: (r) => fmtKES(r.walk_in_avg_basket_kes),
                    csv: (r) => r.walk_in_avg_basket_kes },
                ]}
                rows={walkIns.by_country}
              />
              <p className="text-[11px] text-muted italic mt-2">
                Group total: {fmtNum(walkIns.walk_in_orders)} walk-in orders / {fmtKES(walkIns.walk_in_sales_kes)} ·
                {" "}{(walkIns.walk_in_share_orders_pct || 0).toFixed(2)}% of all orders ·
                {" "}{(walkIns.walk_in_share_sales_pct || 0).toFixed(2)}% of revenue.
              </p>
            </div>
          )}

          {/* ---- Walk-in capture · by store (full leaderboard) ---- */}
          {walkIns && !walkIns._error && (walkIns.by_location || []).length > 0 && (
            <div className="card-white p-5" data-testid="walk-ins-by-store-card">
              <SectionTitle
                title="Walk-in capture · by store"
                subtitle={
                  `Capture rate = (1 − walk-in share). Higher is better — every captured contact unlocks re-engagement (SMS, email, loyalty). ` +
                  `Group capture: ${walkIns.total_orders ? (100 - walkIns.walk_in_share_orders_pct).toFixed(2) : "100.00"}% (${fmtNum(walkIns.walk_in_orders)} walk-ins of ${fmtNum(walkIns.total_orders)} orders). ` +
                  `Click any column header to sort — start with the worst capture rates and coach those store teams first.`
                }
              />
              <SortableTable
                testId="walk-ins-by-store"
                exportName="walk-ins-by-store.csv"
                pageSize={20}
                initialSort={{ key: "capture_rate_pct", dir: "asc" }}
                columns={[
                  { key: "channel", label: "Store", align: "left",
                    render: (r) => <span className="font-medium">{r.channel}</span> },
                  { key: "country", label: "Country", align: "left",
                    render: (r) => <span className="text-muted text-[11.5px]">{r.country || "—"}</span> },
                  { key: "walk_in_orders", label: "Walk-ins", numeric: true,
                    render: (r) => fmtNum(r.walk_in_orders), csv: (r) => r.walk_in_orders },
                  { key: "total_orders", label: "Total Orders", numeric: true,
                    render: (r) => fmtNum(r.total_orders), csv: (r) => r.total_orders },
                  { key: "walk_in_share_orders_pct", label: "Walk-in %", numeric: true,
                    render: (r) => `${(r.walk_in_share_orders_pct || 0).toFixed(2)}%`,
                    csv: (r) => r.walk_in_share_orders_pct?.toFixed(2) },
                  { key: "capture_rate_pct", label: "Capture %", numeric: true,
                    render: (r) => {
                      const v = r.capture_rate_pct;
                      if (v == null) return <span className="text-muted">—</span>;
                      const cls = v >= 98 ? "pill-green" : v >= 95 ? "pill-amber" : "pill-red";
                      return <span className={`${cls} num`}>{v.toFixed(2)}%</span>;
                    },
                    csv: (r) => r.capture_rate_pct?.toFixed(2) },
                  { key: "walk_in_sales", label: "Walk-in Sales", numeric: true,
                    render: (r) => fmtKES(r.walk_in_sales || 0),
                    csv: (r) => r.walk_in_sales },
                ]}
                rows={walkIns.by_location}
              />
              <p className="text-[11px] text-muted italic mt-2">
                Pill colors: <span className="pill-green">≥98%</span>{" "}
                <span className="pill-amber">95–98%</span>{" "}
                <span className="pill-red">&lt;95%</span> ·{" "}
                Sort ascending on Capture % to surface the stores that need coaching first.
              </p>
            </div>
          )}

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
                        <div className="font-extrabold text-[18px] num mt-0.5" data-testid="kpi-repeat-rate-value">
                          {(retention?.repeat_rate_pct ?? repeatRate).toFixed(1)}%
                        </div>
                        <div className="text-[10.5px] text-muted mt-0.5" title="Walk-ins (no customer_id) excluded so the rate reflects only identifiable customers who can actually repeat-purchase.">
                          {retention
                            ? `${fmtNum(retention.repeat_customers)} of ${fmtNum(retention.total_customers)} identified · walk-ins excluded`
                            : "computing identified-only rate…"}
                        </div>
                        {hasCompare && (
                          <div className={`text-[11px] font-semibold mt-0.5 ${repeatRateDelta >= 0 ? "text-brand" : "text-danger"}`}>
                            {repeatRateDelta >= 0 ? "▲" : "▼"} {Math.abs(repeatRateDelta).toFixed(1)}pp {compareLbl}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-border p-3" data-testid="kpi-orders-per-returning">
                        <div className="eyebrow">Avg Orders / Returning Customer</div>
                        <div className="font-extrabold text-[18px] num mt-0.5">
                          {(retention?.avg_orders_per_returner ?? avgOrdersPerReturning).toFixed(2)}
                        </div>
                        <div className="text-[11px] text-muted mt-0.5">customers with ≥2 orders</div>
                      </div>
                      <div className="rounded-xl border border-border p-3" data-testid="kpi-vip-count">
                        <div className="eyebrow">VIP (5+ orders)</div>
                        <div className="font-extrabold text-[18px] num mt-0.5">
                          {fmtNum(retention?.vip_customers ?? (data[4]?.count || 0))}
                        </div>
                        <div className="text-[11px] text-muted mt-0.5">
                          {(retention?.total_customers || curTotal) ? (((retention?.vip_customers ?? (data[4]?.count || 0)) / (retention?.total_customers || curTotal)) * 100).toFixed(1) : "0.0"}% of base
                        </div>
                      </div>
                    </div>

                    {/* ---- Avg spend per customer split (New vs Returning) ---- */}
                    {spendByType && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4" data-testid="spend-by-type">
                        <div className="rounded-xl border border-emerald-300 bg-emerald-50/40 p-3">
                          <div className="flex items-center justify-between">
                            <div className="eyebrow text-emerald-800">New customers</div>
                            <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full">
                              {fmtNum(spendByType.new.customers)} customers
                            </span>
                          </div>
                          <div className="font-extrabold text-[20px] num mt-1 text-emerald-900" data-testid="kpi-spend-new">
                            {fmtKES(spendByType.new.avg_spend_per_customer_kes)}
                          </div>
                          <div className="text-[11px] text-muted mt-0.5">
                            avg spend · {spendByType.new.avg_orders_per_customer.toFixed(2)} orders / cust
                            · {fmtKES(spendByType.new.total_spend_kes)} total
                          </div>
                        </div>
                        <div className="rounded-xl border border-blue-300 bg-blue-50/40 p-3">
                          <div className="flex items-center justify-between">
                            <div className="eyebrow text-blue-800">Returning customers</div>
                            <span className="text-[10px] font-bold uppercase bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-full">
                              {fmtNum(spendByType.returning.customers)} customers
                            </span>
                          </div>
                          <div className="font-extrabold text-[20px] num mt-1 text-blue-900" data-testid="kpi-spend-returning">
                            {fmtKES(spendByType.returning.avg_spend_per_customer_kes)}
                          </div>
                          <div className="text-[11px] text-muted mt-0.5">
                            avg spend · {spendByType.returning.avg_orders_per_customer.toFixed(2)} orders / cust
                            · {fmtKES(spendByType.returning.total_spend_kes)} total
                          </div>
                        </div>
                      </div>
                    )}

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

          {/* ---- Top N Customers (enhanced) ---- */}
          {(() => {
            // Decorate rows with derived fields (segment, days_since, rank,
            // rank_delta, is_new_to_top, profile_completeness).
            const prevRankMap = new Map((topPrev || []).map((r, i) => [r.customer_id, i + 1]));
            const decorated = (top || []).map((r, i) => {
              const rank = i + 1;
              const seg = segmentFor(r.total_orders);
              const daysLast = daysSince(r.last_purchase_date);
              const isAnonymous = !r.customer_name && !r.phone;
              const completeness =
                isAnonymous ? "walk_in"
                  : !r.customer_name || !r.phone || !r.city ? "partial"
                  : "complete";
              const prevRank = prevRankMap.get(r.customer_id) || null;
              const rankDelta = prevRank ? prevRank - rank : null; // +ve = moved up
              const isNewToTop = compareMode !== "none" && topPrev.length > 0 && !prevRankMap.has(r.customer_id);
              return { ...r, rank, seg, daysLast, completeness, prevRank, rankDelta, isNewToTop };
            });

            // Segment-filter chip
            const filtered = decorated.filter((r) => {
              if (topSegment === "all") return true;
              if (topSegment === "lapsing") return (r.daysLast || 0) > 60;
              return r.seg.key === topSegment;
            });

            // Summary insight — pct of total_sales comes from shared KPIs.
            const sumTopSales = decorated.reduce((s, r) => s + (r.total_sales || 0), 0);
            const totalSales = kpis?.total_sales || 0;
            const pctOfTotal = totalSales ? (sumTopSales / totalSales) * 100 : 0;
            const repeatCount = decorated.filter((r) => (r.total_orders || 0) >= 2).length;
            const repeatRateTop = decorated.length ? (repeatCount / decorated.length) * 100 : 0;
            const avgSpend = decorated.length ? sumTopSales / decorated.length : 0;

            // CSV filename reflects filter state
            const slug = (s) => (s || "all").replace(/[^\w]+/g, "-").toLowerCase();
            const csvCountry = countries.length === 1 ? slug(countries[0]) : countries.length ? `${countries.length}-countries` : "all-countries";
            const csvChannel = channels.length ? `${channels.length}-pos` : "all-pos";
            const csvDate = new Date().toISOString().slice(0, 10);
            const csvFilename = `top-${topN}-customers_${csvCountry}_${csvChannel}_${csvDate}.csv`;

            const SEG_CHIPS = [
              ["all", "All"],
              ["vip", "VIP (5+ orders)"],
              ["loyal", "Loyal (3–4)"],
              ["emerging", "Emerging (2)"],
              ["new", "New (1)"],
              ["lapsing", "Lapsing (60+ days)"],
            ];
            const TOP_N_OPTIONS = [10, 20, 50, 100];

            return (
              <div className="card-white p-5" data-testid="top-customers-section">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <SectionTitle
                    title={`Top ${topN} Customers`}
                    subtitle="Ranked by total sales in the selected window. Click a name to open the full profile."
                  />
                  <button
                    type="button"
                    onClick={() => setShowCustomerId((v) => !v)}
                    data-testid="toggle-customer-id"
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-border hover:border-brand/40 hover:bg-brand-soft/50 bg-white"
                  >
                    {showCustomerId ? "Hide Customer ID" : "Show Customer ID"}
                  </button>
                </div>

                {/* ---- Insight bar ---- */}
                {decorated.length > 0 && (
                  <div
                    className="rounded-xl bg-brand-soft/40 border border-brand/30 text-brand-deep p-3 text-[12.5px] my-3"
                    data-testid="top-insight"
                  >
                    <strong>
                      Top {decorated.length} customers contributed {fmtKES(sumTopSales)}
                      {totalSales > 0 ? ` — ${pctOfTotal.toFixed(1)}% of total sales.` : "."}
                    </strong>{" "}
                    Repeat rate among top {decorated.length}: {repeatRateTop.toFixed(0)}%. Avg spend: {fmtKES(avgSpend)}.
                  </div>
                )}

                {/* ---- Top-N selector + segment chips ---- */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-[11px] text-muted uppercase tracking-wider">Top:</span>
                  {TOP_N_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setTopN(n)}
                      data-testid={`top-n-${n}`}
                      className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold transition-colors border ${
                        topN === n
                          ? "bg-brand text-white border-brand"
                          : "bg-white text-foreground/70 border-border hover:border-brand/40"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <span className="mx-2 h-5 border-l border-border" />
                  <span className="text-[11px] text-muted uppercase tracking-wider">Segment:</span>
                  {SEG_CHIPS.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTopSegment(k)}
                      data-testid={`seg-chip-${k}`}
                      className={`px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition-colors border ${
                        topSegment === k
                          ? "bg-brand-deep text-white border-brand-deep"
                          : "bg-white text-foreground/70 border-border hover:border-brand/40"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {decorated.length === 0 ? <UpstreamNotReady /> : filtered.length === 0 ? (
                  <Empty label={`No customers match "${SEG_CHIPS.find(([k]) => k === topSegment)?.[1] || topSegment}" in the Top ${topN}.`} />
                ) : (
                  <SortableTable
                    testId="top-customers"
                    exportName={csvFilename}
                    initialSort={{ key: "total_sales", dir: "desc" }}
                    columns={[
                      {
                        key: "rank", label: "#", align: "left", sortable: false,
                        render: (r) => (
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="text-muted num font-semibold">{r.rank}</span>
                            {r.isNewToTop && (
                              <span title={`New entrant this period`} className="pill-green !px-1 !py-0 text-[9px]" data-testid="top-new-entrant">🆕</span>
                            )}
                            {r.rankDelta != null && r.rankDelta !== 0 && (
                              <span
                                title={`${r.rankDelta > 0 ? "Moved up" : "Moved down"} ${Math.abs(r.rankDelta)} place${Math.abs(r.rankDelta) === 1 ? "" : "s"} vs comparison period`}
                                className={`text-[10px] font-bold ${r.rankDelta > 0 ? "text-brand" : "text-danger"}`}
                              >
                                {r.rankDelta > 0 ? "▲" : "▼"}{Math.abs(r.rankDelta)}
                              </span>
                            )}
                          </div>
                        ),
                        csv: (r) => r.rank,
                      },
                      ...(showCustomerId ? [{
                        key: "customer_id", label: "Customer ID", align: "left",
                        render: (r) => <span className="text-muted num text-[11px]">{r.customer_id || "—"}</span>,
                        csv: (r) => r.customer_id,
                      }] : []),
                      {
                        key: "customer_name", label: "Name", align: "left",
                        render: (r) => (
                          r.completeness === "walk_in" ? (
                            <span className="pill-amber" title="Anonymous / walk-in sale — customer profile not captured in Odoo">Walk-in / Unregistered</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openCustomer(r)}
                              data-testid="top-customer-name"
                              title="Open full customer profile"
                              className="font-medium text-brand-deep hover:text-brand underline-offset-2 hover:underline break-words max-w-[200px] inline-block text-left"
                            >
                              {r.customer_name || "—"}
                            </button>
                          )
                        ),
                        csv: (r) => r.customer_name || (r.completeness === "walk_in" ? "Walk-in / Unregistered" : ""),
                      },
                      {
                        key: "segment", label: "Segment", align: "left",
                        sortValue: (r) => ({ vip: 4, loyal: 3, emerging: 2, new: 1, unknown: 0 }[r.seg.key] || 0),
                        render: (r) => <span className={r.seg.cls}>{r.seg.icon} {r.seg.label}</span>,
                        csv: (r) => r.seg.label,
                      },
                      {
                        key: "phone", label: "Phone", align: "left",
                        render: (r) => {
                          if (!r.phone) return <span className="text-muted">—</span>;
                          const href = telHref(r.phone);
                          const masked = maskPhone(r.phone);
                          return href
                            ? <a href={href} className="text-brand-deep hover:text-brand inline-flex items-center gap-1" title="Click to dial"><Phone size={11} weight="bold" />{masked}</a>
                            : <span className="text-muted">{masked}</span>;
                        },
                        csv: (r) => maskPhone(r.phone),
                      },
                      { key: "city", label: "City", align: "left", render: (r) => r.city || <span className="text-muted">—</span>, csv: (r) => r.city || "" },
                      { key: "total_orders", label: "Orders", numeric: true, render: (r) => fmtNum(r.total_orders) },
                      { key: "total_units", label: "Units", numeric: true, render: (r) => fmtNum(r.total_units) },
                      {
                        key: "total_sales", label: "Total Sales", numeric: true,
                        render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>,
                        csv: (r) => r.total_sales,
                      },
                      {
                        key: "avg_basket", label: "Avg Basket", numeric: true,
                        // For 1-order customers avg_basket = total_sales which is redundant;
                        // show a muted dash with hover tip.
                        render: (r) => (r.total_orders || 0) >= 2
                          ? fmtKES(r.avg_basket)
                          : <span className="text-muted" title="Single-order customer — basket equals total sales">—</span>,
                        csv: (r) => r.avg_basket,
                      },
                      {
                        key: "first_purchase_date", label: "Customer Since",
                        render: (r) => fmtDate(r.first_purchase_date) || "—",
                        csv: (r) => r.first_purchase_date || "",
                      },
                      {
                        key: "last_purchase_date", label: "Last Purchase",
                        render: (r) => fmtDate(r.last_purchase_date) || "—",
                        csv: (r) => r.last_purchase_date || "",
                      },
                      {
                        key: "days_since_last_purchase", label: "Days Since", numeric: true,
                        sortValue: (r) => r.daysLast ?? -1,
                        render: (r) => {
                          if (r.daysLast == null) return <span className="text-muted">—</span>;
                          const cls = r.daysLast > 180 ? "pill-red" : r.daysLast > 60 ? "pill-amber" : "pill-green";
                          return <span className={cls}>{fmtNum(r.daysLast)}d</span>;
                        },
                        csv: (r) => r.daysLast ?? "",
                      },
                      {
                        key: "profile_completeness", label: "Profile", align: "left",
                        sortValue: (r) => ({ complete: 2, partial: 1, walk_in: 0 }[r.completeness] || 0),
                        render: (r) => {
                          if (r.completeness === "complete") return <span className="pill-green text-[10px]" title="Name, phone and city on file">✅</span>;
                          if (r.completeness === "partial") return <span className="pill-amber text-[10px]" title="Some contact fields missing (name / phone / city)">⚠️</span>;
                          return <span className="pill-neutral text-[10px]" title="Anonymous / walk-in">—</span>;
                        },
                        csv: (r) => r.completeness,
                      },
                      {
                        key: "actions", label: "", align: "left", sortable: false,
                        render: (r) => {
                          const href = telHref(r.phone);
                          return (
                            <div className="inline-flex items-center gap-1.5" data-testid="top-actions">
                              {href ? (
                                <a href={href} className="p-1 rounded hover:bg-panel" title="Call / dial"><Phone size={13} /></a>
                              ) : (
                                <span className="p-1 text-muted/40" title="No phone on file"><Phone size={13} /></span>
                              )}
                              <button
                                type="button"
                                onClick={() => openCustomer(r)}
                                disabled={r.completeness === "walk_in"}
                                title={r.completeness === "walk_in" ? "No profile for walk-in sale" : "View full profile"}
                                className="p-1 rounded hover:bg-panel disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Eye size={13} />
                              </button>
                            </div>
                          );
                        },
                        csv: () => "",
                      },
                    ]}
                    rows={filtered}
                  />
                )}
                <p className="text-[11px] text-muted italic mt-2">
                  <Trophy size={11} className="inline mr-1" weight="bold" />
                  Email and margin contribution columns are deferred — upstream Vivo BI API does not yet expose <code>res.partner.email</code> or per-customer margin. Favorite category per customer is available on profile drill-down.
                </p>
              </div>
            );
          })()}

          {/* ---- Recently Unchurned (customers returning after a long silence) ---- */}
          <div className="card-white p-5" data-testid="recently-unchurned-section">
            <SectionTitle
              title="Recently Unchurned Customers"
              subtitle={`Customers whose latest visit happened in the selected window AND came after a silence of ${unchurnedDays}+ days. These shoppers JUST proved they still respond — perfect targets for win-back nudges, loyalty re-onboarding, or a personalised email/SMS within the next 7 days.`}
            />
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className="eyebrow">Min silence gap</span>
              <div className="inline-flex rounded-md overflow-hidden border border-border" data-testid="unchurned-days-toggle">
                {[30, 60, 90, 180].map((d) => (
                  <button
                    key={d}
                    onClick={() => setUnchurnedDays(d)}
                    data-testid={`unchurned-days-${d}`}
                    className={`text-[11px] font-bold px-3 py-1.5 transition-colors ${unchurnedDays === d ? "bg-[#1a5c38] text-white" : "bg-white text-[#1a5c38] hover:bg-[#fef3e0]"}`}
                  >
                    {d} days
                  </button>
                ))}
              </div>
              {unchurnedLoading && <span className="text-[11px] text-muted">computing…</span>}
              {!unchurnedLoading && unchurned && (
                <span className="text-[11px] text-muted" data-testid="unchurned-count">
                  {fmtNum(unchurned.length)} customer{unchurned.length === 1 ? "" : "s"} found
                </span>
              )}
            </div>
            {unchurnedLoading && <Loading label={`scanning last ${unchurnedDays + 30} days of orders…`} />}
            {!unchurnedLoading && unchurned && unchurned.length === 0 && (
              <UpstreamNotReady label={`No customers came back from a ${unchurnedDays}+ day silence in this window.`} />
            )}
            {!unchurnedLoading && unchurned && unchurned.length > 0 && (
              <SortableTable
                testId="unchurned-table"
                exportName={`recently-unchurned_${unchurnedDays}d.csv`}
                pageSize={20}
                initialSort={{ key: "gap_days", dir: "desc" }}
                columns={[
                  { key: "customer_name", label: "Customer", align: "left",
                    render: (r) => (
                      <div>
                        <div className="font-semibold">{r.customer_name || `Customer #${r.customer_id?.slice?.(-6) || "—"}`}</div>
                        {r.customer_email && <div className="text-[10.5px] text-muted">{r.customer_email}</div>}
                        {!r.customer_email && r.customer_id && (
                          <div className="text-[10.5px] text-muted font-mono">{r.customer_id}</div>
                        )}
                      </div>
                    ),
                    csv: (r) => r.customer_name || r.customer_id },
                  { key: "gap_days", label: "Silence (days)", numeric: true,
                    render: (r) => (
                      <span className={
                        r.gap_days >= 180 ? "pill-red" :
                        r.gap_days >= 90 ? "pill-amber" :
                        "pill-green"
                      }>
                        {r.gap_days}
                      </span>
                    ),
                    csv: (r) => r.gap_days },
                  { key: "prev_order_date", label: "Previous Visit", align: "left" },
                  { key: "last_order_date", label: "Latest Visit", align: "left",
                    render: (r) => <span className="font-bold text-brand">{r.last_order_date}</span> },
                  { key: "total_orders_window", label: "Orders (window)", numeric: true,
                    render: (r) => fmtNum(r.total_orders_window) },
                  { key: "total_spend_kes_window", label: "Spend (window)", numeric: true,
                    render: (r) => <span className="font-bold">{fmtKES(r.total_spend_kes_window)}</span>,
                    csv: (r) => r.total_spend_kes_window },
                ]}
                rows={unchurned}
              />
            )}
          </div>

          {/* ---- Store cross-shop (customer-crosswalk) ---- */}
          {(() => {
            const CROSSWALK_MIN_SHARED = 5;
            const significantCrosswalk = (crosswalk || []).filter(
              (r) => (r.shared_customers || 0) >= CROSSWALK_MIN_SHARED
            );
            const hiddenCount = (crosswalk?.length || 0) - significantCrosswalk.length;
            return (
              <div className="card-white p-5" data-testid="customer-crosswalk-section">
                <SectionTitle
                  title="Stores sharing customers"
                  subtitle="Which POS locations share the same shoppers. Pairs with high overlap indicate customers who shop both stores — fertile ground for cross-promotion, shared loyalty events, and joint stock planning."
                />
                {significantCrosswalk.length === 0 ? (
                  <UpstreamNotReady
                    label={
                      (crosswalk?.length || 0) > 0
                        ? `No store pairs share ≥${CROSSWALK_MIN_SHARED} customers in the selected window — overlap below statistical significance.`
                        : "No cross-shop overlap detected in the selected window."
                    }
                  />
                ) : (
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
                    rows={significantCrosswalk}
                  />
                )}
                <p className="text-[11px] text-muted italic mt-2" data-testid="crosswalk-threshold-note">
                  Showing pairs with ≥{CROSSWALK_MIN_SHARED} shared customers to filter out statistical noise
                  {hiddenCount > 0 ? <> — <span className="font-semibold">{fmtNum(hiddenCount)}</span> low-overlap pair{hiddenCount === 1 ? "" : "s"} hidden</> : null}.
                  Overlap is computed from each store's top-50 customer list — approximation (upstream doesn't expose per-customer store history yet).
                </p>
              </div>
            );
          })()}

          {/* ---- Customer Acquisition & Retention by Location ---- */}
          {(() => {
            // Index previous period by pos_location for delta lookups.
            const prevMap = new Map((byLocPrev || []).map((r) => [r.pos_location, r]));
            const hasCompare = compareLbl && byLocPrev && byLocPrev.length > 0;
            const rows = byLocWithPct.map((r) => {
              const p = prevMap.get(r.pos_location);
              const prevTotal = p?.total_customers || 0;
              const prevNew = p?.new_customers || 0;
              const prevRet = p?.returning_customers || 0;
              const prevPctRet = prevTotal ? (prevRet / prevTotal) * 100 : 0;
              const pctRetDelta = (r.pct_returning || 0) - prevPctRet; // pp shift
              const totalPctChange = prevTotal ? ((r.total_customers || 0) - prevTotal) / prevTotal * 100 : null;
              const newPctChange = prevNew ? ((r.new_customers || 0) - prevNew) / prevNew * 100 : null;
              const retPctChange = prevRet ? ((r.returning_customers || 0) - prevRet) / prevRet * 100 : null;

              // Action tag logic — first-match wins.
              let tag = null;
              if (hasCompare && totalPctChange != null && totalPctChange < -20 && pctRetDelta < 0) {
                tag = { label: "🔴 At Risk", cls: "pill-red", tip: "Total customers declining >20% AND returning-share weakening." };
              } else if (hasCompare && pctRetDelta < -5) {
                tag = { label: "⚠️ Retention Weakening", cls: "pill-amber", tip: "% Returning dropped >5pp vs comparison period." };
              } else if ((r.pct_new || 0) > 30) {
                tag = { label: "🆕 Acquisition Engine", cls: "pill-neutral", tip: "Acquiring new customers heavily (>30% of mix)." };
              } else if ((r.pct_returning || 0) > 85 && (totalPctChange == null || totalPctChange >= 0)) {
                tag = { label: "💚 Retention Strong", cls: "pill-green", tip: "Over 85% returning mix, customer base stable or growing." };
              } else {
                tag = { label: "🌟 Balanced", cls: "pill-neutral", tip: "Healthy, balanced mix." };
              }

              return {
                ...r,
                prevTotal, prevNew, prevRet, prevPctRet,
                pctRetDelta, totalPctChange, newPctChange, retPctChange, tag,
              };
            });

            // Summary insight bar
            const leader = [...rows].sort((a, b) => (b.total_customers || 0) - (a.total_customers || 0))[0];
            const declining = rows.filter((r) => (r.totalPctChange || 0) < 0).length;
            const weakening = rows.filter((r) => r.tag.label.startsWith("⚠️") || r.tag.label.startsWith("🔴")).length;
            const insight = rows.length > 0
              ? `${leader?.pos_location || "—"} leads customer volume (${(leader?.pct_of_total || 0).toFixed(1)}% share).${
                  hasCompare ? ` ${Math.round(declining / rows.length * 100)}% of locations saw customer count decline ${compareLbl}.` : ""
                }${weakening > 0 ? ` ${weakening} location${weakening === 1 ? "" : "s"} flagged for retention risk.` : ""}`
              : null;

            const COUNTRY_FLAG = { Kenya: "🇰🇪", Uganda: "🇺🇬", Rwanda: "🇷🇼", Online: "🌐" };
            const isOnline = (r) => (r.country === "Online") || String(r.pos_location || "").toLowerCase().startsWith("online");

            // CSV filename reflects filter state
            const slug = (s) => (s || "all").replace(/[^\w]+/g, "-").toLowerCase();
            const csvCountry = countries.length === 1 ? slug(countries[0]) : countries.length ? `${countries.length}-countries` : "all-countries";
            const csvChannel = channels.length ? `${channels.length}-pos` : "all-pos";
            const csvDate = new Date().toISOString().slice(0, 10);
            const csvFilename = `customers-by-location_${csvCountry}_${csvChannel}_${csvDate}.csv`;

            return (
              <div className="card-white p-5" data-testid="customers-by-location-section">
                <SectionTitle
                  title="Customer Acquisition & Retention by Location"
                  subtitle="New vs returning customer mix at each location. Use to identify acquisition-heavy vs retention-strong stores and surface locations that need attention."
                />

                {insight && (
                  <div className="rounded-xl bg-brand-soft/40 border border-brand/30 text-brand-deep p-3 text-[12.5px] mb-3" data-testid="byloc-insight">
                    <strong>{insight}</strong>
                  </div>
                )}

                {rows.length === 0 ? <UpstreamNotReady /> : (
                  <SortableTable
                    testId="customers-by-location"
                    exportName={csvFilename}
                    initialSort={{ key: "total_customers", dir: "desc" }}
                    columns={[
                      {
                        key: "pos_location", label: "POS Location", align: "left",
                        render: (r) => (
                          <div className="flex items-center gap-1.5">
                            {isOnline(r) && <span title="Online channel" className="text-[11px]">🌐</span>}
                            <span className="font-medium">{r.pos_location}</span>
                          </div>
                        ),
                      },
                      {
                        key: "tag", label: "Signal", align: "left",
                        sortValue: (r) => ({ "🔴 At Risk": 5, "⚠️ Retention Weakening": 4, "🆕 Acquisition Engine": 3, "💚 Retention Strong": 2, "🌟 Balanced": 1 }[r.tag.label] || 0),
                        render: (r) => <span className={r.tag.cls} title={r.tag.tip}>{r.tag.label}</span>,
                        csv: (r) => r.tag.label.replace(/[^\w\s]/g, "").trim(),
                      },
                      {
                        key: "country", label: "Country", align: "left",
                        render: (r) => <span title={r.country}>{COUNTRY_FLAG[r.country] || r.country}</span>,
                        csv: (r) => r.country,
                      },
                      {
                        key: "new_customers", label: "New", numeric: true,
                        render: (r) => (
                          <div className="inline-flex flex-col items-end">
                            <span className="num font-semibold">{fmtNum(r.new_customers)} <span className="text-[10px] text-muted">({(r.pct_new || 0).toFixed(1)}%)</span></span>
                            {hasCompare && r.newPctChange != null && (
                              <span className={`text-[10px] font-semibold ${r.newPctChange >= 0 ? "text-brand" : "text-danger"}`}>
                                {r.newPctChange >= 0 ? "▲" : "▼"} {Math.abs(r.newPctChange).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        ),
                      },
                      {
                        key: "returning_customers", label: "Returning", numeric: true,
                        render: (r) => (
                          <div className="inline-flex flex-col items-end">
                            <span className="num font-semibold">{fmtNum(r.returning_customers)} <span className="text-[10px] text-muted">({(r.pct_returning || 0).toFixed(1)}%)</span></span>
                            {hasCompare && r.retPctChange != null && (
                              <span className={`text-[10px] font-semibold ${r.retPctChange >= 0 ? "text-brand" : "text-danger"}`}>
                                {r.retPctChange >= 0 ? "▲" : "▼"} {Math.abs(r.retPctChange).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        ),
                      },
                      {
                        key: "pct_returning_delta", label: "% Ret Shift", numeric: true,
                        sortValue: (r) => r.pctRetDelta || 0,
                        render: (r) => hasCompare
                          ? <span className={`text-[11px] font-semibold ${r.pctRetDelta >= 0 ? "text-brand" : "text-danger"}`}>
                              {r.pctRetDelta >= 0 ? "+" : ""}{r.pctRetDelta.toFixed(1)}pp
                            </span>
                          : <span className="text-muted">—</span>,
                        csv: (r) => hasCompare ? r.pctRetDelta.toFixed(2) : "",
                      },
                      {
                        key: "total_customers", label: "Total", numeric: true,
                        render: (r) => (
                          <div className="inline-flex flex-col items-end">
                            <span className="font-semibold num">{fmtNum(r.total_customers)}</span>
                            {hasCompare && r.totalPctChange != null && (
                              <span className={`text-[10px] font-semibold ${r.totalPctChange >= 0 ? "text-brand" : "text-danger"}`}>
                                {r.totalPctChange >= 0 ? "▲" : "▼"} {Math.abs(r.totalPctChange).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        ),
                      },
                      {
                        key: "pct_of_total", label: "% Share of Customers", numeric: true,
                        render: (r) => <span title="This location's share of the total customer base across all selected stores.">{fmtPct(r.pct_of_total, 1)}</span>,
                        csv: (r) => r.pct_of_total?.toFixed(2),
                      },
                    ]}
                    rows={rows}
                  />
                )}
                <p className="text-[11px] text-muted italic mt-2">
                  Revenue and Revenue / Customer columns deferred — upstream <code>/customers-by-location</code> does not yet expose per-location revenue aggregates. Location drill-down pattern available on the Locations page.
                </p>
              </div>
            );
          })()}

          {/* ---- Reactivation Opportunity (redesigned churned customers) ---- */}
          {(() => {
            // Priority scorer — combines LTV, orders, recency, contact.
            // Score logic:
            //   contact valid (phone present) required for Hot/Warm
            //   Hot   = LTV ≥ 50k AND orders ≥ 5 AND days ≤ 60 AND has contact
            //   Warm  = (LTV ≥ 10k OR orders ≥ 3) AND days ≤ 120 AND has contact
            //   Cold  = everything else (missing contact auto-cold regardless of LTV)
            // These thresholds are tuned for Vivo KES spend; adjust as needed.
            const priorityFor = (r) => {
              const ltv = r.lifetime_spend || 0;
              const orders = r.total_orders || 0;
              const days = r.days_since_last_purchase || 0;
              const hasContact = Boolean(r.phone);
              if (!hasContact) return { key: "cold", label: "❄️ Cold", cls: "pill-neutral", rank: 1, tip: "No contact on file — cannot run automated reactivation. Consider completing profile at next in-store visit." };
              if (ltv >= 50000 && orders >= 5 && days <= 60) return { key: "hot", label: "🔥 Hot", cls: "pill-red", rank: 4, tip: "High LTV + frequent + recent churn → immediate personal outreach." };
              if ((ltv >= 10000 || orders >= 3) && days <= 120) return { key: "warm", label: "🌡️ Warm", cls: "pill-amber", rank: 3, tip: "Meaningful value + still recent → automated win-back campaign with offer." };
              return { key: "cold", label: "❄️ Cold", cls: "pill-neutral", rank: 1, tip: "Low value or very old churn → bulk low-cost campaign or deprioritize." };
            };

            const decorated = (churned || []).map((r) => {
              const priority = priorityFor(r);
              const orders = r.total_orders || 0;
              const ltv = r.lifetime_spend || 0;
              const aov = orders ? ltv / orders : 0;
              const hasContact = Boolean(r.phone);
              return { ...r, priority, aov, hasContact };
            });

            // Apply client-side filter chip
            const filtered = decorated.filter((r) => {
              const days = r.days_since_last_purchase || 0;
              if (reactivationChip === "all") return true;
              if (reactivationChip === "hot") return r.priority.key === "hot";
              if (reactivationChip === "ex_vip") return (r.total_orders || 0) >= 5;
              if (reactivationChip === "high_spender") return (r.lifetime_spend || 0) >= 100000;
              if (reactivationChip === "recent") return days <= 60;
              if (reactivationChip === "long") return days > 180;
              if (reactivationChip === "contactable") return r.hasContact;
              return true;
            });

            // Revenue-at-risk summary
            const revAtRisk = decorated.reduce((s, r) => s + (r.lifetime_spend || 0), 0);
            const top50 = [...decorated].sort((a, b) => (b.lifetime_spend || 0) - (a.lifetime_spend || 0)).slice(0, 50);
            const top50Rev = top50.reduce((s, r) => s + (r.lifetime_spend || 0), 0);
            const top50Pct = revAtRisk ? (top50Rev / revAtRisk) * 100 : 0;
            const recentChurn = decorated.filter((r) => (r.days_since_last_purchase || 0) <= 30).length;

            const CHIPS = [
              ["all", `All (${decorated.length})`],
              ["hot", `🔥 Hot (${decorated.filter((r) => r.priority.key === "hot").length})`],
              ["ex_vip", `Ex-VIP (${decorated.filter((r) => (r.total_orders || 0) >= 5).length})`],
              ["high_spender", `High spenders (${decorated.filter((r) => (r.lifetime_spend || 0) >= 100000).length})`],
              ["recent", `Recent 30–60d (${decorated.filter((r) => (r.days_since_last_purchase || 0) <= 60).length})`],
              ["long", `Long >180d (${decorated.filter((r) => (r.days_since_last_purchase || 0) > 180).length})`],
              ["contactable", `Contactable (${decorated.filter((r) => r.hasContact).length})`],
            ];

            const slug = (s) => (s || "all").replace(/[^\w]+/g, "-").toLowerCase();
            const csvCountry = countries.length === 1 ? slug(countries[0]) : countries.length ? `${countries.length}-countries` : "all-countries";
            const csvChipLabel = reactivationChip === "all" ? "" : `_${reactivationChip}`;
            const csvDate = new Date().toISOString().slice(0, 10);
            const csvFilename = `reactivation-list_${csvCountry}_${churnDays}d-churn${csvChipLabel}_${csvDate}.csv`;

            return (
              <div className="card-white p-5 border-l-4 border-danger" data-testid="churned-customers-section">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <SectionTitle
                    title={`Reactivation Opportunity · ${fmtNum(decorated.length)}${decorated.length >= 500 ? "+" : ""} Churned Customers`}
                    subtitle={`Customers with no purchase in the last ${churnDays} days. Prioritized by reactivation value — target high-LTV / high-frequency / recent-churn segments first for win-back campaigns.`}
                    action={
                      <div className="inline-flex items-center gap-1.5 text-[11.5px]" data-testid="churn-days-filter">
                        <span className="text-muted font-medium">Churn window:</span>
                        {[60, 90, 120, 180].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setChurnDays(d)}
                            data-testid={`churn-days-${d}`}
                            className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${
                              churnDays === d ? "bg-brand text-white" : "bg-panel text-foreground/70 hover:bg-white border border-border"
                            }`}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                    }
                  />
                </div>

                {/* ---- Revenue-at-risk summary ---- */}
                {decorated.length > 0 && (
                  <div className="rounded-xl bg-red-50 border border-red-200 text-red-900 p-3.5 text-[12.5px] my-3" data-testid="revenue-at-risk">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span>📉 <strong>Revenue at Risk:</strong> <span className="num font-bold">{fmtKES(revAtRisk)}</span> in historical LTV from {fmtNum(decorated.length)}{decorated.length >= 500 ? "+" : ""} churned customers.</span>
                    </div>
                    <div className="flex items-start gap-2 mt-1">
                      <span>🎯 <strong>Top 50:</strong> {fmtKES(top50Rev)} ({top50Pct.toFixed(0)}% of churn LTV) — prioritize for personal outreach.</span>
                    </div>
                    <div className="flex items-start gap-2 mt-1">
                      <span>⏰ <strong>Recent (≤30d):</strong> {fmtNum(recentChurn)} customers — highest reactivation probability.</span>
                    </div>
                  </div>
                )}

                {/* ---- Filter chips ---- */}
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  {CHIPS.map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setReactivationChip(k)}
                      data-testid={`reactivation-chip-${k}`}
                      className={`px-2.5 py-1 rounded-lg text-[11.5px] font-medium border transition-colors ${
                        reactivationChip === k
                          ? "bg-brand-deep text-white border-brand-deep"
                          : "bg-white text-foreground/70 border-border hover:border-brand/40"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {decorated.length === 0 ? (
                  <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-[12.5px] text-amber-900">
                    ⚠️ Upstream <code>/churned-customers?days={churnDays}</code> returned no rows. The aggregated count ({fmtNum(cust.churned_last_90d || cust.churned_customers || 0)}) from <code>/customers</code> is used for the KPI above.
                  </div>
                ) : filtered.length === 0 ? (
                  <Empty label={`No churned customers match "${CHIPS.find(([k]) => k === reactivationChip)?.[1] || reactivationChip}".`} />
                ) : (
                  <SortableTable
                    testId="churned-customers"
                    exportName={csvFilename}
                    initialSort={{ key: "priority", dir: "desc" }}
                    pageSize={25}
                    columns={[
                      {
                        key: "priority", label: "Priority", align: "left",
                        sortValue: (r) => r.priority.rank,
                        render: (r) => <span className={r.priority.cls} title={r.priority.tip}>{r.priority.label}</span>,
                        csv: (r) => r.priority.label.replace(/[^\w\s]/g, "").trim(),
                      },
                      {
                        key: "customer_name", label: "Name", align: "left",
                        render: (r) => {
                          if (!r.customer_name) return <span className="pill-amber" title="Anonymous / walk-in sale">Walk-in / Unregistered</span>;
                          return (
                            <button
                              type="button"
                              onClick={() => openCustomer(r)}
                              title="Open full customer profile"
                              className="font-medium text-brand-deep hover:text-brand hover:underline underline-offset-2 break-words max-w-[220px] inline-block text-left"
                            >
                              {r.customer_name}
                              {!r.hasContact && <span title="Missing contact — cannot run automated outreach" className="ml-1">⚠️</span>}
                            </button>
                          );
                        },
                        csv: (r) => r.customer_name || "Walk-in",
                      },
                      {
                        key: "phone", label: "Contact", align: "left",
                        render: (r) => {
                          if (!r.phone) return <span className="text-muted" title="No contact on file">— ⚠️</span>;
                          const href = telHref(r.phone);
                          const masked = maskPhone(r.phone);
                          return href
                            ? <a href={href} className="text-brand-deep hover:text-brand inline-flex items-center gap-1" title="Click to dial"><Phone size={11} weight="bold" />{masked}</a>
                            : <span className="text-muted">{masked}</span>;
                        },
                        csv: (r) => maskPhone(r.phone),
                      },
                      { key: "last_purchase_date", label: "Last Purchase", render: (r) => fmtDate(r.last_purchase_date) || "—" },
                      {
                        key: "days_since_last_purchase", label: "Days Since", numeric: true,
                        render: (r) => <span className={(r.days_since_last_purchase || 0) > 180 ? "pill-red" : "pill-amber"}>{fmtNum(r.days_since_last_purchase)}d</span>,
                        csv: (r) => r.days_since_last_purchase,
                      },
                      { key: "total_orders", label: "Orders", numeric: true, render: (r) => fmtNum(r.total_orders) },
                      {
                        key: "lifetime_spend", label: "LTV", numeric: true,
                        render: (r) => <span className="text-brand font-bold">{fmtKES(r.lifetime_spend)}</span>,
                        csv: (r) => r.lifetime_spend,
                      },
                      {
                        key: "aov", label: "Avg Order Value", numeric: true,
                        render: (r) => fmtKES(r.aov),
                        csv: (r) => r.aov?.toFixed(0),
                      },
                      {
                        key: "actions", label: "", align: "left", sortable: false,
                        render: (r) => {
                          const href = telHref(r.phone);
                          return (
                            <div className="inline-flex items-center gap-1.5">
                              {href ? (
                                <a href={href} className="p-1 rounded hover:bg-panel" title="Call for win-back"><Phone size={13} /></a>
                              ) : (
                                <span className="p-1 text-muted/40" title="No phone"><Phone size={13} /></span>
                              )}
                              <button
                                type="button"
                                onClick={() => openCustomer(r)}
                                title="View profile"
                                className="p-1 rounded hover:bg-panel"
                              >
                                <Eye size={13} />
                              </button>
                            </div>
                          );
                        },
                        csv: () => "",
                      },
                    ]}
                    rows={filtered}
                  />
                )}
                <p className="text-[11px] text-muted italic mt-2">
                  Email, favourite category/location per customer, bulk-campaign assignment and outreach tracking deferred — upstream Vivo BI API does not currently expose these. Use Export CSV to push this list into your CRM workflow.
                </p>
              </div>
            );
          })()}

          {/* ---- Product Mix: New vs Returning (redesigned new-customer products) ---- */}
          {(() => {
            // Cross-reference /new-customer-products against /top-skus to
            // compute Acquisition Skew for each style.
            //
            //   Acquisition Skew = (% of New-Cust Sales) ÷ (% of Total Sales)
            //
            // Match keys are normalized style names (case/whitespace-insensitive).
            const norm = (s) => String(s || "").trim().toLowerCase();
            const totalSalesAllSkus = (topSkus || []).reduce((s, r) => s + (r.total_sales || 0), 0);
            const skuMap = new Map();
            for (const r of topSkus || []) {
              const k = norm(r.style_name);
              if (!k) continue;
              // If dupes (different SKUs under same style), aggregate.
              const prev = skuMap.get(k) || { units: 0, sales: 0 };
              skuMap.set(k, {
                units: prev.units + (r.units_sold || 0),
                sales: prev.sales + (r.total_sales || 0),
                current_stock: (prev.current_stock || 0) + (r.current_stock || 0),
              });
            }

            const confidenceFor = (u) => {
              if ((u || 0) >= 10) return { key: "hi", label: "✅", tip: "High confidence — ≥10 units sold." };
              if ((u || 0) >= 3) return { key: "lo", label: "⚠️", tip: "Low confidence — 3–9 units, directional only." };
              return { key: "none", label: "❓", tip: "Insufficient data — <3 units. Exclude from decision-making." };
            };

            const decorated = (newProducts || []).map((r) => {
              const k = norm(r.style_name);
              const total = skuMap.get(k) || { units: 0, sales: 0, current_stock: 0 };
              const pctNewSales = r.pct_of_new_customer_sales || 0; // already percent of new-cust sales
              const pctTotalSales = totalSalesAllSkus ? (total.sales / totalSalesAllSkus) * 100 : 0;
              const skew = pctTotalSales > 0 ? pctNewSales / pctTotalSales : null;
              const totalUnits = total.units || 0;
              const confidence = confidenceFor(r.units_sold);

              let signal = { label: "—", cls: "pill-neutral", key: "unknown", tip: "" };
              if (skew != null) {
                if (skew > 1.2) signal = { label: "🆕 Acquisition driver", cls: "pill-neutral", key: "acq", tip: "Disproportionately acquires new customers. Feature in new-customer campaigns." };
                else if (skew >= 0.8) signal = { label: "⚖️ Balanced", cls: "pill-neutral", key: "bal", tip: "Balanced appeal — popular with both new and returning customers." };
                else signal = { label: "💚 Retention driver", cls: "pill-green", key: "ret", tip: "Skews toward returning customers. Protect stock for loyalty campaigns." };
              }
              return {
                ...r,
                total_units: totalUnits,
                pct_total_sales: pctTotalSales,
                skew,
                confidence,
                signal,
                current_stock: total.current_stock || 0,
              };
            });

            // Insight
            const acqDrivers = decorated.filter((r) => r.signal.key === "acq" && r.confidence.key !== "none").length;
            const totalHighConf = decorated.filter((r) => r.confidence.key !== "none").length;
            const topAcqCategory = (() => {
              const byCat = new Map();
              for (const r of decorated.filter((r) => r.signal.key === "acq")) {
                const k = r.subcategory || "—";
                byCat.set(k, (byCat.get(k) || 0) + (r.units_sold || 0));
              }
              let best = null, bv = 0;
              for (const [k, v] of byCat) if (v > bv) { best = k; bv = v; }
              return best;
            })();
            const insight = decorated.length === 0
              ? null
              : `${acqDrivers} style${acqDrivers === 1 ? "" : "s"} identified as acquisition drivers (skew > 1.2×)${
                  topAcqCategory ? `. Top acquisition category: ${topAcqCategory}` : ""
                }. ${totalHighConf} of ${decorated.length} rows meet the ≥3-unit confidence floor.`;

            const slug = (s) => (s || "all").replace(/[^\w]+/g, "-").toLowerCase();
            const csvCountry = countries.length === 1 ? slug(countries[0]) : countries.length ? `${countries.length}-countries` : "all-countries";
            const csvDate = new Date().toISOString().slice(0, 10);
            const csvFilename = `product-mix-new-vs-returning_${csvCountry}_${csvDate}.csv`;

            return (
              <div className="card-white p-5" data-testid="new-customer-products-section">
                <SectionTitle
                  title="Product Mix: New vs Returning Customers"
                  subtitle="Identify styles that acquire new customers vs styles that drive repeat purchase. Skew > 1.2× = acquisition driver; < 0.8× = retention driver; in-between = balanced. Recommended lookback: 30+ days for meaningful signal."
                />
                {insight && (
                  <div className="rounded-xl bg-brand-soft/40 border border-brand/30 text-brand-deep p-3 text-[12.5px] mb-3" data-testid="newcust-insight">
                    <strong>{insight}</strong>
                  </div>
                )}
                {decorated.length === 0 ? <UpstreamNotReady /> : (
                  <SortableTable
                    testId="new-customer-products"
                    exportName={csvFilename}
                    initialSort={{ key: "skew", dir: "desc" }}
                    columns={[
                      {
                        key: "style_name", label: "Style", align: "left",
                        render: (r) => <span className="font-medium break-words max-w-[260px] inline-block">{r.style_name}</span>,
                      },
                      {
                        key: "signal", label: "Signal", align: "left",
                        sortValue: (r) => ({ acq: 3, bal: 2, ret: 1, unknown: 0 }[r.signal.key] || 0),
                        render: (r) => <span className={r.signal.cls} title={r.signal.tip}>{r.signal.label}</span>,
                        csv: (r) => r.signal.label.replace(/[^\w\s]/g, "").trim(),
                      },
                      {
                        key: "skew", label: "Acq Skew", numeric: true,
                        sortValue: (r) => r.skew ?? -1,
                        render: (r) => r.skew == null
                          ? <span className="text-muted">—</span>
                          : <span className={r.skew > 1.2 ? "pill-neutral font-bold" : r.skew < 0.8 ? "pill-green" : "pill-neutral"}>
                              {r.skew.toFixed(2)}×
                            </span>,
                        csv: (r) => r.skew?.toFixed(3),
                      },
                      { key: "subcategory", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.subcategory || "—"}</span> },
                      { key: "brand", label: "Brand", align: "left", render: (r) => <span className="pill-neutral">{r.brand || "—"}</span>, csv: (r) => r.brand },
                      {
                        key: "units_sold", label: "Units (New)", numeric: true,
                        render: (r) => fmtNum(r.units_sold),
                      },
                      {
                        key: "total_units", label: "Units (Total)", numeric: true,
                        render: (r) => <span className="text-muted num">{fmtNum(r.total_units)}</span>,
                        csv: (r) => r.total_units,
                      },
                      {
                        key: "total_sales", label: "Sales (New)", numeric: true,
                        render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>,
                        csv: (r) => r.total_sales,
                      },
                      {
                        key: "pct_of_new_customer_sales", label: "% of New-Cust Sales", numeric: true,
                        render: (r) => fmtPct(r.pct_of_new_customer_sales, 2),
                        csv: (r) => r.pct_of_new_customer_sales?.toFixed(2),
                      },
                      {
                        key: "pct_total_sales", label: "% of Total Sales", numeric: true,
                        render: (r) => <span className="text-muted">{(r.pct_total_sales || 0).toFixed(2)}%</span>,
                        csv: (r) => r.pct_total_sales?.toFixed(2),
                      },
                      {
                        key: "current_stock", label: "Current Stock", numeric: true,
                        render: (r) => r.current_stock
                          ? <span className={r.current_stock < 10 ? "pill-red" : r.current_stock < 30 ? "pill-amber" : "pill-green"}>{fmtNum(r.current_stock)}</span>
                          : <span className="text-muted">—</span>,
                        csv: (r) => r.current_stock,
                      },
                      {
                        key: "confidence", label: "Conf.", align: "left",
                        sortValue: (r) => ({ hi: 3, lo: 2, none: 1 }[r.confidence.key] || 0),
                        render: (r) => <span title={r.confidence.tip} className="text-[13px]">{r.confidence.label}</span>,
                        csv: (r) => r.confidence.key,
                      },
                    ]}
                    rows={decorated}
                  />
                )}
                <p className="text-[11px] text-muted italic mt-2">
                  SKU-level color/size mix available via the Style drill-down on the Products page. Cross-references to Inventory / Re-Order / Pricing dashboards, and a paired "What Returning Customers Bought" view deferred — pending upstream per-style new-vs-returning breakdown.
                </p>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
};

export default Customers;
