import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Templates() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", channel: "whatsapp", body: "" });

  const load = async () => {
    const r = await api.get("/templates");
    setItems(r.data || []);
  };

  useEffect(() => { load(); }, []);

  const startNew = () => { setEditing(null); setForm({ name: "", channel: "whatsapp", body: "" }); setOpen(true); };
  const startEdit = (t) => { setEditing(t); setForm({ name: t.name, channel: t.channel, body: t.body }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim() || !form.body.trim()) return;
    if (editing) {
      await api.put(`/templates/${editing.template_id}`, form);
      toast.success("Template updated");
    } else {
      await api.post("/templates", form);
      toast.success("Template created");
    }
    setOpen(false);
    load();
  };

  const remove = async (id) => {
    await api.delete(`/templates/${id}`);
    toast.success("Template deleted");
    load();
  };

  return (
    <div className="p-6 md:p-10 max-w-[1200px] mx-auto" data-testid="templates-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="eyebrow">Manager · Templates</div>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight mt-2">Message templates</h1>
          <div className="gold-rule mt-4" />
        </div>
        <Button onClick={startNew} className="h-12 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm" data-testid="template-new">
          <Plus className="mr-2 h-4 w-4" /> New template
        </Button>
      </div>
      <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
        Use placeholders like <code>{"{customer_name}"}</code>, <code>{"{associate_name}"}</code>, <code>{"{item_name}"}</code> and <code>{"{collection}"}</code> — they fill in when an associate sends.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-8" data-testid="templates-list">
        {items.map((t) => (
          <Card key={t.template_id} className="vivo-card p-6 rounded-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow flex items-center gap-2">
                  <span>{t.channel}</span>
                  <BspStatusPill t={t} onChange={load} />
                </div>
                <h3 className="font-display text-xl mt-1">{t.name}</h3>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => startEdit(t)} data-testid={`template-edit-${t.template_id}`}>Edit</Button>
                <Button variant="ghost" size="icon" onClick={() => remove(t.template_id)} data-testid={`template-delete-${t.template_id}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap">{t.body}</p>
          </Card>
        ))}
        {items.length === 0 && <div className="text-sm text-[var(--vivo-muted)]">No templates yet.</div>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm max-w-lg">
          <DialogHeader><DialogTitle className="font-display">{editing ? "Edit template" : "New template"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-12 mt-1" data-testid="template-name" />
            </div>
            <div>
              <Label>Channel</Label>
              <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                <SelectTrigger className="h-12 mt-1 rounded-sm" data-testid="template-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Body</Label>
              <Textarea rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} data-testid="template-body" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} className="bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm" data-testid="template-save">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const BSP_STYLE = {
  draft: { bg: "bg-zinc-100", text: "text-zinc-700", label: "Draft" },
  pending: { bg: "bg-amber-100", text: "text-amber-800", label: "BSP pending" },
  approved: { bg: "bg-emerald-100", text: "text-emerald-800", label: "BSP approved" },
  rejected: { bg: "bg-red-100", text: "text-red-700", label: "BSP rejected" },
};

function BspStatusPill({ t, onChange }) {
  const [open, setOpen] = React.useState(false);
  const status = t.bsp_status || "draft";
  const style = BSP_STYLE[status] || BSP_STYLE.draft;
  const update = async (next) => {
    setOpen(false);
    try {
      await api.put(`/templates/${t.template_id}/bsp-status`, { bsp_status: next });
      onChange?.();
    } catch { /* ignore */ }
  };
  return (
    <div className="relative inline-block" data-testid={`bsp-pill-${t.template_id}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ${style.bg} ${style.text} hover:opacity-80`}
      >
        {style.label}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-[var(--vivo-border)] rounded-sm shadow-md py-1 min-w-[140px]">
          {Object.entries(BSP_STYLE).map(([k, v]) => (
            <button
              key={k}
              onClick={() => update(k)}
              className={`block w-full text-left px-3 py-1 text-xs hover:bg-[var(--vivo-bg)] ${k === status ? "font-semibold" : ""}`}
              data-testid={`bsp-pill-${t.template_id}-${k}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
