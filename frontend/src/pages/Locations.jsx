import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum, fmtDelta, fmtPct, buildParams, pctDelta, comparePeriod, COUNTRY_FLAGS } from "@/lib/api";
import { KPICard } from "@/components/KPICard";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { Storefront, X, CaretLeft, ArrowsDownUp } from "@phosphor-icons/react";

const Locations = () => {
  const { applied, touchLastUpdated } = useFilters();
  const { dateFrom, dateTo, countries, channels, compareMode, dataVersion } = applied;
  const filters = { dateFrom, dateTo, countries, channels };

  const [rows, setRows] = useState([]);
  const [prevRows, setPrevRows] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [footfall, setFootfall] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("total_sales");
  const [selected, setSelected] = useState(null);
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [selectedLoading, setSelectedLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = buildParams(filters);
    const prev = comparePeriod(dateFrom, dateTo, compareMode);
    const prevP = prev
      ? buildParams({ ...filters, dateFrom: prev.date_from, dateTo: prev.date_to })
      : null;

    Promise.all([
      api.get("/sales-summary", { params: p }),
      api.get("/kpis", { params: p }),
      prevP
        ? api.get("/sales-summary", { params: prevP })
        : Promise.resolve({ data: [] }),
      api.get("/footfall", { params: { date_from: dateFrom, date_to: dateTo } }),
    ])
      .then(([s, k, ps, ff]) => {
        if (cancelled) return;
        setRows(s.data || []);
        setKpis(k.data);
        setPrevRows(ps.data || []);
        setFootfall(ff.data || []);
        touchLastUpdated();
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), compareMode, dataVersion]);

  useEffect(() => {
    if (!selected) return;
    setSelectedLoading(true);
    api
      .get("/top-skus", {
        params: { date_from: dateFrom, date_to: dateTo, channel: selected, limit: 10 },
      })
      .then((r) => setSelectedSkus(r.data || []))
      .catch(() => setSelectedSkus([]))
      .finally(() => setSelectedLoading(false));
  }, [selected, dateFrom, dateTo]);

  const prevMap = useMemo(() => {
    const m = new Map();
    for (const r of prevRows) m.set(r.channel, r);
    return m;
  }, [prevRows]);

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const prev = prevMap.get(r.channel);
      const sales = r.total_sales || 0;
      const orders = r.orders || r.total_orders || 0;
      const units = r.units_sold || r.total_units_sold || 0;
      const basket = orders ? sales / orders : (r.avg_basket_size || 0); // ABV
      const asp = units ? sales / units : 0; // Avg Selling Price
      const msi = orders ? units / orders : 0; // Multi-Sell Index = Units/Order
      return {
        ...r,
        avg_basket: basket,
        abv: basket,
        asp,
        msi,
        delta: prev ? pctDelta(r.total_sales, prev.total_sales) : null,
      };
    });
  }, [rows, prevMap]);

  const avg = useMemo(() => {
    if (!enriched.length) return 0;
    return (
      enriched.reduce((s, r) => s + (r.total_sales || 0), 0) / enriched.length
    );
  }, [enriched]);

  const groupTotals = useMemo(() => {
    const sales = enriched.reduce((s, r) => s + (r.total_sales || 0), 0);
    const orders = enriched.reduce((s, r) => s + (r.orders || r.total_orders || 0), 0);
    const units = enriched.reduce((s, r) => s + (r.units_sold || r.total_units_sold || 0), 0);
    return {
      abv: orders ? sales / orders : 0,
      asp: units ? sales / units : 0,
      msi: orders ? units / orders : 0,
    };
  }, [enriched]);

  const sorted = useMemo(() => {
    return [...enriched].sort((a, b) => {
      if (sortKey === "avg_basket" || sortKey === "abv") return (b.abv || 0) - (a.abv || 0);
      if (sortKey === "asp") return (b.asp || 0) - (a.asp || 0);
      if (sortKey === "msi") return (b.msi || 0) - (a.msi || 0);
      return (b[sortKey] || 0) - (a[sortKey] || 0);
    });
  }, [enriched, sortKey]);

  return (
    <div className="space-y-6" data-testid="locations-page">
      <div>
        <div className="eyebrow">Dashboard · Locations</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">
          Locations
        </h1>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && kpis && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <KPICard
              testId="loc-kpi-count"
              accent
              label="Total Locations"
              value={fmtNum(enriched.length)}
              showDelta={false}
            />
            <KPICard
              testId="loc-kpi-sales"
              label="Total Sales"
              value={fmtKES(kpis.total_sales)}
              showDelta={false}
            />
            <KPICard
              testId="loc-kpi-orders"
              label="Total Orders"
              value={fmtNum(kpis.total_orders)}
              showDelta={false}
            />
            <KPICard
              testId="loc-kpi-units"
              label="Total Units"
              value={fmtNum(kpis.total_units)}
              showDelta={false}
            />
            <KPICard small testId="loc-kpi-abv" label="ABV" sub="Sales ÷ Orders" value={fmtKES(groupTotals.abv)} showDelta={false} />
            <KPICard small testId="loc-kpi-asp" label="ASP" sub="Sales ÷ Units" value={fmtKES(groupTotals.asp)} showDelta={false} />
            <KPICard small testId="loc-kpi-msi" label="MSI" sub="Units ÷ Orders" value={groupTotals.msi.toFixed(2)} showDelta={false} />
          </div>

          {!selected && (
            <>
              <div className="card-white p-3 flex items-center gap-2 flex-wrap">
                <ArrowsDownUp size={14} className="text-muted ml-1" />
                <span className="text-[12px] text-muted">Sort by:</span>
                {[
                  ["total_sales", "Total Sales"],
                  ["total_orders", "Orders"],
                  ["units_sold", "Units"],
                  ["abv", "ABV"],
                  ["asp", "ASP"],
                  ["msi", "MSI"],
                ].map(([k, lbl]) => (
                  <button
                    key={k}
                    data-testid={`loc-sort-${k}`}
                    className={`px-2.5 py-1 rounded-lg text-[12px] font-medium ${
                      sortKey === k
                        ? "bg-brand text-white"
                        : "hover:bg-panel text-foreground/70"
                    }`}
                    onClick={() => setSortKey(k)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
                data-testid="locations-grid"
              >
                {sorted.length === 0 && <Empty />}
                {sorted.map((l, i) => {
                  const above = (l.total_sales || 0) >= avg;
                  const borderCls = above
                    ? "border-brand/40"
                    : "border-red-300";
                  return (
                    <button
                      key={`${l.channel}-${i}`}
                      className={`card-white p-4 hover-lift text-left border-l-4 ${borderCls}`}
                      data-testid={`location-card-${l.channel}`}
                      onClick={() => setSelected(l.channel)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-brand-soft text-brand grid place-items-center shrink-0">
                            <Storefront size={18} weight="duotone" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-[14px] leading-tight truncate" title={l.channel}>
                              {l.channel}
                            </div>
                            <div className="text-[11.5px] text-muted mt-0.5">
                              {COUNTRY_FLAGS[l.country] || "🌍"} {l.country}
                            </div>
                          </div>
                        </div>
                        {compareMode !== "none" && l.delta !== null && (
                          <span
                            className={`text-[11px] font-bold ${
                              l.delta > 0 ? "delta-up" : "delta-down"
                            }`}
                          >
                            {l.delta > 0 ? "▲" : "▼"} {fmtDelta(l.delta)}
                          </span>
                        )}
                      </div>

                      <div className="mt-4 font-bold text-[18px] text-brand-deep num">
                        {fmtKES(l.total_sales)}
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div>
                          <div className="eyebrow">Orders</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {fmtNum(l.orders || l.total_orders)}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">Units</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {fmtNum(l.units_sold)}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">Returns</div>
                          <div
                            className={`font-semibold text-[13px] num mt-0.5 ${
                              (l.returns || 0) > 0 ? "text-danger" : ""
                            }`}
                          >
                            {fmtKES(l.returns || 0)}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">ABV</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {fmtKES(l.abv)}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">ASP</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {fmtKES(l.asp)}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">MSI</div>
                          <div className="font-semibold text-[13px] num mt-0.5">
                            {(l.msi || 0).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="card-white p-5" data-testid="footfall-section">
                <SectionTitle
                  title="Footfall & Conversion"
                  subtitle="Traffic, orders, conversion rate, and revenue per visitor — all locations included."
                />
                <div className="overflow-x-auto">
                  <table className="w-full data" data-testid="footfall-table">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th className="text-right">Footfall</th>
                        <th className="text-right">Orders</th>
                        <th className="text-right">Conversion</th>
                        <th className="text-right">Sales / Visitor</th>
                        <th className="text-right">Total Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {footfall.length === 0 && (
                        <tr><td colSpan={6}><Empty label="No footfall data in this period." /></td></tr>
                      )}
                      {[...footfall]
                        .sort((a, b) => (b.total_footfall || 0) - (a.total_footfall || 0))
                        .map((r, i) => {
                          const cr = r.conversion_rate || 0;
                          const pill = cr > 15 ? "pill-green" : cr >= 10 ? "pill-amber" : "pill-red";
                          return (
                            <tr key={r.location + i}>
                              <td className="font-medium">{r.location}</td>
                              <td className="text-right num">{fmtNum(r.total_footfall)}</td>
                              <td className="text-right num">{fmtNum(r.orders)}</td>
                              <td className="text-right"><span className={pill}>{fmtPct(cr)}</span></td>
                              <td className="text-right num">{fmtKES(r.sales_per_visitor)}</td>
                              <td className="text-right num font-bold">{fmtKES(r.total_sales)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {selected && (
            <div className="space-y-4" data-testid="location-drill">
              <button
                className="flex items-center gap-1 text-brand font-medium hover:underline text-[13px]"
                onClick={() => setSelected(null)}
                data-testid="drill-back"
              >
                <CaretLeft size={15} /> Back to all locations
              </button>
              <div className="card-white p-5">
                <SectionTitle
                  title={selected}
                  subtitle="Top 10 styles at this channel"
                  action={
                    <button
                      onClick={() => setSelected(null)}
                      className="text-muted hover:text-foreground"
                    >
                      <X size={18} />
                    </button>
                  }
                />
                {selectedLoading ? (
                  <Loading />
                ) : selectedSkus.length === 0 ? (
                  <Empty />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full data">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Style</th>
                          <th>Collection</th>
                          <th>Brand</th>
                          <th>Subcategory</th>
                          <th className="text-right">Units</th>
                          <th className="text-right">Total Sales</th>
                          <th className="text-right">Avg Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSkus.map((s, i) => (
                          <tr key={(s.style_name || "") + i}>
                            <td className="text-muted num">{i + 1}</td>
                            <td className="font-medium max-w-[280px] truncate" title={s.style_name}>
                              {s.style_name || "—"}
                            </td>
                            <td className="text-muted">{s.collection || "—"}</td>
                            <td>
                              <span className="pill-neutral">{s.brand || "—"}</span>
                            </td>
                            <td className="text-muted">{s.product_type || "—"}</td>
                            <td className="text-right num font-semibold">{fmtNum(s.units_sold)}</td>
                            <td className="text-right num font-bold text-brand">{fmtKES(s.total_sales)}</td>
                            <td className="text-right num">{fmtKES(s.avg_price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Locations;
