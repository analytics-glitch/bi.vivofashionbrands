import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { Truck, CaretRight, CaretDown } from "@phosphor-icons/react";

/**
 * Replenishment by Color report — well-selling styles whose weeks-of-
 * cover has dropped below 8 weeks. Each style row is expandable to
 * show per-color recommended replen quantities computed from the last
 * 30 days of sales (rate × 8-week target − current SOH).
 */
const ReplenishByColor = () => {
  const { applied } = useFilters();
  const { countries, channels, dataVersion } = applied;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [maxWoc, setMaxWoc] = useState(8);
  const [minSor, setMinSor] = useState(50);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get("/analytics/replenish-by-color", {
      params: {
        country: countries.length ? countries.join(",") : undefined,
        channel: channels.length ? channels.join(",") : undefined,
        max_weeks_of_cover: maxWoc,
        min_sor_percent: minSor,
      },
      timeout: 240000,
    })
      .then((r) => { if (!cancelled) setRows(r.data || []); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to compute replen"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [JSON.stringify(countries), JSON.stringify(channels), maxWoc, minSor, dataVersion]);

  const toggle = (sn) => setExpanded((p) => {
    const n = new Set(p);
    if (n.has(sn)) n.delete(sn); else n.add(sn);
    return n;
  });

  const totalReplen = useMemo(() => rows.reduce((s, r) => s + (r.total_recommended_qty || 0), 0), [rows]);

  return (
    <div className="card-white p-5" data-testid="replen-by-color">
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <Truck size={16} weight="duotone" className="text-[#1a5c38]" />
            Replenishment Recommendations · by Color
          </span>
        }
        subtitle={`Styles selling well (SOR ≥ ${minSor}%) with weeks-of-cover < ${maxWoc} weeks. Click any row to see per-colour recommended quantities. Formula: target = (last-30-day units / 30) × 56 days; recommended = max(0, target − current SOH). Driven by the last-30-day run rate.`}
      />

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="eyebrow">Max weeks of cover</span>
        <div className="inline-flex rounded-md overflow-hidden border border-border">
          {[4, 6, 8, 12].map((w) => (
            <button
              key={w}
              onClick={() => setMaxWoc(w)}
              data-testid={`replen-woc-${w}`}
              className={`text-[11px] font-bold px-3 py-1.5 transition-colors ${maxWoc === w ? "bg-[#1a5c38] text-white" : "bg-white text-[#1a5c38] hover:bg-[#fef3e0]"}`}
            >
              {w} wk
            </button>
          ))}
        </div>
        <span className="eyebrow ml-3">Min SOR %</span>
        <div className="inline-flex rounded-md overflow-hidden border border-border">
          {[40, 50, 65, 80].map((s) => (
            <button
              key={s}
              onClick={() => setMinSor(s)}
              data-testid={`replen-sor-${s}`}
              className={`text-[11px] font-bold px-3 py-1.5 transition-colors ${minSor === s ? "bg-[#1a5c38] text-white" : "bg-white text-[#1a5c38] hover:bg-[#fef3e0]"}`}
            >
              {s}%
            </button>
          ))}
        </div>
        {!loading && (
          <span className="text-[12px] text-muted ml-auto">
            <strong>{fmtNum(rows.length)}</strong> styles · <strong className="text-[#1a5c38]">{fmtNum(totalReplen)}</strong> units to replenish
          </span>
        )}
      </div>

      {loading && <Loading label="Crunching last-30-day sales rate per colour…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && rows.length === 0 && (
        <div className="py-10 text-center text-[12px] text-muted">No styles need replenishment under these thresholds. 🎯</div>
      )}
      {!loading && !error && rows.length > 0 && (
        <SortableTable
          testId="replen-by-color-table"
          exportName="replenish-by-color.csv"
          pageSize={20}
          initialSort={{ key: "total_recommended_qty", dir: "desc" }}
          rowKey={(r) => r.style_name}
          renderExpansion={(r) => (
            <div className="bg-[#fff8ee] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[#1a5c38] font-bold mb-2">
                Per-color breakdown · {r.colors.length} color{r.colors.length === 1 ? "" : "s"}
              </div>
              <table className="w-full text-[12.5px]" data-testid={`replen-colors-${r.style_name}`}>
                <thead className="text-[10px] uppercase text-muted">
                  <tr>
                    <th className="text-left py-1">Color</th>
                    <th className="text-right py-1">30d Units</th>
                    <th className="text-right py-1">SOH</th>
                    <th className="text-right py-1">Target</th>
                    <th className="text-right py-1">Replen Qty</th>
                    <th className="text-right py-1">% of Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#fce6cc]">
                  {r.colors.map((c) => (
                    <tr key={c.color}>
                      <td className="py-1.5 font-semibold">{c.color}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtNum(c.units_30d)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtNum(c.soh_total)}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted">{fmtNum(c.target_qty)}</td>
                      <td className="py-1.5 text-right tabular-nums font-extrabold text-[#1a5c38]">
                        {c.recommended_qty > 0 ? `+${fmtNum(c.recommended_qty)}` : "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted">{c.pct_of_style_sales.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          columns={[
            { key: "_expand", label: "", align: "left", sortable: false,
              render: (r) => (
                <button
                  className="text-[#1a5c38] hover:bg-[#fef3e0] rounded p-0.5"
                  onClick={(e) => { e.stopPropagation(); toggle(r.style_name); }}
                  aria-label="Toggle colors"
                >
                  {expanded.has(r.style_name) ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
                </button>
              ),
              csv: () => "" },
            { key: "style_name", label: "Style", align: "left",
              render: (r) => (
                <div>
                  <div className="font-semibold text-[12.5px] leading-snug max-w-[240px] overflow-hidden"
                       style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                       title={r.style_name}>
                    {r.style_name}
                  </div>
                  <div className="text-[10px] text-muted">{r.brand} · {r.subcategory}</div>
                </div>
              ),
              csv: (r) => r.style_name },
            { key: "sor_percent", label: "SOR %", numeric: true,
              render: (r) => <span className="font-bold">{r.sor_percent.toFixed(0)}%</span> },
            { key: "weeks_of_cover", label: "Weeks of Cover", numeric: true,
              render: (r) => {
                const w = r.weeks_of_cover;
                const cls = w < 2 ? "pill-red" : w < 4 ? "pill-amber" : "pill-neutral";
                return <span className={cls}>{w.toFixed(1)} wk</span>;
              },
              csv: (r) => r.weeks_of_cover },
            { key: "total_units_30d", label: "30d Units", numeric: true,
              render: (r) => fmtNum(r.total_units_30d) },
            { key: "total_soh", label: "Current SOH", numeric: true,
              render: (r) => fmtNum(r.total_soh) },
            { key: "total_recommended_qty", label: "Recommend Replen", numeric: true,
              render: (r) => <span className="font-extrabold text-[#1a5c38]">+{fmtNum(r.total_recommended_qty)}</span>,
              csv: (r) => r.total_recommended_qty },
            { key: "colors_count", label: "Colors", numeric: true,
              render: (r) => fmtNum(r.colors?.length || 0),
              sortValue: (r) => (r.colors?.length || 0) },
          ]}
          rows={rows.map((r) => ({ ...r, _expanded: expanded.has(r.style_name) }))}
        />
      )}

      {/* Always-shown breakdown for expanded rows (since SortableTable doesn't natively support expansion). */}
      {!loading && rows.length > 0 && (
        <div className="mt-3 space-y-2">
          {rows.filter((r) => expanded.has(r.style_name)).map((r) => (
            <div key={r.style_name} className="rounded-lg border border-[#fcd9b6] overflow-hidden" data-testid={`replen-detail-${r.style_name}`}>
              <div className="bg-[#fef3e0] px-3 py-2 text-[12.5px] font-bold text-[#0f3d24]">
                {r.style_name} · per-color breakdown
              </div>
              <table className="w-full text-[12.5px]">
                <thead className="text-[10.5px] uppercase tracking-wide text-muted bg-[#fff8ee]">
                  <tr>
                    <th className="text-left py-1.5 px-3">Color</th>
                    <th className="text-right py-1.5 px-3">30-day Units</th>
                    <th className="text-right py-1.5 px-3">Current SOH</th>
                    <th className="text-right py-1.5 px-3">8-week Target</th>
                    <th className="text-right py-1.5 px-3">Recommended Qty</th>
                    <th className="text-right py-1.5 px-3">% of Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#fce6cc] bg-white">
                  {r.colors.map((c) => (
                    <tr key={c.color} className="hover:bg-[#fff8ee]">
                      <td className="py-2 px-3 font-semibold">{c.color}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtNum(c.units_30d)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtNum(c.soh_total)}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted">{fmtNum(c.target_qty)}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-extrabold text-[#1a5c38]">
                        {c.recommended_qty > 0 ? `+${fmtNum(c.recommended_qty)}` : "—"}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-muted">{c.pct_of_style_sales.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReplenishByColor;
