import React, { useEffect, useState, useMemo } from "react";
import Topbar from "@/components/Topbar";
import KPICard from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle } from "@/components/common";
import { api, fmtMoney, fmtNumber, fmtPct, COUNTRY_FLAGS } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import {
  CurrencyDollar,
  ShoppingCart,
  Package,
  Percent,
  Tag,
  Buildings,
  ArrowUpRight,
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
} from "recharts";

const CHART_COLORS = ["#C84B31", "#DDA77B", "#4A5340", "#8C7A6B", "#E5E0D8"];

const Overview = () => {
  const { dateFrom, dateTo } = useFilters();
  const [overview, setOverview] = useState(null);
  const [byCountry, setByCountry] = useState([]);
  const [summary, setSummary] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = { date_from: dateFrom, date_to: dateTo };
    Promise.all([
      api.get("/analytics/overview", { params }),
      api.get("/analytics/by-country", { params }),
      api.get("/sales-summary", { params }),
      api.get("/analytics/top-products", { params: { ...params, limit: 5, metric: "net_sales" } }),
    ])
      .then(([a, b, c, d]) => {
        if (cancelled) return;
        setOverview(a.data);
        setByCountry(b.data || []);
        setSummary(c.data || []);
        setTopProducts(d.data || []);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  const topStores = useMemo(() => {
    return [...summary]
      .sort((a, b) => (b.net_sales || 0) - (a.net_sales || 0))
      .slice(0, 8)
      .map((s) => ({
        ...s,
        label:
          s.location && s.location.length > 18
            ? s.location.slice(0, 17) + "…"
            : s.location,
      }));
  }, [summary]);

  return (
    <div className="space-y-8" data-testid="overview-page">
      <Topbar
        title="Overview"
        subtitle="Group-wide performance across Kenya, Uganda, and Rwanda."
      />

      {loading && <Loading label="Aggregating metrics…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && overview && (
        <>
          {/* KPI ROW */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              testId="kpi-gross"
              tone="primary"
              label="Gross Sales"
              value={fmtMoney(overview.gross_sales)}
              sub={`${fmtNumber(overview.units_sold)} units sold`}
              icon={CurrencyDollar}
            />
            <KPICard
              testId="kpi-net"
              label="Net Sales"
              value={fmtMoney(overview.net_sales)}
              sub={`After ${fmtMoney(overview.discounts)} discounts`}
              icon={Tag}
            />
            <KPICard
              testId="kpi-orders"
              label="Orders"
              value={fmtNumber(overview.total_orders)}
              sub={`AOV ${fmtMoney(overview.avg_order_value)}`}
              icon={ShoppingCart}
            />
            <KPICard
              testId="kpi-discount"
              label="Discount Rate"
              value={fmtPct(overview.discount_rate)}
              sub={`${overview.active_locations} locations · ${overview.countries} countries`}
              icon={Percent}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card-surface p-6 lg:col-span-2" data-testid="chart-top-stores">
              <SectionTitle
                title="Top stores by net sales"
                subtitle="Ranked across the group"
                testId="section-top-stores"
              />
              <div style={{ width: "100%", height: 340 }}>
                <ResponsiveContainer>
                  <BarChart data={topStores} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E0D8" vertical={false} />
                    <XAxis
                      dataKey="label"
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={60}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis tickFormatter={(v) => fmtMoney(v)} />
                    <Tooltip
                      formatter={(v) => fmtMoney(v)}
                      labelFormatter={(l) => `Store: ${l}`}
                    />
                    <Bar dataKey="net_sales" fill="#C84B31" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card-surface p-6" data-testid="chart-country-split">
              <SectionTitle
                title="Country split"
                subtitle="Net sales by market"
                testId="section-country-split"
              />
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={byCountry}
                      dataKey="net_sales"
                      nameKey="country"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={3}
                    >
                      {byCountry.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmtMoney(v)} />
                    <Legend verticalAlign="bottom" height={24} iconType="circle" iconSize={8} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 divide-y divide-border text-sm">
                {byCountry.map((c) => (
                  <li
                    key={c.country}
                    className="flex items-center justify-between py-2"
                    data-testid={`country-row-${c.country}`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{COUNTRY_FLAGS[c.country] || "🌍"}</span>
                      <span className="font-medium">{c.country}</span>
                    </span>
                    <span className="font-display font-bold">{fmtMoney(c.net_sales)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Top products */}
          <div className="card-surface p-6" data-testid="section-top-products">
            <SectionTitle
              title="Top products by net sales"
              subtitle="Bestsellers across the group"
              action={
                <a
                  href="/sales"
                  className="text-primary text-sm font-medium flex items-center gap-1 hover:underline"
                  data-testid="link-all-sales"
                >
                  All sales <ArrowUpRight size={14} />
                </a>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="top-products-table">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="py-3 px-3 font-medium">#</th>
                    <th className="py-3 px-3 font-medium">Product</th>
                    <th className="py-3 px-3 font-medium">Brand</th>
                    <th className="py-3 px-3 font-medium">Type</th>
                    <th className="py-3 px-3 font-medium text-right">Units</th>
                    <th className="py-3 px-3 font-medium text-right">Net sales</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-3 px-3 text-muted-foreground">{i + 1}</td>
                      <td className="py-3 px-3 font-medium">{p.product_name}</td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-md bg-muted text-xs font-medium">
                          {p.brand || "—"}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-muted-foreground">{p.product_type || "—"}</td>
                      <td className="py-3 px-3 text-right font-medium">{fmtNumber(p.units_sold)}</td>
                      <td className="py-3 px-3 text-right font-display font-bold">{fmtMoney(p.net_sales)}</td>
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
