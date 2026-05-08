import React, { useEffect, useState } from "react";
import { api, formatDate, formatKES, formatNumber, daysAgo, today } from "@/lib/api";
import { Link } from "react-router-dom";
import { Search, Phone, Mail, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RfmBadge } from "@/components/RfmBadge";

export default function CustomerSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [top, setTop] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/bi/top-customers", { params: { date_from: daysAgo(60), date_to: today(), limit: 12 } });
        setTop(r.data || []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const search = async (e) => {
    e?.preventDefault?.();
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setHasSearched(true);
    try {
      const r = await api.get("/bi/customer-search", { params: { q: query } });
      setResults(r.data || []);
    } finally {
      setLoading(false);
    }
  };

  const list = hasSearched ? results : top;

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto" data-testid="customer-search-page">
      <div className="eyebrow">Customer book</div>
      <h1 className="font-display text-4xl md:text-5xl tracking-tight mt-2">Find a customer</h1>
      <div className="gold-rule mt-4" />

      <form onSubmit={search} className="mt-8 flex gap-3 max-w-2xl" data-testid="search-form">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--vivo-muted)]" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Phone, name or email"
            className="h-12 pl-11 rounded-sm border-[var(--vivo-border)] bg-white text-base"
            data-testid="customer-search-input"
            autoFocus
          />
        </div>
        <Button
          type="submit"
          className="h-12 px-6 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm"
          data-testid="customer-search-submit"
        >
          Search
        </Button>
      </form>
      <p className="text-xs text-[var(--vivo-muted)] mt-2">
        Tip: works with +254xxx, 254xxx, 0xxx — first 3 letters of a name also work.
      </p>

      <div className="mt-10">
        <h2 className="font-display text-xl">{hasSearched ? `Results (${list.length})` : "Top customers · 60d"}</h2>
        <div className="vivo-divider mt-3 mb-5" />

        {loading ? (
          <div className="text-sm text-[var(--vivo-muted)]">Searching…</div>
        ) : list.length === 0 ? (
          <div className="vivo-card p-10 text-center" data-testid="search-empty">
            <Search className="h-8 w-8 mx-auto text-[var(--vivo-muted)]" />
            <div className="font-display text-xl mt-3">No customers found</div>
            <p className="text-sm text-[var(--vivo-muted)] mt-2">
              Try a different phone format, fewer letters of the name, or email.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="customer-search-results">
            {list.map((c) => (
              <Link
                key={c.customer_id}
                to={`/customers/${c.customer_id}`}
                className="vivo-card p-5 hover:shadow-md transition-shadow"
                data-testid="customer-search-result-item"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate text-lg flex items-center gap-2 flex-wrap">
                      {c.customer_name}
                      <RfmBadge tier={c.rfm_tier} />
                    </div>
                    <div className="text-xs text-[var(--vivo-muted)] mt-1 flex flex-wrap gap-3">
                      {c.phone && (<span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>)}
                      {c.email && (<span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>)}
                      {c.customer_country && (<span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{c.customer_country}</span>)}
                    </div>
                  </div>
                  {c.rank && (
                    <span className="text-xs uppercase tracking-wider text-[var(--vivo-gold-700)]">#{c.rank}</span>
                  )}
                </div>
                <div className="vivo-divider my-3" />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-xs text-[var(--vivo-muted)]">Orders</div>
                    <div className="font-mono-num text-sm">{formatNumber(c.total_orders)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--vivo-muted)]">Lifetime</div>
                    <div className="font-mono-num text-sm">{formatKES(c.total_sales)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-[var(--vivo-muted)]">AOV</div>
                    <div className="font-mono-num text-sm">{formatKES(c.avg_basket)}</div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-[var(--vivo-muted)]">Last purchase {formatDate(c.last_purchase_date)}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
