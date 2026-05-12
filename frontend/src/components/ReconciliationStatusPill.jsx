import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CheckCircle, Warning, WarningOctagon, Spinner, ArrowsClockwise } from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * Admin-only reconciliation health pill.
 *
 * Polls `/api/admin/reconciliation-check` every 60 s and surfaces a
 * one-glance signal:
 *   • Green  — every cross-page KPI reconciles (Σ countries = /kpis,
 *              walk-in denominator matches, footfall ≥ 1 when /kpis
 *              has orders).
 *   • Amber  — 1-2 checks failed (likely transient upstream lag).
 *   • Red    — 3+ checks failed OR endpoint unreachable.
 *
 * Click → opens a popover listing every check with its expected/got
 * delta and (on failure) the hint pointing to the middleware that
 * drifted. Replaces the email-driven audit loop for ops.
 *
 * Hidden for non-admin roles.
 */
const ReconciliationStatusPill = () => {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [flushing, setFlushing] = useState(false);

  const flushKpiCache = async () => {
    if (flushing) return;
    setFlushing(true);
    try {
      const { data: r } = await api.post("/admin/flush-kpi-cache");
      const c = r?.cleared || {};
      toast.success(
        `KPI cache flushed — ${c.stale_cache_entries || 0} memory entries, ${c.redis_keys || 0} Redis keys removed. Refreshing…`,
      );
      // Bypass the frontend response-cache and force every page to
      // re-fetch /kpis with fresh upstream data.
      setTimeout(() => window.location.reload(), 700);
    } catch (e) {
      toast.error(`Flush failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setFlushing(false);
    }
  };

  useEffect(() => {
    if (!user || user.role !== "admin") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data: d } = await api.get("/admin/reconciliation-check");
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) {
          setData({
            ok: false,
            error: e?.response?.data?.detail || e.message || "check failed",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    // 90 s — recon endpoint takes ~1-2 s on a warm path, longer cold,
    // and the underlying source-of-truth /kpis cache TTL is 5 min so
    // anything tighter than 60 s just adds load without new signal.
    const id = setInterval(tick, 90_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  // Close popover on outside click. Must be declared BEFORE any early
  // return so hooks run in the same order on every render (React rules
  // of hooks).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!e.target.closest?.('[data-testid="recon-status-pill"]') &&
          !e.target.closest?.('[data-testid="recon-status-panel"]')) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  if (!user || user.role !== "admin") return null;

  // Bucket failure count → traffic light. Endpoint-level error treated
  // as RED so a 502 from `/admin/reconciliation-check` itself doesn't
  // hide behind a misleading "green".
  const failed = data?.checks?.filter((c) => c.ok === false) || [];
  const endpointError = !!data?.error;
  const status = loading
    ? "loading"
    : endpointError ? "red"
      : failed.length === 0 ? "green"
        : failed.length <= 2 ? "amber"
          : "red";

  const cls = {
    loading: "bg-panel text-muted border-border",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    red: "bg-rose-50 text-rose-700 border-rose-200",
  }[status];

  const Icon = {
    loading: Spinner,
    green: CheckCircle,
    amber: Warning,
    red: WarningOctagon,
  }[status];

  const label = loading
    ? "Recon —"
    : endpointError ? "Recon offline"
      : failed.length === 0 ? "Recon ✓"
        : `Recon · ${failed.length} fail`;

  const fmtNum = (n) =>
    typeof n === "number" ? n.toLocaleString("en-KE", { maximumFractionDigits: 0 }) : "—";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="recon-status-pill"
        title="Reconciliation health — click for details"
        className={`hidden lg:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10.5px] font-semibold transition-colors ${cls}`}
      >
        <Icon size={11} weight={status === "green" ? "fill" : "regular"}
              className={status === "loading" ? "animate-spin" : ""} />
        <span>{label}</span>
      </button>

      {open && data && (
        <div
          data-testid="recon-status-panel"
          className="absolute right-0 top-full mt-2 w-[440px] max-w-[92vw] z-50 bg-white border border-border rounded-xl shadow-xl p-4 text-foreground"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-bold text-[13px]">Reconciliation Health</div>
              <div className="text-[11px] text-muted">
                Source of truth: <span className="num">/api/kpis</span>
                {data.date ? <> · {data.date}</> : null}
              </div>
            </div>
            {!endpointError && data.source_of_truth && (
              <div className="text-right">
                <div className="text-[10.5px] text-muted">Today total</div>
                <div className="font-extrabold tabular-nums text-[14px]">
                  KES {fmtNum(data.source_of_truth.total_sales_kes)}
                </div>
              </div>
            )}
          </div>

          {endpointError && (
            <div className="rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-rose-700 text-[12px]">
              Reconciliation endpoint unreachable: {data.error}
            </div>
          )}

          {!endpointError && (
            <div className="space-y-1">
              {(data.checks || []).map((c) => (
                <div
                  key={c.name}
                  className={`flex items-start gap-2 px-2 py-1.5 rounded-md ${
                    c.ok ? "bg-emerald-50/50" : "bg-rose-50"
                  }`}
                  data-testid={`recon-check-${c.name}`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {c.ok
                      ? <CheckCircle size={14} weight="fill" className="text-emerald-600" />
                      : <WarningOctagon size={14} weight="fill" className="text-rose-600" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[11.5px] font-semibold ${c.ok ? "text-emerald-800" : "text-rose-800"}`}>
                      {c.name.replace(/_/g, " ")}
                    </div>
                    {c.ok ? (
                      // Compact one-liner for passes.
                      <div className="text-[10.5px] text-muted tabular-nums">
                        expected = got = {fmtNum(c.expected ?? c.kpi_orders)}
                      </div>
                    ) : (
                      <>
                        <div className="text-[10.5px] text-rose-700 tabular-nums">
                          expected {fmtNum(c.expected ?? c.kpi_orders)} · got {fmtNum(c.got ?? c.footfall_orders)} · Δ {fmtNum(c.delta)}
                          {c.delta_pct !== undefined && c.delta_pct !== null
                            ? <> ({c.delta_pct > 0 ? "+" : ""}{c.delta_pct.toFixed(2)}%)</>
                            : null}
                        </div>
                        {c.hint && (
                          <div className="text-[10.5px] text-rose-700/80 mt-0.5 italic">
                            {c.hint}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!endpointError && (data.errors || []).length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-[10.5px] font-semibold text-rose-700 mb-1">Upstream errors</div>
              <ul className="text-[10.5px] text-muted space-y-0.5">
                {data.errors.map((e, i) => (
                  <li key={i}><span className="font-mono">{e.endpoint}</span> — {e.error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-muted">
              Polls every 90 s · click outside to close
            </span>
            <button
              type="button"
              onClick={flushKpiCache}
              disabled={flushing}
              data-testid="recon-flush-kpi-cache"
              title="Hard-flush the /kpis stale cache (in-memory + disk + Redis). Use this when the dashboard is showing zeros despite the upstream BI being healthy."
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10.5px] font-semibold border transition-colors ${
                flushing
                  ? "bg-panel text-muted border-border cursor-wait"
                  : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 hover:border-rose-300"
              }`}
            >
              <ArrowsClockwise size={11} weight="bold" className={flushing ? "animate-spin" : ""} />
              {flushing ? "Flushing…" : "Force-flush KPI cache"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReconciliationStatusPill;
