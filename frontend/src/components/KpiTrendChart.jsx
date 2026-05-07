import React, { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { api, fmtKES, fmtNum, fmtAxisKES } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle } from "@/components/common";
import { ChartLine } from "@phosphor-icons/react";

/**
 * KPI Trend Line Chart — pick any KPI and watch its shape over the
 * active filter window. Powered by /analytics/kpi-trend, which buckets
 * the date range into day / week / month / quarter slices and returns
 * the full KPI payload (total/net sales, units, orders, ABV, discount,
 * returns) per bucket.
 *
 * Only renders a single line — the totals respect the global filter
 * bar's country selection (CSV passed straight through to the API).
 * Granularity (period) defaults from the range length but can be
 * overridden by the user.
 */
const KPI_OPTIONS = [
  { key: "total_sales",    label: "Total Sales (KES)",     axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#1a5c38" },
  { key: "net_sales",      label: "Net Sales (KES)",       axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#0f3d24" },
  { key: "units_sold",     label: "Units Sold",            axisFmt: fmtNum,     tipFmt: fmtNum, color: "#00c853" },
  { key: "orders",         label: "Orders",                axisFmt: fmtNum,     tipFmt: fmtNum, color: "#0891b2" },
  { key: "avg_basket_size",label: "Avg Basket Size (KES)", axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#d97706" },
  { key: "discount",       label: "Discount (KES)",        axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#dc2626" },
  { key: "returns",        label: "Returns (KES)",         axisFmt: fmtAxisKES, tipFmt: fmtKES, color: "#7c2d12" },
];

const BUCKET_OPTIONS = [
  { key: "day",     label: "Daily" },
  { key: "week",    label: "Weekly" },
  { key: "month",   label: "Monthly" },
  { key: "quarter", label: "Quarterly" },
];

// Default granularity based on the date range length so the chart
// always opens with something readable. User can override.
function defaultBucketFor(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return "day";
  const days = Math.max(
    1,
    Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1
  );
  if (days <= 45) return "day";
  if (days <= 120) return "week";
  if (days <= 540) return "month";
  return "quarter";
}

const KpiTrendChart = ({ dateFrom, dateTo, countries, dataVersion }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kpi, setKpi] = useState("total_sales");
  // userBucket = null → auto-pick from range; otherwise honour user's choice.
  const [userBucket, setUserBucket] = useState(null);
  const autoBucket = useMemo(() => defaultBucketFor(dateFrom, dateTo), [dateFrom, dateTo]);
  const bucket = userBucket || autoBucket;

  const countryParam = useMemo(
    () => (countries && countries.length ? countries.join(",") : undefined),
    [countries]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get("/analytics/kpi-trend", {
        params: { date_from: dateFrom, date_to: dateTo, country: countryParam, bucket },
      })
      .then((r) => { if (!cancelled) setRows(r.data || []); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.detail || e?.message || "Failed to load trend"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, countryParam, bucket, dataVersion]);

  const cfg = KPI_OPTIONS.find((o) => o.key === kpi) || KPI_OPTIONS[0];

  // Single-line series: x = bucket label, y = chosen KPI value.
  const chartData = useMemo(
    () => rows.map((r) => ({ label: r.label, date: r.date, value: r[kpi] || 0 })),
    [rows, kpi]
  );

  const countryLabel = countries && countries.length
    ? countries.join(", ")
    : "All countries";

  return (
    <div className="card-white p-5" data-testid="kpi-trend-chart">
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <ChartLine size={16} weight="duotone" className="text-[#1a5c38]" />
            KPI Trend
          </span>
        }
        subtitle="Pick any KPI and watch its shape over the selected window. Country comes from the filter bar; switch the period dropdown to drill from quarterly down to daily."
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

        <span className="eyebrow ml-2">Period</span>
        <div className="inline-flex rounded-full border border-border overflow-hidden" data-testid="kpi-trend-bucket">
          {BUCKET_OPTIONS.map((b) => {
            const active = bucket === b.key;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => setUserBucket(b.key)}
                data-testid={`kpi-trend-bucket-${b.key}`}
                className={`px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                  active
                    ? "bg-[#1a5c38] text-white"
                    : "bg-white text-[#374151] hover:bg-[#f3f4f6]"
                }`}
                title={`Group by ${b.label.toLowerCase()}`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
        {userBucket && userBucket !== autoBucket && (
          <button
            type="button"
            onClick={() => setUserBucket(null)}
            className="text-[11px] text-muted underline hover:text-[#1a5c38]"
            data-testid="kpi-trend-bucket-reset"
          >
            reset
          </button>
        )}

        <span className="text-[11px] text-muted ml-auto">
          {chartData.length} {bucket === "day" ? "day" : bucket}
          {chartData.length === 1 ? "" : "s"} · {countryLabel}
        </span>
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
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              stroke="#9ca3af"
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" tickFormatter={cfg.axisFmt} />
            <Tooltip
              formatter={(v) => [cfg.tipFmt(v), cfg.label]}
              labelFormatter={(_, payload) => {
                const p = payload && payload[0] && payload[0].payload;
                if (!p) return "";
                return p.date ? `${p.label} · ${p.date}` : p.label;
              }}
              contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #fcd9b6" }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={cfg.color}
              strokeWidth={2.5}
              dot={chartData.length <= 60 ? { r: 3, fill: cfg.color } : false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              name={cfg.label}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default KpiTrendChart;
