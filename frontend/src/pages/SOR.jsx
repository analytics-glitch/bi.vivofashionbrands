import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import {
  api,
  fmtKES,
  fmtNum,
  fmtPct,
  buildParams,
} from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { MagnifyingGlass, Gauge, Star, TrendDown } from "@phosphor-icons/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

const sorPillClass = (p) => {
  if (p == null) return "pill-neutral";
  if (p < 30) return "pill-red";
  if (p < 60) return "pill-amber";
  return "pill-green";
};
const sorColor = (p) => {
  if (p == null) return "#9ca3af";
  if (p < 30) return "#dc2626";
  if (p < 60) return "#d97706";
  return "#059669";
};

const SOR = () => {
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries, channels } = applied;
  const filters = { dateFrom, dateTo, countries, channels };

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [brandF, setBrandF] = useState("");
  const [typeF, setTypeF] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get("/sor", { params: buildParams(filters) })
      .then((r) => !cancelled && setRows(r.data || []))
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels)]);

  const brands = useMemo(
    () => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort(),
    [rows]
  );
  const types = useMemo(
    () => [...new Set(rows.map((r) => r.product_type).filter(Boolean))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hit =
          (r.style_name || "").toLowerCase().includes(q) ||
          (r.collection || "").toLowerCase().includes(q) ||
          (r.brand || "").toLowerCase().includes(q) ||
          (r.product_type || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (brandF && r.brand !== brandF) return false;
      if (typeF && r.product_type !== typeF) return false;
      return true;
    });
  }, [rows, search, brandF, typeF]);

  const sortedBySor = useMemo(
    () => [...filtered].sort((a, b) => (b.sor_percent || 0) - (a.sor_percent || 0)),
    [filtered]
  );

  const avgSor = useMemo(() => {
    if (!filtered.length) return 0;
    return filtered.reduce((s, r) => s + (r.sor_percent || 0), 0) / filtered.length;
  }, [filtered]);

  const countHigh = filtered.filter((r) => (r.sor_percent || 0) > 60).length;
  const countMid = filtered.filter(
    (r) => (r.sor_percent || 0) >= 30 && (r.sor_percent || 0) <= 60
  ).length;
  const countLow = filtered.filter((r) => (r.sor_percent || 0) < 30).length;

  const top20ByUnits = useMemo(() => {
    return [...filtered]
      .sort((a, b) => (b.units_sold || 0) - (a.units_sold || 0))
      .slice(0, 20)
      .map((r) => ({
        ...r,
        label:
          (r.style_name || "").length > 22
            ? (r.style_name || "").slice(0, 21) + "…"
            : r.style_name,
      }));
  }, [filtered]);

  return (
    <div className="space-y-6" data-testid="sor-page">
      <div>
        <div className="eyebrow">Dashboard · Sell-Out Rate</div>
        <h1 className="font-extrabold text-[28px] tracking-tight mt-1">SOR</h1>
        <p className="text-muted text-[13px] mt-0.5">
          Style-level sell-through analysis
        </p>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              testId="sor-kpi-avg"
              accent
              label="Avg Group SOR"
              value={fmtPct(avgSor)}
              icon={Gauge}
              showDelta={false}
            />
            <KPICard
              testId="sor-kpi-high"
              label="Styles > 60%"
              value={fmtNum(countHigh)}
              icon={Star}
              showDelta={false}
            />
            <KPICard
              testId="sor-kpi-mid"
              label="Styles 30–60%"
              value={fmtNum(countMid)}
              showDelta={false}
            />
            <KPICard
              testId="sor-kpi-low"
              label="Styles < 30%"
              value={fmtNum(countLow)}
              icon={TrendDown}
              showDelta={false}
              higherIsBetter={false}
            />
          </div>

          <div className="card-white p-3 flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-2 input-pill flex-1 min-w-[220px]">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search style, collection, brand…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="sor-search"
                className="bg-transparent outline-none text-[13px] w-full"
              />
            </div>
            <select
              className="input-pill"
              value={brandF}
              onChange={(e) => setBrandF(e.target.value)}
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <select
              className="input-pill"
              value={typeF}
              onChange={(e) => setTypeF(e.target.value)}
            >
              <option value="">All product types</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="card-white p-5" data-testid="sor-chart">
            <SectionTitle
              title="Top 20 styles by units sold"
              subtitle="Bar color = SOR tier (red <30%, amber 30–60%, green >60%)"
            />
            {top20ByUnits.length === 0 ? (
              <Empty />
            ) : (
              <div style={{ width: "100%", height: 360 }}>
                <ResponsiveContainer>
                  <BarChart data={top20ByUnits} margin={{ bottom: 70 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      interval={0}
                      angle={-30}
                      textAnchor="end"
                      height={85}
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v, n, p) => {
                        if (n === "units_sold") return [fmtNum(v), "Units"];
                        return v;
                      }}
                    />
                    <Bar dataKey="units_sold" radius={[5, 5, 0, 0]}>
                      {top20ByUnits.map((r, i) => (
                        <Cell key={i} fill={sorColor(r.sor_percent)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card-white p-5" data-testid="sor-table-card">
            <SectionTitle
              title={`${filtered.length} styles`}
              subtitle="Sorted by sell-out rate descending"
            />
            <div className="overflow-x-auto">
              <table className="w-full data" data-testid="sor-table">
                <thead>
                  <tr>
                    <th>Style Name</th>
                    <th>Collection</th>
                    <th>Brand</th>
                    <th>Product Type</th>
                    <th className="text-right">Units Sold</th>
                    <th className="text-right">Current Stock</th>
                    <th className="text-right">Total Sales</th>
                    <th className="text-right">SOR %</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedBySor.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <Empty />
                      </td>
                    </tr>
                  )}
                  {sortedBySor.map((r, i) => (
                    <tr key={(r.style_name || "") + i}>
                      <td className="font-medium max-w-[280px] truncate" title={r.style_name}>
                        {r.style_name}
                      </td>
                      <td className="text-muted">{r.collection || "—"}</td>
                      <td><span className="pill-neutral">{r.brand || "—"}</span></td>
                      <td className="text-muted">{r.product_type || "—"}</td>
                      <td className="text-right num font-semibold">{fmtNum(r.units_sold)}</td>
                      <td className="text-right num">{fmtNum(r.current_stock)}</td>
                      <td className="text-right num font-bold text-brand">{fmtKES(r.total_sales)}</td>
                      <td className="text-right">
                        <span className={sorPillClass(r.sor_percent)}>
                          {fmtPct(r.sor_percent)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SOR;
