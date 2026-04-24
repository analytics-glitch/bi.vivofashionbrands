import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import {
  MagnifyingGlass, Storefront, Tag, User as UserIcon,
  Stack, ArrowRight, X as CloseIcon, Sparkle, Lightning,
} from "@phosphor-icons/react";

/**
 * GlobalSearch — ⌘K / Ctrl+K command palette.
 *
 * Scopes: pages, stores, styles, customers. Hits `/api/search?q=...`
 * (debounced 180ms) and groups results. Arrow keys navigate, Enter
 * opens, Esc closes. The overlay dismisses on outside-click.
 *
 * Keyboard shortcut is captured at the document level so it works
 * anywhere in the app — no focus-steal on inputs (we bail out if the
 * user is typing into an input/textarea/contentEditable).
 */

const GROUP_META = {
  pages:     { label: "Pages",     icon: Stack,       color: "text-slate-700" },
  stores:    { label: "Stores",    icon: Storefront,  color: "text-brand-deep" },
  styles:    { label: "Styles",    icon: Tag,         color: "text-orange-600" },
  customers: { label: "Customers", icon: UserIcon,    color: "text-sky-700" },
};

// Heuristic — treat a query as an "Ask" (NL) intent if it looks like a
// question (starts with a wh-word or has >2 words + a comparator/verb).
// Everything else falls through to the substring search below.
const ASK_TRIGGERS = /(^|\s)(how|what|which|who|show|list|find|top|bottom|stores?|styles?|customers?|phantom|stuck|reorder|pricing|absent|expired|with|over|under|>|<|%|days?)(\s|$)/i;
const isQuestionLike = (s) => {
  if (!s) return false;
  const t = s.trim();
  if (t.endsWith("?")) return true;
  if (t.split(/\s+/).length >= 3 && ASK_TRIGGERS.test(t)) return true;
  return false;
};

const isTypingElement = (el) => {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return !!el.isContentEditable;
};

const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState({ pages: [], stores: [], styles: [], customers: [] });
  const [activeIdx, setActiveIdx] = useState(0);
  // Ask-anything state
  const [askMode, setAskMode] = useState(false);    // explicit toggle
  const [askLoading, setAskLoading] = useState(false);
  const [askResult, setAskResult] = useState(null);
  const [askError, setAskError] = useState(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Keyboard shortcut — document-level listener.
  useEffect(() => {
    const handler = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        // Allow opening even from an input — just prevent the browser's
        // default location-bar focus and pop our palette.
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !mod && !isTypingElement(document.activeElement)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Debounce the query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  // Fetch results when open + query. Only runs when NOT in askMode —
  // askMode hits the LLM-backed /search/ask endpoint instead.
  useEffect(() => {
    if (!open || askMode) return;
    if (!debouncedQ) {
      setGroups({ pages: [], stores: [], styles: [], customers: [] });
      return;
    }
    let cancel = false;
    setLoading(true);
    api
      .get("/search", { params: { q: debouncedQ, limit: 5 } })
      .then(({ data }) => {
        if (cancel) return;
        setGroups({
          pages:     data.pages || [],
          stores:    data.stores || [],
          styles:    data.styles || [],
          customers: data.customers || [],
        });
        setActiveIdx(0);
      })
      .catch(() => {
        if (cancel) return;
        setGroups({ pages: [], stores: [], styles: [], customers: [] });
      })
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [open, debouncedQ]);

  // Focus the input whenever we open.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
    else {
      setQ("");
      setGroups({ pages: [], stores: [], styles: [], customers: [] });
      setAskMode(false);
      setAskResult(null);
      setAskError(null);
    }
  }, [open]);

  // Auto-enable askMode for question-like input.
  useEffect(() => {
    if (debouncedQ && isQuestionLike(debouncedQ)) setAskMode(true);
  }, [debouncedQ]);

  // Fetch Ask answer when askMode + debounced query.
  useEffect(() => {
    if (!open || !askMode || !debouncedQ) return;
    let cancel = false;
    setAskLoading(true);
    setAskError(null);
    setAskResult(null);
    api
      .post("/search/ask", { q: debouncedQ }, { timeout: 120000 })
      .then(({ data }) => { if (!cancel) setAskResult(data); })
      .catch((e) => !cancel && setAskError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setAskLoading(false));
    return () => { cancel = true; };
  }, [open, askMode, debouncedQ]);

  // Flatten results in display order for keyboard nav.
  const flat = useMemo(() => {
    const out = [];
    ["pages", "stores", "styles", "customers"].forEach((g) => {
      (groups[g] || []).forEach((r, i) => out.push({ group: g, idx: i, item: r }));
    });
    return out;
  }, [groups]);

  const openItem = useCallback((entry) => {
    const link = entry.item.link;
    if (link) navigate(link);
    setOpen(false);
  }, [navigate]);

  const onKeyDown = (e) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[activeIdx]) openItem(flat[activeIdx]);
    }
  };

  if (!open) return null;

  const renderItem = (entry, i) => {
    const { group, item } = entry;
    const isActive = i === activeIdx;
    const meta = GROUP_META[group];
    const Icon = meta.icon;
    const label =
      group === "pages"     ? item.label :
      group === "stores"    ? item.name :
      group === "styles"    ? item.style_name :
                              item.customer_name;
    const sub =
      group === "pages"     ? item.hint :
      group === "stores"    ? item.country :
      group === "styles"    ? `${item.brand || "—"} · ${item.subcategory || "—"}` :
                              (item.phone || "—");
    return (
      <button
        key={`${group}-${entry.idx}`}
        type="button"
        data-testid={`gs-item-${group}-${entry.idx}`}
        onMouseEnter={() => setActiveIdx(i)}
        onClick={() => openItem(entry)}
        className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md ${isActive ? "bg-brand/10" : "hover:bg-panel"}`}
      >
        <Icon size={16} className={meta.color} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate">{label}</div>
          {sub && <div className="text-[11px] text-muted truncate">{sub}</div>}
        </div>
        <ArrowRight size={12} className="text-muted" />
      </button>
    );
  };

  // Group section renderer — only shows the header if the group has results.
  let runningIdx = 0;
  const sections = ["pages", "stores", "styles", "customers"].map((g) => {
    const rows = groups[g] || [];
    if (rows.length === 0) return null;
    const meta = GROUP_META[g];
    const Icon = meta.icon;
    const section = (
      <div key={g} className="mb-2">
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-muted px-3 mt-2 mb-1">
          <Icon size={10} /> {meta.label} · {rows.length}
        </div>
        <div className="space-y-0.5">
          {rows.map((_, i) => {
            const entry = flat[runningIdx + i];
            if (!entry) return null;
            return renderItem(entry, runningIdx + i);
          })}
        </div>
      </div>
    );
    runningIdx += rows.length;
    return section;
  });

  const anyResults = flat.length > 0;
  const showEmptyState = debouncedQ && !loading && !anyResults;

  return (
    <div
      className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 pt-[10vh]"
      onClick={() => setOpen(false)}
      data-testid="global-search-overlay"
    >
      <div
        className="card-white w-full max-w-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          {askMode
            ? <Sparkle size={16} className="text-brand" weight="fill" />
            : <MagnifyingGlass size={16} className="text-muted" />}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={askMode
              ? "Ask anything: 'stores with stuck stock', 'customers absent 60 days'…"
              : "Search stores, styles, customers, pages…"}
            className="flex-1 bg-transparent outline-none text-[14px]"
            data-testid="global-search-input"
          />
          <button
            type="button"
            onClick={() => { setAskMode((v) => !v); setAskResult(null); setAskError(null); }}
            className={`hidden sm:inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded border transition-colors ${askMode ? "bg-brand text-white border-brand" : "bg-panel border-border text-muted hover:text-brand"}`}
            data-testid="global-search-ask-toggle"
            title="Toggle Ask-anything mode"
          >
            <Sparkle size={10} weight={askMode ? "fill" : "regular"} />
            Ask
          </button>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-muted bg-panel px-1.5 py-0.5 rounded border border-border">
            Esc
          </kbd>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="sm:hidden p-1 rounded hover:bg-panel"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-1.5" data-testid="global-search-results">
          {!debouncedQ && (
            <div className="px-4 py-6 text-center">
              <div className="text-[12.5px] text-muted mb-2">
                {askMode ? (
                  <>Ask anything in plain English — I'll find the data and deep-link you to the right page.</>
                ) : (
                  <>Jump to anything — stores, styles, customers, pages. Toggle <b>Ask</b> for natural-language queries.</>
                )}
              </div>
              {!askMode ? (
                <div className="inline-flex gap-1.5 text-[10.5px] text-muted">
                  <kbd className="bg-panel border border-border rounded px-1.5 py-0.5">↑</kbd>
                  <kbd className="bg-panel border border-border rounded px-1.5 py-0.5">↓</kbd>
                  to navigate ·
                  <kbd className="bg-panel border border-border rounded px-1.5 py-0.5">↵</kbd>
                  to open
                </div>
              ) : (
                <div className="mt-2 space-y-1.5 text-[11.5px]">
                  {[
                    "stores with stuck stock",
                    "phantom stock styles",
                    "top 5 stores by sales",
                    "styles whose price went up 10%",
                    "critical reorders right now",
                  ].map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setQ(ex)}
                      className="block w-full text-left px-3 py-1.5 rounded bg-panel/60 hover:bg-panel border border-border text-muted hover:text-brand"
                      data-testid={`ask-example-${ex.replace(/\s+/g, "-")}`}
                    >
                      <Sparkle size={10} weight="fill" className="inline -mt-0.5 mr-1 text-brand" />
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Ask mode render ── */}
          {debouncedQ && askMode && (
            <div data-testid="global-search-ask-panel">
              {askLoading && (
                <div className="px-4 py-6 text-center text-[12.5px] text-muted">
                  <Sparkle size={14} weight="fill" className="inline -mt-0.5 mr-1 text-brand animate-pulse" />
                  Thinking about "{debouncedQ}"…
                </div>
              )}
              {askError && !askLoading && (
                <div className="px-4 py-6 text-center text-[12.5px] text-red-700">
                  {askError}
                </div>
              )}
              {askResult && !askLoading && (
                <div className="p-2 space-y-2">
                  <div className="rounded-lg bg-brand/5 border border-brand/20 px-3 py-2">
                    <div className="flex items-start gap-2">
                      <Sparkle size={13} weight="fill" className="mt-0.5 text-brand shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-medium">{askResult.answer}</div>
                        {askResult.intent && askResult.intent !== "unknown" && (
                          <div className="text-[10.5px] text-muted mt-0.5">
                            intent: <code>{askResult.intent}</code>
                            {askResult.count != null && <> · {askResult.count} result{askResult.count === 1 ? "" : "s"}</>}
                          </div>
                        )}
                      </div>
                      {askResult.link && (
                        <button
                          type="button"
                          onClick={() => { navigate(askResult.link); setOpen(false); }}
                          className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-brand text-white hover:bg-brand-deep"
                          data-testid="ask-open-page"
                        >
                          Open <ArrowRight size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  {(askResult.rows || []).length > 0 && (
                    <div className="space-y-0.5">
                      {askResult.rows.map((row, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 px-3 py-1.5 rounded-md hover:bg-panel"
                          data-testid={`ask-row-${i}`}
                        >
                          <Lightning size={11} className="mt-1 text-brand shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[12.5px] font-medium truncate">{row.title}</div>
                            {row.sub && <div className="text-[11px] text-muted truncate">{row.sub}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(askResult.followups || []).length > 0 && (
                    <div className="pt-2 border-t border-border">
                      <div className="text-[10.5px] uppercase tracking-wider text-muted px-3 mb-1">Try next</div>
                      <div className="flex flex-wrap gap-1.5 px-3 pb-1">
                        {askResult.followups.map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setQ(f)}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-panel hover:bg-brand/10 hover:text-brand text-muted border border-border"
                            data-testid={`ask-followup-${f.replace(/\s+/g, "-")}`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Classic search mode render ── */}
          {debouncedQ && !askMode && loading && (
            <div className="px-4 py-6 text-center text-[12.5px] text-muted">Searching…</div>
          )}
          {debouncedQ && !askMode && showEmptyState && (
            <div className="px-4 py-6 text-center text-[12.5px] text-muted">
              No matches for <b>{debouncedQ}</b>.
            </div>
          )}
          {debouncedQ && !askMode && anyResults && sections}
        </div>

        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-panel/40 text-[10.5px] text-muted">
          <div>
            {askMode ? (
              <>Powered by Claude · {" "}
                <button type="button" onClick={() => setAskMode(false)} className="underline decoration-dotted hover:text-brand" data-testid="ask-disable">
                  Switch to lookup
                </button>
              </>
            ) : (
              <>Press <kbd className="bg-white border border-border rounded px-1 py-0.5">⌘K</kbd> / <kbd className="bg-white border border-border rounded px-1 py-0.5">Ctrl K</kbd> anywhere</>
            )}
          </div>
          {!askMode && flat.length > 0 && <div>{flat.length} result{flat.length === 1 ? "" : "s"}</div>}
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;
