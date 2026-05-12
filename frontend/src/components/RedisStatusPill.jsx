import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Database } from "@phosphor-icons/react";

/**
 * Admin-only Redis health pill.
 *
 * Polls `/api/admin/redis-stats` every 60s and shows:
 *   • Green pill  → Redis reachable, with key count
 *   • Amber pill  → Redis is configured but temporarily disabled
 *                   (after a recent op failure, auto-cooldown 60s)
 *   • Grey pill   → REDIS_URL unset
 *
 * Hidden for non-admin roles. Click to copy a debug dump to clipboard.
 */
const RedisStatusPill = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || user.role !== "admin") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await api.get("/admin/redis-stats");
        if (!cancelled) setStats(data);
      } catch {
        if (!cancelled) setStats({ enabled: false, reason: "request failed" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  if (!user || user.role !== "admin") return null;

  const enabled = stats?.enabled === true;
  const cls = loading
    ? "bg-panel text-muted border-border"
    : enabled
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : stats?.reason?.includes("unset")
        ? "bg-zinc-100 text-zinc-600 border-zinc-200"
        : "bg-amber-50 text-amber-700 border-amber-200";

  const label = loading
    ? "Cache —"
    : enabled
      ? `Cache · ${stats.total_keys ?? 0} keys`
      : stats?.reason?.includes("unset")
        ? "Cache off"
        : "Cache offline";

  const tooltip = !stats
    ? "Checking…"
    : enabled
      ? `Redis · ${stats.used_memory_human ?? "?"} · ${stats.connected_clients ?? "?"} clients · top: ${(stats.top_paths || []).slice(0, 3).map(t => `${t.path}(${t.count})`).join(", ") || "—"}`
      : `Redis ${stats?.reason || "unknown"}`;

  return (
    <button
      type="button"
      title={tooltip}
      onClick={() => {
        try {
          navigator.clipboard?.writeText(JSON.stringify(stats || {}, null, 2));
        } catch { /* ignore */ }
      }}
      data-testid="redis-status-pill"
      className={`hidden lg:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10.5px] font-semibold transition-colors ${cls}`}
    >
      <Database size={11} weight={enabled ? "fill" : "regular"} />
      <span>{label}</span>
    </button>
  );
};

export default RedisStatusPill;
