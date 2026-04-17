import React, { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import {
  api,
  fmtKES,
  fmtNum,
  countryToStoreId,
} from "@/lib/api";
import { useFilters } from "@/lib/filters";
import {
  Sparkle,
  Package,
  Coins,
  MagnifyingGlass,
  TrendUp,
} from "@phosphor-icons/react";

const NewStyles = () => {
  const { dateFrom, dateTo, country, location } = useFilters();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [monthsWindow, setMonthsWindow] = useState(3);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = {
      date_from: dateFrom,
      date_to: dateTo,
      store_id: countryToStoreId(country),
      location: location !== "all" ? location : undefined,
      months: monthsWindow,
    };
    api
      .get("/analytics/new-styles", { params })
      .then((r) => !cancelled && setRows(r.data || []))
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, country, location, monthsWindow]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.product_name || "").toLowerCase().includes(q) ||
        (r.collection || "").toLowerCase().includes(q) ||
        (r.brand || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalUnits = filtered.reduce((s, r) => s + (r.units_sold || 0), 0);
  const totalSales = filtered.reduce((s, r) => s + (r.total_sales || 0), 0);

  return (
    <div className="space-y-8" data-testid="new-styles-page">
      <Topbar
        title="New Style Performance"
        subtitle={`Styles launched within the last ${monthsWindow} months (based on SKU launch month).`}
      />

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              testId="ns-kpi-count"
              accent
              label="New Styles"
              value={fmtNum(filtered.length)}
              sub={`in top-selling SKUs (last ${monthsWindow} months)`}
              icon={Sparkle}
              showDeltas={false}
            />
            <KPICard
              testId="ns-kpi-units"
              label="Units Sold"
              value={fmtNum(totalUnits)}
              icon={Package}
              showDeltas={false}
            />
            <KPICard
              testId="ns-kpi-sales"
              label="Total Sales"
              value={fmtKES(totalSales)}
              icon={Coins}
              showDeltas={false}
            />
            <KPICard
              testId="ns-kpi-avg"
              label="Avg Sales per Style"
              value={fmtKES(filtered.length ? totalSales / filtered.length : 0)}
              icon={TrendUp}
              showDeltas={false}
            />
          </div>

          <div className="card p-6" data-testid="new-styles-table-card">
            <SectionTitle
              title={`${filtered.length} new styles`}
              subtitle="Sorted by newest launch first, then by units sold"
              action={
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2 input-pill">
                    <MagnifyingGlass size={14} className="text-muted" />
                    <input
                      placeholder="Search style, collection, brand…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      data-testid="ns-search"
                      className="bg-transparent outline-none text-sm w-[260px]"
                    />
                  </div>
                  <select
                    value={monthsWindow}
                    onChange={(e) => setMonthsWindow(Number(e.target.value))}
                    data-testid="ns-months"
                    className="input-pill"
                  >
                    <option value={1}>Last 1 month</option>
                    <option value={3}>Last 3 months</option>
                    <option value={6}>Last 6 months</option>
                    <option value={12}>Last 12 months</option>
                  </select>
                </div>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full data" data-testid="new-styles-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product</th>
                    <th>Collection</th>
                    <th>Brand</th>
                    <th>Launch</th>
                    <th className="text-right">SKUs</th>
                    <th className="text-right">Units</th>
                    <th className="text-right">Total Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <Empty label="No new styles for this window / scope." />
                      </td>
                    </tr>
                  )}
                  {filtered.map((r, i) => (
                    <tr key={(r.product_name || "") + i}>
                      <td className="text-muted">{i + 1}</td>
                      <td
                        className="font-medium max-w-[340px] truncate"
                        title={r.product_name}
                      >
                        {r.product_name || "—"}
                      </td>
                      <td className="text-muted">{r.collection || "—"}</td>
                      <td>
                        <span className="pill-green">{r.brand || "—"}</span>
                      </td>
                      <td>
                        <span className="pill-amber">{r.launch_month}</span>
                      </td>
                      <td className="text-right">{fmtNum(r.skus)}</td>
                      <td className="text-right font-semibold">
                        {fmtNum(r.units_sold)}
                      </td>
                      <td className="text-right font-bold text-brand-deep">
                        {fmtKES(r.total_sales)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted mt-4">
              ⓘ Launch dates are decoded from the SKU prefix (MM/YY). Only the
              current top 200 selling SKUs per scope are inspected.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default NewStyles;
