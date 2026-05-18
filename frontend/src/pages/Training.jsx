import React, { useEffect, useMemo, useState } from "react";
import { api, formatKES, formatNumber } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useDateRange } from "@/contexts/DateRangeContext";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  GraduationCap, Users, Wallet, Clock, AlertTriangle, Filter, RefreshCw,
  Calendar, MapPin, Award, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";

const COLORS = ["#0F4D31", "#C9A961", "#5B8A6E", "#ED7C2A", "#E47979", "#6B7280", "#9CA3AF"];

const ALL = "__all__";

function Kpi({ label, value, sub, icon: Icon, testid, color }) {
  return (
    <Card className="vivo-card p-5 rounded-sm" data-testid={testid}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">{label}</div>
        {Icon && <Icon className="h-4 w-4" style={{ color: color || "var(--vivo-navy)" }} />}
      </div>
      <div className="font-display text-3xl mt-2 font-mono-num">{value}</div>
      {sub && <div className="mt-2 text-xs text-[var(--vivo-muted)]">{sub}</div>}
    </Card>
  );
}

function SectionCard({ title, subtitle, icon: Icon, children, testid, action }) {
  return (
    <Card className="vivo-card p-6 rounded-sm" data-testid={testid}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-[var(--vivo-navy)]" />}
            <div className="eyebrow">{title}</div>
          </div>
          {subtitle && <div className="text-xs text-[var(--vivo-muted)] mt-1">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function fmtHours(h) {
  if (h === null || h === undefined) return "—";
  const n = Number(h);
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}h`;
}

export default function Training() {
  const [filters, setFilters] = useState({
    categories: [], training_names: [], departments: [], delivery_methods: [],
    earliest_date: "", latest_date: "",
  });
  const [sel, setSel] = useState({
    date_from: "", date_to: "",
    category: "", training_name: "", department: "", delivery_method: "",
  });

  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [statusRows, setStatusRows] = useState([]);
  const [byDept, setByDept] = useState([]);
  const [byDelivery, setByDelivery] = useState([]);
  const [duration, setDuration] = useState([]);
  const [budget, setBudget] = useState([]);
  const [lateness, setLateness] = useState({ by_training: [], detail: [] });
  const [topEmp, setTopEmp] = useState([]);
  const [trend, setTrend] = useState([]);
  const [facilitators, setFacilitators] = useState([]);

  // Global date range (shared with Overview, Insights, etc.)
  const { range: gRange, setRange: setGRange } = useDateRange();

  // Initial filter list load — clamp the global range to the data-availability window.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/training/filters");
        const earliest = data.earliest_date || "";
        const latest = data.latest_date || "";
        setFilters({
          categories: data.categories || [],
          training_names: data.training_names || [],
          departments: data.departments || [],
          delivery_methods: data.delivery_methods || [],
          earliest_date: earliest,
          latest_date: latest,
        });
        // Clamp global range into [earliest, latest]
        const from = gRange.from && gRange.from > earliest ? gRange.from : earliest;
        const to = gRange.to && gRange.to < latest ? gRange.to : latest;
        setSel((s) => ({ ...s, date_from: from, date_to: to }));
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the user picks a different range here, push it up to the global context.
  const updateGlobalRange = (next) => {
    setSel((s) => ({ ...s, date_from: next.from, date_to: next.to }));
    setGRange({ from: next.from, to: next.to, label: next.label });
  };

  const params = useMemo(() => {
    const p = {};
    Object.entries(sel).forEach(([k, v]) => { if (v) p[k] = v; });
    return p;
  }, [sel]);

  async function refresh() {
    setLoading(true);
    try {
      const q = new URLSearchParams(params).toString();
      const suf = q ? `?${q}` : "";
      const [ov, st, bd, bdm, du, bu, la, te, mt, fa] = await Promise.all([
        api.get(`/training/overview${suf}`),
        api.get(`/training/training-status${suf}`),
        api.get(`/training/by-department${suf}`),
        api.get(`/training/by-delivery-method${suf}`),
        api.get(`/training/duration${suf}`),
        api.get(`/training/budget${suf}`),
        api.get(`/training/lateness${suf}`),
        api.get(`/training/top-employees${suf}${suf ? "&" : "?"}limit=10`),
        api.get(`/training/monthly-trend${suf}`),
        api.get(`/training/facilitators${suf}`),
      ]);
      setOverview(ov.data);
      setStatusRows(st.data || []);
      setByDept(bd.data || []);
      setByDelivery(bdm.data || []);
      setDuration(du.data || []);
      setBudget(bu.data || []);
      setLateness(la.data || { by_training: [], detail: [] });
      setTopEmp(te.data || []);
      setTrend(mt.data || []);
      setFacilitators(fa.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [params]);

  const onSelect = (k) => (v) => setSel((s) => ({ ...s, [k]: v === ALL ? "" : v }));
  const resetFilters = () => setSel({
    date_from: filters.earliest_date || "",
    date_to: filters.latest_date || "",
    category: "", training_name: "", department: "", delivery_method: "",
  });

  // Unique lateness rows (the upstream feed has dupes — keep one per training+employee+date)
  const latenessDetail = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of lateness.detail || []) {
      const k = `${r.training_name}|${r.employee_name}|${r.training_date}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out
      .sort((a, b) => (b.lateness_hours || 0) - (a.lateness_hours || 0))
      .slice(0, 25);
  }, [lateness]);

  return (
    <div className="p-6 md:p-10 max-w-[1500px] mx-auto" data-testid="training-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="eyebrow">Learning & Development</div>
          <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Training</h1>
          <div className="gold-rule mt-4" />
          <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
            Live training analytics from the Vivo Training API — sessions, attendance, budget burn,
            lateness and top performers. All times shown in Africa/Nairobi.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          data-testid="training-refresh"
          disabled={loading}
          className="rounded-sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="vivo-card p-4 md:p-5 rounded-sm mt-8" data-testid="training-filters">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-[var(--vivo-navy)]" />
          <div className="eyebrow">Filters</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Date range</label>
            <div className="mt-1">
              <DateRangePicker
                testid="training-date-range"
                value={{ from: sel.date_from, to: sel.date_to }}
                onChange={({ from, to, label }) => updateGlobalRange({ from, to, label })}
                minDate={filters.earliest_date}
                maxDate={filters.latest_date}
                buttonClassName="w-full justify-start"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Category</label>
            <Select value={sel.category || ALL} onValueChange={onSelect("category")}>
              <SelectTrigger className="mt-1 rounded-sm" data-testid="filter-category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {filters.categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Training</label>
            <Select value={sel.training_name || ALL} onValueChange={onSelect("training_name")}>
              <SelectTrigger className="mt-1 rounded-sm" data-testid="filter-training">
                <SelectValue placeholder="All trainings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All trainings</SelectItem>
                {filters.training_names.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Department</label>
            <Select value={sel.department || ALL} onValueChange={onSelect("department")}>
              <SelectTrigger className="mt-1 rounded-sm" data-testid="filter-department">
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {filters.departments.map((d) => (
                  <SelectItem key={d} value={d}>{d || "—"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Delivery</label>
            <Select value={sel.delivery_method || ALL} onValueChange={onSelect("delivery_method")}>
              <SelectTrigger className="mt-1 rounded-sm" data-testid="filter-delivery">
                <SelectValue placeholder="All methods" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All methods</SelectItem>
                {filters.delivery_methods.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-[var(--vivo-muted)]">
            Data range: {filters.earliest_date || "—"} → {filters.latest_date || "—"}
          </div>
          <Button variant="ghost" size="sm" onClick={resetFilters} data-testid="filter-reset" className="rounded-sm">
            Reset
          </Button>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-6">
        <Kpi
          label="Employees trained"
          value={overview ? formatNumber(overview.unique_employees) : "—"}
          icon={Users} testid="kpi-employees"
        />
        <Kpi
          label="Total sessions"
          value={overview ? formatNumber(overview.total_trained) : "—"}
          sub={overview ? `${overview.total_trainings} distinct trainings` : ""}
          icon={GraduationCap} testid="kpi-sessions"
        />
        <Kpi
          label="Departments"
          value={overview ? formatNumber(overview.departments_trained) : "—"}
          icon={MapPin} testid="kpi-departments"
        />
        <Kpi
          label="Avg hours / session"
          value={overview ? `${(overview.avg_hours_per_session || 0).toFixed(2)}h` : "—"}
          icon={Clock} testid="kpi-avg-hours"
        />
        <Kpi
          label="Actual budget"
          value={overview ? formatKES(overview.total_actual_budget) : "—"}
          icon={Wallet} testid="kpi-budget"
          color="#C9A961"
        />
        <Kpi
          label="Avg lateness"
          value={
            lateness.by_training?.length
              ? `${(
                  lateness.by_training.reduce((s, r) => s + (r.avg_lateness_hours || 0), 0) /
                  lateness.by_training.length
                ).toFixed(2)}h`
              : "—"
          }
          sub="Africa/Nairobi (UTC+3)"
          icon={AlertTriangle} testid="kpi-lateness"
          color="#E47979"
        />
      </div>

      {/* Monthly trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2">
          <SectionCard
            title="Monthly trend"
            subtitle="Sessions and unique employees per month"
            icon={TrendingUp}
            testid="section-trend"
          >
            {trend.length === 0 ? (
              <div className="text-sm text-[var(--vivo-muted)] py-10 text-center">No data for selected filters.</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="month" stroke="#6B7280" fontSize={12} />
                  <YAxis stroke="#6B7280" fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="total_sessions" stroke="#0F4D31" strokeWidth={2} name="Sessions" />
                  <Line type="monotone" dataKey="unique_employees" stroke="#C9A961" strokeWidth={2} name="Employees" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>

        <SectionCard
          title="By delivery method"
          subtitle="How training is being delivered"
          icon={GraduationCap}
          testid="section-delivery"
        >
          {byDelivery.length === 0 ? (
            <div className="text-sm text-[var(--vivo-muted)] py-10 text-center">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={byDelivery}
                  dataKey="total_sessions"
                  nameKey="delivery_method"
                  cx="50%" cy="50%"
                  outerRadius={90}
                  label={(d) => `${d.delivery_method}: ${d.total_sessions}`}
                >
                  {byDelivery.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* Training status + by-department */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <SectionCard
          title="Training programs"
          subtitle={`${statusRows.length} program${statusRows.length === 1 ? "" : "s"} in selection`}
          icon={GraduationCap}
          testid="section-status"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Training</TableHead>
                  <TableHead className="text-right">Employees</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Avg hrs</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statusRows.map((r) => (
                  <TableRow key={r.training_name} data-testid={`status-row-${r.training_name}`}>
                    <TableCell>
                      <div className="font-medium">{r.training_name}</div>
                      <div className="text-xs text-[var(--vivo-muted)]">{r.category} · {r.delivery_method}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono-num">{formatNumber(r.employees_trained)}</TableCell>
                    <TableCell className="text-right font-mono-num">{formatNumber(r.total_sessions)}</TableCell>
                    <TableCell className="text-right font-mono-num">{fmtHours(r.avg_hours_actual)}</TableCell>
                    <TableCell className="text-right font-mono-num">{formatKES(r.total_budget)}</TableCell>
                  </TableRow>
                ))}
                {statusRows.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-[var(--vivo-muted)] py-8">No trainings.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </SectionCard>

        <SectionCard
          title="By department"
          subtitle="Reach across the organisation"
          icon={Users}
          testid="section-by-department"
        >
          {byDept.length === 0 ? (
            <div className="text-sm text-[var(--vivo-muted)] py-10 text-center">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byDept} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" stroke="#6B7280" fontSize={12} />
                <YAxis dataKey="department" type="category" stroke="#6B7280" fontSize={12} width={160} />
                <Tooltip />
                <Legend />
                <Bar dataKey="unique_employees" fill="#0F4D31" name="Employees" />
                <Bar dataKey="total_sessions" fill="#C9A961" name="Sessions" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* Budget + Duration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <SectionCard
          title="Budget by training"
          subtitle="Actual spend and cost-per-person"
          icon={Wallet}
          testid="section-budget"
        >
          {budget.length === 0 ? (
            <div className="text-sm text-[var(--vivo-muted)] py-10 text-center">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={budget}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="training_name" stroke="#6B7280" fontSize={12} />
                <YAxis stroke="#6B7280" fontSize={12} tickFormatter={(v) => `${(v/1000).toFixed(0)}K`} />
                <Tooltip formatter={(v) => formatKES(v)} />
                <Legend />
                <Bar dataKey="actual_cost" fill="#C9A961" name="Actual cost (KES)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Duration: actual vs expected"
          subtitle="Total hours invested per training"
          icon={Clock}
          testid="section-duration"
        >
          {duration.length === 0 ? (
            <div className="text-sm text-[var(--vivo-muted)] py-10 text-center">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={duration}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="training_name" stroke="#6B7280" fontSize={12} />
                <YAxis stroke="#6B7280" fontSize={12} />
                <Tooltip />
                <Legend />
                <Bar dataKey="total_actual_hours" fill="#0F4D31" name="Actual hours" />
                <Bar dataKey="total_expected_hours" fill="#5B8A6E" name="Expected hours" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* Lateness */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <SectionCard
          title="Lateness by training"
          subtitle="Adjusted to Africa/Nairobi (−3h from raw UTC)"
          icon={AlertTriangle}
          testid="section-lateness-summary"
          action={<Badge variant="outline" className="rounded-sm">UTC+3 applied</Badge>}
        >
          <div className="space-y-3">
            {(lateness.by_training || []).map((r) => (
              <div key={r.training_name} className="flex items-center justify-between border-b border-[var(--vivo-border)] pb-2 last:border-0">
                <div>
                  <div className="text-sm font-medium">{r.training_name}</div>
                  <div className="text-xs text-[var(--vivo-muted)]">{formatNumber(r.participants)} participants</div>
                </div>
                <div className="text-right">
                  <div className="font-mono-num text-sm">{fmtHours(r.avg_lateness_hours)}</div>
                  <div className="text-[10px] text-[var(--vivo-muted)] uppercase tracking-[0.15em]">avg / max {fmtHours(r.max_lateness_hours)}</div>
                </div>
              </div>
            ))}
            {(lateness.by_training || []).length === 0 && (
              <div className="text-sm text-[var(--vivo-muted)] py-6 text-center">No lateness data.</div>
            )}
          </div>
        </SectionCard>

        <div className="lg:col-span-2">
          <SectionCard
            title="Most-late sessions"
            subtitle="Top 25 individual lateness events (deduped, −3h applied)"
            icon={AlertTriangle}
            testid="section-lateness-detail"
          >
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Training</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Late by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latenessDetail.map((r, i) => (
                    <TableRow key={i} data-testid={`lateness-row-${i}`}>
                      <TableCell className="font-medium">{r.employee_name}</TableCell>
                      <TableCell className="text-xs text-[var(--vivo-muted)]">{r.department}</TableCell>
                      <TableCell className="text-xs">{r.training_name}</TableCell>
                      <TableCell className="text-xs"><Calendar className="h-3 w-3 inline mr-1" />{r.training_date}</TableCell>
                      <TableCell className="text-right font-mono-num">{fmtHours(r.lateness_hours)}</TableCell>
                    </TableRow>
                  ))}
                  {latenessDetail.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-[var(--vivo-muted)] py-8">No late sessions in selection.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Top employees + facilitators */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="lg:col-span-2">
          <SectionCard
            title="Top employees"
            subtitle="Most-trained team members"
            icon={Award}
            testid="section-top-employees"
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Trainings</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topEmp.map((e, i) => (
                    <TableRow key={e.employee_code || i} data-testid={`top-emp-${i}`}>
                      <TableCell className="text-xs text-[var(--vivo-muted)]">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">{e.employee_name}</div>
                        <div className="text-xs text-[var(--vivo-muted)]">{e.department}</div>
                      </TableCell>
                      <TableCell className="text-xs">{e.designation}</TableCell>
                      <TableCell className="text-right font-mono-num">{e.unique_trainings}</TableCell>
                      <TableCell className="text-right font-mono-num">{formatNumber(e.total_sessions)}</TableCell>
                      <TableCell className="text-right font-mono-num">{fmtHours(e.total_hours_trained)}</TableCell>
                    </TableRow>
                  ))}
                  {topEmp.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-[var(--vivo-muted)] py-8">No employee data.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Facilitators"
          subtitle="Who's delivering the training"
          icon={Users}
          testid="section-facilitators"
        >
          <div className="space-y-3">
            {facilitators.map((f) => (
              <div key={f.facilitator} className="border-b border-[var(--vivo-border)] pb-3 last:border-0">
                <div className="font-medium text-sm">{f.facilitator}</div>
                <div className="text-xs text-[var(--vivo-muted)] mt-1">
                  {f.trainings_conducted} trainings · {formatNumber(f.employees_trained)} employees ·{" "}
                  {formatNumber(f.total_sessions)} sessions
                </div>
                <div className="text-xs text-[var(--vivo-muted)] font-mono-num mt-1">
                  Budget: {formatKES(f.total_budget)}
                </div>
              </div>
            ))}
            {facilitators.length === 0 && (
              <div className="text-sm text-[var(--vivo-muted)] py-6 text-center">No facilitator data.</div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
