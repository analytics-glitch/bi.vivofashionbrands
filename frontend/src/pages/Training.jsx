import React, { useEffect, useMemo, useState } from "react";
import { api, formatNumber, formatDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Users, GraduationCap, Wallet, Clock, AlertTriangle, Trophy, MapPin, Layers,
} from "lucide-react";

const PALETTE = ["#0F4D31", "#ED7C2A", "#C9A961", "#5B8A6E", "#E47979", "#9CA3AF", "#6B7280"];

function Kpi({ icon: Icon, label, value, sub, testid, color }) {
  return (
    <Card className="vivo-card p-5 rounded-sm" data-testid={testid}>
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">{label}</div>
        {Icon && <Icon className="h-4 w-4" style={{ color: color || "var(--vivo-navy)" }} />}
      </div>
      <div className="font-display text-3xl mt-2 font-mono-num">{value ?? "—"}</div>
      {sub && <div className="text-xs text-[var(--vivo-muted)] mt-1.5">{sub}</div>}
    </Card>
  );
}

function fmtKES(n) {
  if (n == null || isNaN(n)) return "—";
  return "KES " + Math.round(n).toLocaleString("en-KE");
}

export default function Training() {
  const [overview, setOverview] = useState(null);
  const [filters, setFilters] = useState(null);
  const [status, setStatus] = useState([]);
  const [byDept, setByDept] = useState([]);
  const [byDelivery, setByDelivery] = useState([]);
  const [duration, setDuration] = useState([]);
  const [budget, setBudget] = useState([]);
  const [lateness, setLateness] = useState(null);
  const [topEmps, setTopEmps] = useState([]);
  const [trend, setTrend] = useState([]);
  const [facilitators, setFacilitators] = useState([]);
  const [params, setParams] = useState({}); // active filters
  const [loading, setLoading] = useState(true);

  const reload = async (p = params) => {
    setLoading(true);
    try {
      const [o, s, d, dm, du, bg, la, te, tr, fa] = await Promise.all([
        api.get("/training/overview", { params: p }),
        api.get("/training/training-status", { params: p }),
        api.get("/training/by-department", { params: p }),
        api.get("/training/by-delivery-method", { params: p }),
        api.get("/training/duration", { params: p }),
        api.get("/training/budget", { params: p }),
        api.get("/training/lateness", { params: p }),
        api.get("/training/top-employees", { params: { ...p, limit: 12 } }),
        api.get("/training/monthly-trend", { params: p }),
        api.get("/training/facilitators"),
      ]);
      setOverview(o.data);
      setStatus(s.data || []);
      setByDept(d.data || []);
      setByDelivery(dm.data || []);
      setDuration(du.data || []);
      setBudget(bg.data || []);
      setLateness(la.data || null);
      setTopEmps(te.data || []);
      setTrend(tr.data || []);
      setFacilitators(fa.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const f = await api.get("/training/filters");
        setFilters(f.data);
      } catch { /* ignore */ }
      await reload({});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setParam = (k, v) => {
    const next = { ...params };
    if (!v || v === "all") delete next[k];
    else next[k] = v;
    setParams(next);
    reload(next);
  };

  const clearFilters = () => { setParams({}); reload({}); };

  const deptPie = useMemo(() => byDept.map((d) => ({ name: d.department || "—", value: d.unique_employees })), [byDept]);

  return (
    <div className="p-6 md:p-10 max-w-[1500px] mx-auto" data-testid="training-page">
      <div>
        <div className="eyebrow">Learning & development</div>
        <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Training</h1>
        <div className="gold-rule mt-4" />
        <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
          Live training analytics — sessions, attendance, budget and per-employee history. Lateness
          figures are timezone-adjusted to Africa/Nairobi.
        </p>
      </div>

      {/* Filters */}
      {filters && (
        <Card className="vivo-card p-4 rounded-sm mt-6 flex flex-wrap gap-4 items-end" data-testid="training-filters">
          <FilterSelect label="Category" testid="filter-category" value={params.category} options={filters.categories} onChange={(v) => setParam("category", v)} />
          <FilterSelect label="Training" testid="filter-training-name" value={params.training_name} options={filters.training_names} onChange={(v) => setParam("training_name", v)} />
          <FilterSelect label="Department" testid="filter-department" value={params.department} options={filters.departments} onChange={(v) => setParam("department", v)} />
          <FilterSelect label="Location" testid="filter-location" value={params.location} options={filters.locations} onChange={(v) => setParam("location", v)} />
          <FilterSelect label="Delivery" testid="filter-delivery-method" value={params.delivery_method} options={filters.delivery_methods} onChange={(v) => setParam("delivery_method", v)} />
          {Object.keys(params).length > 0 && (
            <button onClick={clearFilters} className="h-9 px-3 text-xs uppercase tracking-wider text-[var(--vivo-muted)] hover:text-[var(--vivo-text)]" data-testid="clear-filters">Clear</button>
          )}
          <div className="ml-auto text-xs text-[var(--vivo-muted)]">
            Source: <code className="text-[var(--vivo-text)]">{filters.earliest_date} → {filters.latest_date}</code>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mt-6" data-testid="training-kpis">
        <Kpi icon={GraduationCap} label="Total trained" value={loading ? "—" : formatNumber(overview?.total_trained)} testid="kpi-total-trained" color="#0F4D31" />
        <Kpi icon={Users} label="Unique employees" value={loading ? "—" : formatNumber(overview?.unique_employees)} testid="kpi-unique-employees" color="#ED7C2A" />
        <Kpi icon={Layers} label="Trainings" value={loading ? "—" : formatNumber(overview?.total_trainings)} testid="kpi-total-trainings" color="#C9A961" />
        <Kpi icon={MapPin} label="Departments" value={loading ? "—" : formatNumber(overview?.departments_trained)} testid="kpi-departments" color="#5B8A6E" />
        <Kpi icon={Wallet} label="Actual budget" value={loading ? "—" : fmtKES(overview?.total_actual_budget)} testid="kpi-budget" color="#0F4D31" />
        <Kpi icon={Clock} label="Avg hrs / session" value={loading ? "—" : (overview?.avg_hours_per_session?.toFixed(1) ?? "—")} testid="kpi-avg-hours" color="#ED7C2A" />
      </div>

      {/* Training status table */}
      <Card className="vivo-card p-6 rounded-sm mt-6" data-testid="training-status-card">
        <h3 className="font-display text-xl mb-1">Training status</h3>
        <p className="text-sm text-[var(--vivo-muted)] mb-4">Per training: employees, sessions, hours and budget.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--vivo-muted)] uppercase text-xs tracking-wider">
              <tr><th className="py-2">Training</th><th>Category</th><th>Delivery</th><th>Employees</th><th>Sessions</th><th>Avg hrs</th><th>First → last</th><th className="text-right">Budget</th></tr>
            </thead>
            <tbody>
              {status.map((s, i) => (
                <tr key={i} className="border-t border-[var(--vivo-border)]">
                  <td className="py-2 font-medium">{s.training_name}</td>
                  <td className="text-[var(--vivo-muted)]">{s.category}</td>
                  <td className="text-[var(--vivo-muted)]">{s.delivery_method}</td>
                  <td className="font-mono-num">{formatNumber(s.employees_trained)}</td>
                  <td className="font-mono-num">{formatNumber(s.total_sessions)}</td>
                  <td className="font-mono-num">{s.avg_hours_actual?.toFixed(1)}</td>
                  <td className="text-xs text-[var(--vivo-muted)]">{formatDate(s.first_session)} → {formatDate(s.last_session)}</td>
                  <td className="text-right font-mono-num">{fmtKES(s.total_budget)}</td>
                </tr>
              ))}
              {status.length === 0 && <tr><td colSpan="8" className="py-4 text-sm text-[var(--vivo-muted)] text-center">No trainings in this slice.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* By Department */}
        <Card className="vivo-card p-6 rounded-sm" data-testid="by-department-card">
          <h3 className="font-display text-xl mb-1">By department</h3>
          <p className="text-sm text-[var(--vivo-muted)] mb-3">Unique employees trained.</p>
          <div className="flex items-center gap-4">
            <div className="h-56 w-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={deptPie} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80}>
                    {deptPie.map((e, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex-1 text-sm space-y-1.5">
              {byDept.map((d, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} /> {d.department || "—"}</span>
                  <span className="font-mono-num">{formatNumber(d.unique_employees)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {/* Monthly trend */}
        <Card className="vivo-card p-6 rounded-sm" data-testid="monthly-trend-card">
          <h3 className="font-display text-xl mb-1">Monthly trend</h3>
          <p className="text-sm text-[var(--vivo-muted)] mb-3">Sessions + budget over time.</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6B7280" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total_sessions" stroke="#0F4D31" strokeWidth={2} />
                <Line type="monotone" dataKey="unique_employees" stroke="#ED7C2A" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Duration */}
        <Card className="vivo-card p-6 rounded-sm" data-testid="duration-card">
          <h3 className="font-display text-xl mb-1">Duration · actual vs expected</h3>
          <div className="h-64 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={duration}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="training_name" tick={{ fontSize: 10, fill: "#6B7280" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="total_actual_hours" fill="#0F4D31" name="Actual hrs" />
                <Bar dataKey="total_expected_hours" fill="#C9A961" name="Expected hrs" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Budget */}
        <Card className="vivo-card p-6 rounded-sm" data-testid="budget-card">
          <h3 className="font-display text-xl mb-1">Budget breakdown</h3>
          <ul className="divide-y divide-[var(--vivo-border)] mt-3">
            {budget.map((b, i) => (
              <li key={i} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{b.training_name}</div>
                  <div className="text-xs text-[var(--vivo-muted)]">{b.employees} employees · {fmtKES(b.avg_cost_per_person)} / person</div>
                </div>
                <div className="font-mono-num text-sm shrink-0">{fmtKES(b.actual_cost)}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Lateness */}
      <Card className="vivo-card p-6 rounded-sm mt-6" data-testid="lateness-card">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-display text-xl mb-1 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-[var(--vivo-orange,#ED7C2A)]" /> Lateness analysis</h3>
            <p className="text-sm text-[var(--vivo-muted)]">Adjusted by −3 hours to match Africa/Nairobi.</p>
          </div>
        </div>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--vivo-muted)] uppercase text-xs tracking-wider">
              <tr><th className="py-2">Training</th><th>Participants</th><th>Avg lateness (h)</th><th>Max lateness (h)</th></tr>
            </thead>
            <tbody data-testid="lateness-list">
              {(lateness?.by_training || []).map((r, i) => (
                <tr key={i} className="border-t border-[var(--vivo-border)]">
                  <td className="py-2 font-medium">{r.training_name}</td>
                  <td className="font-mono-num">{formatNumber(r.participants)}</td>
                  <td className="font-mono-num">{r.avg_lateness_hours}</td>
                  <td className="font-mono-num">{r.max_lateness_hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Top employees */}
        <Card className="vivo-card p-6 rounded-sm" data-testid="top-employees-card">
          <h3 className="font-display text-xl mb-1 flex items-center gap-2"><Trophy className="h-4 w-4 text-[var(--vivo-gold)]" /> Top employees</h3>
          <ul className="divide-y divide-[var(--vivo-border)] mt-3" data-testid="top-employees-list">
            {topEmps.map((e, i) => (
              <li key={i} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{e.employee_name}</div>
                  <div className="text-xs text-[var(--vivo-muted)] truncate">{e.designation} · {e.department}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-mono-num text-sm">{e.total_hours_trained?.toFixed(1)}h</div>
                  <div className="text-[var(--vivo-muted)]">{e.unique_trainings} training{e.unique_trainings === 1 ? "" : "s"}</div>
                </div>
              </li>
            ))}
            {topEmps.length === 0 && <li className="py-4 text-sm text-[var(--vivo-muted)]">No data.</li>}
          </ul>
        </Card>

        {/* Facilitators */}
        <Card className="vivo-card p-6 rounded-sm" data-testid="facilitators-card">
          <h3 className="font-display text-xl mb-1">Facilitators</h3>
          <ul className="divide-y divide-[var(--vivo-border)] mt-3">
            {facilitators.map((f, i) => (
              <li key={i} className="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{f.facilitator}</div>
                  <div className="text-xs text-[var(--vivo-muted)]">{f.trainings_conducted} trainings · {f.employees_trained} employees</div>
                </div>
                <div className="font-mono-num text-sm">{fmtKES(f.total_budget)}</div>
              </li>
            ))}
          </ul>
        </Card>

        {/* By delivery method */}
        <Card className="vivo-card p-6 rounded-sm lg:col-span-2" data-testid="by-delivery-method-card">
          <h3 className="font-display text-xl mb-1">By delivery method</h3>
          <ul className="divide-y divide-[var(--vivo-border)] mt-3">
            {byDelivery.map((d, i) => (
              <li key={i} className="py-2.5 flex items-center justify-between gap-3">
                <Badge variant="outline" className="rounded-sm">{d.delivery_method}</Badge>
                <div className="text-xs text-[var(--vivo-muted)] flex gap-4">
                  <span>{formatNumber(d.unique_employees)} employees</span>
                  <span>{formatNumber(d.total_sessions)} sessions</span>
                  <span>{fmtKES(d.total_budget)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function FilterSelect({ label, testid, value, options, onChange }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--vivo-muted)] mb-1.5">{label}</div>
      <select
        value={value || "all"}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 px-3 border border-[var(--vivo-border)] rounded-sm bg-white text-sm min-w-[140px]"
        data-testid={testid}
      >
        <option value="all">Any</option>
        {(options || []).map((o) => <option key={o} value={o}>{o || "—"}</option>)}
      </select>
    </div>
  );
}
