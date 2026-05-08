import React from "react";
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
  Settings,
  Inbox,
  Layers,
  ClipboardList,
  Compass,
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
  { to: "/templates", label: "Templates", icon: MessageSquare, testid: "nav-templates", manager: true },
  { to: "/audit", label: "Audit", icon: ShieldCheck, testid: "nav-audit", manager: true },
];

export default function AppShell() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--vivo-muted)]">Loading…</div>
    );
  }
  if (!user) {
    // Not authenticated -> bounce
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  const isManager = user.role === "manager";

  return (
    <div className="min-h-screen flex bg-[var(--vivo-bg)]">
      {/* Side rail */}
      <aside className="w-64 shrink-0 hidden md:flex flex-col bg-white border-r border-[var(--vivo-border)]">
        <Link to="/dashboard" className="px-7 pt-8 pb-6 block" data-testid="brand-link">
          <div className="eyebrow">VIVO · CLIENTELING</div>
          <div className="font-display text-2xl mt-1 tracking-tight">Vivo CRM</div>
          <div className="gold-rule mt-3" />
        </Link>
        <nav className="px-3 py-2 flex-1">
          {NAV.filter((n) => !n.manager || isManager).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={item.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 text-sm rounded-sm border-l-2 ${
                  isActive
                    ? "border-[var(--vivo-gold)] text-[var(--vivo-navy)] bg-[var(--vivo-bg)] font-semibold"
                    : "border-transparent text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)]"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[var(--vivo-border)] p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-[var(--vivo-navy)] text-white flex items-center justify-center font-semibold">
            {(user.name || user.email)[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate" data-testid="user-name">{user.name}</div>
            <div className="text-xs text-[var(--vivo-muted)] truncate uppercase tracking-wider" data-testid="user-role">
              {user.role}
            </div>
          </div>
          <Button
            onClick={logout}
            data-testid="logout-button"
            variant="ghost"
            size="icon"
            className="text-[var(--vivo-muted)] hover:text-[var(--vivo-navy)]"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </aside>

      {/* Mobile top bar (hidden ≥ md) */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-[var(--vivo-border)] flex items-center justify-between px-4 h-14">
        <div className="font-display text-lg">Vivo CRM</div>
        <Button onClick={logout} variant="ghost" size="icon" data-testid="logout-button-mobile">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Main */}
      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
