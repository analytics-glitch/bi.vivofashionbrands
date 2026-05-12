import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Loading, ErrorBox, Empty } from "@/components/common";
import { ChatCircleDots, CheckCircle, Clock, FloppyDisk } from "@phosphor-icons/react";

/**
 * Admin Feedback Inbox — list every feedback entry, filter by status,
 * mark resolved, leave admin notes.
 */
const AdminFeedback = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const [savingId, setSavingId] = useState(null);
  const [draftNotes, setDraftNotes] = useState({});

  const load = () => {
    setLoading(true);
    setError(null);
    api.get("/feedback", { params: { status: statusFilter } })
      .then((r) => setItems(r.data || []))
      .catch((e) => setError(e?.response?.data?.detail || e.message || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const counts = useMemo(() => {
    const open = items.filter((i) => !i.resolved).length;
    const resolved = items.filter((i) => i.resolved).length;
    return { open, resolved, total: items.length };
  }, [items]);

  const toggleResolved = async (item) => {
    setSavingId(item.id);
    try {
      const { data } = await api.patch(`/feedback/${item.id}`, { resolved: !item.resolved });
      setItems((prev) => prev.map((i) => (i.id === item.id ? data : i)));
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const saveNote = async (item) => {
    const note = draftNotes[item.id] ?? item.admin_note ?? "";
    setSavingId(item.id);
    try {
      const { data } = await api.patch(`/feedback/${item.id}`, { admin_note: note });
      setItems((prev) => prev.map((i) => (i.id === item.id ? data : i)));
      setDraftNotes((d) => { const c = { ...d }; delete c[item.id]; return c; });
    } catch (e) {
      alert(e?.response?.data?.detail || e.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-feedback-page">
      <div>
        <div className="eyebrow">Admin · Feedback Inbox</div>
        <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(15px,1.5vw,19px)] inline-flex items-center gap-2">
          <ChatCircleDots size={22} weight="duotone" className="text-[#1a5c38]" />
          Feedback Inbox
        </h1>
        <p className="text-muted text-[13px] mt-1 max-w-2xl">
          Every feedback submission lands here. Use the resolved toggle to
          close items as you action them.
        </p>
      </div>

      <div className="card-white p-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-border overflow-hidden" data-testid="feedback-status-filter">
          {["open", "resolved", "all"].map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                data-testid={`feedback-filter-${s}`}
                className={`px-3 py-1 text-[11.5px] font-semibold capitalize ${
                  active ? "bg-[#1a5c38] text-white" : "bg-white text-[#374151] hover:bg-gray-100"
                }`}
              >
                {s} {s === "open" && counts.open > 0 ? `(${counts.open})` : ""}
              </button>
            );
          })}
        </div>
        <span className="text-[11.5px] text-muted ml-auto">
          {counts.total} item{counts.total === 1 ? "" : "s"} · {counts.open} open · {counts.resolved} resolved
        </span>
      </div>

      {loading && <Loading label="Loading feedback…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && items.length === 0 && <Empty label="No feedback yet." />}

      {!loading && !error && items.length > 0 && (
        <ul className="space-y-3" data-testid="admin-feedback-list">
          {items.map((f) => (
            <li
              key={f.id}
              data-testid={`feedback-item-${f.id}`}
              className={`card-white p-4 border-l-4 ${
                f.resolved ? "border-l-emerald-400 opacity-80" : "border-l-amber-400"
              }`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-[10.5px] font-bold uppercase tracking-wide bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">
                      {f.category}
                    </span>
                    {f.page && (
                      <span className="text-[11px] font-mono text-muted bg-gray-100 px-1.5 py-0.5 rounded">
                        {f.page}
                      </span>
                    )}
                    <span className="text-[11px] text-muted">{f.user_email}</span>
                    <span className="text-[10.5px] text-muted">
                      {new Date(f.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[13px] text-foreground whitespace-pre-wrap break-words">
                    {f.message}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <textarea
                      placeholder="Add admin note (optional)…"
                      defaultValue={f.admin_note || ""}
                      onChange={(e) => setDraftNotes((d) => ({ ...d, [f.id]: e.target.value }))}
                      className="flex-1 min-w-[200px] text-[12px] border border-border rounded-md px-2 py-1.5 focus:border-brand outline-none resize-y"
                      rows={2}
                      data-testid={`feedback-note-${f.id}`}
                    />
                    <button
                      type="button"
                      onClick={() => saveNote(f)}
                      disabled={savingId === f.id || draftNotes[f.id] === undefined}
                      className="text-[11.5px] font-semibold text-brand-deep border border-brand-deep/30 hover:bg-brand-deep/5 px-2.5 py-1.5 rounded-md disabled:opacity-40 inline-flex items-center gap-1"
                      data-testid={`feedback-save-note-${f.id}`}
                    >
                      <FloppyDisk size={12} /> Save note
                    </button>
                  </div>
                </div>
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleResolved(f)}
                    disabled={savingId === f.id}
                    className={`inline-flex items-center gap-1.5 text-[11.5px] font-bold px-3 py-1.5 rounded-full border ${
                      f.resolved
                        ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                        : "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                    }`}
                    data-testid={`feedback-toggle-${f.id}`}
                  >
                    {f.resolved ? <CheckCircle size={12} weight="fill" /> : <Clock size={12} weight="fill" />}
                    {f.resolved ? "Resolved · click to reopen" : "Mark resolved"}
                  </button>
                  {f.resolved && f.resolved_by && (
                    <div className="text-[10px] text-muted mt-1 text-right">
                      by {f.resolved_by}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AdminFeedback;
