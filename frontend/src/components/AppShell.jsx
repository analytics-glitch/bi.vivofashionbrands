import React, { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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
  const [mobileOpen, setMobileOpen] = useState(false);

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
          <nav className="hidden md:flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar" data-testid="top-nav-items">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                data-testid={item.testid}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 px-3 h-10 text-sm whitespace-nowrap rounded-sm border-b-2 transition ${
                    isActive
                      ? "border-[var(--vivo-gold)] text-[var(--vivo-navy)] font-semibold bg-[var(--vivo-bg)]"
                      : "border-transparent text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)] hover:bg-[var(--vivo-bg)]/50"
                  }`
                }
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

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
