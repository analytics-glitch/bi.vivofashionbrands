import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { useKpis } from "@/lib/useKpis";
import { api, fmtKES, fmtNum, fmtDelta, fmtPct, buildParams, pctDelta, comparePeriod, COUNTRY_FLAGS } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { InlineDelta } from "@/components/ChartHelpers";
import SortableTable from "@/components/SortableTable";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { useLocationBadges, LocationLeaderboard, useLeaderboardStreaks } from "@/components/LocationLeaderboard";
import { Storefront, X, CaretLeft, ArrowsDownUp } from "@phosphor-icons/react";

const Locations = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode, dataVersion } = applied;
  const filters = { dateFrom, dateTo, countries, channels };

  // Shared KPI state — guarantees Total Sales/Orders/Units match Overview & CEO Report.
  const { kpis: rawKpis, prevKpis: rawKpisPrev, loading: kpisLoading, error: kpisError } = useKpis({ compare: true });

  const [rows, setRows] = useState([]);
  const [prevRows, setPrevRows] = useState([]);
  const [footfall, setFootfall] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("total_sales");
  const [selected, setSelected] = useState(null);
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [selectedLoading, setSelectedLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = buildParams(filters);
    const prev = comparePeriod(dateFrom, dateTo, compareMode);
    const prevP = prev
      ? buildParams({ ...filters, dateFrom: prev.date_from, dateTo: prev.date_to })
      : null;

    Promise.all([
      api.get("/sales-summary", { params: p }),
      prevP
        ? api.get("/sales-summary", { params: prevP })
        : Promise.resolve({ data: [] }),
      api.get("/footfall", { params: { date_from: dateFrom, date_to: dateTo } }),
    ])
      .then(([s, ps, ff]) => {
        if (cancelled) return;
        setRows(s.data || []);
        setPrevRows(ps.data || []);
        setFootfall(ff.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode, dataVersion]);

  useEffect(() => {
    if (!selected) return;
    setSelectedLoading(true);
    api
      .get("/top-skus", {
        params: { date_from: dateFrom, date_to: dateTo, channel: selected, limit: 10 },
      })
      .then((r) => setSelectedSkus(r.data || []))
      .catch(() => setSelectedSkus([]))
      .finally(() => setSelectedLoading(false));
  }, [selected, dateFrom, dateTo]);

  const prevMap = useMemo(() => {
    const m = new Map();
    for (const r of prevRows) m.set(r.channel, r);
    return m;
  }, [prevRows]);

  const kpis = rawKpis;

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const prev = prevMap.get(r.channel);
      const sales = r.total_sales || 0;
      const orders = r.orders || r.total_orders || 0;
      const units = r.units_sold || r.total_units_sold || 0;
      const returns = r.returns || 0;
      const basket = orders ? sales / orders : (r.avg_basket_size || 0);
      const asp = units ? sales / units : 0;
      const msi = orders ? units / orders : 0;

      // Previous-period numbers
      const pSales = prev ? (prev.total_sales || 0) : null;
      const pOrders = prev ? (prev.orders || prev.total_orders || 0) : null;
      const pUnits = prev ? (prev.units_sold || prev.total_units_sold || 0) : null;
      const pReturns = prev ? (prev.returns || 0) : null;
      const pAbv = pOrders ? pSales / pOrders : null;
      const pAsp = pUnits ? pSales / pUnits : null;
      const pMsi = pOrders ? pUnits / pOrders : null;

      return {
        ...r,
        total_sales: sales,
        orders,
        units_sold: units,
        returns,
        avg_basket: basket,
        abv: basket,
        asp,
        msi,
        // Legacy headline delta (kept for SortableTable row)
        delta: prev ? pctDelta(sales, pSales) : null,
        // Per-metric deltas (null when no prev data / prev is 0)
        d_sales: prev ? pctDelta(sales, pSales) : null,
        d_orders: prev ? pctDelta(orders, pOrders) : null,
        d_units: prev ? pctDelta(units, pUnits) : null,
        d_returns: prev ? pctDelta(returns, pReturns) : null,
        d_abv: prev ? pctDelta(basket, pAbv) : null,
        d_asp: prev ? pctDelta(asp, pAsp) : null,
        d_msi: prev ? pctDelta(msi, pMsi) : null,
        // Raw previous-period values (exposed for table display / CSV export)
        prev_abv: pAbv,
        prev_orders: pOrders,
        prev_sales: pSales,
      };
    });
  }, [rows, prevMap]);

  const avg = useMemo(() => {
    if (!enriched.length) return 0;
    return (
      enriched.reduce((s, r) => s + (r.total_sales || 0), 0) / enriched.length
    );
  }, [enriched]);

  const groupTotals = useMemo(() => {
    // Use authoritative API KPIs — never sum per-location rows locally.
    const sales = kpis?.total_sales || 0;
    const orders = kpis?.total_orders || 0;
    const units = kpis?.total_units || 0;
    return {
      abv: orders ? sales / orders : (kpis?.avg_basket_size || 0),
      asp: units ? sales / units : (kpis?.avg_selling_price || 0),
      msi: orders ? units / orders : 0,
    };
  }, [kpis]);

  // Group-level previous-period totals (for KPI delta + prevValue).
  const prevGroupTotals = useMemo(() => {
    if (!rawKpisPrev) return null;
    const sales = rawKpisPrev.total_sales || 0;
    const orders = rawKpisPrev.total_orders || 0;
    const units = rawKpisPrev.total_units || 0;
    return {
      total_sales: sales,
      total_orders: orders,
      total_units: units,
      abv: orders ? sales / orders : (rawKpisPrev.avg_basket_size || 0),
      asp: units ? sales / units : (rawKpisPrev.avg_selling_price || 0),
      msi: orders ? units / orders : 0,
    };
  }, [rawKpisPrev]);

  const compareLbl = compareMode === "yesterday" ? "vs Yesterday" : compareMode === "last_month" ? "vs Last Month" : compareMode === "last_year" ? "vs Last Year" : null;
  const d = (cur, prev) => (cur != null && prev != null) ? pctDelta(cur, prev) : null;

  const sorted = useMemo(() => {
    return [...enriched].sort((a, b) => {
      if (sortKey === "avg_basket" || sortKey === "abv") return (b.abv || 0) - (a.abv || 0);
      if (sortKey === "asp") return (b.asp || 0) - (a.asp || 0);
      if (sortKey === "msi") return (b.msi || 0) - (a.msi || 0);
      return (b[sortKey] || 0) - (a[sortKey] || 0);
    });
  }, [enriched, sortKey]);

  // Shared leaderboard badges (also used on Overview). Extracted into
  // `/app/frontend/src/components/LocationLeaderboard.jsx` so both pages
  // compute identical winners for the same filters. `enriched` already
  // carries `prev_sales` inline — re-shape into the array the hook wants.
  const prevRowsForBadges = useMemo(
    () => enriched.map((r) => ({ channel: r.channel, total_sales: r.prev_sales || 0 })),
    [enriched]
  );
  const leaderBadges = useLocationBadges({
    sales: enriched, prevSales: prevRowsForBadges, footfall,
    compareMode, compareLbl,
  });
  const leaderStreaks = useLeaderboardStreaks();

  return (
    <div className="space-y-6" data-testid="locations-page">
      <div>
        <div className="eyebrow">Dashboard · Locations</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">
          Locations
        </h1>
      </div>

      {(loading || kpisLoading) && <Loading />}
      {(error || kpisError) && <ErrorBox message={error || kpisError} />}

      {!loading && !kpisLoading && !error && kpis && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <KPICard
              testId="loc-kpi-count"
              accent
              label="Total Locations"
              value={fmtNum(enriched.length)}
              showDelta={false}
            />
            <KPICard
              testId="loc-kpi-sales"
              label="Total Sales"
              value={fmtKES(kpis.total_sales)}
              delta={d(kpis.total_sales, prevGroupTotals?.total_sales)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtKES(prevGroupTotals.total_sales) : null}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              testId="loc-kpi-orders"
              label="Total Orders"
              value={fmtNum(kpis.total_orders)}
              delta={d(kpis.total_orders, prevGroupTotals?.total_orders)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtNum(prevGroupTotals.total_orders) : null}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              testId="loc-kpi-units"
              label="Total Units"
              value={fmtNum(kpis.total_units)}
              delta={d(kpis.total_units, prevGroupTotals?.total_units)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtNum(prevGroupTotals.total_units) : null}
              showDelta={compareMode !== "none"}
            />
            <KPICard small testId="loc-kpi-abv" label="ABV" sub="Sales ÷ Orders" value={fmtKES(groupTotals.abv)}
              delta={d(groupTotals.abv, prevGroupTotals?.abv)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtKES(prevGroupTotals.abv) : null}
              showDelta={compareMode !== "none"} />
            <KPICard small testId="loc-kpi-asp" label="ASP" sub="Sales ÷ Units" value={fmtKES(groupTotals.asp)}
              delta={d(groupTotals.asp, prevGroupTotals?.asp)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtKES(prevGroupTotals.asp) : null}
              showDelta={compareMode !== "none"} />
            <KPICard small testId="loc-kpi-msi" label="MSI" sub="Units ÷ Orders" value={groupTotals.msi.toFixed(2)}
              delta={d(groupTotals.msi, prevGroupTotals?.msi)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? prevGroupTotals.msi.toFixed(2) : null}
              showDelta={compareMode !== "none"} />
          </div>

          {!selected && (
            <>
              <div className="card-white p-3 flex items-center gap-2 flex-wrap">
                <ArrowsDownUp size={14} className="text-muted ml-1" />
                <span className="text-[12px] text-muted">Sort by:</span>
                {[
                  ["total_sales", "Total Sales"],
                  ["total_orders", "Orders"],
                  ["units_sold", "Units"],
                  ["abv", "ABV"],
                  ["asp", "ASP"],
                  ["msi", "MSI"],
                ].map(([k, lbl]) => (
                  <button
                    key={k}
                    data-testid={`loc-sort-${k}`}
                    className={`px-2.5 py-1 rounded-lg text-[12px] font-medium ${
                      sortKey === k
                        ? "bg-brand text-white"
                        : "hover:bg-panel text-foreground/70"
                    }`}
                    onClick={() => setSortKey(k)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              {/* Leaderboard strip — celebrates this period's winners. */}
              <LocationLeaderboard
                badges={leaderBadges}
                streaks={leaderStreaks}
                onWinnerClick={setSelected}
                className="mb-3"
              />

              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
                data-testid="locations-grid"
              >
                {sorted.length === 0 && <Empty />}
                {sorted.map((l, i) => {
                  const above = (l.total_sales || 0) >= avg;
                  const badge = leaderBadges.get(l.channel);
                  const borderCls = badge
                    ? "border-amber-400"
                    : above
                    ? "border-brand/40"
                    : "border-red-300";
                  return (
                    <button
                      key={`${l.channel}-${i}`}
                      className={`card-white p-4 hover-lift text-left border-l-4 ${borderCls} relative`}
                      data-testid={`location-card-${l.channel}`}
                      onClick={() => setSelected(l.channel)}
                    >
                      {badge && (
                        <div
                          className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 border border-amber-300 rounded-full text-[10px] font-bold text-amber-900 shadow-sm"
                          data-testid={`card-badge-${badge.label.replace(/\s+/g, "-").toLowerCase()}`}
                          title={badge.tip}
                        >
                          <span aria-hidden="true">{badge.icon}</span>
                          <span>{badge.label}</span>
                        </div>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-brand-soft text-brand grid place-items-center shrink-0">
                            <Storefront size={18} weight="duotone" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-[14px] leading-tight truncate" title={l.channel}>
                              {l.channel}
                            </div>
                            <div className="text-[11.5px] text-muted mt-0.5">
                              {COUNTRY_FLAGS[l.country] || "🌍"} {l.country}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="eyebrow">Sales</div>
                        <div className="font-bold text-[18px] text-brand-deep num mt-0.5">
                          {fmtKES(l.total_sales)}
                        </div>
                        {compareMode !== "none" && (
                          <InlineDelta delta={l.d_sales} testId={`loc-${l.channel}-d-sales`} compact />
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div>
                          <div className="eyebrow">Orders</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {fmtNum(l.orders)}
                          </div>
                          {compareMode !== "none" && (
                            <InlineDelta delta={l.d_orders} testId={`loc-${l.channel}-d-orders`} compact />
                          )}
                        </div>
                        <div>
                          <div className="eyebrow">Units</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {fmtNum(l.units_sold)}
                          </div>
                          {compareMode !== "none" && (
                            <InlineDelta delta={l.d_units} testId={`loc-${l.channel}-d-units`} compact />
                          )}
                        </div>
                        <div>
                          <div className="eyebrow">Returns</div>
                          <div
                            className={`font-semibold text-[13px] num mt-0.5 ${
                              (l.returns || 0) > 0 ? "text-danger" : ""
                            }`}
                          >
                            {fmtKES(l.returns || 0)}
                          </div>
                          {compareMode !== "none" && (
                            // Returns: rising is BAD → higherIsBetter=false
                            <InlineDelta delta={l.d_returns} higherIsBetter={false} testId={`loc-${l.channel}-d-returns`} compact />
                          )}
                        </div>
                        <div>
                          <div className="eyebrow">ABV</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {fmtKES(l.abv)}
                          </div>
                          {compareMode !== "none" && (
                            <InlineDelta delta={l.d_abv} testId={`loc-${l.channel}-d-abv`} compact />
                          )}
                        </div>
                        <div>
                          <div className="eyebrow">ASP</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {fmtKES(l.asp)}
                          </div>
                          {compareMode !== "none" && (
                            <InlineDelta delta={l.d_asp} testId={`loc-${l.channel}-d-asp`} compact />
                          )}
                        </div>
                        <div>
                          <div className="eyebrow">MSI</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {(l.msi || 0).toFixed(2)}
                          </div>
                          {compareMode !== "none" && (
                            <InlineDelta delta={l.d_msi} testId={`loc-${l.channel}-d-msi`} compact />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="card-white p-5" data-testid="abv-by-location">
                <SectionTitle
                  title="Average Basket Value by Location"
                  subtitle={
                    compareMode !== "none"
                      ? `Total Sales ÷ Orders — how valuable each customer transaction is. Sorted by ABV descending. Change vs ${compareMode === "yesterday" ? "yesterday" : compareMode === "last_month" ? "last month" : "last year"}.`
                      : "Total Sales ÷ Orders — how valuable each customer transaction is. Sorted by ABV descending."
                  }
                />
                <SortableTable
                  testId="abv-table"
                  exportName="abv-by-location.csv"
                  initialSort={{ key: "abv", dir: "desc" }}
                  columns={[
                    { key: "rank", label: "#", align: "left", sortable: false, render: (_r, i) => <span className="num text-muted">{i + 1}</span> },
                    {
                      key: "channel",
                      label: "Location",
                      align: "left",
                      render: (r) => (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelected(r.channel); }}
                          className="font-medium text-left hover:text-brand hover:underline decoration-dotted underline-offset-[3px]"
                          data-testid={`abv-row-link-${r.channel}`}
                        >
                          {r.channel}
                        </button>
                      ),
                    },
                    {
                      key: "country",
                      label: "Country",
                      align: "left",
                      render: (r) => <span>{COUNTRY_FLAGS[r.country] || "🌍"} {r.country || "—"}</span>,
                    },
                    {
                      key: "abv",
                      label: "ABV",
                      numeric: true,
                      render: (r) => <span className="font-semibold">{fmtKES(r.abv)}</span>,
                      csv: (r) => Math.round(r.abv || 0),
                    },
                    ...(compareMode !== "none" ? [{
                      key: "prev_abv",
                      label: `ABV ${compareMode === "yesterday" ? "(Yd)" : compareMode === "last_month" ? "(LM)" : "(LY)"}`,
                      numeric: true,
                      render: (r) => (
                        r.prev_abv == null
                          ? <span className="text-muted text-[11px]">n/a</span>
                          : <span className="text-muted">{fmtKES(r.prev_abv)}</span>
                      ),
                      csv: (r) => r.prev_abv == null ? "" : Math.round(r.prev_abv),
                    }] : []),
                    { key: "orders", label: "Orders", numeric: true, render: (r) => fmtNum(r.orders) },
                    {
                      key: "total_sales",
                      label: "Total Sales",
                      numeric: true,
                      render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>,
                      csv: (r) => Math.round(r.total_sales || 0),
                    },
                    ...(compareMode !== "none" ? [{
                      key: "d_abv",
                      label: `Δ ABV ${compareMode === "yesterday" ? "(vs Yd)" : compareMode === "last_month" ? "(vs LM)" : "(vs LY)"}`,
                      numeric: true,
                      sortValue: (r) => r.d_abv == null ? -9999 : r.d_abv,
                      render: (r) => (
                        r.d_abv == null
                          ? <span className="text-muted text-[11px]">n/a</span>
                          : <InlineDelta delta={r.d_abv} compact />
                      ),
                      csv: (r) => r.d_abv == null ? "" : r.d_abv.toFixed(2),
                    }] : []),
                  ]}
                  rows={sorted}
                />
              </div>

              <div className="card-white p-5" data-testid="footfall-section">
                <SectionTitle
                  title="Footfall & Conversion"
                  subtitle="Total Sales match the store grid above (sales-summary). Orders & sales/visitor recomputed from the authoritative totals."
                />
                <div className="overflow-x-auto">
                  <table className="w-full data" data-testid="footfall-table">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th className="text-right">Footfall</th>
                        <th className="text-right">Orders</th>
                        <th className="text-right">Conversion</th>
                        <th className="text-right">Sales / Visitor</th>
                        <th className="text-right">Total Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {footfall.length === 0 && (
                        <tr><td colSpan={6}><Empty label="No footfall data in this period." /></td></tr>
                      )}
                      {[...footfall]
                        .sort((a, b) => (b.total_footfall || 0) - (a.total_footfall || 0))
                        .map((r, i) => {
                          // Authoritative figures from sales-summary (matches the grid).
                          const store = enriched.find((l) => l.channel === r.location);
                          const authoritativeSales = store ? (store.total_sales || 0) : (r.total_sales || 0);
                          const authoritativeOrders = store ? (store.orders || store.total_orders || 0) : (r.orders || 0);
                          const footfallCount = r.total_footfall || 0;
                          const salesPerVisitor = footfallCount ? authoritativeSales / footfallCount : 0;
                          const cr = footfallCount ? (authoritativeOrders / footfallCount) * 100 : 0;
                          const pill = cr > 15 ? "pill-green" : cr >= 10 ? "pill-amber" : "pill-red";
                          return (
                            <tr key={r.location + i}>
                              <td className="font-medium">{r.location}</td>
                              <td className="text-right num">{fmtNum(footfallCount)}</td>
                              <td className="text-right num">{fmtNum(authoritativeOrders)}</td>
                              <td className="text-right"><span className={pill}>{fmtPct(cr)}</span></td>
                              <td className="text-right num">{fmtKES(salesPerVisitor)}</td>
                              <td className="text-right num font-bold">{fmtKES(authoritativeSales)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {selected && (
            <div className="space-y-4" data-testid="location-drill">
              <button
                className="flex items-center gap-1 text-brand font-medium hover:underline text-[13px]"
                onClick={() => setSelected(null)}
                data-testid="drill-back"
              >
                <CaretLeft size={15} /> Back to all locations
              </button>
              <div className="card-white p-5">
                <SectionTitle
                  title={selected}
              subtitle="Top 10 styles at this channel — the best-sellers driving this location's revenue. Protect their stock cover and feature them in local marketing."
                  action={
                    <button
                      onClick={() => setSelected(null)}
                      className="text-muted hover:text-foreground"
                    >
                      <X size={18} />
                    </button>
                  }
                />
                {selectedLoading ? (
                  <Loading />
                ) : selectedSkus.length === 0 ? (
                  <Empty />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full data">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Style</th>
                          <th>Collection</th>
                          <th>Brand</th>
                          <th>Subcategory</th>
                          <th className="text-right">Units</th>
                          <th className="text-right">Total Sales</th>
                          <th className="text-right">Avg Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSkus.map((s, i) => (
                          <tr key={(s.style_name || "") + i}>
                            <td className="text-muted num">{i + 1}</td>
                            <td className="font-medium max-w-[280px] truncate" title={s.style_name}>
                              {s.style_name || "—"}
                            </td>
                            <td className="text-muted">{s.collection || "—"}</td>
                            <td>
                              <span className="pill-neutral">{s.brand || "—"}</span>
                            </td>
                            <td className="text-muted">{s.product_type || "—"}</td>
                            <td className="text-right num font-semibold">{fmtNum(s.units_sold)}</td>
                            <td className="text-right num font-bold text-brand">{fmtKES(s.total_sales)}</td>
                            <td className="text-right num">{fmtKES(s.avg_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Locations;
