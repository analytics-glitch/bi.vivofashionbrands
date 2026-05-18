import React, { useEffect, useState } from "react";
import { Sparkles, ExternalLink, X } from "lucide-react";

const CHANGELOG = [
  {
    date: "May 2026",
    items: [
      "AI Customer Brief — one-tap Claude summary on every customer profile",
      "Global date range with compare period (▲▼ delta chips on all KPIs)",
      "BI-style top nav with global customer search & notifications bell",
      "Live Facebook sync for 6 Vivo pages (auto-syncs every 15 min)",
      "Training analytics — full L&D dashboard with Nairobi time correction",
    ],
  },
  {
    date: "Apr 2026",
    items: [
      "Customer-associate assignments & My Customers filter",
      "Domain-restricted Google login (@vivofashiongroup, @shopzetu)",
      "MTD net-sales reconciliation with Vivo BI",
      "WhatsApp deep-links from customer profiles",
    ],
  },
];

function PoweredFooter() {
  return (
    <footer className="mt-16 border-t border-[var(--vivo-border)] py-6 px-6 md:px-10 flex items-center justify-between gap-4 flex-wrap text-xs text-[var(--vivo-muted)]" data-testid="powered-footer">
      <div className="flex items-center gap-2">
        <span>Powered by</span>
        <a
          href="https://bi.vivofashionbrands.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-[var(--vivo-navy)] transition"
          data-testid="bi-link"
        >
          <span className="vivo-logo-tile h-5 w-5 text-[10px]">Vivo</span>
          <span className="font-semibold">Vivo BI</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <span className="hidden md:inline">Clienteling for Vivo Fashion Group · East Africa</span>
        <a href="mailto:support@vivofashiongroup.com" className="hover:text-[var(--vivo-navy)]">Support</a>
        <span>© {new Date().getFullYear()} Vivo Fashion Group</span>
      </div>
    </footer>
  );
}

function ChangelogButton() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem("vivo.changelog.lastSeen");
      const latest = CHANGELOG[0]?.date;
      if (latest && seen !== latest) setUnread(true);
    } catch { /* ignore */ }
  }, []);

  const close = () => {
    setOpen(false);
    setUnread(false);
    try { localStorage.setItem("vivo.changelog.lastSeen", CHANGELOG[0].date); } catch { /* ignore */ }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:inline-flex relative h-9 w-9 items-center justify-center rounded-sm border border-[var(--vivo-border)] bg-[var(--vivo-bg)] text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)]"
        data-testid="changelog-button"
        aria-label="What's new"
      >
        <Sparkles className="h-4 w-4" />
        {unread && (
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[var(--vivo-gold)] ring-2 ring-white" />
        )}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-end p-4 md:p-8"
          onClick={close}
          data-testid="changelog-overlay"
        >
          <div
            className="bg-white rounded-sm border border-[var(--vivo-border)] w-full max-w-md max-h-[80vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="changelog-panel"
          >
            <div className="sticky top-0 bg-white border-b border-[var(--vivo-border)] px-5 py-4 flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">What's new</div>
                <div className="font-display text-2xl mt-1">Vivo CRM</div>
              </div>
              <button type="button" onClick={close} className="text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)]" data-testid="changelog-close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-6">
              {CHANGELOG.map((r) => (
                <div key={r.date}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="vivo-logo-tile h-5 w-5 text-[10px]">Vivo</span>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">{r.date}</span>
                  </div>
                  <ul className="space-y-2">
                    {r.items.map((it, i) => (
                      <li key={i} className="text-sm flex gap-2">
                        <span className="text-[var(--vivo-gold)] shrink-0">•</span>
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function EmptyState({ title, message, icon: Icon, action }) {
  return (
    <div className="py-16 px-6 text-center" data-testid="empty-state">
      <div className="inline-flex items-center justify-center h-14 w-14 rounded-sm bg-[var(--vivo-bg)] border border-[var(--vivo-gold)] text-[var(--vivo-gold)] mb-4">
        {Icon ? <Icon className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </div>
      <div className="font-display text-xl">{title}</div>
      {message && <p className="text-sm text-[var(--vivo-muted)] mt-2 max-w-md mx-auto">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="vivo-card p-6 animate-pulse" data-testid="kpi-skeleton">
      <div className="h-2.5 w-24 bg-[var(--vivo-border)] rounded" />
      <div className="h-9 w-32 bg-[var(--vivo-border)] rounded mt-4" />
      <div className="h-2.5 w-20 bg-[var(--vivo-border)] rounded mt-3" />
    </div>
  );
}

export function CardSkeleton({ rows = 3 }) {
  return (
    <div className="vivo-card p-6 animate-pulse" data-testid="card-skeleton">
      <div className="h-3 w-32 bg-[var(--vivo-border)] rounded" />
      <div className="space-y-3 mt-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-3 w-full bg-[var(--vivo-border)] rounded" style={{ width: `${100 - i * 15}%` }} />
        ))}
      </div>
    </div>
  );
}

export { PoweredFooter, ChangelogButton };
