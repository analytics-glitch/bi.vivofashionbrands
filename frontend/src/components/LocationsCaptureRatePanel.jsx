import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtNum, buildParams } from "@/lib/api";
import { SectionTitle } from "@/components/common";
import { Trophy, Warning, UserCircle } from "@phosphor-icons/react";

/**
 * Per-store walk-in capture-rate strip.
 *
 * Capture rate = % of orders at a POS that have a customer profile attached
 * (1 − walk-in share). Higher is better — store team is capturing contacts
 * for re-engagement. We surface:
 *   • Top 3 stores by capture rate (with min order threshold)
 *   • Bottom 3 stores by capture rate (the coaching list)
 *
 * Stores with fewer than `MIN_ORDERS` orders in the period are excluded
 * from the leaderboard so a single Guest checkout at a tiny pop-up doesn't
 * drag the bottom list. They still count toward the group total.
 */
const MIN_ORDERS = 50;

const CapturePill = ({ value }) => {
  const pct = value ?? 0;
  let cls = "pill-green";
  if (pct < 95) cls = "pill-red";
  else if (pct < 98) cls = "pill-amber";
  return <span className={`${cls} num`}>{pct.toFixed(2)}%</span>;
};

const Row = ({ rank, row, tone }) => (
  <div
    className="flex items-center justify-between gap-3 py-1.5 px-2 rounded hover:bg-panel/60 transition-colors"
    data-testid="capture-rate-row"
    title={`${row.channel} · ${row.country} · ${fmtNum(row.walk_in_orders)} walk-ins of ${fmtNum(row.total_orders)} orders`}
  >
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className={`text-[11px] font-bold w-5 text-center ${tone === "good" ? "text-brand" : "text-danger"}`}>
        {rank}
      </span>
      <span className="text-[12.5px] font-medium truncate">{row.channel}</span>
      <span className="text-[10.5px] text-muted hidden sm:inline">{row.country}</span>
    </div>
    <div className="flex items-center gap-3 shrink-0">
      <span className="text-[10.5px] text-muted hidden md:inline">
        {fmtNum(row.walk_in_orders)} / {fmtNum(row.total_orders)} orders
      </span>
      <CapturePill value={row.capture_rate_pct} />
    </div>
  </div>
);

const LocationsCaptureRatePanel = () => {
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;
  const [walkIns, setWalkIns] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setWalkIns(null);
    const params = buildParams({ dateFrom, dateTo, countries, channels });
    api
      .get("/customers/walk-ins", { params })
      .then((r) => { if (!cancelled) setWalkIns(r.data || null); })
      .catch(() => { if (!cancelled) setWalkIns(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  const { top3, bottom3, group } = useMemo(() => {
    const empty = { top3: [], bottom3: [], group: null };
    if (!walkIns || !walkIns.by_location) return empty;
    const groupSummary = {
      capture_rate_pct: walkIns.total_orders
        ? 100 - (walkIns.walk_in_orders / walkIns.total_orders) * 100
        : 100,
      walk_in_orders: walkIns.walk_in_orders,
      total_orders: walkIns.total_orders,
    };
    const eligible = walkIns.by_location.filter(
      (r) => (r.total_orders || 0) >= MIN_ORDERS && r.capture_rate_pct != null
    );
    if (!eligible.length) return { top3: [], bottom3: [], group: groupSummary };
    const sorted = [...eligible].sort((a, b) => b.capture_rate_pct - a.capture_rate_pct);
    return {
      top3: sorted.slice(0, 3),
      bottom3: sorted.slice(-3).reverse(),
      group: groupSummary,
    };
  }, [walkIns]);

  if (loading) {
    return (
      <div className="card-white p-5" data-testid="locations-capture-rate-panel">
        <SectionTitle title="Walk-in capture · by store" subtitle="computing…" />
      </div>
    );
  }
  if (!walkIns || !group) return null;

  return (
    <div className="card-white p-5" data-testid="locations-capture-rate-panel">
      <SectionTitle
        title="Walk-in capture · by store"
        subtitle={
          `Capture rate = % of orders with a customer profile attached. ` +
          `Higher is better — every captured contact unlocks re-engagement (SMS, email, loyalty). ` +
          `Group capture: ${(group.capture_rate_pct).toFixed(2)}% (${fmtNum(group.walk_in_orders)} walk-ins of ${fmtNum(group.total_orders)} orders). ` +
          `Stores with < ${MIN_ORDERS} orders excluded from leaderboard.`
        }
      />
      {!top3.length && !bottom3.length ? (
        <div className="text-[12.5px] text-muted py-3" data-testid="capture-rate-empty">
          Not enough volume yet — no store has crossed {MIN_ORDERS} orders in this period. Widen the date range or come back later.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <div data-testid="capture-top3">
              <div className="flex items-center gap-2 mb-1.5">
                <Trophy size={14} weight="fill" className="text-brand" />
                <span className="eyebrow">Top capture · celebrate</span>
              </div>
              {top3.length === 0 ? (
                <div className="text-[12px] text-muted py-2">No stores meet the {MIN_ORDERS}-order threshold.</div>
              ) : (
                <div className="divide-y divide-border/40">
                  {top3.map((r, i) => <Row key={r.channel} rank={i + 1} row={r} tone="good" />)}
                </div>
              )}
            </div>
            <div data-testid="capture-bottom3">
              <div className="flex items-center gap-2 mb-1.5">
                <Warning size={14} weight="fill" className="text-danger" />
                <span className="eyebrow text-danger">Coach this week · weakest capture</span>
              </div>
              {bottom3.length === 0 ? (
                <div className="text-[12px] text-muted py-2">No stores meet the {MIN_ORDERS}-order threshold.</div>
              ) : (
                <div className="divide-y divide-border/40">
                  {bottom3.map((r, i) => <Row key={r.channel} rank={i + 1} row={r} tone="bad" />)}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10.5px] text-muted">
            <UserCircle size={12} />
            <span>
              Pill colors: <span className="pill-green">≥98%</span>{" "}
              <span className="pill-amber">95–98%</span>{" "}
              <span className="pill-red">&lt;95%</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default LocationsCaptureRatePanel;
