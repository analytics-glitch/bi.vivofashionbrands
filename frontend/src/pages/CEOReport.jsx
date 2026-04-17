import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import {
  api,
  fmtKES,
  fmtNum,
  fmtPct,
  fmtDec,
  fmtDate,
  storeToCountry,
  COUNTRY_FLAGS,
} from "@/lib/api";
import { Loading, ErrorBox } from "@/components/common";
import { Printer, CalendarBlank } from "@phosphor-icons/react";

const KPI = ({ label, value, testId }) => (
  <div
    className="border border-border rounded-xl p-4 bg-[#0f0f0f]"
    data-testid={testId}
  >
    <div className="eyebrow">{label}</div>
    <div className="mt-2 kpi-value text-[22px] text-white">{value}</div>
  </div>
);

const SectionHeader = ({ title }) => (
  <div className="mt-10 mb-4">
    <h2 className="accent-heading font-bold text-[18px] text-brand-strong border-b-2 border-brand/40 pb-2">
      {title}
    </h2>
  </div>
);

const CEOReport = () => {
  const { dateFrom, dateTo } = useFilters();
  const [kpis, setKpis] = useState(null);
  const [byCountry, setByCountry] = useState([]);
  const [summary, setSummary] = useState([]);
  const [topSkus, setTopSkus] = useState([]);
  const [sor, setSor] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = { date_from: dateFrom, date_to: dateTo };
    Promise.all([
      api.get("/analytics/kpis-plus", { params }),
      api.get("/analytics/by-country", { params }),
      api.get("/sales-summary", { params }),
      api.get("/top-skus", { params: { ...params, limit: 10 } }),
      api.get("/sor", { params }),
    ])
      .then(([k, c, s, t, r]) => {
        if (cancelled) return;
        setKpis(k.data);
        setByCountry(c.data || []);
        setSummary(s.data || []);
        setTopSkus(t.data || []);
        setSor(r.data || []);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  const top5Locations = useMemo(() => {
    return [...summary]
      .sort((a, b) => (b.gross_sales || 0) - (a.gross_sales || 0))
      .slice(0, 5);
  }, [summary]);

  const top10Sor = useMemo(() => {
    return [...sor]
      .sort((a, b) => (b.sor_percent || 0) - (a.sor_percent || 0))
      .slice(0, 10);
  }, [sor]);

  return (
    <div data-testid="ceo-report-page">
      {/* Header bar (not printed) */}
      <div className="flex items-center justify-between pb-5 border-b border-border no-print">
        <div>
          <div className="eyebrow">Dashboard · Executive</div>
          <h1 className="font-extrabold text-[28px] tracking-tight text-white mt-1">
            CEO Report
          </h1>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-brand text-black font-semibold px-4 py-2.5 rounded-xl hover:bg-brand-strong transition-colors"
          data-testid="print-report-btn"
        >
          <Printer size={16} weight="bold" /> Print / Export PDF
        </button>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && kpis && (
        <div
          className="print-page mt-6 bg-[#0f0f0f] border border-border rounded-2xl p-8 md:p-10 max-w-[1100px] mx-auto"
          data-testid="ceo-report-content"
        >
          {/* Report header */}
          <div className="flex items-start justify-between gap-6 pb-6 border-b border-border">
            <div>
              <div className="eyebrow text-brand-strong">
                Vivo Fashion Group
              </div>
              <h1 className="font-extrabold text-[30px] tracking-tight text-white mt-1">
                Executive Sales Report
              </h1>
              <div className="text-[13px] text-muted mt-2 flex items-center gap-2">
                <CalendarBlank size={14} />
                <span>
                  {fmtDate(dateFrom)} &nbsp;→&nbsp; {fmtDate(dateTo)}
                </span>
              </div>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-brand text-black grid place-items-center font-extrabold text-2xl">
              V
            </div>
          </div>

          {/* Section 1 */}
          <SectionHeader title="1 · Group KPIs" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPI label="Total Gross Sales" value={fmtKES(kpis.total_gross_sales)} testId="ceo-kpi-gross" />
            <KPI label="Total Net Sales" value={fmtKES(kpis.total_net_sales)} testId="ceo-kpi-net" />
            <KPI label="Total Orders" value={fmtNum(kpis.total_orders)} testId="ceo-kpi-orders" />
            <KPI
              label="Total Units Sold"
              value={fmtNum(kpis.units_clean ?? kpis.total_units)}
              testId="ceo-kpi-units"
            />
            <KPI label="Avg Basket Size" value={fmtKES(kpis.avg_basket_size)} testId="ceo-kpi-basket" />
            <KPI label="Avg Selling Price" value={fmtKES(kpis.avg_selling_price)} testId="ceo-kpi-asp" />
            <KPI label="Return Rate" value={fmtPct(kpis.return_rate)} testId="ceo-kpi-return" />
            <KPI label="Sell Through Rate" value={fmtPct(kpis.sell_through_rate)} testId="ceo-kpi-st" />
          </div>

          {/* Section 2 */}
          <SectionHeader title="2 · Country Performance" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {byCountry.map((c) => (
              <div
                key={c.country}
                className="border border-border rounded-xl p-5 bg-[#0a0a0a]"
                data-testid={`ceo-country-${c.country}`}
              >
                <div className="flex items-center gap-2 text-[15px] font-bold">
                  <span>{COUNTRY_FLAGS[c.country] || "🌍"}</span>
                  <span>{c.country}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <div className="eyebrow">Gross Sales</div>
                    <div className="font-bold mt-0.5">{fmtKES(c.gross_sales)}</div>
                  </div>
                  <div>
                    <div className="eyebrow">Orders</div>
                    <div className="font-bold mt-0.5">{fmtNum(c.total_orders)}</div>
                  </div>
                  <div>
                    <div className="eyebrow">Units</div>
                    <div className="font-bold mt-0.5">{fmtNum(c.units_sold)}</div>
                  </div>
                  <div>
                    <div className="eyebrow">Avg Basket</div>
                    <div className="font-bold mt-0.5">{fmtKES(c.avg_basket_size)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Section 3 */}
          <SectionHeader title="3 · Top 5 Locations" />
          <table className="w-full data" data-testid="ceo-top-locations">
            <thead>
              <tr>
                <th>#</th>
                <th>Location</th>
                <th className="text-right">Gross Sales</th>
                <th className="text-right">Orders</th>
                <th className="text-right">Units</th>
              </tr>
            </thead>
            <tbody>
              {top5Locations.map((l, i) => (
                <tr key={l.location}>
                  <td className="text-muted">{i + 1}</td>
                  <td className="font-medium">{l.location}</td>
                  <td className="text-right font-bold">{fmtKES(l.gross_sales)}</td>
                  <td className="text-right">{fmtNum(l.total_orders)}</td>
                  <td className="text-right">{fmtNum(l.units_sold)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Section 4 */}
          <SectionHeader title="4 · Top 10 Best-Selling SKUs" />
          <table className="w-full data" data-testid="ceo-top-skus">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Brand</th>
                <th className="text-right">Units</th>
                <th className="text-right">Sales</th>
              </tr>
            </thead>
            <tbody>
              {topSkus.map((s, i) => (
                <tr key={s.sku + i}>
                  <td className="text-muted">{i + 1}</td>
                  <td className="font-medium max-w-[400px] truncate" title={s.product_name}>
                    {s.product_name}
                  </td>
                  <td>{s.brand || "—"}</td>
                  <td className="text-right">{fmtNum(s.units_sold)}</td>
                  <td className="text-right font-bold">{fmtKES(s.total_sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Section 5 */}
          <SectionHeader title="5 · Top 10 Sell-Out Rate Styles" />
          <table className="w-full data" data-testid="ceo-top-sor">
            <thead>
              <tr>
                <th>#</th>
                <th>Style</th>
                <th className="text-right">SOR %</th>
                <th className="text-right">Units Sold</th>
                <th className="text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {top10Sor.map((r, i) => (
                <tr key={(r.style_name || "") + i}>
                  <td className="text-muted">{i + 1}</td>
                  <td className="font-medium max-w-[380px] truncate" title={r.style_name}>
                    {r.style_name}
                  </td>
                  <td className="text-right font-bold">{fmtPct(r.sor_percent)}</td>
                  <td className="text-right">{fmtNum(r.units_sold)}</td>
                  <td className="text-right">{fmtNum(r.current_stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-10 pt-5 border-t border-border text-[11px] text-muted text-center">
            Confidential · Vivo Fashion Group · Generated {fmtDate(new Date().toISOString())}
          </div>
        </div>
      )}
    </div>
  );
};

export default CEOReport;
