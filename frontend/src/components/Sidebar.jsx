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
  List as MenuIcon,
  X as CloseIcon,
} from "@phosphor-icons/react";
import { useFilters } from "@/lib/filters";
import { useAuth } from "@/lib/auth";

const tabs = [
  { to: "/", label: "Overview", icon: ChartPieSlice, id: "overview" },
  { to: "/locations", label: "Locations", icon: MapPin, id: "locations" },
  { to: "/footfall", label: "Footfall", icon: Footprints, id: "footfall" },
  { to: "/products", label: "Products", icon: Tag, id: "products" },
  { to: "/inventory", label: "Inventory", icon: Package, id: "inventory" },
  { to: "/re-order", label: "Re-Order", icon: ArrowsClockwise, id: "re-order" },
  { to: "/ibt", label: "IBT", icon: Truck, id: "ibt" },
  { to: "/customers", label: "Customers", icon: Users, id: "customers" },
  { to: "/ceo-report", label: "CEO Report", icon: FileText, id: "ceo-report" },
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
  const [mobileOpen, setMobileOpen] = React.useState(false);
  // Force the relative-time label to re-render every 30s.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <nav
      className="sticky-nav px-3 sm:px-5 lg:px-10 py-2.5 flex items-center justify-between gap-3 no-print"
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
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-brand text-white grid place-items-center font-extrabold text-[14px] sm:text-[15px] shadow-sm">
          V
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

      <div className="hidden lg:flex items-center gap-1 flex-1 justify-center min-w-0 overflow-x-auto">
        {tabs.map((t) => (
          <NavLink
            key={t.id}
            to={t.to}
            end={t.to === "/"}
            data-testid={`nav-${t.id}`}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-2.5 xl:px-3.5 py-2 rounded-lg text-[12px] xl:text-[13px] font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-brand text-white shadow-sm"
                  : "text-foreground/70 hover:bg-panel hover:text-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <t.icon size={14} weight={isActive ? "fill" : "regular"} />
                <span>{t.label}</span>
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
          onClick={refresh}
          data-testid="refresh-data-btn"
          className="p-1.5 rounded-lg hover:bg-panel text-foreground/70 hover:text-brand transition-colors"
          title="Refresh data from API"
        >
          <ArrowClockwise size={15} weight="bold" />
        </button>
        <UserMenu />
      </div>

      {mobileOpen && (
        <div
          className="lg:hidden fixed left-0 right-0 top-[48px] sm:top-[56px] bg-white border-b border-border shadow-md z-40 px-3 py-2 flex flex-col gap-1"
          data-testid="mobile-menu"
        >
          {tabs.map((t) => (
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
