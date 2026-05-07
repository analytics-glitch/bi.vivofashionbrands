import React, { useEffect, useState } from "react";
import { api, fmtKES } from "@/lib/api";
import { SectionTitle } from "@/components/common";
import { TrendUp, Calculator } from "@phosphor-icons/react";

/**
 * Custom-Range Sales Projector for the Targets page.
 *
 * Lets store teams pick a date range + (optional) store/country and see:
 *   • Actual sales so far in the picked window
 *   • Daily run-rate
 *   • Projected end-of-period sales
 *
 * Defaults to current month / All stores. Re-fetches `/analytics/sales-projection`
 * on Apply.
 */

// First-of-month and today helpers (local timezone is fine — server is UTC
// but the user picks calendar dates, so this is purely UI default.)
function isoFirstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoEndOfMonth() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

export default function CustomProjectionCard() {
  const [df, setDf] = useState(isoFirstOfMonth);
  const [dt, setDt] = useState(isoEndOfMonth);
  const [channel, setChannel] = useState("");
  const [country, setCountry] = useState("");
  const [stores, setStores] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Hydrate the store selector from the same source the FilterBar uses
  // (sales-summary lists every channel that ever traded). One-shot.
  useEffect(() => {
    api.get("/sales-summary", { params: { date_from: isoFirstOfMonth(), date_to: isoToday() }, timeout: 30000 })
      .then((r) => {
        const seen = new Map();
        for (const row of (r.data || [])) {
          const ch = row.channel;
          if (ch && !seen.has(ch)) seen.set(ch, row.country || "");
        }
        setStores(Array.from(seen.entries()).map(([ch, c]) => ({ channel: ch, country: c })));
      })
      .catch(() => { /* silent — projection still works, store list is just empty */ });
  }, []);

  // Auto-fetch on mount + every Apply.
  const fetchProjection = (params) => {
    setLoading(true);
    setError(null);
    api.get("/analytics/sales-projection", { params })
      .then((r) => setData(r.data || null))
      .catch((e) => setError(e?.response?.data?.detail || e.message || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchProjection({ date_from: df, date_to: dt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () => {
    fetchProjection({
      date_from: df, date_to: dt,
      country: country || undefined,
      channel: channel || undefined,
    });
  };

  const projected = data?.projected_sales || 0;
  const actual = data?.actual_sales || 0;
  const runRate = data?.daily_run_rate || 0;
  const elapsed = data?.days_elapsed || 0;
  const total = data?.total_days || 0;
  const pctComplete = data?.completion_pct || 0;

  return (
    <div className="card-white p-5" data-testid="custom-projection-card">
      <SectionTitle
        title="Custom Sales Projection"
        subtitle="Pick a date range and (optionally) a store to see where you're projected to land. Useful for store managers running mid-month forecasts."
      />

      {/* Filter row */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4 mt-3">
        <label className="text-[11px] font-bold uppercase tracking-wide text-[#6b7280] flex flex-col gap-1">
          From
          <input type="date" value={df} onChange={(e) => setDf(e.target.value)}
                 className="px-2 py-1.5 border border-border rounded-md text-[12px] font-normal normal-case tracking-normal text-foreground"
                 data-testid="custom-proj-from" />
        </label>
        <label className="text-[11px] font-bold uppercase tracking-wide text-[#6b7280] flex flex-col gap-1">
          To
          <input type="date" value={dt} onChange={(e) => setDt(e.target.value)}
                 className="px-2 py-1.5 border border-border rounded-md text-[12px] font-normal normal-case tracking-normal text-foreground"
                 data-testid="custom-proj-to" />
        </label>
        <label className="text-[11px] font-bold uppercase tracking-wide text-[#6b7280] flex flex-col gap-1">
          Country
          <select value={country} onChange={(e) => setCountry(e.target.value)}
                  className="px-2 py-1.5 border border-border rounded-md text-[12px] font-normal normal-case tracking-normal text-foreground"
                  data-testid="custom-proj-country">
            <option value="">All</option>
            <option value="Kenya">Kenya</option>
            <option value="Uganda">Uganda</option>
            <option value="Rwanda">Rwanda</option>
            <option value="Online">Online</option>
          </select>
        </label>
        <label className="text-[11px] font-bold uppercase tracking-wide text-[#6b7280] flex flex-col gap-1">
          Store
          <select value={channel} onChange={(e) => setChannel(e.target.value)}
                  className="px-2 py-1.5 border border-border rounded-md text-[12px] font-normal normal-case tracking-normal text-foreground"
                  data-testid="custom-proj-channel">
            <option value="">All stores</option>
            {stores
              .filter((s) => !country || s.country === country)
              .sort((a, b) => a.channel.localeCompare(b.channel))
              .map((s) => <option key={s.channel} value={s.channel}>{s.channel}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={apply}
          disabled={loading}
          className="btn-primary self-end disabled:opacity-50"
          data-testid="custom-proj-apply"
        >
          <Calculator size={14} weight="bold" className="inline mr-1.5" />
          {loading ? "Calculating…" : "Project"}
        </button>
      </div>

      {error && <div className="text-rose-600 text-[12px] mb-3">{error}</div>}

      {data && total > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="eyebrow">Actual so far</div>
              <div className="text-[20px] sm:text-[24px] font-bold text-brand num" data-testid="custom-proj-actual">
                {fmtKES(actual)}
              </div>
              <div className="text-[11px] text-muted mt-0.5">Day {elapsed} of {total} ({pctComplete.toFixed(0)}%)</div>
            </div>
            <div>
              <div className="eyebrow">Daily run-rate</div>
              <div className="text-[18px] sm:text-[22px] font-bold num" data-testid="custom-proj-runrate">
                {fmtKES(runRate)}
              </div>
              <div className="text-[11px] text-muted mt-0.5">avg/day in window</div>
            </div>
            <div>
              <div className="eyebrow">Projected end-of-period</div>
              <div className="text-[20px] sm:text-[24px] font-extrabold text-brand-deep num" data-testid="custom-proj-projected">
                <TrendUp size={18} className="inline mr-1" weight="bold" />
                {fmtKES(projected)}
              </div>
              <div className="text-[11px] text-muted mt-0.5">if pace holds</div>
            </div>
          </div>
          <div className="mt-4 h-2 rounded-full bg-panel overflow-hidden">
            <div className="h-full bg-brand-strong transition-all" style={{ width: `${Math.min(100, pctComplete)}%` }} />
          </div>
        </>
      ) : !loading && (
        <div className="text-muted text-[12px]">No actuals in this window — projection unavailable.</div>
      )}
    </div>
  );
}
