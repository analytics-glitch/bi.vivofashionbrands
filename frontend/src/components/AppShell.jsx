import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard,
  Users,
  BookImage,
  MessageSquare,
  ShieldCheck,
  BarChart3,
  LogOut,
  Inbox,
  Layers,
  ClipboardList,
  Compass,
  GraduationCap,
  Menu,
  X,
  Database,
  Search,
  Bell,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV = [
  { to: "/dashboard", label: "Today", icon: LayoutDashboard, testid: "nav-today" },
  { to: "/overview", label: "Overview", icon: Compass, testid: "nav-overview", manager: true },
  { to: "/customers", label: "Customers", icon: Users, testid: "nav-customers" },
  { to: "/inbox", label: "Inbox", icon: Inbox, testid: "nav-inbox" },
  { to: "/lookbooks", label: "Lookbooks", icon: BookImage, testid: "nav-lookbooks" },
  { to: "/manager", label: "Insights", icon: BarChart3, testid: "nav-manager", manager: true },
  { to: "/cohorts", label: "Cohorts", icon: Layers, testid: "nav-cohorts", manager: true },
  { to: "/operations", label: "Operations", icon: ClipboardList, testid: "nav-operations", manager: true },
  { to: "/training", label: "Training", icon: GraduationCap, testid: "nav-training", manager: true },
  { to: "/templates", label: "Templates", icon: MessageSquare, testid: "nav-templates", manager: true },
  { to: "/audit", label: "Audit", icon: ShieldCheck, testid: "nav-audit", manager: true },
  { to: "/data-quality", label: "Data quality", icon: Database, testid: "nav-data-quality", manager: true },
];

export default function AppShell() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [notifsOpen, setNotifsOpen] = useState(false);
  const searchTimer = useRef(null);
  const searchBoxRef = useRef(null);
  const notifsRef = useRef(null);

  // Load open follow-ups for the bell (best-effort, refresh every 2 min)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const loadNotifs = async () => {
      try {
        const r = await api.get("/tasks", { params: { mine: true } });
        const open = (r.data || []).filter((t) => !t.completed);
        if (!cancelled) setNotifs(open);
      } catch { /* ignore */ }
    };
    loadNotifs();
    const id = setInterval(loadNotifs, 120000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  // Debounced customer search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await api.get("/bi/customer-search", { params: { q } });
        setSearchResults((r.data || []).slice(0, 8));
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    }, 250);
    return () => searchTimer.current && clearTimeout(searchTimer.current);
  }, [searchQ]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const onClick = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) setSearchOpen(false);
      if (notifsRef.current && !notifsRef.current.contains(e.target)) setNotifsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--vivo-muted)]">Loading…</div>
    );
  }
  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  const isManager = user.role === "manager";
  const items = NAV.filter((n) => !n.manager || isManager);

  const overdueCount = notifs.filter((n) => {
    if (!n.due_date) return false;
    return new Date(n.due_date) < new Date();
  }).length;

  const openCustomer = (id) => {
    setSearchOpen(false);
    setSearchQ("");
    navigate(`/customers/${id}`);
  };

  return (
    <div className="min-h-screen bg-[var(--vivo-bg)]" data-testid="app-shell">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-[var(--vivo-border)]" data-testid="top-nav">
        <div className="mx-auto max-w-[1600px] flex items-center h-16 px-4 md:px-6 gap-2">
          {/* Brand */}
          <Link to="/dashboard" className="flex items-center gap-3 pr-4 mr-2 border-r border-[var(--vivo-border)] shrink-0" data-testid="brand-link">
            <div className="vivo-logo-tile h-10 w-10 text-base">Vivo</div>
            <div className="hidden lg:block leading-tight">
              <div className="font-display text-base text-[var(--vivo-navy)] tracking-tight">Vivo CRM</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Clienteling · East Africa</div>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto no-scrollbar" data-testid="top-nav-items">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                data-testid={item.testid}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 px-3 h-16 -mb-px text-sm whitespace-nowrap border-b-2 transition ${
                    isActive
                      ? "border-[var(--vivo-gold)] text-[var(--vivo-navy)] font-semibold"
                      : "border-transparent text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)]"
                  }`
                }
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Search */}
          <div ref={searchBoxRef} className="hidden md:block relative shrink-0" data-testid="global-search">
            <div className={`flex items-center gap-2 h-9 rounded-sm border transition ${searchOpen ? "border-[var(--vivo-navy)] bg-white w-72" : "border-[var(--vivo-border)] bg-[var(--vivo-bg)] w-44"}`}>
              <Search className="h-3.5 w-3.5 text-[var(--vivo-muted)] ml-2.5 shrink-0" />
              <input
                type="text"
                value={searchQ}
                onChange={(e) => { setSearchQ(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search customers…"
                className="bg-transparent outline-none text-sm flex-1 min-w-0 placeholder:text-[var(--vivo-muted)] pr-2"
                data-testid="global-search-input"
              />
            </div>
            {searchOpen && searchQ.trim().length >= 2 && (
              <div className="absolute top-11 right-0 w-80 max-h-[420px] overflow-y-auto bg-white border border-[var(--vivo-border)] rounded-sm shadow-lg z-50" data-testid="global-search-results">
                {searchLoading && <div className="p-3 text-xs text-[var(--vivo-muted)]">Searching…</div>}
                {!searchLoading && searchResults.length === 0 && (
                  <div className="p-3 text-xs text-[var(--vivo-muted)]">No customers found.</div>
                )}
                {searchResults.map((c) => (
                  <button
                    key={c.customer_id}
                    onClick={() => openCustomer(c.customer_id)}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--vivo-bg)] border-b border-[var(--vivo-border)] last:border-0"
                    data-testid={`search-result-${c.customer_id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium truncate">{c.customer_name || c.full_name || c.first_name || "Unknown"}</div>
                      {c.rfm_tier && (
                        <span className="text-[9px] uppercase tracking-wider text-[var(--vivo-navy)] bg-[var(--vivo-bg)] px-1.5 py-0.5 rounded-sm shrink-0">{c.rfm_tier}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--vivo-muted)] truncate">
                      {c.phone || c.email || c.customer_id}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notifications bell */}
          <div ref={notifsRef} className="hidden md:block relative shrink-0" data-testid="notifications">
            <button
              type="button"
              onClick={() => setNotifsOpen((v) => !v)}
              className="relative inline-flex items-center justify-center h-9 w-9 rounded-sm border border-[var(--vivo-border)] bg-[var(--vivo-bg)] text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)]"
              data-testid="notifications-button"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {notifs.length > 0 && (
                <span
                  className={`absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${overdueCount > 0 ? "bg-red-600" : "bg-[var(--vivo-gold)]"}`}
                  data-testid="notifications-badge"
                >
                  {notifs.length > 99 ? "99+" : notifs.length}
                </span>
              )}
            </button>
            {notifsOpen && (
              <div className="absolute top-11 right-0 w-80 max-h-[420px] overflow-y-auto bg-white border border-[var(--vivo-border)] rounded-sm shadow-lg z-50" data-testid="notifications-panel">
                <div className="px-3 py-3 border-b border-[var(--vivo-border)] flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Open follow-ups</div>
                    <div className="text-[11px] text-[var(--vivo-muted)]">
                      {notifs.length} total {overdueCount > 0 && <span className="text-red-600 font-medium">· {overdueCount} overdue</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => { setNotifsOpen(false); navigate("/follow-ups"); }}
                    className="text-xs text-[var(--vivo-navy)] hover:underline inline-flex items-center gap-1"
                    data-testid="notifications-view-all"
                  >
                    View all <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
                {notifs.length === 0 && (
                  <div className="p-6 text-center text-xs text-[var(--vivo-muted)]">
                    🎉 You're all caught up.
                  </div>
                )}
                {notifs.slice(0, 8).map((t) => {
                  const overdue = t.due_date && new Date(t.due_date) < new Date();
                  return (
                    <button
                      key={t.task_id}
                      onClick={() => { setNotifsOpen(false); navigate(`/customers/${t.customer_id}`); }}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--vivo-bg)] border-b border-[var(--vivo-border)] last:border-0"
                      data-testid={`notif-${t.task_id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium truncate flex-1">{t.title || t.name || "Follow-up"}</div>
                        {overdue && (
                          <span className="text-[10px] uppercase tracking-wider text-red-600 font-semibold shrink-0">Overdue</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--vivo-muted)] truncate mt-0.5">
                        {t.customer_name || "—"} · due {(t.due_date || "").slice(0, 10)}
                      </div>
                    </button>
                  );
                })}
                {notifs.length > 8 && (
                  <button
                    onClick={() => { setNotifsOpen(false); navigate("/follow-ups"); }}
                    className="w-full text-center text-xs text-[var(--vivo-navy)] py-2 hover:bg-[var(--vivo-bg)]"
                  >
                    + {notifs.length - 8} more
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="md:hidden ml-auto inline-flex items-center justify-center h-10 w-10 rounded-sm border border-[var(--vivo-border)] text-[var(--vivo-muted)]"
            onClick={() => setMobileOpen((v) => !v)}
            data-testid="mobile-menu-toggle"
            aria-label="Menu"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          {/* User pill */}
          <div className="hidden md:flex items-center gap-2 pl-3 ml-2 border-l border-[var(--vivo-border)] shrink-0">
            <div className="h-8 w-8 rounded-full bg-[var(--vivo-navy)] text-white flex items-center justify-center font-semibold text-xs">
              {(user.name || user.email)[0]?.toUpperCase()}
            </div>
            <div className="hidden xl:block leading-tight">
              <div className="text-xs font-medium truncate max-w-[140px]" data-testid="user-name">{user.name}</div>
              <div className="text-[10px] text-[var(--vivo-muted)] uppercase tracking-wider" data-testid="user-role">
                {user.role}
              </div>
            </div>
            <Button
              onClick={logout}
              data-testid="logout-button"
              variant="ghost"
              size="icon"
              className="text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)] h-9 w-9"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[var(--vivo-border)] bg-white" data-testid="mobile-menu">
            <nav className="px-3 py-2">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-testid={`${item.testid}-mobile`}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 text-sm rounded-sm ${
                      isActive
                        ? "bg-[var(--vivo-bg)] text-[var(--vivo-navy)] font-semibold"
                        : "text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)]"
                    }`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="border-t border-[var(--vivo-border)] px-4 py-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-[var(--vivo-navy)] text-white flex items-center justify-center font-semibold text-xs">
                {(user.name || user.email)[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user.name}</div>
                <div className="text-[10px] text-[var(--vivo-muted)] uppercase tracking-wider">{user.role}</div>
              </div>
              <Button onClick={logout} variant="ghost" size="icon" data-testid="logout-button-mobile">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
