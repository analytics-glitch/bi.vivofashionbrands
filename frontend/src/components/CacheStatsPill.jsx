import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Database, X, ArrowsClockwise } from "@phosphor-icons/react";
import AuditHistoryPanel from "@/components/AuditHistoryPanel";

/**
 * CacheStatsPill — admin-only topbar pill that exposes live cache
 * health.
 *
 * Surfaces the data from `/api/admin/cache-stats` so admins can spot:
 *   • Sudden hit-rate drops (regression in the smart-TTL policy)
 *   • Heavy-guard rejections (capacity pressure — needs more pod / more
 *     parallelism)
 *   • Mongo snapshot count going to zero (snapshotter loop crashed)
 *   • RSS memory pressure (approaching the OOM-kill threshold)
 *
 * Polls every 60 s. Click → opens a panel with the breakdown.
 */

const Stat = ({ label, value, hint }) => (
  <div className="flex items-baseline justify-between gap-3 py-1">
    <span className="text-[11.5px] text-muted">
      {label}
      {hint && <span className="text-[10px] text-muted/70 ml-1">· {hint}</span>}
    </span>
    <span className="text-[12px] font-semibold tabular-nums">{value}</span>
  </div>
);

const Bar = ({ label, count, total }) => {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[10.5px]">
        <span className="text-muted">{label}</span>
        <span className="font-bold tabular-nums">{count.toLocaleString()}</span>
      </div>
      <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
        <div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const CacheStatsPill = () => {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const isAdmin = user?.role === "admin";

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const { data: d } = await api.get("/admin/cache-stats");
      setData(d);
    } catch (_) {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [isAdmin, refresh]);

  if (!isAdmin) return null;

  const hitRate = data?.counters_since_boot?.hit_rate_pct;
  const entries = data?.in_process_cache?.entries;
  const totalRej = Object.values(data?.heavy_guard?.rejections_since_boot || {}).reduce(
    (a, b) => a + b, 0,
  );

  // Pill colour: green = healthy hit rate, amber = degraded, red = capacity issues.
  let pillCls = "bg-emerald-50 text-emerald-800 border-emerald-200";
  let pillTitle = "Cache healthy";
  if (totalRej > 0) {
    pillCls = "bg-rose-50 text-rose-800 border-rose-200";
    pillTitle = `${totalRej} heavy-guard rejections — pod under capacity pressure`;
  } else if (hitRate != null && hitRate < 50) {
    pillCls = "bg-amber-50 text-amber-900 border-amber-200";
    pillTitle = "Cache hit rate below 50% — investigate";
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="cache-stats-pill"
        title={pillTitle}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-colors ${pillCls}`}
      >
        <Database size={11} weight="bold" />
        <span className="hidden xl:inline">Cache</span>
        <span className="tabular-nums">
          {hitRate != null ? `${Math.round(hitRate)}%` : "—"}
        </span>
        {totalRej > 0 && (
          <span className="ml-0.5 px-1 rounded-full bg-rose-200 text-rose-900 text-[9px] font-extrabold leading-none">
            {totalRej}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-foreground/20"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute right-3 top-12 w-[340px] rounded-2xl border border-border bg-background shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
            data-testid="cache-stats-panel"
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="text-[13px] font-bold text-foreground flex items-center gap-1.5">
                <Database size={14} weight="bold" />
                Cache health
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading}
                  className="p-1 rounded-md hover:bg-panel text-muted hover:text-foreground"
                  title="Refresh now"
                >
                  <ArrowsClockwise size={12} weight="bold" className={loading ? "animate-spin" : ""} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1 rounded-md hover:bg-panel text-muted hover:text-foreground"
                >
                  <X size={12} weight="bold" />
                </button>
              </div>
            </div>

            {!data ? (
              <div className="text-[11.5px] text-muted py-4 text-center">
                {loading ? "Loading…" : "No data yet"}
              </div>
            ) : (
              <>
                {/* Counters since boot */}
                <div className="space-y-2 mb-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-deep">
                    Hits & misses (since boot)
                  </div>
                  <Bar label="L1 in-process hits" count={data.counters_since_boot.l1_hits} total={Math.max(1, data.counters_since_boot.l1_hits + data.counters_since_boot.l2_redis_hits + data.counters_since_boot.misses)} />
                  <Bar label="L2 Redis hits" count={data.counters_since_boot.l2_redis_hits} total={Math.max(1, data.counters_since_boot.l1_hits + data.counters_since_boot.l2_redis_hits + data.counters_since_boot.misses)} />
                  <Bar label="Upstream misses" count={data.counters_since_boot.misses} total={Math.max(1, data.counters_since_boot.l1_hits + data.counters_since_boot.l2_redis_hits + data.counters_since_boot.misses)} />
                  <Stat label="Overall hit rate" value={`${data.counters_since_boot.hit_rate_pct}%`} />
                  <Stat label="In-flight joins" value={data.counters_since_boot.inflight_joins.toLocaleString()} hint="dedup wins" />
                </div>

                {/* Miss analysis — answers "is the TTL too short?" */}
                {data.miss_analysis && data.miss_analysis.distinct_keys_missed > 0 && (() => {
                  const m = data.miss_analysis;
                  const repeatHigh = m.repeat_miss_pct > 30;
                  return (
                    <div className="space-y-1 mb-3 pt-3 border-t border-border">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-brand-deep">
                        Miss analysis
                      </div>
                      <Stat label="Distinct keys missed" value={m.distinct_keys_missed.toLocaleString()} hint="first-time" />
                      <Stat label="Repeat misses" value={m.repeat_misses.toLocaleString()} hint={`${m.repeat_miss_pct}% of all misses`} />
                      <div className={`mt-1 px-2 py-1.5 rounded-md text-[10.5px] leading-snug ${
                        repeatHigh
                          ? "bg-amber-50 border border-amber-200 text-amber-900"
                          : "bg-emerald-50 border border-emerald-200 text-emerald-900"
                      }`}>
                        {repeatHigh
                          ? <><strong>Investigate.</strong> {m.repeat_miss_pct}% repeat-miss rate suggests TTL is shorter than user request cadence on some keys.</>
                          : <><strong>Healthy.</strong> Misses are mostly first-time queries — TTL policy is well-matched to usage.</>
                        }
                      </div>
                      {m.top_repeat_offenders && m.top_repeat_offenders.length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          <div className="text-[9.5px] uppercase tracking-wider text-muted/80 font-bold">
                            Top repeat-miss keys
                          </div>
                          {m.top_repeat_offenders.slice(0, 5).map((r, i) => (
                            <div key={i} className="flex items-baseline justify-between gap-2 py-0.5">
                              <span className="text-[10px] text-muted truncate font-mono" title={r.key}>
                                {r.key}
                              </span>
                              <span className="text-[10px] tabular-nums font-bold text-rose-700 shrink-0">
                                {r.miss_count}×
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* In-process cache state */}
                <div className="space-y-1 mb-3 pt-3 border-t border-border">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-deep">
                    In-process entries ({entries}/{data.in_process_cache.max_entries})
                  </div>
                  <Stat label="Today (120 s)" value={data.in_process_cache.ttl_buckets.today_120s} />
                  <Stat label="Yesterday (10 min)" value={data.in_process_cache.ttl_buckets.yesterday_600s} />
                  <Stat label="Historical (1 h)" value={data.in_process_cache.ttl_buckets.historical_3600s} />
                  {data.in_process_cache.ttl_buckets.legacy_or_no_date > 0 && (
                    <Stat label="Legacy / no date" value={data.in_process_cache.ttl_buckets.legacy_or_no_date} />
                  )}
                  <Stat label="Avg age" value={`${data.in_process_cache.avg_age_sec}s`} />
                  <Stat label="Mongo snapshots" value={data.mongo_snapshots} />
                </div>

                {/* Heavy guard */}
                <div className="space-y-1 mb-3 pt-3 border-t border-border">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-deep">
                    Heavy-endpoint guard
                  </div>
                  {Object.entries(data.heavy_guard.limits).map(([path, limit]) => {
                    const inUse = data.heavy_guard.in_use[path] || 0;
                    const rej = data.heavy_guard.rejections_since_boot[path] || 0;
                    return (
                      <div key={path} className="flex items-baseline justify-between gap-2 py-0.5">
                        <span className="text-[10.5px] text-muted truncate" title={path}>
                          {path.replace(/^\/(analytics|customers)\//, "")}
                        </span>
                        <span className="text-[10.5px] tabular-nums">
                          <span className={inUse >= limit ? "text-rose-700 font-bold" : "text-foreground"}>
                            {inUse}/{limit}
                          </span>
                          {rej > 0 && (
                            <span className="ml-1.5 text-rose-700 font-bold" title="503s rejected">
                              · {rej}✕
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Process */}
                <div className="space-y-1 pt-3 border-t border-border">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-deep">
                    Pod
                  </div>
                  <Stat label="RSS memory" value={data.process.rss_mb != null ? `${data.process.rss_mb} MB` : "n/a"} />
                  <Stat label="Uptime" value={`${Math.floor(data.process.uptime_sec / 60)}m`} />
                </div>

                {/* Iter 79 — 2-hour audit history. Sits below the
                    existing cache stats per CEO request. Pulls from
                    `/api/admin/audit-log` (its own endpoint) so this
                    panel can refresh independently. */}
                <div className="pt-3 border-t border-border">
                  <AuditHistoryPanel />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default CacheStatsPill;
