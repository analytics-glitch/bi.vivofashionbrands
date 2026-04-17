import React from "react";
import { NavLink } from "react-router-dom";
import {
  ChartPieSlice,
  MapPin,
  Package,
  Gauge,
  FileText,
  Sparkle,
} from "@phosphor-icons/react";

const nav = [
  { to: "/", label: "Overview", icon: ChartPieSlice, id: "overview" },
  { to: "/locations", label: "Locations", icon: MapPin, id: "locations" },
  { to: "/inventory", label: "Inventory", icon: Package, id: "inventory" },
  { to: "/sor", label: "Sell-Out Rate", icon: Gauge, id: "sor" },
  { to: "/new-styles", label: "New Styles", icon: Sparkle, id: "new-styles" },
  { to: "/ceo-report", label: "CEO Report", icon: FileText, id: "ceo-report" },
];

const Sidebar = () => {
  return (
    <aside
      className="hidden lg:flex flex-col w-[248px] shrink-0 border-r border-border bg-white sticky top-0 h-screen no-print"
      data-testid="app-sidebar"
    >
      <div className="px-6 pt-8 pb-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-brand text-white grid place-items-center font-extrabold text-lg shadow-[0_6px_20px_rgba(0,163,74,0.3)]">
            V
          </div>
          <div className="leading-tight">
            <div className="text-[14.5px] font-bold tracking-tight text-foreground">
              Vivo Fashion Group
            </div>
            <div className="eyebrow mt-1" style={{ fontSize: "0.58rem" }}>
              BI · East Africa
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 flex flex-col gap-1">
        {nav.map((n) => (
          <NavLink
            key={n.id}
            to={n.to}
            end={n.to === "/"}
            data-testid={`sidebar-nav-${n.id}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-colors ${
                isActive
                  ? "bg-brand-soft text-brand-deep border border-brand/25"
                  : "text-foreground/70 hover:bg-surface-2 hover:text-foreground border border-transparent"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <n.icon size={19} weight={isActive ? "fill" : "duotone"} />
                <span>{n.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-5 py-5 border-t border-border">
        <div className="text-[11px] text-muted">© 2026 Vivo Fashion Group</div>
      </div>
    </aside>
  );
};

export default Sidebar;
