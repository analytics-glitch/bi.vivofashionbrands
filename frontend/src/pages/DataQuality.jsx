import React, { useEffect, useState } from "react";
import { api, formatKES, formatNumber, formatDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RfmBadge } from "@/components/RfmBadge";
import { Link } from "react-router-dom";
import { ShieldCheck, AlertTriangle } from "lucide-react";

export default function DataQuality() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/customers/duplicates");
        setData(r.data);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="p-6 md:p-10 max-w-[1300px] mx-auto" data-testid="data-quality-page">
      <div className="eyebrow">Data quality</div>
      <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Customer duplicates</h1>
      <div className="gold-rule mt-4" />
      <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
        Likely duplicate customer records grouped by matching phone or normalised name. Merge in
        your source-of-truth (Shopify / Odoo) before associates pollute records further.
      </p>

      {loading ? (
        <div className="mt-8 text-sm text-[var(--vivo-muted)]">Scanning…</div>
      ) : !data?.groups?.length ? (
        <Card className="vivo-card p-10 mt-8 text-center" data-testid="dedup-clean">
          <ShieldCheck className="h-10 w-10 mx-auto text-emerald-600" />
          <div className="font-display text-xl mt-3">No duplicates found.</div>
          <p className="text-sm text-[var(--vivo-muted)] mt-2">Customer data is clean.</p>
        </Card>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-sm bg-amber-50 text-amber-800 border-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              {data.groups.length} duplicate groups · {data.potential_duplicates} records
            </Badge>
          </div>

          <div className="space-y-4 mt-6" data-testid="dedup-groups">
            {data.groups.map((g, i) => (
              <Card key={i} className="vivo-card p-5 rounded-sm" data-testid={`dedup-group-${g.match_on}-${i}`}>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="font-medium">
                    Matched on <span className="uppercase tracking-wider text-[var(--vivo-muted)] text-xs">{g.match_on}</span> · <span className="font-mono-num">{g.value}</span>
                  </div>
                  <Badge variant="outline" className="rounded-sm">{g.customers.length} records</Badge>
                </div>
                <ul className="divide-y divide-[var(--vivo-border)]">
                  {g.customers.map((c) => (
                    <li key={c.customer_id} className="py-2.5 flex items-center justify-between gap-3">
                      <Link to={`/customers/${c.customer_id}`} className="flex-1 min-w-0 hover:text-[var(--vivo-navy)]">
                        <div className="font-medium truncate flex items-center gap-2">{c.customer_name || c.customer_id} <RfmBadge tier={c.rfm_tier} /></div>
                        <div className="text-xs text-[var(--vivo-muted)] mt-0.5">
                          {c.city || "—"} · {c.total_orders} orders · {formatKES(c.total_sales)} LTV · last buy {formatDate(c.last_purchase_date)}
                        </div>
                      </Link>
                      <span className="text-xs text-[var(--vivo-muted)] font-mono-num shrink-0">{c.customer_id}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
