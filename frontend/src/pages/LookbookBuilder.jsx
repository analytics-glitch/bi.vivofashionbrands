import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, daysAgo, today, formatKES } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, X, Check, Link2, ArrowLeft, BookImage } from "lucide-react";

const PRODUCT_IMAGES = [
  "https://images.unsplash.com/photo-1603805785279-da750208c094?crop=entropy&cs=srgb&fm=jpg&q=85",
  "https://images.unsplash.com/photo-1523754182607-2ff5903ec1e2?crop=entropy&cs=srgb&fm=jpg&q=85",
  "https://images.unsplash.com/photo-1603805752838-aa579d77da72?crop=entropy&cs=srgb&fm=jpg&q=85",
  "https://images.unsplash.com/photo-1485518882345-15568b007407?crop=entropy&cs=srgb&fm=jpg&q=85",
  "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?crop=entropy&cs=srgb&fm=jpg&q=85",
  "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?crop=entropy&cs=srgb&fm=jpg&q=85",
];

function imageFor(sku) {
  if (!sku) return PRODUCT_IMAGES[0];
  let h = 0;
  for (let i = 0; i < sku.length; i++) h = (h * 31 + sku.charCodeAt(i)) >>> 0;
  return PRODUCT_IMAGES[h % PRODUCT_IMAGES.length];
}

export default function LookbookBuilder() {
  const [params] = useSearchParams();
  const customerId = params.get("customer_id") || "";
  const customerName = params.get("customer_name") || "";
  const navigate = useNavigate();

  const [title, setTitle] = useState(`Selected for ${customerName?.split(" ")[0] || "you"}`);
  const [note, setNote] = useState("");
  const [items, setItems] = useState([]);
  const [skus, setSkus] = useState([]);
  const [created, setCreated] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/bi/top-skus", { params: { date_from: daysAgo(30), date_to: today(), limit: 30 } });
        setSkus(r.data || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const addItem = (s) => {
    if (items.find((x) => x.sku === s.sku)) return;
    setItems((prev) => [
      ...prev,
      {
        sku: s.sku,
        product_title: s.product_title || s.style_name,
        price: s.unit_price_kes || s.net_sales,
        image: imageFor(s.sku),
        size: s.size,
        color: s.color || s.color_print,
      },
    ]);
  };
  const removeItem = (sku) => setItems((prev) => prev.filter((x) => x.sku !== sku));

  const create = async () => {
    if (items.length < 3) {
      toast.error("Add at least 3 items to a lookbook");
      return;
    }
    const r = await api.post("/lookbooks", {
      customer_id: customerId,
      customer_name: customerName,
      title,
      note,
      items,
    });
    setCreated(r.data);
    toast.success("Lookbook created");
  };

  const shareUrl = useMemo(() => {
    if (!created) return "";
    return `${window.location.origin}/share/${created.share_token}`;
  }, [created]);

  if (created) {
    return (
      <div className="p-6 md:p-10 max-w-3xl mx-auto" data-testid="lookbook-created">
        <Button variant="ghost" onClick={() => navigate(`/customers/${customerId}`)} className="mb-4 -ml-3 text-[var(--vivo-muted)]">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to profile
        </Button>
        <Card className="vivo-card p-10 rounded-sm text-center">
          <div className="h-12 w-12 rounded-full bg-[var(--vivo-gold)] text-white flex items-center justify-center mx-auto"><Check className="h-6 w-6"/></div>
          <h2 className="font-display text-3xl mt-4">Lookbook ready</h2>
          <p className="text-[var(--vivo-muted)] mt-2">Share this link with {customerName} via WhatsApp.</p>
          <div className="mt-6 flex items-center gap-2 justify-center">
            <Input readOnly value={shareUrl} className="h-12 rounded-sm" data-testid="lookbook-share-url" />
            <Button
              onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("Copied"); }}
              className="h-12 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm"
              data-testid="lookbook-copy"
            >
              <Link2 className="mr-2 h-4 w-4"/> Copy
            </Button>
          </div>
          <div className="mt-8 flex gap-3 justify-center">
            <Button variant="outline" className="rounded-sm" onClick={() => window.open(shareUrl, "_blank")}>Preview</Button>
            <Button className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white" onClick={() => navigate(`/customers/${customerId}`)}>Done</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto" data-testid="lookbook-builder-page">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4 -ml-3 text-[var(--vivo-muted)]">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      <div className="flex items-center gap-3">
        <BookImage className="h-6 w-6 text-[var(--vivo-gold)]" />
        <div className="eyebrow">Lookbook builder</div>
      </div>
      <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">A selection for {customerName || "this customer"}</h1>
      <div className="gold-rule mt-4" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-10">
        {/* Left: form + selected items */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="vivo-card p-6 rounded-sm">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-12 mt-1 rounded-sm" data-testid="lookbook-title" />
            <Label className="mt-4 block">Personal note</Label>
            <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Hi Sarah, I saved these pieces with you in mind…" data-testid="lookbook-note" />
          </Card>

          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-xl">Selected ({items.length})</h3>
            <p className="text-xs text-[var(--vivo-muted)] mt-1">3–15 items</p>
            <div className="vivo-divider my-3" />
            {items.length === 0 ? (
              <div className="text-sm text-[var(--vivo-muted)]">Tap items on the right to add.</div>
            ) : (
              <ul className="space-y-3" data-testid="lookbook-selected-list">
                {items.map((it) => (
                  <li key={it.sku} className="flex items-center gap-3">
                    <img src={it.image} alt="" className="h-12 w-12 object-cover rounded-sm" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{it.product_title}</div>
                      <div className="text-xs text-[var(--vivo-muted)]">{formatKES(it.price)}</div>
                    </div>
                    <button onClick={() => removeItem(it.sku)} className="text-[var(--vivo-muted)] hover:text-red-600" aria-label="Remove">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              onClick={create}
              disabled={items.length < 3}
              className="mt-6 w-full h-12 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm disabled:opacity-40"
              data-testid="lookbook-builder-generate-link"
            >
              Generate share link
            </Button>
          </Card>
        </div>

        {/* Right: catalogue */}
        <div className="lg:col-span-2">
          <h3 className="font-display text-xl">Trending pieces · 30d</h3>
          <p className="text-sm text-[var(--vivo-muted)] mt-1">Tap to add to lookbook</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5" data-testid="lookbook-catalogue">
            {loading && <div className="text-sm text-[var(--vivo-muted)]">Loading…</div>}
            {skus.map((s) => {
              const isAdded = !!items.find((x) => x.sku === s.sku);
              return (
                <div key={s.sku} className="vivo-card overflow-hidden">
                  <div className="aspect-[3/4] bg-[var(--vivo-bg)] overflow-hidden">
                    <img src={imageFor(s.sku)} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-medium truncate">{s.product_title || s.style_name}</div>
                    <div className="text-xs text-[var(--vivo-muted)] mt-1">{s.size ? `Size ${s.size}` : ""}{s.color ? ` · ${s.color}` : ""}</div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="font-mono-num text-sm">{formatKES(s.unit_price_kes || s.net_sales)}</div>
                      <button
                        onClick={() => addItem(s)}
                        disabled={isAdded}
                        data-testid={`lookbook-builder-add-product-${s.sku}`}
                        className={`h-9 px-3 rounded-sm text-xs uppercase tracking-wider ${
                          isAdded
                            ? "bg-[var(--vivo-bg)] text-[var(--vivo-muted)]"
                            : "bg-[var(--vivo-navy)] text-white hover:bg-[var(--vivo-navy-700)]"
                        }`}
                      >
                        {isAdded ? "Added" : <span className="inline-flex items-center"><Plus className="h-3 w-3 mr-1"/>Add</span>}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
