import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API_BASE, formatKES } from "@/lib/api";
import { Heart } from "lucide-react";
import { toast, Toaster } from "sonner";

// Public, no-auth endpoint client
const pub = axios.create({ baseURL: API_BASE });

export default function PublicLookbook() {
  const { token } = useParams();
  const [lb, setLb] = useState(null);
  const [error, setError] = useState(null);
  const [interested, setInterested] = useState(new Set());

  useEffect(() => {
    (async () => {
      try {
        const r = await pub.get(`/public/lookbooks/${token}`);
        setLb(r.data);
      } catch (e) {
        setError(e?.response?.data?.detail || "Lookbook not found");
      }
    })();
  }, [token]);

  const interest = async (item) => {
    if (interested.has(item.sku)) return;
    setInterested((s) => new Set([...s, item.sku]));
    try {
      await pub.post(`/public/lookbooks/${token}/interest`, { sku: item.sku, product_title: item.product_title });
      toast.success(`${item.product_title} — your associate has been notified`);
    } catch {
      toast.error("Couldn't register interest");
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--vivo-bg)]">
        <div className="text-center max-w-md p-8">
          <div className="eyebrow">VIVO</div>
          <h1 className="font-display text-3xl mt-2">Link unavailable</h1>
          <p className="text-[var(--vivo-muted)] mt-3">{error}</p>
        </div>
      </div>
    );
  }
  if (!lb) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--vivo-muted)]">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--vivo-bg)]" data-testid="lookbook-public-view">
      <Toaster position="top-center" richColors />
      <header className="bg-[var(--vivo-navy)] text-white">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="text-[var(--vivo-gold)] uppercase text-xs tracking-[0.3em]">Vivo · Personal selection</div>
          <h1 className="font-display text-4xl md:text-5xl mt-3">{lb.title || "A selection for you"}</h1>
          {lb.note && <p className="mt-4 max-w-2xl text-white/85 leading-relaxed">{lb.note}</p>}
          <div className="mt-4 text-xs text-white/60 tracking-wider uppercase">From {lb.associate_name}</div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {(lb.items || []).map((it) => {
            const liked = interested.has(it.sku);
            return (
              <div key={it.sku} className="bg-white border border-[var(--vivo-border)] overflow-hidden">
                <div className="aspect-[3/4] bg-[var(--vivo-bg)]">
                  <img src={it.image} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="p-5">
                  <div className="font-display text-lg">{it.product_title}</div>
                  <div className="text-sm text-[var(--vivo-muted)] mt-1">{it.size ? `Size ${it.size}` : ""}{it.color ? ` · ${it.color}` : ""}</div>
                  <div className="flex items-center justify-between mt-4">
                    <div className="font-mono-num">{formatKES(it.price)}</div>
                    <button
                      onClick={() => interest(it)}
                      data-testid="lookbook-express-interest-button"
                      className={`h-10 px-4 rounded-sm text-xs uppercase tracking-wider transition-colors flex items-center gap-2 ${
                        liked
                          ? "bg-[var(--vivo-gold)] text-white"
                          : "bg-[var(--vivo-navy)] text-white hover:bg-[var(--vivo-navy-700)]"
                      }`}
                    >
                      <Heart className={`h-3 w-3 ${liked ? "fill-current" : ""}`} />
                      {liked ? "Saved" : "Love this"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-16 text-center text-xs text-[var(--vivo-muted)] uppercase tracking-[0.2em]">
          Vivo Fashion Group · Curated by your stylist
        </div>
      </main>
    </div>
  );
}
