import React, { useEffect, useState } from "react";
import { api, formatDate, timeAgo } from "@/lib/api";
import { Card } from "@/components/ui/card";

export default function AuditLog() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/audit", { params: { limit: 200 } });
        setItems(r.data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="p-6 md:p-10 max-w-[1200px] mx-auto" data-testid="audit-page">
      <div className="eyebrow">Manager · Audit</div>
      <h1 className="font-display text-4xl md:text-5xl tracking-tight mt-2">Audit log</h1>
      <div className="gold-rule mt-4" />
      <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
        Every customer view, note, message and consent change is recorded for Kenya DPA compliance.
      </p>

      <Card className="vivo-card mt-8 rounded-sm overflow-hidden">
        {loading && <div className="p-6 text-sm text-[var(--vivo-muted)]">Loading…</div>}
        {!loading && items.length === 0 && <div className="p-10 text-center text-sm text-[var(--vivo-muted)]">No audit events yet.</div>}
        {!loading && items.length > 0 && (
          <table className="w-full text-sm" data-testid="audit-table">
            <thead>
              <tr className="text-left text-[var(--vivo-muted)] uppercase text-xs tracking-wider border-b border-[var(--vivo-border)]">
                <th className="py-3 px-4">When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e, i) => (
                <tr key={i} className="border-b border-[var(--vivo-border)] last:border-0">
                  <td className="py-3 px-4 whitespace-nowrap text-[var(--vivo-muted)]">{timeAgo(e.timestamp)} · {formatDate(e.timestamp)}</td>
                  <td>{e.actor_name}</td>
                  <td><code className="text-[var(--vivo-navy)]">{e.action}</code></td>
                  <td>{e.target}{e.target_id ? ` · ${e.target_id}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
