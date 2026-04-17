import React, { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/Topbar";
import { KPICard, HighlightCard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import {
  api,
  fmtKES,
  fmtNum,
  fmtPct,
  fmtDec,
  fmtDate,
  fmtAxisKES,
  storeToCountry,
  countryToStoreId,
  prevMonthRange,
  prevYearRange,
  pctDelta,
  COUNTRY_FLAGS,
} from "@/lib/api";
import { useFilters } from "@/lib/filters";
import {
  CurrencyCircleDollar,
  ShoppingCart,
  Package,
  Basket,
  Coins,
  ArrowsLeftRight,
  ArrowUUpLeft,
  Percent,
  Storefront,
  Tag,
  Books,
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

const DONUT_COLORS = ["#00a34a", "#f59e0b", "#ef6c00"];

const Overview = () => {
  const { dateFrom, dateTo, country, location } = useFilters();

  const [kpis, setKpis] = useState(null);
  const [prevMonthKpis, setPrevMonthKpis] = useState(null);
  const [prevYearKpis, setPrevYearKpis] = useState(null);
  const [highlights, setHighlights] = useState(null);
  const [summary, setSummary] = useState([]);
  const [byCountry, setByCountry] = useState([]);
  const [daily, setDaily] = useState([]);
  const [topSkus, setTopSkus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const storeId = countryToStoreId(country);
    const locParam = location !== "all" ? location : undefined;
    const baseParams = {
      date_from: dateFrom,
      date_to: dateTo,
      store_id: storeId,
      location: locParam,
    };
    const prevM = prevMonthRange(dateFrom, dateTo);
    const prevY = prevYearRange(dateFrom, dateTo);
    const prevMParams = { ...prevM, store_id: storeId, location: locParam };
    const prevYParams = { ...prevY, store_id: storeId, location: locParam };

    Promise.all([
      api.get("/analytics/kpis-plus", { params: baseParams }),
      api.get("/analytics/kpis-plus", { params: prevMParams }),
      api.get("/analytics/kpis-plus", { params: prevYParams }),
      api.get("/analytics/highlights", { params: baseParams }),
      api.get("/sales-summary", {
        params: { date_from: dateFrom, date_to: dateTo, store_id: storeId },
      }),
      api.get("/analytics/by-country", {
        params: { date_from: dateFrom, date_to: dateTo },
      }),
      api.get("/daily-trend", {
        params: { date_from: dateFrom, date_to: dateTo, store_id: storeId },
      }),
      api.get("/top-skus", { params: { ...baseParams, limit: 20 } }),
    ])
      .then(([k, pm, py, h, s, c, d, t]) => {
        if (cancelled) return;
        setKpis(k.data);
        setPrevMonthKpis(pm.data);
        setPrevYearKpis(py.data);
        setHighlights(h.data);
        setSummary(s.data || []);
        setByCountry(c.data || []);
        setDaily(d.data || []);
        setTopSkus(t.data || []);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, country, location]);

  const getDeltas = (field, higherBetter = true) => {
    if (!kpis) return { mom: null, yoy: null };
    return {
      mom: prevMonthKpis ? pctDelta(kpis[field], prevMonthKpis[field]) : null,
      yoy: prevYearKpis ? pctDelta(kpis[field], prevYearKpis[field]) : null,
    };
  };

  // Apply location filter client-side; country already applied server-side via store_id
  const filteredSummary = useMemo(() => {
    let s = summary;
    if (location !== "all") s = s.filter((r) => r.location === location);
    return s;
  }, [summary, location]);

  const top15 = useMemo(() => {
    return [...filteredSummary]
      .sort((a, b) => (b.gross_sales || 0) - (a.gross_sales || 0))
      .slice(0, 15)
      .map((r) => ({
        ...r,
        label:
          (r.location || "").length > 18
            ? (r.location || "").slice(0, 17) + "…"
            : r.location,
      }));
  }, [filteredSummary]);

  const donutCountries = useMemo(() => {
    if (country === "all") return byCountry;
    return byCountry.filter((c) => c.country === country);
  }, [byCountry, country]);

  return (
    <div className="space-y-8" data-testid="overview-page">
      <Topbar
        title="Overview"
        subtitle={`Group performance · ${fmtDate(dateFrom)} → ${fmtDate(dateTo)}`}
      />

      {loading && <Loading label="Aggregating KPIs…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && kpis && (
        <>
          {/* Row 1 KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              testId="kpi-gross"
              accent
              label="Total Gross Sales"
              value={fmtKES(kpis.total_gross_sales)}
              icon={CurrencyCircleDollar}
              {...(() => {
                const { mom, yoy } = getDeltas("total_gross_sales");
                return { deltaMoM: mom, deltaYoY: yoy };
              })()}
            />
            <KPICard
              testId="kpi-net"
              label="Total Net Sales"
              value={fmtKES(kpis.total_net_sales)}
              icon={Coins}
              {...(() => {
                const { mom, yoy } = getDeltas("total_net_sales");
                return { deltaMoM: mom, deltaYoY: yoy };
              })()}
            />
            <KPICard
              testId="kpi-orders"
              label="Total Orders"
              value={fmtNum(kpis.total_orders)}
              icon={ShoppingCart}
              {...(() => {
                const { mom, yoy } = getDeltas("total_orders");
                return { deltaMoM: mom, deltaYoY: yoy };
              })()}
            />
            <KPICard
              testId="kpi-units"
              label="Total Units Sold"
              sub="Excl. shopping bags & gift vouchers"
              value={fmtNum(kpis.units_clean ?? kpis.total_units)}
              icon={Package}
              {...(() => {
                const { mom, yoy } = getDeltas("total_units");
                return { deltaMoM: mom, deltaYoY: yoy };
              })()}
            />
          </div>

          {/* Row 2 KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KPICard
              testId="kpi-basket"
              label="Avg Basket Size"
              value={fmtKES(kpis.avg_basket_size)}
              icon={Basket}
              {...(() => {
                const { mom, yoy } = getDeltas("avg_basket_size");
                return { deltaMoM: mom, deltaYoY: yoy };
              })()}
            />
            <KPICard
              testId="kpi-asp"
              label="Avg Selling Price"
              value={fmtKES(kpis.avg_selling_price)}
              icon={Tag}
              {...(() => {
                const { mom, yoy } = getDeltas("avg_selling_price");
                return { deltaMoM: mom, deltaYoY: yoy };
              })()}
            />
            <KPICard
              testId="kpi-upo"
              label="Units per Order"
              value={fmtDec(kpis.units_per_order, 2)}
              icon={ArrowsLeftRight}
              {...(() => {
                const { mom, yoy } = getDeltas("units_per_order");
                return { deltaMoM: mom, deltaYoY: yoy };
              })()}
            />
            <KPICard
              testId="kpi-return"
              label="Return Rate"
              value={fmtPct(kpis.return_rate)}
              icon={ArrowUUpLeft}
              higherIsBetter={false}
              {...(() => {
                const { mom, yoy } = getDeltas("return_rate", false);
                return { deltaMoM: mom, deltaYoY: yoy };
              })()}
            />
            <KPICard
              testId="kpi-st"
              label="Sell Through Rate"
              value={fmtPct(kpis.sell_through_rate)}
              icon={Percent}
              {...(() => {
                const { mom, yoy } = getDeltas("sell_through_rate");
                return { deltaMoM: mom, deltaYoY: yoy };
              })()}
            />
          </div>

          {/* Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <HighlightCard
              testId="highlight-location"
              label="Top Location"
              name={highlights?.top_location?.name}
              amount={fmtKES(highlights?.top_location?.gross_sales)}
              icon={Storefront}
            />
            <HighlightCard
              testId="highlight-brand"
              label="Top Brand"
              name={highlights?.top_brand?.name}
              amount={fmtKES(highlights?.top_brand?.gross_sales)}
              icon={Tag}
            />
            <HighlightCard
              testId="highlight-collection"
              label="Top Collection"
              name={highlights?.top_collection?.name}
              amount={fmtKES(highlights?.top_collection?.gross_sales)}
              icon={Books}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="card p-6 lg:col-span-2" data-testid="chart-top-locations">
              <SectionTitle
                title="Top 15 locations by Gross Sales"
                subtitle="Ranked across the current scope"
              />
              {top15.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ width: "100%", height: 360 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={top15}
                      margin={{ top: 10, right: 12, left: 0, bottom: 56 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        interval={0}
                        angle={-30}
                        textAnchor="end"
                        height={76}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        tickFormatter={(v) => fmtAxisKES(v)}
                        tick={{ fontSize: 11 }}
                        width={60}
                      />
                      <Tooltip
                        formatter={(v) => fmtKES(v)}
                        labelFormatter={(l) => `Store: ${l}`}
                      />
                      <Bar dataKey="gross_sales" fill="#00a34a" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card p-6" data-testid="chart-country-split">
              <SectionTitle title="Country split" subtitle="Gross Sales by market" />
              {donutCountries.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={donutCountries}
                        dataKey="gross_sales"
                        nameKey="country"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={3}
                      >
                        {donutCountries.map((_, i) => (
                          <Cell
                            key={i}
                            fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => fmtKES(v)} />
                      <Legend
                        verticalAlign="bottom"
                        height={24}
                        iconType="circle"
                        iconSize={8}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <ul className="mt-2 divide-y divide-border text-[13px]">
                {donutCountries.map((c) => (
                  <li
                    key={c.country}
                    className="flex items-center justify-between py-2"
                    data-testid={`country-row-${c.country}`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{COUNTRY_FLAGS[c.country] || "🌍"}</span>
                      <span className="font-medium text-foreground">
                        {c.country}
                      </span>
                    </span>
                    <span className="font-bold text-brand-deep">
                      {fmtKES(c.gross_sales)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card p-6" data-testid="chart-daily-trend">
            <SectionTitle title="Daily sales trend" subtitle="Gross Sales per day" />
            {daily.length === 0 ? (
              <Empty />
            ) : (
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={daily} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}>
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
                    <YAxis
                      tickFormatter={(v) => fmtAxisKES(v)}
                      tick={{ fontSize: 11 }}
                      width={60}
                    />
                    <Tooltip
                      formatter={(v) => fmtKES(v)}
                      labelFormatter={(l) => fmtDate(l)}
                    />
                    <Line
                      type="monotone"
                      dataKey="gross_sales"
                      stroke="#00a34a"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#00a34a" }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Top SKUs table */}
          <div className="card p-6" data-testid="top-skus-section">
            <SectionTitle
              title="Top 20 SKUs"
              subtitle="Best-selling SKUs across the selected scope"
            />
            <div className="overflow-x-auto">
              <table className="w-full data" data-testid="top-skus-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>SKU</th>
                    <th>Product Name</th>
                    <th>Size</th>
                    <th>Brand</th>
                    <th className="text-right">Units Sold</th>
                    <th className="text-right">Total Sales</th>
                    <th className="text-right">Avg Price</th>
                  </tr>
                </thead>
                <tbody>
                  {topSkus.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <Empty />
                      </td>
                    </tr>
                  )}
                  {topSkus.map((s, i) => (
                    <tr key={s.sku + i}>
                      <td className="text-muted">{i + 1}</td>
                      <td className="font-mono text-[11.5px] text-muted">{s.sku}</td>
                      <td className="font-medium max-w-[340px] truncate" title={s.product_name}>
                        {s.product_name}
                      </td>
                      <td>{s.size || "—"}</td>
                      <td><span className="pill-green">{s.brand || "—"}</span></td>
                      <td className="text-right font-semibold">{fmtNum(s.units_sold)}</td>
                      <td className="text-right font-bold text-brand-deep">{fmtKES(s.total_sales)}</td>
                      <td className="text-right">{fmtKES(s.avg_price)}</td>
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
