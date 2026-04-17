import React, { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/Topbar";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { api, fmtNum, COUNTRY_FLAGS } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Package, Warning, Storefront, MagnifyingGlass } from "@phosphor-icons/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
} from "recharts";

const Inventory = () => {
  const { country, location } = useFilters();
  const [summary, setSummary] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = {
      country: country !== "all" ? country.toLowerCase() : undefined,
      location: location !== "all" ? location : undefined,
      product: search.trim() || undefined,
    };
    Promise.all([
      api.get("/analytics/inventory-summary", { params }),
      api.get("/analytics/low-stock", { params: { ...params, threshold: 2, limit: 300 } }),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        setSummary(a.data);
        setLowStock(b.data || []);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [country, location, search]);

  const filteredLow = useMemo(() => lowStock, [lowStock]);

  return (
    <div className="space-y-8" data-testid="inventory-page">
      <Topbar
        title="Inventory"
        subtitle="Live stock levels, low-stock alerts, and distribution."
        showDates={false}
      />

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              testId="inv-kpi-units"
              accent
              label="Total Available Units"
              value={fmtNum(summary.total_units)}
              icon={Package}
            />
            <KPICard
              testId="inv-kpi-skus"
              label="Active SKUs"
              value={fmtNum(summary.total_skus)}
              icon={Storefront}
            />
            <KPICard
              testId="inv-kpi-lowstock"
              label="Low-Stock SKUs (≤2)"
              value={fmtNum(summary.low_stock_skus)}
              sub="Re-order threshold"
              icon={Warning}
            />
            <KPICard
              testId="inv-kpi-markets"
              label="Markets"
              value={fmtNum(summary.markets)}
              sub={`${summary.by_country.reduce((s, c) => s + c.locations, 0)} stores`}
              icon={Storefront}
            />
          </div>

          <div className="card p-4 flex flex-wrap items-center gap-3" data-testid="inv-filters">
            <div className="flex items-center gap-2 input-pill flex-1 min-w-[220px]">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search product name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="inv-search"
                className="bg-transparent outline-none text-sm w-full"
              />
            </div>
            <div className="text-xs text-muted">
              Tip: use country & location filters in the header to narrow results.
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="card p-6" data-testid="chart-inv-by-location">
              <SectionTitle
                title="Stock by location"
                subtitle="Top 10 stores by available units"
              />
              {summary.by_location.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ width: "100%", height: 340 }}>
                  <ResponsiveContainer>
                    <BarChart data={summary.by_location.slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid horizontal={false} stroke="#1f2b25" />
                      <XAxis type="number" tickFormatter={(v) => fmtNum(v)} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="location" width={140} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtNum(v)} />
                      <Bar dataKey="units" fill="#00c853" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card p-6" data-testid="chart-inv-by-type">
              <SectionTitle
                title="Stock by product type"
                subtitle="Available units per category"
              />
              {summary.by_product_type.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ width: "100%", height: 340 }}>
                  <ResponsiveContainer>
                    <BarChart data={summary.by_product_type.slice(0, 12)} margin={{ bottom: 70 }}>
                      <CartesianGrid vertical={false} stroke="#1f2b25" />
                      <XAxis
                        dataKey="product_type"
                        interval={0}
                        angle={-25}
                        textAnchor="end"
                        height={86}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis tickFormatter={(v) => fmtNum(v)} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtNum(v)} />
                      <Bar dataKey="units" fill="#00c853" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="card p-6" data-testid="low-stock-section">
            <SectionTitle
              title="Low-stock alerts"
              subtitle="Items with ≤2 units available"
            />
            <div className="overflow-x-auto">
              <table className="w-full data" data-testid="lowstock-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Color</th>
                    <th>Size</th>
                    <th>Location</th>
                    <th>Country</th>
                    <th>SKU</th>
                    <th className="text-right">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLow.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <Empty label="No low-stock items in this view." />
                      </td>
                    </tr>
                  )}
                  {filteredLow.map((r, i) => (
                    <tr key={i}>
                      <td className="font-medium max-w-[300px] truncate" title={r.product_name}>
                        {r.product_name || "—"}
                      </td>
                      <td className="text-muted">{r.color_print || "—"}</td>
                      <td>{r.size || "—"}</td>
                      <td className="text-muted">{r.location_name || "—"}</td>
                      <td>
                        <span className="pill-green">
                          {COUNTRY_FLAGS[(r.country || "").charAt(0).toUpperCase() + (r.country || "").slice(1)] || "🌍"}{" "}
                          {r.country || "—"}
                        </span>
                      </td>
                      <td className="font-mono text-[11.5px] text-muted">{r.sku || "—"}</td>
                      <td className="text-right">
                        <span className={(r.available || 0) <= 1 ? "pill-red" : "pill-amber"}>
                          {fmtNum(r.available)}
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

export default Inventory;
