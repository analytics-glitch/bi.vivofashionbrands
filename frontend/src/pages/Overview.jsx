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
  Tag,
  Percent,
  Receipt,
  ArrowUUpLeft,
  Basket,
  ChartBar,
  Storefront,
  Globe,
  ArrowsDownUp,
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

const Overview = () => {
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode } = applied;
  const filters = { dateFrom, dateTo, countries, channels };

  const [kpis, setKpis] = useState(null);
  const [kpisPrev, setKpisPrev] = useState(null);
  const [country, setCountry] = useState([]);
  const [countrySummary, setCountrySummary] = useState([]);
  const [sales, setSales] = useState([]);
  const [daily, setDaily] = useState([]);
  const [dailyPrev, setDailyPrev] = useState([]);
  const [top, setTop] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("total_sales");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = buildParams(filters);
    const prev = comparePeriod(dateFrom, dateTo, compareMode);

    const base = [
      api.get("/kpis", { params: p }),
      api.get("/country-summary", { params: { date_from: dateFrom, date_to: dateTo } }),
      api.get("/sales-summary", { params: p }),
      api.get("/daily-trend", { params: { ...p, channel: undefined } }),
      api.get("/top-skus", { params: { ...p, limit: 20 } }),
    ];
    const extras = prev
      ? [
          api.get("/kpis", {
            params: buildParams(
              { ...filters, dateFrom: prev.date_from, dateTo: prev.date_to }
            ),
          }),
          api.get("/daily-trend", {
            params: {
              date_from: prev.date_from,
              date_to: prev.date_to,
              country: p.country,
            },
          }),
        ]
      : [Promise.resolve(null), Promise.resolve(null)];

    Promise.all([...base, ...extras])
      .then(([k, cs, s, d, t, kp, dp]) => {
        if (cancelled) return;
        setKpis(k.data);
        setKpisPrev(kp?.data || null);
        setCountrySummary(cs.data || []);
        setSales(s.data || []);
        setDaily(d.data || []);
        setDailyPrev(dp?.data || []);
        setTop(t.data || []);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode]);

  const delta = (k, higher = true) => {
    if (!kpis || !kpisPrev) return null;
    return pctDelta(kpis[k], kpisPrev[k]);
  };

  const compareLbl =
    compareMode === "last_month" ? "vs LM" : compareMode === "last_year" ? "vs LY" : null;

  const top15 = useMemo(() => {
    return [...sales]
      .sort((a, b) => (b.total_sales || 0) - (a.total_sales || 0))
      .slice(0, 15)
      .map((r) => ({
        ...r,
        label:
          (r.channel || "").length > 20
            ? (r.channel || "").slice(0, 19) + "…"
            : r.channel,
      }));
  }, [sales]);

  const donutCountries = useMemo(() => {
    let src = countrySummary;
    if (countries.length) src = src.filter((c) => countries.includes(c.country));
    return src;
  }, [countrySummary, countries]);

  const topCountry = useMemo(() => {
    if (!donutCountries.length) return null;
    return [...donutCountries].sort(
      (a, b) => (b.total_sales || 0) - (a.total_sales || 0)
    )[0];
  }, [donutCountries]);

  const topChannel = useMemo(() => {
    if (!sales.length) return null;
    return [...sales].sort(
      (a, b) => (b.total_sales || 0) - (a.total_sales || 0)
    )[0];
  }, [sales]);

  // merge daily with prev (index-aligned by position)
  const dailyMerged = useMemo(() => {
    return daily.map((d, i) => ({
      ...d,
      prev: dailyPrev[i]?.total_sales ?? dailyPrev[i]?.gross_sales ?? null,
    }));
  }, [daily, dailyPrev]);

  const sortedTop = useMemo(() => {
    return [...top].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
  }, [top, sortKey]);

  const clickSort = (k) => setSortKey(k);

  return (
    <div className="space-y-6" data-testid="overview-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow">Dashboard · Overview</div>
          <h1 className="font-extrabold text-[28px] tracking-tight mt-1">
            Overview
          </h1>
          <p className="text-muted text-[13px] mt-0.5">
            {fmtDate(dateFrom)} → {fmtDate(dateTo)}
            {compareMode !== "none" && (
              <span className="ml-2 pill-neutral">
                {compareMode === "last_month" ? "vs Last Month" : "vs Last Year"}
              </span>
            )}
          </p>
        </div>
      </div>

      {loading && <Loading label="Aggregating group KPIs…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && kpis && (
        <>
          {/* Row 1 — 4 big cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              testId="kpi-total-sales"
              accent
              label="Total Sales"
              value={fmtKES(kpis.total_sales)}
              icon={CurrencyCircleDollar}
              delta={delta("total_sales")}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              testId="kpi-net-sales"
              label="Net Sales"
              value={fmtKES(kpis.net_sales)}
              icon={Coins}
              delta={delta("net_sales")}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              testId="kpi-orders"
              label="Total Orders"
              value={fmtNum(kpis.total_orders)}
              icon={ShoppingCart}
              delta={delta("total_orders")}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              testId="kpi-units"
              label="Total Units Sold"
              value={fmtNum(kpis.total_units)}
              icon={Package}
              delta={delta("total_units")}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
          </div>

          {/* Row 2 — 5 smaller cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KPICard
              small
              testId="kpi-gross"
              label="Gross Sales"
              value={fmtKES(kpis.gross_sales)}
              icon={Tag}
              delta={delta("gross_sales")}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              small
              testId="kpi-discounts"
              label="Discounts"
              value={fmtKES(kpis.total_discounts)}
              icon={Receipt}
              higherIsBetter={false}
              delta={delta("total_discounts", false)}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              small
              testId="kpi-returns"
              label="Returns"
              value={fmtKES(kpis.total_returns)}
              icon={ArrowUUpLeft}
              higherIsBetter={false}
              delta={delta("total_returns", false)}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              small
              testId="kpi-basket"
              label="Avg Basket Size"
              value={fmtKES(kpis.avg_basket_size)}
              icon={Basket}
              delta={delta("avg_basket_size")}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
            <KPICard
              small
              testId="kpi-asp"
              label="Avg Selling Price"
              value={fmtKES(kpis.avg_selling_price)}
              icon={ChartBar}
              delta={delta("avg_selling_price")}
              deltaLabel={compareLbl}
              showDelta={compareMode !== "none"}
            />
          </div>

          {/* Highlight strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <HighlightCard
              testId="highlight-return-rate"
              label="Return Rate"
              name={fmtPct(kpis.return_rate, 2)}
              amount={`Returns: ${fmtKES(kpis.total_returns)}`}
              icon={Percent}
            />
            <HighlightCard
              testId="highlight-top-country"
              label="Top Country"
              name={
                topCountry
                  ? `${COUNTRY_FLAGS[topCountry.country] || "🌍"} ${topCountry.country}`
                  : "—"
              }
              amount={topCountry ? fmtKES(topCountry.total_sales) : "—"}
              icon={Globe}
            />
            <HighlightCard
              testId="highlight-top-location"
              label="Top Location"
              name={topChannel ? topChannel.channel : "—"}
              amount={topChannel ? fmtKES(topChannel.total_sales) : "—"}
              icon={Storefront}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card-white p-5 lg:col-span-2" data-testid="chart-top-channels">
              <SectionTitle
                title="Top 15 channels by Total Sales"
                subtitle="Ranked across the current scope"
              />
              {top15.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ width: "100%", height: 380 }}>
                  <ResponsiveContainer>
                    <BarChart data={top15} layout="vertical" margin={{ left: 20, right: 20 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={150}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip formatter={(v) => fmtKES(v)} />
                      <Bar dataKey="total_sales" fill="#1a5c38" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card-white p-5" data-testid="chart-country-split">
              <SectionTitle title="Country split" subtitle="Total Sales by market" />
              {donutCountries.length === 0 ? (
                <Empty />
              ) : (
                <>
                  <div style={{ width: "100%", height: 220 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={donutCountries}
                          dataKey="total_sales"
                          nameKey="country"
                          innerRadius={52}
                          outerRadius={86}
                          paddingAngle={3}
                        >
                          {donutCountries.map((_, i) => (
                            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => fmtKES(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-1 divide-y divide-border text-[12.5px]">
                    {donutCountries.map((c, i) => {
                      const total = donutCountries.reduce((s, x) => s + (x.total_sales || 0), 0) || 1;
                      const pct = ((c.total_sales || 0) / total) * 100;
                      return (
                        <li
                          key={c.country}
                          className="flex items-center justify-between py-2"
                          data-testid={`country-row-${c.country}`}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                            />
                            <span className="font-medium">
                              {COUNTRY_FLAGS[c.country] || "🌍"} {c.country}
                            </span>
                          </span>
                          <span className="num">
                            <span className="font-bold text-foreground">{fmtKES(c.total_sales)}</span>
                            <span className="text-muted ml-2">{pct.toFixed(1)}%</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>

          <div className="card-white p-5" data-testid="chart-daily-trend">
            <SectionTitle
              title="Daily sales trend"
              subtitle={
                compareMode === "none"
                  ? "Total Sales per day"
                  : `Solid = current · Dotted = ${
                      compareMode === "last_month" ? "last month" : "last year"
                    }`
              }
            />
            {dailyMerged.length === 0 ? (
              <Empty />
            ) : (
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <LineChart data={dailyMerged} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d) =>
                        new Date(d).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })
                      }
                    />
                    <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} width={60} />
                    <Tooltip
                      formatter={(v) => fmtKES(v)}
                      labelFormatter={(l) => fmtDate(l)}
                    />
                    <Line
                      type="monotone"
                      dataKey="total_sales"
                      name="Total Sales"
                      stroke="#1a5c38"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#1a5c38" }}
                    />
                    {compareMode !== "none" && (
                      <Line
                        type="monotone"
                        dataKey="prev"
                        name={compareMode === "last_month" ? "Last Month" : "Last Year"}
                        stroke="#9ca3af"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card-white p-5" data-testid="top-skus-section">
            <SectionTitle
              title="Top 20 SKUs"
              subtitle="Click any column header to sort"
              action={
                <div className="flex items-center gap-1 text-[11.5px] text-muted">
                  <ArrowsDownUp size={12} /> Sort:{" "}
                  <span className="text-foreground font-medium">{sortKey.replace("_", " ")}</span>
                </div>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full data" data-testid="top-skus-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Size</th>
                    <th>Brand</th>
                    <th>Collection</th>
                    {[
                      ["units_sold", "Units"],
                      ["total_sales", "Total Sales"],
                      ["avg_price", "Avg Price"],
                    ].map(([k, lbl]) => (
                      <th
                        key={k}
                        className="text-right cursor-pointer select-none"
                        onClick={() => clickSort(k)}
                      >
                        {lbl} {sortKey === k && "↓"}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTop.length === 0 && (
                    <tr>
                      <td colSpan={9}>
                        <Empty />
                      </td>
                    </tr>
                  )}
                  {sortedTop.map((s, i) => (
                    <tr key={s.sku + i}>
                      <td className="text-muted num">{i + 1}</td>
                      <td className="font-mono text-[11px] text-muted">{s.sku}</td>
                      <td className="font-medium max-w-[320px] truncate" title={s.product_name}>
                        {s.product_name}
                      </td>
                      <td>{s.size || "—"}</td>
                      <td><span className="pill-neutral">{s.brand || "—"}</span></td>
                      <td className="text-muted">{s.collection || "—"}</td>
                      <td className="text-right num font-semibold">{fmtNum(s.units_sold)}</td>
                      <td className="text-right num font-bold text-brand">{fmtKES(s.total_sales)}</td>
                      <td className="text-right num">{fmtKES(s.avg_price)}</td>
                    </tr>
                  ))}
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
