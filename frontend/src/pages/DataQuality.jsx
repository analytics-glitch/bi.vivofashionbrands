import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtPct, buildParams } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import RecommendationActionPill from "@/components/RecommendationActionPill";
import { useRecommendationState, STATUS_CONFIG } from "@/lib/useRecommendationState";
import { useOutliers } from "@/lib/useOutliers";
import { ShieldCheck, Warning, MagnifyingGlass, Flag, ChartLineDown } from "@phosphor-icons/react";

/**
 * Data Quality — one admin console for every anomaly the platform
 * detects, with "mark investigated" state per flag reusing the existing
 * recommendation_state Mongo collection (item_type="dq"). Turns the
 * dashboard from a passive reporter into a self-diagnosing tool.
 *
 * Today covers two anomaly families:
 *   1) Footfall conversion outliers (per-store, 2σ around group mean,
 *      plus hard caps at ≥50% and <1% CR).
 *   2) Return-rate outliers on locations (2σ or ≥30% return-rate).
 *
 * Every flag is a single row with:
 *   • scope (store name + metric name + current value)
 *   • severity pill (warn / severe)
 *   • plain-language reason
 *   • action pill (Pending / PO raised="Investigated" / Dismissed / Done)
 *
 * The action pill reuses `RecommendationActionPill`, so the whole
 * close-the-loop UX gets inherited for free: toast, optimistic update,
 * filter-out-resolved by default, show-resolved toggle.
 */

// Stable item_key for a DQ flag — includes metric + location so the
// same store can have multiple open anomalies on different metrics.
const dqKey = (metric, location) => `${metric}::${location}`;

const SEVERITY_PILL = {
  severe: "bg-red-100 text-red-700 border-red-300",
  warn:   "bg-amber-100 text-amber-800 border-amber-300",
};

const DataQuality = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;

  const [footfall, setFootfall] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showResolved, setShowResolved] = useState(false);

  const { stateByKey, setState } = useRecommendationState("dq");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const params = buildParams({ dateFrom, dateTo, countries, channels });
    Promise.all([
      api.get("/footfall", { params }),
      api.get("/sales-summary", { params }),
    ])
      .then(([ffRes, sRes]) => {
        if (cancel) return;
        setFootfall(Array.isArray(ffRes.data) ? ffRes.data : []);
        setSales(Array.isArray(sRes.data) ? sRes.data : []);
        touchLastUpdated();
      })
      .catch((e) => { if (!cancel) setError(e?.message || "Failed to load anomalies"); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [dateFrom, dateTo, countries, channels, dataVersion, touchLastUpdated]);

  // --- Anomaly family 1: Footfall CR outliers ---
  const footfallEnriched = useMemo(() => {
    // Upstream footfall rows carry `location`, `total_footfall`,
    // `conversion_rate`. We filter out Online channels by name prefix.
    return (footfall || []).map((r) => ({
      ...r,
      physical: !/online/i.test(r.location || ""),
    }));
  }, [footfall]);

  const { enriched: ffFlags, stats: ffStats } = useOutliers(footfallEnriched, {
    valueKey: "conversion_rate",
    filter: (r) => r.physical && (r.total_footfall || 0) >= 200,
    hardHi: { at: 50, reason: "Unusually high CR (≥50%) — likely counter miscalibration" },
    hardLo: { at: 1, reason: "Unusually low CR (<1%) — counter may be over-counting traffic" },
    label: "CR",
    valueFmt: (v) => `${v.toFixed(1)}%`,
  });

  // --- Anomaly family 2: Return-rate outliers (from sales-summary) ---
  const salesEnriched = useMemo(() => {
    return (sales || []).map((r) => {
      const ts = r.total_sales || 0;
      const ret = r.returns || 0;
      return {
        ...r,
        return_rate: ts > 0 ? (ret / ts) * 100 : 0,
      };
    });
  }, [sales]);

  const { enriched: salesFlags, stats: rrStats } = useOutliers(salesEnriched, {
    valueKey: "return_rate",
    filter: (r) => (r.total_sales || 0) >= 100000,
    hardHi: { at: 30, reason: "Return rate ≥ 30% — investigate before using this store's numbers." },
    label: "return rate",
    valueFmt: (v) => `${v.toFixed(1)}%`,
  });

  // Unified flag list — one row per (metric × location), sorted by severity
  // then by how far outside the band the value sits.
  const allFlags = useMemo(() => {
    const out = [];
    ffFlags.forEach((r) => {
      if (!r.outlier) return;
      out.push({
        metric: "conversion_rate",
        metric_label: "Conversion",
        location: r.location,
        value: r.conversion_rate || 0,
        value_fmt: fmtPct(r.conversion_rate || 0, 2),
        group_avg: ffStats.mean,
        severity: r.outlier.severity,
        kind: r.outlier.kind,
        reason: r.outlier.reason,
        supporting: `${fmtNum(r.total_footfall)} visitors sampled`,
        distance: ffStats.sd > 0 ? Math.abs((r.conversion_rate - ffStats.mean) / ffStats.sd) : 0,
      });
    });
    salesFlags.forEach((r) => {
      if (!r.outlier) return;
      out.push({
        metric: "return_rate",
        metric_label: "Return rate",
        location: r.channel,
        value: r.return_rate || 0,
        value_fmt: fmtPct(r.return_rate || 0, 2),
        group_avg: rrStats.mean,
        severity: r.outlier.severity,
        kind: r.outlier.kind,
        reason: r.outlier.reason,
        supporting: `${fmtKES(r.total_sales)} sales · ${fmtKES(r.returns || 0)} returns`,
        distance: rrStats.sd > 0 ? Math.abs((r.return_rate - rrStats.mean) / rrStats.sd) : 0,
      });
    });
    const sevWeight = { severe: 2, warn: 1 };
    out.sort((a, b) => (sevWeight[b.severity] || 0) - (sevWeight[a.severity] || 0) || (b.distance - a.distance));
    return out;
  }, [ffFlags, salesFlags, ffStats, rrStats]);

  const visibleFlags = useMemo(() => {
    if (showResolved) return allFlags;
    return allFlags.filter((f) => {
      const s = stateByKey.get(dqKey(f.metric, f.location))?.status;
      return !s || s === "pending";
    });
  }, [allFlags, stateByKey, showResolved]);

  const resolvedCount = useMemo(
    () => allFlags.filter((f) => {
      const s = stateByKey.get(dqKey(f.metric, f.location))?.status;
      return s && s !== "pending";
    }).length,
    [allFlags, stateByKey],
  );

  const severeCount = useMemo(() => allFlags.filter((f) => f.severity === "severe").length, [allFlags]);
  const warnCount = useMemo(() => allFlags.filter((f) => f.severity === "warn").length, [allFlags]);

  return (
    <div className="space-y-4" data-testid="data-quality-page">
      <div>
        <div className="flex items-center gap-2 text-[11px] text-muted font-semibold uppercase tracking-[0.14em]">
          <ShieldCheck size={12} weight="fill" /> Dashboard · Data Quality
        </div>
        <h1 className="mt-0.5 text-[28px] sm:text-[32px] font-bold text-brand-deep tracking-tight leading-[1.15]" data-testid="dq-title">
          Data Quality
        </h1>
        <div className="mt-0.5 text-[13.5px] text-muted max-w-2xl">
          Every anomaly the platform detects, in one place. Flag a store for investigation,
          dismiss false positives, or mark resolved — decisions persist per user.
        </div>
      </div>

      {loading ? (
        <Loading label="Scanning for anomalies…" />
      ) : error ? (
        <ErrorBox message={error} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard accent testId="dq-kpi-total" label="Active flags" value={fmtNum(allFlags.length - resolvedCount)} icon={Warning} showDelta={false}
              sub={resolvedCount > 0 ? `${resolvedCount} already investigated` : "all pending"}
            />
            <KPICard testId="dq-kpi-severe" label="Severe"
              sub="Hard-cap triggered (≥50% CR or ≥30% returns)"
              value={fmtNum(severeCount)} icon={Flag} showDelta={false} higherIsBetter={false}
            />
            <KPICard testId="dq-kpi-warn" label="Warn"
              sub="Outside 2σ of group mean"
              value={fmtNum(warnCount)} icon={ChartLineDown} showDelta={false} higherIsBetter={false}
            />
            <KPICard testId="dq-kpi-metrics" label="Metrics monitored"
              sub="Conversion · Return rate"
              value="2" showDelta={false}
              action={{ label: "Learn how it works", onClick: () => document.querySelector('[data-testid="dq-how"]')?.scrollIntoView({ behavior: "smooth" }) }}
            />
          </div>

          <div className="card-white p-5" data-testid="dq-table-card">
            <SectionTitle
              title={`Flags · ${visibleFlags.length} of ${allFlags.length}${showResolved ? "" : " open"}`}
              subtitle={
                allFlags.length === 0
                  ? "No anomalies in the current window — data looks clean."
                  : "Each row is a single metric + location flagged by the 2σ kernel. Mark as investigated (PO raised), resolved (Done), or dismissed to silence it for next session."
              }
              action={
                <label className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-brand-deep cursor-pointer" data-testid="dq-show-resolved">
                  <input
                    type="checkbox"
                    checked={showResolved}
                    onChange={(e) => setShowResolved(e.target.checked)}
                    className="accent-brand"
                  />
                  Show resolved ({resolvedCount})
                </label>
              }
            />
            {visibleFlags.length === 0 ? (
              <Empty label={
                allFlags.length === 0
                  ? "No anomalies detected — the numbers look trustworthy right now."
                  : "🎉 Every open flag has been investigated. Toggle 'Show resolved' to review."
              } />
            ) : (
              <SortableTable
                testId="dq-flags-table"
                exportName="data-quality-flags.csv"
                pageSize={50}
                initialSort={{ key: "distance", dir: "desc" }}
                columns={[
                  {
                    key: "severity", label: "Severity", align: "left",
                    render: (r) => (
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold border ${SEVERITY_PILL[r.severity]}`}>
                        ⚠ {r.severity === "severe" ? "Severe" : "Warn"}
                      </span>
                    ),
                    csv: (r) => r.severity,
                  },
                  {
                    key: "location", label: "Store / Scope", align: "left",
                    render: (r) => <span className="font-medium">{r.location}</span>,
                  },
                  {
                    key: "metric_label", label: "Metric", align: "left",
                    render: (r) => <span className="pill-neutral">{r.metric_label}</span>,
                  },
                  {
                    key: "value", label: "Value", numeric: true,
                    render: (r) => (
                      <span className="font-bold text-brand-deep num">{r.value_fmt}</span>
                    ),
                    csv: (r) => r.value?.toFixed(2),
                  },
                  {
                    key: "group_avg", label: "Group Avg", numeric: true,
                    render: (r) => <span className="text-muted num">{fmtPct(r.group_avg, 2)}</span>,
                    csv: (r) => r.group_avg?.toFixed(2),
                  },
                  {
                    key: "distance", label: "σ", numeric: true,
                    render: (r) => <span className="pill-neutral">{r.distance.toFixed(1)}σ</span>,
                    csv: (r) => r.distance.toFixed(2),
                  },
                  {
                    key: "reason", label: "Reason", align: "left",
                    sortable: false,
                    render: (r) => <span className="text-[11.5px] text-foreground/80">{r.reason}</span>,
                    csv: (r) => r.reason,
                  },
                  {
                    key: "supporting", label: "Supporting", align: "left", sortable: false,
                    render: (r) => <span className="text-[11px] text-muted">{r.supporting}</span>,
                    csv: (r) => r.supporting,
                  },
                  {
                    key: "__action", label: "Action", align: "left", sortable: false,
                    render: (r) => {
                      const k = dqKey(r.metric, r.location);
                      return (
                        <RecommendationActionPill
                          itemKey={k}
                          state={stateByKey.get(k)}
                          onChange={(status, opts) => setState(k, status, opts)}
                          label="data-quality flag"
                        />
                      );
                    },
                    csv: (r) => stateByKey.get(dqKey(r.metric, r.location))?.status || "pending",
                  },
                ]}
                rows={visibleFlags}
              />
            )}
          </div>

          <div className="card-white p-5" data-testid="dq-how">
            <div className="flex items-center gap-2 mb-2 text-brand-deep">
              <MagnifyingGlass size={14} weight="fill" />
              <div className="text-[13px] font-bold">How this works</div>
            </div>
            <ul className="text-[12.5px] text-foreground/85 space-y-1.5 leading-snug">
              <li>
                <span className="font-bold text-brand-deep">Conversion outliers.</span>{" "}
                Over physical stores with ≥ 200 visitors, we compute the group mean ({fmtPct(ffStats.mean, 2)})
                and standard deviation ({fmtPct(ffStats.sd, 2)}pp). Any store outside ±2σ is flagged.
                Hard caps: ≥ 50% or &lt; 1% always severe.
              </li>
              <li>
                <span className="font-bold text-brand-deep">Return-rate outliers.</span>{" "}
                Over stores with ≥ KES 100k sales, same 2σ math. Group mean {fmtPct(rrStats.mean, 2)} ± {fmtPct(rrStats.sd, 2)}pp.
                Hard cap: ≥ 30% return rate is always severe.
              </li>
              <li>
                <span className="font-bold text-brand-deep">State is yours.</span>{" "}
                Flags you mark as investigated / dismissed / done only affect your session — your
                colleagues see the full list. Reset a decision anytime via the action menu.
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default DataQuality;
