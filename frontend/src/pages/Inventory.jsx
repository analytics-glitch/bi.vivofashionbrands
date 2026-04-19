import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtDec, fmtPct, fmtAxisKES, COUNTRY_FLAGS, buildParams } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import {
  Package,
  Warning,
  Storefront,
  MagnifyingGlass,
  Buildings,
  TrendDown,
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
  const [subcatSS, setSubcatSS] = useState([]);
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
      api.get("/subcategory-stock-sales", { params: { date_from: dateFrom, date_to: dateTo, country: countries.length ? countries.join(",") : undefined, channel: channels.length ? channels.join(",") : undefined } }),
    ])
      .then(([s, i, st, sc]) => {
        if (cancelled) return;
        setSummary(s.data);
        setInv(i.data || []);
        setSts(st.data || []);
        setSubcatSS(sc.data || []);
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

  const lowStockByStyle = useMemo(() => {
    const m = new Map();
    for (const r of filteredInv) {
      const style = r.style_name || r.product_name;
      if (!style) continue;
      if (!m.has(style)) {
        m.set(style, {
          style_name: style,
          brand: r.brand,
          product_type: r.product_type,
          collection: r.collection,
          available: 0,
          sku_count: 0,
          locations: new Set(),
        });
      }
      const e = m.get(style);
      e.available += r.available || 0;
      e.sku_count += 1;
      if (r.location_name) e.locations.add(r.location_name);
    }
    const rows = [...m.values()]
      .filter((e) => e.available <= 10)
      .map((e) => ({ ...e, locations: e.locations.size }))
      .sort((a, b) => a.available - b.available);
    return rows;
  }, [filteredInv]);

  // Understocked subcategories = % of total stock is LESS than % of total units sold.
  // understock_pct = pct_of_total_sold − pct_of_total_stock (positive = understocked magnitude).
  const understockedSubcats = useMemo(() => {
    return [...subcatSS]
      .map((r) => ({
        ...r,
        understock_pct: (r.pct_of_total_sold || 0) - (r.pct_of_total_stock || 0),
      }))
      .filter((r) => r.understock_pct > 0.5)
      .sort((a, b) => b.understock_pct - a.understock_pct);
  }, [subcatSS]);

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
              label="Low-Stock Styles (≤10)"
              value={fmtNum(lowStockByStyle.length)}
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

          {understockedSubcats.length > 0 && (
            <div className="card-white p-5 border-l-4 border-brand-strong" data-testid="understocked-subcats">
              <SectionTitle
                title={`Understocked subcategories · ${understockedSubcats.length}`}
                subtitle="Selling more than their share of inventory. Understock % = % of Units Sold − % of Total Stock."
              />
              <div className="overflow-x-auto">
                <table className="w-full data" data-testid="understocked-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Subcategory</th>
                      <th className="text-right">% of Sales</th>
                      <th className="text-right">% of Stock</th>
                      <th className="text-right">Understock</th>
                      <th className="text-right">Units Sold</th>
                      <th className="text-right">Current Stock</th>
                      <th className="text-right">SOR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {understockedSubcats.map((r, i) => (
                      <tr key={(r.subcategory || "") + i}>
                        <td className="text-muted num">{i + 1}</td>
                        <td className="font-medium">{r.subcategory}</td>
                        <td className="text-right num">{fmtPct(r.pct_of_total_sold, 2)}</td>
                        <td className="text-right num">{fmtPct(r.pct_of_total_stock, 2)}</td>
                        <td className="text-right">
                          <span className={r.understock_pct >= 3 ? "pill-red" : r.understock_pct >= 1 ? "pill-amber" : "pill-neutral"}>
                            −{r.understock_pct.toFixed(2)} pts
                          </span>
                        </td>
                        <td className="text-right num">{fmtNum(r.units_sold)}</td>
                        <td className="text-right num">{fmtNum(r.current_stock)}</td>
                        <td className="text-right num">{fmtPct(r.sor_percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {lowStockByStyle.length > 0 && (
            <div className="card-white p-5 border-l-4 border-danger" data-testid="low-stock-section">
              <SectionTitle
                title={`Low-stock alerts · ${lowStockByStyle.length} styles`}
                subtitle="Styles with ≤10 total available units across all SKUs in the current scope"
              />
              <div className="overflow-x-auto">
                <table className="w-full data" data-testid="low-stock-table">
                  <thead>
                    <tr>
                      <th>Style</th>
                      <th>Brand</th>
                      <th>Subcategory</th>
                      <th className="text-right">SKUs</th>
                      <th className="text-right">Locations</th>
                      <th className="text-right">Total Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockByStyle.slice(0, 80).map((r, i) => (
                      <tr key={(r.style_name || "") + i}>
                        <td className="font-medium max-w-[300px] truncate" title={r.style_name}>{r.style_name || "—"}</td>
                        <td><span className="pill-neutral">{r.brand || "—"}</span></td>
                        <td className="text-muted">{r.product_type || "—"}</td>
                        <td className="text-right num">{fmtNum(r.sku_count)}</td>
                        <td className="text-right num">{fmtNum(r.locations)}</td>
                        <td className="text-right">
                          <span className={r.available <= 3 ? "pill-red" : r.available <= 6 ? "pill-amber" : "pill-neutral"}>{fmtNum(r.available)}</span>
                        </td>
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
