import React, { useEffect, useState } from "react";
import { api, formatKES, formatNumber, formatDate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RfmBadge } from "@/components/RfmBadge";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useDateRange } from "@/contexts/DateRangeContext";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, Users, UserPlus, AlertTriangle, Sparkles,
  Heart, MessageSquare, Repeat, ShieldAlert, Target,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts";

const TIER_COLORS = {
  vip: "#0F4D31",
  loyal: "#5B8A6E",
  promising: "#C9A961",
  new: "#ED7C2A",
  at_risk: "#E47979",
  churned: "#9CA3AF",
};

const FREQ_COLORS = {
  weekly: "#0F4D31",
  monthly: "#5B8A6E",
  quarterly: "#C9A961",
  biannual: "#ED7C2A",
  yearly: "#E47979",
  lapsed: "#6B7280",
  one_time: "#9CA3AF",
};

const BAND_STYLE = {
  high: { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", label: "High risk" },
  medium: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", label: "Medium risk" },
  low: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", label: "Low risk" },
};

function DeltaChip({ value, inverted, compact, hint }) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className="text-xs text-[var(--vivo-muted)]">—</span>;
  }
  const flat = Math.abs(value) < 0.1;
  const positive = inverted ? value < 0 : value > 0;
  const negative = inverted ? value > 0 : value < 0;
  const cls = flat
    ? "text-[var(--vivo-muted)] bg-[var(--vivo-bg)] border-[var(--vivo-border)]"
    : positive
    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : negative
    ? "text-red-700 bg-red-50 border-red-200"
    : "text-[var(--vivo-muted)] bg-[var(--vivo-bg)] border-[var(--vivo-border)]";
  const arrow = flat ? "•" : positive ? "▲" : "▼";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${cls}`}
      title={hint || "vs prior 30 days"}
    >
      {arrow} {Math.abs(value).toFixed(1)}%
      {!compact && hint && <span className="font-normal text-[9px] uppercase tracking-[0.1em] ml-0.5 opacity-70">{hint}</span>}
    </span>
  );
}

function Kpi({ label, value, delta, deltaInverted, deltaHint, sub, icon: Icon, testid, color }) {
  return (
    <Card className="vivo-card p-5 rounded-sm" data-testid={testid}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">{label}</div>
        {delta !== undefined && delta !== null ? (
          <DeltaChip value={delta} inverted={deltaInverted} hint={deltaHint} compact />
        ) : (
          Icon && <Icon className="h-4 w-4" style={{ color: color || "var(--vivo-navy)" }} />
        )}
      </div>
      <div className="font-display text-3xl mt-2 font-mono-num">{value}</div>
      {sub && <div className="mt-2 text-xs text-[var(--vivo-muted)]">{sub}</div>}
    </Card>
  );
}

export default function Overview() {
  const [ov, setOv] = useState(null);
  const [freq, setFreq] = useState(null);
  const [nw, setNw] = useState(null);
  const [drop, setDrop] = useState(null);
  const [nwWindow, setNwWindow] = useState(30);
  const [channel, setChannel] = useState(null);
  const [returnTrend, setReturnTrend] = useState(null);
  const [winbackBusy, setWinbackBusy] = useState(false);
  // Global date range (shared with Insights, Training, etc. — persisted to localStorage)
  const { range, setRange, compare, compareOn, windowDays } = useDateRange();

  useEffect(() => {
    (async () => {
      try {
        const [a, b, d, ch, rt] = await Promise.all([
          api.get("/insights/overview"),
          api.get("/insights/purchase-frequency"),
          api.get(`/insights/dropoff-forecast?days=${windowDays}`),
          api.get(`/bi/channel-attribution?days=${windowDays}`).catch(() => ({ data: { rows: [] } })),
          api.get("/bi/return-rate-trend").catch(() => ({ data: { windows: [] } })),
        ]);
        setOv(a.data);
        setFreq(b.data);
        setDrop(d.data);
        setChannel(ch.data);
        setReturnTrend(rt.data);
      } catch { /* ignore */ }
    })();
  }, [windowDays]);

  const runWinback = async () => {
    setWinbackBusy(true);
    try {
      const r = await api.post("/dropoff/winback-bulk", { band: "high", days: 90, limit: 25 });
      toast.success(`Created ${r.data.created} win-back follow-up${r.data.created === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally {
      setWinbackBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/insights/new-customers", { params: { days: nwWindow } });
        setNw(r.data);
      } catch { /* ignore */ }
    })();
  }, [nwWindow]);

  const tierDist = ov?.tier_distribution || {};
  const tierPie = Object.entries(tierDist).map(([k, v]) => ({ name: k, value: v }));

  return (
    <div className="p-6 md:p-10 max-w-[1500px] mx-auto" data-testid="overview-page">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="eyebrow">Executive</div>
          <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Overview</h1>
          <div className="gold-rule mt-4" />
          <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
            Headline KPIs, new-customer momentum, purchase cadence and a drop-off forecast for
            every new customer in the selected window.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1" data-testid="overview-date-range">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Date range</div>
          <DateRangePicker
            testid="overview-date-picker"
            value={{ from: range.from, to: range.to }}
            onChange={(v) => setRange(v)}
            defaultPreset="last_90"
            align="end"
          />
          <div className="text-[10px] text-[var(--vivo-muted)] mt-1">{windowDays} day{windowDays === 1 ? "" : "s"} lookback</div>
        </div>
      </div>

      {/* Callouts */}
      {(ov?.callouts || []).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-6" data-testid="overview-callouts">
          {ov.callouts.map((c, i) => (
            <Badge
              key={i}
              variant="outline"
              className={`rounded-sm px-3 py-1.5 ${c.tone === "positive" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}
            >
              {c.tone === "positive" ? <Sparkles className="h-3.5 w-3.5 mr-1.5" /> : <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />}
              {c.text}
            </Badge>
          ))}
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-8" data-testid="overview-kpis">
        <Kpi label="Total customers" value={ov ? formatNumber(ov.kpis.total_customers) : "—"} sub="All time" icon={Users} testid="kpi-total" color="#0F4D31" />
        <Kpi label={`New · ${windowDays}d`} value={ov ? formatNumber(ov.kpis.new_customers_30d) : "—"} delta={ov?.kpis.new_customers_delta_pct} deltaHint={compareOn ? "vs compare period" : "vs prior period"} sub="net new customers" icon={UserPlus} testid="kpi-new" color="#ED7C2A" />
        <Kpi label={`Active · ${windowDays}d`} value={ov ? formatNumber(ov.kpis.active_customers_30d) : "—"} delta={ov?.kpis.active_customers_delta_pct} deltaHint={compareOn ? "vs compare period" : "vs prior period"} sub="bought in window" icon={Heart} testid="kpi-active" color="#5B8A6E" />
        <Kpi label="VIPs" value={ov ? formatNumber(ov.kpis.vip_customers) : "—"} sub={ov ? `${ov.kpis.at_risk_customers} at risk` : "—"} icon={ShieldAlert} testid="kpi-vip" color="#C9A961" />
        <Kpi label="Avg basket" value={ov ? formatKES(ov.kpis.avg_basket_kes) : "—"} delta={ov?.kpis.avg_basket_delta_pct} deltaHint={compareOn ? "vs compare period" : "vs prior period"} sub="active customers" icon={Target} testid="kpi-basket" color="#0F4D31" />
        <Kpi label={`Messages · ${windowDays}d`} value={ov ? formatNumber(ov.kpis.messages_sent_30d) : "—"} delta={ov?.kpis.messages_delta_pct} deltaHint={compareOn ? "vs compare period" : "vs prior period"} sub="WhatsApp + SMS" icon={MessageSquare} testid="kpi-messages" color="#5B8A6E" />
        <Kpi label="Social sentiment" value={ov ? `${ov.kpis.social_sentiment_net > 0 ? "+" : ""}${ov.kpis.social_sentiment_net}` : "—"} sub={ov ? `${ov.kpis.social_feedback_30d} posts · net +ve − −ve` : "—"} icon={Sparkles} testid="kpi-sentiment" color={ov?.kpis.social_sentiment_net >= 0 ? "#0F4D31" : "#E47979"} />
        <Kpi label="Projected churn · 30d" value={drop ? formatNumber(drop.projected_churn_next_30d) : "—"} sub={drop ? `of ${drop.evaluated} recent new customers` : "—"} icon={AlertTriangle} testid="kpi-churn" color="#E47979" />
      </div>

      {/* RFM distribution + Purchase frequency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        <Card className="vivo-card p-6 rounded-sm" data-testid="tier-distribution-card">
          <h3 className="font-display text-xl mb-1">Customer mix</h3>
          <p className="text-sm text-[var(--vivo-muted)] mb-4">Where every customer sits today.</p>
          <div className="h-64 flex items-center gap-4">
            <ResponsiveContainer width="50%" height="100%">
              <PieChart>
                <Pie data={tierPie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={85} paddingAngle={2}>
                  {tierPie.map((e) => <Cell key={e.name} fill={TIER_COLORS[e.name] || "#9CA3AF"} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-1.5 text-sm">
              {tierPie.sort((a, b) => b.value - a.value).map((t) => (
                <li key={t.name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: TIER_COLORS[t.name] }} />
                    <RfmBadge tier={t.name} />
                  </span>
                  <span className="font-mono-num">{formatNumber(t.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="vivo-card p-6 rounded-sm" data-testid="purchase-frequency-card">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-display text-xl mb-1">Purchase frequency</h3>
              <p className="text-sm text-[var(--vivo-muted)]">Avg cadence <strong>{freq?.overall_avg_cadence_days || 0}d</strong> · median <strong>{freq?.median_cadence_days || 0}d</strong></p>
            </div>
            <div className="text-right text-xs text-[var(--vivo-muted)]">
              <div className="font-mono-num text-[var(--vivo-text)] text-sm">{formatNumber(freq?.one_time_customers || 0)} one-timers</div>
              <div>{formatNumber(freq?.multi_order_customers || 0)} repeat</div>
            </div>
          </div>
          <div className="h-56 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={freq?.buckets || []} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#6B7280" }} />
                <YAxis type="category" dataKey="bucket" tick={{ fontSize: 11, fill: "#6B7280" }} width={80} />
                <Tooltip formatter={(v, _n, p) => [`${formatNumber(v)} customers`, p.payload.label]} />
                <Bar dataKey="count" radius={[0, 2, 2, 0]}>
                  {(freq?.buckets || []).map((b, i) => <Cell key={i} fill={FREQ_COLORS[b.bucket] || "#9CA3AF"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* New customers insights */}
      <Card className="vivo-card p-6 rounded-sm mt-6" data-testid="new-customers-card">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="eyebrow">New customers</div>
            <h3 className="font-display text-xl mt-1">Acquisition · last {nwWindow} days</h3>
            <p className="text-sm text-[var(--vivo-muted)] mt-1">
              {nw ? (
                <>
                  <strong>{nw.count}</strong> new · {nw.second_order_rate_pct}% placed a 2nd order · avg first basket {formatKES(nw.avg_first_basket_kes)}
                </>
              ) : "—"}
            </p>
          </div>
          <div className="flex bg-white border border-[var(--vivo-border)] rounded-sm overflow-hidden">
            {[30, 60, 90].map((d) => (
              <button
                key={d}
                onClick={() => setNwWindow(d)}
                className={`h-9 px-4 text-xs uppercase tracking-wider ${nwWindow === d ? "bg-[var(--vivo-navy)] text-white" : "text-[var(--vivo-muted)]"}`}
                data-testid={`nw-window-${d}`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-5">
          <div className="lg:col-span-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={nw?.by_month || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6B7280" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#ED7C2A" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div className="eyebrow mb-2">Top cities</div>
            <ul className="text-sm space-y-1.5" data-testid="new-by-city">
              {(nw?.by_city || []).map((c) => (
                <li key={c.city} className="flex items-center justify-between">
                  <span className="truncate">{c.city}</span>
                  <span className="font-mono-num text-[var(--vivo-muted)]">{c.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-6">
          <div className="eyebrow mb-2">Top arrivals · by first-week spend</div>
          <ul className="divide-y divide-[var(--vivo-border)]" data-testid="top-arrivals-list">
            {(nw?.top_arrivals || []).slice(0, 8).map((c) => (
              <li key={c.customer_id} className="py-2.5 flex items-center justify-between gap-3">
                <Link to={`/customers/${c.customer_id}`} className="flex-1 min-w-0 hover:text-[var(--vivo-navy)]">
                  <div className="font-medium truncate flex items-center gap-2">{c.customer_name || "—"} <RfmBadge tier={c.rfm_tier} /></div>
                  <div className="text-xs text-[var(--vivo-muted)] mt-0.5">{c.city || "—"} · joined {formatDate(c.first_purchase_date)} · {c.total_orders} order{c.total_orders === 1 ? "" : "s"}</div>
                </Link>
                <div className="text-right font-mono-num text-sm shrink-0">{formatKES(c.total_sales)}</div>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Acquisition channels + return-rate trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card className="vivo-card p-6 rounded-sm" data-testid="channel-attribution-card">
          <h3 className="font-display text-xl mb-1">Acquisition channels · 90d</h3>
          <p className="text-sm text-[var(--vivo-muted)] mb-4">Where new customers came from on their first purchase.</p>
          {(channel?.rows || []).length === 0 ? (
            <div className="text-sm text-[var(--vivo-muted)]">No channel data — BI orders don't carry a channel field yet.</div>
          ) : (
            <ul className="divide-y divide-[var(--vivo-border)]">
              {channel.rows.slice(0, 8).map((r) => (
                <li key={r.channel} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="font-medium truncate">{r.channel}</div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-mono-num">{formatNumber(r.customers)}</span>
                    <span className="font-mono-num text-[var(--vivo-muted)]">{formatKES(r.revenue_kes)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="vivo-card p-6 rounded-sm" data-testid="return-rate-card">
          <h3 className="font-display text-xl mb-1">Return rate trend</h3>
          <p className="text-sm text-[var(--vivo-muted)] mb-4">Rolling windows, sourced from BI /kpis.</p>
          <div className="grid grid-cols-3 gap-3">
            {(returnTrend?.windows || []).map((w) => (
              <div key={w.window} className="bg-white border border-[var(--vivo-border)] rounded-sm p-4 text-center">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">{w.window}</div>
                <div className="font-display text-2xl mt-1 font-mono-num">{w.return_rate_pct.toFixed(1)}%</div>
                <div className="text-xs text-[var(--vivo-muted)] mt-1">{formatNumber(w.returns)} of {formatNumber(w.orders)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Drop-off forecast */}
      <Card className="vivo-card p-6 rounded-sm mt-6" data-testid="dropoff-card">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="eyebrow">Drop-off forecast</div>
            <h3 className="font-display text-xl mt-1">Who we'll likely lose in the next 30 days</h3>
            <p className="text-sm text-[var(--vivo-muted)] mt-1 max-w-2xl">
              Composite risk score per recent new customer — based on days since first order, missed
              second-order windows, cohort retention and profile-enrichment gaps. Act now.
            </p>
          </div>
          {drop && (
            <div className="flex gap-2 items-center flex-wrap">
              <Badge variant="outline" className="rounded-sm bg-red-50 text-red-700 border-red-200">{drop.bands.high} high</Badge>
              <Badge variant="outline" className="rounded-sm bg-amber-50 text-amber-700 border-amber-200">{drop.bands.medium} medium</Badge>
              <Badge variant="outline" className="rounded-sm bg-emerald-50 text-emerald-700 border-emerald-200">{drop.bands.low} low</Badge>
              {drop.bands.high > 0 && (
                <Button
                  onClick={runWinback}
                  disabled={winbackBusy}
                  className="rounded-sm h-9 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white ml-2"
                  data-testid="dropoff-winback-bulk"
                >
                  {winbackBusy ? "Creating…" : `Win-back all HIGH (${drop.bands.high})`}
                </Button>
              )}
            </div>
          )}
        </div>

        {drop && (
          <div className="mt-5 flex items-center gap-3 p-4 bg-[var(--vivo-bg)] border border-[var(--vivo-border)] rounded-sm" data-testid="projection-banner">
            <AlertTriangle className="h-5 w-5 text-[var(--vivo-orange,#ED7C2A)]" />
            <div className="text-sm">
              Of the <strong>{drop.evaluated}</strong> customers acquired in the last 90 days,
              <strong> ~{drop.projected_churn_next_30d}</strong> are projected to churn in the next 30 days
              if no one intervenes.
            </div>
          </div>
        )}

        <ul className="mt-5 divide-y divide-[var(--vivo-border)]" data-testid="dropoff-list">
          {(drop?.at_risk_customers || []).slice(0, 12).map((c) => {
            const band = BAND_STYLE[c.risk_band];
            return (
              <li key={c.customer_id} className="py-3 flex items-center justify-between gap-3">
                <Link to={`/customers/${c.customer_id}`} className="flex-1 min-w-0 hover:text-[var(--vivo-navy)]">
                  <div className="font-medium truncate flex items-center gap-2">{c.customer_name || "—"} <RfmBadge tier={c.rfm_tier} /></div>
                  <div className="text-xs text-[var(--vivo-muted)] mt-0.5 truncate">
                    {c.city || "—"} · {c.days_since_first_purchase}d since first buy · {(c.reasons || []).slice(0, 2).join(" · ")}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  <div className={`text-xs uppercase tracking-wider font-bold px-2 py-0.5 rounded-sm inline-block ${band.bg} ${band.text} border ${band.border}`}>
                    {band.label} · {c.risk_score.toFixed(0)}
                  </div>
                </div>
              </li>
            );
          })}
          {(drop?.at_risk_customers || []).length === 0 && (
            <li className="py-3 text-sm text-[var(--vivo-muted)]">No recent new customers to score.</li>
          )}
        </ul>

        {drop && (
          <p className="mt-4 text-xs text-[var(--vivo-muted)] italic">{drop.methodology}</p>
        )}
      </Card>
    </div>
  );
}
