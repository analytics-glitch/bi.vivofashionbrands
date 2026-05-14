import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Database } from "@phosphor-icons/react";

/**
 * Snapshot freshness pill (Feb 2026).
 *
 * Replaces the legacy "Cache off / N keys" Redis health pill in the
 * topbar. The user-facing dashboard is now snapshot-first — every
 * page reads from a pre-warmed Mongo snapshot refreshed every 2 min
 * by the background snapshotter — so the relevant signal is "how
 * fresh is the snapshot" rather than internal cache plumbing.
 *
 * Pulls `/api/admin/snapshot-freshness` every 60 s and shows:
 *   • Green pill ≤ 10 min  — fresh
 *   • Amber pill 10-35 min — slightly stale (Online window)
 *   • Grey pill  > 35 min  — stale beyond Online window
 *
 * Visible to ALL authenticated users (not admin-only) — the freshness
 * matters to every viewer, not just admins.
 */
const RedisStatusPill = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { data } = await api.get("/admin/snapshot-freshness");
        if (!cancelled) setStats(data);
      } catch {
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  if (!user) return null;

  const ageSec = stats?.age_sec;
  const ageMin = typeof ageSec === "number" ? Math.max(1, Math.round(ageSec / 60)) : null;
  // Tier: fresh (<10m) green; mid (10-35m) amber; stale (>35m) grey.
  // No "Cache off" state — we always have a snapshot fallback.
  const tier = ageSec == null
    ? "loading"
    : ageSec <= 600 ? "fresh"
      : ageSec <= 2100 ? "mid"
        : "stale";

  const cls = {
    loading: "bg-panel text-muted border-border",
    fresh: "bg-emerald-50 text-emerald-700 border-emerald-200",
    mid: "bg-amber-50 text-amber-700 border-amber-200",
    stale: "bg-zinc-100 text-zinc-600 border-zinc-200",
  }[tier];

  const label = loading || ageMin == null
    ? "Updated —"
    : ageMin < 1 ? "Updated just now"
      : `Updated ${ageMin} min ago`;

  const tooltip = stats?.snapshot_at
    ? `Snapshot at ${new Date(stats.snapshot_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`
    : "Snapshot age — refreshed every 2 min by the background snapshotter";

  return (
    <div
      title={tooltip}
      data-testid="snapshot-freshness-pill"
      className={`hidden lg:inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10.5px] font-semibold transition-colors ${cls}`}
    >
      <Database size={11} weight={tier === "fresh" ? "fill" : "regular"} />
      <span>{label}</span>
    </div>
  );
};

export default RedisStatusPill;
