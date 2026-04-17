import React, { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/Topbar";
import KPICard from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { api, fmtNumber, COUNTRY_FLAGS } from "@/lib/api";
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
  const { country } = useFilters();
  const [summary, setSummary] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = country !== "all" ? { country: country.toLowerCase() } : {};
    Promise.all([
      api.get("/analytics/inventory-summary", { params }),
      api.get("/analytics/low-stock", { params: { ...params, threshold: 2, limit: 100 } }),
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
  }, [country]);

  const filteredLow = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lowStock;
    return lowStock.filter(
      (r) =>
        (r.product_name || "").toLowerCase().includes(q) ||
        (r.sku || "").toLowerCase().includes(q) ||
        (r.location_name || "").toLowerCase().includes(q)
    );
  }, [lowStock, search]);

  return (
    <div className="space-y-8" data-testid="inventory-page">
      <Topbar
        title="Inventory"
        subtitle="Stock levels, low-stock alerts, and distribution across stores."
        showCountry
      />

      {loading && <Loading label="Loading inventory…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              testId="inv-kpi-units"
              tone="dark"
              label="Total available units"
              value={fmtNumber(summary.total_units)}
              icon={Package}
            />
            <KPICard
              testId="inv-kpi-skus"
              label="Active SKUs"
              value={fmtNumber(summary.total_skus)}
              icon={Storefront}
            />
            <KPICard
              testId="inv-kpi-lowstock"
              label="Low-stock SKUs (≤1)"
              value={fmtNumber(summary.low_stock_skus)}
              sub="Re-order threshold"
              icon={Warning}
            />
            <KPICard
              testId="inv-kpi-countries"
              label="Markets"
              value={fmtNumber(summary.by_country.length)}
              sub={`${summary.by_country.reduce((s, c) => s + c.locations, 0)} stores`}
              icon={Storefront}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-surface p-6" data-testid="chart-inv-by-location">
              <SectionTitle title="Stock by location" subtitle="Top 10 stores by available units" />
              {summary.by_location.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ width: "100%", height: 320 }}>
                  <ResponsiveContainer>
                    <BarChart data={summary.by_location.slice(0, 10)} layout="vertical">
                      <CartesianGrid horizontal={false} stroke="#E5E0D8" />
                      <XAxis type="number" tickFormatter={(v) => fmtNumber(v)} />
                      <YAxis type="category" dataKey="location" width={130} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => fmtNumber(v)} />
                      <Bar dataKey="units" fill="#C84B31" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card-surface p-6" data-testid="chart-inv-by-type">
              <SectionTitle title="Stock by product type" subtitle="Available units per category" />
              {summary.by_product_type.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ width: "100%", height: 320 }}>
                  <ResponsiveContainer>
                    <BarChart data={summary.by_product_type} margin={{ bottom: 60 }}>
                      <CartesianGrid vertical={false} stroke="#E5E0D8" />
                      <XAxis
                        dataKey="product_type"
                        interval={0}
                        angle={-25}
                        textAnchor="end"
                        height={80}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis tickFormatter={(v) => fmtNumber(v)} />
                      <Tooltip formatter={(v) => fmtNumber(v)} />
                      <Bar dataKey="units" fill="#4A5340" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="card-surface p-6" data-testid="inv-by-country">
            <SectionTitle title="Markets overview" subtitle="Units & store footprint per country" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {summary.by_country.map((c) => (
                <div
                  key={c.country}
                  className="p-5 rounded-xl border border-border hover-lift"
                  data-testid={`inv-country-${c.country}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{COUNTRY_FLAGS[c.country] || "🌍"}</span>
                      <div className="font-display font-bold text-lg">{c.country}</div>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {c.locations} stores
                    </span>
                  </div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <div className="kpi-number text-3xl">{fmtNumber(c.units)}</div>
                    <div className="text-xs text-muted-foreground">units</div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {fmtNumber(c.skus)} SKUs on hand
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card-surface p-6" data-testid="low-stock-section">
            <SectionTitle
              title="Low-stock alerts"
              subtitle={`Items with ≤2 units available`}
              action={
                <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-md">
                  <MagnifyingGlass size={14} className="text-muted-foreground" />
                  <input
                    placeholder="Search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="lowstock-search"
                    className="bg-transparent outline-none text-sm w-[220px]"
                  />
                </div>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="lowstock-table">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="py-3 px-3 font-medium">Product</th>
                    <th className="py-3 px-3 font-medium">Color</th>
                    <th className="py-3 px-3 font-medium">Size</th>
                    <th className="py-3 px-3 font-medium">Store</th>
                    <th className="py-3 px-3 font-medium">Country</th>
                    <th className="py-3 px-3 font-medium">SKU</th>
                    <th className="py-3 px-3 font-medium text-right">Available</th>
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
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-3 px-3 font-medium max-w-[280px] truncate" title={r.product_name}>
                        {r.product_name || "—"}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground">{r.color_print || "—"}</td>
                      <td className="py-3 px-3">{r.size || "—"}</td>
                      <td className="py-3 px-3 text-muted-foreground">{r.location_name || "—"}</td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-md bg-muted text-xs font-medium capitalize">
                          {r.country || "—"}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-muted-foreground">{r.sku || "—"}</td>
                      <td className="py-3 px-3 text-right">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                            (r.available || 0) <= 1
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-foreground"
                          }`}
                        >
                          {fmtNumber(r.available)}
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
