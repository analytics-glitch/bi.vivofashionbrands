import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import {
  api, fmtKES, fmtNum, fmtDec, fmtDate, buildParams, pctDelta, comparePeriod, COUNTRY_FLAGS,
} from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import {
  Users, UserPlus, ArrowsCounterClockwise, UserMinus, Coins, ShoppingCart, UserList, UserCircle,
} from "@phosphor-icons/react";
import {
  LineChart, Line, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip, Legend,
} from "recharts";

const DONUT_COLORS = ["#1a5c38", "#00c853", "#4b7bec"];
const ALL_COUNTRIES = ["Kenya", "Uganda", "Rwanda", "Online"];

const Customers = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode, dataVersion } = applied;
  const filters = { dateFrom, dateTo, countries, channels };

  const [cust, setCust] = useState(null);
  const [custPrev, setCustPrev] = useState(null);
  const [trend, setTrend] = useState([]);
  const [byCountry, setByCountry] = useState([]);
  const [churn, setChurn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = buildParams(filters);
    const prev = comparePeriod(dateFrom, dateTo, compareMode);

    const cToFetch = countries.length ? countries : ALL_COUNTRIES;
    const byCountryCalls = cToFetch.map((c) =>
      api.get("/customers", { params: { date_from: dateFrom, date_to: dateTo, country: c } })
        .then((r) => ({ country: c, ...r.data }))
    );

    Promise.all([
      api.get("/customers", { params: p }),
      api.get("/customer-trend", { params: { date_from: dateFrom, date_to: dateTo, country: countries.length === 1 ? countries[0] : undefined } }),
      prev ? api.get("/customers", { params: buildParams({ ...filters, dateFrom: prev.date_from, dateTo: prev.date_to }) }) : Promise.resolve(null),
      Promise.all(byCountryCalls),
      api.get("/analytics/churn", { params: p }),
    ])
      .then(([c, t, cp, bc, ch]) => {
        if (cancelled) return;
        setCust(c.data);
        setTrend(t.data || []);
        setCustPrev(cp?.data || null);
        setByCountry(bc);
        setChurn(ch?.data || null);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode, dataVersion]);

  const delta = (k, inv = false) =>
    cust && custPrev ? pctDelta(cust[k], custPrev[k]) : null;
  const compareLbl = compareMode === "last_month" ? "vs LM" : compareMode === "last_year" ? "vs LY" : null;

  // Period length in days → churn is only meaningful when selected period ≥ 90 days
  const periodDays = useMemo(() => {
    if (!dateFrom || !dateTo) return 0;
    const a = new Date(dateFrom);
    const b = new Date(dateTo);
    return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)) + 1);
  }, [dateFrom, dateTo]);
  const showChurn = periodDays >= 90 && churn && churn.applicable;
  const churnedCount = showChurn ? (churn.churned_customers || 0) : 0;
  const churnRate = showChurn ? (churn.churn_rate || 0) : 0;

  const donut = useMemo(() => {
    if (!cust) return [];
    if (!showChurn) {
      // < 3 months: only New vs Repeat
      return [
        { name: "New", value: cust.new_customers || 0 },
        { name: "Repeat", value: (cust.repeat_customers || 0) + (cust.returning_customers || 0) },
      ];
    }
    return [
      { name: "New", value: cust.new_customers || 0 },
      { name: "Repeat", value: cust.repeat_customers || 0 },
      { name: "Returning", value: cust.returning_customers || 0 },
    ];
  }, [cust, showChurn]);

  return (
    <div className="space-y-6" data-testid="customers-page">
      <div>
        <div className="eyebrow">Dashboard · Customers</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">Customers</h1>
        <p className="text-muted text-[13px] mt-0.5">Customer health & retention analytics</p>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && cust && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard testId="cu-kpi-total" accent label="Total Customers" value={fmtNum(cust.total_customers)} icon={Users}
              delta={delta("total_customers")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard testId="cu-kpi-new" label="New Customers" sub="First ever purchase this period" value={fmtNum(cust.new_customers)} icon={UserPlus}
              delta={delta("new_customers")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard testId="cu-kpi-repeat" label="Repeat Customers" sub="More than one order in period" value={fmtNum(cust.repeat_customers)} icon={ArrowsCounterClockwise}
              delta={delta("repeat_customers")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard testId="cu-kpi-returning" label="Returning Customers" sub="Bought before, one order in period" value={fmtNum(cust.returning_customers)} icon={UserCircle}
              delta={delta("returning_customers")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {showChurn && (
              <KPICard testId="cu-kpi-churn" small label="Churned Customers" sub="Bought in period, not in last 3 months" value={fmtNum(churnedCount)} icon={UserMinus}
                higherIsBetter={false} showDelta={false} />
            )}
            <KPICard testId="cu-kpi-spend" small label="Avg Spend / Customer" value={fmtKES(cust.avg_customer_spend)} icon={Coins}
              delta={delta("avg_customer_spend")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
            <KPICard testId="cu-kpi-opc" small label="Avg Orders / Customer" value={fmtDec(cust.avg_orders_per_customer, 2)} icon={ShoppingCart}
              delta={delta("avg_orders_per_customer")} deltaLabel={compareLbl} showDelta={compareMode !== "none"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card-white p-5" data-testid="customer-mix">
              <SectionTitle title="Customer mix" subtitle="New vs Repeat vs Returning" />
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={donut} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={3}>
                      {donut.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtNum(v)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card-white p-5 lg:col-span-2" data-testid="customer-trend-chart">
              <SectionTitle title="Daily: new vs returning" subtitle="Customer activity over the selected period" />
              {trend.length === 0 ? <Empty /> : (
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={trend} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }}
                        tickFormatter={(d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtNum(v)} labelFormatter={(l) => new Date(l).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} />
                      <Legend />
                      <Line type="monotone" dataKey="new_customers" stroke="#00c853" strokeWidth={2.5} dot={false} name="New" />
                      <Line type="monotone" dataKey="returning_customers" stroke="#1a5c38" strokeWidth={2.5} dot={false} name="Returning" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="card-white p-5" data-testid="customer-by-country">
            <SectionTitle title="Customers by country" subtitle="Total customer count by market" />
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={byCountry} margin={{ left: 10 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="country" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmtNum(v)} />
                  <Legend />
                  <Bar dataKey="new_customers" fill="#00c853" name="New" />
                  <Bar dataKey="returning_customers" fill="#1a5c38" name="Returning" />
                  <Bar dataKey="repeat_customers" fill="#4b7bec" name="Repeat" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {showChurn ? (
            <div className="card-white p-5 border-l-4 border-amber" data-testid="churn-box">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber/15 grid place-items-center">
                  <UserMinus size={22} className="text-amber" weight="duotone" />
                </div>
                <div>
                  <div className="eyebrow">Churn analysis</div>
                  <div className="mt-1 font-bold text-[22px] num">
                    {fmtNum(churnedCount)} churned of {fmtNum(churn.total_customers)}
                    <span className="ml-2 text-[14px] text-muted font-medium">
                      ({churnRate.toFixed(1)}% churn rate)
                    </span>
                  </div>
                  <p className="text-muted text-[13px] mt-1 max-w-2xl">
                    Of the <span className="font-semibold text-foreground">{fmtNum(churn.total_customers)}</span> customers who
                    shopped during this {Math.round(periodDays / 30)}-month period, <span className="font-semibold text-foreground">{fmtNum(churnedCount)}</span>{" "}
                    have <span className="font-semibold text-foreground">not returned</span> in the last 3 months of the period
                    ({fmtDate(churn.recent_from)} → {fmtDate(churn.recent_to)}). Consider a targeted win-back campaign.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="card-white p-5 border-l-4 border-brand/50" data-testid="churn-disabled-note">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-brand-soft grid place-items-center">
                  <UserMinus size={22} className="text-brand" weight="duotone" />
                </div>
                <div>
                  <div className="eyebrow">Churn analysis unavailable</div>
                  <p className="text-muted text-[13px] mt-1 max-w-2xl">
                    Selected period is {periodDays} day{periodDays === 1 ? "" : "s"} (less than 3 months), so churn cannot be
                    calculated meaningfully. Showing <span className="font-semibold text-foreground">new vs repeat</span> customers
                    only — extend the date range to 3+ months to surface churn.
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Customers;
