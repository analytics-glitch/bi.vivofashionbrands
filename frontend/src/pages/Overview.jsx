import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import {
  api,
  fmtKES,
  fmtNum,
  fmtPct,
  fmtAxisKES,
  fmtDate,
  buildParams,
  pctDelta,
  comparePeriod,
  COUNTRY_FLAGS,
} from "@/lib/api";
import { KPICard, HighlightCard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import {
  CurrencyCircleDollar,
  Coins,
  ShoppingCart,
  Package,
  Percent,
  ArrowUUpLeft,
  Basket,
  ChartBar,
  Storefront,
  Globe,
  TrendUp,
  Footprints,
  Target,
} from "@phosphor-icons/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";

const DONUT_COLORS = ["#1a5c38", "#00c853", "#d97706", "#4b7bec"];
const COUNTRY_LINE_COLORS = {
  Kenya: "#1a5c38",
  Uganda: "#d97706",
  Rwanda: "#00c853",
  Online: "#4b7bec",
};

const ALL_COUNTRIES = ["Kenya", "Uganda", "Rwanda", "Online"];

const Overview = () => {
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode } = applied;
  const filters = { dateFrom, dateTo, countries, channels };

  const [kpis, setKpis] = useState(null);
  const [kpisPrev, setKpisPrev] = useState(null);
  const [countrySummary, setCountrySummary] = useState([]);
  const [sales, setSales] = useState([]);
  const [dailyByCountry, setDailyByCountry] = useState({});
  const [dailyByCountryPrev, setDailyByCountryPrev] = useState({});
  const [topStyles, setTopStyles] = useState([]);
  const [subcats, setSubcats] = useState([]);
  const [footfall, setFootfall] = useState([]);
  const [footfallPrev, setFootfallPrev] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("units_sold");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = buildParams(filters);
    const prev = comparePeriod(dateFrom, dateTo, compareMode);

    const countriesToChart = countries.length ? countries : ALL_COUNTRIES;

    const dailyCalls = countriesToChart.map((c) =>
      api
        .get("/daily-trend", { params: { date_from: dateFrom, date_to: dateTo, country: c } })
        .then((r) => [c, r.data || []])
    );
    const dailyPrevCalls = prev
      ? countriesToChart.map((c) =>
          api
            .get("/daily-trend", { params: { date_from: prev.date_from, date_to: prev.date_to, country: c } })
            .then((r) => [c, r.data || []])
        )
      : [];

    Promise.all([
      api.get("/kpis", { params: p }),
      api.get("/country-summary", { params: { date_from: dateFrom, date_to: dateTo } }),
      api.get("/sales-summary", { params: p }),
      api.get("/sor", { params: p }),
      api.get("/subcategory-sales", { params: p }),
      api.get("/footfall", { params: { date_from: dateFrom, date_to: dateTo } }),
      prev
        ? api.get("/kpis", { params: buildParams({ ...filters, dateFrom: prev.date_from, dateTo: prev.date_to }) })
        : Promise.resolve(null),
      Promise.all(dailyCalls),
      Promise.all(dailyPrevCalls),
      prev
        ? api.get("/footfall", { params: { date_from: prev.date_from, date_to: prev.date_to } })
        : Promise.resolve({ data: [] }),
      api.get("/locations"),
    ])
      .then(([k, cs, s, sor, sc, ff, kp, daily, dailyP, ffp, locs]) => {
        if (cancelled) return;
        setKpis(k.data);
        setCountrySummary(cs.data || []);
        setSales(s.data || []);
        setTopStyles((sor.data || []).slice().sort((a, b) => (b.units_sold || 0) - (a.units_sold || 0)).slice(0, 20));
        setSubcats(sc.data || []);
        setFootfall(ff.data || []);
        setFootfallPrev(ffp?.data || []);
        setLocations(locs?.data || []);
        setKpisPrev(kp?.data || null);
        setDailyByCountry(Object.fromEntries(daily));
        setDailyByCountryPrev(Object.fromEntries(dailyP));
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode]);

  const delta = (k) => (kpis && kpisPrev) ? pctDelta(kpis[k], kpisPrev[k]) : null;
  const compareLbl = compareMode === "last_month" ? "vs LM" : compareMode === "last_year" ? "vs LY" : null;

  const top15 = useMemo(() => {
    return [...sales]
      .sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0))
      .slice(0, 15)
      .map((r) => ({
        ...r,
        label: (r.channel || "").length > 20 ? (r.channel || "").slice(0, 19) + "…" : r.channel,
      }));
  }, [sales]);

  const donutCountries = useMemo(() => {
    let src = countrySummary;
    if (countries.length) src = src.filter((c) => countries.includes(c.country));
    return src;
  }, [countrySummary, countries]);

  const topCountry = useMemo(() => {
    if (!donutCountries.length) return null;
    return [...donutCountries].sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0))[0];
  }, [donutCountries]);

  const topChannel = useMemo(() => {
    if (!sales.length) return null;
    return [...sales].sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0))[0];
  }, [sales]);

  const bestConversionStore = useMemo(() => {
    // exclude Vivo Junction if >50% conversion
    const filtered = footfall.filter((r) => !(r.location === "Vivo Junction" && (r.conversion_rate || 0) > 50));
    const realistic = filtered.filter((r) => (r.conversion_rate || 0) <= 50);
    if (!realistic.length) return null;
    return [...realistic].sort((a, b) => (b.conversion_rate || 0) - (a.conversion_rate || 0))[0];
  }, [footfall]);

  // Channel -> country map for filtering footfall by country selection
  const channelCountryMap = useMemo(() => {
    const m = {};
    for (const l of locations) m[l.channel] = l.country;
    return m;
  }, [locations]);

  // Aggregate footfall (excluding Vivo Junction due to >50% conv rate data-quality rule)
  const aggFootfall = (rows) => {
    let fVisits = 0;
    let fOrders = 0;
    for (const r of rows || []) {
      if ((r.conversion_rate || 0) > 50) continue; // data-quality rule
      // Apply country filter if active
      if (countries.length) {
        const c = channelCountryMap[r.location];
        if (!c || !countries.includes(c)) continue;
      }
      // Apply channel filter if active
      if (channels.length && !channels.includes(r.location)) continue;
      fVisits += r.total_footfall || 0;
      fOrders += r.orders || 0;
    }
    const conv = fVisits > 0 ? (fOrders / fVisits) * 100 : 0;
    return { total_footfall: fVisits, orders: fOrders, conversion_rate: conv };
  };

  const footfallAgg = useMemo(() => aggFootfall(footfall), [footfall, countries, channels, channelCountryMap]);
  const footfallAggPrev = useMemo(() => aggFootfall(footfallPrev), [footfallPrev, countries, channels, channelCountryMap]);

  // merge daily by day; one key per country (current) + country_prev for previous
  const dailyMerged = useMemo(() => {
    const byDay = {};
    const ccToChart = countries.length ? countries : ALL_COUNTRIES;
    for (const c of ccToChart) {
      const rows = dailyByCountry[c] || [];
      for (const r of rows) {
        if (!byDay[r.day]) byDay[r.day] = { day: r.day };
        byDay[r.day][c] = r.total_sales ?? r.gross_sales ?? 0;
      }
      const prevRows = dailyByCountryPrev[c] || [];
      // align by index (same position as current rows)
      const curr = rows;
      curr.forEach((r, i) => {
        if (!byDay[r.day]) byDay[r.day] = { day: r.day };
        if (prevRows[i] !== undefined) {
          byDay[r.day][c + "_prev"] = prevRows[i].total_sales ?? prevRows[i].gross_sales ?? null;
        }
      });
    }
    return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
  }, [dailyByCountry, dailyByCountryPrev, countries]);

  const countriesToChart = countries.length ? countries : ALL_COUNTRIES;

  const sortedStyles = useMemo(
    () => [...topStyles].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0)),
    [topStyles, sortKey]
  );

  const subcatTop = useMemo(
    () => [...subcats].sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0)).slice(0, 15),
    [subcats]
  );

  return (
    <div className="space-y-6" data-testid="overview-page">
      <div>
        <div className="eyebrow">Dashboard · Overview</div>
        <h1 className="font-extrabold text-[28px] tracking-tight mt-1">Overview</h1>
        <p className="text-muted text-[13px] mt-0.5">
          {fmtDate(dateFrom)} → {fmtDate(dateTo)}
          {compareMode !== "none" && (
            <span className="ml-2 pill-neutral">
              {compareMode === "last_month" ? "vs Last Month" : "vs Last Year"}
            </span>
          )}
        </p>
      </div>

      {loading && <Loading label="Aggregating group KPIs…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && kpis && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard testId="kpi-total-sales" accent label="Total Sales" value={fmtKES(kpis.total_sales)} icon={CurrencyCircleDollar}
              delta={delta("total_sales")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard testId="kpi-net-sales" label="Net Sales" value={fmtKES(kpis.net_sales)} icon={Coins}
              delta={delta("net_sales")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard testId="kpi-orders" label="Total Orders" value={fmtNum(kpis.total_orders)} icon={ShoppingCart}
              delta={delta("total_orders")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard testId="kpi-units" label="Total Units Sold" value={fmtNum(kpis.total_units)} icon={Package}
              delta={delta("total_units")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard small testId="kpi-basket" label="Avg Basket Size" value={fmtKES(kpis.avg_basket_size)} icon={Basket}
              delta={delta("avg_basket_size")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard small testId="kpi-asp" label="Avg Selling Price" value={fmtKES(kpis.avg_selling_price)} icon={ChartBar}
              delta={delta("avg_selling_price")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard small testId="kpi-rr" label="Return Rate" value={fmtPct(kpis.return_rate, 2)} icon={Percent}
              higherIsBetter={false} delta={delta("return_rate")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard small testId="kpi-returns" label="Return Amount" value={fmtKES(kpis.total_returns)} icon={ArrowUUpLeft}
              higherIsBetter={false} delta={delta("total_returns")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard small testId="kpi-footfall" label="Total Footfall" sub="Visitors to stores (excl. data-quality outliers)" value={fmtNum(footfallAgg.total_footfall)} icon={Footprints}
              delta={compareMode !== "none" && footfallAggPrev.total_footfall ? pctDelta(footfallAgg.total_footfall, footfallAggPrev.total_footfall) : null}
              deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard small testId="kpi-conversion" label="Conversion Rate" sub="Orders ÷ Footfall" value={fmtPct(footfallAgg.conversion_rate, 2)} icon={Target}
              delta={compareMode !== "none" && footfallAggPrev.conversion_rate ? pctDelta(footfallAgg.conversion_rate, footfallAggPrev.conversion_rate) : null}
              deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <HighlightCard testId="highlight-top-country" label="Top Country"
              name={topCountry ? `${COUNTRY_FLAGS[topCountry.country] || "🌍"} ${topCountry.country}` : "—"}
              amount={topCountry ? fmtKES(topCountry.total_sales) : "—"} icon={Globe} />
            <HighlightCard testId="highlight-top-location" label="Top Location"
              name={topChannel ? topChannel.channel : "—"}
              amount={topChannel ? fmtKES(topChannel.total_sales) : "—"} icon={Storefront} />
            <HighlightCard testId="highlight-best-conversion" label="Best Conversion Rate"
              name={bestConversionStore ? bestConversionStore.location : "—"}
              amount={bestConversionStore ? fmtPct(bestConversionStore.conversion_rate) : "—"} icon={TrendUp} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card-white p-5 lg:col-span-2" data-testid="chart-top-channels">
              <SectionTitle title="Top 15 locations by Total Sales" subtitle="Ranked across the current scope" />
              {top15.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: 380 }}>
                  <ResponsiveContainer>
                    <BarChart data={top15} layout="vertical" margin={{ left: 20, right: 20 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtKES(v)} />
                      <Bar dataKey="total_sales" fill="#1a5c38" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card-white p-5" data-testid="chart-country-split">
              <SectionTitle title="Country split" subtitle="Total Sales by market" />
              {donutCountries.length === 0 ? <Empty /> : (
                <>
                  <div style={{ width: "100%", height: 200 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={donutCountries} dataKey="total_sales" nameKey="country" innerRadius={48} outerRadius={80} paddingAngle={3}>
                          {donutCountries.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => fmtKES(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-1 divide-y divide-border text-[12px]">
                    {donutCountries.map((c, i) => {
                      const total = donutCountries.reduce((s, x) => s + (x.total_sales || 0), 0) || 1;
                      const pct = ((c.total_sales || 0) / total) * 100;
                      return (
                        <li key={c.country} className="flex items-center justify-between py-1.5" data-testid={`country-row-${c.country}`}>
                          <span className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                            <span className="font-medium">{COUNTRY_FLAGS[c.country] || "🌍"} {c.country}</span>
                          </span>
                          <span className="num"><span className="font-bold">{fmtKES(c.total_sales)}</span> <span className="text-muted ml-1">{pct.toFixed(1)}%</span></span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>

          <div className="card-white p-5" data-testid="chart-daily-trend">
            <SectionTitle title="Daily sales trend" subtitle={compareMode === "none" ? "Total Sales per day, one line per country" : `Solid = current · Dotted = ${compareMode === "last_month" ? "last month" : "last year"}`} />
            {dailyMerged.length === 0 ? <Empty /> : (
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={dailyMerged} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }}
                      tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} />
                    <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} width={60} />
                    <Tooltip formatter={(v) => fmtKES(v)} labelFormatter={(l) => fmtDate(l)} />
                    <Legend />
                    {countriesToChart.map((c) => (
                      <Line key={c} type="monotone" dataKey={c} stroke={COUNTRY_LINE_COLORS[c] || "#4b5563"} strokeWidth={2.2} dot={false} name={c} />
                    ))}
                    {compareMode !== "none" && countriesToChart.map((c) => (
                      <Line key={c + "_prev"} type="monotone" dataKey={c + "_prev"} stroke={COUNTRY_LINE_COLORS[c] || "#9ca3af"} strokeWidth={1.5} strokeDasharray="5 4" dot={false} name={`${c} (prev)`} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card-white p-5" data-testid="subcat-chart">
            <SectionTitle title="Sales by Subcategory" subtitle="Total Sales per subcategory (top 15)" />
            {subcatTop.length === 0 ? <Empty /> : (
              <div style={{ width: "100%", height: 400 }}>
                <ResponsiveContainer>
                  <BarChart data={subcatTop} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="subcategory" width={170} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => fmtKES(v)} />
                    <Bar dataKey="total_sales" fill="#00c853" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card-white p-5" data-testid="top-styles-section">
            <SectionTitle title="Top 20 styles" subtitle="Ranked by units sold. Click a column to re-sort." />
            <div className="overflow-x-auto">
              <table className="w-full data" data-testid="top-styles-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Style Name</th>
                    <th>Collection</th>
                    <th>Brand</th>
                    <th>Subcategory</th>
                    {[["units_sold","Units"],["total_sales","Total Sales"]].map(([k,l]) => (
                      <th key={k} className="text-right cursor-pointer" onClick={() => setSortKey(k)}>
                        {l} {sortKey===k && "↓"}
                      </th>
                    ))}
                    <th className="text-right">Avg Price</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStyles.length === 0 && (
                    <tr><td colSpan={8}><Empty /></td></tr>
                  )}
                  {sortedStyles.map((s, i) => {
                    const avgPrice = s.units_sold ? (s.total_sales || 0) / s.units_sold : 0;
                    return (
                      <tr key={(s.style_name || "") + i}>
                        <td className="text-muted num">{i + 1}</td>
                        <td className="font-medium max-w-[280px] truncate" title={s.style_name}>{s.style_name}</td>
                        <td className="text-muted">{s.collection || "—"}</td>
                        <td><span className="pill-neutral">{s.brand || "—"}</span></td>
                        <td className="text-muted">{s.product_type || "—"}</td>
                        <td className="text-right num font-semibold">{fmtNum(s.units_sold)}</td>
                        <td className="text-right num font-bold text-brand">{fmtKES(s.total_sales)}</td>
                        <td className="text-right num">{fmtKES(avgPrice)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Overview;
