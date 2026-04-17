import React, { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/Topbar";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import {
  api,
  fmtKES,
  fmtNum,
  storeToCountry,
  COUNTRY_FLAGS,
  fmtDate,
} from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Storefront, X, CaretLeft } from "@phosphor-icons/react";

const Locations = () => {
  const { dateFrom, dateTo, country, location: locationFilter } = useFilters();
  const [locations, setLocations] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // location name
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [selectedLoading, setSelectedLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get("/locations"),
      api.get("/sales-summary", { params: { date_from: dateFrom, date_to: dateTo } }),
    ])
      .then(([l, s]) => {
        if (cancelled) return;
        setLocations(l.data || []);
        setSummary(s.data || []);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  // drill-down
  useEffect(() => {
    if (!selected) return;
    setSelectedLoading(true);
    api
      .get("/top-skus", {
        params: { date_from: dateFrom, date_to: dateTo, location: selected, limit: 20 },
      })
      .then((r) => setSelectedSkus(r.data || []))
      .catch(() => setSelectedSkus([]))
      .finally(() => setSelectedLoading(false));
  }, [selected, dateFrom, dateTo]);

  const salesByLocation = useMemo(() => {
    const m = new Map();
    for (const s of summary)
      m.set((s.location || "").toLowerCase(), s);
    return m;
  }, [summary]);

  const visibleLocations = useMemo(() => {
    let ls = locations;
    if (country !== "all") ls = ls.filter((l) => l.country === country);
    if (locationFilter !== "all") ls = ls.filter((l) => l.location === locationFilter);
    return ls;
  }, [locations, country, locationFilter]);

  return (
    <div className="space-y-8" data-testid="locations-page">
      <Topbar
        title="Locations"
        subtitle={`${visibleLocations.length} stores · ${fmtDate(dateFrom)} → ${fmtDate(dateTo)}`}
      />

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <>
          {!selected && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
              data-testid="locations-grid"
            >
              {visibleLocations.length === 0 && <Empty />}
              {visibleLocations.map((l, i) => {
                const s = salesByLocation.get((l.location || "").toLowerCase());
                const basket = s && s.total_orders ? s.gross_sales / s.total_orders : 0;
                return (
                  <button
                    key={`${l.location}-${i}`}
                    className="card p-5 hover-lift text-left w-full"
                    data-testid={`location-card-${l.location}`}
                    onClick={() => setSelected(l.location)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand/15 text-brand-strong grid place-items-center">
                          <Storefront size={20} weight="duotone" />
                        </div>
                        <div>
                          <div className="font-bold text-[15px] leading-tight text-white">
                            {l.location}
                          </div>
                          <div className="text-[11.5px] text-muted mt-0.5 flex items-center gap-1">
                            <span>{COUNTRY_FLAGS[l.country] || "🌍"}</span>
                            <span>{l.country}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {s ? (
                      <div className="grid grid-cols-2 gap-3 mt-5">
                        <div>
                          <div className="eyebrow">Net Sales</div>
                          <div className="font-bold text-[15px] text-brand-strong mt-0.5">
                            {fmtKES(s.net_sales)}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">Orders</div>
                          <div className="font-bold text-[15px] mt-0.5">
                            {fmtNum(s.total_orders)}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">Units</div>
                          <div className="font-bold text-[15px] mt-0.5">
                            {fmtNum(s.units_sold)}
                          </div>
                        </div>
                        <div>
                          <div className="eyebrow">Avg Basket</div>
                          <div className="font-bold text-[15px] mt-0.5">
                            {fmtKES(basket)}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 text-[12.5px] text-muted">
                        No sales in the selected period.
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <div className="space-y-5" data-testid="location-drill-down">
              <button
                className="flex items-center gap-1 text-brand-strong text-sm font-medium hover:underline"
                onClick={() => setSelected(null)}
                data-testid="drill-back"
              >
                <CaretLeft size={16} /> Back to all locations
              </button>

              <div className="card p-6">
                <SectionTitle
                  title={selected}
                  subtitle="Top 20 SKUs at this location"
                  action={
                    <button
                      onClick={() => setSelected(null)}
                      className="text-muted hover:text-white"
                      aria-label="close"
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
                          <th>Rank</th>
                          <th>SKU</th>
                          <th>Product</th>
                          <th>Size</th>
                          <th>Brand</th>
                          <th className="text-right">Units</th>
                          <th className="text-right">Total Sales</th>
                          <th className="text-right">Avg Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSkus.map((s, i) => (
                          <tr key={s.sku + i}>
                            <td className="text-muted">{i + 1}</td>
                            <td className="font-mono text-[11.5px] text-muted">{s.sku}</td>
                            <td className="font-medium max-w-[340px] truncate" title={s.product_name}>
                              {s.product_name}
                            </td>
                            <td>{s.size || "—"}</td>
                            <td><span className="pill-green">{s.brand || "—"}</span></td>
                            <td className="text-right font-semibold">{fmtNum(s.units_sold)}</td>
                            <td className="text-right font-bold text-brand-strong">{fmtKES(s.total_sales)}</td>
                            <td className="text-right">{fmtKES(s.avg_price)}</td>
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
