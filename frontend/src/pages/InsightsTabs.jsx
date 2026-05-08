import React, { useEffect, useMemo, useState } from "react";
import { api, formatKES, formatNumber, formatDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { Trophy, Repeat, Cake, Sparkles, ClipboardList, Flame, X } from "lucide-react";
import { RfmBadge } from "@/components/RfmBadge";
import { Link } from "react-router-dom";

const RETENTION_GRAD = (v) => {
  // v in 0..100, green forest gradient
  const a = Math.max(0, Math.min(100, v)) / 100;
  return `rgba(15, 77, 49, ${0.08 + a * 0.85})`;
};

export function CohortsTab() {
  const [retention, setRetention] = useState(null);
  const [tierFlow, setTierFlow] = useState(null);
  const [byChannel, setByChannel] = useState(null);
  const [triangle, setTriangle] = useState(null);
  const [triBusy, setTriBusy] = useState(false);
  const [drill, setDrill] = useState(null); // { cohort, bucket, customers, count, loading }
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkTitle, setBulkTitle] = useState("");
  const [bulkDue, setBulkDue] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [r, f, c] = await Promise.all([
          api.get("/insights/cohorts/retention"),
          api.get("/insights/cohorts/tier-flow"),
          api.get("/insights/cohorts/by-channel"),
        ]);
        setRetention(r.data);
        setTierFlow(f.data);
        setByChannel(c.data);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const loadTriangle = async () => {
    setTriBusy(true);
    try {
      const r = await api.get("/insights/cohorts/triangle?months=12");
      setTriangle(r.data);
      toast.success(`Triangle from ${r.data.orders_seen} orders`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not compute");
    } finally {
      setTriBusy(false);
    }
  };

  const openDrill = async (cohort, bucket = null, bucketLabel = null) => {
    setDrill({ cohort, bucket, bucketLabel, customers: [], count: 0, loading: true });
    try {
      const params = { cohort };
      if (bucket) params.bucket = bucket;
      const r = await api.get("/insights/cohorts/customers", { params });
      setDrill({ cohort, bucket, bucketLabel, customers: r.data.customers, count: r.data.count, loading: false });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Drill-down failed");
      setDrill(null);
    }
  };

  const runBulkTask = async () => {
    if (!drill || !bulkTitle.trim()) {
      toast.error("Title required");
      return;
    }
    try {
      const r = await api.post("/insights/cohorts/bulk-task", {
        cohort: drill.cohort,
        bucket: drill.bucket,
        title: bulkTitle.trim(),
        due_date: bulkDue || null,
      });
      toast.success(`Created ${r.data.created} follow-up${r.data.created === 1 ? "" : "s"}`);
      setBulkOpen(false);
      setBulkTitle("");
      setBulkDue("");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bulk create failed");
    }
  };

  const tierStackData = useMemo(() => {
    if (!tierFlow) return [];
    return (tierFlow.flows || []).map((f) => ({
      cohort: f.cohort,
      vip: f.by_tier?.vip || 0,
      loyal: f.by_tier?.loyal || 0,
      promising: f.by_tier?.promising || 0,
      new: f.by_tier?.new || 0,
      at_risk: f.by_tier?.at_risk || 0,
      churned: f.by_tier?.churned || 0,
    }));
  }, [tierFlow]);

  return (
    <div className="space-y-6" data-testid="cohorts-tab">
      <Card className="vivo-card p-6 rounded-sm border-l-4 border-l-[var(--vivo-gold)]">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="eyebrow">Acquisition retention</div>
            <h3 className="font-display text-xl mt-1">Cohort heatmap · last 12 months</h3>
            <p className="text-sm text-[var(--vivo-muted)] mt-1 max-w-xl">
              % of each acquisition cohort still buying at month 1 / 3 / 6 / 12. Built from the
              customer cache — fast, refreshes when BI cache warms.
            </p>
          </div>
          <Button onClick={loadTriangle} disabled={triBusy} variant="outline" className="rounded-sm h-10" data-testid="cohort-triangle-btn">
            <Repeat className={`mr-2 h-4 w-4 ${triBusy ? "animate-spin" : ""}`} /> {triBusy ? "Computing…" : "Full triangle (BI orders)"}
          </Button>
        </div>

        {!retention ? (
          <div className="mt-6 text-sm text-[var(--vivo-muted)]">Loading…</div>
        ) : (
          <div className="mt-5 overflow-x-auto" data-testid="cohort-retention-table">
            <table className="w-full text-sm border-collapse">
              <thead className="text-left text-[var(--vivo-muted)] uppercase text-xs tracking-wider">
                <tr>
                  <th className="py-2 pr-4">Cohort</th><th className="pr-3">Size</th>
                  <th className="pr-2 text-center">M1</th>
                  <th className="pr-2 text-center">M3</th>
                  <th className="pr-2 text-center">M6</th>
                  <th className="pr-2 text-center">M12</th>
                  <th className="pr-2 text-right">Avg LTV</th>
                </tr>
              </thead>
              <tbody>
                {(retention.cohorts || []).map((c) => (
                  <tr key={c.cohort} className="border-t border-[var(--vivo-border)] hover:bg-[var(--vivo-bg)] transition-colors" data-testid={`cohort-row-${c.cohort}`}>
                    <td className="py-2 pr-4 font-medium">
                      <button onClick={() => openDrill(c.cohort, null, "all customers")} className="hover:text-[var(--vivo-navy)] hover:underline" data-testid={`cohort-open-${c.cohort}`}>{c.cohort}</button>
                    </td>
                    <td className="font-mono-num text-[var(--vivo-muted)]">{c.size}</td>
                    {["m1", "m3", "m6", "m12"].map((k) => (
                      <td key={k} className="text-center px-1">
                        <button
                          onClick={() => openDrill(c.cohort, `retained_${k}`, `retained at ${k.toUpperCase()}`)}
                          className="inline-block min-w-[44px] py-1 px-2 rounded-sm text-xs font-mono-num hover:ring-2 hover:ring-[var(--vivo-gold)] transition-shadow"
                          style={{ backgroundColor: RETENTION_GRAD(c.retention[k]), color: c.retention[k] > 50 ? "#fff" : "var(--vivo-text)" }}
                          data-testid={`cohort-cell-${c.cohort}-${k}`}
                          title={`Drill down into M${k.slice(1)} retained`}
                        >
                          {c.retention[k].toFixed(0)}%
                        </button>
                      </td>
                    ))}
                    <td className="text-right font-mono-num">{formatKES(c.avg_ltv_kes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="vivo-card p-6 rounded-sm" data-testid="tier-flow-chart">
          <h3 className="font-display text-xl mb-1">Tier flow by cohort</h3>
          <p className="text-sm text-[var(--vivo-muted)] mb-4">Where each cohort sits today across the RFM tiers.</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tierStackData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="cohort" tick={{ fontSize: 10, fill: "#6B7280" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="vip" stackId="t" fill="#0F4D31" />
                <Bar dataKey="loyal" stackId="t" fill="#5B8A6E" />
                <Bar dataKey="promising" stackId="t" fill="#C9A961" />
                <Bar dataKey="new" stackId="t" fill="#ED7C2A" />
                <Bar dataKey="at_risk" stackId="t" fill="#E47979" />
                <Bar dataKey="churned" stackId="t" fill="#9CA3AF" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="vivo-card p-6 rounded-sm" data-testid="channel-cohort-table">
          <h3 className="font-display text-xl mb-1">By channel · top 12</h3>
          <p className="text-sm text-[var(--vivo-muted)] mb-4">180-day active rate + avg LTV by city / country.</p>
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--vivo-muted)] uppercase text-xs tracking-wider">
              <tr><th className="py-2">Channel</th><th>Customers</th><th>Active 180d</th><th className="text-right">Avg LTV</th></tr>
            </thead>
            <tbody>
              {(byChannel?.channels || []).slice(0, 12).map((c) => (
                <tr key={c.channel} className="border-t border-[var(--vivo-border)]">
                  <td className="py-2 font-medium">{c.channel}</td>
                  <td className="font-mono-num">{c.size}</td>
                  <td className="font-mono-num">{c.active_180d_pct}%</td>
                  <td className="text-right font-mono-num">{formatKES(c.avg_ltv_kes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {triangle && (
        <Card className="vivo-card p-6 rounded-sm" data-testid="cohort-triangle">
          <h3 className="font-display text-xl mb-1">Full retention triangle · BI orders</h3>
          <p className="text-sm text-[var(--vivo-muted)] mb-4">% of each cohort active in each subsequent month. Source: Vivo BI /orders.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[var(--vivo-muted)] uppercase tracking-wider">
                <tr>
                  <th className="py-2 pr-3">Cohort</th><th>Size</th>
                  {Array.from({ length: 13 }, (_, i) => <th key={i} className="px-1 text-center">M{i}</th>)}
                </tr>
              </thead>
              <tbody>
                {(triangle.rows || []).map((r) => (
                  <tr key={r.cohort} className="border-t border-[var(--vivo-border)]">
                    <td className="py-1.5 pr-3 font-medium">{r.cohort}</td>
                    <td className="font-mono-num">{r.size}</td>
                    {Array.from({ length: 13 }, (_, i) => {
                      const v = r.retention?.[`m${i}`] ?? 0;
                      return (
                        <td key={i} className="text-center px-1">
                          <span
                            className="inline-block min-w-[36px] py-0.5 rounded-sm font-mono-num"
                            style={{ backgroundColor: RETENTION_GRAD(v), color: v > 50 ? "#fff" : "var(--vivo-text)" }}
                          >{v.toFixed(0)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Drill-down drawer */}
      {drill && (
        <div className="fixed inset-0 z-50 flex" data-testid="cohort-drill">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrill(null)} />
          <div className="relative ml-auto w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-[var(--vivo-border)] px-6 py-4 flex items-start justify-between">
              <div>
                <div className="eyebrow">Cohort · {drill.cohort}</div>
                <h3 className="font-display text-2xl mt-1">{drill.count} customers</h3>
                <p className="text-sm text-[var(--vivo-muted)] mt-0.5">{drill.bucketLabel || "All customers in this cohort"}</p>
              </div>
              <button onClick={() => setDrill(null)} className="p-2 hover:bg-[var(--vivo-bg)] rounded-sm" data-testid="drill-close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 flex gap-2 flex-wrap border-b border-[var(--vivo-border)]">
              <Button
                onClick={() => setBulkOpen(true)}
                className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white h-10"
                disabled={drill.loading || drill.count === 0}
                data-testid="drill-bulk-task"
              >
                <ClipboardList className="mr-2 h-4 w-4" /> Create follow-up for all
              </Button>
              {["vip", "loyal", "at_risk", "churned"].map((b) => (
                <Button
                  key={b}
                  variant="outline"
                  className="rounded-sm h-10"
                  onClick={() => openDrill(drill.cohort, b, `tier: ${b}`)}
                  data-testid={`drill-filter-${b}`}
                >
                  {b}
                </Button>
              ))}
              <Button variant="outline" className="rounded-sm h-10" onClick={() => openDrill(drill.cohort, null, "all customers")} data-testid="drill-filter-all">
                All
              </Button>
            </div>
            {drill.loading ? (
              <div className="p-6 text-sm text-[var(--vivo-muted)]">Loading…</div>
            ) : drill.customers.length === 0 ? (
              <div className="p-6 text-sm text-[var(--vivo-muted)]">No customers match this slice.</div>
            ) : (
              <ul className="divide-y divide-[var(--vivo-border)]" data-testid="drill-customers">
                {drill.customers.map((c) => (
                  <li key={c.customer_id} className="px-6 py-3 flex items-center justify-between gap-3 hover:bg-[var(--vivo-bg)]">
                    <Link to={`/customers/${c.customer_id}`} className="flex-1 min-w-0" onClick={() => setDrill(null)}>
                      <div className="font-medium truncate flex items-center gap-2">{c.customer_name || c.customer_id} <RfmBadge tier={c.rfm_tier} /></div>
                      <div className="text-xs text-[var(--vivo-muted)] mt-0.5">{c.city || "—"} · {c.total_orders} orders · last {formatDate(c.last_purchase_date)}</div>
                    </Link>
                    <div className="font-mono-num text-sm shrink-0">{formatKES(c.total_sales)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Bulk task dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="rounded-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Create follow-up for {drill?.count || 0} customer{drill?.count === 1 ? "" : "s"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Task title</Label>
              <Input
                value={bulkTitle}
                onChange={(e) => setBulkTitle(e.target.value)}
                placeholder={`Win-back call — ${drill?.cohort} cohort`}
                className="h-12 mt-1 rounded-sm"
                data-testid="bulk-task-title"
              />
            </div>
            <div>
              <Label>Due date (optional)</Label>
              <Input type="date" value={bulkDue} onChange={(e) => setBulkDue(e.target.value)} className="h-12 mt-1 rounded-sm" data-testid="bulk-task-due" />
            </div>
            <p className="text-xs text-[var(--vivo-muted)]">
              One task per customer will be created and assigned to you. Scope: cohort <strong>{drill?.cohort}</strong>
              {drill?.bucketLabel ? <> · <strong>{drill.bucketLabel}</strong></> : null}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={runBulkTask} className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white" data-testid="bulk-task-submit">
              Create {drill?.count || 0} task{drill?.count === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function OperationsTab() {
  const [brief, setBrief] = useState(null);
  const [ltv, setLtv] = useState(null);
  const [reorder, setReorder] = useState(null);
  const [events, setEvents] = useState(null);
  const [board, setBoard] = useState(null);
  const [period, setPeriod] = useState("week");

  useEffect(() => {
    (async () => {
      try {
        const [b, l, r, e] = await Promise.all([
          api.get("/insights/daily-brief"),
          api.get("/insights/ltv/top?limit=15"),
          api.get("/insights/reorder-candidates?window_days=14"),
          api.get("/insights/upcoming-events?days=30"),
        ]);
        setBrief(b.data);
        setLtv(l.data);
        setReorder(r.data);
        setEvents(e.data);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/insights/leaderboard", { params: { period } });
        setBoard(r.data);
      } catch {
        /* ignore */
      }
    })();
  }, [period]);

  return (
    <div className="space-y-6" data-testid="operations-tab">
      {/* Daily Brief */}
      <Card className="vivo-card p-6 rounded-sm border-l-4 border-l-[var(--vivo-orange,#ED7C2A)]" data-testid="daily-brief-card">
        <div className="flex items-start gap-3">
          <ClipboardList className="h-5 w-5 text-[var(--vivo-orange,#ED7C2A)] mt-1 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="eyebrow">Stand-up · {brief?.for_date}</div>
            <h3 className="font-display text-xl mt-1">Daily brief</h3>
            <p className="font-display text-2xl mt-3">{brief?.headline || "—"}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
              <Mini title="Today's anniversaries" items={brief?.today?.anniversaries} testid="brief-anniversaries" />
              <Mini title="At-risk · top 5" items={brief?.today?.at_risk_top} testid="brief-at-risk" />
              <Mini title="VIP silent · top 5" items={brief?.today?.vip_silent_top} testid="brief-vip-silent" />
            </div>
            {(brief?.top_quality_issues_7d || []).length > 0 && (
              <div className="mt-5">
                <div className="eyebrow mb-2">Top quality issues · 7d</div>
                <div className="flex flex-wrap gap-2">
                  {brief.top_quality_issues_7d.map((q) => (
                    <Badge key={q.theme} variant="outline" className="rounded-sm">
                      {q.theme} <span className="ml-1 font-mono-num text-[var(--vivo-muted)]">{q.count}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Leaderboard */}
      <Card className="vivo-card p-6 rounded-sm" data-testid="leaderboard-card">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-start gap-3">
            <Trophy className="h-5 w-5 text-[var(--vivo-gold)] mt-1" />
            <div>
              <div className="eyebrow">Performance</div>
              <h3 className="font-display text-xl mt-1">Associate leaderboard</h3>
              <p className="text-sm text-[var(--vivo-muted)] mt-1">Headline metric: clienteling-attributed customers who purchased.</p>
            </div>
          </div>
          <div className="flex bg-white border border-[var(--vivo-border)] rounded-sm overflow-hidden">
            {["week", "month"].map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`h-9 px-4 text-xs uppercase tracking-wider ${period === p ? "bg-[var(--vivo-navy)] text-white" : "text-[var(--vivo-muted)]"}`} data-testid={`board-period-${p}`}>{p}</button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm mt-5" data-testid="leaderboard-table">
          <thead className="text-left text-[var(--vivo-muted)] uppercase text-xs tracking-wider">
            <tr>
              <th className="py-2 w-10">#</th><th>Associate</th><th>Msgs</th><th>Reached</th><th>Bought</th><th>Lookbooks</th><th className="text-right">Conv.</th>
            </tr>
          </thead>
          <tbody>
            {(board?.rows || []).map((r) => (
              <tr key={r.associate} className="border-t border-[var(--vivo-border)]">
                <td className="py-2.5 font-mono-num">
                  {r.rank === 1 ? <Flame className="h-4 w-4 text-[var(--vivo-orange,#ED7C2A)] inline" /> : r.rank}
                </td>
                <td className="font-medium">{r.associate}</td>
                <td className="font-mono-num">{r.messages}</td>
                <td className="font-mono-num">{r.customers_contacted}</td>
                <td className="font-mono-num">{r.customers_purchased}</td>
                <td className="font-mono-num">{r.lookbooks}</td>
                <td className="text-right font-mono-num">{r.conversion_rate}%</td>
              </tr>
            ))}
            {(board?.rows || []).length === 0 && (
              <tr><td colSpan={7} className="py-6 text-sm text-[var(--vivo-muted)] text-center">No outreach in this window.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top LTV */}
        <Card className="vivo-card p-6 rounded-sm" data-testid="ltv-top-card">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-[var(--vivo-gold)]" />
            <h3 className="font-display text-xl">Top LTV · 12-month forecast</h3>
          </div>
          <p className="text-sm text-[var(--vivo-muted)] mb-4">Customers worth investing in, ranked by projected 12m revenue.</p>
          <ul className="divide-y divide-[var(--vivo-border)]">
            {(ltv?.customers || []).slice(0, 10).map((c) => (
              <li key={c.customer_id} className="py-2.5 flex items-center justify-between gap-3">
                <Link to={`/customers/${c.customer_id}`} className="flex-1 min-w-0 hover:text-[var(--vivo-navy)]">
                  <div className="font-medium truncate flex items-center gap-2">{c.customer_name} <RfmBadge tier={c.rfm_tier} /></div>
                  <div className="text-xs text-[var(--vivo-muted)] mt-0.5">{c.city || "—"} · LTV so far {formatKES(c.lifetime_spend_kes)}</div>
                </Link>
                <div className="text-right shrink-0">
                  <div className="font-mono-num font-semibold">{formatKES(c.forecast_12m_ltv_kes)}</div>
                  <div className="text-[10px] text-[var(--vivo-muted)] uppercase tracking-wider">{c.confidence}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* Reorder candidates */}
        <Card className="vivo-card p-6 rounded-sm" data-testid="reorder-card">
          <div className="flex items-center gap-2 mb-1">
            <Repeat className="h-4 w-4 text-[var(--vivo-orange,#ED7C2A)]" />
            <h3 className="font-display text-xl">Smart reorder · next 14 days</h3>
          </div>
          <p className="text-sm text-[var(--vivo-muted)] mb-4">Customers whose typical buying cadence is up — nudge them.</p>
          <ul className="divide-y divide-[var(--vivo-border)]">
            {(reorder?.candidates || []).slice(0, 10).map((c) => (
              <li key={c.customer_id} className="py-2.5 flex items-center justify-between gap-3">
                <Link to={`/customers/${c.customer_id}`} className="flex-1 min-w-0 hover:text-[var(--vivo-navy)]">
                  <div className="font-medium truncate flex items-center gap-2">{c.customer_name} <RfmBadge tier={c.rfm_tier} /></div>
                  <div className="text-xs text-[var(--vivo-muted)] mt-0.5">cadence {c.avg_cadence_days}d · last {c.days_since_last}d ago</div>
                </Link>
                <div className="text-right shrink-0">
                  <div className={`text-xs uppercase tracking-wider font-bold ${c.due_in_days <= 0 ? "text-red-600" : "text-[var(--vivo-orange,#ED7C2A)]"}`}>
                    {c.due_in_days <= 0 ? `${Math.abs(c.due_in_days)}d overdue` : `due in ${c.due_in_days}d`}
                  </div>
                </div>
              </li>
            ))}
            {(reorder?.candidates || []).length === 0 && <li className="text-sm text-[var(--vivo-muted)] py-2">No customers due in this window.</li>}
          </ul>
        </Card>
      </div>

      {/* Upcoming life events */}
      <Card className="vivo-card p-6 rounded-sm" data-testid="upcoming-events-card">
        <div className="flex items-center gap-2 mb-1">
          <Cake className="h-4 w-4 text-[var(--vivo-gold)]" />
          <h3 className="font-display text-xl">Upcoming life events · next 30 days</h3>
        </div>
        <p className="text-sm text-[var(--vivo-muted)] mb-4">Add a date of birth or anniversary on the customer profile and we'll surface gifting opportunities.</p>
        {(events?.events || []).length === 0 ? (
          <div className="text-sm text-[var(--vivo-muted)]">No events captured yet.</div>
        ) : (
          <ul className="divide-y divide-[var(--vivo-border)]">
            {events.events.map((e, i) => (
              <li key={i} className="py-2.5 flex items-center justify-between gap-3">
                <Link to={`/customers/${e.customer_id}`} className="flex-1 min-w-0 hover:text-[var(--vivo-navy)]">
                  <div className="font-medium truncate flex items-center gap-2">{e.customer_name} <RfmBadge tier={e.rfm_tier} /></div>
                  <div className="text-xs text-[var(--vivo-muted)] mt-0.5">{e.label} · {formatDate(e.date)}</div>
                </Link>
                <div className="text-right text-xs uppercase tracking-wider font-bold text-[var(--vivo-orange,#ED7C2A)]">
                  {e.in_days === 0 ? "TODAY" : `in ${e.in_days}d`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Mini({ title, items, testid }) {
  return (
    <div className="bg-white border border-[var(--vivo-border)] rounded-sm p-3" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)] mb-2">{title}</div>
      <ul className="text-sm space-y-1">
        {(items || []).slice(0, 5).map((c) => (
          <li key={c.customer_id} className="flex items-center justify-between gap-2">
            <Link to={`/customers/${c.customer_id}`} className="truncate hover:text-[var(--vivo-navy)]">{c.customer_name || "—"}</Link>
            <span className="text-xs font-mono-num text-[var(--vivo-muted)] shrink-0">{formatNumber(Math.round((c.total_sales || 0) / 1000))}k</span>
          </li>
        ))}
        {(items || []).length === 0 && <li className="text-xs text-[var(--vivo-muted)]">—</li>}
      </ul>
    </div>
  );
}
