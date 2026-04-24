import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Bell, CheckCircle } from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * NotificationBell — curated platform inbox in the top nav.
 *
 * Four event types (from the UX audit): new_record, stockout,
 * vip_return, anomaly. Events are generated on-demand by the backend
 * `POST /api/notifications/refresh`; the bell calls it every time the
 * dropdown opens so the list is always current.
 */

const TYPE_META = {
  new_record: { emoji: "🏆", accent: "bg-emerald-50 border-emerald-200 text-emerald-900" },
  stockout:   { emoji: "⚠️", accent: "bg-amber-50 border-amber-200 text-amber-900" },
  vip_return: { emoji: "💎", accent: "bg-sky-50 border-sky-200 text-sky-900" },
  anomaly:    { emoji: "🚨", accent: "bg-red-50 border-red-200 text-red-900" },
};

const relative = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  // Close on outside click
  useEffect(() => {
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const fetchUnread = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/unread-count");
      setUnread(data?.unread || 0);
    } catch { /* silent — a bell that fails shouldn't spam toasts */ }
  }, []);

  // Initial + periodic unread-count refresh
  useEffect(() => {
    fetchUnread();
    const iv = setInterval(fetchUnread, 2 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchUnread]);

  const refreshAndLoad = useCallback(async () => {
    setLoading(true);
    try {
      await api.post("/notifications/refresh").catch(() => null);
      const { data } = await api.get("/notifications", { params: { limit: 50 } });
      setItems(data || []);
      setUnread((data || []).filter((r) => !r.read).length);
    } catch (e) {
      toast.error("Couldn't load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  const onToggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next) refreshAndLoad();
      return next;
    });
  };

  const openItem = async (it) => {
    // Optimistic mark-read
    if (!it.read) {
      setItems((arr) => arr.map((r) => (r.event_id === it.event_id ? { ...r, read: true } : r)));
      setUnread((u) => Math.max(0, u - 1));
      api.post(`/notifications/${encodeURIComponent(it.event_id)}/read`).catch(() => null);
    }
    setOpen(false);
    if (it.link) navigate(it.link);
  };

  const markAllRead = async () => {
    try {
      await api.post("/notifications/read-all");
      setItems((arr) => arr.map((r) => ({ ...r, read: true })));
      setUnread(0);
      toast.success("All caught up");
    } catch {
      toast.error("Couldn't mark all read");
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={onToggle}
        className="relative p-1.5 rounded-lg hover:bg-panel"
        data-testid="notifications-bell"
        aria-label="Notifications"
      >
        <Bell size={18} weight={unread > 0 ? "fill" : "regular"} className={unread > 0 ? "text-brand" : "text-muted"} />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 grid place-items-center rounded-full bg-red-600 text-white text-[10px] font-bold border border-white"
            data-testid="notifications-unread-badge"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[360px] rounded-xl border border-border bg-white shadow-xl z-[60]"
          data-testid="notifications-panel"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="font-semibold text-[13px]">Notifications</div>
            <div className="flex items-center gap-2">
              {items.some((i) => !i.read) && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-[11px] text-brand hover:text-brand-deep inline-flex items-center gap-1"
                  data-testid="notifications-mark-all-read"
                >
                  <CheckCircle size={12} /> Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-[12.5px] text-muted">Loading…</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center text-[12.5px] text-muted">
                🎉 Nothing new — enjoy the calm.
              </div>
            ) : (
              items.map((it) => {
                const meta = TYPE_META[it.type] || { emoji: "🔔", accent: "bg-panel border-border" };
                return (
                  <button
                    key={it.event_id}
                    type="button"
                    onClick={() => openItem(it)}
                    className={`w-full text-left flex items-start gap-3 px-3 py-2.5 border-b border-border hover:bg-panel transition-colors ${!it.read ? "bg-brand/5" : ""}`}
                    data-testid={`notification-${it.type}`}
                  >
                    <div className={`shrink-0 w-8 h-8 rounded-lg border grid place-items-center text-base ${meta.accent}`}>
                      {meta.emoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-[12.5px] truncate">{it.title}</div>
                        {!it.read && (
                          <span className="shrink-0 w-[6px] h-[6px] rounded-full bg-brand" aria-hidden="true" />
                        )}
                      </div>
                      <div className="text-[12px] text-muted mt-0.5 line-clamp-2">
                        {it.message}
                      </div>
                      <div className="text-[10.5px] text-muted/70 mt-1">
                        {relative(it.created_at)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
