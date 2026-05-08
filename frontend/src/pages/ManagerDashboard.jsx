import React, { useEffect, useState } from "react";
import { api, daysAgo, today, formatKES, formatNumber, formatDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";

function KPI({ label, value, sub, testid }) {
  return (
    <div className="vivo-card p-6" data-testid={testid}>
      <div className="eyebrow">{label}</div>
      <div className="font-display text-3xl mt-3 font-mono-num">{value}</div>
      {sub && <div className="text-xs text-[var(--vivo-muted)] mt-2">{sub}</div>}
    </div>
  );
}

const NAVY = "#1F3864";
const GOLD = "#C9A961";

export default function ManagerDashboard() {
  const [period, setPeriod] = useState({ from: daysAgo(30), to: today() });
  const [kpis, setKpis] = useState(null);
  const [byCountry, setByCountry] = useState([]);
  const [byChannel, setByChannel] = useState([]);
  const [trend, setTrend] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [churned, setChurned] = useState([]);
  const [internal, setInternal] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = { date_from: period.from, date_to: period.to };
        const [k, c, s, t, tc, ch, mgr] = await Promise.all([
          api.get("/bi/kpis", { params }),
          api.get("/bi/country-summary", { params }),
          api.get("/bi/sales-summary", { params }),
          api.get("/bi/daily-trend", { params }),
          api.get("/bi/top-customers", { params: { ...params, limit: 10 } }),
          api.get("/bi/churned-customers", { params: { days: 90, limit: 10 } }),
          api.get("/dashboard/manager"),
        ]);
        setKpis(k.data);
        setByCountry(c.data || []);
        setByChannel((s.data || []).slice(0, 12));
        setTrend(t.data || []);
        setTopCustomers(tc.data || []);
        setChurned(ch.data || []);
        setInternal(mgr.data);
      } finally {
        setLoading(false);
      }
    })();
  }, [period]);

  const setRange = (days) => setPeriod({ from: daysAgo(days), to: today() });

  return (
    <div className="p-6 md:p-10 max-w-[1500px] mx-auto" data-testid="manager-dashboard-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="eyebrow">Insights</div>
          <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Manager studio</h1>
          <div className="gold-rule mt-4" />
        </div>
        <div className="flex bg-white border border-[var(--vivo-border)] rounded-sm overflow-hidden" data-testid="period-toggle">
          {[
            [7, "7d"],
            [30, "30d"],
            [90, "90d"],
          ].map(([d, l]) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`h-11 px-4 text-sm ${period.from === daysAgo(d) ? "bg-[var(--vivo-navy)] text-white" : "text-[var(--vivo-muted)]"}`}
              data-testid={`period-${d}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8">
        <KPI label="Net sales" value={loading ? "—" : formatKES(kpis?.net_sales)} testid="manager-kpi-sales" />
        <KPI label="Orders" value={loading ? "—" : formatNumber(kpis?.total_orders)} />
        <KPI label="Avg basket" value={loading ? "—" : formatKES(kpis?.avg_basket_size)} />
        <KPI label="Return rate" value={loading ? "—" : `${(kpis?.return_rate || 0).toFixed(1)}%`} />
      </div>

      <Tabs defaultValue="sales" className="mt-10">
        <TabsList className="bg-transparent border-b border-[var(--vivo-border)] w-full justify-start rounded-none h-auto p-0 gap-6">
          {[
            ["sales", "Sales"],
            ["customers", "Customers"],
            ["associates", "Associates"],
          ].map(([v, l]) => (
            <TabsTrigger
              key={v}
              value={v}
              data-testid={`manager-tab-${v}`}
              className="relative h-12 px-1 rounded-none data-[state=active]:bg-transparent data-[state=active]:text-[var(--vivo-navy)] data-[state=active]:shadow-none data-[state=active]:font-semibold data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-[2px] data-[state=active]:after:bg-[var(--vivo-gold)] text-[var(--vivo-muted)]"
            >
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="sales" className="mt-6 space-y-6">
          <Card className="vivo-card p-6 rounded-sm" data-testid="manager-chart-revenue">
            <h3 className="font-display text-xl mb-4">Daily net sales</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#6B7280" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="net_sales" stroke={NAVY} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="orders" stroke={GOLD} strokeWidth={2} dot={false} yAxisId="r" />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "#6B7280" }} />
                  <Legend />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="vivo-card p-6 rounded-sm">
              <h3 className="font-display text-xl mb-4">By country</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byCountry}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="country" tick={{ fontSize: 12, fill: "#6B7280" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
                    <Tooltip />
                    <Bar dataKey="net_sales" fill={NAVY} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="vivo-card p-6 rounded-sm">
              <h3 className="font-display text-xl mb-4">Top stores</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byChannel} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#6B7280" }} />
                    <YAxis type="category" dataKey="channel" tick={{ fontSize: 11, fill: "#6B7280" }} width={120} />
                    <Tooltip />
                    <Bar dataKey="net_sales" fill={GOLD} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="customers" className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-xl">Top customers</h3>
            <div className="vivo-divider my-3" />
            <ul className="divide-y divide-[var(--vivo-border)]" data-testid="manager-top-customers">
              {topCustomers.map((c) => (
                <li key={c.customer_id} className="py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.customer_name}</div>
                    <div className="text-xs text-[var(--vivo-muted)]">{c.total_orders} orders · last {formatDate(c.last_purchase_date)}</div>
                  </div>
                  <div className="font-mono-num text-sm">{formatKES(c.total_sales)}</div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-xl">Reactivation list (90d+ silent)</h3>
            <div className="vivo-divider my-3" />
            <ul className="divide-y divide-[var(--vivo-border)]" data-testid="manager-churned">
              {churned.map((c) => (
                <li key={c.customer_id} className="py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.customer_name}</div>
                    <div className="text-xs text-[var(--vivo-muted)]">{c.days_since_last_purchase}d · last {formatDate(c.last_purchase_date)}</div>
                  </div>
                  <div className="font-mono-num text-sm">{formatKES(c.lifetime_spend)}</div>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>

        <TabsContent value="associates" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <KPI label="Associates" value={formatNumber(internal?.totals?.associates || 0)} testid="manager-kpi-associates" />
            <KPI label="Messages · 7d" value={formatNumber(internal?.totals?.messages_week || 0)} />
            <KPI label="Lookbooks · 7d" value={formatNumber(internal?.totals?.lookbooks_week || 0)} />
            <KPI label="Open follow-ups" value={formatNumber(internal?.totals?.open_tasks || 0)} />
          </div>

          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-xl">By associate · 7d</h3>
            <div className="vivo-divider my-3" />
            {(internal?.by_associate || []).length === 0 ? (
              <div className="text-sm text-[var(--vivo-muted)]">No clienteling activity in the last 7 days yet.</div>
            ) : (
              <table className="w-full text-sm" data-testid="manager-by-associate">
                <thead className="text-left text-[var(--vivo-muted)] uppercase text-xs tracking-wider">
                  <tr><th className="py-2">Associate</th><th>Messages</th><th>Customers</th></tr>
                </thead>
                <tbody>
                  {(internal?.by_associate || []).map((a, i) => (
                    <tr key={i} className="border-t border-[var(--vivo-border)]">
                      <td className="py-3">{a.associate}</td>
                      <td className="font-mono-num">{a.messages}</td>
                      <td className="font-mono-num">{a.customers_contacted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <p className="mt-8 text-xs text-[var(--vivo-muted)]">
        Data window: {formatDate(period.from)} → {formatDate(period.to)} · Source: Vivo BI API
      </p>
    </div>
  );
}
