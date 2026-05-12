import React, { useEffect, useMemo, useState } from "react";
import { useFilters } from "@/lib/filters";
import { api, fmtKES, fmtNum } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import MultiSelect from "@/components/MultiSelect";
import { MERCH_CATEGORIES, subcategoriesFor } from "@/lib/productCategory";
import { Users } from "@phosphor-icons/react";
import { usePiiReveal, piiHeaders, maskPhone, maskEmail } from "@/lib/usePiiReveal";

/**
 * Customer Details — one row per identified customer with first / last
 * name, opt-in flags, contact info, lifetime stats, first / last order
 * dates. Filterable by POS, Product Category & Subcategory, and the
 * global date range.
 *
 * Note on consent: the upstream BI does not expose SMS / email opt-in
 * fields. Those columns intentionally show "n/a" with a tooltip. If
 * the upstream ever adds the fields the table picks them up
 * automatically (see backend `/analytics/customer-details`).
 */
const CustomerDetails = () => {
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries, channels, dataVersion } = applied;
  const [merchCats, setMerchCats] = useState([]);
  const [merchSubs, setMerchSubs] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const { revealToken, setRevealToken, openModal, modal } = usePiiReveal();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get("/analytics/customer-details", {
        params: {
          date_from: dateFrom,
          date_to: dateTo,
          country: countries.length ? countries.join(",") : undefined,
          channel: channels.length ? channels.join(",") : undefined,
          category: merchCats.length ? merchCats.join(",") : undefined,
          subcategory: merchSubs.length ? merchSubs.join(",") : undefined,
          limit: 2000,
          ...(revealToken ? { reveal: true } : {}),
        },
        headers: piiHeaders(revealToken),
        timeout: 240000,
      })
      .then((r) => { if (!cancelled) setRows(r.data || []); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Failed to load customers"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [dateFrom, dateTo, JSON.stringify(countries), JSON.stringify(channels), JSON.stringify(merchCats), JSON.stringify(merchSubs), dataVersion, revealToken]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = `${r.first_name || ""} ${r.last_name || ""} ${r.email || ""} ${r.mobile || ""} ${r.customer_id || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const totals = useMemo(() => {
    const sales = filtered.reduce((s, r) => s + (r.total_sales || 0), 0);
    const orders = filtered.reduce((s, r) => s + (r.total_orders || 0), 0);
    return { customers: filtered.length, sales, orders };
  }, [filtered]);

  return (
    <div className="space-y-6" data-testid="customer-details-page">
      {modal}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Customers · Details</div>
          <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(15px,1.5vw,19px)] inline-flex items-center gap-2">
            <Users size={22} weight="duotone" className="text-[#1a5c38]" />
            Customer Details
          </h1>
          <p className="text-muted text-[13px] mt-1">
            One row per identified customer. Walk-ins (no customer_id) are
            excluded. Filter by category, subcategory, POS or date range
            using the global filter bar above.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-1" data-testid="cd-reveal-strip">
          {revealToken ? (
            <>
              <span className="text-[11.5px] font-bold text-emerald-700 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-300">
                ✓ Contacts visible · session expires in ~10 min
              </span>
              <button
                type="button"
                onClick={() => setRevealToken(null)}
                data-testid="cd-hide-contacts-btn"
                className="text-[11.5px] font-medium px-2.5 py-1 rounded-md border border-border hover:bg-panel"
              >
                Hide contacts
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={openModal}
              data-testid="cd-show-contacts-btn"
              className="text-[12px] font-bold px-3 py-1.5 rounded-md border border-brand text-brand hover:bg-brand hover:text-white transition-colors"
            >
              🔒 Show contacts (password required)
            </button>
          )}
        </div>
      </div>

      <div className="card-white p-5">
        <SectionTitle
          title="Filters"
          subtitle="Combine the global POS / date filters above with these merch filters to slice your customer base."
        />
        <div className="flex flex-wrap items-end gap-3" data-testid="customer-details-filters">
          <div>
            <div className="eyebrow mb-1">Category</div>
            <MultiSelect
              testId="cd-cat-multi"
              options={MERCH_CATEGORIES.map((c) => ({ value: c, label: c }))}
              value={merchCats}
              onChange={(v) => {
                setMerchCats(v);
                if (v.length) {
                  const allowed = new Set(subcategoriesFor(v));
                  setMerchSubs((subs) => subs.filter((s) => allowed.has(s)));
                }
              }}
              placeholder="All categories"
              width={176}
            />
          </div>
          <div>
            <div className="eyebrow mb-1">Subcategory</div>
            <MultiSelect
              testId="cd-subcat-multi"
              options={subcategoriesFor(merchCats).map((s) => ({ value: s, label: s }))}
              value={merchSubs}
              onChange={setMerchSubs}
              placeholder="All subcategories"
              width={224}
            />
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="eyebrow mb-1">Search name / email / phone</div>
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-pill text-[12px] w-full"
              data-testid="cd-search"
            />
          </div>
        </div>
      </div>

      {loading && <Loading label="Loading customer list — this can take ~30s on cold cache." />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && (
        <div className="card-white p-5" data-testid="customer-details-table-card">
          <SectionTitle
            title={`Customer list · ${fmtNum(totals.customers)} customers`}
            subtitle={`Combined ${fmtNum(totals.orders)} orders · ${fmtKES(totals.sales)} total spend in window. Sorted by total spend descending. Click any column to re-sort.`}
          />
          <SortableTable
            testId="customer-details-table"
            exportName={`customer-details_${dateFrom}_${dateTo}.csv`}
            pageSize={25}
            initialSort={{ key: "total_sales", dir: "desc" }}
            columns={[
              { key: "first_name", label: "First Name", align: "left",
                render: (r) => r.first_name || <span className="text-muted text-[11px]">—</span> },
              { key: "last_name", label: "Last Name", align: "left",
                render: (r) => r.last_name || <span className="text-muted text-[11px]">—</span> },
              { key: "email", label: "Email", align: "left",
                render: (r) => {
                  if (!r.email) return <span className="text-muted text-[11px]">—</span>;
                  const display = revealToken ? r.email : maskEmail(r.email);
                  return revealToken
                    ? <a href={`mailto:${r.email}`} className="text-[#1a5c38] hover:underline">{display}</a>
                    : <span className="text-muted">{display}</span>;
                },
                csv: (r) => revealToken ? r.email : maskEmail(r.email) },
              { key: "mobile", label: "Mobile", align: "left",
                render: (r) => {
                  if (!r.mobile) return <span className="text-muted text-[11px]">—</span>;
                  return revealToken ? r.mobile : maskPhone(r.mobile);
                },
                csv: (r) => revealToken ? r.mobile : maskPhone(r.mobile) },
              { key: "accepts_sms_marketing", label: "SMS Opt-in",
                render: (r) => (
                  <span className="text-muted text-[10.5px]" title="Upstream BI does not yet expose this field. Will populate automatically once available.">
                    n/a
                  </span>
                ),
                csv: () => "n/a", sortable: false },
              { key: "accepts_email_marketing", label: "Email Opt-in",
                render: () => (
                  <span className="text-muted text-[10.5px]" title="Upstream BI does not yet expose this field. Will populate automatically once available.">
                    n/a
                  </span>
                ),
                csv: () => "n/a", sortable: false },
              { key: "total_sales", label: "Total Sales", numeric: true,
                render: (r) => <span className="text-brand font-bold">{fmtKES(r.total_sales)}</span>,
                csv: (r) => r.total_sales },
              { key: "total_orders", label: "Orders", numeric: true,
                render: (r) => fmtNum(r.total_orders) },
              { key: "first_order_date", label: "First Order", align: "left" },
              { key: "last_order_date", label: "Last Order", align: "left" },
            ]}
            rows={filtered}
          />
        </div>
      )}
    </div>
  );
};

export default CustomerDetails;
