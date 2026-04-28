import React, { useEffect, useMemo, useState } from "react";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import ProductThumbnail from "@/components/ProductThumbnail";
import { useThumbnails } from "@/lib/useThumbnails";
import { categoryFor } from "@/lib/productCategory";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { TrendUp, TrendDown, ArrowsHorizontal, MagnifyingGlass, X } from "@phosphor-icons/react";

const TREND_META = {
  "climbing":  { label: "Still climbing",  cls: "pill-green",   icon: <TrendUp size={11} weight="bold" /> },
  "plateau":   { label: "Plateaued",       cls: "pill-amber",   icon: <ArrowsHorizontal size={11} weight="bold" /> },
  "declining": { label: "Declining",       cls: "pill-red",     icon: <TrendDown size={11} weight="bold" /> },
  "no-sales":  { label: "No sales yet",    cls: "pill-neutral", icon: null },
};

// Mini sparkline used in the row — unitless area chart, 100×28.
const Sparkline = ({ weekly, peak }) => {
  if (!weekly || !weekly.length) return <span className="text-muted">—</span>;
  const data = weekly.map((w) => ({ wk: w.week_index, units: w.units }));
  const peakLine = peak || Math.max(...data.map((d) => d.units));
  return (
    <div style={{ width: 110, height: 32 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#16a34a" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#16a34a" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="units"
            stroke="#16a34a"
            strokeWidth={1.5}
            fill="url(#sparkGrad)"
            isAnimationActive={false}
          />
          <ReferenceLine y={peakLine} stroke="#9ca3af" strokeDasharray="2 2" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

/**
 * Builds an aligned table-friendly weekly series. Always pads to
 * `weeks_since_launch` so the sparkline shows the full lifecycle, not just the
 * weeks that had ≥1 sale.
 */
const padWeekly = (weekly, weeks) => {
  const map = new Map(weekly.map((w) => [w.week_index, w]));
  const out = [];
  for (let i = 0; i <= Math.max(weeks, weekly.length - 1); i++) {
    const w = map.get(i);
    out.push(w || { week_index: i, week_start: null, units: 0, sales: 0 });
  }
  return out;
};

/**
 * New Styles · Sales Curve report
 *
 * Tracks every style whose first sale was within the last `days` window. For
 * each style we render the weekly sales-since-launch curve plus a trend pill
 * (climbing / plateaued / declining). Click a row to see the full curve in a
 * larger chart for re-order timing decisions.
 *
 * Data: `/api/analytics/new-styles-curve?days=...`
 */
const NewStylesSalesCurve = () => {
  const { applied } = useFilters();
  const { countries, channels, dataVersion } = applied;
  const [days, setDays] = useState(122);
  const [data, setData] = useState({ rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [search, setSearch] = useState("");
  const [trendFilter, setTrendFilter] = useState("all");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const params = { days };
    if (countries && countries.length === 1) params.country = countries[0];
    if (channels && channels.length === 1) params.channel = channels[0];
    api
      .get("/analytics/new-styles-curve", { params, timeout: 240000 })
      .then(({ data: d }) => {
        if (cancel) return;
        setData(d || { rows: [] });
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
    // eslint-disable-next-line
  }, [days, JSON.stringify(countries), JSON.stringify(channels), dataVersion]);

  const rows = data.rows || [];
  const enriched = useMemo(
    () => rows.map((r) => ({
      ...r,
      category: categoryFor(r.subcategory) || "—",
      weekly_padded: padWeekly(r.weekly || [], r.weeks_since_launch || 0),
    })),
    [rows]
  );

  const filtered = useMemo(() => {
    let out = enriched;
    if (trendFilter !== "all") out = out.filter((r) => r.trend === trendFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      out = out.filter((r) => {
        const hay = `${r.style_name || ""} ${r.brand || ""} ${r.subcategory || ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
    return out;
  }, [enriched, search, trendFilter]);

  const counts = useMemo(() => {
    const c = { climbing: 0, plateau: 0, declining: 0, "no-sales": 0 };
    for (const r of enriched) c[r.trend] = (c[r.trend] || 0) + 1;
    return c;
  }, [enriched]);

  const styleNames = useMemo(() => filtered.map((r) => r.style_name), [filtered]);
  const { urlFor } = useThumbnails(styleNames);

  const expandedRow = useMemo(
    () => enriched.find((r) => r.style_name === expanded) || null,
    [enriched, expanded]
  );

  const columns = useMemo(() => ([
    {
      key: "thumb", label: "", align: "left", sortable: false, mobileHidden: true,
      render: (r) => <ProductThumbnail style={r.style_name} url={urlFor(r.style_name)} size={36} />,
      csv: () => "",
    },
    {
      key: "style_name", label: "Style", align: "left", mobilePrimary: true,
      render: (r) => (
        <div className="max-w-[260px]">
          <div className="font-medium break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{r.style_name}</div>
          <div className="text-[10.5px] text-muted mt-0.5">{r.brand || "—"} · {r.category}</div>
        </div>
      ),
      csv: (r) => r.style_name,
    },
    { key: "subcategory", label: "Subcategory", align: "left", render: (r) => <span className="text-muted">{r.subcategory || "—"}</span> },
    { key: "first_sale", label: "First Sale", align: "left", render: (r) => <span className="text-muted text-[11.5px]">{r.first_sale}</span>, csv: (r) => r.first_sale },
    { key: "weeks_since_launch", label: "Weeks", numeric: true, render: (r) => `${r.weeks_since_launch}w` },
    {
      key: "curve", label: "Sales Curve", align: "left", sortable: false,
      render: (r) => <Sparkline weekly={r.weekly_padded} peak={r.peak_weekly_units} />,
      csv: () => "",
    },
    { key: "peak_weekly_units", label: "Peak/wk", numeric: true, render: (r) => fmtNum(r.peak_weekly_units) },
    { key: "total_units", label: "Total Units", numeric: true, render: (r) => <span className="font-semibold">{fmtNum(r.total_units)}</span> },
    { key: "total_sales", label: "Total Sales", numeric: true, render: (r) => <span className="font-bold">{fmtKES(r.total_sales)}</span>, csv: (r) => r.total_sales },
    {
      key: "trend", label: "Trend", align: "left",
      render: (r) => {
        const m = TREND_META[r.trend] || TREND_META["no-sales"];
        return <span className={`${m.cls} inline-flex items-center gap-1`}>{m.icon}{m.label}</span>;
      },
      csv: (r) => r.trend,
    },
    {
      key: "_action", label: "", align: "left", sortable: false,
      render: (r) => (
        <button
          type="button"
          onClick={() => setExpanded(r.style_name === expanded ? null : r.style_name)}
          data-testid={`new-styles-curve-expand-${r.style_name}`}
          className="px-2 py-1 rounded-full text-[11px] font-semibold border border-border bg-white hover:border-brand/60"
        >
          {expanded === r.style_name ? "Hide" : "Open"}
        </button>
      ),
      csv: () => "",
    },
  ]), [urlFor, expanded]);

  return (
    <div className="space-y-5" data-testid="new-styles-curve-tab">
      <div className="card-white p-5">
        <SectionTitle
          title="New Styles · Sales Curve"
          subtitle={
            <span>
              For every style that first sold in the last <b>{days} days</b>, we plot the
              weekly units-sold curve since launch. Re-order while a style is still
              <b> climbing</b>; mark down or end-of-life when it starts <b>declining</b>.
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-2 mt-3 mb-4">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {[60, 90, 122, 180, 365].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                data-testid={`new-styles-curve-days-${d}`}
                className={`px-3 py-1.5 text-[12px] font-medium border-r last:border-r-0 border-border ${
                  days === d ? "bg-brand text-white" : "bg-white hover:bg-panel"
                }`}
              >
                {d === 365 ? "1Y" : `${d}d`}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {["all", "climbing", "plateau", "declining"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTrendFilter(t)}
                data-testid={`new-styles-curve-trend-${t}`}
                className={`px-3 py-1.5 text-[12px] font-medium border-r last:border-r-0 border-border capitalize ${
                  trendFilter === t ? "bg-brand text-white" : "bg-white hover:bg-panel"
                }`}
              >
                {t === "all" ? `All (${enriched.length})` : `${t} (${counts[t] || 0})`}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlass size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="search"
              placeholder="Filter by style, brand, subcategory…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="new-styles-curve-search"
              className="input-pill pl-7 pr-7 w-full"
              aria-label="Filter styles"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X size={13} weight="bold" />
              </button>
            )}
          </div>
        </div>

        {loading && <Loading />}
        {error && <ErrorBox message={error} />}

        {!loading && !error && (
          <>
            {filtered.length === 0 ? (
              <Empty label="No new styles found in the selected window." />
            ) : (
              <SortableTable
                testId="new-styles-curve-table"
                exportName={`new-styles-sales-curve_${days}d.csv`}
                pageSize={20}
                mobileCards
                initialSort={{ key: "total_units", dir: "desc" }}
                columns={columns}
                rows={filtered}
              />
            )}

            {expandedRow && (
              <div
                className="mt-5 rounded-xl border border-brand/40 bg-panel/40 p-4"
                data-testid={`new-styles-curve-detail-${expandedRow.style_name}`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="font-extrabold text-[16px] leading-tight">{expandedRow.style_name}</div>
                    <div className="text-[11.5px] text-muted mt-0.5">
                      Launched <b>{expandedRow.first_sale}</b> · {expandedRow.weeks_since_launch}w live ·
                      Peak {fmtNum(expandedRow.peak_weekly_units)} units / week ·
                      Total {fmtNum(expandedRow.total_units)} units · {fmtKES(expandedRow.total_sales)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(null)}
                    className="text-muted hover:text-foreground"
                    data-testid="new-styles-curve-detail-close"
                    aria-label="Close detail"
                  >
                    <X size={16} weight="bold" />
                  </button>
                </div>
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={expandedRow.weekly_padded} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="week_index"
                        tick={{ fontSize: 11 }}
                        label={{ value: "weeks since launch", position: "insideBottom", offset: -2, fontSize: 11, fill: "#6b7280" }}
                      />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(v, name) => name === "units" ? [fmtNum(v), "Units"] : [fmtKES(v), "Sales"]}
                        labelFormatter={(wk) => `Week ${wk} (${expandedRow.weekly_padded[wk]?.week_start || "—"})`}
                      />
                      <Line
                        type="monotone"
                        dataKey="units"
                        stroke="#15803d"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "#15803d" }}
                        activeDot={{ r: 5 }}
                      />
                      <ReferenceLine
                        y={expandedRow.peak_weekly_units}
                        stroke="#9ca3af"
                        strokeDasharray="3 3"
                        label={{ value: `peak ${expandedRow.peak_weekly_units}`, position: "right", fontSize: 10, fill: "#6b7280" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[11px] text-muted mt-2">
                  <b>Trend:</b> <span className={(TREND_META[expandedRow.trend] || TREND_META["no-sales"]).cls}>
                    {(TREND_META[expandedRow.trend] || TREND_META["no-sales"]).label}
                  </span>
                  {" · "}Re-order while climbing or plateaued; consider markdown when declining vs peak.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default NewStylesSalesCurve;
