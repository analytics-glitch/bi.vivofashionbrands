import React, { useEffect, useMemo, useState } from "react";
import { api, formatKES, formatNumber } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Filter, Users, Sparkles, Send, Download, Phone, Wand2, RefreshCw, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

const TIERS = ["vip", "loyal", "regular", "occasional", "at_risk", "new"];

export default function Segments() {
  const [filters, setFilters] = useState({ rfm_tiers: [], cities: [] });
  const [q, setQ] = useState({
    rfm_tiers: ["vip"],
    cities: [],
    min_total_sales: "",
    min_orders: "",
    last_purchase_after: "",
    last_purchase_before: "",
    not_contacted_days: "",
    assigned_only: false,
    unassigned_only: false,
    limit: 500,
  });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [template, setTemplate] = useState("Hi {first_name}, [[ai: write one warm sentence inviting her to view the new collection, referencing she's a {rfm_tier} client based in {city}]]");
  const [campaignPreview, setCampaignPreview] = useState(null);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.get("/segments/filters").then((r) => setFilters(r.data)).catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true);
    try {
      const body = {
        rfm_tiers: q.rfm_tiers,
        cities: q.cities.length ? q.cities : undefined,
        min_total_sales: q.min_total_sales ? Number(q.min_total_sales) : undefined,
        min_orders: q.min_orders ? Number(q.min_orders) : undefined,
        last_purchase_after: q.last_purchase_after || undefined,
        last_purchase_before: q.last_purchase_before || undefined,
        not_contacted_days: q.not_contacted_days ? Number(q.not_contacted_days) : undefined,
        assigned_only: q.assigned_only || undefined,
        unassigned_only: q.unassigned_only || undefined,
        limit: q.limit,
      };
      const r = await api.post("/segments/preview", body);
      setPreview(r.data);
    } catch { toast.error("Could not run segment"); }
    setLoading(false);
  };

  // Auto-run on first load
  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const toggleTier = (t) => {
    const has = q.rfm_tiers.includes(t);
    setQ({ ...q, rfm_tiers: has ? q.rfm_tiers.filter((x) => x !== t) : [...q.rfm_tiers, t] });
  };

  const exportCSV = () => {
    if (!preview?.customers?.length) return;
    const rows = preview.customers.map((c) => ({
      customer_id: c.customer_id,
      name: c.customer_name || "",
      phone: c.phone || "",
      email: c.email || "",
      city: c.city || "",
      rfm_tier: c.rfm_tier || "",
      total_orders: c.total_orders || 0,
      total_sales_kes: c.total_sales || 0,
      last_purchase: c.last_purchase_date || "",
    }));
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(",")].concat(
      rows.map((r) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(","))
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vivo-segment-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const runCampaignPreview = async () => {
    if (!preview?.customers?.length) return;
    setCampaignLoading(true);
    setCampaignPreview(null);
    try {
      const r = await api.post("/campaigns/preview", {
        customer_ids: preview.customers.slice(0, 100).map((c) => c.customer_id),
        template,
        intent: "campaign",
        tone: "warm",
      });
      setCampaignPreview(r.data);
    } catch { toast.error("Could not render campaign"); }
    setCampaignLoading(false);
  };

  const sendCampaign = async () => {
    if (!campaignPreview?.messages?.length) return;
    setSending(true);
    try {
      const r = await api.post("/campaigns/send", { messages: campaignPreview.messages });
      toast.success(`Logged ${r.data.sent} messages — hand off via wa.me from each customer profile`);
      setCampaignOpen(false);
      setCampaignPreview(null);
    } catch { toast.error("Send failed"); }
    setSending(false);
  };

  return (
    <div className="p-6 md:p-10 max-w-[1500px] mx-auto" data-testid="segments-page">
      <div>
        <div className="eyebrow">Outreach</div>
        <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Smart segments</h1>
        <div className="gold-rule mt-4" />
        <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
          Build a precise customer list with visual filters, then export to CSV or run an
          AI-personalized WhatsApp campaign — one message tailored to each client.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-8">
        {/* Filters */}
        <Card className="lg:col-span-1 vivo-card p-5 rounded-sm" data-testid="segment-filters">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-[var(--vivo-navy)]" />
            <div className="eyebrow">Filters</div>
          </div>

          <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">RFM tier</Label>
          <div className="flex flex-wrap gap-1.5 mt-1 mb-4">
            {TIERS.map((t) => (
              <button
                key={t}
                onClick={() => toggleTier(t)}
                data-testid={`tier-${t}`}
                className={`text-[11px] px-2 py-1 rounded-sm border ${
                  q.rfm_tiers.includes(t)
                    ? "bg-[var(--vivo-navy)] text-white border-[var(--vivo-navy)]"
                    : "bg-white text-[var(--vivo-muted)] border-[var(--vivo-border)] hover:text-[var(--vivo-navy)]"
                }`}
              >
                {t.replace("_", " ")}
              </button>
            ))}
          </div>

          <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Min lifetime spend (KES)</Label>
          <Input type="number" value={q.min_total_sales} onChange={(e) => setQ({ ...q, min_total_sales: e.target.value })} className="mt-1 mb-3 rounded-sm h-9" placeholder="e.g. 50000" data-testid="filter-min-sales" />

          <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Min orders</Label>
          <Input type="number" value={q.min_orders} onChange={(e) => setQ({ ...q, min_orders: e.target.value })} className="mt-1 mb-3 rounded-sm h-9" placeholder="e.g. 5" data-testid="filter-min-orders" />

          <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Last purchase after</Label>
          <Input type="date" value={q.last_purchase_after} onChange={(e) => setQ({ ...q, last_purchase_after: e.target.value })} className="mt-1 mb-3 rounded-sm h-9" data-testid="filter-last-after" />

          <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Last purchase before</Label>
          <Input type="date" value={q.last_purchase_before} onChange={(e) => setQ({ ...q, last_purchase_before: e.target.value })} className="mt-1 mb-3 rounded-sm h-9" data-testid="filter-last-before" />

          <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Not contacted in (days)</Label>
          <Input type="number" value={q.not_contacted_days} onChange={(e) => setQ({ ...q, not_contacted_days: e.target.value })} className="mt-1 mb-3 rounded-sm h-9" placeholder="e.g. 30" data-testid="filter-not-contacted" />

          <div className="space-y-2 mb-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={q.unassigned_only} onChange={(e) => setQ({ ...q, unassigned_only: e.target.checked, assigned_only: e.target.checked ? false : q.assigned_only })} data-testid="filter-unassigned" />
              <span className="text-[var(--vivo-muted)]">Unassigned only</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={q.assigned_only} onChange={(e) => setQ({ ...q, assigned_only: e.target.checked, unassigned_only: e.target.checked ? false : q.unassigned_only })} data-testid="filter-assigned" />
              <span className="text-[var(--vivo-muted)]">Assigned only</span>
            </label>
          </div>

          <Button onClick={run} disabled={loading} className="w-full h-10 rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white" data-testid="run-segment">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Running…" : "Run segment"}
          </Button>
        </Card>

        {/* Results */}
        <Card className="lg:col-span-3 vivo-card p-5 rounded-sm" data-testid="segment-results">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--vivo-navy)]" />
                <div className="eyebrow">Match</div>
              </div>
              <div className="font-display text-3xl mt-1 font-mono-num" data-testid="match-count">
                {preview ? formatNumber(preview.total_matches) : "—"}
                <span className="text-base text-[var(--vivo-muted)] ml-2">customers</span>
              </div>
              {preview && preview.shown < preview.total_matches && (
                <div className="text-xs text-[var(--vivo-muted)] mt-1">
                  Showing top {preview.shown.toLocaleString()} (raise limit to see more)
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportCSV} disabled={!preview?.customers?.length} className="rounded-sm h-10" data-testid="export-csv">
                <Download className="h-4 w-4 mr-1.5" /> Export CSV
              </Button>
              <Button
                onClick={() => setCampaignOpen(true)}
                disabled={!preview?.customers?.length}
                className="rounded-sm h-10 bg-[var(--vivo-gold)] hover:bg-[var(--vivo-gold)]/90 text-[var(--vivo-navy)] font-semibold"
                data-testid="open-campaign"
              >
                <Wand2 className="h-4 w-4 mr-1.5" /> AI campaign
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b border-[var(--vivo-border)]">
                <tr className="text-left text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">
                  <th className="py-2">Customer</th>
                  <th>Tier</th>
                  <th>City</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Lifetime</th>
                  <th>Last bought</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(preview?.customers || []).map((c) => (
                  <tr key={c.customer_id} className="border-b border-[var(--vivo-border)] hover:bg-[var(--vivo-bg)]" data-testid={`seg-row-${c.customer_id}`}>
                    <td className="py-2.5 font-medium">{c.customer_name || c.customer_id}</td>
                    <td><span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-[var(--vivo-bg)] border border-[var(--vivo-border)]">{c.rfm_tier || "—"}</span></td>
                    <td className="text-[var(--vivo-muted)]">{c.city || "—"}</td>
                    <td className="text-right font-mono-num">{c.total_orders || 0}</td>
                    <td className="text-right font-mono-num">{formatKES(c.total_sales || 0)}</td>
                    <td className="text-xs text-[var(--vivo-muted)]">{c.last_purchase_date || "—"}</td>
                    <td className="text-right"><Link to={`/customers/${c.customer_id}`} className="text-xs text-[var(--vivo-navy)] hover:underline">Open →</Link></td>
                  </tr>
                ))}
                {!preview?.customers?.length && (
                  <tr><td colSpan={7} className="text-center text-[var(--vivo-muted)] py-10 text-sm">No customers match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Campaign dialog */}
      <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
        <DialogContent className="max-w-3xl rounded-sm" data-testid="campaign-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Wand2 className="h-5 w-5 text-[var(--vivo-gold)]" /> AI-personalized campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-[var(--vivo-muted)]">
              {preview?.customers?.length || 0} customers in segment · campaign caps at 100 per run.
              Use placeholders <code className="bg-[var(--vivo-bg)] px-1">{"{first_name}"}</code>, <code className="bg-[var(--vivo-bg)] px-1">{"{rfm_tier}"}</code>, <code className="bg-[var(--vivo-bg)] px-1">{"{city}"}</code>, or an AI instruction block <code className="bg-[var(--vivo-bg)] px-1">[[ai: write one warm sentence about new arrivals]]</code>.
            </p>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Template</Label>
            <Textarea rows={4} value={template} onChange={(e) => setTemplate(e.target.value)} className="rounded-sm font-mono text-xs" data-testid="campaign-template" />

            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={runCampaignPreview} disabled={campaignLoading} className="rounded-sm" data-testid="campaign-preview-btn">
                {campaignLoading ? "Generating…" : campaignPreview ? "Re-generate" : "Generate previews"}
              </Button>
              {campaignPreview && (
                <span className="text-xs text-[var(--vivo-muted)]">{campaignPreview.count} messages drafted</span>
              )}
            </div>

            {campaignPreview && (
              <div className="border border-[var(--vivo-border)] rounded-sm max-h-[300px] overflow-y-auto" data-testid="campaign-preview-list">
                {campaignPreview.messages.slice(0, 50).map((m, i) => (
                  <div key={i} className="px-3 py-2 border-b border-[var(--vivo-border)] last:border-0">
                    <div className="text-[11px] text-[var(--vivo-muted)] flex items-center gap-2">
                      <span className="font-medium text-[var(--vivo-text)]">{m.customer_name}</span>
                      {m.phone && <span><Phone className="inline h-3 w-3 mr-0.5" />{m.phone}</span>}
                    </div>
                    <div className="text-sm mt-1">{m.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCampaignOpen(false)}>Cancel</Button>
            <Button onClick={sendCampaign} disabled={!campaignPreview?.messages?.length || sending} className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white" data-testid="campaign-send">
              <Send className="h-4 w-4 mr-1.5" /> {sending ? "Logging…" : `Log ${campaignPreview?.count || 0} messages`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
