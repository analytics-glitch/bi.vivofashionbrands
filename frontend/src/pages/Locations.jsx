import React, { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/Topbar";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { api, fmtMoney, fmtNumber, COUNTRY_FLAGS } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { MapPin, Storefront } from "@phosphor-icons/react";

const Locations = () => {
  const { dateFrom, dateTo, country } = useFilters();
  const [locations, setLocations] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get("/locations"),
      api.get("/sales-summary", { params: { date_from: dateFrom, date_to: dateTo } }),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        setLocations(a.data || []);
        setSummary(b.data || []);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  const salesByLocation = useMemo(() => {
    const m = new Map();
    for (const s of summary) m.set((s.location || "").toLowerCase(), s);
    return m;
  }, [summary]);

  const grouped = useMemo(() => {
    const by = {};
    for (const l of locations) {
      if (country !== "all" && l.country !== country) continue;
      const key = l.country || "Other";
      by[key] = by[key] || [];
      by[key].push(l);
    }
    return Object.entries(by).sort(([a], [b]) => a.localeCompare(b));
  }, [locations, country]);

  return (
    <div className="space-y-8" data-testid="locations-page">
      <Topbar
        title="Locations"
        subtitle="Every Vivo Fashion Group store, grouped by country."
        showCountry
      />

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && grouped.length === 0 && <Empty />}

      {!loading && !error && (
        <div className="space-y-10">
          {grouped.map(([countryName, stores]) => {
            const totalNet = stores.reduce(
              (s, l) => s + (salesByLocation.get((l.location || "").toLowerCase())?.net_sales || 0),
              0
            );
            const totalOrders = stores.reduce(
              (s, l) => s + (salesByLocation.get((l.location || "").toLowerCase())?.total_orders || 0),
              0
            );
            return (
              <section key={countryName} data-testid={`country-section-${countryName}`}>
                <SectionTitle
                  title={
                    <span className="flex items-center gap-3">
                      <span className="text-2xl">{COUNTRY_FLAGS[countryName] || "🌍"}</span>
                      <span>{countryName}</span>
                      <span className="ml-2 text-xs uppercase tracking-widest font-medium text-muted-foreground">
                        {stores.length} stores
                      </span>
                    </span>
                  }
                  subtitle={`${fmtMoney(totalNet)} net · ${fmtNumber(totalOrders)} orders`}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {stores.map((l, i) => {
                    const s = salesByLocation.get((l.location || "").toLowerCase());
                    return (
                      <div
                        key={`${l.location}-${i}`}
                        className="card-surface p-5 hover-lift"
                        data-testid={`location-card-${l.location}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
                            <Storefront size={20} weight="duotone" />
                          </div>
                          <div className="flex-1">
                            <div className="font-display font-bold leading-tight">{l.location}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin size={12} /> {l.country}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                              {l.store_id}
                            </div>
                          </div>
                        </div>
                        {s ? (
                          <div className="grid grid-cols-3 gap-2 mt-5">
                            <div>
                              <div className="eyebrow">Net</div>
                              <div className="font-display font-bold text-[15px] mt-0.5">
                                {fmtMoney(s.net_sales)}
                              </div>
                            </div>
                            <div>
                              <div className="eyebrow">Orders</div>
                              <div className="font-display font-bold text-[15px] mt-0.5">
                                {fmtNumber(s.total_orders)}
                              </div>
                            </div>
                            <div>
                              <div className="eyebrow">Units</div>
                              <div className="font-display font-bold text-[15px] mt-0.5">
                                {fmtNumber(s.units_sold)}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-5 text-xs text-muted-foreground">
                            No sales in the selected period.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Locations;
