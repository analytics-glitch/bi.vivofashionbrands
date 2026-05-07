import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { api, fmtKES, fmtNum, fmtAxisKES } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle } from "@/components/common";
import { ChartLine } from "@phosphor-icons/react";

/**
 * KPI Trend Line Chart — pick a KPI from the dropdown and watch its
 * day-by-day curve over the active filter window. Powered by
 * `/daily-trend` (one row per day per country) so it picks up the
 * global country filter automatically.
 *
 * Each KPI has its own value-getter, axis formatter, tooltip formatter
 * and y-axis domain rule so the same chart can show currency, count,
 * or basket-size KPIs without leaking $ vs KES vs unit conventions.
 */
const KPI_OPTIONS = [
  { key: "total_sales", label: "Total Sales (KES)", getter: (d) => d.total_sales || 0, axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#1a5c38" },
  { key: "net_sales", label: "Net Sales (KES)", getter: (d) => d.net_sales || 0, axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#0f3d24" },
  { key: "units_sold", label: "Units Sold", getter: (d) => d.units_sold || 0, axisFmt: fmtNum, tipFmt: fmtNum, color: "#00c853" },
  { key: "orders", label: "Orders", getter: (d) => d.orders || 0, axisFmt: fmtNum, tipFmt: fmtNum, color: "#0891b2" },
  { key: "avg_basket_size", label: "Avg Basket Size (KES)", getter: (d) => d.avg_basket_size || 0, axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#d97706" },
  { key: "discount", label: "Discount (KES)", getter: (d) => d.discount || 0, axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#dc2626" },
  { key: "returns", label: "Returns (KES)", getter: (d) => d.returns_kes || d.returns || 0, axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#7c2d12" },
];

const KpiTrendChart = ({ dateFrom, dateTo, countries, dataVersion }) => {
  const [trends, setTrends] = useState({}); // { country: [rows] }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kpi, setKpi] = useState("total_sales");

  // List of countries to overlay — the filter context's `countries` if set,
  // else default to all four for a comparison view.
  const targetCountries = useMemo(
    () => (countries && countries.length ? countries : ["Kenya", "Uganda", "Rwanda", "Online"]),
    [countries]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(
      targetCountries.map((c) =>
        api
          .get("/daily-trend", { params: { date_from: dateFrom, date_to: dateTo, country: c } })
          .then((r) => [c, r.data || []])
          .catch(() => [c, []])
      )
    )
      .then((entries) => {
        if (cancelled) return;
        setTrends(Object.fromEntries(entries));
      })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load trend"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, JSON.stringify(targetCountries), dataVersion]);

  const cfg = KPI_OPTIONS.find((o) => o.key === kpi) || KPI_OPTIONS[0];

  // Pivot: rows keyed by date, one column per country.
  const chartData = useMemo(() => {
    const dateSet = new Set();
    for (const c of targetCountries) {
      for (const d of (trends[c] || [])) dateSet.add(d.day || d.date);
    }
    const dates = Array.from(dateSet).sort();
    return dates.map((date) => {
      const row = { date };
      for (const c of targetCountries) {
        const r = (trends[c] || []).find((x) => (x.day || x.date) === date);
        row[c] = r ? cfg.getter(r) : 0;
      }
      return row;
    });
  }, [trends, targetCountries, cfg]);

  const palette = ["#1a5c38", "#dc2626", "#0891b2", "#d97706", "#7c2d12"];

  return (
    <div className="card-white p-5" data-testid="kpi-trend-chart">
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <ChartLine size={16} weight="duotone" className="text-[#1a5c38]" />
            KPI Trend
          </span>
        }
        subtitle="Pick any KPI and watch its day-by-day shape over the selected date range. One line per country (or just the countries you filtered to)."
      />

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className="eyebrow">KPI</span>
        <select
          className="input-pill text-[12px]"
          value={kpi}
          onChange={(e) => setKpi(e.target.value)}
          data-testid="kpi-trend-select"
        >
          {KPI_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <span className="text-[11px] text-muted">{chartData.length} day{chartData.length === 1 ? "" : "s"} · {targetCountries.length} countr{targetCountries.length === 1 ? "y" : "ies"}</span>
      </div>

      {loading && <Loading label="Loading trend…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && chartData.length === 0 && (
        <div className="py-10 text-center text-[12px] text-muted">No trend data for this window.</div>
      )}
      {!loading && !error && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 8, right: 18, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#fde7c5" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af"
              tickFormatter={(d) => (d || "").slice(5)} />
            <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" tickFormatter={cfg.axisFmt} />
            <Tooltip
              formatter={(v) => cfg.tipFmt(v)}
              labelFormatter={(d) => `Date: ${d}`}
              contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #fcd9b6" }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {targetCountries.map((c, i) => (
              <Line
                key={c}
                type="monotone"
                dataKey={c}
                stroke={palette[i % palette.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default KpiTrendChart;
