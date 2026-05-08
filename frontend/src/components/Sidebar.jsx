import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  ChartPieSlice,
  MapPin,
  Package,
  Tag,
  Users,
  FileText,
  Footprints,
  ArrowClockwise,
  SignOut,
  CaretDown,
  ShieldCheck,
  ClockClockwise,
  ArrowsClockwise,
  Truck,
  Warning,
  DownloadSimple,
  CurrencyCircleDollar,
  Target,
  Stack,
  ChatCircleDots,
  List as MenuIcon,
  X as CloseIcon,
} from "@phosphor-icons/react";
import { useFilters } from "@/lib/filters";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { canAccessPage } from "@/lib/permissions";
import NotificationBell from "@/components/NotificationBell";

const tabs = [
  { to: "/", label: "Overview", icon: ChartPieSlice, id: "overview" },
  { to: "/locations", label: "Locations", icon: MapPin, id: "locations" },
  { to: "/footfall", label: "Footfall", icon: Footprints, id: "footfall" },
  { to: "/customers", label: "Customers", icon: Users, id: "customers" },
  { to: "/customer-details", label: "Customer Details", icon: Users, id: "customer-details" },
  { to: "/products", label: "Products", icon: Tag, id: "products" },
  { to: "/inventory", label: "Inventory", icon: Package, id: "inventory" },
  { to: "/re-order", label: "Re-Order", icon: ArrowsClockwise, id: "re-order" },
  { to: "/ibt", label: "IBT", icon: Truck, id: "ibt" },
  { to: "/allocations", label: "Allocations", icon: Stack, id: "allocations" },
  { to: "/replenishments", label: "Replenishments", icon: ArrowsClockwise, id: "replenishments" },
  { to: "/pricing", label: "Pricing", icon: CurrencyCircleDollar, id: "pricing" },
  { to: "/ceo-report", label: "CEO Report", icon: FileText, id: "ceo-report" },
  { to: "/targets", label: "Targets", icon: Target, id: "targets" },
  { to: "/data-quality", label: "Data Quality", icon: Warning, id: "data-quality" },
  { to: "/exports", label: "Exports (Sales, Inventory)", icon: DownloadSimple, id: "exports" },
  { to: "/feedback", label: "Feedback", icon: ChatCircleDots, id: "feedback" },
];

const relativeTime = (d) => {
  if (!d) return "—";
  const diff = Math.floor((new Date() - d) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
};

const UserMenu = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  if (!user) return null;
  const initials = (user.name || user.email).slice(0, 2).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-panel"
        data-testid="user-menu-btn"
      >
        {user.picture ? (
          <img src={user.picture} alt="" className="w-7 h-7 rounded-full border border-border" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-brand text-white grid place-items-center font-bold text-[11px]">
            {initials}
          </div>
        )}
        <div className="hidden md:block text-left leading-tight">
          <div className="text-[12px] font-semibold">{user.name || user.email.split("@")[0]}</div>
          <div className="text-[10px] text-muted">{user.role}</div>
        </div>
        <CaretDown size={11} className="text-muted" />
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-white shadow-lg py-1 z-50"
          data-testid="user-menu"
        >
          <div className="px-3 py-2 border-b border-border">
            <div className="text-[12px] font-semibold truncate">{user.name || "—"}</div>
            <div className="text-[11px] text-muted truncate">{user.email}</div>
          </div>
          {user.role === "admin" && (
            <>
              <button
                className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-panel flex items-center gap-2"
                onClick={() => { setOpen(false); navigate("/admin/users"); }}
                data-testid="menu-users"
              >
                <ShieldCheck size={13} /> Users
              </button>
              <button
                className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-panel flex items-center gap-2"
                onClick={() => { setOpen(false); navigate("/admin/activity-logs"); }}
                data-testid="menu-logs"
              >
                <ClockClockwise size={13} /> Activity Logs
              </button>
              <button
                className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-panel flex items-center gap-2"
                onClick={() => { setOpen(false); navigate("/admin/feedback"); }}
                data-testid="menu-feedback-inbox"
              >
                <ChatCircleDots size={13} /> Feedback Inbox
              </button>
              <button
                className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-panel flex items-center gap-2"
                onClick={() => { setOpen(false); navigate("/admin/store-clusters"); }}
                data-testid="menu-store-clusters"
              >
                <Stack size={13} /> Store Clusters
              </button>
              <div className="h-px bg-border my-1" />
            </>
          )}
          <button
            className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-panel flex items-center gap-2 text-danger"
            onClick={async () => { setOpen(false); await logout(); navigate("/login", { replace: true }); }}
            data-testid="menu-logout"
          >
            <SignOut size={13} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
};

const TopNav = () => {
  const { lastUpdated, refresh } = useFilters();
  const { user } = useAuth();
  const visibleTabs = React.useMemo(
    () => tabs.filter((t) => canAccessPage(user, t.id)),
    [user]
  );
  const [mobileOpen, setMobileOpen] = React.useState(false);
  // Force the relative-time label to re-render every 30s.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // "Late transfers" badge — count of IBT suggestions first surfaced
  // >5 days ago that nobody has marked done yet. Polled every 5 min so
  // the number stays fresh without spamming the backend.
  const [lateCount, setLateCount] = React.useState(0);
  React.useEffect(() => {
    if (!user || !canAccessPage(user, "ibt")) return;
    let cancelled = false;
    const fetch = () => {
      api.get("/ibt/late-count")
        .then((r) => { if (!cancelled) setLateCount(r.data?.count || 0); })
        .catch(() => { /* non-critical */ });
    };
    fetch();
    const id = setInterval(fetch, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);
  return (
    <nav
      className="relative px-3 sm:px-5 lg:px-10 py-2.5 flex items-center justify-between gap-3 no-print bg-[#fed7aa] border-b border-border"
      data-testid="top-nav"
    >
      <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
        <button
          type="button"
          className="lg:hidden p-1.5 -ml-1 rounded-lg hover:bg-panel"
          onClick={() => setMobileOpen((v) => !v)}
          data-testid="mobile-menu-btn"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
        </button>
        <div
          className="flex items-center shrink-0"
          data-testid="brand-logo"
          aria-label="Vivo Fashion Group"
        >
          <img
            src="/brand/vivo-logo.png"
            alt="Vivo"
            className="h-8 sm:h-9 w-auto rounded-md"
          />
        </div>
        <div className="leading-tight min-w-0">
          <div className="text-[13px] sm:text-[14px] font-bold tracking-tight text-foreground truncate">
            Vivo Fashion Group
          </div>
          <div className="hidden sm:block text-[10.5px] text-muted uppercase tracking-wider">
            BI · East Africa
          </div>
        </div>
      </div>

      <div className="hidden lg:flex items-center gap-1 flex-1 justify-center min-w-0 flex-wrap">
        {visibleTabs.map((t) => (
          <NavLink
            key={t.id}
            to={t.to}
            end={t.to === "/"}
            data-testid={`nav-${t.id}`}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-2 xl:px-3 py-1.5 rounded-lg text-[11.5px] xl:text-[12.5px] font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-brand text-white shadow-sm"
                  : "text-foreground/70 hover:bg-panel hover:text-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <t.icon size={13} weight={isActive ? "fill" : "regular"} />
                <span>{t.label}</span>
                {t.id === "ibt" && lateCount > 0 && (
                  <span
                    className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold leading-none animate-pulse"
                    title={`${lateCount} transfer${lateCount === 1 ? "" : "s"} suggested >5 days ago and not yet marked done`}
                    data-testid="ibt-late-badge"
                  >
                    {lateCount > 99 ? "99+" : lateCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 text-[11.5px] text-muted">
        <span className="hidden xl:inline" data-testid="last-updated">
          Updated {relativeTime(lastUpdated)}
        </span>
        <button
          type="button"
          onClick={() => {
            // Dispatch the same keyboard shortcut the palette listens for.
            const evt = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
            window.dispatchEvent(evt);
          }}
          className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-muted hover:text-brand px-2 py-1 rounded-md border border-border hover:border-brand transition-colors"
          data-testid="open-global-search"
          title="Open global search (⌘K)"
        >
          <span className="hidden lg:inline">Search</span>
          <kbd className="bg-panel px-1 py-0.5 rounded text-[10px] border border-border">⌘K</kbd>
        </button>
        <button
          type="button"
          onClick={refresh}
          data-testid="refresh-data-btn"
          className="p-1.5 rounded-lg hover:bg-panel text-foreground/70 hover:text-brand transition-colors"
          title="Refresh data from API"
        >
          <ArrowClockwise size={15} weight="bold" />
        </button>
        <NotificationBell />
        <UserMenu />
      </div>

      {mobileOpen && (
        <div
          className="lg:hidden absolute left-0 right-0 top-full bg-white border-b border-border shadow-md z-40 px-3 py-2 flex flex-col gap-1"
          data-testid="mobile-menu"
        >
          {visibleTabs.map((t) => (
            <NavLink
              key={t.id}
              to={t.to}
              end={t.to === "/"}
              onClick={() => setMobileOpen(false)}
              data-testid={`nav-mobile-${t.id}`}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[14px] font-medium ${
                  isActive
                    ? "bg-brand text-white"
                    : "text-foreground/80 hover:bg-panel"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <t.icon size={17} weight={isActive ? "fill" : "regular"} />
                  <span>{t.label}</span>
                  {t.id === "ibt" && lateCount > 0 && (
                    <span
                      className="ml-auto inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-bold leading-none"
                      data-testid="ibt-late-badge-mobile"
                    >
                      {lateCount > 99 ? "99+" : lateCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  );
};

export default TopNav;
