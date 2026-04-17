import React from "react";
import { NavLink } from "react-router-dom";
import {
  ChartPieSlice,
  Storefront,
  Package,
  MapPin,
  TrendUp,
} from "@phosphor-icons/react";

const nav = [
  { to: "/", label: "Overview", icon: ChartPieSlice, id: "overview" },
  { to: "/sales", label: "Sales", icon: TrendUp, id: "sales" },
  { to: "/inventory", label: "Inventory", icon: Package, id: "inventory" },
  { to: "/locations", label: "Locations", icon: MapPin, id: "locations" },
];

const Sidebar = () => {
  return (
    <aside
      className="hidden lg:flex flex-col w-[240px] shrink-0 border-r border-border bg-[hsl(var(--sidebar-bg))] sticky top-0 h-screen"
      data-testid="app-sidebar"
    >
      <div className="px-6 pt-8 pb-10">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary text-white grid place-items-center font-display font-black text-lg">
            V
          </div>
          <div>
            <div className="font-display text-[15px] font-bold tracking-tight leading-none">
              Vivo Fashion Group
            </div>
            <div className="eyebrow mt-1" style={{ fontSize: "0.6rem" }}>
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
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-medium transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-foreground/70 hover:bg-muted hover:text-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <n.icon size={20} weight={isActive ? "fill" : "duotone"} />
                <span>{n.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-5 py-5 border-t border-border">
        <div className="flex items-center gap-3">
          <img
            src="https://images.unsplash.com/photo-1687137113677-f2a9a6c79fab?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNTl8MHwxfHNlYXJjaHw0fHxhZnJpY2FuJTIwZmFzaGlvbiUyMG1vZGVsfGVufDB8fHx8MTc3NjQyMzU2MXww&ixlib=rb-4.1.0&q=85"
            alt="avatar"
            className="w-9 h-9 rounded-full object-cover"
          />
          <div className="text-[12px] leading-tight">
            <div className="font-semibold">Amara K.</div>
            <div className="text-muted-foreground">Regional Director</div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
