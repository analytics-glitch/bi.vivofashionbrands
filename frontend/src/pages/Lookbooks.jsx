import React, { useEffect, useState } from "react";
import { api, formatDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { BookImage, Eye, Heart } from "lucide-react";

export default function Lookbooks() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/lookbooks");
        setItems(r.data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="p-6 md:p-10 max-w-[1300px] mx-auto" data-testid="lookbooks-page">
      <div className="eyebrow">Lookbooks</div>
      <h1 className="font-display text-4xl md:text-5xl tracking-tight mt-2">Curated for customers</h1>
      <div className="gold-rule mt-4" />
      <p className="text-sm text-[var(--vivo-muted)] mt-3">Build a new lookbook from any customer profile.</p>

      {loading ? (
        <div className="mt-8 text-sm text-[var(--vivo-muted)]">Loading…</div>
      ) : items.length === 0 ? (
        <Card className="vivo-card p-10 mt-10 text-center rounded-sm">
          <BookImage className="h-10 w-10 text-[var(--vivo-gold)] mx-auto" />
          <div className="font-display text-2xl mt-3">No lookbooks yet</div>
          <p className="text-sm text-[var(--vivo-muted)] mt-2">Open a customer and tap “New lookbook” to get started.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-8" data-testid="lookbooks-list">
          {items.map((lb) => {
            const cover = lb.items?.[0]?.image;
            const interestCount = lb.interests?.length || 0;
            return (
              <Link key={lb.lookbook_id} to={`/share/${lb.share_token}`} target="_blank" className="vivo-card overflow-hidden hover:shadow-md transition-shadow">
                {cover && <img src={cover} alt="" className="w-full aspect-[4/3] object-cover" />}
                <div className="p-5">
                  <div className="font-display text-lg">{lb.title || "Lookbook"}</div>
                  <div className="text-xs text-[var(--vivo-muted)] mt-1">For {lb.customer_name} · {lb.items.length} items · {formatDate(lb.created_at)}</div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-[var(--vivo-muted)]">
                    <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{lb.views || 0} views</span>
                    <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" />{interestCount} loves</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
