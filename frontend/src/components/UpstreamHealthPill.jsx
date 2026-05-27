import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Pulse } from "@phosphor-icons/react";

/**
 * Upstream Health pill (Iter 88m, May 2026).
 *
 * Renders a tiny green / amber / red dot in the Topbar showing whether
 * the upstream Vivo BI API (`vivo-bi-api-...europe-west1.run.app`) is
 * currently responsive. Driven by `/api/admin/snapshot-freshness`
 * which now also returns `upstream.{status,last_success_age_sec,open_breakers}`.
 *
 * Tier mapping (same as backend):
 *   • green  — last successful upstream call < 2 min ago
 *   • amber  — last success 2-10 min ago
 *   • red    — last success > 10 min ago OR any circuit-breaker is open
 *   • grey   — never seen a success yet (cold pod start)
 *
 * Lives next to the existing snapshot-freshness pill in the Sidebar
 * topbar. Polls every 30 s — same cadence as the data-refresh loops
 * so it always reflects the latest state.
 */
const UpstreamHealthPill = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await api.get("/admin/snapshot-freshness");
        if (!cancelled) setStats(data?.upstream || null);
      } catch {
        if (!cancelled) setStats(null);
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  if (!user) return null;

  const status = stats?.status || "unknown";
  const ageSec = stats?.last_success_age_sec;
  const openBreakers = stats?.open_breakers || [];

  const tone = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-rose-50 text-rose-700 border-rose-200",
    unknown: "bg-panel text-muted border-border",
  }[status];

  const dotColor = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-rose-500",
    unknown: "bg-zinc-300",
  }[status];

  // Pulse animation on amber/red so it draws the eye.
  const pulse = status === "red" ? "animate-pulse" : "";

  let label;
  if (status === "unknown") label = "Upstream —";
  else if (status === "red" && openBreakers.length) label = `Upstream down · ${openBreakers.length} breaker${openBreakers.length > 1 ? "s" : ""}`;
  else if (status === "red") label = "Upstream down";
  else if (status === "amber") label = "Upstream slow";
  else label = "Upstream OK";

  const tooltip = (() => {
    if (status === "unknown") return "Waiting for first successful upstream call.";
    const ageMin = ageSec != null ? (ageSec / 60).toFixed(1) : "?";
    let t = `Vivo BI API · last successful call ${ageMin} min ago.`;
    if (openBreakers.length) {
      t += `\nCircuit breakers open: ${openBreakers.join(", ")}.`;
    }
    if (status === "red") {
      t += "\n\nUpstream service is failing or rate-limited. The dashboard is serving cached snapshots where available. Check the BI API Cloud Run service logs.";
    } else if (status === "amber") {
      t += "\n\nUpstream is sluggish — last response was a few minutes ago. May indicate transient slowness.";
    } else {
      t += "\n\nAll upstream endpoints responding normally.";
    }
    return t;
  })();

  return (
    <div
      title={tooltip}
      data-testid="upstream-health-pill"
      className={`hidden lg:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10.5px] font-semibold transition-colors ${tone}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor} ${pulse}`} />
      <Pulse size={11} weight={status === "green" ? "fill" : "regular"} />
      <span>{label}</span>
    </div>
  );
};

export default UpstreamHealthPill;
