/**
 * Iter 91q — Weekly SOR heatmap for styles aged < 14 weeks.
 * Each row = one style, columns are Week 1..14 with cumulative SOR.
 * Cells are colour-graded green-amber-red so leadership can spot
 * underperformers at a glance.
 */
import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";

const fmtNum = (v) => (v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString());

// Colour grade — matches the SOR thresholds used elsewhere in the dashboard.
const cellTone = (sor) => {
  if (sor == null) return { bg: "bg-zinc-50", text: "text-zinc-300" }; // future week
  if (sor >= 70) return { bg: "bg-emerald-200", text: "text-emerald-900" };
  if (sor >= 50) return { bg: "bg-emerald-100", text: "text-emerald-800" };
  if (sor >= 40) return { bg: "bg-amber-100", text: "text-amber-900" };
  if (sor >= 20) return { bg: "bg-orange-100", text: "text-orange-900" };
  return { bg: "bg-rose-100", text: "text-rose-900" };
};

export default function WeeklySORHeatmap({ countries = [], channels = [], refreshToken = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Iter 91q — Client-side search box (style name, style number, subcategory).
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const countryCsv = countries.length ? countries.map((c) => c.toLowerCase()).join(",") : undefined;
    const locationsCsv = channels.length ? channels.join(",") : undefined;
    api
      .get("/range-mgmt/weekly-sor", { params: { country: countryCsv, channel: locationsCsv } })
      .then((r) => !cancelled && setData(r.data || null))
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [JSON.stringify(countries), JSON.stringify(channels), refreshToken]);

  if (loading) return <div className="card-white p-5 text-[12px] text-muted" data-testid="weekly-sor-loading">Loading weekly SOR…</div>;
  if (error) return <div className="card-white p-5 text-[12px] text-rose-700" data-testid="weekly-sor-error">Failed: {String(error)}</div>;
  if (!data) return null;

  const { weeks = [], rows = [], min_combined } = data;
  // Filter by search term across name/number/subcategory.
  const q = search.trim().toLowerCase();
  const filteredRows = q
    ? rows.filter((r) => {
        const hay = `${r.style_name || ""} ${r.style_number || ""} ${r.subcategory || ""} ${r.brand || ""}`.toLowerCase();
        return hay.includes(q);
      })
    : rows;

  if (rows.length === 0) {
    return (
      <div className="card-white p-5" data-testid="weekly-sor-empty">
        <h3 className="font-extrabold text-[15px]">Weekly SOR · New Styles (&lt; 14 wks)</h3>
        <p className="text-[11.5px] text-muted mt-1.5">No styles aged under 14 weeks in the current filter scope.</p>
      </div>
    );
  }

  return (
    <div className="card-white p-5" data-testid="weekly-sor-heatmap">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="font-extrabold text-[15px]">Weekly SOR · New Styles (&lt; 14 wks)</h3>
          <p className="text-[11.5px] text-muted mt-0.5">
            Cumulative SOR = units sold through week N ÷ (units + current stock) × 100. Future weeks shown blank.
            {min_combined != null && (
              <span className="ml-1 italic">Excluding styles with &lt; {min_combined} combined units (sold + stock).</span>
            )}
            <span className="ml-2 text-[10px]">
              <span className="px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-900 mr-1">≥70</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 mr-1">50–69</span>
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 mr-1">40–49</span>
              <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-900 mr-1">20–39</span>
              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-900">&lt;20</span>
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search style name / # / subcat…"
            className="text-[11.5px] border rounded px-2 py-1 w-56"
            data-testid="weekly-sor-search"
          />
          <span className="text-[11px] text-muted tabular-nums whitespace-nowrap">
            {fmtNum(filteredRows.length)}
            {q && filteredRows.length !== rows.length ? ` / ${fmtNum(rows.length)}` : ""} styles
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-[11px] border-collapse" data-testid="weekly-sor-table">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-border">
              <th className="text-left p-1.5 font-semibold text-muted min-w-[200px]">Style</th>
              <th className="text-left p-1.5 font-semibold text-muted">Launch</th>
              <th className="text-right p-1.5 font-semibold text-muted">Age</th>
              <th className="text-right p-1.5 font-semibold text-muted">Stock</th>
              {weeks.map((w) => (
                <th key={w} className="text-center p-1 font-semibold text-muted w-[42px]">W{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.style_name} className="border-b border-zinc-100">
                <td className="p-1.5">
                  <div className="font-medium truncate max-w-[200px]" title={r.style_name}>{r.style_name}</div>
                  <div className="text-[10px] text-muted">{r.style_number || "—"} · {r.subcategory || "—"}</div>
                </td>
                <td className="p-1.5 text-[10.5px] text-muted">{r.launch_date || "—"}</td>
                <td className="p-1.5 text-right tabular-nums">{r.age_weeks?.toFixed(1)}w</td>
                <td className="p-1.5 text-right tabular-nums">{fmtNum(r.current_stock)}</td>
                {(r.weekly_sor || []).map((sor, idx) => {
                  const tone = cellTone(sor);
                  return (
                    <td key={idx} className={`text-center p-1 ${tone.bg} ${tone.text} font-bold tabular-nums border-l border-white`}>
                      {sor == null ? "" : `${sor.toFixed(0)}`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
