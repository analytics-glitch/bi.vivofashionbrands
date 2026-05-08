import React, { useEffect, useState } from "react";
import { api, formatDate, formatKES, formatNumber, daysAgo, today } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, Search, Star, AlertCircle } from "lucide-react";

function KPI({ label, value, sub, testid }) {
  return (
    <div className="vivo-card p-6" data-testid={testid}>
      <div className="eyebrow">{label}</div>
      <div className="font-display text-4xl mt-3 font-mono-num">{value}</div>
      {sub && <div className="text-sm text-[var(--vivo-muted)] mt-2">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [topCustomers, setTopCustomers] = useState([]);
  const [churned, setChurned] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [meRes, topRes, churnRes] = await Promise.all([
          api.get("/dashboard/me"),
          api.get("/bi/top-customers", { params: { date_from: daysAgo(30), date_to: today(), limit: 6 } }),
          api.get("/bi/churned-customers", { params: { days: 90, limit: 6 } }),
        ]);
        setMe(meRes.data);
        setTopCustomers(topRes.data || []);
        setChurned(churnRes.data || []);
      } finally {
        setLoading(false);
      }
    })();
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
          className="h-12 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm"
          data-testid="cta-find-customer"
        >
          <Search className="mr-2 h-4 w-4" /> Find a customer
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-10">
        <KPI label="Customers contacted · 7d" value={loading ? "—" : formatNumber(me?.customers_contacted_this_week || 0)} testid="kpi-customers-contacted" />
        <KPI label="Messages sent · 7d" value={loading ? "—" : formatNumber(me?.messages_this_week || 0)} testid="kpi-messages" />
        <KPI label="Open follow-ups" value={loading ? "—" : formatNumber(me?.open_tasks || 0)} sub={me?.overdue_tasks ? `${me.overdue_tasks} overdue` : "All on track"} testid="kpi-tasks" />
        <KPI label="Recent notes" value={loading ? "—" : formatNumber(me?.recent_notes?.length || 0)} testid="kpi-notes" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-10">
        {/* Today's tasks */}
        <Card className="vivo-card lg:col-span-2 p-6 rounded-sm">
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
                const overdue = t.due_date && t.due_date < today();
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
                        <AlertCircle className="h-3 w-3" /> Overdue
                      </span>
                    ) : null}
                    <Link
                      to={`/customers/${t.customer_id}`}
                      className="text-[var(--vivo-navy)] text-sm hover:underline flex items-center gap-1"
                      data-testid={`task-open-${t.task_id}`}
                    >
                      Open <ArrowRight className="h-3 w-3" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Top customers strip */}
        <Card className="vivo-card p-6 rounded-sm" data-testid="top-customers-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-2xl">VIPs · 30d</h2>
            <Star className="h-4 w-4 text-[var(--vivo-gold)]" />
          </div>
          <div className="vivo-divider mb-4" />
          <ul className="space-y-3">
            {topCustomers.slice(0, 6).map((c) => (
              <li key={c.customer_id} className="flex items-center justify-between gap-3">
                <Link to={`/customers/${c.customer_id}`} className="flex-1 min-w-0 group">
                  <div className="font-medium truncate group-hover:text-[var(--vivo-navy)]">{c.customer_name}</div>
                  <div className="text-xs text-[var(--vivo-muted)]">{c.total_orders} orders</div>
                </Link>
                <div className="text-right">
                  <div className="font-mono-num text-sm">{formatKES(c.total_sales)}</div>
                </div>
              </li>
            ))}
            {!loading && topCustomers.length === 0 && (
              <li className="text-sm text-[var(--vivo-muted)]">No data available.</li>
            )}
          </ul>
        </Card>
      </div>

      {/* Reactivation list */}
      <div className="mt-10">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="eyebrow">Win-back</div>
            <h2 className="font-display text-2xl mt-1">Customers worth a call</h2>
          </div>
          <Link to="/customers" className="text-sm text-[var(--vivo-navy)] hover:underline">All customers →</Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="reactivation-list">
          {churned.map((c) => (
            <Link key={c.customer_id} to={`/customers/${c.customer_id}`} className="vivo-card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{c.customer_name}</div>
                  <div className="text-xs text-[var(--vivo-muted)] mt-1">
                    Last seen {formatDate(c.last_purchase_date)} · {c.days_since_last_purchase}d ago
                  </div>
                </div>
                <span className="text-xs uppercase tracking-wider text-[var(--vivo-gold-700)]">VIP</span>
              </div>
              <div className="vivo-divider my-3" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--vivo-muted)]">Lifetime</span>
                <span className="font-mono-num">{formatKES(c.lifetime_spend)}</span>
              </div>
            </Link>
          ))}
          {!loading && churned.length === 0 && (
            <div className="text-sm text-[var(--vivo-muted)]">No reactivation candidates.</div>
          )}
        </div>
      </div>
    </div>
  );
}
