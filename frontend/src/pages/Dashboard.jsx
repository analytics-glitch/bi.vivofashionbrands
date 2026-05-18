import React, { useEffect, useState } from "react";
import { api, formatDate, formatKES, formatNumber } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Search, Calendar, AlertTriangle, Sparkles, Cake } from "lucide-react";
import { RfmBadge } from "@/components/RfmBadge";

function KPI({ label, value, sub, delta, deltaInverted, testid }) {
  const showDelta = delta !== null && delta !== undefined && !Number.isNaN(delta);
  const positive = deltaInverted ? delta < 0 : delta > 0;
  const negative = deltaInverted ? delta > 0 : delta < 0;
  const flat = Math.abs(delta || 0) < 0.1;
  const cls = !showDelta || flat
    ? "text-[var(--vivo-muted)] bg-[var(--vivo-bg)] border-[var(--vivo-border)]"
    : positive
    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : negative
    ? "text-red-700 bg-red-50 border-red-200"
    : "text-[var(--vivo-muted)] bg-[var(--vivo-bg)] border-[var(--vivo-border)]";
  const arrow = flat ? "•" : positive ? "▲" : "▼";
  return (
    <div className="vivo-card p-6" data-testid={testid}>
      <div className="flex items-start justify-between gap-2">
        <div className="eyebrow">{label}</div>
        {showDelta && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${cls}`} title="vs previous 7 days">
            {arrow} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="font-display text-4xl mt-3 font-mono-num">{value}</div>
      {sub && <div className="text-sm text-[var(--vivo-muted)] mt-2">{sub}</div>}
    </div>
  );
}

const SECTIONS = [
  { key: "anniversaries", title: "Shopping anniversaries today", icon: Cake, accent: "var(--vivo-gold)", emptyMsg: "No anniversaries today." },
  { key: "vip_silent", title: "VIPs you haven't contacted in 30d", icon: Sparkles, accent: "var(--vivo-navy)", emptyMsg: "All VIPs touched in the last 30 days." },
  { key: "at_risk", title: "At-risk · slipping away", icon: AlertTriangle, accent: "#b91c1c", emptyMsg: "No at-risk customers right now." },
  { key: "churned", title: "Worth a win-back call", icon: Calendar, accent: "var(--vivo-muted)", emptyMsg: "No churned high-value customers." },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [callList, setCallList] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    let pollTimer = null;
    const fetchAll = async () => {
      const [meRes, clRes] = await Promise.all([
        api.get("/dashboard/me"),
        api.get("/dashboard/call-list", { params: { with_nba: true } }),
      ]);
      if (!mounted) return;
      setMe(meRes.data);
      setCallList(clRes.data);
      setLoading(false);
      // If the backend kicked off background NBA precompute, poll once to hydrate badges.
      if (clRes.data?.ai_pending > 0) {
        pollTimer = setTimeout(async () => {
          try {
            const r = await api.get("/dashboard/call-list", { params: { with_nba: true } });
            if (mounted) setCallList(r.data);
          } catch { /* ignore */ }
        }, 8000);
      }
    };
    fetchAll().catch(() => mounted && setLoading(false));
    return () => {
      mounted = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, []);

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto" data-testid="dashboard-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="eyebrow">Today · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" })}</div>
          <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">
            Hello, {user?.name?.split(" ")[0] || "there"}
          </h1>
          <div className="gold-rule mt-4" />
        </div>
        <Button
          onClick={() => navigate("/customers")}
          className="h-12 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-md"
          data-testid="cta-find-customer"
        >
          <Search className="mr-2 h-4 w-4" /> Find a customer
        </Button>
      </div>

      <DailyGoalCard me={me} loading={loading} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-6">
        <KPI label="Customers contacted · 7d" value={loading ? "—" : formatNumber(me?.customers_contacted_this_week || 0)} delta={me?.customers_delta_pct} testid="kpi-customers-contacted" />
        <KPI label="Messages sent · 7d" value={loading ? "—" : formatNumber(me?.messages_this_week || 0)} delta={me?.messages_delta_pct} testid="kpi-messages" />
        <Link to="/follow-ups" className="block" data-testid="kpi-tasks-link">
          <KPI label="Open follow-ups" value={loading ? "—" : formatNumber(me?.open_tasks || 0)} sub={me?.overdue_tasks ? `${me.overdue_tasks} overdue · view` : "view all"} testid="kpi-tasks" />
        </Link>
        <KPI label="Recent notes" value={loading ? "—" : formatNumber(me?.recent_notes?.length || 0)} testid="kpi-notes" />
      </div>

      {/* Daily call list */}
      <div className="mt-10">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="eyebrow">Your call list</div>
            <h2 className="font-display text-3xl mt-1">Customers worth your time today</h2>
          </div>
          <Link to="/customers" className="text-sm text-[var(--vivo-navy)] hover:underline">All customers →</Link>
        </div>
        <div className="vivo-divider mt-3" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6" data-testid="call-list">
          {SECTIONS.map(({ key, title, icon: Icon, accent, emptyMsg }) => {
            const items = callList?.[key] || [];
            return (
              <Card key={key} className="vivo-card p-6 rounded-xl" data-testid={`call-list-${key}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" style={{ color: accent }} />
                    <h3 className="font-display text-lg">{title}</h3>
                  </div>
                  <span className="text-[var(--vivo-muted)] font-mono-num text-sm">{items.length}</span>
                </div>
                <div className="vivo-divider mb-4" />
                {loading ? (
                  <div className="text-sm text-[var(--vivo-muted)]">Loading…</div>
                ) : items.length === 0 ? (
                  <div className="text-sm text-[var(--vivo-muted)]">{emptyMsg}</div>
                ) : (
                  <ul className="divide-y divide-[var(--vivo-border)]">
                    {items.slice(0, 5).map((c) => (
                      <li key={c.customer_id}>
                        <Link to={`/customers/${c.customer_id}`} className="flex items-center justify-between gap-3 py-3 group" data-testid={`call-list-item-${c.customer_id}`}>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate group-hover:text-[var(--vivo-navy)] flex items-center gap-2 flex-wrap">
                              {c.customer_name || "Unknown"}
                              {c.nba_urgency && (
                                <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${
                                  c.nba_urgency === "high" ? "bg-red-100 text-red-700" :
                                  c.nba_urgency === "medium" ? "bg-amber-100 text-amber-800" :
                                  "bg-zinc-100 text-zinc-600"
                                }`} data-testid={`nba-urgency-${c.customer_id}`}>AI · {c.nba_urgency}</span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--vivo-muted)] mt-1 flex flex-wrap items-center gap-2">
                              <RfmBadge tier={c.rfm_tier} />
                              {c.nba_action ? (
                                <span className="text-[var(--vivo-navy)]">→ {c.nba_action}</span>
                              ) : (
                                <span>{c.total_orders || 0} orders · last {formatDate(c.last_purchase_date)}</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-mono-num text-sm">{formatKES(c.total_sales)}</div>
                            <ArrowRight className="h-3 w-3 text-[var(--vivo-muted)] inline-block mt-1" />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Today's tasks */}
      <Card className="vivo-card mt-10 p-6 rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl">Your follow-ups</h2>
          <span className="text-sm text-[var(--vivo-muted)]">Sorted by due date</span>
        </div>
        <div className="vivo-divider mb-4" />
        {loading ? (
          <div className="text-sm text-[var(--vivo-muted)]">Loading…</div>
        ) : !me?.tasks?.length ? (
          <div className="py-12 text-center" data-testid="tasks-empty">
            <CheckCircle2 className="h-10 w-10 text-[var(--vivo-gold)] mx-auto" />
            <div className="font-display text-xl mt-3">No open follow-ups</div>
            <p className="text-sm text-[var(--vivo-muted)] mt-2">Add follow-ups from any customer profile.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--vivo-border)]" data-testid="tasks-list">
            {me.tasks.map((t) => {
              const today = new Date().toISOString().slice(0, 10);
              const overdue = t.due_date && t.due_date < today;
              return (
                <li key={t.task_id} className="py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-sm text-[var(--vivo-muted)]">
                      {t.customer_name || t.customer_id} · due {formatDate(t.due_date)}
                    </div>
                  </div>
                  {overdue ? (
                    <span className="text-xs uppercase tracking-wider text-red-600 flex items-center gap-1">
                      Overdue
                    </span>
                  ) : null}
                  {t.customer_id && (
                    <Link to={`/customers/${t.customer_id}`} className="text-[var(--vivo-navy)] text-sm hover:underline flex items-center gap-1" data-testid={`task-open-${t.task_id}`}>
                      Open <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}


function DailyGoalCard({ me, loading }) {
  const [editing, setEditing] = React.useState(false);
  const [goalInput, setGoalInput] = React.useState(5);

  React.useEffect(() => {
    if (me?.daily_goal) setGoalInput(me.daily_goal);
  }, [me?.daily_goal]);

  const goal = me?.daily_goal || 5;
  const done = me?.contacts_today || 0;
  const pct = Math.min(100, Math.round((done / Math.max(1, goal)) * 100));

  const save = async () => {
    try {
      const r = await api.put("/dashboard/me/goal", { daily_goal: parseInt(goalInput, 10) });
      window.location.reload();
      return r;
    } catch { /* ignore */ }
  };

  return (
    <Card className="vivo-card mt-10 p-6 rounded-sm border-l-4 border-l-[var(--vivo-orange,#ED7C2A)]" data-testid="daily-goal-card">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="eyebrow">Today's outreach goal</div>
          <h3 className="font-display text-xl mt-1">
            {loading ? "—" : <>{done} of {goal} customers contacted</>}
            {!loading && done >= goal && <span className="ml-2 text-sm text-emerald-700 font-normal">🎉 goal met</span>}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <input
                type="number"
                min="1"
                max="50"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                className="w-20 h-10 px-3 border border-[var(--vivo-border)] rounded-sm font-mono-num text-right"
                data-testid="daily-goal-input"
              />
              <Button onClick={save} className="h-10 rounded-sm bg-[var(--vivo-navy)] text-white" data-testid="daily-goal-save">Save</Button>
              <Button onClick={() => setEditing(false)} variant="ghost" className="h-10 rounded-sm">Cancel</Button>
            </>
          ) : (
            <Button onClick={() => setEditing(true)} variant="outline" className="h-10 rounded-sm" data-testid="daily-goal-edit">Adjust goal</Button>
          )}
        </div>
      </div>
      <div className="mt-3 h-2 bg-[var(--vivo-bg)] rounded-full overflow-hidden">
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? "#0F4D31" : "#ED7C2A" }}
          data-testid="daily-goal-progress"
        />
      </div>
      {!loading && (me?.messages_this_week === 0 && me?.customers_contacted_this_week === 0) && (
        <p className="mt-3 text-xs text-[var(--vivo-muted)]">
          Counters show <strong>0</strong> because no outreach has been logged yet via Vivo CRM. They'll populate as soon as
          associates send messages here — Shopify/Odoo purchase data is unaffected.
        </p>
      )}
    </Card>
  );
}

