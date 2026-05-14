import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  ClockCounterClockwise, CheckCircle, Warning, XCircle,
  CaretDown, CaretUp, ArrowsClockwise, EnvelopeSimple, Play,
} from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * AuditHistoryPanel — admin view of the standing 2-hour audit.
 *
 * Iter 79 — surfaces /api/admin/audit-log so admins can see at a
 * glance whether the automated monitor is healthy, what auto-fixes
 * fired in the last day, and which entries needed human attention.
 */
const _STATUS_META = {
  HEALTHY:  { cls: "pill-green",  icon: CheckCircle, label: "HEALTHY" },
  WARNING:  { cls: "pill-amber",  icon: Warning,     label: "WARNING" },
  CRITICAL: { cls: "pill-red",    icon: XCircle,     label: "CRITICAL" },
};

const fmtTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      timeZone: "Africa/Nairobi",
      hour: "2-digit", minute: "2-digit",
      day: "2-digit", month: "short",
    });
  } catch { return iso; }
};

const StatusPill = ({ status }) => {
  const meta = _STATUS_META[status] || _STATUS_META.HEALTHY;
  const Icon = meta.icon;
  return (
    <span className={`${meta.cls} inline-flex items-center gap-1`} data-testid={`audit-pill-${status}`}>
      <Icon size={11} weight="bold" />
      {meta.label}
    </span>
  );
};

const AuditHistoryPanel = () => {
  const [rows, setRows] = useState([]);
  const [emailOn, setEmailOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [openRow, setOpenRow] = useState(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/admin/audit-log", { params: { limit: 24 } });
      setRows(r.data?.rows || []);
      setEmailOn(!!r.data?.email_configured);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const runNow = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const r = await api.post("/admin/run-audit-now");
      const queuedAt = r.data?.queued_at;
      toast.success("Audit queued — running now", {
        description: "Takes ~2 min. Refreshing automatically when done.",
        duration: 4000,
      });
      // Poll the audit-log endpoint every 10 s until a NEWER row appears.
      // We compare against `latest.timestamp` captured at click time.
      const beforeTs = rows[0]?.timestamp;
      let attempts = 0;
      const tick = async () => {
        attempts += 1;
        try {
          const lr = await api.get("/admin/audit-log", { params: { limit: 1 } });
          const newest = lr.data?.rows?.[0];
          if (newest && newest.timestamp !== beforeTs) {
            setRows(prev => [newest, ...prev.filter(r => r.timestamp !== newest.timestamp)]);
            toast.success(`Audit complete — ${newest.status}`, {
              description: newest.issues_found
                ? `Found ${newest.issues_found}, auto-fixed ${newest.issues_auto_fixed || 0}`
                : "All checks passed",
            });
            await load();
            setRunning(false);
            return;
          }
        } catch { /* ignore — keep polling */ }
        if (attempts < 30) {  // 30×10s = 5 min cap
          setTimeout(tick, 10_000);
        } else {
          toast.message("Audit still running — refresh manually when ready");
          setRunning(false);
        }
      };
      setTimeout(tick, 15_000);
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Request failed";
      toast.error("Couldn't queue audit", { description: msg });
      setRunning(false);
    }
  }, [running, rows, load]);

  useEffect(() => { load(); }, [load]);

  const latest = rows[0];
  const visible = expanded ? rows : rows.slice(0, 5);

  // Compact summary line that lives in the topbar / cache-stats pill
  // area. Renders even when no rows exist yet (first audit hasn't fired).
  const summary = useMemo(() => {
    if (loading) return "Loading audit history…";
    if (!latest) return "No audits yet — schedule cron-job.org to POST /api/run-audit";
    return `${_STATUS_META[latest.status]?.label || latest.status} · ${fmtTime(latest.timestamp)} EAT`;
  }, [loading, latest]);

  return (
    <div className="card-white p-4 sm:p-5 space-y-3" data-testid="audit-history-panel">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ClockCounterClockwise size={18} weight="duotone" className="text-brand-deep" />
          <div>
            <div className="font-bold text-[14px] text-[#0f3d24]">2-hour audit log</div>
            <div className="text-[11px] text-muted">{summary}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`pill ${emailOn ? "pill-green" : "pill-amber"} inline-flex items-center gap-1`}
            title={emailOn
              ? "Alert emails configured — CRITICAL events and persistent WARNINGs are emailed."
              : "Set SMTP_HOST / SMTP_USER / SMTP_PASSWORD / ALERT_RECIPIENTS in backend/.env to enable email."}
            data-testid="audit-email-pill"
          >
            <EnvelopeSimple size={11} weight="bold" /> {emailOn ? "Email ON" : "Email OFF"}
          </span>
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className={`text-[11px] font-semibold inline-flex items-center gap-1 px-2.5 py-1 rounded-md border transition-colors ${
              running
                ? "bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed"
                : "bg-brand-deep text-white border-brand-deep hover:bg-brand"
            }`}
            data-testid="audit-run-now"
            title="Trigger the 2-hour audit on demand (admin only)"
          >
            {running ? (
              <>
                <ArrowsClockwise size={12} className="animate-spin" />
                Running…
              </>
            ) : (
              <>
                <Play size={12} weight="fill" />
                Run audit now
              </>
            )}
          </button>
          <button
            type="button"
            onClick={load}
            className="text-[11px] inline-flex items-center gap-1 text-brand-deep hover:text-brand"
            data-testid="audit-refresh"
          >
            <ArrowsClockwise size={12} /> Refresh
          </button>
        </div>
      </div>

      {!loading && rows.length === 0 && (
        <div className="text-[12.5px] text-muted py-3">
          The first audit hasn't run yet. Point cron-job.org at
          <code className="px-1.5 py-0.5 mx-1 rounded bg-[#fff8ee] text-[11px] font-mono">POST /api/run-audit?secret=&lt;AUDIT_TRIGGER_SECRET&gt;</code>
          with a 2-hour schedule and the table below will populate.
        </div>
      )}

      {rows.length > 0 && (
        <table className="w-full text-[12px]" data-testid="audit-history-table">
          <thead className="bg-[#fef9f0] text-[10.5px] uppercase tracking-wide text-[#6b7280]">
            <tr>
              <th className="text-left py-2 px-2">When</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-right py-2 px-2">Slowest</th>
              <th className="text-right py-2 px-2">Cache hit</th>
              <th className="text-right py-2 px-2">RSS</th>
              <th className="text-right py-2 px-2">Found</th>
              <th className="text-right py-2 px-2">Auto-fixed</th>
              <th className="text-right py-2 px-2">Escalated</th>
              <th className="py-2 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#fce6cc]">
            {visible.map((r, i) => {
              const open = openRow === i;
              const fixes = r.fix_details || [];
              const sysH = r.system_health || {};
              const perf = r.performance || {};
              return (
                <React.Fragment key={r.timestamp}>
                  <tr
                    className="hover:bg-[#fff8ee] cursor-pointer"
                    onClick={() => setOpenRow(open ? null : i)}
                    data-testid={`audit-row-${i}`}
                  >
                    <td className="py-2 px-2 whitespace-nowrap">{fmtTime(r.timestamp)} EAT</td>
                    <td className="py-2 px-2"><StatusPill status={r.status} /></td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {perf.slowest_ms != null
                        ? <>{perf.slowest_ms}<span className="text-muted ml-0.5">ms</span></>
                        : "—"}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {sysH.cache_hit_rate != null ? `${sysH.cache_hit_rate}%` : "—"}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {sysH.rss_mb != null ? `${sysH.rss_mb}MB` : "—"}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.issues_found}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-emerald-700 font-semibold">{r.issues_auto_fixed}</td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {r.issues_escalated > 0
                        ? <span className="text-red-600 font-semibold">{r.issues_escalated}</span>
                        : <span className="text-muted">0</span>}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {fixes.length > 0 && (open
                        ? <CaretUp size={12} className="text-muted inline" />
                        : <CaretDown size={12} className="text-muted inline" />)}
                    </td>
                  </tr>
                  {open && fixes.length > 0 && (
                    <tr><td colSpan={9} className="bg-[#fffaf2] px-4 py-3">
                      <div className="text-[11.5px] text-[#0f3d24] space-y-1.5">
                        {fixes.map((f, j) => (
                          <div key={j} className="border-l-2 pl-2"
                            style={{borderColor: f.resolved ? "#16a34a" : "#dc2626"}}
                            data-testid={`audit-fix-${i}-${j}`}>
                            <div className="font-semibold">{f.issue}</div>
                            {f.attempt_1 && <div>Attempt 1: {f.attempt_1} → <i>{f.attempt_1_result}</i></div>}
                            {f.attempt_2 && <div>Attempt 2: {f.attempt_2} → <i>{f.attempt_2_result}</i></div>}
                            <div>
                              {f.resolved
                                ? <span className="text-emerald-700">✅ Auto-fixed</span>
                                : <span className="text-red-600">❌ Escalated — email sent</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {rows.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-[11.5px] text-brand-deep hover:text-brand font-semibold"
          data-testid="audit-toggle-expand"
        >
          {expanded ? "Show last 5 only" : `View full log (${rows.length} entries)`}
        </button>
      )}
    </div>
  );
};

export default AuditHistoryPanel;
