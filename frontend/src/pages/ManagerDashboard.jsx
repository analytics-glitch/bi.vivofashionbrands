import React, { useEffect, useMemo, useState } from "react";
import { api, daysAgo, today, mtdStart, ytdStart, prevMonthRange, formatKES, formatNumber, formatDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, Facebook, Link as LinkIcon, RefreshCw, Trash2, ExternalLink, Instagram, Twitter, Music2, Ghost } from "lucide-react";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { CohortsTab, OperationsTab } from "./InsightsTabs";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useDateRange } from "@/contexts/DateRangeContext";

function KPI({ label, value, sub, delta, deltaInverted, testid }) {
  // delta is a percentage. `deltaInverted` flips colors (e.g., for return rate where lower is better).
  const showDelta = delta !== null && delta !== undefined && !Number.isNaN(delta);
  const positive = deltaInverted ? delta < 0 : delta > 0;
  const negative = deltaInverted ? delta > 0 : delta < 0;
  const cls = positive ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
              negative ? "text-red-700 bg-red-50 border-red-200" :
              "text-[var(--vivo-muted)] bg-[var(--vivo-bg)] border-[var(--vivo-border)]";
  const arrow = positive ? "▲" : negative ? "▼" : "•";
  return (
    <div className="vivo-card p-6" data-testid={testid}>
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow">{label}</div>
        {showDelta && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${cls}`} data-testid={testid ? `${testid}-delta` : undefined}>
            {arrow} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="font-display text-3xl mt-3 font-mono-num">{value}</div>
      {sub && <div className="text-xs text-[var(--vivo-muted)] mt-2">{sub}</div>}
    </div>
  );
}

function AttributionCard() {
  const [data, setData] = React.useState(null);
  const [days, setDays] = React.useState(30);
  React.useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/dashboard/attribution", { params: { days } });
        setData(r.data);
      } catch {
        /* ignore */
      }
    })();
  }, [days]);

  if (!data) return null;

  return (
    <Card className="vivo-card p-6 rounded-xl border-l-4 border-l-[var(--vivo-gold)]" data-testid="attribution-card">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow">Pilot KPI</div>
          <h3 className="font-display text-xl mt-1">Clienteling-driven revenue</h3>
          <p className="text-sm text-[var(--vivo-muted)] max-w-xl mt-1">{data.method}</p>
        </div>
        <div className="flex bg-white border border-[var(--vivo-border)] rounded-md overflow-hidden">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`h-9 px-3 text-xs ${days === d ? "bg-[var(--vivo-navy)] text-white" : "text-[var(--vivo-muted)]"}`} data-testid={`attr-period-${d}`}>{d}d</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
        <KPI label="Messaged" value={formatNumber(data.messaged_customers)} testid="attr-messaged" />
        <KPI label="Purchased" value={formatNumber(data.purchased_within_window)} sub={`${data.conversion_rate}% conversion`} testid="attr-purchased" />
        <KPI label="Est. revenue" value={formatKES(data.estimated_revenue_kes)} testid="attr-revenue" />
        <KPI label="Window" value={`${data.window_days}d`} />
      </div>
      {(data.by_associate || []).length > 0 && (
        <div className="mt-6">
          <div className="vivo-divider mb-3" />
          <table className="w-full text-sm" data-testid="attr-by-associate">
            <thead className="text-left text-[var(--vivo-muted)] uppercase text-xs tracking-wider">
              <tr><th className="py-2">Associate</th><th>Msgs</th><th>Reached</th><th>Bought</th><th className="text-right">Conversion</th></tr>
            </thead>
            <tbody>
              {data.by_associate.map((a, i) => (
                <tr key={i} className="border-t border-[var(--vivo-border)]">
                  <td className="py-3">{a.associate}</td>
                  <td className="font-mono-num">{a.messages}</td>
                  <td className="font-mono-num">{a.customers_contacted}</td>
                  <td className="font-mono-num">{a.customers_purchased}</td>
                  <td className="text-right font-mono-num">{a.conversion_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const NAVY = "#1F3864";
const GOLD = "#C9A961";

export default function ManagerDashboard() {
  const { range: gRange, setRange: setGRange, compare, compareOn } = useDateRange();
  // Keep a local period (which holds {from,to,label}) but sync it with the global range.
  const [period, setPeriod] = useState(() => ({ from: gRange.from, to: gRange.to, label: gRange.label || "Custom" }));

  // When the global range changes (eg. user picks a different range on Overview), reflect here.
  useEffect(() => {
    setPeriod({ from: gRange.from, to: gRange.to, label: gRange.label || "Custom" });
  }, [gRange.from, gRange.to, gRange.label]);

  // When user changes the picker here, push the change up to the global context.
  const updatePeriod = (next) => {
    setPeriod(next);
    setGRange({ from: next.from, to: next.to, label: next.label });
  };
  const [kpis, setKpis] = useState(null);
  const [byCountry, setByCountry] = useState([]);
  const [byChannel, setByChannel] = useState([]);
  const [trend, setTrend] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [churned, setChurned] = useState([]);
  const [internal, setInternal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [compareKpis, setCompareKpis] = useState(null);

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

  // Compare-period KPIs (only when compareOn is enabled).
  useEffect(() => {
    if (!compareOn || !compare?.from || !compare?.to) {
      setCompareKpis(null);
      return;
    }
    (async () => {
      try {
        const params = { date_from: compare.from, date_to: compare.to };
        const r = await api.get("/bi/kpis", { params });
        setCompareKpis(r.data);
      } catch { setCompareKpis(null); }
    })();
  }, [compareOn, compare?.from, compare?.to]);

  // Helpers to compute delta % between current and compare KPIs.
  const deltaPct = (cur, prev) => {
    if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
    const p = Number(prev);
    if (!p) return null;
    return ((Number(cur) - p) / Math.abs(p)) * 100;
  };
  const k_delta = {
    net_sales: deltaPct(kpis?.net_sales, compareKpis?.net_sales),
    total_orders: deltaPct(kpis?.total_orders, compareKpis?.total_orders),
    avg_basket: deltaPct(kpis?.avg_basket_size, compareKpis?.avg_basket_size),
    return_rate: deltaPct(kpis?.return_rate, compareKpis?.return_rate),
  };

  const setRange = (key) => {
    if (key === "MTD") updatePeriod({ from: mtdStart(), to: today(), label: "MTD" });
    else if (key === "YTD") updatePeriod({ from: ytdStart(), to: today(), label: "YTD" });
    else if (key === "LASTM") updatePeriod({ ...prevMonthRange(), label: "Last month" });
    else if (typeof key === "number") updatePeriod({ from: daysAgo(key), to: today(), label: `${key}d` });
  };

  return (
    <div className="p-6 md:p-10 max-w-[1500px] mx-auto" data-testid="manager-dashboard-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="eyebrow">Insights</div>
          <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Manager CRM</h1>
          <div className="gold-rule mt-4" />
          <div className="text-xs text-[var(--vivo-muted)] mt-3" data-testid="period-source">
            Source: BI <code className="text-[var(--vivo-text)]">{period.from} → {period.to}</code> · Africa/Nairobi
          </div>
        </div>
        <div className="flex items-center gap-3" data-testid="period-toolbar">
          <DateRangePicker
            testid="manager-date-range"
            value={{ from: period.from, to: period.to }}
            onChange={({ from, to, label }) => updatePeriod({ from, to, label })}
            defaultPreset="mtd"
            align="end"
          />
          <div className="flex bg-white border border-[var(--vivo-border)] rounded-sm overflow-hidden" data-testid="period-toggle">
            {[
              ["MTD", "MTD"],
              ["LASTM", "Last month"],
              ["YTD", "YTD"],
              [7, "7d"],
              [30, "30d"],
              [90, "90d"],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={`h-10 px-3 text-xs ${period.label === l ? "bg-[var(--vivo-navy)] text-white" : "text-[var(--vivo-muted)]"}`}
                data-testid={`period-${k}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8">
        <KPI label={`Net sales · ${period.label}`} value={loading ? "—" : formatKES(kpis?.net_sales)} delta={k_delta.net_sales} testid="manager-kpi-sales" />
        <KPI label="Orders" value={loading ? "—" : formatNumber(kpis?.total_orders)} delta={k_delta.total_orders} />
        <KPI label="Avg basket" value={loading ? "—" : formatKES(kpis?.avg_basket_size)} delta={k_delta.avg_basket} />
        <KPI label="Return rate" value={loading ? "—" : `${(kpis?.return_rate || 0).toFixed(1)}%`} delta={k_delta.return_rate} deltaInverted />
      </div>

      <Tabs defaultValue="sales" className="mt-10">
        <TabsList className="bg-transparent border-b border-[var(--vivo-border)] w-full justify-start rounded-none h-auto p-0 gap-6 flex-wrap">
          {[
            ["sales", "Sales"],
            ["customers", "Customers"],
            ["associates", "Associates"],
            ["cohorts", "Cohorts"],
            ["operations", "Operations"],
            ["social", "Social"],
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
            <KPI label="Messages · 7d" value={formatNumber(internal?.totals?.messages_week || 0)} delta={internal?.totals?.messages_delta_pct} />
            <KPI label="Lookbooks · 7d" value={formatNumber(internal?.totals?.lookbooks_week || 0)} delta={internal?.totals?.lookbooks_delta_pct} />
            <KPI label="Open follow-ups" value={formatNumber(internal?.totals?.open_tasks || 0)} />
          </div>

          <AttributionCard />

          <Card className="vivo-card p-6 rounded-sm mt-6">
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

        <TabsContent value="cohorts" className="mt-6">
          <CohortsTab />
        </TabsContent>

        <TabsContent value="operations" className="mt-6">
          <OperationsTab />
        </TabsContent>

        <TabsContent value="social" className="mt-6">
          <SocialTab period={period} />
        </TabsContent>
      </Tabs>

      <p className="mt-8 text-xs text-[var(--vivo-muted)]">
        Data window: {formatDate(period.from)} → {formatDate(period.to)} · Source: Vivo BI API
      </p>
    </div>
  );
}

/* eslint-disable react/no-unused-prop-types */
function SocialTab({ period }) {
  const [summary, setSummary] = useState(null);
  const [posts, setPosts] = useState([]);
  const [mentions, setMentions] = useState([]);
  const [influencers, setInfluencers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoKpi, setAutoKpi] = useState(null);
  const [autoTasks, setAutoTasks] = useState([]);
  const [autoBusy, setAutoBusy] = useState(false);

  const loadAuto = async () => {
    try {
      const [k, t] = await Promise.all([
        api.get("/social/auto-tasks/kpi"),
        api.get("/social/auto-tasks", { params: { include_completed: true, limit: 12 } }),
      ]);
      setAutoKpi(k.data);
      setAutoTasks(t.data || []);
    } catch {
      /* manager-only; ignore for non-managers */
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const params = { date_from: period.from, date_to: period.to };
      try {
        const [s, p, m, inf] = await Promise.all([
          api.get("/social/summary", { params }),
          api.get("/social/posts", { params: { ...params, limit: 6 } }),
          api.get("/social/mentions", { params: { ...params, limit: 8 } }),
          api.get("/social/influencers", { params: { ...params, limit: 8 } }),
        ]);
        setSummary(s.data);
        setPosts(p.data || []);
        setMentions(m.data || []);
        setInfluencers(inf.data || []);
        await loadAuto();
      } finally {
        setLoading(false);
      }
    })();
  }, [period]);

  const runAutoTasks = async () => {
    setAutoBusy(true);
    try {
      const r = await api.post("/social/auto-tasks/run");
      if (r.data?.already_run) {
        toast.info(`Already run for week of ${r.data.week_start}`);
      } else {
        toast.success(`Created ${r.data.tasks_created} task${r.data.tasks_created === 1 ? "" : "s"} across ${r.data.themes?.length || 0} themes`);
      }
      await loadAuto();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not run");
    } finally {
      setAutoBusy(false);
    }
  };

  const completeTask = async (taskId) => {
    await api.post(`/tasks/${taskId}/complete`);
    toast.success("Marked done");
    loadAuto();
  };

  const sentimentChartData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Positive", value: summary.sentiment.positive, fill: "#10B981" },
      { name: "Neutral", value: summary.sentiment.neutral, fill: "#94A3B8" },
      { name: "Negative", value: summary.sentiment.negative, fill: "#EF4444" },
    ];
  }, [summary]);

  const platformChartData = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.by_platform || {}).map(([k, v]) => ({
      platform: k,
      positive: v.positive,
      neutral: v.neutral,
      negative: v.negative,
    }));
  }, [summary]);

  return (
    <div className="space-y-6">
      <FacebookConnectCard />
      <SocialPlatformsCard />

      {/* Quality auto-tasks strip */}
      <Card className="vivo-card p-6 rounded-sm border-l-4 border-l-[var(--vivo-gold)]" data-testid="quality-strip">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow">Quality · auto-tasks</div>
            <h3 className="font-display text-xl mt-1">Closed-loop feedback</h3>
            <p className="text-sm text-[var(--vivo-muted)] mt-1 max-w-xl">
              Every Monday we cluster negative feedback by theme and create one follow-up per theme on every manager.
              Resolution time = the headline pilot KPI.
            </p>
          </div>
          <Button onClick={runAutoTasks} disabled={autoBusy} className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white h-11" data-testid="auto-tasks-run">
            <Sparkles className="mr-2 h-4 w-4" /> {autoBusy ? "Working…" : "Run now"}
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          <KPI label="Open auto-tasks" value={formatNumber(autoKpi?.open || 0)} testid="auto-kpi-open" />
          <KPI label="Completed · 14d" value={formatNumber(autoKpi?.completed_14d || 0)} />
          <KPI label="Median resolution" value={autoKpi?.median_resolution_hours == null ? "—" : `${autoKpi.median_resolution_hours.toFixed(1)}h`} testid="auto-kpi-median" />
          <KPI label="Negative · 7d" value={formatNumber(autoKpi?.negative_feedback_7d || 0)} sub={`${autoKpi?.tasks_created_7d || 0} tasks created`} />
        </div>
        {autoTasks.length > 0 && (
          <div className="mt-6">
            <div className="vivo-divider mb-4" />
            <ul className="divide-y divide-[var(--vivo-border)]" data-testid="auto-tasks-list">
              {autoTasks.map((t) => (
                <li key={t.task_id} className="py-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${t.completed ? "line-through text-[var(--vivo-muted)]" : "font-medium"}`}>{t.title}</div>
                    <div className="text-xs text-[var(--vivo-muted)] mt-1 flex flex-wrap gap-2 items-center">
                      <Badge variant="outline" className="rounded-sm text-[10px]">{t.auto_theme}</Badge>
                      <span>· {t.auto_platforms?.join(", ")}</span>
                      <span>· week of {t.auto_week_start}</span>
                      <span>· assigned to {t.assignee_name}</span>
                    </div>
                  </div>
                  {t.completed ? (
                    <Badge variant="secondary" className="rounded-sm">Done {formatDate(t.completed_at)}</Badge>
                  ) : (
                    <Button onClick={() => completeTask(t.task_id)} variant="outline" className="rounded-sm" data-testid={`auto-task-complete-${t.task_id}`}>
                      Mark resolved
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Feedback" value={loading ? "—" : formatNumber(summary?.totals?.feedback || 0)} sub={`${summary?.totals?.unmatched || 0} unmatched`} testid="social-kpi-feedback" />
        <KPI label="Reach (owned posts)" value={loading ? "—" : formatNumber(summary?.engagement?.reach || 0)} testid="social-kpi-reach" />
        <KPI label="Likes (owned posts)" value={loading ? "—" : formatNumber(summary?.engagement?.likes || 0)} />
        <KPI label="Posts" value={loading ? "—" : formatNumber(summary?.totals?.posts || 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="vivo-card p-6 rounded-sm" data-testid="social-sentiment-chart">
          <h3 className="font-display text-xl mb-4">Sentiment</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sentimentChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#6B7280" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
                <Tooltip />
                <Bar dataKey="value" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="vivo-card p-6 rounded-sm">
          <h3 className="font-display text-xl mb-4">By platform</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={platformChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="platform" tick={{ fontSize: 11, fill: "#6B7280" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="positive" stackId="a" fill="#10B981" />
                <Bar dataKey="neutral" stackId="a" fill="#94A3B8" />
                <Bar dataKey="negative" stackId="a" fill="#EF4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="vivo-card p-6 rounded-sm">
        <h3 className="font-display text-xl mb-4">Top themes</h3>
        <div className="flex flex-wrap gap-2">
          {(summary?.top_themes || []).map((t) => (
            <span key={t.theme} className="px-3 py-1 border border-[var(--vivo-border)] rounded-sm text-sm bg-white">
              {t.theme} <span className="text-[var(--vivo-muted)] ml-1 font-mono-num">{t.count}</span>
            </span>
          ))}
          {(summary?.top_themes || []).length === 0 && <span className="text-sm text-[var(--vivo-muted)]">Classifier hasn't run yet — try the Inbox page.</span>}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="vivo-card p-6 rounded-sm">
          <h3 className="font-display text-xl mb-4">Top owned posts</h3>
          <ul className="divide-y divide-[var(--vivo-border)]" data-testid="social-top-posts">
            {posts.map((p) => (
              <li key={p.post_id} className="py-3 flex items-start gap-3">
                {p.image_url && <img src={p.image_url} alt="" className="h-14 w-14 object-cover rounded-sm" />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase tracking-wider text-[var(--vivo-muted)]">{p.platform} · {formatDate(p.posted_at)}</div>
                  <p className="text-sm mt-1 line-clamp-2">{p.body}</p>
                  <div className="text-xs text-[var(--vivo-muted)] mt-1 font-mono-num">
                    {formatNumber(p.likes)} likes · {formatNumber(p.comments_count)} comments · {formatNumber(p.reach)} reach
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="vivo-card p-6 rounded-sm">
          <h3 className="font-display text-xl mb-4">Influencers & advocates</h3>
          <ul className="divide-y divide-[var(--vivo-border)]" data-testid="social-influencers">
            {influencers.map((i) => (
              <li key={i.handle} className="py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-medium truncate">{i.name}</div>
                  <div className="text-xs text-[var(--vivo-muted)]">{i.handle} · {i.platforms?.join(", ")}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-mono-num">{i.engagement} eng.</div>
                  <div className="text-[var(--vivo-muted)]">{i.feedback_count} mentions</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="vivo-card p-6 rounded-sm">
        <h3 className="font-display text-xl mb-4">Recent mentions</h3>
        <ul className="divide-y divide-[var(--vivo-border)]" data-testid="social-mentions">
          {mentions.map((m) => (
            <li key={m.feedback_id} className="py-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{m.author_name} <span className="text-[var(--vivo-muted)] font-normal">{m.author_handle}</span></div>
                <div className="text-xs text-[var(--vivo-muted)]">{m.platform} · {formatDate(m.posted_at)}</div>
              </div>
              <p className="text-sm mt-1">{m.body}</p>
            </li>
          ))}
          {mentions.length === 0 && <li className="text-sm text-[var(--vivo-muted)]">No public mentions in this window.</li>}
        </ul>
      </Card>
    </div>
  );
}


function FacebookConnectCard() {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const refresh = async () => {
    try {
      const r = await api.get("/social/facebook/status");
      setStatus(r.data);
    } catch {
      /* manager-only; ignore */
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const discover = async () => {
    if (!token.trim()) {
      toast.error("Paste a User Access Token first");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/social/facebook/discover", { user_access_token: token.trim() });
      toast.success(`Linked ${r.data.discovered} Page${r.data.discovered === 1 ? "" : "s"}`);
      setToken("");
      setOpen(false);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not discover pages");
    } finally {
      setBusy(false);
    }
  };

  const sync = async (page_id) => {
    setBusy(true);
    setSyncResult(null);
    try {
      const r = await api.post("/social/facebook/sync", page_id ? { page_id } : {});
      setSyncResult(r.data);
      const total = (r.data.posts || 0) + (r.data.comments || 0) + (r.data.reviews || 0);
      toast.success(`Pulled ${total} item${total === 1 ? "" : "s"} from ${r.data.pages_synced} page${r.data.pages_synced === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const removePage = async (page_id) => {
    if (!confirm("Remove this Page link? You can re-discover it later.")) return;
    try {
      await api.delete(`/social/facebook/pages/${page_id}`);
      toast.success("Page unlinked");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not unlink");
    }
  };

  if (!status) return null;
  const ready = status.ready_to_sync;

  return (
    <Card className="vivo-card p-6 rounded-sm border-l-4 border-l-[#1877F2]" data-testid="facebook-connect-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-10 w-10 rounded-sm bg-[#1877F2] text-white flex items-center justify-center shrink-0">
            <Facebook className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="eyebrow">Facebook · live data</div>
            <h3 className="font-display text-xl mt-1">
              {ready ? `${(status.discovered_pages || []).length} Page${(status.discovered_pages || []).length === 1 ? "" : "s"} linked` : "Connect a Facebook Page"}
            </h3>
            <p className="text-sm text-[var(--vivo-muted)] mt-1 max-w-xl">
              {ready
                ? "Real Facebook posts, comments and reviews flow into the inbox + classifier when you sync."
                : "Paste a Facebook User Access Token (with Page admin scopes) and we'll auto-discover every Page you manage."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {ready && (
            <Button onClick={() => sync()} disabled={busy} className="rounded-sm bg-[#1877F2] hover:bg-[#1565d8] text-white h-11" data-testid="fb-sync-all">
              <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Syncing…" : "Sync now"}
            </Button>
          )}
          <Button onClick={() => setOpen((o) => !o)} variant="outline" className="rounded-sm h-11" data-testid="fb-connect-toggle">
            <LinkIcon className="mr-2 h-4 w-4" /> {open ? "Cancel" : ready ? "Add another" : "Connect"}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-5 p-4 bg-white border border-[var(--vivo-border)] rounded-sm space-y-3" data-testid="fb-connect-form">
          <div className="text-sm">
            <div className="font-medium mb-1">How to get a User Access Token</div>
            <ol className="text-[var(--vivo-muted)] list-decimal pl-5 space-y-1">
              <li>Open Graph API Explorer: <a className="text-[var(--vivo-navy)] underline inline-flex items-center gap-1" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">developers.facebook.com/tools/explorer <ExternalLink className="h-3 w-3" /></a></li>
              <li>Pick the Vivo App, then click <strong>Generate Access Token</strong>.</li>
              <li>Tick the scopes: <code className="text-xs bg-zinc-100 px-1.5 py-0.5 rounded">pages_show_list</code>, <code className="text-xs bg-zinc-100 px-1.5 py-0.5 rounded">pages_read_engagement</code>, <code className="text-xs bg-zinc-100 px-1.5 py-0.5 rounded">pages_read_user_generated_content</code>.</li>
              <li>Copy the token and paste below.</li>
            </ol>
          </div>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAAB... (paste User Access Token here)"
            rows={3}
            className="w-full text-xs font-mono border border-[var(--vivo-border)] rounded-sm p-3 bg-[var(--vivo-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--vivo-navy)]"
            data-testid="fb-token-input"
          />
          <div className="flex justify-end">
            <Button onClick={discover} disabled={busy || !token.trim()} className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white" data-testid="fb-discover-submit">
              {busy ? "Discovering…" : "Discover Pages"}
            </Button>
          </div>
        </div>
      )}

      {(status.discovered_pages || []).length > 0 && (
        <div className="mt-5">
          <div className="vivo-divider mb-3" />
          <ul className="divide-y divide-[var(--vivo-border)]" data-testid="fb-pages-list">
            {status.discovered_pages.map((p) => (
              <li key={p.page_id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.page_name || p.page_id}</div>
                  <div className="text-xs text-[var(--vivo-muted)]">{p.category || "Page"} · linked by {p.linked_by_name} · {formatDate(p.linked_at)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button onClick={() => sync(p.page_id)} disabled={busy} variant="outline" className="rounded-sm h-9" data-testid={`fb-sync-${p.page_id}`}>
                    <RefreshCw className={`mr-1.5 h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Sync
                  </Button>
                  <button onClick={() => removePage(p.page_id)} className="text-[var(--vivo-muted)] hover:text-red-600 p-2" title="Unlink" data-testid={`fb-remove-${p.page_id}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {syncResult && (
        <div className="mt-4 p-3 bg-[var(--vivo-bg)] border border-[var(--vivo-border)] rounded-sm text-xs" data-testid="fb-sync-result">
          <div className="font-medium mb-1">Last sync · {syncResult.pages_synced} page{syncResult.pages_synced === 1 ? "" : "s"}</div>
          <div className="text-[var(--vivo-muted)] flex flex-wrap gap-3">
            <span>{syncResult.posts || 0} posts</span>
            <span>{syncResult.comments || 0} comments</span>
            <span>{syncResult.reviews || 0} reviews</span>
            {(syncResult.errors || []).length > 0 && (
              <span className="text-red-600">{syncResult.errors.length} error{syncResult.errors.length === 1 ? "" : "s"}</span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

const PLATFORM_STYLE = {
  instagram: { Icon: Instagram, color: "#E1306C", brand: "Instagram" },
  x: { Icon: Twitter, color: "#0F172A", brand: "X (Twitter)" },
  tiktok: { Icon: Music2, color: "#010101", brand: "TikTok" },
  snapchat: { Icon: Ghost, color: "#FFFC00", brand: "Snapchat", textColor: "#0F172A" },
};

function SocialPlatformsCard() {
  const [platforms, setPlatforms] = React.useState([]);
  const [active, setActive] = React.useState(null); // { platform, label, token_hint, docs_url }
  const [token, setToken] = React.useState("");
  const [handle, setHandle] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const refresh = async () => {
    try {
      const r = await api.get("/social/platforms/status");
      setPlatforms(r.data || []);
    } catch { /* manager-only */ }
  };

  React.useEffect(() => { refresh(); }, []);

  const connect = async () => {
    if (!active || !token.trim()) {
      toast.error("Paste a token first");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/social/platforms/${active.platform}/connect`, {
        access_token: token.trim(),
        handle: handle.trim(),
      });
      toast.success(`${active.label} connected`);
      setActive(null);
      setToken("");
      setHandle("");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Connect failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (platform, label) => {
    if (!confirm(`Disconnect ${label}? Stored token will be removed.`)) return;
    try {
      await api.delete(`/social/platforms/${platform}`);
      toast.success(`${label} disconnected`);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Disconnect failed");
    }
  };

  return (
    <Card className="vivo-card p-6 rounded-sm border-l-4 border-l-[var(--vivo-gold)]" data-testid="social-platforms-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">More channels</div>
          <h3 className="font-display text-xl mt-1">Connect Instagram, X, TikTok, Snapchat</h3>
          <p className="text-sm text-[var(--vivo-muted)] mt-1 max-w-xl">
            Store your platform tokens now — sync mappers ship next release.
            Tokens are kept server-side and never rendered back to the UI.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-5" data-testid="social-platforms-grid">
        {platforms.map((p) => {
          const meta = PLATFORM_STYLE[p.platform] || { Icon: LinkIcon, color: "var(--vivo-navy)", brand: p.label };
          const Icon = meta.Icon;
          return (
            <div key={p.platform} className="border border-[var(--vivo-border)] bg-white rounded-sm p-4 flex flex-col gap-3" data-testid={`platform-tile-${p.platform}`}>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-sm flex items-center justify-center shrink-0" style={{ backgroundColor: meta.color, color: meta.textColor || "#fff" }}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="font-medium text-sm truncate">{p.label}</div>
                {p.connected && <Badge variant="secondary" className="rounded-sm ml-auto">Connected</Badge>}
              </div>
              {p.connected ? (
                <div className="text-xs text-[var(--vivo-muted)]">
                  {p.handle ? <div className="truncate">@{p.handle.replace(/^@/, "")}</div> : null}
                  <div>Connected {formatDate(p.connected_at)} by {p.connected_by}</div>
                </div>
              ) : (
                <div className="text-xs text-[var(--vivo-muted)] line-clamp-3">{p.token_hint}</div>
              )}
              <div className="flex gap-2 mt-auto">
                <Button
                  onClick={() => {
                    setActive(p);
                    setToken("");
                    setHandle(p.handle || "");
                  }}
                  variant="outline"
                  className="rounded-sm h-9 flex-1"
                  data-testid={`platform-connect-${p.platform}`}
                >
                  <LinkIcon className="mr-1.5 h-3.5 w-3.5" /> {p.connected ? "Re-connect" : "Connect"}
                </Button>
                {p.connected && (
                  <button
                    onClick={() => disconnect(p.platform, p.label)}
                    className="text-[var(--vivo-muted)] hover:text-red-600 p-2"
                    data-testid={`platform-disconnect-${p.platform}`}
                    aria-label="Disconnect"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!active} onOpenChange={(v) => { if (!v) { setActive(null); setToken(""); setHandle(""); } }}>
        <DialogContent className="rounded-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Connect {active?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-[var(--vivo-muted)]">{active?.token_hint}</div>
            <div>
              <a href={active?.docs_url} target="_blank" rel="noreferrer" className="text-[var(--vivo-navy)] text-sm hover:underline inline-flex items-center gap-1">
                Docs <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div>
              <label className="text-xs text-[var(--vivo-muted)]">Access token</label>
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste long-lived access token"
                className="h-11 mt-1 rounded-sm font-mono text-xs"
                data-testid="platform-token-input"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--vivo-muted)]">Handle (optional)</label>
              <Input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@vivofashion"
                className="h-11 mt-1 rounded-sm"
                data-testid="platform-handle-input"
              />
            </div>
            <p className="text-xs text-[var(--vivo-muted)]">
              Scopes: <code className="text-[10px] bg-zinc-100 px-1 rounded">{active?.scopes}</code>
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button
              onClick={connect}
              disabled={busy || !token.trim()}
              className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white"
              data-testid="platform-connect-submit"
            >
              {busy ? "Saving…" : "Save token"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

