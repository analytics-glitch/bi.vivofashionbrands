import React, { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/Topbar";
import KPICard from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { api, fmtMoney, fmtNumber } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { MagnifyingGlass, TrendUp, Coins, ShoppingBag, Percent } from "@phosphor-icons/react";
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

const Sales = () => {
  const { dateFrom, dateTo, country } = useFilters();
  const [sales, setSales] = useState([]);
  const [brands, setBrands] = useState([]);
  const [types, setTypes] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("net_sales");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = { date_from: dateFrom, date_to: dateTo };
    Promise.all([
      api.get("/sales", { params }),
      api.get("/analytics/top-brands", { params }),
      api.get("/analytics/product-types", { params }),
      api.get("/analytics/overview", { params }),
    ])
      .then(([a, b, c, d]) => {
        if (cancelled) return;
        setSales(a.data || []);
        setBrands(b.data || []);
        setTypes(c.data || []);
        setOverview(d.data);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  const storeToCountry = (s) => {
    if (!s) return "Other";
    const x = s.toLowerCase();
    if (x.includes("uganda")) return "Uganda";
    if (x.includes("rwanda")) return "Rwanda";
    if (x.includes("vivofashiongroup") || x.includes("kenya")) return "Kenya";
    return "Other";
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cnt = country === "all" ? null : country;
    return sales
      .filter((r) => {
        if (cnt && storeToCountry(r.store_id) !== cnt) return false;
        if (!q) return true;
        return (
          (r.product_name || "").toLowerCase().includes(q) ||
          (r.sku || "").toLowerCase().includes(q) ||
          (r.brand || "").toLowerCase().includes(q) ||
          (r.location || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0))
      .slice(0, 200);
  }, [sales, search, country, sortKey]);

  return (
    <div className="space-y-8" data-testid="sales-page">
      <Topbar
        title="Sales"
        subtitle="Line-item sales with product, brand, and store drill-down."
        showCountry
      />

      {loading && <Loading label="Loading sales…" />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          {overview && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                testId="sales-kpi-gross"
                tone="primary"
                label="Gross sales"
                value={fmtMoney(overview.gross_sales)}
                icon={Coins}
              />
              <KPICard
                testId="sales-kpi-units"
                label="Units sold"
                value={fmtNumber(overview.units_sold)}
                icon={ShoppingBag}
              />
              <KPICard
                testId="sales-kpi-aov"
                label="Avg order value"
                value={fmtMoney(overview.avg_order_value)}
                icon={TrendUp}
              />
              <KPICard
                testId="sales-kpi-discount"
                label="Discounts"
                value={fmtMoney(overview.discounts)}
                sub={`${overview.discount_rate?.toFixed(1)}% of gross`}
                icon={Percent}
              />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-surface p-6" data-testid="chart-brands">
              <SectionTitle title="Brands performance" subtitle="Net sales per brand" />
              {brands.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={brands.slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid horizontal={false} stroke="#E5E0D8" />
                      <XAxis type="number" tickFormatter={(v) => fmtMoney(v)} />
                      <YAxis type="category" dataKey="brand" width={110} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v) => fmtMoney(v)} />
                      <Bar dataKey="net_sales" fill="#4A5340" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card-surface p-6" data-testid="chart-types">
              <SectionTitle title="Product types" subtitle="Mix by category" />
              {types.length === 0 ? (
                <Empty />
              ) : (
                <div style={{ width: "100%", height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={types.slice(0, 10)} margin={{ bottom: 50 }}>
                      <CartesianGrid vertical={false} stroke="#E5E0D8" />
                      <XAxis
                        dataKey="product_type"
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={70}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis tickFormatter={(v) => fmtMoney(v)} />
                      <Tooltip formatter={(v) => fmtMoney(v)} />
                      <Bar dataKey="net_sales" fill="#C84B31" radius={[6, 6, 0, 0]}>
                        {types.slice(0, 10).map((_, i) => (
                          <Cell
                            key={i}
                            fill={["#C84B31", "#DDA77B", "#4A5340", "#8C7A6B"][i % 4]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="card-surface p-6" data-testid="sales-table-section">
            <SectionTitle
              title="Line items"
              subtitle={`${fmtNumber(filtered.length)} rows shown (of ${fmtNumber(sales.length)})`}
              action={
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2 bg-muted px-3 py-2 rounded-md">
                    <MagnifyingGlass size={14} className="text-muted-foreground" />
                    <input
                      placeholder="Search product, SKU, brand, store"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      data-testid="sales-search"
                      className="bg-transparent outline-none text-sm w-[260px]"
                    />
                  </div>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value)}
                    data-testid="sales-sort"
                    className="card-surface px-3 py-2 text-sm font-medium outline-none"
                  >
                    <option value="net_sales">Sort: Net sales</option>
                    <option value="gross_sales">Sort: Gross sales</option>
                    <option value="units_sold">Sort: Units</option>
                    <option value="discounts">Sort: Discounts</option>
                  </select>
                </div>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="sales-table">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="py-3 px-3 font-medium">Product</th>
                    <th className="py-3 px-3 font-medium">Brand</th>
                    <th className="py-3 px-3 font-medium">Store</th>
                    <th className="py-3 px-3 font-medium">SKU</th>
                    <th className="py-3 px-3 font-medium text-right">Units</th>
                    <th className="py-3 px-3 font-medium text-right">Discounts</th>
                    <th className="py-3 px-3 font-medium text-right">Net sales</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <Empty />
                      </td>
                    </tr>
                  )}
                  {filtered.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-3 px-3 font-medium max-w-[260px] truncate" title={r.product_name}>
                        {r.product_name || "—"}
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-md bg-muted text-xs font-medium">
                          {r.brand || "—"}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-muted-foreground">{r.location || "—"}</td>
                      <td className="py-3 px-3 font-mono text-[11px] text-muted-foreground">{r.sku || "—"}</td>
                      <td className="py-3 px-3 text-right font-medium">{fmtNumber(r.units_sold)}</td>
                      <td className="py-3 px-3 text-right text-muted-foreground">{fmtMoney(r.discounts)}</td>
                      <td className="py-3 px-3 text-right font-display font-bold">{fmtMoney(r.net_sales)}</td>
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

export default Sales;
