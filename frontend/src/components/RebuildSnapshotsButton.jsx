import React, { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ArrowsClockwise, CheckCircle, Warning } from "@phosphor-icons/react";

/**
 * One-click "Rebuild Snapshots" button (Iter 88o, May 2026).
 *
 * Admin / exec self-service for the curl pair we previously asked the
 * user to run by hand after a classifier rule change:
 *   1) POST /api/admin/cache-clear           (drops poisoned snapshots + Redis)
 *   2) POST /api/admin/full-snapshot-rebuild (re-runs the 35-day Mongo build under the new rules)
 *
 * Lives next to the "Refresh" pill on metric pages. Use it whenever
 * a backend classifier (walk-in rule, customer segmentation, etc.)
 * has changed and the page still shows old aggregated values.
 *
 * Visible to admin / exec roles only.
 */
const RebuildSnapshotsButton = () => {
  const { user } = useAuth();
  const role = (user?.role || "").toLowerCase();
  const allowed = role === "admin" || role === "exec";

  const [state, setState] = useState("idle"); // idle | confirming | running | success | error
  const [msg, setMsg] = useState("");

  if (!allowed) return null;

  const run = async () => {
    setState("running");
    setMsg("Wiping stale snapshots…");
    try {
      const clear = await api.post("/admin/cache-clear");
      const dropped = clear?.data?.analytics_snapshots_dropped ?? 0;
      const redis = clear?.data?.redis_keys_dropped ?? 0;
      setMsg(`Cleared ${dropped} analytics + ${redis} Redis keys. Queuing rebuild…`);
      const rebuild = await api.post("/admin/full-snapshot-rebuild", null, {
        params: { days_back: 35 },
      });
      const eta = rebuild?.data?.expected_completion_sec ?? 300;
      setState("success");
      setMsg(`✓ Rebuild queued — completes in ~${Math.round(eta / 60)} min. Refresh the page after that.`);
      setTimeout(() => { setState("idle"); setMsg(""); }, 12_000);
    } catch (e) {
      setState("error");
      setMsg(e?.response?.data?.detail || e.message || "Rebuild failed");
    }
  };

  if (state === "confirming") {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-amber-300 bg-amber-50 text-[11px] font-medium text-amber-900">
        <span>Rebuild last 35 days? Takes ~5 min.</span>
        <button
          type="button"
          onClick={run}
          data-testid="rebuild-snapshots-confirm-btn"
          className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => setState("idle")}
          className="px-1.5 py-0.5 rounded border border-amber-400 text-[11px] font-semibold hover:bg-amber-100"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (state === "running" || state === "success" || state === "error") {
    const tone =
      state === "success"
        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
        : state === "error"
        ? "border-rose-300 bg-rose-50 text-rose-800"
        : "border-amber-300 bg-amber-50 text-amber-900";
    const Icon = state === "success" ? CheckCircle : state === "error" ? Warning : ArrowsClockwise;
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium ${tone}`}
        data-testid={`rebuild-snapshots-${state}`}
        title={msg}
      >
        <Icon size={11} weight="bold" className={state === "running" ? "animate-spin" : ""} />
        <span className="max-w-[420px] truncate">{msg}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setState("confirming")}
      data-testid="rebuild-snapshots-btn"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-border bg-white hover:bg-brand-soft/60 text-foreground/80 hover:text-foreground transition-colors text-[11px] font-medium"
      title="Wipe stale Mongo snapshots and queue a 35-day rebuild under the current backend rules. Use after a classifier change (e.g. walk-in rules) when the page still shows old aggregated values."
    >
      <ArrowsClockwise size={11} weight="bold" />
      Rebuild Snapshots
    </button>
  );
};

export default RebuildSnapshotsButton;
