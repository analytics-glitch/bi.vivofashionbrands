import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtDec, fmtAxisKES, COUNTRY_FLAGS, buildParams } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import {
  Package,
  Warning,
  Storefront,
  MagnifyingGlass,
  Buildings,
} from "@phosphor-icons/react";
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
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries, channels } = applied;

  const [summary, setSummary] = useState(null);
  const [inv, setInv] = useState([]);
  const [sts, setSts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const country = countries.length === 1 ? countries[0].toLowerCase() : undefined;
    const location = channels.length === 1 ? channels[0] : undefined;
    const params = { country, location, product: search || undefined };
    Promise.all([
      api.get("/analytics/inventory-summary", { params }),
      api.get("/inventory", { params }),
      api.get("/stock-to-sales", { params: { date_from: dateFrom, date_to: dateTo, country: countries.length ? countries.join(",") : undefined } }),
    ])
      .then(([s, i, st]) => {
        if (cancelled) return;
        setSummary(s.data);
        setInv(i.data || []);
        setSts(st.data || []);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), search]);

  const brands = useMemo(
    () => [...new Set(inv.map((r) => r.brand).filter(Boolean))].sort(),
    [inv]
  );
  const types = useMemo(
    () => [...new Set(inv.map((r) => r.product_type).filter(Boolean))].sort(),
    [inv]
  );

  const filteredInv = useMemo(() => {
    return inv.filter((r) => {
      if (countries.length > 1 && !countries.map((c) => c.toLowerCase()).includes((r.country || "").toLowerCase())) return false;
      if (channels.length && !channels.includes(r.location_name)) return false;
      if (brandFilter && r.brand !== brandFilter) return false;
      if (typeFilter && r.product_type !== typeFilter) return false;
      return true;
    });
  }, [inv, countries, channels, brandFilter, typeFilter]);

  const lowStock = useMemo(
    () => filteredInv.filter((r) => r.sku && (r.available || 0) <= 2).sort((a, b) => (a.available || 0) - (b.available || 0)),
    [filteredInv]
  );

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <div>
        <div className="eyebrow">Dashboard · Inventory</div>
        <h1 className="font-extrabold text-[28px] tracking-tight mt-1">
          Inventory
        </h1>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              testId="inv-kpi-units"
              accent
              label="Total Available Units"
              value={fmtNum(summary.total_units)}
              icon={Package}
              showDelta={false}
            />
            <KPICard
              testId="inv-kpi-skus"
              label="Active SKUs"
              value={fmtNum(summary.total_skus)}
              icon={Storefront}
              showDelta={false}
            />
            <KPICard
              testId="inv-kpi-lowstock"
              label="Low-Stock SKUs (≤2)"
              value={fmtNum(summary.low_stock_skus)}
              icon={Warning}
              showDelta={false}
            />
            <KPICard
              testId="inv-kpi-warehouse"
              label="Locations with Stock"
              value={fmtNum(summary.by_location.length)}
              icon={Buildings}
              showDelta={false}
            />
          </div>

          <div className="card-white p-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 input-pill flex-1 min-w-[200px]">
              <MagnifyingGlass size={14} className="text-muted" />
              <input
                placeholder="Search product name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="inv-search"
                className="bg-transparent outline-none text-[13px] w-full"
              />
            </div>
            <select
              className="input-pill"
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              data-testid="inv-brand"
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <select
              className="input-pill"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              data-testid="inv-type"
            >
              <option value="">All product types</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card-white p-5" data-testid="chart-inv-location">
              <SectionTitle title="Stock by location" subtitle="Top 15 stores" />
              <div style={{ width: "100%", height: 360 }}>
                <ResponsiveContainer>
                  <BarChart data={summary.by_location.slice(0, 15)} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="location" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => fmtNum(v)} />
                    <Bar dataKey="units" fill="#1a5c38" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card-white p-5" data-testid="chart-inv-type">
              <SectionTitle title="Stock by product type" subtitle="Available units per category" />
              <div style={{ width: "100%", height: 360 }}>
                <ResponsiveContainer>
                  <BarChart data={summary.by_product_type.slice(0, 12)} margin={{ bottom: 70 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="product_type"
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={85}
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis tickFormatter={(v) => fmtAxisKES(v)} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => fmtNum(v)} />
                    <Bar dataKey="units" fill="#00c853" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {lowStock.length > 0 && (
            <div className="card-white p-5 border-l-4 border-danger" data-testid="low-stock-section">
              <SectionTitle
                title={`⚠ Low-stock alerts · ${lowStock.length} items`}
                subtitle="Items with ≤2 units available"
              />
              <div className="overflow-x-auto">
                <table className="w-full data">
                  <thead>
                    <tr>
                      <th>Product</th><th>Size</th><th>SKU</th><th>Location</th><th>Country</th>
                      <th className="text-right">Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStock.slice(0, 50).map((r, i) => (
                      <tr key={i}>
                        <td className="font-medium max-w-[280px] truncate" title={r.product_name}>{r.product_name || "—"}</td>
                        <td>{r.size || "—"}</td>
                        <td className="font-mono text-[11px] text-muted">{r.sku || "—"}</td>
                        <td className="text-muted">{r.location_name || "—"}</td>
                        <td className="capitalize">{r.country || "—"}</td>
                        <td className="text-right"><span className={(r.available || 0) <= 1 ? "pill-red" : "pill-amber"}>{fmtNum(r.available)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card-white p-5" data-testid="stock-to-sales-section">
            <SectionTitle
              title="Stock-to-Sales ratio"
              subtitle="Weeks of cover proxy — red >10x (overstocked), amber 3–10x, green 1–3x, blue <1x (understocked)"
            />
            <div className="overflow-x-auto">
              <table className="w-full data" data-testid="sts-table">
                <thead>
                  <tr>
                    <th>Location</th><th>Country</th>
                    <th className="text-right">Units Sold</th>
                    <th className="text-right">Current Stock</th>
                    <th className="text-right">Total Sales</th>
                    <th className="text-right">Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {sts.length === 0 && <tr><td colSpan={6}><Empty /></td></tr>}
                  {sts.sort((a, b) => (b.stock_to_sales_ratio || 0) - (a.stock_to_sales_ratio || 0)).map((r, i) => {
                    const v = r.stock_to_sales_ratio || 0;
                    const pill = v > 10 ? "pill-red" : v >= 3 ? "pill-amber" : v >= 1 ? "pill-green" : "pill-neutral";
                    return (
                      <tr key={r.location + i}>
                        <td className="font-medium">{r.location}</td>
                        <td>{COUNTRY_FLAGS[r.country] || "🌍"} {r.country}</td>
                        <td className="text-right num">{fmtNum(r.units_sold)}</td>
                        <td className="text-right num">{fmtNum(r.current_stock)}</td>
                        <td className="text-right num font-semibold">{fmtKES(r.total_sales)}</td>
                        <td className="text-right"><span className={pill}>{fmtDec(v, 2)}×</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card-white p-5" data-testid="inventory-table">
            <SectionTitle
              title="Inventory"
              subtitle={`${fmtNum(filteredInv.length)} rows`}
            />
            <div className="overflow-x-auto">
              <table className="w-full data">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Size</th>
                    <th>SKU</th>
                    <th>Barcode</th>
                    <th>Location</th>
                    <th>Country</th>
                    <th className="text-right">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInv.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <Empty />
                      </td>
                    </tr>
                  )}
                  {filteredInv.slice(0, 300).map((r, i) => (
                    <tr key={i}>
                      <td className="font-medium max-w-[280px] truncate" title={r.product_name}>
                        {r.product_name || "—"}
                      </td>
                      <td>{r.size || "—"}</td>
                      <td className="font-mono text-[11px] text-muted">{r.sku || "—"}</td>
                      <td className="font-mono text-[11px] text-muted">{r.barcode || "—"}</td>
                      <td className="text-muted">{r.location_name || "—"}</td>
                      <td className="capitalize">{r.country || "—"}</td>
                      <td className={`text-right num font-semibold ${(r.available || 0) <= 2 ? "text-danger" : ""}`}>
                        {fmtNum(r.available)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredInv.length > 300 && (
                <div className="text-[11.5px] text-muted mt-3">
                  Showing first 300 of {fmtNum(filteredInv.length)} rows. Narrow via filters.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Inventory;
