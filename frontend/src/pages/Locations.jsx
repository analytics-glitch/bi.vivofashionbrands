import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { useKpis } from "@/lib/useKpis";
import { api, fmtKES, fmtNum, fmtDelta, fmtPct, buildParams, pctDelta, comparePeriod, COUNTRY_FLAGS } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { InlineDelta } from "@/components/ChartHelpers";
import SortableTable from "@/components/SortableTable";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { useLocationBadges, LocationLeaderboard, useLeaderboardStreaks } from "@/components/LocationLeaderboard";
import { useOutliers } from "@/lib/useOutliers";
import { DataQualityPill, DataQualityBanner } from "@/components/DataQualityPill";
import StoreDeepDive from "@/components/StoreDeepDive";
import LocationsAttentionPanel from "@/components/LocationsAttentionPanel";
import MonthlyTargetsTracker from "@/components/MonthlyTargetsTracker";
import { Storefront, ArrowsDownUp, ArrowUpRight } from "@phosphor-icons/react";

const Locations = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode, compareDateFrom, compareDateTo, dataVersion } = applied;
  const filters = { dateFrom, dateTo, countries, channels };

  // Shared KPI state — guarantees Total Sales/Orders/Units match Overview & CEO Report.
  const { kpis: rawKpis, prevKpis: rawKpisPrev, loading: kpisLoading, error: kpisError } = useKpis({ compare: true });

  const [rows, setRows] = useState([]);
  const [prevRows, setPrevRows] = useState([]);
  const [footfall, setFootfall] = useState([]);
  const [prevFootfall, setPrevFootfall] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("total_sales");
  const [selected, setSelected] = useState(null);
  const [weekdayData, setWeekdayData] = useState(null);

  // Weekday pattern feeds the store deep-dive's mini-heatmap.
  // Safe to share across all store drills since the endpoint is 1h-cached.
  useEffect(() => {
    let cancel = false;
    api.get("/footfall/weekday-pattern")
      .then((r) => { if (!cancel) setWeekdayData(r.data || null); })
      .catch(() => { /* optional — deep-dive still renders without it */ });
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = buildParams(filters);
    const prev = comparePeriod(dateFrom, dateTo, compareMode, { date_from: compareDateFrom, date_to: compareDateTo });
    const prevP = prev
      ? buildParams({ ...filters, dateFrom: prev.date_from, dateTo: prev.date_to })
      : null;

    Promise.all([
      api.get("/sales-summary", { params: p }),
      prevP
        ? api.get("/sales-summary", { params: prevP })
        : Promise.resolve({ data: [] }),
      api.get("/footfall", { params: { date_from: dateFrom, date_to: dateTo } }),
      prev
        ? api.get("/footfall", { params: { date_from: prev.date_from, date_to: prev.date_to } }).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
    ])
      .then(([s, ps, ff, pff]) => {
        if (cancelled) return;
        setRows(s.data || []);
        setPrevRows(ps.data || []);
        setFootfall(ff.data || []);
        setPrevFootfall(pff.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode, compareDateFrom, compareDateTo, dataVersion]);

  const prevMap = useMemo(() => {
    const m = new Map();
    for (const r of prevRows) m.set(r.channel, r);
    return m;
  }, [prevRows]);

  // Footfall lookup keyed by location name. The /footfall response uses
  // `location` (the store name displayed at POS), which equals our row's
  // `channel` field for store-level POS. Online channels won't match —
  // they get total_footfall=0 (correct, no walk-in concept).
  const footfallMap = useMemo(() => {
    const m = new Map();
    for (const r of footfall) {
      m.set(r.location, r);
    }
    return m;
  }, [footfall]);

  const prevFootfallMap = useMemo(() => {
    const m = new Map();
    for (const r of prevFootfall) m.set(r.location, r);
    return m;
  }, [prevFootfall]);

  const kpis = rawKpis;

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const prev = prevMap.get(r.channel);
      const ff = footfallMap.get(r.channel);
      const sales = r.total_sales || 0;
      const orders = r.orders || r.total_orders || 0;
      const units = r.units_sold || r.total_units_sold || 0;
      const returns = r.returns || 0;
      const basket = orders ? sales / orders : (r.avg_basket_size || 0);
      const asp = units ? sales / units : 0;
      const msi = orders ? units / orders : 0;

      const ffCount = ff ? (ff.total_footfall || 0) : 0;
      const conv = ffCount ? (orders / ffCount) * 100 : null;
      // Previous conversion = prev orders ÷ prev footfall when both exist.
      // Pull prev footfall from the dedicated /footfall fetch on the prev
      // window (the upstream /footfall endpoint doesn't return previous-
      // period totals inline, so we have to fan out a second call).
      const pFf = prevFootfallMap.get(r.channel);
      const pFfCount = pFf ? (pFf.total_footfall || 0) : 0;
      const pPrevOrders = prev ? (prev.orders || prev.total_orders || 0) : 0;
      const pConv = pFfCount ? (pPrevOrders / pFfCount) * 100 : null;
      const conv_delta_pp = (conv != null && pConv != null) ? +(conv - pConv).toFixed(2) : null;

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
        // Return rate = returns ÷ total_sales (fraction of sales flipped
        // back). Exposed here so the Data-Quality layer can flag stores
        // whose return behaviour sits outside the group norm.
        return_rate: sales > 0 ? (returns / sales) * 100 : 0,
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
        // Footfall + conversion (joined from /footfall response)
        total_footfall: ffCount,
        conversion_rate: conv,
        conv_delta_pp,
      };
    });
  }, [rows, prevMap, footfallMap, prevFootfallMap]);

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

  // Data-quality outlier flagging on return-rate. Physical + online stores
  // whose return rate falls ≥ 2σ above the group mean OR ≥ 30% (structural
  // cap) get a "⚠ verify" chip on their card. Catches the
  // "Vivo Sarit RETURNS ▲ +135.6%" class of anomaly the audit flagged.
  const { enriched: enrichedWithDq, stats: returnStats, count: returnOutlierCount } = useOutliers(
    enriched,
    {
      valueKey: "return_rate",
      filter: (r) => (r.total_sales || 0) >= 100000,  // min 100k KES sample
      hardHi: { at: 30, reason: "Return rate ≥ 30% — suspicious, investigate before using." },
      label: "return rate",
      valueFmt: (v) => `${v.toFixed(1)}%`,
      sigmas: 2,
      outputKey: "return_outlier",
    }
  );

  const sorted = useMemo(() => {
    return [...enrichedWithDq].sort((a, b) => {
      if (sortKey === "avg_basket" || sortKey === "abv") return (b.abv || 0) - (a.abv || 0);
      if (sortKey === "asp") return (b.asp || 0) - (a.asp || 0);
      if (sortKey === "msi") return (b.msi || 0) - (a.msi || 0);
      return (b[sortKey] || 0) - (a[sortKey] || 0);
    });
  }, [enrichedWithDq, sortKey]);

  // Sum of sales across all in-scope locations — used to surface a "% of
  // total" chip on each location card AND to power the bottom-of-page
  // "Locations needing attention" insight panel.
  const totalSalesAll = useMemo(
    () => enrichedWithDq.reduce((s, r) => s + (r.total_sales || 0), 0),
    [enrichedWithDq]
  );

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
        <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(18px,2.2vw,26px)]">
          Locations
        </h1>
      </div>

      {(loading || kpisLoading) && <Loading />}
      {(error || kpisError) && <ErrorBox message={error || kpisError} />}

      {!loading && !kpisLoading && !error && kpis && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard
              testId="loc-kpi-sales"
              accent
              label="Total Sales"
              value={fmtKES(kpis.total_sales)}
              delta={d(kpis.total_sales, prevGroupTotals?.total_sales)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtKES(prevGroupTotals.total_sales) : null}
              showDelta={compareMode !== "none"}
              action={{ label: "Sales breakdown", to: "/overview" }}
            />
            <KPICard
              testId="loc-kpi-orders"
              label="Transactions"
              value={fmtNum(kpis.total_orders)}
              delta={d(kpis.total_orders, prevGroupTotals?.total_orders)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtNum(prevGroupTotals.total_orders) : null}
              showDelta={compareMode !== "none"}
              action={{ label: "Order export", to: "/exports" }}
            />
            <KPICard
              testId="loc-kpi-units"
              label="Total Units"
              value={fmtNum(kpis.total_units)}
              delta={d(kpis.total_units, prevGroupTotals?.total_units)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtNum(prevGroupTotals.total_units) : null}
              showDelta={compareMode !== "none"}
              action={{ label: "Top styles", to: "/products" }}
            />
            <KPICard small testId="loc-kpi-abv" label="ABV" sub="Sales ÷ Orders" value={fmtKES(groupTotals.abv)}
              delta={d(groupTotals.abv, prevGroupTotals?.abv)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtKES(prevGroupTotals.abv) : null}
              showDelta={compareMode !== "none"}
              action={{ label: "Sort by ABV", onClick: () => { setSortKey && setSortKey("abv"); document.querySelector('[data-testid="locations-grid"]')?.scrollIntoView({ behavior: "smooth" }); } }}
            />
            <KPICard small testId="loc-kpi-asp" label="ASP" sub="Sales ÷ Units" value={fmtKES(groupTotals.asp)}
              delta={d(groupTotals.asp, prevGroupTotals?.asp)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? fmtKES(prevGroupTotals.asp) : null}
              showDelta={compareMode !== "none"}
              action={{ label: "Sort by ASP", onClick: () => { setSortKey && setSortKey("asp"); document.querySelector('[data-testid="locations-grid"]')?.scrollIntoView({ behavior: "smooth" }); } }}
            />
            <KPICard small testId="loc-kpi-msi" label="MSI" sub="Units ÷ Orders" value={groupTotals.msi.toFixed(2)}
              delta={d(groupTotals.msi, prevGroupTotals?.msi)}
              deltaLabel={compareLbl}
              prevValue={prevGroupTotals && compareMode !== "none" ? prevGroupTotals.msi.toFixed(2) : null}
              showDelta={compareMode !== "none"}
              action={{ label: "Sort by MSI", onClick: () => { setSortKey && setSortKey("msi"); document.querySelector('[data-testid="locations-grid"]')?.scrollIntoView({ behavior: "smooth" }); } }}
            />
          </div>

          {/* Sort + leaderboard + grid — kept visible behind the deep-dive
              slide-over so users can jump between stores without losing
              context (the drill pattern the audit asked for). */}
          <>
              <div className="card-white p-3 flex items-center gap-2 flex-wrap">
                <ArrowsDownUp size={14} className="text-muted ml-1" />
                <span className="text-[12px] text-muted">Sort by:</span>
                {[
                  ["total_sales", "Total Sales"],
                  ["total_orders", "Orders"],
                  ["units_sold", "Units"],
                  ["total_footfall", "Footfall"],
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

              {/* "Click any card to drill in" hint + legend — communicates
                  the deep-dive interaction AND tells users how to read the
                  blue % chip on each card. */}
              <div
                className="rounded-lg bg-brand-soft/50 border border-brand/20 px-3 py-2 text-[12.5px] text-foreground/75 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5"
                data-testid="locations-deep-dive-hint"
              >
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true">👆</span>
                  <span>
                    <b className="text-brand-deep">Click any card</b> to open the
                    store deep-dive — full KPI history, daily trend, top SKUs and
                    return-rate context.
                  </span>
                </span>
                <span
                  className="inline-flex items-center gap-1.5 text-[11.5px] shrink-0"
                  data-testid="pct-share-legend"
                >
                  <span className="font-bold text-[#1e6ad6]">12.3%</span>
                  <span className="text-muted">= share of total sales across in-scope locations</span>
                </span>
              </div>

              {/* Return-rate data-quality banner — reuses the platform-wide
                  outlier kernel to flag stores whose returns sit outside the
                  group norm (catches the "RETURNS ▲ +135%" anomaly class). */}
              <DataQualityBanner
                count={returnOutlierCount}
                noun="stores"
                statsLine={`return rate outside ±2σ (group avg ${returnStats.mean.toFixed(1)}% ± ${returnStats.sd.toFixed(1)}pp)`}
                action="verify the refund data before trusting the delta."
                testId="returns-dq-banner"
              />

              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
                data-testid="locations-grid"
              >
                {sorted.length === 0 && <Empty />}
                {sorted.map((l, i) => {
                  const above = (l.total_sales || 0) >= avg;
                  const borderCls = above ? "border-brand/40" : "border-red-300";
                  // % share of group total — surfaced inline in the card
                  // header so users see "this store ≈ X% of all sales".
                  const pctShare =
                    totalSalesAll && l.total_sales != null
                      ? (l.total_sales / totalSalesAll) * 100
                      : null;
                  return (
                    <button
                      key={`${l.channel}-${i}`}
                      className={`card-white p-4 hover-lift text-left border-l-4 ${borderCls} relative`}
                      data-testid={`location-card-${l.channel}`}
                      onClick={() => setSelected(l.channel)}
                    >
                      {/* Deep-dive affordance — a subtle ArrowUpRight pinned
                          to the top-right corner of every card so the user
                          knows the card is interactive even before reading
                          the banner above. Lights up on hover. */}
                      <div
                        className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full grid place-items-center text-muted/70 hover:text-brand-deep hover:bg-brand-soft/60 transition-colors"
                        aria-hidden="true"
                        data-testid="card-deep-dive-icon"
                      >
                        <ArrowUpRight size={13} weight="bold" />
                      </div>
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-brand-soft text-brand grid place-items-center shrink-0">
                          <Storefront size={18} weight="duotone" />
                        </div>
                        <div className="min-w-0 flex-1">
                          {/* Name + sales sit on a SINGLE LINE so the card
                              header reads as one phrase. The full sales
                              value is the dominant element; the % share
                              chip and country line follow on subsequent
                              rows. The location name truncates rather
                              than wrapping, with a title attribute for
                              the full string. */}
                          <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5 leading-tight">
                            <div className="font-bold text-[14px] truncate min-w-0" title={l.channel}>
                              {l.channel}
                            </div>
                            <div className="font-extrabold text-[15px] text-brand-deep num shrink-0">
                              {fmtKES(l.total_sales)}
                            </div>
                            {pctShare != null && (
                              <span
                                className="text-[10.5px] font-semibold text-[#1e6ad6] shrink-0"
                                data-testid={`loc-${l.channel}-pct-share`}
                                title="Share of total sales across all locations in scope"
                              >
                                {pctShare.toFixed(1)}%
                              </span>
                            )}
                          </div>
                          {/* Country line removed per spec — sales delta now
                              sits on its own row directly under the value/share
                              for a cleaner card. */}
                          {compareMode !== "none" && (
                            <div className="text-[11.5px] text-muted mt-1 flex items-center">
                              <InlineDelta delta={l.d_sales} testId={`loc-${l.channel}-d-sales`} compact />
                            </div>
                          )}
                        </div>
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
                      {/* Bottom-of-card deep-dive prompt — restated per
                          card so users mid-grid see the cue without
                          scrolling back to the banner above. Picks up the
                          card's hover via the parent .hover-lift. */}
                      <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-[11.5px]">
                        <span className="text-muted inline-flex items-center gap-1">
                          <span aria-hidden="true">👆</span>
                          <span>Click for deep dive</span>
                        </span>
                        <span className="font-semibold text-brand-deep inline-flex items-center gap-0.5">
                          <span>More info</span>
                          <ArrowUpRight size={11} weight="bold" />
                        </span>
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
                        <th className="text-right">Total Sales</th>
                        <th className="text-right">Orders</th>
                        <th className="text-right">Footfall</th>
                        <th className="text-right">Conversion</th>
                        <th className="text-right">Δ Conversion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {footfall.length === 0 && (
                        <tr><td colSpan={6}><Empty label="No footfall data in this period." /></td></tr>
                      )}
                      {[...footfall]
                        .sort((a, b) => (b.total_footfall || 0) - (a.total_footfall || 0))
                        .map((r, i) => {
                          const store = enriched.find((l) => l.channel === r.location);
                          const authoritativeSales = store ? (store.total_sales || 0) : (r.total_sales || 0);
                          const authoritativeOrders = store ? (store.orders || store.total_orders || 0) : (r.orders || 0);
                          const footfallCount = r.total_footfall || 0;
                          const cr = footfallCount ? (authoritativeOrders / footfallCount) * 100 : 0;
                          const convPp = store ? store.conv_delta_pp : null;
                          const pill = cr > 15 ? "pill-green" : cr >= 10 ? "pill-amber" : "pill-red";
                          return (
                            <tr key={r.location + i}>
                              <td className="font-medium">{r.location}</td>
                              <td className="text-right num font-semibold">{fmtKES(authoritativeSales)}</td>
                              <td className="text-right num">{fmtNum(authoritativeOrders)}</td>
                              <td className="text-right num">{fmtNum(footfallCount)}</td>
                              <td className="text-right"><span className={pill}>{fmtPct(cr)}</span></td>
                              <td className="text-right num">
                                {compareMode === "none" || convPp == null ? (
                                  <span className="text-muted text-[11px]">—</span>
                                ) : (
                                  <span className={`font-semibold ${convPp > 0.05 ? "text-emerald-700" : convPp < -0.05 ? "text-red-700" : "text-muted"}`}>
                                    {convPp > 0.05 ? "▲" : convPp < -0.05 ? "▼" : "—"} {Math.abs(convPp).toFixed(2)}pp
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* "Locations needing attention" — surfaces stores that look
                  off on at least one of: sales drop, conversion drop,
                  return-rate spike, or weak share + below-avg sales. */}
              <LocationsAttentionPanel
                rows={enrichedWithDq}
                avgSales={avg}
                totalSalesAll={totalSalesAll}
                returnStats={returnStats}
                compareMode={compareMode}
              />

              {/* Monthly Sales Target Tracker — duplicate of the
                  Targets-page block so store managers and exec users
                  can see daily progress without leaving the locations
                  view. The tracker is self-fetching off /analytics/
                  monthly-targets so the date range is the current month. */}
              <MonthlyTargetsTracker month={`${new Date(dateTo).toISOString().slice(0, 7)}-01`} />
            </>

          {/* Store deep-dive slide-over — the audit's "single biggest missed
              opportunity". Renders ONLY when `selected` is set. */}
          <StoreDeepDive
            open={!!selected}
            onClose={() => setSelected(null)}
            row={selected ? sorted.find((l) => l.channel === selected) || null : null}
            compareLbl={compareLbl}
            weekdayData={weekdayData}
          />
        </>
      )}
    </div>
  );
};

export default Locations;
